"""
# ============================================================
# /goal 长时域模式 - 单元测试
# ============================================================
# 核心作用：测试 /goal 系统的所有核心功能
# 覆盖：base/manager/verifier/markdown/verify_item/progress
# Cycle 12 P0-2 新建
# ============================================================
"""

import json
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any, Dict, List

from app.core.goal import (
    AcceptanceCriterion,
    AcceptanceStatus,
    Goal,
    GoalManager,
    GoalStatus,
    ProgressAction,
    ProgressEntry,
    ProgressLog,
    ProgressStatus,
    TokenBudget,
    VerifyItem,
    VerifyStatus,
    VerifyType,
    Verifier,
    get_manager,
    parse_goal_md,
    render_goal_md,
    render_progress_md,
    render_verify_md,
)


# ============================================================
# 工具函数
# ============================================================
def make_minimal_goal(**overrides) -> Goal:
    """构造最小可用 Goal"""
    goal = Goal(
        title="Test Goal",
        objective="Test objective",
    )
    # 应用覆盖
    for key, value in overrides.items():
        if hasattr(goal, key):
            setattr(goal, key, value)
    return goal


# ============================================================
# 1. 数据模型测试
# ============================================================
class TestGoalModel(unittest.TestCase):
    """Goal 数据模型测试"""

    def test_minimal_goal(self):
        """最小 Goal 创建"""
        goal = Goal(title="Test")
        self.assertTrue(goal.id.startswith("goal_"))
        self.assertEqual(goal.title, "Test")
        self.assertEqual(goal.status, GoalStatus.DRAFT)
        self.assertEqual(goal.token_budget.soft_limit, 40000)
        self.assertEqual(len(goal.acceptance_criteria), 0)

    def test_goal_to_from_dict(self):
        """Goal 序列化"""
        goal = Goal(
            title="Test",
            objective="Obj",
            constraints=["C1"],
            tags=["t1"],
        )
        d = goal.to_dict()
        self.assertEqual(d["title"], "Test")
        self.assertEqual(d["constraints"], ["C1"])
        goal2 = Goal.from_dict(d)
        self.assertEqual(goal2.title, "Test")
        self.assertEqual(goal2.constraints, ["C1"])

    def test_goal_progress_empty(self):
        """空 AC 时进度为 0"""
        goal = Goal(title="Test")
        self.assertEqual(goal.progress(), 0.0)

    def test_goal_progress_partial(self):
        """部分 AC 通过时进度正确"""
        goal = Goal(title="Test")
        ac1 = AcceptanceCriterion(title="AC1", status=AcceptanceStatus.PASSED)
        ac2 = AcceptanceCriterion(title="AC2", status=AcceptanceStatus.PENDING)
        goal.acceptance_criteria = [ac1, ac2]
        self.assertEqual(goal.progress(), 0.5)

    def test_goal_progress_all_passed(self):
        """全部 AC 通过时进度为 1"""
        goal = Goal(title="Test")
        for i in range(3):
            goal.acceptance_criteria.append(
                AcceptanceCriterion(title=f"AC{i}", status=AcceptanceStatus.PASSED)
            )
        self.assertEqual(goal.progress(), 1.0)
        self.assertTrue(goal.is_completable())


