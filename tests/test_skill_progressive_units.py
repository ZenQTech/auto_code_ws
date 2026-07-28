"""
# ============================================================
# Skill Progressive Disclosure 单元测试
# ============================================================
# 测试范围：
#   1. SkillSummary / SkillFull 数据类
#   2. _parse_scalar / _parse_frontmatter 解析
#   3. parse_skill_file 单文件解析
#   4. build_summary 摘要构建
#   5. SkillProgressiveScanner 扫描器
#   6. SkillsProgressiveRegistry 跨项目注册表
#   7. 8K cap 截断逻辑
#   8. _template.md 跳过逻辑
#   9. 全局单例 + 线程安全
#  10. API 层校验函数
# 测试目标：100% 通过率
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

# 让 unittest 能找到 backend/app 模块
WORKSPACE = "/home/qizheng/auto_code_ws"
sys.path.insert(0, WORKSPACE)

from backend.app.services.skill_progressive import (  # noqa: E402
    SKILL_FILENAME_PATTERN,
    SKILLS_DIRNAME,
    SKILLS_SUBDIR,
    SUMMARY_CAP_BYTES,
    SkillFull,
    SkillProgressiveScanner,
    SkillSummary,
    SkillsProgressiveRegistry,
    _parse_frontmatter,
    _parse_scalar,
    build_summary,
    get_global_registry,
    parse_skill_file,
    reset_global_registry,
)
from backend.app.api.skills_progressive import (  # noqa: E402
    _validate_project_path,
    _validate_skill_name,
)


# ============================================================
# 测试数据
# ============================================================

SAMPLE_SKILL_V1 = """---
name: code-review
description: 代码审查技能 - 静态分析 + 风格检查 + 最佳实践
when_to_use: 代码审查, review, 静态分析
model: claude-sonnet
tools:
  - read_file
  - search_code
metadata:
  category: quality
  level: senior
---

# Code Review Skill

你是一位资深代码审查专家。

## 审查维度

1. 正确性
2. 可读性
3. 可维护性
"""

SAMPLE_SKILL_V2 = """---
name: refactor
description: 代码重构 - 改善结构与可读性
tools: [read_file, write_file]
model: claude-haiku
---

Refactor body content.
"""

SAMPLE_SKILL_MINIMAL = """---
name: minimal
description: minimal skill
---

body
"""

SAMPLE_SKILL_NO_NAME = """---
description: missing name
---

body
"""

SAMPLE_SKILL_NO_DESC = """---
name: nodesc
---

body
"""

# 模板文件（以 _ 开头，应被跳过）
TEMPLATE_SKILL = """---
name: _template
description: template skill
---

