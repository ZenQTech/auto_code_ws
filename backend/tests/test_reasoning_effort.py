"""
# ============================================================
# ReasoningEffort Controller 单元测试 (v1.0.0)
# Cycle 66 G66-01
# ====================================
# 核心作用：覆盖 ReasoningEffortController 所有接口
# 测试维度：
#   1. ReasoningEffort 枚举（order/is_valid/next/previous）
#   2. Controller.set_effort 基本流程
#   3. Controller.get_effort 默认值
#   4. Controller.get_history LRU
#   5. subscribe / unsubscribe 机制
#   6. cleanup_agent 数据清理
#   7. list_efforts / get_stats
#   8. reset 测试辅助
#   9. 单例模式
#  10. 错误处理
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-01 初次创建
# ====================================
"""

import pytest

from app.services.reasoning_effort import (
    AgentNotFoundForEffortError,
    DEFAULT_EFFORT,
    InvalidEffortError,
    ReasoningChange,
    ReasoningEffort,
    ReasoningEffortController,
    ReasoningEffortError,
    get_reasoning_controller,
    reset_reasoning_controller,
)


# ============================================================
# 枚举测试
# ============================================================


class TestReasoningEffortEnum:
    """ReasoningEffort 枚举测试"""

    def test_values(self):
        assert ReasoningEffort.LOW.value == "low"
        assert ReasoningEffort.MEDIUM.value == "medium"
        assert ReasoningEffort.HIGH.value == "high"

    def test_order(self):
        order = ReasoningEffort.order()
        assert order == ["low", "medium", "high"]
        assert len(order) == 3

    def test_is_valid_true(self):
        assert ReasoningEffort.is_valid("low") is True
        assert ReasoningEffort.is_valid("medium") is True
        assert ReasoningEffort.is_valid("high") is True

    def test_is_valid_false(self):
        assert ReasoningEffort.is_valid("xhigh") is False
        assert ReasoningEffort.is_valid("") is False
        assert ReasoningEffort.is_valid("LOW") is False  # 大小写敏感
        assert ReasoningEffort.is_valid("invalid") is False

    def test_next_cycle(self):
        # low → medium
        assert ReasoningEffort.next("low") == "medium"
        # medium → high
        assert ReasoningEffort.next("medium") == "high"
        # high → low (循环)
        assert ReasoningEffort.next("high") == "low"

    def test_previous_cycle(self):
        # high → medium
        assert ReasoningEffort.previous("high") == "medium"
        # medium → low
        assert ReasoningEffort.previous("medium") == "low"
        # low → high (循环)
        assert ReasoningEffort.previous("low") == "high"

    def test_default_effort(self):
        assert DEFAULT_EFFORT == "medium"

    def test_is_str_enum(self):
        # 验证是 str 枚举
        assert isinstance(ReasoningEffort.LOW, str)
        assert ReasoningEffort.LOW == "low"


# ============================================================
# Controller 基本测试
# ============================================================


