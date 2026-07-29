"""
# Auto-Compaction 计划器（Plan 阶段）
# ============================================================
# 核心作用：根据检测结果和配置生成压缩计划
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 计划内容：
#   1. 选择压缩策略
#   2. 设定目标 token 数
#   3. 设定 keep_recent 数量
#   4. 评估风险与收益
#
# 复杂度：O(1)
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .detector import TokenCounter
from .models import (
    AutoCompactionConfig,
    DEFAULT_CONFIG,
    CompactionPlan,
    DetectionResult,
    Strategy,
    TriggerReason,
)


class CompactionPlanner:
    """
    压缩计划器
    用法：
        planner = CompactionPlanner()
        plan = planner.plan(detection, messages, config)
    """

    def plan(
        self,
        detection: DetectionResult,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        session_id: str = "",
        strategy_override: Optional[str] = None,
    ) -> CompactionPlan:
        """
        生成压缩计划

        参数：
            detection: 检测结果
            messages: 当前消息列表
            config: 配置
            session_id: 会话 ID
            strategy_override: 强制策略

        返回：
            CompactionPlan（不含具体分块，由 Slicer 阶段填充）
        """
        cfg = config or DEFAULT_CONFIG
        n = len(messages)
        current_tokens = detection.current_tokens

        # 1. 选择策略
        strategy = strategy_override or detection.recommended_strategy
        if strategy not in {s.value for s in Strategy}:
            strategy = cfg.strategy

        # 2. 设定 keep_recent（根据严重程度动态调整）
        keep_recent = cfg.keep_recent
        if detection.severity == "critical":
            keep_recent = max(5, cfg.keep_recent // 2)  # 激进压缩
        elif detection.severity == "low":
            keep_recent = cfg.keep_recent + 5  # 保留更多

        # 3. 计算目标 token
        target_tokens = cfg.target_tokens
        if current_tokens > cfg.max_tokens * 2:
            target_tokens = min(target_tokens, current_tokens // 3)
        elif current_tokens > cfg.max_tokens * 1.5:
            target_tokens = min(target_tokens, current_tokens // 2)

        # 4. 估算 before / after
        estimated_before = current_tokens
        if strategy == Strategy.TRUNCATE.value:
            # 截断：保留最近 keep_recent
            keep_indices = list(range(max(0, n - keep_recent), n))
            estimated_after = sum(
                TokenCounter.count_messages([messages[i]])
                for i in keep_indices
            )
            blocks = [list(range(0, max(0, n - keep_recent)))]
            confidence = 0.95
            notes = [
                f"truncate: keep {keep_recent} recent",
                f"target={target_tokens}",
            ]
        else:
            # 摘要：保留最近 + 摘要中间
            keep_indices = list(range(max(0, n - keep_recent), n))
            keep_tokens = sum(
                TokenCounter.count_messages([messages[i]])
                for i in keep_indices
            )
            # 估算摘要 token（中间部分压缩到 1/4）
            middle_count = max(0, n - keep_recent)
            estimated_after = keep_tokens + (current_tokens - keep_tokens) // 4
            blocks = [[]]  # 占位，由 Slicer 填充
            confidence = 0.7
            notes = [
                f"{strategy}: keep {keep_recent} recent + summarize middle",
                f"target={target_tokens}",
            ]

        # 5. 评估风险
        if detection.severity == "critical":
            confidence -= 0.1
            notes.append("high risk: critical severity")
        if current_tokens > 100_000:
            confidence -= 0.1
            notes.append("high risk: very large context")

        confidence = max(0.3, min(1.0, confidence))

        return CompactionPlan(
            session_id=session_id,
            strategy=strategy,
            blocks_to_compact=blocks,
            messages_to_keep=list(range(max(0, n - keep_recent), n)),
            estimated_before_tokens=estimated_before,
            estimated_after_tokens=estimated_after,
            confidence=round(confidence, 3),
            notes=notes,
        )


# 全局计划器（单例）
GLOBAL_PLANNER = CompactionPlanner()
