"""
# ============================================================
# StreamingBuffer 单元测试 (v1.0.0) - Cycle 6 P0-7-B
# ============================================================
# 核心作用：为流式恢复网关 StreamingBuffer 提供单元测试
# 运行流程：pytest tests/test_streaming_buffer_units.py -v
# 覆盖范围：
#   1. 流注册：register_stream（自定义 ID / 默认 UUID / 元数据）
#   2. chunk 追加：append_chunk（顺序索引 / 自动递增 / 字节统计）
#   3. 流完成：complete_stream / fail_stream
#   4. 断点续传：subscribe（首次 / 增量 / 完成后）
#   5. 容器重启恢复：recover_active_streams / list_resumable_streams
#   6. 清理：cleanup_expired_streams
#   7. 统计：get_stats
#   8. 边界：seq 冲突 / 不存在的流 / 流已结束追加
# ============================================================
"""

import asyncio
import os
import tempfile
import time
from pathlib import Path

import pytest
import pytest_asyncio

from app.services.streaming_buffer import (
    StreamingBuffer,
    StreamChunk,
    StreamMetadata,
    StreamState,
    StreamStats,
    stream_context,
)


# ============================================================
# Fixtures
# ============================================================


@pytest_asyncio.fixture
async def temp_buffer():
    """每个测试使用独立的临时 SQLite 数据库"""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    try:
        buffer = StreamingBuffer(db_path=db_path)
        yield buffer
    finally:
        # 清理临时文件
        if os.path.exists(db_path):
            os.unlink(db_path)
        # 清理 WAL/SHM 文件
        for ext in [".db-wal", ".db-shm", "-wal", "-shm"]:
            p = db_path + ext
            if os.path.exists(p):
                os.unlink(p)


# ============================================================
# Test 1: 流注册
# ============================================================


@pytest.mark.asyncio
async def test_register_stream_default_uuid(temp_buffer: StreamingBuffer):
    """register_stream 默认生成 UUID"""
    meta = await temp_buffer.register_stream(session_id="sess-1")
    assert meta.stream_id is not None
    assert len(meta.stream_id) == 36  # UUID 长度
    assert meta.session_id == "sess-1"
    assert meta.state == StreamState.ACTIVE
    assert meta.total_chunks == 0
    assert meta.last_seq == -1
    assert meta.started_at > 0
    assert meta.completed_at is None


@pytest.mark.asyncio
async def test_register_stream_custom_id(temp_buffer: StreamingBuffer):
    """register_stream 接受自定义 stream_id"""
    custom_id = "my-custom-stream-123"
    meta = await temp_buffer.register_stream(
        stream_id=custom_id, session_id="sess-2", user_id="user-1", model="gpt-4"
    )
    assert meta.stream_id == custom_id
    assert meta.user_id == "user-1"
    assert meta.model == "gpt-4"


@pytest.mark.asyncio
async def test_register_stream_with_extra(temp_buffer: StreamingBuffer):
    """register_stream 接受 extra 元数据"""
    extra = {"phase": "clarification", "round": 2}
    meta = await temp_buffer.register_stream(session_id="sess-3", extra=extra)
    assert meta.extra == extra


@pytest.mark.asyncio
async def test_register_stream_replace_existing(temp_buffer: StreamingBuffer):
    """register_stream 同一 stream_id 可覆盖（INSERT OR REPLACE）"""
    meta1 = await temp_buffer.register_stream(stream_id="dup-1", session_id="s1")
    assert meta1.state == StreamState.ACTIVE

    meta2 = await temp_buffer.register_stream(stream_id="dup-1", session_id="s2")
    assert meta2.session_id == "s2"


# ============================================================
# Test 2: chunk 追加
# ============================================================


@pytest.mark.asyncio
async def test_append_chunk_auto_seq(temp_buffer: StreamingBuffer):
    """append_chunk 自动递增 seq"""
    meta = await temp_buffer.register_stream(stream_id="seq-1")
    chunk0 = await temp_buffer.append_chunk(meta.stream_id, "text", "hello")
    chunk1 = await temp_buffer.append_chunk(meta.stream_id, "text", "world")
    assert chunk0.seq == 0
    assert chunk1.seq == 1

    # 重新加载验证
    reloaded = await temp_buffer.get_stream(meta.stream_id)
    assert reloaded.total_chunks == 2
    assert reloaded.last_seq == 1


