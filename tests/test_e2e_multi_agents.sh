#!/usr/bin/env bash
# ============================================================
# Cycle 7 P0-10 Multi-Agent v2 E2E 测试
# ============================================================
# 测试范围：/api/multi-agents/* 13 个端点的端到端可用性
#   1. spawn 工具（基本/嵌套/超限/冲突）
#   2. wait 工具（已完成/超时/不存在）
#   3. close 工具（基本/递归/不存在）
#   4. send-message / followup 工具
#   5. list / tree / stats / messages 查询
#   6. auto-cleanup / clear-all 管理
# 前置：后端运行在 http://127.0.0.1:8000
# 运行：bash tests/test_e2e_multi_agents.sh
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-10
# ============================================================

set -e

BASE="${BASE:-http://127.0.0.1:8000}"
SID="e2e_$(date +%s)_$$"
PASS=0
FAIL=0
FAILURES=()

run_test() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" > /tmp/e2e_out 2>&1; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name"
    cat /tmp/e2e_out
    FAIL=$((FAIL+1))
    FAILURES+=("$name")
  fi
}

echo "=== Session ID: $SID ==="
echo

# ----------------------------------------
# [1] 健康检查
# ----------------------------------------
echo "[1] 健康检查"
run_test "GET /health" "curl -s -o /dev/null -w '%{http_code}' $BASE/health | grep -q 200"

# ----------------------------------------
# [2] tree (空)
# ----------------------------------------
echo "[2] tree (空 registry)"
run_test "GET /api/multi-agents/tree" "curl -s -o /dev/null -w '%{http_code}' '$BASE/api/multi-agents/tree?session_id=$SID' | grep -q 200"

# ----------------------------------------
# [3] spawn 工具
# ----------------------------------------
echo "[3] spawn_agent"
run_test "spawn /root/researcher" "curl -s -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root\",\"task_name\":\"researcher\",\"message\":\"分析\"}' | grep -q '\"success\":true'"
run_test "spawn /root/builder" "curl -s -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root\",\"task_name\":\"builder\",\"message\":\"构建\"}' | grep -q '\"success\":true'"
run_test "spawn /root/builder/tester (嵌套)" "curl -s -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root/builder\",\"task_name\":\"tester\",\"message\":\"测试\"}' | grep -q '\"success\":true'"

# 冲突检测
run_test "spawn 同名冲突 → 400" "code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root\",\"task_name\":\"researcher\",\"message\":\"again\"}'); [ \"\$code\" = \"400\" ]"

# 父节点不存在
run_test "spawn 父节点不存在 → 400" "code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root/missing\",\"task_name\":\"x\",\"message\":\"x\"}'); [ \"\$code\" = \"400\" ]"

# ----------------------------------------
# [4] 查询 tree / stats / list
# ----------------------------------------
echo "[4] 查询"
run_test "GET tree 含 3 节点" "curl -s '$BASE/api/multi-agents/tree?session_id=$SID' | grep -q '/root/researcher'"
run_test "GET stats active_slots=3" "curl -s '$BASE/api/multi-agents/stats?session_id=$SID' | grep -q '\"active_slots\":3'"
run_test "GET list parent=/root" "curl -s '$BASE/api/multi-agents/list?session_id=$SID&parent=/root' | grep -q '\"count\":2'"
run_test "GET list status=running" "curl -s '$BASE/api/multi-agents/list?session_id=$SID&status=running' | grep -q '\"count\":4'"  # root + 3 children

# ----------------------------------------
# [5] send_message
# ----------------------------------------
echo "[5] send_message"
run_test "send /root → /root/researcher" "curl -s -X POST '$BASE/api/multi-agents/send-message' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"from_path\":\"/root\",\"to_path\":\"/root/researcher\",\"body\":\"继续\"}' | grep -q '\"success\":true'"
run_test "send 接收方不存在 → 400" "code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/multi-agents/send-message' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"from_path\":\"/root\",\"to_path\":\"/root/missing\",\"body\":\"hi\"}'); [ \"\$code\" = \"400\" ]"
run_test "GET messages" "curl -s '$BASE/api/multi-agents/messages?session_id=$SID' | grep -q '\"count\":1'"

