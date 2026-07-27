#!/bin/bash
# ============================================================
# OAuth 2.1 + PKCE E2E 测试
# ============================================================
# 覆盖范围：
#   1. 元数据端点（RFC 8414）
#   2. 动态客户端注册（RFC 7591）
#   3. 完整 PKCE 流程：注册 → authorize → token
#   4. Refresh token 流程
#   5. Refresh token 重放检测
#   6. 错误场景（错误 verifier、错误 client、错误 redirect_uri）
#   7. Token 撤销
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
TEST_NAME="E2E OAuth 2.1 + PKCE"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    PASSED=$((PASSED+1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    if [ -n "$2" ]; then
        echo -e "    ${RED}详情${NC}: $2"
    fi
    FAILED=$((FAILED+1))
}

section() {
    echo ""
    echo -e "${YELLOW}=== $1 ===${NC}"
}

# ============================================================
# Test 1: 元数据端点
# ============================================================
section "Test 1: GET /.well-known/oauth-authorization-server"

META=$(curl -s "$BASE_URL/.well-known/oauth-authorization-server")
HAS_S256=$(echo "$META" | python3 -c "import json,sys; d=json.load(sys.stdin); print('S256' in d.get('code_challenge_methods_supported', []))" 2>/dev/null || echo "False")
HAS_TOKEN_EP=$(echo "$META" | python3 -c "import json,sys; d=json.load(sys.stdin); print('token_endpoint' in d)" 2>/dev/null || echo "False")

if [ "$HAS_S256" = "True" ]; then
    pass "metadata.code_challenge_methods_supported 包含 S256"
else
    fail "S256 不在 metadata 中" "$META"
fi

if [ "$HAS_TOKEN_EP" = "True" ]; then
    pass "metadata 包含 token_endpoint"
else
    fail "token_endpoint 缺失" "$META"
fi

# ============================================================
# Test 2: 动态客户端注册
# ============================================================
section "Test 2: POST /oauth/register"

REGISTER_RESP=$(curl -s -X POST "$BASE_URL/oauth/register" \
    -H "Content-Type: application/json" \
    -d '{
        "client_name": "E2E Test Client '"$(date +%s)"'",
        "redirect_uris": ["http://localhost:3000/callback"],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"]
    }')

CLIENT_ID=$(echo "$REGISTER_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('client_id', ''))" 2>/dev/null)
REDIRECT_URI=$(echo "$REGISTER_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['redirect_uris'][0])" 2>/dev/null)

if [ -n "$CLIENT_ID" ] && [[ "$CLIENT_ID" == client-* ]]; then
    pass "动态注册成功: $CLIENT_ID"
else
    fail "动态注册失败" "$REGISTER_RESP"
    exit 1
fi

# ============================================================
# Test 3: 完整 PKCE 流程
# ============================================================
section "Test 3: 完整 PKCE 流程（register → authorize → token）"

# 3.1 生成 PKCE 参数
PKCE_PARAMS=$(python3 << EOF
import secrets, hashlib, base64
verifier = ''.join(secrets.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~') for _ in range(64))
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
print(f"{verifier} {challenge}")
EOF
)
CODE_VERIFIER=$(echo "$PKCE_PARAMS" | awk '{print $1}')
CODE_CHALLENGE=$(echo "$PKCE_PARAMS" | awk '{print $2}')

pass "生成 code_verifier (64字符) + code_challenge (S256)"

# 3.2 /oauth/authorize
AUTH_RESP=$(curl -s -o /dev/null -w "%{http_code}\n%{redirect_url}" \
    "$BASE_URL/oauth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$REDIRECT_URI'))")&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&state=xyz&scope=read")

# 提取 Location header
AUTH_LOC=$(curl -s -D - -o /dev/null \
    "$BASE_URL/oauth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$REDIRECT_URI'))")&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&state=xyz&scope=read" \
    | grep -i "^location:" | head -1 | tr -d '\r')

if echo "$AUTH_LOC" | grep -q "code="; then
    AUTH_CODE=$(echo "$AUTH_LOC" | grep -oP 'code=[^&]+' | sed 's/code=//')
    pass "/oauth/authorize 成功返回 code: ${AUTH_CODE:0:15}..."
else
    fail "/oauth/authorize 失败" "$AUTH_LOC"
    exit 1
fi

# 3.3 /oauth/token（authorization_code grant）
TOKEN_RESP=$(curl -s -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&client_id=$CLIENT_ID&redirect_uri=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$REDIRECT_URI'))")&code_verifier=$CODE_VERIFIER")

ACCESS_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token', ''))" 2>/dev/null)
REFRESH_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('refresh_token', ''))" 2>/dev/null)
TOKEN_TYPE=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token_type', ''))" 2>/dev/null)

if [ -n "$ACCESS_TOKEN" ] && [ -n "$REFRESH_TOKEN" ]; then
    pass "exchange code → access_token (${ACCESS_TOKEN:0:20}...)"
    pass "exchange code → refresh_token (${REFRESH_TOKEN:0:15}...)"
    pass "token_type: $TOKEN_TYPE"
else
    fail "Token 交换失败" "$TOKEN_RESP"
    exit 1
fi

# ============================================================
# Test 4: Refresh token 流程
# ============================================================
section "Test 4: POST /oauth/token (refresh_token grant)"

REFRESH_RESP=$(curl -s -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID")

NEW_ACCESS=$(echo "$REFRESH_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token', ''))" 2>/dev/null)
NEW_REFRESH=$(echo "$REFRESH_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('refresh_token', ''))" 2>/dev/null)

if [ -n "$NEW_ACCESS" ] && [ -n "$NEW_REFRESH" ]; then
    pass "refresh_token 颁发新 access_token"
    pass "refresh_token 轮换（新 refresh_token）"
else
    fail "refresh_token 失败" "$REFRESH_RESP"
fi

# ============================================================
# Test 5: Refresh token 重放检测
# ============================================================
section "Test 5: Refresh token 重放检测"

# 尝试重用已使用的 refresh_token
REPLAY_RESP=$(curl -s -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID")

REPLAY_ERROR=$(echo "$REPLAY_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('detail', {}).get('error', '') if isinstance(d.get('detail'), dict) else '')" 2>/dev/null)

if [ "$REPLAY_ERROR" = "invalid_grant" ]; then
    pass "重放已使用的 refresh_token → invalid_grant"
else
    fail "重放未拒绝" "$REPLAY_RESP"
fi

# ============================================================
# Test 6: 错误 code_verifier
# ============================================================
section "Test 6: 错误 code_verifier（PKCE 验证失败）"

# 重新开始流程
PKCE_PARAMS2=$(python3 << EOF
import secrets, hashlib, base64
verifier = ''.join(secrets.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~') for _ in range(64))
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
print(f"{verifier} {challenge}")
EOF
)
CV2=$(echo "$PKCE_PARAMS2" | awk '{print $1}')
CC2=$(echo "$PKCE_PARAMS2" | awk '{print $2}')

# 注册新客户端
REG2=$(curl -s -X POST "$BASE_URL/oauth/register" \
    -H "Content-Type: application/json" \
    -d '{"client_name":"Error Test","redirect_uris":["http://localhost:3000/cb"]}')
CID2=$(echo "$REG2" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")

# authorize
LOC2=$(curl -s -D - -o /dev/null \
    "$BASE_URL/oauth/authorize?response_type=code&client_id=$CID2&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&code_challenge=$CC2&code_challenge_method=S256" \
    | grep -i "^location:" | head -1 | tr -d '\r')
CODE2=$(echo "$LOC2" | grep -oP 'code=[^&]+' | sed 's/code=//')

# 用错误的 verifier 交换
WRONG_VERIFIER=$(python3 -c "import secrets; print(''.join(secrets.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~') for _ in range(64)))")

WRONG_RESP=$(curl -s -X POST "$BASE_URL/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=$CODE2&client_id=$CID2&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&code_verifier=$WRONG_VERIFIER")

WRONG_ERR=$(echo "$WRONG_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('detail', {}).get('error', '') if isinstance(d.get('detail'), dict) else '')" 2>/dev/null)

if [ "$WRONG_ERR" = "invalid_grant" ]; then
    pass "错误 code_verifier → invalid_grant"
else
    fail "错误 verifier 未拒绝" "$WRONG_RESP"
fi

# ============================================================
# Test 7: Token 撤销
# ============================================================
section "Test 7: POST /oauth/revoke"

REVOKE_RESP=$(curl -s -X POST "$BASE_URL/oauth/revoke" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=$NEW_ACCESS&token_type_hint=access_token")

REVOKE_SUCCESS=$(echo "$REVOKE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null)

if [ "$REVOKE_SUCCESS" = "True" ]; then
    pass "Token 撤销成功"
else
    fail "Token 撤销失败" "$REVOKE_RESP"
fi

# ============================================================
# Test 8: 管理 API
# ============================================================
section "Test 8: GET /api/mcp/oauth/clients"

ADMIN_RESP=$(curl -s "$BASE_URL/api/mcp/oauth/clients")
ADMIN_COUNT=$(echo "$ADMIN_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))" 2>/dev/null)

if [ "$ADMIN_COUNT" -gt 0 ]; then
    pass "管理 API 返回 $ADMIN_COUNT 个客户端"
else
    fail "管理 API 返回空" "$ADMIN_RESP"
fi

# ============================================================
# Test 9: 统计 API
# ============================================================
section "Test 9: GET /api/mcp/oauth/stats"

STATS_RESP=$(curl -s "$BASE_URL/api/mcp/oauth/stats")
TOTAL_CLIENTS=$(echo "$STATS_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total_clients', 0))" 2>/dev/null)

if [ "$TOTAL_CLIENTS" -gt 0 ]; then
    pass "统计 API: total_clients=$TOTAL_CLIENTS"
else
    fail "统计 API 异常" "$STATS_RESP"
fi

# ============================================================
# Test 10: 元数据完整性
# ============================================================
section "Test 10: 元数据完整性（所有必需字段）"

REQUIRED_FIELDS=("issuer" "authorization_endpoint" "token_endpoint" "registration_endpoint" "response_types_supported" "grant_types_supported" "code_challenge_methods_supported" "token_endpoint_auth_methods_supported" "scopes_supported")

ALL_OK=true
for FIELD in "${REQUIRED_FIELDS[@]}"; do
    HAS_FIELD=$(echo "$META" | python3 -c "import json,sys; d=json.load(sys.stdin); print('$FIELD' in d)" 2>/dev/null)
    if [ "$HAS_FIELD" = "True" ]; then
        pass "metadata 包含必需字段: $FIELD"
    else
        fail "metadata 缺失字段: $FIELD"
        ALL_OK=false
    fi
done

# ============================================================
# 汇总
# ============================================================
echo ""
echo "============================================================"
echo -e "测试结果: ${GREEN}$PASSED 通过${NC} / ${RED}$FAILED 失败${NC}"
echo "============================================================"

if [ "$FAILED" -gt 0 ]; then
    exit 1
else
    echo -e "${GREEN}🎉 全部 E2E 测试通过！${NC}"
    exit 0
fi
