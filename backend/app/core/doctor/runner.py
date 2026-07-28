"""
# ============================================================
# Hermes Doctor - 主调度器
# ============================================================
# 核心作用：并行执行 6 大类诊断，聚合结果，生成报告
# 运行流程：
#   1. 初始化 6 个 checker
#   2. 并行执行（ThreadPoolExecutor）
#   3. 聚合分类报告为 DoctorReport
#   4. 调用 finalize() 计算总状态
#   5. 返回报告（供 REST API / CLI 使用）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import (
    BaseChecker,
    CategoryReport,
    DoctorReport,
    generate_report_id,
    get_hostname,
)
from .checkers import (
    DatabaseChecker,
    DependenciesChecker,
    EnvironmentChecker,
    LLMChecker,
    MCPChecker,
    WorkspaceChecker,
)

logger = logging.getLogger(__name__)


# Hermes 版本（可注入）
HERMES_VERSION = "6.15.0"


# ============================================================
# 6 大类检查器映射
# ============================================================
CHECKER_REGISTRY: Dict[str, type] = {
    "environment": EnvironmentChecker,
    "workspace": WorkspaceChecker,
    "llm": LLMChecker,
    "database": DatabaseChecker,
    "mcp": MCPChecker,
    "dependencies": DependenciesChecker,
}


CATEGORY_TITLES = {
    "environment": "环境变量",
    "workspace": "工作区状态",
    "llm": "LLM API",
    "database": "数据库",
    "mcp": "MCP 服务器",
    "dependencies": "依赖项",
}


# ============================================================
# DoctorRunner
# ============================================================
class DoctorRunner:
    """诊断主调度器"""

    def __init__(
        self,
        hermes_home: Optional[Path] = None,
        project_path: Optional[Path] = None,
        hermes_version: str = HERMES_VERSION,
    ):
        """
        参数：
          - hermes_home: ~/.hermes 路径
          - project_path: 项目工作目录
          - hermes_version: Hermes 版本号
        """
        self.hermes_home = hermes_home or Path.home() / ".hermes"
        self.project_path = project_path or Path.cwd()
        self.hermes_version = hermes_version

    def _make_checker(self, category: str) -> BaseChecker:
        """创建 checker 实例"""
        cls = CHECKER_REGISTRY.get(category)
        if not cls:
            raise ValueError(f"unknown category: {category}")
        return cls(hermes_home=self.hermes_home, project_path=self.project_path)

    def run_category(self, category: str) -> CategoryReport:
        """运行单个分类诊断"""
        try:
            checker = self._make_checker(category)
            return checker.run_with_timeout()
        except Exception as e:
            logger.exception(f"doctor category {category} failed: {e}")
            report = CategoryReport(category=category, title=CATEGORY_TITLES.get(category, category))
            report.error = str(e)
            report.add_item(_error_item(category, str(e)))
            report.finalize()
            return report

    def run_all(
        self,
        parallel: bool = True,
        categories: Optional[List[str]] = None,
    ) -> DoctorReport:
        """
        运行完整诊断
        参数：
          - parallel: 是否并行执行（默认 True）
          - categories: 指定分类列表（None = 全部 6 类）
        """
        start = time.time()
        cats = categories or list(CHECKER_REGISTRY.keys())
        report = DoctorReport(
            report_id=generate_report_id(),
            timestamp=datetime.now(timezone.utc).isoformat(),
            hostname=get_hostname(),
            hermes_version=self.hermes_version,
        )

        if parallel:
            report.categories = self._run_parallel(cats)
        else:
            for cat in cats:
                report.categories[cat] = self.run_category(cat)

        report.duration_ms = int((time.time() - start) * 1000)
        report.finalize()
        return report

    def _run_parallel(self, categories: List[str]) -> Dict[str, CategoryReport]:
        """并行执行诊断"""
        results: Dict[str, CategoryReport] = {}
        with ThreadPoolExecutor(max_workers=6) as executor:
            future_to_category = {
                executor.submit(self.run_category, cat): cat
                for cat in categories
            }
            for future in as_completed(future_to_category):
                cat = future_to_category[future]
                try:
                    results[cat] = future.result()
                except Exception as e:
                    logger.exception(f"doctor parallel {cat} failed: {e}")
                    results[cat] = _error_category(cat, str(e))
        return results


# ============================================================
# 辅助函数
# ============================================================
def _error_item(category: str, error: str):
    """生成错误状态 CheckItem"""
    from .base import CheckItem, CheckStatus
    return CheckItem(
        id=f"{category}.runner_error",
        name="Runner Error",
        category=category,
        description=f"诊断器 {category} 执行失败",
        status=CheckStatus.ERROR.value,
        message=error,
        fix_suggestion="查看日志并重试",
    )


def _error_category(category: str, error: str) -> CategoryReport:
    """生成错误状态 CategoryReport"""
    report = CategoryReport(
        category=category,
        title=CATEGORY_TITLES.get(category, category),
        error=error,
    )
    report.add_item(_error_item(category, error))
    report.finalize()
    return report


# ============================================================
# 全局单例
# ============================================================
_runner_instance: Optional[DoctorRunner] = None
_runner_lock = __import__("threading").RLock()


def get_doctor_runner(
    hermes_home: Optional[Path] = None,
    project_path: Optional[Path] = None,
) -> DoctorRunner:
    """获取全局 DoctorRunner 单例"""
    global _runner_instance
    with _runner_lock:
        if _runner_instance is None:
            _runner_instance = DoctorRunner(hermes_home, project_path)
        return _runner_instance


def reset_doctor_runner() -> None:
    """重置单例（用于测试）"""
    global _runner_instance
    with _runner_lock:
        _runner_instance = None
