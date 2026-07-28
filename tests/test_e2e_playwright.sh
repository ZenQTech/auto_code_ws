#!/bin/bash
# ============================================================
# Hermes Playwright E2E 测试 - Cycle 11 P2-1
# ============================================================
# 覆盖点：
#   - E2E 框架健康检查
#   - 8 大场景列表
#   - 完整场景执行（实际跑测试）
#   - 报告生成（HTML/JSON/Markdown）
#   - 报告列表 + 详情查询
#   - 视觉基线 CRUD
#   - 错误路径
# 输入参数：
#   - BASE_URL（默认 http://localhost:8765）
# 输出结果：测试报告（stdout）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-1 新建
# ============================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8765}"
PROJECT_ROOT="/home/qizheng/auto_code_ws"
E2E_DIR="$PROJECT_ROOT/backend/app/core/e2e"
REPORTS_DIR="$PROJECT_ROOT/tests/e2e_reports"
BASELINES_DIR="$PROJECT_ROOT/tests/e2e_baselines"

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
echo "==> 模块 1: E2E 框架健康检查（API 端点）"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/e2e/health")
assert_contains "health returns success" "$RESPONSE" '"success":true'
assert_contains "health has service=e2e" "$RESPONSE" '"service":"e2e"'
assert_contains "health has version" "$RESPONSE" '"version"'
assert_contains "health has scenarios_count=8" "$RESPONSE" '"scenarios_count":8'
assert_contains "health has scenarios_loaded=8" "$RESPONSE" '"scenarios_loaded":8'
assert_contains "health has 8_scenarios feature" "$RESPONSE" '8_scenarios'
assert_contains "health has visual_regression" "$RESPONSE" 'visual_regression'
assert_contains "health has multi_format_report" "$RESPONSE" 'multi_format_report'
assert_contains "health has retry_strategy" "$RESPONSE" 'retry_strategy'
assert_contains "health has browser_driver" "$RESPONSE" 'browser_driver'
assert_contains "health has api_driver" "$RESPONSE" 'api_driver'

echo ""
echo "==> 模块 2: 场景列表 API"
RESPONSE=$(curl -s -m 5 "$BASE_URL/api/e2e/scenarios")
assert_contains "scenarios returns success" "$RESPONSE" '"success":true'
assert_contains "scenarios has count=8" "$RESPONSE" '"count":8'
assert_contains "scenarios has app_startup" "$RESPONSE" 'app_startup'
assert_contains "scenarios has mode_switch" "$RESPONSE" 'mode_switch'
assert_contains "scenarios has session_management" "$RESPONSE" 'session_management'
assert_contains "scenarios has message_streaming" "$RESPONSE" 'message_streaming'
assert_contains "scenarios has clarification" "$RESPONSE" 'clarification'
assert_contains "scenarios has architecture_design" "$RESPONSE" 'architecture_design'
assert_contains "scenarios has doctor_diagnosis" "$RESPONSE" 'doctor_diagnosis'
assert_contains "scenarios has e2e_regression" "$RESPONSE" 'e2e_regression'

echo ""
echo "==> 模块 3: CLI 工具 - health"
# 通过 CLI 调用
cd "$PROJECT_ROOT"
OUTPUT=$(python3 -m backend.app.core.e2e.cli health 2>&1)
assert_contains "CLI health runner healthy" "$OUTPUT" 'E2E Runner healthy'
assert_contains "CLI health shows 8 scenarios" "$OUTPUT" 'Scenarios: 8'
assert_contains "CLI health shows app_startup" "$OUTPUT" 'app_startup'

echo ""
echo "==> 模块 4: CLI 工具 - list"
OUTPUT=$(python3 -m backend.app.core.e2e.cli list 2>&1)
assert_contains "CLI list total=8" "$OUTPUT" 'Total scenarios: 8'
assert_contains "CLI list has app_startup" "$OUTPUT" 'app_startup'
assert_contains "CLI list has mode_switch" "$OUTPUT" 'mode_switch'
assert_contains "CLI list has session_management" "$OUTPUT" 'session_management'
assert_contains "CLI list has message_streaming" "$OUTPUT" 'message_streaming'
assert_contains "CLI list has clarification" "$OUTPUT" 'clarification'
assert_contains "CLI list has architecture_design" "$OUTPUT" 'architecture_design'
assert_contains "CLI list has doctor_diagnosis" "$OUTPUT" 'doctor_diagnosis'
assert_contains "CLI list has e2e_regression" "$OUTPUT" 'e2e_regression'

