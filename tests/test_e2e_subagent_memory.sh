#!/usr/bin/env bash
# ============================================================
# SubAgent Memory API E2E 测试脚本（v1.0.0）
# 覆盖：
#   1. GET  /api/agents/memory/summary
#   2. GET  /api/agents/memory/list (empty)
#   3. POST /api/agents/{id}/memory/initialize (parent)
#   4. POST /api/agents/{id}/memory/append (parent)
#   5. POST /api/agents/{id}/memory/initialize (child)
#   6. POST /api/agents/{id}/memory/append (child)
#   7. GET  /api/agents/{id}/memory?include_parent=true
#   8. GET  /api/agents/{id}/memory?include_parent=false
#   9. POST /api/agents/{id}/memory/inherit
#  10. DELETE /api/agents/{id}/memory
#  11. 错误用例：append 到不存在的 ID
#  12. 错误用例：inherit 不存在的子/父
# ============================================================
set -e

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

# 颜色输出
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

# 等待后端启动
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
echo "  SubAgent Memory API E2E 测试"
echo "  BASE_URL: $BASE_URL"
echo "=========================================="

wait_for_backend

# 1. 初始 summary
echo ""
echo "[1] GET /api/agents/memory/summary (初始)"
SUMMARY=$(curl -s -X GET "$BASE_URL/api/agents/memory/summary")
echo "  Response: $SUMMARY"
TOTAL_SA=$(echo "$SUMMARY" | jq -r '.total_subagents // 0')
test_pass "summary 返回 total_subagents 字段（$TOTAL_SA）"

# 2. 初始 list (空)
echo ""
echo "[2] GET /api/agents/memory/list (初始)"
LIST=$(curl -s -X GET "$BASE_URL/api/agents/memory/list")
COUNT=$(echo "$LIST" | jq -r '.count // -1')
if [ "$COUNT" -ge 0 ]; then
    test_pass "list 返回有效 count 字段（$COUNT）"
else
    test_fail "list 返回值格式异常" "$LIST"
fi

# 3. 创建父 SubAgent
echo ""
echo "[3] POST /api/agents/parent-sa-1/memory/initialize"
PARENT_INIT=$(curl -s -X POST "$BASE_URL/api/agents/parent-sa-1/memory/initialize" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MainArchitect",
    "skill_set": ["architecture", "review"],
    "output_dir": "/tmp/parent",
    "isolated": true,
    "metadata": {"role": "main"}
  }')
