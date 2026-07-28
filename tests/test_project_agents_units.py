"""
# ============================================================
# Project Agents 单元测试 (Cycle 9 P0-17)
# ============================================================
# 测试范围：
#   1. parser.frontmatter 解析
#   2. parser.parse_agent_file
#   3. scanner.ProjectAgentScanner
#   4. registry.ProjectAgentRegistry
#   5. registry.extract_at_references
# 目标：≥10 个测试用例，覆盖率核心路径
# ============================================================
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# 添加 backend 到路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.project_agents import (
    ProjectAgent,
    parse_agent_file,
    parse_frontmatter,
)
from app.services.project_agents.scanner import ProjectAgentScanner
from app.services.project_agents.registry import (
    ProjectAgentRegistry,
    extract_at_references,
    get_global_registry,
    reset_global_registry,
)


class TestParseFrontmatter(unittest.TestCase):
    """frontmatter 解析测试"""

    def test_simple_key_value(self):
        """简单 key: value"""
        content = "---\nname: foo\ndescription: bar\n---\nbody text"
        result = parse_frontmatter(content)
        self.assertEqual(result["name"], "foo")
        self.assertEqual(result["description"], "bar")

    def test_no_frontmatter(self):
        """无 frontmatter 应返回空 dict"""
        result = parse_frontmatter("# Just markdown\n\nNo frontmatter")
        self.assertEqual(result, {})

    def test_quoted_string(self):
        """双引号字符串"""
        content = '---\nname: "quoted name"\ndescription: \'single quoted\'\n---\n'
        result = parse_frontmatter(content)
        self.assertEqual(result["name"], "quoted name")
        self.assertEqual(result["description"], "single quoted")

    def test_boolean_values(self):
        """布尔值"""
        content = "---\nname: x\ncallable: true\n---\n"
        result = parse_frontmatter(content)
        self.assertTrue(result["callable"])
        content = "---\nname: x\ncallable: false\n---\n"
        result = parse_frontmatter(content)
        self.assertFalse(result["callable"])

    def test_inline_list(self):
        """行内列表 [a, b, c]"""
        content = "---\nname: x\ntools: [read, write, search]\n---\n"
        result = parse_frontmatter(content)
        self.assertEqual(result["tools"], ["read", "write", "search"])

    def test_block_list(self):
        """块级列表"""
        content = "---\nname: x\ntools:\n  - read\n  - write\n  - search\n---\n"
        result = parse_frontmatter(content)
        self.assertEqual(result["tools"], ["read", "write", "search"])

    def test_nested_dict(self):
        """嵌套字典"""
        content = "---\nname: x\nmetadata:\n  level: senior\n  version: 2\n---\n"
        result = parse_frontmatter(content)
        self.assertEqual(result["metadata"]["level"], "senior")
        self.assertEqual(result["metadata"]["version"], 2)

    def test_comment_and_blank(self):
        """注释与空行"""
        content = "---\n# 注释\n\nname: x\n# 另一个注释\ndescription: y\n---\n"
        result = parse_frontmatter(content)
        self.assertEqual(result.get("name"), "x")
        self.assertEqual(result.get("description"), "y")


class TestParseAgentFile(unittest.TestCase):
    """parse_agent_file 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        (self.project / ".trae" / "agents").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_basic_agent(self):
        """基本智能体解析"""
        agent_file = self.project / ".trae" / "agents" / "basic.md"
        agent_file.write_text(
            "---\nname: basic\ndescription: A basic agent\n---\nYou are helpful.\n",
            encoding="utf-8",
        )
        agent = parse_agent_file(agent_file)
        self.assertIsNotNone(agent)
        self.assertEqual(agent.name, "basic")
        self.assertEqual(agent.description, "A basic agent")
        self.assertIn("helpful", agent.prompt)
        self.assertTrue(agent.callable)

    def test_missing_name_uses_filename(self):
        """缺省 name 时使用文件名"""
        agent_file = self.project / ".trae" / "agents" / "fallback.md"
        agent_file.write_text(
            "---\ndescription: Without name\n---\nbody\n", encoding="utf-8"
        )
        agent = parse_agent_file(agent_file)
        self.assertIsNotNone(agent)
        self.assertEqual(agent.name, "fallback")

    def test_missing_description_returns_none(self):
        """缺省 description 时返回 None"""
        agent_file = self.project / ".trae" / "agents" / "no-desc.md"
        agent_file.write_text("---\nname: no-desc\n---\nbody\n", encoding="utf-8")
        agent = parse_agent_file(agent_file)
        self.assertIsNone(agent)

    def test_tools_parsed(self):
        """tools 字段正确解析"""
        agent_file = self.project / ".trae" / "agents" / "with-tools.md"
        agent_file.write_text(
            "---\nname: with-tools\ndescription: Has tools\ntools: [read, write]\n---\n",
            encoding="utf-8",
        )
        agent = parse_agent_file(agent_file)
        self.assertEqual(agent.tools, ["read", "write"])

    def test_not_callable(self):
        """callable: false"""
        agent_file = self.project / ".trae" / "agents" / "hidden.md"
        agent_file.write_text(
            "---\nname: hidden\ndescription: Not callable\ncallable: false\n---\n",
            encoding="utf-8",
        )
        agent = parse_agent_file(agent_file)
        self.assertFalse(agent.callable)

    def test_when_to_call_parsed(self):
        """when_to_call 关键词正确解析"""
        agent_file = self.project / ".trae" / "agents" / "kwd.md"
        agent_file.write_text(
            "---\nname: kwd\ndescription: Keywords\nwhen_to_call: foo, bar, baz\n---\n",
            encoding="utf-8",
        )
        agent = parse_agent_file(agent_file)
        self.assertEqual(agent.when_to_call, "foo, bar, baz")
        # 测试 matches_query
        self.assertGreater(agent.matches_query("please do foo"), 0)
        self.assertEqual(agent.matches_query("nothing matches"), 0)

    def test_project_path_inference(self):
        """project_path 从路径正确推断"""
        agent_file = self.project / ".trae" / "agents" / "infer.md"
        agent_file.write_text(
            "---\nname: infer\ndescription: Test inference\n---\n", encoding="utf-8"
        )
        agent = parse_agent_file(agent_file)
        self.assertEqual(Path(agent.project_path).absolute(), self.project.absolute())

    def test_nonexistent_file(self):
        """不存在的文件返回 None"""
        agent = parse_agent_file("/nonexistent/file.md")
        self.assertIsNone(agent)

    def test_to_dict_serialization(self):
        """to_dict 可 JSON 序列化"""
        agent_file = self.project / ".trae" / "agents" / "serde.md"
        agent_file.write_text(
            "---\nname: serde\ndescription: Serializable\nwhen_to_call: a, b\n---\nbody",
            encoding="utf-8",
        )
        agent = parse_agent_file(agent_file)
        d = agent.to_dict()
        # 必须可 JSON 序列化
        s = json.dumps(d, ensure_ascii=False)
        self.assertIn("serde", s)