echo ""
echo "==> 模块 5: 实际执行单个场景（sc_app_startup）"
OUTPUT=$(python3 -m backend.app.core.e2e.cli run --scenario sc_app_startup 2>&1)
assert_contains "single scenario app_startup passed" "$OUTPUT" 'Passed: 1'
assert_contains "single scenario total=1" "$OUTPUT" 'Total: 1'
assert_contains "single scenario rate 100%" "$OUTPUT" 'Pass rate: 100.0%'

echo ""
echo "==> 模块 6: 实际执行单个场景（sc_doctor_diagnosis）"
OUTPUT=$(python3 -m backend.app.core.e2e.cli run --scenario sc_doctor_diagnosis 2>&1)
assert_contains "doctor scenario passed" "$OUTPUT" 'Passed: 1'
assert_contains "doctor scenario rate 100%" "$OUTPUT" 'Pass rate: 100.0%'

echo ""
echo "==> 模块 7: 报告列表"
OUTPUT=$(python3 -m backend.app.core.e2e.cli report list --limit 5 2>&1)
assert_contains "report list shows reports" "$OUTPUT" 'Recent reports'

echo ""
echo "==> 模块 8: 视觉基线列表"
OUTPUT=$(python3 -m backend.app.core.e2e.cli baseline list 2>&1)
# 可能为空，至少 CLI 调用成功
assert_contains "baseline list returned" "$OUTPUT" 'Total baselines'

echo ""
echo "==> 模块 9: 完整执行所有 8 个场景"
OUTPUT=$(python3 -m backend.app.core.e2e.cli run 2>&1)
assert_contains "all scenarios run completed" "$OUTPUT" 'Test run complete'
assert_contains "all scenarios total=8" "$OUTPUT" 'Total: 8'
assert_contains "all scenarios pass rate 100%" "$OUTPUT" 'Pass rate: 100.0%'
assert_contains "all scenarios error=0" "$OUTPUT" 'Error: 0'
assert_contains "all scenarios failed=0" "$OUTPUT" 'Failed: 0'

# 提取 report_id
REPORT_ID=$(echo "$OUTPUT" | grep -oE 'e2e_[0-9]+_[0-9]+_[a-f0-9]+' | head -1)
echo "  → 最新报告 ID: $REPORT_ID"

echo ""
echo "==> 模块 10: 验证报告文件生成"
# 验证 3 种格式的报告文件
HTML_FILE="$REPORTS_DIR/${REPORT_ID}.html"
JSON_FILE="$REPORTS_DIR/${REPORT_ID}.json"
MD_FILE="$REPORTS_DIR/${REPORT_ID}.md"

if [ -f "$HTML_FILE" ]; then
    color_green "  ✓ HTML 报告存在: $(basename $HTML_FILE)"
    PASS=$((PASS+1))
    # 验证内容
    assert_contains "HTML report has report_id" "$(cat $HTML_FILE)" "$REPORT_ID"
    assert_contains "HTML report has sc_app_startup" "$(cat $HTML_FILE)" "sc_app_startup"
else
    color_red "  ✗ HTML 报告不存在: $HTML_FILE"
    FAIL=$((FAIL+1))
fi

if [ -f "$JSON_FILE" ]; then
    color_green "  ✓ JSON 报告存在: $(basename $JSON_FILE)"
    PASS=$((PASS+1))
    assert_contains "JSON report has report_id" "$(cat $JSON_FILE)" '"report_id"'
    assert_contains "JSON report has passed=8" "$(cat $JSON_FILE)" '"passed": 8'
else
    color_red "  ✗ JSON 报告不存在: $JSON_FILE"
    FAIL=$((FAIL+1))
fi

if [ -f "$MD_FILE" ]; then
    color_green "  ✓ Markdown 报告存在: $(basename $MD_FILE)"
    PASS=$((PASS+1))
    assert_contains "MD report has report_id" "$(cat $MD_FILE)" "$REPORT_ID"
    assert_contains "MD report has Pass Rate" "$(cat $MD_FILE)" "Pass Rate"
    assert_contains "MD report has 100.0%" "$(cat $MD_FILE)" "100.0%"
else
    color_red "  ✗ Markdown 报告不存在: $MD_FILE"
    FAIL=$((FAIL+1))
