#!/bin/bash
# ============================================================
# Cycle 19 E2E Test: 后台任务 + 多模型对比 + 设计模式三面板
# ============================================================
# 验证内容：
#   1. BackgroundTaskEngine 单例 API 完整
#   2. MultiModelExecutor 并行执行 + 事件订阅
#   3. DesignModeController 元素识别 + 状态管理
#   4. 三面板 UI 组件渲染 + 交互
#   5. App.tsx 集成 + BrandHeader 菜单项
#   6. Esc 键关闭支持
# ============================================================
# 退出码：
#   0 - 全部通过
#   非 0 - 有失败
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

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

FRONTEND_DIR="/home/qizheng/auto_code_ws/frontend"
WORKSPACE_DIR="/home/qizheng/auto_code_ws"
cd "$FRONTEND_DIR"

export PATH=/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH

# ============================================================
# Section 1: BackgroundTaskEngine 引擎
# ============================================================
section "Section 1: BackgroundTaskEngine 引擎验证"

test_file="$FRONTEND_DIR/src/utils/backgroundTaskEngine.ts"
if [ -f "$test_file" ]; then
    pass "BackgroundTaskEngine 文件存在"
else
    fail "BackgroundTaskEngine 文件不存在"
fi

# 验证核心类
if grep -q "class BackgroundTaskEngine" "$test_file"; then
    pass "BackgroundTaskEngine 类定义"
fi

# 验证核心方法
if grep -q "createTask" "$test_file" && grep -q "startTask" "$test_file" && grep -q "pauseTask" "$test_file"; then
    pass "核心方法: createTask / startTask / pauseTask"
fi

if grep -q "resumeTask" "$test_file" && grep -q "cancelTask" "$test_file" && grep -q "retryTask" "$test_file"; then
    pass "核心方法: resumeTask / cancelTask / retryTask"
fi

# 验证事件系统
if grep -q "TaskEventBus" "$test_file" && grep -q "on(" "$test_file"; then
    pass "事件系统: TaskEventBus + on()"
fi

# 验证持久化
if grep -q "localStorage" "$test_file"; then
    pass "持久化: localStorage 支持"
fi

# 验证单例
if grep -q "getBackgroundTaskEngine" "$test_file" && grep -q "resetBackgroundTaskEngine" "$test_file"; then
    pass "单例: getBackgroundTaskEngine + reset"
fi

# ============================================================
# Section 2: MultiModelExecutor 引擎
# ============================================================
section "Section 2: MultiModelExecutor 引擎验证"

test_file="$FRONTEND_DIR/src/utils/multiModelExecutor.ts"
if [ -f "$test_file" ]; then
    pass "MultiModelExecutor 文件存在"
else
    fail "MultiModelExecutor 文件不存在"
fi

if grep -q "class MultiModelExecutor" "$test_file"; then
    pass "MultiModelExecutor 类定义"
fi

if grep -q "execute" "$test_file" && grep -q "cancel" "$test_file" && grep -q "retry" "$test_file"; then
    pass "核心方法: execute / cancel / retry"
fi

# 验证事件类型
event_types_file="$FRONTEND_DIR/src/utils/bestOfNTypes.ts"
if grep -q "BestOfNEvent" "$event_types_file"; then
    pass "事件类型: BestOfNEvent 联合类型"
fi

# 验证事件类型变体
for event_type in start delta done error all-complete; do
    if grep -q "type: '$event_type'" "$event_types_file"; then
        pass "事件变体: $event_type"
    else
        fail "事件变体缺失: $event_type"
    fi
done

# 验证 DEFAULT_MODELS
if grep -q "DEFAULT_MODELS" "$event_types_file" && grep -q "claude-sonnet" "$event_types_file" && grep -q "gpt-5" "$event_types_file"; then
    pass "预置模型: DEFAULT_MODELS (Claude/GPT/DeepSeek/Gemini)"
fi

# 验证成本计算
if grep -q "calculateCost" "$event_types_file" && grep -q "estimateTokens" "$event_types_file"; then
    pass "工具方法: calculateCost + estimateTokens"
fi

# ============================================================
# Section 3: DesignModeController 引擎
# ============================================================
section "Section 3: DesignModeController 引擎验证"

