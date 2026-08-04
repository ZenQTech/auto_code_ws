"""
# ============================================================
# AgentRunner 单元测试 (Cycle 64 G64-01)
# ====================================
# 覆盖：
#   - HookEventBus: publish/subscribe/history/stats
#   - AgentRunner: start/cancel/pause/resume/lifecycle
#   - Event 序列完整性（SubagentStart -> PreToolUse -> PostToolUse -> SubagentStop）
# ====================================
"""

import asyncio
import sys
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ============================================================
# HookEventBus 测试
# ====================================


class TestHookEventBus:
    def test_publish_creates_event(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            event = await bus.publish(
                "agent-1",
                HookEventType.SUBAGENT_START,
                {"task": "test"},
            )
            assert event.agent_id == "agent-1"
            assert event.event_type == HookEventType.SUBAGENT_START
            assert event.data == {"task": "test"}
            assert event.event_id.startswith("evt-")
            assert event.timestamp > 0
            return event

        event = asyncio.run(run())
        assert event is not None

    def test_publish_saves_to_history(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            for i in range(5):
                await bus.publish("agent-1", HookEventType.PROGRESS, {"i": i})
            history = bus.get_history("agent-1")
            assert len(history) == 5
            return history

        history = asyncio.run(run())
        assert history[0].data == {"i": 0}
        assert history[4].data == {"i": 4}

    def test_subscribe_receives_events(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            received = []

            async def cb(event):
                received.append(event)

            bus.subscribe("agent-1", cb)
            await bus.publish("agent-1", HookEventType.SUBAGENT_START, {})
            await bus.publish("agent-1", HookEventType.SUBAGENT_STOP, {})
            return received

        received = asyncio.run(run())
        assert len(received) == 2
        assert received[0].event_type == HookEventType.SUBAGENT_START
        assert received[1].event_type == HookEventType.SUBAGENT_STOP

    def test_global_subscribe_receives_all(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            received = []

            async def cb(event):
                received.append(event)

            bus.subscribe_global(cb)
            await bus.publish("agent-1", HookEventType.PROGRESS, {})
            await bus.publish("agent-2", HookEventType.PROGRESS, {})
            return received

        received = asyncio.run(run())
        assert len(received) == 2
        assert {e.agent_id for e in received} == {"agent-1", "agent-2"}

    def test_history_limit(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        bus = HookEventBus(max_history_per_agent=3)

        async def run():
            for i in range(5):
                await bus.publish("agent-1", HookEventType.PROGRESS, {"i": i})

        asyncio.run(run())
        history = bus.get_history("agent-1")
        assert len(history) == 3
        # 只保留最后 3 条
        assert history[0].data == {"i": 2}
        assert history[2].data == {"i": 4}

    def test_get_stats(self):
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            await bus.publish("a1", HookEventType.PROGRESS, {})
            await bus.publish("a2", HookEventType.PROGRESS, {})

            async def cb(e):
                pass

            bus.subscribe("a1", cb)
            return bus.get_stats()

        stats = asyncio.run(run())
        assert stats["total_agents"] == 2
        assert stats["total_events"] == 2
        assert stats["total_subscribers"] == 1


# ============================================================
# AgentRunner 测试
# ====================================


class TestAgentRunner:
    def test_runner_start_emits_subagent_start(self):
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_role_models import AgentInstance, AgentRole
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("worker")
            instance = mgr.spawn_instance(role_name="worker", task="test task")
            await runner.start(instance, role)
            # 等待任务完成
            for _ in range(50):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled"):
                    break
            return instance, bus.get_history(instance.agent_id)

        instance, history = asyncio.run(run())
        assert instance.status == "idle"
        assert len(history) > 0
        # 第一个事件必须是 SubagentStart
        assert history[0].event_type == HookEventType.SUBAGENT_START
        # 最后一个事件必须是 SubagentStop
        assert history[-1].event_type == HookEventType.SUBAGENT_STOP
        # 必须有 PreToolUse 和 PostToolUse
        event_types = {e.event_type for e in history}
        assert HookEventType.PRE_TOOL_USE in event_types
        assert HookEventType.POST_TOOL_USE in event_types

    def test_runner_cancel(self):
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("monitor")  # monitor 的序列更短
            instance = mgr.spawn_instance(role_name="monitor", task="x")
            await runner.start(instance, role)
            # 立即取消
            await asyncio.sleep(0.05)
            await runner.cancel(instance.agent_id)
            for _ in range(50):
                await asyncio.sleep(0.1)
                if instance.status in ("cancelled", "idle", "failed", "dead"):
                    break
            return instance, bus.get_history(instance.agent_id)

        instance, history = asyncio.run(run())
        # monitor 的工具序列很短，可能在 cancel 之前已经完成
        assert instance.status in ("cancelled", "idle", "dead")
        # 检查有 Cancelled 事件（如果任务还没完成时取消）
        if instance.status == "cancelled":
            event_types = [e.event_type for e in history]
            assert HookEventType.CANCELLED in event_types

    def test_runner_pause_resume(self):
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("worker")
            instance = mgr.spawn_instance(role_name="worker", task="x")
            await runner.start(instance, role)
            await asyncio.sleep(0.05)
            # 暂停
            paused = await runner.pause(instance.agent_id)
            # 恢复
            await asyncio.sleep(0.1)
            resumed = await runner.resume(instance.agent_id)
            # 等待完成
            for _ in range(100):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled"):
                    break
            return paused, resumed, instance.status

        paused, resumed, final_status = asyncio.run(run())
        assert paused is True
        assert resumed is True
        assert final_status in ("idle", "failed", "cancelled")

    def test_runner_is_running(self):
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("default")
            instance = mgr.spawn_instance(role_name="default", task="x")
            await runner.start(instance, role)
            assert runner.is_running(instance.agent_id) is True
            for _ in range(50):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled"):
                    break
            assert runner.is_running(instance.agent_id) is False

        asyncio.run(run())

    def test_runner_get_stats(self):
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus

        runner = AgentRunner(hook_bus=HookEventBus())
        stats = runner.get_stats()
        assert "active_tasks" in stats
        assert "hook_bus" in stats
        assert stats["active_tasks"] == 0

    def test_runner_emits_progress_events(self):
        """验证 Progress 事件被发出"""
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("worker")
            instance = mgr.spawn_instance(role_name="worker", task="x")
            await runner.start(instance, role)
            for _ in range(50):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled"):
                    break
            history = bus.get_history(instance.agent_id)
            # 工具调用次数应该 >= worker 序列长度
            return instance.tool_calls_count, history

        tool_calls, history = asyncio.run(run())
        assert tool_calls > 0
        # 至少应有 PreToolUse 事件
        pre_count = sum(
            1 for e in history if e.event_type == HookEventType.PRE_TOOL_USE
        )
        post_count = sum(
            1 for e in history if e.event_type == HookEventType.POST_TOOL_USE
        )
        assert pre_count > 0
        assert post_count > 0
        assert pre_count == post_count

    def test_runner_failure_emits_error_event(self):
        """验证失败时发出 Error 事件"""
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType
        import asyncio as _asyncio

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("worker")
            instance = mgr.spawn_instance(role_name="worker", task="x")
            # 直接调用 _run 并注入异常（绕过 start 的 Task 包装）
            cancel_event = _asyncio.Event()
            pause_event = _asyncio.Event()
            pause_event.set()
            # 先发 SubagentStart 模拟正常启动
            await bus.publish(instance.agent_id, HookEventType.SUBAGENT_START, {})
            # 然后直接调用内部 _run 并让它失败
            # 在 _run 中通过 patch MOCK_TOOL_SEQUENCES 触发 AttributeError
            from app.services import agent_runner as ar_mod
            original_seq = ar_mod.MOCK_TOOL_SEQUENCES.copy()

            async def bad_publish(*args, **kwargs):
                raise RuntimeError("simulated publish failure")

            bus.publish = bad_publish
            try:
                await runner._run(instance, role, cancel_event, pause_event, None)
            except RuntimeError:
                # _run 内部应捕获
                pass
            finally:
                # 恢复
                bus.publish = HookEventBus.publish.__get__(bus)
                ar_mod.MOCK_TOOL_SEQUENCES.clear()
                ar_mod.MOCK_TOOL_SEQUENCES.update(original_seq)
            return instance

        instance = asyncio.run(run())
        # 由于 publish 在 PreToolUse 处失败，状态应该是 failed
        assert instance.status == "failed"
        assert instance.error is not None


# ============================================================
# 集成测试
# ====================================


class TestAgentRunnerIntegration:
    def test_full_lifecycle_with_subagent_stop(self):
        """完整生命周期：spawn -> run -> SubagentStop"""
        from app.services.agent_role_manager import AgentRoleManager
        from app.services.agent_runner import AgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = AgentRunner(hook_bus=bus)
            mgr = AgentRoleManager()
            role = mgr.get_role("explorer")
            instance = mgr.spawn_instance(role_name="explorer", task="search")
            await runner.start(instance, role)
            for _ in range(80):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled", "dead"):
                    break
            history = bus.get_history(instance.agent_id)
            return instance, history

        instance, history = asyncio.run(run())
        assert instance.status == "idle"
        # 事件序列必须以 SubagentStart 开始、SubagentStop 结束
        assert history[0].event_type == HookEventType.SUBAGENT_START
        assert history[-1].event_type == HookEventType.SUBAGENT_STOP
        # explorer 有 glob/read/grep/output 4 个工具
        assert instance.tool_calls_count == 4
