#!/bin/bash
# ============================================================
# Goal Templates API - E2E 测试脚本
# ============================================================
# 核心作用：端到端验证 Goal Templates 后端 API 全部 14 个端点
# 测试范围：
#   1. 健康检查 / 统计
#   2. 模板 CRUD（列出 / 详情 / 注册 / 更新 / 注销）
#   3. Fork / 实例化
#   4. 导入 / 导出
#   5. Meta 端点
#   6. 错误路径（404 / 400）
# 运行：bash tests/test_e2e_goal_templates.sh
# 前置：后端服务运行在 http://localhost:8000
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_PREFIX="/api/goal-templates"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "${RED}[FAIL]${NC} $1"; echo "  Details: $2"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

assert_eq() {
    if [ "$1" = "$2" ]; then log_pass "$3 (value=$1)";
    else log_fail "$3" "expected=$2 actual=$1"; fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then log_pass "$3";
    else log_fail "$3" "expected_contains=$2 actual=$1"; fi
}

# 启动后端（如果未运行）
if ! curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
    log_info "后端未运行，尝试启动..."
    cd /home/qizheng/auto_code_ws/backend
    nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/goal_templates_e2e.log 2>&1 &
    sleep 6
    if ! curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
        log_fail "后端启动失败" "请手动启动后端后重试"
        exit 1
    fi
    cd /home/qizheng/auto_code_ws
fi

log_info "=== 1. 健康检查 ==="
HEALTH=$(curl -s "$BASE_URL$API_PREFIX/health")
assert_contains "$HEALTH" '"status":"ok"' "1.1 健康检查返回 ok"
assert_contains "$HEALTH" '"module":"goal-templates"' "1.2 模块名正确"

log_info "=== 2. 统计信息 ==="
STATS=$(curl -s "$BASE_URL$API_PREFIX/stats")
assert_contains "$STATS" '"success":true' "2.1 统计 success=true"
assert_contains "$STATS" '"total_templates"' "2.2 统计包含 total_templates"

log_info "=== 3. 列出模板（默认） ==="
LIST=$(curl -s "$BASE_URL$API_PREFIX/templates")
assert_contains "$LIST" '"success":true' "3.1 列表 success=true"
COUNT=$(echo "$LIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$COUNT" -ge 6 ] && log_pass "3.2 内置模板数≥6 (count=$COUNT)" || log_fail "3.2 内置模板数≥6" "count=$COUNT"

log_info "=== 4. 类别过滤 ==="
LIST_DEV=$(curl -s "$BASE_URL$API_PREFIX/templates?category=development")
assert_contains "$LIST_DEV" '"success":true' "4.1 类别过滤 success=true"

log_info "=== 5. 来源过滤 ==="
LIST_BUILTIN=$(curl -s "$BASE_URL$API_PREFIX/templates?source=builtin")
assert_contains "$LIST_BUILTIN" '"success":true' "5.1 来源过滤 success=true"
BUILTIN_COUNT=$(echo "$LIST_BUILTIN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$BUILTIN_COUNT" -ge 6 ] && log_pass "5.2 内置模板来源过滤 count≥6 (count=$BUILTIN_COUNT)" || log_fail "5.2" "count=$BUILTIN_COUNT"

log_info "=== 6. 关键词搜索 ==="
LIST_SEARCH=$(curl -sG "$BASE_URL$API_PREFIX/templates" --data-urlencode "keyword=功能")
assert_contains "$LIST_SEARCH" '"success":true' "6.1 关键词搜索 success=true"

log_info "=== 7. 模板详情 ==="
DETAIL=$(curl -s "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev")
assert_contains "$DETAIL" '"success":true' "7.1 详情 success=true"
assert_contains "$DETAIL" 'tpl_builtin_feature_dev' "7.2 详情包含 template_id"

log_info "=== 8. 模板详情 404 ==="
NOT_FOUND=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$API_PREFIX/templates/tpl_nonexistent_xyz")
assert_eq "$NOT_FOUND" "404" "8.1 不存在模板返回 404"

