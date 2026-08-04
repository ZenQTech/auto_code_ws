"""
# ============================================================
# Hermes /goal 长时域模式 - Goal 管理器
# ============================================================
# 核心作用：管理 Goal 的完整生命周期
# 特性：
#   - 持久化（JSONL）
#   - 状态机（draft→active→completed/failed/abandoned）
#   - Token 预算控制
#   - Checkpoint 机制
#   - 线程安全
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import (
    AcceptanceCriterion,
    AcceptanceStatus,
    Goal,
    GoalStatus,
    TokenBudget,
)
from .plan import GoalPlan, PlanStatus, PlanStep, StepStatus, StepStrategy
from .progress import ProgressEntry, ProgressLog, ProgressStatus
from .verify_item import (
    VerifyItem,
    VerifyReport,
    VerifyResult,
    VerifyStatus,
)

logger = logging.getLogger(__name__)


# 状态转移规则
ALLOWED_TRANSITIONS: Dict[GoalStatus, List[GoalStatus]] = {
    GoalStatus.DRAFT: [GoalStatus.ACTIVE, GoalStatus.ABANDONED],
    GoalStatus.ACTIVE: [GoalStatus.PAUSED, GoalStatus.COMPLETED, GoalStatus.FAILED, GoalStatus.ABANDONED],
    GoalStatus.PAUSED: [GoalStatus.ACTIVE, GoalStatus.ABANDONED],
    GoalStatus.COMPLETED: [],
    GoalStatus.FAILED: [GoalStatus.ACTIVE, GoalStatus.ABANDONED],   # 允许重试
    GoalStatus.ABANDONED: [],
}


class GoalManager:
    """Goal 管理器（核心服务）"""

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """初始化"""
        if storage_dir is None:
            storage_dir = os.path.join(
                os.path.expanduser("~"), ".hermes", "goals"
            )
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        # 索引文件
        self.index_file = self.storage_dir / "index.jsonl"

        # 内存索引
        self._lock = threading.RLock()
        self._goals: Dict[str, Goal] = {}
        self._progress_logs: Dict[str, ProgressLog] = {}
        self._verify_items: Dict[str, List[VerifyItem]] = {}  # goal_id -> items
        self._plans: Dict[str, GoalPlan] = {}  # plan_id -> GoalPlan
        self._goal_plans: Dict[str, List[str]] = {}  # goal_id -> [plan_id]

        # 加载已有数据
        self._load()

    # ============================================================
    # CRUD
    # ============================================================
    def create(self, goal: Goal) -> Goal:
        """创建 Goal"""
        with self._lock:
            if goal.id in self._goals:
                raise ValueError(f"Goal already exists: {goal.id}")
            goal.created_at = datetime.now(timezone.utc).isoformat()
            goal.updated_at = goal.created_at
            goal.status = GoalStatus.DRAFT
            self._goals[goal.id] = goal
            self._progress_logs[goal.id] = ProgressLog(goal_id=goal.id)
            self._verify_items[goal.id] = []
            self._save_index()
            self._save_goal(goal)
            return goal

    def get(self, goal_id: str) -> Optional[Goal]:
        """获取 Goal"""
        with self._lock:
            return self._goals.get(goal_id)

    def get_or_raise(self, goal_id: str) -> Goal:
        """获取 Goal，不存在则抛异常"""
        goal = self.get(goal_id)
        if goal is None:
            raise KeyError(f"Goal not found: {goal_id}")
        return goal

    def list_all(
        self,
        status: Optional[GoalStatus] = None,
        tag: Optional[str] = None,
        owner: Optional[str] = None,
    ) -> List[Goal]:
        """列出 Goal（支持过滤）"""
        with self._lock:
            results = list(self._goals.values())
        if status is not None:
            results = [g for g in results if g.status == status]
        if tag is not None:
            results = [g for g in results if tag in g.tags]
        if owner is not None:
            results = [g for g in results if g.owner == owner]
        # 按 updated_at 倒序
        results.sort(key=lambda g: g.updated_at, reverse=True)
        return results

    def update(self, goal_id: str, **kwargs: Any) -> Goal:
        """更新 Goal 字段"""
        with self._lock:
            goal = self.get_or_raise(goal_id)
            for key, value in kwargs.items():
                if key == "token_budget" and isinstance(value, dict):
                    goal.token_budget = TokenBudget.from_dict(value)
                elif key == "acceptance_criteria" and isinstance(value, list):
                    goal.acceptance_criteria = [
                        AcceptanceCriterion.from_dict(ac) if isinstance(ac, dict) else ac
                        for ac in value
                    ]
                elif hasattr(goal, key):
                    setattr(goal, key, value)
            goal.updated_at = datetime.now(timezone.utc).isoformat()
            self._save_goal(goal)
            self._save_index()
            return goal

    def delete(self, goal_id: str) -> None:
        """删除 Goal"""
        with self._lock:
            if goal_id not in self._goals:
                raise KeyError(f"Goal not found: {goal_id}")
            del self._goals[goal_id]
            self._progress_logs.pop(goal_id, None)
            self._verify_items.pop(goal_id, None)
            # 关联删除 Plan
            for plan_id in self._goal_plans.pop(goal_id, []):
                self._plans.pop(plan_id, None)
                plan_file = self.storage_dir / f"{plan_id}.plan.json"
                if plan_file.exists():
                    plan_file.unlink()
            # 删除文件
            goal_file = self.storage_dir / f"{goal_id}.json"
            if goal_file.exists():
                goal_file.unlink()
            progress_file = self.storage_dir / f"{goal_id}.progress.jsonl"
            if progress_file.exists():
                progress_file.unlink()
            verify_file = self.storage_dir / f"{goal_id}.verify.json"
            if verify_file.exists():
                verify_file.unlink()
            self._save_index()

    # ============================================================
    # 状态机
    # ============================================================
    def transition(self, goal_id: str, new_status: GoalStatus) -> Goal:
        """状态转移"""
        with self._lock:
            goal = self.get_or_raise(goal_id)
            if new_status not in ALLOWED_TRANSITIONS[goal.status]:
                raise ValueError(
                    f"Invalid transition: {goal.status} -> {new_status}"
                )
            old_status = goal.status
            goal.status = new_status
            goal.updated_at = datetime.now(timezone.utc).isoformat()
            if new_status == GoalStatus.COMPLETED:
                goal.completed_at = goal.updated_at
            # 记录进度
            self._add_progress(
                goal_id,
                ProgressEntry(
                    status=(
                        ProgressStatus.PAUSED if new_status == GoalStatus.PAUSED
                        else ProgressStatus.RESUMED if new_status == GoalStatus.ACTIVE and old_status == GoalStatus.PAUSED
                        else ProgressStatus.COMPLETED if new_status == GoalStatus.COMPLETED
                        else ProgressStatus.FAILED if new_status == GoalStatus.FAILED
                        else ProgressStatus.INFO
                    ),
                    action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                        description=f"Status: {old_status.value} -> {new_status.value}",
                        target=goal_id,
                    ),
                ),
            )
            self._save_goal(goal)
            self._save_index()
            return goal

    def start(self, goal_id: str) -> Goal:
        """启动 Goal"""
        return self.transition(goal_id, GoalStatus.ACTIVE)

    def pause(self, goal_id: str) -> Goal:
        """暂停 Goal"""
        return self.transition(goal_id, GoalStatus.PAUSED)

    def resume(self, goal_id: str) -> Goal:
        """恢复 Goal"""
        return self.transition(goal_id, GoalStatus.ACTIVE)

    def complete(self, goal_id: str) -> Goal:
        """完成 Goal"""
        goal = self.get_or_raise(goal_id)
        # 检查所有 AC 是否通过
        if not goal.is_completable():
            incomplete = [ac for ac in goal.acceptance_criteria if ac.status != AcceptanceStatus.PASSED]
            raise ValueError(
                f"Cannot complete: {len(incomplete)} acceptance criteria not passed"
            )
        return self.transition(goal_id, GoalStatus.COMPLETED)

    def fail(self, goal_id: str, reason: str = "") -> Goal:
        """标记失败"""
        with self._lock:
            self._add_progress(
                goal_id,
                ProgressEntry(
                    status=ProgressStatus.FAILED,
                    action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                        description=f"Failed: {reason}",
                    ),
                ),
            )
        return self.transition(goal_id, GoalStatus.FAILED)

    def abandon(self, goal_id: str, reason: str = "") -> Goal:
        """放弃 Goal"""
        with self._lock:
            if reason:
                self._add_progress(
                    goal_id,
                    ProgressEntry(
                        status=ProgressStatus.INFO,
                        action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                            description=f"Abandoned: {reason}",
                        ),
                    ),
                )
        return self.transition(goal_id, GoalStatus.ABANDONED)

    # ============================================================
    # Acceptance Criteria
    # ============================================================
    def add_acceptance_criterion(self, goal_id: str, ac: AcceptanceCriterion) -> Goal:
        """添加 AC"""
        with self._lock:
            goal = self.get_or_raise(goal_id)
            goal.acceptance_criteria.append(ac)
            goal.updated_at = datetime.now(timezone.utc).isoformat()
            self._save_goal(goal)
            return goal

    def update_acceptance_criterion(
        self, goal_id: str, ac_id: str, **kwargs: Any
    ) -> AcceptanceCriterion:
        """
        更新 AC

        触发 GoalSync 双向同步（如果 _goal_sync 已注入）
        """
        with self._lock:
            goal = self.get_or_raise(goal_id)
            for ac in goal.acceptance_criteria:
                if ac.id == ac_id:
                    # 记录旧值用于同步
                    old_status = None
                    if ac.status is not None:
                        old_status = ac.status.value if hasattr(ac.status, "value") else ac.status

                    for key, value in kwargs.items():
                        if key == "status" and isinstance(value, str):
                            value = AcceptanceStatus(value)
                        if hasattr(ac, key):
                            setattr(ac, key, value)
                    if ac.status == AcceptanceStatus.PASSED and not ac.completed_at:
                        ac.completed_at = datetime.now(timezone.utc).isoformat()
                    goal.updated_at = datetime.now(timezone.utc).isoformat()
                    self._save_goal(goal)

                    # 触发 GoalSync（如果可用）
                    sync = getattr(self, "_goal_sync", None)
                    if sync and "status" in kwargs:
                        try:
                            new_status_val = (
                                ac.status.value if hasattr(ac.status, "value") else ac.status
                            )
                            sync.sync_manager_to_engine(
                                goal_id=goal_id,
                                ac_id=ac_id,
                                old_value=old_status,
                                new_value=new_status_val,
                            )
                        except Exception as e:
                            logger.debug(f"GoalSync 同步事件触发失败（非阻塞）: {e}")

                    return ac
            raise KeyError(f"AC not found: {ac_id}")

    # ============================================================
    # Token Budget
    # ============================================================
    def add_tokens(self, goal_id: str, count: int) -> TokenBudget:
        """添加 token 使用量"""
        with self._lock:
            goal = self.get_or_raise(goal_id)
            goal.token_budget.used += count
            goal.updated_at = datetime.now(timezone.utc).isoformat()
            # 检查硬停止
            if goal.token_budget.is_hard_stop:
                self._add_progress(
                    goal_id,
                    ProgressEntry(
                        status=ProgressStatus.WARNING,
                        action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                            description=f"Token hard stop: {goal.token_budget.used}/{goal.token_budget.hard_limit}",
                        ),
                        tokens_used=goal.token_budget.used,
                    ),
                )
            elif goal.token_budget.is_warning:
                self._add_progress(
                    goal_id,
                    ProgressEntry(
                        status=ProgressStatus.WARNING,
                        action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                            description=f"Token warning: {goal.token_budget.used}/{goal.token_budget.soft_limit}",
                        ),
                        tokens_used=goal.token_budget.used,
                    ),
                )
            self._save_goal(goal)
            return goal.token_budget

    def check_budget(self, goal_id: str) -> Dict[str, Any]:
        """检查 token 预算状态"""
        with self._lock:
            goal = self.get_or_raise(goal_id)
            tb = goal.token_budget
            return {
                "goal_id": goal_id,
                "used": tb.used,
                "soft_limit": tb.soft_limit,
                "hard_limit": tb.hard_limit,
                "remaining": tb.remaining,
                "utilization": round(tb.utilization, 3),
                "is_warning": tb.is_warning,
                "is_soft_stop": tb.is_soft_stop,
                "is_hard_stop": tb.is_hard_stop,
            }

    # ============================================================
    # Verify Items
    # ============================================================
    def add_verify_item(self, goal_id: str, item: VerifyItem) -> VerifyItem:
        """添加验证项"""
        with self._lock:
            self.get_or_raise(goal_id)  # 校验存在
            self._verify_items.setdefault(goal_id, []).append(item)
            self._save_verify_items(goal_id)
            return item

    def list_verify_items(self, goal_id: str) -> List[VerifyItem]:
        """列出验证项"""
        with self._lock:
            return list(self._verify_items.get(goal_id, []))

    def update_verify_item(
        self, goal_id: str, item_id: str, **kwargs: Any
    ) -> VerifyItem:
        """更新验证项"""
        with self._lock:
            for item in self._verify_items.get(goal_id, []):
                if item.id == item_id:
                    for key, value in kwargs.items():
                        if key == "status" and isinstance(value, str):
                            value = VerifyStatus(value)
                        if key == "verify_type" and isinstance(value, str):
                            value = __import__('app.core.goal.base', fromlist=['VerifyType']).VerifyType(value)
                        if hasattr(item, key):
                            setattr(item, key, value)
                    self._save_verify_items(goal_id)
                    return item
            raise KeyError(f"Verify item not found: {item_id}")

    # ============================================================
    # Progress Log
    # ============================================================
    def add_progress(self, goal_id: str, entry: ProgressEntry) -> ProgressEntry:
        """添加进度条目（公开 API）"""
        with self._lock:
            self.get_or_raise(goal_id)  # 校验
            self._add_progress(goal_id, entry)
            return entry

    def _add_progress(self, goal_id: str, entry: ProgressEntry) -> None:
        """内部添加进度"""
        log = self._progress_logs.setdefault(goal_id, ProgressLog(goal_id=goal_id))
        log.append(entry)
        self._save_progress(goal_id)

    def get_progress(self, goal_id: str) -> ProgressLog:
        """获取进度日志"""
        with self._lock:
            self.get_or_raise(goal_id)
            return self._progress_logs.get(goal_id, ProgressLog(goal_id=goal_id))

    # ============================================================
    # Stats
    # ============================================================
    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        with self._lock:
            total = len(self._goals)
            by_status: Dict[str, int] = {}
            total_tokens = 0
            for goal in self._goals.values():
                by_status[goal.status.value] = by_status.get(goal.status.value, 0) + 1
                total_tokens += goal.token_budget.used
            return {
                "total": total,
                "by_status": by_status,
                "total_tokens_used": total_tokens,
                "active_goals": by_status.get("active", 0),
                "completed_goals": by_status.get("completed", 0),
            }

    # ============================================================
    # 持久化
    # ============================================================
    def _save_goal(self, goal: Goal) -> None:
        """保存 Goal 到文件"""
        goal_file = self.storage_dir / f"{goal.id}.json"
        with open(goal_file, "w", encoding="utf-8") as f:
            json.dump(goal.to_dict(), f, ensure_ascii=False, indent=2)

    # ============================================================
    # Plan + Step 三层管理 (Cycle 61 G61-02)
    # ============================================================

    def create_plan(self, goal_id: str, title: str, description: str = "") -> GoalPlan:
        """为指定 Goal 创建 Plan"""
        with self._lock:
            self.get_or_raise(goal_id)  # 校验 Goal 存在
            plan = GoalPlan(goal_id=goal_id, title=title, description=description)
            self._plans[plan.plan_id] = plan
            self._goal_plans.setdefault(goal_id, []).append(plan.plan_id)
            self._save_plan(plan)
            self._add_progress(
                goal_id,
                ProgressEntry(
                    status=ProgressStatus.INFO,
                    action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                        description=f"Plan created: {title} ({plan.plan_id})",
                        target=plan.plan_id,
                    ),
                ),
            )
            return plan

    def get_plan(self, plan_id: str) -> Optional[GoalPlan]:
        """获取 Plan"""
        with self._lock:
            return self._plans.get(plan_id)

    def get_plan_or_raise(self, plan_id: str) -> GoalPlan:
        """获取 Plan，不存在则抛异常"""
        plan = self.get_plan(plan_id)
        if plan is None:
            raise KeyError(f"Plan not found: {plan_id}")
        return plan

    def list_plans(self, goal_id: str) -> List[GoalPlan]:
        """列出 Goal 的所有 Plan"""
        with self._lock:
            plan_ids = self._goal_plans.get(goal_id, [])
            return [self._plans[pid] for pid in plan_ids if pid in self._plans]

    def add_step(
        self,
        plan_id: str,
        title: str,
        description: str = "",
        **kwargs: Any,
    ) -> PlanStep:
        """向 Plan 添加 Step"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            step = plan.add_step(title=title, description=description, **kwargs)
            plan.update_progress()
            self._save_plan(plan)
            return step

    def update_step_status(
        self,
        plan_id: str,
        step_id: str,
        new_status: StepStatus,
        output: str = "",
        error: str = "",
        exit_code: Optional[int] = None,
    ) -> PlanStep:
        """更新 Step 状态"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            for step in plan.steps:
                if step.step_id == step_id:
                    if new_status == StepStatus.RUNNING:
                        step.start()
                    elif new_status == StepStatus.SUCCESS:
                        step.finish_success(output=output)
                    elif new_status == StepStatus.FAILED:
                        step.finish_failed(error=error or "unknown", exit_code=exit_code)
                    elif new_status == StepStatus.SKIPPED:
                        step.skip(reason=error)
                    elif new_status == StepStatus.CANCELLED:
                        step.cancel()
                    plan.update_progress()
                    self._save_plan(plan)
                    return step
            raise KeyError(f"Step not found: {step_id}")

    def start_plan(self, plan_id: str) -> GoalPlan:
        """启动 Plan"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            plan.start()
            self._save_plan(plan)
            self._add_progress(
                plan.goal_id,
                ProgressEntry(
                    status=ProgressStatus.IN_PROGRESS,
                    action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                        description=f"Plan started: {plan.title}",
                        target=plan.plan_id,
                    ),
                ),
            )
            return plan

    def pause_plan(self, plan_id: str) -> GoalPlan:
        """暂停 Plan"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            plan.pause()
            self._save_plan(plan)
            return plan

    def resume_plan(self, plan_id: str) -> GoalPlan:
        """恢复 Plan"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            plan.resume()
            self._save_plan(plan)
            return plan

    def complete_plan(self, plan_id: str) -> GoalPlan:
        """完成 Plan（所有 Step 都成功）"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            failed = [s for s in plan.steps if s.status == StepStatus.FAILED]
            if failed:
                raise ValueError(f"Cannot complete: {len(failed)} steps failed")
            plan.complete()
            self._save_plan(plan)
            self._add_progress(
                plan.goal_id,
                ProgressEntry(
                    status=ProgressStatus.COMPLETED,
                    action=__import__('app.core.goal.progress', fromlist=['ProgressAction']).ProgressAction(
                        description=f"Plan completed: {plan.title}",
                        target=plan.plan_id,
                    ),
                ),
            )
            return plan

    def cancel_plan(self, plan_id: str) -> GoalPlan:
        """取消 Plan"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            plan.cancel()
            self._save_plan(plan)
            return plan

    def delete_plan(self, plan_id: str) -> None:
        """删除 Plan"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            self._plans.pop(plan_id, None)
            if plan.goal_id in self._goal_plans:
                self._goal_plans[plan.goal_id] = [
                    pid for pid in self._goal_plans[plan.goal_id] if pid != plan_id
                ]
            plan_file = self.storage_dir / f"{plan_id}.plan.json"
            if plan_file.exists():
                plan_file.unlink()

    def get_plan_progress(self, plan_id: str) -> Dict[str, Any]:
        """获取 Plan 进度摘要"""
        with self._lock:
            plan = self.get_plan_or_raise(plan_id)
            plan.update_progress()
            stats = plan.step_stats()
            return {
                "plan_id": plan.plan_id,
                "goal_id": plan.goal_id,
                "status": plan.status.value,
                "progress": plan.progress,
                "step_stats": stats,
                "total_steps": len(plan.steps),
                "duration_ms": plan.duration_ms(),
                "running_step": plan.running_step().step_id if plan.running_step() else None,
            }

    def _save_plan(self, plan: GoalPlan) -> None:
        """持久化 Plan"""
        plan_file = self.storage_dir / f"{plan.plan_id}.plan.json"
        with open(plan_file, "w", encoding="utf-8") as f:
            json.dump(plan.to_dict(), f, ensure_ascii=False, indent=2)

    def _load_plans(self) -> None:
        """从磁盘加载 Plans"""
        for plan_file in self.storage_dir.glob("*.plan.json"):
            try:
                with open(plan_file, "r", encoding="utf-8") as f:
                    plan = GoalPlan.from_dict(json.load(f))
                self._plans[plan.plan_id] = plan
                self._goal_plans.setdefault(plan.goal_id, []).append(plan.plan_id)
            except Exception as e:
                logger.warning(f"Failed to load plan {plan_file}: {e}")

    def _save_index(self) -> None:
        """保存索引"""
        with open(self.index_file, "w", encoding="utf-8") as f:
            for goal in self._goals.values():
                f.write(json.dumps(goal.to_dict(), ensure_ascii=False) + "\n")

    def _save_progress(self, goal_id: str) -> None:
        """保存进度"""
        log = self._progress_logs.get(goal_id)
        if not log:
            return
        progress_file = self.storage_dir / f"{goal_id}.progress.jsonl"
        with open(progress_file, "w", encoding="utf-8") as f:
            for entry in log.entries:
                f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")

    def _save_verify_items(self, goal_id: str) -> None:
        """保存验证项"""
        items = self._verify_items.get(goal_id, [])
        verify_file = self.storage_dir / f"{goal_id}.verify.json"
        with open(verify_file, "w", encoding="utf-8") as f:
            json.dump([item.to_dict() for item in items], f, ensure_ascii=False, indent=2)

    def _load(self) -> None:
        """从磁盘加载"""
        if not self.index_file.exists():
            return
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        goal = Goal.from_dict(json.loads(line))
                        self._goals[goal.id] = goal
                        # 加载进度
                        progress_file = self.storage_dir / f"{goal.id}.progress.jsonl"
                        log = ProgressLog(goal_id=goal.id)
                        if progress_file.exists():
                            with open(progress_file, "r", encoding="utf-8") as pf:
                                for pline in pf:
                                    pline = pline.strip()
                                    if not pline:
                                        continue
                                    try:
                                        log.entries.append(ProgressEntry.from_dict(json.loads(pline)))
                                    except Exception:
                                        pass
                        self._progress_logs[goal.id] = log
                        # 加载验证项
                        verify_file = self.storage_dir / f"{goal.id}.verify.json"
                        if verify_file.exists():
                            with open(verify_file, "r", encoding="utf-8") as vf:
                                items_data = json.load(vf)
                                self._verify_items[goal.id] = [
                                    VerifyItem.from_dict(d) for d in items_data
                                ]
                        else:
                            self._verify_items[goal.id] = []
                    except Exception as e:
                        logger.warning(f"Failed to load goal: {e}")
        except Exception as e:
            logger.warning(f"Failed to load index: {e}")
        # 加载 Plans
        self._load_plans()


# 全局单例
_manager_instance: Optional[GoalManager] = None
_manager_lock = threading.Lock()


def get_manager() -> GoalManager:
    """获取全局 GoalManager 单例"""
    global _manager_instance
    with _manager_lock:
        if _manager_instance is None:
            _manager_instance = GoalManager()
    return _manager_instance


def reset_manager() -> None:
    """重置单例（仅供测试）"""
    global _manager_instance
    with _manager_lock:
        _manager_instance = None
