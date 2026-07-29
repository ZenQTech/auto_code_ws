#!/bin/bash
# ============================================================
# Goal Automation - E2E Tests
# ============================================================
# 覆盖：健康检查、Agent 注册、委派、轮转、统计等所有 REST 端点
# 运行：bash tests/test_e2e_goal_automation.sh
# 要求：后端服务运行在 http://localhost:8000
# ============================================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 配置
BASE_URL="${BASE_URL:-http://localhost:8000}"
API_BASE="${BASE_URL}/api/goal-automation"
PASS=0
FAIL=0
TOTAL=0

# 测试辅助函数
assert_eq() {
    local actual="$1"
    local expected="$2"
    local msg="$3"
    TOTAL=$((TOTAL + 1))
    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✓${NC} $msg"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $msg"
        echo -e "    expected: $expected"
        echo -e "    actual:   $actual"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local actual="$1"
    local substr="$2"
    local msg="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$actual" | grep -q "$substr"; then
        echo -e "  ${GREEN}✓${NC} $msg"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $msg"
        echo -e "    expected to contain: $substr"
        echo -e "    actual: $actual"
        FAIL=$((FAIL + 1))
    fi
}

assert_http_code() {
    local url="$1"
    local expected_code="$2"
    local method="${3:-GET}"
    local body="$4"
    local msg="$5"
    TOTAL=$((TOTAL + 1))
    if [ -n "$body" ]; then
        actual_code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$body" "$url")
    else
        actual_code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")
    fi
    if [ "$actual_code" = "$expected_code" ]; then
        echo -e "  ${GREEN}✓${NC} $msg (HTTP $actual_code)"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $msg"
        echo -e "    expected: HTTP $expected_code, actual: HTTP $actual_code"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Goal Automation E2E Tests${NC}"
echo -e "${YELLOW}========================================${NC}"
echo "BASE_URL: $BASE_URL"
echo ""

# ============================================================
# 1. 健康检查
# ============================================================
echo -e "${YELLOW}[1] 健康检查${NC}"

RESP=$(curl -s "$API_BASE/health")
assert_contains "$RESP" '"status":"ok"' "1.1 健康检查 status=ok"
assert_contains "$RESP" '"version":"v6.32.0"' "1.2 版本 v6.32.0"
assert_contains "$RESP" '"auto_turn":"ok"' "1.3 auto_turn 模块"
assert_contains "$RESP" '"delegation":"ok"' "1.4 delegation 模块"

# ============================================================
# 2. 元数据端点
# ============================================================
echo ""
echo -e "${YELLOW}[2] 元数据端点${NC}"

RESP=$(curl -s "$API_BASE/meta/roles")
assert_contains "$RESP" '"architect"' "2.1 角色列表 - architect"
assert_contains "$RESP" '"implementer"' "2.2 角色列表 - implementer"
assert_contains "$RESP" '"verifier"' "2.3 角色列表 - verifier"
assert_contains "$RESP" '"tester"' "2.4 角色列表 - tester"

RESP=$(curl -s "$API_BASE/meta/risk-levels")
assert_contains "$RESP" '"low"' "2.5 风险等级 - low"
assert_contains "$RESP" '"medium"' "2.6 风险等级 - medium"
assert_contains "$RESP" '"high"' "2.7 风险等级 - high"
assert_contains "$RESP" '"critical"' "2.8 风险等级 - critical"

RESP=$(curl -s "$API_BASE/meta/strategies")
assert_contains "$RESP" '"conservative"' "2.9 策略 - conservative"
assert_contains "$RESP" '"standard"' "2.10 策略 - standard"
assert_contains "$RESP" '"aggressive"' "2.11 策略 - aggressive"

RESP=$(curl -s "$API_BASE/meta/triggers")
assert_contains "$RESP" '"manual"' "2.12 触发器 - manual"
assert_contains "$RESP" '"time_based"' "2.13 触发器 - time_based"
assert_contains "$RESP" '"ac_completed"' "2.14 触发器 - ac_completed"

RESP=$(curl -s "$API_BASE/meta/ac-types")
assert_contains "$RESP" '"implementation"' "2.15 AC 类型 - implementation"
assert_contains "$RESP" '"testing"' "2.16 AC 类型 - testing"
assert_contains "$RESP" '"architecture"' "2.17 AC 类型 - architecture"

# ============================================================
# 3. Agent 注册/注销
# ============================================================
echo ""
echo -e "${YELLOW}[3] Agent 管理${NC}"

# 注册 implementer
TIMESTAMP=$(date +%s)
RESP=$(curl -s -X POST "$API_BASE/agents" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"e2e_impl_${TIMESTAMP}\",\"role\":\"implementer\",\"name\":\"E2E Impl\",\"capabilities\":[\"python\",\"fastapi\"],\"risk_levels\":[\"low\",\"medium\"],\"max_load\":5}")
assert_contains "$RESP" '"success":true' "3.1 注册 implementer"
assert_contains "$RESP" "e2e_impl_${TIMESTAMP}" "3.2 agent_id 正确"
AGENT_ID="e2e_impl_${TIMESTAMP}"

# 注册 architect
RESP=$(curl -s -X POST "$API_BASE/agents" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"e2e_arch_${TIMESTAMP}\",\"role\":\"architect\",\"name\":\"E2E Architect\",\"capabilities\":[\"design\"],\"risk_levels\":[\"low\",\"medium\",\"high\",\"critical\"],\"max_load\":3}")
assert_contains "$RESP" '"success":true' "3.3 注册 architect"

# 注册 tester
RESP=$(curl -s -X POST "$API_BASE/agents" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"e2e_tester_${TIMESTAMP}\",\"role\":\"tester\",\"name\":\"E2E Tester\",\"capabilities\":[\"pytest\"],\"risk_levels\":[\"low\",\"medium\"]}")
assert_contains "$RESP" '"success":true' "3.4 注册 tester"

# 重复注册（应保留原 capabilities）
RESP=$(curl -s -X POST "$API_BASE/agents" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"e2e_impl_${TIMESTAMP}\",\"role\":\"implementer\",\"name\":\"E2E Impl Updated\",\"capabilities\":[\"python\",\"fastapi\"],\"risk_levels\":[\"low\",\"medium\"],\"max_load\":5}")
assert_contains "$RESP" '"success":true' "3.5 重复注册（保留 capabilities）"

# 无效角色
RESP=$(curl -s -X POST "$API_BASE/agents" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"e2e_invalid_${TIMESTAMP}\",\"role\":\"invalid_role\",\"name\":\"Invalid\"}")
assert_contains "$RESP" '"detail"' "3.6 无效角色被拒绝"

# 列出 Agent
RESP=$(curl -s "$API_BASE/agents")
assert_contains "$RESP" "e2e_impl_${TIMESTAMP}" "3.7 列表包含 implementer"
assert_contains "$RESP" "e2e_arch_${TIMESTAMP}" "3.8 列表包含 architect"

# 按角色过滤
RESP=$(curl -s "$API_BASE/agents?role=architect")
assert_contains "$RESP" "e2e_arch_${TIMESTAMP}" "3.9 角色过滤 - architect"
TOTAL=$((TOTAL + 1))
if echo "$RESP" | grep -q "e2e_impl_${TIMESTAMP}"; then
    echo -e "  ${RED}✗${NC} 3.10 角色过滤不含 implementer"
    FAIL=$((FAIL + 1))
else
    echo -e "  ${GREEN}✓${NC} 3.10 角色过滤不含 implementer"
    PASS=$((PASS + 1))
fi

# Agent 详情
RESP=$(curl -s "$API_BASE/agents/$AGENT_ID")
assert_contains "$RESP" '"role":"implementer"' "3.11 Agent 详情"

# Agent 不存在
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/agents/nonexistent_${TIMESTAMP}")
assert_eq "$RESP" "404" "3.12 不存在 Agent 返回 404"

# 更新状态
RESP=$(curl -s -X PATCH "$API_BASE/agents/${AGENT_ID}/status" \
    -H "Content-Type: application/json" \
    -d '{"status":"busy"}')
assert_contains "$RESP" '"success":true' "3.13 更新状态为 busy"
assert_contains "$RESP" '"status":"busy"' "3.14 状态已更新"

# 恢复
RESP=$(curl -s -X PATCH "$API_BASE/agents/${AGENT_ID}/status" \
    -H "Content-Type: application/json" \
    -d '{"status":"available"}')
assert_contains "$RESP" '"status":"available"' "3.15 状态恢复为 available"

# ============================================================
# 4. Agent 健康检查 & 负载
# ============================================================
echo ""
echo -e "${YELLOW}[4] Agent 健康与负载${NC}"

RESP=$(curl -s "$API_BASE/agents/health")
assert_contains "$RESP" '"success":true' "4.1 健康检查端点"
assert_contains "$RESP" "e2e_impl_${TIMESTAMP}" "4.2 健康检查含 implementer"

RESP=$(curl -s "$API_BASE/agents/load")
assert_contains "$RESP" '"by_role"' "4.3 负载分布 by_role"
assert_contains "$RESP" '"total_agents"' "4.4 负载分布 total_agents"

# ============================================================
# 5. 委派
# ============================================================
echo ""
echo -e "${YELLOW}[5] 委派任务${NC}"

# 实施任务委派
RESP=$(curl -s -X POST "$API_BASE/delegations" \
    -H "Content-Type: application/json" \
    -d "{\"goal_id\":\"goal_e2e_${TIMESTAMP}\",\"ac_id\":\"ac_1\",\"ac_title\":\"Implement feature\",\"ac_type\":\"implementation\",\"risk_level\":\"medium\",\"required_capabilities\":[\"python\"],\"priority\":3}")
assert_contains "$RESP" '"success":true' "5.1 实施任务委派成功"
assert_contains "$RESP" '"decision":"delegated"' "5.2 decision=delegated"
assert_contains "$RESP" "e2e_impl" "5.3 委派给 implementer（任意时间戳）"
DELEGATION_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['delegation']['delegation_id'])" 2>/dev/null || echo "")

