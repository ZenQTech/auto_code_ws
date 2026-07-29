"""
# Auto-Compaction 数据模型
# ============================================================
# 核心作用：定义 Auto-Compaction 引擎的所有数据结构
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 数据流：
#   消息流入 → Detector → Plan → Analyze → Slice → Summarize
#            → Merge → Verify → Compress → 写回会话
#
# 模型清单：
#   - 枚举：Strategy、StageStatus、TriggerReason
#   - 配置：AutoCompactionConfig
#   - 重要性：MessageImportance
#   - Plan：CompactionPlan
#   - 块：CompactionBlock
#   - 分层：CompactionTier
#   - 结果：CompressionResult、VerificationResult
# ============================================================
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    """获取当前 ISO 时间戳"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_id(prefix: str) -> str:
    """生成唯一 ID"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ============================================================
# 枚举
# ============================================================

class Strategy(str, Enum):
    """压缩策略"""
    TRUNCATE = "truncate"     # 直接截断
    SUMMARIZE = "summarize"   # 全文摘要
    HYBRID = "hybrid"         # 混合（部分保留 + 摘要）
    SEMANTIC = "semantic"     # 语义压缩（按主题）


class StageStatus(str, Enum):
    """流水线阶段状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class TriggerReason(str, Enum):
    """触发原因"""
    TOKEN_THRESHOLD = "token_threshold"
    MESSAGE_THRESHOLD = "message_threshold"
    GROWTH_RATE = "growth_rate"
    MANUAL = "manual"
    SCHEDULED = "scheduled"
    INCREMENTAL = "incremental"


class PipelineStage(str, Enum):
    """流水线阶段名"""
    PLAN = "plan"
    ANALYZE = "analyze"
    SLICE = "slice"
    SUMMARIZE = "summarize"
    MERGE = "merge"
    VERIFY = "verify"
    COMPRESS = "compress"


# ============================================================
# 配置
# ============================================================

@dataclass
class AutoCompactionConfig:
    """Auto-Compaction 全局配置"""
    enabled: bool = True
    max_tokens: int = 50_000          # token 阈值
    max_messages: int = 50            # 消息数阈值
    target_tokens: int = 20_000       # 压缩后目标
    keep_recent: int = 10             # hot tier 保留消息数
    strategy: str = Strategy.HYBRID.value
    importance_threshold: float = 0.3 # 重要性阈值
    verification_required: bool = True
    auto_trigger: bool = True
    growth_rate_threshold: float = 0.5  # 增长率阈值（每轮新增 token 比例）
    incremental: bool = True          # 是否启用增量
    min_block_tokens: int = 500       # 最小压缩块 token
    max_block_tokens: int = 5000      # 最大压缩块 token
    verification_min_score: float = 0.6  # 验证最低分

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "max_tokens": self.max_tokens,
            "max_messages": self.max_messages,
            "target_tokens": self.target_tokens,
            "keep_recent": self.keep_recent,
            "strategy": self.strategy,
            "importance_threshold": self.importance_threshold,
            "verification_required": self.verification_required,
            "auto_trigger": self.auto_trigger,
            "growth_rate_threshold": self.growth_rate_threshold,
            "incremental": self.incremental,
            "min_block_tokens": self.min_block_tokens,
            "max_block_tokens": self.max_block_tokens,
            "verification_min_score": self.verification_min_score,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AutoCompactionConfig":
        return cls(
            enabled=bool(data.get("enabled", True)),
            max_tokens=int(data.get("max_tokens", 50_000)),
            max_messages=int(data.get("max_messages", 50)),
            target_tokens=int(data.get("target_tokens", 20_000)),
            keep_recent=int(data.get("keep_recent", 10)),
            strategy=str(data.get("strategy", Strategy.HYBRID.value)),
            importance_threshold=float(data.get("importance_threshold", 0.3)),
            verification_required=bool(data.get("verification_required", True)),
            auto_trigger=bool(data.get("auto_trigger", True)),
            growth_rate_threshold=float(data.get("growth_rate_threshold", 0.5)),
            incremental=bool(data.get("incremental", True)),
            min_block_tokens=int(data.get("min_block_tokens", 500)),
            max_block_tokens=int(data.get("max_block_tokens", 5000)),
            verification_min_score=float(data.get("verification_min_score", 0.6)),
        )


DEFAULT_CONFIG = AutoCompactionConfig()


# ============================================================
# 重要性评估
# ============================================================

