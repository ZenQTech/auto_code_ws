#!/usr/bin/env bash
# ============================================================
# Hook Bridge API E2E 测试脚本（v1.0.0）- Cycle 5 P0-6
# 覆盖：
#   1. POST /api/hooks/configs - 注册 hook
#   2. POST /api/hooks/fire UserPromptSubmit - 触发事件 + 返回 additionalContext
#   3. POST /api/hooks/fire PreToolUse - 触发 + 返回 additionalContext
#   4. POST /api/hooks/fire PermissionRequest - 触发 + 返回 permissionDecision
#   5. POST /api/hooks/fire SessionStart/SessionEnd - 触发会话事件
#   6. POST /api/hooks/fire SubagentStart/SubagentStop - 触发 SubAgent 事件
#   7. POST /api/hooks/fire PreCompact/PostCompact - 触发压缩事件
#   8. POST /api/hooks/fire PostToolUse - 触发工具后事件
#   9. GET  /api/hooks/chain - 获取触发链路
#  10. GET  /api/hooks/chain/summary - 获取链路摘要
#  11. POST /api/hooks/chain/clear - 清空链路
#  12. POST /api/hooks/clear - 清空 hook 配置
#  13. 错误用例：未知事件类型返回 400
#  14. 错误用例：未注册 hook 时 fire 返回空 actions
# ============================================================
set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
echo "=========================================="
echo "  Hook Bridge API E2E 测试"
echo "  BASE_URL: $BASE_URL"
echo "=========================================="

PASS=0
FAIL=0
TOTAL=0

report_pass() {
    PASS=$((PASS+1))
    TOTAL=$((TOTAL+1))
    echo -e "  \033[0;32m✓\033[0m $1"
}

report_fail() {
    FAIL=$((FAIL+1))
    TOTAL=$((TOTAL+1))
    echo -e "  \033[0;31m✗\033[0m $1"
    if [ -n "$2" ]; then
        echo -e "    \033[0;31mDetail:\033[0m $2"
    fi
}

check_status() {
    local expect=$1
    local actual=$2
    local name=$3
    if [ "$actual" = "$expect" ]; then
        report_pass "$name (HTTP $actual)"
    else
        report_fail "$name" "Expected $expect, got $actual"
    fi
}

# 等待后端启动
echo ""
echo -e "\033[1;33m⏳ 等待后端启动...\033[0m"
for i in $(seq 1 30); do
    if curl -s -m 2 "$BASE_URL/health" >/dev/null 2>&1; then
        echo -e "\033[0;32m✓ 后端就绪\033[0m"
        break
    fi
    sleep 1
done

# 清理 hook 配置和链路
echo ""
echo "[Setup] 清空现有 hook 配置和链路"
curl -s -X POST "$BASE_URL/api/hooks/clear" >/dev/null
curl -s -X POST "$BASE_URL/api/hooks/chain/clear" >/dev/null
echo "  OK"

# ============================================================
# Test 1: 注册一个返回 hookSpecificOutput 的 hook（使用 /configs/add）
# ============================================================
echo ""
echo "[1] POST /api/hooks/configs/add (注册 context-injector hook)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/configs/add" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "UserPromptSubmit",
        "matcher": "",
        "type": "command",
        "command": "echo \"{\\\"hookSpecificOutput\\\":{\\\"hookEventName\\\":\\\"UserPromptSubmit\\\",\\\"additionalContext\\\":\\\"使用简洁回答\\\"}}\"",
        "name": "context_injector"
    }')
echo "  Response: $RESP"
if echo "$RESP" | grep -q '"success":true'; then
    report_pass "hook 注册成功"
else
    report_fail "hook 注册失败" "$RESP"
fi

# ============================================================
# Test 2: 注册一个返回 permissionDecision 的 hook
# ============================================================
echo ""
echo "[2] POST /api/hooks/configs/add (注册 permission hook)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/configs/add" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PermissionRequest",
        "matcher": "",
        "type": "command",
        "command": "echo \"{\\\"hookSpecificOutput\\\":{\\\"hookEventName\\\":\\\"PermissionRequest\\\",\\\"permissionDecision\\\":\\\"deny\\\"}}\"",
        "name": "permission_deny"
    }')
echo "  Response: $RESP"
if echo "$RESP" | grep -q '"success":true'; then
    report_pass "permission hook 注册成功"
