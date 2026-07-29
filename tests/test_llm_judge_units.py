"""
# ============================================================
# Hermes LLM-as-Judge - 单元测试
# ============================================================
# 核心作用：测试 LLM-as-Judge 验证层的核心功能
# 覆盖：
#   - 数据模型（Judge/Score/Report/Consensus/Task）
#   - Prompt 模板（构建、变量替换、JSON 提取）
#   - Adapter（Mock/Claude/GPT/Gemini/Custom）
#   - Pool（注册/查询/选择/统计）
#   - Consensus（加权平均/分歧检测/Safety 一票否决）
#   - Verifier（P1-10 集成）
#   - Store（持久化/查询/统计）
#   - Engine（完整流程）
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from app.core.llm_judge import (
    # 数据模型
    Judge,
    JudgeConsensus,
    JudgeReport,
    JudgeScore,
    JudgeTask,
    JudgeTaskStatus,
    # Prompt
    build_prompt,
    DEFAULT_JUDGE_PROMPT,
    extract_json_from_response,
    render_template,
    validate_rubric,
    DEFAULT_RUBRIC,
    # Adapter
    MockJudgeAdapter,
    ClaudeJudgeAdapter,
    GPTJudgeAdapter,
    GeminiJudgeAdapter,
    CustomJudgeAdapter,
    create_adapter,
    ADAPTER_REGISTRY,
    # Pool
    JudgePool,
    get_judge_pool,
    reset_judge_pool,
    is_pool_path_allowed,
    # Consensus
    ConsensusEngine,
    ConsensusStrategy,
    # Verifier
    LLMJudgeVerifier,
    # Store
    JudgeStore,
    get_judge_store,
    reset_judge_store,
    is_store_path_allowed,
    # Engine
    JudgeEngine,
    get_judge_engine,
    reset_judge_engine,
    # 维度常量
    DIMENSION_CORRECTNESS,
    DIMENSION_STYLE,
    DIMENSION_SAFETY,
    DIMENSION_PERFORMANCE,
    DIMENSION_MAINTAINABILITY,
    ALL_DIMENSIONS,
    # 枚举
    Difficulty,
    Domain,
    JudgeAdapterType,
)


# ============================================================
# 数据模型测试
# ============================================================
class TestJudgeScore(unittest.TestCase):
    """JudgeScore 数据模型测试"""

    def test_default_score(self):
        score = JudgeScore()
        self.assertEqual(score.correctness, 0)
        self.assertEqual(score.style, 0)
        self.assertEqual(score.safety, 0)
        self.assertEqual(score.performance, 0)
        self.assertEqual(score.maintainability, 0)

    def test_to_from_dict(self):
        score = JudgeScore(correctness=8, style=7, safety=9, performance=6, maintainability=7)
        d = score.to_dict()
        self.assertEqual(d[DIMENSION_CORRECTNESS], 8)
        self.assertEqual(d[DIMENSION_SAFETY], 9)
        score2 = JudgeScore.from_dict(d)
        self.assertEqual(score2.correctness, 8)
        self.assertEqual(score2.safety, 9)

    def test_clamp(self):
        score = JudgeScore(correctness=15, style=-5)
        self.assertEqual(score.correctness, 10)
        self.assertEqual(score.style, 0)

    def test_simple_average(self):
        score = JudgeScore(correctness=8, style=6, safety=10, performance=4, maintainability=6)
        self.assertEqual(score.simple_average(), 6.8)

    def test_weighted_average(self):
        score = JudgeScore(correctness=8, style=6, safety=10, performance=4, maintainability=6)
        weights = {DIMENSION_CORRECTNESS: 2.0, DIMENSION_SAFETY: 1.0, DIMENSION_STYLE: 0.5, DIMENSION_PERFORMANCE: 0.5, DIMENSION_MAINTAINABILITY: 0.5}
        avg = score.weighted_average(weights)
        self.assertGreater(avg, 6.0)

    def test_get(self):
        score = JudgeScore(correctness=8, style=7, safety=9, performance=6, maintainability=7)
        self.assertEqual(score.get("correctness"), 8)
        self.assertEqual(score.get("nonexistent"), 0)


class TestJudge(unittest.TestCase):
    """Judge 模型测试"""

    def test_default_judge(self):
        judge = Judge()
        self.assertNotEqual(judge.judge_id, "")
        self.assertEqual(judge.weight, 1.0)
        self.assertTrue(judge.enabled)

    def test_to_from_dict(self):
        judge = Judge(name="Test Judge", model="test-model", weight=0.8, adapter="mock")
        d = judge.to_dict()
        self.assertEqual(d["name"], "Test Judge")
        self.assertEqual(d["model"], "test-model")
        judge2 = Judge.from_dict(d)
        self.assertEqual(judge2.name, "Test Judge")
        self.assertEqual(judge2.model, "test-model")


class TestJudgeTask(unittest.TestCase):
    """JudgeTask 数据模型测试"""

    def test_default_task(self):
        task = JudgeTask(task_description="Test")
        self.assertEqual(task.status, JudgeTaskStatus.PENDING.value)
        self.assertNotEqual(task.task_id, "")

    def test_is_terminal(self):
        task = JudgeTask(task_description="Test", status=JudgeTaskStatus.COMPLETED.value)
        self.assertTrue(task.is_terminal())
        task.status = JudgeTaskStatus.PENDING.value
        self.assertFalse(task.is_terminal())

    def test_to_from_dict(self):
        task = JudgeTask(
            task_description="Test",
            code_diff="+ new line",
            difficulty=Difficulty.HARD.value,
            domain=Domain.BACKEND.value,
        )
        task.add_report(JudgeReport(task_id=task.task_id, scores=JudgeScore(correctness=8)))
        d = task.to_dict()
        task2 = JudgeTask.from_dict(d)
        self.assertEqual(task2.task_description, "Test")
        self.assertEqual(task2.code_diff, "+ new line")
        self.assertEqual(task2.difficulty, "hard")
        self.assertEqual(len(task2.reports), 1)


class TestJudgeConsensus(unittest.TestCase):
    """JudgeConsensus 数据模型测试"""

    def test_to_dict(self):
        consensus = JudgeConsensus(
            task_id="task_1",
            aggregated_scores=JudgeScore(correctness=8, style=7, safety=9, performance=6, maintainability=7),
            overall_pass=True,
            overall_score=7.4,
            divergence={DIMENSION_CORRECTNESS: 1.0, DIMENSION_SAFETY: 0.5},
            safety_veto=False,
            judge_count=3,
        )
        d = consensus.to_dict()
        self.assertEqual(d["task_id"], "task_1")
        self.assertTrue(d["overall_pass"])
        self.assertEqual(d["judge_count"], 3)


# ============================================================
# Prompt 模板测试
# ============================================================
class TestPromptTemplate(unittest.TestCase):
    """Prompt 模板测试"""

    def test_render_template_basic(self):
        template = "Hello {{name}}!"
        result = render_template(template, {"name": "World"})
        self.assertEqual(result, "Hello World!")

    def test_render_template_missing_var(self):
        template = "Hello {{name}}!"
        result = render_template(template, {})
        # 变量不存在时保留原样
        self.assertIn("{{name}}", result)

    def test_build_prompt_basic(self):
        prompt = build_prompt(
            task_description="Implement function X",
            code_diff="+ def X(): pass",
            test_results="all pass",
        )
        self.assertIn("Implement function X", prompt)
        self.assertIn("def X()", prompt)
        self.assertIn("all pass", prompt)
        self.assertIn("Correctness", prompt)
        self.assertIn("Style", prompt)
        self.assertIn("Safety", prompt)
        self.assertIn("Performance", prompt)
        self.assertIn("Maintainability", prompt)

    def test_build_prompt_with_domain(self):
        prompt = build_prompt(
            task_description="Add login",
            code_diff="",
            domain=Domain.SECURITY.value,
        )
        self.assertIn("Security Specific", prompt)

    def test_build_prompt_with_difficulty(self):
        prompt = build_prompt(
            task_description="Complex task",
            code_diff="",
            difficulty=Difficulty.HARD.value,
        )
        self.assertIn("Difficulty", prompt)
        self.assertIn("complex", prompt.lower())

    def test_build_prompt_with_custom_rubric(self):
        custom = ["Custom dim 1", "Custom dim 2"]
        prompt = build_prompt(
            task_description="Test",
            rubric=custom,
        )
        self.assertIn("Custom Rubric", prompt)
        self.assertIn("Custom dim 1", prompt)

    def test_extract_json_from_response(self):
        response = '```json\n{"scores": {"correctness": 8}}\n```'
        result = extract_json_from_response(response)
        self.assertEqual(result.get("scores", {}).get("correctness"), 8)

    def test_extract_json_from_response_no_block(self):
        response = 'Here is the JSON: {"scores": {"correctness": 7}}'
        result = extract_json_from_response(response)
        self.assertEqual(result.get("scores", {}).get("correctness"), 7)

    def test_extract_json_from_response_empty(self):
        result = extract_json_from_response("")
        self.assertEqual(result, {})

    def test_validate_rubric(self):
        self.assertTrue(validate_rubric(["item1", "item2"]))
        self.assertFalse(validate_rubric([]))
        self.assertFalse(validate_rubric([""]))
        self.assertFalse(validate_rubric(None))

    def test_default_rubric(self):
        rubric = DEFAULT_RUBRIC
        self.assertEqual(len(rubric), 5)


# ============================================================
# Adapter 测试
# ============================================================
class TestMockJudgeAdapter(unittest.TestCase):
    """MockJudgeAdapter 测试"""

    def setUp(self):
        self.judge = Judge(name="Test", model="mock-model")
        self.adapter = MockJudgeAdapter(self.judge)

    def test_basic_judge(self):
        prompt = build_prompt(
            task_description="Test task",
            code_diff="def hello():\n    return 'world'",
        )
        report = self.adapter.judge("task_1", prompt)
        self.assertEqual(report.task_id, "task_1")
        self.assertEqual(report.judge_id, self.judge.judge_id)
        self.assertGreater(report.scores.correctness, 0)
        self.assertGreater(report.overall_score, 0)

    def test_safety_detection(self):
        prompt = build_prompt(
            task_description="Test",
            code_diff="eval(user_input)",
        )
        report = self.adapter.judge("task_1", prompt)
        # eval 应该降低 safety 分数
        self.assertLess(report.scores.safety, 9)

    def test_good_practices(self):
        prompt = build_prompt(
            task_description="Test",
            code_diff="async def hello() -> str:\n    '''Docstring'''\n    return 'world'  # with comment",
        )
        report = self.adapter.judge("task_1", prompt)
        self.assertGreater(report.scores.correctness, 5)
        self.assertGreater(report.scores.maintainability, 5)

    def test_empty_diff(self):
        prompt = build_prompt(task_description="Test", code_diff="")
        report = self.adapter.judge("task_1", prompt)
        # 空 diff 给中等分数
        self.assertEqual(report.scores.correctness, 5)

    def test_test_results_passed(self):
        prompt = build_prompt(
            task_description="Test",
            code_diff="def foo(): pass",
            test_results="All tests passed",
        )
        report = self.adapter.judge("task_1", prompt)
        self.assertIn("report_id", report.to_dict().keys())


class TestCustomJudgeAdapter(unittest.TestCase):
    """CustomJudgeAdapter 测试"""

    def test_custom_function_called(self):
        def custom_fn(task_id, prompt, judge, timeout):
            return JudgeReport(
                task_id=task_id,
                judge_id=judge.judge_id,
                judge_name=judge.name,
                model=judge.model,
                scores=JudgeScore(correctness=10, style=10, safety=10, performance=10, maintainability=10),
                overall_pass=True,
                overall_score=10.0,
            )
        judge = Judge(name="Custom", model="custom-model", adapter="custom")
        adapter = CustomJudgeAdapter(judge, custom_fn=custom_fn)
        report = adapter.judge("task_1", "test prompt")
        self.assertEqual(report.scores.correctness, 10)
        self.assertTrue(report.overall_pass)

    def test_custom_function_error(self):
        def custom_fn(task_id, prompt, judge, timeout):
            raise ValueError("Custom error")
        judge = Judge(name="Custom", model="custom-model", adapter="custom")
        adapter = CustomJudgeAdapter(judge, custom_fn=custom_fn)
        report = adapter.judge("task_1", "test prompt")
        self.assertFalse(report.overall_pass)
        self.assertIn("Custom error", report.error)


class TestCreateAdapter(unittest.TestCase):
    """create_adapter 工厂测试"""

    def test_create_mock(self):
        judge = Judge(adapter="mock")
        adapter = create_adapter(judge)
        self.assertIsInstance(adapter, MockJudgeAdapter)

    def test_create_claude(self):
        judge = Judge(adapter="claude")
        adapter = create_adapter(judge)
        self.assertIsInstance(adapter, ClaudeJudgeAdapter)

    def test_create_gpt(self):
        judge = Judge(adapter="gpt")
        adapter = create_adapter(judge)
        self.assertIsInstance(adapter, GPTJudgeAdapter)

    def test_create_gemini(self):
        judge = Judge(adapter="gemini")
        adapter = create_adapter(judge)
        self.assertIsInstance(adapter, GeminiJudgeAdapter)

    def test_create_unknown_fallback(self):
        judge = Judge(adapter="unknown")
        adapter = create_adapter(judge)
        self.assertIsInstance(adapter, MockJudgeAdapter)


# ============================================================
# Pool 测试
# ============================================================
class TestJudgePool(unittest.TestCase):
    """JudgePool 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="llm_judge_pool_"))
        self.pool = JudgePool(store_dir=str(self.tmpdir))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_register(self):
        judge = Judge(name="Test Judge", model="test-model")
        result = self.pool.register(judge)
        self.assertEqual(result.name, "Test Judge")

    def test_unregister(self):
        judge = Judge(name="Test", model="test")
        self.pool.register(judge)
        success = self.pool.unregister(judge.judge_id)
        self.assertTrue(success)

    def test_get(self):
        judge = Judge(name="Test", model="test")
        self.pool.register(judge)
        result = self.pool.get(judge.judge_id)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "Test")

    def test_list(self):
        self.assertGreaterEqual(len(self.pool.list()), 3)  # 默认 3 个
        judges = self.pool.list(enabled_only=True)
        self.assertGreaterEqual(len(judges), 3)

    def test_select_single(self):
        judges = self.pool.select(use_consensus=False, count=1)
        self.assertEqual(len(judges), 1)

    def test_select_consensus(self):
        judges = self.pool.select(use_consensus=True, count=3)
        self.assertGreaterEqual(len(judges), 2)
        self.assertLessEqual(len(judges), 3)

    def test_select_by_domain(self):
        # 注册一个 backend 专长
        judge = Judge(name="Backend Judge", model="backend", specialties=["backend"])
        self.pool.register(judge)
        judges = self.pool.select(domain="backend", use_consensus=False, count=1)
        # 优先选 backend 专长
        self.assertIn("backend", judges[0].specialties)

    def test_enable_disable(self):
        judge = Judge(name="Test", model="test")
        self.pool.register(judge)
        self.pool.disable(judge.judge_id)
        self.assertFalse(self.pool.get(judge.judge_id).enabled)
        self.pool.enable(judge.judge_id)
        self.assertTrue(self.pool.get(judge.judge_id).enabled)

    def test_record_run(self):
        judge = Judge(name="Test", model="test")
        self.pool.register(judge)
        self.pool.record_run(judge.judge_id, success=True, latency_ms=100)
        self.assertEqual(self.pool.get(judge.judge_id).total_runs, 1)
        self.assertEqual(self.pool.get(judge.judge_id).avg_latency_ms, 100.0)

    def test_get_stats(self):
        stats = self.pool.get_stats()
        self.assertIn("total_judges", stats)
        self.assertIn("enabled_judges", stats)

    def test_persistence(self):
        # 注册并保存
        judge = Judge(name="Persist Test", model="test")
        self.pool.register(judge)
        # 创建新 pool，应该能加载
        pool2 = JudgePool(store_dir=str(self.tmpdir))
        loaded = pool2.get(judge.judge_id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.name, "Persist Test")


