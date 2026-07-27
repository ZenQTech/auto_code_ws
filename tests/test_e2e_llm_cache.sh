#!/bin/bash
# ============================================================
# LLM 缓存 API E2E 测试 - Cycle 6 P0-7-A
# ============================================================
# 覆盖：
#   1. GET  /api/cache/stats - 初始空统计
#   2. GET  /api/cache/config - 获取配置
#   3. POST /api/cache/put - 写入缓存
#   4. POST /api/cache/test - 测试查找（命中）
#   5. GET  /api/cache/stats - 命中后统计更新
#   6. POST /api/cache/clear - 清空
#   7. GET  /api/cache/stats - 清空后统计重置
#   8. POST /api/cache/reset - 重置管理器
#   9. 错误用例：test 未命中
# ============================================================
set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

test_pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "  ${GREEN}✓${NC} $1"
}

test_fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "  ${RED}✗${NC} $1"
    if [ -n "$2" ]; then
        echo -e "    ${RED}Detail:${NC} $2"
    fi
}

wait_for_backend() {
    echo -e "${YELLOW}⏳ 等待后端启动...${NC}"
    for i in $(seq 1 30); do
        if curl -s -f "$BASE_URL/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ 后端已就绪${NC}"
            return 0
        fi
        sleep 1
    done
    echo -e "${RED}✗ 后端未在 30s 内启动${NC}"
    return 1
}

echo "=========================================="
echo "  LLM 缓存 API E2E 测试"
echo "  BASE_URL: $BASE_URL"
echo "=========================================="

wait_for_backend

# 0. 重置缓存确保测试隔离
echo ""
echo "[0] POST /api/cache/reset"
RESET_RESP=$(curl -s -X POST "$BASE_URL/api/cache/reset")
if echo "$RESET_RESP" | grep -q '"success":true'; then
    test_pass "重置缓存管理器成功"
else
    test_fail "重置缓存管理器失败" "$RESET_RESP"
fi

# 1. 初始空统计
echo ""
echo "[1] GET /api/cache/stats (初始)"
STATS=$(curl -s -X GET "$BASE_URL/api/cache/stats")
echo "  Response: $STATS"
TOTAL=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['total_requests'])")
L1_HITS=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['l1_hits'])")
if [ "$TOTAL" = "0" ] && [ "$L1_HITS" = "0" ]; then
    test_pass "初始统计全为 0"
else
    test_fail "初始统计异常" "total=$TOTAL l1_hits=$L1_HITS"
fi

# 2. 获取配置
echo ""
echo "[2] GET /api/cache/config"
CONFIG=$(curl -s -X GET "$BASE_URL/api/cache/config")
echo "  Response: $CONFIG"
L1_MAX=$(echo "$CONFIG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['config']['l1_max_size'])")
if [ "$L1_MAX" -gt 0 ]; then
    test_pass "L1 最大容量 = $L1_MAX"
else
    test_fail "L1 容量异常" "$L1_MAX"
fi

# 3. 写入缓存
echo ""
echo "[3] POST /api/cache/put"
PUT_BODY='{"system":"你是一个 Python 专家","user":"什么是装饰器？","model":"claude-sonnet-4","max_tokens":1024,"response":"装饰器是 Python 的一个高级特性..."}'
PUT_RESP=$(curl -s -X POST "$BASE_URL/api/cache/put" -H "Content-Type: application/json" -d "$PUT_BODY")
echo "  Response: $PUT_RESP"
if echo "$PUT_RESP" | grep -q '"success":true'; then
    test_pass "写入缓存成功"
else
    test_fail "写入缓存失败" "$PUT_RESP"
fi

# 4. 测试查找（命中）
echo ""
echo "[4] POST /api/cache/test (精确匹配)"
TEST_BODY='{"system":"你是一个 Python 专家","user":"什么是装饰器？","model":"claude-sonnet-4","max_tokens":1024}'
TEST_RESP=$(curl -s -X POST "$BASE_URL/api/cache/test" -H "Content-Type: application/json" -d "$TEST_BODY")
echo "  Response: $TEST_RESP"
HIT_LAYER=$(echo "$TEST_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['hit_layer'])")
CACHE_HIT=$(echo "$TEST_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['cache_hit'])")
if [ "$HIT_LAYER" = "l1" ] && [ "$CACHE_HIT" = "True" ]; then
    test_pass "L1 精确匹配命中"
