"""
# ============================================================
# Snapshots REST API (v1.0.0)
# Cycle 66 G66-02
# ============================================================
# 核心作用：暴露 SnapshotStore + UndoController 为 REST API
# 运行流程：
#   1. POST   /api/snapshots                    创建快照
#   2. GET    /api/snapshots?session_id=...    列出快照
#   3. GET    /api/snapshots/{id}              快照详情
#   4. POST   /api/snapshots/{id}/restore      恢复快照
#   5. GET    /api/snapshots/{id}/preview      预览 diff
#   6. DELETE /api/snapshots/{id}              删除快照
#   7. GET    /api/snapshots/_stats            统计信息
# 设计要点：
#   - 标准 REST 风格
#   - 错误码：404/409/500 严格区分
#   - 操作审计：记录 actor
#   - 冲突状态：409 返回 conflicts 列表
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.snapshot_store import (
    InvalidSnapshotError,
    SnapshotNotFoundError,
    SnapshotStore,
    SnapshotTooLargeError,
    get_snapshot_store,
)
from ..services.undo_controller import (
    ConflictDetectedError,
    UndoController,
    get_undo_controller,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


# ============================================================
# Request Models
# ============================================================


class CreateSnapshotRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    agent_id: str = Field(..., min_length=1, max_length=128)
    paths: List[str] = Field(..., min_length=1, max_length=1000)
    trigger: str = Field(default="manual", max_length=16)
    description: str = Field(default="", max_length=512)

class RestoreRequest(BaseModel):
    paths: Optional[List[str]] = Field(default=None, max_length=1000)
    force: bool = False
    actor: str = Field(default="user", max_length=64)


# ============================================================
# 静态路径（在 /{id} 之前）
# ============================================================


@router.get("/_stats")
async def get_stats() -> Dict[str, Any]:
    """获取快照系统统计"""
    store = get_snapshot_store()
    controller = get_undo_controller()
    return {
        "success": True,
        "store": store.get_stats(),
        "controller": controller.get_stats(),
    }


@router.post("")
async def create_snapshot(req: CreateSnapshotRequest) -> Dict[str, Any]:
    """
    创建快照
    返回 201/200 成功
    返回 400 数据非法
    返回 413 快照过大
    """
    store = get_snapshot_store()
    try:
        snapshot = store.create(
            session_id=req.session_id,
            agent_id=req.agent_id,
            paths=req.paths,
            trigger=req.trigger,
            description=req.description,
        )
    except InvalidSnapshotError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except SnapshotTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception(f"create_snapshot 失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建失败: {e}") from e

    return {
        "success": True,
        "snapshot": snapshot.to_dict(),
    }


@router.get("")
async def list_snapshots(
    session_id: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    """列出会话的快照（按时间倒序）"""
    store = get_snapshot_store()
    snapshots, total = store.list(session_id, limit=limit, offset=offset)
    return {
        "success": True,
        "session_id": session_id,
        "total": total,
        "snapshots": [s.to_dict() for s in snapshots],
        "limit": limit,
        "offset": offset,
    }


# ============================================================
# 动态路径 /{snapshot_id}
# ============================================================


@router.get("/{snapshot_id}")
async def get_snapshot(snapshot_id: str) -> Dict[str, Any]:
    """获取快照详情"""
    store = get_snapshot_store()
    try:
        snapshot = store.get(snapshot_id)
    except SnapshotNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "success": True,
        "snapshot": snapshot.to_dict(),
    }


@router.delete("/{snapshot_id}")
async def delete_snapshot(snapshot_id: str) -> Dict[str, Any]:
    """删除快照"""
    store = get_snapshot_store()
    deleted = store.delete(snapshot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"快照不存在: {snapshot_id}")
    return {
        "success": True,
        "snapshot_id": snapshot_id,
        "deleted_at": __import__("time").time(),
    }


@router.get("/{snapshot_id}/preview")
async def preview_snapshot(
    snapshot_id: str,
    paths: Optional[str] = Query(default=None, max_length=4096),
) -> Dict[str, Any]:
    """预览恢复后的 diff"""
    store = get_snapshot_store()
    controller = get_undo_controller()
    try:
        snapshot = store.get(snapshot_id)
    except SnapshotNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    path_list: Optional[List[str]] = None
    if paths:
        path_list = [p.strip() for p in paths.split(",") if p.strip()]

    preview = controller.preview(snapshot, paths=path_list)
    return {
        "success": True,
        "preview": preview.to_dict(),
    }


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(
    snapshot_id: str, req: RestoreRequest
) -> Dict[str, Any]:
    """
    恢复快照
    200 - completed/partial 成功
    409 - pending_confirm（有冲突需 force）
    404 - 快照不存在
    500 - 恢复失败
    """
    controller = get_undo_controller()
    result = await controller.restore(
        snapshot_id=snapshot_id,
        paths=req.paths,
        force=req.force,
        actor=req.actor,
    )
    if result.status == "pending_confirm":
        # 409 Conflict
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "result": result.to_dict(),
            },
        )
    if not result.success and result.status == "failed":
        if "不存在" in result.message or "not found" in result.message.lower():
            raise HTTPException(status_code=404, detail=result.message)
        raise HTTPException(status_code=500, detail=result.message)
    return {
        "success": True,
        "result": result.to_dict(),
    }
