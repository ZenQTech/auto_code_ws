"""
# ============================================================
# ApplyPatch 服务单元测试
# Cycle 68 G68-02
# ============================================================
# 覆盖：V4A 解析、hunk 应用、validate、preview、apply、回滚、路径安全
# ====================================
"""

import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from app.services.apply_patch import (
    ApplyPatchService,
    ApplyResult,
    Hunk,
    HunkLine,
    OpType,
    PatchOp,
    PatchParseError,
    V4AParser,
    apply_hunks_to_text,
    get_apply_patch_service,
    reset_apply_patch_service,
)
from app.services.file_storage import (
    FileNotFoundError,
    FileStorage,
    get_file_storage,
    reset_file_storage,
)


# ============================================================
# 辅助函数
# ============================================================


def make_temp_dir():
    """创建临时目录并返回 (tmpdir, cleanup_fn)"""
    tmpdir = tempfile.mkdtemp(prefix="apply_patch_test_")
    return tmpdir


def write_file(root, rel_path, content):
    """写入测试文件"""
    abs_path = os.path.join(root, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)
    return abs_path


# ============================================================
# V4AParser 测试
# ============================================================


class TestV4AParserBasic(unittest.TestCase):
    """V4AParser 基础解析测试"""

    def setUp(self):
        self.parser = V4AParser()

    def test_parse_empty(self):
        result = self.parser.parse("")
        self.assertFalse(result.valid)
        self.assertIn("empty", result.error.lower())

    def test_parse_missing_begin(self):
        text = "*** End Patch"
        result = self.parser.parse(text)
        self.assertFalse(result.valid)
        self.assertIn("Begin", result.error)

    def test_parse_missing_end(self):
        text = "*** Begin Patch\n*** Update File: foo.py"
        result = self.parser.parse(text)
        self.assertFalse(result.valid)
        self.assertIn("End", result.error)

    def test_parse_duplicate_begin(self):
        text = "*** Begin Patch\n*** Begin Patch\n*** End Patch"
        result = self.parser.parse(text)
        self.assertFalse(result.valid)
        self.assertIn("duplicate", result.error.lower())

    def test_parse_end_before_begin(self):
        text = "*** End Patch\n*** Begin Patch\n*** End Patch"
        result = self.parser.parse(text)
        self.assertFalse(result.valid)

    def test_parse_too_large(self):
        # 创建一个超大 patch
        huge = "*** Begin Patch\n" + "x" * (200 * 1024 * 1024) + "\n*** End Patch"
        result = self.parser.parse(huge)
        self.assertFalse(result.valid)
        self.assertIn("too large", result.error.lower())