else
    test_fail "L1 精确匹配未命中" "hit_layer=$HIT_LAYER cache_hit=$CACHE_HIT"
fi

# 5. 统计更新验证
echo ""
echo "[5] GET /api/cache/stats (命中后)"
STATS=$(curl -s -X GET "$BASE_URL/api/cache/stats")
echo "  Response: $STATS"
L1_HITS=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['l1_hits'])")
SAVED_TOKENS=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['saved_tokens'])")
HIT_RATE=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['hit_rate'])")
if [ "$L1_HITS" -ge 1 ] && [ "$SAVED_TOKENS" -gt 0 ] && [ "$HIT_RATE" != "0" ]; then
    test_pass "L1 命中数=$L1_HITS, 节省 token=$SAVED_TOKENS, 命中率=$HIT_RATE"
else
    test_fail "统计未更新" "l1_hits=$L1_HITS saved_tokens=$SAVED_TOKENS hit_rate=$HIT_RATE"
fi

# 6. 测试查找（未命中）
echo ""
echo "[6] POST /api/cache/test (未命中)"
MISS_BODY='{"system":"完全不同的 system prompt","user":"完全不同的 user query","model":"different-model","max_tokens":1024}'
MISS_RESP=$(curl -s -X POST "$BASE_URL/api/cache/test" -H "Content-Type: application/json" -d "$MISS_BODY")
HIT_LAYER=$(echo "$MISS_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['hit_layer'])")
CACHE_HIT=$(echo "$MISS_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['cache_hit'])")
if [ "$HIT_LAYER" = "miss" ] && [ "$CACHE_HIT" = "False" ]; then
    test_pass "未命中返回 miss"
else
    test_fail "未命中未返回 miss" "hit_layer=$HIT_LAYER"
fi

# 7. 清空缓存
echo ""
echo "[7] POST /api/cache/clear"
CLEAR_RESP=$(curl -s -X POST "$BASE_URL/api/cache/clear")
echo "  Response: $CLEAR_RESP"
L1_CLEARED=$(echo "$CLEAR_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['l1_cleared'])")
if [ "$L1_CLEARED" -ge 1 ]; then
    test_pass "清空 L1 缓存: $L1_CLEARED 条"
else
    test_fail "清空缓存失败" "l1_cleared=$L1_CLEARED"
fi

# 8. 清空后测试
echo ""
echo "[8] POST /api/cache/test (清空后)"
AFTER_CLEAR=$(curl -s -X POST "$BASE_URL/api/cache/test" -H "Content-Type: application/json" -d "$TEST_BODY")
CACHE_HIT=$(echo "$AFTER_CLEAR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['cache_hit'])")
if [ "$CACHE_HIT" = "False" ]; then
    test_pass "清空后未命中"
else
    test_fail "清空后仍命中" "$AFTER_CLEAR"
fi

# 9. 多次 put 累加测试
echo ""
echo "[9] 多次 put 验证 L1+L2 缓存写入"
for i in 1 2 3; do
    BODY="{\"system\":\"sys-$i\",\"user\":\"user-$i\",\"model\":\"model\",\"max_tokens\":1024,\"response\":\"response-$i\"}"
    curl -s -X POST "$BASE_URL/api/cache/put" -H "Content-Type: application/json" -d "$BODY" > /dev/null
done
L1_SIZE=$(curl -s -X GET "$BASE_URL/api/cache/stats" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['l1_size'])")
L2_SIZE=$(curl -s -X GET "$BASE_URL/api/cache/stats" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['l2_size'])")
if [ "$L1_SIZE" = "3" ] && [ "$L2_SIZE" = "3" ]; then
    test_pass "L1=$L1_SIZE, L2=$L2_SIZE 都正确累加"
else
    test_fail "L1/L2 累加异常" "l1_size=$L1_SIZE l2_size=$L2_SIZE"
fi

# 最终清理
echo ""
echo "[Cleanup] POST /api/cache/clear"
curl -s -X POST "$BASE_URL/api/cache/clear" > /dev/null
echo "  OK"

echo ""
echo "=========================================="
echo -e "  ${GREEN}测试结果：${PASS_COUNT} 通过 / ${RED}${FAIL_COUNT}${GREEN} 失败 / ${TOTAL_COUNT} 总计${NC}"
echo "=========================================="

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ 所有 E2E 测试通过${NC}"
    exit 0
else
    echo -e "${RED}✗ ${FAIL_COUNT} 个测试失败${NC}"
    exit 1
fi
