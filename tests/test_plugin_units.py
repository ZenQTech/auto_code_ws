"""
# ============================================================
# Plugin System - 单元测试
# ============================================================
# 核心作用：测试 Plugin 系统的所有核心功能
# 覆盖：base/loader/registry/resolver/validator/installer
# Cycle 12 P0-1 新建
# ============================================================
"""

import json
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any, Dict, List

from app.core.plugins import (
    CircularDependencyError,
    ComponentType,
    DependencyError,
    InstallError,
    ManifestError,
    ManifestValidationError,
    Plugin,
    PluginAlreadyExistsError,
    PluginAuthor,
    PluginComponents,
    PluginDependencies,
    PluginError,
    PluginInstaller,
    PluginLoader,
    PluginManifest,
    PluginNotFoundError,
    PluginPermissions,
    PluginRegistry,
    PluginRepository,
    PluginStatus,
    PluginVerification,
    PluginValidator,
    DependencyResolver,
    parse_manifest_file,
    semver_compare,
)


# ============================================================
# 工具函数
# ============================================================
def make_minimal_manifest(**overrides) -> Dict[str, Any]:
    """构造最小可用 manifest"""
    manifest = {
        "id": "test-plugin",
        "name": "Test Plugin",
        "version": "1.0.0",
        "description": "Test plugin",
        "author": {"name": "Tester"},
        "license": "MIT",
    }
    manifest.update(overrides)
    return manifest


def make_plugin_dir(tmpdir: Path, manifest: Dict[str, Any], files: Dict[str, str] = None) -> Path:
    """创建测试 Plugin 目录"""
    plugin_dir = tmpdir / manifest["id"]
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    for path, content in (files or {}).items():
        file_path = plugin_dir / path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
    return plugin_dir


# ============================================================
# 1. 数据模型测试
# ============================================================
class TestPluginManifest(unittest.TestCase):
    """PluginManifest 数据模型测试"""

    def test_minimal_manifest(self):
        """最小 manifest 解析"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        self.assertEqual(m.id, "test-plugin")
        self.assertEqual(m.name, "Test Plugin")
        self.assertEqual(m.version, "1.0.0")
        self.assertEqual(m.license, "MIT")
        self.assertEqual(m.author.name, "Tester")

    def test_full_manifest(self):
        """完整 manifest 解析"""
        data = make_minimal_manifest(
            keywords=["test", "demo"],
            categories=["testing"],
            hermes_version=">=6.17.0",
            components={"skills": ["skills/foo"], "agents": ["agents/bar.md"]},
        )
        m = PluginManifest.from_dict(data)
        self.assertEqual(m.keywords, ["test", "demo"])
        self.assertEqual(m.categories, ["testing"])
        self.assertEqual(m.components.skills, ["skills/foo"])
        self.assertEqual(m.components.agents, ["agents/bar.md"])

    def test_missing_required_field(self):
        """必填字段缺失"""
        data = {"id": "test", "name": "Test"}  # 缺少 version/description/author
        with self.assertRaises(ValueError):
            PluginManifest.from_dict(data)

    def test_author_string(self):
        """author 为字符串"""
        data = make_minimal_manifest(author="John Doe")
        m = PluginManifest.from_dict(data)
        self.assertEqual(m.author.name, "John Doe")

    def test_validate_kebab_case_id(self):
        """ID 必须是 kebab-case"""
        m = PluginManifest.from_dict(make_minimal_manifest(id="Test_Plugin"))
        errors = m.validate()
        self.assertTrue(any("kebab-case" in e for e in errors))

    def test_validate_semver(self):
        """版本必须是 semver"""
        m = PluginManifest.from_dict(make_minimal_manifest(version="v1.0"))
        errors = m.validate()
        self.assertTrue(any("semver" in e for e in errors))

    def test_to_dict(self):
        """to_dict 序列化"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        d = m.to_dict()
        self.assertEqual(d["id"], "test-plugin")
        self.assertIn("author", d)
        self.assertIn("components", d)
        self.assertIn("permissions", d)


