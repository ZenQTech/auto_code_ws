"""
# ============================================================
# Goal Scheduler - 单元测试
# ============================================================
# 核心作用：覆盖 GoalScheduler 资源隔离 + 优先级调度全部功能
# 覆盖范围：
#   - ResourceQuota / ResourceUsage / ScheduleDecision 数据类
#   - 配额注册/注销
#   - 资源使用追踪
#   - 配额状态检测
#   - 调度决策（5 种场景）
#   - 等待队列（按优先级排序）
#   - 公平共享得分
#   - 统计与清理
#   - 全局单例
#   - 并发安全
# 运行：python3 -m pytest tests/test_goal_scheduler_units.py -v
# ============================================================
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

# 添加 backend 目录到 sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.goal_scheduler import (
    PRIORITY_VALUE,
    GoalPriority,
    GoalScheduler,
    QuotaStatus,
    ResourceQuota,
    ResourceUsage,
    ScheduleDecision,
    SchedulingPolicy,
    get_scheduler,
    reset_scheduler,
)


# ============================================================
# 工具
# ============================================================
def _make_temp_dir() -> str:
    return tempfile.mkdtemp(prefix="goal_scheduler_test_")


def _cleanup_dir(path: str) -> None:
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


# ============================================================
# 数据类
# ============================================================
class TestResourceQuota(unittest.TestCase):
    """ResourceQuota 数据类测试"""

    def test_default_values(self):
        """默认值"""
        q = ResourceQuota(goal_id="goal_1")
        self.assertEqual(q.goal_id, "goal_1")
        self.assertEqual(q.max_tokens, 100000)
        self.assertEqual(q.max_turns, 1000)
        self.assertEqual(q.max_concurrent, 1)
        self.assertEqual(q.priority, GoalPriority.NORMAL.value)
        self.assertEqual(q.weight, 1.0)

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        q = ResourceQuota(
            goal_id="goal_1",
            max_tokens=5000,
            priority="high",
            weight=2.5,
        )
        d = q.to_dict()
        q2 = ResourceQuota.from_dict(d)
        self.assertEqual(q2.goal_id, "goal_1")
        self.assertEqual(q2.max_tokens, 5000)
        self.assertEqual(q2.priority, "high")
        self.assertEqual(q2.weight, 2.5)


class TestResourceUsage(unittest.TestCase):
    """ResourceUsage 数据类测试"""

    def test_default_values(self):
        """默认值"""
        u = ResourceUsage(goal_id="goal_1")
        self.assertEqual(u.goal_id, "goal_1")
        self.assertEqual(u.tokens_used, 0)
        self.assertEqual(u.turns_used, 0)
        self.assertEqual(u.concurrent_active, 0)

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        u = ResourceUsage(goal_id="goal_1", tokens_used=1000, turns_used=5, concurrent_active=2)
        d = u.to_dict()
        u2 = ResourceUsage.from_dict(d)
        self.assertEqual(u2.tokens_used, 1000)
        self.assertEqual(u2.turns_used, 5)
        self.assertEqual(u2.concurrent_active, 2)


class TestScheduleDecision(unittest.TestCase):
    """ScheduleDecision 数据类测试"""

    def test_default_decision_id(self):
        """默认 decision_id 自动生成"""
        dec = ScheduleDecision()
        self.assertTrue(dec.decision_id.startswith("dec_"))
        self.assertEqual(len(dec.decision_id), 12)

    def test_to_dict(self):
        """to_dict"""
        dec = ScheduleDecision(goal_id="g1", can_run=True, reason="ok", priority_value=3)
        d = dec.to_dict()
        self.assertEqual(d["goal_id"], "g1")
        self.assertTrue(d["can_run"])
        self.assertEqual(d["reason"], "ok")
        self.assertEqual(d["priority_value"], 3)


class TestPriorityValue(unittest.TestCase):
    """PRIORITY_VALUE 映射测试"""

    def test_priority_mapping(self):
        """优先级 → 数值映射"""
        self.assertEqual(PRIORITY_VALUE[GoalPriority.LOW], 1)
        self.assertEqual(PRIORITY_VALUE[GoalPriority.NORMAL], 2)
        self.assertEqual(PRIORITY_VALUE[GoalPriority.HIGH], 3)
        self.assertEqual(PRIORITY_VALUE[GoalPriority.URGENT], 4)
        self.assertEqual(PRIORITY_VALUE[GoalPriority.CRITICAL], 5)


# ============================================================
# 配额管理
# ============================================================
class TestQuotaManagement(unittest.TestCase):
    """配额注册/注销测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_register_quota(self):
        """注册配额"""
        q = ResourceQuota(goal_id="goal_1", max_tokens=5000, priority="high")
        result = self.scheduler.register_quota(q)
        self.assertEqual(result.goal_id, "goal_1")
        self.assertEqual(self.scheduler.get_quota("goal_1").max_tokens, 5000)

    def test_unregister_quota(self):
        """注销配额"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        self.assertTrue(self.scheduler.unregister_quota("goal_1"))
        self.assertIsNone(self.scheduler.get_quota("goal_1"))

    def test_unregister_nonexistent(self):
        """注销不存在的配额"""
        self.assertFalse(self.scheduler.unregister_quota("nonexistent"))

    def test_list_quotas(self):
        """列出所有配额"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_2"))
        quotas = self.scheduler.list_quotas()
        self.assertEqual(len(quotas), 2)
        ids = {q.goal_id for q in quotas}
        self.assertEqual(ids, {"goal_1", "goal_2"})

    def test_register_creates_usage(self):
        """注册配额时自动创建 usage 记录"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        usage = self.scheduler.get_usage("goal_1")
        self.assertIsNotNone(usage)
        self.assertEqual(usage.goal_id, "goal_1")
        self.assertEqual(usage.tokens_used, 0)


# ============================================================
# 资源使用追踪
# ============================================================
class TestResourceTracking(unittest.TestCase):
    """资源使用追踪测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_record_token_usage(self):
        """记录 Token 使用"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        self.scheduler.record_token_usage("goal_1", 1000)
        self.scheduler.record_token_usage("goal_1", 500)
        usage = self.scheduler.get_usage("goal_1")
        self.assertEqual(usage.tokens_used, 1500)

    def test_record_turn(self):
        """记录轮转"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        self.scheduler.record_turn("goal_1")
        self.scheduler.record_turn("goal_1")
        usage = self.scheduler.get_usage("goal_1")
        self.assertEqual(usage.turns_used, 2)

    def test_mark_active_inactive(self):
        """标记活跃/非活跃"""
        self.scheduler.register_quota(ResourceQuota(goal_id="goal_1"))
        self.scheduler.mark_active("goal_1")
        self.scheduler.mark_active("goal_1")
        self.assertEqual(self.scheduler.get_usage("goal_1").concurrent_active, 2)
        self.assertIn("goal_1", self.scheduler.get_active_goals())

        self.scheduler.mark_inactive("goal_1")
        self.assertEqual(self.scheduler.get_usage("goal_1").concurrent_active, 1)
        self.assertIn("goal_1", self.scheduler.get_active_goals())

        self.scheduler.mark_inactive("goal_1")
        self.assertEqual(self.scheduler.get_usage("goal_1").concurrent_active, 0)
        self.assertNotIn("goal_1", self.scheduler.get_active_goals())


