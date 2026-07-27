"""
# Cycle 8 P0-13: Custom Commands Unit Tests
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure backend is on path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(PROJECT_ROOT))


class TestCustomCommandParser(unittest.TestCase):
    """T1: CustomCommandParser 测试"""

    def setUp(self):
        from app.services.custom_commands.parser import parse_command_content
        self.parse = parse_command_content

    def test_T1_01_parse_basic_frontmatter(self):
        """T1-01: 解析基本 frontmatter"""
        content = """---
Name: hello
Description: Says hello
---

Instructions: |
  Say hello to {name}
"""
        cmd = self.parse(content, fallback_name="hello")
        self.assertEqual(cmd.name, "hello")
        self.assertEqual(cmd.description, "Says hello")
        self.assertIn("Say hello to {name}", cmd.instructions)

    def test_T1_02_parse_with_args(self):
        """T1-02: 解析带参数的命令"""
        content = """---
Name: greet
Description: 问候某人
Args:
  - name: target
    required: true
    type: string
    description: 问候对象
  - name: style
    required: false
    type: string
    choices: [formal, casual]
    default: casual
---

Instructions: |
  Greet {target} in {style} style
"""
        cmd = self.parse(content, fallback_name="greet")
        self.assertEqual(cmd.name, "greet")
        self.assertEqual(len(cmd.args), 2)
        self.assertEqual(cmd.args[0].name, "target")
        self.assertTrue(cmd.args[0].required)
        self.assertEqual(cmd.args[1].choices, ["formal", "casual"])

    def test_T1_03_parse_with_aliases_and_icon(self):
        """T1-03: 解析别名和图标"""
        content = """---
Name: code-review
Description: 代码审查
Icon: 🔍
Aliases: [cr, review]
Category: code-quality
Permission: admin
---

Instructions: |
  Review code
"""
        cmd = self.parse(content, fallback_name="code-review")
        self.assertEqual(cmd.icon, "🔍")
        self.assertEqual(cmd.aliases, ["cr", "review"])
        self.assertEqual(cmd.category, "code-quality")
        self.assertEqual(cmd.permission, "admin")

    def test_T1_04_parse_no_frontmatter(self):
        """T1-04: 无 frontmatter 时使用 fallback_name"""
        content = "Just plain markdown content"
        cmd = self.parse(content, fallback_name="plain-cmd")
        self.assertEqual(cmd.name, "plain-cmd")
        self.assertEqual(cmd.description, "Just plain markdown content")

    def test_T1_05_parse_empty_content(self):
        """T1-05: 空内容"""
        cmd = self.parse("", fallback_name="empty")
        self.assertEqual(cmd.name, "empty")
        self.assertEqual(cmd.description, "(空文件)")
        self.assertIsNotNone(cmd.parse_error)

    def test_T1_06_parse_invalid_yaml(self):
        """T1-06: 无效 YAML 不崩溃"""
        content = """---
Name: test
Description: 解析错误测试
invalid yaml: : :
---

Instructions: |
  Test
"""
        cmd = self.parse(content, fallback_name="test")
        # 无效 YAML 应该使用 fallback
        self.assertIsNotNone(cmd.name)

    def test_T1_07_parse_allowed_tools(self):
        """T1-07: 解析 AllowedTools"""
        content = """---
Name: tool-cmd
Description: 测试工具
AllowedTools: [code_search, file_read, web_search]
---

Instructions: |
  Use tools
"""
        cmd = self.parse(content, fallback_name="tool-cmd")
        self.assertEqual(cmd.allowed_tools, ["code_search", "file_read", "web_search"])

    def test_T1_08_extract_instructions_block_scalar(self):
        """T1-08: 提取 Instructions 块字符串"""
        content = """---
Name: x
Description: y
---

Instructions: |
  Multi-line
  instructions
  here
"""
        cmd = self.parse(content, fallback_name="x")
        self.assertIn("Multi-line", cmd.instructions)
        self.assertIn("instructions", cmd.instructions)
        self.assertIn("here", cmd.instructions)

    def test_T1_09_render_instructions_with_args(self):
        """T1-09: 渲染参数占位符"""
        from app.services.custom_commands.parser import render_instructions
        content = """---
Name: greet
Description: test
---

Instructions: |
  Hello {name}, you are {age} years old
"""
        cmd = self.parse(content, fallback_name="greet")
        rendered = render_instructions(cmd, {"name": "Alice", "age": "30"})
        self.assertIn("Alice", rendered)
        self.assertIn("30", rendered)
        self.assertNotIn("{name}", rendered)

    def test_T1_10_missing_required_fields(self):
        """T1-10: 缺少必填字段时使用 fallback"""
        content = """---
