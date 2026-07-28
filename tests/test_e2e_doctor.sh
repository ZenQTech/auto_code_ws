#!/bin/bash
# ============================================================
# Hermes Doctor E2E 测试 - Cycle 11 P2-2
# ============================================================
# 覆盖点：
#   - 健康检查 + 分类列表
#   - 完整诊断（保存历史）
#   - 单类诊断
#   - 修复建议查询
#   - 历史报告列表 + 详情
#   - 反馈提交
#   - 错误路径
# 输入参数：
#   - BASE_URL（默认 http://localhost:8765）
# 输出结果：测试报告（stdout）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8765}"
PASS=0
FAIL=0
TEST_NAME=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

color_red() { echo -e "${RED}$1${NC}"; }
color_green() { echo -e "${GREEN}$1${NC}"; }
color_yellow() { echo -e "${YELLOW}$1${NC}"; }

assert_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    TEST_NAME="$name"
    if echo "$haystack" | grep -qF "$needle"; then
        color_green "  ✓ $name"
        PASS=$((PASS+1))
    else
        color_red "  ✗ $name"
        color_yellow "    期望: \"$needle\""
        color_yellow "    实际: $(echo "$haystack" | head -c 200)"
        FAIL=$((FAIL+1))
    fi
}

assert_equals() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    TEST_NAME="$name"
    if [ "$actual" = "$expected" ]; then
        color_green "  ✓ $name"
        PASS=$((PASS+1))
    else
        color_red "  ✗ $name"
        color_yellow "    期望: $expected"
        color_yellow "    实际: $actual"
        FAIL=$((FAIL+1))
    fi
}

# ============================================================
# 测试模块
# ============================================================
echo ""
echo "==> 模块 1: 健康检查"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/health")
assert_contains "health returns success" "$RESPONSE" '"success":true'
assert_contains "health has service" "$RESPONSE" '"service":"doctor"'
assert_contains "health has categories" "$RESPONSE" '"categories"'
assert_contains "health has environment" "$RESPONSE" '"environment"'
assert_contains "health has mcp" "$RESPONSE" '"mcp"'

echo ""
echo "==> 模块 2: 分类列表"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/categories")
assert_contains "categories returns success" "$RESPONSE" '"success":true'
assert_contains "categories count=6" "$RESPONSE" '"count":6'
assert_contains "categories has environment" "$RESPONSE" '"name":"environment"'
assert_contains "categories has workspace" "$RESPONSE" '"name":"workspace"'
assert_contains "categories has llm" "$RESPONSE" '"name":"llm"'
assert_contains "categories has database" "$RESPONSE" '"name":"database"'

echo ""
echo "==> 模块 3: 完整诊断（不保存历史）"
RESPONSE=$(curl -s -m 30 "$BASE_URL/api/doctor/run?save_history=false")
assert_contains "run returns success" "$RESPONSE" '"success":true'
assert_contains "run has report" "$RESPONSE" '"report":'
assert_contains "run has report_id" "$RESPONSE" '"report_id":"doc_'
assert_contains "run has 6 categories" "$RESPONSE" '"environment"'
assert_contains "run has workspace cat" "$RESPONSE" '"workspace"'
assert_contains "run has overall_status" "$RESPONSE" '"overall_status"'
# 提取 report_id
REPORT_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['report']['report_id'])" 2>/dev/null || echo "")

echo ""
echo "==> 模块 4: 单类诊断（environment）"
RESPONSE=$(curl -s -m 15 "$BASE_URL/api/doctor/environment")
assert_contains "single cat returns success" "$RESPONSE" '"success":true'
assert_contains "single cat has category" "$RESPONSE" '"category":"environment"'
assert_contains "single cat has items" "$RESPONSE" '"items":'
assert_contains "single cat has python check" "$RESPONSE" '"id":"environment.python_version"'
assert_contains "single cat has api_key check" "$RESPONSE" '"id":"environment.anthropic_api_key"'

