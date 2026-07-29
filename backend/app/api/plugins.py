"""
# ============================================================
# Hermes Plugin System - REST API
# ============================================================
# 核心作用：提供 Plugin 系统的 REST API 端点
# 端点：
#   - GET  /health                       健康检查
#   - GET  /list                         列出所有 Plugin
#   - GET  /stats                        统计信息
#   - POST /scan                         扫描目录
#   - POST /install                      安装 Plugin
#   - POST /uninstall                    卸载 Plugin
#   - POST /enable                       启用 Plugin
#   - POST /disable                      禁用 Plugin
#   - GET  /{plugin_id}                  Plugin 详情
#   - POST /{plugin_id}/reload           重新加载
#   - GET  /marketplace/search           搜索 Plugin
#   - GET  /categories/list              列出所有分类
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.plugins import (
    PluginInstaller,
    PluginNotFoundError,
    PluginStatus,
    get_installer,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Plugin System"])


# ============================================================
# Pydantic 模型
# ============================================================
class InstallRequest(BaseModel):
    """安装请求"""
    source_path: str = Field(..., description="源路径（本地绝对路径）")


class PluginIdRequest(BaseModel):
    """Plugin ID 请求"""
    plugin_id: str = Field(..., description="Plugin ID")


# ============================================================
# 工具函数
# ============================================================
def _get_installer() -> PluginInstaller:
    """获取安装器"""
    return get_installer()


# ============================================================
# 端点实现
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    installer = _get_installer()
    stats = installer.registry.get_stats()
    return {
        "success": True,
        "service": "plugins",
        "version": "1.0.0",
        "total_plugins": stats["total"],
        "enabled_plugins": stats["enabled"],
        "features": [
            "plugin_discovery",
            "manifest_validation",
            "dependency_resolution",
            "signature_verification",
            "lifecycle_management",
            "marketplace_search",
        ],
    }


@router.get("/list")
async def list_plugins(
    status: Optional[str] = Query(None, description="按状态过滤"),
    category: Optional[str] = Query(None, description="按分类过滤"),
    enabled_only: bool = Query(False, description="仅启用的"),
) -> Dict[str, Any]:
    """列出所有 Plugin"""
    installer = _get_installer()
    plugins = installer.registry.list_all()
    if enabled_only:
        plugins = [p for p in plugins if p.enabled]
    if status:
        try:
            target_status = PluginStatus(status)
            plugins = [p for p in plugins if p.status == target_status]
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status}",
            )
    if category:
        plugins = installer.registry.list_by_category(category)
    return {
        "success": True,
        "count": len(plugins),
        "plugins": [p.to_dict() for p in plugins],
    }


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """统计信息"""
    installer = _get_installer()
    return {
        "success": True,
        "data": installer.get_stats(),
    }


@router.post("/scan")
async def scan() -> Dict[str, Any]:
    """扫描所有 Plugin 目录"""
    installer = _get_installer()
    count = installer.scan_and_register()
    return {
        "success": True,
        "scanned": count,
        "message": f"Scanned and registered {count} plugins",
    }


@router.post("/install")
async def install(request: InstallRequest) -> Dict[str, Any]:
    """从本地路径安装 Plugin"""
    installer = _get_installer()
    try:
        from pathlib import Path
        plugin = installer.install(Path(request.source_path))
        return {
            "success": True,
            "plugin": plugin.to_dict(),
            "message": f"Plugin {plugin.manifest.id} installed successfully",
        }
    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        logger.error(f"Install failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/uninstall")
async def uninstall(request: PluginIdRequest) -> Dict[str, Any]:
    """卸载 Plugin"""
    installer = _get_installer()
    try:
        installer.uninstall(request.plugin_id)
        return {
            "success": True,
            "message": f"Plugin {request.plugin_id} uninstalled",
        }
    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        logger.error(f"Uninstall failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/enable")
async def enable(request: PluginIdRequest) -> Dict[str, Any]:
    """启用 Plugin"""
    installer = _get_installer()
    try:
        plugin = installer.enable(request.plugin_id)
        return {
            "success": True,
            "plugin": plugin.to_dict(),
            "message": f"Plugin {request.plugin_id} enabled",
        }
    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)


@router.post("/disable")
async def disable(request: PluginIdRequest) -> Dict[str, Any]:
    """禁用 Plugin"""
    installer = _get_installer()
    try:
        plugin = installer.disable(request.plugin_id)
        return {
            "success": True,
            "plugin": plugin.to_dict(),
            "message": f"Plugin {request.plugin_id} disabled",
        }
    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)


@router.get("/{plugin_id}")
async def get_plugin(plugin_id: str) -> Dict[str, Any]:
    """获取 Plugin 详情"""
    installer = _get_installer()
    plugin = installer.registry.get_optional(plugin_id)
    if plugin is None:
        raise HTTPException(
            status_code=404,
            detail=f"Plugin not found: {plugin_id}",
        )
    return {
        "success": True,
        "plugin": plugin.to_dict(),
    }


@router.post("/{plugin_id}/reload")
async def reload_plugin(plugin_id: str) -> Dict[str, Any]:
    """重新加载 Plugin"""
    installer = _get_installer()
    try:
        plugin = installer.reload(plugin_id)
        return {
            "success": True,
            "plugin": plugin.to_dict(),
            "message": f"Plugin {plugin_id} reloaded",
        }
    except PluginNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        logger.error(f"Reload failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/marketplace/search")
async def marketplace_search(
    q: str = Query("", description="搜索关键词"),
    limit: int = Query(20, ge=1, le=100, description="返回数量限制"),
) -> Dict[str, Any]:
    """搜索 Plugin（marketplace 占位实现）"""
    installer = _get_installer()
    results = installer.registry.search(q)
    return {
        "success": True,
        "query": q,
        "count": len(results[:limit]),
        "plugins": [p.to_dict() for p in results[:limit]],
    }


@router.get("/categories/list")
async def list_categories() -> Dict[str, Any]:
    """列出所有分类"""
    installer = _get_installer()
    stats = installer.registry.get_stats()
    return {
        "success": True,
        "count": len(stats["categories"]),
        "categories": stats["categories"],
    }
