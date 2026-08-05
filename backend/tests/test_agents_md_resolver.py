"""
# ============================================================
# test_agents_md_resolver.py
# Cycle 70 G70-01 - AGENTS.md Multi-Level Resolver 测试
# ============================================================
"""

import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.services.agents_md_resolver import (
    AgentsMdConfig,
    AgentsMdLayer,
    AgentsMdResolver,
    _is_path_safe,
    _truncate_to_budget,
)


class TestTruncateToBudget(unittest.TestCase):
    """测试 _truncate_to_budget 工具函数"""

    def test_no_truncation_when_within_budget(self):
        content, truncated = _truncate_to_budget("hello", 100)
        self.assertEqual(content, "hello")
        self.assertFalse(truncated)

    def test_truncation_when_over_budget(self):
        content, truncated = _truncate_to_budget("hello world", 5)
        self.assertTrue(truncated)
        self.assertLessEqual(len(content.encode("utf-8")), 5)

    def test_zero_budget(self):
        content, truncated = _truncate_to_budget("hello", 0)
        self.assertEqual(content, "")
        self.assertTrue(truncated)

    def test_negative_budget(self):
        content, truncated = _truncate_to_budget("hello", -1)
        self.assertEqual(content, "")
        self.assertTrue(truncated)

    def test_utf8_safety(self):
        # 中文字符 UTF-8 是 3 字节
        content = "你好世界"  # 12 字节
        truncated_content, is_truncated = _truncate_to_budget(content, 7)
        self.assertTrue(is_truncated)
        # 不会在字符中间截断
        # 6 字节 = 2 个中文字符
        self.assertEqual(truncated_content, "你好")


class TestPathSafety(unittest.TestCase):
    """测试路径安全检查"""

    def test_path_traversal_blocked(self):
        bad_path = Path("~/.hermes/../../../etc/passwd")
        self.assertFalse(_is_path_safe(bad_path))

    def test_within_allowed_root(self):
        good_path = Path("~/.hermes/AGENTS.md")
        self.assertTrue(_is_path_safe(good_path))


class TestAgentsMdConfig(unittest.TestCase):
    """测试 AgentsMdConfig 序列化"""

    def test_default_config(self):
        cfg = AgentsMdConfig()
        self.assertEqual(cfg.max_bytes, 32 * 1024)
        self.assertEqual(cfg.max_depth, 10)
        self.assertIn("AGENTS.md", cfg.fallback_filenames)
        self.assertIn(".git", cfg.project_root_markers)

    def test_to_from_dict(self):
        cfg = AgentsMdConfig(
            max_bytes=65536,
            max_depth=5,
            developer_instructions="test",
        )
        d = cfg.to_dict()
        cfg2 = AgentsMdConfig.from_dict(d)
        self.assertEqual(cfg.max_bytes, cfg2.max_bytes)
        self.assertEqual(cfg.max_depth, cfg2.max_depth)
        self.assertEqual(cfg.developer_instructions, cfg2.developer_instructions)


