"""
# Auto-Compaction 统计与监控
# ============================================================
# 核心作用：跟踪压缩事件、节省 token、命中率
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 指标：
#   1. 总压缩次数
#   2. 总节省 token
#   3. 平均压缩比
#   4. 验证通过率
#   5. 增量压缩次数
#   6. 策略分布
#   7. 阶段耗时分布
#
# 复杂度：O(1) 查询
# ============================================================
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional

from .models import CompressionResult, Strategy


class CompactionStats:
    """
    压缩统计器
    用法：
        stats = CompactionStats()
        stats.record(result)
        snapshot = stats.snapshot()
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._total_compactions: int = 0
        self._total_saved_tokens: int = 0
        self._total_input_tokens: int = 0
        self._total_output_tokens: int = 0
        self._verification_passed: int = 0
        self._verification_failed: int = 0
        self._incremental_count: int = 0
        self._strategy_counts: Dict[str, int] = defaultdict(int)
        self._severity_counts: Dict[str, int] = defaultdict(int)
        self._stage_durations: Dict[str, List[int]] = defaultdict(list)
        self._session_history: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._recent_results: List[CompressionResult] = []
        self._max_recent: int = 100

    def record(
        self,
        result: CompressionResult,
        severity: str = "medium",
    ) -> None:
        """记录一次压缩结果"""
        with self._lock:
            self._total_compactions += 1
            self._total_saved_tokens += result.saved_tokens
            self._total_input_tokens += result.before_tokens
            self._total_output_tokens += result.after_tokens
            if result.is_incremental:
                self._incremental_count += 1
            self._strategy_counts[result.strategy] += 1
            self._severity_counts[severity] += 1
            # 验证
            if result.verification:
                if result.verification.passed:
                    self._verification_passed += 1
                else:
                    self._verification_failed += 1
            # 阶段耗时
            for stage in result.stages:
                if stage.duration_ms > 0:
                    self._stage_durations[stage.stage].append(stage.duration_ms)
                    if len(self._stage_durations[stage.stage]) > 100:
                        self._stage_durations[stage.stage] = \
                            self._stage_durations[stage.stage][-100:]
            # 会话历史
            self._session_history[result.session_id].append({
                "before": result.before_tokens,
                "after": result.after_tokens,
                "saved": result.saved_tokens,
                "ratio": result.saved_ratio,
                "strategy": result.strategy,
                "incremental": result.is_incremental,
                "success": result.success,
                "duration_ms": result.duration_ms,
                "at": result.created_at,
            })
            if len(self._session_history[result.session_id]) > 50:
                self._session_history[result.session_id] = \
                    self._session_history[result.session_id][-50:]
            # 最近结果
            self._recent_results.append(result)
            if len(self._recent_results) > self._max_recent:
                self._recent_results = self._recent_results[-self._max_recent:]

    def snapshot(self) -> Dict[str, Any]:
        """获取统计快照"""
        with self._lock:
            avg_compression = (
                self._total_input_tokens / max(1, self._total_output_tokens)
                if self._total_output_tokens > 0
                else 0.0
            )
            verification_total = self._verification_passed + self._verification_failed
            verification_pass_rate = (
                self._verification_passed / verification_total
                if verification_total > 0
                else 0.0
            )
            # 阶段平均耗时
            stage_avg = {}
            for stage, durations in self._stage_durations.items():
                if durations:
                    stage_avg[stage] = {
                        "avg_ms": int(sum(durations) / len(durations)),
                        "max_ms": max(durations),
                        "min_ms": min(durations),
                        "count": len(durations),
                    }
            return {
                "total_compactions": self._total_compactions,
                "total_saved_tokens": self._total_saved_tokens,
                "total_input_tokens": self._total_input_tokens,
                "total_output_tokens": self._total_output_tokens,
                "avg_compression_ratio": round(avg_compression, 3),
                "verification": {
                    "passed": self._verification_passed,
                    "failed": self._verification_failed,
                    "pass_rate": round(verification_pass_rate, 3),
                },
                "incremental_count": self._incremental_count,
                "strategy_distribution": dict(self._strategy_counts),
                "severity_distribution": dict(self._severity_counts),
                "stage_avg_duration": stage_avg,
                "active_sessions": len(self._session_history),
            }

    def get_session_history(
        self,
        session_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """获取会话历史"""
        with self._lock:
            history = self._session_history.get(session_id, [])
            return list(reversed(history))[:limit]

    def get_session_savings(
        self,
        session_id: str,
    ) -> Dict[str, Any]:
        """获取会话节省统计"""
        with self._lock:
            history = self._session_history.get(session_id, [])
            if not history:
                return {
                    "session_id": session_id,
                    "compaction_count": 0,
                    "total_saved": 0,
                    "avg_saved_per_run": 0,
                }
            total_saved = sum(h.get("saved", 0) for h in history)
            return {
                "session_id": session_id,
                "compaction_count": len(history),
                "total_saved": total_saved,
                "avg_saved_per_run": total_saved // len(history),
                "last_at": history[-1].get("at") if history else None,
                "strategies": list(set(h.get("strategy") for h in history)),
            }

    def get_recent(
        self,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """获取最近压缩结果"""
        with self._lock:
            return [r.to_dict() for r in self._recent_results[-limit:]]

    def reset(self) -> None:
        """重置统计"""
        with self._lock:
            self._total_compactions = 0
            self._total_saved_tokens = 0
            self._total_input_tokens = 0
            self._total_output_tokens = 0
            self._verification_passed = 0
            self._verification_failed = 0
            self._incremental_count = 0
            self._strategy_counts.clear()
            self._severity_counts.clear()
            self._stage_durations.clear()
            self._session_history.clear()
            self._recent_results.clear()


# 全局统计（单例）
GLOBAL_STATS = CompactionStats()
