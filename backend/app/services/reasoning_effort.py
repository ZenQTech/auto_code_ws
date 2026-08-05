"""
# ============================================================
# ReasoningEffort Controller (v1.0.0)
# Cycle 66 G66-01
# ============================================================
# 核心作用：管理 Agent 实例的 reasoning effort（low/medium/high）
# 运行时切换（对标 Codex CLI model_reasoning_effort）
# 运行流程：
#   1. 通过 set_effort(agent_id, effort) 切换
#   2. 校验 effort 合法性（必须在 low/medium/high 范围内）
#   3. 更新 AgentInstance.reasoning_effort
#   4. 记录到 history（最多 50 条 LRU）
#   5. 通知订阅者（通过 callback 机制）
# 设计要点：
#   - O(1) 等级切换算法
#   - 状态完全在内存（无持久化）
#   - 单例模式（与 AgentRoleManager 一致）
#   - 错误隔离（切换失败不影响原任务）
# 输入参数：agent_id, effort, source
# 输出结果：更新后的 AgentInstance
# 对标：Codex CLI v0.121+ model_reasoning_effort
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-01 初次创建
# ====================================
"""

import logging
import time
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与常量
# ============================================================


class ReasoningEffort(str, Enum):
    """Reasoning effort 等级（对标 Codex CLI model_reasoning_effort）"""

    LOW = "low"          # 最快，样板代码/格式化
    MEDIUM = "medium"    # 默认，交互式编码
    HIGH = "high"        # 最慢，复杂架构/深度分析

    @classmethod
    def order(cls) -> List[str]:
        """返回等级顺序（low → medium → high）"""
        return [e.value for e in cls]

    @classmethod
    def is_valid(cls, value: str) -> bool:
        """检查 effort 值是否合法"""
        return value in cls.order()

    @classmethod
    def next(cls, current: str) -> str:
        """
        循环到下一档
        low → medium → high → low
        """
        order = cls.order()
        idx = order.index(current)
        return order[(idx + 1) % len(order)]

    @classmethod
    def previous(cls, current: str) -> str:
        """循环到上一档"""
        order = cls.order()
        idx = order.index(current)
        return order[(idx - 1) % len(order)]


# 默认 effort
DEFAULT_EFFORT = ReasoningEffort.MEDIUM.value

# 历史记录最大条数（LRU）
MAX_HISTORY = 50


# ============================================================
# 异常
# ============================================================


class ReasoningEffortError(Exception):
    """Reasoning effort 切换错误"""
    pass


class InvalidEffortError(ReasoningEffortError):
    """无效的 effort 值"""
    pass


class AgentNotFoundForEffortError(ReasoningEffortError):
    """agent 不存在"""
    pass


# ============================================================
# 数据类
# ============================================================


class ReasoningChange:
    """单次 effort 变更记录"""

    def __init__(
        self,
        effort: str,
        previous_effort: str,
        timestamp: float,
        source: str = "user",
    ):
        self.effort = effort
        self.previous_effort = previous_effort
        self.timestamp = timestamp
        self.source = source

    def to_dict(self) -> Dict[str, Any]:
        return {
            "effort": self.effort,
            "previous_effort": self.previous_effort,
            "timestamp": self.timestamp,
            "source": self.source,
        }


# ============================================================
# Controller
# ============================================================


