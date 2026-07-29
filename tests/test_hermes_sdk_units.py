"""
# ============================================================
# Hermes Python SDK - 单元测试
# ============================================================
# 核心作用：测试 Hermes Python SDK 的核心功能
# 覆盖：配置、客户端、Thread、Run、Stream、异常
# Cycle 13 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# 添加 sdks/python 到 path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "sdks" / "python"))

from hermes_sdk import (  # noqa: E402
    Hermes,
    HermesConfig,
    Sandbox,
    Thread,
    ThreadConfig,
    RunResult,
    Usage,
    EventStream,
    AsyncEventStream,
    StreamEvent,
    HermesError,
    HermesAPIError,
    HermesAuthError,
    HermesNotFoundError,
    HermesRateLimitError,
    HermesServerError,
    HermesTimeoutError,
)


# ============================================================
# 测试：配置
# ============================================================
class TestHermesConfig(unittest.TestCase):
    """配置测试"""

    def test_default_config(self):
        """测试默认配置"""
        cfg = HermesConfig()
        self.assertEqual(cfg.base_url, "http://localhost:8000")
        self.assertEqual(cfg.timeout, 60.0)
        self.assertEqual(cfg.max_retries, 2)
        self.assertEqual(cfg.default_model, "claude-sonnet-4.5")
        self.assertEqual(cfg.default_sandbox, "workspace_write")

    def test_from_env(self):
        """测试从环境变量加载"""
        with patch.dict(os.environ, {
            "HERMES_API_KEY": "test-key",
            "HERMES_BASE_URL": "http://example.com:9000",
            "HERMES_TIMEOUT": "30",
        }):
            cfg = HermesConfig.from_env()
            self.assertEqual(cfg.api_key, "test-key")
            self.assertEqual(cfg.base_url, "http://example.com:9000")
            self.assertEqual(cfg.timeout, 30.0)

    def test_with_overrides(self):
        """测试覆盖配置"""
        cfg = HermesConfig(api_key="orig")
        cfg2 = cfg.with_overrides(api_key="new", timeout=120.0)
        self.assertEqual(cfg.api_key, "orig")
        self.assertEqual(cfg2.api_key, "new")
        self.assertEqual(cfg2.timeout, 120.0)


# ============================================================
# 测试：Sandbox
# ============================================================
class TestSandbox(unittest.TestCase):
    """Sandbox 测试"""

    def test_sandbox_values(self):
        """测试 Sandbox 枚举值"""
        self.assertEqual(Sandbox.READ_ONLY.value, "read_only")
        self.assertEqual(Sandbox.WORKSPACE_WRITE.value, "workspace_write")
        self.assertEqual(Sandbox.FULL_ACCESS.value, "full_access")

    def test_sandbox_coerce_string(self):
        """测试字符串转换"""
        self.assertEqual(Sandbox.coerce("read_only"), Sandbox.READ_ONLY)
        self.assertEqual(Sandbox.coerce("workspace-write"), Sandbox.WORKSPACE_WRITE)
        self.assertEqual(Sandbox.coerce("FULL_ACCESS"), Sandbox.FULL_ACCESS)

    def test_sandbox_coerce_enum(self):
        """测试枚举转换"""
        self.assertEqual(Sandbox.coerce(Sandbox.READ_ONLY), Sandbox.READ_ONLY)

    def test_sandbox_coerce_invalid(self):
        """测试无效值"""
        with self.assertRaises(ValueError):
            Sandbox.coerce("invalid_sandbox")


# ============================================================
# 测试：异常
# ============================================================
class TestExceptions(unittest.TestCase):
    """异常测试"""

    def test_hermes_error(self):
        """测试基础异常"""
        e = HermesError("test")
        self.assertEqual(str(e), "test")
        self.assertEqual(e.message, "test")

    def test_api_error(self):
        """测试 API 错误"""
        e = HermesAPIError("api error", status_code=400, payload={"key": "value"})
        self.assertEqual(e.status_code, 400)
        self.assertEqual(e.payload["key"], "value")

    def test_auth_error(self):
        """测试认证错误"""
        e = HermesAuthError("auth error")
        self.assertEqual(e.status_code, 401)

    def test_not_found_error(self):
        """测试 404 错误"""
        e = HermesNotFoundError("not found")
        self.assertEqual(e.status_code, 404)

    def test_rate_limit_error(self):
        """测试 429 错误"""
        e = HermesRateLimitError("rate limit")
        self.assertEqual(e.status_code, 429)

    def test_server_error(self):
        """测试 5xx 错误"""
        e = HermesServerError("server error")
        self.assertEqual(e.status_code, 500)

    def test_timeout_error(self):
        """测试超时错误"""
        e = HermesTimeoutError("timeout")
        self.assertIsInstance(e, HermesError)


# ============================================================
# 测试：数据模型
# ============================================================
class TestModels(unittest.TestCase):
    """数据模型测试"""

    def test_usage_from_dict(self):
        """测试 Usage 解析"""
        u = Usage.from_dict({"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30})
        self.assertEqual(u.prompt_tokens, 10)
        self.assertEqual(u.completion_tokens, 20)
        self.assertEqual(u.total_tokens, 30)

    def test_usage_from_dict_missing(self):
        """测试 Usage 默认值"""
        u = Usage.from_dict(None)
        self.assertEqual(u.total_tokens, 0)
        u = Usage.from_dict({})
        self.assertEqual(u.total_tokens, 0)

    def test_run_result_from_dict(self):
        """测试 RunResult 解析"""
        data = {
            "thread_id": "th_123",
            "run_id": "run_123",
            "final_response": "Hello",
            "text": "Hello",
            "status": "completed",
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
            "collected_items": [{"name": "test"}],
            "metadata": {"key": "value"},
        }
        r = RunResult.from_dict(data)
        self.assertEqual(r.thread_id, "th_123")
        self.assertEqual(r.final_response, "Hello")
        self.assertEqual(r.usage.total_tokens, 3)
        self.assertEqual(len(r.collected_items), 1)

    def test_thread_config_to_payload(self):
        """测试 ThreadConfig 序列化"""
        cfg = ThreadConfig(
            sandbox=Sandbox.FULL_ACCESS,
            model="gpt-4",
            project_id="proj-1",
            working_directory="/tmp",
            system_prompt="You are a helpful assistant",
        )
        payload = cfg.to_payload()
        self.assertEqual(payload["sandbox"], "full_access")
        self.assertEqual(payload["model"], "gpt-4")
        self.assertEqual(payload["project_id"], "proj-1")
        self.assertEqual(payload["working_directory"], "/tmp")
        self.assertEqual(payload["system_prompt"], "You are a helpful assistant")

    def test_thread_config_minimal(self):
        """测试最小配置"""
        cfg = ThreadConfig()
        payload = cfg.to_payload()
        self.assertEqual(payload["sandbox"], "workspace_write")
        self.assertEqual(payload["model"], "claude-sonnet-4.5")
        # 最小配置不应包含 project_id/working_directory/system_prompt
        self.assertNotIn("project_id", payload)
        self.assertNotIn("working_directory", payload)
        self.assertNotIn("system_prompt", payload)


# ============================================================
# 测试：客户端（Mock）
# ============================================================
class TestHermesClient(unittest.TestCase):
    """客户端测试（Mock HTTP）"""

    def setUp(self):
        # 创建 mock urllib
        self._original_urlopen = None
        self._mock_responses = []

    def _mock_urlopen(self, *args, **kwargs):
        """Mock urllib.request.urlopen"""
        if not self._mock_responses:
            raise RuntimeError("No mock response set")
        resp = self._mock_responses.pop(0)
        return resp

    def test_client_init(self):
        """测试客户端初始化"""
        hermes = Hermes(api_key="test-key", base_url="http://test:8000")
        self.assertEqual(hermes.config.api_key, "test-key")
        self.assertEqual(hermes.config.base_url, "http://test:8000")

    def test_thread_start(self):
        """测试启动 Thread"""
        # 准备 mock 响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_abc123",
            "sandbox": "workspace_write",
            "model": "claude-sonnet-4.5",
            "project_id": "",
            "created_at": "2026-07-28T00:00:00Z",
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = hermes.thread_start(sandbox=Sandbox.WORKSPACE_WRITE)
            self.assertEqual(thread.id, "th_abc123")
            self.assertEqual(thread.config.sandbox, Sandbox.WORKSPACE_WRITE)

    def test_thread_start_invalid_response(self):
        """测试启动 Thread 但响应无效"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"other": "data"}).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            with self.assertRaises(HermesAPIError):
                hermes.thread_start()

    def test_resume_thread(self):
        """测试恢复 Thread"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_xyz",
            "sandbox": "read_only",
            "model": "gpt-5",
            "project_id": "p1",
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = hermes.resume_thread("th_xyz")
            self.assertEqual(thread.id, "th_xyz")
            self.assertEqual(thread.config.model, "gpt-5")

    def test_list_threads(self):
        """测试列出 Thread"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "total": 2,
            "threads": [{"thread_id": "th_1"}, {"thread_id": "th_2"}],
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            data = hermes.list_threads()
            self.assertEqual(data["total"], 2)

    def test_close(self):
        """测试关闭"""
        hermes = Hermes(api_key="test")
        hermes.close()
        # 关闭后调用应抛错
        with self.assertRaises(HermesAPIError):
            hermes.list_threads()

    def test_context_manager(self):
        """测试上下文管理器"""
        with Hermes(api_key="test") as hermes:
            self.assertFalse(hermes._closed)
        self.assertTrue(hermes._closed)


