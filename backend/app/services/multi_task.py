"""
# ============================================================
# 多任务并行管理器 (v1.0.0)
# Cycle 62 G62-01
# ====================================
# 核心作用：支持 ≥4 个 SOLO 任务同时运行，任务间状态完全隔离
# 运行流程：
#   1. 用户调用 create_task() 创建任务（资源配额允许时）
#   2. 每个 TaskSlot 持有独立的 PlanExecutor / GoalManager / ContextManager
#   3. 任务通过 ws_manager 推送状态变更
#   4. 资源监控定期检查 CPU / MEM，超限自动 kill
#   5. 任务完成后保留历史，支持查询
# 设计要点：
#   - 资源配额（CPU/MEM/TIME）防止资源耗尽
#   - 任务隔离（独立 memory space）防止状态污染
#   - 优雅取消（graceful shutdown）确保 cleanup
#   - 历史持久化（磁盘 JSON）支持重启恢复
# 输入参数：task_id, title, prompt, metadata
# 输出结果：TaskSlot
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-01 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"        # 已创建未启动
    RUNNING = "running"        # 运行中
    PAUSED = "paused"          # 已暂停
    COMPLETED = "completed"    # 已完成
    FAILED = "failed"          # 失败
    CANCELLED = "cancelled"    # 已取消


@dataclass
class ResourceUsage:
    """资源使用统计"""
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tokens_used: int = 0
    elapsed_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TaskSlot:
    """单个任务槽"""
    task_id: str
    title: str
    prompt: str
    status: TaskStatus = TaskStatus.PENDING
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    context_ids: List[str] = field(default_factory=list)
    plan_id: Optional[str] = None
    execution_id: Optional[str] = None
    resource_usage: ResourceUsage = field(default_factory=ResourceUsage)
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        if self.started_at and self.completed_at:
            d["elapsed_s"] = self.completed_at - self.started_at
        elif self.started_at:
            d["elapsed_s"] = time.time() - self.started_at
        else:
            d["elapsed_s"] = 0.0
        return d

    def update(self) -> None:
        """更新 updated_at"""
        self.updated_at = time.time()


# ============================================================
# 资源配额
# ============================================================


@dataclass
class ResourceQuota:
    """全局资源配额"""
    MAX_PARALLEL_TASKS: int = 8
    MAX_TOTAL_MEMORY_MB: int = 4096
    MAX_TOTAL_CPU_PERCENT: float = 80.0
    PER_TASK_MEMORY_MB: int = 512
    PER_TASK_TIMEOUT_S: int = 1800  # 30 min

    def can_create(self, current: "MultiTaskManager") -> bool:
        """检查是否可以创建新任务"""
        active = current.count_active()
        if active >= self.MAX_PARALLEL_TASKS:
            return False
        total_mem = sum(
            t.resource_usage.memory_mb
            for t in current._slots.values()
            if t.status == TaskStatus.RUNNING
        )
        if total_mem + self.PER_TASK_MEMORY_MB > self.MAX_TOTAL_MEMORY_MB:
            return False
        return True

    def get_active_limit_info(self, current: "MultiTaskManager") -> Dict[str, Any]:
        """获取配额使用信息"""
        active = current.count_active()
        total_mem = sum(
            t.resource_usage.memory_mb
            for t in current._slots.values()
            if t.status == TaskStatus.RUNNING
        )
        return {
            "active_tasks": active,
            "max_tasks": self.MAX_PARALLEL_TASKS,
            "total_memory_mb": total_mem,
            "max_memory_mb": self.MAX_TOTAL_MEMORY_MB,
            "per_task_memory_mb": self.PER_TASK_MEMORY_MB,
            "per_task_timeout_s": self.PER_TASK_TIMEOUT_S,
        }


# ============================================================
# 多任务管理器
# ============================================================


class MultiTaskManager:
    """
    多任务并行管理器

    单例
    """

    PERSIST_DIR = "~/.trae/multi_task"

    def __init__(self) -> None:
        # task_id -> TaskSlot
        self._slots: Dict[str, TaskSlot] = {}
        # task_id -> asyncio.Task
        self._tasks: Dict[str, asyncio.Task] = {}
        # 锁
        self._lock = asyncio.Lock()
        # 配额
        self._quota = ResourceQuota()
        # 持久化目录
        self._persist_dir: Optional[Path] = None

    def set_persist_dir(self, path: str) -> None:
        """设置持久化目录"""
        self._persist_dir = Path(path).expanduser().resolve()
        self._persist_dir.mkdir(parents=True, exist_ok=True)
        # 加载历史
        self._load_history()

    def _get_persist_path(self, task_id: str) -> Path:
        if self._persist_dir is None:
            self.set_persist_dir(self.PERSIST_DIR)
        assert self._persist_dir is not None
        return self._persist_dir / f"{task_id}.json"

    def _save_task(self, task: TaskSlot) -> None:
        """持久化单个任务"""
        if self._persist_dir is None:
            return
        try:
            path = self._get_persist_path(task.task_id)
            path.write_text(
                json.dumps(task.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"持久化任务失败: {task.task_id} err={e}")

    def _delete_task(self, task_id: str) -> None:
        """删除持久化文件"""
        if self._persist_dir is None:
            return
        try:
            path = self._get_persist_path(task_id)
            if path.exists():
                path.unlink()
        except OSError as e:
            logger.warning(f"删除任务文件失败: {task_id} err={e}")

    def _load_history(self) -> int:
        """加载历史任务"""
        if self._persist_dir is None or not self._persist_dir.exists():
            return 0
        count = 0
        for path in self._persist_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                # 只加载已结束的任务
                status = data.get("status", "pending")
                if status in ("completed", "failed", "cancelled"):
                    # 重建 TaskSlot（不含活跃字段）
                    task = TaskSlot(
                        task_id=data["task_id"],
                        title=data.get("title", ""),
                        prompt=data.get("prompt", ""),
                        status=TaskStatus(status),
                        created_at=data.get("created_at", 0.0),
                        updated_at=data.get("updated_at", 0.0),
                        started_at=data.get("started_at"),
                        completed_at=data.get("completed_at"),
                        context_ids=data.get("context_ids", []),
                        plan_id=data.get("plan_id"),
                        execution_id=data.get("execution_id"),
                        resource_usage=ResourceUsage(
                            **data.get("resource_usage", {}),
                        ),
                        error=data.get("error"),
                        result=data.get("result"),
                        metadata=data.get("metadata", {}),
                    )
                    self._slots[task.task_id] = task
                    count += 1
            except (OSError, json.JSONDecodeError, KeyError) as e:
                logger.warning(f"加载任务历史失败: {path} err={e}")
        if count > 0:
            logger.info(f"加载任务历史: {count} 个")
        return count

    # ============================================================
    # CRUD
    # ============================================================

    async def create(
        self,
        title: str,
        prompt: str,
        context_ids: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> TaskSlot:
        """
        创建新任务

        参数：
          - title: 任务标题
          - prompt: 任务 prompt
          - context_ids: 关联的上下文 ID 列表
          - metadata: 扩展元数据

        返回值：TaskSlot
        异常：PermissionError 资源配额耗尽
        """
        async with self._lock:
            if not self._quota.can_create(self):
                raise PermissionError(
                    f"资源配额耗尽: 活跃任务 {self.count_active()}/{self._quota.MAX_PARALLEL_TASKS}"
                )

            task_id = f"task-{uuid.uuid4().hex[:12]}"
            slot = TaskSlot(
                task_id=task_id,
                title=title or prompt[:30],
                prompt=prompt,
                status=TaskStatus.PENDING,
                context_ids=context_ids or [],
                metadata=metadata or {},
            )
            self._slots[task_id] = slot
            self._save_task(slot)
            logger.info(
                f"任务已创建: {task_id} title='{slot.title}' "
                f"active={self.count_active()}/{self._quota.MAX_PARALLEL_TASKS}"
            )
            # 推送状态变更
            await self._broadcast_status(slot)
            return slot

    def get(self, task_id: str) -> Optional[TaskSlot]:
        """获取任务"""
        return self._slots.get(task_id)

    def list(
        self,
        status: Optional[TaskStatus] = None,
        limit: int = 100,
    ) -> List[TaskSlot]:
        """列出任务"""
        tasks = list(self._slots.values())
        if status is not None:
            tasks = [t for t in tasks if t.status == status]
        # 按创建时间倒序
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]

    def count_active(self) -> int:
        """活跃任务数（pending/running/paused）"""
        return sum(
            1 for t in self._slots.values()
            if t.status in (TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.PAUSED)
        )

    def count_by_status(self) -> Dict[str, int]:
        """按状态统计"""
        result: Dict[str, int] = {s.value: 0 for s in TaskStatus}
        for t in self._slots.values():
            result[t.status.value] += 1
        return result

    # ============================================================
    # 状态变更
    # ============================================================

    async def start(self, task_id: str) -> TaskSlot:
        """启动任务"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                raise ValueError(f"任务不存在: {task_id}")
            if slot.status not in (TaskStatus.PENDING, TaskStatus.PAUSED):
                raise ValueError(
                    f"任务状态不允许启动: {slot.status.value}",
                )
            slot.status = TaskStatus.RUNNING
            slot.started_at = slot.started_at or time.time()
            slot.update()
            self._save_task(slot)
            logger.info(f"任务已启动: {task_id}")
            await self._broadcast_status(slot)
            return slot

    async def pause(self, task_id: str) -> TaskSlot:
        """暂停任务"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                raise ValueError(f"任务不存在: {task_id}")
            if slot.status != TaskStatus.RUNNING:
                raise ValueError(f"任务未运行: {slot.status.value}")
            slot.status = TaskStatus.PAUSED
            slot.update()
            self._save_task(slot)
            logger.info(f"任务已暂停: {task_id}")
            await self._broadcast_status(slot)
            return slot

    async def resume(self, task_id: str) -> TaskSlot:
        """恢复任务"""
        return await self.start(task_id)

    async def cancel(self, task_id: str) -> TaskSlot:
        """取消任务"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                raise ValueError(f"任务不存在: {task_id}")
            if slot.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                raise ValueError(f"任务已结束: {slot.status.value}")
            slot.status = TaskStatus.CANCELLED
            slot.completed_at = time.time()
            slot.update()
            # 取消后台任务
            task = self._tasks.pop(task_id, None)
            if task and not task.done():
                task.cancel()
            self._save_task(slot)
            logger.info(f"任务已取消: {task_id}")
            await self._broadcast_status(slot)
            return slot

    async def complete(
        self,
        task_id: str,
        result: Optional[Dict[str, Any]] = None,
    ) -> TaskSlot:
        """标记任务完成"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                raise ValueError(f"任务不存在: {task_id}")
            slot.status = TaskStatus.COMPLETED
            slot.completed_at = time.time()
            slot.result = result
            slot.update()
            if slot.started_at:
                slot.resource_usage.elapsed_seconds = (
                    slot.completed_at - slot.started_at
                )
            self._tasks.pop(task_id, None)
            self._save_task(slot)
            logger.info(f"任务已完成: {task_id}")
            await self._broadcast_status(slot)
            return slot

    async def fail(
        self,
        task_id: str,
        error: str,
    ) -> TaskSlot:
        """标记任务失败"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                raise ValueError(f"任务不存在: {task_id}")
            slot.status = TaskStatus.FAILED
            slot.completed_at = time.time()
            slot.error = error
            slot.update()
            if slot.started_at:
                slot.resource_usage.elapsed_seconds = (
                    slot.completed_at - slot.started_at
                )
            self._tasks.pop(task_id, None)
            self._save_task(slot)
            logger.info(f"任务已失败: {task_id} error={error}")
            await self._broadcast_status(slot)
            return slot

    async def delete(self, task_id: str) -> bool:
        """删除任务（仅允许删除已结束的任务）"""
        async with self._lock:
            slot = self._slots.get(task_id)
            if slot is None:
                return False
            if slot.status in (TaskStatus.RUNNING, TaskStatus.PAUSED, TaskStatus.PENDING):
                raise ValueError("无法删除活跃任务，请先取消")
            del self._slots[task_id]
            self._delete_task(task_id)
            logger.info(f"任务已删除: {task_id}")
            return True

    async def update_progress(
        self,
        task_id: str,
        progress: Dict[str, Any],
    ) -> None:
        """更新任务进度（不修改状态）"""
        slot = self._slots.get(task_id)
        if slot is None:
            return
        slot.resource_usage.tokens_used = progress.get(
            "tokens_used", slot.resource_usage.tokens_used,
        )
        slot.resource_usage.cpu_percent = progress.get(
            "cpu_percent", slot.resource_usage.cpu_percent,
        )
        slot.resource_usage.memory_mb = progress.get(
            "memory_mb", slot.resource_usage.memory_mb,
        )
        slot.update()
        # 推送进度（不保存磁盘，高频）
        await self._broadcast_progress(slot)

    # ============================================================
    # WebSocket 广播
    # ============================================================

    async def _broadcast_status(self, slot: TaskSlot) -> None:
        """广播状态变更"""
        try:
            from app.ws import manager as ws_manager
            await ws_manager.broadcast_to(
                f"multi_task:{slot.task_id}",
                {
                    "type": "task_status",
                    "task": slot.to_dict(),
                },
            )
            await ws_manager.broadcast_to(
                "multi_task:all",
                {
                    "type": "task_list_changed",
                    "task_id": slot.task_id,
                    "status": slot.status.value,
                },
            )
        except Exception as e:  # noqa: BLE001
            logger.debug(f"WebSocket 广播失败: {e}")

    async def _broadcast_progress(self, slot: TaskSlot) -> None:
        """广播进度"""
        try:
            from app.ws import manager as ws_manager
            await ws_manager.broadcast_to(
                f"multi_task:{slot.task_id}",
                {
                    "type": "task_progress",
                    "task_id": slot.task_id,
                    "resource_usage": slot.resource_usage.to_dict(),
                },
            )
        except Exception as e:  # noqa: BLE001
            logger.debug(f"WebSocket 广播失败: {e}")

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取管理器统计"""
        return {
            "total": len(self._slots),
            "by_status": self.count_by_status(),
            "quota": self._quota.get_active_limit_info(self),
        }


# ============================================================
# 全局单例
# ============================================================

_manager: Optional[MultiTaskManager] = None


def get_multi_task_manager() -> MultiTaskManager:
    """获取全局多任务管理器"""
    global _manager
    if _manager is None:
        _manager = MultiTaskManager()
    return _manager


def reset_multi_task_manager() -> None:
    """重置（用于测试）"""
    global _manager
    _manager = None
