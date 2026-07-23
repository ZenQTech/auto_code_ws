"""
# ============================================================
# Hermes 智能调度 API
# ============================================================
# 核心作用：提供 Hermes 对话、提示词优化、任务规划、确认执行
#           的 REST API 接口；接受 session_id 参数以持久化主对话与子 Agent/Task
# 运行流程：
#   - POST /api/hermes/chat: 与 Hermes 对话（非流式）
#   - POST /api/hermes/chat/stream: 与 Hermes 流式对话（SSE）
#   - POST /api/hermes/optimize: 提示词优化 + 自动创建 CLI 实例规划
#   - POST /api/hermes/confirm: 确认计划并按模块分发执行
# 输入参数：通过请求体传递（JSON 格式，含可选 session_id）
# 输出结果：各接口对应的 JSON 响应
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始创建，实现 Hermes 核心 API
#   - 2026-06-23 | v1.2.0 | 接受 session_id 参数，传递给 HermesService 持久化
#   - 2026-06-23 | v1.2.1 | 流式 done 事件携带自动生成 title（auto-session-title-generation spec）
#   - 2026-06-29 | v2.3.0 | 新增 POST /api/hermes/clarify/respond 端点，接收用户澄清回复
#   - 2026-06-29 | v2.4.0 | ChatRequest 新增 session_mode 字段；chat/stream 端点
#             透传 session_mode 给 HermesService，支持 coding 模式下开发需求自动路由
# ============================================================
"""

import json
import logging
from typing import List, Optional
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services.hermes_service import HermesService
from ..services.clarification_service import ClarificationService  # v2.3.0 新增

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class ChatRequest(BaseModel):
    """Hermes 对话请求"""
    message: str = Field(..., min_length=1, description="用户消息文本")
    session_id: Optional[str] = Field(default=None, description="可选会话 ID（用于持久化）")
    session_mode: Optional[str] = Field(default=None, description="可选会话模式（v2.4.0 新增）: 'chat' | 'coding'")


class ChatResponse(BaseModel):
    """Hermes 对话响应"""
    reply: str = Field(..., description="Hermes 回复文本")
    optimized: bool = Field(default=False, description="是否触发了提示词优化")
    plan_content: str = Field(default="", description="计划内容（如有）")


class OptimizeRequest(BaseModel):
    """提示词优化请求"""
    raw_prompt: str = Field(..., min_length=1, description="用户原始需求文本")
    session_id: Optional[str] = Field(default=None, description="可选会话 ID")


class OptimizeResponse(BaseModel):
    """提示词优化响应"""
    original: str = Field(..., description="原始需求文本")
    optimized: str = Field(..., description="优化后的提示词")
    task_modules: List[str] = Field(default_factory=list, description="任务模块列表")
    constraints: List[str] = Field(default_factory=list, description="约束条件列表")
    plan_content: str = Field(default="", description="生成的计划.md 内容")
    agent_created: bool = Field(default=False, description="是否创建了规划用 CLI 实例")
    agent_id: str = Field(default="", description="创建的 CLI 实例 ID")
    success: bool = Field(default=False, description="优化是否成功")
    error_message: str = Field(default="", description="错误信息")


class ConfirmRequest(BaseModel):
    """确认执行请求"""
    plan_content: str = Field(..., min_length=1, description="计划文档内容")
    session_id: Optional[str] = Field(default=None, description="可选会话 ID")


class ConfirmResponse(BaseModel):
    """确认执行响应"""
    success: bool = Field(default=False, description="是否成功")
    tasks_created: int = Field(default=0, description="创建的任务数量")
    agents_created: int = Field(default=0, description="创建的 CLI 实例数量")
    message: str = Field(default="", description="结果描述信息")


# ============================================================
# API 端点
# ============================================================

@router.post("/chat", response_model=ChatResponse)
async def chat_with_hermes(request: Request, body: ChatRequest):
    """
    与 Hermes 进行对话
    运行步骤：
      1. 获取 HermesService 实例
      2. 调用 chat_with_hermes 方法（传入 session_id 用于持久化）
      3. 返回对话结果
    调用方：前端 Hermes 对话界面
    被调用方：HermesService -> CLIExecutor
    参数：
      - body: ChatRequest，包含用户消息与可选 session_id
    返回值：ChatResponse，包含 Hermes 回复
    """
    hermes = request.app.state.hermes_service
    result = await hermes.chat_with_hermes(body.message, session_id=body.session_id, session_mode=body.session_mode)
    return ChatResponse(
        reply=result.reply,
        optimized=result.optimized,
        plan_content=result.plan_content,
    )