class TestScanner(unittest.TestCase):
    """scanner 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_agent(self, name: str, content: str):
        agents_dir = self.project / ".trae" / "agents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        (agents_dir / f"{name}.md").write_text(content, encoding="utf-8")

    def test_scan_no_agents_dir(self):
        """无 .trae/agents 目录返回空列表"""
        scanner = ProjectAgentScanner(self.project)
        self.assertFalse(scanner.agents_dir_exists)
        self.assertEqual(scanner.scan(), [])

    def test_scan_multiple_agents(self):
        """扫描多个智能体"""
        self._write_agent(
            "a",
            "---\nname: a\ndescription: Agent A\n---\nA body",
        )
        self._write_agent(
            "b",
            "---\nname: b\ndescription: Agent B\n---\nB body",
        )
        scanner = ProjectAgentScanner(self.project)
        agents = scanner.scan()
        self.assertEqual(len(agents), 2)
        names = {a.name for a in agents}
        self.assertEqual(names, {"a", "b"})

    def test_scan_skips_underscore_files(self):
        """以下划线开头的文件被跳过"""
        self._write_agent("real", "---\nname: real\ndescription: Real\n---\nbody")
        self._write_agent("_template", "---\nname: _template\ndescription: Tpl\n---\n")
        scanner = ProjectAgentScanner(self.project)
        agents = scanner.scan()
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0].name, "real")

    def test_scan_with_errors(self):
        """scan_with_errors 返回错误列表"""
        agents_dir = self.project / ".trae" / "agents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        # 合法
        (agents_dir / "valid.md").write_text(
            "---\nname: valid\ndescription: V\n---\n", encoding="utf-8"
        )
        # 缺 description（解析失败）
        (agents_dir / "invalid.md").write_text(
            "---\nname: invalid\n---\n", encoding="utf-8"
        )
        scanner = ProjectAgentScanner(self.project)
        agents, errors = scanner.scan_with_errors()
        self.assertEqual(len(agents), 1)
        self.assertGreaterEqual(len(errors), 1)

    def test_find_by_name(self):
        """find_by_name 查找"""
        self._write_agent("findme", "---\nname: findme\ndescription: Find\n---\n")
        scanner = ProjectAgentScanner(self.project)
        agent = scanner.find_by_name("findme")
        self.assertIsNotNone(agent)
        self.assertEqual(agent.name, "findme")
        self.assertIsNone(scanner.find_by_name("nope"))

    def test_scan_nested_subdirs(self):
        """支持子目录递归扫描"""
        agents_dir = self.project / ".trae" / "agents"
        sub = agents_dir / "nested"
        sub.mkdir(parents=True, exist_ok=True)
        (sub / "deep.md").write_text(
            "---\nname: deep\ndescription: Deep agent\n---\n", encoding="utf-8"
        )
        scanner = ProjectAgentScanner(self.project)
        agents = scanner.scan()
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0].name, "deep")


class TestExtractAtReferences(unittest.TestCase):
    """@ 引用提取测试"""

    def test_simple_reference(self):
        refs = extract_at_references("hello @foo")
        self.assertEqual(refs, ["foo"])

    def test_multiple_references(self):
        refs = extract_at_references("@a and @b and @c")
        self.assertEqual(refs, ["a", "b", "c"])

    def test_dedup(self):
        refs = extract_at_references("@a @b @a @c")
        self.assertEqual(refs, ["a", "b", "c"])

    def test_no_references(self):
        refs = extract_at_references("plain text without references")
        self.assertEqual(refs, [])

    def test_empty(self):
        self.assertEqual(extract_at_references(""), [])
        self.assertEqual(extract_at_references(None), [])

    def test_with_dash_dot(self):
        """支持连字符与点"""
        refs = extract_at_references("see @code-architect and @my.agent")
        self.assertEqual(refs, ["code-architect", "my.agent"])


class TestRegistry(unittest.TestCase):
    """registry 测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        (self.project / ".trae" / "agents").mkdir(parents=True)
        self.registry = ProjectAgentRegistry()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_agent(self, name: str, desc: str, when_to_call: str = ""):
        agents_dir = self.project / ".trae" / "agents"
        (agents_dir / f"{name}.md").write_text(
            f"---\nname: {name}\ndescription: {desc}\n"
            + (f"when_to_call: {when_to_call}\n" if when_to_call else "")
            + "---\nbody",
            encoding="utf-8",
        )

    def test_register_and_list(self):
        """注册与列表"""
        self._write_agent("alpha", "Alpha agent", "alpha, beta")
        self._write_agent("gamma", "Gamma agent", "gamma")
        count = self.registry.register_project(self.project)
        self.assertEqual(count, 2)
        agents = self.registry.list_agents(self.project)
        self.assertEqual(len(agents), 2)

    def test_get_agent(self):
        """get_agent"""
        self._write_agent("only", "Only agent")
        self.registry.register_project(self.project)
        agent = self.registry.get_agent("only", self.project)
        self.assertIsNotNone(agent)
        self.assertEqual(agent.name, "only")
        self.assertIsNone(self.registry.get_agent("missing", self.project))

    def test_unregister_project(self):
        """unregister_project"""
        self._write_agent("x", "X")
        self.registry.register_project(self.project)
        self.assertEqual(len(self.registry.list_agents(self.project)), 1)
        self.assertTrue(self.registry.unregister_project(self.project))
        self.assertEqual(len(self.registry.list_agents(self.project)), 0)
        # 重复 unregister 返回 False
        self.assertFalse(self.registry.unregister_project(self.project))

    def test_refresh_replaces(self):
        """refresh 时旧智能体被替换"""
        self._write_agent("first", "First")
        self.registry.register_project(self.project)
        self.assertEqual(len(self.registry.list_agents(self.project)), 1)

        # 替换为同名不同描述
        (self.project / ".trae" / "agents" / "first.md").write_text(
            "---\nname: first\ndescription: Updated\n---\n", encoding="utf-8"
        )
        # 增加 second
        self._write_agent("second", "Second")
        self.registry.register_project(self.project)
        agents = self.registry.list_agents(self.project)
        names = {a.name for a in agents}
        self.assertEqual(names, {"first", "second"})
        descriptions = {a.description for a in agents}
        self.assertIn("Updated", descriptions)

    def test_resolve_references(self):
        """resolve_references"""
        self._write_agent("architect", "Arch")
        self._write_agent("reviewer", "Rev")
        self.registry.register_project(self.project)
        text = "请 @architect 优化 @reviewer 模块并 @unknown 关注"
        refs = self.registry.resolve_references(text, self.project)
        self.assertEqual(set(refs.keys()), {"architect", "reviewer", "unknown"})
        self.assertIsNotNone(refs["architect"])
        self.assertIsNotNone(refs["reviewer"])
        self.assertIsNone(refs["unknown"])

    def test_find_suggested(self):
        """find_suggested 关键词匹配"""
        self._write_agent("arch", "Architecture", "架构, 设计, 重构")
        self._write_agent("test", "Testing", "测试, 单测, e2e")
        self.registry.register_project(self.project)
        suggestions = self.registry.find_suggested("请帮我做架构设计", self.project)
        self.assertGreater(len(suggestions), 0)
        self.assertEqual(suggestions[0][0].name, "arch")

    def test_get_stats(self):
        """get_stats"""
        self._write_agent("a", "A")
        self._write_agent("b", "B")
        self.registry.register_project(self.project)
        stats = self.registry.get_stats()
        self.assertEqual(stats["projects"], 1)
        self.assertEqual(stats["agents"], 2)

    def test_global_registry_singleton(self):
        """全局注册表单例"""
        r1 = get_global_registry()
        r2 = get_global_registry()
        self.assertIs(r1, r2)
        # 重置
        reset_global_registry()
        r3 = get_global_registry()
        self.assertIsNot(r1, r3)


