"""
# ============================================================
# FileStorage 服务 (v1.0.0)
# Cycle 66 G66-02
# ============================================================
# 核心作用：统一的文件读写与哈希计算服务，为 SnapshotStore 提供原子操作
# 运行流程：
#   1. read(path) → 字节内容（路径合法性校验后）
#   2. write(path, content) → 原子写（tmp 文件 + rename）
#   3. hash(content) → SHA-256 前 16 字符
#   4. is_within_allowed_root(path) → 路径白名单校验
# 设计要点：
#   - 路径遍历防护（拒绝 ../ 与绝对路径越权）
#   - 原子写（避免部分写入导致回退失败）
#   - 文件大小限制（默认 10MB）
#   - 编码处理（utf-8 优先，失败回退 latin-1）
# 输入参数：文件路径、字节内容
# 输出结果：字节内容 / 哈希值 / 布尔状态
# 对标：agent-rollback 文件 IO 层
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
# ====================================
"""

import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================


# 单文件最大 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024

# 哈希前缀长度（SHA-256 截断）
HASH_PREFIX_LEN = 16

# 默认允许的根目录前缀
DEFAULT_ALLOWED_PREFIXES: Tuple[str, ...] = (
    "/tmp",
    "/home",
    "/workspace",
    "/root",
    "/data",
)


# ============================================================
# 异常类型
# ============================================================


class FileStorageError(Exception):
    """文件存储基础异常"""
    pass


class PathNotAllowedError(FileStorageError):
    """路径不在白名单"""
    pass


class FileTooLargeError(FileStorageError):
    """文件超过大小限制"""
    pass


class FileNotFoundError(FileStorageError):
    """文件不存在"""
    pass


# ============================================================
# 工具函数
# ============================================================


def compute_hash(content: bytes) -> str:
    """
    计算内容寻址哈希（SHA-256 前 16 字符）
    时间复杂度：O(n)
    空间复杂度：O(1)
    """
    return hashlib.sha256(content).hexdigest()[:HASH_PREFIX_LEN]


def is_within_allowed_root(
    path: str,
    allowed_prefixes: Optional[Iterable[str]] = None,
) -> bool:
    """
    校验路径是否在白名单根目录内
    1. 拒绝空路径
    2. 解析为绝对路径
    3. 校验前缀匹配
    """
    if not path or not isinstance(path, str):
        return False
    prefixes = tuple(allowed_prefixes) if allowed_prefixes else DEFAULT_ALLOWED_PREFIXES
    try:
        abs_path = os.path.abspath(path)
    except (OSError, ValueError):
        return False
    for prefix in prefixes:
        if abs_path.startswith(prefix):
            return True
    return False


def has_path_traversal(path: str) -> bool:
    """检测路径遍历（../ 或符号链接越权）"""
    if not path:
        return False
    # 1. 检查是否以 .. 开头
    if path.startswith(".."):
        return True
    # 2. 检查规范化后是否包含 ..
    normalized = os.path.normpath(path)
    parts = normalized.split(os.sep)
    if ".." in parts:
        return True
    # 3. 显式检查 ../ 模式
    if "/../" in path or path.startswith("../") or path.endswith("/.."):
        return True
    return False


# ============================================================
# FileStorage 主类
# ============================================================


