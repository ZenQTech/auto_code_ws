"""
Hermes Agent v2 - 数据模型
==========================================
核心作用：定义 Agent v2 自进化智能体的核心数据模型
        包括 ProactivePattern、ProactiveSuggestion、ThreadAutomation、
        BackgroundTask、IdleStatus、AgentV2Stats
运行流程：定义 → 序列化 → 反序列化 → 持久化
输入参数：各种实体字段
输出结果：可序列化的 Python 数据类
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本（Proactive + Thread Automation + Self-Directing）
"""
from __future__ import annotations

import uuid
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    """获取当前 UTC 时间的 ISO 8601 字符串

    Returns:
        str: ISO 8601 格式时间戳
    """
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    """生成带前缀的 UUID 字符串

    Args:
        prefix: ID 前缀（如 "pat", "sug", "auto", "bg"）

    Returns:
        str: 带前缀的 UUID
    """
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class SuggestionSource(str, Enum):
    """建议来源枚举

    用于标识 Proactive Suggestion 的来源渠道
    """

    MEMORY = "memory"  # 来自 Durable Memory
    PATTERN = "pattern"  # 来自检测到的模式
    AUTOMATION = "automation"  # 来自 Thread Automation
    BACKGROUND = "background"  # 来自 Background Task


class AutomationStatus(str, Enum):
    """自动化任务状态枚举

    用于 Thread Automation 状态管理
    """

    ACTIVE = "active"  # 激活
    PAUSED = "paused"  # 暂停
    DISABLED = "disabled"  # 禁用


class ScheduleType(str, Enum):
    """调度类型枚举

    用于区分不同类型的调度策略
    """

    CRON = "cron"  # Cron 表达式
    INTERVAL = "interval"  # 固定间隔（秒）
    EVENT = "event"  # 事件触发
    ONE_SHOT = "one_shot"  # 单次执行


class BackgroundTaskStatus(str, Enum):
    """后台任务状态枚举

    用于 Background Task 状态机管理
    """

    PENDING = "pending"  # 等待执行
    RUNNING = "running"  # 执行中
    COMPLETED = "completed"  # 已完成
    FAILED = "failed"  # 失败
    CANCELLED = "cancelled"  # 已取消


@dataclass
class ProactivePattern:
    """主动模式实体

    记录用户操作序列中检测到的重复模式
    用于生成主动建议

    Attributes:
        pattern_id: 模式唯一标识
        description: 模式描述
        trigger_conditions: 触发条件列表
        confidence: 置信度 (0.0-1.0)
        occurrences: 出现次数
        last_triggered: 上次触发时间
        suggested_action: 建议动作
        metadata: 附加元数据
        created_at: 创建时间
    """

    pattern_id: str = field(default_factory=lambda: _new_id("pat"))
    description: str = ""
    trigger_conditions: List[str] = field(default_factory=list)
    confidence: float = 0.0
    occurrences: int = 0
    last_triggered: str = ""
    suggested_action: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProactivePattern":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            ProactivePattern: 实体实例
        """
        return cls(
            pattern_id=data.get("pattern_id", _new_id("pat")),
            description=data.get("description", ""),
            trigger_conditions=data.get("trigger_conditions", []),
            confidence=float(data.get("confidence", 0.0)),
            occurrences=int(data.get("occurrences", 0)),
            last_triggered=data.get("last_triggered", ""),
            suggested_action=data.get("suggested_action", ""),
            metadata=data.get("metadata", {}),
            created_at=data.get("created_at", _now_iso()),
        )


@dataclass
class ProactiveSuggestion:
    """主动建议实体

    由 Proactive Memory Engine 生成的建议
    推送给用户时使用

    Attributes:
        suggestion_id: 建议唯一标识
        title: 建议标题
        description: 建议详情
        confidence: 置信度 (0.0-1.0)
        source: 建议来源
        action_url: 操作 URL
        created_at: 创建时间
        expires_at: 过期时间（可选）
        metadata: 附加元数据
        status: 建议状态（pending/accepted/rejected）
    """

    suggestion_id: str = field(default_factory=lambda: _new_id("sug"))
    title: str = ""
    description: str = ""
    confidence: float = 0.0
    source: str = SuggestionSource.MEMORY.value
    action_url: Optional[str] = None
    created_at: str = field(default_factory=_now_iso)
    expires_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    status: str = "pending"

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProactiveSuggestion":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            ProactiveSuggestion: 实体实例
        """
        return cls(
            suggestion_id=data.get("suggestion_id", _new_id("sug")),
            title=data.get("title", ""),
            description=data.get("description", ""),
            confidence=float(data.get("confidence", 0.0)),
            source=data.get("source", SuggestionSource.MEMORY.value),
            action_url=data.get("action_url"),
            created_at=data.get("created_at", _now_iso()),
            expires_at=data.get("expires_at"),
            metadata=data.get("metadata", {}),
            status=data.get("status", "pending"),
        )


