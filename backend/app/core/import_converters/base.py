"""
# ============================================================
# Import Converters - 基础抽象类
# ============================================================
# 核心作用：定义跨平台配置转换器的统一接口
# 关联：
#   - 上游: backend/app/services/import_service.py
#   - 下游: claude_code.py / cursor.py / codex.py / trae.py
# 输入参数：无（抽象类）
# 输出结果：4 个具体转换器继承此接口
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
import os
import re
import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ============================================================
# 枚举与数据类
# ============================================================


class ImportSource(str, Enum):
    """数据源平台枚举"""
    CLAUDE_CODE = "claude_code"
    CURSOR = "cursor"
    CODEX = "codex"
    TRAE = "trae"


class DataType(str, Enum):
    """数据类型枚举"""
    SETTINGS = "settings"
    MCP_SERVERS = "mcp_servers"
    PLUGINS = "plugins"
    SESSIONS = "sessions"
    COMMANDS = "commands"
    MEMORIES = "memories"


# 路径白名单（4 个源 + Hermes 目标 + 测试路径）
ALLOWED_SOURCE_PATHS = [
    Path.home() / ".claude",
    Path.home() / ".cursor",
    Path.home() / ".codex",
    Path.home() / ".trae",
    Path("/home/qizheng/auto_code_ws/.claude"),
    Path("/home/qizheng/auto_code_ws/.cursor"),
    Path("/home/qizheng/auto_code_ws/.codex"),
    Path("/home/qizheng/auto_code_ws/.trae"),
    # 测试路径（用于单元测试 + E2E 测试）
    Path("/tmp/test-import-sources"),
    Path("/tmp/test-claude-code"),
    Path("/tmp/test-cursor"),
    Path("/tmp/test-codex"),
    Path("/tmp/test-trae"),
]

# 文件大小限制
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_TASK_SIZE = 200 * 1024 * 1024  # 200 MB per task

# 敏感信息字段（迁移时脱敏）
SENSITIVE_KEYS = [
    "api_key", "apikey", "api-key",
    "token", "access_token", "refresh_token", "bearer_token",
    "password", "passwd", "secret",
    "private_key", "client_secret",
]


@dataclass
class DetectedSource:
    """检测到的数据源"""
    source: ImportSource
    install_path: str
    available: bool
    version: Optional[str] = None
    data_types: List[DataType] = field(default_factory=list)
    size_bytes: int = 0
    last_modified: Optional[str] = None
    error: Optional[str] = None


@dataclass
class ImportPreviewItem:
    """预览项"""
    source: ImportSource
    data_type: DataType
    source_path: str
    target_path: str
    size_bytes: int
    item_count: int = 1
    conflicts: List[str] = field(default_factory=list)
    transform_notes: List[str] = field(default_factory=list)
    error: Optional[str] = None


# ============================================================
# 工具函数
# ============================================================


def _is_path_allowed(path: Path) -> bool:
    """校验路径在白名单内

    Args:
        path: 待校验路径

    Returns:
        True 允许 / False 拒绝
    """
    abs_path = path.resolve()
    path_str = str(abs_path)

    # 路径前缀检查（精确）
    for allowed in ALLOWED_SOURCE_PATHS:
        try:
            allowed_resolved = allowed.resolve()
            if abs_path == allowed_resolved or \
               abs_path.is_relative_to(allowed_resolved):
                return True
        except (ValueError, OSError):
            continue

    # 测试模式：/tmp 下以 test-import / test-claude / test-cursor / test-codex / test-trae 开头
    if path_str.startswith("/tmp/test-import-") or \
       path_str.startswith("/tmp/test-claude") or \
       path_str.startswith("/tmp/test-cursor") or \
       path_str.startswith("/tmp/test-codex") or \
       path_str.startswith("/tmp/test-trae"):
        return True

    return False


def _redact_sensitive(data: Any) -> Any:
    """递归脱敏敏感字段

    Args:
        data: 任意数据结构

    Returns:
        脱敏后的数据
    """
    if isinstance(data, dict):
        result = {}
        for k, v in data.items():
            if any(s in k.lower() for s in SENSITIVE_KEYS):
                if isinstance(v, str) and len(v) > 8:
                    result[k] = f"{v[:4]}***{v[-4:]}"
                else:
                    result[k] = "***REDACTED***"
            else:
                result[k] = _redact_sensitive(v)
        return result
    elif isinstance(data, list):
        return [_redact_sensitive(item) for item in data]
    return data


def _validate_file_size(path: Path) -> Tuple[bool, int]:
    """校验文件大小

    Args:
        path: 文件路径

    Returns:
        (is_valid, size_bytes)
    """
    if not path.exists():
        return False, 0
    size = path.stat().st_size
    return size <= MAX_FILE_SIZE, size


def _safe_read_json(path: Path) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """安全读取 JSON 文件

    Args:
        path: 文件路径

    Returns:
        (data, error)
    """
    if not path.exists():
        return None, f"file not found: {path}"

    valid, size = _validate_file_size(path)
    if not valid:
        return None, f"file too large: {size} bytes (max {MAX_FILE_SIZE})"

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data, None
    except json.JSONDecodeError as e:
        return None, f"invalid JSON: {e}"
    except (OSError, UnicodeDecodeError) as e:
        return None, f"read error: {e}"


def _safe_read_text(path: Path) -> Tuple[Optional[str], Optional[str]]:
    """安全读取文本文件

    Args:
        path: 文件路径

    Returns:
        (content, error)
    """
    if not path.exists():
        return None, f"file not found: {path}"

    valid, size = _validate_file_size(path)
    if not valid:
        return None, f"file too large: {size} bytes"

    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read(), None
    except (OSError, UnicodeDecodeError) as e:
        return None, f"read error: {e}"


def _get_dir_size(path: Path) -> int:
    """计算目录大小

    Args:
        path: 目录路径

    Returns:
        总字节数
    """
    total = 0
    try:
        for item in path.rglob("*"):
            if item.is_file():
                total += item.stat().st_size
    except (OSError, PermissionError):
        pass
    return total


def _get_last_modified(path: Path) -> Optional[str]:
    """获取最后修改时间

    Args:
        path: 文件或目录路径

    Returns:
        ISO 格式时间字符串
    """
    try:
        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime).isoformat()
    except (OSError, FileNotFoundError):
        return None


def _safe_name(name: str) -> str:
    """安全化名称（去除非法字符，保留路径分隔符）

    Args:
        name: 原始名称

    Returns:
        安全化后的名称
    """
    s = str(name)
    # 先按路径分隔符拆分，逐段处理
    parts = s.replace("\\", "/").split("/")
    safe_parts = [re.sub(r"[^a-zA-Z0-9._\-]", "_", p) for p in parts]
    return "/".join(safe_parts)


# ============================================================
# 转换器抽象基类
# ============================================================


class BaseConverter(ABC):
    """格式转换器基类

    所有跨平台数据源转换器继承此类，实现统一的检测/预览/转换接口。
    """

    def __init__(self, source: ImportSource):
        self.source = source
        self.install_path = self._default_install_path()

    @abstractmethod
    def _default_install_path(self) -> Path:
        """默认安装路径"""
        raise NotImplementedError

    @abstractmethod
    def detect(self) -> DetectedSource:
        """检测该源是否安装

        Returns:
            DetectedSource 对象，包含 available/version/data_types 等
        """
        raise NotImplementedError

    @abstractmethod
    def list_data(self, data_type: DataType) -> List[ImportPreviewItem]:
        """列出该数据类型下的所有项

        Args:
            data_type: 数据类型

        Returns:
            预览项列表
        """
        raise NotImplementedError

    @abstractmethod
    def convert(self, data_type: DataType, source_path: Path) -> Tuple[Path, bytes]:
        """转换为 Hermes 格式

        Args:
            data_type: 数据类型
            source_path: 源文件路径

        Returns:
            (target_path, content_bytes)
        """
        raise NotImplementedError

    @abstractmethod
    def get_version(self) -> Optional[str]:
        """获取源 IDE 版本"""
        raise NotImplementedError

    def is_installed(self) -> bool:
        """是否已安装

        Returns:
            True 已安装 / False 未安装
        """
        return self.install_path.exists()

    def get_size(self) -> int:
        """获取安装目录大小

        Returns:
            字节数
        """
        if not self.is_installed():
            return 0
        return _get_dir_size(self.install_path)

    def safe_path(self, path: Path) -> bool:
        """校验路径安全

        Args:
            path: 待校验路径

        Returns:
            True 安全 / False 不安全
        """
        if not _is_path_allowed(path):
            return False
        return True
