"""
# ============================================================
# Goal Templates - 单元测试
# ============================================================
# 核心作用：覆盖 Goal Templates 全部功能
# 覆盖范围：
#   - 数据模型：AC / GoalTemplate / Instantiation
#   - 名称/标签验证
#   - 注册/更新/注销（CRUD）
#   - 内置模板自动加载
#   - Fork 内置模板
#   - 实例化（生成 goal_config）
#   - 实例化历史
#   - 导入/导出
#   - 过滤（category / source / tag / keyword）
#   - 统计
#   - 全局单例
#   - API 路由
# 运行：python3 -m pytest tests/test_goal_templates_units.py -v
# ============================================================
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# 添加 backend 目录到 sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.goal_templates import (
    AcceptanceCriterionTemplate,
    GoalTemplate,
    TemplateCategory,
    TemplateInstantiation,
    TemplateManager,
    TemplateSource,
    get_manager,
    reset_manager,
)


# ============================================================
# 工具函数
# ============================================================
def _make_temp_dir() -> str:
    """创建临时目录"""
    return tempfile.mkdtemp(prefix="goal_templates_test_")


def _cleanup_dir(path: str) -> None:
    """清理目录"""
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


def _make_sample_template(
    template_id: str = "tpl_test_001",
    name: str = "测试模板",
    source: str = TemplateSource.CUSTOM.value,
    **kwargs,
) -> GoalTemplate:
    """构造一个示例模板"""
    return GoalTemplate(
        template_id=template_id,
        name=name,
        description=kwargs.get("description", "测试描述"),
        category=kwargs.get("category", TemplateCategory.DEVELOPMENT.value),
        source=source,
        tags=kwargs.get("tags", ["test"]),
        acceptance_criteria=[
            AcceptanceCriterionTemplate(
                ac_id="ac1",
                title="AC 1",
                description="第一个 AC",
                priority=5,
                ac_type="implementation",
                risk_level="medium",
            ),
            AcceptanceCriterionTemplate(
                ac_id="ac2",
                title="AC 2",
                description="第二个 AC",
                priority=3,
                ac_type="testing",
                risk_level="low",
            ),
        ],
        default_strategy=kwargs.get("default_strategy", "standard"),
        default_max_turns=kwargs.get("default_max_turns", 10),
        default_triggers=kwargs.get("default_triggers", ["manual"]),
        recommended_agents=kwargs.get("recommended_agents", ["implementer"]),
        created_by=kwargs.get("created_by", "user"),
    )


# ============================================================
# 数据模型测试
# ============================================================
class TestAcceptanceCriterionTemplate(unittest.TestCase):
    """AcceptanceCriterionTemplate 数据类测试"""

    def test_default_values(self):
        ac = AcceptanceCriterionTemplate(ac_id="ac1", title="Test")
        self.assertEqual(ac.ac_id, "ac1")
        self.assertEqual(ac.priority, 5)
        self.assertEqual(ac.ac_type, "implementation")
        self.assertEqual(ac.risk_level, "medium")
        self.assertEqual(ac.verify_items, [])

    def test_to_from_dict(self):
        ac = AcceptanceCriterionTemplate(
            ac_id="ac1",
            title="Test",
            description="Desc",
            priority=7,
            ac_type="testing",
            risk_level="high",
        )
        d = ac.to_dict()
        ac2 = AcceptanceCriterionTemplate.from_dict(d)
        self.assertEqual(ac2.ac_id, "ac1")
        self.assertEqual(ac2.title, "Test")
        self.assertEqual(ac2.priority, 7)
        self.assertEqual(ac2.risk_level, "high")

    def test_from_dict_auto_id(self):
        """当 ac_id 为空时自动生成"""
        ac = AcceptanceCriterionTemplate.from_dict({"title": "X"})
        self.assertTrue(ac.ac_id.startswith("ac_"))


class TestGoalTemplate(unittest.TestCase):
    """GoalTemplate 数据类测试"""

    def test_default_values(self):
        tpl = GoalTemplate(template_id="t1", name="T1")
        self.assertEqual(tpl.template_id, "t1")
        self.assertEqual(tpl.version, 1)
        self.assertEqual(tpl.category, TemplateCategory.OTHER.value)
        self.assertEqual(tpl.source, TemplateSource.CUSTOM.value)
        self.assertEqual(tpl.instantiations, 0)
        self.assertEqual(tpl.default_max_turns, 50)
        self.assertIn("manual", tpl.default_triggers)

    def test_is_builtin(self):
        t1 = GoalTemplate(template_id="t1", name="T1", source="builtin")
        t2 = GoalTemplate(template_id="t2", name="T2", source="custom")
        self.assertTrue(t1.is_builtin())
        self.assertFalse(t2.is_builtin())

    def test_to_from_dict(self):
        tpl = _make_sample_template()
        d = tpl.to_dict()
        tpl2 = GoalTemplate.from_dict(d)
        self.assertEqual(tpl2.template_id, tpl.template_id)
        self.assertEqual(tpl2.name, tpl.name)
        self.assertEqual(len(tpl2.acceptance_criteria), len(tpl.acceptance_criteria))


class TestTemplateInstantiation(unittest.TestCase):
    """TemplateInstantiation 数据类测试"""

    def test_default_values(self):
        inst = TemplateInstantiation(template_id="t1", goal_id="g1")
        self.assertEqual(inst.template_id, "t1")
        self.assertEqual(inst.goal_id, "g1")
        self.assertEqual(inst.ac_count, 0)
        self.assertIn("T", inst.instantiated_at)  # ISO 格式

    def test_to_from_dict(self):
        inst = TemplateInstantiation(
            template_id="t1", goal_id="g1", ac_count=5
        )
        d = inst.to_dict()
        inst2 = TemplateInstantiation.from_dict(d)
        self.assertEqual(inst2.ac_count, 5)


# ============================================================
# 名称/标签验证
# ============================================================
class TestNameValidation(unittest.TestCase):
    """名称验证测试"""

    def test_valid_name(self):
        from app.core.goal_templates.manager import _validate_name
        valid, _ = _validate_name("Test Template 1")
        self.assertTrue(valid)
        valid, _ = _validate_name("功能开发_v1.0")
        self.assertTrue(valid)
        valid, _ = _validate_name("a-b_c.d")
        self.assertTrue(valid)

    def test_empty_name(self):
        from app.core.goal_templates.manager import _validate_name
        valid, err = _validate_name("")
        self.assertFalse(valid)
        self.assertIn("empty", err)

    def test_too_long_name(self):
        from app.core.goal_templates.manager import _validate_name
        valid, err = _validate_name("x" * 200)
        self.assertFalse(valid)
        self.assertIn("too long", err)

    def test_invalid_chars(self):
        from app.core.goal_templates.manager import _validate_name
        # 控制字符为非法
        valid, _ = _validate_name("name\x00bad")
        self.assertFalse(valid)


class TestTagValidation(unittest.TestCase):
    """标签验证测试"""

    def test_valid_tags(self):
        from app.core.goal_templates.manager import _validate_tags
        valid, _ = _validate_tags(["bug", "fix", "v1.0"])
        self.assertTrue(valid)

    def test_invalid_tag_chars(self):
        from app.core.goal_templates.manager import _validate_tags
        # 空格和特殊字符在 tag 中不允许
        valid, err = _validate_tags(["bad tag with space"])
        self.assertFalse(valid)
        self.assertIn("invalid", err)

    def test_non_list(self):
        from app.core.goal_templates.manager import _validate_tags
        valid, err = _validate_tags("not-a-list")  # type: ignore
        self.assertFalse(valid)
        self.assertIn("list", err)


# ============================================================
# 模板管理 - 注册与内置模板
# ============================================================
class TestTemplateManagerInit(unittest.TestCase):
    """TemplateManager 初始化测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_init_loads_builtin(self):
        """初始化时自动加载 6 个内置模板"""
        mgr = TemplateManager(storage_dir=self.tmp)
        stats = mgr.get_stats()
        self.assertEqual(stats["builtin_templates"], 6)
        self.assertGreaterEqual(stats["total_templates"], 6)

    def test_persistence_load(self):
        """持久化后重新加载"""
        mgr1 = TemplateManager(storage_dir=self.tmp)
        tpl = _make_sample_template(template_id="tpl_persist_001")
        mgr1.register_template(tpl)

        mgr2 = TemplateManager(storage_dir=self.tmp)
        loaded = mgr2.get_template("tpl_persist_001")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.name, tpl.name)

    def test_idempotent_builtin(self):
        """多次初始化不会重复安装内置模板"""
        mgr1 = TemplateManager(storage_dir=self.tmp)
        count1 = mgr1.get_stats()["total_templates"]
        mgr2 = TemplateManager(storage_dir=self.tmp)
        count2 = mgr2.get_stats()["total_templates"]
        self.assertEqual(count1, count2)


