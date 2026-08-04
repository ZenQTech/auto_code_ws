"""
# ============================================================
# 多源上下文选择器测试 (v1.0.0)
# Cycle 62 G62-02
# ====================================
# 测试覆盖：
#   1. 数据类型 (ContextItem, ContextBundle)
#   2. 6 种源加载器（file/code/terminal/git/document/web）
#   3. ContextManager 核心逻辑
#   4. REST API 端点
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | 初次创建
# ====================================
"""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

# 添加 backend 路径
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
# 同时将项目根目录加入路径（解决 cli_integration.executor 依赖）
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.services.multi_context import (  # noqa: E402
    ContextBundle,
    ContextItem,
    ContextManager,
    ContextSourceType,
    estimate_tokens,
    get_context_manager,
    load_code_source,
    load_document_source,
    load_file_source,
    load_git_source,
    load_terminal_source,
    load_web_source,
    reset_context_manager,
)


class TestEstimateTokens(unittest.TestCase):
    """token 估算函数测试"""

    def test_empty_text(self):
        self.assertEqual(estimate_tokens(""), 0)

    def test_normal_text(self):
        # 4 字符 = 1 token
        self.assertEqual(estimate_tokens("abcd"), 1)
        self.assertEqual(estimate_tokens("a" * 16), 4)

    def test_long_text(self):
        text = "a" * 1000
        self.assertEqual(estimate_tokens(text), 250)


class TestContextItem(unittest.TestCase):
    """ContextItem 数据类测试"""

    def test_to_dict(self):
        item = ContextItem(
            item_id="ctx-1",
            source_type=ContextSourceType.FILE,
            source_data={"path": "/tmp/x.py"},
            content="print('hi')",
            token_count=3,
        )
        d = item.to_dict()
        self.assertEqual(d["item_id"], "ctx-1")
        self.assertEqual(d["source_type"], "file")
        self.assertTrue(d["loaded"])
        self.assertEqual(d["content"], "print('hi')")

    def test_to_dict_with_error(self):
        item = ContextItem(
            item_id="ctx-2",
            source_type=ContextSourceType.FILE,
            source_data={"path": "/missing"},
            error="文件不存在",
        )
        d = item.to_dict()
        self.assertFalse(d["loaded"])
        self.assertEqual(d["error"], "文件不存在")


class TestContextBundle(unittest.TestCase):
    """ContextBundle 数据类测试"""

    def test_empty_bundle(self):
        bundle = ContextBundle(bundle_id="b1")
        d = bundle.to_dict()
        self.assertEqual(d["bundle_id"], "b1")
        self.assertEqual(d["item_count"], 0)
        self.assertEqual(d["total_tokens"], 0)

    def test_with_items(self):
        items = [
            ContextItem(
                item_id="i1",
                source_type=ContextSourceType.FILE,
                source_data={},
                content="a" * 100,
                token_count=25,
            ),
            ContextItem(
                item_id="i2",
                source_type=ContextSourceType.GIT,
                source_data={},
                content="b" * 200,
                token_count=50,
            ),
        ]
        bundle = ContextBundle(bundle_id="b2", items=items, total_tokens=75)
        d = bundle.to_dict()
        self.assertEqual(d["item_count"], 2)
        self.assertEqual(d["total_tokens"], 75)


class TestFileSource(unittest.TestCase):
    """file 源加载器测试"""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8",
        )
        self.tmp.write("Hello\nWorld\n中文测试\n")
        self.tmp.close()
        self.path = self.tmp.name

    def tearDown(self):
        if os.path.exists(self.path):
            os.unlink(self.path)

    def test_load_existing_file(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_file_source({"path": self.path}),
            )
            self.assertIsNone(err)
            self.assertIn("Hello", content)
            self.assertGreater(tokens, 0)
        finally:
            loop.close()

    def test_missing_file(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_file_source({"path": "/non/existent/path"}),
            )
            self.assertEqual(content, "")
            self.assertEqual(tokens, 0)
            self.assertIn("不存在", err)
        finally:
            loop.close()

    def test_truncation(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_file_source({"path": self.path, "max_size": 5}),
            )
            self.assertIsNone(err)
            self.assertIn("截断", content)
        finally:
            loop.close()

    def test_empty_path(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_file_source({"path": ""}),
            )
            self.assertEqual(content, "")
            self.assertEqual(tokens, 0)
            self.assertIsNotNone(err)
        finally:
            loop.close()


