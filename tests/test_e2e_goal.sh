#!/bin/bash
# ============================================================
# /goal 长时域模式 - E2E Test
# ============================================================
# Cycle 12 P0-2: 验证 /goal 系统的 REST API
# 端点：health/goals(CRUD)/start/pause/resume/complete/fail/abandon/tokens/budget/acceptance/verify/progress/markdown/stats
# ============================================================
set -e

BASE_URL="http://localhost:8765/api/goal"
PASS=0
FAIL=0
TOTAL=0

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
# Test 1: Health
# ============================================================
echo "=== Test 1: Health ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Health returns 200" "$HTTP_CODE" "200"
assert_contains "Health has success=true" "$BODY" '"success":true'
assert_contains "Health has service=goal" "$BODY" '"service":"goal"'
assert_contains "Health has stats" "$BODY" '"stats"'
assert_contains "Health has features" "$BODY" '"features"'
assert_contains "Health has three_file_trust" "$BODY" '"three_file_trust"'

# ============================================================
# Test 2: Create Goal
# ============================================================
echo ""
echo "=== Test 2: Create Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "E2E Test Goal",
        "objective": "Verify goal system end-to-end",
        "constraints": ["Use pytest"],
        "tags": ["e2e", "test"],
        "acceptance_criteria": [
            {"title": "AC1: First criterion", "priority": 3},
            {"title": "AC2: Second criterion", "priority": 2}
        ]
    }')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Create returns 200" "$HTTP_CODE" "200"
assert_contains "Create has success=true" "$BODY" '"success":true'
assert_contains "Create has goal" "$BODY" '"goal"'
assert_contains "Create confirms title" "$BODY" '"title":"E2E Test Goal"'
assert_contains "Create has 2 ACs" "$BODY" '"AC1: First criterion"'
assert_contains "Create has tags" "$BODY" '"tags"'
assert_contains "Create has constraint" "$BODY" '"Use pytest"'

GOAL_ID=$(echo "$BODY" | python3 -c "import sys, json; print(json.load(sys.stdin)['goal']['id'])")
echo "Created goal ID: $GOAL_ID"

# ============================================================
# Test 3: Get Goal
# ============================================================
echo ""
echo "=== Test 3: Get Goal ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Get returns 200" "$HTTP_CODE" "200"
assert_contains "Get has success=true" "$BODY" '"success":true'
assert_contains "Get has goal" "$BODY" '"goal"'
assert_contains "Get confirms ID" "$BODY" "\"id\":\"$GOAL_ID\""

# ============================================================
# Test 4: Update Goal
# ============================================================
echo ""
echo "=== Test 4: Update Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/goals/$GOAL_ID" \
    -H "Content-Type: application/json" \
    -d '{"objective":"Updated objective"}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Update returns 200" "$HTTP_CODE" "200"
assert_contains "Update has success=true" "$BODY" '"success":true'
assert_contains "Update confirms new objective" "$BODY" '"Updated objective"'

# ============================================================
# Test 5: List Goals
# ============================================================
echo ""
echo "=== Test 5: List Goals ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "List returns 200" "$HTTP_CODE" "200"
assert_contains "List has success=true" "$BODY" '"success":true'
assert_contains "List has count" "$BODY" '"count"'
assert_contains "List has goals" "$BODY" '"goals"'

# ============================================================
# Test 6: Start Goal
# ============================================================
echo ""
echo "=== Test 6: Start Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/start")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Start returns 200" "$HTTP_CODE" "200"
assert_contains "Start has success=true" "$BODY" '"success":true'
assert_contains "Start confirms active" "$BODY" '"status":"active"'

# ============================================================
# Test 7: Pause Goal
# ============================================================
echo ""
echo "=== Test 7: Pause Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/pause")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Pause returns 200" "$HTTP_CODE" "200"
assert_contains "Pause confirms paused" "$BODY" '"status":"paused"'

# ============================================================
# Test 8: Resume Goal
# ============================================================
echo ""
echo "=== Test 8: Resume Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/resume")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Resume returns 200" "$HTTP_CODE" "200"
assert_contains "Resume confirms active" "$BODY" '"status":"active"'

