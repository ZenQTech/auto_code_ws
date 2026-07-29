"""
# ============================================================
# Hermes Plugin System - 验证器
# ============================================================
# 核心作用：验证 manifest 字段、路径安全、签名校验
# 特性：JSON Schema 验证、HMAC 签名、路径白名单
# Cycle 12 P0-1 新建
# ============================================================
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import Plugin, PluginManifest
from .exceptions import ManifestValidationError, SignatureError

logger = logging.getLogger(__name__)


# 字段验证规则
ID_REGEX = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
VERSION_REGEX = re.compile(r"^\d+\.\d+\.\d+")
EMAIL_REGEX = re.compile(r"^[^@]+@[^@]+\.[^@]+$")


class PluginValidator:
    """
    Plugin 验证器
    负责：
    - 必填字段验证
    - 格式验证（ID、版本、邮箱）
    - 路径白名单
    - 组件路径存在性
    - HMAC 签名验证
    """

    def __init__(
        self,
        secret_key: str = "hermes-plugin-default-secret",
        enable_signature_check: bool = False,
    ) -> None:
        """
        初始化验证器
        secret_key: HMAC 签名密钥（生产环境应从环境变量读取）
        enable_signature_check: 是否启用签名检查（默认关闭以简化开发）
        """
        self.secret_key = secret_key
        self.enable_signature_check = enable_signature_check

    def validate_manifest(self, manifest: PluginManifest) -> List[str]:
        """验证 manifest 字段，返回错误列表"""
        errors = []
        # ID
        if not manifest.id:
            errors.append("id is required")
        elif not ID_REGEX.match(manifest.id):
            errors.append(f"id must be kebab-case: {manifest.id}")
        # Name
        if not manifest.name:
            errors.append("name is required")
        elif len(manifest.name) > 100:
            errors.append("name too long (max 100 chars)")
        # Version
        if not manifest.version:
            errors.append("version is required")
        elif not VERSION_REGEX.match(manifest.version):
            errors.append(f"version must be semver: {manifest.version}")
        # Description
        if not manifest.description:
            errors.append("description is required")
        elif len(manifest.description) > 1000:
            errors.append("description too long (max 1000 chars)")
        # Author
        if not manifest.author.name:
            errors.append("author.name is required")
        if manifest.author.email and not EMAIL_REGEX.match(manifest.author.email):
            errors.append(f"author.email invalid: {manifest.author.email}")
        # Hermes version
        if not manifest.hermes_version:
            errors.append("hermes_version is required")
        # Categories (should be non-empty if defined)
        return errors

    def validate_path(self, path: str) -> bool:
        """验证路径是否在白名单内"""
        from .loader import is_path_allowed
        return is_path_allowed(path)

    def validate_components_exist(self, plugin: Plugin) -> List[str]:
        """验证 Plugin 组件文件存在性"""
        errors = []
        base = plugin.base_path
        # 验证 skills
        for skill_path in plugin.manifest.components.skills:
            full_path = base / skill_path
            if not full_path.exists():
                errors.append(f"Skill not found: {skill_path}")
        # 验证 agents
        for agent_path in plugin.manifest.components.agents:
            full_path = base / agent_path
            if not full_path.exists():
                errors.append(f"Agent not found: {agent_path}")
        # 验证 hooks
        for hook_path in plugin.manifest.components.hooks:
            full_path = base / hook_path
            if not full_path.exists():
                errors.append(f"Hook not found: {hook_path}")
        # 验证 mcp_servers
        for mcp_path in plugin.manifest.components.mcp_servers:
            full_path = base / mcp_path
            if not full_path.exists():
                errors.append(f"MCP server not found: {mcp_path}")
        # 验证 rules
        for rule_path in plugin.manifest.components.rules:
            full_path = base / rule_path
            if not full_path.exists():
                errors.append(f"Rule not found: {rule_path}")
        # 验证 commands
        for cmd_path in plugin.manifest.components.commands:
            full_path = base / cmd_path
            if not full_path.exists():
                errors.append(f"Command not found: {cmd_path}")
        return errors

    def compute_checksum(self, plugin: Plugin) -> str:
        """计算 Plugin 目录的 SHA-256 校验和"""
        sha256 = hashlib.sha256()
        for file_path in sorted(plugin.base_path.rglob("*")):
            if file_path.is_file():
                # 使用相对路径作为 key（避免绝对路径差异）
                rel = file_path.relative_to(plugin.base_path)
                sha256.update(str(rel).encode("utf-8"))
                sha256.update(file_path.read_bytes())
        return f"sha256:{sha256.hexdigest()}"

    def verify_signature(self, plugin: Plugin) -> bool:
        """
        验证 Plugin 签名
        简化版 HMAC-SHA256（生产环境应使用真实 PKI）
        """
        if not self.enable_signature_check:
            return True
        verification = plugin.manifest.verification
        if not verification.signature:
            logger.warning(f"No signature for plugin {plugin.manifest.id}, skipping")
            return True
        # 计算实际签名
        expected = self.compute_checksum(plugin)
        try:
            # 提取签名（格式：hmac:<hex>）
            if not verification.signature.startswith("hmac:"):
                return False
            sig_hex = verification.signature[5:]
            # 重新计算 HMAC
            content = expected.encode("utf-8")
            actual_sig = hmac.new(
                self.secret_key.encode("utf-8"),
                content,
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(sig_hex, actual_sig)
        except Exception as e:
            logger.error(f"Signature verification failed: {e}")
            return False

    def validate(self, plugin: Plugin) -> List[str]:
        """完整验证 Plugin，返回所有错误"""
        errors = []
        # 1. manifest 字段验证
        errors.extend(self.validate_manifest(plugin.manifest))
        # 2. 路径安全验证
        if not self.validate_path(str(plugin.base_path)):
            errors.append(f"Path not in whitelist: {plugin.base_path}")
        # 3. 组件存在性验证
        errors.extend(self.validate_components_exist(plugin))
        # 4. 签名验证
        if self.enable_signature_check and not self.verify_signature(plugin):
            errors.append(f"Signature verification failed for {plugin.manifest.id}")
        return errors

    def validate_or_raise(self, plugin: Plugin) -> None:
        """验证 Plugin，如有错误则抛异常"""
        errors = self.validate(plugin)
        if errors:
            raise ManifestValidationError(
                path=str(plugin.base_path),
                field="manifest",
                reason="; ".join(errors),
            )


# ============================================================
# 全局单例
# ============================================================
_validator_instance: Optional[PluginValidator] = None


def get_validator() -> PluginValidator:
    """获取全局 PluginValidator 单例"""
    global _validator_instance
    if _validator_instance is None:
        _validator_instance = PluginValidator()
    return _validator_instance
