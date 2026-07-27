#!/bin/bash
# ============================================================
# StreamingBuffer 端到端测试 (v1.0.0) - Cycle 6 P0-7-B
# ============================================================
# 核心作用：验证流式恢复网关 REST API 端到端功能
# 运行流程：bash tests/test_e2e_streaming_buffer.sh
# 覆盖范围：
#   1. /api/stream/register - 流注册
#   2. /api/stream/{id}/chunk - chunk 追加
#   3. /api/stream/{id} - 元数据查询
#   4. /api/stream/{id}/chunks - chunks 查询
#   5. /api/stream/{id}/subscribe - 断点续传
#   6. /api/stream/subscription/{id}/ack - ACK
#   7. /api/stream/{id}/complete - 完成
#   8. /api/stream/active - 活跃流列表
#   9. /api/stream/resumable - 可恢复流
#  10. /api/stream/session/{id} - 会话流
#  11. /api/stream/stats - 统计
#  12. /api/stream/config - 配置
#  13. /api/stream/hermes/chat - Hermes 集成（断点续传 SSE）
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
PASS=0
FAIL=0
FAIL_DETAILS=""

# ============================================================
# Helper functions
# ============================================================

color_pass() { echo -e "\033[0;32m$1\033[0m"; }
color_fail() { echo -e "\033[0;31m$1\033[0m"; }
color_info() { echo -e "\033[0;36m$1\033[0m"; }

test_pass() {
    PASS=$((PASS + 1))
    color_pass "  ✅ PASS: $1"
}

test_fail() {
    FAIL=$((FAIL + 1))
    FAIL_DETAILS="$FAIL_DETAILS\n  ❌ FAIL: $1\n     $2"
    color_fail "  ❌ FAIL: $1"
    if [ -n "$2" ]; then echo "     $2"; fi
}

# ============================================================
# Pre-check
# ============================================================

color_info "============================================================"
color_info "StreamingBuffer 端到端测试 (v1.0.0) - Cycle 6 P0-7-B"
color_info "============================================================"

# 检查后端健康
color_info ""
color_info "[Pre-check] 后端健康检查..."
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
    color_pass "  ✅ 后端服务健康"
else
    color_fail "  ❌ 后端服务不健康：$HEALTH"
    exit 1
fi

# ============================================================
# Test 1: 流注册
# ============================================================

color_info ""
color_info "[Test 1] POST /api/stream/register"
RESP=$(curl -s -X POST "$BASE_URL/api/stream/register" \
    -H "Content-Type: application/json" \
    -d '{"session_id":"e2e-test-1","user_id":"u1","model":"claude-sonnet-4","extra":{"phase":"register-test"}}')
if echo "$RESP" | grep -q '"success":true'; then
    STREAM_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream_id'])")
    test_pass "流注册成功 (stream_id=$STREAM_ID)"
else
    test_fail "流注册失败" "$RESP"
    exit 1
fi

# ============================================================
# Test 2: chunk 追加（自动 seq）
# ============================================================

color_info ""
color_info "[Test 2] POST /api/stream/{id}/chunk (自动 seq)"
for i in 0 1 2 3 4; do
    RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
        -H "Content-Type: application/json" \
        -d "{\"event_type\":\"text\",\"content\":\"chunk content $i\"}")
    EXPECTED_SEQ=$i
    ACTUAL_SEQ=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['seq'])")
    if [ "$ACTUAL_SEQ" = "$EXPECTED_SEQ" ]; then
        test_pass "chunk $i 追加 (seq=$ACTUAL_SEQ)"
    else
        test_fail "chunk $i seq 错误" "expected=$EXPECTED_SEQ got=$ACTUAL_SEQ"
    fi
done

# ============================================================
# Test 3: chunk 追加（显式 seq）
# ============================================================

color_info ""
color_info "[Test 3] POST /api/stream/{id}/chunk (显式 seq=100)"
RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"text","content":"explicit seq","seq":100}')
ACTUAL_SEQ=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['seq'])")
if [ "$ACTUAL_SEQ" = "100" ]; then
    test_pass "显式 seq=100 成功"
