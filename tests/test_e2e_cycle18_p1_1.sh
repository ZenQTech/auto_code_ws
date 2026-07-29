#!/bin/bash
# ============================================================
# Cycle 18 P1-1 E2E 测试：fetch 拦截器统一错误处理
# 版本：v6.41.0
# ============================================================
# 验证项：
#   1. apiInterceptor.ts 核心文件存在且功能完整
#   2. apiShared.ts 集成拦截器
#   3. 单元测试通过（apiInterceptor + apiShared）
#   4. TypeScript 编译通过
#   5. 全部测试通过
#   6. 全局错误处理集成
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
echo "Cycle 18 P1-1 E2E 测试"
echo "目标：fetch 拦截器统一错误处理"
echo "=========================================="

echo ""
echo "[1/6] 文件存在性 + 内容完整性"
assert "apiInterceptor.ts 存在" "test -f src/utils/apiInterceptor.ts"
assert "apiInterceptor.test.ts 存在" "test -f src/utils/apiInterceptor.test.ts"
assert "apiShared.ts 存在" "test -f src/hooks/apiShared.ts"
assert "apiShared.test.ts 存在" "test -f src/hooks/apiShared.test.ts"
assert_contains "apiInterceptor 导出 ApiError" "src/utils/apiInterceptor.ts" "export class ApiError"
assert_contains "apiInterceptor 导出 apiFetchWithInterceptor" "src/utils/apiInterceptor.ts" "export async function apiFetchWithInterceptor"
assert_contains "apiShared 集成拦截器" "src/hooks/apiShared.ts" "import.*apiFetchWithInterceptor.*apiInterceptor"
assert_contains "apiShared 提供 apiFetchWithToast" "src/hooks/apiShared.ts" "apiFetchWithToast"

echo ""
echo "[2/6] 功能完整性验证"
assert_contains "支持超时控制" "src/utils/apiInterceptor.ts" "timeoutMs"
assert_contains "支持重试" "src/utils/apiInterceptor.ts" "maxRetries"
assert_contains "支持请求去重" "src/utils/apiInterceptor.ts" "requestId"
assert_contains "支持 401 自动跳转" "src/utils/apiInterceptor.ts" "redirectToLogin"
assert_contains "5xx 重试" "src/utils/apiInterceptor.ts" "res.status >= 500"
assert_contains "错误分类（isNetworkError/isTimeout/isAuthError）" "src/utils/apiInterceptor.ts" "isAuthError"
assert_contains "集成 GlobalErrorHandler" "src/utils/apiInterceptor.ts" "reportError"
assert_contains "幂等方法自动重试" "src/utils/apiInterceptor.ts" "IDEMPOTENT_METHODS"

echo ""
echo "[3/6] apiInterceptor 单元测试"
INTERCEPTOR_OUTPUT=$(./node_modules/.bin/vitest run src/utils/apiInterceptor.test.ts --reporter=verbose 2>&1 | strip_ansi)
INTERCEPTOR_PASSED=$(echo "$INTERCEPTOR_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
INTERCEPTOR_FAILED=$(echo "$INTERCEPTOR_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
INTERCEPTOR_FAILED=${INTERCEPTOR_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$INTERCEPTOR_FAILED" = "0" ] && [ -n "$INTERCEPTOR_PASSED" ] && [ "$INTERCEPTOR_PASSED" -ge 28 ]; then
  echo "  ✓ apiInterceptor 单元测试通过（$INTERCEPTOR_PASSED tests）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ apiInterceptor 单元测试失败（passed=$INTERCEPTOR_PASSED, failed=$INTERCEPTOR_FAILED）"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "[4/6] apiShared 集成测试"
SHARED_OUTPUT=$(./node_modules/.bin/vitest run src/hooks/apiShared.test.ts --reporter=verbose 2>&1 | strip_ansi)
SHARED_PASSED=$(echo "$SHARED_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
SHARED_FAILED=$(echo "$SHARED_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
SHARED_FAILED=${SHARED_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$SHARED_FAILED" = "0" ] && [ -n "$SHARED_PASSED" ] && [ "$SHARED_PASSED" -ge 11 ]; then
  echo "  ✓ apiShared 集成测试通过（$SHARED_PASSED tests）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ apiShared 集成测试失败（passed=$SHARED_PASSED, failed=$SHARED_FAILED）"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "[5/6] TypeScript 编译检查"
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
echo "[6/6] 所有 hooks/utils 单元测试"
ALL_UTILS_OUTPUT=$(./node_modules/.bin/vitest run src/utils/ src/hooks/ 2>&1 | strip_ansi)
ALL_PASSED=$(echo "$ALL_UTILS_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
ALL_FAILED=$(echo "$ALL_UTILS_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
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
