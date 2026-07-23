"""
# ============================================================
# 会话（Session）管理 API
# ============================================================
# 核心作用：提供会话的 CRUD 接口与详情聚合查询，
#           支持前端左侧边栏的历史会话列表与切换、
#           软删除、批量删除、垃圾箱管理（恢复/清空）
# 运行流程：
#   - POST   /api/sessions                     创建新 Session
#   - GET    /api/sessions                     列出 Session（按 last_active_at 倒序，
#                                               支持 status 过滤，默认排除 DELETED）
#   - GET    /api/sessions/trash               获取垃圾箱列表（status=DELETED 的会话）
#   - POST   /api/sessions/batch-delete        批量软删除 Session
#   - POST   /api/sessions/trash/restore       从垃圾箱恢复会话
#   - DELETE /api/sessions/trash/empty         清空垃圾箱（硬删除所有 DELETED 会话）
#   - GET    /api/sessions/{id}                获取单个 Session 元数据
#   - GET    /api/sessions/{id}/detail         聚合详情（session + agents + tasks + conversations + messages）
#   - PATCH  /api/sessions/{id}                更新 title / status / last_active_at
#   - DELETE /api/sessions/{id}                软删除 Session（标记 status=DELETED + deleted_at）
# 输入参数：通过请求体和路径参数传递
# 输出结果：JSON 格式的会话信息
# 注意：固定路径端点（/trash、/batch-delete 等）必须在 /{session_id} 之前定义，
#       避免 FastAPI 将 "trash" 误匹配为 session_id
# 修改记录：
#   - 2026-06-23 | v1.0.0 | 初始版本：CRUD + 详情聚合
#   - 2026-06-23 | v1.2.0 | 撤销 POST /api/sessions/{id}/auto-title 端点
#   - 2026-06-24 | v2.0.0 | 新增软删除、批量删除、垃圾箱管理功能：
#                        DELETE 端点改为软删除；新增 batch-delete/trash/trash/restore/trash/empty 端点；
#                        list_sessions 默认过滤 DELETED 会话；
#                        修正路由顺序（固定路径在动态参数路径之前）
#   - 2026-06-30 | v2.1.0 | SessionResponse 新增 workflow_id / workflow_stage 字段，
#                        并在 _session_to_response 中序列化，供前端检测 clarifying 等工作流阶段
# ============================================================
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    Agent as AgentORM,
    Conversation as ConversationORM,
    Session as SessionORM,
    SessionStatus,
    Task as TaskORM,
)

# 复用其它 API 子模块的 Pydantic 响应模型与转换函数
from .conversations import ConversationResponse, _conv_to_response
from .tasks import TaskResponse, _task_to_response

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应 Pydantic 模型
# ============================================================

class SessionCreateRequest(BaseModel):
    """
    创建 Session 请求
    字段说明：
      - title: 可选，会话标题（缺省时取 user_first_message 前 30 字或 "新会话"）
      - user_first_message: 可选，首条用户消息全文（用于副标题 / 标题推断）
      - mode: 可选，会话模式（"chat" 闲聊 / "coding" 编程，默认 "chat"）
    """
    title: Optional[str] = Field(default=None, max_length=128, description="会话标题")
    user_first_message: Optional[str] = Field(default="", description="首条用户消息全文")
    mode: Optional[str] = Field(default="chat", description="会话模式：chat/coding")


class SessionUpdateRequest(BaseModel):
    """
    更新 Session 请求
    字段说明：所有字段均可选；不传则不更新
      - title: 标题
      - status: 状态
      - last_active_at: 最后活跃时间（ISO 字符串或 null）
    """
    title: Optional[str] = Field(default=None, max_length=128, description="会话标题")
    status: Optional[str] = Field(default=None, description="active / archived")
    last_active_at: Optional[datetime] = Field(default=None, description="最后活跃时间")


class SessionResponse(BaseModel):
    """
    Session 基础响应
    字段说明：
      - id: 会话唯一标识
      - title: 会话标题
      - created_at: 创建时间
      - last_active_at: 最后活跃时间
      - user_first_message: 首条用户消息全文
      - message_count: 消息条数
      - status: 当前状态（active/archived/deleted）
      - deleted_at: 软删除时间（仅 DELETED 状态时有值）
      - workflow_id: 关联的工作流 ID（仅 coding 模式触发 SOP 工作流后有值，否则为 None）
      - workflow_stage: 当前工作流阶段（如 clarifying，仅工作流进行中有值，否则为 None）
    """
    id: str
    title: str
    created_at: str
    last_active_at: str
    user_first_message: str
    message_count: int
    status: str
    deleted_at: Optional[str] = None
    mode: str = "chat"
    workflow_id: Optional[str] = None
    workflow_stage: Optional[str] = None


# ============================================================
# 批量操作请求/响应模型
# ============================================================

class SessionBatchRequest(BaseModel):
    """
    批量操作请求体
    字段说明：
      - session_ids: 需要操作的会话 ID 列表（非空，最多 200 个）
    """
    session_ids: List[str] = Field(
        default=...,
        min_length=1,
        max_length=200,
        description="需要操作的会话 ID 列表",
    )


class SessionBatchResponse(BaseModel):
    """
    批量操作响应体
    字段说明：
      - message: 操作结果描述
      - affected_count: 实际影响（已操作）的会话数量
      - session_ids: 已操作的会话 ID 列表
      - not_found: 未找到的会话 ID 列表
    """
    message: str
    affected_count: int
    session_ids: List[str] = Field(default_factory=list)
    not_found: List[str] = Field(default_factory=list)


class AgentResponse(BaseModel):
    """
    智能体响应（用于 Session 详情聚合）
    字段说明：
      - id / name / avatar_seed / status / cli_path / workspace
      - max_concurrent / total_tokens / total_api_calls / session_id
      - created_at / updated_at
    """
    id: str
    name: str
    avatar_seed: str
    status: str
    cli_path: str
    workspace: str
    max_concurrent: int
    total_tokens: int
    total_api_calls: int
    session_id: Optional[str] = None
    created_at: str
    updated_at: str


class SessionDetailResponse(BaseModel):
    """
    Session 详情聚合响应
    字段说明：
      - session: Session 元数据
      - messages: Hermes 主对话列表（user + assistant，按 created_at 升序）
      - agents: 该 Session 下所有 Agent
      - tasks: 该 Session 下所有 Task
      - conversations: 完整对话记录（含 user / assistant / system，按 created_at 升序）
    """
    session: SessionResponse
    messages: List[ConversationResponse] = Field(default_factory=list)
    agents: List[AgentResponse] = Field(default_factory=list)
    tasks: List[TaskResponse] = Field(default_factory=list)
    conversations: List[ConversationResponse] = Field(default_factory=list)


# ============================================================
# ORM → Response 转换函数
# ============================================================

def _agent_to_response(a: AgentORM) -> AgentResponse:
    """
    将 ORM Agent 模型转为响应对象
    参数：
      - a: AgentORM 实例
    返回值：AgentResponse
    """
    return AgentResponse(
        id=a.id,
        name=a.name or "",
        avatar_seed=a.avatar_seed or "",
        status=a.status.value if a.status else "offline",
        cli_path=a.cli_path or "",
        workspace=a.workspace or "",
        max_concurrent=a.max_concurrent or 5,
        total_tokens=a.total_tokens or 0,
        total_api_calls=a.total_api_calls or 0,
        session_id=a.session_id,
        created_at=a.created_at.isoformat() if a.created_at else "",
        updated_at=a.updated_at.isoformat() if a.updated_at else "",
    )


def _session_to_response(s: SessionORM) -> SessionResponse:
    """
    将 ORM Session 模型转为响应对象
    参数：
      - s: SessionORM 实例
    返回值：SessionResponse
    """
    return SessionResponse(
        id=s.id,
        title=s.title or "新会话",
        created_at=s.created_at.isoformat() if s.created_at else "",
        last_active_at=s.last_active_at.isoformat() if s.last_active_at else "",
        user_first_message=s.user_first_message or "",
        message_count=s.message_count or 0,
        status=s.status.value if s.status else "active",
        deleted_at=s.deleted_at.isoformat() if s.deleted_at else None,
        mode=s.mode or "chat",
        # v2.1.0：透传工作流关联字段，供前端检测 clarifying 等阶段并分流消息发送
        workflow_id=s.workflow_id,
        workflow_stage=s.workflow_stage,
    )


# ============================================================
# 辅助：标题推断
# ============================================================

def _infer_title(user_first_message: str, fallback: str = "新会话") -> str:
    """
    根据首条用户消息推断会话标题
    运行步骤：
      1. 若消息为空，使用 fallback
      2. 截取前 30 个字符作为标题
      3. 去除首尾空白与换行
    参数：
      - user_first_message: 首条用户消息全文
      - fallback: 消息为空时的默认标题
    返回值：推断的标题字符串
    """
    if not user_first_message or not user_first_message.strip():
        return fallback
    # 取首段（按换行 / 句号分割），避免以列表项开头
    first_segment = user_first_message.strip().split("\n", 1)[0]
    if len(first_segment) > 30:
        return first_segment[:30]
    return first_segment


# ============================================================
# 辅助：大驼峰/短横线 → Python snake_case 枚举值转换
# ============================================================

def _normalize_status_value(raw: str) -> str:
    """
    将前端传入的状态值转换为 Python 枚举所需的小写格式
    支持的输入格式：
      - 小写下划线: active, archived, deleted
      - 大驼峰: Active, Archived, Deleted
      - 短横线: in-progress → in_progress
    参数：
      - raw: 原始状态字符串
    返回值：标准化后的小写状态字符串
    """
    return raw.strip().lower().replace("-", "_")


# ============================================================
# API 端点：创建 & 列表
# ============================================================

@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(
    body: SessionCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    创建新 Session（自动清理同模式下已有的空会话）
    运行步骤：
      1. 解析 title：优先使用 body.title，否则从 user_first_message 截取前 30 字
      2. 解析 mode（chat/coding，默认 chat）
      3. 清理同模式下 message_count=0 的空会话（保留最多 1 个未使用的新对话）
      4. 创建 SessionORM 对象并写入数据库
      5. 返回 Session 元数据
    调用方：前端 App 启动 / 顶部"新建任务"按钮 / 模式切换
    被调用方：数据库
    参数：
      - body: SessionCreateRequest
    返回值：SessionResponse
    """
    title = body.title or _infer_title(body.user_first_message or "")
    mode = body.mode or "chat"
    if mode not in ("chat", "coding"):
        mode = "chat"

    # V4.4.1: 清理同模式下已有的空会话（message_count=0），确保每种模式最多 1 个未使用新对话
    empty_sessions = await db.execute(
        select(SessionORM).where(
            SessionORM.mode == mode,
            SessionORM.message_count == 0,
            SessionORM.status == SessionStatus.ACTIVE,
        )
    )
    empty_list = empty_sessions.scalars().all()
    for empty_s in empty_list:
        logger.info(f"清理空会话: {empty_s.title} (ID: {empty_s.id[:8]}...)")
        await db.delete(empty_s)
    if empty_list:
        await db.flush()

    session_obj = SessionORM(
        title=title,
        user_first_message=body.user_first_message or "",
        message_count=0,
        status=SessionStatus.ACTIVE,
        mode=mode,
    )
    db.add(session_obj)
    await db.commit()
    await db.refresh(session_obj)

    logger.info(f"Session 已创建: {session_obj.title} (ID: {session_obj.id[:8]}...)")
    return _session_to_response(session_obj)


