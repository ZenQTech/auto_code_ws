"""
# ============================================================
# 对话记录 API
# ============================================================
# 核心作用：提供历史对话记录的查询和上下文获取接口
# 运行流程：
#   - GET /api/conversations: 获取对话记录列表
#   - POST /api/conversations: 创建对话记录
#   - GET /api/conversations/{id}: 获取指定对话记录
# 输入参数：通过请求体和查询参数传递
# 输出结果：JSON 格式的对话记录
# ============================================================
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Conversation

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class ConversationCreateRequest(BaseModel):
    """
    创建对话记录请求
    字段说明：
      - task_id: 关联任务 ID
      - agent_id: 关联智能体 ID
      - role: 角色（user/assistant/system）
      - content: 对话内容
      - extra_data: 附加元数据
    """
    task_id: Optional[str] = None
    agent_id: Optional[str] = None
    role: str = Field(..., description="角色")
    content: str = Field(default="")
    extra_data: dict = Field(default_factory=dict, alias="metadata")


class ConversationResponse(BaseModel):
    """
    对话记录响应
    """
    model_config = {"populate_by_name": True}

    id: str
    task_id: Optional[str]
    agent_id: Optional[str]
    role: str
    content: str
    extra_data: dict = Field(default_factory=dict, alias="metadata")
    created_at: str


def _conv_to_response(conv: Conversation) -> ConversationResponse:
    """将 ORM 模型转换为响应对象"""
    return ConversationResponse(
        id=conv.id,
        task_id=conv.task_id,
        agent_id=conv.agent_id,
        role=conv.role,
        content=conv.content or "",
        extra_data=conv.extra_data or {},
        created_at=conv.created_at.isoformat() if conv.created_at else "",
    )


# ============================================================
# API 端点
# ============================================================

@router.get("", response_model=List[ConversationResponse])
async def list_conversations(
    request: Request,
    task_id: Optional[str] = Query(None, description="按任务筛选"),
    agent_id: Optional[str] = Query(None, description="按智能体筛选"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """
    获取对话记录列表
    调用方：前端聊天框展开视图
    被调用方：数据库
    参数：
      - task_id: 可选，按任务筛选
      - agent_id: 可选，按智能体筛选
      - limit: 返回数量限制
    返回值：对话记录列表
    """
    query = select(Conversation)
    if task_id:
        query = query.where(Conversation.task_id == task_id)
    if agent_id:
        query = query.where(Conversation.agent_id == agent_id)
    query = query.order_by(Conversation.created_at.asc()).limit(limit)

    result = await db.execute(query)
    conversations = result.scalars().all()
    return [_conv_to_response(c) for c in conversations]


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    request: Request,
    body: ConversationCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    创建对话记录
    调用方：任务执行引擎
    被调用方：数据库
    参数：
      - body: ConversationCreateRequest
    返回值：ConversationResponse
    """
    conv = Conversation(
        task_id=body.task_id,
        agent_id=body.agent_id,
        role=body.role,
        content=body.content,
        extra_data=body.extra_data,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return _conv_to_response(conv)


@router.get("/{conv_id}", response_model=ConversationResponse)
async def get_conversation(
    request: Request,
    conv_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定对话记录
    调用方：前端
    被调用方：数据库
    参数：
      - conv_id: 对话记录 ID
    返回值：ConversationResponse
    """
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=404, detail="对话记录不存在")
    return _conv_to_response(conv)
