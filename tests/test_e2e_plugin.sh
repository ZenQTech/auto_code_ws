#!/bin/bash
# ============================================================
# Plugin System - E2E Test
# ============================================================
# Cycle 12 P0-1: 验证 Plugin 系统的 REST API
# 端点：health/list/stats/scan/install/uninstall/enable/disable/get/reload
# ============================================================
set -e

BASE_URL="http://localhost:8765/api/plugins"
PASS=0
FAIL=0
TOTAL=0

# ============================================================
# 工具函数
# ============================================================
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() {
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

log_fail() {
    FAIL=$((FAIL + 1))
    TOTAL=$((TOTAL + 1))
    echo -e "${RED}✗ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        echo -e "  ${YELLOW}Detail${NC}: $2"
    fi
}

assert_contains() {
    local desc="$1"
    local haystack="$2"
    local needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        log_pass "$desc"
    else
        log_fail "$desc" "Expected to contain '$needle', got: $haystack"
    fi
}

assert_equals() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    if [ "$actual" = "$expected" ]; then
        log_pass "$desc"
    else
        log_fail "$desc" "Expected '$expected', got '$actual'"
    fi
}

# ============================================================
# Test 1: Health Check
# ============================================================
echo "=== Test 1: Health Check ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Health check returns 200" "$HTTP_CODE" "200"
assert_contains "Health response has success=true" "$BODY" '"success":true'
assert_contains "Health response has service=plugins" "$BODY" '"service":"plugins"'
assert_contains "Health response has total_plugins" "$BODY" '"total_plugins"'
assert_contains "Health response has features" "$BODY" '"features"'

# ============================================================
# Test 2: List Plugins
# ============================================================
echo ""
echo "=== Test 2: List Plugins ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/list")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "List returns 200" "$HTTP_CODE" "200"
assert_contains "List has success=true" "$BODY" '"success":true'
assert_contains "List has count" "$BODY" '"count"'
assert_contains "List has plugins array" "$BODY" '"plugins"'

# ============================================================
# Test 3: Stats
# ============================================================
echo ""
echo "=== Test 3: Stats ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/stats")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Stats returns 200" "$HTTP_CODE" "200"
assert_contains "Stats has success=true" "$BODY" '"success":true'
assert_contains "Stats has data" "$BODY" '"data"'

# ============================================================
# Test 4: Scan
# ============================================================
echo ""
echo "=== Test 4: Scan ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/scan")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Scan returns 200" "$HTTP_CODE" "200"
assert_contains "Scan has success=true" "$BODY" '"success":true'
assert_contains "Scan has scanned count" "$BODY" '"scanned"'

# ============================================================
# Test 5: Install Plugin
# ============================================================
echo ""
echo "=== Test 5: Install Plugin ==="
# 创建测试 Plugin
TEST_PLUGIN_DIR="/tmp/e2e_plugin_$$"
mkdir -p "$TEST_PLUGIN_DIR/test-e2e-plugin"
cat > "$TEST_PLUGIN_DIR/test-e2e-plugin/manifest.json" <<EOF
{
  "id": "test-e2e-plugin",
  "name": "E2E Test Plugin",
  "version": "1.0.0",
  "description": "Plugin for E2E testing",
  "author": {"name": "E2E Tester"},
  "license": "MIT"
}
EOF
mkdir -p "$TEST_PLUGIN_DIR/test-e2e-plugin/skills"
cat > "$TEST_PLUGIN_DIR/test-e2e-plugin/skills/test-skill.md" <<EOF
# Test Skill
A test skill.
EOF

# 校验 manifest
cat > "$TEST_PLUGIN_DIR/test-e2e-plugin/manifest.json" <<EOF
{
  "id": "test-e2e-plugin",
  "name": "E2E Test Plugin",
  "version": "1.0.0",
  "description": "Plugin for E2E testing",
  "author": {"name": "E2E Tester"},
  "license": "MIT",
  "components": {
    "skills": ["skills/test-skill.md"]
  }
}
EOF

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/install" \
    -H "Content-Type: application/json" \
    -d "{\"source_path\":\"$TEST_PLUGIN_DIR/test-e2e-plugin\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Install returns 200" "$HTTP_CODE" "200"
assert_contains "Install has success=true" "$BODY" '"success":true'
assert_contains "Install has plugin info" "$BODY" '"plugin"'
assert_contains "Install confirms test-e2e-plugin" "$BODY" '"id":"test-e2e-plugin"'

# ============================================================
# Test 6: Get Plugin Details
# ============================================================
echo ""
echo "=== Test 6: Get Plugin Details ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/test-e2e-plugin")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Get returns 200" "$HTTP_CODE" "200"
assert_contains "Get has success=true" "$BODY" '"success":true'
assert_contains "Get has plugin details" "$BODY" '"plugin"'
assert_contains "Get confirms test-e2e-plugin" "$BODY" '"id":"test-e2e-plugin"'