Category: misc
---

Instructions: |
  Test
"""
        cmd = self.parse(content, fallback_name="no-name")
        # Name 缺失 → 使用 fallback
        self.assertEqual(cmd.name, "no-name")
        # Description 缺失
        self.assertEqual(cmd.description, "(无描述)")


class TestCustomCommandsScanner(unittest.TestCase):
    """T2: CustomCommandsScanner 测试"""

    def setUp(self):
        from app.services.custom_commands.scanner import CustomCommandsScanner
        self.tmpdir = tempfile.mkdtemp()
        self.scanner = CustomCommandsScanner.get_instance()
        # 清理单例缓存
        self.scanner.clear_cache()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _create_file(self, rel_path: str, content: str) -> None:
        full = Path(self.tmpdir) / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")

    def test_T2_01_scan_project_empty(self):
        """T2-01: 扫描空目录"""
        self._create_file(".trae/commands/.gitkeep", "")
        result = self.scanner.scan_project(self.tmpdir)
        self.assertEqual(result, [])

    def test_T2_02_scan_project_single_file(self):
        """T2-02: 扫描单个命令文件"""
        self._create_file(".trae/commands/hello.md", """---
Name: hello
Description: Say hello
---

Instructions: |
  Hello
""")
        result = self.scanner.scan_project(self.tmpdir)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "hello")
        self.assertEqual(result[0].scope, "project")

    def test_T2_03_scan_project_nested_dirs(self):
        """T2-03: 扫描 3 级嵌套目录"""
        self._create_file(".trae/commands/code-review/security.md", """---
Name: security-review
Description: Security review
Category: code-review/security
---

Instructions: |
  Check security
""")
        self._create_file(".trae/commands/test/unit-test.md", """---
Name: unit-test
Description: Unit test
Category: test/unit
---

Instructions: |
  Run unit tests
""")
        result = self.scanner.scan_project(self.tmpdir)
        self.assertEqual(len(result), 2)
        names = {c.name for c in result}
        self.assertIn("security-review", names)
        self.assertIn("unit-test", names)
        for c in result:
            self.assertTrue(c.parent_category.startswith(("code-review", "test")))

    def test_T2_04_scan_project_skip_non_md(self):
        """T2-04: 跳过非 .md 文件"""
        self._create_file(".trae/commands/readme.txt", "just text")
        self._create_file(".trae/commands/cmd.md", """---
Name: cmd
Description: test
---

Body
""")
        result = self.scanner.scan_project(self.tmpdir)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "cmd")

    def test_T2_05_scan_project_max_depth(self):
        """T2-05: 超过 3 级嵌套深度被忽略"""
        deep_path = ".trae/commands/a/b/c/d/deep.md"
        self._create_file(deep_path, """---
Name: deep
Description: too deep
---

Body
""")
        result = self.scanner.scan_project(self.tmpdir)
        # 4 级深度应被忽略
        self.assertEqual(len(result), 0)

    def test_T2_06_scan_all_merges_project_and_global(self):
        """T2-06: scan_all 合并项目级 + 全局级"""
        from app.services.custom_commands.scanner import CustomCommandsScanner
        # 项目级
        self._create_file(".trae/commands/proj-cmd.md", """---
Name: proj-cmd
Description: project
---

Body
""")
        # 全局级：模拟 home 目录
        original_home = os.environ.get("HOME")
        fake_home = tempfile.mkdtemp()
        os.environ["HOME"] = fake_home
        try:
            Path(fake_home, ".trae/commands").mkdir(parents=True, exist_ok=True)
            (Path(fake_home) / ".trae/commands/global-cmd.md").write_text("""---
Name: global-cmd
Description: global
---

Body
""", encoding="utf-8")
            scanner = CustomCommandsScanner()
            scanner.clear_cache()
            result = scanner.scan_all(project_path=self.tmpdir)
            names = {c.name for c in result.commands}
            self.assertIn("proj-cmd", names)
            self.assertIn("global-cmd", names)
            self.assertEqual(result.project_count, 1)
            self.assertEqual(result.global_count, 1)
        finally:
            if original_home:
                os.environ["HOME"] = original_home
            shutil.rmtree(fake_home, ignore_errors=True)

    def test_T2_07_project_overrides_global(self):
        """T2-07: 同名命令项目级覆盖全局级"""
        from app.services.custom_commands.scanner import CustomCommandsScanner
        self._create_file(".trae/commands/dup.md", """---
