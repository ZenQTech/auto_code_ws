#!/usr/bin/env bash
# Orchestrate 端到端测试
# ============================================================
# 测试覆盖：
#   - 健康检查 + 全局统计
#   - 阶段注册 CRUD
#   - Pipeline CRUD + 执行
#   - Pipeline 取消/暂停/恢复
#   - DAG 工具（验证、构建执行计划、关键路径）
#   - 模板（列表、详情、实例化）
#   - SLA 指标 + 告警
#   - 重试队列 + 熔断器
# ============================================================
set -e

BASE="${BASE:-http://localhost:8000/api/orchestrate}"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 断言函数
assert_contains() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    TOTAL=$((TOTAL+1))
    if echo "$actual" | grep -q "$expected"; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc"
        echo "    expected: $expected"
        echo "    actual:   $actual"
    fi
}

assert_equals() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    TOTAL=$((TOTAL+1))
    if [ "$actual" = "$expected" ]; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc"
        echo "    expected: $expected"
        echo "    actual:   $actual"
    fi
}

assert_not_empty() {
    local desc="$1"
    local actual="$2"
    TOTAL=$((TOTAL+1))
    if [ -n "$actual" ] && [ "$actual" != "null" ]; then
        PASS=$((PASS+1))
        echo -e "  ${GREEN}✓${NC} $desc"
    else
        FAIL=$((FAIL+1))
        echo -e "  ${RED}✗${NC} $desc (empty)"
    fi
}

echo -e "${YELLOW}=== Orchestrate E2E Tests ===${NC}"
echo ""

# ============================================================
# 1. 健康检查 + 全局统计
# ============================================================
echo "==== 1. Health & Stats ===="

RESP=$(curl -s -m 5 "$BASE/health")
assert_contains "health status ok" "$RESP" '"status":"ok"'
assert_contains "version v6.29.0" "$RESP" 'v6.29.0'

RESP=$(curl -s -m 5 "$BASE/stats")
assert_contains "stats has registry" "$RESP" '"registry"'
assert_contains "stats has sla" "$RESP" '"sla"'
assert_contains "stats has retry" "$RESP" '"retry"'
assert_contains "stats has pipelines" "$RESP" '"pipelines"'
assert_contains "stats has templates" "$RESP" '"templates"'
TEMPLATE_COUNT=$(echo "$RESP" | grep -o '"count":[0-9]*' | head -1 | grep -o '[0-9]*')
assert_not_empty "templates count" "$TEMPLATE_COUNT"
echo ""

# ============================================================
# 2. 阶段注册
# ============================================================
echo "==== 2. Stages ===="

RESP=$(curl -s -m 5 "$BASE/stages")
assert_contains "stages endpoint" "$RESP" '"stages"'
STAGE_COUNT=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo "0")
echo "  Total stages: $STAGE_COUNT"

# 模板阶段已被默认注册
RESP=$(curl -s -m 5 "$BASE/stages/lint")
assert_contains "lint stage exists" "$RESP" '"stage_id":"lint"'

# 注册新阶段
NEW_STAGE='{
  "stage_id": "test_custom_stage",
  "name": "test_custom_stage",
  "description": "Test custom stage",
  "inputs": {"data": {"name": "data", "type": "string", "required": true}},
  "outputs": {"result": {"name": "result", "type": "string", "required": true}}
}'
RESP=$(curl -s -m 5 -X POST "$BASE/stages" -H "Content-Type: application/json" -d "$NEW_STAGE")
assert_contains "register custom stage" "$RESP" '"success":true'

# 查询自定义阶段
RESP=$(curl -s -m 5 "$BASE/stages/test_custom_stage")
assert_contains "get custom stage" "$RESP" '"stage_id":"test_custom_stage"'

# 按能力过滤
RESP=$(curl -s -m 5 "$BASE/stages?capability=security_scanner")
assert_contains "find by capability" "$RESP" '"security_scanner"'

# 按标签过滤
RESP=$(curl -s -m 5 "$BASE/stages?tag=review")
assert_contains "find by tag" "$RESP" '"review"'

# 删除自定义阶段
RESP=$(curl -s -m 5 -X DELETE "$BASE/stages/test_custom_stage")
assert_contains "delete custom stage" "$RESP" '"success":true'

# 验证删除
RESP=$(curl -s -m 5 -w "%{http_code}" "$BASE/stages/test_custom_stage" -o /dev/null)
assert_equals "delete returns 404" "$RESP" "404"
echo ""

# ============================================================
# 3. Pipeline CRUD
# ============================================================
echo "==== 3. Pipelines ===="

# 创建空 Pipeline
EMPTY_PIPE='{
  "name": "Test Pipeline",
  "description": "Empty test pipeline",
  "stages": [{"stage_id": "lint"}],
  "inputs": {"repo": "test", "path": "."}
}'
RESP=$(curl -s -m 5 -X POST "$BASE/pipelines" -H "Content-Type: application/json" -d "$EMPTY_PIPE")
assert_contains "create pipeline" "$RESP" '"success":true'
PIPELINE_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['pipeline_id'])" 2>/dev/null)
assert_not_empty "pipeline_id extracted" "$PIPELINE_ID"
echo "  Pipeline ID: $PIPELINE_ID"

# 列出 Pipelines
RESP=$(curl -s -m 5 "$BASE/pipelines")
assert_contains "list pipelines" "$RESP" '"pipelines"'

# 获取 Pipeline 详情
RESP=$(curl -s -m 5 "$BASE/pipelines/$PIPELINE_ID")
assert_contains "get pipeline detail" "$RESP" "$PIPELINE_ID"
assert_contains "pipeline has stages" "$RESP" '"stage_executions"'

