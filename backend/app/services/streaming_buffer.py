"""
# ============================================================
# 流式恢复网关服务 (v1.0.0) - Cycle 6 P0-7-B
# ============================================================
# 核心作用：为 Hermes 流式对话提供断点续传能力
#           解决容器重启 / 网络中断 / 客户端断连时 SSE 流丢失问题
#           参考 Cloudflare Agents SDK fiber-refactor + aiinsiders.net
#           "Stop Paying Twice: The Gateway Buffer Fix for Agent Crashes"
# 运行流程：
#   1. 流启动：register_stream(stream_id, session_id, metadata)
#   2. 流写入：append_chunk(stream_id, seq, event_type, content)
#      - 顺序索引 (seq) 单调递增
#      - SQLite 持久化 (PRIMARY KEY (stream_id, seq))
#   3. 客户端订阅：subscribe(stream_id, last_ack_seq=0)
#      - SSE replay: from_seq = last_ack_seq + 1
#   4. 容器重启恢复：
#      - list_resumable_streams() → 加载 state='active' 但 last_chunk_at < now-30s
#      - 客户端可重新订阅，从 last_ack_seq+1 开始 replay
#   5. 流结束：complete_stream(stream_id) 或 fail_stream(stream_id, error)
#   6. TTL 清理：cleanup_expired_streams(max_age_seconds=3600)
# 输入参数：
#   - stream_id: 流唯一标识（UUID）
#   - session_id: 关联的对话 Session ID
#   - seq: 顺序索引（0-based, 单调递增）
#   - event_type: SSE 事件类型 (thinking/text/done/error/workflow_started 等)
#   - content: SSE 事件内容
# 输出结果：完整的流式恢复能力（断点续传、订阅、状态查询）
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-B 新建
#     - SQLite 持久化：streams / chunks / subscriptions 三表设计
#     - 顺序 chunk 索引：PRIMARY KEY (stream_id, seq)
#     - 断点续传：subscribe(from_seq) 返回未确认 chunks
#     - 容器重启恢复：list_resumable_streams() 自动加载
#     - 统计接口：get_stats() 返回活跃/已完成/失败流数
# ============================================================
"""

import asyncio
import json
import logging
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据结构
# ============================================================


class StreamState(str, Enum):
    """流生命周期状态"""
    ACTIVE = "active"          # 进行中
    PAUSED = "paused"          # 暂停（客户端断连但服务端仍在生成）
    COMPLETED = "completed"    # 正常完成
    FAILED = "failed"          # 异常失败
    EXPIRED = "expired"        # TTL 过期


@dataclass
class StreamMetadata:
    """流元数据"""
    stream_id: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    model: str = "claude-sonnet-4"
    state: StreamState = StreamState.ACTIVE
    started_at: float = field(default_factory=time.time)
    last_chunk_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    total_chunks: int = 0
    total_bytes: int = 0
    last_seq: int = -1
    error_message: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stream_id": self.stream_id,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "model": self.model,
            "state": self.state.value,
            "started_at": self.started_at,
            "last_chunk_at": self.last_chunk_at,
            "completed_at": self.completed_at,
            "total_chunks": self.total_chunks,
            "total_bytes": self.total_bytes,
            "last_seq": self.last_seq,
            "error_message": self.error_message,
            "extra": self.extra,
        }


@dataclass
class StreamChunk:
    """流分片"""
    seq: int
    event_type: str
    content: str
    created_at: float

    def to_sse(self) -> str:
        """转换为 SSE 格式"""
        return f"data: {json.dumps({'type': self.event_type, 'content': self.content}, ensure_ascii=False)}\n\n"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "event_type": self.event_type,
            "content": self.content,
            "created_at": self.created_at,
        }


@dataclass
class StreamStats:
    """流统计"""
    total_streams: int = 0
    active_streams: int = 0
    completed_streams: int = 0
    failed_streams: int = 0
    expired_streams: int = 0
    total_chunks: int = 0
    total_bytes: int = 0
    resumable_streams: int = 0  # 可恢复的（active 但客户端断连）

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_streams": self.total_streams,
            "active_streams": self.active_streams,
            "completed_streams": self.completed_streams,
            "failed_streams": self.failed_streams,
            "expired_streams": self.expired_streams,
            "total_chunks": self.total_chunks,
            "total_bytes": self.total_bytes,
            "resumable_streams": self.resumable_streams,
        }


# ============================================================
# 流式缓冲区核心服务
# ============================================================