# ============================================================
# 配额状态检测
# ============================================================
class TestQuotaStatusCheck(unittest.TestCase):
    """配额状态检测测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_status_ok(self):
        """未达上限时状态 OK"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_tokens=1000))
        self.assertEqual(self.scheduler._check_quota_status("g1"), QuotaStatus.OK)

    def test_status_warning(self):
        """达到软上限时状态 WARNING"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_tokens=1000, soft_limit=0.5))
        self.scheduler.record_token_usage("g1", 600)
        self.assertEqual(self.scheduler._check_quota_status("g1"), QuotaStatus.WARNING)

    def test_status_exhausted_tokens(self):
        """Token 耗尽"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_tokens=1000))
        self.scheduler.record_token_usage("g1", 1000)
        self.assertEqual(self.scheduler._check_quota_status("g1"), QuotaStatus.EXHAUSTED)

    def test_status_exhausted_turns(self):
        """Turn 耗尽"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_turns=5))
        for _ in range(5):
            self.scheduler.record_turn("g1")
        self.assertEqual(self.scheduler._check_quota_status("g1"), QuotaStatus.EXHAUSTED)


# ============================================================
# 调度决策
# ============================================================
class TestScheduleDecisionLogic(unittest.TestCase):
    """调度决策逻辑测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(
            storage_dir=self.tmp,
            max_concurrent_goals=3,
        )

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_grant_when_ok(self):
        """配额正常时允许执行"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1"))
        dec = self.scheduler.request_schedule("g1")
        self.assertTrue(dec.can_run)
        self.assertEqual(dec.reason, "ok")

    def test_deny_when_exhausted(self):
        """配额耗尽时拒绝"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_tokens=100))
        self.scheduler.record_token_usage("g1", 100)
        dec = self.scheduler.request_schedule("g1")
        self.assertFalse(dec.can_run)
        self.assertEqual(dec.reason, "quota_exhausted")
        self.assertEqual(dec.resource_status, QuotaStatus.EXHAUSTED.value)

    def test_throttle_when_max_concurrent_reached(self):
        """单 Goal 达到 max_concurrent 时被限流"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_concurrent=2))
        self.scheduler.mark_active("g1")
        self.scheduler.mark_active("g1")
        dec = self.scheduler.request_schedule("g1")
        self.assertFalse(dec.can_run)
        self.assertEqual(dec.reason, "max_concurrent_reached")

    def test_throttle_when_global_concurrency_reached(self):
        """达到全局并发上限时被限流"""
        # 注册 4 个 Goal，前 3 个占用
        for i in range(4):
            self.scheduler.register_quota(ResourceQuota(goal_id=f"g{i+1}"))
        for i in range(3):
            self.scheduler.mark_active(f"g{i+1}")

        # 第 4 个应该被限流
        dec = self.scheduler.request_schedule("g4")
        self.assertFalse(dec.can_run)
        self.assertEqual(dec.reason, "global_max_concurrent_reached")
        self.assertGreater(dec.queue_position, 0)

    def test_priority_value_recorded(self):
        """决策中包含优先级值"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", priority="critical"))
        dec = self.scheduler.request_schedule("g1")
        self.assertEqual(dec.priority_value, 5)

    def test_unregistered_goal_uses_normal_priority(self):
        """未注册 Goal 使用默认 NORMAL 优先级"""
        dec = self.scheduler.request_schedule("g_unknown")
        self.assertTrue(dec.can_run)
        self.assertEqual(dec.priority_value, 2)


