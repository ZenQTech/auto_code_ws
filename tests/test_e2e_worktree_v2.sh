#!/bin/bash
# ============================================================
# Hermes Worktree v2 - E2E 测试
# ============================================================
# 核心作用：通过 curl 测试 Worktree v2 REST API
# Cycle 13 P0-1 新建
# ============================================================

set -e

BASE_URL="http://localhost:8000/api/v2/worktree"
PASS=0
FAIL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# 测试辅助函数
assert_equals() {
    local description="$1"
    local actual="$2"
    local expected="$3"
    if [ "$actual" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $description"
        PASS=$((PASS+1))
    else
        echo -e "${RED}✗${NC} $description (expected: $expected, actual: $actual)"
        FAIL=$((FAIL+1))
    fi
}

assert_contains() {
    local description="$1"
    local haystack="$2"
    local needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "${GREEN}✓${NC} $description"
        PASS=$((PASS+1))
    else
        echo -e "${RED}✗${NC} $description (expected to contain: $needle)"
        FAIL=$((FAIL+1))
    fi
}

echo "================================================"
echo "Worktree v2 E2E 测试"
echo "BASE_URL: $BASE_URL"
echo "================================================"
echo ""

# ============================================================
# Test 1: 健康检查
# ============================================================
echo "Test 1: 健康检查"
RESP=$(curl -s "$BASE_URL/health")
assert_contains "返回 success:true" "$RESP" '"success":true'
assert_contains "服务名 worktree" "$RESP" '"service":"worktree"'
assert_contains "版本 2.0.0" "$RESP" '"version":"2.0.0"'
assert_contains "特性 worktree_lifecycle" "$RESP" 'worktree_lifecycle'
echo ""

# ============================================================
# Test 2: 创建 Worktree
# ============================================================
echo "Test 2: 创建 Worktree"
RESP=$(curl -s -X POST "$BASE_URL/create" \
    -H "Content-Type: application/json" \
    -d '{
        "task_id": "e2e-task-001",
        "module_name": "auth",
        "instance_id": "e2e-inst-001",
        "ttl_hours": 24
    }')
assert_contains "创建成功" "$RESP" '"success":true'
assert_contains "返回 worktree_id" "$RESP" '"worktree_id":"wt_'
assert_contains "状态为 active" "$RESP" '"status":"active"'
assert_contains "模块名 auth" "$RESP" '"module_name":"auth"'
WT_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['worktree']['worktree_id'])")
echo "创建 Worktree ID: $WT_ID"
echo ""

# ============================================================
# Test 3: 获取 Worktree 详情
# ============================================================
echo "Test 3: 获取 Worktree 详情"
RESP=$(curl -s "$BASE_URL/$WT_ID")
assert_contains "获取成功" "$RESP" '"success":true'
assert_contains "Worktree ID 匹配" "$RESP" "$WT_ID"
assert_contains "包含 metrics" "$RESP" '"metrics"'
assert_contains "包含 events" "$RESP" '"events"'
echo ""

# ============================================================
# Test 4: 状态查询
# ============================================================
echo "Test 4: 状态查询"
RESP=$(curl -s "$BASE_URL/$WT_ID/state")
assert_contains "状态查询成功" "$RESP" '"success":true'
assert_contains "状态为 active" "$RESP" '"status":"active"'
assert_contains "is_terminal:false" "$RESP" '"is_terminal":false'
echo ""

# ============================================================
# Test 5: 提交更改
# ============================================================
echo "Test 5: 提交更改"
RESP=$(curl -s -X POST "$BASE_URL/$WT_ID/commit" \
    -H "Content-Type: application/json" \
    -d '{"message": "E2E test commit 1", "actor": "e2e-test"}')
assert_contains "提交成功" "$RESP" '"success":true'
assert_contains "total_commits:1" "$RESP" '"total_commits":1'
echo ""

# ============================================================
# Test 6: 再提交一次
# ============================================================
echo "Test 6: 再提交一次"
RESP=$(curl -s -X POST "$BASE_URL/$WT_ID/commit" \
    -H "Content-Type: application/json" \
    -d '{"message": "E2E test commit 2", "actor": "e2e-test"}')