class TestControllerBasic:
    """Controller 基本功能测试"""

    def setup_method(self):
        reset_reasoning_controller()
        self.ctrl = ReasoningEffortController()

    def teardown_method(self):
        reset_reasoning_controller()

    def test_initial_state(self):
        assert self.ctrl.get_effort("any-agent") == DEFAULT_EFFORT
        assert self.ctrl.get_history("any-agent") == []
        assert self.ctrl.list_efforts() == {}

    def test_set_effort_first_time(self):
        result = self.ctrl.set_effort("agent-1", "high", source="user")
        assert result["success"] is True
        assert result["effort"] == "high"
        assert result["previous_effort"] == DEFAULT_EFFORT
        assert result["applied_immediately"] is True
        # 首次设置时，unchanged 字段不存在（因为不是 unchanged 情况）
        assert "unchanged" not in result

    def test_get_effort(self):
        self.ctrl.set_effort("agent-1", "low")
        assert self.ctrl.get_effort("agent-1") == "low"

    def test_get_effort_default(self):
        # 未设置时返回默认
        assert self.ctrl.get_effort("not-set") == DEFAULT_EFFORT

    def test_set_effort_unchanged(self):
        self.ctrl.set_effort("agent-1", "low")
        result = self.ctrl.set_effort("agent-1", "low")
        assert result["unchanged"] is True
        assert result["effort"] == "low"

    def test_set_effort_overwrite(self):
        self.ctrl.set_effort("agent-1", "low")
        result = self.ctrl.set_effort("agent-1", "high")
        assert result["previous_effort"] == "low"
        assert result["effort"] == "high"

    def test_set_effort_invalid_raises(self):
        with pytest.raises(InvalidEffortError) as exc_info:
            self.ctrl.set_effort("agent-1", "xhigh")
        assert "xhigh" in str(exc_info.value)

    def test_set_effort_empty_agent_raises(self):
        with pytest.raises(AgentNotFoundForEffortError):
            self.ctrl.set_effort("", "low")

    def test_get_state(self):
        self.ctrl.set_effort("agent-1", "high")
        state = self.ctrl.get_state("agent-1")
        assert state["agent_id"] == "agent-1"
        assert state["effort"] == "high"
        assert state["default_effort"] == DEFAULT_EFFORT
        assert state["updated_at"] > 0

    def test_get_state_default(self):
        state = self.ctrl.get_state("new-agent")
        assert state["effort"] == DEFAULT_EFFORT


# ============================================================
# Controller 历史测试
# ============================================================


class TestControllerHistory:
    """Controller 历史记录测试"""

    def setup_method(self):
        reset_reasoning_controller()
        self.ctrl = ReasoningEffortController()

    def teardown_method(self):
        reset_reasoning_controller()

    def test_history_append(self):
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-1", "high")
        history = self.ctrl.get_history("agent-1")
        assert len(history) == 2
        # 最近的在前面
        assert history[0]["effort"] == "high"
        assert history[0]["previous_effort"] == "low"
        assert history[1]["effort"] == "low"
        assert history[1]["previous_effort"] == DEFAULT_EFFORT

    def test_history_source(self):
        self.ctrl.set_effort("agent-1", "low", source="keyboard")
        history = self.ctrl.get_history("agent-1")
        assert history[0]["source"] == "keyboard"

    def test_history_limit(self):
        # 限制应该返回 N 条
        for i in range(30):
            self.ctrl.set_effort("agent-1", "low" if i % 2 == 0 else "high")
        history = self.ctrl.get_history("agent-1", limit=5)
        assert len(history) == 5

    def test_history_lru_max_50(self):
        # 设置 60 次，应该只保留 50 条
        for i in range(60):
            self.ctrl.set_effort("agent-1", "low" if i % 2 == 0 else "high")
        # 私有属性访问（测试内部状态）
        assert len(self.ctrl._history["agent-1"]) == 50

    def test_history_empty(self):
        assert self.ctrl.get_history("agent-not-exist") == []


# ============================================================
# 订阅机制测试
# ============================================================


class TestControllerSubscribe:
    """订阅机制测试"""

    def setup_method(self):
        reset_reasoning_controller()
        self.ctrl = ReasoningEffortController()

    def teardown_method(self):
        reset_reasoning_controller()

    def test_subscribe_local(self):
        received = []

        def callback(agent_id, change):
            received.append((agent_id, change.effort))

        unsub = self.ctrl.subscribe("agent-1", callback)
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-1", "high")

        assert len(received) == 2
        assert received[0] == ("agent-1", "low")
        assert received[1] == ("agent-1", "high")

        # 取消订阅
        unsub()
        self.ctrl.set_effort("agent-1", "medium")
        assert len(received) == 2  # 没新增

    def test_subscribe_global(self):
        received = []

        def callback(agent_id, change):
            received.append(agent_id)

        unsub = self.ctrl.subscribe_global(callback)
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-2", "high")

        assert received == ["agent-1", "agent-2"]
        unsub()

    def test_subscribe_unchanged_not_notify(self):
        received = []

        def callback(agent_id, change):
            received.append(agent_id)

        self.ctrl.subscribe("agent-1", callback)
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-1", "low")  # unchanged

        assert len(received) == 1

    def test_subscribe_callback_error_isolated(self):
        received = []

        def bad_callback(agent_id, change):
            raise RuntimeError("test error")

        def good_callback(agent_id, change):
            received.append(agent_id)

        self.ctrl.subscribe("agent-1", bad_callback)
        self.ctrl.subscribe("agent-1", good_callback)
        # 第一个 callback 抛错，不应影响第二个
        self.ctrl.set_effort("agent-1", "low")
        assert received == ["agent-1"]


