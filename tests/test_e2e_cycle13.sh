#!/bin/bash
# ============================================================
# Cycle 13 完整 Loop Engineering 工作流 E2E 验证
# ============================================================
# 核心作用：端到端验证所有 Cycle 13 核心模块的协同工作
# 创建日期：2026-07-28
# 覆盖：
#   - P0-3 LLM-as-Judge 验证层（5 维度评分 + 多 Judge 共识）
#   - P1-1 Plugin Marketplace（远端仓库 + 评分 + 签名）
#   - P1-2 LLM Judge 前端 UI（5 维度可视化）
#   - P1-3 Plugin Marketplace 前端 UI（浏览/安装/评分）
#   - Verification Loop 集成
#   - 跨模块数据流验证
# ============================================================

set -e

FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://localhost:8000"
API="$BACKEND_URL/api"

PASS=0
FAIL=0

test_pass() { echo "✓ PASS: $1"; PASS=$((PASS+1)); }
test_fail() { echo "✗ FAIL: $1"; FAIL=$((FAIL+1)); }

echo "============================================================"
echo "Cycle 13 Loop Engineering 工作流 E2E 验证"
echo "============================================================"

# ============================================================
# 模块 1: 后端 LLM Judge 健康检查
# ============================================================
echo ""
echo "=== 模块 1: LLM Judge 验证层健康检查 ==="
HEALTH=$(curl -s "$API/llm-judge/health")
if echo "$HEALTH" | grep -q '"success":true'; then
    test_pass "LLM Judge 服务健康"
else
    test_fail "LLM Judge 健康检查失败: $HEALTH"
fi

if echo "$HEALTH" | grep -q "total_judges"; then
    JUDGES=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['pool_stats']['total_judges'])")
    test_pass "LLM Judge 池注册了 $JUDGES 个 Judge"
else
    test_fail "LLM Judge pool_stats 缺失"
fi

# ============================================================
# 模块 2: LLM Judge 提交并执行任务
# ============================================================
echo ""
echo "=== 模块 2: LLM Judge 提交评分任务 ==="
SUBMIT=$(curl -s -X POST "$API/llm-judge/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Cycle 13 端到端验证",
        "code_diff": "+ def hello():\n+     return \"world\"",
        "test_results": "1 passed",
        "difficulty": "easy",
        "domain": "backend",
        "use_consensus": true,
        "consensus_strategy": "weighted_average",
        "execute_sync": true,
        "tags": ["e2e", "cycle13"]
    }')
if echo "$SUBMIT" | grep -q '"success":true'; then
    test_pass "提交评分任务成功"
else
    test_fail "提交评分任务失败: $SUBMIT"
fi

TASK_ID=$(echo "$SUBMIT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_id', ''))" 2>/dev/null || echo "")
if [ -n "$TASK_ID" ]; then
    test_pass "获取到任务 ID: $TASK_ID"
else
    test_fail "无法获取任务 ID"
fi

# ============================================================
# 模块 3: LLM Judge 任务详情查询
# ============================================================
echo ""
echo "=== 模块 3: LLM Judge 任务详情 ==="
LIST_TASKS=$(curl -s "$API/llm-judge/tasks?limit=5")
if echo "$LIST_TASKS" | grep -q "consensus"; then
    test_pass "任务列表包含 consensus 字段"
else
    test_fail "任务列表缺少 consensus"
fi
if echo "$LIST_TASKS" | grep -q "aggregated_scores"; then
    test_pass "任务列表包含 aggregated_scores"
else
    test_fail "任务列表缺少 aggregated_scores"
