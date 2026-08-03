"""
# ============================================================
# AutoFollow API 端点 (v1.0.0)
# Cycle 58 G58-04
# ============================================================
# 核心作用：暴露 AutoFollowService 为 REST + SSE API
# 运行流程：
#   1. GET  /api/auto-follow/config  获取当前 session 配置
#   2. POST /api/auto-follow/config  更新 session 配置
#   3. GET  /api/auto-follow/mapping  获取默认 stage->panel 映射
#   4. GET  /api/auto-follow/history  获取最近事件
#   5. GET  /api/auto-follow/events   SSE 订阅
#   6. POST /api/auto-follow/simulate  模拟 stage 变化（用于测试）
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..services.auto_follow import (
    DEFAULT_STAGE_TO_PANEL,
    PanelKey,
    STAGE_TO_REASON,
    get_service,
    stream_auto_follow_events,
)
from ..services.loop_state_machine import LoopStage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auto-follow", tags=["auto-follow"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class AutoFollowConfigUpdate(BaseModel):
    """Auto-Follow 配置更新请求"""
    enabled: Optional[bool] = Field(default=None, description="是否启用")
    mode: Optional[str] = Field(default=None, description="工作模式 off/suggest/force")
    custom_mapping: Optional[Dict[str, str]] = Field(default=None, description="自定义 stage->panel 映射")
    blocked_panels: Optional[List[str]] = Field(default=None, description="黑名单 panel")
    allowed_panels: Optional[List[str]] = Field(default=None, description="白名单 panel（None 表示不限制）")

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v):
        if v is None:
            return v
        valid = {"off", "suggest", "force"}
        if v not in valid:
            raise ValueError(f"mode 必须是以下之一: {sorted(valid)}")
        return v

    @field_validator("custom_mapping")
    @classmethod
    def validate_custom_mapping(cls, v):
        if v is None:
            return v
        valid_stages = {s.value for s in LoopStage}
        valid_panels = {p.value for p in PanelKey}
        for stage, panel in v.items():
            if stage not in valid_stages:
                raise ValueError(f"未知 stage: {stage}")
            if panel not in valid_panels:
                raise ValueError(f"未知 panel: {panel}")
        return v

    @field_validator("blocked_panels", "allowed_panels")
    @classmethod
    def validate_panels(cls, v):
        if v is None:
            return v
        valid_panels = {p.value for p in PanelKey}
        for p in v:
            if p not in valid_panels:
                raise ValueError(f"未知 panel: {p}")
        return v


class AutoFollowConfigResponse(BaseModel):
    """配置响应"""
    session_id: str
    enabled: bool
    mode: str
    custom_mapping: Dict[str, str]
    blocked_panels: List[str]
    allowed_panels: Optional[List[str]]


class SimulateRequest(BaseModel):
    """模拟请求"""
    to_stage: str = Field(..., description="目标阶段")
    from_stage: Optional[str] = Field(default=None, description="起始阶段（默认当前 stage）")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="附加元数据")

    @field_validator("to_stage", "from_stage")
    @classmethod
    def validate_stage(cls, v):
        if v is None:
            return v
        valid = {s.value for s in LoopStage}
        if v not in valid:
            raise ValueError(f"必须是合法 stage: {sorted(valid)}")
        return v


class SimulateResponse(BaseModel):
    """模拟响应"""
    success: bool
    panel: Optional[str]
    reason: Optional[str]
    skipped_reason: Optional[str] = None


# ============================================================
# 端点
# ============================================================


@router.get("/config", response_model=AutoFollowConfigResponse)
async def get_config(session_id: str = "default"):
    """
    获取当前 session 的 Auto-Follow 配置

    输入参数：session_id (Query)
    输出结果：AutoFollowConfigResponse
    """
    cfg = await get_service().get_config(session_id)
    return AutoFollowConfigResponse(
        session_id=session_id,
        enabled=cfg.enabled,
        mode=cfg.mode.value,
        custom_mapping=dict(cfg.custom_mapping),
        blocked_panels=list(cfg.blocked_panels),
        allowed_panels=list(cfg.allowed_panels) if cfg.allowed_panels is not None else None,
    )


@router.post("/config", response_model=AutoFollowConfigResponse)
async def update_config(req: AutoFollowConfigUpdate, session_id: str = "default"):
    """
    更新当前 session 的 Auto-Follow 配置

    输入参数：AutoFollowConfigUpdate, session_id (Query)
    输出结果：AutoFollowConfigResponse
    """
    try:
        cfg = await get_service().update_config(
            session_id=session_id,
            enabled=req.enabled,
            mode=req.mode,
            custom_mapping=req.custom_mapping,
            blocked_panels=req.blocked_panels,
            allowed_panels=req.allowed_panels,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AutoFollowConfigResponse(
        session_id=session_id,
        enabled=cfg.enabled,
        mode=cfg.mode.value,
        custom_mapping=dict(cfg.custom_mapping),
        blocked_panels=list(cfg.blocked_panels),
        allowed_panels=list(cfg.allowed_panels) if cfg.allowed_panels is not None else None,
    )


@router.get("/mapping")
async def get_mapping():
    """
    获取默认 stage->panel 映射表

    输入参数：无
    输出结果：JSON
    """
    mapping = {stage.value: panel.value for stage, panel in DEFAULT_STAGE_TO_PANEL.items()}
    reasons = {stage.value: reason for stage, reason in STAGE_TO_REASON.items()}
    return {
        "mapping": mapping,
        "reasons": reasons,
        "valid_panels": [p.value for p in PanelKey],
        "valid_stages": [s.value for s in LoopStage],
    }


@router.get("/history")
async def get_history(session_id: str = "default", limit: int = 20):
    """
    获取最近事件历史

    输入参数：session_id, limit (1-50)
    输出结果：JSON
    """
    limit = max(1, min(50, limit))
    history = get_service().get_history(session_id)
    recent = history[-limit:]
    return {
        "session_id": session_id,
        "count": len(recent),
        "events": [
            {
                "target_panel": e.target_panel.value,
                "reason": e.reason,
                "source_stage": e.source_stage,
                "mode": e.mode,
                "at": e.at,
                "metadata": e.metadata,
            }
            for e in recent
        ],
    }


@router.get("/events")
async def events(session_id: str = "default"):
    """
    SSE 订阅 Auto-Follow 事件

    输入参数：session_id (Query)
    输出结果：SSE 事件流
    """
    async def event_generator():
        try:
            async for event in stream_auto_follow_events(session_id):
                yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            logger.info(f"auto-follow events: client disconnected session={session_id}")
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


@router.post("/simulate", response_model=SimulateResponse)
async def simulate(req: SimulateRequest, session_id: str = "default"):
    """
    模拟 stage 变化以测试 Auto-Follow 联动（不修改真实状态机）

    输入参数：SimulateRequest, session_id (Query)
    输出结果：SimulateResponse
    """
    service = get_service()
    cfg = await service.get_config(session_id)

    if not cfg.enabled:
        return SimulateResponse(
            success=False,
            panel=None,
            reason=None,
            skipped_reason="Auto-Follow 已关闭",
        )

    to_stage = LoopStage(req.to_stage)
    from_stage = LoopStage(req.from_stage) if req.from_stage else LoopStage.IDLE
    target = None
    # 用 service 内部的 resolve 逻辑：通过 handle_stage_change 触发
    from ..services.auto_follow import resolve_panel
    target = resolve_panel(to_stage, cfg)
    if target is None:
        return SimulateResponse(
            success=False,
            panel=None,
            reason=None,
            skipped_reason="未匹配 panel（被 blocked/allowed 限制或无默认映射）",
        )

    # 真实广播事件
    from ..services.auto_follow import AutoFollowEvent
    event = AutoFollowEvent(
        session_id=session_id,
        target_panel=target,
        reason=STAGE_TO_REASON.get(to_stage, to_stage.value),
        source_stage=to_stage.value,
        mode=cfg.mode.value,
        at=time.time(),
        metadata=dict(req.metadata or {}),
    )
    # 记录历史（绕过防刷屏，因为是 simulate）
    service._history.setdefault(session_id, __import__("collections").deque(maxlen=50))
    service._history[session_id].append(event)
    await service._broadcast(session_id, event)

    return SimulateResponse(
        success=True,
        panel=target.value,
        reason=event.reason,
    )
