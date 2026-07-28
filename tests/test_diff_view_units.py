"""
# ============================================================
# DiffView 核心服务单元测试
# ============================================================
# 测试范围：
#   1. 常量与枚举
#   2. DiffLine / FileDiff / DiffStats / DiffResult 数据类
#   3. _normalize_path / _safe_relpath / _file_sha256 工具方法
#   4. parse_patch_lines 统一 diff 解析
#   5. build_side_by_side 并排视图构造
#   6. build_json_patch JSON 格式构造
#   7. _split_diff_text 多文件 diff 拆分
#   8. _build_untracked_patch untracked 文件 patch 构造
#   9. SnapshotManager 快照管理（create/list/restore/delete）
#  10. DiffViewService 工作区 diff / 任意 ref diff / 快照对比
#  11. DiffViewService 暂存控制 stage / unstage / stage_all
#  12. get_diff_view_service 全局单例
#  13. 异常路径（路径越界 / 格式非法 / 项目不存在）
# 测试目标：100% 通过率
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

WORKSPACE = "/home/qizheng/auto_code_ws"
sys.path.insert(0, WORKSPACE)

from backend.app.services.diff_view import (  # noqa: E402
    DiffFormat,
    DiffLine,
    DiffResult,
    DiffStats,
    DiffStatus,
    FileDiff,
    MAX_PATCH_CHARS,
    MAX_PATH_LENGTH,
    SNAPSHOT_DIRNAME,
    Snapshot,
    SnapshotManager,
    DiffViewService,
    _file_sha256,
    _now_iso,
    _normalize_path,
    _safe_relpath,
    build_json_patch,
    build_side_by_side,
    get_diff_view_service,
    parse_patch_lines,
    reset_global_registry,
)


# ============================================================
# 测试辅助
# ============================================================

def _init_git_repo(path: Path) -> bool:
    """在指定目录初始化 git 仓库并配置用户；返回是否成功"""
    import subprocess
    try:
        subprocess.run(
            ["git", "init", "-q", str(path)],
            check=True, capture_output=True, timeout=10,
        )
        subprocess.run(
            ["git", "-C", str(path), "config", "user.email", "test@example.com"],
            check=True, capture_output=True, timeout=5,
        )
        subprocess.run(
            ["git", "-C", str(path), "config", "user.name", "Test User"],
            check=True, capture_output=True, timeout=5,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


# ============================================================
# 1. 常量与枚举测试
# ============================================================
class TestConstantsAndEnums(unittest.TestCase):
    """测试常量和枚举值"""

    def test_diff_status_values(self):
        self.assertEqual(DiffStatus.ADDED.value, "added")
        self.assertEqual(DiffStatus.MODIFIED.value, "modified")
        self.assertEqual(DiffStatus.DELETED.value, "deleted")
        self.assertEqual(DiffStatus.RENAMED.value, "renamed")
        self.assertEqual(DiffStatus.UNTRACKED.value, "untracked")
        self.assertEqual(DiffStatus.UNMODIFIED.value, "unmodified")

    def test_diff_format_values(self):
        self.assertEqual(DiffFormat.UNIFIED.value, "unified")
        self.assertEqual(DiffFormat.SIDE_BY_SIDE.value, "side_by_side")
        self.assertEqual(DiffFormat.JSON_PATCH.value, "json_patch")
        self.assertEqual(DiffFormat.STATS.value, "stats")

    def test_max_constants_positive(self):
        self.assertGreater(MAX_PATCH_CHARS, 0)
        self.assertGreater(MAX_PATH_LENGTH, 0)
        self.assertEqual(SNAPSHOT_DIRNAME, ".diffview")


# ============================================================
# 2. 数据类测试
# ============================================================
class TestDataclasses(unittest.TestCase):
    """测试数据类序列化"""

    def test_diff_line_to_dict(self):
        line = DiffLine(
            line_type="add",
            content="hello",
            old_line_no=None,
            new_line_no=10,
        )
        d = line.to_dict()
        self.assertEqual(d["line_type"], "add")
        self.assertEqual(d["content"], "hello")
        self.assertEqual(d["new_line_no"], 10)
        self.assertIsNone(d["old_line_no"])

    def test_file_diff_to_dict(self):
        fd = FileDiff(
            path="a.py",
            status="modified",
            additions=2,
            deletions=1,
            patch_unified="--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n",
            lines=[],
        )
        d = fd.to_dict()
        self.assertEqual(d["path"], "a.py")
        self.assertEqual(d["status"], "modified")
        self.assertEqual(d["additions"], 2)
        self.assertEqual(d["deletions"], 1)
        self.assertIn("patch_unified", d)

    def test_diff_stats_to_dict(self):
        stats = DiffStats(
            total_files=3,
            total_additions=10,
            total_deletions=5,
            by_status={"modified": 2, "added": 1},
        )
        d = stats.to_dict()
        self.assertEqual(d["total_files"], 3)
        self.assertEqual(d["total_additions"], 10)
        self.assertEqual(d["by_status"]["modified"], 2)

    def test_diff_result_to_dict(self):
        result = DiffResult(
            format="unified",
            files=[],
            stats=DiffStats(),
            base_ref="HEAD",
            target_ref="WORKTREE",
        )
        d = result.to_dict()
        self.assertEqual(d["format"], "unified")
        self.assertEqual(d["base_ref"], "HEAD")
        self.assertEqual(d["target_ref"], "WORKTREE")

    def test_snapshot_to_dict(self):
        snap = Snapshot(
            id="snap1",
            project_path="/tmp/p",
            label="test",
            description="desc",
            created_at="2026-01-01T00:00:00+00:00",
            file_count=5,
            total_size=1024,
            file_hashes={"a.py": "abc"},
            storage_dir="/tmp/p/.diffview/snap1",
        )
        d = snap.to_dict()
        self.assertEqual(d["id"], "snap1")
        self.assertEqual(d["file_count"], 5)


# ============================================================
# 3. 工具方法测试
# ============================================================
class TestUtils(unittest.TestCase):
    """测试工具函数"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.root = Path(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_normalize_path_relative(self):
        rel = _normalize_path("a/b.py", self.root)
        self.assertEqual(rel, "a/b.py")

    def test_normalize_path_absolute(self):
        p = self.root / "a" / "b.py"
        p.parent.mkdir()
        p.touch()
        rel = _normalize_path(str(p), self.root)
        self.assertEqual(rel, "a/b.py")

    def test_normalize_path_outside_raises(self):
        with self.assertRaises(ValueError):
            _normalize_path("/etc/passwd", self.root)

    def test_normalize_path_empty_raises(self):
        with self.assertRaises(ValueError):
            _normalize_path("", self.root)

    def test_normalize_path_traversal_raises(self):
        with self.assertRaises(ValueError):
            _normalize_path("../escape", self.root)

    def test_safe_relpath_valid(self):
        p = self.root / "x.py"
        p.touch()
        rel = _safe_relpath(str(p), self.root)
        self.assertEqual(rel, Path("x.py"))

    def test_safe_relpath_invalid(self):
        rel = _safe_relpath("/etc/passwd", self.root)
        self.assertIsNone(rel)

    def test_file_sha256_normal(self):
        f = self.root / "f.txt"
        f.write_text("hello")
        h = _file_sha256(f)
        self.assertEqual(len(h), 64)

    def test_file_sha256_nonexistent(self):
        f = self.root / "missing.txt"
        h = _file_sha256(f)
        self.assertEqual(h, "empty")

    def test_now_iso_format(self):
        ts = _now_iso()
        self.assertIn("T", ts)
        self.assertTrue(ts.endswith("+00:00") or ts.endswith("Z"))


