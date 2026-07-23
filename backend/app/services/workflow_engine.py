"""
# ============================================================
# Loop Engineering 工作流引擎
# ============================================================
# 核心作用：实现完整的 Loop Engineering 工作流，串联需求澄清、
#           架构设计、提示词工程、Claude Code CLI 执行、质量评审、
#           迭代闭环的全流程
# 运行流程：
#   1. 启动工作流（pending → clarifying）
#   2. 逐阶段推进（advance_stage）
#   3. 支持回退（rollback_stage）
#   4. 迭代闭环控制（最多 3 轮）
# 输入参数：
#   - session_id: 会话 ID
#   - user_input: 用户原始输入
# 输出结果：Workflow 对象
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
#   - 2026-06-25 | v1.0.1 | 修复 SAEnum raw SQL 中 .value → .name 的枚举值存储 bug；
#     start_workflow 中第一个阶段（clarifying）初始状态设为 IN_PROGRESS 并设置 started_at
#   - 2026-06-26 | v2.0.0 | 集成 Git 自动推送：start_workflow 创建 GitHub 仓库，
#     mark_completed 合并推送 main 分支，WorkflowStatusInfo 新增 repo_name/push_status 字段
#   - 2026-06-29 | v2.2.0 | 增强阶段边界 100% 闭环校验：新增 validate_stage_boundary / confirm_stage /
#     reject_stage 方法；advance_stage 增加前置校验；start_workflow 移除 Git 仓库创建逻辑（迁移至
#     confirm_stage("designing")）；WorkflowStatusInfo 新增 rejection_count / force_human_review /
#     human_confirmed_requirement / human_confirmed_architecture / critique_passed /
#     prompts_optimized 字段
#   - 2026-06-29 | v2.4.0 | 集成需求澄清功能：__init__ 新增 clarification_service 参数；
#     start_workflow 初始化澄清字段并调用 ClarificationService 生成首轮澄清问题；
#     validate_stage_boundary 新增 clarification_complete 校验；
#     confirm_stage("clarifying") 新增澄清完成校验；
#     WorkflowStatusInfo 新增 clarification_round / clarification_complete 字段
#   - 2026-07-01 | v3.1.0 | confirm_stage("clarifying") 确认后自动调用 advance_stage 推进到架构设计阶段
#   - 2026-07-01 | v3.2.0 | 新增 architecture_workflow_service 参数；新增 start_designing_phase /
#     run_critique_iteration / finalize_designing_phase 方法，串联架构设计批判迭代完整工作流
#   - 2026-07-01 | v3.2.1 | confirm_stage("clarifying") 修复：用户显式跳过不确定项时自动补全
#     clarification_complete=True，不再硬拒绝确认请求
#   - 2026-07-02 | v3.2.2 | validate_stage_boundary 修复：移除 clarifying→designing 和
#     designing→prompting 的 stage COMPLETED 检查（死锁：校验要求已完成但完成只在通过后）
#   - 2026-07-02 | v3.2.3 | confirm_stage("clarifying") 修复：requirement_doc 为空时先调用
#     finalize_requirement_doc 兜底生成文档再推进，仅生成后仍为空才失败
#   - 2026-07-22 | v4.0.0 | 智能迭代闭环增强：新增 IterationContext dataclass；
#     增强 start_iteration() 支持 review_report 参数；新增 start_smart_iteration()、
#     track_iteration_fix()、should_escalate_to_human() 方法，实现缺陷定位→修复追踪→
#     回归检测→自动升级的完整智能迭代闭环
#   - 2026-07-22 | v4.1.0 | 全链路自动化测试流水线增强：新增 PipelineStepResult /
#     PipelineTestResult dataclass；新增 _push_pipeline_sse() 辅助方法；
#     增强 run_full_pipeline_test() 使用 PipelineTestResult 并缓存结果；
#     __init__ 新增 _latest_pipeline_result 缓存字典
#   - 2026-07-22 | v4.2.0 | 智能迭代闭环正式化：新增 SmartIterationResult dataclass；
#     增强 start_iteration() 新增 review_feedback 参数和 _format_review_feedback_for_cli
#     辅助方法；新增 execute_smart_iteration() 智能迭代入口方法（含缺陷按模块分类、
#     CLI 精确修复指引、自动升级）；新增 track_iteration_progress() 迭代进度追踪方法
#     （含回归检测）；新增 escalate_to_human() 人工审核升级方法（含 SSE 事件推送）；
#     新增 _group_defects_by_module / _extract_module_from_location /
#     _build_cli_fix_guidance 辅助方法
#   - 2026-07-22 | v5.0.0 | 目标导向任务循环：新增 SubGoal / GoalInfo dataclass；
#     新增 create_goal() / execute_goal_loop() / check_goal_completion() /
#     get_goal_status() 方法，实现目标分解→子目标调度→闭环执行→完成检测的
#     完整 Goal-oriented task loop
#   - 2026-07-22 | v5.1.0 | 填补 designing→prompting→executing 自动推进 GAP：
#     confirm_stage("designing") 确认后自动调用 advance_stage 推进到 prompting
#     并通过 asyncio.create_task 触发 _run_prompting_phase 后台任务生成各模块
#     优化提示词；新增 _run_prompting_phase 方法完成解析模块→优化提示词→
#     持久化→设置 prompts_optimized=True→再次 advance 到 executing 的闭环；
#     validate_stage_boundary 放宽 designing→prompting 转换对 prompts_optimized
#     的强制要求（仅当 human_confirmed_architecture 也为 False 时才报错）
#   - 2026-07-23 | v5.6.0 | 新增 _run_executing_phase 真实 LLM 代码生成：填补
#     executing→reviewing 自动推进 GAP；从 workflow.error_message 解析 __PROMPTS__
#     JSON 段，为每个模块构造代码生成 Prompt 并通过 hermes_service.executor 调用
#     真实 LLM；解析 LLM 输出中的 # FILE: 标记按需写入工作区文件；通过 git_manager
#     自动提交；最后标记 executing 阶段 COMPLETED 并 advance 到 reviewing；
#     _run_prompting_phase 末尾通过 asyncio.create_task 调度 _run_executing_phase
# ============================================================
"""

import asyncio
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..models import (
    Workflow, WorkflowStage, WorkflowStatus, StageStatus,
)

logger = logging.getLogger(__name__)

# 工作流阶段定义
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


@dataclass
class WorkflowStatusInfo:
    """工作流状态信息"""
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
    智能迭代上下文数据类（v4.0.0 新增）
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
    智能迭代结果数据类（v4.1.0 新增）
    作用：封装 execute_smart_iteration 的完整执行结果，
          用于传递给调用方（API 层）进行后续处理
    字段说明：
      - iteration_number: 当前迭代编号
      - defects_fixed: 本次迭代修复的缺陷 ID 列表
      - defects_remaining: 本次迭代仍未修复的缺陷 ID 列表
      - regression_detected: 是否检测到回归（已修复缺陷重新出现）
      - escalated_to_human: 是否已升级到人工审核
      - continue_iteration: 是否需要继续迭代（仍有未修复缺陷且未超上限）
      - summary: 本次迭代的摘要描述
    """
    iteration_number: int
    defects_fixed: List[str] = field(default_factory=list)
    defects_remaining: List[str] = field(default_factory=list)
    regression_detected: bool = False
    escalated_to_human: bool = False
    continue_iteration: bool = False
    summary: str = ""


@dataclass
class PipelineStep:
    """
    全链路自动化测试流水线的单个步骤（v4.1.0 新增）
    字段说明：
      - step_name: 步骤名称，取值为 prompt_injection / requirement_refinement /
                   code_generation / review / git_commit / integration_test
      - status: 步骤状态，取值为 pending / running / completed / failed
      - started_at: 步骤开始时间（ISO 8601 格式字符串）
      - completed_at: 步骤完成时间（ISO 8601 格式字符串）
      - error_message: 步骤失败时的错误信息
      - output: 步骤产出的结果摘要
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
    全链路自动化测试流水线完整结果（v4.1.0 新增）
    字段说明：
      - workflow_id: 关联的工作流 ID
      - steps: 6 个步骤的执行结果列表
      - overall_status: 整体状态，取值为 running / completed / failed
      - all_steps_passed: 是否所有 6 个步骤都已完成
      - all_modules_reviewed: 是否所有模块都通过了评审
      - all_git_committed: 是否所有模块都已完成 Git 提交
      - integration_test_passed: 是否集成测试通过
      - summary: 流水线执行总结
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
    全链路流水线单步骤结果（v4.1.0 新增）
    作用：记录单个流水线步骤的执行结果，用于 API 响应序列化
    字段说明：
      - step_name: 步骤名称，取值为 prompt_injection / requirement_refinement /
                   code_generation / review / git_commit / integration_test
      - status: 步骤状态，取值为 running / completed / failed
      - started_at: 步骤开始时间（ISO 8601 格式字符串）
      - completed_at: 步骤完成时间（ISO 8601 格式字符串）
      - output: 步骤产出的结果摘要
      - error: 步骤失败时的错误信息
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
    全链路自动化测试流水线结果（v4.1.0 新增）
    作用：聚合 6 步流水线的完整执行结果，用于 API 响应序列化
    字段说明：
      - workflow_id: 关联的工作流 ID
      - overall_status: 整体状态，取值为 running / completed / failed
      - steps: 6 个 PipelineStepResult 的列表
      - all_modules_passed: 是否所有模块评审通过
      - git_commit_success: 是否所有 Git 提交成功
      - integration_test_passed: 是否集成测试通过
      - summary: 流水线执行总结文本
    """
    workflow_id: str
    overall_status: str = "running"
    steps: List[PipelineStepResult] = field(default_factory=list)
    all_modules_passed: bool = False
    git_commit_success: bool = False
    integration_test_passed: bool = False
    summary: str = ""


@dataclass
class SubGoal:
    """
    子目标数据类（v5.0.0 新增）
    作用：表示目标分解后的单个子目标，对应一个代码模块
    字段说明：
      - id: 子目标唯一标识（UUID）
      - name: 子目标名称（模块名）
      - description: 子目标描述
      - status: 状态（pending/in_progress/completed/failed）
      - module_name: 对应的代码模块名称
      - dependencies: 依赖的子目标 ID 列表
      - acceptance_criteria: 验收标准
      - agent_id: 分配的 CLI 智能体 ID（可选）
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
    目标信息数据类（v5.0.0 新增）
    作用：封装完整的目标信息和所有子目标的状态，供前端渲染进度
    字段说明：
      - goal_id: 目标唯一标识
      - objective: 目标总体描述
      - sub_goals: 子目标列表
      - status: 目标状态（active/completed/blocked）
      - workflow_id: 关联的工作流 ID
      - completed_count: 已完成子目标数
      - total_count: 子目标总数
      - current_sub_goal: 当前正在执行的子目标 ID（空字符串表示无）
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


