"""
# ============================================================
# Execute Service - /loop execute 实现
# ============================================================
# 核心作用：执行当前 task，触发 Loop Engineering v7 step6-step8
#          并自动 git commit
# 运行流程：
#   1. 调用 Loop Engineering v7 step6-step8
#   2. 生成 docs（spec.md + checklist.md + tasks.md）
#   3. 创建源码仓库（如果不存在）
#   4. 注入提示词到 CLI
#   5. 注册 git hooks
#   6. 自动 git commit + push
# 输入参数：project_path 项目根目录
# 输出结果：dict {docs_generated, repo_path, prompts_injected, commit_sha}
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _run_shell(cmd: list, cwd: Optional[str] = None, timeout: int = 60) -> tuple:
    """运行 shell 命令"""
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out: {cmd}")
        return -1, "", "Command timed out"
    except Exception as e:
        logger.error(f"Command failed: {e}")
        return -1, "", str(e)


class ExecuteService:
    """Execute 服务 - 执行 task + 自动 git commit"""

    def __init__(self, project_path: str):
        """初始化 Execute 服务

        Args:
            project_path: 项目根目录
        """
        self.project_path = Path(project_path)

    def execute(self, task_id: Optional[str] = None) -> Dict[str, Any]:
        """执行 task

        Args:
            task_id: 任务 ID（可选，默认执行 tasks.md 第一个未完成任务）

        Returns:
            {
                "docs_generated": List[str],
                "repo_path": str,
                "prompts_injected": int,
                "commit_sha": str,
            }
        """
        docs_generated: List[str] = []
        repo_path = ""
        prompts_injected = 0
        commit_sha = ""

        # 1. 调用 Loop Engineering v7 step6-step11
        try:
            from app.services.loop_engineering_v7 import LoopEngineeringV7, WorkflowConfig
            import asyncio

            workflow = LoopEngineeringV7(config=WorkflowConfig(
                project_path=str(self.project_path),
            ))

            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            # step6: 完成验收标准
            step6_result = loop.run_until_complete(workflow.step6_finalize_acceptance_criteria())
            if isinstance(step6_result, dict):
                docs_generated.extend(step6_result.get("files", []))

            # step7: 生成 docs + git
            step7_result = loop.run_until_complete(workflow.step7_generate_docs_and_git())
            if isinstance(step7_result, dict):
                docs_generated.extend(step7_result.get("files", []))

            # step8: 创建源码仓库
            step8_result = loop.run_until_complete(workflow.step8_create_source_project_repo())
            if isinstance(step8_result, dict):
                repo_path = step8_result.get("repo_path", "")

            # step9: 注入提示词到 CLI
            step9_result = loop.run_until_complete(workflow.step9_inject_prompts_to_cli())
            if isinstance(step9_result, dict):
                prompts_injected = step9_result.get("count", 0)

        except ImportError:
            logger.warning("Loop Engineering v7 not available, using simplified execute")
        except Exception as e:
            logger.warning(f"Loop Engineering v7 step failed: {e}")

        # 2. 自动 git commit
        commit_sha = self._auto_commit(task_id or "current task")

        return {
            "docs_generated": docs_generated,
            "repo_path": repo_path,
            "prompts_injected": prompts_injected,
            "commit_sha": commit_sha,
        }

    def _auto_commit(self, task_title: str) -> str:
        """自动 git commit

        Args:
            task_title: 任务标题（作为 commit message）

        Returns:
            commit SHA
        """
        # 检查是否在 git 仓库
        rc, _, _ = _run_shell(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(self.project_path),
        )
        if rc != 0:
            logger.warning("Not a git repository, skipping commit")
            return ""

        # git add
        rc, _, stderr = _run_shell(
            ["git", "add", "-A"],
            cwd=str(self.project_path),
        )
        if rc != 0:
            logger.error(f"git add failed: {stderr}")
            return ""

        # 检查是否有变更
        rc, stdout, _ = _run_shell(
            ["git", "diff", "--cached", "--stat"],
            cwd=str(self.project_path),
        )
        if not stdout.strip():
            logger.info("No changes to commit")
            return ""

        # git commit
        commit_msg = f"loop: execute {task_title}"
        rc, stdout, stderr = _run_shell(
            ["git", "commit", "-m", commit_msg],
            cwd=str(self.project_path),
        )
        if rc != 0:
            logger.error(f"git commit failed: {stderr}")
            return ""

        # 获取 commit SHA
        rc, sha, _ = _run_shell(
            ["git", "rev-parse", "HEAD"],
            cwd=str(self.project_path),
        )
        if rc == 0:
            return sha.strip()[:8]

        return ""
