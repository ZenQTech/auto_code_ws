"""
# ============================================================
# Cycle 4 P0-4 单元测试 - Hooks 事件系统 (10 类事件)
# ============================================================
# 测试覆盖：
#   - H1: HookEventType 枚举完整性（10 种事件）
#   - H2: HookAction 退出码语义（0/2/其他）
#   - H3: HookDefinition 配置与序列化
#   - H4: HookConfig 匹配器（matcher）逻辑
#   - H5: HooksRegistry 配置加载（dict / file）
#   - H6: HooksRegistry 触发事件 + shell 命令执行
#   - H7: 阻塞语义（exit code 2 中断后续）
#   - H8: 匹配模式（tool_name / user_input）
#   - H9: 超时处理
#   - H10: 全局单例 + 重置
# 创建日期：2026-07-27
# ============================================================
"""

import asyncio
import json
import os
import sys
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock


# 添加项目根路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


# ============================================================
# H1: HookEventType 枚举完整性
# ============================================================
class TestHookEventType(unittest.TestCase):
    """
    H1: HookEventType 枚举完整性测试

    验证 10 种事件类型全部存在
    """

    def test_10_events_defined(self):
        """测试定义了 10 种事件"""
        from backend.app.services.hooks_registry import HookEventType
        events = HookEventType.all_events()
        self.assertEqual(len(events), 10)

    def test_all_required_events_present(self):
        """测试所有必需的事件都存在"""
        from backend.app.services.hooks_registry import HookEventType
        required = {
            "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
            "PermissionRequest", "PreCompact", "PostCompact",
            "SubagentStart", "SubagentStop", "SessionEnd",
        }
        actual = set(HookEventType.all_events())
        self.assertEqual(actual, required)

    def test_event_values_are_strings(self):
        """测试事件值是字符串"""
        from backend.app.services.hooks_registry import HookEventType
        for event in HookEventType:
            self.assertIsInstance(event.value, str)
            self.assertGreater(len(event.value), 0)

    def test_event_type_inherits_str(self):
        """测试 HookEventType 继承 str（可作为 dict key 等）"""
        from backend.app.services.hooks_registry import HookEventType
        # 应当可直接与字符串比较
        self.assertEqual(HookEventType.SESSION_START, "SessionStart")
        self.assertEqual(HookEventType.SESSION_START.value, "SessionStart")


# ============================================================
# H2: HookAction 退出码语义
# ============================================================
class TestHookAction(unittest.TestCase):
    """
    H2: HookAction 退出码语义测试

    验证：
      - exit_code 0 = success
      - exit_code 2 = blocking（强制 retry）
      - exit_code != 0 = error
    """

    def test_success_action(self):
        """测试成功 action（exit_code 0）"""
        from backend.app.services.hooks_registry import HookAction
        action = HookAction(exit_code=0, stdout="ok")
        self.assertTrue(action.is_success)
        self.assertFalse(action.is_blocking)
        self.assertFalse(action.is_error)

    def test_blocking_action(self):
        """测试阻塞 action（exit_code 2）"""
        from backend.app.services.hooks_registry import HookAction
        action = HookAction(exit_code=2, stderr="blocked")
        self.assertFalse(action.is_success)
        self.assertTrue(action.is_blocking)
        self.assertTrue(action.is_error)

    def test_error_action(self):
        """测试错误 action（exit_code 1）"""
        from backend.app.services.hooks_registry import HookAction
        action = HookAction(exit_code=1, error="something failed")
        self.assertFalse(action.is_success)
        self.assertFalse(action.is_blocking)
        self.assertTrue(action.is_error)

    def test_action_to_dict(self):
        """测试 action to_dict 序列化"""
        from backend.app.services.hooks_registry import HookAction
        action = HookAction(
            exit_code=0,
            stdout="output",
            stderr="warning",
            duration_ms=12.5,
        )
        d = action.to_dict()
        self.assertEqual(d["exit_code"], 0)
        self.assertEqual(d["stdout"], "output")
        self.assertEqual(d["duration_ms"], 12.5)
        self.assertTrue(d["is_success"])
        self.assertFalse(d["is_blocking"])

    def test_action_truncates_long_stdout(self):
        """测试长 stdout 被截断到 500 字符"""
        from backend.app.services.hooks_registry import HookAction
        long_output = "x" * 1000
        action = HookAction(exit_code=0, stdout=long_output)
        d = action.to_dict()
        self.assertEqual(len(d["stdout"]), 500)