# ============================================================
# 模板管理 - CRUD
# ============================================================
class TestTemplateCRUD(unittest.TestCase):
    """模板 CRUD 测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_register_custom(self):
        """注册自定义模板"""
        tpl = _make_sample_template(template_id="tpl_custom_001")
        saved = self.mgr.register_template(tpl)
        self.assertEqual(saved.template_id, "tpl_custom_001")
        self.assertEqual(saved.version, 1)
        self.assertIn("tpl_custom_001", self.mgr._templates)

    def test_register_invalid_name(self):
        """注册时名称非法"""
        tpl = _make_sample_template(template_id="tpl_bad", name="bad\x00name")
        with self.assertRaises(ValueError):
            self.mgr.register_template(tpl)

    def test_register_empty_acs(self):
        """注册时 AC 列表为空"""
        tpl = _make_sample_template(template_id="tpl_empty")
        tpl.acceptance_criteria = []
        with self.assertRaises(ValueError):
            self.mgr.register_template(tpl)

    def test_register_invalid_category(self):
        """注册时 category 非法"""
        tpl = _make_sample_template(template_id="tpl_bad_cat", category="invalid")
        with self.assertRaises(ValueError):
            self.mgr.register_template(tpl)

    def test_update_increments_version(self):
        """更新模板递增版本号"""
        tpl = _make_sample_template(template_id="tpl_update_001")
        self.mgr.register_template(tpl)
        # 再次注册同 ID
        tpl.description = "Updated"
        updated = self.mgr.register_template(tpl)
        self.assertEqual(updated.version, 2)
        self.assertEqual(updated.description, "Updated")

    def test_unregister_custom(self):
        """注销自定义模板"""
        tpl = _make_sample_template(template_id="tpl_del_001")
        self.mgr.register_template(tpl)
        ok = self.mgr.unregister_template("tpl_del_001")
        self.assertTrue(ok)
        self.assertIsNone(self.mgr.get_template("tpl_del_001"))

    def test_unregister_builtin_fails(self):
        """注销内置模板失败"""
        ok = self.mgr.unregister_template("tpl_builtin_feature_dev")
        self.assertFalse(ok)

    def test_unregister_nonexistent(self):
        """注销不存在的模板"""
        ok = self.mgr.unregister_template("tpl_nonexistent")
        self.assertFalse(ok)

    def test_modify_builtin_fails(self):
        """修改内置模板失败（不能改为 custom 源）"""
        original = self.mgr.get_template("tpl_builtin_feature_dev")
        self.assertIsNotNone(original)
        # 复制一份并尝试修改为 custom 源（不能影响原对象）
        tpl = copy.deepcopy(original)
        tpl.source = TemplateSource.CUSTOM.value
        tpl.description = "Hacked"
        with self.assertRaises(ValueError):
            self.mgr.register_template(tpl)
        # 验证原始内置模板未被污染
        self.assertEqual(original.source, TemplateSource.BUILTIN.value)
        self.assertNotEqual(original.description, "Hacked")


# ============================================================
# 模板管理 - Fork
# ============================================================
class TestTemplateFork(unittest.TestCase):
    """Fork 模板测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_fork_builtin(self):
        """Fork 内置模板"""
        forked = self.mgr.fork_template("tpl_builtin_feature_dev")
        self.assertIsNotNone(forked)
        self.assertNotEqual(forked.template_id, "tpl_builtin_feature_dev")
        self.assertEqual(forked.source, TemplateSource.CUSTOM.value)
        self.assertIn("forked", forked.tags)
        self.assertTrue(forked.name.endswith("(Copy)"))

    def test_fork_with_custom_name(self):
        """Fork 时自定义名称"""
        forked = self.mgr.fork_template(
            "tpl_builtin_feature_dev",
            new_name="我的功能开发",
        )
        self.assertEqual(forked.name, "我的功能开发")

    def test_fork_with_custom_tags(self):
        """Fork 时自定义标签"""
        forked = self.mgr.fork_template(
            "tpl_builtin_feature_dev",
            new_tags=["myproject", "v1"],
        )
        self.assertIn("myproject", forked.tags)
        self.assertIn("v1", forked.tags)
        self.assertIn("forked", forked.tags)  # 自动加上 forked

    def test_fork_nonexistent(self):
        """Fork 不存在的模板"""
        forked = self.mgr.fork_template("tpl_nonexistent")
        self.assertIsNone(forked)

    def test_forked_can_be_modified(self):
        """Fork 后的模板可修改"""
        forked = self.mgr.fork_template("tpl_builtin_feature_dev")
        saved = self.mgr.register_template(forked)
        saved.description = "Modified"
        updated = self.mgr.register_template(saved)
        self.assertEqual(updated.description, "Modified")
        self.assertEqual(updated.version, 2)


