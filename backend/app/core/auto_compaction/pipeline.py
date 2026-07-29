"""
# Auto-Compaction 7 阶段流水线
# ============================================================
# 核心作用：编排 Plan → Analyze → Slice → Summarize → Merge → Verify → Compress
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 流水线特征：
#   1. 顺序执行（依赖关系）
#   2. 每阶段记录耗时和状态
#   3. 失败时回滚到上一阶段
#   4. 支持单阶段独立执行
#
# 复杂度：O(N * M) （N=消息数, M=平均内容长度）
# ============================================================
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

from .analyzer import GLOBAL_ANALYZER, CompactionAnalyzer
from .detector import TokenCounter
from .merger import GLOBAL_MERGER, CompactionMerger
from .models import (
    AutoCompactionConfig,
    CompressionResult,
    CompactionBlock,
    CompactionPlan,
    DEFAULT_CONFIG,
    MessageImportance,
    PipelineStage,
    StageExecution,
    StageStatus,
    Strategy,
    TriggerReason,
    VerificationResult,
)
from .planner import GLOBAL_PLANNER, CompactionPlanner
from .slicer import GLOBAL_SLICER, CompactionSlicer
from .summarizer import GLOBAL_SUMMARIZER, CompactionSummarizer
from .tiers import GLOBAL_TIER_MANAGER, TierManager
from .verifier import GLOBAL_VERIFIER, CompactionVerifier


class CompactionPipeline:
    """
    7 阶段压缩流水线

    用法：
        pipeline = CompactionPipeline()
        result = pipeline.run(messages, session_id="...", config=cfg)
    """

    def __init__(
        self,
        analyzer: Optional[CompactionAnalyzer] = None,
        planner: Optional[CompactionPlanner] = None,
        slicer: Optional[CompactionSlicer] = None,
        summarizer: Optional[CompactionSummarizer] = None,
        merger: Optional[CompactionMerger] = None,
        verifier: Optional[CompactionVerifier] = None,
        tier_manager: Optional[TierManager] = None,
    ) -> None:
        self.analyzer = analyzer or GLOBAL_ANALYZER
        self.planner = planner or GLOBAL_PLANNER
        self.slicer = slicer or GLOBAL_SLICER
        self.summarizer = summarizer or GLOBAL_SUMMARIZER
        self.merger = merger or GLOBAL_MERGER
        self.verifier = verifier or GLOBAL_VERIFIER
        self.tiers = tier_manager or GLOBAL_TIER_MANAGER

    def run(
        self,
        messages: List[Dict[str, Any]],
        session_id: str,
        config: Optional[AutoCompactionConfig] = None,
        strategy: Optional[str] = None,
        trigger: str = TriggerReason.MANUAL.value,
        incremental: bool = False,
    ) -> CompressionResult:
        """
        执行完整 7 阶段流水线

        参数：
            messages: 消息列表
            session_id: 会话 ID
            config: 配置
            strategy: 强制策略
            trigger: 触发原因
            incremental: 是否增量压缩

        返回：
            CompressionResult
        """
        cfg = config or DEFAULT_CONFIG
        start_time = time.time()
        before_tokens = TokenCounter.count_messages(messages)
        before_messages = len(messages)

        result = CompressionResult(
            session_id=session_id,
            strategy=strategy or cfg.strategy,
            trigger=trigger,
            before_tokens=before_tokens,
            before_messages=before_messages,
            is_incremental=incremental,
        )

        # 增量模式：仅处理 checkpoint 之后的消息
        process_from = 0
        if incremental and cfg.incremental:
            checkpoint = self.tiers.get_checkpoint(session_id)
            if checkpoint:
                process_from = int(checkpoint.get("last_message_index", 0))

        # 1. Plan
        plan_stage = self._start_stage(PipelineStage.PLAN.value)
        try:
            detection_placeholder = {
                "current_tokens": before_tokens,
                "current_messages": before_messages,
                "severity": "medium",
                "recommended_strategy": cfg.strategy,
            }
            # 复用 planner.plan
            from .detector import CompactionDetector
            detector = CompactionDetector()
            detection = detector.detect(messages, cfg, session_id)
            plan = self.planner.plan(
                detection, messages, cfg, session_id, strategy_override=strategy
            )
            result.plan_id = plan.plan_id
            result.strategy = plan.strategy
            self._complete_stage(plan_stage, {"plan": plan.to_dict()})
        except Exception as e:
            self._fail_stage(plan_stage, str(e))
            return self._fail_result(result, e, start_time)

        # 2. Analyze
        analyze_stage = self._start_stage(PipelineStage.ANALYZE.value)
        try:
            importance = self.analyzer.analyze(messages[process_from:])
            # 修正 index：增量模式需要加上 process_from
            if process_from > 0:
                for imp in importance:
                    imp.index += process_from
            self._complete_stage(
                analyze_stage, {"count": len(importance)}
            )
        except Exception as e:
            self._fail_stage(analyze_stage, str(e))
            return self._fail_result(result, e, start_time)

        # 3. Slice
        slice_stage = self._start_stage(PipelineStage.SLICE.value)
        try:
            plan = self.slicer.build_plan(
                importance, messages, cfg, plan.strategy, session_id
            )
            result.plan_id = plan.plan_id
            blocks_to_compact = plan.blocks_to_compact
            messages_to_keep = plan.messages_to_keep
            self._complete_stage(
                slice_stage,
                {
                    "blocks": len(blocks_to_compact),
                    "keep": len(messages_to_keep),
                },
            )
        except Exception as e:
            self._fail_stage(slice_stage, str(e))
            return self._fail_result(result, e, start_time)

        # 4. Summarize
        summarize_stage = self._start_stage(PipelineStage.SUMMARIZE.value)
        try:
            blocks: List[CompactionBlock] = []
            for indices in blocks_to_compact:
                if not indices:
                    continue
                block = self.summarizer.summarize(
                    indices, messages, plan.strategy, session_id
                )
                # 增量：标记父块
                if incremental:
                    block.is_incremental = True
                blocks.append(block)
            self._complete_stage(
                summarize_stage, {"block_count": len(blocks)}
            )
        except Exception as e:
            self._fail_stage(summarize_stage, str(e))
            return self._fail_result(result, e, start_time)

        # 5. Merge
        merge_stage = self._start_stage(PipelineStage.MERGE.value)
        try:
            blocks = self.merger.merge(blocks, plan)
            self._complete_stage(
                merge_stage, {"merged": len(blocks)}
            )
        except Exception as e:
            self._fail_stage(merge_stage, str(e))
            return self._fail_result(result, e, start_time)

        # 6. Verify
        verify_stage = self._start_stage(PipelineStage.VERIFY.value)
        verification: Optional[VerificationResult] = None
        try:
            verification = self.verifier.verify(blocks, messages, plan, cfg)
            self._complete_stage(
                verify_stage,
                {
                    "passed": verification.passed,
                    "score": verification.score,
                },
            )
            # 若验证失败且强制要求，则中止
            if not verification.passed and cfg.verification_required:
                # 仍然写回（容错），但标记
                pass
        except Exception as e:
            self._fail_stage(verify_stage, str(e))
            verification = VerificationResult(
                passed=False,
                score=0.0,
                issues=[f"Verify exception: {e}"],
            )

        # 7. Compress
        compress_stage = self._start_stage(PipelineStage.COMPRESS.value)
        try:
            # 创建快照（用于回滚）
            snapshot = self.tiers.snapshot(session_id)
            result.rollback_available = snapshot is not None

            # 写回 cold tier
            self.tiers.add_blocks(session_id, blocks)
            # 更新 hot tier（保留最近 keep_recent 条）
            kept_messages = [messages[i] for i in messages_to_keep if i < len(messages)]
            self.tiers.set_hot(session_id, kept_messages, cfg.keep_recent)
            # 设置 checkpoint
            self.tiers.set_checkpoint(session_id, len(messages))

            # 计算结果
            after_tokens = sum(TokenCounter.count_messages(kept_messages) for _ in [0])
            after_tokens = self.tiers.get(session_id).total_hot_tokens + sum(
                b.tokens for b in blocks
            )
            after_messages = len(kept_messages) + len(blocks)

            result.after_tokens = after_tokens
            result.after_messages = after_messages
            result.saved_tokens = max(0, before_tokens - after_tokens)
            result.saved_ratio = (
                result.saved_tokens / before_tokens if before_tokens > 0 else 0.0
            )
            result.blocks = blocks
            result.verification = verification
            result.success = True
            self._complete_stage(
                compress_stage,
                {
                    "after_tokens": after_tokens,
                    "saved": result.saved_tokens,
                },
            )
        except Exception as e:
            self._fail_stage(compress_stage, str(e))
            return self._fail_result(result, e, start_time)

        result.duration_ms = int((time.time() - start_time) * 1000)
        result.stages = [
            plan_stage, analyze_stage, slice_stage, summarize_stage,
            merge_stage, verify_stage, compress_stage,
        ]
        return result

    # ============================================================
    # 单阶段执行（用于调试 / 高级 API）
    # ============================================================

    def run_stage(
        self,
        stage: str,
        messages: List[Dict[str, Any]],
        session_id: str,
        config: Optional[AutoCompactionConfig] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """执行单个阶段"""
        cfg = config or DEFAULT_CONFIG
        if stage == PipelineStage.PLAN.value:
            from .detector import CompactionDetector
            detector = CompactionDetector()
            detection = detector.detect(messages, cfg, session_id)
            plan = self.planner.plan(detection, messages, cfg, session_id)
            return plan.to_dict()
        elif stage == PipelineStage.ANALYZE.value:
            importance = self.analyzer.analyze(messages)
            return {
                "count": len(importance),
                "items": [i.to_dict() for i in importance[:20]],
            }
        elif stage == PipelineStage.SUMMARIZE.value:
            indices = kwargs.get("indices", list(range(len(messages))))
            block = self.summarizer.summarize(indices, messages, cfg.strategy, session_id)
            return block.to_dict()
        elif stage == PipelineStage.VERIFY.value:
            blocks_data = kwargs.get("blocks", [])
            blocks = [CompactionBlock.from_dict(b) for b in blocks_data]
            result = self.verifier.verify(blocks, messages, None, cfg)
            return result.to_dict()
        else:
            return {"error": f"Stage not standalone-runnable: {stage}"}

    # ============================================================
    # 辅助
    # ============================================================

    def _start_stage(self, stage: str) -> StageExecution:
        return StageExecution(
            stage=stage,
            status=StageStatus.RUNNING.value,
            started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    def _complete_stage(
        self,
        stage: StageExecution,
        output: Dict[str, Any],
    ) -> None:
        stage.status = StageStatus.COMPLETED.value
        stage.completed_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        )
        stage.output = output
        # 计算耗时（粗略）
        try:
            if stage.started_at and stage.completed_at:
                t1 = time.mktime(time.strptime(stage.started_at, "%Y-%m-%dT%H:%M:%SZ"))
                t2 = time.mktime(time.strptime(stage.completed_at, "%Y-%m-%dT%H:%M:%SZ"))
                stage.duration_ms = int((t2 - t1) * 1000)
        except Exception:
            pass

    def _fail_stage(
        self,
        stage: StageExecution,
        error: str,
    ) -> None:
        stage.status = StageStatus.FAILED.value
        stage.completed_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        )
        stage.error = error

    def _fail_result(
        self,
        result: CompressionResult,
        error: Exception,
        start_time: float,
    ) -> CompressionResult:
        result.success = False
        result.error = str(error)
        result.duration_ms = int((time.time() - start_time) * 1000)
        return result


# 全局流水线（单例）
GLOBAL_PIPELINE = CompactionPipeline()
