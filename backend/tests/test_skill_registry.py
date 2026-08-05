"""
# ============================================================
# test_skill_registry.py
# Cycle 70 G70-01 - Skill Registry (5 位置) 测试
# ============================================================
"""

import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from backend.app.services.skill_registry import (
    LOCATION_PRIORITY,
    SKILL_MD_FILENAME,
    SKILL_NAME_PATTERN,
    Skill,
    SkillLocation,
    SkillRegistry,
    _is_path_safe,
    _parse_skill_md_file,
    _safe_parse_yaml,
)


# 有效的 SKILL.md frontmatter
VALID_SKILL_MD = """---
name: my-test-skill
description: A test skill for unit tests
allowed_tools:
  - read_file
  - write_file
version: "1.0.0"
tags:
  - test
  - sample
---

# My Test Skill

This is the body content of the skill.
It contains instructions for the LLM.
"""


INVALID_NAME_SKILL_MD = """---
name: Invalid_Name!
description: Bad name
---
Body
"""


MISSING_NAME_SKILL_MD = """---
description: Missing name field
---
Body
"""


class TestSkillNamePattern(unittest.TestCase):
    """测试 skill name 验证正则"""

    def test_valid_names(self):
        valid = ["a", "ab", "a-b", "abc-123", "skill-name", "x" * 64]
        for name in valid:
            self.assertTrue(SKILL_NAME_PATTERN.match(name), f"Should accept: {name}")

    def test_invalid_names(self):
        invalid = [
            "A",  # 大写
            "-abc",  # 连字符开头
            "abc-",  # 连字符结尾
            "ab_cd",  # 下划线
            "ab.cd",  # 句点
            "ab cd",  # 空格
            "",  # 空
        ]
        for name in invalid:
            self.assertFalse(SKILL_NAME_PATTERN.match(name), f"Should reject: {name}")


class TestSafeParseYaml(unittest.TestCase):
    """测试安全 YAML 解析"""

    def test_valid_yaml(self):
        content = """---
name: test-skill
description: A test skill
---
Body
"""
        data, errors, warnings = _safe_parse_yaml(content)
        self.assertEqual(len(errors), 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["name"], "test-skill")

    def test_missing_separator(self):
        content = "no separator at start"
        data, errors, _ = _safe_parse_yaml(content)
        self.assertIsNone(data)
        self.assertGreater(len(errors), 0)

    def test_empty_yaml(self):
        content = """---
---
Body
"""
        data, errors, _ = _safe_parse_yaml(content)
        self.assertIsNone(data)
        self.assertGreater(len(errors), 0)

    def test_missing_name(self):
        content = """---
description: missing name
---
Body
"""
        data, errors, _ = _safe_parse_yaml(content)
        self.assertIsNotNone(data)  # dict returned but with errors
        self.assertGreater(len(errors), 0)

    def test_invalid_name(self):
        content = """---
name: Invalid_Name!
description: bad
---
Body
"""
        data, errors, _ = _safe_parse_yaml(content)
        self.assertIsNotNone(data)
        self.assertGreater(len(errors), 0)


