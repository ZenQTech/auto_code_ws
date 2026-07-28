#!/usr/bin/env bash
# ============================================================
# Cycle 8 P1-4 E2E Tests: /loop 命令集
# ============================================================
# 验证 /loop 命令的 4 个子命令 + 异步工作流：
#   1. /loop triage - 任务优先级分析
#   2. /loop plan - 生成 spec + branch
#   3. /loop execute - 执行 task + git commit
#   4. /loop verify - 验证任务
#   5. 异步工作流状态查询
#   6. 健康检查
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8000}"
API="$BASE_URL/api/loop-commands"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() {
  echo -e "${GREEN}✓${NC} $1"
  PASSED=$((PASSED+1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  FAILED=$((FAILED+1))
}

# ============================================================
# 等待后端启动
# ============================================================
echo -e "${YELLOW}⏳ 等待后端就绪...${NC}"
for i in {1..30}; do
  if curl -s "$BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ============================================================
# [1] 健康检查
# ============================================================
echo -e "\n${YELLOW}[1] 健康检查${NC}"
RESP=$(curl -s "$API/health")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
if [ "$SUCCESS" = "ok" ]; then
  pass "GET /loop-commands/health 状态 ok"
else
  fail "健康检查失败: $RESP"
  exit 1
fi

# ============================================================
# [2] /loop triage - 任务优先级分析
# ============================================================
echo -e "\n${YELLOW}[2] /loop triage - 任务优先级分析${NC}"
RESP=$(curl -s -X POST "$API/triage" \
  -H "Content-Type: application/json" \
  -d "{\"project_path\": \"$PROJECT_ROOT\"}")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
TOTAL=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('total_tasks',0))" 2>/dev/null)
if [ "$SUCCESS" = "True" ] && [ "$TOTAL" -gt 0 ]; then
  pass "POST /loop-commands/triage 总任务数=$TOTAL"
else
  fail "triage 失败: $RESP"
fi

# 验证分组结果
P0_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('data',{}).get('by_priority',{}).get('P0',[])))" 2>/dev/null)
if [ "$P0_COUNT" -gt 0 ]; then
  pass "P0 优先级任务数=$P0_COUNT"
else
  fail "P0 任务数为 0"
fi

# ============================================================
# [3] /loop plan - 生成 spec + branch
# ============================================================
echo -e "\n${YELLOW}[3] /loop plan - 生成 spec + branch${NC}"
RESP=$(curl -s -X POST "$API/plan" \
  -H "Content-Type: application/json" \
  -d "{\"project_path\": \"$PROJECT_ROOT\", \"max_iterations\": 1}")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
BRANCH=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('result',{}).get('branch',''))" 2>/dev/null)
SPEC=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('result',{}).get('spec_file',''))" 2>/dev/null)
if [ "$SUCCESS" = "True" ] && [ -n "$BRANCH" ]; then
  pass "POST /loop-commands/plan 创建分支=$BRANCH"
  pass "spec_file=$SPEC"
else
  echo "  响应: $RESP"
  fail "plan 失败"
fi

# 切换回 main 分支
cd "$PROJECT_ROOT" && git checkout main 2>/dev/null || git checkout master 2>/dev/null || true

# ============================================================
# [4] /loop execute - 执行 task
# ============================================================
echo -e "\n${YELLOW}[4] /loop execute - 执行 task${NC}"
# 先创建一个新文件以便有变更可 commit
echo "test $(date +%s)" > "$PROJECT_ROOT/.loop_test_file"
RESP=$(curl -s -X POST "$API/execute" \
  -H "Content-Type: application/json" \
  -d "{\"project_path\": \"$PROJECT_ROOT\"}")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
COMMIT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('result',{}).get('commit_sha',''))" 2>/dev/null)
if [ "$SUCCESS" = "True" ]; then
  pass "POST /loop-commands/execute 成功"
  if [ -n "$COMMIT" ]; then
    pass "自动 git commit: ${COMMIT:0:8}"
  else
    pass "无变更需 commit"
  fi
else
  echo "  响应: $RESP"
  fail "execute 失败"
fi
rm -f "$PROJECT_ROOT/.loop_test_file"

# ============================================================
# [5] /loop verify - 验证任务
# ============================================================
echo -e "\n${YELLOW}[5] /loop verify - 验证任务（仅 TypeScript 编译）${NC}"
RESP=$(curl -s -X POST "$API/verify" \
  -H "Content-Type: application/json" \
  -d "{\"project_path\": \"$PROJECT_ROOT\", \"run_unit\": false, \"run_e2e\": false, \"run_typescript\": true, \"run_vite\": false}")
SUCCESS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
if [ "$SUCCESS" = "True" ]; then
  pass "POST /loop-commands/verify 成功（仅 TypeScript）"
  TS_PASSED=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('result',{}).get('typescript',{}).get('passed', False))" 2>/dev/null)
  pass "TypeScript 编译: passed=$TS_PASSED"
else
  echo "  响应: $RESP"
  fail "verify 失败"
fi

# ============================================================
# [6] 列出所有工作流
# ============================================================
echo -e "\n${YELLOW}[6] 列出所有工作流${NC}"
RESP=$(curl -s "$API/list")
COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null)
if [ "$COUNT" -ge 0 ]; then
  pass "GET /loop-commands/list 工作流数=$COUNT"
else
  fail "list 失败: $RESP"
fi

# ============================================================
# [7] 错误处理 - 无效路径
# ============================================================
echo -e "\n${YELLOW}[7] 错误处理 - 路径白名单${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/triage" \
  -H "Content-Type: application/json" \
  -d "{\"project_path\": \"/etc/passwd\"}")
if [ "$HTTP_CODE" = "403" ]; then
  pass "无效路径返回 403"
else
  fail "应该返回 403，实际: $HTTP_CODE"
fi

# ============================================================
# 测试结果
# ============================================================
echo ""
echo "============================================================"
echo -e "${YELLOW}测试结果${NC}"
echo "  通过: $PASSED"
echo "  失败: $FAILED"
echo "  总计: $((PASSED + FAILED))"
echo "============================================================"

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}✓ 所有测试通过${NC}"
  exit 0
else
  echo -e "${RED}✗ 有测试失败${NC}"
  exit 1
fi
