"""
# ============================================================
# Plan Service - /loop plan 实现
# ============================================================
# 核心作用：基于 Loop Engineering v7 生成 spec.md + checklist.md
#          并创建 git 分支
# 运行流程：
#   1. 检查项目根目录是否有 .trae/specs/ 目录
#   2. 调用 Loop Engineering v7 step5_critique_iteration
#   3. 生成 spec.md（如果不存在）
#   4. 生成 checklist.md（如果不存在）
#   5. 创建 git 分支 loop/plan-<timestamp>
#   6. 返回文件路径 + 分支名
# 输入参数：project_path 项目根目录, max_iterations 最大迭代次数
# 输出结果：dict {branch, spec_file, checklist_file, iteration_count}
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import logging
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _run_shell(cmd: list, cwd: Optional[str] = None, timeout: int = 30) -> tuple:
    """运行 shell 命令

    Args:
        cmd: 命令列表
        cwd: 工作目录
        timeout: 超时秒数

    Returns:
        (returncode, stdout, stderr)
    """
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out: {cmd}")
        return -1, "", "Command timed out"
    except Exception as e:
        logger.error(f"Command failed: {e}")
        return -1, "", str(e)


class PlanService:
    """Plan 服务 - 生成 spec + checklist + git 分支"""

    def __init__(self, project_path: str):
        """初始化 Plan 服务

        Args:
            project_path: 项目根目录
        """
        self.project_path = Path(project_path)
        self.specs_dir = self.project_path / ".trae" / "specs"

    def execute(self, max_iterations: int = 3) -> Dict[str, Any]:
        """执行 plan 阶段

        Args:
            max_iterations: 最大迭代次数

        Returns:
            {
                "branch": "loop/plan-1234567890",
                "spec_file": ".trae/specs/.../spec.md",
                "checklist_file": ".trae/specs/.../checklist.md",
                "iteration_count": 0,
            }
        """
        # 1. 加载 Loop Engineering v7（如果可用）
        iteration_count = 0
        try:
            from app.services.loop_engineering_v7 import LoopEngineeringV7, WorkflowConfig

            workflow = LoopEngineeringV7(config=WorkflowConfig(
                project_path=str(self.project_path),
                max_iterations=max_iterations,
            ))

            # step5: 批判反思迭代
            import asyncio
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            result = loop.run_until_complete(workflow.step5_critique_iteration())
            iteration_count = result.get("iteration_count", 0) if isinstance(result, dict) else 0
        except ImportError:
            logger.warning("Loop Engineering v7 not available, using simplified plan")
        except Exception as e:
            logger.warning(f"Loop Engineering v7 failed: {e}")

        # 2. 生成 spec.md（如果不存在）
        spec_file = self._ensure_spec_file()

        # 3. 生成 checklist.md（如果不存在）
        checklist_file = self._ensure_checklist_file()

        # 4. 创建 git 分支
        branch = self._create_branch()

        return {
            "branch": branch,
            "spec_file": spec_file,
            "checklist_file": checklist_file,
            "iteration_count": iteration_count,
        }

    def _ensure_spec_file(self) -> str:
        """确保 spec.md 文件存在

        Returns:
            spec.md 相对路径
        """
        # 优先查找已存在的 spec.md
        spec_candidates = [
            self.specs_dir / "current" / "spec.md",
            self.specs_dir / "spec.md",
        ]

        for candidate in spec_candidates:
            if candidate.exists():
                return str(candidate.relative_to(self.project_path))

        # 创建一个新的 spec 占位文件
        cycle_dir = self.specs_dir / "current"
        cycle_dir.mkdir(parents=True, exist_ok=True)
        spec_path = cycle_dir / "spec.md"

        if not spec_path.exists():
            spec_path.write_text(
                """# Loop Engineering - 当前 Spec

> **生成方式**: `/loop plan` 自动创建
> **日期**: {date}

## 项目概述
[待填写]

## 核心功能
[待填写]

## 验收标准
[待填写]
""".format(date=time.strftime("%Y-%m-%d")),
                encoding="utf-8",
            )

        return str(spec_path.relative_to(self.project_path))

    def _ensure_checklist_file(self) -> str:
        """确保 checklist.md 文件存在

        Returns:
            checklist.md 相对路径
        """
        # 优先查找已存在的 checklist.md
        checklist_candidates = [
            self.specs_dir / "current" / "checklist.md",
            self.specs_dir / "checklist.md",
        ]

        for candidate in checklist_candidates:
            if candidate.exists():
                return str(candidate.relative_to(self.project_path))

        cycle_dir = self.specs_dir / "current"
        cycle_dir.mkdir(parents=True, exist_ok=True)
        checklist_path = cycle_dir / "checklist.md"

        if not checklist_path.exists():
            checklist_path.write_text(
                """# Loop Engineering - 当前 Checklist

> **生成方式**: `/loop plan` 自动创建
> **日期**: {date}

## P0 - 核心任务
- [ ] (待添加)

## P1 - 增强功能
- [ ] (待添加)

## P2 - 长期优化
- [ ] (待添加)
""".format(date=time.strftime("%Y-%m-%d")),
                encoding="utf-8",
            )

        return str(checklist_path.relative_to(self.project_path))

    def _create_branch(self) -> str:
        """创建 git 分支

        Returns:
            分支名
        """
        branch_name = f"loop/plan-{int(time.time())}"

        # 检查是否在 git 仓库
        rc, _, _ = _run_shell(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(self.project_path),
        )
        if rc != 0:
            logger.warning("Not a git repository, skipping branch creation")
            return branch_name + " (no-git)"

        # 检查分支是否已存在（添加后缀）
        rc, stdout, _ = _run_shell(
            ["git", "branch", "--list", branch_name],
            cwd=str(self.project_path),
        )
        suffix = 0
        original_name = branch_name
        while branch_name in stdout:
            suffix += 1
            branch_name = f"{original_name}-{suffix}"
            rc, stdout, _ = _run_shell(
                ["git", "branch", "--list", branch_name],
                cwd=str(self.project_path),
            )

        # 创建分支
        rc, _, stderr = _run_shell(
            ["git", "checkout", "-b", branch_name],
            cwd=str(self.project_path),
        )
        if rc != 0:
            logger.error(f"Failed to create branch: {stderr}")
            return branch_name + " (failed)"

        return branch_name
