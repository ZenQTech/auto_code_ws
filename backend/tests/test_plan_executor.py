"""
# ============================================================
# PlanExecutor 服务单元测试 (v1.0.0)
# Cycle 61 G61-04
# ============================================================
# 测试覆盖：
#   - LLMCaller 抽象 + DefaultLLMCaller
#   - PlanExecutorConfig 默认值
#   - 各类 action handlers:
#     * noop / llm_call / run_shell / edit_file / read_file / write_file
#     * verify_command / composite
#   - 进度回调
#   - 全局单例
#   - 死循环防护（max_total_steps）
#   - 超时处理
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
# ====================================
"""

import sys
import os
import tempfile
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.plan_executor import (
    DefaultLLMCaller,
    LLMCaller,
    PlanExecutor,
    PlanExecutorConfig,
    get_executor,
    reset_executor,
    set_executor,
)
from app.services.composer_plan import ComposerStep, get_action_handler


# ============================================================
# LLMCaller 测试
# ============================================================


class TestDefaultLLMCaller:
    """DefaultLLMCaller 测试"""

    @pytest.mark.asyncio
    async def test_call_returns_mock_text(self):
        caller = DefaultLLMCaller()
        result = await caller.call("hello")
        assert "mock-llm" in result
        assert "prompt_len" in result

    @pytest.mark.asyncio
    async def test_call_with_all_params(self):
        caller = DefaultLLMCaller()
        result = await caller.call(
            prompt="test prompt",
            system="be helpful",
            max_tokens=1024,
            timeout=30,
            model="claude-3",
        )
        assert "max_tokens=1024" in result


# ============================================================
# PlanExecutorConfig 测试
# ============================================================


class TestPlanExecutorConfig:
    """PlanExecutorConfig 测试"""

    def test_default_values(self):
        cfg = PlanExecutorConfig()
        assert cfg.default_llm_timeout == 120
        assert cfg.default_shell_timeout == 60
        assert cfg.max_total_steps_per_plan == 200
        assert cfg.progress_throttle_ms == 100
        assert cfg.enable_sandbox is False

    def test_to_dict(self):
        cfg = PlanExecutorConfig(default_llm_timeout=60)
        d = cfg.to_dict()
        assert d["default_llm_timeout"] == 60
        assert d["default_shell_timeout"] == 60
        assert d["max_total_steps_per_plan"] == 200


# ============================================================
# PlanExecutor 基本测试
# ============================================================


class TestPlanExecutorBasic:
    """PlanExecutor 基本功能测试"""

    def test_init_with_defaults(self):
        executor = PlanExecutor()
        assert isinstance(executor.llm_caller, DefaultLLMCaller)
        assert executor.config is not None

    def test_init_with_custom_llm(self):
        caller = DefaultLLMCaller()
        executor = PlanExecutor(llm_caller=caller)
        assert executor.llm_caller is caller

    def test_init_with_custom_config(self):
        cfg = PlanExecutorConfig(default_llm_timeout=30)
        executor = PlanExecutor(config=cfg)
        assert executor.config.default_llm_timeout == 30

    def test_builtin_handlers_registered(self):
        executor = PlanExecutor()
        for action in ["llm_call", "run_shell", "edit_file", "read_file",
                       "write_file", "verify_command", "composite", "noop"]:
            handler = get_action_handler(action)
            assert handler is not None, f"{action} handler not registered"


# ============================================================
# 各类 action handler 测试
# ============================================================


class TestNoopHandler:
    """noop handler 测试"""

    @pytest.mark.asyncio
    async def test_noop_returns_dict(self):
        executor = PlanExecutor()
        step = ComposerStep(step_id="s1", title="t", action="noop")
        ctx = {"plan_id": "p1", "step_id": "s1", "metadata": {}}
        result = await executor._handle_noop(step, ctx)
        assert result["action"] == "noop"
        assert result["noop"] is True


