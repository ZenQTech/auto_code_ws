#!/bin/bash
# ============================================================
# Cycle 18 P0-3 E2E Test: 错误边界与全局错误处理
# ============================================================
# 验证内容：
#   1. globalErrorHandler 单例 API 完整
#   2. useGlobalError Hook 状态同步
#   3. GlobalErrorToast 组件渲染与交互
#   4. main.tsx 集成 + App.tsx 集成
#   5. ErrorBoundary 嵌套关键面板
#   6. Tailwind shrink-width 动画可用
# ============================================================
# 退出码：
#   0 - 全部通过
#   非 0 - 有失败
# ============================================================

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# 工具函数
pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo -e "${RED}✗${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

section() {
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}========================================${NC}"
}

# 进入前端目录
FRONTEND_DIR="/home/qizheng/auto_code_ws/frontend"
WORKSPACE_DIR="/home/qizheng/auto_code_ws"
cd "$FRONTEND_DIR"

# ============================================================
# Part 1: 文件存在性检查
# ============================================================
section "Part 1: 文件存在性检查"

[ -f "src/utils/globalErrorHandler.ts" ] && pass "globalErrorHandler.ts 存在" || fail "globalErrorHandler.ts 缺失"
[ -f "src/utils/globalErrorHandler.test.ts" ] && pass "globalErrorHandler.test.ts 存在" || fail "globalErrorHandler.test.ts 缺失"
[ -f "src/hooks/useGlobalError.ts" ] && pass "useGlobalError.ts 存在" || fail "useGlobalError.ts 缺失"
[ -f "src/hooks/useGlobalError.test.ts" ] && pass "useGlobalError.test.ts 存在" || fail "useGlobalError.test.ts 缺失"
[ -f "src/components/GlobalErrorToast.tsx" ] && pass "GlobalErrorToast.tsx 存在" || fail "GlobalErrorToast.tsx 缺失"
[ -f "src/components/GlobalErrorToast.test.tsx" ] && pass "GlobalErrorToast.test.tsx 存在" || fail "GlobalErrorToast.test.tsx 缺失"
[ -f "$WORKSPACE_DIR/CYCLE18_P0_3_SPEC.md" ] && pass "CYCLE18_P0_3_SPEC.md 存在" || fail "CYCLE18_P0_3_SPEC.md 缺失"

# ============================================================
# Part 2: 文件内容完整性检查
# ============================================================
section "Part 2: 文件内容完整性"

# 2.1 globalErrorHandler 必须包含核心 API
info "检查 globalErrorHandler.ts 核心 API..."
grep -q "class GlobalErrorHandlerClass" src/utils/globalErrorHandler.ts && pass "GlobalErrorHandlerClass 类存在" || fail "GlobalErrorHandlerClass 类缺失"
grep -q "install" src/utils/globalErrorHandler.ts && pass "install 方法存在" || fail "install 方法缺失"
grep -q "uninstall" src/utils/globalErrorHandler.ts && pass "uninstall 方法存在" || fail "uninstall 方法缺失"
grep -q "reportError" src/utils/globalErrorHandler.ts && pass "reportError 方法存在" || fail "reportError 方法缺失"
grep -q "subscribe" src/utils/globalErrorHandler.ts && pass "subscribe 方法存在" || fail "subscribe 方法缺失"
grep -q "getReports" src/utils/globalErrorHandler.ts && pass "getReports 方法存在" || fail "getReports 方法缺失"
grep -q "markDismissed" src/utils/globalErrorHandler.ts && pass "markDismissed 方法存在" || fail "markDismissed 方法缺失"
grep -q "clearReports" src/utils/globalErrorHandler.ts && pass "clearReports 方法存在" || fail "clearReports 方法缺失"
grep -q "window.onerror" src/utils/globalErrorHandler.ts && pass "window.onerror 监听器存在" || fail "window.onerror 监听器缺失"
grep -q "onunhandledrejection" src/utils/globalErrorHandler.ts && pass "unhandledrejection 监听器存在" || fail "unhandledrejection 监听器缺失"

# 2.2 useGlobalError 必须暴露核心 API
info "检查 useGlobalError.ts 核心 API..."
grep -q "currentError" src/hooks/useGlobalError.ts && pass "currentError 字段存在" || fail "currentError 字段缺失"
grep -q "dismissError" src/hooks/useGlobalError.ts && pass "dismissError 方法存在" || fail "dismissError 方法缺失"
grep -q "clearHistory" src/hooks/useGlobalError.ts && pass "clearHistory 方法存在" || fail "clearHistory 方法缺失"
grep -q "useSyncExternalStore" src/hooks/useGlobalError.ts && pass "useSyncExternalStore 订阅模式存在" || fail "useSyncExternalStore 订阅模式缺失"

