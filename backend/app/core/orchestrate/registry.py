"""
# Orchestrate 阶段注册中心
# ============================================================
# 核心作用：管理 StageContract 的注册/查询/注销
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 设计：
#   - 线程安全（threading.RLock）
#   - 支持动态注册/注销
#   - 支持按能力/标签查询
#   - 全局单例（GLOBAL_REGISTRY）
# ============================================================
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from .models import StageContract, StageStatus


class StageRegistry:
    """阶段注册中心"""

    def __init__(self) -> None:
        self._contracts: Dict[str, StageContract] = {}
        self._lock = threading.RLock()

    # ============================================================
    # 注册管理
    # ============================================================

    def register(self, contract: StageContract) -> StageContract:
        """注册阶段"""
        with self._lock:
            self._contracts[contract.stage_id] = contract
            return contract

    def unregister(self, stage_id: str) -> bool:
        """注销阶段"""
        with self._lock:
            if stage_id in self._contracts:
                del self._contracts[stage_id]
                return True
            return False

    def get(self, stage_id: str) -> Optional[StageContract]:
        """获取阶段合约"""
        with self._lock:
            return self._contracts.get(stage_id)

    def has(self, stage_id: str) -> bool:
        """检查阶段是否存在"""
        with self._lock:
            return stage_id in self._contracts

    def update_status(self, stage_id: str, status: StageStatus) -> bool:
        """更新阶段状态"""
        with self._lock:
            if stage_id in self._contracts:
                self._contracts[stage_id].status = status
                return True
            return False

    # ============================================================
    # 查询
    # ============================================================

    def list_all(self, include_disabled: bool = False) -> List[StageContract]:
        """列出所有阶段"""
        with self._lock:
            contracts = list(self._contracts.values())
            if not include_disabled:
                contracts = [
                    c for c in contracts
                    if c.status != StageStatus.DISABLED
                ]
            return contracts

    def find_by_capability(self, capability: str) -> List[StageContract]:
        """按能力查找"""
        with self._lock:
            return [
                c for c in self._contracts.values()
                if capability in c.required_capabilities
            ]

    def find_by_tag(self, tag: str) -> List[StageContract]:
        """按标签查找"""
        with self._lock:
            return [
                c for c in self._contracts.values()
                if tag in c.tags
            ]

    def find_by_name(self, name: str) -> Optional[StageContract]:
        """按名称查找"""
        with self._lock:
            for c in self._contracts.values():
                if c.name == name:
                    return c
            return None

    def search(self, query: str) -> List[StageContract]:
        """全文搜索（名称/描述/标签）"""
        with self._lock:
            q = query.lower()
            results = []
            for c in self._contracts.values():
                if (
                    q in c.name.lower()
                    or q in c.description.lower()
                    or any(q in t.lower() for t in c.tags)
                ):
                    results.append(c)
            return results

    # ============================================================
    # 统计
    # ============================================================

    def count(self) -> int:
        """阶段总数"""
        with self._lock:
            return len(self._contracts)

    def count_by_status(self) -> Dict[str, int]:
        """按状态统计"""
        with self._lock:
            stats: Dict[str, int] = {}
            for c in self._contracts.values():
                key = c.status.value
                stats[key] = stats.get(key, 0) + 1
            return stats

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            all_tags = set()
            all_capabilities = set()
            for c in self._contracts.values():
                all_tags.update(c.tags)
                all_capabilities.update(c.required_capabilities)
            return {
                "total_stages": len(self._contracts),
                "by_status": self.count_by_status(),
                "unique_tags": len(all_tags),
                "unique_capabilities": len(all_capabilities),
                "tags": sorted(all_tags),
                "capabilities": sorted(all_capabilities),
            }

    def clear(self) -> None:
        """清空所有注册（仅用于测试）"""
        with self._lock:
            self._contracts.clear()


# ============================================================
# 全局单例
# ============================================================

GLOBAL_REGISTRY = StageRegistry()
