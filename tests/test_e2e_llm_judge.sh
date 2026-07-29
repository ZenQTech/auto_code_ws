#!/bin/bash
# ============================================================
# Cycle 13 P0-3: LLM-as-Judge 验证层 E2E Tests
# ============================================================
# 测试目标：
#   1. 验证 /api/llm-judge/* 端点（11+ 端点）
#   2. 验证 5 维度评分模型
#   3. 验证多 Judge 共识机制
#   4. 验证 Judge 模型池 CRUD
#   5. 验证 Safety 一票否决
#   6. 验证与 P1-10 Verification Loop 集成
# 依赖：后端服务运行于 127.0.0.1:8000
# 执行：bash tests/test_e2e_llm_judge.sh
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
API="$BASE_URL/api/llm-judge"
PASS=0
FAIL=0

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_pass() {
    PASS=$((PASS+1))
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

test_fail() {
    FAIL=$((FAIL+1))
    echo -e "${RED}✗ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        echo -e "  ${RED}Details: $2${NC}"
    fi
}

# 等待服务
echo "=== 等待后端服务 ==="
for i in {1..30}; do
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
        echo "  服务已就绪"
        break
    fi
    sleep 1
done

# ============================================================
# 1. 健康检查
# ============================================================
echo ""
echo "=== 1. 健康检查 ==="
RESP=$(curl -s "$API/health")
if echo "$RESP" | grep -q '"success":true'; then
    test_pass "健康检查返回 success"
else
    test_fail "健康检查失败" "$RESP"
fi
if echo "$RESP" | grep -q '"service":"llm-judge"'; then
    test_pass "服务标识为 llm-judge"
else
    test_fail "服务标识不正确" "$RESP"
fi
if echo "$RESP" | grep -q '"pool_stats"'; then
    test_pass "包含 pool_stats"
else
    test_fail "缺少 pool_stats" "$RESP"
fi
if echo "$RESP" | grep -q '"features"'; then
    test_pass "包含 features 列表"
else
    test_fail "缺少 features" "$RESP"
fi

# ============================================================
# 2. Judge 模型池
# ============================================================
echo ""
echo "=== 2. Judge 模型池 ==="
RESP=$(curl -s "$API/pool")
if echo "$RESP" | grep -q '"success":true'; then
    test_pass "查询 Judge 池成功"
else
    test_fail "查询 Judge 池失败" "$RESP"
fi
JUDGE_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total', 0))")
if [ "$JUDGE_COUNT" -ge 1 ]; then
    test_pass "默认 Judge 数 >= 1 ($JUDGE_COUNT)"
else
    test_fail "默认 Judge 数 < 1" "JUDGE_COUNT=$JUDGE_COUNT"
fi

# ============================================================
# 3. 注册自定义 Judge
# ============================================================
echo ""
echo "=== 3. 注册自定义 Judge ==="
REG_RESP=$(curl -s -X POST "$API/pool" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "E2E Test Judge",
        "model": "e2e-test-model",
        "weight": 0.7,
        "adapter": "mock",
        "specialties": ["e2e", "testing"]
    }')
if echo "$REG_RESP" | grep -q '"success":true'; then
    test_pass "注册 Judge 成功"
else
    test_fail "注册 Judge 失败" "$REG_RESP"
fi
NEW_JUDGE_ID=$(echo "$REG_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('judge', {}).get('judge_id', ''))")
if [ -n "$NEW_JUDGE_ID" ]; then
    test_pass "返回新 Judge ID: $NEW_JUDGE_ID"
else
    test_fail "未返回 Judge ID" "$REG_RESP"
fi

# 验证：再次查询应该看到新 Judge
RESP=$(curl -s "$API/pool")
NEW_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total', 0))")
if [ "$NEW_COUNT" -gt "$JUDGE_COUNT" ]; then
    test_pass "Judge 总数从 $JUDGE_COUNT 增加到 $NEW_COUNT"
else
    test_fail "Judge 总数未增加" "$NEW_COUNT vs $JUDGE_COUNT"
fi

# ============================================================
# 4. 注销自定义 Judge
# ============================================================
echo ""
echo "=== 4. 注销自定义 Judge ==="
if [ -n "$NEW_JUDGE_ID" ]; then
    DEL_RESP=$(curl -s -X DELETE "$API/pool/$NEW_JUDGE_ID")
    if echo "$DEL_RESP" | grep -q '"success":true'; then
        test_pass "注销 Judge 成功"
    else
        test_fail "注销 Judge 失败" "$DEL_RESP"
    fi
    # 验证：再次查询应该没有这个 Judge
    DEL_VERIFY=$(curl -s -X DELETE "$API/pool/$NEW_JUDGE_ID")
    if echo "$DEL_VERIFY" | grep -q '"detail"'; then
        test_pass "重复注销返回 404"
    else
        test_fail "重复注销未返回 404" "$DEL_VERIFY"
    fi
fi

# ============================================================
# 5. 提交 Judge 任务（同步）
# ============================================================
echo ""
echo "=== 5. 提交 Judge 任务（同步） ==="
JUDGE_RESP=$(curl -s -X POST "$API/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Implement user authentication with bcrypt",
        "code_diff": "def login(user, pwd):\n    return check(user, pwd)\n# Use type hints\nasync def test() -> bool: pass",
        "test_results": "5 tests passed",
        "domain": "security",
        "difficulty": "medium",
        "use_consensus": true,
        "execute_sync": true
    }')
if echo "$JUDGE_RESP" | grep -q '"success":true'; then
    test_pass "提交同步任务成功"
else
    test_fail "提交同步任务失败" "$JUDGE_RESP"
fi
TASK_ID=$(echo "$JUDGE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_id', ''))")
if [ -n "$TASK_ID" ]; then
    test_pass "返回任务 ID: $TASK_ID"
else
    test_fail "未返回任务 ID" "$JUDGE_RESP"
fi
TASK_STATUS=$(echo "$JUDGE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status', ''))")
if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "vetoed" ]; then
    test_pass "任务状态为终态: $TASK_STATUS"