@pytest.mark.asyncio
async def test_append_chunk_explicit_seq(temp_buffer: StreamingBuffer):
    """append_chunk 接受显式 seq"""
    meta = await temp_buffer.register_stream(stream_id="seq-2")
    chunk = await temp_buffer.append_chunk(meta.stream_id, "text", "x", seq=100)
    assert chunk.seq == 100

    reloaded = await temp_buffer.get_stream(meta.stream_id)
    assert reloaded.last_seq == 100


@pytest.mark.asyncio
async def test_append_chunk_seq_decreasing_raises(temp_buffer: StreamingBuffer):
    """seq 必须单调递增，否则抛 ValueError"""
    meta = await temp_buffer.register_stream(stream_id="seq-3")
    await temp_buffer.append_chunk(meta.stream_id, "text", "a", seq=5)
    with pytest.raises(ValueError, match="必须是递增的"):
        await temp_buffer.append_chunk(meta.stream_id, "text", "b", seq=3)


@pytest.mark.asyncio
async def test_append_chunk_to_nonexistent_raises(temp_buffer: StreamingBuffer):
    """向不存在的流追加 chunk 应抛 ValueError"""
    with pytest.raises(ValueError, match="流不存在"):
        await temp_buffer.append_chunk("nonexistent", "text", "x")


@pytest.mark.asyncio
async def test_append_chunk_to_completed_raises(temp_buffer: StreamingBuffer):
    """已完成的流不允许追加 chunk"""
    meta = await temp_buffer.register_stream(stream_id="done-1")
    await temp_buffer.complete_stream(meta.stream_id)
    with pytest.raises(ValueError, match="流已结束"):
        await temp_buffer.append_chunk(meta.stream_id, "text", "x")


@pytest.mark.asyncio
async def test_append_chunk_updates_bytes(temp_buffer: StreamingBuffer):
    """append_chunk 累计字节数"""
    meta = await temp_buffer.register_stream(stream_id="bytes-1")
    await temp_buffer.append_chunk(meta.stream_id, "text", "你好")  # 6 bytes UTF-8
    await temp_buffer.append_chunk(meta.stream_id, "text", "abc")  # 3 bytes
    reloaded = await temp_buffer.get_stream(meta.stream_id)
    assert reloaded.total_bytes == 9


# ============================================================
# Test 3: 流完成/失败
# ============================================================


@pytest.mark.asyncio
async def test_complete_stream(temp_buffer: StreamingBuffer):
    """complete_stream 标记流为 completed"""
    meta = await temp_buffer.register_stream(stream_id="comp-1")
    await temp_buffer.append_chunk(meta.stream_id, "text", "x")
    completed = await temp_buffer.complete_stream(meta.stream_id)
    assert completed.state == StreamState.COMPLETED
    assert completed.completed_at is not None
    assert completed.completed_at >= meta.started_at

    # 不在内存中保留
    assert meta.stream_id not in temp_buffer._active_streams


@pytest.mark.asyncio
async def test_fail_stream(temp_buffer: StreamingBuffer):
    """fail_stream 标记流为 failed 并记录 error_message"""
    meta = await temp_buffer.register_stream(stream_id="fail-1")
    failed = await temp_buffer.fail_stream(meta.stream_id, "test error")
    assert failed.state == StreamState.FAILED
    assert failed.error_message == "test error"
    assert failed.completed_at is not None


@pytest.mark.asyncio
async def test_complete_nonexistent_stream(temp_buffer: StreamingBuffer):
    """complete_stream 对不存在的流返回 None"""
    result = await temp_buffer.complete_stream("nonexistent")
    assert result is None


# ============================================================
# Test 4: 断点续传
# ============================================================


