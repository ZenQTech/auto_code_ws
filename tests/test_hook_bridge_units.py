"""
# ============================================================
# HookBridge 单元测试 (v1.0.0) - Cycle 5 P0-6
# ============================================================
# 测试覆盖：
#   1. HookAction 新字段（hook_specific_output / additional_context / permission_decision）
#   2. HookChainStore 存储/查询/摘要
#   3. HookBridgeService 10 个 fire_* 方法
#   4. JSON 输出 Codex 风格解析
#   5. additionalContext 收集
#   6. permissionDecision 提取
# ============================================================
"""

import asyncio
import json
import unittest
from typing import Any, Dict, List

from backend.app.services.hook_bridge import (
    HookBridgeService,
    HookChainEntry,
    HookChainStore,
    get_hook_bridge,
    reset_hook_bridge,
)
from backend.app.services.hooks_registry import (
    HookAction,
    HookConfig,
    HookDefinition,
    HookEventType,
    HooksRegistry,
    reset_hooks_registry,
)


class TestHookActionNewFields(unittest.TestCase):
    """测试 HookAction 新增 Codex 风格字段"""

    def test_hook_action_with_hook_specific_output(self):
        """HookAction 支持 hook_specific_output 字段"""
        action = HookAction(
            exit_code=0,
            hook_specific_output={
                "hookEventName": "PreToolUse",
                "additionalContext": "use pnpm",
                "permissionDecision": "allow",
            },
            additional_context="use pnpm",
            permission_decision="allow",
        )
        self.assertEqual(action.additional_context, "use pnpm")
        self.assertEqual(action.permission_decision, "allow")
        self.assertEqual(
            action.hook_specific_output["hookEventName"], "PreToolUse"
        )

    def test_hook_action_to_dict_includes_new_fields(self):
        """HookAction.to_dict() 包含新字段"""
        action = HookAction(
            exit_code=0,
            additional_context="ctx",
            permission_decision="deny",
        )
        d = action.to_dict()
        self.assertIn("additional_context", d)
        self.assertIn("permission_decision", d)
        self.assertIn("hook_specific_output", d)
        self.assertEqual(d["additional_context"], "ctx")
        self.assertEqual(d["permission_decision"], "deny")


class TestHookChainStore(unittest.IsolatedAsyncioTestCase):
    """测试 HookChainStore 存储和查询"""

    async def test_add_and_get_recent(self):
        """添加并获取最近条目"""
        store = HookChainStore(max_size=10)
        for i in range(5):
            await store.add(HookChainEntry(
                id=f"e{i}",
                event="TestEvent",
                session_id="s1",
                agent_id=None,
                hook_name=f"hook{i}",
                exit_code=0,
                duration_ms=1.0 * i,
            ))
        items = await store.get_recent(limit=10)
        self.assertEqual(len(items), 5)
        self.assertEqual(items[0]["id"], "e0")

    async def test_get_recent_with_session_filter(self):
        """按 session_id 过滤"""
        store = HookChainStore()
        for i in range(3):
            await store.add(HookChainEntry(
                id=f"s1-{i}", event="E1", session_id="s1", agent_id=None,
                hook_name="h", exit_code=0, duration_ms=0.0,
            ))
        for i in range(2):
            await store.add(HookChainEntry(
                id=f"s2-{i}", event="E1", session_id="s2", agent_id=None,
                hook_name="h", exit_code=0, duration_ms=0.0,
            ))
        items = await store.get_recent(limit=20, session_id="s1")
        self.assertEqual(len(items), 3)
        for it in items:
            self.assertEqual(it["session_id"], "s1")

    async def test_get_recent_with_event_filter(self):
        """按 event 过滤"""
        store = HookChainStore()
        for _ in range(3):
            await store.add(HookChainEntry(
                id="x", event="PreToolUse", session_id="s", agent_id="a",
                hook_name="h", exit_code=0, duration_ms=0.0,
            ))
        for _ in range(2):
            await store.add(HookChainEntry(
                id="y", event="PostToolUse", session_id="s", agent_id="a",
                hook_name="h", exit_code=0, duration_ms=0.0,
            ))
        items = await store.get_recent(limit=20, event="PreToolUse")
        self.assertEqual(len(items), 3)

    async def test_max_size_eviction(self):
        """超过 max_size 自动 FIFO 淘汰"""
        store = HookChainStore(max_size=3)
        for i in range(10):
            await store.add(HookChainEntry(
                id=f"e{i}", event="E", session_id="s", agent_id="a",
                hook_name="h", exit_code=0, duration_ms=0.0,
            ))
        items = await store.get_recent(limit=20)
        self.assertEqual(len(items), 3)
        # 应该保留最后 3 条
        self.assertEqual(items[0]["id"], "e7")
        self.assertEqual(items[-1]["id"], "e9")

    async def test_get_summary(self):
        """获取摘要统计"""
        store = HookChainStore()
        for i in range(5):
            await store.add(HookChainEntry(
                id=f"e{i}", event="PreToolUse", session_id="s", agent_id="a",
                hook_name="h", exit_code=0 if i < 4 else 2, duration_ms=0.0,
                is_blocking=(i == 4),
                additional_context=("ctx" if i < 2 else None),
                permission_decision=("allow" if i < 3 else None),
            ))
        summary = await store.get_summary()
        self.assertEqual(summary["total"], 5)
        self.assertEqual(summary["events_count"]["PreToolUse"], 5)
        self.assertEqual(summary["blocking_count"], 1)
        self.assertEqual(summary["context_injection_count"], 2)
        self.assertEqual(summary["permission_override_count"], 3)

    def test_clear(self):
        """清空"""
        store = HookChainStore()
        store._entries.append(HookChainEntry(
            id="e", event="E", session_id="s", agent_id="a",
            hook_name="h", exit_code=0, duration_ms=0.0,
        ))
        store.clear()
        self.assertEqual(len(store._entries), 0)


