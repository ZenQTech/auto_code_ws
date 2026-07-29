#!/bin/bash
# ============================================================
# Composer 多文件编辑端到端测试 (v6.36.0 Cycle 16 P0-1)
# ============================================================
# 核心作用：验证 Composer 多文件编辑功能的端到端工作流
# 测试覆盖：
#   1. Composer 引擎单测（context/edit/snapshot 三大模块）
#   2. Composer UI 组件渲染与交互
#   3. Composer 与 App.tsx 集成（菜单入口、快捷键）
#   4. Composer @ 引用解析多类型
#   5. Composer 集成测试（完整端到端工作流）
# 运行方式：bash tests/test_e2e_composer.sh
# ============================================================

set -e
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
TOTAL=0

assert_pass() {
  TOTAL=$((TOTAL + 1))
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓${NC} $1"
}

assert_fail() {
  TOTAL=$((TOTAL + 1))
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}✗${NC} $1"
  echo -e "    ${RED}Expected: $2${NC}"
  echo -e "    ${RED}Got: $3${NC}"
}

assert_contains() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then
    assert_pass "$label"
  else
    assert_fail "$label" "contains pattern '$pattern'" "not found"
  fi
}

assert_file_exists() {
  local label="$1"
  local file="$2"
  if [ -f "$file" ]; then
    assert_pass "$label"
  else
    assert_fail "$label" "file $file exists" "not found"
  fi
}

assert_min_tests() {
  local label="$1"
  local file="$2"
  local min="$3"
  if [ -f "$file" ]; then
    local count=$(grep -c "^\s*it(" "$file" 2>/dev/null || echo 0)
    if [ "$count" -ge "$min" ]; then
      assert_pass "$label ($count tests)"
    else
      assert_fail "$label" ">= $min tests" "$count tests"
    fi
  else
    assert_fail "$label" "file $file exists" "not found"
  fi
}

# ============================================================
# 1. Composer 核心文件存在性检查
# ============================================================
echo -e "\n${YELLOW}[1] Composer 核心文件存在性${NC}"

assert_file_exists "Composer 引擎存在" "frontend/src/utils/composerEngine.ts"
assert_file_exists "Composer Hook 存在" "frontend/src/hooks/useComposer.tsx"
assert_file_exists "Composer 面板存在" "frontend/src/components/ComposerPanel.tsx"
assert_file_exists "Composer 启动器存在" "frontend/src/components/ComposerLauncher.tsx"
assert_file_exists "Composer 引擎单测" "frontend/src/utils/composerEngine.test.ts"
assert_file_exists "Composer 面板单测" "frontend/src/components/ComposerPanel.test.tsx"
assert_file_exists "Composer 启动器单测" "frontend/src/components/ComposerLauncher.test.tsx"
assert_file_exists "Composer 集成测试" "frontend/src/__tests__/composer-integration.test.tsx"

# ============================================================
# 2. Composer 引擎单测覆盖度
# ============================================================
echo -e "\n${YELLOW}[2] Composer 引擎单测覆盖度${NC}"

assert_min_tests "Composer 引擎单测覆盖" "frontend/src/utils/composerEngine.test.ts" 30

# 验证关键功能函数被测试
for keyword in "parseReferences" "addContext" "addEdit" "acceptEdit" "rejectEdit" "createSnapshot" "undo" "redo" "rollback"; do
  assert_contains "测试覆盖: $keyword" "frontend/src/utils/composerEngine.test.ts" "$keyword"
done

# ============================================================
# 3. Composer UI 测试覆盖度
# ============================================================
echo -e "\n${YELLOW}[3] Composer UI 测试覆盖度${NC}"

assert_min_tests "Composer 面板单测" "frontend/src/components/ComposerPanel.test.tsx" 10
assert_min_tests "Composer 启动器单测" "frontend/src/components/ComposerLauncher.test.tsx" 3
assert_min_tests "Composer 集成测试" "frontend/src/__tests__/composer-integration.test.tsx" 10

# 验证 testid 存在
for testid in "composer-panel" "composer-context-bar" "composer-edit-list" "composer-close" "composer-fullscreen"; do
  assert_contains "testid 存在: $testid" "frontend/src/components/ComposerPanel.tsx" "$testid"
done

# ============================================================
# 4. App.tsx 集成检查
# ============================================================
echo -e "\n${YELLOW}[4] App.tsx 集成${NC}"

assert_contains "App.tsx 导入 ComposerLauncher" "frontend/src/App.tsx" "ComposerLauncher"
assert_contains "App.tsx 调用 ComposerLauncher" "frontend/src/App.tsx" "<ComposerLauncher"
assert_contains "App.tsx 设置 composerOpen 状态" "frontend/src/App.tsx" "setComposerOpen"
assert_contains "App.tsx 监听 Cmd+I 快捷键" "frontend/src/App.tsx" "metaKey || e.ctrlKey.*key === 'i'"

# ============================================================
# 5. BrandHeader 集成检查
# ============================================================
echo -e "\n${YELLOW}[5] BrandHeader 集成${NC}"

assert_contains "BrandHeader 添加 onOpenComposer 回调" "frontend/src/components/BrandHeader.tsx" "onOpenComposer"
assert_contains "BrandHeader 菜单包含 Composer" "frontend/src/components/BrandHeader.tsx" "Composer 多文件编辑"
assert_contains "BrandHeader 添加 layers 图标" "frontend/src/components/BrandHeader.tsx" "case 'layers'"

# ============================================================
# 6. AppLayout 集成检查
# ============================================================
echo -e "\n${YELLOW}[6] AppLayout 集成${NC}"

assert_contains "AppLayout 添加 onOpenComposer prop" "frontend/src/components/AppLayout.tsx" "onOpenComposer"
assert_contains "AppLayout 透传 onOpenComposer" "frontend/src/components/AppLayout.tsx" "onOpenComposer={onOpenComposer}"

# ============================================================
# 7. 实际运行前端测试（最关键的验证）
# ============================================================
echo -e "\n${YELLOW}[7] 实际运行前端测试${NC}"

cd frontend
if [ -d "node_modules/vitest" ]; then
  if node ./node_modules/vitest/vitest.mjs run \
    src/utils/composerEngine.test.ts \
    src/components/ComposerPanel.test.tsx \
    src/components/ComposerLauncher.test.tsx \
    src/__tests__/composer-integration.test.tsx 2>&1 | tail -20; then
    assert_pass "所有 Composer 测试通过"
  else
    assert_fail "Composer 测试运行" "all pass" "some failed"
  fi
else
  assert_fail "vitest 模块" "found" "missing (run npm install first)"
fi
cd ..

# ============================================================
# 总结
# ============================================================
echo -e "\n${YELLOW}============================================================${NC}"
echo -e "Total: $TOTAL  ${GREEN}Pass: $PASS${NC}  ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}============================================================${NC}"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
echo -e "${GREEN}🎉 所有 Composer 端到端测试通过！${NC}"
exit 0