# ============================================================
# Test 9: Add Tokens
# ============================================================
echo ""
echo "=== Test 9: Add Tokens ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/tokens" \
    -H "Content-Type: application/json" \
    -d '{"count":5000}')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Add tokens returns 200" "$HTTP_CODE" "200"
assert_contains "Add tokens has success=true" "$BODY" '"success":true'
assert_contains "Add tokens confirms 5000 used" "$BODY" '"used":5000'

# ============================================================
# Test 10: Check Budget
# ============================================================
echo ""
echo "=== Test 10: Check Budget ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/budget")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Budget returns 200" "$HTTP_CODE" "200"
assert_contains "Budget has success=true" "$BODY" '"success":true'
assert_contains "Budget has used" "$BODY" '"used":5000'
assert_contains "Budget has remaining" "$BODY" '"remaining"'

# ============================================================
# Test 11: Add Verify Item
# ============================================================
echo ""
echo "=== Test 11: Add Verify Item ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/verify" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "Run echo test",
        "verify_type": "command",
        "target": "echo success",
        "expected": ""
    }')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Add verify returns 200" "$HTTP_CODE" "200"
assert_contains "Add verify has success=true" "$BODY" '"success":true'
assert_contains "Add verify has item" "$BODY" '"item"'
assert_contains "Add verify confirms title" "$BODY" '"Run echo test"'

# ============================================================
# Test 12: List Verify Items
# ============================================================
echo ""
echo "=== Test 12: List Verify Items ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/verify")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "List verify returns 200" "$HTTP_CODE" "200"
assert_contains "List verify has count" "$BODY" '"count":1'

# ============================================================
# Test 13: Run Verify
# ============================================================
echo ""
echo "=== Test 13: Run Verify ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/verify/run")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Run verify returns 200" "$HTTP_CODE" "200"
assert_contains "Run verify has success=true" "$BODY" '"success":true'
assert_contains "Run verify has report" "$BODY" '"report"'
assert_contains "Run verify has passed" "$BODY" '"passed":1'

# ============================================================
# Test 14: Add Progress
# ============================================================
echo ""
echo "=== Test 14: Add Progress ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/progress" \
    -H "Content-Type: application/json" \
    -d '{
        "status": "completed",
        "action": {"description": "Manually added progress", "target": "test"},
        "duration_ms": 100
    }')
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Add progress returns 200" "$HTTP_CODE" "200"
assert_contains "Add progress has success=true" "$BODY" '"success":true'
assert_contains "Add progress has entry" "$BODY" '"entry"'

# ============================================================
# Test 15: Get Progress
# ============================================================
echo ""
echo "=== Test 15: Get Progress ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/progress")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Get progress returns 200" "$HTTP_CODE" "200"
assert_contains "Get progress has entries" "$BODY" '"entries"'

# ============================================================
# Test 16: Render Markdown (GOAL)
# ============================================================
echo ""
echo "=== Test 16: Render GOAL.md ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/markdown/goal")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Render goal returns 200" "$HTTP_CODE" "200"
assert_contains "Render goal has content" "$BODY" '"content"'
assert_contains "Render goal has # Goal" "$BODY" '# Goal:'
assert_contains "Render goal has AC1" "$BODY" 'AC1'

# ============================================================
# Test 17: Render Markdown (VERIFY)
# ============================================================
echo ""
echo "=== Test 17: Render VERIFY.md ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/markdown/verify")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Render verify returns 200" "$HTTP_CODE" "200"
assert_contains "Render verify has # Verification" "$BODY" 'Verification Checklist'

# ============================================================
# Test 18: Render Markdown (PROGRESS)
# ============================================================
echo ""
echo "=== Test 18: Render PROGRESS.md ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID/markdown/progress")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Render progress returns 200" "$HTTP_CODE" "200"
assert_contains "Render progress has # Progress" "$BODY" 'Progress Log'

# ============================================================
# Test 19: Get Nonexistent Goal (404)
# ============================================================
echo ""
echo "=== Test 19: Get Nonexistent Goal ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/nonexistent_goal_xyz")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Get nonexistent returns 404" "$HTTP_CODE" "404"
assert_contains "Get nonexistent has detail" "$BODY" '"detail"'

