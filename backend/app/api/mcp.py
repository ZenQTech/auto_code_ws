"""
# ============================================================
# MCP API 路由
# ============================================================
# 核心作用：暴露 MCP 功能的 REST API
# 端点：
#   - GET    /api/mcp/tools              列出所有工具
#   - POST   /api/mcp/tools/call         调用工具
#   - GET    /api/mcp/servers            列出已注册 server
#   - POST   /api/mcp/servers            注册新 server
#   - DELETE /api/mcp/servers/{id}       注销 server
#   - POST   /api/mcp/servers/{id}/restart  重启 server（Cycle 3）
#   - GET    /api/mcp/servers/{id}/status   健康检查（Cycle 3）
#   - GET    /api/mcp/servers/{id}/logs     查看日志（Cycle 3）
#   - GET    /api/mcp/calls              查询最近调用日志
#   - GET    /api/mcp/permissions        列出所有权限（Cycle 3）
#   - PUT    /api/mcp/permissions        设置权限（Cycle 3）
#   - GET    /api/mcp/approvals/pending  待审批请求（Cycle 3）
#   - POST   /api/mcp/approvals/{id}/respond  响应审批（Cycle 3）
#   - GET    /api/mcp/audit-log          审计日志（Cycle 3）
# 创建日期：2026-07-27
# 模块版本：v1.2.0 - Cycle 3 权限控制 + 审计
# ============================================================
"""

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.mcp.client import get_mcp_client, MCPClient
from backend.app.services.mcp.external import (
    get_external_mcp_manager,
    ExternalMCPServerConfig,
    MCPTransport,
)
from backend.app.services.mcp.permissions import (
    get_permission_service,
    MCPPermissionService,
    PermissionMode,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class ToolCallRequest(BaseModel):
    """工具调用请求"""
    tool_name: str = Field(..., description="工具名称")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具参数")
    server_id: Optional[str] = Field(default=None, description="目标 server ID（默认 builtin）")


class ServerRegisterRequest(BaseModel):
    """注册 server 请求"""
    name: str = Field(..., description="显示名")
    transport: str = Field(..., description="stdio | streamable_http | sse")
    command: Optional[str] = Field(default=None, description="stdio 模式：可执行命令")
    args: Optional[list] = Field(default_factory=list, description="命令参数")
    url: Optional[str] = Field(default=None, description="streamable_http/sse 模式：URL")
    env: Optional[Dict[str, str]] = Field(default_factory=dict, description="环境变量")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="HTTP headers")
    enabled: Optional[bool] = Field(default=True, description="是否启用")
    startup_timeout_sec: Optional[int] = Field(default=20, description="启动超时")
    tool_timeout_sec: Optional[int] = Field(default=120, description="工具调用超时")
    auto_restart: Optional[bool] = Field(default=True, description="自动重启")
    max_restarts: Optional[int] = Field(default=3, description="最大重启次数")


# ============================================================
# 端点
# ============================================================

@router.get("/tools")
async def list_tools():
    """
    列出所有可用工具（合并内置 + 外部）
    """
    client = get_mcp_client()
    tools = await client.list_tools()
    return {
        "success": True,
        "tools": tools,
        "count": len(tools),
    }


@router.post("/tools/call")
async def call_tool(body: ToolCallRequest):
    """
    调用工具
    """
    client = get_mcp_client()
    result = await client.call_tool(
        tool_name=body.tool_name,
        arguments=body.arguments,
        server_id=body.server_id,
    )
    return {
        "success": result.get("success", False),
        "result": result,
    }


