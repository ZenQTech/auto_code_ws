"""
# ============================================================
# Hermes Goal Templates - REST API
# ============================================================
# 核心作用：暴露 Goal Templates 全部功能的 REST API
# 端点：
#   - GET  /health                          健康检查
#   - GET  /stats                           统计信息
#   - GET  /templates                       列出模板（支持过滤）
#   - GET  /templates/{template_id}         获取模板详情
#   - POST /templates                       注册模板
#   - PUT  /templates/{template_id}         更新模板
#   - DELETE /templates/{template_id}       注销模板
#   - POST /templates/{template_id}/fork    Fork 内置模板
#   - POST /templates/{template_id}/instantiate  实例化模板
#   - GET  /templates/{template_id}/export  导出模板
#   - POST /templates/import                导入模板
#   - GET  /instantiations                  实例化历史
#   - GET  /meta/categories                 类别枚举
#   - GET  /meta/sources                    来源枚举
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-5 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.goal_templates import (
    AcceptanceCriterionTemplate,
    GoalTemplate,
    TemplateCategory,
    TemplateInstantiation,
    TemplateManager,
    TemplateSource,
    get_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/goal-templates", tags=["goal-templates"])


# ============================================================
# Pydantic 模型
# ============================================================
class ACTemplateItem(BaseModel):
    ac_id: str = ""
    title: str
    description: str = ""
    priority: int = Field(5, ge=1, le=10)
    ac_type: str = "implementation"
    risk_level: str = "medium"
    verify_items: List[Dict[str, Any]] = Field(default_factory=list)


class TemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    category: str = "other"
    tags: List[str] = Field(default_factory=list)
    acceptance_criteria: List[ACTemplateItem] = Field(default_factory=list)
    default_strategy: str = "standard"
    default_max_turns: int = Field(50, ge=1, le=10000)
    default_triggers: List[str] = Field(default_factory=lambda: ["manual"])
    recommended_agents: List[str] = Field(default_factory=list)
    estimated_duration_min: int = Field(60, ge=1)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    acceptance_criteria: Optional[List[ACTemplateItem]] = None
    default_strategy: Optional[str] = None
    default_max_turns: Optional[int] = None
    default_triggers: Optional[List[str]] = None
    recommended_agents: Optional[List[str]] = None
    estimated_duration_min: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class ForkRequest(BaseModel):
    new_name: Optional[str] = None
    new_tags: Optional[List[str]] = None


class InstantiateRequest(BaseModel):
    goal_id: Optional[str] = None


class ImportRequest(BaseModel):
    data: Dict[str, Any]
    new_template_id: Optional[str] = None


# ============================================================
# 健康检查 / 统计
# ============================================================
@router.get("/health")
async def health():
    """健康检查"""
    mgr = get_manager()
    return {
        "status": "ok",
        "version": "v6.33.0",
        "module": "goal-templates",
        **mgr.health_check(),
    }


@router.get("/stats")
async def stats():
    """统计信息"""
    mgr = get_manager()
    return {"success": True, "stats": mgr.get_stats()}


# ============================================================
# 模板 CRUD
# ============================================================
@router.get("/templates")
async def list_templates(
    category: Optional[str] = Query(None, description="按类别过滤"),
    source: Optional[str] = Query(None, description="按来源过滤"),
    tag: Optional[str] = Query(None, description="按标签过滤"),
    keyword: Optional[str] = Query(None, description="按关键词搜索"),
    limit: int = Query(100, ge=1, le=500),
):
    """列出模板（支持过滤）"""
    mgr = get_manager()
    templates = mgr.list_templates(
        category=category, source=source, tag=tag, keyword=keyword
    )
    templates = templates[:limit]
    return {
        "success": True,
        "count": len(templates),
        "templates": [t.to_dict() for t in templates],
    }


@router.get("/templates/{template_id}")
async def get_template(template_id: str):
    """获取模板详情"""
    mgr = get_manager()
    tpl = mgr.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")
    return {"success": True, "template": tpl.to_dict()}


@router.post("/templates")
async def create_template(req: TemplateCreateRequest):
    """注册新模板"""
    mgr = get_manager()
    if not req.acceptance_criteria:
        raise HTTPException(status_code=400, detail="acceptance_criteria must not be empty")

    tpl = GoalTemplate(
        template_id="",  # 由 register_template 生成
        name=req.name,
        description=req.description,
        category=req.category,
        source=TemplateSource.CUSTOM.value,
        tags=req.tags,
        acceptance_criteria=[
            AcceptanceCriterionTemplate.from_dict(ac.model_dump()) for ac in req.acceptance_criteria
        ],
        default_strategy=req.default_strategy,
        default_max_turns=req.default_max_turns,
        default_triggers=req.default_triggers,
        recommended_agents=req.recommended_agents,
        estimated_duration_min=req.estimated_duration_min,
        metadata=req.metadata,
        created_by="user",
    )
    try:
        saved = mgr.register_template(tpl)
        return {"success": True, "template": saved.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/templates/{template_id}")
async def update_template(template_id: str, req: TemplateUpdateRequest):
    """更新模板（仅自定义模板可更新）"""
    mgr = get_manager()
    existing = mgr.get_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")
    if existing.is_builtin():
        raise HTTPException(status_code=400, detail="Cannot modify builtin template; please fork first")

    data = existing.to_dict()
    update_data = req.model_dump(exclude_unset=True)

    if "acceptance_criteria" in update_data and update_data["acceptance_criteria"] is not None:
        update_data["acceptance_criteria"] = [
            ac if isinstance(ac, dict) else ac.model_dump()
            for ac in update_data["acceptance_criteria"]
        ]

    data.update({k: v for k, v in update_data.items() if v is not None})
    updated = GoalTemplate.from_dict(data)

    try:
        saved = mgr.register_template(updated)
        return {"success": True, "template": saved.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    """注销模板（仅自定义模板可注销）"""
    mgr = get_manager()
    ok = mgr.unregister_template(template_id)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot unregister template {template_id} (not found or builtin)",
        )
    return {"success": True, "template_id": template_id, "unregistered": True}


# ============================================================
# Fork / 实例化
# ============================================================
@router.post("/templates/{template_id}/fork")
async def fork_template(template_id: str, req: ForkRequest):
    """Fork 模板（生成可编辑副本）"""
    mgr = get_manager()
    forked = mgr.fork_template(
        template_id,
        new_name=req.new_name,
        new_tags=req.new_tags,
    )
    if not forked:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")
    try:
        saved = mgr.register_template(forked)
        return {"success": True, "template": saved.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/templates/{template_id}/instantiate")
async def instantiate_template(template_id: str, req: InstantiateRequest):
    """实例化模板为 Goal 配置"""
    mgr = get_manager()
    result = mgr.instantiate(template_id, goal_id=req.goal_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")
    tpl, inst, goal_config = result
    return {
        "success": True,
        "template_id": template_id,
        "instantiation": inst.to_dict(),
        "goal_config": goal_config,
    }


# ============================================================
# 导入/导出
# ============================================================
@router.get("/templates/{template_id}/export")
async def export_template(template_id: str):
    """导出模板为 JSON 字典"""
    mgr = get_manager()
    data = mgr.export_template(template_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Template {template_id} not found")
    return {"success": True, "template": data}


@router.post("/templates/import")
async def import_template(req: ImportRequest):
    """从 JSON 字典导入模板"""
    mgr = get_manager()
    try:
        saved = mgr.import_template(req.data, new_template_id=req.new_template_id)
        return {"success": True, "template": saved.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# 实例化历史
# ============================================================
@router.get("/instantiations")
async def list_instantiations(
    template_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    """列出实例化历史"""
    mgr = get_manager()
    history = mgr.get_instantiation_history(template_id=template_id, limit=limit)
    return {
        "success": True,
        "count": len(history),
        "history": [i.to_dict() for i in history],
    }


# ============================================================
# Meta 端点
# ============================================================
@router.get("/meta/categories")
async def list_categories():
    """类别枚举"""
    return {
        "success": True,
        "categories": [
            {"value": c.value, "name": c.name}
            for c in TemplateCategory
        ],
    }


@router.get("/meta/sources")
async def list_sources():
    """来源枚举"""
    return {
        "success": True,
        "sources": [{"value": s.value, "name": s.name} for s in TemplateSource],
    }
