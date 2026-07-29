"""
# ============================================================
# Hermes Goal Automation - 入口模块
# ============================================================
# 核心作用：暴露 Goal 自动轮转 + 多 Agent 委派的统一 API
# 特性：
#   - AutoTurnEngine: 自动推进 Goal AC
#   - MultiAgentDelegator: 多 Agent 委派
#   - 全局单例 + 便捷函数
# Cycle 14 P1-4 新建
# ============================================================
"""

from .auto_turn import (
    AutoTurnEngine,
    TurnConfig,
    TurnRecord,
    TurnState,
    TurnStrategy,
    TurnTrigger,
    get_engine,
    reset_engine,
)
from .delegation import (
    ACType,
    ACTypeMapping,
    AgentRole,
    AgentSpec,
    DelegationDecision,
    DelegationRequest,
    DelegationResult,
    MultiAgentDelegator,
    RiskLevel,
    get_delegator,
    reset_delegator,
)


__all__ = [
    # Auto-Turn
    "TurnTrigger",
    "TurnStrategy",
    "TurnState",
    "TurnConfig",
    "TurnRecord",
    "AutoTurnEngine",
    "get_engine",
    "reset_engine",
    # Multi-Agent Delegation
    "AgentRole",
    "RiskLevel",
    "ACType",
    "DelegationDecision",
    "AgentSpec",
    "DelegationRequest",
    "DelegationResult",
    "ACTypeMapping",
    "MultiAgentDelegator",
    "get_delegator",
    "reset_delegator",
]


__version__ = "1.0.0"
__cycle__ = "Cycle 14 P1-4"