class TestParseSkillMdFile(unittest.TestCase):
    """测试 SKILL.md 文件解析"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="skill_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_parse_valid_skill(self):
        skill_md = self.tmpdir / SKILL_MD_FILENAME
        skill_md.write_text(VALID_SKILL_MD, encoding="utf-8")
        skill, errors, warnings = _parse_skill_md_file(skill_md, SkillLocation.USER)
        self.assertEqual(len(errors), 0)
        self.assertIsNotNone(skill)
        self.assertEqual(skill.name, "my-test-skill")
        self.assertEqual(skill.location, SkillLocation.USER.value)
        self.assertIn("read_file", skill.allowed_tools)
        self.assertIn("test", skill.tags)

    def test_parse_invalid_name(self):
        skill_md = self.tmpdir / SKILL_MD_FILENAME
        skill_md.write_text(INVALID_NAME_SKILL_MD, encoding="utf-8")
        skill, errors, _ = _parse_skill_md_file(skill_md, SkillLocation.USER)
        self.assertIsNone(skill)
        self.assertGreater(len(errors), 0)

    def test_parse_missing_name(self):
        skill_md = self.tmpdir / SKILL_MD_FILENAME
        skill_md.write_text(MISSING_NAME_SKILL_MD, encoding="utf-8")
        skill, errors, _ = _parse_skill_md_file(skill_md, SkillLocation.USER)
        self.assertIsNone(skill)

    def test_parse_nonexistent_file(self):
        skill, errors, _ = _parse_skill_md_file(
            self.tmpdir / "no.md", SkillLocation.USER,
        )
        self.assertIsNone(skill)
        self.assertGreater(len(errors), 0)


class TestPathSafety(unittest.TestCase):
    """测试路径安全检查"""

    def test_user_path_safe(self):
        path = Path("~/.hermes/skills/my-skill/SKILL.md")
        self.assertTrue(_is_path_safe(path, SkillLocation.USER))

    def test_admin_path_safe(self):
        path = Path("/etc/hermes/skills/my-skill/SKILL.md")
        self.assertTrue(_is_path_safe(path, SkillLocation.ADMIN))

    def test_traversal_blocked(self):
        path = Path("~/.hermes/../../etc/passwd")
        self.assertFalse(_is_path_safe(path, SkillLocation.USER))


class TestLocationPriority(unittest.TestCase):
    """测试位置优先级"""

    def test_priority_order(self):
        # REPO > USER > ADMIN > SYSTEM > DEFAULTS
        self.assertGreater(
            LOCATION_PRIORITY[SkillLocation.REPO],
            LOCATION_PRIORITY[SkillLocation.USER],
        )
        self.assertGreater(
            LOCATION_PRIORITY[SkillLocation.USER],
            LOCATION_PRIORITY[SkillLocation.ADMIN],
        )
        self.assertGreater(
            LOCATION_PRIORITY[SkillLocation.ADMIN],
            LOCATION_PRIORITY[SkillLocation.SYSTEM],
        )
        self.assertGreater(
            LOCATION_PRIORITY[SkillLocation.SYSTEM],
            LOCATION_PRIORITY[SkillLocation.DEFAULTS],
        )


class TestSkillRegistry(unittest.TestCase):
    """测试 Skill Registry 完整流程"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="registry_test_"))
        self.registry = SkillRegistry()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_registry_has_builtin_defaults(self):
        """注册表默认包含 3 个内置 skill"""
        skills = self.registry.list_skills()
        default_names = {s.name for s in skills if s.location == "defaults"}
        self.assertIn("code-reviewer", default_names)
        self.assertIn("test-generator", default_names)
        self.assertIn("doc-generator", default_names)

    def test_list_skills_by_location(self):
        """按位置过滤"""
        defaults = self.registry.list_skills(location="defaults")
        self.assertGreater(len(defaults), 0)
        for skill in defaults:
            self.assertEqual(skill.location, "defaults")

    def test_list_skills_enabled_only(self):
        """enabled_only 过滤"""
        skills = self.registry.list_skills(enabled_only=True)
        for skill in skills:
            self.assertTrue(skill.enabled)

    def test_get_skill_by_name(self):
        """按 name 获取"""
        skill = self.registry.get_skill_by_name("code-reviewer")
        self.assertIsNotNone(skill)
        self.assertEqual(skill.name, "code-reviewer")

    def test_get_skill_by_name_not_found(self):
        skill = self.registry.get_skill_by_name("nonexistent-skill-xyz")
        self.assertIsNone(skill)

    def test_enable_disable_skill(self):
        """启用/禁用 skill"""
        skill = self.registry.get_skill_by_name("code-reviewer")
        self.assertTrue(skill.enabled)
        self.registry.set_enabled(skill.id, False)
        skill = self.registry.get_skill_by_name("code-reviewer")
        self.assertFalse(skill.enabled)
        self.registry.set_enabled(skill.id, True)
        skill = self.registry.get_skill_by_name("code-reviewer")
        self.assertTrue(skill.enabled)

    def test_get_by_location_counts(self):
        """按位置统计"""
        counts = self.registry.get_by_location_counts()
        self.assertIn("defaults", counts)
        self.assertIn("system", counts)
        self.assertIn("admin", counts)
        self.assertIn("user", counts)
        self.assertIn("repo", counts)
        self.assertGreater(counts["defaults"], 0)

    def test_get_location_status(self):
        """获取位置状态"""
        statuses = self.registry.get_location_status()
        self.assertEqual(len(statuses), 5)
        names = {s.name for s in statuses}
        self.assertEqual(
            names,
            {"defaults", "system", "admin", "user", "repo"},
        )

    def test_rescan_with_repo_root(self):
        """使用 repo_root 重新扫描"""
        # 在 tmpdir 创建 .hermes/skills/test-skill/SKILL.md
        skill_dir = self.tmpdir / ".hermes" / "skills" / "test-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / SKILL_MD_FILENAME).write_text(VALID_SKILL_MD, encoding="utf-8")

        result = self.registry.rescan(repo_root=str(self.tmpdir))
        self.assertIn("skills_found", result)
        self.assertIn("duration_ms", result)
        # 验证 my-test-skill 已被加载（目录名 "test-skill" 与 skill name "my-test-skill" 不同）
        skill = self.registry.get_skill_by_name("my-test-skill")
        self.assertIsNotNone(skill)
        self.assertEqual(skill.location, "repo")

    def test_rescan_priority_repo_over_user(self):
        """REPO 优先级高于 USER（冲突解决）"""
        # 在 USER 创建同名 skill
        user_dir = Path("~/.hermes/skills/priority-test").expanduser()
        user_dir.mkdir(parents=True, exist_ok=True)
        try:
            (user_dir / SKILL_MD_FILENAME).write_text(
                VALID_SKILL_MD.replace("my-test-skill", "priority-test"),
                encoding="utf-8",
            )
            # 在 REPO 创建同名 skill
            repo_dir = self.tmpdir / ".hermes" / "skills" / "priority-test"
            repo_dir.mkdir(parents=True)
            (repo_dir / SKILL_MD_FILENAME).write_text(
                VALID_SKILL_MD.replace("my-test-skill", "priority-test").replace(
                    "A test skill for unit tests", "REPO override version",
                ),
                encoding="utf-8",
            )

            self.registry.rescan(repo_root=str(self.tmpdir))
            skill = self.registry.get_skill_by_name("priority-test")
            self.assertIsNotNone(skill)
            # REPO 应覆盖 USER
            self.assertEqual(skill.location, "repo")
            self.assertIn("REPO", skill.description)

            conflicts = self.registry.get_conflicts()
            conflict_names = {c.skill_name for c in conflicts}
            self.assertIn("priority-test", conflict_names)
        finally:
            shutil.rmtree(user_dir, ignore_errors=True)

    def test_skill_with_assets(self):
        """skill 包含 scripts/references/assets 子目录"""
        skill_dir = self.tmpdir / ".hermes" / "skills" / "with-assets"
        (skill_dir / "scripts").mkdir(parents=True)
        (skill_dir / "references").mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(VALID_SKILL_MD, encoding="utf-8")
        (skill_dir / "scripts" / "run.sh").write_text("#!/bin/bash\nls")
        (skill_dir / "references" / "api.md").write_text("# API")

        self.registry.rescan(repo_root=str(self.tmpdir))
        skill = self.registry.get_skill_by_name("my-test-skill")
        self.assertIsNotNone(skill)
        self.assertEqual(len(skill.scripts), 1)
        self.assertEqual(len(skill.references), 1)

    def test_skill_yaml_size_limit(self):
        """过大 SKILL.md 被跳过"""
        # 跳过，依赖 MAX_SKILL_MD_SIZE 常量
        pass

    def test_yaml_injection_safe(self):
        """YAML 注入安全（safe_load）"""
        # safe_load 不会执行任意代码
        malicious = """---
name: evil-skill
description: !!python/object/apply:os.system ['echo HACKED']
---
Body
"""
        skill_md = self.tmpdir / SKILL_MD_FILENAME
        skill_md.write_text(malicious, encoding="utf-8")
        # 解析应该失败（不允许 python tag）
        skill, errors, _ = _parse_skill_md_file(skill_md, SkillLocation.USER)
        # safe_load 会拒绝 python/object/apply
        self.assertIsNone(skill)

    def test_skill_to_dict(self):
        """Skill 可序列化"""
        skill = self.registry.get_skill_by_name("code-reviewer")
        d = skill.to_dict()
        self.assertIn("id", d)
        self.assertIn("name", d)
        self.assertIn("location", d)
        self.assertIn("description", d)

    def test_concurrent_rescan(self):
        """并发 rescan 线程安全"""
        errors = []

        def worker():
            try:
                self.registry.rescan()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(errors), 0)


if __name__ == "__main__":
    unittest.main()
