"""
# ============================================================
# Project Agents API - .trae/agents/ 子智能体 REST 端点 (Cycle 9 P0-17)
# ============================================================
# 核心作用：提供 .trae/agents/ 目录扫描、注册、查询、调用的 REST API
# 端点：
#   - POST /api/project-agents/scan            扫描并注册项目
#   - GET  /api/project-agents/list            列出已注册智能体
#   - GET  /api/project-agents/{name}          查询单个智能体
#   - POST /api/project-agents/refresh         刷新项目
#   - POST /api/project-agents/resolve         解析 @ 引用
#   - POST /api/project-agents/suggest         智能推荐
#   - DELETE /api/project-agents/{project_path} 注销项目
#   - GET  /api/project-agents/stats           注册表统计
#   - GET  /api/project-agents/health          健康检查
# 输入参数：通过请求体或查询参数传递
# 输出结果：JSON 格式响应
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-17 新建
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.project_agents import (
    ProjectAgent,
    get_global_registry,
    extract_at_references,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Project Agents"])


# ============================================================
# 路径白名单（与其他 API 保持一致）
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


# ============================================================
# 请求/响应模型
# ============================================================


class ScanRequest(BaseModel):
    """扫描请求"""

    project_path: str = Field(..., description="项目根目录绝对路径")


class ResolveRequest(BaseModel):
    """解析 @ 引用请求"""

    text: str = Field(..., description="用户输入文本")
    project_path: Optional[str] = Field(
        default=None, description="项目根目录；None 时跨项目查找"
    )


class SuggestRequest(BaseModel):
    """智能推荐请求"""

    query: str = Field(..., description="用户查询或任务描述")
    project_path: Optional[str] = Field(default=None, description="项目根目录")
    top_k: int = Field(default=3, ge=1, le=10, description="返回前 k 个")


class ApiResponse(BaseModel):
    """统一响应"""

    success: bool
    action: str
    data: Dict[str, Any]


# ============================================================
# 端点实现
# ============================================================


@router.post("/scan", response_model=ApiResponse)
async def scan_agents(req: ScanRequest) -> ApiResponse:
    """扫描并注册项目的 .trae/agents/ 子智能体

    - 递归扫描 .trae/agents/**/*.md
    - 解析 YAML frontmatter
    - 注册到全局 registry
    """
    project_path = _validate_project_path(req.project_path)
    try:
        registry = get_global_registry()
        count = registry.register_project(project_path)
        agents = registry.list_agents(project_path)
        return ApiResponse(
            success=True,
            action="scan",
            data={
                "project_path": project_path,
                "registered": count,
                "agents": [a.to_dict() for a in agents],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=ApiResponse)
async def list_agents(
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """列出已注册的子智能体"""
    try:
        registry = get_global_registry()
        pp = _validate_project_path(project_path) if project_path else None
        agents = registry.list_agents(pp)
        return ApiResponse(
            success=True,
            action="list",
            data={
                "project_path": pp,
                "count": len(agents),
                "agents": [
                    {
                        "name": a.name,
                        "description": a.description,
                        "callable": a.callable,
                        "when_to_call": a.when_to_call,
                        "model": a.model,
                        "file_path": a.file_path,
                    }
                    for a in agents
                ],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/by-name/{name}", response_model=ApiResponse)
async def get_agent_by_name(
    name: str,
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """按 name 查询单个智能体的完整定义"""
    try:
        registry = get_global_registry()
        pp = _validate_project_path(project_path) if project_path else None
        agent = registry.get_agent(name, pp)
        if agent is None:
            raise HTTPException(
                status_code=404, detail=f"Agent not found: {name}"
            )
        return ApiResponse(
            success=True,
            action="get",
            data={"agent": agent.to_dict()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh", response_model=ApiResponse)
async def refresh_agents(req: ScanRequest) -> ApiResponse:
    """刷新某个项目的子智能体注册"""
    project_path = _validate_project_path(req.project_path)
    try:
        registry = get_global_registry()
        count = registry.register_project(project_path)
        return ApiResponse(
            success=True,
            action="refresh",
            data={"project_path": project_path, "registered": count},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resolve", response_model=ApiResponse)
async def resolve_references(req: ResolveRequest) -> ApiResponse:
    """解析文本中的 @ 引用

    输入示例："请 @code-architect 优化 @security-reviewer 模块"
    """
    try:
        registry = get_global_registry()
        pp = _validate_project_path(req.project_path) if req.project_path else None
        refs = registry.resolve_references(req.text, pp)
        names = extract_at_references(req.text)
        return ApiResponse(
            success=True,
            action="resolve",
            data={
                "input_text": req.text,
                "referenced_names": names,
                "resolved": {
                    name: (agent.to_dict() if agent else None)
                    for name, agent in refs.items()
                },
                "all_resolved": all(a is not None for a in refs.values()) if refs else True,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"resolve failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest", response_model=ApiResponse)
async def suggest_agents(req: SuggestRequest) -> ApiResponse:
    """根据查询推荐子智能体（按 when_to_call 关键词匹配）"""
    try:
        registry = get_global_registry()
        pp = _validate_project_path(req.project_path) if req.project_path else None
        suggestions = registry.find_suggested(req.query, pp, req.top_k)
        return ApiResponse(
            success=True,
            action="suggest",
            data={
                "query": req.query,
                "suggestions": [
                    {
                        "agent": {
                            "name": a.name,
                            "description": a.description,
                            "when_to_call": a.when_to_call,
                            "model": a.model,
                            "file_path": a.file_path,
                        },
                        "score": round(score, 4),
                    }
                    for a, score in suggestions
                ],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"suggest failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/project", response_model=ApiResponse)
async def unregister_project(req: ScanRequest) -> ApiResponse:
    """注销某个项目的子智能体"""
    project_path = _validate_project_path(req.project_path)
    try:
        registry = get_global_registry()
        ok = registry.unregister_project(project_path)
        if not ok:
            raise HTTPException(
                status_code=404, detail=f"Project not registered: {project_path}"
            )
        return ApiResponse(
            success=True,
            action="unregister",
            data={"project_path": project_path, "unregistered": True},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"unregister failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=ApiResponse)
async def get_stats() -> ApiResponse:
    """获取注册表统计信息"""
    try:
        registry = get_global_registry()
        stats = registry.get_stats()
        projects = registry.list_project_paths()
        return ApiResponse(
            success=True,
            action="stats",
            data={"stats": stats, "projects": projects},
        )
    except Exception as e:
        logger.error(f"stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """健康检查"""
    return {
        "status": "ok",
        "service": "project-agents",
        "version": "1.0.0",
        "cycle": "9",
    }
