"""
# Auto-Compaction 分块器（Slice 阶段）
# ============================================================
# 核心作用：根据重要性分数和 token 预算，把消息分成 keep / compact 块
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 策略：
#   1. 强制保留：system 消息 + keep_recent 条最新消息 + 决策/代码/偏好
#   2. 滑动窗口：在 keep_recent 之外的连续低重要性消息归入压缩块
#   3. 块大小限制：min_block_tokens ~ max_block_tokens
#
# 输出：blocks_to_compact, messages_to_keep
# 复杂度：O(N)
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .models import (
    AutoCompactionConfig,
    DEFAULT_CONFIG,
    CompactionPlan,
    MessageImportance,
    Strategy,
)
from .detector import TokenCounter


class CompactionSlicer:
    """
    压缩分块器
    用法：
        slicer = CompactionSlicer()
        blocks_to_compact, messages_to_keep = slicer.slice(importance, messages, config)
    """

    def slice(
        self,
        importance: List[MessageImportance],
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
    ) -> Tuple[List[List[int]], List[int]]:
        """
        分块

        参数：
            importance: 重要性分析结果
            messages: 原始消息
            config: 配置

        返回：
            (blocks_to_compact, messages_to_keep)
        """
        cfg = config or DEFAULT_CONFIG
        n = len(importance)
        if n == 0:
            return [], []

        # 1. 强制保留集合
        keep_set = set()
        # - system 消息
        for imp in importance:
            if imp.role == "system":
                keep_set.add(imp.index)
        # - 最近 N 条
        for i in range(max(0, n - cfg.keep_recent), n):
            keep_set.add(i)
        # - 高重要性消息（决策 / 代码 / 用户偏好）
        for imp in importance:
            if imp.is_decision or imp.is_code_block or imp.is_user_preference:
                if imp.score >= cfg.importance_threshold:
                    keep_set.add(imp.index)

        # 2. 找出可压缩的连续区间
        candidates = [i for i in range(n) if i not in keep_set]
        if not candidates:
            return [], sorted(keep_set)

        # 3. 按 token 预算分块
        blocks: List[List[int]] = []
        current_block: List[int] = []
        current_tokens = 0

        for idx in candidates:
            msg = messages[idx]
            tokens = TokenCounter.count_messages([msg])
            # 如果当前块已有内容且加上新消息会超过 max_block_tokens
            if current_block and current_tokens + tokens > cfg.max_block_tokens:
                if current_tokens >= cfg.min_block_tokens:
                    blocks.append(current_block)
                    current_block = []
                    current_tokens = 0
                else:
                    # 块太小，强制提交（不强制，但允许）
                    pass
            current_block.append(idx)
            current_tokens += tokens

        # 收尾
        if current_block:
            if current_tokens >= cfg.min_block_tokens:
                blocks.append(current_block)
            else:
                # 最后一个小块：并入前一个或单成一块
                if blocks:
                    blocks[-1].extend(current_block)
                else:
                    blocks.append(current_block)

        # 4. 进一步合并：若块数过多则两两合并
        if len(blocks) > 20:
            blocks = self._merge_blocks(blocks, cfg)

        return blocks, sorted(keep_set)

    def _merge_blocks(
        self,
        blocks: List[List[int]],
        cfg: AutoCompactionConfig,
    ) -> List[List[int]]:
        """合并过小的块"""
        if not blocks:
            return blocks
        merged: List[List[int]] = [blocks[0]]
        for block in blocks[1:]:
            if len(merged[-1]) + len(block) <= 50:
                merged[-1].extend(block)
            else:
                merged.append(block)
        return merged

    def build_plan(
        self,
        importance: List[MessageImportance],
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        strategy: Optional[str] = None,
        session_id: str = "",
    ) -> CompactionPlan:
        """
        构建压缩计划

        参数：
            importance: 重要性分析结果
            messages: 原始消息
            config: 配置
            strategy: 策略（默认从 config 取）
            session_id: 会话 ID

        返回：
            CompactionPlan
        """
        cfg = config or DEFAULT_CONFIG
        strat = strategy or cfg.strategy

        # 特殊策略：truncate 不分块，只保留最近 N 条
        if strat == Strategy.TRUNCATE.value:
            n = len(messages)
            keep = list(range(max(0, n - cfg.keep_recent), n))
            blocks = [list(range(0, max(0, n - cfg.keep_recent)))]
            estimated_after = sum(
                TokenCounter.count_messages([messages[i]]) for i in keep
            )
            plan = CompactionPlan(
                session_id=session_id,
                strategy=strat,
                blocks_to_compact=blocks,
                messages_to_keep=keep,
                estimated_before_tokens=sum(imp.token_count for imp in importance),
                estimated_after_tokens=estimated_after,
                confidence=0.95,
                notes=["truncate strategy: drop oldest messages"],
            )
            return plan

        blocks, keep = self.slice(importance, messages, cfg)
        estimated_after = sum(
            TokenCounter.count_messages([messages[i]]) for i in keep
        )

        # 估算压缩后 token（假设每块压缩到 1/4）
        compressed_tokens = 0
        for block in blocks:
            block_tokens = sum(
                TokenCounter.count_messages([messages[i]]) for i in block
            )
            compressed_tokens += max(50, block_tokens // 4)

        estimated_after += compressed_tokens
        confidence = 0.7 if blocks else 1.0

        return CompactionPlan(
            session_id=session_id,
            strategy=strat,
            blocks_to_compact=blocks,
            messages_to_keep=keep,
            estimated_before_tokens=sum(imp.token_count for imp in importance),
            estimated_after_tokens=estimated_after,
            confidence=confidence,
            notes=[
                f"blocks={len(blocks)}",
                f"keep={len(keep)}",
                f"strategy={strat}",
            ],
        )


# 全局分块器（单例）
GLOBAL_SLICER = CompactionSlicer()
