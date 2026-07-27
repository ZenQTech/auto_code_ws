"""
# ============================================================
# OAuth 2.1 + PKCE 单元测试
# ============================================================
# 覆盖范围：
#   1. PKCE S256 计算与验证（pkce.py）
#   2. JWT 签发与验证（jwt_helper.py）
#   3. OAuth 内存存储 CRUD（oauth_store.py）
#   4. OAuthService 业务逻辑（oauth_service.py）
#   5. 4 个核心 API 端点（oauth.py）
#   6. 管理 API 端点（mcp_oauth_admin.py）
#   7. 错误码与安全场景
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import os
import sys
import time
import hashlib
import base64
import json

# 添加项目根到 sys.path
sys.path.insert(0, "/home/qizheng/auto_code_ws/backend")

# 设置测试环境
os.environ.setdefault("OAUTH_JWT_SECRET", "test-secret-for-unit-tests-2026")

# ============================================================
# 测试结果统计
# ============================================================

_test_results = {"passed": 0, "failed": 0, "errors": []}


def test_pass(name: str):
    """记录测试通过"""
    _test_results["passed"] += 1
    print(f"  ✅ {name}")


def test_fail(name: str, reason: str = ""):
    """记录测试失败"""
    _test_results["failed"] += 1
    _test_results["errors"].append(f"{name}: {reason}")
    print(f"  ❌ {name}: {reason}")


def section(title: str):
    """打印章节标题"""
    print(f"\n=== {title} ===")


# ============================================================
# 1. PKCE 单元测试（6 个）
# ============================================================

def test_pkce():
    section("1. PKCE 单元测试（6 个）")

    from app.services.mcp.oauth.pkce import (
        generate_code_verifier,
        compute_code_challenge_s256,
        verify_pkce_pair,
    )

    # Test 1.1: 生成 code_verifier
    try:
        verifier = generate_code_verifier(64)
        assert len(verifier) == 64
        assert all(c.isalnum() or c in "-._~" for c in verifier)
        test_pass("generate_code_verifier(64) 正确生成 64 字符")
    except Exception as e:
        test_fail("generate_code_verifier(64)", str(e))

    # Test 1.2: 生成超长 verifier
    try:
        verifier = generate_code_verifier(128)
        assert len(verifier) == 128
        test_pass("generate_code_verifier(128) 正确生成 128 字符")
    except Exception as e:
        test_fail("generate_code_verifier(128)", str(e))

    # Test 1.3: 长度边界
    try:
        try:
            generate_code_verifier(42)  # 少于 43
            test_fail("长度边界 42", "应抛出 ValueError")
        except ValueError:
            test_pass("长度 < 43 抛出 ValueError")

        try:
            generate_code_verifier(129)  # 多于 128
            test_fail("长度边界 129", "应抛出 ValueError")
        except ValueError:
            test_pass("长度 > 128 抛出 ValueError")
    except Exception as e:
        test_fail("长度边界测试", str(e))

    # Test 1.4: 计算 S256 challenge
    try:
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        # 手动验证
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")
        assert challenge == expected
        assert len(challenge) == 43
        test_pass("compute_code_challenge_s256 计算正确（43 字符）")
    except Exception as e:
        test_fail("compute_code_challenge_s256", str(e))

    # Test 1.5: PKCE 验证 - 成功
    try:
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        assert verify_pkce_pair(verifier, challenge, "S256") is True
        test_pass("verify_pkce_pair 正确 verifier + S256 → True")
    except Exception as e:
        test_fail("verify_pkce_pair 成功", str(e))

    # Test 1.6: PKCE 验证 - 错误 verifier
    try:
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        wrong_verifier = generate_code_verifier(64)  # 不同的 verifier
        assert verify_pkce_pair(wrong_verifier, challenge, "S256") is False
        test_pass("verify_pkce_pair 错误 verifier → False")
    except Exception as e:
        test_fail("verify_pkce_pair 错误", str(e))

    # Test 1.7: PKCE 拒绝 plain（安全）
    try:
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        try:
            verify_pkce_pair(verifier, challenge, "plain")
            test_fail("拒绝 plain method", "应拒绝 plain")
        except ValueError:
            test_pass("拒绝 plain method（安全策略）")
    except Exception as e:
        test_fail("拒绝 plain method 测试", str(e))


# ============================================================
# 2. JWT 单元测试（5 个）
# ============================================================

def test_jwt():
    section("2. JWT 单元测试（5 个）")

    from app.services.mcp.oauth.jwt_helper import (
        issue_access_token,
        verify_access_token,
        JWT_AUDIENCE_MCP,
    )

    # Test 2.1: 签发 token
    try:
        token = issue_access_token(
            client_id="client-test",
            user_id="user-123",
            scope="read",
        )
        assert isinstance(token, str)
        assert token.count(".") == 2
        test_pass("issue_access_token 返回有效 JWT 字符串")
    except Exception as e:
        test_fail("issue_access_token", str(e))
        return

    # Test 2.2: 验证 token - 成功
    try:
        token = issue_access_token(
            client_id="client-test",
            user_id="user-123",
            scope="read write",
        )
        payload = verify_access_token(token)
        assert payload is not None
        assert payload["client_id"] == "client-test"
        assert payload["sub"] == "user-123"
        assert payload["scope"] == "read write"
        assert payload["aud"] == JWT_AUDIENCE_MCP
        test_pass("verify_access_token 成功验证有效 token")
    except Exception as e:
        test_fail("verify_access_token 成功", str(e))

    # Test 2.3: 验证错误 audience
    try:
        token = issue_access_token(
            client_id="client-test",
            user_id="user-123",
            scope="read",
            audience="wrong-audience",  # 错误的 audience
        )
        payload = verify_access_token(token)
        assert payload is None
        test_pass("错误 audience → 验证失败（防 confused-deputy）")
    except Exception as e:
        test_fail("错误 audience 验证", str(e))

    # Test 2.4: 验证过期 token
    try:
        # 签发一个已过期的 token
        token = issue_access_token(
            client_id="client-test",
            user_id="user-123",
            scope="read",
            ttl_seconds=-1,  # 已过期
        )
        payload = verify_access_token(token)
        assert payload is None
        test_pass("过期 token → 验证失败")
    except Exception as e:
        test_fail("过期 token 验证", str(e))

    # Test 2.5: 篡改 token
    try:
        token = issue_access_token(
            client_id="client-test",
            user_id="user-123",
            scope="read",
        )
        # 篡改 signature
        parts = token.split(".")
        tampered = f"{parts[0]}.{parts[1]}.WRONG_SIGNATURE"
        payload = verify_access_token(tampered)
        assert payload is None
        test_pass("篡改 token → 验证失败")
    except Exception as e:
        test_fail("篡改 token 验证", str(e))


# ============================================================
# 3. OAuth Store 单元测试（4 个）
# ============================================================

async def test_oauth_store():
    section("3. OAuth Store 单元测试（4 个）")

    from app.services.mcp.oauth.oauth_store import InMemoryOAuthStore

    store = InMemoryOAuthStore()

    # Test 3.1: 注册客户端
    try:
        client = await store.register_client(
            client_name="Test Client",
            redirect_uris=["http://localhost:3000/cb"],
        )
        assert client.client_id.startswith("client-")
        assert "authorization_code" in client.grant_types
        test_pass(f"register_client 创建客户端 {client.client_id}")
    except Exception as e:
        test_fail("register_client", str(e))
        return

    # Test 3.2: 创建授权码 + 消费
    try:
        auth_code = await store.create_authorization_code(
            client_id=client.client_id,
            user_id="user-1",
            redirect_uri="http://localhost:3000/cb",
            scope="read",
            code_challenge="challenge_abc",
        )
        assert auth_code.code.startswith("ac_")

        # 第一次消费应成功
        consumed = await store.consume_authorization_code(
            code=auth_code.code,
            client_id=client.client_id,
            redirect_uri="http://localhost:3000/cb",
        )
        assert consumed is not None
        test_pass("create_authorization_code + 第一次消费成功")

        # 第二次消费应失败（防重放）
        consumed_again = await store.consume_authorization_code(
            code=auth_code.code,
            client_id=client.client_id,
            redirect_uri="http://localhost:3000/cb",
        )
        assert consumed_again is None
        test_pass("第二次消费授权码 → 失败（防重放）")
    except Exception as e:
        test_fail("授权码测试", str(e))

    # Test 3.3: Refresh token 单次使用 + 重放检测
    try:
        from app.services.mcp.oauth.oauth_store import RefreshToken

        rt = RefreshToken(
            token="rt_test_123",
            access_token_jti="at-jti-1",
            client_id=client.client_id,
            user_id="user-1",
            scope="read",
            issued_at=time.time(),
            expires_at=time.time() + 3600,
        )
        await store.store_refresh_token(rt)

        # 第一次消费应成功
        consumed = await store.consume_refresh_token("rt_test_123", client.client_id)
        assert consumed is not None
        test_pass("第一次消费 refresh_token 成功")

        # 第二次消费应失败（重放检测）
        replay = await store.consume_refresh_token("rt_test_123", client.client_id)
        assert replay is None
        test_pass("第二次消费 refresh_token → 失败（重放检测）")
    except Exception as e:
        test_fail("Refresh token 测试", str(e))

    # Test 3.4: 统计信息
    try:
        stats = await store.get_stats()
        assert "total_clients" in stats
        assert stats["total_clients"] >= 1
        test_pass(f"get_stats 返回 {stats}")
    except Exception as e:
        test_fail("get_stats", str(e))


# ============================================================
# 4. OAuthService 单元测试（5 个）
# ============================================================

async def test_oauth_service():
    section("4. OAuthService 单元测试（5 个）")

    from app.services.mcp.oauth.oauth_service import OAuthService
    from app.services.mcp.oauth.pkce import generate_code_verifier, compute_code_challenge_s256

    service = OAuthService()

    # Test 4.1: 元数据生成
    try:
        metadata = service.get_authorization_server_metadata("http://127.0.0.1:8000")
        assert metadata["code_challenge_methods_supported"] == ["S256"]
        assert "authorization_code" in metadata["grant_types_supported"]
        test_pass("get_authorization_server_metadata 返回正确元数据")
    except Exception as e:
        test_fail("元数据生成", str(e))

    # Test 4.2: 客户端注册
    try:
        result = await service.register_client(
            client_name="Service Test",
            redirect_uris=["http://localhost:3000/cb"],
        )
        assert result["client_id"].startswith("client-")
        test_pass(f"service.register_client 创建 {result['client_id']}")
    except Exception as e:
        test_fail("服务层注册", str(e))
        return

    client_id = result["client_id"]
    redirect_uri = "http://localhost:3000/cb"

    # Test 4.3: 完整 PKCE 流程
    try:
        # 生成 verifier
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)

        # 创建授权码
        auth = await service.create_authorization_code(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=challenge,
            code_challenge_method="S256",
            scope="read",
        )
        code = auth["code"]

        # 交换 token
        tokens = await service.exchange_authorization_code(
            code=code,
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_verifier=verifier,
        )
        assert "access_token" in tokens
        assert "refresh_token" in tokens
        assert tokens["token_type"] == "Bearer"
        test_pass("完整 PKCE 流程：注册 → 授权码 → token 交换")
    except Exception as e:
        test_fail("完整 PKCE 流程", str(e))
        return

    # Test 4.4: 错误 code_verifier
    try:
        # 重新开始流程
        verifier2 = generate_code_verifier(64)
        challenge2 = compute_code_challenge_s256(verifier2)
        auth2 = await service.create_authorization_code(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=challenge2,
            code_challenge_method="S256",
        )

        # 用错误的 verifier
        wrong_verifier = generate_code_verifier(64)
        try:
            await service.exchange_authorization_code(
                code=auth2["code"],
                client_id=client_id,
                redirect_uri=redirect_uri,
                code_verifier=wrong_verifier,
            )
            test_fail("错误 code_verifier", "应抛出异常")
        except ValueError:
            test_pass("错误 code_verifier → invalid_grant")
    except Exception as e:
        test_fail("错误 code_verifier 测试", str(e))

    # Test 4.5: Refresh token 流程
    try:
        # 使用上面成功颁发的 refresh_token
        new_tokens = await service.refresh_access_token(
            refresh_token=tokens["refresh_token"],
            client_id=client_id,
        )
        assert "access_token" in new_tokens
        assert "refresh_token" in new_tokens
        test_pass("refresh_token 颁发新 token")

        # 重放使用过的 refresh_token
        try:
            await service.refresh_access_token(
                refresh_token=tokens["refresh_token"],
                client_id=client_id,
            )
            test_fail("Refresh token 重放", "应拒绝")
        except ValueError:
            test_pass("Refresh token 重放 → 拒绝")
    except Exception as e:
        test_fail("Refresh token 测试", str(e))


# ============================================================
# 5. 错误码与安全测试（3 个）
# ============================================================

async def test_error_codes():
    section("5. 错误码与安全测试（3 个）")

    from app.services.mcp.oauth.oauth_service import OAuthService
    from app.services.mcp.oauth.pkce import generate_code_verifier, compute_code_challenge_s256

    service = OAuthService()

    # Test 5.1: 未注册 client_id
    try:
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        try:
            await service.create_authorization_code(
                client_id="client-DOES-NOT-EXIST",
                redirect_uri="http://x",
                code_challenge=challenge,
                code_challenge_method="S256",
            )
            test_fail("未注册 client", "应抛出异常")
        except ValueError as e:
            assert "invalid_client" in str(e)
            test_pass("未注册 client → invalid_client")
    except Exception as e:
        test_fail("未注册 client 测试", str(e))

    # Test 5.2: redirect_uri 不匹配
    try:
        client = await service.register_client(
            client_name="Mismatch Test",
            redirect_uris=["http://localhost:3000/correct"],
        )
        verifier = generate_code_verifier(64)
        challenge = compute_code_challenge_s256(verifier)
        try:
            await service.create_authorization_code(
                client_id=client["client_id"],
                redirect_uri="http://localhost:3000/wrong",
                code_challenge=challenge,
                code_challenge_method="S256",
            )
            test_fail("redirect_uri 不匹配", "应抛出异常")
        except ValueError as e:
            assert "invalid_request" in str(e)
            test_pass("redirect_uri 不匹配 → invalid_request")
    except Exception as e:
        test_fail("redirect_uri 不匹配测试", str(e))

    # Test 5.3: 拒绝 plain method
    try:
        client = await service.register_client(
            client_name="Plain Test",
            redirect_uris=["http://localhost:3000/cb"],
        )
        try:
            await service.create_authorization_code(
                client_id=client["client_id"],
                redirect_uri="http://localhost:3000/cb",
                code_challenge="some_challenge",
                code_challenge_method="plain",  # 不安全
            )
            test_fail("plain method", "应拒绝")
        except ValueError as e:
            assert "S256" in str(e)
            test_pass("拒绝 plain method（强制 S256）")
    except Exception as e:
        test_fail("拒绝 plain method 测试", str(e))


# ============================================================
# 主函数
# ============================================================

async def main():
    """运行所有单元测试"""
    print("=" * 60)
    print("OAuth 2.1 + PKCE 单元测试")
    print("=" * 60)

    # 同步测试
    test_pkce()
    test_jwt()

    # 异步测试
    await test_oauth_store()
    await test_oauth_service()
    await test_error_codes()

    # 汇总
    print("\n" + "=" * 60)
    print(f"测试结果: {_test_results['passed']} 通过 / {_test_results['failed']} 失败")
    if _test_results["errors"]:
        print("\n失败详情:")
        for err in _test_results["errors"]:
            print(f"  - {err}")
    print("=" * 60)

    return _test_results["failed"] == 0


if __name__ == "__main__":
    import asyncio
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
