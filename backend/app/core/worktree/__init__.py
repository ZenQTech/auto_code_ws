"""
# ============================================================
# Hermes Worktree v2 - 模块入口
# ============================================================
# 核心作用：Worktree 隔离执行系统 v2 入口
# 特性：完整生命周期管理 + 状态机 + 自动合并 + 过期检测
# Cycle 13 P0-1 新建
# ============================================================
"""

from .models import (
    WorktreeState,
    WorktreeStatus,
    WorktreeEvent,
    WorktreeConflict,
    WorktreeMetrics,
)
from .manager import WorktreeManager, get_worktree_manager
from .lifecycle import WorktreeLifecycle
from .merger import WorktreeMerger
from .storage import WorktreeStorage, get_worktree_storage

__all__ = [
    "WorktreeState",
    "WorktreeStatus",
    "WorktreeEvent",
    "WorktreeConflict",
    "WorktreeMetrics",
    "WorktreeManager",
    "get_worktree_manager",
    "WorktreeLifecycle",
    "WorktreeMerger",
    "WorktreeStorage",
    "get_worktree_storage",
]
