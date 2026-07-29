"""
# Auto-Compaction 分析器（Analyze 阶段）
# ============================================================
# 核心作用：对每条消息计算重要性分数，识别关键决策/代码块/用户偏好
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 评分维度：
#   1. 时近性（recency）：越近的消息越重要
#   2. 角色权重（role_weight）：user > system > assistant
#   3. 关键词命中（decision_keywords）：包含"决定"/"必须"/"always"等
#   4. 代码块（code_block）：含 ``` 标记
#   5. 长度因子（length）：过长可能含重要信息
#   6. 用户偏好（user_preference）："我喜欢"/"我需要"等
#
# 输出：MessageImportance 列表
# 复杂度：O(N * M)，N = 消息数，M = 平均内容长度
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from .detector import TokenCounter
from .models import MessageImportance


# ============================================================
# 关键决策关键词
# ============================================================

DECISION_KEYWORDS = [
    "决定", "确认", "选择", "采用", "必须是", "不能", "一定要",
    "decide", "decided", "must", "always", "never", "require",
    "important", "critical", "key decision", "key point",
    "decision:", "decision is", "we will", "let's use",
]

# 用户偏好关键词
USER_PREFERENCE_KEYWORDS = [
    "我喜欢", "我不喜欢", "我需要", "我希望", "我要求", "我习惯",
    "i like", "i don't like", "i need", "i prefer", "i want", "please always",
    "my preference", "as i mentioned", "remember that",
]


class CompactionAnalyzer:
    """
    消息重要性分析器
    用法：
        analyzer = CompactionAnalyzer()
        results = analyzer.analyze(messages)
    """

    def __init__(self) -> None:
        # 编译正则
        self._code_block_pattern = re.compile(r"```[\s\S]*?```", re.MULTILINE)
        self._inline_code_pattern = re.compile(r"`[^`]+`")
        self._decision_pattern = re.compile(
            "|".join(re.escape(kw) for kw in DECISION_KEYWORDS),
            re.IGNORECASE,
        )
        self._preference_pattern = re.compile(
            "|".join(re.escape(kw) for kw in USER_PREFERENCE_KEYWORDS),
            re.IGNORECASE,
        )

    def analyze(self, messages: List[Dict[str, Any]]) -> List[MessageImportance]:
        """
        分析消息列表，返回每条消息的重要性评估

        参数：
            messages: 消息列表，每条含 role + content

        返回：
            List[MessageImportance]
        """
        results: List[MessageImportance] = []
        n = len(messages)
        for i, msg in enumerate(messages):
            results.append(self._analyze_one(i, msg, n))
        return results

    def _analyze_one(
        self,
        index: int,
        msg: Dict[str, Any],
        total: int,
    ) -> MessageImportance:
        """分析单条消息"""
        role = msg.get("role", "") or ""
        content = msg.get("content", "") or ""
        content_lower = content.lower()
        tokens = TokenCounter.count_text(content)

        # 1. 时近性：越靠后分数越高
        recency = (index + 1) / total if total > 0 else 0.0

        # 2. 角色权重
        role_weight = self._role_weight(role)

        # 3. 决策关键词
        decision_matches = self._decision_pattern.findall(content_lower)
        decision_score = min(1.0, len(set(decision_matches)) * 0.2)

        # 4. 代码块
        code_blocks = self._code_block_pattern.findall(content)
        inline_codes = self._inline_code_pattern.findall(content)
        is_code = bool(code_blocks) or len(inline_codes) >= 2
        code_score = 0.0
        if code_blocks:
            code_score = min(1.0, len(code_blocks) * 0.3 + 0.4)
        elif inline_codes:
            code_score = min(1.0, len(inline_codes) * 0.1)

        # 5. 长度因子（极长或极短降低权重）
        if tokens < 5:
            length_factor = 0.3
        elif tokens > 2000:
            length_factor = 0.7
        elif tokens > 500:
            length_factor = 1.0
        else:
            length_factor = 0.8

        # 6. 用户偏好
        preference_matches = self._preference_pattern.findall(content_lower)
        is_preference = bool(preference_matches)
        preference_score = min(1.0, len(preference_matches) * 0.4) if is_preference else 0.0

        # 7. 数字/列表（结构化信息）
        structure_score = 0.0
        if re.search(r"^\s*\d+\.", content, re.MULTILINE):
            structure_score += 0.3
        if re.search(r"^\s*[-*]\s", content, re.MULTILINE):
            structure_score += 0.2
        structure_score = min(1.0, structure_score)

        # 综合分数（加权）
        # system 消息特殊：保底 0.7
        if role == "system":
            base = 0.7
            score = base + (
                recency * 0.05
                + decision_score * 0.10
                + code_score * 0.10
                + structure_score * 0.05
            )
        else:
            score = (
                recency * 0.25
                + role_weight * 0.20
                + decision_score * 0.20
                + code_score * 0.15
                + structure_score * 0.10
                + preference_score * 0.10
            ) * length_factor

        # 边界
        score = max(0.0, min(1.0, score))

        return MessageImportance(
            index=index,
            role=role,
            content=content,
            score=score,
            factors={
                "recency": round(recency, 3),
                "role_weight": role_weight,
                "decision": round(decision_score, 3),
                "code": round(code_score, 3),
                "structure": round(structure_score, 3),
                "preference": round(preference_score, 3),
                "length_factor": length_factor,
            },
            decision_keywords=list(set(decision_matches))[:10],
            is_decision=decision_score > 0.15,
            is_code_block=is_code,
            is_user_preference=is_preference,
            token_count=tokens,
        )

    def _role_weight(self, role: str) -> float:
        """角色权重"""
        if role == "system":
            return 1.0  # system 永远重要
        if role == "user":
            return 0.8
        if role == "assistant":
            return 0.6
        if role == "tool":
            return 0.4
        return 0.5


# 全局分析器（单例）
GLOBAL_ANALYZER = CompactionAnalyzer()
