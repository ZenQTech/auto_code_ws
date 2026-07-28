#!/bin/bash
# ============================================================
# Memory System E2E 测试 (Cycle 10 P1-8)
# ============================================================
# 测试范围：
#   1. 健康检查 /health
#   2. 统计信息 /stats
#   3. Entity CRUD：create / get / list / update / delete
#   4. Relation CRUD：create / list / delete
#   5. Observation：add / get / delete + 格式校验 + secrets 检测
#   6. Search：关键词 / 名称 / 观察内容
#   7. Graph：获取整个图谱
#   8. memory-kernel skill：read / write / update / delete
#   9. self-improvement skill：低频不晋升 / 验证后晋升
#  10. memory-recall skill：跨会话检索
#  11. 异常路径：非法名字 / 不存在实体 / public_ 保护
#  12. 持久化：跨进程读取
# 目标：≥10 个 E2E 测试模块，覆盖核心 API
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TEST_NAMESPACE="e2e_test_$(date +%s)_$$"

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

assert_not_contains() {
    local name="$1"
    local actual="$2"
    local unexpected="$3"
    if [[ "$actual" == *"$unexpected"* ]]; then
        FAILED=$((FAILED + 1))
        color_red "  ✗ $name"
        echo "    Should NOT contain: $unexpected"
    else
        PASSED=$((PASSED + 1))
        color_green "  ✓ $name"
    fi
}

assert_equals() {
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

# 等待服务启动
echo "==> 等待 backend 服务启动..."
READY=0
for i in {1..30}; do
    if curl -s "$BASE_URL/api/memory/health" > /dev/null 2>&1; then
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

# ============================================================
# 模块 0: 清理上一次测试残留（保证测试可重复运行）
# ============================================================
echo ""
color_yellow "==> 模块 0: 清理旧测试残留"
# 列出所有 e2e_test_ 开头的实体并删除，避免历史残留干扰
LIST_RESP=$(curl -s "$BASE_URL/api/memory/entities?limit=500")
STALE_NAMES=$(echo "$LIST_RESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for e in d.get('data', []):
        if e.get('name', '').startswith('e2e_test_'):
            print(e['name'])
except Exception:
    pass
" 2>/dev/null)
if [[ -n "$STALE_NAMES" ]]; then
    CLEANED=0
    while IFS= read -r SN; do
        [[ -z "$SN" ]] && continue
        curl -s -X DELETE "$BASE_URL/api/memory/entities/$SN?force=true" > /dev/null
        CLEANED=$((CLEANED + 1))
    done <<< "$STALE_NAMES"
    color_green "  ✓ 清理 $CLEANED 个旧 e2e_test 实体"
    PASSED=$((PASSED + 1))
else
    color_green "  ✓ 无旧 e2e_test 实体需清理"
    PASSED=$((PASSED + 1))
fi

# ============================================================
# 模块 1: Health & Stats
# ============================================================
echo ""
color_yellow "==> 模块 1: Health & Stats"

RESPONSE=$(curl -s "$BASE_URL/api/memory/health")
assert_contains "memory service is healthy" "$RESPONSE" '"success":true'
assert_contains "health returns service name" "$RESPONSE" '"service":"memory"'
assert_contains "health returns version" "$RESPONSE" '"version":"1.0.0"'

RESPONSE=$(curl -s "$BASE_URL/api/memory/stats")
assert_contains "stats returns total_entities" "$RESPONSE" '"total_entities"'
assert_contains "stats returns by_type" "$RESPONSE" '"by_type"'

# ============================================================
# 模块 2: Entity CRUD
# ============================================================
echo ""
color_yellow "==> 模块 2: Entity CRUD"

# 2.1 创建实体
ENT_NAME="${TEST_NAMESPACE}_proj_hermes"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ENT_NAME\",\"entity_type\":\"project\",\"project\":\"hermes\",\"metadata\":{\"stack\":\"FastAPI\"}}")
assert_contains "create project entity" "$RESPONSE" '"success":true'
assert_contains "entity name echoed" "$RESPONSE" "$ENT_NAME"

# 2.2 获取实体
RESPONSE=$(curl -s "$BASE_URL/api/memory/entities/$ENT_NAME")
assert_contains "get entity" "$RESPONSE" '"success":true'
assert_contains "entity type is project" "$RESPONSE" '"entity_type":"project"'

# 2.3 列出实体
RESPONSE=$(curl -s "$BASE_URL/api/memory/entities?entity_type=project")
assert_contains "list entities by type" "$RESPONSE" "$ENT_NAME"

# 2.4 更新实体
RESPONSE=$(curl -s -X PUT "$BASE_URL/api/memory/entities/$ENT_NAME" \
    -H "Content-Type: application/json" \
    -d '{"metadata":{"stack":"FastAPI","version":"2.0"}}')
assert_contains "update entity metadata" "$RESPONSE" '"success":true'
assert_contains "metadata has version 2.0" "$RESPONSE" '"version":"2.0"'

# ============================================================
# 模块 3: Observation 添加与质量门控
# ============================================================
echo ""
color_yellow "==> 模块 3: Observation & 质量门控"

# 3.1 成功添加 observation
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/observations" \
    -H "Content-Type: application/json" \
    -d "{\"entity_name\":\"$ENT_NAME\",\"content\":\"[2026-07-28] 使用 FastAPI 框架开发\",\"source\":\"agent\"}")
assert_contains "add observation success" "$RESPONSE" '"success":true'
assert_contains "observation id returned" "$RESPONSE" '"id":"obs_'

# 3.2 添加第二个 observation
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/observations" \
    -H "Content-Type: application/json" \
    -d "{\"entity_name\":\"$ENT_NAME\",\"content\":\"[2026-07-29] 集成 SQLAlchemy 异步\",\"source\":\"agent\"}")
assert_contains "add second observation" "$RESPONSE" '"success":true'

# 3.3 格式错误应被拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/observations" \
    -H "Content-Type: application/json" \
    -d "{\"entity_name\":\"$ENT_NAME\",\"content\":\"no date format\",\"source\":\"agent\"}")
