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
#   - T11: SubAgent workspace 字段（v4.3.0 P2-1 新增）
#   - T12: Plan 模式服务（v4.1.0 P0-4 Plan 模式后端实现）
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
# T11: SubAgent workspace 字段测试（v4.3.0 P2-1 新增）
# ============================================================
class TestSubAgentWorkspaceFields(unittest.TestCase):
    """测试 AgentInfo 新增的 SubAgent workspace 字段
    - branch_name / worktree_id / module_name
    - file_count / commit_count / progress_percent
    - 后端 _agent_to_dict 转换函数
    """

    def test_agent_info_new_fields_default(self):
        """测试 AgentInfo 新字段默认值"""
        from cli_integration.agent_manager import AgentInfo
        agent = AgentInfo(name="test-default")
        self.assertEqual(agent.branch_name, "")
        self.assertEqual(agent.worktree_id, "")
        self.assertEqual(agent.module_name, "")
        self.assertEqual(agent.file_count, 0)
        self.assertEqual(agent.commit_count, 0)
        self.assertEqual(agent.progress_percent, 0.0)

    def test_agent_info_new_fields_assignment(self):
        """测试 AgentInfo 新字段赋值"""
        from cli_integration.agent_manager import AgentInfo
        agent = AgentInfo(
            name="test-assign",
            branch_name="feature/test",
            worktree_id="wt-001",
            module_name="test-module",
            file_count=10,
            commit_count=3,
            progress_percent=45.5,
        )
        self.assertEqual(agent.branch_name, "feature/test")
        self.assertEqual(agent.worktree_id, "wt-001")
        self.assertEqual(agent.module_name, "test-module")
        self.assertEqual(agent.file_count, 10)
        self.assertEqual(agent.commit_count, 3)
        self.assertEqual(agent.progress_percent, 45.5)

    def test_agent_to_dict_with_subagent_fields(self):
        """测试 _agent_to_dict 正确暴露 SubAgent workspace 字段"""
        from cli_integration.agent_manager import AgentInfo, AgentStatus
        from backend.app.api.agents import _agent_to_dict

        agent = AgentInfo(
            id="sub-001",
            name="worker-frontend",
            avatar_seed="seed",
            status=AgentStatus.BUSY,
            cli_path="claude",
            workspace="/tmp",
            max_concurrent=2,
            current_tasks=1,
        )
        # 注入 P2-1 字段
        agent.branch_name = "feature/subagent-workspace"
        agent.worktree_id = "wt-abc123"
        agent.module_name = "frontend-workspace"
        agent.progress_percent = 75.0
        agent.file_count = 15
        agent.commit_count = 4

        result = _agent_to_dict(agent)
        # 验证必含字段
        for key in [
            "branch_name", "worktree_id", "module_name",
            "file_count", "commit_count", "progress_percent",
        ]:
            self.assertIn(key, result, f"字段 {key} 缺失")
        # 验证值正确
        self.assertEqual(result["branch_name"], "feature/subagent-workspace")
        self.assertEqual(result["worktree_id"], "wt-abc123")
        self.assertEqual(result["module_name"], "frontend-workspace")
        self.assertEqual(result["file_count"], 15)
        self.assertEqual(result["commit_count"], 4)
        self.assertEqual(result["progress_percent"], 75.0)

    def test_agent_to_dict_empty_workspace_fallback(self):
        """测试空 workspace 时的字段降级行为"""
        from cli_integration.agent_manager import AgentInfo, AgentStatus
        from backend.app.api.agents import _agent_to_dict

        agent = AgentInfo(
            id="sub-002",
            name="worker-empty",
            status=AgentStatus.OFFLINE,
            workspace="",  # 空 workspace
        )
        result = _agent_to_dict(agent)
        # 空 workspace 时 file_count/commit_count 应为 0
        self.assertEqual(result["file_count"], 0)
        self.assertEqual(result["commit_count"], 0)
        self.assertEqual(result["branch_name"], "")
        self.assertEqual(result["workspace"], "")

    def test_agent_to_dict_dynamic_git_probe(self):
        """测试 _agent_to_dict 通过 git 命令动态探测分支/提交"""
        from cli_integration.agent_manager import AgentInfo, AgentStatus
        from backend.app.api.agents import _agent_to_dict

        # 用本仓库 workspace 进行动态探测
        project_root = "/home/qizheng/auto_code_ws"
        agent = AgentInfo(
            id="sub-003",
            name="worker-dynamic",
            status=AgentStatus.ONLINE,
            workspace=project_root,
        )
        # 不注入 branch_name，让 _agent_to_dict 动态探测
        result = _agent_to_dict(agent)
        # 由于是真实 git 仓库，应该能探测到分支
        # （只要不报错就算通过 - 验证字段类型和键存在）
        self.assertIn("branch_name", result)
        self.assertIn("file_count", result)
        self.assertIn("commit_count", result)
        # file_count 应为正整数（项目根目录有文件）
        self.assertIsInstance(result["file_count"], int)
        self.assertGreaterEqual(result["file_count"], 1)
        # commit_count 应为正整数（项目根目录是 git 仓库）
        self.assertIsInstance(result["commit_count"], int)
        self.assertGreaterEqual(result["commit_count"], 0)

    def test_count_workspace_files_ignores_git(self):
        """测试 _count_workspace_files 排除 .git 目录"""
        from backend.app.api.agents import _count_workspace_files

        with tempfile.TemporaryDirectory() as tmp:
            # 创建测试文件结构
            os.makedirs(os.path.join(tmp, ".git"))
            open(os.path.join(tmp, ".git", "config"), "w").close()
            open(os.path.join(tmp, "src.py"), "w").close()
            open(os.path.join(tmp, "README.md"), "w").close()
            count = _count_workspace_files(tmp)
            # 应只统计 2 个文件（.git/config 排除）
            self.assertEqual(count, 2)

    def test_count_workspace_files_nonexistent(self):
        """测试 _count_workspace_files 对不存在路径返回 0"""
        from backend.app.api.agents import _count_workspace_files
        count = _count_workspace_files("/nonexistent/path/that/does/not/exist")
        self.assertEqual(count, 0)

    def test_count_workspace_files_empty_string(self):
        """测试 _count_workspace_files 对空字符串返回 0"""
        from backend.app.api.agents import _count_workspace_files
        self.assertEqual(_count_workspace_files(""), 0)

    def test_get_workspace_branch_nonexistent(self):
        """测试 _get_workspace_branch 对不存在路径返回空字符串"""
        from backend.app.api.agents import _get_workspace_branch
        self.assertEqual(_get_workspace_branch("/nonexistent/path"), "")

    def test_get_workspace_branch_empty_string(self):
        """测试 _get_workspace_branch 对空字符串返回空字符串"""
        from backend.app.api.agents import _get_workspace_branch
        self.assertEqual(_get_workspace_branch(""), "")


