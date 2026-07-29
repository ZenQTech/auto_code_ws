#!/usr/bin/env python3
"""
# ============================================================
# Hermes Plugin Marketplace - 单元测试
# ============================================================
# 核心作用：测试 Plugin Marketplace 核心功能
# 覆盖：
#   - 数据模型（PluginVersion/MarketplacePlugin/Rating）
#   - 评分系统（RatingStore）
#   - Marketplace 核心（CRUD/搜索/分类/统计）
#   - 签名验证
#   - Mock 数据注入
# Cycle 13 P1-1 新建
# ============================================================
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from app.core.plugins import (
    PluginMarketplace,
    PluginVersion,
    MarketplacePlugin,
    Rating,
    RatingStore,
    get_marketplace,
    reset_marketplace,
    is_marketplace_path_allowed,
)


# ============================================================
# 数据模型测试
# ============================================================
class TestPluginVersion(unittest.TestCase):
    """PluginVersion 测试"""

    def test_to_from_dict(self):
        v = PluginVersion(
            version="1.0.0",
            released_at="2026-07-28T00:00:00Z",
            changelog="Initial",
            size_kb=128,
        )
        d = v.to_dict()
        self.assertEqual(d["version"], "1.0.0")
        self.assertEqual(d["size_kb"], 128)
        v2 = PluginVersion.from_dict(d)
        self.assertEqual(v2.version, "1.0.0")
        self.assertEqual(v2.size_kb, 128)


class TestMarketplacePlugin(unittest.TestCase):
    """MarketplacePlugin 测试"""

    def test_default(self):
        p = MarketplacePlugin(
            id="test.plugin",
            name="Test",
            description="Desc",
            author="Author",
        )
        self.assertEqual(p.id, "test.plugin")
        self.assertEqual(p.rating_count, 0)
        self.assertEqual(p.total_downloads, 0)
        self.assertEqual(p.avg_rating, 0.0)

    def test_avg_rating(self):
        p = MarketplacePlugin(
            id="x", name="x", description="x", author="x",
            rating_sum=12, rating_count=3,
        )
        self.assertEqual(p.avg_rating, 4.0)

    def test_to_from_dict(self):
        p = MarketplacePlugin(
            id="test.plugin",
            name="Test",
            description="Desc",
            author="Author",
            versions=[PluginVersion(version="1.0.0", released_at="2026-01-01")],
            latest_version="1.0.0",
        )
        d = p.to_dict()
        self.assertIn("avg_rating", d)
        p2 = MarketplacePlugin.from_dict(d)
        self.assertEqual(p2.id, "test.plugin")
        self.assertEqual(len(p2.versions), 1)


class TestRating(unittest.TestCase):
    """Rating 测试"""

    def test_to_from_dict(self):
        r = Rating(plugin_id="p1", user="u1", score=5, comment="Great!")
        d = r.to_dict()
        self.assertEqual(d["score"], 5)
        r2 = Rating.from_dict(d)
        self.assertEqual(r2.user, "u1")
        self.assertEqual(r2.comment, "Great!")


# ============================================================
# RatingStore 测试
# ============================================================
class TestRatingStore(unittest.TestCase):
    """RatingStore 测试"""

    def setUp(self):
        self.store = RatingStore()

    def test_add_and_list(self):
        r = Rating(plugin_id="p1", user="u1", score=5)
        self.store.add(r)
        self.assertEqual(len(self.store.list_for_plugin("p1")), 1)

    def test_user_can_only_rate_once(self):
        self.store.add(Rating(plugin_id="p1", user="u1", score=5))
        self.store.add(Rating(plugin_id="p1", user="u1", score=3))
        ratings = self.store.list_for_plugin("p1")
        # 用户只能有一条评分
        self.assertEqual(len(ratings), 1)
        self.assertEqual(ratings[0].score, 3)  # 被更新

    def test_stats(self):
        self.store.add(Rating(plugin_id="p1", user="u1", score=5))
        self.store.add(Rating(plugin_id="p1", user="u2", score=3))
        self.store.add(Rating(plugin_id="p2", user="u3", score=4))
        stats = self.store.get_stats()
        self.assertEqual(stats["total_ratings"], 3)
        self.assertEqual(stats["plugins_with_ratings"], 2)


# ============================================================
# 路径白名单测试
# ============================================================
class TestPathWhitelist(unittest.TestCase):

    def test_allowed(self):
        self.assertTrue(is_marketplace_path_allowed("/home/qizheng/auto_code_data/x"))
        self.assertTrue(is_marketplace_path_allowed("/tmp/marketplace_test"))

    def test_disallowed(self):
        self.assertFalse(is_marketplace_path_allowed("/etc/passwd"))
        self.assertFalse(is_marketplace_path_allowed("/root/.ssh"))


# ============================================================
# Marketplace 核心测试
# ============================================================
class TestPluginMarketplace(unittest.TestCase):
    """PluginMarketplace 核心测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="marketplace_test_")
        self.market = PluginMarketplace(store_dir=self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_initialization(self):
        # 应该有 mock 数据
        self.assertGreater(len(self.market.list()), 0)

    def test_publish_and_get(self):
        plugin = MarketplacePlugin(
            id="test.custom",
            name="Custom",
            description="Custom plugin",
            author="Tester",
        )
        version = PluginVersion(version="1.0.0", released_at="2026-07-28")
        plugin.versions = [version]
        plugin.latest_version = "1.0.0"
        self.market.publish(plugin)
        p = self.market.get("test.custom")
        self.assertIsNotNone(p)
        self.assertEqual(p.name, "Custom")

    def test_unpublish(self):
        plugin = MarketplacePlugin(
            id="test.unpublish",
            name="Unpublish",
            description="x",
            author="x",
            versions=[PluginVersion(version="1.0.0", released_at="2026-07-28")],
            latest_version="1.0.0",
        )
        self.market.publish(plugin)
        self.assertTrue(self.market.unpublish("test.unpublish"))
        self.assertIsNone(self.market.get("test.unpublish"))

    def test_list_by_source(self):
        official = self.market.list(source="official")
        self.assertGreater(len(official), 0)
        for p in official:
            self.assertEqual(p.source, "official")

    def test_list_by_category(self):
        results = self.market.list(category="security")
        self.assertGreater(len(results), 0)
        for p in results:
            self.assertIn("security", p.categories)

    def test_list_verified_only(self):
        results = self.market.list(verified_only=True)
        for p in results:
            self.assertTrue(p.verified)

    def test_search(self):
        results = self.market.search("security")
        self.assertGreater(len(results), 0)

    def test_search_no_match(self):
        results = self.market.search("zzz_no_match_xyz")
        self.assertEqual(len(results), 0)

    def test_categories(self):
        cats = self.market.categories()
        self.assertGreater(len(cats), 0)

    def test_get_versions(self):
        versions = self.market.get_versions("hermes.code-formatter")
        self.assertGreater(len(versions), 0)
        for v in versions:
            self.assertIsInstance(v, PluginVersion)

    def test_get_latest_version(self):
        v = self.market.get_latest_version("hermes.code-formatter")
        self.assertIsNotNone(v)
        self.assertIsInstance(v, PluginVersion)

    def test_rate(self):
        r = self.market.rate("hermes.code-formatter", "test_user", 5, "Excellent!")
        self.assertEqual(r.score, 5)
        ratings = self.market.get_ratings("hermes.code-formatter")
        self.assertGreater(len(ratings), 0)

    def test_rate_invalid_score(self):
        with self.assertRaises(ValueError):
            self.market.rate("hermes.code-formatter", "u1", 6)
        with self.assertRaises(ValueError):
            self.market.rate("hermes.code-formatter", "u1", 0)

    def test_rate_nonexistent_plugin(self):
        with self.assertRaises(KeyError):
            self.market.rate("nonexistent_xyz", "u1", 5)

    def test_record_install(self):
        before = self.market.get("hermes.code-formatter").total_downloads
        self.market.record_install("hermes.code-formatter")
        after = self.market.get("hermes.code-formatter").total_downloads
        self.assertEqual(after, before + 1)

    def test_get_stats(self):
        stats = self.market.get_stats()
        self.assertIn("total_plugins", stats)
        self.assertIn("by_source", stats)
        self.assertIn("categories", stats)
        self.assertGreater(stats["total_plugins"], 0)

    def test_signature_round_trip(self):
        sig = self.market.sign("hermes.code-formatter", "2.1.0")
        self.assertTrue(self.market.verify_signature("hermes.code-formatter", "2.1.0", sig))

    def test_signature_mismatch(self):
        # 错误签名应返回 False
        result = self.market.verify_signature("hermes.code-formatter", "2.1.0", "wrong-sig")
        self.assertFalse(result)


class TestMarketplacePersistence(unittest.TestCase):
    """Marketplace 持久化测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="marketplace_persist_")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_persistence(self):
        m1 = PluginMarketplace(store_dir=self.tmpdir)
        # 添加自定义 Plugin
        plugin = MarketplacePlugin(
            id="test.persist",
            name="Persist",
            description="x",
            author="x",
            versions=[PluginVersion(version="1.0.0", released_at="2026-07-28")],
            latest_version="1.0.0",
        )
        m1.publish(plugin)
        # 重新加载
        m2 = PluginMarketplace(store_dir=self.tmpdir)
        loaded = m2.get("test.persist")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.name, "Persist")


if __name__ == "__main__":
    unittest.main(verbosity=2)