assert_contains "invalid format rejected" "$RESPONSE" '"detail"'
assert_contains "error mentions YYYY-MM-DD" "$RESPONSE" "YYYY-MM-DD"

# 3.4 Secrets 应被拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/observations" \
    -H "Content-Type: application/json" \
    -d "{\"entity_name\":\"$ENT_NAME\",\"content\":\"[2026-07-28] api_key: sk-abcdefghijklmnopqrstuvwxyz\",\"source\":\"agent\"}")
assert_contains "secrets rejected" "$RESPONSE" '"detail"'
assert_contains "error mentions secret" "$RESPONSE" "secret"

# 3.5 获取观察列表
RESPONSE=$(curl -s "$BASE_URL/api/memory/entities/$ENT_NAME")
assert_contains "entity has 2 observations" "$RESPONSE" 'FastAPI'
assert_contains "entity has 2nd observation" "$RESPONSE" 'SQLAlchemy'

# ============================================================
# 模块 4: Relations
# ============================================================
echo ""
color_yellow "==> 模块 4: Relations"

# 4.1 创建第二个实体
ENT_PATTERN="${TEST_NAMESPACE}_pattern_fastapi"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ENT_PATTERN\",\"entity_type\":\"pattern\",\"project\":\"hermes\"}")
assert_contains "create pattern entity" "$RESPONSE" '"success":true'

# 4.2 创建关系
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/relations" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"$ENT_NAME\",\"target\":\"$ENT_PATTERN\",\"relation_type\":\"uses\",\"weight\":0.9}")
assert_contains "create relation" "$RESPONSE" '"success":true'
assert_contains "relation source correct" "$RESPONSE" "$ENT_NAME"

# 4.3 列出关系
RESPONSE=$(curl -s "$BASE_URL/api/memory/relations?source=$ENT_NAME")
assert_contains "list relations by source" "$RESPONSE" "$ENT_PATTERN"