# ============================================================
# 测试：Thread（Mock）
# ============================================================
class TestThread(unittest.TestCase):
    """Thread 测试"""

    def test_thread_repr(self):
        """测试 Thread 字符串表示"""
        hermes = Hermes(api_key="test")
        thread = Thread(hermes, "th_123", ThreadConfig(sandbox=Sandbox.READ_ONLY))
        self.assertIn("th_123", repr(thread))
        self.assertIn("read_only", repr(thread))

    def test_thread_run_success(self):
        """测试 Thread.run 成功"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_123",
            "run_id": "run_123",
            "final_response": "Hello world",
            "text": "Hello world",
            "status": "completed",
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = Thread(hermes, "th_123")
            result = thread.run("Hi")
            self.assertEqual(result.final_response, "Hello world")
            self.assertEqual(result.usage.total_tokens, 3)

    def test_thread_run_with_schema(self):
        """测试 Thread.run with output_schema"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_123",
            "run_id": "run_123",
            "final_response": "{}",
            "text": "{}",
            "status": "completed",
            "usage": {"total_tokens": 0},
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = Thread(hermes, "th_123")
            result = thread.run("test", output_schema={"type": "object"})
            self.assertIsNotNone(result)

    def test_thread_run_stream(self):
        """测试 Thread.run_stream"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "events": [
                {"type": "run_started", "run_id": "r1", "thread_id": "th_1"},
                {"type": "text_delta", "text": "Hello ", "delta": "Hello ", "run_id": "r1", "thread_id": "th_1"},
                {"type": "text_delta", "text": "world", "delta": "world", "run_id": "r1", "thread_id": "th_1"},
                {"type": "run_completed", "run_id": "r1", "thread_id": "th_1"},
            ],
            "final": {
                "thread_id": "th_1",
                "run_id": "r1",
                "final_response": "Hello world",
                "status": "completed",
                "usage": {"total_tokens": 3},
            },
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = Thread(hermes, "th_1")
            stream = thread.run_stream("Hi")
            events = list(stream)
            self.assertEqual(len(events), 4)
            self.assertEqual(stream.texts(), ["Hello ", "world"])

    def test_thread_status(self):
        """测试 Thread.status"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_123",
            "status": "active",
            "run_count": 5,
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = Thread(hermes, "th_123")
            data = thread.status()
            self.assertEqual(data["run_count"], 5)

    def test_thread_close(self):
        """测试 Thread.close"""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "thread_id": "th_123",
            "status": "closed",
        }).encode("utf-8")
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_response):
            hermes = Hermes(api_key="test")
            thread = Thread(hermes, "th_123")
            result = thread.close()
            self.assertEqual(result["status"], "closed")


