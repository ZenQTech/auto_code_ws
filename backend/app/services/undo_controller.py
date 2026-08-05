"""
# ============================================================
# UndoController 服务 (v1.0.0)
# Cycle 66 G66-02
# ============================================================
# 核心作用：安全回退引擎 + 冲突检测
# 运行流程：
#   1. preview(snapshot_id) → 计算 diff 预览
#   2. detect_conflicts(snapshot) → 对比当前状态与快照
#   3. restore(snapshot_id, paths, force) → 应用反向变更
# 设计要点：
#   - 冲突检测：当前 hash != 快照 hash → 冲突
#   - 强制模式：force=true 时跳过冲突检测
#   - 状态机：pending_confirm → completed/partial
#   - 并发互斥：单 session 同时只允许一个 restore
#   - 路径过滤：可选只恢复部分文件
# 输入参数：snapshot_id, paths(可选), force(可选)
# 输出结果：RestoreResult
# 对标：Codex CLI safe apply path + agent-rollback restore
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
# ====================================
"""

import asyncio
import difflib
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .file_storage import (
    FileNotFoundError,
    FileStorage,
    PathNotAllowedError,
    compute_hash,
    get_file_storage,
)
from .snapshot_store import (
    Snapshot,
    SnapshotFile,
    SnapshotNotFoundError,
    SnapshotStore,
    get_snapshot_store,
)

logger = logging.getLogger(__name__)


# ============================================================
# 异常类型
# ============================================================


class UndoError(Exception):
    """Undo 基础异常"""
    pass


class ConflictDetectedError(UndoError):
    """检测到冲突（需要 force 强制）"""

    def __init__(self, conflicts: List["Conflict"]):
        self.conflicts = conflicts
        super().__init__(f"检测到 {len(conflicts)} 个冲突")


class ConcurrentRestoreError(UndoError):
    """并发恢复被拒绝"""
    pass


# ============================================================
# 数据模型
# ============================================================


@dataclass
class Conflict:
    """恢复冲突"""

    path: str
    type: str                # "file_modified" | "file_deleted" | "file_added"
    expected_hash: str       # 快照记录的 hash
    actual_hash: str         # 实际当前 hash（空字符串表示文件不存在）
    expected_content: Optional[str] = None  # 快照中的内容
    actual_content: Optional[str] = None    # 实际内容

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "type": self.type,
            "expected_hash": self.expected_hash,
            "actual_hash": self.actual_hash,
        }


@dataclass
class FileChange:
    """单个文件的变更预览"""

    path: str
    change_type: str         # "modify" | "create" | "delete" | "unchanged"
    diff: str = ""           # unified diff
    additions: int = 0
    deletions: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "change_type": self.change_type,
            "diff": self.diff,
            "additions": self.additions,
            "deletions": self.deletions,
        }


@dataclass
class DiffPreview:
    """恢复预览"""

    snapshot_id: str
    files: List[FileChange] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "files": [f.to_dict() for f in self.files],
            "created_at": self.created_at,
        }


@dataclass
class RestoreResult:
    """恢复结果"""

    success: bool
    status: str              # "completed" | "partial" | "pending_confirm" | "failed"
    applied: List[str] = field(default_factory=list)
    failed: List[Tuple[str, str]] = field(default_factory=list)
    conflicts: List[Conflict] = field(default_factory=list)
    message: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "status": self.status,
            "applied": self.applied,
            "failed": [
                {"path": p, "error": e} for p, e in self.failed
            ],
            "conflicts": [c.to_dict() for c in self.conflicts],
            "message": self.message,
        }


# ============================================================
# 工具函数
# ============================================================


def _compute_unified_diff(
    old: str, new: str, fromfile: str = "snapshot", tofile: str = "current"
) -> Tuple[str, int, int]:
    """
    计算 unified diff
    返回：(diff_text, additions, deletions)
    """
    if old == new:
        return "", 0, 0
    diff_lines = list(
        difflib.unified_diff(
            old.splitlines(keepends=True),
            new.splitlines(keepends=True),
            fromfile=fromfile,
            tofile=tofile,
            n=3,
        )
    )
    additions = 0
    deletions = 0
    for line in diff_lines:
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return "".join(diff_lines), additions, deletions


# ============================================================
# UndoController
# ============================================================