else
    report_fail "permission hook 注册失败" "$RESP"
fi

# ============================================================
# Test 3: 触发 UserPromptSubmit
# ============================================================
echo ""
echo "[3] POST /api/hooks/fire (UserPromptSubmit)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "UserPromptSubmit",
        "user_input": "请帮我设计一个 API",
        "session_id": "test-session-1"
    }')
echo "  Response: $RESP"
if echo "$RESP" | grep -q "additional_context" && echo "$RESP" | grep -q "简洁"; then
    report_pass "UserPromptSubmit 触发并返回 additionalContext"
else
    report_fail "UserPromptSubmit 触发失败" "$RESP"
fi

# ============================================================
# Test 4: 触发 PreToolUse
# ============================================================
echo ""
echo "[4] POST /api/hooks/fire (PreToolUse)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PreToolUse",
        "tool_name": "Bash",
        "arguments": {"command": "ls"},
        "agent_id": "agent-1"
    }')
echo "  Response: $RESP"
if echo "$RESP" | grep -q '"event":"PreToolUse"'; then
    report_pass "PreToolUse 触发成功"
else
    report_fail "PreToolUse 触发失败" "$RESP"
fi

# ============================================================
# Test 5: 触发 PermissionRequest - 返回 permissionDecision
# ============================================================
echo ""
echo "[5] POST /api/hooks/fire (PermissionRequest)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PermissionRequest",
        "tool_name": "Write",
        "arguments": {"file": "/etc/passwd"},
        "agent_id": "agent-1"
    }')
echo "  Response: $RESP"
if echo "$RESP" | grep -q '"permission_decision":"deny"'; then
    report_pass "PermissionRequest 触发并返回 permissionDecision=deny"
else
    report_fail "PermissionRequest 触发失败" "$RESP"
fi

# ============================================================
# Test 6: 触发 SessionStart
# ============================================================
echo ""
echo "[6] POST /api/hooks/fire (SessionStart)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SessionStart",
        "session_id": "test-session-2"
    }')
if echo "$RESP" | grep -q '"event":"SessionStart"'; then
    report_pass "SessionStart 触发成功"
else
    report_fail "SessionStart 触发失败" "$RESP"
fi

# ============================================================
# Test 7: 触发 SessionEnd
# ============================================================
echo ""
echo "[7] POST /api/hooks/fire (SessionEnd)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SessionEnd",
        "session_id": "test-session-2",
        "duration_ms": 60000
    }')
if echo "$RESP" | grep -q '"event":"SessionEnd"'; then
    report_pass "SessionEnd 触发成功"
else
    report_fail "SessionEnd 触发失败" "$RESP"
fi

# ============================================================
# Test 8: 触发 SubagentStart
# ============================================================
echo ""
echo "[8] POST /api/hooks/fire (SubagentStart)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SubagentStart",
        "subagent_id": "sub-001",
        "task": "implement auth"
    }')
if echo "$RESP" | grep -q '"event":"SubagentStart"'; then
    report_pass "SubagentStart 触发成功"
else
    report_fail "SubagentStart 触发失败" "$RESP"
fi

# ============================================================
# Test 9: 触发 SubagentStop
# ============================================================
echo ""
echo "[9] POST /api/hooks/fire (SubagentStop)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SubagentStop",
        "subagent_id": "sub-001",
        "result": "completed"
    }')
if echo "$RESP" | grep -q '"event":"SubagentStop"'; then
    report_pass "SubagentStop 触发成功"
else
    report_fail "SubagentStop 触发失败" "$RESP"
fi

# ============================================================
# Test 10: 触发 PreCompact
# ============================================================
echo ""
echo "[10] POST /api/hooks/fire (PreCompact)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PreCompact",
        "trigger": "auto",
        "context_size": 5000,
        "session_id": "test-session-2"
    }')
if echo "$RESP" | grep -q '"event":"PreCompact"'; then
    report_pass "PreCompact 触发成功"
else
    report_fail "PreCompact 触发失败" "$RESP"
fi

# ============================================================
# Test 11: 触发 PostCompact
# ============================================================
echo ""
echo "[11] POST /api/hooks/fire (PostCompact)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PostCompact",
        "original_size": 5000,
        "new_size": 2000,
        "session_id": "test-session-2"
    }')
