"""
# ============================================================
# 流式恢复网关 API 端点 (v1.0.0) - Cycle 6 P0-7-B
# ============================================================
# 核心作用：提供流式恢复网关的查询/管理接口
#           客户端断连后可重新订阅从 last_ack_seq+1 续传
# 运行流程：
#   1. POST /api/stream/register - 注册新流
#   2. POST /api/stream/{id}/chunk - 追加 chunk（服务端内部调用）
#   3. POST /api/stream/{id}/complete - 标记完成
#   4. POST /api/stream/{id}/fail - 标记失败
#   5. POST /api/stream/{id}/subscribe - 客户端订阅（断点续传）
#   6. POST /api/stream/subscription/{id}/ack - 客户端 ACK
#   7. GET  /api/stream/{id} - 查询流元数据
#   8. GET  /api/stream/{id}/chunks - 获取 chunks
#   9. GET  /api/stream/active - 列出活跃流
#  10. GET  /api/stream/resumable - 列出可恢复流
#  11. GET  /api/stream/session/{session_id} - 列出会话流
#  12. POST /api/stream/cleanup - 清理过期流
#  13. GET  /api/stream/stats - 获取统计
#  14. GET  /api/stream/config - 获取配置
# 输入参数：见各端点
# 输出结果：JSON 响应
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-B 新建
#   - 2026-07-27 | v1.0.1 | 修复 /stats /config /resumable /active /cleanup
#     路由与 /{stream_id} 冲突：FastAPI 按注册顺序匹配，必须把固定路径
#     路由（active/resumable/cleanup/stats/config）注册在
#     /{stream_id} 之前
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.streaming_buffer import (
    StreamingBuffer,
    StreamMetadata,
    StreamState,
    get_streaming_buffer,
    reset_streaming_buffer,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stream", tags=["streaming-buffer"])


# ============================================================
# Request/Response Models
# ============================================================


class RegisterStreamRequest(BaseModel):
    """注册新流请求"""
    session_id: Optional[str] = Field(default=None, description="关联会话 ID")
    user_id: Optional[str] = Field(default=None, description="用户 ID")
    model: str = Field(default="claude-sonnet-4", description="LLM 模型")
    stream_id: Optional[str] = Field(default=None, description="自定义流 ID（默认生成 UUID）")
    extra: Optional[Dict[str, Any]] = Field(default=None, description="额外元数据")


class RegisterStreamResponse(BaseModel):
    """注册流响应"""
    stream_id: str
    session_id: Optional[str]
    state: str
    started_at: float


class AppendChunkRequest(BaseModel):
    """追加 chunk 请求"""
    event_type: str = Field(..., description="事件类型 (thinking/text/done/error/...)")
    content: str = Field(..., description="事件内容")
    seq: Optional[int] = Field(default=None, description="顺序索引（默认自动递增）")


class AppendChunkResponse(BaseModel):
    """追加 chunk 响应"""
    seq: int
    event_type: str
    total_chunks: int
    last_seq: int


class SubscribeRequest(BaseModel):
    """客户端订阅请求"""
    client_id: str = Field(..., description="客户端唯一 ID")
    last_ack_seq: int = Field(default=-1, description="客户端已确认的最后 seq")


class SubscribeResponse(BaseModel):
    """客户端订阅响应"""
    subscription_id: str
    stream_id: str
    current_state: str
    last_seq: int
    total_chunks: int
    replay_count: int
    replay_chunks: List[Dict[str, Any]]


class AckRequest(BaseModel):
    """客户端 ACK 请求"""
    last_ack_seq: int = Field(..., description="最后确认的 seq")


class FailStreamRequest(BaseModel):
    """标记流失败请求"""
    error_message: str = Field(..., description="错误信息")


class CleanupRequest(BaseModel):
    """清理过期流请求"""
    max_age_seconds: float = Field(default=3600.0, description="超过该秒数的 completed/failed 流将被删除")


# ============================================================
# 固定路径端点（必须注册在 /{stream_id} 之前，避免被吞掉）
# ============================================================


@router.post("/register")
async def register_stream(request: RegisterStreamRequest) -> Dict[str, Any]:
    """
    注册新的 SSE 流

    服务端在开始流式响应前调用此端点获取 stream_id，
    之后每个 chunk 都通过 /stream/{id}/chunk 追加。
    """
    try:
        buffer = await get_streaming_buffer()
        meta = await buffer.register_stream(
            session_id=request.session_id,
            user_id=request.user_id,
            model=request.model,
            stream_id=request.stream_id,
            extra=request.extra,
        )
        return {
            "success": True,
            "stream_id": meta.stream_id,
            "session_id": meta.session_id,
            "state": meta.state.value,
            "started_at": meta.started_at,
            "message": "流注册成功",
        }
    except Exception as e:
        logger.error(f"注册流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active")
async def list_active_streams(
    limit: int = Query(default=50, description="最多返回数量"),
) -> Dict[str, Any]:
    """列出当前活跃的流"""
    try:
        buffer = await get_streaming_buffer()
        streams = await buffer.list_active_streams(limit=limit)
        return {
            "success": True,
            "count": len(streams),
            "streams": [s.to_dict() for s in streams],
        }
    except Exception as e:
        logger.error(f"列出活跃流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/resumable")
async def list_resumable_streams(
    max_idle_seconds: float = Query(
        default=30.0, description="超过该空闲时间认为可恢复"
    ),
    limit: int = Query(default=50, description="最多返回数量"),
) -> Dict[str, Any]:
    """
    列出可恢复的流（容器重启后场景）

    state=active 且 last_chunk_at 超过 max_idle_seconds 未更新的流
    """
    try:
        buffer = await get_streaming_buffer()
        streams = await buffer.list_resumable_streams(
            max_idle_seconds=max_idle_seconds, limit=limit
        )
        return {
            "success": True,
            "count": len(streams),
            "max_idle_seconds": max_idle_seconds,
            "streams": [s.to_dict() for s in streams],
        }
    except Exception as e:
        logger.error(f"列出可恢复流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}")
async def list_session_streams(
    session_id: str,
    limit: int = Query(default=20, description="最多返回数量"),
) -> Dict[str, Any]:
    """列出指定会话的所有流"""
    try:
        buffer = await get_streaming_buffer()
        streams = await buffer.list_streams_by_session(session_id, limit=limit)
        return {
            "success": True,
            "session_id": session_id,
            "count": len(streams),
            "streams": [s.to_dict() for s in streams],
        }
    except Exception as e:
        logger.error(f"列出会话流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """获取流统计信息"""
    try:
        buffer = await get_streaming_buffer()
        stats = await buffer.get_stats()
        return {"success": True, "stats": stats.to_dict()}
    except Exception as e:
        logger.error(f"获取统计失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_config() -> Dict[str, Any]:
    """获取流式缓冲区配置"""
    try:
        buffer = await get_streaming_buffer()
        config = await buffer.get_config()
        return {"success": True, "config": config}
    except Exception as e:
        logger.error(f"获取配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup")
async def cleanup_expired_streams(request: CleanupRequest) -> Dict[str, Any]:
    """清理过期的 completed/failed 流"""
    try:
        buffer = await get_streaming_buffer()
        deleted = await buffer.cleanup_expired_streams(
            max_age_seconds=request.max_age_seconds
        )
        return {
            "success": True,
            "deleted_count": deleted,
            "max_age_seconds": request.max_age_seconds,
        }
    except Exception as e:
        logger.error(f"清理过期流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Subscription 路径（必须在 /{stream_id} 之前避免被吞）
# ============================================================


@router.post("/subscription/{subscription_id}/ack")
async def acknowledge_subscription(
    subscription_id: str, request: AckRequest
) -> Dict[str, Any]:
    """
    客户端 ACK 已接收的 chunks

    用于增量续传：客户端每收到一批 chunks 就 ACK 一次
    """
    try:
        buffer = await get_streaming_buffer()
        await buffer.acknowledge(subscription_id, request.last_ack_seq)
        return {
            "success": True,
            "subscription_id": subscription_id,
            "last_ack_seq": request.last_ack_seq,
        }
    except Exception as e:
        logger.error(f"ACK 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/subscription/{subscription_id}/unsubscribe")
async def unsubscribe(subscription_id: str) -> Dict[str, Any]:
    """客户端取消订阅"""
    try:
        buffer = await get_streaming_buffer()
        await buffer.unsubscribe(subscription_id)
        return {
            "success": True,
            "subscription_id": subscription_id,
            "message": "已取消订阅",
        }
    except Exception as e:
        logger.error(f"取消订阅失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 参数化路径（必须放最后）
# ============================================================


@router.get("/{stream_id}")
async def get_stream(stream_id: str) -> Dict[str, Any]:
    """获取流元数据"""
    try:
        buffer = await get_streaming_buffer()
        meta = await buffer.get_stream(stream_id)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"流不存在: {stream_id}")
        return {"success": True, "stream": meta.to_dict()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{stream_id}/chunks")
async def get_chunks(
    stream_id: str,
    from_seq: int = Query(default=0, description="起始 seq（包含）"),
    limit: Optional[int] = Query(default=None, description="最大返回数量"),
) -> Dict[str, Any]:
    """获取流的 chunks"""
    try:
        buffer = await get_streaming_buffer()
        meta = await buffer.get_stream(stream_id)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"流不存在: {stream_id}")
        chunks = await buffer.get_chunks(stream_id, from_seq=from_seq, limit=limit)
        return {
            "success": True,
            "stream_id": stream_id,
            "from_seq": from_seq,
            "count": len(chunks),
            "chunks": [chunk.to_dict() for chunk in chunks],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取 chunks 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{stream_id}/chunk")
async def append_chunk(stream_id: str, request: AppendChunkRequest) -> Dict[str, Any]:
    """
    追加 chunk 到指定流

    通常由 hermes_service 在流式响应过程中调用
    """
    try:
        buffer = await get_streaming_buffer()
        chunk = await buffer.append_chunk(
            stream_id=stream_id,
            event_type=request.event_type,
            content=request.content,
            seq=request.seq,
        )
        meta = await buffer.get_stream(stream_id)
        return {
            "success": True,
            "seq": chunk.seq,
            "event_type": chunk.event_type,
            "total_chunks": meta.total_chunks if meta else 0,
            "last_seq": meta.last_seq if meta else chunk.seq,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"追加 chunk 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{stream_id}/complete")
async def complete_stream(stream_id: str) -> Dict[str, Any]:
    """标记流正常完成"""
    try:
        buffer = await get_streaming_buffer()
        meta = await buffer.complete_stream(stream_id)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"流不存在: {stream_id}")
        return {
            "success": True,
            "stream_id": meta.stream_id,
            "state": meta.state.value,
            "total_chunks": meta.total_chunks,
            "completed_at": meta.completed_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"完成流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{stream_id}/fail")
async def fail_stream(stream_id: str, request: FailStreamRequest) -> Dict[str, Any]:
    """标记流失败"""
    try:
        buffer = await get_streaming_buffer()
        meta = await buffer.fail_stream(stream_id, request.error_message)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"流不存在: {stream_id}")
        return {
            "success": True,
            "stream_id": meta.stream_id,
            "state": meta.state.value,
            "error_message": meta.error_message,
            "completed_at": meta.completed_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"标记流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{stream_id}/subscribe")
async def subscribe_stream(stream_id: str, request: SubscribeRequest) -> Dict[str, Any]:
    """
    客户端订阅流（断点续传入口）

    - 首次订阅：last_ack_seq=-1，返回所有 chunks
    - 断线重连：last_ack_seq=N，返回 seq > N 的 chunks
    - 流已结束：返回剩余 chunks + current_state=completed
    """
    try:
        buffer = await get_streaming_buffer()
        result = await buffer.subscribe(
            stream_id=stream_id,
            client_id=request.client_id,
            last_ack_seq=request.last_ack_seq,
        )
        return {
            "success": True,
            "subscription_id": result["subscription_id"],
            "stream_id": stream_id,
            "current_state": result["current_state"],
            "last_seq": result["last_seq"],
            "total_chunks": result["total_chunks"],
            "replay_count": len(result["replay_chunks"]),
            "replay_chunks": [chunk.to_dict() for chunk in result["replay_chunks"]],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"订阅流失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Hermes 流式对话 + 断点续传集成端点
# ============================================================


class HermesChatStreamRequest(BaseModel):
    """Hermes 流式对话 + 断点续传请求"""
    message: str = Field(..., min_length=1, description="用户消息文本")
    session_id: Optional[str] = Field(default=None, description="可选会话 ID（用于持久化）")
    session_mode: Optional[str] = Field(default=None, description="可选会话模式: 'chat' | 'coding'")
    user_id: Optional[str] = Field(default=None, description="用户 ID")
    enable_buffer: bool = Field(
        default=True,
        description="是否启用流式缓冲（容器重启后可恢复）",
    )


@router.post("/hermes/chat")
async def hermes_chat_with_buffer(
    request_obj: Request, body: HermesChatStreamRequest
) -> Dict[str, Any]:
    """
    Hermes 流式对话 + 断点续传（SSE）

    与 /api/hermes/chat/stream 类似，但额外将每个 chunk 持久化到
    StreamingBuffer（SQLite），客户端断连后可通过
    /api/stream/{stream_id}/subscribe 重新订阅并 replay。

    流程：
      1. 注册流（state=active）→ 返回 stream_id
      2. 启动 Hermes 流式生成器
      3. 每个 yield 的 SSE 事件解析为 (event_type, content) 追加到 buffer
      4. done / error 时自动 complete_stream / fail_stream
    """
    import json
    import logging as _logging

    _logger = _logging.getLogger(__name__)

    hermes_executor = request_obj.app.state.hermes_executor
    hermes = request_obj.app.state.hermes_service

    # 注册流
    buffer = await get_streaming_buffer()
    meta = await buffer.register_stream(
        session_id=body.session_id,
        user_id=body.user_id,
        model="claude-sonnet-4",
        extra={"source": "hermes_chat", "session_mode": body.session_mode},
    )
    stream_id = meta.stream_id

    async def buffered_stream():
        """
        包装 Hermes 流式生成器：将每个 chunk 持久化到 buffer 后再 yield
        """
        seq = -1
        try:
            # 第一帧：告知前端 stream_id（用于后续断点续传）
            yield f"data: {json.dumps({'type': 'stream_meta', 'stream_id': stream_id, 'resumable': True}, ensure_ascii=False)}\n\n"

            async for sse_event in hermes.chat_with_hermes_streaming(
                body.message,
                hermes_executor,
                session_id=body.session_id,
                session_mode=body.session_mode,
            ):
                # 解析 SSE 事件: "data: {json}\n\n"
                parsed_event_type = None
                parsed_content = None
                if sse_event.startswith("data: "):
                    try:
                        data_str = sse_event[6:].strip()
                        if data_str.endswith("\n\n"):
                            data_str = data_str[:-2]
                        ev = json.loads(data_str)
                        parsed_event_type = ev.get("type")
                        parsed_content = ev.get("content")
                    except (json.JSONDecodeError, KeyError):
                        # 透传未知事件，不持久化
                        yield sse_event
                        continue

                # 持久化到 buffer
                if parsed_event_type and body.enable_buffer:
                    try:
                        chunk = await buffer.append_chunk(
                            stream_id=stream_id,
                            event_type=parsed_event_type,
                            content=parsed_content or "",
                        )
                        seq = chunk.seq
                    except Exception as persist_err:
                        _logger.warning(f"持久化 chunk 失败: {persist_err}")

                # 标记流状态
                if parsed_event_type == "done":
                    try:
                        await buffer.complete_stream(stream_id)
                    except Exception:
                        pass
                elif parsed_event_type == "error":
                    try:
                        await buffer.fail_stream(stream_id, str(parsed_content or ""))
                    except Exception:
                        pass

                yield sse_event
        except Exception as e:
            _logger.error(f"buffered_stream 异常: {e}", exc_info=True)
            try:
                await buffer.fail_stream(stream_id, str(e))
            except Exception:
                pass
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        buffered_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Stream-Id": stream_id,
        },
    )
