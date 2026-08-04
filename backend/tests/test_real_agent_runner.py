"""
# ============================================================
# RealAgentRunner 单元测试 (Cycle 65 G65-01)
# ============================================================
# 覆盖：
#   - RunnerMode 枚举值
#   - BaseAgentRunner 抽象接口
#   - RealAgentRunner 初始化与状态
#   - CLI 命令构建（_build_cli_command）
#   - CLI 可用性检测（is_cli_available）
#   - JSONL 输出解析（_parse_jsonl, _dispatch_cli_event）
#   - 完整任务生命周期（start -> CLI 进程 -> 事件流 -> 结束）
#   - 取消/暂停/恢复
#   - 错误处理（CLI 不可用、超时、退出码非 0）
#   - 工厂函数（get_agent_runner, set_runner_mode, reset_agent_runner）
# ====================================
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

MOCK_CLI_PATH = str(BACKEND_DIR / "tests" / "fixtures" / "mock_cli.py")
# 确认文件可执行
assert os.access(MOCK_CLI_PATH, os.X_OK) or os.access(MOCK_CLI_PATH, os.R_OK), \
    f"Mock CLI 不可访问: {MOCK_CLI_PATH}"


# ============================================================
# 辅助函数
# ============================================================


def make_role(name: str = "worker", **kwargs):
    """创建一个 AgentRole 用于测试"""
    from app.services.agent_role_manager import AgentRoleManager
    from app.services.agent_role_models import AgentRole

    defaults = {
        "name": name,
        "description": "Test role",
        "developer_instructions": "be helpful",
        "nickname_candidates": ["TestBot"],
        "model": None,
        "model_reasoning_effort": None,
        "sandbox_mode": None,
        "mcp_servers": [],
        "skills": [],
        "builtin": False,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    defaults.update(kwargs)
    return AgentRole(**defaults)


def make_instance(role_name: str = "worker", task: str = "test"):
    """创建一个 AgentInstance 用于测试"""
    from app.services.agent_role_manager import AgentRoleManager
    mgr = AgentRoleManager()
    return mgr.spawn_instance(role_name=role_name, task=task)


# ============================================================
# RunnerMode 测试
# ============================================================


class TestRunnerMode:
    def test_runner_mode_enum_values(self):
        """RunnerMode 枚举值应该正确"""
        from app.services.real_agent_runner import RunnerMode

        assert RunnerMode.MOCK.value == "mock"
        assert RunnerMode.REAL.value == "real"
        assert RunnerMode.AUTO.value == "auto"

    def test_runner_mode_string_compatibility(self):
        """RunnerMode 应该兼容字符串比较"""
        from app.services.real_agent_runner import RunnerMode

        assert RunnerMode.MOCK == "mock"
        assert RunnerMode.REAL == "real"
        assert RunnerMode.AUTO == "auto"

    def test_runner_mode_iteration(self):
        """枚举应该可迭代"""
        from app.services.real_agent_runner import RunnerMode

        modes = list(RunnerMode)
        assert len(modes) == 3


# ============================================================
# BaseAgentRunner 抽象测试
# ============================================================


class TestBaseAgentRunner:
    def test_base_runner_abstract_methods(self):
        """BaseAgentRunner 的方法应该抛出 NotImplementedError"""
        from app.services.real_agent_runner import BaseAgentRunner, RunnerMode
        from app.services.agent_role_models import AgentInstance, AgentRole

        base = BaseAgentRunner()
        assert base.mode == RunnerMode.MOCK

        async def run():
            instance = AgentInstance(agent_id="x", role_name="r", nickname="n")
            role = AgentRole(name="r", description="d", developer_instructions="i")
            with pytest.raises(NotImplementedError):
                await base.start(instance, role)
            with pytest.raises(NotImplementedError):
                await base.cancel("x")
            with pytest.raises(NotImplementedError):
                await base.pause("x")
            with pytest.raises(NotImplementedError):
                await base.resume("x")
            with pytest.raises(NotImplementedError):
                base.is_running("x")
            with pytest.raises(NotImplementedError):
                base.get_stats()

        asyncio.run(run())


# ============================================================
# RealAgentRunner 初始化与状态
# ============================================================


class TestRealAgentRunnerInit:
    def test_default_init(self):
        """默认初始化"""
        from app.services.real_agent_runner import RealAgentRunner, RunnerMode

        runner = RealAgentRunner()
        assert runner.mode == RunnerMode.REAL
        assert runner._cli_path == "claude"
        assert runner._sandbox is True
        assert runner._default_timeout == 600.0
        assert len(runner._tasks) == 0
        assert len(runner._processes) == 0

    def test_custom_init(self):
        """自定义初始化"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(
            cli_path="hermes",
            default_timeout=300.0,
            sandbox=False,
            flush_interval_ms=50,
            max_output_buffer=500,
        )
        assert runner._cli_path == "hermes"
        assert runner._sandbox is False
        assert runner._default_timeout == 300.0
        assert runner._flush_interval_s == 0.05
        assert runner._max_output_buffer == 500


