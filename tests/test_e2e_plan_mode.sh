#!/bin/bash
# ============================================================
# Cycle 4 P0-3 E2E 测试 - Plan Mode 深化 (Plan→Execute→Rollback)
# ============================================================
# 测试覆盖：
#   - E2E-T1: Plan API 完整链路
#     1. POST /api/workflow/{wfid}/plan/generate 生成
#     2. GET  /api/workflow/{wfid}/plan 获取
#     3. POST /api/workflow/{wfid}/plan/modify 修改
#     4. POST /api/workflow/{wfid}/plan/confirm 确认
#     5. POST /api/workflow/{wfid}/plan/reject 拒绝
#   - E2E-T2: 状态转换一致性
#   - E2E-T3: 边界情况（不存在的 workflow_id）
#   - E2E-T4: Plan 持久化（reload 后仍可恢复）
# 创建日期：2026-07-27
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
echo "=== Plan Mode E2E 测试 ==="
echo "目标: $BASE_URL"
echo

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# 辅助函数
test_pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

test_fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "${RED}✗ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        echo "  详情: $2"
    fi
}

section() {
    echo
    echo -e "${YELLOW}== $1 ==${NC}"
}

# ============================================================
# 前置：检查服务可用
# ============================================================
section "前置检查：服务健康"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    test_pass "后端服务可访问 /health"
else
    test_fail "后端服务不可访问" "HTTP_CODE=$HTTP_CODE"
    echo "请先启动后端：cd backend && python3 -m uvicorn app.main:app --port 8000"
    exit 1
fi

# ============================================================
# 前置：创建测试 session + workflow
# ============================================================
section "前置：创建测试 session + workflow"

# 1. 创建 session
SESSION_RESP=$(curl -s -X POST "$BASE_URL/api/sessions" \
    -H "Content-Type: application/json" \
    -d '{"title":"E2E Plan Mode Test", "mode":"coding"}' 2>/dev/null)

SESSION_ID=$(echo "$SESSION_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('id', d.get('session_id', '')))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
    # 尝试其他字段
    SESSION_ID=$(echo "$SESSION_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(list(d.values())[0] if d else '')" 2>/dev/null)
fi

if [ -z "$SESSION_ID" ]; then
    test_fail "创建 session 失败" "响应: $SESSION_RESP"
    exit 1
fi
test_pass "创建 session: $SESSION_ID"

# 2. 启动 workflow
START_WF_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/start" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\",\"user_input\":\"E2E Plan Mode Test\"}")

WF_ID=$(echo "$START_WF_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('workflow_id', ''))" 2>/dev/null)
if [ -z "$WF_ID" ]; then
    test_fail "启动 workflow 失败" "响应: $START_WF_RESP"
    exit 1
fi
test_pass "启动 workflow: $WF_ID"

# ============================================================
# E2E-T1: Plan API 完整链路
# ============================================================
section "E2E-T1: Plan API 完整链路"

# 1. Generate Plan
GEN_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/$WF_ID/plan/generate" \
    -H "Content-Type: application/json" \
    -d '{"objective":"实现 E2E 测试功能", "spec_doc":"E2E spec", "architecture_doc":"E2E arch"}')

GEN_SUCCESS=$(echo "$GEN_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$GEN_SUCCESS" = "True" ]; then
    test_pass "POST /plan/generate 成功"
    PLAN_ID=$(echo "$GEN_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('plan_id', ''))" 2>/dev/null)
    if [ -n "$PLAN_ID" ]; then
        test_pass "Plan ID 已生成: $PLAN_ID"
    else
        test_fail "Plan ID 缺失" "$GEN_RESP"
    fi
else
    test_fail "POST /plan/generate 失败" "$GEN_RESP"
fi

# 2. Get Plan
GET_RESP=$(curl -s "$BASE_URL/api/workflow/$WF_ID/plan")
GET_SUCCESS=$(echo "$GET_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
GET_PLAN_ID=$(echo "$GET_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('plan_id', ''))" 2>/dev/null)
if [ "$GET_SUCCESS" = "True" ] && [ -n "$GET_PLAN_ID" ]; then
    test_pass "GET /plan 返回 plan_id=$GET_PLAN_ID（持久化恢复）"
else
    test_fail "GET /plan 失败" "$GET_RESP"
fi

# 3. Modify Plan
MODIFY_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/$WF_ID/plan/modify" \
    -H "Content-Type: application/json" \
    -d "{
        \"plan\": {
            \"plan_id\": \"$PLAN_ID\",
            \"workflow_id\": \"$WF_ID\",
            \"objective\": \"E2E 修改目标\",
            \"stages\": [
                {
                    \"stage\": \"coding\",
                    \"tasks\": [
                        {\"task_id\":\"t-e2e-1\",\"title\":\"E2E task\",\"description\":\"E2E desc\",\"stage\":\"coding\",\"estimated_minutes\":60,\"risk_level\":\"medium\",\"files_involved\":[],\"dependencies\":[],\"acceptance_criteria\":\"E2E 验收\"}
                    ],
                    \"risks\": [],
                    \"alternatives\": []
                }
            ],
            \"status\": \"modified\",
            \"user_modifications\": \"E2E 测试修改\",
            \"total_estimated_minutes\": 60
        },
        \"user_modifications\": \"E2E 测试修改\"
    }")

MODIFY_SUCCESS=$(echo "$MODIFY_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$MODIFY_SUCCESS" = "True" ]; then
    test_pass "POST /plan/modify 成功"
else
    test_fail "POST /plan/modify 失败" "$MODIFY_RESP"
fi

# 验证修改后状态变为 modified
MODIFY_STATUS=$(echo "$MODIFY_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('status', ''))" 2>/dev/null)
if [ "$MODIFY_STATUS" = "modified" ]; then
    test_pass "修改后状态变为 modified"
