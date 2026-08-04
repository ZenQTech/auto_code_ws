"""
# ============================================================
# LLM 流式输出 API (v1.0.0)
# Cycle 62 G62-03
# ====================================
# 核心作用：暴露 LLMStreamManager 为 REST API
# 运行流程：
#   1. POST /api/llm-stream/create        创建流式会话
#   2. POST /api/llm-stream/{id}/start    启动流式会话
#   3. GET  /api/llm-stream/{id}          查询会话状态
#   4. POST /api/llm-stream/{id}/cancel   取消流式会话
#   5. GET  /api/llm-stream/list          列出所有会话
#   6. GET  /api/llm-stream/stats         管理器统计
# WebSocket 端点：WS /api/llm-stream/ws/{session_id}
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-03 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from ..services.llm_stream import (
    LLMStreamSession,
    get_stream_manager,
    mock_llm_caller,
    reset_stream_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm-stream", tags=["llm-stream"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class CreateStreamRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=200000)
    model: str = Field(default="default", max_length=128)
    system_prompt: str = Field(default="", max_length=20000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StartStreamRequest(BaseModel):
    use_mock: bool = Field(default=True, description="是否使用 mock LLM")


# ============================================================
# API 端点
# ============================================================


@router.post("/create")
async def create_stream(req: CreateStreamRequest) -> Dict[str, Any]:
    """创建流式会话"""
    mgr = get_stream_manager()
    session = await mgr.create(
        prompt=req.prompt,
        model=req.model,
        system_prompt=req.system_prompt,
        metadata=req.metadata,
    )
    return {
        "success": True,
        "session": session.to_dict(),
    }


@router.post("/{session_id}/start")
async def start_stream(
    session_id: str, req: Optional[StartStreamRequest] = None,
) -> Dict[str, Any]:
    """启动流式会话"""
    mgr = get_stream_manager()
    session = mgr.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    use_mock = (req.use_mock if req else True)
    caller = mock_llm_caller if use_mock else mock_llm_caller
    # 实际项目中应注入真实的 LLM caller（依赖注入）

    try:
        session = await mgr.start(session_id, caller)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"start_stream 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {
        "success": True,
        "session": session.to_dict(),
    }


@router.get("/{session_id}")
async def get_session(session_id: str) -> Dict[str, Any]:
    """查询会话状态"""
    mgr = get_stream_manager()
    session = mgr.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    return {
        "success": True,
        "session": session.to_dict(),
    }


@router.post("/{session_id}/cancel")
async def cancel_stream(session_id: str) -> Dict[str, Any]:
    """取消流式会话"""
    mgr = get_stream_manager()
    cancelled = await mgr.cancel(session_id)
    return {
        "success": True,
        "cancelled": cancelled,
        "session_id": session_id,
    }


@router.get("/list")
async def list_sessions() -> Dict[str, Any]:
    """列出所有会话"""
    mgr = get_stream_manager()
    return {
        "success": True,
        "sessions": mgr.list_sessions(),
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """获取管理器统计"""
    mgr = get_stream_manager()
    return {
        "success": True,
        "stats": mgr.get_stats(),
    }


@router.post("/reset")
async def reset() -> Dict[str, Any]:
    """重置全局单例（主要用于测试）"""
    reset_stream_manager()
    return {"success": True}


# ============================================================
# WebSocket 端点
# ============================================================


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    LLM 流式 WebSocket 端点

    客户端使用：
    1. 连接 /api/llm-stream/ws/{session_id}
    2. 服务端自动将该连接加入 session_id 的广播组
    3. 接收流式事件：start / delta / done / error / cancel
    4. 可发送 ping 维持连接
    """
    from app.ws import manager as ws_manager

    await ws_manager.connect(websocket, session_id=session_id)
    try:
        while True:
            data = await websocket.receive_text()
            # 处理客户端消息
            import json
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")
                if msg_type == "ping":
                    await websocket.send_text('{"type": "pong"}')
                elif msg_type == "get_status":
                    mgr = get_stream_manager()
                    session = mgr.get(session_id)
                    if session:
                        await websocket.send_text(
                            json.dumps(
                                {"type": "status", "session": session.to_dict()},
                                ensure_ascii=False,
                            )
                        )
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"WebSocket 错误: {e}")
        ws_manager.disconnect(websocket)
