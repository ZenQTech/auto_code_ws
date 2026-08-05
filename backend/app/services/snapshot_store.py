"""
# ============================================================
# SnapshotStore 服务 (v1.0.0)
# Cycle 66 G66-02
# ============================================================
# 核心作用：文件级快照存储，基于内容寻址 + LRU + 持久化
# 运行流程：
#   1. create(snapshot) → 写入 metadata.json + 文件副本到磁盘
#   2. get(snapshot_id) → 读取 metadata.json
#   3. list(session_id) → 按 session 过滤 + 时间倒序
#   4. delete(snapshot_id) → 物理删除 + 索引清理
#   5. LRU 淘汰：单 session 超过 max_count 时删除最旧
# 设计要点：
#   - 内容寻址：snapshot_id = sha256(agent_id|timestamp|files)[:16]
#   - 持久化：JSON metadata + 文件副本存储在 ~/.hermes/snapshots/
#   - LRU：按 created_at 排序淘汰
#   - 单快照文件数限制：1000
#   - 单快照总大小限制：100MB
# 输入参数：快照元数据、文件路径列表
# 输出结果：Snapshot 对象 / 列表
# 对标：agent-rollback content-addressed snapshots
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
# ====================================
"""

import json
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .file_storage import (
    FileNotFoundError,
    FileStorage,
    PathNotAllowedError,
    compute_hash,
    get_file_storage,
)

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================


# 默认快照根目录
DEFAULT_SNAPSHOT_ROOT = os.path.expanduser("~/.hermes/snapshots")

# 单快照最大文件数
MAX_FILES_PER_SNAPSHOT = 1000

# 单快照最大总大小（100MB）
MAX_TOTAL_SIZE = 100 * 1024 * 1024

# 单 session 快照数（LRU 容量）
DEFAULT_MAX_SNAPSHOTS_PER_SESSION = 100


# ============================================================
# 异常类型
# ============================================================


class SnapshotError(Exception):
    """快照基础异常"""
    pass


class SnapshotNotFoundError(SnapshotError):
    pass


class SnapshotTooLargeError(SnapshotError):
    """快照过大"""
    pass


class SnapshotStorageFullError(SnapshotError):
    """存储已满"""
    pass


class InvalidSnapshotError(SnapshotError):
    """快照数据非法"""
    pass


# ============================================================
# 数据模型
# ============================================================


@dataclass
class SnapshotFile:
    """快照中单个文件的信息"""

    path: str                # 原始路径
    hash: str                # sha256 前 16 字符
    size: int                # 字节数
    existed: bool            # 快照时文件是否存在
    storage_relpath: str = ""  # 在快照目录中的相对路径

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SnapshotFile":
        return cls(
            path=data["path"],
            hash=data["hash"],
            size=int(data["size"]),
            existed=bool(data.get("existed", True)),
            storage_relpath=data.get("storage_relpath", ""),
        )


@dataclass
class Snapshot:
    """文件快照"""

    snapshot_id: str         # content-addressed ID
    session_id: str
    agent_id: str
    trigger: str             # "manual" | "auto" | "pre_edit"
    description: str
    files: List[SnapshotFile] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    storage_path: str = ""   # 磁盘根目录

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def total_size(self) -> int:
        return sum(f.size for f in self.files)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "trigger": self.trigger,
            "description": self.description,
            "files": [f.to_dict() for f in self.files],
            "file_count": self.file_count,
            "total_size": self.total_size,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Snapshot":
        files = [SnapshotFile.from_dict(f) for f in data.get("files", [])]
        return cls(
            snapshot_id=data["snapshot_id"],
            session_id=data["session_id"],
            agent_id=data["agent_id"],
            trigger=data.get("trigger", "manual"),
            description=data.get("description", ""),
            files=files,
            created_at=float(data.get("created_at", time.time())),
            storage_path=data.get("storage_path", ""),
        )


# ============================================================
# 工具函数
# ============================================================


def compute_snapshot_id(agent_id: str, files_hash: str, timestamp: float) -> str:
    """
    计算内容寻址快照 ID
    算法：sha256(agent_id|timestamp|files_hash)[:16]
    """
    payload = f"{agent_id}|{timestamp}|{files_hash}"
    return compute_hash(payload.encode("utf-8"))