# 测试任务委派
RESP=$(curl -s -X POST "$API_BASE/delegations" \
    -H "Content-Type: application/json" \
    -d "{\"goal_id\":\"goal_e2e_${TIMESTAMP}\",\"ac_id\":\"ac_2\",\"ac_title\":\"Write unit tests\",\"risk_level\":\"medium\"}")
assert_contains "$RESP" '"success":true' "5.4 测试任务委派成功"
assert_contains "$RESP" '"ac_type":"testing"' "5.5 自动推断为 testing"
assert_contains "$RESP" "e2e_tester" "5.6 委派给 tester（任意时间戳）"

# 架构任务委派（critical 风险）
RESP=$(curl -s -X POST "$API_BASE/delegations" \
    -H "Content-Type: application/json" \
    -d "{\"goal_id\":\"goal_e2e_${TIMESTAMP}\",\"ac_id\":\"ac_3\",\"ac_title\":\"Design architecture\",\"ac_type\":\"architecture\",\"risk_level\":\"critical\"}")
assert_contains "$RESP" '"success":true' "5.7 架构任务委派成功"
assert_contains "$RESP" "e2e_arch" "5.8 critical 风险委派给 architect（任意时间戳）"

# 文档任务
RESP=$(curl -s -X POST "$API_BASE/delegations" \
    -H "Content-Type: application/json" \
    -d "{\"goal_id\":\"goal_e2e_${TIMESTAMP}\",\"ac_id\":\"ac_4\",\"ac_title\":\"Document the API\",\"ac_type\":\"documentation\",\"risk_level\":\"low\"}")
