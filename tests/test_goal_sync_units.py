"""
# ============================================================
# Goal Sync 双向同步 - 单元测试
# ============================================================
# 核心作用：覆盖 GoalSyncEngine 全部功能
# 覆盖范围：
#   - SyncEvent / GoalVersion 数据类
#   - 冲突检测与解决（5 种策略）
#   - Engine→Manager 同步
#   - Manager→Engine 同步
#   - 版本号管理
#   - 订阅者通知
#   - 事件持久化与查询
#   - 全局单例
# 运行：python3 -m pytest tests/test_goal_sync_units.py -v
# ============================================================
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# 添加 backend 目录到 sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.goal_sync import (
    ConflictResolution,
    GoalSyncEngine,
    GoalVersion,
    SyncDirection,
    SyncEvent,
    SyncStatus,
    get_sync,
    reset_sync,
)


# ============================================================
# 工具
# ============================================================
def _make_temp_dir() -> str:
    return tempfile.mkdtemp(prefix="goal_sync_test_")


def _cleanup_dir(path: str) -> None:
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


# ============================================================
# Mock Engine
# ============================================================
class MockAutoTurnEngine:
    """Mock AutoTurnEngine"""

    def __init__(self):
        self._local_goals: dict = {}
        self.update_calls: list = []

    def get_local_goal(self, goal_id: str):
        return self._local_goals.get(goal_id)

    def set_local_goal(self, goal_id: str, goal: dict) -> None:
        self._local_goals[goal_id] = goal

    def _update_local_ac_status(self, goal_id: str, ac_id: str, status: str) -> bool:
        self.update_calls.append((goal_id, ac_id, status))
        local = self._local_goals.get(goal_id)
        if not local:
            return False
        for ac in local.get("acceptance_criteria", []):
            if ac.get("id") == ac_id:
                ac["status"] = status
                return True
        return False


# ============================================================
# Mock Manager
# ============================================================
class MockGoalManager:
    """Mock GoalManager"""

    def __init__(self):
        self._goals: dict = {}
        self.update_calls: list = []

    def add_goal(self, goal_id: str, acs: list) -> None:
        self._goals[goal_id] = {"id": goal_id, "acceptance_criteria": acs}

    def get(self, goal_id: str):
        goal_dict = self._goals.get(goal_id)
        if not goal_dict:
            return None
        # 转换为可接受 .acceptance_criteria 的伪对象
        obj = MagicMock()
        obj.id = goal_dict["id"]
        obj.acceptance_criteria = [
            MagicMock(
                id=ac["id"],
                status=ac.get("status", "pending"),
            )
            for ac in goal_dict["acceptance_criteria"]
        ]
        return obj

    def update_acceptance_criterion(self, goal_id: str, ac_id: str, **kwargs) -> bool:
        self.update_calls.append((goal_id, ac_id, kwargs))
        goal = self._goals.get(goal_id)
        if not goal:
            return False
        for ac in goal["acceptance_criteria"]:
            if ac["id"] == ac_id:
                ac.update(kwargs)
                return True
        return False


# ============================================================
# SyncEvent / GoalVersion 数据类
# ============================================================
class TestSyncEvent(unittest.TestCase):
    """SyncEvent 数据类测试"""

    def test_default_event_id(self):
        """默认 event_id 自动生成"""
        evt = SyncEvent()
        self.assertTrue(evt.event_id.startswith("sync_"))
        self.assertEqual(len(evt.event_id), 13)

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        evt = SyncEvent(
            goal_id="goal_1",
            ac_id="ac_1",
            direction=SyncDirection.ENGINE_TO_MANAGER.value,
            old_value="pending",
            new_value="passed",
            source="engine",
            version=3,
        )
        d = evt.to_dict()
        evt2 = SyncEvent.from_dict(d)
        self.assertEqual(evt2.goal_id, "goal_1")
        self.assertEqual(evt2.ac_id, "ac_1")
        self.assertEqual(evt2.direction, SyncDirection.ENGINE_TO_MANAGER.value)
        self.assertEqual(evt2.new_value, "passed")
        self.assertEqual(evt2.version, 3)


class TestGoalVersion(unittest.TestCase):
    """GoalVersion 数据类测试"""

    def test_default_version(self):
        """默认版本 0"""
        ver = GoalVersion(goal_id="goal_1")
        self.assertEqual(ver.version, 0)
        self.assertEqual(ver.ac_versions, {})

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        ver = GoalVersion(goal_id="goal_1", version=5, ac_versions={"ac_1": 3, "ac_2": 2})
        d = ver.to_dict()
        ver2 = GoalVersion.from_dict(d)
        self.assertEqual(ver2.goal_id, "goal_1")
        self.assertEqual(ver2.version, 5)
        self.assertEqual(ver2.ac_versions, {"ac_1": 3, "ac_2": 2})


# ============================================================
# 版本管理
# ============================================================
class TestVersionManagement(unittest.TestCase):
    """版本号管理测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_get_version_new(self):
        """新 Goal 版本为 0"""
        engine = GoalSyncEngine(storage_dir=self.tmp)
        self.assertEqual(engine.get_version("goal_new"), 0)

    def test_next_version_increments(self):
        """_next_version 自增"""
        engine = GoalSyncEngine(storage_dir=self.tmp)
        v1 = engine._next_version("goal_1")
        v2 = engine._next_version("goal_1")
        self.assertEqual(v1, 1)
        self.assertEqual(v2, 2)

    def test_ac_version_independent(self):
        """AC 版本号独立"""
        engine = GoalSyncEngine(storage_dir=self.tmp)
        v1 = engine._next_version("goal_1", "ac_1")
        v2 = engine._next_version("goal_1", "ac_2")
        self.assertEqual(v1, 1)
        self.assertEqual(v2, 1)
        # 同一个 AC 第二次递增
        v3 = engine._next_version("goal_1", "ac_1")
        self.assertEqual(v3, 2)

    def test_get_ac_version(self):
        """获取 AC 当前版本"""
        engine = GoalSyncEngine(storage_dir=self.tmp)
        engine._next_version("goal_1", "ac_1")
        engine._next_version("goal_1", "ac_1")
        self.assertEqual(engine.get_ac_version("goal_1", "ac_1"), 2)
        self.assertEqual(engine.get_ac_version("goal_1", "ac_99"), 0)


