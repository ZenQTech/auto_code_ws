"""
# ============================================================
# 长会话压缩 (Compaction) API 路由
# ============================================================
# 核心作用：暴露压缩功能的 REST API
# 端点：
#   - POST   /api/sessions/{id}/compact     手动触发压缩
#   - GET    /api/sessions/{id}/tokens      查询 token 数
#   - GET    /api/compaction/config         获取压缩配置
#   - PUT    /api/compaction/config         更新压缩配置
#   - GET    /api/sessions/{id}/should-compact  检查是否应触发压缩
#   - POST   /api/compaction/dual/pre-turn  Pre-turn 触发压缩（Cycle 3）
#   - POST   /api/compaction/dual/mid-turn  Mid-turn 触发压缩（Cycle 3）
#   - GET    /api/compaction/dual/config    双触发配置（Cycle 3）
#   - PUT    /api/compaction/dual/config    更新双触发配置（Cycle 3）
#   - GET    /api/compaction/dual/history   压缩历史（Cycle 3）
# ============================================================
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()


def get_compaction_service(request: Request):
    """
    从 app.state 获取 CompactionService
    失败时返回 503
    """
    svc = getattr(request.app.state, "compaction_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="CompactionService 未初始化")
    return svc


def get_dual_compactor(request: Request):
    """
    获取 DualTriggerCompactor
    Cycle 3 v1.0.0: 双触发压缩器
    """
    compactor = getattr(request.app.state, "dual_compactor", None)
    if compactor is None:
        # 延迟初始化（绑定 base compactor）
        try:
            from backend.app.services.compaction_dual import get_dual_compactor
            base = get_compaction_service(request)
            compactor = get_dual_compactor(base_compactor=base)
            request.app.state.dual_compactor = compactor
        except Exception as e:
            logger.error(f"Dual compactor 初始化失败: {e}")
            raise HTTPException(status_code=503, detail=f"Dual compactor 初始化失败: {e}")
    return compactor


@router.post("/sessions/{session_id}/compact")
async def compact_session(
    session_id: str,
    request: Request,
    body: Optional[Dict[str, Any]] = None,
):
    """
    手动触发压缩
    请求体：{"strategy": "hybrid", "keep_recent": 10}
    """
    svc = get_compaction_service(request)
    body = body or {}
    strategy = body.get("strategy")
    keep_recent = body.get("keep_recent")

    result = await svc.compact(
        session_id=session_id,
        strategy=strategy,
        keep_recent=keep_recent,
    )
    return {"success": result.get("success", False), **result}


@router.get("/sessions/{session_id}/tokens")
async def get_session_tokens(session_id: str, request: Request):
    """
    查询会话当前 token 数
    """
    svc = get_compaction_service(request)
    stats = await svc.get_session_stats(session_id)
    return {
        "success": True,
        "session_id": session_id,
        "token_count": stats.get("token_count", 0),
        "message_count": stats.get("message_count", 0),
        "active_count": stats.get("active_count", 0),
        "compacted_count": stats.get("compacted_count", 0),
    }


@router.get("/sessions/{session_id}/should-compact")
async def should_compact(session_id: str, request: Request):
    """
    检查会话是否应触发压缩
    """
    svc = get_compaction_service(request)
    should, stats = await svc.should_trigger(session_id)
    return {
        "success": True,
        "should_compact": should,
        "stats": stats,
        "config": svc.get_config(),
    }


@router.get("/compaction/config")
async def get_compaction_config(request: Request):
    """
    获取压缩配置
    """
    svc = get_compaction_service(request)
    return {"success": True, "config": svc.get_config()}


@router.put("/compaction/config")
async def update_compaction_config(request: Request, body: Dict[str, Any]):
    """
    更新压缩配置
    """
    svc = get_compaction_service(request)
    config = svc.update_config(body)
    return {"success": True, "config": config}


# ============================================================
# Cycle 3 v1.0.0: 双触发压缩 API
# ============================================================

@router.post("/compaction/dual/pre-turn")
async def pre_turn_compact(request: Request, body: Dict[str, Any]):
    """
    Cycle 3 v1.0.0: Pre-turn 触发压缩
    在用户消息发送前自动执行，用户无感
    请求体：
      {
        "session_id": "...",
        "messages": [...],
        "path": "local" | "remote",  // 可选
        "strategy": "hybrid" | "sliding" | "summary"  // 可选
      }
    """
    compactor = get_dual_compactor(request)
    session_id = body.get("session_id")
    messages = body.get("messages", [])
    path = body.get("path", "local")
    strategy = body.get("strategy", "hybrid")

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id 不能为空")
    if not messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    # 检查触发条件
    base = get_compaction_service(request)
    current_tokens = base.token_counter.count_messages(messages) if hasattr(base, "token_counter") else 0
    should, reason = await compactor.check_pre_turn_trigger(session_id, current_tokens)
    if not should:
        return {
            "success": False,
            "triggered": False,
            "reason": reason,
            "current_tokens": current_tokens,
        }

    result = await compactor.execute_pre_turn(
        session_id=session_id,
        messages=messages,
        path=path,
        strategy=strategy,
    )
    return {"success": True, "triggered": True, **result}


@router.post("/compaction/dual/mid-turn")
async def mid_turn_compact(request: Request, body: Dict[str, Any]):
    """
    Cycle 3 v1.0.0: Mid-turn 触发压缩
    在长工具链循环边界执行，保留并回放 pending user request
    请求体：
      {
        "session_id": "...",
        "messages": [...],
        "pending_request": {...},  // 可选
        "path": "local" | "remote",
        "strategy": "hybrid" | "sliding" | "summary"
      }
    """
    compactor = get_dual_compactor(request)
    session_id = body.get("session_id")
    messages = body.get("messages", [])
    pending_request = body.get("pending_request")
    path = body.get("path", "local")
    strategy = body.get("strategy", "hybrid")

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id 不能为空")
    if not messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    result = await compactor.execute_mid_turn(
        session_id=session_id,
        messages=messages,
        pending_request=pending_request,
        path=path,
        strategy=strategy,
    )
    return {"success": True, **result}


@router.get("/compaction/dual/config")
async def get_dual_compaction_config(request: Request):
    """
    Cycle 3 v1.0.0: 获取双触发压缩配置
    """
    compactor = get_dual_compactor(request)
    return {"success": True, "config": compactor.get_config()}


@router.put("/compaction/dual/config")
async def update_dual_compaction_config(request: Request, body: Dict[str, Any]):
    """
    Cycle 3 v1.0.0: 更新双触发压缩配置
    """
    compactor = get_dual_compactor(request)
    config = compactor.update_config(body)
    return {"success": True, "config": config}


@router.get("/compaction/dual/history")
async def get_dual_compaction_history(
    request: Request,
    session_id: str,
    limit: int = 50,
):
    """
    Cycle 3 v1.0.0: 获取双触发压缩历史
    """
    compactor = get_dual_compactor(request)
    history = compactor.get_history(session_id, limit=limit)
    return {
        "success": True,
        "session_id": session_id,
        "history": history,
        "count": len(history),
    }
