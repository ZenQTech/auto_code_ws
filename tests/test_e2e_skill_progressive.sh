#!/bin/bash
# ============================================================
# Skill Progressive Disclosure E2E 测试 (Cycle 9 P1-5)
# ============================================================
# 测试范围：
#   1. 健康检查 /health
#   2. scan 端点 - 扫描并注册项目
#   3. list 端点 - 列出摘要
#   4. summaries 端点 - 仅摘要字段
#   5. by-name/{name} 端点 - 按需加载完整 skill
#   6. 路径白名单拦截
#   7. 8K cap 截断
#   8. _template 跳过逻辑
#   9. 跨项目支持
#  10. stats 端点
#  11. 注销项目
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

assert_eq() {
    local name="$1"
    local actual="$2"
    local expected="$3"
    if [[ "$actual" == "$expected" ]]; then
        PASSED=$((PASSED + 1))
        color_green "  ✓ $name"
    else
        FAILED=$((FAILED + 1))
        color_red "  ✗ $name"
        echo "    Expected: $expected"
        echo "    Actual:   $actual"
    fi
}

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
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
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

# 检查测试项目
if [[ ! -d "$TEST_PROJECT/.trae/skills" ]]; then
    color_yellow "==> 测试项目不存在，创建..."
    mkdir -p "$TEST_PROJECT/.trae/skills"
    cat > "$TEST_PROJECT/.trae/skills/code-review.md" <<'EOF'
---
name: code-review
description: 代码审查技能 - 静态分析 + 风格检查 + 最佳实践
when_to_use: 代码审查, review, 静态分析, 风格, 最佳实践, lint
model: claude-sonnet
tools:
  - read_file
  - search_code
  - propose_diff
metadata:
  category: quality
  level: senior
  languages:
    - python
    - typescript
---

# Code Review Skill

你是一位资深代码审查专家。

## 审查维度

1. 正确性
2. 可读性
3. 可维护性
EOF

    cat > "$TEST_PROJECT/.trae/skills/refactor.md" <<'EOF'
---
name: refactor
description: 代码重构技能
when_to_use: refactor, 重构
tools: [read_file, write_file]
model: claude-haiku
---

Refactor body.
EOF

    cat > "$TEST_PROJECT/.trae/skills/api-design.md" <<'EOF'
---
name: api-design
description: API 设计技能
when_to_use: api, design, rest
model: claude-sonnet
---

API design body.
EOF

    cat > "$TEST_PROJECT/.trae/skills/_template.md" <<'EOF'
---
name: _template
description: 模板 - 不应被加载
---

template
EOF

    color_green "  测试项目已创建"
fi

# ============================================================
# Test 1: 健康检查
# ============================================================
echo ""
echo "==> Test 1: 健康检查 /api/skills-progressive/health"

RESP=$(curl -s "$BASE_URL/api/skills-progressive/health")
assert_contains "health endpoint returns ok" "$RESP" '"status":"ok"'
assert_contains "health endpoint service name" "$RESP" '"service":"skills-progressive"'
assert_contains "health endpoint cycle" "$RESP" '"cycle":"9"'
assert_contains "health endpoint default_cap_bytes" "$RESP" '"default_cap_bytes":8192'

# ============================================================
# Test 2: 扫描注册
# ============================================================
echo ""
echo "==> Test 2: 扫描注册 /api/skills-progressive/scan"

# 清理之前可能存在的注册
curl -s -X DELETE "$BASE_URL/api/skills-progressive/project?project_path=$TEST_PROJECT" > /dev/null 2>&1

