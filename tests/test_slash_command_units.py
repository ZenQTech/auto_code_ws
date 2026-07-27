"""
# ============================================================
# Cycle 8 P0-12: Slash Commands 单元测试
# ============================================================
# 测试覆盖：
#   - T1: SlashCommandRegistry 注册/查询/搜索
#   - T2: SlashCommandExecutor 执行/参数验证
#   - T3: 18 个内置命令全部可执行
#   - T4: API 端点响应格式
#   - T5: 错误处理（未知命令/缺少参数/无效参数）
# 创建日期：2026-07-27
# 测试数：30 个
# ============================================================
"""

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List

# 添加项目根路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.app.services.slash_command_registry import (
    CommandCategory,
    SlashCommand,
    SlashCommandArg,
    SlashCommandRegistry,
)
from backend.app.services.slash_command_executor import (
    ExecutionContext,
    ExecutionResult,
    ExecutionStatus,
    SlashCommandExecutor,
)


# ============================================================
# T1: SlashCommandRegistry 测试
# ============================================================
class TestSlashCommandRegistry(unittest.TestCase):
    """T1: 注册表核心功能测试"""

    def setUp(self):
        self.registry = SlashCommandRegistry()

    def test_T1_01_has_18_builtin_commands(self):
        """T1-01: 至少 18 个内置命令"""
        cmds = self.registry.list_all(enabled_only=False)
        self.assertGreaterEqual(len(cmds), 18, f"实际: {len(cmds)}")

    def test_T1_02_all_commands_have_name_and_handler(self):
        """T1-02: 所有命令都有 name + handler"""
        for cmd in self.registry.list_all(enabled_only=False):
            self.assertTrue(cmd.name, f"命令缺少 name: {cmd}")
            self.assertTrue(cmd.handler, f"命令 {cmd.name} 缺少 handler")

    def test_T1_03_get_by_name(self):
        """T1-03: 按名称获取命令"""
        cmd = self.registry.get("plan")
        self.assertIsNotNone(cmd)
        self.assertEqual(cmd.name, "plan")
        self.assertEqual(cmd.category, CommandCategory.MODE)

    def test_T1_04_get_unknown_returns_none(self):
        """T1-04: 获取未知命令返回 None"""
        cmd = self.registry.get("notexist")
        self.assertIsNone(cmd)

    def test_T1_05_search_by_name(self):
        """T1-05: 按名称搜索"""
        results = self.registry.search("plan")
        self.assertGreater(len(results), 0)
        names = [c.name for c in results]
        self.assertIn("plan", names)

    def test_T1_06_search_by_description(self):
        """T1-06: 按描述搜索"""
        results = self.registry.search("代码审查")
        # 至少应返回 /review
        names = [c.name for c in results]
        self.assertTrue(any("review" in n for n in names))

    def test_T1_07_list_by_category(self):
        """T1-07: 按分类列出命令"""
        mode_cmds = self.registry.list_by_category(CommandCategory.MODE)
        for cmd in mode_cmds:
            self.assertEqual(cmd.category, CommandCategory.MODE)
        self.assertGreater(len(mode_cmds), 0)

    def test_T1_08_summary_has_all_keys(self):
        """T1-08: 摘要包含所有关键字段"""
        summary = self.registry.summary()
        for key in ["total", "enabled", "disabled", "built_in", "custom", "by_category"]:
            self.assertIn(key, summary)
        self.assertGreater(summary["total"], 0)
        self.assertEqual(summary["enabled"], summary["total"])  # 全部默认启用

    def test_T1_09_register_custom_command(self):
        """T1-09: 注册自定义命令"""
        custom = SlashCommand(
            name="mycustom",
            description="测试自定义命令",
            category=CommandCategory.CUSTOM,
            handler="custom_handler",
        )
        self.registry.register(custom)
        cmd = self.registry.get("mycustom")
        self.assertIsNotNone(cmd)
        self.assertEqual(cmd.category, CommandCategory.CUSTOM)

    def test_T1_10_unregister(self):
        """T1-10: 注销命令"""
        custom = SlashCommand(
            name="tempreg",
            description="临时",
            category=CommandCategory.CUSTOM,
        )
        self.registry.register(custom)
        self.assertIsNotNone(self.registry.get("tempreg"))
        result = self.registry.unregister("tempreg")
        self.assertTrue(result)
        self.assertIsNone(self.registry.get("tempreg"))

    def test_T1_11_alias_lookup(self):
        """T1-11: 别名查找"""
        custom = SlashCommand(
            name="alpha",
            description="带别名",
            aliases=["a", "α"],
        )
        self.registry.register(custom)
        self.assertIsNotNone(self.registry.get("a"))
        self.assertIsNotNone(self.registry.get("α"))
        self.assertIsNotNone(self.registry.get("alpha"))


