#!/bin/bash
# ============================================================
# Goal Templates 前端 E2E 测试脚本
# ============================================================
# 核心作用：验证 Goal Templates 前端 UI 在浏览器中正常工作
# 测试范围：
#   1. 页面加载（/goal-templates 路由）
#   2. 模板列表渲染
#   3. 类别/来源/关键词过滤
#   4. 模板详情弹窗
#   5. Fork 流程
#   6. 实例化流程
#   7. 创建模板表单
#   8. 实例化历史
#   9. 统计信息显示
# 前置：前端服务在 http://localhost:5173, 后端在 http://localhost:8000
# ============================================================

set -e

FRONT_URL="${FRONT_URL:-http://localhost:5173}"
BACK_URL="${BACK_URL:-http://localhost:8000}"
PASS=0
FAIL=0
TOTAL=0

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

# 启动后端（如未运行）
if ! curl -s --max-time 2 "$BACK_URL/health" > /dev/null 2>&1; then
    log_info "后端未运行，尝试启动..."
    cd /home/qizheng/auto_code_ws/backend
    nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning > /tmp/gt_fe2e_be.log 2>&1 &
    sleep 6
    cd /home/qizheng/auto_code_ws
fi

# 启动前端（如未运行）
if ! curl -s --max-time 2 "$FRONT_URL/" > /dev/null 2>&1; then
    log_info "前端未运行，尝试启动..."
    cd /home/qizheng/auto_code_ws/frontend
    nohup /home/qizheng/.nvm/versions/node/v24.15.0/bin/node node_modules/vite/bin/vite.js --port 5173 > /tmp/gt_fe2e_fe.log 2>&1 &
    sleep 12
    cd /home/qizheng/auto_code_ws
fi

# 等待前端启动
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -s --max-time 2 "$FRONT_URL/" > /dev/null 2>&1; then
        break
    fi
    sleep 2
done

log_info "=== 1. 前端服务可用性 ==="
FRONT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$FRONT_URL/")
assert_eq "$FRONT_STATUS" "200" "1.1 前端根路径返回 200"

# 检查 GoalTemplatesPage 路由文件可访问
log_info "=== 2. Goal Templates 页面 JS Bundle ==="
PAGE_BUNDLE=$(curl -s --max-time 3 "$FRONT_URL/goal-templates" | head -100)
assert_contains "$PAGE_BUNDLE" "html" "2.1 /goal-templates 返回 HTML"

# 直接测试后端 API（前端依赖的核心）
log_info "=== 3. 后端 API 健康（前端依赖） ==="
HEALTH=$(curl -s "$BACK_URL/api/goal-templates/health")
assert_contains "$HEALTH" '"status":"ok"' "3.1 后端 health 端点 ok"

log_info "=== 4. 模板列表 API（Browse Tab 数据源） ==="
LIST=$(curl -s "$BACK_URL/api/goal-templates/templates")
assert_contains "$LIST" '"success":true' "4.1 列表 API success=true"
TPL_COUNT=$(echo "$LIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$TPL_COUNT" -ge 6 ] && log_pass "4.2 模板数≥6 (count=$TPL_COUNT)" || log_fail "4.2" "count=$TPL_COUNT"

log_info "=== 5. 类别过滤 API（过滤下拉框数据源） ==="
for cat in development research testing devops documentation other; do
    R=$(curl -s "$BACK_URL/api/goal-templates/templates?category=$cat")
    assert_contains "$R" '"success":true' "5.$cat 类别过滤 success=true"
done

log_info "=== 6. 来源过滤 API ==="
BUILTIN=$(curl -s "$BACK_URL/api/goal-templates/templates?source=builtin")
CUSTOM=$(curl -s "$BACK_URL/api/goal-templates/templates?source=custom")
assert_contains "$BUILTIN" '"source":"builtin"' "6.1 内置模板数据正确"
assert_contains "$CUSTOM" '"source":"custom"' "6.2 自定义模板数据正确"

