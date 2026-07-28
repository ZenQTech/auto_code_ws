#!/bin/bash
# ============================================================
# DiffView E2E 测试 (Cycle 9 P1-7)
# ============================================================
# 测试范围：
#   1. 健康检查 /health
#   2. 列出输出格式 /formats
#   3. 工作区 unified diff /api/diff-view/workspace
#   4. 工作区 side_by_side diff
#   5. 工作区 json_patch diff
#   6. 工作区 stats diff
#   7. 任意 ref 对比 /api/diff-view/compare
#   8. 路径过滤 / 状态过滤
#   9. 创建快照 /api/diff-view/snapshots (POST)
#  10. 列出快照 /api/diff-view/snapshots (GET)
#  11. 快照 vs 工作区 diff /api/diff-view/snapshot-vs-worktree
#  12. 恢复快照 /api/diff-view/snapshots/{id}/restore
#  13. 删除快照 /api/diff-view/snapshots/{id} (DELETE)
#  14. 暂存 / 取消暂存 / 全部暂存
#  15. 异常路径（路径越界 / 快照不存在 / 格式非法）
# 目标：≥4 个 E2E 测试用例
# 创建日期：2026-07-28
# 模块版本：v1.0.0
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
TEST_PROJECT="/tmp/test-projects/diff-view-e2e"

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

# 等待服务启动
echo "==> 等待 backend 服务启动..."
READY=0
for i in {1..30}; do
    if curl -s "$BASE_URL/api/diff-view/health" > /dev/null 2>&1; then
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
# 准备测试项目
# ============================================================
echo ""
color_yellow "==> 准备测试项目: $TEST_PROJECT"
rm -rf "$TEST_PROJECT"
mkdir -p "$TEST_PROJECT/src"

# 初始化 git 仓库
git -C "$TEST_PROJECT" init -q
git -C "$TEST_PROJECT" config user.email "test@example.com"
git -C "$TEST_PROJECT" config user.name "Test User"

# 创建初始文件
cat > "$TEST_PROJECT/a.py" << 'EOF'
def hello():
    return "hello world"
EOF
cat > "$TEST_PROJECT/b.py" << 'EOF'
def goodbye():
    return "bye"
EOF
cat > "$TEST_PROJECT/src/utils.py" << 'EOF'
def add(a, b):
    return a + b
EOF

# 首次提交
git -C "$TEST_PROJECT" add .
git -C "$TEST_PROJECT" commit -q -m "init"

# 修改文件以产生 diff
cat > "$TEST_PROJECT/a.py" << 'EOF'
def hello(name):
    return f"hello {name}"

def new_func():
    return 42
EOF
cat > "$TEST_PROJECT/c.py" << 'EOF'
def new_file():
    pass
EOF
color_green "  测试项目就绪"

# ============================================================
# Test 1: 健康检查
# ============================================================
echo ""
echo "==> Test 1: 健康检查 /api/diff-view/health"
RESP=$(curl -s "$BASE_URL/api/diff-view/health")
assert_contains "health success" "$RESP" '"success":true'
assert_contains "health action" "$RESP" '"action":"health"'
assert_contains "health service" "$RESP" '"service":"diff_view"'
assert_contains "health version" "$RESP" '"version":"1.0.0"'
assert_contains "health supported_formats" "$RESP" '"supported_formats"'
assert_contains "health unified format" "$RESP" '"unified"'
assert_contains "health side_by_side format" "$RESP" '"side_by_side"'
assert_contains "health json_patch format" "$RESP" '"json_patch"'
assert_contains "health stats format" "$RESP" '"stats"'

# ============================================================
# Test 2: 列出输出格式
# ============================================================
echo ""
echo "==> Test 2: 列出输出格式 /api/diff-view/formats"
RESP=$(curl -s "$BASE_URL/api/diff-view/formats")
assert_contains "formats success" "$RESP" '"success":true'
assert_contains "formats action" "$RESP" '"action":"list_formats"'
assert_contains "format 1 name" "$RESP" '"name":"unified"'
assert_contains "format 1 desc" "$RESP" '"description":"'
assert_contains "format 2 name" "$RESP" '"name":"side_by_side"'
assert_contains "format 3 name" "$RESP" '"name":"json_patch"'
assert_contains "format 4 name" "$RESP" '"name":"stats"'

