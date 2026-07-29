#!/bin/bash
# ============================================================
# Goal Automation 模块 - 前端 E2E 测试
# ============================================================
# 核心作用：验证前端页面可访问性 + API 端点联通
# 运行流程：检查前端路由 + 后端 API 健康 + 子模块联通
# 修改记录：
#   - 2026-07-28 | v6.32.0 | Cycle 14 P1-4 初始版本
# ============================================================

set -e

FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

assert_eq() {
    if [ "$1" = "$2" ]; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected to contain '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}=== Goal Automation 前端 E2E 测试 (v6.32.0) ===${NC}"
echo "Frontend: $FRONTEND_URL"
echo "Backend: $BACKEND_URL"
echo ""

# ============================================================
# 1. 前端页面
# ============================================================
echo -e "${YELLOW}[1] 前端路由${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/goal-automation")
assert_eq "$HTTP_CODE" "200" "/goal-automation 页面可访问"

# ============================================================
# 2. 后端 API 联通
# ============================================================
echo -e "\n${YELLOW}[2] 后端 API 联通${NC}"

RESP=$(curl -s "$BACKEND_URL/api/goal-automation/health")
assert_contains "$RESP" '"status":"ok"' "后端 goal-automation 健康"
assert_contains "$RESP" '"module":"goal-automation"' "模块标识正确"
assert_contains "$RESP" '"auto_turn":"ok"' "auto_turn 模块 ok"
assert_contains "$RESP" '"delegation":"ok"' "delegation 模块 ok"

RESP=$(curl -s "$BACKEND_URL/api/goal-automation/stats")
assert_contains "$RESP" '"success":true' "stats API 返回 success"
assert_contains "$RESP" '"auto_turn"' "stats 包含 auto_turn"
assert_contains "$RESP" '"delegation"' "stats 包含 delegation"

# ============================================================
# 3. Auto-Turn 子模块
# ============================================================
echo -e "\n${YELLOW}[3] Auto-Turn 子模块${NC}"

RESP=$(curl -s "$BACKEND_URL/api/goal-automation/goals")
assert_contains "$RESP" '"success":true' "list_active_goals API"
assert_contains "$RESP" '"goals"' "包含 goals 字段"

# 测试注册 Goal
TIMESTAMP=$(date +%s)
GOAL_ID="goal_e2e_fe_${TIMESTAMP}"
RESP=$(curl -s -X POST "$BACKEND_URL/api/goal-automation/goals/${GOAL_ID}/auto-turn/config" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"'"$GOAL_ID"'","strategy":"aggressive","max_turns":5,"triggers":["manual"]}')
assert_contains "$RESP" '"success":true' "register_goal_config 成功"
assert_contains "$RESP" '"state":"idle"' "初始状态为 idle"

# 获取配置
RESP=$(curl -s "$BACKEND_URL/api/goal-automation/goals/${GOAL_ID}/auto-turn/config")
assert_contains "$RESP" '"success":true' "get_goal_config 成功"
assert_contains "$RESP" '"strategy":"aggressive"' "strategy 持久化"

# ============================================================
# 4. Agent 子模块
# ============================================================
echo -e "\n${YELLOW}[4] Agent 子模块${NC}"

# 列出 Agent
RESP=$(curl -s "$BACKEND_URL/api/goal-automation/agents")
assert_contains "$RESP" '"success":true' "list_agents API"
assert_contains "$RESP" '"count"' "包含 count 字段"

# 注册 Agent
AGENT_ID="e2e_architect_${TIMESTAMP}"
RESP=$(curl -s -X POST "$BACKEND_URL/api/goal-automation/agents" \
    -H "Content-Type: application/json" \
    -d '{"agent_id":"'"$AGENT_ID"'","role":"architect","name":"E2E Architect","capabilities":["python","review"],"risk_levels":["low","medium","high","critical"],"max_load":3}')
assert_contains "$RESP" '"success":true' "register_agent 成功"
assert_contains "$RESP" '"role":"architect"' "role 正确"

# Agent 健康检查
RESP=$(curl -s "$BACKEND_URL/api/goal-automation/agents/health")
assert_contains "$RESP" '"success":true' "agents_health API"
assert_contains "$RESP" '"health"' "包含 health 字段"

# Agent 负载
RESP=$(curl -s "$BACKEND_URL/api/goal-automation/agents/load")
assert_contains "$RESP" '"success":true' "agents_load API"
assert_contains "$RESP" '"distribution"' "包含 distribution 字段"

# ============================================================
# 5. Delegation 子模块
# ============================================================
echo -e "\n${YELLOW}[5] Delegation 子模块${NC}"

# 委派任务
RESP=$(curl -s -X POST "$BACKEND_URL/api/goal-automation/delegations" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"'"$GOAL_ID"'","ac_id":"ac_e2e_1","ac_title":"Implement feature X","ac_type":"implementation","risk_level":"medium","required_capabilities":["python"],"priority":3}')
assert_contains "$RESP" '"success":true' "create_delegation 成功"
assert_contains "$RESP" '"decision":"delegated"' "委派给 architect"

# 列出委派
RESP=$(curl -s "$BACKEND_URL/api/goal-automation/delegations")
assert_contains "$RESP" '"success":true' "list_delegations API"
assert_contains "$RESP" '"history"' "包含 history 字段"

# ============================================================
# 6. Meta API
# ============================================================
echo -e "\n${YELLOW}[6] Meta API${NC}"

RESP=$(curl -s "$BACKEND_URL/api/goal-automation/meta/roles")
assert_contains "$RESP" '"success":true' "meta/roles API"
assert_contains "$RESP" '"architect"' "包含 architect 角色"

RESP=$(curl -s "$BACKEND_URL/api/goal-automation/meta/strategies")
assert_contains "$RESP" '"success":true' "meta/strategies API"
assert_contains "$RESP" '"aggressive"' "包含 aggressive 策略"

# ============================================================
# 7. 清理
# ============================================================
echo -e "\n${YELLOW}[7] 清理${NC}"

# 注销 Goal
curl -s -X DELETE "$BACKEND_URL/api/goal-automation/goals/${GOAL_ID}/auto-turn/config" >/dev/null
echo -e "${GREEN}✓${NC} 注销测试 Goal"

# 注销 Agent
curl -s -X DELETE "$BACKEND_URL/api/goal-automation/agents/${AGENT_ID}" >/dev/null
echo -e "${GREEN}✓${NC} 注销测试 Agent"

# ============================================================
# 8. 总结
# ============================================================
echo ""
echo "================================"
echo -e "总通过: ${GREEN}${PASS}${NC}  总失败: ${RED}${FAIL}${NC}"
echo "================================"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
echo -e "${GREEN}所有测试通过 ✓${NC}"
exit 0
