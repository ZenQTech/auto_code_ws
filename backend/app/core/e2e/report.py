"""
# ============================================================
# 多格式报告生成器
# ============================================================
# 核心作用：生成 HTML/JSON/Markdown 三种格式测试报告
# 特性：测试摘要、详细结果、错误堆栈、截图嵌入
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import TestReport

logger = logging.getLogger(__name__)


class ReportGenerator:
    """测试报告生成器"""

    def __init__(self, output_dir: str = "/home/qizheng/auto_code_ws/tests/e2e_reports"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate(self, report: TestReport, formats: Optional[List[str]] = None) -> Dict[str, str]:
        """
        生成多格式报告
        返回 {format: filepath}
        """
        if formats is None:
            formats = ["html", "json", "markdown"]
        result: Dict[str, str] = {}
        for fmt in formats:
            try:
                if fmt == "html":
                    path = self.generate_html(report)
                elif fmt == "json":
                    path = self.generate_json(report)
                elif fmt == "markdown":
                    path = self.generate_markdown(report)
                else:
                    continue
                result[fmt] = path
            except Exception as e:
                logger.error(f"failed to generate {fmt} report: {e}")
        return result

    def generate_json(self, report: TestReport) -> str:
        """生成 JSON 报告"""
        path = self.output_dir / f"{report.report_id}.json"
        path.write_text(
            json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info(f"generated JSON report: {path}")
        return str(path)

    def generate_markdown(self, report: TestReport) -> str:
        """生成 Markdown 报告（GitHub 友好）"""
        lines: List[str] = []
        # 标题
        lines.append(f"# E2E Test Report: `{report.report_id}`")
        lines.append("")
        lines.append(f"- **Generated**: {report.timestamp}")
        lines.append(f"- **Duration**: {report.duration_ms}ms ({report.duration_ms / 1000:.2f}s)")
        lines.append(f"- **Pass Rate**: {report.pass_rate():.1%}")
        lines.append("")
        # 摘要
        lines.append("## Summary")
        lines.append("")
        lines.append("| Status | Count |")
        lines.append("|--------|-------|")
        lines.append(f"| ✅ Passed | {report.passed} |")
        lines.append(f"| ❌ Failed | {report.failed} |")
        lines.append(f"| 💥 Error | {report.error} |")
        lines.append(f"| ⏭️ Skipped | {report.skipped} |")
        lines.append(f"| **Total** | **{report.total_scenarios}** |")
        lines.append("")
        # 详细结果
        if report.results:
            lines.append("## Scenarios")
            lines.append("")
            for r in report.results:
                status_emoji = {
                    "passed": "✅",
                    "failed": "❌",
                    "error": "💥",
                    "skipped": "⏭️",
                }.get(r.status, "❓")
                lines.append(f"### {status_emoji} {r.scenario_name} ({r.scenario_id})")
                lines.append("")
                lines.append(f"- **Status**: {r.status}")
                lines.append(f"- **Duration**: {r.duration_ms}ms")
                if r.description:
                    lines.append(f"- **Description**: {r.description}")
                if r.error:
                    lines.append(f"- **Error**: `{r.error}`")
                # 步骤详情
                if r.steps:
                    lines.append("")
                    lines.append("#### Steps")
                    lines.append("")
                    lines.append("| Step | Status | Duration | Message |")
                    lines.append("|------|--------|----------|---------|")
                    for step in r.steps:
                        step_emoji = {
                            "passed": "✅",
                            "failed": "❌",
                            "error": "💥",
                            "skipped": "⏭️",
                        }.get(step.status, "❓")
                        msg = step.message or step.error or ""
                        if len(msg) > 50:
                            msg = msg[:47] + "..."
                        lines.append(
                            f"| {step.name} | {step_emoji} {step.status} | {step.duration_ms}ms | {msg} |"
                        )
                lines.append("")

        content = "\n".join(lines)
        path = self.output_dir / f"{report.report_id}.md"
        path.write_text(content, encoding="utf-8")
        logger.info(f"generated Markdown report: {path}")
        return str(path)

    def generate_html(self, report: TestReport) -> str:
        """生成 HTML 报告"""
        rows: List[str] = []
        for r in report.results:
            status_class = r.status
            error_html = ""
            if r.error:
                error_html = f'<div class="error">⚠️ {self._html_escape(r.error)}</div>'
            steps_html = ""
            if r.steps:
                step_items = []
                for step in r.steps:
                    step_class = step.status
                    step_msg = step.message or ""
                    if step.error:
                        step_msg += f" | Error: {step.error}"
                    msg_span = (
                        f'<span class="step-msg">{self._html_escape(step_msg)}</span>'
                        if step_msg else ""
                    )
                    step_items.append(
                        f'<li class="step step-{step_class}">'
                        f'<span class="step-name">{self._html_escape(step.name)}</span>'
                        f'<span class="step-status">{step.status}</span>'
                        f'<span class="step-duration">{step.duration_ms}ms</span>'
                        f'{msg_span}'
                        f'</li>'
                    )
                steps_html = f'<ul class="steps">{"".join(step_items)}</ul>'

            rows.append(
                f'<div class="scenario scenario-{status_class}">'
                f'<div class="scenario-header">'
                f'<span class="status-badge status-{status_class}">{status_class.upper()}</span>'
                f'<span class="scenario-name">{self._html_escape(r.scenario_name)}</span>'
                f'<span class="scenario-id">({r.scenario_id})</span>'
                f'<span class="scenario-duration">{r.duration_ms}ms</span>'
                f'</div>'
                f'{error_html}'
                f'{steps_html}'
                f'</div>'
            )

        scenarios_html = "".join(rows)
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>E2E Report - {report.report_id}</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0;
    padding: 20px;
    background: #f5f5f5;
    color: #333;
  }}
  .container {{ max-width: 1200px; margin: 0 auto; background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  h1 {{ color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }}
  .summary {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 20px 0; }}
  .stat {{ background: #f9fafb; padding: 16px; border-radius: 6px; text-align: center; }}
  .stat-value {{ font-size: 28px; font-weight: 700; }}
  .stat-label {{ font-size: 12px; color: #6b7280; text-transform: uppercase; margin-top: 4px; }}
  .stat.passed .stat-value {{ color: #10b981; }}
  .stat.failed .stat-value {{ color: #ef4444; }}
  .stat.error .stat-value {{ color: #f97316; }}
  .stat.skipped .stat-value {{ color: #6b7280; }}
  .scenario {{ border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 12px; overflow: hidden; }}
  .scenario-header {{ display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fafafa; }}
  .status-badge {{ padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: white; }}
  .status-passed {{ background: #10b981; }}
  .status-failed {{ background: #ef4444; }}
  .status-error {{ background: #f97316; }}
  .status-skipped {{ background: #6b7280; }}
  .scenario-name {{ font-weight: 600; }}
  .scenario-id {{ color: #9ca3af; font-size: 12px; }}
  .scenario-duration {{ margin-left: auto; color: #6b7280; font-size: 13px; }}
  .error {{ background: #fef2f2; color: #b91c1c; padding: 8px 16px; font-family: monospace; font-size: 13px; }}
  .steps {{ list-style: none; padding: 0; margin: 0; }}
  .step {{ display: flex; align-items: center; gap: 12px; padding: 6px 16px; font-size: 13px; border-top: 1px solid #f3f4f6; }}
  .step-name {{ flex: 1; }}
  .step-status {{ font-size: 11px; padding: 1px 6px; border-radius: 3px; color: white; background: #6b7280; }}
  .step-passed .step-status {{ background: #10b981; }}
  .step-failed .step-status {{ background: #ef4444; }}
  .step-error .step-status {{ background: #f97316; }}
  .step-duration {{ color: #9ca3af; font-size: 12px; }}
  .step-msg {{ color: #6b7280; font-size: 12px; }}
</style>
</head>
<body>
  <div class="container">
    <h1>🧪 E2E Test Report</h1>
    <p><strong>Report ID:</strong> {report.report_id}</p>
    <p><strong>Generated:</strong> {report.timestamp}</p>
    <p><strong>Duration:</strong> {report.duration_ms}ms ({report.duration_ms / 1000:.2f}s)</p>
    <p><strong>Pass Rate:</strong> <span style="color: {self._pass_rate_color(report.pass_rate())}">{report.pass_rate():.1%}</span></p>

    <div class="summary">
      <div class="stat passed"><div class="stat-value">{report.passed}</div><div class="stat-label">Passed</div></div>
      <div class="stat failed"><div class="stat-value">{report.failed}</div><div class="stat-label">Failed</div></div>
      <div class="stat error"><div class="stat-value">{report.error}</div><div class="stat-label">Error</div></div>
      <div class="stat skipped"><div class="stat-value">{report.skipped}</div><div class="stat-label">Skipped</div></div>
      <div class="stat"><div class="stat-value">{report.total_scenarios}</div><div class="stat-label">Total</div></div>
    </div>

    <h2>Scenarios</h2>
    {scenarios_html}
  </div>
</body>
</html>
"""
        path = self.output_dir / f"{report.report_id}.html"
        path.write_text(html, encoding="utf-8")
        logger.info(f"generated HTML report: {path}")
        return str(path)

    def _html_escape(self, text: str) -> str:
        """HTML 转义"""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    def _pass_rate_color(self, rate: float) -> str:
        """根据通过率返回颜色"""
        if rate >= 0.95:
            return "#10b981"
        elif rate >= 0.7:
            return "#f59e0b"
        else:
            return "#ef4444"
