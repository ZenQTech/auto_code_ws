#!/bin/bash
# ============================================================
# TRAE Work 模块 - 前端 E2E 测试
# ============================================================
# 核心作用：验证前端页面可访问性 + API 端点联通
# 运行流程：检查前端路由 + 后端 API 健康
# 修改记录：
#   - 2026-07-28 | v6.31.0 | Cycle 14 P1-3 初始版本
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

assert_status() {
    if [ "$1" = "$2" ]; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected status '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}=== TRAE Work 前端 E2E 测试 (v6.31.0) ===${NC}"
echo "Frontend: $FRONTEND_URL"
echo "Backend: $BACKEND_URL"
echo ""

# ============================================================
# 1. 前端页面
# ============================================================
echo -e "${YELLOW}[1] 前端路由${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/work")
assert_eq "$HTTP_CODE" "200" "/work 页面可访问"

# ============================================================
# 2. 后端 API 联通
# ============================================================
echo -e "\n${YELLOW}[2] 后端 API 联通${NC}"

RESP=$(curl -s "$BACKEND_URL/api/work/health")
assert_contains "$RESP" '"status":"ok"' "后端 work 健康"
assert_contains "$RESP" '"version":"v6.31.0"' "后端 work 版本"
assert_contains "$RESP" '"design":"ok"' "design 模块 ok"
assert_contains "$RESP" '"voice":"ok"' "voice 模块 ok"
assert_contains "$RESP" '"memory":"ok"' "memory 模块 ok"
assert_contains "$RESP" '"video":"ok"' "video 模块 ok"

RESP=$(curl -s "$BACKEND_URL/api/work/stats")
assert_contains "$RESP" '"success":true' "stats API"
assert_contains "$RESP" '"design"' "stats 包含 design"
assert_contains "$RESP" '"voice"' "stats 包含 voice"
assert_contains "$RESP" '"memory"' "stats 包含 memory"
assert_contains "$RESP" '"video"' "stats 包含 video"

# ============================================================
# 3. Design 子模块
# ============================================================
echo -e "\n${YELLOW}[3] Design 子模块${NC}"

RESP=$(curl -s "$BACKEND_URL/api/work/design/health")
assert_contains "$RESP" '"status":"ok"' "design 健康"
assert_contains "$RESP" '"module":"design"' "design module"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/design/drafts")
assert_eq "$HTTP_CODE" "200" "GET /design/drafts"

# ============================================================
# 4. Voice 子模块
# ============================================================
echo -e "\n${YELLOW}[4] Voice 子模块${NC}"

RESP=$(curl -s "$BACKEND_URL/api/work/voice/health")
assert_contains "$RESP" '"status":"ok"' "voice 健康"
assert_contains "$RESP" '"module":"voice"' "voice module"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/voice/sessions")
assert_eq "$HTTP_CODE" "200" "GET /voice/sessions"

# ============================================================
# 5. Memory 子模块
# ============================================================
echo -e "\n${YELLOW}[5] Memory 子模块${NC}"

RESP=$(curl -s "$BACKEND_URL/api/work/memory/health")
assert_contains "$RESP" '"status":"ok"' "memory 健康"
assert_contains "$RESP" '"module":"memory"' "memory module"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/memory/entries")
assert_eq "$HTTP_CODE" "200" "GET /memory/entries"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/memory/projects")
assert_eq "$HTTP_CODE" "200" "GET /memory/projects"

# ============================================================
# 6. Video 子模块
# ============================================================
echo -e "\n${YELLOW}[6] Video 子模块${NC}"

RESP=$(curl -s "$BACKEND_URL/api/work/video/health")
assert_contains "$RESP" '"status":"ok"' "video 健康"
assert_contains "$RESP" '"module":"video"' "video module"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/video/videos")
assert_eq "$HTTP_CODE" "200" "GET /video/videos"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/work/video/generations")
assert_eq "$HTTP_CODE" "200" "GET /video/generations"

# ============================================================
# 7. 端点总数
# ============================================================
echo -e "\n${YELLOW}[7] 端点完整性${NC}"

ENDPOINTS=(
    "/api/work/health"
    "/api/work/stats"
    "/api/work/design/health"
    "/api/work/design/stats"
    "/api/work/design/drafts"
    "/api/work/design/systems"
    "/api/work/voice/health"
    "/api/work/voice/sessions"
    "/api/work/memory/health"
    "/api/work/memory/entries"
    "/api/work/memory/projects"
    "/api/work/memory/stats"
    "/api/work/video/health"
    "/api/work/video/videos"
    "/api/work/video/generations"
    "/api/work/video/stats"
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