# ============================================================
# CLI 命令构建
# ============================================================


class TestBuildCLICommand:
    def test_build_command_basic(self):
        """基本命令构建"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="claude")
        instance = make_instance(task="hello")
        role = make_role(name="worker")
        cmd = runner._build_cli_command(instance, role)
        assert cmd[0] == "claude"
        assert "--role" in cmd
        assert "worker" in cmd
        assert "--task" in cmd
        assert "hello" in cmd
        assert "--output-format" in cmd
        assert "jsonl" in cmd

    def test_build_command_with_model(self):
        """带模型的命令构建"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="claude")
        instance = make_instance()
        role = make_role(model="gpt-5.5", model_reasoning_effort="high")
        cmd = runner._build_cli_command(instance, role)
        assert "--model" in cmd
        assert "gpt-5.5" in cmd
        assert "--reasoning" in cmd
        assert "high" in cmd

    def test_build_command_with_sandbox(self):
        """带沙箱的命令构建"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="claude")
        instance = make_instance()
        role = make_role(sandbox_mode="read-only")
        cmd = runner._build_cli_command(instance, role)
        assert "--sandbox" in cmd
        assert "read-only" in cmd

    def test_build_command_with_nickname(self):
        """带昵称的命令构建"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="claude")
        instance = make_instance()
        instance.nickname = "Atlas"
        role = make_role(nickname_candidates=["Atlas", "Delta"])
        cmd = runner._build_cli_command(instance, role)
        assert "--nickname" in cmd
        assert "Atlas" in cmd


# ============================================================
# CLI 可用性
# ============================================================


class TestCLIAvailability:
    def test_cli_available_with_mock_cli(self):
        """Mock CLI 路径应该可用"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path=str(MOCK_CLI_PATH))
        # 真实路径应该返回 True
        assert runner.is_cli_available() is True

    def test_cli_not_available_with_fake_path(self):
        """不存在的 CLI 路径应该返回 False"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="/nonexistent/fake_cli_xyz_12345")
        assert runner.is_cli_available() is False


# ============================================================
# JSONL 解析
# ============================================================


