"""
# ============================================================
# Goal Plan + Step 数据模型 (v1.0.0)
# Cycle 61 G61-02 - Goal mode 完整循环 UI
# # ============================================================
# 核心作用：在 Goal 之下引入 Plan/Step 三层结构
#           支持 Goal → Plan → Step 的逐层分解与可视化
# 运行流程：
#   1. Plan 属于一个 Goal，承载该 Goal 的执行路径
#   2. 每个 Plan 由多个 Step 组成（顺序或并发）
#   3. Step 状态机：pending → running → success/failed/skipped
#   4. Step 可关联 VerifyItem，结束后自动验证
# 设计要点：
#   - 纯数据类（dataclass），无外部依赖
#   - 状态转移显式定义（防止非法状态）
#   - 支持 Step 自动重试 + 跳过策略
#   - 支持 Step 进度追踪（started_at / finished_at / duration_ms）
# 输入参数：无（数据类）
# 输出结果：Plan / PlanStep 数据模型
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-02 初次创建
# ====================================
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class PlanStatus(str, Enum):
    """Plan 生命周期状态"""

    DRAFT = "draft"             # 草稿（未启动）
    PENDING = "pending"         # 待执行
    RUNNING = "running"         # 执行中
    PAUSED = "paused"           # 暂停
    COMPLETED = "completed"     # 全部 Step 成功
    FAILED = "failed"           # 有关键 Step 失败
    CANCELLED = "cancelled"     # 用户取消


class StepStatus(str, Enum):
    """Step 单步状态机"""

    PENDING = "pending"         # 待执行
    RUNNING = "running"         # 执行中
    SUCCESS = "success"         # 成功
    FAILED = "failed"           # 失败（可重试）
    SKIPPED = "skipped"         # 跳过
    CANCELLED = "cancelled"     # 取消

    @classmethod
    def terminal_states(cls) -> List[str]:
        return [cls.SUCCESS.value, cls.FAILED.value, cls.SKIPPED.value, cls.CANCELLED.value]

    def is_terminal(self) -> bool:
        return self.value in self.terminal_states()


class StepStrategy(str, Enum):
    """Step 失败时的处理策略"""

    RETRY = "retry"             # 自动重试（最多 retry_count 次）
    SKIP = "skip"               # 跳过继续
    ABORT = "abort"             # 中止 Plan


# ============================================================
# Plan Step 数据类
# ============================================================


@dataclass
class PlanStep:
    """Plan 内的单个执行步骤"""

    step_id: str = field(default_factory=lambda: f"step-{uuid.uuid4().hex[:12]}")
    plan_id: str = ""
    title: str = ""
    description: str = ""
    order: int = 0
    status: StepStatus = StepStatus.PENDING

    # 执行控制
    strategy: StepStrategy = StepStrategy.RETRY
    retry_count: int = 0
    max_retries: int = 3

    # 执行输入/输出
    prompt: str = ""            # LLM 调用提示词
    tool: str = ""              # 工具名（claude/bash/read/write）
    command: str = ""           # bash 命令
    file_path: str = ""         # 文件路径（read/write）
    output: str = ""            # 执行输出
    error: str = ""             # 错误信息
    exit_code: Optional[int] = None

    # 时间
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    # 验证
    verify_item_id: Optional[str] = None
    verify_result: Optional[Dict[str, Any]] = None

    # 元数据
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------
    # 行为方法
    # ------------------------------------------------------------

    def start(self) -> None:
        """标记为运行中（防止重复启动）"""
        if self.status != StepStatus.PENDING:
            raise ValueError(f"Step {self.step_id} 状态 {self.status.value} 不允许 start")
        self.status = StepStatus.RUNNING
        self.started_at = time.time()

    def finish_success(self, output: str = "", metadata: Optional[Dict[str, Any]] = None) -> None:
        """标记为成功"""
        if self.status != StepStatus.RUNNING:
            raise ValueError(f"Step {self.step_id} 状态 {self.status.value} 不允许 finish_success")
        self.status = StepStatus.SUCCESS
        self.finished_at = time.time()
        self.output = output
        if metadata:
            self.metadata.update(metadata)

    def finish_failed(self, error: str, exit_code: Optional[int] = -1) -> None:
        """标记为失败"""
        if self.status != StepStatus.RUNNING:
            raise ValueError(f"Step {self.step_id} 状态 {self.status.value} 不允许 finish_failed")
        self.status = StepStatus.FAILED
        self.finished_at = time.time()
        self.error = error
        self.exit_code = exit_code
        self.retry_count += 1

    def skip(self, reason: str = "") -> None:
        """跳过（仅 pending 状态可跳过）"""
        if self.status != StepStatus.PENDING:
            return
        self.status = StepStatus.SKIPPED
        self.finished_at = time.time()
        if reason:
            self.metadata["skip_reason"] = reason

    def cancel(self) -> None:
        """取消（pending 或 running 状态可取消）"""
        if self.status in (StepStatus.SUCCESS, StepStatus.SKIPPED):
            return
        self.status = StepStatus.CANCELLED
        self.finished_at = time.time()

    # ------------------------------------------------------------
    # 查询方法
    # ------------------------------------------------------------

    def duration_ms(self) -> int:
        """执行耗时（毫秒）"""
        if self.started_at is None:
            return 0
        end = self.finished_at or time.time()
        return int((end - self.started_at) * 1000)

    def can_retry(self) -> bool:
        """是否可以重试"""
        return (
            self.status == StepStatus.FAILED
            and self.strategy == StepStrategy.RETRY
            and self.retry_count < self.max_retries
        )

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "step_id": self.step_id,
            "plan_id": self.plan_id,
            "title": self.title,
            "description": self.description,
            "order": self.order,
            "status": self.status.value,
            "strategy": self.strategy.value,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "prompt": self.prompt,
            "tool": self.tool,
            "command": self.command,
            "file_path": self.file_path,
            "output": self.output,
            "error": self.error,
            "exit_code": self.exit_code,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "verify_item_id": self.verify_item_id,
            "verify_result": self.verify_result,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlanStep":
        """从字典反序列化"""
        return cls(
            step_id=data.get("step_id", f"step-{uuid.uuid4().hex[:12]}"),
            plan_id=data.get("plan_id", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            order=data.get("order", 0),
            status=StepStatus(data.get("status", "pending")),
            strategy=StepStrategy(data.get("strategy", "retry")),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 3),
            prompt=data.get("prompt", ""),
            tool=data.get("tool", ""),
            command=data.get("command", ""),
            file_path=data.get("file_path", ""),
            output=data.get("output", ""),
            error=data.get("error", ""),
            exit_code=data.get("exit_code"),
            created_at=data.get("created_at", time.time()),
            started_at=data.get("started_at"),
            finished_at=data.get("finished_at"),
            verify_item_id=data.get("verify_item_id"),
            verify_result=data.get("verify_result"),
            metadata=data.get("metadata", {}),
        )


# ============================================================
# Plan 数据类
# ============================================================


@dataclass
class GoalPlan:
    """Goal 之下的执行计划（包含多个 Step）"""

    plan_id: str = field(default_factory=lambda: f"plan-{uuid.uuid4().hex[:12]}")
    goal_id: str = ""
    title: str = ""
    description: str = ""
    status: PlanStatus = PlanStatus.DRAFT
    steps: List[PlanStep] = field(default_factory=list)

    # 时间
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    # 进度（0.0 ~ 1.0）
    progress: float = 0.0

    # 元数据
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------
    # 行为方法
    # ------------------------------------------------------------

    def add_step(self, title: str, description: str = "", **kwargs: Any) -> PlanStep:
        """添加一个 Step"""
        step = PlanStep(
            plan_id=self.plan_id,
            title=title,
            description=description,
            order=len(self.steps),
            **kwargs,
        )
        self.steps.append(step)
        return step

    def start(self) -> None:
        """启动 Plan"""
        if self.status not in (PlanStatus.DRAFT, PlanStatus.PENDING, PlanStatus.PAUSED):
            raise ValueError(f"Plan {self.plan_id} 状态 {self.status.value} 不允许 start")
        self.status = PlanStatus.RUNNING
        self.started_at = time.time()

    def pause(self) -> None:
        """暂停 Plan"""
        if self.status != PlanStatus.RUNNING:
            return
        self.status = PlanStatus.PAUSED

    def resume(self) -> None:
        """恢复 Plan"""
        if self.status != PlanStatus.PAUSED:
            return
        self.status = PlanStatus.RUNNING

    def complete(self) -> None:
        """标记为完成"""
        self.status = PlanStatus.COMPLETED
        self.finished_at = time.time()
        self.progress = 1.0

    def fail(self) -> None:
        """标记为失败"""
        self.status = PlanStatus.FAILED
        self.finished_at = time.time()

    def cancel(self) -> None:
        """取消所有未完成的 Step 并标记为取消"""
        for step in self.steps:
            if not step.status.is_terminal():
                step.cancel()
        self.status = PlanStatus.CANCELLED
        self.finished_at = time.time()

    def update_progress(self) -> float:
        """重新计算进度（0.0 ~ 1.0）"""
        if not self.steps:
            self.progress = 0.0
            return self.progress
        terminal = sum(1 for s in self.steps if s.status.is_terminal())
        self.progress = terminal / len(self.steps)
        return self.progress

    # ------------------------------------------------------------
    # 查询方法
    # ------------------------------------------------------------

    def next_pending_step(self) -> Optional[PlanStep]:
        """获取下一个 pending Step（按 order）"""
        for step in sorted(self.steps, key=lambda s: s.order):
            if step.status == StepStatus.PENDING:
                return step
        return None

    def running_step(self) -> Optional[PlanStep]:
        """获取当前 running 的 Step"""
        for step in self.steps:
            if step.status == StepStatus.RUNNING:
                return step
        return None

    def step_stats(self) -> Dict[str, int]:
        """Step 状态统计"""
        stats: Dict[str, int] = {s.value: 0 for s in StepStatus}
        for step in self.steps:
            stats[step.status.value] += 1
        return stats

    def duration_ms(self) -> int:
        """总耗时（毫秒）"""
        if self.started_at is None:
            return 0
        end = self.finished_at or time.time()
        return int((end - self.started_at) * 1000)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "plan_id": self.plan_id,
            "goal_id": self.goal_id,
            "title": self.title,
            "description": self.description,
            "status": self.status.value,
            "steps": [s.to_dict() for s in self.steps],
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "progress": self.progress,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GoalPlan":
        """从字典反序列化"""
        return cls(
            plan_id=data.get("plan_id", f"plan-{uuid.uuid4().hex[:12]}"),
            goal_id=data.get("goal_id", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            status=PlanStatus(data.get("status", "draft")),
            steps=[PlanStep.from_dict(s) for s in data.get("steps", [])],
            created_at=data.get("created_at", time.time()),
            started_at=data.get("started_at"),
            finished_at=data.get("finished_at"),
            progress=data.get("progress", 0.0),
            metadata=data.get("metadata", {}),
        )