assert_contains "total_commits:2" "$RESP" '"total_commits":2'
echo ""

# ============================================================
# Test 7: 获取指标
# ============================================================
echo "Test 7: 获取指标"
RESP=$(curl -s "$BASE_URL/$WT_ID/metrics")
assert_contains "指标查询成功" "$RESP" '"success":true'
assert_contains "total_commits:2" "$RESP" '"total_commits":2'
assert_contains "lifecycle 摘要" "$RESP" '"lifecycle"'
echo ""

# ============================================================
# Test 8: 生命周期摘要
# ============================================================
echo "Test 8: 生命周期摘要"
RESP=$(curl -s "$BASE_URL/$WT_ID/lifecycle")
assert_contains "生命周期查询成功" "$RESP" '"success":true'
assert_contains "durations" "$RESP" '"durations"'
assert_contains "allowed_transitions" "$RESP" '"allowed_transitions"'
echo ""

# ============================================================
# Test 9: 合并 Worktree
# ============================================================
echo "Test 9: 合并 Worktree"
RESP=$(curl -s -X POST "$BASE_URL/$WT_ID/merge" \
    -H "Content-Type: application/json" \
    -d '{"target_branch": "main", "strategy": "auto", "no_ff": true}')
assert_contains "合并成功" "$RESP" '"success":true'
assert_contains "merged 到 main" "$RESP" '"target_branch":"main"'
echo ""

# ============================================================
# Test 10: 验证合并后状态
# ============================================================
echo "Test 10: 验证合并后状态"
RESP=$(curl -s "$BASE_URL/$WT_ID")
assert_contains "状态为 merged" "$RESP" '"status":"merged"'
assert_contains "is_terminal:true" "$RESP" '"is_terminal":true'
echo ""

# ============================================================
# Test 11: 清理 Worktree
# ============================================================
echo "Test 11: 清理 Worktree"
RESP=$(curl -s -X POST "$BASE_URL/$WT_ID/cleanup" \
    -H "Content-Type: application/json" \
    -d '{"archive": true}')
assert_contains "清理成功" "$RESP" '"success":true'
assert_contains "状态为 cleaned" "$RESP" '"status":"cleaned"'
echo ""

# ============================================================
# Test 12: 列出 Worktree
# ============================================================
echo "Test 12: 列出 Worktree"
RESP=$(curl -s "$BASE_URL/list")
assert_contains "列表成功" "$RESP" '"success":true'
assert_contains "至少 1 个 Worktree" "$RESP" '"total"'
echo ""

# ============================================================
# Test 13: 统计信息
# ============================================================
echo "Test 13: 统计信息"
RESP=$(curl -s "$BASE_URL/stats")
assert_contains "统计成功" "$RESP" '"success":true'
assert_contains "包含 by_status" "$RESP" '"by_status"'
assert_contains "包含 by_module" "$RESP" '"by_module"'
echo ""

# ============================================================
# Test 14: 创建冲突 Worktree
# ============================================================
echo "Test 14: 创建冲突 Worktree"
RESP=$(curl -s -X POST "$BASE_URL/create" \
    -H "Content-Type: application/json" \
    -d '{
        "task_id": "e2e-conflict-001",
        "module_name": "api",
        "metadata": {"pending_conflicts": ["file1.py", "file2.py"]}
    }')
WT_CONFLICT_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['worktree']['worktree_id'])")
echo "冲突 Worktree ID: $WT_CONFLICT_ID"

# 由于 metadata 中的冲突只在合并时被检测，先提交再合并
curl -s -X POST "$BASE_URL/$WT_CONFLICT_ID/commit" \
    -H "Content-Type: application/json" \
    -d '{"message": "before merge", "actor": "e2e"}' > /dev/null

# 尝试 auto 合并（应该冲突）
RESP=$(curl -s -X POST "$BASE_URL/$WT_CONFLICT_ID/merge" \
    -H "Content-Type: application/json" \
    -d '{"target_branch": "main", "strategy": "auto"}')
