"""
# ============================================================
# Judge 共识 v2 增强 - 单元测试
# ============================================================
# 核心作用：覆盖 Cycle 15 P1-3 新增的共识策略与一致性指标
# 覆盖范围：
#   - FIRST_VALID 策略（降级）
#   - 一致性指标（stddev / confidence / consensus_strength）
#   - 增强的 ConsensusEngine.aggregate
# 运行：python3 -m pytest tests/test_judge_consensus_v2_units.py -v
# ============================================================
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# 添加 backend 目录到 sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.llm_judge import (
    ConsensusEngine,
    ConsensusStrategy,
    Judge,
    JudgeReport,
    JudgeScore,
)


def _make_report(
    judge_id: str,
    correctness: int = 8,
    style: int = 8,
    safety: int = 8,
    performance: int = 8,
    maintainability: int = 8,
    overall_pass: bool = True,
    error: str = "",
) -> JudgeReport:
    """构造 JudgeReport"""
    return JudgeReport(
        task_id="t1",
        judge_id=judge_id,
        judge_name=f"Judge-{judge_id}",
        model="mock",
        scores=JudgeScore(
            correctness=correctness,
            style=style,
            safety=safety,
            performance=performance,
            maintainability=maintainability,
        ),
        overall_pass=overall_pass,
        overall_score=8.0,
        error=error,
    )


# ============================================================
# FIRST_VALID 策略
# ============================================================
class TestFirstValidStrategy(unittest.TestCase):
    """FIRST_VALID 策略测试"""

    def test_first_valid_uses_first_valid(self):
        """取第一个无 error 的报告"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", error="timeout"),     # 错误
            _make_report("j2", correctness=9),       # 第一个有效
            _make_report("j3", correctness=7),
        ]
        consensus = engine.aggregate(
            reports,
            strategy=ConsensusStrategy.FIRST_VALID.value,
            task_id="t1",
        )
        self.assertEqual(consensus.aggregated_scores.correctness, 9)
        self.assertEqual(consensus.strategy, ConsensusStrategy.FIRST_VALID.value)
        self.assertEqual(consensus.judge_count, 3)

    def test_first_valid_all_invalid(self):
        """全部错误时回退到第一个"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", error="api_error"),
            _make_report("j2", error="rate_limit"),
        ]
        consensus = engine.aggregate(
            reports,
            strategy=ConsensusStrategy.FIRST_VALID.value,
            task_id="t1",
        )
        # 全部无效 → 取第一个
        self.assertEqual(consensus.judge_count, 2)
        # 第一个 report 的 correctness
        self.assertEqual(consensus.aggregated_scores.correctness, 8)

    def test_first_valid_safety_veto(self):
        """首个有效报告中应自动跳过 safety veto"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", safety=3, overall_pass=False),  # veto → 跳过
            _make_report("j2", safety=8, overall_pass=True),   # 首个有效
        ]
        consensus = engine.aggregate(
            reports,
            strategy=ConsensusStrategy.FIRST_VALID.value,
            task_id="t1",
        )
        # 跳过了 j1 (safety veto)，使用 j2
        self.assertEqual(consensus.aggregated_scores.safety, 8)
        self.assertFalse(consensus.safety_veto)
        self.assertTrue(consensus.overall_pass)


