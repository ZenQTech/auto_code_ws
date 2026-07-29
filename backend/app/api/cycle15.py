"""
# ============================================================
# Cycle 15 - Goal Sync / Scheduler / Cost API
# ============================================================
# 核心作用：暴露 Cycle 15 P0-1/P0-2/P1-2 三大新模块的 REST API
# 端点：
#   - /api/cycle15/goal-sync/*   (8 端点)
#   - /api/cycle15/scheduler/*   (10 端点)
#   - /api/cycle15/llm-cost/*    (10 端点)
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Cycle 15 新建
# ============================================================
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.goal_sync import (
    ConflictResolution,
    GoalSyncEngine,
    SyncDirection,
    get_sync,
    reset_sync,
)
from ..core.goal_scheduler import (
    GoalPriority,
    GoalScheduler,
    PRIORITY_VALUE,
    ResourceQuota,
    SchedulingPolicy,
    get_scheduler,
    reset_scheduler,
)
from ..core.llm_cost import (
    AlertLevel,
    CostBudget,
    CostDimension,
    LLMCallRecord,
    LLMCostTracker,
    get_tracker,
    reset_tracker,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cycle15", tags=["cycle15"])


# ============================================================
# 请求/响应模型
# ============================================================
class SyncRequest(BaseModel):
    goal_id: str
    ac_id: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    direction: str = SyncDirection.ENGINE_TO_MANAGER.value


class QuotaRequest(BaseModel):
    goal_id: str
    max_tokens: int = 100000
    max_turns: int = 1000
    max_concurrent: int = 1
    priority: str = GoalPriority.NORMAL.value
    weight: float = 1.0
    soft_limit: float = 0.8


class CostRecordRequest(BaseModel):
    user_id: str = "anonymous"
    project_id: str = "default"
    agent_id: str = ""
    model: str = ""
    route: str = ""
    feature: str = ""
    goal_id: str = ""
    run_id: str = ""
    tokens_input_cache_miss: int = 0
    tokens_input_cache_read: int = 0
    tokens_input_cache_write: int = 0
    tokens_output: int = 0
    tokens_reasoning: int = 0
    tokens_tool: int = 0
    tokens_image: int = 0
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0
    cost_per_1k_reasoning: float = 0.0
    cost_per_1k_tool: float = 0.0
    cost_per_1k_image: float = 0.0
    latency_ms: int = 0
    success: bool = True
    error: str = ""


class BudgetRequest(BaseModel):
    dimension: str
    dimension_value: str
    soft_limit_usd: float = 100.0
    hard_limit_usd: float = 200.0
    period: str = "monthly"
    enabled: bool = True


# ============================================================
# Goal Sync 端点
# ============================================================
@router.get("/goal-sync/health")
async def goal_sync_health() -> Dict[str, Any]:
    """Goal Sync 健康检查"""
    return {
        "success": True,
        "module": "goal_sync",
        "status": "ok",
        "version": "1.0.0",
    }


@router.get("/goal-sync/stats")
async def goal_sync_stats() -> Dict[str, Any]:
    """Goal Sync 统计信息"""
    sync = get_sync()
    return sync.get_stats()


@router.post("/goal-sync/sync")
async def sync_state(req: SyncRequest) -> Dict[str, Any]:
    """触发同步"""
    sync = get_sync()
    if req.direction == SyncDirection.ENGINE_TO_MANAGER.value:
        evt = sync.sync_engine_to_manager(
            goal_id=req.goal_id,
            ac_id=req.ac_id,
            old_value=req.old_value,
            new_value=req.new_value,
        )
    elif req.direction == SyncDirection.MANAGER_TO_ENGINE.value:
        evt = sync.sync_manager_to_engine(
            goal_id=req.goal_id,
            ac_id=req.ac_id,
            old_value=req.old_value,
            new_value=req.new_value,
        )
    else:
        raise HTTPException(status_code=400, detail=f"invalid direction: {req.direction}")
    return {
        "success": True,
        "event": evt.to_dict(),
    }


@router.get("/goal-sync/events")
async def list_sync_events(
    goal_id: Optional[str] = None,
    direction: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """查询同步事件"""
    sync = get_sync()
    events = sync.get_events(goal_id=goal_id, direction=direction, status=status, limit=limit)
    return {
        "success": True,
        "events": [e.to_dict() for e in events],
        "count": len(events),
    }


@router.get("/goal-sync/version/{goal_id}")
async def get_goal_version(goal_id: str) -> Dict[str, Any]:
    """获取 Goal 版本号"""
    sync = get_sync()
    return {
        "success": True,
        "goal_id": goal_id,
        "version": sync.get_version(goal_id),
    }


@router.get("/goal-sync/ac-version/{goal_id}/{ac_id}")
async def get_ac_version(goal_id: str, ac_id: str) -> Dict[str, Any]:
    """获取 AC 版本号"""
    sync = get_sync()
    return {
        "success": True,
        "goal_id": goal_id,
        "ac_id": ac_id,
        "version": sync.get_ac_version(goal_id, ac_id),
    }


@router.post("/goal-sync/clear")
async def clear_sync_events() -> Dict[str, Any]:
    """清空同步事件"""
    sync = get_sync()
    count = sync.clear_events()
    return {
        "success": True,
        "cleared": count,
    }


@router.get("/goal-sync/strategies")
async def list_conflict_strategies() -> Dict[str, Any]:
    """列出冲突解决策略"""
    return {
        "success": True,
        "strategies": [s.value for s in ConflictResolution],
    }


# ============================================================
# Scheduler 端点
# ============================================================
@router.get("/scheduler/health")
async def scheduler_health() -> Dict[str, Any]:
    """Scheduler 健康检查"""
    return {
        "success": True,
        "module": "goal_scheduler",
        "status": "ok",
        "version": "1.0.0",
    }


@router.get("/scheduler/stats")
async def scheduler_stats() -> Dict[str, Any]:
    """Scheduler 统计信息"""
    scheduler = get_scheduler()
    return scheduler.get_stats()


@router.post("/scheduler/quota")
async def register_quota(req: QuotaRequest) -> Dict[str, Any]:
    """注册资源配额"""
    scheduler = get_scheduler()
    quota = ResourceQuota(
        goal_id=req.goal_id,
        max_tokens=req.max_tokens,
        max_turns=req.max_turns,
        max_concurrent=req.max_concurrent,
        priority=req.priority,
        weight=req.weight,
        soft_limit=req.soft_limit,
    )
    saved = scheduler.register_quota(quota)
    return {
        "success": True,
        "quota": saved.to_dict(),
    }


@router.get("/scheduler/quotas")
async def list_quotas() -> Dict[str, Any]:
    """列出所有配额"""
    scheduler = get_scheduler()
    quotas = scheduler.list_quotas()
    return {
        "success": True,
        "quotas": [q.to_dict() for q in quotas],
        "count": len(quotas),
    }


@router.get("/scheduler/quota/{goal_id}")
async def get_quota(goal_id: str) -> Dict[str, Any]:
    """获取单个配额"""
    scheduler = get_scheduler()
    quota = scheduler.get_quota(goal_id)
    if quota is None:
        raise HTTPException(status_code=404, detail=f"quota not found: {goal_id}")
    return {
        "success": True,
        "quota": quota.to_dict(),
    }


@router.delete("/scheduler/quota/{goal_id}")
async def delete_quota(goal_id: str) -> Dict[str, Any]:
    """注销配额"""
    scheduler = get_scheduler()
    ok = scheduler.unregister_quota(goal_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"quota not found: {goal_id}")
    return {
        "success": True,
        "goal_id": goal_id,
    }


@router.post("/scheduler/schedule/{goal_id}")
async def request_schedule(goal_id: str) -> Dict[str, Any]:
    """请求调度决策"""
    scheduler = get_scheduler()
    decision = scheduler.request_schedule(goal_id)
    return {
        "success": True,
        "decision": decision.to_dict(),
    }


@router.get("/scheduler/queue")
async def get_queue() -> Dict[str, Any]:
    """获取等待队列"""
    scheduler = get_scheduler()
    queue = scheduler.get_waiting_queue()
    return {
        "success": True,
        "queue": queue,
        "length": len(queue),
    }


@router.post("/scheduler/dequeue")
async def dequeue_next() -> Dict[str, Any]:
    """从等待队列取下一个"""
    scheduler = get_scheduler()
    next_goal = scheduler.dequeue_next()
    return {
        "success": True,
        "next_goal": next_goal,
    }


@router.post("/scheduler/active/{goal_id}")
async def mark_active(goal_id: str) -> Dict[str, Any]:
    """标记 Goal 活跃"""
    scheduler = get_scheduler()
    scheduler.mark_active(goal_id)
    return {
        "success": True,
        "goal_id": goal_id,
    }


@router.post("/scheduler/inactive/{goal_id}")
async def mark_inactive(goal_id: str) -> Dict[str, Any]:
    """标记 Goal 非活跃"""
    scheduler = get_scheduler()
    scheduler.mark_inactive(goal_id)
    return {
        "success": True,
        "goal_id": goal_id,
    }


@router.get("/scheduler/policies")
async def list_policies() -> Dict[str, Any]:
    """列出调度策略"""
    return {
        "success": True,
        "policies": [p.value for p in SchedulingPolicy],
        "priorities": [
            {"value": p.value, "level": PRIORITY_VALUE[p]}
            for p in GoalPriority
        ],
    }


# ============================================================
# LLM Cost 端点
# ============================================================
@router.get("/llm-cost/health")
async def llm_cost_health() -> Dict[str, Any]:
    """LLM Cost 健康检查"""
    return {
        "success": True,
        "module": "llm_cost",
        "status": "ok",
        "version": "1.0.0",
    }


@router.get("/llm-cost/summary")
async def llm_cost_summary() -> Dict[str, Any]:
    """LLM 成本总览"""
    tracker = get_tracker()
    return tracker.get_summary()


@router.post("/llm-cost/record")
async def record_cost(req: CostRecordRequest) -> Dict[str, Any]:
    """记录一次 LLM 调用"""
    tracker = get_tracker()
    record = LLMCallRecord(
        user_id=req.user_id,
        project_id=req.project_id,
        agent_id=req.agent_id,
        model=req.model,
        route=req.route,
        feature=req.feature,
        goal_id=req.goal_id,
        run_id=req.run_id,
        tokens_input_cache_miss=req.tokens_input_cache_miss,
        tokens_input_cache_read=req.tokens_input_cache_read,
        tokens_input_cache_write=req.tokens_input_cache_write,
        tokens_output=req.tokens_output,
        tokens_reasoning=req.tokens_reasoning,
        tokens_tool=req.tokens_tool,
        tokens_image=req.tokens_image,
        cost_per_1k_input=req.cost_per_1k_input,
        cost_per_1k_output=req.cost_per_1k_output,
        cost_per_1k_reasoning=req.cost_per_1k_reasoning,
        cost_per_1k_tool=req.cost_per_1k_tool,
        cost_per_1k_image=req.cost_per_1k_image,
        latency_ms=req.latency_ms,
        success=req.success,
        error=req.error,
    )
    result = tracker.record_call(record)
    return result


@router.get("/llm-cost/records")
async def list_cost_records(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    model: Optional[str] = None,
    goal_id: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """查询成本记录"""
    tracker = get_tracker()
    records = tracker.get_records(
        user_id=user_id,
        project_id=project_id,
        model=model,
        goal_id=goal_id,
        limit=limit,
    )
    return {
        "success": True,
        "records": [r.to_dict() for r in records],
        "count": len(records),
    }


@router.get("/llm-cost/aggregate/{dimension}")
async def aggregate_cost(
    dimension: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> Dict[str, Any]:
    """按维度聚合成本"""
    try:
        dim = CostDimension(dimension)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"invalid dimension: {dimension}; must be one of {[d.value for d in CostDimension]}",
        )
    tracker = get_tracker()
    result = tracker.aggregate(dim.value, start=start, end=end)
    return {
        "success": True,
        "dimension": dimension,
        "aggregation": result,
    }


@router.post("/llm-cost/budget")
async def set_budget(req: BudgetRequest) -> Dict[str, Any]:
    """设置成本预算"""
    try:
        dim = CostDimension(req.dimension)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"invalid dimension: {req.dimension}",
        )
    tracker = get_tracker()
    budget = CostBudget(
        dimension=dim.value,
        dimension_value=req.dimension_value,
        soft_limit_usd=req.soft_limit_usd,
        hard_limit_usd=req.hard_limit_usd,
        period=req.period,
        enabled=req.enabled,
    )
    saved = tracker.set_budget(budget)
    return {
        "success": True,
        "budget": saved.to_dict(),
    }


@router.get("/llm-cost/budgets")
async def list_budgets() -> Dict[str, Any]:
    """列出所有预算"""
    tracker = get_tracker()
    budgets = tracker.list_budgets()
    return {
        "success": True,
        "budgets": [b.to_dict() for b in budgets],
        "count": len(budgets),
    }


@router.delete("/llm-cost/budget/{budget_id}")
async def delete_budget(budget_id: str) -> Dict[str, Any]:
    """删除预算"""
    tracker = get_tracker()
    ok = tracker.delete_budget(budget_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"budget not found: {budget_id}")
    return {
        "success": True,
        "budget_id": budget_id,
    }


@router.get("/llm-cost/alerts")
async def list_alerts(limit: int = 50) -> Dict[str, Any]:
    """列出告警历史"""
    tracker = get_tracker()
    alerts = tracker.get_alerts(limit=limit)
    return {
        "success": True,
        "alerts": alerts,
        "count": len(alerts),
    }


@router.post("/llm-cost/clear")
async def clear_cost_records() -> Dict[str, Any]:
    """清空成本记录"""
    tracker = get_tracker()
    count = tracker.clear_records()
    return {
        "success": True,
        "cleared": count,
    }
