"""
# ============================================================
# Hermes LLM-as-Judge 验证层 - 数据模型
# ============================================================
# 核心作用：定义 Judge Task/Score/Report/Consensus 等核心数据模型
# 特性：
#   - 5 维度评分（correctness/style/safety/performance/maintainability）
#   - Judge 任务生命周期
#   - 多 Judge 共识
#   - Safety 一票否决
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


# ============================================================
# 5 个评分维度
# ============================================================
DIMENSION_CORRECTNESS = "correctness"
DIMENSION_STYLE = "style"
DIMENSION_SAFETY = "safety"
DIMENSION_PERFORMANCE = "performance"
DIMENSION_MAINTAINABILITY = "maintainability"

ALL_DIMENSIONS = [
    DIMENSION_CORRECTNESS,
    DIMENSION_STYLE,
    DIMENSION_SAFETY,
    DIMENSION_PERFORMANCE,
    DIMENSION_MAINTAINABILITY,
]

DEFAULT_RUBRIC = [
    f"{DIMENSION_CORRECTNESS}: Does the code correctly implement the task?",
    f"{DIMENSION_STYLE}: Does the code follow project style guidelines?",
    f"{DIMENSION_SAFETY}: Are there any safety issues (injection, overflow, etc.)?",
    f"{DIMENSION_PERFORMANCE}: Is the code performant (no obvious O(n^3) etc.)?",
    f"{DIMENSION_MAINTAINABILITY}: Is the code readable and maintainable?",
]


# ============================================================
# 任务状态枚举
# ============================================================
class JudgeTaskStatus(str, Enum):
    """Judge 任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    VETOED = "vetoed"  # Safety 一票否决
    CANCELLED = "cancelled"


# ============================================================
# 难度级别
# ============================================================
class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


# ============================================================
# 领域
# ============================================================
class Domain(str, Enum):
    GENERAL = "general"
    BACKEND = "backend"
    FRONTEND = "frontend"
    DATABASE = "database"
    SECURITY = "security"
    PERFORMANCE = "performance"
    TESTING = "testing"
    DOCS = "docs"


# ============================================================
# 适配器类型
# ============================================================
class JudgeAdapterType(str, Enum):
    MOCK = "mock"
    CLAUDE = "claude"
    GPT = "gpt"
    GEMINI = "gemini"
    CUSTOM = "custom"


# ============================================================
# 共识策略
# ============================================================
class ConsensusStrategy(str, Enum):
    WEIGHTED_AVERAGE = "weighted_average"
    MAJORITY_VOTE = "majority_vote"
    STRICT_UNANIMOUS = "strict_unanimous"
    FIRST_VALID = "first_valid"          # Cycle 15 P1-3 新增：取首个有效报告


# ============================================================
# 辅助函数
# ============================================================
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


def _clamp_score(value: int, min_val: int = 0, max_val: int = 10) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return 0
    return max(min_val, min(max_val, v))


# ============================================================
# 评分模型（5 维度）
# ============================================================
@dataclass
class JudgeScore:
    """5 维度评分（0-10）"""

    correctness: int = 0
    style: int = 0
    safety: int = 0
    performance: int = 0
    maintainability: int = 0

    def __post_init__(self) -> None:
        self.correctness = _clamp_score(self.correctness)
        self.style = _clamp_score(self.style)
        self.safety = _clamp_score(self.safety)
        self.performance = _clamp_score(self.performance)
        self.maintainability = _clamp_score(self.maintainability)

    def to_dict(self) -> Dict[str, int]:
        return {
            DIMENSION_CORRECTNESS: self.correctness,
            DIMENSION_STYLE: self.style,
            DIMENSION_SAFETY: self.safety,
            DIMENSION_PERFORMANCE: self.performance,
            DIMENSION_MAINTAINABILITY: self.maintainability,
        }

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "JudgeScore":
        data = data or {}
        return cls(
            correctness=data.get(DIMENSION_CORRECTNESS, 0),
            style=data.get(DIMENSION_STYLE, 0),
            safety=data.get(DIMENSION_SAFETY, 0),
            performance=data.get(DIMENSION_PERFORMANCE, 0),
            maintainability=data.get(DIMENSION_MAINTAINABILITY, 0),
        )

    def get(self, dimension: str) -> int:
        return getattr(self, dimension, 0)

    def items(self):
        return self.to_dict().items()

    def weighted_average(self, weights: Dict[str, float]) -> float:
        """加权平均"""
        total = 0.0
        weight_sum = 0.0
        for dim, score in self.to_dict().items():
            w = weights.get(dim, 1.0)
            total += score * w
            weight_sum += w
        return total / weight_sum if weight_sum > 0 else 0.0

    def simple_average(self) -> float:
        """简单平均"""
        return sum(self.to_dict().values()) / 5.0


# ============================================================
# Judge 模型
# ============================================================
@dataclass
class Judge:
    """Judge 模型实例"""
    judge_id: str = field(default_factory=lambda: _new_id("judge"))
    name: str = ""
    model: str = ""
    weight: float = 1.0
    adapter: str = JudgeAdapterType.MOCK.value
    enabled: bool = True
    specialties: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now_iso)
    total_runs: int = 0
    total_failures: int = 0
    avg_latency_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Judge":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ============================================================