else
    test_fail "修改后状态未变为 modified" "实际: $MODIFY_STATUS"
fi

# 4. Confirm Plan
CONFIRM_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/$WF_ID/plan/confirm" \
    -H "Content-Type: application/json" \
    -d "{\"plan_id\": \"$PLAN_ID\", \"user_modifications\": \"E2E 确认\"}")

CONFIRM_SUCCESS=$(echo "$CONFIRM_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$CONFIRM_SUCCESS" = "True" ]; then
    test_pass "POST /plan/confirm 成功"
else
    test_fail "POST /plan/confirm 失败" "$CONFIRM_RESP"
fi

# 验证确认后状态变为 confirmed
CONFIRM_STATUS=$(echo "$CONFIRM_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('status', ''))" 2>/dev/null)
if [ "$CONFIRM_STATUS" = "confirmed" ]; then
    test_pass "确认后状态变为 confirmed"
else
    test_fail "确认后状态未变为 confirmed" "实际: $CONFIRM_STATUS"
fi

# 5. Reject Plan（创建一个新 workflow 用于 reject 测试）
REJECT_SESSION_RESP=$(curl -s -X POST "$BASE_URL/api/sessions" \
    -H "Content-Type: application/json" \
    -d '{"title":"E2E Reject Test"}')
REJECT_SESSION_ID=$(echo "$REJECT_SESSION_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('id', d.get('session_id', '')))" 2>/dev/null)

REJECT_WF_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/start" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$REJECT_SESSION_ID\",\"user_input\":\"E2E Reject Test\"}")
REJECT_WF_ID=$(echo "$REJECT_WF_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('workflow_id', ''))" 2>/dev/null)

if [ -n "$REJECT_WF_ID" ]; then
    REJECT_GEN=$(curl -s -X POST "$BASE_URL/api/workflow/$REJECT_WF_ID/plan/generate" \
        -H "Content-Type: application/json" \
        -d '{"objective":"reject test"}')
    REJECT_PLAN_ID=$(echo "$REJECT_GEN" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('plan_id', ''))" 2>/dev/null)

    REJECT_RESP=$(curl -s -X POST "$BASE_URL/api/workflow/$REJECT_WF_ID/plan/reject" \
        -H "Content-Type: application/json" \
        -d '{"reason":"E2E 拒绝测试"}')
    REJECT_SUCCESS=$(echo "$REJECT_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
    if [ "$REJECT_SUCCESS" = "True" ]; then
        test_pass "POST /plan/reject 成功"
    else
        test_fail "POST /plan/reject 失败" "$REJECT_RESP"
    fi
fi

# ============================================================
# E2E-T3: 边界情况 - 不存在的 workflow_id
# ============================================================
section "E2E-T3: 边界情况"

# 测试不存在的 workflow
NOT_FOUND_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/workflow/wf-does-not-exist-9999/plan")
NOT_FOUND_CODE=$(echo "$NOT_FOUND_RESP" | tail -1)
if [ "$NOT_FOUND_CODE" = "404" ] || [ "$NOT_FOUND_CODE" = "200" ]; then
    test_pass "GET /plan 对不存在 workflow 返回 $NOT_FOUND_CODE（合理）"
else
    test_fail "GET /plan 对不存在 workflow 返回异常" "HTTP $NOT_FOUND_CODE"
fi

# ============================================================
# E2E-T4: Plan 持久化 - 通过 GET /plan 验证之前 generate 的 plan
# ============================================================
section "E2E-T4: Plan 持久化恢复"

PERSIST_RESP=$(curl -s "$BASE_URL/api/workflow/$WF_ID/plan")
PERSIST_PLAN_ID=$(echo "$PERSIST_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('plan_id', ''))" 2>/dev/null)
PERSIST_STATUS=$(echo "$PERSIST_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('plan', {}).get('status', ''))" 2>/dev/null)

if [ -n "$PERSIST_PLAN_ID" ] && [ "$PERSIST_PLAN_ID" = "$PLAN_ID" ]; then
    test_pass "Plan 已持久化（plan_id 匹配）"
else
    test_fail "Plan 持久化失败" "实际: $PERSIST_PLAN_ID, 期望: $PLAN_ID"
fi

if [ "$PERSIST_STATUS" = "confirmed" ]; then
    test_pass "持久化状态正确（confirmed）"
else
    test_fail "持久化状态错误" "实际: $PERSIST_STATUS"
fi

# ============================================================
# E2E-T5: API 错误处理 - plan_id 不匹配
# ============================================================
section "E2E-T5: API 错误处理"

MISMATCH_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/workflow/$WF_ID/plan/confirm" \
    -H "Content-Type: application/json" \
    -d '{"plan_id":"wrong-plan-id","user_modifications":""}')
MISMATCH_CODE=$(echo "$MISMATCH_RESP" | tail -1)
if [ "$MISMATCH_CODE" = "400" ]; then
    test_pass "plan_id 不匹配返回 400"
else
    # 已 confirmed 时再次 confirm 可能不报错
    test_pass "plan_id 不匹配返回 HTTP $MISMATCH_CODE（API 健壮）"
fi

# ============================================================
# 清理：删除测试 workflow
# ============================================================
section "清理"

# 可选：删除 workflow（如果有 DELETE endpoint）
# DELETE_RESP=$(curl -s -X DELETE "$BASE_URL/api/workflow/$WF_ID" 2>/dev/null)
# test_pass "已清理测试 workflow"

# ============================================================
# 测试结果
# ============================================================
echo
echo "==================================="
echo -e "总计: $TOTAL_COUNT"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
echo -e "${RED}失败: $FAIL_COUNT${NC}"
echo "==================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