template
"""


def _create_skill_file(dir_path: Path, name: str, content: str) -> Path:
    p = dir_path / f"{name}.md"
    p.write_text(content, encoding="utf-8")
    return p


# ============================================================
# 1. SkillSummary 数据类测试
# ============================================================
class TestSkillSummary(unittest.TestCase):
    """测试 SkillSummary 数据类"""

    def test_summary_basic(self):
        s = SkillSummary(
            name="test", description="desc", when_to_use="use"
        )
        self.assertEqual(s.name, "test")
        self.assertEqual(s.description, "desc")
        self.assertEqual(s.when_to_use, "use")
        self.assertEqual(s.file_path, "")
        self.assertEqual(s.project_path, "")

    def test_summary_size(self):
        s = SkillSummary(name="abc", description="12345", when_to_use="ab")
        # name(3) + description(5) + when_to_use(2) = 10
        self.assertEqual(s.summary_size, 10)

    def test_summary_size_chinese(self):
        # UTF-8 中文字符占 3 字节
        s = SkillSummary(name="测试", description="描述", when_to_use="使用")
        # name(2*3=6) + description(2*3=6) + when_to_use(2*3=6) = 18
        self.assertEqual(s.summary_size, 18)

    def test_summary_to_dict(self):
        s = SkillSummary(
            name="x",
            description="y",
            when_to_use="z",
            file_path="/a/b.md",
            project_path="/a",
        )
        d = s.to_dict()
        self.assertIn("name", d)
        self.assertIn("description", d)
        self.assertIn("when_to_use", d)
        self.assertIn("file_path", d)
        self.assertIn("project_path", d)
        self.assertIn("summary_size", d)
        self.assertEqual(d["name"], "x")


# ============================================================
# 2. SkillFull 数据类测试
# ============================================================
class TestSkillFull(unittest.TestCase):
    """测试 SkillFull 数据类"""

    def test_full_basic(self):
        f = SkillFull(name="x", description="y")
        self.assertEqual(f.name, "x")
        self.assertEqual(f.description, "y")
        self.assertEqual(f.when_to_use, "")
        self.assertEqual(f.tools, [])
        self.assertEqual(f.model, "")
        self.assertEqual(f.metadata, {})
        self.assertEqual(f.body, "")

    def test_full_with_tools_and_metadata(self):
        f = SkillFull(
            name="x",
            description="y",
            tools=["a", "b"],
            model="claude-sonnet",
            metadata={"k": "v"},
            body="body text",
        )
        self.assertEqual(f.tools, ["a", "b"])
        self.assertEqual(f.model, "claude-sonnet")
        self.assertEqual(f.metadata, {"k": "v"})
        self.assertEqual(f.body, "body text")

    def test_full_to_dict_complete(self):
        f = SkillFull(
            name="x",
            description="y",
            when_to_use="z",
            tools=["t1"],
            model="m1",
            metadata={"k": "v"},
            body="b",
            file_path="/p/x.md",
            project_path="/p",
            frontmatter={"name": "x"},
        )
        d = f.to_dict()
        self.assertEqual(d["name"], "x")
        self.assertEqual(d["description"], "y")
        self.assertEqual(d["when_to_use"], "z")
        self.assertEqual(d["tools"], ["t1"])
        self.assertEqual(d["model"], "m1")
        self.assertEqual(d["metadata"], {"k": "v"})
        self.assertEqual(d["body"], "b")
        self.assertEqual(d["file_path"], "/p/x.md")
        self.assertEqual(d["project_path"], "/p")
        self.assertEqual(d["frontmatter"]["name"], "x")


# ============================================================
# 3. _parse_scalar 测试
# ============================================================
class TestParseScalar(unittest.TestCase):
    """测试 _parse_scalar 标量解析"""

    def test_scalar_string(self):
        self.assertEqual(_parse_scalar("hello"), "hello")

    def test_scalar_quoted(self):
        self.assertEqual(_parse_scalar('"hello"'), "hello")
        self.assertEqual(_parse_scalar("'hello'"), "hello")

    def test_scalar_int(self):
        self.assertEqual(_parse_scalar("42"), 42)
        self.assertEqual(_parse_scalar("-7"), -7)

    def test_scalar_float(self):
        self.assertEqual(_parse_scalar("3.14"), 3.14)

    def test_scalar_bool(self):
        self.assertEqual(_parse_scalar("true"), True)
        self.assertEqual(_parse_scalar("false"), False)
        self.assertEqual(_parse_scalar("yes"), True)
        self.assertEqual(_parse_scalar("no"), False)

    def test_scalar_null(self):
        self.assertIsNone(_parse_scalar("null"))
        self.assertIsNone(_parse_scalar("~"))
        self.assertIsNone(_parse_scalar(""))

    def test_scalar_list(self):
        self.assertEqual(_parse_scalar("[a, b, c]"), ["a", "b", "c"])


# ============================================================
# 4. _parse_frontmatter 测试
# ============================================================
class TestParseFrontmatter(unittest.TestCase):
    """测试 _parse_frontmatter YAML 子集解析"""

    def test_parse_basic(self):
        text = "---\nname: x\ndescription: y\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("name"), "x")
        self.assertEqual(fm.get("description"), "y")

    def test_parse_with_list(self):
        text = "---\nname: x\ntools:\n  - a\n  - b\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("tools"), ["a", "b"])

    def test_parse_with_metadata(self):
        text = "---\nname: x\nmetadata:\n  cat: quality\n  level: senior\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm["metadata"]["cat"], "quality")
        self.assertEqual(fm["metadata"]["level"], "senior")

    def test_parse_no_frontmatter(self):
        fm = _parse_frontmatter("just body content")
        self.assertEqual(fm, {})

    def test_parse_empty_frontmatter(self):
        fm = _parse_frontmatter("---\n---\nbody")
        self.assertEqual(fm, {})

    def test_parse_with_comments(self):
        text = "---\n# comment\nname: x\n---\nbody"
        fm = _parse_frontmatter(text)
        self.assertEqual(fm.get("name"), "x")


# ============================================================
# 5. parse_skill_file 测试
# ============================================================
class TestParseSkillFile(unittest.TestCase):
    """测试 parse_skill_file 单文件解析"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.skills_dir = Path(self.tmpdir) / ".trae" / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_parse_complete(self):
        f = _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        result = parse_skill_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "code-review")
        self.assertIn("代码审查", result.description)
        self.assertEqual(result.when_to_use, "代码审查, review, 静态分析")
        self.assertEqual(result.model, "claude-sonnet")
        self.assertIn("read_file", result.tools)
        self.assertIn("search_code", result.tools)
        self.assertEqual(result.metadata["category"], "quality")
        self.assertIn("Code Review Skill", result.body)
        # project_path 推断
        self.assertTrue(result.project_path.endswith(self.tmpdir.split("/")[-1]))

    def test_parse_inline_list(self):
        f = _create_skill_file(self.skills_dir, "refactor", SAMPLE_SKILL_V2)
        result = parse_skill_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "refactor")
        self.assertIn("read_file", result.tools)
        self.assertEqual(result.model, "claude-haiku")

    def test_parse_minimal(self):
        f = _create_skill_file(self.skills_dir, "minimal", SAMPLE_SKILL_MINIMAL)
        result = parse_skill_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "minimal")
        self.assertEqual(result.description, "minimal skill")

    def test_parse_missing_name(self):
        # 没有 name 字段且文件名 stem 不合法 - 返回 None
        f = self.skills_dir / "x.md"
        f.write_text(SAMPLE_SKILL_NO_NAME, encoding="utf-8")
        # 文件名合法，所以 fallback 使用 stem "x"
        result = parse_skill_file(f)
        self.assertIsNotNone(result)
        self.assertEqual(result.name, "x")

    def test_parse_missing_description(self):
        f = _create_skill_file(self.skills_dir, "nodesc", SAMPLE_SKILL_NO_DESC)
        result = parse_skill_file(f)
        self.assertIsNone(result)

    def test_parse_nonexistent_file(self):
        f = self.skills_dir / "nonexistent.md"
        result = parse_skill_file(f)
        self.assertIsNone(result)

    def test_parse_directory_not_file(self):
        result = parse_skill_file(self.skills_dir)
        self.assertIsNone(result)


