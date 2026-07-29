"""
# ============================================================
# 企业级 Plugin Hub - 模块导出
# ============================================================
# 核心作用：导出企业级 Plugin Hub 所有公共 API
# 设计：
#   - 直接导出 models/catalog/rbac/teams/cost_control/approvals/audit/dashboard/api
#   - manager 延迟导入，避免循环依赖
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from .models import (
    ActionType,
    ApprovalRequest,
    ApprovalStatus,
    AuditLog,
    CostRecord,
    DashboardSnapshot,
    Member,
    MemberRole,
    OrgPlan,
    Organization,
    PluginCatalogItem,
    PricingModel,
    Team,
    get_storage_dir,
)
from .catalog import (
    CATEGORIES,
    PLUGINS_DATA,
    catalog_summary,
    count_by_category,
    filter_by_category,
    filter_by_source,
    get_categories,
    get_default_catalog,
    get_featured_plugins,
    get_plugin_by_id,
    search_plugins,
)
from .rbac import PERMISSIONS, ROLE_PERMISSIONS, Permission
from .teams import TeamRegistry, _EMAIL_RE, _ID_RE
from .cost_control import CostController
from .approvals import ApprovalWorkflow
from .audit import AuditLogger
from .dashboard import DashboardBuilder
from .api import router, ENDPOINT_COUNT


def __getattr__(name: str):
    """延迟导入 manager（避免循环依赖）"""
    if name in {"EnterpriseHubManager", "get_manager", "reset_manager"}:
        from .manager import EnterpriseHubManager, get_manager, reset_manager
        if name == "EnterpriseHubManager":
            return EnterpriseHubManager
        if name == "get_manager":
            return get_manager
        if name == "reset_manager":
            return reset_manager
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    # 数据模型
    "Organization", "Team", "Member",
    "PluginCatalogItem", "ApprovalRequest", "CostRecord",
    "AuditLog", "DashboardSnapshot",
    "MemberRole", "ApprovalStatus", "ActionType", "OrgPlan", "PricingModel",
    "get_storage_dir",
    # 目录
    "CATEGORIES", "PLUGINS_DATA",
    "catalog_summary", "get_categories", "get_default_catalog",
    "get_featured_plugins", "get_plugin_by_id", "search_plugins",
    # RBAC
    "PERMISSIONS", "ROLE_PERMISSIONS", "Permission",
    # 团队/审批/成本/审计/Dashboard
    "TeamRegistry", "CostController", "ApprovalWorkflow", "AuditLogger", "DashboardBuilder",
    # API
    "router", "ENDPOINT_COUNT",
    # Manager（延迟导入）
    "EnterpriseHubManager", "get_manager", "reset_manager",
]
