"""
# ============================================================
# Workspace Checker - 工作区检查
# ============================================================
# 检查项：current_path / git_status / remote / trae_dir / agents_md /
#        specs_dir / disk_space / file_count
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import List

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
    _check_command_exists,
    _get_command_output,
    _run_command,
)


class WorkspaceChecker(BaseChecker):
    """工作区检查器"""

    category = "workspace"
    title = "工作区状态"
    default_timeout = 10.0

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        items.append(self._check_current_path())
        items.append(self._check_git_status())
        items.append(self._check_remote())
        items.append(self._check_trae_dir())
        items.append(self._check_agents_md())
        items.append(self._check_specs_dir())
        items.append(self._check_disk_space())
        items.append(self._check_file_count())
        return items

    def _check_current_path(self) -> CheckItem:
        """当前路径检查"""
        cwd = Path.cwd()
        # 检查是否在 git 仓库内
        rc, _, _ = _run_command(["git", "rev-parse", "--git-dir"], timeout=3.0, cwd=cwd)
        in_git_repo = (rc == 0)
        return self.make_item(
            check_id="workspace.current_path",
            name="Current Path",
            description="当前工作目录",
            status=CheckStatus.OK.value if in_git_repo else CheckStatus.WARNING.value,
            value=str(cwd),
            expected="Git 仓库内",
            message=f"当前路径: {cwd}" + ("" if in_git_repo else "（不在 Git 仓库内）"),
            fix_suggestion="cd <project>" if not in_git_repo else None,
        )

    def _check_git_status(self) -> CheckItem:
        """Git status 检查"""
        if not _check_command_exists("git"):
            return self.make_item(
                check_id="workspace.git_status",
                name="Git Status",
                description="Git 工作区状态",
                status=CheckStatus.SKIPPED.value,
                message="git 命令不可用",
            )
        rc, stdout, _ = _run_command(
            ["git", "status", "--porcelain"],
            timeout=5.0,
            cwd=self.project_path,
        )
        if rc != 0:
            return self.make_item(
                check_id="workspace.git_status",
                name="Git Status",
                description="Git 工作区状态",
                status=CheckStatus.SKIPPED.value,
                message="git status 失败（非 git 仓库或权限不足）",
            )
        modified_lines = stdout.strip().split("\n") if stdout.strip() else []
        modified_count = len(modified_lines)
        if modified_count == 0:
            return self.make_item(
                check_id="workspace.git_status",
                name="Git Status",
                description="Git 工作区状态",
                status=CheckStatus.OK.value,
                value="clean",
                expected="无未提交修改",
                message="工作区干净",
            )
        return self.make_item(
            check_id="workspace.git_status",
            name="Git Status",
            description="Git 工作区状态",
            status=CheckStatus.WARNING.value,
            value=f"{modified_count} changes",
            expected="无未提交修改",
            message=f"有 {modified_count} 个未提交修改",
            fix_suggestion="git add . && git commit -m '...' 或 git stash",
            details={"modified_files": modified_lines[:10]},
        )

    def _check_remote(self) -> CheckItem:
        """Git remote 检查"""
        if not _check_command_exists("git"):
            return self.make_item(
                check_id="workspace.remote",
                name="Git Remote",
                description="Git 远程仓库",
                status=CheckStatus.SKIPPED.value,
                message="git 命令不可用",
            )
        rc, stdout, _ = _run_command(
            ["git", "remote", "-v"],
            timeout=3.0,
            cwd=self.project_path,
        )
        if rc != 0:
            return self.make_item(
                check_id="workspace.remote",
                name="Git Remote",
                description="Git 远程仓库",
                status=CheckStatus.SKIPPED.value,
                message="git remote 查询失败",
            )
        remotes = [line for line in stdout.strip().split("\n") if line]
        if not remotes:
            return self.make_item(
                check_id="workspace.remote",
                name="Git Remote",
                description="Git 远程仓库",
                status=CheckStatus.WARNING.value,
                value=None,
                expected="已配置 origin",
                message="未配置远程仓库",
                fix_suggestion="git remote add origin <url>",
            )
        # 提取 origin URL
        origin = next((r for r in remotes if r.startswith("origin\t")), remotes[0])
        url = origin.split("\t")[1].split(" ")[0] if "\t" in origin else origin
        return self.make_item(
            check_id="workspace.remote",
            name="Git Remote",
            description="Git 远程仓库",
            status=CheckStatus.OK.value,
            value=url[:60] + ("..." if len(url) > 60 else ""),
            expected="已配置",
            message=f"远程仓库: {url[:60]}",
        )

    def _check_trae_dir(self) -> CheckItem:
        """.trae 目录检查"""
        trae_dir = self.project_path / ".trae"
        if trae_dir.exists() and trae_dir.is_dir():
            return self.make_item(
                check_id="workspace.trae_dir",
                name=".trae Directory",
                description="Hermes 配置目录",
                status=CheckStatus.OK.value,
                value=str(trae_dir),
                expected="已存在",
                message=f".trae/ 目录存在: {trae_dir}",
            )
        return self.make_item(
            check_id="workspace.trae_dir",
            name=".trae Directory",
            description="Hermes 配置目录",
            status=CheckStatus.WARNING.value,
            value=None,
            expected="已存在",
            message=".trae/ 目录不存在",
            fix_suggestion="mkdir -p .trae/{specs,agents,hooks,skills,rules}",
        )

    def _check_agents_md(self) -> CheckItem:
        """AGENTS.md 检查"""
        agents_md = self.project_path / "AGENTS.md"
        if agents_md.exists():
            size = agents_md.stat().st_size
            return self.make_item(
                check_id="workspace.agents_md",
                name="AGENTS.md",
                description="项目智能体规范文件",
                status=CheckStatus.OK.value,
                value=f"{size} bytes",
                expected="已存在",
                message=f"AGENTS.md 存在 ({size} bytes)",
            )
        return self.make_item(
            check_id="workspace.agents_md",
            name="AGENTS.md",
            description="项目智能体规范文件",
            status=CheckStatus.WARNING.value,
            value=None,
            expected="已存在",
            message="AGENTS.md 不存在",
            fix_suggestion="hermes init 或手动创建 AGENTS.md",
        )

    def _check_specs_dir(self) -> CheckItem:
        """.trae/specs/ 检查"""
        specs_dir = self.project_path / ".trae" / "specs"
        if specs_dir.exists() and specs_dir.is_dir():
            # 计算子任务数
            spec_count = sum(1 for _ in specs_dir.glob("**/spec.md"))
            return self.make_item(
                check_id="workspace.specs_dir",
                name=".trae/specs/ Directory",
                description="任务规格目录",
                status=CheckStatus.OK.value,
                value=f"{spec_count} specs",
                expected="已存在",
                message=f".trae/specs/ 存在 ({spec_count} 个 spec)",
            )
        return self.make_item(
            check_id="workspace.specs_dir",
            name=".trae/specs/ Directory",
            description="任务规格目录",
            status=CheckStatus.WARNING.value,
            value=None,
            expected="已存在",
            message=".trae/specs/ 目录不存在",
            fix_suggestion="mkdir -p .trae/specs",
        )

    def _check_disk_space(self) -> CheckItem:
        """磁盘空间检查"""
        try:
            usage = shutil.disk_usage(self.project_path)
            free_gb = usage.free / (1024 ** 3)
            total_gb = usage.total / (1024 ** 3)
            ok = free_gb >= 1.0
            status = CheckStatus.OK.value if ok else CheckStatus.WARNING.value
            return self.make_item(
                check_id="workspace.disk_space",
                name="Disk Space",
                description="磁盘剩余空间",
                status=status,
                value=f"{free_gb:.2f} GB free",
                expected=">= 1 GB",
                message=f"剩余 {free_gb:.2f} GB / 总 {total_gb:.2f} GB",
                fix_suggestion="清理 docker / 旧日志 / pip 缓存" if not ok else None,
            )
        except Exception as e:
            return self.make_item(
                check_id="workspace.disk_space",
                name="Disk Space",
                description="磁盘剩余空间",
                status=CheckStatus.SKIPPED.value,
                message=f"无法获取磁盘信息: {e}",
            )

    def _check_file_count(self) -> CheckItem:
        """项目文件数检查"""
        try:
            # 仅统计顶层文件（避免慢）
            count = 0
            for _, dirs, files in os.walk(self.project_path):
                count += len(files)
                # 排除 node_modules 等
                dirs[:] = [d for d in dirs if d not in (
                    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
                )]
            ok = count < 100_000
            return self.make_item(
                check_id="workspace.file_count",
                name="Project File Count",
                description="项目文件总数",
                status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
                value=str(count),
                expected="< 100,000",
                message=f"项目共 {count} 个文件",
                fix_suggestion="清理 node_modules / __pycache__" if not ok else None,
            )
        except Exception as e:
            return self.make_item(
                check_id="workspace.file_count",
                name="Project File Count",
                description="项目文件总数",
                status=CheckStatus.SKIPPED.value,
                message=f"无法统计文件数: {e}",
            )