class TestV4AParserUpdate(unittest.TestCase):
    """Update File 解析"""

    def setUp(self):
        self.parser = V4AParser()

    def test_parse_simple_update(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello, World!")
+    return 42
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        self.assertEqual(result.ops_count, 1)
        op = result.ops[0]
        self.assertEqual(op.type, OpType.UPDATE)
        self.assertEqual(op.path, "src/main.py")
        self.assertEqual(len(op.hunks), 1)
        hunk = op.hunks[0]
        self.assertEqual(hunk.old_start, 1)
        self.assertEqual(hunk.old_count, 2)
        self.assertEqual(hunk.new_start, 1)
        self.assertEqual(hunk.new_count, 3)

    def test_parse_bare_at_hunk_header(self):
        """裸 @@ 作为 hunk 分隔符"""
        text = """*** Begin Patch
*** Update File: a.py
@@
 line1
-old
+new
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        self.assertEqual(len(result.ops[0].hunks), 1)
        self.assertEqual(len(result.ops[0].hunks[0].lines), 3)

    def test_parse_multiple_hunks(self):
        text = """*** Begin Patch
*** Update File: a.py
@@ -1,2 +1,3 @@
 line1
-old1
+new1
+extra
@@ -10,2 +11,2 @@
 line10
-old10
+new10
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        self.assertEqual(len(result.ops[0].hunks), 2)

    def test_parse_hunk_header_with_optional_counts(self):
        text = """*** Begin Patch
*** Update File: a.py
@@ -5 +5 @@
-old
+new
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        hunk = result.ops[0].hunks[0]
        self.assertEqual(hunk.old_start, 5)
        self.assertEqual(hunk.old_count, 1)  # 默认 1
        self.assertEqual(hunk.new_start, 5)
        self.assertEqual(hunk.new_count, 1)

    def test_parse_invalid_hunk_header(self):
        text = """*** Begin Patch
*** Update File: a.py
@@ invalid
-old
+new
*** End Patch"""
        result = self.parser.parse(text)
        self.assertFalse(result.valid)
        self.assertIn("invalid hunk header", result.error.lower())

    def test_parse_empty_path(self):
        text = "*** Begin Patch\n*** Update File: \n*** End Patch"
        result = self.parser.parse(text)
        self.assertFalse(result.valid)
        self.assertIn("empty path", result.error.lower())

    def test_parse_at_in_add(self):
        text = """*** Begin Patch
*** Add File: b.py
@@
-content
+new
*** End Patch"""
        result = self.parser.parse(text)
        # add 文件不允许 @@
        self.assertFalse(result.valid)
        self.assertIn("update", result.error.lower())


class TestV4AParserAdd(unittest.TestCase):
    """Add File 解析"""

    def setUp(self):
        self.parser = V4AParser()

    def test_parse_add_file(self):
        text = """*** Begin Patch
*** Add File: new.py
+def hello():
+    return 1
+print("hi")
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        op = result.ops[0]
        self.assertEqual(op.type, OpType.ADD)
        self.assertEqual(op.path, "new.py")
        self.assertIn("def hello():", op.content)
        self.assertIn("return 1", op.content)
        self.assertIn('print("hi")', op.content)

    def test_parse_add_file_no_plus_prefix(self):
        """兼容模式：add 文件内容无 + 前缀"""
        text = """*** Begin Patch
*** Add File: new.py
def hello():
    return 1
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        self.assertIn("def hello():", result.ops[0].content)


class TestV4AParserDelete(unittest.TestCase):
    """Delete File 解析"""

    def setUp(self):
        self.parser = V4AParser()

    def test_parse_delete_file(self):
        text = """*** Begin Patch
*** Delete File: old.py
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        op = result.ops[0]
        self.assertEqual(op.type, OpType.DELETE)
        self.assertEqual(op.path, "old.py")


class TestV4AParserMultiOps(unittest.TestCase):
    """多 op 解析"""

    def setUp(self):
        self.parser = V4AParser()

    def test_parse_multi_files(self):
        text = """*** Begin Patch
*** Update File: a.py
@@ -1,1 +1,2 @@
 line1
+added
*** Add File: b.py
+new
*** Delete File: c.py
*** End Patch"""
        result = self.parser.parse(text)
        self.assertTrue(result.valid, f"Error: {result.error}")
        self.assertEqual(result.ops_count, 3)
        self.assertEqual(result.ops[0].type, OpType.UPDATE)
        self.assertEqual(result.ops[1].type, OpType.ADD)
        self.assertEqual(result.ops[2].type, OpType.DELETE)

    def test_parse_too_many_files(self):
        # 构造超过 50 个文件的 patch
        lines = ["*** Begin Patch"]
        for i in range(60):
            lines.append(f"*** Delete File: f{i}.py")
        lines.append("*** End Patch")
        result = self.parser.parse("\n".join(lines))
        self.assertFalse(result.valid)
        self.assertIn("too many", result.error.lower())


# ============================================================
# apply_hunks_to_text 测试
# ============================================================


class TestApplyHunks(unittest.TestCase):
    """hunk 应用到文本"""

    def test_apply_simple_replace(self):
        original = "line1\nline2\nline3\n"
        hunk = Hunk(
            old_start=1,
            old_count=1,
            new_start=1,
            new_count=2,
            lines=[
                HunkLine(type="remove", content="line1"),
                HunkLine(type="add", content="replaced1"),
                HunkLine(type="add", content="replaced2"),
            ],
        )
        result = apply_hunks_to_text(original, [hunk])
        # splitlines 移除末尾空字符串；保留所有内容
        self.assertEqual(result, "replaced1\nreplaced2\nline2\nline3\n")

    def test_apply_context_preserved(self):
        original = "line1\nline2\nline3\n"
        hunk = Hunk(
            old_start=2,
            old_count=2,
            new_start=2,
            new_count=2,
            lines=[
                HunkLine(type="context", content="line2"),
                HunkLine(type="remove", content="line3"),
                HunkLine(type="add", content="line3_new"),
            ],
        )
        result = apply_hunks_to_text(original, [hunk])
        self.assertEqual(result, "line1\nline2\nline3_new\n")

    def test_apply_multiple_hunks(self):
        original = "a\nb\nc\nd\ne\n"
        hunk1 = Hunk(
            old_start=1, old_count=1, new_start=1, new_count=2,
            lines=[
                HunkLine(type="remove", content="a"),
                HunkLine(type="add", content="A1"),
                HunkLine(type="add", content="A2"),
            ],
        )
        hunk2 = Hunk(
            old_start=4, old_count=1, new_start=5, new_count=2,
            lines=[
                HunkLine(type="remove", content="d"),
                HunkLine(type="add", content="D1"),
                HunkLine(type="add", content="D2"),
            ],
        )
        result = apply_hunks_to_text(original, [hunk1, hunk2])
        # 注意：倒序应用，所以 hunk2 先应用
        self.assertIn("A1", result)
        self.assertIn("A2", result)
        self.assertIn("D1", result)
        self.assertIn("D2", result)


# ============================================================
# ApplyPatchService 测试
# ============================================================


class TestApplyPatchServiceValidate(unittest.TestCase):
    """validate 方法测试"""

    def setUp(self):
        reset_apply_patch_service()
        self.tmpdir = make_temp_dir()
        # 准备文件
        write_file(self.tmpdir, "src/main.py", 'def hello():\n    print("Hi")\n')
        write_file(self.tmpdir, "src/existing.py", "# existing\n")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_validate_update_safe(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello, World!")
+    return 42
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertTrue(result.safe, f"Error: {result.error}")
        self.assertEqual(result.ops_count, 1)
        self.assertEqual(len(result.diffs), 1)

    def test_validate_update_missing_file(self):
        text = """*** Begin Patch
*** Update File: missing.py
@@ -1,1 +1,2 @@
 line1
+added
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertFalse(result.safe)
        self.assertIn("not found", result.error.lower())

    def test_validate_add_safe(self):
        text = """*** Begin Patch
*** Add File: new.py
+line1
+line2
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertTrue(result.safe, f"Error: {result.error}")

    def test_validate_add_existing_file(self):
        text = """*** Begin Patch
*** Add File: src/existing.py
+line1
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertFalse(result.safe)
        # 应该有 1 个冲突
        self.assertGreater(len(result.conflicts), 0)

    def test_validate_add_existing_file_force(self):
        text = """*** Begin Patch
*** Add File: src/existing.py
+line1
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir, force=True)
        self.assertTrue(result.safe, f"Error: {result.error}")
        self.assertEqual(len(result.conflicts), 0)

    def test_validate_delete_safe(self):
        text = """*** Begin Patch
*** Delete File: src/existing.py
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertTrue(result.safe, f"Error: {result.error}")

    def test_validate_delete_missing(self):
        text = """*** Begin Patch
*** Delete File: missing.py
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertFalse(result.safe)

    def test_validate_path_traversal(self):
        text = """*** Begin Patch
*** Add File: ../../../etc/passwd
+hack
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertFalse(result.safe)
        self.assertIn("path", result.error.lower())

    def test_validate_path_absolute(self):
        text = """*** Begin Patch
*** Add File: /etc/passwd
+hack
*** End Patch"""
        service = get_apply_patch_service()
        result = service.validate(text, self.tmpdir)
        self.assertFalse(result.safe)


class TestApplyPatchServiceApply(unittest.TestCase):
    """apply 方法测试"""

    def setUp(self):
        reset_apply_patch_service()
        self.tmpdir = make_temp_dir()
        write_file(self.tmpdir, "src/main.py", 'def hello():\n    print("Hi")\n')
        write_file(self.tmpdir, "src/old.py", "# old\n")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_apply_update_success(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Hello")
+    return 42
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)
        self.assertTrue(result.success, f"Error: {result.error}")
        self.assertEqual(result.applied_ops, 1)
        # 验证文件
        with open(os.path.join(self.tmpdir, "src/main.py")) as f:
            content = f.read()
        self.assertIn("Hello", content)
        self.assertIn("return 42", content)

    def test_apply_add_success(self):
        text = """*** Begin Patch
*** Add File: new.py
+line1
+line2
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)
        self.assertTrue(result.success, f"Error: {result.error}")
        self.assertTrue(os.path.exists(os.path.join(self.tmpdir, "new.py")))

    def test_apply_delete_success(self):
        text = """*** Begin Patch
*** Delete File: src/old.py
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)
        self.assertTrue(result.success, f"Error: {result.error}")
        self.assertFalse(os.path.exists(os.path.join(self.tmpdir, "src/old.py")))

    def test_apply_multi_ops_success(self):
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,2 +1,3 @@
 def hello():
-    print("Hi")
+    print("Multi")
+    return 0
*** Add File: new.py
+new
*** Delete File: src/old.py
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)
        self.assertTrue(result.success, f"Error: {result.error}")
        self.assertEqual(result.applied_ops, 3)
        # 验证
        self.assertTrue(os.path.exists(os.path.join(self.tmpdir, "new.py")))
        self.assertFalse(os.path.exists(os.path.join(self.tmpdir, "src/old.py")))

    def test_apply_force_skips_conflicts(self):
        text = """*** Begin Patch
