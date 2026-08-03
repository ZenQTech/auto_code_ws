"""
# ============================================================
# AutoFollow 服务单元测试 (v1.0.0)
# Cycle 58 G58-04
# ============================================================
# 测试覆盖：
#   - AutoFollowConfig 默认值与字段校验
#   - resolve_panel: 默认/自定义/黑/白名单
#   - AutoFollowService.handle_stage_change 正常路径
#   - AutoFollowService.handle_stage_change 关闭/模式 off 跳过
#   - 订阅/广播（多订阅者 + 队列满容错）
#   - SSE 事件流初始快照
#   - history 累积
#   - 服务端防刷屏（最小间隔）
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
# ====================================
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import asyncio
import time
import pytest

from app.services.auto_follow import (
    AutoFollowConfig,
    AutoFollowEvent,
    AutoFollowMode,
    AutoFollowService,
    PanelKey,
    STAGE_TO_REASON,
    DEFAULT_STAGE_TO_PANEL,
    get_service,
    resolve_panel,
    stream_auto_follow_events,
)
from app.services.loop_state_machine import LoopStage


class TestConfig:
    """AutoFollowConfig 字段测试"""

    def test_defaults(self):
        cfg = AutoFollowConfig()
        assert cfg.enabled is True
        assert cfg.mode == AutoFollowMode.SUGGEST
        assert cfg.custom_mapping == {}
        assert cfg.blocked_panels == []
        assert cfg.allowed_panels is None

    def test_to_dict_round_trip(self):
        cfg = AutoFollowConfig(
            enabled=False,
            mode=AutoFollowMode.FORCE,
            custom_mapping={"executing": "diffView"},
            blocked_panels=["vibeCoding"],
            allowed_panels=["planExecutor", "vibeCoding"],
        )
        d = cfg.to_dict()
        cfg2 = AutoFollowConfig.from_dict(d)
        assert cfg2.enabled is False
        assert cfg2.mode == AutoFollowMode.FORCE
        assert cfg2.custom_mapping == {"executing": "diffView"}
        assert cfg2.blocked_panels == ["vibeCoding"]
        assert cfg2.allowed_panels == ["planExecutor", "vibeCoding"]

    def test_from_dict_empty(self):
        cfg = AutoFollowConfig.from_dict({})
        assert cfg.enabled is True
        assert cfg.mode == AutoFollowMode.SUGGEST

    def test_from_dict_none(self):
        cfg = AutoFollowConfig.from_dict(None)
        assert cfg.enabled is True


class TestResolvePanel:
    """resolve_panel 逻辑测试"""

    def test_default_mapping(self):
        cfg = AutoFollowConfig()
        assert resolve_panel(LoopStage.EXECUTING, cfg) == PanelKey.VIBE_CODING
        assert resolve_panel(LoopStage.CLARIFYING, cfg) == PanelKey.AGENT_CHAT
        assert resolve_panel(LoopStage.REVIEWING, cfg) == PanelKey.DIFF_VIEW

    def test_custom_mapping_overrides_default(self):
        cfg = AutoFollowConfig(custom_mapping={"executing": "diffView"})
        assert resolve_panel(LoopStage.EXECUTING, cfg) == PanelKey.DIFF_VIEW

    def test_custom_mapping_invalid_panel_ignored(self):
        cfg = AutoFollowConfig(custom_mapping={"executing": "nonExistent"})
        # 无效 panel 应回退到默认
        assert resolve_panel(LoopStage.EXECUTING, cfg) == PanelKey.VIBE_CODING

    def test_blocked_panels_excluded(self):
        cfg = AutoFollowConfig(blocked_panels=["vibeCoding"])
        # EXECUTING 默认 → vibeCoding，被 block 后返回 None
        assert resolve_panel(LoopStage.EXECUTING, cfg) is None

    def test_allowed_panels_restrictive(self):
        cfg = AutoFollowConfig(allowed_panels=["loopState"])
        # EXECUTING 默认 → vibeCoding，不在白名单
        assert resolve_panel(LoopStage.EXECUTING, cfg) is None
        # ERROR 默认 → loopState，在白名单
        assert resolve_panel(LoopStage.ERROR, cfg) == PanelKey.LOOP_STATE

    def test_allowed_panels_none_means_unlimited(self):
        cfg = AutoFollowConfig(allowed_panels=None)
        assert resolve_panel(LoopStage.EXECUTING, cfg) == PanelKey.VIBE_CODING


class TestService:
    """AutoFollowService 单元测试"""

    @pytest.mark.asyncio
    async def test_singleton(self):
        s1 = get_service()
        s2 = get_service()
        assert s1 is s2

    @pytest.mark.asyncio
    async def test_get_config_default(self):
        svc = AutoFollowService()
        cfg = await svc.get_config("s1")
        assert cfg.enabled is True
        assert cfg.mode == AutoFollowMode.SUGGEST

    @pytest.mark.asyncio
    async def test_set_and_get_config(self):
        svc = AutoFollowService()
        cfg = AutoFollowConfig(enabled=False, mode=AutoFollowMode.FORCE)
        await svc.set_config("s1", cfg)
        got = await svc.get_config("s1")
        assert got.enabled is False
        assert got.mode == AutoFollowMode.FORCE

    @pytest.mark.asyncio
    async def test_update_config_partial(self):
        svc = AutoFollowService()
        cfg = await svc.update_config("s1", enabled=False)
        assert cfg.enabled is False
        assert cfg.mode == AutoFollowMode.SUGGEST  # 其他保持默认

    @pytest.mark.asyncio
    async def test_update_config_invalid_mode(self):
        svc = AutoFollowService()
        with pytest.raises(ValueError):
            await svc.update_config("s1", mode="invalid")

    @pytest.mark.asyncio
    async def test_handle_stage_change_normal(self):
        svc = AutoFollowService()
        event = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.IDLE,
            to_stage=LoopStage.CLARIFYING,
        )
        assert event is not None
        assert event.target_panel == PanelKey.AGENT_CHAT
        assert event.source_stage == "clarifying"

    @pytest.mark.asyncio
    async def test_handle_stage_change_disabled(self):
        svc = AutoFollowService()
        await svc.set_config("s1", AutoFollowConfig(enabled=False))
        event = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.IDLE,
            to_stage=LoopStage.EXECUTING,
        )
        assert event is None

    @pytest.mark.asyncio
    async def test_handle_stage_change_mode_off(self):
        svc = AutoFollowService()
        await svc.set_config("s1", AutoFollowConfig(mode=AutoFollowMode.OFF))
        event = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.IDLE,
            to_stage=LoopStage.EXECUTING,
        )
        assert event is None

    @pytest.mark.asyncio
    async def test_handle_stage_change_no_match(self):
        svc = AutoFollowService()
        # 黑名单包含默认 panel
        await svc.set_config(
            "s1", AutoFollowConfig(blocked_panels=["vibeCoding"])
        )
        event = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.IDLE,
            to_stage=LoopStage.EXECUTING,
        )
        assert event is None

    @pytest.mark.asyncio
    async def test_handle_stage_change_throttle(self):
        svc = AutoFollowService()
        svc.min_interval_s = 0.5
        e1 = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.IDLE,
            to_stage=LoopStage.CLARIFYING,
        )
        assert e1 is not None
        # 立即再次调用应被节流
        e2 = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.CLARIFYING,
            to_stage=LoopStage.DESIGNING,
        )
        assert e2 is None
        # 等待后应能再次触发
        await asyncio.sleep(0.6)
        e3 = await svc.handle_stage_change(
            session_id="s1",
            from_stage=LoopStage.DESIGNING,
            to_stage=LoopStage.PROMPTING,
        )
        assert e3 is not None

    @pytest.mark.asyncio
    async def test_history_accumulates(self):
        svc = AutoFollowService()
        svc.min_interval_s = 0.0  # 关闭防刷屏便于测试
        await svc.handle_stage_change("s1", LoopStage.IDLE, LoopStage.CLARIFYING)
        await svc.handle_stage_change("s1", LoopStage.CLARIFYING, LoopStage.DESIGNING)
        await svc.handle_stage_change("s1", LoopStage.DESIGNING, LoopStage.PROMPTING)
        history = svc.get_history("s1")
        assert len(history) == 3
        assert [e.source_stage for e in history] == ["clarifying", "designing", "prompting"]


class TestSubscribe:
    """订阅/广播测试"""

    @pytest.mark.asyncio
    async def test_subscribe_and_broadcast(self):
        svc = AutoFollowService()
        svc.min_interval_s = 0.0
        queue = await svc.subscribe("s1")
        await svc.handle_stage_change("s1", LoopStage.IDLE, LoopStage.CLARIFYING)
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event["type"] == "auto_follow_suggested"
        assert event["target_panel"] == "agentChat"
        assert event["source_stage"] == "clarifying"
        assert event["session_id"] == "s1"
        await svc.unsubscribe("s1", queue)

    @pytest.mark.asyncio
    async def test_multiple_subscribers(self):
        svc = AutoFollowService()
        svc.min_interval_s = 0.0
        q1 = await svc.subscribe("s1")
        q2 = await svc.subscribe("s1")
        await svc.handle_stage_change("s1", LoopStage.IDLE, LoopStage.CLARIFYING)
        e1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        e2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        assert e1["target_panel"] == "agentChat"
        assert e2["target_panel"] == "agentChat"

    @pytest.mark.asyncio
    async def test_unsubscribe(self):
        svc = AutoFollowService()
        q = await svc.subscribe("s1")
        await svc.unsubscribe("s1", q)
        assert "s1" not in svc._subscribers or q not in svc._subscribers["s1"]


class TestSSEStream:
    """SSE 事件流测试"""

    @pytest.mark.asyncio
    async def test_stream_initial_snapshot(self):
        events = []
        async for ev in stream_auto_follow_events("sse-1"):
            events.append(ev)
            if len(events) >= 1:
                break
        assert len(events) >= 1
        assert events[0]["type"] == "auto_follow_init"
        assert events[0]["session_id"] == "sse-1"
        assert "config" in events[0]

    @pytest.mark.asyncio
    async def test_stream_with_event(self):
        svc = get_service()
        svc.min_interval_s = 0.0

        events = []
        async def collect():
            async for ev in stream_auto_follow_events("sse-2"):
                events.append(ev)
                if len(events) >= 2:
                    break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)
        await svc.handle_stage_change("sse-2", LoopStage.IDLE, LoopStage.CLARIFYING)

        try:
            await asyncio.wait_for(task, timeout=2.0)
        except asyncio.TimeoutError:
            task.cancel()

        # 至少 init + 1 个事件
        assert len(events) >= 2
        types = [e.get("type") for e in events]
        assert "auto_follow_init" in types
        assert "auto_follow_suggested" in types


class TestConstants:
    """常量测试"""

    def test_default_mapping_complete(self):
        # 确保所有 10 个 stage 都有默认 panel 映射
        for stage in LoopStage:
            assert stage in DEFAULT_STAGE_TO_PANEL

    def test_stage_to_reason_complete(self):
        for stage in LoopStage:
            assert stage in STAGE_TO_REASON
            assert isinstance(STAGE_TO_REASON[stage], str)
            assert len(STAGE_TO_REASON[stage]) > 0
