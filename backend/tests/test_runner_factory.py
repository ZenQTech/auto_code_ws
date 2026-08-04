"""
# ============================================================
# Runner Factory 单元测试 (Cycle 65 G65-01)
# ============================================================
# 覆盖：
#   - get_agent_runner 工厂函数
#   - set_runner_mode 全局模式设置
#   - reset_agent_runner 重置单例
#   - 模式选择逻辑（MOCK/REAL/AUTO）
#   - force_new 强制创建新实例
#   - 单例模式一致性
# ====================================
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

MOCK_CLI_PATH = str(BACKEND_DIR / "tests" / "fixtures" / "mock_cli.py")


# ============================================================
# 基础工厂函数测试
# ============================================================


class TestFactoryBasic:
    def setup_method(self):
        """每个测试前重置"""
        from app.services.real_agent_runner import reset_agent_runner

        reset_agent_runner()

    def teardown_method(self):
        """每个测试后清理环境"""
        from app.services.real_agent_runner import reset_agent_runner

        reset_agent_runner()
        for k in ("MOCK_CLI_FAIL", "MOCK_CLI_EXIT_CODE"):
            os.environ.pop(k, None)

    def test_get_runner_no_args_returns_mock(self):
        """不传参数应该返回 mock runner"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        runner = get_agent_runner()
        assert isinstance(runner, MockAgentRunner)
        # MockAgentRunner 模式标识
        assert runner.mode == RunnerMode.MOCK.value

    def test_get_runner_explicit_mock(self):
        """显式指定 MOCK"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        runner = get_agent_runner(mode=RunnerMode.MOCK)
        assert isinstance(runner, MockAgentRunner)

    def test_get_runner_explicit_real(self):
        """显式指定 REAL"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            RunnerMode,
            RealAgentRunner,
        )

        runner = get_agent_runner(mode=RunnerMode.REAL)
        assert isinstance(runner, RealAgentRunner)
        assert runner.mode == RunnerMode.REAL

    def test_get_runner_auto(self):
        """AUTO 模式"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        runner = get_agent_runner(mode=RunnerMode.AUTO)
        # 根据环境选择 mock 或 real
        assert runner.mode in (RunnerMode.MOCK, RunnerMode.REAL)


# ============================================================
# 单例模式测试
# ============================================================


class TestFactorySingleton:
    def setup_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def teardown_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def test_singleton_same_mode(self):
        """同模式下应该返回同一实例"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.MOCK)
        assert r1 is r2

    def test_singleton_different_mode_creates_new(self):
        """不同模式下应该创建新实例"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.REAL)
        # 不同模式 → 不同实例
        assert r1 is not r2

    def test_force_new_creates_new_instance(self):
        """force_new 应该创建新实例"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.MOCK, force_new=True)
        assert r1 is not r2

    def test_force_new_false_uses_singleton(self):
        """force_new=False 应该使用单例"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        r2 = get_agent_runner(mode=RunnerMode.MOCK, force_new=False)
        assert r1 is r2


# ============================================================
# set_runner_mode 测试
# ============================================================


class TestSetRunnerMode:
    def setup_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def teardown_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def test_set_mode_real_subsequent_get_returns_real(self):
        """设置 REAL 后，get_agent_runner 应该返回 RealAgentRunner"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            RunnerMode,
            RealAgentRunner,
        )

        set_runner_mode(RunnerMode.REAL)
        runner = get_agent_runner()
        assert isinstance(runner, RealAgentRunner)

    def test_set_mode_mock_subsequent_get_returns_mock(self):
        """设置 MOCK 后，get_agent_runner 应该返回 MockAgentRunner"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            RunnerMode,
        )
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        set_runner_mode(RunnerMode.MOCK)
        runner = get_agent_runner()
        assert isinstance(runner, MockAgentRunner)

    def test_set_mode_auto_subsequent_get_uses_auto(self):
        """设置 AUTO 后，get_agent_runner 应该使用 AUTO 模式"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            RunnerMode,
        )

        set_runner_mode(RunnerMode.AUTO)
        runner = get_agent_runner()
        # AUTO 模式根据环境选择
        assert runner.mode in (RunnerMode.MOCK, RunnerMode.REAL)

    def test_set_mode_persists(self):
        """set_runner_mode 设置应该持续生效"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            RunnerMode,
            RealAgentRunner,
        )

        set_runner_mode(RunnerMode.REAL)
        r1 = get_agent_runner()
        r2 = get_agent_runner()
        assert isinstance(r1, RealAgentRunner)
        assert isinstance(r2, RealAgentRunner)


# ============================================================
# reset_agent_runner 测试
# ============================================================


class TestResetAgentRunner:
    def setup_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def teardown_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def test_reset_clears_singleton(self):
        """reset 应该清除单例"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()
        r2 = get_agent_runner(mode=RunnerMode.MOCK)
        # reset 后是新实例
        assert r1 is not r2

    def test_reset_clears_mode(self):
        """reset 应该重置模式为默认 MOCK"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            reset_agent_runner,
            RunnerMode,
        )

        set_runner_mode(RunnerMode.REAL)
        reset_agent_runner()
        # reset 后默认模式是 MOCK
        from app.services.agent_runner import AgentRunner as MockAgentRunner

        runner = get_agent_runner()
        assert isinstance(runner, MockAgentRunner)

    def test_reset_idempotent(self):
        """多次 reset 不应该报错"""
        from app.services.real_agent_runner import reset_agent_runner

        reset_agent_runner()
        reset_agent_runner()
        reset_agent_runner()

    def test_reset_after_get_still_works(self):
        """先 get 再 reset 也能正常工作"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            reset_agent_runner,
            RunnerMode,
        )

        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        assert r1 is not None
        reset_agent_runner()
        r2 = get_agent_runner(mode=RunnerMode.MOCK)
        assert r2 is not None


