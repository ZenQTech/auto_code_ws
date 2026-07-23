"""
# ============================================================
# 后端核心服务 - Hermes 智能调度服务
# ============================================================
# 核心作用：作为平台中央调度大脑，负责用户对话、提示词优化、
#           任务规划、按需创建/销毁 Claude Code CLI 子实例；
#           持久化 Hermes 主对话到 conversations 表（按 session_id 归属）
# 运行流程：
#   1. 接收用户消息，进行智能对话回复（流式 thinking + text 持久化）
#   2. 对用户需求进行提示词优化（创建规划用 Agent 时落库 session_id）
#   3. 用户确认后按模块拆分任务并分发执行（子 Agent/Task 落库 session_id）
# 输入参数：
#   - message: str，用户对话消息
#   - raw_prompt: str，用户原始需求
#   - plan_content: str，计划文档内容
#   - session_id: str，可选会话 ID（用于持久化归属）
# 输出结果：HermesChatResult / HermesOptimizeResult / HermesConfirmResult
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始创建，实现 Hermes 核心调度逻辑
#   - 2026-06-23 | v1.5.0 | 接受 session_id 参数；持久化主对话到 conversations 表
#   - 2026-06-23 | v1.6.0 | 新增 _generate_session_title 自动命名方法
#   - 2026-06-23 | v1.7.0 | 撤销 _generate_session_title 与 SSE done title 字段
#   - 2026-06-29 | v2.5.0 | 新增 clarification_service 参数；_build_chat_command()
#             支持阶段感知 Prompt 切换（clarifying 阶段使用 RequirementClarifier prompt）；
#             新增 _format_clarify_result_for_sse() 方法；
#             chat_with_hermes_streaming() 新增 clarifying 模式处理逻辑
#   - 2026-06-29 | v2.4.0 | 新增 workflow_engine 参数、_DEVELOPMENT_KEYWORDS 关键词列表、
#             _is_development_request() 检测方法；coding 模式下开发需求自动路由到
#             WorkflowEngine 启动 SOP 工作流；chat_with_hermes() / 
#             chat_with_hermes_streaming() 新增 session_mode 参数
#   - 2026-06-30 | v2.7.0 | clarifying 模式检查前置到开发需求检测之前，增加 not is_clarifying_mode 守卫
#   - 2026-06-30 | v2.7.0 | chat/chat_streaming 增加反引号/美元符号转义，防止 shell 命令替换注入
#   - 2026-06-30 | v2.9.0 | _format_clarify_result_for_sse 澄清完成时即使 questions 为空也发送 clarify_questions 事件
#   - 2026-07-01 | v2.10.1 | 澄清完成且 questions 为空时 questions_text 设为空字符串
#   - 2026-07-01 | v3.1.2 | 未完成但无问题时生成兜底问题（继续补充不确定项 / 跳过进入架构设计）
#   - 2026-07-22 | v3.3.0 | 新增 _create_chief_architect() / _create_evaluator() /
#             dispatch_by_stage() 方法；chat_with_hermes_streaming() 工作流启动后
#             自动创建总架构师和批判智能体；新增阶段分发逻辑（designing/prompting/reviewing）
# ============================================================
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from cli_integration.executor import CLIExecutor, CLIResult
from cli_integration.agent_manager import AgentManager

# v3.3.0 新增：智能体角色导入（用于按阶段创建和分派智能体）
from .agent_roles import (
    ChiefArchitect,
    CriticalReviewer,
    QualityManager,
    PromptEngineer,
    RequirementClarifier,
)

logger = logging.getLogger(__name__)


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class HermesChatResult:
    """
    Hermes 对话结果
    字段说明：
      - reply: Hermes 的回复文本
      - optimized: 是否触发了提示词优化
      - plan_content: 如果生成了计划，包含计划内容
    """
    reply: str = ""
    optimized: bool = False
    plan_content: str = ""


@dataclass
class HermesOptimizeResult:
    """
    Hermes 优化结果
    字段说明：
      - original: 原始需求文本
      - optimized: 优化后的提示词
      - task_modules: 识别出的任务模块列表
      - constraints: 识别出的约束条件列表
      - plan_content: 生成的计划.md 内容
      - agent_created: 是否创建了规划用的 CLI 实例
      - agent_id: 创建的 CLI 实例 ID
      - success: 优化是否成功
      - error_message: 错误信息
    """
    original: str = ""
    optimized: str = ""
    task_modules: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    plan_content: str = ""
    agent_created: bool = False
    agent_id: str = ""
    success: bool = False
    error_message: str = ""


@dataclass
class HermesConfirmResult:
    """
    Hermes 确认执行结果
    字段说明：
      - success: 是否成功
      - tasks_created: 创建的任务数量
      - agents_created: 创建的 CLI 实例数量
      - message: 结果描述信息
    """
    success: bool = False
    tasks_created: int = 0
    agents_created: int = 0
    message: str = ""


# ============================================================
# HermesService 核心服务类
# ============================================================

class HermesService:
    """
    Hermes 智能调度服务
    作用：作为平台中央调度大脑，处理用户对话、优化、规划、分发执行；
         同时将 Hermes 主对话与子 Agent/Task 持久化到 conversations / agents / tasks 表
    调用方：API 层（hermes.py）
    被调用方：CLIExecutor、AgentManager、async_sessionmaker
    """

    # ============================================================
    # v2.4.0 新增：开发需求关键词列表（用于检测用户消息是否为开发需求）
    # 作用：在 coding 模式下检测用户消息是否包含开发需求关键词，
    #       命中后自动路由到 WorkflowEngine 启动 SOP 标准开发流程
    # ============================================================
    _DEVELOPMENT_KEYWORDS = [
        # 中文关键词
        "开发", "实现", "创建", "编写", "构建", "设计", "搭建",
        "写一个", "做一个", "帮我写", "帮我做", "帮我开发",
        "生成代码", "编写代码", "写代码", "实现功能", "开发功能",
        "项目", "模块", "系统", "平台", "应用", "服务",
        "架构", "重构", "优化性能", "修复bug", "调试",
        "ROS", "ros2", "机器人", "机械臂", "AGV",
        "路径规划", "运动控制", "传感器", "SLAM", "定位",
        "Python脚本", "C++程序", "ROS包", "package",
        "请帮我", "我需要", "我要", "我想",
        # 英文关键词
        "develop", "implement", "create", "build", "design",
        "write code", "generate code", "project", "module",
        "architecture", "refactor", "optimize",
    ]

    @classmethod
    def _is_development_request(cls, message: str) -> bool:
        """
        检测用户消息是否为开发需求（v2.4.0 新增）
        运行步骤：
          1. 若消息为空，直接返回 False
          2. 将消息转为小写（兼容中英文大小写）
          3. 遍历 _DEVELOPMENT_KEYWORDS 关键词列表
          4. 任一关键词命中则返回 True，全部未命中返回 False
        参数：
          - message: 用户消息文本
        返回值：bool，True 表示检测到开发需求
        """
        if not message:
            return False
        msg_lower = message.lower()
        for keyword in cls._DEVELOPMENT_KEYWORDS:
            if keyword.lower() in msg_lower:
                return True
        return False

    def __init__(
        self,
        executor: CLIExecutor,
        agent_manager: AgentManager,
        session_factory: Optional[async_sessionmaker] = None,
        clarification_service=None,  # v2.5.0 新增：需求澄清服务
        workflow_engine=None,  # v2.4.0 新增：Loop Engineering 工作流引擎
    ):
        """
        初始化 Hermes 服务
        参数：
          - executor: CLI 命令执行器实例
          - agent_manager: 智能体管理器实例
          - session_factory: 可选异步会话工厂（用于持久化对话 / Agent / Task）
          - clarification_service: 可选 ClarificationService 实例（v2.5.0 新增，
            用于 clarifying 阶段的 AI 澄清对话处理）
          - workflow_engine: 可选 WorkflowEngine 实例（v2.4.0 新增，
            用于 coding 模式下开发需求自动路由启动 SOP 工作流）
        """
        self.executor = executor
        self.agent_manager = agent_manager
        self.session_factory = session_factory
        self.clarification_service = clarification_service  # v2.5.0 新增
        self.workflow_engine = workflow_engine  # v2.4.0 新增
        # 流式对话中间状态：用于在同一请求内跨 yield 传递变量
        self._streaming_assistant_conv_id: Optional[str] = None
        self._streaming_thinking_parts: List[str] = []
        self._streaming_text_parts: List[str] = []

    async def chat_with_hermes(
        self, message: str, session_id: Optional[str] = None,
        session_mode: Optional[str] = None,  # v2.4.0 新增: "chat" | "coding"
    ) -> HermesChatResult:
        """
        与 Hermes 进行对话（非流式，保留兼容）
        运行步骤：
          1. 输入校验：检查消息是否为空
          2. v2.4.0 新增：coding 模式下检测开发需求，自动路由到 WorkflowEngine
          3. 构建对话命令
          4. 调用 CLI 执行对话
          5. 解析回复内容
          6. 判断是否需要触发优化流程
          7. 若 session_id 存在则持久化 user / assistant 对话
        参数：
          - message: 用户消息文本
          - session_id: 可选会话 ID（存在时落库 conversations 表）
          - session_mode: 可选会话模式（v2.4.0 新增），"chat" 或 "coding"
        返回值：HermesChatResult 对象
        """
        # 输入合法性校验
        if not message or not message.strip():
            return HermesChatResult(
                reply="请描述您的开发需求，我将为您提供帮助。",
            )

        logger.info(
            f"Hermes 收到用户消息，长度: {len(message)} 字符, session_id={session_id or '无'}"
        )

        # v2.7.0 修复：开发需求检测前先检查是否已在 clarifying 阶段，
        # 避免第 2 轮澄清回答被误判为新的开发需求，导致重复启动工作流
        is_clarifying_mode = False
        workflow_id: Optional[str] = None
        if session_id and self.session_factory and self.clarification_service:
            try:
                from ..models import Session as SessionModel
                from sqlalchemy import select
                async with self.session_factory() as db:
                    result = await db.execute(
                        select(SessionModel).where(SessionModel.id == session_id)
                    )
                    session = result.scalar_one_or_none()
                    if session and session.workflow_stage == "clarifying":
                        is_clarifying_mode = True
                        workflow_id = session.workflow_id
            except Exception as e:
                logger.warning(f"查询会话 clarifying 模式失败: {e}")

        # v2.4.0 新增：coding 模式下检测开发需求，自动路由到 WorkflowEngine
        # v2.7.0 修复：若已在 clarifying 阶段，跳过开发需求检测
        if not is_clarifying_mode and session_mode == "coding" and self._is_development_request(message):
            if self.workflow_engine is not None and session_id is not None:
                logger.info(f"检测到开发需求，启动 SOP 工作流: session={session_id[:8]}...")
                try:
                    workflow = await self.workflow_engine.start_workflow(
                        session_id=session_id,
                        user_input=message,
                    )
                    guide_message = (
                        f"已启动 SOP 标准开发流程，进入**需求澄清阶段**。\n\n"
                        f"工作流 ID: `{workflow.id[:8]}...`\n\n"
                        f"请稍候，我将分析您的需求并提出澄清问题..."
                    )
                    return HermesChatResult(
                        reply=guide_message,
                    )
                except Exception as e:
                    logger.error(f"启动工作流失败: {e}")
                    # 失败时降级为普通对话，继续后续流程
            else:
                logger.warning(
                    "coding 模式下检测到开发需求，但 workflow_engine 或 session_id 缺失，"
                    "降级为普通对话"
                )

        # 持久化：先写 user 消息
        await self._persist_chat_pair(
            session_id=session_id,
            user_message=message,
            assistant_text=None,  # 先占位，对话完成后回填
        )

        # 构建 Hermes 对话命令（v2.5.0 传入 session_id 以支持阶段感知 Prompt）
        chat_command = await self._build_chat_command(message, session_id=session_id)

        # 调用 CLI 执行对话
        result: CLIResult = await self.executor.execute(
            command=chat_command,
            timeout=120,
        )

        if not result.success:
            logger.error(f"Hermes 对话执行失败: {result.error_message}")
            # 对话失败时返回兜底回复
            return HermesChatResult(
                reply=f"抱歉，我暂时无法处理您的请求。请稍后重试。\n\n技术细节：{result.error_message}",
            )

        # 解析回复
        reply = result.stdout.strip() if result.stdout else "我已收到您的需求，正在进行分析..."

        # 判断是否包含开发需求关键词，决定是否触发优化
        optimized = self._should_trigger_optimization(message)

        # 持久化：写入 assistant 回复
        await self._persist_chat_pair(
            session_id=session_id,
            user_message=None,
            assistant_text=reply,
        )

        return HermesChatResult(
            reply=reply,
            optimized=optimized,
        )

    async def chat_with_hermes_streaming(
        self,
        message: str,
        hermes_executor,
        session_id: Optional[str] = None,
        session_mode: Optional[str] = None,  # v2.4.0 新增: "chat" | "coding"
    ):
        """
        Hermes 流式对话（异步生成器，含持久化，v2.5.0 支持 clarifying 模式，v2.4.0 支持 WorkflowEngine 自动路由）
        运行步骤：
          1. 输入校验
          2. v2.4.0 新增：coding 模式下检测开发需求，自动路由到 WorkflowEngine 启动 SOP 工作流
          3. 检查是否为 clarifying 模式：若 session 的 workflow_stage == "clarifying"
             且 clarification_service 可用，则走澄清流程：
             a. 调用 clarification_service.handle_user_response() 处理用户回复
             b. 将 ClarifyResult 格式化为 SSE 事件 yield
             c. 结束
          4. 否则走正常流式对话流程：
             a. 若 session_id 存在且 session_factory 已注入：
                创建 user conversation 记录 + 预创建 assistant conversation 记录
             b. 调用 HermesExecutor.chat_streaming() 进行流式对话
             c. 收到 text 事件时：实时 UPDATE assistant.content 追加
             d. 收到 done 事件时：UPDATE assistant.metadata.thinking 与 Session.last_active_at
             e. 将每个事件转换为 SSE 格式 yield 出去
        参数：
          - message: 用户消息文本
          - hermes_executor: HermesExecutor 实例
          - session_id: 可选会话 ID（存在时持久化 user/assistant 对话）
          - session_mode: 可选会话模式（v2.4.0 新增），"chat" 或 "coding"
        Yields: SSE 格式字符串
        修改记录：
          - 2026-06-23 | v1.1.0 | 新增流式对话方法
          - 2026-06-23 | v1.5.0 | 增加 session_id 持久化支持
          - 2026-06-29 | v2.5.0 | 新增 clarifying 模式：当会话处于需求澄清阶段时，
            使用 ClarificationService 处理用户回复并返回结构化 SSE 事件
          - 2026-06-29 | v2.4.0 | 新增 session_mode 参数；coding 模式下检测开发需求
            自动路由到 WorkflowEngine 启动 SOP 工作流
        """
        import json
        import asyncio

        # 输入合法性校验
        if not message or not message.strip():
            yield f"data: {json.dumps({'type': 'error', 'content': '对话消息不能为空'})}\n\n"
            return

        logger.info(
            f"Hermes 流式对话开始，消息长度: {len(message)} 字符, session_id={session_id or '无'}"
        )

        # v2.7.0 修复：开发需求检测前先检查是否已在 clarifying 阶段，
        # 避免第 2 轮澄清回答被误判为新的开发需求，导致重复启动工作流
        is_clarifying_mode = False
        workflow_id: Optional[str] = None
        if session_id and self.session_factory and self.clarification_service:
            try:
                from ..models import Session as SessionModel
                from sqlalchemy import select
                async with self.session_factory() as db:
                    result = await db.execute(
                        select(SessionModel).where(SessionModel.id == session_id)
                    )
                    session = result.scalar_one_or_none()
                    if session and session.workflow_stage == "clarifying":
                        is_clarifying_mode = True
                        workflow_id = session.workflow_id
            except Exception as e:
                logger.warning(f"查询会话 clarifying 模式失败: {e}")

        # v2.4.0 新增：coding 模式下检测开发需求，自动路由到 WorkflowEngine
        # v2.7.0 修复：若已在 clarifying 阶段，跳过开发需求检测
        if not is_clarifying_mode and session_mode == "coding" and self._is_development_request(message):
            if self.workflow_engine is not None and session_id is not None:
                logger.info(f"检测到开发需求，启动 SOP 工作流: session={session_id[:8]}...")
                try:
                    workflow = await self.workflow_engine.start_workflow(
                        session_id=session_id,
                        user_input=message,
                    )
                    # 构造引导消息（v2.7.1 新增 thinking 事件，展示 AI 分析过程）
                    thinking_message = (
                        f"正在分析用户需求，提取关键信息维度（功能目标、硬件平台、技术栈、性能指标等），"
                        f"识别需求中的模糊点与缺失信息，准备生成结构化澄清问题..."
                    )
                    guide_message = (
                        f"已启动 SOP 标准开发流程，进入**需求澄清阶段**。\n\n"
                        f"工作流 ID: `{workflow.id[:8]}...`\n\n"
                        f"我将逐步分析您的需求，识别其中需要明确的关键信息点。"
                        f"请根据下方问题选择或补充信息："
                    )
                    yield f"data: {json.dumps({'type': 'thinking', 'content': thinking_message}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'text', 'content': guide_message}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'workflow_started', 'workflow_id': workflow.id, 'stage': 'clarifying'}, ensure_ascii=False)}\n\n"
                    # v3.3.0 新增：工作流启动后自动创建总架构师和批判反思智能体
                    # 并将智能体 ID 存储到工作流元数据中
                    chief_agent_info = None
                    evaluator_agent_info = None
                    try:
                        chief_agent_info = await self._create_chief_architect()
                        logger.info(f"工作流启动后自动创建总架构师: {chief_agent_info.get('agent_id', '?')[:8]}...")
                    except Exception as create_err:
                        logger.warning(f"自动创建总架构师失败（非阻塞）: {create_err}")
                    try:
                        evaluator_agent_info = await self._create_evaluator()
                        logger.info(f"工作流启动后自动创建批判反思智能体: {evaluator_agent_info.get('agent_id', '?')[:8]}...")
                    except Exception as create_err:
                        logger.warning(f"自动创建批判反思智能体失败（非阻塞）: {create_err}")
                    # 将创建的智能体 ID 存储到工作流元数据（写入 workflow 的 error_message 字段暂存 JSON 元数据）
                    if chief_agent_info or evaluator_agent_info:
                        try:
                            metadata_json = json.dumps({
                                "chief_architect_id": chief_agent_info.get("agent_id") if chief_agent_info else None,
                                "evaluator_id": evaluator_agent_info.get("agent_id") if evaluator_agent_info else None,
                            }, ensure_ascii=False)
                            if self.session_factory:
                                async with self.session_factory() as db:
                                    await db.execute(
                                        text(
                                            "UPDATE workflows SET error_message = "
                                            "CASE WHEN error_message IS NULL OR error_message = '' "
                                            "THEN :meta ELSE error_message END "
                                            "WHERE id = :wid"
                                        ),
                                        {"meta": f"__AGENT_META__:{metadata_json}", "wid": workflow.id},
                                    )
                                    await db.commit()
                                    logger.info(f"智能体元数据已存储到工作流: {workflow.id[:8]}...")
                        except Exception as meta_err:
                            logger.warning(f"存储智能体元数据到工作流失败（非阻塞）: {meta_err}")
                    # v2.6.0 修复：推送首轮澄清问题的结构化 clarify_questions 事件
                    # start_workflow 已将首轮 ClarifyResult 暂存到 workflow._clarify_result
                    clarify_result = getattr(workflow, "_clarify_result", None)
                    if clarify_result is not None:
                        for ev in self._format_clarify_result_for_sse(clarify_result):
                            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                    return
                except Exception as e:
                    logger.error(f"启动工作流失败: {e}")
                    # 失败时输出提示并立即 return，避免 fall-through 到普通对话
                    # （此时 session 可能已切到 clarifying 阶段，fall-through 会让 LLM 用澄清 Prompt 自由回复）
                    yield f"data: {json.dumps({'type': 'text', 'content': f'工作流启动失败: {e}，请重试。'}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                    return
            else:
                logger.warning(
                    "coding 模式下检测到开发需求，但 workflow_engine 或 session_id 缺失，"
                    "降级为普通对话"
                )

        # v2.7.0 重构：clarifying 模式检查已前置到开发需求检测之前，
        # 此处直接复用已查询的 is_clarifying_mode 和 workflow_id
        if is_clarifying_mode:
            logger.info(
                f"会话 {session_id[:8]}... 处于 clarifying 阶段，"
                f"workflow_id={workflow_id[:8] if workflow_id else '无'}，"
                f"切换到澄清模式"
            )

        # v2.5.0 新增：clarifying 模式处理
        if is_clarifying_mode and workflow_id:
            try:
                # 调用 ClarificationService 处理用户回复
                clarify_result = await self.clarification_service.handle_user_response(
                    workflow_id=workflow_id,
                    user_message=message,
                )
                # 将 ClarifyResult 格式化为 SSE 事件并 yield
                events = self._format_clarify_result_for_sse(clarify_result)
                for event in events:
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

                # v3.3.0 新增：阶段分发逻辑
                # 澄清完成后检测当前工作流阶段是否已变更，若变更则自动分派对应智能体
                current_stage_after = None
                if session_id and self.session_factory:
                    try:
                        from sqlalchemy import select
                        from ..models import Session as SessionModel
                        async with self.session_factory() as db:
                            result = await db.execute(
                                select(SessionModel).where(SessionModel.id == session_id)
                            )
                            session = result.scalar_one_or_none()
                            if session:
                                current_stage_after = session.workflow_stage
                    except Exception as se:
                        logger.warning(f"查询阶段变更状态失败: {se}")

                # 若阶段已变更为 designing，自动分派总架构师 + 批判反思智能体
                if current_stage_after and current_stage_after != "clarifying":
                    logger.info(
                        f"阶段已变更: clarifying → {current_stage_after}，"
                        f"自动分派智能体..."
                    )
                    try:
                        dispatch_result = await self.dispatch_by_stage(
                            workflow_id=workflow_id,
                            stage_name=current_stage_after,
                        )
                        yield f"data: {json.dumps({'type': 'stage_dispatch', 'stage': current_stage_after, 'agents': dispatch_result.get('dispatched_agents', []), 'agent_count': dispatch_result.get('agent_count', 0)}, ensure_ascii=False)}\n\n"
                    except Exception as de:
                        logger.warning(f"阶段分发失败（非阻塞）: {de}")

                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return
            except Exception as e:
                logger.error(f"澄清模式处理失败: {e}，降级为正常对话")
                yield f"data: {json.dumps({'type': 'error', 'content': f'澄清处理异常: {str(e)}'})}\n\n"
                return

        # 正常流式对话流程
        assistant_conv_id: Optional[str] = None
        if session_id and self.session_factory:
            assistant_conv_id = await self._setup_streaming_persistence(
                session_id=session_id,
                user_message=message,
            )
        # 保存到实例变量，供后续私有方法访问
        self._streaming_assistant_conv_id = assistant_conv_id
        self._streaming_thinking_parts = []
        self._streaming_text_parts = []

        # 使用队列收集流式事件，实现异步生成器与回调之间的解耦
        queue = asyncio.Queue()

        def on_event(event_type: str, content: str | None):
            """将回调事件放入异步队列"""
            queue.put_nowait((event_type, content))

        # 启动流式对话任务（不等待完成，通过队列异步获取事件）
        # v2.6.0 修复：传入 system_prompt 以触发 -p 模式输出 thinking 标签
        # 通过 _build_chat_command 提取 system prompt（包含阶段感知逻辑）
        try:
            full_chat_command = await self._build_chat_command(message, session_id=session_id)
            # 提取 system prompt 部分（命令格式: -p "{system_prompt}用户消息：\n{message}"）
            import re as _re
            m = _re.match(r'^-p\s+"(.*)用户消息：\\n"\s*$', full_chat_command, flags=_re.DOTALL)
            if m:
                system_prompt_for_stream = m.group(1)
            else:
                # 降级：使用通用 system prompt
                system_prompt_for_stream = (
                    "你是 Hermes，一个智能代码调度助手。请以友好、专业的方式回复用户。"
                    "回复应简洁明了，使用中文。"
                )
            # 长度截断（避免 CLI 处理过慢）
            MAX_PROMPT_LEN = 1500
            if len(system_prompt_for_stream) > MAX_PROMPT_LEN:
                system_prompt_for_stream = system_prompt_for_stream[:MAX_PROMPT_LEN] + "..."
                logger.info(f"system_prompt 截断到 {MAX_PROMPT_LEN} 字符")
        except Exception as e:
            logger.warning(f"构建 system_prompt 失败: {e}，降级为空")
            system_prompt_for_stream = ""

        task = asyncio.create_task(
            hermes_executor.chat_streaming(
                message=message,
                system_prompt=system_prompt_for_stream or None,
                timeout=300,  # 延长到 5 分钟
                stream_callback=on_event,
            )
        )

        # 从队列中读取事件并转换为 SSE 格式 yield 出去
        try:
            while True:
                try:
                    event_type, content = await asyncio.wait_for(queue.get(), timeout=600)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'error', 'content': '对话超时'})}\n\n"
                    break

                if event_type == "done":
                    # 流结束：收尾持久化（写 thinking、更新会话活跃度）
                    if session_id and self.session_factory and assistant_conv_id:
                        await self._finalize_streaming_persistence(
                            session_id=session_id,
                            conv_id=assistant_conv_id,
                        )

                    # done 事件：仅通知前端流式结束，不携带 title 字段
                    # （撤销 auto-session-title-generation spec，不再在 done 阶段触发 AI 自动命名）
                    yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                    break
                elif event_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': content or '未知错误'})}\n\n"
                    break
                elif event_type == "thinking":
                    # 累计 thinking 片段（暂不实时落库，done 时统一写 metadata）
                    if content:
                        self._streaming_thinking_parts.append(content)
                    yield f"data: {json.dumps({'type': event_type, 'content': content})}\n\n"
                elif event_type == "text":
                    # 累计 text 片段，实时追加到 assistant content
                    if content:
                        self._streaming_text_parts.append(content)
                        if session_id and self.session_factory and assistant_conv_id:
                            await self._append_text_to_conversation(
                                conv_id=assistant_conv_id,
                                text_chunk=content,
                            )
                    yield f"data: {json.dumps({'type': event_type, 'content': content})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': event_type, 'content': content})}\n\n"
        finally:
            # 清理实例变量
            self._streaming_assistant_conv_id = None
            self._streaming_thinking_parts = []
            self._streaming_text_parts = []

        # 等待流式对话任务完成
        await task

    async def optimize_and_plan(
        self, raw_prompt: str, session_id: Optional[str] = None
    ) -> HermesOptimizeResult:
        """
        优化提示词并制定任务计划
        运行步骤：
          1. 输入校验
          2. 调用 CLI 进行提示词优化
          3. 解析优化结果（任务模块、约束条件）
          4. 自动创建 CLI 实例用于任务规划（同时持久化到 ORM Agent 表，session_id 关联）
          5. 调用 CLI 实例生成计划.md
          6. 返回优化结果和计划内容
        参数：
          - raw_prompt: 用户原始需求文本
          - session_id: 可选会话 ID（用于将规划用 Agent 归属到该会话）
        返回值：HermesOptimizeResult 对象
        """
        # 输入合法性校验
        if not raw_prompt or not raw_prompt.strip():
            return HermesOptimizeResult(
                original=raw_prompt,
                error_message="需求文本不能为空",
            )

        logger.info(
            f"Hermes 开始优化提示词，原始需求长度: {len(raw_prompt)} 字符, session_id={session_id or '无'}"
        )

        # 步骤 1: 提示词优化
        optimize_command = self._build_optimize_command(raw_prompt)
        opt_result: CLIResult = await self.executor.execute(
            command=optimize_command,
            timeout=180,
        )

        if not opt_result.success:
            logger.error(f"提示词优化失败: {opt_result.error_message}")
            return HermesOptimizeResult(
                original=raw_prompt,
                error_message=f"优化执行失败: {opt_result.error_message}",
            )

        # 解析优化结果
        optimized_text = opt_result.stdout
        task_modules, constraints = self._parse_optimization_modules(opt_result.stdout)

        # 步骤 2: 自动创建 CLI 实例进行任务规划
        agent = await self.agent_manager.register_agent(
            name=f"hermes-planner-{uuid.uuid4().hex[:6]}",
            cli_path=self.executor.executable,
            workspace="",
            max_concurrent=1,
        )
        logger.info(f"已创建规划用 CLI 实例: {agent.name} (ID: {agent.id[:8]}...)")

        # 持久化规划用 Agent 到 ORM（带 session_id）
        if session_id and self.session_factory:
            await self._persist_agent(
                agent_id=agent.id,
                name=agent.name,
                avatar_seed=agent.avatar_seed or agent.id[:8],
                status=str(agent.status.value) if hasattr(agent.status, "value") else str(agent.status),
                cli_path=agent.cli_path or "claude",
                workspace=agent.workspace or "",
                max_concurrent=agent.max_concurrent or 1,
                session_id=session_id,
            )

        # 步骤 3: 调用 CLI 实例生成计划.md
        plan_command = self._build_plan_command(optimized_text)
        plan_result: CLIResult = await self.executor.execute(
            command=plan_command,
            timeout=300,
        )

        plan_content = ""
        if plan_result.success:
            plan_content = plan_result.stdout
            logger.info(f"任务规划完成，计划内容长度: {len(plan_content)} 字符")
        else:
            logger.warning(f"任务规划部分失败: {plan_result.error_message}")
            plan_content = f"## 任务执行计划\n\n优化后的需求：\n\n{optimized_text}\n\n（自动规划未完全成功，请手动确认）"

        return HermesOptimizeResult(
            original=raw_prompt,
            optimized=optimized_text,
            task_modules=task_modules,
            constraints=constraints,
            plan_content=plan_content,
            agent_created=True,
            agent_id=agent.id,
            success=True,
        )

    async def confirm_and_execute(
        self, plan_content: str, session_id: Optional[str] = None
    ) -> HermesConfirmResult:
        """
        确认计划并按模块分发执行
        运行步骤：
          1. 解析计划内容，提取任务模块
          2. 为每个模块创建独立的 CLI 实例（同时持久化 Agent + Task 到 ORM，带 session_id）
          3. 将任务分发给对应实例
          4. 返回执行结果摘要
        参数：
          - plan_content: 计划文档内容（Markdown 格式）
          - session_id: 可选会话 ID（持久化 Agent / Task 归属）
        返回值：HermesConfirmResult 对象
        """
        if not plan_content or not plan_content.strip():
            return HermesConfirmResult(
                message="计划内容不能为空",
            )

        logger.info(
            f"Hermes 开始确认执行计划，内容长度: {len(plan_content)} 字符, session_id={session_id or '无'}"
        )

        # 解析计划中的任务模块
        modules = self._parse_plan_modules(plan_content)

        if not modules:
            # 如果没有解析出模块，创建一个默认模块
            modules = [{"title": "默认任务", "description": plan_content[:200]}]

        logger.info(f"解析出 {len(modules)} 个任务模块")

        # 为每个模块创建 CLI 实例并分发任务
        agents_created = 0
        for module in modules:
            # 创建独立的 CLI 子实例
            agent = await self.agent_manager.register_agent(
                name=f"hermes-worker-{module['title'][:20]}-{uuid.uuid4().hex[:4]}",
                cli_path=self.executor.executable,
                workspace="",
                max_concurrent=1,
            )
            agents_created += 1
            logger.info(f"为模块 '{module['title']}' 创建 CLI 实例: {agent.name}")

            # 持久化 Agent 到 ORM
            persisted_task_id: Optional[str] = None
            if session_id and self.session_factory:
                persisted_task_id = await self._persist_agent(
                    agent_id=agent.id,
                    name=agent.name,
                    avatar_seed=agent.avatar_seed or agent.id[:8],
                    status=str(agent.status.value) if hasattr(agent.status, "value") else str(agent.status),
                    cli_path=agent.cli_path or "claude",
                    workspace=agent.workspace or "",
                    max_concurrent=agent.max_concurrent or 1,
                    session_id=session_id,
                )
                # 持久化 Task 到 ORM（归属于该 session / agent）
                await self._persist_task(
                    title=module.get("title") or "未命名任务",
                    description=module.get("description") or "",
                    agent_id=agent.id,
                    session_id=session_id,
                )

        return HermesConfirmResult(
            success=True,
            tasks_created=len(modules),
            agents_created=agents_created,
            message=f"已按计划创建 {agents_created} 个 CLI 实例，分发 {len(modules)} 个任务模块执行",
        )

    # ============================================================
    # 私有辅助方法 - 持久化
    # ============================================================

    async def _setup_streaming_persistence(
        self, session_id: str, user_message: str
    ) -> Optional[str]:
        """
        流式对话开始前创建 user 消息与空 assistant 消息
        运行步骤：
          1. 开启数据库会话
          2. INSERT user conversation 记录
          3. INSERT 空 assistant conversation 记录
          4. 提交并返回 assistant conv_id
        参数：
          - session_id: 会话 ID
          - user_message: 用户消息文本
        返回值：assistant conv_id（创建失败时返回 None）
        """
        from ..models import Conversation, Session as SessionModel, SessionStatus  # 延迟导入

        if not self.session_factory:
            return None

        assistant_id = str(uuid.uuid4())
        try:
            async with self.session_factory() as db:
                # 创建 user 消息
                user_conv = Conversation(
                    id=str(uuid.uuid4()),
                    session_id=session_id,
                    role="user",
                    content=user_message,
                    extra_data={"source": "hermes_streaming"},
                )
                db.add(user_conv)

                # 创建空 assistant 消息（流式追加）
                assistant_conv = Conversation(
                    id=assistant_id,
                    session_id=session_id,
                    role="assistant",
                    content="",
                    extra_data={"source": "hermes_streaming", "thinking": ""},
                )
                db.add(assistant_conv)

                # 维护 Session 的最后活跃时间与消息数
                s_result = await db.execute(
                    text("UPDATE sessions SET last_active_at = :ts, "
                         "message_count = COALESCE(message_count, 0) + 2 "
                         "WHERE id = :sid"),
                    {"ts": datetime.now(timezone.utc), "sid": session_id},
                )
                await db.commit()
                return assistant_id
        except Exception as e:
            logger.error(f"流式对话持久化 setup 失败: {e}（不影响对话继续）")
            return None

    async def _append_text_to_conversation(self, conv_id: str, text_chunk: str) -> None:
        """
        实时追加 text 片段到指定 conversation.content
        使用 SQL `||` 字符串拼接运算符（兼容 SQLite / PostgreSQL）
        参数：
          - conv_id: conversation 记录 ID
          - text_chunk: 待追加的 text 片段
        """
        if not self.session_factory or not text_chunk:
            return
        try:
            async with self.session_factory() as db:
                await db.execute(
                    text("UPDATE conversations SET content = content || :chunk WHERE id = :id"),
                    {"chunk": text_chunk, "id": conv_id},
                )
                await db.commit()
        except Exception as e:
            logger.error(f"追加 text 片段到 conversation 失败: {e}")

    async def _finalize_streaming_persistence(
        self, session_id: str, conv_id: str
    ) -> None:
        """
        流式结束时的收尾持久化：把累计的 thinking 写入 metadata.thinking
        参数：
          - session_id: 会话 ID
          - conv_id: assistant conversation ID
        """
        if not self.session_factory:
            return
        thinking = "".join(self._streaming_thinking_parts or [])
        try:
            async with self.session_factory() as db:
                # 用 JSON 表达式更新 metadata 字段（SQLite 通过 json_extract / json_set 支持）
                # 兼容性最好做法：读出现有 metadata，合并后写回
                result = await db.execute(
                    text("SELECT metadata FROM conversations WHERE id = :id"),
                    {"id": conv_id},
                )
                row = result.first()
                metadata = {}
                if row and row[0]:
                    try:
                        import json
                        metadata = json.loads(row[0]) if isinstance(row[0], str) else dict(row[0])
                    except Exception:
                        metadata = {}
                metadata["thinking"] = thinking
                metadata["stream_completed"] = True
                import json
                await db.execute(
                    text("UPDATE conversations SET metadata = :meta WHERE id = :id"),
                    {"meta": json.dumps(metadata, ensure_ascii=False), "id": conv_id},
                )
                # 再次刷新 Session 活跃时间
                await db.execute(
                    text("UPDATE sessions SET last_active_at = :ts WHERE id = :sid"),
                    {"ts": datetime.now(timezone.utc), "sid": session_id},
                )
                await db.commit()
        except Exception as e:
            logger.error(f"流式对话收尾持久化失败: {e}")

    async def _persist_chat_pair(
        self,
        session_id: Optional[str],
        user_message: Optional[str] = None,
        assistant_text: Optional[str] = None,
    ) -> None:
        """
        通用持久化辅助：写入 user 消息或 assistant 消息（chat_with_hermes 用）
        至少需要传入 user_message 或 assistant_text 其一
        参数：
          - session_id: 会话 ID（缺失时跳过持久化）
          - user_message: 用户消息文本
          - assistant_text: assistant 回复文本
        """
        if not session_id or not self.session_factory:
            return
        if not user_message and not assistant_text:
            return
        try:
            from ..models import Conversation  # 延迟导入
            async with self.session_factory() as db:
                if user_message is not None:
                    db.add(Conversation(
                        id=str(uuid.uuid4()),
                        session_id=session_id,
                        role="user",
                        content=user_message,
                        extra_data={"source": "hermes_chat"},
                    ))
                if assistant_text is not None:
                    db.add(Conversation(
                        id=str(uuid.uuid4()),
                        session_id=session_id,
                        role="assistant",
                        content=assistant_text,
                        extra_data={"source": "hermes_chat"},
                    ))
                # 维护 Session 活跃度
                delta = (1 if user_message else 0) + (1 if assistant_text else 0)
                await db.execute(
                    text("UPDATE sessions SET last_active_at = :ts, "
                         "message_count = COALESCE(message_count, 0) + :delta "
                         "WHERE id = :sid"),
                    {"ts": datetime.now(timezone.utc), "delta": delta, "sid": session_id},
                )
                await db.commit()
        except Exception as e:
            logger.error(f"非流式对话持久化失败: {e}（不影响对话继续）")

    async def _persist_agent(
        self,
        agent_id: str,
        name: str,
        avatar_seed: str,
        status: str,
        cli_path: str,
        workspace: str,
        max_concurrent: int,
        session_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        持久化 Agent 到 ORM agents 表
        参数：
          - agent_id: 智能体 ID
          - name: 名称
          - avatar_seed: 头像种子
          - status: 状态字符串
          - cli_path / workspace / max_concurrent: 其它元数据
          - session_id: 可选会话 ID（归属）
        返回值：agent_id（创建失败时返回 None）
        """
        if not self.session_factory:
            return None
        try:
            from ..models import Agent as AgentORM, AgentStatus  # 延迟导入
            async with self.session_factory() as db:
                # 若已存在则更新 session_id，避免重复插入触发主键冲突
                existing = await db.execute(
                    text("SELECT id FROM agents WHERE id = :id"), {"id": agent_id}
                )
                if existing.first() is not None:
                    await db.execute(
                        text("UPDATE agents SET session_id = :sid, updated_at = :ts WHERE id = :id"),
                        {"sid": session_id, "ts": datetime.now(timezone.utc), "id": agent_id},
                    )
                else:
                    try:
                        agent_status = AgentStatus(status) if status else AgentStatus.OFFLINE
                    except ValueError:
                        agent_status = AgentStatus.OFFLINE
                    agent_orm = AgentORM(
                        id=agent_id,
                        name=name,
                        avatar_seed=avatar_seed or agent_id[:8],
                        status=agent_status,
                        cli_path=cli_path or "claude",
                        workspace=workspace or "",
                        max_concurrent=max_concurrent or 1,
                        session_id=session_id,
                    )
                    db.add(agent_orm)
                # 维护 Session 活跃度
                if session_id:
                    await db.execute(
                        text("UPDATE sessions SET last_active_at = :ts WHERE id = :sid"),
                        {"ts": datetime.now(timezone.utc), "sid": session_id},
                    )
                await db.commit()
                return agent_id
        except Exception as e:
            logger.error(f"持久化 Agent 失败: {e}（不影响主流程）")
            return None

    async def _persist_task(
        self,
        title: str,
        description: str,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        optimized_prompt: str = "",
    ) -> Optional[str]:
        """
        持久化 Task 到 ORM tasks 表
        参数：
          - title: 任务标题
          - description: 任务描述
          - agent_id: 分配的智能体 ID（可选）
          - session_id: 会话 ID（归属）
          - optimized_prompt: 优化后的提示词（可选）
        返回值：task_id（创建失败时返回 None）
        """
        if not self.session_factory:
            return None
        try:
            from ..models import Task as TaskORM, TaskStatus, TaskPriority, ExecutionMode  # 延迟导入
            async with self.session_factory() as db:
                task_orm = TaskORM(
                    id=str(uuid.uuid4()),
                    title=title,
                    description=description or "",
                    original_prompt=description or "",
                    optimized_prompt=optimized_prompt or "",
                    status=TaskStatus.PENDING,
                    priority=TaskPriority.MEDIUM,
                    execution_mode=ExecutionMode.DIRECT,
                    agent_id=agent_id,
                    session_id=session_id,
                )
                db.add(task_orm)
                if session_id:
                    await db.execute(
                        text("UPDATE sessions SET last_active_at = :ts WHERE id = :sid"),
                        {"ts": datetime.now(timezone.utc), "sid": session_id},
                    )
                await db.commit()
                await db.refresh(task_orm)
                return task_orm.id
        except Exception as e:
            logger.error(f"持久化 Task 失败: {e}（不影响主流程）")
            return None

    # ============================================================
    # 私有辅助方法 - CLI 命令构建与解析
    # ============================================================

    def _format_clarify_result_for_sse(self, result) -> List[Dict]:
        """
        将 ClarifyResult 格式化为 SSE 事件列表（v2.6.0 新增结构化 clarify_questions 事件）
        作用：在 clarifying 模式下，将 ClarificationService 返回的结构化
              澄清结果转换为前端可消费的 SSE 事件序列
        运行步骤：
          1. 先发送 summary（AI 的理解总结）作为 text 事件
          2. 发送结构化 clarify_questions 事件（含 options，供交互式选择卡片消费）
          3. 同时发送 Markdown 文本作为降级兼容（前端旧逻辑仍可解析）
          4. 若澄清完成，发送 clarify_complete 事件
        参数：
          - result: ClarifyResult 对象（来自 ClarificationService）
        返回值：List[Dict]，SSE 事件列表
        """
        events: List[Dict] = []
        # 步骤 1：先发送 thinking 事件（AI 的分析/思考过程），再发送 text 事件
        if result.summary:
            events.append({"type": "thinking", "content": result.summary})
            events.append({"type": "text", "content": result.summary + "\n\n"})
        # 步骤 2 & 3：发送澄清问题（结构化事件 + Markdown 降级文本）
        # v2.9.0 修复：澄清完成时即使 questions 为空也发送 clarify_questions 事件，
        # 确保前端能收到 completion 信号并展示"确认需求文档"按钮
        if result.questions or result.clarification_complete:
            structured_questions: List[Dict] = []
            # v2.10.1 修复：完成时不再显示空"需要您补充以下信息"标题
            if result.clarification_complete and not result.questions:
                questions_text = ""
            else:
                questions_text = "### 需要您补充以下信息：\n\n"
            for q in result.questions:
                # q 可能是 ClarificationQuestion 对象或 Dict
                if hasattr(q, 'dimension'):
                    dim = q.dimension
                    question = q.question
                    importance = q.importance
                    options = list(getattr(q, 'options', []) or [])
                    allow_multiple = bool(getattr(q, 'allow_multiple', False))
                else:
                    dim = q.get('dimension', '')
                    question = q.get('question', '')
                    importance = q.get('importance', '')
                    options = list(q.get('options', []) or [])
                    allow_multiple = bool(q.get('allow_multiple', False))
                structured_questions.append({
                    "dimension": dim,
                    "question": question,
                    "importance": importance,
                    "options": options,
                    "allow_multiple": allow_multiple,
                })
                questions_text += f"- **【{dim}】** {question}（重要性：{importance}）\n"
            # 结构化事件：前端优先消费，渲染为可选项卡片
            events.append({
                "type": "clarify_questions",
                "questions": structured_questions,
                "complete": bool(result.clarification_complete),
                "summary": result.summary or "",
                "round": getattr(result, 'round_number', 1),
                "maxRounds": getattr(result, 'max_rounds', 5),
            })
            # Markdown 降级文本：兼容旧前端逻辑
            if questions_text.strip():
                events.append({"type": "text", "content": questions_text})
        # v3.1.2 修复：未完成但无问题时，生成兜底问题
        elif not result.clarification_complete:
            fallback_questions = [{
                "dimension": "流程控制",
                "question": "需求文档中仍存在不确定项，请逐项确认或补充信息。您也可以选择跳过不确定项直接进入架构设计。",
                "importance": "high",
                "options": ["继续补充不确定项", "跳过不确定项，进入架构设计"],
                "allow_multiple": False,
            }]
            events.append({
                "type": "clarify_questions",
                "questions": fallback_questions,
                "complete": False,
                "summary": result.summary or "",
                "round": getattr(result, 'round_number', 1),
                "maxRounds": getattr(result, 'max_rounds', 5),
            })
        # 步骤 4：若澄清完成，发送 clarify_complete 事件
        if result.clarification_complete:
            events.append({"type": "clarify_complete", "content": "需求澄清已完成"})
        return events

    async def _build_chat_command(self, message: str, session_id: str = None) -> str:
        """
        构建 Hermes 对话 CLI 命令（v2.5.0 支持阶段感知 Prompt 切换）
        运行步骤：
          1. 若 session_id 不为空，查询 Session 的 workflow_stage
          2. 若 workflow_stage == "clarifying"，使用 REQUIREMENT_CLARIFIER_SYSTEM_PROMPT
          3. 否则使用原有通用 prompt
          4. 在 system prompt 前加上"请用中文回复。\n\n"
        参数：
          - message: 用户消息
          - session_id: 可选会话 ID（用于查询当前工作流阶段）
        返回值：CLI 命令字符串
        """
        # 步骤 1 & 2：查询当前工作流阶段，决定使用哪个 system prompt
        system_prompt = "你是 Hermes，一个智能代码调度助手。请以友好、专业的方式回复用户。"
        system_prompt += "如果用户提出了开发需求，请先确认理解需求，然后说明你将如何进行提示词优化和任务规划。"
        system_prompt += "回复应简洁明了，使用中文。\n\n"

        if session_id and self.session_factory:
            try:
                from sqlalchemy import select
                from ..models import Session as SessionModel
                async with self.session_factory() as db:
                    result = await db.execute(
                        select(SessionModel).where(SessionModel.id == session_id)
                    )
                    session = result.scalar_one_or_none()
                    if session and session.workflow_stage == "clarifying":
                        # v2.5.0 新增：clarifying 阶段使用需求澄清智能体的 system prompt
                        from .agent_roles.requirement_clarifier import REQUIREMENT_CLARIFIER_SYSTEM_PROMPT
                        system_prompt = "请用中文回复。\n\n" + REQUIREMENT_CLARIFIER_SYSTEM_PROMPT
                        logger.info(f"会话 {session_id[:8]}... 处于 clarifying 阶段，已切换为需求澄清 Prompt")
            except Exception as e:
                # 查询失败时降级使用默认 prompt，不影响对话
                logger.warning(f"查询会话工作流阶段失败: {e}，使用默认 Prompt")

        # 转义双引号、反引号和 $ 符号，防止 shell 命令替换注入
        safe_message = message.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        command = f'-p "{system_prompt}用户消息：\n{safe_message}"'
        return command

    def _should_trigger_optimization(self, message: str) -> bool:
        """
        判断用户消息是否应触发提示词优化
        参数：
          - message: 用户消息
        返回值：是否触发优化
        """
        # 开发需求关键词列表
        dev_keywords = [
            "开发", "实现", "创建", "编写", "修改", "重构",
            "修复", "优化", "添加", "新增", "设计", "构建",
            "代码", "功能", "模块", "接口", "API", "组件",
            "前端", "后端", "数据库", "部署", "配置",
        ]
        message_lower = message.lower()
        return any(kw in message_lower for kw in dev_keywords)

    def _build_optimize_command(self, raw_prompt: str) -> str:
        """
        构建提示词优化 CLI 命令
        参数：
          - raw_prompt: 原始需求
        返回值：CLI 命令字符串
        """
        # 转义双引号、反引号和 $ 符号，防止 shell 命令替换注入
        safe_prompt = raw_prompt.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        command = (
            f'-p "你是一个专业的提示词工程优化专家。请对以下用户需求进行优化，'
            f'将其转化为结构化、高质量的任务指令。\n\n'
            f'原始需求：\n{safe_prompt}\n\n'
            f'请按以下格式输出优化结果：\n'
            f'## 优化后的任务指令\n'
            f'[将原始需求转化为清晰、具体、可执行的结构化指令]\n\n'
            f'## 任务模块分解\n'
            f'- 模块1: [名称] - [简要描述]\n'
            f'- 模块2: [名称] - [简要描述]\n'
            f'...\n\n'
            f'## 约束条件\n'
            f'- [约束1]\n'
            f'- [约束2]\n'
            f'...\n\n'
            f'## 技术建议\n'
            f'[提供技术栈、架构方面的建议]"'
        )
        return command

    def _parse_optimization_modules(self, output: str):
        """
        解析优化输出中的任务模块和约束条件
        参数：
          - output: CLI 优化输出
        返回值：(task_modules: List[str], constraints: List[str])
        """
        task_modules: List[str] = []
        constraints: List[str] = []

        in_modules_section = False
        in_constraints_section = False

        for line in output.split("\n"):
            line_stripped = line.strip()

            if "任务模块分解" in line_stripped or "任务模块" in line_stripped:
                in_modules_section = True
                in_constraints_section = False
                continue
            if "约束条件" in line_stripped:
                in_constraints_section = True
                in_modules_section = False
                continue
            if line_stripped.startswith("##") and "优化后的任务指令" not in line_stripped:
                in_modules_section = False
                in_constraints_section = False
                continue

            if in_modules_section and line_stripped.startswith("-"):
                module = line_stripped.lstrip("- ").strip()
                if module:
                    task_modules.append(module)

            if in_constraints_section and line_stripped.startswith("-"):
                constraint = line_stripped.lstrip("- ").strip()
                if constraint:
                    constraints.append(constraint)

        return task_modules, constraints

    def _build_plan_command(self, optimized_prompt: str) -> str:
        """
        构建任务规划 CLI 命令
        参数：
          - optimized_prompt: 优化后的提示词
        返回值：CLI 命令字符串
        """
        # 转义双引号、反引号和 $ 符号，防止 shell 命令替换注入
        safe_prompt = optimized_prompt.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        command = (
            f'-p "你是一个专业的任务规划专家。请基于以下优化后的需求，'
            f'制定详细的任务分解计划，输出为 Markdown 格式的计划文档。\n\n'
            f'优化后的需求：\n{safe_prompt}\n\n'
            f'请按以下 Markdown 格式输出计划.md 文档：\n'
            f'# 任务执行计划\n\n'
            f'## 概述\n'
            f'[简要描述项目目标和整体方案]\n\n'
            f'## 任务模块\n\n'
            f'### 模块1: [模块名称]\n'
            f'- **描述**: [详细描述]\n'
            f'- **优先级**: high/medium/low\n'
            f'- **依赖**: [依赖的模块编号，无则写"无"]\n'
            f'- **预估复杂度**: [0.0-1.0]\n'
            f'- **预估耗时**: [预估时间]\n\n'
            f'### 模块2: [模块名称]\n'
            f'...\n\n'
            f'## 执行顺序\n'
            f'[按依赖关系排列的执行顺序]\n\n'
            f'## 技术栈\n'
            f'[推荐的技术栈和工具]\n\n'
            f'## 风险提示\n'
            f'[可能的风险点和注意事项]\n\n'
            f'## 验收标准\n'
            f'[每个模块的验收标准]"'
        )
        return command

    def _parse_plan_modules(self, plan_content: str) -> List[dict]:
        """
        解析计划内容中的任务模块
        运行步骤：
          1. 按 "### 模块" 标记分割
          2. 提取每个模块的标题和描述
        参数：
          - plan_content: Markdown 格式的计划内容
        返回值：模块信息列表 [{"title": str, "description": str}, ...]
        """
        modules: List[dict] = []
        current_module: Optional[dict] = None

        for line in plan_content.split("\n"):
            line_stripped = line.strip()

            # 检测模块标题（### 模块N: 或 ### 任务N:）
            if line_stripped.startswith("### 模块") or line_stripped.startswith("### 任务"):
                if current_module:
                    modules.append(current_module)

                # 提取标题
                title = line_stripped.lstrip("# ").strip()
                # 去掉 "模块N: " 或 "任务N: " 前缀
                if ":" in title:
                    title = title.split(":", 1)[1].strip()
                current_module = {"title": title, "description": ""}
                continue

            if current_module is None:
                continue

            # 提取描述
            if "描述" in line_stripped or "**描述**" in line_stripped:
                desc = line_stripped.split(":", 1)[-1].strip().lstrip("* ").strip()
                current_module["description"] = desc

        # 添加最后一个模块
        if current_module:
            modules.append(current_module)

        return modules

    # ============================================================
    # v3.3.0 新增：智能体创建与阶段分发方法
    # ============================================================

    async def _create_chief_architect(self) -> Dict:
        """
        创建总架构师智能体（v3.3.0 新增）
        作用：创建 ChiefArchitect 实例，注册为 AgentManager 中的智能体，
              持久化到数据库，返回智能体信息
        运行步骤：
          1. 创建 ChiefArchitect 实例（以 self 作为 hermes_service）
          2. 在 AgentManager 中注册为独立智能体
          3. 若 session_factory 可用，持久化到 agents 表
          4. 返回智能体信息字典
        参数：无（使用 self 引用）
        返回值：Dict，包含 agent_id、name、role 等智能体信息
        """
        # 步骤 1：创建 ChiefArchitect 实例
        chief = ChiefArchitect(self)
        logger.info("总架构师实例已创建")

        # 步骤 2：注册到 AgentManager
        agent = await self.agent_manager.register_agent(
            name="总架构师",
            cli_path=self.executor.executable,
            workspace="",
            max_concurrent=1,
        )
        logger.info(f"总架构师已注册到 AgentManager: {agent.id[:8]}...")

        # 步骤 3：持久化到数据库
        if self.session_factory:
            await self._persist_agent(
                agent_id=agent.id,
                name=agent.name,
                avatar_seed=agent.avatar_seed or agent.id[:8],
                status=str(agent.status.value) if hasattr(agent.status, "value") else str(agent.status),
                cli_path=agent.cli_path or "claude",
                workspace=agent.workspace or "",
                max_concurrent=agent.max_concurrent or 1,
            )

        # 步骤 4：返回智能体信息
        return {
            "agent_id": agent.id,
            "name": agent.name,
            "role": "ChiefArchitect",
            "status": "online",
            "created_at": agent.created_at.isoformat() if hasattr(agent, "created_at") and agent.created_at else None,
        }

    async def _create_evaluator(self) -> Dict:
        """
        创建批判反思智能体（v3.3.0 新增）
        作用：创建 CriticalReviewer 实例（复用已有类），注册为 AgentManager 中的智能体，
              持久化到数据库，返回智能体信息
        运行步骤：
          1. 创建 CriticalReviewer 实例（以 self 作为 hermes_service）
          2. 在 AgentManager 中注册为独立智能体
          3. 若 session_factory 可用，持久化到 agents 表
          4. 返回智能体信息字典
        参数：无（使用 self 引用）
        返回值：Dict，包含 agent_id、name、role 等智能体信息
        """
        # 步骤 1：创建 CriticalReviewer 实例（复用已有类）
        reviewer = CriticalReviewer(self)
        logger.info("批判反思智能体实例已创建")

        # 步骤 2：注册到 AgentManager
        agent = await self.agent_manager.register_agent(
            name="批判反思智能体",
            cli_path=self.executor.executable,
            workspace="",
            max_concurrent=1,
        )
        logger.info(f"批判反思智能体已注册到 AgentManager: {agent.id[:8]}...")

        # 步骤 3：持久化到数据库
        if self.session_factory:
            await self._persist_agent(
                agent_id=agent.id,
                name=agent.name,
                avatar_seed=agent.avatar_seed or agent.id[:8],
                status=str(agent.status.value) if hasattr(agent.status, "value") else str(agent.status),
                cli_path=agent.cli_path or "claude",
                workspace=agent.workspace or "",
                max_concurrent=agent.max_concurrent or 1,
            )

        # 步骤 4：返回智能体信息
        return {
            "agent_id": agent.id,
            "name": agent.name,
            "role": "CriticalReviewer",
            "status": "online",
            "created_at": agent.created_at.isoformat() if hasattr(agent, "created_at") and agent.created_at else None,
        }

    async def dispatch_by_stage(
        self, workflow_id: str, stage_name: str
    ) -> Dict:
        """
        按工作流阶段分派智能体（v3.3.0 新增）
        作用：根据当前工作流阶段，激活对应的智能体角色，返回分派结果
        调用方：chat_with_hermes_streaming()（阶段变更时自动调用）
        被调用方：AgentManager、各智能体角色类
        运行步骤：
          1. 根据 stage_name 确定需要激活的智能体角色
          2. 为每个角色创建实例并注册到 AgentManager
          3. 持久化到数据库
          4. 返回分派结果（包含各智能体信息）
        参数：
          - workflow_id: 工作流 ID
          - stage_name: 阶段名称（clarifying/designing/prompting/executing/reviewing）
        返回值：Dict，包含 dispatched_agents 列表和 stage_name
        """
        dispatched_agents: List[Dict] = []

        # clarifying 阶段：激活需求澄清智能体
        if stage_name == "clarifying":
            try:
                clarifier = RequirementClarifier(self)
                agent = await self.agent_manager.register_agent(
                    name="需求澄清智能体",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=agent.id,
                        name=agent.name,
                        avatar_seed=agent.avatar_seed or agent.id[:8],
                        status=str(agent.status.value) if hasattr(agent.status, "value") else str(agent.status),
                        cli_path=agent.cli_path or "claude",
                        workspace=agent.workspace or "",
                        max_concurrent=agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": agent.id,
                    "name": agent.name,
                    "role": "RequirementClarifier",
                })
                logger.info(f"clarifying 阶段：已分派需求澄清智能体 {agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派需求澄清智能体失败: {e}")

        # designing 阶段：激活总架构师 + 批判反思智能体 + 质量保障智能体
        elif stage_name == "designing":
            # 总架构师
            try:
                chief = ChiefArchitect(self)
                chief_agent = await self.agent_manager.register_agent(
                    name="总架构师",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=chief_agent.id,
                        name=chief_agent.name,
                        avatar_seed=chief_agent.avatar_seed or chief_agent.id[:8],
                        status=str(chief_agent.status.value) if hasattr(chief_agent.status, "value") else str(chief_agent.status),
                        cli_path=chief_agent.cli_path or "claude",
                        workspace=chief_agent.workspace or "",
                        max_concurrent=chief_agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": chief_agent.id,
                    "name": chief_agent.name,
                    "role": "ChiefArchitect",
                })
                logger.info(f"designing 阶段：已分派总架构师 {chief_agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派总架构师失败: {e}")

            # 批判反思智能体
            try:
                reviewer = CriticalReviewer(self)
                reviewer_agent = await self.agent_manager.register_agent(
                    name="批判反思智能体",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=reviewer_agent.id,
                        name=reviewer_agent.name,
                        avatar_seed=reviewer_agent.avatar_seed or reviewer_agent.id[:8],
                        status=str(reviewer_agent.status.value) if hasattr(reviewer_agent.status, "value") else str(reviewer_agent.status),
                        cli_path=reviewer_agent.cli_path or "claude",
                        workspace=reviewer_agent.workspace or "",
                        max_concurrent=reviewer_agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": reviewer_agent.id,
                    "name": reviewer_agent.name,
                    "role": "CriticalReviewer",
                })
                logger.info(f"designing 阶段：已分派批判反思智能体 {reviewer_agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派批判反思智能体失败: {e}")

            # 质量保障智能体
            try:
                qm = QualityManager(self)
                qm_agent = await self.agent_manager.register_agent(
                    name="质量保障智能体",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=qm_agent.id,
                        name=qm_agent.name,
                        avatar_seed=qm_agent.avatar_seed or qm_agent.id[:8],
                        status=str(qm_agent.status.value) if hasattr(qm_agent.status, "value") else str(qm_agent.status),
                        cli_path=qm_agent.cli_path or "claude",
                        workspace=qm_agent.workspace or "",
                        max_concurrent=qm_agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": qm_agent.id,
                    "name": qm_agent.name,
                    "role": "QualityManager",
                })
                logger.info(f"designing 阶段：已分派质量保障智能体 {qm_agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派质量保障智能体失败: {e}")

        # prompting 阶段：激活提示词工程智能体（每个模块一个实例）
        elif stage_name == "prompting":
            try:
                # 尝试从工作流获取 task_doc 来确定模块数量
                module_count = 1  # 默认至少 1 个实例
                if self.session_factory and workflow_id:
                    try:
                        from sqlalchemy import select
                        from ..models import Workflow as WorkflowModel
                        async with self.session_factory() as db:
                            result = await db.execute(
                                select(WorkflowModel).where(WorkflowModel.id == workflow_id)
                            )
                            wf = result.scalar_one_or_none()
                            if wf and wf.task_doc:
                                # 粗略估计模块数量（按 ### 模块 标记计数）
                                module_count = max(1, wf.task_doc.count("### 模块"))
                    except Exception as e:
                        logger.warning(f"获取工作流模块数量失败: {e}，使用默认值 1")

                for i in range(module_count):
                    pe = PromptEngineer(
                        self,
                        agent_manager=self.agent_manager,
                        worktree_manager=None,
                    )
                    pe_agent = await self.agent_manager.register_agent(
                        name=f"提示词工程智能体-{i + 1}",
                        cli_path=self.executor.executable,
                        workspace="",
                        max_concurrent=1,
                    )
                    if self.session_factory:
                        await self._persist_agent(
                            agent_id=pe_agent.id,
                            name=pe_agent.name,
                            avatar_seed=pe_agent.avatar_seed or pe_agent.id[:8],
                            status=str(pe_agent.status.value) if hasattr(pe_agent.status, "value") else str(pe_agent.status),
                            cli_path=pe_agent.cli_path or "claude",
                            workspace=pe_agent.workspace or "",
                            max_concurrent=pe_agent.max_concurrent or 1,
                        )
                    dispatched_agents.append({
                        "agent_id": pe_agent.id,
                        "name": pe_agent.name,
                        "role": "PromptEngineer",
                    })
                logger.info(f"prompting 阶段：已分派 {module_count} 个提示词工程智能体")
            except Exception as e:
                logger.error(f"分派提示词工程智能体失败: {e}")

        # executing 阶段：Claude Code CLI 团队（由外部 CLI 执行器管理）
        elif stage_name == "executing":
            logger.info("executing 阶段：Claude Code CLI 团队由外部执行器管理，此处仅记录")
            dispatched_agents.append({
                "agent_id": "cli-team",
                "name": "Claude Code CLI 执行团队",
                "role": "CLIExecutor",
            })

        # reviewing 阶段：激活批判反思智能体 + 质量保障智能体（评估模式）
        elif stage_name == "reviewing":
            # 批判反思智能体（评估模式）
            try:
                reviewer = CriticalReviewer(self)
                reviewer_agent = await self.agent_manager.register_agent(
                    name="批判反思智能体（评估）",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=reviewer_agent.id,
                        name=reviewer_agent.name,
                        avatar_seed=reviewer_agent.avatar_seed or reviewer_agent.id[:8],
                        status=str(reviewer_agent.status.value) if hasattr(reviewer_agent.status, "value") else str(reviewer_agent.status),
                        cli_path=reviewer_agent.cli_path or "claude",
                        workspace=reviewer_agent.workspace or "",
                        max_concurrent=reviewer_agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": reviewer_agent.id,
                    "name": reviewer_agent.name,
                    "role": "CriticalReviewer",
                })
                logger.info(f"reviewing 阶段：已分派批判反思智能体 {reviewer_agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派批判反思智能体失败: {e}")

            # 质量保障智能体（评估模式）
            try:
                qm = QualityManager(self)
                qm_agent = await self.agent_manager.register_agent(
                    name="质量保障智能体（评估）",
                    cli_path=self.executor.executable,
                    workspace="",
                    max_concurrent=1,
                )
                if self.session_factory:
                    await self._persist_agent(
                        agent_id=qm_agent.id,
                        name=qm_agent.name,
                        avatar_seed=qm_agent.avatar_seed or qm_agent.id[:8],
                        status=str(qm_agent.status.value) if hasattr(qm_agent.status, "value") else str(qm_agent.status),
                        cli_path=qm_agent.cli_path or "claude",
                        workspace=qm_agent.workspace or "",
                        max_concurrent=qm_agent.max_concurrent or 1,
                    )
                dispatched_agents.append({
                    "agent_id": qm_agent.id,
                    "name": qm_agent.name,
                    "role": "QualityManager",
                })
                logger.info(f"reviewing 阶段：已分派质量保障智能体 {qm_agent.id[:8]}...")
            except Exception as e:
                logger.error(f"分派质量保障智能体失败: {e}")

        else:
            logger.warning(f"未知阶段名称: {stage_name}，跳过分派")

        return {
            "workflow_id": workflow_id,
            "stage_name": stage_name,
            "dispatched_agents": dispatched_agents,
            "agent_count": len(dispatched_agents),
        }