class TestPluginComponents(unittest.TestCase):
    """PluginComponents 测试"""

    def test_total_count_zero(self):
        """空组件总数为 0"""
        c = PluginComponents()
        self.assertEqual(c.total_count(), 0)

    def test_total_count_with_components(self):
        """多组件总数"""
        c = PluginComponents(
            skills=["s1", "s2"],
            agents=["a1"],
            hooks=["h1", "h2", "h3"],
        )
        self.assertEqual(c.total_count(), 6)

    def test_to_dict(self):
        """to_dict 序列化"""
        c = PluginComponents(skills=["s1"])
        d = c.to_dict()
        self.assertEqual(d["skills"], ["s1"])
        self.assertEqual(d["agents"], [])


class TestSemverCompare(unittest.TestCase):
    """semver 比较测试"""

    def test_equal(self):
        self.assertTrue(semver_compare("1.0.0", "1.0.0"))
        self.assertTrue(semver_compare("1.0.0", "==1.0.0"))

    def test_gte(self):
        self.assertTrue(semver_compare("1.0.0", ">=1.0.0"))
        self.assertTrue(semver_compare("2.0.0", ">=1.0.0"))
        self.assertFalse(semver_compare("0.9.0", ">=1.0.0"))

    def test_gt(self):
        self.assertTrue(semver_compare("1.0.1", ">1.0.0"))
        self.assertFalse(semver_compare("1.0.0", ">1.0.0"))

    def test_lte(self):
        self.assertTrue(semver_compare("1.0.0", "<=2.0.0"))
        self.assertFalse(semver_compare("3.0.0", "<=2.0.0"))

    def test_caret(self):
        self.assertTrue(semver_compare("1.2.3", "^1.0.0"))
        self.assertTrue(semver_compare("1.5.0", "^1.0.0"))
        self.assertFalse(semver_compare("2.0.0", "^1.0.0"))

    def test_tilde(self):
        self.assertTrue(semver_compare("1.2.5", "~1.2.0"))
        self.assertFalse(semver_compare("1.3.0", "~1.2.0"))


class TestParseManifestFile(unittest.TestCase):
    """parse_manifest_file 测试"""

    def test_valid_file(self):
        """有效 manifest 文件"""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "manifest.json"
            p.write_text(json.dumps(make_minimal_manifest()), encoding="utf-8")
            m = parse_manifest_file(p)
            self.assertEqual(m.id, "test-plugin")

    def test_missing_file(self):
        """缺失文件"""
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                parse_manifest_file(Path(tmp) / "manifest.json")

    def test_invalid_json(self):
        """无效 JSON"""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "manifest.json"
            p.write_text("{invalid", encoding="utf-8")
            with self.assertRaises(ValueError):
                parse_manifest_file(p)


# ============================================================
# 2. 加载器测试
# ============================================================
class TestPluginLoader(unittest.TestCase):
    """PluginLoader 测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="plugin_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_scan_empty_dir(self):
        """扫描空目录"""
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(plugins, [])

    def test_scan_single_plugin(self):
        """扫描单个 Plugin"""
        make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(id="plug-a", name="Plug A"),
            {"skills/test/SKILL.md": "# Test"},
        )
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(len(plugins), 1)
        self.assertEqual(plugins[0].manifest.id, "plug-a")

    def test_scan_skip_template(self):
        """跳过 _template 目录"""
        make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(id="_template", name="Template"),
        )
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(plugins, [])

    def test_scan_skip_hidden(self):
        """跳过隐藏目录"""
        make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(id=".hidden", name="Hidden"),
        )
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(plugins, [])

    def test_scan_invalid_manifest(self):
        """扫描无效 manifest（标记为错误）"""
        plugin_dir = self.tmpdir / "bad-plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text("{invalid json", encoding="utf-8")
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(len(plugins), 1)
        self.assertEqual(plugins[0].status, PluginStatus.ERROR)

    def test_scan_missing_required_field(self):
        """扫描缺少必填字段"""
        plugin_dir = self.tmpdir / "bad-plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({"id": "bad"}), encoding="utf-8")
        loader = PluginLoader(base_dirs=[self.tmpdir])
        plugins = loader.scan_all()
        self.assertEqual(len(plugins), 1)
        self.assertEqual(plugins[0].status, PluginStatus.ERROR)

    def test_load_from_path(self):
        """从路径加载"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(id="loaded"),
        )
        loader = PluginLoader()
        plugin = loader.load_from_path(plugin_dir)
        self.assertEqual(plugin.manifest.id, "loaded")

    def test_load_from_path_no_manifest(self):
        """无 manifest.json 抛异常"""
        plugin_dir = self.tmpdir / "no-manifest"
        plugin_dir.mkdir()
        loader = PluginLoader()
        with self.assertRaises(ManifestError):
            loader.load_from_path(plugin_dir)

    def test_load_history(self):
        """加载历史记录"""
        make_plugin_dir(self.tmpdir, make_minimal_manifest(id="plug-h"))
        loader = PluginLoader(base_dirs=[self.tmpdir])
        loader.scan_all()
        history = loader.get_load_history()
        self.assertGreater(len(history), 0)
        self.assertEqual(history[0]["plugin_id"], "plug-h")


