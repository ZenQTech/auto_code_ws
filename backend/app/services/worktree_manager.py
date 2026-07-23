"""
# ============================================================
# Git Worktree 隔离管理器
# ============================================================
# 核心作用：为每个 Claude Code CLI 实例创建独立的 Git worktree，
#           确保多模块并行开发时不产生代码冲突
# 运行流程：
#   1. 提示词工程阶段自动创建 worktree
#   2. 在新 worktree 中创建独立分支
#   3. 实例的所有文件操作限定在该 worktree 内
#   4. 质量评审通过后合并 worktree 到主分支
#   5. 清理已合并的 worktree
# 输入参数：
#   - repo_path: 仓库路径
#   - module_name: 模块名称
#   - instance_id: 实例 ID
# 输出结果：WorktreeInfo 对象
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
# ============================================================
"""

import logging
import os
import uuid
import shutil
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List

logger = logging.getLogger(__name__)


@dataclass
class WorktreeInfo:
    """Worktree 信息"""
    worktree_id: str = ""
    repo_path: str = ""
    worktree_path: str = ""
    branch_name: str = ""
    module_name: str = ""
    instance_id: str = ""
    status: str = "active"


@dataclass
class MergeResult:
    """合并结果"""
    success: bool = False
    worktree_id: str = ""
    branch_name: str = ""
    conflicts: List[str] = field(default_factory=list)
    message: str = ""


