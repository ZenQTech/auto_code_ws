"""
# ============================================================
# 企业级 Plugin Hub - 成本控制
# ============================================================
# 核心作用：记录/汇总/告警组织或团队级别的插件使用成本
# 运行流程：
#   1. CostController 维护成本记录 + 预算
#   2. record_usage 累加 cost_usd
#   3. cost_summary 输出按周期/团队的聚合
#   4. 超出预算时发出 Alert
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional

from .models import CostRecord, _new_id, _now_iso, get_storage_dir
from .teams import TeamRegistry


def _current_period() -> str:
    """当前周期 YYYY-MM"""
    return time.strftime("%Y-%m", time.gmtime())


class CostController:
    """成本控制器

    Attributes:
        registry: 团队注册中心（用于查询团队/组织）
        storage_dir: 持久化目录
        _lock: 线程安全锁
        _records: 成本记录
        _budgets: 自定义预算 {org_id: {period: budget_usd}}
    """

    def __init__(self, registry: TeamRegistry, storage_dir: Optional[str] = None) -> None:
        """初始化

        Args:
            registry: 团队注册中心
            storage_dir: 持久化目录
        """
        self.registry = registry
        self.storage_dir = storage_dir or get_storage_dir()
        os.makedirs(self.storage_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._records: List[CostRecord] = []
        self._budgets: Dict[str, Dict[str, float]] = {}  # {org_id: {period: budget}}
        self._alerts: List[Dict[str, Any]] = []
        self._load()

    # ----------------------------------------------------------------
    # 持久化
    # ----------------------------------------------------------------
    def _record_path(self) -> str:
        return os.path.join(self.storage_dir, "cost_records.jsonl")

    def _budget_path(self) -> str:
        return os.path.join(self.storage_dir, "cost_budgets.json")

    def _alert_path(self) -> str:
        return os.path.join(self.storage_dir, "cost_alerts.jsonl")

    def _load(self) -> None:
        with self._lock:
            try:
                if os.path.isfile(self._record_path()):
                    with open(self._record_path(), "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                self._records.append(CostRecord.from_dict(json.loads(line)))
            except Exception:
                pass
            try:
                if os.path.isfile(self._budget_path()):
                    with open(self._budget_path(), "r", encoding="utf-8") as f:
                        self._budgets = json.load(f)
            except Exception:
                pass
            try:
                if os.path.isfile(self._alert_path()):
                    with open(self._alert_path(), "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                self._alerts.append(json.loads(line))
            except Exception:
                pass

    def _append_record(self, rec: CostRecord) -> None:
        """追加记录到 JSONL"""
        with open(self._record_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec.to_dict(), ensure_ascii=False) + "\n")

    def _save_budgets(self) -> None:
        with open(self._budget_path(), "w", encoding="utf-8") as f:
            json.dump(self._budgets, f, ensure_ascii=False, indent=2)

    def _append_alert(self, alert: Dict[str, Any]) -> None:
        with open(self._alert_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(alert, ensure_ascii=False) + "\n")

    # ----------------------------------------------------------------
    # 记录
    # ----------------------------------------------------------------
    def record_usage(
        self,
        org_id: str,
        plugin_id: str,
        member_id: str,
        cost_usd: float,
        usage_count: int = 1,
        team_id: Optional[str] = None,
        period: Optional[str] = None,
    ) -> CostRecord:
        """记录一次使用成本

        Args:
            org_id: 组织 ID
            plugin_id: 插件 ID
            member_id: 成员 ID
            cost_usd: 成本
            usage_count: 使用次数
            team_id: 团队 ID
            period: 周期（YYYY-MM），默认当前月

        Returns:
            CostRecord: 成本记录
        """
        with self._lock:
            rec = CostRecord(
                record_id=_new_id("cost"),
                org_id=org_id,
                team_id=team_id,
                plugin_id=plugin_id,
                member_id=member_id,
                usage_count=usage_count,
                cost_usd=float(cost_usd),
                period=period or _current_period(),
                created_at=_now_iso(),
            )
            self._records.append(rec)
            self._append_record(rec)
            # 检查预算
            self._check_budget_alert(org_id, rec.period)
            return rec

    # ----------------------------------------------------------------
    # 预算
    # ----------------------------------------------------------------
    def set_budget(self, org_id: str, period: str, budget_usd: float) -> None:
        """设置组织某周期预算

        Args:
            org_id: 组织 ID
            period: YYYY-MM
            budget_usd: 预算美元
        """
        with self._lock:
            self._budgets.setdefault(org_id, {})[period] = float(budget_usd)
            self._save_budgets()

    def get_budget(self, org_id: str, period: str) -> float:
        """获取预算（无则从 org.quotas 兜底）"""
        with self._lock:
            custom = self._budgets.get(org_id, {}).get(period)
            if custom is not None:
                return custom
            org = self.registry.get_org(org_id)
            if org:
                return float(org.quotas.get("monthly_budget_usd", 0.0))
            return 0.0

    def _check_budget_alert(self, org_id: str, period: str) -> None:
        """预算超限时记录告警（仅记录一次）"""
        budget = self.get_budget(org_id, period)
        if budget <= 0:
            return
        total = self._period_total(org_id, period)
        if total > budget:
            # 避免重复告警：检查同周期是否已告警
            key = f"{org_id}:{period}"
            if any(a.get("key") == key for a in self._alerts):
                return
            alert = {
                "alert_id": _new_id("alert"),
                "key": key,
                "org_id": org_id,
                "period": period,
                "budget_usd": budget,
                "spent_usd": total,
                "overage_usd": total - budget,
                "severity": "error" if total > budget * 1.2 else "warn",
                "created_at": _now_iso(),
            }
            self._alerts.append(alert)
            self._append_alert(alert)

    # ----------------------------------------------------------------
    # 查询
    # ----------------------------------------------------------------
    def _period_total(self, org_id: str, period: str) -> float:
        """指定组织/周期的总成本"""
        return sum(r.cost_usd for r in self._records if r.org_id == org_id and r.period == period)

    def cost_summary(self, org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
        """成本摘要

        Args:
            org_id: 组织 ID
            period: 周期，默认当前月

        Returns:
            Dict[str, Any]: 摘要
        """
        period = period or _current_period()
        with self._lock:
            relevant = [r for r in self._records if r.org_id == org_id and r.period == period]
            total = sum(r.cost_usd for r in relevant)
            budget = self.get_budget(org_id, period)
            return {
                "org_id": org_id,
                "period": period,
                "total_usd": round(total, 4),
                "budget_usd": round(budget, 4),
                "remaining_usd": round(budget - total, 4),
                "usage_pct": round((total / budget * 100.0) if budget > 0 else 0.0, 2),
                "record_count": len(relevant),
                "over_budget": total > budget,
            }

    def cost_breakdown(self, org_id: str, period: Optional[str] = None) -> Dict[str, Any]:
        """成本明细（按插件 + 团队）"""
        period = period or _current_period()
        with self._lock:
            relevant = [r for r in self._records if r.org_id == org_id and r.period == period]
            by_plugin: Dict[str, float] = {}
            by_team: Dict[str, float] = {}
            by_member: Dict[str, float] = {}
            for r in relevant:
                by_plugin[r.plugin_id] = by_plugin.get(r.plugin_id, 0.0) + r.cost_usd
                if r.team_id:
                    by_team[r.team_id] = by_team.get(r.team_id, 0.0) + r.cost_usd
                by_member[r.member_id] = by_member.get(r.member_id, 0.0) + r.cost_usd
            # top
            top_plugin = sorted(by_plugin.items(), key=lambda kv: kv[1], reverse=True)[:10]
            top_member = sorted(by_member.items(), key=lambda kv: kv[1], reverse=True)[:10]
            return {
                "org_id": org_id,
                "period": period,
                "by_plugin": by_plugin,
                "by_team": by_team,
                "by_member": by_member,
                "top_plugins": [{"plugin_id": p, "cost_usd": round(c, 4)} for p, c in top_plugin],
                "top_members": [{"member_id": m, "cost_usd": round(c, 4)} for m, c in top_member],
            }

    def list_records(self, org_id: str, period: Optional[str] = None, limit: int = 200) -> List[CostRecord]:
        """列出成本记录"""
        with self._lock:
            relevant = [r for r in self._records if r.org_id == org_id]
            if period:
                relevant = [r for r in relevant if r.period == period]
            return relevant[-limit:][::-1]

    def list_alerts(self, org_id: str) -> List[Dict[str, Any]]:
        """列出告警"""
        with self._lock:
            return [a for a in self._alerts if a.get("org_id") == org_id]
