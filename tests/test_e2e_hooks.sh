#!/bin/bash
# ============================================================
# Cycle 4 P0-4 E2E 测试 - Hooks 事件系统
# ============================================================
# 测试覆盖：
#   - GET  /api/hooks/events         - 列出 10 种事件
#   - GET  /api/hooks/summary        - 注册表摘要
#   - POST /api/hooks/configs        - 添加 hook 配置
#   - GET  /api/hooks                - 列出所有 hooks
#   - POST /api/hooks/dispatch       - 触发事件
#   - POST /api/hooks/test           - 测试单个 hook
#   - POST /api/hooks/load           - 加载配置文件
#   - POST /api/hooks/clear          - 清空配置
#   - GET  /api/hooks/history        - 触发历史
# 创建日期：2026-07-27
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
echo "=== Hooks 事件系统 E2E 测试 ==="
echo "目标: $BASE_URL"
echo

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

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
# 前置：检查服务
# ============================================================
section "前置：服务健康"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    test_pass "后端服务可访问 /health"
else
    test_fail "后端服务不可访问" "HTTP_CODE=$HTTP_CODE"
    exit 1
fi

# 清空配置
curl -s -X POST "$BASE_URL/api/hooks/clear" > /dev/null 2>&1

# ============================================================
# H1: 列出 10 种事件
# ============================================================
section "H1: 列出 10 种 Hook 事件"

EVENTS_RESP=$(curl -s "$BASE_URL/api/hooks/events")
EVENTS_TOTAL=$(echo "$EVENTS_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('total', 0))" 2>/dev/null)
if [ "$EVENTS_TOTAL" = "10" ]; then
    test_pass "GET /hooks/events 返回 10 种事件"
else
    test_fail "事件数量错误" "实际: $EVENTS_TOTAL, 期望: 10"
fi

# 验证所有事件名存在
for event in SessionStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest PreCompact PostCompact SubagentStart SubagentStop SessionEnd; do
    if echo "$EVENTS_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); events = [e['name'] for e in d.get('events', [])]; print('$event' in events)" 2>/dev/null | grep -q "True"; then
        test_pass "事件 $event 存在"
    else
        test_fail "事件 $event 缺失"
    fi
done

# ============================================================
# H2: 注册表摘要（空状态）
# ============================================================
section "H2: 注册表摘要"

SUMMARY_RESP=$(curl -s "$BASE_URL/api/hooks/summary")
TOTAL_CONFIGS=$(echo "$SUMMARY_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('total_configs', 0))" 2>/dev/null)
if [ "$TOTAL_CONFIGS" = "0" ]; then
    test_pass "初始状态无配置（total_configs=0）"
else
    test_fail "初始状态有残留配置" "total_configs=$TOTAL_CONFIGS"
fi

# ============================================================
# H3: 添加 hook 配置
# ============================================================
section "H3: 添加 Hook 配置"

ADD_RESP=$(curl -s -X POST "$BASE_URL/api/hooks/configs" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PreToolUse",
        "matcher": "Bash|Write",
        "hooks": [
            {"type": "command", "command": "echo blocked", "timeout": 5, "name": "blocker"}
        ]
    }')
ADD_SUCCESS=$(echo "$ADD_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$ADD_SUCCESS" = "True" ]; then
    test_pass "添加 PreToolUse hook 配置成功"
else
    test_fail "添加 hook 配置失败" "$ADD_RESP"
fi

# 错误事件类型
BAD_RESP=$(curl -s -X POST "$BASE_URL/api/hooks/configs" \
    -H "Content-Type: application/json" \
    -d '{"event": "InvalidEvent", "hooks": []}')
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/hooks/configs" \
    -H "Content-Type: application/json" \
    -d '{"event": "InvalidEvent", "hooks": []}')
if [ "$BAD_CODE" = "400" ]; then
    test_pass "添加无效事件返回 400"
else
    test_fail "无效事件未返回 400" "HTTP $BAD_CODE"
fi

# ============================================================
# H4: 列出所有 hooks
# ============================================================
section "H4: 列出所有 Hook 配置"

