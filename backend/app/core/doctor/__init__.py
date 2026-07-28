"""
# ============================================================
# Hermes Doctor - 入口模块
# ============================================================
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from .base import (
    BaseChecker,
    CategoryReport,
    CheckItem,
    CheckStatus,
    DoctorReport,
    FixSuggestion,
)
from .checkers import (
    DatabaseChecker,
    DependenciesChecker,
    EnvironmentChecker,
    LLMChecker,
    MCPChecker,
    WorkspaceChecker,
)
from .fix_advisor import FixAdvisor, get_fix_advisor
from .formatters import (
    BaseFormatter,
    FullFormatter,
    JSONFormatter,
    PlainFormatter,
    SummaryFormatter,
    get_formatter,
)
from .history import ReportHistoryStore, get_history_store
from .runner import (
    CATEGORY_TITLES,
    CHECKER_REGISTRY,
    DoctorRunner,
    get_doctor_runner,
)

__all__ = [
    # 数据模型
    "CheckItem",
    "CheckStatus",
    "CategoryReport",
    "DoctorReport",
    "FixSuggestion",
    # 基类
    "BaseChecker",
    # 6 大类检查器
    "EnvironmentChecker",
    "WorkspaceChecker",
    "LLMChecker",
    "DatabaseChecker",
    "MCPChecker",
    "DependenciesChecker",
    # 核心服务
    "DoctorRunner",
    "FixAdvisor",
    "ReportHistoryStore",
    "CHECKER_REGISTRY",
    "CATEGORY_TITLES",
    # 格式化器
    "BaseFormatter",
    "SummaryFormatter",
    "JSONFormatter",
    "FullFormatter",
    "PlainFormatter",
    "get_formatter",
    # 单例获取
    "get_doctor_runner",
    "get_fix_advisor",
    "get_history_store",
]
