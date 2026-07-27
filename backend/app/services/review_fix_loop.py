"""
# ============================================================
# review-fix 自迭代循环服务（Module E - E6）
# ============================================================
# 核心作用：封装 Codex CLI 风格的 review → fix → re-review 循环，
#           直到 issues 收敛或达到 max_iterations 上限。
# 运行流程：
#   1. 读取目标文件
#   2. 调用 review 模式匹配
#   3. 若无 issues：直接返回成功
#   4. 若有 issues 且未超 max：调用 fix 应用补丁，重新 review
#   5. 收集每轮结果，返回最终报告
# 输入参数：
#   - file_path: str，待审查并尝试修复的文件路径
#   - max_iterations: int，最大循环次数（默认 3）
#   - session_id: str，可选
# 输出结果（dict）：
#   {
#     "file_path": "...",
#     "iterations": [
#       {"round": 1, "issues_before": N, "issues_after": M,
#        "applied_fixes": [...], "skipped": [...]}
#     ],
#     "converged": bool,
#     "final_issues": [...],
#     "final_score": int,
#     "summary": "..."
#   }
# 设计说明：
#   - 收敛条件：issues 数量不再下降 或 达到 max_iterations
#   - 实际写文件操作需要明确开关（默认 dry-run，不修改磁盘）
#   - 通过 ReviewFixLoop 实例化时传入 write_back=True 来真正落盘
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module E E6 初始版本：review-fix 自迭代循环
# ============================================================
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class ReviewFixLoop:
    """
    review-fix 自迭代循环服务

    用法：
        loop = ReviewFixLoop(max_iterations=3, write_back=False)
        result = loop.run(file_path="src/foo.py")
    """

    def __init__(self, max_iterations: int = 3, write_back: bool = False):
        """
        初始化循环服务
        参数：
          - max_iterations: int，最大循环次数（1-5）
          - write_back: bool，是否将修复结果写回磁盘（默认 False，dry-run）
        """
        if max_iterations < 1:
            max_iterations = 1
        if max_iterations > 5:
            max_iterations = 5
        self.max_iterations = max_iterations
        self.write_back = write_back

    def run(
        self,
        file_path: str,
        session_id: Optional[str] = None,
    ) -> Dict:
        """
        执行 review-fix 自迭代循环
        参数：
          - file_path: str，目标文件路径
          - session_id: str，可选；用于日志关联
        返回值：dict，最终报告（含 iterations 数组与收敛状态）
        异常：
          - FileNotFoundError：文件不存在
        """
        p = Path(file_path)
        if not p.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        # 延迟导入：避免循环引用 + 避免在导入时拉起 review/fix 路由模块
        from backend.app.api.review import _review_text, _calc_score
        from backend.app.api.fix import _apply_fixes, _make_unified_diff

        original_content = p.read_text(encoding="utf-8", errors="replace")
        current_content = original_content
        iterations: List[Dict] = []
        converged = False
        prev_issue_count: Optional[int] = None

        for round_idx in range(1, self.max_iterations + 1):
            logger.info(
                f"[review-fix] round={round_idx}/{self.max_iterations} "
                f"file={file_path} session={session_id}"
            )

            # 1) Review 当前内容
            issues = _review_text(current_content, file_label=str(p))
            issue_count = len(issues)
            logger.info(f"[review-fix] round={round_idx} 发现 {issue_count} 个问题")

            # 2) 若无 issue 或已收敛：结束循环
            if issue_count == 0:
                iterations.append(
                    {
                        "round": round_idx,
                        "issues_before": 0,
                        "issues_after": 0,
                        "applied_fixes": [],
                        "skipped_issues": [],
                        "score": 100,
                    }
                )
                converged = True
                break

            if prev_issue_count is not None and issue_count >= prev_issue_count:
                # 问题未减少：记录这一轮结果并停止
                iterations.append(
                    {
                        "round": round_idx,
                        "issues_before": prev_issue_count,
                        "issues_after": issue_count,
                        "applied_fixes": [],
                        "skipped_issues": [i.id for i in issues],
                        "score": _calc_score(issues),
                    }
                )
                logger.info(
                    f"[review-fix] round={round_idx} 问题未减少，停止迭代"
                )
                break

            # 3) Fix：构造 issues 字典列表供 _apply_fixes 使用
            issue_dicts = [
                {
                    "id": i.id,
                    "severity": i.severity,
                    "line": i.line,
                    "file": i.file,
                    "rule": i.rule,
                }
                for i in issues
            ]
            fix_result = _apply_fixes(current_content, issue_dicts)
            new_content = fix_result["new_content"]

            # 4) 立即 re-review 新内容以衡量收敛
            re_issues = _review_text(new_content, file_label=str(p))
            re_count = len(re_issues)
            re_score = _calc_score(re_issues)

            iterations.append(
                {
                    "round": round_idx,
                    "issues_before": issue_count,
                    "issues_after": re_count,
                    "applied_fixes": fix_result["applied_fixes"],
                    "skipped_issues": fix_result["skipped_issues"],
                    "score": re_score,
                }
            )

            # 5) 写回（可选）
            if self.write_back and new_content != current_content:
                try:
                    p.write_text(new_content, encoding="utf-8")
                    logger.info(f"[review-fix] round={round_idx} 已写回 {p}")
                except Exception as e:
                    logger.error(f"[review-fix] 写回失败 {p}: {e}")

            current_content = new_content
            prev_issue_count = re_count

            if re_count == 0:
                converged = True
                break

        # 终态：基于 current_content 重新跑一次 review 作为 final_issues
        from backend.app.api.review import _review_text, _calc_score

        final_issues = _review_text(current_content, file_label=str(p))
        final_score = _calc_score(final_issues)
        final_diff = _make_unified_diff(str(p), original_content, current_content)

        summary = (
            f"经过 {len(iterations)} 轮迭代"
            + ("已收敛" if converged else "未完全收敛")
            + f"，最终 {len(final_issues)} 个问题，评分 {final_score}/100"
        )

        logger.info(
            f"[review-fix] 完成 file={file_path} "
            f"converged={converged} iterations={len(iterations)} "
            f"final_score={final_score}"
        )

        return {
            "file_path": str(p),
            "iterations": iterations,
            "converged": converged,
            "final_issues": [i.dict() for i in final_issues],  # type: ignore[attr-defined]
            "final_score": final_score,
            "final_diff": final_diff,
            "summary": summary,
            "write_back": self.write_back,
        }
