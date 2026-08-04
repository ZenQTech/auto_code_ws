"""
# ============================================================
# Conversation Folding API 端点 (v1.0.0)
# Cycle 61 G61-08
# ============================================================
# 核心作用：暴露 ConversationFoldingManager 为 REST API
# 运行流程：
#   1. POST /api/conversation-fold/messages                添加消息
#   2. GET  /api/conversation-fold/sessions/{id}/messages   列出消息
#   3. POST /api/conversation-fold/sessions/{id}/fold       执行折叠
#   4. POST /api/conversation-fold/sessions/{id}/auto-fold  自动折叠
#   5. GET  /api/conversation-fold/sessions/{id}/folds      列出折叠历史
#   6. POST /api/conversation-fold/sessions/{id}/restore    恢复折叠
#   7. GET  /api/conversation-fold/sessions/{id}/stats      会话统计
#   8. PUT  /api/conversation-fold/sessions/{id}/config     更新配置
# 输入参数：HTTP 请求
# 输出结果：JSON 响应
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-08 初次创建
# ====================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.conversation_folding import (
    ConversationFoldingManager,
    FoldConfig,
    FoldResult,
    FoldStrategy,
    FoldTrigger,
    get_manager,
    reset_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversation-fold", tags=["conversation-fold"])


# ============================================================
# 数据模型
# ============================================================


class AddMessageRequest(BaseModel):
    """添加消息请求"""
    session_id: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=32)
    content: str = Field(default="", max_length=100000)
    tokens: int = Field(default=0, ge=0, le=1000000)
    metadata: Optional[Dict[str, Any]] = None


class FoldRequest(BaseModel):
    """折叠请求"""
    session_id: str = Field(..., min_length=1, max_length=128)
    trigger: str = Field(default="manual")
    keep_recent: Optional[int] = Field(default=None, ge=0, le=200)
    strategy: Optional[str] = None
    summary_max_tokens: Optional[int] = Field(default=None, ge=50, le=4000)


class ConfigRequest(BaseModel):
    """配置请求"""
    session_id: str = Field(..., min_length=1, max_length=128)
    keep_recent: int = Field(default=10, ge=0, le=200)
    max_messages: int = Field(default=50, ge=5, le=1000)
    max_tokens: int = Field(default=8000, ge=500, le=1000000)
    strategy: str = Field(default="llm_summary")
    summary_max_tokens: int = Field(default=500, ge=50, le=4000)
    auto_fold: bool = Field(default=True)


class RestoreRequest(BaseModel):
    """恢复请求"""
    session_id: str = Field(..., min_length=1, max_length=128)
    fold_id: str = Field(..., min_length=1, max_length=128)


# ============================================================
# 端点
# ============================================================


@router.post("/messages")
async def add_message(req: AddMessageRequest):
    """添加消息到 session"""
    mgr = get_manager()
    msg = mgr.add_message(
        session_id=req.session_id,
        role=req.role,
        content=req.content,
        tokens=req.tokens,
        metadata=req.metadata,
    )
    return {"success": True, "message": msg.to_dict()}


@router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: str, include_folded: bool = True):
    """列出 session 消息"""
    mgr = get_manager()
    if include_folded:
        msgs = mgr.get_messages(session_id)
    else:
        msgs = mgr.get_active_messages(session_id)
    return {
        "session_id": session_id,
        "count": len(msgs),
        "messages": [m.to_dict() for m in msgs],
    }


@router.post("/sessions/{session_id}/fold")
async def fold(req: FoldRequest):
    """执行折叠"""
    mgr = get_manager()
    try:
        trigger = FoldTrigger(req.trigger)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的 trigger: {req.trigger}")
    config = None
    if req.keep_recent is not None or req.strategy or req.summary_max_tokens is not None:
        current = mgr.get_config(req.session_id)
        if req.strategy:
            try:
                current.strategy = FoldStrategy(req.strategy)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"无效的 strategy: {req.strategy}")
        if req.keep_recent is not None:
            current.keep_recent = req.keep_recent
        if req.summary_max_tokens is not None:
            current.summary_max_tokens = req.summary_max_tokens
        config = current
    result = await mgr.fold(req.session_id, trigger=trigger, config=config)
    if not result.success:
        return {"success": False, "result": result.to_dict()}
    return {"success": True, "result": result.to_dict()}


@router.post("/sessions/{session_id}/auto-fold")
async def auto_fold(session_id: str):
    """自动折叠（如果需要）"""
    mgr = get_manager()
    result = await mgr.auto_fold_if_needed(session_id)
    if result is None:
        return {"success": False, "message": "无需折叠"}
    return {"success": result.success, "result": result.to_dict()}


@router.get("/sessions/{session_id}/folds")
async def list_folds(session_id: str):
    """列出折叠历史"""
    mgr = get_manager()
    folds = mgr.list_folds(session_id)
    return {
        "session_id": session_id,
        "count": len(folds),
        "folds": [f.to_dict() for f in folds],
    }


@router.post("/sessions/{session_id}/restore")
async def restore_fold(req: RestoreRequest):
    """恢复折叠"""
    mgr = get_manager()
    count = mgr.restore_fold(req.session_id, req.fold_id)
    if count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"未找到 fold_id={req.fold_id} 的消息",
        )
    return {"success": True, "restored_count": count}


@router.get("/sessions/{session_id}/stats")
async def get_stats(session_id: str):
    """获取 session 统计"""
    mgr = get_manager()
    return mgr.get_session_stats(session_id)


@router.put("/sessions/{session_id}/config")
async def update_config(req: ConfigRequest):
    """更新 session 配置"""
    mgr = get_manager()
    try:
        strategy = FoldStrategy(req.strategy)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的 strategy: {req.strategy}")
    config = FoldConfig(
        keep_recent=req.keep_recent,
        max_messages=req.max_messages,
        max_tokens=req.max_tokens,
        strategy=strategy,
        summary_max_tokens=req.summary_max_tokens,
        auto_fold=req.auto_fold,
    )
    mgr.set_config(req.session_id, config)
    return {"success": True, "config": config.to_dict()}


@router.get("/sessions")
async def list_sessions():
    """列出所有 session"""
    mgr = get_manager()
    sessions = mgr.list_sessions()
    return {
        "count": len(sessions),
        "sessions": sessions,
    }
