"""
Hermes Agent v2 - Manager (统一管理入口)
==========================================
核心作用：Agent v2 统一管理入口
        集成 ProactiveMemoryEngine + Scheduler + BackgroundWorker + SelfDirectingEngine
        提供统一的状态查询 + 任务分发
运行流程：接收 API 调用 → 分发到对应模块 → 聚合结果
输入参数：API 请求
输出结果：API 响应
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .models import (
    ProactivePattern,
    ProactiveSuggestion,
    ThreadAutomation,
    BackgroundTask,
    IdleStatus,
    AgentV2Stats,
    ScheduleType,
    AutomationStatus,
    BackgroundTaskStatus,
    SuggestionSource,
    _new_id,
    _now_iso,
)
from .proactive_memory import ProactiveMemoryEngine
from .pattern_detector import PatternDetector
from .suggestion_engine import SuggestionEngine
from .scheduler import Scheduler
from .background_worker import BackgroundWorker
from .self_directing import SelfDirectingEngine


class AgentV2Manager:
    """Agent v2 统一管理入口

    集成所有子模块，提供统一 API
    线程安全（内部使用各模块的锁）

    Attributes:
        memory: 主动记忆引擎
        scheduler: 调度器
        worker: 后台 Worker
        self_directing: 自指导引擎
        suggestion_engine: 建议引擎
    """

    _instance: Optional["AgentV2Manager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "AgentV2Manager":
        """单例模式

        Returns:
            AgentV2Manager: 单例实例
        """
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialize()
        return cls._instance

    def _initialize(self) -> None:
        """初始化所有子模块

        Returns:
            None
        """
        self.memory = ProactiveMemoryEngine(
            min_occurrences=3,
            min_confidence=0.7,
            enable_persistence=True,
        )
        self.scheduler = Scheduler()
        self.worker = BackgroundWorker()
        self.self_directing = SelfDirectingEngine(
            idle_threshold=1800,
            auto_turn_enabled=True,
        )
        self.suggestion_engine = SuggestionEngine()

    # 模式管理
    def record_operation(
        self,
        operation: Dict[str, Any],
    ) -> List[ProactiveSuggestion]:
        """记录操作

        Args:
            operation: 操作字典

        Returns:
            List[ProactiveSuggestion]: 生成的建议
        """
        # 记录活动
        self.self_directing.record_activity()
        # 模式检测
        return self.memory.record_operation(operation)

    def list_patterns(
        self,
        min_confidence: Optional[float] = None,
    ) -> List[ProactivePattern]:
        """列出模式

        Args:
            min_confidence: 最低置信度

        Returns:
            List[ProactivePattern]: 模式列表
        """
        return self.memory.list_patterns(min_confidence=min_confidence)

    def get_pattern(self, pattern_id: str) -> Optional[ProactivePattern]:
        """获取模式详情

        Args:
            pattern_id: 模式 ID

        Returns:
            Optional[ProactivePattern]: 模式实体
        """
        return self.memory.get_pattern(pattern_id)

    def add_pattern(self, pattern: ProactivePattern) -> ProactivePattern:
        """添加模式

        Args:
            pattern: 模式实体

        Returns:
            ProactivePattern: 添加的模式
        """
        return self.memory.add_pattern(pattern)

    def remove_pattern(self, pattern_id: str) -> bool:
        """删除模式

        Args:
            pattern_id: 模式 ID

        Returns:
            bool: True 表示删除成功
        """
        return self.memory.remove_pattern(pattern_id)

    # 建议管理
    def list_suggestions(
        self,
        status: Optional[str] = None,
        source: Optional[str] = None,
        min_confidence: float = 0.0,
    ) -> List[ProactiveSuggestion]:
        """列出建议

        Args:
            status: 状态过滤
            source: 来源过滤
            min_confidence: 最低置信度

        Returns:
            List[ProactiveSuggestion]: 建议列表
        """
        return self.memory.list_suggestions(
            status=status,
            source=source,
            min_confidence=min_confidence,
        )

    def get_suggestion(
        self,
        suggestion_id: str,
    ) -> Optional[ProactiveSuggestion]:
        """获取建议详情

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 建议实体
        """
        return self.memory.get_suggestion(suggestion_id)

    def accept_suggestion(
        self,
        suggestion_id: str,
    ) -> Optional[ProactiveSuggestion]:
        """接受建议

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 更新后的建议
        """
        return self.memory.accept_suggestion(suggestion_id)

    def reject_suggestion(
        self,
        suggestion_id: str,
    ) -> Optional[ProactiveSuggestion]:
        """拒绝建议

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 更新后的建议
        """
        return self.memory.reject_suggestion(suggestion_id)

    # Thread Automation 管理
    def create_automation(
        self,
        name: str,
        schedule: str,
        action: str,
        schedule_type: str = ScheduleType.CRON.value,
        enabled: bool = True,
        max_runs: Optional[int] = None,
        owner: str = "default",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ThreadAutomation:
        """创建自动化任务

        Args:
            name: 名称
            schedule: 调度表达式
            action: 动作
            schedule_type: 调度类型
            enabled: 是否启用
            max_runs: 最大执行次数
            owner: 所有者
            metadata: 元数据

        Returns:
            ThreadAutomation: 创建的任务
        """
        automation = ThreadAutomation(
            name=name,
            schedule=schedule,
            schedule_type=schedule_type,
            action=action,
            enabled=enabled,
            max_runs=max_runs,
            owner=owner,
            metadata=metadata or {},
        )
        return self.scheduler.add(automation)

    def list_automations(
        self,
        enabled_only: bool = False,
        owner: Optional[str] = None,
    ) -> List[ThreadAutomation]:
        """列出自动化任务

        Args:
            enabled_only: 仅列出启用的
            owner: 按所有者过滤

        Returns:
            List[ThreadAutomation]: 任务列表
        """
        return self.scheduler.list_all(enabled_only=enabled_only, owner=owner)

    def get_automation(
        self,
        automation_id: str,
    ) -> Optional[ThreadAutomation]:
        """获取自动化任务详情

        Args:
            automation_id: 任务 ID

        Returns:
            Optional[ThreadAutomation]: 任务实体
        """
        return self.scheduler.get(automation_id)

    def update_automation(
        self,
        automation: ThreadAutomation,
    ) -> ThreadAutomation:
        """更新自动化任务

        Args:
            automation: 任务实体

        Returns:
            ThreadAutomation: 更新后的任务
        """
        return self.scheduler.update(automation)

    def delete_automation(self, automation_id: str) -> bool:
        """删除自动化任务

        Args:
            automation_id: 任务 ID

        Returns:
            bool: True 表示删除成功
        """
        return self.scheduler.remove(automation_id)

    async def trigger_automation(
        self,
        automation_id: str,
    ) -> Optional[BackgroundTask]:
        """手动触发自动化任务

        Args:
            automation_id: 自动化 ID

        Returns:
            Optional[BackgroundTask]: 创建的后台任务
        """
        automation = self.scheduler.get(automation_id)
        if automation is None:
            return None

        task = self.worker.create_task(
            name=f"Manual: {automation.name}",
            action=automation.action,
            automation_id=automation.automation_id,
            metadata=automation.metadata,
        )
        # 异步执行
        await self.worker.execute_task(task.task_id)
        # 标记已执行
        self.scheduler.mark_run(automation_id)
        return task

    # Background Task 管理
    def list_background_tasks(
        self,
        status: Optional[str] = None,
        automation_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[BackgroundTask]:
        """列出后台任务

        Args:
            status: 状态过滤
            automation_id: 自动化 ID 过滤
            limit: 限制数量

        Returns:
            List[BackgroundTask]: 任务列表
        """
        return self.worker.list_tasks(
            status=status,
            automation_id=automation_id,
            limit=limit,
        )

    def get_background_task(
        self,
        task_id: str,
    ) -> Optional[BackgroundTask]:
        """获取后台任务详情

        Args:
            task_id: 任务 ID

        Returns:
            Optional[BackgroundTask]: 任务实体
        """
        return self.worker.get_task(task_id)

    def cancel_background_task(self, task_id: str) -> bool:
        """取消后台任务

        Args:
            task_id: 任务 ID

        Returns:
            bool: True 表示取消成功
        """
        return self.worker.cancel_task(task_id)

    # Self-Directing
    def get_idle_status(self) -> IdleStatus:
        """获取空闲状态

        Returns:
            IdleStatus: 空闲状态
        """
        return self.self_directing.get_idle_status()

    def trigger_auto_turn(
        self,
        context: Optional[Dict[str, Any]] = None,
    ) -> List[ProactiveSuggestion]:
        """触发 idle auto-turn

        Args:
            context: 上下文

        Returns:
            List[ProactiveSuggestion]: 生成的建议
        """
        return self.self_directing.trigger_auto_turn(context=context)

    def set_idle_threshold(self, seconds: int) -> None:
        """设置空闲阈值

        Args:
            seconds: 阈值（秒）

        Returns:
            None
        """
        self.self_directing.set_idle_threshold(seconds)

    def set_auto_turn_enabled(self, enabled: bool) -> None:
        """设置 auto-turn 启用状态

        Args:
            enabled: 是否启用

        Returns:
            None
        """
        self.self_directing.set_auto_turn_enabled(enabled)

    def record_activity(self) -> None:
        """记录用户活动

        Returns:
            None
        """
        self.self_directing.record_activity()

    # 统计
    def get_stats(self) -> AgentV2Stats:
        """获取统计

        Returns:
            AgentV2Stats: 统计实体
        """
        memory_stats = self.memory.get_stats()
        automation_stats = self.scheduler.list_all()
        bg_stats = self.worker.get_stats()
        idle_status = self.self_directing.get_idle_status()

        active_automations = sum(
            1 for a in automation_stats
            if a.enabled and a.status == AutomationStatus.ACTIVE.value
        )

        return AgentV2Stats(
            total_patterns=memory_stats["total_patterns"],
            high_confidence_patterns=memory_stats["high_confidence_patterns"],
            total_suggestions=memory_stats["total_suggestions"],
            pending_suggestions=memory_stats["pending_suggestions"],
            accepted_suggestions=memory_stats["accepted_suggestions"],
            rejected_suggestions=memory_stats["rejected_suggestions"],
            total_automations=len(automation_stats),
            active_automations=active_automations,
            total_background_tasks=sum(bg_stats.values()),
            background_tasks_by_status=bg_stats,
            last_idle_check=idle_status.last_activity,
        )

    def get_dashboard(self) -> Dict[str, Any]:
        """获取 Dashboard 数据

        Returns:
            Dict[str, Any]: Dashboard 数据
        """
        stats = self.get_stats()
        idle_status = self.get_idle_status()
        recent_suggestions = self.list_suggestions(min_confidence=0.6)[:5]
        due_automations = self.scheduler.get_due()

        return {
            "stats": stats.to_dict(),
            "idle_status": idle_status.to_dict(),
            "recent_suggestions": [s.to_dict() for s in recent_suggestions],
            "due_automations": [a.to_dict() for a in due_automations],
        }

    def health(self) -> Dict[str, Any]:
        """健康检查

        Returns:
            Dict[str, Any]: 健康状态
        """
        return {
            "success": True,
            "service": "agent_v2",
            "version": "1.0.0",
            "status": "healthy",
            "subsystems": {
                "memory": "ok",
                "scheduler": "ok",
                "worker": "ok",
                "self_directing": "ok",
            },
            "stats": {
                "total_patterns": len(self.memory._patterns),
                "total_suggestions": len(self.memory._suggestions),
                "total_automations": self.scheduler.count,
                "total_background_tasks": sum(self.worker.get_stats().values()),
            },
            "timestamp": _now_iso(),
        }


def get_manager() -> AgentV2Manager:
    """获取 Agent v2 Manager 单例

    Returns:
        AgentV2Manager: Manager 实例
    """
    return AgentV2Manager()
