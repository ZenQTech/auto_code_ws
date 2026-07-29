"""
# ============================================================
# Hermes /goal 长时域模式 - 数据模型
# ============================================================
# 核心作用：定义 /goal 系统的核心数据模型
# 包含：Goal / AcceptanceCriterion / VerifyItem / ProgressEntry / TokenBudget
# 特性：Three-File Trust 架构（GOAL.md/VERIFY.md/PROGRESS.md）
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class GoalStatus(str, Enum):
    """Goal 状态机"""
    DRAFT = "draft"               # 草稿
    ACTIVE = "active"             # 进行中
    PAUSED = "paused"             # 暂停
    COMPLETED = "completed"       # 完成
    FAILED = "failed"             # 失败
    ABANDONED = "abandoned"       # 放弃


class AcceptanceStatus(str, Enum):
    """验收标准状态"""
    PENDING = "pending"           # 待开始
    IN_PROGRESS = "in_progress"   # 进行中
    PASSED = "passed"             # 通过
    FAILED = "failed"             # 失败
    SKIPPED = "skipped"           # 跳过


class VerifyType(str, Enum):
    """验证类型"""
    TEST = "test"                 # 单元/集成测试
    COMMAND = "command"           # 命令执行
    FILE_EXISTS = "file_exists"   # 文件存在
    FILE_CONTAINS = "file_contains"  # 文件包含
    CUSTOM = "custom"             # 自定义检查


@dataclass
class AcceptanceCriterion:
    """验收标准（GOAL.md 中的 AC）"""
    id: str = field(default_factory=lambda: f"ac_{uuid.uuid4().hex[:8]}")
    title: str = ""                       # AC 标题
    description: str = ""                 # 详细描述
    status: AcceptanceStatus = AcceptanceStatus.PENDING
    priority: int = 1                     # 1-5，5最高
    verify_items: List[str] = field(default_factory=list)  # 关联的 verify item id
    completed_at: Optional[str] = None
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AcceptanceCriterion":
        return cls(
            id=data.get("id", f"ac_{uuid.uuid4().hex[:8]}"),
            title=data.get("title", ""),
            description=data.get("description", ""),
            status=AcceptanceStatus(data.get("status", "pending")),
            priority=data.get("priority", 1),
            verify_items=data.get("verify_items", []),
            completed_at=data.get("completed_at"),
            notes=data.get("notes", ""),
        )


@dataclass
class TokenBudget:
    """Token 预算"""
    soft_limit: int = 40000     # 软停止
    hard_limit: int = 60000     # 硬停止
    used: int = 0               # 已使用
    warning_threshold: int = 35000  # 警告阈值

    @property
    def remaining(self) -> int:
        return max(0, self.soft_limit - self.used)

    @property
    def utilization(self) -> float:
        return self.used / max(1, self.soft_limit)

    @property
    def is_soft_stop(self) -> bool:
        return self.used >= self.soft_limit

    @property
    def is_hard_stop(self) -> bool:
        return self.used >= self.hard_limit

    @property
    def is_warning(self) -> bool:
        return self.used >= self.warning_threshold

    def to_dict(self) -> Dict[str, Any]:
        return {
            "soft_limit": self.soft_limit,
            "hard_limit": self.hard_limit,
            "used": self.used,
            "warning_threshold": self.warning_threshold,
            "remaining": self.remaining,
            "utilization": round(self.utilization, 3),
            "is_warning": self.is_warning,
            "is_soft_stop": self.is_soft_stop,
            "is_hard_stop": self.is_hard_stop,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TokenBudget":
        return cls(
            soft_limit=data.get("soft_limit", 40000),
            hard_limit=data.get("hard_limit", 60000),
            used=data.get("used", 0),
            warning_threshold=data.get("warning_threshold", 35000),
        )


@dataclass
class Goal:
    """Goal 实体（对应 GOAL.md）"""
    id: str = field(default_factory=lambda: f"goal_{uuid.uuid4().hex[:8]}")
    title: str = ""
    objective: str = ""
    acceptance_criteria: List[AcceptanceCriterion] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    token_budget: TokenBudget = field(default_factory=TokenBudget)
    status: GoalStatus = GoalStatus.DRAFT
    tags: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    owner: str = "system"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "objective": self.objective,
            "acceptance_criteria": [ac.to_dict() for ac in self.acceptance_criteria],
            "constraints": self.constraints,
            "token_budget": self.token_budget.to_dict(),
            "status": self.status.value,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
            "owner": self.owner,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Goal":
        return cls(
            id=data.get("id", f"goal_{uuid.uuid4().hex[:8]}"),
            title=data.get("title", ""),
            objective=data.get("objective", ""),
            acceptance_criteria=[
                AcceptanceCriterion.from_dict(ac)
                for ac in data.get("acceptance_criteria", [])
            ],
            constraints=data.get("constraints", []),
            token_budget=TokenBudget.from_dict(data.get("token_budget", {})),
            status=GoalStatus(data.get("status", "draft")),
            tags=data.get("tags", []),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=data.get("updated_at", datetime.now(timezone.utc).isoformat()),
            completed_at=data.get("completed_at"),
            owner=data.get("owner", "system"),
            metadata=data.get("metadata", {}),
        )

    def progress(self) -> float:
        """计算完成进度（0.0-1.0）"""
        if not self.acceptance_criteria:
            return 0.0
        passed = sum(1 for ac in self.acceptance_criteria if ac.status == AcceptanceStatus.PASSED)
        return passed / len(self.acceptance_criteria)

    def is_completable(self) -> bool:
        """判断是否所有 AC 都通过"""
        return all(ac.status == AcceptanceStatus.PASSED for ac in self.acceptance_criteria)
