"""
# ============================================================
# JWT 辅助工具 - access_token 签发与验证
# ============================================================
# 核心作用：实现符合 MCP OAuth 规范的 JWT access_token
# 关键特性：
#   - HS256 签名算法（共享密钥）
#   - Audience binding（aud claim 必须匹配 JWT_AUDIENCE_MCP）
#   - 短期过期（默认 1 小时）
#   - jti 唯一标识（用于 refresh_token 关联和重放检测）
# 关联规范：RFC 7519 (JWT), MCP Spec §3.1
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import os
import time
import secrets
import hashlib
import hmac
import base64
import json
from typing import Optional, Dict, Any, Final

# JWT 常量
JWT_AUDIENCE_MCP: Final[str] = "mcp://hermes-scheduling-platform"
JWT_DEFAULT_TTL_SECONDS: Final[int] = 3600  # 1 小时
JWT_DEFAULT_ISSUER: Final[str] = "hermes-oauth-server"

# 算法白名单
JWT_ALGORITHM: Final[str] = "HS256"


def _base64url_encode(data: bytes) -> str:
    """
    BASE64URL 编码（无 padding）

    参数：
        data: 原始字节

    返回：
        BASE64URL 编码字符串
    """
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64url_decode(data: str) -> bytes:
    """
    BASE64URL 解码

    参数：
        data: BASE64URL 编码字符串

    返回：
        原始字节

    异常：
        ValueError: 当输入不是有效的 BASE64URL 编码
    """
    # 补齐 padding
    padding = 4 - (len(data) % 4)
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data.encode("ascii"))


def _get_signing_key() -> bytes:
    """
    获取 JWT 签名密钥
    优先级：
      1. 环境变量 OAUTH_JWT_SECRET
      2. 默认开发密钥（生产环境必须替换）

    返回：
        签名密钥字节
    """
    return os.environ.get(
        "OAUTH_JWT_SECRET",
        "hermes-dev-secret-DO-NOT-USE-IN-PRODUCTION-2026-07-27",
    ).encode("utf-8")


def issue_access_token(
    client_id: str,
    user_id: str,
    scope: str,
    ttl_seconds: int = JWT_DEFAULT_TTL_SECONDS,
    audience: str = JWT_AUDIENCE_MCP,
    issuer: str = JWT_DEFAULT_ISSUER,
) -> str:
    """
    签发 JWT access_token

    参数：
        client_id: OAuth 客户端 ID
        user_id: 资源所有者 ID
        scope: 授权范围（空格分隔）
        ttl_seconds: 过期时间（秒），默认 3600
        audience: 目标受众，默认 mcp://hermes-scheduling-platform
        issuer: 签发者

    返回：
        JWT 字符串（格式：header.payload.signature）
    """
    now = int(time.time())

    # Header
    header = {
        "alg": JWT_ALGORITHM,
        "typ": "JWT",
    }

    # Payload（claims）
    payload = {
        "iss": issuer,
        "sub": user_id,
        "aud": audience,
        "exp": now + ttl_seconds,
        "iat": now,
        "client_id": client_id,
        "scope": scope,
        "jti": secrets.token_urlsafe(16),  # 唯一标识
    }

    # 编码 header 和 payload
    header_b64 = _base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    # 计算签名
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        _get_signing_key(),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    signature_b64 = _base64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{signature_b64}"


def verify_access_token(
    token: str,
    expected_audience: str = JWT_AUDIENCE_MCP,
    expected_issuer: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    验证 JWT access_token 并返回 payload

    验证内容：
      1. 签名正确性
      2. 未过期（exp claim）
      3. audience 匹配（防 confused-deputy）
      4. issuer 匹配（如果指定）
      5. 签名算法为 HS256（防 alg=none 攻击）

    参数：
        token: JWT 字符串
        expected_audience: 期望的 audience
        expected_issuer: 期望的 issuer（可选）

    返回：
        Payload 字典（验证失败返回 None）

    安全：
        使用 hmac.compare_digest 防止计时攻击
    """
    try:
        # 解析 JWT 三段
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header_b64, payload_b64, signature_b64 = parts

        # 解码 header 验证算法
        header_bytes = _base64url_decode(header_b64)
        header = json.loads(header_bytes)

        # 严格校验 alg 字段（防 alg=none 和算法替换攻击）
        if header.get("alg") != JWT_ALGORITHM:
            return None

        # 重新计算签名并比对
        signing_input = f"{header_b64}.{payload_b64}"
        expected_signature = hmac.new(
            _get_signing_key(),
            signing_input.encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual_signature = _base64url_decode(signature_b64)

        if not hmac.compare_digest(expected_signature, actual_signature):
            return None

        # 解码 payload
        payload_bytes = _base64url_decode(payload_b64)
        payload = json.loads(payload_bytes)

        # 验证过期时间
        now = int(time.time())
        if payload.get("exp", 0) < now:
            return None

        # 验证 audience（防 confused-deputy 攻击）
        aud = payload.get("aud")
        if aud != expected_audience:
            return None

        # 验证 issuer（如果指定）
        if expected_issuer is not None and payload.get("iss") != expected_issuer:
            return None

        return payload

    except (ValueError, KeyError, json.JSONDecodeError, Exception):
        # 任何解析错误都视为验证失败
        return None
