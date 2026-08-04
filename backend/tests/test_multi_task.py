"""
# ============================================================
# 多任务并行管理器单元测试 (v1.0.0)
# Cycle 62 G62-01
# ====================================
# 测试覆盖：
#   - ResourceUsage / TaskSlot 数据模型
#   - ResourceQuota 检查
#   - MultiTaskManager CRUD
#   - 状态机（pending/running/paused/completed/failed/cancelled）
#   - 资源配额耗尽
#   - 进度更新
#   - 删除任务
#   - 持久化（save/load）
#   - 全局单例
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-01 初次创建
# ====================================
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.multi_task import (
    MultiTaskManager,
    ResourceQuota,
    ResourceUsage,
    TaskSlot,
    TaskStatus,
    get_multi_task_manager,
    reset_multi_task_manager,
)


# ============================================================
# 数据模型测试
# ============================================================


class TestResourceUsage:
    """ResourceUsage 数据模型"""

    def test_default_values(self):
        u = ResourceUsage()
        assert u.cpu_percent == 0.0
        assert u.memory_mb == 0.0
        assert u.tokens_used == 0
        assert u.elapsed_seconds == 0.0

    def test_to_dict(self):
        u = ResourceUsage(cpu_percent=10.5, memory_mb=128.0)
        d = u.to_dict()
        assert d["cpu_percent"] == 10.5
        assert d["memory_mb"] == 128.0


class TestTaskSlot:
    """TaskSlot 数据模型"""

    def test_default_values(self):
        s = TaskSlot(task_id="t1", title="T", prompt="p")
        assert s.status == TaskStatus.PENDING
        assert s.context_ids == []
        assert s.error is None
        assert s.result is None
        assert s.started_at is None
        assert s.completed_at is None

    def test_to_dict(self):
        s = TaskSlot(task_id="t1", title="T", prompt="p", status=TaskStatus.RUNNING)
        d = s.to_dict()
        assert d["task_id"] == "t1"
        assert d["status"] == "running"
        assert d["elapsed_s"] == 0.0

    def test_to_dict_with_started(self):
        s = TaskSlot(
            task_id="t1", title="T", prompt="p",
            started_at=100.0, completed_at=105.0,
            status=TaskStatus.COMPLETED,
        )
        d = s.to_dict()
        assert d["elapsed_s"] == 5.0

    def test_update(self):
        s = TaskSlot(task_id="t1", title="T", prompt="p")
        old = s.updated_at
        import time as t
        t.sleep(0.01)
        s.update()
        assert s.updated_at > old


# ============================================================
# ResourceQuota 测试
# ============================================================


class TestResourceQuota:
    """ResourceQuota 测试"""

    def test_default_values(self):
        q = ResourceQuota()
        assert q.MAX_PARALLEL_TASKS == 8
        assert q.MAX_TOTAL_MEMORY_MB == 4096
        assert q.PER_TASK_MEMORY_MB == 512
        assert q.PER_TASK_TIMEOUT_S == 1800

    @pytest.mark.asyncio
    async def test_can_create_empty(self):
        mgr = MultiTaskManager()
        q = ResourceQuota()
        assert q.can_create(mgr) is True

    @pytest.mark.asyncio
    async def test_cannot_create_when_full(self):
        mgr = MultiTaskManager()
        q = ResourceQuota(MAX_PARALLEL_TASKS=2)
        mgr._quota = q
        await mgr.create("t1", "p1")
        await mgr.create("t2", "p2")
        with pytest.raises(PermissionError):
            await mgr.create("t3", "p3")

    @pytest.mark.asyncio
    async def test_get_active_limit_info(self):
        mgr = MultiTaskManager()
        q = ResourceQuota()
        mgr._quota = q
        await mgr.create("t1", "p1")
        info = q.get_active_limit_info(mgr)
        assert info["active_tasks"] == 1
        assert info["max_tasks"] == 8
        assert info["per_task_timeout_s"] == 1800


# ============================================================
# MultiTaskManager CRUD 测试
# ============================================================


class TestMultiTaskCRUD:
    """MultiTaskManager CRUD"""

    @pytest.mark.asyncio
    async def test_create(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("Test", "prompt")
        assert slot.task_id.startswith("task-")
        assert slot.title == "Test"
        assert slot.status == TaskStatus.PENDING

    @pytest.mark.asyncio
    async def test_create_default_title(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("", "long prompt here " * 10)
        # 默认 title 取 prompt 前 30 字符
        assert slot.title != ""

    @pytest.mark.asyncio
    async def test_get(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        assert mgr.get(slot.task_id) is slot
        assert mgr.get("nonexistent") is None

    @pytest.mark.asyncio
    async def test_list(self):
        mgr = MultiTaskManager()
        await mgr.create("t1", "p1")
        await mgr.create("t2", "p2")
        await mgr.create("t3", "p3")
        tasks = mgr.list()
        assert len(tasks) == 3

    @pytest.mark.asyncio
    async def test_list_by_status(self):
        mgr = MultiTaskManager()
        s1 = await mgr.create("t1", "p1")
        s2 = await mgr.create("t2", "p2")
        await mgr.start(s2.task_id)
        running = mgr.list(status=TaskStatus.RUNNING)
        assert len(running) == 1
        assert running[0].task_id == s2.task_id

    @pytest.mark.asyncio
    async def test_list_limit(self):
        mgr = MultiTaskManager()
        for i in range(5):
            await mgr.create(f"t{i}", f"p{i}")
        assert len(mgr.list(limit=3)) == 3

    @pytest.mark.asyncio
    async def test_count_active(self):
        mgr = MultiTaskManager()
        s1 = await mgr.create("t1", "p1")
        s2 = await mgr.create("t2", "p2")
        await mgr.start(s1.task_id)
        # s1 running, s2 pending
        assert mgr.count_active() == 2

    @pytest.mark.asyncio
    async def test_count_by_status(self):
        mgr = MultiTaskManager()
        s1 = await mgr.create("t1", "p1")
        await mgr.start(s1.task_id)
        await mgr.complete(s1.task_id)
        stats = mgr.count_by_status()
        assert stats["completed"] == 1
        assert stats["pending"] == 0


# ============================================================
# 状态机测试
# ============================================================


class TestTaskStateMachine:
    """任务状态机"""

    @pytest.mark.asyncio
    async def test_pending_to_running(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        assert slot.status == TaskStatus.PENDING
        started = await mgr.start(slot.task_id)
        assert started.status == TaskStatus.RUNNING
        assert started.started_at is not None

    @pytest.mark.asyncio
    async def test_running_to_paused_to_running(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        paused = await mgr.pause(slot.task_id)
        assert paused.status == TaskStatus.PAUSED
        resumed = await mgr.resume(slot.task_id)
        assert resumed.status == TaskStatus.RUNNING

    @pytest.mark.asyncio
    async def test_running_to_completed(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        done = await mgr.complete(slot.task_id, result={"output": "ok"})
        assert done.status == TaskStatus.COMPLETED
        assert done.result == {"output": "ok"}
        assert done.completed_at is not None

    @pytest.mark.asyncio
    async def test_running_to_failed(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        failed = await mgr.fail(slot.task_id, error="LLM timeout")
        assert failed.status == TaskStatus.FAILED
        assert failed.error == "LLM timeout"

    @pytest.mark.asyncio
    async def test_running_to_cancelled(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        cancelled = await mgr.cancel(slot.task_id)
        assert cancelled.status == TaskStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_start_nonexistent_raises(self):
        mgr = MultiTaskManager()
        with pytest.raises(ValueError):
            await mgr.start("nonexistent")

    @pytest.mark.asyncio
    async def test_start_completed_raises(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        await mgr.complete(slot.task_id)
        with pytest.raises(ValueError):
            await mgr.start(slot.task_id)

    @pytest.mark.asyncio
    async def test_pause_not_running_raises(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        with pytest.raises(ValueError):
            await mgr.pause(slot.task_id)


# ============================================================
# 资源配额耗尽测试
# ============================================================


class TestQuotaExhaustion:
    """资源配额耗尽"""

    @pytest.mark.asyncio
    async def test_max_tasks_limit(self):
        mgr = MultiTaskManager()
        mgr._quota.MAX_PARALLEL_TASKS = 3
        await mgr.create("t1", "p1")
        await mgr.create("t2", "p2")
        await mgr.create("t3", "p3")
        with pytest.raises(PermissionError):
            await mgr.create("t4", "p4")


# ============================================================
# 删除任务测试
# ============================================================


class TestDeleteTask:
    """删除任务"""

    @pytest.mark.asyncio
    async def test_delete_completed(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        await mgr.complete(slot.task_id)
        deleted = await mgr.delete(slot.task_id)
        assert deleted is True
        assert mgr.get(slot.task_id) is None

    @pytest.mark.asyncio
    async def test_delete_running_raises(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.start(slot.task_id)
        with pytest.raises(ValueError):
            await mgr.delete(slot.task_id)

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self):
        mgr = MultiTaskManager()
        deleted = await mgr.delete("nonexistent")
        assert deleted is False


# ============================================================
# 进度更新测试
# ============================================================


class TestProgressUpdate:
    """进度更新"""

    @pytest.mark.asyncio
    async def test_update_progress(self):
        mgr = MultiTaskManager()
        slot = await mgr.create("t", "p")
        await mgr.update_progress(
            slot.task_id,
            {"tokens_used": 100, "memory_mb": 256.0, "cpu_percent": 12.5},
        )
        s = mgr.get(slot.task_id)
        assert s.resource_usage.tokens_used == 100
        assert s.resource_usage.memory_mb == 256.0
        assert s.resource_usage.cpu_percent == 12.5

    @pytest.mark.asyncio
    async def test_update_progress_nonexistent_no_op(self):
        mgr = MultiTaskManager()
        # 不应抛错
        await mgr.update_progress("nonexistent", {"tokens_used": 100})


# ============================================================
# 持久化测试
# ============================================================


class TestPersistence:
    """持久化测试"""

    @pytest.mark.asyncio
    async def test_save_and_load_history(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            mgr1 = MultiTaskManager()
            mgr1.set_persist_dir(tmpdir)
            slot = await mgr1.create("t1", "p1")
            await mgr1.start(slot.task_id)
            await mgr1.complete(slot.task_id)

            # 重新创建管理器
            mgr2 = MultiTaskManager()
            mgr2.set_persist_dir(tmpdir)
            loaded = mgr2.get(slot.task_id)
            assert loaded is not None
            assert loaded.status == TaskStatus.COMPLETED
            assert loaded.title == "t1"

    @pytest.mark.asyncio
    async def test_delete_removes_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            mgr = MultiTaskManager()
            mgr.set_persist_dir(tmpdir)
            slot = await mgr.create("t", "p")
            await mgr.start(slot.task_id)
            await mgr.complete(slot.task_id)
            await mgr.delete(slot.task_id)
            # 文件应被删除
            files = list(Path(tmpdir).glob("*.json"))
            assert len(files) == 0


# ============================================================
# 统计测试
# ============================================================


class TestStats:
    """统计测试"""

    @pytest.mark.asyncio
    async def test_get_stats_empty(self):
        mgr = MultiTaskManager()
        stats = mgr.get_stats()
        assert stats["total"] == 0
        assert "by_status" in stats
        assert "quota" in stats

    @pytest.mark.asyncio
    async def test_get_stats_with_tasks(self):
        mgr = MultiTaskManager()
        s1 = await mgr.create("t1", "p1")
        s2 = await mgr.create("t2", "p2")
        await mgr.start(s1.task_id)
        await mgr.complete(s1.task_id)
        stats = mgr.get_stats()
        assert stats["total"] == 2
        assert stats["by_status"]["completed"] == 1
        assert stats["by_status"]["pending"] == 1


# ============================================================
# 全局单例测试
# ============================================================


class TestGlobalSingleton:
    """全局单例"""

    def test_singleton(self):
        reset_multi_task_manager()
        m1 = get_multi_task_manager()
        m2 = get_multi_task_manager()
        assert m1 is m2
        reset_multi_task_manager()
        m3 = get_multi_task_manager()
        assert m3 is not m1
