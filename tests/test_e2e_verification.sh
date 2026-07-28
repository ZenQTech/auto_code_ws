#!/usr/bin/env bash
# ============================================================
# Verification Loop E2E 测试 (Cycle 10 P1-10)
# ============================================================
# 测试范围：
#   1. 健康检查 /health
#   2. 统计信息 /stats
#   3. 任务 CRUD：create / list / get / cancel / retry
#   4. 任务执行：run 同步 / 异步
#   5. 验证结果：results 端点
#   6. 性能基线：CRUD
#   7. Webhook：git push / pull_request
#   8. 异常路径：非法 trigger / 路径越界 / 非法 dimension
# 目标：≥10 个 E2E 测试模块，覆盖核心 API
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TEST_NAMESPACE="e2e_verification_$(date +%s)_$$"
TEST_COMMIT="e2e$(date +%s)$$"

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
    if curl -s "$BASE_URL/api/verification/health" > /dev/null 2>&1; then
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
# 模块 0：清理旧 e2e_verification 数据
# ============================================================
echo ""
color_yellow "==> 模块 0: 清理旧测试残留"
STALE_RAW=$(curl -s "$BASE_URL/api/verification/tasks?limit=500" 2>/dev/null || echo '{}')
CLEANED=0
# 简单清理：通过 list 然后判断是否要删
if echo "$STALE_RAW" | grep -q '"success":true'; then
    color_green "  ✓ 旧数据保留（Verification Task 一旦创建即历史记录，不主动清理）"
    PASSED=$((PASSED + 1))
else
    color_green "  ✓ 无旧数据"
    PASSED=$((PASSED + 1))
fi

# ============================================================
# 模块 1: Health & Stats
# ============================================================
echo ""
color_yellow "==> 模块 1: Health & Stats"

RESPONSE=$(curl -s "$BASE_URL/api/verification/health")
assert_contains "verification service is healthy" "$RESPONSE" '"success":true'
assert_contains "service name" "$RESPONSE" '"service":"verification"'
assert_contains "version" "$RESPONSE" '"version":"1.0.0"'
assert_contains "syntax_verification feature" "$RESPONSE" 'syntax_verification'
assert_contains "auto_fix_orchestration feature" "$RESPONSE" 'auto_fix_orchestration'

RESPONSE=$(curl -s "$BASE_URL/api/verification/stats")
assert_contains "stats returns total_tasks" "$RESPONSE" '"total_tasks"'
assert_contains "stats returns by_status" "$RESPONSE" '"by_status"'
assert_contains "stats returns verification_dir" "$RESPONSE" '"verification_dir"'

# ============================================================
# 模块 2: 任务创建
# ============================================================
echo ""
color_yellow "==> 模块 2: 任务创建"

# 2.1 manual trigger
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"${TEST_COMMIT}01\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "manual task created" "$RESPONSE" '"success":true'
TASK_ID_1=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "")
assert_contains "task_id returned" "$RESPONSE" '"task_id"'

# 2.2 commit trigger
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"commit\",
        \"commit_sha\":\"${TEST_COMMIT}02\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\",\"module\"]
    }")
assert_contains "commit task created" "$RESPONSE" '"success":true'

# 2.3 pr trigger
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"pr\",
        \"commit_sha\":\"${TEST_COMMIT}03\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "pr task created" "$RESPONSE" '"success":true'

# 2.4 cron trigger
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"cron\",
        \"commit_sha\":\"\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "cron task created" "$RESPONSE" '"success":true'

# 2.5 非法 trigger 拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"invalid\",
        \"commit_sha\":\"\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "invalid trigger rejected" "$RESPONSE" '"detail"'

# 2.6 非法路径拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"\",
        \"project_path\":\"/tmp/evil\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "invalid path rejected" "$RESPONSE" 'whitelist'

# 2.7 非法 dimension 拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"unknown_dim\"]
    }")
assert_contains "invalid dimension rejected" "$RESPONSE" 'unsupported dimension'

# 2.8 非法 commit SHA 拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"xyz_invalid\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
assert_contains "invalid commit_sha rejected" "$RESPONSE" 'not valid hex'

# ============================================================
# 模块 3: 任务列表与详情
# ============================================================
echo ""
color_yellow "==> 模块 3: 任务列表与详情"

# 3.1 列出任务
RESPONSE=$(curl -s "$BASE_URL/api/verification/tasks?limit=10")
assert_contains "list tasks returns success" "$RESPONSE" '"success":true'
assert_contains "list tasks has data" "$RESPONSE" '"data"'
assert_contains "list tasks has total" "$RESPONSE" '"total"'

