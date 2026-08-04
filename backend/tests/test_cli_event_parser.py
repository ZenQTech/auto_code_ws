"""
# ============================================================
# CLI Event Parser 单元测试 (Cycle 65 G65-01)
# ============================================================
# 覆盖：
#   - JSONL 解析（_parse_jsonl）
#   - CLI 事件类型枚举（CLIEventType）
#   - 事件分发（_dispatch_cli_event）
#   - 事件类型映射
#   - 边界条件（空行/无效 JSON/未知类型）
#   - CLIEvent 数据结构
# ====================================
"""

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ============================================================
# 辅助函数
# ============================================================


def make_instance():
    """创建测试用 AgentInstance"""
    from app.services.agent_role_manager import AgentRoleManager

    mgr = AgentRoleManager()
    return mgr.spawn_instance(role_name="default", task="test")


# ============================================================
# CLIEventType 枚举测试
# ============================================================


class TestCLIEventType:
    def test_session_start_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.SESSION_START.value == "session_start"

    def test_session_end_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.SESSION_END.value == "session_end"

    def test_tool_use_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.TOOL_USE.value == "tool_use"

    def test_tool_result_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.TOOL_RESULT.value == "tool_result"

    def test_content_delta_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.CONTENT_DELTA.value == "content_delta"

    def test_progress_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.PROGRESS.value == "progress"

    def test_error_value(self):
        from app.services.real_agent_runner import CLIEventType

        assert CLIEventType.ERROR.value == "error"

    def test_all_event_types_count(self):
        """应该有 7 种事件类型"""
        from app.services.real_agent_runner import CLIEventType

        assert len(list(CLIEventType)) == 7


# ============================================================
# CLIEvent 数据结构测试
# ============================================================


class TestCLIEvent:
    def test_create_event(self):
        """创建基本事件"""
        from app.services.real_agent_runner import CLIEvent

        event = CLIEvent(type="tool_use", data={"name": "read"})
        assert event.type == "tool_use"
        assert event.data == {"name": "read"}
        assert event.timestamp == 0.0  # 默认值

    def test_create_event_with_timestamp(self):
        """带时间戳创建事件"""
        from app.services.real_agent_runner import CLIEvent

        now = time.time()
        event = CLIEvent(type="progress", data={"percent": 0.5}, timestamp=now)
        assert event.timestamp == now

    def test_event_default_data(self):
        """data 默认应该为空 dict"""
        from app.services.real_agent_runner import CLIEvent

        # CLIEvent 需要 data 参数（但允许空 dict）
        event = CLIEvent(type="test", data={})
        assert event.data == {}


# ============================================================
# JSONL 解析测试
# ============================================================


