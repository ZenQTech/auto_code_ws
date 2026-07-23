"""
# ============================================================
# 后端单元测试 - CLI 集成层、调度器、验证引擎
# ============================================================
# 核心作用：验证 CLI 集成层、调度器、验证引擎的核心功能
# 运行流程：
#   1. 测试 CLIExecutor 的初始化、超时、重试
#   2. 测试 AgentManager 的注册、注销、健康检查
#   3. 测试 StrategyRouter 的复杂度评估和路由
#   4. 测试 TaskScheduler 的调度策略
#   5. 测试 TaskValidator 的基础检查
# 输入参数：无（通过 pytest 运行）
# 输出结果：测试通过/失败报告
# ============================================================
"""

import sys
import os
import asyncio
import pytest
from pathlib import Path

# 确保项目根目录在 Python 路径中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cli_integration.executor import CLIExecutor, CLIResult
from cli_integration.agent_manager import AgentManager, AgentInfo, AgentStatus
from cli_integration.strategy_router import StrategyRouter, ExecutionMode
from backend.app.services.scheduler import TaskScheduler
from backend.app.services.validator import TaskValidator, ValidationResult, ValidationStatus


# ============================================================
# CLIExecutor 测试
# ============================================================

class TestCLIExecutor:
    """CLI 命令执行器测试"""

    def test_init_defaults(self):
        """测试默认初始化参数"""
        executor = CLIExecutor()
        assert executor.executable == "claude"
        assert executor.default_timeout == 600
        assert executor.max_retries == 3
        assert executor.retry_base_delay == 2

    def test_init_custom(self):
        """测试自定义初始化参数"""
        executor = CLIExecutor(
            executable="custom-claude",
            default_timeout=300,
            max_retries=5,
            retry_base_delay=3,
            cli_env={"ANTHROPIC_AUTH_TOKEN": "test-token"},
        )
        assert executor.executable == "custom-claude"
        assert executor.default_timeout == 300
        assert executor.max_retries == 5
        assert executor.cli_env == {"ANTHROPIC_AUTH_TOKEN": "test-token"}

    def test_cli_env_merge(self):
        """测试 CLI 环境变量配置"""
        executor = CLIExecutor(
            cli_env={
                "ANTHROPIC_BASE_URL": "https://ark.cn-beijing.volces.com/api/coding",
                "ANTHROPIC_MODEL": "deepseek-v4-pro[1m]",
            }
        )
        assert "ANTHROPIC_BASE_URL" in executor.cli_env
        assert executor.cli_env["ANTHROPIC_MODEL"] == "deepseek-v4-pro[1m]"

    @pytest.mark.asyncio
    async def test_execute_simple_command(self):
        """测试执行简单命令（echo）"""
        executor = CLIExecutor(executable="echo")
        result = await executor.execute("hello world", timeout=5)
        assert result.success is True
        assert "hello world" in result.stdout
        assert result.exit_code == 0

    @pytest.mark.asyncio
    async def test_execute_timeout(self):
        """测试命令超时处理"""
        executor = CLIExecutor(executable="sleep")
        result = await executor.execute("10", timeout=1)
        assert result.success is False
        assert "超时" in result.error_message

    @pytest.mark.asyncio
    async def test_execute_file_not_found(self):
        """测试可执行文件不存在的情况"""
        executor = CLIExecutor(executable="nonexistent_command_xyz")
        result = await executor.execute("test", timeout=5)
        assert result.success is False
        # shell 将命令不存在转为退出码 127
        assert result.exit_code != 0

    def test_estimate_tokens(self):
        """测试 Token 估算"""
        executor = CLIExecutor()
        # 空文本
        assert executor._estimate_tokens("") == 0
        # 英文文本
        tokens = executor._estimate_tokens("hello world this is a test")
        assert tokens > 0
        # 中文文本
        tokens_cn = executor._estimate_tokens("这是一个测试文本")
        assert tokens_cn > 0

    def test_cli_result_defaults(self):
        """测试 CLIResult 默认值"""
        result = CLIResult()
        assert result.stdout == ""
        assert result.stderr == ""
        assert result.exit_code == -1
        assert result.success is False


# ============================================================
# AgentManager 测试
# ============================================================

