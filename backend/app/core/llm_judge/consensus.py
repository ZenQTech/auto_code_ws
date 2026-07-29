"""
# ============================================================
# Hermes LLM-as-Judge - 多 Judge 共识
# ============================================================
# 核心作用：实现多 Judge 共识算法
# 特性：
#   - 加权平均（按 Judge weight）
#   - 分歧度检测（> threshold 触发重审）
#   - Safety 一票否决
#   - Issues / Suggestions 合并去重
#   - 一致性指标（stddev / min_max_diff）
#   - 置信度分数（基于分歧度）
#   - first_valid 策略（降级到单 Judge）
# Cycle 13 P0-3 新建
# Cycle 15 P1-3 增强
# ============================================================
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional

from .models import (
    ALL_DIMENSIONS,
    ConsensusStrategy,
    Judge,
    JudgeConsensus,
    JudgeReport,
    JudgeScore,
    _new_id,
    _now_iso,
)

logger = logging.getLogger(__name__)


# ============================================================
# 共识算法
# ============================================================
class ConsensusEngine:
    """
    多 Judge 共识引擎
    支持多种共识策略：
    - WEIGHTED_AVERAGE: 加权平均（默认）
    - MAJORITY_VOTE: 多数投票
    - STRICT_UNANIMOUS: 严格一致
    - FIRST_VALID: 首个有效（降级用）
    """

    def __init__(
        self,
        divergence_threshold: float = 3.0,
        safety_veto_threshold: int = 6,
        pass_threshold: float = 6.0,
    ):
        self.divergence_threshold = divergence_threshold
        self.safety_veto_threshold = safety_veto_threshold
        self.pass_threshold = pass_threshold

    def aggregate(
        self,
        reports: List[JudgeReport],
        judges: Optional[List[Judge]] = None,
        strategy: str = ConsensusStrategy.WEIGHTED_AVERAGE.value,
        task_id: str = "",
    ) -> JudgeConsensus:
        """
        聚合多 Judge 报告
        """
        if not reports:
            return JudgeConsensus(task_id=task_id, judge_count=0)

        if strategy == ConsensusStrategy.WEIGHTED_AVERAGE.value:
            return self._weighted_average(reports, judges, task_id)
        elif strategy == ConsensusStrategy.MAJORITY_VOTE.value:
            return self._majority_vote(reports, task_id)
        elif strategy == ConsensusStrategy.STRICT_UNANIMOUS.value:
            return self._strict_unanimous(reports, task_id)
        elif strategy == ConsensusStrategy.FIRST_VALID.value:
            return self._first_valid(reports, task_id)
        else:
            return self._weighted_average(reports, judges, task_id)

    def _weighted_average(
        self,
        reports: List[JudgeReport],
        judges: Optional[List[Judge]],
        task_id: str,
    ) -> JudgeConsensus:
        # 构建 judge_id -> weight 映射
        weights: Dict[str, float] = {}
        if judges:
            for j in judges:
                weights[j.judge_id] = j.weight
        else:
            for r in reports:
                weights[r.judge_id] = 1.0

        # 计算每个维度的加权平均
        aggregated_dict: Dict[str, float] = {}
        divergence: Dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            values = []
            ws = []
            for r in reports:
                v = r.scores.get(dim)
                w = weights.get(r.judge_id, 1.0)
                values.append(v)
                ws.append(w)
            if not values:
                aggregated_dict[dim] = 0.0
                divergence[dim] = 0.0
                continue
            total = sum(v * w for v, w in zip(values, ws))
            total_w = sum(ws)
            avg = total / total_w if total_w > 0 else 0.0
            aggregated_dict[dim] = round(avg, 2)
            # 分歧度：max - min
            divergence[dim] = round(max(values) - min(values), 2)

        # Safety 一票否决
        safety_veto = any(r.scores.safety < self.safety_veto_threshold for r in reports)
        # 任一维度分歧 > threshold 触发重审
        needs_review = any(d > self.divergence_threshold for d in divergence.values())

        # 合并 issues / suggestions
        all_issues: List[str] = []
        all_suggestions: List[str] = []
        seen_issues = set()
        seen_suggestions = set()
        for r in reports:
            for issue in r.issues:
                key = issue.strip().lower()
                if key and key not in seen_issues:
                    all_issues.append(issue)
                    seen_issues.add(key)
            for sug in r.suggestions:
                key = sug.strip().lower()
                if key and key not in seen_suggestions:
                    all_suggestions.append(sug)
                    seen_suggestions.add(key)

        # Overall pass
        overall_score = sum(aggregated_dict.values()) / len(aggregated_dict) if aggregated_dict else 0.0
        overall_pass = (
            not safety_veto
            and overall_score >= self.pass_threshold
            and aggregated_dict.get("correctness", 0) >= 6
        )

        consensus = JudgeConsensus(
            consensus_id=_new_id("cons"),
            task_id=task_id,
            aggregated_scores=JudgeScore(
                correctness=int(round(aggregated_dict.get("correctness", 0))),
                style=int(round(aggregated_dict.get("style", 0))),
                safety=int(round(aggregated_dict.get("safety", 0))),
                performance=int(round(aggregated_dict.get("performance", 0))),
                maintainability=int(round(aggregated_dict.get("maintainability", 0))),
            ),
            overall_pass=overall_pass,
            overall_score=round(overall_score, 2),
            divergence=divergence,
            needs_review=needs_review,
            safety_veto=safety_veto,
            judge_count=len(reports),
            strategy=ConsensusStrategy.WEIGHTED_AVERAGE.value,
            created_at=_now_iso(),
        )
        # 增强指标
        self._attach_consistency_metrics(consensus, reports, aggregated_dict)
        return consensus

    def _majority_vote(
        self,
        reports: List[JudgeReport],
        task_id: str,
    ) -> JudgeConsensus:
        """多数投票：>= 半数 pass 则通过"""
        if not reports:
            return JudgeConsensus(task_id=task_id, judge_count=0)
        pass_count = sum(1 for r in reports if r.overall_pass)
        total = len(reports)
        overall_pass = pass_count > total / 2
        # 简单平均
        aggregated = JudgeScore(
            correctness=int(sum(r.scores.correctness for r in reports) / total),
            style=int(sum(r.scores.style for r in reports) / total),
            safety=int(sum(r.scores.safety for r in reports) / total),
            performance=int(sum(r.scores.performance for r in reports) / total),
            maintainability=int(sum(r.scores.maintainability for r in reports) / total),
        )
        safety_veto = any(r.scores.safety < self.safety_veto_threshold for r in reports)
        # 分歧度
        divergence: Dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            values = [r.scores.get(dim) for r in reports]
            divergence[dim] = round(max(values) - min(values), 2) if values else 0.0

        consensus = JudgeConsensus(
            consensus_id=_new_id("cons"),
            task_id=task_id,
            aggregated_scores=aggregated,
            overall_pass=overall_pass and not safety_veto,
            overall_score=aggregated.simple_average(),
            divergence=divergence,
            needs_review=any(d > self.divergence_threshold for d in divergence.values()),
            safety_veto=safety_veto,
            judge_count=total,
            strategy=ConsensusStrategy.MAJORITY_VOTE.value,
            created_at=_now_iso(),
        )
        # 增强指标
        aggregated_dict = aggregated.to_dict()
        self._attach_consistency_metrics(consensus, reports, aggregated_dict)
        return consensus

    def _strict_unanimous(
        self,
        reports: List[JudgeReport],
        task_id: str,
    ) -> JudgeConsensus:
        """严格一致：所有 Judge 都 pass 才通过"""
        if not reports:
            return JudgeConsensus(task_id=task_id, judge_count=0)
        overall_pass = all(r.overall_pass for r in reports)
        aggregated = JudgeScore(
            correctness=int(sum(r.scores.correctness for r in reports) / len(reports)),
            style=int(sum(r.scores.style for r in reports) / len(reports)),
            safety=int(sum(r.scores.safety for r in reports) / len(reports)),
            performance=int(sum(r.scores.performance for r in reports) / len(reports)),
            maintainability=int(sum(r.scores.maintainability for r in reports) / len(reports)),
        )
        safety_veto = any(r.scores.safety < self.safety_veto_threshold for r in reports)
        divergence: Dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            values = [r.scores.get(dim) for r in reports]
            divergence[dim] = round(max(values) - min(values), 2) if values else 0.0

        consensus = JudgeConsensus(
            consensus_id=_new_id("cons"),
            task_id=task_id,
            aggregated_scores=aggregated,
            overall_pass=overall_pass and not safety_veto,
            overall_score=aggregated.simple_average(),
            divergence=divergence,
            needs_review=any(d > self.divergence_threshold for d in divergence.values()),
            safety_veto=safety_veto,
            judge_count=len(reports),
            strategy=ConsensusStrategy.STRICT_UNANIMOUS.value,
            created_at=_now_iso(),
        )
        aggregated_dict = aggregated.to_dict()
        self._attach_consistency_metrics(consensus, reports, aggregated_dict)
        return consensus

    def _first_valid(
        self,
        reports: List[JudgeReport],
        task_id: str,
    ) -> JudgeConsensus:
        """首个有效：取第一个无 error 且非 veto 的报告作为共识"""
        if not reports:
            return JudgeConsensus(task_id=task_id, judge_count=0)
        valid = [r for r in reports if not r.error and r.scores.safety >= self.safety_veto_threshold]
        if not valid:
            # 全部无效 → 取第一个
            valid = [reports[0]]
        first = valid[0]
        aggregated = JudgeScore(
            correctness=first.scores.correctness,
            style=first.scores.style,
            safety=first.scores.safety,
            performance=first.scores.performance,
            maintainability=first.scores.maintainability,
        )
        safety_veto = first.scores.safety < self.safety_veto_threshold
        consensus = JudgeConsensus(
            consensus_id=_new_id("cons"),
            task_id=task_id,
            aggregated_scores=aggregated,
            overall_pass=first.overall_pass and not safety_veto,
            overall_score=aggregated.simple_average(),
            divergence={dim: 0.0 for dim in ALL_DIMENSIONS},
            needs_review=False,
            safety_veto=safety_veto,
            judge_count=len(reports),
            strategy=ConsensusStrategy.FIRST_VALID.value,
            created_at=_now_iso(),
        )
        aggregated_dict = aggregated.to_dict()
        self._attach_consistency_metrics(consensus, reports, aggregated_dict)
        return consensus

    def _attach_consistency_metrics(
        self,
        consensus: JudgeConsensus,
        reports: List[JudgeReport],
        aggregated_dict: Dict[str, float],
    ) -> None:
        """
        附加一致性指标（标准差、置信度、共识强度）

        注入到 consensus.metadata 字段（向后兼容）
        """
        # 标准差
        stddev: Dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            values = [r.scores.get(dim) for r in reports]
            if not values:
                stddev[dim] = 0.0
                continue
            mean = sum(values) / len(values)
            variance = sum((v - mean) ** 2 for v in values) / len(values)
            stddev[dim] = round(math.sqrt(variance), 3)

        # 置信度（基于分歧度，分数越低置信度越高）
        # 满分 1.0，无分歧；分歧越大置信度越低
        max_div = max(consensus.divergence.values()) if consensus.divergence else 0.0
        # 分歧度 0 → 置信度 1.0；分歧度 10 → 置信度 0.0
        confidence = max(0.0, 1.0 - max_div / 10.0)

        # 共识强度（基于 Judge 一致性）
        # 全部 pass → 1.0；全部 fail → 1.0；50/50 → 0.0
        pass_count = sum(1 for r in reports if r.overall_pass)
        pass_ratio = pass_count / len(reports) if reports else 0.0
        # 共识强度 = 2 * |pass_ratio - 0.5|（偏离 50% 越远越强）
        consensus_strength = 2 * abs(pass_ratio - 0.5)

        # 注入到 consensus 的 metadata（通过 monkey-patch）
        # 原始 JudgeConsensus 没有 metadata 字段，我们用 divergence 扩展
        consensus.divergence["__stddev__"] = round(sum(stddev.values()) / len(stddev), 3) if stddev else 0.0
        consensus.divergence["__max_stddev__"] = max(stddev.values()) if stddev else 0.0
        consensus.divergence["__confidence__"] = round(confidence, 3)
        consensus.divergence["__consensus_strength__"] = round(consensus_strength, 3)
        consensus.divergence["__stddev_by_dim__"] = stddev

    def merge_reports(
        self,
        reports: List[JudgeReport],
    ) -> Dict[str, Any]:
        """合并 reports 中的 issues/suggestions"""
        all_issues: List[str] = []
        all_suggestions: List[str] = []
        seen_issues = set()
        seen_suggestions = set()
        for r in reports:
            for issue in r.issues:
                key = issue.strip().lower()
                if key and key not in seen_issues:
                    all_issues.append(issue)
                    seen_issues.add(key)
            for sug in r.suggestions:
                key = sug.strip().lower()
                if key and key not in seen_suggestions:
                    all_suggestions.append(sug)
                    seen_suggestions.add(key)
        return {
            "issues": all_issues,
            "suggestions": all_suggestions,
        }
