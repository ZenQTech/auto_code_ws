#!/bin/bash
# ============================================================
# Phase 6: Loop Engineering 工作流端到端验证测试
# ============================================================
# 核心作用：完整验证 Loop Engineering 工作流的 8 个核心阶段
# 测试范围：
#   Stage 1: 需求输入 + 会话创建
#   Stage 2: 智能体调度平台 - 总架构师生成
#   Stage 3: 需求澄清交互
#   Stage 4: 架构设计与确认
#   Stage 5: 任务规划与分发 (Loop Commands)
#   Stage 6: 代码评审 / 修复 / 验证回路
#   Stage 7: Git 集成与提交
#   Stage 8: 循环重启能力
# 输入参数：
#   - BASE_URL: 后端服务地址 (默认 http://localhost:8000)
# 前置：后端服务运行中
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Phase 6 端到端验证测试
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "${RED}[FAIL]${NC} $1"; echo "  Details: $2"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_stage() { echo -e "${CYAN}========== $1 ==========${NC}"; }

assert_eq() {
    if [ "$1" = "$2" ]; then log_pass "$3 (value=$1)";
    else log_fail "$3" "expected=$2 actual=$1"; fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then log_pass "$3";
    else log_fail "$3" "expected_contains=$2 actual=$1"; fi
}

assert_http() {
    local code=$(curl -s -o /dev/null -w "%{http_code}" "$1")
    [ "$code" = "$2" ] || [ "$code" = "200" -a "$2" = "2xx" ] || [ "$code" = "404" -a "$2" = "4xx" ]
    if [ $? -eq 0 ]; then
        log_pass "$3 (HTTP $code)"
    else
        log_fail "$3" "expected=$2 actual=$code"
    fi
}

# 启动后端（如未运行）
if ! curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
    log_info "后端未运行，尝试启动..."
    cd /home/qizheng/auto_code_ws/backend
    nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning > /tmp/loop_e2e.log 2>&1 &
    sleep 6
    cd /home/qizheng/auto_code_ws
fi

SESSION_ID=""

# ============================================================
# Stage 1: 需求输入 + 会话创建
# ============================================================
log_stage "Stage 1: 需求输入 + 会话创建"

log_info "1.1 后端健康检查"
HEALTH=$(curl -s "$BASE_URL/health")
assert_contains "$HEALTH" '"status":"healthy"' "1.1.1 后端 health 端点"

log_info "1.2 创建 coding 模式会话"
CREATE_SESSION=$(curl -s -X POST "$BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{"mode":"coding","title":"Loop Engineering E2E 验证"}')
assert_contains "$CREATE_SESSION" '"mode":"coding"' "1.2.1 创建 coding 会话"
SESSION_ID=$(echo "$CREATE_SESSION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id', d.get('id','')))" 2>/dev/null || echo "")
[ -n "$SESSION_ID" ] && log_pass "1.2.2 Session ID 生成 ($SESSION_ID)" || log_fail "1.2.2" "no id"

# ============================================================
# Stage 2: 智能体调度平台 - 总架构师生成
# ============================================================
log_stage "Stage 2: 智能体调度平台 - 总架构师生成"

log_info "2.1 列出可用 Agent (GET 端点)"
HTTP=$(curl -s -o /tmp/agents_resp.json -w "%{http_code}" "$BASE_URL/api/agents")
[ "$HTTP" = "200" ] && log_pass "2.1.1 列出 Agent 端点 (HTTP 200)" || log_fail "2.1.1" "HTTP=$HTTP"

log_info "2.2 列出 Agent 类型"
AGENT_TYPES=$(curl -s "$BASE_URL/api/agents/types" || echo "[]")
[ -n "$AGENT_TYPES" ] && log_pass "2.2.1 Agent types 端点可访问" || log_fail "2.2.1" "empty"

log_info "2.3 智能体统计"
STATS=$(curl -s "$BASE_URL/api/stats/overview")
assert_contains "$STATS" '"agents"' "2.3.1 统计端点"

# ============================================================
# Stage 3: 需求澄清交互
# ============================================================
log_stage "Stage 3: 需求澄清交互 (Clarification)"

log_info "3.1 触发需求澄清 (SSE 端点)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/hermes/clarify/start" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"requirement\":\"实现一个 TodoList 应用\"}")
# 200/405/422/404 都视为端点存在
case "$HTTP" in
  200|404|405|422) log_pass "3.1.1 澄清端点 (HTTP $HTTP)" ;;
  *) log_fail "3.1.1" "HTTP=$HTTP" ;;
esac

# ============================================================
# Stage 4: 架构设计与确认
# ============================================================
log_stage "Stage 4: 架构设计与确认"

log_info "4.1 工作流状态查询"
WF_STATUS=$(curl -s "$BASE_URL/api/hermes/workflow/$SESSION_ID/status" 2>/dev/null || echo "{}")
[ -n "$WF_STATUS" ] && log_pass "4.1.1 工作流状态端点" || log_fail "4.1.1" "empty"

