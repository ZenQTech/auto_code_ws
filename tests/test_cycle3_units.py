"""
# ============================================================
# Cycle 3 单元测试 - 核心服务模块
# ============================================================
# 测试覆盖：
#   - T6: 外部 MCP 服务器管理
#   - T7: SKILL.md 解析器
#   - T8: 多文件类型规则解析器
#   - T9: 双触发压缩
#   - T10: MCP 权限控制
# 创建日期：2026-07-27
# ============================================================
"""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

# 添加项目根路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


# ============================================================
# T6: 外部 MCP 服务器测试
# ============================================================
class TestExternalMCPServer(unittest.TestCase):
    """T6: 外部 MCP 服务器单元测试"""

    def setUp(self):
        from backend.app.services.mcp.external import (
            ExternalMCPServerConfig,
            MCPTransport,
        )
        self.config_cls = ExternalMCPServerConfig
        self.transport = MCPTransport

    def test_stdio_config_validation(self):
        """测试 stdio 配置验证"""
        config = self.config_cls(
            id="test-1",
            name="test-server",
            transport=self.transport.STDIO,
            command="python",
            args=["-m", "my_server"],
        )
        self.assertEqual(config.name, "test-server")
        self.assertEqual(config.command, "python")
        self.assertEqual(len(config.args), 2)

    def test_http_config_validation(self):
        """测试 HTTP 配置验证"""
        config = self.config_cls(
            id="test-2",
            name="http-server",
            transport=self.transport.STREAMABLE_HTTP,
            url="http://localhost:3000/mcp",
        )
        self.assertEqual(config.url, "http://localhost:3000/mcp")
        self.assertTrue(config.enabled)

    def test_invalid_transport(self):
        """测试无效传输类型"""
        with self.assertRaises(ValueError):
            self.config_cls(
                id="test-3",
                name="bad",
                transport="invalid",  # type: ignore
                command="x",
            )

    def test_id_auto_generation(self):
        """测试 ID 自动生成"""
        config = self.config_cls(
            id="",
            name="auto-id",
            transport=self.transport.STDIO,
            command="x",
        )
        self.assertNotEqual(config.id, "")
        self.assertTrue(len(config.id) > 0)


# ============================================================
# T7: SKILL.md 解析器测试
# ============================================================
class TestSkillMdParser(unittest.TestCase):
    """T7: SKILL.md 解析器单元测试"""

    def setUp(self):
        from backend.app.services.skill_md import (
            parse_skill_md, build_skill_md, SkillFrontmatter,
        )
        self.parse = parse_skill_md
        self.build = build_skill_md
        self.Frontmatter = SkillFrontmatter

    def test_valid_skill_md(self):
        """测试有效 SKILL.md 解析"""
        content = """---
name: test-skill
description: A test skill
---

# Test Skill

This is the body.
"""
        result = self.parse(content)
        self.assertTrue(result.valid)
        self.assertEqual(result.frontmatter.name, "test-skill")
        self.assertEqual(result.frontmatter.description, "A test skill")
        self.assertIn("Test Skill", result.body)

    def test_invalid_no_frontmatter(self):
        """测试无效格式（无 frontmatter）"""
        content = "# Just a markdown"
        result = self.parse(content)
        self.assertFalse(result.valid)
        self.assertGreater(len(result.errors), 0)

    def test_round_trip(self):
        """测试 round-trip 解析与生成"""
        original_content = """---
name: round-trip
description: Round trip test
---

# Body
Hello world
"""
        # 解析
        parsed = self.parse(original_content)
        self.assertTrue(parsed.valid)
        # 重新生成
        rebuilt = self.build(parsed.frontmatter, parsed.body)
        # 再次解析
        reparsed = self.parse(rebuilt)
        self.assertTrue(reparsed.valid)
        self.assertEqual(reparsed.frontmatter.name, "round-trip")
        self.assertIn("Hello world", reparsed.body)


