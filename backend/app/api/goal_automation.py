"""
# ============================================================
# Hermes Goal Automation - REST API
# ============================================================
# 核心作用：暴露 Goal 自动轮转 + 多 Agent 委派的 REST API
# 端点：
#   - GET  /health                                      健康检查
#   - GET  /stats                                       统计信息
#   - GET  /goals                                       列出活跃 Goal
#   - POST /goals/{goal_id}/auto-turn/config            注册/更新配置
#   - GET  /goals/{goal_id}/auto-turn/config            获取配置
#   - DELETE /goals/{goal_id}/auto-turn/config          注销
#   - POST /goals/{goal_id}/auto-turn/trigger           触发单次轮转
#   - POST /goals/{goal_id}/auto-turn/pause             暂停
#   - POST /goals/{goal_id}/auto-turn/resume            恢复
#   - POST /goals/{goal_id}/auto-turn/stop              停止
#   - GET  /goals/{goal_id}/auto-turn/history           轮转历史
#   - POST /delegations                                 委派任务
#   - GET  /delegations                                 委派历史
#   - GET  /delegations/{delegation_id}                 委派详情
#   - POST /delegations/{delegation_id}/complete        完成委派
#   - POST /agents                                      注册 Agent
#   - GET  /agents                                      列出 Agent
#   - GET  /agents/{agent_id}                           Agent 详情
#   - DELETE /agents/{agent_id}                         注销 Agent
#   - PATCH /agents/{agent_id}/status                   更新状态
#   - GET  /agents/health                               健康检查
#   - GET  /agents/load                                 负载分布
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.goal_automation import (
    ACType,
    ACTypeMapping,
    AgentRole,
    AgentSpec,
    AutoTurnEngine,
    DelegationDecision,
    DelegationRequest,
    DelegationResult,
    MultiAgentDelegator,
    RiskLevel,
    TurnConfig,
    TurnState,
    TurnStrategy,
    TurnTrigger,
    get_delegator,
    get_engine,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/goal-automation", tags=["goal-automation"])


# ============================================================
# Pydantic 模型
# ============================================================
class TurnConfigRequest(BaseModel):
    goal_id: str = Field(..., description="Goal ID")
    strategy: str = Field("standard", description="轮转策略")
    interval_seconds: int = Field(30, ge=1, le=3600)
    max_turns: int = Field(1000, ge=1, le=100000)
    auto_verify: bool = True
    auto_progress: bool = True
    triggers: List[str] = Field(default_factory=lambda: ["manual"])
    enabled: bool = True
    # v1.1.0 新增：本地 Goal 上下文（当 manager 不可用时独立运行）
    goal_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Goal 上下文（含 acceptance_criteria），用于独立运行模式",
    )


class TriggerTurnRequest(BaseModel):
    trigger: str = Field("manual", description="触发器类型")
    max_ac_per_turn: Optional[int] = Field(None, ge=1, le=100)


class AgentRegisterRequest(BaseModel):
    agent_id: str
    role: str
    name: str
    capabilities: List[str] = Field(default_factory=list)
    risk_levels: List[str] = Field(default_factory=lambda: ["low", "medium"])
    max_load: int = Field(5, ge=1, le=100)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AgentStatusRequest(BaseModel):
    status: str = Field(..., description="available / busy / offline")


class DelegationCreateRequest(BaseModel):
    goal_id: str
    ac_id: str
    ac_title: str = ""
    ac_type: Optional[str] = None
    risk_level: str = "medium"
    required_capabilities: List[str] = Field(default_factory=list)
    priority: int = 1
    context: Dict[str, Any] = Field(default_factory=dict)


class CompleteDelegationRequest(BaseModel):
    success: bool = True
    output: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# 健康检查 / 统计
# ============================================================
@router.get("/health")
async def health():
    """
    健康检查
    """
    return {
        "status": "ok",
        "version": "v6.32.0",
        "module": "goal-automation",
        "components": {
            "auto_turn": "ok",
            "delegation": "ok",
        },
    }


@router.get("/stats")
async def stats():
    """
    统计信息
    """
    engine = get_engine()
    delegator = get_delegator()
    return {
        "success": True,
        "auto_turn": engine.get_stats(),
        "delegation": delegator.get_stats(),
    }


# ============================================================
# Auto-Turn 端点
# ============================================================
@router.get("/goals")
async def list_active_goals():
    """列出所有活跃 Goal（已注册到 AutoTurnEngine）"""
    engine = get_engine()
    return {"success": True, "goals": engine.list_active_goals()}


@router.post("/goals/{goal_id}/auto-turn/config")
async def register_goal_config(goal_id: str, req: TurnConfigRequest):
    """
    注册/更新 Goal 轮转配置
    """
    engine = get_engine()
    cfg = TurnConfig(
        goal_id=goal_id,
        strategy=req.strategy,
        interval_seconds=req.interval_seconds,
        max_turns=req.max_turns,
        auto_verify=req.auto_verify,
        auto_progress=req.auto_progress,
        triggers=req.triggers,
        enabled=req.enabled,
    )
    saved = engine.register_goal(cfg)
    # v1.1.0 新增：注入本地 Goal 上下文（独立运行模式）
    if req.goal_context:
        engine.set_goal_context(goal_id, req.goal_context)
    return {
        "success": True,
        "goal_id": goal_id,
        "config": saved.to_dict(),
        "state": engine.get_state(goal_id),
    }


@router.get("/goals/{goal_id}/auto-turn/config")
async def get_goal_config(goal_id: str):
    """获取 Goal 轮转配置"""
    engine = get_engine()
    cfg = engine.get_config(goal_id)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Goal {goal_id} not registered")
    return {
        "success": True,
        "goal_id": goal_id,
        "config": cfg.to_dict(),
        "state": engine.get_state(goal_id),
    }


@router.delete("/goals/{goal_id}/auto-turn/config")
async def unregister_goal_config(goal_id: str):
    """注销 Goal 轮转配置"""
    engine = get_engine()
    ok = engine.unregister_goal(goal_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Goal {goal_id} not registered")
    return {"success": True, "goal_id": goal_id, "unregistered": True}


@router.post("/goals/{goal_id}/auto-turn/trigger")
async def trigger_turn(goal_id: str, req: TriggerTurnRequest):
    """
    触发单次轮转
    """
    engine = get_engine()
    rec = engine.trigger_turn(goal_id, req.trigger, req.max_ac_per_turn)
    return {
        "success": rec.state != TurnState.FAILED.value,
        "turn_record": rec.to_dict(),
    }


@router.put("/goals/{goal_id}/context")
async def set_goal_context(goal_id: str, context: Dict[str, Any]):
    """
    设置/更新 Goal 上下文（独立运行模式）

    用于 manager 不可用时单独注入 Goal 数据（含 acceptance_criteria）
    """
    engine = get_engine()
    engine.set_goal_context(goal_id, context)
    return {
        "success": True,
        "goal_id": goal_id,
        "context": context,
    }


@router.post("/goals/{goal_id}/auto-turn/pause")
async def pause_goal(goal_id: str):
    """暂停 Goal 自动轮转"""
    engine = get_engine()
    ok = engine.pause_goal(goal_id)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Cannot pause goal {goal_id}")
    return {"success": True, "goal_id": goal_id, "state": engine.get_state(goal_id)}


@router.post("/goals/{goal_id}/auto-turn/resume")
async def resume_goal(goal_id: str):
    """恢复 Goal 自动轮转"""
    engine = get_engine()
    ok = engine.resume_goal(goal_id)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Cannot resume goal {goal_id}")
    return {"success": True, "goal_id": goal_id, "state": engine.get_state(goal_id)}


@router.post("/goals/{goal_id}/auto-turn/stop")
async def stop_goal(goal_id: str):
    """停止 Goal 自动轮转"""
    engine = get_engine()
    ok = engine.stop_goal(goal_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Goal {goal_id} not registered")
    return {"success": True, "goal_id": goal_id, "state": engine.get_state(goal_id)}


@router.get("/goals/{goal_id}/auto-turn/history")
async def get_turn_history(goal_id: str, limit: int = Query(50, ge=1, le=500)):
    """获取 Goal 轮转历史"""
    engine = get_engine()
    history = engine.get_turn_history(goal_id, limit)
    return {
        "success": True,
        "goal_id": goal_id,
        "count": len(history),
        "history": [r.to_dict() for r in history],
    }


@router.get("/auto-turn/history")
async def get_all_turn_history(limit: int = Query(100, ge=1, le=1000)):
    """获取所有轮转历史"""
    engine = get_engine()
    history = engine.get_all_turn_history(limit)
    return {
        "success": True,
        "count": len(history),
        "history": [r.to_dict() for r in history],
    }


# ============================================================
# Agent 端点
# ============================================================
@router.post("/agents")
async def register_agent(req: AgentRegisterRequest):
    """
    注册 Agent
    """
    delegator = get_delegator()
    try:
        spec = AgentSpec(
            agent_id=req.agent_id,
            role=req.role,
            name=req.name,
            capabilities=req.capabilities,
            risk_levels=req.risk_levels,
            max_load=req.max_load,
            metadata=req.metadata,
        )
        saved = delegator.register_agent(spec)
        return {"success": True, "agent": saved.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/agents")
async def list_agents(
    role: Optional[str] = Query(None, description="按角色过滤"),
    status: Optional[str] = Query(None, description="按状态过滤"),
):
    """列出 Agent"""
    delegator = get_delegator()
    agents = delegator.list_agents(role=role, status=status)
    return {
        "success": True,
        "count": len(agents),
        "agents": [a.to_dict() for a in agents],
    }


@router.get("/agents/health")
async def agents_health():
    """Agent 健康检查"""
    delegator = get_delegator()
    health = delegator.health_check()
    return {"success": True, "health": health, "stats": delegator.get_stats()}


@router.get("/agents/load")
async def agents_load():
    """Agent 负载分布"""
    delegator = get_delegator()
    return {"success": True, "distribution": delegator.get_load_distribution()}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    """Agent 详情"""
    delegator = get_delegator()
    agent = delegator.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    return {"success": True, "agent": agent.to_dict()}


@router.delete("/agents/{agent_id}")
async def unregister_agent(agent_id: str):
    """注销 Agent"""
    delegator = get_delegator()
    ok = delegator.unregister_agent(agent_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    return {"success": True, "agent_id": agent_id, "unregistered": True}


@router.patch("/agents/{agent_id}/status")
async def update_agent_status(agent_id: str, req: AgentStatusRequest):
    """更新 Agent 状态"""
    delegator = get_delegator()
    if req.status not in ("available", "busy", "offline"):
        raise HTTPException(status_code=400, detail="status must be available/busy/offline")
    ok = delegator.update_agent_status(agent_id, req.status)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    agent = delegator.get_agent(agent_id)
    return {"success": True, "agent": agent.to_dict() if agent else None}


# ============================================================
# Delegation 端点
# ============================================================
@router.post("/delegations")
async def create_delegation(req: DelegationCreateRequest):
    """
    创建委派任务
    """
    delegator = get_delegator()
    request = DelegationRequest(
        goal_id=req.goal_id,
        ac_id=req.ac_id,
        ac_title=req.ac_title,
        ac_type=req.ac_type or ACTypeMapping.infer(req.ac_title),
        risk_level=req.risk_level,
        required_capabilities=req.required_capabilities,
        priority=req.priority,
        context=req.context,
    )
    result = delegator.delegate(request)
    return {
        "success": result.decision in ("delegated", "queued"),
        "delegation": result.to_dict(),
    }


@router.get("/delegations")
async def list_delegations(
    goal_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
):
    """列出委派历史"""
    delegator = get_delegator()
    history = delegator.get_delegation_history(goal_id=goal_id, limit=limit)
    return {
        "success": True,
        "count": len(history),
        "history": [d.to_dict() for d in history],
    }


@router.get("/delegations/{delegation_id}")
async def get_delegation(delegation_id: str):
    """委派详情"""
    delegator = get_delegator()
    history = delegator.get_delegation_history(limit=10000)
    for d in history:
        if d.delegation_id == delegation_id:
            return {"success": True, "delegation": d.to_dict()}
    raise HTTPException(status_code=404, detail=f"Delegation {delegation_id} not found")


@router.post("/delegations/{delegation_id}/complete")
async def complete_delegation(delegation_id: str, req: CompleteDelegationRequest):
    """完成委派"""
    delegator = get_delegator()
    ok = delegator.complete_delegation(delegation_id, success=req.success, output=req.output)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Delegation {delegation_id} not found")
    return {"success": True, "delegation_id": delegation_id, "completed": True}


# ============================================================
# 辅助端点
# ============================================================
@router.get("/meta/roles")
async def list_roles():
    """列出所有 Agent 角色"""
    return {
        "success": True,
        "roles": [
            {"value": r.value, "name": r.name}
            for r in AgentRole
        ],
    }


@router.get("/meta/risk-levels")
async def list_risk_levels():
    """列出所有风险等级"""
    return {
        "success": True,
        "risk_levels": [
            {"value": r.value, "name": r.name}
            for r in RiskLevel
        ],
    }


@router.get("/meta/strategies")
async def list_strategies():
    """列出所有轮转策略"""
    return {
        "success": True,
        "strategies": [
            {"value": s.value, "name": s.name}
            for s in TurnStrategy
        ],
    }


@router.get("/meta/triggers")
async def list_triggers():
    """列出所有触发器"""
    return {
        "success": True,
        "triggers": [
            {"value": t.value, "name": t.name}
            for t in TurnTrigger
        ],
    }


@router.get("/meta/ac-types")
async def list_ac_types():
    """列出所有 AC 类型映射"""
    return {
        "success": True,
        "ac_types": {
            ac_type: {
                "preferred_roles": ACTypeMapping.get_preferred_roles(ac_type),
            }
            for ac_type in [t.value for t in ACType]
        },
    }
