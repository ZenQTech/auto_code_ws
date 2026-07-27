"""
# ============================================================
# SubAgent Memory 单元测试（v1.0.0）
# ============================================================
# 覆盖：
#   - SubAgentContext dataclass 序列化
#   - SubAgentMemoryEntry 工厂
#   - InMemorySubAgentMemoryStore CRUD
#   - inherit_from_parent 深拷贝
#   - 并发安全（asyncio.Lock）
#   - 边界条件（不存在 ID / 空列表 / 清空后状态）
# ============================================================
"""

import asyncio
import unittest

from backend.app.services.subagent_memory import (
    InMemorySubAgentMemoryStore,
    SubAgentContext,
    SubAgentMemoryEntry,
    get_subagent_memory_store,
    make_memory_entry,
)


class TestSubAgentContextDataclass(unittest.TestCase):
    """SubAgentContext dataclass 序列化测试"""

    def test_to_dict_minimal(self):
        ctx = SubAgentContext(subagent_id="a1", name="A")
        d = ctx.to_dict()
        self.assertEqual(d["subagent_id"], "a1")
        self.assertEqual(d["name"], "A")
        self.assertEqual(d["parent_id"], None)
        self.assertEqual(d["skill_set"], [])
        self.assertEqual(d["isolated_messages_count"], 0)
        self.assertEqual(d["parent_context_size"], 0)
        self.assertTrue(d["isolated"])

    def test_to_dict_with_parent(self):
        ctx = SubAgentContext(
            subagent_id="c1", name="C", parent_id="p1",
            skill_set=["x", "y"], output_dir="/tmp/c",
        )
        d = ctx.to_dict()
        self.assertEqual(d["parent_id"], "p1")
        self.assertIn("x", d["skill_set"])
        self.assertEqual(d["output_dir"], "/tmp/c")


class TestMemoryEntryFactory(unittest.TestCase):
    """make_memory_entry 工厂测试"""

    def test_make_entry_basic(self):
        e = make_memory_entry("user", "hello", {"k": "v"})
        self.assertEqual(e.role, "user")
        self.assertEqual(e.content, "hello")
        self.assertEqual(e.metadata, {"k": "v"})
        self.assertGreater(e.timestamp, 0)
        self.assertGreater(len(e.entry_id), 0)

    def test_make_entry_default_metadata(self):
        e = make_memory_entry("assistant", "ok")
        self.assertEqual(e.metadata, {})

    def test_entry_to_dict_roundtrip(self):
        e = make_memory_entry("tool", "ls -la", {"tool_name": "Bash"})
        d = e.to_dict()
        self.assertEqual(d["role"], "tool")
        self.assertEqual(d["content"], "ls -la")
        self.assertEqual(d["metadata"]["tool_name"], "Bash")


class TestInMemoryStoreCRUD(unittest.IsolatedAsyncioTestCase):
    """InMemorySubAgentMemoryStore CRUD 测试"""

    async def test_create_and_get(self):
        store = InMemorySubAgentMemoryStore()
        ctx = SubAgentContext(subagent_id="x1", name="X")
        await store.create(ctx)
        got = await store.get("x1")
        self.assertIsNotNone(got)
        self.assertEqual(got.name, "X")

    async def test_get_nonexistent_returns_none(self):
        store = InMemorySubAgentMemoryStore()
        self.assertIsNone(await store.get("missing"))

    async def test_append_to_existing(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="y1", name="Y"))
        ok = await store.append("y1", make_memory_entry("user", "hi"))
        self.assertTrue(ok)
        msgs = await store.get_messages("y1")
        self.assertEqual(len(msgs), 1)

    async def test_append_to_nonexistent(self):
        store = InMemorySubAgentMemoryStore()
        ok = await store.append("ghost", make_memory_entry("user", "x"))
        self.assertFalse(ok)

    async def test_clear(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="z1", name="Z"))
        await store.append("z1", make_memory_entry("user", "1"))
        await store.append("z1", make_memory_entry("user", "2"))
        ok = await store.clear("z1")
        self.assertTrue(ok)
        self.assertEqual(len(await store.get_messages("z1")), 0)

    async def test_clear_nonexistent(self):
        store = InMemorySubAgentMemoryStore()
        self.assertFalse(await store.clear("ghost"))

    async def test_list_subagents(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="a", name="A"))
        await store.create(SubAgentContext(subagent_id="b", name="B"))
        items = await store.list_subagents()
        self.assertEqual(len(items), 2)
        ids = {c.subagent_id for c in items}
        self.assertSetEqual(ids, {"a", "b"})


