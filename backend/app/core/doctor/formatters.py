"""
# ============================================================
# Hermes Doctor - 报告格式化器
# ============================================================
# 核心作用：将 DoctorReport 格式化为不同输出格式
# 输出模式：
#   - SummaryFormatter: 人类可读概览（默认）
#   - JSONFormatter: 机器可读 JSON
#   - FullFormatter: 完整报告（含全部细节）
#   - PlainFormatter: 禁用颜色（适用于日志）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import json
from typing import Any, Dict

from .base import CheckStatus, DoctorReport


# ============================================================
# ANSI 颜色码
# ============================================================
class Colors:
    """ANSI 颜色码（用于美化输出）"""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[0;31m"
    GREEN = "\033[0;32m"
    YELLOW = "\033[0;33m"
    BLUE = "\033[0;34m"
    CYAN = "\033[0;36m"
    GRAY = "\033[0;90m"

    @classmethod
    def disable(cls) -> None:
        """禁用所有颜色"""
        cls.RESET = ""
        cls.BOLD = ""
        cls.RED = ""
        cls.GREEN = ""
        cls.YELLOW = ""
        cls.BLUE = ""
        cls.CYAN = ""
        cls.GRAY = ""


# ============================================================
# 状态图标
# ============================================================
STATUS_ICONS = {
    "ok": "✅",
    "warning": "⚠️",
    "error": "❌",
    "skipped": "⏭️",
}

STATUS_TEXT = {
    "ok": "OK",
    "warning": "WARN",
    "error": "ERR",
    "skipped": "SKIP",
}


# ============================================================
# 基类
# ============================================================
class BaseFormatter:
    """格式化器基类"""

    def __init__(self, use_color: bool = True):
        self.use_color = use_color
        if not use_color:
            Colors.disable()

    def colorize(self, text: str, color: str) -> str:
        """着色文本"""
        if not self.use_color:
            return text
        return f"{color}{text}{Colors.RESET}"


# ============================================================
# Summary 格式化器（默认）
# ============================================================
class SummaryFormatter(BaseFormatter):
    """人类可读概览"""

    def format(self, report: DoctorReport) -> str:
        lines: list[str] = []
        # 标题
        lines.append("")
        lines.append(
            self.colorize(
                f"🏥 Hermes Doctor v{report.hermes_version}",
                Colors.BOLD + Colors.CYAN,
            )
        )
        lines.append(
            self.colorize(
                f"   {report.timestamp}  |  {report.hostname}  |  报告ID: {report.report_id}",
                Colors.GRAY,
            )
        )
        lines.append("")

        # 各分类汇总
        for cat in report.categories.values():
            icon = STATUS_ICONS.get(cat.overall_status, "·")
            color = {
                "ok": Colors.GREEN,
                "warning": Colors.YELLOW,
                "error": Colors.RED,
                "skipped": Colors.GRAY,
            }.get(cat.overall_status, "")

            if cat.overall_status == "ok":
                line = f"{icon} {cat.title:<20} ({cat.ok_count}/{cat.total_checks} ok, {cat.duration_ms}ms)"
            else:
                line = (
                    f"{icon} {cat.title:<20} "
                    f"({cat.ok_count}/{cat.total_checks} ok, "
                    f"{cat.warning_count} warnings, "
                    f"{cat.error_count} errors, "
                    f"{cat.duration_ms}ms)"
                )
            lines.append(self.colorize(line, color))

        lines.append("")

        # 总体状态
        summary = report.summary
        if report.overall_status == "ok":
            status_line = f"总体状态: {STATUS_ICONS['ok']} OK ({summary.get('ok', 0)}/{summary.get('total', 0)} 通过)"
            status_color = Colors.GREEN
        elif report.overall_status == "warning":
            status_line = (
                f"总体状态: {STATUS_ICONS['warning']} WARNING "
                f"({summary.get('warning', 0)} warnings)"
            )
            status_color = Colors.YELLOW
        else:
            status_line = (
                f"总体状态: {STATUS_ICONS['error']} ERROR "
                f"({summary.get('error', 0)} errors, {summary.get('warning', 0)} warnings)"
            )
            status_color = Colors.RED
        lines.append(self.colorize(status_line, status_color))
        lines.append(self.colorize(f"总耗时: {report.duration_ms}ms", Colors.GRAY))
        lines.append("")

        # 关键问题（error / warning）
        errors = []
        warnings = []
        for cat in report.categories.values():
            for item in cat.items:
                if item.status == "error":
                    errors.append(item)
                elif item.status == "warning":
                    warnings.append(item)

        if errors:
            lines.append(self.colorize(f"❌ 关键问题 ({len(errors)}):", Colors.RED + Colors.BOLD))
            for i, item in enumerate(errors[:10], 1):
                lines.append(f"  {i}. [{item.id}] {item.message or item.name}")
                if item.fix_suggestion:
                    lines.append(self.colorize(f"     修复: {item.fix_suggestion}", Colors.GRAY))
            if len(errors) > 10:
                lines.append(self.colorize(f"  ... 还有 {len(errors) - 10} 个问题", Colors.GRAY))
            lines.append("")

        if warnings:
            lines.append(self.colorize(f"⚠️  警告 ({len(warnings)}):", Colors.YELLOW + Colors.BOLD))
            for i, item in enumerate(warnings[:5], 1):
                lines.append(f"  {i}. [{item.id}] {item.message or item.name}")
            if len(warnings) > 5:
                lines.append(self.colorize(f"  ... 还有 {len(warnings) - 5} 个警告", Colors.GRAY))
            lines.append("")

        if not errors and not warnings:
            lines.append(self.colorize("🎉 所有检查通过！", Colors.GREEN + Colors.BOLD))
            lines.append("")

        return "\n".join(lines)


# ============================================================
# JSON 格式化器
# ============================================================
class JSONFormatter(BaseFormatter):
    """机器可读 JSON"""

    def format(self, report: DoctorReport) -> str:
        return json.dumps(report.to_dict(), indent=2, ensure_ascii=False)


# ============================================================
# Full 格式化器（含 details）
# ============================================================
class FullFormatter(JSONFormatter):
    """完整报告 - 与 JSON 相同但附加 metadata"""

    def format(self, report: DoctorReport) -> str:
        data = report.to_dict()
        # 添加格式化器元信息
        data["_formatter"] = "full"
        data["_generated_by"] = "Hermes Doctor v1.0.0"
        return json.dumps(data, indent=2, ensure_ascii=False)


# ============================================================
# Plain 格式化器（无颜色 summary）
# ============================================================
class PlainFormatter(SummaryFormatter):
    """禁用颜色的 summary"""

    def __init__(self):
        super().__init__(use_color=False)


# ============================================================
# 工厂函数
# ============================================================
def get_formatter(mode: str = "summary", use_color: bool = True) -> BaseFormatter:
    """
    根据模式获取格式化器
    参数：
      - mode: summary / json / all / plain
      - use_color: 是否启用颜色
    """
    if mode == "json":
        return JSONFormatter(use_color=use_color)
    elif mode == "all":
        return FullFormatter(use_color=use_color)
    elif mode == "plain" or not use_color:
        return PlainFormatter()
    else:
        return SummaryFormatter(use_color=use_color)