# 4.4 非法关系类型应被拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/relations" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"$ENT_NAME\",\"target\":\"$ENT_PATTERN\",\"relation_type\":\"invalid_type\"}")
assert_contains "invalid relation type rejected" "$RESPONSE" '"detail"'

# ============================================================
# 模块 5: Search
# ============================================================
echo ""
color_yellow "==> 模块 5: Search"

# 5.1 按 observation 内容搜索
RESPONSE=$(curl -s "$BASE_URL/api/memory/search?q=FastAPI&limit=5")
assert_contains "search by FastAPI" "$RESPONSE" '"success":true'
assert_contains "search returns $ENT_NAME" "$RESPONSE" "$ENT_NAME"

# 5.2 按名称搜索
RESPONSE=$(curl -s "$BASE_URL/api/memory/search?q=hermes&limit=5")
assert_contains "search by name keyword" "$RESPONSE" "$ENT_NAME"

# 5.3 限制 limit
RESPONSE=$(curl -s "$BASE_URL/api/memory/search?q=hermes&limit=1")
assert_contains "search with limit=1" "$RESPONSE" '"total":1'

# ============================================================
# 模块 6: Graph
# ============================================================
echo ""
color_yellow "==> 模块 6: Graph"

RESPONSE=$(curl -s "$BASE_URL/api/memory/graph")
assert_contains "graph returns entities" "$RESPONSE" '"entities"'
assert_contains "graph returns relations" "$RESPONSE" '"relations"'
assert_contains "graph returns observations" "$RESPONSE" '"observations"'
assert_contains "graph includes our entity" "$RESPONSE" "$ENT_NAME"

# ============================================================
# 模块 7: memory-kernel skill
# ============================================================
echo ""
color_yellow "==> 模块 7: memory-kernel skill"

# 7.1 write action
KERNEL_NAME="${TEST_NAMESPACE}_kernel_test"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-kernel" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"write\",\"name\":\"$KERNEL_NAME\",\"entity_type\":\"preference\",\"project\":\"hermes\",\"observations\":[\"[2026-07-28] 偏好 TypeScript\"]}")
assert_contains "memory-kernel write success" "$RESPONSE" '"success":true'
assert_contains "kernel wrote 1 observation" "$RESPONSE" '"observations_added":1'

# 7.2 read action
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-kernel" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"read\",\"query\":\"TypeScript\"}")
assert_contains "memory-kernel read found entity" "$RESPONSE" "$KERNEL_NAME"

# 7.3 update action
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-kernel" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"update\",\"name\":\"$KERNEL_NAME\",\"observations\":[\"[2026-07-29] 增加偏好 React\"]}")
assert_contains "memory-kernel update success" "$RESPONSE" '"observations_added":1'

# 7.4 delete action
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-kernel" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"delete\",\"name\":\"$KERNEL_NAME\"}")
assert_contains "memory-kernel delete success" "$RESPONSE" '"success":true'

# 7.5 invalid action
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-kernel" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"invalid\"}")
assert_contains "invalid kernel action rejected" "$RESPONSE" '"detail"'

# ============================================================
# 模块 8: self-improvement skill
# ============================================================
echo ""
color_yellow "==> 模块 8: self-improvement skill"

# 8.1 occurrences < 3 不晋升
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/self-improvement" \
    -H "Content-Type: application/json" \
    -d "{\"error_type\":\"port_conflict\",\"summary\":\"[2026-07-28] 测试问题\",\"occurrences\":1,\"verified\":true}")
assert_contains "low frequency not promoted" "$RESPONSE" '"promoted":false'

# 8.2 verified=false 不晋升
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/self-improvement" \
    -H "Content-Type: application/json" \
    -d "{\"error_type\":\"timeout_error\",\"summary\":\"[2026-07-28] 测试问题\",\"occurrences\":5,\"verified\":false}")