# ============================================================
# 4. parse_patch_lines 测试
# ============================================================
class TestParsePatchLines(unittest.TestCase):
    """测试 unified diff 行级解析"""

    def test_parse_empty(self):
        self.assertEqual(parse_patch_lines(""), [])

    def test_parse_add_line(self):
        patch = "+++ b/a.py\n@@ -0,0 +1,1 @@\n+new line\n"
        lines = parse_patch_lines(patch)
        # 应包含 meta (+++) + meta (@@) + add
        types = [ln.line_type for ln in lines]
        self.assertIn("add", types)
        self.assertIn("meta", types)
        # add 行行号
        add_line = next(ln for ln in lines if ln.line_type == "add")
        self.assertEqual(add_line.new_line_no, 1)

    def test_parse_del_line(self):
        patch = "--- a/a.py\n@@ -1 +0,0 @@\n-old line\n"
        lines = parse_patch_lines(patch)
        del_line = next(ln for ln in lines if ln.line_type == "del")
        self.assertEqual(del_line.old_line_no, 1)
        self.assertEqual(del_line.content, "old line")

    def test_parse_context_line(self):
        patch = "--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n context\n"
        lines = parse_patch_lines(patch)
        ctx_line = next(ln for ln in lines if ln.line_type == "ctx")
        self.assertEqual(ctx_line.content, "context")
        self.assertEqual(ctx_line.old_line_no, 1)
        self.assertEqual(ctx_line.new_line_no, 1)

    def test_parse_hunk_header(self):
        patch = "@@ -10,3 +12,5 @@\n"
        lines = parse_patch_lines(patch)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].line_type, "meta")
        # 解析后下一行应以 10 和 12 为基准
        patch2 = "@@ -10,3 +12,5 @@\n-a\n+b\n"
        lines2 = parse_patch_lines(patch2)
        del_line = next(ln for ln in lines2 if ln.line_type == "del")
        add_line = next(ln for ln in lines2 if ln.line_type == "add")
        self.assertEqual(del_line.old_line_no, 10)
        self.assertEqual(add_line.new_line_no, 12)

    def test_parse_complex(self):
        patch = (
            "--- a/x.py\n"
            "+++ b/x.py\n"
            "@@ -1,3 +1,4 @@\n"
            " line1\n"
            "-line2\n"
            "+line2-new\n"
            "+line3-added\n"
            " line4\n"
        )
        lines = parse_patch_lines(patch)
        types = [ln.line_type for ln in lines]
        # 1 meta (---), 1 meta (+++), 1 meta (@@), 1 ctx, 1 del, 1 add, 1 add, 1 ctx
        self.assertEqual(types.count("meta"), 3)
        self.assertEqual(types.count("ctx"), 2)
        self.assertEqual(types.count("del"), 1)
        self.assertEqual(types.count("add"), 2)


