"""
# ============================================================
# E2E REST API - Playwright 风格前端自动化
# ============================================================
# 核心作用：提供 E2E 测试框架的 REST API 端点
# 端点：
#   - GET  /health                 - 健康检查
#   - GET  /scenarios              - 列出所有场景
#   - POST /run                    - 执行所有/指定场景
#   - POST /scenarios/{id}/run     - 执行单个场景
#   - GET  /reports                - 列出历史报告
#   - GET  /reports/{id}           - 获取报告详情
#   - GET  /baselines              - 列出视觉基线
#   - POST /baselines              - 上传视觉基线
#   - DELETE /baselines/{name}     - 删除基线
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.e2e import (
    E2EConfig,
    PlaywrightE2ERunner,
    ScenarioRegistry,
    VisualRegression,
    generate_report_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["E2E"])

# 全局 Runner 实例（单例）
_runner: Optional[PlaywrightE2ERunner] = None
# 线程池：用于隔离同步阻塞操作
_executor: Optional[concurrent.futures.ThreadPoolExecutor] = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="e2e-worker"
)


def get_e2e_runner() -> PlaywrightE2ERunner:
    """获取 E2E Runner 单例"""
    global _runner
    if _runner is None:
        _runner = PlaywrightE2ERunner()
    return _runner


def _create_fresh_runner() -> PlaywrightE2ERunner:
    """创建新的 Runner 实例（用于在线程中隔离）"""
    config = E2EConfig(
        backend_url="http://localhost:8765",
        scenario_timeout=60,
        max_retries=2,
    )
    return PlaywrightE2ERunner(config=config)


# ============================================================
# 请求/响应模型
# ============================================================
class RunRequest(BaseModel):
    """运行测试请求"""
    scenario_ids: Optional[List[str]] = Field(default=None, description="指定场景 ID 列表，None 表示全部")
    parallel: bool = Field(default=False, description="是否并行执行")
    formats: Optional[List[str]] = Field(default=None, description="报告格式: html/json/markdown")


class RunResponse(BaseModel):
    """运行测试响应"""
    success: bool
    report_id: str
    total_scenarios: int
    passed: int
    failed: int
    error: int
    skipped: int
    duration_ms: int
    pass_rate: float
    report_paths: Dict[str, str] = Field(default_factory=dict)
    results: List[Dict[str, Any]] = Field(default_factory=list)


class BaselineRequest(BaseModel):
    """基线请求"""
    name: str = Field(..., description="基线名称")
    data_hex: Optional[str] = Field(default=None, description="数据（hex 编码）")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="元数据")


class BaselineResponse(BaseModel):
    """基线响应"""
    success: bool
    baseline: Dict[str, Any]


# ============================================================
# 健康检查
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    runner = get_e2e_runner()
    return {
        "success": True,
        "service": "e2e",
        "version": "1.0.0",
        "scenarios_count": runner.registry.count(),
        "scenarios_loaded": len(runner.list_scenarios()),
        "features": [
            "8_scenarios",
            "visual_regression",
            "multi_format_report",
            "retry_strategy",
            "browser_driver",
            "api_driver",
        ],
    }


@router.get("/scenarios")
async def list_scenarios() -> Dict[str, Any]:
    """列出所有场景"""
    runner = get_e2e_runner()
    scenarios = runner.list_scenarios()
    return {
        "success": True,
        "count": len(scenarios),
        "scenarios": scenarios,
    }


# ============================================================
# 执行测试
# ============================================================
@router.post("/run")
async def run_tests(req: RunRequest) -> RunResponse:
    """执行所有/指定场景（在独立线程中执行，避免阻塞事件循环）"""
    runner = get_e2e_runner()

    def _execute():
        return runner.run_all(
            scenario_ids=req.scenario_ids,
            parallel=req.parallel,
        )

    loop = asyncio.get_event_loop()
    try:
        report = await loop.run_in_executor(_executor, _execute)
    except Exception as e:
        logger.error(f"e2e run failed: {e}")
        raise HTTPException(status_code=500, detail={"error": "run_failed", "message": str(e)})

    return RunResponse(
        success=True,
        report_id=report.report_id,
        total_scenarios=report.total_scenarios,
        passed=report.passed,
        failed=report.failed,
        error=report.error,
        skipped=report.skipped,
        duration_ms=report.duration_ms,
        pass_rate=report.pass_rate(),
        report_paths=report.metadata.get("report_paths", {}),
        results=[r.to_dict() for r in report.results],
    )


@router.post("/scenarios/{scenario_id}/run")
async def run_scenario(scenario_id: str) -> Dict[str, Any]:
    """执行单个场景（在独立线程中执行）"""
    runner = get_e2e_runner()
    scenario = runner.registry.get(scenario_id)
    if not scenario:
        raise HTTPException(
            status_code=404,
            detail={"error": "scenario_not_found", "scenario_id": scenario_id},
        )

    def _execute():
        return runner.run_scenario(scenario)

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(_executor, _execute)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "run_failed", "message": str(e)})
    return {
        "success": True,
        "result": result.to_dict(),
    }


# ============================================================
# 报告管理
# ============================================================
@router.get("/reports")
async def list_reports(limit: int = Query(default=20, ge=1, le=100)) -> Dict[str, Any]:
    """列出历史报告"""
    runner = get_e2e_runner()
    reports = runner.list_reports(limit=limit)
    return {
        "success": True,
        "count": len(reports),
        "reports": reports,
    }


@router.get("/reports/{report_id}")
async def get_report(report_id: str) -> Dict[str, Any]:
    """获取报告详情"""
    runner = get_e2e_runner()
    report = runner.get_report(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail={"error": "report_not_found", "report_id": report_id},
        )
    return {
        "success": True,
        "report": report,
    }


# ============================================================
# 视觉基线管理
# ============================================================
@router.get("/baselines")
async def list_baselines() -> Dict[str, Any]:
    """列出所有视觉基线"""
    runner = get_e2e_runner()
    baselines = runner.visual.list_baselines()
    return {
        "success": True,
        "count": len(baselines),
        "baselines": baselines,
        "stats": runner.visual.stats(),
    }


@router.post("/baselines")
async def create_baseline(req: BaselineRequest) -> BaselineResponse:
    """创建/更新视觉基线"""
    runner = get_e2e_runner()
    if not req.data_hex:
        raise HTTPException(
            status_code=400,
            detail={"error": "missing_data", "message": "data_hex is required"},
        )
    try:
        data = bytes.fromhex(req.data_hex)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_hex", "message": str(e)},
        )
    baseline = runner.visual.capture_baseline(
        name=req.name,
        data=data,
        metadata=req.metadata,
    )
    return BaselineResponse(success=True, baseline=baseline)


@router.delete("/baselines/{name}")
async def delete_baseline(name: str) -> Dict[str, Any]:
    """删除视觉基线"""
    runner = get_e2e_runner()
    deleted = runner.visual.delete_baseline(name)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={"error": "baseline_not_found", "name": name},
        )
    return {"success": True, "name": name, "deleted": True}


@router.post("/baselines/{name}/compare")
async def compare_baseline(name: str, req: BaselineRequest) -> Dict[str, Any]:
    """对比视觉基线"""
    runner = get_e2e_runner()
    if not req.data_hex:
        raise HTTPException(
            status_code=400,
            detail={"error": "missing_data"},
        )
    try:
        data = bytes.fromhex(req.data_hex)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": "invalid_hex", "message": str(e)})
    result = runner.visual.compare(name, data)
    return {"success": True, "comparison": result}