# ============================================================
# 同步 Engine → Manager
# ============================================================
class TestSyncEngineToManager(unittest.TestCase):
    """Engine → Manager 同步测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        self.manager.add_goal("goal_1", [
            {"id": "ac_1", "status": "pending"},
            {"id": "ac_2", "status": "pending"},
        ])
        self.engine_mock = MockAutoTurnEngine()
        self.engine_mock.set_local_goal("goal_1", {
            "id": "goal_1",
            "acceptance_criteria": [
                {"id": "ac_1", "status": "pending"},
                {"id": "ac_2", "status": "pending"},
            ],
        })
        self.sync = GoalSyncEngine(
            storage_dir=self.tmp,
            engine=self.engine_mock,
            manager=self.manager,
        )

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_sync_to_manager_success(self):
        """Engine → Manager 成功同步"""
        evt = self.sync.sync_engine_to_manager(
            goal_id="goal_1",
            ac_id="ac_1",
            old_value="pending",
            new_value="passed",
        )
        self.assertEqual(evt.status, SyncStatus.APPLIED.value)
        self.assertEqual(evt.source, "engine")
        self.assertEqual(evt.direction, SyncDirection.ENGINE_TO_MANAGER.value)
        # 验证 manager 被更新
        self.assertEqual(len(self.manager.update_calls), 1)
        self.assertEqual(self.manager.update_calls[0], ("goal_1", "ac_1", {"status": "passed"}))

    def test_sync_to_manager_version_incremented(self):
        """同步后 AC 版本号自增"""
        self.sync.sync_engine_to_manager("goal_1", "ac_1", "pending", "passed")
        self.assertEqual(self.sync.get_ac_version("goal_1", "ac_1"), 1)

    def test_sync_to_manager_no_manager(self):
        """manager 不可用时返回失败"""
        sync2 = GoalSyncEngine(storage_dir=self.tmp)
        evt = sync2.sync_engine_to_manager("goal_1", "ac_1", "pending", "passed")
        self.assertEqual(evt.status, SyncStatus.FAILED.value)

    def test_sync_to_manager_goal_not_found(self):
        """Goal 不存在时返回失败"""
        evt = self.sync.sync_engine_to_manager("goal_99", "ac_1", "pending", "passed")
        self.assertEqual(evt.status, SyncStatus.FAILED.value)

    def test_sync_to_manager_records_event(self):
        """同步事件被记录"""
        self.sync.sync_engine_to_manager("goal_1", "ac_1", "pending", "passed")
        events = self.sync.get_events(goal_id="goal_1")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ac_id, "ac_1")


# ============================================================
# 同步 Manager → Engine
# ============================================================
class TestSyncManagerToEngine(unittest.TestCase):
    """Manager → Engine 同步测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        self.engine_mock = MockAutoTurnEngine()
        self.engine_mock.set_local_goal("goal_1", {
            "id": "goal_1",
            "acceptance_criteria": [{"id": "ac_1", "status": "pending"}],
        })
        self.sync = GoalSyncEngine(
            storage_dir=self.tmp,
            engine=self.engine_mock,
            manager=self.manager,
        )

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_sync_to_engine_success(self):
        """Manager → Engine 成功同步"""
        evt = self.sync.sync_manager_to_engine(
            goal_id="goal_1",
            ac_id="ac_1",
            old_value="pending",
            new_value="passed",
        )
        self.assertEqual(evt.status, SyncStatus.APPLIED.value)
        self.assertEqual(evt.source, "manager")
        # 验证 engine 被更新
        self.assertEqual(len(self.engine_mock.update_calls), 1)
        self.assertEqual(self.engine_mock.update_calls[0], ("goal_1", "ac_1", "passed"))

    def test_sync_to_engine_no_engine(self):
        """engine 不可用时返回失败"""
        sync2 = GoalSyncEngine(storage_dir=self.tmp, manager=self.manager)
        evt = sync2.sync_manager_to_engine("goal_1", "ac_1", "pending", "passed")
        self.assertEqual(evt.status, SyncStatus.FAILED.value)


