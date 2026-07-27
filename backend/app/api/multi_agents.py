"""
# ============================================================
# Multi-Agent v2 Path-Based REST API
# ============================================================
# 核心作用：暴露 MultiAgentRegistry 的 5 个工具 + 查询 API
# 设计要点：
#   1. /api/multi-agents/* 命名空间（区别于 /api/agents 单数）
#   2. 全部 POST 写操作走同一格式：{session_id, ...kwargs}
#   3. 错误码统一：400 业务 / 404 不存在 / 500 异常
# 运行流程：
#   客户端 → POST /api/multi-agents/spawn {session_id, parent_path, task_name, message}
#   服务端 → registry.spawn_agent(...) → 返回 {success, path, subagent_id, depth}
# 输入参数：通过 Request body JSON
# 输出结果：JSON 响应
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-10 初始化
#     - 实现 10 个端点（5 工具 + 5 查询）
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from ..services.multi_agent_registry import get_registry

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_registry(request: Request, session_id: str = "default"):
    """获取 registry（每个 session 独立）"""
    return get_registry(session_id)


# ============================================================
# 工具 1: spawn_agent
# ============================================================
@router.post("/multi-agents/spawn")
async def spawn_agent(request: Request, body: Dict[str, Any]):
    """
    spawn_agent
    请求：{session_id, parent_path, task_name, message, model?, sandbox?, metadata?}
    响应：{success, subagent_id, path, depth, status}
    """
    session_id = body.get("session_id", "default")
    parent_path = body.get("parent_path", "/root")
    task_name = body.get("task_name")
    message = body.get("message", "")
    model = body.get("model")
    sandbox = body.get("sandbox")
    metadata = body.get("metadata")

    if not task_name:
        raise HTTPException(status_code=400, detail="task_name 必填")
    if not message:
        raise HTTPException(status_code=400, detail="message 必填")

    reg = _get_registry(request, session_id)
    result = await reg.spawn_agent(
        parent_path=parent_path,
        task_name=task_name,
        message=message,
        model=model,
        sandbox=sandbox,
        metadata=metadata,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "spawn 失败"))
    return result


# ============================================================
# 工具 2: wait_agent
# ============================================================
@router.post("/multi-agents/wait")
async def wait_agent(request: Request, body: Dict[str, Any]):
    """
    wait_agent
    请求：{session_id, target, timeout?}
    响应：{success, path, status, result, error, duration_sec}
    """
    session_id = body.get("session_id", "default")
    target = body.get("target")
    timeout = body.get("timeout")

    if not target:
        raise HTTPException(status_code=400, detail="target 必填")

    reg = _get_registry(request, session_id)
    result = await reg.wait_agent(target=target, timeout=timeout)
    if not result.get("success") and "超时" not in result.get("error", ""):
        if "不存在" in result.get("error", ""):
            raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ============================================================
# 工具 3: close_agent
# ============================================================
@router.post("/multi-agents/close")
async def close_agent(request: Request, body: Dict[str, Any]):
    """
    close_agent
    请求：{session_id, target, recursive?}
    响应：{success, closed, paths}
    """
    session_id = body.get("session_id", "default")
    target = body.get("target")
    recursive = body.get("recursive", False)

    if not target:
        raise HTTPException(status_code=400, detail="target 必填")

    reg = _get_registry(request, session_id)
    result = await reg.close_agent(target=target, recursive=recursive)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ============================================================
# 工具 4: send_message
# ============================================================
@router.post("/multi-agents/send-message")
async def send_message(request: Request, body: Dict[str, Any]):
    """
    send_message
    请求：{session_id, from_path, to_path, body}
    响应：{success, msg_id, from_path, to_path, len}
    """
    session_id = body.get("session_id", "default")
    from_path = body.get("from_path")
    to_path = body.get("to_path")
    body_text = body.get("body", "")

    if not from_path:
        raise HTTPException(status_code=400, detail="from_path 必填")
    if not to_path:
        raise HTTPException(status_code=400, detail="to_path 必填")
    if not body_text:
        raise HTTPException(status_code=400, detail="body 必填")

    reg = _get_registry(request, session_id)
    result = await reg.send_message(
        from_path=from_path, to_path=to_path, body=body_text
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ============================================================
# 工具 5: followup_task
# ============================================================
@router.post("/multi-agents/followup")
async def followup_task(request: Request, body: Dict[str, Any]):
    """
    followup_task
    请求：{session_id, from_path, to_path, task}
    响应：{success, msg_id, to_path, reactivated}
    """
    session_id = body.get("session_id", "default")
    from_path = body.get("from_path")
    to_path = body.get("to_path")
    task = body.get("task", "")

    if not from_path or not to_path or not task:
        raise HTTPException(status_code=400, detail="from_path/to_path/task 必填")

    reg = _get_registry(request, session_id)
    result = await reg.followup_task(
        from_path=from_path, to_path=to_path, task=task
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ============================================================
# 内部：signal completion（用于模拟 SubAgent 完成）
# ============================================================
@router.post("/multi-agents/signal-completion")
async def signal_completion(request: Request, body: Dict[str, Any]):
    """
    标记 SubAgent 完成（测试 / 内部使用）
    请求：{session_id, target, result?, error?, status?}
    """
    session_id = body.get("session_id", "default")
    target = body.get("target")
    if not target:
        raise HTTPException(status_code=400, detail="target 必填")

    reg = _get_registry(request, session_id)
    result = reg.signal_completion(
        target=target,
        result=body.get("result"),
        error=body.get("error"),
        status=body.get("status"),
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ============================================================
# 查询 1: list_agents
# ============================================================
@router.get("/multi-agents/list")
async def list_agents(
    request: Request,
    session_id: str = Query("default"),
    parent: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """
    list_agents
    查询参数：?parent=/root&status=running
    """
    reg = _get_registry(request, session_id)
    nodes = reg.list_agents(parent_path=parent, status=status)
    return {
        "success": True,
        "session_id": session_id,
        "parent": parent,
        "status": status,
        "count": len(nodes),
        "nodes": nodes,
    }


# ============================================================
# 查询 2: get_tree
# ============================================================
@router.get("/multi-agents/tree")
async def get_tree(
    request: Request,
    session_id: str = Query("default"),
):
    """get_tree：返回完整树状结构"""
    reg = _get_registry(request, session_id)
    return {
        "success": True,
        "session_id": session_id,
        "tree": reg.get_tree(),
    }


# ============================================================
# 查询 3: get_stats
# ============================================================
@router.get("/multi-agents/stats")
async def get_stats(
    request: Request,
    session_id: str = Query("default"),
):
    """get_stats：注册表统计"""
    reg = _get_registry(request, session_id)
    return {
        "success": True,
        "session_id": session_id,
        "stats": reg.get_stats(),
    }


# ============================================================
# 查询 4: get_messages
# ============================================================
@router.get("/multi-agents/messages")
async def get_messages(
    request: Request,
    session_id: str = Query("default"),
    path: Optional[str] = Query(None),
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
):
    """get_messages"""
    reg = _get_registry(request, session_id)
    messages = reg.get_messages(path=path, unread_only=unread_only, limit=limit)
    return {
        "success": True,
        "session_id": session_id,
        "count": len(messages),
        "messages": messages,
    }


# ============================================================
# 查询 5: get_node
# ============================================================
@router.get("/multi-agents/node")
async def get_node(
    request: Request,
    path: str = Query(...),
    session_id: str = Query("default"),
):
    """get_node：获取单个节点"""
    reg = _get_registry(request, session_id)
    node = reg.get_node(path)
    if not node:
        raise HTTPException(status_code=404, detail=f"节点不存在: {path}")
    return {"success": True, "node": node}


# ============================================================
# 内部：auto cleanup
# ============================================================
@router.post("/multi-agents/auto-cleanup")
async def auto_cleanup(request: Request, body: Dict[str, Any]):
    """turn 结束自动清理（防止 slot 泄漏）"""
    session_id = body.get("session_id", "default")
    parent_path = body.get("parent_path", "/root")
    reg = _get_registry(request, session_id)
    result = await reg.auto_cleanup_on_turn(parent_path)
    return result


# ============================================================
# 管理：force delete
# ============================================================
@router.delete("/multi-agents/node")
async def force_delete_node(
    request: Request,
    path: str = Query(...),
    session_id: str = Query("default"),
    recursive: bool = Query(False),
):
    """force_delete：完全删除节点（区别于 close_agent）"""
    reg = _get_registry(request, session_id)
    result = await reg.force_delete(path=path, recursive=recursive)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ============================================================
# 管理：clear all
# ============================================================
@router.post("/multi-agents/clear-all")
async def clear_all(request: Request, body: Dict[str, Any]):
    """clear_all：清空所有非根节点（测试用）"""
    session_id = body.get("session_id", "default")
    reg = _get_registry(request, session_id)
    result = await reg.clear_all()
    return result
