"""
# ============================================================
# Hermes Worktree v2 - 持久化存储
# ============================================================
# 核心作用：Worktree 状态的持久化（JSON + JSONL 事件流）
# 特性：线程安全、原子写入、索引管理、过期检测
# Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import WorktreeState, WorktreeStatus, _now_iso

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单
# ============================================================
ALLOWED_STORAGE_PATHS = [
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/home/qizheng/\.hermes"),
    re.compile(r"^/tmp/hermes-worktree"),
    re.compile(r"^/tmp/test-worktree"),
    re.compile(r"^/tmp/worktree_test_"),
    re.compile(r"^/tmp/storage_test_"),
    re.compile(r"^/tmp/lifecycle_test_"),
    re.compile(r"^/tmp/merger_test_"),
    re.compile(r"^/tmp/manager_test_"),
    re.compile(r"^/tmp/e2e_test_"),
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
]


def is_storage_path_allowed(path: str) -> bool:
    """检查存储路径是否在白名单内"""
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_STORAGE_PATHS:
        if pattern.match(path_str):
            return True
    return False


class WorktreeStorage:
    """
    Worktree 持久化存储
    结构：
      root/
        ├── index.jsonl              # 索引（每行一个 Worktree）
        ├── state/<worktree_id>.json # 状态文件
        ├── tasks/<worktree_id>/     # 每个 Worktree 的任务目录
        │   ├── meta.json
        │   ├── history.log
        │   └── diff.patch
        └── archive/                 # 合并后归档
    """

    def __init__(self, root: Optional[str] = None) -> None:
        """初始化存储"""
        if root is None:
            root = os.path.join(os.path.expanduser("~"), ".hermes", "worktree")
        self.root = Path(root).resolve()
        if not is_storage_path_allowed(str(self.root)):
            # 回退到 /tmp
            self.root = Path("/tmp/hermes-worktree").resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "state").mkdir(exist_ok=True)
        (self.root / "tasks").mkdir(exist_ok=True)
        (self.root / "archive").mkdir(exist_ok=True)
        self.index_file = self.root / "index.jsonl"
        if not self.index_file.exists():
            self.index_file.touch()
        self._lock = threading.RLock()
        # 内存索引
        self._states: Dict[str, WorktreeState] = {}
        self._load()

    def _load(self) -> None:
        """加载索引到内存"""
        with self._lock:
            self._states.clear()
            if not self.index_file.exists():
                return
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            wt = WorktreeState.from_dict(data)
                            # 加载完整事件
                            state_file = self.root / "state" / f"{wt.worktree_id}.json"
                            if state_file.exists():
                                with open(state_file, "r", encoding="utf-8") as sf:
                                    full_data = json.load(sf)
                                    wt = WorktreeState.from_dict(full_data)
                            self._states[wt.worktree_id] = wt
                        except (json.JSONDecodeError, KeyError, ValueError) as e:
                            logger.warning(f"Failed to load worktree from index: {e}")
            except Exception as e:
                logger.error(f"Failed to load index: {e}")

    def _append_index(self, wt: WorktreeState) -> None:
        """追加到索引文件（去重更新）"""
        with self._lock:
            lines = []
            found = False
            if self.index_file.exists():
                with open(self.index_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if data.get("worktree_id") == wt.worktree_id:
                                # 跳过旧记录
                                found = True
                                continue
                            lines.append(data)
                        except json.JSONDecodeError:
                            continue
            # 添加新记录（只保留元数据，不含 events 列表）
            new_record = {
                "worktree_id": wt.worktree_id,
                "task_id": wt.task_id,
                "instance_id": wt.instance_id,
                "module_name": wt.module_name,
                "branch_name": wt.branch_name,
                "repo_path": wt.repo_path,
                "worktree_path": wt.worktree_path,
                "status": wt.status.value,
                "created_at": wt.created_at,
                "last_activity_at": wt.last_activity_at,
                "expires_at": wt.expires_at,
                "ttl_hours": wt.ttl_hours,
            }
            lines.append(new_record)
            with open(self.index_file, "w", encoding="utf-8") as f:
                for record in lines:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _save_state(self, wt: WorktreeState) -> None:
        """保存完整状态"""
        with self._lock:
            state_file = self.root / "state" / f"{wt.worktree_id}.json"
            tmp_file = state_file.with_suffix(".tmp")
            try:
                with open(tmp_file, "w", encoding="utf-8") as f:
                    json.dump(wt.to_dict(), f, ensure_ascii=False, indent=2)
                tmp_file.replace(state_file)
            except Exception as e:
                logger.error(f"Failed to save state for {wt.worktree_id}: {e}")
                if tmp_file.exists():
                    tmp_file.unlink()
                raise

    def save(self, wt: WorktreeState) -> WorktreeState:
        """保存 Worktree 状态（同时更新索引和完整文件）"""
        with self._lock:
            self._states[wt.worktree_id] = wt
            self._save_state(wt)
            self._append_index(wt)
            return wt

    def get(self, worktree_id: str) -> Optional[WorktreeState]:
        """获取 Worktree"""
        with self._lock:
            return self._states.get(worktree_id)

    def get_or_raise(self, worktree_id: str) -> WorktreeState:
        """获取 Worktree（不存在则抛错）"""
        wt = self.get(worktree_id)
        if wt is None:
            raise KeyError(f"Worktree not found: {worktree_id}")
        return wt

    def list_all(
        self,
        status: Optional[WorktreeStatus] = None,
        module: Optional[str] = None,
        task_id: Optional[str] = None,
        only_active: bool = False,
    ) -> List[WorktreeState]:
        """列出所有 Worktree"""
        with self._lock:
            results = list(self._states.values())
        if status is not None:
            results = [w for w in results if w.status == status]
        if module is not None:
            results = [w for w in results if w.module_name == module]
        if task_id is not None:
            results = [w for w in results if w.task_id == task_id]
        if only_active:
            results = [w for w in results if not w.is_terminal()]
        # 按创建时间倒序
        results.sort(key=lambda w: w.created_at, reverse=True)
        return results

    def delete(self, worktree_id: str) -> bool:
        """删除 Worktree"""
        with self._lock:
            if worktree_id not in self._states:
                return False
            del self._states[worktree_id]
            # 删除状态文件
            state_file = self.root / "state" / f"{worktree_id}.json"
            if state_file.exists():
                state_file.unlink()
            # 重建索引
            lines = []
            if self.index_file.exists():
                with open(self.index_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if data.get("worktree_id") != worktree_id:
                                lines.append(data)
                        except json.JSONDecodeError:
                            continue
            with open(self.index_file, "w", encoding="utf-8") as f:
                for record in lines:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
            return True

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            all_states = list(self._states.values())
        stats: Dict[str, Any] = {
            "total": len(all_states),
            "by_status": {},
            "by_module": {},
            "expired_count": 0,
            "active_count": 0,
            "terminal_count": 0,
            "conflict_count": 0,
        }
        from datetime import datetime
        for s in WorktreeStatus:
            count = sum(1 for w in all_states if w.status == s)
            stats["by_status"][s.value] = count
        for w in all_states:
            mod = w.module_name or "unknown"
            stats["by_module"][mod] = stats["by_module"].get(mod, 0) + 1
            if w.is_terminal():
                stats["terminal_count"] += 1
            else:
                stats["active_count"] += 1
            if w.conflicts:
                stats["conflict_count"] += len(w.conflicts)
            # 过期检测
            if w.expires_at:
                try:
                    exp = datetime.fromisoformat(w.expires_at)
                    now = datetime.now(exp.tzinfo) if exp.tzinfo else datetime.now()
                    if exp < now and not w.is_terminal():
                        stats["expired_count"] += 1
                except (ValueError, TypeError):
                    pass
        return stats

    def get_expired(self) -> List[WorktreeState]:
        """获取所有过期 Worktree"""
        with self._lock:
            all_states = list(self._states.values())
        from datetime import datetime
        expired = []
        for w in all_states:
            if w.is_terminal() or not w.expires_at:
                continue
            try:
                exp = datetime.fromisoformat(w.expires_at)
                now = datetime.now(exp.tzinfo) if exp.tzinfo else datetime.now()
                if exp < now:
                    expired.append(w)
            except (ValueError, TypeError):
                continue
        return expired

    def create_task_dir(self, worktree_id: str) -> Path:
        """创建任务目录"""
        task_dir = self.root / "tasks" / worktree_id
        task_dir.mkdir(parents=True, exist_ok=True)
        return task_dir

    def archive(self, worktree_id: str) -> Optional[Path]:
        """归档 Worktree（合并后调用）"""
        with self._lock:
            wt = self.get(worktree_id)
            if wt is None:
                return None
            # 创建归档目录
            from datetime import datetime
            month_dir = self.root / "archive" / datetime.now().strftime("%Y-%m")
            month_dir.mkdir(parents=True, exist_ok=True)
            # 写入元数据
            archive_file = month_dir / f"{worktree_id}.json"
            with open(archive_file, "w", encoding="utf-8") as f:
                json.dump(wt.to_dict(), f, ensure_ascii=False, indent=2)
            return archive_file


# ============================================================
# 全局单例
# ============================================================
_storage_instance: Optional[WorktreeStorage] = None


def get_worktree_storage() -> WorktreeStorage:
    """获取全局存储单例"""
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = WorktreeStorage()
    return _storage_instance
