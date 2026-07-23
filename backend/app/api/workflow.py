"""
# ============================================================
# 工作流 API — Loop Engineering 工作流
# ============================================================
# 核心作用：提供 Loop Engineering 工作流的启动、推进、回退、
#           状态查询等接口
# 运行流程：
#   - POST /api/workflow/start: 启动工作流
#   - GET /api/workflow/{id}/status: 获取工作流状态
#   - POST /api/workflow/{id}/advance: 推进到下一阶段
#   - POST /api/workflow/{id}/rollback: 回退到指定阶段
#   - GET /api/workflow/{id}/stages: 获取所有阶段详情
#   - POST /api/workflow/optimize: 提示词优化（保留兼容）
#   - POST /api/workflow/plan: 任务规划（保留兼容）
#   - POST /api/workflow/execute: 执行任务（保留兼容）
#   - POST /api/workflow/validate: 验证结果（保留兼容）
#   - POST /api/workflow/full: 完整工作流（保留兼容）
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本
#   - 2026-06-25 | v2.0.0 | 新增 Loop Engineering 工作流端点
#   - 2026-06-26 | v2.1.0 | 新增 commit-hook 端点，支持工作流执行阶段的
#     Git 提交与推送回调
#   - 2026-06-29 | v2.2.0 | 新增 atomic-tasks 端点，支持原子任务清单查询
#   - 2026-06-29 | v2.3.0 | 新增 GET /api/workflow/{id}/clarify/questions 端点
#             和 POST /api/workflow/{id}/clarify/confirm 端点，支持澄清问题查询与确认
#   - 2026-07-22 | v4.1.0 | 全链路自动化测试流水线端点：新增 PipelineTestRequest /
#     PipelineTestResponse / PipelineStatusResponse 模型；新增 POST pipeline-test
#     端点（SSE 流式推送）和 GET pipeline-status 端点
# ============================================================
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Task, TaskStatus, TaskPriority, ExecutionMode, Conversation
from ..services.prompt_optimizer import PromptOptimizer
from ..services.task_planner import TaskPlanner
from ..services.scheduler import TaskScheduler
from ..services.validator import TaskValidator
from ..services.task_hook_handler import TaskHookHandler
from cli_integration.strategy_router import StrategyRouter

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型（保留兼容）
# ============================================================

class OptimizeRequest(BaseModel):
    """提示词优化请求"""
    raw_prompt: str = Field(..., min_length=1, description="用户原始需求")


class OptimizeResponse(BaseModel):
    """提示词优化响应"""
    original: str
    optimized: str
    task_modules: List[str]
    constraints: List[str]
    success: bool
    error_message: str = ""


class PlanRequest(BaseModel):
    """任务规划请求"""
    original_prompt: str
    optimized_prompt: str


class SubTaskResponse(BaseModel):
    """子任务响应"""
    id: int
    title: str
    description: str
    priority: str
    dependencies: List[int]
    estimated_complexity: float


class PlanResponse(BaseModel):
    """任务规划响应"""
    sub_tasks: List[SubTaskResponse]
    total_tasks: int
    success: bool
    error_message: str = ""


class ExecuteRequest(BaseModel):
    """任务执行请求"""
    task_id: str = Field(..., description="任务 ID")


class ValidateRequest(BaseModel):
    """结果验证请求"""
    task_id: str = Field(..., description="任务 ID")


class FullWorkflowRequest(BaseModel):
    """完整工作流请求"""
    raw_prompt: str = Field(..., min_length=1, description="用户原始需求")
    agent_id: Optional[str] = Field(default=None, description="指定智能体 ID")


# ============================================================
# Loop Engineering 工作流请求/响应模型（v2.0.0 新增）
# ============================================================

class StartWorkflowRequest(BaseModel):
    """启动 Loop Engineering 工作流请求"""
    session_id: str = Field(..., description="会话 ID")
    user_input: str = Field(..., min_length=1, description="用户原始输入")


class RollbackRequest(BaseModel):
    """回退工作流请求"""
    target_stage: str = Field(..., description="目标阶段：clarifying/designing/prompting/executing/reviewing")


# ============================================================
# Commit Hook 请求/响应模型（v2.1.0 新增）
# ============================================================

class CommitHookRequest(BaseModel):
    """Commit Hook 回调请求"""
    module_name: str = Field(..., min_length=1, description="模块名称")
    checklist_item: str = Field(default="", description="Checklist 项信息")
    changed_files: List[str] = Field(..., min_length=1, description="变更文件路径列表")
    change_summary: str = Field(default="", description="变更摘要")
    commit_message_suggestion: str = Field(..., min_length=1, description="建议的提交信息")


class CommitHookResponse(BaseModel):
    """Commit Hook 回调响应"""
    success: bool
    commit_hash: str = ""
    message: str = ""


# ============================================================
# Task Hook 请求/响应模型（v2.2.0 新增）
# ============================================================

class TaskHookRequest(BaseModel):
    """Task Hook 回调请求"""
    hook_type: str = Field(..., description="Hook 类型: task_complete/git_commit/check_complete/test_complete")
    task_id: str = Field(..., min_length=1, description="任务 ID")
    module_name: str = Field(..., min_length=1, description="模块名称")
    status: str = Field(default="completed", description="任务状态")
    output: str = Field(default="", description="任务输出")
    changed_files: List[str] = Field(default_factory=list, description="变更文件路径列表")
    commit_message: str = Field(default="", description="提交信息")
    check_type: str = Field(default="", description="校验类型")
    test_type: str = Field(default="", description="测试类型")
    result: str = Field(default="", description="结果")
    issues: List[str] = Field(default_factory=list, description="问题列表")
    coverage: float = Field(default=0.0, description="测试覆盖率")


class TaskHookResponse(BaseModel):
    """Task Hook 回调响应"""
    success: bool
    hook_type: str = ""
    task_id: str = ""
    commit_hash: str = ""
    message: str = ""
    action_taken: str = ""


class WorkflowStageResponse(BaseModel):
    """工作流阶段响应"""
    key: str
    name: str
    status: str
    agent_role: Optional[str] = None
    input_doc: str = ""
    output_doc: str = ""
    conversation_summary: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class WorkflowStatusResponse(BaseModel):
    """工作流状态响应"""
    workflow_id: str
    session_id: str
    status: str
    current_stage: str
    iteration_count: int
    max_iterations: int
    progress: float
    error_message: str = ""
    stages: List[WorkflowStageResponse] = []


# ============================================================
# 全链路自动化测试流水线请求/响应模型（v4.1.0 新增）
# ============================================================

class PipelineTestRequest(BaseModel):
    """
    全链路自动化测试流水线请求模型
    字段说明：
      - modules: 可选，指定要测试的模块名称列表，为空则测试所有模块
    """
    modules: Optional[List[str]] = Field(default=None, description="指定要测试的模块列表")


class PipelineStepStatusResponse(BaseModel):
    """
    流水线步骤状态响应模型
    字段说明：
      - step_name: 步骤名称
      - status: 步骤状态（running / completed / failed）
      - started_at: 步骤开始时间
      - completed_at: 步骤完成时间
      - output: 步骤产出摘要
      - error: 步骤错误信息
    """
    step_name: str
    status: str
    started_at: str = ""
    completed_at: str = ""
    output: str = ""
    error: str = ""


class PipelineTestResponse(BaseModel):
    """
    全链路自动化测试流水线响应模型
    字段说明：
      - workflow_id: 工作流 ID
      - overall_status: 整体状态（running / completed / failed）
      - steps: 6 个步骤的状态列表
      - all_modules_passed: 是否所有模块评审通过
      - git_commit_success: 是否所有 Git 提交成功
      - integration_test_passed: 是否集成测试通过
      - summary: 执行总结
    """
    workflow_id: str
    overall_status: str
    steps: List[PipelineStepStatusResponse]
    all_modules_passed: bool = False
    git_commit_success: bool = False
    integration_test_passed: bool = False
    summary: str = ""


class PipelineStatusResponse(BaseModel):
    """
    流水线状态查询响应模型
    字段说明：
      - workflow_id: 工作流 ID
      - overall_status: 整体状态
      - steps: 6 个步骤的状态列表
      - all_modules_passed: 是否所有模块评审通过
      - git_commit_success: 是否所有 Git 提交成功
      - integration_test_passed: 是否集成测试通过
      - summary: 执行总结
      - has_result: 是否有缓存的流水线结果
    """
    workflow_id: str
    overall_status: str = "unknown"
    steps: List[PipelineStepStatusResponse] = []
    all_modules_passed: bool = False
    git_commit_success: bool = False
    integration_test_passed: bool = False
    summary: str = ""
    has_result: bool = False


# ============================================================
# Loop Engineering 工作流端点（v2.0.0 新增）
# ============================================================

@router.post("/start", response_model=dict)
async def start_workflow(request: Request, body: StartWorkflowRequest):
    """
    启动 Loop Engineering 工作流
    运行步骤：
      1. 获取 WorkflowEngine
      2. 调用 start_workflow
      3. 返回工作流 ID 和初始状态
    """
    workflow_engine = request.app.state.workflow_engine
    workflow = await workflow_engine.start_workflow(
        session_id=body.session_id,
        user_input=body.user_input,
    )
    return {
        "workflow_id": workflow.id,
        "session_id": workflow.session_id,
        "status": workflow.status.value if hasattr(workflow.status, "value") else str(workflow.status),
        "current_stage": workflow.current_stage,
        "message": "工作流已启动，进入需求澄清阶段",
    }


@router.get("/{workflow_id}/status", response_model=WorkflowStatusResponse)
async def get_workflow_status(request: Request, workflow_id: str):
    """
    获取工作流完整状态
    """
    workflow_engine = request.app.state.workflow_engine
    try:
        status_info = await workflow_engine.get_workflow_status(workflow_id)
        return WorkflowStatusResponse(
            workflow_id=status_info.workflow_id,
            session_id=status_info.session_id,
            status=status_info.status,
            current_stage=status_info.current_stage,
            iteration_count=status_info.iteration_count,
            max_iterations=status_info.max_iterations,
            progress=status_info.progress,
            error_message=status_info.error_message,
            stages=[
                WorkflowStageResponse(
                    key=s["key"],
                    name=s["name"],
                    status=s["status"],
                    agent_role=s.get("agent_role"),
                    started_at=s.get("started_at"),
                    completed_at=s.get("completed_at"),
                )
                for s in status_info.stages
            ],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{workflow_id}/advance", response_model=dict)
async def advance_workflow(request: Request, workflow_id: str):
    """
    推进工作流到下一阶段
    """
    workflow_engine = request.app.state.workflow_engine
    try:
        stage = await workflow_engine.advance_stage(workflow_id)
        return {
            "workflow_id": workflow_id,
            "stage_name": stage.stage_name,
            "status": stage.status.value if hasattr(stage.status, "value") else str(stage.status),
            "message": f"工作流已推进到 {stage.stage_name} 阶段",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{workflow_id}/rollback", response_model=dict)
async def rollback_workflow(request: Request, workflow_id: str, body: RollbackRequest):
    """
    回退工作流到指定阶段
    """
    workflow_engine = request.app.state.workflow_engine
    try:
        stage = await workflow_engine.rollback_stage(workflow_id, body.target_stage)
        return {
            "workflow_id": workflow_id,
            "stage_name": stage.stage_name,
            "status": stage.status.value if hasattr(stage.status, "value") else str(stage.status),
            "message": f"工作流已回退到 {stage.stage_name} 阶段",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# Commit Hook 端点（v2.1.0 新增）
# ============================================================

@router.post("/{workflow_id}/commit-hook", response_model=CommitHookResponse)
async def commit_hook(request: Request, workflow_id: str, body: CommitHookRequest):
    """
    Commit Hook 回调端点
    运行步骤：
      1. 获取 CommitHookHandler 实例
      2. 构建 hook_data 字典
      3. 调用 handle_commit_hook 处理回调
      4. 返回操作结果
    参数：
      - workflow_id: 工作流 ID
      - body: CommitHookRequest 请求体
    返回值：CommitHookResponse，包含 success、commit_hash、message
    """
    commit_hook_handler = request.app.state.commit_hook_handler

    # 构建 hook_data 字典
    hook_data = {
        "module_name": body.module_name,
        "changed_files": body.changed_files,
        "commit_message_suggestion": body.commit_message_suggestion,
        "checklist_item": body.checklist_item,
        "change_summary": body.change_summary,
    }

    result = await commit_hook_handler.handle_commit_hook(
        workflow_id=workflow_id,
        module_name=body.module_name,
        hook_data=hook_data,
    )

    return CommitHookResponse(
        success=result.get("success", False),
        commit_hash=result.get("commit_hash", ""),
        message=result.get("message", ""),
    )


# ============================================================
# 原子任务清单端点（v2.2.0 新增）
# ============================================================

@router.get("/{workflow_id}/atomic-tasks", response_model=dict)
async def get_atomic_tasks(request: Request, workflow_id: str):
    """
    获取原子任务清单
    运行步骤：
      1. 获取 AtomicTaskAggregator 实例
      2. 调用 get_atomic_list 查询原子任务清单
      3. 返回完整原子任务清单数据
    参数：
      - workflow_id: 工作流 ID
    返回值：dict，包含 modules、tasks_json、progress、status
    """
    aggregator = request.app.state.atomic_task_aggregator
    try:
        result = await aggregator.get_atomic_list(workflow_id)
        if result is None:
            raise HTTPException(status_code=404, detail="原子任务清单不存在")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================
# Task Hook 端点（v2.2.0 新增）
# ============================================================

@router.post("/{workflow_id}/task-hook", response_model=TaskHookResponse)
async def task_hook(request: Request, workflow_id: str, body: TaskHookRequest):
    """
    Task Hook 回调端点
    运行步骤：
      1. 获取 TaskHookHandler 实例
      2. 构建 payload 字典
      3. 调用 handle_task_hook 处理回调
      4. 返回操作结果
    参数：
      - workflow_id: 工作流 ID
      - body: TaskHookRequest 请求体
    返回值：TaskHookResponse，包含 success、hook_type、task_id、
            commit_hash、message、action_taken
    """
    task_hook_handler = request.app.state.task_hook_handler

    # 构建 payload 字典
    payload = {
        "task_id": body.task_id,
        "module_name": body.module_name,
        "status": body.status,
        "output": body.output,
        "changed_files": body.changed_files,
        "commit_message": body.commit_message,
        "check_type": body.check_type,
        "test_type": body.test_type,
        "result": body.result,
        "issues": body.issues,
        "coverage": body.coverage,
    }

    result = await task_hook_handler.handle_task_hook(
        workflow_id=workflow_id,
        hook_type=body.hook_type,
        payload=payload,
    )

    return TaskHookResponse(
        success=result.success,
        hook_type=result.hook_type,
        task_id=result.task_id,
        commit_hash=result.commit_hash,
        message=result.message,
        action_taken=result.action_taken,
    )


@router.get("/{workflow_id}/stages", response_model=List[WorkflowStageResponse])
async def get_workflow_stages(request: Request, workflow_id: str):
    """
    获取工作流所有阶段详情
    """
    workflow_engine = request.app.state.workflow_engine
    try:
        status_info = await workflow_engine.get_workflow_status(workflow_id)
        return [
            WorkflowStageResponse(
                key=s["key"],
                name=s["name"],
                status=s["status"],
                agent_role=s.get("agent_role"),
                started_at=s.get("started_at"),
                completed_at=s.get("completed_at"),
            )
            for s in status_info.stages
        ]
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================
# 需求澄清端点（v2.3.0 新增）
# ============================================================

class ClarifyConfirmRequest(BaseModel):
    """
    澄清确认请求模型
    字段说明：
      - confirmed: 是否确认需求文档（True=确认完成，False=继续补充）
    """
    confirmed: bool = Field(..., description="是否确认")


@router.get("/{workflow_id}/clarify/questions")
async def get_clarify_questions(request: Request, workflow_id: str):
    """
    获取当前澄清问题列表（v2.3.0 新增）
    运行步骤：
      1. 从数据库加载 Workflow 的 clarification_questions
      2. 返回澄清状态、问题列表、当前阶段信息
    调用方：前端澄清界面
    参数：
      - workflow_id: 工作流 ID
    返回值：dict，包含 workflow_id、clarification_round、clarification_complete、
            questions、current_stage
    """
    from sqlalchemy import select
    from ..models import Workflow
    from ..database import get_session_factory

    session_factory = get_session_factory()
    try:
        async with session_factory() as db:
            result = await db.execute(
                select(Workflow).where(Workflow.id == workflow_id)
            )
            workflow = result.scalar_one_or_none()
            if workflow is None:
                raise HTTPException(status_code=404, detail="工作流不存在")
            return {
                "workflow_id": workflow_id,
                "clarification_round": workflow.clarification_round,
                "clarification_complete": workflow.clarification_complete,
                "questions": workflow.clarification_questions or [],
                "current_stage": workflow.current_stage,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询澄清问题失败: {str(e)}")


@router.post("/{workflow_id}/clarify/confirm")
async def confirm_clarification(
    request: Request, workflow_id: str, body: ClarifyConfirmRequest
):
    """
    用户确认需求文档（v2.3.0 新增）
    运行步骤：
      1. 若 confirmed=True，调用 workflow_engine.confirm_stage("clarifying") 完成确认
      2. 若 confirmed=False，返回提示继续补充
    调用方：前端澄清确认按钮
    参数：
      - workflow_id: 工作流 ID
      - body: ClarifyConfirmRequest，包含 confirmed 标记
    返回值：dict，包含 success、message
    """
    workflow_engine = request.app.state.workflow_engine

    if body.confirmed:
        result = await workflow_engine.confirm_stage(workflow_id, "clarifying")
        return {
            "success": result.get("success", False),
            "message": result.get("message", ""),
        }
    else:
        return {
            "success": True,
            "message": "请继续补充需求信息",
        }


# ============================================================
# 全链路自动化测试流水线端点（v4.1.0 新增）
# ============================================================

@router.post("/{workflow_id}/pipeline-test")
async def run_pipeline_test(
    request: Request, workflow_id: str, body: PipelineTestRequest = PipelineTestRequest()
):
    """
    启动全链路自动化测试流水线（v4.1.0 新增）
    作用：触发 6 步全链路自动化测试，通过 SSE 实时推送进度到前端
    调用方：前端流水线测试界面
    运行步骤：
      1. 获取 WorkflowEngine 实例
      2. 调用 run_full_pipeline_test 启动流水线
      3. 通过 SSE 流式推送每个步骤的实时状态
      4. 流水线完成后推送最终结果
    参数：
      - workflow_id: 工作流 ID
      - body: PipelineTestRequest，可选 modules 字段指定测试模块
    返回值：StreamingResponse（SSE 格式），实时推送流水线进度
    """
    workflow_engine = request.app.state.workflow_engine

    async def event_generator():
        """SSE 事件生成器，消费流水线 async generator 并转发事件"""
        try:
            async for event in workflow_engine.run_full_pipeline_test(workflow_id):
                # 如果指定了 modules，可以在事件中附加模块信息
                yield event
        except Exception as e:
            logger.error(f"流水线测试异常: {e}")
            yield f"data: {json.dumps({'type': 'pipeline_error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{workflow_id}/pipeline-status", response_model=PipelineStatusResponse)
async def get_pipeline_status(request: Request, workflow_id: str):
    """
    获取流水线测试状态（v4.1.0 新增）
    作用：查询当前流水线测试的进度和结果，供前端轮询或订阅
    调用方：前端流水线状态轮询
    运行步骤：
      1. 从 WorkflowEngine._latest_pipeline_result 缓存中读取结果
      2. 如果无缓存，返回空状态
      3. 将 PipelineTestResult 转换为 PipelineStatusResponse 返回
    参数：
      - workflow_id: 工作流 ID
    返回值：PipelineStatusResponse，包含步骤状态、汇总信息
    """
    workflow_engine = request.app.state.workflow_engine
    pipeline_result = workflow_engine._latest_pipeline_result.get(workflow_id)

    if pipeline_result is None:
        return PipelineStatusResponse(
            workflow_id=workflow_id,
            overall_status="unknown",
            steps=[],
            has_result=False,
        )

    # 将 PipelineTestResult 转换为 API 响应模型
    steps_response = [
        PipelineStepStatusResponse(
            step_name=s.step_name,
            status=s.status,
            started_at=s.started_at,
            completed_at=s.completed_at,
            output=s.output,
            error=s.error,
        )
        for s in pipeline_result.steps
    ]

    return PipelineStatusResponse(
        workflow_id=pipeline_result.workflow_id,
        overall_status=pipeline_result.overall_status,
        steps=steps_response,
        all_modules_passed=pipeline_result.all_modules_passed,
        git_commit_success=pipeline_result.git_commit_success,
        integration_test_passed=pipeline_result.integration_test_passed,
        summary=pipeline_result.summary,
        has_result=True,
    )


# ============================================================
# 原有工作流端点（保留兼容）
# ============================================================

@router.post("/optimize", response_model=OptimizeResponse)
async def optimize_prompt(request: Request, body: OptimizeRequest):
    """
    提示词优化
    """
    executor = request.app.state.executor
    optimizer = PromptOptimizer(executor)
    result = await optimizer.optimize(body.raw_prompt)
    return OptimizeResponse(
        original=result.original,
        optimized=result.optimized,
        task_modules=result.task_modules,
        constraints=result.constraints,
        success=result.success,
        error_message=result.error_message,
    )


@router.post("/plan", response_model=PlanResponse)
async def plan_tasks(request: Request, body: PlanRequest):
    """
    任务规划
    """
    executor = request.app.state.executor
    planner = TaskPlanner(executor)
    result = await planner.plan(body.original_prompt, body.optimized_prompt)
    return PlanResponse(
        sub_tasks=[
            SubTaskResponse(
                id=st.id,
                title=st.title,
                description=st.description,
                priority=st.priority.value,
                dependencies=st.dependencies,
                estimated_complexity=st.estimated_complexity,
            )
            for st in result.sub_tasks
        ],
        total_tasks=result.total_tasks,
        success=result.success,
        error_message=result.error_message,
    )


@router.post("/execute")
async def execute_task(
    request: Request,
    body: ExecuteRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    执行任务
    """
    result = await db.execute(select(Task).where(Task.id == body.task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    executor = request.app.state.executor
    strategy_router: StrategyRouter = request.app.state.strategy_router
    agent_manager = request.app.state.agent_manager

    complexity = strategy_router.estimate_complexity(task.optimized_prompt or task.description)
    strategy = strategy_router.route(task.optimized_prompt or task.description, complexity)

    task.status = TaskStatus.RUNNING
    task.execution_mode = ExecutionMode(strategy.mode.value)
    task.complexity_score = complexity
    task.started_at = datetime.now(timezone.utc)
    task.iteration_count += 1
    await db.commit()

    cli_result = await executor.execute(
        command=strategy.command_template,
        timeout=600,
    )

    if task.agent_id:
        user_conv = Conversation(
            task_id=task.id,
            agent_id=task.agent_id,
            role="user",
            content=task.optimized_prompt or task.description,
        )
        db.add(user_conv)

        assistant_conv = Conversation(
            task_id=task.id,
            agent_id=task.agent_id,
            role="assistant",
            content=cli_result.stdout,
            extra_data={
                "execution_mode": strategy.mode.value,
                "complexity_score": complexity,
                "duration": cli_result.duration,
                "tokens_consumed": cli_result.tokens_consumed,
            },
        )
        db.add(assistant_conv)

    task.result_summary = cli_result.stdout[:2000] if cli_result.success else ""
    task.error_message = cli_result.error_message if not cli_result.success else ""
    task.token_consumed = cli_result.tokens_consumed
    task.api_calls = 1

    if cli_result.success:
        task.status = TaskStatus.VALIDATING
    else:
        task.status = TaskStatus.FAILED
        task.completed_at = datetime.now(timezone.utc)

    await db.commit()

    if task.agent_id:
        await agent_manager.add_token_usage(task.agent_id, cli_result.tokens_consumed, 1)

    return {
        "task_id": task.id,
        "execution_mode": strategy.mode.value,
        "complexity_score": complexity,
        "success": cli_result.success,
        "output_preview": cli_result.stdout[:1000],
        "error_message": cli_result.error_message,
        "duration": cli_result.duration,
        "tokens_consumed": cli_result.tokens_consumed,
    }


@router.post("/validate")
async def validate_task(
    request: Request,
    body: ValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    验证任务结果
    """
    result = await db.execute(select(Task).where(Task.id == body.task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    executor = request.app.state.executor
    validator = TaskValidator(executor)

    validation = await validator.validate(
        task_description=task.description or task.title,
        execution_output=task.result_summary or "",
    )

    if validation.status.value == "passed":
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.now(timezone.utc)
    elif validation.needs_iteration:
        if task.iteration_count >= task.max_iterations:
            task.status = TaskStatus.FAILED
            task.completed_at = datetime.now(timezone.utc)
            task.error_message = f"超过最大迭代次数 ({task.max_iterations})，验证未通过"
        else:
            task.status = TaskStatus.PENDING
            task.error_message = f"验证不通过，需要第 {task.iteration_count + 1} 次迭代修复"
    else:
        task.status = TaskStatus.FAILED
        task.completed_at = datetime.now(timezone.utc)

    await db.commit()

    return {
        "task_id": task.id,
        "validation_status": validation.status.value,
        "score": validation.score,
        "issues": [
            {
                "severity": i.severity,
                "category": i.category,
                "description": i.description,
                "suggestion": i.suggestion,
            }
            for i in validation.issues
        ],
        "needs_iteration": validation.needs_iteration,
        "current_iteration": task.iteration_count,
        "max_iterations": task.max_iterations,
        "summary": validation.summary,
    }


@router.post("/full")
async def full_workflow(
    request: Request,
    body: FullWorkflowRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    完整工作流（一键执行：优化 -> 规划 -> 执行 -> 验证）
    """
    executor = request.app.state.executor
    agent_manager = request.app.state.agent_manager
    strategy_router: StrategyRouter = request.app.state.strategy_router

    workflow_log = []

    optimizer = PromptOptimizer(executor)
    optimized = await optimizer.optimize(body.raw_prompt)
    workflow_log.append({
        "step": "optimize",
        "success": optimized.success,
        "task_modules": optimized.task_modules,
    })

    if not optimized.success:
        return {"success": False, "step": "optimize", "error": optimized.error_message, "log": workflow_log}

    planner = TaskPlanner(executor)
    plan = await planner.plan(body.raw_prompt, optimized.optimized)
    workflow_log.append({
        "step": "plan",
        "success": plan.success,
        "total_tasks": plan.total_tasks,
    })

    if not plan.success:
        return {"success": False, "step": "plan", "error": plan.error_message, "log": workflow_log}

    created_tasks = []
    scheduler = TaskScheduler(agent_manager)

    for sub_task in plan.sub_tasks:
        task = Task(
            title=sub_task.title,
            description=sub_task.description,
            original_prompt=body.raw_prompt,
            optimized_prompt=optimized.optimized,
            status=TaskStatus.PENDING,
            priority=TaskPriority(sub_task.priority.value),
            complexity_score=sub_task.estimated_complexity,
            max_iterations=5,
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)

        if body.agent_id:
            assignment = await scheduler.assign_manual(task.id, body.agent_id)
        else:
            assignments = await scheduler.assign_tasks([task.id], {task.id: sub_task.estimated_complexity})
            assignment = assignments[0] if assignments else None

        if assignment and assignment.success:
            task.agent_id = assignment.agent_id
            await db.commit()

        created_tasks.append({
            "task_id": task.id,
            "title": task.title,
            "agent_id": task.agent_id,
        })

    workflow_log.append({
        "step": "create_tasks",
        "tasks_created": len(created_tasks),
    })

    validator = TaskValidator(executor)
    task_results = []

    for task_info in created_tasks:
        task_result = await db.execute(select(Task).where(Task.id == task_info["task_id"]))
        task = task_result.scalar_one_or_none()
        if task is None:
            continue

        max_iterations = task.max_iterations
        final_success = False

        for iteration in range(1, max_iterations + 1):
            complexity = strategy_router.estimate_complexity(task.optimized_prompt or task.description)
            strategy = strategy_router.route(task.optimized_prompt or task.description, complexity)

            task.status = TaskStatus.RUNNING
            task.execution_mode = ExecutionMode(strategy.mode.value)
            task.complexity_score = complexity
            task.iteration_count = iteration
            task.started_at = datetime.now(timezone.utc)
            await db.commit()

            cli_result = await executor.execute(
                command=strategy.command_template,
                timeout=600,
            )

            task.result_summary = cli_result.stdout[:2000] if cli_result.success else ""
            task.error_message = cli_result.error_message
            task.token_consumed = cli_result.tokens_consumed
            task.api_calls = 1

            if task.agent_id:
                await agent_manager.add_token_usage(task.agent_id, cli_result.tokens_consumed, 1)

            if not cli_result.success:
                task.status = TaskStatus.FAILED
                await db.commit()
                break

            task.status = TaskStatus.VALIDATING
            await db.commit()

            validation = await validator.validate(
                task_description=task.description or task.title,
                execution_output=task.result_summary or "",
            )

            if validation.status.value == "passed":
                task.status = TaskStatus.COMPLETED
                task.completed_at = datetime.now(timezone.utc)
                await db.commit()
                final_success = True
                break
            elif not validation.needs_iteration:
                task.status = TaskStatus.FAILED
                task.completed_at = datetime.now(timezone.utc)
                await db.commit()
                break

        task_results.append({
            "task_id": task.id,
            "title": task.title,
            "success": final_success,
            "iterations": task.iteration_count,
            "status": task.status.value,
        })

    workflow_log.append({
        "step": "execute_validate",
        "results": task_results,
    })

    all_success = all(r["success"] for r in task_results)

    return {
        "success": all_success,
        "total_tasks": len(task_results),
        "completed_tasks": sum(1 for r in task_results if r["success"]),
        "failed_tasks": sum(1 for r in task_results if not r["success"]),
        "task_results": task_results,
        "log": workflow_log,
    }
