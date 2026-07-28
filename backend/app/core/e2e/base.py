"""
# ============================================================
# E2E 数据模型与工具函数
# ============================================================
# 核心作用：定义 E2E 框架的数据类、枚举、工具函数
# 包含：ScenarioContext / ScenarioResult / TestReport / E2EConfig
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional


class Status(str, Enum):
    """场景/步骤状态枚举"""
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    SKIPPED = "skipped"
    RUNNING = "running"


class ReportFormat(str, Enum):
    """报告格式枚举"""
    HTML = "html"
    JSON = "json"
    MARKDOWN = "markdown"


# ============================================================
# 工具函数
# ============================================================
def generate_report_id() -> str:
    """生成报告 ID"""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"e2e_{ts}_{uuid.uuid4().hex[:6]}"


def generate_scenario_id(name: str) -> str:
    """生成场景 ID（基于名称）"""
    safe = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_")
    return f"sc_{safe}"


# 路径白名单 - 防止任意目录访问
ALLOWED_PATH_PATTERNS = [
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/tmp/e2e_"),
    re.compile(r"^/tmp/test-e2e"),
    re.compile(r"^/tmp/pytest-of-"),  # pytest 临时目录
    re.compile(r"^/tmp/tmp"),  # pytest 临时目录（备选）
    re.compile(r"^/home/qizheng/.hermes/e2e"),
]


def safe_path(path: str) -> Path:
    """
    校验路径是否在白名单内，返回 Path 对象
    任何 /home/qizheng/auto_code_ws 路径均允许
    防止访问系统敏感目录
    """
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_PATH_PATTERNS:
        if pattern.match(path_str):
            return p
    raise ValueError(f"path not in whitelist: {path_str}")


# ============================================================
# 数据类
# ============================================================
@dataclass
class E2EConfig:
    """E2E 测试配置"""
    # 后端地址
    backend_url: str = "http://localhost:8765"
    # 前端地址
    frontend_url: str = "http://localhost:5173"
    # 测试产物目录
    artifacts_dir: str = "/home/qizheng/auto_code_ws/tests/e2e_reports"
    # 视觉基线目录
    baselines_dir: str = "/home/qizheng/auto_code_ws/tests/e2e_baselines"
    # 单场景超时（秒）
    scenario_timeout: int = 60
    # 总测试超时（秒）
    total_timeout: int = 600
    # 视觉漂移阈值（0-1）
    drift_threshold: float = 0.05
    # 重试次数
    max_retries: int = 3
    # 失败时截图
    screenshot_on_failure: bool = True
    # 串行/并行
    parallel: bool = False
    # 浏览器驱动类型
    browser_driver: str = "mock"  # mock / cdp / playwright

    @classmethod
    def from_env(cls) -> "E2EConfig":
        """从环境变量加载配置"""
        return cls(
            backend_url=os.getenv("E2E_BACKEND_URL", "http://localhost:8765"),
            frontend_url=os.getenv("E2E_FRONTEND_URL", "http://localhost:5173"),
            artifacts_dir=os.getenv("E2E_ARTIFACTS_DIR", "/home/qizheng/auto_code_ws/tests/e2e_reports"),
            baselines_dir=os.getenv("E2E_BASELINES_DIR", "/home/qizheng/auto_code_ws/tests/e2e_baselines"),
            scenario_timeout=int(os.getenv("E2E_SCENARIO_TIMEOUT", "60")),
            max_retries=int(os.getenv("E2E_MAX_RETRIES", "3")),
        )


@dataclass
class StepResult:
    """单步骤结果"""
    name: str
    status: str  # passed/failed/error/skipped
    start_time: str
    end_time: str
    duration_ms: int
    message: str = ""
    error: Optional[str] = None
    screenshot: Optional[str] = None  # 截图路径

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ScenarioContext:
    """场景执行上下文"""
    scenario_id: str
    scenario_name: str
    start_time: str
    config: E2EConfig
    state: Dict[str, Any] = field(default_factory=dict)
    artifacts_dir: Optional[Path] = None
    api: Optional[Any] = None  # ApiDriver
    browser: Optional[Any] = None  # BrowserDriver

    def get_state(self, key: str, default: Any = None) -> Any:
        """获取场景间共享状态"""
        return self.state.get(key, default)

    def set_state(self, key: str, value: Any) -> None:
        """设置场景间共享状态"""
        self.state[key] = value


@dataclass
class ScenarioResult:
    """场景执行结果"""
    scenario_id: str
    scenario_name: str
    status: str
    start_time: str
    end_time: str
    duration_ms: int
    description: str = ""
    steps: List[StepResult] = field(default_factory=list)
    screenshots: List[str] = field(default_factory=list)
    error: Optional[str] = None
    error_stack: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["steps"] = [s.to_dict() if isinstance(s, StepResult) else s for s in self.steps]
        return d

    def passed(self) -> bool:
        return self.status == Status.PASSED.value

    def add_step(self, step: StepResult) -> None:
        self.steps.append(step)


@dataclass
class TestReport:
    """测试报告（聚合多个场景结果）"""
    report_id: str
    timestamp: str
    duration_ms: int
    total_scenarios: int
    passed: int = 0
    failed: int = 0
    error: int = 0
    skipped: int = 0
    results: List[ScenarioResult] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["results"] = [r.to_dict() if isinstance(r, ScenarioResult) else r for r in self.results]
        return d

    def pass_rate(self) -> float:
        if self.total_scenarios == 0:
            return 0.0
        return self.passed / self.total_scenarios

    def add_result(self, result: ScenarioResult) -> None:
        self.results.append(result)
        self.total_scenarios += 1
        if result.status == Status.PASSED.value:
            self.passed += 1
        elif result.status == Status.FAILED.value:
            self.failed += 1
        elif result.status == Status.ERROR.value:
            self.error += 1
        elif result.status == Status.SKIPPED.value:
            self.skipped += 1
