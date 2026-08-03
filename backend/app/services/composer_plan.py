"""
# ============================================================
# ComposerPlan 服务 - Composer 模式可执行计划 (v1.0.0)
# Cycle 58 G58-05
# ============================================================
# 核心作用：为 Vibe Coding / Composer 模式提供轻量级可执行计划
#           与 plan_mode.py 的区别：
#             - plan_mode:    Workflow 级 Plan（含 spec/architecture）
#             - composer_plan: Composer 级 Plan（轻量、即时、可中断恢复）
# 运行流程：
#   1. Composer 创建 Plan（手动 / LLM 生成）
#   2. 用户在 UI 端查看 + 编辑步骤
#   3. 用户点击"一键执行" → plan.start()
#   4. 服务按依赖顺序执行 step.run()
#   5. 通过 SSE 实时推送 step_started/step_completed/step_failed
#   6. 支持 pause / resume / cancel / retry
# 设计要点：
#   - 每个 step 是独立 unit，可单独失败/重试
#   - step 状态机：pending→ready→running→completed/failed/skipped
#   - 依赖图：按 topo 顺序自动选择 ready 步骤
#   - 失败可恢复：failed step 可重新进入 ready
# 输入参数：ComposerPlanRequest
# 输出结果：ComposerPlan dict + SSE 事件流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-05 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Deque, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


# ============================================================
# 状态与类型
# ============================================================


class StepStatus(str, Enum):
    """Composer 步骤状态机"""
    PENDING = "pending"           # 已创建，未满足依赖
    READY = "ready"               # 依赖满足，可执行
    RUNNING = "running"           # 正在执行
    COMPLETED = "completed"       # 已完成
    FAILED = "failed"             # 失败
    SKIPPED = "skipped"           # 跳过（被用户或编排逻辑）
    CANCELLED = "cancelled"       # 取消（用户中断）


class PlanStatus(str, Enum):
    """Plan 整体状态"""
    DRAFT = "draft"               # 草稿：可编辑
    READY = "ready"               # 就绪：可启动
    RUNNING = "running"           # 执行中
    PAUSED = "paused"             # 暂停
    COMPLETED = "completed"       # 全部完成
    FAILED = "failed"             # 至少一个 step 失败且未恢复
    CANCELLED = "cancelled"       # 用户取消


# 合法 step 状态迁移图
# 注：PENDING -> RUNNING 也允许（用于跳过 READY 直接启动的场景，如手动触发）
ALLOWED_STEP_TRANSITIONS: Dict[StepStatus, List[StepStatus]] = {
    StepStatus.PENDING: [StepStatus.READY, StepStatus.RUNNING, StepStatus.SKIPPED, StepStatus.CANCELLED, StepStatus.FAILED],
    StepStatus.READY: [StepStatus.RUNNING, StepStatus.SKIPPED, StepStatus.CANCELLED, StepStatus.PENDING],
    StepStatus.RUNNING: [StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.CANCELLED, StepStatus.PENDING],
    StepStatus.COMPLETED: [StepStatus.PENDING],  # 允许重置
    StepStatus.FAILED: [StepStatus.READY, StepStatus.PENDING, StepStatus.SKIPPED, StepStatus.CANCELLED],
    StepStatus.SKIPPED: [StepStatus.READY, StepStatus.PENDING],
    StepStatus.CANCELLED: [StepStatus.READY, StepStatus.PENDING],
}


# ============================================================
# 数据模型
# ============================================================


@dataclass
class ComposerStep:
    """
    单个 Composer 步骤
    字段说明：
      - step_id: 唯一 ID（auto uuid）
      - title: 步骤标题
      - description: 步骤描述
      - action: 动作名（如 "run_shell" / "edit_file" / "llm_call"）
      - params: 动作参数 dict
      - depends_on: 依赖的 step_id 列表
      - status: 当前状态
      - progress: 0-1
      - error: 错误信息
      - attempts: 已尝试次数
      - max_attempts: 最大尝试次数
      - started_at / finished_at: 时间戳
    """
    step_id: str = ""
    title: str = ""
    description: str = ""
    action: str = ""
    params: Dict = field(default_factory=dict)
    depends_on: List[str] = field(default_factory=list)
    status: StepStatus = StepStatus.PENDING
    progress: float = 0.0
    error: Optional[str] = None
    attempts: int = 0
    max_attempts: int = 1
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    output: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "step_id": self.step_id,
            "title": self.title,
            "description": self.description,
            "action": self.action,
            "params": dict(self.params),
            "depends_on": list(self.depends_on),
            "status": self.status.value,
            "progress": self.progress,
            "error": self.error,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "output": dict(self.output),
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "ComposerStep":
        if not d:
            return cls()
        # 规范化 status
        d = dict(d)
        try:
            d["status"] = StepStatus(d.get("status", "pending"))
        except ValueError:
            d["status"] = StepStatus.PENDING
        # 过滤未知字段
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class ComposerPlan:
    """
    Composer 计划
    字段说明：
      - plan_id: 唯一 ID
      - title: 标题
      - description: 描述
      - steps: 步骤列表
      - status: 整体状态
      - created_at / started_at / finished_at
    """
    plan_id: str = ""
    title: str = ""
    description: str = ""
    steps: List[ComposerStep] = field(default_factory=list)
    status: PlanStatus = PlanStatus.DRAFT
    created_at: float = 0.0
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "plan_id": self.plan_id,
            "title": self.title,
            "description": self.description,
            "steps": [s.to_dict() for s in self.steps],
            "status": self.status.value,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "metadata": dict(self.metadata),
            "progress": self.progress(),
            "summary": self.summary(),
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "ComposerPlan":
        steps = [ComposerStep.from_dict(s) for s in d.get("steps", [])]
        try:
            status = PlanStatus(d.get("status", "draft"))
        except ValueError:
            status = PlanStatus.DRAFT
        return cls(
            plan_id=d.get("plan_id", "") or f"plan-{uuid.uuid4().hex[:16]}",
            title=d.get("title", ""),
            description=d.get("description", ""),
            steps=steps,
            status=status,
            created_at=d.get("created_at", time.time()),
            started_at=d.get("started_at"),
            finished_at=d.get("finished_at"),
            metadata=dict(d.get("metadata") or {}),
        )

    def progress(self) -> float:
        """计算整体进度"""
        if not self.steps:
            return 0.0
        total = sum(s.progress for s in self.steps)
        return round(total / len(self.steps), 4)

    def summary(self) -> Dict:
        """统计各状态 step 数"""
        out: Dict[str, int] = {s.value: 0 for s in StepStatus}
        for s in self.steps:
            out[s.status.value] += 1
        return out

    def get_step(self, step_id: str) -> Optional[ComposerStep]:
        for s in self.steps:
            if s.step_id == step_id:
                return s
        return None

    def ready_steps(self) -> List[ComposerStep]:
        """获取所有依赖已满足且未在终态的 step
        注：FAILED 步骤需要显式调用 retry_step() 才能重新进入 ready
        """
        done_ids = {
            s.step_id for s in self.steps
            if s.status in (StepStatus.COMPLETED, StepStatus.SKIPPED)
        }
        ready: List[ComposerStep] = []
        for s in self.steps:
            # 只取 PENDING 和 READY（FAILED 需显式 retry）
            if s.status not in (StepStatus.PENDING, StepStatus.READY):
                continue
            if all(dep in done_ids for dep in s.depends_on):
                if s.status != StepStatus.READY:
                    s.status = StepStatus.READY
                ready.append(s)
        return ready

    def is_terminal(self) -> bool:
        return all(
            s.status in (
                StepStatus.COMPLETED, StepStatus.SKIPPED, StepStatus.CANCELLED, StepStatus.FAILED
            )
            for s in self.steps
        )

    def has_failures(self) -> bool:
        return any(s.status == StepStatus.FAILED for s in self.steps)

    def validate(self) -> List[str]:
        """校验 plan，返回错误列表（空表示合法）"""
        errors: List[str] = []
        ids: Set[str] = set()
        for s in self.steps:
            if not s.step_id:
                errors.append(f"step 缺少 step_id: {s.title}")
            if s.step_id in ids:
                errors.append(f"step_id 重复: {s.step_id}")
            ids.add(s.step_id)
            if not s.title:
                errors.append(f"step {s.step_id} 缺少 title")
            if not s.action:
                errors.append(f"step {s.step_id} 缺少 action")
        for s in self.steps:
            for dep in s.depends_on:
                if dep not in ids:
                    errors.append(f"step {s.step_id} 引用未知依赖: {dep}")
                if dep == s.step_id:
                    errors.append(f"step {s.step_id} 自我依赖")
        # 检测循环依赖（简化版 DFS）
        graph: Dict[str, List[str]] = {s.step_id: list(s.depends_on) for s in self.steps}
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {n: WHITE for n in graph}

        def dfs(node: str) -> bool:
            color[node] = GRAY
            for nb in graph.get(node, []):
                if nb not in color:
                    continue
                if color[nb] == GRAY:
                    return True
                if color[nb] == WHITE and dfs(nb):
                    return True
            color[node] = BLACK
            return False

        for n in list(graph.keys()):
            if color[n] == WHITE and dfs(n):
                errors.append(f"检测到循环依赖（从 {n} 出发）")
                break
        return errors


# ============================================================
# 步骤执行器（内置默认 + 扩展点）
# ============================================================


# 内置 action 处理（mock 实现，可被真实实现覆盖）
# 真实场景下应该由 cli_integration / HermesService 注入
BUILTIN_ACTION_HANDLERS = {}


def register_action_handler(action: str, handler) -> None:
    """注册 action 处理器"""
    BUILTIN_ACTION_HANDLERS[action] = handler


async def _default_handler(step: ComposerStep, ctx: Dict) -> Dict:
    """默认 handler：模拟执行（用于测试与 fallback）"""
    await asyncio.sleep(0.05)
    return {
        "action": step.action,
        "echo_params": step.params,
        "simulated": True,
    }


def get_action_handler(action: str):
    return BUILTIN_ACTION_HANDLERS.get(action, _default_handler)


# ============================================================
# 计划服务
# ============================================================


class ComposerPlanService:
    """
    ComposerPlan 服务（单例）

    维护所有 plan 实例 + 订阅者，并对外暴露：
      - create_plan / get_plan / list_plans / delete_plan
      - update_step_status / update_step_progress
      - start_plan / pause_plan / resume_plan / cancel_plan
      - retry_step / skip_step
      - subscribe / get_history
    """

    def __init__(self):
        self._plans: Dict[str, ComposerPlan] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._history: Dict[str, Deque[Dict]] = {}
        self._lock = asyncio.Lock()
        # 执行状态（每个 plan 一个 task）
        self._tasks: Dict[str, asyncio.Task] = {}
        self._pause_events: Dict[str, asyncio.Event] = {}
        self._cancel_flags: Dict[str, bool] = {}

    # -------- CRUD --------

    async def create_plan(
        self,
        title: str,
        description: str = "",
        steps: Optional[List[Dict]] = None,
        metadata: Optional[Dict] = None,
    ) -> ComposerPlan:
        """创建新 Plan"""
        async with self._lock:
            plan = ComposerPlan(
                plan_id=f"plan-{uuid.uuid4().hex[:16]}",
                title=title,
                description=description,
                steps=[ComposerStep.from_dict(s) for s in (steps or [])],
                status=PlanStatus.DRAFT,
                created_at=time.time(),
                metadata=dict(metadata or {}),
            )
            errors = plan.validate()
            if errors:
                raise ValueError(f"Plan 校验失败: {'; '.join(errors)}")
            self._plans[plan.plan_id] = plan
            self._history[plan.plan_id] = deque(maxlen=200)
            self._pause_events[plan.plan_id] = asyncio.Event()
            self._pause_events[plan.plan_id].set()  # 默认非暂停
            self._cancel_flags[plan.plan_id] = False
            logger.info(f"create_plan: id={plan.plan_id} steps={len(plan.steps)}")
            return plan

    async def get_plan(self, plan_id: str) -> Optional[ComposerPlan]:
        return self._plans.get(plan_id)

    def list_plans(self) -> List[ComposerPlan]:
        return list(self._plans.values())

    async def delete_plan(self, plan_id: str) -> bool:
        async with self._lock:
            if plan_id in self._plans:
                # 先取消正在执行的任务
                if plan_id in self._tasks and not self._tasks[plan_id].done():
                    self._tasks[plan_id].cancel()
                self._plans.pop(plan_id, None)
                self._tasks.pop(plan_id, None)
                self._pause_events.pop(plan_id, None)
                self._cancel_flags.pop(plan_id, None)
                self._history.pop(plan_id, None)
                for subs in self._subscribers.values():
                    # 通知所有订阅者该 plan 已删除
                    pass
                self._subscribers.pop(plan_id, None)
                return True
            return False

    # -------- Step 状态更新 --------

    async def update_step_status(
        self,
        plan_id: str,
        step_id: str,
        new_status: StepStatus,
        error: Optional[str] = None,
        output: Optional[Dict] = None,
    ) -> Optional[ComposerStep]:
        plan = self._plans.get(plan_id)
        if not plan:
            return None
        step = plan.get_step(step_id)
        if not step:
            return None
        old_status = step.status
        # 校验迁移合法性（除 cancelled/READY 等强迁移外）
        if new_status != step.status and new_status not in ALLOWED_STEP_TRANSITIONS.get(step.status, []):
            logger.warning(
                f"update_step_status: 不允许 {step.status.value} -> {new_status.value} "
                f"plan={plan_id} step={step_id}"
            )
            return step
        step.status = new_status
        if error is not None:
            step.error = error
        if output is not None:
            step.output.update(output)
        if new_status == StepStatus.RUNNING:
            step.started_at = step.started_at or time.time()
            step.attempts += 1
        elif new_status in (StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.SKIPPED, StepStatus.CANCELLED):
            step.finished_at = time.time()
            if new_status == StepStatus.COMPLETED:
                step.progress = 1.0
        # 广播
        await self._broadcast(plan_id, {
            "type": "step_status_changed",
            "plan_id": plan_id,
            "step_id": step_id,
            "from_status": old_status.value,
            "to_status": new_status.value,
            "error": step.error,
            "timestamp": time.time(),
        })
        return step

    async def update_step_progress(
        self,
        plan_id: str,
        step_id: str,
        progress: float,
    ) -> Optional[ComposerStep]:
        plan = self._plans.get(plan_id)
        if not plan:
            return None
        step = plan.get_step(step_id)
        if not step:
            return None
        step.progress = max(0.0, min(1.0, progress))
        await self._broadcast(plan_id, {
            "type": "step_progress",
            "plan_id": plan_id,
            "step_id": step_id,
            "progress": step.progress,
            "timestamp": time.time(),
        })
        return step

    # -------- Plan 控制 --------

    async def start_plan(self, plan_id: str) -> bool:
        """启动 Plan 执行（异步任务）"""
        plan = self._plans.get(plan_id)
        if not plan:
            return False
        if plan.status in (PlanStatus.RUNNING, PlanStatus.COMPLETED):
            logger.warning(f"start_plan: plan 已在终态或运行中 plan={plan_id} status={plan.status.value}")
            return False
        # 校验
        errors = plan.validate()
        if errors:
            raise ValueError(f"Plan 校验失败: {'; '.join(errors)}")
        plan.status = PlanStatus.RUNNING
        plan.started_at = time.time()
        self._cancel_flags[plan_id] = False
        self._pause_events[plan_id].set()
        # 启动执行 task
        self._tasks[plan_id] = asyncio.create_task(self._run_plan(plan_id))
        await self._broadcast(plan_id, {
            "type": "plan_started",
            "plan_id": plan_id,
            "timestamp": time.time(),
        })
        logger.info(f"start_plan: plan={plan_id}")
        return True

    async def pause_plan(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if not plan or plan.status != PlanStatus.RUNNING:
            return False
        plan.status = PlanStatus.PAUSED
        self._pause_events[plan_id].clear()
        await self._broadcast(plan_id, {
            "type": "plan_paused",
            "plan_id": plan_id,
            "timestamp": time.time(),
        })
        logger.info(f"pause_plan: plan={plan_id}")
        return True

    async def resume_plan(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if not plan or plan.status != PlanStatus.PAUSED:
            return False
        plan.status = PlanStatus.RUNNING
        self._pause_events[plan_id].set()
        await self._broadcast(plan_id, {
            "type": "plan_resumed",
            "plan_id": plan_id,
            "timestamp": time.time(),
        })
        logger.info(f"resume_plan: plan={plan_id}")
        return True

    async def cancel_plan(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if not plan:
            return False
        self._cancel_flags[plan_id] = True
        self._pause_events[plan_id].set()  # 解除可能的暂停
        # 取消正在运行的 step
        for s in plan.steps:
            if s.status == StepStatus.RUNNING:
                s.status = StepStatus.CANCELLED
                s.finished_at = time.time()
            elif s.status in (StepStatus.PENDING, StepStatus.READY):
                s.status = StepStatus.CANCELLED
        plan.status = PlanStatus.CANCELLED
        plan.finished_at = time.time()
        if plan_id in self._tasks and not self._tasks[plan_id].done():
            self._tasks[plan_id].cancel()
        await self._broadcast(plan_id, {
            "type": "plan_cancelled",
            "plan_id": plan_id,
            "timestamp": time.time(),
        })
        logger.info(f"cancel_plan: plan={plan_id}")
        return True

    async def retry_step(self, plan_id: str, step_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if not plan:
            return False
        step = plan.get_step(step_id)
        if not step or step.status != StepStatus.FAILED:
            return False
        step.status = StepStatus.READY
        step.error = None
        step.progress = 0.0
        await self._broadcast(plan_id, {
            "type": "step_retry",
            "plan_id": plan_id,
            "step_id": step_id,
            "timestamp": time.time(),
        })
        return True

    async def skip_step(self, plan_id: str, step_id: str) -> bool:
        return bool(
            await self.update_step_status(plan_id, step_id, StepStatus.SKIPPED, error="user skipped")
        )

    # -------- 执行循环 --------

    async def _run_plan(self, plan_id: str) -> None:
        """主执行循环"""
        plan = self._plans.get(plan_id)
        if not plan:
            return
        try:
            while True:
                # 检查取消
                if self._cancel_flags.get(plan_id):
                    break
                # 全部完成（所有 step 均在终态）-> 提前退出
                if plan.is_terminal():
                    break
                # 暂停
                if plan.status == PlanStatus.PAUSED:
                    await self._pause_events[plan_id].wait()
                    if self._cancel_flags.get(plan_id):
                        break
                    continue  # 重新检查状态
                # 取 ready steps
                ready = plan.ready_steps()
                if not ready:
                    # 没有 ready：要么全部完成，要么有失败但依赖未满足
                    if plan.is_terminal():
                        # 全部完成
                        break
                    if plan.has_failures():
                        plan.status = PlanStatus.FAILED
                        plan.finished_at = time.time()
                        await self._broadcast(plan_id, {
                            "type": "plan_failed",
                            "plan_id": plan_id,
                            "timestamp": time.time(),
                        })
                        break
                    # 否则避免忙等
                    await asyncio.sleep(0.05)
                    continue
                # 并发执行 ready steps
                tasks = [asyncio.create_task(self._run_step(plan_id, s.step_id)) for s in ready]
                await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            logger.info(f"_run_plan: cancelled plan={plan_id}")
            plan.status = PlanStatus.CANCELLED
            plan.finished_at = time.time()
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"_run_plan: unexpected error plan={plan_id} err={exc}")
            plan.status = PlanStatus.FAILED
            plan.finished_at = time.time()
            await self._broadcast(plan_id, {
                "type": "plan_failed",
                "plan_id": plan_id,
                "error": str(exc),
                "timestamp": time.time(),
            })
        finally:
            # 统一处理最终状态
            await self._finalize_plan(plan_id)

    async def _run_step(self, plan_id: str, step_id: str) -> None:
        """执行单个 step"""
        plan = self._plans.get(plan_id)
        if not plan:
            return
        step = plan.get_step(step_id)
        if not step:
            return
        await self.update_step_status(plan_id, step_id, StepStatus.RUNNING)
        try:
            # 检查取消
            if self._cancel_flags.get(plan_id):
                await self.update_step_status(
                    plan_id, step_id, StepStatus.CANCELLED, error="plan cancelled"
                )
                return
            # 检查暂停
            await self._pause_events[plan_id].wait()
            if self._cancel_flags.get(plan_id):
                await self.update_step_status(
                    plan_id, step_id, StepStatus.CANCELLED, error="plan cancelled"
                )
                return
            # 调用 handler
            handler = get_action_handler(step.action)
            ctx = {
                "plan_id": plan_id,
                "step_id": step_id,
                "metadata": plan.metadata,
            }
            output = await handler(step, ctx)
            await self.update_step_status(
                plan_id, step_id, StepStatus.COMPLETED, output=output
            )
        except asyncio.CancelledError:
            await self.update_step_status(
                plan_id, step_id, StepStatus.CANCELLED, error="cancelled"
            )
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"_run_step: error plan={plan_id} step={step_id} err={exc}")
            # 检查是否还能重试
            if step.attempts < step.max_attempts:
                # 重试：回到 pending（不计入广播历史）
                step.status = StepStatus.PENDING
                step.error = str(exc)
            else:
                await self.update_step_status(
                    plan_id, step_id, StepStatus.FAILED, error=str(exc)
                )

    async def _finalize_plan(self, plan_id: str) -> None:
        """结束 plan：确定最终状态并广播"""
        plan = self._plans.get(plan_id)
        if not plan:
            return
        # 如果已经是终态（cancelled/failed），不动
        if plan.status in (PlanStatus.CANCELLED, PlanStatus.FAILED):
            if not plan.finished_at:
                plan.finished_at = time.time()
            return
        # 检查是否所有 step 都是终态
        if plan.is_terminal():
            if plan.has_failures():
                plan.status = PlanStatus.FAILED
                plan.finished_at = time.time()
                await self._broadcast(plan_id, {
                    "type": "plan_failed",
                    "plan_id": plan_id,
                    "timestamp": time.time(),
                })
            else:
                plan.status = PlanStatus.COMPLETED
                plan.finished_at = time.time()
                await self._broadcast(plan_id, {
                    "type": "plan_completed",
                    "plan_id": plan_id,
                    "timestamp": time.time(),
                })

    # -------- 订阅与广播 --------

    async def subscribe(self, plan_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        if plan_id not in self._subscribers:
            self._subscribers[plan_id] = []
        self._subscribers[plan_id].append(queue)
        return queue

    async def unsubscribe(self, plan_id: str, queue: asyncio.Queue) -> None:
        subs = self._subscribers.get(plan_id, [])
        if queue in subs:
            subs.remove(queue)

    async def _broadcast(self, plan_id: str, event: Dict) -> None:
        # 记录历史
        if plan_id in self._history:
            self._history[plan_id].append(event)
        subs = list(self._subscribers.get(plan_id, []))
        if not subs:
            return
        dead: List[asyncio.Queue] = []
        for q in subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            await self.unsubscribe(plan_id, q)

    def get_history(self, plan_id: str, limit: int = 50) -> List[Dict]:
        history = self._history.get(plan_id, [])
        return list(history)[-limit:]


# ============================================================
# 全局单例
# ============================================================

_service: Optional[ComposerPlanService] = None


def get_service() -> ComposerPlanService:
    global _service
    if _service is None:
        _service = ComposerPlanService()
    return _service


# ============================================================
# SSE 流
# ============================================================


async def stream_plan_events(
    plan_id: str,
    heartbeat_interval: float = 15.0,
) -> AsyncIterator[Dict]:
    """
    生成 ComposerPlan SSE 事件流

    输入参数：plan_id, heartbeat_interval
    输出结果：AsyncIterator[Dict]
    """
    service = get_service()
    queue = await service.subscribe(plan_id)

    try:
        # 初始快照
        plan = await service.get_plan(plan_id)
        if plan is not None:
            yield {
                "type": "plan_init",
                "plan_id": plan_id,
                "plan": plan.to_dict(),
            }
        # 持续监听
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                yield event
            except asyncio.TimeoutError:
                yield {
                    "type": "heartbeat",
                    "plan_id": plan_id,
                    "timestamp": time.time(),
                }
    except asyncio.CancelledError:
        pass
    finally:
        await service.unsubscribe(plan_id, queue)