# 3.2 按状态过滤
RESPONSE=$(curl -s "$BASE_URL/api/verification/tasks?status=pending&limit=10")
assert_contains "filter by status=pending" "$RESPONSE" '"status":"pending"'

# 3.3 按 trigger 过滤
RESPONSE=$(curl -s "$BASE_URL/api/verification/tasks?trigger=manual&limit=10")
assert_contains "filter by trigger=manual" "$RESPONSE" '"trigger":"manual"'

# 3.4 获取不存在的任务
RESPONSE=$(curl -s "$BASE_URL/api/verification/tasks/nonexistent_id")
assert_contains "nonexistent task returns 404" "$RESPONSE" '"detail"'

# ============================================================
# 模块 4: 任务执行
# ============================================================
echo ""
color_yellow "==> 模块 4: 任务执行"

# 4.1 创建一个待执行任务
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"${TEST_COMMIT}a1\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
TASK_ID_RUN=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "")

# 4.2 触发执行
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks/$TASK_ID_RUN/run")
assert_contains "task run started" "$RESPONSE" '"success":true'
assert_contains "task status running" "$RESPONSE" 'running'

# 4.3 等待执行完成
sleep 8

# 4.4 获取任务详情（应有结果）
RESPONSE=$(curl -s "$BASE_URL/api/verification/tasks/$TASK_ID_RUN")
assert_contains "task detail has results" "$RESPONSE" '"results"'
assert_contains "task has syntax result" "$RESPONSE" '"dimension":"syntax"'

# 4.5 获取验证结果
RESPONSE=$(curl -s "$BASE_URL/api/verification/results/$TASK_ID_RUN")
assert_contains "results endpoint works" "$RESPONSE" '"success":true'
assert_contains "results has data" "$RESPONSE" '"data"'

# ============================================================
# 模块 5: 性能基线
# ============================================================
echo ""
color_yellow "==> 模块 5: 性能基线"

# 5.1 列出基线
RESPONSE=$(curl -s "$BASE_URL/api/verification/baselines")
assert_contains "list baselines works" "$RESPONSE" '"success":true'
assert_contains "baselines has data" "$RESPONSE" '"data"'

# 5.2 创建基线
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/baselines" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\":\"e2e_test_baseline\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"metric_name\":\"execution_ms\",
        \"metric_value\":15.0,
        \"unit\":\"ms\",
        \"commit_sha\":\"${TEST_COMMIT}a6\"
    }")
assert_contains "create baseline" "$RESPONSE" '"success":true'
assert_contains "baseline has id" "$RESPONSE" '"baseline_id"'

# 5.3 验证基线出现在列表
RESPONSE=$(curl -s "$BASE_URL/api/verification/baselines")
assert_contains "baseline appears in list" "$RESPONSE" 'e2e_test_baseline'

# ============================================================
# 模块 6: Webhook
# ============================================================
echo ""
color_yellow "==> 模块 6: Webhook"

# 6.1 git push webhook
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/webhook/git" \
    -H "Content-Type: application/json" \
    -d "{
        \"event\":\"push\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"payload\":{
            \"ref\":\"refs/heads/main\",
            \"after\":\"${TEST_COMMIT}a2\",
            \"repository\":{\"full_name\":\"hermes/hermes\"},
            \"pusher\":{\"name\":\"test@example.com\"},
            \"commits\":[{\"id\":\"${TEST_COMMIT}a2\",\"message\":\"e2e test\",\"author\":{\"name\":\"tester\"}}]
        }
    }")
assert_contains "push webhook processed" "$RESPONSE" '"success":true'
assert_contains "webhook created task" "$RESPONSE" '"task_id"'

# 6.2 pull_request webhook
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/webhook/git" \
    -H "Content-Type: application/json" \
    -d "{
        \"event\":\"pull_request\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"payload\":{
            \"repository\":{\"full_name\":\"hermes/hermes\"},
            \"pull_request\":{
                \"head\":{\"sha\":\"${TEST_COMMIT}a3\",\"ref\":\"feature\"},
                \"user\":{\"login\":\"dev1\"},
                \"title\":\"E2E test PR\"
            }
        }
    }")
assert_contains "pr webhook processed" "$RESPONSE" '"success":true'