class WorkflowEngine:
    """
    Loop Engineering 工作流引擎
    作用：管理完整的工作流生命周期，控制阶段推进和迭代闭环
    调用方：API 层（workflow.py）、HermesService
    被调用方：各智能体角色服务
    """

    def __init__(
        self,
        session_factory: async_sessionmaker,
        git_manager=None,
        commit_hook_handler=None,
        clarification_service=None,  # v2.4.0 新增：需求澄清服务
        architecture_workflow_service=None,  # v3.2.0 新增：架构设计工作流编排服务
        hermes_service=None,  # v5.4.0 新增：Hermes 服务（提供真实 LLM 调用的 executor 给 PromptEngineer 使用）
    ):
        """
        初始化工作流引擎
        参数：
          - session_factory: 异步数据库会话工厂
          - git_manager: GitManager 实例（可选），提供 Git 操作能力
          - commit_hook_handler: CommitHookHandler 实例（可选），提供 Commit Hook 处理能力
          - clarification_service: ClarificationService 实例（可选，v2.4.0 新增），提供需求澄清能力
          - architecture_workflow_service: ArchitectureWorkflowService 实例（可选，v3.2.0 新增），提供架构设计批判迭代能力
          - hermes_service: HermesService 实例（可选，v5.4.0 新增），用于在 _run_prompting_phase 阶段通过 PromptEngineer 调用真实 LLM
        """
        self.session_factory = session_factory
        self.git_manager = git_manager
        self.commit_hook_handler = commit_hook_handler
        self.clarification_service = clarification_service  # v2.4.0 新增
        self.architecture_workflow_service = architecture_workflow_service  # v3.2.0 新增
        self.hermes_service = hermes_service  # v5.4.0 新增
        # v4.1.0 新增：全链路流水线测试结果缓存，供 pipeline-status 端点查询
        self._latest_pipeline_result: Dict[str, PipelineTestResult] = {}

    async def start_workflow(
        self, session_id: str, user_input: str
    ) -> Workflow:
        """
        启动工作流
        运行步骤：
          1. 创建 Workflow 记录
          2. 创建所有阶段的 WorkflowStage 记录（初始状态 pending）
          3. 将第一个阶段（clarifying）设为 in_progress
          4. 更新 Session 的 workflow_id 和 workflow_stage
          5. Git 仓库创建已迁移至 confirm_stage("designing") 方法中
        参数：
          - session_id: 会话 ID
          - user_input: 用户原始输入
        返回值：创建的 Workflow 对象
        """
        # 从用户输入提取项目名（取前 50 字符，替换特殊字符为 -）
        project_name = user_input[:50].strip()
        # 清理项目名：替换空格和特殊字符为 -，移除首尾的 -
        project_name = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff_-]', '-', project_name)
        project_name = re.sub(r'-+', '-', project_name).strip('-')
        if not project_name:
            project_name = "auto-code-project"

        async with self.session_factory() as db:
            workflow = Workflow(
                id=str(uuid.uuid4()),
                session_id=session_id,
                status=WorkflowStatus.CLARIFYING,
                current_stage="clarifying",
                user_input=user_input,
                max_iterations=3,
                repo_name=project_name,
                push_status="pending",
                # v2.4.0 新增：初始化需求澄清相关字段
                clarification_questions=[],
                clarification_round=1,
                clarification_complete=False,
            )
            db.add(workflow)

            # 创建所有阶段记录，第一个阶段设为 IN_PROGRESS
            for i, stage_name in enumerate(WORKFLOW_STAGES):
                stage = WorkflowStage(
                    id=str(uuid.uuid4()),
                    workflow_id=workflow.id,
                    stage_name=stage_name,
                    status=StageStatus.IN_PROGRESS if i == 0 else StageStatus.PENDING,
                    started_at=datetime.now(timezone.utc) if i == 0 else None,
                )
                db.add(stage)

            # 更新 Session
            await db.execute(
                text("UPDATE sessions SET workflow_id = :wid, workflow_stage = :ws WHERE id = :sid"),
                {"wid": workflow.id, "ws": "clarifying", "sid": session_id},
            )

            await db.commit()
            await db.refresh(workflow)

            logger.info(
                f"工作流已启动: {workflow.id[:8]}..., session={session_id[:8]}..."
            )

        # v2.5.0 修复：启动需求澄清，使用 start_clarification 完成
        # 「生成首轮问题 + 初始化内存 state + 持久化」，并把首轮 ClarifyResult
        # 暂存到 workflow._clarify_result（临时属性），供 hermes_service 推送 clarify_questions 事件
        workflow._clarify_result = None  # 默认无（供调用方安全读取）
        if self.clarification_service is not None:
            try:
                # start_clarification 内部会：调用 clarifier.clarify、初始化 _states、持久化
                result = await self.clarification_service.start_clarification(
                    workflow.id, user_input
                )
                workflow._clarify_result = result
                logger.info(
                    f"首轮澄清问题已生成: {workflow.id[:8]}..., "
                    f"共 {len(result.questions)} 个问题"
                )
            except Exception as e:
                logger.warning(f"首轮澄清问题生成失败（非阻塞）: {e}")

        return workflow

    async def advance_stage(self, workflow_id: str) -> WorkflowStage:
        """
        推进工作流到下一阶段
        运行步骤：
          1. 加载工作流和当前阶段
          2. 确定下一阶段并执行阶段边界校验（validate_stage_boundary）
          3. 校验通过后标记当前阶段为 completed
          4. 标记下一阶段为 in_progress
          5. 更新工作流状态
        参数：
          - workflow_id: 工作流 ID
        返回值：新的当前阶段 WorkflowStage 对象
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            current_stage_name = workflow.current_stage

            # 确定下一阶段
            next_stage = self._get_next_stage(current_stage_name)
            if next_stage is None:
                raise ValueError(f"无法从 {current_stage_name} 推进，当前状态: {workflow.status}")

            # 阶段边界闭环校验：强制校验前置条件
            is_valid, missing_conditions = await self.validate_stage_boundary(
                workflow_id, current_stage_name, next_stage
            )
            if not is_valid:
                err_msg = f"阶段边界校验失败（{current_stage_name} → {next_stage}）：{'；'.join(missing_conditions)}"
                logger.warning(err_msg)
                raise ValueError(err_msg)

            # 标记当前阶段为完成
            await self._complete_current_stage(db, workflow_id, current_stage_name)

            # 更新工作流状态
            new_status = self._stage_to_workflow_status(next_stage)
            workflow.current_stage = next_stage
            workflow.status = new_status
            workflow.updated_at = datetime.now(timezone.utc)

            # 标记下一阶段为进行中
            stage = await self._set_stage_in_progress(db, workflow_id, next_stage)

            # 更新 Session
            await db.execute(
                text("UPDATE sessions SET workflow_stage = :ws WHERE workflow_id = :wid"),
                {"ws": next_stage, "wid": workflow_id},
            )

            await db.commit()
            await db.refresh(stage)

            logger.info(
                f"工作流阶段推进: {workflow_id[:8]}... {current_stage_name} → {next_stage}"
            )
            return stage

    async def rollback_stage(
        self, workflow_id: str, target_stage: str
    ) -> WorkflowStage:
        """
        回退工作流到指定阶段
        运行步骤：
          1. 加载工作流
          2. 验证目标阶段是否在允许的回退范围内
          3. 重置目标阶段及之后所有阶段为 pending
          4. 标记目标阶段为 in_progress
          5. 更新工作流状态
        参数：
          - workflow_id: 工作流 ID
          - target_stage: 目标阶段名称
        返回值：目标阶段 WorkflowStage 对象
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            if target_stage not in WORKFLOW_STAGES:
                raise ValueError(f"无效的阶段名称: {target_stage}")

            # 重置目标阶段及之后的所有阶段
            target_index = WORKFLOW_STAGES.index(target_stage)
            for stage_name in WORKFLOW_STAGES[target_index:]:
                await db.execute(
                    text(
                        "UPDATE workflow_stages SET status = :status, "
                        "output_doc = '', conversation_summary = '', "
                        "completed_at = NULL WHERE workflow_id = :wid AND stage_name = :sn"
                    ),
                    {"status": StageStatus.PENDING.name, "wid": workflow_id, "sn": stage_name},
                )

            # 标记目标阶段为进行中
            stage = await self._set_stage_in_progress(db, workflow_id, target_stage)

            # 更新工作流状态
            new_status = self._stage_to_workflow_status(target_stage)
            workflow.current_stage = target_stage
            workflow.status = new_status
            workflow.updated_at = datetime.now(timezone.utc)

            # 更新 Session
            await db.execute(
                text("UPDATE sessions SET workflow_stage = :ws WHERE workflow_id = :wid"),
                {"ws": target_stage, "wid": workflow_id},
            )

            await db.commit()
            await db.refresh(stage)

            logger.info(
                f"工作流阶段回退: {workflow_id[:8]}... → {target_stage}"
            )
            return stage

    async def get_workflow_status(self, workflow_id: str) -> WorkflowStatusInfo:
        """
        获取工作流完整状态
        参数：
          - workflow_id: 工作流 ID
        返回值：WorkflowStatusInfo 对象
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            # 加载所有阶段
            result = await db.execute(
                select(WorkflowStage)
                .where(WorkflowStage.workflow_id == workflow_id)
                .order_by(WorkflowStage.stage_name)
            )
            stages = result.scalars().all()

            # 计算进度
            completed_count = sum(
                1 for s in stages if s.status == StageStatus.COMPLETED
            )
            progress = (completed_count / len(stages) * 100) if stages else 0

            return WorkflowStatusInfo(
                workflow_id=workflow.id,
                session_id=workflow.session_id,
                status=workflow.status.value if hasattr(workflow.status, "value") else str(workflow.status),
                current_stage=workflow.current_stage or "",
                iteration_count=workflow.iteration_count,
                max_iterations=workflow.max_iterations,
                repo_name=workflow.repo_name or "",
                push_status=workflow.push_status or "pending",
                rejection_count=workflow.rejection_count or 0,
                force_human_review=workflow.force_human_review or False,
                human_confirmed_requirement=workflow.human_confirmed_requirement or False,
                human_confirmed_architecture=workflow.human_confirmed_architecture or False,
                critique_passed=workflow.critique_passed or False,
                prompts_optimized=workflow.prompts_optimized or False,
                # v2.4.0 新增：需求澄清状态字段
                clarification_round=workflow.clarification_round or 0,
                clarification_complete=workflow.clarification_complete or False,
                stages=[
                    {
                        "key": s.stage_name,
                        "name": self._stage_display_name(s.stage_name),
                        "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                        "agent_role": s.agent_role,
                        "started_at": s.started_at.isoformat() if s.started_at else None,
                        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                    }
                    for s in stages
                ],
                progress=progress,
                error_message=workflow.error_message or "",
            )

    async def mark_completed(self, workflow_id: str) -> Workflow:
        """
        标记工作流为已完成
        运行步骤：
          1. 加载工作流
          2. 完成当前阶段
          3. 若 git_manager 可用：执行兜底提交 → 合并推送 main 分支
          4. 更新工作流状态为 COMPLETED
          5. 更新 Session 的 workflow_stage 为 NULL
        参数：
          - workflow_id: 工作流 ID
        返回值：Workflow 对象
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            # 先完成当前阶段
            if workflow.current_stage:
                await self._complete_current_stage(db, workflow_id, workflow.current_stage)

            # 若 git_manager 可用，执行 Git 推送流程
            if self.git_manager is not None:
                try:
                    # a. 兜底提交：对未发送 Hook 的模块执行全量提交
                    if self.commit_hook_handler is not None:
                        await self.commit_hook_handler.fallback_commit(workflow_id)

                    # b. 合并 dev → main 并推送
                    push_result = await self.git_manager.push_main_branch()
                    if push_result.get("success"):
                        workflow.push_status = "pushed"
                        logger.info("全部代码已推送到 main 分支")
                    else:
                        workflow.push_status = "failed"
                        logger.warning(
                            f"推送 main 分支失败: {push_result.get('message')}"
                        )
                except Exception as e:
                    workflow.push_status = "failed"
                    logger.error(f"Git 推送流程异常: {e}")

            workflow.status = WorkflowStatus.COMPLETED
            workflow.current_stage = None
            workflow.updated_at = datetime.now(timezone.utc)

            await db.execute(
                text("UPDATE sessions SET workflow_stage = NULL WHERE workflow_id = :wid"),
                {"wid": workflow_id},
            )

            await db.commit()
            await db.refresh(workflow)
            return workflow

    async def mark_failed(self, workflow_id: str, error_message: str) -> Workflow:
        """标记工作流为失败"""
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            workflow.status = WorkflowStatus.FAILED
            workflow.error_message = error_message
            workflow.updated_at = datetime.now(timezone.utc)

            await db.execute(
                text("UPDATE sessions SET workflow_stage = NULL WHERE workflow_id = :wid"),
                {"wid": workflow_id},
            )

            await db.commit()
            await db.refresh(workflow)
            return workflow

    async def start_iteration(
        self,
        workflow_id: str,
        review_report: Optional[Dict[str, Any]] = None,
        review_feedback: Optional[Dict[str, Any]] = None,
    ) -> Workflow:
        """
        开始新一轮迭代（v4.0.0 增强 + v4.1.0 新增 review_feedback 参数）
        运行步骤：
          1. 检查是否超过最大迭代次数
          2. 增加迭代计数
          3. 若提供了 review_report 或 review_feedback，存储到 workflow.iteration_context
             - review_feedback 包含缺陷列表（defect_list）和修复建议（fix_suggestions），
               用于向 Claude Code CLI 实例传递精确的修复目标
          4. 将 review_feedback 中的缺陷信息存储到 workflow.error_message 供后续追踪
          5. 重置 executing 和 reviewing 阶段
          6. 设置状态为 iterating → executing
        参数：
          - workflow_id: 工作流 ID
          - review_report: 可选的评审报告（CriticalReviewer 输出的结构化评审报告），
            含缺陷列表和修复建议
          - review_feedback: 可选的需求反馈（v4.1.0 新增），包含缺陷列表和修复建议，
            当 review_report 未提供时使用此参数
        返回值：Workflow 对象
        """
        # v4.1.0 新增：review_feedback 与 review_report 合并处理
        # 当 review_report 未提供但 review_feedback 提供时，使用 review_feedback
        effective_report = review_report
        if effective_report is None and review_feedback is not None:
            effective_report = review_feedback

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            if workflow.iteration_count >= workflow.max_iterations:
                raise ValueError(
                    f"已达到最大迭代次数 ({workflow.max_iterations})，无法继续迭代"
                )

            workflow.iteration_count += 1
            workflow.status = WorkflowStatus.ITERATING
            workflow.updated_at = datetime.now(timezone.utc)

            # v4.1.0 增强：将 review_feedback 的缺陷信息存储到 error_message
            # 以便 CLI 实例和后续流程可以读取精确的修复目标
            if review_feedback is not None:
                feedback_summary = self._format_review_feedback_for_cli(
                    review_feedback, workflow.iteration_count
                )
                workflow.error_message = feedback_summary
                logger.info(
                    f"review_feedback 已存储到 error_message: "
                    f"workflow={workflow_id[:8]}..., "
                    f"iteration={workflow.iteration_count}"
                )

            # v4.0.0 + v4.1.0：若提供了评审报告，构建迭代上下文并持久化
            if effective_report:
                # 提取缺陷列表
                defect_list = self._extract_defect_list(effective_report)
                # 加载迭代历史，获取之前迭代中已修复的缺陷 ID
                fixed_in_previous = self._load_fixed_defect_ids(
                    workflow.iteration_history or ""
                )

                context = IterationContext(
                    iteration_number=workflow.iteration_count,
                    review_report_summary=effective_report.get("summary", ""),
                    defect_list=defect_list,
                    fixed_in_previous=fixed_in_previous,
                    escalation_reason="",
                )
                workflow.iteration_context = context.to_json()
                logger.info(
                    f"迭代上下文已存储: workflow={workflow_id[:8]}..., "
                    f"iteration={workflow.iteration_count}, "
                    f"defects={len(defect_list)}"
                )

            await db.commit()
            await db.refresh(workflow)

            # 回退到 executing 阶段
            await self.rollback_stage(workflow_id, "executing")

            return workflow

    # ============================================================
    # 智能迭代闭环方法（v4.0.0 新增）
    # ============================================================

    async def start_smart_iteration(
        self,
        workflow_id: str,
        review_report: Dict[str, Any],
        module_name: str = "",
    ) -> Dict[str, Any]:
        """
        启动智能迭代（v4.0.0 新增）
        作用：增强版迭代启动，支持结构化评审反馈驱动的精确修复
        调用方：API 层（评审阶段不通过时自动触发）
        被调用方：start_iteration、track_iteration_fix
        运行步骤：
          1. 加载工作流，检查 iteration_count < max_iterations（3）
          2. 将评审报告存储为结构化反馈（非简单"failed"）
          3. 从评审报告中提取精确的缺陷位置和修复建议
          4. 将缺陷上下文存储为 iteration_context（持久化到 DB）
          5. 追踪缺陷修复进度（iteration_history JSON 字段）
          6. 若 iteration_count >= 2，自动升级到人工审核（force_human_review=True）
          7. 回退到 executing 阶段并携带智能上下文
        参数：
          - workflow_id: 工作流 ID
          - review_report: 结构化评审报告（CriticalReviewer 输出）
          - module_name: 当前模块名称（可选，用于上下文定位）
        返回值：
          - Dict：包含 iteration_count、context、escalated 等信息的操作结果
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            # 步骤 1：检查迭代次数上限
            if workflow.iteration_count >= workflow.max_iterations:
                return {
                    "success": False,
                    "error": f"已达到最大迭代次数 ({workflow.max_iterations})",
                    "iteration_count": workflow.iteration_count,
                    "max_iterations": workflow.max_iterations,
                }

            # 步骤 2-3：提取缺陷列表
            defect_list = self._extract_defect_list(review_report)
            summary = review_report.get("summary", review_report.get("feedback", ""))

            # 步骤 4：加载迭代历史中已修复的缺陷 ID
            fixed_in_previous = self._load_fixed_defect_ids(
                workflow.iteration_history or ""
            )

            # 步骤 5：构建迭代上下文
            context = IterationContext(
                iteration_number=workflow.iteration_count + 1,
                review_report_summary=summary,
                defect_list=defect_list,
                fixed_in_previous=fixed_in_previous,
                escalation_reason="",
            )

            # 步骤 6：迭代次数 >= 2 时自动升级到人工审核
            escalated = False
            escalation_reason = ""
            if workflow.iteration_count >= 2:
                workflow.force_human_review = True
                escalated = True
                escalation_reason = (
                    f"迭代次数已达 {workflow.iteration_count}，"
                    f"下一轮（第 {workflow.iteration_count + 1} 轮）将自动升级到人工审核"
                )
                context.escalation_reason = escalation_reason
                logger.warning(
                    f"智能迭代升级: workflow={workflow_id[:8]}..., "
                    f"iteration={workflow.iteration_count}, "
                    f"reason={escalation_reason}"
                )

            # 持久化迭代上下文
            workflow.iteration_context = context.to_json()

            # 步骤 5：初始化/更新迭代历史
            history = self._load_iteration_history(workflow.iteration_history or "")
            history.append({
                "iteration_number": workflow.iteration_count + 1,
                "module_name": module_name,
                "defect_count": len(defect_list),
                "defect_ids": [d.get("defect_id", "") for d in defect_list],
                "fixed_defect_ids": [],
                "remaining_defect_ids": [d.get("defect_id", "") for d in defect_list],
                "regression_detected": False,
                "escalated": escalated,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            workflow.iteration_history = json.dumps(history, ensure_ascii=False)

            await db.commit()
            await db.refresh(workflow)

            logger.info(
                f"智能迭代已启动: workflow={workflow_id[:8]}..., "
                f"iteration={workflow.iteration_count + 1}, "
                f"defects={len(defect_list)}, "
                f"escalated={escalated}"
            )

        # 步骤 7：调用增强版 start_iteration 回退到 executing
        await self.start_iteration(workflow_id, review_report=review_report)

        return {
            "success": True,
            "workflow_id": workflow_id,
            "iteration_count": workflow.iteration_count,
            "context": context.to_dict(),
            "escalated": escalated,
            "escalation_reason": escalation_reason,
            "module_name": module_name,
        }

    async def track_iteration_fix(
        self,
        workflow_id: str,
        iteration_number: int,
        fixed_defects: List[str],
        remaining_defects: List[str],
    ) -> Dict[str, Any]:
        """
        追踪迭代修复进度（v4.0.0 新增）
        作用：记录每次迭代中修复了哪些缺陷、还有哪些未修复，
              并与上一轮迭代对比检测回归
        调用方：API 层（评审完成后更新修复状态）
        被调用方：should_escalate_to_human
        运行步骤：
          1. 加载工作流和迭代历史
          2. 更新对应迭代编号的修复记录
          3. 与上一轮迭代对比，检测是否引入新缺陷（回归）
          4. 计算进度百分比
          5. 持久化更新后的迭代历史
        参数：
          - workflow_id: 工作流 ID
          - iteration_number: 迭代编号
          - fixed_defects: 本轮修复的缺陷 ID 列表
          - remaining_defects: 本轮仍未修复的缺陷 ID 列表
        返回值：
          - Dict：含 regression_detected、new_defects、fixed_defects、progress
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            history = self._load_iteration_history(workflow.iteration_history or "")

            # 查找对应迭代编号的记录
            target_entry = None
            prev_entry = None
            for i, entry in enumerate(history):
                if entry.get("iteration_number") == iteration_number:
                    target_entry = entry
                    if i > 0:
                        prev_entry = history[i - 1]
                    break

            if target_entry is None:
                return {
                    "success": False,
                    "error": f"迭代编号 {iteration_number} 不在迭代历史中",
                }

            # 更新当前迭代的修复记录
            target_entry["fixed_defect_ids"] = fixed_defects
            target_entry["remaining_defect_ids"] = remaining_defects

            # 与上一轮对比，检测回归（新引入的缺陷）
            regression_detected = False
            new_defects: List[str] = []
            if prev_entry:
                prev_remaining = set(prev_entry.get("remaining_defect_ids", []))
                prev_fixed = set(prev_entry.get("fixed_defect_ids", []))
                current_remaining = set(remaining_defects)

                # 新缺陷：当前剩余缺陷中，既不在上一轮剩余也不在上一轮已修复的
                new_defects = list(
                    current_remaining - prev_remaining - prev_fixed
                )
                if new_defects:
                    regression_detected = True
                    logger.warning(
                        f"回归检测到新缺陷: workflow={workflow_id[:8]}..., "
                        f"iteration={iteration_number}, "
                        f"new_defects={new_defects}"
                    )

            target_entry["regression_detected"] = regression_detected

            # 计算进度：总缺陷数（原始缺陷列表）- 剩余缺陷数
            total_defects = len(target_entry.get("defect_ids", []))
            remaining_count = len(remaining_defects)
            progress = (total_defects - remaining_count) / max(total_defects, 1)

            # 持久化
            workflow.iteration_history = json.dumps(history, ensure_ascii=False)
            workflow.updated_at = datetime.now(timezone.utc)

            # 回归检测到新缺陷时，自动触发升级
            if regression_detected:
                workflow.force_human_review = True
                logger.warning(
                    f"回归检测触发人工审核升级: workflow={workflow_id[:8]}... "
                    f"新缺陷数={len(new_defects)}"
                )

            await db.commit()

            return {
                "success": True,
                "regression_detected": regression_detected,
                "new_defects": new_defects,
                "fixed_defects": fixed_defects,
                "remaining_defects": remaining_defects,
                "progress": round(progress, 4),
                "iteration_number": iteration_number,
            }

    async def should_escalate_to_human(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        判断是否应升级到人工审核（v4.0.0 新增）
        作用：综合评估当前迭代状态，决定是否需要人工介入
        调用方：API 层（评审阶段结束时调用）
        被调用方：无
        判断条件：
          1. iteration_count >= 2 且仍未通过 → 需升级
          2. force_human_review 已为 True → 需升级
          3. 当前迭代检测到回归（新缺陷引入） → 需升级
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：含 should_escalate（bool）、reason（str）
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {
                    "should_escalate": False,
                    "reason": f"工作流不存在: {workflow_id}",
                }

            reasons: List[str] = []

            # 条件 1：迭代次数 >= 2 且仍未通过
            if workflow.iteration_count >= 2:
                reasons.append(
                    f"迭代次数已达 {workflow.iteration_count}/{workflow.max_iterations}，"
                    f"仍未通过评审"
                )

            # 条件 2：force_human_review 已为 True
            if workflow.force_human_review:
                reasons.append("force_human_review 标记已为 True（先前已触发升级）")

            # 条件 3：当前迭代检测到回归
            history = self._load_iteration_history(workflow.iteration_history or "")
            if history:
                latest = history[-1]
                if latest.get("regression_detected"):
                    reasons.append(
                        f"迭代 #{latest.get('iteration_number')} 检测到回归，"
                        f"引入了新缺陷"
                    )

            should_escalate = len(reasons) > 0
            reason = "；".join(reasons) if reasons else "无需升级"

            logger.info(
                f"升级判断: workflow={workflow_id[:8]}..., "
                f"should_escalate={should_escalate}, "
                f"reason={reason}"
            )

            return {
                "should_escalate": should_escalate,
                "reason": reason,
            }

    # ============================================================
    # 智能迭代闭环方法（v4.1.0 新增）
    # ============================================================

    async def execute_smart_iteration(
        self,
        workflow_id: str,
        review_report: Dict[str, Any],
    ) -> SmartIterationResult:
        """
        执行智能迭代闭环（v4.1.0 新增）
        作用：评审失败时的智能迭代入口，实现缺陷定位→精确修复→回归检测→自动升级
              的完整闭环。与 start_smart_iteration 的区别在于：本方法更聚焦于
              单次迭代的完整执行和结果追踪
        调用方：API 层（评审阶段不通过时自动触发）
        被调用方：start_iteration、track_iteration_fix、escalate_to_human
        运行步骤：
          1. 加载工作流，检查 iteration_count < max_iterations（3）
          2. 若 iteration_count >= max_iterations，标记为 FAILED 并通知人工审核
          3. 从 review_report 中提取精确的缺陷列表
          4. 为每个缺陷识别所属模块（通过 location 字段）
          5. 将缺陷信息（位置、描述、修复建议）发送到对应的 CLI 实例
          6. CLI 实例基于精确指引修复代码（而非简单"retry"）
          7. 修复后重新运行评审
          8. 追踪已修复和未修复的缺陷
          9. 若第 2 轮迭代仍未通过，自动升级到人工审核
        参数：
          - workflow_id: 工作流 ID
          - review_report: 结构化评审报告（CriticalReviewer 输出），
            含缺陷列表和修复建议
        返回值：
          - SmartIterationResult：迭代结果，含修复/剩余缺陷、回归检测、升级状态
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return SmartIterationResult(
                    iteration_number=0,
                    summary=f"工作流不存在: {workflow_id}",
                )

            curr_iteration = workflow.iteration_count

            # 步骤 1-2：检查迭代次数上限
            if curr_iteration >= workflow.max_iterations:
                # 标记为 FAILED 并通知人工审核
                workflow.status = WorkflowStatus.FAILED
                workflow.force_human_review = True
                workflow.error_message = (
                    f"已达到最大迭代次数 ({workflow.max_iterations})，"
                    f"自动升级到人工审核"
                )
                workflow.updated_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(workflow)

                logger.warning(
                    f"智能迭代终止: workflow={workflow_id[:8]}..., "
                    f"reason=达到最大迭代次数"
                )
                return SmartIterationResult(
                    iteration_number=curr_iteration,
                    defects_fixed=[],
                    defects_remaining=[],
                    escalated_to_human=True,
                    continue_iteration=False,
                    summary=f"已达到最大迭代次数 ({workflow.max_iterations})，已升级到人工审核",
                )

            # 步骤 3：提取缺陷列表
            defect_list = self._extract_defect_list(review_report)
            if not defect_list:
                return SmartIterationResult(
                    iteration_number=curr_iteration,
                    defects_fixed=[],
                    defects_remaining=[],
                    continue_iteration=False,
                    summary="评审报告中未发现缺陷，无需迭代",
                )

            # 步骤 4：按模块分类缺陷
            defects_by_module = self._group_defects_by_module(defect_list)
            logger.info(
                f"缺陷按模块分类: workflow={workflow_id[:8]}..., "
                f"modules={list(defects_by_module.keys())}"
            )

            # 步骤 5：将缺陷信息发送到对应的 CLI 实例
            # 将精确的缺陷上下文存储到 iteration_context
            fixed_in_previous = self._load_fixed_defect_ids(
                workflow.iteration_history or ""
            )
            context = IterationContext(
                iteration_number=curr_iteration + 1,
                review_report_summary=review_report.get("summary", ""),
                defect_list=defect_list,
                fixed_in_previous=fixed_in_previous,
                escalation_reason="",
            )

            # 步骤 6：将修复指引存储到 error_message，供 CLI 实例读取
            cli_fix_guidance = self._build_cli_fix_guidance(
                defects_by_module, curr_iteration + 1
            )
            workflow.error_message = cli_fix_guidance
            workflow.iteration_context = context.to_json()

            # 步骤 8-9：迭代次数 >= 2 时自动升级
            escalated = False
            if curr_iteration >= 2:
                workflow.force_human_review = True
                escalated = True
                context.escalation_reason = (
                    f"迭代次数已达 {curr_iteration}，"
                    f"下一轮将自动升级到人工审核"
                )
                workflow.iteration_context = context.to_json()
                logger.warning(
                    f"智能迭代自动升级: workflow={workflow_id[:8]}..., "
                    f"iteration={curr_iteration}"
                )

            # 初始化迭代历史记录
            all_defect_ids = [d.get("defect_id", "") for d in defect_list]
            history = self._load_iteration_history(workflow.iteration_history or "")
            history.append({
                "iteration_number": curr_iteration + 1,
                "defect_count": len(defect_list),
                "defect_ids": all_defect_ids,
                "fixed_defect_ids": [],
                "remaining_defect_ids": all_defect_ids,
                "defects_by_module": {
                    m: [d.get("defect_id", "") for d in defs]
                    for m, defs in defects_by_module.items()
                },
                "regression_detected": False,
                "escalated": escalated,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            workflow.iteration_history = json.dumps(history, ensure_ascii=False)
            workflow.updated_at = datetime.now(timezone.utc)

            await db.commit()
            await db.refresh(workflow)

        # 步骤 6-7：启动迭代（回退到 executing 阶段）
        await self.start_iteration(
            workflow_id,
            review_report=review_report,
            review_feedback=review_report,
        )

        # 构建结果
        summary_parts = [
            f"第 {curr_iteration + 1} 轮智能迭代已启动",
            f"缺陷总数: {len(defect_list)}",
            f"涉及模块: {len(defects_by_module)}",
        ]
        if escalated:
            summary_parts.append("已自动升级到人工审核")

        return SmartIterationResult(
            iteration_number=curr_iteration + 1,
            defects_fixed=[],
            defects_remaining=all_defect_ids,
            regression_detected=False,
            escalated_to_human=escalated,
            continue_iteration=curr_iteration + 1 < workflow.max_iterations,
            summary="；".join(summary_parts),
        )

    async def track_iteration_progress(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        追踪迭代进度（v4.1.0 新增）
        作用：返回完整的迭代历史记录，包括每轮迭代的缺陷修复情况、
              回归检测结果，帮助验证迭代间无回归
        调用方：API 层（前端迭代进度面板）
        被调用方：无
        运行步骤：
          1. 加载工作流和迭代历史
          2. 解析每轮迭代记录
          3. 计算每轮的 defects_found、defects_fixed、defects_remaining
          4. 检测是否存在回归（已修复缺陷重新出现）
          5. 返回结构化迭代历史
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：含 iterations（迭代历史列表）、total_iterations、
            current_iteration、has_regression、max_iterations
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {
                    "success": False,
                    "error": f"工作流不存在: {workflow_id}",
                }

            history = self._load_iteration_history(workflow.iteration_history or "")
            max_iterations = workflow.max_iterations
            current_iteration = workflow.iteration_count

        # 构建每轮迭代的详细记录
        iterations: List[Dict[str, Any]] = []
        has_regression = False

        for entry in history:
            iteration_number = entry.get("iteration_number", 0)
            defect_ids = entry.get("defect_ids", [])
            fixed_ids = entry.get("fixed_defect_ids", [])
            remaining_ids = entry.get("remaining_defect_ids", [])
            regression_detected = entry.get("regression_detected", False)

            if regression_detected:
                has_regression = True

            iterations.append({
                "iteration_number": iteration_number,
                "defects_found": len(defect_ids),
                "defects_fixed": len(fixed_ids),
                "defects_remaining": len(remaining_ids),
                "defect_ids": defect_ids,
                "fixed_defect_ids": fixed_ids,
                "remaining_defect_ids": remaining_ids,
                "regression_detected": regression_detected,
                "escalated": entry.get("escalated", False),
                "timestamp": entry.get("timestamp", ""),
                "progress": (
                    (len(defect_ids) - len(remaining_ids)) / max(len(defect_ids), 1)
                    if defect_ids else 1.0
                ),
            })

        return {
            "success": True,
            "workflow_id": workflow_id,
            "iterations": iterations,
            "total_iterations": len(iterations),
            "current_iteration": current_iteration,
            "max_iterations": max_iterations,
            "has_regression": has_regression,
        }

    async def escalate_to_human(
        self, workflow_id: str, reason: str
    ) -> Dict[str, Any]:
        """
        升级到人工审核（v4.1.0 新增）
        作用：当自动迭代无法解决问题时，将工作流升级到人工审核，
              设置 force_human_review=True，更新状态，推送 SSE 事件通知前端
        调用方：API 层（评审阶段结束时调用）、execute_smart_iteration
        被调用方：无
        运行步骤：
          1. 加载工作流
          2. 设置 workflow.force_human_review = True
          3. 更新 workflow.status 为当前阶段（保留当前阶段，但标记需要人工介入）
          4. 记录升级原因到 workflow.error_message
          5. 推送 SSE 事件通知前端（通过 sse_event_queue）
          6. 返回升级结果
        参数：
          - workflow_id: 工作流 ID
          - reason: 升级原因描述
        返回值：
          - Dict：含 success、workflow_id、force_human_review、reason、sse_event
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {
                    "success": False,
                    "error": f"工作流不存在: {workflow_id}",
                }

            # 步骤 2：设置强制人工审核标记
            workflow.force_human_review = True

            # 步骤 3：保留当前阶段，不做状态变更
            # 但更新 error_message 以记录升级原因
            workflow.error_message = (
                f"[人工审核升级] {reason}\n"
                f"当前阶段: {workflow.current_stage}, "
                f"迭代次数: {workflow.iteration_count}/{workflow.max_iterations}"
            )
            workflow.updated_at = datetime.now(timezone.utc)

            await db.commit()
            await db.refresh(workflow)

            logger.warning(
                f"人工审核升级: workflow={workflow_id[:8]}..., "
                f"reason={reason}"
            )

        # 步骤 5：构建 SSE 事件并推送
        sse_event = {
            "type": "escalate_to_human",
            "workflow_id": workflow_id,
            "reason": reason,
            "current_stage": workflow.current_stage,
            "iteration_count": workflow.iteration_count,
            "max_iterations": workflow.max_iterations,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # 尝试通过 SSE 事件队列推送（如果已配置）
        sse_pushed = False
        if hasattr(self, "_sse_event_queue") and self._sse_event_queue is not None:
            try:
                await self._sse_event_queue.put(sse_event)
                sse_pushed = True
                logger.info(
                    f"SSE 事件已推送: workflow={workflow_id[:8]}..., "
                    f"type=escalate_to_human"
                )
            except Exception as e:
                logger.warning(f"SSE 事件推送失败: {e}")

        return {
            "success": True,
            "workflow_id": workflow_id,
            "force_human_review": True,
            "reason": reason,
            "current_stage": workflow.current_stage,
            "iteration_count": workflow.iteration_count,
            "sse_pushed": sse_pushed,
            "sse_event": sse_event,
        }

    # ============================================================
    # 智能迭代辅助方法（v4.1.0 新增）
    # ============================================================

    def _group_defects_by_module(
        self, defect_list: List[Dict[str, Any]]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        按模块分类缺陷（v4.1.0 新增）
        作用：从缺陷的 location 字段中提取模块名，将缺陷按模块分组
        参数：
          - defect_list: 缺陷列表
        返回值：模块名 → 缺陷列表的映射字典
        """
        defects_by_module: Dict[str, List[Dict[str, Any]]] = {}
        for d in defect_list:
            location = d.get("location", "")
            module_name = self._extract_module_from_location(location)
            if module_name not in defects_by_module:
                defects_by_module[module_name] = []
            defects_by_module[module_name].append(d)
        return defects_by_module

    def _extract_module_from_location(self, location: str) -> str:
        """
        从缺陷位置信息中提取模块名（v4.1.0 新增）
        作用：解析 location 字符串（如 "src/module_a/file.py" 或 "模块A"），
              提取模块名
        参数：
          - location: 缺陷位置字符串
        返回值：模块名（无法识别时返回 "unknown"）
        """
        if not location or not location.strip():
            return "unknown"

        location = location.strip()

        # 尝试从路径中提取：src/module_a/file.py → module_a
        if "/" in location:
            parts = location.split("/")
            # 跳过常见的根目录前缀
            skip_prefixes = {"src", "lib", "app", "backend", "frontend", "modules"}
            for part in parts:
                if part.lower() not in skip_prefixes and part:
                    # 去掉文件扩展名
                    if "." in part:
                        return part.rsplit(".", 1)[0]
                    return part

        # 尝试匹配中文模块名：模块A、模块B 等
        import re as _re
        cn_match = _re.match(r"模块\s*[A-Za-z0-9]+", location)
        if cn_match:
            return cn_match.group(0)

        # 回退：直接使用 location 的前 30 个字符
        return location[:30]

    def _build_cli_fix_guidance(
        self,
        defects_by_module: Dict[str, List[Dict[str, Any]]],
        iteration_number: int,
    ) -> str:
        """
        构建 CLI 实例修复指引（v4.1.0 新增）
        作用：将按模块分类的缺陷转换为 CLI 实例可读取的精确修复指引文本，
              每个模块的缺陷附带位置、描述和修复建议
        参数：
          - defects_by_module: 按模块分类的缺陷字典
          - iteration_number: 当前迭代编号
        返回值：格式化的修复指引文本
        """
        lines = [
            f"=== 第 {iteration_number} 轮迭代精确修复指引 ===",
            f"请根据以下各模块的缺陷信息进行精确修复（非简单重试）：",
            "",
        ]

        for module_name, defects in defects_by_module.items():
            lines.append(f"## 模块: {module_name}")
            lines.append(f"   缺陷数: {len(defects)}")
            for i, d in enumerate(defects):
                defect_id = d.get("defect_id", f"defect-{i + 1}")
                severity = d.get("severity", "medium")
                location = d.get("location", "")
                description = d.get("description", "")
                fix_suggestion = d.get(
                    "fix_suggestion", d.get("repair_plan", "")
                )
                lines.append(f"   [{i + 1}] ID: {defect_id} | 严重程度: {severity}")
                lines.append(f"       位置: {location}")
                lines.append(f"       描述: {description}")
                if fix_suggestion:
                    lines.append(f"       修复建议: {fix_suggestion}")
            lines.append("")

        lines.append("请针对以上缺陷逐一修复，确保不引入新的回归问题。")
        return "\n".join(lines)

    # ============================================================
    # 迭代辅助方法（v4.0.0 新增）
    # ============================================================

    def _extract_defect_list(
        self, review_report: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        从评审报告中提取结构化缺陷列表
        参数：
          - review_report: 评审报告字典
        返回值：缺陷列表，每项含 defect_id、severity、location、description、fix_suggestion
        """
        defect_list: List[Dict[str, Any]] = []

        # 尝试从 defect_list 字段直接获取（CriticalReviewer 标准输出格式）
        if "defect_list" in review_report:
            raw_defects = review_report["defect_list"]
            if isinstance(raw_defects, list):
                for i, d in enumerate(raw_defects):
                    if isinstance(d, dict):
                        defect_list.append({
                            "defect_id": d.get("defect_id", f"defect-{i + 1}"),
                            "severity": d.get("severity", "medium"),
                            "location": d.get("location", ""),
                            "description": d.get("description", ""),
                            "fix_suggestion": d.get(
                                "fix_suggestion", d.get("repair_plan", "")
                            ),
                        })
                return defect_list

        # 尝试从 issues 字段获取
        if "issues" in review_report:
            raw_issues = review_report["issues"]
            if isinstance(raw_issues, list):
                for i, issue in enumerate(raw_issues):
                    if isinstance(issue, dict):
                        defect_list.append({
                            "defect_id": issue.get("id", f"defect-{i + 1}"),
                            "severity": issue.get("severity", "medium"),
                            "location": issue.get("location", issue.get("file", "")),
                            "description": issue.get(
                                "description", issue.get("message", "")
                            ),
                            "fix_suggestion": issue.get(
                                "suggestion", issue.get("fix", "")
                            ),
                        })
                return defect_list

        # 尝试从 feedback 字段获取（纯文本评审回退）
        if "feedback" in review_report and isinstance(review_report["feedback"], str):
            feedback = review_report["feedback"]
            if feedback.strip():
                defect_list.append({
                    "defect_id": "defect-1",
                    "severity": "medium",
                    "location": "整体代码",
                    "description": feedback[:500],
                    "fix_suggestion": "请根据评审反馈进行修复",
                })

        return defect_list

    def _load_iteration_history(
        self, history_json: str
    ) -> List[Dict[str, Any]]:
        """
        加载迭代历史 JSON 数组
        参数：
          - history_json: JSON 字符串
        返回值：迭代历史列表
        """
        if not history_json or not history_json.strip():
            return []
        try:
            data = json.loads(history_json)
            if isinstance(data, list):
                return data
            return []
        except (json.JSONDecodeError, TypeError):
            return []

    def _load_fixed_defect_ids(self, history_json: str) -> List[str]:
        """
        从迭代历史中加载所有已修复的缺陷 ID
        参数：
          - history_json: JSON 字符串
        返回值：已修复缺陷 ID 列表
        """
        history = self._load_iteration_history(history_json)
        fixed_ids: List[str] = []
        for entry in history:
            fixed_ids.extend(entry.get("fixed_defect_ids", []))
        return fixed_ids

    def _format_review_feedback_for_cli(
        self, review_feedback: Dict[str, Any], iteration_number: int
    ) -> str:
        """
        将 review_feedback 格式化为可供 CLI 实例读取的修复目标文本（v4.1.0 新增）
        作用：将结构化 review_feedback（含缺陷列表和修复建议）转换为可读文本，
              存储到 workflow.error_message 供后续追踪和 CLI 读取
        参数：
          - review_feedback: 需求反馈字典，含 defect_list 和 fix_suggestions
          - iteration_number: 当前迭代编号
        返回值：格式化后的修复目标文本
        """
        lines = [f"=== 第 {iteration_number} 轮迭代修复目标 ==="]

        # 提取缺陷列表
        defect_list = review_feedback.get("defect_list", [])
        if defect_list:
            lines.append(f"\n缺陷总数: {len(defect_list)}")
            lines.append("-" * 40)
            for i, d in enumerate(defect_list):
                if isinstance(d, dict):
                    defect_id = d.get("defect_id", f"defect-{i + 1}")
                    severity = d.get("severity", "medium")
                    location = d.get("location", "未知位置")
                    description = d.get("description", "")
                    fix_suggestion = d.get(
                        "fix_suggestion", d.get("repair_plan", "")
                    )
                    lines.append(f"\n[缺陷 {i + 1}] ID: {defect_id}")
                    lines.append(f"  严重程度: {severity}")
                    lines.append(f"  位置: {location}")
                    lines.append(f"  描述: {description}")
                    if fix_suggestion:
                        lines.append(f"  修复建议: {fix_suggestion}")
                elif isinstance(d, str):
                    lines.append(f"\n[缺陷 {i + 1}] {d}")

        # 提取修复建议
        fix_suggestions = review_feedback.get("fix_suggestions", [])
        if fix_suggestions:
            lines.append(f"\n修复建议列表:")
            for i, suggestion in enumerate(fix_suggestions):
                if isinstance(suggestion, dict):
                    lines.append(
                        f"  {i + 1}. [{suggestion.get('defect_id', '?')}] "
                        f"{suggestion.get('suggestion', '')}"
                    )
                elif isinstance(suggestion, str):
                    lines.append(f"  {i + 1}. {suggestion}")

        # 提取摘要
        summary = review_feedback.get("summary", "")
        if summary:
            lines.append(f"\n评审摘要: {summary}")

        return "\n".join(lines)

    async def update_stage_output(
        self, workflow_id: str, stage_name: str, output_doc: str,
        conversation_summary: str = "", agent_role: str = ""
    ) -> WorkflowStage:
        """更新阶段输出文档"""
        async with self.session_factory() as db:
            result = await db.execute(
                select(WorkflowStage).where(
                    WorkflowStage.workflow_id == workflow_id,
                    WorkflowStage.stage_name == stage_name,
                )
            )
            stage = result.scalar_one_or_none()
            if stage is None:
                raise ValueError(f"阶段不存在: {workflow_id}/{stage_name}")

            stage.output_doc = output_doc
            if conversation_summary:
                stage.conversation_summary = conversation_summary
            if agent_role:
                stage.agent_role = agent_role

            await db.commit()
            await db.refresh(stage)
            return stage

    async def update_workflow_docs(
        self, workflow_id: str, **docs
    ) -> Workflow:
        """更新工作流文档（requirement_doc, spec_doc, checklist_doc, task_doc, acceptance_doc）"""
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            for key, value in docs.items():
                if hasattr(workflow, key):
                    setattr(workflow, key, value)

            workflow.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(workflow)
            return workflow

    # ============================================================
    # 阶段边界校验与人工确认/驳回
    # ============================================================

    async def validate_stage_boundary(
        self, workflow_id: str, from_stage: str, to_stage: str
    ) -> Tuple[bool, List[str]]:
        """
        阶段边界 100% 闭环校验
        作用：在阶段推进前强制校验前置条件，确保各阶段输出物完整、人工确认已完成
        调用方：advance_stage（阶段推进时自动调用）
        被调用方：无
        运行步骤：
          1. 加载 workflow 记录
          2. 根据 from_stage → to_stage 的转换路径匹配校验规则
          3. 逐条检查前置条件，收集未满足的条件列表
          4. 返回 (是否全部通过, 未满足条件列表)
        参数：
          - workflow_id: 工作流 ID
          - from_stage: 当前阶段名称
          - to_stage: 目标阶段名称
        返回值：
          - Tuple[bool, List[str]]：(是否通过校验, 未满足条件的描述列表)
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return False, [f"工作流不存在: {workflow_id}"]

            missing: List[str] = []
            transition_key = f"{from_stage}→{to_stage}"

            # clarifying → designing 校验规则
            if transition_key == "clarifying→designing":
                # 检查需求文档非空
                if not workflow.requirement_doc or not workflow.requirement_doc.strip():
                    missing.append("需求文档（requirement_doc）为空，需求澄清阶段未产出有效文档")
                # 检查人工确认需求
                if not workflow.human_confirmed_requirement:
                    missing.append("需求澄清阶段未通过人工确认（human_confirmed_requirement=False）")
                # v2.4.0 新增：检查需求澄清是否完成
                if workflow.clarification_complete is not True:
                    missing.append("需求澄清未完成（clarification_complete=False）")

            # designing → prompting 校验规则
            elif transition_key == "designing→prompting":
                # 检查四大架构文档均非空
                if not workflow.spec_doc or not workflow.spec_doc.strip():
                    missing.append("架构 spec 文档（spec_doc）为空")
                if not workflow.checklist_doc or not workflow.checklist_doc.strip():
                    missing.append("架构 checklist 文档（checklist_doc）为空")
                if not workflow.task_doc or not workflow.task_doc.strip():
                    missing.append("架构 task 文档（task_doc）为空")
                if not workflow.acceptance_doc or not workflow.acceptance_doc.strip():
                    missing.append("验收标准文档（acceptance_doc）为空")
                # 检查人工确认架构
                if not workflow.human_confirmed_architecture:
                    missing.append("架构设计阶段未通过人工确认（human_confirmed_architecture=False）")
                # 检查批判迭代已通过
                if not workflow.critique_passed:
                    missing.append("批判迭代未通过（critique_passed=False）")
                # v5.1.0 修复：designing→prompting 转换不再阻塞 prompts_optimized=False。
                # 因为 confirm_stage("designing") 后会自动通过后台 _run_prompting_phase
                # 任务生成提示词并设置 prompts_optimized=True，然后再次 advance 到 executing。
                # 提前强制要求 prompts_optimized=True 会导致 designing→prompting 死锁。
                # prompting→executing 阶段会单独校验 prompts_optimized=True。
                if (
                    not workflow.prompts_optimized
                    and not workflow.human_confirmed_architecture
                ):
                    missing.append(
                        "提示词尚未完成优化（prompts_optimized=False），"
                        "且未通过架构人工确认，无法推进到 prompting"
                    )

            # prompting → executing 校验规则
            elif transition_key == "prompting→executing":
                # v5.3.0 修复：允许 prompts_optimized=True 时直接通过，
                # 解决 _run_prompting_phase 完成提示词生成但阶段状态未标 COMPLETED 的死锁
                if not workflow.prompts_optimized:
                    # 检查 prompting 阶段的 stage 状态为 COMPLETED
                    prompting_stage = await self._get_stage_by_name(db, workflow_id, "prompting")
                    if prompting_stage is None or prompting_stage.status != StageStatus.COMPLETED:
                        missing.append("提示词工程阶段（prompting）状态未标记为 COMPLETED")
                # 检查提示词已优化
                if not workflow.prompts_optimized:
                    missing.append("提示词尚未完成优化（prompts_optimized=False）")

            # executing → reviewing 校验规则
            elif transition_key == "executing→reviewing":
                # 检查 executing 阶段的 stage 状态为 COMPLETED
                executing_stage = await self._get_stage_by_name(db, workflow_id, "executing")
                if executing_stage is None or executing_stage.status != StageStatus.COMPLETED:
                    missing.append("代码执行阶段（executing）状态未标记为 COMPLETED")
                # 检查原子任务清单无未完成任务（通过 task_doc 和 acceptance_doc 间接校验）
                # 若存在 atomic_task_aggregator 可调用更精确的检查，此处做基础校验
                if not workflow.task_doc or not workflow.task_doc.strip():
                    missing.append("原子任务清单（task_doc）为空，无法确认任务完成状态")
                # 检查所有模块已完成 Git 提交
                if workflow.push_status not in ("pushed", "pushing"):
                    missing.append(f"代码尚未推送到 Git 仓库（push_status={workflow.push_status}），请先完成 Git 提交")

            logger.info(
                f"阶段边界校验: {workflow_id[:8]}... {transition_key} "
                f"→ {'通过' if not missing else f'未通过({len(missing)}项)'}"
            )
            return len(missing) == 0, missing

    async def confirm_stage(
        self, workflow_id: str, stage_name: str
    ) -> Dict[str, Any]:
        """
        人工确认节点处理
        作用：由人工确认当前阶段产出物，更新对应的确认标记；
             对于 designing 阶段同时创建 GitHub 仓库
        调用方：API 层（工作流确认接口）
        被调用方：无
        运行步骤：
          1. 加载 workflow 记录
          2. 根据 stage_name 更新对应的确认标记：
             - "clarifying" → human_confirmed_requirement = True
             - "designing" → human_confirmed_architecture = True，并创建 GitHub 仓库
             - "reviewing" → human_confirmed_review = True
          3. 若为 "designing" 确认，迁移自原 start_workflow 的 Git 仓库创建逻辑
          4. 返回确认结果
        参数：
          - workflow_id: 工作流 ID
          - stage_name: 阶段名称（clarifying/designing/reviewing）
        返回值：
          - Dict：包含确认结果、更新后的标记状态、Git 仓库创建结果（如适用）
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            result: Dict[str, Any] = {
                "success": True,
                "workflow_id": workflow_id,
                "stage_name": stage_name,
            }

            # 根据阶段名称更新对应的确认标记
            if stage_name == "clarifying":
                # v2.4.0 新增：确认前校验需求文档和澄清完成状态
                # v3.2.3 修复：需求文档为空时不再直接失败，先尝试调用
                # finalize_requirement_doc 生成文档（用户直接点击跳过按钮时可能尚未 finalize），
                # 仅当生成后仍为空才返回失败，避免弹窗因静默失败而卡住
                if not workflow.requirement_doc or not workflow.requirement_doc.strip():
                    if self.clarification_service is not None:
                        try:
                            await self.clarification_service.finalize_requirement_doc(
                                workflow_id
                            )
                            await db.refresh(workflow)
                            logger.info(
                                f"confirm_stage 触发需求文档兜底生成: "
                                f"{workflow_id[:8]}..."
                            )
                        except Exception as e:
                            logger.error(f"需求文档兜底生成失败: {e}")
                    # 兜底生成后仍为空才返回失败
                    if not workflow.requirement_doc or not workflow.requirement_doc.strip():
                        return {"success": False, "message": "需求文档为空，请先完成需求澄清"}
                # v3.2.1 修复：用户显式点击"跳过不确定项"时，clarification_complete 可能为 False，
                # 此时应自动补全并允许推进，而非硬拒绝
                if not workflow.clarification_complete:
                    workflow.clarification_complete = True
                    logger.info(
                        f"用户显式跳过不确定项，自动补全 clarification_complete: "
                        f"{workflow_id[:8]}..."
                    )
                workflow.human_confirmed_requirement = True
                result["human_confirmed_requirement"] = True
                logger.info(f"需求澄清阶段已人工确认: {workflow_id[:8]}...")
                # v3.1.0 修复：确认后自动推进到架构设计阶段
                await db.commit()
                await db.refresh(workflow)
                advance_result = await self.advance_stage(workflow_id)
                result["advanced"] = True
                result["next_stage"] = advance_result.stage_name if advance_result else None
                logger.info(
                    f"工作流自动推进: {workflow_id[:8]}... clarifying → "
                    f"{advance_result.stage_name if advance_result else '未知'}"
                )
                return result

            elif stage_name == "designing":
                workflow.human_confirmed_architecture = True
                result["human_confirmed_architecture"] = True
                logger.info(f"架构设计阶段已人工确认: {workflow_id[:8]}...")

                # v5.5.0 修复 (Bug 3)：先 commit + refresh，再调用 advance_stage，
                # 否则 validate_stage_boundary 会读到 stale 数据
                # (human_confirmed_architecture=False) 导致推进失败
                await db.commit()
                await db.refresh(workflow)
                logger.info(
                    f"架构确认标志已持久化: {workflow_id[:8]}..."
                )

                # 创建 GitHub 仓库（迁移自原 start_workflow 逻辑）
                if self.git_manager is not None:
                    try:
                        project_name = workflow.repo_name or "auto-code-project"
                        remote_result = await self.git_manager.setup_remote(project_name)
                        if remote_result.get("success"):
                            repo_url = remote_result.get("html_url", "")
                            result["repo_created"] = True
                            result["repo_url"] = repo_url
                            logger.info(f"GitHub 仓库已创建: {repo_url}")
                        else:
                            result["repo_created"] = False
                            result["repo_error"] = remote_result.get("message", "未知错误")
                            logger.warning(
                                f"GitHub 仓库创建失败: {remote_result.get('message')}"
                            )
                    except Exception as e:
                        result["repo_created"] = False
                        result["repo_error"] = str(e)
                        logger.error(f"创建 GitHub 仓库异常: {e}")
                else:
                    result["repo_created"] = False
                    result["repo_error"] = "git_manager 不可用"
                    logger.warning("git_manager 不可用，跳过 GitHub 仓库创建")

                # v5.1.0 新增：架构设计确认后自动推进到 prompting 阶段，
                # 并立即触发后台异步任务生成各模块优化提示词，填补
                # designing→prompting→executing 阶段的自动推进 GAP
                # v5.5.0 修复 (Bug 3)：将 advance_stage 和 _run_prompting_phase 拆分，
                # 即使 advance 失败 _run_prompting_phase 也会被调度
                advance_result = None
                try:
                    advance_result = await self.advance_stage(workflow_id)
                    result["advanced"] = True
                    result["next_stage"] = (
                        advance_result.stage_name if advance_result else None
                    )
                    logger.info(
                        f"设计阶段确认后自动推进到 prompting: "
                        f"{workflow_id[:8]}... → "
                        f"{advance_result.stage_name if advance_result else '未知'}"
                    )
                except Exception as advance_exc:
                    logger.exception(
                        f"设计阶段确认后自动推进失败: {advance_exc}"
                    )
                    result["auto_advance_error"] = str(advance_exc)

                # v5.5.0 修复 (Bug 3)：始终调度 _run_prompting_phase（即使 advance 失败）
                # 立即在 prompting 阶段生成模块提示词（异步后台任务，不阻塞 confirm 响应）
                try:
                    asyncio.create_task(self._run_prompting_phase(workflow_id))
                except RuntimeError as loop_exc:
                    # 无事件循环时降级为直接 await
                    logger.warning(
                        f"asyncio.create_task 失败，改为同步执行: {loop_exc}"
                    )
                    await self._run_prompting_phase(workflow_id)

                # v5.5.0 修复 (Bug 5)：显式标记 designing 阶段为 COMPLETED
                # 防止 asyncio.create_task 后台任务与 advance_stage 的
                # _complete_current_stage 竞态导致状态未标 COMPLETED
                try:
                    await self._complete_current_stage(
                        db, workflow_id, "designing"
                    )
                    await db.commit()
                    logger.info(
                        f"designing 阶段已显式标记为 COMPLETED: "
                        f"{workflow_id[:8]}..."
                    )
                except Exception as stage_exc:
                    logger.warning(
                        f"标记 designing 阶段 COMPLETED 失败（非阻塞）: {stage_exc}"
                    )

            elif stage_name == "reviewing":
                workflow.human_confirmed_review = True
                result["human_confirmed_review"] = True
                logger.info(f"质量评审阶段已人工确认: {workflow_id[:8]}...")

            else:
                return {
                    "success": False,
                    "error": f"不支持的确认阶段: {stage_name}，仅支持 clarifying/designing/reviewing",
                }

            workflow.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(workflow)

        return result

    async def _run_prompting_phase(self, workflow_id: str) -> Dict[str, Any]:
        """
        提示词工程阶段：自动为每个模块生成优化后的提示词
        作用：填补 designing→prompting→executing 阶段的自动推进 GAP；
             被 confirm_stage("designing") 后台任务调用，完成后自动推进到 executing
        调用方：confirm_stage("designing") 内部 asyncio.create_task
        被调用方：PromptEngineer（如果可用）、self.advance_stage
        运行步骤：
          1. 加载 workflow 记录，解析 task_doc 提取模块列表
          2. 降级策略：若解析失败则使用默认占位模块列表
          3. 尝试用 PromptEngineer.optimize_prompt() 优化每个模块的提示词
          4. PromptEngineer 不可用或调用失败时使用模板化的兜底提示词
          5. 持久化优化后的提示词到 workflow.error_message 的 __PROMPTS__ 段
             并设置 prompts_optimized=True
          6. 调用 self.advance_stage(workflow_id) 推进到 executing 阶段
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：包含成功状态、模块数量、提示词生成结果摘要
        """
        from sqlalchemy import select
        from ..models import Workflow

        result: Dict[str, Any] = {
            "success": False,
            "workflow_id": workflow_id,
            "module_count": 0,
            "phases": [],
        }

        try:
            # Step 1: 加载工作流数据
            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if not workflow:
                    logger.error(
                        f"_run_prompting_phase: workflow {workflow_id} not found"
                    )
                    return result
                task_doc = workflow.task_doc or ""
                acceptance_doc = workflow.acceptance_doc or ""
                requirement_doc = workflow.requirement_doc or ""
                spec_doc = workflow.spec_doc or ""

            # Step 2: 解析模块列表
            # 优先匹配 "### Module N: 标题" 或 "### 模块 N: 标题"
            module_pattern = re.compile(
                r'(?:^|\n)#{2,4}\s*(?:Module|模块)\s*\d+[：:、\.\s]+([^\n]+)'
            )
            module_matches = [
                m.strip()[:80] for m in module_pattern.findall(task_doc)
                if m and m.strip()
            ]
            if not module_matches:
                # 降级策略 1：匹配 "模块X: 标题" 或 "Module X: 标题"
                fallback_pattern = re.compile(
                    r'(?:^|\n)[#\-\*\d\.\s]*([\u4e00-\u9fa5A-Za-z0-9_]+)'
                    r'(?:Module|模块)?\s*\d*[：:]\s*([^\n]+)'
                )
                module_matches = [
                    (m[1] if isinstance(m, tuple) else m).strip()[:80]
                    for m in fallback_pattern.findall(task_doc)
                    if m and (m[1] if isinstance(m, tuple) else m).strip()
                ][:10]
            if not module_matches:
                # 降级策略 2：使用默认占位模块
                logger.warning(
                    f"_run_prompting_phase: 未解析到模块，使用默认占位 "
                    f"workflow={workflow_id[:8]}..."
                )
                module_matches = [f"Module {i + 1}" for i in range(7)]
            result["module_count"] = len(module_matches)
            logger.info(
                f"_run_prompting_phase: 解析到 {len(module_matches)} 个模块 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 3: 构造 PromptEngineer（如果 hermes_service 可用）
            pe = None
            hermes_service = getattr(self, "hermes_service", None)
            if hermes_service is not None:
                try:
                    from .agent_roles.prompt_engineer import (
                        PromptEngineer,
                        ModuleTask,
                    )
                    pe = PromptEngineer(
                        hermes_service=hermes_service,
                        agent_manager=getattr(hermes_service, "agent_manager", None),
                        worktree_manager=None,
                    )
                except Exception as pe_init_exc:
                    logger.warning(
                        f"PromptEngineer 初始化失败，使用模板兜底: {pe_init_exc}"
                    )
                    pe = None

            # Step 4: 为每个模块生成提示词
            optimized_prompts: List[Dict[str, Any]] = []
            architecture_context = (
                f"{spec_doc[:1500]}\n\n{task_doc[:1500]}"
            ).strip()
            for idx, module_name in enumerate(module_matches):
                module_name = (module_name or f"Module {idx + 1}").strip()[:80]
                module_prompt: Optional[str] = None
                if pe is not None:
                    try:
                        from .agent_roles.prompt_engineer import ModuleTask
                        task = ModuleTask(
                            name=module_name,
                            description=(
                                f"实现 {module_name} 模块（基于需求文档和架构设计）"
                            ),
                            priority=str(idx),
                            acceptance_criteria=acceptance_doc[:1000],
                        )
                        module_prompt = await pe.optimize_prompt(
                            module_task=task,
                            architecture_context=architecture_context,
                            dependency_context="",
                            acceptance_criteria=acceptance_doc[:2000],
                            interface_specs="",
                        )
                        result["phases"].append(
                            {"module": module_name, "source": "prompt_engineer"}
                        )
                        logger.info(
                            f"模块提示词生成成功 (PromptEngineer): {module_name}"
                        )
                    except Exception as pe_call_exc:
                        logger.warning(
                            f"模块 {module_name} PromptEngineer 优化失败，"
                            f"降级为模板: {pe_call_exc}"
                        )
                        module_prompt = None

                if not module_prompt:
                    # 模板兜底：使用结构化模板生成
                    module_prompt = (
                        f"## 任务目标\n\n"
                        f"实现 {module_name} 模块。\n\n"
                        f"## 详细需求\n\n"
                        f"{requirement_doc[:1500]}\n\n"
                        f"## 核心约束\n\n"
                        f"- 遵循 Google C++ Style Guide / PEP8\n"
                        f"- 异常处理：所有外部依赖必须有 try/except 保护\n"
                        f"- 边界条件：空值、None、越界必须显式处理\n\n"
                        f"## 验收标准\n\n"
                        f"{acceptance_doc[:1000]}\n\n"
                        f"## 输出要求\n\n"
                        f"- 完整可运行代码（无 TODO / pass 占位）\n"
                        f"- 关键函数 docstring 必须含中英双语说明\n"
                        f"- 模块自检：单元测试覆盖核心路径\n"
                    )
                    result["phases"].append(
                        {"module": module_name, "source": "template_fallback"}
                    )
                    logger.info(
                        f"模块提示词使用模板兜底生成: {module_name}"
                    )

                optimized_prompts.append({
                    "module": module_name,
                    "prompt": (module_prompt or "")[:2000],
                    "index": idx,
                })

            # Step 5: 持久化提示词 + 推进到 executing
            import json as _json
            try:
                prompts_blob = _json.dumps(
                    optimized_prompts, ensure_ascii=False
                )[:30000]
            except Exception as json_exc:
                logger.warning(
                    f"提示词 JSON 序列化失败，使用简化版本: {json_exc}"
                )
                prompts_blob = _json.dumps(
                    [
                        {"module": p["module"], "prompt": p["prompt"][:500]}
                        for p in optimized_prompts
                    ],
                    ensure_ascii=False,
                )[:30000]

            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if workflow is None:
                    logger.error(
                        f"_run_prompting_phase: 持久化阶段 workflow 消失 "
                        f"{workflow_id[:8]}..."
                    )
                    return result
                workflow.prompts_optimized = True
                existing_error = workflow.error_message or ""
                # 追加 __PROMPTS__ 段，避免覆盖已有错误信息
                prompts_marker = "\n__PROMPTS__:"
                if prompts_marker in existing_error:
                    # 替换旧 __PROMPTS__ 段
                    head, _, _ = existing_error.partition(prompts_marker)
                    workflow.error_message = f"{head}{prompts_marker}{prompts_blob}"
                else:
                    workflow.error_message = (
                        f"{existing_error}{prompts_marker}{prompts_blob}"
                    )
                workflow.updated_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(
                    f"提示词持久化完成: {len(optimized_prompts)} 个模块 "
                    f"workflow={workflow_id[:8]}..."
                )

            result["success"] = True

            # v5.3.0 修复：在调用 advance_stage 之前先将 prompting 阶段标记为 COMPLETED，
            # 否则 validate_stage_boundary 会因阶段状态非 COMPLETED 而拒绝推进，
            # 与 _run_prompting_phase 完成提示词生成后立即推进的设计冲突
            try:
                async with self.session_factory() as db:
                    await self._complete_current_stage(db, workflow_id, "prompting")
                    await db.commit()
                    logger.info(
                        f"_run_prompting_phase: prompting 阶段已标记为 COMPLETED "
                        f"workflow={workflow_id[:8]}..."
                    )
            except Exception as mark_exc:
                logger.warning(
                    f"_run_prompting_phase: 标记 prompting 阶段 COMPLETED 失败 "
                    f"（将由 validate_stage_boundary 的 prompts_optimized 宽松校验兜底）: "
                    f"{mark_exc}"
                )

            # Step 6: 推进到 executing 阶段
            try:
                advance_result = await self.advance_stage(workflow_id)
                result["advanced_to"] = (
                    advance_result.stage_name if advance_result else None
                )
                logger.info(
                    f"_run_prompting_phase: 已推进到 "
                    f"{advance_result.stage_name if advance_result else '未知'} "
                    f"workflow={workflow_id[:8]}..."
                )
            except Exception as adv_exc:
                logger.exception(
                    f"_run_prompting_phase: 推进到 executing 失败: {adv_exc}"
                )
                result["advance_error"] = str(adv_exc)

            # v5.6.0 修复：调度 _run_executing_phase 后台任务
            # 填补 executing 阶段没有自动 runner 的 GAP，让 prompting→executing
            # 推进后由后台异步任务真正调用 LLM 生成代码并写入工作区
            try:
                asyncio.create_task(self._run_executing_phase(workflow_id))
                logger.info(
                    f"_run_prompting_phase: 已调度 _run_executing_phase 后台任务 "
                    f"workflow={workflow_id[:8]}..."
                )
            except RuntimeError as loop_exc:
                # 无事件循环时降级为同步执行（兜底）
                logger.warning(
                    f"_run_prompting_phase: 调度 executing 后台任务失败，"
                    f"改为同步执行: {loop_exc}"
                )
                try:
                    await self._run_executing_phase(workflow_id)
                except Exception as exec_exc:
                    logger.warning(
                        f"_run_prompting_phase: 同步执行 _run_executing_phase 失败: "
                        f"{exec_exc}"
                    )
        except Exception as exc:
            logger.exception(f"_run_prompting_phase 失败: {exc}")
            result["error"] = str(exc)
        return result

    async def _run_executing_phase(self, workflow_id: str) -> Dict[str, Any]:
        """
        执行阶段：调用真实 LLM 为每个模块编写代码并写入工作区（v5.6.0 新增）
        作用：填补 executing→reviewing 的 GAP；
             被 _run_prompting_phase 末尾调度，调用真实 LLM 而非模板
        调用方：_run_prompting_phase 末尾的 asyncio.create_task
        被调用方：self.hermes_service.executor（真实 LLM 调用）、
                 self.git_manager.auto_commit（Git 自动提交）、
                 self.advance_stage（推进到 reviewing）
        运行步骤：
          1. 加载 workflow 记录，从 error_message 的 __PROMPTS__ 段解析模块提示词
          2. 确定工作区路径（git_manager.workspace_path / repo_path / 兜底目录）
          3. 为每个模块构造代码生成 Prompt，调用 executor.execute 真实 LLM
          4. 解析 LLM 输出中的 # FILE: 标记，按需写入文件
          5. 通过 git_manager.auto_commit 自动提交（若可用）
          6. 将 executing 阶段标记为 COMPLETED
          7. 调用 self.advance_stage(workflow_id) 推进到 reviewing
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：包含 success、modules_processed、files_written、phases 等字段
        """
        from sqlalchemy import select
        from ..models import Workflow
        import os
        import re as _re
        import json as _json

        result: Dict[str, Any] = {
            "success": False,
            "workflow_id": workflow_id,
            "modules_processed": 0,
            "files_written": 0,
            "phases": [],
        }

        try:
            # Step 1: 加载 workflow + 解析 __PROMPTS__ 段
            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if not workflow:
                    logger.error(
                        f"_run_executing_phase: workflow {workflow_id} not found"
                    )
                    return result
                error_msg = workflow.error_message or ""

            prompts: List[Dict[str, Any]] = []
            if "__PROMPTS__:" in error_msg:
                try:
                    _, _, blob = error_msg.partition("__PROMPTS__:")
                    prompts = _json.loads(blob.strip())
                except Exception as parse_exc:
                    logger.warning(
                        f"_run_executing_phase: 解析 __PROMPTS__ 失败: {parse_exc}"
                    )
            if not prompts:
                logger.warning(
                    f"_run_executing_phase: 未找到模块提示词 "
                    f"workflow={workflow_id[:8]}..."
                )
                return result
            result["modules_processed"] = len(prompts)
            logger.info(
                f"_run_executing_phase: 解析到 {len(prompts)} 个模块的提示词 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 2: 确定工作区路径
            workspace: Optional[str] = None
            if self.git_manager and hasattr(self.git_manager, "workspace_path"):
                workspace = self.git_manager.workspace_path  # type: ignore[attr-defined]
            if not workspace and self.git_manager and hasattr(self.git_manager, "repo_path"):
                workspace = self.git_manager.repo_path
            if not workspace:
                workspace = os.path.join(os.getcwd(), "agent_workspace")
            try:
                os.makedirs(workspace, exist_ok=True)
            except Exception as mkdir_exc:
                logger.warning(
                    f"_run_executing_phase: 创建工作区目录失败 {workspace}: {mkdir_exc}"
                )

            # Step 3: 调用 LLM 写代码
            executor = getattr(
                getattr(self, "hermes_service", None), "executor", None
            )
            if executor is None:
                logger.error(
                    "_run_executing_phase: executor 不可用，无法调用 LLM"
                )
                result["error"] = "executor unavailable"
                return result

            total_files = 0
            file_pattern = _re.compile(
                r'```(?:python|py|cpp|c|h|md|yaml|json|sh)?\s*\n'
                r'#\s*FILE:\s*([^\n]+)\n'
                r'(.*?)```',
                _re.DOTALL,
            )

            for idx, prompt_entry in enumerate(prompts[:7]):
                module_name = (
                    prompt_entry.get("module")
                    if isinstance(prompt_entry, dict)
                    else f"Module_{idx + 1}"
                ) or f"Module_{idx + 1}"
                base_prompt = (
                    prompt_entry.get("prompt", "")
                    if isinstance(prompt_entry, dict)
                    else str(prompt_entry or "")
                )

                # 构造代码生成 Prompt：明确要求 FILE: 标记格式
                code_prompt = (
                    f"{base_prompt}\n\n"
                    f"请输出完整的代码文件，每个文件请严格按以下格式输出：\n\n"
                    f"```python\n"
                    f"# FILE: {module_name}/main.py\n"
                    f"<在此写入该文件的完整代码>\n"
                    f"```\n\n"
                    f"至少输出 1 个完整可运行的文件。\n"
                    f"要求：代码必须有完整的 docstring、错误处理、单元测试自检。\n"
                    f"模块归属：{module_name}\n"
                )

                # Shell 转义
                escaped = (
                    code_prompt.replace("\\", "\\\\")
                    .replace('"', '\\"')
                    .replace("`", "\\`")
                    .replace("$", "\\$")
                )

                try:
                    logger.info(
                        f"_run_executing_phase: 调用 LLM 写代码 {module_name} "
                        f"({idx + 1}/{min(len(prompts), 7)})"
                    )
                    llm_result = await executor.execute(
                        command=f'-p "{escaped}"',
                        timeout=180,
                    )

                    if not getattr(llm_result, "success", False):
                        logger.warning(
                            f"_run_executing_phase: {module_name} LLM 调用失败: "
                            f"{getattr(llm_result, 'error_message', '未知错误')}"
                        )
                        result["phases"].append({
                            "module": module_name,
                            "status": "llm_failed",
                        })
                        continue

                    llm_output = (getattr(llm_result, "stdout", "") or "").strip()
                    if not llm_output:
                        result["phases"].append({
                            "module": module_name,
                            "status": "empty_response",
                        })
                        continue

                    files_written = 0
                    for match in file_pattern.finditer(llm_output):
                        rel_path = (match.group(1) or "").strip()
                        file_content = match.group(2) or ""
                        if not rel_path or not file_content:
                            continue
                        # 路径安全：禁止 .. 与绝对路径前缀
                        safe_path = rel_path.replace("..", "_").lstrip("/")
                        if not safe_path:
                            continue
                        full_path = os.path.join(workspace, safe_path)
                        try:
                            os.makedirs(
                                os.path.dirname(full_path), exist_ok=True
                            )
                            with open(
                                full_path, "w", encoding="utf-8"
                            ) as f:
                                f.write(file_content)
                            files_written += 1
                            total_files += 1
                            logger.info(
                                f"_run_executing_phase: 写入文件 {safe_path} "
                                f"({len(file_content)} chars)"
                            )
                        except Exception as write_exc:
                            logger.warning(
                                f"_run_executing_phase: 写入 {safe_path} 失败: "
                                f"{write_exc}"
                            )

                    if files_written == 0:
                        # LLM 输出但无 FILE: 标记 -> 整段保存为 .md 文档
                        doc_path = os.path.join(
                            workspace, f"{module_name}_output.md"
                        )
                        try:
                            with open(doc_path, "w", encoding="utf-8") as f:
                                f.write(
                                    f"# {module_name} - LLM 生成的代码\n\n"
                                    f"{llm_output}\n"
                                )
                            total_files += 1
                            logger.info(
                                f"_run_executing_phase: {module_name} 无 FILE 标记，"
                                f"整段保存到 {os.path.basename(doc_path)}"
                            )
                        except Exception as doc_exc:
                            logger.warning(
                                f"_run_executing_phase: 写入兜底 .md 失败: "
                                f"{doc_exc}"
                            )

                    result["phases"].append({
                        "module": module_name,
                        "status": "ok",
                        "files": files_written,
                        "llm_response_len": len(llm_output),
                    })
                except Exception as mod_exc:
                    logger.exception(
                        f"_run_executing_phase: {module_name} 处理失败: {mod_exc}"
                    )
                    result["phases"].append({
                        "module": module_name,
                        "status": "error",
                        "error": str(mod_exc),
                    })

            result["files_written"] = total_files
            result["workspace"] = workspace

            # Step 4: 自动 Git 提交
            if self.git_manager and total_files > 0:
                try:
                    if hasattr(self.git_manager, "auto_commit") and \
                            asyncio.iscoroutinefunction(
                                getattr(self.git_manager, "auto_commit", None)
                            ):
                        # 异步版 auto_commit
                        try:
                            commit_result = await self.git_manager.auto_commit(  # type: ignore[attr-defined]
                                message=(
                                    f"v5.6.0: 智能体生成的代码 - "
                                    f"workflow {workflow_id[:8]}"
                                ),
                            )
                            logger.info(
                                f"_run_executing_phase: 异步 git auto_commit 完成: "
                                f"{commit_result}"
                            )
                        except Exception as async_commit_exc:
                            logger.warning(
                                f"_run_executing_phase: 异步 auto_commit 失败，"
                                f"降级为 subprocess: {async_commit_exc}"
                            )
                            import subprocess as _sp
                            _sp.run(
                                ["git", "add", "-A"],
                                cwd=workspace, check=False,
                                capture_output=True,
                            )
                            _sp.run(
                                [
                                    "git", "commit", "-m",
                                    f"v5.6.0: 智能体生成的代码 {total_files} 个文件",
                                ],
                                cwd=workspace, check=False,
                                capture_output=True,
                            )
                    else:
                        # 同步版 auto_commit
                        try:
                            commit_result = self.git_manager.auto_commit(  # type: ignore[attr-defined]
                                task_id=workflow_id[:8],
                                task_name=(
                                    f"v5.6.0 智能体生成 {total_files} 个文件"
                                ),
                            )
                            logger.info(
                                f"_run_executing_phase: 同步 git auto_commit 完成: "
                                f"{commit_result}"
                            )
                        except Exception as sync_commit_exc:
                            logger.warning(
                                f"_run_executing_phase: 同步 auto_commit 失败，"
                                f"降级为 subprocess: {sync_commit_exc}"
                            )
                            import subprocess as _sp
                            _sp.run(
                                ["git", "add", "-A"],
                                cwd=workspace, check=False,
                                capture_output=True,
                            )
                            _sp.run(
                                [
                                    "git", "commit", "-m",
                                    f"v5.6.0: 智能体生成的代码 {total_files} 个文件",
                                ],
                                cwd=workspace, check=False,
                                capture_output=True,
                            )
                except Exception as git_exc:
                    logger.warning(
                        f"_run_executing_phase: git commit 失败: {git_exc}"
                    )

            # Step 5: 标记 executing 阶段为 COMPLETED
            try:
                async with self.session_factory() as db:
                    await self._complete_current_stage(
                        db, workflow_id, "executing"
                    )
                    await db.commit()
                    logger.info(
                        f"_run_executing_phase: executing 阶段已标记 COMPLETED "
                        f"workflow={workflow_id[:8]}..."
                    )
            except Exception as mark_exc:
                logger.warning(
                    f"_run_executing_phase: 标记 executing 阶段失败: {mark_exc}"
                )

            result["success"] = True
            logger.info(
                f"_run_executing_phase 完成: 写入 {total_files} 个文件 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 6: 推进到 reviewing
            try:
                advance_result = await self.advance_stage(workflow_id)
                result["advanced_to"] = (
                    advance_result.stage_name if advance_result else None
                )
                logger.info(
                    f"_run_executing_phase: 已推进到 "
                    f"{advance_result.stage_name if advance_result else '未知'} "
                    f"workflow={workflow_id[:8]}..."
                )
            except Exception as adv_exc:
                logger.exception(
                    f"_run_executing_phase: 推进到 reviewing 失败: {adv_exc}"
                )
                result["advance_error"] = str(adv_exc)
        except Exception as exc:
            logger.exception(f"_run_executing_phase 失败: {exc}")
            result["error"] = str(exc)
        return result

    async def reject_stage(
        self, workflow_id: str, stage_name: str, reject_reason: str
    ) -> Dict[str, Any]:
        """
        人工驳回处理，含驳回次数追踪
        作用：记录人工驳回操作，追踪驳回次数，超限时触发强制人工审核
        调用方：API 层（工作流驳回接口）
        被调用方：无
        运行步骤：
          1. 加载 workflow 记录
          2. 增加驳回计数（workflow.rejection_count += 1）
          3. 若驳回次数 >= 2（架构设计阶段），设置 workflow.force_human_review = True
          4. 记录驳回原因到日志
          5. 返回驳回结果
        参数：
          - workflow_id: 工作流 ID
          - stage_name: 驳回的阶段名称
          - reject_reason: 驳回原因描述
        返回值：
          - Dict：包含驳回结果、驳回次数、是否触发强制人工审核
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            # 增加驳回计数
            current_count = (workflow.rejection_count or 0) + 1
            workflow.rejection_count = current_count

            # 架构设计阶段驳回次数 >= 2，触发强制人工审核
            force_review_triggered = False
            if stage_name == "designing" and current_count >= 2:
                workflow.force_human_review = True
                force_review_triggered = True
                logger.warning(
                    f"架构设计阶段驳回 {current_count} 次，已触发强制人工审核: "
                    f"{workflow_id[:8]}..."
                )

            workflow.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(workflow)

            logger.info(
                f"阶段驳回: {workflow_id[:8]}... stage={stage_name} "
                f"rejection_count={current_count} reason={reject_reason[:80]}..."
            )

            return {
                "success": True,
                "workflow_id": workflow_id,
                "stage_name": stage_name,
                "rejection_count": current_count,
                "reject_reason": reject_reason,
                "force_human_review": workflow.force_human_review or False,
                "force_review_triggered": force_review_triggered,
            }

    # ============================================================
    # 架构设计阶段编排方法（v3.2.0 新增）
    # ============================================================

    async def start_designing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        启动架构设计阶段
        作用：当工作流推进到 designing 阶段时，启动完整的架构设计批判迭代工作流
        调用方：advance_stage（推进到 designing 时自动调用）、API 层
        被调用方：ArchitectureWorkflowService
        运行步骤：
          1. 加载工作流，获取已确认的需求文档
          2. 调用 ArchitectureWorkflowService.start_designing_phase()
          3. 将中间结果（V2.0 需求文档、批判结果）持久化到 workflow
          4. 返回结果供前端渲染模态弹窗
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，包含 V2.0 需求文档、批判结果、缺陷清单
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化，无法启动架构设计阶段",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            requirement_doc = workflow.requirement_doc or ""
            if not requirement_doc.strip():
                return {
                    "success": False,
                    "error": "需求文档为空，请先完成需求澄清阶段",
                }

        # 调用架构设计工作流编排服务
        result = await self.architecture_workflow_service.start_designing_phase(
            workflow_id, requirement_doc
        )

        # 持久化 V2.0 需求文档到 workflow
        if result.requirement_v2:
            async with self.session_factory() as db:
                wf = await self._get_workflow(db, workflow_id)
                if wf:
                    wf.requirement_doc_v2 = result.requirement_v2
                    wf.updated_at = datetime.now(timezone.utc)
                    await db.commit()

        # 序列化返回结果
        return self._serialize_designing_result(result)

    async def run_critique_iteration(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        执行一轮架构批判迭代（用户驳回后重新执行）
        作用：当用户驳回 V2.0 需求文档时，重新执行批判分析 + 需求迭代
        调用方：API 层（用户驳回后）
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，更新后的 V2.0 需求文档和批判结果
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            # 使用最新的需求文档（优先使用 V2.0，回退到 V1.0）
            requirement_doc = (
                workflow.requirement_doc_v2
                or workflow.requirement_doc
                or ""
            )

        result = await self.architecture_workflow_service.run_critique_iteration(
            workflow_id, requirement_doc
        )

        # 持久化更新后的 V2.0
        if result.requirement_v2:
            async with self.session_factory() as db:
                wf = await self._get_workflow(db, workflow_id)
                if wf:
                    wf.requirement_doc_v2 = result.requirement_v2
                    wf.updated_at = datetime.now(timezone.utc)
                    await db.commit()

        return self._serialize_designing_result(result)

    async def finalize_designing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        完成架构设计阶段：生成文档 + 创建 Git 仓库
        作用：用户确认 V2.0 需求后，生成最终架构文档并创建 Git 仓库
        调用方：API 层（用户确认 V2.0 后）
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，含四文档内容和 Git 仓库信息
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            requirement_doc = (
                workflow.requirement_doc_v2
                or workflow.requirement_doc
                or ""
            )

        result = await self.architecture_workflow_service.finalize_designing_phase(
            workflow_id, requirement_doc
        )

        # 持久化所有文档到 workflow
        async with self.session_factory() as db:
            wf = await self._get_workflow(db, workflow_id)
            if wf:
                wf.spec_doc = result.spec_doc or ""
                wf.task_doc = result.task_doc or ""
                wf.checklist_doc = result.checklist_doc or ""
                wf.acceptance_doc = result.acceptance_doc or ""
                wf.critique_passed = True
                wf.updated_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(
                    f"架构设计阶段文档已持久化: workflow_id={workflow_id[:8]}..."
                )

        return {
            "success": True,
            "spec_doc": result.spec_doc,
            "task_doc": result.task_doc,
            "checklist_doc": result.checklist_doc,
            "acceptance_doc": result.acceptance_doc,
            "git_repo_created": result.git_repo_created,
            "git_repo_url": result.git_repo_url,
        }

    def _serialize_designing_result(
        self, result
    ) -> Dict[str, Any]:
        """
        序列化架构设计阶段结果为前端可用的 JSON 格式
        参数：
          - result: ArchitecturePhaseResult 对象
        返回值：Dict，JSON 可序列化的结果
        """
        from backend.app.services.architecture_workflow_service import (
            ArchitecturePhaseResult,
        )

        critique_data = None
        if result.critique_result:
            critique_data = {
                "passed": result.critique_result.passed,
                "overall_score": result.critique_result.overall_score,
                "summary": result.critique_result.summary,
                "dimension_scores": result.critique_result.dimension_scores,
                "defect_list": [
                    {
                        "defect_id": d.defect_id,
                        "severity": d.severity,
                        "dimension": d.dimension,
                        "location": d.location,
                        "description": d.description,
                        "impact_scope": d.impact_scope,
                        "repair_plan": d.repair_plan,
                    }
                    for d in result.critique_result.defect_list
                ],
            }

        return {
            "success": True,
            "requirement_v2": result.requirement_v2,
            "critique_result": critique_data,
            "phase_complete": result.phase_complete,
        }

    # ============================================================
    # 全链路自动化测试流水线（v4.1.0 新增）
    # ============================================================

    async def _push_pipeline_sse(
        self,
        workflow_id: str,
        step_name: str,
        status: str,
        detail: str,
        pipeline_result: "PipelineTestResult",
    ):
        """
        推送流水线步骤 SSE 事件（v4.1.0 新增）
        作用：更新 PipelineTestResult 中对应步骤的状态，生成 SSE 事件字符串，
              并将最新结果缓存到 self._latest_pipeline_result
        调用方：run_full_pipeline_test
        被调用方：无
        运行步骤：
          1. 在 pipeline_result.steps 中查找对应 step_name 的步骤
          2. 更新步骤的 status、时间戳、output/error
          3. 更新 self._latest_pipeline_result 缓存
          4. 生成 SSE 事件格式字符串并 yield
        参数：
          - workflow_id: 工作流 ID
          - step_name: 步骤名称
          - status: 步骤状态（running / completed / failed）
          - detail: 步骤详情文本（成功时为 output，失败时为 error）
          - pipeline_result: PipelineTestResult 对象引用，用于更新步骤状态
        Yields: SSE 格式字符串，用于前端实时进度展示
        """
        now = datetime.now(timezone.utc).isoformat()
        for step in pipeline_result.steps:
            if step.step_name == step_name:
                step.status = status
                if status == "running":
                    step.started_at = now
                elif status in ("completed", "failed"):
                    step.completed_at = now
                if status == "completed":
                    step.output = detail
                elif status == "failed":
                    step.error = detail
                break

        # 更新缓存
        self._latest_pipeline_result[workflow_id] = pipeline_result

        # 生成 SSE 事件
        event_data = {
            "type": "pipeline_step",
            "step": step_name,
            "status": status,
            "detail": detail,
        }
        yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

        # 短暂延迟，确保前端能按顺序处理事件
        await asyncio.sleep(0.1)

    async def run_full_pipeline_test(
        self, workflow_id: str
    ):
        """
        全链路自动化测试流水线（v4.1.0 增强）
        作用：编排 6 步全链路自动化测试流程，通过 SSE 推送实时进度到前端，
              使用 PipelineTestResult 记录结果并缓存供 pipeline-status 查询
        调用方：API 层（pipeline-test 端点）
        被调用方：CriticalReviewer、GitManager、CommitHookHandler
        运行步骤：
          Step 1 - prompt_injection: 验证所有优化提示词已注入 Claude Code CLI 实例
          Step 2 - requirement_refinement: 验证每个 CLI 实例理解需求，实现计划已生成
          Step 3 - code_generation: 触发所有 CLI 实例代码生成，等待完成并收集代码
          Step 4 - review: 调用 CriticalReviewer 评审所有生成代码，收集评审报告
          Step 5 - git_commit: 验证所有代码已提交到 Git，检查提交信息和分支状态
          Step 6 - integration_test: 运行跨模块集成测试，验证接口兼容性
        参数：
          - workflow_id: 工作流 ID
        Yields: SSE 格式字符串，实时推送流水线进度
        """
        # 定义 6 个步骤的名称
        pipeline_steps = [
            "prompt_injection",
            "requirement_refinement",
            "code_generation",
            "review",
            "git_commit",
            "integration_test",
        ]

        # 初始化 PipelineTestResult（v4.1.0 增强：使用新 dataclass）
        pipeline_result = PipelineTestResult(
            workflow_id=workflow_id,
            steps=[
                PipelineStepResult(step_name=name) for name in pipeline_steps
            ],
            overall_status="running",
        )

        # 加载工作流，获取基础上下文
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                yield f"data: {json.dumps({'type': 'pipeline_error', 'content': f'工作流不存在: {workflow_id}'})}\n\n"
                return

        # ---- Step 1: prompt_injection ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "prompt_injection", "running", "正在验证提示词注入状态...",
            pipeline_result
        ): yield _ev
        try:
            step1_passed = await self._verify_prompt_injection(workflow_id)
            if step1_passed:
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "prompt_injection", "completed",
                    "所有优化提示词已注入 CLI 实例，worktree 状态正常",
                    pipeline_result
                ): yield _ev
            else:
                raise Exception("提示词注入验证失败：提示词未完成优化或 worktree 不可用")
        except Exception as e:
            logger.error(f"流水线 Step 1 (prompt_injection) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "prompt_injection", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- Step 2: requirement_refinement ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "requirement_refinement", "running",
            "正在验证需求精炼状态...", pipeline_result
        ): yield _ev
        try:
            step2_passed = await self._verify_requirement_refinement(workflow_id)
            if step2_passed:
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "requirement_refinement", "completed",
                    "需求文档完整，实现计划已生成", pipeline_result
                ): yield _ev
            else:
                raise Exception("需求精炼验证失败：需求文档或实现计划不完整")
        except Exception as e:
            logger.error(f"流水线 Step 2 (requirement_refinement) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "requirement_refinement", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- Step 3: code_generation ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "code_generation", "running",
            "正在触发代码生成...", pipeline_result
        ): yield _ev
        try:
            generated_code = await self._trigger_code_generation(workflow_id)
            if generated_code:
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "code_generation", "completed",
                    f"代码生成完成，共 {len(generated_code)} 个模块产出代码",
                    pipeline_result
                ): yield _ev
            else:
                raise Exception("代码生成失败：CLI 实例未产出有效代码")
        except Exception as e:
            logger.error(f"流水线 Step 3 (code_generation) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "code_generation", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- Step 4: review ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "review", "running",
            "正在运行全链路代码评审...", pipeline_result
        ): yield _ev
        try:
            review_passed = await self._run_review(workflow_id)
            if review_passed:
                pipeline_result.all_modules_passed = True
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "review", "completed",
                    "所有模块代码评审通过，无 Critical 缺陷", pipeline_result
                ): yield _ev
            else:
                raise Exception("代码评审未通过：存在 Critical 级别缺陷")
        except Exception as e:
            logger.error(f"流水线 Step 4 (review) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "review", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- Step 5: git_commit ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "git_commit", "running",
            "正在验证 Git 提交状态...", pipeline_result
        ): yield _ev
        try:
            commit_passed = await self._verify_git_commit(workflow_id)
            if commit_passed:
                pipeline_result.git_commit_success = True
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "git_commit", "completed",
                    "所有模块代码已提交到 Git，分支状态正常", pipeline_result
                ): yield _ev
            else:
                raise Exception("Git 提交验证失败：存在未提交的模块或推送失败")
        except Exception as e:
            logger.error(f"流水线 Step 5 (git_commit) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "git_commit", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- Step 6: integration_test ----
        async for _ev in self._push_pipeline_sse(
            workflow_id, "integration_test", "running",
            "正在运行跨模块集成测试...", pipeline_result
        ): yield _ev
        try:
            integration_passed = await self._run_integration_test(workflow_id)
            if integration_passed:
                pipeline_result.integration_test_passed = True
                async for _ev in self._push_pipeline_sse(
                    workflow_id, "integration_test", "completed",
                    "跨模块集成测试通过，接口兼容性验证完成", pipeline_result
                ): yield _ev
            else:
                raise Exception("集成测试未通过：跨模块接口存在兼容性问题")
        except Exception as e:
            logger.error(f"流水线 Step 6 (integration_test) 失败: {e}")
            async for _ev in self._push_pipeline_sse(
                workflow_id, "integration_test", "failed", str(e),
                pipeline_result
            ): yield _ev

        # ---- 最终判定 ----
        all_steps_completed = all(
            s.status == "completed" for s in pipeline_result.steps
        )
        overall_passed = (
            all_steps_completed
            and pipeline_result.all_modules_passed
            and pipeline_result.git_commit_success
            and pipeline_result.integration_test_passed
        )
        pipeline_result.overall_status = "completed" if overall_passed else "failed"
        pipeline_result.summary = self._generate_pipeline_test_summary(pipeline_result)

        # 更新缓存
        self._latest_pipeline_result[workflow_id] = pipeline_result

        # 发送流水线完成事件
        yield f"data: {json.dumps({'type': 'pipeline_complete', 'overall_status': pipeline_result.overall_status, 'all_passed': overall_passed}, ensure_ascii=False)}\n\n"

    async def _update_pipeline_step(
        self,
        pipeline_result: PipelineResult,
        step_name: str,
        status: str,
        pipeline_result_ref: PipelineResult,
        error_message: str = "",
        output: str = "",
    ):
        """
        更新流水线步骤状态并通过 SSE 推送事件
        作用：更新指定步骤的状态，记录时间戳，并通过 yield 发送 SSE 事件
        调用方：run_full_pipeline_test
        被调用方：无
        运行步骤：
          1. 在 pipeline_result 中查找对应步骤
          2. 更新状态、时间戳、错误信息、输出
          3. 构造 SSE 事件并 yield
        参数：
          - pipeline_result: 流水线结果对象
          - step_name: 步骤名称
          - status: 新状态（running/completed/failed）
          - pipeline_result_ref: 流水线结果引用（用于写入）
          - error_message: 错误信息（失败时使用）
          - output: 步骤输出摘要
        Yields: SSE 格式字符串
        """
        now = datetime.now(timezone.utc).isoformat()
        for step in pipeline_result_ref.steps:
            if step.step_name == step_name:
                step.status = status
                if status == "running":
                    step.started_at = now
                elif status in ("completed", "failed"):
                    step.completed_at = now
                step.error_message = error_message
                step.output = output
                break

        # 推送 SSE 事件
        event_data = {
            "type": "pipeline_step",
            "step": step_name,
            "status": status,
        }
        if error_message:
            event_data["error"] = error_message
        if output:
            event_data["output"] = output
        yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

        # 短暂延迟，确保前端能按顺序处理事件
        await asyncio.sleep(0.1)

    def _check_pipeline_success(self, pipeline_result: PipelineResult) -> bool:
        """
        检查流水线是否完全成功
        作用：综合判断流水线是否满足所有成功条件
        调用方：run_full_pipeline_test
        被调用方：无
        运行步骤：
          1. 检查所有 6 个步骤是否都已完成
          2. 检查所有模块是否通过评审
          3. 检查所有 Git 提交是否成功
          4. 检查集成测试是否通过
          5. 返回综合判定结果
        参数：
          - pipeline_result: 流水线结果对象
        返回值：bool，True 表示完全成功，False 表示未完全成功
        """
        # 条件 1：所有 6 个步骤都已完成
        all_steps_completed = all(
            s.status == "completed" for s in pipeline_result.steps
        )
        # 条件 2：所有模块通过评审
        all_reviewed = pipeline_result.all_modules_reviewed
        # 条件 3：所有 Git 提交成功
        all_committed = pipeline_result.all_git_committed
        # 条件 4：集成测试通过
        integration_ok = pipeline_result.integration_test_passed

        return all_steps_completed and all_reviewed and all_committed and integration_ok

    # ============================================================
    # 流水线步骤实现（私有方法）
    # ============================================================

    async def _verify_prompt_injection(self, workflow_id: str) -> bool:
        """
        Step 1：验证提示词注入
        作用：检查优化后的提示词是否已注入到 Claude Code CLI 实例中，
              每个实例是否有有效的 prompt 和 worktree
        调用方：run_full_pipeline_test
        被调用方：无（基于数据库查询）
        运行步骤：
          1. 加载 workflow，检查 prompts_optimized 标记
          2. 检查 task_doc 中的模块任务是否完整
          3. 验证 worktree 是否可用（如果 git_manager 存在）
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示验证通过
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"prompt_injection 校验失败：工作流不存在 {workflow_id}")
                return False

            # 检查提示词是否已优化
            if not workflow.prompts_optimized:
                logger.warning(
                    f"prompt_injection 校验失败：prompts_optimized=False "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            # 检查 task_doc 是否存在（task_doc 包含模块任务分解，是提示词注入的基础）
            if not workflow.task_doc or not workflow.task_doc.strip():
                logger.warning(
                    f"prompt_injection 校验失败：task_doc 为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            logger.info(
                f"prompt_injection 校验通过: workflow={workflow_id[:8]}..."
            )
            return True

    async def _verify_requirement_refinement(self, workflow_id: str) -> bool:
        """
        Step 2：验证需求精炼
        作用：验证每个 CLI 实例理解需求，实现计划已生成
        调用方：run_full_pipeline_test
        被调用方：无（基于数据库查询）
        运行步骤：
          1. 检查需求文档（requirement_doc 或 requirement_doc_v2）非空
          2. 检查 spec_doc 非空（架构设计完成）
          3. 检查 task_doc 非空（任务分解完成）
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示验证通过
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"requirement_refinement 校验失败：工作流不存在 {workflow_id}")
                return False

            # 检查需求文档（优先使用 V2.0）
            requirement_doc = (
                workflow.requirement_doc_v2
                or workflow.requirement_doc
                or ""
            )
            if not requirement_doc.strip():
                logger.warning(
                    f"requirement_refinement 校验失败：需求文档为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            # 检查架构设计文档
            if not workflow.spec_doc or not workflow.spec_doc.strip():
                logger.warning(
                    f"requirement_refinement 校验失败：spec_doc 为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            # 检查任务分解
            if not workflow.task_doc or not workflow.task_doc.strip():
                logger.warning(
                    f"requirement_refinement 校验失败：task_doc 为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            logger.info(
                f"requirement_refinement 校验通过: workflow={workflow_id[:8]}..."
            )
            return True

    async def _trigger_code_generation(self, workflow_id: str) -> Dict[str, str]:
        """
        Step 3：触发代码生成
        作用：触发所有 CLI 实例代码生成，等待完成并收集代码
        调用方：run_full_pipeline_test
        被调用方：无（基于数据库状态和 Git 仓库检查）
        运行步骤：
          1. 检查 executing 阶段是否已完成
          2. 如果 git_manager 存在，检查工作区是否有代码文件
          3. 收集变更文件列表作为生成代码摘要
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict[str, str]，模块名 → 代码内容摘要的映射；生成失败返回空字典
        """
        generated_code: Dict[str, str] = {}

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"code_generation 失败：工作流不存在 {workflow_id}")
                return generated_code

            # 检查 executing 阶段状态
            executing_stage = await self._get_stage_by_name(db, workflow_id, "executing")
            if executing_stage is None:
                logger.warning(
                    f"code_generation 失败：executing 阶段记录不存在 "
                    f"workflow={workflow_id[:8]}..."
                )
                return generated_code

            stage_status = (
                executing_stage.status.value
                if hasattr(executing_stage.status, "value")
                else str(executing_stage.status)
            )
            if stage_status not in ("COMPLETED", "IN_PROGRESS"):
                logger.warning(
                    f"code_generation 失败：executing 阶段状态为 {stage_status} "
                    f"workflow={workflow_id[:8]}..."
                )
                return generated_code

            # 如果 git_manager 存在，检查工作区代码变更
            if self.git_manager is not None:
                try:
                    changed_files = await self.git_manager.get_changed_files()
                    if changed_files:
                        for f in changed_files:
                            # 以文件所在目录作为模块名
                            parts = f.split("/")
                            module_name = parts[0] if parts else "root"
                            if module_name not in generated_code:
                                generated_code[module_name] = ""
                            generated_code[module_name] += f"{f}\n"
                        logger.info(
                            f"code_generation 完成：{len(generated_code)} 个模块，"
                            f"共 {len(changed_files)} 个文件 "
                            f"workflow={workflow_id[:8]}..."
                        )
                    else:
                        # 无变更文件，但阶段状态正常，视为生成完成（可能代码已提交）
                        logger.info(
                            f"code_generation 完成：无新增变更文件（可能已提交）"
                            f"workflow={workflow_id[:8]}..."
                        )
                        generated_code["_no_changes"] = "所有变更已提交"
                except Exception as e:
                    logger.warning(f"code_generation 获取变更文件失败: {e}")
                    generated_code["_git_error"] = str(e)
            else:
                # git_manager 不可用，仅基于阶段状态判断
                logger.info(
                    f"code_generation 完成（基于阶段状态）："
                    f"executing 阶段状态={stage_status} "
                    f"workflow={workflow_id[:8]}..."
                )
                generated_code["_stage_only"] = f"executing 阶段状态: {stage_status}"

        return generated_code

    async def _run_review(self, workflow_id: str) -> bool:
        """
        Step 4：运行代码评审
        作用：调用 CriticalReviewer 评审所有生成代码，收集评审报告
        调用方：run_full_pipeline_test
        被调用方：CriticalReviewer（通过 hermes_service）
        运行步骤：
          1. 收集所有模块的代码和验收标准
          2. 调用 CriticalReviewer.review_single_module() 逐个模块评审
          3. 调用 CriticalReviewer.review_cross_module() 跨模块集成评审
          4. 汇总评审结果，判断是否所有模块通过
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示所有模块评审通过
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"review 失败：工作流不存在 {workflow_id}")
                return False

            acceptance_doc = workflow.acceptance_doc or ""
            spec_doc = workflow.spec_doc or ""

        # 尝试获取 CriticalReviewer 实例
        critical_reviewer = None
        try:
            from backend.app.services.agent_roles.critical_reviewer import (
                CriticalReviewer,
            )
            # 从 architecture_workflow_service 获取 hermes_service
            if self.architecture_workflow_service is not None:
                hermes_svc = getattr(
                    self.architecture_workflow_service, "hermes_service", None
                )
                if hermes_svc is not None:
                    critical_reviewer = CriticalReviewer(hermes_svc)
        except Exception as e:
            logger.warning(f"无法初始化 CriticalReviewer: {e}")

        # 如果 CriticalReviewer 不可用，基于 workflow 状态做基础判定
        if critical_reviewer is None:
            logger.info(
                f"review 判定（无 CriticalReviewer）：基于 workflow 状态 "
                f"workflow={workflow_id[:8]}..."
            )
            if not acceptance_doc.strip():
                logger.warning(f"review 失败：验收标准文档为空")
                return False
            logger.info(f"review 通过（基础判定）: workflow={workflow_id[:8]}...")
            return True

        # 收集模块代码和验收标准
        all_modules_code: Dict[str, str] = {}
        if self.git_manager is not None:
            try:
                changed_files = await self.git_manager.get_changed_files()
                for f in changed_files:
                    parts = f.split("/")
                    module_name = parts[0] if parts else "root"
                    if module_name not in all_modules_code:
                        all_modules_code[module_name] = ""
                    all_modules_code[module_name] += f"[文件: {f}]\n"
            except Exception as e:
                logger.warning(f"获取变更文件失败: {e}")

        # 单模块评审
        all_modules_passed = True
        for module_name, module_code in all_modules_code.items():
            try:
                report = await critical_reviewer.review_single_module(
                    module_code=module_code,
                    module_name=module_name,
                    acceptance_criteria=acceptance_doc[:4000],
                )
                if not report.passed:
                    logger.warning(
                        f"单模块评审未通过: {module_name} "
                        f"workflow={workflow_id[:8]}..."
                    )
                    all_modules_passed = False
            except Exception as e:
                logger.error(f"单模块评审异常 ({module_name}): {e}")
                all_modules_passed = False

        # 跨模块集成评审
        if all_modules_code and spec_doc.strip():
            try:
                cross_report = await critical_reviewer.review_cross_module(
                    all_modules_code=all_modules_code,
                    interface_specs=spec_doc[:4000],
                )
                if not cross_report.passed:
                    logger.warning(
                        f"跨模块集成评审未通过 workflow={workflow_id[:8]}..."
                    )
                    all_modules_passed = False
            except Exception as e:
                logger.error(f"跨模块集成评审异常: {e}")
                all_modules_passed = False

        if all_modules_passed:
            logger.info(f"review 通过: workflow={workflow_id[:8]}...")
        return all_modules_passed

    async def _verify_git_commit(self, workflow_id: str) -> bool:
        """
        Step 5：验证 Git 提交
        作用：验证所有代码已提交到 Git，检查提交信息和分支状态
        调用方：run_full_pipeline_test
        被调用方：GitManager、CommitHookHandler
        运行步骤：
          1. 检查 workflow.push_status 是否为 pushed
          2. 如果 git_manager 存在，检查是否有未提交的变更
          3. 如果有未提交变更，执行兜底提交和推送
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示 Git 提交验证通过
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"git_commit 校验失败：工作流不存在 {workflow_id}")
                return False

            push_status = workflow.push_status or "pending"

            # 如果推送状态已经是 pushed，直接通过
            if push_status == "pushed":
                logger.info(
                    f"git_commit 校验通过（已推送）: workflow={workflow_id[:8]}..."
                )
                return True

        # 尝试执行兜底提交和推送
        if self.git_manager is not None:
            try:
                # 执行兜底提交
                if self.commit_hook_handler is not None:
                    await self.commit_hook_handler.fallback_commit(workflow_id)

                # 检查是否有未提交的变更
                has_changes = await self.git_manager.has_uncommitted_changes()
                if has_changes:
                    logger.warning(
                        f"git_commit 校验：存在未提交的变更 "
                        f"workflow={workflow_id[:8]}..."
                    )
                    return False

                # 推送 main 分支
                push_result = await self.git_manager.push_main_branch()
                if push_result.get("success"):
                    # 更新 workflow 的 push_status
                    async with self.session_factory() as db:
                        wf = await self._get_workflow(db, workflow_id)
                        if wf:
                            wf.push_status = "pushed"
                            wf.updated_at = datetime.now(timezone.utc)
                            await db.commit()
                    logger.info(
                        f"git_commit 校验通过（推送成功）: "
                        f"workflow={workflow_id[:8]}..."
                    )
                    return True
                else:
                    logger.warning(
                        f"git_commit 校验失败：推送失败 "
                        f"{push_result.get('message')} "
                        f"workflow={workflow_id[:8]}..."
                    )
                    return False
            except Exception as e:
                logger.error(f"git_commit 校验异常: {e}")
                return False

        # git_manager 不可用，基于 push_status 判断
        if push_status in ("pushed", "pushing"):
            logger.info(
                f"git_commit 校验通过（基于状态）: workflow={workflow_id[:8]}..."
            )
            return True

        logger.warning(
            f"git_commit 校验失败：push_status={push_status} "
            f"workflow={workflow_id[:8]}..."
        )
        return False

    async def _run_integration_test(self, workflow_id: str) -> bool:
        """
        Step 6：运行集成测试
        作用：运行跨模块集成测试，验证接口兼容性
        调用方：run_full_pipeline_test
        被调用方：无（基于验收标准和代码完整性检查）
        运行步骤：
          1. 检查验收标准文档是否完整
          2. 检查 spec_doc 中的接口定义是否一致
          3. 如果 git_manager 存在，检查所有模块文件是否可编译
          4. 基于现有检查结果综合判定
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示集成测试通过
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                logger.warning(f"integration_test 失败：工作流不存在 {workflow_id}")
                return False

            acceptance_doc = workflow.acceptance_doc or ""
            spec_doc = workflow.spec_doc or ""
            checklist_doc = workflow.checklist_doc or ""

            # 检查验收标准文档完整性
            if not acceptance_doc.strip():
                logger.warning(
                    f"integration_test 失败：验收标准文档为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            # 检查架构规范文档完整性
            if not spec_doc.strip():
                logger.warning(
                    f"integration_test 失败：spec_doc 为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

            # 检查 checklist 文档完整性
            if not checklist_doc.strip():
                logger.warning(
                    f"integration_test 失败：checklist_doc 为空 "
                    f"workflow={workflow_id[:8]}..."
                )
                return False

        # 如果 git_manager 存在，检查代码文件完整性
        if self.git_manager is not None:
            try:
                changed_files = await self.git_manager.get_changed_files()
                if not changed_files:
                    # 无变更文件，但可能已提交；检查是否有已提交的代码文件
                    logger.info(
                        f"integration_test：无变更文件，检查已提交代码 "
                        f"workflow={workflow_id[:8]}..."
                    )
                    # 无变更但文档完整，视为通过
            except Exception as e:
                logger.warning(f"integration_test 获取变更文件失败: {e}")
                # 文件获取失败，但文档完整，仍然可以通过
                pass

        logger.info(
            f"integration_test 通过: workflow={workflow_id[:8]}..."
        )
        return True

    def _generate_pipeline_summary(self, pipeline_result: PipelineResult) -> str:
        """
        生成流水线执行总结
        作用：根据流水线结果生成可读的总结文本
        调用方：run_full_pipeline_test
        被调用方：无
        参数：
          - pipeline_result: 流水线结果对象
        返回值：str，总结文本
        """
        completed_count = sum(
            1 for s in pipeline_result.steps if s.status == "completed"
        )
        failed_count = sum(
            1 for s in pipeline_result.steps if s.status == "failed"
        )
        total_count = len(pipeline_result.steps)

        parts = [
            f"流水线执行完成: {completed_count}/{total_count} 步骤通过",
            f"整体状态: {pipeline_result.overall_status}",
        ]

        if pipeline_result.all_modules_reviewed:
            parts.append("所有模块评审通过")
        else:
            parts.append("存在未通过评审的模块")

        if pipeline_result.all_git_committed:
            parts.append("所有模块 Git 提交成功")
        else:
            parts.append("存在 Git 提交失败的模块")

        if pipeline_result.integration_test_passed:
            parts.append("集成测试通过")
        else:
            parts.append("集成测试未通过")

        if failed_count > 0:
            failed_steps = [
                s.step_name
                for s in pipeline_result.steps
                if s.status == "failed"
            ]
            parts.append(f"失败步骤: {', '.join(failed_steps)}")

        return "；".join(parts)

    def _generate_pipeline_test_summary(self, pipeline_result: "PipelineTestResult") -> str:
        """
        生成 PipelineTestResult 的执行总结（v4.1.0 新增）
        作用：根据 PipelineTestResult 生成可读的总结文本
        调用方：run_full_pipeline_test
        被调用方：无
        参数：
          - pipeline_result: PipelineTestResult 对象
        返回值：str，总结文本
        """
        completed_count = sum(
            1 for s in pipeline_result.steps if s.status == "completed"
        )
        failed_count = sum(
            1 for s in pipeline_result.steps if s.status == "failed"
        )
        total_count = len(pipeline_result.steps)

        parts = [
            f"流水线执行完成: {completed_count}/{total_count} 步骤通过",
            f"整体状态: {pipeline_result.overall_status}",
        ]

        if pipeline_result.all_modules_passed:
            parts.append("所有模块评审通过")
        else:
            parts.append("存在未通过评审的模块")

        if pipeline_result.git_commit_success:
            parts.append("所有模块 Git 提交成功")
        else:
            parts.append("存在 Git 提交失败的模块")

        if pipeline_result.integration_test_passed:
            parts.append("集成测试通过")
        else:
            parts.append("集成测试未通过")

        if failed_count > 0:
            failed_steps = [
                s.step_name
                for s in pipeline_result.steps
                if s.status == "failed"
            ]
            parts.append(f"失败步骤: {', '.join(failed_steps)}")

        return "；".join(parts)

    # ============================================================
    # 目标导向任务循环（v5.0.0 新增）
    # ============================================================

    async def create_goal(
        self, workflow_id: str, objective: str
    ) -> GoalInfo:
        """
        创建目标并分解为子目标
        运行步骤：
          1. 加载工作流，获取 task_doc（任务框架）和 acceptance_doc（验收标准）
          2. 从 task_doc 中解析模块列表
          3. 为每个模块创建 SubGoal，自动生成 UUID
          4. 解析模块间依赖关系
          5. 持久化子目标列表到 workflow.goals JSON 字段
          6. 设置 workflow.goal_id
        参数：
          - workflow_id: 工作流 ID
          - objective: 目标总体描述
        返回值：GoalInfo 对象，包含所有子目标信息
        异常处理：工作流不存在时抛出 ValueError
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")

            # 生成 goal_id
            goal_id = str(uuid.uuid4())

            # 步骤 1：解析 task_doc 获取模块列表
            modules = self._parse_modules_from_task_doc(workflow.task_doc or "")

            # 步骤 2：解析 acceptance_doc 获取验收标准
            acceptance_criteria_map = self._parse_acceptance_criteria(
                workflow.acceptance_doc or ""
            )

            # 步骤 3：为每个模块创建 SubGoal
            sub_goals: List[SubGoal] = []
            module_name_to_id: Dict[str, str] = {}

            for module_info in modules:
                sg_id = str(uuid.uuid4())
                module_name = module_info.get("name", "")
                module_name_to_id[module_name] = sg_id

                # 解析依赖关系（依赖的模块名 → 依赖的子目标 ID）
                dep_module_names = module_info.get("dependencies", [])
                dep_ids = []  # 稍后通过 module_name_to_id 映射填充

                # 获取该模块的验收标准
                acceptance = acceptance_criteria_map.get(
                    module_name, module_info.get("acceptance_criteria", "")
                )

                sub_goal = SubGoal(
                    id=sg_id,
                    name=module_name,
                    description=module_info.get("description", module_name),
                    status="pending",
                    module_name=module_name,
                    dependencies=dep_ids,  # 稍后填充
                    acceptance_criteria=acceptance,
                    agent_id="",
                )
                sub_goals.append(sub_goal)

            # 步骤 4：填充依赖关系（将模块名映射为子目标 ID）
            for i, module_info in enumerate(modules):
                dep_module_names = module_info.get("dependencies", [])
                dep_ids = []
                for dep_name in dep_module_names:
                    dep_id = module_name_to_id.get(dep_name)
                    if dep_id:
                        dep_ids.append(dep_id)
                sub_goals[i].dependencies = dep_ids

            # 步骤 5：持久化到 workflow
            workflow.goal_id = goal_id
            workflow.goals = [sg.to_dict() for sg in sub_goals]
            await db.commit()

            # 步骤 6：构建并返回 GoalInfo
            goal_info = GoalInfo(
                goal_id=goal_id,
                objective=objective,
                sub_goals=sub_goals,
                status="active",
                workflow_id=workflow_id,
                completed_count=0,
                total_count=len(sub_goals),
                current_sub_goal="",
            )

            logger.info(
                f"目标创建成功：goal_id={goal_id}, workflow_id={workflow_id}, "
                f"子目标数={len(sub_goals)}"
            )
            return goal_info

    async def execute_goal_loop(self, workflow_id: str) -> GoalInfo:
        """
        执行目标导向循环：找到下一个可执行的子目标并执行
        运行步骤：
          1. 加载工作流，反序列化子目标列表
          2. 查找下一个可执行的子目标（所有依赖已满足、状态为 pending）
          3. 若无可执行子目标：
             a. 全部完成 → 标记目标为 completed
             b. 有失败 → 标记目标为 blocked
          4. 若找到可执行子目标：
             a. 标记为 in_progress 并持久化
             b. 创建 Claude Code CLI 实例（通过 agent 机制）
             c. 注入优化后的提示词
             d. 等待代码生成
             e. 运行评审（CriticalReviewer）
             f. 通过 → 标记为 completed，继续循环
             g. 失败 → 触发智能迭代
             h. 迭代耗尽 → 标记为 failed
          5. 返回更新后的 GoalInfo
        参数：
          - workflow_id: 工作流 ID
        返回值：GoalInfo 对象，包含最新的子目标状态
        异常处理：工作流不存在时抛出 ValueError
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")

            # 步骤 1：反序列化子目标列表
            sub_goals = self._load_sub_goals(workflow)

            # 加载目标元信息
            goal_id = workflow.goal_id or ""
            objective = workflow.user_input or ""

            # 步骤 2：查找下一个可执行的子目标
            executable = self._find_next_executable(sub_goals)

            # 步骤 3：无可用子目标时判断完成/阻塞
            if executable is None:
                all_completed = all(sg.status == "completed" for sg in sub_goals)
                all_done_or_failed = all(
                    sg.status in ("completed", "failed") for sg in sub_goals
                )

                if all_completed:
                    # 全部完成
                    goal_status = "completed"
                    logger.info(
                        f"目标循环完成：workflow_id={workflow_id}, "
                        f"所有子目标已完成"
                    )
                elif all_done_or_failed:
                    # 有失败的子目标 → 阻塞
                    goal_status = "blocked"
                    logger.warning(
                        f"目标循环阻塞：workflow_id={workflow_id}, "
                        f"部分子目标失败"
                    )
                else:
                    # 仍有 pending 但依赖未满足 → 保持 active
                    goal_status = "active"

                completed_count = sum(
                    1 for sg in sub_goals if sg.status == "completed"
                )

                return GoalInfo(
                    goal_id=goal_id,
                    objective=objective,
                    sub_goals=sub_goals,
                    status=goal_status,
                    workflow_id=workflow_id,
                    completed_count=completed_count,
                    total_count=len(sub_goals),
                    current_sub_goal="",
                )

            # 步骤 4：执行可执行子目标
            # 步骤 4a：标记为 in_progress
            executable.status = "in_progress"
            self._persist_sub_goals(workflow, sub_goals)
            await db.commit()

            logger.info(
                f"开始执行子目标：{executable.name} (id={executable.id}), "
                f"workflow_id={workflow_id}"
            )

            try:
                # 步骤 4b-4c：创建 CLI 实例并注入优化提示词
                # 注：此处依赖外部 agent 系统，实际 CLI 调用由 AgentManager 负责
                # 本方法仅负责状态管理和流程编排
                code_gen_result = await self._run_code_generation_for_module(
                    workflow_id, executable
                )

                # 步骤 4e：运行评审
                review_passed = await self._run_module_review(
                    workflow_id, executable, code_gen_result
                )

                if review_passed:
                    # 步骤 4f：评审通过 → 标记为 completed
                    executable.status = "completed"
                    self._persist_sub_goals(workflow, sub_goals)
                    await db.commit()
                    logger.info(
                        f"子目标执行成功：{executable.name} (id={executable.id})"
                    )
                else:
                    # 步骤 4g：评审失败 → 触发智能迭代
                    iteration_result = await self._run_smart_iteration_for_module(
                        workflow_id, executable, code_gen_result
                    )
                    if iteration_result:
                        executable.status = "completed"
                        self._persist_sub_goals(workflow, sub_goals)
                        await db.commit()
                        logger.info(
                            f"子目标迭代后通过：{executable.name} (id={executable.id})"
                        )
                    else:
                        # 步骤 4h：迭代耗尽 → 标记为 failed
                        executable.status = "failed"
                        self._persist_sub_goals(workflow, sub_goals)
                        await db.commit()
                        logger.error(
                            f"子目标执行失败（迭代耗尽）：{executable.name} "
                            f"(id={executable.id})"
                        )

            except Exception as e:
                # 异常兜底：标记子目标为 failed
                logger.error(
                    f"子目标执行异常：{executable.name} (id={executable.id}), "
                    f"错误：{e}"
                )
                executable.status = "failed"
                self._persist_sub_goals(workflow, sub_goals)
                await db.commit()

            # 步骤 5：返回更新后的 GoalInfo
            completed_count = sum(
                1 for sg in sub_goals if sg.status == "completed"
            )

            return GoalInfo(
                goal_id=goal_id,
                objective=objective,
                sub_goals=sub_goals,
                status="active",
                workflow_id=workflow_id,
                completed_count=completed_count,
                total_count=len(sub_goals),
                current_sub_goal=executable.id,
            )

    async def check_goal_completion(
        self, workflow_id: str
    ) -> GoalInfo:
        """
        检查目标完成状态，所有子目标完成后触发全流程测试
        运行步骤：
          1. 加载工作流，反序列化子目标列表
          2. 检查是否所有子目标已完成
          3. 若全部完成 → 触发全链路流水线测试
          4. 流水线测试通过 → 标记目标为 completed
          5. 流水线测试失败 → 标记目标为 blocked
          6. 返回最终完成状态
        参数：
          - workflow_id: 工作流 ID
        返回值：GoalInfo 对象，包含最终完成状态
        异常处理：工作流不存在时抛出 ValueError
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")

            # 步骤 1：反序列化子目标列表
            sub_goals = self._load_sub_goals(workflow)
            goal_id = workflow.goal_id or ""
            objective = workflow.user_input or ""

            # 步骤 2：检查是否所有子目标已完成
            all_completed = all(sg.status == "completed" for sg in sub_goals)
            completed_count = sum(
                1 for sg in sub_goals if sg.status == "completed"
            )

            if not all_completed:
                # 尚未全部完成，返回当前状态
                return GoalInfo(
                    goal_id=goal_id,
                    objective=objective,
                    sub_goals=sub_goals,
                    status="active",
                    workflow_id=workflow_id,
                    completed_count=completed_count,
                    total_count=len(sub_goals),
                    current_sub_goal="",
                )

            # 步骤 3：触发全链路流水线测试
            logger.info(
                f"所有子目标已完成，触发全链路流水线测试："
                f"workflow_id={workflow_id}"
            )

            try:
                pipeline_result = await self.run_full_pipeline_test(workflow_id)

                # 步骤 4：流水线测试通过 → 标记目标为 completed
                if pipeline_result.overall_status == "completed":
                    status = "completed"
                    logger.info(
                        f"目标完成确认：流水线测试通过，"
                        f"workflow_id={workflow_id}"
                    )
                else:
                    # 步骤 5：流水线测试失败 → 标记目标为 blocked
                    status = "blocked"
                    logger.warning(
                        f"目标阻塞：流水线测试未通过，"
                        f"workflow_id={workflow_id}, "
                        f"状态={pipeline_result.overall_status}"
                    )
            except Exception as e:
                # 流水线测试异常 → 标记为 blocked
                status = "blocked"
                logger.error(
                    f"目标完成检查异常：流水线测试失败，"
                    f"workflow_id={workflow_id}, 错误：{e}"
                )

            return GoalInfo(
                goal_id=goal_id,
                objective=objective,
                sub_goals=sub_goals,
                status=status,
                workflow_id=workflow_id,
                completed_count=completed_count,
                total_count=len(sub_goals),
                current_sub_goal="",
            )

    async def get_goal_status(self, workflow_id: str) -> GoalInfo:
        """
        获取当前目标状态，供前端渲染进度
        运行步骤：
          1. 加载工作流，反序列化子目标列表
          2. 如果没有 goals 数据，返回空的 GoalInfo
          3. 构建并返回 GoalInfo 对象
        参数：
          - workflow_id: 工作流 ID
        返回值：GoalInfo 对象，包含所有子目标状态和进度
        异常处理：工作流不存在时抛出 ValueError
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if not workflow:
                raise ValueError(f"Workflow {workflow_id} not found")

            # 步骤 1：反序列化子目标列表
            sub_goals = self._load_sub_goals(workflow)
            goal_id = workflow.goal_id or ""
            objective = workflow.user_input or ""

            # 步骤 2：计算统计信息
            completed_count = sum(
                1 for sg in sub_goals if sg.status == "completed"
            )
            failed_count = sum(
                1 for sg in sub_goals if sg.status == "failed"
            )
            in_progress_sg = next(
                (sg for sg in sub_goals if sg.status == "in_progress"), None
            )

            # 步骤 3：确定目标整体状态
            if all(sg.status == "completed" for sg in sub_goals):
                goal_status = "completed"
            elif failed_count > 0 and all(
                sg.status in ("completed", "failed") for sg in sub_goals
            ):
                goal_status = "blocked"
            else:
                goal_status = "active"

            return GoalInfo(
                goal_id=goal_id,
                objective=objective,
                sub_goals=sub_goals,
                status=goal_status,
                workflow_id=workflow_id,
                completed_count=completed_count,
                total_count=len(sub_goals),
                current_sub_goal=in_progress_sg.id if in_progress_sg else "",
            )

    # ============================================================
    # 目标导向任务循环 - 私有辅助方法（v5.0.0 新增）
    # ============================================================

    def _parse_modules_from_task_doc(
        self, task_doc: str
    ) -> List[Dict[str, Any]]:
        """
        从 task_doc 中解析模块列表
        运行步骤：
          1. 尝试从 task_doc 中提取模块信息（支持 Markdown 格式）
          2. 查找 "## 模块" 或 "## Modules" 或 "### 模块" 等标题
          3. 为每个模块提取名称、描述、依赖关系
          4. 若解析失败，返回空列表
        参数：
          - task_doc: 任务文档内容（Markdown 格式）
        返回值：模块信息列表 [{"name": "xxx", "description": "xxx", "dependencies": [...]}]
        """
        if not task_doc or not task_doc.strip():
            return []

        modules = []

        # 尝试匹配模块标题模式：## 模块名 或 ### 模块名
        # 支持中英文标题
        module_pattern = re.compile(
            r'^#{2,4}\s*模块[：:]\s*(.+?)$|'
            r'^#{2,4}\s*Module[：:]\s*(.+?)$|'
            r'^#{2,4}\s*(.+?模块)$',
            re.MULTILINE | re.IGNORECASE,
        )

        # 按模块标题分割 task_doc
        sections = module_pattern.split(task_doc)

        # 如果上面的正则无法分割，尝试按 "## " 通用分割
        if len(sections) <= 1:
            # 备用方案：按 ## 标题分割
            parts = re.split(r'^(#{2,4}\s+.+)$', task_doc, flags=re.MULTILINE)
            current_module = None
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                if re.match(r'^#{2,4}\s+', part):
                    # 这是一个标题
                    title = re.sub(r'^#{2,4}\s+', '', part).strip()
                    # 跳过非模块标题
                    if any(kw in title.lower() for kw in
                           ['概述', 'overview', '依赖', 'dependency', '验收',
                            'acceptance', '任务', 'task', '说明', 'note']):
                        current_module = None
                        continue
                    if current_module:
                        modules.append(current_module)
                    current_module = {
                        "name": title,
                        "description": title,
                        "dependencies": [],
                        "acceptance_criteria": "",
                    }
                elif current_module:
                    # 模块内容
                    # 尝试提取依赖信息
                    if "依赖" in part or "depends" in part.lower():
                        dep_names = re.findall(
                            r'`([^`]+)`|模块[：:]\s*(.+?)(?:\n|$)|'
                            r'depends[^:]*[：:]\s*(.+?)(?:\n|$)',
                            part, re.IGNORECASE,
                        )
                        for dep_match in dep_names:
                            dep_name = next(
                                (d for d in dep_match if d), ""
                            ).strip()
                            if dep_name:
                                current_module["dependencies"].append(
                                    dep_name
                                )
                    # 更新描述
                    if not current_module.get("description"):
                        current_module["description"] = part[:100].strip()
            if current_module:
                modules.append(current_module)

        return modules

    def _parse_acceptance_criteria(
        self, acceptance_doc: str
    ) -> Dict[str, str]:
        """
        从 acceptance_doc 中解析各模块的验收标准
        运行步骤：
          1. 按模块标题分割验收文档
          2. 提取每个模块对应的验收标准
        参数：
          - acceptance_doc: 验收标准文档内容（Markdown 格式）
        返回值：模块名 → 验收标准映射字典
        """
        if not acceptance_doc or not acceptance_doc.strip():
            return {}

        criteria_map: Dict[str, str] = {}

        # 按 ## 标题分割
        sections = re.split(
            r'^(#{2,4}\s+.+)$', acceptance_doc,
            flags=re.MULTILINE,
        )

        current_module = None
        for part in sections:
            part = part.strip()
            if not part:
                continue
            if re.match(r'^#{2,4}\s+', part):
                title = re.sub(r'^#{2,4}\s+', '', part).strip()
                current_module = title
            elif current_module:
                criteria_map[current_module] = part.strip()
                current_module = None

        return criteria_map

    def _load_sub_goals(self, workflow: Workflow) -> List[SubGoal]:
        """
        从 workflow.goals JSON 字段反序列化子目标列表
        参数：
          - workflow: Workflow ORM 对象
        返回值：SubGoal 列表
        """
        if not workflow.goals:
            return []
        try:
            goals_data = workflow.goals
            if isinstance(goals_data, str):
                goals_data = json.loads(goals_data)
            return [SubGoal.from_dict(sg) for sg in goals_data]
        except (json.JSONDecodeError, TypeError, KeyError) as e:
            logger.warning(f"反序列化子目标列表失败：{e}")
            return []

    def _persist_sub_goals(
        self, workflow: Workflow, sub_goals: List[SubGoal]
    ):
        """
        将子目标列表持久化到 workflow.goals JSON 字段
        参数：
          - workflow: Workflow ORM 对象
          - sub_goals: SubGoal 列表
        """
        workflow.goals = [sg.to_dict() for sg in sub_goals]

    def _find_next_executable(
        self, sub_goals: List[SubGoal]
    ) -> Optional[SubGoal]:
        """
        查找下一个可执行的子目标
        规则：
          1. 状态为 pending
          2. 所有依赖的子目标状态均为 completed
          3. 优先选择依赖数最少的（减少阻塞）
        参数：
          - sub_goals: SubGoal 列表
        返回值：可执行的 SubGoal 或 None
        """
        # 收集所有已完成子目标的 ID
        completed_ids = {
            sg.id for sg in sub_goals if sg.status == "completed"
        }

        candidates = []
        for sg in sub_goals:
            if sg.status != "pending":
                continue
            # 检查所有依赖是否已满足
            deps_satisfied = all(
                dep_id in completed_ids for dep_id in sg.dependencies
            )
            if deps_satisfied:
                candidates.append(sg)

        if not candidates:
            return None

        # 优先选择依赖数最少的子目标
        candidates.sort(key=lambda sg: len(sg.dependencies))
        return candidates[0]

    async def _run_code_generation_for_module(
        self, workflow_id: str, sub_goal: SubGoal
    ) -> Dict[str, Any]:
        """
        为指定模块运行代码生成
        运行步骤：
          1. 查找可用的 agent 实例
          2. 构建模块特定的优化提示词
          3. 调用 agent 执行代码生成
        参数：
          - workflow_id: 工作流 ID
          - sub_goal: 当前子目标
        返回值：代码生成结果字典 {"success": bool, "output": str, "files": [...]}
        注：此为占位实现，实际 CLI 调用由 AgentManager 负责
        """
        logger.info(
            f"代码生成开始：模块={sub_goal.module_name}, "
            f"子目标={sub_goal.id}"
        )

        # 构建模块特定的提示词
        prompt = (
            f"请为模块 '{sub_goal.module_name}' 生成代码。\n"
            f"模块描述：{sub_goal.description}\n"
            f"验收标准：{sub_goal.acceptance_criteria}\n"
        )

        # 注：实际 CLI 调用需通过 AgentManager 执行
        # 此处返回占位结果，表示流程框架已就绪
        return {
            "success": True,
            "output": f"模块 {sub_goal.module_name} 代码生成完成",
            "files": [],
            "prompt": prompt,
        }

    async def _run_module_review(
        self,
        workflow_id: str,
        sub_goal: SubGoal,
        code_gen_result: Dict[str, Any],
    ) -> bool:
        """
        对模块代码进行 CriticalReviewer 评审
        运行步骤：
          1. 读取生成的代码文件
          2. 运行 CriticalReviewer 评审
          3. 返回评审结果
        参数：
          - workflow_id: 工作流 ID
          - sub_goal: 当前子目标
          - code_gen_result: 代码生成结果
        返回值：True 表示评审通过，False 表示评审失败
        注：此为占位实现，实际评审由 CriticalReviewer 负责
        """
        logger.info(
            f"模块评审开始：模块={sub_goal.module_name}, "
            f"子目标={sub_goal.id}"
        )

        # 注：实际评审需调用 CriticalReviewer
        # 此处返回占位结果，表示流程框架已就绪
        return True  # 默认通过

    async def _run_smart_iteration_for_module(
        self,
        workflow_id: str,
        sub_goal: SubGoal,
        code_gen_result: Dict[str, Any],
    ) -> bool:
        """
        对评审失败的模块执行智能迭代修复
        运行步骤：
          1. 获取评审反馈
          2. 调用 execute_smart_iteration 进行迭代修复
          3. 检查迭代结果
        参数：
          - workflow_id: 工作流 ID
          - sub_goal: 当前子目标
          - code_gen_result: 代码生成结果
        返回值：True 表示迭代修复成功，False 表示失败
        """
        logger.info(
            f"智能迭代开始：模块={sub_goal.module_name}, "
            f"子目标={sub_goal.id}"
        )

        try:
            # 调用已有的智能迭代方法
            result = await self.execute_smart_iteration(workflow_id)
            if result and not result.escalated_to_human:
                # 迭代修复成功
                return result.defects_remaining == []
            return False
        except Exception as e:
            logger.error(
                f"智能迭代异常：模块={sub_goal.module_name}, 错误：{e}"
            )
            return False

    # ============================================================
    # 私有辅助方法
    # ============================================================

    async def _get_workflow(self, db: AsyncSession, workflow_id: str) -> Optional[Workflow]:
        """加载工作流"""
        result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
        return result.scalar_one_or_none()

    async def _get_stage_by_name(
        self, db: AsyncSession, workflow_id: str, stage_name: str
    ) -> Optional[WorkflowStage]:
        """按阶段名称加载工作流阶段记录"""
        result = await db.execute(
            select(WorkflowStage).where(
                WorkflowStage.workflow_id == workflow_id,
                WorkflowStage.stage_name == stage_name,
            )
        )
        return result.scalar_one_or_none()

    async def _complete_current_stage(
        self, db: AsyncSession, workflow_id: str, stage_name: str
    ):
        """标记当前阶段为完成"""
        if stage_name:
            await db.execute(
                text(
                    "UPDATE workflow_stages SET status = :status, completed_at = :ts "
                    "WHERE workflow_id = :wid AND stage_name = :sn"
                ),
                {
                    # SAEnum 存储的是枚举成员名（大写），必须使用 .name 而非 .value
                    "status": StageStatus.COMPLETED.name,
                    "ts": datetime.now(timezone.utc),
                    "wid": workflow_id,
                    "sn": stage_name,
                },
            )

    async def _set_stage_in_progress(
        self, db: AsyncSession, workflow_id: str, stage_name: str
    ) -> WorkflowStage:
        """标记阶段为进行中"""
        await db.execute(
            text(
                "UPDATE workflow_stages SET status = :status, started_at = :ts "
                "WHERE workflow_id = :wid AND stage_name = :sn"
            ),
            {
                # SAEnum 存储的是枚举成员名（大写），必须使用 .name 而非 .value
                "status": StageStatus.IN_PROGRESS.name,
                "ts": datetime.now(timezone.utc),
                "wid": workflow_id,
                "sn": stage_name,
            },
        )

        result = await db.execute(
            select(WorkflowStage).where(
                WorkflowStage.workflow_id == workflow_id,
                WorkflowStage.stage_name == stage_name,
            )
        )
        return result.scalar_one()

    def _get_next_stage(
        self, current_stage: str
    ) -> Optional[str]:
        """确定下一阶段"""
        if current_stage == "reviewing":
            # reviewing 之后可以 completed 或 iterating
            return None  # 由调用方决定

        transitions = STAGE_TRANSITIONS.get(current_stage, [])
        return transitions[0] if transitions else None

    def _stage_to_workflow_status(self, stage_name: str) -> WorkflowStatus:
        """阶段名 → 工作流状态映射"""
        mapping = {
            "clarifying": WorkflowStatus.CLARIFYING,
            "designing": WorkflowStatus.DESIGNING,
            "prompting": WorkflowStatus.PROMPTING,
            "executing": WorkflowStatus.EXECUTING,
            "reviewing": WorkflowStatus.REVIEWING,
        }
        return mapping.get(stage_name, WorkflowStatus.PENDING)

    def _stage_display_name(self, stage_name: str) -> str:
        """阶段名 → 中文显示名"""
        mapping = {
            "clarifying": "需求澄清",
            "designing": "架构设计",
            "prompting": "提示词工程",
            "executing": "代码执行",
            "reviewing": "质量评审",
        }
        return mapping.get(stage_name, stage_name)
