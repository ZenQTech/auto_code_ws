"""
# ============================================================
# Session Rollout API 路由
# ============================================================
# 核心作用：暴露 session rollout JSONL 持久化功能的 REST API
# 端点：
#   - GET    /api/sessions/{id}/rollout         分页查询 rollout
#   - GET    /api/sessions/{id}/rollout/info    获取 rollout 状态
#   - GET    /api/sessions/{id}/rollout/turn/{turn_id}  查询 turn 周围内容
#   - POST   /api/sessions/{id}/fork-turn       基于 beforeTurnId 分叉（v0.145.0）
#   - GET    /api/sessions/{id}/export          导出 JSONL
#   - POST   /api/sessions/{id}/import          导入 JSONL
#   - DELETE /api/sessions/{id}/rollout         删除 rollout 文件
#   - POST   /api/sessions/{id}/rollout/turn    记录用户 turn（便捷端点）
#   - POST   /api/sessions/{id}/rollout/response 记录 AI response（便捷端点）
# ============================================================
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)
router = APIRouter()


def get_rollout_service(request: Request):
    """从 app.state 获取 SessionRolloutService"""
    svc = getattr(request.app.state, "session_rollout_service", None)
    if svc is None:
        raise HTTPException(
            status_code=503,
            detail="SessionRolloutService 未初始化",
        )
    return svc


# ============================================================
# 读取类端点
# ============================================================
@router.get("/sessions/{session_id}/rollout")
async def get_rollout(
    session_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    分页查询 rollout JSONL items
    """
    svc = get_rollout_service(request)
    return svc.paginate_history(
        session_id=session_id,
        limit=limit,
        offset=offset,
    )


@router.get("/sessions/{session_id}/rollout/info")
async def get_rollout_info(session_id: str, request: Request):
    """获取 rollout 状态信息（大小、压缩、item 统计）"""
    svc = get_rollout_service(request)
    return svc.get_rollout_info(session_id)


@router.get("/sessions/{session_id}/rollout/turn/{turn_id}")
async def get_turn_context(
    session_id: str,
    turn_id: str,
    request: Request,
    context_before: int = Query(5, ge=0, le=50),
    context_after: int = Query(5, ge=0, le=50),
):
    """获取指定 turn 周围的上下文"""
    svc = get_rollout_service(request)
    return svc.get_turn_context(
        session_id=session_id,
        turn_id=turn_id,
        context_before=context_before,
        context_after=context_after,
    )


# ============================================================
# Fork 端点
# ============================================================
@router.post("/sessions/{session_id}/fork-turn")
async def fork_at_turn(
    session_id: str,
    request: Request,
    body: Dict[str, Any],
):
    """
    基于 beforeTurnId 分叉会话（Codex v0.145.0 API）
    请求体：{"before_turn_id": "turn-xxx", "title": "新标题"}
    """
    svc = get_rollout_service(request)
    before_turn_id = body.get("before_turn_id")
    if not before_turn_id:
        raise HTTPException(
            status_code=400,
            detail="before_turn_id 必填",
        )
    result = await svc.fork_at_turn(
        source_session_id=session_id,
        before_turn_id=before_turn_id,
        title=body.get("title"),
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Fork 失败"))
    return result


# ============================================================
# 导出/导入
# ============================================================
@router.get("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    request: Request,
    compressed: bool = Query(False),
):
    """
    导出会话为 JSONL
    - compressed=false: 返回 text/plain 原始 JSONL
    - compressed=true:  返回 base64 编码的 zstd 压缩数据
    """
    svc = get_rollout_service(request)
    result = svc.export_session(session_id=session_id, compressed=compressed)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "导出失败"))
    return result


@router.post("/sessions/{session_id}/import")
async def import_session(
    session_id: str,
    request: Request,
    body: Dict[str, Any],
):
    """
    导入 JSONL 到新会话
    请求体：{"content": "JSONL文本", "compressed": false}
    """
    svc = get_rollout_service(request)
    content = body.get("content")
    if not content:
        raise HTTPException(status_code=400, detail="content 必填")
    compressed = body.get("compressed", False)
    result = svc.import_session(
        session_id=session_id,
        content=content,
        compressed=compressed,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "导入失败"))
    return result


# ============================================================
# 删除
# ============================================================
@router.delete("/sessions/{session_id}/rollout")
async def delete_rollout(session_id: str, request: Request):
    """删除会话的 rollout 文件"""
    svc = get_rollout_service(request)
    return svc.delete_rollout(session_id)


# ============================================================
# 写入便捷端点（用于测试和手动集成）
# ============================================================
@router.post("/sessions/{session_id}/rollout/turn")
async def record_turn(
    session_id: str,
    request: Request,
    body: Dict[str, Any],
):
    """记录用户 turn（创建 turn_context + user_message 事件）"""
    svc = get_rollout_service(request)
    user_prompt = body.get("user_prompt")
    if not user_prompt:
        raise HTTPException(status_code=400, detail="user_prompt 必填")
    turn_id, item = await svc.record_turn(
        session_id=session_id,
        user_prompt=user_prompt,
        sandbox=body.get("sandbox", "workspace-write"),
        approval_policy=body.get("approval_policy", "on-failure"),
    )
    return {
        "success": True,
        "turn_id": turn_id,
        "item": item.to_dict() | {"line_no": item.line_no},
    }


@router.post("/sessions/{session_id}/rollout/response")
async def record_response(
    session_id: str,
    request: Request,
    body: Dict[str, Any],
):
    """记录 AI response item"""
    svc = get_rollout_service(request)
    item_type = body.get("item_type", "text")
    turn_id = body.get("turn_id")
    if item_type == "text":
        item = await svc.record_response_text(
            session_id=session_id,
            text=body.get("text", ""),
            turn_id=turn_id,
        )
    elif item_type == "function_call":
        item = await svc.record_response_function_call(
            session_id=session_id,
            name=body.get("name", ""),
            arguments=body.get("arguments", ""),
            call_id=body.get("call_id", ""),
            turn_id=turn_id,
        )
    elif item_type == "function_call_output":
        item = await svc.record_response_function_output(
            session_id=session_id,
            call_id=body.get("call_id", ""),
            output=body.get("output", ""),
            turn_id=turn_id,
        )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的 item_type: {item_type}",
        )
    return {
        "success": True,
        "item": item.to_dict() | {"line_no": item.line_no},
    }