# ============================================================
# 测试：Stream
# ============================================================
class TestStream(unittest.TestCase):
    """Stream 测试"""

    def test_event_stream_iter(self):
        """测试 EventStream 迭代"""
        events = [
            StreamEvent(type="text_delta", text="a"),
            StreamEvent(type="text_delta", text="b"),
        ]
        stream = EventStream(events)
        self.assertEqual(len(stream), 2)
        texts = [e.text for e in stream]
        self.assertEqual(texts, ["a", "b"])

    def test_event_stream_texts(self):
        """测试 EventStream.texts"""
        events = [
            StreamEvent(type="text_delta", text="a"),
            StreamEvent(type="tool_call"),
            StreamEvent(type="text_delta", text="b"),
        ]
        stream = EventStream(events)
        self.assertEqual(stream.texts(), ["a", "b"])

    def test_event_stream_tool_calls(self):
        """测试 EventStream.tool_calls"""
        events = [
            StreamEvent(type="tool_call", data={"name": "read"}),
            StreamEvent(type="text_delta", text="x"),
            StreamEvent(type="tool_call", data={"name": "write"}),
        ]
        stream = EventStream(events)
        calls = stream.tool_calls()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["name"], "read")
        self.assertEqual(calls[1]["name"], "write")

    def test_async_event_stream(self):
        """测试 AsyncEventStream"""
        events = [
            StreamEvent(type="text_delta", text="x"),
            StreamEvent(type="text_delta", text="y"),
        ]
        stream = AsyncEventStream(events)

        async def collect():
            result = []
            async for evt in stream:
                result.append(evt.text)
            return result

        texts = asyncio.run(collect())
        self.assertEqual(texts, ["x", "y"])

    def test_parse_sse_block(self):
        """测试 SSE 解析"""
        block = "event: text_delta\ndata: {\"text\": \"hello\"}\n\n"
        from hermes_sdk.stream import parse_sse_block
        evt = parse_sse_block(block)
        self.assertEqual(evt.type, "text_delta")
        self.assertEqual(evt.text, "hello")

    def test_parse_sse_keepalive(self):
        """测试 SSE keepalive"""
        block = ": keep-alive\n\n"
        from hermes_sdk.stream import parse_sse_block
        evt = parse_sse_block(block)
        self.assertIsNone(evt)