# ============================================================
# 模板管理 - 实例化
# ============================================================
class TestTemplateInstantiate(unittest.TestCase):
    """实例化模板测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_instantiate_builtin(self):
        """实例化内置模板"""
        result = self.mgr.instantiate("tpl_builtin_feature_dev")
        self.assertIsNotNone(result)
        tpl, inst, config = result
        self.assertEqual(tpl.template_id, "tpl_builtin_feature_dev")
        self.assertEqual(inst.ac_count, 5)
        self.assertIn("goal_", config["goal_id"])
        self.assertEqual(len(config["acceptance_criteria"]), 5)
        self.assertEqual(config["turn_config"]["strategy"], "standard")
        self.assertEqual(config["recommended_agents"][0], "architect")

    def test_instantiate_increments_count(self):
        """实例化次数累加"""
        self.mgr.instantiate("tpl_builtin_feature_dev")
        self.mgr.instantiate("tpl_builtin_feature_dev")
        tpl = self.mgr.get_template("tpl_builtin_feature_dev")
        self.assertEqual(tpl.instantiations, 2)

    def test_instantiate_with_custom_goal_id(self):
        """实例化时使用自定义 goal_id"""
        result = self.mgr.instantiate(
            "tpl_builtin_feature_dev",
            goal_id="my_custom_goal",
        )
        tpl, inst, config = result
        self.assertEqual(config["goal_id"], "my_custom_goal")
        self.assertEqual(inst.goal_id, "my_custom_goal")

    def test_instantiate_nonexistent(self):
        """实例化不存在的模板"""
        result = self.mgr.instantiate("tpl_nonexistent")
        self.assertIsNone(result)

    def test_instantiate_updates_last_used(self):
        """实例化时更新 last_used_at"""
        before = self.mgr.get_template("tpl_builtin_feature_dev").last_used_at
        time.sleep(0.01)
        self.mgr.instantiate("tpl_builtin_feature_dev")
        after = self.mgr.get_template("tpl_builtin_feature_dev").last_used_at
        self.assertNotEqual(before, after)
        self.assertIsNotNone(after)

    def test_instantiation_history(self):
        """实例化历史记录"""
        self.mgr.instantiate("tpl_builtin_feature_dev", goal_id="g1")
        self.mgr.instantiate("tpl_builtin_feature_dev", goal_id="g2")
        self.mgr.instantiate("tpl_builtin_bug_fix", goal_id="g3")
        history = self.mgr.get_instantiation_history()
        self.assertEqual(len(history), 3)
        # 倒序
        self.assertEqual(history[0].goal_id, "g3")

    def test_instantiation_history_filter(self):
        """按 template_id 过滤实例化历史"""
        self.mgr.instantiate("tpl_builtin_feature_dev", goal_id="g1")
        self.mgr.instantiate("tpl_builtin_bug_fix", goal_id="g2")
        history = self.mgr.get_instantiation_history(template_id="tpl_builtin_feature_dev")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].goal_id, "g1")


# ============================================================
# 模板管理 - 列表过滤
# ============================================================
class TestTemplateListFilter(unittest.TestCase):
    """列表过滤测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_list_by_category(self):
        """按类别过滤"""
        results = self.mgr.list_templates(category=TemplateCategory.DEVELOPMENT.value)
        # 内置有 2 个 development 模板
        self.assertEqual(len(results), 2)

    def test_list_by_source(self):
        """按来源过滤"""
        builtin = self.mgr.list_templates(source=TemplateSource.BUILTIN.value)
        custom = self.mgr.list_templates(source=TemplateSource.CUSTOM.value)
        self.assertEqual(len(builtin), 6)
        self.assertEqual(len(custom), 0)

        # 添加自定义模板
        self.mgr.register_template(_make_sample_template(template_id="tpl_custom"))
        custom = self.mgr.list_templates(source=TemplateSource.CUSTOM.value)
        self.assertEqual(len(custom), 1)

    def test_list_by_tag(self):
        """按标签过滤"""
        results = self.mgr.list_templates(tag="bug")
        # tpl_builtin_bug_fix 有 "bug" 标签
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].template_id, "tpl_builtin_bug_fix")

    def test_list_by_keyword(self):
        """按关键词搜索"""
        results = self.mgr.list_templates(keyword="重构")
        self.assertGreater(len(results), 0)
        self.assertIn("重构", results[0].name)

    def test_list_combined_filters(self):
        """组合过滤"""
        results = self.mgr.list_templates(
            category=TemplateCategory.DEVELOPMENT.value,
            source=TemplateSource.BUILTIN.value,
        )
        self.assertEqual(len(results), 2)

    def test_list_sorted_by_usage(self):
        """按使用次数排序"""
        # 实例化多次
        self.mgr.instantiate("tpl_builtin_bug_fix")
        self.mgr.instantiate("tpl_builtin_bug_fix")
        self.mgr.instantiate("tpl_builtin_feature_dev")

        results = self.mgr.list_templates()
        # bug_fix 应排在最前（2次 > 1次）
        self.assertEqual(results[0].template_id, "tpl_builtin_bug_fix")


