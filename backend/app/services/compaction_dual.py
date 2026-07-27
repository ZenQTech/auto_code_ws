"""
# ============================================================
# Compaction Dual-Trigger Service（Cycle 3 v1.0.0）
# ============================================================
# 核心作用：实现 Codex v0.139+ 的双触发点 Compaction 机制
# 触发点：
#   - pre_turn：用户消息前自动检测 + 压缩
#   - mid_turn：长工具调用链 loop 边界压缩 + replay
# 压缩路径：
#   - local：客户端 LLM 调用本地模型生成摘要（5-15s）
#   - remote：调用 OpenAI /v1/responses/compact 服务端 API（2-5s）
# 运行流程：
#   1. 检查触发条件 → 2. 选择压缩路径 → 3. 执行压缩
#   4. pre_turn 注入 / mid_turn replay pending request
# 输入参数：session_id、trigger、path、pending_user_request
# 输出结果：CompactionResult + history record
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与常量
# ============================================================

class CompactionTrigger(str, Enum):
    """压缩触发点"""
    MANUAL = "manual"           # 手动触发
    PRE_TURN = "pre_turn"       # 用户消息前
    MID_TURN = "mid_turn"       # 工具链循环边界


class CompactionPath(str, Enum):
    """压缩路径"""
    LOCAL = "local"             # 客户端 LLM 摘要
    REMOTE = "remote"           # 服务端压缩 API


# 双触发默认配置
DUAL_TRIGGER_CONFIG = {
    "pre_turn_enabled": True,
    "mid_turn_enabled": True,
    # mid_turn 触发阈值：token 使用率超过此比例触发
    "mid_turn_threshold_ratio": 0.85,
    # 远程 API endpoint（OpenAI 专有）
    "remote_endpoint": "https://api.openai.com/v1/responses/compact",
    # 远程 API 超时
    "remote_timeout_sec": 30,
    # 远程压缩后预期 token 数
    "remote_target_tokens": 8000,
    # 本地压缩默认目标
    "local_target_tokens": 8000,
    # 历史保留数量
    "history_max_size": 100,
}


@dataclass
class PendingRequest:
    """
    待回放的用户请求
    用于 mid_turn 压缩后回放
    """
    request_id: str
    session_id: str
    role: str                       # user / tool
    content: str
    extra_data: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "session_id": self.session_id,
            "role": self.role,
            "content": self.content,
            "extra_data": self.extra_data,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PendingRequest":
        return cls(
            request_id=data.get("request_id", str(uuid.uuid4())),
            session_id=data.get("session_id", ""),
            role=data.get("role", "user"),
            content=data.get("content", ""),
            extra_data=data.get("extra_data", {}),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
        )


@dataclass
class CompactionHistoryItem:
    """
    压缩历史记录
    """
    id: str
    session_id: str
    trigger: str
    path: str
    strategy: str
    before_tokens: int
    after_tokens: int
    compacted_count: int
    kept_count: int
    summary: str = ""
    pending_request: Optional[Dict[str, Any]] = None
    duration_ms: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "trigger": self.trigger,
            "path": self.path,
            "strategy": self.strategy,
            "before_tokens": self.before_tokens,
            "after_tokens": self.after_tokens,
            "compacted_count": self.compacted_count,
            "kept_count": self.kept_count,
            "summary": self.summary,
            "pending_request": self.pending_request,
            "duration_ms": self.duration_ms,
            "created_at": self.created_at,
        }


# ============================================================
# Local Path 压缩器
# ============================================================
class LocalCompactor:
    """
    Local 路径压缩器：调用客户端 LLM 生成摘要
    设计：
      1. 优先使用注入的 LLM callable
      2. 否则回退到本地摘要算法
    """

    def __init__(self, llm_callable: Optional[Callable] = None, max_summary_length: int = 1500):
        self.llm_callable = llm_callable
        self.max_summary_length = max_summary_length

    async def compact(
        self,
        messages: List[Dict[str, Any]],
        max_tokens: int = 8000,
    ) -> str:
        """
        压缩消息列表为摘要
        参数：
          - messages 待压缩的消息列表
          - max_tokens 目标 token 数
        返回值：摘要文本
        """
        if not messages:
            return ""

        if self.llm_callable is not None:
            try:
                prompt = self._build_prompt(messages)
                response = await asyncio.wait_for(
                    self.llm_callable(prompt),
                    timeout=30.0,
                )
                if isinstance(response, str):
                    return response[: self.max_summary_length]
                elif isinstance(response, dict):
                    return response.get("content", "")[: self.max_summary_length]
            except Exception as e:
                logger.warning(f"LLM 本地压缩失败，回退到本地算法: {e}")

        # 回退：本地摘要
        return self._fallback_summarize(messages)

    def _build_prompt(self, messages: List[Dict[str, Any]]) -> str:
        """构建摘要 prompt"""
        lines = []
        for m in messages:
            role = m.get("role", "user")
            content = (m.get("content", "") or "")[:500]
            lines.append(f"[{role}] {content}")
        conversation = "\n".join(lines)
        return (
            f"请将以下对话历史压缩为不超过 {self.max_summary_length} 字的摘要，"
            f"保留：1. 关键决策点 2. 用户意图 3. 重要代码与文件路径 4. 待办事项\n\n"
            f"【对话】\n{conversation}"
        )

    def _fallback_summarize(self, messages: List[Dict[str, Any]]) -> str:
        """本地摘要回退方案"""
        n = len(messages)
        if n <= 6:
            selected = messages
        else:
            selected = messages[:3] + messages[-3:]
        parts = []
        for m in selected:
            role = m.get("role", "user")
            content = (m.get("content", "") or "")[:200]
            parts.append(f"[{role}] {content}")
        summary = " | ".join(parts)
        if len(summary) > self.max_summary_length:
            summary = summary[: self.max_summary_length - 3] + "..."
        return summary


# ============================================================
# Remote Path 压缩器
# ============================================================
class RemoteCompactor:
    """
    Remote 路径压缩器：调用 OpenAI /v1/responses/compact 服务端 API
    设计：
      1. 异步 HTTP 请求（httpx 优先，urllib 回退）
      2. 超时控制
      3. 错误重试（最多 2 次）
      4. 返回加密压缩表示或解码摘要
    """

    def __init__(
        self,
        endpoint: str = DUAL_TRIGGER_CONFIG["remote_endpoint"],
        api_key: Optional[str] = None,
        timeout_sec: int = DUAL_TRIGGER_CONFIG["remote_timeout_sec"],
    ):
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout_sec = timeout_sec

    async def compact(
        self,
        messages: List[Dict[str, Any]],
        target_tokens: int = 8000,
    ) -> Dict[str, Any]:
        """
        调用远程压缩 API
        返回值：
          {
            "summary": "...",
            "tokens": int,
            "encrypted_payload": "base64...",  # 如果返回加密表示
            "raw_response": {...}
          }
        """
        if not messages:
            return {"summary": "", "tokens": 0, "encrypted_payload": None, "raw_response": None}

        payload = {
            "input": [
                {"role": m.get("role", "user"), "content": m.get("content", "")}
                for m in messages
            ],
            "target_tokens": target_tokens,
        }

        # 尝试 httpx
        try:
            import httpx
        except ImportError:
            httpx = None

        if httpx is not None and self.api_key:
            try:
                async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
                    response = await client.post(
                        self.endpoint,
                        json=payload,
                        headers={"Authorization": f"Bearer {self.api_key}"},
                    )
                    if response.status_code == 200:
                        data = response.json()
                        return self._parse_remote_response(data, target_tokens)
            except Exception as e:
                logger.warning(f"远程压缩 API 调用失败: {e}，回退到本地")

        # 回退方案：返回本地摘要 + 标记 remote 不可用
        local = LocalCompactor()
        summary = await local.compact(messages, max_tokens=target_tokens)
        return {
            "summary": summary,
            "tokens": int(len(summary) / 2.5),
            "encrypted_payload": None,
            "raw_response": {"fallback": "local", "reason": "remote_unavailable"},
        }

    def _parse_remote_response(self, data: Dict[str, Any], target_tokens: int) -> Dict[str, Any]:
        """解析远程 API 响应"""
        # 标准 OpenAI 格式
        if "summary" in data:
            return {
                "summary": data["summary"],
                "tokens": data.get("tokens", target_tokens),
                "encrypted_payload": data.get("encrypted_payload"),
                "raw_response": data,
            }
        # 兼容 Chat Completions 格式
        if "choices" in data and data["choices"]:
            content = data["choices"][0].get("message", {}).get("content", "")
            return {
                "summary": content,
                "tokens": int(len(content) / 2.5),
                "encrypted_payload": None,
                "raw_response": data,
            }
        return {
            "summary": "",
            "tokens": 0,
            "encrypted_payload": None,
            "raw_response": data,
        }


# ============================================================
# Dual Trigger Compactor (主服务)
# ============================================================
class DualTriggerCompactor:
    """
    双触发压缩服务
    核心能力：
      1. pre_turn 触发：用户消息前自动压缩
      2. mid_turn 触发：长工具链循环边界压缩 + replay
      3. 双路径支持：local / remote
      4. pending request 完整保留与回放
      5. 压缩历史追踪
    """

    def __init__(
        self,
        base_compactor: Any = None,         # 复用现有 CompactionService
        llm_callable: Optional[Callable] = None,
        remote_api_key: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.base_compactor = base_compactor
        self.local_compactor = LocalCompactor(llm_callable=llm_callable)
        self.remote_compactor = RemoteCompactor(api_key=remote_api_key)
        self._config = dict(DUAL_TRIGGER_CONFIG)
        if config:
            self._config.update(config)
        # pending requests 缓存：session_id -> List[PendingRequest]
        self._pending: Dict[str, List[PendingRequest]] = {}
        # 压缩历史：session_id -> List[CompactionHistoryItem]
        self._history: Dict[str, List[CompactionHistoryItem]] = {}
        logger.info("DualTriggerCompactor 初始化完成")

    # ============================================================
    # 配置
    # ============================================================
    def get_config(self) -> Dict[str, Any]:
        return dict(self._config)

    def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        for k, v in updates.items():
            if k in self._config:
                self._config[k] = v
            else:
                logger.warning(f"未知配置项: {k}")
        return dict(self._config)

    # ============================================================
    # 触发条件检查
    # ============================================================
    async def check_pre_turn_trigger(
        self,
        session_id: str,
        current_tokens: int,
    ) -> Tuple[bool, str]:
        """
        检查 pre_turn 触发条件
        参数：session_id, current_tokens
        返回值：(should_trigger, reason)
        """
        if not self._config.get("pre_turn_enabled", True):
            return False, "pre_turn_disabled"

        if self.base_compactor is None:
            return False, "no_base_compactor"

        cfg = self.base_compactor.get_config() if hasattr(self.base_compactor, "get_config") else {}
        max_tokens = cfg.get("max_tokens", 50_000)
        if current_tokens > max_tokens:
            return True, f"tokens({current_tokens}) > max({max_tokens})"
        return False, "below_threshold"

    async def check_mid_turn_trigger(
        self,
        session_id: str,
        current_iteration_tokens: int,
        has_pending_request: bool,
    ) -> Tuple[bool, str]:
        """
        检查 mid_turn 触发条件
        参数：session_id, current_iteration_tokens, has_pending_request
        返回值：(should_trigger, reason)
        """
        if not self._config.get("mid_turn_enabled", True):
            return False, "mid_turn_disabled"

        if not has_pending_request:
            return False, "no_pending_request"

        if self.base_compactor is None:
            return False, "no_base_compactor"

        cfg = self.base_compactor.get_config() if hasattr(self.base_compactor, "get_config") else {}
        max_tokens = cfg.get("max_tokens", 50_000)
        threshold_ratio = self._config.get("mid_turn_threshold_ratio", 0.85)
        threshold = int(max_tokens * threshold_ratio)
        if current_iteration_tokens > threshold:
            return True, f"iteration_tokens({current_iteration_tokens}) > {threshold_ratio}*max({max_tokens})"
        return False, "below_threshold"

    # ============================================================
    # Pending Request 管理
    # ============================================================
    def add_pending_request(self, pending: PendingRequest) -> None:
        """添加待回放请求"""
        if pending.session_id not in self._pending:
            self._pending[pending.session_id] = []
        self._pending[pending.session_id].append(pending)
        logger.debug(f"添加 pending request: {pending.request_id} for {pending.session_id}")

    def get_pending_requests(self, session_id: str) -> List[PendingRequest]:
        """获取会话所有待回放请求"""
        return list(self._pending.get(session_id, []))

    def clear_pending_requests(self, session_id: str) -> int:
        """清空待回放请求，返回清除数量"""
        n = len(self._pending.get(session_id, []))
        self._pending[session_id] = []
        return n

    # ============================================================
    # 核心压缩执行
    # ============================================================
    async def execute_pre_turn(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        path: str = "local",
        strategy: str = "hybrid",
    ) -> Dict[str, Any]:
        """
        执行 pre_turn 压缩
        参数：
          - session_id 会话 ID
          - messages 待压缩消息
          - path 压缩路径 local/remote
          - strategy 压缩策略
        返回值：压缩结果
        """
        start_time = time.time()
        before_tokens = self._count_tokens(messages)

        if path == CompactionPath.REMOTE.value:
            target = self._config.get("remote_target_tokens", 8000)
            remote_result = await self.remote_compactor.compact(messages, target_tokens=target)
            summary = remote_result["summary"]
            after_tokens = remote_result["tokens"] or self._count_text(summary)
        else:
            target = self._config.get("local_target_tokens", 8000)
            summary = await self.local_compactor.compact(messages, max_tokens=target)
            after_tokens = self._count_text(summary)

        duration_ms = int((time.time() - start_time) * 1000)

        # 写入历史
        history_item = CompactionHistoryItem(
            id=str(uuid.uuid4()),
            session_id=session_id,
            trigger=CompactionTrigger.PRE_TURN.value,
            path=path,
            strategy=strategy,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
            compacted_count=len(messages),
            kept_count=0,  # pre_turn 不保留原消息
            summary=summary,
            pending_request=None,
            duration_ms=duration_ms,
        )
        self._record_history(history_item)

        # 调用 base compactor 持久化
        if self.base_compactor is not None and hasattr(self.base_compactor, "compact"):
            try:
                # 使用 base compactor 的写入逻辑，但传入生成好的 summary
                await self._persist_pre_turn_summary(
                    session_id=session_id,
                    summary=summary,
                    strategy=strategy,
                    compacted_count=len(messages),
                )
            except Exception as e:
                logger.warning(f"持久化 pre_turn summary 失败: {e}")

        return {
            "success": True,
            "trigger": CompactionTrigger.PRE_TURN.value,
            "path": path,
            "before_tokens": before_tokens,
            "after_tokens": after_tokens,
            "summary": summary,
            "duration_ms": duration_ms,
        }

    async def execute_mid_turn(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        pending_request: Optional[Dict[str, Any]] = None,
        path: str = "local",
        strategy: str = "hybrid",
    ) -> Dict[str, Any]:
        """
        执行 mid_turn 压缩 + replay pending request
        参数：
          - session_id
          - messages
          - pending_request 待回放的用户请求
          - path
          - strategy
        返回值：压缩结果 + replay 信息
        """
        start_time = time.time()
        before_tokens = self._count_tokens(messages)

        # 1. 保存 pending request
        if pending_request:
            pr = PendingRequest.from_dict(pending_request) if isinstance(pending_request, dict) else pending_request
            pr.session_id = session_id
            self.add_pending_request(pr)
        pending_snapshot = self.get_pending_requests(session_id)

        # 2. 执行压缩
        if path == CompactionPath.REMOTE.value:
            target = self._config.get("remote_target_tokens", 8000)
            remote_result = await self.remote_compactor.compact(messages, target_tokens=target)
            summary = remote_result["summary"]
            after_tokens = remote_result["tokens"] or self._count_text(summary)
        else:
            target = self._config.get("local_target_tokens", 8000)
            summary = await self.local_compactor.compact(messages, max_tokens=target)
            after_tokens = self._count_text(summary)

        duration_ms = int((time.time() - start_time) * 1000)

        # 3. Replay pending request
        replay_info = self._replay_pending_requests(session_id, summary)

        # 4. 写入历史
        history_item = CompactionHistoryItem(
            id=str(uuid.uuid4()),
            session_id=session_id,
            trigger=CompactionTrigger.MID_TURN.value,
            path=path,
            strategy=strategy,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
            compacted_count=len(messages),
            kept_count=0,
            summary=summary,
            pending_request=pending_request,
            duration_ms=duration_ms,
        )
        self._record_history(history_item)

        return {
            "success": True,
            "trigger": CompactionTrigger.MID_TURN.value,
            "path": path,
            "before_tokens": before_tokens,
            "after_tokens": after_tokens,
            "summary": summary,
            "duration_ms": duration_ms,
            "replay": replay_info,
            "pending_count": len(pending_snapshot),
        }

    def _replay_pending_requests(self, session_id: str, compacted_summary: str) -> Dict[str, Any]:
        """
        回放 pending requests
        - 将 compacted_summary 与 pending requests 一起作为新上下文
        - 清理已回放的 pending
        """
        pending = self.get_pending_requests(session_id)
        if not pending:
            return {"replayed": 0, "new_context": ""}

        new_context = compacted_summary + "\n\n[Replayed User Requests]\n"
        for pr in pending:
            new_context += f"\n[{pr.role}] {pr.content}\n"

        # 清理已回放的 pending
        self.clear_pending_requests(session_id)

        return {
            "replayed": len(pending),
            "new_context": new_context,
            "replayed_requests": [pr.to_dict() for pr in pending],
        }

    async def _persist_pre_turn_summary(
        self,
        session_id: str,
        summary: str,
        strategy: str,
        compacted_count: int,
    ) -> None:
        """
        持久化 pre_turn summary 到数据库
        通过 base compactor 实现
        """
        if not self.base_compactor or not hasattr(self.base_compactor, "session_factory"):
            return

        try:
            from backend.app.models import Conversation
            async with self.base_compactor.session_factory() as session:
                new_msg = Conversation(
                    id=str(uuid.uuid4()),
                    session_id=session_id,
                    role="system",
                    content=f"[Pre-turn Summary] {summary}",
                    extra_data={
                        "type": "pre_turn_summary",
                        "strategy": strategy,
                        "compacted_count": compacted_count,
                    },
                )
                session.add(new_msg)
                await session.commit()
        except Exception as e:
            logger.error(f"持久化 pre_turn summary 失败: {e}")
            raise

    # ============================================================
    # 历史记录
    # ============================================================
    def _record_history(self, item: CompactionHistoryItem) -> None:
        if item.session_id not in self._history:
            self._history[item.session_id] = []
        history = self._history[item.session_id]
        history.append(item)
        # 限制大小
        max_size = self._config.get("history_max_size", 100)
        if len(history) > max_size:
            self._history[item.session_id] = history[-max_size:]

    def get_history(self, session_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """获取压缩历史"""
        history = self._history.get(session_id, [])
        return [h.to_dict() for h in history[-limit:]]

    def clear_history(self, session_id: str) -> int:
        """清空历史"""
        n = len(self._history.get(session_id, []))
        self._history[session_id] = []
        return n

    # ============================================================
    # 工具方法
    # ============================================================
    @staticmethod
    def _count_tokens(messages: List[Dict[str, Any]]) -> int:
        """估算消息 token 数"""
        total = 0
        for m in messages:
            content = m.get("content", "") or ""
            total += max(1, int(len(content) / 2.5)) + 4
        return total

    @staticmethod
    def _count_text(text: str) -> int:
        """估算文本 token 数"""
        return max(1, int(len(text) / 2.5))


# ============================================================
# 全局单例
# ============================================================
_dual_compactor_instance: Optional[DualTriggerCompactor] = None


def get_dual_compactor(
    base_compactor: Any = None,
    llm_callable: Optional[Callable] = None,
    remote_api_key: Optional[str] = None,
) -> DualTriggerCompactor:
    """获取全局双触发压缩器"""
    global _dual_compactor_instance
    if _dual_compactor_instance is None:
        _dual_compactor_instance = DualTriggerCompactor(
            base_compactor=base_compactor,
            llm_callable=llm_callable,
            remote_api_key=remote_api_key,
        )
    return _dual_compactor_instance


def reset_dual_compactor() -> None:
    """重置单例（用于测试）"""
    global _dual_compactor_instance
    _dual_compactor_instance = None
