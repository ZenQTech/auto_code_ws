"""
# ============================================================
# Rollback 服务 - 一键回退 (v1.0.0)
# Cycle 61 G61-07
# ============================================================
# 核心作用：基于 git revert 实现一键代码回退
#           - 快照：每次 Plan/Step 完成后自动创建 git commit
#           - 回退：用户选择 commit → git revert → 新 commit
#           - 历史：维护 commit 元数据（plan_id / step_id / 时间）
# 运行流程：
#   1. 监听 ComposerPlan / Step 完成事件
#   2. 完成后调用 create_snapshot(plan_id, step_id, message)
#   3. 返回 commit_hash 存入数据库
#   4. 用户触发回退：调用 rollback(commit_hash)
#   5. 执行 git revert <commit_hash> --no-edit
#   6. 返回新的 revert commit hash
# 设计要点：
#   - 只回退 working tree（不删 commit 历史）
#   - 支持批量回退：传入多个 commit → 从新到旧依次 revert
#   - 保留回退历史：每次回退也产生 commit
# 输入参数：commit hash, repo path
# 输出结果：revert result
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-07 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class SnapshotSource(str, Enum):
    """快照来源"""
    PLAN = "plan"                # Plan 完成
    STEP = "step"                # Step 完成
    MANUAL = "manual"            # 手动提交
    INITIAL = "initial"          # 初始 commit


@dataclass
class Snapshot:
    """
    代码快照
    字段说明：
      - snapshot_id: 唯一 ID
      - commit_hash: git commit hash
      - short_hash: 短 hash（前 8 位）
      - message: commit 消息
      - source: 快照来源
      - plan_id: 关联 Plan ID（可选）
      - step_id: 关联 Step ID（可选）
      - author: 作者
      - created_at: 时间戳
      - files_changed: 变更文件数
      - insertions: 新增行数
      - deletions: 删除行数
    """
    snapshot_id: str = field(default_factory=lambda: f"snap-{uuid.uuid4().hex[:12]}")
    commit_hash: str = ""
    short_hash: str = ""
    message: str = ""
    source: SnapshotSource = SnapshotSource.MANUAL
    plan_id: Optional[str] = None
    step_id: Optional[str] = None
    author: str = "hermes"
    created_at: float = field(default_factory=time.time)
    files_changed: int = 0
    insertions: int = 0
    deletions: int = 0
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "snapshot_id": self.snapshot_id,
            "commit_hash": self.commit_hash,
            "short_hash": self.short_hash or self.commit_hash[:8],
            "message": self.message,
            "source": self.source.value,
            "plan_id": self.plan_id,
            "step_id": self.step_id,
            "author": self.author,
            "created_at": self.created_at,
            "files_changed": self.files_changed,
            "insertions": self.insertions,
            "deletions": self.deletions,
            "metadata": dict(self.metadata),
        }


@dataclass
class RollbackResult:
    """回退结果"""
    success: bool
    original_commit: str = ""
    revert_commit: str = ""
    message: str = ""
    error: Optional[str] = None
    files_changed: int = 0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return {
            "success": self.success,
            "original_commit": self.original_commit,
            "revert_commit": self.revert_commit,
            "message": self.message,
            "error": self.error,
            "files_changed": self.files_changed,
            "timestamp": self.timestamp,
        }


# ============================================================
# Git 操作工具
# ============================================================


async def _run_git(args: List[str], cwd: str, timeout: int = 30) -> Tuple[int, str, str]:
    """
    执行 git 命令
    输入参数：args, cwd, timeout
    输出结果：(returncode, stdout, stderr)
    """
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError as e:
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass
        raise TimeoutError(f"git command timeout after {timeout}s") from e
    return (
        proc.returncode or 0,
        stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )


async def _is_git_repo(path: str) -> bool:
    """检查是否是 git 仓库"""
    rc, _, _ = await _run_git(
        ["rev-parse", "--is-inside-work-tree"],
        cwd=path,
        timeout=5,
    )
    return rc == 0


async def _has_changes(path: str) -> bool:
    """检查是否有未提交的变更"""
    rc, out, _ = await _run_git(
        ["status", "--porcelain"],
        cwd=path,
        timeout=5,
    )
    return rc == 0 and bool(out.strip())


async def _get_changed_stats(path: str, commit_hash: str) -> Tuple[int, int, int]:
    """
    获取 commit 的变更统计（文件数、新增、删除）
    使用 numstat 输出，更精确
    """
    rc, out, _ = await _run_git(
        ["show", "--numstat", "--format=", commit_hash],
        cwd=path,
        timeout=10,
    )
    if rc != 0:
        return 0, 0, 0
    files = insertions = deletions = 0
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        # numstat 格式: "<additions>\t<deletions>\t<filename>"
        # 二进制文件: "-\t-\t<filename>"
        parts = line.split("\t")
        if len(parts) >= 3:
            files += 1
            try:
                insertions += int(parts[0])
            except (ValueError, TypeError):
                pass
            try:
                deletions += int(parts[1])
            except (ValueError, TypeError):
                pass
    return files, insertions, deletions


# ============================================================
# Rollback Manager
# ============================================================


class RollbackManager:
    """
    一键回退管理器

    维护快照历史 + 提供回退能力
    单例（全局唯一）
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # snapshot_id -> Snapshot
        self._snapshots: Dict[str, Snapshot] = {}
        # commit_hash -> snapshot_id
        self._by_commit: Dict[str, str] = {}
        # plan_id -> [snapshot_id]
        self._by_plan: Dict[str, List[str]] = {}
        # 回退历史
        self._rollback_history: List[RollbackResult] = []

    # -------- 快照管理 --------

    async def create_snapshot(
        self,
        repo_path: str,
        message: str,
        source: SnapshotSource = SnapshotSource.MANUAL,
        plan_id: Optional[str] = None,
        step_id: Optional[str] = None,
        author: str = "hermes",
        add_all: bool = True,
    ) -> Optional[Snapshot]:
        """
        创建代码快照（git add + commit）

        输入参数：repo_path, message, source, plan_id, step_id, author, add_all
        输出结果：Snapshot 或 None（失败时）
        """
        if not os.path.isdir(repo_path):
            logger.error(f"create_snapshot: 路径不存在 repo={repo_path}")
            return None
        if not await _is_git_repo(repo_path):
            logger.error(f"create_snapshot: 不是 git 仓库 repo={repo_path}")
            return None

        async with self._lock:
            # 检查是否有变更
            if not await _has_changes(repo_path):
                logger.info(f"create_snapshot: 无变更，跳过 repo={repo_path}")
                return None

            # git add
            if add_all:
                rc, _, err = await _run_git(
                    ["add", "-A"],
                    cwd=repo_path,
                    timeout=15,
                )
                if rc != 0:
                    logger.error(f"create_snapshot: git add 失败 err={err}")
                    return None

            # git commit
            full_message = f"[{source.value}] {message}"
            if plan_id:
                full_message += f"\n\nplan_id: {plan_id}"
            if step_id:
                full_message += f"\nstep_id: {step_id}"

            rc, out, err = await _run_git(
                ["commit", "-m", full_message, f"--author={author} <{author}@hermes.local>"],
                cwd=repo_path,
                timeout=15,
            )
            if rc != 0:
                logger.error(f"create_snapshot: git commit 失败 err={err}")
                return None

            # 获取 commit hash
            rc, hash_out, _ = await _run_git(
                ["rev-parse", "HEAD"],
                cwd=repo_path,
                timeout=5,
            )
            if rc != 0:
                logger.error(f"create_snapshot: 获取 hash 失败")
                return None
            commit_hash = hash_out.strip()

            # 获取变更统计
            files, insertions, deletions = await _get_changed_stats(repo_path, commit_hash)

            # 创建 Snapshot
            snap = Snapshot(
                commit_hash=commit_hash,
                short_hash=commit_hash[:8],
                message=message,
                source=source,
                plan_id=plan_id,
                step_id=step_id,
                author=author,
                created_at=time.time(),
                files_changed=files,
                insertions=insertions,
                deletions=deletions,
            )

            self._snapshots[snap.snapshot_id] = snap
            self._by_commit[commit_hash] = snap.snapshot_id
            if plan_id:
                self._by_plan.setdefault(plan_id, []).append(snap.snapshot_id)

            logger.info(
                f"create_snapshot: id={snap.snapshot_id} hash={snap.short_hash} "
                f"plan={plan_id} step={step_id}"
            )
            return snap

    # -------- 列表查询 --------

    def list_snapshots(
        self,
        plan_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Snapshot]:
        """
        列出快照
        按时间倒序
        """
        if plan_id is not None:
            ids = self._by_plan.get(plan_id, [])
            snaps = [self._snapshots[i] for i in ids if i in self._snapshots]
        else:
            snaps = list(self._snapshots.values())
        snaps.sort(key=lambda s: s.created_at, reverse=True)
        return snaps[:limit]

    def get_snapshot(self, snapshot_id: str) -> Optional[Snapshot]:
        return self._snapshots.get(snapshot_id)

    def get_snapshot_by_commit(self, commit_hash: str) -> Optional[Snapshot]:
        sid = self._by_commit.get(commit_hash)
        if sid is None:
            return None
        return self._snapshots.get(sid)

    # -------- 回退操作 --------

    async def rollback(
        self,
        repo_path: str,
        commit_hash: str,
        message: Optional[str] = None,
    ) -> RollbackResult:
        """
        回退到指定 commit

        实现：git revert <commit_hash> --no-edit
        输入参数：repo_path, commit_hash, message（可选）
        输出结果：RollbackResult
        """
        if not os.path.isdir(repo_path):
            return RollbackResult(
                success=False,
                original_commit=commit_hash,
                error=f"路径不存在: {repo_path}",
            )
        if not await _is_git_repo(repo_path):
            return RollbackResult(
                success=False,
                original_commit=commit_hash,
                error=f"不是 git 仓库: {repo_path}",
            )

        # 检查 commit 是否存在
        rc, _, _ = await _run_git(
            ["cat-file", "-t", commit_hash],
            cwd=repo_path,
            timeout=5,
        )
        if rc != 0:
            return RollbackResult(
                success=False,
                original_commit=commit_hash,
                error=f"commit 不存在: {commit_hash}",
            )

        # 先 stash 未提交的变更（避免冲突）
        await _has_changes(repo_path)
        stashed = False
        if await _has_changes(repo_path):
            rc, _, err = await _run_git(
                ["stash", "push", "-m", "hermes-rollback-auto-stash"],
                cwd=repo_path,
                timeout=10,
            )
            if rc == 0:
                stashed = True
            else:
                logger.warning(f"rollback: stash 失败 err={err}")

        # git revert
        rc, out, err = await _run_git(
            ["revert", commit_hash, "--no-edit"],
            cwd=repo_path,
            timeout=30,
        )

        if rc != 0:
            # 回退 revert
            await _run_git(["revert", "--abort"], cwd=repo_path, timeout=10)
            if stashed:
                await _run_git(["stash", "pop"], cwd=repo_path, timeout=10)
            return RollbackResult(
                success=False,
                original_commit=commit_hash,
                error=f"revert 失败: {err[:500]}",
            )

        # 获取新 commit hash
        rc, hash_out, _ = await _run_git(
            ["rev-parse", "HEAD"],
            cwd=repo_path,
            timeout=5,
        )
        new_hash = hash_out.strip() if rc == 0 else ""

        # 获取统计
        files = 0
        if new_hash:
            files, _, _ = await _get_changed_stats(repo_path, new_hash)

        # 恢复 stash
        if stashed:
            await _run_git(["stash", "pop"], cwd=repo_path, timeout=10)

        # 创建回退快照
        await self.create_snapshot(
            repo_path=repo_path,
            message=message or f"Rollback of {commit_hash[:8]}",
            source=SnapshotSource.MANUAL,
            plan_id=None,
            step_id=None,
        )

        result = RollbackResult(
            success=True,
            original_commit=commit_hash,
            revert_commit=new_hash,
            message=message or f"已回退 commit {commit_hash[:8]}",
            files_changed=files,
        )
        self._rollback_history.append(result)
        logger.info(
            f"rollback: 成功 commit={commit_hash[:8]} -> {new_hash[:8]} files={files}"
        )
        return result

    async def rollback_multiple(
        self,
        repo_path: str,
        commit_hashes: List[str],
    ) -> List[RollbackResult]:
        """
        批量回退（从新到旧依次 revert）
        """
        results: List[RollbackResult] = []
        # 倒序：从最新到最旧
        for ch in reversed(commit_hashes):
            r = await self.rollback(repo_path, ch)
            results.append(r)
            if not r.success:
                # 中断后续回退
                break
        return results

    # -------- 历史 --------

    def get_rollback_history(self, limit: int = 50) -> List[RollbackResult]:
        return list(reversed(self._rollback_history))[:limit]

    def get_git_log(
        self,
        repo_path: str,
        limit: int = 30,
    ) -> List[Dict]:
        """
        获取 git log
        同步包装（因为是只读操作）
        """
        try:
            result = subprocess.run(
                ["git", "log", f"-{limit}", "--pretty=format:%H|%h|%s|%an|%at"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                return []
            entries = []
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split("|", 4)
                if len(parts) >= 5:
                    entries.append({
                        "commit_hash": parts[0],
                        "short_hash": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "timestamp": int(parts[4]),
                    })
            return entries
        except Exception as e:  # noqa: BLE001
            logger.error(f"get_git_log: 失败 err={e}")
            return []


# ============================================================
# 全局单例
# ============================================================


_manager: Optional[RollbackManager] = None


def get_manager() -> RollbackManager:
    global _manager
    if _manager is None:
        _manager = RollbackManager()
    return _manager


def reset_manager() -> None:
    """重置（用于测试）"""
    global _manager
    _manager = None
