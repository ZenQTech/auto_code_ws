"""
# ============================================================
# E2E 单元测试 - P2-1 Playwright
# ============================================================
# 核心作用：覆盖 E2E 框架所有核心模块的单元测试
# 包含：data models / driver / scenario / visual / report / retry
# Cycle 11 P2-1 新建
# ============================================================
"""

import asyncio
import base64
import json
import os
import time
import pytest
import tempfile
from pathlib import Path
from typing import Any, Dict

# 导入被测模块
from app.core.e2e import (
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
    ApiDriver,
    BrowserDriver,
    BaseScenario,
    ScenarioRegistry,
    VisualRegression,
    ReportGenerator,
    RetryStrategy,
    retry_with_backoff,
    PlaywrightE2ERunner,
)


# ============================================================
# Fixtures
# ============================================================
@pytest.fixture
def temp_dir():
    """临时目录"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def temp_hermes_home(tmp_path, monkeypatch):
    """临时 HERMES_HOME"""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    yield home


@pytest.fixture
def config(temp_dir):
    """E2E 配置"""
    return E2EConfig(
        backend_url="http://localhost:8765",
        frontend_url="http://localhost:5173",
        artifacts_dir=os.path.join(temp_dir, "reports"),
        baselines_dir=os.path.join(temp_dir, "baselines"),
        scenario_timeout=30,
        max_retries=2,
    )


# ============================================================
# Test: Data Models
# ============================================================
class TestDataModels:
    """数据模型测试"""

    def test_status_enum(self):
        assert Status.PASSED.value == "passed"
        assert Status.FAILED.value == "failed"
        assert Status.ERROR.value == "error"
        assert Status.SKIPPED.value == "skipped"

    def test_report_format_enum(self):
        assert ReportFormat.HTML.value == "html"
        assert ReportFormat.JSON.value == "json"
        assert ReportFormat.MARKDOWN.value == "markdown"

    def test_generate_report_id(self):
        rid = generate_report_id()
        assert rid.startswith("e2e_")
        assert len(rid) > 10

    def test_generate_scenario_id(self):
        sid = generate_scenario_id("My Test Scenario!")
        assert sid.startswith("sc_")
        assert " " not in sid
        assert "!" not in sid

    def test_safe_path_allowed(self):
        p = safe_path("/home/qizheng/auto_code_ws/tests/foo")
        assert isinstance(p, Path)

    def test_safe_path_rejected(self):
        with pytest.raises(ValueError):
            safe_path("/etc/passwd")

    def test_step_result_to_dict(self):
        s = StepResult(
            name="step1",
            status="passed",
            start_time="2026-07-28T00:00:00Z",
            end_time="2026-07-28T00:00:01Z",
            duration_ms=1000,
        )
        d = s.to_dict()
        assert d["name"] == "step1"
        assert d["status"] == "passed"

    def test_scenario_context_state(self):
        ctx = ScenarioContext(
            scenario_id="sc_test",
            scenario_name="test",
            start_time="2026-07-28T00:00:00Z",
            config=E2EConfig(),
        )
        ctx.set_state("foo", "bar")
        assert ctx.get_state("foo") == "bar"
        assert ctx.get_state("missing", "default") == "default"

    def test_test_report_pass_rate(self):
        report = TestReport(
            report_id="e2e_test",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=1000,
            total_scenarios=10,
            passed=8,
            failed=2,
        )
        assert report.pass_rate() == 0.8

    def test_test_report_add_result(self):
        report = TestReport(
            report_id="e2e_test",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=0,
            total_scenarios=0,
        )
        for status in ["passed", "failed", "error", "skipped"]:
            r = ScenarioResult(
                scenario_id=f"sc_{status}",
                scenario_name=status,
                status=status,
                start_time="",
                end_time="",
                duration_ms=0,
            )
            report.add_result(r)
        assert report.passed == 1
        assert report.failed == 1
        assert report.error == 1
        assert report.skipped == 1
        assert report.total_scenarios == 4


# ============================================================
# Test: ApiDriver
# ============================================================
class TestApiDriver:
    """API 驱动测试"""

    def test_init(self):
        api = ApiDriver(base_url="http://example.com", timeout=5)
        assert api.base_url == "http://example.com"
        assert api.timeout == 5
        assert api.total_requests == 0

    def test_build_url(self):
        api = ApiDriver()
        url = api._build_url("/api/test")
        assert url == "http://localhost:8765/api/test"

    def test_build_url_with_query(self):
        api = ApiDriver()
        url = api._build_url("/api/test", query={"a": 1, "b": "hello"})
        assert "a=1" in url
        assert "b=hello" in url

    def test_stats(self):
        api = ApiDriver()
        api.total_requests = 10
        api.failed_requests = 2
        stats = api.stats()
        assert stats["total_requests"] == 10
        assert stats["failed_requests"] == 2
        assert stats["success_rate"] == 0.8

    def test_request_unreachable(self):
        api = ApiDriver(base_url="http://127.0.0.1:1", timeout=1, max_retries=1, retry_delay=0.01)
        with pytest.raises(Exception):
            api.get("/health")


# ============================================================
# Test: BrowserDriver
# ============================================================
class TestBrowserDriver:
    """浏览器驱动测试"""

    def test_init(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        assert bd.headless is True
        assert bd.timeout == 30

    def test_launch_close(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.launch()
        bd.close()
        assert bd.history == []

    def test_context_manager(self, temp_dir):
        with BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots")) as bd:
            assert bd is not None

    def test_navigate(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.navigate("http://localhost:5173/doctor")
        assert bd.get_url() == "http://localhost:5173/doctor"
        assert bd.get_title() == "Doctor"
        assert len(bd.history) == 1

    def test_navigate_other_pages(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        for path, title in [
            ("/memory", "Memory System"),
            ("/verification", "Verification Loop"),
            ("/diff-view", "Diff View"),
        ]:
            bd.navigate(f"http://localhost:5173{path}")
            assert bd.get_title() == title

    def test_click_fill_scroll(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.click("button.submit")
        bd.fill("input.name", "test")
        bd.scroll(0, 100)
        assert bd.elements["button.submit"]["clicked"] is True
        assert bd.elements["input.name"]["value"] == "test"
        assert len(bd.history) == 3

    def test_screenshot(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.navigate("http://example.com")
        path = bd.screenshot("test")
        assert os.path.exists(path)
        assert path.endswith(".png")

    def test_screenshot_base64(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.navigate("http://example.com")
        b64 = bd.screenshot_base64()
        decoded = base64.b64decode(b64)
        assert len(decoded) > 0

    def test_local_storage(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.set_local_storage("foo", "bar")
        assert bd.get_local_storage("foo") == "bar"
        bd.clear_local_storage()
        assert bd.get_local_storage("foo") is None

    def test_cookies(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.set_cookie("session", "abc123")
        assert bd.get_cookie("session") == "abc123"

    def test_wait_for(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        bd.navigate("http://example.com")
        assert bd.wait_for_selector("div") is True
        assert bd.wait_for_url("example.com") is True
        assert bd.wait_for_url("nonexistent.com") is False

    def test_wait_ms(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        start = time.time()
        bd.wait(50)
        assert time.time() - start >= 0.05

    def test_evaluate(self, temp_dir):
        bd = BrowserDriver(screenshots_dir=os.path.join(temp_dir, "shots"))
        result = bd.evaluate("return 1+1")
        assert result is None
        assert len(bd.history) == 1


# ============================================================
# Test: Scenario
# ============================================================
class TestScenario:
    """场景测试"""

    def test_base_scenario_id(self):
        class TestSc(BaseScenario):
            name = "test_scenario"
        sc = TestSc()
        assert sc.scenario_id.startswith("sc_")
        assert "test" in sc.scenario_id

    def test_step_context_passed(self):
        class TestSc(BaseScenario):
            name = "step_pass_test"
            def run(self, ctx):
                return self.result
        sc = TestSc()
        # 模拟 result
        sc.result = ScenarioResult(
            scenario_id=sc.scenario_id,
            scenario_name=sc.name,
            status="running",
            start_time="",
            end_time="",
            duration_ms=0,
        )
        with sc.step("test_step"):
            pass
        assert len(sc.result.steps) == 1
        assert sc.result.steps[0].status == "passed"

    def test_step_context_failed(self):
        class TestSc(BaseScenario):
            name = "step_fail_test"
            def run(self, ctx):
                return self.result
        sc = TestSc()
        sc.result = ScenarioResult(
            scenario_id=sc.scenario_id,
            scenario_name=sc.name,
            status="running",
            start_time="",
            end_time="",
            duration_ms=0,
        )
        with pytest.raises(AssertionError):
            with sc.step("test_step"):
                sc.assert_true(False, "intentional failure")
        assert sc.result.steps[0].status == "failed"

    def test_assert_helpers(self):
        class TestSc(BaseScenario):
            name = "assert_test"
        sc = TestSc()
        sc.assert_true(True, "")
        sc.assert_equal(1, 1)
        sc.assert_contains("hello world", "world")
        with pytest.raises(AssertionError):
            sc.assert_true(False, "fail")
        with pytest.raises(AssertionError):
            sc.assert_equal(1, 2)
        with pytest.raises(AssertionError):
            sc.assert_contains("foo", "bar")

    def test_scenario_registry(self):
        class TestSc(BaseScenario):
            name = "registry_test"
        reg = ScenarioRegistry()
        sc = TestSc()
        reg.register(sc)
        assert reg.count() == 1
        assert reg.get(sc.scenario_id) is sc
        assert sc in reg.list_all()
        # 测试不同名场景
        class TestSc2(BaseScenario):
            name = "registry_test_2"
        reg.register_class(TestSc2)
        assert reg.count() == 2

    def test_scenario_registry_priority(self):
        class HighP(BaseScenario):
            name = "high_priority"
            priority = 100
        class LowP(BaseScenario):
            name = "low_priority"
            priority = 10
        reg = ScenarioRegistry()
        reg.register(LowP())
        reg.register(HighP())
        listed = reg.list_all()
        assert listed[0].priority == 100
        assert listed[1].priority == 10

    def test_scenario_registry_list_by_tag(self):
        class TaggedSc(BaseScenario):
            name = "tagged"
            tags = ["core", "smoke"]
        reg = ScenarioRegistry()
        reg.register(TaggedSc())
        assert len(reg.list_by_tag("core")) == 1
        assert len(reg.list_by_tag("nonexistent")) == 0

    def test_scenario_registry_clear(self):
        reg = ScenarioRegistry()
        reg.register(BaseScenario())
        reg.clear()
        assert reg.count() == 0

    def test_scenario_registry_to_dict_list(self):
        class TestSc(BaseScenario):
            name = "test_dict"
            description = "test"
        reg = ScenarioRegistry()
        reg.register(TestSc())
        d = reg.to_dict_list()
        assert len(d) == 1
        assert d[0]["name"] == "test_dict"


# ============================================================
# Test: VisualRegression
# ============================================================
class TestVisualRegression:
    """视觉回归测试"""

    def test_compute_fingerprint(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        fp = vr.compute_fingerprint(b"test data")
        assert len(fp) == 64  # SHA-256 hex
        assert fp == vr.compute_fingerprint(b"test data")  # 相同输入相同输出

    def test_compute_fingerprint_from_file(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        f = Path(temp_dir) / "test.png"
        f.write_bytes(b"data")
        fp = vr.compute_fingerprint_from_file(str(f))
        assert len(fp) == 64

    def test_capture_and_get(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        bl = vr.capture_baseline("home", b"screenshot data", {"url": "/"})
        assert bl["name"] == "home"
        assert bl["size"] == len(b"screenshot data")
        got = vr.get_baseline("home")
        assert got is not None
        assert got["fingerprint"] == bl["fingerprint"]

    def test_list_baselines(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        vr.capture_baseline("a", b"data1")
        vr.capture_baseline("b", b"data2")
        baselines = vr.list_baselines()
        assert len(baselines) == 2

    def test_delete_baseline(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        vr.capture_baseline("temp", b"data")
        assert vr.delete_baseline("temp") is True
        assert vr.get_baseline("temp") is None
        assert vr.delete_baseline("nonexistent") is False

    def test_compare_matched(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        vr.capture_baseline("home", b"same data")
        result = vr.compare("home", b"same data")
        assert result["matched"] is True
        assert result["drift"] == 0.0

    def test_compare_not_matched(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        vr.capture_baseline("home", b"data1")
        result = vr.compare("home", b"completely different data here")
        assert result["matched"] is False
        assert result["drift"] > 0

    def test_compare_no_baseline(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        result = vr.compare("nonexistent", b"data")
        assert result["matched"] is False
        assert result.get("error") == "baseline_not_found"

    def test_drift_detected(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir, drift_threshold=0.05)
        vr.capture_baseline("home", b"a" * 100)
        assert vr.drift_detected("home", b"b" * 1000) is True

    def test_stats(self, temp_dir):
        vr = VisualRegression(baselines_dir=temp_dir)
        vr.capture_baseline("a", b"x")
        stats = vr.stats()
        assert stats["total_baselines"] == 1
        assert "drift_threshold" in stats


# ============================================================
# Test: ReportGenerator
# ============================================================
class TestReportGenerator:
    """报告生成器测试"""

    def test_generate_json(self, temp_dir):
        gen = ReportGenerator(output_dir=temp_dir)
        report = TestReport(
            report_id="e2e_test_001",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=1000,
            total_scenarios=2,
            passed=2,
        )
        path = gen.generate_json(report)
        assert os.path.exists(path)
        data = json.loads(Path(path).read_text())
        assert data["report_id"] == "e2e_test_001"
        assert data["passed"] == 2

    def test_generate_markdown(self, temp_dir):
        gen = ReportGenerator(output_dir=temp_dir)
        report = TestReport(
            report_id="e2e_test_002",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=1000,
            total_scenarios=1,
            passed=1,
        )
        path = gen.generate_markdown(report)
        assert os.path.exists(path)
        content = Path(path).read_text()
        assert "e2e_test_002" in content
        assert "✅ Passed" in content

    def test_generate_html(self, temp_dir):
        gen = ReportGenerator(output_dir=temp_dir)
        report = TestReport(
            report_id="e2e_test_003",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=1000,
            total_scenarios=1,
            passed=1,
        )
        path = gen.generate_html(report)
        assert os.path.exists(path)
        content = Path(path).read_text()
        assert "E2E Test Report" in content
        assert "e2e_test_003" in content

    def test_generate_multi_format(self, temp_dir):
        gen = ReportGenerator(output_dir=temp_dir)
        report = TestReport(
            report_id="e2e_test_multi",
            timestamp="2026-07-28T00:00:00Z",
            duration_ms=1000,
            total_scenarios=1,
        )
        paths = gen.generate(report, formats=["html", "json", "markdown"])
        assert "html" in paths
        assert "json" in paths
        assert "markdown" in paths
        for p in paths.values():
            assert os.path.exists(p)

    def test_html_escape(self, temp_dir):
        gen = ReportGenerator(output_dir=temp_dir)
        escaped = gen._html_escape('<script>alert("xss")</script>')
        assert "<script>" not in escaped
        assert "&lt;script&gt;" in escaped


# ============================================================
# Test: RetryStrategy
# ============================================================
class TestRetryStrategy:
    """重试策略测试"""

    def test_init(self):
        rs = RetryStrategy(max_retries=3)
        assert rs.max_retries == 3
        assert rs.backoff_schedule == (1.0, 5.0, 15.0)

    def test_should_retry(self):
        rs = RetryStrategy(max_retries=2, retryable_exceptions=(ValueError,))
        assert rs.should_retry(0, ValueError("x")) is True
        assert rs.should_retry(2, ValueError("x")) is False
        assert rs.should_retry(0, KeyError("x")) is False  # 非可重试异常

    def test_get_backoff(self):
        rs = RetryStrategy(backoff_schedule=(1.0, 2.0, 4.0))
        assert rs.get_backoff(0) == 1.0
        assert rs.get_backoff(1) == 2.0
        assert rs.get_backoff(2) == 4.0
        assert rs.get_backoff(99) == 4.0  # 超出范围返回最后一个

    def test_execute_success(self):
        rs = RetryStrategy(max_retries=2)
        result = rs.execute(lambda: 42)
        assert result == 42
        assert rs.total_attempts == 1

    def test_execute_retry(self):
        rs = RetryStrategy(max_retries=2, backoff_schedule=(0.01, 0.01))
        counter = {"calls": 0}
        def flaky():
            counter["calls"] += 1
            if counter["calls"] < 3:
                raise ValueError("flaky")
            return "ok"
        result = rs.execute(flaky)
        assert result == "ok"
        assert counter["calls"] == 3
        assert rs.successful_after_retry == 1

    def test_exceed_max_retries(self):
        rs = RetryStrategy(max_retries=2, backoff_schedule=(0.01, 0.01))
        with pytest.raises(ValueError):
            rs.execute(lambda: (_ for _ in ()).throw(ValueError("fail")))

    def test_stats(self):
        rs = RetryStrategy(max_retries=1)
        rs.execute(lambda: 1)
        stats = rs.stats()
        assert stats["total_attempts"] == 1
        assert stats["total_retries"] == 0


# ============================================================
# Test: Retry Decorator
# ============================================================
class TestRetryDecorator:
    """重试装饰器测试"""

    def test_decorator_success(self):
        @retry_with_backoff(max_retries=2, backoff_schedule=(0.01, 0.01))
        def my_func():
            return "ok"
        assert my_func() == "ok"

    def test_decorator_retry(self):
        counter = {"calls": 0}
        @retry_with_backoff(max_retries=3, backoff_schedule=(0.01, 0.01, 0.01))
        def flaky():
            counter["calls"] += 1
            if counter["calls"] < 2:
                raise ValueError("flaky")
            return "ok"
        assert flaky() == "ok"
        assert counter["calls"] == 2


# ============================================================
# Test: PlaywrightE2ERunner
# ============================================================
class TestPlaywrightE2ERunner:
    """E2E Runner 测试"""

    def test_init(self, config):
        runner = PlaywrightE2ERunner(config=config)
        assert runner.registry.count() == 8
        assert runner.api is not None
        assert runner.visual is not None
        assert runner.report_generator is not None

    def test_default_scenarios(self, config):
        runner = PlaywrightE2ERunner(config=config)
        scenarios = runner.list_scenarios()
        assert len(scenarios) == 8
        names = {s["name"] for s in scenarios}
        assert "app_startup" in names
        assert "doctor_diagnosis" in names
        assert "e2e_regression" in names

    def test_state_management(self, config):
        runner = PlaywrightE2ERunner(config=config)
        runner.set_state("foo", "bar")
        assert runner.get_state("foo") == "bar"

    def test_register_custom_scenario(self, config):
        runner = PlaywrightE2ERunner(config=config)
        initial_count = runner.registry.count()

        class CustomSc(BaseScenario):
            name = "custom_scenario"
            def run(self, ctx):
                return self.result

        runner.register(CustomSc())
        assert runner.registry.count() == initial_count + 1

    def test_list_reports_empty(self, config):
        runner = PlaywrightE2ERunner(config=config)
        reports = runner.list_reports(limit=5)
        assert isinstance(reports, list)

    def test_get_report_not_found(self, config):
        runner = PlaywrightE2ERunner(config=config)
        assert runner.get_report("nonexistent") is None
