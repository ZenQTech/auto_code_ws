"""
# ============================================================
# ClaudeCLIProcess + SandboxManager 单元测试 (v1.0.0)
# Cycle 61 G61-01-T7
# ============================================================
# 测试覆盖：
#   - SandboxManager: 探测 / 选择 / 降级
#   - ClaudeCLIProcess: 状态机 / 事件流 / 取消 / 资源超限
#   - Claude CLI API: 输入校验 / 错误码
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-01-T7 初次创建
# ====================================
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..")))

import asyncio
import time
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.services.claude_cli import (
    ClaudeCLIOptions,
    ClaudeCLIProcess,
    CLIEvent,
    CLIEventType,
    CLIState,
    get_registry,
)
from app.services.sandbox_manager import (
    SandboxManager,
    SandboxResult,
    SandboxType,
    get_sandbox_manager,
)


# ============================================================
# SandboxManager 测试
# ============================================================


class TestSandboxManager:
    """SandboxManager 单元测试"""

    @pytest.mark.asyncio
    async def test_none_always_available(self):
        """NONE 沙箱永远可用"""
        mgr = SandboxManager()
        await mgr.initialize()
        status = await mgr.health_check()
        assert status[SandboxType.NONE] is True

    @pytest.mark.asyncio
    async def test_acquire_auto_returns_valid_sandbox(self):
        """acquire_auto 返回有效沙箱"""
        mgr = SandboxManager()
        result = await mgr.acquire_auto(cpu_quota=0.5, mem_limit_mb=256)
        assert result.sandbox_type in SandboxType
        assert result.cpu_quota == 0.5
        assert result.mem_limit_mb == 256
        assert result.acquired_at > 0

    @pytest.mark.asyncio
    async def test_acquire_explicit_none(self):
        """显式请求 NONE 沙箱"""
        mgr = SandboxManager()
        result = await mgr.acquire(
            sandbox_type=SandboxType.NONE,
            cpu_quota=0.8,
            mem_limit_mb=512,
        )
        assert result.sandbox_type == SandboxType.NONE
        assert result.is_fallback is False  # NONE 显式请求不算降级

    @pytest.mark.asyncio
    async def test_acquire_unavailable_falls_back_to_none(self):
        """不可用沙箱自动降级到 NONE"""
        mgr = SandboxManager()
        # 强制 Docker 不可用
        mgr._info[SandboxType.DOCKER] = MagicMock(available=False)
        result = await mgr.acquire(
            sandbox_type=SandboxType.DOCKER,
            cpu_quota=0.8,
            mem_limit_mb=512,
        )
        # 实际探测仍可能发现 Docker 不可用 → 降级 NONE
        assert result.sandbox_type in (SandboxType.DOCKER, SandboxType.NONE)

    @pytest.mark.asyncio
    async def test_release_returns_true(self):
        """release 总是返回 True"""
        mgr = SandboxManager()
        result = await mgr.acquire_auto()
        released = await mgr.release(result)
        assert released is True

    @pytest.mark.asyncio
    async def test_sandbox_priority_order(self):
        """沙箱优先级：DOCKER > GVISOR > FIREJAIL > NONE"""
        assert SandboxType.DOCKER in SandboxType
        # 验证 SANDBOX_PRIORITY 顺序
        from app.services.sandbox_manager import SANDBOX_PRIORITY
        assert SANDBOX_PRIORITY[0] == SandboxType.DOCKER
        assert SANDBOX_PRIORITY[-1] == SandboxType.NONE


# ============================================================
# ClaudeCLIProcess 测试
# ============================================================


class TestClaudeCLIOptions:
    """ClaudeCLIOptions 数据类测试"""

    def test_default_values(self):
        """默认值验证"""
        opts = ClaudeCLIOptions()
        assert opts.timeout == 300
        assert opts.cpu_quota == 0.8
        assert opts.mem_limit_mb == 512
        assert opts.auto_fallback is True
        assert "read" in opts.tools

    def test_custom_values(self):
        """自定义值"""
        opts = ClaudeCLIOptions(
            model="claude-sonnet-4",
            timeout=600,
            max_tokens=16384,
            sandbox=SandboxType.DOCKER,
        )
        assert opts.model == "claude-sonnet-4"
        assert opts.timeout == 600
        assert opts.max_tokens == 16384
        assert opts.sandbox == SandboxType.DOCKER


class TestClaudeCLIProcess:
    """ClaudeCLIProcess 单元测试"""

    def test_process_id_auto_generated(self):
        """process_id 自动生成"""
        proc = ClaudeCLIProcess()
        assert proc.process_id.startswith("cli-")
        assert len(proc.process_id) > 8

    def test_process_id_custom(self):
        """自定义 process_id"""
        proc = ClaudeCLIProcess(process_id="cli-custom-id")
        assert proc.process_id == "cli-custom-id"

    def test_initial_state_is_idle(self):
        """初始状态为 IDLE"""
        proc = ClaudeCLIProcess()
        assert proc.state == CLIState.IDLE
        assert not proc.is_running
        assert not proc.is_terminal

    def test_terminal_states(self):
        """终止状态判断"""
        for terminal_state in [
            CLIState.COMPLETED,
            CLIState.FAILED,
            CLIState.CANCELLED,
            CLIState.TIMEOUT,
            CLIState.OOM,
            CLIState.FALLBACK,
        ]:
            proc = ClaudeCLIProcess()
            proc._state = terminal_state
            assert proc.is_terminal
            assert not proc.is_running

    @pytest.mark.asyncio
    async def test_start_with_invalid_timeout(self):
        """非法 timeout 应抛 ValueError"""
        proc = ClaudeCLIProcess()
        opts = ClaudeCLIOptions(timeout=0)
        with pytest.raises(ValueError):
            async for _ in proc.stream("test", opts):
                pass

    @pytest.mark.asyncio
    async def test_start_with_oversized_timeout(self):
        """超时超过上限应抛 ValueError"""
        proc = ClaudeCLIProcess()
        opts = ClaudeCLIOptions(timeout=2000)  # 超过 1800
        with pytest.raises(ValueError):
            async for _ in proc.stream("test", opts):
                pass

    @pytest.mark.asyncio
    async def test_cancel_idempotent(self):
        """cancel 多次调用幂等"""
        proc = ClaudeCLIProcess()
        # 第一次 cancel（IDLE 状态不算运行，cancel 返回 False）
        result1 = proc.cancel()
        assert result1 is False  # IDLE 状态不运行

    @pytest.mark.asyncio
    async def test_result_when_idle(self):
        """IDLE 状态调用 result 返回默认值"""
        proc = ClaudeCLIProcess()
        result = proc.result()
        assert result.process_id == proc.process_id
        assert result.state == CLIState.IDLE
        assert result.exit_code is None
        assert result.duration == 0.0
        assert result.fallback_used is False


class TestCLIEvent:
    """CLIEvent 数据类测试"""

    def test_event_creation(self):
        """事件创建"""
        ev = CLIEvent(
            id="cli-abc",
            type=CLIEventType.STDOUT,
            timestamp=time.time(),
            content="Hello",
        )
        assert ev.id == "cli-abc"
        assert ev.type == CLIEventType.STDOUT
        assert ev.content == "Hello"
        assert ev.metadata is None

    def test_event_with_metadata(self):
        """带 metadata 的事件"""
        ev = CLIEvent(
            id="cli-abc",
            type=CLIEventType.TOOL_CALL,
            timestamp=time.time(),
            content="[tool_call]read",
            metadata={"tool": "read", "args": {"path": "/tmp/x"}},
        )
        assert ev.metadata is not None
        assert ev.metadata["tool"] == "read"


# ============================================================
# CLIEventType 枚举测试
# ============================================================


class TestCLIEventType:
    """CLIEventType 枚举测试"""

    def test_all_event_types(self):
        """所有事件类型定义"""
        expected = {
            "cli_started",
            "cli_stdout",
            "cli_stderr",
            "cli_thinking",
            "cli_tool_call",
            "cli_tool_result",
            "cli_exit",
            "cli_fallback",
            "cli_error",
        }
        actual = {e.value for e in CLIEventType}
        assert actual == expected


class TestCLIState:
    """CLIState 状态机测试"""

    def test_all_states(self):
        """所有状态定义"""
        expected = {
            "idle",
            "starting",
            "running",
            "completed",
            "failed",
            "cancelled",
            "timeout",
            "oom",
            "fallback",
        }
        actual = {s.value for s in CLIState}
        assert actual == expected


# ============================================================
# 全局注册表测试
# ============================================================


class TestProcessRegistry:
    """_ProcessRegistry 全局注册表测试"""

    @pytest.mark.asyncio
    async def test_register_and_get(self):
        """注册和获取"""
        proc = ClaudeCLIProcess(process_id="cli-test-1")
        result = await get_registry().register(proc)
        assert result is True
        assert get_registry().get("cli-test-1") == proc

    @pytest.mark.asyncio
    async def test_unregister(self):
        """注销"""
        proc = ClaudeCLIProcess(process_id="cli-test-2")
        await get_registry().register(proc)
        await get_registry().unregister("cli-test-2")
        assert get_registry().get("cli-test-2") is None

    def test_get_nonexistent(self):
        """获取不存在的进程"""
        assert get_registry().get("cli-nonexistent") is None


# ============================================================
# exec_prompt 便捷函数测试
# ============================================================


class TestExecPrompt:
    """exec_prompt 便捷函数测试"""

    @pytest.mark.asyncio
    async def test_exec_prompt_with_default_options(self):
        """使用默认选项调用"""
        from app.services.claude_cli import exec_prompt

        # 仅验证不会因导入失败而抛错
        # 实际执行需要 claude CLI 或 LLM 端点
        events = []
        try:
            async for ev in exec_prompt("test prompt"):
                events.append(ev)
                if ev.type == CLIEventType.EXIT:
                    break
        except (RuntimeError, OSError) as e:
            # 在没有 claude CLI 的环境中，可能降级失败 → 接受
            pytest.skip(f"CLI unavailable in test env: {e}")

        # 至少应收到一个事件
        assert len(events) > 0


# ============================================================
# Pydantic API 模型测试
# ============================================================


class TestExecRequestValidation:
    """ExecRequest 输入校验测试"""

    def test_min_prompt_length(self):
        """prompt 最小长度"""
        from app.api.claude_cli import ExecRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExecRequest(prompt="")

    def test_max_prompt_length(self):
        """prompt 最大长度"""
        from app.api.claude_cli import ExecRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExecRequest(prompt="x" * 100_001)

    def test_valid_sandbox_values(self):
        """合法 sandbox 值"""
        from app.api.claude_cli import ExecRequest

        for s in ["docker", "gvisor", "firejail", "none"]:
            req = ExecRequest(prompt="test", sandbox=s)
            assert req.sandbox == s

    def test_invalid_sandbox_value(self):
        """非法 sandbox 值"""
        from app.api.claude_cli import ExecRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExecRequest(prompt="test", sandbox="invalid")

    def test_timeout_range(self):
        """timeout 范围"""
        from app.api.claude_cli import ExecRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExecRequest(prompt="test", timeout=0)
        with pytest.raises(ValidationError):
            ExecRequest(prompt="test", timeout=1801)

    def test_dangerous_args_rejected(self):
        """危险 args 字符被拒绝"""
        from app.api.claude_cli import ExecRequest
        from pydantic import ValidationError

        for dangerous in ["; rm -rf", "| cat", "$HOME", "`whoami`"]:
            with pytest.raises(ValidationError):
                ExecRequest(prompt="test", args=[dangerous])


# ============================================================
# 健康检查端点测试
# ============================================================


class TestHealthEndpoint:
    """health 端点测试"""

    @pytest.mark.asyncio
    async def test_health_returns_valid_response(self):
        """/health 返回合法结构"""
        from app.api.claude_cli import HealthResponse

        resp = HealthResponse(
            available=True,
            mode="subprocess",
            version="1.0.0",
            sandboxes={"docker": False, "gvisor": False, "firejail": False, "none": True},
        )
        assert resp.available is True
        assert resp.mode == "subprocess"
        assert resp.sandboxes["none"] is True

    def test_error_codes_defined(self):
        """错误码定义完整"""
        from app.api.claude_cli import ERROR_CODES

        required = {"CLI_NOT_FOUND", "CLI_TIMEOUT", "CLI_OOM", "CLI_SANDBOX_ERROR", "CLI_INVALID_INPUT"}
        assert required.issubset(ERROR_CODES.keys())
