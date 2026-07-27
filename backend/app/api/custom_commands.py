"""
# ============================================================
# Custom Commands API - 自定义命令 REST API
# ============================================================
# 核心作用：提供 .trae/commands/ 自定义命令的 HTTP 接口
# 端点：
#   GET    /api/custom-commands              - 列出所有命令
#   GET    /api/custom-commands/scope/{scope} - 按 scope 列出
#   GET    /api/custom-commands/categories    - 列出分类
#   GET    /api/custom-commands/{name}        - 查询命令详情
#   POST   /api/custom-commands/{name}/execute - 执行命令
#   POST   /api/custom-commands/refresh       - 重新扫描目录
#   POST   /api/custom-commands               - 创建命令
#   DELETE /api/custom-commands/{name}        - 删除命令
#   GET    /api/custom-commands/summary       - 摘要
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-13
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.custom_commands.parser import (
    CustomCommand,
    parse_command_content,
)
from app.services.custom_commands.scanner import (
    CustomCommandsScanner,
    ScanResult,
    create_sample_command,
)
from app.services.custom_commands.service import (
    CommandExecutionResult,
    CustomCommandsService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/custom-commands", tags=["custom-commands"])


# ============================================================
# 服务初始化
# ============================================================

def get_service() -> CustomCommandsService:
    """获取单例服务"""
    return CustomCommandsService.get_instance()


def get_scanner() -> CustomCommandsScanner:
    """获取单例扫描器"""
    return CustomCommandsScanner.get_instance()


def ensure_initialized(project_path: Optional[str] = None) -> CustomCommandsService:
    """确保服务已初始化（首次访问时自动扫描）"""
    service = get_service()
    if not service.list_commands():
        try:
            service.refresh(project_path=project_path)
        except Exception as e:
            logger.warning(f"自动扫描失败: {e}")
    return service


# ============================================================
# 请求/响应模型
# ============================================================

class ExecuteCommandRequest(BaseModel):
    """执行命令请求"""
    args: Dict[str, str] = Field(default_factory=dict)


class CreateCommandRequest(BaseModel):
    """创建命令请求"""
    name: str
    description: str
    instructions: str
    category: str = "general"
    icon: str = "📦"
    scope: str = "project"  # project | global
    project_path: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)


# ============================================================
# 端点
# ============================================================

@router.get("/summary")
async def get_summary(
    project_path: Optional[str] = Query(None, description="项目根路径（可选）"),
) -> Dict[str, Any]:
    """获取摘要信息"""
    service = ensure_initialized(project_path)
    return {
        "success": True,
        "summary": service.get_summary(),
    }


@router.get("/categories")
async def list_categories(
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出所有分类"""
    service = ensure_initialized(project_path)
    return {
        "success": True,
        "categories": service.list_categories(),
        "total": len(service.list_categories()),
    }


@router.get("/scope/{scope}")
async def list_by_scope(
    scope: str,
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """按 scope 列出命令"""
    if scope not in ("project", "global"):
        raise HTTPException(status_code=400, detail="scope must be 'project' or 'global'")
    service = ensure_initialized(project_path)
    commands = service.list_commands(scope=scope)
    return {
        "success": True,
        "scope": scope,
        "commands": [c.to_dict() for c in commands],
        "total": len(commands),
    }


@router.get("")
async def list_commands(
    scope: Optional[str] = Query(None, description="project | global"),
    category: Optional[str] = Query(None, description="分类名"),
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出所有命令"""
    service = ensure_initialized(project_path)
    commands = service.list_commands(scope=scope, category=category)
    return {
        "success": True,
        "commands": [c.to_dict() for c in commands],
        "total": len(commands),
        "categories": service.list_categories(),
    }


@router.get("/{name}")
async def get_command(
    name: str,
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """查询命令详情"""
    service = ensure_initialized(project_path)
    cmd = service.get_command(name)
    if cmd is None:
        raise HTTPException(status_code=404, detail=f"Command not found: {name}")
    return {
        "success": True,
        "command": cmd.to_dict(),
    }


@router.post("/{name}/execute")
async def execute_command(
    name: str,
    request: ExecuteCommandRequest,
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """执行命令（生成 LLM 提示词）"""
    service = ensure_initialized(project_path)
    result = service.execute_command(name, request.args)
    return {
        "success": result.success,
        "result": result.to_dict(),
    }


@router.post("/refresh")
async def refresh(
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """重新扫描目录"""
    service = get_service()
    result = service.refresh(project_path=project_path)
    return {
        "success": True,
        "scan": result.to_dict(),
    }


@router.post("")
async def create_command(request: CreateCommandRequest) -> Dict[str, Any]:
    """创建命令（写入 .md 文件）"""
    if request.scope == "project" and not request.project_path:
        raise HTTPException(status_code=400, detail="project_path required for project scope")

    file_path = create_sample_command(
        name=request.name,
        description=request.description,
        instructions=request.instructions,
        category=request.category,
        icon=request.icon,
        scope=request.scope,
        project_path=request.project_path,
    )
    if file_path is None:
        raise HTTPException(status_code=500, detail="创建失败")

    # 刷新服务
    service = get_service()
    service.refresh(project_path=request.project_path)

    return {
        "success": True,
        "file_path": str(file_path),
        "name": request.name,
    }


@router.delete("/{name}")
async def delete_command(
    name: str,
    project_path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """删除命令（仅从内存中注销，不删除磁盘文件）"""
    service = get_service()
    removed = service.unregister_command(name)
    return {
        "success": removed,
        "name": name,
        "message": "已注销" if removed else "未找到",
    }
