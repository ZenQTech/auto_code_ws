"""
# ============================================================
# .trae/rules/ Multi-Level Loader 单元测试
# ============================================================
# 测试范围：
#   1. Rule 数据类
#   2. _parse_scalar / _parse_frontmatter 解析
#   3. parse_rule_file 单文件解析
#   4. TraeRulesLoader 扫描器
#   5. TraeRulesRegistry 跨项目注册表
#   6. 多级嵌套 + _template 跳过
#   7. 类别推断
#   8. 优先级排序
#   9. 全局单例
#  10. API 校验函数
#  11. 常量与 pattern
#  12. 端到端文件系统测试
# 测试目标：100% 通过率
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================
"""

import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

WORKSPACE = "/home/qizheng/auto_code_ws"
sys.path.insert(0, WORKSPACE)

from backend.app.services.trae_rules_loader import (  # noqa: E402
    DEFAULT_PRIORITY,
    MAX_CATEGORY_DEPTH,
    MAX_PRIORITY,
    MIN_PRIORITY,
    RULES_DIRNAME,
    RULES_FILENAME_PATTERN,
    RULES_FILENAME_STEM_PATTERN,
    RULES_SUBDIR,
    Rule,
    TraeRulesLoader,
    TraeRulesRegistry,
    _parse_frontmatter,
    _parse_scalar,
    get_global_rules_registry,
    parse_rule_file,
    reset_global_rules_registry,
)
from backend.app.api.trae_rules_loader import (  # noqa: E402
    _validate_category,
    _validate_project_path,
    _validate_rule_name,
)


# ============================================================
# 测试数据
# ============================================================

SAMPLE_RULE_V1 = """---
name: python-style
description: Python 编码风格规则
when_to_use: Python, PEP8, 风格
priority: 80
tools:
  - read_file
  - edit_file
metadata:
  category: language
  level: standard
---

# Python Style Rule

遵循 PEP 8 编码规范。
"""

SAMPLE_RULE_INLINE_LIST = """---
name: react-hooks
description: React Hooks 规范
tools: [read_file, edit_file]
priority: 75
---

React hooks content.
"""

SAMPLE_RULE_MINIMAL = """---
name: minimal
---

minimal content
"""

SAMPLE_RULE_NO_NAME = """---
description: missing name
---

body
"""

SAMPLE_RULE_INVALID_NAME = """---
name: invalid name with spaces
---

body
"""


def _create_rule_with_name(
    dir_path: Path, name: str, priority: int = 50, category_meta: str = "test"
) -> Path:
    """创建带特定 name 的规则文件"""
    content = f"""---
name: {name}
description: Description for {name}
priority: {priority}
when_to_use: when to use {name}
metadata:
  category: {category_meta}
---

# Rule {name}

This is the body of {name}.
"""
    p = dir_path / f"{name}.md"
    p.write_text(content, encoding="utf-8")
    return p

# 模板文件（_ 前缀）
TEMPLATE_RULE = """---
name: _template
description: template
---

template body
"""


def _create_rule_file(dir_path: Path, name: str, content: str) -> Path:
    p = dir_path / f"{name}.md"
    p.write_text(content, encoding="utf-8")
    return p


