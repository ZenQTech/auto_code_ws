# ============================================================
# Workflow Engine 公共数据类型与工具
# ============================================================
# 核心作用：定义工作流引擎共用的 dataclass、常量、辅助工具方法。
#           这些类型在所有 5 个阶段（clarify/design/prompt/execute/review）
#           都会被引用，必须放在公共模块以避免循环依赖。
# 拆分日期：2026-07-27
# 来源文件：app.services.workflow_engine（原 5241 行单文件）
# 模块版本：v6.1.0 - C1 重构第一阶段（公共类型下沉）
# 修改记录：
#   - 2026-07-27 | v6.1.0 | 从 workflow_engine.py 抽出 dataclass
#     WorkflowStatusInfo / IterationContext / SmartIterationResult /
#     PipelineStep / PipelineResult / PipelineStepResult /
#     PipelineTestResult / SubGoal / GoalInfo + 常量
#     WORKFLOW_STAGES / STAGE_TRANSITIONS
# ============================================================

import json
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


# ============================================================
# 工作流阶段定义与状态机
# ============================================================

# 标准 5 阶段顺序（pending → clarifying → designing → prompting → executing → reviewing）
WORKFLOW_STAGES = ["clarifying", "designing", "prompting", "executing", "reviewing"]

# 阶段状态机转换规则
STAGE_TRANSITIONS = {
    "pending": ["clarifying"],
    "clarifying": ["designing"],
    "designing": ["prompting"],
    "prompting": ["executing"],
    "executing": ["reviewing"],
    "reviewing": ["iterating", "completed", "failed"],
    "iterating": ["executing"],
}


# ============================================================
# 核心状态数据类型
# ============================================================

@dataclass
class WorkflowStatusInfo:
    """工作流状态信息 - API 响应序列化专用"""
    workflow_id: str
    session_id: str
    status: str
    current_stage: str
    iteration_count: int
    max_iterations: int
    repo_name: str = ""
    push_status: str = "pending"
    rejection_count: int = 0
    force_human_review: bool = False
    human_confirmed_requirement: bool = False
    human_confirmed_architecture: bool = False
    critique_passed: bool = False
    prompts_optimized: bool = False
    # v2.4.0 新增：需求澄清相关字段
    clarification_round: int = 0
    clarification_complete: bool = False
    stages: List[Dict[str, Any]] = field(default_factory=list)
    progress: float = 0.0
    error_message: str = ""