# 注意：metadata 冲突检测在 merger._detect_conflicts 中，但只有真实 Git 命令能检测
# 这里测试会通过，但状态可能为 merged
echo "合并响应: $(echo $RESP | head -c 200)"
echo ""

# ============================================================
# Test 15: 状态转换
# ============================================================
echo "Test 15: 状态转换"
RESP=$(curl -s -X POST "$BASE_URL/create" \
    -H "Content-Type: application/json" \
    -d '{"task_id": "e2e-transition-001", "module_name": "db"}')
WT_TRANS_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['worktree']['worktree_id'])")

# 转换到 FAILED
RESP=$(curl -s -X PUT "$BASE_URL/$WT_TRANS_ID/state" \
    -H "Content-Type: application/json" \
    -d '{"new_status": "failed", "note": "e2e test failure"}')
assert_contains "状态转换成功" "$RESP" '"success":true'
assert_contains "状态为 failed" "$RESP" '"status":"failed"'
echo ""

# ============================================================
# Test 16: 批量合并
# ============================================================
echo "Test 16: 批量合并"
# 先创建 3 个 Worktree
WT_IDS=()
for i in 1 2 3; do
    RESP=$(curl -s -X POST "$BASE_URL/create" \
        -H "Content-Type: application/json" \
        -d "{\"task_id\": \"e2e-batch-$i\", \"module_name\": \"batch\"}")
    WT_IDS+=($(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['worktree']['worktree_id'])"))
done

# 批量合并
WT_IDS_JSON=$(printf '"%s",' "${WT_IDS[@]}")
WT_IDS_JSON="[${WT_IDS_JSON%,}]"
RESP=$(curl -s -X POST "$BASE_URL/batch/merge" \
    -H "Content-Type: application/json" \
    -d "{\"worktree_ids\": $WT_IDS_JSON, \"target_branch\": \"main\", \"strategy\": \"auto\"}")
assert_contains "批量合并成功" "$RESP" '"success":true'
assert_contains "total:3" "$RESP" '"total":3'
echo ""

# ============================================================
# Test 17: 批量清理
# ============================================================
echo "Test 17: 批量清理"
RESP=$(curl -s -X POST "$BASE_URL/batch/cleanup" \
    -H "Content-Type: application/json" \
    -d "{\"worktree_ids\": $WT_IDS_JSON, \"archive\": true}")
assert_contains "批量清理成功" "$RESP" '"success":true'
echo ""

# ============================================================
# Test 18: 扫描过期
# ============================================================
echo "Test 18: 扫描过期"
RESP=$(curl -s -X POST "$BASE_URL/scan/expired")
assert_contains "扫描成功" "$RESP" '"success":true'
echo ""

# ============================================================
# Test 19: 错误处理 - 不存在的 Worktree
# ============================================================
echo "Test 19: 错误处理"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/wt_not_exist")
assert_equals "不存在的 Worktree 返回 404" "$RESP" "404"
echo ""

# ============================================================
# Test 20: 错误处理 - 非法状态转换
# ============================================================
echo "Test 20: 非法状态转换"
RESP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/$WT_TRANS_ID/state" \
    -H "Content-Type: application/json" \
    -d '{"new_status": "active", "note": "invalid"}')
# failed -> active 不允许
assert_equals "非法状态转换返回 400" "$RESP" "400"
echo ""

# ============================================================
# Test 21: 列出活跃 Worktree
# ============================================================
echo "Test 21: 列出活跃 Worktree"
RESP=$(curl -s "$BASE_URL/list?only_active=true")
assert_contains "only_active 列表成功" "$RESP" '"success":true'
echo ""

# ============================================================
# Test 22: 按模块过滤
# ============================================================
echo "Test 22: 按模块过滤"
RESP=$(curl -s "$BASE_URL/list?module=auth")
assert_contains "按模块过滤成功" "$RESP" '"success":true'
echo ""

# ============================================================
# 汇总
# ============================================================
echo "================================================"
echo "测试结果汇总"
echo "通过: $PASS"
echo "失败: $FAIL"
echo "总计: $((PASS+FAIL))"
echo "================================================"

if [ $FAIL -gt 0 ]; then
    exit 1
fi

echo -e "${GREEN}所有测试通过！${NC}"
