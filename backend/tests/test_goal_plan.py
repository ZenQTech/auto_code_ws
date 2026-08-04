"""
# ============================================================
# Plan / Step / Verifier 单元测试
# Cycle 61 G61-02
# ====================================
"""

import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.goal.plan import (
    GoalPlan,
    PlanStatus,
    PlanStep,
    StepStatus,
    StepStrategy,
)
from app.core.goal.step_verifier import (
    StepVerifier,
    VerifierError,
    get_step_verifier,
    reset_step_verifier,
)


class TestPlanStep(unittest.TestCase):
    """PlanStep 单元测试"""

    def test_default_status_is_pending(self) -> None:
        step = PlanStep(title="test")
        self.assertEqual(step.status, StepStatus.PENDING)

    def test_start_sets_running(self) -> None:
        step = PlanStep(title="test")
        step.start()
        self.assertEqual(step.status, StepStatus.RUNNING)
        self.assertIsNotNone(step.started_at)

    def test_start_from_non_pending_raises(self) -> None:
        step = PlanStep(title="test")
        step.start()
        with self.assertRaises(ValueError):
            step.start()

    def test_finish_success(self) -> None:
        step = PlanStep(title="test")
        step.start()
        step.finish_success(output="done")
        self.assertEqual(step.status, StepStatus.SUCCESS)
        self.assertEqual(step.output, "done")
        self.assertIsNotNone(step.finished_at)

    def test_finish_failed_increments_retry(self) -> None:
        step = PlanStep(title="test")
        step.start()
        step.finish_failed(error="oops", exit_code=1)
        self.assertEqual(step.status, StepStatus.FAILED)
        self.assertEqual(step.retry_count, 1)
        self.assertEqual(step.error, "oops")
        self.assertEqual(step.exit_code, 1)

    def test_skip_only_from_pending(self) -> None:
        step = PlanStep(title="test")
        step.skip(reason="not needed")
        self.assertEqual(step.status, StepStatus.SKIPPED)
        self.assertEqual(step.metadata.get("skip_reason"), "not needed")

    def test_skip_ignored_after_start(self) -> None:
        step = PlanStep(title="test")
        step.start()
        step.skip()
        # running 状态不会切换
        self.assertEqual(step.status, StepStatus.RUNNING)

    def test_can_retry(self) -> None:
        step = PlanStep(title="test", strategy=StepStrategy.RETRY, max_retries=3)
        self.assertFalse(step.can_retry())  # pending 状态
        step.start()
        step.finish_failed("err")
        self.assertTrue(step.can_retry())
        step.retry_count = 3
        self.assertFalse(step.can_retry())

    def test_cannot_retry_with_skip_strategy(self) -> None:
        step = PlanStep(title="test", strategy=StepStrategy.SKIP)
        step.start()
        step.finish_failed("err")
        self.assertFalse(step.can_retry())

    def test_duration_ms_zero_when_not_started(self) -> None:
        step = PlanStep(title="test")
        self.assertEqual(step.duration_ms(), 0)

    def test_to_from_dict_roundtrip(self) -> None:
        step = PlanStep(
            title="step",
            description="desc",
            order=2,
            prompt="p",
            tool="bash",
            command="ls",
            file_path="",
            max_retries=5,
        )
        data = step.to_dict()
        restored = PlanStep.from_dict(data)
        self.assertEqual(restored.title, "step")
        self.assertEqual(restored.description, "desc")
        self.assertEqual(restored.order, 2)
        self.assertEqual(restored.prompt, "p")
        self.assertEqual(restored.tool, "bash")
        self.assertEqual(restored.max_retries, 5)
        self.assertEqual(restored.status, StepStatus.PENDING)


