"""
# ============================================================
# Loop Commands 单元测试 - Cycle 8 P1-4
# ============================================================
# 测试覆盖：
#   T1: Triage 解析 tasks.md (5 测试)
#   T2: Plan 生成 spec + branch (5 测试)
#   T3: Execute 顺序执行 (5 测试)
#   T4: Verify 测试运行 (5 测试)
# ============================================================
"""

import os
import sys
import unittest
import tempfile
import shutil
from pathlib import Path

# 设置 PYTHONPATH
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(PROJECT_ROOT))


class TestTriageService(unittest.TestCase):
    """T1: Triage 解析 tasks.md (5 测试)"""

    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.mkdtemp()
        cls.tasks_file = Path(cls.tmpdir) / "tasks.md"
        cls.tasks_file.write_text("""# Tasks

## P0

- [ ] **P0** Task A
- [x] **P0** Task B done
  - [ ] subtask B1
  - [ ] subtask B2

## P1

- [ ] **P1** Task C

## P2

- [ ] **P2** Task D
- [ ] Task E (no priority)
""", encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def test_T1_01_parse_tasks_basic(self):
        """T1-01: 基本解析 tasks.md"""
        from app.services.loop_commands.triage import parse_tasks
        tasks = parse_tasks(str(self.tasks_file))
        self.assertGreater(len(tasks), 0)
        # 至少 5 个主任务
        self.assertGreaterEqual(len(tasks), 5)

    def test_T1_02_parse_priority(self):
        """T1-02: 解析优先级 P0/P1/P2"""
        from app.services.loop_commands.triage import parse_tasks
        tasks = parse_tasks(str(self.tasks_file))
        priorities = {t.priority for t in tasks}
        self.assertIn("P0", priorities)
        self.assertIn("P1", priorities)
        self.assertIn("P2", priorities)

    def test_T1_03_parse_status(self):
        """T1-03: 解析状态 pending/completed"""
        from app.services.loop_commands.triage import parse_tasks
        tasks = parse_tasks(str(self.tasks_file))
        statuses = {t.status for t in tasks}
        self.assertIn("pending", statuses)
        self.assertIn("completed", statuses)

    def test_T1_04_parse_subtasks(self):
        """T1-04: 解析子任务"""
        from app.services.loop_commands.triage import parse_tasks
        tasks = parse_tasks(str(self.tasks_file))
        # 找到 Task B（completed + subtasks）
        task_b = next((t for t in tasks if "Task B" in t.title), None)
        self.assertIsNotNone(task_b)
        self.assertEqual(len(task_b.subtasks), 2)

    def test_T1_05_sort_by_priority(self):
        """T1-05: 按优先级排序"""
        from app.services.loop_commands.triage import parse_tasks, sort_tasks_by_priority
        tasks = parse_tasks(str(self.tasks_file))
        sorted_tasks = sort_tasks_by_priority(tasks)
        # 第一个 pending 任务应该是 P0
        first_pending = next((t for t in sorted_tasks if t.status == "pending"), None)
        self.assertIsNotNone(first_pending)
        self.assertEqual(first_pending.priority, "P0")


class TestTriageServiceAnalyze(unittest.TestCase):
    """T1-06: TriageService.analyze 方法"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.tasks_file = Path(self.tmpdir) / "tasks.md"
        self.tasks_file.write_text("""# Tasks

- [ ] **P0** Task A
- [ ] **P1** Task B
- [x] **P0** Task C
""", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T1_06_analyze_returns_dict(self):
        """T1-06: analyze 返回分组结果"""
        from app.services.loop_commands.triage import TriageService
        service = TriageService(self.tmpdir)
        result = service.analyze()

        self.assertIn("total_tasks", result)
        self.assertIn("by_priority", result)
        self.assertIn("by_status", result)
        self.assertIn("next_recommended", result)

        # 验证分组
        self.assertGreaterEqual(len(result["by_priority"]["P0"]), 1)
        self.assertGreaterEqual(len(result["by_priority"]["P1"]), 1)
        self.assertEqual(len(result["by_priority"]["P2"]), 0)

        # 验证 next_recommended（应该是 P0 pending）
        self.assertIsNotNone(result["next_recommended"])
        self.assertEqual(result["next_recommended"]["priority"], "P0")
        self.assertEqual(result["next_recommended"]["status"], "pending")


class TestTriageNoTasksFile(unittest.TestCase):
    """T1-07: tasks.md 不存在时"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T1_07_no_tasks_file(self):
        """T1-07: tasks.md 不存在返回 error"""
        from app.services.loop_commands.triage import TriageService
        service = TriageService(self.tmpdir)
        result = service.analyze()
        self.assertIn("error", result)
        self.assertEqual(result["total_tasks"], 0)


class TestPlanService(unittest.TestCase):
    """T2: Plan 生成 spec + branch (5 测试)"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        # 初始化 git 仓库
        os.system(f"cd {self.tmpdir} && git init -q && git config user.email 'test@test.com' && git config user.name 'Test'")
        # 创建初始 commit
        (Path(self.tmpdir) / "README.md").write_text("# Test", encoding="utf-8")
        os.system(f"cd {self.tmpdir} && git add -A && git commit -q -m 'init'")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T2_01_ensure_spec_file(self):
        """T2-01: 自动生成 spec.md"""
        from app.services.loop_commands.plan import PlanService
        service = PlanService(self.tmpdir)
        result = service.execute()
        self.assertIn("spec_file", result)
        spec_path = Path(self.tmpdir) / result["spec_file"]
        self.assertTrue(spec_path.exists())

    def test_T2_02_ensure_checklist_file(self):
        """T2-02: 自动生成 checklist.md"""
        from app.services.loop_commands.plan import PlanService
        service = PlanService(self.tmpdir)
        result = service.execute()
        self.assertIn("checklist_file", result)
        check_path = Path(self.tmpdir) / result["checklist_file"]
        self.assertTrue(check_path.exists())

    def test_T2_03_create_branch(self):
        """T2-03: 创建 git 分支"""
        from app.services.loop_commands.plan import PlanService
        service = PlanService(self.tmpdir)
        result = service.execute()
        self.assertIn("branch", result)
        # 验证分支名格式
        self.assertTrue(result["branch"].startswith("loop/plan-"))

    def test_T2_04_result_structure(self):
        """T2-04: 返回结果结构完整"""
        from app.services.loop_commands.plan import PlanService
        service = PlanService(self.tmpdir)
        result = service.execute()
        self.assertIn("branch", result)
        self.assertIn("spec_file", result)
        self.assertIn("checklist_file", result)
        self.assertIn("iteration_count", result)

    def test_T2_05_no_git_repo(self):
        """T2-05: 非 git 仓库也能工作"""
        no_git_tmpdir = tempfile.mkdtemp()
        try:
            from app.services.loop_commands.plan import PlanService
            service = PlanService(no_git_tmpdir)
            result = service.execute()
            # 应该有 fallback 分支名
            self.assertIn("(no-git)", result["branch"])
        finally:
            shutil.rmtree(no_git_tmpdir, ignore_errors=True)


class TestExecuteService(unittest.TestCase):
    """T3: Execute 顺序执行 (5 测试)"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.system(f"cd {self.tmpdir} && git init -q && git config user.email 'test@test.com' && git config user.name 'Test'")
        (Path(self.tmpdir) / "README.md").write_text("# Test", encoding="utf-8")
        os.system(f"cd {self.tmpdir} && git add -A && git commit -q -m 'init'")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T3_01_execute_returns_dict(self):
        """T3-01: execute 返回 dict"""
        from app.services.loop_commands.execute import ExecuteService
        service = ExecuteService(self.tmpdir)
        result = service.execute()
        self.assertIsInstance(result, dict)
        self.assertIn("docs_generated", result)
        self.assertIn("prompts_injected", result)
        self.assertIn("commit_sha", result)

    def test_T3_02_execute_no_changes(self):
        """T3-02: 无变更时不创建 commit"""
        from app.services.loop_commands.execute import ExecuteService
        service = ExecuteService(self.tmpdir)
        result = service.execute()
        # 无变更，commit_sha 应为空
        self.assertEqual(result["commit_sha"], "")

    def test_T3_03_execute_with_changes(self):
        """T3-03: 有变更时自动 git commit"""
        from app.services.loop_commands.execute import ExecuteService
        # 创建一个新文件
        (Path(self.tmpdir) / "new_file.txt").write_text("new content", encoding="utf-8")
        service = ExecuteService(self.tmpdir)
        result = service.execute()
        # 有变更，应该返回 commit_sha
        self.assertNotEqual(result["commit_sha"], "")

    def test_T3_04_auto_commit_message(self):
        """T3-04: commit message 格式"""
        from app.services.loop_commands.execute import ExecuteService
        (Path(self.tmpdir) / "new_file.txt").write_text("new", encoding="utf-8")
        service = ExecuteService(self.tmpdir)
        service.execute(task_id="Test task")
        # 验证 commit message 包含 "loop: execute"
        import subprocess
        log = subprocess.run(
            ["git", "log", "-1", "--pretty=%s"],
            cwd=self.tmpdir, capture_output=True, text=True
        )
        self.assertIn("loop: execute", log.stdout)

    def test_T3_05_execute_with_task_id(self):
        """T3-05: 带 task_id 执行"""
        from app.services.loop_commands.execute import ExecuteService
        service = ExecuteService(self.tmpdir)
        result = service.execute(task_id="custom-task-123")
        self.assertIn("commit_sha", result)


class TestVerifyService(unittest.TestCase):
    """T4: Verify 测试运行 (5 测试)"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T4_01_verify_returns_dict(self):
        """T4-01: verify 返回 dict"""
        from app.services.loop_commands.verify import VerifyService
        service = VerifyService(self.tmpdir)
        result = service.verify(run_unit=False, run_e2e=False, run_typescript=False)
        self.assertIsInstance(result, dict)
        self.assertIn("passed", result)

    def test_T4_02_parse_pytest_output(self):
        """T4-02: 解析 pytest 输出"""
        from app.services.loop_commands.verify import _parse_pytest_output
        output = "===== 25 passed, 3 failed, 1 error in 2.34s ====="
        result = _parse_pytest_output(output, "")
        self.assertEqual(result["passed"], 25)
        self.assertEqual(result["failed"], 3)
        self.assertEqual(result["errors"], 1)
        self.assertEqual(result["total"], 29)

    def test_T4_03_parse_e2e_output(self):
        """T4-03: 解析 E2E 输出"""
        from app.services.loop_commands.verify import _parse_e2e_output
        output = "通过: 10\n失败: 2\n总计: 12"
        result = _parse_e2e_output(output, "")
        self.assertEqual(result["passed"], 10)
        self.assertEqual(result["failed"], 2)
        self.assertEqual(result["total"], 12)

    def test_T4_04_verify_passed_flag(self):
        """T4-04: passed 标志正确"""
        from app.services.loop_commands.verify import VerifyService
        service = VerifyService(self.tmpdir)
        result = service.verify(run_unit=False, run_e2e=False, run_typescript=False)
        # 所有测试都跳过时，passed 应为 True
        self.assertTrue(result["passed"])

    def test_T4_05_verify_with_unit(self):
        """T4-05: 包含单元测试的验证"""
        from app.services.loop_commands.verify import VerifyService
        service = VerifyService(self.tmpdir)
        result = service.verify(run_unit=True, run_e2e=False, run_typescript=False)
        # unit_tests 字段应该存在
        self.assertIn("unit_tests", result)


class TestAsyncRunner(unittest.TestCase):
    """T5: AsyncRunner (3 测试)"""

    def test_T5_01_singleton(self):
        """T5-01: AsyncRunner 是单例"""
        from app.services.loop_commands.async_runner import AsyncRunner
        r1 = AsyncRunner.get_instance()
        r2 = AsyncRunner.get_instance()
        self.assertIs(r1, r2)

    def test_T5_02_submit_creates_workflow(self):
        """T5-02: submit 创建 workflow"""
        from app.services.loop_commands.async_runner import AsyncRunner
        runner = AsyncRunner.get_instance()
        workflow_id = runner.submit(
            action="triage",
            project_path="/tmp",
        )
        status = runner.get_status(workflow_id)
        self.assertIsNotNone(status)
        self.assertEqual(status.action, "triage")

    def test_T5_03_list_workflows(self):
        """T5-03: list_workflows 列出所有"""
        from app.services.loop_commands.async_runner import AsyncRunner
        runner = AsyncRunner.get_instance()
        workflow_id = runner.submit(action="triage", project_path="/tmp")
        workflows = runner.list_workflows()
        self.assertGreater(len(workflows), 0)
        ids = [w.workflow_id for w in workflows]
        self.assertIn(workflow_id, ids)


if __name__ == "__main__":
    unittest.main(verbosity=2)
