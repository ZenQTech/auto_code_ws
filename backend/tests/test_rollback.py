"""
# ============================================================
# Rollback 服务单元测试 (v1.0.0)
# Cycle 61 G61-07
# ============================================================
# 测试覆盖：
#   - Snapshot 数据模型
#   - RollbackResult 数据模型
#   - _is_git_repo / _has_changes
#   - create_snapshot 成功 + 失败
#   - list_snapshots / get_snapshot / get_snapshot_by_commit
#   - rollback 成功 / 失败（commit 不存在 / 冲突）
#   - rollback_multiple 批量
#   - get_git_log
#   - get_rollback_history
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-07 初次创建
# ====================================
"""

import sys
import os
import asyncio
import subprocess
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.rollback import (
    RollbackManager,
    RollbackResult,
    Snapshot,
    SnapshotSource,
    get_manager,
    reset_manager,
)


# ============================================================
# 辅助：创建临时 git 仓库
# ============================================================


@pytest.fixture
def git_repo(tmp_path):
    """创建临时 git 仓库"""
    repo = str(tmp_path / "test_repo")
    os.makedirs(repo)
    # 初始化
    subprocess.run(
        ["git", "init", "-b", "main"],
        cwd=repo, check=True, capture_output=True,
    )
    # 配置
    subprocess.run(
        ["git", "config", "user.email", "test@hermes.local"],
        cwd=repo, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=repo, check=True, capture_output=True,
    )
    # 初始 commit
    (tmp_path / "test_repo" / "README.md").write_text("# Test Repo")
    subprocess.run(
        ["git", "add", "-A"],
        cwd=repo, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=repo, check=True, capture_output=True,
    )
    yield repo
    # 清理不需要，tmp_path 会自动清理


# ============================================================
# 数据模型测试
# ============================================================


class TestSnapshot:
    """Snapshot 数据模型测试"""

    def test_default_values(self):
        snap = Snapshot()
        assert snap.snapshot_id.startswith("snap-")
        assert snap.commit_hash == ""
        assert snap.source == SnapshotSource.MANUAL
        assert snap.plan_id is None
        assert snap.step_id is None
        assert snap.author == "hermes"
        assert snap.files_changed == 0
        assert snap.metadata == {}

    def test_to_dict(self):
        snap = Snapshot(
            commit_hash="abc1234567890",
            message="test",
            source=SnapshotSource.PLAN,
            plan_id="p1",
        )
        d = snap.to_dict()
        assert d["commit_hash"] == "abc1234567890"
        assert d["short_hash"] == "abc12345"
        assert d["message"] == "test"
        assert d["source"] == "plan"
        assert d["plan_id"] == "p1"


class TestRollbackResult:
    """RollbackResult 数据模型测试"""

    def test_default_values(self):
        r = RollbackResult(success=True)
        assert r.success is True
        assert r.original_commit == ""
        assert r.revert_commit == ""
        assert r.message == ""
        assert r.error is None
        assert r.files_changed == 0

    def test_to_dict(self):
        r = RollbackResult(
            success=True,
            original_commit="abc",
            revert_commit="def",
            message="rolled back",
            files_changed=3,
        )
        d = r.to_dict()
        assert d["success"] is True
        assert d["original_commit"] == "abc"
        assert d["revert_commit"] == "def"
        assert d["files_changed"] == 3


class TestSnapshotSource:
    """SnapshotSource 枚举测试"""

    def test_values(self):
        assert SnapshotSource.PLAN.value == "plan"
        assert SnapshotSource.STEP.value == "step"
        assert SnapshotSource.MANUAL.value == "manual"
        assert SnapshotSource.INITIAL.value == "initial"


# ============================================================
# 真实 git 仓库测试
# ============================================================


