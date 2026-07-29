"""
Hermes Agent v2 - 主动建议引擎
==========================================
核心作用：根据 Proactive Pattern 和 Durable Memory 生成主动建议
        支持基于规则和基于上下文的建议生成
        支持多语言（中文/英文）
运行流程：输入上下文 + 模式 → 规则匹配 → 生成候选 → 评分排序 → 输出
输入参数：上下文、模式、Memory 实体
输出结果：ProactiveSuggestion 列表
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from threading import RLock

from .models import (
    ProactiveSuggestion,
    ProactivePattern,
    SuggestionSource,
    _new_id,
    _now_iso,
)


# 建议模板库 - 按场景分类
SUGGESTION_TEMPLATES = {
    "memory_continue": {
        "title": "继续之前的工作",
        "description": "检测到您之前在 {context} 中编辑了 {file_count} 个文件",
        "min_confidence": 0.6,
    },
    "memory_recent": {
        "title": "查看最近的项目",
        "description": "您最近活跃于 {project} 项目（{days_ago} 天前）",
        "min_confidence": 0.5,
    },
    "pattern_repeat": {
        "title": "您可能想要 {action}",
        "description": "该操作已发生 {occurrences} 次（置信度: {confidence:.0%}）",
        "min_confidence": 0.7,
    },
    "automation_pending": {
        "title": "运行待执行的自动化任务",
        "description": "有 {count} 个待执行的 Thread Automation",
        "min_confidence": 0.6,
    },
    "background_pending": {
        "title": "查看后台任务进度",
        "description": "有 {running} 个后台任务正在运行，{pending} 个等待中",
        "min_confidence": 0.5,
    },
    "self_improving": {
        "title": "应用学习到的最佳实践",
        "description": "系统已学习到 {count} 个工作模式，建议应用到新任务",
        "min_confidence": 0.7,
    },
}


def _format_description(template: str, **kwargs: Any) -> str:
    """格式化建议描述

    Args:
        template: 模板字符串
        **kwargs: 模板变量

    Returns:
        str: 格式化后的描述
    """
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        return template


class SuggestionEngine:
    """建议生成引擎

    基于模板 + 上下文生成 ProactiveSuggestion
    线程安全（RLock）

    Attributes:
        templates: 模板字典
    """

    def __init__(self) -> None:
        """初始化引擎"""
        self._lock = RLock()
        self._templates: Dict[str, Dict[str, Any]] = dict(SUGGESTION_TEMPLATES)

    def generate_from_pattern(
        self,
        pattern: ProactivePattern,
        expiry_hours: int = 24,
    ) -> Optional[ProactiveSuggestion]:
        """从模式生成建议

        Args:
            pattern: 模式实体
            expiry_hours: 过期时间（小时）

        Returns:
            Optional[ProactiveSuggestion]: 建议实体（置信度太低时返回 None）
        """
        template = self._templates.get("pattern_repeat")
        if template is None:
            return None

        if pattern.confidence < template["min_confidence"]:
            return None

        with self._lock:
            now = datetime.now(timezone.utc)
            expires = now + timedelta(hours=expiry_hours)

            return ProactiveSuggestion(
                title=_format_description(
                    template["title"],
                    action=pattern.suggested_action,
                ),
                description=_format_description(
                    template["description"],
                    occurrences=pattern.occurrences,
                    confidence=pattern.confidence,
                ),
                confidence=pattern.confidence,
                source=SuggestionSource.PATTERN.value,
                action_url=None,
                created_at=_now_iso(),
                expires_at=expires.isoformat(),
                metadata={
                    "pattern_id": pattern.pattern_id,
                    "trigger_conditions": pattern.trigger_conditions,
                },
                status="pending",
            )

    def generate_from_memory(
        self,
        title: str,
        description: str,
        context: Optional[Dict[str, Any]] = None,
        confidence: float = 0.7,
        action_url: Optional[str] = None,
        expiry_hours: int = 24,
    ) -> ProactiveSuggestion:
        """从 Memory 生成建议

        Args:
            title: 标题
            description: 描述
            context: 上下文
            confidence: 置信度
            action_url: 操作 URL
            expiry_hours: 过期时间

        Returns:
            ProactiveSuggestion: 建议实体
        """
        with self._lock:
            now = datetime.now(timezone.utc)
            expires = now + timedelta(hours=expiry_hours)

            return ProactiveSuggestion(
                title=title,
                description=description,
                confidence=confidence,
                source=SuggestionSource.MEMORY.value,
                action_url=action_url,
                created_at=_now_iso(),
                expires_at=expires.isoformat(),
                metadata=context or {},
                status="pending",
            )

    def generate_automation_suggestion(
        self,
        pending_count: int,
        expiry_hours: int = 12,
    ) -> ProactiveSuggestion:
        """生成自动化任务建议

        Args:
            pending_count: 待执行任务数
            expiry_hours: 过期时间

        Returns:
            ProactiveSuggestion: 建议实体
        """
        with self._lock:
            template = self._templates.get("automation_pending", {})
            now = datetime.now(timezone.utc)
            expires = now + timedelta(hours=expiry_hours)

            return ProactiveSuggestion(
                title=template.get("title", "运行待执行的自动化任务"),
                description=_format_description(
                    template.get("description", "有 {count} 个待执行的自动化任务"),
                    count=pending_count,
                ),
                confidence=template.get("min_confidence", 0.6),
                source=SuggestionSource.AUTOMATION.value,
                action_url="/api/agent-v2/automations",
                created_at=_now_iso(),
                expires_at=expires.isoformat(),
                metadata={"pending_count": pending_count},
                status="pending",
            )

    def generate_background_suggestion(
        self,
        running_count: int,
        pending_count: int,
        expiry_hours: int = 6,
    ) -> ProactiveSuggestion:
        """生成后台任务建议

        Args:
            running_count: 运行中任务数
            pending_count: 等待中任务数
            expiry_hours: 过期时间

        Returns:
            ProactiveSuggestion: 建议实体
        """
        with self._lock:
            template = self._templates.get("background_pending", {})
            now = datetime.now(timezone.utc)
            expires = now + timedelta(hours=expiry_hours)

            return ProactiveSuggestion(
                title=template.get("title", "查看后台任务进度"),
                description=_format_description(
                    template.get(
                        "description",
                        "有 {running} 个后台任务正在运行，{pending} 个等待中",
                    ),
                    running=running_count,
                    pending=pending_count,
                ),
                confidence=template.get("min_confidence", 0.5),
                source=SuggestionSource.BACKGROUND.value,
                action_url="/api/agent-v2/background/tasks",
                created_at=_now_iso(),
                expires_at=expires.isoformat(),
                metadata={
                    "running_count": running_count,
                    "pending_count": pending_count,
                },
                status="pending",
            )

    def filter_by_confidence(
        self,
        suggestions: List[ProactiveSuggestion],
        min_confidence: float = 0.5,
    ) -> List[ProactiveSuggestion]:
        """按置信度过滤建议

        Args:
            suggestions: 建议列表
            min_confidence: 最低置信度

        Returns:
            List[ProactiveSuggestion]: 过滤后的建议
        """
        return [s for s in suggestions if s.confidence >= min_confidence]
