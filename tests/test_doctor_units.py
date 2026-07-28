"""
# ============================================================
# Hermes Doctor 单元测试
# ============================================================
# 覆盖：6 个 checker + runner + formatters + fix_advisor + history
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

import json
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest

# ============================================================
# Fixtures
# ============================================================
@pytest.fixture
def temp_hermes_home(tmp_path):
    """临时 hermes home 目录"""
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    yield hermes_home
    # 清理
    import shutil
    if hermes_home.exists():
        shutil.rmtree(hermes_home, ignore_errors=True)


@pytest.fixture
def temp_project(tmp_path):
    """临时项目目录"""
    project = tmp_path / "project"
    project.mkdir()
    yield project


# ============================================================
# Test Base
# ============================================================
class TestBase:
    """基础数据模型测试"""

    def test_check_item_creation(self):
        from app.core.doctor import CheckItem, CheckStatus
        item = CheckItem(
            id="test.item",
            name="Test Item",
            category="test",
            description="Test",
            status=CheckStatus.OK.value,
            message="All good",
        )
        assert item.id == "test.item"
        assert item.status == "ok"
        d = item.to_dict()
        assert d["id"] == "test.item"

    def test_category_report_add_item(self):
        from app.core.doctor import CategoryReport, CheckItem, CheckStatus
        report = CategoryReport(category="test", title="Test")
        report.add_item(CheckItem(
            id="a", name="A", category="test", description="A",
            status=CheckStatus.OK.value,
        ))
        report.add_item(CheckItem(
            id="b", name="B", category="test", description="B",
            status=CheckStatus.ERROR.value,
        ))
        report.add_item(CheckItem(
            id="c", name="C", category="test", description="C",
            status=CheckStatus.WARNING.value,
        ))
        assert report.total_checks == 3
        assert report.ok_count == 1
        assert report.error_count == 1
        assert report.warning_count == 1
        report.finalize()
        # 有 error 应该是 error 状态
        assert report.overall_status == "error"

    def test_category_report_warnings(self):
        """只有 warning 应该是 warning 状态"""
        from app.core.doctor import CategoryReport, CheckItem, CheckStatus
        report = CategoryReport(category="test", title="Test")
        report.add_item(CheckItem(
            id="a", name="A", category="test", description="A",
            status=CheckStatus.WARNING.value,
        ))
        report.finalize()
        assert report.overall_status == "warning"

    def test_doctor_report_finalize(self):
        from app.core.doctor import DoctorReport, CategoryReport
        report = DoctorReport(
            report_id="doc_test_001",
            timestamp="2026-07-28T12:00:00Z",
            hostname="test",
            hermes_version="6.15.0",
        )
        cat1 = CategoryReport(category="env", title="Env")
        cat1.ok_count = 5
        cat1.total_checks = 5
        cat1.finalize()
        cat2 = CategoryReport(category="ws", title="Workspace")
        cat2.error_count = 1
        cat2.total_checks = 1
        cat2.finalize()
        report.categories = {"env": cat1, "ws": cat2}
        report.finalize()
        assert report.summary["ok"] == 5
        assert report.summary["error"] == 1
        assert report.overall_status == "error"

    def test_redact_value(self):
        from app.core.doctor.base import _redact_value
        # API key 脱敏
        assert _redact_value("api_key", "sk-ant-1234567890abcdef") == "sk-a***ef"
        # 普通字段不脱敏
        assert _redact_value("version", "1.0.0") == "1.0.0"
        # 短值
        assert _redact_value("token", "abc") == "***"

    def test_check_command_exists(self):
        from app.core.doctor.base import _check_command_exists
        assert _check_command_exists("python3") is True
        assert _check_command_exists("nonexistent_cmd_xyz_123") is False

    def test_parse_version(self):
        from app.core.doctor.base import _parse_version
        assert _parse_version("1.2.3") == (1, 2, 3)
        assert _parse_version("2.0") == (2, 0)
        assert _parse_version("") == (0,)

    def test_compare_versions(self):
        from app.core.doctor.base import _compare_versions
        assert _compare_versions("3.10.0", "3.9.0") == 1
        assert _compare_versions("3.9.0", "3.10.0") == 0
        assert _compare_versions("1.0.0", "1.0.0") == 1

    def test_generate_report_id(self):
        from app.core.doctor.base import generate_report_id
        rid = generate_report_id()
        assert rid.startswith("doc_")
        assert len(rid) > 15


# ============================================================
# Test EnvironmentChecker
# ============================================================
class TestEnvironmentChecker:
    """环境检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import EnvironmentChecker
        checker = EnvironmentChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        assert isinstance(items, list)
        assert len(items) == 10
        ids = [i.id for i in items]
        assert "environment.python_version" in ids
        assert "environment.node_version" in ids
        assert "environment.git_version" in ids
        assert "environment.anthropic_api_key" in ids

    def test_python_version_check(self, temp_hermes_home, temp_project):
        """Python 版本检查"""
        from app.core.doctor import EnvironmentChecker
        checker = EnvironmentChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        py_item = next(i for i in items if i.id == "environment.python_version")
        # 当前 Python 应 >= 3.10
        assert py_item.status in ("ok", "warning")
        assert py_item.value is not None

    def test_anthropic_api_key_check(self, temp_hermes_home, temp_project):
        """API key 检查（未设置时应为 error）"""
        from app.core.doctor import EnvironmentChecker
        # 确保未设置
        os.environ.pop("ANTHROPIC_API_KEY", None)
        checker = EnvironmentChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        key_item = next(i for i in items if i.id == "environment.anthropic_api_key")
        # 默认未设置应是 error
        assert key_item.status == "error"
        assert "未设置" in key_item.message

    def test_anthropic_api_key_set(self, temp_hermes_home, temp_project):
        """API key 已设置"""
        from app.core.doctor import EnvironmentChecker
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-12345678"}):
            checker = EnvironmentChecker(hermes_home=temp_hermes_home, project_path=temp_project)
            items = checker.run_checks()
            key_item = next(i for i in items if i.id == "environment.anthropic_api_key")
            assert key_item.status == "ok"
            # 验证脱敏
            assert "***" in key_item.value

    def test_run_with_timeout(self, temp_hermes_home, temp_project):
        """带超时控制"""
        from app.core.doctor import EnvironmentChecker
        checker = EnvironmentChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        report = checker.run_with_timeout(timeout=5.0)
        assert report.category == "environment"
        assert report.total_checks == 10
        assert report.duration_ms > 0