@pytest.mark.asyncio
async def test_subscribe_first_time(temp_buffer: StreamingBuffer):
    """首次订阅返回所有 chunks"""
    meta = await temp_buffer.register_stream(stream_id="sub-1")
    for i in range(5):
        await temp_buffer.append_chunk(meta.stream_id, "text", f"chunk-{i}")

    result = await temp_buffer.subscribe(
        stream_id=meta.stream_id, client_id="client-1", last_ack_seq=-1
    )
    assert result["subscription_id"] is not None
    assert result["current_state"] == "active"
    assert result["total_chunks"] == 5
    assert len(result["replay_chunks"]) == 5
    assert result["replay_chunks"][0].seq == 0
    assert result["replay_chunks"][4].seq == 4


@pytest.mark.asyncio
async def test_subscribe_resume(temp_buffer: StreamingBuffer):
    """断点续传：只返回 last_ack_seq+1 之后的 chunks"""
    meta = await temp_buffer.register_stream(stream_id="sub-2")
    for i in range(5):
        await temp_buffer.append_chunk(meta.stream_id, "text", f"chunk-{i}")

    # 客户端已确认前 3 个，订阅从 seq=3 开始
    result = await temp_buffer.subscribe(
        stream_id=meta.stream_id, client_id="client-1", last_ack_seq=2
    )
    assert len(result["replay_chunks"]) == 2
    assert result["replay_chunks"][0].seq == 3
    assert result["replay_chunks"][1].seq == 4


@pytest.mark.asyncio
async def test_subscribe_completed_stream(temp_buffer: StreamingBuffer):
    """订阅已完成的流：返回所有 chunks + state=completed"""
    meta = await temp_buffer.register_stream(stream_id="sub-3")
    for i in range(3):
        await temp_buffer.append_chunk(meta.stream_id, "text", f"c{i}")
    await temp_buffer.complete_stream(meta.stream_id)

    result = await temp_buffer.subscribe(
        stream_id=meta.stream_id, client_id="client-1", last_ack_seq=-1
    )
    assert result["current_state"] == "completed"
    assert len(result["replay_chunks"]) == 3


@pytest.mark.asyncio
async def test_acknowledge(temp_buffer: StreamingBuffer):
    """acknowledge 更新 last_ack_seq"""
    meta = await temp_buffer.register_stream(stream_id="ack-1")
    for i in range(3):
        await temp_buffer.append_chunk(meta.stream_id, "text", f"c{i}")

    sub = await temp_buffer.subscribe(
        stream_id=meta.stream_id, client_id="client-1", last_ack_seq=-1
    )
    await temp_buffer.acknowledge(sub["subscription_id"], last_ack_seq=2)

    # 不抛异常即可（DB 验证不直接暴露）
    # 重新订阅：不应返回已 ACK 的 chunks
    result = await temp_buffer.subscribe(
        stream_id=meta.stream_id, client_id="client-2", last_ack_seq=2
    )
    assert len(result["replay_chunks"]) == 0  # 全部已 ACK


@pytest.mark.asyncio
async def test_subscribe_nonexistent_raises(temp_buffer: StreamingBuffer):
    """订阅不存在的流应抛 ValueError"""
    with pytest.raises(ValueError, match="流不存在"):
        await temp_buffer.subscribe(
            stream_id="nonexistent", client_id="c1", last_ack_seq=-1
        )


# ============================================================
# Test 5: 容器重启恢复
# ============================================================


@pytest.mark.asyncio
async def test_recover_active_streams_on_restart():
    """新建 buffer 时从 SQLite 恢复 active 流"""
    db_path = tempfile.mktemp(suffix=".db")

    try:
        # 第一个 buffer 实例：注册 + 追加 chunk
        buf1 = StreamingBuffer(db_path=db_path)
        meta = await buf1.register_stream(stream_id="recov-1", session_id="s1")
        await buf1.append_chunk(meta.stream_id, "text", "before restart")
        # 模拟崩溃：不调用 complete_stream
        assert meta.stream_id in buf1._active_streams

        # 第二个 buffer 实例：模拟容器重启
        buf2 = StreamingBuffer(db_path=db_path)
        # 启动时应自动从 DB 恢复
        assert meta.stream_id in buf2._active_streams
        reloaded = await buf2.get_stream(meta.stream_id)
        assert reloaded is not None
        assert reloaded.state == StreamState.ACTIVE
        assert reloaded.total_chunks == 1

        # chunks 也可查询
        chunks = await buf2.get_chunks(meta.stream_id, from_seq=0)
        assert len(chunks) == 1
        assert chunks[0].content == "before restart"
    finally:
        for ext in ["", "-wal", "-shm"]:
            p = db_path + ext
            if os.path.exists(p):
                os.unlink(p)


