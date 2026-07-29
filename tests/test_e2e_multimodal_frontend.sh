#!/bin/bash
# ============================================================
# 多模态模块 - 前端 E2E 测试
# ============================================================
# 核心作用：验证前端页面可访问性 + API 端点联通
# 运行流程：检查前端路由 + 后端 API 健康
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================

set -e

FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

assert_eq() {
    if [ "$1" = "$2" ]; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected to contain '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}=== 多模态前端 E2E 测试 (v6.27.0) ===${NC}"
echo "Frontend: $FRONTEND_URL"
echo "Backend: $BACKEND_URL"
echo ""

# ============================================================
# 1. 前端页面
# ============================================================
echo -e "${YELLOW}[1] 前端路由${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/multimodal")
assert_eq "$HTTP_CODE" "200" "/multimodal 页面可访问"

# ============================================================
# 2. 后端 API 联通
# ============================================================
echo -e "\n${YELLOW}[2] 后端 API 联通${NC}"

RESP=$(curl -s "$BACKEND_URL/api/multimodal/health")
assert_contains "$RESP" '"service":"multimodal"' "后端 multimodal 健康"
assert_contains "$RESP" '"status":"healthy"' "后端 multimodal healthy"

RESP=$(curl -s "$BACKEND_URL/api/multimodal/stats")
assert_contains "$RESP" '"success":true' "stats API"
assert_contains "$RESP" '"total_media"' "stats 字段"

# ============================================================
# 3. 核心 API 端点
# ============================================================
echo -e "\n${YELLOW}[3] 核心 API 端点存在${NC}"

ENDPOINTS=(
    "/api/multimodal/health"
    "/api/multimodal/stats"
    "/api/multimodal/media"
    "/api/multimodal/vision/analyses"
    "/api/multimodal/audio/analyses"
)

for endpoint in "${ENDPOINTS[@]}"; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL$endpoint")
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓${NC} $endpoint → 200"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $endpoint → $HTTP_CODE"
        FAIL=$((FAIL + 1))
    fi
done

# ============================================================
# 总结
# ============================================================
echo ""
echo -e "${YELLOW}=== 测试总结 ===${NC}"
echo "通过: $PASS"
echo "失败: $FAIL"
TOTAL=$((PASS + FAIL))
echo "总计: $TOTAL"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 全部通过！${NC}"
    exit 0
else
    echo -e "${RED}✗ 有失败用例${NC}"
    exit 1
fi