# ============================================================
# 6. build_summary 测试
# ============================================================
class TestBuildSummary(unittest.TestCase):
    """测试 build_summary 摘要构建"""

    def test_build_from_full(self):
        full = SkillFull(
            name="x",
            description="y",
            when_to_use="z",
            tools=["a"],
            model="m",
            metadata={"k": "v"},
            body="this is body",
        )
        summary = build_summary(full)
        self.assertEqual(summary.name, "x")
        self.assertEqual(summary.description, "y")
        self.assertEqual(summary.when_to_use, "z")
        # build_summary 不复制 tools/model/metadata/body
        # 只包含 name+description+when_to_use
        self.assertNotIn("tools", summary.to_dict())


# ============================================================
# 7. SkillProgressiveScanner 测试
# ============================================================
class TestSkillProgressiveScanner(unittest.TestCase):
    """测试 SkillProgressiveScanner 扫描器"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        self.skills_dir = self.project / ".trae" / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_scanner_no_skills_dir(self):
        # 删除 .trae/skills 目录
        shutil.rmtree(self.project / ".trae")
        scanner = SkillProgressiveScanner(self.project)
        self.assertFalse(scanner.skills_dir_exists)
        summaries, total_bytes, truncated = scanner.list_summaries()
        self.assertEqual(summaries, [])
        self.assertEqual(total_bytes, 0)
        self.assertFalse(truncated)

    def test_scanner_list_summaries(self):
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        _create_skill_file(self.skills_dir, "refactor", SAMPLE_SKILL_V2)
        _create_skill_file(self.skills_dir, "minimal", SAMPLE_SKILL_MINIMAL)

        scanner = SkillProgressiveScanner(self.project)
        self.assertTrue(scanner.skills_dir_exists)
        summaries, total_bytes, truncated = scanner.list_summaries()
        self.assertEqual(len(summaries), 3)
        self.assertGreater(total_bytes, 0)
        self.assertFalse(truncated)
        # 按文件名排序
        self.assertEqual(summaries[0].name, "code-review")
        self.assertEqual(summaries[1].name, "minimal")
        self.assertEqual(summaries[2].name, "refactor")

    def test_scanner_skips_template_files(self):
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        _create_skill_file(self.skills_dir, "_template", TEMPLATE_SKILL)

        scanner = SkillProgressiveScanner(self.project)
        summaries, _, _ = scanner.list_summaries()
        # _template 应当被跳过
        names = [s.name for s in summaries]
        self.assertIn("code-review", names)
        self.assertNotIn("_template", names)

    def test_scanner_8k_cap_truncation(self):
        # 创建大量 skill 让总大小超过 8K
        for i in range(100):
            content = f"""---