if echo "$RESP" | grep -q '"event":"PostCompact"'; then
    report_pass "PostCompact 触发成功"
else
    report_fail "PostCompact 触发失败" "$RESP"
fi

# ============================================================
# Test 12: 触发 PostToolUse
# ============================================================
echo ""
echo "[12] POST /api/hooks/fire (PostToolUse)"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PostToolUse",
        "tool_name": "Bash",
        "result": "success",
        "duration_ms": 100,
        "agent_id": "agent-1"
    }')
if echo "$RESP" | grep -q '"event":"PostToolUse"'; then
    report_pass "PostToolUse 触发成功"
else
    report_fail "PostToolUse 触发失败" "$RESP"
fi

# ============================================================
# Test 13: 获取 hook 触发链路
# ============================================================
echo ""
echo "[13] GET /api/hooks/chain"
RESP=$(curl -s "$BASE_URL/api/hooks/chain?limit=20")
echo "  Response length: $(echo "$RESP" | wc -c)"
if echo "$RESP" | grep -q '"items"'; then
    ITEM_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('items', [])))")
    if [ "$ITEM_COUNT" -ge 8 ]; then
        report_pass "hook 链路返回 $ITEM_COUNT 条记录"
    else
        report_fail "hook 链路记录数不足" "got $ITEM_COUNT items"
    fi
else
    report_fail "hook 链路获取失败" "$RESP"
fi

# ============================================================
# Test 14: 获取链路摘要
# ============================================================
echo ""
echo "[14] GET /api/hooks/chain/summary"
RESP=$(curl -s "$BASE_URL/api/hooks/chain/summary")
echo "  Response: $RESP"
if echo "$RESP" | grep -q "total"; then
    report_pass "链路摘要返回 total 字段"
else
    report_fail "链路摘要获取失败" "$RESP"
fi

# ============================================================
# Test 15: 错误用例 - 未知事件类型
# ============================================================
echo ""
echo "[15] POST /api/hooks/fire (未知事件 - 期望 400)"
HTTP_CODE=$(curl -s -o /tmp/resp.txt -w "%{http_code}" -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{"event": "UnknownEvent", "user_input": "test"}')
if [ "$HTTP_CODE" = "400" ]; then
    report_pass "未知事件返回 400"
else
    report_fail "未知事件错误处理" "Expected 400, got $HTTP_CODE"
fi

# ============================================================
# Test 16: 清空链路
# ============================================================
echo ""
echo "[16] POST /api/hooks/chain/clear"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/chain/clear")
if echo "$RESP" | grep -q "success.*true"; then
    report_pass "清空链路成功"
else
    report_fail "清空链路失败" "$RESP"
fi

# ============================================================
# Test 17: 清空后链路为空
# ============================================================
echo ""
echo "[17] GET /api/hooks/chain (清空后)"
RESP=$(curl -s "$BASE_URL/api/hooks/chain")
ITEM_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('items', [])))")
if [ "$ITEM_COUNT" = "0" ]; then
    report_pass "清空后链路为空"
else
    report_fail "清空后链路非空" "got $ITEM_COUNT items"
fi

# ============================================================
# Test 18: 错误用例 - 未注册 hook 时 fire 返回空 actions
# ============================================================
echo ""
echo "[18] POST /api/hooks/fire (未注册 hook - SubagentStart)"
# 先清空所有 hook 配置
curl -s -X POST "$BASE_URL/api/hooks/clear" >/dev/null
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/fire" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SubagentStart",
        "subagent_id": "sub-002",
        "task": "test no hook"
    }')
if echo "$RESP" | grep -q '"actions":\[\]'; then
    report_pass "无 hook 时返回空 actions 数组"
else
    report_fail "无 hook 时 actions 异常" "$RESP"
fi

# 清理
echo ""
echo "[Teardown] 清理 hook 配置和链路"
curl -s -X POST "$BASE_URL/api/hooks/clear" >/dev/null
curl -s -X POST "$BASE_URL/api/hooks/chain/clear" >/dev/null
echo "  OK"

# ============================================================
echo ""
echo "=========================================="
echo "  测试结果：$PASS 通过 / $FAIL 失败 / $TOTAL 总计"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
echo "✓ 所有 E2E 测试通过"
exit 0