# 2.3 GlobalErrorToast 必须实现交互
info "检查 GlobalErrorToast.tsx 交互..."
grep -q "data-testid=\"global-error-toast\"" src/components/GlobalErrorToast.tsx && pass "Toast 元素 testid 存在" || fail "Toast 元素 testid 缺失"
grep -q "data-testid=\"global-error-dismiss\"" src/components/GlobalErrorToast.tsx && pass "忽略按钮 testid 存在" || fail "忽略按钮 testid 缺失"
grep -q "data-testid=\"global-error-clear\"" src/components/GlobalErrorToast.tsx && pass "清空按钮 testid 存在" || fail "清空按钮 testid 缺失"
grep -q "data-testid=\"global-error-detail-toggle\"" src/components/GlobalErrorToast.tsx && pass "详情切换按钮 testid 存在" || fail "详情切换按钮 testid 缺失"
grep -q "role=\"alert\"" src/components/GlobalErrorToast.tsx && pass "role=alert 无障碍属性存在" || fail "role=alert 缺失"
grep -q "aria-live=\"assertive\"" src/components/GlobalErrorToast.tsx && pass "aria-live 属性存在" || fail "aria-live 缺失"
grep -q "autoHideMs" src/components/GlobalErrorToast.tsx && pass "autoHideMs 自动关闭配置存在" || fail "autoHideMs 缺失"

# 2.4 main.tsx 集成检查
info "检查 main.tsx 集成..."
grep -q "globalErrorHandler.install" src/main.tsx && pass "main.tsx 中安装 globalErrorHandler" || fail "main.tsx 未安装 globalErrorHandler"
grep -q "ErrorBoundary" src/main.tsx && pass "main.tsx 中保留 ErrorBoundary" || fail "main.tsx 中 ErrorBoundary 缺失"
grep -q "silentPatterns" src/main.tsx && pass "main.tsx 中配置静默模式" || fail "main.tsx 未配置静默模式"

# 2.5 App.tsx 集成检查
info "检查 App.tsx 集成..."
grep -q "GlobalErrorToast" src/App.tsx && pass "App.tsx 引入 GlobalErrorToast" || fail "App.tsx 未引入 GlobalErrorToast"
grep -q 'ErrorBoundary level="panel"' src/App.tsx && pass "App.tsx 嵌套 ErrorBoundary level=panel" || fail "App.tsx 未嵌套 ErrorBoundary"

# 2.6 Tailwind 动画配置
info "检查 Tailwind 动画配置..."
grep -q "shrink-width" tailwind.config.js && pass "shrink-width 动画配置存在" || fail "shrink-width 动画配置缺失"

# ============================================================
# Part 3: 单元测试运行
# ============================================================
section "Part 3: 单元测试运行"

export PATH="/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH"

# 3.1 运行 globalErrorHandler 测试
info "运行 globalErrorHandler.test.ts..."
if npm run test -- src/utils/globalErrorHandler.test.ts --reporter=basic 2>&1 | tail -5 | grep -q "Tests.*passed"; then
    pass "globalErrorHandler.test.ts 全部通过"
else
    fail "globalErrorHandler.test.ts 有失败"
fi

# 3.2 运行 useGlobalError 测试
info "运行 useGlobalError.test.ts..."
if npm run test -- src/hooks/useGlobalError.test.ts --reporter=basic 2>&1 | tail -5 | grep -q "Tests.*passed"; then
    pass "useGlobalError.test.ts 全部通过"
else
    fail "useGlobalError.test.ts 有失败"
fi

# 3.3 运行 GlobalErrorToast 测试
info "运行 GlobalErrorToast.test.tsx..."
if npm run test -- src/components/GlobalErrorToast.test.tsx --reporter=basic 2>&1 | tail -5 | grep -q "Tests.*passed"; then
    pass "GlobalErrorToast.test.tsx 全部通过"
else
    fail "GlobalErrorToast.test.tsx 有失败"
fi

# 3.4 运行 ErrorBoundary 测试（确保未回归）
info "运行 ErrorBoundary.test.tsx（回归检查）..."
if npm run test -- src/components/ErrorBoundary.test.tsx --reporter=basic 2>&1 | tail -5 | grep -q "Tests.*passed"; then
    pass "ErrorBoundary.test.tsx 全部通过（无回归）"
else
    fail "ErrorBoundary.test.tsx 有失败"
fi

# ============================================================
# Part 4: TypeScript 类型检查
# ============================================================
section "Part 4: TypeScript 类型检查"

