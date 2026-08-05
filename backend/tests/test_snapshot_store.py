"""
# ============================================================
# SnapshotStore 单元测试
# Cycle 66 G66-02
# ============================================================
# 测试覆盖：
#   1. 内容寻址 ID 计算
#   2. create: 文件快照 + 持久化 + 索引
#   3. get: 获取快照详情
#   4. list: 列出 session 快照（时间倒序）
#   5. delete: 删除快照
#   6. read_file: 读取快照内文件
#   7. LRU 淘汰
#   8. 持久化（重启加载）
#   9. 异常：空路径、路径越权、超限
# ====================================
"""

import os
import shutil
import time
from pathlib import Path

import pytest

from app.services.file_storage import FileStorage
from app.services.snapshot_store import (
    DEFAULT_MAX_SNAPSHOTS_PER_SESSION,
    InvalidSnapshotError,
    MAX_FILES_PER_SNAPSHOT,
    MAX_TOTAL_SIZE,
    Snapshot,
    SnapshotFile,
    SnapshotNotFoundError,
    SnapshotStore,
    SnapshotTooLargeError,
    compute_files_hash,
    compute_snapshot_id,
    reset_snapshot_store,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def tmp_workspace(tmp_path):
    """创建临时工作目录"""
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    return workdir


@pytest.fixture
def tmp_snapshot_root(tmp_path):
    """创建临时快照存储目录"""
    root = tmp_path / "snapshots"
    root.mkdir()
    return root


@pytest.fixture
def store(tmp_snapshot_root, tmp_workspace):
    """创建 SnapshotStore 实例"""
    fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
    return SnapshotStore(
        storage_root=str(tmp_snapshot_root),
        file_storage=fs,
        max_snapshots_per_session=10,
    )


# ============================================================
# 工具函数测试
# ============================================================


class TestComputeSnapshotId:
    """compute_snapshot_id 测试"""

    def test_basic(self):
        sid = compute_snapshot_id("agent-1", "hash123", 1000.0)
        assert isinstance(sid, str)
        assert len(sid) == 16

    def test_deterministic(self):
        sid1 = compute_snapshot_id("agent-1", "hash", 1000.0)
        sid2 = compute_snapshot_id("agent-1", "hash", 1000.0)
        assert sid1 == sid2

    def test_different_agent(self):
        sid1 = compute_snapshot_id("agent-1", "hash", 1000.0)
        sid2 = compute_snapshot_id("agent-2", "hash", 1000.0)
        assert sid1 != sid2

    def test_different_timestamp(self):
        sid1 = compute_snapshot_id("agent-1", "hash", 1000.0)
        sid2 = compute_snapshot_id("agent-1", "hash", 2000.0)
        assert sid1 != sid2

    def test_different_files_hash(self):
        sid1 = compute_snapshot_id("agent-1", "hash1", 1000.0)
        sid2 = compute_snapshot_id("agent-1", "hash2", 1000.0)
        assert sid1 != sid2


class TestComputeFilesHash:
    """compute_files_hash 测试"""

    def test_empty(self):
        h = compute_files_hash([])
        assert h == "empty"

    def test_basic(self):
        h1 = compute_files_hash(["a", "b", "c"])
        h2 = compute_files_hash(["c", "b", "a"])  # 顺序无关
        assert h1 == h2

    def test_different(self):
        h1 = compute_files_hash(["a", "b"])
        h2 = compute_files_hash(["a", "c"])
        assert h1 != h2


# ============================================================
# DataClass 测试
# ============================================================


class TestSnapshotFile:
    """SnapshotFile 数据类测试"""

    def test_to_dict(self):
        sf = SnapshotFile(path="/a.py", hash="abc", size=100, existed=True)
        d = sf.to_dict()
        assert d["path"] == "/a.py"
        assert d["hash"] == "abc"
        assert d["size"] == 100
        assert d["existed"] is True

    def test_from_dict(self):
        d = {"path": "/b.py", "hash": "def", "size": 200, "existed": False}
        sf = SnapshotFile.from_dict(d)
        assert sf.path == "/b.py"
        assert sf.existed is False


class TestSnapshot:
    """Snapshot 数据类测试"""

    def test_to_dict(self):
        snap = Snapshot(
            snapshot_id="snap-1",
            session_id="sess-1",
            agent_id="agent-1",
            trigger="manual",
            description="test",
        )
        snap.files = [
            SnapshotFile(path="/a.py", hash="h1", size=10, existed=True),
            SnapshotFile(path="/b.py", hash="h2", size=20, existed=True),
        ]
        d = snap.to_dict()
        assert d["snapshot_id"] == "snap-1"
        assert d["file_count"] == 2
        assert d["total_size"] == 30

    def test_from_dict(self):
        d = {
            "snapshot_id": "snap-2",
            "session_id": "sess-2",
            "agent_id": "agent-2",
            "trigger": "auto",
            "description": "auto test",
            "files": [
                {"path": "/x.py", "hash": "h", "size": 5, "existed": True}
            ],
            "created_at": 12345.0,
        }
        snap = Snapshot.from_dict(d)
        assert snap.snapshot_id == "snap-2"
        assert len(snap.files) == 1


# ============================================================
# create 测试
# ============================================================


class TestCreate:
    """create 测试"""

    def test_create_basic(self, store, tmp_workspace):
        f1 = tmp_workspace / "a.py"
        f1.write_text("content A")
        f2 = tmp_workspace / "b.py"
        f2.write_text("content B")

        snap = store.create(
            session_id="sess-1",
            agent_id="agent-1",
            paths=[str(f1), str(f2)],
        )
        assert snap.session_id == "sess-1"
        assert snap.agent_id == "agent-1"
        assert snap.file_count == 2
        assert snap.total_size == 18  # 9 + 9

    def test_create_with_trigger_description(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1",
            agent_id="a1",
            paths=[str(f)],
            trigger="pre_edit",
            description="before refactor",
        )
        assert snap.trigger == "pre_edit"
        assert snap.description == "before refactor"

    def test_create_with_nonexistent_file(self, store, tmp_workspace):
        """快照中包含不存在的文件 → 记录 deletion 状态"""
        f = tmp_workspace / "missing.py"
        snap = store.create(
            session_id="s1",
            agent_id="a1",
            paths=[str(f)],
        )
        assert snap.file_count == 1
        assert snap.files[0].existed is False

    def test_create_skip_invalid_paths(self, store, tmp_workspace):
        """非法路径被跳过"""
        f = tmp_workspace / "valid.py"
        f.write_text("x")
        snap = store.create(
            session_id="s1",
            agent_id="a1",
            paths=["../../../etc/passwd", str(f)],
        )
        assert snap.file_count == 1

    def test_create_empty_paths_raises(self, store):
        with pytest.raises(InvalidSnapshotError):
            store.create(
                session_id="s1",
                agent_id="a1",
                paths=[],
            )

    def test_create_too_many_files_raises(self, store):
        paths = [f"/tmp/f{i}.py" for i in range(MAX_FILES_PER_SNAPSHOT + 1)]
        with pytest.raises(SnapshotTooLargeError):
            store.create(
                session_id="s1",
                agent_id="a1",
                paths=paths,
            )

    def test_create_too_large_total_raises(self, store, tmp_workspace):
        """总大小超限"""
        big_file = tmp_workspace / "big.bin"
        big_file.write_bytes(b"x" * (MAX_TOTAL_SIZE + 1))
        with pytest.raises(SnapshotTooLargeError):
            store.create(
                session_id="s1",
                agent_id="a1",
                paths=[str(big_file)],
            )

    def test_create_missing_session_raises(self, store):
        with pytest.raises(InvalidSnapshotError):
            store.create(session_id="", agent_id="a1", paths=["/tmp/x.py"])

    def test_create_missing_agent_raises(self, store):
        with pytest.raises(InvalidSnapshotError):
            store.create(session_id="s1", agent_id="", paths=["/tmp/x.py"])

    def test_create_persists_to_disk(self, store, tmp_workspace, tmp_snapshot_root):
        f = tmp_workspace / "persist.py"
        f.write_text("persist me")
        snap = store.create(
            session_id="s1",
            agent_id="a1",
            paths=[str(f)],
        )
        meta_file = tmp_snapshot_root / "s1" / snap.snapshot_id / "metadata.json"
        assert meta_file.exists()


# ============================================================
# get 测试
# ============================================================


class TestGet:
    """get 测试"""

    def test_get_existing(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        result = store.get(snap.snapshot_id)
        assert result.snapshot_id == snap.snapshot_id

    def test_get_nonexistent_raises(self, store):
        with pytest.raises(SnapshotNotFoundError):
            store.get("nonexistent-id")

    def test_has_snapshot(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        assert store.has_snapshot(snap.snapshot_id) is True
        assert store.has_snapshot("nope") is False


# ============================================================
# list 测试
# ============================================================


class TestList:
    """list 测试"""

    def test_list_empty(self, store):
        snaps, total = store.list("nonexistent-session")
        assert snaps == []
        assert total == 0

    def test_list_returns_snapshots(self, store, tmp_workspace):
        ids = []
        for i in range(3):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"content {i}")
            snap = store.create(
                session_id="s1", agent_id="a1", paths=[str(f)]
            )
            ids.append(snap.snapshot_id)
            time.sleep(0.01)  # 确保时间戳不同

        snaps, total = store.list("s1")
        assert total == 3
        assert len(snaps) == 3
        # 倒序：最新的在前
        assert snaps[0].snapshot_id == ids[-1]

    def test_list_pagination(self, store, tmp_workspace):
        for i in range(5):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"c{i}")
            store.create(
                session_id="s1", agent_id="a1", paths=[str(f)]
            )
            time.sleep(0.01)

        page1, total = store.list("s1", limit=2, offset=0)
        page2, total2 = store.list("s1", limit=2, offset=2)
        assert total == 5
        assert len(page1) == 2
        assert len(page2) == 2
        assert page1[0].snapshot_id != page2[0].snapshot_id


# ============================================================
# delete 测试
# ============================================================


class TestDelete:
    """delete 测试"""

    def test_delete_existing(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        assert store.delete(snap.snapshot_id) is True
        assert store.has_snapshot(snap.snapshot_id) is False

    def test_delete_nonexistent(self, store):
        assert store.delete("nonexistent") is False

    def test_delete_cleans_disk(self, store, tmp_workspace, tmp_snapshot_root):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        snap_dir = tmp_snapshot_root / "s1" / snap.snapshot_id
        assert snap_dir.exists()
        store.delete(snap.snapshot_id)
        assert not snap_dir.exists()

    def test_delete_removes_session_index(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        store.delete(snap.snapshot_id)
        assert "s1" not in store.get_session_ids()


# ============================================================
# read_file 测试
# ============================================================


class TestReadFile:
    """read_file 测试"""

    def test_read_existing_file(self, store, tmp_workspace):
        f = tmp_workspace / "data.py"
        f.write_text("hello")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        content = store.read_file(snap, str(f))
        assert content == b"hello"

    def test_read_nonexistent_in_snapshot_raises(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        snap = store.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )
        with pytest.raises(SnapshotNotFoundError):
            store.read_file(snap, "/nonexistent/path.py")


# ============================================================
# LRU 测试
# ============================================================


class TestLRU:
    """LRU 淘汰测试"""

    def test_lru_eviction(self, tmp_workspace, tmp_snapshot_root):
        fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
        # max=3
        store = SnapshotStore(
            storage_root=str(tmp_snapshot_root),
            file_storage=fs,
            max_snapshots_per_session=3,
        )
        for i in range(5):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"c{i}")
            store.create(
                session_id="s1", agent_id="a1", paths=[str(f)]
            )
            time.sleep(0.01)

        snaps, total = store.list("s1")
        assert total == 3  # 只保留 3 个

    def test_lru_keeps_newest(self, tmp_workspace, tmp_snapshot_root):
        fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
        store = SnapshotStore(
            storage_root=str(tmp_snapshot_root),
            file_storage=fs,
            max_snapshots_per_session=2,
        )
        snap_ids = []
        for i in range(4):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"c{i}")
            snap = store.create(
                session_id="s1", agent_id="a1", paths=[str(f)]
            )
            snap_ids.append(snap.snapshot_id)
            time.sleep(0.01)
        # 只保留最后两个
        assert store.has_snapshot(snap_ids[2]) is True
        assert store.has_snapshot(snap_ids[3]) is True
        assert store.has_snapshot(snap_ids[0]) is False
        assert store.has_snapshot(snap_ids[1]) is False


# ============================================================
# 持久化测试
# ============================================================


class TestPersistence:
    """持久化测试"""

    def test_load_from_disk(self, tmp_workspace, tmp_snapshot_root):
        # 第一次：创建快照
        fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
        store1 = SnapshotStore(
            storage_root=str(tmp_snapshot_root),
            file_storage=fs,
            max_snapshots_per_session=10,
        )
        f = tmp_workspace / "persist.py"
        f.write_text("important")
        snap = store1.create(
            session_id="s1", agent_id="a1", paths=[str(f)]
        )

        # 第二次：重新加载
        store2 = SnapshotStore(
            storage_root=str(tmp_snapshot_root),
            file_storage=fs,
            max_snapshots_per_session=10,
        )
        assert store2.has_snapshot(snap.snapshot_id) is True
        loaded = store2.get(snap.snapshot_id)
        assert loaded.agent_id == "a1"


# ============================================================
# 统计测试
# ============================================================


class TestStats:
    """统计测试"""

    def test_get_stats_empty(self, store):
        stats = store.get_stats()
        assert stats["total_snapshots"] == 0
        assert stats["total_sessions"] == 0

    def test_get_stats_with_data(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        store.create(session_id="s1", agent_id="a1", paths=[str(f)])
        stats = store.get_stats()
        assert stats["total_snapshots"] == 1
        assert stats["total_sessions"] == 1

    def test_get_session_ids(self, store, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        store.create(session_id="s1", agent_id="a1", paths=[str(f)])
        store.create(session_id="s2", agent_id="a1", paths=[str(f)])
        sessions = store.get_session_ids()
        assert "s1" in sessions
        assert "s2" in sessions


# ============================================================
# 全局单例
# ============================================================


class TestGlobalInstance:
    def test_singleton(self, tmp_snapshot_root):
        from app.services.snapshot_store import get_snapshot_store
        store1 = get_snapshot_store()
        store2 = get_snapshot_store()
        assert store1 is store2

    def test_reset(self, tmp_snapshot_root):
        from app.services.snapshot_store import get_snapshot_store
        reset_snapshot_store()
        store1 = get_snapshot_store()
        reset_snapshot_store()
        store2 = get_snapshot_store()
        assert store1 is not store2
