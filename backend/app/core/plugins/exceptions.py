"""
# ============================================================
# Hermes Plugin System - 异常类定义
# ============================================================
# 核心作用：定义 Plugin 系统中使用的所有异常类型
# 特性：层次化异常 + 错误代码 + 详细信息
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class PluginError(Exception):
    """Plugin 系统基础异常"""

    def __init__(
        self,
        message: str,
        code: str = "PLUGIN_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """初始化异常"""
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于 API 响应）"""
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
        }


class PluginNotFoundError(PluginError):
    """Plugin 未找到"""

    def __init__(self, plugin_id: str) -> None:
        super().__init__(
            message=f"Plugin not found: {plugin_id}",
            code="PLUGIN_NOT_FOUND",
            details={"plugin_id": plugin_id},
        )


class PluginAlreadyExistsError(PluginError):
    """Plugin 已存在"""

    def __init__(self, plugin_id: str) -> None:
        super().__init__(
            message=f"Plugin already exists: {plugin_id}",
            code="PLUGIN_ALREADY_EXISTS",
            details={"plugin_id": plugin_id},
        )


class ManifestError(PluginError):
    """manifest.json 错误"""

    def __init__(self, path: str, reason: str) -> None:
        super().__init__(
            message=f"Manifest error in {path}: {reason}",
            code="MANIFEST_ERROR",
            details={"path": path, "reason": reason},
        )


class ManifestValidationError(ManifestError):
    """manifest.json 字段验证失败"""

    def __init__(self, path: str, field: str, reason: str) -> None:
        super().__init__(
            path=path,
            reason=f"Field '{field}': {reason}",
        )
        self.code = "MANIFEST_VALIDATION_ERROR"
        self.details["field"] = field


class DependencyError(PluginError):
    """依赖错误"""

    def __init__(self, plugin_id: str, reason: str) -> None:
        super().__init__(
            message=f"Dependency error for {plugin_id}: {reason}",
            code="DEPENDENCY_ERROR",
            details={"plugin_id": plugin_id, "reason": reason},
        )


class VersionConflictError(DependencyError):
    """版本冲突"""

    def __init__(self, plugin_id: str, required: str, actual: str) -> None:
        super().__init__(
            plugin_id=plugin_id,
            reason=f"Version conflict: required {required}, got {actual}",
        )
        self.code = "VERSION_CONFLICT"
        self.details["required"] = required
        self.details["actual"] = actual


class CircularDependencyError(DependencyError):
    """循环依赖"""

    def __init__(self, cycle: list) -> None:
        super().__init__(
            plugin_id=cycle[0] if cycle else "unknown",
            reason=f"Circular dependency: {' -> '.join(cycle)}",
        )
        self.code = "CIRCULAR_DEPENDENCY"
        self.details["cycle"] = cycle


class SignatureError(PluginError):
    """签名验证错误"""

    def __init__(self, plugin_id: str, reason: str) -> None:
        super().__init__(
            message=f"Signature error for {plugin_id}: {reason}",
            code="SIGNATURE_ERROR",
            details={"plugin_id": plugin_id, "reason": reason},
        )


class PermissionError(PluginError):
    """权限错误"""

    def __init__(self, plugin_id: str, permission: str) -> None:
        super().__init__(
            message=f"Permission denied for {plugin_id}: {permission}",
            code="PERMISSION_DENIED",
            details={"plugin_id": plugin_id, "permission": permission},
        )


class ComponentNotFoundError(PluginError):
    """组件未找到"""

    def __init__(self, plugin_id: str, component_type: str, component_path: str) -> None:
        super().__init__(
            message=f"Component not found in {plugin_id}: {component_type} at {component_path}",
            code="COMPONENT_NOT_FOUND",
            details={
                "plugin_id": plugin_id,
                "component_type": component_type,
                "component_path": component_path,
            },
        )


class InstallError(PluginError):
    """安装错误"""

    def __init__(self, path: str, reason: str) -> None:
        super().__init__(
            message=f"Install error for {path}: {reason}",
            code="INSTALL_ERROR",
            details={"path": path, "reason": reason},
        )
