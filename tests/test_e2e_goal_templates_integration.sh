#!/bin/bash
# ============================================================
# Cycle 14 P1-5: Goal Templates 集成 E2E 测试
# ============================================================
# 核心作用：端到端验证 Goal Templates 与 Goal Auto-Turn、
#           Multi-Agent Delegation 的跨模块集成
# 测试范围：
#   1. 创建 Goal Template
#   2. Fork 内置模板
#   3. 实例化为 Goal
#   4. 注册 Goal 到 Auto-Turn Engine
#   5. 触发 Auto-Turn 轮转
#   6. 通过 Multi-Agent Delegation 处理 AC
#   7. 验证集成数据流（templates → goal → auto-turn → delegation）
#   8. 清理测试资源
# 前置：后端服务运行在 http://localhost:8000
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
GT_API="/api/goal-templates"
GA_API="/api/goal-automation"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "${RED}[FAIL]${NC} $1"; echo "  Details: $2"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

assert_eq() {
    if [ "$1" = "$2" ]; then log_pass "$3 (value=$1)";
    else log_fail "$3" "expected=$2 actual=$1"; fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then log_pass "$3";
    else log_fail "$3" "expected_contains=$2 actual=$1"; fi
}

# 启动后端（如未运行）
if ! curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
    log_info "后端未运行，尝试启动..."
    cd /home/qizheng/auto_code_ws/backend
    nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning > /tmp/gt_integ.log 2>&1 &
    sleep 6
    cd /home/qizheng/auto_code_ws
fi

log_info "=== 1. 模块健康检查 ==="
GT_HEALTH=$(curl -s "$BASE_URL$GT_API/health")
GA_HEALTH=$(curl -s "$BASE_URL$GA_API/health")
assert_contains "$GT_HEALTH" '"status":"ok"' "1.1 Goal Templates 健康"
assert_contains "$GA_HEALTH" '"status":"ok"' "1.2 Goal Automation 健康"

log_info "=== 2. 创建自定义模板 ==="
CREATE=$(curl -s -X POST "$BASE_URL$GT_API/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "集成测试模板",
    "description": "用于验证 Goal Templates + Auto-Turn + Delegation 集成",
    "category": "development",
    "tags": ["integration", "test"],
    "acceptance_criteria": [
      {"title": "AC1-数据模型", "description": "实现数据模型", "priority": 8, "ac_type": "implementation", "risk_level": "low"},
      {"title": "AC2-API", "description": "实现 REST API", "priority": 7, "ac_type": "implementation", "risk_level": "medium"},
      {"title": "AC3-测试", "description": "编写测试", "priority": 6, "ac_type": "testing", "risk_level": "low"}
    ],
    "default_strategy": "standard",
    "default_max_turns": 10,
    "default_triggers": ["manual", "ac_completed"],
    "recommended_agents": ["implementer", "verifier", "tester"]
  }')
