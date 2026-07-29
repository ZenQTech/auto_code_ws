"""
# ============================================================
# Hermes LLM-as-Judge - Judge Adapter 抽象与实现
# ============================================================
# 核心作用：定义 Judge Adapter 接口与多种实现（Mock/Claude/GPT/Gemini）
# 特性：
#   - 抽象基类 JudgeAdapter
#   - Mock Adapter（基于规则的伪评分，用于测试和离线运行）
#   - Claude/GPT/Gemini 适配器（接口预留，需要 API Key）
#   - Custom Adapter（支持用户自定义）
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from .models import (
    ALL_DIMENSIONS,
    DIMENSION_CORRECTNESS,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_PERFORMANCE,
    DIMENSION_SAFETY,
    DIMENSION_STYLE,
    Judge,
    JudgeReport,
    JudgeScore,
    _clamp_score,
    _new_id,
    _now_iso,
)
from .prompts import build_prompt, extract_json_from_response

logger = logging.getLogger(__name__)


# ============================================================
# 抽象基类
# ============================================================
class JudgeAdapter(ABC):
    """Judge Adapter 抽象基类"""

    def __init__(self, judge: Judge):
        # 关键修复：使用 _judge_model 避免与方法名 judge() 冲突
        self._judge_model = judge

    @abstractmethod
    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        """
        执行 Judge 评分
        参数：
          - task_id: 任务 ID
          - prompt: 完整 prompt
          - timeout: 超时（秒）
        返回：JudgeReport
        """
        raise NotImplementedError

    def get_judge(self) -> Judge:
        """获取关联的 Judge 对象（使用不同方法名避免冲突）"""
        return self._judge_model

    @property
    def name(self) -> str:
        return self._judge_model.name

    @property
    def model(self) -> str:
        return self._judge_model.model


# ============================================================
# Mock Adapter（基于规则）
# ============================================================
class MockJudgeAdapter(JudgeAdapter):
    """
    Mock Judge Adapter
    基于规则生成伪评分：
    - 解析 prompt 中的 task_description、code_diff、test_results
    - 启发式计算 5 维度分数
    - 生成 issues / suggestions
    """

    # 风险关键词
    SAFETY_KEYWORDS = [
        "eval", "exec", "os.system", "subprocess", "shell=True",
        "rm -rf", "DROP TABLE", "DELETE FROM", "TRUNCATE",
        "password", "secret", "api_key", "token",
        "input()", "raw_input",
        "pickle.loads", "yaml.load",
        "SQL injection", "XSS", "csrf",
    ]

    STYLE_KEYWORDS = {
        "good": ["type hint", "docstring", "注释", "中文注释", "test", "测试", "async def", "logger"],
        "bad": ["TODO", "FIXME", "XXX", "print(", "console.log"],
    }

    PERFORMANCE_KEYWORDS = {
        "good": ["O(1)", "O(log", "cache", "缓存", "index", "索引", "async", "await"],
        "bad": ["for i in range(n):\\s*\\n\\s*for j", "O(n^2)", "nested loop", "嵌套循环"],
    }

    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        start = time.time()
        # 提取任务描述、code diff、test results
        task_description = self._extract_section(prompt, "## Task", "## Code Diff")
        code_diff = self._extract_section(prompt, "## Code Diff", "## Test Results")
        test_results = self._extract_section(prompt, "## Test Results", "## Evaluation Criteria")

        # 启发式计算分数
        scores = JudgeScore(
            correctness=self._score_correctness(code_diff, test_results),
            style=self._score_style(code_diff),
            safety=self._score_safety(code_diff, task_description),
            performance=self._score_performance(code_diff),
            maintainability=self._score_maintainability(code_diff, task_description),
        )

        # 生成 issues / suggestions
        issues, suggestions = self._generate_issues_suggestions(
            scores, code_diff, task_description
        )

        overall_pass = (
            scores.safety >= 6
            and scores.correctness >= 6
            and scores.weighted_average({"correctness": 1.5, "safety": 2.0, "style": 0.5, "performance": 0.8, "maintainability": 0.7}) >= 6.0
        )
        overall_score = scores.simple_average()

        latency_ms = int((time.time() - start) * 1000) + random.randint(20, 80)

        return JudgeReport(
            report_id=_new_id("rpt"),
            task_id=task_id,
            judge_id=self._judge_model.judge_id,
            judge_name=self._judge_model.name,
            model=self._judge_model.model or "mock-model",
            scores=scores,
            overall_pass=overall_pass,
            overall_score=overall_score,
            issues=issues,
            suggestions=suggestions,
            latency_ms=latency_ms,
            raw_response=json.dumps(scores.to_dict(), ensure_ascii=False),
            created_at=_now_iso(),
        )

    def _extract_section(self, prompt: str, start_marker: str, end_marker: str) -> str:
        try:
            start = prompt.index(start_marker)
            end = prompt.index(end_marker, start + len(start_marker))
            return prompt[start + len(start_marker):end].strip()
        except (ValueError, IndexError):
            return ""

    def _is_empty_diff(self, code_diff: str) -> bool:
        """判断是否为空的 diff（空字符串或占位符 (no diff)）"""
        if not code_diff:
            return True
        normalized = code_diff.strip()
        if not normalized:
            return True
        # 剥离 markdown 代码围栏 ``` (来自 section 提取)
        if normalized.startswith("```") and normalized.endswith("```"):
            inner = normalized.strip("`").strip()
            if not inner:
                return True
            normalized = inner
        # 占位符（来自 build_prompt）
        if normalized in ("(no diff)", "(no description)", "(no test results)"):
            return True
        return False

    def _score_correctness(self, code_diff: str, test_results: str) -> int:
        if self._is_empty_diff(code_diff):
            return 5
        score = 7
        if "test" in test_results.lower() or "passed" in test_results.lower():
            score += 1
        if "fail" in test_results.lower() and "0 failures" not in test_results.lower():
            score -= 2
        if "def " in code_diff or "class " in code_diff or "function " in code_diff:
            score += 1
        if "return" in code_diff:
            score += 0
        return _clamp_score(score)

    def _score_style(self, code_diff: str) -> int:
        if self._is_empty_diff(code_diff):
            return 5
        score = 7
        for kw in self.STYLE_KEYWORDS["good"]:
            if kw in code_diff:
                score += 0
        for kw in self.STYLE_KEYWORDS["bad"]:
            count = code_diff.count(kw)
            if count > 0:
                score -= min(count, 3) * 0
        # 长代码 = 更可能需要维护 = 略降
        if len(code_diff) > 5000:
            score -= 1
        # 注释加分
        comment_count = code_diff.count("#") + code_diff.count("//")
        if comment_count > 3:
            score += 1
        return _clamp_score(score)

    def _score_safety(self, code_diff: str, task_description: str) -> int:
        score = 9
        if not self._is_empty_diff(code_diff):
            for kw in self.SAFETY_KEYWORDS:
                if kw in code_diff:
                    score -= 2
        # task description 中提到 "test" / "demo" 时，安全要求略低
        if "test" in task_description.lower() or "demo" in task_description.lower():
            score += 0
        return _clamp_score(score)

    def _score_performance(self, code_diff: str) -> int:
        if self._is_empty_diff(code_diff):
            return 5
        score = 7
        for kw in self.PERFORMANCE_KEYWORDS["good"]:
            if kw in code_diff:
                score += 1
        for kw in self.PERFORMANCE_KEYWORDS["bad"]:
            if re.search(kw, code_diff):
                score -= 2
        # async/await
        if "async" in code_diff or "await " in code_diff:
            score += 0
        return _clamp_score(score)

    def _score_maintainability(self, code_diff: str, task_description: str) -> int:
        if self._is_empty_diff(code_diff):
            return 5
        score = 7
        # 行数
        line_count = code_diff.count("\n")
        if line_count > 100:
            score -= 1
        if line_count < 10:
            score += 0
        # 函数/类定义
        if "def " in code_diff or "class " in code_diff:
            score += 0
        # 注释
        if code_diff.count("#") > 2 or code_diff.count("//") > 2:
            score += 1
        return _clamp_score(score)

    def _generate_issues_suggestions(
        self,
        scores: JudgeScore,
        code_diff: str,
        task_description: str,
    ) -> tuple:
        issues = []
        suggestions = []
        if scores.safety < 6:
            issues.append("Detected potential safety concerns in code")
            suggestions.append("Review the use of eval/exec and add proper input validation")
        if scores.correctness < 6:
            issues.append("Code may not fully implement the task requirements")
            suggestions.append("Verify all task requirements are addressed")
        if scores.performance < 6:
            issues.append("Potential performance issues detected")
            suggestions.append("Consider optimizing loops and adding caching where appropriate")
        if scores.style < 6:
            issues.append("Code style may not follow project conventions")
            suggestions.append("Add type hints and docstrings to functions")
        if scores.maintainability < 6:
            issues.append("Code may be difficult to maintain")
            suggestions.append("Break down large functions into smaller, focused ones")
        if not issues:
            issues.append("No major issues detected")
            suggestions.append("Code looks good - proceed with deployment")
        return issues, suggestions


# ============================================================
# Claude Adapter（接口预留）
# ============================================================
class ClaudeJudgeAdapter(JudgeAdapter):
    """
    Claude Judge Adapter
    需要 ANTHROPIC_API_KEY 环境变量
    当前为占位实现，真实环境需要 anthropic SDK
    """

    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        start = time.time()
        try:
            # 真实环境应调用 anthropic SDK
            # response = anthropic_client.messages.create(
            #     model=self._judge_model.model or "claude-sonnet-4.5",
            #     max_tokens=2048,
            #     messages=[{"role": "user", "content": prompt}]
            # )
            # 当前为占位：fallback 到 mock
            logger.warning("ClaudeJudgeAdapter not fully implemented, falling back to mock")
            mock = MockJudgeAdapter(self._judge_model)
            return mock.judge(task_id, prompt, timeout)
        except Exception as e:
            logger.error(f"Claude judge error: {e}")
            return JudgeReport(
                report_id=_new_id("rpt"),
                task_id=task_id,
                judge_id=self._judge_model.judge_id,
                judge_name=self._judge_model.name,
                model=self._judge_model.model,
                scores=JudgeScore(),
                overall_pass=False,
                overall_score=0.0,
                issues=[f"Claude judge error: {e}"],
                suggestions=["Check API key and network connection"],
                latency_ms=int((time.time() - start) * 1000),
                error=str(e),
            )


# ============================================================
# GPT Adapter（接口预留）
# ============================================================
class GPTJudgeAdapter(JudgeAdapter):
    """
    GPT Judge Adapter
    需要 OPENAI_API_KEY 环境变量
    """

    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        start = time.time()
        try:
            # 真实环境应调用 openai SDK
            logger.warning("GPTJudgeAdapter not fully implemented, falling back to mock")
            mock = MockJudgeAdapter(self._judge_model)
            return mock.judge(task_id, prompt, timeout)
        except Exception as e:
            logger.error(f"GPT judge error: {e}")
            return JudgeReport(
                report_id=_new_id("rpt"),
                task_id=task_id,
                judge_id=self._judge_model.judge_id,
                judge_name=self._judge_model.name,
                model=self._judge_model.model,
                scores=JudgeScore(),
                overall_pass=False,
                overall_score=0.0,
                issues=[f"GPT judge error: {e}"],
                suggestions=["Check API key and network connection"],
                latency_ms=int((time.time() - start) * 1000),
                error=str(e),
            )


# ============================================================
# Gemini Adapter（接口预留）
# ============================================================
class GeminiJudgeAdapter(JudgeAdapter):
    """
    Gemini Judge Adapter
    需要 GOOGLE_API_KEY 环境变量
    """

    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        start = time.time()
        try:
            logger.warning("GeminiJudgeAdapter not fully implemented, falling back to mock")
            mock = MockJudgeAdapter(self._judge_model)
            return mock.judge(task_id, prompt, timeout)
        except Exception as e:
            logger.error(f"Gemini judge error: {e}")
            return JudgeReport(
                report_id=_new_id("rpt"),
                task_id=task_id,
                judge_id=self._judge_model.judge_id,
                judge_name=self._judge_model.name,
                model=self._judge_model.model,
                scores=JudgeScore(),
                overall_pass=False,
                overall_score=0.0,
                issues=[f"Gemini judge error: {e}"],
                suggestions=["Check API key and network connection"],
                latency_ms=int((time.time() - start) * 1000),
                error=str(e),
            )


# ============================================================
# Custom Adapter
# ============================================================
class CustomJudgeAdapter(JudgeAdapter):
    """
    Custom Judge Adapter
    接受用户自定义的 judge function
    """

    def __init__(self, judge: Judge, custom_fn=None):
        super().__init__(judge)
        self.custom_fn = custom_fn

    def judge(
        self,
        task_id: str,
        prompt: str,
        timeout: Optional[float] = None,
    ) -> JudgeReport:
        if self.custom_fn is None:
            return JudgeReport(
                report_id=_new_id("rpt"),
                task_id=task_id,
                judge_id=self._judge_model.judge_id,
                judge_name=self._judge_model.name,
                model=self._judge_model.model,
                scores=JudgeScore(),
                overall_pass=False,
                overall_score=0.0,
                issues=["Custom adapter has no function defined"],
                suggestions=["Provide a custom_fn when registering this judge"],
                error="no custom_fn",
            )
        start = time.time()
        try:
            return self.custom_fn(task_id, prompt, self._judge_model, timeout)
        except Exception as e:
            logger.error(f"Custom judge error: {e}")
            return JudgeReport(
                report_id=_new_id("rpt"),
                task_id=task_id,
                judge_id=self._judge_model.judge_id,
                judge_name=self._judge_model.name,
                model=self._judge_model.model,
                scores=JudgeScore(),
                overall_pass=False,
                overall_score=0.0,
                issues=[f"Custom judge error: {e}"],
                suggestions=["Check custom judge function"],
                latency_ms=int((time.time() - start) * 1000),
                error=str(e),
            )


# ============================================================
# Adapter Factory
# ============================================================
ADAPTER_REGISTRY: Dict[str, type] = {
    "mock": MockJudgeAdapter,
    "claude": ClaudeJudgeAdapter,
    "gpt": GPTJudgeAdapter,
    "gemini": GeminiJudgeAdapter,
}


def create_adapter(judge: Judge, custom_fn=None) -> JudgeAdapter:
    """根据 judge.adapter 字段创建对应 adapter"""
    adapter_type = (judge.adapter or "mock").lower()
    if adapter_type == "custom":
        return CustomJudgeAdapter(judge, custom_fn=custom_fn)
    cls = ADAPTER_REGISTRY.get(adapter_type, MockJudgeAdapter)
    return cls(judge)


def register_adapter(adapter_type: str, adapter_cls: type) -> None:
    """注册新的 adapter 类型"""
    ADAPTER_REGISTRY[adapter_type] = adapter_cls
