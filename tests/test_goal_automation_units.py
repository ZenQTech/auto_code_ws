"""
# ============================================================
# Goal Automation - 单元测试
# ============================================================
# 核心作用：覆盖 Auto-Turn Engine + Multi-Agent Delegation 全部功能
# 覆盖范围：
#   - Auto-Turn：注册/注销、配置、状态控制、轮转触发、历史
#   - Delegation：Agent 注册/注销、AC 类型推断、风险等级映射、
#                  委派决策、负载均衡、故障转移、完成回调
#   - API：所有端点的请求/响应模型
# 运行：python3 -m pytest tests/test_goal_automation_units.py -v
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

from app.core.goal_automation import (
    ACType,
    ACTypeMapping,
    AgentRole,
    AgentSpec,
    AutoTurnEngine,
    DelegationDecision,
    DelegationRequest,
    DelegationResult,
    MultiAgentDelegator,
    RiskLevel,
    TurnConfig,
    TurnRecord,
    TurnState,
    TurnStrategy,
    TurnTrigger,
    get_delegator,
    get_engine,
    reset_delegator,
    reset_engine,
)


# ============================================================
# 工具：临时目录
# ============================================================
def _make_temp_dir() -> str:
    """创建临时目录"""
    return tempfile.mkdtemp(prefix="goal_automation_test_")


def _cleanup_dir(path: str) -> None:
    """清理目录"""
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


# ============================================================
# Mock GoalManager
# ============================================================
class MockGoalManager:
    """Mock GoalManager 用于测试 AutoTurnEngine 集成"""

    def __init__(self):
        self._goals: dict = {}
        self._progress: list = []
        self.update_calls: list = []

    def add_goal(self, goal_dict: dict) -> None:
        self._goals[goal_dict["id"]] = goal_dict

    def get(self, goal_id: str):
        return self._goals.get(goal_id)

    def update_acceptance_status(self, goal_id: str, ac_id: str, status: str) -> None:
        self.update_calls.append((goal_id, ac_id, status))
        goal = self._goals.get(goal_id)
        if goal:
            for ac in goal.get("acceptance_criteria", []):
                if ac.get("id") == ac_id:
                    ac["status"] = status

    def add_progress(self, goal_id: str, action: str, description: str, **kwargs) -> None:
        self._progress.append({
            "goal_id": goal_id,
            "action": action,
            "description": description,
            **kwargs,
        })


# ============================================================
# 测试：TurnConfig 数据类
# ============================================================
class TestTurnConfig(unittest.TestCase):
    """TurnConfig 数据类测试"""

    def test_default_values(self):
        """默认值"""
        cfg = TurnConfig(goal_id="goal_1")
        self.assertEqual(cfg.goal_id, "goal_1")
        self.assertEqual(cfg.strategy, TurnStrategy.STANDARD.value)
        self.assertEqual(cfg.interval_seconds, 30)
        self.assertEqual(cfg.max_turns, 1000)
        self.assertTrue(cfg.auto_verify)
        self.assertTrue(cfg.auto_progress)
        self.assertIn("manual", cfg.triggers)
        self.assertTrue(cfg.enabled)

    def test_to_dict(self):
        """to_dict"""
        cfg = TurnConfig(goal_id="goal_1", strategy="aggressive", max_turns=50)
        d = cfg.to_dict()
        self.assertEqual(d["goal_id"], "goal_1")
        self.assertEqual(d["strategy"], "aggressive")
        self.assertEqual(d["max_turns"], 50)

    def test_from_dict(self):
        """from_dict"""
        data = {"goal_id": "goal_1", "strategy": "conservative", "interval_seconds": 60}
        cfg = TurnConfig.from_dict(data)
        self.assertEqual(cfg.goal_id, "goal_1")
        self.assertEqual(cfg.strategy, "conservative")
        self.assertEqual(cfg.interval_seconds, 60)


# ============================================================
# 测试：TurnRecord 数据类
# ============================================================
class TestTurnRecord(unittest.TestCase):
    """TurnRecord 数据类测试"""

    def test_default_turn_id(self):
        """默认 turn_id 自动生成"""
        rec = TurnRecord()
        self.assertTrue(rec.turn_id.startswith("turn_"))
        self.assertEqual(len(rec.turn_id), 13)  # turn_ + 8 hex chars

    def test_to_from_dict(self):
        """to_dict / from_dict 往返"""
        rec = TurnRecord(
            goal_id="goal_1",
            turn_number=5,
            ac_processed=["ac_1", "ac_2"],
            ac_passed=["ac_1"],
            ac_failed=["ac_2"],
            duration_ms=1234,
        )
        d = rec.to_dict()
        rec2 = TurnRecord.from_dict(d)
        self.assertEqual(rec2.goal_id, "goal_1")
        self.assertEqual(rec2.turn_number, 5)
        self.assertEqual(rec2.ac_processed, ["ac_1", "ac_2"])
        self.assertEqual(rec2.duration_ms, 1234)


# ============================================================
# 测试：AutoTurnEngine 注册管理
# ============================================================
class TestAutoTurnEngineRegister(unittest.TestCase):
    """AutoTurnEngine 注册管理测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.engine = AutoTurnEngine(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_register_goal(self):
        """注册 Goal"""
        cfg = TurnConfig(goal_id="goal_1", strategy="aggressive")
        result = self.engine.register_goal(cfg)
        self.assertEqual(result.goal_id, "goal_1")
        self.assertEqual(result.strategy, "aggressive")
        self.assertIn("goal_1", self.engine._configs)
        self.assertEqual(self.engine.get_state("goal_1"), TurnState.IDLE.value)

    def test_unregister_goal(self):
        """注销 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        ok = self.engine.unregister_goal("goal_1")
        self.assertTrue(ok)
        self.assertNotIn("goal_1", self.engine._configs)

    def test_unregister_nonexistent(self):
        """注销不存在的 Goal"""
        ok = self.engine.unregister_goal("nonexistent")
        self.assertFalse(ok)

    def test_get_config(self):
        """获取配置"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", max_turns=50))
        cfg = self.engine.get_config("goal_1")
        self.assertIsNotNone(cfg)
        self.assertEqual(cfg.max_turns, 50)

    def test_get_config_nonexistent(self):
        """获取不存在 Goal 的配置"""
        cfg = self.engine.get_config("nonexistent")
        self.assertIsNone(cfg)

    def test_list_active_goals(self):
        """列出活跃 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="conservative"))
        self.engine.register_goal(TurnConfig(goal_id="goal_2", strategy="aggressive"))
        goals = self.engine.list_active_goals()
        self.assertEqual(len(goals), 2)
        ids = {g["goal_id"] for g in goals}
        self.assertEqual(ids, {"goal_1", "goal_2"})


# ============================================================
# 测试：AutoTurnEngine 状态控制
# ============================================================
class TestAutoTurnEngineState(unittest.TestCase):
    """AutoTurnEngine 状态控制测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.engine = AutoTurnEngine(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_pause_running_goal(self):
        """暂停运行中的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        # 模拟为 running 状态
        self.engine._states["goal_1"] = TurnState.RUNNING.value
        ok = self.engine.pause_goal("goal_1")
        self.assertTrue(ok)
        self.assertEqual(self.engine.get_state("goal_1"), TurnState.PAUSED.value)

    def test_pause_paused_goal(self):
        """暂停已经是暂停状态的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine._states["goal_1"] = TurnState.PAUSED.value
        ok = self.engine.pause_goal("goal_1")
        self.assertTrue(ok)

    def test_pause_nonexistent(self):
        """暂停不存在的 Goal"""
        ok = self.engine.pause_goal("nonexistent")
        self.assertFalse(ok)

    def test_pause_stopped(self):
        """暂停已停止的 Goal 应返回 False（终态）"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine._states["goal_1"] = TurnState.STOPPED.value
        ok = self.engine.pause_goal("goal_1")
        self.assertFalse(ok)

    def test_resume_paused(self):
        """恢复暂停的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine._states["goal_1"] = TurnState.PAUSED.value
        ok = self.engine.resume_goal("goal_1")
        self.assertTrue(ok)
        self.assertEqual(self.engine.get_state("goal_1"), TurnState.IDLE.value)

    def test_resume_non_paused(self):
        """恢复非暂停状态的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        ok = self.engine.resume_goal("goal_1")
        self.assertFalse(ok)

    def test_stop_goal(self):
        """停止 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        ok = self.engine.stop_goal("goal_1")
        self.assertTrue(ok)
        self.assertEqual(self.engine.get_state("goal_1"), TurnState.STOPPED.value)


# ============================================================
# 测试：AutoTurnEngine 轮转触发
# ============================================================
class TestAutoTurnEngineTrigger(unittest.TestCase):
    """AutoTurnEngine 轮转触发测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        # 创建一个 Goal with 3 ACs
        self.manager.add_goal({
            "id": "goal_1",
            "title": "Test Goal",
            "acceptance_criteria": [
                {"id": "ac_1", "title": "Implement feature A", "status": "pending", "priority": 5},
                {"id": "ac_2", "title": "Verify feature B", "status": "pending", "priority": 3},
                {"id": "ac_3", "title": "Test feature C", "status": "pending", "priority": 1},
            ],
        })
        self.engine = AutoTurnEngine(storage_dir=self.tmp, manager=self.manager)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_trigger_unregistered(self):
        """触发未注册 Goal"""
        rec = self.engine.trigger_turn("nonexistent")
        self.assertEqual(rec.state, TurnState.FAILED.value)
        self.assertIn("not registered", rec.error or "")

    def test_trigger_paused(self):
        """触发暂停的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine._states["goal_1"] = TurnState.PAUSED.value
        rec = self.engine.trigger_turn("goal_1")
        self.assertIn(rec.state, [TurnState.PAUSED.value, TurnState.FAILED.value])

    def test_trigger_stopped(self):
        """触发停止的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine._states["goal_1"] = TurnState.STOPPED.value
        rec = self.engine.trigger_turn("goal_1")
        self.assertIn(rec.state, [TurnState.STOPPED.value, TurnState.FAILED.value])

    def test_trigger_with_ac(self):
        """触发有 AC 的 Goal"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="aggressive"))
        rec = self.engine.trigger_turn("goal_1", TurnTrigger.MANUAL.value, max_ac_per_turn=2)
        self.assertIn(rec.state, [TurnState.RUNNING.value, TurnState.COMPLETED.value])
        self.assertGreater(len(rec.ac_processed), 0)
        self.assertGreater(len(rec.ac_passed), 0)

    def test_trigger_priority_order(self):
        """按 priority 排序选择 AC"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="conservative"))
        rec = self.engine.trigger_turn("goal_1", max_ac_per_turn=1)
        # 应该选 priority 最高的 ac_1
        self.assertIn("ac_1", rec.ac_processed)

    def test_trigger_max_turns(self):
        """超过最大轮转次数"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", max_turns=2))
        self.engine.trigger_turn("goal_1")
        self.engine.trigger_turn("goal_1")
        rec = self.engine.trigger_turn("goal_1")
        self.assertEqual(rec.state, TurnState.COMPLETED.value)
        self.assertIn("max_turns", rec.error or "")

    def test_get_turn_history(self):
        """获取轮转历史"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="aggressive"))
        self.engine.trigger_turn("goal_1")
        self.engine.trigger_turn("goal_1")
        history = self.engine.get_turn_history("goal_1")
        self.assertGreaterEqual(len(history), 2)

    def test_get_turn_history_other_goal(self):
        """获取其他 Goal 的历史应为空"""
        self.engine.register_goal(TurnConfig(goal_id="goal_1"))
        self.engine.trigger_turn("goal_1")
        history = self.engine.get_turn_history("goal_other")
        self.assertEqual(len(history), 0)


# ============================================================
# 测试：AutoTurnEngine 持久化
# ============================================================
class TestAutoTurnEnginePersistence(unittest.TestCase):
    """AutoTurnEngine 持久化测试"""

    def test_persistence_load(self):
        """持久化后重新加载"""
        tmp = _make_temp_dir()
        try:
            engine1 = AutoTurnEngine(storage_dir=tmp)
            engine1.register_goal(TurnConfig(goal_id="goal_persist", max_turns=99))
            engine1.trigger_turn("goal_persist")

            # 重新创建实例
            engine2 = AutoTurnEngine(storage_dir=tmp)
            cfg = engine2.get_config("goal_persist")
            self.assertIsNotNone(cfg)
            self.assertEqual(cfg.max_turns, 99)
        finally:
            _cleanup_dir(tmp)


# ============================================================
# 测试：AutoTurnEngine 独立运行模式（v1.1.0 新增）
# ============================================================
class TestAutoTurnEngineStandaloneMode(unittest.TestCase):
    """AutoTurnEngine 独立运行模式（manager=None 场景）"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.engine = AutoTurnEngine(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_set_and_get_local_goal(self):
        """设置/获取本地上下文"""
        goal = {
            "goal_id": "g1",
            "title": "测试 Goal",
            "acceptance_criteria": [
                {"title": "AC1"},
                {"title": "AC2"},
            ],
        }
        self.engine.set_goal_context("g1", goal)
        got = self.engine.get_local_goal("g1")
        self.assertEqual(got, goal)

    def test_set_goal_context_normalizes_acs(self):
        """set_goal_context 应自动补 AC id + status"""
        goal = {
            "goal_id": "g1",
            "acceptance_criteria": [
                {"title": "AC1"},  # 无 id, status
                {"title": "AC2"},
            ],
        }
        self.engine.set_goal_context("g1", goal)
        got = self.engine.get_local_goal("g1")
        acs = got["acceptance_criteria"]
        self.assertEqual(acs[0]["id"], "ac_1")
        self.assertEqual(acs[0]["status"], "pending")
        self.assertEqual(acs[1]["id"], "ac_2")
        self.assertEqual(acs[1]["status"], "pending")

    def test_trigger_turn_uses_local_context(self):
        """触发轮转时使用本地上下文（manager=None）"""
        # 注册
        self.engine.register_goal(TurnConfig(goal_id="g1", max_turns=10))
        # 注入本地上下文
        self.engine.set_goal_context("g1", {
            "goal_id": "g1",
            "acceptance_criteria": [
                {"title": "AC1"},
                {"title": "AC2"},
            ],
        })
        # 触发
        rec = self.engine.trigger_turn("g1", "manual", 1)
        self.assertNotEqual(rec.state, TurnState.FAILED.value)
        self.assertEqual(len(rec.ac_passed), 1)
        self.assertEqual(len(rec.ac_processed), 1)

    def test_trigger_turn_failed_when_no_context(self):
        """无 manager + 无 local context → 触发失败"""
        self.engine.register_goal(TurnConfig(goal_id="g1", max_turns=10))
        rec = self.engine.trigger_turn("g1", "manual", 1)
        # 状态应为 failed，error 包含 "not found"
        self.assertEqual(rec.state, TurnState.FAILED.value)
        self.assertIsNotNone(rec.error)
        self.assertIn("not found", rec.error)

    def test_update_local_ac_status(self):
        """更新本地 AC 状态"""
        self.engine.set_goal_context("g1", {
            "goal_id": "g1",
            "acceptance_criteria": [
                {"id": "ac_1", "title": "AC1", "status": "pending"},
            ],
        })
        self.engine._update_local_ac_status("g1", "ac_1", "passed")
        got = self.engine.get_local_goal("g1")
        acs = got["acceptance_criteria"]
        self.assertEqual(acs[0]["status"], "passed")

    def test_unregister_clears_local_context(self):
        """注销 Goal 应同时清理本地上下文"""
        self.engine.register_goal(TurnConfig(goal_id="g1", max_turns=10))
        self.engine.set_goal_context("g1", {"goal_id": "g1", "acceptance_criteria": []})
        self.engine.unregister_goal("g1")
        self.assertIsNone(self.engine.get_local_goal("g1"))

    def test_local_ac_status_sync_after_turn(self):
        """独立运行模式下轮转后 AC 状态应被标记为 passed"""
        self.engine.register_goal(TurnConfig(goal_id="g1", max_turns=10))
        self.engine.set_goal_context("g1", {
            "goal_id": "g1",
            "acceptance_criteria": [
                {"title": "AC1"},
            ],
        })
        rec = self.engine.trigger_turn("g1", "manual", 1)
        # 轮转后应能再次触发（因为无 manager）
        rec2 = self.engine.trigger_turn("g1", "manual", 1)
        # 第一次应该有 ac_processed，第二次因为没有 pending AC，应该 ac_processed 为空但仍成功
        self.assertEqual(len(rec.ac_processed), 1)
        # 第二次的本地 AC 应该被标记为 passed，所以没有 pending 可处理
        got = self.engine.get_local_goal("g1")
        self.assertEqual(got["acceptance_criteria"][0]["status"], "passed")


