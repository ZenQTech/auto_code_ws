#!/bin/bash
# ============================================================
# Cycle 17 P0-2 + P0-3 端到端测试 (v6.37.0)
# ============================================================
# 核心作用：验证 Cycle 17 新增功能的端到端工作流
# 测试覆盖：
#   1. useMode Hook 单测
#   2. ModeToggle 组件
#   3. previewSandbox 工具 (SandboxManager + 工具函数)
#   4. PreviewPanel 组件
#   5. ComposerPanel 三模式集成 (edit / plan / preview)
#   6. 完整集成测试
# 运行方式：bash tests/test_e2e_cycle17.sh
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
    assert_pass "$label ($file)"
  else
    assert_fail "$label" "file exists ($file)" "not found"
  fi
}

assert_count_ge() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  local min="$4"
  local count
  count=$(grep -c -- "$pattern" "$file" 2>/dev/null || echo "0")
  if [ "$count" -ge "$min" ]; then
    assert_pass "$label (count=$count >= $min)"
  else
    assert_fail "$label" "count >= $min" "count=$count"
  fi
}

echo ""
echo "============================================================"
echo "  Cycle 17 P0-2 + P0-3 端到端测试"
echo "============================================================"
echo ""

# ============================================================
# 1. 文件存在性检查
# ============================================================
echo "[1/6] 文件存在性检查"
echo "----------------------------------------"

assert_file_exists "useMode Hook" "frontend/src/hooks/useMode.ts"
assert_file_exists "useMode 测试" "frontend/src/hooks/useMode.test.ts"
assert_file_exists "ModeToggle 组件" "frontend/src/components/ModeToggle.tsx"
assert_file_exists "previewSandbox 工具" "frontend/src/utils/previewSandbox.ts"
assert_file_exists "previewSandbox 测试" "frontend/src/utils/previewSandbox.test.ts"
assert_file_exists "PreviewPanel 组件" "frontend/src/components/PreviewPanel.tsx"
assert_file_exists "PreviewPanel 测试" "frontend/src/components/PreviewPanel.test.tsx"
assert_file_exists "CYCLE17 SPEC" "CYCLE17_SPEC_PREVIEW.md"

echo ""

# ============================================================
# 2. useMode Hook 验证
# ============================================================
echo "[2/6] useMode Hook 验证"
echo "----------------------------------------"

USE_MODE=frontend/src/hooks/useMode.ts
assert_contains "useMode 导出 HermesMode 类型" "$USE_MODE" "export type HermesMode = 'chat' | 'composer' | 'agent'"
assert_contains "useMode 实现 chat/composer/agent 三模式" "$USE_MODE" "'chat' | 'composer' | 'agent'"
assert_contains "useMode 实现 localStorage 持久化" "$USE_MODE" "localStorage"
assert_contains "useMode 实现 Cmd+L chat 快捷键" "$USE_MODE" "e.key === 'l'"
assert_contains "useMode 实现 Cmd+I composer 快捷键" "$USE_MODE" "e.key === 'i'"
assert_contains "useMode 实现 Cmd+Shift+A agent 快捷键" "$USE_MODE" "e.key === 'A'"
assert_contains "useMode 实现 cycle 循环切换" "$USE_MODE" "const cycle = useCallback"
assert_contains "useMode 导出 useMode 函数" "$USE_MODE" "export function useMode"

# 注释
assert_contains "useMode 文件头注释" "$USE_MODE" "useMode Hook (v6.37.0 Cycle 17 P0-2)"
assert_contains "useMode 修改记录" "$USE_MODE" "Cycle 17 P0-2 初次创建"

# useMode 测试
USE_MODE_TEST=frontend/src/hooks/useMode.test.ts
assert_contains "useMode 测试包含 mode 初始化" "$USE_MODE_TEST" "describe"
assert_contains "useMode 测试包含 setMode" "$USE_MODE_TEST" "setMode"
assert_contains "useMode 测试包含 cycle" "$USE_MODE_TEST" "cycle"
assert_count_ge "useMode 测试用例数" "$USE_MODE_TEST" "it(" 5

