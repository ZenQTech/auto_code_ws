"""
# ============================================================
# Verification Loop 单元测试 (Cycle 10 P1-10)
# ============================================================
# 核心作用：测试 VerificationTask / VerificationResult / FixAction /
#           Baseline 数据类、4 维度验证器、TaskManager、FixOrchestrator、
#           BaselineStore、ReportGenerator、WebhookHandler 等核心模块
# 运行流程：
#   1. 测试数据类 CRUD + to_dict / from_dict
#   2. 测试 4 维度验证器（语法/模块/集成/性能）
#   3. 测试任务管理（CRUD + 幂等 + 状态流转）
#   4. 测试自动修复编排（错误分类 + Agent 路由 + 重试）
#   5. 测试基线管理（创建/查询/对比/失效）
#   6. 测试报告生成（Markdown/JSON/HTML）
#   7. 测试 Webhook 解析（git push / PR）
#   8. 测试安全（命令白名单 / 路径越界）
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================
"""

import os
import sys
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# 设置工作区路径
WORKSPACE = "/home/qizheng/auto_code_ws"
sys.path.insert(0, WORKSPACE)
sys.path.insert(0, os.path.join(WORKSPACE, "backend"))

from app.services.verification import (
    TriggerType,
    TaskStatus,
    ResultStatus,
    ErrorType,
    FixStatus,
    VerificationTask,
    VerificationResult,
    FixAction,
    PerformanceBaseline,
    SyntaxVerifier,
    ModuleVerifier,
    IntegrationVerifier,
    PerformanceVerifier,
    BaselineStore,
    VerificationResultStore,
    FixOrchestrator,
    ReportGenerator,
    VerificationTaskManager,
    GitWebhookHandler,
    _validate_project_path,
    _validate_commit_sha,
    _validate_command,
    _redact_sensitive,
    _compute_checksum,
    DEFAULT_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF,
    PERFORMANCE_REGRESSION_THRESHOLD,
    ALLOWED_PROJECT_PATHS,
    HIGH_RISK_MODULES,
)