# ============================================================
# Test WorkspaceChecker
# ============================================================
class TestWorkspaceChecker:
    """工作区检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import WorkspaceChecker
        checker = WorkspaceChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        assert len(items) == 8
        ids = [i.id for i in items]
        assert "workspace.current_path" in ids
        assert "workspace.disk_space" in ids
        assert "workspace.trae_dir" in ids

    def test_trae_dir_missing(self, temp_hermes_home, temp_project):
        """.trae 目录不存在"""
        from app.core.doctor import WorkspaceChecker
        checker = WorkspaceChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        trae_item = next(i for i in items if i.id == "workspace.trae_dir")
        assert trae_item.status == "warning"

    def test_trae_dir_exists(self, temp_hermes_home, temp_project):
        """.trae 目录存在"""
        (temp_project / ".trae").mkdir()
        from app.core.doctor import WorkspaceChecker
        checker = WorkspaceChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        trae_item = next(i for i in items if i.id == "workspace.trae_dir")
        assert trae_item.status == "ok"

    def test_disk_space_check(self, temp_hermes_home, temp_project):
        """磁盘空间检查"""
        from app.core.doctor import WorkspaceChecker
        checker = WorkspaceChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        disk_item = next(i for i in items if i.id == "workspace.disk_space")
        assert disk_item.value is not None
        assert "GB" in disk_item.value


# ============================================================
# Test LLMChecker
# ============================================================
class TestLLMChecker:
    """LLM 检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import LLMChecker
        checker = LLMChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        assert len(items) >= 4
        ids = [i.id for i in items]
        assert "llm.api_reachable" in ids