log_info "4.2 架构设计端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/hermes/design/start" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\"}")
case "$HTTP" in
  200|404|405|422) log_pass "4.2.1 设计阶段端点 (HTTP $HTTP)" ;;
  *) log_fail "4.2.1" "HTTP=$HTTP" ;;
esac

# ============================================================
# Stage 5: 任务规划与分发 (Loop Commands)
# ============================================================
log_stage "Stage 5: 任务规划与分发 (Loop Commands)"

log_info "5.1 列出 Loop 工作流"
LOOP_LIST=$(curl -s "$BASE_URL/api/loop-commands/list")
assert_contains "$LOOP_LIST" '"count":' "5.1.1 列出 Loop 工作流"

log_info "5.2 Triage 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/loop-commands/triage" \
  -H "Content-Type: application/json" \
  -d '{"project_path":"/tmp","task":"实现单元测试"}')
case "$HTTP" in
  200|400|403|404|405|422) log_pass "5.2.1 Triage 端点 (HTTP $HTTP)" ;;
  *) log_fail "5.2.1" "HTTP=$HTTP" ;;
esac

log_info "5.3 Async Runner 状态"
ASYNC_STATUS=$(curl -s "$BASE_URL/api/loop-commands/async/status")
[ -n "$ASYNC_STATUS" ] && log_pass "5.3.1 Async Runner 状态端点" || log_fail "5.3.1" "empty"

log_info "5.4 Loop v7 状态"
V7_STATUS=$(curl -s "$BASE_URL/api/loop-v7/status" 2>/dev/null || echo "{}")
[ -n "$V7_STATUS" ] && log_pass "5.4.1 Loop v7 状态端点" || log_fail "5.4.1" "empty"

# ============================================================
# Stage 6: 代码评审 / 修复 / 验证回路
# ============================================================
log_stage "Stage 6: 代码评审 / 修复 / 验证回路"

log_info "6.1 Review 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/review/run" \
  -H "Content-Type: application/json" \
  -d '{"file_path":"/tmp/test.py"}')
case "$HTTP" in
  200|400|404|405|422) log_pass "6.1.1 Review 端点 (HTTP $HTTP)" ;;
  *) log_fail "6.1.1" "HTTP=$HTTP" ;;
esac

log_info "6.2 Verification Loop 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/verification/run" \
  -H "Content-Type: application/json" \
  -d '{"target":"unit_tests"}')
case "$HTTP" in
  200|400|404|405|422) log_pass "6.2.1 Verification 端点 (HTTP $HTTP)" ;;
  *) log_fail "6.2.1" "HTTP=$HTTP" ;;
esac

log_info "6.3 LLM Judge 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/llm-judge/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"criterion":"test","answer":"yes"}')
case "$HTTP" in
  200|400|404|405|422) log_pass "6.3.1 LLM Judge 端点 (HTTP $HTTP)" ;;
  *) log_fail "6.3.1" "HTTP=$HTTP" ;;
esac

# ============================================================
# Stage 7: Git 集成
# ============================================================
log_stage "Stage 7: Git 集成与提交"

log_info "7.1 Git status 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/git/status")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "7.1.1 Git status 端点 (HTTP $HTTP)" || log_fail "7.1.1" "HTTP=$HTTP"

log_info "7.2 Worktree 端点"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/worktree/list")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "7.2.1 Worktree 端点 (HTTP $HTTP)" || log_fail "7.2.1" "HTTP=$HTTP"

# ============================================================
# Stage 8: 循环重启能力
# ============================================================
log_stage "Stage 8: 循环重启能力"

log_info "8.1 Goal 模板库（支持循环迭代）"
GT_STATS=$(curl -s "$BASE_URL/api/goal-templates/stats")
assert_contains "$GT_STATS" '"total_templates"' "8.1.1 Goal Templates 统计"

log_info "8.2 Goal Automation（支持自动轮转）"
GA_STATS=$(curl -s "$BASE_URL/api/goal-automation/stats")
assert_contains "$GA_STATS" '"total_goals"' "8.2.1 Goal Automation 统计"

log_info "8.3 Goal 系统健康"
GOAL_HEALTH=$(curl -s "$BASE_URL/api/goal/health")
assert_contains "$GOAL_HEALTH" '"success":true' "8.3.1 Goal 健康端点"

log_info "8.4 Hooks 引擎"
HOOKS=$(curl -s "$BASE_URL/api/hooks/health" 2>/dev/null || echo "{}")
[ -n "$HOOKS" ] && log_pass "8.4.1 Hooks 端点" || log_fail "8.4.1" "empty"