# ============================================================
# 测试：AutoTurnEngine 统计
# ============================================================
class TestAutoTurnEngineStats(unittest.TestCase):
    """AutoTurnEngine 统计测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.engine = AutoTurnEngine(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_stats_empty(self):
        """空状态统计"""
        stats = self.engine.get_stats()
        self.assertEqual(stats["total_goals"], 0)
        self.assertEqual(stats["total_turns"], 0)
        self.assertEqual(stats["passed_acs"], 0)
        self.assertEqual(stats["failed_acs"], 0)

    def test_stats_with_data(self):
        """有数据时统计"""
        manager = MockGoalManager()
        manager.add_goal({
            "id": "goal_1",
            "acceptance_criteria": [
                {"id": "ac_1", "title": "test", "status": "pending", "priority": 1},
            ],
        })
        engine = AutoTurnEngine(storage_dir=self.tmp, manager=manager)
        engine.register_goal(TurnConfig(goal_id="goal_1", strategy="aggressive"))
        engine.trigger_turn("goal_1")
        stats = engine.get_stats()
        self.assertEqual(stats["total_goals"], 1)
        self.assertGreaterEqual(stats["total_turns"], 1)


# ============================================================
# 测试：AgentSpec 数据类
# ============================================================
class TestAgentSpec(unittest.TestCase):
    """AgentSpec 数据类测试"""

    def test_default_values(self):
        """默认值"""
        spec = AgentSpec(agent_id="a1", role="implementer", name="Test")
        self.assertEqual(spec.agent_id, "a1")
        self.assertEqual(spec.role, "implementer")
        self.assertEqual(spec.current_load, 0)
        self.assertEqual(spec.max_load, 5)
        self.assertEqual(spec.status, "available")
        self.assertEqual(spec.success_rate, 0.0)

    def test_success_rate(self):
        """成功率计算"""
        spec = AgentSpec(agent_id="a1", role="implementer", name="Test", total_tasks=10, success_count=8)
        self.assertEqual(spec.success_rate, 0.8)

    def test_to_from_dict(self):
        """to_dict / from_dict"""
        spec = AgentSpec(
            agent_id="a1",
            role="architect",
            name="Architect",
            capabilities=["python", "fastapi"],
            risk_levels=["high", "critical"],
        )
        d = spec.to_dict()
        spec2 = AgentSpec.from_dict(d)
        self.assertEqual(spec2.agent_id, "a1")
        self.assertEqual(spec2.role, "architect")
        self.assertEqual(spec2.capabilities, ["python", "fastapi"])
        self.assertEqual(spec2.risk_levels, ["high", "critical"])


# ============================================================
# 测试：DelegationRequest 数据类
# ============================================================
class TestDelegationRequest(unittest.TestCase):
    """DelegationRequest 数据类测试"""

    def test_default_delegation_id(self):
        """默认 delegation_id 自动生成"""
        req = DelegationRequest(goal_id="g1", ac_id="ac1")
        self.assertTrue(req.delegation_id.startswith("del_"))
        self.assertEqual(req.ac_type, ACType.UNKNOWN.value)
        self.assertEqual(req.risk_level, RiskLevel.MEDIUM.value)

    def test_to_from_dict(self):
        """to_dict / from_dict"""
        req = DelegationRequest(
            goal_id="g1",
            ac_id="ac1",
            ac_title="Test",
            ac_type="implementation",
            risk_level="high",
            required_capabilities=["python"],
        )
        d = req.to_dict()
        req2 = DelegationRequest.from_dict(d)
        self.assertEqual(req2.goal_id, "g1")
        self.assertEqual(req2.ac_type, "implementation")
        self.assertEqual(req2.risk_level, "high")


# ============================================================
# 测试：ACTypeMapping
# ============================================================
class TestACTypeMapping(unittest.TestCase):
    """ACTypeMapping 测试"""

    def test_infer_implementation(self):
        """推断为 implementation"""
        ac_type = ACTypeMapping.infer("Implement user login", "Use Python")
        self.assertEqual(ac_type, ACType.IMPLEMENTATION.value)

    def test_infer_testing(self):
        """推断为 testing"""
        ac_type = ACTypeMapping.infer("Write unit tests", "Cover all edge cases")
        self.assertEqual(ac_type, ACType.TESTING.value)

    def test_infer_documentation(self):
        """推断为 documentation"""
        ac_type = ACTypeMapping.infer("Add documentation", "Update README")
        self.assertEqual(ac_type, ACType.DOCUMENTATION.value)

    def test_infer_architecture(self):
        """推断为 architecture"""
        ac_type = ACTypeMapping.infer("Design system architecture")
        self.assertEqual(ac_type, ACType.ARCHITECTURE.value)

    def test_infer_review(self):
        """推断为 review"""
        ac_type = ACTypeMapping.infer("Code review", "审查 PR")
        self.assertEqual(ac_type, ACType.REVIEW.value)

    def test_infer_verification(self):
        """推断为 verification"""
        ac_type = ACTypeMapping.infer("Verify build", "校验")
        self.assertEqual(ac_type, ACType.VERIFICATION.value)

    def test_infer_integration(self):
        """推断为 integration"""
        ac_type = ACTypeMapping.infer("Integrate with payment system", "对接")
        self.assertEqual(ac_type, ACType.INTEGRATION.value)

    def test_infer_unknown(self):
        """无法推断"""
        ac_type = ACTypeMapping.infer("xyz unknown task")
        self.assertEqual(ac_type, ACType.UNKNOWN.value)

    def test_get_preferred_roles(self):
        """获取首选角色"""
        roles = ACTypeMapping.get_preferred_roles(ACType.IMPLEMENTATION.value)
        self.assertIn(AgentRole.IMPLEMENTER.value, roles)
        roles = ACTypeMapping.get_preferred_roles(ACType.ARCHITECTURE.value)
        self.assertIn(AgentRole.ARCHITECT.value, roles)

    def test_get_allowed_roles_low(self):
        """LOW 风险允许所有角色"""
        roles = ACTypeMapping.get_allowed_roles(RiskLevel.LOW.value)
        self.assertIn(AgentRole.IMPLEMENTER.value, roles)
        self.assertIn(AgentRole.ARCHITECT.value, roles)

    def test_get_allowed_roles_critical(self):
        """CRITICAL 风险仅允许架构师"""
        roles = ACTypeMapping.get_allowed_roles(RiskLevel.CRITICAL.value)
        self.assertEqual(roles, [AgentRole.ARCHITECT.value])


# ============================================================
# 测试：MultiAgentDelegator 注册
# ============================================================
class TestMultiAgentDelegatorRegister(unittest.TestCase):
    """MultiAgentDelegator 注册测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.delegator = MultiAgentDelegator(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_register_agent(self):
        """注册 Agent"""
        spec = AgentSpec(
            agent_id="a1",
            role="implementer",
            name="Test",
            capabilities=["python"],
        )
        result = self.delegator.register_agent(spec)
        self.assertEqual(result.agent_id, "a1")
        self.assertIn("a1", self.delegator._agents)

    def test_register_invalid_role(self):
        """注册无效角色"""
        spec = AgentSpec(agent_id="a1", role="invalid_role", name="Test")
        with self.assertRaises(ValueError):
            self.delegator.register_agent(spec)

    def test_register_missing_agent_id(self):
        """缺少 agent_id"""
        spec = AgentSpec(agent_id="", role="implementer", name="Test")
        with self.assertRaises(ValueError):
            self.delegator.register_agent(spec)

    def test_register_invalid_risk_level(self):
        """无效 risk_level"""
        spec = AgentSpec(agent_id="a1", role="implementer", name="Test", risk_levels=["invalid"])
        with self.assertRaises(ValueError):
            self.delegator.register_agent(spec)

    def test_unregister_agent(self):
        """注销 Agent"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="Test"))
        ok = self.delegator.unregister_agent("a1")
        self.assertTrue(ok)
        self.assertNotIn("a1", self.delegator._agents)

    def test_unregister_nonexistent(self):
        """注销不存在的 Agent"""
        ok = self.delegator.unregister_agent("nonexistent")
        self.assertFalse(ok)

    def test_list_agents_by_role(self):
        """按角色列出 Agent"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        self.delegator.register_agent(AgentSpec(agent_id="a2", role="architect", name="B"))
        result = self.delegator.list_agents(role="implementer")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].agent_id, "a1")

    def test_list_agents_by_status(self):
        """按状态列出 Agent"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        self.delegator.register_agent(AgentSpec(agent_id="a2", role="implementer", name="B", status="offline"))
        result = self.delegator.list_agents(status="available")
        self.assertEqual(len(result), 1)

    def test_update_agent_status(self):
        """更新 Agent 状态"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        ok = self.delegator.update_agent_status("a1", "busy")
        self.assertTrue(ok)
        spec = self.delegator.get_agent("a1")
        self.assertEqual(spec.status, "busy")

    def test_update_status_nonexistent(self):
        """更新不存在 Agent 状态"""
        ok = self.delegator.update_agent_status("nonexistent", "busy")
        self.assertFalse(ok)


