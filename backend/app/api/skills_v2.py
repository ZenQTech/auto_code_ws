"""
# ============================================================
# Skills v2 API 路由
# Cycle 70 G70-01 - 对标 Codex CLI Skills 5 位置注册表
# ============================================================
# 端点：
#   - GET    /api/skills-v2/list                 列出所有 skills（按 location 过滤）
#   - GET    /api/skills-v2/locations            列出 5 位置扫描状态
#   - POST   /api/skills-v2/rescan               强制重新扫描
#   - POST   /api/skills-v2/{name}/enable        启用 skill
#   - POST   /api/skills-v2/{name}/disable       禁用 skill
#   - GET    /api/skills-v2/{name}               获取 skill 详情
# 创建日期：2026-08-05
# 模块版本：v1.0.0
# ============================================================
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query

from backend.app.services.skill_registry import get_skill_registry

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/skills-v2/list")
async def list_skills_v2(
    location: Optional[str] = Query(None, description="按 location 过滤"),
    enabled_only: bool = Query(False, description="仅返回启用的"),
):
    """列出所有 skills"""
    registry = get_skill_registry()
    skills = registry.list_skills(location=location, enabled_only=enabled_only)
    return {
        "success": True,
        "skills": [s.to_dict() for s in skills],
        "count": len(skills),
        "by_location": registry.get_by_location_counts(),
        "conflicts": [c.to_dict() for c in registry.get_conflicts()],
    }


@router.get("/skills-v2/locations")
async def list_locations():
    """列出 5 位置的扫描状态"""
    registry = get_skill_registry()
    statuses = registry.get_location_status()
    return {
        "success": True,
        "locations": [s.to_dict() for s in statuses],
    }


@router.post("/skills-v2/rescan")
async def rescan(body: Dict[str, Any]):
    """强制重新扫描所有 5 位置

    请求体：
      {
        "repo_root": "/path/to/repo"  // 可选
      }
    """
    registry = get_skill_registry()
    repo_root = body.get("repo_root")
    result = registry.rescan(repo_root=repo_root)
    return {
        "success": True,
        **result,
    }


@router.get("/skills-v2/{name}")
async def get_skill(name: str):
    """获取 skill 详情（按 name）"""
    registry = get_skill_registry()
    skill = registry.get_skill_by_name(name)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {name}")
    return {
        "success": True,
        "skill": skill.to_dict(),
    }


@router.post("/skills-v2/{name}/enable")
async def enable_skill(name: str):
    """启用 skill"""
    registry = get_skill_registry()
    skill = registry.get_skill_by_name(name)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {name}")
    updated = registry.set_enabled(skill.id, True)
    return {
        "success": True,
        "skill": updated.to_dict() if updated else None,
    }


@router.post("/skills-v2/{name}/disable")
async def disable_skill(name: str):
    """禁用 skill"""
    registry = get_skill_registry()
    skill = registry.get_skill_by_name(name)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {name}")
    updated = registry.set_enabled(skill.id, False)
    return {
        "success": True,
        "skill": updated.to_dict() if updated else None,
    }
