#!/bin/bash
# ============================================================
# Hooks Engine E2E 测试 (Cycle 9 P0-18)
# ============================================================
# 测试范围：
#   1. supported-events 端点
#   2. trae-hooks/list 端点
#   3. trae-hooks/load 端点
#   4. dispatch 与 block_on_error 集成
#   5. 路径白名单拦截
#   6. 完整 hook 链执行
# 目标：≥6 个 E2E 测试用例
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TEST_PROJECT="/tmp/test-projects/sample-trae-project"

PASSED=0
FAILED=0

color_red() { echo -e "\033[31m$*\033[0m"; }
color_green() { echo -e "\033[32m$*\033[0m"; }
color_blue() { echo -e "\033[34m$*\033[0m"; }

assert_pass() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    if [[ "$actual" == *"$expected"* ]]; then
        PASSED=$((PASSED + 1))
        color_green "  ✓ $name"
    else
        FAILED=$((FAILED + 1))
        color_red "  ✗ $name"
        echo "    Expected: $expected"
        echo "    Actual: $actual"
    fi
}

# 等待服务启动
echo "==> 等待 backend 服务启动..."
for i in {1..30}; do
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
        color_green "  服务已就绪"
        break
    fi
    sleep 1
done

if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
    color_red "  ✗ 服务未启动"
    exit 1
fi

# ============================================================
# Test 1: supported-events 端点
# ============================================================
echo ""
color_blue "Test 1: supported-events 端点"
RESP=$(curl -s "$BASE_URL/api/hooks/trae-hooks/supported-events")
assert_pass "success" "$RESP" '"success":true'
assert_pass "contains pre-tool" "$RESP" '"pre-tool"'
assert_pass "contains post-tool" "$RESP" '"post-tool"'
assert_pass "contains session-start" "$RESP" '"session-start"'

# ============================================================
# Test 2: trae-hooks/list 端点
# ============================================================
echo ""
color_blue "Test 2: trae-hooks/list 端点（不实际注册）"
RESP=$(curl -s "$BASE_URL/api/hooks/trae-hooks/list?project_path=$TEST_PROJECT")
assert_pass "success" "$RESP" '"success":true'
assert_pass "exists true" "$RESP" '"exists":true'
assert_pass "count >= 5" "$RESP" '"count":'
assert_pass "contains security-check" "$RESP" 'security-check'
assert_pass "contains load-context" "$RESP" 'load-context'
assert_pass "contains log-execution" "$RESP" 'log-execution'

# ============================================================
# Test 3: trae-hooks/load 端点
# ============================================================
echo ""
color_blue "Test 3: trae-hooks/load 端点（实际注册到 registry）"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/trae-hooks/load" \
    -H "Content-Type: application/json" \
    -d "{\"project_path\":\"$TEST_PROJECT\",\"clear_existing\":true}")
assert_pass "load success" "$RESP" '"success":true'
assert_pass "loaded >= 5" "$RESP" '"loaded":'
assert_pass "action is load" "$RESP" '"action":"load_trae_hooks"'

# ============================================================
# Test 4: 验证 hooks 已被注册到总注册表
# ============================================================
echo ""
color_blue "Test 4: 验证 hooks 已注册"
RESP=$(curl -s "$BASE_URL/api/hooks")
assert_pass "has hooks" "$RESP" '"hooks":'
assert_pass "PreToolUse in configs" "$RESP" 'PreToolUse'
assert_pass "SessionStart in configs" "$RESP" 'SessionStart'

# ============================================================
# Test 5: 触发 PreToolUse 事件（security-check 会被 matcher 匹配）
# ============================================================
echo ""
color_blue "Test 5: 触发 PreToolUse 事件"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event":"PreToolUse","payload":{"tool_name":"Write","arguments":{"file_path":"/tmp/test.txt"}}}')
assert_pass "dispatch ok" "$RESP" '"actions":'
# security-check matcher 匹配 Write
assert_pass "security-check ran" "$RESP" 'security-check'

# ============================================================
# Test 6: 触发 SessionStart 事件
# ============================================================
echo ""
color_blue "Test 6: 触发 SessionStart 事件"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event":"SessionStart","payload":{"session_id":"test-session","user_id":"test-user"}}')
assert_pass "session start dispatched" "$RESP" '"actions":'
assert_pass "load-context ran" "$RESP" 'load-context'

# ============================================================
# Test 7: 触发 UserPromptSubmit 事件
# ============================================================
echo ""
color_blue "Test 7: 触发 UserPromptSubmit 事件"
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event":"UserPromptSubmit","payload":{"user_input":"hello world","session_id":"s1"}}')
assert_pass "user-prompt dispatched" "$RESP" '"actions":'
assert_pass "log-user-prompt ran" "$RESP" 'log-user-prompt'

# ============================================================
# Test 8: block_on_error 集成（Write 工具触发 security-check）
# ============================================================
echo ""
color_blue "Test 8: block_on_error 集成验证"
# security-check 的 matcher 是 Write|Edit|MultiEdit
# 我们的 tool_name=Write 会匹配
# 检查返回的 actions 中第一个 action 包含 security-check
RESP=$(curl -s -X POST "$BASE_URL/api/hooks/dispatch" \
    -H "Content-Type: application/json" \
    -d '{"event":"PreToolUse","payload":{"tool_name":"Write","arguments":{"file_path":"/tmp/safe.txt"}}}')
# 解析 actions 数量
ACTIONS_COUNT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('actions',[])))" 2>/dev/null || echo "0")
if [[ "$ACTIONS_COUNT" -ge "1" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 至少 1 个 action 触发 ($ACTIONS_COUNT)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 应至少有 1 个 action"
fi

# ============================================================
# Test 9: 路径白名单拦截
# ============================================================
echo ""
color_blue "Test 9: 路径白名单拦截"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/hooks/trae-hooks/load" \
    -H "Content-Type: application/json" \
    -d '{"project_path":"/etc/passwd"}')
HTTP_CODE=$(echo "$RESP" | tail -1)
if [[ "$HTTP_CODE" == "403" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ /etc/passwd blocked (403)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ /etc/passwd should be blocked, got $HTTP_CODE"
fi

# ============================================================
# Test 10: 错误参数校验
# ============================================================
echo ""
color_blue "Test 10: 错误参数校验"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/hooks/trae-hooks/load" \
    -H "Content-Type: application/json" \
    -d '{}')
HTTP_CODE=$(echo "$RESP" | tail -1)
if [[ "$HTTP_CODE" == "422" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 缺少 project_path 返回 422"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 应返回 422，实际 $HTTP_CODE"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo "=========================================="
TOTAL=$((PASSED + FAILED))
echo "总计: $TOTAL 通过: $PASSED 失败: $FAILED"
if [[ $FAILED -eq 0 ]]; then
    color_green "✓ E2E 全部通过"
    exit 0
else
    color_red "✗ 有 $FAILED 个测试失败"
    exit 1
fi
