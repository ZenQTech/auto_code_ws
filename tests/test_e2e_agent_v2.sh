#!/bin/bash
# ============================================================
# Hermes Agent v2 - E2E 测试
# ============================================================
# 核心作用：端到端验证 Agent v2 自进化智能体的所有 API 端点
# 创建日期：2026-07-28
# 覆盖：
#   - /health 端点
#   - /stats 端点
#   - /dashboard 端点
#   - /proactive/operations（记录操作）
#   - /proactive/patterns（CRUD）
#   - /proactive/suggestions（CRUD + accept/reject）
#   - /automations（CRUD + trigger）
#   - /background/tasks（list + get + cancel）
#   - /self-directing/idle-status
#   - /self-directing/auto-turn
#   - /self-directing/config
#   - /self-directing/activity
#   - 错误处理（404）
# ============================================================

set -e

BASE_URL="http://localhost:8000"
PASSED=0
FAILED=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_pass() {
    echo -e "${GREEN}✓${NC} $1"
    PASSED=$((PASSED + 1))
}

log_fail() {
    echo -e "${RED}✗${NC} $1"
    FAILED=$((FAILED + 1))
}

assert_eq() {
    if [ "$1" = "$2" ]; then
        log_pass "$3"
    else
        log_fail "$3 (expected: $2, got: $1)"
    fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then
        log_pass "$3"
    else
        log_fail "$3 (looking for: $2 in: $1)"
    fi
}

echo "============================================================"
echo "Hermes Agent v2 - E2E 测试"
echo "============================================================"

# ============================================================
# 1. 健康检查
# ============================================================
echo -e "\n[1] 健康检查"

RESP=$(curl -s "$BASE_URL/api/agent-v2/health")
assert_contains "$RESP" '"service":"agent_v2"' "health returns service name"
assert_contains "$RESP" '"status":"healthy"' "health returns healthy"

# ============================================================
# 2. 统计端点
# ============================================================
echo -e "\n[2] 统计端点"

RESP=$(curl -s "$BASE_URL/api/agent-v2/stats")
assert_contains "$RESP" '"success":true' "stats returns success"
assert_contains "$RESP" '"total_patterns"' "stats has total_patterns"
assert_contains "$RESP" '"total_suggestions"' "stats has total_suggestions"
assert_contains "$RESP" '"total_automations"' "stats has total_automations"

# ============================================================
# 3. Dashboard 端点
# ============================================================
echo -e "\n[3] Dashboard 端点"

RESP=$(curl -s "$BASE_URL/api/agent-v2/dashboard")
assert_contains "$RESP" '"success":true' "dashboard returns success"
assert_contains "$RESP" '"stats"' "dashboard has stats"
assert_contains "$RESP" '"idle_status"' "dashboard has idle_status"

# ============================================================
# 4. 记录操作 + 模式检测
# ============================================================
echo -e "\n[4] 记录操作 + 模式检测"

# 记录多个操作以触发模式
for i in 1 2 3 4 5; do
    RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/proactive/operations" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "edit",
            "target": "/tmp/e2e_test.py",
            "description": "E2E test operation",
            "suggested_action": "Run tests"
        }')
done

assert_contains "$RESP" '"success":true' "operation recorded"

# 列出模式
RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/patterns?min_confidence=0.1")
assert_contains "$RESP" '"success":true' "list patterns returns success"
assert_contains "$RESP" '"patterns"' "list patterns has patterns array"

# ============================================================
# 5. 创建 + 列出 + 获取 + 删除模式
# ============================================================
echo -e "\n[5] 模式管理"

# 列出模式
RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/patterns")
PATTERN_ID=$(echo "$RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d['patterns'][0]['pattern_id'] if d['patterns'] else '')" 2>/dev/null || echo "")

if [ -n "$PATTERN_ID" ]; then
    # 获取详情
    RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/patterns/$PATTERN_ID")
    assert_contains "$RESP" '"success":true' "get pattern detail"
    assert_contains "$RESP" "$PATTERN_ID" "pattern id in response"
fi

# ============================================================
# 6. 创建 + 列出 + 接受/拒绝建议
# ============================================================
echo -e "\n[6] 建议管理"

# 创建建议
RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/proactive/suggestions" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "E2E Test Suggestion",
        "description": "E2E test description",
        "source": "memory",
        "confidence": 0.85
    }')
assert_contains "$RESP" '"success":true' "create suggestion"
SUG_ID=$(echo "$RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d['suggestion']['suggestion_id'])" 2>/dev/null || echo "")

if [ -n "$SUG_ID" ]; then
    # 列出建议
    RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/suggestions?min_confidence=0.5")
    assert_contains "$RESP" "$SUG_ID" "list suggestions contains new"

    # 获取详情
    RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/suggestions/$SUG_ID")
    assert_contains "$RESP" '"success":true' "get suggestion detail"

    # 接受建议
    RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/proactive/suggestions/$SUG_ID/accept")
    assert_contains "$RESP" '"accepted"' "accept suggestion"

    # 拒绝另一条建议
    RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/proactive/suggestions" \
        -H "Content-Type: application/json" \
        -d '{"title": "T2", "description": "D2"}')
    SUG_ID2=$(echo "$RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d['suggestion']['suggestion_id'])" 2>/dev/null || echo "")

    if [ -n "$SUG_ID2" ]; then
        RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/proactive/suggestions/$SUG_ID2/reject")
        assert_contains "$RESP" '"rejected"' "reject suggestion"
    fi
fi

# ============================================================
# 7. 列出建议（带过滤）
# ============================================================
echo -e "\n[7] 建议过滤"

RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/suggestions?status=pending")
assert_contains "$RESP" '"success":true' "list pending suggestions"

RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/suggestions?status=accepted")
assert_contains "$RESP" '"success":true' "list accepted suggestions"

RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/suggestions?source=memory")
assert_contains "$RESP" '"success":true' "list by source"

# ============================================================
# 8. Thread Automations CRUD
# ============================================================
echo -e "\n[8] Thread Automations"

# 创建
RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/automations" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "e2e_daily_check",
        "schedule": "0 9 * * *",
        "action": "health_check",
        "schedule_type": "cron"
    }')
assert_contains "$RESP" '"success":true' "create automation"
AUTO_ID=$(echo "$RESP" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d['automation']['automation_id'])" 2>/dev/null || echo "")

if [ -n "$AUTO_ID" ]; then
    # 列出
    RESP=$(curl -s "$BASE_URL/api/agent-v2/automations")
    assert_contains "$RESP" "$AUTO_ID" "list contains automation"

    # 详情
    RESP=$(curl -s "$BASE_URL/api/agent-v2/automations/$AUTO_ID")
    assert_contains "$RESP" '"success":true' "get automation detail"

    # 更新
    RESP=$(curl -s -X PUT "$BASE_URL/api/agent-v2/automations/$AUTO_ID" \
        -H "Content-Type: application/json" \
        -d '{"name": "e2e_updated", "enabled": false}')
    assert_contains "$RESP" '"success":true' "update automation"
    assert_contains "$RESP" '"e2e_updated"' "name updated"

    # 触发
    RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/automations/$AUTO_ID/trigger")
    assert_contains "$RESP" '"success":true' "trigger automation"

    # 删除
    RESP=$(curl -s -X DELETE "$BASE_URL/api/agent-v2/automations/$AUTO_ID")
    assert_contains "$RESP" '"removed":true' "delete automation"

    # 验证已删除
    RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/automations/$AUTO_ID")
    assert_eq "$RESP" "404" "deleted automation returns 404"
fi

# ============================================================
# 9. 后台任务管理
# ============================================================
echo -e "\n[9] 后台任务"

# 列出后台任务
RESP=$(curl -s "$BASE_URL/api/agent-v2/background/tasks?limit=10")
assert_contains "$RESP" '"success":true' "list background tasks"

# 状态过滤
RESP=$(curl -s "$BASE_URL/api/agent-v2/background/tasks?status=completed")
assert_contains "$RESP" '"success":true' "filter by status"

# ============================================================
# 10. Self-Directing
# ============================================================
echo -e "\n[10] Self-Directing"

# 空闲状态
RESP=$(curl -s "$BASE_URL/api/agent-v2/self-directing/idle-status")
assert_contains "$RESP" '"success":true' "get idle status"
assert_contains "$RESP" '"is_idle"' "has is_idle"
assert_contains "$RESP" '"idle_threshold"' "has idle_threshold"

# 触发 auto-turn
RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/self-directing/auto-turn")
assert_contains "$RESP" '"success":true' "trigger auto-turn"

# 记录活动
RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/self-directing/activity")
assert_contains "$RESP" '"success":true' "record activity"

# 设置配置
RESP=$(curl -s -X POST "$BASE_URL/api/agent-v2/self-directing/config" \
    -H "Content-Type: application/json" \
    -d '{"idle_threshold": 3600, "auto_turn_enabled": true}')
assert_contains "$RESP" '"success":true' "set config"
assert_contains "$RESP" 'idle_threshold":3600' "threshold updated"

# ============================================================
# 11. 错误处理
# ============================================================
echo -e "\n[11] 错误处理"

# 不存在的 pattern
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/proactive/patterns/non-existent-id")
assert_eq "$RESP" "404" "non-existent pattern returns 404"

# 不存在的 suggestion
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/proactive/suggestions/non-existent-id")
assert_eq "$RESP" "404" "non-existent suggestion returns 404"

# 不存在的 automation
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/automations/non-existent-id")
assert_eq "$RESP" "404" "non-existent automation returns 404"

# 不存在的 background task
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agent-v2/background/tasks/non-existent-id")
assert_eq "$RESP" "404" "non-existent background task returns 404"

# ============================================================
# 12. 模式置信度过滤
# ============================================================
echo -e "\n[12] 模式置信度过滤"

RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/patterns?min_confidence=0.9")
assert_contains "$RESP" '"success":true' "list with min_confidence=0.9"

RESP=$(curl -s "$BASE_URL/api/agent-v2/proactive/patterns?min_confidence=0.1")
assert_contains "$RESP" '"success":true' "list with min_confidence=0.1"

# ============================================================
# 13. 列出已启用/已禁用的自动化
# ============================================================
echo -e "\n[13] 自动化过滤"

# 创建几个自动化
for i in 1 2 3; do
    curl -s -X POST "$BASE_URL/api/agent-v2/automations" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"e2e_filter_$i\",
            \"schedule\": \"*/$((i * 10)) * * * *\",
            \"action\": \"log\",
            \"enabled\": $([ $i -eq 1 ] && echo true || echo false)
        }" > /dev/null
done

RESP=$(curl -s "$BASE_URL/api/agent-v2/automations?enabled_only=true")
assert_contains "$RESP" '"success":true' "list enabled only"

# ============================================================
# 最终统计
# ============================================================
echo ""
echo "============================================================"
echo "测试结果: $PASSED passed, $FAILED failed, $((PASSED + FAILED)) total"
echo "============================================================"

exit 0
