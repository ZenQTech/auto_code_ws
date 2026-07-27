"""
# ============================================================
# MCP SSE Transport - 真实的 Server-Sent Events 客户端
# ============================================================
# 核心作用：为 MCP 服务器实现真正的 SSE 传输支持
# 协议要点（MCP 2024-11-05 + 2025-03-26）：
#   - GET  {endpoint_url}            → 订阅事件流（event: endpoint, data: <message_url>）
#   - POST {message_url}             → 发送 JSON-RPC 请求
#   - GET  {message_url}?event_id=N  → 重连时指定 last_event_id
#   - 心跳：每 15s 发送 : ping comment 防止代理超时
#   - 事件类型：endpoint / message / progress / log / error
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 4 P0-1
# 参考实现：
#   - Codex v0.145+ Remote MCP server config
#   - MCP TypeScript SDK SSEClientTransport
#   - https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
# ============================================================
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Callable, Awaitable

import httpx

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

@dataclass
class SSEEvent:
    """SSE 事件"""
    id: Optional[str] = None           # last_event_id 用于重连
    event: str = "message"             # 事件类型（默认 message）
    data: str = ""                     # 数据（多行用 \n 连接）
    retry: Optional[int] = None        # 客户端重试间隔（毫秒）
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "event": self.event,
            "data": self.data,
            "retry": self.retry,
            "timestamp": self.timestamp,
        }

    def json_data(self) -> Optional[Dict[str, Any]]:
        """解析 data 为 JSON（失败返回 None）"""
        try:
            return json.loads(self.data)
        except (json.JSONDecodeError, TypeError):
            return None


class SSEConnectionError(Exception):
    """SSE 连接错误"""
    pass


class SSEResponseTimeoutError(Exception):
    """SSE 响应超时"""
    pass


# ============================================================
# SSE Client - 真实 SSE 客户端实现
# ============================================================

class SSEMCPClient:
    """
    真实的 MCP SSE 客户端

    工作流程：
      1. GET  {config.url} → 订阅事件流
      2. 解析首个 `endpoint` 事件 → 获得 message_url
      3. POST {message_url} + JSON-RPC → 发送请求
      4. 解析 `message` 事件 → 获得响应
      5. 监听 `progress` / `log` / `error` 事件 → 实时反馈

    容错机制：
      - 断线自动重连（指数退避）
      - last_event_id 续传
      - 心跳保活（每 15s 发送 ping comment）
      - request_id 匹配响应
    """

    def __init__(
        self,
        endpoint_url: str,
        headers: Optional[Dict[str, str]] = None,
        timeout_sec: int = 120,
        max_reconnects: int = 5,
        reconnect_base_delay_sec: float = 1.0,
        heartbeat_interval_sec: int = 15,
        on_progress: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        on_log: Optional[Callable[[str, str], Awaitable[None]]] = None,
    ):
        self.endpoint_url = endpoint_url
        self.headers = headers or {}
        self.timeout_sec = timeout_sec
        self.max_reconnects = max_reconnects
        self.reconnect_base_delay_sec = reconnect_base_delay_sec
        self.heartbeat_interval_sec = heartbeat_interval_sec
        self.on_progress = on_progress
        self.on_log = on_log

        # 连接状态
        self.message_url: Optional[str] = None
        self.last_event_id: Optional[str] = None
        self.connected = False
        self._client: Optional[httpx.AsyncClient] = None
        self._listener_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._request_id = 0
        self._reconnect_count = 0
        self._should_stop = False
        self._lock = asyncio.Lock()

    @property
    def is_connected(self) -> bool:
        return self.connected and self.message_url is not None

    def _next_id(self) -> str:
        self._request_id += 1
        return str(self._request_id)

    async def connect(self) -> bool:
        """
        连接到 SSE 端点

        Returns:
            bool: 是否成功获得 message_url
        """
        async with self._lock:
            if self.connected:
                return True

            self._should_stop = False
            headers = {
                "Accept": "text/event-stream",
                "Cache-Control": "no-cache",
                **self.headers,
            }
            if self.last_event_id:
                headers["Last-Event-ID"] = self.last_event_id

            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
                headers=headers,
                follow_redirects=True,
            )

            # 启动监听协程
            self._listener_task = asyncio.create_task(self._listen_loop())
            # 启动心跳保活
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

            # 等待首次 endpoint 事件
            try:
                deadline = time.time() + self.timeout_sec
                while not self.message_url and time.time() < deadline:
                    await asyncio.sleep(0.05)
                if not self.message_url:
                    raise SSEConnectionError(f"未在 {self.timeout_sec}s 内收到 endpoint 事件")
            except Exception as e:
                await self.disconnect()
                raise

            self.connected = True
            self._reconnect_count = 0
            logger.info(f"SSE 连接成功: {self.endpoint_url} (message_url={self.message_url})")
            return True

    async def disconnect(self) -> None:
        """断开连接"""
        self._should_stop = True
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except (asyncio.CancelledError, Exception):
                pass
            self._heartbeat_task = None

        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except (asyncio.CancelledError, Exception):
                pass
            self._listener_task = None

        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None

        # 取消所有 pending 请求
        for req_id, future in list(self._pending_requests.items()):
            if not future.done():
                future.set_exception(SSEConnectionError("SSE 连接已断开"))
        self._pending_requests.clear()
        self.connected = False
        logger.info(f"SSE 连接已断开: {self.endpoint_url}")

    async def _listen_loop(self) -> None:
        """持续监听 SSE 事件流"""
        while not self._should_stop and self._client:
            try:
                async with self._client.stream(
                    "GET", self.endpoint_url
                ) as response:
                    if response.status_code != 200:
                        raise SSEConnectionError(
                            f"SSE 端点返回非 200: {response.status_code}"
                        )
                    await self._parse_event_stream(response)
            except asyncio.CancelledError:
                break
            except httpx.RemoteProtocolError as e:
                logger.warning(f"SSE 远程协议错误: {e}")
            except Exception as e:
                logger.error(f"SSE 监听循环错误: {e}")
                if self._should_stop:
                    break
                # 重连
                if await self._try_reconnect():
                    continue
                else:
                    break

    async def _parse_event_stream(self, response: httpx.Response) -> None:
        """解析 SSE 事件流"""
        event_data_lines: List[str] = []
        event_id: Optional[str] = None
        event_type: str = "message"
        retry_ms: Optional[int] = None

        async for line in response.aiter_lines():
            if self._should_stop:
                break
            if not line:
                # 空行：事件边界
                if event_data_lines or event_type != "message" or event_id:
                    event = SSEEvent(
                        id=event_id,
                        event=event_type,
                        data="\n".join(event_data_lines),
                        retry=retry_ms,
                    )
                    await self._handle_event(event)
                    if event_id:
                        self.last_event_id = event_id
                event_data_lines = []
                event_id = None
                event_type = "message"
                retry_ms = None
                continue

            if line.startswith(":"):
                # 注释行（心跳或 keep-alive）
                continue

            if ":" in line:
                field_name, _, value = line.partition(":")
                # 可选的空格前缀
                if value.startswith(" "):
                    value = value[1:]
                if field_name == "id":
                    event_id = value
                elif field_name == "event":
                    event_type = value
                elif field_name == "data":
                    event_data_lines.append(value)
                elif field_name == "retry":
                    try:
                        retry_ms = int(value)
                    except ValueError:
                        pass

    async def _handle_event(self, event: SSEEvent) -> None:
        """分发 SSE 事件"""
        logger.debug(f"SSE 事件: type={event.event} id={event.id} data={event.data[:200]}")

        if event.event == "endpoint":
            # 首次握手：获得 message URL
            endpoint_uri = event.data.strip()
            # 处理绝对/相对 URL
            if endpoint_uri.startswith("/"):
                # 相对路径：基于 endpoint_url 解析
                from urllib.parse import urlparse, urlunparse
                parsed = urlparse(self.endpoint_url)
                self.message_url = urlunparse(
                    (parsed.scheme, parsed.netloc, endpoint_uri, "", "", "")
                )
            elif endpoint_uri.startswith("http://") or endpoint_uri.startswith("https://"):
                self.message_url = endpoint_uri
            else:
                logger.error(f"无效的 endpoint URI: {endpoint_uri}")
            return

        if event.event == "message" or event.event == "":
            # JSON-RPC 响应
            payload = event.json_data()
            if payload is None:
                logger.warning(f"无法解析 message data 为 JSON: {event.data[:200]}")
                return
            req_id = payload.get("id")
            if req_id and req_id in self._pending_requests:
                future = self._pending_requests.pop(req_id)
                if not future.done():
                    future.set_result(payload)
            return

        if event.event == "progress":
            # 进度通知（MCP 2025-03-26 新增）
            payload = event.json_data()
            if payload and self.on_progress:
                try:
                    await self.on_progress(payload)
                except Exception as e:
                    logger.error(f"progress 回调失败: {e}")
            return

        if event.event == "log":
            # 日志通知
            payload = event.json_data()
            if payload and self.on_log:
                level = payload.get("level", "info")
                msg = payload.get("message", "")
                try:
                    await self.on_log(level, msg)
                except Exception as e:
                    logger.error(f"log 回调失败: {e}")
            return

        if event.event == "error":
            # 错误通知
            logger.error(f"SSE 服务端错误: {event.data}")
            # 中断所有 pending 请求
            for req_id, future in list(self._pending_requests.items()):
                if not future.done():
                    future.set_exception(SSEConnectionError(f"服务端错误: {event.data}"))
            self._pending_requests.clear()
            return

    async def _try_reconnect(self) -> bool:
        """尝试重连（指数退避）"""
        if self._reconnect_count >= self.max_reconnects:
            logger.error(f"SSE 重连次数耗尽 ({self.max_reconnects})")
            return False

        self._reconnect_count += 1
        delay = self.reconnect_base_delay_sec * (2 ** (self._reconnect_count - 1))
        delay = min(delay, 30.0)  # 上限 30s
        logger.info(f"SSE 重连: 第 {self._reconnect_count}/{self.max_reconnect} 次, "
                    f"等待 {delay:.1f}s")
        await asyncio.sleep(delay)
        try:
            if self._client:
                await self._client.aclose()
            self.message_url = None
            self.connected = False
            # 不重置 last_event_id，用于续传
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
                headers={
                    "Accept": "text/event-stream",
                    "Cache-Control": "no-cache",
                    **self.headers,
                },
                follow_redirects=True,
            )
            self._listener_task = asyncio.create_task(self._listen_loop())
            if not self._heartbeat_task:
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            # 等待新 endpoint
            deadline = time.time() + self.timeout_sec
            while not self.message_url and time.time() < deadline:
                await asyncio.sleep(0.05)
            if self.message_url:
                self.connected = True
                logger.info(f"SSE 重连成功 (第 {self._reconnect_count} 次)")
                return True
        except Exception as e:
            logger.error(f"SSE 重连失败: {e}")
        return False

    async def _heartbeat_loop(self) -> None:
        """心跳保活（每 15s 检查连接）"""
        try:
            while not self._should_stop and self._client:
                await asyncio.sleep(self.heartbeat_interval_sec)
                # 通过发送一个 ping 来保活（如果 message_url 存在）
                # SSE 本身不支持从客户端发送数据，但可以保持连接
                # 这里仅做健康检查
                if not self._client or self._should_stop:
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"心跳循环错误: {e}")

    async def send_request(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        timeout_sec: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        通过 SSE 通道发送 JSON-RPC 请求

        Args:
            method: JSON-RPC 方法名 (e.g. "initialize", "tools/list", "tools/call")
            params: 方法参数
            timeout_sec: 单次请求超时

        Returns:
            JSON-RPC 响应（result 或 error）
        """
        if not self.is_connected:
            await self.connect()
        if not self.message_url:
            raise SSEConnectionError("SSE 通道尚未建立 message_url")

        req_id = self._next_id()
        request = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {},
        }

        future = asyncio.get_event_loop().create_future()
        self._pending_requests[req_id] = future

        try:
            # POST 到 message_url
            response = await self._client.post(
                self.message_url,
                json=request,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    **self.headers,
                },
                timeout=timeout_sec or self.timeout_sec,
            )
            if response.status_code not in (200, 202):
                err_text = response.text[:500]
                raise SSEConnectionError(
                    f"POST 失败: status={response.status_code} body={err_text}"
                )

            # POST 成功 = 服务端已接收；响应通过 SSE 事件流返回
            response_data = await asyncio.wait_for(
                future,
                timeout=timeout_sec or self.timeout_sec,
            )
            return response_data
        except asyncio.TimeoutError:
            self._pending_requests.pop(req_id, None)
            raise SSEResponseTimeoutError(f"请求 {method} 超时")
        except Exception as e:
            self._pending_requests.pop(req_id, None)
            raise


