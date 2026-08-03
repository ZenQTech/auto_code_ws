"""
# ============================================================
# ComposerPlan API 端点 (v1.0.0)
# Cycle 58 G58-05
# ============================================================
# 核心作用：暴露 ComposerPlanService 为 REST + SSE API
# 运行流程：
#   1. POST /api/composer-plan/                创建 plan
#   2. GET  /api/composer-plan/                列出 plan
#   3. GET  /api/composer-plan/{plan_id}       获取 plan 详情
#   4. DELETE /api/composer-plan/{plan_id}     删除 plan
#   5. POST /api/composer-plan/{plan_id}/start   启动执行
#   6. POST /api/composer-plan/{plan_id}/pause   暂停
#   7. POST /api/composer-plan/{plan_id}/resume  恢复
#   8. POST /api/composer-plan/{plan_id}/cancel  取消
#   9. POST /api/composer-plan/{plan_id}/step/{step_id}/retry  重试 step
#  10. POST /api/composer-plan/{plan_id}/step/{step_id}/skip   跳过 step
#  11. POST /api/composer-plan/{plan_id}/step/{step_id}/progress  更新进度
#  12. GET  /api/composer-plan/{plan_id}/events  SSE 事件流
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-05 初次创建
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

from ..services.composer_plan import (
    ComposerPlan,
    ComposerStep,
    PlanStatus,
    StepStatus,
    get_service,
    stream_plan_events,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/composer-plan", tags=["composer-plan"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class StepModel(BaseModel):
    """步骤定义"""
    step_id: Optional[str] = Field(default=None, description="step_id（不填自动生成）")
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    action: str = Field(..., min_length=1, max_length=128, description="动作名")
    params: Dict[str, Any] = Field(default_factory=dict)
    depends_on: List[str] = Field(default_factory=list)
    max_attempts: int = Field(default=1, ge=1, le=10)


class CreatePlanRequest(BaseModel):
    """创建 Plan 请求"""
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    steps: List[StepModel] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


class CreatePlanResponse(BaseModel):
    """创建 Plan 响应"""
    plan: Dict[str, Any]
    errors: List[str] = Field(default_factory=list)


class PlanResponse(BaseModel):
    """Plan 响应"""
    plan: Dict[str, Any]


class ControlResponse(BaseModel):
    """控制响应"""
    success: bool
    plan_id: str
    status: Optional[str] = None
    message: Optional[str] = None


class ProgressRequest(BaseModel):
    """进度更新请求"""
    progress: float = Field(..., ge=0.0, le=1.0)


# ============================================================
# 端点
# ============================================================


@router.post("", response_model=CreatePlanResponse)
async def create_plan(req: CreatePlanRequest):
    """
    创建 Plan

    输入参数：CreatePlanRequest
    输出结果：CreatePlanResponse
    """
    try:
        # 步骤转 dict，并补充 step_id
        steps_dict: List[Dict] = []
        for s in req.steps:
            d = s.dict()
            if not d.get("step_id"):
                d["step_id"] = f"step-{int(time.time() * 1000)}-{len(steps_dict)}"
            steps_dict.append(d)
        plan = await get_service().create_plan(
            title=req.title,
            description=req.description,
            steps=steps_dict,
            metadata=req.metadata,
        )
        return CreatePlanResponse(plan=plan.to_dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"create_plan: unexpected error err={e}")
        raise HTTPException(status_code=500, detail=f"内部错误: {e}")


@router.get("")
async def list_plans():
    """
    列出所有 Plan

    输入参数：无
    输出结果：JSON
    """
    plans = get_service().list_plans()
    return {
        "count": len(plans),
        "plans": [p.to_dict() for p in plans],
    }


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(plan_id: str):
    """
    获取 Plan 详情

    输入参数：plan_id
    输出结果：PlanResponse
    """
    plan = await get_service().get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
    return PlanResponse(plan=plan.to_dict())


@router.delete("/{plan_id}", response_model=ControlResponse)
async def delete_plan(plan_id: str):
    """
    删除 Plan

    输入参数：plan_id
    输出结果：ControlResponse
    """
    success = await get_service().delete_plan(plan_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
    return ControlResponse(success=True, plan_id=plan_id, message="Plan 已删除")


@router.post("/{plan_id}/start", response_model=ControlResponse)
async def start_plan(plan_id: str):
    """启动 Plan 执行"""
    try:
        success = await get_service().start_plan(plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        plan = await get_service().get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
        raise HTTPException(
            status_code=409,
            detail=f"Plan 状态不允许启动: {plan.status.value}",
        )
    return ControlResponse(success=True, plan_id=plan_id, status="running", message="Plan 已启动")


@router.post("/{plan_id}/pause", response_model=ControlResponse)
async def pause_plan(plan_id: str):
    """暂停 Plan"""
    success = await get_service().pause_plan(plan_id)
    if not success:
        plan = await get_service().get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
        raise HTTPException(
            status_code=409,
            detail=f"Plan 状态不允许暂停: {plan.status.value}",
        )
    return ControlResponse(success=True, plan_id=plan_id, status="paused", message="Plan 已暂停")


@router.post("/{plan_id}/resume", response_model=ControlResponse)
async def resume_plan(plan_id: str):
    """恢复 Plan"""
    success = await get_service().resume_plan(plan_id)
    if not success:
        plan = await get_service().get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
        raise HTTPException(
            status_code=409,
            detail=f"Plan 状态不允许恢复: {plan.status.value}",
        )
    return ControlResponse(success=True, plan_id=plan_id, status="running", message="Plan 已恢复")


@router.post("/{plan_id}/cancel", response_model=ControlResponse)
async def cancel_plan(plan_id: str):
    """取消 Plan"""
    success = await get_service().cancel_plan(plan_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
    return ControlResponse(success=True, plan_id=plan_id, status="cancelled", message="Plan 已取消")


@router.post("/{plan_id}/step/{step_id}/retry", response_model=ControlResponse)
async def retry_step(plan_id: str, step_id: str):
    """重试失败 step"""
    success = await get_service().retry_step(plan_id, step_id)
    if not success:
        plan = await get_service().get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
        step = plan.get_step(step_id)
        if step is None:
            raise HTTPException(status_code=404, detail=f"Step {step_id} 不存在")
        raise HTTPException(
            status_code=409,
            detail=f"Step 状态不允许重试: {step.status.value}",
        )
    return ControlResponse(success=True, plan_id=plan_id, message=f"Step {step_id} 已重新入队")


@router.post("/{plan_id}/step/{step_id}/skip", response_model=ControlResponse)
async def skip_step(plan_id: str, step_id: str):
    """跳过 step"""
    success = await get_service().skip_step(plan_id, step_id)
    if not success:
        plan = await get_service().get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")
        step = plan.get_step(step_id)
        if step is None:
            raise HTTPException(status_code=404, detail=f"Step {step_id} 不存在")
        raise HTTPException(
            status_code=409,
            detail=f"Step 状态不允许跳过: {step.status.value}",
        )
    return ControlResponse(success=True, plan_id=plan_id, message=f"Step {step_id} 已跳过")


@router.post("/{plan_id}/step/{step_id}/progress", response_model=PlanResponse)
async def update_progress(plan_id: str, step_id: str, req: ProgressRequest):
    """更新 step 进度（0-1）"""
    step = await get_service().update_step_progress(plan_id, step_id, req.progress)
    if step is None:
        raise HTTPException(status_code=404, detail=f"Plan/Step 不存在")
    plan = await get_service().get_plan(plan_id)
    return PlanResponse(plan=plan.to_dict())


@router.get("/{plan_id}/events")
async def events(plan_id: str):
    """
    SSE 订阅 Plan 事件

    输入参数：plan_id
    输出结果：SSE 流
    """
    async def event_generator():
        try:
            async for event in stream_plan_events(plan_id):
                yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            logger.info(f"composer-plan events: client disconnected plan={plan_id}")
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


@router.get("/{plan_id}/history")
async def get_history(plan_id: str, limit: int = 50):
    """
    获取 plan 历史事件

    输入参数：plan_id, limit (1-200)
    输出结果：JSON
    """
    limit = max(1, min(200, limit))
    history = get_service().get_history(plan_id, limit=limit)
    return {
        "plan_id": plan_id,
        "count": len(history),
        "events": history,
    }