# ============================================================
# 测试：HTTP 错误处理
# ============================================================
class TestHttpErrorMapping(unittest.TestCase):
    """HTTP 错误映射测试"""

    def test_map_401_to_auth(self):
        """测试 401 -> HermesAuthError"""
        import urllib.error
        error = urllib.error.HTTPError(
            url="http://test", code=401, msg="Unauthorized", hdrs={}, fp=None
        )
        exc = Hermes._map_http_error(401, {"detail": "no auth"}, error)
        self.assertIsInstance(exc, HermesAuthError)
        self.assertEqual(exc.status_code, 401)

    def test_map_404_to_notfound(self):
        """测试 404 -> HermesNotFoundError"""
        import urllib.error
        error = urllib.error.HTTPError(
            url="http://test", code=404, msg="Not Found", hdrs={}, fp=None
        )
        exc = Hermes._map_http_error(404, {"detail": "missing"}, error)
        self.assertIsInstance(exc, HermesNotFoundError)

    def test_map_429_to_ratelimit(self):
        """测试 429 -> HermesRateLimitError"""
        import urllib.error
        error = urllib.error.HTTPError(
            url="http://test", code=429, msg="Too Many", hdrs={}, fp=None
        )
        exc = Hermes._map_http_error(429, {"detail": "slow down"}, error)
        self.assertIsInstance(exc, HermesRateLimitError)

    def test_map_500_to_server(self):
        """测试 5xx -> HermesServerError"""
        import urllib.error
        error = urllib.error.HTTPError(
            url="http://test", code=503, msg="Service Unavailable", hdrs={}, fp=None
        )
        exc = Hermes._map_http_error(503, {"detail": "down"}, error)
        self.assertIsInstance(exc, HermesServerError)

    def test_map_400_to_api(self):
        """测试 400 -> HermesAPIError"""
        import urllib.error
        error = urllib.error.HTTPError(
            url="http://test", code=400, msg="Bad Request", hdrs={}, fp=None
        )
        exc = Hermes._map_http_error(400, {"detail": "bad"}, error)
        self.assertIsInstance(exc, HermesAPIError)
        self.assertNotIsInstance(exc, HermesAuthError)