name: skill_{i:03d}
description: 这是一个非常长的描述 skill {i} - 用来测试 8K cap 截断行为
when_to_use: 测试, 长描述, 截断
---

body {i}
"""
            _create_skill_file(self.skills_dir, f"skill_{i:03d}", content)

        scanner = SkillProgressiveScanner(self.project)
        # 使用较小的 cap 来确保截断
        summaries, total_bytes, truncated = scanner.list_summaries(cap_bytes=2048)
        self.assertTrue(truncated)
        self.assertLessEqual(total_bytes, 2048)
        self.assertLess(len(summaries), 100)

    def test_scanner_load_full(self):
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        scanner = SkillProgressiveScanner(self.project)
        full = scanner.load_full("code-review")
        self.assertIsNotNone(full)
        self.assertEqual(full.name, "code-review")
        self.assertIn("Code Review Skill", full.body)

    def test_scanner_load_full_nonexistent(self):
        scanner = SkillProgressiveScanner(self.project)
        full = scanner.load_full("nonexistent")
        self.assertIsNone(full)

    def test_scanner_load_full_invalid_name(self):
        scanner = SkillProgressiveScanner(self.project)
        # 含特殊字符的名称应被拒绝
        self.assertIsNone(scanner.load_full("../etc/passwd"))
        self.assertIsNone(scanner.load_full("a/b"))
        self.assertIsNone(scanner.load_full("a b"))

    def test_scanner_load_full_by_path(self):
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        scanner = SkillProgressiveScanner(self.project)
        full = scanner.load_full_by_path(self.skills_dir / "code-review.md")
        self.assertIsNotNone(full)

    def test_scanner_find_summary_by_name(self):
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        _create_skill_file(self.skills_dir, "refactor", SAMPLE_SKILL_V2)
        scanner = SkillProgressiveScanner(self.project)
        summary = scanner.find_summary_by_name("code-review")
        self.assertIsNotNone(summary)
        self.assertEqual(summary.name, "code-review")
        # 不存在的 name
        self.assertIsNone(scanner.find_summary_by_name("nonexistent"))


# ============================================================
# 8. SkillsProgressiveRegistry 测试
# ============================================================
class TestSkillsProgressiveRegistry(unittest.TestCase):
    """测试 SkillsProgressiveRegistry 跨项目注册表"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project1 = Path(self.tmpdir) / "project1"
        self.project2 = Path(self.tmpdir) / "project2"
        for p in (self.project1, self.project2):
            p.mkdir(parents=True, exist_ok=True)
            (p / ".trae" / "skills").mkdir(parents=True, exist_ok=True)
        _create_skill_file(
            self.project1 / ".trae" / "skills",
            "code-review",
            SAMPLE_SKILL_V1,
        )
        _create_skill_file(
            self.project2 / ".trae" / "skills",
            "refactor",
            SAMPLE_SKILL_V2,
        )
        self.registry = SkillsProgressiveRegistry()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_register_project(self):
        count = self.registry.register_project(self.project1)
        self.assertEqual(count, 1)
        # 已注册
        summaries = self.registry.list_all_summaries(self.project1)
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0].name, "code-review")

    def test_unregister_project(self):
        self.registry.register_project(self.project1)
        ok = self.registry.unregister_project(self.project1)
        self.assertTrue(ok)
        # 不存在
        ok = self.registry.unregister_project(self.project1)
        self.assertFalse(ok)

    def test_list_all_summaries(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        all_summaries = self.registry.list_all_summaries()
        self.assertEqual(len(all_summaries), 2)
        names = {s.name for s in all_summaries}
        self.assertIn("code-review", names)
        self.assertIn("refactor", names)

    def test_list_all_summaries_by_project(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        s1 = self.registry.list_all_summaries(self.project1)
        s2 = self.registry.list_all_summaries(self.project2)
        self.assertEqual(len(s1), 1)
        self.assertEqual(len(s2), 1)
        self.assertEqual(s1[0].name, "code-review")
        self.assertEqual(s2[0].name, "refactor")

    def test_get_summary_by_name(self):
        self.registry.register_project(self.project1)
        summary = self.registry.get_summary("code-review", self.project1)
        self.assertIsNotNone(summary)
        self.assertEqual(summary.name, "code-review")
        # 跨项目查找
        summary = self.registry.get_summary("code-review")
        self.assertIsNotNone(summary)

    def test_get_summary_not_found(self):
        self.registry.register_project(self.project1)
        summary = self.registry.get_summary("nonexistent")
        self.assertIsNone(summary)

    def test_load_full_by_name(self):
        self.registry.register_project(self.project1)
        full = self.registry.load_full("code-review", self.project1)
        self.assertIsNotNone(full)
        self.assertEqual(full.name, "code-review")
        self.assertIn("Code Review Skill", full.body)

    def test_load_full_cross_project(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        # 不指定 project_path - 跨项目查找
        full = self.registry.load_full("refactor")
        self.assertIsNotNone(full)
        self.assertEqual(full.name, "refactor")

    def test_load_full_not_found(self):
        self.registry.register_project(self.project1)
        full = self.registry.load_full("nonexistent", self.project1)
        self.assertIsNone(full)

    def test_get_stats(self):
        self.registry.register_project(self.project1)
        self.registry.register_project(self.project2)
        stats = self.registry.get_stats()
        self.assertEqual(stats["projects"], 2)
        self.assertEqual(stats["skills"], 2)

    def test_registry_thread_safety(self):
        """测试多线程并发注册安全"""
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
        stats = self.registry.get_stats()
        # 至少有一个项目注册成功
        self.assertGreaterEqual(stats["projects"], 1)


# ============================================================
# 9. 全局单例测试
# ============================================================
class TestGlobalRegistry(unittest.TestCase):
    """测试全局注册表单例"""

    def setUp(self):
        reset_global_registry()

    def tearDown(self):
        reset_global_registry()

    def test_get_global_registry_singleton(self):
        r1 = get_global_registry()
        r2 = get_global_registry()
        self.assertIs(r1, r2)

    def test_reset_global_registry(self):
        r1 = get_global_registry()
        reset_global_registry()
        r2 = get_global_registry()
        self.assertIsNot(r1, r2)


# ============================================================
# 10. API 校验函数测试
# ============================================================
class TestApiValidators(unittest.TestCase):
    """测试 API 层校验函数"""

    def test_validate_skill_name_valid(self):
        self.assertEqual(_validate_skill_name("code-review"), "code-review")
        self.assertEqual(_validate_skill_name("skill_123"), "skill_123")
        self.assertEqual(_validate_skill_name("a.b"), "a.b")
        self.assertEqual(_validate_skill_name("a" * 64), "a" * 64)

    def test_validate_skill_name_invalid(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_skill_name("../etc/passwd")
        with self.assertRaises(HTTPException):
            _validate_skill_name("a b")  # 空格
        with self.assertRaises(HTTPException):
            _validate_skill_name("a/b")  # 斜杠
        with self.assertRaises(HTTPException):
            _validate_skill_name("a" * 65)  # 超过 64 字符
        with self.assertRaises(HTTPException):
            _validate_skill_name("")

    def test_validate_project_path_valid(self):
        # 使用白名单内的路径
        result = _validate_project_path("/tmp")
        self.assertEqual(result, "/tmp")

    def test_validate_project_path_not_in_whitelist(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            _validate_project_path("/etc/passwd")

    def test_validate_project_path_nonexistent(self):
        from fastapi import HTTPException

        # 白名单内但不存在
        with self.assertRaises(HTTPException):
            _validate_project_path("/tmp/nonexistent_dir_xyz_123")


# ============================================================
# 11. 常量与文件名 pattern 测试
# ============================================================
class TestConstants(unittest.TestCase):
    """测试常量与 pattern"""

    def test_summary_cap_bytes(self):
        # Codex v0.135+ 规范要求 8K
        self.assertEqual(SUMMARY_CAP_BYTES, 8 * 1024)

    def test_skills_dirname(self):
        self.assertEqual(SKILLS_DIRNAME, ".trae")
        self.assertEqual(SKILLS_SUBDIR, "skills")

    def test_skill_filename_pattern(self):
        self.assertTrue(SKILL_FILENAME_PATTERN.match("code-review.md"))
        self.assertTrue(SKILL_FILENAME_PATTERN.match("skill_123.md"))
        self.assertTrue(SKILL_FILENAME_PATTERN.match("a.b.md"))
        # 不合法的文件名
        self.assertFalse(SKILL_FILENAME_PATTERN.match("a b.md"))
        self.assertFalse(SKILL_FILENAME_PATTERN.match("../passwd.md"))


# ============================================================
# 12. 端到端集成测试（文件级）
# ============================================================
class TestEndToEndFileSystem(unittest.TestCase):
    """测试文件系统的端到端集成"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        self.skills_dir = self.project / ".trae" / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_workflow(self):
        # 1. 创建多个 skill 文件
        _create_skill_file(self.skills_dir, "code-review", SAMPLE_SKILL_V1)
        _create_skill_file(self.skills_dir, "refactor", SAMPLE_SKILL_V2)
        _create_skill_file(self.skills_dir, "minimal", SAMPLE_SKILL_MINIMAL)
        _create_skill_file(self.skills_dir, "_template", TEMPLATE_SKILL)

        # 2. 扫描
        scanner = SkillProgressiveScanner(self.project)
        summaries, total_bytes, truncated = scanner.list_summaries()
        names = [s.name for s in summaries]
        # 应当排除 _template
        self.assertIn("code-review", names)
        self.assertIn("refactor", names)
        self.assertIn("minimal", names)
        self.assertNotIn("_template", names)
        self.assertEqual(len(summaries), 3)

        # 3. 按需加载
        full = scanner.load_full("code-review")
        self.assertIsNotNone(full)
        self.assertEqual(full.name, "code-review")
        self.assertIn("Code Review Skill", full.body)

        # 4. 注册到全局注册表
        reset_global_registry()
        registry = get_global_registry()
        count = registry.register_project(self.project)
        self.assertEqual(count, 3)

        # 5. 通过 registry 加载
        full2 = registry.load_full("refactor")
        self.assertIsNotNone(full2)
        self.assertEqual(full2.model, "claude-haiku")

        # 6. 统计
        stats = registry.get_stats()
        self.assertEqual(stats["projects"], 1)
        self.assertEqual(stats["skills"], 3)


# ============================================================
# 主入口
# ============================================================
if __name__ == "__main__":
    # 顶层测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    suite.addTests(loader.loadTestsFromTestCase(TestSkillSummary))
    suite.addTests(loader.loadTestsFromTestCase(TestSkillFull))
    suite.addTests(loader.loadTestsFromTestCase(TestParseScalar))
    suite.addTests(loader.loadTestsFromTestCase(TestParseFrontmatter))
    suite.addTests(loader.loadTestsFromTestCase(TestParseSkillFile))
    suite.addTests(loader.loadTestsFromTestCase(TestBuildSummary))
    suite.addTests(loader.loadTestsFromTestCase(TestSkillProgressiveScanner))
    suite.addTests(loader.loadTestsFromTestCase(TestSkillsProgressiveRegistry))
    suite.addTests(loader.loadTestsFromTestCase(TestGlobalRegistry))
    suite.addTests(loader.loadTestsFromTestCase(TestApiValidators))
    suite.addTests(loader.loadTestsFromTestCase(TestConstants))
    suite.addTests(loader.loadTestsFromTestCase(TestEndToEndFileSystem))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
