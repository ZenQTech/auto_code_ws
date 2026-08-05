"""
# ============================================================
# FileStorage 单元测试
# Cycle 66 G66-02
# ============================================================
# 测试覆盖：
#   1. 路径白名单校验（白名单/黑名单/遍历防护）
#   2. 哈希计算（内容寻址）
#   3. 文件读取（正常/不存在/过大）
#   4. 文件写入（原子写/创建父目录）
#   5. 文件删除（存在/不存在）
#   6. 批量读取
#   7. 统计信息
# ====================================
"""

import os
import pytest
import tempfile
from pathlib import Path

from app.services.file_storage import (
    DEFAULT_ALLOWED_PREFIXES,
    FileNotFoundError,
    FileStorage,
    FileTooLargeError,
    MAX_FILE_SIZE,
    PathNotAllowedError,
    compute_hash,
    has_path_traversal,
    is_within_allowed_root,
    reset_file_storage,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def tmp_workspace(tmp_path):
    """创建临时工作目录"""
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    return workdir


@pytest.fixture
def storage(tmp_workspace):
    """创建 FileStorage 实例（仅允许 /tmp 路径）"""
    fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
    return fs


# ============================================================
# 工具函数测试
# ============================================================


class TestComputeHash:
    """compute_hash 测试"""

    def test_compute_hash_basic(self):
        h = compute_hash(b"hello world")
        assert isinstance(h, str)
        assert len(h) == 16
        # 相同内容应得到相同 hash
        assert compute_hash(b"hello world") == h

    def test_compute_hash_different(self):
        h1 = compute_hash(b"content A")
        h2 = compute_hash(b"content B")
        assert h1 != h2

    def test_compute_hash_empty(self):
        h = compute_hash(b"")
        assert len(h) == 16
        # SHA256("") = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        assert h == "e3b0c44298fc1c14"

    def test_compute_hash_unicode(self):
        h = compute_hash("你好".encode("utf-8"))
        assert len(h) == 16


class TestPathValidation:
    """路径校验测试"""

    def test_is_within_allowed_root_true(self):
        assert is_within_allowed_root("/tmp/foo/bar.py") is True
        assert is_within_allowed_root("/home/user/x.py") is True

    def test_is_within_allowed_root_false(self):
        assert is_within_allowed_root("/etc/passwd") is False
        assert is_within_allowed_root("/var/log/x.log") is False
        assert is_within_allowed_root("/boot/grub.cfg") is False

    def test_is_within_allowed_root_custom(self):
        assert is_within_allowed_root(
            "/data/x.py", allowed_prefixes=("/data",)
        ) is True
        assert is_within_allowed_root(
            "/home/x.py", allowed_prefixes=("/data",)
        ) is False

    def test_is_within_allowed_root_empty(self):
        assert is_within_allowed_root("") is False
        assert is_within_allowed_root(None) is False

    def test_has_path_traversal_true(self):
        assert has_path_traversal("../foo.py") is True
        assert has_path_traversal("/a/../b") is True
        assert has_path_traversal("..") is True
        assert has_path_traversal("/a/b/../../c") is True

    def test_has_path_traversal_false(self):
        assert has_path_traversal("/tmp/foo.py") is False
        assert has_path_traversal("/home/user/file.py") is False


# ============================================================
# FileStorage 路径校验
# ============================================================


class TestFileStoragePathValidation:
    """路径校验测试"""

    def test_validate_path_within_workspace(self, storage, tmp_workspace):
        test_file = tmp_workspace / "test.py"
        abs_path = storage.validate_path(str(test_file))
        assert abs_path == str(test_file.resolve())

    def test_validate_path_traversal_rejected(self, storage):
        with pytest.raises(PathNotAllowedError):
            storage.validate_path("../../../etc/passwd")

    def test_validate_path_empty_rejected(self, storage):
        with pytest.raises(PathNotAllowedError):
            storage.validate_path("")

    def test_validate_path_outside_workspace_rejected(self, tmp_workspace):
        # 不允许 /etc
        fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
        with pytest.raises(PathNotAllowedError):
            fs.validate_path("/etc/passwd")


# ============================================================
# FileStorage 读取
# ============================================================


class TestFileStorageRead:
    """读取测试"""

    def test_read_existing_file(self, storage, tmp_workspace):
        f = tmp_workspace / "data.txt"
        f.write_text("Hello world", encoding="utf-8")
        content = storage.read(str(f))
        assert content == b"Hello world"

    def test_read_nonexistent_file(self, storage, tmp_workspace):
        f = tmp_workspace / "missing.txt"
        with pytest.raises(FileNotFoundError):
            storage.read(str(f))

    def test_read_too_large(self, tmp_workspace):
        # 创建超大文件
        f = tmp_workspace / "big.bin"
        f.write_bytes(b"x" * 100)  # 100 bytes
        # 限制为 50 字节
        fs = FileStorage(
            allowed_prefixes=[str(tmp_workspace)],
            max_file_size=50,
        )
        with pytest.raises(FileTooLargeError):
            fs.read(str(f))

    def test_read_text_utf8(self, storage, tmp_workspace):
        f = tmp_workspace / "cn.txt"
        f.write_text("你好世界", encoding="utf-8")
        text = storage.read_text(str(f))
        assert text == "你好世界"

    def test_exists_true(self, storage, tmp_workspace):
        f = tmp_workspace / "exists.txt"
        f.write_text("x")
        assert storage.exists(str(f)) is True

    def test_exists_false(self, storage, tmp_workspace):
        f = tmp_workspace / "missing.txt"
        assert storage.exists(str(f)) is False

    def test_size_existing(self, storage, tmp_workspace):
        f = tmp_workspace / "data.bin"
        f.write_bytes(b"x" * 100)
        assert storage.size(str(f)) == 100

    def test_size_nonexistent(self, storage, tmp_workspace):
        f = tmp_workspace / "missing.bin"
        assert storage.size(str(f)) == 0


# ============================================================
# FileStorage 写入
# ============================================================


class TestFileStorageWrite:
    """写入测试"""

    def test_write_new_file(self, storage, tmp_workspace):
        f = tmp_workspace / "new.txt"
        path = storage.write(str(f), b"new content")
        assert os.path.exists(path)
        assert Path(path).read_bytes() == b"new content"

    def test_write_overwrite(self, storage, tmp_workspace):
        f = tmp_workspace / "over.txt"
        f.write_text("old")
        storage.write(str(f), b"new")
        assert f.read_bytes() == b"new"

    def test_write_creates_parent_dirs(self, storage, tmp_workspace):
        nested = tmp_workspace / "a" / "b" / "c.txt"
        path = storage.write(str(nested), b"deep")
        assert os.path.exists(path)

    def test_write_too_large_rejected(self, tmp_workspace):
        f = tmp_workspace / "big.bin"
        fs = FileStorage(
            allowed_prefixes=[str(tmp_workspace)],
            max_file_size=10,
        )
        with pytest.raises(FileTooLargeError):
            fs.write(str(f), b"x" * 100)

    def test_write_atomic_no_partial(self, storage, tmp_workspace):
        """原子写：即使写入失败也不应留下 .tmp_ 文件"""
        f = tmp_workspace / "atomic.txt"
        storage.write(str(f), b"data1")
        # 检查无 .tmp 残留
        tmp_files = list(tmp_workspace.glob(".tmp_*"))
        assert all(not p.name.startswith(".tmp_") for p in tmp_files)


# ============================================================
# FileStorage 删除
# ============================================================


class TestFileStorageDelete:
    """删除测试"""

    def test_delete_existing(self, storage, tmp_workspace):
        f = tmp_workspace / "todelete.txt"
        f.write_text("x")
        assert storage.delete(str(f)) is True
        assert not f.exists()

    def test_delete_nonexistent(self, storage, tmp_workspace):
        f = tmp_workspace / "missing.txt"
        assert storage.delete(str(f)) is False

    def test_delete_outside_workspace_rejected(self, tmp_workspace):
        fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
        assert fs.delete("/etc/passwd") is False


# ============================================================
# FileStorage 哈希
# ============================================================


class TestFileStorageHash:
    """哈希测试"""

    def test_hash_file(self, storage, tmp_workspace):
        f = tmp_workspace / "data.txt"
        f.write_text("hello")
        h = storage.hash_file(str(f))
        assert h == compute_hash(b"hello")

    def test_hash_content(self, storage):
        h1 = storage.hash_content(b"content")
        h2 = storage.hash_content(b"content")
        assert h1 == h2
        assert storage.hash_content(b"other") != h1


# ============================================================
# FileStorage 批量读取
# ============================================================


class TestFileStorageBatchRead:
    """批量读取测试"""

    def test_read_many_all_exist(self, storage, tmp_workspace):
        files = []
        for i in range(3):
            f = tmp_workspace / f"f{i}.txt"
            f.write_text(f"content{i}")
            files.append(str(f))
        results = storage.read_many(files)
        assert len(results) == 3
        for path, content in results:
            assert isinstance(content, bytes)

    def test_read_many_skip_missing(self, storage, tmp_workspace):
        f1 = tmp_workspace / "exists.txt"
        f1.write_text("x")
        f2 = tmp_workspace / "missing.txt"
        results = storage.read_many([str(f1), str(f2)])
        assert len(results) == 1  # 只返回存在的

    def test_read_many_empty(self, storage):
        results = storage.read_many([])
        assert results == []


# ============================================================
# FileStorage 统计
# ============================================================


class TestFileStorageStats:
    """统计测试"""

    def test_get_stats(self, storage):
        stats = storage.get_stats()
        assert "max_file_size" in stats
        assert "allowed_prefixes" in stats
        assert stats["max_file_size"] == MAX_FILE_SIZE


# ============================================================
# 全局单例
# ============================================================


class TestGlobalInstance:
    """全局单例测试"""

    def test_get_file_storage_singleton(self):
        from app.services.file_storage import get_file_storage
        s1 = get_file_storage()
        s2 = get_file_storage()
        assert s1 is s2

    def test_reset_file_storage(self):
        from app.services.file_storage import get_file_storage
        reset_file_storage()
        s1 = get_file_storage()
        reset_file_storage()
        s2 = get_file_storage()
        assert s1 is not s2


# ============================================================
# 默认常量
# ============================================================


class TestDefaults:
    """默认值测试"""

    def test_default_allowed_prefixes(self):
        assert "/tmp" in DEFAULT_ALLOWED_PREFIXES
        assert "/home" in DEFAULT_ALLOWED_PREFIXES

    def test_max_file_size(self):
        assert MAX_FILE_SIZE == 10 * 1024 * 1024