class TestAgentsMdResolver(unittest.TestCase):
    """测试 AGENTS.md 多层级解析器"""

    def setUp(self):
        """创建临时项目结构"""
        self.tmpdir = Path(tempfile.mkdtemp(prefix="agents_md_test_"))
        self.resolver = AgentsMdResolver()

    def tearDown(self):
        """清理临时目录"""
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _create_agents_md(self, directory: Path, content: str, name: str = "AGENTS.md"):
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_resolve_empty(self):
        """无 AGENTS.md 时返回空结果"""
        result = self.resolver.resolve(str(self.tmpdir))
        self.assertEqual(len(result.layers), 0)
        self.assertEqual(result.total_bytes, 0)

    def test_resolve_with_agents_md(self):
        """基本加载"""
        self._create_agents_md(
            self.tmpdir, "# Project Rules\nAlways use TypeScript.",
        )
        result = self.resolver.resolve(str(self.tmpdir))
        self.assertGreaterEqual(len(result.layers), 1)

    def test_resolve_developer_instructions_prepend(self):
        """developer_instructions 注入到最前"""
        self._create_agents_md(self.tmpdir, "# Project Rules")
        result = self.resolver.resolve(
            str(self.tmpdir),
            config=AgentsMdConfig(developer_instructions="Always use TS."),
        )
        self.assertGreater(len(result.layers), 0)
        self.assertEqual(result.layers[0].scope, "developer")
        self.assertIn("Always use TS.", result.merged_content)

    def test_resolve_byte_limit_truncation(self):
        """字节限制生效"""
        large_content = "A" * 10000
        self._create_agents_md(self.tmpdir, large_content)
        result = self.resolver.resolve(
            str(self.tmpdir),
            config=AgentsMdConfig(max_bytes=1000),
        )
        self.assertLessEqual(result.total_bytes, 1000)
        # 至少有一个 layer 被截断或总共小于 1000
        self.assertTrue(result.truncated_at is not None or result.total_bytes <= 1000)

    def test_resolve_byte_limit_stops_loading(self):
        """字节限制停止加载后续"""
        # 创建 3 个 AGENTS.md 在嵌套目录
        sub1 = self.tmpdir / "sub1"
        sub2 = self.tmpdir / "sub1" / "sub2"
        self._create_agents_md(self.tmpdir, "A" * 5000)
        self._create_agents_md(sub1, "B" * 5000)
        self._create_agents_md(sub2, "C" * 5000)

        result = self.resolver.resolve(
            str(sub2),
            config=AgentsMdConfig(max_bytes=8000),
        )
        self.assertLessEqual(result.total_bytes, 8000)

    def test_override_replaces_agents_md(self):
        """AGENTS.override.md 替换 AGENTS.md"""
        self._create_agents_md(self.tmpdir, "Original content")
        self._create_agents_md(
            self.tmpdir, "Override content", name="AGENTS.override.md",
        )
        result = self.resolver.resolve(str(self.tmpdir))
        # override 应替换原文件
        found_override = any(
            layer.is_override and "Override" in layer.content
            for layer in result.layers
        )
        self.assertTrue(found_override)
        # 不应同时存在原文件
        found_original = any(
            not layer.is_override and "Original" in layer.content
            for layer in result.layers
        )
        self.assertFalse(found_original)

    def test_project_root_detection_with_git(self):
        """项目根检测 .git marker"""
        git_dir = self.tmpdir / ".git"
        git_dir.mkdir()
        sub = self.tmpdir / "subdir"
        sub.mkdir()
        root, marker = self.resolver.detect_project_root(str(sub))
        self.assertEqual(root, str(self.tmpdir))
        self.assertEqual(marker, ".git")

    def test_project_root_detection_not_found(self):
        """未找到项目根"""
        root, marker = self.resolver.detect_project_root(str(self.tmpdir))
        self.assertIsNone(root)
        self.assertIsNone(marker)

    def test_project_root_detection_custom_marker(self):
        """自定义 marker"""
        hg_dir = self.tmpdir / ".hg"
        hg_dir.mkdir()
        root, marker = self.resolver.detect_project_root(
            str(self.tmpdir), markers=[".hg"],
        )
        self.assertEqual(root, str(self.tmpdir))
        self.assertEqual(marker, ".hg")

    def test_fallback_filenames(self):
        """使用 fallback 文件名"""
        # 没有 AGENTS.md 但有 TEAM_GUIDE.md
        self._create_agents_md(
            self.tmpdir, "Team guide content", name="TEAM_GUIDE.md",
        )
        result = self.resolver.resolve(
            str(self.tmpdir),
            config=AgentsMdConfig(fallback_filenames=["AGENTS.md", "TEAM_GUIDE.md"]),
        )
        self.assertGreater(len(result.layers), 0)

    def test_max_depth_limit(self):
        """最大深度限制"""
        result = self.resolver.resolve(
            str(self.tmpdir),
            config=AgentsMdConfig(max_depth=2),
        )
        # 不应崩溃
        self.assertIsNotNone(result)

    def test_invalid_cwd(self):
        """无效 cwd"""
        result = self.resolver.resolve("/nonexistent/path/abc/xyz")
        self.assertEqual(len(result.layers), 0)

    def test_get_config(self):
        """获取配置"""
        cfg = self.resolver.get_config()
        self.assertIsInstance(cfg, AgentsMdConfig)

    def test_update_config(self):
        """更新配置"""
        new_cfg = self.resolver.update_config({"max_bytes": 16384})
        self.assertEqual(new_cfg.max_bytes, 16384)
        self.assertEqual(self.resolver.get_config().max_bytes, 16384)

    def test_update_config_persistence(self):
        """更新配置持久化"""
        self.resolver.update_config({"max_bytes": 12345})
        # 创建新实例验证持久化
        new_resolver = AgentsMdResolver()
        self.assertEqual(new_resolver.get_config().max_bytes, 12345)

    def test_concurrent_resolve(self):
        """并发解析线程安全"""
        self._create_agents_md(self.tmpdir, "Concurrent test")
        results = []
        errors = []

        def worker():
            try:
                r = self.resolver.resolve(str(self.tmpdir))
                results.append(r)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        self.assertEqual(len(results), 5)

    def test_clear_cache(self):
        """清空缓存"""
        self._create_agents_md(self.tmpdir, "Cache test")
        self.resolver.resolve(str(self.tmpdir))
        self.resolver.clear_cache()
        # 不应崩溃
        result = self.resolver.resolve(str(self.tmpdir))
        self.assertGreater(len(result.layers), 0)

    def test_to_dict_serialization(self):
        """结果可序列化"""
        self._create_agents_md(self.tmpdir, "Test")
        result = self.resolver.resolve(str(self.tmpdir))
        d = result.to_dict()
        self.assertIn("layers", d)
        self.assertIn("total_bytes", d)
        self.assertIn("merged_content", d)
        self.assertIn("project_root", d)


if __name__ == "__main__":
    unittest.main()