Name: dup
Description: project version
---

Body
""")
        original_home = os.environ.get("HOME")
        fake_home = tempfile.mkdtemp()
        os.environ["HOME"] = fake_home
        try:
            Path(fake_home, ".trae/commands").mkdir(parents=True, exist_ok=True)
            (Path(fake_home) / ".trae/commands/dup.md").write_text("""---
Name: dup
Description: global version
---

Body
""", encoding="utf-8")
            scanner = CustomCommandsScanner()
            scanner.clear_cache()
            result = scanner.scan_all(project_path=self.tmpdir)
            # 只应保留一个 dup（项目级）
            self.assertEqual(len([c for c in result.commands if c.name == "dup"]), 1)
            dup_cmd = next(c for c in result.commands if c.name == "dup")
            self.assertEqual(dup_cmd.description, "project version")
        finally:
            if original_home:
                os.environ["HOME"] = original_home
            shutil.rmtree(fake_home, ignore_errors=True)

    def test_T2_08_scan_result_categories(self):
        """T2-08: ScanResult 收集分类"""
        self._create_file(".trae/commands/cat1/a.md", """---
Name: a
Description: a
Category: alpha
---

Body
""")
        self._create_file(".trae/commands/cat2/b.md", """---
Name: b
Description: b
Category: beta
---

Body
""")
        from app.services.custom_commands.scanner import CustomCommandsScanner
        scanner = CustomCommandsScanner()
        scanner.clear_cache()
        result = scanner.scan_all(project_path=self.tmpdir)
        # 至少包含 cat1/cat2 目录分类
        self.assertIn("cat1", result.categories)
        self.assertIn("cat2", result.categories)


class TestCustomCommandsService(unittest.TestCase):
    """T3: CustomCommandsService 测试"""

    def setUp(self):
        from app.services.custom_commands.service import CustomCommandsService
        from app.services.custom_commands.scanner import CustomCommandsScanner
        self.tmpdir = tempfile.mkdtemp()
        # 清理单例缓存
        scanner = CustomCommandsScanner.get_instance()
        scanner.clear_cache()
        # 重置 service 单例（用新实例）
        self.service = CustomCommandsService.get_instance()
        self.service._commands.clear()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _create_cmd(self, name: str, scope: str = "project") -> None:
        if scope == "project":
            base = Path(self.tmpdir) / ".trae/commands"
        else:
            base = Path(self.tmpdir) / "home/.trae/commands"
        base.mkdir(parents=True, exist_ok=True)
        (base / f"{name}.md").write_text(f"""---
Name: {name}
Description: {name} description
---

Instructions: |
  Test {name}
""", encoding="utf-8")

    def test_T3_01_refresh_scans_project(self):
        """T3-01: refresh 扫描项目级"""
        self._create_cmd("cmd1")
        result = self.service.refresh(project_path=self.tmpdir)
        self.assertGreaterEqual(result.project_count, 1)

    def test_T3_02_list_commands(self):
        """T3-02: list_commands 列出命令"""
        self._create_cmd("alpha")
        self._create_cmd("beta")
        self.service.refresh(project_path=self.tmpdir)
        commands = self.service.list_commands()
        names = {c.name for c in commands}
        self.assertIn("alpha", names)
        self.assertIn("beta", names)

    def test_T3_03_get_command(self):
        """T3-03: get_command 按名称获取"""
        self._create_cmd("findme")
        self.service.refresh(project_path=self.tmpdir)
        cmd = self.service.get_command("findme")
        self.assertIsNotNone(cmd)
        self.assertEqual(cmd.description, "findme description")

    def test_T3_04_get_command_user_prefix(self):
        """T3-04: get_command 支持 user- 前缀"""
        self._create_cmd("prefixed")
        self.service.refresh(project_path=self.tmpdir)
        cmd = self.service.get_command("user-prefixed")
        self.assertIsNotNone(cmd)
        self.assertEqual(cmd.name, "prefixed")

    def test_T3_05_execute_command_basic(self):
        """T3-05: 执行命令生成提示词"""
        self._create_cmd("exec")
        self.service.refresh(project_path=self.tmpdir)
        result = self.service.execute_command("exec", {"x": "1"})
        self.assertTrue(result.success)
        self.assertIn("Test exec", result.instructions)

    def test_T3_06_execute_command_missing_required(self):
        """T3-06: 缺少必填参数时失败"""
        # 创建带必填参数的命令
        cmd_path = Path(self.tmpdir) / ".trae/commands/required.md"
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text("""---
Name: required
Description: test
Args:
  - name: arg1
    required: true
    type: string
