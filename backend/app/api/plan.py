"""
# ============================================================
# Plan 模式 API 路由
# ============================================================
# 核心作用：暴露 Plan 模式 4 个核心端点
#   1. POST /api/workflow/{workflow_id}/plan/generate - 生成 Plan
#   2. POST /api/workflow/{workflow_id}/plan/confirm  - 确认 Plan
#   3. POST /api/workflow/{workflow_id}/plan/modify   - 修改 Plan
#   4. GET  /api/workflow/{workflow_id}/plan          - 获取当前 Plan
#   5. POST /api/workflow/{workflow_id}/plan/reject   - 拒绝 Plan
# 修改记录：
#   - 2026-07-27 | v1.0.0 | P0-4 Plan 模式 API 实现
# ============================================================
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.plan_mode import PlanModeService, PlanDocument

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class PlanGenerateRequest(BaseModel):
    """Plan 生成请求"""
    objective: str = Field(default="", description="项目目标")
    spec_doc: str = Field(default="", description="spec.md 内容（可选）")
    architecture_doc: str = Field(default="", description="架构文档内容（可选）")


class PlanConfirmRequest(BaseModel):
    """Plan 确认请求"""
    plan_id: str = Field(..., description="要确认的 Plan ID")
    user_modifications: str = Field(default="", description="用户修改说明")


class PlanModifyRequest(BaseModel):
    """Plan 修改请求"""
    plan: Dict[str, Any] = Field(..., description="修改后的 Plan JSON")
    user_modifications: str = Field(default="", description="修改说明")


class PlanRejectRequest(BaseModel):
    """Plan 拒绝请求"""
    reason: str = Field(default="", description="拒绝原因")


# ============================================================
# 端点
# ============================================================

@router.post("/{workflow_id}/plan/generate")
async def generate_plan(
    request: Request,
    workflow_id: str,
    body: PlanGenerateRequest,
):
    """
    生成 Plan
    1. 从 app.state.plan_mode_service 获取服务
    2. 调用 service.generate_plan
    3. 返回 PlanDocument dict
    """
    plan_service: PlanModeService = getattr(request.app.state, "plan_mode_service", None)
    if plan_service is None:
        raise HTTPException(status_code=503, detail="Plan 模式服务未初始化")

    try:
        plan = await plan_service.generate_plan(
            workflow_id=workflow_id,
            objective=body.objective,
            spec_doc=body.spec_doc,
            architecture_doc=body.architecture_doc,
        )
        return {
            "success": True,
            "plan": plan.to_dict(),
            "message": f"Plan 已生成: {len(plan.stages)} 个阶段, "
                       f"{sum(len(s.tasks) for s in plan.stages)} 个任务",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Plan 生成失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Plan 生成失败: {str(e)}")


@router.get("/{workflow_id}/plan")
async def get_plan(request: Request, workflow_id: str):
    """
    获取工作流当前 Plan
    """
    plan_service: PlanModeService = getattr(request.app.state, "plan_mode_service", None)
    if plan_service is None:
        raise HTTPException(status_code=503, detail="Plan 模式服务未初始化")

    try:
        plan = await plan_service.get_plan(workflow_id)
        if plan is None:
            return {
                "success": True,
                "plan": None,
                "message": "该工作流尚未生成 Plan",
            }
        return {
            "success": True,
            "plan": plan.to_dict(),
            "message": "Plan 获取成功",
        }
    except Exception as e:
        logger.error(f"Plan 获取失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Plan 获取失败: {str(e)}")


@router.post("/{workflow_id}/plan/confirm")
async def confirm_plan(
    request: Request,
    workflow_id: str,
    body: PlanConfirmRequest,
):
    """
    确认 Plan
    1. 校验 plan_id 匹配
    2. 标记 status=confirmed
    3. 设置 workflow.plan_confirmed=True
    """
    plan_service: PlanModeService = getattr(request.app.state, "plan_mode_service", None)
    if plan_service is None:
        raise HTTPException(status_code=503, detail="Plan 模式服务未初始化")

    try:
        plan = await plan_service.confirm_plan(
            workflow_id=workflow_id,
            plan_id=body.plan_id,
            user_modifications=body.user_modifications,
        )
        return {
            "success": True,
            "plan": plan.to_dict(),
            "message": "Plan 已确认，可继续推进工作流",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Plan 确认失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Plan 确认失败: {str(e)}")


@router.post("/{workflow_id}/plan/modify")
async def modify_plan(
    request: Request,
    workflow_id: str,
    body: PlanModifyRequest,
):
    """
    修改 Plan
    1. 接收用户修改后的 Plan JSON
    2. 替换原 Plan
    3. 标记 status=modified
    """
    plan_service: PlanModeService = getattr(request.app.state, "plan_mode_service", None)
    if plan_service is None:
        raise HTTPException(status_code=503, detail="Plan 模式服务未初始化")

    try:
        modified_plan = PlanDocument.from_dict(body.plan)
        result = await plan_service.modify_plan(
            workflow_id=workflow_id,
            modified_plan=modified_plan,
            user_modifications=body.user_modifications,
        )
        return {
            "success": True,
            "plan": result.to_dict(),
            "message": "Plan 已更新",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Plan 修改失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Plan 修改失败: {str(e)}")


@router.post("/{workflow_id}/plan/reject")
async def reject_plan(
    request: Request,
    workflow_id: str,
    body: PlanRejectRequest,
):
    """
    拒绝 Plan（触发重新生成）
    """
    plan_service: PlanModeService = getattr(request.app.state, "plan_mode_service", None)
    if plan_service is None:
        raise HTTPException(status_code=503, detail="Plan 模式服务未初始化")

    try:
        result = await plan_service.reject_plan(workflow_id, body.reason)
        return {
            "success": result,
            "message": "Plan 已拒绝" if result else "未找到 Plan",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Plan 拒绝失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Plan 拒绝失败: {str(e)}")