class TestTokenBudget(unittest.TestCase):
    """TokenBudget 测试"""

    def test_initial_state(self):
        """初始状态"""
        tb = TokenBudget()
        self.assertEqual(tb.used, 0)
        self.assertEqual(tb.soft_limit, 40000)
        self.assertFalse(tb.is_soft_stop)
        self.assertFalse(tb.is_hard_stop)

    def test_soft_stop(self):
        """软停止"""
        tb = TokenBudget(soft_limit=100, used=100)
        self.assertTrue(tb.is_soft_stop)
        self.assertFalse(tb.is_hard_stop)
        self.assertEqual(tb.remaining, 0)

    def test_hard_stop(self):
        """硬停止"""
        tb = TokenBudget(soft_limit=100, hard_limit=200, used=200)
        self.assertTrue(tb.is_soft_stop)
        self.assertTrue(tb.is_hard_stop)

    def test_warning(self):
        """警告"""
        tb = TokenBudget(soft_limit=100, warning_threshold=80, used=80)
        self.assertTrue(tb.is_warning)
        self.assertFalse(tb.is_soft_stop)

    def test_utilization(self):
        """利用率"""
        tb = TokenBudget(soft_limit=100, used=50)
        self.assertEqual(tb.utilization, 0.5)

    def test_to_from_dict(self):
        """序列化"""
        tb = TokenBudget(soft_limit=200, hard_limit=300, used=50)
        d = tb.to_dict()
        tb2 = TokenBudget.from_dict(d)
        self.assertEqual(tb2.soft_limit, 200)
        self.assertEqual(tb2.used, 50)


class TestAcceptanceCriterion(unittest.TestCase):
    """AC 测试"""

    def test_default_status(self):
        """默认状态为 pending"""
        ac = AcceptanceCriterion(title="AC1")
        self.assertEqual(ac.status, AcceptanceStatus.PENDING)

    def test_to_from_dict(self):
        """序列化"""
        ac = AcceptanceCriterion(
            title="AC1",
            description="desc",
            priority=3,
        )
        d = ac.to_dict()
        ac2 = AcceptanceCriterion.from_dict(d)
        self.assertEqual(ac2.title, "AC1")
        self.assertEqual(ac2.priority, 3)