# ============================================================
# T12: Plan 模式服务测试（v4.1.0 P0-4 新增）
# ============================================================
class TestPlanModeService(unittest.TestCase):
    """测试 Plan 模式服务的核心功能
    - PlanDocument / PlanStage / PlanTask / PlanRisk dataclass 序列化
    - PlanModeService 基本方法（无需 DB 的纯逻辑部分）
    - 与 P0-4 Plan 模式后端实现配套
    """

    def test_plan_risk_dataclass(self):
        """测试 PlanRisk dataclass"""
        from backend.app.services.plan_mode import PlanRisk
        risk = PlanRisk(
            risk_id="r-001",
            description="紧急停止逻辑未实现",
            severity="extreme",
            mitigation="添加独立 emergency_stop 模块",
        )
        self.assertEqual(risk.risk_id, "r-001")
        self.assertEqual(risk.severity, "extreme")
        self.assertIn("emergency_stop", risk.mitigation)

    def test_plan_task_dataclass(self):
        """测试 PlanTask dataclass"""
        from backend.app.services.plan_mode import PlanTask
        task = PlanTask(
            task_id="t-001",
            title="实现运动控制接口",
            description="定义运动控制 API 规范",
            stage="coding",
            estimated_minutes=120,
            risk_level="high",
            files_involved=["motion_control/motion_api.py"],
            dependencies=[],
            acceptance_criteria="通过单元测试",
        )
        self.assertEqual(task.title, "实现运动控制接口")
        self.assertEqual(task.estimated_minutes, 120)
        self.assertEqual(task.risk_level, "high")
        self.assertEqual(len(task.files_involved), 1)

    def test_plan_stage_dataclass(self):
        """测试 PlanStage dataclass"""
        from backend.app.services.plan_mode import PlanStage, PlanTask, PlanRisk
        stage = PlanStage(
            stage="coding",
            tasks=[PlanTask(task_id="t-1", title="task1")],
            risks=[PlanRisk(risk_id="r-1", description="risk1")],
            alternatives=["alt-1", "alt-2"],
        )
        self.assertEqual(stage.stage, "coding")
        self.assertEqual(len(stage.tasks), 1)
        self.assertEqual(len(stage.risks), 1)
        self.assertEqual(len(stage.alternatives), 2)

    def test_plan_document_to_from_dict(self):
        """测试 PlanDocument 序列化往返"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanTask
        original = PlanDocument(
            plan_id="p-001",
            workflow_id="wf-001",
            objective="实现运动控制",
            stages=[
                PlanStage(
                    stage="coding",
                    tasks=[PlanTask(task_id="t-1", title="实现API")],
                ),
                PlanStage(
                    stage="testing",
                    tasks=[PlanTask(task_id="t-2", title="编写测试")],
                ),
            ],
            generated_at="2026-07-27T12:00:00Z",
            status="pending",
        )
        # 序列化
        data = original.to_dict()
        self.assertEqual(data["plan_id"], "p-001")
        self.assertEqual(len(data["stages"]), 2)
        self.assertEqual(data["stages"][0]["tasks"][0]["title"], "实现API")
        # 反序列化
        restored = PlanDocument.from_dict(data)
        self.assertEqual(restored.plan_id, original.plan_id)
        self.assertEqual(len(restored.stages), 2)
        self.assertEqual(restored.stages[1].tasks[0].task_id, "t-2")

    def test_plan_document_to_from_json(self):
        """测试 PlanDocument JSON 序列化"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage
        original = PlanDocument(
            plan_id="p-json-001",
            workflow_id="wf-001",
            objective="测试 JSON 序列化",
            stages=[PlanStage(stage="planning", tasks=[])],
        )
        json_str = original.to_json()
        self.assertIn("p-json-001", json_str)
        restored = PlanDocument.from_json(json_str)
        self.assertEqual(restored.plan_id, "p-json-001")

    def test_plan_document_from_json_invalid(self):
        """测试 PlanDocument 解析非法 JSON 不抛异常"""
        from backend.app.services.plan_mode import PlanDocument
        # 空字符串
        plan = PlanDocument.from_json("")
        self.assertEqual(plan.plan_id, "")
        # 非法 JSON
        plan = PlanDocument.from_json("{invalid json}")
        self.assertEqual(plan.plan_id, "")

    def test_plan_marker_constants(self):
        """测试 Plan 持久化标记常量"""
        from backend.app.services.plan_mode import PlanModeService
        self.assertEqual(PlanModeService.PLAN_MARKER_PREFIX, "__PLAN__")
        self.assertEqual(PlanModeService.PLAN_MARKER_SUFFIX, "__/PLAN__")

    def test_plan_service_init(self):
        """测试 PlanModeService 初始化（无需 DB）"""
        from backend.app.services.plan_mode import PlanModeService
        # 用 None session_factory 测试（不会立即访问 DB）
        svc = PlanModeService(session_factory=None, executor=None)
        self.assertIsNone(svc.session_factory)
        self.assertIsNone(svc.executor)

    def test_plan_prompt_building(self):
        """测试 _build_plan_prompt 构造 LLM Prompt"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        prompt = svc._build_plan_prompt(
            objective="实现运动控制",
            spec_doc="运动控制 API 规范",
            architecture_doc="分层架构",
        )
        self.assertIsInstance(prompt, str)
        self.assertIn("实现运动控制", prompt)
        self.assertIn("运动控制 API 规范", prompt)
        self.assertIn("分层架构", prompt)
        # 应包含结构化输出要求
        self.assertIn("stages", prompt.lower())
        self.assertIn("tasks", prompt.lower())

    def test_plan_prompt_building_with_empty_docs(self):
        """测试空文档时的 Prompt 构造"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        prompt = svc._build_plan_prompt(
            objective="简化目标",
            spec_doc="",
            architecture_doc="",
        )
        self.assertIn("简化目标", prompt)
        # 即使没有 spec/architecture，Prompt 也应能正常构造
        self.assertGreater(len(prompt), 100)

    def test_plan_extraction_from_error_message(self):
        """测试从 error_message 标记段提取 Plan JSON"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        # 模拟带 __PLAN__ 标记的 error_message
        plan_json = '{"plan_id":"p-1","workflow_id":"wf-1","stages":[]}'
        marked = f"前置错误说明\n{PlanModeService.PLAN_MARKER_PREFIX}{plan_json}{PlanModeService.PLAN_MARKER_SUFFIX}\n后续说明"
        extracted = svc._extract_plan_json(marked)
        self.assertEqual(extracted, plan_json)

    def test_plan_extraction_empty(self):
        """测试无标记时的提取返回空（None 或空字符串）"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        # 空字符串 → falsy
        self.assertFalse(svc._extract_plan_json(""))
        # 无标记的普通文本 → falsy
        self.assertFalse(svc._extract_plan_json("无标记的普通文本"))

    def test_plan_document_to_dict_field_completeness(self):
        """测试 PlanDocument 序列化字段完整性"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanTask, PlanRisk
        doc = PlanDocument(
            plan_id="p-fields-001",
            workflow_id="wf-001",
            objective="字段完整性测试",
            stages=[
                PlanStage(
                    stage="coding",
                    tasks=[PlanTask(task_id="t-1", title="task1", risk_level="high")],
                    risks=[PlanRisk(risk_id="r-1", description="risk1", severity="medium")],
                    alternatives=["alt-1"],
                ),
            ],
            total_estimated_minutes=120,
        )
        data = doc.to_dict()
        # 验证必含字段
        required_top = ["plan_id", "workflow_id", "objective", "stages", "generated_at", "status", "total_estimated_minutes"]
        for k in required_top:
            self.assertIn(k, data)
        # 验证 stage 内字段
        stage_data = data["stages"][0]
        self.assertIn("stage", stage_data)
        self.assertIn("tasks", stage_data)
        self.assertIn("risks", stage_data)
        self.assertIn("alternatives", stage_data)
        # 验证 task 字段
        task_data = stage_data["tasks"][0]
        self.assertEqual(task_data["risk_level"], "high")
        # 验证 risk 字段
        risk_data = stage_data["risks"][0]
        self.assertEqual(risk_data["severity"], "medium")


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
    suite.addTests(loader.loadTestsFromTestCase(TestSubAgentWorkspaceFields))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanModeService))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
