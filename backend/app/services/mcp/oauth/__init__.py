"""
# ============================================================
# OAuth 2.1 + PKCE for MCP Servers - 核心模块
# ============================================================
# 核心作用：实现符合 MCP Authorization Spec 2026-06-18 的 OAuth 2.1 流程
# 关键能力：
#   - PKCE S256 强制（禁用 plain 和 implicit flow）
#   - 动态客户端注册（RFC 7591）
#   - Audience-bound tokens（防 confused-deputy）
#   - 刷新 token 单次使用 + 重放检测
#   - JWT access_token + 短期过期
# 关联文档：
#   - MCP Spec: https://modelcontextprotocol.info/specification/draft/basic/authorization/
#   - RFC 6749: The OAuth 2.0 Authorization Framework
#   - RFC 7636: PKCE
#   - RFC 7591: Dynamic Client Registration
#   - RFC 8414: Authorization Server Metadata
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

from .pkce import (
    generate_code_verifier,
    compute_code_challenge_s256,
    verify_pkce_pair,
    PKCE_MIN_VERIFIER_LENGTH,
    PKCE_MAX_VERIFIER_LENGTH,
)
from .jwt_helper import (
    issue_access_token,
    verify_access_token,
    JWT_AUDIENCE_MCP,
    JWT_DEFAULT_TTL_SECONDS,
)
from .oauth_store import (
    InMemoryOAuthStore,
    OAuthClient,
    AuthorizationCode,
    AccessToken,
    RefreshToken,
    get_oauth_store,
)
from .oauth_service import OAuthService, get_oauth_service

__all__ = [
    "generate_code_verifier",
    "compute_code_challenge_s256",
    "verify_pkce_pair",
    "PKCE_MIN_VERIFIER_LENGTH",
    "PKCE_MAX_VERIFIER_LENGTH",
    "issue_access_token",
    "verify_access_token",
    "JWT_AUDIENCE_MCP",
    "JWT_DEFAULT_TTL_SECONDS",
    "InMemoryOAuthStore",
    "OAuthClient",
    "AuthorizationCode",
    "AccessToken",
    "RefreshToken",
    "get_oauth_store",
    "OAuthService",
    "get_oauth_service",
]