@router.get("", response_model=List[SessionResponse])
async def list_sessions(
    status: Optional[str] = Query(default=None, description="按状态过滤: active / archived / deleted"),
    include_deleted: bool = Query(default=False, description="是否包含已删除的会话（默认不包含）"),
    mode: Optional[str] = Query(default=None, description="按模式过滤: chat / coding"),
    limit: int = Query(default=100, ge=1, le=500, description="返回数量限制"),
    db: AsyncSession = Depends(get_db),
):
    """
    列出所有 Session
    运行步骤：
      1. 按 status 过滤（可选）
      2. 默认排除 status=DELETED 的会话（除非 include_deleted=True 或 status=deleted）
      3. 按 last_active_at 倒序
      4. 限制返回条数（默认 100）
    调用方：前端左侧边栏
    被调用方：数据库
    参数：
      - status: 可选状态过滤
      - include_deleted: 是否包含已删除会话
      - limit: 返回数量限制
    返回值：SessionResponse 列表
    """
    query = select(SessionORM)

    if status:
        try:
            normalized = _normalize_status_value(status)
            status_enum = SessionStatus(normalized)
            query = query.where(SessionORM.status == status_enum)
        except ValueError:
            # 非法值不抛错，返回空列表以保持边栏可用
            logger.warning(f"list_sessions 收到非法 status 值: {status}")
            return []
    else:
        # 默认过滤：不显示已删除的会话（除非显式传入 include_deleted=True）
        if not include_deleted:
            query = query.where(SessionORM.status != SessionStatus.DELETED)

    # V4.4 新增：按模式过滤（chat / coding）
    if mode and mode in ("chat", "coding"):
        query = query.where(SessionORM.mode == mode)

    query = query.order_by(SessionORM.last_active_at.desc()).limit(limit)

    result = await db.execute(query)
    sessions = result.scalars().all()
    return [_session_to_response(s) for s in sessions]