class TestCodeSource(unittest.TestCase):
    """code 源加载器测试"""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8",
        )
        for i in range(1, 11):
            self.tmp.write(f"line {i}\n")
        self.tmp.close()
        self.path = self.tmp.name

    def tearDown(self):
        if os.path.exists(self.path):
            os.unlink(self.path)

    def test_load_range(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_code_source(
                    {"path": self.path, "start_line": 2, "end_line": 5},
                ),
            )
            self.assertIsNone(err)
            self.assertIn("line 2", content)
            self.assertIn("line 5", content)
            self.assertNotIn("line 1\n", content)
            self.assertNotIn("line 6", content)
        finally:
            loop.close()

    def test_missing_file(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_code_source({"path": "/missing"}),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()


class TestTerminalSource(unittest.TestCase):
    """terminal 源加载器测试"""

    def test_execute_command(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_terminal_source({"command": "echo hello"}),
            )
            self.assertIsNone(err)
            self.assertIn("hello", content)
            self.assertGreater(tokens, 0)
        finally:
            loop.close()

    def test_missing_command(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_terminal_source({"command": ""}),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()

    def test_failing_command(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_terminal_source({"command": "false"}),
            )
            # false 返回非零但仍然有输出（空）+ stderr
            self.assertIsNone(err)  # 不会失败
        finally:
            loop.close()


class TestGitSource(unittest.TestCase):
    """git 源加载器测试"""

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        # 初始化一个 git 仓库
        for cmd in [
            ["git", "init"],
            ["git", "config", "user.email", "test@test.com"],
            ["git", "config", "user.name", "Test"],
        ]:
            subprocess_run(cmd, cwd=self.repo)
        # 添加一个 commit
        with open(os.path.join(self.repo, "test.txt"), "w") as f:
            f.write("test")
        subprocess_run(["git", "add", "test.txt"], cwd=self.repo)
        subprocess_run(["git", "commit", "-m", "init"], cwd=self.repo)

    def tearDown(self):
        import shutil
        if os.path.exists(self.repo):
            shutil.rmtree(self.repo)

    def test_load_log(self):
        loop = asyncio.new_event_loop()
        try:
            content, tokens, err = loop.run_until_complete(
                load_git_source(
                    {"repo_path": self.repo, "type": "log", "ref": "HEAD"},
                ),
            )
            self.assertIsNone(err)
            self.assertIn("init", content)
        finally:
            loop.close()

    def test_load_diff(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_git_source(
                    {"repo_path": self.repo, "type": "diff", "ref": "HEAD"},
                ),
            )
            self.assertIsNone(err)
        finally:
            loop.close()

    def test_missing_repo(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_git_source({"repo_path": "/no/such/repo"}),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()

    def test_invalid_type(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_git_source(
                    {"repo_path": self.repo, "type": "unknown"},
                ),
            )
            self.assertEqual(content, "")
            self.assertIn("未知", err)
        finally:
            loop.close()


def subprocess_run(cmd, cwd):
    """简单的同步 subprocess 包装"""
    import subprocess
    return subprocess.run(
        cmd, cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


class TestDocumentSource(unittest.TestCase):
    """document 源加载器测试"""

    def test_load_from_path(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8",
        ) as f:
            f.write("# Title\n\nBody")
            path = f.name
        try:
            loop = asyncio.new_event_loop()
            try:
                content, tokens, err = loop.run_until_complete(
                    load_document_source({"path": path}),
                )
                self.assertIsNone(err)
                self.assertIn("Title", content)
            finally:
                loop.close()
        finally:
            os.unlink(path)

    def test_missing_data(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_document_source({}),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()


class TestWebSource(unittest.TestCase):
    """web 源加载器测试"""

    def test_missing_url(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_web_source({"url": ""}),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()

    def test_404_url(self):
        loop = asyncio.new_event_loop()
        try:
            content, _, err = loop.run_until_complete(
                load_web_source(
                    {"url": "https://this-domain-does-not-exist-12345.invalid/"},
                ),
            )
            self.assertEqual(content, "")
            self.assertIsNotNone(err)
        finally:
            loop.close()


class TestContextManager(unittest.TestCase):
    """ContextManager 核心逻辑测试"""

    def setUp(self):
        reset_context_manager()

    def tearDown(self):
        reset_context_manager()

    def test_add_file_item(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8",
        ) as f:
            f.write("print('hello')")
            path = f.name
        try:
            manager = ContextManager()
            loop = asyncio.new_event_loop()
            try:
                item = loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": path},
                    ),
                )
                self.assertIsNone(item.error)
                self.assertGreater(item.token_count, 0)
                self.assertIn("hello", item.content)
            finally:
                loop.close()
        finally:
            os.unlink(path)

    def test_bundle_creation(self):
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            # 添加多个 item
            loop.run_until_complete(
                manager.add_item(
                    bundle_id="b1",
                    source_type=ContextSourceType.FILE,
                    source_data={"path": "/missing"},
                ),
            )
            loop.run_until_complete(
                manager.add_item(
                    bundle_id="b1",
                    source_type=ContextSourceType.GIT,
                    source_data={"repo_path": "/missing"},
                ),
            )
            bundle = manager.get_bundle("b1")
            self.assertIsNotNone(bundle)
            self.assertEqual(len(bundle.items), 2)
        finally:
            loop.close()

    def test_combined_content(self):
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8",
            ) as f:
                f.write("FILE_CONTENT_HERE")
                path = f.name
            try:
                loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": path},
                    ),
                )
                bundle = manager.get_bundle("b1")
                self.assertIn("FILE_CONTENT_HERE", bundle.combined_content)
                self.assertGreater(bundle.total_tokens, 0)
            finally:
                os.unlink(path)
        finally:
            loop.close()

    def test_remove_item(self):
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8",
            ) as f:
                f.write("A")
                path_a = f.name
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8",
            ) as f:
                f.write("B")
                path_b = f.name
            try:
                item_a = loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": path_a},
                    ),
                )
                loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": path_b},
                    ),
                )
                self.assertEqual(len(manager.get_bundle("b1").items), 2)
                removed = loop.run_until_complete(
                    manager.remove_item("b1", item_a.item_id),
                )
                self.assertTrue(removed)
                self.assertEqual(len(manager.get_bundle("b1").items), 1)
            finally:
                os.unlink(path_a)
                os.unlink(path_b)
        finally:
            loop.close()

    def test_delete_bundle(self):
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(
                manager.add_item(
                    bundle_id="b1",
                    source_type=ContextSourceType.FILE,
                    source_data={"path": "/missing"},
                ),
            )
            self.assertIsNotNone(manager.get_bundle("b1"))
            removed = loop.run_until_complete(manager.delete_bundle("b1"))
            self.assertTrue(removed)
            self.assertIsNone(manager.get_bundle("b1"))
        finally:
            loop.close()

    def test_stats(self):
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(
                manager.add_item(
                    bundle_id="b1",
                    source_type=ContextSourceType.FILE,
                    source_data={"path": "/missing"},
                ),
            )
            stats = manager.get_stats()
            self.assertEqual(stats["bundle_count"], 1)
            self.assertEqual(stats["total_items"], 1)
        finally:
            loop.close()

    def test_error_isolation(self):
        """单源失败不应影响其他源"""
        manager = ContextManager()
        loop = asyncio.new_event_loop()
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8",
            ) as f:
                f.write("GOOD")
                path = f.name
            try:
                # 先添加失败的
                bad = loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": "/missing"},
                    ),
                )
                self.assertIsNotNone(bad.error)
                # 再添加成功的
                good = loop.run_until_complete(
                    manager.add_item(
                        bundle_id="b1",
                        source_type=ContextSourceType.FILE,
                        source_data={"path": path},
                    ),
                )
                self.assertIsNone(good.error)
                bundle = manager.get_bundle("b1")
                self.assertEqual(len(bundle.items), 2)
                # combined_content 应包含成功的（失败的可有可无）
                self.assertIn("GOOD", bundle.combined_content)
            finally:
                os.unlink(path)
        finally:
            loop.close()


