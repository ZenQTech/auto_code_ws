"""
# ============================================================
# test_plugin_registry.py
# Cycle 70 G70-01 - Plugin Registry 本地注册测试
# ============================================================
"""

import io
import os
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.app.services.plugin_registry import (
    PLUGIN_TOML,
    PLUGINS_ROOT,
    Plugin,
    PluginDependency,
    PluginRegistry,
    _parse_plugin_toml,
)


VALID_PLUGIN_TOML = """[plugin]
name = "test-plugin"
version = "1.0.0"
description = "A test plugin for unit tests"

[dependencies]
mcp-github = ">=1.0.0"
logger = "^2.0.0"

[contents]
skills = ["skill-a", "skill-b"]
mcp_servers = ["github"]
agents = ["reviewer"]
"""


MISSING_PLUGIN_TOML = """[dependencies]
mcp-github = ">=1.0.0"
"""


INVALID_NAME_TOML = """[plugin]
name = "InvalidName!"
version = "1.0.0"
description = "bad name"
"""


def make_zip_bytes(plugin_toml_content: str, extra_files: dict = None) -> bytes:
    """构造一个测试用 plugin zip"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(PLUGIN_TOML, plugin_toml_content)
        if extra_files:
            for name, content in extra_files.items():
                zf.writestr(name, content)
    return buf.getvalue()


class TestParsePluginToml(unittest.TestCase):
    """测试 plugin.toml 解析"""

    def test_valid_toml(self):
        data, errors = _parse_plugin_toml(VALID_PLUGIN_TOML)
        self.assertEqual(len(errors), 0)
        self.assertIsNotNone(data)
        self.assertIn("plugin", data)

    def test_missing_plugin_section(self):
        data, errors = _parse_plugin_toml(MISSING_PLUGIN_TOML)
        self.assertIsNotNone(data)
        self.assertGreater(len(errors), 0)

    def test_invalid_name(self):
        data, errors = _parse_plugin_toml(INVALID_NAME_TOML)
        self.assertIsNotNone(data)
        self.assertGreater(len(errors), 0)

    def test_invalid_toml(self):
        data, errors = _parse_plugin_toml("not valid toml {]}")
        self.assertIsNone(data)
        self.assertGreater(len(errors), 0)


class TestPluginRegistry(unittest.TestCase):
    """测试 Plugin Registry"""

    def setUp(self):
        # 使用临时目录作为 plugins root，避免污染
        self.tmpdir = Path(tempfile.mkdtemp(prefix="plugin_test_"))
        # 注意：直接构造时使用真实 PLUGINS_ROOT
        # 这里直接使用单例，测试完清理
        self.registry = PluginRegistry()
        # 清理已有 plugins
        for plugin in list(self.registry.list_plugins()):
            self.registry.uninstall(plugin.id)

    def tearDown(self):
        # 清理所有 plugins
        for plugin in list(self.registry.list_plugins()):
            self.registry.uninstall(plugin.id)
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        # 清理 ~/.hermes/plugins 测试目录
        if PLUGINS_ROOT.exists():
            for item in PLUGINS_ROOT.iterdir():
                if item.name.startswith("test-") or item.name.startswith("plugin-test-"):
                    if item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)

    def test_install_from_zip_success(self):
        """从 zip 安装成功"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        self.assertIsNotNone(plugin)
        self.assertEqual(plugin.name, "test-plugin")
        self.assertEqual(plugin.version, "1.0.0")
        self.assertEqual(plugin.source, "local")
        self.assertEqual(len(plugin.dependencies), 2)
        self.assertEqual(len(plugin.skills), 2)
        self.assertEqual(len(plugin.mcp_servers), 1)
        self.assertEqual(len(plugin.agents), 1)

    def test_install_with_extra_files(self):
        """安装包含额外文件"""
        zip_bytes = make_zip_bytes(
            VALID_PLUGIN_TOML,
            extra_files={
                "scripts/run.sh": "#!/bin/bash\nls",
                "README.md": "# Test Plugin",
            },
        )
        plugin = self.registry.install_from_zip(zip_bytes)
        self.assertTrue(plugin.install_path)
        install_path = Path(plugin.install_path)
        self.assertTrue((install_path / "scripts" / "run.sh").exists())
        self.assertTrue((install_path / "README.md").exists())

    def test_install_invalid_toml(self):
        """无效 TOML 报错"""
        zip_bytes = make_zip_bytes("not valid toml")
        with self.assertRaises(ValueError):
            self.registry.install_from_zip(zip_bytes)

    def test_install_no_toml(self):
        """无 plugin.toml 报错"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("README.md", "# readme")
        with self.assertRaises(ValueError):
            self.registry.install_from_zip(buf.getvalue())

    def test_install_conflict_without_force(self):
        """重名冲突（无 force）"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        self.registry.install_from_zip(zip_bytes)
        with self.assertRaises(ValueError):
            self.registry.install_from_zip(zip_bytes)

    def test_install_with_force(self):
        """force 覆盖"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        self.registry.install_from_zip(zip_bytes)
        # 用 force 重装
        new_zip = make_zip_bytes(
            VALID_PLUGIN_TOML.replace("1.0.0", "2.0.0"),
        )
        plugin = self.registry.install_from_zip(new_zip, force=True)
        self.assertEqual(plugin.version, "2.0.0")

    def test_install_zip_slip_blocked(self):
        """zip slip 攻击被阻止"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(PLUGIN_TOML, VALID_PLUGIN_TOML)
            zf.writestr("../../../etc/evil.sh", "malicious")
        with self.assertRaises(ValueError):
            self.registry.install_from_zip(buf.getvalue())

    def test_install_oversized_zip_blocked(self):
        """过大 zip 被阻止"""
        # 不实际构造 10MB+ zip
        # 这里仅验证 _is_safe_zip 函数
        from backend.app.services.plugin_registry import _is_safe_zip, MAX_ZIP_SIZE
        huge_data = b"\x00" * (MAX_ZIP_SIZE + 1)
        self.assertFalse(_is_safe_zip(huge_data))

    def test_list_plugins(self):
        """列出 plugins"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        self.registry.install_from_zip(zip_bytes)
        plugins = self.registry.list_plugins()
        self.assertEqual(len(plugins), 1)

    def test_get_plugin(self):
        """按 ID 获取"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        fetched = self.registry.get_plugin(plugin.id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.id, plugin.id)

    def test_get_plugin_by_name(self):
        """按 name 获取"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        self.registry.install_from_zip(zip_bytes)
        plugin = self.registry.get_plugin_by_name("test-plugin")
        self.assertIsNotNone(plugin)
        self.assertEqual(plugin.name, "test-plugin")

    def test_set_enabled(self):
        """启用/禁用"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        updated = self.registry.set_enabled(plugin.id, False)
        self.assertFalse(updated.enabled)
        updated = self.registry.set_enabled(plugin.id, True)
        self.assertTrue(updated.enabled)

    def test_uninstall(self):
        """卸载"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        install_path = Path(plugin.install_path)
        self.assertTrue(install_path.exists())

        success = self.registry.uninstall(plugin.id)
        self.assertTrue(success)
        self.assertFalse(install_path.exists())
        # 不应再可获取
        self.assertIsNone(self.registry.get_plugin(plugin.id))

    def test_uninstall_nonexistent(self):
        """卸载不存在的 plugin"""
        success = self.registry.uninstall("nonexistent-id")
        self.assertFalse(success)

    def test_plugin_to_dict(self):
        """Plugin 可序列化"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        d = plugin.to_dict()
        self.assertIn("id", d)
        self.assertIn("name", d)
        self.assertIn("dependencies", d)
        self.assertEqual(len(d["dependencies"]), 2)

    def test_dependency_tracking(self):
        """依赖追踪"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        deps = plugin.dependencies
        dep_names = {d.name for d in deps}
        self.assertIn("mcp-github", dep_names)
        self.assertIn("logger", dep_names)
        # version_spec 应保留
        for dep in deps:
            if dep.name == "mcp-github":
                self.assertEqual(dep.version_spec, ">=1.0.0")

    def test_persistence(self):
        """持久化"""
        zip_bytes = make_zip_bytes(VALID_PLUGIN_TOML)
        plugin = self.registry.install_from_zip(zip_bytes)
        # 模拟重启
        new_registry = PluginRegistry()
        fetched = new_registry.get_plugin(plugin.id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.name, "test-plugin")


if __name__ == "__main__":
    unittest.main()