class TestPoolPathWhitelist(unittest.TestCase):
    """Pool 路径白名单测试"""

    def test_allowed_paths(self):
        self.assertTrue(is_pool_path_allowed("/home/qizheng/auto_code_data/test"))
        self.assertTrue(is_pool_path_allowed("/home/qizheng/auto_code_ws/test"))
        self.assertTrue(is_pool_path_allowed("/tmp/judge_test_123"))

    def test_disallowed_paths(self):
        self.assertFalse(is_pool_path_allowed("/etc/passwd"))
        self.assertFalse(is_pool_path_allowed("/root/.ssh"))


# ============================================================
# Consensus 测试
# ============================================================
class TestConsensusEngine(unittest.TestCase):
    """ConsensusEngine 测试"""

    def setUp(self):
        self.engine = ConsensusEngine()

    def test_aggregate_empty(self):
        result = self.engine.aggregate([], task_id="t1")
        self.assertEqual(result.judge_count, 0)
        self.assertEqual(result.task_id, "t1")

    def test_weighted_average_basic(self):
        reports = [
            JudgeReport(
                judge_id="j1", scores=JudgeScore(correctness=8, style=7, safety=9, performance=6, maintainability=7),
                overall_pass=True, overall_score=7.4,
            ),
            JudgeReport(
                judge_id="j2", scores=JudgeScore(correctness=7, style=8, safety=9, performance=7, maintainability=8),
                overall_pass=True, overall_score=7.8,
            ),
        ]
        judges = [Judge(judge_id="j1", weight=1.0), Judge(judge_id="j2", weight=1.0)]
        consensus = self.engine.aggregate(reports, judges, task_id="t1")
        self.assertEqual(consensus.judge_count, 2)
        self.assertFalse(consensus.safety_veto)
        self.assertGreater(consensus.overall_score, 7.0)

    def test_safety_veto(self):
        reports = [
            JudgeReport(
                judge_id="j1",
                scores=JudgeScore(correctness=10, style=10, safety=3, performance=10, maintainability=10),
                overall_pass=False, overall_score=8.6,
            ),
        ]
        consensus = self.engine.aggregate(reports, task_id="t1")
        self.assertTrue(consensus.safety_veto)
        self.assertFalse(consensus.overall_pass)

    def test_divergence_detection(self):
        reports = [
            JudgeReport(
                judge_id="j1",
                scores=JudgeScore(correctness=8, style=5, safety=9, performance=6, maintainability=7),
                overall_pass=True, overall_score=7.0,
            ),
            JudgeReport(
                judge_id="j2",
                scores=JudgeScore(correctness=3, style=10, safety=9, performance=6, maintainability=7),
                overall_pass=False, overall_score=7.0,
            ),
        ]
        consensus = self.engine.aggregate(reports, task_id="t1")
        # correctness 分歧 = 5，> threshold 3
        self.assertTrue(consensus.needs_review)
        self.assertGreater(consensus.divergence.get(DIMENSION_CORRECTNESS, 0), 3)

    def test_majority_vote(self):
        engine = ConsensusEngine()
        reports = [
            JudgeReport(judge_id="j1", scores=JudgeScore(correctness=8, style=8, safety=9, performance=8, maintainability=8), overall_pass=True, overall_score=8.2),
            JudgeReport(judge_id="j2", scores=JudgeScore(correctness=8, style=8, safety=9, performance=8, maintainability=8), overall_pass=True, overall_score=8.2),
            JudgeReport(judge_id="j3", scores=JudgeScore(correctness=3, style=3, safety=8, performance=3, maintainability=3), overall_pass=False, overall_score=4.0),
        ]
        consensus = engine.aggregate(reports, task_id="t1", strategy=ConsensusStrategy.MAJORITY_VOTE.value)
        # 2/3 pass 且无 safety veto，应通过
        self.assertTrue(consensus.overall_pass)  # 2/3 pass

    def test_strict_unanimous(self):
        engine = ConsensusEngine()
        reports = [
            JudgeReport(judge_id="j1", scores=JudgeScore(correctness=8, style=8, safety=9, performance=8, maintainability=8), overall_pass=True, overall_score=8.2),
            JudgeReport(judge_id="j2", scores=JudgeScore(correctness=3, style=3, safety=3, performance=3, maintainability=3), overall_pass=False, overall_score=3.0),
        ]
        consensus = engine.aggregate(reports, task_id="t1", strategy=ConsensusStrategy.STRICT_UNANIMOUS.value)
        self.assertFalse(consensus.overall_pass)  # 必须全部 pass

    def test_merge_reports(self):
        reports = [
            JudgeReport(judge_id="j1", scores=JudgeScore(), issues=["issue1", "issue2"], suggestions=["sug1"]),
            JudgeReport(judge_id="j2", scores=JudgeScore(), issues=["issue1", "issue3"], suggestions=["sug1", "sug2"]),
        ]
        merged = self.engine.merge_reports(reports)
        # 去重
        self.assertEqual(len(merged["issues"]), 3)  # issue1, issue2, issue3
        self.assertEqual(len(merged["suggestions"]), 2)  # sug1, sug2