# ============================================================
# T2: SlashCommandExecutor 测试
# ============================================================
class TestSlashCommandExecutor(unittest.TestCase):
    """T2: 执行器测试"""

    def setUp(self):
        self.executor = SlashCommandExecutor()
        self.context = ExecutionContext(
            user_id="user-1",
            session_id="session-1",
            app_mode="coding",
        )

    def test_T2_01_execute_plan(self):
        """T2-01: 执行 /plan 命令"""
        result = self.executor.execute("plan", ["实现 OAuth 2.1"], self.context)
        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertEqual(result.command, "plan")
        self.assertIn("action", result.data)
        self.assertEqual(result.data["action"], "open_plan_modal")
        self.assertEqual(result.data["task"], "实现 OAuth 2.1")

    def test_T2_02_execute_unknown_returns_failed(self):
        """T2-02: 执行未知命令返回 FAILED"""
        result = self.executor.execute("notexist", [], self.context)
        self.assertEqual(result.status, ExecutionStatus.FAILED)
        self.assertIsNotNone(result.error)

    def test_T2_03_execute_with_required_args(self):
        """T2-03: 缺少必填参数时返回 FAILED"""
        result = self.executor.execute("goal", [], self.context)
        self.assertEqual(result.status, ExecutionStatus.FAILED)
        # 错误信息应在 message 中（包含 goal 关键字）
        self.assertIn("goal", result.message or "")

    def test_T2_04_execute_with_invalid_choices(self):
        """T2-04: 参数不在 choices 时返回 FAILED"""
        result = self.executor.execute("approvals", ["invalid_mode"], self.context)
        self.assertEqual(result.status, ExecutionStatus.FAILED)

    def test_T2_05_execute_approvals_valid_mode(self):
        """T2-05: /approvals 接受有效模式"""
        for mode in ["ask", "auto", "sandbox"]:
            result = self.executor.execute("approvals", [mode], self.context)
            self.assertEqual(result.status, ExecutionStatus.SUCCESS)
            self.assertEqual(result.data["mode"], mode)

    def test_T2_06_execute_loop_with_action(self):
        """T2-06: /loop 接受有效 action"""
        for action in ["triage", "plan", "execute", "verify"]:
            result = self.executor.execute("loop", [action], self.context)
            self.assertEqual(result.status, ExecutionStatus.SUCCESS)
            self.assertEqual(result.data["loop_action"], action)

    def test_T2_07_execute_loop_missing_action(self):
        """T2-07: /loop 缺少 action"""
        result = self.executor.execute("loop", [], self.context)
        self.assertEqual(result.status, ExecutionStatus.FAILED)

    def test_T2_08_execute_help(self):
        """T2-08: /help 返回所有命令列表"""
        result = self.executor.execute("help", [], self.context)
        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertGreater(len(result.data["commands"]), 0)

    def test_T2_09_history_tracks_executions(self):
        """T2-09: 执行历史记录执行"""
        self.executor.clear_history()
        self.assertEqual(len(self.executor.get_history()), 0)
        self.executor.execute("new", [], self.context)
        self.executor.execute("status", [], self.context)
        history = self.executor.get_history()
        self.assertEqual(len(history), 2)
        # 历史是追加模式：最新的在末尾
        self.assertEqual(history[0].command, "new")
        self.assertEqual(history[-1].command, "status")

    def test_T2_10_clear_history(self):
        """T2-10: 清空历史"""
        self.executor.execute("new", [], self.context)
        self.executor.clear_history()
        self.assertEqual(len(self.executor.get_history()), 0)

    def test_T2_11_disabled_command_returns_failed(self):
        """T2-11: 禁用的命令返回 FAILED"""
        cmd = self.executor._registry.get("status")
        original = cmd.enabled
        cmd.enabled = False
        try:
            result = self.executor.execute("status", [], self.context)
            self.assertEqual(result.status, ExecutionStatus.FAILED)
        finally:
            cmd.enabled = original  # 恢复

    def test_T2_12_result_has_duration(self):
        """T2-12: 结果包含耗时"""
        result = self.executor.execute("new", [], self.context)
        self.assertGreaterEqual(result.duration_ms, 0)