# ============================================================
# 5. build_side_by_side 测试
# ============================================================
class TestBuildSideBySide(unittest.TestCase):
    """测试并排视图构造"""

    def test_empty(self):
        result = build_side_by_side([])
        self.assertEqual(result["row_count"], 0)
        self.assertEqual(result["rows"], [])

    def test_context_row(self):
        diff_lines = [
            DiffLine(line_type="ctx", content="hello", old_line_no=1, new_line_no=1),
        ]
        result = build_side_by_side(diff_lines)
        self.assertEqual(result["row_count"], 1)
        row = result["rows"][0]
        self.assertEqual(row["left"]["type"], "ctx")
        self.assertEqual(row["right"]["type"], "ctx")

    def test_del_add_rows(self):
        diff_lines = [
            DiffLine(line_type="del", content="old", old_line_no=1),
            DiffLine(line_type="add", content="new", new_line_no=1),
        ]
        result = build_side_by_side(diff_lines)
        self.assertEqual(result["row_count"], 2)
        # del 行：左侧有内容，右侧 empty
        self.assertEqual(result["rows"][0]["left"]["type"], "del")
        self.assertEqual(result["rows"][0]["right"]["type"], "empty")
        # add 行：左侧 empty，右侧有内容
        self.assertEqual(result["rows"][1]["left"]["type"], "empty")
        self.assertEqual(result["rows"][1]["right"]["type"], "add")

    def test_meta_row(self):
        diff_lines = [
            DiffLine(line_type="meta", content="@@ -1 +1 @@"),
        ]
        result = build_side_by_side(diff_lines)
        self.assertEqual(result["row_count"], 1)
        self.assertEqual(result["rows"][0]["left"]["type"], "meta")
        self.assertEqual(result["rows"][0]["right"]["type"], "meta")