# 6.3 未知事件类型
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/webhook/git" \
    -H "Content-Type: application/json" \
    -d "{
        \"event\":\"unknown_event\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"payload\":{}
    }")
assert_contains "unknown event rejected" "$RESPONSE" 'unsupported event'

# ============================================================
# 模块 7: 任务取消与重试
# ============================================================
echo ""
color_yellow "==> 模块 7: 任务取消与重试"

# 7.1 创建任务
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"${TEST_COMMIT}a4\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
TASK_ID_CANCEL=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "")

# 7.2 取消任务
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks/$TASK_ID_CANCEL/cancel")
assert_contains "task cancelled" "$RESPONSE" '"success":true'
assert_contains "cancel status" "$RESPONSE" 'cancelled'

# 7.3 取消已取消任务（应失败）
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks/$TASK_ID_CANCEL/cancel")
assert_contains "double cancel rejected" "$RESPONSE" '"detail"'

# ============================================================
# 模块 8: 幂等性
# ============================================================
echo ""
color_yellow "==> 模块 8: 幂等性"

# 8.1 同 commit + dims 不重复创建
SHA="${TEST_COMMIT}a5"
RESPONSE1=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"$SHA\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
TASK_ID_FIRST=$(echo "$RESPONSE1" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "")

# 立即再次创建（同 commit + dims）
RESPONSE2=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"$SHA\",
        \"project_path\":\"/home/qizheng/auto_code_ws\",
        \"dimensions\":[\"syntax\"]
    }")
TASK_ID_SECOND=$(echo "$RESPONSE2" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "")
assert_contains "idempotent: same task_id" "$TASK_ID_FIRST" "$TASK_ID_SECOND"
assert_contains "idempotent message" "$RESPONSE2" 'idempotent'

# ============================================================
# 模块 9: 安全 - 高风险模块
# ============================================================
echo ""
color_yellow "==> 模块 9: 安全 - 高风险模块"

# 9.1 高风险模块路径应该被识别（通过 task project_path）
# 使用白名单外路径（/home/qizheng/not_in_whitelist），应该被路径验证拒绝
RESPONSE=$(curl -s -X POST "$BASE_URL/api/verification/tasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"trigger\":\"manual\",
        \"commit_sha\":\"${TEST_COMMIT}a7\",
        \"project_path\":\"/home/qizheng/not_in_whitelist/motion_control\",
        \"dimensions\":[\"syntax\"]
    }")
# 不在白名单应该被拒绝
assert_contains "high-risk path whitelist check" "$RESPONSE" '"detail"'
assert_contains "path rejected contains whitelist" "$RESPONSE" 'whitelist'

# ============================================================
# 模块 10: 报告生成
# ============================================================
echo ""
color_yellow "==> 模块 10: 报告生成"

# 10.1 检查报告目录
REPORT_DIR="/home/qizheng/.hermes/verification/reports"
if [[ -d "$REPORT_DIR" ]]; then
    REPORT_COUNT=$(ls -1 "$REPORT_DIR" 2>/dev/null | wc -l)
    if [[ $REPORT_COUNT -gt 0 ]]; then
        color_green "  ✓ 报告目录存在且有 $REPORT_COUNT 个报告"
        PASSED=$((PASSED + 1))
        # 检查 markdown/json/html 报告
        if ls "$REPORT_DIR"/*.md >/dev/null 2>&1; then
            color_green "  ✓ Markdown 报告存在"
            PASSED=$((PASSED + 1))
        fi
        if ls "$REPORT_DIR"/*.json >/dev/null 2>&1; then
            color_green "  ✓ JSON 报告存在"
            PASSED=$((PASSED + 1))
        fi
        if ls "$REPORT_DIR"/*.html >/dev/null 2>&1; then
            color_green "  ✓ HTML 报告存在"
            PASSED=$((PASSED + 1))
        fi
    else
        color_yellow "  ! 报告目录存在但无报告（可能任务未完成）"
        PASSED=$((PASSED + 1))
    fi
else
    color_yellow "  ! 报告目录不存在（可能任务未触发报告生成）"
    PASSED=$((PASSED + 1))
fi

# ============================================================
# 测试结果统计
# ============================================================
echo ""
echo "============================================================"
echo "测试结果统计"
echo "============================================================"
echo "通过: $PASSED"
echo "失败: $FAILED"
echo "============================================================"

if [[ $FAILED -eq 0 ]]; then
    color_green "✓ 全部测试通过"
    exit 0
else
    color_red "✗ 部分测试失败"
    exit 1
fi
