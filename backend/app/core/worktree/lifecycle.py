"""
# ============================================================
# Hermes Worktree v2 - 生命周期管理
# ============================================================
# 核心作用：Worktree 状态机推进、过期检测、自动转换
# 特性：状态转换规则校验、自动过期扫描、指标更新
# Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from .models import WorktreeState, WorktreeStatus, ALLOWED_TRANSITIONS
from .storage import WorktreeStorage, get_worktree_storage

logger = logging.getLogger(__name__)


class WorktreeLifecycle:
    """
    Worktree 生命周期管理器
    负责：状态机推进、过期检测、生命周期回调
    """

    def __init__(self, storage: Optional[WorktreeStorage] = None) -> None:
        """初始化"""
        self.storage = storage or get_worktree_storage()
        self._lock = threading.RLock()
        self._hooks: Dict[str, List[Callable[[WorktreeState, WorktreeState], None]]] = {
            "before_transition": [],
            "after_transition": [],
            "on_expire": [],
        }

    def register_hook(self, event: str, callback: Callable[[WorktreeState, WorktreeState], None]) -> None:
        """注册生命周期钩子"""
        with self._lock:
            if event not in self._hooks:
                self._hooks[event] = []
            self._hooks[event].append(callback)

    def _fire_hooks(self, event: str, old_state: WorktreeState, new_state: WorktreeState) -> None:
        """触发钩子"""
        for cb in self._hooks.get(event, []):
            try:
                cb(old_state, new_state)
            except Exception as e:
                logger.error(f"Hook {event} failed: {e}")

    def can_transition(self, worktree_id: str, new_status: WorktreeStatus) -> bool:
        """判断是否可以转换"""
        wt = self.storage.get(worktree_id)
        if wt is None:
            return False
        return wt.can_transition_to(new_status)

    def transition(self, worktree_id: str, new_status: WorktreeStatus, note: str = "") -> WorktreeState:
        """执行状态转换"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            old_status = wt.status
            if not wt.can_transition_to(new_status):
                raise ValueError(
                    f"Invalid transition: {old_status.value} -> {new_status.value}"
                )
            self._fire_hooks("before_transition", wt, wt)
            wt.transition(new_status, note=note)
            self.storage.save(wt)
            self._fire_hooks("after_transition", wt, wt)
            logger.info(f"Worktree {worktree_id}: {old_status.value} -> {new_status.value}")
            return wt

    def activate(self, worktree_id: str, note: str = "") -> WorktreeState:
        """激活 Worktree"""
        return self.transition(worktree_id, WorktreeStatus.ACTIVE, note=note)

    def start_merge(self, worktree_id: str, note: str = "") -> WorktreeState:
        """开始合并"""
        return self.transition(worktree_id, WorktreeStatus.AUTO_MERGE_PENDING, note=note)

    def mark_merged(self, worktree_id: str, note: str = "") -> WorktreeState:
        """标记为已合并"""
        return self.transition(worktree_id, WorktreeStatus.MERGED, note=note)

    def mark_conflict(self, worktree_id: str, files: List[str], note: str = "") -> WorktreeState:
        """标记为冲突"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            wt.add_conflict(files=files, note=note)
            wt.error_message = f"Conflict in {len(files)} file(s)"
            return self.transition(worktree_id, WorktreeStatus.CONFLICT, note=note)

    def resolve_conflict(self, worktree_id: str, resolution: str = "manual", note: str = "") -> WorktreeState:
        """解决冲突"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            for c in wt.conflicts:
                if not c.resolved_at:
                    from datetime import datetime, timezone
                    c.resolved_at = datetime.now(timezone.utc).isoformat()
                    c.resolution = resolution
            wt.error_message = ""
            return self.transition(worktree_id, WorktreeStatus.MERGED, note=note or f"Conflict resolved: {resolution}")

    def mark_failed(self, worktree_id: str, error: str = "", note: str = "") -> WorktreeState:
        """标记为失败"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            wt.error_message = error
            return self.transition(worktree_id, WorktreeStatus.FAILED, note=note or error)

    def expire(self, worktree_id: str) -> WorktreeState:
        """过期 Worktree"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            if wt.is_terminal():
                return wt
            old = wt
            wt = self.transition(worktree_id, WorktreeStatus.EXPIRED, note="TTL expired")
            self._fire_hooks("on_expire", old, wt)
            return wt

    def cleanup(self, worktree_id: str, note: str = "") -> WorktreeState:
        """清理 Worktree"""
        with self._lock:
            wt = self.storage.get_or_raise(worktree_id)
            if wt.status not in (WorktreeStatus.MERGED, WorktreeStatus.FAILED, WorktreeStatus.EXPIRED, WorktreeStatus.CONFLICT):
                # 强制转为 FAILED 再清理
                wt.error_message = wt.error_message or "Force cleaned from non-terminal state"
                self.transition(worktree_id, WorktreeStatus.FAILED, note="Force cleanup")
                wt = self.storage.get_or_raise(worktree_id)
            return self.transition(worktree_id, WorktreeStatus.CLEANED, note=note or "Cleaned")

    def scan_expired(self) -> List[WorktreeState]:
        """扫描过期 Worktree 并自动转换"""
        expired = self.storage.get_expired()
        results = []
        for wt in expired:
            try:
                result = self.expire(wt.worktree_id)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to expire worktree {wt.worktree_id}: {e}")
        return results

    def get_lifecycle_summary(self, worktree_id: str) -> Dict[str, Any]:
        """获取生命周期摘要"""
        wt = self.storage.get_or_raise(worktree_id)
        now = datetime.now()
        # 计算各阶段耗时
        durations: Dict[str, int] = {}
        try:
            if wt.activated_at:
                act = datetime.fromisoformat(wt.activated_at)
                durations["pending_to_active_ms"] = int((act - datetime.fromisoformat(wt.created_at)).total_seconds() * 1000)
            if wt.completed_at:
                comp = datetime.fromisoformat(wt.completed_at)
                base = datetime.fromisoformat(wt.activated_at) if wt.activated_at else datetime.fromisoformat(wt.created_at)
                durations["active_to_completed_ms"] = int((comp - base).total_seconds() * 1000)
                durations["total_lifecycle_ms"] = int((comp - datetime.fromisoformat(wt.created_at)).total_seconds() * 1000)
        except (ValueError, TypeError):
            pass
        return {
            "worktree_id": wt.worktree_id,
            "status": wt.status.value,
            "is_terminal": wt.is_terminal(),
            "created_at": wt.created_at,
            "activated_at": wt.activated_at,
            "completed_at": wt.completed_at,
            "expires_at": wt.expires_at,
            "durations": durations,
            "event_count": len(wt.events),
            "conflict_count": len(wt.conflicts),
            "allowed_transitions": [s.value for s in ALLOWED_TRANSITIONS.get(wt.status, [])],
        }
