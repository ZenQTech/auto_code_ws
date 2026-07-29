"""
# ============================================================
# Hermes LLM-as-Judge - 验证执行器（与 P1-10 Verification Loop 集成）
# ============================================================
# 核心作用：实现 LLMJudgeVerifier 适配 P1-10 Verification Loop 接口
# 特性：
#   - 与现有 4 维度验证器相同的接口
#   - 异步执行
#   - 结果标准化
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from .consensus import ConsensusEngine
from .models import (
    ConsensusStrategy,
    Difficulty,
    Domain,
    Judge,
    JudgeConsensus,
    JudgeReport,
    JudgeTask,
    JudgeTaskStatus,
)
from .pool import JudgePool, get_judge_pool
from .prompts import build_prompt

logger = logging.getLogger(__name__)


# ============================================================
# P1-10 Verification 兼容接口
# ============================================================
class LLMJudgeVerifier:
    """
    LLM-as-Judge 验证器
    适配 P1-10 Verification Loop 的 Verifier 接口
    """

    name = "llm_judge"
    version = "1.0.0"
    description = "LLM-as-Judge semantic verification (5 dimensions)"

    def __init__(
        self,
        pool: Optional[JudgePool] = None,
        consensus_engine: Optional[ConsensusEngine] = None,
    ):
        self.pool = pool or get_judge_pool()
        self.consensus_engine = consensus_engine or ConsensusEngine()

    def verify(
        self,
        task_description: str,
        code_diff: str = "",
        test_results: str = "",
        context: Optional[Dict[str, Any]] = None,
        domain: str = Domain.GENERAL.value,
        difficulty: str = Difficulty.MEDIUM.value,
        use_consensus: bool = True,
        rubric: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        执行 Judge 验证
        返回标准 verifier 结果格式（与 P1-10 兼容）
        """
        start = time.time()
        try:
            # 1. 选择 Judge
            judges = self.pool.select(
                domain=domain,
                difficulty=difficulty,
                count=3 if use_consensus else 1,
                use_consensus=use_consensus,
            )
            if not judges:
                return {
                    "verifier": self.name,
                    "version": self.version,
                    "passed": False,
                    "score": 0.0,
                    "judge_count": 0,
                    "error": "No enabled judges in pool",
                    "duration_ms": int((time.time() - start) * 1000),
                }

            # 2. 构建 prompt
            prompt = build_prompt(
                task_description=task_description,
                code_diff=code_diff,
                test_results=test_results,
                rubric=rubric,
                domain=domain,
                difficulty=difficulty,
            )

            # 3. 串行/并行执行（这里简化为串行）
            task_id = f"verify_{int(time.time())}"
            reports: List[JudgeReport] = []
            for judge in judges:
                adapter = self.pool.get_adapter(judge.judge_id)
                if not adapter:
                    continue
                report = adapter.judge(task_id, prompt)
                reports.append(report)
                self.pool.record_run(judge.judge_id, success=not report.error, latency_ms=report.latency_ms)

            if not reports:
                return {
                    "verifier": self.name,
                    "version": self.version,
                    "passed": False,
                    "score": 0.0,
                    "judge_count": 0,
                    "error": "All judges failed",
                    "duration_ms": int((time.time() - start) * 1000),
                }

            # 4. 共识
            consensus = self.consensus_engine.aggregate(
                reports=reports,
                judges=judges,
                task_id=task_id,
            )

            duration_ms = int((time.time() - start) * 1000)
            return {
                "verifier": self.name,
                "version": self.version,
                "passed": consensus.overall_pass,
                "score": consensus.overall_score,
                "scores": consensus.aggregated_scores.to_dict(),
                "divergence": consensus.divergence,
                "needs_review": consensus.needs_review,
                "safety_veto": consensus.safety_veto,
                "judge_count": consensus.judge_count,
                "reports": [r.to_dict() for r in reports],
                "consensus": consensus.to_dict(),
                "issues": self.consensus_engine.merge_reports(reports).get("issues", []),
                "suggestions": self.consensus_engine.merge_reports(reports).get("suggestions", []),
                "duration_ms": duration_ms,
            }
        except Exception as e:
            logger.error(f"LLM Judge verification error: {e}")
            return {
                "verifier": self.name,
                "version": self.version,
                "passed": False,
                "score": 0.0,
                "judge_count": 0,
                "error": str(e),
                "duration_ms": int((time.time() - start) * 1000),
            }

    def health_check(self) -> Dict[str, Any]:
        return {
            "verifier": self.name,
            "healthy": True,
            "version": self.version,
            "pool_stats": self.pool.get_stats(),
        }


# ============================================================
# 全局单例
# ============================================================
_verifier_instance: Optional[LLMJudgeVerifier] = None


def get_llm_judge_verifier() -> LLMJudgeVerifier:
    global _verifier_instance
    if _verifier_instance is None:
        _verifier_instance = LLMJudgeVerifier()
    return _verifier_instance