# ============================================================
# 6. build_json_patch 测试
# ============================================================
class TestBuildJsonPatch(unittest.TestCase):
    """测试 JSON Patch 构造"""

    def test_empty(self):
        result = build_json_patch([], "a.py")
        self.assertEqual(result, [])

    def test_add_op(self):
        diff_lines = [
            DiffLine(line_type="add", content="new", new_line_no=5),
        ]
        result = build_json_patch(diff_lines, "a.py")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["op"], "add")
        self.assertEqual(result[0]["line"], 5)
        self.assertEqual(result[0]["content"], "new")

    def test_remove_op(self):
        diff_lines = [
            DiffLine(line_type="del", content="old", old_line_no=3),
        ]
        result = build_json_patch(diff_lines, "a.py")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["op"], "remove")
        self.assertEqual(result[0]["line"], 3)

    def test_mixed_ops(self):
        diff_lines = [
            DiffLine(line_type="ctx", content="c", old_line_no=1, new_line_no=1),
            DiffLine(line_type="add", content="a", new_line_no=2),
            DiffLine(line_type="del", content="d", old_line_no=2),
        ]
        result = build_json_patch(diff_lines, "x.py")
        # ctx 不应产生 op
        self.assertEqual(len(result), 2)
        ops = [r["op"] for r in result]
        self.assertIn("add", ops)
        self.assertIn("remove", ops)


# ============================================================
# 7. _split_diff_text 测试
# ============================================================
class TestSplitDiffText(unittest.TestCase):
    """测试 multi-file diff 文本拆分"""

    def test_empty(self):
        self.assertEqual(DiffViewService._split_diff_text(""), {})

    def test_single_file(self):
        diff = (
            "diff --git a/a.py b/a.py\n"
            "--- a/a.py\n"
            "+++ b/a.py\n"
            "@@ -1 +1 @@\n"
            "-old\n"
            "+new\n"
        )
        result = DiffViewService._split_diff_text(diff)
        self.assertIn("a.py", result)
        self.assertIn("--- a/a.py", result["a.py"])
        self.assertIn("+new", result["a.py"])

    def test_multiple_files(self):
        diff = (
            "diff --git a/a.py b/a.py\n"
            "--- a/a.py\n"
            "+++ b/a.py\n"
            "@@ -1 +1 @@\n"
            "-old\n"
            "+new\n"
            "diff --git a/b.py b/b.py\n"
            "--- a/b.py\n"
            "+++ b/b.py\n"
            "@@ -1 +1 @@\n"
            "-x\n"
            "+y\n"
        )
        result = DiffViewService._split_diff_text(diff)
        self.assertIn("a.py", result)
        self.assertIn("b.py", result)


