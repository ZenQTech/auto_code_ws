"""
# ============================================================
# Hermes Plugin System - 依赖解析器
# ============================================================
# 核心作用：解析 Plugin 之间的依赖关系、版本约束
# 特性：拓扑排序、循环检测、版本冲突检测
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from .base import Plugin, semver_compare
from .exceptions import (
    CircularDependencyError,
    DependencyError,
    VersionConflictError,
)

logger = logging.getLogger(__name__)


class DependencyResolver:
    """
    依赖解析器
    负责：
    - 拓扑排序
    - 循环依赖检测
    - 版本约束检查
    - Hermes 版本兼容性检查
    """

    def __init__(self, hermes_version: str = "6.17.1") -> None:
        """初始化解析器"""
        self.hermes_version = hermes_version

    def check_hermes_version(self, plugin: Plugin) -> bool:
        """检查 Plugin 的 Hermes 版本约束"""
        constraint = plugin.manifest.hermes_version
        if not constraint:
            return True
        return semver_compare(self.hermes_version, constraint)

    def check_python_version(self, plugin: Plugin) -> bool:
        """检查 Python 版本约束"""
        constraint = plugin.manifest.dependencies.python
        if not constraint:
            return True
        import sys
        current = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        return semver_compare(current, constraint)

    def check_node_version(self, plugin: Plugin) -> bool:
        """检查 Node 版本约束"""
        constraint = plugin.manifest.dependencies.node
        if not constraint:
            return True
        try:
            import subprocess
            result = subprocess.run(
                ["node", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                # 输出格式：v18.17.0
                version = result.stdout.strip().lstrip("v")
                return semver_compare(version, constraint)
        except Exception:
            pass
        # 节点不可用时跳过检查
        return True

    def validate_plugin(self, plugin: Plugin) -> List[str]:
        """验证 Plugin 兼容性，返回错误列表"""
        errors = []
        if not self.check_hermes_version(plugin):
            errors.append(
                f"Plugin {plugin.manifest.id} requires Hermes {plugin.manifest.hermes_version}, "
                f"but current is {self.hermes_version}"
            )
        if not self.check_python_version(plugin):
            errors.append(
                f"Plugin {plugin.manifest.id} requires Python {plugin.manifest.dependencies.python}"
            )
        if not self.check_node_version(plugin):
            errors.append(
                f"Plugin {plugin.manifest.id} requires Node {plugin.manifest.dependencies.node}"
            )
        return errors

    def detect_cycle(self, plugins: List[Plugin]) -> Optional[List[str]]:
        """
        检测循环依赖
        返回循环路径（如 ['A', 'B', 'C', 'A']），若无循环返回 None
        """
        # 构建依赖图
        graph: Dict[str, List[str]] = {}
        plugin_map = {p.manifest.id: p for p in plugins}
        for plugin in plugins:
            pid = plugin.manifest.id
            deps = []
            for dep_id in plugin.manifest.dependencies.plugins:
                if dep_id in plugin_map:
                    deps.append(dep_id)
            graph[pid] = deps
        # DFS 检测循环
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {pid: WHITE for pid in graph}
        parent: Dict[str, Optional[str]] = {pid: None for pid in graph}
        cycle_start: Optional[str] = None
        cycle_end: Optional[str] = None

        def dfs(u: str) -> bool:
            nonlocal cycle_start, cycle_end
            color[u] = GRAY
            for v in graph.get(u, []):
                if color.get(v) == GRAY:
                    # 找到循环
                    cycle_start = v
                    cycle_end = u
                    return True
                if color.get(v) == WHITE:
                    parent[v] = u
                    if dfs(v):
                        return True
            color[u] = BLACK
            return False

        for pid in graph:
            if color[pid] == WHITE:
                if dfs(pid):
                    # 重构循环路径
                    cycle = [cycle_end, cycle_start]
                    while cycle_end != cycle_start:
                        cycle_end = parent[cycle_end]
                        if cycle_end is None:
                            break
                        cycle.append(cycle_end)
                    cycle.reverse()
                    return cycle
        return None

    def topological_sort(self, plugins: List[Plugin]) -> List[Plugin]:
        """
        拓扑排序
        返回按依赖顺序排列的 Plugin 列表（被依赖的在前）
        """
        # 先检查循环
        cycle = self.detect_cycle(plugins)
        if cycle:
            raise CircularDependencyError(cycle)
        # 构建图
        graph: Dict[str, List[str]] = {}
        plugin_map = {p.manifest.id: p for p in plugins}
        in_degree: Dict[str, int] = {p.manifest.id: 0 for p in plugins}
        for plugin in plugins:
            pid = plugin.manifest.id
            deps = [d for d in plugin.manifest.dependencies.plugins if d in plugin_map]
            graph[pid] = deps
            in_degree[pid] = len(deps)
        # Kahn 算法
        queue = [pid for pid, deg in in_degree.items() if deg == 0]
        sorted_ids: List[str] = []
        while queue:
            # 选择 ID 最小的（稳定排序）
            queue.sort()
            u = queue.pop(0)
            sorted_ids.append(u)
            for plugin in plugins:
                if u in plugin.manifest.dependencies.plugins:
                    other_id = plugin.manifest.id
                    if other_id in in_degree:
                        in_degree[other_id] -= 1
                        if in_degree[other_id] == 0 and other_id not in sorted_ids:
                            queue.append(other_id)
        return [plugin_map[pid] for pid in sorted_ids if pid in plugin_map]

    def check_all_dependencies(
        self,
        plugins: List[Plugin],
    ) -> Tuple[List[Plugin], List[Plugin]]:
        """
        检查所有 Plugin 的依赖
        返回 (可安装列表, 不可安装列表)
        """
        plugin_map = {p.manifest.id: p for p in plugins}
        available, unavailable = [], []
        for plugin in plugins:
            missing = []
            for dep_id in plugin.manifest.dependencies.plugins:
                if dep_id not in plugin_map:
                    missing.append(dep_id)
            if missing:
                plugin.error_message = f"Missing dependencies: {', '.join(missing)}"
                plugin.mark_error(plugin.error_message)
                unavailable.append(plugin)
            else:
                available.append(plugin)
        return available, unavailable

    def resolve(
        self,
        plugins: List[Plugin],
    ) -> List[Plugin]:
        """
        解析所有 Plugin 依赖并返回加载顺序
        """
        # 1. 验证兼容性
        for plugin in plugins:
            errors = self.validate_plugin(plugin)
            if errors:
                plugin.error_message = "; ".join(errors)
                plugin.mark_error(plugin.error_message)
        # 2. 检查缺失依赖
        available, unavailable = self.check_all_dependencies(plugins)
        # 3. 拓扑排序
        try:
            ordered = self.topological_sort(available)
        except CircularDependencyError as e:
            logger.error(f"Circular dependency detected: {e.details['cycle']}")
            return available
        return ordered


# ============================================================
# 全局单例
# ============================================================
_resolver_instance: Optional[DependencyResolver] = None


def get_resolver() -> DependencyResolver:
    """获取全局 DependencyResolver 单例"""
    global _resolver_instance
    if _resolver_instance is None:
        _resolver_instance = DependencyResolver()
    return _resolver_instance