# ============================================================
# cleanup / list / stats 测试
# ============================================================


class TestControllerUtilities:
    """Controller 工具方法测试"""

    def setup_method(self):
        reset_reasoning_controller()
        self.ctrl = ReasoningEffortController()

    def teardown_method(self):
        reset_reasoning_controller()

    def test_cleanup_agent(self):
        self.ctrl.set_effort("agent-1", "high")
        assert self.ctrl.cleanup_agent("agent-1") is True
        assert self.ctrl.get_effort("agent-1") == DEFAULT_EFFORT
        assert self.ctrl.get_history("agent-1") == []

    def test_cleanup_nonexistent(self):
        assert self.ctrl.cleanup_agent("not-exist") is False

    def test_list_efforts(self):
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-2", "high")
        efforts = self.ctrl.list_efforts()
        assert efforts == {"agent-1": "low", "agent-2": "high"}

    def test_get_stats(self):
        self.ctrl.set_effort("agent-1", "low")
        self.ctrl.set_effort("agent-2", "high")
        self.ctrl.set_effort("agent-3", "high")
        stats = self.ctrl.get_stats()
        assert stats["total_agents"] == 3
        assert stats["total_changes"] == 3
        assert stats["by_effort"]["low"] == 1
        assert stats["by_effort"]["high"] == 2
        assert stats["by_effort"]["medium"] == 0
        assert stats["default_effort"] == DEFAULT_EFFORT
        assert stats["max_history_per_agent"] == 50

    def test_reset(self):
        self.ctrl.set_effort("agent-1", "high")
        self.ctrl.reset()
        assert self.ctrl.get_effort("agent-1") == DEFAULT_EFFORT
        assert self.ctrl.list_efforts() == {}
        assert self.ctrl.get_stats()["total_agents"] == 0


# ============================================================
# 单例测试
# ============================================================


class TestGlobalSingleton:
    """全局单例测试"""

    def teardown_method(self):
        reset_reasoning_controller()

    def test_singleton(self):
        c1 = get_reasoning_controller()
        c2 = get_reasoning_controller()
        assert c1 is c2

    def test_reset_singleton(self):
        c1 = get_reasoning_controller()
        c1.set_effort("agent-1", "high")
        reset_reasoning_controller()
        c2 = get_reasoning_controller()
        # 单例被重置
        assert c2.get_effort("agent-1") == DEFAULT_EFFORT


# ============================================================
# ReasoningChange 测试
# ============================================================


class TestReasoningChange:
    """ReasoningChange 数据类测试"""

    def test_to_dict(self):
        change = ReasoningChange(
            effort="high",
            previous_effort="low",
            timestamp=1234567890.0,
            source="api",
        )
        d = change.to_dict()
        assert d == {
            "effort": "high",
            "previous_effort": "low",
            "timestamp": 1234567890.0,
            "source": "api",
        }


# ============================================================
# 错误类测试
# ============================================================


class TestExceptions:
    """异常类测试"""

    def test_reasoning_effort_error(self):
        assert issubclass(InvalidEffortError, ReasoningEffortError)
        assert issubclass(AgentNotFoundForEffortError, ReasoningEffortError)
        assert issubclass(ReasoningEffortError, Exception)