REQ_BODY=$(printf '{"project_path":"%s","cap_bytes":8192}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "scan returns success" "$RESP" '"success":true'
assert_contains "scan action field" "$RESP" '"action":"scan"'
assert_contains "scan includes code-review" "$RESP" '"name":"code-review"'
assert_contains "scan includes refactor" "$RESP" '"name":"refactor"'
assert_contains "scan includes api-design" "$RESP" '"name":"api-design"'
# _template 不应被加载
if [[ "$RESP" == *'"name":"_template"'* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ scan 应当排除 _template.md"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ scan 正确排除了 _template.md"
fi

# ============================================================
# Test 3: 列出已注册摘要
# ============================================================
echo ""
echo "==> Test 3: 列出摘要 /api/skills-progressive/list"

RESP=$(curl -s "$BASE_URL/api/skills-progressive/list?project_path=$TEST_PROJECT")
assert_contains "list success" "$RESP" '"success":true'
assert_contains "list code-review" "$RESP" '"name":"code-review"'
assert_contains "list refactor" "$RESP" '"name":"refactor"'

# ============================================================
# Test 4: 仅摘要字段（轻量）
# ============================================================
echo ""
echo "==> Test 4: 仅摘要字段 /api/skills-progressive/summaries"

RESP=$(curl -s "$BASE_URL/api/skills-progressive/summaries?project_path=$TEST_PROJECT")
assert_contains "summaries success" "$RESP" '"success":true'
assert_contains "summaries includes code-review" "$RESP" '"name":"code-review"'
# summaries 端点不应返回 body / tools / model
if [[ "$RESP" == *'"body"'* ]] || [[ "$RESP" == *'"tools"'* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ summaries 端点不应返回 body/tools 字段"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ summaries 端点正确仅返回摘要字段"
fi

# ============================================================
# Test 5: 按需加载完整 skill
# ============================================================
echo ""
echo "==> Test 5: 按需加载完整 skill /api/skills-progressive/by-name/code-review"

RESP=$(curl -s "$BASE_URL/api/skills-progressive/by-name/code-review?project_path=$TEST_PROJECT")
assert_contains "load full success" "$RESP" '"success":true'
assert_contains "load full action" "$RESP" '"action":"get_full"'
assert_contains "load full name" "$RESP" '"name":"code-review"'
assert_contains "load full body" "$RESP" '"body"'
assert_contains "load full tools" "$RESP" '"read_file"'
assert_contains "load full model" "$RESP" '"claude-sonnet"'
assert_contains "load full metadata category" "$RESP" '"category":"quality"'

# ============================================================
# Test 6: 加载不存在的 skill
# ============================================================
echo ""
echo "==> Test 6: 加载不存在的 skill (404)"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE_URL/api/skills-progressive/by-name/nonexistent-skill?project_path=$TEST_PROJECT")
assert_status "load nonexistent returns 404" "$STATUS" "404"

# ============================================================
# Test 7: 路径白名单拦截
# ============================================================
echo ""
echo "==> Test 7: 路径白名单拦截"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d '{"project_path":"/etc/passwd","cap_bytes":8192}')
assert_status "scan with /etc/passwd returns 403" "$STATUS" "403"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d '{"project_path":"/root/secret","cap_bytes":8192}')
assert_status "scan with /root/secret returns 403" "$STATUS" "403"

# ============================================================
# Test 8: 非法 skill 名称
# ============================================================
echo ""
echo "==> Test 8: 非法 skill 名称"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$BASE_URL/api/skills-progressive/by-name/..%2Fetc%2Fpasswd?project_path=$TEST_PROJECT")
# URL 编码的 ..%2F 会被反编码为 ../，被校验拦截
# 实际可能返回 400 或 404
if [[ "$STATUS" == "400" ]] || [[ "$STATUS" == "404" ]] || [[ "$STATUS" == "403" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 非法名称被拦截 (status=$STATUS)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 非法名称应被拦截 (status=$STATUS)"
fi

# ============================================================
# Test 9: 8K cap 截断
# ============================================================
echo ""
echo "==> Test 9: 8K cap 截断"

# 测试项目实际包含 4 个 skill (code-review/refactor/api-design/debugging)，
# _template 会被自动排除。使用 cap=100 强制触发截断。
REQ_BODY=$(printf '{"project_path":"%s","cap_bytes":100}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
# 截断后已注册数量应 < 完整数量 4
assert_contains "scan with cap 100 success" "$RESP" '"success":true'
# 提取 registered 数字
REGISTERED=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('registered',0))")
# 至少会注册第一个（< cap），所以 registered >= 1
if [[ "$REGISTERED" -ge 1 ]] && [[ "$REGISTERED" -lt 4 ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 8K cap 截断生效 (registered=$REGISTERED, 1 <= x < 4)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 8K cap 截断未生效 (registered=$REGISTERED, expected 1<=x<4)"
fi

# 验证 8K 默认值不被截断（应注册全部 4 个 skill，_template 正确排除）
REQ_BODY=$(printf '{"project_path":"%s","cap_bytes":8192}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
REGISTERED_FULL=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('registered',0))")
if [[ "$REGISTERED_FULL" -eq 4 ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ 8K cap 默认值注册全部 4 个 skill (_template 正确排除)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ 8K cap 默认值应注册 4 个 skill (registered=$REGISTERED_FULL)"
fi

# ============================================================
# Test 10: stats 端点
# ============================================================
echo ""
echo "==> Test 10: stats 端点"

RESP=$(curl -s "$BASE_URL/api/skills-progressive/stats")
assert_contains "stats success" "$RESP" '"success":true'
assert_contains "stats has projects" "$RESP" '"projects"'
assert_contains "stats has skills" "$RESP" '"skills"'

# ============================================================
# Test 11: 注销项目
# ============================================================
echo ""
echo "==> Test 11: 注销项目"

RESP=$(curl -s -X DELETE "$BASE_URL/api/skills-progressive/project?project_path=$TEST_PROJECT")
assert_contains "unregister success" "$RESP" '"success":true'
assert_contains "unregister action" "$RESP" '"action":"unregister"'
assert_contains "unregistered flag" "$RESP" '"unregistered":true'

# 注销后再列出应该为空
RESP=$(curl -s "$BASE_URL/api/skills-progressive/list?project_path=$TEST_PROJECT")
assert_contains "list after unregister has count 0" "$RESP" '"count":0'

# 再次注销应该返回 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "$BASE_URL/api/skills-progressive/project?project_path=$TEST_PROJECT")
assert_status "double unregister returns 404" "$STATUS" "404"

# 重新注册以便后续测试可用
REQ_BODY=$(printf '{"project_path":"%s","cap_bytes":8192}' "$TEST_PROJECT")
curl -s -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY" > /dev/null

# ============================================================
# Test 12: 完整工作流
# ============================================================
echo ""
echo "==> Test 12: 完整工作流 (scan -> list -> summaries -> by-name -> stats -> unregister)"

# 1. 注销
curl -s -X DELETE "$BASE_URL/api/skills-progressive/project?project_path=$TEST_PROJECT" > /dev/null 2>&1

# 2. scan
REQ_BODY=$(printf '{"project_path":"%s","cap_bytes":8192}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/skills-progressive/scan" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "workflow scan" "$RESP" '"success":true'

# 3. list
RESP=$(curl -s "$BASE_URL/api/skills-progressive/list?project_path=$TEST_PROJECT")
assert_contains "workflow list" "$RESP" '"name":"code-review"'

# 4. summaries
RESP=$(curl -s "$BASE_URL/api/skills-progressive/summaries?project_path=$TEST_PROJECT")
assert_contains "workflow summaries" "$RESP" '"name":"refactor"'

# 5. by-name
RESP=$(curl -s "$BASE_URL/api/skills-progressive/by-name/api-design?project_path=$TEST_PROJECT")
assert_contains "workflow by-name" "$RESP" '"name":"api-design"'

# 6. stats
RESP=$(curl -s "$BASE_URL/api/skills-progressive/stats")
assert_contains "workflow stats" "$RESP" '"success":true'

# 7. unregister
RESP=$(curl -s -X DELETE "$BASE_URL/api/skills-progressive/project?project_path=$TEST_PROJECT")
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
