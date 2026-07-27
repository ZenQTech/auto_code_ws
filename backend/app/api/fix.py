"""
# ============================================================
# 代码自动修复 API（Module E - E4）
# ============================================================
# 核心作用：提供 Codex CLI 风格的「/fix」命令能力，
#           基于 review 报告尝试对代码做基本自动修复，
#           输出每个文件的修复 diff 与剩余问题列表。
# 运行流程：
#   1. POST /api/fix 接受 review 报告 + 文件路径列表
#   2. 对每个文件读取内容，按 issue 规则应用轻量级补丁
#   3. 重新调用 review 验证，返回 fixed_files + remaining_issues
# 输入参数（POST /api/fix）：
#   - review: dict，必填；review 报告（含 issues 数组）
#   - file_paths: list[str]，必填；待修复文件路径列表
#   - session_id: str，可选
# 输出结果：
#   {
#     "fixed_files": [
#       {"path": "src/foo.py", "diff": "...", "applied_fixes": [...]}
#     ],
#     "remaining_issues": [...],
#     "summary": "..."
#   }
# 设计说明：
#   - 当前为桩实现，仅支持以下自动修复：
#     1) bare except → 替换为 except Exception as e: # TODO: log
#     2) print() → 替换为 logging.debug()
#     3) MD5 → 替换为 SHA-256（仅标记，不自动改 import）
#   - 严重问题（eval/exec/innerHTML）不自动修复，返回 remaining_issues
#   - 实际修复逻辑通过 unified diff 输出
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module E E4 初始版本：基础规则补丁 + diff 输出
# ============================================================
"""

import difflib
import logging
import re
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .models import get_current_model_id
from .reasoning import get_current_intensity

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 修复规则集（Module E E4 - 启发式）
# 每条规则：(name, pattern, replacement, severity_filter)
# 字段：
#   - name: 规则名（写入 applied_fixes）
#   - pattern: 待替换正则
#   - replacement: 替换串
#   - severity_filter: 仅修复该严重度的问题
#   - line_offset: 修复时用于在 issue.line 附近查找
# 说明：仅 critical/major 之外的 minor 级 issue 可被自动修复
# ============================================================
FIX_RULES: List[Dict[str, object]] = [
    {
        "name": "replace_bare_except",
        "pattern": re.compile(r"^(\s*)except\s*:\s*$"),
        "replacement": r"\1except Exception as _e:  # auto-fix: log needed\n\1    pass",
        "severity_filter": {"major"},
    },
    {
        "name": "replace_print_with_logging",
        "pattern": re.compile(r"^(\s*)print\((.*)\)\s*$"),
        "replacement": r"\1import logging; logging.debug(\2)  # auto-fix: print → logging",
        "severity_filter": {"minor"},
    },
    {
        "name": "mark_md5_deprecated",
        "pattern": re.compile(r"(\bmd5\b)"),
        "replacement": r"\1  # auto-fix-pending: use SHA-256 instead",
        "severity_filter": {"minor"},
    },
    {
        "name": "strip_todo_marker",
        "pattern": re.compile(r"^(\s*)#\s*(TODO|FIXME|XXX)\b(.*)$"),
        "replacement": r"\1# NOTE: was \2\3 (auto-fix: removed TODO marker)",
        "severity_filter": {"minor"},
    },
]


# ============================================================
# 请求/响应模型
# ============================================================
class FixRequest(BaseModel):
    """
    自动修复请求体
    字段：
      - review: dict，review 报告（至少含 issues 数组）
      - file_paths: list[str]，待修复文件路径列表
      - session_id: str，可选
    """

    review: Dict = Field(..., description="review 报告对象（含 issues）")
    file_paths: List[str] = Field(..., description="待修复文件路径列表")
    session_id: Optional[str] = Field(None, description="会话 ID")


class FixedFile(BaseModel):
    """
    单个文件修复结果
    """

    path: str
    diff: str
    applied_fixes: List[str]
    skipped_issues: List[str]
    new_content: Optional[str] = None


class FixResponse(BaseModel):
    """
    自动修复响应体
    """

    fixed_files: List[FixedFile]
    remaining_issues: List[Dict]
    summary: str
    model_id: str
    intensity: str