# ============================================================
# 2. GoalManager 测试
# ============================================================
class TestGoalManager(unittest.TestCase):
    """GoalManager 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="goal_test_"))
        self.manager = GoalManager(storage_dir=str(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_goal(self):
        """创建 Goal"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.assertIsNotNone(goal.id)
        self.assertEqual(goal.status, GoalStatus.DRAFT)

    def test_get_goal(self):
        """获取 Goal"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        got = self.manager.get(goal.id)
        self.assertEqual(got.id, goal.id)

    def test_get_nonexistent(self):
        """获取不存在的 Goal 返回 None"""
        self.assertIsNone(self.manager.get("nonexistent"))

    def test_list_goals(self):
        """列出 Goal"""
        self.manager.create(make_minimal_goal(title="G1"))
        self.manager.create(make_minimal_goal(title="G2"))
        goals = self.manager.list_all()
        self.assertEqual(len(goals), 2)

    def test_list_by_status(self):
        """按状态过滤"""
        g1 = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.create(make_minimal_goal(title="G2"))
        self.manager.start(g1.id)
        active = self.manager.list_all(status=GoalStatus.ACTIVE)
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].id, g1.id)

    def test_list_by_tag(self):
        """按 tag 过滤"""
        self.manager.create(make_minimal_goal(title="G1", tags=["urgent"]))
        self.manager.create(make_minimal_goal(title="G2", tags=["normal"]))
        urgent = self.manager.list_all(tag="urgent")
        self.assertEqual(len(urgent), 1)

    def test_update_goal(self):
        """更新 Goal"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        updated = self.manager.update(goal.id, title="New Title")
        self.assertEqual(updated.title, "New Title")

    def test_delete_goal(self):
        """删除 Goal"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.delete(goal.id)
        self.assertIsNone(self.manager.get(goal.id))

    def test_delete_nonexistent(self):
        """删除不存在抛异常"""
        with self.assertRaises(KeyError):
            self.manager.delete("nonexistent")

    def test_state_machine_start(self):
        """启动"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.start(goal.id)
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.ACTIVE)

    def test_state_machine_pause_resume(self):
        """暂停/恢复"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.start(goal.id)
        self.manager.pause(goal.id)
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.PAUSED)
        self.manager.resume(goal.id)
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.ACTIVE)

    def test_state_machine_complete(self):
        """完成"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        goal.acceptance_criteria.append(
            AcceptanceCriterion(title="AC1", status=AcceptanceStatus.PASSED)
        )
        self.manager.update(goal.id, acceptance_criteria=[
            {"title": "AC1", "status": "passed"}
        ])
        self.manager.start(goal.id)
        self.manager.complete(goal.id)
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.COMPLETED)

    def test_state_machine_fail(self):
        """失败"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.start(goal.id)
        self.manager.fail(goal.id, reason="Test failure")
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.FAILED)

    def test_state_machine_abandon(self):
        """放弃"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        self.manager.start(goal.id)
        self.manager.abandon(goal.id, reason="Not needed")
        self.assertEqual(self.manager.get(goal.id).status, GoalStatus.ABANDONED)

    def test_invalid_transition(self):
        """无效状态转移"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        with self.assertRaises(ValueError):
            # DRAFT -> COMPLETED 不允许
            self.manager.complete(goal.id)

    def test_complete_with_incomplete_ac(self):
        """未完成 AC 时不能 complete"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        goal.acceptance_criteria.append(AcceptanceCriterion(title="AC1", status=AcceptanceStatus.PENDING))
        self.manager.start(goal.id)
        with self.assertRaises(ValueError):
            self.manager.complete(goal.id)

    def test_add_acceptance(self):
        """添加 AC"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        ac = AcceptanceCriterion(title="AC1")
        self.manager.add_acceptance_criterion(goal.id, ac)
        self.assertEqual(len(self.manager.get(goal.id).acceptance_criteria), 1)

    def test_update_acceptance(self):
        """更新 AC"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        ac = AcceptanceCriterion(title="AC1")
        self.manager.add_acceptance_criterion(goal.id, ac)
        updated = self.manager.update_acceptance_criterion(
            goal.id, ac.id, status="passed"
        )
        self.assertEqual(updated.status, AcceptanceStatus.PASSED)
        self.assertIsNotNone(updated.completed_at)

    def test_add_tokens(self):
        """添加 token"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        budget = self.manager.add_tokens(goal.id, 1000)
        self.assertEqual(budget.used, 1000)

    def test_token_warning(self):
        """token 警告"""
        goal = self.manager.create(make_minimal_goal(
            title="G1",
            token_budget=TokenBudget(soft_limit=100, warning_threshold=80, used=0)
        ))
        budget = self.manager.add_tokens(goal.id, 85)
        self.assertTrue(budget.is_warning)

    def test_token_hard_stop(self):
        """token 硬停止"""
        goal = self.manager.create(make_minimal_goal(
            title="G1",
            token_budget=TokenBudget(soft_limit=100, hard_limit=150, used=0)
        ))
        budget = self.manager.add_tokens(goal.id, 150)
        self.assertTrue(budget.is_hard_stop)

    def test_check_budget(self):
        """检查预算"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        result = self.manager.check_budget(goal.id)
        self.assertIn("used", result)
        self.assertIn("remaining", result)

    def test_add_progress(self):
        """添加进度"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        entry = ProgressEntry(status=ProgressStatus.STARTED)
        self.manager.add_progress(goal.id, entry)
        log = self.manager.get_progress(goal.id)
        self.assertEqual(len(log.entries), 1)

    def test_persistence(self):
        """持久化"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        # 创建新 manager 模拟重启
        new_manager = GoalManager(storage_dir=str(self.tmpdir))
        got = new_manager.get(goal.id)
        self.assertIsNotNone(got)
        self.assertEqual(got.title, "G1")

    def test_thread_safety(self):
        """线程安全"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        errors = []

        def worker():
            try:
                for _ in range(10):
                    self.manager.add_tokens(goal.id, 100)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(errors), 0)
        self.assertEqual(self.manager.get(goal.id).token_budget.used, 5000)

    def test_get_stats(self):
        """统计信息"""
        self.manager.create(make_minimal_goal(title="G1"))
        self.manager.create(make_minimal_goal(title="G2"))
        stats = self.manager.get_stats()
        self.assertEqual(stats["total"], 2)
        self.assertIn("by_status", stats)


# ============================================================
# 3. VerifyItem 测试
# ============================================================
class TestVerifyItem(unittest.TestCase):
    """VerifyItem 测试"""

    def test_default(self):
        """默认值"""
        item = VerifyItem(title="VI1")
        self.assertEqual(item.verify_type, VerifyType.COMMAND)
        self.assertEqual(item.status, VerifyStatus.PENDING)
        self.assertEqual(item.timeout, 60)

    def test_to_from_dict(self):
        """序列化"""
        item = VerifyItem(
            title="VI1",
            verify_type=VerifyType.FILE_EXISTS,
            target="/tmp/test",
            expected="exists",
        )
        d = item.to_dict()
        item2 = VerifyItem.from_dict(d)
        self.assertEqual(item2.title, "VI1")
        self.assertEqual(item2.verify_type, VerifyType.FILE_EXISTS)


# ============================================================
# 4. Verifier 测试
# ============================================================
class TestVerifier(unittest.TestCase):
    """Verifier 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="verify_test_"))
        self.verifier = Verifier()
        self.manager = GoalManager(storage_dir=str(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_verify_command_success(self):
        """命令成功"""
        item = VerifyItem(
            title="echo test",
            verify_type=VerifyType.COMMAND,
            target="echo hello",
            expected="",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.PASSED)
        self.assertEqual(result.exit_code, 0)

    def test_verify_command_failure(self):
        """命令失败"""
        item = VerifyItem(
            title="false",
            verify_type=VerifyType.COMMAND,
            target="false",
            expected="",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.FAILED)

    def test_verify_command_disallowed(self):
        """不允许的命令"""
        item = VerifyItem(
            title="rm",
            verify_type=VerifyType.COMMAND,
            target="rm -rf /",
            expected="",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.ERROR)

    def test_verify_file_exists_pass(self):
        """文件存在检查通过"""
        test_file = self.tmpdir / "test.txt"
        test_file.write_text("content")
        item = VerifyItem(
            title="file exists",
            verify_type=VerifyType.FILE_EXISTS,
            target=str(test_file),
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.PASSED)

    def test_verify_file_exists_fail(self):
        """文件存在检查失败"""
        item = VerifyItem(
            title="file exists",
            verify_type=VerifyType.FILE_EXISTS,
            target="/tmp/nonexistent_xyz_12345",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.FAILED)

    def test_verify_file_contains_pass(self):
        """文件内容检查通过"""
        test_file = self.tmpdir / "test.txt"
        test_file.write_text("hello world")
        item = VerifyItem(
            title="contains",
            verify_type=VerifyType.FILE_CONTAINS,
            target=str(test_file),
            expected="hello",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.PASSED)

    def test_verify_file_contains_fail(self):
        """文件内容检查失败"""
        test_file = self.tmpdir / "test.txt"
        test_file.write_text("hello world")
        item = VerifyItem(
            title="contains",
            verify_type=VerifyType.FILE_CONTAINS,
            target=str(test_file),
            expected="not_in_file",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.FAILED)

    def test_verify_path_not_allowed(self):
        """路径不在白名单"""
        item = VerifyItem(
            title="file",
            verify_type=VerifyType.FILE_EXISTS,
            target="/etc/passwd",
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.ERROR)

    def test_verify_custom_skipped(self):
        """自定义验证跳过"""
        item = VerifyItem(
            title="custom",
            verify_type=VerifyType.CUSTOM,
        )
        result = self.verifier.verify_one(item)
        self.assertEqual(result.status, VerifyStatus.SKIPPED)

    def test_verify_all(self):
        """批量验证"""
        items = [
            VerifyItem(title="pass", verify_type=VerifyType.COMMAND, target="echo ok"),
            VerifyItem(title="fail", verify_type=VerifyType.COMMAND, target="false"),
        ]
        report = self.verifier.verify_all(items, goal_id="test")
        self.assertEqual(report.total, 2)
        self.assertEqual(report.passed, 1)
        self.assertEqual(report.failed, 1)
        self.assertFalse(report.is_all_passed)


class TestVerifyManagerIntegration(unittest.TestCase):
    """验证项 + Manager 集成测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="goal_test_"))
        self.manager = GoalManager(storage_dir=str(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_add_verify_item(self):
        """添加验证项"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        item = VerifyItem(title="VI1")
        self.manager.add_verify_item(goal.id, item)
        items = self.manager.list_verify_items(goal.id)
        self.assertEqual(len(items), 1)

    def test_update_verify_item(self):
        """更新验证项"""
        goal = self.manager.create(make_minimal_goal(title="G1"))
        item = VerifyItem(title="VI1")
        self.manager.add_verify_item(goal.id, item)
        updated = self.manager.update_verify_item(goal.id, item.id, status="passed")
        self.assertEqual(updated.status, VerifyStatus.PASSED)


# ============================================================
# 5. Markdown 渲染测试
# ============================================================
class TestMarkdownRendering(unittest.TestCase):
    """Markdown 渲染测试"""

    def test_render_goal_md(self):
        """渲染 GOAL.md"""
        goal = Goal(
            title="Test Goal",
            objective="Test objective",
        )
        goal.acceptance_criteria.append(AcceptanceCriterion(title="AC1"))
        goal.constraints.append("Use Python")
        md = render_goal_md(goal)
        self.assertIn("# Goal: Test Goal", md)
        self.assertIn("AC1", md)
        self.assertIn("Use Python", md)
        self.assertIn("Token Budget", md)

    def test_render_verify_md(self):
        """渲染 VERIFY.md"""
        goal = Goal(title="Test")
        items = [
            VerifyItem(title="VI1", verify_type=VerifyType.COMMAND, target="echo"),
            VerifyItem(title="VI2", verify_type=VerifyType.FILE_EXISTS, target="/tmp/x"),
        ]
        md = render_verify_md(goal, items)
        self.assertIn("VI1", md)
        self.assertIn("VI2", md)
        self.assertIn("command", md)

    def test_render_progress_md(self):
        """渲染 PROGRESS.md"""
        log = ProgressLog(goal_id="test")
        log.entries.append(ProgressEntry(
            status=ProgressStatus.STARTED,
            action=ProgressAction(description="Started test"),
        ))
        md = render_progress_md(log)
        self.assertIn("Progress Log", md)
        self.assertIn("Started test", md)
        self.assertIn("STARTED", md)

    def test_parse_goal_md(self):
        """解析 GOAL.md"""
        md = """
# Goal: Test
## Objective
Test objective here
## Acceptance Criteria
- [ ] **AC1**: First criterion
## Constraints
- Use Python
"""
        result = parse_goal_md(md)
        self.assertEqual(result["title"], "Test")
        self.assertIn("First criterion", str(result["acceptance_criteria"]))


# ============================================================
# 6. Progress 测试
# ============================================================
class TestProgress(unittest.TestCase):
    """Progress 测试"""

    def test_progress_entry_default(self):
        """默认进度条目"""
        entry = ProgressEntry()
        self.assertEqual(entry.status, ProgressStatus.INFO)

    def test_progress_log_append(self):
        """进度日志追加"""
        log = ProgressLog(goal_id="test")
        log.append(ProgressEntry(status=ProgressStatus.STARTED))
        log.append(ProgressEntry(status=ProgressStatus.COMPLETED))
        self.assertEqual(len(log.entries), 2)

    def test_progress_log_filter(self):
        """进度日志过滤"""
        log = ProgressLog(goal_id="test")
        log.append(ProgressEntry(status=ProgressStatus.STARTED))
        log.append(ProgressEntry(status=ProgressStatus.COMPLETED))
        completed = log.get_by_status(ProgressStatus.COMPLETED)
        self.assertEqual(len(completed), 1)


if __name__ == "__main__":
    unittest.main()