# ============================================================
# 冲突解决
# ============================================================
class TestConflictResolution(unittest.TestCase):
    """冲突解决策略测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_last_write_wins_strategy(self):
        """LAST_WRITE_WINS 策略：始终应用"""
        engine = GoalSyncEngine(
            storage_dir=self.tmp,
            conflict_strategy=ConflictResolution.LAST_WRITE_WINS.value,
        )
        evt = SyncEvent(goal_id="g1", ac_id="a1", old_value="pending", new_value="passed")
        result = engine._resolve_conflict(evt, {"status": "failed"})
        self.assertEqual(result.status, SyncStatus.PENDING.value)  # 不被 skip

    def test_reject_strategy(self):
        """REJECT 策略：拒绝所有冲突"""
        engine = GoalSyncEngine(
            storage_dir=self.tmp,
            conflict_strategy=ConflictResolution.REJECT.value,
        )
        evt = SyncEvent(goal_id="g1", ac_id="a1", old_value="pending", new_value="passed")
        result = engine._resolve_conflict(evt, {"status": "failed"})
        self.assertEqual(result.status, SyncStatus.SKIPPED.value)

    def test_manager_wins_strategy(self):
        """MANAGER_WINS 策略"""
        engine = GoalSyncEngine(
            storage_dir=self.tmp,
            conflict_strategy=ConflictResolution.MANAGER_WINS.value,
        )
        # 非 manager 来源应被 skip
        evt = SyncEvent(goal_id="g1", ac_id="a1", source="engine", old_value="pending", new_value="passed")
        result = engine._resolve_conflict(evt, {"status": "failed"})
        self.assertEqual(result.status, SyncStatus.SKIPPED.value)

        # manager 来源应通过
        evt2 = SyncEvent(goal_id="g1", ac_id="a1", source="manager", old_value="pending", new_value="passed")
        result2 = engine._resolve_conflict(evt2, {"status": "failed"})
        self.assertEqual(result2.status, SyncStatus.PENDING.value)

    def test_engine_wins_strategy(self):
        """ENGINE_WINS 策略"""
        engine = GoalSyncEngine(
            storage_dir=self.tmp,
            conflict_strategy=ConflictResolution.ENGINE_WINS.value,
        )
        evt = SyncEvent(goal_id="g1", ac_id="a1", source="manager", old_value="pending", new_value="passed")
        result = engine._resolve_conflict(evt, {"status": "failed"})
        self.assertEqual(result.status, SyncStatus.SKIPPED.value)

    def test_version_check_strategy(self):
        """VERSION_CHECK 策略"""
        engine = GoalSyncEngine(
            storage_dir=self.tmp,
            conflict_strategy=ConflictResolution.VERSION_CHECK.value,
        )
        # 初始版本为 0
        evt = SyncEvent(goal_id="g1", ac_id="a1", old_value="pending", new_value="passed", version=0)
        result = engine._resolve_conflict(evt, {"status": "failed"})
        self.assertEqual(result.status, SyncStatus.SKIPPED.value)

        # 版本大于当前 → 通过
        evt2 = SyncEvent(goal_id="g1", ac_id="a1", old_value="pending", new_value="passed", version=5)
        result2 = engine._resolve_conflict(evt2, {"status": "failed"})
        self.assertEqual(result2.status, SyncStatus.PENDING.value)


# ============================================================
# 订阅者
# ============================================================
class TestSubscribers(unittest.TestCase):
    """订阅者通知测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.engine = GoalSyncEngine(storage_dir=self.tmp)
        self.received_events = []

        def callback(evt: SyncEvent) -> None:
            self.received_events.append(evt)

        self.engine.subscribe(callback)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_subscribe_receives_event(self):
        """订阅者接收同步事件"""
        evt = SyncEvent(goal_id="g1", ac_id="a1", old_value="pending", new_value="passed")
        self.engine._notify(evt)
        self.assertEqual(len(self.received_events), 1)
        self.assertEqual(self.received_events[0].ac_id, "a1")

    def test_unsubscribe(self):
        """取消订阅"""
        def callback2(evt: SyncEvent) -> None:
            self.received_events.append(evt)

        self.engine.subscribe(callback2)
        self.engine.unsubscribe(callback2)

        evt = SyncEvent(goal_id="g1", ac_id="a1")
        self.engine._notify(evt)
        # 第一次的 callback 仍会收到
        self.assertEqual(len(self.received_events), 1)

    def test_callback_error_does_not_break(self):
        """回调异常不影响其他订阅者"""
        def bad_callback(evt: SyncEvent) -> None:
            raise RuntimeError("test error")

        self.engine.subscribe(bad_callback)
        evt = SyncEvent(goal_id="g1", ac_id="a1")
        # 不应抛异常
        self.engine._notify(evt)
        # 第一个订阅者仍应收到
        self.assertEqual(len(self.received_events), 1)


