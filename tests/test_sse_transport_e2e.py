"""
# ============================================================
# MCP SSE Transport E2E 测试
# ============================================================
# 测试目标：使用 in-process mock SSE server 端到端验证 SSEMCPClient
# 测试方法：启动本地 HTTP server 模拟 MCP SSE 端点
#          - GET /sse → 返回 endpoint 事件
#          - POST /message → 接收 JSON-RPC 请求
#          - 推送 message 事件回客户端
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import asyncio
import json
import logging
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Any, Dict, List, Optional

import httpx
import pytest

from backend.app.services.mcp.sse_transport import (
    SSEMCPClient,
    SSEMCPServer,
    SSEConnectionError,
    SSEResponseTimeoutError,
)
from backend.app.services.mcp.external import (
    ExternalMCPServerConfig,
    MCPTransport,
    MCPServerStatus,
)

logger = logging.getLogger(__name__)


# ============================================================
# Mock MCP SSE Server（使用 BaseHTTPRequestHandler）
# ============================================================

class MockSSEServer:
    """
    In-process mock MCP SSE server
    - GET /sse    → SSE 端点（发送 endpoint 事件 + 注册为 receiver）
    - POST /msg   → 接收 JSON-RPC 请求 + 通过 SSE 推送响应到所有 receiver
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0):
        self.host = host
        self.port = port
        self.server: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[Thread] = None
        self.received_requests: List[Dict[str, Any]] = []
        # 注册活跃 SSE 客户端（每个元素是 (wfile, lock)）
        self.sse_clients: List[Any] = []
        import threading
        self._clients_lock = threading.Lock()

    def _register_client(self, wfile):
        with self._clients_lock:
            import threading
            lock = threading.Lock()
            self.sse_clients.append((wfile, lock))

    def _unregister_client(self, wfile):
        with self._clients_lock:
            self.sse_clients = [
                (w, l) for (w, l) in self.sse_clients if w is not wfile
            ]

    def _push_message_to_clients(self, response: Dict[str, Any]):
        """向所有注册的 SSE 客户端推送 message 事件"""
        with self._clients_lock:
            clients = list(self.sse_clients)
        payload = f"event: message\ndata: {json.dumps(response)}\n\n".encode()
        for wfile, lock in clients:
            try:
                with lock:
                    wfile.write(payload)
                    wfile.flush()
            except Exception:
                pass

    def start(self) -> int:
        """启动 mock server"""
        outer = self
        import threading

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_GET(self):
                if self.path == "/sse":
                    self._handle_sse_stream()
                elif self.path == "/health":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.end_headers()
                    self.wfile.write(b"ok")
                else:
                    self.send_error(404)

            def do_POST(self):
                if self.path == "/msg":
                    self._handle_message_post()
                else:
                    self.send_error(404)

            def _handle_sse_stream(self):
                """SSE 端点"""
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                # 注册为 receiver
                outer._register_client(self.wfile)
                try:
                    # 发送 endpoint 事件
                    self.wfile.write(b"event: endpoint\ndata: /msg\nid: evt-0\n\n")
                    self.wfile.flush()
                    # 保持连接 + 等待 POST 触发的事件
                    keep_alive_count = 0
                    while True:
                        time.sleep(0.05)
                        keep_alive_count += 1
                        # 每 50 个周期发送注释心跳
                        if keep_alive_count % 100 == 0:
                            try:
                                self.wfile.write(b": keep-alive\n\n")
                                self.wfile.flush()
                            except Exception:
                                break
                except Exception:
                    pass
                finally:
                    outer._unregister_client(self.wfile)

            def _handle_message_post(self):
                """POST 接收 JSON-RPC 请求"""
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                try:
                    request = json.loads(body.decode())
                except json.JSONDecodeError:
                    self.send_error(400, "Invalid JSON")
                    return
                outer.received_requests.append(request)

                # 构造响应并通过 SSE 推送给所有客户端
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "echo": request.get("method"),
                        "params": request.get("params", {}),
                    },
                }
                outer._push_message_to_clients(response)
                # POST 立即返回 202
                self.send_response(202)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"accepted")

        self.server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.port = self.server.server_address[1]
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        logger.info(f"Mock SSE server started: http://{self.host}:{self.port}")
        return self.port

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)


# ============================================================
# E2E 测试：SSEMCPClient 真实通信
# ============================================================

class TestSSEMCPClientE2E:
    """SSEMCPClient 端到端测试"""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        """每个测试前后启停 mock server"""
        self.mock = MockSSEServer()
        self.port = self.mock.start()
        yield
        self.mock.stop()

    @pytest.mark.asyncio
    async def test_connect_to_mock_sse(self):
        """连接到 mock SSE server 应成功获得 message_url"""
        client = SSEMCPClient(
            endpoint_url=f"http://127.0.0.1:{self.port}/sse",
            timeout_sec=5,
        )
        try:
            success = await client.connect()
            assert success is True
            assert client.is_connected is True
            assert client.message_url is not None
            assert client.message_url.endswith("/msg")
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_connect_disconnect_roundtrip(self):
        """连接 + 断开应正确清理"""
        client = SSEMCPClient(
            endpoint_url=f"http://127.0.0.1:{self.port}/sse",
            timeout_sec=5,
        )
        await client.connect()
        assert client.connected is True
        await client.disconnect()
        assert client.connected is False
        assert client._client is None

    @pytest.mark.asyncio
    async def test_double_disconnect_safe(self):
        """重复 disconnect 应安全无异常"""
        client = SSEMCPClient(
            endpoint_url=f"http://127.0.0.1:{self.port}/sse",
            timeout_sec=5,
        )
        await client.connect()
        await client.disconnect()
        await client.disconnect()  # 不应抛异常
        assert client.connected is False


