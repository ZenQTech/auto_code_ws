"""
# ============================================================
# LoopStateMachine 单元测试 (v1.0.0)
# Cycle 58 G58-03
# ============================================================
# 测试覆盖：
#   - LoopStage 枚举和合法迁移
#   - LoopStateMachine 状态迁移（合法/非法）
#   - 进度更新
#   - 订阅/广播
#   - LoopMachineRegistry 单例管理
#   - SSE 事件流
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
# ====================================
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import asyncio
import pytest
from typing import List

from app.services.loop_state_machine import (
    LoopStage,
    LoopStateMachine,
    LoopMachineRegistry,
    ALLOWED_TRANSITIONS,
    get_registry,
    stream_machine_events,
)


class TestLoopStage:
    """LoopStage 枚举测试"""
    
    def test_all_stages_defined(self):
        expected = {
            "idle", "clarifying", "designing", "prompting",
            "executing", "reviewing", "done", "paused", "error", "cancelled"
        }
        actual = {s.value for s in LoopStage}
        assert actual == expected
    
    def test_transitions_defined_for_all_stages(self):
        for stage in LoopStage:
            assert stage in ALLOWED_TRANSITIONS
            assert isinstance(ALLOWED_TRANSITIONS[stage], list)


class TestStateMachine:
    """LoopStateMachine 单元测试"""
    
    @pytest.mark.asyncio
    async def test_initial_state(self):
        machine = LoopStateMachine("test-1")
        assert machine.stage == LoopStage.IDLE
        assert machine.progress == 0.0
        assert machine.eta_seconds == 0.0
        assert machine.session_id == "test-1"
    
    @pytest.mark.asyncio
    async def test_legal_transition(self):
        machine = LoopStateMachine("test-2")
        success = await machine.transition(LoopStage.CLARIFYING, progress=0.1)
        assert success
        assert machine.stage == LoopStage.CLARIFYING
        assert machine.progress == 0.1
    
    @pytest.mark.asyncio
    async def test_illegal_transition(self):
        machine = LoopStateMachine("test-3")
        # IDLE -> EXECUTING 是不允许的
        success = await machine.transition(LoopStage.EXECUTING, force=False)
        assert not success
        # stage 应该保持 IDLE
        assert machine.stage == LoopStage.IDLE
    
    @pytest.mark.asyncio
    async def test_force_transition(self):
        machine = LoopStateMachine("test-4")
        success = await machine.transition(LoopStage.DONE, force=True)
        assert success
        assert machine.stage == LoopStage.DONE
    
    @pytest.mark.asyncio
    async def test_progress_clamping(self):
        machine = LoopStateMachine("test-5")
        # 使用 force=True 跳过状态校验
        await machine.transition(LoopStage.EXECUTING, progress=1.5, force=True)
        # 应该被限制在 1.0
        assert machine.progress == 1.0
        await machine.transition(LoopStage.EXECUTING, progress=-0.5, force=True)
        assert machine.progress == 0.0
    
    @pytest.mark.asyncio
    async def test_set_progress(self):
        machine = LoopStateMachine("test-6")
        machine.set_progress(0.5, eta_seconds=60)
        assert machine.progress == 0.5
        assert machine.eta_seconds == 60.0
    
    @pytest.mark.asyncio
    async def test_history(self):
        machine = LoopStateMachine("test-7")
        await machine.transition(LoopStage.CLARIFYING)
        await machine.transition(LoopStage.DESIGNING)
        await machine.transition(LoopStage.PROMPTING)
        history = machine.history
        assert len(history) == 3
        assert history[0].from_state == LoopStage.IDLE
        assert history[0].to_state == LoopStage.CLARIFYING
        assert history[-1].to_state == LoopStage.PROMPTING
    
    @pytest.mark.asyncio
    async def test_subscribe_and_broadcast(self):
        machine = LoopStateMachine("test-8")
        queue = await machine.subscribe()
        
        await machine.transition(LoopStage.CLARIFYING)
        
        # 应该收到一个事件
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event["type"] == "loop_state_changed"
        assert event["stage"] == "clarifying"
        assert event["session_id"] == "test-8"
        
        await machine.unsubscribe(queue)
    
    @pytest.mark.asyncio
    async def test_multiple_subscribers(self):
        machine = LoopStateMachine("test-9")
        q1 = await machine.subscribe()
        q2 = await machine.subscribe()
        
        await machine.transition(LoopStage.CLARIFYING)
        
        e1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        e2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        
        assert e1["stage"] == "clarifying"
        assert e2["stage"] == "clarifying"
    
    @pytest.mark.asyncio
    async def test_snapshot(self):
        machine = LoopStateMachine("test-10")
        await machine.transition(LoopStage.EXECUTING, progress=0.5, metadata={"task": "test"}, force=True)
        snapshot = machine.snapshot()
        assert snapshot.stage == LoopStage.EXECUTING
        assert snapshot.progress == 0.5
        assert snapshot.session_id == "test-10"
        assert "task" in snapshot.sub_state
    
    @pytest.mark.asyncio
    async def test_is_transition_allowed(self):
        machine = LoopStateMachine("test-11")
        # IDLE -> CLARIFYING 允许
        assert machine.is_transition_allowed(LoopStage.IDLE, LoopStage.CLARIFYING)
        # IDLE -> DONE 不允许
        assert not machine.is_transition_allowed(LoopStage.IDLE, LoopStage.DONE)
        # 自身迁移允许
        assert machine.is_transition_allowed(LoopStage.IDLE, LoopStage.IDLE)


class TestRegistry:
    """LoopMachineRegistry 测试"""
    
    @pytest.mark.asyncio
    async def test_get_or_create(self):
        registry = LoopMachineRegistry()
        m1 = await registry.get_or_create("reg-1")
        m2 = await registry.get_or_create("reg-1")
        assert m1 is m2
        assert m1.session_id == "reg-1"
    
    @pytest.mark.asyncio
    async def test_get_existing(self):
        registry = LoopMachineRegistry()
        m1 = await registry.get_or_create("reg-2")
        m2 = registry.get("reg-2")
        assert m1 is m2
    
    @pytest.mark.asyncio
    async def test_get_nonexistent(self):
        registry = LoopMachineRegistry()
        m = registry.get("nonexistent")
        assert m is None
    
    @pytest.mark.asyncio
    async def test_remove(self):
        registry = LoopMachineRegistry()
        await registry.get_or_create("reg-3")
        await registry.remove("reg-3")
        assert registry.get("reg-3") is None
    
    @pytest.mark.asyncio
    async def test_list_sessions(self):
        registry = LoopMachineRegistry()
        await registry.get_or_create("reg-4")
        await registry.get_or_create("reg-5")
        sessions = registry.list_sessions()
        assert "reg-4" in sessions
        assert "reg-5" in sessions
    
    def test_global_singleton(self):
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2


class TestStreamEvents:
    """SSE 事件流测试"""
    
    @pytest.mark.asyncio
    async def test_stream_initial_snapshot(self):
        events = []
        async for event in stream_machine_events("stream-1"):
            events.append(event)
            if len(events) >= 1:
                break
        # 至少应收到初始快照
        assert len(events) >= 1
        assert events[0]["type"] == "loop_state_changed"
        assert events[0]["session_id"] == "stream-1"
    
    @pytest.mark.asyncio
    async def test_stream_with_transitions(self):
        machine = await get_registry().get_or_create("stream-2")
        
        events = []
        async def collect():
            async for event in stream_machine_events("stream-2"):
                events.append(event)
                if len(events) >= 3:
                    break
        
        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)
        await machine.transition(LoopStage.CLARIFYING)
        await machine.transition(LoopStage.DESIGNING)
        
        try:
            await asyncio.wait_for(task, timeout=2.0)
        except asyncio.TimeoutError:
            task.cancel()
        
        # 至少收到 2 个事件（初始 + 至少 1 个迁移）
        assert len(events) >= 1
        stages = [e.get("stage") for e in events]
        assert "clarifying" in stages or "designing" in stages
