"""
# ============================================================
# MCP Client - 客户端封装
# ============================================================
# 核心作用：封装 MCP 客户端调用
# 支持两种模式：
#   1. In-process 客户端（直接调用内置 server）
#   2. Stdio 客户端（子进程 + JSONL）
#   3. SSE 客户端（HTTP - 占位）
# ============================================================
"""

import asyncio
import json
import logging
import uuid
from typing import Dict, Any, List, Optional

from .server import MCPServer

logger = logging.getLogger(__name__)


class MCPClient:
    """
    MCP 客户端（高层 API）
    - 内部维护 MCPServer 实例
    - 提供 list_tools / call_tool 高层方法
    - 支持多 server 注册
    """

    def __init__(self, workspace_root: str = "/tmp"):
        self.workspace_root = workspace_root
        self.builtin_server = MCPServer(workspace_root=workspace_root)
        self.external_servers: Dict[str, MCPServer] = {}
        self.call_log: List[Dict[str, Any]] = []
        self._initialize_lock = asyncio.Lock() if asyncio.get_event_loop().is_running() else None
        logger.info(f"MCPClient 初始化完成（workspace={workspace_root}）")

    async def _ensure_initialized(self):
        """确保内置 server 已 initialize"""
        if not self.builtin_server.initialized:
            await self.builtin_server.handle_request({
                "jsonrpc": "2.0",
                "id": "init-0",
                "method": "initialize",
                "params": {
                    "protocolVersion": MCPServer.PROTOCOL_VERSION,
                    "clientInfo": {"name": "hermes-mcp-client", "version": "1.0.0"},
                },
            })

    async def list_tools(self) -> List[Dict[str, Any]]:
        """
        列出所有可用工具（合并内置 + 外部）
        """
        await self._ensure_initialized()
        result = await self.builtin_server.handle_request({
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/list",
            "params": {},
        })
        tools = result.get("result", {}).get("tools", [])

        # 添加 server_id
        for tool in tools:
            tool["server_id"] = "builtin"
            tool["server_name"] = "hermes-builtin"

        # Cycle 3 v1.0.0: 合并外部 server 的工具
        try:
            from .external import get_external_mcp_manager
            mgr = get_external_mcp_manager()
            for server_id, server in mgr.servers.items():
                try:
                    ext_tools = await server.list_tools()
                    for t in ext_tools:
                        t["server_id"] = server_id
                        t["server_name"] = mgr.configs[server_id].name
                        tools.append(t)
                except Exception as e:
                    logger.warning(f"获取外部 server {server_id} 工具失败: {e}")
        except Exception as e:
            logger.debug(f"外部 MCP 管理器未加载: {e}")

        return tools

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        server_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        调用工具
        参数：
          - tool_name: 工具名
          - arguments: 工具参数
          - server_id: 目标 server ID（None=自动选择）
        返回：MCP 工具结果
        """
        # v6.12.0 修复：调用工具前确保内置 server 已初始化
        # 避免首次调用时直接 handle_request 导致 "Server not initialized" 错误
        if server_id is None or server_id == "builtin":
            await self._ensure_initialized()

        call_id = str(uuid.uuid4())
        request = {
            "jsonrpc": "2.0",
            "id": call_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        # 路由到 server
        if server_id is None or server_id == "builtin":
            response = await self.builtin_server.handle_request(request)
        elif server_id in self.external_servers:
            response = await self.external_servers[server_id].handle_request(request)
        else:
            return {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": f"Server not found: {server_id}",
            }

        # 解析响应
        if "error" in response:
            result = {
                "success": False,
                "content": "",
                "is_error": True,
                "error_message": response["error"].get("message", "Unknown error"),
            }
        else:
            r = response.get("result", {})
            content_blocks = r.get("content", [])
            # 合并所有 text 块
            text_parts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
            content_text = "\n".join(text_parts)
            result = {
                "success": not r.get("isError", False),
                "content": content_text,
                "is_error": r.get("isError", False),
                "error_message": None,
                "call_id": call_id,
                "tool_name": tool_name,
            }

        # 记录日志
        self.call_log.append({
            "call_id": call_id,
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
        })
        # 限制日志大小
        if len(self.call_log) > 1000:
            self.call_log = self.call_log[-500:]

        return result

    def register_external_server(self, server_id: str, server: MCPServer):
        """注册外部 server"""
        self.external_servers[server_id] = server
        logger.info(f"已注册外部 MCP server: {server_id}")

    def unregister_external_server(self, server_id: str):
        """注销外部 server"""
        if server_id in self.external_servers:
            del self.external_servers[server_id]
            logger.info(f"已注销外部 MCP server: {server_id}")

    def get_call_log(self, limit: int = 100) -> List[Dict[str, Any]]:
        """获取最近调用日志"""
        return self.call_log[-limit:]


# 全局单例
_client_instance: Optional[MCPClient] = None


def get_mcp_client(workspace_root: str = "/tmp") -> MCPClient:
    """获取全局 MCP 客户端（单例）"""
    global _client_instance
    if _client_instance is None:
        _client_instance = MCPClient(workspace_root=workspace_root)
    return _client_instance