class ReasoningEffortController:
    """
    Reasoning Effort Controller
    管理 agent 实例的 reasoning effort 状态
    """

    def __init__(self) -> None:
        # agent_id -> 当前 effort
        self._efforts: Dict[str, str] = {}
        # agent_id -> 历史记录（最多 50 条，LRU）
        self._history: Dict[str, List[ReasoningChange]] = {}
        # agent_id -> 上次更新时间
        self._updated_at: Dict[str, float] = {}
        # 订阅者列表：agent_id -> List[callback]
        self._subscribers: Dict[str, List[Callable]] = {}
        # 全局订阅者
        self._global_subscribers: List[Callable] = []
        # 统计
        self._total_changes: int = 0

    # ============================================================
    # 核心 API
    # ============================================================

    def set_effort(
        self,
        agent_id: str,
        effort: str,
        source: str = "user",
    ) -> Dict[str, Any]:
        """
        设置 agent 的 reasoning effort
        返回: {success, agent_id, effort, previous_effort, updated_at, applied_immediately}
        """
        if not ReasoningEffort.is_valid(effort):
            raise InvalidEffortError(
                f"无效的 effort: {effort!r}。必须是 {ReasoningEffort.order()} 之一"
            )
        if not agent_id:
            raise AgentNotFoundForEffortError("agent_id 不能为空")

        previous = self._efforts.get(agent_id, DEFAULT_EFFORT)
        now = time.time()

        # 如果相同 effort，跳过
        if previous == effort:
            logger.debug(
                f"Reasoning effort 无变化: agent_id={agent_id}, effort={effort}"
            )
            return {
                "success": True,
                "agent_id": agent_id,
                "effort": effort,
                "previous_effort": previous,
                "updated_at": self._updated_at.get(agent_id, 0.0),
                "applied_immediately": True,
                "unchanged": True,
            }

        # 更新状态
        self._efforts[agent_id] = effort
        self._updated_at[agent_id] = now

        # 记录历史
        change = ReasoningChange(
            effort=effort,
            previous_effort=previous,
            timestamp=now,
            source=source,
        )
        history = self._history.setdefault(agent_id, [])
        history.append(change)
        # LRU 淘汰
        if len(history) > MAX_HISTORY:
            self._history[agent_id] = history[-MAX_HISTORY:]

        self._total_changes += 1

        # 通知订阅者
        self._notify(agent_id, change)

        logger.info(
            f"Reasoning effort 切换: agent_id={agent_id}, "
            f"{previous} → {effort}, source={source}"
        )

        return {
            "success": True,
            "agent_id": agent_id,
            "effort": effort,
            "previous_effort": previous,
            "updated_at": now,
            "applied_immediately": True,
        }

    def get_effort(self, agent_id: str) -> str:
        """获取 agent 当前 effort（不存在则返回默认值）"""
        return self._efforts.get(agent_id, DEFAULT_EFFORT)

    def get_history(
        self,
        agent_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """获取 agent 的 effort 变更历史（最近 limit 条）"""
        history = self._history.get(agent_id, [])
        # 按时间倒序
        return [h.to_dict() for h in reversed(history[-limit:])]

    def get_state(self, agent_id: str) -> Dict[str, Any]:
        """获取完整状态"""
        return {
            "agent_id": agent_id,
            "effort": self.get_effort(agent_id),
            "updated_at": self._updated_at.get(agent_id, 0.0),
            "default_effort": DEFAULT_EFFORT,
        }

    # ============================================================
    # 订阅机制
    # ============================================================

    def subscribe(
        self,
        agent_id: str,
        callback: Callable,
    ) -> Callable:
        """
        订阅 agent 的 effort 变更
        callback signature: callback(agent_id: str, change: ReasoningChange)
        返回取消订阅的函数
        """
        subs = self._subscribers.setdefault(agent_id, [])
        subs.append(callback)

        def unsubscribe() -> None:
            if agent_id in self._subscribers:
                try:
                    self._subscribers[agent_id].remove(callback)
                except ValueError:
                    pass

        return unsubscribe

    def subscribe_global(self, callback: Callable) -> Callable:
        """订阅所有 agent 的 effort 变更"""
        self._global_subscribers.append(callback)

        def unsubscribe() -> None:
            try:
                self._global_subscribers.remove(callback)
            except ValueError:
                pass

        return unsubscribe

    def _notify(self, agent_id: str, change: ReasoningChange) -> None:
        """通知订阅者"""
        # 通知 agent 特定订阅者
        for callback in list(self._subscribers.get(agent_id, [])):
            try:
                callback(agent_id, change)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"订阅者回调失败: agent_id={agent_id}, error={e}"
                )
        # 通知全局订阅者
        for callback in list(self._global_subscribers):
            try:
                callback(agent_id, change)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"全局订阅者回调失败: error={e}")

    # ============================================================
    # 工具方法
    # ============================================================

    def cleanup_agent(self, agent_id: str) -> bool:
        """清理 agent 数据（实例销毁时调用）"""
        if agent_id not in self._efforts:
            return False
        del self._efforts[agent_id]
        self._history.pop(agent_id, None)
        self._updated_at.pop(agent_id, None)
        self._subscribers.pop(agent_id, None)
        logger.debug(f"清理 agent reasoning 数据: {agent_id}")
        return True

    def list_efforts(self) -> Dict[str, str]:
        """列出所有 agent 的当前 effort"""
        return dict(self._efforts)

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        # 按 effort 分组
        by_effort: Dict[str, int] = {"low": 0, "medium": 0, "high": 0}
        for effort in self._efforts.values():
            by_effort[effort] = by_effort.get(effort, 0) + 1
        return {
            "total_agents": len(self._efforts),
            "total_changes": self._total_changes,
            "by_effort": by_effort,
            "default_effort": DEFAULT_EFFORT,
            "max_history_per_agent": MAX_HISTORY,
        }

    def reset(self) -> None:
        """重置所有状态（测试用）"""
        self._efforts.clear()
        self._history.clear()
        self._updated_at.clear()
        self._subscribers.clear()
        self._global_subscribers.clear()
        self._total_changes = 0


# ============================================================
# 全局单例
# ============================================================


_controller: Optional[ReasoningEffortController] = None


def get_reasoning_controller() -> ReasoningEffortController:
    """获取 ReasoningEffortController 单例"""
    global _controller
    if _controller is None:
        _controller = ReasoningEffortController()
    return _controller


def reset_reasoning_controller() -> None:
    """重置单例（测试用）"""
    global _controller
    _controller = None