else
    test_fail "任务状态异常: $TASK_STATUS" "$JUDGE_RESP"
fi
if echo "$JUDGE_RESP" | grep -q '"consensus"'; then
    test_pass "包含 consensus 结果"
else
    test_fail "缺少 consensus" "$JUDGE_RESP"
fi

# ============================================================
# 6. 5 维度评分
# ============================================================
echo ""
echo "=== 6. 5 维度评分 ==="
SCORES=$(echo "$JUDGE_RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
c = d.get('consensus', {})
s = c.get('aggregated_scores', {})
dims = ['correctness', 'style', 'safety', 'performance', 'maintainability']
present = [dim for dim in dims if dim in s]
print(','.join(present))
")
EXPECTED_DIMS="correctness,style,safety,performance,maintainability"
if [ "$SCORES" = "$EXPECTED_DIMS" ]; then
    test_pass "5 维度齐全: $SCORES"
else
    test_fail "5 维度不齐全" "Got: $SCORES, Expected: $EXPECTED_DIMS"
fi

# ============================================================
# 7. 提交 Judge 任务（异步）
# ============================================================
echo ""
echo "=== 7. 提交 Judge 任务（异步） ==="
ASYNC_RESP=$(curl -s -X POST "$API/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Async test",
        "code_diff": "def foo(): pass",
        "execute_sync": false
    }')
if echo "$ASYNC_RESP" | grep -q '"success":true'; then
    test_pass "提交异步任务成功"
else
    test_fail "提交异步任务失败" "$ASYNC_RESP"
fi
ASYNC_STATUS=$(echo "$ASYNC_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status', ''))")
if [ "$ASYNC_STATUS" = "pending" ]; then
    test_pass "异步任务状态为 pending"
else
    test_fail "异步任务状态异常: $ASYNC_STATUS" "$ASYNC_RESP"
fi
ASYNC_TASK_ID=$(echo "$ASYNC_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_id', ''))")

# ============================================================
# 8. 查询任务
# ============================================================
echo ""
echo "=== 8. 查询任务 ==="
if [ -n "$TASK_ID" ]; then
    GET_RESP=$(curl -s "$API/judge/$TASK_ID")
    if echo "$GET_RESP" | grep -q '"success":true'; then
        test_pass "查询任务成功"
    else
        test_fail "查询任务失败" "$GET_RESP"
    fi
    if echo "$GET_RESP" | grep -q "$TASK_ID"; then
        test_pass "返回任务 ID 匹配"
    else
        test_fail "任务 ID 不匹配" "$GET_RESP"
    fi
fi

# 查询不存在的任务
NOT_FOUND=$(curl -s "$API/judge/nonexistent_task_xyz")
if echo "$NOT_FOUND" | grep -q '"detail"'; then
    test_pass "查询不存在任务返回 404"
else
    test_fail "查询不存在任务未返回 404" "$NOT_FOUND"
fi

# ============================================================
# 9. 评分报告 (Markdown)
# ============================================================
echo ""
echo "=== 9. 评分报告 ==="
if [ -n "$TASK_ID" ]; then
    REPORT_RESP=$(curl -s "$API/judge/$TASK_ID/report")
    if echo "$REPORT_RESP" | grep -q '"success":true'; then
        test_pass "获取评分报告成功"
    else
        test_fail "获取评分报告失败" "$REPORT_RESP"
    fi
    if echo "$REPORT_RESP" | grep -q '"report"'; then
        test_pass "包含 report 字段"
    else
        test_fail "缺少 report 字段" "$REPORT_RESP"
    fi
    if echo "$REPORT_RESP" | grep -q "Consensus Result"; then
        test_pass "Markdown 报告包含 Consensus Result 段落"
    else
        test_fail "Markdown 报告缺少 Consensus Result" "$REPORT_RESP"
    fi
    if echo "$REPORT_RESP" | grep -q "Aggregated Scores"; then
        test_pass "Markdown 报告包含 Aggregated Scores 表格"
    else
        test_fail "Markdown 报告缺少 Aggregated Scores" "$REPORT_RESP"
    fi
fi

# ============================================================
# 10. 列出任务
# ============================================================
echo ""
echo "=== 10. 列出任务 ==="
LIST_RESP=$(curl -s "$API/tasks")
if echo "$LIST_RESP" | grep -q '"success":true'; then
    test_pass "列出任务成功"
else
    test_fail "列出任务失败" "$LIST_RESP"
fi
TASKS_TOTAL=$(echo "$LIST_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total', 0))")
if [ "$TASKS_TOTAL" -ge 1 ]; then
    test_pass "至少有 1 个任务 ($TASKS_TOTAL)"
else
    test_fail "任务数为 0" "$LIST_RESP"
fi

# 按状态过滤
FILTER_RESP=$(curl -s "$API/tasks?status=completed")
if echo "$FILTER_RESP" | grep -q '"success":true'; then
    test_pass "按状态过滤任务成功"
else
    test_fail "按状态过滤失败" "$FILTER_RESP"
fi

# ============================================================
# 11. 多 Judge 共识（直接）
# ============================================================
echo ""
echo "=== 11. 多 Judge 共识 ==="
CONS_RESP=$(curl -s -X POST "$API/consensus" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Consensus test",
        "code_diff": "def hello(): return 1",
        "strategy": "weighted_average",
        "judge_count": 3
    }')
if echo "$CONS_RESP" | grep -q '"success":true'; then
    test_pass "多 Judge 共识评分成功"
else
    test_fail "多 Judge 共识失败" "$CONS_RESP"
fi
if echo "$CONS_RESP" | grep -q '"judge_count"'; then
    test_pass "共识结果包含 judge_count"
else
    test_fail "共识结果缺少 judge_count" "$CONS_RESP"
fi
JUDGE_COUNT_RCVD=$(echo "$CONS_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('consensus', {}).get('judge_count', 0))")
if [ "$JUDGE_COUNT_RCVD" -ge 1 ]; then
    test_pass "实际执行 Judge 数: $JUDGE_COUNT_RCVD"
else
    test_fail "实际执行 Judge 数 < 1" "$JUDGE_COUNT_RCVD"
fi

# ============================================================
# 12. Safety 一票否决
# ============================================================
echo ""
echo "=== 12. Safety 一票否决 ==="
UNSAFE_RESP=$(curl -s -X POST "$API/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Unsafe test",
        "code_diff": "eval(user_input)\nexec(code)\nos.system(rm)",
        "execute_sync": true
    }')
if echo "$UNSAFE_RESP" | grep -q '"success":true'; then
    test_pass "不安全代码评分成功"
else
    test_fail "不安全代码评分失败" "$UNSAFE_RESP"
fi
# 检查是否被 veto 或 safety < 6
UNSAFE_STATUS=$(echo "$UNSAFE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status', ''))")
UNSAFE_SAFETY=$(echo "$UNSAFE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); c=d.get('consensus', {}); s=c.get('aggregated_scores', {}); print(s.get('safety', 10))")
if [ "$UNSAFE_STATUS" = "vetoed" ] || [ "$UNSAFE_SAFETY" -lt 7 ]; then
    test_pass "Safety 检测有效 (status=$UNSAFE_STATUS, safety=$UNSAFE_SAFETY)"
else
    test_fail "Safety 检测未生效 (status=$UNSAFE_STATUS, safety=$UNSAFE_SAFETY)" "$UNSAFE_RESP"
fi

# ============================================================
# 13. 与 P1-10 Verification Loop 集成
# ============================================================
echo ""
echo "=== 13. P1-10 Verification Loop 集成 ==="
VERIFY_RESP=$(curl -s -X POST "$API/verify" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Verify test",
        "code_diff": "def add(a, b): return a + b",
        "use_consensus": true
    }')
if echo "$VERIFY_RESP" | grep -q '"success":true'; then
    test_pass "P1-10 集成 verify 调用成功"
else
    test_fail "P1-10 集成 verify 失败" "$VERIFY_RESP"
fi
if echo "$VERIFY_RESP" | grep -q '"verifier_result"'; then
    test_pass "包含 verifier_result 字段"
else
    test_fail "缺少 verifier_result" "$VERIFY_RESP"
fi
if echo "$VERIFY_RESP" | grep -q '"passed"'; then
    test_pass "verifier_result 包含 passed 字段"
else
    test_fail "verifier_result 缺少 passed" "$VERIFY_RESP"
fi
if echo "$VERIFY_RESP" | grep -q '"judge_count"'; then
    test_pass "verifier_result 包含 judge_count 字段"
else
    test_fail "verifier_result 缺少 judge_count" "$VERIFY_RESP"
fi

# ============================================================
# 14. 统计信息
# ============================================================
echo ""
echo "=== 14. 统计信息 ==="
STATS_RESP=$(curl -s "$API/stats")
if echo "$STATS_RESP" | grep -q '"success":true'; then
    test_pass "统计查询成功"
else
    test_fail "统计查询失败" "$STATS_RESP"
fi
if echo "$STATS_RESP" | grep -q '"pool_stats"'; then
    test_pass "包含 pool_stats"
else
    test_fail "缺少 pool_stats" "$STATS_RESP"
fi
if echo "$STATS_RESP" | grep -q '"store_stats"'; then
    test_pass "包含 store_stats"
else
    test_fail "缺少 store_stats" "$STATS_RESP"
fi
TOTAL_TASKS=$(echo "$STATS_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('store_stats', {}).get('total_tasks', 0))")
if [ "$TOTAL_TASKS" -ge 1 ]; then
    test_pass "总任务数 >= 1 ($TOTAL_TASKS)"
else
    test_fail "总任务数 < 1" "$STATS_RESP"
fi

# ============================================================
# 15. 错误处理
# ============================================================
echo ""
echo "=== 15. 错误处理 ==="
# 无效 difficulty
INVALID_DIFF=$(curl -s -X POST "$API/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Invalid test",
        "difficulty": "impossible"
    }')
if echo "$INVALID_DIFF" | grep -q '"detail"'; then
    test_pass "无效 difficulty 返回错误"
else
    test_fail "无效 difficulty 未返回错误" "$INVALID_DIFF"
fi
# 无效 domain
INVALID_DOMAIN=$(curl -s -X POST "$API/judge" \
    -H "Content-Type: application/json" \
    -d '{
        "task_description": "Invalid test",
        "domain": "unknown"
    }')
if echo "$INVALID_DOMAIN" | grep -q '"detail"'; then
    test_pass "无效 domain 返回错误"
else
    test_fail "无效 domain 未返回错误" "$INVALID_DOMAIN"
fi
# 无效 adapter
INVALID_ADAPTER=$(curl -s -X POST "$API/pool" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Bad",
        "model": "bad",
        "adapter": "not-real-adapter"
    }')
if echo "$INVALID_ADAPTER" | grep -q '"detail"'; then
    test_pass "无效 adapter 返回错误"
else
    test_fail "无效 adapter 未返回错误" "$INVALID_ADAPTER"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo "=== 测试总结 ==="
TOTAL=$((PASS+FAIL))
echo "  总计: $TOTAL"
echo "  ${GREEN}通过: $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
    echo "  ${RED}失败: $FAIL${NC}"
    exit 1
else
    echo "  ${GREEN}失败: 0${NC}"
    echo ""
    echo "🎉 全部测试通过！"
fi
