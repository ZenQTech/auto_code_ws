"""
# ============================================================
# 代码审查 API（Module E - E3 + E6 review-fix-loop 入口）
# ============================================================
# 核心作用：提供 Codex CLI 风格的「/review」命令能力，
#           对代码 diff / 文件内容进行轻量级模式匹配审查，
#           输出结构化问题列表（含严重程度 / 位置 / 修复建议）。
#           同时承载 E6 review-fix 循环入口（/api/review-fix-loop）。
# 运行流程：
#   1. POST /api/review         → 对 code_diff / files 做模式匹配审查
#   2. POST /api/review-fix-loop → 调用 ReviewFixLoop 服务，最长 3 轮自迭代
# 输入参数（POST /api/review）：
#   - code_diff: str，可选；git diff 文本
#   - files: list[str]，可选；待审查文件路径列表（自动读取内容）
#   - session_id: str，可选；用于日志关联
# 输出结果（POST /api/review）：
#   {
#     "issues": [
#       {"id": "...", "severity": "critical|major|minor",
#        "line": 10, "description": "...", "fix_suggestion": "..."}
#     ],
#     "summary": "...",
#     "score": 85,
#     "file_count": 1,
#     "issue_count": 3
#   }
# 设计说明：
#   - 当前为模式匹配 + 启发式规则的桩实现，预留 LLM 接入点
#   - 模式覆盖：安全（eval/exec/innerHTML）、性能（嵌套循环 > 3 层）、
#     可读性（TODO/FIXME）、错误处理（bare except）
#   - 后续可替换为真实 LLM 调用
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module E E3 初始版本：模式匹配审查 + 结构化输出
#   - 2026-07-24 | v1.1.0 | Module E E6 新增 /api/review-fix-loop 入口
# ============================================================
"""

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
# 模式匹配规则集（Module E E3 - 启发式规则）
# 每条规则：(pattern, severity, description_template, fix_suggestion)
# severity ∈ {"critical", "major", "minor"}
# 说明：使用正则表达式；line 由正则 search 定位
# ============================================================
SECURITY_RULES: List[Dict[str, object]] = [
    {
        "pattern": re.compile(r"\beval\s*\("),
        "severity": "critical",
        "description": "检测到 eval() 调用，可能执行任意代码",
        "fix_suggestion": "使用 ast.literal_eval() 替代，或重构避免动态求值",
    },
    {
        "pattern": re.compile(r"\bexec\s*\("),
        "severity": "critical",
        "description": "检测到 exec() 调用，存在代码注入风险",
        "fix_suggestion": "使用显式调用或字典映射替代动态执行",
    },
    {
        "pattern": re.compile(r"innerHTML\s*="),
        "severity": "critical",
        "description": "直接设置 innerHTML，可能引入 XSS 漏洞",
        "fix_suggestion": "使用 textContent 或 React/JSX 安全绑定",
    },
    {
        "pattern": re.compile(r"\.execute\s*\(\s*[\"'].*?(\+|\%s|f\")"),
        "severity": "major",
        "description": "SQL 语句疑似字符串拼接，存在 SQL 注入风险",
        "fix_suggestion": "使用参数化查询（? 或 :name 占位符）",
    },
    {
        "pattern": re.compile(r"subprocess\.(?:call|run|Popen).*shell\s*=\s*True"),
        "severity": "major",
        "description": "subprocess 使用 shell=True 存在命令注入风险",
        "fix_suggestion": "使用 shell=False 并传列表参数",
    },
    {
        "pattern": re.compile(r"(?i)md5\s*\("),
        "severity": "minor",
        "description": "使用 MD5 哈希算法，安全性不足",
        "fix_suggestion": "密码学场景使用 SHA-256 / bcrypt / argon2",
    },
]

PERFORMANCE_RULES: List[Dict[str, object]] = [
    {
        "pattern": re.compile(r"for\s+.*:\s*$[\s\S]{0,200}for\s+.*:\s*$[\s\S]{0,200}for\s+.*:\s*$"),
        "severity": "major",
        "description": "检测到 3 层及以上嵌套循环，可能存在 O(n^3) 性能问题",
        "fix_suggestion": "考虑向量化、字典查找或算法优化",
    },
    {
        "pattern": re.compile(r"time\.sleep\s*\("),
        "severity": "minor",
        "description": "使用了 time.sleep()，可能阻塞事件循环",
        "fix_suggestion": "异步场景使用 asyncio.sleep()",
    },
]