# ============================================================
# T8: 多文件类型规则解析器测试
# ============================================================
class TestRulesResolver(unittest.TestCase):
    """T8: 多文件类型规则解析器单元测试"""

    def setUp(self):
        from backend.app.services.rules_resolver import (
            RulesResolver, RuleFileType, RuleLayer, LAYER_PRIORITY,
        )
        self.resolver = RulesResolver()
        self.FileType = RuleFileType
        self.Layer = RuleLayer
        self.priority = LAYER_PRIORITY

    def test_layer_priority(self):
        """测试层级优先级"""
        self.assertLess(self.priority[self.Layer.USER], self.priority[self.Layer.PROJECT])
        self.assertLess(self.priority[self.Layer.PROJECT], self.priority[self.Layer.SUB_DIRECTORY])
        self.assertLess(self.priority[self.Layer.SUB_DIRECTORY], self.priority[self.Layer.OVERRIDE])

    def test_scan_with_temp_project(self):
        """测试扫描临时项目"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建多类型规则文件
            (Path(tmpdir) / "AGENTS.md").write_text("# Project AGENTS")
            (Path(tmpdir) / "CLAUDE.md").write_text("# Claude rules")
            (Path(tmpdir) / "subdir").mkdir()
            (Path(tmpdir) / "subdir" / "GEMINI.md").write_text("# Gemini sub rules")

            rules = self.resolver.scan(tmpdir)
            self.assertGreaterEqual(len(rules), 3)
            types = {r["file_type"] for r in rules}
            self.assertIn("AGENTS.md", types)
            self.assertIn("CLAUDE.md", types)
            self.assertIn("GEMINI.md", types)

    def test_merge_with_max_size(self):
        """测试合并（带大小限制）"""
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "AGENTS.md").write_text("X" * 5000)
            (Path(tmpdir) / "CLAUDE.md").write_text("Y" * 5000)
            self.resolver.scan(tmpdir)
            # 允许截断标记 (16 字符) 略微超出
            result = self.resolver.merge_rules(tmpdir, max_total_size=3000)
            self.assertLessEqual(result["total_size"], 3000 + 20)  # 容差
            self.assertTrue(result["truncated"])
            self.assertEqual(result["rules_count"], 1)

    def test_conflict_detection(self):
        """测试冲突检测"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 同一文件类型在不同层级
            (Path(tmpdir) / "AGENTS.md").write_text("# Project level")
            (Path(tmpdir) / "sub").mkdir()
            (Path(tmpdir) / "sub" / "AGENTS.md").write_text("# Sub level")

            self.resolver.scan(tmpdir)
            conflicts = self.resolver.detect_conflicts(tmpdir)
            self.assertGreater(len(conflicts), 0)
            # AGENTS.md 应有冲突
            agents_conflicts = [c for c in conflicts if c["file_type"] == "AGENTS.md"]
            self.assertGreater(len(agents_conflicts), 0)


