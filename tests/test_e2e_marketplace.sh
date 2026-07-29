#!/bin/bash
# ============================================================
# Cycle 13 P1-1: Plugin Marketplace E2E Tests
# ============================================================
# 测试目标：
#   1. 验证 /api/marketplace/* 端点（12+ 端点）
#   2. 验证三层 Plugin 目录（official/community/local）
#   3. 验证评分系统
#   4. 验证版本管理
#   5. 验证签名验证
#   6. 验证发布流程
# 依赖：后端服务运行于 127.0.0.1:8000
# 执行：bash tests/test_e2e_marketplace.sh
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
API="$BASE_URL/api/marketplace"
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
if echo "$RESP" | grep -q '"service":"plugin-marketplace"'; then
    test_pass "服务标识为 plugin-marketplace"
else
    test_fail "服务标识不正确" "$RESP"
fi
if echo "$RESP" | grep -q '"total_plugins"'; then
    test_pass "包含统计信息"
else
    test_fail "缺少统计信息" "$RESP"
fi

# ============================================================
# 2. 列出所有 Plugin
# ============================================================
echo ""
echo "=== 2. 列出所有 Plugin ==="
RESP=$(curl -s "$API/list")
if echo "$RESP" | grep -q '"success":true'; then
    test_pass "列出 Plugin 成功"
else
    test_fail "列出 Plugin 失败" "$RESP"
fi
TOTAL=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))")
if [ "$TOTAL" -ge 5 ]; then
    test_pass "默认 Plugin 数 >= 5 ($TOTAL)"
else
    test_fail "默认 Plugin 数 < 5" "$TOTAL"
fi

# ============================================================
# 3. 按来源过滤
# ============================================================
echo ""
echo "=== 3. 按来源过滤 ==="
OFFICIAL=$(curl -s "$API/list?source=official")
if echo "$OFFICIAL" | grep -q '"success":true'; then
    test_pass "按 official 过滤成功"
else
    test_fail "按 official 过滤失败" "$OFFICIAL"
fi
OFFICIAL_COUNT=$(echo "$OFFICIAL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))")
if [ "$OFFICIAL_COUNT" -ge 1 ]; then
    test_pass "official 源 Plugin 数 >= 1 ($OFFICIAL_COUNT)"
else
    test_fail "official 源 Plugin 数 < 1" "$OFFICIAL_COUNT"
fi

COMMUNITY=$(curl -s "$API/list?source=community")
if echo "$COMMUNITY" | grep -q '"success":true'; then
    test_pass "按 community 过滤成功"
else
    test_fail "按 community 过滤失败" "$COMMUNITY"
fi

# ============================================================
# 4. 按分类过滤
# ============================================================
echo ""
echo "=== 4. 按分类过滤 ==="
SECURITY=$(curl -s "$API/list?category=security")
if echo "$SECURITY" | grep -q '"success":true'; then
    test_pass "按 security 分类过滤成功"
else
    test_fail "按 security 分类过滤失败" "$SECURITY"
fi
SEC_COUNT=$(echo "$SECURITY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))")
if [ "$SEC_COUNT" -ge 1 ]; then
    test_pass "security 分类 Plugin 数 >= 1 ($SEC_COUNT)"
else
    test_fail "security 分类 Plugin 数 < 1" "$SEC_COUNT"
fi

# ============================================================
# 5. 已认证插件
# ============================================================
echo ""
echo "=== 5. 已认证插件 ==="
VERIFIED=$(curl -s "$API/list?verified_only=true")
if echo "$VERIFIED" | grep -q '"success":true'; then
    test_pass "按 verified_only 过滤成功"
else
    test_fail "按 verified_only 过滤失败" "$VERIFIED"
fi
VER_COUNT=$(echo "$VERIFIED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))")
if [ "$VER_COUNT" -ge 1 ]; then
    test_pass "已认证 Plugin 数 >= 1 ($VER_COUNT)"
else
    test_fail "已认证 Plugin 数 < 1" "$VER_COUNT"
fi

# ============================================================
# 6. 搜索
# ============================================================
echo ""
echo "=== 6. 搜索 ==="
SEARCH=$(curl -s "$API/search?q=security")
if echo "$SEARCH" | grep -q '"success":true'; then
    test_pass "搜索 security 成功"
else
    test_fail "搜索 security 失败" "$SEARCH"
