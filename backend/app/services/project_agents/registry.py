"""
# ============================================================
# Project Agent Registry - 全局注册表 (Cycle 9 P0-17)
# ============================================================
# 核心作用：维护项目路径到子智能体列表的映射，提供注册/查询/刷新接口；
#           同时提供 @identifier 调用的解析入口
# 设计要点：
#   1. 全局单例（get_global_registry）
#   2. 多项目并存：每个项目路径独立维护一份 agents 列表
#   3. 智能匹配：当用户输入 @xxx 时，优先精确匹配；
#                失败则按 when_to_call 关键词进行模糊匹配
#   4. 启动时自动扫描（可关闭）
# 输入参数：项目路径或 name
# 输出结果：ProjectAgent 或列表
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-17 初始化
# ============================================================
"""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Dict, List, Optional, Union

from .parser import ProjectAgent
from .scanner import ProjectAgentScanner

logger = logging.getLogger(__name__)


# ============================================================
# @ 引用解析
# ============================================================
_AT_REFERENCE_RE = re.compile(r"@([A-Za-z0-9_\-\.]+)")


def extract_at_references(text: str) -> List[str]:
    """从文本中提取所有 @ 引用

    Args:
        text: 任意文本（用户输入或 prompt）

    Returns:
        引用名称列表（按出现顺序，去重）
    """
    if not text:
        return []
    seen = []
    for m in _AT_REFERENCE_RE.finditer(text):
        name = m.group(1)
        if name not in seen:
            seen.append(name)
    return seen


# ============================================================
# 全局注册表
# ============================================================
class ProjectAgentRegistry:
    """项目级子智能体全局注册表

    线程安全：使用 RLock 保护内部状态。
    """

    def __init__(self):
        self._lock = threading.RLock()
        # project_path -> {name: ProjectAgent}
        self._by_project: Dict[str, Dict[str, ProjectAgent]] = {}
        # 跨项目索引：name -> [project_path, ...]
        self._global_index: Dict[str, List[str]] = {}

    # ------------------------------------------------------------
    # 注册与刷新
    # ------------------------------------------------------------
    def register_project(self, project_path: Union[str, Path]) -> int:
        """扫描并注册某个项目的所有子智能体

        Args:
            project_path: 项目根目录

        Returns:
            新注册的智能体数量
        """
        project_path = str(Path(project_path).absolute())
        scanner = ProjectAgentScanner(project_path)
        agents = scanner.scan()

        with self._lock:
            # 清理旧的全局索引
            old = self._by_project.get(project_path, {})
            for name in old.keys():
                if name in self._global_index:
                    if project_path in self._global_index[name]:
                        self._global_index[name].remove(project_path)
                    if not self._global_index[name]:
                        del self._global_index[name]

            # 注册新智能体
            new_map: Dict[str, ProjectAgent] = {}
            for agent in agents:
                new_map[agent.name] = agent
                self._global_index.setdefault(agent.name, []).append(project_path)

            self._by_project[project_path] = new_map

        logger.info(
            f"Registered {len(new_map)} agents for project {project_path}"
        )
        return len(new_map)

    def unregister_project(self, project_path: Union[str, Path]) -> bool:
        """从注册表移除某个项目

        Args:
            project_path: 项目根目录

        Returns:
            是否成功移除（项目存在则 True）
        """
        project_path = str(Path(project_path).absolute())
        with self._lock:
            if project_path not in self._by_project:
                return False
            old = self._by_project.pop(project_path)
            for name in old.keys():
                if name in self._global_index:
                    if project_path in self._global_index[name]:
                        self._global_index[name].remove(project_path)
                    if not self._global_index[name]:
                        del self._global_index[name]
        return True

    def refresh_all(self) -> Dict[str, int]:
        """刷新所有已注册项目

        Returns:
            {project_path: agent_count} 字典
        """
        with self._lock:
            project_paths = list(self._by_project.keys())
        results: Dict[str, int] = {}
        for pp in project_paths:
            try:
                results[pp] = self.register_project(pp)
            except Exception as e:
                logger.error(f"Refresh failed for {pp}: {e}")
                results[pp] = -1
        return results

    # ------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------
    def list_agents(self, project_path: Optional[Union[str, Path]] = None) -> List[ProjectAgent]:
        """列出项目下所有子智能体

        Args:
            project_path: 项目根目录；None 表示列出所有项目

        Returns:
            ProjectAgent 列表
        """
        with self._lock:
            if project_path is None:
                result: List[ProjectAgent] = []
                for m in self._by_project.values():
                    result.extend(m.values())
                return result
            pp = str(Path(project_path).absolute())
            m = self._by_project.get(pp, {})
            return list(m.values())

    def list_project_paths(self) -> List[str]:
        """列出所有已注册项目路径"""
        with self._lock:
            return list(self._by_project.keys())

    def get_agent(
        self,
        name: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Optional[ProjectAgent]:
        """按 name 查找子智能体

        Args:
            name: 子智能体名
            project_path: 项目根目录；None 时跨项目查找（按注册顺序）

        Returns:
            找到则返回 ProjectAgent，否则 None
        """
        with self._lock:
            if project_path is not None:
                pp = str(Path(project_path).absolute())
                m = self._by_project.get(pp, {})
                return m.get(name)

            # 跨项目：返回第一个匹配
            for m in self._by_project.values():
                if name in m:
                    return m[name]
            return None

    def find_suggested(
        self,
        query: str,
        project_path: Optional[Union[str, Path]] = None,
        top_k: int = 3,
    ) -> List[tuple]:
        """根据 query 推荐合适的子智能体

        Args:
            query: 用户查询/任务描述
            project_path: 项目根目录；None 时跨项目
            top_k: 返回前 k 个

        Returns:
            [(ProjectAgent, score), ...] 按 score 降序
        """
        agents = self.list_agents(project_path)
        scored = [(a, a.matches_query(query)) for a in agents if a.callable]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [(a, s) for a, s in scored[:top_k] if s > 0]

    def resolve_references(
        self,
        text: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Optional[ProjectAgent]]:
        """解析文本中的 @ 引用

        Args:
            text: 用户输入文本
            project_path: 项目根目录

        Returns:
            {name: ProjectAgent or None} - 引用名到智能体的映射
        """
        names = extract_at_references(text)
        return {n: self.get_agent(n, project_path) for n in names}

    def get_stats(self) -> Dict[str, int]:
        """获取注册表统计信息"""
        with self._lock:
            return {
                "projects": len(self._by_project),
                "agents": sum(len(m) for m in self._by_project.values()),
                "unique_names": len(self._global_index),
            }


# ============================================================
# 全局单例
# ============================================================
_global_registry: Optional[ProjectAgentRegistry] = None
_global_lock = threading.Lock()


def get_global_registry() -> ProjectAgentRegistry:
    """获取全局注册表单例"""
    global _global_registry
    if _global_registry is None:
        with _global_lock:
            if _global_registry is None:
                _global_registry = ProjectAgentRegistry()
    return _global_registry


def reset_global_registry() -> None:
    """重置全局注册表（仅用于测试）"""
    global _global_registry
    with _global_lock:
        _global_registry = None
