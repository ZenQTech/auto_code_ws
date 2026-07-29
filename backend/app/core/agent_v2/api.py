"""
Hermes Agent v2 - REST API 端点
==========================================
核心作用：提供 Agent v2 自进化智能体的 REST API
        18 个端点覆盖 Patterns/Suggestions/Automations/Background/Self-Directing
运行流程：接收 HTTP 请求 → 调用 Manager → 返回 JSON 响应
输入参数：HTTP 请求
输出结果：JSON 响应
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from .manager import get_manager


router = APIRouter(prefix="/agent-v2", tags=["agent-v2"])


# ============================================================
# 请求/响应模型
# ============================================================

class CreateAutomationRequest(BaseModel):
    """创建自动化任务请求"""
    name: str = Field(..., description="任务名称")
    schedule: str = Field(..., description="调度表达式")
    action: str = Field(..., description="动作")
    schedule_type: str = Field("cron", description="调度类型: cron/interval/event/one_shot")
    enabled: bool = Field(True, description="是否启用")
    max_runs: Optional[int] = Field(None, description="最大执行次数")
    owner: str = Field("default", description="所有者")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据")


class UpdateAutomationRequest(BaseModel):
    """更新自动化任务请求"""
    name: Optional[str] = Field(None, description="任务名称")
    schedule: Optional[str] = Field(None, description="调度表达式")
    action: Optional[str] = Field(None, description="动作")
    enabled: Optional[bool] = Field(None, description="是否启用")
    max_runs: Optional[int] = Field(None, description="最大执行次数")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据")


class RecordOperationRequest(BaseModel):
    """记录操作请求"""
    type: str = Field(..., description="操作类型")
    target: str = Field("", description="操作目标")
    description: str = Field("", description="操作描述")
    suggested_action: str = Field("", description="建议动作")
    context: Optional[Dict[str, Any]] = Field(None, description="上下文")


class CreateSuggestionRequest(BaseModel):
    """创建建议请求"""
    title: str = Field(..., description="标题")
    description: str = Field(..., description="描述")
    source: str = Field("memory", description="来源")
    confidence: float = Field(0.8, description="置信度")
    action_url: Optional[str] = Field(None, description="操作 URL")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据")


class SetConfigRequest(BaseModel):
    """设置配置请求"""
    idle_threshold: Optional[int] = Field(None, description="空闲阈值（秒）")
    auto_turn_enabled: Optional[bool] = Field(None, description="是否启用 auto-turn")


# ============================================================
# 健康检查 & 统计
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查

    Returns:
        Dict[str, Any]: 健康状态
    """
    return get_manager().health()


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """获取统计概览

    Returns:
        Dict[str, Any]: 统计数据
    """
    stats = get_manager().get_stats()
    return {"success": True, "data": stats.to_dict()}


@router.get("/dashboard")
async def dashboard() -> Dict[str, Any]:
    """获取 Dashboard 数据

    Returns:
        Dict[str, Any]: Dashboard 数据
    """
    return {"success": True, "data": get_manager().get_dashboard()}


# ============================================================
# Proactive Patterns
# ============================================================

@router.post("/proactive/operations")
async def record_operation(req: RecordOperationRequest) -> Dict[str, Any]:
    """记录操作 + 模式检测

    Args:
        req: 记录操作请求

    Returns:
        Dict[str, Any]: 生成的建议
    """
    operation = {
        "type": req.type,
        "target": req.target,
        "description": req.description,
        "suggested_action": req.suggested_action,
        "context": req.context or {},
    }
    suggestions = get_manager().record_operation(operation)
    return {
        "success": True,
        "count": len(suggestions),
        "suggestions": [s.to_dict() for s in suggestions],
    }


@router.get("/proactive/patterns")
async def list_patterns(
    min_confidence: Optional[float] = Query(None, description="最低置信度"),
    limit: int = Query(50, description="限制数量"),
) -> Dict[str, Any]:
    """列出模式

    Args:
        min_confidence: 最低置信度
        limit: 限制数量

    Returns:
        Dict[str, Any]: 模式列表
    """
    patterns = get_manager().list_patterns(min_confidence=min_confidence)
    return {
        "success": True,
        "count": len(patterns),
        "patterns": [p.to_dict() for p in patterns[:limit]],
    }


@router.get("/proactive/patterns/{pattern_id}")
async def get_pattern(pattern_id: str) -> Dict[str, Any]:
    """获取模式详情

    Args:
        pattern_id: 模式 ID

    Returns:
        Dict[str, Any]: 模式详情
    """
    pattern = get_manager().get_pattern(pattern_id)
    if pattern is None:
        raise HTTPException(status_code=404, detail="Pattern not found")
    return {"success": True, "pattern": pattern.to_dict()}


