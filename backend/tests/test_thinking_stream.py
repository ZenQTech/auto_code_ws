"""
# ============================================================
# ThinkingStreamService 单元测试 (v1.0.0)
# Cycle 67 G67-01
# ====================================
# 覆盖：
#   1. 基础生命周期 start_step → append_delta → end_step
#   2. LRU 淘汰（>200 step）
#   3. 内容截断（>50KB）
#   4. 订阅机制
#   5. 并发安全
#   6. 异常处理
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
# ====================================
"""

import asyncio
import pytest
import pytest_asyncio
import time

from app.services.thinking_stream import (
    ThinkingStep,
    ThinkingStreamService,
    MAX_CONTENT_SIZE,
    MAX_STEPS_PER_SESSION,
    MAX_SUBSCRIBERS_PER_SESSION,
    SubscriptionLimitError,
    ThinkingStepNotFoundError,
    get_thinking_stream_service,
    reset_thinking_stream_service,
)


# ============================================================
# Fixtures
# ====================================


@pytest_asyncio.fixture
async def service():
    """创建新的 service 实例（每个测试独立）"""
    svc = ThinkingStreamService()
    yield svc
    # 测试结束后清理
    svc._subscribers.clear()


@pytest.fixture(autouse=True)
def reset_global_singleton():
    """每个测试前重置全局单例"""
    reset_thinking_stream_service()
    yield
    reset_thinking_stream_service()


# ============================================================
# 测试：基础生命周期
# ====================================


class TestBasicLifecycle:
    """基础生命周期测试"""

    @pytest.mark.asyncio
    async def test_start_step_creates_new_step(self, service):
        """start_step 应创建新 step 并设置基本属性"""
        step = await service.start_step("session-1", "agent-1", model="claude-opus")
        assert step.session_id == "session-1"
        assert step.agent_id == "agent-1"
        assert step.model == "claude-opus"
        assert step.status == "running"
        assert step.step_index == 0
        assert step.content == ""
        assert step.tokens == 0
        assert step.started_at > 0
        assert step.ended_at is None

    @pytest.mark.asyncio
    async def test_append_delta_updates_content(self, service):
        """append_delta 应累加 content"""
        step = await service.start_step("s1", "a1")
        await service.append_delta(step.step_id, "Hello ")
        await service.append_delta(step.step_id, "World")
        updated = await service.append_delta(step.step_id, "!")
        assert updated.content == "Hello World!"
        assert updated.tokens == 3  # 3 个 delta

    @pytest.mark.asyncio
    async def test_end_step_marks_completed(self, service):
        """end_step 应标记 completed + 设置 ended_at"""
        step = await service.start_step("s1", "a1")
        await service.append_delta(step.step_id, "thinking...")
        ended = await service.end_step(step.step_id, summary="Decided to go right")
        assert ended.status == "completed"
        assert ended.ended_at is not None
        assert ended.summary == "Decided to go right"

    @pytest.mark.asyncio
    async def test_end_step_without_summary(self, service):
        """end_step 不传 summary 也应正常工作"""
        step = await service.start_step("s1", "a1")
        ended = await service.end_step(step.step_id)
        assert ended.status == "completed"
        assert ended.summary == ""

    @pytest.mark.asyncio
    async def test_end_step_with_metadata(self, service):
        """end_step 应合并 metadata"""
        step = await service.start_step("s1", "a1", metadata={"k": "v1"})
        ended = await service.end_step(
            step.step_id, summary="done", metadata={"k2": "v2"}
        )
        assert ended.metadata == {"k": "v1", "k2": "v2"}

    @pytest.mark.asyncio
    async def test_step_index_increments(self, service):
        """step_index 应该在 session 内递增"""
        s1 = await service.start_step("s1", "a1")
        s2 = await service.start_step("s1", "a1")
        s3 = await service.start_step("s1", "a1")
        assert s1.step_index == 0
        assert s2.step_index == 1
        assert s3.step_index == 2

    @pytest.mark.asyncio
    async def test_step_index_per_session(self, service):
        """step_index 应该在每个 session 内独立递增"""
        s1 = await service.start_step("s1", "a1")
        s2 = await service.start_step("s2", "a1")
        s3 = await service.start_step("s1", "a1")
        assert s1.step_index == 0
        assert s2.step_index == 0
        assert s3.step_index == 1


# ============================================================
# 测试：查询接口
# ====================================


