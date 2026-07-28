"""
# ============================================================
# Loop Commands 模块 - Cycle 8 P1-4
# ============================================================
# 核心作用：实现 /loop slash command 的实际业务逻辑
# 借鉴 Codex v0.150+ /loop command family + TRAE Solo 模式
#
# 子命令:
#   - triage: 分析 tasks.md 任务优先级
#   - plan: 生成 spec + checklist + git 分支
#   - execute: 顺序执行原子任务 + 自动 git commit
#   - verify: 验证任务完成情况
#
# 创建日期：2026-07-27
# 模块版本：v6.1.0 - Cycle 8 P1-4
# ============================================================
"""

from .triage import TriageService, parse_tasks, TaskItem
from .plan import PlanService
from .execute import ExecuteService
from .verify import VerifyService
from .async_runner import AsyncRunner, get_async_runner, LoopWorkflowStatus

__all__ = [
    "TriageService",
    "parse_tasks",
    "TaskItem",
    "PlanService",
    "ExecuteService",
    "VerifyService",
    "AsyncRunner",
    "get_async_runner",
    "LoopWorkflowStatus",
]