# ============================================================
# API 端点：垃圾箱（Trash）—— 必须在 /{session_id} 之前定义
# 原因：FastAPI 按注册顺序匹配路由，若 /{session_id} 在前，
#       GET /api/sessions/trash 会被误匹配为 session_id="trash"
# ============================================================

@router.get("/trash", response_model=List[SessionResponse])
async def list_trash_sessions(
    limit: int = Query(default=100, ge=1, le=500, description="返回数量限制"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取垃圾箱中的会话列表
    运行步骤：
      1. 查询所有 status=DELETED 的 Session
      2. 按 deleted_at 倒序（最近删除的在前）
      3. 限制返回数量
    调用方：前端垃圾箱页面
    被调用方：数据库
    参数：
      - limit: 返回数量限制
    返回值：SessionResponse 列表（仅 status=DELETED）
    """
    query = (
        select(SessionORM)
        .where(SessionORM.status == SessionStatus.DELETED)
        .order_by(SessionORM.deleted_at.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    sessions = result.scalars().all()
    return [_session_to_response(s) for s in sessions]


@router.post("/batch-delete", response_model=SessionBatchResponse)
async def batch_delete_sessions(
    body: SessionBatchRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    批量软删除 Session
    运行步骤：
      1. 查询所有指定 ID 的 Session
      2. 对存在的 Session 标记 status=DELETED + deleted_at
      3. 记录未找到的 session_ids
      4. 提交数据库变更
    调用方：前端多选后批量删除
    被调用方：数据库
    参数：
      - body: SessionBatchRequest（含 session_ids 列表）
    返回值：SessionBatchResponse（含操作数量、成功/未找到的 ID）
    """
    session_ids = body.session_ids
    now = datetime.now(timezone.utc)

    # 一次查询所有指定 ID 的会话
    result = await db.execute(
        select(SessionORM).where(SessionORM.id.in_(session_ids))
    )
    found_sessions = {s.id: s for s in result.scalars().all()}

    affected_ids: List[str] = []
    not_found_ids: List[str] = []

    for sid in session_ids:
        session_obj = found_sessions.get(sid)
        if session_obj is None:
            not_found_ids.append(sid)
        else:
            # 标记软删除
            session_obj.status = SessionStatus.DELETED
            session_obj.deleted_at = now
            affected_ids.append(sid)

    await db.commit()

    if affected_ids:
        logger.info(
            "批量软删除完成: 成功 %d 个, 未找到 %d 个",
            len(affected_ids),
            len(not_found_ids),
        )

    return SessionBatchResponse(
        message=f"已将 {len(affected_ids)} 个会话移至垃圾箱",
        affected_count=len(affected_ids),
        session_ids=affected_ids,
        not_found=not_found_ids,
    )


@router.post("/trash/restore", response_model=SessionBatchResponse)
async def restore_trash_sessions(
    body: SessionBatchRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    从垃圾箱恢复会话（将 status 改回 ACTIVE，清空 deleted_at）
    运行步骤：
      1. 查询所有指定 ID 的 Session
      2. 仅恢复状态为 DELETED 的会话，忽略其他状态的会话
      3. 将 status 设为 ACTIVE，deleted_at 设为 None
      4. 提交数据库变更
    调用方：前端垃圾箱页面恢复按钮
    被调用方：数据库
    参数：
      - body: SessionBatchRequest（含 session_ids 列表）
    返回值：SessionBatchResponse（含操作数量、成功/未找到的 ID）
    """
    session_ids = body.session_ids

    result = await db.execute(
        select(SessionORM).where(SessionORM.id.in_(session_ids))
    )
    found_sessions = {s.id: s for s in result.scalars().all()}

    affected_ids: List[str] = []
    not_found_ids: List[str] = []

    for sid in session_ids:
        session_obj = found_sessions.get(sid)
        if session_obj is None:
            not_found_ids.append(sid)
        else:
            if session_obj.status == SessionStatus.DELETED:
                # 恢复：重置状态为 ACTIVE，清除软删除时间
                session_obj.status = SessionStatus.ACTIVE
                session_obj.deleted_at = None
                affected_ids.append(sid)
            # 非 DELETED 状态不操作

    await db.commit()

    if affected_ids:
        logger.info(
            "垃圾箱恢复完成: 成功 %d 个, 未找到/非已删除 %d 个",
            len(affected_ids),
            len(not_found_ids),
        )

    return SessionBatchResponse(
        message=f"已恢复 {len(affected_ids)} 个会话",
        affected_count=len(affected_ids),
        session_ids=affected_ids,
        not_found=not_found_ids,
    )


@router.delete("/trash/empty", response_model=SessionBatchResponse)
async def empty_trash(
    db: AsyncSession = Depends(get_db),
):
    """
    清空垃圾箱：硬删除所有 status=DELETED 的 Session 及其级联子记录
    运行步骤：
      1. 查询所有 status=DELETED 的 Session
      2. 对每个 Session 级联删除其 agents、tasks、conversations
      3. 硬删除 Session 本身
      4. 提交数据库变更
    调用方：前端垃圾箱页面"清空垃圾箱"按钮
    被调用方：数据库
    参数：无
    返回值：SessionBatchResponse（含删除数量）
    """
    # 查询所有已删除的会话
    result = await db.execute(
        select(SessionORM).where(SessionORM.status == SessionStatus.DELETED)
    )
    deleted_sessions = result.scalars().all()

    if not deleted_sessions:
        return SessionBatchResponse(
            message="垃圾箱已为空，无需清空",
            affected_count=0,
            session_ids=[],
            not_found=[],
        )

    affected_ids: List[str] = []

    for session_obj in deleted_sessions:
        session_id = session_obj.id
        affected_ids.append(session_id)

        # 级联删除关联子记录（因 session_id 为非外键字段，需手动删除）
        # 删除对话记录
        c_result = await db.execute(
            select(ConversationORM).where(ConversationORM.session_id == session_id)
        )
        for c in c_result.scalars().all():
            await db.delete(c)

        # 删除任务记录
        t_result = await db.execute(
            select(TaskORM).where(TaskORM.session_id == session_id)
        )
        for t in t_result.scalars().all():
            await db.delete(t)

        # 删除智能体记录
        a_result = await db.execute(
            select(AgentORM).where(AgentORM.session_id == session_id)
        )
        for a in a_result.scalars().all():
            await db.delete(a)

        # 硬删除 Session 本身
        await db.delete(session_obj)

    await db.commit()

    logger.info(
        "垃圾箱已清空: 硬删除 %d 个会话",
        len(affected_ids),
    )

    return SessionBatchResponse(
        message=f"已永久删除 {len(affected_ids)} 个会话",
        affected_count=len(affected_ids),
        session_ids=affected_ids,
        not_found=[],
    )


# ============================================================
# V4.4.1 新增：空会话清理（必须在 /{session_id} 之前定义，否则被参数化路由抢先匹配）
# ============================================================

@router.post("/cleanup-empty")
@router.delete("/cleanup-empty")
async def cleanup_empty_sessions(
    mode: Optional[str] = Query(default=None, description="指定模式：chat/coding，不传则清理所有模式"),
    db: AsyncSession = Depends(get_db),
):
    """
    清理空会话（message_count=0 且 status=ACTIVE）
    """
    query = select(SessionORM).where(
        SessionORM.message_count == 0,
        SessionORM.status == SessionStatus.ACTIVE,
    )
    if mode and mode in ("chat", "coding"):
        query = query.where(SessionORM.mode == mode)

    result = await db.execute(query)
    empty_sessions = result.scalars().all()
    cleaned_ids = []
    for s in empty_sessions:
        cleaned_ids.append(s.id)
        await db.delete(s)

    await db.commit()
    logger.info(f"空会话清理完成: 删除了 {len(cleaned_ids)} 个空会话")
    return {"cleaned_count": len(cleaned_ids), "cleaned_ids": cleaned_ids}


# ============================================================
# API 端点：单个 Session 操作（路径参数 /{session_id}）
# ============================================================

@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    获取单个 Session 元数据
    调用方：前端历史会话恢复
    被调用方：数据库
    参数：
      - session_id: 会话 ID
    返回值：SessionResponse
    """
    result = await db.execute(select(SessionORM).where(SessionORM.id == session_id))
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session 不存在")
    return _session_to_response(session_obj)


@router.get("/{session_id}/detail", response_model=SessionDetailResponse)
async def get_session_detail(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    获取 Session 详情聚合（session + messages + agents + tasks + conversations）
    运行步骤：
      1. 查询 Session 元数据
      2. 查询该 session_id 下的 agents / tasks / conversations
      3. messages 取 role in (user, assistant) 的对话
      4. 一次返回完整上下文
    调用方：前端切换会话时单次拉取
    被调用方：数据库
    参数：
      - session_id: 会话 ID
    返回值：SessionDetailResponse
    """
    # Session 元数据
    s_result = await db.execute(select(SessionORM).where(SessionORM.id == session_id))
    session_obj = s_result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session 不存在")

    # 智能体列表
    a_result = await db.execute(
        select(AgentORM)
        .where(AgentORM.session_id == session_id)
        .order_by(AgentORM.created_at.asc())
    )
    agents = a_result.scalars().all()

    # 任务列表
    t_result = await db.execute(
        select(TaskORM)
        .where(TaskORM.session_id == session_id)
        .order_by(TaskORM.created_at.asc())
    )
    tasks = t_result.scalars().all()

    # 完整对话列表
    c_result = await db.execute(
        select(ConversationORM)
        .where(ConversationORM.session_id == session_id)
        .order_by(ConversationORM.created_at.asc())
    )
    conversations = c_result.scalars().all()

    # Hermes 主对话（仅 user + assistant 角色）
    messages = [c for c in conversations if c.role in ("user", "assistant")]

    return SessionDetailResponse(
        session=_session_to_response(session_obj),
        messages=[_conv_to_response(c) for c in messages],
        agents=[_agent_to_response(a) for a in agents],
        tasks=[_task_to_response(t) for t in tasks],
        conversations=[_conv_to_response(c) for c in conversations],
    )


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    body: SessionUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    更新 Session（title / status / last_active_at）
    运行步骤：
      1. 查询 Session
      2. 按需更新字段
      3. 持久化
    调用方：前端重命名 / 归档 / 心跳
    被调用方：数据库
    参数：
      - session_id: 会话 ID
      - body: SessionUpdateRequest
    返回值：SessionResponse
    """
    result = await db.execute(select(SessionORM).where(SessionORM.id == session_id))
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session 不存在")

    if body.title is not None:
        session_obj.title = body.title
    if body.status is not None:
        try:
            normalized = _normalize_status_value(body.status)
            session_obj.status = SessionStatus(normalized)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效的状态值: {body.status}")
    if body.last_active_at is not None:
        session_obj.last_active_at = body.last_active_at

    await db.commit()
    await db.refresh(session_obj)

    logger.info(
        f"Session 已更新: id={session_id[:8]}... title={session_obj.title!r} status={session_obj.status.value}"
    )
    return _session_to_response(session_obj)


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    软删除 Session（标记为 status=DELETED + 记录 deleted_at）
    运行步骤：
      1. 查询 Session 是否存在
      2. 设置 status=DELETED 和 deleted_at=当前时间
      3. 提交数据库变更
    调用方：前端边栏删除按钮（二次确认后）
    被调用方：数据库
    参数：
      - session_id: 会话 ID
    返回值：操作结果（含会话 ID 与状态）
    """
    result = await db.execute(select(SessionORM).where(SessionORM.id == session_id))
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session 不存在")

    # 软删除：标记状态为 DELETED，记录删除时间
    session_obj.status = SessionStatus.DELETED
    session_obj.deleted_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session_obj)

    logger.info(
        f"Session 已软删除: id={session_id[:8]}... deleted_at={session_obj.deleted_at.isoformat()}"
    )
    return {
        "message": "Session 已移至垃圾箱",
        "session_id": session_id,
        "status": session_obj.status.value,
    }