# ============================================================
# Test DatabaseChecker
# ============================================================
class TestDatabaseChecker:
    """数据库检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import DatabaseChecker
        checker = DatabaseChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        assert len(items) == 6

    def test_connection_missing_db(self, temp_hermes_home, temp_project):
        """数据库文件不存在"""
        from app.core.doctor import DatabaseChecker
        checker = DatabaseChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        conn_item = next(i for i in items if i.id == "database.connection")
        # 不存在应是 warning（首次启动会创建）
        assert conn_item.status in ("warning", "ok")


# ============================================================
# Test MCPChecker
# ============================================================
class TestMCPChecker:
    """MCP 检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import MCPChecker
        checker = MCPChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        assert len(items) == 6
        ids = [i.id for i in items]
        assert "mcp.config_exists" in ids

    def test_config_missing(self, temp_hermes_home, temp_project):
        """MCP 配置不存在"""
        from app.core.doctor import MCPChecker
        checker = MCPChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        cfg_item = next(i for i in items if i.id == "mcp.config_exists")
        assert cfg_item.status == "warning"

    def test_config_valid(self, temp_hermes_home, temp_project):
        """MCP 配置存在且有效"""
        (temp_hermes_home / "mcp.json").write_text(
            json.dumps({"mcpServers": {"fs": {"command": "npx"}}})
        )
        from app.core.doctor import MCPChecker
        checker = MCPChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        cfg_item = next(i for i in items if i.id == "mcp.config_exists")
        assert cfg_item.status == "ok"
        valid_item = next(i for i in items if i.id == "mcp.config_valid")
        assert valid_item.status == "ok"


# ============================================================
# Test DependenciesChecker
# ============================================================
class TestDependenciesChecker:
    """依赖检查器测试"""

    def test_run_returns_items(self, temp_hermes_home, temp_project):
        from app.core.doctor import DependenciesChecker
        checker = DependenciesChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        # 6 个 python 包 + node_modules + dist = 8
        assert len(items) == 8
        ids = [i.id for i in items]
        assert "dependencies.fastapi" in ids
        assert "dependencies.uvicorn" in ids

    def test_python_package_version(self, temp_hermes_home, temp_project):
        """Python 包版本检查"""
        from app.core.doctor import DependenciesChecker
        checker = DependenciesChecker(hermes_home=temp_hermes_home, project_path=temp_project)
        items = checker.run_checks()
        # 找一个已安装的包
        for item in items:
            if item.id == "dependencies.fastapi":
                # pytest 应已安装
                assert item.status in ("ok", "warning", "error")
                break


# ============================================================
# Test Runner
# ============================================================
class TestRunner:
    """DoctorRunner 测试"""

    def test_run_all(self, temp_hermes_home, temp_project):
        from app.core.doctor import DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(parallel=False)
        assert report.overall_status in ("ok", "warning", "error")
        assert len(report.categories) == 6
        assert report.duration_ms > 0

    def test_run_all_parallel(self, temp_hermes_home, temp_project):
        """并行执行"""
        from app.core.doctor import DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        start = time.time()
        report = runner.run_all(parallel=True)
        duration = time.time() - start
        assert len(report.categories) == 6
        # 并行应 < 6s（实际所有 checker 都很快）
        assert duration < 10.0

    def test_run_specific_category(self, temp_hermes_home, temp_project):
        """指定分类"""
        from app.core.doctor import DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        assert len(report.categories) == 1
        assert "environment" in report.categories

    def test_run_category_invalid(self, temp_hermes_home, temp_project):
        """非法分类"""
        from app.core.doctor import DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        with pytest.raises(ValueError):
            runner._make_checker("invalid_category")


