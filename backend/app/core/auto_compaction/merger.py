"""
# Auto-Compaction 合并器（Merge 阶段）
# ============================================================
# 核心作用：合并多块摘要，去重、整合
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 合并算法：
#   1. 按时间顺序拼接
#   2. 关键点去重（基于前 N 字符哈希）
#   3. 关键词合并（频次加权）
#   4. 元数据累加（原始 token 总和）
#
# 复杂度：O(K * L)，K = 块数，L = 平均关键点数
# ============================================================
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

from .models import CompactionBlock, CompactionPlan, Strategy


class CompactionMerger:
    """
    块合并器
    用法：
        merger = CompactionMerger()
        merged = merger.merge(blocks, plan)
    """

    def __init__(self) -> None:
        self._key_point_seen: set = set()

    def merge(
        self,
        blocks: List[CompactionBlock],
        plan: Optional[CompactionPlan] = None,
    ) -> List[CompactionBlock]:
        """
        合并多个压缩块

        简化策略：直接返回入参 blocks（不真正合并为单块），
        在 Compress 阶段统一写入。理由：
          - 保留细粒度（按块检索）
          - 避免摘要嵌套损失
          - 关键点去重在 tier 索引阶段完成

        这里仍执行关键点去重和关键词合并。
        """
        if not blocks:
            return blocks
        # 关键点去重（跨块）
        seen_keys: set = set()
        for block in blocks:
            unique_points = []
            for p in block.key_points:
                k = self._fingerprint(p)
                if k in seen_keys:
                    continue
                seen_keys.add(k)
                unique_points.append(p)
            block.key_points = unique_points
            # 关键词去重
            seen_kw: set = set()
            unique_kw = []
            for kw in block.keywords:
                if kw in seen_kw:
                    continue
                seen_kw.add(kw)
                unique_kw.append(kw)
            block.keywords = unique_kw
        return blocks

    def merge_into_one(
        self,
        blocks: List[CompactionBlock],
        session_id: str = "",
    ) -> CompactionBlock:
        """
        把多个块合并为单块（用于单摘要场景）

        返回：
            CompactionBlock（包含所有原始块的信息）
        """
        if not blocks:
            return CompactionBlock(session_id=session_id)

        # 所有原始消息索引
        all_indices: List[int] = []
        # 原始 token 总和
        total_original = 0
        # 摘要拼接
        summaries: List[str] = []
        # 关键点（去重）
        all_points: List[str] = []
        # 关键词（频次合并）
        kw_count: Dict[str, int] = {}
        seen: set = set()

        for block in blocks:
            all_indices.extend(block.message_indices)
            total_original += block.original_tokens
            summaries.append(block.summary)
            for p in block.key_points:
                fp = self._fingerprint(p)
                if fp not in seen:
                    seen.add(fp)
                    all_points.append(p)
            for kw in block.keywords:
                kw_count[kw] = kw_count.get(kw, 0) + 1

        # 关键词按频次排序
        sorted_kw = sorted(kw_count.items(), key=lambda x: -x[1])
        top_kw = [w for w, _ in sorted_kw[:15]]

        # 拼接摘要
        merged_summary = "\n\n---\n\n".join(summaries)
        merged_tokens = sum(b.tokens for b in blocks)

        return CompactionBlock(
            session_id=session_id,
            message_indices=all_indices,
            tokens=merged_tokens,
            original_tokens=total_original,
            summary=merged_summary,
            key_points=all_points[:30],
            keywords=top_kw,
            strategy=blocks[0].strategy if blocks else Strategy.SUMMARIZE.value,
            is_incremental=False,
        )

    def _fingerprint(self, text: str) -> str:
        """生成关键点指纹（基于前 60 字符）"""
        norm = text.strip().lower()[:60]
        return hashlib.md5(norm.encode("utf-8")).hexdigest()[:16]


# 全局合并器（单例）
GLOBAL_MERGER = CompactionMerger()