---

Instructions: |
  {arg1}
""", encoding="utf-8")
        self.service.refresh(project_path=self.tmpdir)
        result = self.service.execute_command("required", {})
        self.assertFalse(result.success)
        self.assertIn("arg1", result.error)

    def test_T3_07_execute_command_not_found(self):
        """T3-07: 不存在的命令"""
        result = self.service.execute_command("nonexistent", {})
        self.assertFalse(result.success)
        self.assertIn("不存在", result.error)

    def test_T3_08_execute_with_arg_replacement(self):
        """T3-08: 参数占位符替换"""
        cmd_path = Path(self.tmpdir) / ".trae/commands/replace.md"
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text("""---
Name: replace
Description: test
---

Instructions: |
  Hello {name}, welcome to {place}
""", encoding="utf-8")
        self.service.refresh(project_path=self.tmpdir)
        result = self.service.execute_command("replace", {"name": "Alice", "place": "Hermes"})
        self.assertTrue(result.success)
        self.assertIn("Alice", result.instructions)
        self.assertIn("Hermes", result.instructions)
        self.assertNotIn("{name}", result.instructions)

    def test_T3_09_register_unregister(self):
        """T3-09: 手动注册/注销命令"""
        from app.services.custom_commands.parser import CustomCommand
        cmd = CustomCommand(name="manual", description="manual test", scope="project")
        self.service.register_command(cmd)
        self.assertIsNotNone(self.service.get_command("manual"))
        removed = self.service.unregister_command("manual")
        self.assertTrue(removed)
        self.assertIsNone(self.service.get_command("manual"))

    def test_T3_10_summary(self):
        """T3-10: 摘要统计"""
        self._create_cmd("s1")
        self._create_cmd("s2")
        self.service.refresh(project_path=self.tmpdir)
        summary = self.service.get_summary()
        self.assertGreaterEqual(summary["total"], 2)
        self.assertIn("categories", summary)
        self.assertIn("by_scope", summary)


class TestIntegrationWithSlashRegistry(unittest.TestCase):
    """T4: 与 SlashCommandRegistry 集成测试"""

    def setUp(self):
        from app.services.custom_commands.service import CustomCommandsService
        from app.services.custom_commands.scanner import CustomCommandsScanner
        from app.services.slash_command_registry import SlashCommandRegistry
        self.tmpdir = tempfile.mkdtemp()
        # 清理所有单例
        CustomCommandsScanner.get_instance().clear_cache()
        service = CustomCommandsService.get_instance()
        service._commands.clear()
        # 清理 registry 中已有的 user- 前缀命令
        registry = SlashCommandRegistry.get_instance()
        for cmd_name in list(registry._commands.keys()):
            if cmd_name.startswith("user-"):
                registry.unregister(cmd_name)
        self.service = service
        self.registry = registry

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T4_01_sync_to_registry(self):
        """T4-01: refresh 同步到 SlashCommandRegistry"""
        cmd_path = Path(self.tmpdir) / ".trae/commands/synccmd.md"
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text("""---
Name: synccmd
Description: sync test
Icon: ⚡
---

Body
""", encoding="utf-8")
        self.service.refresh(project_path=self.tmpdir)
        # 应在 registry 中能找到 user-synccmd
        synced = self.registry.get("user-synccmd")
        self.assertIsNotNone(synced)
        self.assertEqual(synced.icon, "⚡")
        self.assertEqual(synced.built_in, False)

    def test_T4_02_multiple_commands_synced(self):
        """T4-02: 多个命令全部同步"""
        for name in ("cmd1", "cmd2", "cmd3"):
            cmd_path = Path(self.tmpdir) / f".trae/commands/{name}.md"
            cmd_path.parent.mkdir(parents=True, exist_ok=True)
            cmd_path.write_text(f"""---
Name: {name}
Description: {name}
---

Body
""", encoding="utf-8")
        self.service.refresh(project_path=self.tmpdir)
        for name in ("cmd1", "cmd2", "cmd3"):
            synced = self.registry.get(f"user-{name}")
            self.assertIsNotNone(synced)

    def test_T4_03_registry_list_includes_user_commands(self):
        """T4-03: registry 列表包含用户命令"""
        cmd_path = Path(self.tmpdir) / ".trae/commands/listed.md"
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text("""---
Name: listed
Description: listed test
---

Body
""", encoding="utf-8")
        self.service.refresh(project_path=self.tmpdir)
        all_cmds = self.registry.list_all(enabled_only=False)
        names = {c.name for c in all_cmds}
        self.assertIn("user-listed", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
