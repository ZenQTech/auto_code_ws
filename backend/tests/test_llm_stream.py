"""
# ============================================================
# LLM 流式输出服务单元测试 (v1.0.0)
# Cycle 62 G62-03
# ====================================
# 测试覆盖：
#   - StreamEvent 数据模型
#   - LLMStreamSession 数据模型
#   - LLMStreamManager 基础 CRUD
#   - 流式会话生命周期（创建/启动/完成/取消）
#   - Mock LLM caller
#   - 背压机制
#   - 错误处理
#   - 清理过期会话
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-03 初次创建
# ====================================
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.llm_stream import (
    LLMStreamManager,
    LLMStreamSession,
    StreamEvent,
    StreamEventType,
    get_stream_manager,
    mock_llm_caller,
    reset_stream_manager,
)


# ============================================================
# 数据模型测试
# ============================================================


class TestStreamEvent:
    """StreamEvent 数据模型测试"""

    def test_default_values(self):
        e = StreamEvent(type=StreamEventType.START, session_id="s1")
        d = e.to_dict()
        assert d["type"] == "start"
        assert d["session_id"] == "s1"
        assert d["timestamp"] > 0
        assert "content" not in d  # 默认为空不出现
        assert "delta" not in d

    def test_with_content(self):
        e = StreamEvent(
            type=StreamEventType.TOKEN,
            session_id="s1",
            content="hello",
            delta="h",
            accumulated="hello world",
        )
        d = e.to_dict()
        assert d["content"] == "hello"
        assert d["delta"] == "h"
        assert d["accumulated"] == "hello world"

    def test_with_error(self):
        e = StreamEvent(
            type=StreamEventType.ERROR,
            session_id="s1",
            error="connection timeout",
        )
        d = e.to_dict()
        assert d["error"] == "connection timeout"

    def test_with_usage(self):
        e = StreamEvent(
            type=StreamEventType.DONE,
            session_id="s1",
            usage={"prompt_tokens": 10, "completion_tokens": 20},
        )
        d = e.to_dict()
        assert d["usage"]["completion_tokens"] == 20

    def test_with_metadata(self):
        e = StreamEvent(
            type=StreamEventType.PROGRESS,
            session_id="s1",
            metadata={"step": "s1", "percent": 0.5},
        )
        d = e.to_dict()
        assert d["metadata"]["percent"] == 0.5


class TestLLMStreamSession:
    """LLMStreamSession 数据模型测试"""

    def test_default_values(self):
        s = LLMStreamSession(
            session_id="s1", prompt="p", model="m",
        )
        assert s.token_count == 0
        assert s.accumulated == ""
        assert s.is_cancelled is False
        assert s.is_completed is False
        assert s.error is None
        assert s.usage is None

    def test_to_dict(self):
        s = LLMStreamSession(
            session_id="s1", prompt="hello", model="gpt-4",
        )
        d = s.to_dict()
        assert d["session_id"] == "s1"
        assert d["model"] == "gpt-4"
        assert d["token_count"] == 0

    def test_long_prompt_truncated(self):
        s = LLMStreamSession(
            session_id="s1",
            prompt="x" * 1000,
            model="m",
        )
        d = s.to_dict()
        # 长 prompt 在 to_dict 中被截断
        assert "..." in d["prompt"]

    def test_elapsed_calculation(self):
        s = LLMStreamSession(
            session_id="s1", prompt="p", model="m",
            started_at=100.0, completed_at=105.5,
        )
        d = s.to_dict()
        assert d["elapsed_s"] == 5.5


# ============================================================
# Manager 基础 CRUD 测试
# ============================================================


class TestManagerBasics:
    """LLMStreamManager 基础 CRUD"""

    @pytest.mark.asyncio
    async def test_create(self):
        mgr = LLMStreamManager()
        session = await mgr.create("hello", model="gpt-4")
        assert session.session_id.startswith("stream-")
        assert session.model == "gpt-4"
        assert session.prompt == "hello"
        assert mgr.get(session.session_id) is session

    @pytest.mark.asyncio
    async def test_create_with_system_prompt(self):
        mgr = LLMStreamManager()
        session = await mgr.create(
            "hello", model="gpt-4", system_prompt="You are a helper.",
        )
        assert session.system_prompt == "You are a helper."

    @pytest.mark.asyncio
    async def test_get_nonexistent(self):
        mgr = LLMStreamManager()
        assert mgr.get("nonexistent") is None

    @pytest.mark.asyncio
    async def test_list_sessions(self):
        mgr = LLMStreamManager()
        await mgr.create("p1", model="m")
        await mgr.create("p2", model="m")
        sessions = mgr.list_sessions()
        assert len(sessions) == 2

    @pytest.mark.asyncio
    async def test_stats(self):
        mgr = LLMStreamManager()
        await mgr.create("p1", model="m")
        await mgr.create("p2", model="m")
        stats = mgr.get_stats()
        assert stats["total"] == 2
        assert stats["active"] == 2
        assert stats["completed"] == 0
        assert stats["cancelled"] == 0


# ============================================================
# 流式会话生命周期测试
# ============================================================


class TestStreamLifecycle:
    """流式会话生命周期"""

    @pytest.mark.asyncio
    async def test_start_and_complete(self):
        mgr = LLMStreamManager()
        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, mock_llm_caller)
        # 等待完成
        for _ in range(50):
            await asyncio.sleep(0.05)
            s = mgr.get(session.session_id)
            if s and s.is_completed:
                break
        s = mgr.get(session.session_id)
        assert s.is_completed is True
        assert s.token_count > 0
        assert s.completed_at is not None
        assert s.usage is not None

    @pytest.mark.asyncio
    async def test_start_nonexistent_raises(self):
        mgr = LLMStreamManager()
        with pytest.raises(ValueError):
            await mgr.start("nonexistent", mock_llm_caller)

    @pytest.mark.asyncio
    async def test_double_start_raises(self):
        mgr = LLMStreamManager()
        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, mock_llm_caller)
        # 第二次 start 应该失败（已完成）
        await asyncio.sleep(0.5)  # 等完成
        with pytest.raises(ValueError):
            await mgr.start(session.session_id, mock_llm_caller)

    @pytest.mark.asyncio
    async def test_cancel(self):
        mgr = LLMStreamManager()
        # 创建一个慢速 caller
        async def slow_caller(sp, p, m):
            for i in range(100):
                await asyncio.sleep(0.1)
                yield f"token{i}"

        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, slow_caller)
        await asyncio.sleep(0.2)
        cancelled = await mgr.cancel(session.session_id)
        assert cancelled is True
        s = mgr.get(session.session_id)
        assert s.is_cancelled is True

    @pytest.mark.asyncio
    async def test_cancel_nonexistent(self):
        mgr = LLMStreamManager()
        cancelled = await mgr.cancel("nonexistent")
        assert cancelled is False


# ============================================================
# Mock LLM Caller 测试
# ============================================================


class TestMockLLMCaller:
    """Mock LLM Caller"""

    @pytest.mark.asyncio
    async def test_yields_tokens(self):
        tokens = []
        async for token in mock_llm_caller("system", "prompt", "model"):
            tokens.append(token)
        # 至少有一些 token
        assert len(tokens) > 0
        # 合并后非空
        assert "".join(tokens) != ""

    @pytest.mark.asyncio
    async def test_includes_prompt(self):
        tokens = []
        async for token in mock_llm_caller("system", "test_prompt_xyz", "model"):
            tokens.append(token)
        full = "".join(tokens)
        assert "test_prompt_xyz" in full


# ============================================================
# 错误处理测试
# ============================================================


class TestErrorHandling:
    """错误处理"""

    @pytest.mark.asyncio
    async def test_caller_error_marks_session(self):
        mgr = LLMStreamManager()

        async def bad_caller(sp, p, m):
            yield "first"
            await asyncio.sleep(0.05)
            raise RuntimeError("LLM API failed")
            yield "never reached"  # noqa: unreachable

        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, bad_caller)
        # 等待完成
        for _ in range(30):
            await asyncio.sleep(0.1)
            s = mgr.get(session.session_id)
            if s and (s.is_completed or s.error):
                break
        s = mgr.get(session.session_id)
        assert s.error is not None
        assert "LLM API failed" in s.error


# ============================================================
# 清理过期会话测试
# ============================================================


class TestCleanup:
    """清理过期会话"""

    @pytest.mark.asyncio
    async def test_cleanup_old_sessions(self):
        import time as time_module
        mgr = LLMStreamManager()
        # 创建一个已完成的会话
        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, mock_llm_caller)
        await asyncio.sleep(0.5)
        s = mgr.get(session.session_id)
        assert s.is_completed is True
        # 强制设置 completed_at 为很久以前
        s.completed_at = time_module.time() - 7200  # 2 hours ago
        removed = await mgr.cleanup_old_sessions(max_age_s=3600)
        assert removed == 1
        assert mgr.get(session.session_id) is None

    @pytest.mark.asyncio
    async def test_cleanup_recent_sessions_kept(self):
        mgr = LLMStreamManager()
        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, mock_llm_caller)
        await asyncio.sleep(0.5)
        removed = await mgr.cleanup_old_sessions(max_age_s=3600)
        assert removed == 0
        assert mgr.get(session.session_id) is not None


# ============================================================
# 背压测试
# ============================================================


class TestBackpressure:
    """背压机制（MAX_BUFFER_TOKENS 限制）"""

    @pytest.mark.asyncio
    async def test_buffer_flushes_at_interval(self):
        """缓冲应按时间间隔刷新"""
        mgr = LLMStreamManager()
        # 修改 flush interval 让测试更快
        mgr.FLUSH_INTERVAL_S = 0.05

        # 慢速 caller 每 5ms 输出 1 token
        async def caller(sp, p, m):
            for i in range(10):
                await asyncio.sleep(0.005)
                yield f"t{i}"

        session = await mgr.create("hi", model="m")
        await mgr.start(session.session_id, caller)
        # 等待完成
        for _ in range(50):
            await asyncio.sleep(0.05)
            s = mgr.get(session.session_id)
            if s and s.is_completed:
                break
        s = mgr.get(session.session_id)
        assert s.is_completed is True
        assert s.token_count == 10
        # 累积内容应完整
        assert "t9" in s.accumulated


# ============================================================
# 全局单例测试
# ============================================================


class TestGlobalSingleton:
    """全局单例"""

    def test_singleton(self):
        reset_stream_manager()
        m1 = get_stream_manager()
        m2 = get_stream_manager()
        assert m1 is m2
        reset_stream_manager()
        m3 = get_stream_manager()
        assert m3 is not m1
