"""
# ============================================================
# 长会话压缩 (Compaction) 服务
# ============================================================
# 核心作用：解决 LLM 长会话中的"Quadratic Growth Problem"，
#           在 token 数或消息数超过阈值时自动压缩历史消息
# 设计要点：
#   1. Token 计数：使用近似算法（每 4 字符 ≈ 1 token），避免引入 tiktoken 依赖
#   2. 摘要生成：调用 HermesService 的 LLM 能力（如果可用），否则回退到本地摘要
#   3. 压缩策略：支持 sliding / summary / hybrid 三种
#   4. 安全：原始消息标记 is_compacted=true 不删除，可回滚
# 运行流程：
#   1. 用户会话增长 → 检测 token 数
#   2. 超过阈值 → 触发 CompactionService.compact()
#   3. 保留 system + 最近 N 条 + 生成中间消息摘要
#   4. 写回新 summary 消息 → 标记原消息 is_compacted
# 输入参数：session_id、strategy、keep_recent
# 输出结果：CompactionResult（含 before/after token 数 + 摘要）
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 2 T2 初始化：实现 TokenCounter、SummaryGenerator、CompactionService
# ============================================================
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ============================================================
# 常量：默认压缩配置
# ============================================================
DEFAULT_CONFIG = {
    "enabled": True,
    "auto_trigger": True,
    "max_tokens": 50_000,
    "max_messages": 50,
    "keep_recent": 10,
    "strategy": "hybrid",  # sliding | summary | hybrid
}

# 字符与 token 的近似比例（中文 1.5 字符/token，英文 4 字符/token）
# 实际值取平均：~2.5 字符/token，用于无 tiktoken 时的近似估算
CHARS_PER_TOKEN = 2.5


# ============================================================
# TokenCounter
# ============================================================
class TokenCounter:
    """
    Token 计数器（近似算法）
    作用：估算消息列表的总 token 数
    算法：每 2.5 字符 = 1 token（基于中英文混合经验值）
    复杂度：O(N)，N 为消息字符总数
    """

    @staticmethod
    def count_text(text: str) -> int:
        """
        估算单个文本的 token 数
        参数：text 输入文本
        返回值：估算的 token 数
        """
        if not text:
            return 0
        # 基础估算
        return max(1, int(len(text) / CHARS_PER_TOKEN))

    @staticmethod
    def count_messages(messages: List[Dict[str, Any]]) -> int:
        """
        估算消息列表的总 token 数
        参数：messages 消息列表（每个含 role + content 字段）
        返回值：估算的总 token 数
        """
        total = 0
        for msg in messages:
            content = msg.get("content", "") or ""
            role = msg.get("role", "") or ""
            # 加上 role 占用（每条消息 role 约 4 token）
            total += TokenCounter.count_text(content) + 4
        return total


# ============================================================
# SummaryGenerator
# ============================================================
class SummaryGenerator:
    """
    摘要生成器
    作用：调用 LLM 生成历史消息的摘要；LLM 不可用时回退到本地摘要
    设计：
      1. 优先调用 HermesService（如果注入）
      2. 否则使用本地关键句提取（TF-IDF 简化版）
    """

    def __init__(self, hermes_service: Optional[Any] = None):
        """
        初始化
        参数：hermes_service 可选的 HermesService 实例，用于调用 LLM
        """
        self.hermes_service = hermes_service

    async def generate(self, messages: List[Dict[str, Any]], max_length: int = 1500) -> str:
        """
        生成消息列表的摘要
        参数：
          - messages 待摘要的消息列表
          - max_length 摘要最大字符数
        返回值：摘要文本
        """
        if not messages:
            return ""

        # 尝试调用 LLM
        if self.hermes_service is not None:
            try:
                prompt = self._build_prompt(messages, max_length)
                # HermesService 通常有 chat 方法
                if hasattr(self.hermes_service, "chat"):
                    response = await self.hermes_service.chat(
                        messages=[{"role": "user", "content": prompt}],
                        stream=False,
                    )
                    # 提取内容（response 可能是字符串或 dict）
                    if isinstance(response, str):
                        return response[:max_length]
                    elif isinstance(response, dict):
                        return response.get("content", "")[:max_length]
            except Exception as e:
                logger.warning(f"LLM 摘要失败，回退到本地摘要: {e}")

        # 回退：本地关键句提取
        return self._local_summarize(messages, max_length)

    def _build_prompt(self, messages: List[Dict[str, Any]], max_length: int) -> str:
        """
        构建 LLM 摘要 prompt
        """
        lines = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            lines.append(f"[{role}] {content[:500]}")  # 每条截断 500 字符
        conversation = "\n".join(lines)
        return (
            f"请将以下对话历史压缩为不超过 {max_length} 字的摘要，保留：\n"
            f"1. 关键决策点和结论\n2. 用户意图和需求\n3. 重要的代码、文件路径、技术细节\n"
            f"4. 后续待办事项\n\n【对话历史】\n{conversation}"
        )

    def _local_summarize(self, messages: List[Dict[str, Any]], max_length: int) -> str:
        """
        本地摘要（无 LLM 时的回退方案）
        算法：保留首尾各 3 条 + 中间每隔 5 条取 1 条
        """
        if not messages:
            return ""

        n = len(messages)
        if n <= 6:
            selected = messages
        else:
            # 首 3 + 尾 3 + 中间采样
            selected = messages[:3] + messages[-3:]
            if n > 12:
                mid_count = min(3, (n - 6) // 5)
                step = (n - 6) // max(mid_count, 1)
                for i in range(3, n - 3, step):
                    if len(selected) < 9:
                        selected.append(messages[i])

        parts = []
        for m in selected:
            role = m.get("role", "user")
            content = (m.get("content", "") or "")[:200]
            parts.append(f"[{role}] {content}")

        summary = " | ".join(parts)
        if len(summary) > max_length:
            summary = summary[: max_length - 3] + "..."
        return summary


# ============================================================
# CompactionService
# ============================================================
class CompactionService:
    """
    长会话压缩服务
    作用：管理会话的压缩触发、压缩执行、配置读写
    """

    def __init__(self, session_factory, hermes_service: Optional[Any] = None):
        """
        初始化
        参数：
          - session_factory 异步会话工厂
          - hermes_service 可选的 HermesService 用于 LLM 摘要
        """
        self.session_factory = session_factory
        self.summary_generator = SummaryGenerator(hermes_service=hermes_service)
        self.token_counter = TokenCounter()
        # 内存中的配置（可被 API 覆盖）
        self._config: Dict[str, Any] = dict(DEFAULT_CONFIG)
        logger.info("CompactionService 初始化完成")

    # ============================================================
    # 配置管理
    # ============================================================
    def get_config(self) -> Dict[str, Any]:
        """
        获取当前压缩配置
        返回值：配置字典
        """
        return dict(self._config)

    def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        更新压缩配置
        参数：updates 配置更新项
        返回值：更新后的配置
        """
        for key, value in updates.items():
            if key in DEFAULT_CONFIG:
                # 类型校验
                expected_type = type(DEFAULT_CONFIG[key])
                if expected_type in (int, float, bool, str):
                    if isinstance(value, expected_type):
                        self._config[key] = value
                    else:
                        # 尝试转换
                        try:
                            self._config[key] = expected_type(value)
                        except (ValueError, TypeError):
                            logger.warning(f"配置项 {key} 类型不匹配，跳过: {value}")
                else:
                    self._config[key] = value
            else:
                logger.warning(f"未知配置项: {key}")
        return dict(self._config)

    # ============================================================
    # 触发条件检查
    # ============================================================
    async def should_trigger(self, session_id: str) -> Tuple[bool, Dict[str, Any]]:
        """
        检查会话是否应触发压缩
        参数：session_id 会话 ID
        返回值：(should_compact, stats) 是否压缩 + 统计信息
        """
        if not self._config.get("enabled", True):
            return False, {}

        if not self._config.get("auto_trigger", True):
            return False, {}

        stats = await self.get_session_stats(session_id)
        msg_count = stats.get("message_count", 0)
        token_count = stats.get("token_count", 0)

        max_tokens = self._config.get("max_tokens", 50_000)
        max_messages = self._config.get("max_messages", 50)

        if token_count > max_tokens or msg_count > max_messages:
            return True, stats
        return False, stats

    # ============================================================
    # 会话统计
    # ============================================================
    async def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        """
        获取会话的压缩相关统计
        参数：session_id 会话 ID
        返回值：{message_count, token_count, active_count, compacted_count}
        """
        try:
            async with self.session_factory() as session:
                from backend.app.models import Conversation
                # 统计消息
                result = await session.execute(
                    select(Conversation).where(Conversation.session_id == session_id)
                )
                conversations = result.scalars().all()
                if not conversations:
                    return {
                        "message_count": 0,
                        "token_count": 0,
                        "active_count": 0,
                        "compacted_count": 0,
                    }
                messages = [
                    {"role": c.role, "content": c.content} for c in conversations
                ]
                token_count = TokenCounter.count_messages(messages)
                compacted = sum(1 for c in conversations if c.is_compacted)
                return {
                    "message_count": len(conversations),
                    "token_count": token_count,
                    "active_count": len(conversations) - compacted,
                    "compacted_count": compacted,
                }
        except Exception as e:
            logger.error(f"获取会话统计失败: {e}")
            return {"message_count": 0, "token_count": 0, "active_count": 0, "compacted_count": 0}

    async def get_session_tokens(self, session_id: str) -> int:
        """
        获取会话当前 token 数
        参数：session_id 会话 ID
        返回值：估算的 token 数
        """
        stats = await self.get_session_stats(session_id)
        return stats.get("token_count", 0)

    # ============================================================
    # 压缩执行
    # ============================================================
    async def compact(
        self,
        session_id: str,
        strategy: Optional[str] = None,
        keep_recent: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        执行压缩
        参数：
          - session_id 会话 ID
          - strategy 压缩策略（默认使用配置）
          - keep_recent 保留最近 N 条（默认使用配置）
        返回值：CompactionResult 字典
        """
        strategy = strategy or self._config.get("strategy", "hybrid")
        keep_recent = keep_recent or self._config.get("keep_recent", 10)

        logger.info(
            f"开始压缩 session={session_id}, strategy={strategy}, keep_recent={keep_recent}"
        )

        # 1. 读取消息
        before_stats = await self.get_session_stats(session_id)
        async with self.session_factory() as session:
            from backend.app.models import Conversation
            result = await session.execute(
                select(Conversation)
                .where(Conversation.session_id == session_id)
                .order_by(Conversation.created_at.asc())
            )
            conversations = result.scalars().all()

        if not conversations:
            return {
                "success": False,
                "error": "会话无消息，无需压缩",
                "before": before_stats,
                "after": before_stats,
                "summary": "",
            }

        messages = [
            {"id": c.id, "role": c.role, "content": c.content, "created_at": c.created_at}
            for c in conversations
        ]

        # 2. 应用策略
        if strategy == "sliding":
            # 滑动窗口：直接丢弃旧消息
            kept_messages = messages[-keep_recent:]
            summary_text = ""
            summary_tokens = 0
        elif strategy == "summary":
            # 全量摘要：保留所有 + 一个总摘要
            summary_text = await self.summary_generator.generate(messages)
            summary_tokens = TokenCounter.count_text(summary_text)
            kept_messages = messages[-keep_recent:]
        else:
            # hybrid：摘要中间 + 保留首尾
            if len(messages) <= keep_recent:
                return {
                    "success": False,
                    "error": f"消息数 {len(messages)} 不足，无需压缩",
                    "before": before_stats,
                    "after": before_stats,
                    "summary": "",
                }
            # 找到第一个 user 消息（通常 system 在前）
            system_msgs = [m for m in messages if m.get("role") == "system"]
            non_system = [m for m in messages if m.get("role") != "system"]
            head = non_system[:3] if len(non_system) > keep_recent else []
            tail = non_system[-keep_recent:] if len(non_system) > keep_recent else non_system
            middle = non_system[3:-keep_recent] if len(non_system) > keep_recent + 3 else []
            # 摘要中间部分
            summary_text = await self.summary_generator.generate(middle) if middle else ""
            summary_tokens = TokenCounter.count_text(summary_text)
            kept_messages = system_msgs + head + tail

        # 3. 写入 summary 消息（如果有）
        summary_msg_id = None
        if summary_text:
            summary_msg_id = str(uuid.uuid4())
            async with self.session_factory() as session:
                from backend.app.models import Conversation
                new_msg = Conversation(
                    id=summary_msg_id,
                    session_id=session_id,
                    role="system",
                    content=f"[压缩摘要] {summary_text}",
                    extra_data={
                        "type": "compaction_summary",
                        "strategy": strategy,
                        "compacted_count": len(messages) - len(kept_messages),
                        "summary_tokens": summary_tokens,
                    },
                )
                session.add(new_msg)
                await session.commit()

        # 4. 标记原消息为 is_compacted
        compacted_ids = [m["id"] for m in messages if m["id"] not in {k["id"] for k in kept_messages}]
        if compacted_ids:
            async with self.session_factory() as session:
                from backend.app.models import Conversation
                now = datetime.now(timezone.utc)
                await session.execute(
                    update(Conversation)
                    .where(Conversation.id.in_(compacted_ids))
                    .values(
                        is_compacted=True,
                        compacted_at=now,
                        compacted_into=summary_msg_id,
                    )
                )
                await session.commit()

        # 5. 计算 after stats
        after_stats = await self.get_session_stats(session_id)

        logger.info(
            f"压缩完成 session={session_id}: {before_stats['token_count']} → {after_stats['token_count']} tokens"
        )

        return {
            "success": True,
            "before": before_stats,
            "after": after_stats,
            "summary": summary_text,
            "summary_message_id": summary_msg_id,
            "compacted_count": len(compacted_ids),
            "kept_count": len(kept_messages),
            "strategy": strategy,
        }