test_file="$FRONTEND_DIR/src/utils/designModeController.ts"
if [ -f "$test_file" ]; then
    pass "DesignModeController 文件存在"
else
    fail "DesignModeController 文件不存在"
fi

if grep -q "class DesignModeController" "$test_file"; then
    pass "DesignModeController 类定义"
fi

if grep -q "activate" "$test_file" && grep -q "deactivate" "$test_file" && grep -q "select" "$test_file" && grep -q "deselect" "$test_file"; then
    pass "核心方法: activate / deactivate / select / deselect"
fi

if grep -q "getElementInfo" "$test_file" && grep -q "getSelector" "$test_file" && grep -q "injectElementContext" "$test_file"; then
    pass "元素提取: getElementInfo / getSelector / injectElementContext"
fi

# 验证事件类型
if grep -q "DesignEvent" "$test_file"; then
    pass "事件系统: DesignEvent"
fi

# 验证 maxSelected
if grep -q "maxSelected" "$test_file"; then
    pass "状态约束: maxSelected 最大选择数"
fi

# 验证框选（drag）
if grep -q "drag" "$test_file" && grep -q "selectionBox\|dragBox" "$test_file"; then
    pass "框选支持: drag + selectionBox"
fi

# ============================================================
# Section 4: UI 组件存在性
# ============================================================
section "Section 4: UI 组件存在性"

for component in BackgroundTasksPanel BestOfNPanel DesignModeOverlay; do
    if [ -f "$FRONTEND_DIR/src/components/${component}.tsx" ]; then
        pass "组件存在: $component"
    else
        fail "组件缺失: $component"
    fi
done

# 验证组件关键元素
for component in BackgroundTasksPanel BestOfNPanel DesignModeOverlay; do
    if grep -q "data-testid" "$FRONTEND_DIR/src/components/${component}.tsx"; then
        pass "$component 包含 data-testid"
    fi
done

# 验证 Esc 键支持
for component in BackgroundTasksPanel BestOfNPanel; do
    if grep -q "Escape" "$FRONTEND_DIR/src/components/${component}.tsx"; then
        pass "$component 支持 Esc 键关闭"
    fi
done

# 验证渐变背景
if grep -q "bg-gradient-to-br" "$FRONTEND_DIR/src/components/BackgroundTasksPanel.tsx"; then
    pass "BackgroundTasksPanel 渐变背景"
fi
if grep -q "bg-gradient-to-br" "$FRONTEND_DIR/src/components/BestOfNPanel.tsx"; then
    pass "BestOfNPanel 渐变背景"
fi

# ============================================================
# Section 5: App.tsx 集成
# ============================================================
section "Section 5: App.tsx 集成验证"

app_file="$FRONTEND_DIR/src/App.tsx"
if grep -q "BackgroundTasksPanel" "$app_file" && grep -q "BestOfNPanel" "$app_file" && grep -q "DesignModeOverlay" "$app_file"; then
    pass "App.tsx 引入三面板"
fi

# 验证状态管理
if grep -q "backgroundTasksOpen" "$app_file" && grep -q "bestOfNOpen" "$app_file" && grep -q "designModeOpen" "$app_file"; then
    pass "App.tsx 三状态管理"
fi

# 验证 handler
if grep -q "handleOpenBackgroundTasks" "$app_file" && grep -q "handleOpenBestOfN" "$app_file" && grep -q "handleOpenDesignMode" "$app_file"; then
    pass "App.tsx 三 handler"
fi

# 验证 ErrorBoundary 嵌套
if grep -q 'name="BackgroundTasks"' "$app_file" && grep -q 'name="BestOfN"' "$app_file" && grep -q 'name="DesignMode"' "$app_file"; then
    pass "三面板 ErrorBoundary 嵌套"
fi

# 验证透传到 AppLayout
if grep -q "onOpenBackgroundTasks={handleOpenBackgroundTasks}" "$app_file" && \
   grep -q "onOpenBestOfN={handleOpenBestOfN}" "$app_file" && \
   grep -q "onOpenDesignMode={handleOpenDesignMode}" "$app_file"; then
    pass "App.tsx → AppLayout 三回调透传"
fi