LIST_RESP=$(curl -s "$BASE_URL/api/hooks")
LIST_TOTAL=$(echo "$LIST_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('total', 0))" 2>/dev/null)
if [ "$LIST_TOTAL" -ge "1" ]; then
    test_pass "GET /hooks 返回配置（total=$LIST_TOTAL）"
else
    test_fail "GET /hooks 未返回配置" "$LIST_RESP"
fi

# ============================================================
# H5: 触发事件 - 匹配的 hook 应执行
# ============================================================
section "H5: 触发事件 + matcher 匹配"

# 匹配 Bash（应执行）
DISPATCH_MATCH=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event": "PreToolUse", "payload": {"tool_name": "Bash"}}')
EXECUTED_MATCH=$(echo "$DISPATCH_MATCH" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('executed', 0))" 2>/dev/null)
if [ "$EXECUTED_MATCH" -ge "1" ]; then
    test_pass "Bash 匹配后执行 $EXECUTED_MATCH 个 hook"
else
    test_fail "Bash 匹配后未执行" "$DISPATCH_MATCH"
fi

# 验证 stdout 包含 "blocked"
STDOUT_MATCH=$(echo "$DISPATCH_MATCH" | python3 -c "import sys, json; d = json.load(sys.stdin); actions = d.get('actions', []); print(any('blocked' in a.get('stdout', '') for a in actions))" 2>/dev/null)
if [ "$STDOUT_MATCH" = "True" ]; then
    test_pass "Hook stdout 包含 'blocked'"
else
    test_fail "Hook stdout 缺少 'blocked'" "$DISPATCH_MATCH"
fi

# 不匹配的 tool（应不执行）
DISPATCH_NOMATCH=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event": "PreToolUse", "payload": {"tool_name": "Read"}}')
EXECUTED_NOMATCH=$(echo "$DISPATCH_NOMATCH" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('executed', 0))" 2>/dev/null)
if [ "$EXECUTED_NOMATCH" = "0" ]; then
    test_pass "Read 不匹配 Bash|Write，0 个 hook 执行"
else
    test_fail "Read 不应匹配" "$DISPATCH_NOMATCH"
fi

# ============================================================
# H6: 触发事件 - 阻塞（exit code 2）
# ============================================================
section "H6: 阻塞语义"

# 添加一个总是阻塞的 hook
curl -s -X POST "$BASE_URL/api/hooks/configs" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "PostToolUse",
        "matcher": "Bash",
        "hooks": [
            {"type": "command", "command": "echo first", "name": "h1"},
            {"type": "command", "command": "exit 2", "name": "h2-blocker"},
            {"type": "command", "command": "echo NEVER-EXECUTED", "name": "h3"}
        ]
    }' > /dev/null

DISPATCH_BLOCK=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event": "PostToolUse", "payload": {"tool_name": "Bash"}}')

EXECUTED_BLOCK=$(echo "$DISPATCH_BLOCK" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('executed', 0))" 2>/dev/null)
BLOCKING_FLAG=$(echo "$DISPATCH_BLOCK" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('blocking', False))" 2>/dev/null)

if [ "$EXECUTED_BLOCK" = "2" ] && [ "$BLOCKING_FLAG" = "True" ]; then
    test_pass "阻塞后只执行 2 个 hook，第 3 个被跳过"
else
    test_fail "阻塞语义错误" "executed=$EXECUTED_BLOCK, blocking=$BLOCKING_FLAG"
fi

# ============================================================
# H7: 测试单个 hook（test endpoint）
# ============================================================
section "H7: 测试单个 hook"

TEST_RESP=$(curl -s -X POST "$BASE_URL/api/hooks/test" \
    -H "Content-Type: application/json" \
    -d '{
        "event": "SessionStart",
        "matcher": "",
        "type": "command",
        "command": "echo test_session_started",
        "timeout": 5,
        "name": "test_hook"
    }')