@router.get("/servers")
async def list_servers():
    """
    列出已注册 MCP server（内置 + 外部）
    Cycle 3 v1.0.0: 包含外部 server 状态
    """
    client = get_mcp_client()
    servers = [
        {
            "id": "builtin",
            "name": "hermes-builtin",
            "transport": "in-process",
            "enabled": True,
            "tool_count": 4,
        }
    ]
    for sid, server in client.external_servers.items():
        servers.append({
            "id": sid,
            "name": server.SERVER_NAME,
            "transport": "in-process",
            "enabled": True,
            "tool_count": 0,
        })

    # Cycle 3 v1.0.0: 合并外部 MCP 管理器
    try:
        mgr = get_external_mcp_manager()
        for srv in mgr.list_servers():
            servers.append({
                "id": srv["id"],
                "name": srv["name"],
                "transport": srv["transport"],
                "enabled": srv["enabled"],
                "tool_count": 0,  # 动态获取
                "status": srv.get("status", "stopped"),
                "command": srv.get("command"),
                "url": srv.get("url"),
            })
    except Exception as e:
        logger.warning(f"获取外部 server 列表失败: {e}")

    return {
        "success": True,
        "servers": servers,
        "count": len(servers),
    }


@router.post("/servers")
async def register_server(body: ServerRegisterRequest):
    """
    注册新的 MCP server
    Cycle 3 v1.0.0: 支持 stdio / streamable_http / sse 三种传输
    """
    # 验证传输类型
    valid_transports = {"stdio", "streamable_http", "sse", "in-process"}
    if body.transport not in valid_transports:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的传输: {body.transport}（支持: {valid_transports}）",
        )

    if body.transport == "in-process":
        return {
            "success": True,
            "message": f"已注册 {body.name}（in-process stub）",
            "server_id": "builtin",
        }

    # 验证必需字段
    if body.transport == "stdio" and not body.command:
        raise HTTPException(status_code=400, detail="stdio 模式必须指定 command")

    if body.transport in ("streamable_http", "sse") and not body.url:
        raise HTTPException(
            status_code=400,
            detail=f"{body.transport} 模式必须指定 url",
        )

    # 创建配置
    try:
        config = ExternalMCPServerConfig(
            id="",  # 自动生成
            name=body.name,
            transport=MCPTransport(body.transport),
            command=body.command,
            args=body.args or [],
            url=body.url,
            env=body.env or {},
            headers=body.headers or {},
            enabled=body.enabled if body.enabled is not None else True,
            startup_timeout_sec=body.startup_timeout_sec or 20,
            tool_timeout_sec=body.tool_timeout_sec or 120,
            auto_restart=body.auto_restart if body.auto_restart is not None else True,
            max_restarts=body.max_restarts or 3,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    mgr = get_external_mcp_manager()
    try:
        config = mgr.register(config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 自动启动
    started = await mgr.start(config.id)
    return {
        "success": True,
        "message": f"已注册 {body.name}（{body.transport}）",
        "server_id": config.id,
        "started": started,
    }


@router.delete("/servers/{server_id}")
async def unregister_server(server_id: str):
    """
    注销 MCP server
    """
    if server_id == "builtin":
        raise HTTPException(status_code=400, detail="不能注销内置 server")
    mgr = get_external_mcp_manager()
    success = mgr.unregister(server_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Server 不存在: {server_id}")
    return {
        "success": True,
        "message": f"已注销 {server_id}",
    }


# ============================================================
# Cycle 3 v1.0.0 新增：外部 server 生命周期管理
# ============================================================

@router.post("/servers/{server_id}/restart")
async def restart_server(server_id: str):
    """
    Cycle 3 v1.0.0: 重启外部 server
    """
    if server_id == "builtin":
        raise HTTPException(status_code=400, detail="不能重启内置 server")
    mgr = get_external_mcp_manager()
    success = await mgr.restart(server_id)
    if not success:
        raise HTTPException(status_code=500, detail=f"重启失败: {server_id}")
    return {
        "success": True,
        "message": f"已重启 {server_id}",
        "status": mgr.get_status(server_id),
    }


@router.get("/servers/{server_id}/status")
async def get_server_status(server_id: str):
    """
    Cycle 3 v1.0.0: 获取外部 server 健康状态
    """
    if server_id == "builtin":
        return {
            "id": "builtin",
            "name": "hermes-builtin",
            "status": "running",
            "uptime_sec": 0,
            "initialized": True,
        }
    mgr = get_external_mcp_manager()
    status = mgr.get_status(server_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Server 不存在: {server_id}")
    return {
        "success": True,
        **status,
    }


@router.get("/servers/{server_id}/logs")
async def get_server_logs(server_id: str, limit: int = 100):
    """
    Cycle 3 v1.0.0: 获取外部 server 日志
    """
    mgr = get_external_mcp_manager()
    logs = mgr.get_logs(server_id, limit=limit)
    return {
        "success": True,
        "logs": logs,
        "count": len(logs),
    }


@router.get("/calls")
async def list_calls(limit: int = 50):
    """
    查询最近调用日志
    """
    client = get_mcp_client()
    log = client.get_call_log(limit=limit)
    return {
        "success": True,
        "calls": log,
        "count": len(log),
    }


# ============================================================
# Cycle 3 v1.0.0: MCP 权限控制 + 审批 + 审计
# ============================================================

class PermissionSetRequest(BaseModel):
    """设置权限请求"""
    tool_name: str = Field(..., description="工具名")
    mode: str = Field(..., description="权限模式: auto/manual/blocked")
    server_id: Optional[str] = Field(default="builtin", description="server ID")
    updated_by: Optional[str] = Field(default="user", description="更新者")
    reason: Optional[str] = Field(default="", description="原因")


class ApprovalResponseRequest(BaseModel):
    """审批响应请求"""
    decision: str = Field(..., description="approved | rejected")
    decided_by: Optional[str] = Field(default="user", description="决策者")
    reason: Optional[str] = Field(default="", description="决策原因")


@router.get("/permissions")
async def list_permissions():
    """
    Cycle 3 v1.0.0: 列出所有工具权限
    """
    svc = get_permission_service()
    permissions = svc.list_permissions()
    return {
        "success": True,
        "permissions": permissions,
        "count": len(permissions),
    }


@router.put("/permissions")
async def set_permission(body: PermissionSetRequest):
    """
    Cycle 3 v1.0.0: 设置工具权限
    """
    svc = get_permission_service()
    try:
        perm = svc.set_permission(
            tool_name=body.tool_name,
            mode=body.mode,
            server_id=body.server_id or "builtin",
            updated_by=body.updated_by or "user",
            reason=body.reason or "",
        )
        return {"success": True, "permission": perm}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/approvals/pending")
async def list_pending_approvals(
    session_id: Optional[str] = Query(None, description="按 session 过滤"),
):
    """
    Cycle 3 v1.0.0: 列出待审批请求
    """
    svc = get_permission_service()
    pending = svc.list_pending_approvals(session_id=session_id)
    return {
        "success": True,
        "pending": pending,
        "count": len(pending),
    }


@router.post("/approvals/{request_id}/respond")
async def respond_approval(request_id: str, body: ApprovalResponseRequest):
    """
    Cycle 3 v1.0.0: 响应审批请求
    """
    svc = get_permission_service()
    result = svc.respond_to_approval(
        request_id=request_id,
        decision=body.decision,
        decided_by=body.decided_by or "user",
        reason=body.reason or "",
    )
    if result is None:
        raise HTTPException(status_code=404, detail=f"审批请求不存在或决策无效: {request_id}")
    return {
        "success": True,
        "request": result,
    }


@router.get("/audit-log")
async def get_audit_log(
    tool_name: Optional[str] = Query(None, description="按工具名过滤"),
    server_id: Optional[str] = Query(None, description="按 server 过滤"),
    session_id: Optional[str] = Query(None, description="按 session 过滤"),
    limit: int = Query(100, ge=1, le=1000, description="返回数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    success_only: Optional[bool] = Query(None, description="仅成功/失败"),
):
    """
    Cycle 3 v1.0.0: 查询审计日志
    """
    svc = get_permission_service()
    result = svc.list_audit_logs(
        tool_name=tool_name,
        server_id=server_id,
        session_id=session_id,
        limit=limit,
        offset=offset,
        success_only=success_only,
    )
    return {
        "success": True,
        **result,
    }