class WorktreeManager:
    """
    Git Worktree 管理器
    作用：管理 Git worktree 的创建、合并、清理
    """

    def __init__(self, base_worktree_dir: Optional[str] = None):
        """
        初始化 Worktree 管理器
        参数：
          - base_worktree_dir: worktree 基础目录（默认为 <repo>/.worktrees/）
        """
        self.base_worktree_dir = base_worktree_dir

    async def create_worktree(
        self, repo_path: str, module_name: str, instance_id: str
    ) -> WorktreeInfo:
        """
        创建独立 worktree
        运行步骤：
          1. 确定 worktree 路径
          2. 创建独立分支
          3. 执行 git worktree add
        参数：
          - repo_path: 仓库路径
          - module_name: 模块名称
          - instance_id: 实例 ID
        返回值：WorktreeInfo 对象
        """
        worktree_id = str(uuid.uuid4())[:8]
        safe_module = module_name.replace("/", "-").replace(" ", "-")[:30]

        # 确定 worktree 目录
        if self.base_worktree_dir:
            worktrees_root = Path(self.base_worktree_dir)
        else:
            worktrees_root = Path(repo_path) / ".worktrees"

        worktrees_root.mkdir(parents=True, exist_ok=True)
        worktree_path = worktrees_root / f"{safe_module}-{worktree_id}"
        branch_name = f"module/{safe_module}/{worktree_id}"

        info = WorktreeInfo(
            worktree_id=worktree_id,
            repo_path=repo_path,
            worktree_path=str(worktree_path),
            branch_name=branch_name,
            module_name=module_name,
            instance_id=instance_id,
        )

        try:
            import asyncio

            # 创建分支
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", repo_path, "checkout", "-b", branch_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                # 分支可能已存在，尝试切换
                proc2 = await asyncio.create_subprocess_exec(
                    "git", "-C", repo_path, "checkout", branch_name,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc2.communicate()

            # 切回原分支
            await asyncio.create_subprocess_exec(
                "git", "-C", repo_path, "checkout", "-",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # 创建 worktree
            proc3 = await asyncio.create_subprocess_exec(
                "git", "-C", repo_path, "worktree", "add",
                str(worktree_path), branch_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout3, stderr3 = await proc3.communicate()

            if proc3.returncode != 0:
                err_msg = stderr3.decode() if stderr3 else "unknown error"
                logger.error(f"创建 worktree 失败: {err_msg}")
                # 尝试清理已创建的目录
                if worktree_path.exists():
                    shutil.rmtree(str(worktree_path), ignore_errors=True)
                raise RuntimeError(f"git worktree add 失败: {err_msg}")

            logger.info(
                f"Worktree 已创建: {worktree_path} (branch: {branch_name})"
            )

        except FileNotFoundError:
            logger.warning("git 命令不可用，使用模拟 worktree（目录复制）")
            # 降级方案：直接创建目录
            worktree_path.mkdir(parents=True, exist_ok=True)
            info.branch_name = f"module-{safe_module}-{worktree_id}"

        except Exception as e:
            logger.error(f"创建 worktree 异常: {e}")
            # 降级方案
            worktree_path.mkdir(parents=True, exist_ok=True)
            info.branch_name = f"module-{safe_module}-{worktree_id}"

        return info

    async def merge_worktree(self, worktree_id: str, repo_path: str = "") -> MergeResult:
        """
        合并 worktree 到主分支
        运行步骤：
          1. 查找 worktree 信息
          2. 切换到主分支
          3. 合并 worktree 分支
          4. 删除 worktree
        参数：
          - worktree_id: worktree ID
          - repo_path: 仓库路径
        返回值：MergeResult 对象
        """
        result = MergeResult(worktree_id=worktree_id)

        try:
            import asyncio

            # 查找 worktree 路径
            worktrees_root = Path(repo_path) / ".worktrees" if repo_path else None
            if worktrees_root and worktrees_root.exists():
                for wt_dir in worktrees_root.iterdir():
                    if worktree_id in wt_dir.name:
                        branch_name = f"module/{wt_dir.name.split('-', 1)[0]}/{worktree_id}"

                        # 切换到主分支
                        proc = await asyncio.create_subprocess_exec(
                            "git", "-C", repo_path, "checkout", "main",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await proc.communicate()

                        # 尝试 master 分支
                        if proc.returncode != 0:
                            proc = await asyncio.create_subprocess_exec(
                                "git", "-C", repo_path, "checkout", "master",
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE,
                            )
                            await proc.communicate()

                        # 合并
                        proc2 = await asyncio.create_subprocess_exec(
                            "git", "-C", repo_path, "merge", branch_name,
                            "--no-ff", "-m", f"merge: {branch_name}",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        stdout2, stderr2 = await proc2.communicate()

                        if proc2.returncode != 0:
                            err = stderr2.decode() if stderr2 else ""
                            if "CONFLICT" in err:
                                result.conflicts.append(err)
                                result.message = f"合并冲突: {branch_name}"
                            else:
                                result.message = f"合并失败: {err}"
                            return result

                        # 删除 worktree
                        proc3 = await asyncio.create_subprocess_exec(
                            "git", "-C", repo_path, "worktree", "remove",
                            str(wt_dir), "--force",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await proc3.communicate()

                        # 删除分支
                        await asyncio.create_subprocess_exec(
                            "git", "-C", repo_path, "branch", "-D", branch_name,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )

                        result.success = True
                        result.branch_name = branch_name
                        result.message = f"已合并并清理: {branch_name}"
                        break

        except FileNotFoundError:
            logger.warning("git 命令不可用，跳过 worktree 合并")
            result.message = "git 不可用，跳过合并"
        except Exception as e:
            logger.error(f"合并 worktree 异常: {e}")
            result.message = str(e)

        return result

    async def cleanup_worktree(self, worktree_id: str, repo_path: str = ""):
        """
        清理 worktree（不合并）
        参数：
          - worktree_id: worktree ID
          - repo_path: 仓库路径
        """
        try:
            import asyncio

            worktrees_root = Path(repo_path) / ".worktrees" if repo_path else None
            if worktrees_root and worktrees_root.exists():
                for wt_dir in worktrees_root.iterdir():
                    if worktree_id in wt_dir.name:
                        # 尝试 git worktree remove
                        proc = await asyncio.create_subprocess_exec(
                            "git", "-C", repo_path, "worktree", "remove",
                            str(wt_dir), "--force",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await proc.communicate()

                        # 如果目录还在，手动删除
                        if wt_dir.exists():
                            shutil.rmtree(str(wt_dir), ignore_errors=True)

                        logger.info(f"Worktree 已清理: {wt_dir}")
                        break

        except FileNotFoundError:
            logger.warning("git 命令不可用，跳过 worktree 清理")
        except Exception as e:
            logger.error(f"清理 worktree 异常: {e}")

    async def list_worktrees(self, repo_path: str) -> List[WorktreeInfo]:
        """
        列出所有 worktree
        参数：
          - repo_path: 仓库路径
        返回值：WorktreeInfo 列表
        """
        worktrees: List[WorktreeInfo] = []

        try:
            import asyncio

            proc = await asyncio.create_subprocess_exec(
                "git", "-C", repo_path, "worktree", "list",
                "--porcelain",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()

            if proc.returncode == 0:
                current_info: Optional[WorktreeInfo] = None
                for line in stdout.decode().split("\n"):
                    line = line.strip()
                    if line.startswith("worktree "):
                        if current_info:
                            worktrees.append(current_info)
                        current_info = WorktreeInfo(
                            repo_path=repo_path,
                            worktree_path=line[9:],
                        )
                    elif line.startswith("branch ") and current_info:
                        branch = line[7:]
                        current_info.branch_name = branch.replace("refs/heads/", "")
                    elif line.startswith("HEAD ") and current_info:
                        current_info.status = "active"

                if current_info:
                    worktrees.append(current_info)

        except FileNotFoundError:
            # 降级：扫描 .worktrees 目录
            worktrees_root = Path(repo_path) / ".worktrees"
            if worktrees_root.exists():
                for wt_dir in worktrees_root.iterdir():
                    if wt_dir.is_dir():
                        worktrees.append(WorktreeInfo(
                            repo_path=repo_path,
                            worktree_path=str(wt_dir),
                            branch_name=wt_dir.name,
                            status="unknown",
                        ))

        except Exception as e:
            logger.error(f"列出 worktree 异常: {e}")

        return worktrees

    async def cleanup_all_worktrees(self, repo_path: str):
        """清理所有 worktree（质量评审通过后触发）"""
        worktrees = await self.list_worktrees(repo_path)
        main_worktree = str(Path(repo_path).resolve())

        for wt in worktrees:
            # 跳过主 worktree
            if wt.worktree_path == main_worktree:
                continue
            try:
                await self.cleanup_worktree(
                    wt.worktree_id or Path(wt.worktree_path).name,
                    repo_path,
                )
            except Exception as e:
                logger.error(f"清理 worktree 失败 {wt.worktree_path}: {e}")