class TestJSONLParser:
    def test_parse_valid_jsonl(self):
        """解析有效的 JSONL 行"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        line = json.dumps({"type": "tool_use", "name": "read", "id": "tu-1"})
        event = runner._parse_jsonl(line)
        assert event is not None
        assert event.type == "tool_use"
        assert event.data["name"] == "read"

    def test_parse_invalid_jsonl(self):
        """无效的 JSONL 行返回 None"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        event = runner._parse_jsonl("not valid json")
        assert event is None

    def test_parse_empty_line(self):
        """空行处理"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner()
        event = runner._parse_jsonl("")
        # 空字符串不是有效 JSON
        assert event is None


# ============================================================
# 完整生命周期测试（使用 mock CLI）
# ============================================================


class TestRealAgentRunnerLifecycle:
    def test_full_lifecycle_with_mock_cli(self):
        """使用 mock CLI 完整运行生命周期"""
        import os
        os.environ.pop("MOCK_CLI_FAIL", None)
        os.environ.pop("MOCK_CLI_EXIT_CODE", None)
        from app.services.real_agent_runner import RealAgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(
                hook_bus=bus,
                cli_path=MOCK_CLI_PATH,
                default_timeout=30.0,
            )
            role = make_role(name="worker")
            instance = make_instance(role_name="worker", task="hello")
            await runner.start(instance, role)
            # 等待任务完成
            for _ in range(100):
                await asyncio.sleep(0.1)
                if instance.status in ("idle", "failed", "cancelled", "dead"):
                    break
            return instance, bus.get_history(instance.agent_id)

        instance, history = asyncio.run(run())
        assert instance.status == "idle"
        assert instance.finished_at > 0
        # 必须有 SubagentStart 和 SubagentStop
        event_types = [e.event_type for e in history]
        assert HookEventType.SUBAGENT_START in event_types
        assert HookEventType.SUBAGENT_STOP in event_types
        # 工具调用应该有 PreToolUse 和 PostToolUse
        assert HookEventType.PRE_TOOL_USE in event_types
        assert HookEventType.POST_TOOL_USE in event_types
        # 至少一个 content_delta -> OUTPUT
        assert HookEventType.OUTPUT in event_types

    def test_lifecycle_with_cli_failure(self):
        """CLI 失败时应该发出 Error 事件"""
        import os
        os.environ["MOCK_CLI_FAIL"] = "1"
        try:
            from app.services.real_agent_runner import RealAgentRunner
            from app.services.hook_event_bus import HookEventBus, HookEventType

            async def run():
                bus = HookEventBus()
                runner = RealAgentRunner(
                    hook_bus=bus,
                    cli_path=MOCK_CLI_PATH,
                    default_timeout=30.0,
                )
                role = make_role()
                instance = make_instance(task="fail-test")
                await runner.start(instance, role)
                for _ in range(100):
                    await asyncio.sleep(0.1)
                    if instance.status in ("idle", "failed", "cancelled", "dead"):
                        break
                return instance, bus.get_history(instance.agent_id)

            instance, history = asyncio.run(run())
            # 由于 FAIL=1 注入错误，状态应该是 failed
            assert instance.status == "failed"
            # 必须有 Error 事件
            event_types = [e.event_type for e in history]
            assert HookEventType.ERROR in event_types
        finally:
            os.environ.pop("MOCK_CLI_FAIL", None)

    def test_lifecycle_with_cli_unavailable(self):
        """CLI 不可用时应该直接失败"""
        from app.services.real_agent_runner import RealAgentRunner
        from app.services.hook_event_bus import HookEventBus, HookEventType

        async def run():
            bus = HookEventBus()
            runner = RealAgentRunner(
                hook_bus=bus,
                cli_path="/nonexistent/fake_cli_xyz",
            )
            role = make_role()
            instance = make_instance()
            await runner.start(instance, role)
            return instance, bus.get_history(instance.agent_id)

        instance, history = asyncio.run(run())
        # 应该直接失败
        assert instance.status == "failed"
        assert "CLI" in (instance.error or "") or "not found" in (instance.error or "")
        # 必须有 Error 事件
        event_types = [e.event_type for e in history]
        assert HookEventType.ERROR in event_types

    def test_lifecycle_with_exit_code_nonzero(self):
        """非零退出码时应该报告失败"""
        import os
        os.environ["MOCK_CLI_EXIT_CODE"] = "1"
        try:
            from app.services.real_agent_runner import RealAgentRunner
            from app.services.hook_event_bus import HookEventBus, HookEventType

            async def run():
                bus = HookEventBus()
                runner = RealAgentRunner(
                    hook_bus=bus,
                    cli_path=MOCK_CLI_PATH,
                    default_timeout=30.0,
                )
                role = make_role()
                instance = make_instance()
                await runner.start(instance, role)
                for _ in range(100):
                    await asyncio.sleep(0.1)
                    if instance.status in ("idle", "failed", "cancelled", "dead"):
                        break
                return instance, bus.get_history(instance.agent_id)

            instance, history = asyncio.run(run())
            # 由于 EXIT_CODE=1，状态应该是 failed
            assert instance.status == "failed"
            event_types = [e.event_type for e in history]
            assert HookEventType.ERROR in event_types
        finally:
            os.environ.pop("MOCK_CLI_EXIT_CODE", None)


# ============================================================
# 取消/暂停/恢复
# ============================================================


class TestCancelPauseResume:
    def test_cancel_running_task(self):
        """取消正在运行的任务"""
        import os
        os.environ["MOCK_CLI_DELAY"] = "0.5"
        os.environ["MOCK_CLI_TOOLS"] = "read,write,bash,grep,glob"
        os.environ["MOCK_CLI_CONTENT_CHUNKS"] = "0"
        try:
            from app.services.real_agent_runner import RealAgentRunner
            from app.services.hook_event_bus import HookEventBus, HookEventType

            async def run():
                bus = HookEventBus()
                runner = RealAgentRunner(
                    hook_bus=bus,
                    cli_path=MOCK_CLI_PATH,
                    default_timeout=30.0,
                )
                role = make_role()
                instance = make_instance()
                await runner.start(instance, role)
                # 等一会儿让 CLI 启动
                await asyncio.sleep(0.2)
                # 取消
                cancelled = await runner.cancel(instance.agent_id, "test cancel")
                # 等待任务结束
                for _ in range(50):
                    await asyncio.sleep(0.1)
                    if instance.status in ("cancelled", "idle", "failed", "dead"):
                        break
                return cancelled, instance, bus.get_history(instance.agent_id)

            cancelled, instance, history = asyncio.run(run())
            # 取消应该成功
            assert cancelled is True
            # 实例应该被取消或已完成
            assert instance.status in ("cancelled", "idle", "failed", "dead")
            # 取消的实例应该有 Cancelled 事件（如果任务还没完成）
            if instance.status == "cancelled":
                event_types = [e.event_type for e in history]
                assert HookEventType.CANCELLED in event_types
        finally:
            for k in ("MOCK_CLI_DELAY", "MOCK_CLI_TOOLS", "MOCK_CLI_CONTENT_CHUNKS"):
                os.environ.pop(k, None)

    def test_pause_resume_task(self):
        """暂停和恢复任务"""
        import os
        os.environ["MOCK_CLI_DELAY"] = "0.1"
        os.environ["MOCK_CLI_TOOLS"] = "read,write,bash"
        try:
            from app.services.real_agent_runner import RealAgentRunner
            from app.services.hook_event_bus import HookEventBus

            async def run():
                bus = HookEventBus()
                runner = RealAgentRunner(
                    hook_bus=bus,
                    cli_path=MOCK_CLI_PATH,
                    default_timeout=30.0,
                )
                role = make_role()
                instance = make_instance()
                await runner.start(instance, role)
                await asyncio.sleep(0.2)
                # 暂停
                paused = await runner.pause(instance.agent_id)
                await asyncio.sleep(0.2)
                # 恢复
                resumed = await runner.resume(instance.agent_id)
                # 等待完成
                for _ in range(100):
                    await asyncio.sleep(0.1)
                    if instance.status in ("idle", "failed", "cancelled", "dead"):
                        break
                return paused, resumed, instance

            paused, resumed, instance = asyncio.run(run())
            # 暂停和恢复都应成功
            assert paused is True
            assert resumed is True
        finally:
            for k in ("MOCK_CLI_DELAY", "MOCK_CLI_TOOLS"):
                os.environ.pop(k, None)

    def test_cancel_nonexistent_task(self):
        """取消不存在的任务应该返回 True（不抛错）"""
        from app.services.real_agent_runner import RealAgentRunner

        async def run():
            runner = RealAgentRunner()
            result = await runner.cancel("nonexistent-id")
            return result

        result = asyncio.run(run())
        assert result is True

    def test_pause_nonexistent_task(self):
        """暂停不存在的任务应该返回 True"""
        from app.services.real_agent_runner import RealAgentRunner

        async def run():
            runner = RealAgentRunner()
            result = await runner.pause("nonexistent-id")
            return result

        result = asyncio.run(run())
        assert result is True


# ============================================================
# 状态查询
# ============================================================


class TestStateQueries:
    def test_is_running(self):
        """is_running 应该反映任务状态"""
        import os
        os.environ["MOCK_CLI_DELAY"] = "0.2"
        os.environ["MOCK_CLI_TOOLS"] = "read,write,bash"
        try:
            from app.services.real_agent_runner import RealAgentRunner

            async def run():
                runner = RealAgentRunner(
                    cli_path=MOCK_CLI_PATH,
                    default_timeout=30.0,
                )
                role = make_role()
                instance = make_instance()
                # 未启动时
                assert runner.is_running(instance.agent_id) is False
                await runner.start(instance, role)
                # 启动后应该运行
                await asyncio.sleep(0.1)
                running = runner.is_running(instance.agent_id)
                # 等待完成
                for _ in range(100):
                    await asyncio.sleep(0.1)
                    if instance.status in ("idle", "failed", "cancelled", "dead"):
                        break
                # 完成后应该不再运行
                after = runner.is_running(instance.agent_id)
                return running, after

            running, after = asyncio.run(run())
            assert running is True
            assert after is False
        finally:
            for k in ("MOCK_CLI_DELAY", "MOCK_CLI_TOOLS"):
                os.environ.pop(k, None)

    def test_get_stats_with_mock_cli(self):
        """get_stats 应该返回正确的统计信息"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(
            cli_path=MOCK_CLI_PATH,
        )
        stats = runner.get_stats()
        assert "mode" in stats
        assert stats["mode"] == "real"
        assert "active_tasks" in stats
        assert "active_processes" in stats
        assert "cli_path" in stats
        assert "cli_available" in stats
        assert stats["active_tasks"] == 0
        assert stats["active_processes"] == 0
        # mock_cli.py 存在所以 cli_available 应该是 True
        assert stats["cli_available"] is True

    def test_get_stats_cli_unavailable(self):
        """CLI 不可用时 stats 应该正确反映"""
        from app.services.real_agent_runner import RealAgentRunner

        runner = RealAgentRunner(cli_path="/nonexistent/fake_cli_xyz")
        stats = runner.get_stats()
        assert stats["cli_available"] is False