echo ""

# ============================================================
# 3. ModeToggle 组件验证
# ============================================================
echo "[3/6] ModeToggle 组件验证"
echo "----------------------------------------"

MODE_TOGGLE=frontend/src/components/ModeToggle.tsx
assert_contains "ModeToggle 导出 ModeToggle 组件" "$MODE_TOGGLE" "export const ModeToggle"
assert_contains "ModeToggle 导出 ModeIndicator 组件" "$MODE_TOGGLE" "export const ModeIndicator"
assert_contains "ModeToggle 实现 Chat 模式" "$MODE_TOGGLE" "{ value: 'chat', label: 'Chat'"
assert_contains "ModeToggle 实现 Composer 模式" "$MODE_TOGGLE" "{ value: 'composer', label: 'Composer'"
assert_contains "ModeToggle 实现 Agent 模式" "$MODE_TOGGLE" "{ value: 'agent', label: 'Agent'"
assert_contains "ModeToggle 包含 data-testid" "$MODE_TOGGLE" "data-testid=\"mode-toggle"
assert_contains "ModeToggle 包含快捷键提示" "$MODE_TOGGLE" "shortcutHints"
assert_contains "ModeToggle 包含 role=\"tablist\"" "$MODE_TOGGLE" "role=\"tablist\""
assert_contains "ModeToggle 包含 aria-selected" "$MODE_TOGGLE" "aria-selected"

# 注释
assert_contains "ModeToggle 文件头注释" "$MODE_TOGGLE" "ModeToggle 组件 (v6.37.0 Cycle 17 P0-2)"

echo ""

# ============================================================
# 4. previewSandbox 工具验证
# ============================================================
echo "[4/6] previewSandbox 工具验证"
echo "----------------------------------------"

PREVIEW_SANDBOX=frontend/src/utils/previewSandbox.ts
assert_contains "previewSandbox 导出 PreviewMode" "$PREVIEW_SANDBOX" "export type PreviewMode = 'html' | 'react' | 'iframe'"
assert_contains "previewSandbox 导出 PreviewStatus" "$PREVIEW_SANDBOX" "export type PreviewStatus"
assert_contains "previewSandbox 导出 PreviewError" "$PREVIEW_SANDBOX" "export interface PreviewError"
assert_contains "previewSandbox 导出 PreviewConfig" "$PREVIEW_SANDBOX" "export interface PreviewConfig"
assert_contains "previewSandbox 导出 PreviewSnapshot" "$PREVIEW_SANDBOX" "export interface PreviewSnapshot"
assert_contains "previewSandbox 导出 SandboxManager" "$PREVIEW_SANDBOX" "export class SandboxManager"
assert_contains "previewSandbox 导出 buildHtmlPreview" "$PREVIEW_SANDBOX" "export function buildHtmlPreview"
assert_contains "previewSandbox 导出 buildReactPreview" "$PREVIEW_SANDBOX" "export function buildReactPreview"
assert_contains "previewSandbox 导出 buildIframePreview" "$PREVIEW_SANDBOX" "export function buildIframePreview"
assert_contains "previewSandbox 导出 buildSandboxAttr" "$PREVIEW_SANDBOX" "export function buildSandboxAttr"
assert_contains "previewSandbox 导出 detectFileType" "$PREVIEW_SANDBOX" "export function detectFileType"
assert_contains "previewSandbox 导出 validateHtml" "$PREVIEW_SANDBOX" "export function validateHtml"
assert_contains "previewSandbox 导出 debounce" "$PREVIEW_SANDBOX" "export function debounce"
assert_contains "previewSandbox 导出 createSandboxManager" "$PREVIEW_SANDBOX" "export function createSandboxManager"
assert_contains "previewSandbox 导出 diffSnapshots" "$PREVIEW_SANDBOX" "export function diffSnapshots"

