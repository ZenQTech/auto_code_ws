"""
# ============================================================
# Hermes /goal 长时域模式 - 进度条目数据模型
# ============================================================
# 核心作用：定义 PROGRESS.md 中的进度条目数据模型
# 包含：ProgressEntry / ProgressAction
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class ProgressStatus(str, Enum):
    """进度状态"""
    INFO = "info"                 # 信息
    STARTED = "started"           # 开始
    IN_PROGRESS = "in_progress"   # 进行中
    COMPLETED = "completed"       # 完成
    FAILED = "failed"             # 失败
    BLOCKED = "blocked"           # 阻塞
    RETRY = "retry"               # 重试
    PAUSED = "paused"             # 暂停
    RESUMED = "resumed"           # 恢复
    WARNING = "warning"           # 警告
    ERROR = "error"               # 错误


@dataclass
class ProgressAction:
    """单个动作"""
    description: str = ""
    target: str = ""             # 目标文件/命令
    result: str = ""             # 结果描述


@dataclass
class ProgressEntry:
    """进度条目（PROGRESS.md 中的一行）"""
    id: str = field(default_factory=lambda: f"pe_{uuid.uuid4().hex[:8]}")
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: ProgressStatus = ProgressStatus.INFO
    ac_id: Optional[str] = None        # 关联的 AC id
    action: ProgressAction = field(default_factory=ProgressAction)
    tokens_used: int = 0               # 当时累计 token
    duration_ms: int = 0
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProgressEntry":
        return cls(
            id=data.get("id", f"pe_{uuid.uuid4().hex[:8]}"),
            timestamp=data.get("timestamp", datetime.now(timezone.utc).isoformat()),
            status=ProgressStatus(data.get("status", "info")),
            ac_id=data.get("ac_id"),
            action=ProgressAction(**data.get("action", {})) if data.get("action") else ProgressAction(),
            tokens_used=data.get("tokens_used", 0),
            duration_ms=data.get("duration_ms", 0),
            notes=data.get("notes", ""),
        )


@dataclass
class ProgressLog:
    """进度日志（PROGRESS.md 整体）"""
    goal_id: str
    entries: List[ProgressEntry] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def append(self, entry: ProgressEntry) -> None:
        """追加一条进度"""
        self.entries.append(entry)
        self.updated_at = datetime.now(timezone.utc).isoformat()

    def get_by_ac(self, ac_id: str) -> List[ProgressEntry]:
        """按 AC id 过滤"""
        return [e for e in self.entries if e.ac_id == ac_id]

    def get_by_status(self, status: ProgressStatus) -> List[ProgressEntry]:
        """按状态过滤"""
        return [e for e in self.entries if e.status == status]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal_id": self.goal_id,
            "entry_count": len(self.entries),
            "entries": [e.to_dict() for e in self.entries],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