class TestAgentManager:
    """智能体管理器测试"""

    def test_register_agent(self):
        """测试注册智能体"""
        manager = AgentManager(health_check_interval=30)
        agent = manager.register_agent(
            name="测试智能体",
            cli_path="claude",
            workspace="/tmp/test",
            max_concurrent=3,
        )
        assert agent.name == "测试智能体"
        assert agent.cli_path == "claude"
        assert agent.max_concurrent == 3
        assert agent.status == AgentStatus.ONLINE
        assert len(agent.avatar_seed) > 0

    def test_get_agent(self):
        """测试获取智能体"""
        manager = AgentManager()
        agent = manager.register_agent(name="Agent1")
        retrieved = manager.get_agent(agent.id)
        assert retrieved is not None
        assert retrieved.name == "Agent1"

    def test_get_nonexistent_agent(self):
        """测试获取不存在的智能体"""
        manager = AgentManager()
        assert manager.get_agent("nonexistent-id") is None

    def test_unregister_agent(self):
        """测试注销智能体"""
        manager = AgentManager()
        agent = manager.register_agent(name="ToRemove")
        assert manager.unregister_agent(agent.id) is True
        assert manager.get_agent(agent.id) is None

    def test_unregister_nonexistent(self):
        """测试注销不存在的智能体"""
        manager = AgentManager()
        assert manager.unregister_agent("nonexistent") is False

    def test_get_all_agents(self):
        """测试获取所有智能体"""
        manager = AgentManager()
        manager.register_agent(name="A1")
        manager.register_agent(name="A2")
        agents = manager.get_all_agents()
        assert len(agents) == 2

    def test_get_available_agents(self):
        """测试获取可用智能体"""
        manager = AgentManager()
        agent = manager.register_agent(name="Available", max_concurrent=1)
        available = manager.get_available_agents()
        assert len(available) == 1
        # 模拟满负载
        manager.increment_task_count(agent.id)
        available_after = manager.get_available_agents()
        assert len(available_after) == 0

    def test_task_count_management(self):
        """测试任务计数管理"""
        manager = AgentManager()
        agent = manager.register_agent(name="Counter", max_concurrent=2)
        assert agent.current_tasks == 0

        manager.increment_task_count(agent.id)
        assert agent.current_tasks == 1

        manager.increment_task_count(agent.id)
        assert agent.current_tasks == 2
        assert agent.status == AgentStatus.BUSY

        manager.decrement_task_count(agent.id)
        assert agent.current_tasks == 1
        assert agent.status == AgentStatus.ONLINE

    def test_token_usage_tracking(self):
        """测试 Token 使用统计"""
        manager = AgentManager()
        agent = manager.register_agent(name="Tracker")
        manager.add_token_usage(agent.id, tokens=1000, api_calls=2)
        assert agent.total_tokens == 1000
        assert agent.total_api_calls == 2

        manager.add_token_usage(agent.id, tokens=500)
        assert agent.total_tokens == 1500
        assert agent.total_api_calls == 3

    def test_status_update(self):
        """测试状态更新"""
        manager = AgentManager()
        agent = manager.register_agent(name="StatusTest")
        manager.update_agent_status(agent.id, AgentStatus.ERROR)
        assert agent.status == AgentStatus.ERROR

    def test_status_change_callback(self):
        """测试状态变更回调"""
        manager = AgentManager()
        callback_calls = []

        def callback(agent_id, status):
            callback_calls.append((agent_id, status))

        manager.on_status_change(callback)
        agent = manager.register_agent(name="CallbackTest")
        manager.update_agent_status(agent.id, AgentStatus.BUSY)

        assert len(callback_calls) >= 2  # 注册时 + 状态变更时


# ============================================================
# StrategyRouter 测试
# ============================================================

class TestStrategyRouter:
    """执行策略路由器测试"""

    def test_direct_mode_low_complexity(self):
        """测试低复杂度 -> 直接执行模式"""
        router = StrategyRouter()
        strategy = router.route("写一个 hello world 函数", 0.1)
        assert strategy.mode == ExecutionMode.DIRECT

    def test_subagent_mode_medium_complexity(self):
        """测试中等复杂度 -> Subagent 模式"""
        router = StrategyRouter()
        strategy = router.route("创建一个完整的用户认证系统", 0.5)
        assert strategy.mode == ExecutionMode.SUBAGENT

    def test_agent_team_mode_high_complexity(self):
        """测试高复杂度 -> Agent Team 模式"""
        router = StrategyRouter()
        strategy = router.route("设计并开发一个分布式微服务架构平台", 0.9)
        assert strategy.mode == ExecutionMode.AGENT_TEAM

    def test_complexity_clamping(self):
        """测试复杂度评分边界限制"""
        router = StrategyRouter()
        # 负值应被限制为 0
        s1 = router.route("test", -0.5)
        assert s1.mode == ExecutionMode.DIRECT
        # 超过 1 应被限制为 1
        s2 = router.route("test", 1.5)
        assert s2.mode == ExecutionMode.AGENT_TEAM

    def test_estimate_complexity_empty(self):
        """测试空文本复杂度评估"""
        router = StrategyRouter()
        score = router.estimate_complexity("")
        assert 0.0 <= score <= 1.0

    def test_estimate_complexity_simple(self):
        """测试简单任务复杂度评估"""
        router = StrategyRouter()
        score = router.estimate_complexity("写一个函数")
        assert 0.0 <= score <= 0.3

    def test_estimate_complexity_complex(self):
        """测试复杂任务复杂度评估"""
        router = StrategyRouter()
        score = router.estimate_complexity(
            "设计一个完整的分布式系统架构，包含微服务、数据库、安全认证、权限管理"
        )
        assert score > 0.3  # 应该被识别为复杂任务

    def test_strategy_reasoning(self):
        """测试策略原因说明"""
        router = StrategyRouter()
        strategy = router.route("test task", 0.1)
        assert len(strategy.reasoning) > 0
        assert "直接执行" in strategy.reasoning


