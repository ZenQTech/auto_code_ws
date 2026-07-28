"""
# ============================================================
# 场景基类与注册表
# ============================================================
# 核心作用：定义 E2E 场景的基类与注册表
# 特性：生命周期管理、步骤执行、错误捕获、状态共享
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Type

from .base import (
    E2EConfig,
    ScenarioContext,
    ScenarioResult,
    Status,
    StepResult,
    generate_scenario_id,
    safe_path,
)

logger = logging.getLogger(__name__)


class BaseScenario:
    """
    E2E 场景基类
    所有场景继承此类并实现 run 方法
    """

    # 场景元数据（子类必须覆盖）
    name: str = "base_scenario"
    description: str = ""
    priority: int = 50  # 0-100,数字越大越优先
    timeout: int = 60  # 秒
    tags: List[str] = []

    def __init__(self):
        self.scenario_id = generate_scenario_id(self.name)
        self.config: Optional[E2EConfig] = None
        self.context: Optional[ScenarioContext] = None
        self.result: Optional[ScenarioResult] = None

    # ============================================================
    # 生命周期钩子（子类可覆盖）
    # ============================================================
    def setup(self, ctx: ScenarioContext) -> None:
        """场景执行前准备（默认无操作）"""
        pass

    def teardown(self, ctx: ScenarioContext) -> None:
        """场景执行后清理（默认无操作）"""
        pass

    # ============================================================
    # 主方法（子类必须实现）
    # ============================================================
    def run(self, ctx: ScenarioContext) -> ScenarioResult:
        """执行场景（子类必须实现）"""
        raise NotImplementedError(f"{self.__class__.__name__}.run() not implemented")

    # ============================================================
    # 辅助方法
    # ============================================================
    def step(self, name: str) -> "StepContext":
        """步骤上下文管理器（自动记录步骤结果）"""
        return StepContext(self, name)

    def assert_true(self, condition: bool, message: str = "") -> None:
        """断言为真"""
        if not condition:
            raise AssertionError(message or "assertion failed")

    def assert_equal(self, actual: Any, expected: Any, message: str = "") -> None:
        """断言相等"""
        if actual != expected:
            raise AssertionError(
                message or f"expected {expected!r}, got {actual!r}"
            )

    def assert_contains(self, haystack: str, needle: str, message: str = "") -> None:
        """断言包含"""
        if needle not in haystack:
            raise AssertionError(
                message or f"expected to contain {needle!r}, got {haystack!r}"
            )

    def get_state(self, key: str, default: Any = None) -> Any:
        """获取场景间共享状态"""
        if self.context:
            return self.context.get_state(key, default)
        return default

    def set_state(self, key: str, value: Any) -> None:
        """设置场景间共享状态"""
        if self.context:
            self.context.set_state(key, value)

    def take_screenshot(self, name: str = "step") -> str:
        """在当前步骤中截图"""
        if self.context and self.context.browser:
            return self.context.browser.screenshot(name)
        return ""


class StepContext:
    """步骤上下文管理器 - 自动记录步骤结果到 ScenarioResult"""

    def __init__(self, scenario: BaseScenario, name: str):
        self.scenario = scenario
        self.name = name
        self.start_time: Optional[str] = None
        self.end_time: Optional[str] = None
        self.duration_ms: int = 0
        self.status: str = Status.RUNNING.value
        self.message: str = ""
        self.error: Optional[str] = None
        self.screenshot: Optional[str] = None
        self._start_ts: float = 0.0

    def __enter__(self) -> "StepContext":
        self._start_ts = time.time()
        self.start_time = datetime.now(timezone.utc).isoformat()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self._end_ts = time.time()
        self.duration_ms = int((self._end_ts - self._start_ts) * 1000)
        self.end_time = datetime.now(timezone.utc).isoformat()

        if exc_type is None:
            self.status = Status.PASSED.value
        elif exc_type is AssertionError:
            self.status = Status.FAILED.value
            self.error = str(exc_val)
        else:
            self.status = Status.ERROR.value
            self.error = str(exc_val)

        # 记录到场景结果
        if self.scenario.result:
            step_result = StepResult(
                name=self.name,
                status=self.status,
                start_time=self.start_time,
                end_time=self.end_time,
                duration_ms=self.duration_ms,
                message=self.message,
                error=self.error,
                screenshot=self.screenshot,
            )
            self.scenario.result.add_step(step_result)

        # 不吞异常，让上层捕获
        return False

    def set_message(self, msg: str) -> None:
        """设置步骤消息"""
        self.message = msg

    def attach_screenshot(self, path: str) -> None:
        """附加截图"""
        self.screenshot = path


class ScenarioRegistry:
    """
    场景注册表
    管理所有可执行的 E2E 场景
    """

    def __init__(self):
        self._scenarios: Dict[str, BaseScenario] = {}

    def register(self, scenario: BaseScenario) -> None:
        """注册场景"""
        if scenario.scenario_id in self._scenarios:
            logger.warning(f"scenario {scenario.scenario_id} already registered, overwriting")
        self._scenarios[scenario.scenario_id] = scenario
        logger.info(f"registered scenario: {scenario.scenario_id} ({scenario.name})")

    def register_class(self, scenario_cls: Type[BaseScenario]) -> None:
        """注册场景类（自动实例化）"""
        scenario = scenario_cls()
        self.register(scenario)

    def get(self, scenario_id: str) -> Optional[BaseScenario]:
        """按 ID 获取场景"""
        return self._scenarios.get(scenario_id)

    def list_all(self) -> List[BaseScenario]:
        """列出所有场景（按优先级排序）"""
        return sorted(
            self._scenarios.values(),
            key=lambda s: (-s.priority, s.scenario_id),
        )

    def list_by_tag(self, tag: str) -> List[BaseScenario]:
        """按 tag 过滤"""
        return [s for s in self.list_all() if tag in s.tags]

    def count(self) -> int:
        """场景总数"""
        return len(self._scenarios)

    def clear(self) -> None:
        """清空注册表"""
        self._scenarios.clear()

    def to_dict_list(self) -> List[Dict[str, Any]]:
        """导出场景元信息列表"""
        return [
            {
                "scenario_id": s.scenario_id,
                "name": s.name,
                "description": s.description,
                "priority": s.priority,
                "timeout": s.timeout,
                "tags": s.tags,
            }
            for s in self.list_all()
        ]