# ============================================================
# 3. 注册表测试
# ============================================================
class TestPluginRegistry(unittest.TestCase):
    """PluginRegistry 测试"""

    def setUp(self):
        self.registry = PluginRegistry()
        self.tmpdir = Path(tempfile.mkdtemp(prefix="registry_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_plugin(self, plugin_id: str = "p1", name: str = "P1", **kwargs) -> Plugin:
        manifest = PluginManifest.from_dict(make_minimal_manifest(
            id=plugin_id, name=name, **kwargs
        ))
        return Plugin(manifest=manifest, base_path=self.tmpdir / plugin_id)

    def test_register_and_get(self):
        """注册和获取"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        got = self.registry.get(plugin.manifest.id)
        self.assertEqual(got.manifest.id, plugin.manifest.id)

    def test_register_duplicate_raises(self):
        """重复注册抛异常"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        with self.assertRaises(Exception):  # PluginAlreadyExistsError
            self.registry.register(plugin)

    def test_register_overwrite(self):
        """覆盖注册"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        self.registry.register(plugin, overwrite=True)
        self.assertEqual(len(self.registry.list_all()), 1)

    def test_get_optional(self):
        """get_optional 不存在返回 None"""
        self.assertIsNone(self.registry.get_optional("nonexistent"))

    def test_get_optional_exists(self):
        """get_optional 存在返回 Plugin"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        self.assertIsNotNone(self.registry.get_optional(plugin.manifest.id))

    def test_get_by_name(self):
        """按 name 查询"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        got = self.registry.get_by_name("P1")
        self.assertIsNotNone(got)
        self.assertEqual(got.manifest.id, plugin.manifest.id)

    def test_list_by_category(self):
        """按 category 查询"""
        plugin = self._make_plugin(categories=["testing", "core"])
        self.registry.register(plugin)
        results = self.registry.list_by_category("testing")
        self.assertEqual(len(results), 1)

    def test_list_by_status(self):
        """按 status 查询"""
        plugin1 = self._make_plugin("p1")
        plugin2 = self._make_plugin("p2")
        self.registry.register(plugin1)
        self.registry.register(plugin2)
        plugin1.enable()
        results = self.registry.list_by_status(PluginStatus.ENABLED)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].manifest.id, "p1")

    def test_list_enabled(self):
        """列出启用 Plugin"""
        plugin1 = self._make_plugin("p1")
        plugin2 = self._make_plugin("p2")
        self.registry.register(plugin1)
        self.registry.register(plugin2)
        plugin1.enable()
        enabled = self.registry.list_enabled()
        self.assertEqual(len(enabled), 1)

    def test_enable_disable(self):
        """启用/禁用"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        self.registry.enable(plugin.manifest.id)
        self.assertTrue(self.registry.get(plugin.manifest.id).enabled)
        self.registry.disable(plugin.manifest.id)
        self.assertFalse(self.registry.get(plugin.manifest.id).enabled)

    def test_unregister(self):
        """注销"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        self.registry.unregister(plugin.manifest.id)
        self.assertEqual(len(self.registry.list_all()), 0)

    def test_unregister_nonexistent(self):
        """注销不存在抛异常"""
        with self.assertRaises(PluginNotFoundError):
            self.registry.unregister("nonexistent")

    def test_search(self):
        """搜索"""
        plugin = self._make_plugin(plugin_id="search-me", description="A test plugin")
        self.registry.register(plugin)
        results = self.registry.search("test")
        self.assertGreater(len(results), 0)

    def test_search_empty(self):
        """搜索空字符串返回所有"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        results = self.registry.search("")
        self.assertEqual(len(results), 1)

    def test_search_no_match(self):
        """搜索无匹配"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        results = self.registry.search("nonexistent-keyword-xyz")
        self.assertEqual(results, [])

    def test_get_stats(self):
        """统计信息"""
        plugin1 = self._make_plugin("p1")
        plugin2 = self._make_plugin("p2")
        self.registry.register(plugin1)
        self.registry.register(plugin2)
        plugin1.enable()
        stats = self.registry.get_stats()
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["enabled"], 1)

    def test_clear(self):
        """清空"""
        plugin = self._make_plugin()
        self.registry.register(plugin)
        self.registry.clear()
        self.assertEqual(len(self.registry.list_all()), 0)

    def test_thread_safety(self):
        """线程安全"""
        plugins = [self._make_plugin(f"p{i}") for i in range(10)]
        def register_one(p):
            self.registry.register(p)
        threads = [threading.Thread(target=register_one, args=(p,)) for p in plugins]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(self.registry.list_all()), 10)


# ============================================================
# 4. 解析器测试
# ============================================================
class TestDependencyResolver(unittest.TestCase):
    """DependencyResolver 测试"""

    def setUp(self):
        self.resolver = DependencyResolver(hermes_version="6.17.1")
        self.tmpdir = Path(tempfile.mkdtemp(prefix="resolver_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_plugin(self, plugin_id: str, **kwargs) -> Plugin:
        manifest = PluginManifest.from_dict(make_minimal_manifest(id=plugin_id, name=plugin_id, **kwargs))
        return Plugin(manifest=manifest, base_path=self.tmpdir / plugin_id)

    def test_check_hermes_version_ok(self):
        """Hermes 版本检查通过"""
        plugin = self._make_plugin("p1", hermes_version=">=6.0.0")
        self.assertTrue(self.resolver.check_hermes_version(plugin))

    def test_check_hermes_version_fail(self):
        """Hermes 版本检查失败"""
        plugin = self._make_plugin("p1", hermes_version=">=7.0.0")
        self.assertFalse(self.resolver.check_hermes_version(plugin))

    def test_check_python_version(self):
        """Python 版本检查"""
        plugin = self._make_plugin("p1")
        # 当前 Python 3.10
        plugin.manifest.dependencies.python = ">=3.8"
        self.assertTrue(self.resolver.check_python_version(plugin))
        plugin.manifest.dependencies.python = ">=4.0"
        self.assertFalse(self.resolver.check_python_version(plugin))

    def test_validate_plugin_hermes_error(self):
        """验证 Plugin 兼容性"""
        plugin = self._make_plugin("p1", hermes_version=">=99.0.0")
        errors = self.resolver.validate_plugin(plugin)
        self.assertGreater(len(errors), 0)

    def test_topological_sort_simple(self):
        """简单拓扑排序"""
        a = self._make_plugin("a")
        b = self._make_plugin("b", dependencies={"plugins": ["a"]})
        ordered = self.resolver.topological_sort([b, a])
        ids = [p.manifest.id for p in ordered]
        self.assertEqual(ids, ["a", "b"])

    def test_topological_sort_complex(self):
        """复杂拓扑排序"""
        a = self._make_plugin("a")
        b = self._make_plugin("b", dependencies={"plugins": ["a"]})
        c = self._make_plugin("c", dependencies={"plugins": ["a", "b"]})
        d = self._make_plugin("d", dependencies={"plugins": ["c"]})
        ordered = self.resolver.topological_sort([d, c, b, a])
        ids = [p.manifest.id for p in ordered]
        # a 必须先于 b，b 先于 c，c 先于 d
        self.assertLess(ids.index("a"), ids.index("b"))
        self.assertLess(ids.index("b"), ids.index("c"))
        self.assertLess(ids.index("c"), ids.index("d"))

    def test_detect_no_cycle(self):
        """无循环"""
        a = self._make_plugin("a")
        b = self._make_plugin("b", dependencies={"plugins": ["a"]})
        self.assertIsNone(self.resolver.detect_cycle([a, b]))

    def test_detect_cycle(self):
        """检测循环依赖"""
        a = self._make_plugin("a", dependencies={"plugins": ["b"]})
        b = self._make_plugin("b", dependencies={"plugins": ["a"]})
        cycle = self.resolver.detect_cycle([a, b])
        self.assertIsNotNone(cycle)

    def test_topological_sort_cycle_raises(self):
        """循环依赖抛异常"""
        a = self._make_plugin("a", dependencies={"plugins": ["b"]})
        b = self._make_plugin("b", dependencies={"plugins": ["a"]})
        with self.assertRaises(CircularDependencyError):
            self.resolver.topological_sort([a, b])

    def test_check_all_dependencies(self):
        """检查所有依赖"""
        a = self._make_plugin("a")
        b = self._make_plugin("b", dependencies={"plugins": ["nonexistent"]})
        available, unavailable = self.resolver.check_all_dependencies([a, b])
        self.assertEqual(len(available), 1)
        self.assertEqual(len(unavailable), 1)


# ============================================================
# 5. 验证器测试
# ============================================================
class TestPluginValidator(unittest.TestCase):
    """PluginValidator 测试"""

    def setUp(self):
        self.validator = PluginValidator()
        self.tmpdir = Path(tempfile.mkdtemp(prefix="validator_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_validate_manifest_ok(self):
        """合法 manifest"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        errors = self.validator.validate_manifest(m)
        self.assertEqual(errors, [])

    def test_validate_manifest_no_id(self):
        """缺 id"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.id = ""
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("id" in e for e in errors))

    def test_validate_manifest_no_name(self):
        """缺 name"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.name = ""
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("name" in e for e in errors))

    def test_validate_manifest_no_version(self):
        """缺 version"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.version = ""
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("version" in e for e in errors))

    def test_validate_manifest_no_description(self):
        """缺 description"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.description = ""
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("description" in e for e in errors))

    def test_validate_manifest_no_hermes_version(self):
        """缺 hermes_version"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.hermes_version = ""
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("hermes_version" in e for e in errors))

    def test_validate_manifest_invalid_email(self):
        """无效 email"""
        m = PluginManifest.from_dict(make_minimal_manifest())
        m.author.email = "not-an-email"
        errors = self.validator.validate_manifest(m)
        self.assertTrue(any("email" in e for e in errors))

    def test_validate_path_allowed(self):
        """合法路径"""
        self.assertTrue(self.validator.validate_path("/home/qizheng/auto_code_ws/plugins"))

    def test_validate_path_not_allowed(self):
        """非法路径"""
        self.assertFalse(self.validator.validate_path("/etc/passwd"))

    def test_validate_components_exist(self):
        """验证组件存在性"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(components={"skills": ["skills/missing"]}),
        )
        manifest = parse_manifest_file(plugin_dir / "manifest.json")
        plugin = Plugin(manifest=manifest, base_path=plugin_dir)
        errors = self.validator.validate_components_exist(plugin)
        self.assertTrue(any("Skill not found" in e for e in errors))

    def test_validate_components_all_exist(self):
        """所有组件都存在"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(components={"skills": ["skills/test"]}),
            {"skills/test/SKILL.md": "# Test"},
        )
        manifest = parse_manifest_file(plugin_dir / "manifest.json")
        plugin = Plugin(manifest=manifest, base_path=plugin_dir)
        errors = self.validator.validate_components_exist(plugin)
        self.assertEqual(errors, [])

    def test_compute_checksum(self):
        """计算校验和"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(),
            {"skills/test/SKILL.md": "# Test"},
        )
        manifest = parse_manifest_file(plugin_dir / "manifest.json")
        plugin = Plugin(manifest=manifest, base_path=plugin_dir)
        checksum = self.validator.compute_checksum(plugin)
        self.assertTrue(checksum.startswith("sha256:"))
        self.assertEqual(len(checksum), len("sha256:") + 64)

    def test_validate_or_raise_ok(self):
        """验证通过不抛异常"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(),
        )
        manifest = parse_manifest_file(plugin_dir / "manifest.json")
        plugin = Plugin(manifest=manifest, base_path=plugin_dir)
        # 不应抛异常
        self.validator.validate_or_raise(plugin)

    def test_validate_or_raise_fail(self):
        """验证失败抛异常"""
        plugin_dir = make_plugin_dir(
            self.tmpdir,
            make_minimal_manifest(),
        )
        manifest = parse_manifest_file(plugin_dir / "manifest.json")
        plugin = Plugin(manifest=manifest, base_path=plugin_dir)
        # 路径非法
        plugin.base_path = Path("/etc/forbidden")
        with self.assertRaises(ManifestValidationError):
            self.validator.validate_or_raise(plugin)


# ============================================================
# 6. 安装器测试
# ============================================================
class TestPluginInstaller(unittest.TestCase):
    """PluginInstaller 测试"""

    def setUp(self):
        # 准备安装目录
        self.tmp_install = Path(tempfile.mkdtemp(prefix="install_test_")) / "plugins"
        self.tmp_install.mkdir(parents=True)
        # 准备源 Plugin
        self.tmp_source = Path(tempfile.mkdtemp(prefix="source_test_"))
        self.installer = PluginInstaller(install_dir=self.tmp_install)

    def tearDown(self):
        shutil.rmtree(self.tmp_install.parent, ignore_errors=True)
        shutil.rmtree(self.tmp_source, ignore_errors=True)

    def _make_source(self, plugin_id: str = "src-plug") -> Path:
        return make_plugin_dir(
            self.tmp_source,
            make_minimal_manifest(id=plugin_id, name=plugin_id),
        )

    def test_install(self):
        """安装 Plugin"""
        src = self._make_source("install-1")
        plugin = self.installer.install(src)
        self.assertEqual(plugin.manifest.id, "install-1")
        self.assertTrue((self.tmp_install / "install-1").exists())

    def test_install_duplicate(self):
        """重复安装抛异常"""
        src = self._make_source("dup-plug")
        self.installer.install(src)
        with self.assertRaises(Exception):  # PluginAlreadyExistsError
            self.installer.install(src)

    def test_install_nonexistent_path(self):
        """路径不存在"""
        with self.assertRaises(InstallError):
            self.installer.install(Path("/nonexistent/path"))

    def test_uninstall(self):
        """卸载"""
        src = self._make_source("to-uninstall")
        self.installer.install(src)
        self.installer.uninstall("to-uninstall")
        self.assertIsNone(self.installer.registry.get_optional("to-uninstall"))

    def test_uninstall_nonexistent(self):
        """卸载不存在"""
        with self.assertRaises(PluginNotFoundError):
            self.installer.uninstall("nonexistent")

    def test_uninstall_with_dependents(self):
        """有依赖时拒绝卸载"""
        # 简化测试：注册一个有依赖的 Plugin
        a_src = self._make_source("dep-a")
        self.installer.install(a_src)
        # 手动注册一个依赖 a 的 Plugin
        dep_manifest = PluginManifest.from_dict(make_minimal_manifest(
            id="dep-b", name="B", dependencies={"plugins": ["dep-a"]}
        ))
        dep_plugin = Plugin(manifest=dep_manifest, base_path=self.tmp_install / "dep-b")
        self.installer.registry.register(dep_plugin)
        # 尝试卸载 a
        with self.assertRaises(DependencyError):
            self.installer.uninstall("dep-a")

    def test_enable_disable(self):
        """启用/禁用"""
        src = self._make_source("enable-test")
        self.installer.install(src)
        self.installer.enable("enable-test")
        self.assertTrue(self.installer.registry.get("enable-test").enabled)
        self.installer.disable("enable-test")
        self.assertFalse(self.installer.registry.get("enable-test").enabled)

    def test_reload(self):
        """重新加载"""
        src = self._make_source("reload-test")
        self.installer.install(src)
        self.installer.enable("reload-test")
        reloaded = self.installer.reload("reload-test")
        # 启用状态保留
        self.assertTrue(reloaded.enabled)

    def test_reload_nonexistent(self):
        """重载不存在"""
        with self.assertRaises(PluginNotFoundError):
            self.installer.reload("nonexistent")

    def test_scan_and_register(self):
        """扫描并注册"""
        src = self._make_source("scanned")
        self.installer.install(src)
        # 重置 registry
        self.installer.registry.clear()
        # 重新扫描
        count = self.installer.scan_and_register()
        self.assertGreaterEqual(count, 1)

    def test_install_missing_dependency(self):
        """缺失依赖"""
        # 创建有依赖的 Plugin（但依赖未安装）
        manifest = make_minimal_manifest(id="needs-dep", dependencies={"plugins": ["nonexistent-dep"]})
        src = make_plugin_dir(self.tmp_source, manifest)
        with self.assertRaises(DependencyError):
            self.installer.install(src)

    def test_get_stats(self):
        """统计信息"""
        stats = self.installer.get_stats()
        self.assertIn("install_dir", stats)
        self.assertIn("registry", stats)


# ============================================================
# 7. Plugin 生命周期测试
# ============================================================
class TestPluginLifecycle(unittest.TestCase):
    """Plugin 生命周期测试"""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="lifecycle_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_enable_marks_status(self):
        """启用改变状态"""
        manifest = PluginManifest.from_dict(make_minimal_manifest())
        plugin = Plugin(manifest=manifest, base_path=self.tmpdir)
        self.assertEqual(plugin.status, PluginStatus.AVAILABLE)
        plugin.enable()
        self.assertEqual(plugin.status, PluginStatus.ENABLED)
        self.assertTrue(plugin.enabled)

    def test_disable_marks_status(self):
        """禁用改变状态"""
        manifest = PluginManifest.from_dict(make_minimal_manifest())
        plugin = Plugin(manifest=manifest, base_path=self.tmpdir)
        plugin.enable()
        plugin.disable()
        self.assertEqual(plugin.status, PluginStatus.DISABLED)
        self.assertFalse(plugin.enabled)

    def test_mark_error(self):
        """标记错误"""
        manifest = PluginManifest.from_dict(make_minimal_manifest())
        plugin = Plugin(manifest=manifest, base_path=self.tmpdir)
        plugin.mark_error("Test error")
        self.assertEqual(plugin.status, PluginStatus.ERROR)
        self.assertEqual(plugin.error_message, "Test error")

    def test_to_dict(self):
        """to_dict 序列化"""
        manifest = PluginManifest.from_dict(make_minimal_manifest())
        plugin = Plugin(manifest=manifest, base_path=self.tmpdir, enabled=True)
        d = plugin.to_dict()
        self.assertEqual(d["id"], "test-plugin")
        self.assertTrue(d["enabled"])
        self.assertIn("components", d)


# ============================================================
# 8. 异常测试
# ============================================================
class TestExceptions(unittest.TestCase):
    """异常类测试"""

    def test_plugin_error(self):
        """基础异常"""
        e = PluginError("test message", code="TEST_CODE", details={"k": "v"})
        self.assertEqual(e.message, "test message")
        self.assertEqual(e.code, "TEST_CODE")
        self.assertEqual(e.details, {"k": "v"})

    def test_plugin_not_found(self):
        """PluginNotFoundError"""
        e = PluginNotFoundError("missing")
        self.assertIn("missing", e.message)
        self.assertEqual(e.code, "PLUGIN_NOT_FOUND")

    def test_plugin_already_exists(self):
        """PluginAlreadyExistsError"""
        e = PluginAlreadyExistsError("dup")
        self.assertIn("dup", e.message)
        self.assertEqual(e.code, "PLUGIN_ALREADY_EXISTS")

    def test_manifest_error(self):
        """ManifestError"""
        e = ManifestError("/path/manifest.json", "test reason")
        self.assertIn("/path/manifest.json", e.message)
        self.assertEqual(e.code, "MANIFEST_ERROR")

    def test_dependency_error(self):
        """DependencyError"""
        e = DependencyError("plugin-id", "missing dep")
        self.assertEqual(e.code, "DEPENDENCY_ERROR")

    def test_to_dict(self):
        """异常 to_dict"""
        e = PluginNotFoundError("xyz")
        d = e.to_dict()
        self.assertIn("error", d)
        self.assertIn("message", d)
        self.assertIn("details", d)


# ============================================================
# 测试入口
# ============================================================
if __name__ == "__main__":
    unittest.main(verbosity=2)