# ============================================================
# TaskScheduler 测试
# ============================================================

class TestTaskScheduler:
    """任务调度器测试"""

    def test_least_loaded_strategy(self):
        """测试最少负载策略"""
        manager = AgentManager()
        a1 = manager.register_agent(name="A1", max_concurrent=5)
        a2 = manager.register_agent(name="A2", max_concurrent=5)
        # A1 已有 3 个任务
        manager.increment_task_count(a1.id)
        manager.increment_task_count(a1.id)
        manager.increment_task_count(a1.id)

        scheduler = TaskScheduler(manager, strategy="least_loaded")
        # 可用智能体列表
        available = manager.get_available_agents()
        chosen = scheduler._least_loaded(available)
        # 应选择负载更少的 A2
        assert chosen.id == a2.id

    def test_manual_assign(self):
        """测试手动指派"""
        manager = AgentManager()
        agent = manager.register_agent(name="ManualTarget", max_concurrent=5)
        scheduler = TaskScheduler(manager)
        result = scheduler.assign_manual("task-1", agent.id)
        assert result.success is True
        assert result.agent_id == agent.id

    def test_manual_assign_nonexistent(self):
        """测试手动指派到不存在的智能体"""
        manager = AgentManager()
        scheduler = TaskScheduler(manager)
        result = scheduler.assign_manual("task-1", "nonexistent")
        assert result.success is False

    def test_manual_assign_full(self):
        """测试手动指派到满负载智能体"""
        manager = AgentManager()
        agent = manager.register_agent(name="FullAgent", max_concurrent=1)
        manager.increment_task_count(agent.id)
        scheduler = TaskScheduler(manager)
        result = scheduler.assign_manual("task-1", agent.id)
        assert result.success is False

    def test_release_agent(self):
        """测试释放智能体"""
        manager = AgentManager()
        agent = manager.register_agent(name="ReleaseTest", max_concurrent=2)
        manager.increment_task_count(agent.id)
        assert agent.current_tasks == 1
        scheduler = TaskScheduler(manager)
        scheduler.release_agent(agent.id)
        assert agent.current_tasks == 0

    @pytest.mark.asyncio
    async def test_assign_tasks_no_agents(self):
        """测试无可用智能体时的任务分配"""
        manager = AgentManager()
        scheduler = TaskScheduler(manager)
        results = await scheduler.assign_tasks(["task-1", "task-2"])
        assert len(results) == 2
        assert all(not r.success for r in results)


# ============================================================
# TaskValidator 测试
# ============================================================

class TestTaskValidator:
    """任务验证器测试"""

    def test_basic_check_empty_output(self):
        """测试空输出检测"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        issues = validator._basic_check("")
        assert isinstance(issues, list)

    def test_basic_check_error_keywords(self):
        """测试错误关键词检测"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        issues = validator._basic_check("Error: something went wrong\nTraceback: ...")
        assert len(issues) > 0
        assert any("error" in i.description.lower() for i in issues)

    def test_basic_check_incomplete(self):
        """测试不完整标记检测"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        issues = validator._basic_check("TODO: implement this later...")
        assert len(issues) > 0

    def test_basic_check_clean_output(self):
        """测试干净输出"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        issues = validator._basic_check("Task completed successfully. All tests passed.")
        assert len(issues) == 0

    @pytest.mark.asyncio
    async def test_validate_empty_output(self):
        """测试空输出验证"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        result = await validator.validate("test task", "")
        assert result.status == ValidationStatus.FAILED
        assert result.needs_iteration is True

    @pytest.mark.asyncio
    async def test_validate_with_errors(self):
        """测试包含错误的输出验证"""
        validator = TaskValidator(CLIExecutor(executable="echo"))
        result = await validator.validate(
            "test task",
            "SyntaxError: invalid syntax at line 10\nFailed to compile"
        )
        assert result.status in (ValidationStatus.NEEDS_FIX, ValidationStatus.FAILED)
        assert result.needs_iteration is True


# ============================================================
# 运行入口
# ============================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
