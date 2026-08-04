"""
# ============================================================
# Conversation Folding 服务 - 对话流自动折叠 (v1.0.0)
# Cycle 61 G61-08
# ============================================================
# 核心作用：当对话流过长时，自动折叠历史消息
#           - 保留最近 N 条消息原文
#           - 更早的消息由 LLM 生成摘要
#           - 持久化到磁盘 / 数据库
#           - 折叠时支持展开 / 重新加载
# 运行流程：
#   1. 检测消息数量超阈值
#   2. 选择需要折叠的消息范围
#   3. 调用 LLM 生成摘要
#   4. 保留摘要 + 原始元数据
#   5. 替换原消息为折叠占位符
#   6. 持久化折叠历史
# 设计要点：
#   - 折叠是非破坏性的：原文仍在 store 中
#   - 支持多级折叠：摘要可再次被摘要
#   - 支持手动触发 / 自动触发
#   - LLM 摘要失败时降级为简单截断
# 输入参数：session_id, fold_config
# 输出结果：fold_result + summary
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-08 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class FoldTrigger(str, Enum):
    """折叠触发方式"""
    AUTO = "auto"          # 消息超阈值自动触发
    MANUAL = "manual"      # 用户手动触发
    TOKEN_LIMIT = "token_limit"  # 达到 token 上限
    TIME_BASED = "time_based"    # 定时清理


class FoldStrategy(str, Enum):
    """折叠策略"""
    LLM_SUMMARY = "llm_summary"  # LLM 生成摘要
    TRUNCATE = "truncate"        # 简单截断
    KEEP_HEAD = "keep_head"      # 保留头部
    KEEP_TAIL = "keep_tail"      # 保留尾部
    KEEP_BOTH = "keep_both"      # 保留头尾


@dataclass
class FoldConfig:
    """
    折叠配置
    字段说明：
      - keep_recent: 保留最近 N 条消息原文
      - max_messages: 触发折叠的消息数阈值
      - max_tokens: 触发折叠的 token 阈值
      - strategy: 折叠策略
      - summary_max_tokens: 摘要最大 token 数
      - auto_fold: 是否自动折叠
    """
    keep_recent: int = 10
    max_messages: int = 50
    max_tokens: int = 8000
    strategy: FoldStrategy = FoldStrategy.LLM_SUMMARY
    summary_max_tokens: int = 500
    auto_fold: bool = True

    def to_dict(self) -> Dict:
        return {
            "keep_recent": self.keep_recent,
            "max_messages": self.max_messages,
            "max_tokens": self.max_tokens,
            "strategy": self.strategy.value,
            "summary_max_tokens": self.summary_max_tokens,
            "auto_fold": self.auto_fold,
        }


@dataclass
class FoldedMessage:
    """
    折叠后的消息占位符
    字段说明：
      - fold_id: 折叠 ID
      - range_start: 起始索引
      - range_end: 结束索引
      - original_count: 原始消息数
      - summary: 摘要文本
      - strategy: 使用的策略
      - tokens_before: 折叠前 token 数
      - tokens_after: 折叠后 token 数
      - created_at: 时间戳
      - metadata: 额外信息
    """
    fold_id: str = field(default_factory=lambda: f"fold-{uuid.uuid4().hex[:12]}")
    range_start: int = 0
    range_end: int = 0
    original_count: int = 0
    summary: str = ""
    strategy: FoldStrategy = FoldStrategy.LLM_SUMMARY
    tokens_before: int = 0
    tokens_after: int = 0
    created_at: float = field(default_factory=time.time)
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "fold_id": self.fold_id,
            "range_start": self.range_start,
            "range_end": self.range_end,
            "original_count": self.original_count,
            "summary": self.summary,
            "strategy": self.strategy.value,
            "tokens_before": self.tokens_before,
            "tokens_after": self.tokens_after,
            "created_at": self.created_at,
            "metadata": dict(self.metadata),
        }


@dataclass
class ConversationMessage:
    """对话消息"""
    msg_id: str = field(default_factory=lambda: f"msg-{uuid.uuid4().hex[:12]}")
    role: str = "user"  # user / assistant / system / tool
    content: str = ""
    timestamp: float = field(default_factory=time.time)
    tokens: int = 0
    metadata: Dict = field(default_factory=dict)
    # 折叠状态
    folded: bool = False
    fold_id: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "msg_id": self.msg_id,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "tokens": self.tokens,
            "metadata": dict(self.metadata),
            "folded": self.folded,
            "fold_id": self.fold_id,
        }


@dataclass
class FoldResult:
    """折叠结果"""
    success: bool
    session_id: str = ""
    folded_count: int = 0
    fold_id: Optional[str] = None
    summary: str = ""
    strategy: FoldStrategy = FoldStrategy.LLM_SUMMARY
    tokens_before: int = 0
    tokens_after: int = 0
    error: Optional[str] = None
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return {
            "success": self.success,
            "session_id": self.session_id,
            "folded_count": self.folded_count,
            "fold_id": self.fold_id,
            "summary": self.summary,
            "strategy": self.strategy.value,
            "tokens_before": self.tokens_before,
            "tokens_after": self.tokens_after,
            "error": self.error,
            "timestamp": self.timestamp,
        }


# ============================================================
# 摘要生成抽象
# ============================================================


class SummaryGenerator:
    """摘要生成器抽象"""

    async def summarize(
        self,
        messages: List[ConversationMessage],
        max_tokens: int = 500,
    ) -> str:
        """生成摘要"""
        raise NotImplementedError


class SimpleSummaryGenerator(SummaryGenerator):
    """简单摘要生成器（fallback）"""

    async def summarize(
        self,
        messages: List[ConversationMessage],
        max_tokens: int = 500,
    ) -> str:
        # 提取关键信息
        user_msgs = [m for m in messages if m.role == "user"]
        assistant_msgs = [m for m in messages if m.role == "assistant"]
        parts: List[str] = []
        if user_msgs:
            parts.append(f"用户提出 {len(user_msgs)} 个问题/需求")
            first_user = user_msgs[0].content[:100]
            parts.append(f"首个需求: {first_user}")
        if assistant_msgs:
            parts.append(f"助手回复 {len(assistant_msgs)} 次")
            last_assistant = assistant_msgs[-1].content[:100]
            parts.append(f"最后回复: {last_assistant}")
        return " | ".join(parts)[:max_tokens * 4]


class LLMSummaryGenerator(SummaryGenerator):
    """
    LLM 摘要生成器
    通过回调注入 LLM 调用
    """

    def __init__(self, llm_call_func=None) -> None:
        self._llm_call = llm_call_func

    def set_llm_call(self, func) -> None:
        self._llm_call = func

    async def summarize(
        self,
        messages: List[ConversationMessage],
        max_tokens: int = 500,
    ) -> str:
        if self._llm_call is None:
            return await SimpleSummaryGenerator().summarize(messages, max_tokens)

        # 构造 prompt
        conv_text = "\n".join(
            f"[{m.role}] {m.content[:500]}" for m in messages
        )
        prompt = (
            "请将以下对话历史压缩为简洁的摘要（保留关键决策、需求、结论）：\n\n"
            f"{conv_text}\n\n"
            f"摘要（不超过 {max_tokens} tokens）："
        )
        try:
            result = await self._llm_call(
                prompt=prompt,
                system="你是一名对话摘要专家，擅长压缩长对话历史。",
                max_tokens=max_tokens,
                timeout=60,
            )
            return result
        except Exception as e:  # noqa: BLE001
            logger.warning(f"LLM 摘要失败，使用 fallback: {e}")
            return await SimpleSummaryGenerator().summarize(messages, max_tokens)


# ============================================================
# Conversation Folding Manager
# ============================================================


class ConversationFoldingManager:
    """
    对话折叠管理器

    维护多个 session 的对话 + 折叠历史
    单例
    """

    def __init__(self, summary_generator: Optional[SummaryGenerator] = None) -> None:
        # session_id -> [ConversationMessage]
        self._sessions: Dict[str, List[ConversationMessage]] = {}
        # session_id -> [FoldedMessage]（折叠历史，按时间倒序）
        self._folds: Dict[str, List[FoldedMessage]] = {}
        # session_id -> FoldConfig
        self._configs: Dict[str, FoldConfig] = {}
        # 摘要生成器
        self._summary_gen = summary_generator or SimpleSummaryGenerator()
        # 锁
        self._locks: Dict[str, asyncio.Lock] = {}
        # 持久化目录
        self._storage_dir: Optional[str] = None

    def set_storage_dir(self, path: str) -> None:
        """设置持久化目录"""
        self._storage_dir = path
        os.makedirs(path, exist_ok=True)
        # 加载已有数据
        self._load_all()

    def set_summary_generator(self, gen: SummaryGenerator) -> None:
        """设置摘要生成器"""
        self._summary_gen = gen

    def get_config(self, session_id: str) -> FoldConfig:
        """获取 session 的折叠配置（默认）"""
        return self._configs.get(session_id, FoldConfig())

    def set_config(self, session_id: str, config: FoldConfig) -> None:
        """设置 session 的折叠配置"""
        self._configs[session_id] = config

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    # -------- 消息管理 --------

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        tokens: int = 0,
        metadata: Optional[Dict] = None,
    ) -> ConversationMessage:
        """添加消息到 session"""
        msg = ConversationMessage(
            role=role,
            content=content,
            tokens=tokens or len(content) // 4,  # 简单估算
            metadata=metadata or {},
        )
        if session_id not in self._sessions:
            self._sessions[session_id] = []
        self._sessions[session_id].append(msg)
        self._save_session(session_id)
        return msg

    def get_messages(self, session_id: str) -> List[ConversationMessage]:
        """获取 session 的所有消息"""
        return list(self._sessions.get(session_id, []))

    def get_active_messages(self, session_id: str) -> List[ConversationMessage]:
        """获取 session 的未折叠消息"""
        return [
            m for m in self._sessions.get(session_id, [])
            if not m.folded
        ]

    def get_total_tokens(self, session_id: str) -> int:
        """获取 session 总 token 数（不含折叠消息）"""
        return sum(m.tokens for m in self.get_active_messages(session_id))

    # -------- 触发判断 --------

    def should_fold(self, session_id: str) -> bool:
        """判断是否需要折叠"""
        config = self.get_config(session_id)
        if not config.auto_fold:
            return False
        msgs = self.get_active_messages(session_id)
        if len(msgs) >= config.max_messages:
            return True
        if self.get_total_tokens(session_id) >= config.max_tokens:
            return True
        return False

    # -------- 折叠操作 --------

    async def fold(
        self,
        session_id: str,
        trigger: FoldTrigger = FoldTrigger.MANUAL,
        config: Optional[FoldConfig] = None,
    ) -> FoldResult:
        """
        执行折叠

        输入参数：session_id, trigger, config
        输出结果：FoldResult
        """
        async with self._get_lock(session_id):
            if config is not None:
                self._configs[session_id] = config
            cfg = self.get_config(session_id)

            active = self.get_active_messages(session_id)
            if len(active) <= cfg.keep_recent:
                return FoldResult(
                    success=False,
                    session_id=session_id,
                    error=f"消息数 ({len(active)}) <= keep_recent ({cfg.keep_recent})，无需折叠",
                )

            # 选择要折叠的消息（保留最近 keep_recent 条）
            to_fold = active[:-cfg.keep_recent] if cfg.keep_recent > 0 else active
            if not to_fold:
                return FoldResult(
                    success=False,
                    session_id=session_id,
                    error="无消息可折叠",
                )

            tokens_before = sum(m.tokens for m in to_fold)
            range_start = self._sessions[session_id].index(to_fold[0])
            range_end = self._sessions[session_id].index(to_fold[-1])

            # 生成摘要
            # 策略说明：
            #   - LLM_SUMMARY/TRUNCATE：对 to_fold 范围生成摘要
            #   - KEEP_HEAD/KEEP_TAIL/KEEP_BOTH：保留整个 active 对话流的两端消息
            #     （用户视角的"保留头部" = 保留整个对话的第一条；
            #       "保留尾部" = 保留整个对话的最新一条）
            try:
                if cfg.strategy == FoldStrategy.LLM_SUMMARY:
                    summary = await self._summary_gen.summarize(
                        to_fold, max_tokens=cfg.summary_max_tokens,
                    )
                elif cfg.strategy == FoldStrategy.TRUNCATE:
                    summary = f"已折叠 {len(to_fold)} 条消息（简单截断）"
                elif cfg.strategy == FoldStrategy.KEEP_HEAD:
                    # 保留整个对话的第一条（最早消息）作为摘要锚点
                    summary = active[0].content[:cfg.summary_max_tokens * 4]
                elif cfg.strategy == FoldStrategy.KEEP_TAIL:
                    # 保留整个对话的最后一条（最新消息）作为摘要锚点
                    summary = active[-1].content[:cfg.summary_max_tokens * 4]
                elif cfg.strategy == FoldStrategy.KEEP_BOTH:
                    # 保留整个对话的首尾两条作为摘要锚点
                    head = active[0].content[: cfg.summary_max_tokens * 2]
                    tail = active[-1].content[: cfg.summary_max_tokens * 2]
                    summary = f"头部: {head}\n...\n尾部: {tail}"
                else:
                    summary = f"已折叠 {len(to_fold)} 条消息"
            except Exception as e:  # noqa: BLE001
                logger.exception(f"fold: 摘要生成失败 err={e}")
                # 降级到简单摘要
                summary = await SimpleSummaryGenerator().summarize(
                    to_fold, max_tokens=cfg.summary_max_tokens,
                )

            # 创建 FoldedMessage
            folded = FoldedMessage(
                range_start=range_start,
                range_end=range_end,
                original_count=len(to_fold),
                summary=summary,
                strategy=cfg.strategy,
                tokens_before=tokens_before,
                tokens_after=len(summary) // 4,
                metadata={"trigger": trigger.value},
            )

            # 标记消息为已折叠
            for m in to_fold:
                m.folded = True
                m.fold_id = folded.fold_id

            # 添加到折叠历史
            if session_id not in self._folds:
                self._folds[session_id] = []
            self._folds[session_id].insert(0, folded)

            # 持久化
            self._save_session(session_id)
            self._save_folds(session_id)

            return FoldResult(
                success=True,
                session_id=session_id,
                folded_count=len(to_fold),
                fold_id=folded.fold_id,
                summary=summary,
                strategy=cfg.strategy,
                tokens_before=tokens_before,
                tokens_after=folded.tokens_after,
            )

    async def auto_fold_if_needed(self, session_id: str) -> Optional[FoldResult]:
        """如果需要则自动折叠"""
        if not self.should_fold(session_id):
            return None
        return await self.fold(session_id, trigger=FoldTrigger.AUTO)

    # -------- 展开 / 查询 --------

    def list_folds(self, session_id: str) -> List[FoldedMessage]:
        """列出折叠历史"""
        return list(self._folds.get(session_id, []))

    def get_fold(self, session_id: str, fold_id: str) -> Optional[FoldedMessage]:
        """获取指定折叠"""
        for f in self._folds.get(session_id, []):
            if f.fold_id == fold_id:
                return f
        return None

    def get_folded_messages(
        self, session_id: str, fold_id: str,
    ) -> List[ConversationMessage]:
        """获取折叠范围内的原始消息"""
        return [
            m for m in self._sessions.get(session_id, [])
            if m.fold_id == fold_id
        ]

    def restore_fold(self, session_id: str, fold_id: str) -> int:
        """恢复折叠（将消息标记为未折叠）"""
        count = 0
        for m in self._sessions.get(session_id, []):
            if m.fold_id == fold_id:
                m.folded = False
                m.fold_id = None
                count += 1
        if count > 0:
            # 从折叠历史中移除
            self._folds[session_id] = [
                f for f in self._folds.get(session_id, [])
                if f.fold_id != fold_id
            ]
            self._save_session(session_id)
            self._save_folds(session_id)
        return count

    def list_sessions(self) -> List[str]:
        """列出所有 session"""
        return list(self._sessions.keys())

    def get_session_stats(self, session_id: str) -> Dict:
        """获取 session 统计信息"""
        msgs = self.get_messages(session_id)
        active = [m for m in msgs if not m.folded]
        folded = [m for m in msgs if m.folded]
        return {
            "session_id": session_id,
            "total_messages": len(msgs),
            "active_messages": len(active),
            "folded_messages": len(folded),
            "total_tokens": sum(m.tokens for m in active),
            "fold_count": len(self._folds.get(session_id, [])),
        }

    # -------- 持久化 --------

    def _save_session(self, session_id: str) -> None:
        if self._storage_dir is None:
            return
        try:
            path = os.path.join(self._storage_dir, f"{session_id}.messages.json")
            data = [m.to_dict() for m in self._sessions.get(session_id, [])]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"_save_session: 失败 err={e}")

    def _save_folds(self, session_id: str) -> None:
        if self._storage_dir is None:
            return
        try:
            path = os.path.join(self._storage_dir, f"{session_id}.folds.json")
            data = [f.to_dict() for f in self._folds.get(session_id, [])]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"_save_folds: 失败 err={e}")

    def _load_all(self) -> None:
        if self._storage_dir is None or not os.path.isdir(self._storage_dir):
            return
        for fname in os.listdir(self._storage_dir):
            if not fname.endswith(".messages.json"):
                continue
            session_id = fname[:-len(".messages.json")]
            try:
                with open(os.path.join(self._storage_dir, fname), "r", encoding="utf-8") as f:
                    data = json.load(f)
                msgs = []
                for d in data:
                    m = ConversationMessage(
                        msg_id=d.get("msg_id", f"msg-{uuid.uuid4().hex[:12]}"),
                        role=d.get("role", "user"),
                        content=d.get("content", ""),
                        timestamp=d.get("timestamp", 0),
                        tokens=d.get("tokens", 0),
                        metadata=d.get("metadata", {}),
                        folded=d.get("folded", False),
                        fold_id=d.get("fold_id"),
                    )
                    msgs.append(m)
                self._sessions[session_id] = msgs
            except Exception as e:  # noqa: BLE001
                logger.warning(f"_load_all: 加载 {fname} 失败 err={e}")

        for fname in os.listdir(self._storage_dir):
            if not fname.endswith(".folds.json"):
                continue
            session_id = fname[:-len(".folds.json")]
            try:
                with open(os.path.join(self._storage_dir, fname), "r", encoding="utf-8") as f:
                    data = json.load(f)
                folds = []
                for d in data:
                    folds.append(FoldedMessage(
                        fold_id=d.get("fold_id", f"fold-{uuid.uuid4().hex[:12]}"),
                        range_start=d.get("range_start", 0),
                        range_end=d.get("range_end", 0),
                        original_count=d.get("original_count", 0),
                        summary=d.get("summary", ""),
                        strategy=FoldStrategy(d.get("strategy", "llm_summary")),
                        tokens_before=d.get("tokens_before", 0),
                        tokens_after=d.get("tokens_after", 0),
                        created_at=d.get("created_at", 0),
                        metadata=d.get("metadata", {}),
                    ))
                self._folds[session_id] = folds
            except Exception as e:  # noqa: BLE001
                logger.warning(f"_load_all: 加载 {fname} 失败 err={e}")


# ============================================================
# 全局单例
# ============================================================


_manager: Optional[ConversationFoldingManager] = None


def get_manager() -> ConversationFoldingManager:
    global _manager
    if _manager is None:
        _manager = ConversationFoldingManager()
    return _manager


def reset_manager() -> None:
    """重置（用于测试）"""
    global _manager
    _manager = None
