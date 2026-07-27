#!/bin/bash
# ============================================================
# TRACE 模块 E2E 测试（Cycle 7 P0-11）
# ============================================================
# 测试目标：
#   1. 健康检查
#   2. 编译用户消息为规则
#   3. 预检查工具调用 (允许 / 拒绝 / 警告)
#   4. 规则管理 (CRUD)
#   5. 统计与清空
#   6. 完整工作流
# ============================================================

set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8000}"
SID="e2e_trace_$(date +%s)_$$"
PASSED=0
FAILED=0

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

run_test() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name"
        PASSED=$((PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $name"
        FAILED=$((FAILED + 1))
    fi
}

echo "=== Session ID: $SID ==="
echo ""

echo "[1] 健康检查"
run_test "GET /api/trace/health" "curl -s '$BASE/api/trace/health' | grep -q '\"status\":\"ok\"'"

echo "[2] 已知主题列表"
run_test "GET /api/trace/subjects" "curl -s '$BASE/api/trace/subjects' | grep -q '\"global_variables\"'"
run_test "GET /api/trace/subjects 含 tier" "curl -s '$BASE/api/trace/subjects' | grep -q '\"tier\":1'"

echo "[3] 编译用户消息"
# 3.1 禁止类 - 全局变量
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"不要使用全局变量\"}")
RULE_ID_GV=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
run_test "compile: 禁止全局变量" "[ -n '$RULE_ID_GV' ]"
run_test "compile: success=true" "echo '$RESP' | grep -q '\"success\":true'"
run_test "compile: is_correction=true" "echo '$RESP' | grep -q '\"is_correction\":true'"
run_test "compile: tier=1" "echo '$RESP' | grep -q '\"tier\":1'"

# 3.2 禁止类 - console.log
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"不要使用 console.log\"}")
RULE_ID_CL=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
run_test "compile: 禁止 console.log" "[ -n '$RULE_ID_CL' ]"

# 3.3 要求类 - TypeScript
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"必须使用 TypeScript\"}")
RULE_ID_TS=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
run_test "compile: TypeScript" "[ -n '$RULE_ID_TS' ]"

# 3.4 偏好类 - 简洁
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"建议代码简洁一些\"}")
RULE_ID_S=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
run_test "compile: 简洁偏好" "[ -n '$RULE_ID_S' ]"

# 3.5 非纠正消息
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"你好, 帮我写个 Python 函数\"}")
run_test "compile: 非纠正" "echo '$RESP' | grep -q '\"is_correction\":false'"

# 3.6 .env 文件
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"user_message\":\"不要修改 .env 文件\"}")
RULE_ID_ENV=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
run_test "compile: .env 保护" "[ -n '$RULE_ID_ENV' ]"

echo "[4] 列出规则"
run_test "GET rules 至少 6 条" "curl -s '$BASE/api/trace/rules?session_id=$SID' | grep -q '\"count\":[6-9]'"
run_test "GET rules 含 global_variables" "curl -s '$BASE/api/trace/rules?session_id=$SID' | grep -q 'global_variables'"

echo "[5] 获取单条规则"
run_test "GET rule $RULE_ID_GV" "curl -s '$BASE/api/trace/rules/$RULE_ID_GV' | grep -q '\"success\":true'"
run_test "GET rule 不存在 → 404" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/trace/rules/non-exist')\" = '404' ]"

echo "[6] 预检查 - 允许"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"content\":\"def foo():\n    local_var = 1\"}}")
run_test "check: 合法代码 allowed=true" "echo '$RESP' | grep -q '\"allowed\":true'"

echo "[7] 预检查 - 拒绝 (Tier 1)"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"content\":\"GLOBAL_VAR = 42\"}}")
run_test "check: 全局变量 denied" "echo '$RESP' | grep -q '\"allowed\":false'"
run_test "check: rule_id 返回" "echo '$RESP' | grep -q '\"rule_id\":\"$RULE_ID_GV\"'"
run_test "check: reason 返回" "echo '$RESP' | grep -q '\"reason\":'"

echo "[8] 预检查 - 拒绝 (console.log)"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"content\":\"console.log('debug')\"}}")
run_test "check: console.log denied" "echo '$RESP' | grep -q '\"allowed\":false'"

echo "[9] 预检查 - 拒绝 (.env)"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"file_path\":\"/app/.env\"}}")
run_test "check: .env denied" "echo '$RESP' | grep -q '\"allowed\":false'"

echo "[10] 预检查 - Tier 3 警告"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"content\":\"x = 1\"}}")
run_test "check: 包含 warnings 字段" "echo '$RESP' | grep -q '\"warnings\"'"
WARN_COUNT=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('warnings', [])))")
run_test "check: 至少 1 条警告" "[ \"$WARN_COUNT\" -ge 1 ]"

echo "[11] 统计"
STATS=$(curl -s "$BASE/api/trace/stats?session_id=$SID")
run_test "stats: success" "echo '$STATS' | grep -q '\"success\":true'"
run_test "stats: violations > 0" "echo '$STATS' | grep -qE '\"total_violations\":[1-9]'"
run_test "stats: hits > 0" "echo '$STATS' | grep -qE '\"total_hits\":[1-9]'"

echo "[12] 停用规则"
run_test "DELETE rule $RULE_ID_CL" "curl -s -X DELETE '$BASE/api/trace/rules/$RULE_ID_CL' | grep -q '\"success\":true'"
RESP=$(curl -s -X POST "$BASE/api/trace/check" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"tool_name\":\"edit_file\",\"tool_args\":{\"content\":\"console.log('x')\"}}")
# 停用后应不再被此规则阻止（除非有其他规则）
run_test "check: 停用后 console.log 不被此规则阻止" "! echo '$RESP' | grep -q \"$RULE_ID_CL\""

echo "[13] 物理删除"
run_test "DELETE rule /hard" "curl -s -X DELETE '$BASE/api/trace/rules/$RULE_ID_S/hard' | grep -q '\"success\":true'"
run_test "GET rule 删除后 404" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/trace/rules/$RULE_ID_S')\" = '404' ]"

echo "[14] 清空 session"
run_test "POST clear" "curl -s -X POST '$BASE/api/trace/clear' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\"}' | grep -q '\"success\":true'"
# 清空后, 仅该 session 的 session-scope 规则被删除
# (user/global scope 规则保留, 这是设计行为)
RULES_AFTER_CLEAR=$(curl -s "$BASE/api/trace/rules?session_id=$SID&scope_filter=session")
SESSION_COUNT=$(echo "$RULES_AFTER_CLEAR" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('count', -1))")
run_test "GET rules 清空后 session-scope=0" "[ \"$SESSION_COUNT\" = '0' ]"

echo "[15] 跨 session 规则 (user scope)"
# 添加 user scope 规则
RESP=$(curl -s -X POST "$BASE/api/trace/compile" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"anyuser\",\"user_message\":\"禁止使用全局变量\",\"scope\":\"user\"}")
USER_RID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('rule_id') or '')")
# 新 session 应能查询到 user scope 规则
NEW_SID="new_session_$(date +%s)"
RULES_RESP=$(curl -s "$BASE/api/trace/rules?session_id=$NEW_SID")
run_test "user scope 跨 session 可见" "echo '$RULES_RESP' | grep -q '\"anyuser\"'"

echo ""
echo "============================================================"
echo -e "Total: $((PASSED + FAILED)) | ${GREEN}Passed: $PASSED${NC} | ${RED}Failed: $FAILED${NC}"
echo "============================================================"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
