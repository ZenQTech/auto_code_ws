"""
# ============================================================
# Hermes Worktree v2 - 数据模型
# ============================================================
# 核心作用：Worktree 隔离执行系统的所有数据模型
# 包含：状态枚举、状态对象、事件、冲突、指标
# Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class WorktreeStatus(str, Enum):
    """Worktree 状态枚举（7 状态）"""
    CREATE_PENDING = "create_pending"   # 创建中
    ACTIVE = "active"                   # 活跃（CLI 执行中）
    AUTO_MERGE_PENDING = "auto_merge_pending"  # 自动合并中
    MERGED = "merged"                   # 已合并
    CONFLICT = "conflict"               # 冲突
    FAILED = "failed"                   # 失败
    EXPIRED = "expired"                 # 过期
    CLEANED = "cleaned"                 # 已清理


# 状态机转换规则
ALLOWED_TRANSITIONS: Dict[WorktreeStatus, List[WorktreeStatus]] = {
    WorktreeStatus.CREATE_PENDING: [WorktreeStatus.ACTIVE, WorktreeStatus.FAILED],
    WorktreeStatus.ACTIVE: [
        WorktreeStatus.AUTO_MERGE_PENDING,
        WorktreeStatus.CONFLICT,
        WorktreeStatus.FAILED,
        WorktreeStatus.EXPIRED,
    ],
    WorktreeStatus.AUTO_MERGE_PENDING: [
        WorktreeStatus.MERGED,
        WorktreeStatus.CONFLICT,
        WorktreeStatus.FAILED,
    ],
    WorktreeStatus.CONFLICT: [WorktreeStatus.MERGED, WorktreeStatus.FAILED, WorktreeStatus.CLEANED, WorktreeStatus.ACTIVE],
    WorktreeStatus.MERGED: [WorktreeStatus.CLEANED],
    WorktreeStatus.FAILED: [WorktreeStatus.CLEANED],
    WorktreeStatus.EXPIRED: [WorktreeStatus.CLEANED],
    WorktreeStatus.CLEANED: [],  # 终态
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str = "wt") -> str:
    return f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


@dataclass
class WorktreeEvent:
    """Worktree 事件记录"""
    event_id: str = field(default_factory=lambda: _new_id("evt"))
    worktree_id: str = ""
    event_type: str = ""  # created/activated/committed/merged/conflict/expired/cleaned
    timestamp: str = field(default_factory=_now_iso)
    actor: str = "system"  # system/agent/user
    payload: Dict[str, Any] = field(default_factory=dict)
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorktreeEvent":
        return cls(
            event_id=data.get("event_id", _new_id("evt")),
            worktree_id=data.get("worktree_id", ""),
            event_type=data.get("event_type", ""),
            timestamp=data.get("timestamp", _now_iso()),
            actor=data.get("actor", "system"),
            payload=data.get("payload", {}),
            note=data.get("note", ""),
        )


@dataclass
class WorktreeConflict:
    """Worktree 冲突"""
    conflict_id: str = field(default_factory=lambda: _new_id("cfl"))
    worktree_id: str = ""
    files: List[str] = field(default_factory=list)  # 冲突文件列表
    detected_at: str = field(default_factory=_now_iso)
    resolved_at: Optional[str] = None
    resolution: str = ""  # ai_assisted / manual / auto_accept_ours / auto_accept_theirs
    patch: str = ""  # 解决补丁
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorktreeConflict":
        return cls(
            conflict_id=data.get("conflict_id", _new_id("cfl")),
            worktree_id=data.get("worktree_id", ""),
            files=data.get("files", []),
            detected_at=data.get("detected_at", _now_iso()),
            resolved_at=data.get("resolved_at"),
            resolution=data.get("resolution", ""),
            patch=data.get("patch", ""),
            note=data.get("note", ""),
        )


@dataclass
class WorktreeMetrics:
    """Worktree 指标"""
    worktree_id: str = ""
    total_commits: int = 0
    files_changed: int = 0
    lines_added: int = 0
    lines_removed: int = 0
    duration_ms: int = 0  # 活跃时长
    merge_duration_ms: int = 0  # 合并耗时
    conflict_count: int = 0
    retry_count: int = 0
    last_calculated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorktreeMetrics":
        return cls(
            worktree_id=data.get("worktree_id", ""),
            total_commits=data.get("total_commits", 0),
            files_changed=data.get("files_changed", 0),
            lines_added=data.get("lines_added", 0),
            lines_removed=data.get("lines_removed", 0),
            duration_ms=data.get("duration_ms", 0),
            merge_duration_ms=data.get("merge_duration_ms", 0),
            conflict_count=data.get("conflict_count", 0),
            retry_count=data.get("retry_count", 0),
            last_calculated_at=data.get("last_calculated_at", _now_iso()),
        )


@dataclass
class WorktreeState:
    """
    Worktree 完整状态对象
    包含：标识、路径、状态、生命周期、事件、冲突、指标
    """
    worktree_id: str = field(default_factory=lambda: _new_id("wt"))
    task_id: str = ""               # 关联任务 ID
    instance_id: str = ""           # CLI 实例 ID
    module_name: str = ""           # 模块名
    branch_name: str = ""           # 分支名
    repo_path: str = ""             # 主仓库路径
    worktree_path: str = ""         # Worktree 路径
    base_commit: str = ""           # 基础 commit
    head_commit: str = ""           # 当前 HEAD
    status: WorktreeStatus = WorktreeStatus.CREATE_PENDING
    created_at: str = field(default_factory=_now_iso)
    activated_at: Optional[str] = None
    completed_at: Optional[str] = None
    expires_at: Optional[str] = None  # 过期时间（默认 24h）
    last_activity_at: str = field(default_factory=_now_iso)
    ttl_hours: int = 24
    # 关联数据
    events: List[WorktreeEvent] = field(default_factory=list)
    conflicts: List[WorktreeConflict] = field(default_factory=list)
    metrics: WorktreeMetrics = field(default_factory=WorktreeMetrics)
    # 元数据
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)
    error_message: str = ""
    note: str = ""

    def __post_init__(self):
        # 自动设置 metrics.worktree_id
        if not self.metrics.worktree_id:
            self.metrics.worktree_id = self.worktree_id
        # 自动设置 expires_at
        if self.ttl_hours > 0 and not self.expires_at:
            from datetime import timedelta
            try:
                created = datetime.fromisoformat(self.created_at)
            except (ValueError, TypeError):
                created = datetime.now(timezone.utc)
            self.expires_at = (created + timedelta(hours=self.ttl_hours)).isoformat()

    def is_terminal(self) -> bool:
        """判断是否为终态"""
        return self.status in (WorktreeStatus.MERGED, WorktreeStatus.CLEANED)

    def can_transition_to(self, new_status: WorktreeStatus) -> bool:
        """判断是否可以转换到新状态"""
        return new_status in ALLOWED_TRANSITIONS.get(self.status, [])

    def transition(self, new_status: WorktreeStatus, note: str = "") -> None:
        """执行状态转换"""
        if not self.can_transition_to(new_status):
            raise ValueError(
                f"Invalid transition: {self.status.value} -> {new_status.value}"
            )
        old_status = self.status
        self.status = new_status
        now = _now_iso()
        self.last_activity_at = now
        if new_status == WorktreeStatus.ACTIVE and not self.activated_at:
            self.activated_at = now
        if new_status in (WorktreeStatus.MERGED, WorktreeStatus.FAILED, WorktreeStatus.EXPIRED):
            self.completed_at = now
        # 记录事件
        self.add_event(
            event_type=f"state:{new_status.value}",
            actor="system",
            note=note or f"{old_status.value} -> {new_status.value}",
        )

    def add_event(self, event_type: str, actor: str = "system", payload: Optional[Dict[str, Any]] = None, note: str = "") -> WorktreeEvent:
        """添加事件"""
        evt = WorktreeEvent(
            worktree_id=self.worktree_id,
            event_type=event_type,
            actor=actor,
            payload=payload or {},
            note=note,
        )
        self.events.append(evt)
        self.last_activity_at = evt.timestamp
        return evt

    def add_conflict(self, files: List[str], note: str = "") -> WorktreeConflict:
        """添加冲突"""
        cfl = WorktreeConflict(
            worktree_id=self.worktree_id,
            files=files,
            note=note,
        )
        self.conflicts.append(cfl)
        self.metrics.conflict_count += 1
        return cfl

    def to_dict(self) -> Dict[str, Any]:
        return {
            "worktree_id": self.worktree_id,
            "task_id": self.task_id,
            "instance_id": self.instance_id,
            "module_name": self.module_name,
            "branch_name": self.branch_name,
            "repo_path": self.repo_path,
            "worktree_path": self.worktree_path,
            "base_commit": self.base_commit,
            "head_commit": self.head_commit,
            "status": self.status.value,
            "created_at": self.created_at,
            "activated_at": self.activated_at,
            "completed_at": self.completed_at,
            "expires_at": self.expires_at,
            "last_activity_at": self.last_activity_at,
            "ttl_hours": self.ttl_hours,
            "events": [e.to_dict() for e in self.events],
            "conflicts": [c.to_dict() for c in self.conflicts],
            "metrics": self.metrics.to_dict(),
            "metadata": self.metadata,
            "tags": self.tags,
            "error_message": self.error_message,
            "note": self.note,
            "is_terminal": self.is_terminal(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorktreeState":
        return cls(
            worktree_id=data.get("worktree_id", _new_id("wt")),
            task_id=data.get("task_id", ""),
            instance_id=data.get("instance_id", ""),
            module_name=data.get("module_name", ""),
            branch_name=data.get("branch_name", ""),
            repo_path=data.get("repo_path", ""),
            worktree_path=data.get("worktree_path", ""),
            base_commit=data.get("base_commit", ""),
            head_commit=data.get("head_commit", ""),
            status=WorktreeStatus(data.get("status", "create_pending")),
            created_at=data.get("created_at", _now_iso()),
            activated_at=data.get("activated_at"),
            completed_at=data.get("completed_at"),
            expires_at=data.get("expires_at"),
            last_activity_at=data.get("last_activity_at", _now_iso()),
            ttl_hours=data.get("ttl_hours", 24),
            events=[WorktreeEvent.from_dict(e) for e in data.get("events", [])],
            conflicts=[WorktreeConflict.from_dict(c) for c in data.get("conflicts", [])],
            metrics=WorktreeMetrics.from_dict(data.get("metrics", {})),
            metadata=data.get("metadata", {}),
            tags=data.get("tags", []),
            error_message=data.get("error_message", ""),
            note=data.get("note", ""),
        )