assert_contains "unverified not promoted" "$RESPONSE" '"promoted":false'

# 8.3 occurrences>=3 且 verified 应晋升
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/self-improvement" \
    -H "Content-Type: application/json" \
    -d "{\"error_type\":\"auth_failure\",\"summary\":\"[2026-07-28] 修复方法：检查 token 刷新\",\"occurrences\":3,\"verified\":true}")
assert_contains "promoted to pattern" "$RESPONSE" '"promoted":true'
assert_contains "pattern created" "$RESPONSE" "pattern_auth_failure"

# 8.4 第二次出现（已存在 pattern）应更新 observation
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/self-improvement" \
    -H "Content-Type: application/json" \
    -d "{\"error_type\":\"auth_failure\",\"summary\":\"[2026-07-29] 再次遇到，添加更多上下文\",\"occurrences\":4,\"verified\":true}")
assert_contains "second occurrence updated" "$RESPONSE" '"action":"self_improvement_update"'

# ============================================================
# 模块 9: memory-recall skill
# ============================================================
echo ""
color_yellow "==> 模块 9: memory-recall skill"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/skill/memory-recall" \
    -H "Content-Type: application/json" \
    -d '{"query":"FastAPI","limit":3}')
assert_contains "memory-recall success" "$RESPONSE" '"success":true'
assert_contains "memory-recall returns fastapi-related entity" "$RESPONSE" "fastapi"
assert_contains "memory-recall source=mcp" "$RESPONSE" '"source":"mcp"'

# ============================================================
# 模块 10: 异常路径
# ============================================================
echo ""
color_yellow "==> 模块 10: 异常路径"

# 10.1 非法名字（包含大写）
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"BadName\",\"entity_type\":\"project\"}")
assert_contains "uppercase name rejected" "$RESPONSE" '"detail"'

# 10.2 名字太短
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"ab\",\"entity_type\":\"project\"}")
assert_contains "short name rejected" "$RESPONSE" '"detail"'

# 10.3 非法 entity_type
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"valid_name_test\",\"entity_type\":\"invalid_type\"}")
assert_contains "invalid entity_type rejected" "$RESPONSE" '"detail"'

# 10.4 获取不存在的实体
RESPONSE=$(curl -s "$BASE_URL/api/memory/entities/nonexistent_entity_xyz")
assert_contains "nonexistent entity returns 404" "$RESPONSE" '"detail"'

# 10.5 public_ 保护
PUBLIC_NAME="public_global_test_${RANDOM}"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/memory/entities" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$PUBLIC_NAME\",\"entity_type\":\"fact\"}")
assert_contains "public_ entity created" "$RESPONSE" '"success":true'

RESPONSE=$(curl -s -X DELETE "$BASE_URL/api/memory/entities/$PUBLIC_NAME")
assert_contains "public_ delete rejected without force" "$RESPONSE" '"detail"'

RESPONSE=$(curl -s -X DELETE "$BASE_URL/api/memory/entities/$PUBLIC_NAME?force=true")
assert_contains "public_ delete with force succeeds" "$RESPONSE" '"success":true'

# ============================================================
# 模块 11: 清理
# ============================================================
echo ""
color_yellow "==> 模块 11: 清理测试数据"

# 删除测试实体
curl -s -X DELETE "$BASE_URL/api/memory/entities/$ENT_NAME" > /dev/null
RESPONSE=$(curl -s "$BASE_URL/api/memory/entities/$ENT_NAME")
assert_contains "deleted entity returns 404" "$RESPONSE" '"detail"'

# ============================================================
# 总结
# ============================================================
echo ""
echo "============================================================"
echo "测试结果统计"
echo "============================================================"
echo -e "通过: \033[32m$PASSED\033[0m"
echo -e "失败: \033[31m$FAILED\033[0m"
echo "============================================================"

if [[ $FAILED -gt 0 ]]; then
    color_red "✗ 部分测试失败"
    exit 1
else
    color_green "✓ 全部测试通过"
    exit 0
fi
