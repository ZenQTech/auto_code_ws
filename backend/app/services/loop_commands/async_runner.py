"""
# ============================================================
# Async Runner - /loop 异步执行器
# ============================================================
# 核心作用：为 /loop 命令提供异步执行能力，
#          避免阻塞前端请求，通过 SSE 推送进度
# 运行流程：
#   1. 创建 AsyncRunner 单例
#   2. submit(action, context) 提交任务
#   3. 后台 asyncio.Task 执行
#   4. 通过 LoopWorkflowStatus 跟踪状态
#   5. get_status(workflow_id) 查询状态
# 输入参数：无
# 输出结果：AsyncRunner 单例
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class WorkflowStatus(str, Enum):
    """工作流状态"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class LoopWorkflowStatus:
    """Loop 工作流状态"""

    workflow_id: str
    action: str
    status: str
    current_step: int = 0
    total_steps: int = 1
    started_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AsyncRunner:
    """异步执行器单例"""

    _instance: Optional["AsyncRunner"] = None

    def __init__(self) -> None:
        """初始化执行器"""
        self._workflows: Dict[str, LoopWorkflowStatus] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "AsyncRunner":
        """获取单例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def submit(
        self,
        action: str,
        project_path: str,
        params: Optional[Dict[str, Any]] = None,
        executor: Optional[Callable] = None,
    ) -> str:
        """提交异步任务

        Args:
            action: 任务动作 (triage/plan/execute/verify)
            project_path: 项目路径
            params: 额外参数
            executor: 自定义执行函数（用于测试）

        Returns:
            workflow_id
        """
        workflow_id = str(uuid.uuid4())

        workflow = LoopWorkflowStatus(
            workflow_id=workflow_id,
            action=action,
            status=WorkflowStatus.PENDING.value,
        )
        self._workflows[workflow_id] = workflow

        # 创建后台任务
        loop = asyncio.get_event_loop()
        task = loop.create_task(
            self._run_workflow(workflow, project_path, params or {}, executor)
        )
        self._tasks[workflow_id] = task

        return workflow_id

    async def _run_workflow(
        self,
        workflow: LoopWorkflowStatus,
        project_path: str,
        params: Dict[str, Any],
        executor: Optional[Callable] = None,
    ) -> None:
        """运行工作流"""
        workflow.status = WorkflowStatus.RUNNING.value
        workflow.total_steps = 4  # init/load/run/finalize

        try:
            # step 1: 初始化
            workflow.current_step = 1
            await asyncio.sleep(0.1)

            # step 2: 加载服务
            workflow.current_step = 2
            if executor is None:
                executor = self._get_executor(workflow.action, project_path)

            # step 3: 执行
            workflow.current_step = 3
            if asyncio.iscoroutinefunction(executor):
                result = await executor(**params)
            else:
                # 同步执行器在线程池中运行
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None, lambda: executor(**params)
                )

            # step 4: 完成
            workflow.current_step = 4
            workflow.result = result if isinstance(result, dict) else {"data": str(result)}
            workflow.status = WorkflowStatus.COMPLETED.value
            workflow.completed_at = time.time()

        except Exception as e:
            logger.error(f"Workflow {workflow.workflow_id} failed: {e}")
            workflow.status = WorkflowStatus.FAILED.value
            workflow.error = str(e)
            workflow.completed_at = time.time()

    def _get_executor(self, action: str, project_path: str) -> Callable:
        """获取执行器函数

        Args:
            action: 任务动作
            project_path: 项目路径

        Returns:
            执行器函数
        """
        if action == "triage":
            from .triage import TriageService
            return lambda **_: TriageService(project_path).analyze()

        if action == "plan":
            from .plan import PlanService
            return lambda max_iterations=3, **_: PlanService(project_path).execute(
                max_iterations=max_iterations
            )

        if action == "execute":
            from .execute import ExecuteService
            return lambda task_id=None, **_: ExecuteService(project_path).execute(
                task_id=task_id
            )

        if action == "verify":
            from .verify import VerifyService
            return lambda **kwargs: VerifyService(project_path).verify(**kwargs)

        raise ValueError(f"Unknown action: {action}")

    def get_status(self, workflow_id: str) -> Optional[LoopWorkflowStatus]:
        """查询工作流状态"""
        return self._workflows.get(workflow_id)

    def list_workflows(self) -> List[LoopWorkflowStatus]:
        """列出所有工作流"""
        return list(self._workflows.values())

    async def cancel(self, workflow_id: str) -> bool:
        """取消工作流"""
        task = self._tasks.get(workflow_id)
        workflow = self._workflows.get(workflow_id)
        if task is None or workflow is None:
            return False

        task.cancel()
        workflow.status = WorkflowStatus.CANCELLED.value
        workflow.completed_at = time.time()
        return True


def get_async_runner() -> AsyncRunner:
    """获取全局 AsyncRunner 单例"""
    return AsyncRunner.get_instance()