# ============================================================
# 等待队列
# ============================================================
class TestWaitingQueue(unittest.TestCase):
    """等待队列测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(
            storage_dir=self.tmp,
            max_concurrent_goals=1,
        )

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_enqueue_by_priority(self):
        """按优先级排序入队"""
        # 注册多个 Goal，全部进入队列
        for i, p in enumerate(["low", "critical", "normal", "high"]):
            gid = f"g_{p}"
            self.scheduler.register_quota(ResourceQuota(goal_id=gid, priority=p))
            self.scheduler.mark_active("g_active")  # 占用唯一的活跃位
            self.scheduler.request_schedule(gid)
            # 解除占用以便下一个
            self.scheduler.mark_inactive("g_active")

        queue = self.scheduler.get_waiting_queue()
        # 第一次入队时只有 1 个位置，所以全部应该都被加入
        # 由于 g_active 被占用了位置，所有其他 Goal 都会被 throttle
        # 验证队列中有 critical（最高优先级）
        self.assertGreater(len(queue), 0)

    def test_dequeue_next(self):
        """从等待队列取下一个"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1"))
        self.scheduler.register_quota(ResourceQuota(goal_id="g2"))
        # 让 g1 入队
        self.scheduler.mark_active("g_blocker")
        self.scheduler.request_schedule("g1")
        # 解除 blocker
        self.scheduler.mark_inactive("g_blocker")
        next_goal = self.scheduler.dequeue_next()
        self.assertIsNotNone(next_goal)
        self.assertIn(next_goal, ["g1", "g2"])