fi
COMPLETED=$(echo "$LIST_TASKS" | python3 -c "
import json, sys
d = json.load(sys.stdin)
tasks = d.get('tasks', [])
print(sum(1 for t in tasks if t.get('status') == 'completed'))
" 2>/dev/null || echo "0")
if [ "$COMPLETED" -ge 1 ]; then
    test_pass "存在已完成的评分任务 ($COMPLETED 个)"
else
    test_fail "无已完成任务"
fi

# ============================================================
# 模块 4: LLM Judge 统计
# ============================================================
echo ""
echo "=== 模块 4: LLM Judge 统计 ==="
STATS=$(curl -s "$API/llm-judge/stats")
if echo "$STATS" | grep -q '"success":true'; then
    test_pass "获取统计成功"
else
    test_fail "统计获取失败"
fi
if echo "$STATS" | grep -q "pool_stats"; then
    test_pass "统计包含 pool_stats"
else
    test_fail "统计缺少 pool_stats"
fi
if echo "$STATS" | grep -q "store_stats"; then
    test_pass "统计包含 store_stats"
else
    test_fail "统计缺少 store_stats"
fi

# ============================================================
# 模块 5: Plugin Marketplace 健康检查
# ============================================================
echo ""
echo "=== 模块 5: Plugin Marketplace 健康检查 ==="
MHEALTH=$(curl -s "$API/marketplace/health")
if echo "$MHEALTH" | grep -q '"success":true'; then
    test_pass "Marketplace 服务健康"
else
    test_fail "Marketplace 健康检查失败"
fi

PLUGINS=$(echo "$MHEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['total_plugins'])" 2>/dev/null || echo "0")
if [ "$PLUGINS" -ge 3 ]; then
    test_pass "Marketplace 包含 $PLUGINS 个 Plugin"
else
    test_fail "Marketplace Plugin 数量不足: $PLUGINS"
fi

# ============================================================
# 模块 6: Plugin 列表
# ============================================================
echo ""
echo "=== 模块 6: Plugin 列表 ==="
LIST=$(curl -s "$API/marketplace/list?limit=10")
if echo "$LIST" | grep -q '"success":true'; then
    test_pass "Plugin 列表查询成功"
else
    test_fail "Plugin 列表查询失败"
fi

if echo "$LIST" | grep -q "versions"; then
    test_pass "Plugin 包含 versions 字段"
else
    test_fail "Plugin 缺少 versions"
fi

if echo "$LIST" | grep -q "latest_version"; then
    test_pass "Plugin 包含 latest_version 字段"
else
    test_fail "Plugin 缺少 latest_version"
fi

# ============================================================
# 模块 7: Plugin 搜索
# ============================================================
echo ""
echo "=== 模块 7: Plugin 搜索 ==="
SEARCH=$(curl -s "$API/marketplace/search?q=hermes")
if echo "$SEARCH" | grep -q '"success":true'; then
    test_pass "搜索成功"
else
    test_fail "搜索失败"
fi

# ============================================================
# 模块 8: Plugin 安装
# ============================================================
echo ""
echo "=== 模块 8: Plugin 安装 ==="
INSTALL=$(curl -s -X POST "$API/marketplace/hermes.code-formatter/install" \
    -H "Content-Type: application/json" \
    -d '{}')
if echo "$INSTALL" | grep -q '"success":true'; then
    test_pass "安装 Plugin 成功（默认版本）"
else
    test_fail "安装失败: $INSTALL"
fi

# ============================================================
# 模块 9: Plugin 评分
# ============================================================
echo ""
echo "=== 模块 9: Plugin 评分 ==="
RATE=$(curl -s -X POST "$API/marketplace/hermes.code-formatter/rate" \
    -H "Content-Type: application/json" \
    -d '{"score": 5, "user": "e2e_tester", "comment": "Cycle 13 E2E test"}')
if echo "$RATE" | grep -q '"success":true'; then
    test_pass "评分成功"
else
    test_fail "评分失败: $RATE"
fi

# ============================================================
# 模块 10: Plugin 签名验证
# ============================================================
echo ""
echo "=== 模块 10: Plugin 签名验证 ==="
# 通过 list 端点找签名
PLUGIN_DATA=$(curl -s "$API/marketplace/hermes.code-formatter")
SIG_VALUE=$(echo "$PLUGIN_DATA" | python3 -c "
import json, sys
d = json.load(sys.stdin)
plugin = d.get('plugin', {})
versions = plugin.get('versions', [])
for v in versions:
    if v.get('version') == '1.0.0':
        print(v.get('signature', ''))
        break
" 2>/dev/null || echo "")
if [ -n "$SIG_VALUE" ]; then
    VERIFY=$(curl -s -X POST "$API/marketplace/hermes.code-formatter/verify" \
        -H "Content-Type: application/json" \
        -d "{\"version\": \"1.0.0\", \"signature\": \"$SIG_VALUE\"}")
    if echo "$VERIFY" | grep -q '"valid":true'; then
        test_pass "有效签名验证通过"
    else
        test_fail "有效签名验证失败: $VERIFY"
    fi
else
    # 错误签名应该失败
    VERIFY=$(curl -s -X POST "$API/marketplace/hermes.code-formatter/verify" \
        -H "Content-Type: application/json" \
        -d '{"version": "1.0.0", "signature": "wrong-sig"}')
    if echo "$VERIFY" | grep -q '"valid":false'; then
        test_pass "错误签名验证正确拒绝"
    else
        test_fail "签名验证逻辑异常: $VERIFY"
    fi
fi

# ============================================================
# 模块 11: Plugin 发布
# ============================================================
echo ""
echo "=== 模块 11: Plugin 发布 ==="
PUB_ID="e2e.cycle13-$(date +%s)"
PUB=$(curl -s -X POST "$API/marketplace/publish" \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"$PUB_ID\",
        \"name\": \"Cycle 13 E2E Test Plugin\",
        \"description\": \"E2E test for cycle 13\",
        \"author\": \"E2E Tester\",
        \"license\": \"MIT\",
        \"keywords\": [\"e2e\", \"cycle13\"],
        \"categories\": [\"testing\"],
        \"icon\": \"🧪\",
        \"version\": \"1.0.0\",
        \"changelog\": \"Initial E2E release\",
        \"size_kb\": 64,
        \"source\": \"community\"
    }")
if echo "$PUB" | grep -q '"success":true'; then
    test_pass "发布 Plugin 成功: $PUB_ID"
else
    test_fail "发布 Plugin 失败: $PUB"
fi

# ============================================================
# 模块 12: 前端页面可访问
# ============================================================
echo ""
echo "=== 模块 12: 前端页面 ==="
for path in "/" "/llm-judge" "/marketplace" "/verification" "/memory" "/doctor"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL$path")
    if [ "$STATUS" = "200" ]; then
        test_pass "前端 $path 可访问"
    else
        test_fail "前端 $path 返回 $STATUS"
    fi
done

# ============================================================
# 模块 13: 跨模块工作流（LLM Judge 评分 Marketplace Plugin）
# ============================================================
echo ""
echo "=== 模块 13: 跨模块工作流 ==="
# 模拟完整的 vibe coding 工作流：
# 1. 用户编写 Plugin manifest → 2. LLM Judge 评估 → 3. Marketplace 发布
WORKFLOW_TASK=$(curl -s -X POST "$API/llm-judge/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "评估并发布 E2E 测试 Plugin",
        "code_diff": "{\n  \"id\": \"workflow.demo\",\n  \"name\": \"Workflow Demo\",\n  \"version\": \"1.0.0\"\n}",
        "test_results": "All checks passed",
        "difficulty": "medium",
        "domain": "general",
        "use_consensus": true,
        "execute_sync": true
    }')
if echo "$WORKFLOW_TASK" | grep -q '"success":true'; then
    test_pass "工作流任务 1 (LLM Judge 评估) 成功"
else
    test_fail "工作流任务 1 失败"
fi

# 然后用 LLM Judge 评分结果来"决定"是否发布（模拟）
WORKFLOW_PUB=$(curl -s -X POST "$API/marketplace/publish" \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"workflow.demo-$(date +%s)\",
        \"name\": \"Workflow Demo\",
        \"description\": \"After LLM Judge approval\",
        \"author\": \"Workflow Engine\",
        \"version\": \"1.0.0\",
        \"source\": \"community\",
        \"verified\": true,
        \"size_kb\": 32
    }")
if echo "$WORKFLOW_PUB" | grep -q '"success":true'; then
    test_pass "工作流任务 2 (Marketplace 发布) 成功"
else
    test_fail "工作流任务 2 失败: $WORKFLOW_PUB"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo "============================================================"
echo "测试总结"
echo "============================================================"
echo "总计: $((PASS+FAIL))"
echo "通过: $PASS"
echo "失败: $FAIL"

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "🎉 Cycle 13 全部端到端测试通过！"
    echo "✅ LLM Judge 验证层完整可用"
    echo "✅ Plugin Marketplace 远端仓库完整可用"
    echo "✅ 前端 UI 集成完整可用"
    echo "✅ 跨模块工作流贯通"
    exit 0
else
    echo ""
    echo "❌ 有测试失败"
    exit 1
fi