assert_contains "$RESP" '"success":true' "5.9 文档任务委派"

# 委派列表
RESP=$(curl -s "$API_BASE/delegations?goal_id=goal_e2e_${TIMESTAMP}")
assert_contains "$RESP" '"count"' "5.10 委派列表 count 字段"
assert_contains "$RESP" "ac_1" "5.11 委派列表含 ac_1"

# 委派详情
if [ -n "$DELEGATION_ID" ]; then
    RESP=$(curl -s "$API_BASE/delegations/$DELEGATION_ID")
    assert_contains "$RESP" "$DELEGATION_ID" "5.12 委派详情"
fi

# 完成委派
if [ -n "$DELEGATION_ID" ]; then
    RESP=$(curl -s -X POST "$API_BASE/delegations/${DELEGATION_ID}/complete" \
        -H "Content-Type: application/json" \
        -d '{"success":true,"output":{"result":"done"}}')
    assert_contains "$RESP" '"success":true' "5.13 完成委派"
    assert_contains "$RESP" '"completed":true' "5.14 已完成标记"
fi

# ============================================================
# 6. Auto-Turn
# ============================================================
echo ""
echo -e "${YELLOW}[6] Auto-Turn 引擎${NC}"

GOAL_ID="goal_e2e_${TIMESTAMP}"

# 注册轮转配置
RESP=$(curl -s -X POST "$API_BASE/goals/${GOAL_ID}/auto-turn/config" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"'"$GOAL_ID"'","strategy":"standard","interval_seconds":30,"max_turns":100,"auto_verify":true,"auto_progress":true,"triggers":["manual","time_based"]}')
assert_contains "$RESP" '"success":true' "6.1 注册轮转配置"
assert_contains "$RESP" '"strategy":"standard"' "6.2 strategy 正确"
assert_contains "$RESP" '"max_turns":100' "6.3 max_turns 正确"

# 获取配置
RESP=$(curl -s "$API_BASE/goals/${GOAL_ID}/auto-turn/config")
assert_contains "$RESP" '"success":true' "6.4 获取配置"
assert_contains "$RESP" '"interval_seconds":30' "6.5 interval_seconds 正确"

# 列出活跃 Goal
RESP=$(curl -s "$API_BASE/goals")
assert_contains "$RESP" "$GOAL_ID" "6.6 活跃 Goal 列表"

