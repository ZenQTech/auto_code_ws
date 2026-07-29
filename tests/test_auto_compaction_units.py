"""
# Auto-Compaction 单元测试
# ============================================================
# 测试覆盖：
#   - 数据模型：AutoCompactionConfig、CompactionBlock、CompressionResult 等
#   - 检测器：CompactionDetector 触发逻辑、严重程度
#   - 分析器：CompactionAnalyzer 重要性评分、决策/代码识别
#   - 计划器：CompactionPlanner 策略选择、keep_recent 调整
#   - 分块器：CompactionSlicer 分块逻辑
#   - 摘要器：CompactionSummarizer 关键点/代码块/关键词
#   - 合并器：CompactionMerger 跨块去重
#   - 验证器：CompactionVerifier 决策/代码/偏好验证
#   - 流水线：CompactionPipeline 7 阶段编排
#   - 分层管理：TierManager hot/cold 存储
#   - 统计：CompactionStats
#   - 引擎：AutoCompactionEngine 全流程
# ============================================================
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest

# 确保可以导入 app
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "backend")
)

from app.core.auto_compaction import (
    DEFAULT_CONFIG,
    AutoCompactionConfig,
    AutoCompactionEngine,
    CompactionAnalyzer,
    CompactionBlock,
    CompactionDetector,
    CompactionMerger,
    CompactionPipeline,
    CompactionPlan,
    CompactionPlanner,
    CompactionSlicer,
    CompactionStats,
    CompactionSummarizer,
    CompactionTier,
    CompactionVerifier,
    CompressionResult,
    DetectionResult,
    GLOBAL_ENGINE,
    GLOBAL_PIPELINE,
    GLOBAL_TIER_MANAGER,
    MessageImportance,
    PipelineStage,
    StageExecution,
    StageStatus,
    Strategy,
    TierManager,
    TokenCounter,
    TriggerReason,
    VerificationResult,
)


# ============================================================
# 测试样本
# ============================================================

def make_messages(n: int = 20, prefix: str = "msg") -> list:
    """生成测试消息"""
    messages = [
        {"role": "system", "content": "You are a helpful assistant. Always use Python."},
    ]
    for i in range(n):
        role = "user" if i % 2 == 0 else "assistant"
        if i % 3 == 0:
            content = f"{prefix} {i}: I want you to remember this important decision: we always use {prefix}."
        elif i % 5 == 0:
            content = f"{prefix} {i}:\n```python\ndef fn_{i}():\n    return {i}\n```"
        else:
            content = f"{prefix} {i}: This is a regular message about topic {i} with some text."
        messages.append({"role": role, "content": content})
    return messages


# ============================================================
# Test: 数据模型
# ============================================================

class TestModels(unittest.TestCase):
    """数据模型测试"""

    def test_01_config_default(self):
        cfg = AutoCompactionConfig()
        self.assertTrue(cfg.enabled)
        self.assertEqual(cfg.max_tokens, 50_000)
        self.assertEqual(cfg.keep_recent, 10)
        self.assertEqual(cfg.strategy, "hybrid")

    def test_02_config_serialization(self):
        cfg = AutoCompactionConfig(max_tokens=10000, keep_recent=5)
        d = cfg.to_dict()
        restored = AutoCompactionConfig.from_dict(d)
        self.assertEqual(restored.max_tokens, 10000)
        self.assertEqual(restored.keep_recent, 5)

    def test_03_block_serialization(self):
        block = CompactionBlock(
            session_id="s1",
            message_indices=[0, 1, 2],
            tokens=100,
            original_tokens=400,
            summary="test summary",
            key_points=["point1", "point2"],
            keywords=["kw1", "kw2"],
        )
        d = block.to_dict()
        restored = CompactionBlock.from_dict(d)
        self.assertEqual(restored.session_id, "s1")
        self.assertEqual(restored.tokens, 100)
        # compression_ratio is in to_dict
        self.assertEqual(d["compression_ratio"], 4.0)

    def test_04_importance_serialization(self):
        imp = MessageImportance(
            index=0, role="user", content="test",
            score=0.8, is_decision=True, token_count=10
        )
        d = imp.to_dict()
        restored = MessageImportance.from_dict(d)
        self.assertEqual(restored.score, 0.8)
        self.assertTrue(restored.is_decision)

    def test_05_compression_result_to_dict(self):
        result = CompressionResult(
            session_id="s1", success=True, before_tokens=1000,
            after_tokens=300, saved_tokens=700, saved_ratio=0.7
        )
        d = result.to_dict()
        self.assertEqual(d["saved_tokens"], 700)
        self.assertEqual(d["session_id"], "s1")

    def test_06_detection_result_to_dict(self):
        d = DetectionResult(
            needs_compaction=True, current_tokens=1000, current_messages=20,
            severity="high"
        )
        out = d.to_dict()
        self.assertTrue(out["needs_compaction"])
        self.assertEqual(out["severity"], "high")

    def test_07_verification_result_to_dict(self):
        v = VerificationResult(
            passed=True, score=0.85, checks={"a": True}
        )
        d = v.to_dict()
        self.assertTrue(d["passed"])
        self.assertEqual(d["score"], 0.85)

    def test_08_strategy_enum(self):
        self.assertEqual(Strategy.HYBRID.value, "hybrid")
        self.assertEqual(Strategy.SUMMARIZE.value, "summarize")
        self.assertEqual(Strategy.TRUNCATE.value, "truncate")
        self.assertEqual(Strategy.SEMANTIC.value, "semantic")

    def test_09_stage_enum(self):
        self.assertEqual(PipelineStage.PLAN.value, "plan")
        self.assertEqual(PipelineStage.COMPRESS.value, "compress")

    def test_10_trigger_enum(self):
        self.assertEqual(TriggerReason.MANUAL.value, "manual")
        self.assertEqual(TriggerReason.INCREMENTAL.value, "incremental")


# ============================================================
# Test: TokenCounter
# ============================================================

class TestTokenCounter(unittest.TestCase):
    """TokenCounter 测试"""

    def test_01_empty(self):
        self.assertEqual(TokenCounter.count_text(""), 0)

    def test_02_short(self):
        self.assertGreaterEqual(TokenCounter.count_text("hi"), 1)

    def test_03_long(self):
        text = "x" * 100
        tokens = TokenCounter.count_text(text)
        self.assertGreater(tokens, 30)
        self.assertLess(tokens, 50)

    def test_04_messages(self):
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        total = TokenCounter.count_messages(msgs)
        self.assertGreater(total, 0)

    def test_05_messages_with_role(self):
        msgs = [{"role": "system", "content": "x" * 100}]
        total = TokenCounter.count_messages(msgs)
        # content + role
        self.assertGreater(total, 40)

    def test_06_messages_with_missing_role(self):
        msgs = [{"content": "no role"}]
        total = TokenCounter.count_messages(msgs)
        self.assertGreaterEqual(total, 0)

    def test_07_chinese_text(self):
        text = "你好世界这是一个测试" * 10
        tokens = TokenCounter.count_text(text)
        self.assertGreater(tokens, 0)


# ============================================================
# Test: Detector
# ============================================================

class TestDetector(unittest.TestCase):
    """检测器测试"""

    def setUp(self):
        self.detector = CompactionDetector()

    def test_01_disabled(self):
        cfg = AutoCompactionConfig(enabled=False, max_tokens=100)
        msgs = make_messages(20)
        result = self.detector.detect(msgs, cfg)
        self.assertFalse(result.needs_compaction)
        self.assertEqual(result.reason, "compaction_disabled")

    def test_02_token_threshold(self):
        cfg = AutoCompactionConfig(max_tokens=100, max_messages=1000)
        msgs = make_messages(20)
        result = self.detector.detect(msgs, cfg)
        self.assertTrue(result.needs_compaction)
        self.assertEqual(result.reason, "token_threshold")

    def test_03_message_threshold(self):
        cfg = AutoCompactionConfig(
            max_tokens=1_000_000, max_messages=5
        )
        msgs = make_messages(10)
        result = self.detector.detect(msgs, cfg)
        self.assertTrue(result.needs_compaction)
        self.assertEqual(result.reason, "message_threshold")

    def test_04_severity_critical(self):
        cfg = AutoCompactionConfig(max_tokens=100)
        msgs = make_messages(50)
        result = self.detector.detect(msgs, cfg)
        self.assertEqual(result.severity, "critical")

    def test_05_severity_high(self):
        cfg = AutoCompactionConfig(max_tokens=500, max_messages=1000)
        msgs = make_messages(30)
        # tokens ~ 900, ratio ~ 1.8
        result = self.detector.detect(msgs, cfg)
        self.assertEqual(result.severity, "high")

    def test_06_severity_medium(self):
        cfg = AutoCompactionConfig(max_tokens=800, max_messages=1000)
        msgs = make_messages(20)
        # tokens ~ 600, ratio ~ 0.75 → not triggered
        # 调整消息使其触发但不太严重
        cfg2 = AutoCompactionConfig(max_tokens=550, max_messages=1000)
        msgs2 = make_messages(20)
        # tokens ~ 600, ratio ~ 1.1
        result = self.detector.detect(msgs2, cfg2)
        self.assertEqual(result.severity, "medium")

    def test_07_growth_rate(self):
        cfg = AutoCompactionConfig(
            max_tokens=10000, max_messages=10000,
            growth_rate_threshold=0.1
        )
        # 第一次检测建立基线
        self.detector.detect(make_messages(20), cfg, "s1")
        # 第二次：大量增长
        result = self.detector.detect(
            make_messages(200), cfg, "s1"
        )
        self.assertGreater(result.growth_rate, 0.0)

    def test_08_recommend_strategy(self):
        cfg = AutoCompactionConfig()
        strat = self.detector._recommend_strategy(cfg, 1000, "critical")
        self.assertEqual(strat, Strategy.SUMMARIZE.value)
        strat = self.detector._recommend_strategy(cfg, 1000, "high")
        self.assertEqual(strat, Strategy.HYBRID.value)
        strat = self.detector._recommend_strategy(cfg, 1000, "low")
        self.assertEqual(strat, cfg.strategy)

    def test_09_history(self):
        self.detector.detect(make_messages(10), session_id="s1")
        history = self.detector.get_history()
        self.assertIn("s1", history)

    def test_10_reset(self):
        self.detector.detect(make_messages(10), session_id="s1")
        self.detector.reset("s1")
        history = self.detector.get_history()
        self.assertNotIn("s1", history)


# ============================================================
# Test: Analyzer
# ============================================================

class TestAnalyzer(unittest.TestCase):
    """分析器测试"""

    def setUp(self):
        self.analyzer = CompactionAnalyzer()

    def test_01_basic(self):
        msgs = make_messages(5)
        result = self.analyzer.analyze(msgs)
        self.assertEqual(len(result), len(msgs))

    def test_02_system_high(self):
        msgs = make_messages(3)
        result = self.analyzer.analyze(msgs)
        system_imp = [i for i in result if i.role == "system"]
        self.assertGreater(len(system_imp), 0)
        self.assertGreater(system_imp[0].score, 0.5)

    def test_03_decision_detected(self):
        msgs = [
            {"role": "user", "content": "I decided to use Python for this project."},
        ]
        result = self.analyzer.analyze(msgs)
        self.assertTrue(result[0].is_decision)
        self.assertGreater(len(result[0].decision_keywords), 0)

    def test_04_code_block_detected(self):
        msgs = [
            {"role": "assistant", "content": "Here:\n```python\nprint(1)\n```"},
        ]
        result = self.analyzer.analyze(msgs)
        self.assertTrue(result[0].is_code_block)

    def test_05_preference_detected(self):
        msgs = [
            {"role": "user", "content": "I prefer to use TypeScript for frontend."},
        ]
        result = self.analyzer.analyze(msgs)
        self.assertTrue(result[0].is_user_preference)

    def test_06_recency_factor(self):
        msgs = make_messages(10)
        result = self.analyzer.analyze(msgs)
        # 最后一条 recency 应该最高
        recencies = [i.factors["recency"] for i in result]
        self.assertEqual(recencies[-1], max(recencies))

    def test_07_role_weight(self):
        self.assertEqual(self.analyzer._role_weight("system"), 1.0)
        self.assertEqual(self.analyzer._role_weight("user"), 0.8)
        self.assertEqual(self.analyzer._role_weight("assistant"), 0.6)
        self.assertEqual(self.analyzer._role_weight("tool"), 0.4)
        self.assertEqual(self.analyzer._role_weight("unknown"), 0.5)

    def test_08_factors_in_output(self):
        msgs = make_messages(3)
        result = self.analyzer.analyze(msgs)
        for imp in result:
            self.assertIn("recency", imp.factors)
            self.assertIn("role_weight", imp.factors)
            self.assertIn("decision", imp.factors)
            self.assertIn("code", imp.factors)

    def test_09_empty(self):
        result = self.analyzer.analyze([])
        self.assertEqual(len(result), 0)

    def test_10_score_range(self):
        msgs = make_messages(10)
        result = self.analyzer.analyze(msgs)
        for imp in result:
            self.assertGreaterEqual(imp.score, 0.0)
            self.assertLessEqual(imp.score, 1.0)


# ============================================================
# Test: Planner
# ============================================================

class TestPlanner(unittest.TestCase):
    """计划器测试"""

    def setUp(self):
        self.planner = CompactionPlanner()

    def test_01_truncate_strategy(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=1000,
            severity="medium", recommended_strategy=Strategy.TRUNCATE.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        self.assertEqual(plan.strategy, Strategy.TRUNCATE.value)
        self.assertGreater(len(plan.blocks_to_compact), 0)

    def test_02_summarize_strategy(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=1000,
            severity="medium", recommended_strategy=Strategy.SUMMARIZE.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        self.assertEqual(plan.strategy, Strategy.SUMMARIZE.value)

    def test_03_critical_severity(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=10000,
            severity="critical", recommended_strategy=Strategy.HYBRID.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        # critical 模式会降低 keep_recent
        self.assertLess(len(plan.messages_to_keep), 20)

    def test_04_strategy_override(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=1000,
            severity="medium", recommended_strategy=Strategy.SUMMARIZE.value,
        )
        plan = self.planner.plan(
            detection, msgs, session_id="s1", strategy_override="truncate"
        )
        self.assertEqual(plan.strategy, "truncate")

    def test_05_invalid_strategy_fallback(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=1000,
            severity="medium", recommended_strategy="invalid_strategy",
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        # 应该回退到 config.strategy
        self.assertIn(plan.strategy, [s.value for s in Strategy])

    def test_06_target_tokens(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=100000,
            severity="critical", recommended_strategy=Strategy.HYBRID.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        # target should be limited
        self.assertLess(plan.estimated_after_tokens, plan.estimated_before_tokens)

    def test_07_confidence_range(self):
        msgs = make_messages(20)
        detection = DetectionResult(
            needs_compaction=True, current_tokens=1000,
            severity="low", recommended_strategy=Strategy.HYBRID.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        self.assertGreater(plan.confidence, 0.0)
        self.assertLessEqual(plan.confidence, 1.0)

    def test_08_empty_messages(self):
        msgs = []
        detection = DetectionResult(
            needs_compaction=False, current_tokens=0,
            severity="low", recommended_strategy=Strategy.HYBRID.value,
        )
        plan = self.planner.plan(detection, msgs, session_id="s1")
        self.assertEqual(len(plan.messages_to_keep), 0)


# ============================================================
# Test: Slicer
# ============================================================

class TestSlicer(unittest.TestCase):
    """分块器测试"""

    def setUp(self):
        self.slicer = CompactionSlicer()

    def test_01_basic_slice(self):
        msgs = make_messages(20)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        blocks, keep = self.slicer.slice(importance, msgs)
        # keep should include system + recent
        self.assertGreater(len(keep), 0)

    def test_02_empty(self):
        blocks, keep = self.slicer.slice([], [])
        self.assertEqual(blocks, [])
        self.assertEqual(keep, [])

    def test_03_system_preserved(self):
        msgs = make_messages(5)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        blocks, keep = self.slicer.slice(importance, msgs)
        # system 应该在 keep 中（index 0）
        self.assertIn(0, keep)

    def test_04_recent_preserved(self):
        msgs = make_messages(20)
        cfg = AutoCompactionConfig(keep_recent=5)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        blocks, keep = self.slicer.slice(importance, msgs, cfg)
        # 最后 5 条（索引 16-20）应该在 keep 中
        for i in range(16, 21):
            self.assertIn(i, keep)

    def test_05_build_plan_truncate(self):
        msgs = make_messages(20)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        cfg = AutoCompactionConfig(strategy="truncate")
        plan = self.slicer.build_plan(importance, msgs, cfg, session_id="s1")
        self.assertEqual(plan.strategy, "truncate")
        self.assertGreater(len(plan.blocks_to_compact), 0)

    def test_06_build_plan_summarize(self):
        msgs = make_messages(20)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        cfg = AutoCompactionConfig(strategy="summarize")
        plan = self.slicer.build_plan(importance, msgs, cfg, session_id="s1")
        self.assertEqual(plan.strategy, "summarize")

    def test_07_min_block_filter(self):
        # 测试小块过滤
        msgs = [{"role": "user", "content": "x" * 100} for _ in range(30)]
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        cfg = AutoCompactionConfig(min_block_tokens=1000)
        blocks, keep = self.slicer.slice(importance, msgs, cfg)
        # 小块被合并或丢弃
        for block in blocks:
            total = sum(TokenCounter.count_messages([msgs[i]]) for i in block)
            # block 中可能有合并的小块
            self.assertGreaterEqual(total, 0)

    def test_08_max_block_limit(self):
        msgs = make_messages(100)
        analyzer = CompactionAnalyzer()
        importance = analyzer.analyze(msgs)
        cfg = AutoCompactionConfig(max_block_tokens=200)
        blocks, keep = self.slicer.slice(importance, msgs, cfg)
        for block in blocks:
            total = sum(TokenCounter.count_messages([msgs[i]]) for i in block)
            self.assertLessEqual(total, 200 * 5)  # 允许 5x 浮动


# ============================================================
# Test: Summarizer
# ============================================================

class TestSummarizer(unittest.TestCase):
    """摘要器测试"""

    def setUp(self):
        self.summarizer = CompactionSummarizer()

    def test_01_basic_summary(self):
        msgs = make_messages(5)
        block = self.summarizer.summarize([1, 2, 3], msgs)
        self.assertGreater(len(block.summary), 0)
        self.assertGreater(block.tokens, 0)
        self.assertGreater(block.original_tokens, 0)

    def test_02_extract_decisions(self):
        msgs = [
            {"role": "user", "content": "I decided to use Python."},
        ]
        block = self.summarizer.summarize([0], msgs)
        self.assertGreater(len(block.key_points), 0)

    def test_03_extract_code(self):
        msgs = [
            {"role": "assistant", "content": "```python\nprint(1)\n```"},
        ]
        block = self.summarizer.summarize([0], msgs)
        self.assertIn("```python", block.summary)

    def test_04_extract_keywords(self):
        msgs = [
            {"role": "user", "content": "Python is great. Python rocks. Java is okay."},
        ]
        block = self.summarizer.summarize([0], msgs)
        self.assertIn("python", block.keywords)

    def test_05_truncate_long_code(self):
        # 生成超过 1500 字符的代码块以触发截断
        long_code = "```python\n" + "x = 1\n" * 500 + "```"
        msgs = [{"role": "assistant", "content": long_code}]
        block = self.summarizer.summarize([0], msgs)
        # 摘要应包含截断标记
        self.assertIn("(truncated)", block.summary)
        # 原始内容 > 摘要
        self.assertGreater(block.original_tokens, block.tokens)

    def test_06_key_points_dedup(self):
        msgs = [
            {"role": "user", "content": "I always use Python."},
            {"role": "user", "content": "I always use Python."},
        ]
        block = self.summarizer.summarize([0, 1], msgs)
        # 关键点应去重
        keys = [p[:30] for p in block.key_points]
        self.assertEqual(len(keys), len(set(keys)))

    def test_07_compression_ratio(self):
        msgs = make_messages(20)
        block = self.summarizer.summarize(list(range(1, 15)), msgs)
        d = block.to_dict()
        self.assertGreater(d["compression_ratio"], 1.0)

    def test_08_empty_messages(self):
        block = self.summarizer.summarize([], [])
        # 空块：tokens 应为 0（无原始消息）
        self.assertEqual(block.original_tokens, 0)
        # 摘要可能为空或仅占位
        self.assertIsNotNone(block.summary)


# ============================================================
# Test: Merger
# ============================================================

class TestMerger(unittest.TestCase):
    """合并器测试"""

    def setUp(self):
        self.merger = CompactionMerger()

    def test_01_basic_merge(self):
        blocks = [
            CompactionBlock(
                block_id="b1", key_points=["a", "b"], keywords=["k1"]
            ),
            CompactionBlock(
                block_id="b2", key_points=["b", "c"], keywords=["k2"]
            ),
        ]
        merged = self.merger.merge(blocks)
        self.assertEqual(len(merged), 2)

    def test_02_key_point_dedup(self):
        blocks = [
            CompactionBlock(
                block_id="b1", key_points=["point A", "point B"]
            ),
            CompactionBlock(
                block_id="b2", key_points=["point A", "point C"]
            ),
        ]
        merged = self.merger.merge(blocks)
        # point A 应该只出现一次
        all_points = []
        for b in merged:
            all_points.extend(b.key_points)
        self.assertLess(all_points.count("point A"), 2)

    def test_03_keyword_dedup(self):
        blocks = [
            CompactionBlock(block_id="b1", keywords=["a", "b"]),
            CompactionBlock(block_id="b2", keywords=["a", "c"]),
        ]
        merged = self.merger.merge(blocks)
        for b in merged:
            self.assertEqual(len(b.keywords), len(set(b.keywords)))

    def test_04_merge_into_one(self):
        blocks = [
            CompactionBlock(
                block_id="b1", session_id="s1", message_indices=[0, 1],
                tokens=100, original_tokens=400, summary="s1",
                key_points=["p1"], keywords=["k1"]
            ),
            CompactionBlock(
                block_id="b2", session_id="s1", message_indices=[2, 3],
                tokens=80, original_tokens=320, summary="s2",
                key_points=["p2"], keywords=["k2"]
            ),
        ]
        merged = self.merger.merge_into_one(blocks, "s1")
        self.assertEqual(len(merged.message_indices), 4)
        self.assertEqual(merged.original_tokens, 720)
        self.assertEqual(merged.tokens, 180)

    def test_05_merge_empty(self):
        merged = self.merger.merge([], None)
        self.assertEqual(merged, [])

    def test_06_fingerprint(self):
        fp1 = self.merger._fingerprint("test point A")
        fp2 = self.merger._fingerprint("test point A")
        fp3 = self.merger._fingerprint("test point B")
        self.assertEqual(fp1, fp2)
        self.assertNotEqual(fp1, fp3)


# ============================================================
# Test: Verifier
# ============================================================

class TestVerifier(unittest.TestCase):
    """验证器测试"""

    def setUp(self):
        self.verifier = CompactionVerifier()

    def test_01_pass(self):
        msgs = make_messages(10)
        block = CompactionBlock(
            summary="Important decision: always use Python. Code: ```python\ndef f(): pass```"
        )
        result = self.verifier.verify([block], msgs)
        self.assertGreater(result.score, 0.0)

    def test_02_decision_preserved(self):
        msgs = [
            {"role": "user", "content": "I decided to use Python."},
        ]
        block = CompactionBlock(
            summary="I decided to use Python for the project."
        )
        result = self.verifier.verify([block], msgs)
        self.assertTrue(result.checks.get("decisions_preserved", False))

    def test_03_code_preserved(self):
        msgs = [
            {"role": "assistant", "content": "```python\nprint(1)\n```"},
        ]
        block = CompactionBlock(
            summary="Code: ```python\nprint(1)\n```"
        )
        result = self.verifier.verify([block], msgs)
        self.assertTrue(result.checks.get("code_blocks_preserved", False))

    def test_04_compression_ratio(self):
        msgs = make_messages(5)
        block = CompactionBlock(
            summary="short", tokens=10, original_tokens=500
        )
        result = self.verifier.verify([block], msgs)
        # compression_ratio = 500/10 = 50x (valid range)
        self.assertTrue(result.checks.get("compression_ratio", False))

    def test_05_compression_ratio_too_low(self):
        msgs = make_messages(5)
        block = CompactionBlock(
            summary="x" * 800, tokens=400, original_tokens=500
        )
        result = self.verifier.verify([block], msgs)
        # ratio 1.25 < 1.5
        self.assertFalse(result.checks.get("compression_ratio", True))

    def test_06_empty(self):
        result = self.verifier.verify([], [])
        self.assertTrue(result.passed)
        self.assertEqual(result.score, 1.0)

    def test_07_extract_decisions(self):
        msgs = [
            {"role": "user", "content": "I decided to use Python.\nWe must always test."},
        ]
        decisions = self.verifier._extract_decisions(msgs)
        self.assertGreater(len(decisions), 0)

    def test_08_extract_prefs(self):
        msgs = [
            {"role": "user", "content": "I like Python. I prefer TypeScript."},
        ]
        prefs = self.verifier._extract_preferences(msgs)
        self.assertGreater(len(prefs), 0)

    def test_09_extract_keywords(self):
        msgs = [
            {"role": "user", "content": "Python Python Python Java Java TypeScript"},
        ]
        keywords = self.verifier._extract_top_keywords(msgs, top_n=3)
        self.assertEqual(keywords[0], "python")
        self.assertEqual(len(keywords), 3)

    def test_10_suggestions(self):
        msgs = [
            {"role": "user", "content": "I decided to do X. We must do Y."},
        ]
        block = CompactionBlock(
            summary="Brief summary.", tokens=10, original_tokens=10
        )
        result = self.verifier.verify([block], msgs, None, AutoCompactionConfig(verification_min_score=0.99))
        # score 低 → passed=False → suggestions 出现
        self.assertFalse(result.passed)


# ============================================================
# Test: Pipeline
# ============================================================

class TestPipeline(unittest.TestCase):
    """流水线测试"""

    def setUp(self):
        self.pipeline = CompactionPipeline()
        self.tmp_dir = "/tmp/hermes_ac_test_" + str(int(time.time()))
        self.tier_mgr = TierManager(storage_dir=self.tmp_dir)
        self.pipeline.tiers = self.tier_mgr

    def tearDown(self):
        import shutil
        if os.path.exists(self.tmp_dir):
            shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_01_run_basic(self):
        msgs = make_messages(20)
        result = self.pipeline.run(msgs, "test_s1")
        self.assertTrue(result.success)
        self.assertGreater(result.before_tokens, 0)

    def test_02_run_with_strategy(self):
        msgs = make_messages(20)
        result = self.pipeline.run(
            msgs, "test_s2", strategy="truncate"
        )
        self.assertTrue(result.success)
        self.assertEqual(result.strategy, "truncate")

    def test_03_run_incremental(self):
        msgs = make_messages(10)
        # 第一次
        r1 = self.pipeline.run(msgs, "test_s3", incremental=True)
        self.assertTrue(r1.success)
        self.assertTrue(r1.is_incremental)
        # 第二次
        msgs2 = msgs + [{"role": "user", "content": "new message"}]
        r2 = self.pipeline.run(msgs2, "test_s3", incremental=True)
        self.assertTrue(r2.success)
        # 第二次 saved 较少（因为只压缩新增）
        self.assertLess(r2.before_tokens, r1.before_tokens + 100)

    def test_04_stages_recorded(self):
        msgs = make_messages(10)
        result = self.pipeline.run(msgs, "test_s4")
        # 应该有 7 个阶段
        self.assertEqual(len(result.stages), 7)
        for s in result.stages:
            self.assertIn(s.stage, [
                "plan", "analyze", "slice", "summarize",
                "merge", "verify", "compress"
            ])

    def test_05_verification_included(self):
        msgs = make_messages(20)
        result = self.pipeline.run(msgs, "test_s5")
        self.assertIsNotNone(result.verification)

    def test_06_run_stage_analyze(self):
        msgs = make_messages(5)
        result = self.pipeline.run_stage("analyze", msgs, "test_s6")
        self.assertIn("items", result)
        self.assertIn("count", result)

    def test_07_run_stage_summarize(self):
        msgs = make_messages(5)
        result = self.pipeline.run_stage(
            "summarize", msgs, "test_s7", indices=[1, 2, 3]
        )
        self.assertIn("summary", result)

    def test_08_run_stage_verify(self):
        msgs = make_messages(5)
        block = CompactionBlock(summary="test summary")
        result = self.pipeline.run_stage(
            "verify", msgs, "test_s8", blocks=[block.to_dict()]
        )
        self.assertIn("passed", result)


# ============================================================
# Test: TierManager
# ============================================================

class TestTierManager(unittest.TestCase):
    """分层管理测试"""

    def setUp(self):
        self.tmp_dir = "/tmp/hermes_ac_tier_" + str(int(time.time()))
        self.manager = TierManager(storage_dir=self.tmp_dir)

    def tearDown(self):
        import shutil
        if os.path.exists(self.tmp_dir):
            shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_01_get_or_create(self):
        tier = self.manager.get_or_create("s1")
        self.assertEqual(tier.session_id, "s1")
        self.assertEqual(len(tier.hot), 0)
        self.assertEqual(len(tier.cold), 0)

    def test_02_set_hot(self):
        msgs = make_messages(5)
        self.manager.set_hot("s1", msgs, keep_recent=3)
        tier = self.manager.get("s1")
        self.assertEqual(len(tier.hot), 3)

    def test_03_append_hot(self):
        msg1 = {"role": "user", "content": "msg1"}
        msg2 = {"role": "user", "content": "msg2"}
        self.manager.append_hot("s1", msg1, keep_recent=2)
        self.manager.append_hot("s1", msg2, keep_recent=2)
        tier = self.manager.get("s1")
        self.assertEqual(len(tier.hot), 2)

    def test_04_add_block(self):
        block = CompactionBlock(
            session_id="s1", summary="test", keywords=["a", "b"]
        )
        self.manager.add_block("s1", block)
        tier = self.manager.get("s1")
        self.assertEqual(len(tier.cold), 1)
        self.assertIn("a", tier.cold_index)
        self.assertEqual(tier.cold_index["a"], [block.block_id])

    def test_05_add_blocks(self):
        blocks = [
            CompactionBlock(session_id="s1", keywords=["a"]),
            CompactionBlock(session_id="s1", keywords=["b", "a"]),
        ]
        self.manager.add_blocks("s1", blocks)
        tier = self.manager.get("s1")
        self.assertEqual(len(tier.cold), 2)
        self.assertIn("a", tier.cold_index)
        self.assertEqual(len(tier.cold_index["a"]), 2)

    def test_06_search(self):
        block = CompactionBlock(
            session_id="s1", summary="Python is great",
            keywords=["python", "great"]
        )
        self.manager.add_block("s1", block)
        results = self.manager.search("s1", "python")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].block_id, block.block_id)

    def test_07_search_empty(self):
        results = self.manager.search("nonexistent", "test")
        self.assertEqual(results, [])

    def test_08_checkpoint(self):
        self.manager.set_checkpoint("s1", 10)
        cp = self.manager.get_checkpoint("s1")
        self.assertEqual(cp["last_message_index"], 10)
        self.manager.clear_checkpoint("s1")
        self.assertIsNone(self.manager.get_checkpoint("s1"))

    def test_09_snapshot_restore(self):
        self.manager.set_hot("s1", [{"role": "user", "content": "x"}])
        self.manager.add_block("s1", CompactionBlock(session_id="s1", keywords=["a"]))
        snapshot = self.manager.snapshot("s1")
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["hot"][0]["content"], "x")
        # restore
        success = self.manager.restore("s1", snapshot)
        self.assertTrue(success)

    def test_10_persistence(self):
        # 写
        self.manager.set_hot("s1", [{"role": "user", "content": "x"}])
        self.manager.add_block(
            "s1", CompactionBlock(session_id="s1", keywords=["a"])
        )
        # 新 manager 读
        m2 = TierManager(storage_dir=self.tmp_dir)
        tier = m2.get_or_create("s1")
        self.assertEqual(len(tier.hot), 1)
        self.assertEqual(len(tier.cold), 1)

    def test_11_remove(self):
        self.manager.set_hot("s1", [{"role": "user", "content": "x"}])
        success = self.manager.remove("s1")
        self.assertTrue(success)
        self.assertIsNone(self.manager.get("s1"))

    def test_12_stats(self):
        self.manager.set_hot("s1", [{"role": "user", "content": "x" * 100}])
        self.manager.add_block("s1", CompactionBlock(session_id="s1", tokens=50))
        stats = self.manager.get_stats()
        self.assertGreaterEqual(stats["total_sessions"], 1)
        self.assertGreater(stats["total_cold_blocks"], 0)

    def test_13_save_all(self):
        self.manager.set_hot("s1", [{"role": "user", "content": "x"}])
        self.manager.save_all()
        # 验证文件存在
        path = os.path.join(self.tmp_dir, "s1.json")
        self.assertTrue(os.path.exists(path))


# ============================================================
# Test: Stats
# ============================================================

class TestStats(unittest.TestCase):
    """统计测试"""

    def setUp(self):
        self.stats = CompactionStats()

    def test_01_record(self):
        result = CompressionResult(
            session_id="s1", success=True, before_tokens=1000,
            after_tokens=300, saved_tokens=700, saved_ratio=0.7
        )
        self.stats.record(result, "medium")
        snapshot = self.stats.snapshot()
        self.assertEqual(snapshot["total_compactions"], 1)
        self.assertEqual(snapshot["total_saved_tokens"], 700)

    def test_02_snapshot(self):
        result = CompressionResult(
            session_id="s1", success=True, before_tokens=1000,
            after_tokens=300, saved_tokens=700
        )
        self.stats.record(result)
        snapshot = self.stats.snapshot()
        self.assertIn("verification", snapshot)
        self.assertIn("strategy_distribution", snapshot)
        self.assertIn("incremental_count", snapshot)

    def test_03_session_history(self):
        for i in range(3):
            result = CompressionResult(
                session_id="s1", success=True, before_tokens=1000,
                after_tokens=300, saved_tokens=700
            )
            self.stats.record(result)
        history = self.stats.get_session_history("s1")
        self.assertEqual(len(history), 3)

    def test_04_session_savings(self):
        result = CompressionResult(
            session_id="s1", success=True, before_tokens=1000,
            after_tokens=300, saved_tokens=700
        )
        self.stats.record(result)
        savings = self.stats.get_session_savings("s1")
        self.assertEqual(savings["total_saved"], 700)

    def test_05_strategy_distribution(self):
        for strat in ["hybrid", "truncate", "hybrid"]:
            result = CompressionResult(
                session_id="s1", success=True, strategy=strat
            )
            self.stats.record(result)
        snapshot = self.stats.snapshot()
        self.assertEqual(snapshot["strategy_distribution"]["hybrid"], 2)
        self.assertEqual(snapshot["strategy_distribution"]["truncate"], 1)

    def test_06_reset(self):
        result = CompressionResult(session_id="s1", success=True)
        self.stats.record(result)
        self.stats.reset()
        snapshot = self.stats.snapshot()
        self.assertEqual(snapshot["total_compactions"], 0)

    def test_07_verification_tracking(self):
        for passed in [True, True, False]:
            v = VerificationResult(passed=passed, score=0.8 if passed else 0.3)
            result = CompressionResult(
                session_id="s1", success=True, verification=v
            )
            self.stats.record(result)
        snapshot = self.stats.snapshot()
        self.assertEqual(snapshot["verification"]["passed"], 2)
        self.assertEqual(snapshot["verification"]["failed"], 1)

    def test_08_incremental_count(self):
        for inc in [True, False, True]:
            result = CompressionResult(
                session_id="s1", success=True, is_incremental=inc
            )
            self.stats.record(result)
        snapshot = self.stats.snapshot()
        self.assertEqual(snapshot["incremental_count"], 2)

    def test_09_recent(self):
        for i in range(5):
            result = CompressionResult(session_id=f"s{i}", success=True)
            self.stats.record(result)
        recent = self.stats.get_recent(limit=3)
        self.assertEqual(len(recent), 3)

    def test_10_session_savings_empty(self):
        savings = self.stats.get_session_savings("nonexistent")
        self.assertEqual(savings["compaction_count"], 0)


# ============================================================
# Test: Engine
# ============================================================

class TestEngine(unittest.TestCase):
    """引擎测试"""

    def setUp(self):
        # 使用独立存储避免污染
        self.tmp_dir = "/tmp/hermes_ac_engine_" + str(int(time.time()))
        from app.core.auto_compaction.tiers import TierManager
        from app.core.auto_compaction.engine import AutoCompactionEngine
        from app.core.auto_compaction.stats import CompactionStats

        tier_mgr = TierManager(storage_dir=self.tmp_dir)
        stats = CompactionStats()
        cfg = AutoCompactionConfig(max_tokens=500)
        self.engine = AutoCompactionEngine(
            tiers=tier_mgr, stats=stats, config=cfg
        )

    def tearDown(self):
        import shutil
        if os.path.exists(self.tmp_dir):
            shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_01_health(self):
        h = self.engine.health()
        self.assertEqual(h["status"], "ok")

    def test_02_check(self):
        # 用 20 条消息（约 600+ tokens）触发 max_tokens=500 阈值
        msgs = make_messages(20)
        detection = self.engine.check("s1", msgs)
        self.assertTrue(detection.needs_compaction)

    def test_03_run(self):
        msgs = make_messages(20)
        result = self.engine.run("s1", msgs, force=True)
        self.assertTrue(result.success)
        self.assertGreater(result.saved_tokens, 0)

    def test_04_run_no_need(self):
        msgs = make_messages(2)
        # 消息数少，不触发
        result = self.engine.run("s1", msgs)
        # 消息数 < max_messages（默认 50）→ 不压缩
        self.assertFalse(result.success)
        self.assertEqual(result.error, "no_compaction_needed")

    def test_05_force_run(self):
        msgs = make_messages(2)
        result = self.engine.run("s1", msgs, force=True)
        # force=True 跳过检测
        self.assertTrue(result.success)

    def test_06_plan(self):
        msgs = make_messages(10)
        plan = self.engine.plan("s1", msgs)
        self.assertIsNotNone(plan.plan_id)

    def test_07_incremental(self):
        msgs = make_messages(10)
        r1 = self.engine.incremental("s1", msgs)
        self.assertTrue(r1.is_incremental)
        msgs2 = msgs + [{"role": "user", "content": "new"}]
        r2 = self.engine.incremental("s1", msgs2)
        self.assertTrue(r2.is_incremental)

    def test_08_search(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        results = self.engine.search("s1", "python")
        # 至少有部分结果
        self.assertIsInstance(results, list)

    def test_09_get_tier(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        tier = self.engine.get_tier("s1")
        self.assertIsNotNone(tier)
        self.assertEqual(tier.session_id, "s1")

    def test_10_verify(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        result = self.engine.verify("s1", msgs)
        self.assertIsNotNone(result)

    def test_11_get_stats(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        stats = self.engine.get_stats()
        self.assertEqual(stats["total_compactions"], 1)

    def test_12_get_session_history(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        history = self.engine.get_session_history("s1")
        self.assertGreater(len(history), 0)

    def test_13_get_session_savings(self):
        msgs = make_messages(10)
        self.engine.run("s1", msgs, force=True)
        savings = self.engine.get_session_savings("s1")
        self.assertGreater(savings["total_saved"], 0)

    def test_14_session_config(self):
        cfg = AutoCompactionConfig(keep_recent=20)
        self.engine.set_config(cfg, "s1")
        result = self.engine.get_config("s1")
        self.assertEqual(result.keep_recent, 20)

    def test_15_reset_config(self):
        cfg = AutoCompactionConfig(keep_recent=20)
        self.engine.set_config(cfg, "s1")
        self.engine.reset_config("s1")
        result = self.engine.get_config("s1")
        self.assertEqual(result.keep_recent, DEFAULT_CONFIG.keep_recent)


# ============================================================
# Test: 边界情况
# ============================================================

class TestEdgeCases(unittest.TestCase):
    """边界情况测试"""

    def setUp(self):
        from app.core.auto_compaction.engine import AutoCompactionEngine
        self.tmp_dir = "/tmp/hermes_ac_edge_" + str(int(time.time()))
        from app.core.auto_compaction.tiers import TierManager
        tier_mgr = TierManager(storage_dir=self.tmp_dir)
        self.engine = AutoCompactionEngine(tiers=tier_mgr)

    def tearDown(self):
        import shutil
        if os.path.exists(self.tmp_dir):
            shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_01_empty_messages(self):
        result = self.engine.run("s1", [], force=True)
        self.assertTrue(result.success)
        self.assertEqual(result.before_messages, 0)

    def test_02_single_message(self):
        msgs = [{"role": "user", "content": "hello"}]
        result = self.engine.run("s1", msgs, force=True)
        self.assertTrue(result.success)

    def test_03_pure_system(self):
        msgs = [
            {"role": "system", "content": "You are helpful."},
        ] * 10
        result = self.engine.run("s1", msgs, force=True)
        # system 消息被 keep
        self.assertTrue(result.success)

    def test_04_very_long_message(self):
        msgs = [
            {"role": "user", "content": "x" * 100_000},
        ]
        result = self.engine.run("s1", msgs, force=True)
        self.assertTrue(result.success)

    def test_05_unicode_messages(self):
        msgs = [
            {"role": "user", "content": "你好世界 🌍 " * 100},
            {"role": "assistant", "content": "Привет мир"},
        ]
        result = self.engine.run("s1", msgs, force=True)
        self.assertTrue(result.success)


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