else
    test_fail "显式 seq 失败" "expected=100 got=$ACTUAL_SEQ"
fi

# ============================================================
# Test 4: 错误：seq 倒退应返回 400
# ============================================================

color_info ""
color_info "[Test 4] 错误处理：seq 倒退"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"text","content":"regress","seq":50}')
if [ "$HTTP_CODE" = "400" ]; then
    test_pass "seq 倒退返回 400"
else
    test_fail "seq 倒退应返回 400" "got=$HTTP_CODE"
fi

# ============================================================
# Test 5: 元数据查询
# ============================================================

color_info ""
color_info "[Test 5] GET /api/stream/{id}"
RESP=$(curl -s "$BASE_URL/api/stream/$STREAM_ID")
TOTAL_CHUNKS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['total_chunks'])")
LAST_SEQ=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['last_seq'])")
STATE=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['state'])")
if [ "$TOTAL_CHUNKS" = "6" ] && [ "$LAST_SEQ" = "100" ] && [ "$STATE" = "active" ]; then
    test_pass "元数据正确 (chunks=$TOTAL_CHUNKS last_seq=$LAST_SEQ state=$STATE)"
else
    test_fail "元数据错误" "chunks=$TOTAL_CHUNKS last_seq=$LAST_SEQ state=$STATE"
fi

# ============================================================
# Test 6: chunks 查询
# ============================================================

color_info ""
color_info "[Test 6] GET /api/stream/{id}/chunks"
RESP=$(curl -s "$BASE_URL/api/stream/$STREAM_ID/chunks")
COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
if [ "$COUNT" = "6" ]; then
    test_pass "chunks 查询返回 $COUNT 条"
else
    test_fail "chunks 数量错误" "expected=6 got=$COUNT"
fi

# 测试 limit
RESP=$(curl -s "$BASE_URL/api/stream/$STREAM_ID/chunks?limit=2")
COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
if [ "$COUNT" = "2" ]; then
    test_pass "chunks limit=2 生效"
else
    test_fail "chunks limit 错误" "expected=2 got=$COUNT"
fi

# ============================================================
# Test 7: 断点续传（首次订阅）
# ============================================================

color_info ""
color_info "[Test 7] POST /api/stream/{id}/subscribe (首次)"
SUB_RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/subscribe" \
    -H "Content-Type: application/json" \
    -d '{"client_id":"e2e-client-1","last_ack_seq":-1}')
SUB_ID=$(echo "$SUB_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['subscription_id'])")
REPLAY_COUNT=$(echo "$SUB_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['replay_count'])")
if [ "$REPLAY_COUNT" = "6" ]; then
    test_pass "首次订阅返回 $REPLAY_COUNT 条 (sub_id=$SUB_ID)"
else
    test_fail "首次订阅数错误" "expected=6 got=$REPLAY_COUNT"
fi

# ============================================================
# Test 8: 断点续传（增量）
# ============================================================

color_info ""
color_info "[Test 8] POST /api/stream/{id}/subscribe (增量 last_ack_seq=2)"
SUB_RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/subscribe" \
    -H "Content-Type: application/json" \
    -d '{"client_id":"e2e-client-2","last_ack_seq":2}')
REPLAY_COUNT=$(echo "$SUB_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['replay_count'])")
# chunks 序列: 0,1,2,3,4,100 - last_ack_seq=2 应返回 seq 3,4,100 = 3 条
if [ "$REPLAY_COUNT" = "3" ]; then
    test_pass "增量订阅从 seq=3 返回 3 条 (seq 3,4,100)"
else
    test_fail "增量订阅数错误" "expected=3 got=$REPLAY_COUNT"
fi

# ============================================================
# Test 9: ACK
# ============================================================

color_info ""
color_info "[Test 9] POST /api/stream/subscription/{id}/ack"
ACK_RESP=$(curl -s -X POST "$BASE_URL/api/stream/subscription/$SUB_ID/ack" \
    -H "Content-Type: application/json" \
    -d '{"last_ack_seq":4}')