@pytest.mark.asyncio
async def test_list_resumable_streams(temp_buffer: StreamingBuffer):
    """list_resumable_streams 列出超过 idle 时间的 active 流"""
    # 创建一个"老"的 active 流（手动篡改 last_chunk_at）
    meta = await temp_buffer.register_stream(stream_id="idle-1")
    await temp_buffer.append_chunk(meta.stream_id, "text", "x")

    # 修改 last_chunk_at 为 60 秒前
    import sqlite3

    with temp_buffer._get_conn() as conn:
        conn.execute(
            "UPDATE streams SET last_chunk_at = ? WHERE stream_id = ?",
            (time.time() - 60, meta.stream_id),
        )
        conn.commit()

    # max_idle_seconds=30 应该能找到
    resumable = await temp_buffer.list_resumable_streams(max_idle_seconds=30.0)
    assert len(resumable) == 1
    assert resumable[0].stream_id == meta.stream_id

    # max_idle_seconds=120 应该找不到
    resumable2 = await temp_buffer.list_resumable_streams(max_idle_seconds=120.0)
    assert len(resumable2) == 0


# ============================================================
# Test 6: 清理
# ============================================================


@pytest.mark.asyncio
async def test_cleanup_expired_streams(temp_buffer: StreamingBuffer):
    """cleanup_expired_streams 删除超过 max_age 的 completed/failed 流"""
    # 创建并完成一个流
    meta1 = await temp_buffer.register_stream(stream_id="clean-1")
    await temp_buffer.complete_stream(meta1.stream_id)

    # 手动修改 completed_at 为很久以前
    import sqlite3

    with temp_buffer._get_conn() as conn:
        conn.execute(
            "UPDATE streams SET completed_at = ? WHERE stream_id = ?",
            (time.time() - 7200, meta1.stream_id),  # 2 小时前
        )
        conn.commit()

    # 清理 1 小时前的 → 应该删除 clean-1
    deleted = await temp_buffer.cleanup_expired_streams(max_age_seconds=3600)
    assert deleted == 1

    # 验证已删除
    result = await temp_buffer.get_stream(meta1.stream_id)
    assert result is None


@pytest.mark.asyncio
async def test_cleanup_does_not_remove_active(temp_buffer: StreamingBuffer):
    """cleanup 不应删除 active 流"""
    meta = await temp_buffer.register_stream(stream_id="active-cleanup")
    deleted = await temp_buffer.cleanup_expired_streams(max_age_seconds=0)
    assert deleted == 0

    # 流仍在
    result = await temp_buffer.get_stream(meta.stream_id)
    assert result is not None
    assert result.state == StreamState.ACTIVE


# ============================================================
# Test 7: 统计
# ============================================================


@pytest.mark.asyncio
async def test_get_stats(temp_buffer: StreamingBuffer):
    """get_stats 返回各状态数量"""
    # 创建各种状态的流
    m1 = await temp_buffer.register_stream(stream_id="s-1")
    m2 = await temp_buffer.register_stream(stream_id="s-2")
    await temp_buffer.complete_stream(m2.stream_id)
    m3 = await temp_buffer.register_stream(stream_id="s-3")
    await temp_buffer.fail_stream(m3.stream_id, "err")

    # 累计 chunks（仅对 active 流）
    await temp_buffer.append_chunk(m1.stream_id, "text", "hello")

    stats = await temp_buffer.get_stats()
    assert isinstance(stats, StreamStats)
    assert stats.total_streams == 3
    assert stats.active_streams == 1
    assert stats.completed_streams == 1
    assert stats.failed_streams == 1
    assert stats.total_chunks == 1

    stats_dict = stats.to_dict()
    assert "total_streams" in stats_dict
    assert "resumable_streams" in stats_dict


# ============================================================
# Test 8: 边界与异常
# ============================================================


