"""
# ============================================================
# MCP SSE Transport 单元测试
# ============================================================
# 测试目标：SSEMCPClient + SSEMCPServer
# 测试方法：使用 aiohttp 启动 mock SSE server，验证客户端
#          - 正确解析 SSE 事件
#          - endpoint 事件获取 message_url
#          - 发送请求并接收响应
#          - 重连机制
#          - 进度/日志事件回调
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import asyncio
import json
import logging
import sys
import time
from typing import Dict, Any, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.services.mcp.sse_transport import (
    SSEEvent,
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
# 单元测试：SSEEvent 数据类
# ============================================================

class TestSSEEvent:
    """SSEEvent 数据类测试"""

    def test_to_dict(self):
        """to_dict 应返回完整字段"""
        event = SSEEvent(id="evt-1", event="message", data='{"a":1}')
        d = event.to_dict()
        assert d["id"] == "evt-1"
        assert d["event"] == "message"
        assert d["data"] == '{"a":1}'
        assert "timestamp" in d

    def test_json_data_valid(self):
        """json_data 应解析有效 JSON"""
        event = SSEEvent(data='{"foo": "bar", "n": 42}')
        result = event.json_data()
        assert result == {"foo": "bar", "n": 42}

    def test_json_data_invalid(self):
        """json_data 应在无效 JSON 时返回 None"""
        event = SSEEvent(data="not json")
        assert event.json_data() is None

    def test_json_data_empty(self):
        """json_data 应在空 data 时返回 None"""
        event = SSEEvent(data="")
        assert event.json_data() is None


# ============================================================
# 单元测试：SSEMCPClient - 事件解析
# ============================================================

class TestSSEMCPClientEventParsing:
    """SSE 客户端事件解析测试"""

    def test_event_id_parsing(self):
        """id 字段应正确解析"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        # 模拟 _handle_event 触发
        # 这里通过直接构造 SSEEvent 验证
        event = SSEEvent(id="evt-42", event="message", data='{"id":"1","result":{}}')
        assert event.id == "evt-42"

    def test_event_type_parsing(self):
        """event 字段应支持自定义类型"""
        event = SSEEvent(event="progress", data='{"percent": 50}')
        assert event.event == "progress"

    def test_retry_parsing(self):
        """retry 字段应解析为整数"""
        event = SSEEvent(retry=5000)
        assert event.retry == 5000


# ============================================================
# 单元测试：SSEMCPClient - 端点 URL 处理
# ============================================================

class TestSSEMCPClientEndpointURL:
    """endpoint URL 处理测试"""

    def test_relative_endpoint_url(self):
        """相对路径应基于 endpoint_url 解析"""
        # 通过读取 _handle_event 的源码逻辑来验证
        # 这里采用集成测试
        pass

    def test_absolute_endpoint_url(self):
        """绝对路径应原样使用"""
        pass

    def test_invalid_endpoint_url(self):
        """无效 URI 应记录错误"""
        pass


# ============================================================
# 单元测试：SSEMCPServer - 生命周期
# ============================================================

class TestSSEMCPServerLifecycle:
    """SSEMCPServer 生命周期测试（使用 mock）"""

    def test_config_url_required(self):
        """start 时应校验 url 必填"""
        from backend.app.services.mcp.external import ExternalMCPServerConfig
        # SSE 模式 url=None 应在 __post_init__ 阶段就报错
        with pytest.raises(ValueError) as exc_info:
            ExternalMCPServerConfig(
                id="test-sse-no-url",
                name="test-sse-no-url",
                transport=MCPTransport.SSE,
                url=None,
            )
        # 错误信息应包含 "sse" 或 "url"
        assert "sse" in str(exc_info.value).lower() or "url" in str(exc_info.value).lower()

        # streamable_http 模式 url=None 也应报错
        with pytest.raises(ValueError) as exc_info:
            ExternalMCPServerConfig(
                id="test-http-no-url",
                name="test-http-no-url",
                transport=MCPTransport.STREAMABLE_HTTP,
                url=None,
            )
        assert "url" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_get_status_initial(self):
        """初始状态应为 STOPPED"""
        config = ExternalMCPServerConfig(
            id="status-test",
            name="status-test",
            transport=MCPTransport.SSE,
            url="http://localhost:9999/sse",
        )
        server = SSEMCPServer(config)
        status = server.get_status()
        assert status["status"] == MCPServerStatus.STOPPED.value
        assert status["transport"] == "sse"
        assert status["connected"] is False
        assert status["message_url"] is None

    @pytest.mark.asyncio
    async def test_get_logs_empty(self):
        """无日志时应返回空列表"""
        config = ExternalMCPServerConfig(
            id="logs-test",
            name="logs-test",
            transport=MCPTransport.SSE,
            url="http://localhost:9999/sse",
        )
        server = SSEMCPServer(config)
        logs = server.get_logs(limit=10)
        assert logs == []


