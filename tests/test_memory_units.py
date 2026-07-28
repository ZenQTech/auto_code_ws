"""
# P1-8 Memory System 单元测试
# Cycle 10 P1-8 Dual-Track Persistent Memory
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = "/home/qizheng/auto_code_ws"
sys.path.insert(0, WORKSPACE)

from backend.app.services.memory import (  # noqa: E402
    MCPMemoryStore,
    MemoryEntity,
    MemoryRelation,
    MemoryObservation,
    EntityType,
    RelationType,
    ObservationSource,
    NAME_PATTERN,
    OBSERVATION_DATE_PATTERN,
    _validate_name,
    _validate_observation,
    _check_secrets,
)


class TestConstants(unittest.TestCase):
    """测试常量与正则"""

    def test_name_pattern_valid(self):
        valid_names = [
            "project_hermes",
            "pattern_port_conflict",
            "preference_typescript",
            "abc",
            "a1b2c3",
        ]
        for name in valid_names:
            self.assertTrue(NAME_PATTERN.match(name), f"{name} should be valid")

    def test_name_pattern_invalid(self):
        invalid_names = [
            "Project_Hermes",  # 大写
            "1project",  # 数字开头
            "ab",  # 太短
            "a" * 129,  # 太长
            "project-hermes",  # 包含 -
            "project hermes",  # 包含空格
            "project/hermes",  # 包含 /
            "",  # 空
        ]
        for name in invalid_names:
            self.assertFalse(NAME_PATTERN.match(name), f"{name} should be invalid")

    def test_observation_date_pattern(self):
        valid = ["[2026-07-28] 使用 FastAPI", "[2025-01-01] test", "[2024-12-31] x"]
        for v in valid:
            self.assertTrue(OBSERVATION_DATE_PATTERN.match(v))
        invalid = [
            "2026-07-28 missing brackets",
            "[2026/07/28] wrong separator",
            "[28-07-2026] wrong order",
            "no date",
        ]
        for v in invalid:
            self.assertFalse(OBSERVATION_DATE_PATTERN.match(v))


class TestValidation(unittest.TestCase):
    """测试校验函数"""

    def test_validate_name(self):
        valid, _ = _validate_name("project_hermes")
        self.assertTrue(valid)
        valid, err = _validate_name("Project")
        self.assertFalse(valid)
        self.assertIn("must match", err)

    def test_validate_observation(self):
        valid, _ = _validate_observation("[2026-07-28] 测试内容")
        self.assertTrue(valid)
        valid, err = _validate_observation("no date format")
        self.assertFalse(valid)
        self.assertIn("must start with", err)
        valid, err = _validate_observation("[2026-07-28] " + "x" * 600)
        self.assertFalse(valid)
        self.assertIn("too long", err)

    def test_check_secrets(self):
        # OpenAI API key
        ok, err = _check_secrets("api_key: sk-abcdefghijklmnopqrstuvwxyz")
        self.assertFalse(ok)
        self.assertIn("secret", err.lower())

        # GitHub PAT
        ok, err = _check_secrets("token=ghp_abcdefghijklmnopqrstuvwxyz12345")
        self.assertFalse(ok)

        # AWS key
        ok, err = _check_secrets("AKIAIOSFODNN7EXAMPLE")
        self.assertFalse(ok)

        # 正常内容
        ok, _ = _check_secrets("[2026-07-28] 使用 FastAPI 框架")
        self.assertTrue(ok)


class TestDataClasses(unittest.TestCase):
    """测试数据类"""

    def test_memory_entity(self):
        entity = MemoryEntity(
            name="project_hermes",
            entity_type="project",
            project="hermes",
        )
        d = entity.to_dict()
        self.assertEqual(d["name"], "project_hermes")
        self.assertEqual(d["entity_type"], "project")
        self.assertEqual(d["project"], "hermes")
        self.assertIn("created_at", d)
        self.assertIn("updated_at", d)

    def test_memory_relation(self):
        rel = MemoryRelation(
            id="",
            source="project_hermes",
            target="pattern_fastapi",
            relation_type="uses",
        )
        self.assertTrue(rel.id.startswith("rel_"))
        d = rel.to_dict()
        self.assertEqual(d["source"], "project_hermes")
        self.assertEqual(d["target"], "pattern_fastapi")

    def test_memory_observation(self):
        obs = MemoryObservation(
            id="",
            entity_name="project_hermes",
            content="[2026-07-28] test",
        )
        self.assertTrue(obs.id.startswith("obs_"))


class TestMCPMemoryStore(unittest.TestCase):
    """测试 MCP Memory Store"""

    def setUp(self):
        # 创建临时目录
        self.tmpdir = tempfile.mkdtemp()
        self.store = MCPMemoryStore(memory_dir=Path(self.tmpdir))

    def tearDown(self):
        # 清理临时目录
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_creates_files(self):
        """测试初始化创建 JSONL 文件"""
        # 创建实体后文件应存在
        entity = MemoryEntity(
            name="project_hermes",
            entity_type="project",
        )
        self.store.create_entity(entity)
        self.assertTrue((Path(self.tmpdir) / "entities.jsonl").exists())

    def test_create_and_get_entity(self):
        """测试创建和查询实体"""
        entity = MemoryEntity(
            name="project_hermes",
            entity_type="project",
            project="hermes",
        )
        success, err = self.store.create_entity(entity)
        self.assertTrue(success, err)
        self.assertEqual(err, "")

        retrieved = self.store.get_entity("project_hermes")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.entity_type, "project")
        self.assertEqual(retrieved.project, "hermes")

    def test_create_duplicate_entity_fails(self):
        """测试重复创建返回错误"""
        entity = MemoryEntity(name="project_hermes", entity_type="project")
        self.store.create_entity(entity)
        success, err = self.store.create_entity(entity)
        self.assertFalse(success)
        self.assertIn("already exists", err)

    def test_create_invalid_name_fails(self):
        """测试非法命名拒绝"""
        entity = MemoryEntity(name="Project-Bad", entity_type="project")
        success, err = self.store.create_entity(entity)
        self.assertFalse(success)
        self.assertIn("must match", err)

    def test_create_invalid_entity_type_fails(self):
        """测试非法 entity_type 拒绝"""
        entity = MemoryEntity(name="project_hermes", entity_type="invalid")
        success, err = self.store.create_entity(entity)
        self.assertFalse(success)
        self.assertIn("invalid entity_type", err)

    def test_list_entities_by_type(self):
        """测试按类型列出"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="pat_one", entity_type="pattern"))
        self.store.create_entity(MemoryEntity(name="pat_two", entity_type="pattern"))

        projects = self.store.list_entities(entity_type="project")
        self.assertEqual(len(projects), 1)
        patterns = self.store.list_entities(entity_type="pattern")
        self.assertEqual(len(patterns), 2)

    def test_list_entities_by_project(self):
        """测试按项目列出"""
        self.store.create_entity(MemoryEntity(name="proj_alpha", entity_type="project", project="proj_a"))
        self.store.create_entity(MemoryEntity(name="proj_beta", entity_type="project", project="proj_b"))
        self.store.create_entity(MemoryEntity(name="proj_gamma", entity_type="project", project="proj_a"))

        proj_a = self.store.list_entities(project="proj_a")
        self.assertEqual(len(proj_a), 2)

    def test_update_entity(self):
        """测试更新实体"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        success, err = self.store.update_entity(
            "proj_one",
            entity_type="pattern",
            metadata={"key": "value"},
        )
        self.assertTrue(success, err)
        updated = self.store.get_entity("proj_one")
        self.assertEqual(updated.entity_type, "pattern")
        self.assertEqual(updated.metadata["key"], "value")

    def test_update_nonexistent_entity(self):
        """测试更新不存在实体"""
        success, err = self.store.update_entity("nonexistent_entity", entity_type="pattern")
        self.assertFalse(success)
        self.assertIn("not found", err)

    def test_delete_entity(self):
        """测试删除实体"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        success, err = self.store.delete_entity("proj_one")
        self.assertTrue(success, err)
        self.assertIsNone(self.store.get_entity("proj_one"))

    def test_delete_nonexistent_entity(self):
        """测试删除不存在实体"""
        success, err = self.store.delete_entity("nonexistent_entity")
        self.assertFalse(success)
        self.assertIn("not found", err)

    def test_delete_public_protected_entity(self):
        """测试 public_ 前缀保护"""
        self.store.create_entity(MemoryEntity(name="public_global_rules", entity_type="fact"))
        success, err = self.store.delete_entity("public_global_rules", force=False)
        self.assertFalse(success)
        self.assertIn("public-protected", err)
        # force=True 可删除
        success, err = self.store.delete_entity("public_global_rules", force=True)
        self.assertTrue(success, err)

    def test_create_relation(self):
        """测试创建关系"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        success, err, rel = self.store.create_relation("ent_alpha", "ent_beta", "uses")
        self.assertTrue(success, err)
        self.assertIsNotNone(rel)
        self.assertEqual(rel.source, "ent_alpha")
        self.assertEqual(rel.target, "ent_beta")

    def test_create_relation_nonexistent_source(self):
        """测试关系源不存在"""
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        success, err, _ = self.store.create_relation("nonexistent_source", "ent_beta", "uses")
        self.assertFalse(success)
        self.assertIn("not found", err)

    def test_create_relation_invalid_type(self):
        """测试非法关系类型"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        success, err, _ = self.store.create_relation("ent_alpha", "ent_beta", "invalid_type")
        self.assertFalse(success)
        self.assertIn("invalid relation_type", err)

    def test_list_relations(self):
        """测试列出关系"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        self.store.create_entity(MemoryEntity(name="ent_gamma", entity_type="fact"))
        self.store.create_relation("ent_alpha", "ent_beta", "uses")
        self.store.create_relation("ent_alpha", "ent_gamma", "depends_on")
        self.store.create_relation("ent_beta", "ent_gamma", "related_to")

        all_rels = self.store.list_relations()
        self.assertEqual(len(all_rels), 3)

        a_rels = self.store.list_relations(source="ent_alpha")
        self.assertEqual(len(a_rels), 2)

        c_rels = self.store.list_relations(target="ent_gamma")
        self.assertEqual(len(c_rels), 2)

    def test_delete_relation(self):
        """测试删除关系"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        _, _, rel = self.store.create_relation("ent_alpha", "ent_beta", "uses")
        success, err = self.store.delete_relation(rel.id)
        self.assertTrue(success, err)
        self.assertEqual(len(self.store.list_relations()), 0)

    def test_add_observation(self):
        """测试添加观察"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        success, err, obs = self.store.add_observation(
            "proj_one", "[2026-07-28] 使用 FastAPI 框架"
        )
        self.assertTrue(success, err)
        self.assertIsNotNone(obs)

    def test_add_observation_nonexistent_entity(self):
        """测试给不存在实体添加观察"""
        success, err, _ = self.store.add_observation("nonexistent_entity", "[2026-07-28] test")
        self.assertFalse(success)
        self.assertIn("not found", err)

    def test_add_observation_invalid_format(self):
        """测试观察格式错误"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        success, err, _ = self.store.add_observation("proj_one", "no date format")
        self.assertFalse(success)
        self.assertIn("must start with", err)

    def test_add_observation_with_secrets_rejected(self):
        """测试观察包含 secrets 被拒绝"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        success, err, _ = self.store.add_observation(
            "proj_one", "[2026-07-28] api_key: sk-abcdefghijklmnopqrstuvwxyz"
        )
        self.assertFalse(success)
        self.assertIn("secret", err.lower())

    def test_get_observations(self):
        """测试获取观察"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        self.store.add_observation("proj_one", "[2026-07-28] observation 1")
        self.store.add_observation("proj_one", "[2026-07-29] observation 2")

        obs = self.store.get_observations("proj_one")
        self.assertEqual(len(obs), 2)

    def test_delete_observation(self):
        """测试删除观察"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        _, _, obs = self.store.add_observation("proj_one", "[2026-07-28] test")
        success, err = self.store.delete_observation(obs.id)
        self.assertTrue(success, err)
        self.assertEqual(len(self.store.get_observations("proj_one")), 0)

    def test_search_by_name(self):
        """测试按名称搜索"""
        self.store.create_entity(MemoryEntity(name="project_hermes", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="project_claude", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="pattern_fastapi", entity_type="pattern"))

        results = self.store.search("hermes")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["entity"]["name"], "project_hermes")

    def test_search_by_observation_content(self):
        """测试按 observation 内容搜索"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        self.store.add_observation("proj_one", "[2026-07-28] 使用 FastAPI 框架开发")
        self.store.add_observation("proj_one", "[2026-07-29] 集成 SQLAlchemy 异步")

        results = self.store.search("FastAPI")
        self.assertEqual(len(results), 1)

        results = self.store.search("SQLAlchemy")
        self.assertEqual(len(results), 1)

    def test_search_empty_query(self):
        """测试空查询"""
        results = self.store.search("")
        self.assertEqual(results, [])

    def test_search_with_limit(self):
        """测试搜索 limit"""
        for i in range(5):
            self.store.create_entity(MemoryEntity(
                name=f"entity_{i}",
                entity_type="fact",
            ))
        results = self.store.search("entity", limit=3)
        self.assertEqual(len(results), 3)

    def test_get_graph(self):
        """测试获取图谱"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        self.store.create_relation("ent_alpha", "ent_beta", "uses")
        self.store.add_observation("ent_alpha", "[2026-07-28] test")

        graph = self.store.get_graph()
        self.assertEqual(len(graph["entities"]), 2)
        self.assertEqual(len(graph["relations"]), 1)
        self.assertEqual(len(graph["observations"]), 1)

    def test_get_stats(self):
        """测试统计信息"""
        self.store.create_entity(MemoryEntity(name="ent_alpha", entity_type="project"))
        self.store.create_entity(MemoryEntity(name="ent_beta", entity_type="pattern"))
        self.store.add_observation("ent_alpha", "[2026-07-28] test")
        self.store.create_relation("ent_alpha", "ent_beta", "uses")

        stats = self.store.get_stats()
        self.assertEqual(stats["total_entities"], 2)
        self.assertEqual(stats["total_relations"], 1)
        self.assertEqual(stats["total_observations"], 1)
        self.assertIn("by_type", stats)

    def test_persistence_across_instances(self):
        """测试跨实例持久化"""
        self.store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
        self.store.add_observation("proj_one", "[2026-07-28] persistent observation")
        self.store.create_relation("proj_one", "proj_one", "uses")

        # 创建新实例指向相同目录
        new_store = MCPMemoryStore(memory_dir=Path(self.tmpdir))
        self.assertIsNotNone(new_store.get_entity("proj_one"))
        self.assertEqual(len(new_store.get_observations("proj_one")), 1)
        self.assertEqual(len(new_store.list_relations()), 1)

    def test_concurrent_writes(self):
        """测试并发写入"""
        results = {"success": 0, "fail": 0}
        lock = threading.Lock()

        def worker(i):
            entity = MemoryEntity(name=f"concurrent_{i}", entity_type="fact")
            success, _ = self.store.create_entity(entity)
            with lock:
                if success:
                    results["success"] += 1
                else:
                    results["fail"] += 1

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 至少大部分应该成功（线程安全保证）
        self.assertGreaterEqual(results["success"], 15)
        self.assertEqual(len(self.store.list_entities()), results["success"])


class TestMemoryRouter(unittest.TestCase):
    """测试 Memory Router Step 0 逻辑（mock）"""

    def test_search_priority(self):
        """测试搜索优先级"""
        # 简化测试：验证搜索返回格式
        tmpdir = tempfile.mkdtemp()
        try:
            store = MCPMemoryStore(memory_dir=Path(tmpdir))
            store.create_entity(MemoryEntity(name="proj_one", entity_type="project"))
            store.add_observation("proj_one", "[2026-07-28] FastAPI async framework")

            results = store.search("FastAPI", limit=5)
            self.assertGreater(len(results), 0)
            self.assertIn("entity", results[0])
            self.assertIn("score", results[0])
            self.assertIn("observations", results[0])
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
