#!/bin/bash
# ============================================================
# Cycle 8 P0-12: Slash Commands API E2E 测试
# ============================================================
# 测试目标：
#   1. 注册表摘要
#   2. 列出所有命令
#   3. 按分类列出
#   4. 搜索命令
#   5. 查询命令详情
#   6. 执行命令
#   7. 参数验证（必填/可选/choices）
#   8. 执行历史
#   9. 帮助端点
#  10. 启用/禁用
# ============================================================

set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8000}"
PASSED=0
FAILED=0

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

echo "=== Slash Commands E2E 测试 ==="
echo "BASE: $BASE"
echo ""

# 等待服务启动
echo "等待服务启动..."
for i in {1..30}; do
    if curl -s "$BASE/health" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo "[1] 注册表摘要"
run_test "GET /api/slash-commands/summary" \
    "curl -s '$BASE/api/slash-commands/summary' | grep -q '\"total\":[0-9]'"
run_test "摘要 total >= 18" \
    "curl -s '$BASE/api/slash-commands/summary' | grep -E '\"total\":(1[89]|[2-9][0-9])'"
run_test "摘要含 by_category" \
    "curl -s '$BASE/api/slash-commands/summary' | grep -q '\"by_category\"'"

echo ""
echo "[2] 列出所有命令"
run_test "GET /api/slash-commands" \
    "curl -s '$BASE/api/slash-commands' | grep -q '\"commands\"'"
run_test "包含 /plan" \
    "curl -s '$BASE/api/slash-commands' | grep -q '\"name\":\"plan\"'"
run_test "包含 /init" \
    "curl -s '$BASE/api/slash-commands' | grep -q '\"name\":\"init\"'"
run_test "包含 /help" \
    "curl -s '$BASE/api/slash-commands' | grep -q '\"name\":\"help\"'"

echo ""
echo "[3] 按分类列出"
run_test "GET /api/slash-commands/categories" \
    "curl -s '$BASE/api/slash-commands/categories' | grep -q '\"categories\"'"
run_test "包含 navigation 分类" \
    "curl -s '$BASE/api/slash-commands/categories' | grep -q '\"name\":\"navigation\"'"
run_test "包含 mode 分类" \
    "curl -s '$BASE/api/slash-commands/categories' | grep -q '\"name\":\"mode\"'"

echo ""
echo "[4] 搜索命令"
run_test "搜索 plan" \
    "curl -s '$BASE/api/slash-commands/search?q=plan' | grep -q '\"name\":\"plan\"'"
run_test "搜索 review" \
    "curl -s '$BASE/api/slash-commands/search?q=review' | grep -q '\"name\":\"review\"'"
run_test "空查询返回所有" \
    "curl -s '$BASE/api/slash-commands/search?q=' | grep -q '\"commands\"'"

echo ""
echo "[5] 查询命令详情"
run_test "GET /api/slash-commands/plan" \
    "curl -s '$BASE/api/slash-commands/plan' | grep -q '\"name\":\"plan\"'"
run_test "GET /api/slash-commands/init 含 handler" \
    "curl -s '$BASE/api/slash-commands/init' | grep -q '\"handler\":\"create_agents_md\"'"
run_test "GET /api/slash-commands/notexist 返回 404" \
    "curl -s -o /dev/null -w '%{http_code}' '$BASE/api/slash-commands/notexist123' | grep -q '404'"

echo ""
echo "[6] 执行命令"
# 6.1 执行 /plan
RESP=$(curl -s -X POST "$BASE/api/slash-commands/execute" \
    -H "Content-Type: application/json" \
    -d '{"command":"plan","args":["实现 OAuth 2.1"],"context":{"session_id":"e2e-s-1"}}')
run_test "POST /api/slash-commands/execute plan" \
    "echo '$RESP' | grep -q '\"status\":\"success\"'"
run_test "返回 data.action" \
    "echo '$RESP' | grep -q '\"action\":\"open_plan_modal\"'"