log_info "=== 9. 创建自定义模板 ==="
CREATE=$(curl -s -X POST "$BASE_URL$API_PREFIX/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E2E测试模板-功能开发",
    "description": "由 E2E 测试创建",
    "category": "development",
    "tags": ["e2e", "test"],
    "acceptance_criteria": [
      {"title": "AC1-接口实现", "description": "实现测试接口", "priority": 8, "ac_type": "implementation", "risk_level": "medium"},
      {"title": "AC2-测试通过", "description": "运行测试通过", "priority": 9, "ac_type": "verification", "risk_level": "low"}
    ],
    "default_strategy": "standard",
    "default_max_turns": 30,
    "default_triggers": ["manual"],
    "recommended_agents": ["implementer", "verifier"]
  }')
assert_contains "$CREATE" '"success":true' "9.1 创建模板 success=true"
NEW_TEMPLATE_ID=$(echo "$CREATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
[ -n "$NEW_TEMPLATE_ID" ] && log_pass "9.2 新模板已生成 ID (id=$NEW_TEMPLATE_ID)" || log_fail "9.2" "no template_id"

log_info "=== 10. 创建模板校验（空 AC 列表）==="
INVALID=$(curl -s -X POST "$BASE_URL$API_PREFIX/templates" \
  -H "Content-Type: application/json" \
  -d '{"name":"empty-ac","acceptance_criteria":[]}')
INVALID_CODE=$(echo "$INVALID" | python3 -c "import json,sys; d=json.load(sys.stdin); print('has_error' if 'detail' in d else 'no_error')")
[ "$INVALID_CODE" = "has_error" ] && log_pass "10.1 空 AC 列表被拒绝" || log_fail "10.1" "$INVALID"

log_info "=== 11. 更新模板 ==="
if [ -n "$NEW_TEMPLATE_ID" ]; then
    UPDATE=$(curl -s -X PUT "$BASE_URL$API_PREFIX/templates/$NEW_TEMPLATE_ID" \
      -H "Content-Type: application/json" \
      -d '{"description":"E2E 更新后的描述","tags":["e2e","updated"]}')
    assert_contains "$UPDATE" '"success":true' "11.1 更新 success=true"
    NEW_DESC=$(echo "$UPDATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('description',''))")
    assert_eq "$NEW_DESC" "E2E 更新后的描述" "11.2 描述已更新"
fi

log_info "=== 12. 更新内置模板（应被拒绝）==="
UPDATE_BUILTIN=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev" \
  -H "Content-Type: application/json" \
  -d '{"description":"hacked"}')
assert_eq "$UPDATE_BUILTIN" "400" "12.1 内置模板更新被拒绝 (400)"

log_info "=== 13. Fork 内置模板 ==="
FORK=$(curl -s -X POST "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev/fork" \
  -H "Content-Type: application/json" \
  -d '{"new_name":"我的功能开发副本","new_tags":["e2e","forked"]}')
assert_contains "$FORK" '"success":true' "13.1 Fork success=true"
FORKED_ID=$(echo "$FORK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
FORKED_SOURCE=$(echo "$FORK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('source',''))")
assert_eq "$FORKED_SOURCE" "custom" "13.2 Fork 后 source=custom"
[ -n "$FORKED_ID" ] && [ "$FORKED_ID" != "tpl_builtin_feature_dev" ] && log_pass "13.3 Fork ID 与原不同" || log_fail "13.3" "forked_id=$FORKED_ID"

log_info "=== 14. 实例化模板 ==="
INST=$(curl -s -X POST "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev/instantiate" \
  -H "Content-Type: application/json" \
  -d '{"goal_id":"goal_e2e_001"}')
assert_contains "$INST" '"success":true' "14.1 实例化 success=true"
GOAL_CONFIG=$(echo "$INST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('goal_config',{}),ensure_ascii=False))")
assert_contains "$GOAL_CONFIG" "goal_e2e_001" "14.2 Goal config 包含 goal_id"
assert_contains "$GOAL_CONFIG" "acceptance_criteria" "14.3 Goal config 包含 acceptance_criteria"

log_info "=== 15. 实例化 404 ==="
INST_404=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL$API_PREFIX/templates/tpl_nonexistent_xyz/instantiate" \
  -H "Content-Type: application/json" -d '{}')
assert_eq "$INST_404" "404" "15.1 不存在模板实例化返回 404"

log_info "=== 16. 导出模板 ==="
EXPORT=$(curl -s "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev/export")
assert_contains "$EXPORT" '"success":true' "16.1 导出 success=true"
assert_contains "$EXPORT" "tpl_builtin_feature_dev" "16.2 导出包含 template_id"

log_info "=== 17. 导入模板 ==="
EXPORT_DATA=$(echo "$EXPORT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('template',{}),ensure_ascii=False))")
IMPORT=$(curl -s -X POST "$BASE_URL$API_PREFIX/templates/import" \
  -H "Content-Type: application/json" \
  -d "{\"data\":$EXPORT_DATA,\"new_template_id\":\"tpl_e2e_imported_$(date +%s)\"}")
assert_contains "$IMPORT" '"success":true' "17.1 导入 success=true"

log_info "=== 18. 实例化历史 ==="
HIST=$(curl -s "$BASE_URL$API_PREFIX/instantiations")
assert_contains "$HIST" '"success":true' "18.1 实例化历史 success=true"
HIST_COUNT=$(echo "$HIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$HIST_COUNT" -ge 1 ] && log_pass "18.2 实例化历史数≥1 (count=$HIST_COUNT)" || log_fail "18.2" "count=$HIST_COUNT"

log_info "=== 19. 实例化历史（按模板过滤）==="
HIST_FILTER=$(curl -s "$BASE_URL$API_PREFIX/instantiations?template_id=tpl_builtin_feature_dev")
assert_contains "$HIST_FILTER" '"success":true' "19.1 按模板过滤 success=true"

log_info "=== 20. Meta - 类别 ==="
CATS=$(curl -s "$BASE_URL$API_PREFIX/meta/categories")
assert_contains "$CATS" "development" "20.1 类别包含 development"
assert_contains "$CATS" "research" "20.2 类别包含 research"

log_info "=== 21. Meta - 来源 ==="
SRCS=$(curl -s "$BASE_URL$API_PREFIX/meta/sources")
assert_contains "$SRCS" "builtin" "21.1 来源包含 builtin"
assert_contains "$SRCS" "custom" "21.2 来源包含 custom"

log_info "=== 22. 注销自定义模板 ==="
if [ -n "$NEW_TEMPLATE_ID" ]; then
    DEL=$(curl -s -X DELETE "$BASE_URL$API_PREFIX/templates/$NEW_TEMPLATE_ID")
    assert_contains "$DEL" '"success":true' "22.1 注销 success=true"
    DEL_AGAIN=$(curl -s -X DELETE "$BASE_URL$API_PREFIX/templates/$NEW_TEMPLATE_ID")
    assert_contains "$DEL_AGAIN" '"detail"' "22.2 重复注销返回错误"
fi

log_info "=== 23. 注销内置模板（应被拒绝）==="
DEL_BUILTIN=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL$API_PREFIX/templates/tpl_builtin_feature_dev")
assert_eq "$DEL_BUILTIN" "400" "23.1 内置模板注销被拒绝 (400)"

log_info "=== 24. 清理 Fork 模板 ==="
if [ -n "$FORKED_ID" ]; then
    curl -s -X DELETE "$BASE_URL$API_PREFIX/templates/$FORKED_ID" > /dev/null
    log_pass "24.1 Fork 模板已清理"
fi

# ============================================================
# 汇总
# ============================================================
echo ""
echo "=========================================="
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 所有 E2E 测试通过${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAIL 个测试失败${NC}"
    exit 1
fi
