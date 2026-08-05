"""
# ============================================================
# Plugins v2 API 路由
# Cycle 70 G70-01 - 对标 Codex CLI Plugins 本地注册
# ============================================================
# 端点：
#   - GET    /api/plugins-v2/list                列出所有 plugins
#   - POST   /api/plugins-v2/install             安装 plugin（zip upload）
#   - GET    /api/plugins-v2/{id}                获取 plugin 详情
#   - POST   /api/plugins-v2/{id}/enable         启用
#   - POST   /api/plugins-v2/{id}/disable        禁用
#   - DELETE /api/plugins-v2/{id}                卸载
# 创建日期：2026-08-05
# 模块版本：v1.0.0
# ============================================================
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query, UploadFile, File

from backend.app.services.plugin_registry import get_plugin_registry

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/plugins-v2/list")
async def list_plugins(
    enabled_only: bool = Query(False, description="仅返回启用的"),
):
    """列出所有 plugins"""
    registry = get_plugin_registry()
    plugins = registry.list_plugins(enabled_only=enabled_only)
    return {
        "success": True,
        "plugins": [p.to_dict() for p in plugins],
        "count": len(plugins),
    }


@router.post("/plugins-v2/install")
async def install_plugin(
    file: UploadFile = File(...),
    force: bool = Query(False, description="是否覆盖同名 plugin"),
):
    """从 zip 上传安装 plugin"""
    registry = get_plugin_registry()
    try:
        zip_bytes = await file.read()
        plugin = registry.install_from_zip(zip_bytes, force=force)
        return {
            "success": True,
            "plugin": plugin.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Plugin 安装失败")
        raise HTTPException(status_code=500, detail=f"安装失败: {e}")


@router.post("/plugins-v2/install-path")
async def install_plugin_from_path(body: Dict[str, Any]):
    """从本地路径安装 plugin

    请求体：
      {
        "source_path": "/path/to/plugin-dir",
        "force": false
      }
    """
    registry = get_plugin_registry()
    source_path = body.get("source_path", "").strip()
    if not source_path:
        raise HTTPException(status_code=400, detail="source_path 字段不能为空")

    force = body.get("force", False)
    try:
        plugin = registry.install_from_path(source_path, force=force)
        return {
            "success": True,
            "plugin": plugin.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Plugin 安装失败")
        raise HTTPException(status_code=500, detail=f"安装失败: {e}")


@router.get("/plugins-v2/{plugin_id}")
async def get_plugin(plugin_id: str):
    """获取 plugin 详情"""
    registry = get_plugin_registry()
    plugin = registry.get_plugin(plugin_id)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin 不存在: {plugin_id}")
    return {
        "success": True,
        "plugin": plugin.to_dict(),
    }


@router.post("/plugins-v2/{plugin_id}/enable")
async def enable_plugin(plugin_id: str):
    """启用 plugin"""
    registry = get_plugin_registry()
    plugin = registry.set_enabled(plugin_id, True)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin 不存在: {plugin_id}")
    return {
        "success": True,
        "plugin": plugin.to_dict(),
    }


@router.post("/plugins-v2/{plugin_id}/disable")
async def disable_plugin(plugin_id: str):
    """禁用 plugin"""
    registry = get_plugin_registry()
    plugin = registry.set_enabled(plugin_id, False)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin 不存在: {plugin_id}")
    return {
        "success": True,
        "plugin": plugin.to_dict(),
    }


@router.delete("/plugins-v2/{plugin_id}")
async def uninstall_plugin(plugin_id: str):
    """卸载 plugin"""
    registry = get_plugin_registry()
    success = registry.uninstall(plugin_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Plugin 不存在: {plugin_id}")
    return {
        "success": True,
        "message": f"Plugin {plugin_id} 已卸载",
    }
