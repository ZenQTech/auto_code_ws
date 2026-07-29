"""Hermes Agent v2 - 自进化智能体模块"""
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
)
from .manager import AgentV2Manager, get_manager

__all__ = [
    "ProactivePattern",
    "ProactiveSuggestion",
    "ThreadAutomation",
    "BackgroundTask",
    "IdleStatus",
    "AgentV2Stats",
    "ScheduleType",
    "AutomationStatus",
    "BackgroundTaskStatus",
    "SuggestionSource",
    "AgentV2Manager",
    "get_manager",
]
