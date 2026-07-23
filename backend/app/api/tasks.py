"""
# ============================================================
# 任务管理 API
# ============================================================
# 核心作用：提供任务的创建、分配、状态查询、取消接口
# 运行流程：
#   - GET /api/tasks: 获取任务列表
#   - POST /api/tasks: 创建新任务
#   - GET /api/tasks/{id}: 获取任务详情
#   - PUT /api/tasks/{id}/status: 更新任务状态
#   - DELETE /api/tasks/{id}: 取消任务
# 输入参数：通过请求体和路径参数传递
# 输出结果：JSON 格式的任务信息
# ============================================================
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models import Task, TaskStatus, TaskPriority, ExecutionMode

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class TaskCreateRequest(BaseModel):
    """
    创建任务请求
    字段说明：
      - title: 任务标题
      - description: 任务描述
      - original_prompt: 用户原始需求
      - optimized_prompt: 优化后的提示词
      - priority: 优先级
      - agent_id: 指定分配的智能体 ID（可选）
      - parent_task_id: 父任务 ID（可选）
    """
    title: str = Field(..., min_length=1, max_length=256)
    description: str = Field(default="")
    original_prompt: str = Field(default="")
    optimized_prompt: str = Field(default="")
    priority: str = Field(default="medium")
    agent_id: Optional[str] = None
    parent_task_id: Optional[str] = None


class TaskResponse(BaseModel):
    """
    任务响应
    """
    id: str
    agent_id: Optional[str]
    parent_task_id: Optional[str]
    title: str
    description: str
    original_prompt: str
    optimized_prompt: str
    status: str
    priority: str
    execution_mode: str
    complexity_score: float
    iteration_count: int
    max_iterations: int
    result_summary: str
    error_message: str
    token_consumed: int
    api_calls: int
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]


class TaskStatusUpdateRequest(BaseModel):
    """任务状态更新请求"""
    status: str = Field(..., description="新状态")
    result_summary: str = Field(default="")
    error_message: str = Field(default="")
    token_consumed: int = Field(default=0)
    api_calls: int = Field(default=0)


def _task_to_response(task: Task) -> TaskResponse:
    """将 ORM 模型转换为响应对象"""
    return TaskResponse(
        id=task.id,
        agent_id=task.agent_id,
        parent_task_id=task.parent_task_id,
        title=task.title,
        description=task.description or "",
        original_prompt=task.original_prompt or "",
        optimized_prompt=task.optimized_prompt or "",
        status=task.status.value if task.status else "pending",
        priority=task.priority.value if task.priority else "medium",
        execution_mode=task.execution_mode.value if task.execution_mode else "direct",
        complexity_score=task.complexity_score or 0.0,
        iteration_count=task.iteration_count or 0,
        max_iterations=task.max_iterations or 5,
        result_summary=task.result_summary or "",
        error_message=task.error_message or "",
        token_consumed=task.token_consumed or 0,
        api_calls=task.api_calls or 0,
        created_at=task.created_at.isoformat() if task.created_at else "",
        started_at=task.started_at.isoformat() if task.started_at else None,
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
    )


# ============================================================
# API 端点
# ============================================================

@router.get("", response_model=List[TaskResponse])
async def list_tasks(
    request: Request,
    agent_id: Optional[str] = Query(None, description="按智能体筛选"),
    status: Optional[str] = Query(None, description="按状态筛选"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取任务列表
    调用方：前端聊天框、任务面板
    被调用方：数据库
    参数：
      - agent_id: 可选，按智能体筛选
      - status: 可选，按状态筛选
    返回值：任务列表
    """
    query = select(Task)
    if agent_id:
        query = query.where(Task.agent_id == agent_id)
    if status:
        try:
            status_enum = TaskStatus(status)
            query = query.where(Task.status == status_enum)
        except ValueError:
            logger.warning(f"list_tasks 收到非法 status 值: {status}")
            return []
    query = query.order_by(Task.created_at.desc()).limit(100)

    result = await db.execute(query)
    tasks = result.scalars().all()
    return [_task_to_response(t) for t in tasks]


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    request: Request,
    body: TaskCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    创建新任务
    运行步骤：
      1. 校验请求参数
      2. 创建 Task ORM 对象
      3. 持久化到数据库
      4. 返回任务信息
    调用方：前端需求输入界面
    被调用方：数据库
    参数：
      - body: TaskCreateRequest
    返回值：TaskResponse
    """
    task = Task(
        title=body.title,
        description=body.description,
        original_prompt=body.original_prompt,
        optimized_prompt=body.optimized_prompt,
        status=TaskStatus.PENDING,
        priority=TaskPriority(body.priority) if body.priority in [p.value for p in TaskPriority] else TaskPriority.MEDIUM,
        agent_id=body.agent_id,
        parent_task_id=body.parent_task_id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    logger.info(f"任务已创建: {task.title} (ID: {task.id[:8]}...)")
    return _task_to_response(task)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    request: Request,
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    获取任务详情
    调用方：前端聊天框展开视图
    被调用方：数据库
    参数：
      - task_id: 任务 ID
    返回值：TaskResponse
    """
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _task_to_response(task)


@router.put("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    request: Request,
    task_id: str,
    body: TaskStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    更新任务状态
    运行步骤：
      1. 查找任务
      2. 更新状态和相关字段
      3. 持久化
    调用方：任务执行引擎、验证引擎
    被调用方：数据库
    参数：
      - task_id: 任务 ID
      - body: TaskStatusUpdateRequest
    返回值：TaskResponse
    """
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 更新状态
    try:
        task.status = TaskStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的状态值: {body.status}")

    if body.result_summary:
        task.result_summary = body.result_summary
    if body.error_message:
        task.error_message = body.error_message
    if body.token_consumed:
        task.token_consumed = body.token_consumed
    if body.api_calls:
        task.api_calls = body.api_calls

    # 状态变更时更新时间戳
    if body.status == "running" and task.started_at is None:
        task.started_at = datetime.now(timezone.utc)
    elif body.status in ("completed", "failed", "cancelled"):
        task.completed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(task)

    logger.info(f"任务状态更新: {task.title} -> {body.status}")
    return _task_to_response(task)


@router.delete("/{task_id}")
async def cancel_task(
    request: Request,
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    取消任务
    调用方：前端任务面板
    被调用方：数据库
    参数：
      - task_id: 任务 ID
    返回值：操作结果
    """
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    task.status = TaskStatus.CANCELLED
    task.completed_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info(f"任务已取消: {task.title}")
    return {"message": "任务已取消", "task_id": task_id}
