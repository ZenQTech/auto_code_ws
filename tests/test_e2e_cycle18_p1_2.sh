#!/bin/bash
# ============================================================
# Cycle 18 P1-2 E2E 测试：SSE 流式拦截器
# 版本：v6.42.0
# ============================================================
# 验证项：
#   1. sseInterceptor.ts 核心文件存在且功能完整
#   2. 单元测试通过
#   3. TypeScript 编译通过
#   4. 默认 SSE 解析器单元测试
#   5. 全部 utils/hooks 测试通过
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../frontend"

export PATH="/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH"

PASSED=0
FAILED=0
TOTAL=0

assert() {
  local description="$1"
  local command="$2"
  TOTAL=$((TOTAL + 1))
  if eval "$command" >/dev/null 2>&1; then
    echo "  ✓ $description"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ $description"
    FAILED=$((FAILED + 1))
  fi
}

assert_contains() {
  local description="$1"
  local file="$2"
  local pattern="$3"
  TOTAL=$((TOTAL + 1))
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ✓ $description"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ $description (pattern: $pattern)"
    FAILED=$((FAILED + 1))
  fi
}

strip_ansi() {
  sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g'
}

echo "=========================================="
echo "Cycle 18 P1-2 E2E 测试"
echo "目标：SSE 流式拦截器"
echo "=========================================="

echo ""
echo "[1/5] 文件存在性 + 内容完整性"
assert "sseInterceptor.ts 存在" "test -f src/utils/sseInterceptor.ts"
assert "sseInterceptor.test.ts 存在" "test -f src/utils/sseInterceptor.test.ts"
assert_contains "导出 createSSEStream" "src/utils/sseInterceptor.ts" "export function createSSEStream"
assert_contains "导出 SSEError 类" "src/utils/sseInterceptor.ts" "export class SSEError"
assert_contains "导出 defaultSSEParser" "src/utils/sseInterceptor.ts" "export const defaultSSEParser"
assert_contains "导出 SSEEvent 类型" "src/utils/sseInterceptor.ts" "export interface SSEEvent"
assert_contains "导出 SSEParser 接口" "src/utils/sseInterceptor.ts" "export interface SSEParser"
assert_contains "导出 SSEStreamOptions" "src/utils/sseInterceptor.ts" "export interface SSEStreamOptions"

echo ""
echo "[2/5] 功能完整性验证"
assert_contains "事件路由（events map）" "src/utils/sseInterceptor.ts" "events: Record"
assert_contains "心跳检测（heartbeatMs）" "src/utils/sseInterceptor.ts" "heartbeatMs"
assert_contains "自动重连（retry）" "src/utils/sseInterceptor.ts" "retryBackoff"
assert_contains "AbortSignal 取消支持" "src/utils/sseInterceptor.ts" "AbortSignal"
assert_contains "错误分类（connection/timeout/aborted/server）" "src/utils/sseInterceptor.ts" "SSEErrorType"
assert_contains "集成 GlobalErrorHandler" "src/utils/sseInterceptor.ts" "reportError"
assert_contains "支持自定义 parser" "src/utils/sseInterceptor.ts" "SSEParser"
assert_contains "支持 silent 模式" "src/utils/sseInterceptor.ts" "silent"
assert_contains "onEvent 通配回调" "src/utils/sseInterceptor.ts" "onEvent"
assert_contains "isActive / getRetryCount" "src/utils/sseInterceptor.ts" "isActive"

echo ""
echo "[3/5] 单元测试"
SSE_OUTPUT=$(./node_modules/.bin/vitest run src/utils/sseInterceptor.test.ts --reporter=verbose 2>&1 | strip_ansi)
SSE_PASSED=$(echo "$SSE_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
SSE_FAILED=$(echo "$SSE_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
SSE_FAILED=${SSE_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$SSE_FAILED" = "0" ] && [ -n "$SSE_PASSED" ] && [ "$SSE_PASSED" -ge 21 ]; then
  echo "  ✓ sseInterceptor 单元测试通过（$SSE_PASSED tests）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ sseInterceptor 单元测试失败（passed=$SSE_PASSED, failed=$SSE_FAILED）"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "[4/5] TypeScript 编译检查"
TSC_OUTPUT=$(./node_modules/.bin/tsc --noEmit 2>&1 | strip_ansi)
TSC_ERR_COUNT=$(echo "$TSC_OUTPUT" | grep -E "error TS" | wc -l)
TOTAL=$((TOTAL + 1))
if [ "$TSC_ERR_COUNT" = "0" ]; then
  echo "  ✓ TypeScript 编译通过（0 errors）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ TypeScript 编译错误（$TSC_ERR_COUNT errors）"
  echo "$TSC_OUTPUT" | grep "error TS" | head -5
  FAILED=$((FAILED + 1))
fi

echo ""
echo "[5/5] 所有 utils/hooks 测试"
ALL_OUTPUT=$(./node_modules/.bin/vitest run src/utils/ src/hooks/ 2>&1 | strip_ansi)
ALL_PASSED=$(echo "$ALL_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
ALL_FAILED=$(echo "$ALL_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
ALL_FAILED=${ALL_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$ALL_FAILED" = "0" ] && [ -n "$ALL_PASSED" ] && [ "$ALL_PASSED" -gt 0 ]; then
  echo "  ✓ 所有 utils/hooks 测试通过（$ALL_PASSED passed, 0 failed）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ 部分测试失败（passed=$ALL_PASSED, failed=$ALL_FAILED）"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "=========================================="
echo "测试结果：$PASSED/$TOTAL 通过"
if [ "$FAILED" = "0" ]; then
  echo "✓ 全部通过！"
  echo "=========================================="
  exit 0
else
  echo "✗ 有 $FAILED 项失败"
  echo "=========================================="
  exit 1
fi
