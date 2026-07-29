"""
# ============================================================
# LLM Cost Tracker - 单元测试
# ============================================================
# 核心作用：覆盖 LLMCostTracker 全部功能
# 覆盖范围：
#   - LLMCallRecord 数据类（7 计费组件 + 总成本计算）
#   - 6 维度归因
#   - 预算设置与告警触发
#   - 按维度聚合
#   - 持久化
#   - 全局单例
#   - 并发安全
# 运行：python3 -m pytest tests/test_llm_cost_units.py -v
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

from app.core.llm_cost import (
    AlertLevel,
    CostBudget,
    CostDimension,
    LLMCallRecord,
    LLMCostTracker,
    get_tracker,
    reset_tracker,
)


# ============================================================
# 工具
# ============================================================
def _make_temp_dir() -> str:
    return tempfile.mkdtemp(prefix="llm_cost_test_")


def _cleanup_dir(path: str) -> None:
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


# ============================================================
# LLMCallRecord
# ============================================================
class TestLLMCallRecord(unittest.TestCase):
    """LLMCallRecord 数据类测试"""

    def test_default_record_id(self):
        """默认 record_id 自动生成"""
        rec = LLMCallRecord()
        self.assertTrue(rec.record_id.startswith("llm_"))
        self.assertGreater(len(rec.record_id), 10)

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        rec = LLMCallRecord(
            user_id="u1",
            project_id="p1",
            agent_id="a1",
            model="claude-3-5-sonnet",
            tokens_input_cache_miss=1000,
            tokens_output=500,
        )
        d = rec.to_dict()
        rec2 = LLMCallRecord.from_dict(d)
        self.assertEqual(rec2.user_id, "u1")
        self.assertEqual(rec2.model, "claude-3-5-sonnet")
        self.assertEqual(rec2.tokens_input_cache_miss, 1000)
        self.assertEqual(rec2.tokens_output, 500)

    def test_total_tokens(self):
        """总 token 数"""
        rec = LLMCallRecord(
            tokens_input_cache_miss=100,
            tokens_input_cache_read=50,
            tokens_input_cache_write=20,
            tokens_output=200,
            tokens_reasoning=80,
            tokens_tool=30,
            tokens_image=10,
        )
        self.assertEqual(rec.total_tokens(), 490)

    def test_total_cost_zero(self):
        """无价格时总成本为 0"""
        rec = LLMCallRecord(tokens_output=1000)
        self.assertEqual(rec.total_cost(), 0.0)

    def test_total_cost_with_pricing(self):
        """含价格时正确计算成本"""
        rec = LLMCallRecord(
            tokens_output=1000,        # 1K tokens
            cost_per_1k_output=0.015,  # $0.015 per 1K
        )
        self.assertAlmostEqual(rec.total_cost(), 0.015, places=4)

    def test_total_cost_cache_discount(self):
        """缓存读取折扣"""
        rec = LLMCallRecord(
            tokens_input_cache_read=1000,
            cost_per_1k_input=0.003,
            cost_cache_read_multiplier=0.1,  # 10% 价格
        )
        # 1000 * 0.003 * 0.1 / 1000 = 0.0003
        self.assertAlmostEqual(rec.total_cost(), 0.0003, places=5)

    def test_total_cost_cache_premium(self):
        """缓存写入溢价"""
        rec = LLMCallRecord(
            tokens_input_cache_write=1000,
            cost_per_1k_input=0.003,
            cost_cache_write_multiplier=1.25,  # 125% 价格
        )
        # 1000 * 0.003 * 1.25 / 1000 = 0.00375
        self.assertAlmostEqual(rec.total_cost(), 0.00375, places=5)

    def test_cost_breakdown(self):
        """成本分解"""
        rec = LLMCallRecord(
            tokens_input_cache_miss=1000,
            tokens_output=500,
            tokens_reasoning=200,
            cost_per_1k_input=0.003,
            cost_per_1k_output=0.015,
            cost_per_1k_reasoning=0.06,
        )
        breakdown = rec.cost_breakdown()
        self.assertAlmostEqual(breakdown["input"], 0.003, places=5)
        self.assertAlmostEqual(breakdown["output"], 0.0075, places=5)
        self.assertAlmostEqual(breakdown["reasoning"], 0.012, places=5)


# ============================================================
# CostBudget
# ============================================================
class TestCostBudget(unittest.TestCase):
    """CostBudget 数据类测试"""

    def test_default_budget_id(self):
        """默认 budget_id 自动生成"""
        b = CostBudget(dimension="user", dimension_value="u1")
        self.assertTrue(b.budget_id.startswith("bud_"))

    def test_to_from_dict(self):
        """to_dict / from_dict"""
        b = CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=50.0,
            hard_limit_usd=100.0,
        )
        d = b.to_dict()
        b2 = CostBudget.from_dict(d)
        self.assertEqual(b2.dimension, "user")
        self.assertEqual(b2.dimension_value, "u1")
        self.assertEqual(b2.soft_limit_usd, 50.0)
        self.assertEqual(b2.hard_limit_usd, 100.0)


# ============================================================
# 记录与统计
# ============================================================
class TestRecordAndStats(unittest.TestCase):
    """记录与统计测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.tracker = LLMCostTracker(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_record_call_success(self):
        """成功记录一次调用"""
        rec = LLMCallRecord(
            user_id="u1",
            model="claude-3-5-sonnet",
            tokens_output=1000,
            cost_per_1k_output=0.015,
        )
        result = self.tracker.record_call(rec)
        self.assertTrue(result["success"])
        self.assertEqual(result["record_id"], rec.record_id)
        self.assertAlmostEqual(result["total_cost_usd"], 0.015, places=4)
        self.assertEqual(result["alert_level"], AlertLevel.OK.value)

    def test_stats_updated(self):
        """统计信息更新"""
        rec = LLMCallRecord(tokens_output=1000, cost_per_1k_output=0.01)
        self.tracker.record_call(rec)
        self.assertEqual(self.tracker._stats["total_records"], 1)
        self.assertAlmostEqual(self.tracker._stats["total_cost_usd"], 0.01, places=4)

    def test_get_records_filter(self):
        """按过滤条件查询"""
        self.tracker.record_call(LLMCallRecord(user_id="u1", model="m1"))
        self.tracker.record_call(LLMCallRecord(user_id="u2", model="m2"))
        self.tracker.record_call(LLMCallRecord(user_id="u1", model="m2"))

        u1_records = self.tracker.get_records(user_id="u1")
        self.assertEqual(len(u1_records), 2)

        m2_records = self.tracker.get_records(model="m2")
        self.assertEqual(len(m2_records), 2)


# ============================================================
# 预算与告警
# ============================================================
class TestBudgetAndAlerts(unittest.TestCase):
    """预算与告警测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.tracker = LLMCostTracker(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_set_budget(self):
        """设置预算"""
        budget = CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=10.0,
            hard_limit_usd=20.0,
        )
        result = self.tracker.set_budget(budget)
        self.assertEqual(result.budget_id, budget.budget_id)

    def test_soft_limit_alert(self):
        """软上限告警"""
        self.tracker.set_budget(CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=0.005,
            hard_limit_usd=0.02,
        ))
        # 累计 $0.006（> soft）
        rec = LLMCallRecord(
            user_id="u1",
            tokens_output=1000,
            cost_per_1k_output=0.006,
        )
        result = self.tracker.record_call(rec)
        self.assertEqual(result["alert_level"], AlertLevel.WARNING.value)
        self.assertEqual(len(result["triggered_budgets"]), 1)

    def test_hard_limit_alert(self):
        """硬上限告警"""
        self.tracker.set_budget(CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=0.005,
            hard_limit_usd=0.01,
        ))
        rec = LLMCallRecord(
            user_id="u1",
            tokens_output=1000,
            cost_per_1k_output=0.015,
        )
        result = self.tracker.record_call(rec)
        self.assertEqual(result["alert_level"], AlertLevel.CRITICAL.value)

    def test_budget_other_user_not_triggered(self):
        """其他用户不触发告警"""
        self.tracker.set_budget(CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=0.001,
            hard_limit_usd=0.01,
        ))
        rec = LLMCallRecord(
            user_id="u2",  # 不同用户
            tokens_output=1000,
            cost_per_1k_output=0.015,
        )
        result = self.tracker.record_call(rec)
        self.assertEqual(result["alert_level"], AlertLevel.OK.value)

    def test_disabled_budget(self):
        """禁用的预算不触发告警"""
        budget = CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=0.001,
            hard_limit_usd=0.01,
            enabled=False,
        )
        self.tracker.set_budget(budget)
        rec = LLMCallRecord(
            user_id="u1",
            tokens_output=1000,
            cost_per_1k_output=0.015,
        )
        result = self.tracker.record_call(rec)
        self.assertEqual(result["alert_level"], AlertLevel.OK.value)

    def test_list_get_delete_budget(self):
        """列表/获取/删除预算"""
        b = CostBudget(dimension="user", dimension_value="u1")
        self.tracker.set_budget(b)
        self.assertEqual(len(self.tracker.list_budgets()), 1)
        self.assertIsNotNone(self.tracker.get_budget(b.budget_id))
        self.assertTrue(self.tracker.delete_budget(b.budget_id))
        self.assertEqual(len(self.tracker.list_budgets()), 0)

    def test_alerts_history(self):
        """告警历史"""
        self.tracker.set_budget(CostBudget(
            dimension="user",
            dimension_value="u1",
            soft_limit_usd=0.001,
            hard_limit_usd=0.01,
        ))
        self.tracker.record_call(LLMCallRecord(
            user_id="u1",
            tokens_output=1000,
            cost_per_1k_output=0.015,
        ))
        alerts = self.tracker.get_alerts()
        self.assertGreaterEqual(len(alerts), 1)


# ============================================================
# 聚合
# ============================================================
class TestAggregation(unittest.TestCase):
    """聚合查询测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.tracker = LLMCostTracker(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_aggregate_by_user(self):
        """按用户聚合"""
        self.tracker.record_call(LLMCallRecord(
            user_id="u1",
            tokens_output=1000,
            cost_per_1k_output=0.01,
        ))
        self.tracker.record_call(LLMCallRecord(
            user_id="u1",
            tokens_output=500,
            cost_per_1k_output=0.01,
        ))
        self.tracker.record_call(LLMCallRecord(
            user_id="u2",
            tokens_output=200,
            cost_per_1k_output=0.01,
        ))

        result = self.tracker.aggregate(CostDimension.USER.value)
        self.assertEqual(len(result), 2)
        # 降序：u1 应在前
        self.assertEqual(result[0]["dimension_value"], "u1")
        self.assertAlmostEqual(result[0]["total_cost"], 0.015, places=4)
        self.assertEqual(result[0]["call_count"], 2)
        self.assertEqual(result[1]["dimension_value"], "u2")

    def test_aggregate_by_model(self):
        """按模型聚合"""
        self.tracker.record_call(LLMCallRecord(model="claude", tokens_output=1000, cost_per_1k_output=0.01))
        self.tracker.record_call(LLMCallRecord(model="gpt", tokens_output=500, cost_per_1k_output=0.02))

        result = self.tracker.aggregate(CostDimension.MODEL.value)
        self.assertEqual(len(result), 2)

    def test_get_summary(self):
        """获取总览"""
        self.tracker.record_call(LLMCallRecord(
            user_id="u1",
            model="claude",
            tokens_output=1000,
            cost_per_1k_output=0.01,
        ))
        summary = self.tracker.get_summary()
        self.assertTrue(summary["success"])
        self.assertIn("top_models", summary["summary"])
        self.assertIn("top_users", summary["summary"])


# ============================================================
# 持久化
# ============================================================
class TestPersistence(unittest.TestCase):
    """持久化测试"""

    def test_persistence_load(self):
        """持久化后重新加载"""
        tmp = _make_temp_dir()
        try:
            t1 = LLMCostTracker(storage_dir=tmp)
            t1.record_call(LLMCallRecord(
                user_id="u1",
                tokens_output=1000,
                cost_per_1k_output=0.015,
            ))
            t1.set_budget(CostBudget(
                dimension="user",
                dimension_value="u1",
                soft_limit_usd=10.0,
                hard_limit_usd=20.0,
            ))

            t2 = LLMCostTracker(storage_dir=tmp)
            self.assertEqual(t2._stats["total_records"], 1)
            budgets = t2.list_budgets()
            self.assertEqual(len(budgets), 1)
        finally:
            _cleanup_dir(tmp)


# ============================================================
# 清理
# ============================================================
class TestClear(unittest.TestCase):
    """清空记录测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.tracker = LLMCostTracker(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_clear_records(self):
        """清空所有记录"""
        self.tracker.record_call(LLMCallRecord(tokens_output=1000, cost_per_1k_output=0.01))
        self.tracker.record_call(LLMCallRecord(tokens_output=500, cost_per_1k_output=0.01))
        count = self.tracker.clear_records()
        self.assertEqual(count, 2)
        self.assertEqual(len(self.tracker.get_records()), 0)


# ============================================================
# 全局单例
# ============================================================
class TestGlobalSingleton(unittest.TestCase):
    """全局单例测试"""

    def setUp(self):
        reset_tracker()

    def tearDown(self):
        reset_tracker()

    def test_singleton(self):
        """单例"""
        t1 = get_tracker()
        t2 = get_tracker()
        self.assertIs(t1, t2)

    def test_reset(self):
        """重置"""
        t1 = get_tracker()
        reset_tracker()
        t2 = get_tracker()
        self.assertIsNot(t1, t2)


# ============================================================
# 并发安全
# ============================================================
class TestConcurrency(unittest.TestCase):
    """并发安全测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.tracker = LLMCostTracker(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_concurrent_record(self):
        """并发记录"""
        def worker(idx: int) -> None:
            for i in range(5):
                self.tracker.record_call(LLMCallRecord(
                    user_id=f"u{idx}",
                    tokens_output=10,
                    cost_per_1k_output=0.001,
                ))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(self.tracker._stats["total_records"], 20)


if __name__ == "__main__":
    unittest.main(verbosity=2)
