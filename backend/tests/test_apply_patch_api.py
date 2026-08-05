"""
# ============================================================
# ApplyPatch API 集成测试
# Cycle 68 G68-02
# ============================================================
# 覆盖：validate/preview/apply 三个端点的 REST API
# ====================================
"""

import os
import shutil
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.services.apply_patch import reset_apply_patch_service


def make_temp_dir():
    tmpdir = tempfile.mkdtemp(prefix="apply_patch_api_test_")
    return tmpdir


def write_file(root, rel_path, content):
    abs_path = os.path.join(root, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)
    return abs_path


class TestApplyPatchAPI(unittest.TestCase):
    """apply_patch API 集成测试"""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        reset_apply_patch_service()

    def setUp(self):
        self.tmpdir = make_temp_dir()
        write_file(self.tmpdir, "src/main.py", 'def hello():\n    print("Hi")\n')
        write_file(self.tmpdir, "src/existing.py", "# existing\n")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_validate_endpoint(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello")
+    return 42
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/validate",
            json={"patch_text": text, "root": self.tmpdir},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["ops_count"], 1)
        self.assertIn("src/main.py", data["files"])

    def test_validate_invalid_patch(self):
        resp = self.client.post(
            "/api/apply-patch/validate",
            json={"patch_text": "*** End Patch", "root": self.tmpdir},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data["valid"])
        self.assertIn("Begin", data["error"])

    def test_preview_endpoint(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello")
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/preview",
            json={"patch_text": text, "root": self.tmpdir},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["safe"])
        self.assertEqual(data["ops_count"], 1)
        self.assertEqual(len(data["diffs"]), 1)
        self.assertIn("---", data["diffs"][0]["diff"])
        self.assertIn("+++", data["diffs"][0]["diff"])

    def test_preview_conflict(self):
        text = """*** Begin Patch
*** Add File: src/existing.py
+overwrite
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/preview",
            json={"patch_text": text, "root": self.tmpdir},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertFalse(data["safe"])
        self.assertGreater(len(data["conflicts"]), 0)

    def test_apply_endpoint_success(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello")
+    return 42
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={
                "patch_text": text,
                "root": self.tmpdir,
                "create_snapshot": False,
            },
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["applied_ops"], 1)
        self.assertIsNone(data["snapshot_id"])
        # 验证
        with open(os.path.join(self.tmpdir, "src/main.py")) as f:
            self.assertIn("Hello", f.read())

    def test_apply_endpoint_conflict_409(self):
        text = """*** Begin Patch
*** Add File: src/existing.py
+overwrite
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={"patch_text": text, "root": self.tmpdir, "create_snapshot": False},
        )
        self.assertEqual(resp.status_code, 409, resp.text)
        data = resp.json()
        # FastAPI HTTPException 包装的 detail
        detail = data.get("detail", {})
        if isinstance(detail, dict):
            self.assertEqual(detail.get("error"), "CONFLICTS_DETECTED")

    def test_apply_endpoint_force(self):
        text = """*** Begin Patch
*** Add File: src/existing.py
+overwrite
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={
                "patch_text": text,
                "root": self.tmpdir,
                "force": True,
                "create_snapshot": False,
            },
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["success"])
        with open(os.path.join(self.tmpdir, "src/existing.py")) as f:
            self.assertIn("overwrite", f.read())

    def test_apply_endpoint_multi_ops(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,1 +1,2 @@
 def hello():
+    # add comment
*** Add File: new.py
+new content
*** Delete File: src/existing.py
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={"patch_text": text, "root": self.tmpdir, "create_snapshot": False},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["applied_ops"], 3)
        # 验证
        self.assertTrue(os.path.exists(os.path.join(self.tmpdir, "new.py")))
        self.assertFalse(os.path.exists(os.path.join(self.tmpdir, "src/existing.py")))

    def test_apply_endpoint_parse_error(self):
        text = "*** Invalid Patch"
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={"patch_text": text, "root": self.tmpdir, "create_snapshot": False},
        )
        # parse error 返回 200 + error 字段（因为 apply 先 validate）
        # 或者 400，取决于具体路径
        self.assertIn(resp.status_code, (200, 400, 500))
        if resp.status_code == 200:
            data = resp.json()
            self.assertFalse(data["success"])

    def test_apply_endpoint_path_traversal(self):
        text = """*** Begin Patch
*** Add File: ../../../etc/passwd
+hack
*** End Patch"""
        resp = self.client.post(
            "/api/apply-patch/apply",
            json={"patch_text": text, "root": self.tmpdir, "create_snapshot": False},
        )
        # 应该被拒绝（200 success=False 或 403）
        if resp.status_code == 200:
            data = resp.json()
            self.assertFalse(data["success"])

    def test_stats_endpoint(self):
        resp = self.client.get("/api/apply-patch/stats")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertIn("max_files_per_patch", data)
        self.assertIn("max_patch_size", data)


if __name__ == "__main__":
    unittest.main()
