#!/bin/bash
# ============================================================
# 企业级 Plugin Hub - 端到端 (E2E) 测试
# ============================================================
# 测试范围：覆盖所有 32 个 REST 端点
# 用法：bash test_e2e_enterprise_hub.sh
# 前置：后端服务运行在 http://localhost:8000
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本（55+ 断言）
# ============================================================

set -e

BASE="http://localhost:8000/api/enterprise-hub"
TOTAL=0
PASSED=0
FAILED=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

assert_eq() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    TOTAL=$((TOTAL + 1))
    if [ "$actual" = "$expected" ]; then
        PASSED=$((PASSED + 1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAILED=$((FAILED + 1))
        echo -e "  ${RED}✗${NC} $desc (expected '$expected', got '$actual')"
    fi
}

assert_contains() {
    local desc="$1"
    local content="$2"
    local pattern="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$content" | grep -q "$pattern"; then
        PASSED=$((PASSED + 1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAILED=$((FAILED + 1))
        echo -e "  ${RED}✗${NC} $desc (pattern '$pattern' not found)"
    fi
}

assert_ge() {
    local desc="$1"
    local actual="$2"
    local min="$3"
    TOTAL=$((TOTAL + 1))
    if [ "$actual" -ge "$min" ]; then
        PASSED=$((PASSED + 1))
        echo -e "  ${GREEN}✓${NC} $desc (got $actual >= $min)"
    else
        FAILED=$((FAILED + 1))
        echo -e "  ${RED}✗${NC} $desc (got $actual, expected >= $min)"
    fi
}

section() {
    echo ""
    echo -e "${YELLOW}==== $1 ====${NC}"
}

# ============================================================
# 1. 健康 & 统计
# ============================================================

section "1. Health & Stats"

RESP=$(curl -s -m 5 "$BASE/health")
assert_contains "health status ok" "$RESP" '"status":"ok"'
assert_contains "health version" "$RESP" '"version":"v6.28.0"'

RESP=$(curl -s -m 5 "$BASE/stats")
assert_contains "stats catalog field" "$RESP" '"catalog"'

# ============================================================
# 2. 插件目录
# ============================================================

section "2. Plugin Catalog"

RESP=$(curl -s -m 5 "$BASE/catalog")
TOTAL_PLUGINS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_ge "catalog has >= 90 plugins" "$TOTAL_PLUGINS" "90"

RESP=$(curl -s -m 5 "$BASE/catalog/featured?limit=10")
FEATURED_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_eq "featured 10 plugins" "$FEATURED_COUNT" "10"

RESP=$(curl -s -m 5 "$BASE/categories")
CATS=$(echo "$RESP" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['items']))")
assert_eq "categories 12" "$CATS" "12"

RESP=$(curl -s -m 5 "$BASE/catalog?q=Snyk")
assert_contains "search Snyk" "$RESP" "Snyk"

RESP=$(curl -s -m 5 "$BASE/catalog?category=security")
SEC_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_ge "security category >= 10" "$SEC_COUNT" "10"

RESP=$(curl -s -m 5 "$BASE/catalog?enterprise_only=true")
ENT_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_ge "enterprise ready >= 30" "$ENT_COUNT" "30"

RESP=$(curl -s -m 5 "$BASE/catalog?source=official")
OFF_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_ge "official source >= 20" "$OFF_COUNT" "20"

RESP=$(curl -s -m 5 "$BASE/catalog/plugin_ai-ml_code-generator")
assert_contains "plugin detail" "$RESP" "code-generator"

RESP=$(curl -s -m 5 "$BASE/catalog/plugin_nonexistent")
assert_contains "404 for missing plugin" "$RESP" "not found"

# ============================================================
# 3. 组织管理
# ============================================================

section "3. Organization Management"

ORG_NAME="TestCo_$(date +%s)"
RESP=$(curl -s -m 5 -X POST "$BASE/orgs" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ORG_NAME\",\"owner\":\"alice@test.com\",\"actor\":\"alice@test.com\"}")
ORG_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['org_id'])")
assert_contains "create org" "$RESP" "\"name\":\"$ORG_NAME\""

# 邀请 admin
RESP=$(curl -s -m 5 -X POST "$BASE/orgs/$ORG_ID/members" \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@test.com","role":"admin","actor":"alice@test.com"}')
assert_contains "invite admin" "$RESP" '"role":"admin"'
ADMIN_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['member_id'])")

# 邀请 developer
RESP=$(curl -s -m 5 -X POST "$BASE/orgs/$ORG_ID/members" \
    -H "Content-Type: application/json" \
    -d '{"email":"bob@test.com","role":"developer","actor":"alice@test.com"}')
assert_contains "invite dev" "$RESP" '"role":"developer"'
DEV_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['member_id'])")