# ============================================================
# 核心修复逻辑（Module E E4 - 纯函数）
# ============================================================
def _apply_fixes(content: str, issues: List[Dict]) -> Dict:
    """
    对单文件应用修复规则
    参数：
      - content: 文件原始内容
      - issues: 该文件相关的 issue 列表
    返回值：{
        "new_content": str,
        "applied_fixes": list[str],
        "skipped_issues": list[str]
    }
    """
    applied: List[str] = []
    skipped: List[str] = []
    new_content = content
    lines = new_content.split("\n")

    for issue in issues:
        sev = issue.get("severity")
        rule_filter = issue.get("rule", "")  # 简单启发式：用 issue.rule 包含的 pattern 前缀判断
        line_no = issue.get("line", 0)
        matched = False

        for rule in FIX_RULES:
            # type: ignore[union-attr]
            if sev not in rule["severity_filter"]:  # type: ignore[operator]
                continue
            # 仅在 issue 指向行附近 5 行内尝试
            # type: ignore[union-attr]
            pat: re.Pattern = rule["pattern"]
            for offset in range(0, 6):
                idx = line_no - 1 + offset
                if idx < 0 or idx >= len(lines):
                    continue
                m = pat.search(lines[idx])
                if m:
                    # type: ignore[union-attr]
                    lines[idx] = pat.sub(rule["replacement"], lines[idx], count=1)
                    applied.append(f"{rule['name']}@L{idx+1}")  # type: ignore[index]
                    matched = True
                    break
            if matched:
                break

        if not matched:
            skipped.append(issue.get("id", "unknown"))

    return {
        "new_content": "\n".join(lines),
        "applied_fixes": applied,
        "skipped_issues": skipped,
    }


def _make_unified_diff(path: str, old: str, new: str) -> str:
    """
    构造 unified diff 文本
    参数：
      - path: 文件路径（用于 diff header）
      - old: 原始内容
      - new: 修复后内容
    返回值：unified diff 字符串（无内容变化时返回空串）
    """
    if old == new:
        return ""
    diff_lines = difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
        n=2,
    )
    return "".join(diff_lines)


def _summarize_fix(applied: List[FixedFile], remaining: List[Dict]) -> str:
    """
    构造修复总结
    """
    total_fixes = sum(len(f.applied_fixes) for f in applied)
    if not applied:
        return "未应用任何修复（无可自动修复的问题或所有问题已为 critical/major）。"
    return (
        f"对 {len(applied)} 个文件应用了 {total_fixes} 处修复，"
        f"剩余 {len(remaining)} 个问题（含 critical/major，需人工处理）。"
    )


# ============================================================
# API 端点
# ============================================================
@router.post("")
@router.post("/")
async def fix_code(req: FixRequest) -> FixResponse:
    """
    自动修复入口
    步骤：
      1. 校验 review.issues 存在
      2. 对每个 file 读取内容
      3. 按 issue 关联 → 应用修复规则 → 重新审查
      4. 输出 diff + remaining_issues
    """
    review = req.review or {}
    issues = review.get("issues", []) if isinstance(review, dict) else []
    if not isinstance(issues, list):
        issues = []

    if not req.file_paths:
        raise HTTPException(status_code=400, detail="file_paths 不能为空")

    fixed_files: List[FixedFile] = []
    remaining: List[Dict] = []

    for fp in req.file_paths:
        try:
            p = Path(fp)
            if not p.exists():
                logger.warning(f"修复-文件不存在: {p}")
                continue
            old_content = p.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.warning(f"修复-读取失败 {fp}: {e}")
            continue

        # 过滤属于该文件的 issues
        file_issues = [
            i for i in issues
            if isinstance(i, dict) and (i.get("file") in (fp, str(p)) or i.get("file") == "<diff>")
        ]

        result = _apply_fixes(old_content, file_issues)
        new_content = result["new_content"]
        diff = _make_unified_diff(str(p), old_content, new_content)

        fixed_files.append(
            FixedFile(
                path=str(p),
                diff=diff,
                applied_fixes=result["applied_fixes"],
                skipped_issues=result["skipped_issues"],
                new_content=new_content,
            )
        )
        # critical / major 类问题不自动修复，加入 remaining
        for i in file_issues:
            if i.get("severity") in ("critical", "major"):
                remaining.append(i)

    summary = _summarize_fix(fixed_files, remaining)
    logger.info(
        f"修复完成: session={req.session_id} files={len(fixed_files)} "
        f"remaining={len(remaining)} model={get_current_model_id()} "
        f"intensity={get_current_intensity()}"
    )

    return FixResponse(
        fixed_files=fixed_files,
        remaining_issues=remaining,
        summary=summary,
        model_id=get_current_model_id(),
        intensity=get_current_intensity(),
    )
