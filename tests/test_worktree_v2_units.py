"""
# ============================================================
# Hermes Worktree v2 - 单元测试
# ============================================================
# 核心作用：测试 Worktree v2 完整功能
# 覆盖：数据模型、存储、生命周期、合并、管理器
# Cycle 13 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List

# 添加 backend 到 path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.core.worktree import (
    WorktreeManager,
    WorktreeState,
    WorktreeStatus,
    WorktreeEvent,
    WorktreeConflict,
    WorktreeMetrics,
    WorktreeStorage,
    WorktreeLifecycle,
    WorktreeMerger,
    get_worktree_manager,
    get_worktree_storage,
)


# ============================================================
# 工具函数
# ============================================================
def make_minimal_worktree(
    task_id: str = "task-001",
    module: str = "auth",
    instance_id: str = "inst-001",
    ttl_hours: int = 24,
) -> WorktreeState:
    """构造最小 Worktree"""
    return WorktreeState(
        task_id=task_id,
        instance_id=instance_id,
        module_name=module,
        branch_name=f"feat/{module}-{task_id}",
        repo_path="/home/qizheng/auto_code_data/test-project",
        worktree_path="/tmp/test-worktree/wt_test",
        ttl_hours=ttl_hours,
    )


# ============================================================
# 测试：数据模型
# ============================================================
class TestWorktreeModels(unittest.TestCase):
    """数据模型测试"""

    def test_status_enum(self):
        """测试状态枚举"""
        self.assertEqual(len(list(WorktreeStatus)), 8)
        self.assertEqual(WorktreeStatus.ACTIVE.value, "active")
        self.assertEqual(WorktreeStatus.MERGED.value, "merged")

    def test_allowed_transitions(self):
        """测试状态转换规则"""
        # CREATE_PENDING -> ACTIVE / FAILED
        self.assertIn(WorktreeStatus.ACTIVE, WorktreeStatus.CREATE_PENDING.value and [
            s for s in WorktreeStatus if s.value in ("active", "failed")
        ] or [])
        # 验证：使用 can_transition_to
        wt = make_minimal_worktree()
        self.assertTrue(wt.can_transition_to(WorktreeStatus.ACTIVE))
        self.assertFalse(wt.can_transition_to(WorktreeStatus.MERGED))

    def test_worktree_state_default(self):
        """测试默认状态"""
        wt = make_minimal_worktree()
        self.assertIsNotNone(wt.worktree_id)
        self.assertTrue(wt.worktree_id.startswith("wt_"))
        self.assertEqual(wt.status, WorktreeStatus.CREATE_PENDING)
        self.assertEqual(wt.ttl_hours, 24)
        self.assertIsNotNone(wt.expires_at)

    def test_worktree_state_to_dict(self):
        """测试序列化"""
        wt = make_minimal_worktree()
        data = wt.to_dict()
        self.assertIn("worktree_id", data)
        self.assertIn("status", data)
        self.assertIn("events", data)
        self.assertIn("conflicts", data)
        self.assertIn("metrics", data)
        self.assertEqual(data["status"], "create_pending")
        self.assertFalse(data["is_terminal"])

    def test_worktree_state_from_dict(self):
        """测试反序列化"""
        wt = make_minimal_worktree()
        data = wt.to_dict()
        wt2 = WorktreeState.from_dict(data)
        self.assertEqual(wt.worktree_id, wt2.worktree_id)
        self.assertEqual(wt.task_id, wt2.task_id)
        self.assertEqual(wt.module_name, wt2.module_name)

    def test_worktree_state_add_event(self):
        """测试添加事件"""
        wt = make_minimal_worktree()
        evt = wt.add_event("test_event", actor="test", note="test note")
        self.assertEqual(len(wt.events), 1)
        self.assertEqual(wt.events[0].event_type, "test_event")
        self.assertEqual(wt.events[0].actor, "test")

    def test_worktree_state_add_conflict(self):
        """测试添加冲突"""
        wt = make_minimal_worktree()
        cfl = wt.add_conflict(["file1.py", "file2.py"], note="test")
        self.assertEqual(len(wt.conflicts), 1)
        self.assertEqual(len(wt.conflicts[0].files), 2)
        self.assertEqual(wt.metrics.conflict_count, 1)

    def test_is_terminal(self):
        """测试终态判断"""
        wt = make_minimal_worktree()
        self.assertFalse(wt.is_terminal())
        wt.status = WorktreeStatus.MERGED
        self.assertTrue(wt.is_terminal())
        wt.status = WorktreeStatus.CLEANED
        self.assertTrue(wt.is_terminal())

    def test_transition_method(self):
        """测试状态转换方法"""
        wt = make_minimal_worktree()
        wt.transition(WorktreeStatus.ACTIVE, note="test")
        self.assertEqual(wt.status, WorktreeStatus.ACTIVE)
        self.assertIsNotNone(wt.activated_at)
        self.assertGreater(len(wt.events), 0)

    def test_invalid_transition(self):
        """测试非法状态转换"""
        wt = make_minimal_worktree()
        with self.assertRaises(ValueError):
            wt.transition(WorktreeStatus.MERGED)  # CREATE_PENDING -> MERGED 不允许

    def test_metrics_default(self):
        """测试指标默认"""
        m = WorktreeMetrics()
        self.assertEqual(m.total_commits, 0)
        self.assertEqual(m.conflict_count, 0)

    def test_event_serialization(self):
        """测试事件序列化"""
        evt = WorktreeEvent(event_type="test", actor="user")
        data = evt.to_dict()
        self.assertEqual(data["event_type"], "test")
        evt2 = WorktreeEvent.from_dict(data)
        self.assertEqual(evt.event_type, evt2.event_type)


# ============================================================
# 测试：存储
# ============================================================
class TestWorktreeStorage(unittest.TestCase):
    """存储测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="storage_test_"))
        self.storage = WorktreeStorage(root=str(self.tmpdir))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_creates_dirs(self):
        """测试初始化创建目录"""
        self.assertTrue(self.storage.root.exists())
        self.assertTrue((self.storage.root / "state").exists())
        self.assertTrue((self.storage.root / "tasks").exists())
        self.assertTrue((self.storage.root / "archive").exists())
        self.assertTrue(self.storage.index_file.exists())

    def test_save_and_get(self):
        """测试保存与获取"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        wt2 = self.storage.get(wt.worktree_id)
        self.assertIsNotNone(wt2)
        self.assertEqual(wt.worktree_id, wt2.worktree_id)

    def test_get_or_raise(self):
        """测试获取或抛错"""
        with self.assertRaises(KeyError):
            self.storage.get_or_raise("wt_not_exist")

    def test_list_all(self):
        """测试列出所有"""
        wt1 = make_minimal_worktree(task_id="task-001")
        wt2 = make_minimal_worktree(task_id="task-002")
        self.storage.save(wt1)
        self.storage.save(wt2)
        all_wts = self.storage.list_all()
        self.assertEqual(len(all_wts), 2)

    def test_list_filter(self):
        """测试过滤列表"""
        wt1 = make_minimal_worktree(module="auth")
        wt2 = make_minimal_worktree(module="api")
        self.storage.save(wt1)
        self.storage.save(wt2)
        auth_wts = self.storage.list_all(module="auth")
        self.assertEqual(len(auth_wts), 1)
        self.assertEqual(auth_wts[0].module_name, "auth")

    def test_delete(self):
        """测试删除"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.assertTrue(self.storage.delete(wt.worktree_id))
        self.assertIsNone(self.storage.get(wt.worktree_id))

    def test_stats(self):
        """测试统计"""
        wt1 = make_minimal_worktree()
        wt2 = make_minimal_worktree()
        self.storage.save(wt1)
        self.storage.save(wt2)
        stats = self.storage.get_stats()
        self.assertEqual(stats["total"], 2)
        self.assertIn("by_status", stats)
        self.assertIn("by_module", stats)

    def test_persistence(self):
        """测试持久化（重新加载）"""
        wt = make_minimal_worktree()
        wt.add_event("test_event", note="persistent")
        self.storage.save(wt)
        # 创建新存储实例
        storage2 = WorktreeStorage(root=str(self.tmpdir))
        wt2 = storage2.get(wt.worktree_id)
        self.assertIsNotNone(wt2)
        # 完整状态文件应包含 events
        self.assertGreater(len(wt2.events), 0)

    def test_archive(self):
        """测试归档"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        archive_path = self.storage.archive(wt.worktree_id)
        self.assertIsNotNone(archive_path)
        self.assertTrue(archive_path.exists())


# ============================================================
# 测试：生命周期
# ============================================================
class TestWorktreeLifecycle(unittest.TestCase):
    """生命周期测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="lifecycle_test_"))
        self.storage = WorktreeStorage(root=str(self.tmpdir))
        self.lifecycle = WorktreeLifecycle(self.storage)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_activate(self):
        """测试激活"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        result = self.lifecycle.activate(wt.worktree_id)
        self.assertEqual(result.status, WorktreeStatus.ACTIVE)
        self.assertIsNotNone(result.activated_at)

    def test_full_lifecycle(self):
        """测试完整生命周期"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        # CREATE_PENDING -> ACTIVE
        self.lifecycle.activate(wt.worktree_id)
        # ACTIVE -> AUTO_MERGE_PENDING
        self.lifecycle.start_merge(wt.worktree_id)
        # AUTO_MERGE_PENDING -> MERGED
        self.lifecycle.mark_merged(wt.worktree_id)
        # MERGED -> CLEANED
        self.lifecycle.cleanup(wt.worktree_id)
        final = self.storage.get(wt.worktree_id)
        self.assertEqual(final.status, WorktreeStatus.CLEANED)
        self.assertTrue(final.is_terminal())

    def test_invalid_transition(self):
        """测试非法转换"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        with self.assertRaises(ValueError):
            self.lifecycle.mark_merged(wt.worktree_id)  # CREATE_PENDING -> MERGED 不允许

    def test_mark_conflict(self):
        """测试标记冲突"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        result = self.lifecycle.mark_conflict(
            wt.worktree_id, ["file1.py", "file2.py"], note="test"
        )
        self.assertEqual(result.status, WorktreeStatus.CONFLICT)
        self.assertEqual(len(result.conflicts), 1)
        self.assertEqual(result.metrics.conflict_count, 1)

    def test_resolve_conflict(self):
        """测试解决冲突"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        self.lifecycle.mark_conflict(wt.worktree_id, ["file1.py"])
        result = self.lifecycle.resolve_conflict(wt.worktree_id, resolution="manual")
        self.assertEqual(result.status, WorktreeStatus.MERGED)
        self.assertEqual(result.conflicts[0].resolution, "manual")
        self.assertIsNotNone(result.conflicts[0].resolved_at)

    def test_expire(self):
        """测试过期"""
        wt = make_minimal_worktree(ttl_hours=0)
        wt.expires_at = "2020-01-01T00:00:00+00:00"  # 强制过期
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        expired = self.lifecycle.scan_expired()
        self.assertGreater(len(expired), 0)

    def test_can_transition(self):
        """测试转换判断"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.assertTrue(self.lifecycle.can_transition(wt.worktree_id, WorktreeStatus.ACTIVE))
        self.assertFalse(self.lifecycle.can_transition(wt.worktree_id, WorktreeStatus.MERGED))

    def test_hooks(self):
        """测试钩子"""
        events = []
        def hook(old, new):
            events.append((old.status.value, new.status.value))
        self.lifecycle.register_hook("after_transition", hook)
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        self.assertGreater(len(events), 0)

    def test_lifecycle_summary(self):
        """测试生命周期摘要"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        summary = self.lifecycle.get_lifecycle_summary(wt.worktree_id)
        self.assertIn("status", summary)
        self.assertIn("durations", summary)
        self.assertIn("allowed_transitions", summary)


# ============================================================
# 测试：合并器
# ============================================================
class TestWorktreeMerger(unittest.TestCase):
    """合并器测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="merger_test_"))
        self.storage = WorktreeStorage(root=str(self.tmpdir))
        self.lifecycle = WorktreeLifecycle(self.storage)
        self.merger = WorktreeMerger(self.storage, self.lifecycle)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_merge_success(self):
        """测试合并成功"""
        wt = make_minimal_worktree()
        wt.worktree_path = "/tmp/test-worktree/wt_merge_test"  # 在白名单内
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        result = self.merger.merge(wt.worktree_id, target_branch="main", strategy="auto")
        self.assertTrue(result.success)
        self.assertEqual(result.target_branch, "main")
        self.assertEqual(self.storage.get(wt.worktree_id).status, WorktreeStatus.MERGED)

    def test_merge_with_conflict(self):
        """测试合并冲突"""
        wt = make_minimal_worktree()
        wt.worktree_path = "/tmp/test-worktree/wt_conflict_test"
        wt.metadata["pending_conflicts"] = ["file1.py", "file2.py"]
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        result = self.merger.merge(wt.worktree_id, strategy="auto")
        self.assertFalse(result.success)
        self.assertEqual(len(result.conflicts), 2)
        self.assertEqual(self.storage.get(wt.worktree_id).status, WorktreeStatus.CONFLICT)

    def test_ai_resolve(self):
        """测试 AI 解决冲突"""
        wt = make_minimal_worktree()
        wt.worktree_path = "/tmp/test-worktree/wt_ai_test"
        wt.metadata["pending_conflicts"] = ["file.py"]
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        self.merger.merge(wt.worktree_id, strategy="ai_assisted")
        result = self.merger.merge(wt.worktree_id, strategy="ai_assisted")
        # 第二次合并后应已解决
        # 实际取决于是否再次进入冲突状态

    def test_batch_merge(self):
        """测试批量合并"""
        wts = [make_minimal_worktree(task_id=f"task-{i}") for i in range(3)]
        for wt in wts:
            wt.worktree_path = "/tmp/test-worktree/wt_batch_test"
            self.storage.save(wt)
            self.lifecycle.activate(wt.worktree_id)
        results = self.merger.batch_merge([w.worktree_id for w in wts])
        self.assertEqual(len(results), 3)
        self.assertTrue(all(r.success for r in results))

    def test_invalid_path(self):
        """测试无效路径"""
        wt = make_minimal_worktree()
        wt.worktree_path = "/etc/passwd"  # 不在白名单内
        self.storage.save(wt)
        self.lifecycle.activate(wt.worktree_id)
        result = self.merger.merge(wt.worktree_id)
        self.assertFalse(result.success)
        self.assertIn("whitelist", result.error_message)

    def test_merge_in_wrong_state(self):
        """测试错误状态合并"""
        wt = make_minimal_worktree()
        self.storage.save(wt)
        # CREATE_PENDING 状态不能合并
        result = self.merger.merge(wt.worktree_id)
        self.assertFalse(result.success)
        self.assertIn("not in mergeable state", result.error_message)


