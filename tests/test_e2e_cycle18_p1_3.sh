#!/bin/bash
# ============================================================
# Cycle 18 P1-3 E2E 测试：乐观更新模式
# 版本：v6.43.0
# ============================================================
# 验证项：
#   1. optimisticUpdate.ts 核心文件存在且功能完整
#   2. useOptimisticMutation Hook 存在
#   3. 单元测试通过
#   4. TypeScript 编译通过
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
echo "Cycle 18 P1-3 E2E 测试"
echo "目标：乐观更新模式（Optimistic Updates）"
echo "=========================================="

echo ""
echo "[1/5] 文件存在性 + 内容完整性"
assert "optimisticUpdate.ts 存在" "test -f src/utils/optimisticUpdate.ts"
assert "optimisticUpdate.test.ts 存在" "test -f src/utils/optimisticUpdate.test.ts"
assert "useOptimisticMutation.ts 存在" "test -f src/hooks/useOptimisticMutation.ts"
assert "useOptimisticMutation.test.ts 存在" "test -f src/hooks/useOptimisticMutation.test.ts"
assert_contains "导出 optimisticUpdate 函数" "src/utils/optimisticUpdate.ts" "export async function optimisticUpdate"
assert_contains "导出 createOptimisticExecutor" "src/utils/optimisticUpdate.ts" "export function createOptimisticExecutor"
assert_contains "导出 replaceByTempId" "src/utils/optimisticUpdate.ts" "export function replaceByTempId"
assert_contains "导出 removeById" "src/utils/optimisticUpdate.ts" "export function removeById"
assert_contains "导出 restoreItem" "src/utils/optimisticUpdate.ts" "export function restoreItem"
assert_contains "导出 generateTempId" "src/utils/optimisticUpdate.ts" "export function generateTempId"
assert_contains "导出 useOptimisticMutation Hook" "src/hooks/useOptimisticMutation.ts" "export function useOptimisticMutation"

echo ""
echo "[2/5] 功能完整性验证"
assert_contains "optimistic 同步执行" "src/utils/optimisticUpdate.ts" "optimistic(variables)"
assert_contains "mutation 异步执行" "src/utils/optimisticUpdate.ts" "mutation(variables)"
assert_contains "rollback 失败回滚" "src/utils/optimisticUpdate.ts" "rollback(variables)"
assert_contains "onSuccess 成功回调" "src/utils/optimisticUpdate.ts" "onSuccess"
assert_contains "onError 失败回调" "src/utils/optimisticUpdate.ts" "onError"
assert_contains "onSettled settled 钩子" "src/utils/optimisticUpdate.ts" "onSettled"
assert_contains "Hook 暴露 mutate" "src/hooks/useOptimisticMutation.ts" "mutate:"
assert_contains "Hook 暴露 state" "src/hooks/useOptimisticMutation.ts" "state:"
assert_contains "Hook 重入检测" "src/hooks/useOptimisticMutation.ts" "inFlightRef"
assert_contains "Hook isLoading 状态" "src/hooks/useOptimisticMutation.ts" "isLoading"

echo ""
echo "[3/5] 单元测试"
OPTIMISTIC_OUTPUT=$(./node_modules/.bin/vitest run src/utils/optimisticUpdate.test.ts src/hooks/useOptimisticMutation.test.ts --reporter=verbose 2>&1 | strip_ansi)
OPT_PASSED=$(echo "$OPTIMISTIC_OUTPUT" | grep -oE "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
OPT_FAILED=$(echo "$OPTIMISTIC_OUTPUT" | grep -oE "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
OPT_FAILED=${OPT_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$OPT_FAILED" = "0" ] && [ -n "$OPT_PASSED" ] && [ "$OPT_PASSED" -ge 23 ]; then
  echo "  ✓ 乐观更新测试通过（$OPT_PASSED tests）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ 乐观更新测试失败（passed=$OPT_PASSED, failed=$OPT_FAILED）"
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
ALL_PASSED=$(echo "$ALL_OUTPUT" | grep -E "Tests +[0-9]+ passed" | tail -1 | grep -oE "[0-9]+" | head -1)
ALL_FAILED=$(echo "$ALL_OUTPUT" | grep -E "Tests +[0-9]+ failed" | tail -1 | grep -oE "[0-9]+" | head -1)
ALL_FAILED=${ALL_FAILED:-0}
TOTAL=$((TOTAL + 1))
if [ "$ALL_FAILED" = "0" ] && [ -n "$ALL_PASSED" ] && [ "$ALL_PASSED" -gt 0 ]; then
  echo "  ✓ 所有 utils/hooks 测试通过（$ALL_PASSED passed, 0 failed）"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ 部分测试失败（passed=$ALL_PASSED, failed=$ALL_FAILED）"
  echo "  Last 5 lines of output:"
  echo "$ALL_OUTPUT" | tail -5 | sed 's/^/    /'
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