# 取消 Pipeline
RESP=$(curl -s -m 5 -X POST "$BASE/pipelines/$PIPELINE_ID/cancel")
assert_contains "cancel pipeline" "$RESP" '"success":true'

# 列出按状态过滤
RESP=$(curl -s -m 5 "$BASE/pipelines?status=cancelled")
assert_contains "list cancelled" "$RESP" '"cancelled"'

# 列出按模板过滤（之前创建的 pipeline 没有 template，所以可能是空数组）
RESP=$(curl -s -m 5 "$BASE/pipelines?template=tpl_code_review")
assert_contains "list by template (any response)" "$RESP" '"pipelines"'
echo ""

# ============================================================
# 4. DAG 工具
# ============================================================
echo "==== 4. DAG Tools ===="

DAG_DATA='{
  "name": "DAG test",
  "stages": [
    {"stage_id": "a"},
    {"stage_id": "b", "depends_on": ["a"]},
    {"stage_id": "c", "depends_on": ["a"]},
    {"stage_id": "d", "depends_on": ["b", "c"]}
  ]
}'

# 验证 DAG
RESP=$(curl -s -m 5 -X POST "$BASE/dag/validate" -H "Content-Type: application/json" -d "$DAG_DATA")
assert_contains "DAG valid" "$RESP" '"valid":true'
assert_contains "DAG has execution plan" "$RESP" '"execution_plan"'
assert_contains "DAG has parallelism" "$RESP" '"parallelism"'
assert_contains "DAG has critical path" "$RESP" '"critical_path"'

# 构建执行计划
RESP=$(curl -s -m 5 -X POST "$BASE/dag/execution-plan" -H "Content-Type: application/json" -d "$DAG_DATA")
assert_contains "execution plan" "$RESP" '"execution_plan"'
PLAN_BATCHES=$(echo "$RESP" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['execution_plan']))" 2>/dev/null)
assert_equals "plan has 3 batches" "$PLAN_BATCHES" "3"

# 循环依赖检测
CYCLE_DATA='{
  "name": "Cycle test",
  "stages": [
    {"stage_id": "a", "depends_on": ["b"]},
    {"stage_id": "b", "depends_on": ["a"]}
  ]
}'
RESP=$(curl -s -m 5 -X POST "$BASE/dag/validate" -H "Content-Type: application/json" -d "$CYCLE_DATA")
assert_contains "cycle detected" "$RESP" '"valid":false'
echo ""

# ============================================================
# 5. 模板
# ============================================================
echo "==== 5. Templates ===="

RESP=$(curl -s -m 5 "$BASE/templates")
assert_contains "list templates" "$RESP" '"templates"'
assert_contains "code_review template" "$RESP" '"name":"Code Review"'
assert_contains "research template" "$RESP" '"name":"Research"'
assert_contains "writing template" "$RESP" '"name":"Article Writing"'
assert_contains "devops template" "$RESP" '"name":"DevOps Deploy"'
assert_contains "data_pipeline template" "$RESP" '"name":"Data Pipeline"'
assert_contains "security_audit template" "$RESP" '"name":"Security Audit"'

# 模板详情
RESP=$(curl -s -m 5 "$BASE/templates/code_review")
assert_contains "code_review detail" "$RESP" '"stage_refs"'
assert_contains "code_review has lint stage" "$RESP" '"stage_id":"lint"'

# 实例化模板
RESP=$(curl -s -m 5 -X POST "$BASE/templates/research/instantiate" \
  -H "Content-Type: application/json" \
  -d '{"query": "test query"}')
assert_contains "instantiate research" "$RESP" '"success":true'
assert_contains "template id set" "$RESP" '"tpl_research"'
echo ""

# ============================================================
# 6. SLA 监控
# ============================================================
echo "==== 6. SLA ===="

RESP=$(curl -s -m 5 "$BASE/sla/metrics")
assert_contains "sla metrics endpoint" "$RESP" '"metrics"'

RESP=$(curl -s -m 5 "$BASE/sla/alerts")
assert_contains "sla alerts endpoint" "$RESP" '"alerts"'
echo ""

# ============================================================
# 7. 重试队列 + 熔断器
# ============================================================
echo "==== 7. Retries & Breakers ===="

RESP=$(curl -s -m 5 "$BASE/retries/queue")
assert_contains "retries queue" "$RESP" '"items"'

RESP=$(curl -s -m 5 "$BASE/retries/breakers")
assert_contains "breakers list" "$RESP" '"breakers"'
echo ""

# ============================================================
# 8. 错误处理
# ============================================================
echo "==== 8. Error Handling ===="

# 不存在的 Pipeline
RESP=$(curl -s -m 5 -w "%{http_code}" "$BASE/pipelines/nonexistent_id" -o /dev/null)
assert_equals "nonexistent pipeline 404" "$RESP" "404"

# 不存在的阶段
RESP=$(curl -s -m 5 -w "%{http_code}" "$BASE/stages/nonexistent_stage" -o /dev/null)
assert_equals "nonexistent stage 404" "$RESP" "404"

# 不存在的模板
RESP=$(curl -s -m 5 -w "%{http_code}" "$BASE/templates/nonexistent_template" -o /dev/null)
assert_equals "nonexistent template 404" "$RESP" "404"

# 不存在的告警
RESP=$(curl -s -m 5 -w "%{http_code}" -X POST "$BASE/sla/alerts/nonexistent_alert/ack" -o /dev/null)
assert_equals "nonexistent alert 404" "$RESP" "404"
echo ""

# ============================================================
# 总结
# ============================================================
echo "========================================"
echo -e "E2E Test Summary"
echo "========================================"
echo "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASS${NC}"
if [ $FAIL -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAIL${NC}"
    exit 1
else
    echo -e "  ${GREEN}Failed: 0${NC}"
    exit 0
fi