# ============================================================
# 模板管理 - 导入导出
# ============================================================
class TestTemplateImportExport(unittest.TestCase):
    """导入导出测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_export(self):
        """导出模板"""
        data = self.mgr.export_template("tpl_builtin_feature_dev")
        self.assertIsNotNone(data)
        self.assertEqual(data["name"], "功能开发模板")
        self.assertEqual(data["source"], "builtin")
        self.assertIn("acceptance_criteria", data)

    def test_export_nonexistent(self):
        """导出不存在的模板"""
        data = self.mgr.export_template("tpl_nonexistent")
        self.assertIsNone(data)

    def test_import(self):
        """导入模板"""
        data = self.mgr.export_template("tpl_builtin_feature_dev")
        data["name"] = "Imported Template"
        imported = self.mgr.import_template(data)
        self.assertNotEqual(imported.template_id, "tpl_builtin_feature_dev")
        self.assertEqual(imported.source, "custom")
        self.assertEqual(imported.name, "Imported Template")
        self.assertTrue(imported.template_id.startswith("tpl_imported_"))

    def test_import_with_custom_id(self):
        """导入时使用自定义 ID"""
        data = self.mgr.export_template("tpl_builtin_feature_dev")
        imported = self.mgr.import_template(data, new_template_id="tpl_my_custom_001")
        self.assertEqual(imported.template_id, "tpl_my_custom_001")


# ============================================================
# 统计与健康检查
# ============================================================
class TestTemplateStats(unittest.TestCase):
    """统计测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_stats_initial(self):
        """初始统计"""
        stats = self.mgr.get_stats()
        self.assertEqual(stats["total_templates"], 6)
        self.assertEqual(stats["builtin_templates"], 6)
        self.assertEqual(stats["custom_templates"], 0)
        self.assertEqual(stats["total_instantiations"], 0)
        self.assertIn("by_category", stats)
        self.assertIn("categories", stats)
        self.assertIn("sources", stats)

    def test_stats_after_register(self):
        """注册后统计"""
        self.mgr.register_template(_make_sample_template(template_id="tpl_c1"))
        stats = self.mgr.get_stats()
        self.assertEqual(stats["custom_templates"], 1)

    def test_stats_after_instantiate(self):
        """实例化后统计"""
        self.mgr.instantiate("tpl_builtin_feature_dev")
        self.mgr.instantiate("tpl_builtin_bug_fix")
        self.mgr.instantiate("tpl_builtin_bug_fix")
        stats = self.mgr.get_stats()
        self.assertEqual(stats["total_instantiations"], 3)
        self.assertEqual(len(stats["most_used"]), 2)
        self.assertEqual(stats["most_used"][0]["template_id"], "tpl_builtin_bug_fix")

    def test_health_check(self):
        """健康检查"""
        health = self.mgr.health_check()
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["builtin_loaded"], 6)
        self.assertIn("storage_dir", health)


