"""
# ============================================================
# Hermes Plugin System - 入口模块
# ============================================================
# 核心作用：暴露 Plugin 系统的主要 API
# 特性：全局单例、便捷函数、向后兼容
# Cycle 12 P0-1 新建
# Cycle 13 P1-1 新增 Marketplace
# ============================================================
"""

from .base import (
    ComponentType,
    Plugin,
    PluginAuthor,
    PluginComponents,
    PluginDependencies,
    PluginManifest,
    PluginPermissions,
    PluginRepository,
    PluginStatus,
    PluginVerification,
    parse_manifest_file,
    semver_compare,
)
from .exceptions import (
    CircularDependencyError,
    ComponentNotFoundError,
    DependencyError,
    InstallError,
    ManifestError,
    ManifestValidationError,
    PermissionError,
    PluginAlreadyExistsError,
    PluginError,
    PluginNotFoundError,
    SignatureError,
    VersionConflictError,
)
from .installer import PluginInstaller, get_installer
from .loader import PluginLoader, get_loader
from .registry import PluginRegistry, get_registry
from .resolver import DependencyResolver, get_resolver
from .validator import PluginValidator, get_validator

# Cycle 13 P1-1 Marketplace
from .marketplace import (
    PluginMarketplace,
    MarketplacePlugin,
    PluginVersion,
    Rating,
    RatingStore,
    get_marketplace,
    reset_marketplace,
    is_marketplace_path_allowed,
)


__all__ = [
    # 枚举
    "ComponentType",
    "PluginStatus",
    # 模型
    "Plugin",
    "PluginAuthor",
    "PluginComponents",
    "PluginDependencies",
    "PluginManifest",
    "PluginPermissions",
    "PluginRepository",
    "PluginVerification",
    # 工具
    "parse_manifest_file",
    "semver_compare",
    # 异常
    "CircularDependencyError",
    "ComponentNotFoundError",
    "DependencyError",
    "InstallError",
    "ManifestError",
    "ManifestValidationError",
    "PermissionError",
    "PluginAlreadyExistsError",
    "PluginError",
    "PluginNotFoundError",
    "SignatureError",
    "VersionConflictError",
    # 服务
    "PluginLoader",
    "get_loader",
    "PluginRegistry",
    "get_registry",
    "PluginInstaller",
    "get_installer",
    "DependencyResolver",
    "get_resolver",
    "PluginValidator",
    "get_validator",
    # Marketplace (Cycle 13 P1-1)
    "PluginMarketplace",
    "MarketplacePlugin",
    "PluginVersion",
    "Rating",
    "RatingStore",
    "get_marketplace",
    "reset_marketplace",
    "is_marketplace_path_allowed",
]


__version__ = "1.0.0"
__cycle__ = "Cycle 12 P0-1"
