"""
# ============================================================
# Hermes Plugin System - 线程安全注册表
# ============================================================
# 核心作用：管理所有 Plugin 实例的注册、查询、生命周期
# 特性：RLock 线程安全、按 ID/Name/Category 查询、统计信息
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

from .base import Plugin, PluginStatus
from .exceptions import PluginAlreadyExistsError, PluginNotFoundError

logger = logging.getLogger(__name__)


class PluginRegistry:
    """
    Plugin 注册表
    线程安全的 Plugin 实例管理
    """

    def __init__(self) -> None:
        """初始化注册表"""
        self._lock = threading.RLock()
        self._plugins: Dict[str, Plugin] = {}  # id -> Plugin
        self._by_name: Dict[str, str] = {}    # name -> id
        self._by_category: Dict[str, List[str]] = {}  # category -> [id]

    def register(self, plugin: Plugin, overwrite: bool = False) -> None:
        """
       注册 Plugin
        overwrite=False 时若已存在则抛异常
        """
        with self._lock:
            plugin_id = plugin.manifest.id
            if plugin_id in self._plugins and not overwrite:
                raise PluginAlreadyExistsError(plugin_id)
            # 注销旧版本（如果存在）
            if plugin_id in self._plugins:
                self._unregister_locked(plugin_id)
            # 注册新版本
            self._plugins[plugin_id] = plugin
            self._by_name[plugin.manifest.name] = plugin_id
            # 按 category 索引
            for category in plugin.manifest.categories:
                if category not in self._by_category:
                    self._by_category[category] = []
                if plugin_id not in self._by_category[category]:
                    self._by_category[category].append(plugin_id)
            logger.info(f"Registered plugin: {plugin_id} v{plugin.manifest.version}")

    def unregister(self, plugin_id: str) -> None:
        """注销 Plugin"""
        with self._lock:
            if plugin_id not in self._plugins:
                raise PluginNotFoundError(plugin_id)
            self._unregister_locked(plugin_id)
            logger.info(f"Unregistered plugin: {plugin_id}")

    def _unregister_locked(self, plugin_id: str) -> None:
        """内部：已加锁的注销"""
        plugin = self._plugins.pop(plugin_id, None)
        if plugin is None:
            return
        # 清理 name 索引
        if plugin.manifest.name in self._by_name:
            if self._by_name[plugin.manifest.name] == plugin_id:
                del self._by_name[plugin.manifest.name]
        # 清理 category 索引
        for category in plugin.manifest.categories:
            if category in self._by_category:
                if plugin_id in self._by_category[category]:
                    self._by_category[category].remove(plugin_id)
                if not self._by_category[category]:
                    del self._by_category[category]

    def get(self, plugin_id: str) -> Plugin:
        """根据 ID 获取 Plugin（不存在抛异常）"""
        with self._lock:
            if plugin_id not in self._plugins:
                raise PluginNotFoundError(plugin_id)
            return self._plugins[plugin_id]

    def get_optional(self, plugin_id: str) -> Optional[Plugin]:
        """根据 ID 获取 Plugin（不存在返回 None）"""
        with self._lock:
            return self._plugins.get(plugin_id)

    def get_by_name(self, name: str) -> Optional[Plugin]:
        """根据 name 获取 Plugin"""
        with self._lock:
            plugin_id = self._by_name.get(name)
            if plugin_id:
                return self._plugins.get(plugin_id)
            return None

    def list_all(self) -> List[Plugin]:
        """列出所有 Plugin"""
        with self._lock:
            return list(self._plugins.values())

    def list_ids(self) -> List[str]:
        """列出所有 Plugin ID"""
        with self._lock:
            return list(self._plugins.keys())

    def list_by_category(self, category: str) -> List[Plugin]:
        """按 category 查询"""
        with self._lock:
            ids = self._by_category.get(category, [])
            return [self._plugins[pid] for pid in ids if pid in self._plugins]

    def list_by_status(self, status: PluginStatus) -> List[Plugin]:
        """按 status 查询"""
        with self._lock:
            return [p for p in self._plugins.values() if p.status == status]

    def list_enabled(self) -> List[Plugin]:
        """列出所有启用的 Plugin"""
        with self._lock:
            return [p for p in self._plugins.values() if p.enabled]

    def enable(self, plugin_id: str) -> Plugin:
        """启用 Plugin"""
        with self._lock:
            plugin = self.get(plugin_id)
            plugin.enable()
            logger.info(f"Enabled plugin: {plugin_id}")
            return plugin

    def disable(self, plugin_id: str) -> Plugin:
        """禁用 Plugin"""
        with self._lock:
            plugin = self.get(plugin_id)
            plugin.disable()
            logger.info(f"Disabled plugin: {plugin_id}")
            return plugin

    def search(self, query: str) -> List[Plugin]:
        """搜索 Plugin（id/name/description/keywords 匹配）"""
        query = query.lower().strip()
        if not query:
            return self.list_all()
        with self._lock:
            results = []
            for plugin in self._plugins.values():
                m = plugin.manifest
                if (
                    query in m.id.lower()
                    or query in m.name.lower()
                    or query in m.description.lower()
                    or any(query in kw.lower() for kw in m.keywords)
                ):
                    results.append(plugin)
            return results

    def get_stats(self) -> Dict[str, Any]:
        """获取注册表统计信息"""
        with self._lock:
            total = len(self._plugins)
            enabled = sum(1 for p in self._plugins.values() if p.enabled)
            error = sum(1 for p in self._plugins.values() if p.status == PluginStatus.ERROR)
            by_status: Dict[str, int] = {}
            for p in self._plugins.values():
                status = p.status.value
                by_status[status] = by_status.get(status, 0) + 1
            return {
                "total": total,
                "enabled": enabled,
                "disabled": total - enabled - error,
                "error": error,
                "by_status": by_status,
                "categories": list(self._by_category.keys()),
                "by_category": {cat: len(ids) for cat, ids in self._by_category.items()},
            }

    def clear(self) -> None:
        """清空注册表"""
        with self._lock:
            self._plugins.clear()
            self._by_name.clear()
            self._by_category.clear()

    def to_dict_list(self) -> List[Dict[str, Any]]:
        """获取所有 Plugin 的字典表示"""
        with self._lock:
            return [p.to_dict() for p in self._plugins.values()]


# ============================================================
# 全局单例
# ============================================================
_registry_instance: Optional[PluginRegistry] = None
_registry_lock = threading.Lock()


def get_registry() -> PluginRegistry:
    """获取全局 PluginRegistry 单例（线程安全）"""
    global _registry_instance
    if _registry_instance is None:
        with _registry_lock:
            if _registry_instance is None:
                _registry_instance = PluginRegistry()
    return _registry_instance