class TestDataClasses(unittest.TestCase):
    """数据类测试"""

    def test_verification_task_to_dict(self):
        """VerificationTask 序列化"""
        task = VerificationTask(
            task_id="vt_test_001",
            trigger="manual",
            commit_sha="abc1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        d = task.to_dict()
        self.assertEqual(d["task_id"], "vt_test_001")
        self.assertEqual(d["trigger"], "manual")
        self.assertEqual(d["status"], "pending")
        self.assertEqual(d["retry_count"], 0)
        self.assertIn("created_at", d)

    def test_verification_task_from_dict(self):
        """VerificationTask 反序列化"""
        d = {
            "task_id": "vt_test_002",
            "trigger": "commit",
            "commit_sha": "def5678",
            "project_path": "/home/qizheng/auto_code_ws",
            "dimensions": ["syntax", "module"],
            "status": "passed",
            "retry_count": 1,
        }
        task = VerificationTask.from_dict(d)
        self.assertEqual(task.task_id, "vt_test_002")
        self.assertEqual(task.status, "passed")
        self.assertEqual(task.retry_count, 1)
        self.assertEqual(task.dimensions, ["syntax", "module"])

    def test_verification_result_to_dict(self):
        """VerificationResult 序列化"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="syntax",
            status="passed",
            total_checks=10,
            passed_checks=10,
        )
        d = result.to_dict()
        self.assertEqual(d["result_id"], "res_001")
        self.assertEqual(d["status"], "passed")
        self.assertEqual(d["total_checks"], 10)

    def test_fix_action_to_dict(self):
        """FixAction 序列化"""
        action = FixAction(
            action_id="fix_001",
            task_id="vt_001",
            error_type="test_failure",
            error_signature="assertion failed",
            agent_invoked="fix_agent",
            fix_strategy="rerun",
        )
        d = action.to_dict()
        self.assertEqual(d["error_type"], "test_failure")
        self.assertEqual(d["agent_invoked"], "fix_agent")

    def test_performance_baseline_to_dict(self):
        """PerformanceBaseline 序列化"""
        bl = PerformanceBaseline(
            baseline_id="bl_001",
            name="python_list_op",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="execution_ms",
            metric_value=12.5,
            unit="ms",
        )
        d = bl.to_dict()
        self.assertEqual(d["name"], "python_list_op")
        self.assertEqual(d["metric_value"], 12.5)
        self.assertEqual(d["unit"], "ms")

    def test_trigger_type_enum(self):
        """TriggerType 枚举值"""
        self.assertEqual(TriggerType.COMMIT.value, "commit")
        self.assertEqual(TriggerType.PR.value, "pr")
        self.assertEqual(TriggerType.CRON.value, "cron")
        self.assertEqual(TriggerType.MANUAL.value, "manual")

    def test_task_status_enum(self):
        """TaskStatus 枚举值"""
        self.assertEqual(TaskStatus.PENDING.value, "pending")
        self.assertEqual(TaskStatus.RUNNING.value, "running")
        self.assertEqual(TaskStatus.PASSED.value, "passed")
        self.assertEqual(TaskStatus.FAILED.value, "failed")
        self.assertEqual(TaskStatus.CANCELLED.value, "cancelled")
        self.assertEqual(TaskStatus.BLOCKED.value, "blocked")

    def test_error_type_enum(self):
        """ErrorType 枚举值"""
        self.assertEqual(ErrorType.TEST_FAILURE.value, "test_failure")
        self.assertEqual(ErrorType.TYPE_ERROR.value, "type_error")
        self.assertEqual(ErrorType.SAFETY_VIOLATION.value, "safety_violation")


class TestValidationFunctions(unittest.TestCase):
    """验证函数测试"""

    def test_validate_project_path_allowed(self):
        """白名单内路径通过"""
        valid, err = _validate_project_path("/home/qizheng/auto_code_ws")
        self.assertTrue(valid, err)
        self.assertEqual(err, "")

    def test_validate_project_path_denied(self):
        """白名单外路径拒绝"""
        valid, err = _validate_project_path("/tmp/evil")
        self.assertFalse(valid)
        self.assertIn("whitelist", err)

    def test_validate_project_path_subpath_allowed(self):
        """白名单子路径通过"""
        valid, err = _validate_project_path("/home/qizheng/auto_code_ws/backend")
        self.assertTrue(valid, err)

    def test_validate_commit_sha_valid(self):
        """合法 commit SHA"""
        valid, err = _validate_commit_sha("abc1234")
        self.assertTrue(valid, err)
        valid, err = _validate_commit_sha("a" * 40)
        self.assertTrue(valid, err)
        valid, err = _validate_commit_sha("")
        self.assertTrue(valid, err)  # 空允许

    def test_validate_commit_sha_invalid(self):
        """非法 commit SHA"""
        valid, err = _validate_commit_sha("xyz")  # 非 hex
        self.assertFalse(valid)
        valid, err = _validate_commit_sha("Z" * 40)  # 大写不允许
        self.assertFalse(valid)

    def test_validate_command_allowed(self):
        """合法命令通过"""
        valid, err = _validate_command(
            ["python3", "-m", "mypy", "backend/"], "syntax", "python"
        )
        self.assertTrue(valid, err)

    def test_validate_command_injection_blocked(self):
        """命令注入被拦截"""
        valid, err = _validate_command(
            ["python3", "-c", "import os; os.system('rm -rf /')"], "syntax", "python"
        )
        self.assertFalse(valid)

    def test_redact_sensitive(self):
        """敏感信息脱敏"""
        redacted = _redact_sensitive("api_key=sk-1234567890abcdefghij1234567890ab")
        self.assertIn("[REDACTED", redacted)
        redacted = _redact_sensitive("password=secret123")
        self.assertIn("[REDACTED", redacted)
        redacted = _redact_sensitive("token=eyJhbGc...")
        self.assertIn("[REDACTED", redacted)

    def test_compute_checksum(self):
        """校验和计算"""
        c1 = _compute_checksum("hello")
        c2 = _compute_checksum("hello")
        c3 = _compute_checksum("world")
        self.assertEqual(c1, c2)
        self.assertNotEqual(c1, c3)
        self.assertEqual(len(c1), 64)  # SHA-256 hex


class TestSyntaxVerifier(unittest.TestCase):
    """SyntaxVerifier 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        # 创建一些 Python 文件
        (Path(self.tmpdir) / "good.py").write_text("x = 1\n")
        (Path(self.tmpdir) / "bad.py").write_text("def foo(:\n  pass\n")  # SyntaxError
        # 跳过目录
        (Path(self.tmpdir) / "node_modules").mkdir()
        (Path(self.tmpdir) / "node_modules" / "skip.py").write_text("invalid ((")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_syntax_check_pass(self):
        """正常 Python 文件通过"""
        task = VerificationTask(
            task_id="vt_001", trigger="manual", commit_sha="abc",
            project_path=self.tmpdir, dimensions=["syntax"]
        )
        verifier = SyntaxVerifier(self.tmpdir)
        result = verifier.verify(task)
        # 至少有 good.py 通过，bad.py 失败
        self.assertGreaterEqual(result.passed_checks, 1)
        self.assertEqual(result.status, ResultStatus.FAILED.value)  # 因为 bad.py 失败

    def test_syntax_skip_node_modules(self):
        """跳过 node_modules"""
        task = VerificationTask(
            task_id="vt_001", trigger="manual", commit_sha="abc",
            project_path=self.tmpdir, dimensions=["syntax"]
        )
        verifier = SyntaxVerifier(self.tmpdir)
        result = verifier.verify(task)
        # node_modules 下的文件应被跳过
        self.assertNotIn("node_modules/skip.py", result.output)


class TestBaselineStore(unittest.TestCase):
    """BaselineStore 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.store = BaselineStore(verification_dir=Path(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_baseline(self):
        """创建基线"""
        bl = PerformanceBaseline(
            baseline_id="bl_001",
            name="python_list_op",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="execution_ms",
            metric_value=10.0,
            unit="ms",
        )
        success, err = self.store.create_baseline(bl)
        self.assertTrue(success, err)

    def test_get_baseline(self):
        """查询基线"""
        bl = PerformanceBaseline(
            baseline_id="bl_002",
            name="test_op",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="ms",
            metric_value=20.0,
            unit="ms",
        )
        self.store.create_baseline(bl)
        retrieved = self.store.get_baseline("test_op", "/home/qizheng/auto_code_ws")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.metric_value, 20.0)

    def test_get_baseline_not_found(self):
        """查询不存在的基线"""
        retrieved = self.store.get_baseline("nonexistent", "/home/qizheng/auto_code_ws")
        self.assertIsNone(retrieved)

    def test_list_baselines(self):
        """列出基线"""
        for i in range(3):
            bl = PerformanceBaseline(
                baseline_id=f"bl_{i}",
                name=f"op_{i}",
                project_path="/home/qizheng/auto_code_ws",
                metric_name="ms",
                metric_value=float(i),
                unit="ms",
            )
            self.store.create_baseline(bl)
        baselines = self.store.list_baselines()
        self.assertEqual(len(baselines), 3)

    def test_delete_baseline(self):
        """删除基线"""
        bl = PerformanceBaseline(
            baseline_id="bl_del",
            name="to_delete",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="ms",
            metric_value=5.0,
            unit="ms",
        )
        self.store.create_baseline(bl)
        success, err = self.store.delete_baseline("to_delete", "/home/qizheng/auto_code_ws")
        self.assertTrue(success, err)
        retrieved = self.store.get_baseline("to_delete", "/home/qizheng/auto_code_ws")
        self.assertIsNone(retrieved)

    def test_is_expired_recent(self):
        """近期基线未过期"""
        bl = PerformanceBaseline(
            baseline_id="bl_recent",
            name="recent",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="ms",
            metric_value=1.0,
            unit="ms",
        )
        self.assertFalse(self.store.is_expired(bl))

    def test_persistence(self):
        """持久化：创建 → 重新加载 → 数据保留"""
        bl = PerformanceBaseline(
            baseline_id="bl_persist",
            name="persist_op",
            project_path="/home/qizheng/auto_code_ws",
            metric_name="ms",
            metric_value=42.0,
            unit="ms",
        )
        self.store.create_baseline(bl)
        # 重新创建 store（模拟重启）
        store2 = BaselineStore(verification_dir=Path(self.tmpdir))
        retrieved = store2.get_baseline("persist_op", "/home/qizheng/auto_code_ws")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.metric_value, 42.0)


class TestVerificationResultStore(unittest.TestCase):
    """VerificationResultStore 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.store = VerificationResultStore(verification_dir=Path(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_add_and_get_result(self):
        """添加和查询结果"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="syntax",
            status="passed",
        )
        success, err = self.store.add_result(result)
        self.assertTrue(success, err)
        results = self.store.get_results("vt_001")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].result_id, "res_001")

    def test_multiple_results_same_task(self):
        """同一任务多个结果"""
        for i in range(3):
            result = VerificationResult(
                result_id=f"res_{i}",
                task_id="vt_multi",
                dimension="syntax",
                status="passed",
            )
            self.store.add_result(result)
        results = self.store.get_results("vt_multi")
        self.assertEqual(len(results), 3)

    def test_persistence(self):
        """结果持久化"""
        result = VerificationResult(
            result_id="res_persist",
            task_id="vt_persist",
            dimension="syntax",
            status="passed",
        )
        self.store.add_result(result)
        store2 = VerificationResultStore(verification_dir=Path(self.tmpdir))
        results = store2.get_results("vt_persist")
        self.assertEqual(len(results), 1)


class TestFixOrchestrator(unittest.TestCase):
    """FixOrchestrator 测试"""

    def setUp(self):
        self.orch = FixOrchestrator()

    def test_classify_test_failure(self):
        """分类测试失败"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="module",
            status="failed",
            output="test_foo ... FAIL\nAssertionError: expected 1 got 2",
            error_details=["test failed"],
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.TEST_FAILURE)

    def test_classify_type_error(self):
        """分类类型错误"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="syntax",
            status="failed",
            output="TypeError: expected int, got str",
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.TYPE_ERROR)

    def test_classify_syntax_error(self):
        """分类语法错误"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="syntax",
            status="failed",
            output="SyntaxError: invalid syntax",
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.TYPE_ERROR)

    def test_classify_performance_regression(self):
        """分类性能退化"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="performance",
            status="failed",
            output="performance regression 15% > 5%",
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.PERFORMANCE_DEGRADATION)

    def test_classify_safety_violation(self):
        """分类安全违规"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="module",
            status="failed",
            output="safety check failed: high_risk detected",
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.SAFETY_VIOLATION)

    def test_classify_unknown(self):
        """分类未知错误"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="module",
            status="failed",
            output="some xyzzy happened",
        )
        error_type, signature = self.orch.classify_error(result)
        self.assertEqual(error_type, ErrorType.UNKNOWN)

    def test_route_test_failure(self):
        """路由测试失败"""
        agent, strategy = self.orch.route_to_agent(ErrorType.TEST_FAILURE)
        self.assertEqual(agent, "fix_agent")

    def test_route_type_error(self):
        """路由类型错误"""
        agent, strategy = self.orch.route_to_agent(ErrorType.TYPE_ERROR)
        self.assertEqual(agent, "type_agent")

    def test_route_safety_violation(self):
        """路由安全违规"""
        agent, strategy = self.orch.route_to_agent(ErrorType.SAFETY_VIOLATION)
        self.assertEqual(agent, "safety_agent")

    def test_create_fix_action(self):
        """创建修复动作"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="module",
            status="failed",
            output="test failed",
        )
        action = self.orch.create_fix_action("vt_001", result, retry_attempt=0)
        self.assertEqual(action.task_id, "vt_001")
        self.assertEqual(action.retry_attempt, 0)
        self.assertEqual(action.status, FixStatus.PENDING.value)

    def test_execute_fix(self):
        """执行修复"""
        result = VerificationResult(
            result_id="res_001",
            task_id="vt_001",
            dimension="module",
            status="failed",
            output="test failed",
        )
        action = self.orch.create_fix_action("vt_001", result, retry_attempt=0)
        executed = self.orch.execute_fix(action)
        self.assertEqual(executed.status, FixStatus.SUCCEEDED.value)
        self.assertGreater(executed.duration_seconds, 0)

    def test_get_actions(self):
        """获取任务的所有修复动作"""
        for i in range(3):
            result = VerificationResult(
                result_id=f"res_{i}",
                task_id="vt_actions",
                dimension="module",
                status="failed",
                output="test failed",
            )
            self.orch.create_fix_action("vt_actions", result, retry_attempt=i)
        actions = self.orch.get_actions("vt_actions")
        self.assertEqual(len(actions), 3)


