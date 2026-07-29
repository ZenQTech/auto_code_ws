"""
# ============================================================
# Hermes LLM-as-Judge - 任务存储
# ============================================================
# 核心作用：持久化 Judge 任务（线程安全 + JSONL 索引）
# 特性：
#   - 内存存储 + JSONL 索引
#   - 任务生命周期管理
#   - 状态查询与统计
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import (
    JudgeConsensus,
    JudgeReport,
    JudgeTask,
    JudgeTaskStatus,
    _new_id,
    _now_iso,
)

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单
# ============================================================
ALLOWED_STORE_PATHS = [
    re.compile(r"^/home/qizheng/auto_code_data"),
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/home/qizheng/.hermes"),
    re.compile(r"^/tmp/judge_test_"),
    re.compile(r"^/tmp/llm_judge_"),
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
]


def is_store_path_allowed(path: str) -> bool:
    if not path:
        return True
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_STORE_PATHS:
        if pattern.match(path_str):
            return True
    return False


# ============================================================
# Judge Store
# ============================================================
class JudgeStore:
    """Judge 任务存储"""

    def __init__(self, store_dir: Optional[str] = None):
        if store_dir is None:
            store_dir = str(Path.home() / ".hermes" / "judge")
        self.store_dir = Path(store_dir)
        if is_store_path_allowed(str(self.store_dir)) or str(self.store_dir) == str(Path.home() / ".hermes" / "judge"):
            try:
                self.store_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.warning(f"Create store dir failed: {e}")
        self.tasks_dir = self.store_dir / "tasks"
        try:
            self.tasks_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Create tasks dir failed: {e}")
        self.index_file = self.store_dir / "index.jsonl"
        if not self.index_file.exists():
            try:
                self.index_file.touch()
            except Exception:
                pass
        self._lock = threading.RLock()
        self._tasks: Dict[str, JudgeTask] = {}
        self._load()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def save(self, task: JudgeTask) -> JudgeTask:
        with self._lock:
            self._tasks[task.task_id] = task
            self._save_task(task)
            self._append_index(task)
            return task

    def get(self, task_id: str) -> Optional[JudgeTask]:
        with self._lock:
            return self._tasks.get(task_id)

    def get_or_raise(self, task_id: str) -> JudgeTask:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(f"Task not found: {task_id}")
            return task

    def list(
        self,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[JudgeTask]:
        with self._lock:
            tasks = list(self._tasks.values())
        # 按 created_at 倒序
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        if status:
            tasks = [t for t in tasks if t.status == status]
        return tasks[:limit]

    def delete(self, task_id: str) -> bool:
        with self._lock:
            if task_id not in self._tasks:
                return False
            del self._tasks[task_id]
            try:
                f = self.tasks_dir / f"task_{task_id}.json"
                if f.exists():
                    f.unlink()
            except Exception as e:
                logger.warning(f"Delete task file failed: {e}")
            return True

    # ------------------------------------------------------------------
    # 状态变更
    # ------------------------------------------------------------------
    def update_status(
        self,
        task_id: str,
        status: str,
        error: str = "",
    ) -> JudgeTask:
        with self._lock:
            task = self.get_or_raise(task_id)
            task.status = status
            if error:
                task.error = error
            if status == JudgeTaskStatus.RUNNING.value and not task.started_at:
                task.started_at = _now_iso()
            if status in (
                JudgeTaskStatus.COMPLETED.value,
                JudgeTaskStatus.FAILED.value,
                JudgeTaskStatus.VETOED.value,
            ):
                task.completed_at = _now_iso()
            self._save_task(task)
            return task

    def add_report(self, task_id: str, report: JudgeReport) -> JudgeTask:
        with self._lock:
            task = self.get_or_raise(task_id)
            task.add_report(report)
            self._save_task(task)
            return task

    def set_consensus(self, task_id: str, consensus: JudgeConsensus) -> JudgeTask:
        with self._lock:
            task = self.get_or_raise(task_id)
            task.set_consensus(consensus)
            self._save_task(task)
            return task

    # ------------------------------------------------------------------
    # 统计
    # ------------------------------------------------------------------
    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            tasks = list(self._tasks.values())
        status_count: Dict[str, int] = {}
        for t in tasks:
            status_count[t.status] = status_count.get(t.status, 0) + 1
        total_reports = sum(len(t.reports) for t in tasks)
        passed = sum(1 for t in tasks if t.consensus and t.consensus.overall_pass)
        vetoed = sum(1 for t in tasks if t.consensus and t.consensus.safety_veto)
        return {
            "total_tasks": len(tasks),
            "by_status": status_count,
            "total_reports": total_reports,
            "passed_tasks": passed,
            "vetoed_tasks": vetoed,
            "pass_rate": passed / len(tasks) if tasks else 0.0,
        }

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def _task_file(self, task_id: str) -> Path:
        return self.tasks_dir / f"task_{task_id}.json"

    def _save_task(self, task: JudgeTask) -> None:
        try:
            f = self._task_file(task.task_id)
            tmp = f.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fp:
                json.dump(task.to_dict(), fp, ensure_ascii=False, indent=2)
            tmp.replace(f)
        except Exception as e:
            logger.warning(f"Save task failed: {e}")

    def _append_index(self, task: JudgeTask) -> None:
        try:
            with open(self.index_file, "a", encoding="utf-8") as fp:
                # 索引只存元数据
                index_data = {
                    "task_id": task.task_id,
                    "status": task.status,
                    "domain": task.domain,
                    "difficulty": task.difficulty,
                    "use_consensus": task.use_consensus,
                    "created_at": task.created_at,
                    "completed_at": task.completed_at,
                    "judge_count": len(task.reports),
                    "overall_pass": task.consensus.overall_pass if task.consensus else None,
                    "overall_score": task.consensus.overall_score if task.consensus else None,
                }
                fp.write(json.dumps(index_data, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning(f"Append index failed: {e}")

    def _load(self) -> None:
        if not self.tasks_dir.exists():
            return
        try:
            for f in self.tasks_dir.glob("task_*.json"):
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                task = JudgeTask.from_dict(data)
                self._tasks[task.task_id] = task
        except Exception as e:
            logger.warning(f"Load tasks failed: {e}")


# ============================================================
# 全局单例
# ============================================================
_store_instance: Optional[JudgeStore] = None
_store_lock = threading.Lock()


def get_judge_store() -> JudgeStore:
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = JudgeStore()
    return _store_instance


def reset_judge_store() -> None:
    """重置全局单例（用于测试）"""
    global _store_instance
    _store_instance = None