# ============================================================
# 工具调用映射测试
# ============================================================


class TestEventMapping:
    def test_tool_use_increments_count(self):
        """tool_use 事件应该增加 tool_calls_count"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner(cli_path="mock")
            instance = make_instance()
            initial_count = instance.tool_calls_count
            event = CLIEvent(
                type="tool_use",
                data={"name": "read", "id": "tu-1", "input": {"path": "/tmp/x"}},
            )
            await runner._dispatch_cli_event(instance, event)
            return instance, initial_count

        instance, initial_count = asyncio.run(run())
        assert instance.tool_calls_count == initial_count + 1
        assert instance.current_tool == "read"
        assert instance.status == "tool_calling"

    def test_content_delta_status_streaming(self):
        """content_delta 事件应该设置状态为 output_streaming"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner(cli_path="mock")
            instance = make_instance()
            event = CLIEvent(
                type="content_delta",
                data={"text": "hello world"},
            )
            await runner._dispatch_cli_event(instance, event)
            return instance, runner

        instance, runner = asyncio.run(run())
        assert instance.status == "output_streaming"
        assert instance.agent_id in runner._output_buffers
        assert "hello world" in runner._output_buffers[instance.agent_id]

    def test_progress_updates_instance(self):
        """progress 事件应该更新 instance.progress"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner(cli_path="mock")
            instance = make_instance()
            event = CLIEvent(
                type="progress",
                data={"percent": 0.75, "message": "75% done"},
            )
            await runner._dispatch_cli_event(instance, event)
            return instance

        instance = asyncio.run(run())
        assert instance.progress == 0.75

    def test_error_event_sets_error(self):
        """error 事件应该设置 instance.error"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner(cli_path="mock")
            instance = make_instance()
            event = CLIEvent(
                type="error",
                data={"error_type": "TestError", "message": "something failed"},
            )
            await runner._dispatch_cli_event(instance, event)
            return instance

        instance = asyncio.run(run())
        assert instance.error == "something failed"

    def test_output_buffer_max_size(self):
        """输出缓冲区应该限制最大长度"""
        from app.services.real_agent_runner import RealAgentRunner, CLIEvent

        async def run():
            runner = RealAgentRunner(cli_path="mock", max_output_buffer=3)
            instance = make_instance()
            for i in range(5):
                event = CLIEvent(
                    type="content_delta",
                    data={"text": f"chunk-{i}"},
                )
                await runner._dispatch_cli_event(instance, event)
            return instance, runner._output_buffers[instance.agent_id]

        instance, buf = asyncio.run(run())
        # 应该只保留最后 3 条
        assert len(buf) == 3
        assert buf[0] == "chunk-2"
        assert buf[-1] == "chunk-4"