class TestReportGenerator(unittest.TestCase):
    """ReportGenerator 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.gen = ReportGenerator(verification_dir=Path(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_task(self):
        return VerificationTask(
            task_id="vt_report",
            trigger="manual",
            commit_sha="abc1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
            status="passed",
        )

    def _make_results(self):
        return [
            VerificationResult(
                result_id="res_001",
                task_id="vt_report",
                dimension="syntax",
                status="passed",
                total_checks=50,
                passed_checks=50,
                duration_seconds=0.5,
            )
        ]

    def test_generate_markdown(self):
        """生成 Markdown"""
        md = self.gen.generate_markdown(
            self._make_task(), self._make_results(), []
        )
        self.assertIn("Verification Report", md)
        self.assertIn("vt_report", md)
        self.assertIn("syntax", md)
        self.assertIn("passed", md)

    def test_generate_json(self):
        """生成 JSON"""
        js = self.gen.generate_json(
            self._make_task(), self._make_results(), []
        )
        import json
        d = json.loads(js)
        self.assertEqual(d["task"]["task_id"], "vt_report")
        self.assertEqual(len(d["results"]), 1)

    def test_generate_html(self):
        """生成 HTML"""
        html = self.gen.generate_html(
            self._make_task(), self._make_results(), []
        )
        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("vt_report", html)
        self.assertIn("syntax", html)

    def test_save_report_markdown(self):
        """保存 Markdown 报告"""
        path = self.gen.save_report(
            self._make_task(), self._make_results(), [], "markdown"
        )
        self.assertTrue(os.path.exists(path))
        with open(path) as f:
            content = f.read()
        self.assertIn("Verification Report", content)

    def test_save_report_json(self):
        """保存 JSON 报告"""
        path = self.gen.save_report(
            self._make_task(), self._make_results(), [], "json"
        )
        self.assertTrue(os.path.exists(path))

    def test_save_report_html(self):
        """保存 HTML 报告"""
        path = self.gen.save_report(
            self._make_task(), self._make_results(), [], "html"
        )
        self.assertTrue(os.path.exists(path))

    def test_save_report_invalid_format(self):
        """无效格式报错"""
        with self.assertRaises(ValueError):
            self.gen.save_report(
                self._make_task(), self._make_results(), [], "invalid"
            )


class TestVerificationTaskManager(unittest.TestCase):
    """VerificationTaskManager 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.tm = VerificationTaskManager(verification_dir=Path(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_task(self):
        """创建任务"""
        task, err = self.tm.create_task(
            trigger="manual",
            commit_sha="abc1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        self.assertIsNotNone(task, err)
        self.assertEqual(task.status, "pending")
        self.assertEqual(task.dimensions, ["syntax"])

    def test_create_task_invalid_trigger(self):
        """非法 trigger"""
        task, err = self.tm.create_task(
            trigger="invalid",
            commit_sha="",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        self.assertIsNone(task)
        self.assertIn("invalid trigger", err)

    def test_create_task_invalid_path(self):
        """非法路径"""
        task, err = self.tm.create_task(
            trigger="manual",
            commit_sha="",
            project_path="/tmp/evil",
            dimensions=["syntax"],
        )
        self.assertIsNone(task)
        self.assertIn("whitelist", err)

    def test_create_task_invalid_commit(self):
        """非法 commit SHA"""
        task, err = self.tm.create_task(
            trigger="manual",
            commit_sha="xyz",  # 非 hex
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        self.assertIsNone(task)

    def test_create_task_invalid_dimension(self):
        """非法 dimension"""
        task, err = self.tm.create_task(
            trigger="manual",
            commit_sha="",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["unknown_dim"],
        )
        self.assertIsNone(task)
        self.assertIn("unsupported dimension", err)

    def test_idempotency_same_commit_dims(self):
        """幂等：同 commit + dims 不重复"""
        t1, _ = self.tm.create_task(
            trigger="manual",
            commit_sha="cafe1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        # 第二次应该返回相同的任务
        t2, err = self.tm.create_task(
            trigger="manual",
            commit_sha="cafe1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        # 因为状态是 pending 所以会返回幂等的同一个任务
        self.assertEqual(t1.task_id, t2.task_id)

    def test_get_task(self):
        """查询任务"""
        task, _ = self.tm.create_task(
            trigger="manual",
            commit_sha="abc1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        retrieved = self.tm.get_task(task.task_id)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.task_id, task.task_id)

    def test_get_task_not_found(self):
        """查询不存在的任务"""
        retrieved = self.tm.get_task("nonexistent")
        self.assertIsNone(retrieved)

    def test_list_tasks(self):
        """列出任务"""
        for i in range(3):
            self.tm.create_task(
                trigger="manual",
                commit_sha=f"aabb{i:03d}ee",
                project_path="/home/qizheng/auto_code_ws",
                dimensions=["syntax"],
            )
        tasks = self.tm.list_tasks(limit=10)
        self.assertEqual(len(tasks), 3)

    def test_list_tasks_by_status(self):
        """按状态过滤"""
        self.tm.create_task(
            trigger="manual",
            commit_sha="abc1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        tasks = self.tm.list_tasks(status="pending", limit=10)
        self.assertEqual(len(tasks), 1)
        tasks = self.tm.list_tasks(status="failed", limit=10)
        self.assertEqual(len(tasks), 0)

    def test_cancel_task(self):
        """取消任务"""
        task, _ = self.tm.create_task(
            trigger="manual",
            commit_sha="cace1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        success, err = self.tm.cancel_task(task.task_id)
        self.assertTrue(success, err)
        retrieved = self.tm.get_task(task.task_id)
        self.assertEqual(retrieved.status, "cancelled")

    def test_cancel_nonexistent(self):
        """取消不存在的任务"""
        success, err = self.tm.cancel_task("nonexistent")
        self.assertFalse(success)

    def test_retry_task(self):
        """重试任务"""
        task, _ = self.tm.create_task(
            trigger="manual",
            commit_sha="bee12345",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        # 手动设置为 failed
        task.status = TaskStatus.FAILED.value
        self.tm._rewrite_file()
        success, err = self.tm.retry_task(task.task_id)
        self.assertTrue(success, err)
        # retry_task 启动后台线程，状态被设为 running
        # 不验证 status（运行中或已结束都有可能）

    def test_is_high_risk_motion_control(self):
        """高风险模块检测 - motion_control"""
        task = VerificationTask(
            task_id="vt_hr",
            trigger="manual",
            commit_sha="",
            project_path="/home/qizheng/auto_code_data/motion_control",
            dimensions=["syntax"],
        )
        self.assertTrue(self.tm._is_high_risk(task, "syntax"))
        self.assertTrue(self.tm._is_high_risk(task, "module"))

    def test_is_high_risk_normal_project(self):
        """非高风险模块"""
        task = VerificationTask(
            task_id="vt_hr2",
            trigger="manual",
            commit_sha="",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        self.assertFalse(self.tm._is_high_risk(task, "syntax"))

    def test_persistence(self):
        """任务持久化"""
        task, _ = self.tm.create_task(
            trigger="manual",
            commit_sha="feee1234",
            project_path="/home/qizheng/auto_code_ws",
            dimensions=["syntax"],
        )
        # 重新创建 manager
        tm2 = VerificationTaskManager(verification_dir=Path(self.tmpdir))
        retrieved = tm2.get_task(task.task_id)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.commit_sha, "feee1234")


class TestGitWebhookHandler(unittest.TestCase):
    """GitWebhookHandler 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.tm = VerificationTaskManager(verification_dir=Path(self.tmpdir))
        self.handler = GitWebhookHandler(self.tm)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_parse_push_event(self):
        """解析 push 事件"""
        payload = {
            "ref": "refs/heads/main",
            "after": "abc1234def",
            "repository": {"full_name": "hermes/hermes"},
            "pusher": {"name": "test@example.com"},
            "commits": [
                {
                    "id": "abc1234def",
                    "message": "test commit",
                    "author": {"name": "tester"},
                }
            ],
        }
        data, err = self.handler.parse_push_event(payload)
        self.assertIsNotNone(data, err)
        self.assertEqual(data["commit_sha"], "abc1234def")
        self.assertEqual(data["branch"], "main")
        self.assertEqual(data["author"], "tester")

    def test_parse_push_event_no_commits(self):
        """解析无 commits 的 push 事件"""
        payload = {
            "ref": "refs/heads/main",
            "after": "abc1234def",
            "repository": {"full_name": "hermes/hermes"},
            "pusher": {"name": "test"},
        }
        data, err = self.handler.parse_push_event(payload)
        self.assertIsNotNone(data, err)
        self.assertEqual(data["commit_sha"], "abc1234def")

    def test_parse_push_event_invalid_ref(self):
        """解析非分支 ref"""
        payload = {"ref": "refs/tags/v1.0", "after": "abc1234"}
        data, err = self.handler.parse_push_event(payload)
        self.assertIsNone(data)
        self.assertIn("unsupported ref", err)

    def test_parse_pr_event(self):
        """解析 PR 事件"""
        payload = {
            "repository": {"full_name": "hermes/hermes"},
            "pull_request": {
                "head": {"sha": "pr1234", "ref": "feature"},
                "user": {"login": "dev1"},
                "title": "Add new feature",
            },
        }
        data, err = self.handler.parse_pr_event(payload)
        self.assertIsNotNone(data, err)
        self.assertEqual(data["commit_sha"], "pr1234")
        self.assertEqual(data["branch"], "feature")

    def test_handle_webhook_push(self):
        """处理 push webhook"""
        payload = {
            "ref": "refs/heads/main",
            "after": "abcd1234",
            "repository": {"full_name": "hermes/hermes"},
            "pusher": {"name": "test"},
        }
        task, err = self.handler.handle_webhook(
            "push", payload, "/home/qizheng/auto_code_ws"
        )
        self.assertIsNotNone(task, err)
        self.assertEqual(task.trigger, "commit")

    def test_handle_webhook_pr(self):
        """处理 PR webhook"""
        payload = {
            "repository": {"full_name": "hermes/hermes"},
            "pull_request": {
                "head": {"sha": "abcdef12", "ref": "feature"},
                "user": {"login": "dev1"},
                "title": "Add feature",
            },
        }
        task, err = self.handler.handle_webhook(
            "pull_request", payload, "/home/qizheng/auto_code_ws"
        )
        self.assertIsNotNone(task, err)
        self.assertEqual(task.trigger, "pr")

    def test_handle_webhook_unknown_event(self):
        """未知事件类型"""
        payload = {}
        task, err = self.handler.handle_webhook(
            "unknown", payload, "/home/qizheng/auto_code_ws"
        )
        self.assertIsNone(task)
        self.assertIn("unsupported event", err)


class TestSecurity(unittest.TestCase):
    """安全测试"""

    def test_high_risk_modules_list(self):
        """高风险模块列表非空"""
        self.assertGreater(len(HIGH_RISK_MODULES), 0)
        self.assertIn("motion_control", HIGH_RISK_MODULES)
        self.assertIn("collision_detection", HIGH_RISK_MODULES)
        self.assertIn("emergency_stop", HIGH_RISK_MODULES)

    def test_allowed_project_paths(self):
        """项目路径白名单非空"""
        self.assertGreater(len(ALLOWED_PROJECT_PATHS), 0)
        self.assertIn("/home/qizheng/auto_code_ws", ALLOWED_PROJECT_PATHS)

    def test_max_retries_limit(self):
        """重试次数限制"""
        self.assertEqual(MAX_RETRIES, 3)

    def test_retry_backoff(self):
        """重试退避策略"""
        self.assertEqual(len(RETRY_BACKOFF), 3)
        # 退避时间递增
        self.assertLess(RETRY_BACKOFF[0], RETRY_BACKOFF[1])
        self.assertLess(RETRY_BACKOFF[1], RETRY_BACKOFF[2])

    def test_performance_threshold(self):
        """性能退化阈值"""
        self.assertEqual(PERFORMANCE_REGRESSION_THRESHOLD, 0.05)


if __name__ == "__main__":
    unittest.main()
