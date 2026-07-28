"""
# ============================================================
# E2E 主调度器
# ============================================================
# 核心作用：编排所有场景的执行、聚合结果、生成报告
# 特性：串行/并行、setup/teardown、错误隔离、报告生成
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .api_driver import ApiDriver
from .base import (
    E2EConfig,
    ScenarioContext,
    ScenarioResult,
    Status,
    TestReport,
    generate_report_id,
    safe_path,
)
from .browser_driver import BrowserDriver
from .report import ReportGenerator
from .retry import RetryStrategy
from .scenario import BaseScenario, ScenarioRegistry
from .visual import VisualRegression

logger = logging.getLogger(__name__)


class PlaywrightE2ERunner:
    """
    E2E 主调度器
    - 加载所有注册场景
    - 串行/并行执行
    - 统一 setup/teardown
    - 聚合结果生成报告
    """

    def __init__(self, config: Optional[E2EConfig] = None):
        self.config = config or E2EConfig.from_env()
        self.registry = ScenarioRegistry()
        self.api = ApiDriver(
            base_url=self.config.backend_url,
            timeout=60,  # 默认 60s（doctor/run 可能耗时较长）
            max_retries=self.config.max_retries,
        )
        self.browser: Optional[BrowserDriver] = None
        self.visual = VisualRegression(
            baselines_dir=self.config.baselines_dir,
            drift_threshold=self.config.drift_threshold,
        )
        self.report_generator = ReportGenerator(self.config.artifacts_dir)
        self.retry_strategy = RetryStrategy(max_retries=self.config.max_retries)
        self._state: Dict[str, Any] = {}
        # 预注册默认场景
        self._register_default_scenarios()

    def _register_default_scenarios(self) -> None:
        """注册 8 大核心场景"""
        from .scenarios import (
            S1AppStartup,
            S2ModeSwitch,
            S3SessionManagement,
            S4MessageStreaming,
            S5Clarification,
            S6ArchitectureDesign,
            S7DoctorDiagnosis,
            S8E2ERegression,
        )
        for cls in [
            S1AppStartup, S2ModeSwitch, S3SessionManagement, S4MessageStreaming,
            S5Clarification, S6ArchitectureDesign, S7DoctorDiagnosis, S8E2ERegression,
        ]:
            self.registry.register_class(cls)

    def register(self, scenario: BaseScenario) -> None:
        """注册自定义场景"""
        self.registry.register(scenario)

    def get_state(self, key: str, default: Any = None) -> Any:
        """获取全局状态"""
        return self._state.get(key, default)

    def set_state(self, key: str, value: Any) -> None:
        """设置全局状态"""
        self._state[key] = value

    def run_scenario(self, scenario: BaseScenario) -> ScenarioResult:
        """执行单个场景（同步实现，可在任意线程中调用）"""
        scenario.config = self.config
        start_iso = datetime.now(timezone.utc).isoformat()
        start_ts = time.time()
        artifacts_dir = safe_path(self.config.artifacts_dir) / scenario.scenario_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        # 创建浏览器驱动（每个场景独立）
        browser = BrowserDriver(
            headless=True,
            timeout=self.config.scenario_timeout,
            screenshots_dir=str(artifacts_dir / "screenshots"),
        )
        browser.launch()

        ctx = ScenarioContext(
            scenario_id=scenario.scenario_id,
            scenario_name=scenario.name,
            start_time=start_iso,
            config=self.config,
            state=dict(self._state),
            artifacts_dir=artifacts_dir,
            api=self.api,
            browser=browser,
        )
        scenario.context = ctx
        result = ScenarioResult(
            scenario_id=scenario.scenario_id,
            scenario_name=scenario.name,
            status=Status.RUNNING.value,
            start_time=start_iso,
            end_time="",
            duration_ms=0,
            description=scenario.description,
        )
        scenario.result = result

        try:
            # setup
            scenario.setup(ctx)
            # 注入全局状态到 localStorage
            if self._state:
                browser.set_local_storage_dump({k: json.dumps(v) for k, v in self._state.items() if isinstance(v, (str, int, float, bool))})
            # run
            run_result = scenario.run(ctx)
            # run 可能直接返回结果（子类已填充）
            if isinstance(run_result, ScenarioResult):
                result = run_result
        except AssertionError as e:
            result.status = Status.FAILED.value
            result.error = str(e)
            logger.error(f"scenario {scenario.scenario_id} failed: {e}")
        except Exception as e:
            result.status = Status.ERROR.value
            result.error = str(e)
            result.error_stack = traceback.format_exc()
            logger.error(f"scenario {scenario.scenario_id} error: {e}\n{traceback.format_exc()}")
            # 失败时自动截图
            if self.config.screenshot_on_failure:
                try:
                    shot = browser.screenshot("failure")
                    result.screenshots.append(shot)
                except Exception:
                    pass
        finally:
            try:
                scenario.teardown(ctx)
            except Exception as e:
                logger.warning(f"teardown error: {e}")
            browser.close()

        end_iso = datetime.now(timezone.utc).isoformat()
        end_ts = time.time()
        result.end_time = end_iso
        result.duration_ms = int((end_ts - start_ts) * 1000)
        if result.status == Status.RUNNING.value:
            result.status = Status.PASSED.value

        # 提取全局状态
        if browser and result.passed():
            ls = browser.get_local_storage_dump()
            for k, v in ls.items():
                try:
                    self._state[k] = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    self._state[k] = v

        return result

    def run_all(
        self,
        scenario_ids: Optional[List[str]] = None,
        parallel: Optional[bool] = None,
    ) -> TestReport:
        """执行所有场景（或指定场景）- 同步实现"""
        import concurrent.futures

        start_ts = time.time()
        report = TestReport(
            report_id=generate_report_id(),
            timestamp=datetime.now(timezone.utc).isoformat(),
            duration_ms=0,
            total_scenarios=0,
        )
        # 选择场景
        if scenario_ids:
            scenarios = [self.registry.get(sid) for sid in scenario_ids if self.registry.get(sid)]
            scenarios = [s for s in scenarios if s]
        else:
            scenarios = self.registry.list_all()

        # 注：不在此处设置 total_scenarios，由 add_result 负责累计
        parallel = parallel if parallel is not None else self.config.parallel
        logger.info(f"running {len(scenarios)} scenarios (parallel={parallel})")

        if parallel:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
                futures = {ex.submit(self.run_scenario, s): s for s in scenarios}
                for fut in concurrent.futures.as_completed(futures):
                    s = futures[fut]
                    try:
                        r = fut.result()
                        report.add_result(r)
                    except Exception as e:
                        logger.error(f"scenario {s.scenario_id} raised: {e}")
        else:
            for s in scenarios:
                try:
                    r = self.run_scenario(s)
                    report.add_result(r)
                except Exception as e:
                    logger.error(f"scenario {s.scenario_id} raised: {e}")

        end_ts = time.time()
        report.duration_ms = int((end_ts - start_ts) * 1000)
        # 生成报告
        paths = self.report_generator.generate(report)
        report.metadata = {"report_paths": paths}
        logger.info(
            f"completed: {report.passed}/{report.total_scenarios} passed, "
            f"{report.failed} failed, {report.error} error, {report.skipped} skipped"
        )
        return report

    async def run_all_async(
        self,
        scenario_ids: Optional[List[str]] = None,
        parallel: Optional[bool] = None,
    ) -> TestReport:
        """异步包装：在独立线程中执行 run_all"""
        import asyncio
        import concurrent.futures

        def _execute():
            return self.run_all(scenario_ids, parallel)

        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_execute)
            return await loop.run_in_executor(None, future.result)

    def list_scenarios(self) -> List[Dict[str, Any]]:
        """列出所有场景"""
        return self.registry.to_dict_list()

    def list_reports(self, limit: int = 20) -> List[Dict[str, Any]]:
        """列出历史报告（按文件）"""
        reports_dir = Path(self.config.artifacts_dir)
        results: List[Dict[str, Any]] = []
        for json_file in sorted(reports_dir.glob("e2e_*.json"), reverse=True)[:limit]:
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                results.append({
                    "report_id": data.get("report_id"),
                    "timestamp": data.get("timestamp"),
                    "total_scenarios": data.get("total_scenarios"),
                    "passed": data.get("passed"),
                    "failed": data.get("failed"),
                    "error": data.get("error"),
                    "duration_ms": data.get("duration_ms"),
                })
            except Exception:
                continue
        return results

    def get_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        """获取报告详情"""
        report_path = Path(self.config.artifacts_dir) / f"{report_id}.json"
        if not report_path.exists():
            return None
        try:
            return json.loads(report_path.read_text(encoding="utf-8"))
        except Exception:
            return None