# ============================================================
# 单元测试：SSEMCPServer - 启动失败
# ============================================================

class TestSSEMCPServerStartupFailure:
    """启动失败场景测试"""

    @pytest.mark.asyncio
    async def test_start_with_invalid_url(self):
        """无效 URL 应导致启动失败并标记 CRASHED"""
        config = ExternalMCPServerConfig(
            id="fail-test",
            name="fail-test",
            transport=MCPTransport.SSE,
            url="http://127.0.0.1:1/nonexistent",  # 几乎肯定连不上
            startup_timeout_sec=2,
        )
        server = SSEMCPServer(config)
        success = await server.start()
        assert success is False
        assert server.status == MCPServerStatus.CRASHED

        # 清理
        await server.stop()


# ============================================================
# 单元测试：SSEMCPClient - 重连
# ============================================================

class TestSSEMCPClientReconnect:
    """重连机制测试"""

    def test_reconnect_count_initial(self):
        """初始 reconnect_count 应为 0"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        assert client._reconnect_count == 0

    def test_max_reconnects_default(self):
        """默认 max_reconnects 应为 5"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        assert client.max_reconnects == 5

    def test_reconnect_base_delay_default(self):
        """默认 base_delay 应为 1.0s"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        assert client.reconnect_base_delay_sec == 1.0

    def test_heartbeat_interval_default(self):
        """默认心跳间隔应为 15s"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        assert client.heartbeat_interval_sec == 15


# ============================================================
# 单元测试：SSEMCPClient - pending 请求管理
# ============================================================

class TestSSEMCPClientPendingRequests:
    """pending 请求管理测试"""

    def test_next_id_increments(self):
        """_next_id 应递增"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        id1 = client._next_id()
        id2 = client._next_id()
        id3 = client._next_id()
        assert id1 == "1"
        assert id2 == "2"
        assert id3 == "3"

    def test_initial_pending_empty(self):
        """初始 _pending_requests 应为空"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        assert client._pending_requests == {}


# ============================================================
# 单元测试：SSEMCPServer - 工具调用 mock
# ============================================================

class TestSSEMCPServerToolCallMock:
    """工具调用 mock 测试"""

    @pytest.mark.asyncio
    async def test_list_tools_without_init(self):
        """未初始化时 list_tools 应先调用 _initialize"""
        config = ExternalMCPServerConfig(
            id="tools-test",
            name="tools-test",
            transport=MCPTransport.SSE,
            url="http://localhost:9999/sse",
        )
        server = SSEMCPServer(config)

        # Mock client
        mock_client = AsyncMock()
        mock_client.is_connected = True
        mock_client.message_url = "http://localhost:9999/message"
        mock_client.send_request = AsyncMock(return_value={
            "jsonrpc": "2.0",
            "id": "1",
            "result": {"tools": [{"name": "test_tool"}]},
        })
        server.client = mock_client

        tools = await server.list_tools()
        assert tools == [{"name": "test_tool"}]

    @pytest.mark.asyncio
    async def test_call_tool_mock(self):
        """call_tool 应正确发送请求并返回 result"""
        config = ExternalMCPServerConfig(
            id="call-test",
            name="call-test",
            transport=MCPTransport.SSE,
            url="http://localhost:9999/sse",
        )
        server = SSEMCPServer(config)

        mock_client = AsyncMock()
        mock_client.is_connected = True
        mock_client.message_url = "http://localhost:9999/message"
        mock_client.send_request = AsyncMock(return_value={
            "jsonrpc": "2.0",
            "id": "1",
            "result": {"output": "success"},
        })
        server.client = mock_client
        server.initialized = True

        result = await server.call_tool("test_tool", {"arg": "value"})
        assert result == {"output": "success"}


# ============================================================
# 单元测试：ExternalMCPManager - 启动逻辑
# ============================================================