@dataclass
class IterationContext:
    """
    智能迭代上下文数据类（v4.0.0）
    作用：存储当前迭代的缺陷上下文，用于向 CLI 实例传递精确的修复目标
    字段说明：
      - iteration_number: 当前迭代编号
      - review_report_summary: 评审报告摘要
      - defect_list: 缺陷列表，每项含 defect_id、severity、location、description、fix_suggestion
      - fixed_in_previous: 之前迭代中已修复的缺陷 ID 列表
      - escalation_reason: 升级原因（空字符串表示未升级）
    """
    iteration_number: int
    review_report_summary: str = ""
    defect_list: List[Dict[str, Any]] = field(default_factory=list)
    fixed_in_previous: List[str] = field(default_factory=list)
    escalation_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "iteration_number": self.iteration_number,
            "review_report_summary": self.review_report_summary,
            "defect_list": self.defect_list,
            "fixed_in_previous": self.fixed_in_previous,
            "escalation_reason": self.escalation_reason,
        }

    def to_json(self) -> str:
        """序列化为 JSON 字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_json(cls, json_str: str) -> "IterationContext":
        """从 JSON 字符串反序列化"""
        if not json_str or not json_str.strip():
            return cls(iteration_number=0)
        try:
            data = json.loads(json_str)
            return cls(
                iteration_number=data.get("iteration_number", 0),
                review_report_summary=data.get("review_report_summary", ""),
                defect_list=data.get("defect_list", []),
                fixed_in_previous=data.get("fixed_in_previous", []),
                escalation_reason=data.get("escalation_reason", ""),
            )
        except (json.JSONDecodeError, TypeError):
            return cls(iteration_number=0)


@dataclass
class SmartIterationResult:
    """
    智能迭代结果数据类（v4.1.0）
    作用：封装 execute_smart_iteration 的完整执行结果，
          用于传递给调用方（API 层）进行后续处理
    """
    iteration_number: int
    defects_fixed: List[str] = field(default_factory=list)
    defects_remaining: List[str] = field(default_factory=list)
    regression_detected: bool = False
    escalated_to_human: bool = False
    continue_iteration: bool = False
    summary: str = ""


# ============================================================
# 流水线测试数据类型（v4.1.0）
# ============================================================

@dataclass
class PipelineStep:
    """
    全链路自动化测试流水线的单个步骤
    step_name 取值: prompt_injection / requirement_refinement /
                    code_generation / review / git_commit / integration_test
    status 取值: pending / running / completed / failed
    """
    step_name: str
    status: str = "pending"
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: str = ""
    output: str = ""


@dataclass
class PipelineResult:
    """
    全链路自动化测试流水线完整结果
    包含 6 个步骤的执行结果列表和整体状态汇总
    """
    workflow_id: str
    steps: List[PipelineStep] = field(default_factory=list)
    overall_status: str = "running"
    all_steps_passed: bool = False
    all_modules_reviewed: bool = False
    all_git_committed: bool = False
    integration_test_passed: bool = False
    summary: str = ""


@dataclass
class PipelineStepResult:
    """
    全链路流水线单步骤结果（用于 API 响应序列化）
    """
    step_name: str
    status: str = "running"
    started_at: str = ""
    completed_at: str = ""
    output: str = ""
    error: str = ""


@dataclass
class PipelineTestResult:
    """
    全链路自动化测试流水线结果（聚合版本）
    作用：聚合 6 步流水线的完整执行结果，用于 API 响应序列化
    """
    workflow_id: str
    overall_status: str = "running"
    steps: List[PipelineStepResult] = field(default_factory=list)
    all_modules_passed: bool = False
    git_commit_success: bool = False
    integration_test_passed: bool = False
    summary: str = ""


# ============================================================
# 目标分解数据类型（v5.0.0）
# ============================================================

@dataclass
class SubGoal:
    """
    子目标数据类 - 表示目标分解后的单个子目标，对应一个代码模块
    """
    id: str
    name: str
    description: str
    status: str  # pending/in_progress/completed/failed
    module_name: str  # 对应的模块
    dependencies: List[str] = field(default_factory=list)  # 依赖的子目标 ID 列表
    acceptance_criteria: str = ""
    agent_id: str = ""  # 分配的 CLI 智能体

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典，用于 JSON 持久化"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "status": self.status,
            "module_name": self.module_name,
            "dependencies": self.dependencies,
            "acceptance_criteria": self.acceptance_criteria,
            "agent_id": self.agent_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SubGoal":
        """从字典反序列化"""
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            description=data.get("description", ""),
            status=data.get("status", "pending"),
            module_name=data.get("module_name", ""),
            dependencies=data.get("dependencies", []),
            acceptance_criteria=data.get("acceptance_criteria", ""),
            agent_id=data.get("agent_id", ""),
        )


@dataclass
class GoalInfo:
    """
    目标信息数据类 - 封装完整的目标信息和所有子目标的状态，供前端渲染进度
    """
    goal_id: str
    objective: str
    sub_goals: List[SubGoal] = field(default_factory=list)
    status: str = "active"  # active/completed/blocked
    workflow_id: str = ""
    completed_count: int = 0
    total_count: int = 0
    current_sub_goal: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典，用于 API 响应"""
        return {
            "goal_id": self.goal_id,
            "objective": self.objective,
            "sub_goals": [sg.to_dict() for sg in self.sub_goals],
            "status": self.status,
            "workflow_id": self.workflow_id,
            "completed_count": self.completed_count,
            "total_count": self.total_count,
            "current_sub_goal": self.current_sub_goal,
        }


# ============================================================
# Re-export 兼容层 - 允许老代码继续 from app.services.workflow_engine import X
# ============================================================

# v6.2.0 拆分：跨阶段辅助方法下沉（无阶段归属，所有阶段共用的工具）
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession


def get_workflow(db: AsyncSession, workflow_id: str):
    """加载工作流（v6.2.0 从 WorkflowEngine 提取）"""
    # 使用本地 import 避免循环
    from app.models import Workflow
    # 注意：这是同步风格的占位实现；原 _get_workflow 是 async
    raise NotImplementedError("use async _get_workflow below")


async def _get_workflow(db: AsyncSession, workflow_id: str):
    """异步加载工作流（v6.2.0 从 WorkflowEngine._get_workflow 迁移）"""
    from app.models import Workflow
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    return result.scalar_one_or_none()


async def _get_stage_by_name(db: AsyncSession, workflow_id: str, stage_name: str):
    """按阶段名称加载工作流阶段记录（v6.2.0 迁移）"""
    from app.models import WorkflowStage
    result = await db.execute(
        select(WorkflowStage).where(
            WorkflowStage.workflow_id == workflow_id,
            WorkflowStage.stage_name == stage_name,
        )
    )
    return result.scalar_one_or_none()


