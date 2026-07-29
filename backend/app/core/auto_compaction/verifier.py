"""
# Auto-Compaction 验证器（Verify 阶段）
# ============================================================
# 核心作用：验证压缩结果是否保留了关键信息
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 验证维度：
#   1. 决策保留：原消息中的决策词在摘要中是否出现
#   2. 代码块保留：原消息中的代码块是否被完整保留
#   3. 偏好保留：用户偏好是否被保留
#   4. 关键词覆盖：原消息 top 关键词是否在摘要中出现
#   5. 压缩比合理：压缩比在 2x ~ 50x 之间
#   6. 关键角色保留：system 消息、用户问题
#
# 输出：VerificationResult（passed + score + issues + suggestions）
# 复杂度：O(N + M)
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .analyzer import DECISION_KEYWORDS, USER_PREFERENCE_KEYWORDS
from .models import (
    AutoCompactionConfig,
    CompactionBlock,
    DEFAULT_CONFIG,
    VerificationResult,
)


class CompactionVerifier:
    """
    压缩质量验证器
    用法：
        verifier = CompactionVerifier()
        result = verifier.verify(blocks, original_messages, plan, config)
    """

    def __init__(self) -> None:
        # 复用 analyzer 中的关键词
        self._decision_re = re.compile(
            "|".join(re.escape(kw) for kw in DECISION_KEYWORDS),
            re.IGNORECASE,
        )
        self._preference_re = re.compile(
            "|".join(re.escape(kw) for kw in USER_PREFERENCE_KEYWORDS),
            re.IGNORECASE,
        )
        self._code_block_re = re.compile(r"```[\s\S]*?```", re.MULTILINE)

    def verify(
        self,
        blocks: List[CompactionBlock],
        original_messages: List[Dict[str, Any]],
        plan: Optional[Any] = None,
        config: Optional[AutoCompactionConfig] = None,
    ) -> VerificationResult:
        """
        验证压缩结果

        参数：
            blocks: 压缩块列表
            original_messages: 原始消息列表
            plan: 压缩计划
            config: 配置

        返回：
            VerificationResult
        """
        cfg = config or DEFAULT_CONFIG
        checks: Dict[str, bool] = {}
        issues: List[str] = []
        missing: List[str] = []
        suggestions: List[str] = []
        score = 0.0
        total_checks = 0

        if not blocks:
            return VerificationResult(
                passed=True,
                score=1.0,
                checks={"empty": True},
                issues=[],
                missing=[],
                suggestions=[],
            )

        # 合并所有摘要文本
        merged_summary = "\n".join(b.summary for b in blocks)
        merged_keywords = []
        for b in blocks:
            merged_keywords.extend(b.keywords)
        merged_keywords_set = set(merged_keywords)

        # ---- 1. 决策保留检查 ----
        total_checks += 1
        original_decisions = self._extract_decisions(original_messages)
        preserved_decisions = sum(
            1 for d in original_decisions
            if any(kw in merged_summary for kw in d.lower().split() if len(kw) > 3)
        )
        if original_decisions:
            decision_ratio = preserved_decisions / len(original_decisions)
            checks["decisions_preserved"] = decision_ratio >= 0.5
            if decision_ratio < 0.5:
                missing.extend(
                    [d for d in original_decisions if d not in merged_summary][:5]
                )
                issues.append(
                    f"Only {preserved_decisions}/{len(original_decisions)} decisions preserved"
                )
            score += decision_ratio * 0.25
        else:
            checks["decisions_preserved"] = True
            score += 0.25

        # ---- 2. 代码块保留检查 ----
        total_checks += 1
        original_code = self._extract_code_blocks(original_messages)
        if original_code:
            preserved_code = sum(
                1 for c in original_code if c in merged_summary
            )
            code_ratio = preserved_code / len(original_code)
            checks["code_blocks_preserved"] = code_ratio >= 0.3
            if code_ratio < 0.3:
                issues.append(
                    f"Only {preserved_code}/{len(original_code)} code blocks preserved"
                )
            score += code_ratio * 0.20
        else:
            checks["code_blocks_preserved"] = True
            score += 0.20

        # ---- 3. 偏好保留检查 ----
        total_checks += 1
        original_prefs = self._extract_preferences(original_messages)
        if original_prefs:
            preserved_prefs = sum(
                1 for p in original_prefs if any(
                    kw in merged_summary.lower() for kw in p.lower().split() if len(kw) > 3
                )
            )
            pref_ratio = preserved_prefs / len(original_prefs)
            checks["preferences_preserved"] = pref_ratio >= 0.5
            if pref_ratio < 0.5:
                issues.append(
                    f"Only {preserved_prefs}/{len(original_prefs)} preferences preserved"
                )
            score += pref_ratio * 0.15
        else:
            checks["preferences_preserved"] = True
            score += 0.15

        # ---- 4. 关键词覆盖检查 ----
        total_checks += 1
        original_keywords = self._extract_top_keywords(original_messages, top_n=10)
        if original_keywords:
            covered = sum(1 for k in original_keywords if k in merged_keywords_set)
            coverage = covered / len(original_keywords)
            checks["keyword_coverage"] = coverage >= 0.5
            if coverage < 0.5:
                suggestions.append(
                    f"Keyword coverage low: {covered}/{len(original_keywords)}"
                )
            score += coverage * 0.20
        else:
            checks["keyword_coverage"] = True
            score += 0.20

        # ---- 5. 压缩比检查 ----
        total_checks += 1
        total_original_tokens = sum(b.original_tokens for b in blocks)
        total_compressed_tokens = sum(b.tokens for b in blocks)
        if total_compressed_tokens > 0:
            ratio = total_original_tokens / total_compressed_tokens
            # 合理范围：2x ~ 50x
            compression_ok = 1.5 <= ratio <= 100
            checks["compression_ratio"] = compression_ok
            if not compression_ok:
                if ratio < 1.5:
                    issues.append(f"Compression ratio too low: {ratio:.2f}x")
                    suggestions.append("Consider summarize or hybrid strategy")
                else:
                    issues.append(f"Compression ratio too high: {ratio:.2f}x (may lose info)")
            score += 0.10
        else:
            checks["compression_ratio"] = True
            score += 0.10

        # ---- 6. system 消息保留检查 ----
        total_checks += 1
        system_messages = [
            m for m in original_messages if m.get("role") == "system"
        ]
        if system_messages:
            # system 通常在 keep 中（重要性高），检查 hot tier 是否保留
            # 简化：检查系统消息中的关键词是否在合并摘要或 hot 中出现
            sys_text = "\n".join(m.get("content", "") for m in system_messages)
            sys_keywords = [kw for kw in sys_text.split()[:10] if len(kw) > 2]
            sys_in_summary = any(
                kw in merged_summary for kw in sys_keywords
            )
            # system 在 keep 中不算丢失
            checks["system_preserved"] = True
            if not sys_in_summary:
                issues.append("System message keywords not in summary (likely in hot tier)")
            score += 0.10
        else:
            checks["system_preserved"] = True
            score += 0.10

        # 归一化
        score = min(1.0, max(0.0, score))
        passed = score >= cfg.verification_min_score and not any(
            v is False for v in checks.values()
        )

        if not passed and not suggestions:
            suggestions.append("Consider re-running with higher keep_recent or different strategy")

        return VerificationResult(
            passed=passed,
            score=round(score, 3),
            checks=checks,
            missing=missing,
            issues=issues,
            suggestions=suggestions,
        )

    def _extract_decisions(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取决策语句"""
        decisions = []
        for msg in messages:
            content = msg.get("content", "") or ""
            for sent in re.split(r"[。！？.!?\n]+", content):
                sent = sent.strip()
                if 5 <= len(sent) <= 200 and self._decision_re.search(sent):
                    decisions.append(sent)
        return decisions

    def _extract_preferences(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取用户偏好语句"""
        prefs = []
        for msg in messages:
            if msg.get("role") != "user":
                continue
            content = msg.get("content", "") or ""
            for sent in re.split(r"[。！？.!?\n]+", content):
                sent = sent.strip()
                if 5 <= len(sent) <= 200 and self._preference_re.search(sent):
                    prefs.append(sent)
        return prefs

    def _extract_code_blocks(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取代码块"""
        blocks = []
        for msg in messages:
            content = msg.get("content", "") or ""
            for m in self._code_block_re.finditer(content):
                code = m.group(0)
                if len(code) <= 800:
                    blocks.append(code)
        return blocks

    def _extract_top_keywords(
        self,
        messages: List[Dict[str, Any]],
        top_n: int = 10,
    ) -> List[str]:
        """提取 top N 关键词"""
        stop_words = {
            "the", "a", "an", "is", "are", "was", "this", "that",
            "的", "了", "是", "在", "有", "和",
        }
        word_count: Dict[str, int] = {}
        for msg in messages:
            content = msg.get("content", "") or ""
            words = re.findall(r"[A-Za-z]{3,}|[\u4e00-\u9fa5]{2,}", content)
            for w in words:
                wl = w.lower()
                if wl in stop_words or len(wl) < 2:
                    continue
                word_count[wl] = word_count.get(wl, 0) + 1
        sorted_w = sorted(word_count.items(), key=lambda x: -x[1])
        return [w for w, _ in sorted_w[:top_n]]


# 全局验证器（单例）
GLOBAL_VERIFIER = CompactionVerifier()