# ============================================================
# T9: 双触发压缩测试
# ============================================================
class TestDualTriggerCompaction(unittest.TestCase):
    """T9: 双触发压缩单元测试"""

    def setUp(self):
        from backend.app.services.compaction_dual import (
            DualTriggerCompactor, CompactionTrigger, CompactionPath,
            PendingRequest, LocalCompactor, RemoteCompactor,
            DUAL_TRIGGER_CONFIG, reset_dual_compactor,
        )
        reset_dual_compactor()
        self.compactor = DualTriggerCompactor()
        self.Trigger = CompactionTrigger
        self.Path = CompactionPath
        self.PendingRequest = PendingRequest
        self.LocalCompactor = LocalCompactor
        self.RemoteCompactor = RemoteCompactor
        self.config = DUAL_TRIGGER_CONFIG

    def test_default_config(self):
        """测试默认配置"""
        self.assertTrue(self.config["pre_turn_enabled"])
        self.assertTrue(self.config["mid_turn_enabled"])
        self.assertEqual(self.config["mid_turn_threshold_ratio"], 0.85)

    def test_pending_request_management(self):
        """测试 pending request 管理"""
        pr1 = self.PendingRequest(
            request_id="r1",
            session_id="s1",
            role="user",
            content="test 1",
        )
        pr2 = self.PendingRequest(
            request_id="r2",
            session_id="s1",
            role="tool",
            content="test 2",
        )
        self.compactor.add_pending_request(pr1)
        self.compactor.add_pending_request(pr2)
        pending = self.compactor.get_pending_requests("s1")
        self.assertEqual(len(pending), 2)
        cleared = self.compactor.clear_pending_requests("s1")
        self.assertEqual(cleared, 2)
        self.assertEqual(len(self.compactor.get_pending_requests("s1")), 0)

    def test_pre_turn_trigger_check(self):
        """测试 pre_turn 触发条件检查"""
        async def run_test():
            # 模拟 base compactor
            from backend.app.services.compaction_dual import DualTriggerCompactor
            compactor = DualTriggerCompactor()
            # 没有 base compactor 时不触发
            should, reason = await compactor.check_pre_turn_trigger("s1", 1000)
            self.assertFalse(should)
            self.assertEqual(reason, "no_base_compactor")
        asyncio.run(run_test())

    def test_mid_turn_trigger_no_pending(self):
        """测试 mid_turn 触发条件（无 pending）"""
        async def run_test():
            from backend.app.services.compaction_dual import DualTriggerCompactor
            compactor = DualTriggerCompactor()
            should, reason = await compactor.check_mid_turn_trigger("s1", 10000, has_pending_request=False)
            self.assertFalse(should)
            self.assertEqual(reason, "no_pending_request")
        asyncio.run(run_test())

    def test_execute_pre_turn(self):
        """测试 pre_turn 执行"""
        async def run_test():
            messages = [
                {"role": "user", "content": "Hello " * 100},
                {"role": "assistant", "content": "Hi " * 100},
            ]
            result = await self.compactor.execute_pre_turn("s1", messages, path="local")
            self.assertTrue(result["success"])
            self.assertEqual(result["trigger"], "pre_turn")
            self.assertGreater(result["before_tokens"], 0)
        asyncio.run(run_test())

    def test_execute_mid_turn(self):
        """测试 mid_turn 执行 + replay"""
        async def run_test():
            messages = [
                {"role": "user", "content": "Long conversation " * 50},
            ]
            pending = {
                "request_id": "pr-1",
                "role": "user",
                "content": "Important request",
            }
            result = await self.compactor.execute_mid_turn(
                "s1", messages, pending_request=pending, path="local"
            )
            self.assertTrue(result["success"])
            self.assertEqual(result["trigger"], "mid_turn")
            self.assertIn("replay", result)
            self.assertEqual(result["replay"]["replayed"], 1)
        asyncio.run(run_test())

    def test_history_record(self):
        """测试历史记录"""
        async def run_test():
            messages = [{"role": "user", "content": "Test " * 50}]
            await self.compactor.execute_pre_turn("s1", messages)
            await self.compactor.execute_mid_turn("s1", messages)
            history = self.compactor.get_history("s1")
            self.assertEqual(len(history), 2)
            triggers = {h["trigger"] for h in history}
            self.assertIn("pre_turn", triggers)
            self.assertIn("mid_turn", triggers)
        asyncio.run(run_test())

    def test_local_compactor_fallback(self):
        """测试本地压缩器回退"""
        async def run_test():
            compactor = self.LocalCompactor()  # 无 LLM
            messages = [
                {"role": "user", "content": "Test message 1"},
                {"role": "assistant", "content": "Response 1"},
            ]
            summary = await compactor.compact(messages)
            self.assertGreater(len(summary), 0)
        asyncio.run(run_test())

    def test_remote_compactor_fallback(self):
        """测试远程压缩器回退（无 API key）"""
        async def run_test():
            compactor = self.RemoteCompactor(api_key=None)
            messages = [{"role": "user", "content": "Test " * 10}]
            result = await compactor.compact(messages, target_tokens=100)
            self.assertIn("summary", result)
            # 应回退到本地
            self.assertEqual(result["raw_response"].get("fallback"), "local")
        asyncio.run(run_test())


