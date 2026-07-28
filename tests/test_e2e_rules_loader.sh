#!/bin/bash
# ============================================================
# .trae/rules/ Multi-Level Loader E2E 测试 (Cycle 9 P1-6)
# ============================================================
# 测试范围：
#   1. 健康检查 /health
#   2. scan 端点 - 扫描并注册
#   3. list 端点 - 列出规则
#   4. categories 端点 - 列出分类
#   5. by-name/{name} 端点 - 按需加载
#   6. by-category/{category} 端点 - 按分类加载
#   7. 路径白名单拦截
#   8. 非法名称拦截
#   9. _template 跳过
#  10. 优先级排序
#  11. 跨项目支持
#  12. stats 端点
#  13. 注销项目
#  14. 完整工作流
# 目标：≥4 个 E2E 测试用例
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TEST_PROJECT="/tmp/test-projects/sample-trae-project"

PASSED=0
FAILED=0

color_red() { echo -e "\033[31m$*\033[0m"; }
color_green() { echo -e "\033[32m$*\033[0m"; }
color_blue() { echo -e "\033[34m$*\033[0m"; }
color_yellow() { echo -e "\033[33m$*\033[0m"; }

assert_contains() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    if [[ "$actual" == *"$expected"* ]]; then
        PASSED=$((PASSED + 1))
        color_green "  ✓ $name"
    else
        FAILED=$((FAILED + 1))
        color_red "  ✗ $name"
        echo "    Expected to contain: $expected"
        echo "    Actual:              $actual"
    fi
}

assert_status() {
    local name="$1"
    local actual_status="$2"
    local expected_status="$3"
    if [[ "$actual_status" == "$expected_status" ]]; then
        PASSED=$((PASSED + 1))
        color_green "  ✓ $name (status=$actual_status)"
    else
        FAILED=$((FAILED + 1))
        color_red "  ✗ $name (expected $expected_status, got $actual_status)"
    fi
}

# 等待服务启动
echo "==> 等待 backend 服务启动..."
READY=0
for i in {1..30}; do
    if curl -s "$BASE_URL/api/trae-rules/health" > /dev/null 2>&1; then
        color_green "  服务已就绪"
        READY=1
        break
    fi
    sleep 1
done

if [[ $READY -eq 0 ]]; then
    color_red "  ✗ 服务未启动"
    exit 1
fi

# 创建测试规则（如果不存在）
if [[ ! -d "$TEST_PROJECT/.trae/rules" ]]; then
    color_yellow "==> 创建测试规则..."
    mkdir -p "$TEST_PROJECT/.trae/rules/python/testing"
    mkdir -p "$TEST_PROJECT/.trae/rules/typescript/react"
    mkdir -p "$TEST_PROJECT/.trae/rules/security"
fi

# ============================================================
# Test 1: 健康检查
# ============================================================
echo ""
echo "==> Test 1: 健康检查 /api/trae-rules/health"

RESP=$(curl -s "$BASE_URL/api/trae-rules/health")
assert_contains "health returns ok" "$RESP" '"status":"ok"'
assert_contains "health service name" "$RESP" '"service":"trae-rules-loader"'
assert_contains "health cycle" "$RESP" '"cycle":"9"'
assert_contains "health max_category_depth" "$RESP" '"max_category_depth":3'

# ============================================================
# Test 2: 扫描注册
# ============================================================
echo ""
echo "==> Test 2: 扫描注册 /api/trae-rules/scan"

# 清理之前可能存在的注册
curl -s -X DELETE "$BASE_URL/api/trae-rules/project?project_path=$TEST_PROJECT" > /dev/null 2>&1

