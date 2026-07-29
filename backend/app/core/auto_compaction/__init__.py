"""
# Auto-Compaction 引擎
# ============================================================
# 7 阶段自动压缩流水线：
#   Plan → Analyze → Slice → Summarize → Merge → Verify → Compress
#
# 特性：
#   - 自动检测 token/消息数/增长率触发
#   - 冷热分层（hot tier + cold tier）
#   - 增量压缩（仅处理新增消息）
#   - 4 种策略：truncate / summarize / hybrid / semantic
#   - 关键信息保留验证
#   - 完整统计与监控
#
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
# ============================================================
"""

from .analyzer import (
    DECISION_KEYWORDS,
    USER_PREFERENCE_KEYWORDS,
    CompactionAnalyzer,
    GLOBAL_ANALYZER,
)
from .detector import CompactionDetector, GLOBAL_DETECTOR, TokenCounter
from .engine import AutoCompactionEngine, GLOBAL_ENGINE
from .merger import CompactionMerger, GLOBAL_MERGER
from .models import (
    DEFAULT_CONFIG,
    AutoCompactionConfig,
    CompactionBlock,
    CompactionPlan,
    CompactionTier,
    CompressionResult,
    DetectionResult,
    MessageImportance,
    PipelineStage,
    StageExecution,
    StageStatus,
    Strategy,
    TriggerReason,
    VerificationResult,
)
from .pipeline import CompactionPipeline, GLOBAL_PIPELINE
from .planner import CompactionPlanner, GLOBAL_PLANNER
from .slicer import CompactionSlicer, GLOBAL_SLICER
from .stats import CompactionStats, GLOBAL_STATS
from .summarizer import CompactionSummarizer, GLOBAL_SUMMARIZER
from .tiers import GLOBAL_TIER_MANAGER, TierManager
from .verifier import CompactionVerifier, GLOBAL_VERIFIER


__all__ = [
    # 模块类
    "AutoCompactionEngine",
    "CompactionAnalyzer",
    "CompactionBlock",
    "CompactionDetector",
    "CompactionMerger",
    "CompactionPipeline",
    "CompactionPlan",
    "CompactionPlanner",
    "CompactionSlicer",
    "CompactionStats",
    "CompactionSummarizer",
    "CompactionTier",
    "CompactionVerifier",
    "CompressionResult",
    "DetectionResult",
    "MessageImportance",
    "StageExecution",
    "TierManager",
    "TokenCounter",
    "VerificationResult",
    # 配置
    "AutoCompactionConfig",
    "DEFAULT_CONFIG",
    # 枚举
    "PipelineStage",
    "StageStatus",
    "Strategy",
    "TriggerReason",
    # 关键词
    "DECISION_KEYWORDS",
    "USER_PREFERENCE_KEYWORDS",
    # 全局单例
    "GLOBAL_ENGINE",
    "GLOBAL_DETECTOR",
    "GLOBAL_ANALYZER",
    "GLOBAL_PLANNER",
    "GLOBAL_SLICER",
    "GLOBAL_SUMMARIZER",
    "GLOBAL_MERGER",
    "GLOBAL_VERIFIER",
    "GLOBAL_PIPELINE",
    "GLOBAL_TIER_MANAGER",
    "GLOBAL_STATS",
]
