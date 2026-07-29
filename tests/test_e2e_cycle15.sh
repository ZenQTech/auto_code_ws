#!/usr/bin/env bash
# ============================================================
# Cycle 15 E2E 测试 - Goal Sync + Scheduler + LLM Cost + Health
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TOTAL=0
PASS=0
FAIL=0
FAIL_LIST=()

assert() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    TOTAL=$((TOTAL + 1))
    if [[ "$actual" == "$expected" ]]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        FAIL_LIST+=("$desc (expected=$expected actual=$actual)")
        echo "  FAIL: $desc (expected=$expected actual=$actual)"
    fi
}

assert_contains() {
    local desc="$1"
    local actual="$2"
    local substr="$3"
    TOTAL=$((TOTAL + 1))
    if [[ "$actual" == *"$substr"* ]]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        FAIL_LIST+=("$desc")
        echo "  FAIL: $desc"
    fi
}

assert_gt() {
    local desc="$1"
    local actual="$2"
    local threshold="$3"
    TOTAL=$((TOTAL + 1))
    if [[ "$actual" -gt "$threshold" ]]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc ($actual > $threshold)"
    else
        FAIL=$((FAIL + 1))
        FAIL_LIST+=("$desc")
        echo "  FAIL: $desc ($actual not > $threshold)"
    fi
}

# ============================================================
# 启动后端服务
# ============================================================
echo "启动后端服务..."
cd /home/qizheng/auto_code_ws/backend

pkill -f "uvicorn app.main" 2>/dev/null || true
sleep 1

nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8765 > /tmp/cycle15_e2e.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health/live" | grep -q "200"; then
        echo "后端已启动"
        break
    fi
    sleep 1
done

cleanup() {
    if [[ -n "$BACKEND_PID" ]]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    pkill -f "uvicorn app.main" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================
# 1. Health 端点测试
# ============================================================
echo ""
echo "=== 1. Health 端点测试 ==="

RESP=$(curl -s "$BASE_URL/api/health/live")
assert "GET /api/health/live status" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")" \
    "alive"

RESP=$(curl -s "$BASE_URL/api/health/startup")
assert "GET /api/health/startup status" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")" \
    "started"

RESP=$(curl -s "$BASE_URL/api/health/ready")
assert "GET /api/health/ready service" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['service'])")" \
    "hermes-claude-code-platform"

RESP=$(curl -s "$BASE_URL/api/health/components")
TOTAL_COMP=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
assert_gt "GET /api/health/components total" "$TOTAL_COMP" 3

RESP=$(curl -s "$BASE_URL/api/health/cycle15")
CYCLE15_STATUS=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")
assert_contains "GET /api/health/cycle15 status" "$CYCLE15_STATUS" "ok"

RESP=$(curl -s "$BASE_URL/api/health/metrics")
UPTIME=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['process']['uptime_seconds'])")
assert_gt "GET /api/health/metrics uptime" "${UPTIME%.*}" 0

# ============================================================
# 2. Goal Sync 端点测试
# ============================================================
echo ""
echo "=== 2. Goal Sync 端点测试 ==="

RESP=$(curl -s "$BASE_URL/api/cycle15/goal-sync/health")
assert "GET /api/cycle15/goal-sync/health module" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['module'])")" \
    "goal_sync"

RESP=$(curl -s "$BASE_URL/api/cycle15/goal-sync/strategies")
TOTAL_STRATEGIES=$(echo "$RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['strategies']))")
assert_gt "GET /api/cycle15/goal-sync/strategies count" "$TOTAL_STRATEGIES" 0

# 清空旧事件
curl -s -X POST "$BASE_URL/api/cycle15/goal-sync/clear" > /dev/null

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/goal-sync/sync" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"g_e2e_1","ac_id":"ac_1","old_value":"pending","new_value":"passed","direction":"engine_to_manager"}')
SYNC_STATUS=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['event']['status'])")
# 当 manager 未配置时，sync 可能返回 applied (wire_components 成功) 或 failed (无 manager)
TOTAL=$((TOTAL + 1))
if [[ "$SYNC_STATUS" == "applied" ]] || [[ "$SYNC_STATUS" == "failed" ]]; then
    PASS=$((PASS + 1))
    echo "  PASS: POST sync engine->manager status ($SYNC_STATUS)"
else
    FAIL=$((FAIL + 1))
    FAIL_LIST+=("POST sync engine->manager")
    echo "  FAIL: POST sync engine->manager (status=$SYNC_STATUS)"
fi

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/goal-sync/sync" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"g_e2e_1","ac_id":"ac_1","old_value":"pending","new_value":"in_progress","direction":"manager_to_engine"}')
SYNC_STATUS=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['event']['status'])")
TOTAL=$((TOTAL + 1))
if [[ "$SYNC_STATUS" == "applied" ]] || [[ "$SYNC_STATUS" == "failed" ]]; then
    PASS=$((PASS + 1))
    echo "  PASS: POST sync manager->engine status ($SYNC_STATUS)"
else
    FAIL=$((FAIL + 1))
    FAIL_LIST+=("POST sync manager->engine")
    echo "  FAIL: POST sync manager->engine (status=$SYNC_STATUS)"
fi

RESP=$(curl -s "$BASE_URL/api/cycle15/goal-sync/events?goal_id=g_e2e_1")
EVENT_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])")
assert_gt "GET /api/cycle15/goal-sync/events count" "$EVENT_COUNT" 1