# ============================================================
# 全局单例
# ============================================================
class TestGlobalSingleton(unittest.TestCase):
    """全局单例测试"""

    def setUp(self):
        reset_manager()
        self.tmp = _make_temp_dir()

    def tearDown(self):
        reset_manager()
        _cleanup_dir(self.tmp)

    def test_get_manager_singleton(self):
        mgr1 = get_manager(storage_dir=self.tmp)
        mgr2 = get_manager()
        self.assertIs(mgr1, mgr2)

    def test_reset_manager(self):
        mgr1 = get_manager(storage_dir=self.tmp)
        reset_manager()
        mgr2 = get_manager(storage_dir=self.tmp)
        self.assertIsNot(mgr1, mgr2)


# ============================================================
# API 路由
# ============================================================
class TestAPIRoutes(unittest.TestCase):
    """API 路由测试"""

    def test_router_imports(self):
        """测试路由可导入"""
        from app.api.goal_templates import router
        self.assertIsNotNone(router)

    def test_router_routes_count(self):
        """测试路由数量"""
        from app.api.goal_templates import router
        # 至少 14 个端点
        self.assertGreaterEqual(len(router.routes), 14)

    def test_router_prefix(self):
        """测试路由前缀"""
        from app.api.goal_templates import router
        self.assertEqual(router.prefix, "/goal-templates")