class TestGlobalSingleton(unittest.TestCase):
    """全局单例测试"""

    def test_singleton(self):
        reset_context_manager()
        m1 = get_context_manager()
        m2 = get_context_manager()
        self.assertIs(m1, m2)

    def test_reset(self):
        reset_context_manager()
        m1 = get_context_manager()
        reset_context_manager()
        m2 = get_context_manager()
        self.assertIsNot(m1, m2)


class TestContextAPI(unittest.TestCase):
    """REST API 端点测试（使用 FastAPI TestClient）"""

    def setUp(self):
        reset_context_manager()
        # 延迟导入以避免循环
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api.multi_context import router

        self.app = FastAPI()
        self.app.include_router(router, prefix="/api")
        self.client = TestClient(self.app)

    def tearDown(self):
        reset_context_manager()

    def test_add_file_item(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8",
        ) as f:
            f.write("print('hi')")
            path = f.name
        try:
            resp = self.client.post(
                "/api/context/items",
                json={
                    "bundle_id": "user-1",
                    "source_type": "file",
                    "source_data": {"path": path},
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["success"])
            self.assertIn("item", data)
            self.assertIn("bundle", data)
        finally:
            os.unlink(path)

    def test_add_item_invalid_type(self):
        resp = self.client.post(
            "/api/context/items",
            json={
                "bundle_id": "user-1",
                "source_type": "invalid_type",
                "source_data": {},
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_list_bundles(self):
        resp = self.client.get("/api/context/bundles")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["count"], 0)

    def test_get_nonexistent_bundle(self):
        resp = self.client.get("/api/context/bundles/nonexistent")
        self.assertEqual(resp.status_code, 404)

    def test_delete_bundle(self):
        # 先添加
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8",
        ) as f:
            f.write("x")
            path = f.name
        try:
            self.client.post(
                "/api/context/items",
                json={
                    "bundle_id": "to-delete",
                    "source_type": "file",
                    "source_data": {"path": path},
                },
            )
            resp = self.client.delete("/api/context/bundles/to-delete")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["success"])
            self.assertTrue(data["removed"])
        finally:
            os.unlink(path)

    def test_stats(self):
        resp = self.client.get("/api/context/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertIn("bundle_count", data["stats"])

    def test_reset(self):
        resp = self.client.post("/api/context/reset")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["success"])


if __name__ == "__main__":
    unittest.main()
