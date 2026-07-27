#!/bin/bash
# ============================================================
# Session Rollout JSONL E2E 测试
# ============================================================
# 覆盖范围：
#   1. 记录 turn（创建 turn_context + user_message 事件）
#   2. 记录 response items
#   3. 分页查询 rollout
#   4. beforeTurnId fork
#   5. 导出/导入往返
#   6. rollout 状态信息
#   7. 错误场景
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-9
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
TEST_NAME="E2E Session Rollout JSONL"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    PASSED=$((PASSED+1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    if [ -n "$2" ]; then
        echo -e "    ${RED}详情${NC}: $2"
    fi
    FAILED=$((FAILED+1))
}

section() {
    echo ""
    echo -e "${YELLOW}=== $1 ===${NC}"
}

# 唯一 session id
SESSION_ID="e2e-rollout-$(date +%s)-$$"

# ============================================================
# Test 1: 记录 turn 和 response
# ============================================================
section "Test 1: 记录 turn（创建 turn_context + user_message 事件）"

TURN_RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/turn" \
    -H "Content-Type: application/json" \
    -d '{"user_prompt":"什么是 Python？"}')
TURN_ID=$(echo "$TURN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_id', ''))" 2>/dev/null)
ITEM_TYPE=$(echo "$TURN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('item', {}).get('type', ''))" 2>/dev/null)

if [ -n "$TURN_ID" ] && [ "$ITEM_TYPE" = "turn_context" ]; then
    pass "POST turn → turn_id=$TURN_ID, type=$ITEM_TYPE"
else
    fail "POST turn 失败" "$TURN_RESP"
    exit 1
fi

# 记录 AI 响应
RESP_TEXT=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/response" \
    -H "Content-Type: application/json" \
    -d "{\"item_type\":\"text\",\"text\":\"Python 是一种解释型语言\",\"turn_id\":\"$TURN_ID\"}")
RESP_LINE_NO=$(echo "$RESP_TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('item', {}).get('line_no', 0))" 2>/dev/null)

if [ "$RESP_LINE_NO" -ge 2 ]; then
    pass "POST response text → line_no=$RESP_LINE_NO"
else
    fail "POST response text 失败" "$RESP_TEXT"
fi

# ============================================================
# Test 2: 记录 function_call
# ============================================================
section "Test 2: 记录 function_call"

RESP_FC=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/response" \
    -H "Content-Type: application/json" \
    -d "{\"item_type\":\"function_call\",\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"ls\\\"}\",\"call_id\":\"call-1\",\"turn_id\":\"$TURN_ID\"}")
FC_NAME=$(echo "$RESP_FC" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('item', {}).get('payload', {}).get('name', ''))" 2>/dev/null)

if [ "$FC_NAME" = "Bash" ]; then
    pass "POST function_call → name=$FC_NAME"
else
    fail "POST function_call 失败" "$RESP_FC"
fi

# ============================================================
# Test 3: 分页查询
# ============================================================
section "Test 3: 分页查询 rollout"

# 第一个 turn 后我们至少有 3 个 items
PAGINATE=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/rollout?limit=2&offset=0")
TOTAL=$(echo "$PAGINATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total_items', 0))" 2>/dev/null)
HAS_MORE=$(echo "$PAGINATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('has_more', False))" 2>/dev/null)
ITEM_COUNT=$(echo "$PAGINATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('items', [])))" 2>/dev/null)

if [ "$TOTAL" -ge 3 ] && [ "$ITEM_COUNT" -eq 2 ] && [ "$HAS_MORE" = "True" ]; then
    pass "GET rollout limit=2 offset=0 → total=$TOTAL, has_more=true, items=$ITEM_COUNT"
else
    fail "分页查询失败" "total=$TOTAL, items=$ITEM_COUNT, has_more=$HAS_MORE"
fi

# 第二页
PAGINATE2=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/rollout?limit=2&offset=2")
ITEM_COUNT2=$(echo "$PAGINATE2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('items', [])))" 2>/dev/null)

if [ "$ITEM_COUNT2" -ge 1 ]; then
    pass "GET rollout limit=2 offset=2 → items=$ITEM_COUNT2"
else
    fail "第二页查询失败" "$PAGINATE2"
fi

# ============================================================
# Test 4: 添加更多 turn 用于 fork 测试
# ============================================================
section "Test 4: 添加更多 turn 用于 fork"

TURN2=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/turn" \
    -H "Content-Type: application/json" \
    -d '{"user_prompt":"第二个问题"}')
TURN2_ID=$(echo "$TURN2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_id', ''))" 2>/dev/null)
curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/response" \
    -H "Content-Type: application/json" \
    -d "{\"item_type\":\"text\",\"text\":\"第二个回答\",\"turn_id\":\"$TURN2_ID\"}" > /dev/null

TURN3=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/turn" \
    -H "Content-Type: application/json" \
    -d '{"user_prompt":"第三个问题"}')
TURN3_ID=$(echo "$TURN3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_id', ''))" 2>/dev/null)
curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/rollout/response" \
    -H "Content-Type: application/json" \
    -d "{\"item_type\":\"text\",\"text\":\"第三个回答\",\"turn_id\":\"$TURN3_ID\"}" > /dev/null

if [ -n "$TURN2_ID" ] && [ -n "$TURN3_ID" ]; then
    pass "添加 turn 2 (${TURN2_ID:0:16}...) 和 turn 3 (${TURN3_ID:0:16}...)"
else
    fail "添加 turn 失败" "TURN2=$TURN2_ID TURN3=$TURN3_ID"
fi

# ============================================================
# Test 5: beforeTurnId fork
# ============================================================
section "Test 5: POST /fork-turn (Codex v0.145.0)"

FORK_RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/fork-turn" \
    -H "Content-Type: application/json" \
    -d "{\"before_turn_id\":\"$TURN2_ID\",\"title\":\"Fork Test\"}")
FORK_SUCCESS=$(echo "$FORK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
NEW_SESSION_ID=$(echo "$FORK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session', {}).get('id', ''))" 2>/dev/null)
ITEMS_COPIED=$(echo "$FORK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('items_copied', 0))" 2>/dev/null)

if [ "$FORK_SUCCESS" = "True" ] && [ -n "$NEW_SESSION_ID" ]; then
    pass "fork-turn before_turn_id=${TURN2_ID:0:16}... → new=$NEW_SESSION_ID, items_copied=$ITEMS_COPIED"
else
    fail "fork-turn 失败" "$FORK_RESP"
fi

# ============================================================
# Test 6: fork 失败场景（不存在的 turn）
# ============================================================
section "Test 6: fork 不存在的 turn → 失败"

FORK_BAD=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/sessions/$SESSION_ID/fork-turn" \
    -H "Content-Type: application/json" \
    -d '{"before_turn_id":"nonexistent-turn"}')
FORK_BAD_CODE=$(echo "$FORK_BAD" | tail -1)
FORK_BAD_BODY=$(echo "$FORK_BAD" | head -1)

if [ "$FORK_BAD_CODE" = "400" ]; then
    pass "fork-turn 不存在 turn → HTTP 400"
else
    fail "fork-turn 错误码错误" "expected=400, got=$FORK_BAD_CODE, body=$FORK_BAD_BODY"
fi

# ============================================================
# Test 7: 导出 JSONL
# ============================================================
section "Test 7: GET /export (JSONL 文本)"

EXPORT_RESP=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/export")
EXPORT_SUCCESS=$(echo "$EXPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
EXPORT_FORMAT=$(echo "$EXPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('format', ''))" 2>/dev/null)
EXPORT_COUNT=$(echo "$EXPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('item_count', 0))" 2>/dev/null)
EXPORT_CONTENT=$(echo "$EXPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('content', ''))" 2>/dev/null)
FIRST_LINE_TYPE=$(echo "$EXPORT_CONTENT" | head -1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('type', ''))" 2>/dev/null)

if [ "$EXPORT_SUCCESS" = "True" ] && [ "$EXPORT_FORMAT" = "jsonl" ] && [ "$EXPORT_COUNT" -ge 7 ]; then
    pass "export → format=$EXPORT_FORMAT, items=$EXPORT_COUNT, first_line_type=$FIRST_LINE_TYPE"
else
    fail "导出失败" "success=$EXPORT_SUCCESS, format=$EXPORT_FORMAT, count=$EXPORT_COUNT"
fi

# ============================================================
# Test 8: 导入 JSONL
# ============================================================
section "Test 8: POST /import"

IMPORTED_SID="imported-test-$RANDOM"
IMPORT_RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$IMPORTED_SID/import" \
    -H "Content-Type: application/json" \
    -d "{\"content\":$(echo "$EXPORT_CONTENT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}")
IMPORT_SUCCESS=$(echo "$IMPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
IMPORT_COUNT=$(echo "$IMPORT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('items_imported', 0))" 2>/dev/null)

if [ "$IMPORT_SUCCESS" = "True" ] && [ "$IMPORT_COUNT" = "$EXPORT_COUNT" ]; then
    pass "import → items_imported=$IMPORT_COUNT (与导出数量一致)"
else
    fail "导入失败" "success=$IMPORT_SUCCESS, imported=$IMPORT_COUNT, expected=$EXPORT_COUNT"
fi

# ============================================================
# Test 9: 导入验证
# ============================================================
section "Test 9: 导入后查询验证"

VERIFY=$(curl -s "$BASE_URL/api/sessions/$IMPORTED_SID/rollout?limit=500&offset=0")
VERIFY_TOTAL=$(echo "$VERIFY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total_items', 0))" 2>/dev/null)

if [ "$VERIFY_TOTAL" = "$EXPORT_COUNT" ]; then
    pass "导入后分页查询 total=$VERIFY_TOTAL (一致)"
else
    fail "导入后查询失败" "expected=$EXPORT_COUNT, got=$VERIFY_TOTAL"
fi

# ============================================================
# Test 10: rollout/info 状态信息
# ============================================================
section "Test 10: GET /rollout/info"

INFO_RESP=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/rollout/info")
INFO_EXISTS=$(echo "$INFO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('exists', False))" 2>/dev/null)
INFO_ITEM_COUNT=$(echo "$INFO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('item_count', 0))" 2>/dev/null)
INFO_TURN_COUNT=$(echo "$INFO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_count', 0))" 2>/dev/null)
INFO_HAS_TURNS=$(echo "$INFO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('turn_context' in d.get('type_counts', {}))" 2>/dev/null)

if [ "$INFO_EXISTS" = "True" ] && [ "$INFO_ITEM_COUNT" -ge 7 ] && [ "$INFO_TURN_COUNT" -eq 3 ] && [ "$INFO_HAS_TURNS" = "True" ]; then
    pass "info → exists=$INFO_EXISTS, items=$INFO_ITEM_COUNT, turns=$INFO_TURN_COUNT, has_turn_context=$INFO_HAS_TURNS"
else
    fail "info 失败" "$INFO_RESP"
fi

# ============================================================
# Test 11: turn 上下文查询
# ============================================================
section "Test 11: GET /rollout/turn/{turn_id}"

TURN_CTX=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/rollout/turn/$TURN2_ID?context_before=2&context_after=2")
CTX_SUCCESS=$(echo "$TURN_CTX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
CTX_ITEMS=$(echo "$TURN_CTX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('items', [])))" 2>/dev/null)
CTX_TURN_ID=$(echo "$TURN_CTX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn_id', ''))" 2>/dev/null)

if [ "$CTX_SUCCESS" = "True" ] && [ "$CTX_TURN_ID" = "$TURN2_ID" ]; then
    pass "turn context → items=$CTX_ITEMS, turn_id 一致"
else
    fail "turn context 失败" "$TURN_CTX"
fi

# ============================================================
# Test 12: 分页参数验证
# ============================================================
section "Test 12: 分页参数边界"

# limit > 500
BAD_LIMIT=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/sessions/$SESSION_ID/rollout?limit=501&offset=0")
BAD_LIMIT_CODE=$(echo "$BAD_LIMIT" | tail -1)
if [ "$BAD_LIMIT_CODE" = "422" ] || [ "$BAD_LIMIT_CODE" = "400" ]; then
    pass "limit=501 → HTTP $BAD_LIMIT_CODE (参数验证)"
else
    fail "limit 验证错误" "expected 422/400, got $BAD_LIMIT_CODE"
fi

# offset < 0
BAD_OFFSET=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/sessions/$SESSION_ID/rollout?limit=10&offset=-1")
BAD_OFFSET_CODE=$(echo "$BAD_OFFSET" | tail -1)
if [ "$BAD_OFFSET_CODE" = "422" ] || [ "$BAD_OFFSET_CODE" = "400" ]; then
    pass "offset=-1 → HTTP $BAD_OFFSET_CODE (参数验证)"
else
    fail "offset 验证错误" "expected 422/400, got $BAD_OFFSET_CODE"
fi

# ============================================================
# Test 13: 压缩导出
# ============================================================
section "Test 13: GET /export?compressed=true"

EXPORT_COMP=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/export?compressed=true")
COMP_FORMAT=$(echo "$EXPORT_COMP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('format', ''))" 2>/dev/null)
COMP_CONTENT=$(echo "$EXPORT_COMP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('content', ''))" 2>/dev/null)
COMP_LEN=${#COMP_CONTENT}

if [ "$COMP_FORMAT" = "jsonl.zst.base64" ] && [ "$COMP_LEN" -gt 10 ]; then
    pass "export compressed → format=$COMP_FORMAT, content_length=$COMP_LEN"
else
    fail "压缩导出失败" "format=$COMP_FORMAT, length=$COMP_LEN"
fi

# ============================================================
# Test 14: DELETE rollout
# ============================================================
section "Test 14: DELETE /rollout"

DEL_RESP=$(curl -s -X DELETE "$BASE_URL/api/sessions/$SESSION_ID/rollout")
DEL_SUCCESS=$(echo "$DEL_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
DEL_DELETED=$(echo "$DEL_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('deleted', False))" 2>/dev/null)

if [ "$DEL_SUCCESS" = "True" ] && [ "$DEL_DELETED" = "True" ]; then
    pass "DELETE rollout → deleted=$DEL_DELETED"
else
    fail "DELETE 失败" "$DEL_RESP"
fi

# 验证删除后查询
AFTER_DEL=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/rollout/info")
AFTER_EXISTS=$(echo "$AFTER_DEL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('exists', True))" 2>/dev/null)

if [ "$AFTER_EXISTS" = "False" ]; then
    pass "删除后 GET info → exists=false (确认删除)"
else
    fail "删除后状态异常" "$AFTER_DEL"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo "============================================================"
echo "测试结果: $PASSED 通过 / $FAILED 失败"
echo "============================================================"

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}🎉 全部 E2E 测试通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ 有 $FAILED 个测试失败${NC}"
    exit 1
fi