# ============================================================
# H3: HookDefinition 配置与序列化
# ============================================================
class TestHookDefinition(unittest.TestCase):
    """
    H3: HookDefinition 配置与序列化测试
    """

    def test_default_type_is_command(self):
        """测试默认 type 是 command"""
        from backend.app.services.hooks_registry import HookDefinition
        hook = HookDefinition(command="echo hi")
        self.assertEqual(hook.type, "command")

    def test_default_timeout_is_60(self):
        """测试默认超时 60s"""
        from backend.app.services.hooks_registry import HookDefinition
        hook = HookDefinition(command="echo hi")
        self.assertEqual(hook.timeout, 60)

    def test_to_dict_round_trip(self):
        """测试 to_dict / from_dict 往返"""
        from backend.app.services.hooks_registry import HookDefinition
        original = HookDefinition(
            type="command",
            command="echo 'hello'",
            timeout=30,
            env={"FOO": "bar"},
            name="test_hook",
        )
        data = original.to_dict()
        restored = HookDefinition.from_dict(data)
        self.assertEqual(restored.type, "command")
        self.assertEqual(restored.command, "echo 'hello'")
        self.assertEqual(restored.timeout, 30)
        self.assertEqual(restored.env, {"FOO": "bar"})
        self.assertEqual(restored.name, "test_hook")

    def test_name_fallback_to_command_prefix(self):
        """测试 name 为空时 to_dict 用 command 前 30 字符作 name"""
        from backend.app.services.hooks_registry import HookDefinition
        hook = HookDefinition(command="echo very long command that exceeds 30 chars")
        data = hook.to_dict()
        self.assertEqual(len(data["name"]), 30)


# ============================================================
# H4: HookConfig 匹配器
# ============================================================
class TestHookConfigMatcher(unittest.TestCase):
    """
    H4: HookConfig 匹配器测试
    """

    def test_empty_matcher_matches_all(self):
        """测试空 matcher 匹配所有 payload"""
        from backend.app.services.hooks_registry import HookConfig
        config = HookConfig(event="PreToolUse", matcher="")
        self.assertTrue(config.matches({"tool_name": "Bash"}))
        self.assertTrue(config.matches({"tool_name": "Write"}))
        self.assertTrue(config.matches({}))

    def test_tool_name_matcher(self):
        """测试 tool_name 正则匹配"""
        from backend.app.services.hooks_registry import HookConfig
        config = HookConfig(event="PreToolUse", matcher="Bash|Write")
        self.assertTrue(config.matches({"tool_name": "Bash"}))
        self.assertTrue(config.matches({"tool_name": "Write"}))
        self.assertFalse(config.matches({"tool_name": "Read"}))
        self.assertFalse(config.matches({"tool_name": "Edit"}))

    def test_user_input_matcher(self):
        """测试 user_input 正则匹配"""
        from backend.app.services.hooks_registry import HookConfig
        config = HookConfig(event="UserPromptSubmit", matcher="^/review")
        self.assertTrue(config.matches({"user_input": "/review this code"}))
        self.assertFalse(config.matches({"user_input": "hello world"}))

    def test_config_to_dict(self):
        """测试 HookConfig to_dict 序列化"""
        from backend.app.services.hooks_registry import HookConfig, HookDefinition
        config = HookConfig(
            event="PreToolUse",
            matcher="Bash",
            hooks=[HookDefinition(command="echo 'blocked'", timeout=5)],
        )
        data = config.to_dict()
        self.assertEqual(data["event"], "PreToolUse")
        self.assertEqual(data["matcher"], "Bash")
        self.assertEqual(len(data["hooks"]), 1)
        self.assertEqual(data["hooks"][0]["command"], "echo 'blocked'")

    def test_config_from_dict_minimal(self):
        """测试 HookConfig from_dict 极简输入"""
        from backend.app.services.hooks_registry import HookConfig
        data = {"event": "SessionStart"}
        config = HookConfig.from_dict(data)
        self.assertEqual(config.event, "SessionStart")
        self.assertEqual(config.matcher, "")
        self.assertEqual(config.hooks, [])


