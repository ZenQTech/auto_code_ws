"""
Hermes Agent v2 - 调度器
==========================================
核心作用：Thread Automation 调度器
        支持 Cron、Interval、Event、One-shot 四种调度类型
        维护调度表 + 异步执行任务
运行流程：扫描待执行任务 → 检查调度条件 → 触发执行 → 更新下次执行时间
输入参数：调度表达式、动作、任务 ID
输出结果：调度结果 + 后台任务
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import re
import asyncio
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from threading import RLock

from .models import (
    ThreadAutomation,
    BackgroundTask,
    ScheduleType,
    AutomationStatus,
    BackgroundTaskStatus,
    _new_id,
    _now_iso,
)


# 路径白名单 - 用于执行命令时校验
PATH_WHITELIST_PREFIXES = (
    "/home/",
    "/tmp/",
    "/var/log/",
    "/opt/",
    "/workspace/",
    "./",
    ".",
)

# 危险命令黑名单
DANGEROUS_COMMAND_PATTERNS = (
    r"\brm\s+-rf\s+/",
    r"\bdd\s+if=",
    r"\bmkfs\b",
    r"\bformat\b",
    r":\(\)\s*\{.*:\|:&.*\}\s*;:",  # Fork bomb
    r"\bchmod\s+777\s+/",
    r"\bchown\s+-R\s+",
    r"curl.*\|\s*bash",  # Pipe to bash
    r"wget.*\|\s*sh",
)

# Cron 字段范围
CRON_FIELD_RANGES = [
    (0, 59),   # minute
    (0, 23),   # hour
    (1, 31),   # day of month
    (1, 12),   # month
    (0, 6),    # day of week
]


def _validate_command(command: str) -> bool:
    """验证命令安全性

    Args:
        command: 待验证命令

    Returns:
        bool: True 表示安全
    """
    if not command:
        return True
    for pattern in DANGEROUS_COMMAND_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return False
    return True


def _parse_cron_field(field: str, min_val: int, max_val: int) -> List[int]:
    """解析 cron 字段

    支持：
    - * (所有值)
    - 数字 (1, 5, 10)
    - 范围 (1-5)
    - 步长 (*/5, 1-30/2)

    Args:
        field: cron 字段字符串
        min_val: 最小值
        max_val: 最大值

    Returns:
        List[int]: 匹配的值列表
    """
    if field == "*":
        return list(range(min_val, max_val + 1))

    if "/" in field:
        # 步长
        base, step = field.split("/", 1)
        step = int(step)
        if base == "*":
            start, end = min_val, max_val
        elif "-" in base:
            start, end = map(int, base.split("-", 1))
        else:
            start, end = int(base), max_val
        return list(range(start, end + 1, step))

    if "-" in field:
        start, end = map(int, field.split("-", 1))
        return list(range(start, end + 1))

    if "," in field:
        result = []
        for part in field.split(","):
            result.extend(_parse_cron_field(part, min_val, max_val))
        return sorted(set(result))

    # 单个值
    val = int(field)
    if min_val <= val <= max_val:
        return [val]
    return []


def _parse_cron(cron_expr: str) -> Optional[Dict[str, List[int]]]:
    """解析 cron 表达式

    Args:
        cron_expr: 5 字段 cron 表达式

    Returns:
        Optional[Dict[str, List[int]]]: 解析结果，失败时返回 None
    """
    if not cron_expr:
        return None

    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return None

    try:
        result = {}
        for i, part in enumerate(parts):
            min_v, max_v = CRON_FIELD_RANGES[i]
            values = _parse_cron_field(part, min_v, max_v)
            if not values:
                return None
            result[["minute", "hour", "day", "month", "weekday"][i]] = values
        return result
    except (ValueError, IndexError):
        return None


def _next_cron_time(cron_expr: str, after: Optional[datetime] = None) -> Optional[datetime]:
    """计算 cron 下次执行时间

    Args:
        cron_expr: cron 表达式
        after: 起始时间（默认当前）

    Returns:
        Optional[datetime]: 下次执行时间
    """
    parsed = _parse_cron(cron_expr)
    if not parsed:
        return None

    if after is None:
        after = datetime.now(timezone.utc)

    # 从 after + 1 分钟开始搜索
    candidate = after.replace(second=0, microsecond=0) + timedelta(minutes=1)

    # 最多搜索 366 天
    end = candidate + timedelta(days=366)

    while candidate < end:
        if (
            candidate.minute in parsed["minute"]
            and candidate.hour in parsed["hour"]
            and candidate.day in parsed["day"]
            and candidate.month in parsed["month"]
            and candidate.weekday() in parsed["weekday"]
        ):
            return candidate
        candidate += timedelta(minutes=1)

    return None


def _parse_interval(interval_str: str) -> Optional[int]:
    """解析 interval 表达式

    支持格式：
    - 纯数字（秒）"300"
    - 带后缀 "5m" "2h" "1d"

    Args:
        interval_str: interval 字符串

    Returns:
        Optional[int]: 间隔秒数，失败时返回 None
    """
    if not interval_str:
        return None

    interval_str = interval_str.strip()

    # 纯数字
    if interval_str.isdigit():
        return int(interval_str)

    # 带后缀
    match = re.match(r"^(\d+)([smhd])$", interval_str, re.IGNORECASE)
    if match:
        value = int(match.group(1))
        unit = match.group(2).lower()
        multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return value * multiplier

    return None


def _next_interval_time(interval_sec: int, after: Optional[datetime] = None) -> datetime:
    """计算 interval 下次执行时间

    Args:
        interval_sec: 间隔秒数
        after: 起始时间（默认当前）

    Returns:
        datetime: 下次执行时间
    """
    if after is None:
        after = datetime.now(timezone.utc)
    return after + timedelta(seconds=interval_sec)


class Scheduler:
    """Thread Automation 调度器

    维护 ThreadAutomation 列表 + 计算下次执行时间
    线程安全（RLock）

    Attributes:
        automations: 自动化任务字典
    """

    def __init__(self) -> None:
        """初始化调度器"""
        self._lock = RLock()
        self._automations: Dict[str, ThreadAutomation] = {}

    @property
    def count(self) -> int:
        """获取自动化任务总数

        Returns:
            int: 任务总数
        """
        with self._lock:
            return len(self._automations)

    def add(self, automation: ThreadAutomation) -> ThreadAutomation:
        """添加自动化任务

        Args:
            automation: 任务实体

        Returns:
            ThreadAutomation: 添加后的任务（已计算 next_run）
        """
        with self._lock:
            # 计算下次执行时间
            automation.next_run = self._compute_next_run(automation)
            self._automations[automation.automation_id] = automation
            return automation

    def update(self, automation: ThreadAutomation) -> ThreadAutomation:
        """更新自动化任务

        Args:
            automation: 任务实体

        Returns:
            ThreadAutomation: 更新后的任务
        """
        with self._lock:
            if automation.automation_id not in self._automations:
                raise KeyError(f"Automation not found: {automation.automation_id}")
            automation.next_run = self._compute_next_run(automation)
            self._automations[automation.automation_id] = automation
            return automation

    def remove(self, automation_id: str) -> bool:
        """删除自动化任务

        Args:
            automation_id: 任务 ID

        Returns:
            bool: True 表示删除成功
        """
        with self._lock:
            return self._automations.pop(automation_id, None) is not None

    def get(self, automation_id: str) -> Optional[ThreadAutomation]:
        """获取自动化任务

        Args:
            automation_id: 任务 ID

        Returns:
            Optional[ThreadAutomation]: 任务实体
        """
        with self._lock:
            return self._automations.get(automation_id)

    def list_all(
        self,
        enabled_only: bool = False,
        owner: Optional[str] = None,
    ) -> List[ThreadAutomation]:
        """列出所有自动化任务

        Args:
            enabled_only: 仅列出启用的
            owner: 按所有者过滤

        Returns:
            List[ThreadAutomation]: 任务列表
        """
        with self._lock:
            results = list(self._automations.values())
            if enabled_only:
                results = [a for a in results if a.enabled]
            if owner:
                results = [a for a in results if a.owner == owner]
            return results

    def get_due(self, now: Optional[datetime] = None) -> List[ThreadAutomation]:
        """获取到期的任务

        Args:
            now: 当前时间（默认当前）

        Returns:
            List[ThreadAutomation]: 到期任务列表
        """
        if now is None:
            now = datetime.now(timezone.utc)

        with self._lock:
            due: List[ThreadAutomation] = []
            for auto in self._automations.values():
                if not auto.enabled:
                    continue
                if auto.status != AutomationStatus.ACTIVE.value:
                    continue
                if auto.max_runs is not None and auto.run_count >= auto.max_runs:
                    continue
                if auto.next_run is None:
                    continue
                try:
                    next_run_dt = datetime.fromisoformat(auto.next_run)
                    if next_run_dt <= now:
                        due.append(auto)
                except (ValueError, TypeError):
                    continue
            return due

    def _compute_next_run(self, automation: ThreadAutomation) -> Optional[str]:
        """计算下次执行时间

        Args:
            automation: 任务实体

        Returns:
            Optional[str]: ISO 格式时间字符串
        """
        now = datetime.now(timezone.utc)

        if automation.schedule_type == ScheduleType.CRON.value:
            next_dt = _next_cron_time(automation.schedule, after=now)
        elif automation.schedule_type == ScheduleType.INTERVAL.value:
            interval = _parse_interval(automation.schedule)
            if interval is None:
                return None
            next_dt = _next_interval_time(interval, after=now)
        elif automation.schedule_type == ScheduleType.ONE_SHOT.value:
            # 单次执行：解析 ISO 时间
            try:
                next_dt = datetime.fromisoformat(automation.schedule)
                if next_dt < now:
                    return None
            except (ValueError, TypeError):
                return None
        elif automation.schedule_type == ScheduleType.EVENT.value:
            # 事件触发：没有固定时间
            return None
        else:
            return None

        return next_dt.isoformat() if next_dt else None

    def mark_run(self, automation_id: str) -> Optional[ThreadAutomation]:
        """标记任务已执行 + 计算下次时间

        Args:
            automation_id: 任务 ID

        Returns:
            Optional[ThreadAutomation]: 更新后的任务
        """
        with self._lock:
            auto = self._automations.get(automation_id)
            if auto is None:
                return None

            auto.last_run = _now_iso()
            auto.run_count += 1
            auto.next_run = self._compute_next_run(auto)
            return auto
