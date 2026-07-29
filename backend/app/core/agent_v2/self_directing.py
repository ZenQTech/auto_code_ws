"""
Hermes Agent v2 - Self-Directing 引擎
==========================================
核心作用：自指导引擎
        监测用户空闲状态 + 触发 idle auto-turn
        综合 Memory + Pattern + Automation + Background 状态
        生成主动建议
运行流程：检查空闲时间 → 扫描状态 → 生成建议 → 推送给用户
输入参数：用户活动状态、配置
输出结果：ProactiveSuggestion 列表
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from threading import RLock

from .models import (
    IdleStatus,
    ProactiveSuggestion,
    SuggestionSource,
    _now_iso,
)


class SelfDirectingEngine:
    """自指导引擎

    监测用户空闲 + 主动建议生成
    线程安全（RLock）

    Attributes:
        idle_threshold: 空闲阈值（秒）
        last_activity: 最后活动时间
    """

    def __init__(
        self,
        idle_threshold: int = 1800,
        auto_turn_enabled: bool = True,
    ) -> None:
        """初始化引擎

        Args:
            idle_threshold: 空闲阈值（秒）
            auto_turn_enabled: 是否启用 auto-turn
        """
        self._lock = RLock()
        self._idle_threshold = idle_threshold
        self._auto_turn_enabled = auto_turn_enabled
        self._last_activity = _now_iso()
        self._last_check = _now_iso()

    def record_activity(self) -> None:
        """记录用户活动

        Returns:
            None
        """
        with self._lock:
            self._last_activity = _now_iso()

    def get_idle_status(self) -> IdleStatus:
        """获取空闲状态

        Returns:
            IdleStatus: 空闲状态实体
        """
        with self._lock:
            now = datetime.now(timezone.utc)
            try:
                last = datetime.fromisoformat(self._last_activity)
                idle_seconds = int((now - last).total_seconds())
            except (ValueError, TypeError):
                idle_seconds = 0

            is_idle = idle_seconds >= self._idle_threshold

            # 计算下次 auto-turn（如果启用）
            next_auto_turn = None
            if self._auto_turn_enabled and is_idle:
                next_auto_turn = (now + timedelta(minutes=5)).isoformat()

            status = IdleStatus(
                is_idle=is_idle,
                last_activity=self._last_activity,
                idle_seconds=idle_seconds,
                idle_threshold=self._idle_threshold,
                auto_turn_enabled=self._auto_turn_enabled,
                next_auto_turn=next_auto_turn,
            )
            self._last_check = _now_iso()
            return status

    def trigger_auto_turn(
        self,
        context: Optional[Dict[str, Any]] = None,
    ) -> List[ProactiveSuggestion]:
        """触发 idle auto-turn

        Args:
            context: 上下文（包含待办、模式、自动化、后台任务状态）

        Returns:
            List[ProactiveSuggestion]: 生成的建议列表
        """
        with self._lock:
            if not self._auto_turn_enabled:
                return []

            idle_status = self.get_idle_status()
            if not idle_status.is_idle:
                return []

            context = context or {}
            suggestions: List[ProactiveSuggestion] = []

            # 1. 检查待办任务
            pending_count = context.get("pending_count", 0)
            if pending_count > 0:
                suggestions.append(self._create_suggestion(
                    title="查看待办任务",
                    description=f"您有 {pending_count} 个待办任务未处理",
                    confidence=0.75,
                    source=SuggestionSource.MEMORY.value,
                ))

            # 2. 检查自动化任务
            automation_count = context.get("automation_due_count", 0)
            if automation_count > 0:
                suggestions.append(self._create_suggestion(
                    title="运行待执行的自动化任务",
                    description=f"有 {automation_count} 个 Thread Automation 待执行",
                    confidence=0.7,
                    source=SuggestionSource.AUTOMATION.value,
                ))

            # 3. 检查后台任务
            running_bg = context.get("background_running", 0)
            pending_bg = context.get("background_pending", 0)
            if running_bg > 0 or pending_bg > 0:
                suggestions.append(self._create_suggestion(
                    title="查看后台任务进度",
                    description=f"运行中: {running_bg}, 等待中: {pending_bg}",
                    confidence=0.6,
                    source=SuggestionSource.BACKGROUND.value,
                ))

            # 4. 检查学习到的模式
            high_conf_patterns = context.get("high_confidence_patterns", 0)
            if high_conf_patterns > 0:
                suggestions.append(self._create_suggestion(
                    title="应用学习到的模式",
                    description=f"系统已学习到 {high_conf_patterns} 个高置信度模式",
                    confidence=0.7,
                    source=SuggestionSource.PATTERN.value,
                ))

            return suggestions

    def _create_suggestion(
        self,
        title: str,
        description: str,
        confidence: float = 0.7,
        source: str = SuggestionSource.MEMORY.value,
    ) -> ProactiveSuggestion:
        """创建建议

        Args:
            title: 标题
            description: 描述
            confidence: 置信度
            source: 来源

        Returns:
            ProactiveSuggestion: 建议实体
        """
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=24)

        return ProactiveSuggestion(
            title=title,
            description=description,
            confidence=confidence,
            source=source,
            action_url=None,
            created_at=_now_iso(),
            expires_at=expires.isoformat(),
            metadata={"trigger": "idle_auto_turn"},
            status="pending",
        )

    def set_idle_threshold(self, seconds: int) -> None:
        """设置空闲阈值

        Args:
            seconds: 阈值（秒）

        Returns:
            None
        """
        with self._lock:
            self._idle_threshold = max(60, seconds)  # 最少 60 秒

    def set_auto_turn_enabled(self, enabled: bool) -> None:
        """启用/禁用 auto-turn

        Args:
            enabled: 是否启用

        Returns:
            None
        """
        with self._lock:
            self._auto_turn_enabled = enabled