class StreamingBuffer:
    """
    流式恢复网关核心服务

    责任：
      1. 注册/管理 SSE 流生命周期
      2. 持久化 chunks 到 SQLite（顺序索引）
      3. 提供断点续传：从 last_ack_seq+1 重新订阅
      4. 容器重启恢复：自动识别可恢复流
      5. 统计与监控
    """

    # SQLite schema
    SCHEMA = """
    CREATE TABLE IF NOT EXISTS streams (
        stream_id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT,
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4',
        state TEXT NOT NULL DEFAULT 'active',
        started_at REAL NOT NULL,
        last_chunk_at REAL NOT NULL,
        completed_at REAL,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        last_seq INTEGER NOT NULL DEFAULT -1,
        error_message TEXT,
        extra_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_streams_state ON streams(state);
    CREATE INDEX IF NOT EXISTS idx_streams_session ON streams(session_id);
    CREATE INDEX IF NOT EXISTS idx_streams_last_chunk ON streams(last_chunk_at);

    CREATE TABLE IF NOT EXISTS chunks (
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at REAL NOT NULL,
        PRIMARY KEY (stream_id, seq),
        FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_stream ON chunks(stream_id);

    CREATE TABLE IF NOT EXISTS subscriptions (
        subscription_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        last_ack_seq INTEGER NOT NULL DEFAULT -1,
        connected_at REAL NOT NULL,
        disconnected_at REAL,
        FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_stream ON subscriptions(stream_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client_id);
    """

    def __init__(self, db_path: Optional[str] = None):
        """
        初始化流式缓冲区

        参数：
          - db_path: SQLite 数据库文件路径（默认 ~/.hermes/streaming_buffer.db）
        """
        if db_path is None:
            home = Path.home()
            data_dir = home / ".hermes"
            data_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(data_dir / "streaming_buffer.db")

        self._db_path = db_path
        self._lock = asyncio.Lock()
        # 内存中的活跃流（避免频繁查 DB）
        self._active_streams: Dict[str, StreamMetadata] = {}
        # 流关闭事件（用于 SSE 实时推送）
        self._stream_events: Dict[str, asyncio.Event] = {}
        # 初始化 schema
        self._init_schema()
        # 启动时加载可恢复的 active 流
        self._recover_active_streams()
        logger.info(f"StreamingBuffer 初始化完成: db_path={self._db_path}")

    def _init_schema(self) -> None:
        """初始化 SQLite schema"""
        with self._get_conn() as conn:
            conn.executescript(self.SCHEMA)
            conn.commit()

    def _get_conn(self) -> sqlite3.Connection:
        """获取 SQLite 连接（每次新建，简单可靠）"""
        conn = sqlite3.connect(self._db_path, timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # 启用 WAL 模式提升并发
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _recover_active_streams(self) -> None:
        """启动时恢复 active 流（容器重启场景）"""
        try:
            with self._get_conn() as conn:
                rows = conn.execute(
                    "SELECT * FROM streams WHERE state = ?", (StreamState.ACTIVE.value,)
                ).fetchall()
                for row in rows:
                    meta = self._row_to_metadata(row)
                    self._active_streams[meta.stream_id] = meta
                logger.info(f"恢复 {len(rows)} 个 active 流到内存")
        except Exception as e:
            logger.error(f"恢复 active 流失败: {e}", exc_info=True)

    @staticmethod
    def _row_to_metadata(row: sqlite3.Row) -> StreamMetadata:
        """SQLite row → StreamMetadata"""
        extra_json = row["extra_json"] or "{}"
        try:
            extra = json.loads(extra_json)
        except json.JSONDecodeError:
            extra = {}
        return StreamMetadata(
            stream_id=row["stream_id"],
            session_id=row["session_id"],
            user_id=row["user_id"],
            model=row["model"],
            state=StreamState(row["state"]),
            started_at=row["started_at"],
            last_chunk_at=row["last_chunk_at"],
            completed_at=row["completed_at"],
            total_chunks=row["total_chunks"],
            total_bytes=row["total_bytes"],
            last_seq=row["last_seq"],
            error_message=row["error_message"],
            extra=extra,
        )

    # ============================================================
    # 流生命周期管理
    # ============================================================

    async def register_stream(
        self,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: str = "claude-sonnet-4",
        stream_id: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> StreamMetadata:
        """
        注册一个新的 SSE 流

        参数：
          - stream_id: 可选自定义 ID（默认生成 UUID）
          - session_id: 关联的会话 ID
          - user_id: 用户 ID
          - model: 使用的 LLM 模型
          - extra: 额外的元数据

        返回值：StreamMetadata
        """
        if stream_id is None:
            stream_id = str(uuid.uuid4())

        now = time.time()
        meta = StreamMetadata(
            stream_id=stream_id,
            session_id=session_id,
            user_id=user_id,
            model=model,
            state=StreamState.ACTIVE,
            started_at=now,
            last_chunk_at=now,
            total_chunks=0,
            total_bytes=0,
            last_seq=-1,
            extra=extra or {},
        )

        async with self._lock:
            try:
                with self._get_conn() as conn:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO streams
                        (stream_id, session_id, user_id, model, state,
                         started_at, last_chunk_at, completed_at, total_chunks,
                         total_bytes, last_seq, error_message, extra_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)
                        """,
                        (
                            meta.stream_id,
                            meta.session_id,
                            meta.user_id,
                            meta.model,
                            meta.state.value,
                            meta.started_at,
                            meta.last_chunk_at,
                            meta.total_chunks,
                            meta.total_bytes,
                            meta.last_seq,
                            json.dumps(meta.extra),
                        ),
                    )
                    conn.commit()
                self._active_streams[meta.stream_id] = meta
                self._stream_events[meta.stream_id] = asyncio.Event()
                logger.info(f"注册流: stream_id={stream_id} session_id={session_id}")
                return meta
            except Exception as e:
                logger.error(f"注册流失败: {e}", exc_info=True)
                raise

    async def append_chunk(
        self,
        stream_id: str,
        event_type: str,
        content: str,
        seq: Optional[int] = None,
    ) -> StreamChunk:
        """
        向流追加一个 chunk

        参数：
          - stream_id: 流 ID
          - event_type: 事件类型 (thinking/text/done/error/...)
          - content: 事件内容
          - seq: 顺序索引（默认自动递增）

        返回值：StreamChunk
        """
        async with self._lock:
            meta = self._active_streams.get(stream_id)
            if meta is None:
                # 从 DB 加载（容器重启后场景）
                meta = await self._load_metadata(stream_id)
                if meta is None:
                    raise ValueError(f"流不存在: {stream_id}")
                if meta.state != StreamState.ACTIVE:
                    raise ValueError(f"流已结束: {stream_id} state={meta.state.value}")
                self._active_streams[stream_id] = meta

            # 自动分配 seq
            if seq is None:
                seq = meta.last_seq + 1
            elif seq <= meta.last_seq:
                raise ValueError(
                    f"seq 必须是递增的: current={meta.last_seq} got={seq}"
                )

            now = time.time()
            chunk = StreamChunk(
                seq=seq,
                event_type=event_type,
                content=content,
                created_at=now,
            )

            try:
                with self._get_conn() as conn:
                    conn.execute(
                        """
                        INSERT INTO chunks
                        (stream_id, seq, event_type, content, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (stream_id, seq, event_type, content, now),
                    )
                    # 更新 stream 元数据
                    content_bytes = len(content.encode("utf-8"))
                    conn.execute(
                        """
                        UPDATE streams SET
                            last_chunk_at = ?,
                            total_chunks = total_chunks + 1,
                            total_bytes = total_bytes + ?,
                            last_seq = ?
                        WHERE stream_id = ?
                        """,
                        (now, content_bytes, seq, stream_id),
                    )
                    conn.commit()

                # 更新内存状态
                meta.last_chunk_at = now
                meta.total_chunks += 1
                meta.total_bytes += len(content.encode("utf-8"))
                meta.last_seq = seq

                # 通知订阅者
                if stream_id in self._stream_events:
                    self._stream_events[stream_id].set()

                return chunk
            except sqlite3.IntegrityError as e:
                logger.error(f"chunk 唯一约束冲突: {e}")
                raise
            except Exception as e:
                logger.error(f"追加 chunk 失败: {e}", exc_info=True)
                raise

    async def complete_stream(self, stream_id: str) -> StreamMetadata:
        """
        标记流正常完成

        参数：
          - stream_id: 流 ID

        返回值：更新后的 StreamMetadata
        """
        return await self._finalize_stream(
            stream_id, StreamState.COMPLETED, error_message=None
        )

    async def fail_stream(
        self, stream_id: str, error_message: str
    ) -> StreamMetadata:
        """
        标记流失败

        参数：
          - stream_id: 流 ID
          - error_message: 错误信息

        返回值：更新后的 StreamMetadata
        """
        return await self._finalize_stream(
            stream_id, StreamState.FAILED, error_message=error_message
        )

    async def _finalize_stream(
        self,
        stream_id: str,
        state: StreamState,
        error_message: Optional[str],
    ) -> StreamMetadata:
        """内部：结束流（complete/fail 共享）"""
        async with self._lock:
            now = time.time()
            try:
                with self._get_conn() as conn:
                    conn.execute(
                        """
                        UPDATE streams SET
                            state = ?,
                            completed_at = ?,
                            last_chunk_at = ?,
                            error_message = ?
                        WHERE stream_id = ?
                        """,
                        (state.value, now, now, error_message, stream_id),
                    )
                    conn.commit()

                meta = self._active_streams.get(stream_id)
                if meta is None:
                    meta = await self._load_metadata(stream_id)
                if meta is not None:
                    meta.state = state
                    meta.completed_at = now
                    meta.last_chunk_at = now
                    meta.error_message = error_message
                    if state != StreamState.ACTIVE:
                        self._active_streams.pop(stream_id, None)

                # 通知订阅者流已结束
                if stream_id in self._stream_events:
                    self._stream_events[stream_id].set()
                    # 延迟清理 event 对象（让最后一批订阅者有机会读到）
                    asyncio.create_task(self._cleanup_event(stream_id, delay=5.0))

                logger.info(
                    f"流结束: stream_id={stream_id} state={state.value}"
                )
                return meta
            except Exception as e:
                logger.error(f"结束流失败: {e}", exc_info=True)
                raise

    async def _cleanup_event(self, stream_id: str, delay: float = 5.0) -> None:
        """延迟清理 event 对象"""
        await asyncio.sleep(delay)
        self._stream_events.pop(stream_id, None)

    # ============================================================
    # 断点续传：replay chunks
    # ============================================================

    async def get_chunks(
        self,
        stream_id: str,
        from_seq: int = 0,
        limit: Optional[int] = None,
    ) -> List[StreamChunk]:
        """
        获取流的 chunks（从 from_seq 开始）

        参数：
          - stream_id: 流 ID
          - from_seq: 起始 seq（包含）
          - limit: 最大返回数量（None 表示全部）

        返回值：List[StreamChunk]
        """
        query = """
            SELECT * FROM chunks
            WHERE stream_id = ? AND seq >= ?
            ORDER BY seq ASC
        """
        params: Tuple[Any, ...] = (stream_id, from_seq)
        if limit is not None:
            query += " LIMIT ?"
            params = (stream_id, from_seq, limit)

        try:
            with self._get_conn() as conn:
                rows = conn.execute(query, params).fetchall()
                return [
                    StreamChunk(
                        seq=row["seq"],
                        event_type=row["event_type"],
                        content=row["content"],
                        created_at=row["created_at"],
                    )
                    for row in rows
                ]
        except Exception as e:
            logger.error(f"获取 chunks 失败: {e}", exc_info=True)
            raise

    async def subscribe(
        self,
        stream_id: str,
        client_id: str,
        last_ack_seq: int = -1,
    ) -> Dict[str, Any]:
        """
        客户端订阅流

        参数：
          - stream_id: 流 ID
          - client_id: 客户端唯一 ID
          - last_ack_seq: 客户端已确认的最后 seq

        返回值：{
          "subscription_id": str,
          "replay_chunks": List[StreamChunk],
          "current_state": StreamState,
          "last_seq": int,
        }
        """
        meta = await self.get_stream(stream_id)
        if meta is None:
            raise ValueError(f"流不存在: {stream_id}")

        # 注册 subscription
        subscription_id = str(uuid.uuid4())
        now = time.time()
        async with self._lock:
            with self._get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO subscriptions
                    (subscription_id, stream_id, client_id, last_ack_seq, connected_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (subscription_id, stream_id, client_id, last_ack_seq, now),
                )
                conn.commit()

        # 计算需要 replay 的 chunks
        replay_chunks = await self.get_chunks(stream_id, from_seq=last_ack_seq + 1)

        return {
            "subscription_id": subscription_id,
            "replay_chunks": replay_chunks,
            "current_state": meta.state.value,
            "last_seq": meta.last_seq,
            "total_chunks": meta.total_chunks,
        }

    async def acknowledge(
        self,
        subscription_id: str,
        last_ack_seq: int,
    ) -> None:
        """
        客户端确认已接收 chunks

        参数：
          - subscription_id: 订阅 ID
          - last_ack_seq: 最后确认的 seq
        """
        async with self._lock:
            try:
                with self._get_conn() as conn:
                    conn.execute(
                        """
                        UPDATE subscriptions SET last_ack_seq = ?
                        WHERE subscription_id = ?
                        """,
                        (last_ack_seq, subscription_id),
                    )
                    conn.commit()
            except Exception as e:
                logger.error(f"ack 失败: {e}", exc_info=True)
                raise

    async def unsubscribe(
        self,
        subscription_id: str,
    ) -> None:
        """
        客户端取消订阅

        参数：
          - subscription_id: 订阅 ID
        """
        async with self._lock:
            try:
                with self._get_conn() as conn:
                    conn.execute(
                        """
                        UPDATE subscriptions SET disconnected_at = ?
                        WHERE subscription_id = ?
                        """,
                        (time.time(), subscription_id),
                    )
                    conn.commit()
            except Exception as e:
                logger.error(f"unsubscribe 失败: {e}", exc_info=True)
                raise

    # ============================================================
    # 查询与恢复
    # ============================================================

    async def get_stream(self, stream_id: str) -> Optional[StreamMetadata]:
        """
        获取流元数据

        参数：
          - stream_id: 流 ID

        返回值：StreamMetadata 或 None
        """
        # 优先从内存读取
        meta = self._active_streams.get(stream_id)
        if meta is not None:
            return meta
        # 从 DB 读取
        return await self._load_metadata(stream_id)

    async def _load_metadata(self, stream_id: str) -> Optional[StreamMetadata]:
        """从 DB 加载流元数据"""
        try:
            with self._get_conn() as conn:
                row = conn.execute(
                    "SELECT * FROM streams WHERE stream_id = ?", (stream_id,)
                ).fetchone()
                if row is None:
                    return None
                meta = self._row_to_metadata(row)
                if meta.state == StreamState.ACTIVE:
                    self._active_streams[stream_id] = meta
                return meta
        except Exception as e:
            logger.error(f"加载流元数据失败: {e}", exc_info=True)
            return None

    async def list_resumable_streams(
        self,
        max_idle_seconds: float = 30.0,
        limit: int = 50,
    ) -> List[StreamMetadata]:
        """
        列出可恢复的流（容器重启后场景）

        条件：state=active 且 last_chunk_at < now - max_idle_seconds
              表示服务端在生成但客户端已断连

        参数：
          - max_idle_seconds: 超过该空闲时间认为可恢复
          - limit: 最多返回数量

        返回值：List[StreamMetadata]
        """
        cutoff = time.time() - max_idle_seconds
        try:
            with self._get_conn() as conn:
                rows = conn.execute(
                    """
                    SELECT * FROM streams
                    WHERE state = ? AND last_chunk_at < ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (StreamState.ACTIVE.value, cutoff, limit),
                ).fetchall()
                return [self._row_to_metadata(row) for row in rows]
        except Exception as e:
            logger.error(f"列出可恢复流失败: {e}", exc_info=True)
            return []

    async def list_streams_by_session(
        self,
        session_id: str,
        limit: int = 20,
    ) -> List[StreamMetadata]:
        """
        列出指定会话的所有流

        参数：
          - session_id: 会话 ID
          - limit: 最多返回数量

        返回值：List[StreamMetadata]
        """
        try:
            with self._get_conn() as conn:
                rows = conn.execute(
                    """
                    SELECT * FROM streams
                    WHERE session_id = ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (session_id, limit),
                ).fetchall()
                return [self._row_to_metadata(row) for row in rows]
        except Exception as e:
            logger.error(f"列出会话流失败: {e}", exc_info=True)
            return []

    async def list_active_streams(self, limit: int = 50) -> List[StreamMetadata]:
        """
        列出当前活跃的流

        参数：
          - limit: 最多返回数量

        返回值：List[StreamMetadata]
        """
        try:
            with self._get_conn() as conn:
                rows = conn.execute(
                    """
                    SELECT * FROM streams
                    WHERE state = ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (StreamState.ACTIVE.value, limit),
                ).fetchall()
                return [self._row_to_metadata(row) for row in rows]
        except Exception as e:
            logger.error(f"列出活跃流失败: {e}", exc_info=True)
            return []

    # ============================================================
    # 清理
    # ============================================================

    async def cleanup_expired_streams(
        self,
        max_age_seconds: float = 3600.0,
    ) -> int:
        """
        清理过期的 completed/failed 流

        参数：
          - max_age_seconds: completed/failed 后超过该秒数才删除

        返回值：删除的流数量
        """
        cutoff = time.time() - max_age_seconds
        try:
            with self._get_conn() as conn:
                # 先删除 chunks（外键级联）
                cursor = conn.execute(
                    """
                    DELETE FROM streams
                    WHERE state IN (?, ?)
                      AND completed_at IS NOT NULL
                      AND completed_at < ?
                    """,
                    (
                        StreamState.COMPLETED.value,
                        StreamState.FAILED.value,
                        cutoff,
                    ),
                )
                deleted = cursor.rowcount
                conn.commit()
                logger.info(f"清理过期流: {deleted} 个")
                return deleted
        except Exception as e:
            logger.error(f"清理过期流失败: {e}", exc_info=True)
            return 0

    # ============================================================
    # 统计
    # ============================================================

    async def get_stats(self) -> StreamStats:
        """
        获取流统计信息

        返回值：StreamStats
        """
        try:
            with self._get_conn() as conn:
                stats = StreamStats()
                # 各状态数量
                rows = conn.execute(
                    """
                    SELECT state, COUNT(*) as cnt, SUM(total_chunks) as chunks, SUM(total_bytes) as bytes
                    FROM streams
                    GROUP BY state
                    """
                ).fetchall()
                for row in rows:
                    count = row["cnt"]
                    chunks = row["chunks"] or 0
                    bytes_ = row["bytes"] or 0
                    stats.total_streams += count
                    stats.total_chunks += chunks
                    stats.total_bytes += bytes_
                    if row["state"] == StreamState.ACTIVE.value:
                        stats.active_streams = count
                    elif row["state"] == StreamState.COMPLETED.value:
                        stats.completed_streams = count
                    elif row["state"] == StreamState.FAILED.value:
                        stats.failed_streams = count
                    elif row["state"] == StreamState.EXPIRED.value:
                        stats.expired_streams = count

                # 可恢复流数量
                cutoff = time.time() - 30.0
                row = conn.execute(
                    """
                    SELECT COUNT(*) as cnt FROM streams
                    WHERE state = ? AND last_chunk_at < ?
                    """,
                    (StreamState.ACTIVE.value, cutoff),
                ).fetchone()
                stats.resumable_streams = row["cnt"] if row else 0

                return stats
        except Exception as e:
            logger.error(f"获取流统计失败: {e}", exc_info=True)
            return StreamStats()

    async def get_config(self) -> Dict[str, Any]:
        """获取流式缓冲区配置"""
        return {
            "db_path": self._db_path,
            "active_streams_in_memory": len(self._active_streams),
            "stream_events_count": len(self._stream_events),
            "schema_version": "1.0.0",
        }


# ============================================================
# 全局单例
# ============================================================

_buffer: Optional[StreamingBuffer] = None
_buffer_lock = asyncio.Lock()


async def get_streaming_buffer() -> StreamingBuffer:
    """
    获取全局流式缓冲区（异步单例）
    """
    global _buffer
    async with _buffer_lock:
        if _buffer is None:
            _buffer = StreamingBuffer()
        return _buffer


def reset_streaming_buffer() -> None:
    """重置全局流式缓冲区（测试用）"""
    global _buffer
    _buffer = None


# ============================================================
# 流式上下文管理器（用于流式 API 自动注册/完成）
# ============================================================


@asynccontextmanager
async def stream_context(
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    model: str = "claude-sonnet-4",
    stream_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> AsyncIterator[Tuple[str, "StreamingBuffer"]]:
    """
    异步上下文管理器：自动注册流 + 异常时标记失败

    用法：
        async with stream_context(session_id="abc") as (stream_id, buffer):
            await buffer.append_chunk(stream_id, "text", "hello")
            # 自动标记为 completed
        # 若发生异常：自动标记为 failed
    """
    buffer = await get_streaming_buffer()
    meta = await buffer.register_stream(
        session_id=session_id,
        user_id=user_id,
        model=model,
        stream_id=stream_id,
        extra=extra,
    )
    try:
        yield meta.stream_id, buffer
        await buffer.complete_stream(meta.stream_id)
    except Exception as e:
        try:
            await buffer.fail_stream(meta.stream_id, str(e))
        except Exception:
            pass
        raise