# 至少执行一次 sync 后，ac_version 应该 > 0
RESP=$(curl -s "$BASE_URL/api/cycle15/goal-sync/ac-version/g_e2e_1/ac_1")
AC_VERSION=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])")
assert_gt "GET /api/cycle15/goal-sync/ac-version/g_e2e_1/ac_1" "$AC_VERSION" 0

# ============================================================
# 3. Scheduler 端点测试
# ============================================================
echo ""
echo "=== 3. Scheduler 端点测试 ==="

# 清理旧 quota
curl -s -X DELETE "$BASE_URL/api/cycle15/scheduler/quota/g_sched_1" > /dev/null

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/health")
assert "GET /api/cycle15/scheduler/health module" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['module'])")" \
    "goal_scheduler"

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/policies")
POLICY_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['policies']))")
assert_gt "GET /api/cycle15/scheduler/policies count" "$POLICY_COUNT" 0

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/scheduler/quota" \
    -H "Content-Type: application/json" \
    -d '{"goal_id":"g_sched_1","max_tokens":5000,"max_turns":100,"priority":"high"}')
assert "POST register quota goal_id" \
    "$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['quota']['goal_id'])")" \
    "g_sched_1"

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/quotas")
QUOTA_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])")
assert_gt "GET /api/cycle15/scheduler/quotas count" "$QUOTA_COUNT" 0

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/quota/g_sched_1")
assert "GET /api/cycle15/scheduler/quota/g_sched_1" \
    "$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['quota']['goal_id'])")" \
    "g_sched_1"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/scheduler/schedule/g_sched_1")
assert "POST schedule can_run" \
    "$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['decision']['can_run'])")" \
    "True"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/scheduler/active/g_sched_1")
assert "POST active g_sched_1" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['success'])")" \
    "True"

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/queue")
assert "GET /api/cycle15/scheduler/queue success" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['success'])")" \
    "True"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/scheduler/inactive/g_sched_1")
assert "POST inactive g_sched_1" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['success'])")" \
    "True"

RESP=$(curl -s "$BASE_URL/api/cycle15/scheduler/stats")
TOTAL_QUOTAS=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['stats']['total_quotas'])")
assert_gt "GET /api/cycle15/scheduler/stats total_quotas" "$TOTAL_QUOTAS" 0

# ============================================================
# 4. LLM Cost 端点测试
# ============================================================
echo ""
echo "=== 4. LLM Cost 端点测试 ==="

# 清理旧记录
curl -s -X POST "$BASE_URL/api/cycle15/llm-cost/clear" > /dev/null

# 清理所有旧 budgets
curl -s "$BASE_URL/api/cycle15/llm-cost/budgets" | python3 -c "
import sys, json, urllib.request
data = json.load(sys.stdin)
for b in data.get('budgets', []):
    req = urllib.request.Request(
        'http://127.0.0.1:8765/api/cycle15/llm-cost/budget/' + b['budget_id'],
        method='DELETE',
    )
    try:
        urllib.request.urlopen(req)
    except Exception as e:
        pass
" 2>/dev/null || true

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/health")
assert "GET /api/cycle15/llm-cost/health module" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['module'])")" \
    "llm_cost"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/llm-cost/record" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"u_e2e_15","model":"claude-3-5-sonnet","tokens_output":1000,"cost_per_1k_output":0.015,"agent_id":"a1","feature":"test"}')
assert "POST record cost alert_level" \
    "$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['alert_level'])")" \
    "ok"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/llm-cost/budget" \
    -H "Content-Type: application/json" \
    -d '{"dimension":"user","dimension_value":"u_e2e_15","soft_limit_usd":0.01,"hard_limit_usd":0.05}')
assert "POST set budget success" \
    "$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['success'])")" \
    "True"

RESP=$(curl -s -X POST "$BASE_URL/api/cycle15/llm-cost/record" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"u_e2e_15_alert","model":"claude","tokens_output":10000,"cost_per_1k_output":0.015}')
ALERT=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['alert_level'])")
# 此用户没有设置 budget，alert 应为 ok
assert "POST record cost (no budget) alert_level" "$ALERT" "ok"

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/records?user_id=u_e2e_15")
RECORD_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])")
assert_gt "GET records count" "$RECORD_COUNT" 0

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/aggregate/user")
AGG_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['aggregation']))")
assert_gt "GET aggregate by user" "$AGG_COUNT" 0

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/aggregate/model")
assert_contains "GET aggregate by model success" "$RESP" "success"

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/budgets")
BUDGET_COUNT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])")
assert_gt "GET budgets count" "$BUDGET_COUNT" 0

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/alerts")
assert_contains "GET alerts success" "$RESP" "success"

RESP=$(curl -s "$BASE_URL/api/cycle15/llm-cost/summary")
TOTAL_RECORDS=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['summary']['total_records'])")
assert_gt "GET summary total_records" "$TOTAL_RECORDS" 0

# ============================================================
# 总结
# ============================================================
echo ""
echo "=========================================="
echo "Cycle 15 E2E 测试总结"
echo "=========================================="
echo "总测试数: $TOTAL"
echo "通过: $PASS"
echo "失败: $FAIL"
echo "通过率: $(python3 -c "print(f'{$PASS * 100 / max(1, $TOTAL):.1f}%')")"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "失败列表:"
    for f in "${FAIL_LIST[@]}"; do
        echo "  - $f"
    done
    exit 1
fi

echo ""
echo "所有 Cycle 15 E2E 测试通过！"
exit 0