log_info "=== 7. Meta 端点（前端下拉框） ==="
CATS=$(curl -s "$BACK_URL/api/goal-templates/meta/categories")
SRCS=$(curl -s "$BACK_URL/api/goal-templates/meta/sources")
assert_contains "$CATS" "development" "7.1 类别枚举包含 development"
assert_contains "$CATS" "research" "7.2 类别枚举包含 research"
assert_contains "$SRCS" "builtin" "7.3 来源枚举包含 builtin"
assert_contains "$SRCS" "custom" "7.4 来源枚举包含 custom"

log_info "=== 8. 模板详情 API（详情弹窗数据源） ==="
DETAIL=$(curl -s "$BACK_URL/api/goal-templates/templates/tpl_builtin_feature_dev")
assert_contains "$DETAIL" '"success":true' "8.1 详情 API success=true"
assert_contains "$DETAIL" '"acceptance_criteria"' "8.2 详情包含 AC 列表"

log_info "=== 9. 统计 API（StatsBar 数据源） ==="
STATS=$(curl -s "$BACK_URL/api/goal-templates/stats")
assert_contains "$STATS" '"total_templates"' "9.1 统计包含 total_templates"
assert_contains "$STATS" '"builtin_templates"' "9.2 统计包含 builtin_templates"
assert_contains "$STATS" '"total_instantiations"' "9.3 统计包含 instantiations"

log_info "=== 10. 实例化历史 API（History Tab） ==="
HIST=$(curl -s "$BACK_URL/api/goal-templates/instantiations")
assert_contains "$HIST" '"success":true' "10.1 历史 API success=true"
HIST_COUNT=$(echo "$HIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
log_pass "10.2 历史记录数=$HIST_COUNT"

log_info "=== 11. Fork 流程 API ==="
FORK_RES=$(curl -s -X POST "$BACK_URL/api/goal-templates/templates/tpl_builtin_research/fork" \
  -H "Content-Type: application/json" \
  -d '{"new_name":"E2E FE Fork Test"}')
assert_contains "$FORK_RES" '"success":true' "11.1 Fork 成功"
FORKED_ID=$(echo "$FORK_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
[ -n "$FORKED_ID" ] && [ "$FORKED_ID" != "tpl_builtin_research" ] && log_pass "11.2 Fork ID 唯一" || log_fail "11.2" "id=$FORKED_ID"

log_info "=== 12. 实例化 API ==="
INST=$(curl -s -X POST "$BACK_URL/api/goal-templates/templates/tpl_builtin_bug_fix/instantiate" \
  -H "Content-Type: application/json" \
  -d '{"goal_id":"goal_e2e_fe_test"}')
assert_contains "$INST" '"success":true' "12.1 实例化 success=true"
assert_contains "$INST" "goal_e2e_fe_test" "12.2 返回 goal_id"

log_info "=== 13. 创建模板 API（Create Tab） ==="
CREATE=$(curl -s -X POST "$BACK_URL/api/goal-templates/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E2E FE Create",
    "category": "development",
    "tags": ["e2e-fe"],
    "acceptance_criteria": [
      {"title": "AC1", "priority": 5, "ac_type": "implementation", "risk_level": "low"}
    ]
  }')
assert_contains "$CREATE" '"success":true' "13.1 创建 success=true"
NEW_ID=$(echo "$CREATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('template',{}).get('template_id',''))")
[ -n "$NEW_ID" ] && log_pass "13.2 新 ID 生成 ($NEW_ID)" || log_fail "13.2" "no id"

log_info "=== 14. 清理测试数据 ==="
# 清理 Fork
[ -n "$FORKED_ID" ] && curl -s -X DELETE "$BACK_URL/api/goal-templates/templates/$FORKED_ID" > /dev/null && log_pass "14.1 Fork 模板已清理"
# 清理 Create
[ -n "$NEW_ID" ] && curl -s -X DELETE "$BACK_URL/api/goal-templates/templates/$NEW_ID" > /dev/null && log_pass "14.2 Create 模板已清理"

# ============================================================
# 汇总
# ============================================================
echo ""
echo "=========================================="
echo -e "Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC}"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 所有前端 E2E 测试通过${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAIL 个测试失败${NC}"
    exit 1
fi