# ----------------------------------------
# [6] signal_completion + wait
# ----------------------------------------
echo "[6] signal_completion + wait"
run_test "signal /root/researcher 完成" "curl -s -X POST '$BASE/api/multi-agents/signal-completion' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"target\":\"/root/researcher\",\"result\":\"OK\"}' | grep -q '\"status\":\"completed\"'"
run_test "wait 已完成节点" "curl -s -X POST '$BASE/api/multi-agents/wait' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"target\":\"/root/researcher\",\"timeout\":1}' | grep -q '\"status\":\"completed\"'"
run_test "wait 不存在 → 404" "code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/multi-agents/wait' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"target\":\"/root/missing\",\"timeout\":1}'); [ \"\$code\" = \"404\" ]"

# ----------------------------------------
# [7] close_agent + recursive
# ----------------------------------------
echo "[7] close_agent"
run_test "close /root/builder recursive" "curl -s -X POST '$BASE/api/multi-agents/close' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"target\":\"/root/builder\",\"recursive\":true}' | grep -q '\"closed\":2'"

# ----------------------------------------
# [8] followup_task 重新激活
# ----------------------------------------
echo "[8] followup_task"
run_test "followup /root/builder" "curl -s -X POST '$BASE/api/multi-agents/followup' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"from_path\":\"/root\",\"to_path\":\"/root/builder\",\"task\":\"重建\"}' | grep -q '\"success\":true'"
run_test "followup 后 stats active=1" "curl -s '$BASE/api/multi-agents/stats?session_id=$SID' | grep -q '\"active_slots\":1'"

# ----------------------------------------
# [9] max_depth 限制
# ----------------------------------------
echo "[9] max_depth 限制"
SID_DEPTH="depth_test_$(date +%s)_$$"
run_test "spawn /root/a/b/c 超出 → 400" "curl -s -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID_DEPTH\",\"parent_path\":\"/root\",\"task_name\":\"a\",\"message\":\"\"}' >/dev/null && curl -s -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID_DEPTH\",\"parent_path\":\"/root/a\",\"task_name\":\"b\",\"message\":\"\"}' >/dev/null && code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/multi-agents/spawn' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID_DEPTH\",\"parent_path\":\"/root/a/b\",\"task_name\":\"c\",\"message\":\"\"}'); [ \"\$code\" = \"400\" ]"
curl -s -X POST "$BASE/api/multi-agents/clear-all" -H 'Content-Type: application/json' -d "{\"session_id\":\"$SID_DEPTH\"}" >/dev/null

# ----------------------------------------
# [10] auto-cleanup
# ----------------------------------------
echo "[10] auto-cleanup"
run_test "auto-cleanup turn" "curl -s -X POST '$BASE/api/multi-agents/auto-cleanup' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\",\"parent_path\":\"/root\"}' | grep -q '\"success\":true'"

# ----------------------------------------
# [11] get_node
# ----------------------------------------
echo "[11] get_node"
run_test "GET node /root/researcher" "curl -s '$BASE/api/multi-agents/node?path=/root/researcher&session_id=$SID' | grep -q '\"success\":true'"
run_test "GET node 不存在 → 404" "code=\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/multi-agents/node?path=/root/missing&session_id=$SID'); [ \"\$code\" = \"404\" ]"

# ----------------------------------------
# [12] force_delete
# ----------------------------------------
echo "[12] force_delete"
run_test "DELETE node /root/researcher" "code=\$(curl -s -o /dev/null -w '%{http_code}' -X DELETE '$BASE/api/multi-agents/node?path=/root/researcher&session_id=$SID'); [ \"\$code\" = \"200\" ]"
run_test "GET node 已删除 → 404" "code=\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/multi-agents/node?path=/root/researcher&session_id=$SID'); [ \"\$code\" = \"404\" ]"

# ----------------------------------------
# [13] clear-all
# ----------------------------------------
echo "[13] clear-all"
run_test "clear-all" "curl -s -X POST '$BASE/api/multi-agents/clear-all' -H 'Content-Type: application/json' -d '{\"session_id\":\"$SID\"}' | grep -q '\"success\":true'"

# ----------------------------------------
# 汇总
# ----------------------------------------
echo
echo "============================================================"
echo "Total: $((PASS+FAIL)) | Passed: $PASS | Failed: $FAIL"
if [ $FAIL -gt 0 ]; then
  echo "Failed tests:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo "✓ All tests passed"