# ============================================================
# Test 20: List by status
# ============================================================
echo ""
echo "=== Test 20: List by status=active ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals?status=active")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "List active returns 200" "$HTTP_CODE" "200"
assert_contains "List active has goals" "$BODY" '"goals"'

# ============================================================
# Test 21: Stats
# ============================================================
echo ""
echo "=== Test 21: Stats ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/stats")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Stats returns 200" "$HTTP_CODE" "200"
assert_contains "Stats has total" "$BODY" '"total"'
assert_contains "Stats has active_goals" "$BODY" '"active_goals"'

# ============================================================
# Test 22: Complete (with incomplete AC) should fail
# ============================================================
echo ""
echo "=== Test 22: Complete with incomplete AC ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL_ID/complete")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
# ACs not passed yet, should fail
assert_equals "Complete incomplete returns 400" "$HTTP_CODE" "400"

# ============================================================
# Test 23: Delete Goal
# ============================================================
echo ""
echo "=== Test 23: Delete Goal ==="
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/goals/$GOAL_ID")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Delete returns 200" "$HTTP_CODE" "200"
assert_contains "Delete has success=true" "$BODY" '"success":true'

# 验证删除
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/goals/$GOAL_ID")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
assert_equals "Deleted goal returns 404" "$HTTP_CODE" "404"

# ============================================================
# Test 24: Complete Flow (create → start → add AC → pass → complete)
# ============================================================
echo ""
echo "=== Test 24: Complete Flow ==="
# 创建
RESP=$(curl -s -X POST "$BASE_URL/goals" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "Complete Flow Test",
        "acceptance_criteria": [{"title": "FlowAC1", "priority": 1}]
    }')
GOAL2_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['goal']['id'])")
echo "Created goal2: $GOAL2_ID"

# 启动
RESP=$(curl -s -X POST "$BASE_URL/goals/$GOAL2_ID/start")
echo "Started: $(echo "$RESP" | grep -o '"status":"[^"]*"' | head -1)"

# 列出 AC
RESP=$(curl -s "$BASE_URL/goals/$GOAL2_ID")
AC_ID=$(echo "$RESP" | python3 -c "
import sys, json
g = json.load(sys.stdin)['goal']
print(g['acceptance_criteria'][0]['id'])
")
echo "AC ID: $AC_ID"

# 将 AC 标记为 passed
RESP=$(curl -s -X PUT "$BASE_URL/goals/$GOAL2_ID/acceptance/$AC_ID" \
    -H "Content-Type: application/json" \
    -d '{"status": "passed"}')
assert_contains "Mark AC as passed" "$RESP" '"status":"passed"'

# 完成
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/goals/$GOAL2_ID/complete")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | head -n -1)
assert_equals "Complete returns 200" "$HTTP_CODE" "200"
assert_contains "Complete confirms completed" "$BODY" '"status":"completed"'

# 清理
curl -s -X DELETE "$BASE_URL/goals/$GOAL2_ID" > /dev/null

# ============================================================
# Test 25: Token Warning
# ============================================================
echo ""
echo "=== Test 25: Token Warning ==="
# 创建带小预算的 goal
RESP=$(curl -s -X POST "$BASE_URL/goals" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "Budget Test",
        "token_budget": {"soft_limit": 100, "hard_limit": 200, "warning_threshold": 80, "used": 0}
    }')
GOAL3_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['goal']['id'])")

# 添加 80 tokens 触发 warning
RESP=$(curl -s -X POST "$BASE_URL/goals/$GOAL3_ID/tokens" \
    -H "Content-Type: application/json" \
    -d '{"count": 80}')
RESP=$(curl -s "$BASE_URL/goals/$GOAL3_ID/budget")
assert_contains "Warning triggered" "$RESP" '"is_warning":true'

# 清理
curl -s -X DELETE "$BASE_URL/goals/$GOAL3_ID" > /dev/null

# ============================================================
# 输出结果
# ============================================================
echo ""
echo "============================================"
echo "E2E /goal System Test Results"
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