run_test "返回 task 参数" \
    "echo '$RESP' | grep -q '\"task\":\"实现 OAuth 2.1\"'"

# 6.2 执行 /help
run_test "POST /execute help" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"help\"}' | grep -q '\"commands\"'"

# 6.3 执行 /new
run_test "POST /execute new" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"new\"}' | grep -q '\"action\":\"new_chat\"'"

# 6.4 执行未知命令
run_test "POST /execute unknown 返回 failed" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"xyznotexist\"}' | grep -q '\"status\":\"failed\"'"

echo ""
echo "[7] 参数验证"
# 7.1 缺少必填参数
run_test "/goal 缺少参数" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"goal\"}' | grep -q '\"status\":\"failed\"'"

# 7.2 /goal 有效
run_test "/goal 有效参数" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"goal\",\"args\":[\"实现 OAuth\"]}' | grep -q '\"status\":\"success\"'"

# 7.3 /approvals 有效
run_test "/approvals ask" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"approvals\",\"args\":[\"ask\"]}' | grep -q '\"mode\":\"ask\"'"

# 7.4 /approvals 无效模式
run_test "/approvals invalid mode" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"approvals\",\"args\":[\"invalid_mode_xyz\"]}' | grep -q '\"status\":\"failed\"'"

# 7.5 /loop 有效
run_test "/loop triage" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"loop\",\"args\":[\"triage\"]}' | grep -q '\"loop_action\":\"triage\"'"

echo ""
echo "[8] 执行历史"
# 8.1 获取历史
run_test "GET /history/list" \
    "curl -s '$BASE/api/slash-commands/history/list' | grep -q '\"history\"'"

# 8.2 清空历史
run_test "POST /history/clear" \
    "curl -s -X POST '$BASE/api/slash-commands/history/clear' | grep -q '\"success\":true'"

# 8.3 清空后再执行并查询
curl -s -X POST "$BASE/api/slash-commands/execute" \
    -H "Content-Type: application/json" \
    -d '{"command":"new"}' >/dev/null
run_test "执行后 history 包含新记录" \
    "curl -s '$BASE/api/slash-commands/history/list' | grep -q '\"command\":\"new\"'"

echo ""
echo "[9] 帮助端点"
run_test "GET /help/details" \
    "curl -s '$BASE/api/slash-commands/help/details' | grep -q '\"categories\"'"
run_test "帮助返回 18+ 命令" \
    "curl -s '$BASE/api/slash-commands/help/details' | grep -E '\"total\":(1[89]|[2-9][0-9])'"

echo ""
echo "[10] 启用/禁用"
# 10.1 禁用
run_test "PATCH /plan/toggle enabled=false" \
    "curl -s -X PATCH '$BASE/api/slash-commands/plan/toggle' \
        -H 'Content-Type: application/json' \
        -d '{\"enabled\":false}' | grep -q '已禁用'"

# 10.2 验证禁用后执行失败
run_test "禁用后 execute 失败" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"plan\"}' | grep -q '\"status\":\"failed\"'"

# 10.3 重新启用
run_test "PATCH /plan/toggle enabled=true" \
    "curl -s -X PATCH '$BASE/api/slash-commands/plan/toggle' \
        -H 'Content-Type: application/json' \
        -d '{\"enabled\":true}' | grep -q '已启用'"

# 10.4 验证启用后执行成功
run_test "启用后 execute 成功" \
    "curl -s -X POST '$BASE/api/slash-commands/execute' \
        -H 'Content-Type: application/json' \
        -d '{\"command\":\"plan\"}' | grep -q '\"status\":\"success\"'"

echo ""
echo "=== 测试结果 ==="
echo -e "  ${GREEN}通过${NC}: $PASSED"
echo -e "  ${RED}失败${NC}: $FAILED"
echo -e "  ${YELLOW}总计${NC}: $((PASSED + FAILED))"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