@dataclass
class ThreadAutomation:
    """线程自动化实体

    支持定时/事件触发的自动化任务
    是 Thread Automations 调度的核心

    Attributes:
        automation_id: 自动化唯一标识
        name: 名称
        schedule: 调度表达式（cron/interval/event/ISO 时间）
        schedule_type: 调度类型
        action: 动作
        enabled: 是否启用
        status: 状态
        last_run: 上次执行时间
        next_run: 下次执行时间
        run_count: 执行次数
        max_runs: 最大执行次数（None 表示无限）
        created_at: 创建时间
        owner: 所有者
        metadata: 附加元数据
    """

    automation_id: str = field(default_factory=lambda: _new_id("auto"))
    name: str = ""
    schedule: str = ""
    schedule_type: str = ScheduleType.CRON.value
    action: str = ""
    enabled: bool = True
    status: str = AutomationStatus.ACTIVE.value
    last_run: Optional[str] = None
    next_run: Optional[str] = None
    run_count: int = 0
    max_runs: Optional[int] = None
    created_at: str = field(default_factory=_now_iso)
    owner: str = "default"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ThreadAutomation":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            ThreadAutomation: 实体实例
        """
        return cls(
            automation_id=data.get("automation_id", _new_id("auto")),
            name=data.get("name", ""),
            schedule=data.get("schedule", ""),
            schedule_type=data.get("schedule_type", ScheduleType.CRON.value),
            action=data.get("action", ""),
            enabled=bool(data.get("enabled", True)),
            status=data.get("status", AutomationStatus.ACTIVE.value),
            last_run=data.get("last_run"),
            next_run=data.get("next_run"),
            run_count=int(data.get("run_count", 0)),
            max_runs=data.get("max_runs"),
            created_at=data.get("created_at", _now_iso()),
            owner=data.get("owner", "default"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class BackgroundTask:
    """后台任务实体

    由 Thread Automation 触发或手动创建的异步任务
    是 Background Worker 执行的基本单位

    Attributes:
        task_id: 任务唯一标识
        name: 名称
        action: 动作
        automation_id: 关联的自动化 ID（可为空）
        status: 状态
        started_at: 开始时间
        completed_at: 完成时间
        result: 执行结果
        error: 错误信息
        created_at: 创建时间
        retry_count: 重试次数
        max_retries: 最大重试次数
        metadata: 附加元数据
    """

    task_id: str = field(default_factory=lambda: _new_id("bg"))
    name: str = ""
    action: str = ""
    automation_id: Optional[str] = None
    status: str = BackgroundTaskStatus.PENDING.value
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[str] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=_now_iso)
    retry_count: int = 0
    max_retries: int = 3
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BackgroundTask":
        """从字典反序列化

        Args:
            data: 字典数据

        Returns:
            BackgroundTask: 实体实例
        """
        return cls(
            task_id=data.get("task_id", _new_id("bg")),
            name=data.get("name", ""),
            action=data.get("action", ""),
            automation_id=data.get("automation_id"),
            status=data.get("status", BackgroundTaskStatus.PENDING.value),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            result=data.get("result"),
            error=data.get("error"),
            created_at=data.get("created_at", _now_iso()),
            retry_count=int(data.get("retry_count", 0)),
            max_retries=int(data.get("max_retries", 3)),
            metadata=data.get("metadata", {}),
        )


@dataclass
class IdleStatus:
    """空闲状态实体

    记录用户最后操作时间 + 空闲阈值 + 是否触发 auto-turn

    Attributes:
        is_idle: 是否空闲
        last_activity: 最后活动时间
        idle_seconds: 空闲时长（秒）
        idle_threshold: 空闲阈值（秒）
        auto_turn_enabled: 是否启用 auto-turn
        next_auto_turn: 下次 auto-turn 时间
    """

    is_idle: bool = False
    last_activity: str = field(default_factory=_now_iso)
    idle_seconds: int = 0
    idle_threshold: int = 1800  # 默认 30 分钟
    auto_turn_enabled: bool = True
    next_auto_turn: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)


@dataclass
class AgentV2Stats:
    """Agent v2 统计概览实体

    提供 Dashboard 展示的统计数据

    Attributes:
        total_patterns: 模式总数
        high_confidence_patterns: 高置信度模式数
        total_suggestions: 建议总数
        pending_suggestions: 待处理建议数
        accepted_suggestions: 已接受建议数
        rejected_suggestions: 已拒绝建议数
        total_automations: 自动化任务总数
        active_automations: 活跃自动化数
        total_background_tasks: 后台任务总数
        background_tasks_by_status: 按状态分组的后台任务数
        last_idle_check: 上次空闲检查时间
    """

    total_patterns: int = 0
    high_confidence_patterns: int = 0
    total_suggestions: int = 0
    pending_suggestions: int = 0
    accepted_suggestions: int = 0
    rejected_suggestions: int = 0
    total_automations: int = 0
    active_automations: int = 0
    total_background_tasks: int = 0
    background_tasks_by_status: Dict[str, int] = field(default_factory=dict)
    last_idle_check: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典

        Returns:
            Dict[str, Any]: 序列化结果
        """
        return asdict(self)