REQ_BODY=$(printf '{"project_path":"%s","max_depth":3}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/trae-rules/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "scan returns success" "$RESP" '"success":true'
assert_contains "scan action field" "$RESP" '"action":"scan"'
assert_contains "scan includes python-style" "$RESP" '"name":"python-style"'
assert_contains "scan includes python-typing" "$RESP" '"name":"python-typing"'
assert_contains "scan includes pytest" "$RESP" '"name":"pytest-best-practices"'
assert_contains "scan includes react-hooks" "$RESP" '"name":"react-hooks"'
assert_contains "scan includes input-validation" "$RESP" '"name":"security-input-validation"'
# _template 不应被加载
if [[ "$RESP" == *'"name":"_template"'* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ scan 应当排除 _template.md"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ scan 正确排除了 _template.md"
fi
# 类别应包含多级嵌套
assert_contains "scan category python" "$RESP" '"category":"python"'
assert_contains "scan category python/testing" "$RESP" '"category":"python/testing"'

# ============================================================
# Test 3: 列出规则
# ============================================================
echo ""
echo "==> Test 3: 列出规则 /api/trae-rules/list"

RESP=$(curl -s "$BASE_URL/api/trae-rules/list?project_path=$TEST_PROJECT&summary_only=true")
assert_contains "list success" "$RESP" '"success":true'
assert_contains "list includes python-style" "$RESP" '"name":"python-style"'
# summary_only=true 时不应包含 content
if [[ "$RESP" == *'"content"'* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ list summary_only=true 不应包含 content"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ list summary_only=true 正确排除 content"
fi

# ============================================================
# Test 4: 列出分类
# ============================================================
echo ""
echo "==> Test 4: 列出分类 /api/trae-rules/categories"

RESP=$(curl -s "$BASE_URL/api/trae-rules/categories?project_path=$TEST_PROJECT")
assert_contains "categories success" "$RESP" '"success":true'
assert_contains "categories includes python" "$RESP" '"name":"python"'
assert_contains "categories includes python/testing" "$RESP" '"name":"python/testing"'
assert_contains "categories includes typescript/react" "$RESP" '"name":"typescript/react"'
assert_contains "categories includes security" "$RESP" '"name":"security"'

# ============================================================
# Test 5: 按 name 加载
# ============================================================
echo ""
echo "==> Test 5: 按 name 加载 /api/trae-rules/by-name/python-style"

RESP=$(curl -s "$BASE_URL/api/trae-rules/by-name/python-style?project_path=$TEST_PROJECT")
assert_contains "by-name success" "$RESP" '"success":true'
assert_contains "by-name action" "$RESP" '"action":"get_full"'
assert_contains "by-name name" "$RESP" '"name":"python-style"'
assert_contains "by-name category" "$RESP" '"category":"python"'
assert_contains "by-name content" "$RESP" '"content"'
assert_contains "by-name priority" "$RESP" '"priority":80'

# ============================================================
# Test 6: 按 category 加载
# ============================================================
echo ""
echo "==> Test 6: 按 category 加载 /api/trae-rules/by-category/python/testing"

RESP=$(curl -s "$BASE_URL/api/trae-rules/by-category/python/testing?project_path=$TEST_PROJECT")
assert_contains "by-category success" "$RESP" '"success":true'
assert_contains "by-category action" "$RESP" '"action":"by_category"'
assert_contains "by-category category" "$RESP" '"category":"python/testing"'
assert_contains "by-category includes pytest" "$RESP" '"name":"pytest-best-practices"'
# 不应包含其他 category
if [[ "$RESP" == *'"name":"python-style"'* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ by-category 不应包含其他 category 的规则"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ by-category 正确过滤其他 category"
fi

# ============================================================
# Test 7: 路径白名单拦截
# ============================================================
echo ""
echo "==> Test 7: 路径白名单拦截"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/trae-rules/scan" \
    -H "Content-Type: application/json" \
    -d '{"project_path":"/etc/passwd","max_depth":3}')
assert_status "scan /etc/passwd returns 403" "$STATUS" "403"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/trae-rules/scan" \
    -H "Content-Type: application/json" \
    -d '{"project_path":"/root/secret","max_depth":3}')
assert_status "scan /root/secret returns 403" "$STATUS" "403"

# ============================================================
# Test 8: 非法规则名称
# ============================================================
echo ""
echo "==> Test 8: 非法规则名称"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE_URL/api/trae-rules/by-name/..%2Fetc%2Fpasswd?project_path=$TEST_PROJECT")
# URL 解码后是 ../etc/passwd，被名称校验拦截
if [[ "$STATUS" == "400" ]] || [[ "$STATUS" == "404" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 路径遍历被拦截 (status=$STATUS)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 路径遍历应被拦截 (status=$STATUS)"
fi

# ============================================================
# Test 9: 加载不存在的规则
# ============================================================
echo ""
echo "==> Test 9: 加载不存在的规则 (404)"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE_URL/api/trae-rules/by-name/nonexistent-rule?project_path=$TEST_PROJECT")
assert_status "load nonexistent returns 404" "$STATUS" "404"

# ============================================================
# Test 10: 优先级排序
# ============================================================
echo ""
echo "==> Test 10: 优先级排序（高优先级在前）"

RESP=$(curl -s "$BASE_URL/api/trae-rules/list?project_path=$TEST_PROJECT&summary_only=true")
# 第一个规则应是 priority=95 (security-input-validation)
FIRST_PRIORITY=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); rules=d.get('data',{}).get('rules',[]); print(rules[0].get('priority', 0) if rules else 0)")
if [[ "$FIRST_PRIORITY" -eq 95 ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 优先级排序正确（第一个 priority=$FIRST_PRIORITY）"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 优先级排序错误（第一个 priority=$FIRST_PRIORITY, expected 95）"
fi

# ============================================================
# Test 11: stats 端点
# ============================================================
echo ""
echo "==> Test 11: stats 端点"

RESP=$(curl -s "$BASE_URL/api/trae-rules/stats")
assert_contains "stats success" "$RESP" '"success":true'
assert_contains "stats has projects" "$RESP" '"projects"'
assert_contains "stats has rules" "$RESP" '"rules"'
assert_contains "stats has categories" "$RESP" '"categories"'

# ============================================================
# Test 12: 注销项目
# ============================================================
echo ""
echo "==> Test 12: 注销项目"

RESP=$(curl -s -X DELETE "$BASE_URL/api/trae-rules/project?project_path=$TEST_PROJECT")
assert_contains "unregister success" "$RESP" '"success":true'
assert_contains "unregister action" "$RESP" '"action":"unregister"'
assert_contains "unregistered flag" "$RESP" '"unregistered":true'

# 注销后再列出应该为空
RESP=$(curl -s "$BASE_URL/api/trae-rules/list?project_path=$TEST_PROJECT")
assert_contains "list after unregister count 0" "$RESP" '"count":0'

# 再次注销应该返回 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "$BASE_URL/api/trae-rules/project?project_path=$TEST_PROJECT")
assert_status "double unregister returns 404" "$STATUS" "404"

# 重新注册以便后续测试
curl -s -X POST "$BASE_URL/api/trae-rules/scan" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"project_path":"%s","max_depth":3}' "$TEST_PROJECT")" > /dev/null

# ============================================================
# Test 13: 完整工作流
# ============================================================
echo ""
echo "==> Test 13: 完整工作流 (scan -> list -> categories -> by-name -> by-category -> stats -> unregister)"

# 1. unregister
curl -s -X DELETE "$BASE_URL/api/trae-rules/project?project_path=$TEST_PROJECT" > /dev/null 2>&1

# 2. scan
REQ_BODY=$(printf '{"project_path":"%s","max_depth":3}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/trae-rules/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "workflow scan" "$RESP" '"success":true'

# 3. list
RESP=$(curl -s "$BASE_URL/api/trae-rules/list?project_path=$TEST_PROJECT")
assert_contains "workflow list" "$RESP" '"name":"python-style"'

# 4. categories
RESP=$(curl -s "$BASE_URL/api/trae-rules/categories?project_path=$TEST_PROJECT")
assert_contains "workflow categories" "$RESP" '"name":"python/testing"'

# 5. by-name
RESP=$(curl -s "$BASE_URL/api/trae-rules/by-name/react-hooks?project_path=$TEST_PROJECT")
assert_contains "workflow by-name" "$RESP" '"name":"react-hooks"'

# 6. by-category
RESP=$(curl -s "$BASE_URL/api/trae-rules/by-category/security?project_path=$TEST_PROJECT")
assert_contains "workflow by-category" "$RESP" '"name":"security-input-validation"'

# 7. stats
RESP=$(curl -s "$BASE_URL/api/trae-rules/stats")
assert_contains "workflow stats" "$RESP" '"success":true'

# 8. unregister
RESP=$(curl -s -X DELETE "$BASE_URL/api/trae-rules/project?project_path=$TEST_PROJECT")
assert_contains "workflow unregister" "$RESP" '"success":true'

# ============================================================
# 总结
# ============================================================
echo ""
echo "=========================================="
echo "  测试结果: PASSED=$PASSED, FAILED=$FAILED"
echo "=========================================="

if [[ $FAILED -gt 0 ]]; then
    color_red "  ❌ 部分 E2E 测试失败"
    exit 1
else
    color_green "  ✅ 所有 E2E 测试通过"
    exit 0
fi