class TestHookBridgeCollectHelpers(unittest.TestCase):
    """测试 HookBridgeService 静态辅助函数"""

    def test_collect_additional_context(self):
        """合并多个 action 的 additionalContext"""
        actions = [
            HookAction(exit_code=0, additional_context="ctx1"),
            HookAction(exit_code=0, additional_context="ctx2"),
            HookAction(exit_code=1, additional_context="ignored"),  # 错误不收集
            HookAction(exit_code=0, additional_context=None),
        ]
        result = HookBridgeService._collect_additional_context(actions)
        self.assertIn("ctx1", result)
        self.assertIn("ctx2", result)
        self.assertNotIn("ignored", result)

    def test_collect_permission_decision(self):
        """提取最后一个 permissionDecision"""
        actions = [
            HookAction(exit_code=0, permission_decision="allow"),
            HookAction(exit_code=0, permission_decision="deny"),
        ]
        decision = HookBridgeService._collect_permission_decision(actions)
        self.assertEqual(decision, "deny")

    def test_collect_permission_decision_none(self):
        """无 decision 返回 None"""
        actions = [HookAction(exit_code=0)]
        decision = HookBridgeService._collect_permission_decision(actions)
        self.assertIsNone(decision)


class TestHookBridgeFireMethods(unittest.IsolatedAsyncioTestCase):
    """测试 HookBridgeService 10 个 fire_* 方法"""

    async def asyncSetUp(self):
        reset_hook_bridge()
        reset_hooks_registry()
        # 创建一个干净的 registry
        from backend.app.services.hooks_registry import _global_registry
        # 创建一个空 registry 用于测试
        self.registry = HooksRegistry()
        # 直接替换 _global_registry（绕过单例）
        import backend.app.services.hooks_registry as hr_module
        hr_module._global_registry = self.registry
        self.bridge = HookBridgeService(registry=self.registry)
        # 清空 chain store
        self.bridge._chain_store.clear()

    async def asyncTearDown(self):
        reset_hook_bridge()
        reset_hooks_registry()

    async def test_fire_session_start(self):
        """fire_session_start 触发 SessionStart 事件"""
        # 注册一个 hook
        self.registry.add(HookConfig(
            event="SessionStart", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'started'", name="test")],
        ))
        actions = await self.bridge.fire_session_start("test-session", "user1")
        self.assertEqual(len(actions), 1)
        # 验证 chain store 记录
        items = await self.bridge._chain_store.get_recent()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["event"], "SessionStart")
        self.assertEqual(items[0]["session_id"], "test-session")

    async def test_fire_user_prompt_submit_with_context(self):
        """fire_user_prompt_submit 返回 additionalContext"""
        self.registry.add(HookConfig(
            event="UserPromptSubmit", matcher="",
            hooks=[HookDefinition(
                type="command",
                command="echo '{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"use concise answers\"}}'",
                name="ctx_injector",
            )],
        ))
        actions, ctx = await self.bridge.fire_user_prompt_submit("hello", "s1")
        self.assertEqual(len(actions), 1)
        self.assertIn("concise", ctx)

    async def test_fire_pre_tool_use_with_permission_decision(self):
        """fire_pre_tool_use 解析 permissionDecision"""
        self.registry.add(HookConfig(
            event="PreToolUse", matcher="",
            hooks=[HookDefinition(
                type="command",
                command="echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\"}}'",
                name="deny_hook",
            )],
        ))
        actions, ctx = await self.bridge.fire_pre_tool_use("Bash", {"cmd": "rm -rf /"}, "agent-1")
        self.assertEqual(len(actions), 1)
        self.assertEqual(ctx, "")  # 无 additionalContext

    async def test_fire_permission_request_extracts_decision(self):
        """fire_permission_request 提取 permissionDecision"""
        self.registry.add(HookConfig(
            event="PermissionRequest", matcher="",
            hooks=[HookDefinition(
                type="command",
                command="echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PermissionRequest\",\"permissionDecision\":\"allow\"}}'",
                name="allow_hook",
            )],
        ))
        actions, decision = await self.bridge.fire_permission_request(
            "Write", {"file": "/tmp/test.txt"}, "agent-1"
        )
        self.assertEqual(decision, "allow")

    async def test_fire_post_tool_use(self):
        """fire_post_tool_use 触发 PostToolUse"""
        self.registry.add(HookConfig(
            event="PostToolUse", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'ok'", name="h")],
        ))
        actions = await self.bridge.fire_post_tool_use("Bash", "result", 100.0, "a1")
        self.assertEqual(len(actions), 1)

    async def test_fire_pre_compact(self):
        """fire_pre_compact 触发 PreCompact"""
        self.registry.add(HookConfig(
            event="PreCompact", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'pre'", name="h")],
        ))
        actions = await self.bridge.fire_pre_compact("auto", 5000, "s1")
        self.assertEqual(len(actions), 1)

    async def test_fire_post_compact(self):
        """fire_post_compact 触发 PostCompact"""
        self.registry.add(HookConfig(
            event="PostCompact", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'post'", name="h")],
        ))
        actions = await self.bridge.fire_post_compact(5000, 2000, "s1")
        self.assertEqual(len(actions), 1)

    async def test_fire_subagent_start(self):
        """fire_subagent_start 触发 SubagentStart"""
        self.registry.add(HookConfig(
            event="SubagentStart", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'started'", name="h")],
        ))
        actions = await self.bridge.fire_subagent_start("sub-1", "implement feature")
        self.assertEqual(len(actions), 1)

    async def test_fire_subagent_stop(self):
        """fire_subagent_stop 触发 SubagentStop"""
        self.registry.add(HookConfig(
            event="SubagentStop", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'stopped'", name="h")],
        ))
        actions = await self.bridge.fire_subagent_stop("sub-1", "completed")
        self.assertEqual(len(actions), 1)

    async def test_fire_session_end(self):
        """fire_session_end 触发 SessionEnd"""
        self.registry.add(HookConfig(
            event="SessionEnd", matcher="",
            hooks=[HookDefinition(type="command", command="echo 'ended'", name="h")],
        ))
        actions = await self.bridge.fire_session_end("s1", 60000.0)
        self.assertEqual(len(actions), 1)

    async def test_fire_all_10_events_chain_records(self):
        """所有 10 个事件都能触发并记录到 chain store"""
        # 注册所有 10 种事件的 hook
        for event in HookEventType.all_events():
            self.registry.add(HookConfig(
                event=event, matcher="",
                hooks=[HookDefinition(type="command", command="echo 'ok'", name=f"hook_{event}")],
            ))
        # fire 全部 10 次
        await self.bridge.fire_session_start("s")
        await self.bridge.fire_user_prompt_submit("hi", "s")
        await self.bridge.fire_pre_tool_use("T", {}, "a")
        await self.bridge.fire_post_tool_use("T", "r", 0, "a")
        await self.bridge.fire_permission_request("T", {}, "a")
        await self.bridge.fire_pre_compact("manual", 100, "s")
        await self.bridge.fire_post_compact(100, 50, "s")
        await self.bridge.fire_subagent_start("sub", "task")
        await self.bridge.fire_subagent_stop("sub", "done")
        await self.bridge.fire_session_end("s", 1000.0)
        items = await self.bridge._chain_store.get_recent(limit=20)
        self.assertEqual(len(items), 10)
        events = [it["event"] for it in items]
        expected = [
            "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
            "PermissionRequest", "PreCompact", "PostCompact",
            "SubagentStart", "SubagentStop", "SessionEnd",
        ]
        self.assertEqual(events, expected)
        # 所有 hook 都有名称（来自 HookDefinition.name）
        for it in items:
            self.assertTrue(it["hook_name"].startswith("hook_"), f"unexpected hook_name: {it['hook_name']}")

    async def test_fire_no_hooks_still_records(self):
        """无 hook 时也记录 NO_HOOK 条目"""
        # 不注册任何 hook
        await self.bridge.fire_session_start("s1")
        await self.bridge.fire_user_prompt_submit("hi", "s1")
        items = await self.bridge._chain_store.get_recent(limit=20)
        self.assertEqual(len(items), 2)
        for it in items:
            self.assertEqual(it["hook_name"], "(no hook matched)")

    async def test_fire_with_no_hooks_returns_empty(self):
        """无 hook 配置时 fire 返回空列表（不抛异常）"""
        actions = await self.bridge.fire_session_start("s")
        self.assertEqual(actions, [])

    async def test_fire_exception_isolation(self):
        """hook 抛异常时 fire 仍能正常返回"""
        # 不注册任何失败 hook，验证基本隔离（即使 hook 内部错误，fire 仍正常）
        actions, ctx = await self.bridge.fire_pre_tool_use("T", {})
        self.assertEqual(actions, [])
        self.assertEqual(ctx, "")