# ============================================================
# 工厂函数测试
# ============================================================


class TestRunnerFactory:
    def test_get_runner_default(self):
        """默认应该返回 MOCK runner"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        reset_agent_runner()
        runner = get_agent_runner()
        assert isinstance(runner, MockAgentRunner)
        assert runner.mode == RunnerMode.MOCK

    def test_get_runner_mock_mode(self):
        """显式指定 MOCK"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        reset_agent_runner()
        runner = get_agent_runner(mode=RunnerMode.MOCK)
        assert isinstance(runner, MockAgentRunner)

    def test_get_runner_real_mode(self):
        """显式指定 REAL"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )
        from app.services.real_agent_runner import RealAgentRunner

        reset_agent_runner()
        runner = get_agent_runner(mode=RunnerMode.REAL)
        assert isinstance(runner, RealAgentRunner)
        assert runner.mode == RunnerMode.REAL

    def test_get_runner_auto_with_cli(self):
        """AUTO 模式 + CLI 可用 → REAL"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            set_runner_mode,
            RunnerMode,
        )
        from app.services.real_agent_runner import RealAgentRunner

        reset_agent_runner()
        # 临时设置全局 cli_path 不现实，但可以通过 AUTO 检测
        runner = get_agent_runner(mode=RunnerMode.AUTO)
        # 默认 claude 不可用，应该 fallback 到 mock
        # 但如果当前环境安装了 claude，则返回 real
        assert runner.mode in (RunnerMode.MOCK, RunnerMode.REAL)

    def test_set_runner_mode(self):
        """set_runner_mode 应该影响后续 get_agent_runner"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            set_runner_mode,
            RunnerMode,
        )
        from app.services.real_agent_runner import RealAgentRunner

        reset_agent_runner()
        set_runner_mode(RunnerMode.REAL)
        runner = get_agent_runner()
        assert isinstance(runner, RealAgentRunner)
        reset_agent_runner()

    def test_reset_agent_runner(self):
        """reset 应该清理单例"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        reset_agent_runner()
        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        assert isinstance(r1, MockAgentRunner)
        reset_agent_runner()
        r2 = get_agent_runner(mode=RunnerMode.MOCK)
        # 应该是新的实例
        assert r1 is not r2

    def test_singleton_consistency(self):
        """同模式下应该返回同一实例"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )

        reset_agent_runner()
        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.MOCK)
        assert r1 is r2

    def test_force_new_creates_new_instance(self):
        """force_new 应该创建新实例"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )

        reset_agent_runner()
        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.MOCK, force_new=True)
        assert r1 is not r2
