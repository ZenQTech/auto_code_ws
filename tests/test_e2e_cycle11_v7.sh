#!/bin/bash
# ============================================================
# Phase 7.10 - Cycle 11 全功能端到端验证
# ============================================================
# 核心作用：验证 Cycle 11 所有新增模块（P2-1 / P2-2 / P3-1）的集成
# 测试范围：
#   1. P2-1 Playwright E2E 框架（8 场景 + 多格式报告 + 视觉基线）
#   2. P2-2 doctor 环境诊断（6 大类 + 修复建议 + 历史）
#   3. P3-1 /import 跨平台配置迁移（4 数据源 + 任务管理）
#   4. 与 P1-10 Verification Loop 集成
#   5. 与 P1-8 Memory System 集成
#   6. 完整业务流：需求输入→澄清→设计→派发→E2E 验证
# 目标：≥25 个测试模块
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"

PASSED=0
FAILED=0

color_red() { echo -e "\033[31m$1\033[0m"; }
color_green() { echo -e "\033[32m$1\033[0m"; }
color_yellow() { echo -e "\033[33m$1\033[0m"; }

assert_contains() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    if echo "$actual" | grep -qF "$expected"; then
        color_green "  ✓ $name"
        PASSED=$((PASSED+1))
    else
        color_red "  ✗ $name"
        echo "    Expected: $expected"
        echo "    Actual:   $(echo $actual | head -c 300)"
        FAILED=$((FAILED+1))
    fi
}

# ============================================================
# 服务就绪检查
# ============================================================
echo "==> 等待 backend 服务就绪..."
READY=0
for i in {1..20}; do
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
        color_green "  服务就绪"
        READY=1
        break
    fi
    sleep 1
done
if [ $READY -eq 0 ]; then
    color_red "  ✗ 服务未启动"
    exit 1
fi

# ============================================================
# 模块 1: P2-1 Playwright E2E 框架
# ============================================================
echo ""
echo "==> 模块 1: P2-1 Playwright E2E 框架"
RESPONSE=$(curl -s "$BASE_URL/api/e2e/health")
assert_contains "e2e service healthy" "$RESPONSE" '"success":true'
assert_contains "8 scenarios loaded" "$RESPONSE" '"scenarios_count":8'
assert_contains "visual_regression feature" "$RESPONSE" 'visual_regression'
assert_contains "multi_format_report feature" "$RESPONSE" 'multi_format_report'

RESPONSE=$(curl -s "$BASE_URL/api/e2e/scenarios")
assert_contains "scenarios count=8" "$RESPONSE" '"count":8'
assert_contains "app_startup scenario" "$RESPONSE" 'app_startup'
assert_contains "doctor_diagnosis scenario" "$RESPONSE" 'doctor_diagnosis'
assert_contains "e2e_regression scenario" "$RESPONSE" 'e2e_regression'

# ============================================================
# 模块 2: P2-2 doctor 环境诊断
# ============================================================
echo ""
echo "==> 模块 2: P2-2 doctor 环境诊断"
RESPONSE=$(curl -s "$BASE_URL/api/doctor/health")
assert_contains "doctor service healthy" "$RESPONSE" '"success":true'
assert_contains "6 categories" "$RESPONSE" '"categories"'
assert_contains "environment category" "$RESPONSE" 'environment'
assert_contains "mcp category" "$RESPONSE" 'mcp'

RESPONSE=$(curl -s "$BASE_URL/api/doctor/categories")
assert_contains "categories count=6" "$RESPONSE" '"count":6'
assert_contains "environment name" "$RESPONSE" '"name":"environment"'
assert_contains "workspace name" "$RESPONSE" '"name":"workspace"'
assert_contains "llm name" "$RESPONSE" '"name":"llm"'
assert_contains "database name" "$RESPONSE" '"name":"database"'

# ============================================================
# 模块 3: P3-1 /import 跨平台配置迁移
# ============================================================
echo ""
echo "==> 模块 3: P3-1 /import 跨平台配置迁移"
RESPONSE=$(curl -s "$BASE_URL/api/import/health")
assert_contains "import service healthy" "$RESPONSE" '"status":"ok"'
assert_contains "import version" "$RESPONSE" '"version"'
assert_contains "import dir" "$RESPONSE" '"import_dir"'