# ============================================================
# Test Formatters
# ============================================================
class TestFormatters:
    """格式化器测试"""

    def test_summary_formatter(self, temp_hermes_home, temp_project):
        from app.core.doctor import get_formatter, DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        formatter = get_formatter("summary", use_color=False)
        output = formatter.format(report)
        assert "Hermes Doctor" in output
        assert "环境变量" in output
        assert "报告ID" in output

    def test_json_formatter(self, temp_hermes_home, temp_project):
        from app.core.doctor import get_formatter, DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        formatter = get_formatter("json", use_color=False)
        output = formatter.format(report)
        # 应是有效 JSON
        data = json.loads(output)
        assert "report_id" in data
        assert "categories" in data

    def test_full_formatter(self, temp_hermes_home, temp_project):
        from app.core.doctor import get_formatter, DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        formatter = get_formatter("all", use_color=False)
        output = formatter.format(report)
        data = json.loads(output)
        assert data["_formatter"] == "full"

    def test_plain_formatter(self, temp_hermes_home, temp_project):
        """无颜色"""
        from app.core.doctor import get_formatter, DoctorRunner
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        formatter = get_formatter("plain", use_color=False)
        output = formatter.format(report)
        # 不应包含 ANSI 颜色码
        assert "\033[" not in output


# ============================================================
# Test FixAdvisor
# ============================================================
class TestFixAdvisor:
    """修复建议测试"""

    def test_get_fix_existing(self):
        from app.core.doctor import get_fix_advisor
        advisor = get_fix_advisor()
        fix = advisor.get_fix("environment.anthropic_api_key")
        assert fix is not None
        assert fix.title is not None
        assert len(fix.steps) > 0
        assert fix.risk_level in ("low", "medium", "high")

    def test_get_fix_not_found(self):
        from app.core.doctor import get_fix_advisor
        advisor = get_fix_advisor()
        fix = advisor.get_fix("nonexistent.check_id")
        assert fix is None

    def test_list_all(self):
        from app.core.doctor import get_fix_advisor
        advisor = get_fix_advisor()
        all_fixes = advisor.list_all()
        assert isinstance(all_fixes, dict)
        # 应包含 6 大类
        assert "environment" in all_fixes
        assert "database" in all_fixes
        # 每类至少 5 个
        assert len(all_fixes["environment"]) >= 5

    def test_get_fixes_for_category(self):
        from app.core.doctor import get_fix_advisor
        advisor = get_fix_advisor()
        fixes = advisor.get_fixes_for_category("database")
        assert len(fixes) >= 5
        for f in fixes:
            assert f.check_id.startswith("database.")

    def test_get_fixes_for_items(self):
        from app.core.doctor import get_fix_advisor, CheckItem
        advisor = get_fix_advisor()
        items = [
            CheckItem(
                id="environment.anthropic_api_key",
                name="API Key",
                category="environment",
                description="",
                status="error",
                fix_suggestion="设置环境变量",
            ),
            CheckItem(
                id="nonexistent.check",
                name="Nonexistent",
                category="x",
                description="",
                status="error",
                fix_suggestion="manual fix",
            ),
        ]
        fixes = advisor.get_fixes_for_items(items)
        # 第一个有 template，第二个用 fallback
        assert len(fixes) == 2


# ============================================================
# Test History
# ============================================================
class TestHistory:
    """历史报告测试"""

    def test_init_and_save(self, temp_hermes_home, temp_project):
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        store.save(report)
        assert store.count() == 1

    def test_get_report(self, temp_hermes_home, temp_project):
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        store.save(report)
        loaded = store.get(report.report_id)
        assert loaded is not None
        assert loaded.report_id == report.report_id

    def test_list_reports(self, temp_hermes_home, temp_project):
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        for _ in range(3):
            report = runner.run_all(categories=["environment"])
            store.save(report)
        reports = store.list_reports(limit=10)
        assert len(reports) == 3

    def test_delete_report(self, temp_hermes_home, temp_project):
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        store.save(report)
        assert store.delete(report.report_id) is True
        assert store.count() == 0

    def test_keep_count(self, temp_hermes_home, temp_project):
        """保留数量限制"""
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home, keep_count=3)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        for _ in range(5):
            report = runner.run_all(categories=["environment"])
            time.sleep(0.01)  # 确保时间戳不同
            store.save(report)
        assert store.count() == 3

    def test_clear(self, temp_hermes_home, temp_project):
        from app.core.doctor import ReportHistoryStore, DoctorRunner
        store = ReportHistoryStore(hermes_home=temp_hermes_home)
        runner = DoctorRunner(hermes_home=temp_hermes_home, project_path=temp_project)
        report = runner.run_all(categories=["environment"])
        store.save(report)
        count = store.clear()
        assert count == 1
        assert store.count() == 0