READABILITY_RULES: List[Dict[str, object]] = [
    {
        "pattern": re.compile(r"#\s*TODO|#\s*FIXME|#\s*XXX"),
        "severity": "minor",
        "description": "存在 TODO/FIXME/XXX 标记",
        "fix_suggestion": "在合并前补全实现或拆分子任务",
    },
    {
        "pattern": re.compile(r"except\s*:\s*$|except\s+Exception\s*:\s*pass"),
        "severity": "major",
        "description": "bare except 或空 except，吞掉所有异常",
        "fix_suggestion": "捕获具体异常并至少记录日志或向上抛出",
    },
    {
        "pattern": re.compile(r"print\s*\("),
        "severity": "minor",
        "description": "使用 print() 调试输出，生产代码应使用日志",
        "fix_suggestion": "使用 logging 模块（debug/info/error 分级）",
    },
]

ALL_RULES: List[Dict[str, object]] = SECURITY_RULES + PERFORMANCE_RULES + READABILITY_RULES


# ============================================================
# 请求/响应模型
# ============================================================
class ReviewRequest(BaseModel):
    """
    审查请求体
    字段（至少一个非空）：
      - code_diff: str，git diff 文本
      - files: list[str]，待审查文件路径列表
      - session_id: str，可选；会话 ID（用于日志关联）
    """

    code_diff: Optional[str] = Field(None, description="git diff 文本（与 files 二选一）")
    files: Optional[List[str]] = Field(None, description="待审查文件路径列表")
    session_id: Optional[str] = Field(None, description="会话 ID（用于日志关联）")


class ReviewIssue(BaseModel):
    """
    单条审查问题
    """

    id: str
    severity: str
    line: int
    description: str
    fix_suggestion: str
    file: Optional[str] = None
    rule: Optional[str] = None


class ReviewResponse(BaseModel):
    """
    审查响应体
    """

    issues: List[ReviewIssue]
    summary: str
    score: int
    file_count: int
    issue_count: int
    model_id: str
    intensity: str


# ============================================================
# 核心审查逻辑（Module E E3 - 纯函数，便于复用 + 单测）
# ============================================================
def _review_text(text: str, file_label: str = "") -> List[ReviewIssue]:
    """
    对一段文本应用全部审查规则
    参数：
      - text: 待审查的代码文本
      - file_label: 文件路径标签（写入 issue.file）
    返回值：ReviewIssue 列表
    运行步骤：
      1. 按行拆分文本以便定位行号
      2. 对全文应用跨行规则（嵌套循环）
      3. 对每行应用单行规则
      4. 收集并去重 issues
    """
    issues: List[ReviewIssue] = []
    lines = text.split("\n")
    seen_keys: set = set()  # (line, rule) 去重

    def add_issue(line_no: int, rule: Dict[str, object], file: str) -> None:
        key = (line_no, rule.get("pattern"))  # type: ignore[arg-type]
        if key in seen_keys:
            return
        seen_keys.add(key)
        # type: ignore[union-attr]
        issues.append(
            ReviewIssue(
                id=f"issue-{len(issues)+1:03d}",
                severity=str(rule["severity"]),
                line=line_no,
                description=str(rule["description"]),
                fix_suggestion=str(rule["fix_suggestion"]),
                file=file or None,
                rule=str(rule.get("pattern"))[:60],  # type: ignore[arg-type]
            )
        )

    # 1) 全文规则（可能跨多行，如嵌套循环）
    for rule in ALL_RULES:
        # type: ignore[union-attr]
        pat = rule["pattern"]
        for m in pat.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            add_issue(line_no, rule, file_label)

    # 2) 单行规则（更细粒度）
    for idx, line in enumerate(lines, start=1):
        for rule in ALL_RULES:
            # type: ignore[union-attr]
            if rule in SECURITY_RULES + READABILITY_RULES:  # 单行模式已在上方全文匹配
                continue
            # type: ignore[union-attr]
            if rule["pattern"].search(line):
                add_issue(idx, rule, file_label)

    return issues


def _calc_score(issues: List[ReviewIssue]) -> int:
    """
    根据 issues 计算 0-100 的评分
    规则：
      - critical: -15
      - major:    -8
      - minor:    -3
      - 最低 0 分
    """
    score = 100
    weights = {"critical": 15, "major": 8, "minor": 3}
    for issue in issues:
        score -= weights.get(issue.severity, 0)
    return max(0, score)