# SandboxManager 方法
assert_contains "SandboxManager attach 方法" "$PREVIEW_SANDBOX" "attach(iframe: HTMLIFrameElement)"
assert_contains "SandboxManager detach 方法" "$PREVIEW_SANDBOX" "detach()"
assert_contains "SandboxManager update 方法" "$PREVIEW_SANDBOX" "update(files: Record<string, string>)"
assert_contains "SandboxManager updateNow 方法" "$PREVIEW_SANDBOX" "updateNow(files: Record<string, string>)"
assert_contains "SandboxManager reset 方法" "$PREVIEW_SANDBOX" "reset()"
assert_contains "SandboxManager subscribe 方法" "$PREVIEW_SANDBOX" "subscribe(callback"
assert_contains "SandboxManager destroy 方法" "$PREVIEW_SANDBOX" "destroy()"

# 沙箱属性
assert_contains "SandboxManager 处理 allow-scripts" "$PREVIEW_SANDBOX" "allow-scripts"
assert_contains "SandboxManager 处理 allow-same-origin" "$PREVIEW_SANDBOX" "allow-same-origin"

# 注释
assert_contains "previewSandbox 文件头注释" "$PREVIEW_SANDBOX" "Preview Sandbox 工具 (v6.37.0 Cycle 17 P0-3)"

echo ""

# ============================================================
# 5. PreviewPanel 组件验证
# ============================================================
echo "[5/6] PreviewPanel 组件验证"
echo "----------------------------------------"

PREVIEW_PANEL=frontend/src/components/PreviewPanel.tsx
assert_contains "PreviewPanel 导出 PreviewPanel 组件" "$PREVIEW_PANEL" "export function PreviewPanel"
assert_contains "PreviewPanel 导出 PreviewPanelProps" "$PREVIEW_PANEL" "export interface PreviewPanelProps"
assert_contains "PreviewPanel 集成 SandboxManager" "$PREVIEW_PANEL" "createSandboxManager"
assert_contains "PreviewPanel 实现模式切换" "$PREVIEW_PANEL" "preview-mode-switch"
assert_contains "PreviewPanel 实现刷新" "$PREVIEW_PANEL" "preview-refresh"
assert_contains "PreviewPanel 实现重置" "$PREVIEW_PANEL" "preview-reset"
assert_contains "PreviewPanel 实现快照" "$PREVIEW_PANEL" "preview-snapshot"
assert_contains "PreviewPanel 实现全屏" "$PREVIEW_PANEL" "preview-fullscreen"
assert_contains "PreviewPanel 实现关闭" "$PREVIEW_PANEL" "preview-close"
assert_contains "PreviewPanel 实现错误卡片" "$PREVIEW_PANEL" "preview-error-card"
assert_contains "PreviewPanel 实现空状态" "$PREVIEW_PANEL" "preview-empty"
assert_contains "PreviewPanel 实现 iframe" "$PREVIEW_PANEL" "preview-iframe"
assert_contains "PreviewPanel 实现状态徽章" "$PREVIEW_PANEL" "preview-status-"
assert_contains "PreviewPanel 集成 useComposer" "$PREVIEW_PANEL" "useComposer"
assert_contains "PreviewPanel 收集文件" "$PREVIEW_PANEL" "function collectFiles"

# 注释
assert_contains "PreviewPanel 文件头注释" "$PREVIEW_PANEL" "PreviewPanel 组件 (v6.37.0 Cycle 17 P0-3)"

echo ""

# ============================================================
# 6. ComposerPanel 集成验证
# ============================================================
echo "[6/6] ComposerPanel 集成验证"
echo "----------------------------------------"

