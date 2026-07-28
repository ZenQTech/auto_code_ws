"""
# ============================================================
# E2E 测试框架 - Playwright 风格前端自动化
# ============================================================
# 核心作用：提供零外部依赖的前端 E2E 自动化框架
# 包含：8 大核心场景、视觉回归、报告生成、CI 集成
# Cycle 11 P2-1 新建
# ============================================================
"""

from .base import (
    E2EConfig,
    ScenarioContext,
    ScenarioResult,
    StepResult,
    TestReport,
    Status,
    ReportFormat,
    generate_report_id,
    generate_scenario_id,
    safe_path,
)
from .api_driver import ApiDriver
from .browser_driver import BrowserDriver
from .scenario import BaseScenario, ScenarioRegistry
from .visual import VisualRegression
from .report import ReportGenerator
from .retry import RetryStrategy, retry_with_backoff
from .runner import PlaywrightE2ERunner

__all__ = [
    "E2EConfig",
    "ScenarioContext",
    "ScenarioResult",
    "StepResult",
    "TestReport",
    "Status",
    "ReportFormat",
    "generate_report_id",
    "generate_scenario_id",
    "safe_path",
    "ApiDriver",
    "BrowserDriver",
    "BaseScenario",
    "ScenarioRegistry",
    "VisualRegression",
    "ReportGenerator",
    "RetryStrategy",
    "retry_with_backoff",
    "PlaywrightE2ERunner",
]
