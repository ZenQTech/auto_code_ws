"""
# ============================================================
# Triage Service - /loop triage 实现
# ============================================================
# 核心作用：解析 tasks.md 文件，提取所有 - [ ] 任务，
#          按 P0/P1/P2 优先级排序，输出任务列表
# 运行流程：
#   1. 读取 project_path/tasks.md
#   2. 解析每一行 - [ ] 项
#   3. 提取 P0/P1/P2 优先级标签
#   4. 按优先级 + 行号排序
#   5. 返回分组结果
# 输入参数：project_path 项目根目录
# 输出结果：dict {total_tasks, by_priority, next_recommended}
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class TaskItem:
    """tasks.md 中的单个任务项"""

    title: str
    priority: str  # P0/P1/P2
    status: str  # pending/in_progress/completed
    line_number: int
    file_path: str
    subtasks: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 任务解析
# ============================================================

# 匹配任务行: - [ ] **P0** 任务标题
# 注意：^[-\\*] 而不是 ^[\\s]*，避免匹配缩进的子任务
TASK_PATTERN = re.compile(
    r"^[-\*]\s+\[(?P<status>[ xX])\]\s+"
    r"(?:\*\*(?P<priority>P[012])\*\*\s+)?"
    r"(?P<title>.+?)$"
)

# 匹配子任务: - [ ] 子任务标题（必须缩进）
SUBTASK_PATTERN = re.compile(
    r"^[\s]+[-*]\s+\[(?P<status>[ xX])\]\s+(?P<title>.+?)$"
)


def parse_tasks(tasks_file_path: str) -> List[TaskItem]:
    """解析 tasks.md 文件，提取所有任务项

    Args:
        tasks_file_path: tasks.md 文件路径

    Returns:
        任务项列表
    """
    path = Path(tasks_file_path)
    if not path.exists():
        return []

    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()

    tasks: List[TaskItem] = []
    current_task: Optional[TaskItem] = None

    for idx, line in enumerate(lines, start=1):
        # 匹配主任务
        match = TASK_PATTERN.match(line)
        if match:
            status_code = match.group("status").lower()
            status_map = {" ": "pending", "x": "completed"}
            priority = match.group("priority") or "P2"

            current_task = TaskItem(
                title=match.group("title").strip(),
                priority=priority,
                status=status_map.get(status_code, "pending"),
                line_number=idx,
                file_path=str(path),
            )
            tasks.append(current_task)
            continue

        # 匹配子任务（缩进的任务）
        if current_task is not None:
            sub_match = SUBTASK_PATTERN.match(line)
            if sub_match:
                sub_status = sub_match.group("status").lower()
                if sub_status == " ":
                    current_task.subtasks.append(sub_match.group("title").strip())

    return tasks


def sort_tasks_by_priority(tasks: List[TaskItem]) -> List[TaskItem]:
    """按优先级排序任务

    Args:
        tasks: 任务列表

    Returns:
        排序后的任务列表（P0 优先，按行号）
    """
    priority_order = {"P0": 0, "P1": 1, "P2": 2}
    return sorted(
        tasks,
        key=lambda t: (priority_order.get(t.priority, 99), t.line_number),
    )


# ============================================================
# Triage Service
# ============================================================


class TriageService:
    """Triage 服务 - 分析 tasks.md 任务优先级"""

    def __init__(self, project_path: str):
        """初始化 Triage 服务

        Args:
            project_path: 项目根目录
        """
        self.project_path = Path(project_path)
        self.tasks_file = self.project_path / "tasks.md"

    def analyze(self) -> Dict[str, Any]:
        """分析任务并返回分组结果

        Returns:
            {
                "total_tasks": int,
                "by_priority": {"P0": [...], "P1": [...], "P2": [...]},
                "by_status": {"pending": [...], "completed": [...]},
                "next_recommended": Optional[TaskItem],
            }
        """
        if not self.tasks_file.exists():
            return {
                "error": f"tasks.md not found at {self.tasks_file}",
                "total_tasks": 0,
                "by_priority": {"P0": [], "P1": [], "P2": []},
                "by_status": {"pending": [], "completed": []},
                "next_recommended": None,
            }

        all_tasks = parse_tasks(str(self.tasks_file))
        sorted_tasks = sort_tasks_by_priority(all_tasks)

        # 按优先级分组
        by_priority: Dict[str, List[Dict[str, Any]]] = {"P0": [], "P1": [], "P2": []}
        for task in sorted_tasks:
            if task.priority in by_priority:
                by_priority[task.priority].append(task.to_dict())

        # 按状态分组
        by_status: Dict[str, List[Dict[str, Any]]] = {"pending": [], "completed": []}
        for task in all_tasks:
            by_status.setdefault(task.status, []).append(task.to_dict())

        # 下一个推荐任务（最高优先级 + pending）
        next_recommended = None
        for task in sorted_tasks:
            if task.status == "pending":
                next_recommended = task.to_dict()
                break

        return {
            "total_tasks": len(all_tasks),
            "pending_count": sum(1 for t in all_tasks if t.status == "pending"),
            "completed_count": sum(1 for t in all_tasks if t.status == "completed"),
            "by_priority": by_priority,
            "by_status": by_status,
            "next_recommended": next_recommended,
        }
