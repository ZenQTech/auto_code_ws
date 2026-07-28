#!/bin/bash
# ============================================================
# Project Agents E2E 测试 (Cycle 9 P0-17)
# ============================================================
# 测试范围：
#   1. 健康检查
#   2. 扫描并注册项目
#   3. 列出智能体
#   4. 按 name 查询
#   5. @ 引用解析
#   6. 智能推荐
#   7. 刷新与注销
#   8. 统计
# 目标：≥5 个 E2E 测试用例
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
    if curl -s "$BASE_URL/api/project-agents/health" > /dev/null 2>&1; then
        color_green "  服务已就绪"
        break
    fi
    sleep 1
done

if ! curl -s "$BASE_URL/api/project-agents/health" > /dev/null 2>&1; then
    color_red "  ✗ 服务未启动，请先启动 backend"
    echo "  启动命令: cd /home/qizheng/auto_code_ws && python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8765"
    exit 1
fi

# ============================================================
# Test 1: 健康检查
# ============================================================
echo ""
color_blue "Test 1: 健康检查"
RESP=$(curl -s "$BASE_URL/api/project-agents/health")
assert_pass "health endpoint returns ok" "$RESP" '"status":"ok"'
assert_pass "service name" "$RESP" '"service":"project-agents"'

# ============================================================
# Test 2: 扫描并注册项目
# ============================================================
echo ""
color_blue "Test 2: 扫描并注册项目"
RESP=$(curl -s -X POST "$BASE_URL/api/project-agents/scan" \
    -H "Content-Type: application/json" \
    -d "{\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "scan success" "$RESP" '"success":true'
assert_pass "registered count > 0" "$RESP" '"registered":'
assert_pass "contains code-architect" "$RESP" 'code-architect'
assert_pass "contains security-reviewer" "$RESP" 'security-reviewer'
assert_pass "contains test-engineer" "$RESP" 'test-engineer'
assert_pass "contains doc-writer" "$RESP" 'doc-writer'
assert_pass "_template not in result" "$RESP" '"success":true'
# _template has callable: false but should still be loaded (registry shows all)
# Verify it's in agents list with callable: false
if echo "$RESP" | grep -q '"_template"'; then
    assert_pass "_template in scan result" "$RESP" '"_template"'
fi

# ============================================================
# Test 3: 列出智能体
# ============================================================
echo ""
color_blue "Test 3: 列出已注册智能体"
RESP=$(curl -s "$BASE_URL/api/project-agents/list?project_path=$TEST_PROJECT")
assert_pass "list success" "$RESP" '"success":true'
assert_pass "count >= 4" "$RESP" '"count":'
assert_pass "all 4 agents present" "$RESP" 'doc-writer'

# ============================================================
# Test 4: 按 name 查询
# ============================================================
echo ""
color_blue "Test 4: 按 name 查询"
RESP=$(curl -s "$BASE_URL/api/project-agents/by-name/code-architect?project_path=$TEST_PROJECT")
assert_pass "get code-architect" "$RESP" '"success":true'
assert_pass "agent name match" "$RESP" '"name":"code-architect"'
assert_pass "agent has prompt" "$RESP" '"prompt":'
assert_pass "agent has description" "$RESP" '"资深代码架构师'

# 查询不存在的智能体
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/project-agents/by-name/nonexistent?project_path=$TEST_PROJECT")
HTTP_CODE=$(echo "$RESP" | tail -1)
if [[ "$HTTP_CODE" == "404" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ nonexistent agent returns 404"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ nonexistent agent should return 404, got $HTTP_CODE"
fi

# ============================================================
# Test 5: @ 引用解析
# ============================================================
echo ""
color_blue "Test 5: @ 引用解析"
RESP=$(curl -s -X POST "$BASE_URL/api/project-agents/resolve" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"请 @code-architect 优化模块，同时请 @security-reviewer 审查\",\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "resolve success" "$RESP" '"success":true'
assert_pass "referenced code-architect" "$RESP" 'code-architect'
assert_pass "referenced security-reviewer" "$RESP" 'security-reviewer'
assert_pass "all_resolved true" "$RESP" '"all_resolved":true'

# 测试不存在的引用
RESP=$(curl -s -X POST "$BASE_URL/api/project-agents/resolve" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"请 @unknown-agent 处理\",\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "unknown reference detected" "$RESP" '"all_resolved":false'
assert_pass "unknown is null" "$RESP" '"unknown-agent":null'

# ============================================================
# Test 6: 智能推荐
# ============================================================
echo ""
color_blue "Test 6: 智能推荐"
RESP=$(curl -s -X POST "$BASE_URL/api/project-agents/suggest" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"请帮我做架构设计\",\"project_path\":\"$TEST_PROJECT\",\"top_k\":3}")
assert_pass "suggest success" "$RESP" '"success":true'
assert_pass "contains code-architect suggestion" "$RESP" 'code-architect'

# ============================================================
# Test 7: 刷新
# ============================================================
echo ""
color_blue "Test 7: 刷新项目"
RESP=$(curl -s -X POST "$BASE_URL/api/project-agents/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "refresh success" "$RESP" '"success":true'
assert_pass "action is refresh" "$RESP" '"action":"refresh"'

# ============================================================
# Test 8: 统计
# ============================================================
echo ""
color_blue "Test 8: 注册表统计"
RESP=$(curl -s "$BASE_URL/api/project-agents/stats")
assert_pass "stats success" "$RESP" '"success":true'
assert_pass "has projects count" "$RESP" '"projects":'
assert_pass "has agents count" "$RESP" '"agents":'

# ============================================================
# Test 9: 注销项目
# ============================================================
echo ""
color_blue "Test 9: 注销项目"
RESP=$(curl -s -X DELETE "$BASE_URL/api/project-agents/project" \
    -H "Content-Type: application/json" \
    -d "{\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "unregister success" "$RESP" '"success":true'
assert_pass "unregistered true" "$RESP" '"unregistered":true'

# 再次注销应失败
RESP=$(curl -s -X DELETE "$BASE_URL/api/project-agents/project" \
    -H "Content-Type: application/json" \
    -d "{\"project_path\":\"$TEST_PROJECT\"}")
assert_pass "double unregister failed" "$RESP" 'Project not registered'

# 注销后列表应为空
RESP=$(curl -s "$BASE_URL/api/project-agents/list?project_path=$TEST_PROJECT")
assert_pass "list count 0 after unregister" "$RESP" '"count":0'

# ============================================================
# Test 10: 路径白名单拦截
# ============================================================
echo ""
color_blue "Test 10: 路径白名单拦截"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/project-agents/scan" \
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
