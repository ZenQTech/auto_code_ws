"""
# ============================================================
# OAuth 2.1 + PKCE API 路由 - MCP 授权规范实现
# ============================================================
# 核心作用：实现 MCP Authorization Spec 2026-06-18 的 4 个核心端点
# 端点：
#   - GET  /.well-known/oauth-authorization-server  RFC 8414 元数据
#   - POST /oauth/register                          RFC 7591 动态客户端注册
#   - GET  /oauth/authorize                         授权端点（自动授权）
#   - POST /oauth/token                             Token 端点（双流程）
#   - POST /oauth/revoke                            RFC 7009 Token 撤销
# 安全特性：
#   - PKCE S256 强制（拒绝 plain）
#   - state 参数 CSRF 防护
#   - redirect_uri 严格匹配
#   - 一次性 code + refresh token + 重放检测
#   - Audience binding 验证
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from app.services.mcp.oauth import get_oauth_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _oauth_error(error: str, description: str, status_code: int = 400) -> HTTPException:
    """
    构造 RFC 6749 §5.2 错误响应
    """
    return HTTPException(
        status_code=status_code,
        detail={"error": error, "error_description": description},
    )


@router.get("/.well-known/oauth-authorization-server")
async def authorization_server_metadata(request: Request):
    """
    RFC 8414: 授权服务器元数据

    客户端通过此端点发现 OAuth 端点和支持的能力
    """
    service = get_oauth_service()
    issuer = str(request.base_url).rstrip("/")
    return service.get_authorization_server_metadata(issuer)


@router.post("/oauth/register")
async def register_client(request: Request, body: Dict[str, Any]):
    """
    RFC 7591: 动态客户端注册

    请求体示例：
    ```json
    {
        "client_name": "My MCP Client",
        "redirect_uris": ["http://localhost:3000/callback"],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "scope": "read"
    }
    ```

    响应：客户端凭据 + 元数据
    """
    service = get_oauth_service()

    # 提取必填字段
    client_name = body.get("client_name")
    redirect_uris = body.get("redirect_uris")

    if not client_name:
        raise _oauth_error("invalid_request", "client_name 必填")
    if not redirect_uris:
        raise _oauth_error("invalid_request", "redirect_uris 必填")

    try:
        result = await service.register_client(
            client_name=client_name,
            redirect_uris=redirect_uris,
            token_endpoint_auth_method=body.get("token_endpoint_auth_method", "none"),
            grant_types=body.get("grant_types"),
            scope=body.get("scope", "read"),
            metadata=body.get("metadata"),
        )
        return result
    except ValueError as e:
        # 解析错误信息
        error_msg = str(e)
        if ":" in error_msg:
            error_code, error_desc = error_msg.split(":", 1)
            raise _oauth_error(error_code.strip(), error_desc.strip())
        raise _oauth_error("invalid_request", error_msg)


@router.get("/oauth/authorize")
async def authorize(
    request: Request,
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    code_challenge: str = Query(...),
    code_challenge_method: str = Query("S256"),
    state: Optional[str] = Query(None),
    scope: str = Query("read"),
):
    """
    授权端点（自动授权场景）

    在生产环境应该渲染同意页面供用户确认权限。
    本实现采用自动授权模式（用于内部测试和开发），
    自动创建授权码并重定向到 redirect_uri。

    必需参数：
      - response_type=code
      - client_id
      - redirect_uri
      - code_challenge (PKCE)
      - code_challenge_method=S256
    """
    # 验证 response_type
    if response_type != "code":
        raise _oauth_error(
            "unsupported_response_type",
            f"仅支持 response_type=code，得到 {response_type}",
        )

    service = get_oauth_service()

    try:
        result = await service.create_authorization_code(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            scope=scope,
            user_id="default-user",  # 自动授权使用默认用户
        )

        # 302 跳转到 redirect_uri
        redirect_url = f"{result['redirect_uri']}?code={result['code']}"
        if state:
            redirect_url += f"&state={state}"

        return RedirectResponse(url=redirect_url, status_code=302)

    except ValueError as e:
        error_msg = str(e)
        if ":" in error_msg:
            error_code, error_desc = error_msg.split(":", 1)
            raise _oauth_error(error_code.strip(), error_desc.strip())
        raise _oauth_error("invalid_request", error_msg)


@router.post("/oauth/token")
async def token(request: Request):
    """
    Token 端点 - 支持双 Grant Type

    1. authorization_code:
       grant_type=authorization_code
       &code=xxx
       &client_id=xxx
       &redirect_uri=xxx
       &code_verifier=xxx

    2. refresh_token:
       grant_type=refresh_token
       &refresh_token=xxx
       &client_id=xxx

    响应：access_token + refresh_token
    """
    # 解析 form-encoded body
    form = await request.form()
    grant_type = form.get("grant_type")
    client_id = form.get("client_id")

    if not grant_type:
        raise _oauth_error("invalid_request", "grant_type 必填")
    if not client_id:
        raise _oauth_error("invalid_client", "client_id 必填")

    service = get_oauth_service()

    try:
        if grant_type == "authorization_code":
            code = form.get("code")
            redirect_uri = form.get("redirect_uri")
            code_verifier = form.get("code_verifier")

            if not code or not redirect_uri or not code_verifier:
                raise _oauth_error(
                    "invalid_request",
                    "authorization_code grant 需要 code/redirect_uri/code_verifier",
                )

            return await service.exchange_authorization_code(
                code=code,
                client_id=client_id,
                redirect_uri=redirect_uri,
                code_verifier=code_verifier,
            )

        elif grant_type == "refresh_token":
            refresh_token = form.get("refresh_token")
            if not refresh_token:
                raise _oauth_error(
                    "invalid_request",
                    "refresh_token grant 需要 refresh_token 字段",
                )

            return await service.refresh_access_token(
                refresh_token=refresh_token,
                client_id=client_id,
            )

        else:
            raise _oauth_error(
                "unsupported_grant_type",
                f"不支持的 grant_type: {grant_type}",
            )

    except ValueError as e:
        error_msg = str(e)
        if ":" in error_msg:
            error_code, error_desc = error_msg.split(":", 1)
            raise _oauth_error(error_code.strip(), error_desc.strip())
        raise _oauth_error("invalid_grant", error_msg)


@router.post("/oauth/revoke")
async def revoke(
    request: Request,
    token: str = Form(...),
    token_type_hint: Optional[str] = Form(None),
):
    """
    RFC 7009: Token 撤销

    撤销 access_token 或 refresh_token
    """
    service = get_oauth_service()
    success = await service.revoke_token(
        token=token,
        token_type_hint=token_type_hint or "access_token",
    )
    return {"success": success, "revoked": success}
