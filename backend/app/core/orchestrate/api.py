"""
# Orchestrate REST API
# ============================================================
# 核心作用：暴露 Orchestrated Multi-Agent 系统的 HTTP 接口
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 端点（共 20+）：
#   - 健康检查：/health, /stats
#   - 阶段注册：/stages (CRUD)
#   - Pipeline CRUD：/pipelines
#   - Pipeline 控制：/pipelines/{id}/{cancel,pause,resume}
#   - 执行历史：/pipelines/{id}/executions
#   - 模板：/templates, /templates/{name}/instantiate
#   - SLA 指标：/sla/metrics, /sla/alerts
#   - 重试队列：/retries/queue, /retries/{id}/flush
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query

from .executor import PipelineExecutor
from .models import (
    AlertSeverity,
    ExecutionStatus,
    Pipeline,
    PipelineStatus,
    StageContract,
    StageRef,
    StageStatus,
)
from .registry import GLOBAL_REGISTRY, StageRegistry
from .retry import RetryOrchestrator
from .sla import SLAMonitor
from .templates import (
    PIPELINE_TEMPLATES,
    get_template,
    instantiate_template,
    list_templates,
)


# ============================================================
# 路由 + 状态管理
# ============================================================

router = APIRouter()

# 全局对象（线程安全）
_registry: StageRegistry = GLOBAL_REGISTRY
_sla_monitor: SLAMonitor = SLAMonitor()
_retry_orchestrator: RetryOrchestrator = RetryOrchestrator()
_executor: PipelineExecutor = PipelineExecutor(
    registry=_registry,
    sla_monitor=_sla_monitor,
    retry_orchestrator=_retry_orchestrator,
)

# Pipeline 存储（内存 + 可选持久化）
_pipelines: Dict[str, Pipeline] = {}
_pipeline_lock = threading.RLock()
_storage_dir: Optional[str] = None


def _get_storage_dir() -> str:
    """获取持久化目录"""
    global _storage_dir
    if _storage_dir:
        return _storage_dir
    base = os.environ.get("HERMES_STORAGE_DIR", "/tmp/hermes_orchestrate")
    os.makedirs(base, exist_ok=True)
    _storage_dir = base
    return base


def _save_pipeline(pipeline: Pipeline) -> None:
    """持久化 Pipeline"""
    try:
        path = os.path.join(_get_storage_dir(), f"{pipeline.pipeline_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(pipeline.to_dict(), f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _load_pipelines() -> None:
    """启动时加载持久化的 Pipeline"""
    base = _get_storage_dir()
    if not os.path.isdir(base):
        return
    for filename in os.listdir(base):
        if filename.endswith(".json"):
            try:
                with open(os.path.join(base, filename), "r", encoding="utf-8") as f:
                    data = json.load(f)
                    pipeline = Pipeline.from_dict(data)
                    with _pipeline_lock:
                        _pipelines[pipeline.pipeline_id] = pipeline
            except Exception:
                continue


def _init_default_templates() -> None:
    """初始化时将模板的 StageContract 注册到全局注册表"""
    for template in PIPELINE_TEMPLATES.values():
        for contract in template.stage_contracts:
            # 用 template 中的 stage_id 作为 key
            _registry.register(contract)


# 启动时初始化
_init_default_templates()
_load_pipelines()


# ============================================================
# 端点：健康检查
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    return {
        "status": "ok",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "version": "v6.29.0",
        "modules": {
            "registry": "ok",
            "sla_monitor": "ok",
            "retry_orchestrator": "ok",
            "executor": "ok",
        },
    }


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """全局统计"""
    with _pipeline_lock:
        pipeline_count = len(_pipelines)
        by_status: Dict[str, int] = {}
        for p in _pipelines.values():
            key = p.status.value
            by_status[key] = by_status.get(key, 0) + 1

    return {
        "registry": _registry.get_stats(),
        "sla": _sla_monitor.get_global_stats(),
        "retry": _retry_orchestrator.get_stats(),
        "pipelines": {
            "total": pipeline_count,
            "by_status": by_status,
        },
        "templates": {
            "count": len(PIPELINE_TEMPLATES),
            "names": list(PIPELINE_TEMPLATES.keys()),
        },
    }


# ============================================================
# 端点：阶段注册
# ============================================================

@router.get("/stages")
async def list_stages(
    include_disabled: bool = Query(False),
    query: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    capability: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出所有阶段"""
    if query:
        contracts = _registry.search(query)
    elif tag:
        contracts = _registry.find_by_tag(tag)
    elif capability:
        contracts = _registry.find_by_capability(capability)
    else:
        contracts = _registry.list_all(include_disabled=include_disabled)
    return {
        "count": len(contracts),
        "stages": [c.to_dict() for c in contracts],
    }


