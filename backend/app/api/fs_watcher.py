"""
# ============================================================
# FileSystemWatcher REST API (v1.0.0)
# Cycle 64 G64-02
# ====================================
# 核心作用：暴露 FileSystemWatcher 为 REST API，联动 StageDetector
# 端点：
#   - GET    /api/fs-watcher/paths           列出监控路径
#   - POST   /api/fs-watcher/paths           添加监控路径
#   - DELETE /api/fs-watcher/paths           移除监控路径
#   - GET    /api/fs-watcher/events          事件历史
#   - DELETE /api/fs-watcher/events          清空事件
#   - GET    /api/fs-watcher/stage           当前 stage
#   - POST   /api/fs-watcher/stage/infer     手动触发 stage 推断
#   - GET    /api/fs-watcher/stats           统计
#   - POST   /api/fs-watcher/start           启动
#   - POST   /api/fs-watcher/stop            停止
#   - POST   /api/fs-watcher/auto-follow     启用与 stage 的自动联动
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.filesystem_watcher import (
    FileSystemEvent,
    FileSystemWatcher,
    get_filesystem_watcher,
    reset_filesystem_watcher,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fs-watcher", tags=["fs-watcher"])


# ============================================================
# Request/Response 模型
# ============================================================


class AddPathRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)


class RemovePathRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)


# ============================================================
# 路径管理
# ============================================================


@router.get("/paths")
async def list_paths() -> Dict[str, Any]:
    """列出监控路径"""
    watcher = get_filesystem_watcher()
    paths = watcher.list_watch_paths()
    return {
        "success": True,
        "paths": [
            {
                "path": p,
                "state": watcher.get_path_state(p),
            }
            for p in paths
        ],
        "total": len(paths),
    }


@router.post("/paths")
async def add_path(req: AddPathRequest) -> Dict[str, Any]:
    """添加监控路径"""
    watcher = get_filesystem_watcher()
    try:
        watcher.add_watch_path(req.path)
    except Exception as e:  # noqa: BLE001
        from ..services.filesystem_watcher import InvalidPathError
        if isinstance(e, InvalidPathError):
            raise HTTPException(status_code=400, detail=str(e)) from e
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {
        "success": True,
        "path": req.path,
        "total": len(watcher.list_watch_paths()),
    }


@router.delete("/paths")
async def remove_path(req: RemovePathRequest) -> Dict[str, Any]:
    """移除监控路径"""
    watcher = get_filesystem_watcher()
    removed = watcher.remove_watch_path(req.path)
    if not removed:
        raise HTTPException(status_code=404, detail=f"路径不在监控列表: {req.path}")
    return {
        "success": True,
        "path": req.path,
    }


# ============================================================
# 事件
# ============================================================


@router.get("/events")
async def list_events(
    limit: int = Query(default=50, ge=1, le=1000),
) -> Dict[str, Any]:
    """获取最近事件"""
    watcher = get_filesystem_watcher()
    events = watcher.get_recent_events(limit=limit)
    return {
        "success": True,
        "events": [e.to_dict() for e in events],
        "total": len(events),
    }


@router.delete("/events")
async def clear_events() -> Dict[str, Any]:
    """清空事件历史"""
    watcher = get_filesystem_watcher()
    watcher.clear_events()
    return {
        "success": True,
    }


# ============================================================
# Stage 联动
# ============================================================


@router.get("/stage")
async def get_stage() -> Dict[str, Any]:
    """获取当前 stage"""
    watcher = get_filesystem_watcher()
    return {
        "success": True,
        "stage": watcher.get_current_stage(),
    }


@router.post("/stage/infer")
async def infer_stage(req: AddPathRequest) -> Dict[str, Any]:
    """根据文件路径手动触发 stage 推断（不实际添加监控）"""
    from ..services.filesystem_watcher import FileSystemEvent
    watcher = get_filesystem_watcher()
    event = FileSystemEvent(
        event_type="created",
        path=req.path,
    )
    new_stage = watcher.infer_stage(event)
    changed = watcher.update_current_stage(new_stage)
    return {
        "success": True,
        "stage": new_stage,
        "changed": changed,
    }


@router.post("/auto-follow")
async def enable_auto_follow() -> Dict[str, Any]:
    """
    启用 FS watcher → StageDetector 自动联动
    每当文件变更推断出新 stage 时，自动调用 StageDetector.force_stage
    """
    watcher = get_filesystem_watcher()
    try:
        from ..services.stage_detector import get_stage_detector
        detector = get_stage_detector()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"StageDetector 不可用: {e}") from e

    def _on_event(event: FileSystemEvent):
        # 推断 stage
        new_stage = watcher.infer_stage(event)
        if watcher.update_current_stage(new_stage):
            # 通知所有 session
            try:
                # 简化：只对 default session 做 force_stage
                detector.force_stage(
                    session_id="default",
                    stage=new_stage,
                    reason=f"fs event: {event.event_type} {event.path}",
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(f"force_stage 失败: {e}")

    watcher.on_any(_on_event)
    return {
        "success": True,
        "message": "auto-follow enabled",
    }


# ============================================================
# 生命周期
# ============================================================


@router.post("/start")
async def start() -> Dict[str, Any]:
    """启动监控"""
    watcher = get_filesystem_watcher()
    await watcher.start()
    return {
        "success": True,
        "observer_active": watcher.get_stats()["observer_active"],
    }


@router.post("/stop")
async def stop() -> Dict[str, Any]:
    """停止监控"""
    watcher = get_filesystem_watcher()
    await watcher.stop()
    return {
        "success": True,
    }


# ============================================================
# 统计
# ============================================================


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """统计"""
    watcher = get_filesystem_watcher()
    return {
        "success": True,
        "stats": watcher.get_stats(),
    }


# ============================================================
# 测试辅助
# ============================================================


@router.post("/_test/reset")
async def reset_test_state() -> Dict[str, Any]:
    """重置 watcher（仅测试用）"""
    import os
    if os.environ.get("ENABLE_TEST_ENDPOINTS", "").lower() not in ("1", "true"):
        raise HTTPException(status_code=403, detail="测试端点已禁用")
    reset_filesystem_watcher()
    return {
        "success": True,
        "message": "test state reset",
    }


@router.post("/_test/simulate")
async def simulate_event(req: AddPathRequest) -> Dict[str, Any]:
    """模拟一个文件事件（仅测试用）"""
    import os
    if os.environ.get("ENABLE_TEST_ENDPOINTS", "").lower() not in ("1", "true"):
        raise HTTPException(status_code=403, detail="测试端点已禁用")
    watcher = get_filesystem_watcher()
    event = FileSystemEvent(event_type="created", path=req.path)
    # 直接调用内部 _handle_event
    watcher._handle_event(event.event_type, event.path, event.is_dir)
    return {
        "success": True,
        "event": event.to_dict(),
        "current_stage": watcher.get_current_stage(),
    }