# ============================================================
# Test 3: 工作区 unified diff
# ============================================================
echo ""
echo "==> Test 3: 工作区 unified diff /api/diff-view/workspace"
REQ_BODY=$(printf '{"project_path":"%s","format":"unified"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "unified success" "$RESP" '"success":true'
assert_contains "unified action" "$RESP" '"action":"diff_workspace"'
assert_contains "unified format" "$RESP" '"format":"unified"'
assert_contains "unified a.py" "$RESP" '"path":"a.py"'
assert_contains "unified c.py" "$RESP" '"path":"c.py"'
assert_contains "unified patch_unified field" "$RESP" '"patch_unified"'
assert_contains "unified lines field" "$RESP" '"lines"'
assert_contains "unified stats field" "$RESP" '"stats"'
assert_contains "unified total_files" "$RESP" '"total_files"'
assert_contains "unified total_additions" "$RESP" '"total_additions"'

# ============================================================
# Test 4: 工作区 side_by_side diff
# ============================================================
echo ""
echo "==> Test 4: 工作区 side_by_side diff"
REQ_BODY=$(printf '{"project_path":"%s","format":"side_by_side","path_filter":"a.py"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "side_by_side success" "$RESP" '"success":true'
assert_contains "side_by_side format" "$RESP" '"format":"side_by_side"'
assert_contains "side_by_side rows" "$RESP" '"rows"'
assert_contains "side_by_side row_count" "$RESP" '"row_count"'
assert_contains "side_by_side left type" "$RESP" '"left"'
assert_contains "side_by_side right type" "$RESP" '"right"'
# path_filter 限定为 a.py
assert_not_contains "side_by_side excludes c.py path" "$RESP" '"path":"c.py"'

# ============================================================
# Test 5: 工作区 json_patch diff
# ============================================================
echo ""
echo "==> Test 5: 工作区 json_patch diff"
REQ_BODY=$(printf '{"project_path":"%s","format":"json_patch","path_filter":"a.py"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "json_patch success" "$RESP" '"success":true'
assert_contains "json_patch format" "$RESP" '"format":"json_patch"'
assert_contains "json_patch op field" "$RESP" '"op":'
assert_contains "json_patch line field" "$RESP" '"line":'
assert_contains "json_patch content field" "$RESP" '"content"'

# ============================================================
# Test 6: 工作区 stats diff
# ============================================================
echo ""
echo "==> Test 6: 工作区 stats diff"
REQ_BODY=$(printf '{"project_path":"%s","format":"stats"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "stats success" "$RESP" '"success":true'
assert_contains "stats format" "$RESP" '"format":"stats"'
# stats 模式下 lines 字段应为空数组
assert_contains "stats total_additions" "$RESP" '"total_additions"'
assert_contains "stats total_deletions" "$RESP" '"total_deletions"'
assert_contains "stats by_status" "$RESP" '"by_status"'

# ============================================================
# Test 7: 状态过滤
# ============================================================
echo ""
echo "==> Test 7: 状态过滤 status_filter=untracked"
REQ_BODY=$(printf '{"project_path":"%s","format":"unified","status_filter":["untracked"]}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "status_filter success" "$RESP" '"success":true'
# 仅 c.py 是 untracked
assert_contains "status_filter includes c.py" "$RESP" '"path":"c.py"'
# a.py 是 modified，不应出现
assert_not_contains "status_filter excludes modified a.py" "$RESP" '"path":"a.py"'

# ============================================================
# Test 8: 任意 ref 对比
# ============================================================
echo ""
echo "==> Test 8: 任意 ref 对比 /api/diff-view/compare"
REQ_BODY=$(printf '{"project_path":"%s","base_ref":"HEAD","target_ref":"WORKTREE","format":"unified"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/compare" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "compare success" "$RESP" '"success":true'
assert_contains "compare action" "$RESP" '"action":"diff_compare"'
assert_contains "compare base_ref" "$RESP" '"base_ref":"HEAD"'
assert_contains "compare target_ref" "$RESP" '"target_ref":"WORKTREE"'

# 提交一次后再比较
git -C "$TEST_PROJECT" add .
git -C "$TEST_PROJECT" commit -q -m "v2"
REQ_BODY=$(printf '{"project_path":"%s","base_ref":"HEAD~1","target_ref":"HEAD","format":"unified"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/compare" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "compare head~1->head" "$RESP" '"success":true'
assert_contains "compare base_ref" "$RESP" '"base_ref":"HEAD~1"'

# ============================================================
# Test 9: 创建快照
# ============================================================
echo ""
echo "==> Test 9: 创建快照 /api/diff-view/snapshots (POST)"
REQ_BODY=$(printf '{"project_path":"%s","label":"v1-snap","description":"initial state"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/snapshots" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "create_snap success" "$RESP" '"success":true'
assert_contains "create_snap action" "$RESP" '"action":"create_snapshot"'
assert_contains "create_snap label" "$RESP" '"label":"v1-snap"'
assert_contains "create_snap description" "$RESP" '"description":"initial state"'
assert_contains "create_snap file_count" "$RESP" '"file_count"'
assert_contains "create_snap total_size" "$RESP" '"total_size"'
assert_contains "create_snap file_hashes" "$RESP" '"file_hashes"'

# 提取 snapshot_id
SNAP_ID=$(echo "$RESP" | python3 -c "import json, sys; print(json.load(sys.stdin)['snapshot']['id'])")
color_green "  → snapshot_id: $SNAP_ID"

# ============================================================
# Test 10: 列出快照
# ============================================================
echo ""
echo "==> Test 10: 列出快照 /api/diff-view/snapshots (GET)"
RESP=$(curl -s "$BASE_URL/api/diff-view/snapshots?project_path=$TEST_PROJECT")
assert_contains "list_snap success" "$RESP" '"success":true'
assert_contains "list_snap action" "$RESP" '"action":"list_snapshots"'
assert_contains "list_snap count field" "$RESP" '"count"'
assert_contains "list_snap includes snap" "$RESP" "\"id\":\"$SNAP_ID\""
assert_contains "list_snap label" "$RESP" '"label":"v1-snap"'

# ============================================================
# Test 11: 快照 vs 工作区 diff
# ============================================================
echo ""
echo "==> Test 11: 快照 vs 工作区 diff"
# 修改 a.py 后再 diff
cat > "$TEST_PROJECT/a.py" << 'EOF'
def hello(name):
    return f"hello {name}-modified"
EOF
REQ_BODY=$(printf '{"project_path":"%s","snapshot_id":"%s"}' "$TEST_PROJECT" "$SNAP_ID")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/snapshot-vs-worktree" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "snap_vs_wt success" "$RESP" '"success":true'
assert_contains "snap_vs_wt action" "$RESP" '"action":"diff_snapshot"'
assert_contains "snap_vs_wt includes a.py" "$RESP" '"path":"a.py"'
assert_contains "snap_vs_wt base_ref" "$RESP" "\"base_ref\":\"snapshot:$SNAP_ID\""
assert_contains "snap_vs_wt target_ref" "$RESP" '"target_ref":"WORKTREE"'

# ============================================================
# Test 12: 恢复快照
# ============================================================
echo ""
echo "==> Test 12: 恢复快照 /api/diff-view/snapshots/{id}/restore"
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/snapshots/$SNAP_ID/restore?project_path=$TEST_PROJECT")
assert_contains "restore success" "$RESP" '"success":true'
assert_contains "restore action" "$RESP" '"action":"restore_snapshot"'
assert_contains "restore snapshot_id" "$RESP" "\"snapshot_id\":\"$SNAP_ID\""
assert_contains "restore file_count" "$RESP" '"file_count"'
# 验证 a.py 已恢复
RESTORED_CONTENT=$(cat "$TEST_PROJECT/a.py")
if [[ "$RESTORED_CONTENT" == *'hello {name}"'* ]] && [[ "$RESTORED_CONTENT" != *"modified"* ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ a.py 已恢复为快照内容"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ a.py 未正确恢复: $RESTORED_CONTENT"
fi

# ============================================================
# Test 13: 暂存控制
# ============================================================
echo ""
echo "==> Test 13: 暂存控制 stage / unstage / stage-all"
# 修改 a.py 后暂存
cat > "$TEST_PROJECT/a.py" << 'EOF'
def hello(name):
    return f"hello {name}-stage-test"
EOF
REQ_BODY=$(printf '{"project_path":"%s","file_path":"a.py"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/stage" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "stage success" "$RESP" '"success":true'
assert_contains "stage action" "$RESP" '"action":"stage"'
assert_contains "stage file_path" "$RESP" '"file_path":"a.py"'

# 取消暂存
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/unstage" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "unstage success" "$RESP" '"success":true'
assert_contains "unstage action" "$RESP" '"action":"unstage"'

# 全部暂存
REQ_BODY=$(printf '{"project_path":"%s"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/stage-all" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "stage_all success" "$RESP" '"success":true'
assert_contains "stage_all action" "$RESP" '"action":"stage_all"'

# ============================================================
# Test 14: 删除快照
# ============================================================
echo ""
echo "==> Test 14: 删除快照 /api/diff-view/snapshots/{id} (DELETE)"
RESP=$(curl -s -X DELETE "$BASE_URL/api/diff-view/snapshots/$SNAP_ID?project_path=$TEST_PROJECT")
assert_contains "delete success" "$RESP" '"success":true'
assert_contains "delete action" "$RESP" '"action":"delete_snapshot"'
assert_contains "delete snapshot_id" "$RESP" "\"snapshot_id\":\"$SNAP_ID\""

# 列出应不再包含
RESP=$(curl -s "$BASE_URL/api/diff-view/snapshots?project_path=$TEST_PROJECT")
if [[ "$RESP" == *"\"id\":\"$SNAP_ID\""* ]]; then
    FAILED=$((FAILED + 1))
    color_red "  ✗ 列表中不应再包含已删除的快照"
else
    PASSED=$((PASSED + 1))
    color_green "  ✓ 列表中已不包含已删除的快照"
fi

# ============================================================
# Test 15: 异常路径
# ============================================================
echo ""
echo "==> Test 15: 异常路径"
# 路径越界（空字符串触发 Pydantic min_length=1 校验，返回 422）
REQ_BODY='{"project_path":"","format":"unified"}'
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY" -w "\n%{http_code}")
STATUS=$(echo "$RESP" | tail -1)
if [[ "$STATUS" == "400" || "$STATUS" == "422" ]]; then
    PASSED=$((PASSED + 1))
    color_green "  ✓ empty path returns 4xx (status=$STATUS)"
else
    FAILED=$((FAILED + 1))
    color_red "  ✗ empty path expected 4xx, got $STATUS"
fi

# 非法格式
REQ_BODY=$(printf '{"project_path":"%s","format":"invalid_format"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/workspace" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY" -w "\n%{http_code}")
STATUS=$(echo "$RESP" | tail -1)
assert_contains "invalid format returns 400" "$STATUS" '400'

# 不存在的快照
REQ_BODY=$(printf '{"project_path":"%s","snapshot_id":"nonexistent_xyz"}' "$TEST_PROJECT")
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/snapshot-vs-worktree" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY")
assert_contains "nonexistent snapshot returns error" "$RESP" '"success":false'

# 删除不存在的快照
RESP=$(curl -s -X DELETE "$BASE_URL/api/diff-view/snapshots/nonexistent_xyz?project_path=$TEST_PROJECT" -w "\n%{http_code}")
STATUS=$(echo "$RESP" | tail -1)
assert_contains "delete nonexistent returns 404" "$STATUS" '404'

# 路径越界 - 暂存项目外文件
REQ_BODY='{"project_path":"/tmp/diff-view-e2e","file_path":"../escape.py"}'
RESP=$(curl -s -X POST "$BASE_URL/api/diff-view/stage" \
    -H "Content-Type: application/json" \
    -d "$REQ_BODY" -w "\n%{http_code}")
STATUS=$(echo "$RESP" | tail -1)
assert_contains "path traversal returns 400" "$STATUS" '400'

# ============================================================
# 汇总
# ============================================================
echo ""
echo "============================================================"
TOTAL=$((PASSED + FAILED))
echo "总断言数: $TOTAL"
echo "通过: $PASSED"
echo "失败: $FAILED"
echo "============================================================"

if [[ $FAILED -gt 0 ]]; then
    color_red "✗ E2E 测试未通过"
    exit 1
fi
color_green "✓ E2E 测试全部通过"
exit 0