# ============================================================
# 集成测试
# ============================================================
class TestIntegration(unittest.TestCase):
    """集成测试"""

    def setUp(self):
        self.tmp = _make_temp_dir()
        self.mgr = TemplateManager(storage_dir=self.tmp)

    def tearDown(self):
        _cleanup_dir(self.tmp)

    def test_full_workflow(self):
        """完整工作流：浏览 → fork → 修改 → 实例化 → 统计"""
        # 1. 浏览内置模板
        all_templates = self.mgr.list_templates()
        self.assertEqual(len(all_templates), 6)

        # 2. Fork 一个内置模板
        forked = self.mgr.fork_template("tpl_builtin_feature_dev", new_name="我的项目-功能开发")
        saved = self.mgr.register_template(forked)

        # 3. 修改 fork 后的模板
        saved.description = "针对我项目的功能开发流程"
        saved.tags = ["myproject", "feature"]
        updated = self.mgr.register_template(saved)
        self.assertEqual(updated.version, 2)

        # 4. 实例化
        result = self.mgr.instantiate(updated.template_id, goal_id="goal_my_proj_001")
        tpl, inst, config = result
        self.assertEqual(config["title"], "我的项目-功能开发")
        self.assertIn("myproject", config["tags"])
        self.assertEqual(config["goal_id"], "goal_my_proj_001")

        # 5. 验证统计
        stats = self.mgr.get_stats()
        self.assertEqual(stats["total_instantiations"], 1)
        self.assertEqual(len(stats["most_used"]), 1)

    def test_concurrent_operations(self):
        """并发操作"""
        results = []
        errors = []

        def worker(i):
            try:
                tpl = _make_sample_template(
                    template_id=f"tpl_concurrent_{i}",
                    name=f"Concurrent {i}",
                )
                self.mgr.register_template(tpl)
                self.mgr.instantiate(tpl.template_id)
                results.append(i)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(results), 10)
        self.assertEqual(len(errors), 0)
        stats = self.mgr.get_stats()
        self.assertEqual(stats["custom_templates"], 10)
        self.assertEqual(stats["total_instantiations"], 10)


if __name__ == "__main__":
    unittest.main()