class TestJSONLParserDetailed:
    def test_parse_session_start(self):
        """解析 session_start 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "session_start", "session_id": "abc"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "session_start"
        assert event.data["session_id"] == "abc"

    def test_parse_session_end(self):
        """解析 session_end 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "session_end", "status": "success"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "session_end"
        assert event.data["status"] == "success"

    def test_parse_tool_use(self):
        """解析 tool_use 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({
            "type": "tool_use",
            "id": "tu-1",
            "name": "read",
            "input": {"path": "/tmp/test.py"},
        })
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "tool_use"
        assert event.data["name"] == "read"
        assert event.data["input"]["path"] == "/tmp/test.py"

    def test_parse_tool_result(self):
        """解析 tool_result 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({
            "type": "tool_result",
            "id": "tu-1",
            "output": "file contents",
            "duration_ms": 100,
        })
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "tool_result"
        assert event.data["output"] == "file contents"

    def test_parse_content_delta(self):
        """解析 content_delta 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "content_delta", "text": "Hello"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "content_delta"
        assert event.data["text"] == "Hello"

    def test_parse_progress(self):
        """解析 progress 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "progress", "percent": 0.5, "message": "halfway"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "progress"
        assert event.data["percent"] == 0.5

    def test_parse_error(self):
        """解析 error 事件"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({
            "type": "error",
            "error_type": "TimeoutError",
            "message": "operation timed out",
        })
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "error"
        assert event.data["error_type"] == "TimeoutError"

    def test_parse_uses_provided_timestamp(self):
        """应该使用 JSON 中的 timestamp 字段"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        ts = 1700000000.0
        line = json.dumps({"type": "tool_use", "timestamp": ts})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.timestamp == ts

    def test_parse_falls_back_to_current_time(self):
        """没有 timestamp 时应该用当前时间"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        before = time.time()
        line = json.dumps({"type": "tool_use"})
        event = runner._parse_jsonl(line)
        after = time.time()
        assert event is not None
        # event.timestamp 应该在 before/after 之间
        assert before <= event.timestamp <= after, \
            f"timestamp {event.timestamp} not in [{before}, {after}]"

    def test_parse_unknown_type(self):
        """未知事件类型也能解析（不报错）"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "custom_event", "data": "x"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "custom_event"

    def test_parse_malformed_json_returns_none(self):
        """格式错误的 JSON 应该返回 None"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        assert runner._parse_jsonl("not json") is None
        assert runner._parse_jsonl("{incomplete") is None
        assert runner._parse_jsonl("[1,2,3]") is None  # 数组而非对象

    def test_parse_unicode_content(self):
        """Unicode 内容应该正确处理"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "content_delta", "text": "你好世界 🚀"}, ensure_ascii=False)
        event = runner._parse_jsonl(line)
        assert event is not None
        assert "你好世界" in event.data["text"]

    def test_parse_large_payload(self):
        """大型负载应该正常解析"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        large_text = "x" * 10000
        line = json.dumps({"type": "content_delta", "text": large_text})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert len(event.data["text"]) == 10000


# ============================================================
# 事件分发测试
# ============================================================


class TestEventDispatch:
    def test_session_start_no_state_change(self):
        """session_start 不改变 instance 状态"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner()
            instance = make_instance()
            # spawn_instance 默认状态是 "running"（mock 同步）
            initial_status = instance.status
            event = CLIEvent(type="session_start", data={"session_id": "s1"})
            await runner._dispatch_cli_event(instance, event)
            return instance, initial_status

        instance, initial_status = asyncio.run(run())
        # session_start 不会更新状态
        assert instance.status == initial_status

    def test_tool_result_preserves_state(self):
        """tool_result 不会重置状态"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner()
            instance = make_instance()
            instance.status = "tool_calling"  # 模拟前置状态
            event = CLIEvent(type="tool_result", data={"output": "ok", "duration_ms": 50})
            await runner._dispatch_cli_event(instance, event)
            return instance

        instance = asyncio.run(run())
        # 状态保持不变（由调用方管理）
        assert instance.status == "tool_calling"

    def test_unknown_event_type_publishes_nothing(self):
        """未知事件类型不会 publish 任何事件"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(hook_bus=bus)
            instance = make_instance()
            # 订阅事件以验证 publish 被调用
            received = []

            async def cb(e):
                received.append(e)

            bus.subscribe(instance.agent_id, cb)
            event = CLIEvent(type="unknown_event", data={})
            await runner._dispatch_cli_event(instance, event)
            # 短暂等待
            await asyncio.sleep(0.01)
            return received

        received = asyncio.run(run())
        # 不应该收到任何事件
        assert len(received) == 0

    def test_error_event_published(self):
        """error 事件应该被 publish"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(hook_bus=bus)
            instance = make_instance()
            received = []

            async def cb(e):
                received.append(e)

            bus.subscribe(instance.agent_id, cb)
            event = CLIEvent(type="error", data={"message": "fail"})
            await runner._dispatch_cli_event(instance, event)
            await asyncio.sleep(0.01)
            return received

        received = asyncio.run(run())
        assert len(received) == 1
        assert received[0].event_type == HookEventType.ERROR

    def test_multiple_events_dispatched(self):
        """多个事件按顺序分发"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent
        from app.services.hook_event_bus import HookEventBus

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(hook_bus=bus)
            instance = make_instance()
            received = []

            async def cb(e):
                received.append(e)

            bus.subscribe(instance.agent_id, cb)
            events = [
                CLIEvent(type="session_start", data={}),
                CLIEvent(type="tool_use", data={"name": "read"}),
                CLIEvent(type="tool_result", data={"output": "ok"}),
                CLIEvent(type="content_delta", data={"text": "hi"}),
                CLIEvent(type="progress", data={"percent": 0.5}),
                CLIEvent(type="session_end", data={"status": "ok"}),
            ]
            for e in events:
                await runner._dispatch_cli_event(instance, e)
            await asyncio.sleep(0.01)
            return received

        received = asyncio.run(run())
        assert len(received) == 6
        types = [e.event_type.value for e in received]
        assert types == [
            "SubagentStart",
            "PreToolUse",
            "PostToolUse",
            "Output",
            "Progress",
            "SubagentStop",
        ]

    def test_event_data_preserved(self):
        """事件数据应该原样传递"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent
        from app.services.hook_event_bus import HookEventBus

        data = {"name": "bash", "input": {"cmd": "ls"}, "id": "tu-1"}

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(hook_bus=bus)
            instance = make_instance()
            received = []

            async def cb(e):
                received.append(e)

            bus.subscribe(instance.agent_id, cb)
            event = CLIEvent(type="tool_use", data=data)
            await runner._dispatch_cli_event(instance, event)
            await asyncio.sleep(0.01)
            return received

        received = asyncio.run(run())
        assert len(received) == 1
        assert received[0].data == data


# ============================================================
# 边界条件
# ============================================================


class TestEdgeCases:
    def test_parse_with_newlines_in_data(self):
        """数据中包含换行符"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "content_delta", "text": "line1\nline2\nline3"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert "\n" in event.data["text"]

    def test_parse_with_quotes_in_data(self):
        """数据中包含引号"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "content_delta", "text": 'He said "hello"'})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert '"hello"' in event.data["text"]

    def test_parse_with_nested_objects(self):
        """嵌套对象应该正确处理"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        nested = {
            "type": "tool_use",
            "input": {
                "path": "/tmp/x",
                "options": {"recursive": True, "depth": 3},
                "filters": ["*.py", "*.js"],
            },
        }
        line = json.dumps(nested)
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.data["input"]["options"]["recursive"] is True
        assert event.data["input"]["filters"] == ["*.py", "*.js"]

    def test_parse_extra_fields_ignored(self):
        """额外的字段会被保留但不解析"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({
            "type": "tool_use",
            "extra_field": "ignored",
            "another": 123,
        })
        event = runner._parse_jsonl(line)
        assert event is not None
        # 额外字段被保留在 data 中（不丢失）
        assert event.data["extra_field"] == "ignored"