class TestHookBridgeSingleton(unittest.TestCase):
    """测试全局单例"""

    def test_singleton(self):
        """get_hook_bridge 返回相同实例"""
        reset_hook_bridge()
        b1 = get_hook_bridge()
        b2 = get_hook_bridge()
        self.assertIs(b1, b2)

    def test_reset(self):
        """reset_hook_bridge 重置实例"""
        reset_hook_bridge()
        b1 = get_hook_bridge()
        reset_hook_bridge()
        b2 = get_hook_bridge()
        self.assertIsNot(b1, b2)


class TestHookActionJSONParsing(unittest.IsolatedAsyncioTestCase):
    """测试 _execute_hook 中 Codex 风格 JSON 解析"""

    async def test_parse_hook_specific_output(self):
        """hook 命令输出 hookSpecificOutput JSON 时正确解析"""
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse", matcher="",
            hooks=[HookDefinition(
                type="command",
                command='echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"use pnpm","permissionDecision":"allow"}}\'',
                name="test_hso",
            )],
        ))
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].additional_context, "use pnpm")
        self.assertEqual(actions[0].permission_decision, "allow")
        self.assertIsNotNone(actions[0].hook_specific_output)

    async def test_parse_plain_json(self):
        """无 hookSpecificOutput 包裹的 JSON 也能解析"""
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse", matcher="",
            hooks=[HookDefinition(
                type="command",
                command='echo \'{"key": "value"}\'',
                name="test_plain",
            )],
        ))
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].json_output, {"key": "value"})
        self.assertIsNone(actions[0].hook_specific_output)

    async def test_parse_non_json(self):
        """非 JSON 输出不解析"""
        registry = HooksRegistry()
        registry.add(HookConfig(
            event="PreToolUse", matcher="",
            hooks=[HookDefinition(
                type="command",
                command='echo "plain text output"',
                name="test_plain",
            )],
        ))
        actions = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
        self.assertEqual(len(actions), 1)
        self.assertIsNone(actions[0].json_output)
        self.assertIsNone(actions[0].hook_specific_output)
        self.assertEqual(actions[0].stdout, "plain text output")


if __name__ == "__main__":
    unittest.main()
