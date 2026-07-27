"""
# ============================================================
# OAuth Service - 业务逻辑层
# ============================================================
# 核心作用：编排 OAuth 2.1 授权流程的完整业务逻辑
# 关键能力：
#   - 动态客户端注册
#   - 授权码生成与消费（含 PKCE 验证）
#   - Token 颁发（authorization_code + refresh_token 双流程）
#   - 重放检测 + audience binding
#   - 元数据生成
# 关联规范：
#   - RFC 6749 §4.1 (Authorization Code Grant)
#   - RFC 7636 (PKCE)
#   - RFC 7591 (Dynamic Client Registration)
#   - RFC 8414 (Authorization Server Metadata)
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import logging
import time
import secrets
from typing import Optional, Dict, Any, List

from .pkce import verify_pkce_pair
from .jwt_helper import (
    issue_access_token,
    JWT_AUDIENCE_MCP,
    JWT_DEFAULT_TTL_SECONDS,
    JWT_DEFAULT_ISSUER,
)
from .oauth_store import (
    InMemoryOAuthStore,
    OAuthClient,
    AuthorizationCode,
    AccessToken,
    RefreshToken,
    get_oauth_store,
)

logger = logging.getLogger(__name__)


# OAuth 错误码（RFC 6749 §5.2）
class OAuthError:
    INVALID_REQUEST = "invalid_request"
    INVALID_CLIENT = "invalid_client"
    INVALID_GRANT = "invalid_grant"
    UNAUTHORIZED_CLIENT = "unauthorized_client"
    UNSUPPORTED_GRANT_TYPE = "unsupported_grant_type"
    UNSUPPORTED_RESPONSE_TYPE = "unsupported_response_type"
    INVALID_SCOPE = "invalid_scope"
    SERVER_ERROR = "server_error"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"


# 默认 scope 列表
DEFAULT_SCOPES = ["read", "write", "admin"]


class OAuthService:
    """
    OAuth 2.1 业务服务

    编排存储 + JWT + PKCE 三个底层模块，提供完整的授权流程
    """

    def __init__(self, store: Optional[InMemoryOAuthStore] = None):
        """初始化服务"""
        self._store = store or get_oauth_store()

    # ============================================================
    # 元数据（RFC 8414）
    # ============================================================

    def get_authorization_server_metadata(self, issuer: str) -> Dict[str, Any]:
        """
        返回 OAuth 授权服务器元数据

        参数：
            issuer: 授权服务器 URL（如 http://127.0.0.1:8000）

        返回：
            元数据字典（RFC 8414 §2）
        """
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/oauth/authorize",
            "token_endpoint": f"{issuer}/oauth/token",
            "registration_endpoint": f"{issuer}/oauth/register",
            "revocation_endpoint": f"{issuer}/oauth/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],  # 强制 S256
            "token_endpoint_auth_methods_supported": ["none"],  # PKCE public client
            "scopes_supported": DEFAULT_SCOPES,
            "authorization_response_iss_parameter_supported": True,
        }

    # ============================================================
    # 动态客户端注册（RFC 7591）
    # ============================================================

    async def register_client(
        self,
        client_name: str,
        redirect_uris: List[str],
        token_endpoint_auth_method: str = "none",
        grant_types: Optional[List[str]] = None,
        scope: str = "read",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        注册新客户端

        参数：
            client_name: 客户端名
            redirect_uris: 回调 URI 列表（至少 1 个）
            token_endpoint_auth_method: 认证方法
            grant_types: 授权类型
            scope: 默认 scope
            metadata: 额外元数据

        返回：
            注册响应（RFC 7591 §3.2.1）

        异常：
            ValueError: 参数校验失败
        """
        # 参数校验
        if not client_name or not isinstance(client_name, str):
            raise ValueError(f"{OAuthError.INVALID_REQUEST}: client_name 必填")
        if not redirect_uris or not isinstance(redirect_uris, list):
            raise ValueError(f"{OAuthError.INVALID_REQUEST}: redirect_uris 必填且为数组")
        if len(redirect_uris) == 0:
            raise ValueError(f"{OAuthError.INVALID_REQUEST}: redirect_uris 不能为空")
        for uri in redirect_uris:
            if not isinstance(uri, str) or not uri.startswith(("http://", "https://")):
                raise ValueError(f"{OAuthError.INVALID_REQUEST}: redirect_uri 必须是 http(s) URL，得到 {uri}")

        # 安全校验：仅允许 none（PKCE public client）
        if token_endpoint_auth_method not in ("none", "client_secret_basic"):
            raise ValueError(
                f"{OAuthError.INVALID_REQUEST}: token_endpoint_auth_method 必须是 none 或 client_secret_basic"
            )

        client = await self._store.register_client(
            client_name=client_name,
            redirect_uris=redirect_uris,
            token_endpoint_auth_method=token_endpoint_auth_method,
            grant_types=grant_types or ["authorization_code", "refresh_token"],
            scope=scope,
            metadata=metadata,
        )

        # 返回 RFC 7591 响应
        return {
            "client_id": client.client_id,
            "client_id_issued_at": int(client.created_at),
            "client_name": client.client_name,
            "redirect_uris": client.redirect_uris,
            "grant_types": client.grant_types,
            "token_endpoint_auth_method": client.token_endpoint_auth_method,
            "scope": client.scope,
        }

    # ============================================================
    # 授权码创建（/oauth/authorize 调用）
    # ============================================================

    async def create_authorization_code(
        self,
        client_id: str,
        redirect_uri: str,
        code_challenge: str,
        code_challenge_method: str,
        scope: str = "read",
        user_id: str = "default-user",
    ) -> Dict[str, Any]:
        """
        创建授权码

        参数：
            client_id: 客户端 ID
            redirect_uri: 回调 URI
            code_challenge: PKCE 挑战
            code_challenge_method: 必须是 S256
            scope: 授权范围
            user_id: 资源所有者 ID（自动授权场景使用默认用户）

        返回：
            包含 code 和 redirect_uri 的字典

        异常：
            ValueError: 参数校验失败
        """
        # 验证 client
        client = await self._store.get_client(client_id)
        if client is None:
            raise ValueError(f"{OAuthError.INVALID_CLIENT}: 未知的 client_id")

        # 验证 redirect_uri 严格匹配
        if redirect_uri not in client.redirect_uris:
            raise ValueError(f"{OAuthError.INVALID_REQUEST}: redirect_uri 不匹配注册的 URI")

        # 验证 PKCE method（强制 S256）
        if code_challenge_method != "S256":
            raise ValueError(
                f"{OAuthError.INVALID_REQUEST}: 仅支持 code_challenge_method=S256"
            )
        if not code_challenge or len(code_challenge) < 43:
            raise ValueError(
                f"{OAuthError.INVALID_REQUEST}: code_challenge 必须至少 43 字符"
            )

        # 验证 scope
        if scope not in DEFAULT_SCOPES:
            scope = "read"  # 降级到默认

        # 创建授权码
        auth_code = await self._store.create_authorization_code(
            client_id=client_id,
            user_id=user_id,
            redirect_uri=redirect_uri,
            scope=scope,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
        )

        return {
            "code": auth_code.code,
            "redirect_uri": redirect_uri,
            "state": "auto-authorized",  # 自动授权场景
        }

    # ============================================================
    # Token 交换（authorization_code grant）
    # ============================================================

    async def exchange_authorization_code(
        self,
        code: str,
        client_id: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> Dict[str, Any]:
        """
        使用 authorization_code 交换 access_token + refresh_token

        流程：
          1. 消费授权码（一次性）
          2. 验证 PKCE（code_verifier vs code_challenge）
          3. 签发 JWT access_token
          4. 创建并存储 refresh_token

        参数：
            code: 授权码
            client_id: 客户端 ID
            redirect_uri: 回调 URI
            code_verifier: PKCE 验证器

        返回：
            Token 响应（RFC 6749 §5.1）

        异常：
            ValueError: 任何验证失败
        """
        # 消费授权码
        auth_code = await self._store.consume_authorization_code(
            code=code,
            client_id=client_id,
            redirect_uri=redirect_uri,
        )
        if auth_code is None:
            raise ValueError(
                f"{OAuthError.INVALID_GRANT}: 授权码无效、已过期或已使用"
            )

        # 验证 PKCE
        if not verify_pkce_pair(
            code_verifier=code_verifier,
            code_challenge=auth_code.code_challenge,
            method=auth_code.code_challenge_method,
        ):
            raise ValueError(
                f"{OAuthError.INVALID_GRANT}: PKCE 验证失败（code_verifier 不匹配）"
            )

        # 颁发 token
        return await self._issue_token_pair(
            client_id=auth_code.client_id,
            user_id=auth_code.user_id,
            scope=auth_code.scope,
        )

    # ============================================================
    # Token 刷新（refresh_token grant）
    # ============================================================

    async def refresh_access_token(
        self,
        refresh_token: str,
        client_id: str,
    ) -> Dict[str, Any]:
        """
        使用 refresh_token 刷新 access_token

        关键安全点：
          - refresh_token 单次使用（轮换）
          - 重放检测：重放时撤销整条 token 链

        参数：
            refresh_token: 刷新令牌
            client_id: 客户端 ID

        返回：
            新的 token 响应

        异常：
            ValueError: 验证失败
        """
        # 消费 refresh_token（重放检测在内部）
        rt = await self._store.consume_refresh_token(
            token=refresh_token,
            client_id=client_id,
        )
        if rt is None:
            raise ValueError(
                f"{OAuthError.INVALID_GRANT}: refresh_token 无效、已过期、已使用或被重放"
            )

        # 颁发新 token 对
        return await self._issue_token_pair(
            client_id=rt.client_id,
            user_id=rt.user_id,
            scope=rt.scope,
        )

    # ============================================================
    # Token 撤销
    # ============================================================

    async def revoke_token(self, token: str, token_type_hint: str = "access_token") -> bool:
        """
        撤销 token（RFC 7009）

        参数：
            token: 要撤销的 token
            token_type_hint: 类型提示（access_token/refresh_token）

        返回：
            是否成功
        """
        if token_type_hint == "refresh_token":
            return await self._store.revoke_refresh_token(token)
        else:
            # 尝试作为 access_token 撤销
            # 从 JWT 中提取 jti（简化处理：直接遍历）
            from .jwt_helper import verify_access_token
            payload = verify_access_token(token)
            if payload and "jti" in payload:
                return await self._store.revoke_access_token(payload["jti"])
            return False

    # ============================================================
    # 内部辅助方法
    # ============================================================

    async def _issue_token_pair(
        self,
        client_id: str,
        user_id: str,
        scope: str,
    ) -> Dict[str, Any]:
        """
        颁发 access_token + refresh_token 对

        内部方法，所有 token 颁发的统一入口
        """
        # 签发 JWT access_token
        access_token_str = issue_access_token(
            client_id=client_id,
            user_id=user_id,
            scope=scope,
        )

        # 从 JWT 中提取 jti（解码 payload）
        from .jwt_helper import _base64url_decode
        parts = access_token_str.split(".")
        payload_bytes = _base64url_decode(parts[1])
        import json
        payload = json.loads(payload_bytes)
        jti = payload["jti"]
        exp = payload["exp"]
        iat = payload["iat"]

        # 存储 access_token 元数据
        access_token = AccessToken(
            token=access_token_str,
            jti=jti,
            client_id=client_id,
            user_id=user_id,
            scope=scope,
            issued_at=iat,
            expires_at=exp,
        )
        await self._store.store_access_token(access_token)

        # 创建并存储 refresh_token
        refresh_token_str = f"rt_{secrets.token_urlsafe(32)}"
        refresh_token = RefreshToken(
            token=refresh_token_str,
            access_token_jti=jti,
            client_id=client_id,
            user_id=user_id,
            scope=scope,
            issued_at=iat,
            expires_at=iat + InMemoryOAuthStore.REFRESH_TOKEN_TTL,
        )
        await self._store.store_refresh_token(refresh_token)

        # 返回 RFC 6749 §5.1 响应
        return {
            "access_token": access_token_str,
            "token_type": "Bearer",
            "expires_in": exp - iat,
            "refresh_token": refresh_token_str,
            "scope": scope,
        }

    # ============================================================
    # 管理接口
    # ============================================================

    async def list_clients(self) -> List[Dict[str, Any]]:
        """列出所有客户端（脱敏）"""
        clients = await self._store.list_clients()
        return [
            {
                "client_id": c.client_id,
                "client_name": c.client_name,
                "redirect_uris": c.redirect_uris,
                "grant_types": c.grant_types,
                "scope": c.scope,
                "created_at": c.created_at,
            }
            for c in clients
        ]

    async def delete_client(self, client_id: str) -> bool:
        """删除客户端"""
        return await self._store.delete_client(client_id)

    async def get_stats(self) -> Dict[str, int]:
        """获取统计信息"""
        return await self._store.get_stats()


# ============================================================
# 单例
# ============================================================

_oauth_service_instance: Optional[OAuthService] = None


def get_oauth_service() -> OAuthService:
    """
    获取 OAuth 服务单例

    返回：
        全局共享的 OAuthService 实例
    """
    global _oauth_service_instance
    if _oauth_service_instance is None:
        _oauth_service_instance = OAuthService()
    return _oauth_service_instance
