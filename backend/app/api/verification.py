"""
# ============================================================
# Verification Loop API 路由 (Cycle 10 P1-10)
# ============================================================
# 核心作用：提供 Verification Loop 的 REST API 接口
# 运行流程：
#   1. 创建/查询/取消/重试验证任务
#   2. 查询验证结果
#   3. 性能基线管理
#   4. Webhook 触发（git push / PR）
#   5. 健康检查与统计
# 输入参数：标准 HTTP 请求
# 输出结果：JSON 响应
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.verification import (
    TriggerType,
    VerificationTask,
    PerformanceBaseline,
    get_task_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# Pydantic Schema
# ============================================================


class CreateTaskRequest(BaseModel):
    """创建验证任务请求"""

    trigger: str = Field(..., description="触发源: commit / pr / cron / manual")
    commit_sha: str = Field(default="", description="commit SHA（40字符hex）")
    project_path: str = Field(..., description="项目路径（白名单内）")
    dimensions: List[str] = Field(
        default_factory=lambda: ["syntax", "module"],
        description="验证维度: syntax / module / integration / performance",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None, description="附加元数据"
    )


class TaskSummaryResponse(BaseModel):
    """任务摘要响应"""

    task_id: str
    trigger: str
    commit_sha: str
    project_path: str
    dimensions: List[str]
    status: str
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    retry_count: int
    error_message: Optional[str] = None
    estimated_duration_seconds: int


class TaskDetailResponse(BaseModel):
    """任务详情响应"""

    task: TaskSummaryResponse
    results: List[Dict[str, Any]] = Field(default_factory=list)
    fix_actions: List[Dict[str, Any]] = Field(default_factory=list)


class CreateBaselineRequest(BaseModel):
    """创建基线请求"""

    name: str = Field(..., min_length=1, max_length=128, description="基线名称")
    project_path: str = Field(..., description="项目路径")
    metric_name: str = Field(default="execution_ms", description="指标名")
    metric_value: float = Field(..., description="指标值")
    unit: str = Field(default="ms", description="单位")
    commit_sha: str = Field(default="", description="commit SHA")


class BaselineResponse(BaseModel):
    """基线响应"""

    baseline_id: str
    name: str
    project_path: str
    metric_name: str
    metric_value: float
    unit: str
    commit_sha: str
    created_at: str
    expired: bool = False


class WebhookRequest(BaseModel):
    """Webhook 请求体"""

    event: str = Field(default="push", description="事件类型: push / pull_request")
    payload: Dict[str, Any] = Field(..., description="原始 webhook 载荷")
    project_path: str = Field(..., description="项目路径")


# ============================================================
# 辅助函数
# ============================================================


def _task_to_summary(task: VerificationTask) -> TaskSummaryResponse:
    return TaskSummaryResponse(
        task_id=task.task_id,
        trigger=task.trigger,
        commit_sha=task.commit_sha,
        project_path=task.project_path,
        dimensions=task.dimensions,
        status=task.status,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
        retry_count=task.retry_count,
        error_message=task.error_message,
        estimated_duration_seconds=task.estimated_duration_seconds,
    )


# ============================================================
# 健康检查与统计
# ============================================================


@router.get("/health")
async def health():
    """健康检查"""
    return {
        "success": True,
        "service": "verification",
        "version": "1.0.0",
        "features": [
            "syntax_verification",
            "module_verification",
            "integration_verification",
            "performance_verification",
            "auto_fix_orchestration",
            "performance_baseline",
            "report_generation",
            "git_webhook",
        ],
    }


@router.get("/stats")
async def stats():
    """统计信息"""
    tm = get_task_manager()
    tasks = tm.list_tasks(limit=10000)
    total = len(tasks)
    by_status = {}
    by_trigger = {}
    by_dimension = {}
    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        by_trigger[t.trigger] = by_trigger.get(t.trigger, 0) + 1
        for d in t.dimensions:
            by_dimension[d] = by_dimension.get(d, 0) + 1

    baselines = tm.baseline_store.list_baselines()

    return {
        "success": True,
        "data": {
            "total_tasks": total,
            "by_status": by_status,
            "by_trigger": by_trigger,
            "by_dimension": by_dimension,
            "total_baselines": len(baselines),
            "verification_dir": str(tm.verification_dir),
        },
    }


# ============================================================
# 任务管理
# ============================================================


@router.post("/tasks")
async def create_task(req: CreateTaskRequest):
    """创建验证任务"""
    tm = get_task_manager()
    task, err = tm.create_task(
        trigger=req.trigger,
        commit_sha=req.commit_sha,
        project_path=req.project_path,
        dimensions=req.dimensions,
        metadata=req.metadata,
    )
    if not task:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "task_id": task.task_id,
        "status": task.status,
        "created_at": task.created_at,
        "estimated_duration_seconds": task.estimated_duration_seconds,
        "message": err if err else "task created",
    }


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = Query(None, description="按状态过滤"),
    trigger: Optional[str] = Query(None, description="按触发源过滤"),
    limit: int = Query(50, ge=1, le=500, description="返回数量上限"),
):
    """列出任务"""
    tm = get_task_manager()
    tasks = tm.list_tasks(status=status, trigger=trigger, limit=limit)
    return {
        "success": True,
        "data": [_task_to_summary(t).model_dump() for t in tasks],
        "total": len(tasks),
    }


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """任务详情"""
    tm = get_task_manager()
    task = tm.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")

    results = tm.result_store.get_results(task_id)
    actions = tm.fix_orchestrator.get_actions(task_id)

    return {
        "success": True,
        "task": _task_to_summary(task).model_dump(),
        "results": [r.to_dict() for r in results],
        "fix_actions": [a.to_dict() for a in actions],
    }


@router.post("/tasks/{task_id}/run")
async def run_task(task_id: str):
    """立即执行任务"""
    tm = get_task_manager()
    success, err = tm.run_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "task_id": task_id,
        "status": "running",
        "message": "task started in background",
    }


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    """取消任务"""
    tm = get_task_manager()
    success, err = tm.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "task_id": task_id,
        "status": "cancelled",
    }


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    """重试任务"""
    tm = get_task_manager()
    success, err = tm.retry_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "task_id": task_id,
        "status": "running",
        "message": "task retried in background",
    }


# ============================================================
# 验证结果
# ============================================================


@router.get("/results/{task_id}")
async def get_results(task_id: str):
    """获取任务的所有验证结果"""
    tm = get_task_manager()
    task = tm.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")

    results = tm.result_store.get_results(task_id)
    return {
        "success": True,
        "task_id": task_id,
        "data": [r.to_dict() for r in results],
        "total": len(results),
    }


# ============================================================
# 性能基线
# ============================================================


@router.get("/baselines")
async def list_baselines():
    """列出所有性能基线"""
    tm = get_task_manager()
    baselines = tm.baseline_store.list_baselines()
    return {
        "success": True,
        "data": [
            BaselineResponse(
                baseline_id=bl.baseline_id,
                name=bl.name,
                project_path=bl.project_path,
                metric_name=bl.metric_name,
                metric_value=bl.metric_value,
                unit=bl.unit,
                commit_sha=bl.commit_sha,
                created_at=bl.created_at,
                expired=tm.baseline_store.is_expired(bl),
            ).model_dump()
            for bl in baselines
        ],
        "total": len(baselines),
    }


@router.post("/baselines")
async def create_baseline(req: CreateBaselineRequest):
    """创建性能基线"""
    tm = get_task_manager()
    baseline = PerformanceBaseline(
        baseline_id=f"bl_{hash((req.name, req.project_path, req.metric_name)) & 0xffffffff:08x}",
        name=req.name,
        project_path=req.project_path,
        metric_name=req.metric_name,
        metric_value=req.metric_value,
        unit=req.unit,
        commit_sha=req.commit_sha,
    )
    success, err = tm.baseline_store.create_baseline(baseline)
    if not success:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "baseline_id": baseline.baseline_id,
        "message": "baseline created",
    }


# ============================================================
# Webhook
# ============================================================


@router.post("/webhook/git")
async def git_webhook(req: WebhookRequest):
    """Git Webhook 触发"""
    tm = get_task_manager()
    from backend.app.services.verification import GitWebhookHandler

    handler = GitWebhookHandler(tm)
    task, err = handler.handle_webhook(
        event_type=req.event,
        payload=req.payload,
        project_path=req.project_path,
    )
    if not task:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "task_id": task.task_id,
        "status": task.status,
        "message": err if err else "webhook processed",
    }
