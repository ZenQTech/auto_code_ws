"""
# Auto-Compaction 检测器
# ============================================================
# 核心作用：在消息流入或定时检查时判断是否需要压缩
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 触发条件：
#   1. token 总数 >= max_tokens
#   2. 消息数 >= max_messages
#   3. 增长率 >= growth_rate_threshold（每轮新增）
#   4. 手动触发
#
# 算法：
#   - O(1) 增量检测（基于历史快照）
#   - 多条件综合判断，返回严重等级
# ============================================================
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional

from .models import (
    AutoCompactionConfig,
    DEFAULT_CONFIG,
    DetectionResult,
    Strategy,
    TriggerReason,
)


# ============================================================
# Token 计数器（沿用 Cycle 2 算法）
# ============================================================

class TokenCounter:
    """
    Token 计数器（近似算法）
    复杂度：O(N)，N 为字符总数
    准确度：~95%（基于中英文混合经验值 2.5 字符/token）
    """

    CHARS_PER_TOKEN = 2.5

    @staticmethod
    def count_text(text: str) -> int:
        """估算文本 token 数"""
        if not text:
            return 0
        return max(1, int(len(text) / TokenCounter.CHARS_PER_TOKEN))

    @staticmethod
    def count_messages(messages: List[Dict[str, Any]]) -> int:
        """估算消息列表总 token 数"""
        total = 0
        for msg in messages:
            content = msg.get("content", "") or ""
            total += TokenCounter.count_text(content) + 4  # role 4 token
        return total


# ============================================================
# 检测器
# ============================================================

class CompactionDetector:
    """
    自动压缩检测器
    用法：
        detector = CompactionDetector()
        result = detector.detect(messages, config)
    """

    def __init__(self) -> None:
        # 历史 token 快照（用于计算增长率）
        self._history: Dict[str, int] = {}
        self._lock = threading.RLock()

    def detect(
        self,
        messages: List[Dict[str, Any]],
        config: Optional[AutoCompactionConfig] = None,
        session_id: Optional[str] = None,
    ) -> DetectionResult:
        """
        检测是否需要压缩

        参数：
            messages: 当前消息列表
            config: 配置（默认使用 DEFAULT_CONFIG）
            session_id: 会话 ID（用于增长率计算）

        返回：
            DetectionResult（包含严重程度和建议策略）
        """
        cfg = config or DEFAULT_CONFIG
        current_tokens = TokenCounter.count_messages(messages)
        current_messages = len(messages)

        # 计算增长率
        growth_rate = 0.0
        if session_id:
            with self._lock:
                last = self._history.get(session_id, 0)
                if last > 0:
                    growth_rate = (current_tokens - last) / last
                self._history[session_id] = current_tokens

        # 严重程度评估
        severity = "low"
        needs_compaction = False
        reason = ""

        if not cfg.enabled:
            return DetectionResult(
                needs_compaction=False,
                reason="compaction_disabled",
                current_tokens=current_tokens,
                current_messages=current_messages,
                threshold_tokens=cfg.max_tokens,
                threshold_messages=cfg.max_messages,
                growth_rate=growth_rate,
                severity="low",
                recommended_strategy=cfg.strategy,
            )

        # 1. token 阈值
        if current_tokens >= cfg.max_tokens:
            needs_compaction = True
            reason = TriggerReason.TOKEN_THRESHOLD.value
            # 严重程度：超出越多越严重
            ratio = current_tokens / max(1, cfg.max_tokens)
            if ratio >= 2.0:
                severity = "critical"
            elif ratio >= 1.5:
                severity = "high"
            else:
                severity = "medium"

        # 2. 消息数阈值
        if current_messages >= cfg.max_messages:
            needs_compaction = True
            if not reason:
                reason = TriggerReason.MESSAGE_THRESHOLD.value
            if current_messages >= cfg.max_messages * 2:
                severity = "critical"
            elif severity not in ("critical",):
                severity = "high"

        # 3. 增长率
        if growth_rate >= cfg.growth_rate_threshold and current_tokens > cfg.max_tokens * 0.5:
            needs_compaction = True
            if not reason:
                reason = TriggerReason.GROWTH_RATE.value
            if growth_rate >= 1.0 and severity == "low":
                severity = "medium"

        # 建议策略
        recommended = self._recommend_strategy(cfg, current_tokens, severity)

        return DetectionResult(
            needs_compaction=needs_compaction,
            reason=reason,
            current_tokens=current_tokens,
            current_messages=current_messages,
            threshold_tokens=cfg.max_tokens,
            threshold_messages=cfg.max_messages,
            growth_rate=growth_rate,
            severity=severity,
            recommended_strategy=recommended,
        )

    def _recommend_strategy(
        self,
        cfg: AutoCompactionConfig,
        current_tokens: int,
        severity: str,
    ) -> str:
        """根据严重程度推荐策略"""
        if severity == "critical":
            return Strategy.SUMMARIZE.value  # 强压缩
        elif severity == "high":
            return Strategy.HYBRID.value
        else:
            return cfg.strategy

    def reset(self, session_id: str) -> None:
        """重置会话历史"""
        with self._lock:
            self._history.pop(session_id, None)

    def get_history(self) -> Dict[str, int]:
        """获取历史快照（用于调试）"""
        with self._lock:
            return dict(self._history)


# 全局检测器（单例）
GLOBAL_DETECTOR = CompactionDetector()