def _read_files(file_paths: List[str], base_dir: Optional[str] = None) -> Dict[str, str]:
    """
    读取文件内容
    参数：
      - file_paths: 相对或绝对路径列表
      - base_dir: 可选基础目录（为相对路径前缀）
    返回值：{path: content} 映射
    说明：文件读取失败时记录 warning 并跳过（不抛异常）
    """
    out: Dict[str, str] = {}
    for fp in file_paths:
        try:
            p = Path(fp)
            if not p.is_absolute() and base_dir:
                p = Path(base_dir) / p
            if not p.exists():
                logger.warning(f"审查-文件不存在，已跳过: {p}")
                continue
            out[str(p)] = p.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.warning(f"审查-读取文件失败 {fp}: {e}")
    return out


# ============================================================
# API 端点
# ============================================================
@router.post("")
@router.post("/")
async def review_code(req: ReviewRequest) -> ReviewResponse:
    """
    代码审查入口
    步骤：
      1. 校验至少有 code_diff 或 files
      2. 若给 files，读取内容
      3. 拼接成大文本，逐文件应用规则
      4. 计算 score + summary
      5. 返回结构化响应
    """
    if not req.code_diff and not req.files:
        raise HTTPException(
            status_code=400,
            detail="至少需要提供 code_diff 或 files 之一",
        )

    all_issues: List[ReviewIssue] = []
    file_count = 0

    # 1) diff 整体作为一个虚拟文件审查
    if req.code_diff:
        file_count += 1
        all_issues.extend(_review_text(req.code_diff, file_label="<diff>"))

    # 2) 文件列表
    if req.files:
        contents = _read_files(req.files)
        for path, content in contents.items():
            file_count += 1
            all_issues.extend(_review_text(content, file_label=path))

    score = _calc_score(all_issues)
    summary = _build_summary(all_issues, score, file_count)

    logger.info(
        f"审查完成: session={req.session_id} files={file_count} "
        f"issues={len(all_issues)} score={score} "
        f"model={get_current_model_id()} intensity={get_current_intensity()}"
    )

    return ReviewResponse(
        issues=all_issues,
        summary=summary,
        score=score,
        file_count=file_count,
        issue_count=len(all_issues),
        model_id=get_current_model_id(),
        intensity=get_current_intensity(),
    )


def _build_summary(issues: List[ReviewIssue], score: int, file_count: int) -> str:
    """
    构造审查总结文本
    """
    by_sev: Dict[str, int] = {"critical": 0, "major": 0, "minor": 0}
    for i in issues:
        by_sev[i.severity] = by_sev.get(i.severity, 0) + 1
    if not issues:
        return f"扫描 {file_count} 个文件，未发现问题。代码质量良好。"
    return (
        f"扫描 {file_count} 个文件，发现 {len(issues)} 个问题 "
        f"（critical {by_sev['critical']} / major {by_sev['major']} / "
        f"minor {by_sev['minor']}），综合评分 {score}/100。"
    )


# ============================================================
# E6 review-fix-loop 入口
# ============================================================
class ReviewFixLoopRequest(BaseModel):
    """
    review-fix 循环请求体
    字段：
      - file_path: str，待审查并尝试修复的文件路径
      - max_iterations: int，最大循环次数（默认 3，上限 5）
      - session_id: str，可选
    """

    file_path: str = Field(..., description="待审查并尝试修复的文件路径")
    max_iterations: int = Field(3, ge=1, le=5, description="最大循环次数（1-5）")
    session_id: Optional[str] = Field(None, description="会话 ID")


@router.post("/review-fix-loop")
async def review_fix_loop(req: ReviewFixLoopRequest) -> Dict:
    """
    review-fix 自迭代循环入口
    作用：调用 ReviewFixLoop 服务，最长 max_iterations 轮自迭代
    返回值：包含每轮结果 + 最终报告
    """
    # 延迟导入：避免循环引用
    from backend.app.services.review_fix_loop import ReviewFixLoop

    try:
        loop = ReviewFixLoop(max_iterations=req.max_iterations)
        result = loop.run(file_path=req.file_path, session_id=req.session_id)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"review-fix 循环失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"review-fix 循环失败: {e}")
