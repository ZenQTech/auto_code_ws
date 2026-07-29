"""
# ============================================================
# Hermes Goal Templates - 目标模板库核心模块
# ============================================================
# 核心作用：提供可复用的 Goal 模板，让用户能够快速创建预定义结构的 Goal
#           + 标准化的 AC（验收标准）+ 推荐的风险等级 + 委派策略
# 运行流程：
#   1. 用户浏览模板库（按类别/标签/风险等级过滤）
#   2. 选择模板 → 实例化为 Goal（生成 AC 列表 + 初始配置）
#   3. 实例化后的 Goal 可正常进入 Auto-Turn 或手动推进
# 特性：
#   - 模板分类（development / research / documentation / testing / devops / other）
#   - 模板版本管理（每次更新版本号 +1）
#   - 模板使用统计（instantiations / last_used_at）
#   - 内置模板 + 自定义模板 + 内置模板保护（不可删除）
#   - 模板搜索（按名称/描述/标签关键词）
#   - 模板导出/导入（JSON 格式）
# 复用说明：
#   - 零外部依赖（仅 stdlib）
#   - 通过 RLock 保证线程安全
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-5 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举定义
# ============================================================
class TemplateCategory(str, Enum):
    """模板类别"""
    DEVELOPMENT = "development"       # 软件开发
    RESEARCH = "research"             # 研究探索
    DOCUMENTATION = "documentation"   # 文档写作
    TESTING = "testing"               # 测试验证
    DEVOPS = "devops"                 # 运维部署
    REFACTORING = "refactoring"       # 重构优化
    OTHER = "other"                   # 其他


class TemplateSource(str, Enum):
    """模板来源"""
    BUILTIN = "builtin"               # 内置模板
    CUSTOM = "custom"                 # 用户自定义


# ============================================================
# 数据模型
# ============================================================
@dataclass
class AcceptanceCriterionTemplate:
    """单个 AC 模板项"""
    ac_id: str
    title: str
    description: str = ""
    priority: int = 5
    ac_type: str = "implementation"   # implementation / verification / documentation / testing
    risk_level: str = "medium"        # low / medium / high / critical
    verify_items: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AcceptanceCriterionTemplate":
        return cls(
            ac_id=data.get("ac_id") or f"ac_{uuid.uuid4().hex[:8]}",
            title=data.get("title", ""),
            description=data.get("description", ""),
            priority=int(data.get("priority", 5)),
            ac_type=data.get("ac_type", "implementation"),
            risk_level=data.get("risk_level", "medium"),
            verify_items=list(data.get("verify_items", [])),
        )


@dataclass
class GoalTemplate:
    """Goal 模板"""
    template_id: str
    name: str
    description: str = ""
    category: str = TemplateCategory.OTHER.value
    source: str = TemplateSource.CUSTOM.value
    version: int = 1
    tags: List[str] = field(default_factory=list)
    acceptance_criteria: List[AcceptanceCriterionTemplate] = field(default_factory=list)
    default_strategy: str = "standard"            # 轮转策略
    default_max_turns: int = 50
    default_triggers: List[str] = field(default_factory=lambda: ["manual"])
    recommended_agents: List[str] = field(default_factory=list)   # 推荐的 Agent 角色
    estimated_duration_min: int = 60
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    instantiations: int = 0                        # 实例化次数
    last_used_at: Optional[str] = None
    created_by: str = "system"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["acceptance_criteria"] = [ac.to_dict() for ac in self.acceptance_criteria]
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GoalTemplate":
        acs = [AcceptanceCriterionTemplate.from_dict(a) for a in data.get("acceptance_criteria", [])]
        return cls(
            template_id=data.get("template_id") or f"tpl_{uuid.uuid4().hex[:8]}",
            name=data.get("name", ""),
            description=data.get("description", ""),
            category=data.get("category", TemplateCategory.OTHER.value),
            source=data.get("source", TemplateSource.CUSTOM.value),
            version=int(data.get("version", 1)),
            tags=list(data.get("tags", [])),
            acceptance_criteria=acs,
            default_strategy=data.get("default_strategy", "standard"),
            default_max_turns=int(data.get("default_max_turns", 50)),
            default_triggers=list(data.get("default_triggers", ["manual"])),
            recommended_agents=list(data.get("recommended_agents", [])),
            estimated_duration_min=int(data.get("estimated_duration_min", 60)),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=data.get("updated_at", datetime.now(timezone.utc).isoformat()),
            instantiations=int(data.get("instantiations", 0)),
            last_used_at=data.get("last_used_at"),
            created_by=data.get("created_by", "system"),
            metadata=dict(data.get("metadata", {})),
        )

    def is_builtin(self) -> bool:
        return self.source == TemplateSource.BUILTIN.value


@dataclass
class TemplateInstantiation:
    """模板实例化结果（绑定 template_id + 生成的 Goal 配置）"""
    template_id: str
    goal_id: str
    instantiated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    ac_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TemplateInstantiation":
        return cls(
            template_id=data.get("template_id", ""),
            goal_id=data.get("goal_id", ""),
            instantiated_at=data.get("instantiated_at", datetime.now(timezone.utc).isoformat()),
            ac_count=int(data.get("ac_count", 0)),
        )