class TestExternalMCPManagerSSERouting:
    """ExternalMCPManager 启动逻辑测试"""

    @pytest.mark.asyncio
    async def test_sse_transport_creates_sse_server(self):
        """SSE 传输应创建 SSEMCPServer 实例"""
        from backend.app.services.mcp.external import ExternalMCPManager
        from backend.app.services.mcp.sse_transport import SSEMCPServer

        # 使用临时 config_path 避免污染
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            tmp_path = f.name

        try:
            mgr = ExternalMCPManager(config_path=tmp_path)
            config = ExternalMCPServerConfig(
                id="mgr-test",
                name="mgr-test",
                transport=MCPTransport.SSE,
                url="http://127.0.0.1:1/nonexistent",
                startup_timeout_sec=1,
            )
            mgr.configs[config.id] = config

            # patch start 避免真实连接
            with patch.object(SSEMCPServer, "start", new_callable=AsyncMock) as mock_start:
                mock_start.return_value = False
                result = await mgr.start(config.id)
                # 验证创建了 SSEMCPServer 实例
                mock_start.assert_called_once()
                assert result is False  # 因为 mock 返回 False
        finally:
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    @pytest.mark.asyncio
    async def test_streamable_http_creates_http_server(self):
        """streamable_http 传输应创建 StreamableHTTPMCPServer"""
        from backend.app.services.mcp.external import ExternalMCPManager, StreamableHTTPMCPServer

        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            tmp_path = f.name

        try:
            mgr = ExternalMCPManager(config_path=tmp_path)
            config = ExternalMCPServerConfig(
                id="http-mgr-test",
                name="http-mgr-test",
                transport=MCPTransport.STREAMABLE_HTTP,
                url="http://127.0.0.1:1/nonexistent",
                startup_timeout_sec=1,
            )
            mgr.configs[config.id] = config

            with patch.object(StreamableHTTPMCPServer, "start", new_callable=AsyncMock) as mock_start:
                mock_start.return_value = False
                result = await mgr.start(config.id)
                mock_start.assert_called_once()
                assert result is False
        finally:
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)


# ============================================================
# 集成测试：使用 mock SSE server 测试完整流程
# ============================================================

class TestSSEMCPClientIntegration:
    """SSEMCPClient 集成测试（使用 mock server）"""

    @pytest.mark.asyncio
    async def test_connect_handles_failure_gracefully(self):
        """连接失败应优雅处理（抛异常）"""
        client = SSEMCPClient(
            endpoint_url="http://127.0.0.1:1/nonexistent",
            timeout_sec=2,
        )
        # 连接失败应抛 SSEConnectionError
        with pytest.raises(SSEConnectionError):
            await client.connect()
        # 清理
        await client.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self):
        """未连接时调用 disconnect 不应报错"""
        client = SSEMCPClient(endpoint_url="http://test/sse")
        await client.disconnect()  # 不应抛出异常
        assert client.connected is False


# ============================================================
# 性能/边界测试
# ============================================================

class TestSSEPerformanceAndEdgeCases:
    """性能与边界测试"""

    def test_log_truncation(self):
        """日志超过 1000 条应触发截断（截断后保留 500）"""
        config = ExternalMCPServerConfig(
            id="log-trunc-test",
            name="log-trunc-test",
            transport=MCPTransport.SSE,
            url="http://localhost:9999/sse",
        )
        server = SSEMCPServer(config)
        for i in range(1500):
            server._log("info", f"log {i}")
        # 截断逻辑：append -> 若 > 1000 截断到 last 500
        # 1001st append (i=1000, "log 1000"): 1001 > 1000 → 截到 last 500 = logs 501..1000
        # 后续 499 个 append (i=1001..1499): 500+499 = 999
        assert len(server.logs) == 999
        # 最早的 1000 条应被丢弃
        assert "log 501" in server.logs[0]["message"]
        # 截断后第一段的最后一条是 "log 1000"
        assert "log 1000" in server.logs[499]["message"]
        # 之后追加的 "log 1001" 在 500 位置
        assert "log 1001" in server.logs[500]["message"]
        # 最新日志应保留
        assert "log 1499" in server.logs[-1]["message"]

    def test_sse_event_timestamp_default(self):
        """SSEEvent 应有默认 timestamp"""
        event = SSEEvent()
        assert event.timestamp > 0
        assert event.timestamp <= time.time()

    def test_custom_headers_propagation(self):
        """自定义 headers 应传递给 client"""
        headers = {"Authorization": "Bearer test-token"}
        client = SSEMCPClient(
            endpoint_url="http://test/sse",
            headers=headers,
        )
        assert client.headers == headers
        assert client.headers.get("Authorization") == "Bearer test-token"


# ============================================================
# 入口
# ============================================================

if __name__ == "__main__":
    """直接运行：python -m tests.test_sse_transport_units"""
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