@router.post("/chat/stream")
async def chat_with_hermes_stream(request: Request, body: ChatRequest):
    """
    与 Hermes 进行流式对话（SSE）
    运行步骤：
      1. 获取 HermesExecutor 和 AgentManager
      2. 创建 HermesService 实例
      3. 调用 chat_with_hermes_streaming 异步生成器
      4. 返回 StreamingResponse
    调用方：前端流式对话
    参数：
      - body: ChatRequest，包含用户消息与可选 session_id
    返回值：StreamingResponse (text/event-stream)
    SSE 事件格式（auto-session-title-generation 增强）：
      - {"type": "thinking", "content": "..."}  推理片段
      - {"type": "text", "content": "..."}      文本片段
      - {"type": "done", "title": "..."}        流结束；首轮自动命名时携带 title 字段
      - {"type": "error", "content": "..."}     错误
    注意：done.title 字段仅在 Session 首次完成对话（title 仍为占位"新会话"）时携带；
          用户已手动命名或第二轮及以后对话，done 事件不会携带 title 字段
    修改记录：
      - 2026-06-23 | v1.1.0 | 新增 SSE 流式对话端点
      - 2026-06-23 | v1.2.0 | 接受 session_id 并传递给 HermesService
      - 2026-06-23 | v1.2.1 | 文档更新：done 事件携带 title 字段
    """
    hermes_executor = request.app.state.hermes_executor
    hermes = request.app.state.hermes_service

    return StreamingResponse(
        hermes.chat_with_hermes_streaming(body.message, hermes_executor, session_id=body.session_id, session_mode=body.session_mode),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/optimize", response_model=OptimizeResponse)
async def optimize_with_hermes(request: Request, body: OptimizeRequest):
    """
    提示词优化并制定任务计划
    运行步骤：
      1. 创建 HermesService 实例
      2. 调用 optimize_and_plan 方法（传入 session_id 用于持久化规划 Agent）
      3. 返回优化结果和计划内容
    调用方：前端优化流程
    被调用方：HermesService -> CLIExecutor、AgentManager
    参数：
      - body: OptimizeRequest，包含原始需求与可选 session_id
    返回值：OptimizeResponse，包含优化结果和计划内容
    """
    hermes = request.app.state.hermes_service
    result = await hermes.optimize_and_plan(body.raw_prompt, session_id=body.session_id)
    return OptimizeResponse(
        original=result.original,
        optimized=result.optimized,
        task_modules=result.task_modules,
        constraints=result.constraints,
        plan_content=result.plan_content,
        agent_created=result.agent_created,
        agent_id=result.agent_id,
        success=result.success,
        error_message=result.error_message,
    )


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm_plan(request: Request, body: ConfirmRequest):
    """
    确认计划并按模块分发执行
    运行步骤：
      1. 创建 HermesService 实例
      2. 调用 confirm_and_execute 方法（传入 session_id 用于持久化 Agent/Task）
      3. 返回执行结果
    调用方：前端 PlanViewer 确认按钮
    被调用方：HermesService -> AgentManager
    参数：
      - body: ConfirmRequest，包含计划文档内容与可选 session_id
    返回值：ConfirmResponse，包含任务分发结果
    """
    hermes = request.app.state.hermes_service
    result = await hermes.confirm_and_execute(body.plan_content, session_id=body.session_id)
    return ConfirmResponse(
        success=result.success,
        tasks_created=result.tasks_created,
        agents_created=result.agents_created,
        message=result.message,
    )


# ============================================================
# 需求澄清端点（v2.3.0 新增）
# ============================================================

class ClarifyRespondRequest(BaseModel):
    """
    澄清回复请求模型
    字段说明：
      - session_id: 会话 ID（用于关联会话）
      - workflow_id: 工作流 ID（用于定位澄清状态）
      - message: 用户回复内容
    """
    session_id: str = Field(..., description="会话 ID")
    workflow_id: str = Field(..., description="工作流 ID")
    message: str = Field(..., min_length=1, description="用户回复内容")


@router.post("/clarify/respond")
async def clarify_respond(request: Request, body: ClarifyRespondRequest):
    """
    接收用户澄清回复，返回 Agent 回复（v2.3.0 新增）
    运行步骤：
      1. 获取 ClarificationService 和 HermesService 实例
      2. 调用 clarification_service.handle_user_response() 处理用户回复
      3. 将 ClarifyResult 格式化为 SSE 流式响应
    调用方：前端澄清对话界面
    被调用方：ClarificationService -> RequirementClarifier
    参数：
      - body: ClarifyRespondRequest，包含 session_id、workflow_id、message
    返回值：StreamingResponse (text/event-stream)
    SSE 事件格式：
      - {"type": "text", "content": "..."}     AI 回复文本
      - {"type": "clarify_complete", "content": "需求澄清已完成"}
      - {"type": "done"}                        流结束
    """
    clarification_service: ClarificationService = request.app.state.clarification_service
    hermes_service = request.app.state.hermes_service

    result = await clarification_service.handle_user_response(
        workflow_id=body.workflow_id,
        user_message=body.message,
    )

    # 格式化为 SSE 流式响应
    async def generate():
        events = hermes_service._format_clarify_result_for_sse(result)
        for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# 停止生成端点（v2.4.0 新增）
# ============================================================

@router.post("/stop")
async def stop_generation(request: Request):
    """
    停止当前正在运行的 Hermes CLI 子进程（v2.4.0 新增）
    作用：供前端停止按钮调用，通过 HermesExecutor.cancel() 终止子进程
    运行步骤：
      1. 获取 request.app.state.hermes_executor 实例
      2. 调用 hermes_executor.cancel() 终止当前子进程
      3. 返回操作结果
    调用方：前端 App.tsx handleStop 回调
    被调用方：HermesExecutor.cancel() -> BaseCLIExecutor.cancel()
    返回值：{ success: bool, message: str }
    幂等性：多次调用不会报错
    """
    hermes_executor = request.app.state.hermes_executor
    if hermes_executor:
        result = hermes_executor.cancel()
        if result:
            return {"success": True, "message": "生成已停止"}
        else:
            return {"success": True, "message": "当前无正在运行的生成任务"}
    return {"success": False, "message": "无可停止的生成任务"}