# ============================================================
# Verifier 测试
# ============================================================
class TestLLMJudgeVerifier(unittest.TestCase):
    """LLMJudgeVerifier 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="llm_judge_verifier_"))
        self.pool = JudgePool(store_dir=str(self.tmpdir))
        self.verifier = LLMJudgeVerifier(pool=self.pool)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_verify_basic(self):
        result = self.verifier.verify(
            task_description="Implement hello world",
            code_diff="def hello():\n    return 'world'",
            test_results="All tests pass",
        )
        self.assertEqual(result["verifier"], "llm_judge")
        self.assertIn("passed", result)
        self.assertIn("score", result)
        self.assertIn("scores", result)

    def test_verify_with_domain(self):
        result = self.verifier.verify(
            task_description="Add security check",
            code_diff="def check(input): return validate(input)",
            domain=Domain.SECURITY.value,
        )
        self.assertIn("scores", result)
        self.assertIn("safety", result["scores"])

    def test_verify_no_consensus(self):
        result = self.verifier.verify(
            task_description="Simple task",
            code_diff="x = 1",
            use_consensus=False,
        )
        self.assertEqual(result["judge_count"], 1)

    def test_verify_with_consensus(self):
        result = self.verifier.verify(
            task_description="Complex task",
            code_diff="x = 1",
            use_consensus=True,
        )
        self.assertGreaterEqual(result["judge_count"], 1)

    def test_health_check(self):
        health = self.verifier.health_check()
        self.assertTrue(health["healthy"])
        self.assertEqual(health["verifier"], "llm_judge")


# ============================================================
# Store 测试
# ============================================================
class TestJudgeStore(unittest.TestCase):
    """JudgeStore 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="llm_judge_store_"))
        self.store = JudgeStore(store_dir=str(self.tmpdir))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_save_and_get(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        loaded = self.store.get(task.task_id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.task_description, "Test")

    def test_get_or_raise(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        loaded = self.store.get_or_raise(task.task_id)
        self.assertEqual(loaded.task_description, "Test")

    def test_get_or_raise_not_found(self):
        with self.assertRaises(KeyError):
            self.store.get_or_raise("nonexistent")

    def test_list(self):
        for i in range(3):
            self.store.save(JudgeTask(task_description=f"Task {i}"))
        tasks = self.store.list()
        self.assertEqual(len(tasks), 3)

    def test_list_by_status(self):
        task = JudgeTask(task_description="Test", status=JudgeTaskStatus.COMPLETED.value)
        self.store.save(task)
        completed = self.store.list(status=JudgeTaskStatus.COMPLETED.value)
        self.assertEqual(len(completed), 1)
        pending = self.store.list(status=JudgeTaskStatus.PENDING.value)
        self.assertEqual(len(pending), 0)

    def test_update_status(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        updated = self.store.update_status(task.task_id, JudgeTaskStatus.RUNNING.value)
        self.assertEqual(updated.status, JudgeTaskStatus.RUNNING.value)
        self.assertNotEqual(updated.started_at, "")

    def test_add_report(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        report = JudgeReport(task_id=task.task_id, scores=JudgeScore(correctness=8))
        self.store.add_report(task.task_id, report)
        loaded = self.store.get(task.task_id)
        self.assertEqual(len(loaded.reports), 1)

    def test_set_consensus(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        consensus = JudgeConsensus(task_id=task.task_id, overall_pass=True, overall_score=8.0)
        self.store.set_consensus(task.task_id, consensus)
        loaded = self.store.get(task.task_id)
        self.assertIsNotNone(loaded.consensus)
        self.assertTrue(loaded.consensus.overall_pass)

    def test_get_stats(self):
        for i in range(3):
            self.store.save(JudgeTask(task_description=f"Task {i}"))
        stats = self.store.get_stats()
        self.assertEqual(stats["total_tasks"], 3)

    def test_delete(self):
        task = JudgeTask(task_description="Test")
        self.store.save(task)
        success = self.store.delete(task.task_id)
        self.assertTrue(success)
        self.assertIsNone(self.store.get(task.task_id))


class TestStorePathWhitelist(unittest.TestCase):
    """Store 路径白名单测试"""

    def test_allowed_paths(self):
        self.assertTrue(is_store_path_allowed("/home/qizheng/auto_code_data/test"))
        self.assertTrue(is_store_path_allowed("/home/qizheng/auto_code_ws/test"))

    def test_disallowed_paths(self):
        self.assertFalse(is_store_path_allowed("/etc/passwd"))


# ============================================================
# Engine 测试
# ============================================================
class TestJudgeEngine(unittest.TestCase):
    """JudgeEngine 集成测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="llm_judge_engine_"))
        self.pool = JudgePool(store_dir=str(self.tmpdir / "pool"))
        self.store = JudgeStore(store_dir=str(self.tmpdir / "store"))
        self.engine = JudgeEngine(pool=self.pool, store=self.store)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_submit(self):
        task = JudgeTask(task_description="Test")
        saved = self.engine.submit(task)
        self.assertEqual(saved.task_id, task.task_id)
        loaded = self.store.get(task.task_id)
        self.assertIsNotNone(loaded)

    def test_execute(self):
        task = JudgeTask(task_description="Implement foo", code_diff="def foo(): pass")
        task = self.engine.execute_sync(task)
        self.assertIn(task.status, [JudgeTaskStatus.COMPLETED.value, JudgeTaskStatus.VETOED.value])
        self.assertIsNotNone(task.consensus)
        self.assertGreater(len(task.reports), 0)

    def test_execute_no_judges(self):
        # 禁用所有 Judge
        for j in self.pool.list():
            self.pool.disable(j.judge_id)
        task = JudgeTask(task_description="Test")
        task = self.engine.execute_sync(task)
        self.assertEqual(task.status, JudgeTaskStatus.FAILED.value)
        self.assertIn("No enabled judges", task.error)

    def test_execute_safety_veto(self):
        # 创建一个会触发 safety veto 的任务
        task = JudgeTask(
            task_description="Add eval",
            code_diff="eval(user_input)  # dangerous",
        )
        task = self.engine.execute_sync(task)
        # Mock adapter 对 eval 会降低 safety
        # 但因为默认 rubric 中 safety < 6 触发 veto
        self.assertIsNotNone(task.consensus)

    def test_get_stats(self):
        self.engine.execute_sync(JudgeTask(task_description="Test 1"))
        self.engine.execute_sync(JudgeTask(task_description="Test 2"))
        stats = self.engine.get_stats()
        self.assertEqual(stats["total_tasks"], 2)


# ============================================================
# 端到端集成测试
# ============================================================
class TestEndToEnd(unittest.TestCase):
    """完整端到端测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="llm_judge_e2e_"))
        self.pool = JudgePool(store_dir=str(self.tmpdir / "pool"))
        self.store = JudgeStore(store_dir=str(self.tmpdir / "store"))
        self.engine = JudgeEngine(pool=self.pool, store=self.store)
        self.verifier = LLMJudgeVerifier(pool=self.pool)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_workflow(self):
        """完整工作流：提交 → 执行 → 查询 → 验证"""
        # 1. 提交任务
        task = JudgeTask(
            task_description="Implement user authentication",
            code_diff="def login(user, pwd): return check(user, pwd)",
            test_results="2 tests passed",
            domain=Domain.SECURITY.value,
        )
        task = self.engine.execute_sync(task)
        # 2. 验证状态
        self.assertIn(task.status, [JudgeTaskStatus.COMPLETED.value, JudgeTaskStatus.VETOED.value])
        # 3. 验证 consensus
        self.assertIsNotNone(task.consensus)
        # 4. 验证 5 维度分数
        scores = task.consensus.aggregated_scores.to_dict()
        for dim in ALL_DIMENSIONS:
            self.assertIn(dim, scores)
        # 5. 验证 LLM Judge Verifier
        result = self.verifier.verify(
            task_description="Test",
            code_diff="def foo(): pass",
        )
        self.assertIn("passed", result)
        # 6. 统计 - 至少有 1 个任务
        stats = self.engine.get_stats()
        self.assertGreaterEqual(stats["total_tasks"], 1)
        # 7. 再提交一个任务以测试统计
        task2 = JudgeTask(task_description="Another task")
        self.engine.execute_sync(task2)
        stats2 = self.engine.get_stats()
        self.assertGreaterEqual(stats2["total_tasks"], 2)

    def test_concurrent_execution(self):
        """并发执行测试"""
        results = []

        def run(i):
            task = JudgeTask(task_description=f"Task {i}")
            result = self.engine.execute_sync(task)
            results.append(result)

        threads = [threading.Thread(target=run, args=(i,)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 3)
        for r in results:
            self.assertIn(r.status, [JudgeTaskStatus.COMPLETED.value, JudgeTaskStatus.VETOED.value])


# ============================================================
# 运行测试
# ============================================================
if __name__ == "__main__":
    unittest.main()
