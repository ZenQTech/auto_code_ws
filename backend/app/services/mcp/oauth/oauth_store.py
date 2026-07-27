"""
# ============================================================
# OAuth 内存存储 - 客户端/Code/Token CRUD
# ============================================================
# 核心作用：基于内存的 OAuth 数据存储
# 存储对象：
#   - OAuthClient: 动态注册的客户端
#   - AuthorizationCode: 授权码（一次性，10 分钟过期）
#   - AccessToken: 访问令牌（1 小时过期）
#   - RefreshToken: 刷新令牌（30 天过期，一次性使用）
# 关键能力：
#   - 自动清理过期条目
#   - 线程安全（asyncio.Lock）
#   - 客户端凭据 + 资源所有者两级索引
# 单例模式：参考 InMemoryChatStorage
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

@dataclass
class OAuthClient:
    """
    OAuth 客户端（动态注册 - RFC 7591）

    字段：
        client_id: 唯一标识
        client_secret: 机密（public client 可为空）
        client_name: 显示名
        redirect_uris: 允许的回调 URI 列表
        grant_types: 授权类型列表
        token_endpoint_auth_method: 认证方法（none/client_secret_basic）
        scope: 允许的 scope
        created_at: 注册时间戳
        metadata: 额外元数据
    """
    client_id: str
    client_name: str
    redirect_uris: List[str]
    grant_types: List[str] = field(default_factory=lambda: ["authorization_code", "refresh_token"])
    token_endpoint_auth_method: str = "none"  # PKCE 强制使用 none
    scope: str = "read"
    client_secret: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AuthorizationCode:
    """
    授权码（一次性使用）

    字段：
        code: 授权码值
        client_id: 关联客户端
        user_id: 资源所有者
        redirect_uri: 回调 URI（必须严格匹配）
        scope: 授权范围
        code_challenge: PKCE 挑战
        code_challenge_method: S256
        expires_at: 过期时间戳（默认 10 分钟）
        used: 是否已使用（防重放）
    """
    code: str
    client_id: str
    user_id: str
    redirect_uri: str
    scope: str
    code_challenge: str
    code_challenge_method: str = "S256"
    expires_at: float = 0.0
    used: bool = False


@dataclass
class AccessToken:
    """
    访问令牌元数据（实际 JWT 由客户端持有）

    字段：
        token: JWT 字符串
        jti: JWT ID
        client_id: 关联客户端
        user_id: 资源所有者
        scope: 授权范围
        issued_at: 签发时间
        expires_at: 过期时间
        revoked: 是否已撤销
    """
    token: str
    jti: str
    client_id: str
    user_id: str
    scope: str
    issued_at: float
    expires_at: float
    revoked: bool = False


@dataclass
class RefreshToken:
    """
    刷新令牌（单次使用 + 重放检测）

    字段：
        token: 刷新令牌值
        access_token_jti: 关联的 access_token JTI
        client_id: 关联客户端
        user_id: 资源所有者
        scope: 授权范围
        issued_at: 签发时间
        expires_at: 过期时间（30 天）
        used: 是否已使用（防重放）
        revoked: 是否已撤销
    """
    token: str
    access_token_jti: str
    client_id: str
    user_id: str
    scope: str
    issued_at: float
    expires_at: float
    used: bool = False
    revoked: bool = False


# ============================================================
# 存储类
# ============================================================

class InMemoryOAuthStore:
    """
    OAuth 内存存储（单例）

    线程安全：通过 asyncio.Lock 保证
    自动清理：定期清理过期的 code/token
    """

    # 常量
    AUTHORIZATION_CODE_TTL = 600  # 10 分钟
    REFRESH_TOKEN_TTL = 30 * 24 * 3600  # 30 天

    def __init__(self):
        """初始化内存存储"""
        self._clients: Dict[str, OAuthClient] = {}
        self._auth_codes: Dict[str, AuthorizationCode] = {}
        self._access_tokens: Dict[str, AccessToken] = {}  # key = jti
        self._refresh_tokens: Dict[str, RefreshToken] = {}  # key = token
        self._lock = asyncio.Lock()
        self._cleanup_counter = 0

    # ============================================================
    # 客户端管理
    # ============================================================

    async def register_client(
        self,
        client_name: str,
        redirect_uris: List[str],
        token_endpoint_auth_method: str = "none",
        grant_types: Optional[List[str]] = None,
        scope: str = "read",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> OAuthClient:
        """
        注册新客户端（RFC 7591）

        参数：
            client_name: 客户端显示名
            redirect_uris: 回调 URI 列表
            token_endpoint_auth_method: 认证方法
            grant_types: 授权类型
            scope: 默认 scope
            metadata: 额外元数据

        返回：
            创建的 OAuthClient
        """
        async with self._lock:
            client_id = f"client-{secrets.token_urlsafe(12)}"

            client = OAuthClient(
                client_id=client_id,
                client_name=client_name,
                redirect_uris=redirect_uris,
                grant_types=grant_types or ["authorization_code", "refresh_token"],
                token_endpoint_auth_method=token_endpoint_auth_method,
                scope=scope,
                metadata=metadata or {},
            )
            self._clients[client_id] = client
            logger.info(f"OAuth 客户端注册: {client_id} ({client_name})")
            return client

    async def get_client(self, client_id: str) -> Optional[OAuthClient]:
        """获取客户端"""
        return self._clients.get(client_id)

    async def list_clients(self) -> List[OAuthClient]:
        """列出所有客户端"""
        return list(self._clients.values())

    async def delete_client(self, client_id: str) -> bool:
        """
        删除客户端（同时撤销其所有 token）

        返回：
            是否成功删除
        """
        async with self._lock:
            if client_id not in self._clients:
                return False
            del self._clients[client_id]
            # 撤销该客户端的所有 token
            for token in self._access_tokens.values():
                if token.client_id == client_id:
                    token.revoked = True
            for token in self._refresh_tokens.values():
                if token.client_id == client_id:
                    token.revoked = True
            return True

    # ============================================================
    # 授权码管理
    # ============================================================

    async def create_authorization_code(
        self,
        client_id: str,
        user_id: str,
        redirect_uri: str,
        scope: str,
        code_challenge: str,
        code_challenge_method: str = "S256",
        ttl: Optional[int] = None,
    ) -> AuthorizationCode:
        """
        创建授权码

        参数：
            client_id, user_id, redirect_uri, scope: 授权参数
            code_challenge: PKCE 挑战
            code_challenge_method: 必须是 S256
            ttl: 过期时间（秒），默认 10 分钟

        返回：
            创建的 AuthorizationCode
        """
        async with self._lock:
            if code_challenge_method != "S256":
                raise ValueError("仅支持 S256 method")

            ttl = ttl or self.AUTHORIZATION_CODE_TTL
            code = AuthorizationCode(
                code=f"ac_{secrets.token_urlsafe(24)}",
                client_id=client_id,
                user_id=user_id,
                redirect_uri=redirect_uri,
                scope=scope,
                code_challenge=code_challenge,
                code_challenge_method=code_challenge_method,
                expires_at=time.time() + ttl,
            )
            self._auth_codes[code.code] = code
            return code

    async def consume_authorization_code(
        self,
        code: str,
        client_id: str,
        redirect_uri: str,
    ) -> Optional[AuthorizationCode]:
        """
        消费授权码（一次性）

        验证项：
          1. 存在性
          2. 未过期
          3. 未使用
          4. client_id 匹配
          5. redirect_uri 严格匹配

        返回：
            AuthorizationCode 或 None（消费后）
        """
        async with self._lock:
            auth_code = self._auth_codes.get(code)
            if auth_code is None:
                return None
            if auth_code.used:
                logger.warning(f"授权码重放检测: {code[:10]}...")
                return None
            if auth_code.expires_at < time.time():
                return None
            if auth_code.client_id != client_id:
                return None
            if auth_code.redirect_uri != redirect_uri:
                return None

            # 标记已使用
            auth_code.used = True
            return auth_code

    # ============================================================
    # Access Token 管理
    # ============================================================

    async def store_access_token(self, access_token: AccessToken) -> None:
        """存储 access_token 元数据"""
        async with self._lock:
            self._access_tokens[access_token.jti] = access_token

    async def get_access_token(self, jti: str) -> Optional[AccessToken]:
        """获取 access_token"""
        token = self._access_tokens.get(jti)
        if token is None or token.revoked or token.expires_at < time.time():
            return None
        return token

    async def revoke_access_token(self, jti: str) -> bool:
        """撤销 access_token"""
        async with self._lock:
            token = self._access_tokens.get(jti)
            if token is None:
                return False
            token.revoked = True
            return True

    # ============================================================
    # Refresh Token 管理（单次使用 + 重放检测）
    # ============================================================

    async def store_refresh_token(self, refresh_token: RefreshToken) -> None:
        """存储 refresh_token"""
        async with self._lock:
            self._refresh_tokens[refresh_token.token] = refresh_token

    async def consume_refresh_token(
        self,
        token: str,
        client_id: str,
    ) -> Optional[RefreshToken]:
        """
        消费 refresh_token（一次性 + 重放检测）

        重放检测：
          - 如果 token 已 used，标记其关联的 access_token 为已撤销
          - 视为安全事件，记录日志

        返回：
            RefreshToken 或 None
        """
        async with self._lock:
            rt = self._refresh_tokens.get(token)
            if rt is None or rt.revoked or rt.expires_at < time.time():
                return None
            if rt.client_id != client_id:
                return None

            if rt.used:
                # 重放检测：撤销该 refresh_token 链上的所有 token
                logger.error(
                    f"Refresh token 重放检测！client={client_id}, "
                    f"access_jti={rt.access_token_jti}"
                )
                # 撤销关联的 access_token
                at = self._access_tokens.get(rt.access_token_jti)
                if at:
                    at.revoked = True
                # 撤销 refresh_token 本身
                rt.revoked = True
                return None

            # 标记已使用
            rt.used = True
            return rt

    async def revoke_refresh_token(self, token: str) -> bool:
        """撤销 refresh_token"""
        async with self._lock:
            rt = self._refresh_tokens.get(token)
            if rt is None:
                return False
            rt.revoked = True
            return True

    # ============================================================
    # 统计与维护
    # ============================================================

    async def get_stats(self) -> Dict[str, int]:
        """获取存储统计信息"""
        # 触发清理
        await self._cleanup_expired()
        return {
            "total_clients": len(self._clients),
            "active_auth_codes": sum(
                1 for c in self._auth_codes.values()
                if not c.used and c.expires_at > time.time()
            ),
            "active_access_tokens": sum(
                1 for t in self._access_tokens.values()
                if not t.revoked and t.expires_at > time.time()
            ),
            "active_refresh_tokens": sum(
                1 for t in self._refresh_tokens.values()
                if not t.used and not t.revoked and t.expires_at > time.time()
            ),
        }

    async def _cleanup_expired(self) -> None:
        """清理过期条目（每 100 次调用触发一次）"""
        self._cleanup_counter += 1
        if self._cleanup_counter % 100 != 0:
            return

        async with self._lock:
            now = time.time()
            # 清理过期的授权码
            self._auth_codes = {
                k: v for k, v in self._auth_codes.items()
                if not v.used and v.expires_at > now
            }
            # 清理过期的 access_token
            self._access_tokens = {
                k: v for k, v in self._access_tokens.items()
                if not v.revoked and v.expires_at > now
            }
            # 清理过期的 refresh_token
            self._refresh_tokens = {
                k: v for k, v in self._refresh_tokens.items()
                if not v.revoked and v.expires_at > now
            }


# ============================================================
# 单例
# ============================================================

_oauth_store_instance: Optional[InMemoryOAuthStore] = None


def get_oauth_store() -> InMemoryOAuthStore:
    """
    获取 OAuth 存储单例

    返回：
        全局共享的 InMemoryOAuthStore 实例
    """
    global _oauth_store_instance
    if _oauth_store_instance is None:
        _oauth_store_instance = InMemoryOAuthStore()
    return _oauth_store_instance
