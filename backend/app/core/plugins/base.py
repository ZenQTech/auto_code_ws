"""
# ============================================================
# Hermes Plugin System - 数据模型
# ============================================================
# 核心作用：定义 Plugin 系统的数据模型（manifest、components、状态等）
# 特性：Pydantic 验证、JSON 序列化、类型安全
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field, asdict

# ============================================================
# 枚举
# ============================================================
class PluginStatus(str, Enum):
    """Plugin 状态枚举"""
    AVAILABLE = "available"   # 已发现但未启用
    ENABLED = "enabled"       # 已启用
    DISABLED = "disabled"     # 已禁用
    INSTALLED = "installed"   # 已安装
    ERROR = "error"           # 加载错误


class ComponentType(str, Enum):
    """组件类型枚举"""
    SKILL = "skill"
    AGENT = "agent"
    HOOK = "hook"
    MCP_SERVER = "mcp_server"
    RULE = "rule"
    COMMAND = "command"


# ============================================================
# 数据模型（dataclass + 验证）
# ============================================================
@dataclass
class PluginAuthor:
    """Plugin 作者"""
    name: str
    email: Optional[str] = None
    url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PluginRepository:
    """Plugin 仓库"""
    type: str = "git"
    url: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PluginDependencies:
    """Plugin 依赖"""
    plugins: List[str] = field(default_factory=list)
    python: Optional[str] = None
    node: Optional[str] = None
    hermes: Optional[str] = None  # semver 约束

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PluginComponents:
    """Plugin 组件清单"""
    skills: List[str] = field(default_factory=list)
    agents: List[str] = field(default_factory=list)
    hooks: List[str] = field(default_factory=list)
    mcp_servers: List[str] = field(default_factory=list)
    rules: List[str] = field(default_factory=list)
    commands: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def total_count(self) -> int:
        """组件总数"""
        return (
            len(self.skills) +
            len(self.agents) +
            len(self.hooks) +
            len(self.mcp_servers) +
            len(self.rules) +
            len(self.commands)
        )


@dataclass
class PluginPermissions:
    """Plugin 权限声明"""
    network: List[str] = field(default_factory=list)  # 允许的网络域
    filesystem: List[str] = field(default_factory=list)  # 允许的文件系统路径
    tools: List[str] = field(default_factory=list)  # 允许使用的工具

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PluginVerification:
    """Plugin 签名验证信息"""
    checksum: Optional[str] = None
    signature: Optional[str] = None
    publisher: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PluginManifest:
    """Plugin manifest（核心元数据）"""
    id: str
    name: str
    version: str
    description: str
    author: PluginAuthor
    license: str = "MIT"
    homepage: Optional[str] = None
    repository: Optional[PluginRepository] = None
    keywords: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    icon: Optional[str] = None
    hermes_version: str = ">=6.17.0"
    dependencies: PluginDependencies = field(default_factory=PluginDependencies)
    components: PluginComponents = field(default_factory=PluginComponents)
    permissions: PluginPermissions = field(default_factory=PluginPermissions)
    verification: PluginVerification = field(default_factory=PluginVerification)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author.to_dict(),
            "license": self.license,
            "homepage": self.homepage,
            "repository": self.repository.to_dict() if self.repository else None,
            "keywords": self.keywords,
            "categories": self.categories,
            "icon": self.icon,
            "hermes_version": self.hermes_version,
            "dependencies": self.dependencies.to_dict(),
            "components": self.components.to_dict(),
            "permissions": self.permissions.to_dict(),
            "verification": self.verification.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PluginManifest":
        """从字典解析 manifest"""
        # 必填字段验证
        required = ["id", "name", "version", "description", "author"]
        for field_name in required:
            if field_name not in data:
                raise ValueError(f"Missing required field: {field_name}")

        # 解析 author
        author_data = data["author"]
        if isinstance(author_data, str):
            author = PluginAuthor(name=author_data)
        else:
            author = PluginAuthor(
                name=author_data.get("name", "Unknown"),
                email=author_data.get("email"),
                url=author_data.get("url"),
            )

        # 解析 repository
        repo = None
        if "repository" in data and data["repository"]:
            if isinstance(data["repository"], str):
                repo = PluginRepository(url=data["repository"])
            else:
                repo = PluginRepository(
                    type=data["repository"].get("type", "git"),
                    url=data["repository"].get("url", ""),
                )

        # 解析 dependencies
        deps_data = data.get("dependencies", {})
        deps = PluginDependencies(
            plugins=deps_data.get("plugins", []),
            python=deps_data.get("python"),
            node=deps_data.get("node"),
            hermes=deps_data.get("hermes"),
        )

        # 解析 components
        comp_data = data.get("components", {})
        comps = PluginComponents(
            skills=comp_data.get("skills", []),
            agents=comp_data.get("agents", []),
            hooks=comp_data.get("hooks", []),
            mcp_servers=comp_data.get("mcp_servers", []),
            rules=comp_data.get("rules", []),
            commands=comp_data.get("commands", []),
        )

        # 解析 permissions
        perm_data = data.get("permissions", {})
        perms = PluginPermissions(
            network=perm_data.get("network", []),
            filesystem=perm_data.get("filesystem", []),
            tools=perm_data.get("tools", []),
        )

        # 解析 verification
        verif_data = data.get("verification", {})
        verif = PluginVerification(
            checksum=verif_data.get("checksum"),
            signature=verif_data.get("signature"),
            publisher=verif_data.get("publisher"),
        )

        return cls(
            id=data["id"],
            name=data["name"],
            version=data["version"],
            description=data["description"],
            author=author,
            license=data.get("license", "MIT"),
            homepage=data.get("homepage"),
            repository=repo,
            keywords=data.get("keywords", []),
            categories=data.get("categories", []),
            icon=data.get("icon"),
            hermes_version=data.get("hermes_version", ">=6.17.0"),
            dependencies=deps,
            components=comps,
            permissions=perms,
            verification=verif,
        )

    def validate(self) -> List[str]:
        """验证 manifest，返回错误列表"""
        errors = []
        # ID 格式验证（kebab-case）
        if not re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", self.id):
            errors.append(f"Invalid id format (must be kebab-case): {self.id}")
        # 版本号格式（semver）
        if not re.match(r"^\d+\.\d+\.\d+", self.version):
            errors.append(f"Invalid version format (must be semver): {self.version}")
        # Hermes 版本约束
        if not self.hermes_version:
            errors.append("hermes_version is required")
        return errors


@dataclass
class Plugin:
    """Plugin 实例（运行时对象）"""
    manifest: PluginManifest
    base_path: Path
    status: PluginStatus = PluginStatus.AVAILABLE
    enabled: bool = False
    installed_at: Optional[str] = None
    loaded_at: Optional[str] = None
    error_message: Optional[str] = None
    components_loaded: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于 API 响应）"""
        return {
            "id": self.manifest.id,
            "name": self.manifest.name,
            "version": self.manifest.version,
            "description": self.manifest.description,
            "author": self.manifest.author.to_dict(),
            "status": self.status.value,
            "enabled": self.enabled,
            "installed_at": self.installed_at,
            "loaded_at": self.loaded_at,
            "error_message": self.error_message,
            "path": str(self.base_path),
            "components": {
                "total": self.manifest.components.total_count(),
                "loaded": self.components_loaded,
                "skills": len(self.manifest.components.skills),
                "agents": len(self.manifest.components.agents),
                "hooks": len(self.manifest.components.hooks),
                "mcp_servers": len(self.manifest.components.mcp_servers),
                "rules": len(self.manifest.components.rules),
                "commands": len(self.manifest.components.commands),
            },
            "categories": self.manifest.categories,
            "keywords": self.manifest.keywords,
            "hermes_version": self.manifest.hermes_version,
            "dependencies": self.manifest.dependencies.to_dict(),
        }

    def enable(self) -> None:
        """启用 Plugin"""
        self.enabled = True
        self.status = PluginStatus.ENABLED
        self.loaded_at = datetime.now(timezone.utc).isoformat()

    def disable(self) -> None:
        """禁用 Plugin"""
        self.enabled = False
        self.status = PluginStatus.DISABLED

    def mark_error(self, message: str) -> None:
        """标记错误"""
        self.error_message = message
        self.status = PluginStatus.ERROR


