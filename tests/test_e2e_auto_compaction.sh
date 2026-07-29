#!/usr/bin/env bash
# ============================================================
# Auto-Compaction 引擎 E2E 测试
# ============================================================
# 覆盖范围（22 端点）：
#   - 健康检查 + 统计
#   - 引擎控制（check/run/plan/verify/rollback）
#   - 分层管理（tier/hot/cold/incremental/search）
#   - 配置（config GET/PUT, session-config GET/PUT）
#   - 流水线（analyze/summarize/verify 单阶段）
#   - 会话历史与节省
# ============================================================

set -e

BASE="http://localhost:8000/api/auto-compaction"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

assert_contains() {
    local desc="$1"
    local haystack="$2"
    local needle="$3"
    TOTAL=$((TOTAL+1))
    if echo "$haystack" | grep -q -- "$needle"; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc (expected '$needle' in response)"
    fi
}

assert_not_contains() {
    local desc="$1"
    local haystack="$2"
    local needle="$3"
    TOTAL=$((TOTAL+1))
    if ! echo "$haystack" | grep -q -- "$needle"; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc (unexpected '$needle')"
    fi
}

assert_equals() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    TOTAL=$((TOTAL+1))
    if [ "$actual" = "$expected" ]; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc (expected '$expected', got '$actual')"
    fi
}

# ============================================================
# Test 1: 健康检查 + 统计
# ============================================================
echo ""
echo "=== Test 1: Health & Stats ==="
RESP=$(curl -s -m 5 "$BASE/health")
assert_contains "health ok" "$RESP" '"status":"ok"'
assert_contains "version" "$RESP" '"v6.30.0"'
assert_contains "detector module" "$RESP" '"detector":"ok"'
assert_contains "analyzer module" "$RESP" '"analyzer":"ok"'
assert_contains "slicer module" "$RESP" '"slicer":"ok"'
assert_contains "summarizer module" "$RESP" '"summarizer":"ok"'
assert_contains "merger module" "$RESP" '"merger":"ok"'
assert_contains "verifier module" "$RESP" '"verifier":"ok"'
assert_contains "pipeline module" "$RESP" '"pipeline":"ok"'
assert_contains "tiers module" "$RESP" '"tiers":"ok"'

RESP=$(curl -s -m 5 "$BASE/stats")
assert_contains "stats total_compactions" "$RESP" '"total_compactions"'
assert_contains "stats verification" "$RESP" '"verification"'
assert_contains "stats strategy_distribution" "$RESP" '"strategy_distribution"'
assert_contains "stats tiers" "$RESP" '"tiers"'

# ============================================================
# Test 2: 配置管理
# ============================================================
echo ""
echo "=== Test 2: Config ==="
RESP=$(curl -s -m 5 "$BASE/config")
assert_contains "config enabled" "$RESP" '"enabled":true'
assert_contains "config max_tokens" "$RESP" '"max_tokens":50000'

# 更新配置
curl -s -m 5 -X PUT "$BASE/config" \
    -H "Content-Type: application/json" \
    -d '{"max_tokens": 60000, "keep_recent": 15}' > /dev/null

RESP=$(curl -s -m 5 "$BASE/config")
assert_contains "config updated max_tokens" "$RESP" '"max_tokens":60000'
assert_contains "config updated keep_recent" "$RESP" '"keep_recent":15'

# 恢复
curl -s -m 5 -X PUT "$BASE/config" \
    -H "Content-Type: application/json" \
    -d '{"max_tokens": 50000, "keep_recent": 10}' > /dev/null

# ============================================================
# Test 3: Check（自动检测）
# ============================================================
echo ""
echo "=== Test 3: Check ==="
# 构造消息
MSGS='{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"I always use Python. We must use TypeScript for frontend."},{"role":"assistant","content":"```python\\ndef add(a,b): return a+b\\n```"}'

for i in $(seq 1 30); do
    MSGS="$MSGS,{\"role\":\"user\",\"content\":\"msg $i about topic $i with some text content to increase tokens\"}"
done
MSGS_JSON="[$MSGS]"

# 3.1 check with low max_tokens → should trigger
RESP=$(curl -s -m 5 -X POST "$BASE/check?session_id=e2e_s1" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"config\": {\"max_tokens\": 500, \"max_messages\": 1000}}")
assert_contains "check needs_compaction" "$RESP" '"needs_compaction":true'
assert_contains "check reason" "$RESP" '"reason"'
assert_contains "check current_tokens" "$RESP" '"current_tokens"'
assert_contains "check severity" "$RESP" '"severity"'
assert_contains "check recommended_strategy" "$RESP" '"recommended_strategy"'

# 3.2 check with high max_tokens → should not trigger
RESP=$(curl -s -m 5 -X POST "$BASE/check?session_id=e2e_s2" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON}")
# with default max_tokens=50000, this shouldn't trigger
# (we have ~30 messages, way under 50)