@dataclass
class MessageImportance:
    """单条消息的重要性评估"""
    index: int
    role: str
    content: str
    score: float = 0.0            # 综合重要性 0-1
    factors: Dict[str, float] = field(default_factory=dict)  # 各维度分数
    decision_keywords: List[str] = field(default_factory=list)
    is_decision: bool = False
    is_code_block: bool = False
    is_user_preference: bool = False
    token_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "role": self.role,
            "score": self.score,
            "factors": self.factors,
            "decision_keywords": self.decision_keywords,
            "is_decision": self.is_decision,
            "is_code_block": self.is_code_block,
            "is_user_preference": self.is_user_preference,
            "token_count": self.token_count,
            "content_preview": self.content[:200] if self.content else "",
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MessageImportance":
        return cls(
            index=int(data.get("index", 0)),
            role=str(data.get("role", "")),
            content=str(data.get("content", "")),
            score=float(data.get("score", 0.0)),
            factors=dict(data.get("factors", {})),
            decision_keywords=list(data.get("decision_keywords", [])),
            is_decision=bool(data.get("is_decision", False)),
            is_code_block=bool(data.get("is_code_block", False)),
            is_user_preference=bool(data.get("is_user_preference", False)),
            token_count=int(data.get("token_count", 0)),
        )


# ============================================================
# 压缩计划
# ============================================================

@dataclass
class CompactionPlan:
    """压缩计划（Plan 阶段产物）"""
    plan_id: str = field(default_factory=lambda: _new_id("plan"))
    session_id: str = ""
    strategy: str = Strategy.HYBRID.value
    blocks_to_compact: List[List[int]] = field(default_factory=list)  # 消息索引分组
    messages_to_keep: List[int] = field(default_factory=list)
    estimated_before_tokens: int = 0
    estimated_after_tokens: int = 0
    confidence: float = 0.0
    notes: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "session_id": self.session_id,
            "strategy": self.strategy,
            "blocks_to_compact": self.blocks_to_compact,
            "messages_to_keep": self.messages_to_keep,
            "estimated_before_tokens": self.estimated_before_tokens,
            "estimated_after_tokens": self.estimated_after_tokens,
            "estimated_savings": max(0, self.estimated_before_tokens - self.estimated_after_tokens),
            "confidence": self.confidence,
            "notes": self.notes,
            "created_at": self.created_at,
        }


# ============================================================
# 压缩块（cold tier 单元）
# ============================================================

@dataclass
class CompactionBlock:
    """压缩块（Cold tier 中的一个摘要单元）"""
    block_id: str = field(default_factory=lambda: _new_id("block"))
    session_id: str = ""
    message_indices: List[int] = field(default_factory=list)
    tokens: int = 0
    original_tokens: int = 0
    summary: str = ""
    key_points: List[str] = field(default_factory=list)
    keywords: List[str] = field(default_factory=list)
    strategy: str = Strategy.SUMMARIZE.value
    created_at: str = field(default_factory=_now_iso)
    is_incremental: bool = False
    parent_block_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "block_id": self.block_id,
            "session_id": self.session_id,
            "message_indices": self.message_indices,
            "tokens": self.tokens,
            "original_tokens": self.original_tokens,
            "summary": self.summary,
            "key_points": self.key_points,
            "keywords": self.keywords,
            "strategy": self.strategy,
            "created_at": self.created_at,
            "is_incremental": self.is_incremental,
            "parent_block_id": self.parent_block_id,
            "compression_ratio": round(self.original_tokens / max(1, self.tokens), 2),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CompactionBlock":
        return cls(
            block_id=str(data.get("block_id", _new_id("block"))),
            session_id=str(data.get("session_id", "")),
            message_indices=list(data.get("message_indices", [])),
            tokens=int(data.get("tokens", 0)),
            original_tokens=int(data.get("original_tokens", 0)),
            summary=str(data.get("summary", "")),
            key_points=list(data.get("key_points", [])),
            keywords=list(data.get("keywords", [])),
            strategy=str(data.get("strategy", Strategy.SUMMARIZE.value)),
            created_at=str(data.get("created_at", _now_iso())),
            is_incremental=bool(data.get("is_incremental", False)),
            parent_block_id=data.get("parent_block_id"),
        )


# ============================================================
# 冷热分层
# ============================================================