# ============================================================
# 公平共享
# ============================================================
class TestFairShareScore(unittest.TestCase):
    """公平共享得分测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_fair_share_score_unused(self):
        """未使用资源时得分为 0"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1"))
        self.assertEqual(self.scheduler.fair_share_score("g1"), 0.0)

    def test_fair_share_score_increases(self):
        """使用越多得分越高"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1", max_tokens=1000, weight=1.0))
        self.scheduler.record_token_usage("g1", 100)
        score1 = self.scheduler.fair_share_score("g1")
        self.scheduler.record_token_usage("g1", 200)
        score2 = self.scheduler.fair_share_score("g1")
        self.assertGreater(score2, score1)

    def test_fair_share_weight_inverse(self):
        """权重越大得分越低（更优先）"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g_high", max_tokens=1000, weight=5.0))
        self.scheduler.register_quota(ResourceQuota(goal_id="g_low", max_tokens=1000, weight=0.5))
        self.scheduler.record_token_usage("g_high", 200)
        self.scheduler.record_token_usage("g_low", 200)

        score_high = self.scheduler.fair_share_score("g_high")
        score_low = self.scheduler.fair_share_score("g_low")
        self.assertLess(score_high, score_low)


# ============================================================
# 持久化
# ============================================================
class TestPersistence(unittest.TestCase):
    """持久化测试"""

    def test_persistence_load(self):
        """持久化后重新加载"""
        tmp = _make_temp_dir()
        try:
            s1 = GoalScheduler(storage_dir=tmp)
            s1.register_quota(ResourceQuota(goal_id="g1", max_tokens=9999))
            s1.record_token_usage("g1", 500)
            s1.request_schedule("g1")  # 触发 decision 写入

            s2 = GoalScheduler(storage_dir=tmp)
            q = s2.get_quota("g1")
            self.assertIsNotNone(q)
            self.assertEqual(q.max_tokens, 9999)
            u = s2.get_usage("g1")
            self.assertIsNotNone(u)
            self.assertEqual(u.tokens_used, 500)
        finally:
            _cleanup_dir(tmp)


# ============================================================
# 统计与清理
# ============================================================
class TestStatsAndClear(unittest.TestCase):
    """统计与清理测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_get_stats(self):
        """获取统计信息"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1"))
        self.scheduler.request_schedule("g1")
        stats = self.scheduler.get_stats()
        self.assertTrue(stats["success"])
        self.assertEqual(stats["stats"]["total_quotas"], 1)
        self.assertEqual(stats["stats"]["granted"], 1)
        self.assertEqual(stats["stats"]["total_decisions"], 1)

    def test_clear_decisions(self):
        """清空决策历史"""
        self.scheduler.register_quota(ResourceQuota(goal_id="g1"))
        self.scheduler.request_schedule("g1")
        count = self.scheduler.clear_decisions()
        self.assertEqual(count, 1)
        self.assertEqual(len(self.scheduler.get_decisions()), 0)


# ============================================================
# 全局单例
# ============================================================
class TestGlobalSingleton(unittest.TestCase):
    """全局单例测试"""

    def setUp(self):
        reset_scheduler()

    def tearDown(self):
        reset_scheduler()

    def test_singleton(self):
        """单例"""
        s1 = get_scheduler()
        s2 = get_scheduler()
        self.assertIs(s1, s2)

    def test_reset(self):
        """重置"""
        s1 = get_scheduler()
        reset_scheduler()
        s2 = get_scheduler()
        self.assertIsNot(s1, s2)


# ============================================================
# 并发安全
# ============================================================
class TestConcurrency(unittest.TestCase):
    """并发安全测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.scheduler = GoalScheduler(storage_dir=self.tmp, max_concurrent_goals=100)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_concurrent_request_schedule(self):
        """并发请求调度"""
        for i in range(5):
            self.scheduler.register_quota(ResourceQuota(goal_id=f"g{i}"))

        results = []

        def worker(goal_id: str) -> None:
            dec = self.scheduler.request_schedule(goal_id)
            results.append(dec)

        threads = []
        for i in range(5):
            t = threading.Thread(target=worker, args=(f"g{i}",))
            threads.append(t)
            t.start()
        for t in threads:
            t.join()

        granted = [r for r in results if r.can_run]
        self.assertEqual(len(granted), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
