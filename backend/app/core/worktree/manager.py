"""
# ============================================================
# Hermes Worktree v2 - 核心管理器
# ============================================================
# 核心作用：Worktree 创建、查询、清理、指标统计
# 特性：完整生命周期编排、与存储/生命周期/合并器集成
# Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import WorktreeState, WorktreeStatus, _now_iso, _new_id
from .storage import WorktreeStorage, get_worktree_storage, is_storage_path_allowed
from .lifecycle import WorktreeLifecycle
from .merger import WorktreeMerger, MergeResult, is_repo_path_allowed

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单 - Worktree 路径
# ============================================================
ALLOWED_WORKTREE_PATHS = [
    re.compile(r"^/home/qizheng/auto_code_data"),
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/tmp/test-worktree"),
    re.compile(r"^/tmp/worktree_test_"),
    re.compile(r"^/tmp/e2e_worktree_"),
    re.compile(r"^/tmp/hermes-worktree"),
]


def is_worktree_path_allowed(path: str) -> bool:
    """检查 Worktree 路径是否在白名单内"""
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_WORKTREE_PATHS:
        if pattern.match(path_str):
            return True
    return False


class WorktreeManager:
    """
    Worktree 核心管理器
    提供：创建、查询、清理、指标、批量操作
    """

    def __init__(
        self,
        storage: Optional[WorktreeStorage] = None,
        lifecycle: Optional[WorktreeLifecycle] = None,
        merger: Optional[WorktreeMerger] = None,
    ) -> None:
        """初始化"""
        self.storage = storage or get_worktree_storage()
        self.lifecycle = lifecycle or WorktreeLifecycle(self.storage)
        self.merger = merger or WorktreeMerger(self.storage, self.lifecycle)
        self._lock = threading.RLock()

    def create(
        self,
        task_id: str,
        module_name: str,
        instance_id: str = "",
        repo_path: str = "",
        worktree_base: str = "",
        ttl_hours: int = 24,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WorktreeState:
        """
        为任务创建 Worktree
        参数：
          task_id: 任务 ID
          module_name: 模块名
          instance_id: CLI 实例 ID
          repo_path: 主仓库路径
          worktree_base: Worktree 基础目录
          ttl_hours: 过期时长（小时）
        """
        with self._lock:
            # ID 生成
            wt_id = _new_id("wt")
            instance_id = instance_id or _new_id("inst")
            # 分支名生成
            safe_module = re.sub(r"[^a-zA-Z0-9_-]", "-", module_name)[:32] or "module"
            safe_task = re.sub(r"[^a-zA-Z0-9_-]", "-", task_id)[:16] or "task"
            branch_name = f"feat/{safe_module}-{safe_task}-{wt_id.split('_')[-1]}"
            # Worktree 路径
            if not worktree_base:
                worktree_base = "/tmp/hermes-worktree"
            worktree_path = str(Path(worktree_base) / wt_id)
            if not is_worktree_path_allowed(worktree_path):
                raise ValueError(f"Worktree path not in whitelist: {worktree_path}")
            if not is_repo_path_allowed(repo_path) and repo_path:
                raise ValueError(f"Repo path not in whitelist: {repo_path}")
            # 创建状态
            wt = WorktreeState(
                worktree_id=wt_id,
                task_id=task_id,
                instance_id=instance_id,
                module_name=module_name,
                branch_name=branch_name,
                repo_path=repo_path,
                worktree_path=worktree_path,
                base_commit=metadata.get("base_commit", "") if metadata else "",
                status=WorktreeStatus.CREATE_PENDING,
                ttl_hours=ttl_hours,
                tags=tags or [],
                metadata=metadata or {},
            )
            # 创建任务目录
            try:
                self.storage.create_task_dir(wt_id)
            except Exception as e:
                logger.warning(f"Failed to create task dir for {wt_id}: {e}")
            # 添加事件
            wt.add_event(
                event_type="created",
                actor="manager",
                payload={
                    "task_id": task_id,
                    "module_name": module_name,
                    "instance_id": instance_id,
                },
                note="Worktree created",
            )
            # 保存
            self.storage.save(wt)
            # 自动激活（如果 metadata 中指定）
            auto_activate = True
            if metadata and "auto_activate" in metadata:
                auto_activate = bool(metadata.get("auto_activate", True))
            if auto_activate:
                try:
                    self.lifecycle.activate(wt_id, note="Auto-activated on create")
                except ValueError as e:
                    logger.warning(f"Auto-activate failed: {e}")
            return self.storage.get_or_raise(wt_id)

    def get(self, worktree_id: str) -> Optional[WorktreeState]:
        """获取 Worktree"""
        return self.storage.get(worktree_id)

    def get_or_raise(self, worktree_id: str) -> WorktreeState:
        """获取 Worktree（不存在则抛错）"""
        return self.storage.get_or_raise(worktree_id)

    def list(
        self,
        status: Optional[WorktreeStatus] = None,
        module: Optional[str] = None,
        task_id: Optional[str] = None,
        only_active: bool = False,
    ) -> List[WorktreeState]:
        """列出 Worktree"""
        return self.storage.list_all(
            status=status,
            module=module,
            task_id=task_id,
            only_active=only_active,
        )

    def get_by_task(self, task_id: str) -> List[WorktreeState]:
        """根据任务 ID 获取所有 Worktree"""
        return self.storage.list_all(task_id=task_id)

    def activate(self, worktree_id: str, note: str = "") -> WorktreeState:
        """激活 Worktree"""
        return self.lifecycle.activate(worktree_id, note=note)

    def commit(self, worktree_id: str, message: str = "", actor: str = "instance") -> WorktreeState:
        """
        Worktree 提交（在 Worktree 内部提交代码）
        真实环境调用：git -C <worktree_path> add . && git commit -m <message>
        """
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            wt.metrics.total_commits += 1
            wt.add_event(
                event_type="commit",
                actor=actor,
                payload={"message": message, "commit_index": wt.metrics.total_commits},
                note=message or f"Commit #{wt.metrics.total_commits}",
            )
            self.storage.save(wt)
            return wt

    def merge(
        self,
        worktree_id: str,
        target_branch: str = "main",
        strategy: str = "auto",
    ) -> MergeResult:
        """合并 Worktree"""
        return self.merger.merge(worktree_id, target_branch=target_branch, strategy=strategy)

    def resolve_conflict(
        self,
        worktree_id: str,
        strategy: str = "ai_assisted",
    ) -> WorktreeState:
        """解决冲突"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            if wt.status != WorktreeStatus.CONFLICT:
                raise ValueError(f"Worktree not in conflict state: {wt.status.value}")
            if strategy in self.merger._conflict_strategies:
                resolver = self.merger._conflict_strategies[strategy]
                resolver(worktree_id, [c.files for c in wt.conflicts if not c.resolved_at][0] if wt.conflicts else [])
            return self.lifecycle.resolve_conflict(worktree_id, resolution=strategy)

    def cleanup(self, worktree_id: str, archive: bool = True) -> WorktreeState:
        """清理 Worktree"""
        with self._lock:
            wt = self.lifecycle.cleanup(worktree_id, note="Manual cleanup")
            if archive:
                try:
                    self.storage.archive(worktree_id)
                except Exception as e:
                    logger.warning(f"Archive failed for {worktree_id}: {e}")
            return wt

    def cleanup_batch(self, worktree_ids: List[str], archive: bool = True) -> List[WorktreeState]:
        """批量清理"""
        results = []
        for wt_id in worktree_ids:
            try:
                results.append(self.cleanup(wt_id, archive=archive))
            except Exception as e:
                logger.error(f"Cleanup failed for {wt_id}: {e}")
        return results

    def scan_expired(self) -> List[WorktreeState]:
        """扫描过期 Worktree"""
        return self.lifecycle.scan_expired()

    def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        stats = self.storage.get_stats()
        return {
            "success": True,
            "service": "worktree",
            "version": "2.0.0",
            "stats": stats,
            "features": [
                "worktree_lifecycle",
                "state_machine",
                "auto_merge",
                "conflict_resolution",
                "expiry_detection",
                "archival",
            ],
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return self.storage.get_stats()

    def get_metrics(self, worktree_id: str) -> Dict[str, Any]:
        """获取 Worktree 指标"""
        wt = self.storage.get_or_raise(worktree_id)
        return {
            "worktree_id": wt.worktree_id,
            "status": wt.status.value,
            "metrics": wt.metrics.to_dict(),
            "event_count": len(wt.events),
            "conflict_count": len(wt.conflicts),
            "lifecycle": self.lifecycle.get_lifecycle_summary(worktree_id),
        }

    def transition(self, worktree_id: str, new_status: WorktreeStatus, note: str = "") -> WorktreeState:
        """手动状态转换"""
        return self.lifecycle.transition(worktree_id, new_status, note=note)


# ============================================================
# 全局单例
# ============================================================
_manager_instance: Optional[WorktreeManager] = None


def get_worktree_manager() -> WorktreeManager:
    """获取全局 WorktreeManager 单例"""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = WorktreeManager()
    return _manager_instance
