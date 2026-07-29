#!/bin/bash
# ============================================================
# Cycle 13 P1-2/P1-3 前端面板 E2E 冒烟测试
# ============================================================
# 核心作用：验证 LLM Judge / Marketplace 页面可访问
# 创建日期：2026-07-28
# ============================================================

set -e

FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://localhost:8000"

PASS=0
FAIL=0

test_pass() { echo "✓ PASS: $1"; PASS=$((PASS+1)); }
test_fail() { echo "✗ FAIL: $1"; FAIL=$((FAIL+1)); }

echo "=== Cycle 13 P1-2/P1-3 前端 E2E 冒烟测试 ==="

# 1. 前端首页可访问
HOME_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/")
if [ "$HOME_STATUS" = "200" ]; then
    test_pass "前端首页可访问"
else
    test_fail "前端首页返回 $HOME_STATUS"
fi

# 2. LLM Judge 页面可访问
LLM_JUDGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/llm-judge")
if [ "$LLM_JUDGE_STATUS" = "200" ]; then
    test_pass "LLM Judge 页面可访问"
else
    test_fail "LLM Judge 页面返回 $LLM_JUDGE_STATUS"
fi

# 3. Marketplace 页面可访问
MARKET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/marketplace")
if [ "$MARKET_STATUS" = "200" ]; then
    test_pass "Marketplace 页面可访问"
else
    test_fail "Marketplace 页面返回 $MARKET_STATUS"
fi

# 4. 后端 LLM Judge API 可用
JUDGE_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/llm-judge/health")
if [ "$JUDGE_HEALTH" = "200" ]; then
    test_pass "LLM Judge API 可用"
else
    test_fail "LLM Judge API 返回 $JUDGE_HEALTH"
fi

# 5. 后端 Marketplace API 可用
MARKET_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/marketplace/health")
if [ "$MARKET_HEALTH" = "200" ]; then
    test_pass "Marketplace API 可用"
else
    test_fail "Marketplace API 返回 $MARKET_HEALTH"
fi

# 6. 前端页面包含预期内容
HOME_HTML=$(curl -s "$FRONTEND_URL/" 2>/dev/null)
if echo "$HOME_HTML" | grep -q "<div id=\"root\""; then
    test_pass "前端根容器存在"
else
    test_fail "前端根容器缺失"
fi

# 7. 后端 LLM Judge 包含 judges 字段
JUDGE_DATA=$(curl -s "$BACKEND_URL/api/llm-judge/health" 2>/dev/null)
if echo "$JUDGE_DATA" | grep -q "total_judges"; then
    test_pass "LLM Judge 健康检查返回 judges 数量"
elif echo "$JUDGE_DATA" | grep -q "pool_stats"; then
    test_pass "LLM Judge 健康检查返回 pool_stats"
else
    test_fail "LLM Judge 健康检查格式异常"
fi

# 8. 后端 Marketplace 包含 plugins
MARKET_DATA=$(curl -s "$BACKEND_URL/api/marketplace/health" 2>/dev/null)
if echo "$MARKET_DATA" | grep -q "total_plugins"; then
    test_pass "Marketplace 健康检查返回 plugins 数量"
else
    test_fail "Marketplace 健康检查格式异常"
fi

echo ""
echo "=== 测试总结 ==="
echo "总计: $((PASS+FAIL))"
echo "通过: $PASS"
echo "失败: $FAIL"

if [ "$FAIL" -eq 0 ]; then
    echo "🎉 全部测试通过！"
    exit 0
else
    echo "❌ 有测试失败"
    exit 1
fi