# 邀请 viewer
RESP=$(curl -s -m 5 -X POST "$BASE/orgs/$ORG_ID/members" \
    -H "Content-Type: application/json" \
    -d '{"email":"viewer@test.com","role":"viewer","actor":"alice@test.com"}')
assert_contains "invite viewer" "$RESP" '"role":"viewer"'

# 列出 org
RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID")
assert_contains "get org" "$RESP" "$ORG_NAME"

# 列出 members
RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/members")
MEM_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_eq "3 members" "$MEM_COUNT" "3"

# 列出所有 org
RESP=$(curl -s -m 5 "$BASE/orgs")
assert_contains "list orgs" "$RESP" "$ORG_NAME"

# 权限查询
RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/permissions?actor=$DEV_ID")
assert_contains "perm role developer" "$RESP" '"role":"developer"'
assert_contains "perm plugin:read" "$RESP" "plugin:read"

# ============================================================
# 4. 团队管理
# ============================================================

section "4. Team Management"

RESP=$(curl -s -m 5 -X POST "$BASE/orgs/$ORG_ID/teams" \
    -H "Content-Type: application/json" \
    -d '{"name":"Backend","actor":"alice@test.com","budget_usd":500.0}')
TEAM_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['team_id'])")
assert_contains "create team" "$RESP" "Backend"

RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/teams")
assert_contains "list teams" "$RESP" "Backend"

# ============================================================
# 5. RBAC - 角色更新
# ============================================================

section "5. RBAC Role Update"

RESP=$(curl -s -m 5 -X PUT "$BASE/orgs/$ORG_ID/members/$DEV_ID/role" \
    -H "Content-Type: application/json" \
    -d "{\"role\":\"manager\",\"actor\":\"$ADMIN_ID\"}")
assert_contains "update role" "$RESP" '"role":"manager"'

# ============================================================
# 6. 安装 + 成本
# ============================================================

section "6. Plugin Install & Cost"

RESP=$(curl -s -m 5 -X POST "$BASE/install" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_ai-ml_code-generator\",\"member_id\":\"$DEV_ID\",\"cost_usd\":2.5}")
assert_contains "install ok" "$RESP" '"ok":true'

RESP=$(curl -s -m 5 -X POST "$BASE/install" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_security_snyk\",\"member_id\":\"$DEV_ID\",\"cost_usd\":5.0}")
assert_contains "install 2nd plugin" "$RESP" '"ok":true'

# 记录成本
RESP=$(curl -s -m 5 -X POST "$BASE/cost/records" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_ai-ml_code-generator\",\"member_id\":\"$DEV_ID\",\"cost_usd\":0.5,\"actor\":\"$ADMIN_ID\"}")
assert_contains "record cost" "$RESP" '"cost_usd":0.5'

# 成本摘要
RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/cost/summary")
assert_contains "cost summary total" "$RESP" '"total_usd"'
assert_contains "cost summary period" "$RESP" '"period"'

# 成本明细
RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/cost/breakdown")
assert_contains "cost breakdown by_plugin" "$RESP" '"by_plugin"'
assert_contains "cost breakdown top" "$RESP" '"top_plugins"'

# 设置配额
RESP=$(curl -s -m 5 -X POST "$BASE/orgs/$ORG_ID/quotas" \
    -H "Content-Type: application/json" \
    -d "{\"quotas\":{\"max_members\":50,\"monthly_budget_usd\":1000.0},\"actor\":\"$ADMIN_ID\"}")
assert_contains "update quotas" "$RESP" '"quotas"'