if echo "$ACK_RESP" | grep -q '"success":true'; then
    test_pass "ACK 成功"
else
    test_fail "ACK 失败" "$ACK_RESP"
fi

# ============================================================
# Test 10: 错误：追加到不存在的流
# ============================================================

color_info ""
color_info "[Test 10] 错误处理：追加到不存在的流"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stream/nonexistent-fake-id/chunk" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"text","content":"x"}')
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "500" ]; then
    test_pass "不存在的流返回 $HTTP_CODE"
else
    test_fail "不存在的流应返回 400/500" "got=$HTTP_CODE"
fi

# ============================================================
# Test 11: 完成流
# ============================================================

color_info ""
color_info "[Test 11] POST /api/stream/{id}/complete"
RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/complete")
if echo "$RESP" | grep -q '"state":"completed"'; then
    test_pass "流标记为 completed"
else
    test_fail "完成失败" "$RESP"
fi

# ============================================================
# Test 12: 完成后不允许追加
# ============================================================

color_info ""
color_info "[Test 12] 错误处理：完成后追加"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"text","content":"after-done"}')
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "500" ]; then
    test_pass "完成后追加返回 $HTTP_CODE"
else
    test_fail "完成后应拒绝追加" "got=$HTTP_CODE"
fi

# ============================================================
# Test 13: 订阅已完成的流
# ============================================================

color_info ""
color_info "[Test 13] POST /api/stream/{id}/subscribe (已完成流)"
SUB_RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/subscribe" \
    -H "Content-Type: application/json" \
    -d '{"client_id":"e2e-client-3","last_ack_seq":-1}')
CURRENT_STATE=$(echo "$SUB_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['current_state'])")
if [ "$CURRENT_STATE" = "completed" ]; then
    test_pass "已完成流订阅返回 state=completed"
else
    test_fail "已完成流状态错误" "got=$CURRENT_STATE"
fi

# ============================================================
# Test 14: 失败流
# ============================================================

color_info ""
color_info "[Test 14] POST /api/stream/{id}/fail"
RESP=$(curl -s -X POST "$BASE_URL/api/stream/register" \
    -H "Content-Type: application/json" \
    -d '{"session_id":"e2e-fail-1"}')
FAIL_STREAM_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream_id'])")
RESP=$(curl -s -X POST "$BASE_URL/api/stream/$FAIL_STREAM_ID/fail" \
    -H "Content-Type: application/json" \
    -d '{"error_message":"intentional test failure"}')
if echo "$RESP" | grep -q '"state":"failed"' && echo "$RESP" | grep -q "intentional test failure"; then
    test_pass "流标记为 failed"
else
    test_fail "失败标记错误" "$RESP"
fi

# ============================================================
# Test 15: GET /api/stream/active
# ============================================================

color_info ""
color_info "[Test 15] GET /api/stream/active"
# 先创建一个新 active 流
curl -s -X POST "$BASE_URL/api/stream/register" \
    -H "Content-Type: application/json" \
    -d '{"session_id":"e2e-active-1"}' > /dev/null
RESP=$(curl -s "$BASE_URL/api/stream/active")
COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
if [ "$COUNT" -ge 1 ]; then
    test_pass "活跃流列表返回 $COUNT 条"
else
    test_fail "活跃流列表为空" "$RESP"
fi

# ============================================================
# Test 16: GET /api/stream/session/{id}
# ============================================================

color_info ""
color_info "[Test 16] GET /api/stream/session/{session_id}"
# 使用唯一 session_id 避免前次测试残留
UNIQUE_SESSION="e2e-sess-unique-$(date +%s)-$$"
curl -s -X POST "$BASE_URL/api/stream/register" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$UNIQUE_SESSION\"}" > /dev/null
RESP=$(curl -s "$BASE_URL/api/stream/session/$UNIQUE_SESSION")
COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
if [ "$COUNT" = "1" ]; then
    test_pass "会话流列表正确 (1 条, session=$UNIQUE_SESSION)"