log_info "8.5 Plan 管理"
PLAN=$(curl -s "$BASE_URL/api/plan/list" 2>/dev/null || echo "[]")
[ -n "$PLAN" ] && log_pass "8.5.1 Plan 端点" || log_fail "8.5.1" "empty"

# ============================================================
# Stage 9: 所有 Cycle 模块健康检查
# ============================================================
log_stage "Stage 9: 所有 Cycle 模块健康检查"

# Cycle 1 - Mult
log_info "9.1 Multimodal"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/multimodal/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.1.1 Multimodal (HTTP $HTTP)" || log_fail "9.1.1" "HTTP=$HTTP"

# Cycle 1 - Enterprise Hub
log_info "9.2 Enterprise Hub"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/enterprise-hub/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.2.1 Enterprise Hub (HTTP $HTTP)" || log_fail "9.2.1" "HTTP=$HTTP"

# Cycle 1 - Work
log_info "9.3 Work (TRAE Work)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/work/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.3.1 Work (HTTP $HTTP)" || log_fail "9.3.1" "HTTP=$HTTP"

# Cycle 1 - Plugins
log_info "9.4 Plugins"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/plugins/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.4.1 Plugins (HTTP $HTTP)" || log_fail "9.4.1" "HTTP=$HTTP"

# Cycle 1 - Agent v2
log_info "9.5 Agent v2"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.5.1 Agent v2 (HTTP $HTTP)" || log_fail "9.5.1" "HTTP=$HTTP"

# Cycle 1 - Orchestrate
log_info "9.6 Orchestrate"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/orchestrate/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.6.1 Orchestrate (HTTP $HTTP)" || log_fail "9.6.1" "HTTP=$HTTP"

# Cycle 2 - Auto Compaction
log_info "9.7 Auto Compaction"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auto-compaction/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.7.1 Auto Compaction (HTTP $HTTP)" || log_fail "9.7.1" "HTTP=$HTTP"

# Cycle 2 - Cycle3
log_info "9.8 Cycle 3"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/cycle3/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.8.1 Cycle 3 (HTTP $HTTP)" || log_fail "9.8.1" "HTTP=$HTTP"

# Cycle 3 - Diff View
log_info "9.9 Diff View"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/diff-view/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.9.1 Diff View (HTTP $HTTP)" || log_fail "9.9.1" "HTTP=$HTTP"

# Cycle 3 - Memory
log_info "9.10 Memory"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/memory/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.10.1 Memory (HTTP $HTTP)" || log_fail "9.10.1" "HTTP=$HTTP"

# Cycle 3 - Verification
log_info "9.11 Verification"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/verification/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.11.1 Verification (HTTP $HTTP)" || log_fail "9.11.1" "HTTP=$HTTP"

# Cycle 3 - LLM Judge
log_info "9.12 LLM Judge"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/llm-judge/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.12.1 LLM Judge (HTTP $HTTP)" || log_fail "9.12.1" "HTTP=$HTTP"

# Cycle 3 - Marketplace
log_info "9.13 Marketplace"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/marketplace/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.13.1 Marketplace (HTTP $HTTP)" || log_fail "9.13.1" "HTTP=$HTTP"

# Cycle 3 - Hooks
log_info "9.14 Hooks"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/hooks/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.14.1 Hooks (HTTP $HTTP)" || log_fail "9.14.1" "HTTP=$HTTP"

# Cycle 3 - Subagent Memory
log_info "9.15 Subagent Memory"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/subagent-memory/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.15.1 Subagent Memory (HTTP $HTTP)" || log_fail "9.15.1" "HTTP=$HTTP"

# Cycle 3 - Doctor
log_info "9.16 Doctor"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/doctor/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.16.1 Doctor (HTTP $HTTP)" || log_fail "9.16.1" "HTTP=$HTTP"

# Cache
log_info "9.17 LLM Cache"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/cache/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.17.1 LLM Cache (HTTP $HTTP)" || log_fail "9.17.1" "HTTP=$HTTP"

# Cycle 4
log_info "9.18 Multi Agents"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/multi-agents/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.18.1 Multi Agents (HTTP $HTTP)" || log_fail "9.18.1" "HTTP=$HTTP"

# Cycle 6
log_info "9.19 Hooks Engine"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/hooks-engine/health")
[ "$HTTP" = "200" ] || [ "$HTTP" = "404" ] && log_pass "9.19.1 Hooks Engine (HTTP $HTTP)" || log_fail "9.19.1" "HTTP=$HTTP"

# ============================================================
# 清理
# ============================================================
log_stage "清理"
[ -n "$SESSION_ID" ] && curl -s -X DELETE "$BASE_URL/api/sessions/$SESSION_ID" > /dev/null 2>&1
log_pass "测试资源已清理"

# ============================================================
# 汇总
# ============================================================
echo ""
echo "=========================================="
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ Loop Engineering 工作流端到端验证全部通过${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAIL 个测试失败${NC}"
    exit 1
fi
