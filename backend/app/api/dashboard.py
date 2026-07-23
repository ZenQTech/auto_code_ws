"""
# ============================================================
# Dashboard API — 工作流监控
# ============================================================
# 核心作用：提供工作流 Dashboard 数据接口
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
# ============================================================
"""

import logging
from fastapi import APIRouter, Request, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/workflow/{workflow_id}")
async def get_workflow_dashboard(request: Request, workflow_id: str):
    """
    获取工作流 Dashboard 数据
    包含：阶段状态、进度、智能体状态、文档预览
    """
    if not hasattr(request.app.state, 'workflow_engine'):
        raise HTTPException(status_code=503, detail="工作流引擎未初始化")
    workflow_engine = request.app.state.workflow_engine
    try:
        status_info = await workflow_engine.get_workflow_status(workflow_id)
        return {
            "workflow_id": status_info.workflow_id,
            "session_id": status_info.session_id,
            "status": status_info.status,
            "current_stage": status_info.current_stage,
            "iteration_count": status_info.iteration_count,
            "max_iterations": status_info.max_iterations,
            "progress": status_info.progress,
            "error_message": status_info.error_message,
            "stages": [
                {
                    "key": s["key"],
                    "name": s["name"],
                    "status": s["status"],
                    "agent_role": s.get("agent_role"),
                    "started_at": s.get("started_at"),
                    "completed_at": s.get("completed_at"),
                }
                for s in status_info.stages
            ],
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/workflow/{workflow_id}/stages/{stage_name}")
async def get_stage_detail(
    request: Request, workflow_id: str, stage_name: str
):
    """
    获取单个阶段详情
    包含：输入/输出文档、智能体对话记录
    """
    from sqlalchemy import select
    from ..models import WorkflowStage
    from ..database import get_session_factory

    session_factory = get_session_factory()
    async with session_factory() as db:
        result = await db.execute(
            select(WorkflowStage).where(
                WorkflowStage.workflow_id == workflow_id,
                WorkflowStage.stage_name == stage_name,
            )
        )
        stage = result.scalar_one_or_none()
        if stage is None:
            raise HTTPException(status_code=404, detail="阶段不存在")

        return {
            "stage_name": stage.stage_name,
            "status": stage.status.value if hasattr(stage.status, "value") else str(stage.status),
            "agent_role": stage.agent_role,
            "input_doc": stage.input_doc,
            "output_doc": stage.output_doc,
            "conversation_summary": stage.conversation_summary,
            "started_at": stage.started_at.isoformat() if stage.started_at else None,
            "completed_at": stage.completed_at.isoformat() if stage.completed_at else None,
        }
