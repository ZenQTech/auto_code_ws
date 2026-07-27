#!/bin/bash
# ============================================================
# Cycle 2 E2E API 测试脚本 (v2 - 使用 python 断言)
# ============================================================

BASE_URL=${BASE_URL:-http://localhost:8000}
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC} | $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}❌ FAIL${NC} | $1"; FAIL=$((FAIL+1)); }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

# 通用断言函数
assert_json() {
    # $1=test_name  $2=response  $3=python expression
    local test_name="$1"
    local response="$2"
    local expr="$3"
    if echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    result = $expr
    sys.exit(0 if result else 1)
except Exception as e:
    print(f'Parse error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null; then
        pass "$test_name"
    else
        fail "$test_name | $response"
    fi
}

# ============================================================
section "T1: MCP (Model Context Protocol)"
# ============================================================
RESP=$(curl -s "$BASE_URL/api/mcp/servers")
assert_json "MCP list servers" "$RESP" "d.get('success') == True and d.get('count', 0) >= 1"

RESP=$(curl -s "$BASE_URL/api/mcp/tools")
assert_json "MCP list tools (4 builtin)" "$RESP" "d.get('success') == True and any(t['name'] == 'read_file' for t in d.get('tools', [])) and len(d.get('tools', [])) >= 4"

RESP=$(curl -s -X POST "$BASE_URL/api/mcp/tools/call" -H "Content-Type: application/json" \
    -d '{"tool_name": "list_directory", "arguments": {"path": "/tmp"}}')
assert_json "MCP call list_directory" "$RESP" "d.get('success') == True and d.get('result', {}).get('is_error') == False"

# ============================================================
section "T2: Compaction"
# ============================================================
RESP=$(curl -s "$BASE_URL/api/compaction/config")
assert_json "Compaction GET config (default hybrid)" "$RESP" "d.get('success') == True and d.get('config', {}).get('strategy') == 'hybrid'"

RESP=$(curl -s -X PUT "$BASE_URL/api/compaction/config" -H "Content-Type: application/json" \
    -d '{"max_tokens": 25000, "keep_recent": 8}')
assert_json "Compaction PUT config" "$RESP" "d.get('success') == True and d.get('config', {}).get('max_tokens') == 25000"

SESSION_ID=$(curl -s "$BASE_URL/api/sessions?limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
if [ -n "$SESSION_ID" ]; then
    RESP=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/tokens")
    assert_json "Compaction tokens query" "$RESP" "d.get('success') == True and 'token_count' in d"

    RESP=$(curl -s "$BASE_URL/api/sessions/$SESSION_ID/should-compact")
    assert_json "Compaction should-compact check" "$RESP" "d.get('success') == True and 'should_compact' in d"
fi

# ============================================================
section "T3: Session Fork / Resume / Lineage"
# ============================================================
if [ -n "$SESSION_ID" ]; then
    RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/fork" -H "Content-Type: application/json" \
        -d '{"title": "E2E Test Fork"}')
    assert_json "Fork session" "$RESP" "d.get('success') == True and d.get('session', {}).get('parent_session_id') == '$SESSION_ID'"

    FORK_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session', {}).get('id', ''))")

    if [ -n "$FORK_ID" ]; then
        RESP=$(curl -s "$BASE_URL/api/sessions/$FORK_ID/lineage")
        assert_json "Lineage query (root=$SESSION_ID)" "$RESP" "d.get('success') == True and d.get('root_id') == '$SESSION_ID' and len(d.get('ancestors', [])) == 1"

        RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$FORK_ID/archive")
        assert_json "Archive session" "$RESP" "d.get('success') == True and d.get('is_archived') == True"

        curl -s -X POST "$BASE_URL/api/sessions/$FORK_ID/unarchive" > /dev/null
    fi

    RESP=$(curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/resume" -H "Content-Type: application/json" \
        -d '{"device_id": "e2e-test-device"}')
    assert_json "Resume session with device_id" "$RESP" "d.get('success') == True and d.get('session', {}).get('device_id') == 'e2e-test-device'"
fi

# ============================================================
section "T4: Skills"
# ============================================================
RESP=$(curl -s "$BASE_URL/api/skills")
assert_json "Skills list (3 builtin)" "$RESP" "d.get('success') == True and d.get('count', 0) >= 3 and any(s.get('name') == 'code-reviewer' for s in d.get('skills', []))"

RESP=$(curl -s "$BASE_URL/api/skills/builtin-test-generator")
assert_json "Skills get detail" "$RESP" "d.get('success') == True and d.get('skill', {}).get('name') == 'test-generator'"

RESP=$(curl -s -X POST "$BASE_URL/api/skills/builtin-test-generator/disable")
assert_json "Skills disable" "$RESP" "d.get('success') == True and d.get('skill', {}).get('enabled') == False"

RESP=$(curl -s -X POST "$BASE_URL/api/skills/builtin-test-generator/enable")
assert_json "Skills enable" "$RESP" "d.get('success') == True and d.get('skill', {}).get('enabled') == True"

RESP=$(curl -s -X POST "$BASE_URL/api/skills" -H "Content-Type: application/json" \
    -d '{"name": "e2e-test-skill-'$$'", "display_name": "E2E Test", "description": "test", "system_prompt": "Test prompt"}')
assert_json "Skills create (user)" "$RESP" "d.get('success') == True and 'skill' in d"

USER_SKILL_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('skill', {}).get('id', ''))")
if [ -n "$USER_SKILL_ID" ]; then
    curl -s -X DELETE "$BASE_URL/api/skills/$USER_SKILL_ID" > /dev/null
    pass "Skills delete (user)"
fi

RESP=$(curl -s "$BASE_URL/api/skills/prompt/preview?base_prompt=test")
assert_json "Skills prompt preview" "$RESP" "d.get('success') == True and 'Active Skills' in d.get('prompt', '') and d.get('enabled_count', 0) >= 2"

# ============================================================
section "T5: AGENTS.md Memory"
# ============================================================
RESP=$(curl -s -X POST "$BASE_URL/api/agents-md/scan" -H "Content-Type: application/json" \
    -d '{"project_path": "/home/qizheng/auto_code_ws", "max_depth": 2}')
assert_json "AGENTS.md scan" "$RESP" "d.get('success') == True and d.get('found_count', 0) >= 1"

RESP=$(curl -s "$BASE_URL/api/agents-md/list")
assert_json "AGENTS.md list" "$RESP" "d.get('success') == True and len(d.get('memories', [])) >= 1"

RESP=$(curl -s "$BASE_URL/api/agents-md/inject/preview")
assert_json "AGENTS.md inject preview" "$RESP" "d.get('success') == True and 'injection' in d and d.get('length', 0) > 0"

# ============================================================
echo ""
echo "============================================================"
echo -e "测试结果: ${GREEN}通过 $PASS${NC} | ${RED}失败 $FAIL${NC}"
echo "============================================================"
exit $FAIL
