"""
# ============================================================
# AGENTS.md Multi-Level Resolver (v1.0.0)
# Cycle 70 G70-01 - 对标 Codex CLI v0.124.0+ 多层级发现机制
# ============================================================
# 核心作用：实现 Codex 风格的 AGENTS.md 多层级发现 + override + 字节限制
# 设计要点：
#   1. 全局作用域：~/.hermes/AGENTS.override.md → AGENTS.md
#   2. 项目作用域：从项目根 → CWD 依次遍历每个目录
#   3. 字节限制：project_doc_max_bytes（默认 32 KiB）
#   4. Override 机制：AGENTS.override.md 完全替换同目录的 AGENTS.md
#   5. Fallback 文件名：AGENTS.md 缺失时使用 fallback_filenames
#   6. 项目根检测：基于 project_root_markers（.git 等）
#   7. 注入点：developer_instructions 在所有 AGENTS.md 之前
#   8. 完全替换：model_instructions_file 替换所有内置基础
# 运行流程：
#   加载配置 → 检测项目根 → 全局扫描 → 项目遍历 → 字节限制 → 拼接输出
# 输入参数：cwd, config
# 输出结果：ResolvedAgentsMd（含 layers + merged_content）
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
# ============================================================
"""

import hashlib
import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 常量与默认配置
# ============================================================

# 默认全局路径（按优先级）
DEFAULT_GLOBAL_PATHS = [
    "~/.hermes/AGENTS.override.md",
    "~/.hermes/AGENTS.md",
]

# 默认 fallback 文件名
DEFAULT_FALLBACK_FILENAMES = ["AGENTS.md", "TEAM_GUIDE.md", ".agents.md"]

# 默认项目根标记
DEFAULT_PROJECT_ROOT_MARKERS = [".git", ".hg", ".svn"]

# 默认最大字节数（Codex 标准：32 KiB）
DEFAULT_MAX_BYTES = 32 * 1024

# 默认最大扫描深度
DEFAULT_MAX_DEPTH = 10

# 单个文件最大字节数（5 MB）
MAX_FILE_SIZE = 5 * 1024 * 1024

# 安全白名单：允许的 AGENTS.md 根目录
ALLOWED_ROOTS = [
    "~/.hermes",
    "/etc/hermes",
]

# 排除目录
EXCLUDE_DIRS = {
    ".git", "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", ".tox", ".pytest_cache",
    ".mypy_cache", "target", ".gradle",
}


# ============================================================
# 数据模型
# ============================================================

@dataclass
class AgentsMdConfig:
    """AGENTS.md 多层级解析配置

    字段：
      - max_bytes: 总字节数上限（Codex 默认 32 KiB）
      - max_depth: 目录遍历深度上限
      - fallback_filenames: AGENTS.md 缺失时的备选文件名
      - project_root_markers: 项目根检测标记
      - developer_instructions: 注入到所有 AGENTS.md 之前的指令
      - model_instructions_file: 完全替换内置基础指令的文件路径
      - global_paths: 全局 AGENTS.md 候选路径（按优先级）
    """
    max_bytes: int = DEFAULT_MAX_BYTES
    max_depth: int = DEFAULT_MAX_DEPTH
    fallback_filenames: List[str] = field(default_factory=lambda: list(DEFAULT_FALLBACK_FILENAMES))
    project_root_markers: List[str] = field(default_factory=lambda: list(DEFAULT_PROJECT_ROOT_MARKERS))
    developer_instructions: str = ""
    model_instructions_file: Optional[str] = None
    global_paths: List[str] = field(default_factory=lambda: list(DEFAULT_GLOBAL_PATHS))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentsMdConfig":
        return cls(
            max_bytes=int(data.get("max_bytes", DEFAULT_MAX_BYTES)),
            max_depth=int(data.get("max_depth", DEFAULT_MAX_DEPTH)),
            fallback_filenames=list(data.get("fallback_filenames", DEFAULT_FALLBACK_FILENAMES)),
            project_root_markers=list(data.get("project_root_markers", DEFAULT_PROJECT_ROOT_MARKERS)),
            developer_instructions=str(data.get("developer_instructions", "")),
            model_instructions_file=data.get("model_instructions_file"),
            global_paths=list(data.get("global_paths", DEFAULT_GLOBAL_PATHS)),
        )