@router.delete("/proactive/patterns/{pattern_id}")
async def remove_pattern(pattern_id: str) -> Dict[str, Any]:
    """删除模式

    Args:
        pattern_id: 模式 ID

    Returns:
        Dict[str, Any]: 删除结果
    """
    removed = get_manager().remove_pattern(pattern_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Pattern not found")
    return {"success": True, "removed": True}


# ============================================================
# Proactive Suggestions
# ============================================================

@router.post("/proactive/suggestions")
async def create_suggestion(req: CreateSuggestionRequest) -> Dict[str, Any]:
    """创建建议

    Args:
        req: 创建建议请求

    Returns:
        Dict[str, Any]: 创建的建议
    """
    manager = get_manager()
    suggestion = manager.memory.create_suggestion(
        title=req.title,
        description=req.description,
        source=req.source,
        confidence=req.confidence,
        action_url=req.action_url,
        metadata=req.metadata,
    )
    return {"success": True, "suggestion": suggestion.to_dict()}


@router.get("/proactive/suggestions")
async def list_suggestions(
    status: Optional[str] = Query(None, description="状态过滤"),
    source: Optional[str] = Query(None, description="来源过滤"),
    min_confidence: float = Query(0.0, description="最低置信度"),
    limit: int = Query(50, description="限制数量"),
) -> Dict[str, Any]:
    """列出建议

    Args:
        status: 状态过滤
        source: 来源过滤
        min_confidence: 最低置信度
        limit: 限制数量

    Returns:
        Dict[str, Any]: 建议列表
    """
    suggestions = get_manager().list_suggestions(
        status=status,
        source=source,
        min_confidence=min_confidence,
    )
    return {
        "success": True,
        "count": len(suggestions),
        "suggestions": [s.to_dict() for s in suggestions[:limit]],
    }


@router.get("/proactive/suggestions/{suggestion_id}")
async def get_suggestion(suggestion_id: str) -> Dict[str, Any]:
    """获取建议详情

    Args:
        suggestion_id: 建议 ID

    Returns:
        Dict[str, Any]: 建议详情
    """
    suggestion = get_manager().get_suggestion(suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return {"success": True, "suggestion": suggestion.to_dict()}


@router.post("/proactive/suggestions/{suggestion_id}/accept")
async def accept_suggestion(suggestion_id: str) -> Dict[str, Any]:
    """接受建议

    Args:
        suggestion_id: 建议 ID

    Returns:
        Dict[str, Any]: 更新后的建议
    """
    suggestion = get_manager().accept_suggestion(suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return {"success": True, "suggestion": suggestion.to_dict()}


@router.post("/proactive/suggestions/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: str) -> Dict[str, Any]:
    """拒绝建议

    Args:
        suggestion_id: 建议 ID

    Returns:
        Dict[str, Any]: 更新后的建议
    """
    suggestion = get_manager().reject_suggestion(suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return {"success": True, "suggestion": suggestion.to_dict()}


# ============================================================
# Thread Automations
# ============================================================

@router.get("/automations")
async def list_automations(
    enabled_only: bool = Query(False, description="仅列出启用的"),
    owner: Optional[str] = Query(None, description="按所有者过滤"),
) -> Dict[str, Any]:
    """列出自动化任务

    Args:
        enabled_only: 仅列出启用的
        owner: 按所有者过滤

    Returns:
        Dict[str, Any]: 任务列表
    """
    automations = get_manager().list_automations(
        enabled_only=enabled_only,
        owner=owner,
    )
    return {
        "success": True,
        "count": len(automations),
        "automations": [a.to_dict() for a in automations],
    }


@router.post("/automations")
async def create_automation(req: CreateAutomationRequest) -> Dict[str, Any]:
    """创建自动化任务

    Args:
        req: 创建请求

    Returns:
        Dict[str, Any]: 创建的任务
    """
    automation = get_manager().create_automation(
        name=req.name,
        schedule=req.schedule,
        action=req.action,
        schedule_type=req.schedule_type,
        enabled=req.enabled,
        max_runs=req.max_runs,
        owner=req.owner,
        metadata=req.metadata,
    )
    return {"success": True, "automation": automation.to_dict()}


@router.get("/automations/{automation_id}")
async def get_automation(automation_id: str) -> Dict[str, Any]:
    """获取自动化任务详情

    Args:
        automation_id: 任务 ID

    Returns:
        Dict[str, Any]: 任务详情
    """
    automation = get_manager().get_automation(automation_id)
    if automation is None:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "automation": automation.to_dict()}


@router.put("/automations/{automation_id}")
async def update_automation(
    automation_id: str,
    req: UpdateAutomationRequest,
) -> Dict[str, Any]:
    """更新自动化任务

    Args:
        automation_id: 任务 ID
        req: 更新请求

    Returns:
        Dict[str, Any]: 更新后的任务
    """
    manager = get_manager()
    automation = manager.get_automation(automation_id)
    if automation is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    # 更新字段
    if req.name is not None:
        automation.name = req.name
    if req.schedule is not None:
        automation.schedule = req.schedule
    if req.action is not None:
        automation.action = req.action
    if req.enabled is not None:
        automation.enabled = req.enabled
    if req.max_runs is not None:
        automation.max_runs = req.max_runs
    if req.metadata is not None:
        automation.metadata = req.metadata

    updated = manager.update_automation(automation)
    return {"success": True, "automation": updated.to_dict()}


@router.delete("/automations/{automation_id}")
async def delete_automation(automation_id: str) -> Dict[str, Any]:
    """删除自动化任务

    Args:
        automation_id: 任务 ID

    Returns:
        Dict[str, Any]: 删除结果
    """
    removed = get_manager().delete_automation(automation_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "removed": True}


@router.post("/automations/{automation_id}/trigger")
async def trigger_automation(automation_id: str) -> Dict[str, Any]:
    """手动触发自动化任务

    Args:
        automation_id: 任务 ID

    Returns:
        Dict[str, Any]: 后台任务
    """
    task = await get_manager().trigger_automation(automation_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "task": task.to_dict()}


# ============================================================
# Background Tasks
# ============================================================

@router.get("/background/tasks")
async def list_background_tasks(
    status: Optional[str] = Query(None, description="状态过滤"),
    automation_id: Optional[str] = Query(None, description="自动化 ID"),
    limit: int = Query(100, description="限制数量"),
) -> Dict[str, Any]:
    """列出后台任务

    Args:
        status: 状态过滤
        automation_id: 自动化 ID
        limit: 限制数量

    Returns:
        Dict[str, Any]: 任务列表
    """
    tasks = get_manager().list_background_tasks(
        status=status,
        automation_id=automation_id,
        limit=limit,
    )
    return {
        "success": True,
        "count": len(tasks),
        "tasks": [t.to_dict() for t in tasks],
    }


@router.get("/background/tasks/{task_id}")
async def get_background_task(task_id: str) -> Dict[str, Any]:
    """获取后台任务详情

    Args:
        task_id: 任务 ID

    Returns:
        Dict[str, Any]: 任务详情
    """
    task = get_manager().get_background_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True, "task": task.to_dict()}


@router.post("/background/tasks/{task_id}/cancel")
async def cancel_background_task(task_id: str) -> Dict[str, Any]:
    """取消后台任务

    Args:
        task_id: 任务 ID

    Returns:
        Dict[str, Any]: 取消结果
    """
    cancelled = get_manager().cancel_background_task(task_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True, "cancelled": True}


# ============================================================
# Self-Directing
# ============================================================

@router.get("/self-directing/idle-status")
async def idle_status() -> Dict[str, Any]:
    """获取空闲状态

    Returns:
        Dict[str, Any]: 空闲状态
    """
    status = get_manager().get_idle_status()
    return {"success": True, "status": status.to_dict()}


@router.post("/self-directing/auto-turn")
async def trigger_auto_turn() -> Dict[str, Any]:
    """触发 idle auto-turn

    Returns:
        Dict[str, Any]: 生成的建议
    """
    manager = get_manager()
    # 构建上下文
    stats = manager.get_stats()
    context = {
        "pending_count": stats.pending_suggestions,
        "automation_due_count": len(manager.scheduler.get_due()),
        "background_running": stats.background_tasks_by_status.get("running", 0),
        "background_pending": stats.background_tasks_by_status.get("pending", 0),
        "high_confidence_patterns": stats.high_confidence_patterns,
    }
    suggestions = manager.trigger_auto_turn(context=context)
    return {
        "success": True,
        "count": len(suggestions),
        "suggestions": [s.to_dict() for s in suggestions],
    }


@router.post("/self-directing/config")
async def set_config(req: SetConfigRequest) -> Dict[str, Any]:
    """设置 self-directing 配置

    Args:
        req: 配置请求

    Returns:
        Dict[str, Any]: 更新后的状态
    """
    manager = get_manager()
    if req.idle_threshold is not None:
        manager.set_idle_threshold(req.idle_threshold)
    if req.auto_turn_enabled is not None:
        manager.set_auto_turn_enabled(req.auto_turn_enabled)

    status = manager.get_idle_status()
    return {"success": True, "status": status.to_dict()}


@router.post("/self-directing/activity")
async def record_activity() -> Dict[str, Any]:
    """记录用户活动

    Returns:
        Dict[str, Any]: 当前空闲状态
    """
    get_manager().record_activity()
    status = get_manager().get_idle_status()
    return {"success": True, "status": status.to_dict()}