assert_contains "$CREATE" '"success":true' "2.1 创建模板成功"
TEMPLATE_ID=$(echo "$CREATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
[ -n "$TEMPLATE_ID" ] && log_pass "2.2 模板 ID 生成 ($TEMPLATE_ID)" || log_fail "2.2" "no id"

log_info "=== 3. Fork 内置模板 ==="
FORK=$(curl -s -X POST "$BASE_URL$GT_API/templates/tpl_builtin_feature_dev/fork" \
  -H "Content-Type: application/json" \
  -d '{"new_name":"集成测试-Fork","new_tags":["integration","forked"]}')
assert_contains "$FORK" '"success":true' "3.1 Fork 成功"
FORKED_ID=$(echo "$FORK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
FORKED_SOURCE=$(echo "$FORK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('source',''))")
assert_eq "$FORKED_SOURCE" "custom" "3.2 Fork 后 source=custom"

log_info "=== 4. 实例化模板为 Goal Config ==="
GOAL_ID="goal_integration_$(date +%s)"
INST=$(curl -s -X POST "$BASE_URL$GT_API/templates/tpl_builtin_feature_dev/instantiate" \
  -H "Content-Type: application/json" \
  -d "{\"goal_id\":\"$GOAL_ID\"}")
assert_contains "$INST" '"success":true' "4.1 实例化成功"
GOAL_CONFIG=$(echo "$INST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('goal_config',{}),ensure_ascii=False))")
assert_contains "$GOAL_CONFIG" "$GOAL_ID" "4.2 Goal config 包含 goal_id"
assert_contains "$GOAL_CONFIG" "acceptance_criteria" "4.3 Goal config 包含 acceptance_criteria"
AC_COUNT=$(echo "$GOAL_CONFIG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('acceptance_criteria',[])))")
[ "$AC_COUNT" -ge 1 ] && log_pass "4.4 AC 数量正确 ($AC_COUNT)" || log_fail "4.4" "AC count=$AC_COUNT"

log_info "=== 5. 注册 Goal 到 Auto-Turn Engine ==="
TURN_STRATEGY=$(echo "$GOAL_CONFIG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_config',{}).get('strategy','standard'))")
MAX_TURNS=$(echo "$GOAL_CONFIG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_config',{}).get('max_turns',50))")
TRIGGERS=$(echo "$GOAL_CONFIG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('turn_config',{}).get('triggers',['manual'])))")
# v1.1.0 新增：构建本地 Goal 上下文，让 AutoTurnEngine 在 manager=None 时也能找到 Goal
GOAL_CONTEXT=$(echo "$GOAL_CONFIG" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ctx={
  'goal_id': d.get('goal_id'),
  'title': d.get('title',''),
  'description': d.get('description',''),
  'category': d.get('category','custom'),
  'acceptance_criteria': d.get('acceptance_criteria',[])
}
print(json.dumps(ctx,ensure_ascii=False))
")

REGISTER=$(curl -s -X POST "$BASE_URL$GA_API/goals/$GOAL_ID/auto-turn/config" \
  -H "Content-Type: application/json" \
  -d "{
    \"goal_id\":\"$GOAL_ID\",
    \"strategy\":\"$TURN_STRATEGY\",
    \"interval_seconds\":1,
    \"max_turns\":$MAX_TURNS,
    \"auto_verify\":true,
    \"auto_progress\":true,
    \"triggers\":$TRIGGERS,
    \"enabled\":true,
    \"goal_context\":$GOAL_CONTEXT
  }")
assert_contains "$REGISTER" '"success":true' "5.1 注册到 Auto-Turn 成功"
assert_contains "$REGISTER" "$GOAL_ID" "5.2 配置包含 goal_id"

log_info "=== 6. 触发 Auto-Turn 轮转 ==="
TRIGGER=$(curl -s -X POST "$BASE_URL$GA_API/goals/$GOAL_ID/auto-turn/trigger" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","max_ac_per_turn":1}')
assert_contains "$TRIGGER" '"success":true' "6.1 触发轮转成功"
TURN_RECORD=$(echo "$TRIGGER" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('turn_record',{}),ensure_ascii=False))")
assert_contains "$TURN_RECORD" "turn_number" "6.2 包含 turn 记录"
TURN_NUM=$(echo "$TURN_RECORD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_number',0))")
[ "$TURN_NUM" -ge 1 ] && log_pass "6.3 Turn number 递增 (=$TURN_NUM)" || log_fail "6.3" "turn_number=$TURN_NUM"

log_info "=== 7. 验证集成数据流 ==="
# 7.1 检查 Goal 已注册到 Goal Automation
GOAL_LIST=$(curl -s "$BASE_URL$GA_API/goals")
assert_contains "$GOAL_LIST" "$GOAL_ID" "7.1 Goal 在 Goal Automation 列表"

# 7.2 检查 turn history 包含本次轮转
TURN_HIST=$(curl -s "$BASE_URL$GA_API/goals/$GOAL_ID/auto-turn/history?limit=5")
assert_contains "$TURN_HIST" "turn_number" "7.2 轮转历史存在"
HIST_COUNT=$(echo "$TURN_HIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$HIST_COUNT" -ge 1 ] && log_pass "7.3 历史记录数≥1 (count=$HIST_COUNT)" || log_fail "7.3" "count=$HIST_COUNT"

log_info "=== 8. 实例化历史验证 ==="
HIST=$(curl -s "$BASE_URL$GT_API/instantiations?template_id=tpl_builtin_feature_dev")
HIST_COUNT=$(echo "$HIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$HIST_COUNT" -ge 1 ] && log_pass "8.1 实例化历史≥1 (count=$HIST_COUNT)" || log_fail "8.1" "count=$HIST_COUNT"

log_info "=== 9. 跨模块统计 ==="
GT_STATS=$(curl -s "$BASE_URL$GT_API/stats")
GA_STATS=$(curl -s "$BASE_URL$GA_API/stats")
assert_contains "$GT_STATS" '"total_instantiations"' "9.1 Goal Templates 统计"
assert_contains "$GA_STATS" "total_goals" "9.2 Goal Automation 统计"

log_info "=== 10. 清理测试资源 ==="
# 10.1 停止 Auto-Turn
curl -s -X POST "$BASE_URL$GA_API/goals/$GOAL_ID/auto-turn/stop" > /dev/null 2>&1
log_pass "10.1 Auto-Turn 已停止"

# 10.2 注销 Auto-Turn 注册
curl -s -X DELETE "$BASE_URL$GA_API/goals/$GOAL_ID/auto-turn/config" > /dev/null 2>&1
log_pass "10.2 Auto-Turn 配置已注销"

# 10.3 注销自定义模板
[ -n "$TEMPLATE_ID" ] && curl -s -X DELETE "$BASE_URL$GT_API/templates/$TEMPLATE_ID" > /dev/null
log_pass "10.3 自定义模板已注销"

# 10.4 注销 Fork 模板
[ -n "$FORKED_ID" ] && curl -s -X DELETE "$BASE_URL$GT_API/templates/$FORKED_ID" > /dev/null
log_pass "10.4 Fork 模板已注销"

# ============================================================
# 汇总
# ============================================================
echo ""
echo "=========================================="
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 所有跨模块集成测试通过${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAIL 个测试失败${NC}"
    exit 1
fi