# ============================================================
# 持久化
# ============================================================
class TestPersistence(unittest.TestCase):
    """事件持久化测试"""

    def test_persistence_load(self):
        """持久化后重新加载"""
        tmp = _make_temp_dir()
        try:
            manager = MockGoalManager()
            manager.add_goal("goal_p", [{"id": "ac_1", "status": "pending"}])
            engine1 = GoalSyncEngine(storage_dir=tmp, manager=manager)
            engine1.sync_engine_to_manager("goal_p", "ac_1", "pending", "passed")

            # 重新加载
            engine2 = GoalSyncEngine(storage_dir=tmp)
            events = engine2.get_events(goal_id="goal_p")
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].new_value, "passed")
        finally:
            _cleanup_dir(tmp)


# ============================================================
# 事件查询
# ============================================================
class TestEventQuery(unittest.TestCase):
    """事件查询测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        for i in range(1, 4):
            self.manager.add_goal(f"goal_{i}", [
                {"id": f"ac_{i}_1", "status": "pending"},
                {"id": f"ac_{i}_2", "status": "pending"},
            ])
        self.engine = GoalSyncEngine(
            storage_dir=self.tmp,
            manager=self.manager,
        )
        # 触发若干同步事件
        for i in range(1, 4):
            self.engine.sync_engine_to_manager(f"goal_{i}", f"ac_{i}_1", "pending", "passed")

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_get_events_all(self):
        """获取所有事件"""
        events = self.engine.get_events()
        self.assertEqual(len(events), 3)

    def test_get_events_by_goal(self):
        """按 goal_id 过滤"""
        events = self.engine.get_events(goal_id="goal_1")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].goal_id, "goal_1")

    def test_get_events_by_status(self):
        """按 status 过滤"""
        events = self.engine.get_events(status=SyncStatus.APPLIED.value)
        self.assertEqual(len(events), 3)

    def test_get_events_limit(self):
        """限制返回数量"""
        events = self.engine.get_events(limit=2)
        self.assertEqual(len(events), 2)


# ============================================================
# 统计与清理
# ============================================================
class TestStatsAndClear(unittest.TestCase):
    """统计与清理测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        self.manager.add_goal("goal_1", [{"id": "ac_1", "status": "pending"}])
        self.engine = GoalSyncEngine(storage_dir=self.tmp, manager=self.manager)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_get_stats(self):
        """获取统计信息"""
        self.engine.sync_engine_to_manager("goal_1", "ac_1", "pending", "passed")
        stats = self.engine.get_stats()
        self.assertTrue(stats["success"])
        self.assertGreaterEqual(stats["stats"]["total_events"], 1)
        self.assertEqual(stats["stats"]["applied"], 1)
        self.assertEqual(stats["stats"]["tracked_goals"], 1)

    def test_clear_events(self):
        """清空事件历史"""
        self.engine.sync_engine_to_manager("goal_1", "ac_1", "pending", "passed")
        count = self.engine.clear_events()
        self.assertEqual(count, 1)
        self.assertEqual(len(self.engine.get_events()), 0)