# Judge Report
# ============================================================
@dataclass
class JudgeReport:
    """单个 Judge 的评分报告"""
    report_id: str = field(default_factory=lambda: _new_id("rpt"))
    task_id: str = ""
    judge_id: str = ""
    judge_name: str = ""
    model: str = ""
    scores: JudgeScore = field(default_factory=JudgeScore)
    overall_pass: bool = False
    overall_score: float = 0.0
    issues: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    latency_ms: int = 0
    raw_response: str = ""
    created_at: str = field(default_factory=_now_iso)
    error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "report_id": self.report_id,
            "task_id": self.task_id,
            "judge_id": self.judge_id,
            "judge_name": self.judge_name,
            "model": self.model,
            "scores": self.scores.to_dict(),
            "overall_pass": self.overall_pass,
            "overall_score": self.overall_score,
            "issues": list(self.issues),
            "suggestions": list(self.suggestions),
            "latency_ms": self.latency_ms,
            "raw_response": self.raw_response,
            "created_at": self.created_at,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JudgeReport":
        scores_data = data.get("scores", {}) or {}
        return cls(
            report_id=data.get("report_id", _new_id("rpt")),
            task_id=data.get("task_id", ""),
            judge_id=data.get("judge_id", ""),
            judge_name=data.get("judge_name", ""),
            model=data.get("model", ""),
            scores=JudgeScore.from_dict(scores_data),
            overall_pass=bool(data.get("overall_pass", False)),
            overall_score=float(data.get("overall_score", 0.0)),
            issues=list(data.get("issues", []) or []),
            suggestions=list(data.get("suggestions", []) or []),
            latency_ms=int(data.get("latency_ms", 0)),
            raw_response=data.get("raw_response", ""),
            created_at=data.get("created_at", _now_iso()),
            error=data.get("error", ""),
        )


# ============================================================
# 共识结果
# ============================================================
@dataclass
class JudgeConsensus:
    """多 Judge 共识结果"""
    consensus_id: str = field(default_factory=lambda: _new_id("cons"))
    task_id: str = ""
    aggregated_scores: JudgeScore = field(default_factory=JudgeScore)
    overall_pass: bool = False
    overall_score: float = 0.0
    divergence: Dict[str, float] = field(default_factory=dict)
    needs_review: bool = False
    safety_veto: bool = False
    judge_count: int = 0
    strategy: str = ConsensusStrategy.WEIGHTED_AVERAGE.value
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "consensus_id": self.consensus_id,
            "task_id": self.task_id,
            "aggregated_scores": self.aggregated_scores.to_dict(),
            "overall_pass": self.overall_pass,
            "overall_score": self.overall_score,
            "divergence": dict(self.divergence),
            "needs_review": self.needs_review,
            "safety_veto": self.safety_veto,
            "judge_count": self.judge_count,
            "strategy": self.strategy,
            "created_at": self.created_at,
        }


# ============================================================
# Judge Task
# ============================================================
@dataclass
class JudgeTask:
    """Judge 评分任务"""
    task_id: str = field(default_factory=lambda: _new_id("task"))
    task_description: str = ""
    code_diff: str = ""
    test_results: str = ""
    context: Dict[str, Any] = field(default_factory=dict)
    rubric: List[str] = field(default_factory=lambda: list(DEFAULT_RUBRIC))
    difficulty: str = Difficulty.MEDIUM.value
    domain: str = Domain.GENERAL.value
    use_consensus: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)
    status: str = JudgeTaskStatus.PENDING.value
    created_at: str = field(default_factory=_now_iso)
    started_at: str = ""
    completed_at: str = ""
    error: str = ""
    reports: List[JudgeReport] = field(default_factory=list)
    consensus: Optional[JudgeConsensus] = None
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_description": self.task_description,
            "code_diff": self.code_diff,
            "test_results": self.test_results,
            "context": dict(self.context),
            "rubric": list(self.rubric),
            "difficulty": self.difficulty,
            "domain": self.domain,
            "use_consensus": self.use_consensus,
            "metadata": dict(self.metadata),
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error": self.error,
            "reports": [r.to_dict() for r in self.reports],
            "consensus": self.consensus.to_dict() if self.consensus else None,
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JudgeTask":
        reports_data = data.get("reports", []) or []
        consensus_data = data.get("consensus")
        consensus_obj = None
        if consensus_data:
            # 重建 aggregated_scores 为 JudgeScore 对象
            if isinstance(consensus_data.get("aggregated_scores"), dict):
                consensus_data = dict(consensus_data)
                consensus_data["aggregated_scores"] = JudgeScore.from_dict(
                    consensus_data["aggregated_scores"]
                )
            consensus_obj = JudgeConsensus(
                **{k: v for k, v in consensus_data.items() if k in JudgeConsensus.__dataclass_fields__}
            )
        return cls(
            task_id=data.get("task_id", _new_id("task")),
            task_description=data.get("task_description", ""),
            code_diff=data.get("code_diff", ""),
            test_results=data.get("test_results", ""),
            context=data.get("context", {}) or {},
            rubric=data.get("rubric", list(DEFAULT_RUBRIC)) or list(DEFAULT_RUBRIC),
            difficulty=data.get("difficulty", Difficulty.MEDIUM.value),
            domain=data.get("domain", Domain.GENERAL.value),
            use_consensus=bool(data.get("use_consensus", True)),
            metadata=data.get("metadata", {}) or {},
            status=data.get("status", JudgeTaskStatus.PENDING.value),
            created_at=data.get("created_at", _now_iso()),
            started_at=data.get("started_at", ""),
            completed_at=data.get("completed_at", ""),
            error=data.get("error", ""),
            reports=[JudgeReport.from_dict(r) for r in reports_data],
            consensus=consensus_obj,
            tags=data.get("tags", []) or [],
        )

    def is_terminal(self) -> bool:
        return self.status in (
            JudgeTaskStatus.COMPLETED.value,
            JudgeTaskStatus.FAILED.value,
            JudgeTaskStatus.VETOED.value,
            JudgeTaskStatus.CANCELLED.value,
        )

    def add_report(self, report: JudgeReport) -> None:
        self.reports.append(report)

    def set_consensus(self, consensus: JudgeConsensus) -> None:
        self.consensus = consensus
