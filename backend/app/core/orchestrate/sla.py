"""
# Orchestrate SLA 监控
# ============================================================
# 核心作用：监控阶段执行 SLA，生成告警
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 功能：
#   - 延迟统计（p50/p95/p99）
#   - 成功率计算
#   - 告警生成（超阈值时）
#   - 时间窗口滑动
# ============================================================
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional, Tuple

from .models import (
    Alert,
    AlertSeverity,
    ExecutionMetrics,
    SLAMetrics,
    SLASpec,
    StageContract,
)


class SLAMonitor:
    """SLA 监控器

    跟踪每个阶段的执行指标，并在超阈值时生成告警。
    """

    def __init__(self, max_history: int = 10000) -> None:
        # 每个阶段保留最近 max_history 条执行记录
        self._latencies: Dict[str, Deque[int]] = defaultdict(
            lambda: deque(maxlen=max_history)
        )
        self._successes: Dict[str, Deque[bool]] = defaultdict(
            lambda: deque(maxlen=max_history)
        )
        self._contract_sla: Dict[str, SLASpec] = {}
        self._alerts: List[Alert] = []
        self._lock = threading.RLock()
        # 全局执行记录
        self._total_executions: int = 0
        self._total_failures: int = 0
        self._stage_executions: Dict[str, int] = defaultdict(int)
        self._stage_failures: Dict[str, int] = defaultdict(int)

    # ============================================================
    # SLA 规格注册
    # ============================================================

    def register_sla(self, stage_id: str, sla: SLASpec) -> None:
        """注册阶段 SLA 规格"""
        with self._lock:
            self._contract_sla[stage_id] = sla

    def unregister_sla(self, stage_id: str) -> bool:
        """注销 SLA"""
        with self._lock:
            return self._contract_sla.pop(stage_id, None) is not None

    # ============================================================
    # 记录执行
    # ============================================================

    def record_execution(
        self,
        stage_id: str,
        latency_ms: int,
        success: bool,
        pipeline_id: Optional[str] = None,
        error: Optional[str] = None,
    ) -> List[Alert]:
        """记录一次执行，返回触发的告警"""
        with self._lock:
            self._latencies[stage_id].append(latency_ms)
            self._successes[stage_id].append(success)
            self._total_executions += 1
            self._stage_executions[stage_id] += 1
            if not success:
                self._total_failures += 1
                self._stage_failures[stage_id] += 1

            # 检查 SLA 违规
            alerts = self._check_sla_violations(stage_id, pipeline_id)
            return alerts

    def _check_sla_violations(
        self,
        stage_id: str,
        pipeline_id: Optional[str],
    ) -> List[Alert]:
        """检查 SLA 违规"""
        alerts: List[Alert] = []
        sla = self._contract_sla.get(stage_id)
        if not sla:
            return alerts

        latencies = list(self._latencies[stage_id])
        successes = list(self._successes[stage_id])

        if not latencies:
            return alerts

        # 检查 p99 延迟
        p99 = self._percentile(latencies, 99)
        if p99 > sla.p99_latency_ms:
            alerts.append(Alert(
                stage_id=stage_id,
                pipeline_id=pipeline_id,
                severity=AlertSeverity.WARNING,
                metric="p99_latency_ms",
                threshold=float(sla.p99_latency_ms),
                actual=float(p99),
                message=f"p99 latency {p99}ms exceeds SLA {sla.p99_latency_ms}ms",
            ))

        # 检查成功率
        if len(successes) >= 10:  # 至少 10 个样本
            success_rate = sum(successes) / len(successes)
            if success_rate < sla.min_success_rate:
                severity = AlertSeverity.ERROR
                if success_rate < sla.min_success_rate * 0.5:
                    severity = AlertSeverity.CRITICAL
                alerts.append(Alert(
                    stage_id=stage_id,
                    pipeline_id=pipeline_id,
                    severity=severity,
                    metric="success_rate",
                    threshold=sla.min_success_rate,
                    actual=success_rate,
                    message=f"Success rate {success_rate:.2%} below SLA {sla.min_success_rate:.2%}",
                ))

        # 保存告警
        self._alerts.extend(alerts)
        return alerts

    # ============================================================
    # 指标查询
    # ============================================================

    def get_metrics(self, stage_id: str) -> SLAMetrics:
        """获取阶段的 SLA 指标"""
        with self._lock:
            latencies = list(self._latencies[stage_id])
            successes = list(self._successes[stage_id])
            total = len(successes)
            succ = sum(successes)
            return SLAMetrics(
                stage_id=stage_id,
                p50_latency_ms=self._percentile(latencies, 50) if latencies else 0,
                p95_latency_ms=self._percentile(latencies, 95) if latencies else 0,
                p99_latency_ms=self._percentile(latencies, 99) if latencies else 0,
                total_executions=total,
                successful_executions=succ,
                failed_executions=total - succ,
                success_rate=succ / total if total else 1.0,
                avg_latency_ms=int(sum(latencies) / len(latencies)) if latencies else 0,
            )

    def get_all_metrics(self) -> List[SLAMetrics]:
        """获取所有阶段的 SLA 指标"""
        with self._lock:
            return [self.get_metrics(sid) for sid in self._latencies.keys()]

    def get_global_stats(self) -> Dict[str, Any]:
        """获取全局统计"""
        with self._lock:
            return {
                "total_executions": self._total_executions,
                "total_failures": self._total_failures,
                "global_error_rate": (
                    self._total_failures / self._total_executions
                    if self._total_executions > 0 else 0.0
                ),
                "tracked_stages": len(self._latencies),
                "active_alerts": sum(1 for a in self._alerts if not a.acknowledged),
                "total_alerts": len(self._alerts),
            }

    # ============================================================
    # 告警管理
    # ============================================================

    def list_alerts(
        self,
        stage_id: Optional[str] = None,
        severity: Optional[AlertSeverity] = None,
        include_acknowledged: bool = True,
    ) -> List[Dict[str, Any]]:
        """列出告警"""
        with self._lock:
            alerts = self._alerts
            if stage_id:
                alerts = [a for a in alerts if a.stage_id == stage_id]
            if severity:
                alerts = [a for a in alerts if a.severity == severity]
            if not include_acknowledged:
                alerts = [a for a in alerts if not a.acknowledged]
            return [a.to_dict() for a in alerts]

    def acknowledge_alert(
        self,
        alert_id: str,
        acknowledged_by: str = "system",
    ) -> bool:
        """确认告警"""
        with self._lock:
            for a in self._alerts:
                if a.alert_id == alert_id:
                    a.acknowledged = True
                    a.acknowledged_by = acknowledged_by
                    a.acknowledged_at = time.strftime(
                        "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                    )
                    return True
            return False

    def clear_acknowledged_alerts(self) -> int:
        """清理已确认的告警"""
        with self._lock:
            before = len(self._alerts)
            self._alerts = [a for a in self._alerts if not a.acknowledged]
            return before - len(self._alerts)

    def clear_all_alerts(self) -> int:
        """清空所有告警"""
        with self._lock:
            count = len(self._alerts)
            self._alerts.clear()
            return count

    # ============================================================
    # 内部：百分位计算
    # ============================================================

    def _percentile(self, values: List[int], p: int) -> int:
        """计算百分位"""
        if not values:
            return 0
        sorted_values = sorted(values)
        idx = (p / 100) * (len(sorted_values) - 1)
        lower = int(idx)
        upper = min(lower + 1, len(sorted_values) - 1)
        weight = idx - lower
        return int(sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight)

    def reset(self) -> None:
        """重置所有指标（仅用于测试）"""
        with self._lock:
            self._latencies.clear()
            self._successes.clear()
            self._alerts.clear()
            self._total_executions = 0
            self._total_failures = 0
            self._stage_executions.clear()
            self._stage_failures.clear()