@pytest.mark.asyncio
async def test_get_chunks_with_limit(temp_buffer: StreamingBuffer):
    """get_chunks 接受 limit 参数"""
    meta = await temp_buffer.register_stream(stream_id="limit-1")
    for i in range(10):
        await temp_buffer.append_chunk(meta.stream_id, "text", f"c{i}")

    chunks = await temp_buffer.get_chunks(meta.stream_id, from_seq=0, limit=3)
    assert len(chunks) == 3
    assert chunks[0].seq == 0
    assert chunks[2].seq == 2


@pytest.mark.asyncio
async def test_list_streams_by_session(temp_buffer: StreamingBuffer):
    """list_streams_by_session 返回指定会话的所有流"""
    await temp_buffer.register_stream(stream_id="sess-a-1", session_id="A")
    await temp_buffer.register_stream(stream_id="sess-a-2", session_id="A")
    await temp_buffer.register_stream(stream_id="sess-b-1", session_id="B")

    a_streams = await temp_buffer.list_streams_by_session("A")
    assert len(a_streams) == 2

    b_streams = await temp_buffer.list_streams_by_session("B")
    assert len(b_streams) == 1


@pytest.mark.asyncio
async def test_list_active_streams(temp_buffer: StreamingBuffer):
    """list_active_streams 只返回 active 流"""
    m1 = await temp_buffer.register_stream(stream_id="a-1")
    m2 = await temp_buffer.register_stream(stream_id="a-2")
    await temp_buffer.complete_stream(m2.stream_id)

    active = await temp_buffer.list_active_streams()
    assert len(active) == 1
    assert active[0].stream_id == m1.stream_id


# ============================================================
# Test 9: 异步上下文管理器
# ============================================================


@pytest.mark.asyncio
async def test_stream_context_success():
    """stream_context 正常完成时自动标记 completed"""
    # 使用 reset_streaming_buffer 隔离测试
    from app.services.streaming_buffer import (
        reset_streaming_buffer,
        get_streaming_buffer,
    )
    reset_streaming_buffer()

    async with stream_context(session_id="ctx-1") as (stream_id, buffer):
        await buffer.append_chunk(stream_id, "text", "hello")
        await buffer.append_chunk(stream_id, "text", "world")

    buffer = await get_streaming_buffer()
    meta = await buffer.get_stream(stream_id)
    assert meta is not None
    assert meta.state == StreamState.COMPLETED
    assert meta.total_chunks == 2


@pytest.mark.asyncio
async def test_stream_context_failure():
    """stream_context 异常时自动标记 failed"""
    from app.services.streaming_buffer import (
        reset_streaming_buffer,
        get_streaming_buffer,
    )
    reset_streaming_buffer()

    stream_id = None
    with pytest.raises(RuntimeError, match="test error"):
        async with stream_context(session_id="ctx-2") as (sid, buffer):
            stream_id = sid
            await buffer.append_chunk(sid, "text", "x")
            raise RuntimeError("test error")

    buffer = await get_streaming_buffer()
    meta = await buffer.get_stream(stream_id)
    assert meta is not None
    assert meta.state == StreamState.FAILED
    assert "test error" in meta.error_message


# ============================================================
# Test 10: SSE 转换
# ============================================================


@pytest.mark.asyncio
async def test_chunk_to_sse(temp_buffer: StreamingBuffer):
    """StreamChunk.to_sse 生成标准 SSE 格式"""
    meta = await temp_buffer.register_stream(stream_id="sse-1")
    chunk = await temp_buffer.append_chunk(meta.stream_id, "text", "hello 世界")
    sse = chunk.to_sse()
    assert sse.startswith("data: ")
    assert sse.endswith("\n\n")
    assert "hello 世界" in sse
    assert '"type": "text"' in sse


@pytest.mark.asyncio
async def test_metadata_to_dict(temp_buffer: StreamingBuffer):
    """StreamMetadata.to_dict 返回完整字典"""
    meta = await temp_buffer.register_stream(
        stream_id="dict-1", session_id="s", user_id="u", extra={"k": "v"}
    )
    d = meta.to_dict()
    assert d["stream_id"] == "dict-1"
    assert d["session_id"] == "s"
    assert d["user_id"] == "u"
    assert d["state"] == "active"
    assert d["extra"] == {"k": "v"}
    assert "started_at" in d