fi
SEARCH_COUNT=$(echo "$SEARCH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
if [ "$SEARCH_COUNT" -ge 1 ]; then
    test_pass "搜索结果 >= 1 ($SEARCH_COUNT)"
else
    test_fail "搜索结果 < 1" "$SEARCH_COUNT"
fi

# 搜索无结果
NO_MATCH=$(curl -s "$API/search?q=xyz_no_match_zzz")
NM_COUNT=$(echo "$NO_MATCH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
if [ "$NM_COUNT" -eq 0 ]; then
    test_pass "无匹配搜索返回 0"
else
    test_fail "无匹配搜索返回 > 0" "$NM_COUNT"
fi

# ============================================================
# 7. 分类列表
# ============================================================
echo ""
echo "=== 7. 分类列表 ==="
CATS=$(curl -s "$API/categories")
if echo "$CATS" | grep -q '"success":true'; then
    test_pass "分类列表成功"
else
    test_fail "分类列表失败" "$CATS"
fi
CAT_COUNT=$(echo "$CATS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
if [ "$CAT_COUNT" -ge 3 ]; then
    test_pass "分类数 >= 3 ($CAT_COUNT)"
else
    test_fail "分类数 < 3" "$CAT_COUNT"
fi

# ============================================================
# 8. Plugin 详情
# ============================================================
echo ""
echo "=== 8. Plugin 详情 ==="
DETAIL=$(curl -s "$API/hermes.code-formatter")
if echo "$DETAIL" | grep -q '"success":true'; then
    test_pass "Plugin 详情成功"
else
    test_fail "Plugin 详情失败" "$DETAIL"
fi
if echo "$DETAIL" | grep -q '"versions"'; then
    test_pass "包含 versions 字段"
else
    test_fail "缺少 versions" "$DETAIL"
fi

# 不存在的 Plugin
NOT_FOUND=$(curl -s "$API/nonexistent_xyz_zzz")
if echo "$NOT_FOUND" | grep -q '"detail"'; then
    test_pass "查询不存在 Plugin 返回 404"
else
    test_fail "查询不存在 Plugin 未返回 404" "$NOT_FOUND"
fi

# ============================================================
# 9. 版本列表
# ============================================================
echo ""
echo "=== 9. 版本列表 ==="
VERS=$(curl -s "$API/hermes.code-formatter/versions")
if echo "$VERS" | grep -q '"success":true'; then
    test_pass "版本列表成功"
else
    test_fail "版本列表失败" "$VERS"
fi
VER_COUNT=$(echo "$VERS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
if [ "$VER_COUNT" -ge 1 ]; then
    test_pass "版本数 >= 1 ($VER_COUNT)"
else
    test_fail "版本数 < 1" "$VER_COUNT"
fi

# ============================================================
# 10. 一键安装
# ============================================================
echo ""
echo "=== 10. 一键安装 ==="
INSTALL=$(curl -s -X POST "$API/hermes.code-formatter/install" \
    -H "Content-Type: application/json" \
    -d '{}')
if echo "$INSTALL" | grep -q '"success":true'; then
    test_pass "一键安装成功"
else
    test_fail "一键安装失败" "$INSTALL"
fi
if echo "$INSTALL" | grep -q '"version"'; then
    test_pass "返回 version 字段"
else
    test_fail "缺少 version" "$INSTALL"
fi

# 指定版本安装
INSTALL_VER=$(curl -s -X POST "$API/hermes.code-formatter/install" \
    -H "Content-Type: application/json" \
    -d '{"version":"2.0.0"}')
if echo "$INSTALL_VER" | grep -q '"version":"2.0.0"'; then
    test_pass "指定版本 2.0.0 安装成功"
else
    test_fail "指定版本安装失败" "$INSTALL_VER"
fi

# 不存在的 Plugin
INSTALL_404=$(curl -s -X POST "$API/nonexistent_xyz/install" \
    -H "Content-Type: application/json" \
    -d '{}')
if echo "$INSTALL_404" | grep -q '"detail"'; then
    test_pass "不存在 Plugin 安装返回 404"
else
    test_fail "不存在 Plugin 安装未返回 404" "$INSTALL_404"
fi

# ============================================================
# 11. 评分
# ============================================================
echo ""
echo "=== 11. 评分 ==="
RATE=$(curl -s -X POST "$API/hermes.code-formatter/rate" \
    -H "Content-Type: application/json" \
    -d '{
        "user": "e2e_tester_1",
        "score": 5,
        "comment": "Excellent plugin!"
    }')
if echo "$RATE" | grep -q '"success":true'; then
    test_pass "评分成功"
else
    test_fail "评分失败" "$RATE"
fi
if echo "$RATE" | grep -q '"avg_rating"'; then
    test_pass "包含 avg_rating 字段"
else
    test_fail "缺少 avg_rating" "$RATE"
fi

# 重复评分（更新）
RATE2=$(curl -s -X POST "$API/hermes.code-formatter/rate" \
    -H "Content-Type: application/json" \
    -d '{
        "user": "e2e_tester_1",
        "score": 3,
        "comment": "Updated"
    }')
if echo "$RATE2" | grep -q '"success":true'; then
    test_pass "重复评分（更新）成功"
else
    test_fail "重复评分失败" "$RATE2"
fi

# 第二个用户评分
RATE3=$(curl -s -X POST "$API/hermes.code-formatter/rate" \
    -H "Content-Type: application/json" \
    -d '{
        "user": "e2e_tester_2",
        "score": 4,
        "comment": "Good"
    }')
if echo "$RATE3" | grep -q '"success":true'; then
    test_pass "第二个用户评分成功"
else
    test_fail "第二个用户评分失败" "$RATE3"
fi

# 无效评分
BAD_RATE=$(curl -s -X POST "$API/hermes.code-formatter/rate" \
    -H "Content-Type: application/json" \
    -d '{"user":"x","score":10}')
if echo "$BAD_RATE" | grep -q '"detail"'; then
    test_pass "无效评分（>5）返回 400"
else
    test_fail "无效评分未返回 400" "$BAD_RATE"
fi

# 查询评分列表
RATINGS=$(curl -s "$API/hermes.code-formatter/ratings")
if echo "$RATINGS" | grep -q '"success":true'; then
    test_pass "查询评分列表成功"
else
    test_fail "查询评分列表失败" "$RATINGS"
fi
RATING_COUNT=$(echo "$RATINGS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', 0))")
if [ "$RATING_COUNT" -ge 2 ]; then
    test_pass "评分数 >= 2 ($RATING_COUNT)"
else
    test_fail "评分数 < 2" "$RATING_COUNT"
fi

# ============================================================
# 12. 发布 Plugin
# ============================================================
echo ""
echo "=== 12. 发布 Plugin ==="
PUB=$(curl -s -X POST "$API/publish" \
    -H "Content-Type: application/json" \
    -d '{
        "id": "e2e.test-plugin",
        "name": "E2E Test Plugin",
        "description": "An E2E test plugin",
        "author": "E2E Tester",
        "license": "MIT",
        "keywords": ["e2e", "test"],
        "categories": ["testing"],
        "icon": "🧪",
        "verified": false,
        "source": "community",
        "version": "1.0.0",
        "changelog": "Initial E2E release",
        "size_kb": 64
    }')
if echo "$PUB" | grep -q '"success":true'; then
    test_pass "发布 Plugin 成功"
else
    test_fail "发布 Plugin 失败" "$PUB"
fi

# 验证已发布
VERIFY_PUB=$(curl -s "$API/e2e.test-plugin")
if echo "$VERIFY_PUB" | grep -q '"name":"E2E Test Plugin"'; then
    test_pass "发布后能查到 Plugin"
else
    test_fail "发布后查不到 Plugin" "$VERIFY_PUB"
fi

# ============================================================
# 13. 签名验证
# ============================================================
echo ""
echo "=== 13. 签名验证 ==="
# 获取 Plugin 找到有效签名
PUB_VER=$(curl -s "$API/hermes.code-formatter/versions")
SIG=$(echo "$PUB_VER" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['versions'][0]['signature']; print(v)")
VER_NUM=$(echo "$PUB_VER" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['versions'][0]['version']; print(v)")
VERIFY_REQ=$(curl -s -X POST "$API/hermes.code-formatter/verify" \
    -H "Content-Type: application/json" \
    -d "{\"version\":\"$VER_NUM\",\"signature\":\"$SIG\"}")
if echo "$VERIFY_REQ" | grep -q '"valid":true'; then
    test_pass "有效签名验证通过"
else
    test_fail "有效签名验证失败" "$VERIFY_REQ"
fi

# 错误签名
BAD_VERIFY=$(curl -s -X POST "$API/hermes.code-formatter/verify" \
    -H "Content-Type: application/json" \
    -d "{\"version\":\"$VER_NUM\",\"signature\":\"wrong-sig\"}")
if echo "$BAD_VERIFY" | grep -q '"valid":false'; then
    test_pass "错误签名验证失败"
else
    test_fail "错误签名验证未失败" "$BAD_VERIFY"
fi

# ============================================================
# 14. 统计信息
# ============================================================
echo ""
echo "=== 14. 统计信息 ==="
STATS=$(curl -s "$API/stats")
if echo "$STATS" | grep -q '"success":true'; then
    test_pass "统计查询成功"
else
    test_fail "统计查询失败" "$STATS"
fi
if echo "$STATS" | grep -q '"total_plugins"'; then
    test_pass "包含 total_plugins"
else
    test_fail "缺少 total_plugins" "$STATS"
fi
if echo "$STATS" | grep -q '"by_source"'; then
    test_pass "包含 by_source"
else
    test_fail "缺少 by_source" "$STATS"
fi
if echo "$STATS" | grep -q '"ratings"'; then
    test_pass "包含 ratings"
else
    test_fail "缺少 ratings" "$STATS"
fi

# ============================================================
# 15. 错误处理
# ============================================================
echo ""
echo "=== 15. 错误处理 ==="
# 无效 source
INVALID_SRC=$(curl -s -X POST "$API/publish" \
    -H "Content-Type: application/json" \
    -d '{
        "id": "test.invalid",
        "name": "X",
        "description": "X",
        "author": "X",
        "source": "invalid_source"
    }')
if echo "$INVALID_SRC" | grep -q '"detail"'; then
    test_pass "无效 source 返回错误"
else
    test_fail "无效 source 未返回错误" "$INVALID_SRC"
fi

# 评分不存在的 Plugin
RATE_404=$(curl -s -X POST "$API/nonexistent_xyz/rate" \
    -H "Content-Type: application/json" \
    -d '{"user":"x","score":5}')
if echo "$RATE_404" | grep -q '"detail"'; then
    test_pass "评分不存在 Plugin 返回 404"
else
    test_fail "评分不存在 Plugin 未返回 404" "$RATE_404"
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
