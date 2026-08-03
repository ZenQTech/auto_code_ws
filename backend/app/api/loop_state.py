"""
# ============================================================
# LoopState API 端点 (v1.0.0)
# Cycle 58 G58-03
# ============================================================
# 核心作用：暴露 LoopStateMachine 状态机为 REST + SSE API
# 运行流程：
#   1. GET /api/loop-state/machine - 获取状态机快照
#   2. POST /api/loop-state/transition - 触发状态迁移
#   3. POST /api/loop-state/progress - 更新进度（不触发迁移）
#   4. GET /api/loop-state/machine/events - SSE 订阅
#   5. GET /api/loop-state/stages - 获取合法迁移图
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..services.loop_state_machine import (
    ALLOWED_TRANSITIONS,
    LoopStage,
    LoopStateMachine,
    LoopStateSnapshot,
    get_registry,
    stream_machine_events,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/loop-state", tags=["loop-state"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class TransitionRequest(BaseModel):
    """状态迁移请求"""
    session_id: Optional[str] = Field(default=None, max_length=128, description="session_id（不填则创建新）")
    to_stage: str = Field(..., description="目标阶段")
    progress: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="进度")
    eta_seconds: Optional[float] = Field(default=None, ge=0.0, description="预计剩余秒数")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="附加元数据")
    force: bool = Field(default=False, description="是否强制（跳过校验）")
    
    @field_validator("to_stage")
    @classmethod
    def validate_to_stage(cls, v):
        valid_stages = {s.value for s in LoopStage}
        if v not in valid_stages:
            raise ValueError(f"to_stage 必须是以下之一: {sorted(valid_stages)}")
        return v


class ProgressRequest(BaseModel):
    """进度更新请求"""
    session_id: str = Field(..., min_length=1, max_length=128)
    progress: float = Field(..., ge=0.0, le=1.0)
    eta_seconds: Optional[float] = Field(default=None, ge=0.0)


class SnapshotResponse(BaseModel):
    """状态快照响应"""
    session_id: str
    stage: str
    progress: float
    eta_seconds: float
    sub_state: Dict[str, Any]


class TransitionResponse(BaseModel):
    """迁移响应"""
    success: bool
    from_state: Optional[str]
    to_state: str
    session_id: str
    error: Optional[str] = None


# ============================================================
# 端点定义
# ============================================================


@router.get("/machine", response_model=SnapshotResponse)
async def get_machine(session_id: Optional[str] = None):
    """
    获取当前状态机快照（如果不存在则创建）
    
    输入参数：session_id (Query)
    输出结果：SnapshotResponse
    """
    machine = await get_registry().get_or_create(session_id)
    snapshot = machine.snapshot()
    return SnapshotResponse(
        session_id=snapshot.session_id,
        stage=snapshot.stage.value,
        progress=snapshot.progress,
        eta_seconds=snapshot.eta_seconds,
        sub_state=snapshot.sub_state,
    )


@router.post("/transition", response_model=TransitionResponse)
async def transition(req: TransitionRequest):
    """
    触发状态迁移
    
    输入参数：TransitionRequest
    输出结果：TransitionResponse
    """
    machine = await get_registry().get_or_create(req.session_id)
    from_stage = machine.stage
    to_stage = LoopStage(req.to_stage)
    
    success = await machine.transition(
        to_stage=to_stage,
        progress=req.progress,
        eta_seconds=req.eta_seconds,
        metadata=req.metadata,
        force=req.force,
    )
    
    return TransitionResponse(
        success=success,
        from_state=from_stage.value,
        to_state=to_stage.value,
        session_id=machine.session_id,
        error=None if success else f"不允许的迁移: {from_stage.value} -> {to_stage.value}",
    )


@router.post("/progress", response_model=SnapshotResponse)
async def update_progress(req: ProgressRequest):
    """
    仅更新进度（不触发状态变更）
    
    输入参数：ProgressRequest
    输出结果：SnapshotResponse
    """
    machine = await get_registry().get_or_create(req.session_id)
    machine.set_progress(req.progress, req.eta_seconds)
    # 手动广播进度变化
    if machine._subscribers:
        await machine._broadcast(
            type("T", (), {
                "from_state": machine.stage,
                "to_state": machine.stage,
                "at": time.time(),
                "metadata": {"progress": req.progress},
            })()
        )
    snapshot = machine.snapshot()
    return SnapshotResponse(
        session_id=snapshot.session_id,
        stage=snapshot.stage.value,
        progress=snapshot.progress,
        eta_seconds=snapshot.eta_seconds,
        sub_state=snapshot.sub_state,
    )


@router.get("/machine/events")
async def machine_events(session_id: Optional[str] = None):
    """
    SSE 订阅状态机变更
    
    输入参数：session_id (Query)
    输出结果：SSE 事件流
    """
    async def event_generator():
        try:
            async for event in stream_machine_events(session_id):
                yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            logger.info(f"machine_events: client disconnected session={session_id}")
            raise
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/stages")
async def get_stages():
    """
    获取所有合法阶段 + 状态迁移图
    
    输入参数：无
    输出结果：JSON
    """
    transitions = {
        stage.value: [s.value for s in targets]
        for stage, targets in ALLOWED_TRANSITIONS.items()
    }
    return {
        "stages": [s.value for s in LoopStage],
        "transitions": transitions,
    }


@router.get("/sessions")
async def list_sessions():
    """
    列出所有活跃 session
    
    输入参数：无
    输出结果：JSON
    """
    sessions = get_registry().list_sessions()
    return {"sessions": sessions, "count": len(sessions)}
