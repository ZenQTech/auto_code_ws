"""
# ============================================================
# 企业级 Plugin Hub - Dashboard 分析
# ============================================================
# 核心作用：聚合组织/团队/插件的使用数据，生成生产力分析快照
# 运行流程：
#   1. DashboardBuilder.snapshot 生成 DashboardSnapshot
#   2. top_plugins: 评分/下载/安装次数排序
#   3. productivity_score: 0-100 综合评分
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import os
import threading
from typing import Any, Dict, List, Optional

from .audit import AuditLogger
from .catalog import PLUGINS_DATA, get_plugin_by_id
from .cost_control import CostController
from .models import DashboardSnapshot, _now_iso, get_storage_dir
from .teams import TeamRegistry


class DashboardBuilder:
    """Dashboard 构造器"""

    def __init__(
        self,
        registry: TeamRegistry,
        cost: CostController,
        audit: AuditLogger,
        storage_dir: Optional[str] = None,
    ) -> None:
        self.registry = registry
        self.cost = cost
        self.audit = audit
        self.storage_dir = storage_dir or get_storage_dir()
        os.makedirs(self.storage_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._snapshots: List[DashboardSnapshot] = []

    # ----------------------------------------------------------------
    # 统计
    # ----------------------------------------------------------------
    def snapshot(self, org_id: str) -> DashboardSnapshot:
        """生成组织 Dashboard 快照

        Args:
            org_id: 组织 ID

        Returns:
            DashboardSnapshot: 快照
        """
        with self._lock:
            org = self.registry.get_org(org_id)
            if not org:
                raise ValueError(f"org {org_id} not found")
            members = self.registry.list_members(org_id)
            teams = self.registry.list_teams(org_id)
            cost_summary = self.cost.cost_summary(org_id)
            # 统计
            total_plugins = len(PLUGINS_DATA)
            # 活跃插件：通过 audit 中 plugin:install 计算
            install_logs = self.audit.query(org_id=org_id, action="plugin_install", limit=10000)
            installed = list({l.target for l in install_logs})
            active_plugins = len(installed)
            total_installs = len(install_logs)
            active_users = sum(1 for m in members if m.last_active)
            # 顶级插件
            counts: Dict[str, int] = {}
            for l in install_logs:
                counts[l.target] = counts.get(l.target, 0) + 1
            top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
            top_plugins = []
            for pid, count in top:
                p = get_plugin_by_id(pid)
                top_plugins.append({
                    "plugin_id": pid,
                    "name": p.name if p else pid,
                    "installs": count,
                    "rating": p.rating if p else 0.0,
                })
            # 分类使用
            usage_by_category: Dict[str, int] = {}
            for pid, c in counts.items():
                p = get_plugin_by_id(pid)
                if p:
                    usage_by_category[p.category] = usage_by_category.get(p.category, 0) + c
            # 生产力评分（0-100）
            productivity = self._compute_productivity(members, teams, total_installs, active_users)
            snap = DashboardSnapshot(
                org_id=org_id,
                period=cost_summary["period"],
                total_plugins=total_plugins,
                active_plugins=active_plugins,
                total_installs=total_installs,
                active_users=active_users,
                top_plugins=top_plugins,
                usage_by_category=usage_by_category,
                cost_summary={
                    "total_usd": cost_summary["total_usd"],
                    "budget_usd": cost_summary["budget_usd"],
                    "usage_pct": cost_summary["usage_pct"],
                },
                productivity_score=productivity,
            )
            self._snapshots.append(snap)
            return snap

    def _compute_productivity(
        self,
        members: List,
        teams: List,
        total_installs: int,
        active_users: int,
    ) -> float:
        """计算综合生产力评分（0-100）

        公式：
          - 活跃率（40 分）：active_users / max(1, len(members)) * 40
          - 团队覆盖率（20 分）：min(len(teams) / 3, 1) * 20
          - 插件采用率（40 分）：min(total_installs / 50, 1) * 40
        """
        if not members:
            return 0.0
        active_rate = (active_users / max(1, len(members))) * 40.0
        team_coverage = min(len(teams) / 3.0, 1.0) * 20.0
        adoption = min(total_installs / 50.0, 1.0) * 40.0
        score = active_rate + team_coverage + adoption
        return round(min(score, 100.0), 2)

    def top_plugins(self, org_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """组织 top 插件"""
        with self._lock:
            install_logs = self.audit.query(org_id=org_id, action="plugin_install", limit=10000)
            counts: Dict[str, int] = {}
            for l in install_logs:
                counts[l.target] = counts.get(l.target, 0) + 1
            top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
            results = []
            for pid, count in top:
                p = get_plugin_by_id(pid)
                results.append({
                    "plugin_id": pid,
                    "name": p.name if p else pid,
                    "category": p.category if p else "",
                    "installs": count,
                    "rating": p.rating if p else 0.0,
                })
            return results

    def productivity(self, org_id: str) -> Dict[str, Any]:
        """生产力指标"""
        with self._lock:
            members = self.registry.list_members(org_id)
            teams = self.registry.list_teams(org_id)
            install_logs = self.audit.query(org_id=org_id, action="plugin_install", limit=10000)
            active_users = sum(1 for m in members if m.last_active)
            score = self._compute_productivity(members, teams, len(install_logs), active_users)
            return {
                "org_id": org_id,
                "score": score,
                "members": len(members),
                "active_users": active_users,
                "active_rate_pct": round((active_users / max(1, len(members)) * 100), 2),
                "teams": len(teams),
                "installs": len(install_logs),
                "generated_at": _now_iso(),
            }
