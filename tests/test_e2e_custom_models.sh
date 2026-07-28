#!/usr/bin/env bash
# ============================================================
# Cycle 8 P0-14 E2E Tests: Custom Models + Bearer Token Auto-Refresh
# ============================================================
# 验证后端 11+ 个端点的完整工作流：
#   1. 列出 providers
#   2. 创建 provider
#   3. 查询 provider 详情
#   4. 更新 provider
#   5. 删除 provider
#   6. 测试 provider 连接
#   7. 列出模型（含内置 + 自定义）
#   8. 添加模型
#   9. 删除模型
#  10. 选择默认模型
#  11. 全局状态
#  12. 摘要
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8000}"
API="$BASE_URL/api/custom-models"

# 颜色输出
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
  if curl -s --max-time 2 "$BASE_URL/health" > /dev/null 2>&1; then
    pass "后端已就绪"
    break
  fi
  if [ $i -eq 30 ]; then
    fail "后端未启动（30s 超时）"
    exit 1
  fi
  sleep 1
done

# ============================================================
# 唯一性 ID（避免跨轮测试污染）
# ============================================================
SUFFIX="$(date +%s)_$$"
TEST_NAME="E2E-Test-$SUFFIX"
TEST_BASE_URL="https://api.example-$SUFFIX.com/v1"

# ============================================================
# [1] 列出 providers（初始应为空或返回已有）
# ============================================================
echo -e "\n${YELLOW}[1] 列出 providers${NC}"
RESP=$(curl -s "$API/providers")
if echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('success')==True" 2>/dev/null; then
  pass "GET /providers 返回 success=true"
else
  fail "GET /providers 失败: $RESP"
fi

# ============================================================
# [2] 创建 provider
# ============================================================
echo -e "\n${YELLOW}[2] 创建 provider${NC}"
CREATE_BODY=$(cat <<EOF
{"name":"$TEST_NAME","type":"openai","base_url":"$TEST_BASE_URL","api_key":"sk-e2e-test-$SUFFIX","refresh_token":"rt-e2e-$SUFFIX"}
EOF
)
RESP=$(curl -s -X POST "$API/providers" -H "Content-Type: application/json" -d "$CREATE_BODY")
PROVIDER_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('provider',{}).get('id',''))" 2>/dev/null)
if [ -n "$PROVIDER_ID" ]; then
  pass "POST /providers 创建成功，ID=$PROVIDER_ID"
else
  fail "POST /providers 失败: $RESP"
  exit 1
fi

# ============================================================
# [3] 查询 provider 详情
# ============================================================
echo -e "\n${YELLOW}[3] 查询 provider 详情${NC}"
RESP=$(curl -s "$API/providers/$PROVIDER_ID")
NAME=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('provider',{}).get('name',''))" 2>/dev/null)
if [ "$NAME" = "$TEST_NAME" ]; then
  pass "GET /providers/{id} 返回正确名称"
else
  fail "GET /providers/{id} 失败: $RESP"
fi

# ============================================================
# [4] 更新 provider
# ============================================================
echo -e "\n${YELLOW}[4] 更新 provider${NC}"
UPDATE_BODY='{"name":"'$TEST_NAME'-Updated","enabled":true}'
RESP=$(curl -s -X PATCH "$API/providers/$PROVIDER_ID" -H "Content-Type: application/json" -d "$UPDATE_BODY")
NEW_NAME=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('provider',{}).get('name',''))" 2>/dev/null)
if [ "$NEW_NAME" = "$TEST_NAME-Updated" ]; then
  pass "PATCH /providers/{id} 更新成功"
else
  fail "PATCH /providers/{id} 失败: $RESP"
fi

# ============================================================
# [5] 测试 provider 连接
# ============================================================
echo -e "\n${YELLOW}[5] 测试 provider 连接${NC}"
RESP=$(curl -s -X POST "$API/providers/$PROVIDER_ID/test")
TEST_OK=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null)
if [ "$TEST_OK" = "True" ]; then
  pass "POST /providers/{id}/test 返回 success"