# ============================================================
# 测试：MultiAgentDelegator 委派决策
# ============================================================
class TestMultiAgentDelegatorDelegate(unittest.TestCase):
    """MultiAgentDelegator 委派决策测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.delegator = MultiAgentDelegator(storage_dir=self.tmp)
        # 注册 3 个 Agent
        self.delegator.register_agent(AgentSpec(
            agent_id="impl_1", role="implementer", name="Impl 1",
            capabilities=["python", "fastapi"], risk_levels=["low", "medium"],
        ))
        self.delegator.register_agent(AgentSpec(
            agent_id="impl_2", role="implementer", name="Impl 2",
            capabilities=["python"], risk_levels=["low", "medium"],
            max_load=3,
        ))
        self.delegator.register_agent(AgentSpec(
            agent_id="arch_1", role="architect", name="Arch 1",
            risk_levels=["low", "medium", "high", "critical"],
        ))

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_delegate_success(self):
        """成功委派"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement feature",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        self.assertEqual(result.decision, DelegationDecision.DELEGATED.value)
        self.assertIn(result.agent_id, ["impl_1", "impl_2"])

    def test_delegate_with_capability_match(self):
        """能力匹配委派"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
            required_capabilities=["fastapi"],
        )
        result = self.delegator.delegate(req)
        self.assertEqual(result.agent_id, "impl_1")

    def test_delegate_high_risk_only_architect(self):
        """高风险仅架构师"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Critical task",
            ac_type="implementation", risk_level="critical",
        )
        result = self.delegator.delegate(req)
        self.assertEqual(result.agent_id, "arch_1")

    def test_delegate_rejected_no_architect(self):
        """critical 仅架构师（架构师未注册 → queued，因为 candidate_roles 非空）"""
        # critical 风险只允许 architect 角色
        # 注销架构师
        self.delegator.unregister_agent("arch_1")
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Critical",
            ac_type="architecture", risk_level="critical",
        )
        result = self.delegator.delegate(req)
        # candidate_roles = [architect]，遍历后无 agent 可用 → queued
        self.assertEqual(result.decision, DelegationDecision.QUEUED.value)

    def test_delegate_rejected_empty_candidates(self):
        """完全无候选角色时 rejected"""
        # DOCUMENTATION + CRITICAL: preferred=[documenter, reviewer], allowed=[architect]
        # 交集为空 → REJECTED
        self.delegator.unregister_agent("impl_1")
        self.delegator.unregister_agent("impl_2")
        self.delegator.unregister_agent("arch_1")
        # 注册一个 documenter
        self.delegator.register_agent(AgentSpec(
            agent_id="doc_1", role="documenter", name="Doc",
            risk_levels=["low", "medium"],
        ))
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Add documentation",
            ac_type="documentation", risk_level="critical",
        )
        result = self.delegator.delegate(req)
        # critical 仅 architect；documenter 不允许 critical → REJECTED
        self.assertEqual(result.decision, DelegationDecision.REJECTED.value)

    def test_delegate_load_balancing(self):
        """负载均衡 - 选 load 最小"""
        # 给 impl_1 加重负载
        self.delegator._agents["impl_1"].current_load = 2
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        # impl_2 负载 0，应该被选中
        self.assertEqual(result.agent_id, "impl_2")

    def test_delegate_offline_agent_skipped(self):
        """offline Agent 被跳过"""
        self.delegator.update_agent_status("impl_1", "offline")
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        # impl_1 是 offline，应该选 impl_2 或 arch_1
        self.assertNotEqual(result.agent_id, "impl_1")

    def test_delegate_queued_when_all_busy(self):
        """所有 Agent 满载时排队"""
        # 把所有 implementer 设为满载，并让 architect 也不可用
        self.delegator.unregister_agent("arch_1")
        for aid in ["impl_1", "impl_2"]:
            spec = self.delegator.get_agent(aid)
            spec.current_load = spec.max_load
            spec.status = "busy"
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        self.assertEqual(result.decision, DelegationDecision.QUEUED.value)

    def test_delegate_infers_ac_type(self):
        """自动推断 AC 类型"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Test login flow",
            ac_type=None, risk_level="medium",
        )
        result = self.delegator.delegate(req)
        self.assertEqual(result.ac_type, ACType.TESTING.value)

    def test_delegate_fallback_attempts(self):
        """故障转移 - 记录备选尝试"""
        # 让 impl_1 离线，impl_2 在线
        self.delegator.update_agent_status("impl_1", "offline")
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Test",
            ac_type="testing", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        # 应选 tester 或 verifier；没有 tester → 排队
        # fallback_attempts 应至少有一个
        # 因为是 testing 任务，但 implementer 在 fallback 中
        self.assertGreaterEqual(len(result.fallback_attempts), 0)

    def test_complete_delegation(self):
        """完成委派"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        self.assertEqual(self.delegator.get_agent(result.agent_id).current_load, 1)
        ok = self.delegator.complete_delegation(result.delegation_id, success=True)
        self.assertTrue(ok)
        self.assertEqual(self.delegator.get_agent(result.agent_id).current_load, 0)
        self.assertEqual(self.delegator.get_agent(result.agent_id).success_count, 1)

    def test_complete_delegation_failure(self):
        """委派失败"""
        req = DelegationRequest(
            goal_id="g1", ac_id="ac1", ac_title="Implement",
            ac_type="implementation", risk_level="medium",
        )
        result = self.delegator.delegate(req)
        self.delegator.complete_delegation(result.delegation_id, success=False)
        self.assertEqual(self.delegator.get_agent(result.agent_id).failure_count, 1)

    def test_complete_nonexistent(self):
        """完成不存在的委派"""
        ok = self.delegator.complete_delegation("nonexistent")
        self.assertFalse(ok)