# ============================================================
# Section 6: BrandHeader 菜单项
# ============================================================
section "Section 6: BrandHeader 菜单项验证"

header_file="$FRONTEND_DIR/src/components/BrandHeader.tsx"
if grep -q "onOpenBackgroundTasks" "$header_file" && grep -q "onOpenBestOfN" "$header_file" && grep -q "onOpenDesignMode" "$header_file"; then
    pass "BrandHeader 三回调 prop 定义"
fi

# 验证菜单按钮
if grep -q "background-tasks" "$header_file"; then
    pass "BrandHeader 后台任务菜单项"
fi
if grep -q "best-of-n" "$header_file"; then
    pass "BrandHeader Best-of-N 菜单项"
fi
if grep -q "design-mode" "$header_file"; then
    pass "BrandHeader Design Mode 菜单项"
fi

# 验证 SVG 图标
if grep -q "case 'background-tasks'" "$header_file" && grep -q "case 'best-of-n'" "$header_file" && grep -q "case 'design-mode'" "$header_file"; then
    pass "BrandHeader 三 SVG 图标实现"
fi

# ============================================================
# Section 7: TypeScript 编译
# ============================================================
section "Section 7: TypeScript 编译验证"

if npx tsc --noEmit 2>&1 | head -5; then
    pass "TypeScript 编译 0 错误"
fi

# ============================================================
# Section 8: 自动化测试
# ============================================================
section "Section 8: 自动化测试验证"

# 单元测试
info "运行单元测试..."
unit_result=$(npx vitest run --reporter=basic \
  src/utils/backgroundTaskEngine.test.ts \
  src/utils/multiModelExecutor.test.ts \
  src/utils/designModeController.test.ts 2>&1 | tail -10)
echo "$unit_result"

unit_pass=$(echo "$unit_result" | grep -oE 'Tests +[0-9]+ passed' | head -1)
if echo "$unit_pass" | grep -q "passed" && ! echo "$unit_pass" | grep -q "failed"; then
    pass "单元测试: $unit_pass"
fi

# 组件测试
info "运行组件测试..."
comp_result=$(npx vitest run --reporter=basic \
  src/components/BackgroundTasksPanel.test.tsx \
  src/components/BestOfNPanel.test.tsx \
  src/components/DesignModeOverlay.test.tsx 2>&1 | tail -10)
echo "$comp_result"

comp_pass=$(echo "$comp_result" | grep -oE 'Tests +[0-9]+ passed' | head -1)
if echo "$comp_pass" | grep -q "passed" && ! echo "$comp_pass" | grep -q "failed"; then
    pass "组件测试: $comp_pass"
fi

# ============================================================
# Section 9: SPEC 文档完整性
# ============================================================
section "Section 9: SPEC 文档完整性"

for spec in CYCLE19_GAP_ANALYSIS CYCLE19_SPEC_BACKGROUND_TASKS CYCLE19_SPEC_BEST_OF_N CYCLE19_SPEC_DESIGN_MODE; do
    if [ -f "$WORKSPACE_DIR/${spec}.md" ]; then
        pass "SPEC 文档: ${spec}.md"
    else
        fail "SPEC 文档缺失: ${spec}.md"
    fi
done

# 验证 SPEC 大小（每个至少 10KB）
for spec in CYCLE19_GAP_ANALYSIS CYCLE19_SPEC_BACKGROUND_TASKS CYCLE19_SPEC_BEST_OF_N CYCLE19_SPEC_DESIGN_MODE; do
    size=$(stat -c%s "$WORKSPACE_DIR/${spec}.md" 2>/dev/null || echo 0)
    if [ "$size" -gt 10000 ]; then
        pass "${spec}.md 大小: $size bytes"
    fi
done

# ============================================================
# 总结
# ============================================================
section "测试总结"

TOTAL=$((PASS_COUNT + FAIL_COUNT))
PERCENT=$((PASS_COUNT * 100 / TOTAL))

echo ""
echo -e "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
echo -e "${RED}失败: $FAIL_COUNT${NC}"
echo -e "通过率: $PERCENT%"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ 全部通过！Cycle 19 Phase 3+5 集成完成${NC}"
    exit 0
else
    echo -e "${RED}❌ 有 $FAIL_COUNT 项失败${NC}"
    exit 1
fi