echo ""
echo "==> 模块 5: 单类诊断（database）"
RESPONSE=$(curl -s -m 15 "$BASE_URL/api/doctor/database")
assert_contains "db cat has items" "$RESPONSE" '"id":"database.connection"'
assert_contains "db cat has tables" "$RESPONSE" '"id":"database.tables"'

echo ""
echo "==> 模块 6: 完整诊断（保存历史）"
RESPONSE=$(curl -s -m 30 "$BASE_URL/api/doctor/run?save_history=true")
assert_contains "run with history returns success" "$RESPONSE" '"success":true'
NEW_REPORT_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['report']['report_id'])" 2>/dev/null || echo "")

echo ""
echo "==> 模块 7: 历史报告列表"
sleep 1
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/history?limit=5")
assert_contains "history returns success" "$RESPONSE" '"success":true'
assert_contains "history has reports" "$RESPONSE" '"reports":'
assert_contains "history has count" "$RESPONSE" '"count":'

echo ""
echo "==> 模块 8: 单个历史报告"
if [ -n "$NEW_REPORT_ID" ]; then
    RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/history/$NEW_REPORT_ID")
    assert_contains "history detail returns success" "$RESPONSE" '"success":true'
    assert_contains "history detail has report_id" "$RESPONSE" "\"report_id\":\"$NEW_REPORT_ID\""
    assert_contains "history detail has summary" "$RESPONSE" '"summary":'
fi

echo ""
echo "==> 模块 9: 修复建议"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/fix/environment.anthropic_api_key")
assert_contains "fix returns success" "$RESPONSE" '"success":true'
assert_contains "fix has title" "$RESPONSE" '"title":'
assert_contains "fix has steps" "$RESPONSE" '"steps":'
assert_contains "fix has risk_level" "$RESPONSE" '"risk_level"'

echo ""
echo "==> 模块 10: 列出所有修复"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/fixes/all/list")
assert_contains "all fixes returns success" "$RESPONSE" '"success":true'
assert_contains "all fixes has total" "$RESPONSE" '"total":'
assert_contains "all fixes has env" "$RESPONSE" '"environment":'
assert_contains "all fixes has database" "$RESPONSE" '"database":'

echo ""
echo "==> 模块 11: 错误路径"
# 无效分类
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/invalid_cat_xyz")
assert_contains "invalid category rejected" "$RESPONSE" '"invalid_category"'

# 无效修复 id
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/fix/nonexistent.check.id")
assert_contains "invalid fix returns 404" "$RESPONSE" '"fix_not_found"'

# 无效历史
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/doctor/history/nonexistent_report_id")
assert_contains "nonexistent history 404" "$RESPONSE" '"report_not_found"'

# 无效反馈（不存在的 report_id）
RESPONSE=$(curl -s -m 5 -X POST "$BASE_URL/api/doctor/feedback" \
    -H "Content-Type: application/json" \
    -d '{"report_id":"doc_fake_123"}')
assert_contains "feedback with fake report 404" "$RESPONSE" '"report_not_found"'

echo ""
echo "==> 模块 12: 反馈提交（有效 report_id）"
if [ -n "$NEW_REPORT_ID" ]; then
    RESPONSE=$(curl -s -m 5 -X POST "$BASE_URL/api/doctor/feedback" \
        -H "Content-Type: application/json" \
        -d "{\"report_id\":\"$NEW_REPORT_ID\",\"user_comment\":\"test feedback\",\"contact_email\":\"test@example.com\"}")
    assert_contains "feedback returns success" "$RESPONSE" '"success":true'
    assert_contains "feedback has feedback_id" "$RESPONSE" '"feedback_id":"fb_'
fi

# ============================================================
# 测试总结
# ============================================================
echo ""
echo "=========================================="
echo "测试总结"
echo "=========================================="
echo "通过: $PASS"
echo "失败: $FAIL"
TOTAL=$((PASS+FAIL))
echo "总计: $TOTAL"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
    color_green "✓ 全部测试通过"
    exit 0
else
    color_red "✗ 有 $FAIL 个测试失败"
    exit 1
fi