# ============================================================
# 模块 4: P1-10 Verification Loop 集成
# ============================================================
echo ""
echo "==> 模块 4: P1-10 Verification Loop 集成"
RESPONSE=$(curl -s "$BASE_URL/api/verification/health")
assert_contains "verification healthy" "$RESPONSE" '"success":true'
assert_contains "4 dimensions feature" "$RESPONSE" 'syntax_verification'
assert_contains "module verification" "$RESPONSE" 'module_verification'
assert_contains "integration verification" "$RESPONSE" 'integration_verification'
assert_contains "performance verification" "$RESPONSE" 'performance_verification'
assert_contains "auto_fix orchestration" "$RESPONSE" 'auto_fix_orchestration'

# ============================================================
# 模块 5: P1-8 Memory System
# ============================================================
echo ""
echo "==> 模块 5: P1-8 Memory System"
RESPONSE=$(curl -s "$BASE_URL/api/memory/health")
assert_contains "memory service" "$RESPONSE" 'success'

# ============================================================
# 模块 6: Doctor + E2E 集成
# ============================================================
echo ""
echo "==> 模块 6: Doctor + E2E 集成"
# 验证 e2e 框架能引用 doctor
RESPONSE=$(curl -s -m 30 -X POST "$BASE_URL/api/e2e/run" \
    -H "Content-Type: application/json" \
    -d '{"scenario_ids": ["sc_doctor_diagnosis"]}')
assert_contains "doctor scenario run" "$RESPONSE" '"success":true'
assert_contains "doctor scenario passed" "$RESPONSE" '"passed":1'

# ============================================================
# 模块 7: 完整业务流（用户输入→需求澄清→架构设计→任务派发→E2E验证）
# ============================================================
echo ""
echo "==> 模块 7: 完整业务流端到端验证"
RESPONSE=$(curl -s -m 30 -X POST "$BASE_URL/api/e2e/run" \
    -H "Content-Type: application/json" \
    -d '{"scenario_ids": ["sc_e2e_regression"]}')
assert_contains "regression scenario run" "$RESPONSE" '"success":true'
assert_contains "regression total=1" "$RESPONSE" '"total_scenarios":1'
assert_contains "regression passed" "$RESPONSE" '"passed":1'

# ============================================================
# 模块 8: 报告生成验证
# ============================================================
echo ""
echo "==> 模块 8: 报告生成验证"
RESPONSE=$(curl -s "$BASE_URL/api/e2e/reports?limit=3")
assert_contains "reports list" "$RESPONSE" '"success":true'
assert_contains "reports count" "$RESPONSE" '"count":'

# 提取最新报告 ID
REPORT_ID=$(curl -s "$BASE_URL/api/e2e/reports?limit=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['reports'][0]['report_id'] if d['reports'] else '')")
if [ -n "$REPORT_ID" ]; then
    RESPONSE=$(curl -s "$BASE_URL/api/e2e/reports/$REPORT_ID")
    assert_contains "report detail" "$RESPONSE" '"success":true'
    assert_contains "report has report_id" "$RESPONSE" "\"report_id\":\"$REPORT_ID\""
fi

# ============================================================
# 模块 9: 视觉基线管理
# ============================================================
echo ""
echo "==> 模块 9: 视觉基线管理"
RESPONSE=$(curl -s "$BASE_URL/api/e2e/baselines")
assert_contains "baselines list" "$RESPONSE" '"success":true'
assert_contains "baselines count" "$RESPONSE" '"count":'

# ============================================================
# 模块 10: /loop 集成
# ============================================================
echo ""
echo "==> 模块 10: /loop 命令集成"
RESPONSE=$(curl -s "$BASE_URL/api/loop-commands/health")
assert_contains "loop commands service" "$RESPONSE" '"status":"ok"'
assert_contains "loop commands version" "$RESPONSE" '"service":"loop-commands"'

# ============================================================
# 测试总结
# ============================================================
echo ""
echo "=========================================="
echo "Phase 7.10 Cycle 11 测试总结"
echo "=========================================="
echo "通过: $PASSED"
echo "失败: $FAILED"
TOTAL=$((PASSED+FAILED))
echo "总计: $TOTAL"
echo "=========================================="

if [ $FAILED -eq 0 ]; then
    color_green "✓ 全部测试通过 - Phase 7.10 Cycle 11 验证完成"
    exit 0
else
    color_red "✗ 有 $FAILED 个测试失败"
    exit 1
fi