# ============================================================
# 测试：URL 构造
# ============================================================
class TestUrlConstruction(unittest.TestCase):
    """URL 构造测试"""

    def test_build_url_no_params(self):
        """测试无参数 URL"""
        hermes = Hermes(api_key="test", base_url="http://api.test")
        url = hermes._build_url("/api/sdk/threads", None)
        self.assertEqual(url, "http://api.test/api/sdk/threads")

    def test_build_url_with_params(self):
        """测试带参数 URL"""
        hermes = Hermes(api_key="test", base_url="http://api.test")
        url = hermes._build_url("/api/sdk/threads", {"limit": 10, "offset": 0})
        self.assertIn("limit=10", url)
        self.assertIn("offset=0", url)

    def test_build_url_skip_empty(self):
        """测试空参数被跳过"""
        hermes = Hermes(api_key="test", base_url="http://api.test")
        url = hermes._build_url("/api/sdk/threads", {"limit": 10, "offset": ""})
        self.assertIn("limit=10", url)
        self.assertNotIn("offset", url)

    def test_build_url_strip_trailing_slash(self):
        """测试去除尾部斜杠"""
        hermes = Hermes(api_key="test", base_url="http://api.test/")
        url = hermes._build_url("/api/sdk/threads", None)
        self.assertEqual(url, "http://api.test/api/sdk/threads")


# ============================================================
# 测试：Header 构造
# ============================================================
class TestHeaders(unittest.TestCase):
    """Header 构造测试"""

    def test_basic_headers(self):
        """测试基本 Header"""
        hermes = Hermes(api_key="my-key")
        headers = hermes._build_headers()
        self.assertIn("Accept", headers)
        self.assertIn("User-Agent", headers)
        self.assertEqual(headers["Authorization"], "Bearer my-key")

    def test_no_api_key(self):
        """测试无 API Key"""
        hermes = Hermes(api_key="")
        headers = hermes._build_headers()
        self.assertNotIn("Authorization", headers)

    def test_extra_headers(self):
        """测试额外 Header"""
        hermes = Hermes(api_key="key", base_url="http://test")
        hermes.config.extra_headers = {"X-Custom": "value"}
        headers = hermes._build_headers()
        self.assertEqual(headers["X-Custom"], "value")


# ============================================================
# 测试：JSON 解析
# ============================================================
class TestJsonParse(unittest.TestCase):
    """JSON 解析测试"""

    def test_parse_dict(self):
        """测试字典解析"""
        result = Hermes._parse_json('{"a": 1}')
        self.assertEqual(result, {"a": 1})

    def test_parse_list(self):
        """测试列表解析"""
        result = Hermes._parse_json('[1, 2, 3]')
        self.assertEqual(result, {"data": [1, 2, 3]})

    def test_parse_empty(self):
        """测试空字符串"""
        result = Hermes._parse_json('')
        self.assertEqual(result, {})

    def test_parse_invalid(self):
        """测试无效 JSON"""
        result = Hermes._parse_json('not json')
        self.assertIn("raw", result)


# ============================================================
# 测试：Backoff
# ============================================================
class TestBackoff(unittest.TestCase):
    """Backoff 测试"""

    def test_backoff_progression(self):
        """测试退避递进"""
        hermes = Hermes(api_key="test")
        self.assertEqual(hermes._backoff(0), 0.5)
        self.assertEqual(hermes._backoff(1), 1.0)
        self.assertEqual(hermes._backoff(2), 2.0)
        self.assertEqual(hermes._backoff(3), 4.0)


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    unittest.main(verbosity=2)
