"""
# ============================================================
# Hermes Plugin System - 安装器
# ============================================================
# 核心作用：Plugin 的安装、卸载、启用、禁用
# 特性：依赖检查、目录创建、原子操作
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import Plugin, PluginStatus
from .exceptions import (
    DependencyError,
    InstallError,
    PluginAlreadyExistsError,
    PluginNotFoundError,
)
from .loader import PluginLoader
from .registry import PluginRegistry
from .resolver import DependencyResolver
from .validator import PluginValidator

logger = logging.getLogger(__name__)


class PluginInstaller:
    """
    Plugin 安装器
    提供 install / uninstall / enable / disable / reload 等操作
    """

    def __init__(
        self,
        loader: Optional[PluginLoader] = None,
        registry: Optional[PluginRegistry] = None,
        resolver: Optional[DependencyResolver] = None,
        validator: Optional[PluginValidator] = None,
        install_dir: Optional[Path] = None,
    ) -> None:
        """
        初始化安装器
        install_dir: 目标安装目录（默认 .trae/plugins/personal/）
        """
        self.loader = loader or PluginLoader()
        self.registry = registry or PluginRegistry()
        self.resolver = resolver or DependencyResolver()
        self.validator = validator or PluginValidator()
        self.install_dir = install_dir or Path(".trae/plugins/personal")
        # 确保安装目录存在
        self.install_dir.mkdir(parents=True, exist_ok=True)

    def install(self, source_path: Path) -> Plugin:
        """
        从本地路径安装 Plugin
        1. 验证源路径
        2. 解析 manifest
        3. 验证 Plugin
        4. 复制到安装目录
        5. 注册到 Registry
        """
        source_path = Path(source_path).resolve()
        if not source_path.exists():
            raise InstallError(str(source_path), "Source path does not exist")
        if not source_path.is_dir():
            raise InstallError(str(source_path), "Source path must be a directory")
        # 验证路径
        if not self.validator.validate_path(str(source_path)):
            raise InstallError(str(source_path), "Path not in whitelist")
        # 加载 Plugin
        try:
            plugin = self.loader.load_from_path(source_path)
        except Exception as e:
            raise InstallError(str(source_path), f"Failed to load: {e}")
        # 验证 Plugin
        errors = self.validator.validate(plugin)
        if errors:
            raise InstallError(str(source_path), "; ".join(errors))
        # 检查是否已存在
        plugin_id = plugin.manifest.id
        if self.registry.get_optional(plugin_id):
            raise PluginAlreadyExistsError(plugin_id)
        # 复制到安装目录
        target_dir = self.install_dir / plugin_id
        if target_dir.exists():
            shutil.rmtree(target_dir)
        try:
            shutil.copytree(source_path, target_dir)
        except Exception as e:
            raise InstallError(str(source_path), f"Failed to copy: {e}")
        # 重新加载（从目标位置）
        try:
            plugin = self.loader.load_from_path(target_dir)
        except Exception as e:
            raise InstallError(str(target_dir), f"Failed to reload from target: {e}")
        # 解析依赖
        missing_deps = self._check_missing_deps(plugin)
        if missing_deps:
            # 回滚：删除已复制的目录
            shutil.rmtree(target_dir, ignore_errors=True)
            raise DependencyError(
                plugin_id=plugin_id,
                reason=f"Missing dependencies: {', '.join(missing_deps)}",
            )
        # 注册
        try:
            self.registry.register(plugin)
        except Exception as e:
            shutil.rmtree(target_dir, ignore_errors=True)
            raise
        # 更新安装时间
        plugin.installed_at = datetime.now(timezone.utc).isoformat()
        plugin.status = PluginStatus.INSTALLED
        logger.info(f"Installed plugin: {plugin_id} -> {target_dir}")
        return plugin

    def _check_missing_deps(self, plugin: Plugin) -> List[str]:
        """检查 Plugin 缺失的依赖"""
        missing = []
        for dep_id in plugin.manifest.dependencies.plugins:
            if not self.registry.get_optional(dep_id):
                # 检查是否在 loader 已扫描的列表中
                loaded_ids = {p.manifest.id for p in self.loader.scan_all()}
                if dep_id not in loaded_ids:
                    missing.append(dep_id)
        return missing

    def uninstall(self, plugin_id: str, remove_files: bool = True) -> None:
        """
        卸载 Plugin
        remove_files=True 时同时删除安装目录
        """
        plugin = self.registry.get_optional(plugin_id)
        if plugin is None:
            raise PluginNotFoundError(plugin_id)
        # 检查是否有其他 Plugin 依赖它
        dependents = self._find_dependents(plugin_id)
        if dependents:
            raise DependencyError(
                plugin_id=plugin_id,
                reason=f"Required by: {', '.join(dependents)}",
            )
        # 注销
        self.registry.unregister(plugin_id)
        # 删除文件
        if remove_files:
            target_dir = self.install_dir / plugin_id
            if target_dir.exists() and target_dir.is_relative_to(self.install_dir.resolve()):
                shutil.rmtree(target_dir, ignore_errors=True)
        logger.info(f"Uninstalled plugin: {plugin_id}")

    def _find_dependents(self, plugin_id: str) -> List[str]:
        """查找依赖此 Plugin 的其他 Plugin"""
        dependents = []
        for plugin in self.registry.list_all():
            if plugin_id in plugin.manifest.dependencies.plugins:
                dependents.append(plugin.manifest.id)
        return dependents

    def enable(self, plugin_id: str) -> Plugin:
        """启用 Plugin"""
        return self.registry.enable(plugin_id)

    def disable(self, plugin_id: str) -> Plugin:
        """禁用 Plugin"""
        return self.registry.disable(plugin_id)

    def reload(self, plugin_id: str) -> Plugin:
        """
        重新加载 Plugin
        从安装目录重新解析
        """
        old = self.registry.get_optional(plugin_id)
        if old is None:
            raise PluginNotFoundError(plugin_id)
        target_dir = self.install_dir / plugin_id
        if not target_dir.exists():
            raise InstallError(
                str(target_dir),
                "Plugin directory not found, cannot reload",
            )
        # 注销旧版本
        self.registry.unregister(plugin_id)
        # 加载新版本
        try:
            plugin = self.loader.load_from_path(target_dir)
        except Exception as e:
            # 失败时恢复旧版本
            self.registry.register(old)
            raise InstallError(str(target_dir), f"Failed to reload: {e}")
        # 重新注册
        self.registry.register(plugin)
        # 保留启用状态
        if old.enabled:
            self.registry.enable(plugin_id)
        logger.info(f"Reloaded plugin: {plugin_id}")
        return plugin

    def scan_and_register(self) -> int:
        """
        扫描所有目录并注册到 Registry
        返回新注册的 Plugin 数量
        """
        plugins = self.loader.scan_all()
        count = 0
        for plugin in plugins:
            if plugin.status == PluginStatus.ERROR:
                # 仍然注册（标记为错误状态）
                try:
                    self.registry.register(plugin, overwrite=True)
                    count += 1
                except Exception:
                    pass
                continue
            # 验证
            errors = self.validator.validate(plugin)
            if errors:
                plugin.error_message = "; ".join(errors)
                plugin.mark_error(plugin.error_message)
            # 注册
            try:
                self.registry.register(plugin, overwrite=True)
                count += 1
            except PluginAlreadyExistsError:
                # 已存在，更新
                try:
                    self.registry.register(plugin, overwrite=True)
                    count += 1
                except Exception as e:
                    logger.error(f"Failed to update plugin {plugin.manifest.id}: {e}")
            except Exception as e:
                logger.error(f"Failed to register plugin {plugin.manifest.id}: {e}")
        return count

    def get_stats(self) -> Dict[str, Any]:
        """获取安装器统计信息"""
        return {
            "install_dir": str(self.install_dir),
            "registry": self.registry.get_stats(),
        }


# ============================================================
# 全局单例
# ============================================================
_installer_instance: Optional[PluginInstaller] = None


def get_installer() -> PluginInstaller:
    """获取全局 PluginInstaller 单例"""
    global _installer_instance
    if _installer_instance is None:
        _installer_instance = PluginInstaller()
    return _installer_instance