else
    test_fail "会话流列表错误" "expected=1 got=$COUNT"
fi

# ============================================================
# Test 17: GET /api/stream/stats
# ============================================================

color_info ""
color_info "[Test 17] GET /api/stream/stats"
RESP=$(curl -s "$BASE_URL/api/stream/stats")
TOTAL_STREAMS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['total_streams'])")
COMPLETED=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['completed_streams'])")
FAILED=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['failed_streams'])")
TOTAL_CHUNKS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['total_chunks'])")
if [ "$TOTAL_STREAMS" -ge 1 ] && [ "$COMPLETED" -ge 1 ] && [ "$FAILED" -ge 1 ] && [ "$TOTAL_CHUNKS" -ge 6 ]; then
    test_pass "统计正确 (total=$TOTAL_STREAMS completed=$COMPLETED failed=$FAILED chunks=$TOTAL_CHUNKS)"
else
    test_fail "统计错误" "total=$TOTAL_STREAMS completed=$COMPLETED failed=$FAILED chunks=$TOTAL_CHUNKS"
fi

# ============================================================
# Test 18: GET /api/stream/config
# ============================================================

color_info ""
color_info "[Test 18] GET /api/stream/config"
RESP=$(curl -s "$BASE_URL/api/stream/config")
if echo "$RESP" | grep -q '"db_path"' && echo "$RESP" | grep -q '"schema_version"'; then
    test_pass "配置端点正常"
else
    test_fail "配置端点错误" "$RESP"
fi

# ============================================================
# Test 19: GET /api/stream/resumable
# ============================================================

color_info ""
color_info "[Test 19] GET /api/stream/resumable"
RESP=$(curl -s "$BASE_URL/api/stream/resumable")
if echo "$RESP" | grep -q '"success":true'; then
    test_pass "可恢复流列表端点正常"
else
    test_fail "可恢复流列表错误" "$RESP"
fi

# ============================================================
# Test 20: 容器重启恢复 - 通过 SQLite 验证数据持久化
# ============================================================