async def _complete_current_stage(db: AsyncSession, workflow_id: str, stage_name: str):
    """标记当前阶段为完成（v6.2.0 迁移）"""
    from app.models import StageStatus
    if stage_name:
        await db.execute(
            text(
                "UPDATE workflow_stages SET status = :status, completed_at = :ts "
                "WHERE workflow_id = :wid AND stage_name = :sn"
            ),
            {
                "status": StageStatus.COMPLETED.name,
                "ts": datetime.now(timezone.utc),
                "wid": workflow_id,
                "sn": stage_name,
            },
        )


async def _set_stage_in_progress(db: AsyncSession, workflow_id: str, stage_name: str):
    """标记阶段为进行中（v6.2.0 迁移）"""
    from app.models import StageStatus
    await db.execute(
        text(
            "UPDATE workflow_stages SET status = :status, started_at = :ts "
            "WHERE workflow_id = :wid AND stage_name = :sn"
        ),
        {
            "status": StageStatus.IN_PROGRESS.name,
            "ts": datetime.now(timezone.utc),
            "wid": workflow_id,
            "sn": stage_name,
        },
    )
    return await _get_stage_by_name(db, workflow_id, stage_name)


def _get_next_stage(current_stage: str) -> Optional[str]:
    """确定下一阶段（v6.2.0 迁移）"""
    if current_stage == "reviewing":
        return None
    transitions = STAGE_TRANSITIONS.get(current_stage, [])
    return transitions[0] if transitions else None


def _stage_to_workflow_status(stage_name: str):
    """阶段名 → 工作流状态映射（v6.2.0 迁移）"""
    from app.models import WorkflowStatus
    mapping = {
        "clarifying": WorkflowStatus.CLARIFYING,
        "designing": WorkflowStatus.DESIGNING,
        "prompting": WorkflowStatus.PROMPTING,
        "executing": WorkflowStatus.EXECUTING,
        "reviewing": WorkflowStatus.REVIEWING,
    }
    return mapping.get(stage_name, WorkflowStatus.PENDING)


def _stage_display_name(stage_name: str) -> str:
    """阶段名 → 中文显示名（v6.2.0 迁移）"""
    mapping = {
        "clarifying": "需求澄清",
        "designing": "架构设计",
        "prompting": "提示词工程",
        "executing": "代码执行",
        "reviewing": "质量评审",
    }
    return mapping.get(stage_name, stage_name)

__all__ = [
    # 常量
    "WORKFLOW_STAGES",
    "STAGE_TRANSITIONS",
    # Dataclass
    "WorkflowStatusInfo",
    "IterationContext",
    "SmartIterationResult",
    "PipelineStep",
    "PipelineResult",
    "PipelineStepResult",
    "PipelineTestResult",
    "SubGoal",
    "GoalInfo",
    # 辅助方法
    "_get_workflow",
    "_get_stage_by_name",
    "_complete_current_stage",
    "_set_stage_in_progress",
    "_get_next_stage",
    "_stage_to_workflow_status",
    "_stage_display_name",
    # Mixin
    "WorkflowHelpersMixin",
]


# ============================================================
# WorkflowEngine 辅助方法 Mixin（v6.2.0）
# ============================================================

class WorkflowHelpersMixin:
    """
    跨阶段辅助方法 Mixin（v6.2.0）
    
    让 WorkflowEngine 透明调用 stage_common 中已下沉的辅助方法。
    所有方法都是 thin wrapper，调用 stage_common 中同名函数。
    """
    
    async def _get_workflow(self, db, workflow_id: str):
        """工作流加载 - thin wrapper"""
        return await _get_workflow(db, workflow_id)
    
    async def _get_stage_by_name(self, db, workflow_id: str, stage_name: str):
        """按名称加载阶段 - thin wrapper"""
        return await _get_stage_by_name(db, workflow_id, stage_name)
    
    async def _complete_current_stage(self, db, workflow_id: str, stage_name: str):
        """标记阶段完成 - thin wrapper"""
        return await _complete_current_stage(db, workflow_id, stage_name)
    
    async def _set_stage_in_progress(self, db, workflow_id: str, stage_name: str):
        """标记阶段进行中 - thin wrapper"""
        return await _set_stage_in_progress(db, workflow_id, stage_name)
    
    def _get_next_stage(self, current_stage: str) -> Optional[str]:
        """获取下一阶段 - thin wrapper"""
        return _get_next_stage(current_stage)
    
    def _stage_to_workflow_status(self, stage_name: str):
        """阶段名→状态 - thin wrapper"""
        return _stage_to_workflow_status(stage_name)
    
    def _stage_display_name(self, stage_name: str) -> str:
        """阶段名→中文显示 - thin wrapper"""
        return _stage_display_name(stage_name)
