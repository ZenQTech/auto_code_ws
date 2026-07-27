"""
# ============================================================
# SubAgent 记忆管理 API（v1.0.0）
# ============================================================
# 核心作用：提供 SubAgent 独立 context 存储与父→子记忆继承
#           的 REST API 端点，对应 TRAE Sub Agent 三大组件
#           中的"独立 Context"能力。
# 运行流程：
#   1. POST   /api/agents/{id}/memory/initialize
#      创建 SubAgent context（指定 parent_id、skill_set、output_dir）
#   2. POST   /api/agents/{id}/memory/inherit
#      从父 SubAgent 继承消息快照到子 SubAgent
#   3. POST   /api/agents/{id}/memory/append
#      向 SubAgent isolated_messages 追加一条记忆
#   4. GET    /api/agents/{id}/memory?include_parent=true
#      获取 SubAgent 完整消息（parent + isolated）
#   5. DELETE /api/agents/{id}/memory
#      清空 SubAgent isolated_messages
#   6. GET    /api/agents/memory/list
#      列出所有 SubAgent context
#   7. GET    /api/agents/memory/summary
#      获取整体统计摘要
# 输入参数：路径参数 + JSON body
# 输出结果：JSON 格式的 SubAgent context / 消息列表 / 统计
# 修改记录：
#   - 2026-07-27 | v1.0.0 | P0-4 SubAgent Memory Inheritance 新建
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.subagent_memory import (
    SubAgentContext,
    SubAgentMemoryEntry,
    get_subagent_memory_store,
    make_memory_entry,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# Pydantic 模型
# ============================================================
class InitializeRequest(BaseModel):
    """POST /initialize 请求体"""
    name: str = Field(..., description="SubAgent 名称，如模块名")
    parent_id: Optional[str] = Field(default=None, description="父 SubAgent ID（根节点为 None）")
    skill_set: List[str] = Field(default_factory=list, description="SubAgent 专有技能集")
    output_dir: str = Field(default="", description="输出隔离目录")
    isolated: bool = Field(default=True, description="是否完全隔离（True=独立，False=只读继承）")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="附加元数据")


class InheritRequest(BaseModel):
    """POST /inherit 请求体"""
    parent_id: str = Field(..., description="父 SubAgent ID")


class AppendRequest(BaseModel):
    """POST /append 请求体"""
    role: str = Field(..., description="角色：user / assistant / system / tool / event")
    content: str = Field(..., description="内容")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="附加元数据")


# ============================================================
# API 端点
# ============================================================
@router.post("/{agent_id}/memory/initialize", response_model=Dict[str, Any])
async def initialize_subagent_memory(agent_id: str, req: InitializeRequest):
    """
    初始化 SubAgent 独立 context
    步骤：
      1. 构造 SubAgentContext
      2. 注册到全局 store
      3. 若指定 parent_id：自动尝试从父继承（若父已存在）
      4. 返回 context 字典
    """
    store = get_subagent_memory_store()
    ctx = SubAgentContext(
        subagent_id=agent_id,
        name=req.name,
        parent_id=req.parent_id,
        skill_set=list(req.skill_set),
        output_dir=req.output_dir,
        isolated=req.isolated,
        metadata=dict(req.metadata),
    )
    await store.create(ctx)

    # 若指定 parent_id 且父已存在：自动继承父消息快照
    auto_inherit_msg = None
    if req.parent_id:
        parent = await store.get(req.parent_id)
        if parent is not None:
            parent_messages = await store.get_messages(req.parent_id, include_parent=True)
            ok = await store.inherit_from_parent(agent_id, req.parent_id, parent_messages)
            auto_inherit_msg = (
                f"已自动从父 {req.parent_id} 继承 {len(parent_messages)} 条记忆"
                if ok
                else "自动继承失败"
            )
        else:
            auto_inherit_msg = f"父 {req.parent_id} 暂未注册，暂未继承"

    return {
        "success": True,
        "subagent_id": agent_id,
        "context": ctx.to_dict(),
        "auto_inherit": auto_inherit_msg,
    }


@router.post("/{agent_id}/memory/inherit", response_model=Dict[str, Any])
async def inherit_parent_memory(agent_id: str, req: InheritRequest):
    """
    从父 SubAgent 继承消息快照
    步骤：
      1. 获取子 SubAgent context
      2. 获取父 SubAgent 完整消息
      3. 将父消息深拷贝到子 parent_context_snapshot
    """
    store = get_subagent_memory_store()
    child = await store.get(agent_id)
    if child is None:
        raise HTTPException(status_code=404, detail=f"子 SubAgent {agent_id} 不存在")
    parent = await store.get(req.parent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail=f"父 SubAgent {req.parent_id} 不存在")
    parent_messages = await store.get_messages(req.parent_id, include_parent=True)
    ok = await store.inherit_from_parent(agent_id, req.parent_id, parent_messages)
    if not ok:
        raise HTTPException(status_code=500, detail="继承失败")
    # 重新获取最新 context
    child = await store.get(agent_id)
    return {
        "success": True,
        "subagent_id": agent_id,
        "parent_id": req.parent_id,
        "inherited_count": len(parent_messages),
        "context": child.to_dict() if child else None,
    }


@router.post("/{agent_id}/memory/append", response_model=Dict[str, Any])
async def append_memory(agent_id: str, req: AppendRequest):
    """
    向 SubAgent isolated_messages 追加一条记忆
    """
    store = get_subagent_memory_store()
    if await store.get(agent_id) is None:
        raise HTTPException(status_code=404, detail=f"SubAgent {agent_id} 不存在")
    entry = make_memory_entry(
        role=req.role,
        content=req.content,
        metadata=req.metadata,
    )
    ok = await store.append(agent_id, entry)
    if not ok:
        raise HTTPException(status_code=500, detail="追加失败")
    return {
        "success": True,
        "subagent_id": agent_id,
        "entry": entry.to_dict(),
    }


@router.get("/{agent_id}/memory", response_model=Dict[str, Any])
async def get_memory(
    agent_id: str,
    include_parent: bool = Query(default=True, description="是否包含父继承消息"),
    limit: int = Query(default=200, ge=1, le=2000, description="最大返回条数"),
):
    """
    获取 SubAgent 完整消息列表
    """
    store = get_subagent_memory_store()
    ctx = await store.get(agent_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail=f"SubAgent {agent_id} 不存在")
    messages = await store.get_messages(agent_id, include_parent=include_parent)
    if len(messages) > limit:
        messages = messages[-limit:]
    return {
        "subagent_id": agent_id,
        "context": ctx.to_dict(),
        "include_parent": include_parent,
        "count": len(messages),
        "messages": [m.to_dict() for m in messages],
    }


@router.delete("/{agent_id}/memory", response_model=Dict[str, Any])
async def clear_memory(agent_id: str):
    """
    清空 SubAgent isolated_messages（保留 parent_context_snapshot）
    """
    store = get_subagent_memory_store()
    ok = await store.clear(agent_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"SubAgent {agent_id} 不存在")
    return {
        "success": True,
        "subagent_id": agent_id,
        "message": "isolated_messages 已清空，parent_context_snapshot 保留",
    }


@router.get("/memory/list", response_model=Dict[str, Any])
async def list_subagents():
    """
    列出所有 SubAgent context
    """
    store = get_subagent_memory_store()
    items = await store.list_subagents()
    return {
        "count": len(items),
        "subagents": [c.to_dict() for c in items],
    }


@router.get("/memory/summary", response_model=Dict[str, Any])
async def get_memory_summary():
    """
    获取整体统计摘要
    """
    store = get_subagent_memory_store()
    return await store.get_summary()