class UndoController:
    """
    撤销控制器
    - 冲突检测
    - diff 预览
    - 安全回退
    - 并发互斥
    """

    def __init__(
        self,
        snapshot_store: Optional[SnapshotStore] = None,
        file_storage: Optional[FileStorage] = None,
    ):
        self._store = snapshot_store or get_snapshot_store()
        self._files = file_storage or get_file_storage()
        # session_id -> asyncio.Lock
        self._locks: Dict[str, asyncio.Lock] = {}
        self._lock_guard = asyncio.Lock()

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        """获取或创建 session 的恢复锁"""
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    # ============================================================
    # 冲突检测
    # ============================================================

    def detect_conflicts(
        self,
        snapshot: Snapshot,
        paths: Optional[List[str]] = None,
    ) -> List[Conflict]:
        """
        检测当前状态与快照状态之间的冲突
        - paths 为 None 时检查快照内全部文件
        - paths 非空时只检查指定路径
        """
        conflicts: List[Conflict] = []
        for snap_file in snapshot.files:
            if paths and snap_file.path not in paths:
                continue
            if snap_file.existed:
                # 快照时文件存在：现在应该也存在且内容一致
                if not os.path.exists(snap_file.path):
                    # 当前文件不存在：冲突
                    try:
                        expected_content_bytes = self._store.read_file(
                            snapshot, snap_file.path
                        )
                        expected_content = expected_content_bytes.decode(
                            "utf-8", errors="replace"
                        )
                    except SnapshotNotFoundError:
                        expected_content = None
                    conflicts.append(
                        Conflict(
                            path=snap_file.path,
                            type="file_deleted",
                            expected_hash=snap_file.hash,
                            actual_hash="",
                            expected_content=expected_content,
                            actual_content=None,
                        )
                    )
                    continue
                # 当前文件存在：hash 应等于快照 hash
                try:
                    actual_hash = self._files.hash_file(snap_file.path)
                except (FileNotFoundError, PathNotAllowedError):
                    actual_hash = ""
                if actual_hash == snap_file.hash:
                    continue  # 内容一致
                # 不一致：冲突
                try:
                    actual_content = self._files.read_text(snap_file.path)
                except (FileNotFoundError, PathNotAllowedError, Exception):
                    actual_content = None
                try:
                    expected_content_bytes = self._store.read_file(
                        snapshot, snap_file.path
                    )
                    expected_content = expected_content_bytes.decode(
                        "utf-8", errors="replace"
                    )
                except SnapshotNotFoundError:
                    expected_content = None
                conflicts.append(
                    Conflict(
                        path=snap_file.path,
                        type="file_modified",
                        expected_hash=snap_file.hash,
                        actual_hash=actual_hash,
                        expected_content=expected_content,
                        actual_content=actual_content,
                    )
                )
            else:
                # 快照时文件不存在：现在也不应该存在
                if os.path.exists(snap_file.path):
                    # 当前文件存在：冲突
                    try:
                        actual_hash = self._files.hash_file(snap_file.path)
                    except (FileNotFoundError, PathNotAllowedError):
                        actual_hash = ""
                    try:
                        actual_content = self._files.read_text(snap_file.path)
                    except Exception:
                        actual_content = None
                    conflicts.append(
                        Conflict(
                            path=snap_file.path,
                            type="file_added",
                            expected_hash="",
                            actual_hash=actual_hash,
                            expected_content=None,
                            actual_content=actual_content,
                        )
                    )
        return conflicts

    # ============================================================
    # 预览
    # ============================================================

    def preview(
        self,
        snapshot: Snapshot,
        paths: Optional[List[str]] = None,
    ) -> DiffPreview:
        """
        预览恢复后的差异
        返回 DiffPreview
        """
        changes: List[FileChange] = []
        for snap_file in snapshot.files:
            if paths and snap_file.path not in paths:
                continue
            current_exists = os.path.exists(snap_file.path)
            if snap_file.existed and current_exists:
                # modify 或 unchanged
                try:
                    current_content = self._files.read_text(snap_file.path)
                except (FileNotFoundError, PathNotAllowedError, Exception):
                    current_content = ""
                try:
                    snapshot_content = self._store.read_file(
                        snapshot, snap_file.path
                    ).decode("utf-8", errors="replace")
                except SnapshotNotFoundError:
                    snapshot_content = ""
                diff, adds, dels = _compute_unified_diff(
                    current_content, snapshot_content, "current", "snapshot"
                )
                change_type = "unchanged" if not diff else "modify"
                changes.append(
                    FileChange(
                        path=snap_file.path,
                        change_type=change_type,
                        diff=diff,
                        additions=adds,
                        deletions=dels,
                    )
                )
            elif snap_file.existed and not current_exists:
                # create
                try:
                    snapshot_content = self._store.read_file(
                        snapshot, snap_file.path
                    ).decode("utf-8", errors="replace")
                except SnapshotNotFoundError:
                    snapshot_content = ""
                diff, adds, dels = _compute_unified_diff(
                    "", snapshot_content, "/dev/null", "snapshot"
                )
                changes.append(
                    FileChange(
                        path=snap_file.path,
                        change_type="create",
                        diff=diff,
                        additions=adds,
                        deletions=0,
                    )
                )
            elif not snap_file.existed and current_exists:
                # delete
                try:
                    current_content = self._files.read_text(snap_file.path)
                except (FileNotFoundError, PathNotAllowedError, Exception):
                    current_content = ""
                diff, adds, dels = _compute_unified_diff(
                    current_content, "", "current", "/dev/null"
                )
                changes.append(
                    FileChange(
                        path=snap_file.path,
                        change_type="delete",
                        diff=diff,
                        additions=0,
                        deletions=dels,
                    )
                )
            else:
                # unchanged（都不存在）
                changes.append(
                    FileChange(
                        path=snap_file.path,
                        change_type="unchanged",
                    )
                )
        return DiffPreview(
            snapshot_id=snapshot.snapshot_id,
            files=changes,
            created_at=time.time(),
        )

    # ============================================================
    # 回退
    # ============================================================

    async def restore(
        self,
        snapshot_id: str,
        paths: Optional[List[str]] = None,
        force: bool = False,
        actor: str = "user",
    ) -> RestoreResult:
        """
        恢复快照
        1. 获取快照
        2. 冲突检测
        3. 有冲突且未 force → pending_confirm
        4. 应用反向变更
        5. 报告结果
        """
        try:
            snapshot = self._store.get(snapshot_id)
        except SnapshotNotFoundError as e:
            return RestoreResult(
                success=False,
                status="failed",
                message=str(e),
            )

        lock = self._get_lock(snapshot.session_id)
        if lock.locked():
            return RestoreResult(
                success=False,
                status="failed",
                message=f"session {snapshot.session_id} 已有恢复操作在进行中",
            )

        async with lock:
            return await self._do_restore(snapshot, paths, force, actor)

    async def _do_restore(
        self,
        snapshot: Snapshot,
        paths: Optional[List[str]],
        force: bool,
        actor: str,
    ) -> RestoreResult:
        """实际的恢复逻辑（受 lock 保护）"""
        # 1. 冲突检测
        conflicts = self.detect_conflicts(snapshot, paths)
        if conflicts and not force:
            return RestoreResult(
                success=False,
                status="pending_confirm",
                conflicts=conflicts,
                applied=[],
                failed=[],
                message=(
                    f"检测到 {len(conflicts)} 个冲突。"
                    f"设置 force=true 强制恢复。"
                ),
            )

        # 2. 应用变更
        target_paths = paths if paths else [f.path for f in snapshot.files]
        applied: List[str] = []
        failed: List[Tuple[str, str]] = []

        # 按路径倒序应用（先深层文件再浅层）
        for snap_file in reversed(snapshot.files):
            if snap_file.path not in target_paths:
                continue
            try:
                if snap_file.existed:
                    content = self._store.read_file(snapshot, snap_file.path)
                    self._files.write(snap_file.path, content)
                    applied.append(snap_file.path)
                else:
                    # 快照时不存在 → 应该删除当前文件
                    if self._files.exists(snap_file.path):
                        self._files.delete(snap_file.path)
                    applied.append(snap_file.path)
            except Exception as e:  # noqa: BLE001
                logger.exception(f"恢复文件失败 {snap_file.path}: {e}")
                failed.append((snap_file.path, str(e)))

        # 3. 报告
        if failed and applied:
            status = "partial"
        elif failed and not applied:
            status = "failed"
        else:
            status = "completed"

        success = len(failed) == 0
        message = (
            f"actor={actor} 恢复了 {len(applied)} 个文件"
            + (f"，{len(failed)} 个失败" if failed else "")
        )

        logger.info(
            f"restore 完成: snapshot={snapshot.snapshot_id}, "
            f"status={status}, applied={len(applied)}, failed={len(failed)}, "
            f"force={force}, actor={actor}"
        )
        return RestoreResult(
            success=success,
            status=status,
            applied=applied,
            failed=failed,
            conflicts=conflicts,
            message=message,
        )

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取控制器状态"""
        return {
            "active_sessions": len(self._locks),
            "locked_sessions": [
                sid for sid, lock in self._locks.items() if lock.locked()
            ],
            "store_stats": self._store.get_stats(),
        }


# ============================================================
# 全局单例
# ============================================================


_undo_controller: Optional[UndoController] = None


def get_undo_controller() -> UndoController:
    """获取全局 UndoController 实例"""
    global _undo_controller
    if _undo_controller is None:
        _undo_controller = UndoController()
    return _undo_controller


def reset_undo_controller() -> None:
    """重置全局实例（仅测试）"""
    global _undo_controller
    _undo_controller = None