# ============================================================
# 8. _build_untracked_patch 测试
# ============================================================
class TestBuildUntrackedPatch(unittest.TestCase):
    """测试 untracked 文件 patch 构造"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.f = Path(self.tmpdir) / "new.py"
        self.f.write_text("line1\nline2\n")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_untracked_patch(self):
        patch = DiffViewService._build_untracked_patch(self.f)
        self.assertIn("new file mode", patch)
        self.assertIn("+++ b/new.py", patch)
        self.assertIn("+line1", patch)
        self.assertIn("+line2", patch)


# ============================================================
# 9. SnapshotManager 测试
# ============================================================
class TestSnapshotManager(unittest.TestCase):
    """测试快照管理"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "project"
        self.project.mkdir()
        # 创建一些初始文件
        (self.project / "a.py").write_text("print('a')")
        (self.project / "src").mkdir()
        (self.project / "src" / "b.py").write_text("print('b')")
        self.mgr = SnapshotManager(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_creates_root(self):
        self.assertTrue(self.mgr.snapshot_root.exists())

    def test_list_empty(self):
        snaps = self.mgr.list_snapshots()
        self.assertEqual(snaps, [])

    def test_create_snapshot(self):
        snap = self.mgr.create_snapshot(label="v1", description="test")
        self.assertEqual(snap.label, "v1")
        self.assertEqual(snap.description, "test")
        self.assertGreater(snap.file_count, 0)
        self.assertIn("a.py", snap.file_hashes)
        self.assertIn("src/b.py", snap.file_hashes)
        # 文件被复制
        self.assertTrue((Path(snap.storage_dir) / "files" / "a.py").exists())

    def test_list_after_create(self):
        self.mgr.create_snapshot(label="snap1")
        self.mgr.create_snapshot(label="snap2")
        snaps = self.mgr.list_snapshots()
        self.assertEqual(len(snaps), 2)
        # 倒序排列
        self.assertEqual(snaps[0].label, "snap2")
        self.assertEqual(snaps[1].label, "snap1")

    def test_get_snapshot(self):
        snap = self.mgr.create_snapshot(label="findme")
        found = self.mgr.get_snapshot(snap.id)
        self.assertIsNotNone(found)
        self.assertEqual(found.label, "findme")
        self.assertIsNone(self.mgr.get_snapshot("nonexistent"))

    def test_restore_snapshot(self):
        # 初始快照
        snap = self.mgr.create_snapshot(label="initial")
        # 修改文件
        (self.project / "a.py").write_text("# modified\n")
        # 添加新文件
        (self.project / "new.py").write_text("new")
        # 恢复
        ok, msg, count = self.mgr.restore_snapshot(snap.id)
        self.assertTrue(ok, msg)
        self.assertGreater(count, 0)
        # 验证 a.py 已恢复
        self.assertEqual((self.project / "a.py").read_text(), "print('a')")

    def test_restore_nonexistent(self):
        ok, msg, count = self.mgr.restore_snapshot("nonexistent")
        self.assertFalse(ok)
        self.assertEqual(count, 0)

    def test_delete_snapshot(self):
        snap = self.mgr.create_snapshot(label="todelete")
        ok, msg = self.mgr.delete_snapshot(snap.id)
        self.assertTrue(ok)
        self.assertFalse(Path(snap.storage_dir).exists())
        self.assertIsNone(self.mgr.get_snapshot(snap.id))

    def test_delete_nonexistent(self):
        ok, msg = self.mgr.delete_snapshot("nonexistent")
        self.assertFalse(ok)


# ============================================================
# 10. DiffViewService 工作区 diff 测试
# ============================================================
class TestDiffViewServiceWorkspace(unittest.TestCase):
    """测试工作区 diff"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "proj"
        self.project.mkdir()
        self.has_git = _init_git_repo(self.project)
        if self.has_git:
            # 初始文件 + 首次提交
            (self.project / "a.py").write_text("line1\nline2\n")
            (self.project / "b.py").write_text("b1\nb2\n")
            import subprocess
            subprocess.run(
                ["git", "-C", str(self.project), "add", "."],
                check=True, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["git", "-C", str(self.project), "commit", "-q", "-m", "init"],
                check=True, capture_output=True, timeout=5,
            )
            # 修改 a.py
            (self.project / "a.py").write_text("line1\nline2-modified\nline3\n")
            # 新增 c.py
            (self.project / "c.py").write_text("c1\nc2\n")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_diff_workspace_unified(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(format="unified")
        self.assertGreater(len(result.files), 0)
        # a.py modified, c.py untracked
        paths = {f.path for f in result.files}
        self.assertIn("a.py", paths)
        self.assertIn("c.py", paths)
        # unified 格式：lines 非空
        a_diff = next(f for f in result.files if f.path == "a.py")
        self.assertGreater(len(a_diff.lines), 0)

    def test_diff_workspace_staged(self):
        if not self.has_git:
            self.skipTest("git not available")
        # 暂存 a.py
        import subprocess
        subprocess.run(
            ["git", "-C", str(self.project), "add", "a.py"],
            check=True, capture_output=True, timeout=5,
        )
        svc = DiffViewService(self.project)
        # 暂存区 diff
        result = svc.diff_workspace(staged=True, format="unified")
        # 此时 staged 应包含 a.py，unstaged 工作区应不含 a.py 修改
        paths = {f.path for f in result.files}
        self.assertIn("a.py", paths)

    def test_diff_workspace_side_by_side(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(format="side_by_side")
        a_diff = next(f for f in result.files if f.path == "a.py")
        self.assertIn("rows", a_diff.side_by_side)
        self.assertGreater(a_diff.side_by_side["row_count"], 0)

    def test_diff_workspace_json_patch(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(format="json_patch")
        a_diff = next(f for f in result.files if f.path == "a.py")
        self.assertIsInstance(a_diff.json_patch, list)
        self.assertGreater(len(a_diff.json_patch), 0)
        # 每个 op 应有 op/line/content
        op = a_diff.json_patch[0]
        self.assertIn("op", op)
        self.assertIn("line", op)

    def test_diff_workspace_stats(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(format="stats")
        self.assertGreater(result.stats.total_files, 0)
        self.assertGreater(result.stats.total_additions, 0)
        # stats 格式：lines 列表为空
        a_diff = next(f for f in result.files if f.path == "a.py")
        self.assertEqual(a_diff.lines, [])

    def test_diff_workspace_invalid_format(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        with self.assertRaises(ValueError):
            svc.diff_workspace(format="invalid")

    def test_diff_workspace_path_filter(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(path_filter="a.py")
        paths = {f.path for f in result.files}
        self.assertIn("a.py", paths)
        self.assertNotIn("c.py", paths)

    def test_diff_workspace_status_filter(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_workspace(status_filter=["untracked"])
        # 仅 untracked
        for f in result.files:
            self.assertEqual(f.status, "untracked")


# ============================================================
# 11. DiffViewService 任意 ref diff 测试
# ============================================================
class TestDiffViewServiceRefs(unittest.TestCase):
    """测试任意 ref 对比"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "proj"
        self.project.mkdir()
        self.has_git = _init_git_repo(self.project)
        if self.has_git:
            import subprocess
            (self.project / "a.py").write_text("v1\n")
            subprocess.run(
                ["git", "-C", str(self.project), "add", "."],
                check=True, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["git", "-C", str(self.project), "commit", "-q", "-m", "v1"],
                check=True, capture_output=True, timeout=5,
            )
            (self.project / "a.py").write_text("v2\n")
            subprocess.run(
                ["git", "-C", str(self.project), "add", "."],
                check=True, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["git", "-C", str(self.project), "commit", "-q", "-m", "v2"],
                check=True, capture_output=True, timeout=5,
            )

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_diff_refs_head_head_1(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_refs(base_ref="HEAD~1", target_ref="HEAD", format="unified")
        self.assertEqual(result.error, None)
        self.assertEqual(result.base_ref, "HEAD~1")
        self.assertEqual(result.target_ref, "HEAD")
        # 应包含 a.py 的修改
        paths = {f.path for f in result.files}
        self.assertIn("a.py", paths)

    def test_diff_refs_identical(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        result = svc.diff_refs(base_ref="HEAD", target_ref="HEAD")
        self.assertIsNotNone(result.error)

    def test_diff_refs_empty_args(self):
        if not self.has_git:
            self.skipTest("git not available")
        svc = DiffViewService(self.project)
        with self.assertRaises(ValueError):
            svc.diff_refs(base_ref="", target_ref="HEAD")
        with self.assertRaises(ValueError):
            svc.diff_refs(base_ref="HEAD", target_ref="")


# ============================================================
# 12. DiffViewService 快照对比测试
# ============================================================
class TestDiffViewServiceSnapshot(unittest.TestCase):
    """测试快照 vs 工作区对比"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "proj"
        self.project.mkdir()
        (self.project / "a.py").write_text("v1\n")
        (self.project / "b.py").write_text("b1\n")
        self.svc = DiffViewService(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_diff_snapshot_vs_worktree_modified(self):
        snap = self.svc.create_snapshot(label="v1")
        # 修改 a.py
        (self.project / "a.py").write_text("v1-modified\n")
        result = self.svc.diff_snapshot_to_workspace(snap.id)
        self.assertEqual(result.error, None)
        paths = {f.path for f in result.files}
        self.assertIn("a.py", paths)

    def test_diff_snapshot_vs_worktree_deleted(self):
        snap = self.svc.create_snapshot(label="v1")
        (self.project / "b.py").unlink()
        result = self.svc.diff_snapshot_to_workspace(snap.id)
        paths = {f.path for f in result.files}
        self.assertIn("b.py", paths)
        b = next(f for f in result.files if f.path == "b.py")
        self.assertEqual(b.status, "deleted")

    def test_diff_snapshot_vs_worktree_added(self):
        snap = self.svc.create_snapshot(label="v1")
        (self.project / "c.py").write_text("new")
        result = self.svc.diff_snapshot_to_workspace(snap.id)
        paths = {f.path for f in result.files}
        self.assertIn("c.py", paths)
        c = next(f for f in result.files if f.path == "c.py")
        self.assertEqual(c.status, "added")

    def test_diff_snapshot_nonexistent(self):
        result = self.svc.diff_snapshot_to_workspace("nonexistent")
        self.assertIsNotNone(result.error)


# ============================================================
# 13. 暂存控制测试
# ============================================================
class TestStageOperations(unittest.TestCase):
    """测试 stage / unstage / stage_all"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "proj"
        self.project.mkdir()
        self.has_git = _init_git_repo(self.project)
        if self.has_git:
            import subprocess
            (self.project / "a.py").write_text("v1\n")
            subprocess.run(
                ["git", "-C", str(self.project), "add", "."],
                check=True, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["git", "-C", str(self.project), "commit", "-q", "-m", "init"],
                check=True, capture_output=True, timeout=5,
            )
            (self.project / "a.py").write_text("v2\n")
            (self.project / "b.py").write_text("new\n")
        self.svc = DiffViewService(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_stage_file(self):
        if not self.has_git:
            self.skipTest("git not available")
        ok, msg = self.svc.stage_file("a.py")
        self.assertTrue(ok, msg)
        self.assertIn("staged", msg.lower())

    def test_unstage_file(self):
        if not self.has_git:
            self.skipTest("git not available")
        self.svc.stage_file("a.py")
        ok, msg = self.svc.unstage_file("a.py")
        self.assertTrue(ok, msg)

    def test_stage_all(self):
        if not self.has_git:
            self.skipTest("git not available")
        ok, msg = self.svc.stage_all()
        self.assertTrue(ok, msg)

    def test_stage_invalid_path(self):
        if not self.has_git:
            self.skipTest("git not available")
        with self.assertRaises(ValueError):
            self.svc.stage_file("")

    def test_stage_outside_project(self):
        if not self.has_git:
            self.skipTest("git not available")
        with self.assertRaises(ValueError):
            self.svc.stage_file("../escape")


# ============================================================
# 14. 全局单例测试
# ============================================================
class TestGlobalRegistry(unittest.TestCase):
    """测试全局注册表"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir) / "p"
        self.project.mkdir()
        reset_global_registry()

    def tearDown(self):
        reset_global_registry()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_singleton(self):
        svc1 = get_diff_view_service(str(self.project))
        svc2 = get_diff_view_service(str(self.project))
        self.assertIs(svc1, svc2)

    def test_empty_path_raises(self):
        with self.assertRaises(ValueError):
            get_diff_view_service("")

    def test_thread_safety(self):
        """多线程并发获取应返回同一实例"""
        results = []
        def worker():
            results.append(get_diff_view_service(str(self.project)))
        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(set(id(s) for s in results)), 1)


# ============================================================
# 15. 异常路径测试
# ============================================================
class TestExceptionPaths(unittest.TestCase):
    """测试异常路径"""

    def test_project_not_exists(self):
        svc = DiffViewService(Path("/nonexistent/path/xyz"))
        with self.assertRaises(ValueError):
            svc.diff_workspace()

    def test_validate_rel_path_empty(self):
        tmp = tempfile.mkdtemp()
        try:
            svc = DiffViewService(Path(tmp))
            with self.assertRaises(ValueError):
                svc._validate_rel_path("")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_validate_rel_path_too_long(self):
        tmp = tempfile.mkdtemp()
        try:
            svc = DiffViewService(Path(tmp))
            long_path = "a" * (MAX_PATH_LENGTH + 1)
            with self.assertRaises(ValueError):
                svc._validate_rel_path(long_path)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