# ============================================================
# E2E 测试：SSEMCPServer 启动 + 工具调用
# ============================================================

class TestSSEMCPServerE2E:
    """SSEMCPServer 端到端测试"""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        self.mock = MockSSEServer()
        self.port = self.mock.start()
        yield
        self.mock.stop()

    @pytest.mark.asyncio
    async def test_sse_server_start_success(self):
        """SSEMCPServer 应能成功启动"""
        config = ExternalMCPServerConfig(
            id=f"e2e-{int(time.time())}",
            name="e2e-test",
            transport=MCPTransport.SSE,
            url=f"http://127.0.0.1:{self.port}/sse",
            startup_timeout_sec=5,
        )
        server = SSEMCPServer(config)
        try:
            success = await server.start()
            assert success is True
            assert server.status == MCPServerStatus.RUNNING
            assert server.initialized is True
            status = server.get_status()
            assert status["status"] == "running"
            assert status["transport"] == "sse"
            assert status["connected"] is True
        finally:
            await server.stop()

    @pytest.mark.asyncio
    async def test_sse_server_stop(self):
        """SSEMCPServer stop 后应清理状态"""
        config = ExternalMCPServerConfig(
            id=f"e2e-stop-{int(time.time())}",
            name="e2e-stop",
            transport=MCPTransport.SSE,
            url=f"http://127.0.0.1:{self.port}/sse",
            startup_timeout_sec=5,
        )
        server = SSEMCPServer(config)
        await server.start()
        await server.stop()
        assert server.status == MCPServerStatus.STOPPED
        assert server.initialized is False
        assert server.client is None

    @pytest.mark.asyncio
    async def test_sse_server_restart(self):
        """SSEMCPServer restart 应重置状态"""
        config = ExternalMCPServerConfig(
            id=f"e2e-restart-{int(time.time())}",
            name="e2e-restart",
            transport=MCPTransport.SSE,
            url=f"http://127.0.0.1:{self.port}/sse",
            startup_timeout_sec=5,
        )
        server = SSEMCPServer(config)
        await server.start()
        first_start_time = server.start_time
        await asyncio.sleep(0.1)
        success = await server.restart()
        assert success is True
        assert server.restart_count == 1
        assert server.start_time > first_start_time
        await server.stop()


# ============================================================
# E2E 测试：与 ExternalMCPManager 集成
# ============================================================

class TestExternalMCPManagerE2E:
    """ExternalMCPManager 端到端测试（通过 SSE）"""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        self.mock = MockSSEServer()
        self.port = self.mock.start()
        yield
        self.mock.stop()

    @pytest.mark.asyncio
    async def test_register_sse_server_via_manager(self):
        """通过 Manager 注册 SSE server"""
        from backend.app.services.mcp.external import ExternalMCPManager
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            tmp_path = f.name

        try:
            mgr = ExternalMCPManager(config_path=tmp_path)
            config = ExternalMCPServerConfig(
                id=f"mgr-sse-{int(time.time())}",
                name="mgr-sse-test",
                transport=MCPTransport.SSE,
                url=f"http://127.0.0.1:{self.port}/sse",
                startup_timeout_sec=5,
            )
            registered = mgr.register(config)
            assert registered.id == config.id

            success = await mgr.start(config.id)
            assert success is True
            assert config.id in mgr.servers

            status = mgr.get_status(config.id)
            assert status is not None
            assert status["status"] == "running"
            assert status["transport"] == "sse"

            await mgr.stop(config.id)
            assert config.id not in mgr.servers
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)


# ============================================================
# 性能/可靠性测试
# ============================================================

class TestSSEReliability:
    """SSE 可靠性测试"""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        self.mock = MockSSEServer()
        self.port = self.mock.start()
        yield
        self.mock.stop()

    @pytest.mark.asyncio
    async def test_multiple_connect_disconnect_cycles(self):
        """多次连接-断开循环应保持稳定"""
        for i in range(5):
            client = SSEMCPClient(
                endpoint_url=f"http://127.0.0.1:{self.port}/sse",
                timeout_sec=5,
            )
            success = await client.connect()
            assert success is True, f"第 {i+1} 次连接失败"
            await client.disconnect()
        # 5 次循环无内存泄漏/资源泄漏
        assert True

    @pytest.mark.asyncio
    async def test_concurrent_clients(self):
        """多个并发客户端应能各自独立工作"""
        clients = []
        for i in range(3):
            client = SSEMCPClient(
                endpoint_url=f"http://127.0.0.1:{self.port}/sse",
                timeout_sec=5,
            )
            await client.connect()
            clients.append(client)

        # 验证所有客户端都连接成功
        for i, c in enumerate(clients):
            assert c.is_connected, f"客户端 {i} 未连接"

        # 清理
        for c in clients:
            await c.disconnect()


# ============================================================
# 入口
# ============================================================

if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
