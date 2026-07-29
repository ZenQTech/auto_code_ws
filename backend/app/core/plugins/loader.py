"""
# ============================================================
# Hermes Plugin System - 加载器
# ============================================================
# 核心作用：从 Plugin 目录扫描、解析、加载所有 Plugin
# 特性：路径白名单、错误隔离、批量加载
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import Plugin, PluginManifest, PluginStatus, parse_manifest_file
from .exceptions import ManifestError

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单 - 防止任意目录访问
# ============================================================
ALLOWED_PATH_PATTERNS = [
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/home/qizheng/\.hermes/plugins"),
    re.compile(r"^/tmp/hermes-plugins"),
    re.compile(r"^/tmp/test-plugins"),
    re.compile(r"^/tmp/plugin_test_"),  # Plugin 测试临时目录
    re.compile(r"^/tmp/registry_test_"),  # Registry 测试临时目录
    re.compile(r"^/tmp/resolver_test_"),  # Resolver 测试临时目录
    re.compile(r"^/tmp/validator_test_"),  # Validator 测试临时目录
    re.compile(r"^/tmp/install_test_"),  # Installer 测试临时目录
    re.compile(r"^/tmp/source_test_"),  # Installer 源测试目录
    re.compile(r"^/tmp/lifecycle_test_"),  # Lifecycle 测试临时目录
    re.compile(r"^/tmp/e2e_plugin_"),  # E2E 测试临时目录
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
]


def is_path_allowed(path: str) -> bool:
    """检查路径是否在白名单内"""
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_PATH_PATTERNS:
        if pattern.match(path_str):
            return True
    return False


class PluginLoader:
    """
    Plugin 加载器
    负责从目录扫描所有 Plugin 并解析 manifest
    """

    # 默认扫描目录
    DEFAULT_PLUGINS_DIRS = [
        Path(".trae/plugins/official"),
        Path(".trae/plugins/community"),
        Path(".trae/plugins/personal"),
    ]

    def __init__(self, base_dirs: Optional[List[Path]] = None) -> None:
        """初始化加载器"""
        self.base_dirs = base_dirs or self.DEFAULT_PLUGINS_DIRS
        self._loaded: Dict[str, Plugin] = {}
        self._load_history: List[Dict[str, Any]] = []

    def add_base_dir(self, path: Path) -> None:
        """添加扫描目录"""
        if path not in self.base_dirs:
            self.base_dirs.append(path)

    def scan_directory(self, dir_path: Path) -> List[Plugin]:
        """
        扫描单个目录，解析所有 Plugin
        返回加载成功的 Plugin 列表
        """
        if not dir_path.exists():
            logger.debug(f"Plugin directory does not exist: {dir_path}")
            return []

        plugins: List[Plugin] = []
        # 遍历子目录
        for child in dir_path.iterdir():
            if not child.is_dir():
                continue
            # 跳过以 _ 开头的隐藏目录（如 _template）
            if child.name.startswith("_") or child.name.startswith("."):
                logger.debug(f"Skipping hidden/template dir: {child}")
                continue
            # 解析 manifest.json
            manifest_path = child / "manifest.json"
            if not manifest_path.exists():
                logger.debug(f"No manifest.json in {child}, skipping")
                continue
            try:
                plugin = self._load_plugin(child, manifest_path)
                if plugin:
                    plugins.append(plugin)
            except Exception as e:
                logger.error(f"Failed to load plugin from {child}: {e}")
                # 记录失败的 Plugin
                failed = Plugin(
                    manifest=PluginManifest(
                        id=child.name,
                        name=child.name,
                        version="0.0.0",
                        description=f"Failed to load: {e}",
                        author={"name": "unknown"},
                    ),
                    base_path=child,
                    status=PluginStatus.ERROR,
                    error_message=str(e),
                )
                plugins.append(failed)
        return plugins

    def _load_plugin(self, plugin_dir: Path, manifest_path: Path) -> Optional[Plugin]:
        """加载单个 Plugin"""
        # 路径安全检查
        if not is_path_allowed(str(plugin_dir)):
            raise ManifestError(str(manifest_path), f"Path not in whitelist: {plugin_dir}")
        # 解析 manifest
        try:
            manifest = parse_manifest_file(manifest_path)
        except (FileNotFoundError, ValueError) as e:
            raise ManifestError(str(manifest_path), str(e))
        # 验证 manifest
        errors = manifest.validate()
        if errors:
            error_msg = "; ".join(errors)
            raise ManifestError(str(manifest_path), error_msg)
        # 构建 Plugin 对象
        plugin = Plugin(
            manifest=manifest,
            base_path=plugin_dir,
            status=PluginStatus.AVAILABLE,
            installed_at=datetime.now(timezone.utc).isoformat(),
        )
        # 记录加载历史
        self._load_history.append({
            "plugin_id": manifest.id,
            "path": str(plugin_dir),
            "loaded_at": datetime.now(timezone.utc).isoformat(),
            "status": "success",
        })
        logger.info(f"Loaded plugin: {manifest.id} v{manifest.version} from {plugin_dir}")
        return plugin

    def scan_all(self) -> List[Plugin]:
        """
        扫描所有配置的目录
        返回所有已加载的 Plugin（去重）
        """
        all_plugins: Dict[str, Plugin] = {}
        for base_dir in self.base_dirs:
            base_dir = Path(base_dir)
            if not base_dir.exists():
                continue
            try:
                plugins = self.scan_directory(base_dir)
                for plugin in plugins:
                    # 同 ID 后加载的覆盖先加载的
                    all_plugins[plugin.manifest.id] = plugin
            except Exception as e:
                logger.error(f"Failed to scan {base_dir}: {e}")
        return list(all_plugins.values())

    def load_from_path(self, plugin_dir: Path) -> Plugin:
        """从指定路径加载单个 Plugin"""
        plugin_dir = Path(plugin_dir).resolve()
        if not plugin_dir.exists():
            raise ManifestError(str(plugin_dir), "Directory does not exist")
        manifest_path = plugin_dir / "manifest.json"
        if not manifest_path.exists():
            raise ManifestError(str(plugin_path) if False else str(manifest_path), "manifest.json not found")
        plugin = self._load_plugin(plugin_dir, manifest_path)
        if not plugin:
            raise ManifestError(str(manifest_path), "Failed to load plugin")
        return plugin

    def get_load_history(self) -> List[Dict[str, Any]]:
        """获取加载历史"""
        return self._load_history

    def clear_history(self) -> None:
        """清空加载历史"""
        self._load_history.clear()


# ============================================================
# 全局单例
# ============================================================
_loader_instance: Optional[PluginLoader] = None


def get_loader() -> PluginLoader:
    """获取全局 PluginLoader 单例"""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = PluginLoader()
    return _loader_instance