@router.get("/stages/{stage_id}")
async def get_stage(stage_id: str) -> Dict[str, Any]:
    """获取阶段详情"""
    contract = _registry.get(stage_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Stage not found: {stage_id}")
    return contract.to_dict()


@router.post("/stages")
async def register_stage(contract_data: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """注册新阶段"""
    try:
        contract = StageContract.from_dict(contract_data)
        _registry.register(contract)
        return {
            "success": True,
            "stage_id": contract.stage_id,
            "contract": contract.to_dict(),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to register stage: {e}")


@router.delete("/stages/{stage_id}")
async def unregister_stage(stage_id: str) -> Dict[str, Any]:
    """注销阶段"""
    success = _registry.unregister(stage_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Stage not found: {stage_id}")
    return {"success": True, "stage_id": stage_id}


# ============================================================
# 端点：Pipeline CRUD
# ============================================================

@router.post("/pipelines")
async def create_pipeline(
    pipeline_data: Dict[str, Any] = Body(...),
    execute_now: bool = Query(False),
) -> Dict[str, Any]:
    """创建 Pipeline（可选择立即执行）"""
    try:
        # 支持从模板创建
        template_name = pipeline_data.get("template")
        if template_name:
            template = get_template(template_name)
            if not template:
                raise HTTPException(
                    status_code=404,
                    detail=f"Template not found: {template_name}",
                )
            inputs = pipeline_data.get("inputs", {})
            created_by = pipeline_data.get("created_by", "system")
            pipeline = instantiate_template(template_name, inputs, created_by)
            if not pipeline:
                raise HTTPException(status_code=500, detail="Failed to instantiate template")
            if "name" in pipeline_data:
                pipeline.name = pipeline_data["name"]
            if "description" in pipeline_data:
                pipeline.description = pipeline_data["description"]
        else:
            # 直接构造 Pipeline 而不是 from_dict（避免 pipeline_id 必填）
            stages = [StageRef.from_dict(s) for s in pipeline_data.get("stages", [])]
            pipeline = Pipeline(
                name=pipeline_data.get("name", ""),
                description=pipeline_data.get("description", ""),
                stages=stages,
                inputs=pipeline_data.get("inputs", {}),
                template=pipeline_data.get("template"),
                created_by=pipeline_data.get("created_by", "system"),
            )

        with _pipeline_lock:
            _pipelines[pipeline.pipeline_id] = pipeline
        _save_pipeline(pipeline)

        if execute_now:
            pipeline = _executor.execute(pipeline)
            _save_pipeline(pipeline)

        return {
            "success": True,
            "pipeline_id": pipeline.pipeline_id,
            "status": pipeline.status.value,
            "execution_plan": pipeline.execution_plan,
            "pipeline": pipeline.to_dict(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create pipeline: {e}")


@router.get("/pipelines")
async def list_pipelines(
    status: Optional[str] = Query(None),
    template: Optional[str] = Query(None),
    created_by: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
) -> Dict[str, Any]:
    """列出 Pipeline"""
    with _pipeline_lock:
        pipelines = list(_pipelines.values())
    if status:
        pipelines = [p for p in pipelines if p.status.value == status]
    if template:
        pipelines = [p for p in pipelines if p.template == template]
    if created_by:
        pipelines = [p for p in pipelines if p.created_by == created_by]
    # 按创建时间倒序
    pipelines.sort(key=lambda p: p.created_at, reverse=True)
    return {
        "count": len(pipelines[:limit]),
        "pipelines": [p.to_dict() for p in pipelines[:limit]],
    }


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """获取 Pipeline 详情"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    return pipeline.to_dict()


@router.post("/pipelines/{pipeline_id}/execute")
async def execute_pipeline(
    pipeline_id: str,
    stage_runners: Optional[Dict[str, Any]] = Body(None),
) -> Dict[str, Any]:
    """执行 Pipeline"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    if pipeline.status not in (PipelineStatus.PENDING, PipelineStatus.FAILED, PipelineStatus.PAUSED):
        raise HTTPException(
            status_code=409,
            detail=f"Pipeline is in {pipeline.status.value} state, cannot execute",
        )

    # stage_runners 这里不支持（仅供测试接口）
    pipeline = _executor.execute(pipeline, stage_runners or {})
    _save_pipeline(pipeline)
    return {
        "success": pipeline.status == PipelineStatus.COMPLETED,
        "pipeline_id": pipeline.pipeline_id,
        "status": pipeline.status.value,
        "pipeline": pipeline.to_dict(),
    }


@router.post("/pipelines/{pipeline_id}/cancel")
async def cancel_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """取消 Pipeline"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    if pipeline.status in (PipelineStatus.COMPLETED, PipelineStatus.CANCELLED):
        raise HTTPException(
            status_code=409,
            detail=f"Pipeline already {pipeline.status.value}",
        )
    pipeline.status = PipelineStatus.CANCELLED
    pipeline.completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_pipeline(pipeline)
    return {
        "success": True,
        "pipeline_id": pipeline_id,
        "status": pipeline.status.value,
    }


@router.post("/pipelines/{pipeline_id}/pause")
async def pause_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """暂停 Pipeline"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    if pipeline.status != PipelineStatus.RUNNING:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot pause pipeline in {pipeline.status.value} state",
        )
    pipeline.status = PipelineStatus.PAUSED
    _save_pipeline(pipeline)
    return {
        "success": True,
        "pipeline_id": pipeline_id,
        "status": pipeline.status.value,
    }


@router.post("/pipelines/{pipeline_id}/resume")
async def resume_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """恢复 Pipeline"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    if pipeline.status != PipelineStatus.PAUSED:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot resume pipeline in {pipeline.status.value} state",
        )
    pipeline = _executor.execute(pipeline)
    _save_pipeline(pipeline)
    return {
        "success": True,
        "pipeline_id": pipeline_id,
        "status": pipeline.status.value,
    }


@router.get("/pipelines/{pipeline_id}/executions")
async def get_pipeline_executions(pipeline_id: str) -> Dict[str, Any]:
    """获取 Pipeline 各阶段执行详情"""
    with _pipeline_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {pipeline_id}")
    return {
        "pipeline_id": pipeline_id,
        "executions": [e.to_dict() for e in pipeline.stage_executions.values()],
        "execution_plan": pipeline.execution_plan,
        "total_latency_ms": pipeline.total_latency_ms,
    }


# ============================================================
# 端点：模板
# ============================================================

@router.get("/templates")
async def get_templates() -> Dict[str, Any]:
    """列出所有 Pipeline 模板"""
    return {
        "count": len(PIPELINE_TEMPLATES),
        "templates": list_templates(),
    }


@router.get("/templates/{template_name}")
async def get_template_detail(template_name: str) -> Dict[str, Any]:
    """获取模板详情"""
    template = get_template(template_name)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_name}")
    return template.to_dict()


@router.post("/templates/{template_name}/instantiate")
async def instantiate_template_endpoint(
    template_name: str,
    inputs: Optional[Dict[str, Any]] = Body(None),
    created_by: str = Query("system"),
    execute_now: bool = Query(False),
) -> Dict[str, Any]:
    """从模板实例化 Pipeline"""
    template = get_template(template_name)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_name}")
    pipeline = instantiate_template(template_name, inputs or {}, created_by)
    if not pipeline:
        raise HTTPException(status_code=500, detail="Failed to instantiate template")
    with _pipeline_lock:
        _pipelines[pipeline.pipeline_id] = pipeline
    _save_pipeline(pipeline)
    if execute_now:
        pipeline = _executor.execute(pipeline)
        _save_pipeline(pipeline)
    return {
        "success": True,
        "pipeline_id": pipeline.pipeline_id,
        "pipeline": pipeline.to_dict(),
    }


# ============================================================
# 端点：SLA
# ============================================================

@router.get("/sla/metrics")
async def get_sla_metrics(stage_id: Optional[str] = Query(None)) -> Dict[str, Any]:
    """获取 SLA 指标"""
    if stage_id:
        metrics = _sla_monitor.get_metrics(stage_id)
        return {"metrics": metrics.to_dict()}
    all_metrics = _sla_monitor.get_all_metrics()
    return {
        "count": len(all_metrics),
        "metrics": [m.to_dict() for m in all_metrics],
    }


@router.get("/sla/alerts")
async def list_alerts(
    stage_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    include_acknowledged: bool = Query(True),
) -> Dict[str, Any]:
    """列出告警"""
    sev = None
    if severity:
        try:
            sev = AlertSeverity(severity)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid severity: {severity}",
            )
    alerts = _sla_monitor.list_alerts(
        stage_id=stage_id,
        severity=sev,
        include_acknowledged=include_acknowledged,
    )
    return {
        "count": len(alerts),
        "alerts": alerts,
    }


@router.post("/sla/alerts/{alert_id}/ack")
async def acknowledge_alert(
    alert_id: str,
    acknowledged_by: str = Query("system"),
) -> Dict[str, Any]:
    """确认告警"""
    success = _sla_monitor.acknowledge_alert(alert_id, acknowledged_by)
    if not success:
        raise HTTPException(status_code=404, detail=f"Alert not found: {alert_id}")
    return {"success": True, "alert_id": alert_id}


# ============================================================
# 端点：重试队列
# ============================================================

@router.get("/retries/queue")
async def list_retry_queue(
    pipeline_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出重试队列"""
    items = _retry_orchestrator.list_queue(pipeline_id=pipeline_id)
    return {
        "count": len(items),
        "items": items,
    }


@router.post("/retries/{item_id}/flush")
async def flush_retry_item(item_id: str) -> Dict[str, Any]:
    """立即重试指定项"""
    item = _retry_orchestrator.flush_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Retry item not found: {item_id}")
    return {"success": True, "item": item}


@router.get("/retries/breakers")
async def list_breakers() -> Dict[str, Any]:
    """列出所有熔断器状态"""
    breakers = _retry_orchestrator.list_breakers()
    return {
        "count": len(breakers),
        "breakers": breakers,
    }


@router.post("/retries/breakers/{stage_id}/reset")
async def reset_breaker(stage_id: str) -> Dict[str, Any]:
    """重置熔断器"""
    success = _retry_orchestrator.reset_breaker(stage_id)
    return {
        "success": success,
        "stage_id": stage_id,
        "breaker": _retry_orchestrator.get_breaker_status(stage_id),
    }


# ============================================================
# 端点：DAG 工具
# ============================================================

@router.post("/dag/validate")
async def validate_dag_endpoint(pipeline_data: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """验证 Pipeline DAG 合法性"""
    from .dag import build_execution_plan, detect_cycles, get_critical_path, get_parallelism, validate_dag
    try:
        # 直接构造 Pipeline 避免 pipeline_id 必填
        stages = [StageRef.from_dict(s) for s in pipeline_data.get("stages", [])]
        pipeline = Pipeline(
            name=pipeline_data.get("name", ""),
            stages=stages,
            inputs=pipeline_data.get("inputs", {}),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid pipeline data: {e}")

    valid, errors = validate_dag(pipeline)
    result: Dict[str, Any] = {"valid": valid, "errors": errors}

    if valid:
        try:
            plan = build_execution_plan(pipeline)
            result["execution_plan"] = plan
            result["parallelism"] = get_parallelism(pipeline)
            result["critical_path"] = get_critical_path(pipeline)
        except Exception as e:
            result["plan_error"] = str(e)

    return result


@router.post("/dag/execution-plan")
async def build_execution_plan_endpoint(
    pipeline_data: Dict[str, Any] = Body(...),
) -> Dict[str, Any]:
    """构建执行计划"""
    from .dag import build_execution_plan, get_parallelism
    try:
        stages = [StageRef.from_dict(s) for s in pipeline_data.get("stages", [])]
        pipeline = Pipeline(
            name=pipeline_data.get("name", ""),
            stages=stages,
            inputs=pipeline_data.get("inputs", {}),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid pipeline data: {e}")
    try:
        plan = build_execution_plan(pipeline)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to build plan: {e}")
    return {
        "execution_plan": plan,
        "parallelism": get_parallelism(pipeline),
    }


# ============================================================
# 端点计数
# ============================================================

ENDPOINT_COUNT = 23