@dataclass
class AgentsMdLayer:
    """单个 AGENTS.md 层级

    字段：
      - scope: 作用域（developer/global/project/subdir/model）
      - relative_path: 相对路径（None 表示内联）
      - absolute_path: 绝对路径
      - content: 内容（可能被截断）
      - size: 字节数
      - truncated: 是否被截断
      - is_override: 是否为 override 文件
    """
    scope: str
    relative_path: Optional[str]
    absolute_path: Optional[str]
    content: str
    size: int
    truncated: bool = False
    is_override: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scope": self.scope,
            "relative_path": self.relative_path,
            "absolute_path": self.absolute_path,
            "content": self.content,
            "size": self.size,
            "truncated": self.truncated,
            "is_override": self.is_override,
        }


@dataclass
class ResolvedAgentsMd:
    """完整解析结果

    字段：
      - layers: 按拼接顺序排列的层级列表
      - total_bytes: 累计字节数
      - max_bytes: 配置上限
      - truncated_at: 被截断的层级索引（None 表示未截断）
      - project_root: 检测到的项目根
      - cwd: 当前工作目录
      - merged_content: 拼接后的完整内容
    """
    layers: List[AgentsMdLayer]
    total_bytes: int
    max_bytes: int
    truncated_at: Optional[int]
    project_root: Optional[str]
    cwd: str
    merged_content: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "layers": [layer.to_dict() for layer in self.layers],
            "total_bytes": self.total_bytes,
            "max_bytes": self.max_bytes,
            "truncated_at": self.truncated_at,
            "project_root": self.project_root,
            "cwd": self.cwd,
            "merged_content": self.merged_content,
        }


# ============================================================
# 工具函数
# ============================================================

def _is_path_safe(path: Path, base: Optional[Path] = None) -> bool:
    """检查路径是否安全（无路径遍历）

    参数：
      - path: 待检查路径
      - base: 基准路径（None 表示使用 ALLOWED_ROOTS）
    返回值：True 表示安全
    """
    # 先 expanduser 处理 ~ 路径，再 resolve
    try:
        expanded = path.expanduser()
        resolved = expanded.resolve()
    except (OSError, RuntimeError):
        return False

    # 拒绝 .. 路径
    if ".." in expanded.parts:
        return False

    if base is not None:
        try:
            resolved.relative_to(base.expanduser().resolve())
        except (ValueError, OSError, RuntimeError):
            return False
        return True

    # 默认检查是否在 ALLOWED_ROOTS 内
    if not ALLOWED_ROOTS:
        return True
    for allowed in ALLOWED_ROOTS:
        try:
            allowed_path = Path(allowed).expanduser().resolve()
            resolved.relative_to(allowed_path)
            return True
        except (ValueError, OSError, RuntimeError):
            continue
    return False


def _truncate_to_budget(content: str, budget: int) -> Tuple[str, bool]:
    """按字节预算截断内容（UTF-8 安全）

    参数：
      - content: 原始内容
      - budget: 字节预算
    返回值：(截断后内容, 是否被截断)
    """
    if budget <= 0:
        return "", True
    encoded = content.encode("utf-8")
    if len(encoded) <= budget:
        return content, False
    truncated = encoded[:budget].decode("utf-8", errors="ignore")
    return truncated, True