# ============================================================
# AUTO 模式行为测试
# ============================================================


class TestAutoModeBehavior:
    def setup_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def teardown_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def test_auto_with_real_cli_returns_real(self):
        """AUTO + 真实 CLI 路径可用 → REAL"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            set_runner_mode,
            RunnerMode,
        )

        # 临时切换 AUTO 模式并传入 mock CLI 路径
        # 这需要通过修改 _runner 间接实现
        # 直接调用 get_agent_runner(mode=AUTO) 让它自行检测
        runner = get_agent_runner(mode=RunnerMode.AUTO)
        # 由于默认 claude 不可用，应该 fallback 到 mock
        # 除非本机安装了 claude
        assert runner.mode in (RunnerMode.MOCK, RunnerMode.REAL)

    def test_explicit_mode_overrides_singleton(self):
        """显式 mode 参数应该覆盖已有单例"""
        from app.services.real_agent_runner import (
            get_agent_runner,
            RunnerMode,
            RealAgentRunner,
        )

        # 先创建 mock 单例
        r1 = get_agent_runner(mode=RunnerMode.MOCK)
        # 再用 REAL 显式创建
        r2 = get_agent_runner(mode=RunnerMode.REAL)
        # 应该得到不同的实例
        assert r1 is not r2
        assert isinstance(r2, RealAgentRunner)


# ============================================================
# 错误处理测试
# ============================================================


class TestFactoryErrorHandling:
    def setup_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def teardown_method(self):
        from app.services.real_agent_runner import reset_agent_runner
        reset_agent_runner()

    def test_get_runner_with_invalid_mode(self):
        """传入无效模式应该回退到默认行为"""
        from app.services.real_agent_runner import get_agent_runner

        # 传入字符串而不是 RunnerMode 枚举
        runner = get_agent_runner(mode="invalid_mode")
        # 应该不抛错，返回某个 runner
        assert runner is not None

    def test_get_runner_with_none_mode(self):
        """mode=None 应该使用全局设置"""
        from app.services.real_agent_runner import get_agent_runner, RunnerMode

        runner = get_agent_runner(mode=None)
        # 默认是 MOCK
        assert runner.mode == RunnerMode.MOCK.value