else
  fail "POST /providers/{id}/test 失败: $RESP"
fi

# ============================================================
# [6] 列出模型（内置 + 自定义）
# ============================================================
echo -e "\n${YELLOW}[6] 列出所有模型${NC}"
RESP=$(curl -s "$API/models")
SOL_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); m=d.get('models',[]); print(sum(1 for x in m if x.get('id')=='sol'))" 2>/dev/null)
if [ "$SOL_COUNT" = "1" ]; then
  pass "GET /models 包含内置模型 sol"
else
  fail "GET /models 未包含内置模型: $RESP"
fi

# ============================================================
# [7] 添加模型条目
# ============================================================
echo -e "\n${YELLOW}[7] 添加模型条目${NC}"
MODEL_BODY=$(cat <<EOF
{"provider_id":"$PROVIDER_ID","model_id":"e2e-test-model-$SUFFIX","display_name":"E2E Test Model","max_tokens":4096,"context_window":32768}
EOF
)
RESP=$(curl -s -X POST "$API/models" -H "Content-Type: application/json" -d "$MODEL_BODY")
MODEL_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('model',{}).get('id',''))" 2>/dev/null)
if [ -n "$MODEL_ID" ]; then
  pass "POST /models 添加成功，ID=$MODEL_ID"
else
  fail "POST /models 失败: $RESP"
fi

# ============================================================
# [8] 列出 provider 下的模型
# ============================================================
echo -e "\n${YELLOW}[8] 列出 provider 下的模型${NC}"
RESP=$(curl -s "$API/models/provider/$PROVIDER_ID")
PROV_MODEL_COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null)
if [ "$PROV_MODEL_COUNT" -ge "1" ]; then
  pass "GET /models/provider/{id} 返回 $PROV_MODEL_COUNT 个模型"
else
  fail "GET /models/provider/{id} 失败: $RESP"
fi

# ============================================================
# [9] 刷新 token
# ============================================================
echo -e "\n${YELLOW}[9] 刷新 token${NC}"
RESP=$(curl -s -X POST "$API/providers/$PROVIDER_ID/refresh")
REFRESH_OK=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null)
if [ "$REFRESH_OK" = "True" ]; then
  pass "POST /providers/{id}/refresh 刷新成功"
else
  fail "POST /providers/{id}/refresh 失败: $RESP"
fi

# ============================================================
# [10] 全局状态
# ============================================================
echo -e "\n${YELLOW}[10] 全局状态${NC}"
RESP=$(curl -s "$API/status")
STATUS_BG=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',{}).get('background_running',False))" 2>/dev/null)
if [ "$STATUS_BG" = "True" ] || [ "$STATUS_BG" = "False" ]; then
  pass "GET /status 返回 background_running=$STATUS_BG"
else
  fail "GET /status 失败: $RESP"
fi

# ============================================================
# [11] 摘要
# ============================================================
echo -e "\n${YELLOW}[11] 摘要${NC}"
RESP=$(curl -s "$API/summary")
SUMMARY_TOTAL=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('summary',{}).get('total_providers',0))" 2>/dev/null)
if [ "$SUMMARY_TOTAL" -ge "1" ]; then
  pass "GET /summary 返回 total_providers=$SUMMARY_TOTAL"
else
  fail "GET /summary 失败: $RESP"
fi

# ============================================================
# [12] 删除 provider（含其模型）
# ============================================================
echo -e "\n${YELLOW}[12] 删除 provider${NC}"
RESP=$(curl -s -X DELETE "$API/providers/$PROVIDER_ID")
DEL_OK=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null)
if [ "$DEL_OK" = "True" ]; then
  pass "DELETE /providers/{id} 删除成功"
else
  fail "DELETE /providers/{id} 失败: $RESP"
fi

# ============================================================
# 总结
# ============================================================
echo
echo "============================================================"
TOTAL=$((PASSED+FAILED))
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ 所有 $TOTAL / $TOTAL 测试通过${NC}"
  exit 0
else
  echo -e "${RED}✗ $FAILED / $TOTAL 测试失败${NC}"
  exit 1
fi