def _content_hash(content: str) -> str:
    """计算内容 SHA-256 哈希"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _read_safely(path: Path) -> Optional[str]:
    """安全读取文件内容

    返回值：文件内容（UTF-8）；None 表示失败
    """
    try:
        if not path.exists() or not path.is_file():
            return None
        # 拒绝符号链接
        if path.is_symlink():
            return None
        stat = path.stat()
        if stat.st_size > MAX_FILE_SIZE:
            logger.warning(f"AGENTS.md 太大，跳过: {path} ({stat.st_size} bytes)")
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        logger.warning(f"读取 AGENTS.md 失败: {path}: {e}")
        return None


# ============================================================
# 主服务类
# ============================================================

class AgentsMdResolver:
    """AGENTS.md 多层级解析器（Codex 风格）

    特性：
      - 多层级发现（global → project → CWD）
      - Override 替换机制
      - 字节限制
      - 项目根检测
      - 线程安全
      - 持久化配置
      - LRU 缓存

    时间复杂度：O(N * D + B)
      - N = 目录数
      - D = 每个文件读取字节数
      - B = 字节限制下界

    空间复杂度：O(N * D)
    """

    CONFIG_PATH = Path("~/.hermes/config/agents_md.json").expanduser()

    def __init__(self):
        self._config: AgentsMdConfig = AgentsMdConfig()
        self._cache: Dict[str, ResolvedAgentsMd] = {}
        self._cache_lock = threading.Lock()
        self._config_lock = threading.Lock()
        # 加载持久化配置
        self._load_config()
        logger.info(
            f"AgentsMdResolver 初始化完成 "
            f"(max_bytes={self._config.max_bytes}, max_depth={self._config.max_depth})"
        )

    # ============================================================
    # 配置管理
    # ============================================================

    def get_config(self) -> AgentsMdConfig:
        """获取当前配置"""
        with self._config_lock:
            return self._config

    def update_config(self, updates: Dict[str, Any]) -> AgentsMdConfig:
        """更新配置（部分字段）

        参数：
          - updates: 待更新字段
        返回值：更新后的配置
        """
        with self._config_lock:
            current = self._config.to_dict()
            current.update({k: v for k, v in updates.items() if v is not None})
            self._config = AgentsMdConfig.from_dict(current)
            self._save_config()
            # 失效缓存
            with self._cache_lock:
                self._cache.clear()
            return self._config

    def _load_config(self):
        """从磁盘加载配置"""
        try:
            if self.CONFIG_PATH.exists():
                data = json.loads(self.CONFIG_PATH.read_text(encoding="utf-8"))
                self._config = AgentsMdConfig.from_dict(data)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"加载 AGENTS.md 配置失败: {e}")

    def _save_config(self):
        """持久化配置到磁盘"""
        try:
            self.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.CONFIG_PATH.write_text(
                json.dumps(self._config.to_dict(), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"保存 AGENTS.md 配置失败: {e}")

    # ============================================================
    # 项目根检测
    # ============================================================

    def detect_project_root(
        self,
        cwd: str,
        markers: Optional[List[str]] = None,
    ) -> Tuple[Optional[str], Optional[str]]:
        """从 cwd 向上查找项目根

        算法：
          1. 从 cwd 开始向上遍历每个父目录
          2. 检查是否包含任一 marker（默认 .git）
          3. 找到第一个包含 marker 的目录作为项目根
          4. 到达文件系统根仍未找到 → 返回 (None, None)

        参数：
          - cwd: 当前工作目录
          - markers: 项目根标记列表（None 使用配置默认值）
        返回值：(project_root, matched_marker)

        时间复杂度：O(D)
          - D = 目录深度
        """
        if markers is None:
            markers = self._config.project_root_markers

        current = Path(cwd).expanduser().resolve()
        if not current.exists() or not current.is_dir():
            return None, None

        # 防御性：检测过深时停止
        max_iter = 64
        for _ in range(max_iter):
            for marker in markers:
                if (current / marker).exists():
                    return str(current), marker
            parent = current.parent
            if parent == current:
                # 已到达文件系统根
                return None, None
            current = parent
        return None, None

    # ============================================================
    # 路径遍历
    # ============================================================

    def _walk_from_root_to_cwd(
        self,
        project_root: Path,
        cwd: Path,
        max_depth: int,
    ) -> List[Path]:
        """从项目根到 CWD 的目录列表

        算法：
          1. 计算 cwd 相对 project_root 的路径
          2. 逐级拼接，生成 [project_root, project_root/level1, ..., cwd]
          3. 过滤 EXCLUDE_DIRS

        返回值：目录路径列表（不含 EXCLUDE_DIRS 中的目录）
        """
        try:
            rel = cwd.relative_to(project_root)
        except ValueError:
            # cwd 不在 project_root 下
            return [project_root]

        result = [project_root]
        current = project_root
        for part in rel.parts:
            current = current / part
            if current.name in EXCLUDE_DIRS:
                # 跳过此层
                continue
            result.append(current)
            # 深度限制
            if len(result) > max_depth + 1:
                break
        return result

    # ============================================================
    # 加载逻辑
    # ============================================================

    def _load_from_dir(
        self,
        directory: Path,
        fallback_filenames: List[str],
    ) -> Tuple[Optional[AgentsMdLayer], Optional[Path]]:
        """从单个目录加载 AGENTS.md

        加载顺序：
          1. 优先检查 override 文件（AGENTS.override.md）
          2. 加载主 AGENTS.md
          3. 按 fallback_filenames 顺序加载第一个存在的

        参数：
          - directory: 目录路径
          - fallback_filenames: 备选文件名
        返回值：(layer, absolute_path) 或 (None, None)
        """
        # 1. 检查 override
        override_path = directory / "AGENTS.override.md"
        if override_path.exists() and override_path.is_file():
            content = _read_safely(override_path)
            if content is not None:
                size = len(content.encode("utf-8"))
                return AgentsMdLayer(
                    scope="subdir",
                    relative_path=str(override_path.name),
                    absolute_path=str(override_path),
                    content=content,
                    size=size,
                    truncated=False,
                    is_override=True,
                ), override_path

        # 2. 主文件名
        for filename in fallback_filenames:
            file_path = directory / filename
            if file_path.exists() and file_path.is_file():
                content = _read_safely(file_path)
                if content is not None:
                    size = len(content.encode("utf-8"))
                    return AgentsMdLayer(
                        scope="subdir",
                        relative_path=filename,
                        absolute_path=str(file_path),
                        content=content,
                        size=size,
                        truncated=False,
                        is_override=False,
                    ), file_path

        return None, None

    def _load_global_layers(
        self,
        global_paths: List[str],
        budget: int,
    ) -> Tuple[List[AgentsMdLayer], int]:
        """加载全局 AGENTS.md

        算法：
          1. 按顺序尝试每个 global_paths
          2. 第一个存在的文件被加载
          3. 后续文件被忽略（global 只有一个有效文件）

        返回值：(layers, total_bytes)
        """
        layers = []
        used = 0

        for path_str in global_paths:
            if used >= budget:
                break
            path = Path(path_str).expanduser()
            # 安全检查
            if not _is_path_safe(path):
                logger.warning(f"Global AGENTS.md 路径不安全，跳过: {path}")
                continue
            if not path.exists() or not path.is_file():
                continue
            content = _read_safely(path)
            if content is None:
                continue
            size = len(content.encode("utf-8"))
            truncated_content, is_truncated = _truncate_to_budget(content, budget - used)
            layers.append(AgentsMdLayer(
                scope="global",
                relative_path=str(path),
                absolute_path=str(path),
                content=truncated_content,
                size=size,
                truncated=is_truncated,
                is_override=path.name.endswith(".override.md"),
            ))
            used += len(truncated_content.encode("utf-8"))
            # global 只使用第一个非空文件
            break

        return layers, used

    # ============================================================
    # 主解析函数
    # ============================================================

    def resolve(
        self,
        cwd: str,
        config: Optional[AgentsMdConfig] = None,
        use_cache: bool = True,
    ) -> ResolvedAgentsMd:
        """解析给定 cwd 的 AGENTS.md 多层级拼接

        算法：
          1. 检测项目根
          2. 加载全局作用域
          3. developer_instructions 注入（顶层）
          4. 从项目根 → CWD 遍历每个目录
          5. 字节限制截断
          6. 拼接输出

        参数：
          - cwd: 当前工作目录
          - config: 临时配置（None 使用持久化配置）
          - use_cache: 是否使用缓存
        返回值：ResolvedAgentsMd
        """
        cfg = config or self._config
        cache_key = f"{cwd}|{hash(cfg.to_dict().__repr__())}"
        if use_cache:
            with self._cache_lock:
                if cache_key in self._cache:
                    return self._cache[cache_key]

        # 1. 检测项目根
        project_root_str, _ = self.detect_project_root(cwd, cfg.project_root_markers)
        project_root = Path(project_root_str) if project_root_str else None

        # 2. 完全替换模式：model_instructions_file
        if cfg.model_instructions_file:
            path = Path(cfg.model_instructions_file).expanduser()
            if _is_path_safe(path) and path.exists() and path.is_file():
                content = _read_safely(path)
                if content is not None:
                    size = len(content.encode("utf-8"))
                    layer = AgentsMdLayer(
                        scope="model",
                        relative_path=str(path),
                        absolute_path=str(path),
                        content=content,
                        size=size,
                        truncated=False,
                        is_override=False,
                    )
                    result = ResolvedAgentsMd(
                        layers=[layer],
                        total_bytes=size,
                        max_bytes=cfg.max_bytes,
                        truncated_at=None,
                        project_root=project_root_str,
                        cwd=cwd,
                        merged_content=content,
                    )
                    if use_cache:
                        with self._cache_lock:
                            self._cache[cache_key] = result
                    return result

        layers: List[AgentsMdLayer] = []
        used_bytes = 0
        truncated_at: Optional[int] = None

        # 3. developer_instructions 注入
        if cfg.developer_instructions:
            dev_content = cfg.developer_instructions
            dev_size = len(dev_content.encode("utf-8"))
            if dev_size <= cfg.max_bytes:
                layers.append(AgentsMdLayer(
                    scope="developer",
                    relative_path=None,
                    absolute_path=None,
                    content=dev_content,
                    size=dev_size,
                    truncated=False,
                    is_override=False,
                ))
                used_bytes += dev_size
            else:
                # developer_instructions 超出限制，截断
                truncated_dev, _ = _truncate_to_budget(dev_content, cfg.max_bytes)
                layers.append(AgentsMdLayer(
                    scope="developer",
                    relative_path=None,
                    absolute_path=None,
                    content=truncated_dev,
                    size=len(truncated_dev.encode("utf-8")),
                    truncated=True,
                    is_override=False,
                ))
                used_bytes += len(truncated_dev.encode("utf-8"))
                truncated_at = len(layers) - 1

        # 4. 加载全局
        global_layers, global_used = self._load_global_layers(
            cfg.global_paths,
            cfg.max_bytes - used_bytes,
        )
        for layer in global_layers:
            if used_bytes + layer.size > cfg.max_bytes:
                # 截断
                truncated_content, is_truncated = _truncate_to_budget(
                    layer.content,
                    cfg.max_bytes - used_bytes,
                )
                layer.content = truncated_content
                layer.size = len(truncated_content.encode("utf-8"))
                layer.truncated = True
                truncated_at = len(layers)
                used_bytes += layer.size
                layers.append(layer)
                break
            else:
                used_bytes += layer.size
                layers.append(layer)

        # 5. 项目作用域遍历
        if project_root is not None:
            cwd_path = Path(cwd).expanduser().resolve()
            try:
                directories = self._walk_from_root_to_cwd(
                    project_root, cwd_path, cfg.max_depth,
                )
            except (OSError, ValueError) as e:
                logger.warning(f"遍历目录失败: {e}")
                directories = [project_root]

            for directory in directories:
                if used_bytes >= cfg.max_bytes:
                    break
                # 跳过 EXCLUDE_DIRS
                if directory.name in EXCLUDE_DIRS:
                    continue

                layer, _ = self._load_from_dir(directory, cfg.fallback_filenames)
                if layer is None:
                    continue

                # 区分 project 和 subdir
                if directory == project_root:
                    layer.scope = "project"

                # 字节限制
                if used_bytes + layer.size > cfg.max_bytes:
                    remaining = cfg.max_bytes - used_bytes
                    truncated_content, is_truncated = _truncate_to_budget(
                        layer.content, remaining,
                    )
                    layer.content = truncated_content
                    layer.size = len(truncated_content.encode("utf-8"))
                    layer.truncated = True
                    truncated_at = len(layers)
                    used_bytes += layer.size
                    layers.append(layer)
                    break
                else:
                    used_bytes += layer.size
                    layers.append(layer)
        else:
            # 没有项目根，但仍尝试加载 cwd 自身
            cwd_path = Path(cwd).expanduser().resolve()
            if cwd_path.exists() and cwd_path.is_dir():
                if cwd_path.name not in EXCLUDE_DIRS:
                    layer, _ = self._load_from_dir(cwd_path, cfg.fallback_filenames)
                    if layer is not None:
                        if used_bytes + layer.size > cfg.max_bytes:
                            truncated_content, is_truncated = _truncate_to_budget(
                                layer.content, cfg.max_bytes - used_bytes,
                            )
                            layer.content = truncated_content
                            layer.size = len(truncated_content.encode("utf-8"))
                            layer.truncated = True
                            truncated_at = len(layers)
                            used_bytes += layer.size
                            layers.append(layer)
                        else:
                            used_bytes += layer.size
                            layers.append(layer)

        # 6. 拼接
        merged_parts = []
        for layer in layers:
            if layer.relative_path:
                merged_parts.append(f"## From: {layer.relative_path}\n\n{layer.content}")
            else:
                merged_parts.append(f"## {layer.scope.capitalize()} Instructions\n\n{layer.content}")
        merged_content = "\n\n---\n\n".join(merged_parts)

        result = ResolvedAgentsMd(
            layers=layers,
            total_bytes=used_bytes,
            max_bytes=cfg.max_bytes,
            truncated_at=truncated_at,
            project_root=project_root_str,
            cwd=cwd,
            merged_content=merged_content,
        )

        if use_cache:
            with self._cache_lock:
                # LRU 限制
                if len(self._cache) > 50:
                    # 简单 FIFO 淘汰
                    first_key = next(iter(self._cache))
                    del self._cache[first_key]
                self._cache[cache_key] = result

        return result

    def clear_cache(self):
        """清空缓存"""
        with self._cache_lock:
            self._cache.clear()


# ============================================================
# 单例
# ============================================================

_resolver_instance: Optional[AgentsMdResolver] = None
_resolver_lock = threading.Lock()


def get_agents_md_resolver() -> AgentsMdResolver:
    """获取全局单例

    返回值：AgentsMdResolver 实例
    """
    global _resolver_instance
    if _resolver_instance is None:
        with _resolver_lock:
            if _resolver_instance is None:
                _resolver_instance = AgentsMdResolver()
    return _resolver_instance