# ============================================================
# 一致性指标
# ============================================================
class TestConsistencyMetrics(unittest.TestCase):
    """一致性指标测试"""

    def test_stddev_perfect_agreement(self):
        """完全一致时 stddev 为 0"""
        engine = ConsensusEngine()
        reports = [_make_report("j1"), _make_report("j2"), _make_report("j3")]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertIn("__stddev__", consensus.divergence)
        self.assertEqual(consensus.divergence["__stddev__"], 0.0)
        self.assertEqual(consensus.divergence["__max_stddev__"], 0.0)

    def test_stddev_high_disagreement(self):
        """分歧大时 stddev > 0"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", correctness=4),
            _make_report("j2", correctness=10),
            _make_report("j3", correctness=7),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertGreater(consensus.divergence["__stddev__"], 0.0)
        self.assertGreater(consensus.divergence["__max_stddev__"], 0.0)

    def test_stddev_by_dim(self):
        """按维度的 stddev"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", correctness=5, safety=8),
            _make_report("j2", correctness=9, safety=8),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        stddev_by_dim = consensus.divergence.get("__stddev_by_dim__", {})
        self.assertIn("correctness", stddev_by_dim)
        self.assertEqual(stddev_by_dim["correctness"], 2.0)  # |9-5|/sqrt(2)? 不对，应该 = sqrt(((5-7)^2 + (9-7)^2)/2) = sqrt(4) = 2
        self.assertEqual(stddev_by_dim["safety"], 0.0)

    def test_confidence_perfect_agreement(self):
        """完全一致时 confidence = 1.0"""
        engine = ConsensusEngine()
        reports = [_make_report("j1"), _make_report("j2")]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertEqual(consensus.divergence["__confidence__"], 1.0)

    def test_confidence_high_disagreement(self):
        """分歧大时 confidence < 1.0"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", correctness=0),
            _make_report("j2", correctness=10),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertLess(consensus.divergence["__confidence__"], 1.0)

    def test_consensus_strength_unanimous_pass(self):
        """全部 pass 时共识强度 = 1.0"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", overall_pass=True),
            _make_report("j2", overall_pass=True),
            _make_report("j3", overall_pass=True),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertEqual(consensus.divergence["__consensus_strength__"], 1.0)

    def test_consensus_strength_unanimous_fail(self):
        """全部 fail 时共识强度 = 1.0（强共识）"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", overall_pass=False),
            _make_report("j2", overall_pass=False),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertEqual(consensus.divergence["__consensus_strength__"], 1.0)

    def test_consensus_strength_split(self):
        """50/50 时共识强度 = 0.0（弱共识）"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", overall_pass=True),
            _make_report("j2", overall_pass=False),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        self.assertEqual(consensus.divergence["__consensus_strength__"], 0.0)

    def test_consensus_strength_partial(self):
        """2/3 pass 时共识强度 = 0.333"""
        engine = ConsensusEngine()
        reports = [
            _make_report("j1", overall_pass=True),
            _make_report("j2", overall_pass=True),
            _make_report("j3", overall_pass=False),
        ]
        consensus = engine.aggregate(reports, task_id="t1")
        # pass_ratio = 2/3, strength = 2 * |2/3 - 0.5| = 2 * 1/6 = 0.333
        self.assertAlmostEqual(consensus.divergence["__consensus_strength__"], 0.333, places=3)


# ============================================================
# 多策略对比
# ============================================================
class TestStrategyComparison(unittest.TestCase):
    """策略对比测试"""

    def setUp(self):
        self.engine = ConsensusEngine()

    def test_weighted_vs_majority(self):
        """加权平均 vs 多数投票"""
        reports = [
            _make_report("j1", correctness=10, overall_pass=True),
            _make_report("j2", correctness=2, overall_pass=False),
            _make_report("j3", correctness=2, overall_pass=False),
        ]
        weighted = self.engine.aggregate(
            reports,
            strategy=ConsensusStrategy.WEIGHTED_AVERAGE.value,
            task_id="t1",
        )
        majority = self.engine.aggregate(
            reports,
            strategy=ConsensusStrategy.MAJORITY_VOTE.value,
            task_id="t1",
        )
        # 加权平均：correctness ≈ (10+2+2)/3 = 4.67 → round to 5
        self.assertEqual(weighted.aggregated_scores.correctness, 5)
        # 多数投票：1 pass / 2 fail → fail
        self.assertFalse(majority.overall_pass)

    def test_strict_unanimous_requires_all_pass(self):
        """严格一致要求全部 pass"""
        reports = [
            _make_report("j1", overall_pass=True),
            _make_report("j2", overall_pass=False),
        ]
        consensus = self.engine.aggregate(
            reports,
            strategy=ConsensusStrategy.STRICT_UNANIMOUS.value,
            task_id="t1",
        )
        self.assertFalse(consensus.overall_pass)

    def test_unknown_strategy_defaults_to_weighted(self):
        """未知策略默认走加权平均"""
        reports = [_make_report("j1"), _make_report("j2")]
        consensus = self.engine.aggregate(reports, strategy="unknown_strategy", task_id="t1")
        self.assertEqual(consensus.strategy, ConsensusStrategy.WEIGHTED_AVERAGE.value)


# ============================================================
# 加权平均 + 权重
# ============================================================
class TestWeightedAverageWithJudges(unittest.TestCase):
    """加权平均（含 Judge 权重）测试"""

    def test_high_weight_judge_dominates(self):
        """高权重 Judge 主导"""
        engine = ConsensusEngine()
        judges = [
            Judge(judge_id="j1", weight=10.0),
            Judge(judge_id="j2", weight=1.0),
        ]
        reports = [
            _make_report("j1", correctness=10),
            _make_report("j2", correctness=2),
        ]
        consensus = engine.aggregate(reports, judges=judges, task_id="t1")
        # 10*10 + 2*1 / 11 = 102/11 ≈ 9.27 → round to 9
        self.assertEqual(consensus.aggregated_scores.correctness, 9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