# ============================================================
# 组件连接
# ============================================================
class TestWireComponents(unittest.TestCase):
    """_wire_components 反向引用注入测试"""

    def test_wire_to_engine(self):
        """注入反向引用到 engine"""
        tmp = _make_temp_dir()
        try:
            engine_mock = MockAutoTurnEngine()
            manager = MockGoalManager()
            sync = GoalSyncEngine(
                storage_dir=tmp,
                engine=engine_mock,
                manager=manager,
            )
            self.assertIs(sync.engine._goal_sync, sync)
            self.assertIs(manager._goal_sync, sync)
        finally:
            _cleanup_dir(tmp)


# ============================================================
# 全局单例
# ============================================================
class TestGlobalSingleton(unittest.TestCase):
    """全局单例测试"""

    def setUp(self):
        reset_sync()

    def tearDown(self):
        reset_sync()

    def test_get_sync_singleton(self):
        """获取全局单例"""
        s1 = get_sync()
        s2 = get_sync()
        self.assertIs(s1, s2)

    def test_reset_sync(self):
        """重置单例"""
        s1 = get_sync()
        reset_sync()
        s2 = get_sync()
        self.assertIsNot(s1, s2)


# ============================================================
# 并发安全
# ============================================================
class TestConcurrency(unittest.TestCase):
    """并发安全测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        for i in range(5):
            self.manager.add_goal(f"goal_{i}", [{"id": f"ac_{i}_1", "status": "pending"}])
        self.engine = GoalSyncEngine(storage_dir=self.tmp, manager=self.manager)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_concurrent_sync(self):
        """并发同步测试"""
        results = []

        def worker(goal_id: str, ac_id: str) -> None:
            evt = self.engine.sync_engine_to_manager(
                goal_id, ac_id, "pending", "passed"
            )
            results.append(evt)

        threads = []
        for i in range(5):
            t = threading.Thread(target=worker, args=(f"goal_{i}", f"ac_{i}_1"))
            threads.append(t)
            t.start()
        for t in threads:
            t.join()

        # 5 个事件全部应用
        applied = [r for r in results if r.status == SyncStatus.APPLIED.value]
        self.assertEqual(len(applied), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
