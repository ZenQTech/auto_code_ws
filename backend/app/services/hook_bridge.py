"""
# ============================================================
# Hook Bridge 服务 (v1.0.0) - Cycle 5 P0-6 Hook 事件深度集成
# ============================================================
# 核心作用：在关键业务流程点自动触发 Hook 事件
#           仿照 Codex v0.150+ Lifecycle Hooks 设计
# 运行流程：
#   1. 提供 10 个 fire_* 方法，对应 10 种 HookEventType
#   2. 每个方法从 HooksRegistry 获取匹配 hook 并执行
#   3. 返回 actions 列表 + 提取的 additionalContext / permissionDecision
#   4. 异常隔离：所有 hook 错误都不应阻塞主流程
#   5. 链路记录：所有 fire 调用记录到 HookChainStore（即使无 hook 匹配）
# 输入参数：见各 fire_* 方法
# 输出结果：List[HookAction] 或 Tuple[List[HookAction], str]
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 5 P0-6 新建 - 集成 hooks 到业务流程
# ============================================================
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.app.services.hooks_registry import (
    HookAction,
    HooksRegistry,
    get_hooks_registry,
)

logger = logging.getLogger(__name__)


# ============================================================
# HookChainEntry - Hook 触发链路条目
# ============================================================
@dataclass
class HookChainEntry:
    """
    Hook 触发链路条目（用于前端可视化）

    字段：
      - id: 唯一 ID
      - event: 事件类型
      - session_id: 关联 session
      - agent_id: 关联 agent（可选）
      - hook_name: hook 名称
      - exit_code: 退出码
      - duration_ms: 耗时
      - additional_context: 注入的额外上下文
      - permission_decision: 权限决策
      - timestamp: 触发时间戳
      - is_blocking: 是否阻塞
    """
    id: str
    event: str
    session_id: Optional[str]
    agent_id: Optional[str]
    hook_name: str
    exit_code: int
    duration_ms: float
    additional_context: Optional[str] = None
    permission_decision: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    is_blocking: bool = False
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "event": self.event,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "hook_name": self.hook_name,
            "exit_code": self.exit_code,
            "duration_ms": round(self.duration_ms, 2),
            "additional_context": self.additional_context,
            "permission_decision": self.permission_decision,
            "timestamp": self.timestamp,
            "is_blocking": self.is_blocking,
            "error": self.error,
        }


# ============================================================
# HookChainStore - Hook 链路存储（最近 N 条）
# ============================================================
class HookChainStore:
    """
    Hook 触发链路存储（FIFO，最近 200 条）

    用于：
      - 前端实时展示最近 hook 触发
      - 调试和审计
    """

    def __init__(self, max_size: int = 200):
        self._entries: List[HookChainEntry] = []
        self._max_size = max_size
        self._lock = asyncio.Lock()

    async def add(self, entry: HookChainEntry) -> None:
        async with self._lock:
            self._entries.append(entry)
            if len(self._entries) > self._max_size:
                self._entries = self._entries[-self._max_size:]

    async def get_recent(
        self,
        limit: int = 50,
        session_id: Optional[str] = None,
        event: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        async with self._lock:
            items = self._entries
            if session_id:
                items = [e for e in items if e.session_id == session_id]
            if event:
                items = [e for e in items if e.event == event]
            items = items[-limit:]
            return [e.to_dict() for e in items]

    async def get_summary(self) -> Dict[str, Any]:
        async with self._lock:
            events_count: Dict[str, int] = {}
            blocking_count = 0
            context_injection_count = 0
            permission_override_count = 0
            for e in self._entries:
                events_count[e.event] = events_count.get(e.event, 0) + 1
                if e.is_blocking:
                    blocking_count += 1
                if e.additional_context:
                    context_injection_count += 1
                if e.permission_decision:
                    permission_override_count += 1
            return {
                "total": len(self._entries),
                "events_count": events_count,
                "blocking_count": blocking_count,
                "context_injection_count": context_injection_count,
                "permission_override_count": permission_override_count,
            }

    def clear(self) -> None:
        self._entries.clear()


# ============================================================
# HookBridgeService - 业务集成层
# ============================================================
class HookBridgeService:
    """
    Hook 业务集成服务

    提供 10 个 fire_* 方法，在业务关键点调用：
      - SessionStart / SessionEnd
      - UserPromptSubmit
      - PreToolUse / PostToolUse
      - PermissionRequest
      - PreCompact / PostCompact
      - SubagentStart / SubagentStop

    所有方法都是异常隔离的：hook 失败不会影响主流程
    """

    def __init__(self, registry: Optional[HooksRegistry] = None):
        self._registry = registry or get_hooks_registry()
        self._chain_store = HookChainStore(max_size=200)
        self._entry_counter = 0

    def _next_id(self) -> str:
        self._entry_counter += 1
        return f"hook-{int(time.time() * 1000)}-{self._entry_counter}"

    async def _record_chain(
        self,
        event: str,
        session_id: Optional[str],
        agent_id: Optional[str],
        actions: List[HookAction],
    ) -> None:
        """记录所有 action 到 chain store（v1.0.0 Cycle 5 P0-6）

        如果 actions 为空（无 hook 触发），仍记录一条 NO_HOOK 条目
        以便前端能看到所有 fire 调用
        """
        if not actions:
            # 记录一条无 hook 触发的条目
            entry = HookChainEntry(
                id=self._next_id(),
                event=event,
                session_id=session_id,
                agent_id=agent_id,
                hook_name="(no hook matched)",
                exit_code=0,
                duration_ms=0.0,
            )
            await self._chain_store.add(entry)
            return

        for action in actions:
            entry = HookChainEntry(
                id=self._next_id(),
                event=event,
                session_id=session_id,
                agent_id=agent_id,
                hook_name=getattr(action, "hook_name", "unknown") or "unknown",
                exit_code=action.exit_code,
                duration_ms=action.duration_ms,
                additional_context=action.additional_context,
                permission_decision=action.permission_decision,
                is_blocking=action.is_blocking,
                error=action.error,
            )
            await self._chain_store.add(entry)

    @staticmethod
    def _collect_additional_context(actions: List[HookAction]) -> str:
        """收集所有 action 的 additionalContext，合并为单个字符串"""
        contexts = []
        for a in actions:
            if a.additional_context and a.is_success:
                contexts.append(a.additional_context)
        return "\n".join(contexts)

    @staticmethod
    def _collect_permission_decision(actions: List[HookAction]) -> Optional[str]:
        """从 actions 中提取 permissionDecision（最后一个非空值）"""
        decision = None
        for a in actions:
            if a.permission_decision and a.is_success:
                decision = a.permission_decision
        return decision

    @property
    def chain_store(self) -> HookChainStore:
        return self._chain_store

    # ============================================================
    # 1. SessionStart
    # ============================================================
    async def fire_session_start(
        self, session_id: str, user_id: Optional[str] = None
    ) -> List[HookAction]:
        """触发 SessionStart 事件"""
        payload = {"session_id": session_id, "user_id": user_id or "anonymous"}
        try:
            actions = await self._registry.dispatch("SessionStart", payload)
            await self._record_chain("SessionStart", session_id, None, actions)
            return actions
        except Exception as e:
            logger.error(f"SessionStart hook 触发失败: {e}")
            return []

    # ============================================================
    # 2. UserPromptSubmit
    # ============================================================
    async def fire_user_prompt_submit(
        self, user_input: str, session_id: Optional[str] = None
    ) -> Tuple[List[HookAction], str]:
        """
        触发 UserPromptSubmit 事件

        返回值：(actions, additional_context)
        """
        payload = {"user_input": user_input, "session_id": session_id or "unknown"}
        try:
            actions = await self._registry.dispatch("UserPromptSubmit", payload)
            await self._record_chain("UserPromptSubmit", session_id, None, actions)
            additional_ctx = self._collect_additional_context(actions)
            return actions, additional_ctx
        except Exception as e:
            logger.error(f"UserPromptSubmit hook 触发失败: {e}")
            return [], ""

    # ============================================================
    # 3. PreToolUse
    # ============================================================
    async def fire_pre_tool_use(
        self, tool_name: str, arguments: Dict[str, Any], agent_id: Optional[str] = None
    ) -> Tuple[List[HookAction], str]:
        """
        触发 PreToolUse 事件

        返回值：(actions, additional_context)
        """
        payload = {"tool_name": tool_name, "arguments": arguments}
        try:
            actions = await self._registry.dispatch("PreToolUse", payload)
            await self._record_chain("PreToolUse", None, agent_id, actions)
            additional_ctx = self._collect_additional_context(actions)
            return actions, additional_ctx
        except Exception as e:
            logger.error(f"PreToolUse hook 触发失败: {e}")
            return [], ""

    # ============================================================
    # 4. PostToolUse
    # ============================================================
    async def fire_post_tool_use(
        self,
        tool_name: str,
        result: Any,
        duration_ms: float = 0.0,
        agent_id: Optional[str] = None,
    ) -> List[HookAction]:
        """触发 PostToolUse 事件"""
        payload = {
            "tool_name": tool_name,
            "result": str(result)[:1000] if result is not None else "",
            "duration_ms": duration_ms,
        }
        try:
            actions = await self._registry.dispatch("PostToolUse", payload)
            await self._record_chain("PostToolUse", None, agent_id, actions)
            return actions
        except Exception as e:
            logger.error(f"PostToolUse hook 触发失败: {e}")
            return []

    # ============================================================
    # 5. PermissionRequest
    # ============================================================
    async def fire_permission_request(
        self, tool_name: str, arguments: Dict[str, Any], agent_id: Optional[str] = None
    ) -> Tuple[List[HookAction], Optional[str]]:
        """
        触发 PermissionRequest 事件

        返回值：(actions, permission_decision)
          - permission_decision: "allow" / "deny" / "ask" / None
        """
        payload = {"tool_name": tool_name, "arguments": arguments}
        try:
            actions = await self._registry.dispatch("PermissionRequest", payload)
            await self._record_chain("PermissionRequest", None, agent_id, actions)
            decision = self._collect_permission_decision(actions)
            return actions, decision
        except Exception as e:
            logger.error(f"PermissionRequest hook 触发失败: {e}")
            return [], None

    # ============================================================
    # 6. PreCompact
    # ============================================================
    async def fire_pre_compact(
        self, trigger: str, context_size: int, session_id: Optional[str] = None
    ) -> List[HookAction]:
        """触发 PreCompact 事件"""
        payload = {"trigger": trigger, "context_size": context_size}
        try:
            actions = await self._registry.dispatch("PreCompact", payload)
            await self._record_chain("PreCompact", session_id, None, actions)
            return actions
        except Exception as e:
            logger.error(f"PreCompact hook 触发失败: {e}")
            return []

    # ============================================================
    # 7. PostCompact
    # ============================================================
    async def fire_post_compact(
        self,
        original_size: int,
        new_size: int,
        session_id: Optional[str] = None,
    ) -> List[HookAction]:
        """触发 PostCompact 事件"""
        payload = {"original_size": original_size, "new_size": new_size}
        try:
            actions = await self._registry.dispatch("PostCompact", payload)
            await self._record_chain("PostCompact", session_id, None, actions)
            return actions
        except Exception as e:
            logger.error(f"PostCompact hook 触发失败: {e}")
            return []

    # ============================================================
    # 8. SubagentStart
    # ============================================================
    async def fire_subagent_start(
        self, subagent_id: str, task: str
    ) -> List[HookAction]:
        """触发 SubagentStart 事件"""
        payload = {"subagent_id": subagent_id, "task": task}
        try:
            actions = await self._registry.dispatch("SubagentStart", payload)
            await self._record_chain("SubagentStart", None, subagent_id, actions)
            return actions
        except Exception as e:
            logger.error(f"SubagentStart hook 触发失败: {e}")
            return []

    # ============================================================
    # 9. SubagentStop
    # ============================================================
    async def fire_subagent_stop(
        self, subagent_id: str, result: str
    ) -> List[HookAction]:
        """触发 SubagentStop 事件"""
        payload = {"subagent_id": subagent_id, "result": result[:500]}
        try:
            actions = await self._registry.dispatch("SubagentStop", payload)
            await self._record_chain("SubagentStop", None, subagent_id, actions)
            return actions
        except Exception as e:
            logger.error(f"SubagentStop hook 触发失败: {e}")
            return []

    # ============================================================
    # 10. SessionEnd
    # ============================================================
    async def fire_session_end(
        self, session_id: str, duration_ms: float = 0.0
    ) -> List[HookAction]:
        """触发 SessionEnd 事件"""
        payload = {"session_id": session_id, "duration_ms": duration_ms}
        try:
            actions = await self._registry.dispatch("SessionEnd", payload)
            await self._record_chain("SessionEnd", session_id, None, actions)
            return actions
        except Exception as e:
            logger.error(f"SessionEnd hook 触发失败: {e}")
            return []


# ============================================================
# 全局单例
# ============================================================
_bridge_instance: Optional[HookBridgeService] = None


def get_hook_bridge() -> HookBridgeService:
    """获取全局 HookBridgeService 实例（单例）"""
    global _bridge_instance
    if _bridge_instance is None:
        _bridge_instance = HookBridgeService()
    return _bridge_instance


def reset_hook_bridge() -> None:
    """重置全局实例（用于测试）"""
    global _bridge_instance
    _bridge_instance = None