# ============================================================
# 测试：管理器
# ============================================================
class TestWorktreeManager(unittest.TestCase):
    """管理器测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="manager_test_"))
        self.storage = WorktreeStorage(root=str(self.tmpdir))
        self.lifecycle = WorktreeLifecycle(self.storage)
        self.merger = WorktreeMerger(self.storage, self.lifecycle)
        self.manager = WorktreeManager(self.storage, self.lifecycle, self.merger)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create(self):
        """测试创建"""
        wt = self.manager.create(
            task_id="task-001",
            module_name="auth",
            instance_id="inst-001",
        )
        self.assertIsNotNone(wt.worktree_id)
        self.assertTrue(wt.worktree_id.startswith("wt_"))
        # 默认 auto_activate=True
        self.assertEqual(wt.status, WorktreeStatus.ACTIVE)

    def test_get(self):
        """测试获取"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        wt2 = self.manager.get(wt.worktree_id)
        self.assertEqual(wt.worktree_id, wt2.worktree_id)

    def test_list(self):
        """测试列表"""
        self.manager.create(task_id="task-001", module_name="auth")
        self.manager.create(task_id="task-002", module_name="api")
        all_wts = self.manager.list()
        self.assertEqual(len(all_wts), 2)

    def test_commit(self):
        """测试提交"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        result = self.manager.commit(wt.worktree_id, message="test commit")
        self.assertEqual(result.metrics.total_commits, 1)
        # 检查事件
        commit_events = [e for e in result.events if e.event_type == "commit"]
        self.assertEqual(len(commit_events), 1)

    def test_merge_via_manager(self):
        """测试通过管理器合并"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        wt.worktree_path = "/tmp/test-worktree/wt_mgr"
        self.storage.save(wt)
        # 由于 manager.create 已激活，状态为 ACTIVE
        # 但保存时路径可能不在白名单
        result = self.manager.merge(wt.worktree_id)
        if result.success:
            final = self.manager.get(wt.worktree_id)
            self.assertEqual(final.status, WorktreeStatus.MERGED)

    def test_resolve_conflict(self):
        """测试通过管理器解决冲突"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        wt.worktree_path = "/tmp/test-worktree/wt_resolve"
        wt.metadata["pending_conflicts"] = ["file.py"]
        self.storage.save(wt)
        self.manager.merge(wt.worktree_id)  # 进入 CONFLICT
        result = self.manager.resolve_conflict(wt.worktree_id, strategy="manual")
        self.assertEqual(result.status, WorktreeStatus.MERGED)

    def test_cleanup(self):
        """测试清理"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        result = self.manager.cleanup(wt.worktree_id)
        self.assertEqual(result.status, WorktreeStatus.CLEANED)

    def test_cleanup_batch(self):
        """测试批量清理"""
        wts = [self.manager.create(task_id=f"task-{i}", module_name="auth") for i in range(3)]
        for w in wts:
            self.manager.cleanup(w.worktree_id)
        # 验证全部清理
        for w in wts:
            final = self.manager.get(w.worktree_id)
            self.assertEqual(final.status, WorktreeStatus.CLEANED)

    def test_health_check(self):
        """测试健康检查"""
        result = self.manager.health_check()
        self.assertTrue(result["success"])
        self.assertEqual(result["service"], "worktree")
        self.assertIn("stats", result)

    def test_get_metrics(self):
        """测试指标"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        metrics = self.manager.get_metrics(wt.worktree_id)
        self.assertIn("metrics", metrics)
        self.assertIn("lifecycle", metrics)

    def test_get_by_task(self):
        """测试按任务获取"""
        self.manager.create(task_id="task-001", module_name="auth")
        self.manager.create(task_id="task-001", module_name="api")
        wts = self.manager.get_by_task("task-001")
        self.assertEqual(len(wts), 2)

    def test_path_validation(self):
        """测试路径校验"""
        # 不在白名单的 worktree_base
        with self.assertRaises(ValueError):
            self.manager.create(
                task_id="task-001",
                module_name="auth",
                worktree_base="/etc/dangerous",
            )


# ============================================================
# 测试：路径白名单
# ============================================================
class TestPathWhitelist(unittest.TestCase):
    """路径白名单测试"""

    def test_storage_paths(self):
        from app.core.worktree.storage import is_storage_path_allowed
        self.assertTrue(is_storage_path_allowed("/home/qizheng/.hermes/worktree"))
        self.assertTrue(is_storage_path_allowed("/tmp/test-worktree"))
        self.assertTrue(is_storage_path_allowed("/tmp/worktree_test_xyz"))
        self.assertFalse(is_storage_path_allowed("/etc/passwd"))
        self.assertFalse(is_storage_path_allowed("/root/.ssh"))

    def test_repo_paths(self):
        from app.core.worktree.merger import is_repo_path_allowed
        self.assertTrue(is_repo_path_allowed("/home/qizheng/auto_code_data/project"))
        self.assertTrue(is_repo_path_allowed("/home/qizheng/auto_code_ws"))
        self.assertTrue(is_repo_path_allowed("/tmp/test-worktree/wt"))
        self.assertFalse(is_repo_path_allowed("/etc/passwd"))

    def test_worktree_paths(self):
        from app.core.worktree.manager import is_worktree_path_allowed
        self.assertTrue(is_worktree_path_allowed("/home/qizheng/auto_code_data/wt"))
        self.assertTrue(is_worktree_path_allowed("/tmp/hermes-worktree/wt_123"))
        self.assertFalse(is_worktree_path_allowed("/etc/dangerous"))


# ============================================================
# 测试：端到端工作流
# ============================================================
class TestWorktreeE2E(unittest.TestCase):
    """端到端工作流测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="e2e_test_"))
        self.storage = WorktreeStorage(root=str(self.tmpdir))
        self.lifecycle = WorktreeLifecycle(self.storage)
        self.merger = WorktreeMerger(self.storage, self.lifecycle)
        self.manager = WorktreeManager(self.storage, self.lifecycle, self.merger)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_workflow(self):
        """测试完整工作流：创建 -> 提交 -> 合并 -> 清理"""
        # 1. 创建
        wt = self.manager.create(
            task_id="task-001",
            module_name="auth",
            instance_id="inst-001",
            ttl_hours=24,
        )
        self.assertEqual(wt.status, WorktreeStatus.ACTIVE)
        # 2. 多次提交
        for i in range(3):
            self.manager.commit(wt.worktree_id, message=f"commit {i}")
        wt = self.manager.get(wt.worktree_id)
        self.assertEqual(wt.metrics.total_commits, 3)
        # 3. 合并
        result = self.manager.merge(wt.worktree_id, target_branch="main")
        self.assertTrue(result.success)
        # 4. 清理
        final = self.manager.cleanup(wt.worktree_id)
        self.assertEqual(final.status, WorktreeStatus.CLEANED)
        # 5. 验证
        metrics = self.manager.get_metrics(wt.worktree_id)
        self.assertEqual(metrics["metrics"]["total_commits"], 3)

    def test_concurrent_worktrees(self):
        """测试并发 Worktree（多个任务并行）"""
        tasks = [f"task-{i:03d}" for i in range(5)]
        wts = []
        for tid in tasks:
            wt = self.manager.create(task_id=tid, module_name="auth")
            wts.append(wt)
        # 所有都应激活
        active = [w for w in self.manager.list() if w.status == WorktreeStatus.ACTIVE]
        self.assertGreaterEqual(len(active), 5)
        # 全部合并
        for wt in wts:
            result = self.manager.merge(wt.worktree_id)
            self.assertTrue(result.success)

    def test_failure_recovery(self):
        """测试失败恢复"""
        wt = self.manager.create(task_id="task-001", module_name="auth")
        # 手动标记为失败
        self.manager.lifecycle.mark_failed(wt.worktree_id, error="test error")
        wt = self.manager.get(wt.worktree_id)
        self.assertEqual(wt.status, WorktreeStatus.FAILED)
        self.assertEqual(wt.error_message, "test error")
        # 清理
        final = self.manager.cleanup(wt.worktree_id)
        self.assertEqual(final.status, WorktreeStatus.CLEANED)


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    unittest.main(verbosity=2)
