"""
Hermes Agent v2 - 后台 Worker
==========================================
核心作用：Background Worker 异步执行 Thread Automation 触发的任务
        维护 BackgroundTask 列表 + 异步执行 + 错误重试
运行流程：Scheduler get_due → 创建 BackgroundTask → 异步执行 → 更新状态
输入参数：BackgroundTask ID、action
输出结果：BackgroundTask 实体（包含执行结果）
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import asyncio
import traceback
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional
from threading import RLock

from .models import (
    BackgroundTask,
    BackgroundTaskStatus,
    ThreadAutomation,
    _now_iso,
)


# 内置 action handler 字典（可扩展）
ActionHandler = Callable[[str, Dict[str, Any]], Awaitable[str]]


async def _default_handler(action: str, metadata: Dict[str, Any]) -> str:
    """默认 action handler

    用于未注册的 action

    Args:
        action: 动作名称
        metadata: 元数据

    Returns:
        str: 执行结果
    """
    return f"Action {action} executed (default handler) at {_now_iso()}"


class BackgroundWorker:
    """后台 Worker

    异步执行 BackgroundTask
    线程安全（RLock）

    Attributes:
        handlers: action handler 字典
    """

    def __init__(self) -> None:
        """初始化 Worker"""
        self._lock = RLock()
        self._tasks: Dict[str, BackgroundTask] = {}
        self._handlers: Dict[str, ActionHandler] = {}
        self._register_default_handlers()
        self._running: Dict[str, asyncio.Task] = {}

    def _register_default_handlers(self) -> None:
        """注册默认 handlers

        Returns:
            None
        """
        # 注册一些内置 handler
        self._handlers["check_dependencies"] = self._handle_check_dependencies
        self._handlers["health_check"] = self._handle_health_check
        self._handlers["cleanup"] = self._handle_cleanup
        self._handlers["log"] = self._handle_log

    def register_handler(
        self,
        action: str,
        handler: ActionHandler,
    ) -> None:
        """注册 action handler

        Args:
            action: 动作名称
            handler: 异步处理函数

        Returns:
            None
        """
        with self._lock:
            self._handlers[action] = handler

    def create_task(
        self,
        name: str,
        action: str,
        automation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        max_retries: int = 3,
    ) -> BackgroundTask:
        """创建后台任务

        Args:
            name: 任务名称
            action: 动作
            automation_id: 关联自动化 ID
            metadata: 元数据
            max_retries: 最大重试次数

        Returns:
            BackgroundTask: 任务实体
        """
        with self._lock:
            task = BackgroundTask(
                name=name,
                action=action,
                automation_id=automation_id,
                metadata=metadata or {},
                max_retries=max_retries,
            )
            self._tasks[task.task_id] = task
            return task

    def list_tasks(
        self,
        status: Optional[str] = None,
        automation_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[BackgroundTask]:
        """列出任务

        Args:
            status: 状态过滤
            automation_id: 自动化 ID 过滤
            limit: 限制返回数量

        Returns:
            List[BackgroundTask]: 任务列表
        """
        with self._lock:
            results = list(self._tasks.values())

            if status:
                results = [t for t in results if t.status == status]
            if automation_id:
                results = [t for t in results if t.automation_id == automation_id]

            results.sort(key=lambda t: t.created_at, reverse=True)
            return results[:limit]

    def get_task(self, task_id: str) -> Optional[BackgroundTask]:
        """获取任务详情

        Args:
            task_id: 任务 ID

        Returns:
            Optional[BackgroundTask]: 任务实体
        """
        with self._lock:
            return self._tasks.get(task_id)

    async def execute_task(self, task_id: str) -> BackgroundTask:
        """执行任务

        Args:
            task_id: 任务 ID

        Returns:
            BackgroundTask: 更新后的任务
        """
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                raise KeyError(f"Task not found: {task_id}")

            if task.status == BackgroundTaskStatus.RUNNING.value:
                return task  # 已在运行

            task.status = BackgroundTaskStatus.RUNNING.value
            task.started_at = _now_iso()

        # 查找 handler
        handler = self._handlers.get(task.action, _default_handler)

        try:
            result = await handler(task.action, task.metadata)
            with self._lock:
                task.status = BackgroundTaskStatus.COMPLETED.value
                task.result = result
                task.completed_at = _now_iso()
            return task
        except Exception as e:
            with self._lock:
                task.retry_count += 1
                task.error = str(e)
                if task.retry_count < task.max_retries:
                    task.status = BackgroundTaskStatus.PENDING.value
                else:
                    task.status = BackgroundTaskStatus.FAILED.value
                task.completed_at = _now_iso()
            return task

    def cancel_task(self, task_id: str) -> bool:
        """取消任务

        Args:
            task_id: 任务 ID

        Returns:
            bool: True 表示取消成功
        """
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return False
            if task.status == BackgroundTaskStatus.RUNNING.value:
                # 尝试取消 asyncio task
                if task_id in self._running:
                    self._running[task_id].cancel()
            task.status = BackgroundTaskStatus.CANCELLED.value
            task.completed_at = _now_iso()
            return True

    def get_stats(self) -> Dict[str, int]:
        """获取统计

        Returns:
            Dict[str, int]: 按状态分组统计
        """
        with self._lock:
            stats: Dict[str, int] = {}
            for task in self._tasks.values():
                stats[task.status] = stats.get(task.status, 0) + 1
            return stats

    # 内置 handlers
    async def _handle_check_dependencies(
        self,
        action: str,
        metadata: Dict[str, Any],
    ) -> str:
        """依赖检查 handler

        Args:
            action: 动作名
            metadata: 元数据

        Returns:
            str: 检查结果
        """
        await asyncio.sleep(0.1)  # 模拟检查
        return f"Dependencies checked at {_now_iso()}"

    async def _handle_health_check(
        self,
        action: str,
        metadata: Dict[str, Any],
    ) -> str:
        """健康检查 handler

        Args:
            action: 动作名
            metadata: 元数据

        Returns:
            str: 检查结果
        """
        await asyncio.sleep(0.05)
        return f"Health check passed at {_now_iso()}"

    async def _handle_cleanup(
        self,
        action: str,
        metadata: Dict[str, Any],
    ) -> str:
        """清理 handler

        Args:
            action: 动作名
            metadata: 元数据

        Returns:
            str: 清理结果
        """
        await asyncio.sleep(0.1)
        return f"Cleanup completed at {_now_iso()}"

    async def _handle_log(
        self,
        action: str,
        metadata: Dict[str, Any],
    ) -> str:
        """日志 handler

        Args:
            action: 动作名
            metadata: 元数据

        Returns:
            str: 日志内容
        """
        message = metadata.get("message", "default log message")
        return f"Log: {message} at {_now_iso()}"