# ============================================================
# 工具函数
# ============================================================
def parse_manifest_file(path: Path) -> PluginManifest:
    """从 manifest.json 文件解析"""
    if not path.exists():
        raise FileNotFoundError(f"manifest.json not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {path}: {e}")
    return PluginManifest.from_dict(data)


def semver_compare(version: str, constraint: str) -> bool:
    """
    简单 semver 比较
    支持格式：>=1.0.0, >1.0.0, <=2.0.0, <2.0.0, ==1.0.0, ^1.0.0, ~1.0.0
    """
    version = version.strip()
    constraint = constraint.strip()

    # 解析版本号
    def parse_ver(v: str) -> tuple:
        # 移除预发布标签（如 1.0.0-alpha）
        v = re.sub(r"[-+].*$", "", v)
        parts = v.split(".")
        if len(parts) == 3:
            return tuple(int(x) for x in parts)
        elif len(parts) == 2:
            return (int(parts[0]), int(parts[1]), 0)
        elif len(parts) == 1:
            return (int(parts[0]), 0, 0)
        return (0, 0, 0)

    # 解析操作符
    op = ">="
    if constraint.startswith(">="):
        op = ">="
        cstr = constraint[2:].strip()
    elif constraint.startswith(">"):
        op = ">"
        cstr = constraint[1:].strip()
    elif constraint.startswith("<="):
        op = "<="
        cstr = constraint[2:].strip()
    elif constraint.startswith("<"):
        op = "<"
        cstr = constraint[1:].strip()
    elif constraint.startswith("==") or constraint.startswith("="):
        op = "=="
        cstr = constraint.lstrip("=").strip()
    elif constraint.startswith("^"):
        # ^1.2.3 兼容 >=1.2.3 <2.0.0
        cstr = constraint[1:].strip()
        cver = parse_ver(cstr)
        if version_tuple := parse_ver(version):
            return cver <= version_tuple < (cver[0] + 1, 0, 0)
        return False
    elif constraint.startswith("~"):
        # ~1.2.3 兼容 >=1.2.3 <1.3.0
        cstr = constraint[1:].strip()
        cver = parse_ver(cstr)
        if version_tuple := parse_ver(version):
            return cver <= version_tuple < (cver[0], cver[1] + 1, 0)
        return False
    else:
        cstr = constraint

    cver = parse_ver(cstr)
    vver = parse_ver(version)

    if op == ">=":
        return vver >= cver
    elif op == ">":
        return vver > cver
    elif op == "<=":
        return vver <= cver
    elif op == "<":
        return vver < cver
    elif op == "==":
        return vver == cver
    return False