def compute_files_hash(file_hashes: List[str]) -> str:
    """计算多个文件 hash 的聚合 hash（用于快照 ID）"""
    if not file_hashes:
        return "empty"
    sorted_hashes = sorted(file_hashes)
    return compute_hash("|".join(sorted_hashes).encode("utf-8"))


# ============================================================
# 存储实现
# ============================================================


class SnapshotStore:
    """
    快照存储服务
    - 内容寻址：基于 agent_id + 时间戳 + 文件 hash 派生 ID
    - 持久化：JSON metadata + 文件副本存储
    - LRU 容量管理：单 session 默认 100 条
    """

    def __init__(
        self,
        storage_root: Optional[str] = None,
        file_storage: Optional[FileStorage] = None,
        max_snapshots_per_session: int = DEFAULT_MAX_SNAPSHOTS_PER_SESSION,
    ):
        self._storage_root = Path(storage_root or DEFAULT_SNAPSHOT_ROOT)
        self._storage_root.mkdir(parents=True, exist_ok=True)
        self._file_storage = file_storage or get_file_storage()
        self._max_per_session = max_snapshots_per_session
        # session_id -> [snapshot_id, ...]（按 created_at 升序）
        self._session_index: Dict[str, List[str]] = {}
        # snapshot_id -> Snapshot（元数据缓存）
        self._snapshots: Dict[str, Snapshot] = {}
        # 启动时加载已存在的快照
        self._load_index()

    # ============================================================
    # 索引加载与持久化
    # ============================================================

    def _load_index(self) -> None:
        """从磁盘加载快照索引"""
        if not self._storage_root.exists():
            return
        for session_dir in self._storage_root.iterdir():
            if not session_dir.is_dir():
                continue
            session_id = session_dir.name
            snapshot_ids: List[str] = []
            for snap_dir in session_dir.iterdir():
                if not snap_dir.is_dir():
                    continue
                meta_file = snap_dir / "metadata.json"
                if not meta_file.exists():
                    continue
                try:
                    data = json.loads(meta_file.read_text(encoding="utf-8"))
                    snap = Snapshot.from_dict(data)
                    self._snapshots[snap.snapshot_id] = snap
                    snapshot_ids.append(snap.snapshot_id)
                except (json.JSONDecodeError, KeyError, ValueError) as e:
                    logger.warning(
                        f"加载快照元数据失败 {meta_file}: {e}"
                    )
            if snapshot_ids:
                # 按 created_at 升序
                snapshot_ids.sort(
                    key=lambda sid: self._snapshots[sid].created_at
                )
                self._session_index[session_id] = snapshot_ids

    def _save_metadata(self, snapshot: Snapshot) -> None:
        """保存快照元数据到磁盘"""
        snap_dir = self._snapshot_dir(snapshot)
        snap_dir.mkdir(parents=True, exist_ok=True)
        meta_file = snap_dir / "metadata.json"
        meta_file.write_text(
            json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _snapshot_dir(self, snapshot: Snapshot) -> Path:
        """获取快照存储目录"""
        return self._storage_root / snapshot.session_id / snapshot.snapshot_id

    # ============================================================
    # CRUD
    # ============================================================

    def create(
        self,
        session_id: str,
        agent_id: str,
        paths: List[str],
        trigger: str = "manual",
        description: str = "",
    ) -> Snapshot:
        """
        创建快照
        1. 读取每个文件的字节内容 + 计算 hash
        2. 计算 snapshot_id
        3. 写入磁盘
        4. 更新索引
        5. 触发 LRU 淘汰

        Args:
            session_id: 会话 ID
            agent_id: agent ID
            paths: 待快照的文件路径列表
            trigger: 触发类型 "manual" | "auto" | "pre_edit"
            description: 描述

        Returns:
            Snapshot 对象
        """
        if not session_id or not agent_id:
            raise InvalidSnapshotError("session_id 和 agent_id 必填")
        if not paths:
            raise InvalidSnapshotError("paths 不能为空")
        if len(paths) > MAX_FILES_PER_SNAPSHOT:
            raise SnapshotTooLargeError(
                f"文件数 {len(paths)} 超过限制 {MAX_FILES_PER_SNAPSHOT}"
            )

        timestamp = time.time()
        snapshot_files: List[SnapshotFile] = []
        file_hashes: List[str] = []
        total_size = 0
        file_contents: Dict[str, bytes] = {}

        # 1. 读取所有文件
        for raw_path in paths:
            try:
                abs_path = self._file_storage.validate_path(raw_path)
            except PathNotAllowedError as e:
                logger.warning(f"跳过非法路径 {raw_path}: {e}")
                continue

            if os.path.exists(abs_path):
                size = os.path.getsize(abs_path)
                if total_size + size > MAX_TOTAL_SIZE:
                    raise SnapshotTooLargeError(
                        f"快照总大小超过 {MAX_TOTAL_SIZE}"
                    )
                try:
                    content = self._file_storage.read(abs_path)
                except FileNotFoundError as e:
                    logger.warning(f"读取文件失败 {abs_path}: {e}")
                    continue
                file_hash = compute_hash(content)
                snapshot_files.append(
                    SnapshotFile(
                        path=abs_path,
                        hash=file_hash,
                        size=size,
                        existed=True,
                    )
                )
                file_hashes.append(file_hash)
                total_size += size
                file_contents[abs_path] = content
            else:
                # 文件不存在：记录 deletion 状态
                snapshot_files.append(
                    SnapshotFile(
                        path=abs_path,
                        hash="",
                        size=0,
                        existed=False,
                    )
                )

        # 2. 计算 snapshot_id
        files_hash = compute_files_hash(file_hashes)
        snapshot_id = compute_snapshot_id(agent_id, files_hash, timestamp)

        # 避免 ID 冲突：附加短 UUID
        if snapshot_id in self._snapshots:
            snapshot_id = snapshot_id + "_" + uuid.uuid4().hex[:6]

        # 3. 构造 Snapshot 对象
        snapshot = Snapshot(
            snapshot_id=snapshot_id,
            session_id=session_id,
            agent_id=agent_id,
            trigger=trigger,
            description=description,
            files=snapshot_files,
            created_at=timestamp,
            storage_path=str(self._storage_root),
        )

        # 4. 写入磁盘
        snap_dir = self._snapshot_dir(snapshot)
        snap_dir.mkdir(parents=True, exist_ok=True)
        files_dir = snap_dir / "files"
        files_dir.mkdir(exist_ok=True)
        for i, snap_file in enumerate(snapshot.files):
            if not snap_file.existed:
                continue
            # 使用索引避免路径中斜杠冲突
            storage_name = f"{i:04d}_{os.path.basename(snap_file.path)}"
            target = files_dir / storage_name
            with open(target, "wb") as f:
                f.write(file_contents[snap_file.path])
            snap_file.storage_relpath = f"files/{storage_name}"
        self._save_metadata(snapshot)

        # 5. 更新内存索引
        self._snapshots[snapshot_id] = snapshot
        self._session_index.setdefault(session_id, []).append(snapshot_id)

        # 6. LRU 淘汰
        self._evict_lru(session_id)

        logger.info(
            f"快照创建成功: id={snapshot_id}, files={len(snapshot.files)}, "
            f"size={snapshot.total_size}, trigger={trigger}"
        )
        return snapshot

    def get(self, snapshot_id: str) -> Snapshot:
        """获取快照详情"""
        if snapshot_id not in self._snapshots:
            raise SnapshotNotFoundError(f"快照不存在: {snapshot_id}")
        return self._snapshots[snapshot_id]

    def list(
        self,
        session_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Snapshot], int]:
        """
        列出 session 的快照（按时间倒序）
        返回：(snapshots, total)
        """
        if session_id not in self._session_index:
            return [], 0
        ids = self._session_index[session_id]
        # 按 created_at 倒序
        sorted_ids = sorted(
            ids, key=lambda sid: self._snapshots[sid].created_at, reverse=True
        )
        total = len(sorted_ids)
        page = sorted_ids[offset : offset + limit]
        return [self._snapshots[sid] for sid in page], total

    def delete(self, snapshot_id: str) -> bool:
        """
        删除快照
        返回：是否成功删除
        """
        if snapshot_id not in self._snapshots:
            return False
        snapshot = self._snapshots[snapshot_id]
        # 物理删除
        snap_dir = self._snapshot_dir(snapshot)
        if snap_dir.exists():
            import shutil
            try:
                shutil.rmtree(snap_dir)
            except OSError as e:
                logger.warning(f"删除快照目录失败 {snap_dir}: {e}")
        # 清理索引
        if snapshot.session_id in self._session_index:
            self._session_index[snapshot.session_id] = [
                sid
                for sid in self._session_index[snapshot.session_id]
                if sid != snapshot_id
            ]
            if not self._session_index[snapshot.session_id]:
                del self._session_index[snapshot.session_id]
        del self._snapshots[snapshot_id]
        logger.info(f"快照删除: id={snapshot_id}")
        return True

    def read_file(self, snapshot: Snapshot, file_path: str) -> bytes:
        """
        读取快照中指定文件的字节内容
        抛出：SnapshotNotFoundError
        """
        for snap_file in snapshot.files:
            if snap_file.path == file_path:
                if not snap_file.existed:
                    raise SnapshotNotFoundError(
                        f"快照中文件不存在: {file_path}"
                    )
                if not snap_file.storage_relpath:
                    raise SnapshotNotFoundError(
                        f"快照文件未持久化: {file_path}"
                    )
                snap_dir = self._snapshot_dir(snapshot)
                target = snap_dir / snap_file.storage_relpath
                if not target.exists():
                    raise SnapshotNotFoundError(
                        f"快照文件已丢失: {target}"
                    )
                return target.read_bytes()
        raise SnapshotNotFoundError(f"快照不含文件: {file_path}")

    # ============================================================
    # LRU 淘汰
    # ============================================================

    def _evict_lru(self, session_id: str) -> int:
        """
        淘汰最旧的快照，直到数量 ≤ max_per_session
        返回：淘汰数量
        """
        if session_id not in self._session_index:
            return 0
        ids = self._session_index[session_id]
        evicted = 0
        while len(ids) > self._max_per_session:
            oldest_id = min(
                ids, key=lambda sid: self._snapshots[sid].created_at
            )
            # 静默删除（不再递归 evict）
            snapshot = self._snapshots[oldest_id]
            snap_dir = self._snapshot_dir(snapshot)
            if snap_dir.exists():
                import shutil
                try:
                    shutil.rmtree(snap_dir)
                except OSError:
                    pass
            del self._snapshots[oldest_id]
            ids.remove(oldest_id)
            evicted += 1
        if not ids:
            self._session_index.pop(session_id, None)
        if evicted:
            logger.info(
                f"LRU 淘汰: session={session_id}, count={evicted}, "
                f"remaining={len(ids)}"
            )
        return evicted

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取存储统计信息"""
        total_files = sum(s.file_count for s in self._snapshots.values())
        total_size = sum(s.total_size for s in self._snapshots.values())
        return {
            "total_snapshots": len(self._snapshots),
            "total_sessions": len(self._session_index),
            "total_files": total_files,
            "total_size": total_size,
            "storage_root": str(self._storage_root),
            "max_per_session": self._max_per_session,
        }

    def has_snapshot(self, snapshot_id: str) -> bool:
        """检查快照是否存在"""
        return snapshot_id in self._snapshots

    def get_session_ids(self) -> List[str]:
        """返回所有有快照的 session_id"""
        return list(self._session_index.keys())


# ============================================================
# 全局单例
# ============================================================


_snapshot_store: Optional[SnapshotStore] = None


def get_snapshot_store() -> SnapshotStore:
    """获取全局 SnapshotStore 实例"""
    global _snapshot_store
    if _snapshot_store is None:
        _snapshot_store = SnapshotStore()
    return _snapshot_store


def reset_snapshot_store() -> None:
    """重置全局实例（仅测试）"""
    global _snapshot_store
    _snapshot_store = None
