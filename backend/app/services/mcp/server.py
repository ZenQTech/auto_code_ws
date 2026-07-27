"""
# ============================================================
# MCP Server - 内存内置服务器
# ============================================================
# 核心作用：提供 MCP 协议核心方法的内存实现
# 支持方法：
#   - initialize：建立连接
#   - tools/list：列出可用工具
#   - tools/call：调用工具
#   - ping：心跳
# 设计为 in-process，避免子进程通信的复杂度
# 同时也提供 stdio 模式（JSONL over stdin/stdout）
# ============================================================
"""

import asyncio
import json
import logging
import sys
from typing import Dict, Any, List, Optional

from .tools.builtin import BUILTIN_TOOLS

logger = logging.getLogger(__name__)


class MCPServer:
    """
    MCP 协议服务器（内存版）
    """

    SERVER_NAME = "hermes-builtin-mcp-server"
    SERVER_VERSION = "1.0.0"
    PROTOCOL_VERSION = "2024-11-05"

    def __init__(self, workspace_root: str = "/tmp"):
        self.workspace_root = workspace_root
        self.initialized = False
        self.client_info: Optional[Dict[str, Any]] = None
        logger.info(f"MCPServer 初始化完成（workspace={workspace_root}）")

    async def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理 JSON-RPC 请求
        格式：{"jsonrpc": "2.0", "id": 1, "method": "...", "params": {...}}
        """
        method = request.get("method", "")
        params = request.get("params", {})
        req_id = request.get("id")

        logger.debug(f"MCP 收到请求: {method}")

        try:
            if method == "initialize":
                result = await self._initialize(params)
            elif method == "ping":
                result = {"pong": True}
            elif method == "tools/list":
                result = await self._list_tools()
            elif method == "tools/call":
                result = await self._call_tool(params)
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}",
                    },
                }

            return {"jsonrpc": "2.0", "id": req_id, "result": result}
        except Exception as e:
            logger.error(f"MCP 请求处理失败: {e}", exc_info=True)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}",
                },
            }

    async def _initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """建立连接"""
        self.initialized = True
        self.client_info = params.get("clientInfo", {})
        return {
            "protocolVersion": self.PROTOCOL_VERSION,
            "serverInfo": {
                "name": self.SERVER_NAME,
                "version": self.SERVER_VERSION,
            },
            "capabilities": {
                "tools": {"listChanged": False},
            },
        }

    async def _list_tools(self) -> Dict[str, Any]:
        """列出所有可用工具"""
        tools = [info["schema"] for info in BUILTIN_TOOLS.values()]
        return {"tools": tools}

    async def _call_tool(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """调用工具"""
        if not self.initialized:
            return {
                "content": [{"type": "text", "text": "Server not initialized"}],
                "isError": True,
            }

        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        if tool_name not in BUILTIN_TOOLS:
            return {
                "content": [{"type": "text", "text": f"Tool not found: {tool_name}"}],
                "isError": True,
            }

        handler = BUILTIN_TOOLS[tool_name]["handler"]
        result = await handler(arguments, self.workspace_root)

        # 转换为 MCP 格式
        if isinstance(result.get("content"), list):
            # list_directory 返回列表
            content_text = json.dumps(result["content"], ensure_ascii=False, indent=2)
        else:
            content_text = str(result.get("content", ""))

        content = [{"type": "text", "text": content_text}]

        if result.get("is_error") or not result.get("success"):
            error_msg = result.get("error_message", "")
            if error_msg:
                content.append({"type": "text", "text": f"\n[Error]: {error_msg}"})

        return {
            "content": content,
            "isError": not result.get("success", True),
        }


async def run_stdio_server(workspace_root: str = "/tmp"):
    """
    启动 stdio 模式的 MCP 服务器
    从 stdin 读取 JSONL，每行一个请求，写回 stdout
    """
    server = MCPServer(workspace_root=workspace_root)
    logger.info(f"MCP stdio server 启动（workspace={workspace_root}）")

    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            line = line.decode("utf-8").strip()
            if not line:
                continue

            request = json.loads(line)
            response = await server.handle_request(request)
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            logger.error(f"MCP JSON 解析失败: {e}")
        except Exception as e:
            logger.error(f"MCP stdio server 异常: {e}", exc_info=True)
            break


if __name__ == "__main__":
    # 命令行启动：python -m backend.app.services.mcp.server
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_stdio_server())
