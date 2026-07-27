"""
# ============================================================
# 会话 fork / resume API 路由
# ============================================================
# 核心作用：暴露会话 fork/resume/lineage 功能的 REST API
# 端点：
#   - POST   /api/sessions/{id}/fork         分叉会话
#   - POST   /api/sessions/{id}/resume       恢复会话（带设备同步）
#   - GET    /api/sessions/{id}/lineage      查询会话血缘
#   - POST   /api/sessions/{id}/archive      归档会话
#   - POST   /api/sessions/{id}/unarchive    取消归档
# ============================================================
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()


def get_fork_resume_service(request: Request):
    """
    从 app.state 获取 SessionForkResumeService
    """
    svc = getattr(request.app.state, "session_fork_resume_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="SessionForkResumeService 未初始化")
    return svc


@router.post("/sessions/{session_id}/fork")
async def fork_session(
    session_id: str,
    request: Request,
    body: Optional[Dict[str, Any]] = None,
):
    """
    分叉会话
    请求体：{"fork_point_message_id": "msg-uuid", "title": "新标题"}
    """
    svc = get_fork_resume_service(request)
    body = body or {}
    result = await svc.fork(
        source_session_id=session_id,
        fork_point_message_id=body.get("fork_point_message_id"),
        title=body.get("title"),
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Fork 失败"))
    return result


@router.post("/sessions/{session_id}/resume")
async def resume_session(
    session_id: str,
    request: Request,
    body: Optional[Dict[str, Any]] = None,
):
    """
    恢复会话（带设备同步）
    请求体：{"device_id": "device-xxx"}
    """
    svc = get_fork_resume_service(request)
    body = body or {}
    result = await svc.resume(
        session_id=session_id,
        device_id=body.get("device_id"),
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Resume 失败"))
    return result


@router.get("/sessions/{session_id}/lineage")
async def get_session_lineage(session_id: str, request: Request):
    """
    查询会话血缘（父子链）
    """
    svc = get_fork_resume_service(request)
    return await svc.get_lineage(session_id)


@router.post("/sessions/{session_id}/archive")
async def archive_session(session_id: str, request: Request):
    """
    归档会话
    """
    svc = get_fork_resume_service(request)
    return await svc.archive(session_id, archived=True)


@router.post("/sessions/{session_id}/unarchive")
async def unarchive_session(session_id: str, request: Request):
    """
    取消归档
    """
    svc = get_fork_resume_service(request)
    return await svc.archive(session_id, archived=False)