class TestLLMCallHandler:
    """llm_call handler 测试"""

    @pytest.mark.asyncio
    async def test_llm_call_success(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="call llm", action="llm_call",
            params={"prompt": "hello", "max_tokens": 100},
        )
        ctx = {"plan_id": "p1", "step_id": "s1", "metadata": {}}
        result = await executor._handle_llm_call(step, ctx)
        assert "output_text" in result
        assert result["action"] == "llm_call"
        assert result["prompt_tokens"] == len("hello")

    @pytest.mark.asyncio
    async def test_llm_call_uses_description_as_prompt(self):
        """当 params.prompt 为空时，使用 description"""
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="call llm", action="llm_call",
            description="fallback prompt",
            params={},
        )
        ctx = {"plan_id": "p1", "step_id": "s1", "metadata": {}}
        result = await executor._handle_llm_call(step, ctx)
        assert "output_text" in result

    @pytest.mark.asyncio
    async def test_llm_call_raises_when_no_prompt(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="", description="", action="llm_call", params={},
        )
        with pytest.raises(ValueError, match="prompt"):
            await executor._handle_llm_call(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_llm_call_custom_caller(self):
        class CustomCaller(LLMCaller):
            async def call(self, prompt, system="", max_tokens=4096, timeout=120, model=""):
                return f"custom: {prompt}"

        executor = PlanExecutor(llm_caller=CustomCaller())
        step = ComposerStep(
            step_id="s1", title="t", action="llm_call",
            params={"prompt": "x"},
        )
        result = await executor._handle_llm_call(step, {"plan_id": "p1"})
        assert result["output_text"] == "custom: x"


class TestShellHandler:
    """run_shell handler 测试"""

    @pytest.mark.asyncio
    async def test_shell_success(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="run_shell",
            params={"command": "echo hello", "timeout": 5},
        )
        result = await executor._handle_run_shell(step, {"plan_id": "p1"})
        assert result["returncode"] == 0
        assert "hello" in result["stdout"]

    @pytest.mark.asyncio
    async def test_shell_missing_command_raises(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="run_shell", params={},
        )
        with pytest.raises(ValueError, match="command"):
            await executor._handle_run_shell(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_shell_nonzero_return_raises(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="run_shell",
            params={"command": "exit 1", "timeout": 5},
        )
        with pytest.raises(RuntimeError, match="shell command failed"):
            await executor._handle_run_shell(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_shell_timeout(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="run_shell",
            params={"command": "sleep 10", "timeout": 1},
        )
        with pytest.raises(TimeoutError, match="timeout"):
            await executor._handle_run_shell(step, {"plan_id": "p1"})


class TestFileHandlers:
    """文件操作 handler 测试"""

    @pytest.mark.asyncio
    async def test_write_file(self):
        executor = PlanExecutor()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            tmp = f.name
        try:
            step = ComposerStep(
                step_id="s1", title="t", action="write_file",
                params={"path": tmp, "content": "hello world"},
            )
            result = await executor._handle_write_file(step, {"plan_id": "p1"})
            assert result["size"] == 11
            with open(tmp, "r") as f:
                assert f.read() == "hello world"
        finally:
            os.unlink(tmp)

    @pytest.mark.asyncio
    async def test_read_file(self):
        executor = PlanExecutor()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            tmp = f.name
            f.write("read me")
        try:
            step = ComposerStep(
                step_id="s1", title="t", action="read_file",
                params={"path": tmp},
            )
            result = await executor._handle_read_file(step, {"plan_id": "p1"})
            assert result["content"] == "read me"
        finally:
            os.unlink(tmp)

    @pytest.mark.asyncio
    async def test_read_file_not_found(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="read_file",
            params={"path": "/tmp/does-not-exist-12345"},
        )
        with pytest.raises(FileNotFoundError):
            await executor._handle_read_file(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_edit_file_old_new(self):
        executor = PlanExecutor()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            tmp = f.name
            f.write("hello world")
        try:
            step = ComposerStep(
                step_id="s1", title="t", action="edit_file",
                params={"path": tmp, "old_text": "world", "new_text": "pytest"},
            )
            result = await executor._handle_edit_file(step, {"plan_id": "p1"})
            with open(tmp, "r") as f:
                assert f.read() == "hello pytest"
            assert result["diff_chars"] == len("pytest") - len("world")
        finally:
            os.unlink(tmp)

    @pytest.mark.asyncio
    async def test_edit_file_replacements(self):
        executor = PlanExecutor()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            tmp = f.name
            f.write("aaa bbb aaa ccc")
        try:
            step = ComposerStep(
                step_id="s1", title="t", action="edit_file",
                params={
                    "path": tmp,
                    "replacements": [
                        {"old_text": "aaa", "new_text": "xxx"},
                        {"old_text": "bbb", "new_text": "yyy"},
                    ],
                },
            )
            await executor._handle_edit_file(step, {"plan_id": "p1"})
            with open(tmp, "r") as f:
                assert f.read() == "xxx yyy aaa ccc"  # 只替换第一个 aaa
        finally:
            os.unlink(tmp)

    @pytest.mark.asyncio
    async def test_edit_file_missing_old_text(self):
        executor = PlanExecutor()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            tmp = f.name
            f.write("foo")
        try:
            step = ComposerStep(
                step_id="s1", title="t", action="edit_file",
                params={"path": tmp, "old_text": "bar", "new_text": "baz"},
            )
            with pytest.raises(ValueError, match="not found"):
                await executor._handle_edit_file(step, {"plan_id": "p1"})
        finally:
            os.unlink(tmp)


class TestVerifyCommandHandler:
    """verify_command handler 测试"""

    @pytest.mark.asyncio
    async def test_verify_success(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="verify_command",
            params={"command": "echo 'verify ok'", "expected": "verify", "timeout": 5},
        )
        result = await executor._handle_verify_command(step, {"plan_id": "p1"})
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_verify_expected_not_found(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="verify_command",
            params={"command": "echo hello", "expected": "missing", "timeout": 5},
        )
        with pytest.raises(AssertionError, match="断言失败"):
            await executor._handle_verify_command(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_verify_returncode_nonzero(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="verify_command",
            params={"command": "false", "timeout": 5},
        )
        with pytest.raises(AssertionError, match="returncode"):
            await executor._handle_verify_command(step, {"plan_id": "p1"})


class TestCompositeHandler:
    """composite handler 测试"""

    @pytest.mark.asyncio
    async def test_composite_serial(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="composite",
            params={
                "children": [
                    {"step_id": "sub1", "title": "Sub 1", "action": "noop"},
                    {"step_id": "sub2", "title": "Sub 2", "action": "noop"},
                ]
            },
        )
        result = await executor._handle_composite(step, {"plan_id": "p1"})
        assert result["children_count"] == 2
        assert len(result["children_results"]) == 2

    @pytest.mark.asyncio
    async def test_composite_empty_children(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="composite", params={},
        )
        with pytest.raises(ValueError, match="children"):
            await executor._handle_composite(step, {"plan_id": "p1"})

    @pytest.mark.asyncio
    async def test_composite_invalid_children_type(self):
        executor = PlanExecutor()
        step = ComposerStep(
            step_id="s1", title="t", action="composite",
            params={"children": "not a list"},
        )
        with pytest.raises(ValueError, match="list"):
            await executor._handle_composite(step, {"plan_id": "p1"})


# ============================================================
# 进度回调测试
# ============================================================


class TestProgressCallback:
    """进度回调测试"""

    @pytest.mark.asyncio
    async def test_progress_callback_called(self):
        events = []

        async def cb(event_type, data):
            events.append((event_type, data))

        executor = PlanExecutor(progress_callback=cb)
        step = ComposerStep(
            step_id="s1", title="t", action="noop",
        )
        await executor._handle_noop(step, {"plan_id": "p1"})
        # noop handler 不推送进度
        assert events == []

    @pytest.mark.asyncio
    async def test_progress_callback_on_llm(self):
        events = []

        async def cb(event_type, data):
            events.append((event_type, data))

        executor = PlanExecutor(progress_callback=cb)
        step = ComposerStep(
            step_id="s1", title="t", action="llm_call",
            params={"prompt": "test"},
        )
        await executor._handle_llm_call(step, {"plan_id": "p1"})
        # 应该有 log + progress 事件
        assert len(events) > 0
        event_types = [e[0] for e in events]
        assert "step_log" in event_types
        assert "step_progress" in event_types

    @pytest.mark.asyncio
    async def test_progress_callback_swallows_errors(self):
        async def bad_cb(event_type, data):
            raise RuntimeError("callback failed")

        executor = PlanExecutor(progress_callback=bad_cb)
        step = ComposerStep(
            step_id="s1", title="t", action="llm_call",
            params={"prompt": "test"},
        )
        # 不应抛异常
        await executor._handle_llm_call(step, {"plan_id": "p1"})


# ============================================================
# 全局单例测试
# ============================================================


class TestGlobalExecutor:
    """全局单例测试"""

    def test_get_executor_returns_singleton(self):
        reset_executor()
        e1 = get_executor()
        e2 = get_executor()
        assert e1 is e2

    def test_set_executor_replaces_global(self):
        reset_executor()
        original = get_executor()
        new_exec = PlanExecutor(config=PlanExecutorConfig(default_llm_timeout=10))
        set_executor(new_exec)
        assert get_executor() is new_exec
        # 清理
        set_executor(original)
        reset_executor()
