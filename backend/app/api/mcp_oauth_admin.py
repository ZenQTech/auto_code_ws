"""
# ============================================================
# MCP OAuth 管理 API 路由
# ============================================================
# 核心作用：提供 OAuth 客户端/Token 的管理接口
# 端点：
#   - GET    /api/mcp/oauth/clients       列出所有已注册客户端
#   - DELETE /api/mcp/oauth/clients/{id}  撤销客户端
#   - GET    /api/mcp/oauth/stats         获取存储统计
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import logging
from fastapi import APIRouter

from app.services.mcp.oauth import get_oauth_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/mcp/oauth/clients")
async def list_oauth_clients():
    """
    列出所有已注册的 OAuth 客户端
    """
    service = get_oauth_service()
    clients = await service.list_clients()
    return {
        "success": True,
        "count": len(clients),
        "clients": clients,
    }


@router.delete("/mcp/oauth/clients/{client_id}")
async def delete_oauth_client(client_id: str):
    """
    撤销 OAuth 客户端（同时撤销其所有 token）
    """
    service = get_oauth_service()
    success = await service.delete_client(client_id)
    if not success:
        return {"success": False, "error": "客户端不存在"}
    return {"success": True, "client_id": client_id}


@router.get("/mcp/oauth/stats")
async def get_oauth_stats():
    """
    获取 OAuth 存储统计信息
    """
    service = get_oauth_service()
    stats = await service.get_stats()
    return {
        "success": True,
        **stats,
    }