class TestInheritance(unittest.IsolatedAsyncioTestCase):
    """inherit_from_parent 父→子记忆继承测试"""

    async def test_inherit_copies_parent_messages(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="p", name="Parent"))
        await store.append("p", make_memory_entry("user", "parent_msg_1"))
        await store.append("p", make_memory_entry("assistant", "parent_msg_2"))

        await store.create(SubAgentContext(subagent_id="c", name="Child", parent_id="p"))
        parent_msgs = await store.get_messages("p", include_parent=True)
        ok = await store.inherit_from_parent("c", "p", parent_msgs)
        self.assertTrue(ok)

        # 子节点查看完整消息（parent_snapshot + isolated）
        full = await store.get_messages("c", include_parent=True)
        self.assertEqual(len(full), 2)
        contents = {m.content for m in full}
        self.assertIn("parent_msg_1", contents)
        self.assertIn("parent_msg_2", contents)

        # isolated_only 应为空（子尚未追加）
        isolated = await store.get_messages("c", include_parent=False)
        self.assertEqual(len(isolated), 0)

    async def test_inherit_deep_copies(self):
        """继承后修改子消息不应影响父"""
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="p2", name="P2"))
        await store.append("p2", make_memory_entry("user", "shared"))

        await store.create(SubAgentContext(subagent_id="c2", name="C2", parent_id="p2"))
        parent_msgs = await store.get_messages("p2", include_parent=True)
        await store.inherit_from_parent("c2", "p2", parent_msgs)

        # 子追加消息
        await store.append("c2", make_memory_entry("user", "child_only"))

        # 父应仍只有 1 条
        p_msgs = await store.get_messages("p2", include_parent=True)
        self.assertEqual(len(p_msgs), 1)

        # 子应有 2 条
        c_msgs = await store.get_messages("c2", include_parent=True)
        self.assertEqual(len(c_msgs), 2)

    async def test_inherit_nonexistent_child(self):
        store = InMemorySubAgentMemoryStore()
        ok = await store.inherit_from_parent("ghost_child", "p", [])
        self.assertFalse(ok)


class TestSummary(unittest.IsolatedAsyncioTestCase):
    """get_summary 统计测试"""

    async def test_summary_empty(self):
        store = InMemorySubAgentMemoryStore()
        s = await store.get_summary()
        self.assertEqual(s["total_subagents"], 0)
        self.assertEqual(s["total_isolated_messages"], 0)

    async def test_summary_with_data(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="p", name="P", isolated=False))
        await store.append("p", make_memory_entry("user", "x"))
        await store.create(SubAgentContext(subagent_id="c", name="C", parent_id="p", isolated=True))
        parent_msgs = await store.get_messages("p", include_parent=True)
        await store.inherit_from_parent("c", "p", parent_msgs)
        await store.append("c", make_memory_entry("user", "y"))

        s = await store.get_summary()
        self.assertEqual(s["total_subagents"], 2)
        self.assertEqual(s["isolated_subagents"], 1)  # 仅 c 是 isolated
        self.assertEqual(s["with_parent_inheritance"], 1)
        self.assertEqual(s["total_isolated_messages"], 2)
        self.assertEqual(s["total_parent_snapshots"], 1)


class TestSingleton(unittest.TestCase):
    """get_subagent_memory_store 单例测试"""

    def test_singleton_returns_same_instance(self):
        a = get_subagent_memory_store()
        b = get_subagent_memory_store()
        self.assertIs(a, b)


class TestConcurrentAccess(unittest.IsolatedAsyncioTestCase):
    """并发访问安全性测试"""

    async def test_concurrent_appends(self):
        store = InMemorySubAgentMemoryStore()
        await store.create(SubAgentContext(subagent_id="race", name="R"))

        async def append_n(n):
            for i in range(n):
                await store.append("race", make_memory_entry("user", f"msg_{n}_{i}"))

        # 并发追加 50 条
        await asyncio.gather(append_n(10), append_n(10), append_n(10), append_n(10), append_n(10))
        msgs = await store.get_messages("race")
        self.assertEqual(len(msgs), 50)


if __name__ == "__main__":
    unittest.main()
