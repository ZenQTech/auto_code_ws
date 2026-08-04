"""
# ============================================================
# 多任务并行 API (v1.0.0)
# Cycle 62 G62-01
# ====================================
# 核心作用：暴露 MultiTaskManager 为 REST API + WebSocket
# 运行流程：
#   1. POST /api/multi-task/create      创建任务
#   2. GET  /api/multi-task/list        列出任务
#   3. GET  /api/multi-task/{id}        任务详情
#   4. GET  /api/multi-task/{id}/status 任务状态
#   5. POST /api/multi-task/{id}/start  启动
#   6. POST /api/multi-task/{id}/pause  暂停
#   7. POST /api/multi-task/{id}/resume 恢复
#   8. POST /api/multi-task/{id}/cancel 取消
#   9. POST /api/multi-task/{id}/complete 标记完成
#   10. POST /api/multi-task/{id}/fail   标记失败
#   11. POST /api/multi-task/{id}/progress 更新进度
#   12. DELETE /api/multi-task/{id}     删除
#   13. GET  /api/multi-task/stats      统计
# WebSocket: WS /api/multi-task/ws/{task_id}
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-01 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from ..services.multi_task import (
    MultiTaskManager,
    TaskSlot,
    TaskStatus,
    get_multi_task_manager,
    reset_multi_task_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/multi-task", tags=["multi-task"])


# ============================================================
# Pydantic 数据模型
# ============================================================


class CreateTaskRequest(BaseModel):
    title: str = Field(default="", max_length=200)
    prompt: str = Field(..., min_length=1, max_length=200000)
    context_ids: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ProgressRequest(BaseModel):
    tokens_used: Optional[int] = None
    cpu_percent: Optional[float] = None
    memory_mb: Optional[float] = None


class CompleteRequest(BaseModel):
    result: Optional[Dict[str, Any]] = None


class FailRequest(BaseModel):
    error: str = Field(..., min_length=1, max_length=5000)


# ============================================================
# 错误处理辅助
# ============================================================


def handle_value_error(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def handle_permission_error(e: PermissionError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(e))


# ============================================================
# API 端点
# ============================================================


@router.post("/create")
async def create_task(req: CreateTaskRequest) -> Dict[str, Any]:
    """创建新任务"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.create(
            title=req.title,
            prompt=req.prompt,
            context_ids=req.context_ids,
            metadata=req.metadata,
        )
    except PermissionError as e:
        raise handle_permission_error(e) from e
    return {
        "success": True,
        "task": slot.to_dict(),
    }


@router.get("/list")
async def list_tasks(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> Dict[str, Any]:
    """列出任务"""
    mgr = get_multi_task_manager()
    status_enum = None
    if status is not None:
        try:
            status_enum = TaskStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"无效 status: {status}",
            )
    tasks = mgr.list(status=status_enum, limit=limit)
    return {
        "success": True,
        "tasks": [t.to_dict() for t in tasks],
        "count": len(tasks),
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """获取管理器统计"""
    mgr = get_multi_task_manager()
    return {
        "success": True,
        "stats": mgr.get_stats(),
    }


@router.get("/{task_id}")
async def get_task(task_id: str) -> Dict[str, Any]:
    """任务详情"""
    mgr = get_multi_task_manager()
    slot = mgr.get(task_id)
    if slot is None:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
    return {
        "success": True,
        "task": slot.to_dict(),
    }


@router.get("/{task_id}/status")
async def get_task_status(task_id: str) -> Dict[str, Any]:
    """任务状态"""
    mgr = get_multi_task_manager()
    slot = mgr.get(task_id)
    if slot is None:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
    return {
        "success": True,
        "task_id": task_id,
        "status": slot.status.value,
        "elapsed_s": (
            (slot.completed_at or slot.updated_at) - slot.started_at
            if slot.started_at else 0.0
        ),
    }


@router.post("/{task_id}/start")
async def start_task(task_id: str) -> Dict[str, Any]:
    """启动任务"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.start(task_id)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/pause")
async def pause_task(task_id: str) -> Dict[str, Any]:
    """暂停任务"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.pause(task_id)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/resume")
async def resume_task(task_id: str) -> Dict[str, Any]:
    """恢复任务"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.resume(task_id)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str) -> Dict[str, Any]:
    """取消任务"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.cancel(task_id)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/complete")
async def complete_task(task_id: str, req: CompleteRequest) -> Dict[str, Any]:
    """标记任务完成"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.complete(task_id, result=req.result)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/fail")
async def fail_task(task_id: str, req: FailRequest) -> Dict[str, Any]:
    """标记任务失败"""
    mgr = get_multi_task_manager()
    try:
        slot = await mgr.fail(task_id, error=req.error)
    except ValueError as e:
        raise handle_value_error(e) from e
    return {"success": True, "task": slot.to_dict()}


@router.post("/{task_id}/progress")
async def update_progress(task_id: str, req: ProgressRequest) -> Dict[str, Any]:
    """更新任务进度"""
    mgr = get_multi_task_manager()
    slot = mgr.get(task_id)
    if slot is None:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
    progress = {
        "tokens_used": req.tokens_used,
        "cpu_percent": req.cpu_percent,
        "memory_mb": req.memory_mb,
    }
    await mgr.update_progress(task_id, progress)
    return {"success": True}


@router.delete("/{task_id}")
async def delete_task(task_id: str) -> Dict[str, Any]:
    """删除任务"""
    mgr = get_multi_task_manager()
    try:
        deleted = await mgr.delete(task_id)
    except ValueError as e:
        raise handle_value_error(e) from e
    if not deleted:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
    return {"success": True, "deleted": True, "task_id": task_id}


@router.post("/reset")
async def reset() -> Dict[str, Any]:
    """重置全局单例（主要用于测试）"""
    reset_multi_task_manager()
    return {"success": True}


# ============================================================
# WebSocket 端点
# ============================================================


@router.websocket("/ws/{task_id}")
async def websocket_task(websocket: WebSocket, task_id: str):
    """单任务 WebSocket（订阅特定任务）"""
    from app.ws import manager as ws_manager
    session_id = f"multi_task:{task_id}"
    await ws_manager.connect(websocket, session_id=session_id)
    try:
        mgr = get_multi_task_manager()
        slot = mgr.get(task_id)
        if slot:
            await websocket.send_json(
                {"type": "task_status", "task": slot.to_dict()},
            )
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"WebSocket 错误: {e}")
        ws_manager.disconnect(websocket)


@router.websocket("/ws-all")
async def websocket_all_tasks(websocket: WebSocket):
    """全任务 WebSocket（订阅所有任务变更）"""
    from app.ws import manager as ws_manager
    session_id = "multi_task:all"
    await ws_manager.connect(websocket, session_id=session_id)
    try:
        mgr = get_multi_task_manager()
        # 发送当前所有任务
        await websocket.send_json(
            {
                "type": "initial",
                "tasks": [t.to_dict() for t in mgr.list(limit=200)],
            },
        )
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"WebSocket 错误: {e}")
        ws_manager.disconnect(websocket)