*** Add File: src/main.py
+# overwrite
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=True, create_snapshot=False)
        self.assertTrue(result.success, f"Error: {result.error}")
        with open(os.path.join(self.tmpdir, "src/main.py")) as f:
            self.assertIn("overwrite", f.read())

    def test_apply_conflict_no_force(self):
        text = """*** Begin Patch
*** Add File: src/main.py
+# overwrite
*** End Patch"""
        service = get_apply_patch_service()
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)
        self.assertFalse(result.success)
        # 原始文件不变
        with open(os.path.join(self.tmpdir, "src/main.py")) as f:
            self.assertIn('print("Hi")', f.read())

    def test_apply_with_snapshot_callback(self):
        callback = MagicMock(return_value="snap-12345")
        service = ApplyPatchService(snapshot_callback=callback)
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,1 +1,2 @@
 def hello():
+    # add comment
*** End Patch"""
        result = service.apply(text, self.tmpdir, force=False, create_snapshot=True)
        self.assertTrue(result.success, f"Error: {result.error}")
        self.assertEqual(result.snapshot_id, "snap-12345")
        callback.assert_called_once()

    def test_apply_rollback_on_failure(self):
        """测试回滚：构造一个 apply 阶段失败的场景"""
        # 创建一个 patch，让 validate 通过但 apply 失败
        # 方案：mock file_storage.write 在第 2 个 op 时失败
        service = get_apply_patch_service()
        text = """*** Begin Patch
