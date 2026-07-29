"""
# ============================================================
# Hermes /goal 长时域模式 - Markdown 渲染器
# ============================================================
# 核心作用：Three-File Trust 架构的 Markdown 渲染
# 特性：GOAL.md / VERIFY.md / PROGRESS.md 三种格式生成与解析
# Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .base import (
    AcceptanceCriterion,
    AcceptanceStatus,
    Goal,
    TokenBudget,
)
from .progress import ProgressEntry, ProgressLog
from .verify_item import VerifyItem


# ============================================================
# GOAL.md
# ============================================================
def render_goal_md(goal: Goal) -> str:
    """渲染 GOAL.md"""
    lines: List[str] = []
    lines.append(f"# Goal: {goal.title}")
    lines.append("")
    lines.append(f"> Goal ID: `{goal.id}`  ")
    lines.append(f"> Status: **{goal.status.value}**  ")
    lines.append(f"> Created: {goal.created_at}  ")
    lines.append(f"> Updated: {goal.updated_at}  ")
    lines.append("")

    if goal.objective:
        lines.append("## Objective")
        lines.append("")
        lines.append(goal.objective)
        lines.append("")

    if goal.acceptance_criteria:
        lines.append("## Acceptance Criteria")
        lines.append("")
        for i, ac in enumerate(goal.acceptance_criteria, 1):
            checkbox = {
                AcceptanceStatus.PASSED: "[x]",
                AcceptanceStatus.IN_PROGRESS: "[/]",
                AcceptanceStatus.FAILED: "[!]",
                AcceptanceStatus.SKIPPED: "[-]",
                AcceptanceStatus.PENDING: "[ ]",
            }.get(ac.status, "[ ]")
            lines.append(f"- {checkbox} **AC{i}**: {ac.title} (priority: {ac.priority})")
            if ac.description:
                lines.append(f"  - {ac.description}")
        lines.append("")

    if goal.constraints:
        lines.append("## Constraints")
        lines.append("")
        for c in goal.constraints:
            lines.append(f"- {c}")
        lines.append("")

    tb = goal.token_budget
    lines.append("## Token Budget")
    lines.append("")
    lines.append(f"- 软停止: {tb.soft_limit:,} tokens")
    lines.append(f"- 硬停止: {tb.hard_limit:,} tokens")
    lines.append(f"- 已使用: {tb.used:,} tokens ({tb.utilization*100:.1f}%)")
    lines.append("")

    if goal.tags:
        lines.append("## Tags")
        lines.append("")
        lines.append(" ".join(f"`{t}`" for t in goal.tags))
        lines.append("")

    return "\n".join(lines)


# ============================================================
# VERIFY.md
# ============================================================
def render_verify_md(goal: Goal, items: List[VerifyItem]) -> str:
    """渲染 VERIFY.md"""
    lines: List[str] = []
    lines.append(f"# Verification Checklist for {goal.title}")
    lines.append("")
    lines.append(f"> Goal ID: `{goal.id}`  ")
    lines.append(f"> Total Items: {len(items)}  ")
    lines.append("")

    # 按 AC 分组
    by_ac: Dict[str, List[VerifyItem]] = {}
    for item in items:
        ac_id = item.ac_id or "_unassigned"
        by_ac.setdefault(ac_id, []).append(item)

    for ac_id, ac_items in by_ac.items():
        if ac_id == "_unassigned":
            lines.append("## Unassigned")
        else:
            ac = next((a for a in goal.acceptance_criteria if a.id == ac_id), None)
            if ac:
                lines.append(f"## {ac.title} ({ac_id})")
            else:
                lines.append(f"## {ac_id}")
        lines.append("")
        for item in ac_items:
            checkbox = {
                "passed": "[x]",
                "failed": "[!]",
                "skipped": "[-]",
                "running": "[/]",
                "pending": "[ ]",
            }.get(item.status.value, "[ ]")
            lines.append(f"- {checkbox} **{item.title}**")
            lines.append(f"  - Type: `{item.verify_type.value}`")
            lines.append(f"  - Target: `{item.target}`")
            if item.expected:
                lines.append(f"  - Expected: `{item.expected}`")
            if item.description:
                lines.append(f"  - {item.description}")
        lines.append("")

    return "\n".join(lines)


# ============================================================
# PROGRESS.md
# ============================================================
def render_progress_md(log: ProgressLog) -> str:
    """渲染 PROGRESS.md"""
    lines: List[str] = []
    lines.append("# Progress Log")
    lines.append("")
    lines.append(f"> Goal ID: `{log.goal_id}`  ")
    lines.append(f"> Entries: {len(log.entries)}  ")
    lines.append(f"> Created: {log.created_at}  ")
    lines.append(f"> Updated: {log.updated_at}  ")
    lines.append("")

    for entry in log.entries:
        emoji = {
            "info": "ℹ️",
            "started": "🚀",
            "in_progress": "⏳",
            "completed": "✅",
            "failed": "❌",
            "blocked": "🚧",
            "retry": "🔁",
            "paused": "⏸️",
            "resumed": "▶️",
            "warning": "⚠️",
            "error": "💥",
        }.get(entry.status.value, "•")
        lines.append(f"## {entry.timestamp} {emoji} {entry.status.value.upper()}")
        lines.append("")
        if entry.ac_id:
            lines.append(f"- AC: `{entry.ac_id}`")
        lines.append(f"- Action: {entry.action.description}")
        if entry.action.target:
            lines.append(f"- Target: `{entry.action.target}`")
        if entry.action.result:
            lines.append(f"- Result: {entry.action.result}")
        if entry.tokens_used > 0:
            lines.append(f"- Tokens Used: {entry.tokens_used:,}")
        if entry.duration_ms > 0:
            lines.append(f"- Duration: {entry.duration_ms}ms")
        if entry.notes:
            lines.append(f"- Notes: {entry.notes}")
        lines.append("")

    return "\n".join(lines)


# ============================================================
# 解析器
# ============================================================
def parse_goal_md(content: str) -> Dict[str, Any]:
    """解析 GOAL.md（简单解析）"""
    result: Dict[str, Any] = {
        "title": "",
        "objective": "",
        "acceptance_criteria": [],
        "constraints": [],
        "token_budget": {},
        "tags": [],
    }

    lines = content.split("\n")
    current_section = None
    current_ac: Dict[str, Any] = {}

    for line in lines:
        line_stripped = line.strip()

        if line_stripped.startswith("# Goal:"):
            result["title"] = line_stripped[7:].strip()
            continue

        if line_stripped.startswith("## "):
            current_section = line_stripped[3:].strip().lower()
            if current_section == "acceptance criteria":
                current_section = "ac"
            elif current_section == "token budget":
                current_section = "token_budget"
            continue

        if current_section == "objective" and line_stripped:
            result["objective"] += line_stripped + " "

        if current_section == "constraints" and line_stripped.startswith("- "):
            result["constraints"].append(line_stripped[2:])

        if current_section == "ac" and line_stripped.startswith("- "):
            # 解析 AC
            content_str = line_stripped[2:]
            if content_str.startswith("["):
                # 新 AC
                if current_ac:
                    result["acceptance_criteria"].append(current_ac)
                current_ac = {
                    "title": re.sub(r"^\[[^\]]+\]\s*\*\*[^\*]+\*\*:\s*", "", content_str).strip(),
                    "description": "",
                    "priority": 1,
                }
            elif line_stripped.startswith("  - "):
                # 描述行
                if current_ac:
                    current_ac["description"] += line_stripped[4:] + " "

        if current_section == "token_budget":
            if "软停止" in line_stripped or "soft" in line_stripped.lower():
                m = re.search(r"(\d+)", line_stripped)
                if m:
                    result["token_budget"]["soft_limit"] = int(m.group(1))
            elif "硬停止" in line_stripped or "hard" in line_stripped.lower():
                m = re.search(r"(\d+)", line_stripped)
                if m:
                    result["token_budget"]["hard_limit"] = int(m.group(1))

        if current_section == "tags" and line_stripped:
            for t in line_stripped.split():
                t = t.strip("`")
                if t:
                    result["tags"].append(t)

    if current_ac:
        result["acceptance_criteria"].append(current_ac)

    return result