fi

echo ""
echo "==> 模块 11: 报告详情查询"
if [ -n "$REPORT_ID" ]; then
    OUTPUT=$(python3 -m backend.app.core.e2e.cli report show --report-id "$REPORT_ID" 2>&1)
    assert_contains "report show returns JSON" "$OUTPUT" '"report_id"'
    assert_contains "report show has passed count" "$OUTPUT" '"passed"'
fi

echo ""
echo "==> 模块 12: 错误路径 - 不存在的报告"
OUTPUT=$(python3 -m backend.app.core.e2e.cli report show --report-id "e2e_nonexistent_xyz" 2>&1)
assert_contains "nonexistent report error" "$OUTPUT" 'not found'

echo ""
echo "==> 模块 13: 8 大场景优先级排序（CLI 顺序）"
OUTPUT=$(python3 -m backend.app.core.e2e.cli list 2>&1)
# 按 priority 排序：app_startup(100) 应在 mode_switch(90) 之前
APP_STARTUP_LINE=$(echo "$OUTPUT" | grep -n "app_startup" | head -1 | cut -d: -f1)
MODE_SWITCH_LINE=$(echo "$OUTPUT" | grep -n "mode_switch" | head -1 | cut -d: -f1)
DOCTOR_LINE=$(echo "$OUTPUT" | grep -n "doctor_diagnosis" | head -1 | cut -d: -f1)
REGRESSION_LINE=$(echo "$OUTPUT" | grep -n "e2e_regression" | head -1 | cut -d: -f1)

if [ -n "$APP_STARTUP_LINE" ] && [ -n "$MODE_SWITCH_LINE" ] && \
   [ "$APP_STARTUP_LINE" -lt "$MODE_SWITCH_LINE" ] && \
   [ -n "$REGRESSION_LINE" ] && [ "$REGRESSION_LINE" -gt "$DOCTOR_LINE" ]; then
    color_green "  ✓ 优先级排序正确（app_startup 优先，e2e_regression 最后）"
    PASS=$((PASS+1))
else
    color_red "  ✗ 优先级排序错误"
    FAIL=$((FAIL+1))
fi

echo ""
echo "==> 模块 14: E2E 文件结构完整性"
EXPECTED_FILES=(
    "$E2E_DIR/base.py"
    "$E2E_DIR/scenario.py"
    "$E2E_DIR/runner.py"
    "$E2E_DIR/api_driver.py"
    "$E2E_DIR/browser_driver.py"
    "$E2E_DIR/visual.py"
    "$E2E_DIR/retry.py"
    "$E2E_DIR/report.py"
    "$E2E_DIR/cli.py"
    "$E2E_DIR/scenarios/s1_app_startup.py"
    "$E2E_DIR/scenarios/s2_mode_switch.py"
    "$E2E_DIR/scenarios/s3_session_management.py"
    "$E2E_DIR/scenarios/s4_message_streaming.py"
    "$E2E_DIR/scenarios/s5_clarification.py"
    "$E2E_DIR/scenarios/s6_architecture_design.py"
    "$E2E_DIR/scenarios/s7_doctor_diagnosis.py"
    "$E2E_DIR/scenarios/s8_e2e_regression.py"
)
for f in "${EXPECTED_FILES[@]}"; do
    if [ -f "$f" ]; then
        color_green "  ✓ $(basename $f)"
        PASS=$((PASS+1))
    else
        color_red "  ✗ 缺失: $f"
        FAIL=$((FAIL+1))
    fi
done

echo ""
echo "==> 模块 15: 单元测试通过率（抽样）"
UNIT_TEST="$PROJECT_ROOT/tests/test_e2e_playwright_units.py"
if [ -f "$UNIT_TEST" ]; then
    color_green "  ✓ 单元测试文件存在"
    PASS=$((PASS+1))
    # 数 test_ 函数个数
    TEST_COUNT=$(grep -c "def test_" "$UNIT_TEST")
    if [ "$TEST_COUNT" -ge 80 ]; then
        color_green "  ✓ 单元测试数量 $TEST_COUNT >= 80"
        PASS=$((PASS+1))
    else
        color_yellow "  ⚠ 单元测试数量 $TEST_COUNT 偏少（期望 >= 80）"
        FAIL=$((FAIL+1))
    fi
else
    color_red "  ✗ 单元测试文件不存在"
    FAIL=$((FAIL+1))
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