# ============================================================
# Test 4: Plan（生成压缩计划）
# ============================================================
echo ""
echo "=== Test 4: Plan ==="
RESP=$(curl -s -m 5 -X POST "$BASE/plan?session_id=e2e_s3" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON}")
assert_contains "plan plan_id" "$RESP" '"plan_id"'
assert_contains "plan strategy" "$RESP" '"strategy"'
assert_contains "plan blocks_to_compact" "$RESP" '"blocks_to_compact"'
assert_contains "plan messages_to_keep" "$RESP" '"messages_to_keep"'
assert_contains "plan estimated_before" "$RESP" '"estimated_before_tokens"'
assert_contains "plan estimated_after" "$RESP" '"estimated_after_tokens"'
assert_contains "plan confidence" "$RESP" '"confidence"'

# ============================================================
# Test 5: Run（执行压缩）
# ============================================================
echo ""
echo "=== Test 5: Run ==="
RESP=$(curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_run1" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"force\": true}")
assert_contains "run success" "$RESP" '"success":true'
assert_contains "run before_tokens" "$RESP" '"before_tokens"'
assert_contains "run after_tokens" "$RESP" '"after_tokens"'
assert_contains "run saved_tokens" "$RESP" '"saved_tokens"'
assert_contains "run blocks" "$RESP" '"block_count"'
assert_contains "run verification" "$RESP" '"verification"'
assert_contains "run stages" "$RESP" '"stages"'
assert_contains "run rollback_available" "$RESP" '"rollback_available"'

# 提取 saved_tokens 数字
SAVED=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['saved_tokens'])" 2>/dev/null || echo "0")
echo "  - saved tokens: $SAVED"

# ============================================================
# Test 6: Run with strategy
# ============================================================
echo ""
echo "=== Test 6: Run with strategy ==="
RESP=$(curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_run2" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"strategy\": \"truncate\", \"force\": true}")
assert_contains "run truncate strategy" "$RESP" '"strategy":"truncate"'
assert_contains "run truncate success" "$RESP" '"success":true'

RESP=$(curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_run3" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"strategy\": \"summarize\", \"force\": true}")
assert_contains "run summarize strategy" "$RESP" '"strategy":"summarize"'

# ============================================================
# Test 7: Get Tier
# ============================================================
echo ""
echo "=== Test 7: Get Tier ==="
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_run1/tier")
assert_contains "tier session_id" "$RESP" '"session_id":"e2e_s_run1"'
assert_contains "tier hot_count" "$RESP" '"hot_count"'
assert_contains "tier cold_count" "$RESP" '"cold_count"'
assert_contains "tier total_tokens" "$RESP" '"total_tokens"'

# ============================================================
# Test 8: Get Hot
# ============================================================
echo ""
echo "=== Test 8: Get Hot ==="
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_run1/hot")
assert_contains "hot session_id" "$RESP" '"session_id":"e2e_s_run1"'
assert_contains "hot count" "$RESP" '"count"'
assert_contains "hot messages" "$RESP" '"messages"'

# ============================================================
# Test 9: Get Cold
# ============================================================
echo ""
echo "=== Test 9: Get Cold ==="
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_run1/cold")
assert_contains "cold session_id" "$RESP" '"session_id":"e2e_s_run1"'
assert_contains "cold count" "$RESP" '"count"'
assert_contains "cold blocks" "$RESP" '"blocks"'
assert_contains "cold indexed_keywords" "$RESP" '"indexed_keywords"'

# ============================================================
# Test 10: Search
# ============================================================
echo ""
echo "=== Test 10: Search ==="
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_run1/search?query=python")
assert_contains "search session_id" "$RESP" '"session_id":"e2e_s_run1"'
assert_contains "search query" "$RESP" '"query":"python"'
assert_contains "search count" "$RESP" '"count"'
assert_contains "search blocks" "$RESP" '"blocks"'

# ============================================================
# Test 11: Incremental
# ============================================================
echo ""
echo "=== Test 11: Incremental ==="
NEW_MSG='{"role":"user","content":"Another important decision: we must use Python for backend."}'
NEW_MSG_JSON="[$NEW_MSG]"
RESP=$(curl -s -m 10 -X POST "$BASE/sessions/e2e_s_inc/incremental" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON}")
assert_contains "incremental success" "$RESP" '"success":true'
assert_contains "incremental is_incremental" "$RESP" '"is_incremental":true'

# 第二次增量
RESP=$(curl -s -m 10 -X POST "$BASE/sessions/e2e_s_inc/incremental" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $NEW_MSG_JSON}")
assert_contains "incremental 2 success" "$RESP" '"success":true'

# ============================================================
# Test 12: Verify
# ============================================================
echo ""
echo "=== Test 12: Verify ==="
RESP=$(curl -s -m 5 -X POST "$BASE/verify?session_id=e2e_s_run1")
assert_contains "verify passed" "$RESP" '"passed"'
assert_contains "verify score" "$RESP" '"score"'
assert_contains "verify checks" "$RESP" '"checks"'