# ============================================================
# Test 7: Enable Plugin
# ============================================================
echo ""
echo "=== Test 7: Enable Plugin ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/enable" \
    -H "Content-Type: application/json" \
    -d '{"plugin_id":"test-e2e-plugin"}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Enable returns 200" "$HTTP_CODE" "200"
assert_contains "Enable has success=true" "$BODY" '"success":true'
assert_contains "Enable confirms enabled" "$BODY" '"enabled":true'

# ============================================================
# Test 8: Disable Plugin
# ============================================================
echo ""
echo "=== Test 8: Disable Plugin ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/disable" \
    -H "Content-Type: application/json" \
    -d '{"plugin_id":"test-e2e-plugin"}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Disable returns 200" "$HTTP_CODE" "200"
assert_contains "Disable has success=true" "$BODY" '"success":true'
assert_contains "Disable confirms disabled" "$BODY" '"enabled":false'

# ============================================================
# Test 9: Reload Plugin
# ============================================================
echo ""
echo "=== Test 9: Reload Plugin ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/test-e2e-plugin/reload")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Reload returns 200" "$HTTP_CODE" "200"
assert_contains "Reload has success=true" "$BODY" '"success":true'
assert_contains "Reload has plugin info" "$BODY" '"plugin"'

# ============================================================
# Test 10: Marketplace Search
# ============================================================
echo ""
echo "=== Test 10: Marketplace Search ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/marketplace/search?q=test")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Search returns 200" "$HTTP_CODE" "200"
assert_contains "Search has success=true" "$BODY" '"success":true'
assert_contains "Search has query" "$BODY" '"query":"test"'
assert_contains "Search has results" "$BODY" '"plugins"'

# ============================================================
# Test 11: Categories List
# ============================================================
echo ""
echo "=== Test 11: Categories List ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/categories/list")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Categories returns 200" "$HTTP_CODE" "200"
assert_contains "Categories has success=true" "$BODY" '"success":true'
assert_contains "Categories has count" "$BODY" '"count"'
assert_contains "Categories has categories list" "$BODY" '"categories"'

# ============================================================
# Test 12: Get Nonexistent Plugin (404)
# ============================================================
echo ""
echo "=== Test 12: Get Nonexistent Plugin ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/nonexistent-plugin-xyz")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Get nonexistent returns 404" "$HTTP_CODE" "404"
assert_contains "Get nonexistent has error" "$BODY" '"detail"'

# ============================================================
# Test 13: Install Nonexistent Path (400)
# ============================================================
echo ""
echo "=== Test 13: Install Nonexistent Path ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/install" \
    -H "Content-Type: application/json" \
    -d '{"source_path":"/tmp/nonexistent_plugin_path_12345"}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
assert_equals "Install nonexistent returns 400/404" "$HTTP_CODE" "400"

# ============================================================
# Test 14: Uninstall Plugin
# ============================================================
echo ""
echo "=== Test 14: Uninstall Plugin ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/uninstall" \
    -H "Content-Type: application/json" \
    -d '{"plugin_id":"test-e2e-plugin"}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Uninstall returns 200" "$HTTP_CODE" "200"
assert_contains "Uninstall has success=true" "$BODY" '"success":true'

# 验证卸载后获取返回 404
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/test-e2e-plugin")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
assert_equals "Uninstalled plugin returns 404" "$HTTP_CODE" "404"

# ============================================================
# Test 15: List by enabled_only
# ============================================================
echo ""
echo "=== Test 15: List by enabled_only ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/list?enabled_only=true")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "List enabled returns 200" "$HTTP_CODE" "200"
assert_contains "List enabled has success=true" "$BODY" '"success":true'

# ============================================================
# 清理
# ============================================================
rm -rf "$TEST_PLUGIN_DIR"

# ============================================================
# 输出结果
# ============================================================
echo ""
echo "============================================"
echo "E2E Plugin System Test Results"
echo "============================================"
echo -e "Total: $TOTAL"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo "============================================"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
echo "All tests passed!"
exit 0