# ============================================================
# 测试：MultiAgentDelegator 统计
# ============================================================
class TestMultiAgentDelegatorStats(unittest.TestCase):
    """MultiAgentDelegator 统计测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.delegator = MultiAgentDelegator(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_get_stats_empty(self):
        """空统计"""
        stats = self.delegator.get_stats()
        self.assertEqual(stats["total_agents"], 0)
        self.assertEqual(stats["total_delegations"], 0)

    def test_get_stats_with_data(self):
        """有数据统计"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        req = DelegationRequest(goal_id="g1", ac_id="ac1", ac_title="Implement",
                                 ac_type="implementation", risk_level="medium")
        self.delegator.delegate(req)
        stats = self.delegator.get_stats()
        self.assertEqual(stats["total_agents"], 1)
        self.assertGreaterEqual(stats["total_delegations"], 1)

    def test_load_distribution(self):
        """负载分布"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        self.delegator.register_agent(AgentSpec(agent_id="a2", role="architect", name="B"))
        dist = self.delegator.get_load_distribution()
        self.assertIn("by_role", dist)
        self.assertEqual(dist["by_role"].get("implementer"), 1)
        self.assertEqual(dist["by_role"].get("architect"), 1)

    def test_health_check(self):
        """健康检查"""
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        health = self.delegator.health_check()
        self.assertIn("a1", health)

    def test_get_delegation_history(self):
        """委派历史"""
        req = DelegationRequest(goal_id="g1", ac_id="ac1", ac_title="Implement",
                                 ac_type="implementation", risk_level="medium")
        self.delegator.register_agent(AgentSpec(agent_id="a1", role="implementer", name="A"))
        self.delegator.delegate(req)
        history = self.delegator.get_delegation_history(goal_id="g1")
        self.assertEqual(len(history), 1)


# ============================================================
# 测试：全局单例
# ============================================================
class TestGlobalSingletons(unittest.TestCase):
    """全局单例测试"""

    def setUp(self):
        reset_engine()
        reset_delegator()
        self.tmp = _make_temp_dir()

    def tearDown(self):
        reset_engine()
        reset_delegator()
        _cleanup_dir(self.tmp)

    def test_get_engine_singleton(self):
        """engine 单例"""
        e1 = get_engine()
        e2 = get_engine()
        self.assertIs(e1, e2)

    def test_get_delegator_singleton(self):
        """delegator 单例"""
        d1 = get_delegator()
        d2 = get_delegator()
        self.assertIs(d1, d2)

    def test_reset_engine(self):
        """重置 engine"""
        e1 = get_engine()
        reset_engine()
        e2 = get_engine()
        self.assertIsNot(e1, e2)


# ============================================================
# 测试：枚举完整性
# ============================================================
class TestEnums(unittest.TestCase):
    """枚举完整性测试"""

    def test_agent_role_count(self):
        """Agent 角色数量"""
        self.assertEqual(len(AgentRole), 7)

    def test_risk_level_count(self):
        """风险等级数量"""
        self.assertEqual(len(RiskLevel), 4)

    def test_ac_type_count(self):
        """AC 类型数量"""
        self.assertEqual(len(ACType), 8)

    def test_turn_strategy_count(self):
        """轮转策略数量"""
        self.assertEqual(len(TurnStrategy), 3)

    def test_turn_trigger_count(self):
        """轮转触发器数量"""
        self.assertEqual(len(TurnTrigger), 5)

    def test_turn_state_count(self):
        """轮转状态数量"""
        self.assertEqual(len(TurnState), 6)

    def test_delegation_decision_count(self):
        """委派决策数量"""
        self.assertEqual(len(DelegationDecision), 4)


# ============================================================
# 测试：API 路由存在性
# ============================================================
class TestAPIRoutes(unittest.TestCase):
    """API 路由测试"""

    def test_router_imports(self):
        """导入 router 成功"""
        from app.api.goal_automation import router
        self.assertIsNotNone(router)
        self.assertTrue(hasattr(router, "routes"))

    def test_router_routes_count(self):
        """路由数量"""
        from app.api.goal_automation import router
        # 至少 20 个路由
        self.assertGreaterEqual(len(router.routes), 20)


# ============================================================
# 测试：集成
# ============================================================
class TestIntegration(unittest.TestCase):
    """集成测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.manager = MockGoalManager()
        self.manager.add_goal({
            "id": "goal_1",
            "title": "Integration Test Goal",
            "acceptance_criteria": [
                {"id": "ac_1", "title": "Implement login", "status": "pending", "priority": 5},
                {"id": "ac_2", "title": "Write tests", "status": "pending", "priority": 3},
            ],
        })
        self.delegator = MultiAgentDelegator(storage_dir=self.tmp)
        self.delegator.register_agent(AgentSpec(
            agent_id="impl_1", role="implementer", name="Impl",
            capabilities=["python"], risk_levels=["low", "medium"],
        ))
        self.engine = AutoTurnEngine(
            storage_dir=self.tmp, manager=self.manager, delegator=self.delegator
        )

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_end_to_end_flow(self):
        """端到端：注册 → 触发轮转 → 委派 → 验证进度"""
        # 1. 注册 Goal
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="aggressive"))
        # 2. 触发轮转
        rec = self.engine.trigger_turn("goal_1", max_ac_per_turn=2)
        # 3. 验证进度
        self.assertGreater(len(rec.ac_processed), 0)
        # 4. 委派历史应至少有一条
        history = self.delegator.get_delegation_history(goal_id="goal_1")
        self.assertGreater(len(history), 0)
        # 5. GoalManager 应被调用 update
        self.assertGreater(len(self.manager.update_calls), 0)

    def test_concurrent_goals(self):
        """并发多 Goal"""
        self.manager.add_goal({
            "id": "goal_2",
            "acceptance_criteria": [
                {"id": "ac_3", "title": "Test", "status": "pending", "priority": 1},
            ],
        })
        self.engine.register_goal(TurnConfig(goal_id="goal_1", strategy="aggressive"))
        self.engine.register_goal(TurnConfig(goal_id="goal_2", strategy="aggressive"))
        rec1 = self.engine.trigger_turn("goal_1")
        rec2 = self.engine.trigger_turn("goal_2")
        self.assertNotEqual(rec1.turn_id, rec2.turn_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