# ============================================================
# Test 13: Rollback
# ============================================================
echo ""
echo "=== Test 13: Rollback ==="
RESP=$(curl -s -m 5 -X POST "$BASE/rollback?session_id=e2e_s_run1")
assert_contains "rollback success" "$RESP" '"success":true'
assert_contains "rollback session_id" "$RESP" '"session_id":"e2e_s_run1"'

# 验证 cold tier 已清空
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_run1/cold")
assert_contains "rollback cold cleared" "$RESP" '"count":0'

# ============================================================
# Test 14: Pipeline single stage
# ============================================================
echo ""
echo "=== Test 14: Pipeline single stages ==="
RESP=$(curl -s -m 5 -X POST "$BASE/pipeline/analyze?session_id=e2e_s_pipe" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON}")
assert_contains "pipeline analyze count" "$RESP" '"count"'
assert_contains "pipeline analyze items" "$RESP" '"items"'

# 14.2 summarize
RESP=$(curl -s -m 5 -X POST "$BASE/pipeline/summarize?session_id=e2e_s_pipe" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"indices\": [1, 2, 3]}")
assert_contains "pipeline summarize summary" "$RESP" '"summary"'
assert_contains "pipeline summarize block_id" "$RESP" '"block_id"'

# 14.3 verify
RESP=$(curl -s -m 5 -X POST "$BASE/pipeline/verify?session_id=e2e_s_pipe" \
    -H "Content-Type: application/json" \
    -d "{\"original_messages\": $MSGS_JSON, \"blocks\": [{\"summary\":\"test summary\"}]}")
assert_contains "pipeline verify passed" "$RESP" '"passed"'

# ============================================================
# Test 15: Session config
# ============================================================
echo ""
echo "=== Test 15: Session Config ==="
curl -s -m 5 -X PUT "$BASE/sessions/e2e_session_cfg/config" \
    -H "Content-Type: application/json" \
    -d '{"max_tokens": 30000, "keep_recent": 20}' > /dev/null

RESP=$(curl -s -m 5 "$BASE/sessions/e2e_session_cfg/config")
assert_contains "session config max_tokens" "$RESP" '"max_tokens":30000'
assert_contains "session config keep_recent" "$RESP" '"keep_recent":20'

# ============================================================
# Test 16: Session history & savings
# ============================================================
echo ""
echo "=== Test 16: History & Savings ==="
# 先运行一次压缩
curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_history" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"force\": true}" > /dev/null

RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_history/history")
assert_contains "history session_id" "$RESP" '"session_id":"e2e_s_history"'
assert_contains "history count" "$RESP" '"count"'
assert_contains "history items" "$RESP" '"history"'

RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_history/savings")
assert_contains "savings session_id" "$RESP" '"session_id":"e2e_s_history"'
assert_contains "savings total_saved" "$RESP" '"total_saved"'
assert_contains "savings compaction_count" "$RESP" '"compaction_count"'

# ============================================================
# Test 17: Delete session
# ============================================================
echo ""
echo "=== Test 17: Delete session ==="
curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_delete" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $MSGS_JSON, \"force\": true}" > /dev/null

RESP=$(curl -s -m 5 -X DELETE "$BASE/sessions/e2e_s_delete")
assert_contains "delete session success" "$RESP" '"success":true'
assert_contains "delete session id" "$RESP" '"session_id":"e2e_s_delete"'

# 删除后再查询（get_or_create 会自动创建，但 cold 应该为空）
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_delete/cold")
assert_contains "delete then cold empty" "$RESP" '"count":0'

# ============================================================
# Test 18: Rollback on non-existent (returns 200 with success=false)
# ============================================================
echo ""
echo "=== Test 18: Edge cases ==="
RESP=$(curl -s -m 5 -X POST "$BASE/rollback?session_id=nonexistent_session_xyz")
assert_contains "rollback nonexistent" "$RESP" '"success":false'

# ============================================================
# Test 19: 增量模式 checkpoint
# ============================================================
echo ""
echo "=== Test 19: Incremental checkpoint ==="
# 第一次大消息
LARGE_MSG=""
for i in $(seq 1 30); do
    if [ $i -gt 1 ]; then LARGE_MSG="$LARGE_MSG,"; fi
    LARGE_MSG="$LARGE_MSG{\"role\":\"user\",\"content\":\"msg $i content\"}"
done
LARGE_MSG="[$LARGE_MSG]"

# 第一次全量
curl -s -m 10 -X POST "$BASE/run?session_id=e2e_s_check" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": $LARGE_MSG, \"force\": true}" > /dev/null

# 检查 checkpoint
RESP=$(curl -s -m 5 "$BASE/sessions/e2e_s_check/tier")
assert_contains "checkpoint exists" "$RESP" '"checkpoint"'

# ============================================================
# 总结
# ============================================================
echo ""
echo "============================================"
echo -e "Total: $TOTAL  |  ${GREEN}Passed: $PASS${NC}  |  ${RED}Failed: $FAIL${NC}"
echo "============================================"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
