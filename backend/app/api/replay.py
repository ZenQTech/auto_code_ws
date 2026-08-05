"""
# ============================================================
# Replay API (v1.0.0)
# Cycle 69 G69-02
# ============================================================
# 核心作用：暴露 SessionReplayService 为 REST API
#   GET    /api/replay/sessions              列出所有会话
#   GET    /api/replay/sessions/{id}         获取会话详情
#   GET    /api/replay/sessions/{id}/html    渲染自包含 HTML
#   GET    /api/replay/sessions/{id}/turns   获取所有 turn（JSON）
#   POST   /api/replay/sessions/{id}/bookmark  添加书签
#   GET    /api/replay/sessions/{id}/bookmarks 列出书签
#   DELETE /api/replay/bookmarks/{id}        删除书签
#   POST   /api/replay/retention/apply       手动触发 retention
#   GET    /api/replay/stats                 获取存储统计
#   GET    /api/replay/sessions/{id}/export  导出会话
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-02 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from app.services.session_replay import (
    Bookmark,
    InvalidSessionIdError,
    ReplayConfig,
    ReplayTheme,
    RenderTooLargeError,
    RetentionPolicy,
    RetentionResult,
    SessionMetadata,
    SessionNotFoundError,
    SessionReplayError,
    SessionReplayService,
    get_session_replay_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/replay", tags=["session-replay"])


# ============================================================
# Request / Response Models
# ============================================================


class ReplayConfigModel(BaseModel):
    show_reasoning: bool = True
    show_tool_calls: bool = True
    show_system: bool = False
    theme: str = "default"
    speed: float = 1.0


class BookmarkCreateRequest(BaseModel):
    turn_index: int = Field(..., ge=0)
    label: str = Field(..., min_length=1, max_length=200)
    note: str = Field(default="", max_length=1000)


class SessionsListResponse(BaseModel):
    sessions: List[Dict[str, Any]] = Field(default_factory=list)
    total: int = 0
    total_size_bytes: int = 0


class TurnsResponse(BaseModel):
    session_id: str
    turns: List[Dict[str, Any]] = Field(default_factory=list)
    total: int = 0


class BookmarkResponse(BaseModel):
    bookmark_id: str
    session_id: str
    turn_index: int
    label: str
    note: str = ""
    created_at: str


class RetentionResponse(BaseModel):
    compressed: int = 0
    cleaned: int = 0
    total_size_before: int = 0
    total_size_after: int = 0


class StatsResponse(BaseModel):
    total_sessions: int = 0
    total_size_bytes: int = 0
    total_bookmarks: int = 0
    oldest_session_at: Optional[str] = None
    by_age_days: Dict[str, int] = Field(default_factory=dict)


# ============================================================
# 辅助函数
# ============================================================


def _to_config(m: ReplayConfigModel) -> ReplayConfig:
    theme = ReplayTheme.DEFAULT
    try:
        theme = ReplayTheme(m.theme)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid theme: {m.theme}")
    return ReplayConfig(
        show_reasoning=m.show_reasoning,
        show_tool_calls=m.show_tool_calls,
        show_system=m.show_system,
        theme=theme,
        speed=m.speed,
    )


# ============================================================
# REST 端点
# ============================================================


@router.get("/sessions", response_model=SessionsListResponse)
def list_sessions(limit: int = Query(default=100, ge=1, le=1000)) -> SessionsListResponse:
    """列出所有会话"""
    svc = get_session_replay_service()
    sessions = svc.list_sessions(limit=limit)
    total_size = sum(s.size_bytes for s in sessions)
    return SessionsListResponse(
        sessions=[s.to_dict() for s in sessions],
        total=len(sessions),
        total_size_bytes=total_size,
    )


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> Dict[str, Any]:
    """获取单个会话的元数据"""
    svc = get_session_replay_service()
    try:
        svc.validate_session_id(session_id)
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))
    sessions = svc.list_sessions(limit=10000)
    for s in sessions:
        if s.session_id == session_id:
            return s.to_dict()
    raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")


@router.get("/sessions/{session_id}/turns", response_model=TurnsResponse)
def get_turns(session_id: str) -> TurnsResponse:
    """获取会话的所有 turn"""
    svc = get_session_replay_service()
    try:
        turns = svc.load_session(session_id)
        return TurnsResponse(
            session_id=session_id,
            turns=[t.to_dict() for t in turns],
            total=len(turns),
        )
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/sessions/{session_id}/html", response_class=HTMLResponse)
def render_html(
    session_id: str,
    show_reasoning: bool = Query(default=True),
    show_tool_calls: bool = Query(default=True),
    show_system: bool = Query(default=False),
    theme: str = Query(default="default"),
    speed: float = Query(default=1.0, ge=0.1, le=10.0),
) -> HTMLResponse:
    """渲染自包含 HTML"""
    svc = get_session_replay_service()
    config = _to_config(ReplayConfigModel(
        show_reasoning=show_reasoning,
        show_tool_calls=show_tool_calls,
        show_system=show_system,
        theme=theme,
        speed=speed,
    ))
    try:
        html = svc.render_html(session_id, config)
        return HTMLResponse(content=html, status_code=200)
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RenderTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e))


@router.post("/sessions/{session_id}/bookmark", response_model=BookmarkResponse, status_code=201)
def create_bookmark(session_id: str, req: BookmarkCreateRequest) -> BookmarkResponse:
    """添加书签"""
    svc = get_session_replay_service()
    try:
        bookmark = svc.save_bookmark(session_id, req.turn_index, req.label, req.note)
        return BookmarkResponse(**bookmark.to_dict())
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SessionReplayError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}/bookmarks", response_model=List[BookmarkResponse])
def list_bookmarks(session_id: str) -> List[BookmarkResponse]:
    """列出某会话的书签"""
    svc = get_session_replay_service()
    try:
        bookmarks = svc.list_bookmarks(session_id)
        return [BookmarkResponse(**b.to_dict()) for b in bookmarks]
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/bookmarks/{bookmark_id}")
def delete_bookmark(bookmark_id: str, session_id: str = Query(...)) -> Dict[str, Any]:
    """删除书签"""
    svc = get_session_replay_service()
    try:
        removed = svc.delete_bookmark(session_id, bookmark_id)
        if not removed:
            raise HTTPException(status_code=404, detail=f"Bookmark not found: {bookmark_id}")
        return {"bookmark_id": bookmark_id, "status": "deleted"}
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/retention/apply", response_model=RetentionResponse)
def apply_retention(
    max_age_days: int = Query(default=90, ge=1, le=365),
    max_size_bytes: int = Query(default=100 * 1024 * 1024, ge=1024),
    compress_after_days: int = Query(default=7, ge=1, le=90),
) -> RetentionResponse:
    """手动触发 retention"""
    svc = get_session_replay_service()
    policy = RetentionPolicy(
        max_age_days=max_age_days,
        max_size_bytes=max_size_bytes,
        compress_after_days=compress_after_days,
    )
    result = svc.apply_retention(policy)
    return RetentionResponse(**result.to_dict())


@router.get("/stats", response_model=StatsResponse)
def get_stats() -> StatsResponse:
    """获取存储统计"""
    svc = get_session_replay_service()
    stats = svc.get_stats()
    return StatsResponse(**stats.to_dict())


@router.get("/sessions/{session_id}/export")
def export_session(
    session_id: str,
    format: str = Query(default="json", pattern="^(json|jsonl|md)$"),
):
    """导出会话"""
    svc = get_session_replay_service()
    try:
        data = svc.export_session(session_id, format)
        if format == "json":
            return JSONResponse(content=json.loads(data.decode("utf-8")))
        else:
            from fastapi.responses import Response
            media_types = {"jsonl": "application/x-ndjson", "md": "text/markdown"}
            return Response(
                content=data,
                media_type=media_types.get(format, "application/octet-stream"),
                headers={"Content-Disposition": f'attachment; filename="{session_id}.{format}"'},
            )
    except InvalidSessionIdError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SessionReplayError as e:
        raise HTTPException(status_code=500, detail=str(e))