# ============================================================
# T3: 18 个内置命令全部可执行
# ============================================================
class TestAllBuiltinsExecute(unittest.TestCase):
    """T3: 所有内置命令应可成功执行"""

    def setUp(self):
        self.executor = SlashCommandExecutor()
        self.context = ExecutionContext(
            user_id="user-test",
            session_id="session-test",
        )

    def _test_command(self, name: str, args: List[str] = None):
        result = self.executor.execute(name, args or [], self.context)
        self.assertEqual(
            result.status,
            ExecutionStatus.SUCCESS,
            f"命令 /{name} 执行失败: {result.error} | {result.message}",
        )

    def test_T3_01_init(self):
        self._test_command("init")

    def test_T3_02_status(self):
        self._test_command("status")

    def test_T3_03_plan(self):
        self._test_command("plan", ["test task"])

    def test_T3_04_spec(self):
        self._test_command("spec", ["test spec"])

    def test_T3_05_review(self):
        self._test_command("review")

    def test_T3_06_mcp(self):
        self._test_command("mcp")

    def test_T3_07_agents(self):
        self._test_command("agents")

    def test_T3_08_skills(self):
        self._test_command("skills")

    def test_T3_09_hooks(self):
        self._test_command("hooks")

    def test_T3_10_model(self):
        self._test_command("model")

    def test_T3_11_approvals(self):
        self._test_command("approvals")

    def test_T3_12_help(self):
        self._test_command("help")

    def test_T3_13_next(self):
        self._test_command("next")

    def test_T3_14_goal(self):
        self._test_command("goal", ["实现 OAuth 2.1 授权"])

    def test_T3_15_new(self):
        self._test_command("new")

    def test_T3_16_resume(self):
        self._test_command("resume")

    def test_T3_17_diff(self):
        self._test_command("diff")

    def test_T3_18_loop(self):
        self._test_command("loop", ["triage"])


# ============================================================
# T4: 单例测试
# ============================================================
class TestSingletonBehavior(unittest.TestCase):
    """T4: 单例模式测试"""

    def test_T4_01_registry_singleton(self):
        """T4-01: Registry 是单例"""
        r1 = SlashCommandRegistry.get_instance()
        r2 = SlashCommandRegistry.get_instance()
        self.assertIs(r1, r2)

    def test_T4_02_executor_via_registry(self):
        """T4-02: Executor 复用 Registry 单例"""
        executor1 = SlashCommandExecutor()
        executor2 = SlashCommandExecutor()
        # 实例不同但内部 registry 是单例
        self.assertIs(executor1._registry, executor2._registry)


# ============================================================
# T5: 序列化测试
# ============================================================
class TestSerialization(unittest.TestCase):
    """T5: 序列化测试"""

    def setUp(self):
        self.registry = SlashCommandRegistry()

    def test_T5_01_command_to_dict(self):
        """T5-01: SlashCommand.to_dict() 包含所有字段"""
        cmd = self.registry.get("plan")
        d = cmd.to_dict()
        for key in ["name", "description", "category", "args", "aliases",
                    "handler", "enabled", "built_in", "permission", "icon", "shortcut"]:
            self.assertIn(key, d)
        self.assertEqual(d["name"], "plan")
        self.assertEqual(d["category"], "mode")

    def test_T5_02_execution_result_to_dict(self):
        """T5-02: ExecutionResult.to_dict()"""
        executor = SlashCommandExecutor()
        result = executor.execute("new", [], ExecutionContext())
        d = result.to_dict()
        for key in ["command", "status", "message", "data", "duration_ms", "error"]:
            self.assertIn(key, d)


# ============================================================
# T6: ExecutionContext 测试
# ============================================================
class TestExecutionContext(unittest.TestCase):
    """T6: 执行上下文测试"""

    def test_T6_01_default_extra(self):
        """T6-01: 默认 extra 是空 dict"""
        ctx = ExecutionContext()
        self.assertEqual(ctx.extra, {})

    def test_T6_02_all_fields(self):
        """T6-02: 全部字段可设置"""
        ctx = ExecutionContext(
            user_id="u",
            session_id="s",
            project="p",
            app_mode="coding",
            extra={"key": "value"},
        )
        self.assertEqual(ctx.user_id, "u")
        self.assertEqual(ctx.session_id, "s")
        self.assertEqual(ctx.project, "p")
        self.assertEqual(ctx.app_mode, "coding")
        self.assertEqual(ctx.extra["key"], "value")


if __name__ == "__main__":
    unittest.main(verbosity=2)