info "运行 TypeScript 编译检查（仅新增文件）..."
TS_OUTPUT=$(npx tsc --noEmit 2>&1 || true)
TS_GLOBAL_ERROR_COUNT=$(echo "$TS_OUTPUT" | grep -E "(globalError|useGlobalError|GlobalErrorToast)" | wc -l)
if [ "$TS_GLOBAL_ERROR_COUNT" -eq 0 ]; then
    pass "新增文件无 TypeScript 错误"
else
    fail "新增文件存在 $TS_GLOBAL_ERROR_COUNT 个 TypeScript 错误"
    echo "$TS_OUTPUT" | grep -E "(globalError|useGlobalError|GlobalErrorToast)" | head -5
fi

# ============================================================
# Part 5: 集成验证（检查关键面板 ErrorBoundary 嵌套）
# ============================================================
section "Part 5: 集成验证"

# 5.1 App.tsx 中包含至少 4 个 ErrorBoundary 嵌套
info "检查 App.tsx 中 ErrorBoundary 嵌套数量..."
EB_COUNT=$(grep -c "ErrorBoundary" src/App.tsx || echo 0)
if [ "$EB_COUNT" -ge 4 ]; then
    pass "App.tsx 中 ErrorBoundary 引用 $EB_COUNT 处（>=4）"
else
    fail "App.tsx 中 ErrorBoundary 引用仅 $EB_COUNT 处（<4）"
fi

# 5.2 main.tsx 中包含 globalErrorHandler.install
info "检查 main.tsx 中 install 调用..."
INSTALL_COUNT=$(grep -c "globalErrorHandler.install" src/main.tsx || echo 0)
if [ "$INSTALL_COUNT" -ge 1 ]; then
    pass "main.tsx 中 install 调用 $INSTALL_COUNT 次"
else
    fail "main.tsx 中缺少 install 调用"
fi

# 5.3 GlobalErrorToast 包含至少 4 个不同错误类型的图标
info "检查错误类型图标覆盖..."
ICON_COUNT=$(grep -cE "(js_error|promise_rejection|resource_error|fetch_error|manual_report)" src/components/GlobalErrorToast.tsx || echo 0)
if [ "$ICON_COUNT" -ge 5 ]; then
    pass "GlobalErrorToast 覆盖 5 种错误类型"
else
    fail "GlobalErrorToast 仅覆盖 $ICON_COUNT 种错误类型"
fi

# 5.4 silentPatterns 包含 ResizeObserver 静默
info "检查静默模式配置..."
grep -q "ResizeObserver loop" src/main.tsx && pass "静默模式配置了 ResizeObserver loop" || fail "静默模式未配置 ResizeObserver loop"

# 5.5 单元测试用例总数验证（应至少 60）
info "检查单元测试用例总数..."
# 简化策略：分别运行三个测试文件并累加通过数
strip_ansi() { sed -r "s/\x1B\[[0-9;]*[a-zA-Z]//g"; }
COUNT_GH=0
COUNT_UG=0
COUNT_GE=0
TEST_OUT_GH=$(npm run test -- src/utils/globalErrorHandler.test.ts --reporter=basic 2>&1 || true)
COUNT_GH=$(echo "$TEST_OUT_GH" | strip_ansi | grep "Tests " | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
COUNT_GH=${COUNT_GH:-0}
TEST_OUT_UG=$(npm run test -- src/hooks/useGlobalError.test.ts --reporter=basic 2>&1 || true)
COUNT_UG=$(echo "$TEST_OUT_UG" | strip_ansi | grep "Tests " | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
COUNT_UG=${COUNT_UG:-0}
TEST_OUT_GE=$(npm run test -- src/components/GlobalErrorToast.test.tsx --reporter=basic 2>&1 || true)
COUNT_GE=$(echo "$TEST_OUT_GE" | strip_ansi | grep "Tests " | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
COUNT_GE=${COUNT_GE:-0}
TOTAL_TESTS=$((COUNT_GH + COUNT_UG + COUNT_GE))
info "  globalErrorHandler: $COUNT_GH, useGlobalError: $COUNT_UG, GlobalErrorToast: $COUNT_GE, 合计: $TOTAL_TESTS"
if [ "$TOTAL_TESTS" -ge 60 ] 2>/dev/null; then
    pass "单元测试用例总数 $TOTAL_TESTS 个（>=60）"
else
    fail "单元测试用例总数仅 $TOTAL_TESTS 个（<60）"
fi

# ============================================================
# 总结
# ============================================================
section "测试总结"

echo ""
echo "总断言数: $TOTAL_COUNT"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo -e "${RED}失败: $FAIL_COUNT${NC}"
else
    echo -e "${GREEN}失败: 0${NC}"
fi
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Cycle 18 P0-3 E2E 测试全部通过${NC}"
    echo -e "${GREEN}========================================${NC}"
    exit 0
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}✗ 有 $FAIL_COUNT 项失败${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi
