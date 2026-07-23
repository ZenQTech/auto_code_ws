"""
# ============================================================
# 统计信息 API
# ============================================================
# 核心作用：提供 Token 消耗、API 调用次数、任务完成率等统计
# 运行流程：
#   - GET /api/stats/overview: 全局统计概览
#   - GET /api/stats/agents/{id}: 指定智能体统计
# 输入参数：通过路径参数传递
# 输出结果：JSON 格式的统计数据
# ============================================================
"""

import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models import Task, TaskStatus

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/overview")
async def get_overview_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取全局统计概览
    调用方：前端主界面
    被调用方：数据库、AgentManager
    返回值：全局统计数据
    """
    agent_manager = request.app.state.agent_manager
    agents = await agent_manager.get_all_agents()

    # 统计任务数量
    total_result = await db.execute(select(func.count(Task.id)))
    total_tasks = total_result.scalar() or 0

    completed_result = await db.execute(
        select(func.count(Task.id)).where(Task.status == TaskStatus.COMPLETED)
    )
    completed_tasks = completed_result.scalar() or 0

    failed_result = await db.execute(
        select(func.count(Task.id)).where(Task.status == TaskStatus.FAILED)
    )
    failed_tasks = failed_result.scalar() or 0

    running_result = await db.execute(
        select(func.count(Task.id)).where(Task.status == TaskStatus.RUNNING)
    )
    running_tasks = running_result.scalar() or 0

    # 汇总 Token 和 API 调用
    total_tokens = sum(a.total_tokens for a in agents)
    total_api_calls = sum(a.total_api_calls for a in agents)

    return {
        "agents": {
            "total": len(agents),
            "online": sum(1 for a in agents if (a.status.value if a.status else "unknown") == "online"),
            "busy": sum(1 for a in agents if (a.status.value if a.status else "unknown") == "busy"),
            "offline": sum(1 for a in agents if (a.status.value if a.status else "unknown") == "offline"),
        },
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "failed": failed_tasks,
            "running": running_tasks,
            "completion_rate": round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0,
        },
        "resources": {
            "total_tokens": total_tokens,
            "total_api_calls": total_api_calls,
        },
    }


@router.get("/agents/{agent_id}")
async def get_agent_stats(
    request: Request,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定智能体的统计信息
    调用方：前端聊天框
    被调用方：数据库、AgentManager
    参数：
      - agent_id: 智能体 ID
    返回值：智能体统计数据
    """
    agent_manager = request.app.state.agent_manager
    agent = await agent_manager.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="智能体不存在")

    # 统计该智能体的任务
    total_result = await db.execute(
        select(func.count(Task.id)).where(Task.agent_id == agent_id)
    )
    total_tasks = total_result.scalar() or 0

    completed_result = await db.execute(
        select(func.count(Task.id)).where(
            Task.agent_id == agent_id, Task.status == TaskStatus.COMPLETED
        )
    )
    completed_tasks = completed_result.scalar() or 0

    return {
        "agent_id": agent_id,
        "name": agent.name,
        "status": agent.status.value,
        "current_tasks": agent.current_tasks,
        "max_concurrent": agent.max_concurrent,
        "total_tokens": agent.total_tokens,
        "total_api_calls": agent.total_api_calls,
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "completion_rate": round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0,
        },
    }