COMPOSER_PANEL=frontend/src/components/ComposerPanel.tsx
assert_contains "ComposerPanel 导入 PreviewPanel" "$COMPOSER_PANEL" "import { PreviewPanel } from './PreviewPanel'"
assert_contains "ComposerPanel ComposerMode 包含 preview" "$COMPOSER_PANEL" "export type ComposerMode = 'edit' | 'plan' | 'preview'"
assert_contains "ComposerPanel 渲染 PreviewPanel" "$COMPOSER_PANEL" "mode === 'preview' ? ("
assert_contains "ComposerPanel Preview 切换按钮" "$COMPOSER_PANEL" "composer-mode-preview"
assert_contains "ComposerPanel 监听 preview 模式切换" "$COMPOSER_PANEL" "next === 'plan' || next === 'edit' || next === 'preview'"
assert_contains "ComposerPanel 修改记录 v1.2.0" "$COMPOSER_PANEL" "v1.2.0 | Cycle 17 P0-3 Preview Mode 集成"

# ComposerPanel 测试
COMPOSER_PANEL_TEST=frontend/src/components/ComposerPanel.test.tsx
assert_contains "ComposerPanel 测试存在" "$COMPOSER_PANEL_TEST" "describe('ComposerPanel"

echo ""

# ============================================================
# 7. 运行 vitest 单元测试
# ============================================================
echo "[7/6] 运行 vitest 单元测试"
echo "----------------------------------------"

if [ -d "frontend/node_modules" ]; then
  cd frontend
  export PATH="/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH"
  
  if command -v node >/dev/null 2>&1; then
    echo "  运行 PreviewPanel.test.tsx..."
    if node node_modules/.bin/vitest run src/components/PreviewPanel.test.tsx >/tmp/cycle17_preview.log 2>&1; then
      PREVIEW_RESULT=$(grep -E "Tests +[0-9]+ passed" /tmp/cycle17_preview.log | tail -1)
      assert_pass "PreviewPanel.test.tsx: $PREVIEW_RESULT"
    else
      assert_fail "PreviewPanel.test.tsx" "all tests pass" "see /tmp/cycle17_preview.log"
    fi

    echo "  运行 previewSandbox.test.ts..."
    if node node_modules/.bin/vitest run src/utils/previewSandbox.test.ts >/tmp/cycle17_sandbox.log 2>&1; then
      SANDBOX_RESULT=$(grep -E "Tests +[0-9]+ passed" /tmp/cycle17_sandbox.log | tail -1)
      assert_pass "previewSandbox.test.ts: $SANDBOX_RESULT"
    else
      assert_fail "previewSandbox.test.ts" "all tests pass" "see /tmp/cycle17_sandbox.log"
    fi

    echo "  运行 useMode.test.ts..."
    if node node_modules/.bin/vitest run src/hooks/useMode.test.ts >/tmp/cycle17_mode.log 2>&1; then
      MODE_RESULT=$(grep -E "Tests +[0-9]+ passed" /tmp/cycle17_mode.log | tail -1)
      assert_pass "useMode.test.ts: $MODE_RESULT"
    else
      assert_fail "useMode.test.ts" "all tests pass" "see /tmp/cycle17_mode.log"
    fi

    echo "  运行 ComposerPanel.test.tsx..."
    if node node_modules/.bin/vitest run src/components/ComposerPanel.test.tsx >/tmp/cycle17_composer.log 2>&1; then
      COMPOSER_RESULT=$(grep -E "Tests +[0-9]+ passed" /tmp/cycle17_composer.log | tail -1)
      assert_pass "ComposerPanel.test.tsx: $COMPOSER_RESULT"
    else
      assert_fail "ComposerPanel.test.tsx" "all tests pass" "see /tmp/cycle17_composer.log"
    fi
  else
    assert_fail "node 可用性" "node available" "not found"
  fi
  cd ..
else
  assert_fail "frontend/node_modules 存在" "exists" "not found"
fi

echo ""
echo "============================================================"
echo "  测试结果"
echo "============================================================"
echo -e "  ${GREEN}通过: $PASS${NC}"
echo -e "  ${RED}失败: $FAIL${NC}"
echo -e "  总计: $TOTAL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Cycle 17 P0-2 + P0-3 端到端测试未通过${NC}"
  exit 1
fi

echo -e "${GREEN}Cycle 17 P0-2 + P0-3 端到端测试全部通过！${NC}"
exit 0
