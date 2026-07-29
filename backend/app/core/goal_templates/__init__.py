"""
# ============================================================
# Hermes Goal Templates - 模块入口
# ============================================================
# 核心作用：暴露 Goal Templates 统一 API
# 特性：
#   - GoalTemplate / AcceptanceCriterionTemplate / TemplateInstantiation
#   - TemplateManager: 注册/查询/实例化/统计
#   - 全局单例 + 便捷函数
# Cycle 14 P1-5 新建
# ============================================================
"""

from .models import (
    AcceptanceCriterionTemplate,
    GoalTemplate,
    TemplateCategory,
    TemplateInstantiation,
    TemplateSource,
)
from .manager import TemplateManager, get_manager, reset_manager


__all__ = [
    # 枚举
    "TemplateCategory",
    "TemplateSource",
    # 数据模型
    "AcceptanceCriterionTemplate",
    "GoalTemplate",
    "TemplateInstantiation",
    # 管理器
    "TemplateManager",
    "get_manager",
    "reset_manager",
]


__version__ = "1.0.0"
__cycle__ = "Cycle 14 P1-5"