class TestRollbackManagerReal:
    """使用真实 git 仓库的测试"""

    def test_create_snapshot_with_changes(self, git_repo):
        """有变更时创建快照"""
        # 写入新文件
        with open(os.path.join(git_repo, "new.txt"), "w") as f:
            f.write("new content")
        # 创建快照
        mgr = RollbackManager()
        snap = asyncio.get_event_loop().run_until_complete(
            mgr.create_snapshot(
                repo_path=git_repo,
                message="add new file",
                source=SnapshotSource.STEP,
                plan_id="p1",
                step_id="s1",
            )
        )
        assert snap is not None
        assert snap.commit_hash != ""
        assert snap.message == "add new file"
        assert snap.plan_id == "p1"
        assert snap.step_id == "s1"
        assert snap.files_changed >= 1
        assert snap.snapshot_id in mgr._snapshots
        assert snap.commit_hash in mgr._by_commit

    def test_create_snapshot_no_changes(self, git_repo):
        """无变更时返回 None"""
        mgr = RollbackManager()
        snap = asyncio.get_event_loop().run_until_complete(
            mgr.create_snapshot(
                repo_path=git_repo,
                message="noop",
            )
        )
        assert snap is None

    def test_create_snapshot_invalid_path(self, tmp_path):
        """无效路径返回 None"""
        mgr = RollbackManager()
        snap = asyncio.get_event_loop().run_until_complete(
            mgr.create_snapshot(
                repo_path=str(tmp_path / "nonexistent"),
                message="x",
            )
        )
        assert snap is None

    def test_create_snapshot_not_git_repo(self, tmp_path):
        """非 git 仓库返回 None"""
        mgr = RollbackManager()
        snap = asyncio.get_event_loop().run_until_complete(
            mgr.create_snapshot(
                repo_path=str(tmp_path),
                message="x",
            )
        )
        assert snap is None

    def test_list_snapshots(self, git_repo):
        """列出快照"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        # 创建 3 个快照
        for i in range(3):
            with open(os.path.join(git_repo, f"file_{i}.txt"), "w") as f:
                f.write(f"content {i}")
            loop.run_until_complete(
                mgr.create_snapshot(
                    repo_path=git_repo,
                    message=f"snap {i}",
                )
            )
        snaps = mgr.list_snapshots()
        assert len(snaps) == 3
        # 倒序
        assert snaps[0].message == "snap 2"
        assert snaps[2].message == "snap 0"

    def test_list_snapshots_by_plan(self, git_repo):
        """按 plan_id 过滤"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        for i in range(3):
            with open(os.path.join(git_repo, f"file_{i}.txt"), "w") as f:
                f.write(f"c {i}")
            loop.run_until_complete(
                mgr.create_snapshot(
                    repo_path=git_repo,
                    message=f"snap {i}",
                    plan_id="p1" if i % 2 == 0 else "p2",
                )
            )
        snaps_p1 = mgr.list_snapshots(plan_id="p1")
        snaps_p2 = mgr.list_snapshots(plan_id="p2")
        assert len(snaps_p1) == 2
        assert len(snaps_p2) == 1

    def test_get_snapshot(self, git_repo):
        """按 ID 获取快照"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        with open(os.path.join(git_repo, "x.txt"), "w") as f:
            f.write("x")
        snap = loop.run_until_complete(
            mgr.create_snapshot(repo_path=git_repo, message="x")
        )
        assert snap is not None
        retrieved = mgr.get_snapshot(snap.snapshot_id)
        assert retrieved is not None
        assert retrieved.snapshot_id == snap.snapshot_id

    def test_get_snapshot_by_commit(self, git_repo):
        """按 commit hash 获取快照"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        with open(os.path.join(git_repo, "y.txt"), "w") as f:
            f.write("y")
        snap = loop.run_until_complete(
            mgr.create_snapshot(repo_path=git_repo, message="y")
        )
        assert snap is not None
        retrieved = mgr.get_snapshot_by_commit(snap.commit_hash)
        assert retrieved is not None
        assert retrieved.snapshot_id == snap.snapshot_id


class TestRollbackOperation:
    """回退操作测试"""

    def test_rollback_success(self, git_repo):
        """回退成功"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        # 创建快照
        with open(os.path.join(git_repo, "to_revert.txt"), "w") as f:
            f.write("will be reverted")
        snap = loop.run_until_complete(
            mgr.create_snapshot(repo_path=git_repo, message="to revert")
        )
        assert snap is not None
        # 回退
        result = loop.run_until_complete(
            mgr.rollback(git_repo, snap.commit_hash, message="revert it")
        )
        assert result.success is True
        assert result.original_commit == snap.commit_hash
        assert result.revert_commit != ""
        # 文件应该被删除（revert）
        assert not os.path.exists(os.path.join(git_repo, "to_revert.txt"))

    def test_rollback_invalid_path(self, tmp_path):
        """回退失败 - 路径不存在"""
        mgr = RollbackManager()
        result = asyncio.get_event_loop().run_until_complete(
            mgr.rollback(str(tmp_path / "nope"), "abc123")
        )
        assert result.success is False
        assert "路径不存在" in (result.error or "")

    def test_rollback_invalid_commit(self, git_repo):
        """回退失败 - commit 不存在"""
        mgr = RollbackManager()
        result = asyncio.get_event_loop().run_until_complete(
            mgr.rollback(git_repo, "deadbeef0000")
        )
        assert result.success is False
        assert "commit 不存在" in (result.error or "")

    def test_rollback_history(self, git_repo):
        """回退历史"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        # 创建一个快照并回退
        with open(os.path.join(git_repo, "h.txt"), "w") as f:
            f.write("h")
        snap = loop.run_until_complete(
            mgr.create_snapshot(repo_path=git_repo, message="h")
        )
        assert snap is not None
        loop.run_until_complete(mgr.rollback(git_repo, snap.commit_hash))
        history = mgr.get_rollback_history()
        assert len(history) >= 1
        assert history[0].original_commit == snap.commit_hash


class TestRollbackMultiple:
    """批量回退测试"""

    def test_rollback_multiple(self, git_repo):
        """批量回退多个 commit"""
        mgr = RollbackManager()
        loop = asyncio.get_event_loop()
        commits = []
        for i in range(3):
            with open(os.path.join(git_repo, f"m_{i}.txt"), "w") as f:
                f.write(f"m {i}")
            snap = loop.run_until_complete(
                mgr.create_snapshot(repo_path=git_repo, message=f"m {i}")
            )
            assert snap is not None
            commits.append(snap.commit_hash)
        # 批量回退
        results = loop.run_until_complete(
            mgr.rollback_multiple(git_repo, commits)
        )
        assert len(results) == 3
        # 全部成功
        assert all(r.success for r in results)


class TestGitLog:
    """git log 测试"""

    def test_get_git_log(self, git_repo):
        """获取 git log"""
        mgr = RollbackManager()
        entries = mgr.get_git_log(git_repo, limit=10)
        assert len(entries) >= 1
        assert "commit_hash" in entries[0]
        assert "message" in entries[0]

    def test_get_git_log_invalid_path(self, tmp_path):
        """无效路径"""
        mgr = RollbackManager()
        entries = mgr.get_git_log(str(tmp_path / "nope"))
        assert entries == []


# ============================================================
# 全局单例测试
# ============================================================


class TestGlobalManager:
    """全局单例测试"""

    def test_singleton(self):
        reset_manager()
        m1 = get_manager()
        m2 = get_manager()
        assert m1 is m2
        reset_manager()

    def test_reset(self):
        m1 = get_manager()
        reset_manager()
        m2 = get_manager()
        assert m1 is not m2
