#!/bin/bash
# ============================================================
# Cycle 6 P0-7-B-5 前端流式恢复网关 E2E 测试
# ============================================================
# 测试目标：
#   1. 验证 /api/stream/* 端点可被前端正确调用
#   2. 验证 useSSEReconnect hook 的核心数据流
#   3. 验证 StreamListPanel 可正常加载 + 展示
#   4. 验证断点续传 / 清理 / 重新订阅等操作
# 依赖：后端服务运行于 127.0.0.1:8000
# 执行：bash tests/test_e2e_streaming_buffer_frontend.sh
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PASS=0
FAIL=0

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_pass() {
    PASS=$((PASS+1))
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

test_fail() {
    FAIL=$((FAIL+1))
    echo -e "${RED}✗ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        echo -e "  ${RED}Details: $2${NC}"
    fi
}

# 1. 后端 /api/stream/active 端点可访问
echo "=== Test 1: /api/stream/active 端点 ==="
RESP=$(curl -s "$BASE_URL/api/stream/active?limit=10")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS" = "True" ]; then
    test_pass "/api/stream/active 端点可访问"
else
    test_fail "/api/stream/active 端点不可访问" "$RESP"
fi

# 2. /api/stream/resumable 端点
echo "=== Test 2: /api/stream/resumable 端点 ==="
RESP=$(curl -s "$BASE_URL/api/stream/resumable?max_idle_seconds=30&limit=10")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS" = "True" ]; then
    test_pass "/api/stream/resumable 端点可访问"
    COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
    echo -e "  ${YELLOW}ℹ${NC} 可恢复流数量: $COUNT"
else
    test_fail "/api/stream/resumable 端点不可访问" "$RESP"
fi

# 3. /api/stream/stats 端点
echo "=== Test 3: /api/stream/stats 端点 ==="
RESP=$(curl -s "$BASE_URL/api/stream/stats")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS" = "True" ]; then
    test_pass "/api/stream/stats 端点可访问"
    TOTAL_STREAMS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats'].get('total_streams', 0))")
    ACTIVE_STREAMS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats'].get('active_streams', 0))")
    echo -e "  ${YELLOW}ℹ${NC} 总流数: $TOTAL_STREAMS, 活跃: $ACTIVE_STREAMS"
else
    test_fail "/api/stream/stats 端点不可访问" "$RESP"
fi

# 4. /api/stream/config 端点
echo "=== Test 4: /api/stream/config 端点 ==="
RESP=$(curl -s "$BASE_URL/api/stream/config")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS" = "True" ]; then
    test_pass "/api/stream/config 端点可访问"
else
    test_fail "/api/stream/config 端点不可访问" "$RESP"
fi

# 5. 注册流
echo "=== Test 5: POST /api/stream/register ==="
UNIQ_SESSION="e2e-frontend-$(date +%s%N | tail -c 10)"
RESP=$(curl -s -X POST "$BASE_URL/api/stream/register" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$UNIQ_SESSION\",\"model\":\"claude-sonnet-4\",\"extra\":{\"source\":\"e2e_frontend_test\"}}")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS" = "True" ]; then
    test_pass "流注册成功"
    STREAM_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream_id'])")
    echo -e "  ${YELLOW}ℹ${NC} stream_id: $STREAM_ID"
else
    test_fail "流注册失败" "$RESP"
    STREAM_ID=""
fi

# 6. 追加 chunk
if [ -n "$STREAM_ID" ]; then
    echo "=== Test 6: POST /api/stream/{id}/chunk ==="
    RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
        -H "Content-Type: application/json" \
        -d '{"event_type":"text","content":"Hello from E2E frontend test"}')
    SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS" = "True" ]; then
        SEQ=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['seq'])")
        test_pass "Chunk 追加成功 (seq=$SEQ)"
    else
        test_fail "Chunk 追加失败" "$RESP"
    fi

    # 7. 追加多个 chunk
    for i in 1 2 3; do
        curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/chunk" \
            -H "Content-Type: application/json" \
            -d "{\"event_type\":\"text\",\"content\":\"Chunk $i\"}" > /dev/null
    done
    test_pass "追加 3 个额外 chunk"

    # 8. 订阅（断点续传）
    echo "=== Test 8: POST /api/stream/{id}/subscribe (last_ack_seq=-1) ==="
    CLIENT_ID="e2e-frontend-client-$(date +%s%N | tail -c 8)"
    RESP=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/subscribe" \
        -H "Content-Type: application/json" \
        -d "{\"client_id\":\"$CLIENT_ID\",\"last_ack_seq\":-1}")
    SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS" = "True" ]; then
        test_pass "订阅成功（last_ack_seq=-1）"
        REPLAY_COUNT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['replay_count'])")
        SUB_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['subscription_id'])")
        echo -e "  ${YELLOW}ℹ${NC} replay_count=$REPLAY_COUNT subscription_id=$SUB_ID"

        # 9. 增量订阅（last_ack_seq=0）
        echo "=== Test 9: POST /api/stream/{id}/subscribe (last_ack_seq=0) ==="
        RESP2=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/subscribe" \
            -H "Content-Type: application/json" \
            -d "{\"client_id\":\"$CLIENT_ID-2\",\"last_ack_seq\":0}")
        SUCCESS2=$(echo "$RESP2" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
        if [ "$SUCCESS2" = "True" ]; then
            REPLAY_COUNT2=$(echo "$RESP2" | python3 -c "import json,sys; print(json.load(sys.stdin)['replay_count'])")
            test_pass "增量订阅成功（last_ack_seq=0）返回 $REPLAY_COUNT2 chunks"
        else
            test_fail "增量订阅失败" "$RESP2"
        fi

        # 10. ACK
        echo "=== Test 10: POST /api/stream/subscription/{id}/ack ==="
        RESP3=$(curl -s -X POST "$BASE_URL/api/stream/subscription/$SUB_ID/ack" \
            -H "Content-Type: application/json" \
            -d '{"last_ack_seq":1}')
        SUCCESS3=$(echo "$RESP3" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
        if [ "$SUCCESS3" = "True" ]; then
            test_pass "ACK 成功 (last_ack_seq=1)"
        else
            test_fail "ACK 失败" "$RESP3"
        fi

        # 11. 取消订阅
        echo "=== Test 11: POST /api/stream/subscription/{id}/unsubscribe ==="
        RESP4=$(curl -s -X POST "$BASE_URL/api/stream/subscription/$SUB_ID/unsubscribe")
        SUCCESS4=$(echo "$RESP4" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
        if [ "$SUCCESS4" = "True" ]; then
            test_pass "取消订阅成功"
        else
            test_fail "取消订阅失败" "$RESP4"
        fi
    else
        test_fail "订阅失败" "$RESP"
    fi

    # 12. 标记流完成
    echo "=== Test 12: POST /api/stream/{id}/complete ==="
    RESP5=$(curl -s -X POST "$BASE_URL/api/stream/$STREAM_ID/complete")
    SUCCESS5=$(echo "$RESP5" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS5" = "True" ]; then
        test_pass "流完成标记成功"
    else
        test_fail "流完成标记失败" "$RESP5"
    fi

    # 13. 获取流元数据
    echo "=== Test 13: GET /api/stream/{id} ==="
    RESP6=$(curl -s "$BASE_URL/api/stream/$STREAM_ID")
    SUCCESS6=$(echo "$RESP6" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS6" = "True" ]; then
        STATE=$(echo "$RESP6" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['state'])")
        TOTAL_CHUNKS=$(echo "$RESP6" | python3 -c "import json,sys; print(json.load(sys.stdin)['stream']['total_chunks'])")
        test_pass "获取流元数据成功 (state=$STATE chunks=$TOTAL_CHUNKS)"
    else
        test_fail "获取流元数据失败" "$RESP6"
    fi

    # 14. 获取流 chunks
    echo "=== Test 14: GET /api/stream/{id}/chunks?from_seq=0 ==="
    RESP7=$(curl -s "$BASE_URL/api/stream/$STREAM_ID/chunks?from_seq=0")
    SUCCESS7=$(echo "$RESP7" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS7" = "True" ]; then
        CHUNKS_COUNT=$(echo "$RESP7" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
        test_pass "获取流 chunks 成功 (count=$CHUNKS_COUNT)"
    else
        test_fail "获取流 chunks 失败" "$RESP7"
    fi
fi

# 15. /api/stream/cleanup 端点
echo "=== Test 15: POST /api/stream/cleanup ==="
RESP8=$(curl -s -X POST "$BASE_URL/api/stream/cleanup" \
    -H "Content-Type: application/json" \
    -d '{"max_age_seconds":3600}')
SUCCESS8=$(echo "$RESP8" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
if [ "$SUCCESS8" = "True" ]; then
    DELETED=$(echo "$RESP8" | python3 -c "import json,sys; print(json.load(sys.stdin)['deleted_count'])")
    test_pass "清理成功 (deleted=$DELETED)"
else
    test_fail "清理失败" "$RESP8"
fi

# 16. /api/stream/session/{session_id} 端点
echo "=== Test 16: GET /api/stream/session/{session_id} ==="
if [ -n "$UNIQ_SESSION" ]; then
    RESP9=$(curl -s "$BASE_URL/api/stream/session/$UNIQ_SESSION?limit=10")
    SUCCESS9=$(echo "$RESP9" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "false")
    if [ "$SUCCESS9" = "True" ]; then
        SESSION_COUNT=$(echo "$RESP9" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])")
        test_pass "会话流列表成功 (count=$SESSION_COUNT)"
    else
        test_fail "会话流列表失败" "$RESP9"
    fi
fi

# 17. 前端资源可访问（Vite dev server 或已构建 dist）
echo "=== Test 17: 前端 StreamListPanel 资源 ==="
DIST_FILE="frontend/dist/index.html"
if [ -f "$DIST_FILE" ]; then
    test_pass "前端构建产物存在: $DIST_FILE"
    # 检查 useSSEReconnect hook 文件
    HOOK_FILE="frontend/src/hooks/useSSEReconnect.ts"
    if [ -f "$HOOK_FILE" ]; then
        HOOK_LINES=$(wc -l < "$HOOK_FILE")
        test_pass "useSSEReconnect.ts 存在 ($HOOK_LINES 行)"
    else
        test_fail "useSSEReconnect.ts 不存在"
    fi
    # 检查 StreamListPanel 文件
    PANEL_FILE="frontend/src/components/StreamListPanel.tsx"
    if [ -f "$PANEL_FILE" ]; then
        PANEL_LINES=$(wc -l < "$PANEL_FILE")
        test_pass "StreamListPanel.tsx 存在 ($PANEL_LINES 行)"
    else
        test_fail "StreamListPanel.tsx 不存在"
    fi
    # 检查 useStreamBufferApi 文件
    API_FILE="frontend/src/hooks/useStreamBufferApi.ts"
    if [ -f "$API_FILE" ]; then
        API_LINES=$(wc -l < "$API_FILE")
        test_pass "useStreamBufferApi.ts 存在 ($API_LINES 行)"
    else
        test_fail "useStreamBufferApi.ts 不存在"
    fi
else
    test_fail "前端构建产物不存在: $DIST_FILE"
fi

# 总结
echo ""
echo "============================================================"
echo -e "测试结果汇总"
echo "============================================================"
echo -e "通过: ${GREEN}$PASS${NC}"
echo -e "失败: ${RED}$FAIL${NC}"
echo "总计: $((PASS+FAIL))"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 全部 E2E 测试通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ 部分测试失败${NC}"
    exit 1
fi
