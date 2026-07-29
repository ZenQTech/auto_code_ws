"""
# ============================================================
# 企业级 Plugin Hub - REST API
# ============================================================
# 核心作用：暴露 ≥ 30 个 REST 端点给前端
# 端点分类：
#   - 健康与统计 (2)
#   - 插件目录 (4)
#   - 团队管理 (6)
#   - RBAC (2)
#   - 成本控制 (5)
#   - 审批流 (4)
#   - 审计日志 (3)
#   - Dashboard (3)
#   - 安装操作 (2)
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本（31 端点）
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query

from .manager import EnterpriseHubManager, get_manager

logger = logging.getLogger(__name__)

# 创建路由（不设置 prefix，由 main.py 统一添加）
router = APIRouter(tags=["enterprise-hub"])


def _mgr() -> EnterpriseHubManager:
    """获取全局管理器"""
    return get_manager()


# ============================================================
# 健康 & 统计 (2)
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    return _mgr().health()


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """全局统计"""
    m = _mgr()
    return {
        "registry": m.registry.stats(),
        "catalog": {
            "total": len(m.list_catalog()),
        },
        "approvals": m.approvals.stats(),
    }


# ============================================================
# 插件目录 (4)
# ============================================================

@router.get("/catalog")
async def list_catalog(
    q: Optional[str] = Query(None, description="关键字"),
    category: Optional[str] = Query(None, description="分类 ID"),
    source: Optional[str] = Query(None, description="来源 official/community/local"),
    enterprise_only: bool = Query(False, description="仅企业级"),
    soc2_only: bool = Query(False, description="仅 SOC2 合规"),
    free_only: bool = Query(False, description="仅免费"),
    limit: int = Query(200, ge=1, le=500),
) -> Dict[str, Any]:
    """列出插件目录"""
    items = _mgr().list_catalog(
        query=q or "",
        category=category,
        source=source,
        enterprise_only=enterprise_only,
        soc2_only=soc2_only,
        free_only=free_only,
    )
    items = items[:limit]
    return {
        "total": len(items),
        "items": [p.to_dict() for p in items],
    }


@router.get("/catalog/featured")
async def catalog_featured(limit: int = Query(10, ge=1, le=50)) -> Dict[str, Any]:
    """推荐插件"""
    items = _mgr().featured_plugins(limit=limit)
    return {
        "total": len(items),
        "items": [p.to_dict() for p in items],
    }


@router.get("/categories")
async def list_categories() -> Dict[str, Any]:
    """分类列表"""
    return {"items": _mgr().list_categories()}


@router.get("/catalog/{plugin_id}")
async def get_plugin(plugin_id: str) -> Dict[str, Any]:
    """插件详情"""
    p = _mgr().get_plugin(plugin_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"plugin {plugin_id} not found")
    return p.to_dict()


# ============================================================
# 团队管理 (6)
# ============================================================

@router.post("/orgs")
async def create_org(
    name: str = Body(..., embed=True),
    owner: str = Body(..., embed=True),
    plan: str = Body("free", embed=True),
    billing_email: str = Body("", embed=True),
    actor: str = Body("system", embed=True),
) -> Dict[str, Any]:
    """创建组织"""
    try:
        org = _mgr().create_org(name=name, owner=owner, plan=plan, actor=actor, billing_email=billing_email)
        return org.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orgs")
async def list_orgs() -> Dict[str, Any]:
    """列出组织"""
    orgs = _mgr().list_orgs()
    return {"total": len(orgs), "items": [o.to_dict() for o in orgs]}


@router.get("/orgs/{org_id}")
async def get_org(org_id: str) -> Dict[str, Any]:
    """组织详情"""
    org = _mgr().get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=f"org {org_id} not found")
    return org.to_dict()


@router.post("/orgs/{org_id}/teams")
async def create_team(
    org_id: str,
    name: str = Body(..., embed=True),
    description: str = Body("", embed=True),
    budget_usd: float = Body(0.0, embed=True),
    actor: str = Body("system", embed=True),
) -> Dict[str, Any]:
    """创建团队"""
    try:
        team = _mgr().create_team(org_id=org_id, name=name, actor=actor, description=description, budget_usd=budget_usd)
        return team.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orgs/{org_id}/teams")
async def list_teams(org_id: str) -> Dict[str, Any]:
    """列出团队"""
    teams = _mgr().list_teams(org_id)
    return {"total": len(teams), "items": [t.to_dict() for t in teams]}


@router.post("/orgs/{org_id}/members")
async def invite_member(
    org_id: str,
    email: str = Body(..., embed=True),
    name: str = Body("", embed=True),
    role: str = Body("developer", embed=True),
    actor: str = Body("system", embed=True),
) -> Dict[str, Any]:
    """邀请成员"""
    try:
        m = _mgr().invite_member(org_id=org_id, email=email, actor=actor, name=name, role=role)
        return m.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orgs/{org_id}/members")
async def list_members(org_id: str) -> Dict[str, Any]:
    """列出成员"""
    members = _mgr().list_members(org_id)
    return {"total": len(members), "items": [m.to_dict() for m in members]}


# ============================================================
# RBAC (2)
# ============================================================

@router.put("/orgs/{org_id}/members/{member_id}/role")
async def update_member_role(
    org_id: str,
    member_id: str,
    role: str = Body(..., embed=True),
    actor: str = Body(..., embed=True),
) -> Dict[str, Any]:
    """更新成员角色"""
    try:
        m = _mgr().update_member_role(org_id=org_id, member_id=member_id, new_role=role, actor=actor)
        if not m:
            raise HTTPException(status_code=404, detail="member not found")
        return m.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/orgs/{org_id}/permissions")
async def get_permissions(org_id: str, actor: str = Query(...)) -> Dict[str, Any]:
    """查询某用户权限"""
    return _mgr().get_permissions(org_id=org_id, actor=actor)


# ============================================================
# 成本控制 (5)
# ============================================================

@router.post("/orgs/{org_id}/quotas")
async def set_quotas(
    org_id: str,
    quotas: Dict[str, Any] = Body(..., embed=True),
    actor: str = Body("system", embed=True),
) -> Dict[str, Any]:
    """设置配额"""
    try:
        org = _mgr().update_quotas(org_id=org_id, actor=actor, quotas=quotas)
        if not org:
            raise HTTPException(status_code=404, detail="org not found")
        return org.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/orgs/{org_id}/quotas")
async def get_quotas(org_id: str) -> Dict[str, Any]:
    """查看配额"""
    org = _mgr().get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="org not found")
    return {"org_id": org_id, "quotas": org.quotas}


@router.post("/cost/records")
async def record_cost(
    org_id: str = Body(..., embed=True),
    plugin_id: str = Body(..., embed=True),
    member_id: str = Body(..., embed=True),
    cost_usd: float = Body(..., embed=True),
    usage_count: int = Body(1, embed=True),
    team_id: Optional[str] = Body(None, embed=True),
    actor: str = Body("system", embed=True),
) -> Dict[str, Any]:
    """记录成本"""
    try:
        rec = _mgr().record_cost(
            org_id=org_id, plugin_id=plugin_id, member_id=member_id,
            cost_usd=cost_usd, actor=actor, usage_count=usage_count, team_id=team_id,
        )
        return rec.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/orgs/{org_id}/cost/summary")
async def cost_summary(org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
    """成本摘要"""
    return _mgr().cost_summary(org_id=org_id, period=period)


@router.get("/orgs/{org_id}/cost/breakdown")
async def cost_breakdown(org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
    """成本明细"""
    return _mgr().cost_breakdown(org_id=org_id, period=period)


# ============================================================
# 审批 (4)
# ============================================================

@router.post("/approvals")
async def create_approval(
    org_id: str = Body(..., embed=True),
    plugin_id: str = Body(..., embed=True),
    requested_by: str = Body(..., embed=True),
    reason: str = Body("", embed=True),
    team_id: str = Body("", embed=True),
) -> Dict[str, Any]:
    """创建审批"""
    try:
        req = _mgr().create_approval(
            org_id=org_id, plugin_id=plugin_id, requested_by=requested_by,
            reason=reason, team_id=team_id,
        )
        return req.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/approvals")
async def list_approvals(
    org_id: Optional[str] = None,
    status: Optional[str] = None,
    team_id: Optional[str] = None,
    plugin_id: Optional[str] = None,
) -> Dict[str, Any]:
    """列出审批"""
    items = _mgr().list_approvals(status=status, team_id=team_id, plugin_id=plugin_id)
    return {"total": len(items), "items": [r.to_dict() for r in items]}


@router.post("/approvals/{request_id}/approve")
async def approve_request(
    request_id: str,
    org_id: str = Body(..., embed=True),
    reviewer: str = Body(..., embed=True),
    comment: str = Body("", embed=True),
) -> Dict[str, Any]:
    """批准"""
    try:
        r = _mgr().approve_request(org_id=org_id, request_id=request_id, reviewer=reviewer, comment=comment)
        if not r:
            raise HTTPException(status_code=404, detail="request not found")
        return r.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/approvals/{request_id}/reject")
async def reject_request(
    request_id: str,
    org_id: str = Body(..., embed=True),
    reviewer: str = Body(..., embed=True),
    comment: str = Body("", embed=True),
) -> Dict[str, Any]:
    """拒绝"""
    try:
        r = _mgr().reject_request(org_id=org_id, request_id=request_id, reviewer=reviewer, comment=comment)
        if not r:
            raise HTTPException(status_code=404, detail="request not found")
        return r.to_dict()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ============================================================
# 审计 (3)
# ============================================================

@router.get("/audit/logs")
async def audit_logs(
    org_id: Optional[str] = None,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    """查询审计日志"""
    logs = _mgr().query_audit(org_id=org_id, actor=actor, action=action, severity=severity, limit=limit)
    return {"total": len(logs), "items": [l.to_dict() for l in logs]}


@router.get("/audit/export")
async def audit_export(
    org_id: Optional[str] = None,
    format: str = "jsonl",
) -> Dict[str, Any]:
    """导出审计报告"""
    content = _mgr().export_audit(org_id=org_id, format=format)
    return {"format": format, "content": content, "size": len(content)}


@router.post("/audit/security-event")
async def log_security_event(
    org_id: str = Body(..., embed=True),
    actor: str = Body(..., embed=True),
    event: str = Body(..., embed=True),
    target: str = Body(..., embed=True),
    metadata: Optional[Dict[str, Any]] = Body(None, embed=True),
) -> Dict[str, Any]:
    """记录安全事件"""
    log = _mgr().log_security_event(
        org_id=org_id, actor=actor, event=event, target=target, metadata=metadata,
    )
    return log.to_dict()


# ============================================================
# Dashboard (3)
# ============================================================

@router.get("/dashboard/{org_id}")
async def dashboard(org_id: str) -> Dict[str, Any]:
    """生成 Dashboard 快照"""
    try:
        snap = _mgr().dashboard_snapshot(org_id)
        return snap.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/dashboard/{org_id}/top-plugins")
async def dashboard_top(org_id: str, limit: int = Query(10, ge=1, le=50)) -> Dict[str, Any]:
    """Top 插件"""
    items = _mgr().top_plugins(org_id, limit=limit)
    return {"total": len(items), "items": items}


@router.get("/dashboard/{org_id}/productivity")
async def dashboard_productivity(org_id: str) -> Dict[str, Any]:
    """生产力分析"""
    return _mgr().productivity(org_id)


# ============================================================
# 安装 (2)
# ============================================================

@router.post("/install")
async def install_plugin(
    org_id: str = Body(..., embed=True),
    plugin_id: str = Body(..., embed=True),
    member_id: str = Body(..., embed=True),
    cost_usd: float = Body(0.0, embed=True),
) -> Dict[str, Any]:
    """模拟安装"""
    try:
        return _mgr().install_plugin(
            org_id=org_id, plugin_id=plugin_id, member_id=member_id, cost_usd=cost_usd,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/uninstall")
async def uninstall_plugin(
    org_id: str = Body(..., embed=True),
    plugin_id: str = Body(..., embed=True),
    member_id: str = Body(..., embed=True),
) -> Dict[str, Any]:
    """模拟卸载"""
    try:
        return _mgr().uninstall_plugin(org_id=org_id, plugin_id=plugin_id, member_id=member_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ============================================================
# 端点数量统计
# ============================================================

ENDPOINT_COUNT = sum(1 for r in router.routes if hasattr(r, "path"))