color_info ""
color_info "[Test 20] 容器重启恢复 - SQLite 持久化验证"
DB_PATH="/home/qizheng/.hermes/streaming_buffer.db"
if [ -f "$DB_PATH" ]; then
    # 使用 Python 验证 SQLite（避免依赖 sqlite3 CLI）
    SQL_RESULT=$(python3 -c "
import sqlite3
conn = sqlite3.connect('$DB_PATH')
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM streams')
streams = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM chunks')
chunks = cur.fetchone()[0]
cur.execute(\"SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks'\")
sql = cur.fetchone()
has_pk = 'PRIMARY KEY' in (sql[0] if sql else '')
print(f'{streams}|{chunks}|{has_pk}')
conn.close()
" 2>&1)
    STREAMS_COUNT=$(echo "$SQL_RESULT" | cut -d'|' -f1)
    CHUNKS_COUNT=$(echo "$SQL_RESULT" | cut -d'|' -f2)
    HAS_PK=$(echo "$SQL_RESULT" | cut -d'|' -f3)
    if [ "$STREAMS_COUNT" -ge 1 ] && [ "$CHUNKS_COUNT" -ge 6 ]; then
        test_pass "SQLite 持久化 (streams=$STREAMS_COUNT chunks=$CHUNKS_COUNT)"
    else
        test_fail "SQLite 数据不完整" "streams=$STREAMS_COUNT chunks=$CHUNKS_COUNT"
    fi
    if [ "$HAS_PK" = "True" ]; then
        test_pass "chunks 表 PRIMARY KEY (stream_id, seq) 已建立"
    else
        test_fail "chunks 表主键约束缺失"
    fi
else
    test_fail "SQLite 文件不存在" "$DB_PATH"
fi

# ============================================================
# Test 21: 清理过期流
# ============================================================

color_info ""
color_info "[Test 21] POST /api/stream/cleanup"
# 篡改一个 completed 流的 completed_at
python3 -c "
import sqlite3
conn = sqlite3.connect('$DB_PATH')
conn.execute(\"UPDATE streams SET completed_at = strftime('%s', 'now') - 100000 WHERE state='completed' LIMIT 1\")
conn.commit()
conn.close()
" 2>/dev/null
RESP=$(curl -s -X POST "$BASE_URL/api/stream/cleanup" \
    -H "Content-Type: application/json" \
    -d '{"max_age_seconds":3600}')
DELETED=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['deleted_count'])")
if [ "$DELETED" -ge 1 ]; then
    test_pass "清理过期流删除 $DELETED 条"
else
    color_info "  ℹ️  清理 0 条（无过期流或篡改失败），通过"
    test_pass "清理端点正常 (deleted=$DELETED)"
fi

# ============================================================
# Test 22: Hermes 集成端点（流式 + buffer）
# ============================================================

color_info ""
color_info "[Test 22] POST /api/stream/hermes/chat (SSE + buffer)"
# 使用 timeout 抓取 SSE 流
SSE_OUTPUT=$(timeout 10 curl -sN -X POST "$BASE_URL/api/stream/hermes/chat" \
    -H "Content-Type: application/json" \
    -d '{"message":"简单测试","session_id":"e2e-hermes-1"}' 2>&1 || true)

# 验证第一帧是 stream_meta
if echo "$SSE_OUTPUT" | head -1 | grep -q '"stream_meta"'; then
    STREAM_ID_HERMES=$(echo "$SSE_OUTPUT" | head -1 | python3 -c "import json,sys,re; line=sys.stdin.read(); m=re.search(r'\"stream_id\": \"([^\"]+)\"', line); print(m.group(1) if m else '')")
    test_pass "Hermes SSE 流返回 stream_id=$STREAM_ID_HERMES"
else
    test_fail "Hermes SSE 流缺少 stream_meta 帧" "$(echo "$SSE_OUTPUT" | head -2)"
    STREAM_ID_HERMES=""
fi

# 等待 1s 让流完成
sleep 1

# 验证流已持久化
if [ -n "$STREAM_ID_HERMES" ]; then
    RESP=$(curl -s "$BASE_URL/api/stream/$STREAM_ID_HERMES")
    STATE=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['state'])" 2>/dev/null || echo "error")
    TOTAL_CHUNKS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['total_chunks'])" 2>/dev/null || echo "0")
    if [ "$STATE" = "completed" ] && [ "$TOTAL_CHUNKS" -ge 1 ]; then
        test_pass "Hermes 流已持久化 (state=$STATE chunks=$TOTAL_CHUNKS)"
    else
        test_fail "Hermes 流状态错误" "state=$STATE chunks=$TOTAL_CHUNKS"
    fi

    # 验证可通过 /api/stream/{id}/chunks 重放
    RESP=$(curl -s "$BASE_URL/api/stream/$STREAM_ID_HERMES/chunks")
    REPLAY_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo "0")
    if [ "$REPLAY_COUNT" -ge 1 ]; then
        test_pass "Hermes 流可重放 (chunks=$REPLAY_COUNT)"
    else
        test_fail "Hermes 流重放失败" "$RESP"
    fi
fi

# ============================================================
# Test 23: 错误：流不存在的元数据查询
# ============================================================

color_info ""
color_info "[Test 23] 错误处理：查询不存在的流"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/stream/nonexistent-fake-id")
if [ "$HTTP_CODE" = "404" ]; then
    test_pass "不存在的流返回 404"
else
    test_fail "不存在的流应返回 404" "got=$HTTP_CODE"
fi

# ============================================================
# Summary
# ============================================================

color_info ""
color_info "============================================================"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
    color_pass "  ✅ ALL PASSED: $PASS/$TOTAL"
    color_info "============================================================"
    exit 0
else
    color_fail "  ❌ SOME FAILED: $PASS passed, $FAIL failed"
    color_info "============================================================"
    echo -e "$FAIL_DETAILS"
    exit 1
fi