RESP=$(curl -s -m 5 "$BASE/orgs/$ORG_ID/quotas")
assert_contains "get quotas" "$RESP" '"monthly_budget_usd"'

# ============================================================
# 7. 审批工作流
# ============================================================

section "7. Approval Workflow"

RESP=$(curl -s -m 5 -X POST "$BASE/approvals" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_security_trivy\",\"requested_by\":\"$DEV_ID\",\"reason\":\"for security\"}")
REQ_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['request_id'])")
assert_contains "create approval" "$RESP" '"status":"pending"'

RESP=$(curl -s -m 5 "$BASE/approvals?status=pending")
assert_contains "list pending" "$RESP" "pending"

RESP=$(curl -s -m 5 -X POST "$BASE/approvals/$REQ_ID/approve" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"reviewer\":\"$ADMIN_ID\",\"comment\":\"ok\"}")
assert_contains "approve" "$RESP" '"status":"approved"'

# 创建一个并 reject
RESP=$(curl -s -m 5 -X POST "$BASE/approvals" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_security_trivy\",\"requested_by\":\"$DEV_ID\"}")
REQ_ID2=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['request_id'])")

RESP=$(curl -s -m 5 -X POST "$BASE/approvals/$REQ_ID2/reject" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"reviewer\":\"$ADMIN_ID\",\"comment\":\"no\"}")
assert_contains "reject" "$RESP" '"status":"rejected"'

# ============================================================
# 8. 审计日志
# ============================================================

section "8. Audit Logs"

RESP=$(curl -s -m 5 "$BASE/audit/logs?org_id=$ORG_ID&limit=20")
LOG_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
assert_ge "audit logs >= 10" "$LOG_COUNT" "10"

RESP=$(curl -s -m 5 "$BASE/audit/logs?org_id=$ORG_ID&action=plugin_install")
assert_contains "audit by action" "$RESP" "plugin_install"

RESP=$(curl -s -m 5 "$BASE/audit/logs?org_id=$ORG_ID&severity=info")
assert_contains "audit by severity" "$RESP" '"severity":"info"'

# 导出
RESP=$(curl -s -m 5 "$BASE/audit/export?org_id=$ORG_ID&format=jsonl")
assert_contains "export jsonl" "$RESP" "log_id"

# 安全事件
RESP=$(curl -s -m 5 -X POST "$BASE/audit/security-event" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"actor\":\"hacker\",\"event\":\"unauthorized\",\"target\":\"/admin\"}")
assert_contains "security event" "$RESP" '"severity":"error"'

# ============================================================
# 9. Dashboard
# ============================================================

section "9. Dashboard"

RESP=$(curl -s -m 5 "$BASE/dashboard/$ORG_ID")
assert_contains "dashboard total_plugins" "$RESP" '"total_plugins"'
assert_contains "dashboard active_plugins" "$RESP" '"active_plugins"'
assert_contains "dashboard productivity" "$RESP" '"productivity_score"'
assert_contains "dashboard top_plugins" "$RESP" '"top_plugins"'
assert_contains "dashboard usage_by_category" "$RESP" '"usage_by_category"'
assert_contains "dashboard cost_summary" "$RESP" '"cost_summary"'

RESP=$(curl -s -m 5 "$BASE/dashboard/$ORG_ID/top-plugins?limit=5")
assert_contains "top plugins" "$RESP" '"items"'

RESP=$(curl -s -m 5 "$BASE/dashboard/$ORG_ID/productivity")
assert_contains "productivity score" "$RESP" '"score"'

# ============================================================
# 10. 卸载
# ============================================================

section "10. Uninstall"

RESP=$(curl -s -m 5 -X POST "$BASE/uninstall" \
    -H "Content-Type: application/json" \
    -d "{\"org_id\":\"$ORG_ID\",\"plugin_id\":\"plugin_ai-ml_code-generator\",\"member_id\":\"$DEV_ID\"}")
assert_contains "uninstall" "$RESP" '"ok":true'

# ============================================================
# Summary
# ============================================================

echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}E2E Test Summary${NC}"
echo -e "${YELLOW}========================================${NC}"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
if [ "$FAILED" -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAILED${NC}"
    exit 1
else
    echo -e "  ${GREEN}Failed: 0${NC}"
    exit 0
fi