# ============================================================
# T10: MCP 权限控制测试
# ============================================================
class TestMCPPermissions(unittest.TestCase):
    """T10: MCP 权限控制单元测试"""

    def setUp(self):
        from backend.app.services.mcp.permissions import (
            MCPPermissionService, PermissionMode, ApprovalStatus,
            DEFAULT_DANGEROUS_TOOLS, DEFAULT_SAFE_TOOLS,
            reset_permission_service,
        )
        reset_permission_service()
        self.svc = MCPPermissionService()
        self.Mode = PermissionMode
        self.Status = ApprovalStatus
        self.dangerous = DEFAULT_DANGEROUS_TOOLS
        self.safe = DEFAULT_SAFE_TOOLS

    def test_default_dangerous_tools(self):
        """测试默认危险工具配置"""
        self.assertEqual(self.dangerous["write_file"], self.Mode.MANUAL)
        self.assertEqual(self.dangerous["run_command"], self.Mode.MANUAL)

    def test_default_safe_tools(self):
        """测试默认安全工具配置"""
        self.assertEqual(self.safe["read_file"], self.Mode.AUTO)
        self.assertEqual(self.safe["list_directory"], self.Mode.AUTO)

    def test_set_and_get_permission(self):
        """测试设置和获取权限"""
        self.svc.set_permission("test_tool", "auto", reason="unit test")
        perm = self.svc.get_permission("test_tool")
        self.assertIsNotNone(perm)
        self.assertEqual(perm["mode"], "auto")

    def test_check_permission_blocked(self):
        """测试 blocked 权限检查"""
        self.svc.set_permission("blocked_tool", "blocked")
        mode, info = self.svc.check_permission("blocked_tool", {})
        self.assertEqual(mode, self.Mode.BLOCKED)

    def test_check_permission_auto(self):
        """测试 auto 权限检查"""
        self.svc.set_permission("auto_tool", "auto")
        mode, info = self.svc.check_permission("auto_tool", {})
        self.assertEqual(mode, self.Mode.AUTO)

    def test_check_permission_unconfigured(self):
        """测试未配置工具的默认行为"""
        mode, info = self.svc.check_permission("unconfigured_tool_xyz", {})
        # 默认应保守为 manual
        self.assertEqual(mode, self.Mode.MANUAL)

    def test_one_time_approval(self):
        """测试单次放行"""
        self.svc.set_permission("test_ot", "blocked")
        self.svc.grant_one_time_approval("test_ot", duration_sec=60)
        mode, info = self.svc.check_permission("test_ot", {})
        # 单次放行应临时变为 auto
        self.assertEqual(mode, self.Mode.AUTO)

    def test_audit_log_recording(self):
        """测试审计日志记录"""
        self.svc.record_audit(
            tool_name="test_tool",
            server_id="builtin",
            arguments={"x": 1},
            result={"success": True},
            success=True,
            duration_ms=100,
            session_id="s1",
        )
        result = self.svc.list_audit_logs(tool_name="test_tool")
        self.assertEqual(result["total"], 1)
        self.assertTrue(result["logs"][0]["success"])

    def test_audit_log_filtering(self):
        """测试审计日志过滤"""
        for i in range(5):
            self.svc.record_audit(
                tool_name=f"tool_{i}",
                server_id="builtin",
                arguments={},
                result={},
                success=(i % 2 == 0),
                duration_ms=10,
            )
        result = self.svc.list_audit_logs(success_only=True)
        self.assertGreaterEqual(result["total"], 3)  # 至少 3 个成功

    def test_bulk_set_permissions(self):
        """测试批量设置权限"""
        perms = [
            {"tool_name": "bulk_1", "mode": "auto"},
            {"tool_name": "bulk_2", "mode": "blocked"},
        ]
        results = self.svc.bulk_set_permissions(perms)
        self.assertEqual(len(results), 2)
        self.assertEqual(self.svc.get_permission("bulk_1")["mode"], "auto")
        self.assertEqual(self.svc.get_permission("bulk_2")["mode"], "blocked")


# ============================================================
# 主入口
# ============================================================
def run_all_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestExternalMCPServer))
    suite.addTests(loader.loadTestsFromTestCase(TestSkillMdParser))
    suite.addTests(loader.loadTestsFromTestCase(TestRulesResolver))
    suite.addTests(loader.loadTestsFromTestCase(TestDualTriggerCompaction))
    suite.addTests(loader.loadTestsFromTestCase(TestMCPPermissions))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