# ============================================================
# 1. Rule 数据类测试
# ============================================================
class TestRule(unittest.TestCase):
    """测试 Rule 数据类"""

    def test_rule_basic(self):
        r = Rule(name="test", content="body", file_path="/a.md", project_path="/p")
        self.assertEqual(r.name, "test")
        self.assertEqual(r.content, "body")
        self.assertEqual(r.category, "")
        self.assertEqual(r.priority, DEFAULT_PRIORITY)
        self.assertEqual(r.tools, [])

    def test_rule_with_metadata(self):
        r = Rule(
            name="x",
            content="body",
            file_path="/x.md",
            project_path="/p",
            category="python",
            description="desc",
            when_to_use="python",
            tools=["t1", "t2"],
            priority=90,
            metadata={"k": "v"},
        )
        self.assertEqual(r.category, "python")
        self.assertEqual(r.description, "desc")
        self.assertEqual(r.tools, ["t1", "t2"])
        self.assertEqual(r.priority, 90)
        self.assertEqual(r.metadata, {"k": "v"})

    def test_rule_summary(self):
        r = Rule(
            name="x",
            content="body content here",
            file_path="/x.md",
            project_path="/p",
            category="python",
            description="a test description",
        )
        s = r.summary
        self.assertIn("[python]", s)
        self.assertIn("x", s)

    def test_rule_to_dict(self):
        r = Rule(
            name="x",
            content="body",
            file_path="/x.md",
            project_path="/p",
            category="cat",
            description="d",
            when_to_use="w",
            tools=["t"],
            priority=70,
            metadata={"k": "v"},
        )
        d = r.to_dict()
        self.assertEqual(d["name"], "x")
        self.assertEqual(d["category"], "cat")
        self.assertEqual(d["description"], "d")
        self.assertEqual(d["content"], "body")
        self.assertEqual(d["tools"], ["t"])
        self.assertEqual(d["priority"], 70)
        self.assertEqual(d["metadata"], {"k": "v"})

    def test_rule_to_summary_dict(self):
        r = Rule(
            name="x",
            content="body",
            file_path="/x.md",
            project_path="/p",
            category="cat",
        )
        sd = r.to_summary_dict()
        self.assertNotIn("content", sd)
        self.assertIn("name", sd)
        self.assertIn("category", sd)


# ============================================================
# 2. _parse_scalar 测试
# ============================================================
class TestParseScalar(unittest.TestCase):
    """测试 _parse_scalar 标量解析"""

    def test_scalar_string(self):
        self.assertEqual(_parse_scalar("hello"), "hello")

    def test_scalar_int(self):
        self.assertEqual(_parse_scalar("42"), 42)
        self.assertEqual(_parse_scalar("-7"), -7)

    def test_scalar_float(self):
        self.assertEqual(_parse_scalar("3.14"), 3.14)

    def test_scalar_bool(self):
        self.assertEqual(_parse_scalar("true"), True)
        self.assertEqual(_parse_scalar("false"), False)

    def test_scalar_null(self):
        self.assertIsNone(_parse_scalar("null"))
        self.assertIsNone(_parse_scalar("~"))

    def test_scalar_list(self):
        self.assertEqual(_parse_scalar("[a, b, c]"), ["a", "b", "c"])


# ============================================================
# 3. _parse_frontmatter 测试
# ============================================================
class TestParseFrontmatter(unittest.TestCase):
    """测试 _parse_frontmatter 解析"""

    def test_parse_basic(self):
        text = "---\nname: x\ndescription: y\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("name"), "x")
        self.assertEqual(fm.get("description"), "y")

    def test_parse_with_list(self):
        text = "---\nname: x\ntools:\n  - a\n  - b\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("tools"), ["a", "b"])

    def test_parse_with_priority(self):
        text = "---\nname: x\npriority: 90\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("priority"), 90)

    def test_parse_no_frontmatter(self):
        fm = _parse_frontmatter("just body")
        self.assertEqual(fm, {})


