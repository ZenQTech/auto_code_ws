"""
# ============================================================
# Hermes /goal 长时域模式 - 入口模块
# ============================================================
# 核心作用：暴露 /goal 系统的主要 API
# 特性：全局单例、便捷函数、向后兼容
# Cycle 12 P0-2 新建
# ============================================================
"""

from .base import (
    AcceptanceCriterion,
    AcceptanceStatus,
    Goal,
    GoalStatus,
    TokenBudget,
    VerifyType,
)
from .manager import GoalManager, get_manager
from .markdown import (
    parse_goal_md,
    render_goal_md,
    render_progress_md,
    render_verify_md,
)
from .plan import (
    GoalPlan,
    PlanStatus,
    PlanStep,
    StepStatus,
    StepStrategy,
)
from .progress import (
    ProgressAction,
    ProgressEntry,
    ProgressLog,
    ProgressStatus,
)
from .step_verifier import (
    StepVerifyResult,
    StepVerifier,
    VerifierError,
    get_step_verifier,
    reset_step_verifier,
)
from .verify_item import (
    VerifyItem,
    VerifyReport,
    VerifyResult,
    VerifyStatus,
)
from .verifier import Verifier, get_verifier


__all__ = [
    # 枚举
    "GoalStatus",
    "AcceptanceStatus",
    "ProgressStatus",
    "VerifyStatus",
    "VerifyType",
    "PlanStatus",
    "StepStatus",
    "StepStrategy",
    # 模型
    "Goal",
    "AcceptanceCriterion",
    "TokenBudget",
    "ProgressEntry",
    "ProgressAction",
    "ProgressLog",
    "VerifyItem",
    "VerifyResult",
    "VerifyReport",
    "GoalPlan",
    "PlanStep",
    # 服务
    "GoalManager",
    "get_manager",
    "Verifier",
    "get_verifier",
    "StepVerifier",
    "get_step_verifier",
    "reset_step_verifier",
    "StepVerifyResult",
    "VerifierError",
    # Markdown
    "render_goal_md",
    "render_verify_md",
    "render_progress_md",
    "parse_goal_md",
]


__version__ = "1.1.0"
__cycle__ = "Cycle 12 P0-2 + Cycle 61 G61-02"