# ============================================================
# H5: HooksRegistry 配置加载
# ============================================================
class TestHooksRegistryConfigLoading(unittest.TestCase):
    """
    H5: HooksRegistry 配置加载测试
    """

    def test_load_from_dict_basic(self):
        """测试从 dict 加载配置"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        registry.load_from_dict({
            "hooks": [
                {
                    "event": "PreToolUse",
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": "echo 'ok'"}]
                }
            ]
        })
        self.assertEqual(len(registry.configs), 1)
        self.assertEqual(registry.configs[0].event, "PreToolUse")

    def test_load_from_list(self):
        """测试从 list 加载配置"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        registry.load_from_dict([
            {"event": "SessionStart", "hooks": []},
            {"event": "SessionEnd", "hooks": []},
        ])
        self.assertEqual(len(registry.configs), 2)

    def test_load_from_json_file(self):
        """测试从 JSON 文件加载配置"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump({
                "hooks": [
                    {
                        "event": "PreToolUse",
                        "matcher": "Bash",
                        "hooks": [{"type": "command", "command": "true"}]
                    }
                ]
            }, f)
            tmp_path = f.name

        try:
            registry.load_from_file(tmp_path)
            self.assertEqual(len(registry.configs), 1)
        finally:
            os.unlink(tmp_path)

    def test_load_from_nonexistent_file(self):
        """测试加载不存在的文件不抛错"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        registry.load_from_file("/tmp/does-not-exist-99999.json")
        self.assertEqual(len(registry.configs), 0)

    def test_clear_empties_configs(self):
        """测试 clear() 清空配置"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        registry.add(__import__(
            "backend.app.services.hooks_registry", fromlist=["HookConfig"]
        ).HookConfig(event="SessionStart"))
        self.assertGreater(len(registry.configs), 0)
        registry.clear()
        self.assertEqual(len(registry.configs), 0)

    def test_get_configs_for_event(self):
        """测试根据事件类型获取配置"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig
        registry = HooksRegistry()
        registry.add(HookConfig(event="PreToolUse", matcher="Bash"))
        registry.add(HookConfig(event="PreToolUse", matcher="Write"))
        registry.add(HookConfig(event="PostToolUse"))

        pre_configs = registry.get_configs_for_event("PreToolUse")
        post_configs = registry.get_configs_for_event("PostToolUse")
        session_configs = registry.get_configs_for_event("SessionStart")

        self.assertEqual(len(pre_configs), 2)
        self.assertEqual(len(post_configs), 1)
        self.assertEqual(len(session_configs), 0)

    def test_get_summary(self):
        """测试获取摘要信息"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[HookDefinition(command="echo 1"), HookDefinition(command="echo 2")],
        ))
        registry.add(HookConfig(
            event="SessionStart",
            hooks=[HookDefinition(command="echo 3")],
        ))

        summary = registry.get_summary()
        self.assertEqual(summary["total_configs"], 2)
        self.assertEqual(summary["hooks_per_event"]["PreToolUse"], 2)
        self.assertEqual(summary["hooks_per_event"]["SessionStart"], 1)
        self.assertEqual(summary["hooks_per_event"]["PostToolUse"], 0)
        self.assertEqual(len(summary["events"]), 10)


# ============================================================
# H6: HooksRegistry 触发事件
# ============================================================
class TestHooksRegistryDispatch(unittest.IsolatedAsyncioTestCase):
    """
    H6/H7/H8/H9: 触发事件 + 阻塞 + 匹配 + 超时测试
    """

    async def test_dispatch_simple_command(self):
        """测试触发一个简单的 shell 命令"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[HookDefinition(command="echo 'hello'", timeout=5)],
        ))
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].exit_code, 0)
        self.assertIn("hello", actions[0].stdout)

    async def test_dispatch_multiple_hooks(self):
        """测试触发多个 hooks（都执行）"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[
                HookDefinition(command="echo 'first'", name="h1"),
                HookDefinition(command="echo 'second'", name="h2"),
                HookDefinition(command="echo 'third'", name="h3"),
            ],
        ))
        actions = await registry.dispatch("PreToolUse", {})
        self.assertEqual(len(actions), 3)
        self.assertEqual(actions[0].stdout, "first")
        self.assertEqual(actions[1].stdout, "second")
        self.assertEqual(actions[2].stdout, "third")

    async def test_dispatch_with_matcher(self):
        """测试 matcher 过滤"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            matcher="Bash",
            hooks=[HookDefinition(command="echo 'bash-only'")],
        ))

        # Bash 匹配
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 1)

        # Write 不匹配
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Write"})
        self.assertEqual(len(actions), 0)

    async def test_dispatch_unknown_event(self):
        """测试未知事件返回空列表"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        actions = await registry.dispatch("UnknownEvent", {})
        self.assertEqual(len(actions), 0)

    async def test_dispatch_no_matching_configs(self):
        """测试无匹配配置时返回空列表"""
        from backend.app.services.hooks_registry import HooksRegistry
        registry = HooksRegistry()
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 0)

    async def test_blocking_stops_subsequent_hooks(self):
        """测试 exit code 2 阻塞后续 hook 执行"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[
                HookDefinition(command="echo 'first'", name="h1"),
                HookDefinition(command="exit 2", name="h2-blocker"),
                HookDefinition(command="echo 'third-NOT-EXECUTED'", name="h3"),
            ],
        ))
        actions = await registry.dispatch("PreToolUse", {})
        # 只应执行 2 个 hook（h1 + h2-blocker）
        self.assertEqual(len(actions), 2)
        self.assertEqual(actions[0].exit_code, 0)
        self.assertEqual(actions[1].exit_code, 2)
        self.assertTrue(actions[1].is_blocking)

    async def test_timeout_creates_124_exit_code(self):
        """测试超时产生 124 退出码"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[HookDefinition(command="sleep 5", timeout=1)],
        ))
        actions = await registry.dispatch("PreToolUse", {})
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].exit_code, 124)
        self.assertIn("超时", actions[0].error or "")

    async def test_json_output_parsing(self):
        """测试命令输出 JSON 解析"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PostToolUse",
            hooks=[HookDefinition(command="echo '{\"status\":\"ok\",\"count\":3}'")],
        ))
        actions = await registry.dispatch("PostToolUse", {})
        self.assertEqual(len(actions), 1)
        self.assertIsNotNone(actions[0].json_output)
        self.assertEqual(actions[0].json_output["status"], "ok")
        self.assertEqual(actions[0].json_output["count"], 3)

    async def test_payload_passed_via_stdin_and_env(self):
        """测试 payload 通过 stdin 和 env 传递给 hook"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition
        registry = HooksRegistry()
        # hook 读取 HERMES_PAYLOAD 环境变量并写入文件
        registry.add(HookConfig(
            event="PreToolUse",
            hooks=[HookDefinition(
                command="python3 -c \"import os, json; print(os.environ.get('HERMES_PAYLOAD', ''))\"",
                timeout=5,
            )],
        ))
        test_payload = {"tool_name": "Bash", "arguments": {"cmd": "ls"}}
        actions = await registry.dispatch("PreToolUse", test_payload)
        self.assertEqual(len(actions), 1)
        self.assertIn("Bash", actions[0].stdout)

    async def test_10_event_types_can_be_dispatched(self):
        """测试 10 种事件类型都能被触发"""
        from backend.app.services.hooks_registry import HooksRegistry, HookConfig, HookDefinition, HookEventType
        registry = HooksRegistry()
        for event in HookEventType.all_events():
            registry.add(HookConfig(
                event=event,
                hooks=[HookDefinition(command="echo 'event-executed'", name=f"h-{event}")],
            ))

        for event in HookEventType.all_events():
            # 构造每个事件的合理 payload
            payload = {
                "session_id": "s-1",
                "user_input": "test",
                "tool_name": "Bash",
                "result": "ok",
                "subagent_id": "sa-1",
                "task": "test task",
            }
            actions = await registry.dispatch(event, payload)
            self.assertEqual(len(actions), 1, f"事件 {event} 未触发")
            self.assertEqual(actions[0].exit_code, 0, f"事件 {event} 失败")
            self.assertIn("event-executed", actions[0].stdout)


# ============================================================
# H10: 全局单例
# ============================================================
class TestGlobalRegistry(unittest.TestCase):
    """
    H10: 全局单例测试
    """

    def test_get_hooks_registry_singleton(self):
        """测试全局注册表是单例"""
        from backend.app.services.hooks_registry import get_hooks_registry, reset_hooks_registry
        reset_hooks_registry()
        r1 = get_hooks_registry()
        r2 = get_hooks_registry()
        self.assertIs(r1, r2)

    def test_reset_clears_singleton(self):
        """测试 reset 清空单例"""
        from backend.app.services.hooks_registry import get_hooks_registry, reset_hooks_registry
        reset_hooks_registry()
        r1 = get_hooks_registry()
        r1.add(__import__(
            "backend.app.services.hooks_registry", fromlist=["HookConfig"]
        ).HookConfig(event="SessionStart"))
        reset_hooks_registry()
        r2 = get_hooks_registry()
        self.assertEqual(len(r2.configs), 0)


# ============================================================
# 主入口
# ============================================================
def run_all_tests():
    """运行所有 Hooks 单元测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestHookEventType))
    suite.addTests(loader.loadTestsFromTestCase(TestHookAction))
    suite.addTests(loader.loadTestsFromTestCase(TestHookDefinition))
    suite.addTests(loader.loadTestsFromTestCase(TestHookConfigMatcher))
    suite.addTests(loader.loadTestsFromTestCase(TestHooksRegistryConfigLoading))
    suite.addTests(loader.loadTestsFromTestCase(TestHooksRegistryDispatch))
    suite.addTests(loader.loadTestsFromTestCase(TestGlobalRegistry))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