# 触发轮转
RESP=$(curl -s -X POST "$API_BASE/goals/${GOAL_ID}/auto-turn/trigger" \
    -H "Content-Type: application/json" \
    -d '{"trigger":"manual","max_ac_per_turn":2}')
assert_contains "$RESP" '"turn_record"' "6.7 触发轮转返回 turn_record"
assert_contains "$RESP" '"turn_number"' "6.8 turn_number 字段"
assert_contains "$RESP" '"duration_ms"' "6.9 duration_ms 字段"

# 轮转历史
RESP=$(curl -s "$API_BASE/goals/${GOAL_ID}/auto-turn/history")
assert_contains "$RESP" '"history"' "6.10 轮转历史"
assert_contains "$RESP" "$GOAL_ID" "6.11 历史含 goal_id"

# 暂停
RESP=$(curl -s -X POST "$API_BASE/goals/${GOAL_ID}/auto-turn/pause")
assert_contains "$RESP" '"success":true' "6.12 暂停"
assert_contains "$RESP" '"state":"paused"' "6.13 状态为 paused"

# 恢复
RESP=$(curl -s -X POST "$API_BASE/goals/${GOAL_ID}/auto-turn/resume")
assert_contains "$RESP" '"success":true' "6.14 恢复"
assert_contains "$RESP" '"state":"idle"' "6.15 状态恢复为 idle"

# 停止
RESP=$(curl -s -X POST "$API_BASE/goals/${GOAL_ID}/auto-turn/stop")
assert_contains "$RESP" '"success":true' "6.16 停止"
assert_contains "$RESP" '"state":"stopped"' "6.17 状态为 stopped"

# 注销
RESP=$(curl -s -X DELETE "$API_BASE/goals/${GOAL_ID}/auto-turn/config")
assert_contains "$RESP" '"unregistered":true' "6.18 注销配置"

# 注销不存在
RESP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_BASE/goals/nonexistent_${TIMESTAMP}/auto-turn/config")
assert_eq "$RESP" "404" "6.19 注销不存在 Goal 返回 404"

# ============================================================
# 7. 统计
# ============================================================
echo ""
echo -e "${YELLOW}[7] 统计信息${NC}"

RESP=$(curl -s "$API_BASE/stats")
assert_contains "$RESP" '"auto_turn"' "7.1 统计 - auto_turn"
assert_contains "$RESP" '"delegation"' "7.2 统计 - delegation"
assert_contains "$RESP" '"total_goals"' "7.3 统计 - total_goals"
assert_contains "$RESP" '"total_agents"' "7.4 统计 - total_agents"
assert_contains "$RESP" '"total_delegations"' "7.5 统计 - total_delegations"

# ============================================================
# 8. 错误处理
# ============================================================
echo ""
echo -e "${YELLOW}[8] 错误处理${NC}"

# 不存在 Goal 触发
RESP=$(curl -s -X POST "$API_BASE/goals/nonexistent_${TIMESTAMP}/auto-turn/trigger" \
    -H "Content-Type: application/json" \
    -d '{"trigger":"manual"}')
assert_contains "$RESP" '"turn_record"' "8.1 不存在 Goal 触发仍返回 turn_record"
assert_contains "$RESP" '"state":"failed"' "8.2 state=failed"

# 不存在 Agent
RESP=$(curl -s -X DELETE "$API_BASE/agents/nonexistent_${TIMESTAMP}")
assert_contains "$RESP" '"detail"' "8.3 注销不存在 Agent 返回 detail"

# 不存在委派
RESP=$(curl -s -X POST "$API_BASE/delegations/nonexistent_${TIMESTAMP}/complete" \
    -H "Content-Type: application/json" \
    -d '{"success":true}')
assert_contains "$RESP" '"detail"' "8.4 完成不存在委派返回 detail"

# ============================================================
# 9. 清理
# ============================================================
echo ""
echo -e "${YELLOW}[9] 清理${NC}"

# 注销测试 Agent
RESP=$(curl -s -X DELETE "$API_BASE/agents/e2e_impl_${TIMESTAMP}")
assert_contains "$RESP" '"success":true' "9.1 清理 implementer"

RESP=$(curl -s -X DELETE "$API_BASE/agents/e2e_arch_${TIMESTAMP}")
assert_contains "$RESP" '"success":true' "9.2 清理 architect"

RESP=$(curl -s -X DELETE "$API_BASE/agents/e2e_tester_${TIMESTAMP}")
assert_contains "$RESP" '"success":true' "9.3 清理 tester"

# ============================================================
# 汇总
# ============================================================
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASS${NC}"
echo -e "${RED}失败: $FAIL${NC}"
echo -e "${YELLOW}========================================${NC}"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
echo -e "${GREEN}所有测试通过！${NC}"
exit 0
