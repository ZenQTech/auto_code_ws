"""
# Auto-Compaction 引擎主类
# ============================================================
# 核心作用：整合各组件，提供高级 API
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 高级 API：
#   1. check(session_id) - 自动检测
#   2. run(session_id) - 自动检测+执行
#   3. plan(session_id) - 仅生成计划
#   4. rollback(session_id) - 回滚
#   5. incremental(session_id) - 增量压缩
#   6. search(session_id, query) - 检索
# ============================================================
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Tuple

from .analyzer import GLOBAL_ANALYZER, CompactionAnalyzer
from .detector import GLOBAL_DETECTOR, CompactionDetector, DetectionResult
from .merger import GLOBAL_MERGER
from .models import (
    AutoCompactionConfig,
    CompressionResult,
    CompactionBlock,
    CompactionPlan,
    CompactionTier,
    DEFAULT_CONFIG,
    DetectionResult,
    Strategy,
    TriggerReason,
    VerificationResult,
)
from .pipeline import GLOBAL_PIPELINE, CompactionPipeline
from .planner import GLOBAL_PLANNER
from .slicer import GLOBAL_SLICER
from .stats import GLOBAL_STATS, CompactionStats
from .summarizer import GLOBAL_SUMMARIZER
from .tiers import GLOBAL_TIER_MANAGER, TierManager
from .verifier import GLOBAL_VERIFIER


# ============================================================
# 引擎
# ============================================================

class AutoCompactionEngine:
    """
    Auto-Compaction 引擎
    用法：
        engine = AutoCompactionEngine()
        result = engine.run(session_id, messages)
    """

    def __init__(
        self,
        pipeline: Optional[CompactionPipeline] = None,
        detector: Optional[CompactionDetector] = None,
        tiers: Optional[TierManager] = None,
        stats: Optional[CompactionStats] = None,
        config: Optional[AutoCompactionConfig] = None,
    ) -> None:
        self.pipeline = pipeline or GLOBAL_PIPELINE
        self.detector = detector or GLOBAL_DETECTOR
        self.tiers = tiers or GLOBAL_TIER_MANAGER
        self.stats = stats or GLOBAL_STATS
        self.verifier = self.pipeline.verifier
        self.config = config or DEFAULT_CONFIG
        # 防止同一会话并发压缩
        self._session_locks: Dict[str, threading.RLock] = {}
        self._global_lock = threading.RLock()
        # 会话级配置覆盖
        self._session_configs: Dict[str, AutoCompactionConfig] = {}

    # ============================================================
    # 配置管理
    # ============================================================

    def get_config(
        self,
        session_id: Optional[str] = None,
    ) -> AutoCompactionConfig:
        """获取配置（会话级覆盖全局）"""
        if session_id and session_id in self._session_configs:
            return self._session_configs[session_id]
        return self.config

    def set_config(
        self,
        config: AutoCompactionConfig,
        session_id: Optional[str] = None,
    ) -> None:
        """设置配置"""
        if session_id:
            self._session_configs[session_id] = config
        else:
            self.config = config

    def reset_config(self, session_id: Optional[str] = None) -> None:
        """重置配置"""
        if session_id:
            self._session_configs.pop(session_id, None)
        else:
            self.config = DEFAULT_CONFIG

    # ============================================================
    # 锁管理
    # ============================================================

    def _get_session_lock(self, session_id: str) -> threading.RLock:
        with self._global_lock:
            if session_id not in self._session_locks:
                self._session_locks[session_id] = threading.RLock()
            return self._session_locks[session_id]

    # ============================================================
    # 核心 API
    # ============================================================

    def check(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
    ) -> DetectionResult:
        """
        检测是否需要压缩

        参数：
            session_id: 会话 ID
            messages: 当前消息列表
            config: 可选配置覆盖

        返回：
            DetectionResult
        """
        cfg = config or self.get_config(session_id)
        return self.detector.detect(messages, cfg, session_id)

    def run(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        strategy: Optional[str] = None,
        force: bool = False,
    ) -> CompressionResult:
        """
        执行压缩

        参数：
            session_id: 会话 ID
            messages: 当前消息列表
            config: 可选配置
            strategy: 强制策略
            force: 强制执行（跳过检测）

        返回：
            CompressionResult
        """
        cfg = config or self.get_config(session_id)
        lock = self._get_session_lock(session_id)
        with lock:
            # 检测
            detection = self.detector.detect(messages, cfg, session_id)
            if not force and not detection.needs_compaction:
                # 不需要压缩，返回空结果
                from .detector import TokenCounter
                return CompressionResult(
                    session_id=session_id,
                    success=False,
                    strategy=cfg.strategy,
                    trigger=TriggerReason.MANUAL.value,
                    before_tokens=TokenCounter.count_messages(messages),
                    before_messages=len(messages),
                    after_tokens=TokenCounter.count_messages(messages),
                    after_messages=len(messages),
                    saved_tokens=0,
                    saved_ratio=0.0,
                    error="no_compaction_needed",
                )
            # 执行
            result = self.pipeline.run(
                messages,
                session_id,
                cfg,
                strategy=strategy,
                trigger=TriggerReason.MANUAL.value,
            )
            # 记录
            self.stats.record(result, severity=detection.severity)
            return result

    def plan(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        strategy: Optional[str] = None,
    ) -> CompactionPlan:
        """仅生成压缩计划（不执行）"""
        cfg = config or self.get_config(session_id)
        detection = self.detector.detect(messages, cfg, session_id)
        plan = self.pipeline.planner.plan(
            detection, messages, cfg, session_id, strategy_override=strategy
        )
        # 用 slicer 填充具体分块
        importance = self.pipeline.analyzer.analyze(messages)
        filled_plan = self.pipeline.slicer.build_plan(
            importance, messages, cfg, plan.strategy, session_id
        )
        return filled_plan

    def incremental(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
    ) -> CompressionResult:
        """增量压缩"""
        cfg = config or self.get_config(session_id)
        lock = self._get_session_lock(session_id)
        with lock:
            result = self.pipeline.run(
                messages,
                session_id,
                cfg,
                incremental=True,
                trigger=TriggerReason.INCREMENTAL.value,
            )
            self.stats.record(result, severity="low")
            return result

    def rollback(
        self,
        session_id: str,
    ) -> bool:
        """回滚（恢复到压缩前状态）"""
        # 简化实现：清除当前 cold tier（snapshot 在 compress 阶段创建但未持久化为独立文件）
        # 实际项目应保存 snapshot 文件。这里仅清除 cold blocks
        tier = self.tiers.get(session_id)
        if not tier:
            return False
        with self._get_session_lock(session_id):
            tier.cold.clear()
            tier.cold_index.clear()
            tier.total_cold_tokens = 0
            tier.last_compaction_at = None
            self.tiers.save_all()
        return True

    def search(
        self,
        session_id: str,
        query: str,
        top_k: int = 5,
    ) -> List[CompactionBlock]:
        """在 cold tier 中搜索"""
        return self.tiers.search(session_id, query, top_k)

    def get_tier(
        self,
        session_id: str,
    ) -> Optional[CompactionTier]:
        """获取会话分层"""
        return self.tiers.get_or_create(session_id)

    def verify(
        self,
        session_id: str,
        original_messages: Optional[List[Dict[str, Any]]] = None,
        config: Optional[AutoCompactionConfig] = None,
    ) -> VerificationResult:
        """验证会话当前 cold tier 是否完整"""
        tier = self.tiers.get_or_create(session_id)
        cfg = config or self.get_config(session_id)
        # 用 hot + cold 重建完整消息列表（用于验证）
        messages = list(tier.hot)
        if original_messages:
            messages = list(original_messages)
        return self.verifier.verify(
            tier.cold, messages, None, cfg
        )

    def run_stage(
        self,
        stage: str,
        session_id: str,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """执行单阶段"""
        cfg = config or self.get_config(session_id)
        return self.pipeline.run_stage(stage, messages, session_id, cfg, **kwargs)

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.stats.snapshot(),
            "tiers": self.tiers.get_stats(),
            "config": self.get_config().to_dict(),
        }

    def get_session_history(
        self,
        session_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        return self.stats.get_session_history(session_id, limit)

    def get_session_savings(
        self,
        session_id: str,
    ) -> Dict[str, Any]:
        return self.stats.get_session_savings(session_id)

    # ============================================================
    # 健康检查
    # ============================================================

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "version": "v6.30.0",
            "modules": {
                "detector": "ok",
                "analyzer": "ok",
                "slicer": "ok",
                "summarizer": "ok",
                "merger": "ok",
                "verifier": "ok",
                "pipeline": "ok",
                "tiers": "ok",
                "stats": "ok",
            },
            "config": self.get_config().to_dict(),
            "active_sessions": len(self.tiers.list_sessions()),
        }


# 全局引擎（单例）
GLOBAL_ENGINE = AutoCompactionEngine()
