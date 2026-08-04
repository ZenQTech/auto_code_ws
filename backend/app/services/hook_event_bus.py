"""
# ============================================================
# Agent Hook Event Bus (v1.0.0)
# Cycle 64 G64-01
# ============================================================
# 核心作用：Hook 事件总线，支持发布/订阅模式
#           事件类型：SubagentStart / SubagentStop / PreToolUse / PostToolUse
#                    Progress / Output / Error / Cancelled
# 运行流程：
#   1. AgentRunner 在执行中调用 publish() 发送事件
#   2. WebSocket 端点订阅 agent_id
#   3. SSE/REST 端点也通过 subscribe 接收
# 输入参数：HookEvent
# 输出结果：分发到所有订阅者
# 对标：Codex v0.133 SubagentStart Hook 机制
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 64 G64-01 初次创建
# ====================================
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Set

from .agent_role_models import HookEvent, HookEventType

logger = logging.getLogger(__name__)


# ============================================================
# 回调类型
# ============================================================


HookCallback = Callable[[HookEvent], Awaitable[None]]


# ============================================================
# 事件总线
# ============================================================


class HookEventBus:
    """
    Hook 事件总线
    - publish 发送事件（同步/异步）
    - subscribe 订阅 agent 的事件
    - get_history 获取历史事件
    """

    def __init__(self, max_history_per_agent: int = 1000):
        self._subscribers: Dict[str, List[HookCallback]] = defaultdict(list)
        # agent_id -> 事件历史（最近 N 条）
        self._history: Dict[str, Deque[HookEvent]] = defaultdict(
            lambda: deque(maxlen=max_history_per_agent)
        )
        # 全局订阅者（接收所有事件）
        self._global_subscribers: List[HookCallback] = []
        # 锁
        self._lock = asyncio.Lock()

    async def publish(
        self,
        agent_id: str,
        event_type: HookEventType,
        data: Optional[Dict[str, Any]] = None,
        parent_event_id: Optional[str] = None,
    ) -> HookEvent:
        """
        发布事件
        返回创建的 HookEvent
        """
        event = HookEvent(
            event_id=f"evt-{uuid.uuid4().hex[:12]}",
            agent_id=agent_id,
            event_type=event_type,
            timestamp=time.time(),
            data=data or {},
            parent_event_id=parent_event_id,
        )
        # 存入历史
        self._history[agent_id].append(event)
        # 派发给订阅者
        await self._dispatch(event)
        return event

    async def _dispatch(self, event: HookEvent) -> None:
        """派发事件到订阅者"""
        # 特定 agent 订阅者
        agent_callbacks = list(self._subscribers.get(event.agent_id, []))
        for cb in agent_callbacks:
            try:
                await cb(event)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"Hook 订阅者回调失败 (agent={event.agent_id}): {e}",
                    exc_info=True,
                )
        # 全局订阅者
        for cb in list(self._global_subscribers):
            try:
                await cb(event)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Hook 全局订阅者回调失败: {e}", exc_info=True)

    def subscribe(self, agent_id: str, callback: HookCallback) -> str:
        """
        订阅 agent 事件
        返回 subscription_id（用于取消订阅）
        """
        sub_id = f"sub-{uuid.uuid4().hex[:8]}"
        # 使用 sub_id 标记闭包以便取消
        self._subscribers[agent_id].append(callback)
        # 简单实现：返回 id，unsubscribe 时按位置移除
        return sub_id

    def subscribe_global(self, callback: HookCallback) -> str:
        """订阅所有 agent 事件"""
        sub_id = f"gsub-{uuid.uuid4().hex[:8]}"
        self._global_subscribers.append(callback)
        return sub_id

    def unsubscribe(self, agent_id: str, sub_id: str) -> None:
        """取消订阅（简化实现）"""
        if agent_id in self._subscribers and self._subscribers[agent_id]:
            self._subscribers[agent_id].pop()

    def get_history(
        self, agent_id: str, limit: int = 100
    ) -> List[HookEvent]:
        """获取 agent 历史事件"""
        events = list(self._history.get(agent_id, deque()))
        return events[-limit:]

    def clear_history(self, agent_id: str) -> None:
        """清空 agent 历史"""
        if agent_id in self._history:
            self._history[agent_id].clear()

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        return {
            "total_agents": len(self._history),
            "total_subscribers": sum(len(s) for s in self._subscribers.values()),
            "global_subscribers": len(self._global_subscribers),
            "total_events": sum(len(h) for h in self._history.values()),
        }


# ============================================================
# 全局单例
# ============================================================


_hook_bus: Optional[HookEventBus] = None


def get_hook_bus() -> HookEventBus:
    """获取全局 Hook 事件总线（单例）"""
    global _hook_bus
    if _hook_bus is None:
        _hook_bus = HookEventBus()
    return _hook_bus


def reset_hook_bus() -> None:
    """重置全局 Hook 事件总线（用于测试）"""
    global _hook_bus
    _hook_bus = None
