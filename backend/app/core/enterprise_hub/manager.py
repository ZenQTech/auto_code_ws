"""
# ============================================================
# 企业级 Plugin Hub - 统一管理器
# ============================================================
# 核心作用：组合所有子模块，对外提供统一管理入口
# 运行流程：
#   1. EnterpriseHubManager 持有 registry/cost/audit/approvals/dashboard
#   2. 所有写操作都自动记录审计日志
#   3. RBAC 校验通过才允许操作
#   4. 全局单例：get_manager()
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from .approvals import ApprovalWorkflow
from .audit import AuditLogger
from .catalog import (
    PLUGINS_DATA,
    catalog_summary,
    get_categories,
    get_default_catalog,
    get_featured_plugins,
    get_plugin_by_id,
    search_plugins,
)
from .cost_control import CostController
from .dashboard import DashboardBuilder
from .models import (
    ActionType,
    ApprovalRequest,
    AuditLog,
    CostRecord,
    DashboardSnapshot,
    Member,
    MemberRole,
    Organization,
    PluginCatalogItem,
    Team,
    get_storage_dir,
)
from .rbac import Permission
from .teams import TeamRegistry

_manager_lock = threading.RLock()
_manager_instance: Optional["EnterpriseHubManager"] = None


class EnterpriseHubManager:
    """企业级 Plugin Hub 统一管理器

    Attributes:
        registry: 团队注册中心
        cost: 成本控制器
        audit: 审计日志
        approvals: 审批工作流
        dashboard: Dashboard 构造器
        storage_dir: 持久化目录
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        self.storage_dir = storage_dir or get_storage_dir()
        self.registry = TeamRegistry(storage_dir=self.storage_dir)
        self.audit = AuditLogger(storage_dir=self.storage_dir)
        self.cost = CostController(registry=self.registry, storage_dir=self.storage_dir)
        self.approvals = ApprovalWorkflow(storage_dir=self.storage_dir)
        self.dashboard = DashboardBuilder(
            registry=self.registry,
            cost=self.cost,
            audit=self.audit,
            storage_dir=self.storage_dir,
        )

    # ----------------------------------------------------------------
    # 健康
    # ----------------------------------------------------------------
    def health(self) -> Dict[str, Any]:
        """健康检查"""
        return {
            "status": "ok",
            "version": "v6.28.0",
            "components": {
                "registry": self.registry.stats(),
                "catalog": catalog_summary(),
                "approvals": self.approvals.stats(),
            },
            "storage_dir": self.storage_dir,
        }

    # ----------------------------------------------------------------
    # 目录相关（只读）
    # ----------------------------------------------------------------
    def list_catalog(self, **kwargs) -> List[PluginCatalogItem]:
        """列出目录（支持搜索/分类/来源/企业级/SOC2/免费 过滤）"""
        return search_plugins(**kwargs)

    def get_plugin(self, plugin_id: str) -> Optional[PluginCatalogItem]:
        """获取插件详情"""
        return get_plugin_by_id(plugin_id)

    def list_categories(self) -> List[Dict[str, str]]:
        """列出分类"""
        return get_categories()

    def featured_plugins(self, limit: int = 10) -> List[PluginCatalogItem]:
        """推荐插件"""
        return get_featured_plugins(limit=limit)

    # ----------------------------------------------------------------
    # 组织/团队/成员（带审计日志 + RBAC）
    # ----------------------------------------------------------------
    def create_org(self, name: str, owner: str, plan: str = "free", actor: str = "system", billing_email: str = "") -> Organization:
        org = self.registry.create_org(name=name, owner=owner, plan=plan, billing_email=billing_email)
        self.audit.log(
            org_id=org.org_id,
            actor=actor,
            action=ActionType.TEAM_CREATE.value,  # 复用（创建顶层组织）
            target=org.org_id,
            metadata={"name": name, "plan": plan, "kind": "organization"},
        )
        return org

    def list_orgs(self) -> List[Organization]:
        return self.registry.list_orgs()

    def get_org(self, org_id: str) -> Optional[Organization]:
        return self.registry.get_org(org_id)

    def update_quotas(self, org_id: str, actor: str, quotas: Dict[str, Any]) -> Optional[Organization]:
        org = self.registry.get_org(org_id)
        if not org:
            return None
        actor_member = self._resolve_actor(org_id, actor)
        Permission.require(actor_member.role if actor_member else "viewer", "org:quotas")
        result = self.registry.update_org_quotas(org_id, quotas)
        if result:
            self.audit.log(
                org_id=org_id, actor=actor, action=ActionType.QUOTA_UPDATE.value,
                target=org_id, metadata={"quotas": quotas},
            )
        return result

    def create_team(self, org_id: str, name: str, actor: str, description: str = "", budget_usd: float = 0.0) -> Team:
        actor_member = self._resolve_actor(org_id, actor)
        Permission.require(actor_member.role if actor_member else "viewer", "team:write")
        team = self.registry.create_team(org_id=org_id, name=name, description=description, budget_usd=budget_usd)
        self.audit.log(
            org_id=org_id, actor=actor, action=ActionType.TEAM_CREATE.value,
            target=team.team_id, metadata={"name": name},
        )
        return team

    def list_teams(self, org_id: str) -> List[Team]:
        return self.registry.list_teams(org_id)

    def get_team(self, team_id: str) -> Optional[Team]:
        return self.registry.get_team(team_id)

    def invite_member(self, org_id: str, email: str, actor: str, name: str = "", role: str = "developer") -> Member:
        actor_member = self._resolve_actor(org_id, actor)
        Permission.require(actor_member.role if actor_member else "viewer", "member:invite")
        member = self.registry.invite_member(org_id=org_id, email=email, name=name, role=role)
        self.audit.log(
            org_id=org_id, actor=actor, action=ActionType.MEMBER_INVITE.value,
            target=member.member_id, metadata={"email": email, "role": role},
        )
        return member

    def list_members(self, org_id: str) -> List[Member]:
        return self.registry.list_members(org_id)

    def get_member(self, member_id: str) -> Optional[Member]:
        return self.registry.get_member(member_id)

    def update_member_role(self, org_id: str, member_id: str, new_role: str, actor: str) -> Optional[Member]:
        actor_member = self._resolve_actor(org_id, actor)
        target = self.registry.get_member(member_id)
        if not target:
            return None
        actor_role = actor_member.role if actor_member else "viewer"
        Permission.require(actor_role, "member:role")
        # 不能操作同等级或更高
        if not Permission.can_manage_role(actor_role, target.role):
            raise PermissionError(
                f"role {actor_role!r} cannot manage role {target.role!r}"
            )
        # Admin 可设为任何角色；Manager 只能降到 developer
        if actor_role == MemberRole.ADMIN.value:
            pass
        elif actor_role == MemberRole.MANAGER.value:
            if new_role not in {MemberRole.DEVELOPER.value, MemberRole.VIEWER.value}:
                raise PermissionError(f"manager cannot set role to {new_role!r}")
        else:
            raise PermissionError(f"role {actor_role!r} cannot change role")
        result = self.registry.update_member_role(member_id, new_role)
        if result:
            self.audit.log(
                org_id=org_id, actor=actor, action=ActionType.ROLE_CHANGE.value,
                target=member_id, metadata={"old_role": target.role, "new_role": new_role},
            )
        return result

    # ----------------------------------------------------------------
    # 权限查询
    # ----------------------------------------------------------------
    def get_permissions(self, org_id: str, actor: str) -> Dict[str, Any]:
        """获取某用户在某组织的权限集"""
        m = self._resolve_actor(org_id, actor)
        role = m.role if m else "viewer"
        return {
            "actor": actor,
            "org_id": org_id,
            "role": role,
            "permissions": sorted(Permission.permissions_of(role)),
        }

    # ----------------------------------------------------------------
    # 审批
    # ----------------------------------------------------------------
    def create_approval(
        self,
        org_id: str,
        plugin_id: str,
        requested_by: str,
        reason: str = "",
        team_id: str = "",
    ) -> ApprovalRequest:
        actor = self._resolve_actor(org_id, requested_by)
        Permission.require(actor.role if actor else "viewer", "approval:create")
        req = self.approvals.create_request(
            plugin_id=plugin_id,
            requested_by=requested_by,
            reason=reason,
            team_id=team_id,
        )
        self.audit.log(
            org_id=org_id, actor=requested_by, action=ActionType.PLUGIN_APPROVE.value,
            target=plugin_id, metadata={"request_id": req.request_id, "kind": "create", "reason": reason},
        )
        return req

    def approve_request(self, org_id: str, request_id: str, reviewer: str, comment: str = "") -> Optional[ApprovalRequest]:
        actor = self._resolve_actor(org_id, reviewer)
        Permission.require(actor.role if actor else "viewer", "approval:review")
        req = self.approvals.approve(request_id, reviewer, comment)
        if req:
            self.audit.log(
                org_id=org_id, actor=reviewer, action=ActionType.PLUGIN_APPROVE.value,
                target=req.plugin_id, metadata={"request_id": request_id, "kind": "approve"},
            )
        return req

    def reject_request(self, org_id: str, request_id: str, reviewer: str, comment: str = "") -> Optional[ApprovalRequest]:
        actor = self._resolve_actor(org_id, reviewer)
        Permission.require(actor.role if actor else "viewer", "approval:review")
        req = self.approvals.reject(request_id, reviewer, comment)
        if req:
            self.audit.log(
                org_id=org_id, actor=reviewer, action=ActionType.PLUGIN_REJECT.value,
                target=req.plugin_id, metadata={"request_id": request_id, "kind": "reject"},
            )
        return req

    def list_approvals(self, **kwargs) -> List[ApprovalRequest]:
        return self.approvals.list(**kwargs)

    # ----------------------------------------------------------------
    # 成本
    # ----------------------------------------------------------------
    def record_cost(
        self,
        org_id: str,
        plugin_id: str,
        member_id: str,
        cost_usd: float,
        actor: str = "system",
        usage_count: int = 1,
        team_id: Optional[str] = None,
        period: Optional[str] = None,
    ) -> CostRecord:
        # cost:write 权限
        actor_member = self._resolve_actor(org_id, actor)
        Permission.require(actor_member.role if actor_member else "admin", "cost:write")
        rec = self.cost.record_usage(
            org_id=org_id,
            plugin_id=plugin_id,
            member_id=member_id,
            cost_usd=cost_usd,
            usage_count=usage_count,
            team_id=team_id,
            period=period,
        )
        self.audit.log(
            org_id=org_id, actor=actor, action=ActionType.COST_RECORD.value,
            target=plugin_id, metadata={"member_id": member_id, "cost_usd": cost_usd, "team_id": team_id},
        )
        return rec

    def set_budget(self, org_id: str, period: str, budget_usd: float, actor: str) -> None:
        actor_member = self._resolve_actor(org_id, actor)
        Permission.require(actor_member.role if actor_member else "viewer", "cost:manage")
        self.cost.set_budget(org_id, period, budget_usd)
        self.audit.log(
            org_id=org_id, actor=actor, action=ActionType.QUOTA_UPDATE.value,
            target=org_id, metadata={"period": period, "budget_usd": budget_usd, "kind": "cost_budget"},
        )

    def cost_summary(self, org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
        return self.cost.cost_summary(org_id, period=period)

    def cost_breakdown(self, org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
        return self.cost.cost_breakdown(org_id, period=period)

    def list_alerts(self, org_id: str) -> List[Dict[str, Any]]:
        return self.cost.list_alerts(org_id)

    # ----------------------------------------------------------------
    # 安装（写审计 + 计费）
    # ----------------------------------------------------------------
    def install_plugin(
        self,
        org_id: str,
        plugin_id: str,
        member_id: str,
        cost_usd: float = 0.0,
    ) -> Dict[str, Any]:
        """模拟安装（实际安装由 plugin system 处理）"""
        actor = self._resolve_actor(org_id, member_id)
        Permission.require(actor.role if actor else "viewer", "plugin:install")
        # 配额校验
        org = self.registry.get_org(org_id)
        if org:
            install_logs = self.audit.query(org_id=org_id, action=ActionType.PLUGIN_INSTALL.value, limit=10000)
            unique = {l.target for l in install_logs}
            if plugin_id not in unique:
                max_installs = int(org.quotas.get("max_plugin_installs", 999))
                if len(unique) >= max_installs:
                    raise ValueError(f"install quota reached: {len(unique)}/{max_installs}")
        # 写审计
        self.audit.log(
            org_id=org_id, actor=member_id, action=ActionType.PLUGIN_INSTALL.value,
            target=plugin_id, metadata={"cost_usd": cost_usd},
        )
        # 写成本
        if cost_usd > 0:
            self.cost.record_usage(
                org_id=org_id, plugin_id=plugin_id, member_id=member_id, cost_usd=cost_usd,
            )
        return {
            "ok": True,
            "org_id": org_id,
            "plugin_id": plugin_id,
            "member_id": member_id,
            "cost_usd": cost_usd,
        }

    def uninstall_plugin(self, org_id: str, plugin_id: str, member_id: str) -> Dict[str, Any]:
        actor = self._resolve_actor(org_id, member_id)
        Permission.require(actor.role if actor else "viewer", "plugin:uninstall")
        self.audit.log(
            org_id=org_id, actor=member_id, action=ActionType.PLUGIN_UNINSTALL.value,
            target=plugin_id, metadata={},
        )
        return {"ok": True, "org_id": org_id, "plugin_id": plugin_id}

    # ----------------------------------------------------------------
    # 审计
    # ----------------------------------------------------------------
    def query_audit(self, org_id: Optional[str] = None, actor: Optional[str] = None, **kwargs) -> List[AuditLog]:
        return self.audit.query(org_id=org_id, actor=actor, **kwargs)

    def export_audit(self, org_id: Optional[str] = None, format: str = "jsonl") -> str:
        return self.audit.export(org_id=org_id, format=format)

    def log_security_event(
        self,
        org_id: str,
        actor: str,
        event: str,
        target: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AuditLog:
        return self.audit.log_security_event(
            org_id=org_id, actor=actor, event=event, target=target, metadata=metadata,
        )

    # ----------------------------------------------------------------
    # Dashboard
    # ----------------------------------------------------------------
    def dashboard_snapshot(self, org_id: str) -> DashboardSnapshot:
        return self.dashboard.snapshot(org_id)

    def top_plugins(self, org_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        return self.dashboard.top_plugins(org_id, limit=limit)

    def productivity(self, org_id: str) -> Dict[str, Any]:
        return self.dashboard.productivity(org_id)

    # ----------------------------------------------------------------
    # 内部
    # ----------------------------------------------------------------
    def _resolve_actor(self, org_id: str, actor: str) -> Optional[Member]:
        """从 actor（email 或 member_id）解析成员

        对于 bootstrap 场景：组织无任何成员时，返回一个临时 admin 成员。
        允许首次邀请 owner 完成 bootstrap。
        """
        # 优先按 member_id 查
        m = self.registry.get_member(actor)
        if m and m.org_id == org_id:
            return m
        # 否则按 email 查
        for member in self.registry.list_members(org_id):
            if member.email == actor:
                return member
        # bootstrap：如果组织还没有成员，假定 actor 是 owner（admin 角色）
        if not self.registry.list_members(org_id):
            org = self.registry.get_org(org_id)
            if org and (actor == org.owner or actor == org.billing_email):
                temp = Member(
                    member_id="__bootstrap_owner__",
                    org_id=org_id,
                    email=actor,
                    name=actor,
                    role=MemberRole.ADMIN.value,
                    status="active",
                )
                return temp
        return None


def get_manager() -> EnterpriseHubManager:
    """获取全局单例"""
    global _manager_instance
    with _manager_lock:
        if _manager_instance is None:
            _manager_instance = EnterpriseHubManager()
        return _manager_instance


def reset_manager() -> None:
    """重置全局单例（用于测试）"""
    global _manager_instance
    with _manager_lock:
        _manager_instance = None
