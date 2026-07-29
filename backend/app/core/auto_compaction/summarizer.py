"""
# Auto-Compaction 摘要器（Summarize 阶段）
# ============================================================
# 核心作用：对每个压缩块生成摘要，提取关键点
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 摘要策略：
#   1. 提取关键句（含决策词、用户偏好、问题/回答）
#   2. 保留代码块（标记为 [code-block]）
#   3. 保留数字、列表结构
#   4. 输出格式：Markdown 风格
#
# 算法：本地启发式 + 可选 LLM 增强（无外部依赖）
# 复杂度：O(M)，M = 块内总字符数
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .detector import TokenCounter
from .models import CompactionBlock, Strategy


# 关键句识别模式
KEY_SENTENCE_PATTERNS = [
    re.compile(r"^[\s]*[-*•]\s+", re.MULTILINE),  # 列表项
    re.compile(r"^[\s]*\d+\.\s+", re.MULTILINE),  # 编号
    re.compile(r"```[\s\S]*?```", re.MULTILINE),   # 代码块
]


class CompactionSummarizer:
    """
    摘要生成器
    用法：
        summarizer = CompactionSummarizer()
        block = summarizer.summarize(indices, messages, strategy)
    """

    def __init__(self) -> None:
        # 决策关键词
        self._decision_re = re.compile(
            r"(决定|确认|选择|采用|必须|不能|一定要|"
            r"decide|decided|must|always|never|require|"
            r"important|critical|key decision)",
            re.IGNORECASE,
        )
        # 偏好关键词
        self._pref_re = re.compile(
            r"(我喜欢|我不喜欢|我需要|我希望|我要求|"
            r"i (like|need|prefer|want)|please always)",
            re.IGNORECASE,
        )
        # 问答标识
        self._qa_re = re.compile(r"^(Q|A|问题|回答)[\s:：]", re.IGNORECASE | re.MULTILINE)

    def summarize(
        self,
        message_indices: List[int],
        messages: List[Dict[str, Any]],
        strategy: str = Strategy.SUMMARIZE.value,
        session_id: str = "",
    ) -> CompactionBlock:
        """
        对一块消息生成摘要

        参数：
            message_indices: 消息索引列表
            messages: 完整消息列表
            strategy: 策略
            session_id: 会话 ID

        返回：
            CompactionBlock（含摘要、关键点、关键词）
        """
        # 收集块内消息
        block_messages = [messages[i] for i in message_indices if i < len(messages)]
        original_tokens = TokenCounter.count_messages(block_messages)

        # 提取关键点
        key_points = self._extract_key_points(block_messages)
        # 提取代码块
        code_blocks = self._extract_code_blocks(block_messages)
        # 提取关键词
        keywords = self._extract_keywords(block_messages)
        # 生成摘要文本
        summary = self._build_summary(
            block_messages, key_points, code_blocks, strategy
        )
        # 估算压缩后 token
        summary_tokens = TokenCounter.count_text(summary)

        return CompactionBlock(
            session_id=session_id,
            message_indices=list(message_indices),
            tokens=summary_tokens,
            original_tokens=original_tokens,
            summary=summary,
            key_points=key_points,
            keywords=keywords,
            strategy=strategy,
        )

    def _extract_key_points(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取关键点（按优先级）"""
        points: List[str] = []
        for msg in messages:
            content = msg.get("content", "") or ""
            role = msg.get("role", "")
            # 拆分句子
            sentences = re.split(r"[。！？.!?\n]+", content)
            for sent in sentences:
                sent = sent.strip()
                if len(sent) < 5 or len(sent) > 300:
                    continue
                # 优先级 1：决策 / 偏好
                if self._decision_re.search(sent):
                    points.append(f"[决策] {sent}")
                elif self._pref_re.search(sent):
                    points.append(f"[偏好] {sent}")
                # 优先级 2：列表项
                elif re.match(r"^\s*[-*•]\s+", sent) or re.match(r"^\s*\d+\.\s+", sent):
                    points.append(sent)
                # 优先级 3：问答
                elif self._qa_re.match(sent):
                    points.append(sent)

        # 去重（保持顺序）
        seen = set()
        unique = []
        for p in points:
            key = p[:50]
            if key not in seen:
                seen.add(key)
                unique.append(p)
        return unique[:20]  # 最多 20 条

    def _extract_code_blocks(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取代码块（保留所有，限制每块大小）"""
        blocks: List[str] = []
        for msg in messages:
            content = msg.get("content", "") or ""
            # 匹配 ``` 包围的代码
            for match in re.finditer(r"```[\s\S]*?```", content):
                code = match.group(0)
                if len(code) <= 1500:  # 增大单块上限
                    blocks.append(code)
                else:
                    blocks.append(code[:1500] + "\n... (truncated)")
        return blocks

    def _extract_keywords(
        self, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """提取关键词（基于简单频率）"""
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "的", "了", "是", "在", "有", "和", "与", "或", "但",
            "this", "that", "these", "those", "it", "its",
        }
        word_count: Dict[str, int] = {}
        for msg in messages:
            content = msg.get("content", "") or ""
            # 简单分词
            words = re.findall(r"[A-Za-z]{3,}|[\u4e00-\u9fa5]{2,}", content)
            for w in words:
                wl = w.lower()
                if wl in stop_words:
                    continue
                word_count[wl] = word_count.get(wl, 0) + 1
        # 排序取 top 10
        sorted_words = sorted(word_count.items(), key=lambda x: -x[1])
        return [w for w, _ in sorted_words[:10]]

    def _build_summary(
        self,
        messages: List[Dict[str, Any]],
        key_points: List[str],
        code_blocks: List[str],
        strategy: str,
    ) -> str:
        """构建摘要文本"""
        parts: List[str] = []

        # 标题
        if messages:
            first_role = messages[0].get("role", "")
            last_role = messages[-1].get("role", "")
            parts.append(
                f"[压缩块] 共 {len(messages)} 条消息（{first_role} → {last_role}）"
            )

        # 关键点
        if key_points:
            parts.append("\n## 关键点")
            for p in key_points[:10]:
                parts.append(f"- {p}")

        # 代码块
        if code_blocks:
            parts.append(f"\n## 代码片段（{len(code_blocks)} 个）")
            for i, code in enumerate(code_blocks[:10], 1):  # 保留更多
                parts.append(f"\n### 代码 {i}\n{code}")

        # 决策与偏好
        decisions = [p for p in key_points if p.startswith("[决策]")]
        prefs = [p for p in key_points if p.startswith("[偏好]")]
        if decisions:
            parts.append("\n## 决策记录")
            for d in decisions:
                parts.append(f"- {d[4:]}")
        if prefs:
            parts.append("\n## 用户偏好")
            for p in prefs:
                parts.append(f"- {p[4:]}")

        return "\n".join(parts) if parts else "[无内容]"


# 全局摘要器（单例）
GLOBAL_SUMMARIZER = CompactionSummarizer()