*** Update File: src/main.py
@@ -1,1 +1,2 @@
 def hello():
+    # add comment
*** Add File: new1.py
+a
*** Add File: new2.py
+b
*** End Patch"""
        # 替换 file_storage 模拟 write 失败
        original_write = service._fs.write
        call_count = [0]

        def mock_write(path, content):
            call_count[0] += 1
            if call_count[0] == 2:
                raise OSError("disk full")
            return original_write(path, content)

        with patch.object(service._fs, "write", side_effect=mock_write):
            result = service.apply(text, self.tmpdir, force=False, create_snapshot=False)

        # 应当失败并回滚
        self.assertFalse(result.success)
        self.assertTrue(result.rolled_back)
        # 验证 main.py 被恢复
        with open(os.path.join(self.tmpdir, "src/main.py")) as f:
            content = f.read()
        self.assertNotIn("# add comment", content)


class TestApplyPatchServiceParse(unittest.TestCase):
    """parse 方法测试（仅解析）"""

    def test_parse_returns_parse_result(self):
        service = get_apply_patch_service()
        text = """*** Begin Patch
*** Update File: a.py
@@ -1,1 +1,2 @@
 line1
+added
*** End Patch"""
        result = service.parse(text)
        self.assertTrue(result.valid)
        self.assertEqual(result.ops_count, 1)


class TestApplyPatchServiceStats(unittest.TestCase):
    """stats 方法测试"""

    def test_stats(self):
        service = get_apply_patch_service()
        stats = service.get_stats()
        self.assertIn("max_files_per_patch", stats)
        self.assertIn("max_patch_size", stats)
        self.assertIn("fs_config", stats)


# ============================================================
# Singleton 测试
# ============================================================


class TestSingleton(unittest.TestCase):
    """全局单例测试"""

    def test_singleton(self):
        reset_apply_patch_service()
        s1 = get_apply_patch_service()
        s2 = get_apply_patch_service()
        self.assertIs(s1, s2)

    def test_reset(self):
        reset_apply_patch_service()
        s1 = get_apply_patch_service()
        reset_apply_patch_service()
        s2 = get_apply_patch_service()
        self.assertIsNot(s1, s2)


# ============================================================
# 性能测试
# ============================================================


class TestPerformance(unittest.TestCase):
    """性能基准测试"""

    def test_parse_performance(self):
        """10KB patch 解析 <50ms"""
        import time
        # 构造 10KB patch（单文件多 hunk 形式）
        lines = ["*** Begin Patch"]
        lines.append("*** Update File: big_file.py")
        for i in range(200):  # 200 hunks in one file
            start = i * 3 + 1
            lines.append(f"@@ -{start},2 +{start},3 @@")
            lines.append(f" line{start}")
            lines.append(f"-old{start}")
            lines.append(f"+new{start}")
            lines.append(f"+extra{start}")
        lines.append("*** End Patch")
        text = "\n".join(lines)
        self.assertGreater(len(text), 5 * 1024)

        parser = V4AParser()
        start = time.time()
        for _ in range(10):
            result = parser.parse(text)
        elapsed = (time.time() - start) / 10
        # 10 次平均 < 50ms
        self.assertLess(elapsed, 0.05, f"Parse too slow: {elapsed*1000:.1f}ms")
        self.assertTrue(result.valid, f"Parse failed: {result.error}")


if __name__ == "__main__":
    unittest.main()