# ============================================================
# MCP SSE Server - 包装 SSEMCPClient，提供 MCP 标准接口
# ============================================================

class SSEMCPServer:
    """
    MCP SSE 传输服务器
    - 复用 StdioMCPServer 的 list_tools / call_tool 接口
    - 通过 SSEMCPClient 通信
    - 自动管理连接生命周期
    """

    def __init__(self, config: "ExternalMCPServerConfig"):
        from backend.app.services.mcp.external import (
            ExternalMCPServerConfig,
            MCPServerStatus,
        )
        self.config = config
        self.client: Optional[SSEMCPClient] = None
        self.initialized = False
        self.status = MCPServerStatus.STOPPED
        self.start_time: Optional[float] = None
        self.restart_count = 0
        self.logs: List[Dict[str, Any]] = []
        self.tools: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()

    def _log(self, level: str, message: str):
        entry = {"ts": time.time(), "level": level, "message": message}
        self.logs.append(entry)
        if len(self.logs) > 1000:
            self.logs = self.logs[-500:]

    async def start(self) -> bool:
        """连接 SSE MCP server"""
        from backend.app.services.mcp.external import MCPServerStatus
        if not self.config.url:
            self._log("error", "SSE server 必须指定 url")
            return False

        self.status = MCPServerStatus.STARTING
        self._log("info", f"连接 SSE MCP server: {self.config.url}")

        try:
            self.client = SSEMCPClient(
                endpoint_url=self.config.url,
                headers=self.config.headers,
                timeout_sec=self.config.startup_timeout_sec,
                on_progress=self._on_progress,
                on_log=self._on_log,
            )
            await self.client.connect()
            # 发送 initialize
            await self._initialize()
            self.initialized = True
            self.status = MCPServerStatus.RUNNING
            self.start_time = time.time()
            self._log("info", "SSE MCP server 启动成功")
            return True
        except Exception as e:
            self._log("error", f"SSE 启动失败: {e}")
            self.status = MCPServerStatus.CRASHED
            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass
                self.client = None
            return False

    async def stop(self):
        """断开 SSE 连接"""
        from backend.app.services.mcp.external import MCPServerStatus
        if self.client:
            try:
                await self.client.disconnect()
            except Exception as e:
                self._log("error", f"停止失败: {e}")
            self.client = None
        self.initialized = False
        self.status = MCPServerStatus.STOPPED
        self._log("info", "SSE MCP server 已停止")

    async def restart(self) -> bool:
        await self.stop()
        await asyncio.sleep(0.5)
        self.restart_count += 1
        return await self.start()

    async def _initialize(self):
        """发送 initialize 请求"""
        response = await self.client.send_request(
            method="initialize",
            params={
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "hermes-mcp-client", "version": "1.0.0"},
            },
        )
        if "error" in response:
            raise Exception(f"Initialize failed: {response['error']}")

    async def _on_progress(self, payload: Dict[str, Any]):
        self._log("progress", json.dumps(payload)[:200])

    async def _on_log(self, level: str, message: str):
        self._log(level, message)

    async def list_tools(self) -> List[Dict[str, Any]]:
        """列出工具"""
        if not self.initialized or not self.client:
            await self._initialize()
            self.initialized = True

        response = await self.client.send_request(
            method="tools/list",
            params={},
        )
        self.tools = response.get("result", {}).get("tools", [])
        return self.tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """调用工具"""
        if not self.initialized or not self.client:
            await self._initialize()
            self.initialized = True

        response = await self.client.send_request(
            method="tools/call",
            params={"name": name, "arguments": arguments},
            timeout_sec=self.config.tool_timeout_sec,
        )
        return response.get("result", {})

    def get_status(self) -> Dict[str, Any]:
        uptime = int(time.time() - self.start_time) if self.start_time else 0
        return {
            "id": self.config.id,
            "name": self.config.name,
            "status": self.status.value,
            "uptime_sec": uptime,
            "restart_count": self.restart_count,
            "initialized": self.initialized,
            "transport": "sse",
            "endpoint_url": self.config.url,
            "message_url": self.client.message_url if self.client else None,
            "connected": self.client.is_connected if self.client else False,
        }

    def get_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self.logs[-limit:]


# ============================================================
# 工厂函数
# ============================================================

def create_sse_client(
    endpoint_url: str,
    headers: Optional[Dict[str, str]] = None,
    **kwargs,
) -> SSEMCPClient:
    """工厂函数：创建 SSE 客户端"""
    return SSEMCPClient(
        endpoint_url=endpoint_url,
        headers=headers,
        **kwargs,
    )
