"""
# ============================================================
# Skill Progressive Disclosure API (Cycle 9 P1-5)
# ============================================================
# 核心作用：实现 Codex v0.135+ SKILL.md Progressive Disclosure REST API
#           - 初始仅返回 8K cap 的 skill 摘要列表
#           - 按需加载完整 SKILL.md 内容
# 端点：
#   - POST /api/skills-progressive/scan          扫描并注册项目
#   - GET  /api/skills-progressive/list          列出摘要
#   - GET  /api/skills-progressive/summaries     仅返回摘要（轻量）
#   - GET  /api/skills-progressive/{name}        加载完整 skill
#   - DELETE /api/skills-progressive/project     注销项目
#   - GET  /api/skills-progressive/stats         注册表统计
#   - GET  /api/skills-progressive/health        健康检查
# 输入参数：通过查询参数或请求体传递
# 输出结果：JSON 格式响应
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P1-5 新建
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.skill_progressive import (
    SkillProgressiveScanner,
    SkillsProgressiveRegistry,
    get_global_registry,
    reset_global_registry,
    SUMMARY_CAP_BYTES,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Skills Progressive"])


# ============================================================
# 路径白名单
# ============================================================
ALLOWED_PROJECT_PATHS = [
    "/home/qizheng/auto_code_ws",
    "/home/qizheng/auto_code_data",
    "/tmp/test-projects",
    "/tmp",
]


def _validate_project_path(project_path: str) -> str:
    """校验并规范化项目路径

    Args:
        project_path: 任意项目路径

    Returns:
        绝对路径

    Raises:
        HTTPException: 路径不在白名单或不存在
    """
    import os

    abs_path = os.path.abspath(project_path)
    for allowed in ALLOWED_PROJECT_PATHS:
        if abs_path == allowed or abs_path.startswith(allowed + "/"):
            if not os.path.isdir(abs_path):
                raise HTTPException(
                    status_code=404, detail=f"Project path not found: {abs_path}"
                )
            return abs_path
    raise HTTPException(
        status_code=403, detail=f"Project path not in whitelist: {abs_path}"
    )


def _validate_skill_name(name: str) -> str:
    """校验 skill 名称"""
    import re

    if not re.match(r"^[A-Za-z0-9_\-\.]{1,64}$", name):
        raise HTTPException(
            status_code=400, detail=f"Invalid skill name: {name}"
        )
    return name


# ============================================================
# 请求/响应模型
# ============================================================


class ScanRequest(BaseModel):
    """扫描请求"""

    project_path: str = Field(..., description="项目根目录绝对路径")
    cap_bytes: int = Field(
        default=SUMMARY_CAP_BYTES,
        description="单项目摘要字节上限（默认 8K）",
    )


class ApiResponse(BaseModel):
    """统一响应"""

    success: bool
    action: str
    data: Dict[str, Any]


# ============================================================
# 端点实现
# ============================================================


@router.post("/scan", response_model=ApiResponse)
async def scan_skills(req: ScanRequest) -> ApiResponse:
    """扫描并注册项目的 .trae/skills/ 技能

    渐进式加载策略：
      - 初始仅加载 name + description（受 8K cap 限制）
      - 完整内容需调用 /{name} 端点按需加载
    """
    project_path = _validate_project_path(req.project_path)
    try:
        registry = get_global_registry()
        count = registry.register_project(project_path, req.cap_bytes)
        summaries = registry.list_all_summaries(project_path)
        total_bytes = sum(s.summary_size for s in summaries)
        return ApiResponse(
            success=True,
            action="scan",
            data={
                "project_path": project_path,
                "registered": count,
                "total_bytes": total_bytes,
                "cap_bytes": req.cap_bytes,
                "summaries": [s.to_dict() for s in summaries],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"scan skills failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=ApiResponse)
async def list_skills(
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """列出已注册技能摘要（轻量）"""
    try:
        registry = get_global_registry()
        pp = _validate_project_path(project_path) if project_path else None
        summaries = registry.list_all_summaries(pp)
        total_bytes = sum(s.summary_size for s in summaries)
        return ApiResponse(
            success=True,
            action="list",
            data={
                "project_path": pp,
                "count": len(summaries),
                "total_bytes": total_bytes,
                "summaries": [s.to_dict() for s in summaries],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list skills failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summaries", response_model=ApiResponse)
async def list_summaries_only(
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """仅返回摘要字段（最小化负载）"""
    try:
        registry = get_global_registry()
        pp = _validate_project_path(project_path) if project_path else None
        summaries = registry.list_all_summaries(pp)
        return ApiResponse(
            success=True,
            action="summaries",
            data={
                "count": len(summaries),
                "summaries": [
                    {
                        "name": s.name,
                        "description": s.description,
                        "when_to_use": s.when_to_use,
                    }
                    for s in summaries
                ],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"summaries failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/by-name/{name}", response_model=ApiResponse)
async def get_skill_full(
    name: str,
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """按 name 加载完整 skill 定义（on-demand）"""
    name = _validate_skill_name(name)
    try:
        registry = get_global_registry()
        pp = _validate_project_path(project_path) if project_path else None
        full = registry.load_full(name, pp)
        if full is None:
            raise HTTPException(
                status_code=404, detail=f"Skill not found: {name}"
            )
        return ApiResponse(
            success=True,
            action="get_full",
            data={"skill": full.to_dict()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_skill_full failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/project", response_model=ApiResponse)
async def unregister_project(
    project_path: str = Query(..., description="项目根目录"),
) -> ApiResponse:
    """注销某个项目的技能摘要"""
    pp = _validate_project_path(project_path)
    try:
        registry = get_global_registry()
        ok = registry.unregister_project(pp)
        if not ok:
            raise HTTPException(
                status_code=404, detail=f"Project not registered: {pp}"
            )
        return ApiResponse(
            success=True,
            action="unregister",
            data={"project_path": pp, "unregistered": True},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"unregister failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=ApiResponse)
async def get_stats() -> ApiResponse:
    """获取注册表统计"""
    try:
        registry = get_global_registry()
        stats = registry.get_stats()
        return ApiResponse(
            success=True,
            action="stats",
            data={"stats": stats},
        )
    except Exception as e:
        logger.error(f"stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """健康检查"""
    return {
        "status": "ok",
        "service": "skills-progressive",
        "version": "1.0.0",
        "cycle": "9",
        "default_cap_bytes": SUMMARY_CAP_BYTES,
    }