class TestGoalPlan(unittest.TestCase):
    """GoalPlan 单元测试"""

    def test_add_step_assigns_incremental_order(self) -> None:
        plan = GoalPlan(title="test")
        s1 = plan.add_step(title="s1")
        s2 = plan.add_step(title="s2")
        self.assertEqual(s1.order, 0)
        self.assertEqual(s2.order, 1)
        self.assertEqual(len(plan.steps), 2)

    def test_update_progress_calculates_correctly(self) -> None:
        plan = GoalPlan(title="test")
        plan.add_step(title="s1")
        plan.add_step(title="s2")
        plan.add_step(title="s3")
        plan.add_step(title="s4")
        # 0 终态
        self.assertEqual(plan.update_progress(), 0.0)
        # 1 终态
        plan.steps[0].start()
        plan.steps[0].finish_success()
        self.assertAlmostEqual(plan.update_progress(), 0.25)
        # 全部成功
        for s in plan.steps[1:]:
            s.start()
            s.finish_success()
        self.assertAlmostEqual(plan.update_progress(), 1.0)

    def test_complete_sets_progress_one(self) -> None:
        plan = GoalPlan(title="test")
        plan.add_step(title="s1")
        plan.steps[0].start()
        plan.steps[0].finish_success()
        plan.complete()
        self.assertEqual(plan.status, PlanStatus.COMPLETED)
        self.assertEqual(plan.progress, 1.0)

    def test_cancel_cancels_pending_and_running(self) -> None:
        plan = GoalPlan(title="test")
        plan.add_step(title="s1")  # pending
        plan.add_step(title="s2")  # running
        plan.add_step(title="s3")  # success
        plan.steps[1].start()
        plan.steps[2].start()
        plan.steps[2].finish_success()
        plan.cancel()
        self.assertEqual(plan.status, PlanStatus.CANCELLED)
        self.assertEqual(plan.steps[0].status, StepStatus.CANCELLED)
        self.assertEqual(plan.steps[1].status, StepStatus.CANCELLED)
        self.assertEqual(plan.steps[2].status, StepStatus.SUCCESS)

    def test_step_stats(self) -> None:
        plan = GoalPlan(title="test")
        plan.add_step(title="s1")
        plan.add_step(title="s2")
        plan.add_step(title="s3")
        plan.steps[0].start()
        plan.steps[0].finish_success()
        plan.steps[1].skip()
        stats = plan.step_stats()
        self.assertEqual(stats["success"], 1)
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["pending"], 1)

    def test_next_pending_step(self) -> None:
        plan = GoalPlan(title="test")
        s1 = plan.add_step(title="s1")
        s2 = plan.add_step(title="s2")
        self.assertEqual(plan.next_pending_step(), s1)
        s1.start()
        s1.finish_success()
        self.assertEqual(plan.next_pending_step(), s2)

    def test_to_from_dict_roundtrip(self) -> None:
        plan = GoalPlan(title="plan", description="desc", goal_id="g1")
        plan.add_step(title="s1")
        plan.add_step(title="s2")
        data = plan.to_dict()
        restored = GoalPlan.from_dict(data)
        self.assertEqual(restored.title, "plan")
        self.assertEqual(restored.goal_id, "g1")
        self.assertEqual(len(restored.steps), 2)
        self.assertEqual(restored.steps[0].title, "s1")
        self.assertEqual(restored.steps[1].title, "s2")