TEST_SUCCESS=$(echo "$TEST_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
TEST_STDOUT=$(echo "$TEST_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(any('test_session_started' in a.get('stdout', '') for a in d.get('actions', [])))" 2>/dev/null)

if [ "$TEST_SUCCESS" = "True" ] && [ "$TEST_STDOUT" = "True" ]; then
    test_pass "POST /hooks/test 成功执行临时 hook"
else
    test_fail "POST /hooks/test 失败" "$TEST_RESP"
fi

# ============================================================
# H8: 加载配置文件
# ============================================================
section "H8: 加载配置文件"

TMP_CONFIG=$(mktemp /tmp/hooks_config.XXXXXX.json)
cat > "$TMP_CONFIG" <<EOF
{
  "hooks": [
    {
      "event": "SessionStart",
      "matcher": "",
      "hooks": [
        {"type": "command", "command": "echo 'session-init'", "timeout": 5}
      ]
    },
    {
      "event": "UserPromptSubmit",
      "matcher": "^/review",
      "hooks": [
        {"type": "command", "command": "echo 'review-triggered'", "timeout": 5}
      ]
    }
  ]
}
EOF

LOAD_RESP=$(curl -s -X POST "$BASE_URL/api/hooks/load" \
    -H "Content-Type: application/json" \
    -d "{\"config_path\": \"$TMP_CONFIG\"}")
LOAD_SUCCESS=$(echo "$LOAD_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$LOAD_SUCCESS" = "True" ]; then
    test_pass "加载 JSON 配置文件成功"
else
    test_fail "加载配置失败" "$LOAD_RESP"
fi
rm -f "$TMP_CONFIG"

# ============================================================
# H9: 触发历史
# ============================================================
section "H9: 触发历史"

HISTORY_RESP=$(curl -s "$BASE_URL/api/hooks/history?limit=10")
HISTORY_TOTAL=$(echo "$HISTORY_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('total', 0))" 2>/dev/null)
if [ "$HISTORY_TOTAL" -gt "0" ]; then
    test_pass "触发历史记录了 $HISTORY_TOTAL 条事件"
else
    test_fail "触发历史为空" "$HISTORY_RESP"
fi

# ============================================================
# H10: 清空配置
# ============================================================
section "H10: 清空配置"

CLEAR_RESP=$(curl -s -X POST "$BASE_URL/api/hooks/clear")
CLEAR_SUCCESS=$(echo "$CLEAR_RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
if [ "$CLEAR_SUCCESS" = "True" ]; then
    test_pass "POST /hooks/clear 成功"
else
    test_fail "清空失败" "$CLEAR_RESP"
fi

# 验证清空后
LIST_AFTER=$(curl -s "$BASE_URL/api/hooks")
TOTAL_AFTER=$(echo "$LIST_AFTER" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('total', 0))" 2>/dev/null)
if [ "$TOTAL_AFTER" = "0" ]; then
    test_pass "清空后 total=0"
else
    test_fail "清空后仍有配置" "total=$TOTAL_AFTER"
fi

# ============================================================
# H11: 10 种事件都能触发
# ============================================================
section "H11: 10 种事件全部可触发"

# 先重新清空 + 添加
curl -s -X POST "$BASE_URL/api/hooks/clear" > /dev/null
for event in SessionStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest PreCompact PostCompact SubagentStart SubagentStop SessionEnd; do
    curl -s -X POST "$BASE_URL/api/hooks/configs" \
        -H "Content-Type: application/json" \
        -d "{
            \"event\": \"$event\",
            \"matcher\": \"\",
            \"hooks\": [{\"type\": \"command\", \"command\": \"echo event-ok\", \"timeout\": 3}]
        }" > /dev/null
done

# 触发每种事件
for event in SessionStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest PreCompact PostCompact SubagentStart SubagentStop SessionEnd; do
    DISPATCH=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
        -H "Content-Type: application/json" \
        -d "{\"event\": \"$event\", \"payload\": {\"session_id\": \"s1\"}}")
    EXECUTED=$(echo "$DISPATCH" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('executed', 0))" 2>/dev/null)
    if [ "$EXECUTED" = "1" ]; then
        test_pass "事件 $event 可触发并执行"
    else
        test_fail "事件 $event 未正确触发" "$DISPATCH"
    fi
done

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