class TestIntegrationWithFixture(unittest.TestCase):
    """使用 /tmp 真实 fixture 集成测试"""

    @classmethod
    def setUpClass(cls):
        cls.fixture = Path("/tmp/test-projects/sample-trae-project")
        if not cls.fixture.exists():
            raise unittest.SkipTest("fixture not prepared")

    def test_real_fixture_scan(self):
        """真实 fixture 扫描"""
        scanner = ProjectAgentScanner(self.fixture)
        agents = scanner.scan()
        # 至少应包含 4 个真实智能体（_template 被跳过）
        names = {a.name for a in agents}
        self.assertIn("code-architect", names)
        self.assertIn("security-reviewer", names)
        self.assertIn("test-engineer", names)
        self.assertIn("doc-writer", names)
        # _template 被跳过
        self.assertNotIn("_template", names)

    def test_real_fixture_suggest(self):
        """真实 fixture 推荐"""
        scanner = ProjectAgentScanner(self.fixture)
        agents = scanner.scan()
        arch = next(a for a in agents if a.name == "code-architect")
        score = arch.matches_query("请帮我做架构设计与模块重构")
        self.assertGreater(score, 0)

        sec = next(a for a in agents if a.name == "security-reviewer")
        score = sec.matches_query("检查这个接口的鉴权与加密")
        self.assertGreater(score, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