class TestStepVerifier(unittest.TestCase):
    """StepVerifier 单元测试"""

    def setUp(self) -> None:
        reset_step_verifier()
        self.v = StepVerifier(default_timeout=5)

    def tearDown(self) -> None:
        reset_step_verifier()

    def test_verify_exists_true(self) -> None:
        async def run() -> StepVerifier:
            return self.v

        # 同步等待
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(PlanStep(step_id="s1", title="t"), verify_type="exists", target="/tmp")
            )
        finally:
            loop.close()
        self.assertTrue(result.passed)
        self.assertEqual(result.reason, "存在")

    def test_verify_exists_false(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="exists",
                    target="/nonexistent_path_xyz",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)
        self.assertEqual(result.reason, "不存在")

    def test_verify_contains_true(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="contains",
                    target="hello world",
                    expected="world",
                )
            )
        finally:
            loop.close()
        self.assertTrue(result.passed)
        self.assertIn("world", result.reason)

    def test_verify_contains_false(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="contains",
                    target="hello world",
                    expected="missing",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)
        self.assertIn("不包含", result.reason)

    def test_verify_command_success(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="command",
                    target="echo hello",
                    expected="hello",
                )
            )
        finally:
            loop.close()
        self.assertTrue(result.passed)
        self.assertIn("returncode=0", result.reason)

    def test_verify_command_failure(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="command",
                    target="exit 1",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)

    def test_verify_command_timeout(self) -> None:
        v = StepVerifier(default_timeout=1)
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="command",
                    target="sleep 10",
                    timeout=1,
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)
        self.assertIn("timeout", result.reason.lower())

    def test_verify_file_exists(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("hello world")
            tmp_path = f.name
        try:
            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(
                    self.v.verify_step(
                        PlanStep(step_id="s1", title="t"),
                        verify_type="file",
                        target=tmp_path,
                    )
                )
            finally:
                loop.close()
            self.assertTrue(result.passed)
        finally:
            Path(tmp_path).unlink()

    def test_verify_file_contains(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("hello world")
            tmp_path = f.name
        try:
            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(
                    self.v.verify_step(
                        PlanStep(step_id="s1", title="t"),
                        verify_type="file",
                        target=tmp_path,
                        expected="world",
                    )
                )
            finally:
                loop.close()
            self.assertTrue(result.passed)
        finally:
            Path(tmp_path).unlink()

    def test_verify_file_not_found(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="file",
                    target="/nonexistent_path_xyz",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)

    def test_verify_unknown_type(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="unknown_type",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)
        self.assertIn("未知", result.reason)

    def test_verify_command_no_target(self) -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                self.v.verify_step(
                    PlanStep(step_id="s1", title="t"),
                    verify_type="command",
                    target="",
                )
            )
        finally:
            loop.close()
        self.assertFalse(result.passed)
        self.assertIn("必须提供", result.reason)

    def test_get_step_verifier_singleton(self) -> None:
        v1 = get_step_verifier()
        v2 = get_step_verifier()
        self.assertIs(v1, v2)


class TestGoalManagerPlanIntegration(unittest.TestCase):
    """GoalManager Plan/Step 集成测试"""

    def setUp(self) -> None:
        # 使用临时目录避免污染用户目录
        from app.core.goal import manager as mgr_module
        from app.core.goal.manager import GoalManager

        self.tmp_dir = tempfile.mkdtemp()
        mgr_module._manager_instance = None
        self.gm = GoalManager(storage_dir=self.tmp_dir)
        # 注入到模块
        mgr_module._manager_instance = self.gm

        # 创建测试 Goal
        from app.core.goal.base import Goal
        from app.core.goal.manager import get_manager

        self.goal = Goal(id="test-goal-1", title="Test Goal", objective="obj")
        get_manager().create(self.goal)

    def tearDown(self) -> None:
        from app.core.goal import manager as mgr_module
        import shutil

        mgr_module._manager_instance = None
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_create_plan(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "Plan A", "desc")
        self.assertEqual(plan.title, "Plan A")
        self.assertEqual(plan.goal_id, "test-goal-1")
        self.assertEqual(plan.status, PlanStatus.DRAFT)

    def test_create_plan_goal_not_found(self) -> None:
        from app.core.goal.manager import get_manager

        with self.assertRaises(KeyError):
            get_manager().create_plan("nonexistent", "x")

    def test_list_plans(self) -> None:
        from app.core.goal.manager import get_manager

        get_manager().create_plan("test-goal-1", "Plan A")
        get_manager().create_plan("test-goal-1", "Plan B")
        plans = get_manager().list_plans("test-goal-1")
        self.assertEqual(len(plans), 2)

    def test_add_step_to_plan(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        step = get_manager().add_step(plan.plan_id, "S1", "desc")
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(step.title, "S1")
        self.assertEqual(step.order, 0)

    def test_update_step_status(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        step = get_manager().add_step(plan.plan_id, "S1")
        updated = get_manager().update_step_status(
            plan.plan_id, step.step_id, StepStatus.RUNNING
        )
        self.assertEqual(updated.status, StepStatus.RUNNING)
        self.assertIsNotNone(updated.started_at)

    def test_start_pause_resume_plan(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        get_manager().start_plan(plan.plan_id)
        self.assertEqual(plan.status, PlanStatus.RUNNING)
        get_manager().pause_plan(plan.plan_id)
        self.assertEqual(plan.status, PlanStatus.PAUSED)
        get_manager().resume_plan(plan.plan_id)
        self.assertEqual(plan.status, PlanStatus.RUNNING)

    def test_complete_plan_with_failed_step_raises(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        step = get_manager().add_step(plan.plan_id, "S1")
        get_manager().start_plan(plan.plan_id)
        get_manager().update_step_status(plan.plan_id, step.step_id, StepStatus.RUNNING)
        get_manager().update_step_status(plan.plan_id, step.step_id, StepStatus.FAILED, error="err")
        with self.assertRaises(ValueError):
            get_manager().complete_plan(plan.plan_id)

    def test_complete_plan_with_all_success(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        s1 = get_manager().add_step(plan.plan_id, "S1")
        get_manager().start_plan(plan.plan_id)
        get_manager().update_step_status(plan.plan_id, s1.step_id, StepStatus.RUNNING)
        get_manager().update_step_status(plan.plan_id, s1.step_id, StepStatus.SUCCESS)
        get_manager().complete_plan(plan.plan_id)
        self.assertEqual(plan.status, PlanStatus.COMPLETED)

    def test_cancel_plan(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        get_manager().add_step(plan.plan_id, "S1")
        get_manager().start_plan(plan.plan_id)
        get_manager().cancel_plan(plan.plan_id)
        self.assertEqual(plan.status, PlanStatus.CANCELLED)
        self.assertEqual(plan.steps[0].status, StepStatus.CANCELLED)

    def test_get_plan_progress(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        s1 = get_manager().add_step(plan.plan_id, "S1")
        s2 = get_manager().add_step(plan.plan_id, "S2")
        get_manager().start_plan(plan.plan_id)
        get_manager().update_step_status(plan.plan_id, s1.step_id, StepStatus.RUNNING)
        get_manager().update_step_status(plan.plan_id, s1.step_id, StepStatus.SUCCESS)
        progress = get_manager().get_plan_progress(plan.plan_id)
        self.assertEqual(progress["total_steps"], 2)
        self.assertAlmostEqual(progress["progress"], 0.5)
        self.assertEqual(progress["step_stats"]["success"], 1)
        self.assertEqual(progress["step_stats"]["pending"], 1)

    def test_delete_plan(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        get_manager().delete_plan(plan.plan_id)
        self.assertIsNone(get_manager().get_plan(plan.plan_id))
        self.assertEqual(len(get_manager().list_plans("test-goal-1")), 0)

    def test_persistence_roundtrip(self) -> None:
        """测试 Plan 持久化往返"""
        from app.core.goal import manager as mgr_module
        from app.core.goal.manager import GoalManager, get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        s1 = get_manager().add_step(plan.plan_id, "S1")

        # 重新创建 manager（模拟重启）
        mgr_module._manager_instance = None
        gm2 = GoalManager(storage_dir=self.tmp_dir)
        mgr_module._manager_instance = gm2

        loaded_plan = gm2.get_plan(plan.plan_id)
        self.assertIsNotNone(loaded_plan)
        self.assertEqual(loaded_plan.title, "P")
        self.assertEqual(len(loaded_plan.steps), 1)
        self.assertEqual(loaded_plan.steps[0].title, "S1")

    def test_delete_goal_cascades_plans(self) -> None:
        from app.core.goal.manager import get_manager

        plan = get_manager().create_plan("test-goal-1", "P")
        get_manager().delete("test-goal-1")
        # 关联 Plan 也应被删除
        self.assertIsNone(get_manager().get_plan(plan.plan_id))


if __name__ == "__main__":
    unittest.main()