# ============================================================
# 4. parse_rule_file 测试
# ============================================================
class TestParseRuleFile(unittest.TestCase):
    """测试 parse_rule_file 单文件解析"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.rules_dir = Path(self.tmpdir) / RULES_DIRNAME / RULES_SUBDIR
        self.rules_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_parse_complete(self):
        f = _create_rule_file(self.rules_dir, "python-style", SAMPLE_RULE_V1)
        result = parse_rule_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "python-style")
        self.assertEqual(result.description, "Python 编码风格规则")
        self.assertEqual(result.when_to_use, "Python, PEP8, 风格")
        self.assertEqual(result.priority, 80)
        self.assertIn("read_file", result.tools)
        self.assertIn("edit_file", result.tools)
        self.assertEqual(result.metadata["category"], "language")
        self.assertIn("Python Style Rule", result.content)
        # project_path 推断
        self.assertTrue(result.project_path.endswith(self.tmpdir.split("/")[-1]))

    def test_parse_inline_list(self):
        f = _create_rule_file(self.rules_dir, "react-hooks", SAMPLE_RULE_INLINE_LIST)
        result = parse_rule_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "react-hooks")
        self.assertIn("read_file", result.tools)
        self.assertEqual(result.priority, 75)

    def test_parse_minimal(self):
        f = _create_rule_file(self.rules_dir, "minimal", SAMPLE_RULE_MINIMAL)
        result = parse_rule_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "minimal")
        # 没有 priority，应使用默认值
        self.assertEqual(result.priority, DEFAULT_PRIORITY)

    def test_parse_priority_clamp_high(self):
        # priority > 100 应被 clamp 到 100
        text = "---\nname: x\npriority: 500\n---\nbody"
        f = _create_rule_file(self.rules_dir, "x", text)
        result = parse_rule_file(f)
        self.assertEqual(result.priority, MAX_PRIORITY)

    def test_parse_priority_clamp_low(self):
        # priority < 0 应被 clamp 到 0
        text = "---\nname: x\npriority: -10\n---\nbody"
        f = _create_rule_file(self.rules_dir, "x", text)
        result = parse_rule_file(f)
        self.assertEqual(result.priority, MIN_PRIORITY)

    def test_parse_priority_invalid(self):
        # 非数字 priority 应使用默认值
        text = "---\nname: x\npriority: high\n---\nbody"
        f = _create_rule_file(self.rules_dir, "x", text)
        result = parse_rule_file(f)
        self.assertEqual(result.priority, DEFAULT_PRIORITY)

    def test_parse_missing_name_valid_stem(self):
        f = _create_rule_file(self.rules_dir, "myrule", SAMPLE_RULE_NO_NAME)
        # 文件名 stem 合法 - fallback 使用 stem
        result = parse_rule_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "myrule")

    def test_parse_missing_name_invalid_stem(self):
        # 文件名带空格 + frontmatter name 为空 - 应返回 None
        no_name_text = "---\ndescription: missing name\n---\nbody"
        f = self.rules_dir / "invalid name.md"
        f.write_text(no_name_text, encoding="utf-8")
        result = parse_rule_file(f)
        self.assertIsNone(result)

    def test_parse_nonexistent_file(self):
        f = self.rules_dir / "nonexistent.md"
        result = parse_rule_file(f)
        self.assertIsNone(result)

    def test_parse_directory(self):
        result = parse_rule_file(self.rules_dir)
        self.assertIsNone(result)


# ============================================================
# 5. TraeRulesLoader 测试
# ============================================================
class TestTraeRulesLoader(unittest.TestCase):
    """测试 TraeRulesLoader 加载器"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        self.rules_dir = self.project / RULES_DIRNAME / RULES_SUBDIR
        self.rules_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_loader_no_rules_dir(self):
        # 删除 .trae/rules 目录
        shutil.rmtree(self.project / RULES_DIRNAME)
        loader = TraeRulesLoader(self.project)
        self.assertFalse(loader.rules_dir_exists)
        rules = loader.scan_all()
        self.assertEqual(rules, [])

    def test_loader_scan_flat(self):
        # 1 级目录
        _create_rule_file(self.rules_dir, "rule1", SAMPLE_RULE_V1)
        _create_rule_file(self.rules_dir, "rule2", SAMPLE_RULE_MINIMAL)
        loader = TraeRulesLoader(self.project)
        self.assertTrue(loader.rules_dir_exists)
        rules = loader.scan_all()
        self.assertEqual(len(rules), 2)
        # 类别应为 "uncategorized"
        for r in rules:
            self.assertEqual(r.category, "uncategorized")

    def test_loader_scan_with_category(self):
        # 2 级目录: rules/python/style.md
        cat_dir = self.rules_dir / "python"
        cat_dir.mkdir(exist_ok=True)
        _create_rule_file(cat_dir, "style", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0].category, "python")
        self.assertEqual(rules[0].name, "python-style")

    def test_loader_scan_multi_level_nesting(self):
        # 3 级目录: rules/python/testing/pytest.md
        cat_dir = self.rules_dir / "python" / "testing"
        cat_dir.mkdir(parents=True, exist_ok=True)
        _create_rule_file(cat_dir, "pytest", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0].category, "python/testing")

    def test_loader_skips_template_files(self):
        _create_rule_file(self.rules_dir, "real-rule", SAMPLE_RULE_V1)
        _create_rule_file(self.rules_dir, "_template", TEMPLATE_RULE)
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        names = [r.name for r in rules]
        self.assertIn("python-style", names)
        self.assertNotIn("_template", names)

    def test_loader_max_depth_limit(self):
        # 4 级目录应被拒绝（默认 max_depth=3）
        deep_dir = self.rules_dir / "a" / "b" / "c" / "d"
        deep_dir.mkdir(parents=True, exist_ok=True)
        _create_rule_file(deep_dir, "deep", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        # 深度 4 应被截断
        self.assertEqual(len(rules), 0)

    def test_loader_sort_by_priority(self):
        # 创建多个不同 priority 的规则
        for i, prio in enumerate([30, 90, 60]):
            text = f"---\nname: rule{i}\npriority: {prio}\n---\nbody"
            _create_rule_file(self.rules_dir, f"rule{i}", text)
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        # 应按 priority 降序排序
        self.assertEqual(rules[0].priority, 90)
        self.assertEqual(rules[1].priority, 60)
        self.assertEqual(rules[2].priority, 30)

    def test_loader_load_by_name(self):
        # 文件名应该与 name 一致 - 创建 python-style.md
        cat_dir = self.rules_dir / "python"
        cat_dir.mkdir(exist_ok=True)
        _create_rule_file(cat_dir, "python-style", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        rule = loader.load_by_name("python-style")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.name, "python-style")
        self.assertEqual(rule.category, "python")

    def test_loader_load_by_name_not_found(self):
        loader = TraeRulesLoader(self.project)
        rule = loader.load_by_name("nonexistent")
        self.assertIsNone(rule)

    def test_loader_load_by_name_invalid(self):
        loader = TraeRulesLoader(self.project)
        # 非法名称（路径遍历）
        self.assertIsNone(loader.load_by_name("../etc/passwd"))
        self.assertIsNone(loader.load_by_name("a b"))

    def test_loader_load_by_category(self):
        cat_dir = self.rules_dir / "python"
        cat_dir.mkdir(exist_ok=True)
        _create_rule_file(cat_dir, "style", SAMPLE_RULE_V1)
        _create_rule_file(cat_dir, "typing", SAMPLE_RULE_INLINE_LIST)
        other_dir = self.rules_dir / "security"
        other_dir.mkdir(exist_ok=True)
        _create_rule_file(other_dir, "input-validation", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        python_rules = loader.load_by_category("python")
        self.assertEqual(len(python_rules), 2)

    def test_loader_list_categories(self):
        cat1 = self.rules_dir / "python"
        cat1.mkdir(exist_ok=True)
        _create_rule_file(cat1, "style", SAMPLE_RULE_V1)
        cat2 = self.rules_dir / "security"
        cat2.mkdir(exist_ok=True)
        _create_rule_file(cat2, "input-validation", SAMPLE_RULE_V1)
        loader = TraeRulesLoader(self.project)
        cats = loader.list_categories()
        cat_names = {c["name"] for c in cats}
        self.assertIn("python", cat_names)
        self.assertIn("security", cat_names)


# ============================================================
# 6. TraeRulesRegistry 测试
# ============================================================
class TestTraeRulesRegistry(unittest.TestCase):
    """测试 TraeRulesRegistry 跨项目注册表"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project1 = Path(self.tmpdir) / "project1"
        self.project2 = Path(self.tmpdir) / "project2"
        for p in (self.project1, self.project2):
            p.mkdir(parents=True, exist_ok=True)
            (p / RULES_DIRNAME / RULES_SUBDIR).mkdir(parents=True, exist_ok=True)
        _create_rule_file(
            self.project1 / RULES_DIRNAME / RULES_SUBDIR,
            "rule1",
            SAMPLE_RULE_V1,
        )
        _create_rule_file(
            self.project2 / RULES_DIRNAME / RULES_SUBDIR,
            "rule2",
            SAMPLE_RULE_INLINE_LIST,
        )
        self.registry = TraeRulesRegistry()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_register_project(self):
        count = self.registry.register_project(self.project1)
        self.assertEqual(count, 1)
        rules = self.registry.list_rules(self.project1)
        self.assertEqual(len(rules), 1)

    def test_unregister_project(self):
        self.registry.register_project(self.project1)
        self.assertTrue(self.registry.unregister_project(self.project1))
        self.assertFalse(self.registry.unregister_project(self.project1))

    def test_list_rules_cross_project(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        all_rules = self.registry.list_rules()
        self.assertEqual(len(all_rules), 2)

    def test_list_summaries(self):
        self.registry.register_project(self.project1)
        summaries = self.registry.list_summaries(self.project1)
        self.assertEqual(len(summaries), 1)
        # summary 不应包含 content
        self.assertNotIn("content", summaries[0])

    def test_list_categories(self):
        self.registry.register_project(self.project1)
        cats = self.registry.list_categories(self.project1)
        self.assertEqual(len(cats), 1)

    def test_get_rule_by_name(self):
        self.registry.register_project(self.project1)
        rule = self.registry.get_rule("python-style", self.project1)
        self.assertIsNotNone(rule)
        self.assertEqual(rule.name, "python-style")

    def test_get_rule_cross_project(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        # 不指定 project_path - 跨项目查找
        rule = self.registry.get_rule("react-hooks")
        self.assertIsNotNone(rule)

    def test_get_rule_not_found(self):
        self.registry.register_project(self.project1)
        rule = self.registry.get_rule("nonexistent")
        self.assertIsNone(rule)

    def test_load_by_name(self):
        self.registry.register_project(self.project1)
        rule = self.registry.load_by_name("python-style", self.project1)
        self.assertIsNotNone(rule)
        self.assertEqual(rule.name, "python-style")

    def test_get_stats(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        stats = self.registry.get_stats()
        self.assertEqual(stats["projects"], 2)
        self.assertEqual(stats["rules"], 2)
        self.assertIn("categories", stats)

    def test_registry_thread_safety(self):
        errors = []

        def register():
            try:
                self.registry.register_project(self.project1)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=register) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(errors), 0)


# ============================================================
# 7. 全局单例测试
# ============================================================
class TestGlobalRegistry(unittest.TestCase):
    """测试全局注册表单例"""

    def setUp(self):
        reset_global_rules_registry()

    def tearDown(self):
        reset_global_rules_registry()

    def test_singleton(self):
        r1 = get_global_rules_registry()
        r2 = get_global_rules_registry()
        self.assertIs(r1, r2)

    def test_reset(self):
        r1 = get_global_rules_registry()
        reset_global_rules_registry()
        r2 = get_global_rules_registry()
        self.assertIsNot(r1, r2)


# ============================================================
# 8. API 校验函数测试
# ============================================================
class TestApiValidators(unittest.TestCase):
    """测试 API 校验函数"""

    def test_validate_rule_name_valid(self):
        self.assertEqual(_validate_rule_name("python-style"), "python-style")
        self.assertEqual(_validate_rule_name("a.b"), "a.b")

    def test_validate_rule_name_invalid(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_rule_name("../etc/passwd")
        with self.assertRaises(HTTPException):
            _validate_rule_name("a b")
        with self.assertRaises(HTTPException):
            _validate_rule_name("a" * 65)

    def test_validate_project_path_valid(self):
        result = _validate_project_path("/tmp")
        self.assertEqual(result, "/tmp")

    def test_validate_project_path_not_in_whitelist(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_project_path("/etc/passwd")

    def test_validate_project_path_nonexistent(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_project_path("/tmp/nonexistent_dir_xyz_456")

    def test_validate_category_valid(self):
        self.assertEqual(_validate_category("python"), "python")
        self.assertEqual(_validate_category("python/testing"), "python/testing")

    def test_validate_category_path_traversal(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_category("../etc")

    def test_validate_category_invalid_chars(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_category("python$evil")

    def test_validate_category_too_long(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_category("a" * 300)


# ============================================================
# 9. 常量与 pattern 测试
# ============================================================
class TestConstants(unittest.TestCase):
    """测试常量与 pattern"""

    def test_rules_dirname(self):
        self.assertEqual(RULES_DIRNAME, ".trae")
        self.assertEqual(RULES_SUBDIR, "rules")

    def test_max_category_depth(self):
        self.assertEqual(MAX_CATEGORY_DEPTH, 3)

    def test_priority_range(self):
        self.assertEqual(MIN_PRIORITY, 0)
        self.assertEqual(MAX_PRIORITY, 100)

    def test_filename_pattern(self):
        self.assertTrue(RULES_FILENAME_PATTERN.match("python-style.md"))
        self.assertTrue(RULES_FILENAME_PATTERN.match("a.b.md"))
        # 不合法
        self.assertFalse(RULES_FILENAME_PATTERN.match("a b.md"))
        self.assertFalse(RULES_FILENAME_PATTERN.match("../passwd.md"))


# ============================================================
# 10. 端到端集成测试
# ============================================================
class TestEndToEndFileSystem(unittest.TestCase):
    """端到端集成测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        self.rules_dir = self.project / RULES_DIRNAME / RULES_SUBDIR
        self.rules_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_workflow(self):
        # 1. 创建多级嵌套规则（文件名 = rule name）
        cat1 = self.rules_dir / "python"
        cat1.mkdir(exist_ok=True)
        _create_rule_with_name(cat1, "python-style", priority=80)

        cat2 = self.rules_dir / "python" / "testing"
        cat2.mkdir(parents=True, exist_ok=True)
        _create_rule_with_name(cat2, "pytest-best-practices", priority=60)

        cat3 = self.rules_dir / "security"
        cat3.mkdir(exist_ok=True)
        _create_rule_with_name(cat3, "security-input-validation", priority=95)

        _create_rule_file(self.rules_dir, "_template", TEMPLATE_RULE)

        # 2. 扫描
        loader = TraeRulesLoader(self.project)
        rules = loader.scan_all()
        self.assertEqual(len(rules), 3)
        # _template 应被排除
        names = [r.name for r in rules]
        self.assertNotIn("_template", names)

        # 3. 分类
        cats = loader.list_categories()
        cat_names = {c["name"] for c in cats}
        self.assertIn("python", cat_names)
        self.assertIn("python/testing", cat_names)
        self.assertIn("security", cat_names)

        # 4. 按 name 加载
        rule = loader.load_by_name("python-style")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.category, "python")

        # 5. 按 category 加载
        python_rules = loader.load_by_category("python")
        self.assertEqual(len(python_rules), 1)

        # 6. 注册到全局注册表
        reset_global_rules_registry()
        registry = get_global_rules_registry()
        count = registry.register_project(self.project)
        self.assertEqual(count, 3)

        # 7. 跨项目查询
        r = registry.get_rule("pytest-best-practices")
        self.assertIsNotNone(r)
        self.assertEqual(r.category, "python/testing")

        # 8. 统计
        stats = registry.get_stats()
        self.assertEqual(stats["projects"], 1)
        self.assertEqual(stats["rules"], 3)
        self.assertEqual(stats["categories"], 3)


# ============================================================
# 主入口
# ============================================================
if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    suite.addTests(loader.loadTestsFromTestCase(TestRule))
    suite.addTests(loader.loadTestsFromTestCase(TestParseScalar))
    suite.addTests(loader.loadTestsFromTestCase(TestParseFrontmatter))
    suite.addTests(loader.loadTestsFromTestCase(TestParseRuleFile))
    suite.addTests(loader.loadTestsFromTestCase(TestTraeRulesLoader))
    suite.addTests(loader.loadTestsFromTestCase(TestTraeRulesRegistry))
    suite.addTests(loader.loadTestsFromTestCase(TestGlobalRegistry))
    suite.addTests(loader.loadTestsFromTestCase(TestApiValidators))
    suite.addTests(loader.loadTestsFromTestCase(TestConstants))
    suite.addTests(loader.loadTestsFromTestCase(TestEndToEndFileSystem))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