class TestQueryAPIs:
    """查询接口测试"""

    @pytest.mark.asyncio
    async def test_get_step_by_id(self, service):
        """get_step 应能根据 step_id 获取"""
        step = await service.start_step("s1", "a1")
        fetched = service.get_step(step.step_id)
        assert fetched is not None
        assert fetched.step_id == step.step_id

    @pytest.mark.asyncio
    async def test_get_step_not_found(self, service):
        """get_step 在 step_id 不存在时返回 None"""
        assert service.get_step("nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_current_step(self, service):
        """get_current_step 应返回最近 running 的 step"""
        s1 = await service.start_step("s1", "a1")
        await service.end_step(s1.step_id)
        s2 = await service.start_step("s1", "a1")
        current = service.get_current_step("s1")
        assert current is not None
        assert current.step_id == s2.step_id
        assert current.status == "running"

    @pytest.mark.asyncio
    async def test_get_current_step_empty(self, service):
        """get_current_step 在 session 不存在时返回 None"""
        assert service.get_current_step("nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_session_steps_reverse(self, service):
        """get_session_steps reverse=True 应返回最新的在前"""
        s1 = await service.start_step("s1", "a1")
        s2 = await service.start_step("s1", "a1")
        s3 = await service.start_step("s1", "a1")
        steps = service.get_session_steps("s1", reverse=True)
        assert len(steps) == 3
        assert steps[0].step_id == s3.step_id
        assert steps[1].step_id == s2.step_id
        assert steps[2].step_id == s1.step_id

    @pytest.mark.asyncio
    async def test_get_session_steps_no_reverse(self, service):
        """get_session_steps reverse=False 应返回最旧的在前面"""
        s1 = await service.start_step("s1", "a1")
        s2 = await service.start_step("s1", "a1")
        steps = service.get_session_steps("s1", reverse=False)
        assert steps[0].step_id == s1.step_id
        assert steps[1].step_id == s2.step_id

    @pytest.mark.asyncio
    async def test_get_session_steps_limit(self, service):
        """get_session_steps 应遵守 limit 参数"""
        for i in range(5):
            await service.start_step("s1", "a1")
        steps = service.get_session_steps("s1", limit=3)
        assert len(steps) == 3

    @pytest.mark.asyncio
    async def test_count_session_steps(self, service):
        """count_session_steps 应返回 step 数量"""
        await service.start_step("s1", "a1")
        await service.start_step("s1", "a1")
        await service.start_step("s2", "a1")
        assert service.count_session_steps("s1") == 2
        assert service.count_session_steps("s2") == 1
        assert service.count_session_steps("nonexistent") == 0

    @pytest.mark.asyncio
    async def test_clear_session(self, service):
        """clear_session 应清空全部 step"""
        s1 = await service.start_step("s1", "a1")
        s2 = await service.start_step("s1", "a1")
        cleared = service.clear_session("s1")
        assert cleared == 2
        assert service.count_session_steps("s1") == 0
        assert service.get_step(s1.step_id) is None
        assert service.get_step(s2.step_id) is None

    @pytest.mark.asyncio
    async def test_clear_nonexistent_session(self, service):
        """clear_session 在 session 不存在时返回 0"""
        assert service.clear_session("nonexistent") == 0


# ============================================================
# 测试：内容截断
# ====================================


class TestTruncation:
    """内容截断测试"""

    @pytest.mark.asyncio
    async def test_truncate_large_content(self, service):
        """内容超过 50KB 应被截断并标记"""
        step = await service.start_step("s1", "a1")
        # 一次推送 > 50KB 的内容
        large_delta = "x" * (MAX_CONTENT_SIZE + 1000)
        updated = await service.append_delta(step.step_id, large_delta)
        assert updated.status == "truncated"
        # 截断标记存在
        assert "TRUNCATED" in updated.content
        # truncated_at_size 记录截断时的大小
        assert "truncated_at_size" in updated.metadata

    @pytest.mark.asyncio
    async def test_truncate_at_byte_boundary(self, service):
        """多字节字符不应破坏截断"""
        step = await service.start_step("s1", "a1")
        # 中文（3 字节/字符）
        large_delta = "中" * 20000  # 60000 字节 > 50KB
        updated = await service.append_delta(step.step_id, large_delta)
        # 截断后内容大小 < 50KB + 200 (200 为截断标记预留)
        assert len(updated.content.encode("utf-8")) <= MAX_CONTENT_SIZE + 500

    @pytest.mark.asyncio
    async def test_normal_content_not_truncated(self, service):
        """正常大小内容不应触发截断"""
        step = await service.start_step("s1", "a1")
        for _ in range(100):
            await service.append_delta(step.step_id, "hello ")
        updated = service.get_step(step.step_id)
        assert updated.status == "running"
        assert "TRUNCATED" not in updated.content

    @pytest.mark.asyncio
    async def test_ignore_delta_after_truncation(self, service):
        """截断后应忽略后续 delta"""
        step = await service.start_step("s1", "a1")
        await service.append_delta(step.step_id, "x" * (MAX_CONTENT_SIZE + 100))
        size_after_truncate = len(service.get_step(step.step_id).content)
        await service.append_delta(step.step_id, "more content")
        # 截断后 size 不再增加
        assert len(service.get_step(step.step_id).content) == size_after_truncate


# ============================================================
# 测试：订阅机制
# ====================================


class TestSubscription:
    """订阅机制测试"""

    @pytest.mark.asyncio
    async def test_subscribe_receives_start_event(self, service):
        """订阅者应收到 start 事件"""
        received = []

        async def callback(step, event_type):
            received.append((step.step_id, event_type))

        await service.subscribe("s1", callback)
        step = await service.start_step("s1", "a1")
        # 等待异步通知
        await asyncio.sleep(0.05)
        assert len(received) == 1
        assert received[0] == (step.step_id, "start")

    @pytest.mark.asyncio
    async def test_subscribe_receives_delta_events(self, service):
        """订阅者应收到 delta 事件"""
        received = []

        async def callback(step, event_type):
            received.append((step.step_id, event_type, step.content))

        await service.subscribe("s1", callback)
        step = await service.start_step("s1", "a1")
        await service.append_delta(step.step_id, "Hello")
        await service.append_delta(step.step_id, " World")
        await asyncio.sleep(0.05)
        # start + 2 deltas
        assert len(received) == 3
        assert received[0][1] == "start"
        assert received[1][1] == "delta"
        assert received[2][1] == "delta"
        assert received[2][2] == "Hello World"

    @pytest.mark.asyncio
    async def test_subscribe_receives_end_event(self, service):
        """订阅者应收到 end 事件"""
        received = []

        async def callback(step, event_type):
            received.append((event_type, step.summary))

        await service.subscribe("s1", callback)
        step = await service.start_step("s1", "a1")
        await service.end_step(step.step_id, summary="done")
        await asyncio.sleep(0.05)
        assert any(ev[0] == "end" and ev[1] == "done" for ev in received)

    @pytest.mark.asyncio
    async def test_unsubscribe_stops_events(self, service):
        """取消订阅后应停止接收事件"""
        received = []

        async def callback(step, event_type):
            received.append(event_type)

        sub_id = await service.subscribe("s1", callback)
        await service.start_step("s1", "a1")
        await asyncio.sleep(0.05)
        await service.unsubscribe("s1", sub_id)
        await service.start_step("s1", "a1")
        await asyncio.sleep(0.05)
        # 只有第一个 start 触发
        assert received == ["start"]

    @pytest.mark.asyncio
    async def test_unsubscribe_invalid_id(self, service):
        """取消不存在的订阅应返回 False"""
        result = await service.unsubscribe("s1", "invalid-id")
        assert result is False

    @pytest.mark.asyncio
    async def test_subscription_limit(self, service):
        """订阅者达上限应抛错"""
        for i in range(MAX_SUBSCRIBERS_PER_SESSION):
            async def cb(step, et): pass
            await service.subscribe("s1", cb)
        # 下一个应抛错
        async def extra_cb(step, et): pass
        with pytest.raises(SubscriptionLimitError):
            await service.subscribe("s1", extra_cb)

    @pytest.mark.asyncio
    async def test_multiple_subscribers_all_notified(self, service):
        """多个订阅者应都被通知"""
        r1, r2 = [], []

        async def cb1(step, et):
            r1.append(et)

        async def cb2(step, et):
            r2.append(et)

        await service.subscribe("s1", cb1)
        await service.subscribe("s1", cb2)
        step = await service.start_step("s1", "a1")
        await asyncio.sleep(0.05)
        assert r1 == ["start"]
        assert r2 == ["start"]

    @pytest.mark.asyncio
    async def test_isolated_per_session(self, service):
        """不同 session 的订阅者应隔离"""
        received_s1, received_s2 = [], []

        async def cb1(step, et):
            received_s1.append(et)

        async def cb2(step, et):
            received_s2.append(et)

        await service.subscribe("s1", cb1)
        await service.subscribe("s2", cb2)
        await service.start_step("s2", "a1")
        await asyncio.sleep(0.05)
        assert received_s1 == []
        assert received_s2 == ["start"]


# ============================================================
# 测试：异常场景
# ====================================


class TestErrorScenarios:
    """异常场景测试"""

    @pytest.mark.asyncio
    async def test_append_delta_unknown_step(self, service):
        """append_delta 未知 step_id 应返回 None"""
        result = await service.append_delta("nonexistent", "data")
        assert result is None

    @pytest.mark.asyncio
    async def test_append_delta_after_end(self, service):
        """end_step 之后 append_delta 应被忽略"""
        step = await service.start_step("s1", "a1")
        await service.end_step(step.step_id)
        result = await service.append_delta(step.step_id, "more")
        assert result is None

    @pytest.mark.asyncio
    async def test_end_step_unknown(self, service):
        """end_step 未知 step_id 应返回 None"""
        result = await service.end_step("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_to_dict(self, service):
        """to_dict 应返回完整序列化数据"""
        import asyncio
        step = await service.start_step("s1", "a1", model="claude-opus")
        await service.append_delta(step.step_id, "hello")
        # 等待 10ms 以确保 duration_ms > 0
        await asyncio.sleep(0.01)
        await service.end_step(step.step_id, summary="done")
        d = step.to_dict()
        assert d["step_id"] == step.step_id
        assert d["session_id"] == "s1"
        assert d["agent_id"] == "a1"
        assert d["content"] == "hello"
        assert d["status"] == "completed"
        assert d["summary"] == "done"
        assert d["model"] == "claude-opus"
        assert d["duration_ms"] >= 10  # 至少 10ms


# ============================================================
# 测试：LRU 淘汰
# ====================================


class TestLRUEviction:
    """LRU 淘汰测试"""

    @pytest.mark.asyncio
    async def test_lru_eviction_at_limit(self, service):
        """超过 MAX_STEPS_PER_SESSION 应触发 LRU 淘汰"""
        # 启动 MAX_STEPS_PER_SESSION + 5 个 step
        first_steps = []
        for i in range(MAX_STEPS_PER_SESSION):
            s = await service.start_step("s1", "a1")
            first_steps.append(s.step_id)

        # 多余的 5 个
        for i in range(5):
            await service.start_step("s1", "a1")

        # 旧 step 应被淘汰
        total = service.count_session_steps("s1")
        assert total == MAX_STEPS_PER_SESSION
        # 第一个应被淘汰
        assert service.get_step(first_steps[0]) is None
        # 最后一个应存在
        steps = service.get_session_steps("s1", reverse=False, limit=1)
        assert steps[0].step_id != first_steps[0]


# ============================================================
# 测试：全局单例
# ====================================


class TestGlobalSingleton:
    """全局单例测试"""

    def test_get_thinking_stream_service_returns_singleton(self):
        """get_thinking_stream_service 应返回单例"""
        s1 = get_thinking_stream_service()
        s2 = get_thinking_stream_service()
        assert s1 is s2

    def test_reset_thinking_stream_service(self):
        """reset_thinking_stream_service 应清空单例"""
        s1 = get_thinking_stream_service()
        reset_thinking_stream_service()
        s2 = get_thinking_stream_service()
        assert s1 is not s2


# ============================================================
# 测试：并发安全
# ====================================


class TestConcurrency:
    """并发安全测试"""

    @pytest.mark.asyncio
    async def test_concurrent_start_step(self, service):
        """并发 start_step 应正确递增 step_index"""
        tasks = [service.start_step("s1", "a1") for _ in range(20)]
        steps = await asyncio.gather(*tasks)
        indices = sorted(s.step_index for s in steps)
        assert indices == list(range(20))

    @pytest.mark.asyncio
    async def test_concurrent_append_delta(self, service):
        """并发 append_delta 应正确累加"""
        step = await service.start_step("s1", "a1")
        tasks = [service.append_delta(step.step_id, f"chunk{i}") for i in range(50)]
        await asyncio.gather(*tasks)
        final = service.get_step(step.step_id)
        assert final.tokens == 50
        # 累计内容应包含所有 chunk
        for i in range(50):
            assert f"chunk{i}" in final.content

    @pytest.mark.asyncio
    async def test_concurrent_subscribe_and_start(self, service):
        """并发 subscribe + start_step 应正确处理"""
        # 订阅
        await service.subscribe("s1", lambda s, et: asyncio.sleep(0))
        # 启动 10 个 step
        tasks = [service.start_step("s1", "a1") for _ in range(10)]
        steps = await asyncio.gather(*tasks)
        assert len(steps) == 10