@dataclass
class CompactionTier:
    """会话冷热分层状态"""
    session_id: str = ""
    hot: List[Dict[str, Any]] = field(default_factory=list)        # 活跃消息
    cold: List[CompactionBlock] = field(default_factory=list)     # 归档块
    cold_index: Dict[str, List[str]] = field(default_factory=dict)  # keyword -> block_ids
    total_hot_tokens: int = 0
    total_cold_tokens: int = 0
    last_compaction_at: Optional[str] = None
    last_plan: Optional[Dict[str, Any]] = None
    checkpoint: Optional[Dict[str, Any]] = None  # 增量压缩起点

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "hot_count": len(self.hot),
            "cold_count": len(self.cold),
            "total_hot_tokens": self.total_hot_tokens,
            "total_cold_tokens": self.total_cold_tokens,
            "total_tokens": self.total_hot_tokens + self.total_cold_tokens,
            "last_compaction_at": self.last_compaction_at,
            "last_plan": self.last_plan,
            "checkpoint": self.checkpoint,
            "indexed_keywords": len(self.cold_index),
            "hot_preview": [m.get("content", "")[:80] for m in self.hot[-3:]],
        }


# ============================================================
# 验证结果
# ============================================================

@dataclass
class VerificationResult:
    """Verify 阶段产物"""
    passed: bool = False
    score: float = 0.0
    checks: Dict[str, bool] = field(default_factory=dict)
    missing: List[str] = field(default_factory=list)
    issues: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    verified_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "score": self.score,
            "checks": self.checks,
            "missing": self.missing,
            "issues": self.issues,
            "suggestions": self.suggestions,
            "verified_at": self.verified_at,
        }


# ============================================================
# 阶段执行记录
# ============================================================

@dataclass
class StageExecution:
    """单个阶段的执行记录"""
    stage: str
    status: str = StageStatus.PENDING.value
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: int = 0
    error: Optional[str] = None
    output: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage,
            "status": self.status,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "output": self.output,
        }


# ============================================================
# 整体压缩结果
# ============================================================

@dataclass
class CompressionResult:
    """完整压缩结果（7 阶段流水线最终输出）"""
    session_id: str = ""
    plan_id: str = ""
    success: bool = False
    strategy: str = Strategy.HYBRID.value
    trigger: str = TriggerReason.MANUAL.value
    before_tokens: int = 0
    after_tokens: int = 0
    saved_tokens: int = 0
    saved_ratio: float = 0.0
    before_messages: int = 0
    after_messages: int = 0
    blocks: List[CompactionBlock] = field(default_factory=list)
    verification: Optional[VerificationResult] = None
    stages: List[StageExecution] = field(default_factory=list)
    duration_ms: int = 0
    error: Optional[str] = None
    rollback_available: bool = False
    created_at: str = field(default_factory=_now_iso)
    is_incremental: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "plan_id": self.plan_id,
            "success": self.success,
            "strategy": self.strategy,
            "trigger": self.trigger,
            "before_tokens": self.before_tokens,
            "after_tokens": self.after_tokens,
            "saved_tokens": self.saved_tokens,
            "saved_ratio": round(self.saved_ratio, 4),
            "before_messages": self.before_messages,
            "after_messages": self.after_messages,
            "block_count": len(self.blocks),
            "blocks": [b.to_dict() for b in self.blocks],
            "verification": self.verification.to_dict() if self.verification else None,
            "stages": [s.to_dict() for s in self.stages],
            "duration_ms": self.duration_ms,
            "error": self.error,
            "rollback_available": self.rollback_available,
            "created_at": self.created_at,
            "is_incremental": self.is_incremental,
        }


# ============================================================
# 检测结果
# ============================================================

@dataclass
class DetectionResult:
    """自动检测结果"""
    needs_compaction: bool = False
    reason: str = ""
    current_tokens: int = 0
    current_messages: int = 0
    threshold_tokens: int = 0
    threshold_messages: int = 0
    growth_rate: float = 0.0
    severity: str = "low"  # low | medium | high | critical
    recommended_strategy: str = Strategy.HYBRID.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "needs_compaction": self.needs_compaction,
            "reason": self.reason,
            "current_tokens": self.current_tokens,
            "current_messages": self.current_messages,
            "threshold_tokens": self.threshold_tokens,
            "threshold_messages": self.threshold_messages,
            "growth_rate": round(self.growth_rate, 4),
            "severity": self.severity,
            "recommended_strategy": self.recommended_strategy,
        }
