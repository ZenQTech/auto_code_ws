"""
# ============================================================
# Hermes /goal 长时域模式 - 验证项数据模型
# ============================================================
# 核心作用：定义 VERIFY.md 中的验证项数据模型
# 包含：VerifyItem / VerifyResult / VerifyReport
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from .base import VerifyType


class VerifyStatus(str, Enum):
    """验证状态"""
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"             # 执行错误


@dataclass
class VerifyItem:
    """验证项（VERIFY.md 中的一项）"""
    id: str = field(default_factory=lambda: f"vi_{uuid.uuid4().hex[:8]}")
    title: str = ""                          # 验证项标题
    description: str = ""                    # 详细描述
    verify_type: VerifyType = VerifyType.COMMAND
    target: str = ""                         # 测试文件/命令/路径
    expected: str = ""                       # 期望结果
    timeout: int = 60                        # 超时（秒）
    retry_count: int = 0                     # 最大重试次数
    ac_id: Optional[str] = None              # 关联的 AC id
    status: VerifyStatus = VerifyStatus.PENDING
    last_result: Optional[str] = None
    last_run_at: Optional[str] = None
    execution_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "verify_type": self.verify_type.value,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "VerifyItem":
        return cls(
            id=data.get("id", f"vi_{uuid.uuid4().hex[:8]}"),
            title=data.get("title", ""),
            description=data.get("description", ""),
            verify_type=VerifyType(data.get("verify_type", "command")),
            target=data.get("target", ""),
            expected=data.get("expected", ""),
            timeout=data.get("timeout", 60),
            retry_count=data.get("retry_count", 0),
            ac_id=data.get("ac_id"),
            status=VerifyStatus(data.get("status", "pending")),
            last_result=data.get("last_result"),
            last_run_at=data.get("last_run_at"),
            execution_count=data.get("execution_count", 0),
        )


@dataclass
class VerifyResult:
    """单次验证执行结果"""
    verify_id: str
    status: VerifyStatus
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    error_message: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    attempt: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "status": self.status.value,
        }


@dataclass
class VerifyReport:
    """验证报告（一次完整验证的汇总）"""
    goal_id: str
    total: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errored: int = 0
    results: List[VerifyResult] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    duration_ms: int = 0

    @property
    def pass_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.passed / self.total

    @property
    def is_all_passed(self) -> bool:
        return self.failed == 0 and self.errored == 0 and self.passed == self.total

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal_id": self.goal_id,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errored": self.errored,
            "pass_rate": round(self.pass_rate, 3),
            "is_all_passed": self.is_all_passed,
            "results": [r.to_dict() for r in self.results],
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": self.duration_ms,
        }
