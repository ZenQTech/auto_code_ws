"""
# ============================================================
# 系统评测与集成校验 API（V4.1）
# ============================================================
# 核心作用：提供集成校验和系统评测的 RESTful API 端点，
#           支持运行集成检查、系统评测、获取评测报告、查询工作流状态
# 运行流程：
#   - POST /api/evaluation/integration/check - 运行集成校验
#   - POST /api/evaluation/system/evaluate - 运行系统评测
#   - GET /api/evaluation/report/{type} - 获取评测报告
#   - GET /api/evaluation/status - 获取评测工作流状态
# 输入参数：通过请求体和路径参数传递
# 输出结果：JSON 格式的校验/评测结果
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现评测与集成校验 API
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, Field

from ..config import settings
from ..services.integration_checker import (
    IntegrationChecker,
    IntegrationReport,
    CheckResult,
    CheckIssue,
    CheckStatus,
    CheckSeverity,
    integration_checker,
)
from ..services.system_evaluator import (
    SystemEvaluator,
    EvaluationReport,
    DimensionResult,
    EvalFinding,
    EvalGrade,
    EvalDimension,
    system_evaluator,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class IntegrationCheckRequest(BaseModel):
    """
    集成校验请求
    字段说明：
      - workspace_path: 工作空间根目录路径（必填）
      - modules: 模块路径列表（可选，用于接口兼容性和安全联动检查）
    """
    workspace_path: str = Field(..., min_length=1, description="工作空间根目录路径")
    modules: Optional[List[str]] = Field(default=None, description="模块路径列表")


class SystemEvaluateRequest(BaseModel):
    """
    系统评测请求
    字段说明：
      - workspace_path: 工作空间根目录路径（必填）
      - project: 项目信息字典（可选，包含 modules、description、architecture 等）
      - modules: 模块路径列表（可选，用于算法和实时性评测）
    """
    workspace_path: str = Field(..., min_length=1, description="工作空间根目录路径")
    project: Optional[Dict[str, Any]] = Field(default=None, description="项目信息")
    modules: Optional[List[str]] = Field(default=None, description="模块路径列表")


class IntegrationCheckResponse(BaseModel):
    """
    集成校验响应
    字段说明：
      - success: 是否执行成功
      - workspace_path: 校验的工作空间路径
      - overall_passed: 综合是否通过
      - overall_score: 综合评分（0-100）
      - check_results: 各项校验结果列表
      - total_issues: 问题总数
      - critical_count: 严重问题数
      - error_count: 错误问题数
      - warning_count: 警告问题数
      - info_count: 信息问题数
      - summary: 校验摘要
      - generated_at: 报告生成时间
    """
    success: bool
    workspace_path: str
    overall_passed: bool
    overall_score: float
    check_results: List[Dict[str, Any]]
    total_issues: int
    critical_count: int
    error_count: int
    warning_count: int
    info_count: int
    summary: str
    generated_at: str


class SystemEvaluateResponse(BaseModel):
    """
    系统评测响应
    字段说明：
      - success: 是否执行成功
      - workspace_path: 评测的工作空间路径
      - overall_grade: 综合评级（A-F）
      - overall_score: 综合评分（0-100）
      - iteration_count: 当前迭代次数
      - max_iterations: 最大迭代次数
      - dimension_results: 各维度评测结果
      - chapters: 8 章结构化报告
      - generated_at: 报告生成时间
    """
    success: bool
    workspace_path: str
    overall_grade: str
    overall_score: float
    iteration_count: int
    max_iterations: int
    dimension_results: List[Dict[str, Any]]
    chapters: Dict[str, Any]
    generated_at: str


class EvaluationStatusResponse(BaseModel):
    """
    评测工作流状态响应
    字段说明：
      - integration_check_available: 集成校验是否可用
      - system_evaluation_available: 系统评测是否可用
      - last_integration_check: 最近一次集成校验时间
      - last_system_evaluation: 最近一次系统评测时间
      - current_iteration: 当前评测迭代次数
      - max_iterations: 最大评测迭代次数
      - evaluation_config: 评测配置信息
    """
    integration_check_available: bool
    system_evaluation_available: bool
    last_integration_check: Optional[str]
    last_system_evaluation: Optional[str]
    current_iteration: int
    max_iterations: int
    evaluation_config: Dict[str, Any]


# ============================================================
# 辅助函数：将数据类转换为可 JSON 序列化的字典
# ============================================================

def _check_result_to_dict(cr: CheckResult) -> Dict[str, Any]:
    """
    将 CheckResult 数据类转换为字典
    参数：
      - cr: CheckResult 对象
    返回值：可 JSON 序列化的字典
    """
    return {
        "check_name": cr.check_name,
        "status": cr.status.value,
        "score": cr.score,
        "issues": [
            {
                "severity": issue.severity.value,
                "category": issue.category,
                "description": issue.description,
                "location": issue.location,
                "suggestion": issue.suggestion,
            }
            for issue in cr.issues
        ],
        "details": cr.details,
        "execution_time_ms": cr.execution_time_ms,
    }


def _dimension_result_to_dict(dr: DimensionResult) -> Dict[str, Any]:
    """
    将 DimensionResult 数据类转换为字典
    参数：
      - dr: DimensionResult 对象
    返回值：可 JSON 序列化的字典
    """
    return {
        "dimension": dr.dimension,
        "grade": dr.grade.value,
        "score": dr.score,
        "findings": [
            {
                "dimension": f.dimension,
                "grade": f.grade.value,
                "score": f.score,
                "strength": f.strength,
                "weakness": f.weakness,
                "suggestion": f.suggestion,
                "details": f.details,
            }
            for f in dr.findings
        ],
        "metrics": dr.metrics,
        "execution_time_ms": dr.execution_time_ms,
    }


# ============================================================
# API 端点
# ============================================================

@router.post("/integration/check", response_model=IntegrationCheckResponse)
async def run_integration_check(request: Request, body: IntegrationCheckRequest):
    """
    运行集成校验
    运行步骤：
      1. 校验请求参数
      2. 调用 IntegrationChecker.full_integration_check() 执行六维集成校验
      3. 转换结果为 JSON 响应
    调用方：前端评测面板、任务执行引擎
    被调用方：IntegrationChecker
    参数：
      - body: IntegrationCheckRequest
    返回值：IntegrationCheckResponse
    """
    logger.info(
        f"收到集成校验请求 | workspace={body.workspace_path} | "
        f"modules={len(body.modules) if body.modules else 0}"
    )

    try:
        report = integration_checker.full_integration_check(
            workspace_path=body.workspace_path,
            modules=body.modules,
        )

        return IntegrationCheckResponse(
            success=True,
            workspace_path=report.workspace_path,
            overall_passed=report.overall_passed,
            overall_score=report.overall_score,
            check_results=[_check_result_to_dict(cr) for cr in report.check_results],
            total_issues=report.total_issues,
            critical_count=report.critical_count,
            error_count=report.error_count,
            warning_count=report.warning_count,
            info_count=report.info_count,
            summary=report.summary,
            generated_at=report.generated_at,
        )
    except Exception as e:
        logger.error(f"集成校验执行失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"集成校验执行失败: {str(e)}")


@router.post("/system/evaluate", response_model=SystemEvaluateResponse)
async def run_system_evaluation(request: Request, body: SystemEvaluateRequest):
    """
    运行系统评测
    运行步骤：
      1. 校验请求参数
      2. 调用 SystemEvaluator.full_evaluation() 执行六维系统评测
      3. 构建 8 章结构化报告
      4. 转换结果为 JSON 响应
    调用方：前端评测面板、任务执行引擎
    被调用方：SystemEvaluator
    参数：
      - body: SystemEvaluateRequest
    返回值：SystemEvaluateResponse
    """
    logger.info(
        f"收到系统评测请求 | workspace={body.workspace_path} | "
        f"project={bool(body.project)} | modules={len(body.modules) if body.modules else 0}"
    )

    try:
        report = system_evaluator.full_evaluation(
            workspace_path=body.workspace_path,
            project=body.project,
            modules=body.modules,
        )

        # 构建 8 章结构化报告
        chapters = {
            "chapter_1": report.chapter_1_summary,
            "chapter_2": report.chapter_2_architecture,
            "chapter_3": report.chapter_3_code_quality,
            "chapter_4": report.chapter_4_algorithms,
            "chapter_5": report.chapter_5_realtime,
            "chapter_6": report.chapter_6_security,
            "chapter_7": report.chapter_7_engineering,
            "chapter_8": report.chapter_8_recommendations,
        }

        return SystemEvaluateResponse(
            success=True,
            workspace_path=report.workspace_path,
            overall_grade=report.overall_grade.value,
            overall_score=report.overall_score,
            iteration_count=report.iteration_count,
            max_iterations=report.max_iterations,
            dimension_results=[
                _dimension_result_to_dict(dr) for dr in report.dimension_results
            ],
            chapters=chapters,
            generated_at=report.generated_at,
        )
    except Exception as e:
        logger.error(f"系统评测执行失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"系统评测执行失败: {str(e)}")


@router.get("/report/{report_type}")
async def get_evaluation_report(
    request: Request,
    report_type: str,
):
    """
    获取评测报告
    运行步骤：
      1. 根据 report_type 获取对应的报告
      2. integration: 返回最近一次集成校验报告
      3. evaluation: 返回最近一次系统评测报告
    调用方：前端评测报告面板
    被调用方：IntegrationChecker / SystemEvaluator
    参数：
      - report_type: 报告类型（integration / evaluation）
    返回值：JSON 格式的评测报告
    """
    if report_type not in ("integration", "evaluation"):
        raise HTTPException(
            status_code=400,
            detail=f"无效的报告类型: {report_type}，有效值: integration, evaluation",
        )

    if report_type == "integration":
        report = integration_checker.get_last_report()
        if report is None:
            raise HTTPException(
                status_code=404,
                detail="尚未执行集成校验，请先调用 POST /api/evaluation/integration/check",
            )

        return {
            "success": True,
            "report_type": "integration",
            "workspace_path": report.workspace_path,
            "overall_passed": report.overall_passed,
            "overall_score": report.overall_score,
            "check_results": [_check_result_to_dict(cr) for cr in report.check_results],
            "total_issues": report.total_issues,
            "critical_count": report.critical_count,
            "error_count": report.error_count,
            "warning_count": report.warning_count,
            "info_count": report.info_count,
            "summary": report.summary,
            "generated_at": report.generated_at,
        }

    elif report_type == "evaluation":
        report = system_evaluator.get_last_report()
        if report is None:
            raise HTTPException(
                status_code=404,
                detail="尚未执行系统评测，请先调用 POST /api/evaluation/system/evaluate",
            )

        chapters = {
            "chapter_1": report.chapter_1_summary,
            "chapter_2": report.chapter_2_architecture,
            "chapter_3": report.chapter_3_code_quality,
            "chapter_4": report.chapter_4_algorithms,
            "chapter_5": report.chapter_5_realtime,
            "chapter_6": report.chapter_6_security,
            "chapter_7": report.chapter_7_engineering,
            "chapter_8": report.chapter_8_recommendations,
        }

        return {
            "success": True,
            "report_type": "evaluation",
            "workspace_path": report.workspace_path,
            "overall_grade": report.overall_grade.value,
            "overall_score": report.overall_score,
            "iteration_count": report.iteration_count,
            "max_iterations": report.max_iterations,
            "dimension_results": [
                _dimension_result_to_dict(dr) for dr in report.dimension_results
            ],
            "chapters": chapters,
            "generated_at": report.generated_at,
        }


@router.get("/status", response_model=EvaluationStatusResponse)
async def get_evaluation_status(request: Request):
    """
    获取评测工作流状态
    运行步骤：
      1. 检查集成校验器和系统评测器是否可用
      2. 获取最近一次校验/评测时间
      3. 获取当前迭代次数和配置信息
    调用方：前端评测状态面板
    被调用方：IntegrationChecker / SystemEvaluator / settings
    返回值：EvaluationStatusResponse
    """
    # 获取集成校验状态
    last_integration = integration_checker.get_last_report()
    last_integration_time = last_integration.generated_at if last_integration else None

    # 获取系统评测状态
    last_evaluation = system_evaluator.get_last_report()
    last_evaluation_time = last_evaluation.generated_at if last_evaluation else None

    # 获取评测配置
    eval_config = settings.evaluation

    return EvaluationStatusResponse(
        integration_check_available=True,
        system_evaluation_available=True,
        last_integration_check=last_integration_time,
        last_system_evaluation=last_evaluation_time,
        current_iteration=system_evaluator.iteration_count,
        max_iterations=eval_config.get("max_iterations", 2),
        evaluation_config={
            "max_iterations": eval_config.get("max_iterations", 2),
        },
    )
