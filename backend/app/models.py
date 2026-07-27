"""
# ============================================================
# 数据模型定义模块
# ============================================================
# 核心作用：定义平台所有数据库表结构的 ORM 模型
# 运行流程：
#   1. 定义各实体类（继承 SQLAlchemy Base）
#   2. 定义字段类型、约束、关系
#   3. 数据库初始化时自动创建对应表
# 输入参数：无（静态模型定义）
# 输出结果：ORM 模型类，供数据库操作使用
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本
#   - 2026-06-23 | v1.5.0 | 新增 Session 模型；Agent/Task/Conversation 新增 session_id 外键
#   - 2026-06-23 | v1.6.0 | Session 模型新增 title_auto_generated 字段
#   - 2026-06-23 | v1.7.0 | 撤销 title_auto_generated 字段（简化会话标题显示）
#   - 2026-06-24 | v1.8.0 | Session 新增 DELETED 状态 + deleted_at 字段（软删除支持）
#   - 2026-06-24 | v1.9.0 | Session 新增 mode 字段（chat/coding 双模式）
#   - 2026-06-25 | v2.0.0 | 新增 Workflow/WorkflowStage/AgentRole 模型；Session 扩展 workflow 字段
#   - 2026-06-26 | v2.1.0 | Workflow 模型新增 repo_name 和 push_status 字段，支持 GitHub 仓库追踪
#   - 2026-06-29 | v2.2.0 | 新增 AtomicTaskList 模型，整合 Claude Code CLI 实例的 plan/checklist/task 文档，
#     作为全流程唯一任务状态追踪源
#   - 2026-06-29 | v2.3.0 | Workflow 模型新增阶段确认/驳回追踪字段：human_confirmed_requirement、
#     human_confirmed_architecture、human_confirmed_review、critique_passed、prompts_optimized、
#     rejection_count、force_human_review
#   - 2026-06-29 | v2.4.0 | Workflow 模型新增需求澄清相关字段：clarification_questions（澄清问题列表）、
#     clarification_round（当前澄清轮次）、clarification_complete（澄清是否完成）
#   - 2026-07-01 | v2.5.0 | Workflow 模型新增 requirement_doc_v2 字段，存储架构设计阶段迭代优化后的需求文档 V2.0
#   - 2026-07-22 | v2.6.0 | Workflow 模型新增 iteration_context（当前迭代缺陷上下文 JSON）
#     和 iteration_history（迭代历史 JSON 数组）字段，支持智能迭代闭环追踪
#   - 2026-07-22 | v2.7.0 | Workflow 模型新增 goal_id（目标 ID）和 goals（子目标 JSON 列表）字段，
#     支持目标导向任务循环（Goal-oriented task loop）
# ============================================================
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Enum as SAEnum, JSON, Index
)
from sqlalchemy.orm import relationship
import enum

from .database import Base


# ============================================================
# 枚举类型定义
# ============================================================

class AgentStatus(str, enum.Enum):
    """
    智能体状态枚举
    取值：ONLINE（在线）、BUSY（忙碌）、OFFLINE（离线）、ERROR（异常）
    """
    ONLINE = "online"
    BUSY = "busy"
    OFFLINE = "offline"
    ERROR = "error"


class TaskStatus(str, enum.Enum):
    """
    任务状态枚举
    取值：PENDING（等待中）、RUNNING（执行中）、VALIDATING（验证中）、
          COMPLETED（已完成）、FAILED（失败）、CANCELLED（已取消）
    """
    PENDING = "pending"
    RUNNING = "running"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(str, enum.Enum):
    """
    任务优先级枚举
    取值：HIGH（高）、MEDIUM（中）、LOW（低）
    """
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ExecutionMode(str, enum.Enum):
    """
    执行模式枚举
    取值：DIRECT（直接执行）、SUBAGENT（Subagent 模式）、AGENT_TEAM（Agent Team 模式）
    """
    DIRECT = "direct"
    SUBAGENT = "subagent"
    AGENT_TEAM = "agent_team"


class SessionStatus(str, enum.Enum):
    """
    会话状态枚举
    取值：ACTIVE（活跃）、ARCHIVED（已归档）、DELETED（已删除）
    """
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


class WorkflowStatus(str, enum.Enum):
    """
    工作流状态枚举
    取值：PENDING（等待启动）、CLARIFYING（需求澄清）、DESIGNING（架构设计）、
          PROMPTING（提示词工程）、EXECUTING（执行中）、REVIEWING（质量评审）、
          ITERATING（迭代中）、COMPLETED（已完成）、FAILED（失败）
    """
    PENDING = "pending"
    CLARIFYING = "clarifying"
    DESIGNING = "designing"
    PROMPTING = "prompting"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    ITERATING = "iterating"
    COMPLETED = "completed"
    FAILED = "failed"


class StageStatus(str, enum.Enum):
    """
    工作流阶段状态枚举
    取值：PENDING（等待中）、IN_PROGRESS（进行中）、COMPLETED（已完成）、FAILED（失败）
    """
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ============================================================
# ORM 模型定义
# ============================================================

class Session(Base):
    """
    会话（顶层任务容器）模型
    字段说明：
      - id: 主键 UUID
      - title: 会话标题（默认截取首条用户消息前 30 字）
      - created_at: 创建时间
      - last_active_at: 最后活跃时间（用于侧边栏排序）
      - user_first_message: 首条用户消息全文（侧边栏副标题）
      - message_count: 消息条数缓存
      - status: 状态（active / archived）
    关系：
      - agents: 该会话下的所有 Claude Code CLI 实例
      - tasks: 该会话下的所有子任务
      - conversations: 该会话下的所有对话记录
    """
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(128), default="新会话", nullable=False, comment="会话标题")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, comment="创建时间")
    last_active_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="最后活跃时间",
    )
    user_first_message = Column(Text, default="", comment="首条用户消息全文")
    message_count = Column(Integer, default=0, comment="消息条数缓存")
    status = Column(SAEnum(SessionStatus), default=SessionStatus.ACTIVE, comment="状态")
    deleted_at = Column(DateTime, nullable=True, comment="软删除时间")
    mode = Column(String(16), default="chat", nullable=False, comment="会话模式：chat（闲聊）/ coding（编程）")
    workflow_id = Column(String(36), nullable=True, comment="关联的工作流 ID")
    workflow_stage = Column(String(32), nullable=True, comment="当前工作流阶段")
    # v6.13.0 (Cycle 2 T3) 新增：fork/resume 高级管理字段
    parent_session_id = Column(String(36), nullable=True, index=True, comment="父会话 ID（fork 来源）")
    forked_at = Column(DateTime, nullable=True, comment="fork 时间")
    fork_point_message_id = Column(String(36), nullable=True, comment="fork 时的消息 ID")
    is_archived = Column(Boolean, default=False, comment="是否已归档")
    device_id = Column(String(128), nullable=True, comment="最后操作的设备 ID")

    # 关系：该会话下的所有智能体、任务、对话记录
    # 注意：session_id 字段为非外键 String(36)，必须用 foreign() 标注
    agents = relationship(
        "Agent",
        back_populates="session",
        primaryjoin="Session.id==foreign(Agent.session_id)",
        viewonly=False,
        cascade="all, delete-orphan",
    )
    tasks = relationship(
        "Task",
        back_populates="session",
        primaryjoin="Session.id==foreign(Task.session_id)",
        viewonly=False,
        cascade="all, delete-orphan",
    )
    conversations = relationship(
        "Conversation",
        back_populates="session",
        primaryjoin="Session.id==foreign(Conversation.session_id)",
        viewonly=False,
        cascade="all, delete-orphan",
    )


class Agent(Base):
    """
    智能体（子 Claude Code CLI 实例）模型
    字段说明：
      - id: 主键，自动生成 UUID
      - name: 智能体可识别名称
      - avatar_seed: 头像生成种子（用于生成唯一头像）
      - status: 当前状态（在线/忙碌/离线/异常）
      - cli_path: Claude Code CLI 可执行文件路径
      - workspace: 工作空间路径
      - max_concurrent: 最大并发任务数
      - total_tokens: 累计消耗 Token 数
      - total_api_calls: 累计 API 调用次数
      - session_id: 所属会话 ID（可空，兼容旧数据；启动时迁移到 legacy-default）
      - created_at: 创建时间
      - updated_at: 最后更新时间
    """
    __tablename__ = "agents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(128), nullable=False, comment="智能体名称")
    avatar_seed = Column(String(64), nullable=False, comment="头像生成种子")
    status = Column(SAEnum(AgentStatus), default=AgentStatus.OFFLINE, comment="当前状态")
    cli_path = Column(String(512), default="claude", comment="CLI 可执行文件路径")
    workspace = Column(String(512), default="", comment="工作空间路径")
    max_concurrent = Column(Integer, default=5, comment="最大并发任务数")
    total_tokens = Column(Integer, default=0, comment="累计消耗 Token 数")
    total_api_calls = Column(Integer, default=0, comment="累计 API 调用次数")
    session_id = Column(String(36), nullable=True, index=True, comment="所属会话 ID")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), comment="更新时间")

    # 关系：一个智能体有多个任务；归属于某个会话
    tasks = relationship("Task", back_populates="agent", lazy="dynamic")
    session = relationship(
        "Session",
        back_populates="agents",
        primaryjoin="foreign(Agent.session_id)==Session.id",
        viewonly=False,
    )


class Task(Base):
    """
    任务模型
    字段说明：
      - id: 主键，自动生成 UUID
      - agent_id: 分配的智能体 ID（外键）
      - parent_task_id: 父任务 ID（用于任务树结构）
      - title: 任务标题
      - description: 任务描述（优化后的提示词）
      - original_prompt: 用户原始需求
      - optimized_prompt: 优化后的提示词
      - status: 任务状态
      - priority: 优先级
      - execution_mode: 执行模式（直接/Subagent/Agent Team）
      - complexity_score: 复杂度评分（0-1）
      - iteration_count: 当前迭代次数
      - max_iterations: 最大迭代次数
      - result_summary: 结果摘要
      - error_message: 错误信息
      - token_consumed: 本次任务消耗 Token 数
      - api_calls: 本次任务 API 调用次数
      - session_id: 所属会话 ID（可空，兼容旧数据；启动时迁移到 legacy-default）
      - created_at: 创建时间
      - started_at: 开始执行时间
      - completed_at: 完成时间
      - updated_at: 最后更新时间
    """
    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(36), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True, comment="分配的智能体 ID")
    parent_task_id = Column(String(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, comment="父任务 ID")
    title = Column(String(256), nullable=False, comment="任务标题")
    description = Column(Text, default="", comment="任务描述")
    original_prompt = Column(Text, default="", comment="用户原始需求")
    optimized_prompt = Column(Text, default="", comment="优化后的提示词")
    status = Column(SAEnum(TaskStatus), default=TaskStatus.PENDING, comment="任务状态")
    priority = Column(SAEnum(TaskPriority), default=TaskPriority.MEDIUM, comment="优先级")
    execution_mode = Column(SAEnum(ExecutionMode), default=ExecutionMode.DIRECT, comment="执行模式")
    complexity_score = Column(Float, default=0.0, comment="复杂度评分")
    iteration_count = Column(Integer, default=0, comment="当前迭代次数")
    max_iterations = Column(Integer, default=5, comment="最大迭代次数")
    result_summary = Column(Text, default="", comment="结果摘要")
    error_message = Column(Text, default="", comment="错误信息")
    token_consumed = Column(Integer, default=0, comment="消耗 Token 数")
    api_calls = Column(Integer, default=0, comment="API 调用次数")
    session_id = Column(String(36), nullable=True, index=True, comment="所属会话 ID")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")
    started_at = Column(DateTime, nullable=True, comment="开始时间")
    completed_at = Column(DateTime, nullable=True, comment="完成时间")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), comment="更新时间")

    # 关系
    agent = relationship("Agent", back_populates="tasks")
    parent_task = relationship("Task", remote_side=[id], backref="sub_tasks")
    conversations = relationship("Conversation", back_populates="task", lazy="dynamic")
    session = relationship(
        "Session",
        back_populates="tasks",
        primaryjoin="foreign(Task.session_id)==Session.id",
        viewonly=False,
    )


class Conversation(Base):
    """
    对话记录模型
    字段说明：
      - id: 主键，自动生成 UUID
      - task_id: 关联任务 ID（外键）
      - agent_id: 关联智能体 ID（外键）
      - session_id: 所属会话 ID（可空，兼容旧数据；启动时迁移到 legacy-default）
      - role: 角色（user / assistant / system）
      - content: 对话内容
      - extra_data: 附加元数据（JSON 格式，列名为 metadata）
      - is_compacted: 是否已被压缩（v6.13.0 Cycle 2 新增）
      - compacted_at: 压缩时间（v6.13.0 Cycle 2 新增）
      - compacted_into: 压缩后指向的 summary 消息 ID（v6.13.0 Cycle 2 新增）
      - created_at: 创建时间
    """
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, comment="关联任务 ID")
    agent_id = Column(String(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=True, comment="关联智能体 ID")
    session_id = Column(String(36), nullable=True, index=True, comment="所属会话 ID")
    role = Column(String(32), nullable=False, comment="角色：user/assistant/system")
    content = Column(Text, default="", comment="对话内容")
    extra_data = Column("metadata", JSON, default=dict, comment="附加元数据")
    # v6.13.0 Cycle 2 新增：压缩追踪字段
    is_compacted = Column(Boolean, default=False, comment="是否已被压缩")
    compacted_at = Column(DateTime, nullable=True, comment="压缩时间")
    compacted_into = Column(String(36), nullable=True, comment="压缩后指向的 summary 消息 ID")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")

    # 关系
    task = relationship("Task", back_populates="conversations")
    session = relationship(
        "Session",
        back_populates="conversations",
        primaryjoin="foreign(Conversation.session_id)==Session.id",
        viewonly=False,
    )


# ============================================================
# Loop Engineering 工作流模型（v2.0.0 新增）
# ============================================================

class AgentRole(Base):
    """
    智能体角色模型
    字段说明：
      - id: 主键 UUID
      - name: 角色名称（如"需求澄清智能体"）
      - description: 角色描述
      - system_prompt: 角色的 system prompt 模板
      - trigger_rules: 触发规则（JSON 格式，描述何时激活该角色）
      - created_at: 创建时间
    """
    __tablename__ = "agent_roles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(128), nullable=False, comment="角色名称")
    description = Column(Text, default="", comment="角色描述")
    system_prompt = Column(Text, default="", comment="System Prompt 模板")
    trigger_rules = Column(JSON, default=dict, comment="触发规则")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")


class Workflow(Base):
    """
    Loop Engineering 工作流模型
    字段说明：
      - id: 主键 UUID
      - session_id: 关联的会话 ID
      - status: 工作流状态（pending/clarifying/designing/prompting/executing/reviewing/iterating/completed/failed）
      - current_stage: 当前阶段标识（clarifying/designing/prompting/executing/reviewing）
      - iteration_count: 当前迭代次数
      - max_iterations: 最大迭代次数（默认 3）
      - user_input: 用户原始输入
      - requirement_doc: 需求文档内容
      - spec_doc: 架构 spec.md 内容
      - checklist_doc: 架构 checklist.md 内容
      - task_doc: 架构 task.md 内容
      - acceptance_doc: 验收标准.md 内容
      - error_message: 错误信息
      - repo_name: GitHub 仓库名
      - push_status: 推送状态（pending/pushing/pushed/failed）
      - human_confirmed_requirement: 需求确认标记（人工确认需求澄清阶段）
      - human_confirmed_architecture: 架构确认标记（人工确认架构设计阶段）
      - human_confirmed_review: 评审确认标记（人工确认质量评审阶段）
      - critique_passed: 批判迭代通过标记
      - prompts_optimized: 提示词已优化标记
      - rejection_count: 阶段驳回次数
      - force_human_review: 强制人工审核标记（驳回次数超限时置 True）
      - clarification_questions: 澄清问题列表 JSON（v2.4.0 新增）
        [{"dimension":"xx","question":"xx","importance":"high"}]
      - clarification_round: 当前澄清轮次（v2.4.0 新增）
      - clarification_complete: 澄清是否完成（v2.4.0 新增）
      - created_at: 创建时间
      - updated_at: 更新时间
    """
    __tablename__ = "workflows"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), nullable=False, index=True, comment="关联会话 ID")
    status = Column(SAEnum(WorkflowStatus), default=WorkflowStatus.PENDING, comment="工作流状态")
    current_stage = Column(String(32), nullable=True, comment="当前阶段标识")
    iteration_count = Column(Integer, default=0, comment="当前迭代次数")
    max_iterations = Column(Integer, default=3, comment="最大迭代次数")
    user_input = Column(Text, default="", comment="用户原始输入")
    requirement_doc = Column(Text, default="", comment="需求文档")
    spec_doc = Column(Text, default="", comment="架构 spec.md")
    checklist_doc = Column(Text, default="", comment="架构 checklist.md")
    task_doc = Column(Text, default="", comment="架构 task.md")
    acceptance_doc = Column(Text, default="", comment="验收标准.md")
    error_message = Column(Text, default="", comment="错误信息")
    repo_name = Column(String(256), default="", comment="GitHub 仓库名")
    push_status = Column(String(32), default="pending", comment="推送状态：pending/pushing/pushed/failed")
    human_confirmed_requirement = Column(Boolean, default=False, comment="需求确认标记")
    human_confirmed_architecture = Column(Boolean, default=False, comment="架构确认标记")
    human_confirmed_review = Column(Boolean, default=False, comment="评审确认标记")
    critique_passed = Column(Boolean, default=False, comment="批判迭代通过标记")
    prompts_optimized = Column(Boolean, default=False, comment="提示词已优化标记")
    rejection_count = Column(Integer, default=0, comment="阶段驳回次数")
    force_human_review = Column(Boolean, default=False, comment="强制人工审核标记")
    # v2.4.0 新增：需求澄清相关字段
    clarification_questions = Column(JSON, default=list, comment="澄清问题列表 [{\"dimension\":\"xx\",\"question\":\"xx\",\"importance\":\"high\"}]")
    clarification_round = Column(Integer, default=0, comment="当前澄清轮次")
    clarification_complete = Column(Boolean, default=False, comment="澄清是否完成")
    # v2.5.0 新增：架构设计阶段迭代优化后的需求文档 V2.0
    requirement_doc_v2 = Column(Text, default="", comment="需求文档 V2.0（架构设计阶段迭代优化后）")
    # v2.6.0 新增：智能迭代闭环追踪字段
    iteration_context = Column(Text, default="", comment="当前迭代缺陷上下文（JSON 格式，含缺陷列表与修复建议）")
    iteration_history = Column(Text, default="", comment="迭代历史记录（JSON 数组，每项含迭代编号、修复缺陷、剩余缺陷等）")
    # v2.7.0 新增：目标导向任务循环字段
    goal_id = Column(String(36), nullable=True, default=None, comment="目标 ID（Goal-oriented task loop）")
    goals = Column(JSON, nullable=True, default=None, comment="子目标列表 JSON（Goal-oriented task loop）")
    # v6.3.0 (P0-4) 新增：Plan 模式确认标记（PlanModeService 写入）
    plan_confirmed = Column(Boolean, default=False, comment="Plan 已确认标记")
    # v6.3.0 (P0-4) 新增：Plan 模式 JSON 数据
    plan_data = Column(Text, default="", comment="Plan JSON 数据（序列化 PlanDocument）")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), comment="更新时间")

    # 关系
    stages = relationship(
        "WorkflowStage",
        back_populates="workflow",
        cascade="all, delete-orphan",
    )


class WorkflowStage(Base):
    """
    工作流阶段记录模型
    字段说明：
      - id: 主键 UUID
      - workflow_id: 关联的工作流 ID
      - stage_name: 阶段名称（clarifying/designing/prompting/executing/reviewing）
      - status: 阶段状态（pending/in_progress/completed/failed）
      - agent_role: 该阶段使用的智能体角色名称
      - input_doc: 阶段输入文档
      - output_doc: 阶段输出文档
      - conversation_summary: 智能体对话摘要
      - started_at: 开始时间
      - completed_at: 完成时间
    """
    __tablename__ = "workflow_stages"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String(36), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, comment="关联工作流 ID")
    stage_name = Column(String(32), nullable=False, comment="阶段名称")
    status = Column(SAEnum(StageStatus), default=StageStatus.PENDING, comment="阶段状态")
    agent_role = Column(String(128), nullable=True, comment="智能体角色名称")
    input_doc = Column(Text, default="", comment="阶段输入文档")
    output_doc = Column(Text, default="", comment="阶段输出文档")
    conversation_summary = Column(Text, default="", comment="智能体对话摘要")
    started_at = Column(DateTime, nullable=True, comment="开始时间")
    completed_at = Column(DateTime, nullable=True, comment="完成时间")

    # 关系
    workflow = relationship("Workflow", back_populates="stages")


class Worktree(Base):
    """
    Git Worktree 隔离模型
    字段说明：
      - id: 主键 UUID
      - agent_id: 关联的智能体 ID
      - task_id: 关联的任务 ID
      - repo_path: 仓库路径
      - worktree_path: worktree 路径
      - branch_name: 分支名称
      - status: 状态（active/merged/cleaned）
      - created_at: 创建时间
    """
    __tablename__ = "worktrees"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(36), nullable=True, index=True, comment="关联智能体 ID")
    task_id = Column(String(36), nullable=True, index=True, comment="关联任务 ID")
    repo_path = Column(String(512), nullable=False, comment="仓库路径")
    worktree_path = Column(String(512), nullable=False, comment="Worktree 路径")
    branch_name = Column(String(256), nullable=False, comment="分支名称")
    status = Column(String(32), default="active", comment="状态：active/merged/cleaned")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")


# ============================================================
# 原子任务清单模型（v2.2.0 新增）
# ============================================================

class AtomicTaskList(Base):
    """
    原子任务清单模型
    作用：整合所有 Claude Code CLI 实例生成的 plan/checklist/task 文档，
          作为全流程唯一的任务状态追踪源
    字段说明：
      - id: 主键 UUID
      - workflow_id: 关联的工作流 ID（外键，唯一索引）
      - modules: 模块列表 JSON，每项含 module_name、status、tasks
      - tasks_json: 完整任务树 JSON
      - progress: 整体进度百分比（0.0 - 100.0）
      - status: 状态（pending/aggregating/active/completed）
      - created_at: 创建时间
      - updated_at: 更新时间
    关系：
      - workflow: 关联的 Workflow 对象
    """
    __tablename__ = "atomic_task_lists"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String(36), ForeignKey("workflows.id"), nullable=False, unique=True, index=True)
    modules = Column(JSON, default=list)  # [{"module_name": "xxx", "status": "pending", "tasks": [...]}]
    tasks_json = Column(JSON, default=list)  # 完整任务树 JSON
    progress = Column(Float, default=0.0)  # 0.0 - 100.0
    status = Column(String(20), default="pending")  # pending/aggregating/active/completed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    workflow = relationship("Workflow", backref="atomic_task_list")