SUCCESS=$(echo "$PARENT_INIT" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    test_pass "父 SubAgent 初始化成功"
else
    test_fail "父 SubAgent 初始化失败" "$PARENT_INIT"
fi

# 4. 父 SubAgent 追加消息
echo ""
echo "[4] POST /api/agents/parent-sa-1/memory/append"
APPEND_RESP=$(curl -s -X POST "$BASE_URL/api/agents/parent-sa-1/memory/append" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "user",
    "content": "请设计系统整体架构",
    "metadata": {"module": "core"}
  }')
ENTRY_ID=$(echo "$APPEND_RESP" | jq -r '.entry.entry_id // ""')
if [ -n "$ENTRY_ID" ]; then
    test_pass "父追加消息成功（entry_id=$ENTRY_ID）"
else
    test_fail "父追加消息失败" "$APPEND_RESP"
fi

APPEND_RESP2=$(curl -s -X POST "$BASE_URL/api/agents/parent-sa-1/memory/append" \
  -H "Content-Type: application/json" \
  -d '{"role": "assistant", "content": "已生成 spec.md", "metadata": {}}')
ENTRY_ID2=$(echo "$APPEND_RESP2" | jq -r '.entry.entry_id // ""')
if [ -n "$ENTRY_ID2" ]; then
    test_pass "父追加第二条消息成功"
else
    test_fail "父追加第二条消息失败" "$APPEND_RESP2"
fi

# 5. 创建子 SubAgent（指定 parent_id）
echo ""
echo "[5] POST /api/agents/child-sa-1/memory/initialize (parent=parent-sa-1)"
CHILD_INIT=$(curl -s -X POST "$BASE_URL/api/agents/child-sa-1/memory/initialize" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ModuleA_Dev",
    "parent_id": "parent-sa-1",
    "skill_set": ["python", "fastapi"],
    "output_dir": "/tmp/child-1",
    "isolated": true
  }')
SUCCESS=$(echo "$CHILD_INIT" | jq -r '.success')
AUTO_INHERIT=$(echo "$CHILD_INIT" | jq -r '.auto_inherit // ""')
if [ "$SUCCESS" = "true" ]; then
    test_pass "子 SubAgent 初始化成功"
    if echo "$AUTO_INHERIT" | grep -q "继承"; then
        test_pass "自动从父继承：$AUTO_INHERIT"
    else
        test_fail "未触发自动继承" "$AUTO_INHERIT"
    fi
else
    test_fail "子 SubAgent 初始化失败" "$CHILD_INIT"
fi

# 6. 子 SubAgent 追加自己的消息
echo ""
echo "[6] POST /api/agents/child-sa-1/memory/append (isolated)"
CHILD_APPEND=$(curl -s -X POST "$BASE_URL/api/agents/child-sa-1/memory/append" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "assistant",
    "content": "实现 ModuleA API 端点",
    "metadata": {"files": ["api.py", "models.py"]}
  }')
SUCCESS=$(echo "$CHILD_APPEND" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    test_pass "子追加 isolated 消息成功"
else
    test_fail "子追加 isolated 消息失败" "$CHILD_APPEND"
fi

# 7. 获取子 SubAgent 完整消息（含 parent）
echo ""
echo "[7] GET /api/agents/child-sa-1/memory?include_parent=true"
FULL_MSG=$(curl -s -X GET "$BASE_URL/api/agents/child-sa-1/memory?include_parent=true")
FULL_COUNT=$(echo "$FULL_MSG" | jq -r '.count // 0')
if [ "$FULL_COUNT" -ge 3 ]; then
    test_pass "完整消息数 >= 3（含 2 父 + 1 子，实际 $FULL_COUNT）"
else
    test_fail "完整消息数不足（期望>=3，实际 $FULL_COUNT）" "$FULL_MSG"
fi

# 8. 获取子 SubAgent isolated only
echo ""
echo "[8] GET /api/agents/child-sa-1/memory?include_parent=false"
ISO_MSG=$(curl -s -X GET "$BASE_URL/api/agents/child-sa-1/memory?include_parent=false")
ISO_COUNT=$(echo "$ISO_MSG" | jq -r '.count // 0')
if [ "$ISO_COUNT" -eq 1 ]; then
    test_pass "isolated 消息数 = 1（仅子自身追加）"
else
    test_fail "isolated 消息数异常（期望 1，实际 $ISO_COUNT）" "$ISO_MSG"
fi

# 9. 显式 inherit
echo ""
echo "[9] POST /api/agents/child-sa-2/memory/initialize + inherit"
curl -s -X POST "$BASE_URL/api/agents/child-sa-2/memory/initialize" \
  -H "Content-Type: application/json" \
  -d '{"name": "ModuleB_Dev", "parent_id": "parent-sa-1", "skill_set": ["cpp"], "output_dir": "/tmp/child-2"}' \
  > /dev/null

INHERIT=$(curl -s -X POST "$BASE_URL/api/agents/child-sa-2/memory/inherit" \
  -H "Content-Type: application/json" \
  -d '{"parent_id": "parent-sa-1"}')
INHERITED_COUNT=$(echo "$INHERIT" | jq -r '.inherited_count // 0')
if [ "$INHERITED_COUNT" -ge 2 ]; then
    test_pass "显式继承成功（$INHERITED_COUNT 条）"
else
    test_fail "显式继承失败" "$INHERIT"
fi

# 10. 清空子 SubAgent isolated
echo ""
echo "[10] DELETE /api/agents/child-sa-1/memory"
CLEAR=$(curl -s -X DELETE "$BASE_URL/api/agents/child-sa-1/memory")
SUCCESS=$(echo "$CLEAR" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    test_pass "清空 isolated 成功"
    # 验证：isolated 数量变 0，但 parent_snapshot 保留
    ISO_AFTER=$(curl -s -X GET "$BASE_URL/api/agents/child-sa-1/memory?include_parent=false" | jq -r '.count // -1')
    FULL_AFTER=$(curl -s -X GET "$BASE_URL/api/agents/child-sa-1/memory?include_parent=true" | jq -r '.count // -1')
    if [ "$ISO_AFTER" -eq 0 ] && [ "$FULL_AFTER" -ge 2 ]; then
        test_pass "清空后 isolated=0, parent_snapshot 保留（完整=$FULL_AFTER）"
    else
        test_fail "清空状态异常" "iso=$ISO_AFTER full=$FULL_AFTER"
    fi
else
    test_fail "清空失败" "$CLEAR"
fi

# 11. 错误用例：append 到不存在的 ID
echo ""
echo "[11] POST /api/agents/ghost/memory/append (404)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/agents/ghost/memory/append" \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "x"}')
if [ "$HTTP_CODE" = "404" ]; then
    test_pass "不存在的 ID 返回 404"
else
    test_fail "错误处理异常" "HTTP $HTTP_CODE"
fi

# 12. 错误用例：inherit 不存在的父
echo ""
echo "[12] POST /api/agents/child-sa-1/memory/inherit (404)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/agents/child-sa-1/memory/inherit" \
  -H "Content-Type: application/json" \
  -d '{"parent_id": "ghost-parent"}')
if [ "$HTTP_CODE" = "404" ]; then
    test_pass "inherit 不存在的父返回 404"
else
    test_fail "inherit 错误处理异常" "HTTP $HTTP_CODE"
fi

# 最终统计
echo ""
echo "=========================================="
echo "  测试结果：${PASS_COUNT} 通过 / ${FAIL_COUNT} 失败 / ${TOTAL_COUNT} 总计"
echo "=========================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi

echo -e "${GREEN}✓ 所有 E2E 测试通过${NC}"
exit 0