class FileStorage:
    """
    文件存储服务
    - 路径白名单校验
    - 原子写（tmp + rename）
    - 哈希计算
    - 文件大小限制
    """

    def __init__(
        self,
        allowed_prefixes: Optional[Iterable[str]] = None,
        max_file_size: int = MAX_FILE_SIZE,
    ):
        self._allowed_prefixes = (
            tuple(allowed_prefixes) if allowed_prefixes else DEFAULT_ALLOWED_PREFIXES
        )
        self._max_file_size = max_file_size

    # ============================================================
    # 路径校验
    # ============================================================

    def validate_path(self, path: str) -> str:
        """
        校验路径合法性，返回绝对路径
        抛出：PathNotAllowedError
        """
        if not path:
            raise PathNotAllowedError("路径为空")
        if has_path_traversal(path):
            raise PathNotAllowedError(f"路径遍历被拒绝: {path}")
        abs_path = os.path.abspath(path)
        if not is_within_allowed_root(abs_path, self._allowed_prefixes):
            raise PathNotAllowedError(
                f"路径越权: {abs_path}（允许前缀: {self._allowed_prefixes}）"
            )
        return abs_path

    # ============================================================
    # 读取
    # ============================================================

    def read(self, path: str) -> bytes:
        """
        读取文件字节
        抛出：FileNotFoundError, FileTooLargeError, PathNotAllowedError
        """
        abs_path = self.validate_path(path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"文件不存在: {abs_path}")
        size = os.path.getsize(abs_path)
        if size > self._max_file_size:
            raise FileTooLargeError(
                f"文件过大: {abs_path} ({size} > {self._max_file_size})"
            )
        with open(abs_path, "rb") as f:
            return f.read()

    def read_text(self, path: str, encoding: str = "utf-8") -> str:
        """读取文件文本（utf-8 优先，失败回退 latin-1）"""
        content = self.read(path)
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            return content.decode("latin-1")

    def exists(self, path: str) -> bool:
        """检查文件是否存在"""
        try:
            abs_path = self.validate_path(path)
        except PathNotAllowedError:
            return False
        return os.path.exists(abs_path)

    def size(self, path: str) -> int:
        """获取文件大小（不存在返回 0）"""
        try:
            abs_path = self.validate_path(path)
        except PathNotAllowedError:
            return 0
        if not os.path.exists(abs_path):
            return 0
        return os.path.getsize(abs_path)

    # ============================================================
    # 写入
    # ============================================================

    def write(self, path: str, content: bytes) -> str:
        """
        原子写：先写临时文件，再 rename
        返回写入后的绝对路径
        抛出：PathNotAllowedError
        """
        abs_path = self.validate_path(path)
        if len(content) > self._max_file_size:
            raise FileTooLargeError(
                f"内容过大: {len(content)} > {self._max_file_size}"
            )
        # 确保父目录存在
        parent = os.path.dirname(abs_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        # 原子写：tmp + rename
        dir_name = os.path.dirname(abs_path) or "."
        fd, tmp_path = tempfile.mkstemp(
            dir=dir_name, prefix=".tmp_", suffix=os.path.basename(abs_path)
        )
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, abs_path)
        except Exception:
            # 清理 tmp 文件
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise
        return abs_path

    def delete(self, path: str) -> bool:
        """
        删除文件
        返回：是否删除成功
        """
        try:
            abs_path = self.validate_path(path)
        except PathNotAllowedError:
            return False
        if not os.path.exists(abs_path):
            return False
        try:
            os.remove(abs_path)
            return True
        except OSError as e:
            logger.warning(f"删除文件失败: {abs_path}: {e}")
            return False

    # ============================================================
    # 哈希
    # ============================================================

    def hash_file(self, path: str) -> str:
        """
        计算文件内容的 SHA-256 前缀
        抛出：FileNotFoundError, PathNotAllowedError
        """
        return compute_hash(self.read(path))

    def hash_content(self, content: bytes) -> str:
        """计算字节内容的哈希"""
        return compute_hash(content)

    # ============================================================
    # 批量操作
    # ============================================================

    def read_many(self, paths: List[str]) -> List[Tuple[str, bytes]]:
        """
        批量读取文件
        返回：(path, content) 元组列表
        跳过校验失败的文件
        """
        results: List[Tuple[str, bytes]] = []
        for path in paths:
            try:
                content = self.read(path)
                results.append((path, content))
            except (FileNotFoundError, PathNotAllowedError, FileTooLargeError) as e:
                logger.debug(f"跳过文件 {path}: {e}")
        return results

    def get_stats(self) -> dict:
        """返回存储配置统计"""
        return {
            "max_file_size": self._max_file_size,
            "allowed_prefixes": list(self._allowed_prefixes),
        }


# ============================================================
# 全局单例
# ============================================================


_file_storage: Optional[FileStorage] = None


def get_file_storage() -> FileStorage:
    """获取全局 FileStorage 实例"""
    global _file_storage
    if _file_storage is None:
        _file_storage = FileStorage()
    return _file_storage


def reset_file_storage() -> None:
    """重置全局实例（仅测试）"""
    global _file_storage
    _file_storage = None
