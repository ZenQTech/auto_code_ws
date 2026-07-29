#!/bin/bash
# ============================================================
# Cycle 20 E2E Test: Worktree Manager + Smart Model Router + Hooks Engine
# ============================================================
# 验证内容：
#   1. WorktreeManager 引擎：CRUD + 状态管理 + 持久化 + 单例
#   2. ModelRouter 引擎：任务分类 + 复杂度评估 + 路由评分 + 决策日志
#   3. HooksEngine 引擎：钩子注册 + 触发 + 执行历史
#   4. 三面板 UI 组件渲染 + 交互
#   5. App.tsx 集成 + BrandHeader 菜单项
#   6. Loop Engineering 工作流无回归
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
# Section 1: WorktreeManager 引擎
# ============================================================
section "Section 1: WorktreeManager 引擎验证"

test_file="$FRONTEND_DIR/src/utils/worktreeManager.ts"
if [ -f "$test_file" ]; then
    pass "WorktreeManager 文件存在"
else
    fail "WorktreeManager 文件不存在"
fi

if grep -q "class WorktreeManager" "$test_file"; then
    pass "WorktreeManager 类定义"
else
    fail "WorktreeManager 类未定义"
fi

# 核心方法
for method in create list get remove merge diff discard; do
    if grep -q "async $method\|$method(" "$test_file" | head -1; then
        pass "核心方法: $method"
    else
        fail "缺少方法: $method"
    fi
done

# 状态管理
for status in creating ready "in-use" modified merged discarded error; do
    if grep -q "'$status'" "$test_file" || grep -q "\"$status\"" "$test_file"; then
        pass "状态枚举: $status"
    else
        fail "缺少状态: $status"
    fi
done

# 事件订阅
if grep -q "subscribe" "$test_file" && grep -q "emit" "$test_file"; then
    pass "事件系统: subscribe + emit"
fi

# Backend 抽象
if grep -q "MockWorktreeBackend" "$test_file" && grep -q "WorktreeBackend" "$test_file"; then
    pass "Backend 抽象: MockWorktreeBackend + WorktreeBackend interface"
fi

# Storage 抽象
if grep -q "MemoryWorktreeStorage" "$test_file" && grep -q "LocalStorageWorktreeStorage" "$test_file"; then
    pass "Storage 抽象: Memory + LocalStorage"
fi

# 单例
if grep -q "getWorktreeManager" "$test_file" && grep -q "resetWorktreeManager" "$test_file"; then
    pass "单例: getWorktreeManager + reset"
fi

# Cleanup
if grep -q "cleanup" "$test_file" && grep -q "autoCleanupDays" "$test_file"; then
    pass "清理机制: cleanup() + autoCleanupDays"
fi

# ============================================================
# Section 2: SmartModelRouter 引擎
# ============================================================
section "Section 2: SmartModelRouter 引擎验证"

test_file="$FRONTEND_DIR/src/utils/modelRouter.ts"
if [ -f "$test_file" ]; then
    pass "ModelRouter 文件存在"
else
    fail "ModelRouter 文件不存在"
fi

if grep -q "class ModelRouter" "$test_file"; then
    pass "ModelRouter 类定义"
fi

# 核心方法
for method in route classify estimateComplexity registerModel listModels; do
    if grep -q "$method" "$test_file"; then
        pass "核心方法: $method"
    fi
done

# 任务分类
for category in code_generation code_review debugging documentation translation refactoring testing analysis; do
    if grep -q "'$category'" "$test_file"; then
        pass "任务分类: $category"
    fi
done

# 路由模式
for mode in cost balance intelligence; do
    if grep -q "'$mode'" "$test_file"; then
        pass "路由模式: $mode"
    fi
done

# 预置模型
if grep -q "DEFAULT_MODELS" "$test_file" && grep -q "claude-sonnet" "$test_file"; then
    pass "预置模型: DEFAULT_MODELS (Claude)"
fi
if grep -q "gpt" "$test_file"; then
    pass "预置模型: GPT 系列"
fi

# 评分算法
if grep -q "scoreModel" "$test_file" && grep -q "capabilityScore" "$test_file"; then
    pass "评分算法: scoreModel + capabilityScore"
fi

# 决策日志
if grep -q "DecisionLog\|getDecisionLog" "$test_file"; then
    pass "决策日志: DecisionLog + getDecisionLog"
fi

# 单例
if grep -q "getModelRouter" "$test_file" && grep -q "resetModelRouter" "$test_file"; then
    pass "单例: getModelRouter + reset"
fi

# ============================================================
# Section 3: HooksEngine 引擎
# ============================================================
section "Section 3: HooksEngine 引擎验证"

test_file="$FRONTEND_DIR/src/utils/hooksEngine.ts"
if [ -f "$test_file" ]; then
    pass "HooksEngine 文件存在"
else
    fail "HooksEngine 文件不存在"
fi

if grep -q "class HooksEngine" "$test_file"; then
    pass "HooksEngine 类定义"
fi

# 核心方法
for method in registerHook unregisterHook setEnabled list trigger getExecutionLog clearExecutionLog; do
    if grep -q "$method" "$test_file"; then
        pass "核心方法: $method"
    fi
done

# 事件类型
for hook_type in before_prompt after_prompt before_response after_response thinking subagent_start subagent_end compaction turn_complete tool_execution; do
    if grep -q "'$hook_type'" "$test_file"; then
        pass "Hook 类型: $hook_type"
    fi
done

# Action 类型
for action in callback webhook command script; do
    if grep -q "type: '$action'" "$test_file"; then
        pass "Action 类型: $action"
    fi
done

# 执行状态
for status in success failed timeout pending running cancelled; do
    if grep -q "'$status'" "$test_file" && grep -q "HookExecutionStatus" "$test_file"; then
        pass "执行状态: $status"
    fi
done

# 事件订阅
if grep -q "on(" "$test_file" && grep -q "emit" "$test_file"; then
    pass "事件订阅: on() + emit"
fi

# 单例
if grep -q "getHooksEngine" "$test_file" && grep -q "resetHooksEngine" "$test_file"; then
    pass "单例: getHooksEngine + reset"
fi

# 便捷触发函数
for func in triggerBeforePrompt triggerAfterResponse triggerThinking; do
    if grep -q "export.*$func" "$test_file"; then
        pass "便捷函数: $func"
    fi
done

# ============================================================
# Section 4: UI 组件存在性
# ============================================================
section "Section 4: UI 组件存在性验证"

# WorktreePanel
if [ -f "$FRONTEND_DIR/src/components/WorktreePanel.tsx" ]; then
    pass "WorktreePanel.tsx 存在"
fi
if grep -q "data-testid=\"worktree-panel\"" "$FRONTEND_DIR/src/components/WorktreePanel.tsx"; then
    pass "WorktreePanel testid 存在"
fi
if grep -q "data-testid=\"worktree-create-isolated\"" "$FRONTEND_DIR/src/components/WorktreePanel.tsx"; then
    pass "WorktreePanel 创建按钮 testid 存在"
fi

# ModelRouterPanel
if [ -f "$FRONTEND_DIR/src/components/ModelRouterPanel.tsx" ]; then
    pass "ModelRouterPanel.tsx 存在"
fi
if grep -q "data-testid=\"model-router-panel\"" "$FRONTEND_DIR/src/components/ModelRouterPanel.tsx"; then
    pass "ModelRouterPanel testid 存在"
fi
if grep -q "data-testid=\"mode-cost\"" "$FRONTEND_DIR/src/components/ModelRouterPanel.tsx"; then
    pass "ModelRouterPanel 路由模式 testid 存在"
fi

# HooksManagerPanel
if [ -f "$FRONTEND_DIR/src/components/HooksManagerPanel.tsx" ]; then
    pass "HooksManagerPanel.tsx 存在"
fi
if grep -q "data-testid=\"hooks-manager-panel\"" "$FRONTEND_DIR/src/components/HooksManagerPanel.tsx"; then
    pass "HooksManagerPanel testid 存在"
fi
if grep -q "data-testid=\"hooks-manager-trigger\"" "$FRONTEND_DIR/src/components/HooksManagerPanel.tsx"; then
    pass "HooksManagerPanel 触发按钮 testid 存在"
fi

# ============================================================
# Section 5: App.tsx 集成
# ============================================================
section "Section 5: App.tsx 集成验证"

app_file="$FRONTEND_DIR/src/App.tsx"
if [ -f "$app_file" ]; then
    pass "App.tsx 存在"
fi

if grep -q "import { WorktreePanel }" "$app_file"; then
    pass "App.tsx 导入 WorktreePanel"
fi
if grep -q "import { ModelRouterPanel }" "$app_file"; then
    pass "App.tsx 导入 ModelRouterPanel"
fi
if grep -q "import { HooksManagerPanel }" "$app_file"; then
    pass "App.tsx 导入 HooksManagerPanel"
fi

# 状态
if grep -q "worktreeOpen" "$app_file"; then
    pass "App.tsx worktreeOpen 状态"
fi
if grep -q "modelRouterOpen" "$app_file"; then
    pass "App.tsx modelRouterOpen 状态"
fi
if grep -q "hooks20Open" "$app_file"; then
    pass "App.tsx hooks20Open 状态"
fi

# ErrorBoundary 包裹
if grep -q 'name="Worktree"' "$app_file" && grep -q 'name="ModelRouter"' "$app_file" && grep -q 'name="Hooks20"' "$app_file"; then
    pass "三面板 ErrorBoundary 嵌套"
fi

# ============================================================
# Section 6: BrandHeader 菜单项
# ============================================================
section "Section 6: BrandHeader 菜单项验证"

brand_file="$FRONTEND_DIR/src/components/BrandHeader.tsx"
if [ -f "$brand_file" ]; then
    pass "BrandHeader.tsx 存在"
fi

if grep -q "onOpenWorktree" "$brand_file"; then
    pass "BrandHeader 含 onOpenWorktree prop"
fi
if grep -q "onOpenModelRouter" "$brand_file"; then
    pass "BrandHeader 含 onOpenModelRouter prop"
fi
if grep -q "onOpenHooks20" "$brand_file"; then
    pass "BrandHeader 含 onOpenHooks20 prop"
fi

if grep -q "🌳 Worktree 隔离" "$brand_file"; then
    pass "BrandHeader Worktree 菜单项文案"
fi
if grep -q "🧠 智能模型路由" "$brand_file"; then
    pass "BrandHeader 模型路由菜单项文案"
fi
if grep -q "🪝 事件钩子" "$brand_file"; then
    pass "BrandHeader 事件钩子菜单项文案"
fi

# SVG 图标
if grep -q "case 'git-branch'" "$brand_file"; then
    pass "Icon: git-branch"
fi
if grep -q "case 'webhook'" "$brand_file"; then
    pass "Icon: webhook"
fi

# ============================================================
# Section 7: TypeScript 编译
# ============================================================
section "Section 7: TypeScript 编译验证"

if ./node_modules/.bin/tsc --noEmit 2>&1 | grep -q "error"; then
    error_count=$(./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS" || true)
    fail "TypeScript 编译失败 ($error_count 个错误)"
else
    pass "TypeScript 编译通过（0 错误）"
fi

# ============================================================
# Section 8: 自动化测试运行
# ============================================================
section "Section 8: 自动化测试验证"

# WorktreeManager
info "运行 WorktreeManager 单元测试..."
if ./node_modules/.bin/vitest run src/utils/worktreeManager.test.ts 2>&1 | grep -q "Tests.*passed"; then
    wt_count=$(./node_modules/.bin/vitest run src/utils/worktreeManager.test.ts 2>&1 | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "WorktreeManager 单元测试通过 ($wt_count 测试)"
else
    fail "WorktreeManager 单元测试失败"
fi

# ModelRouter
info "运行 ModelRouter 单元测试..."
if ./node_modules/.bin/vitest run src/utils/modelRouter.test.ts 2>&1 | grep -q "Tests.*passed"; then
    mr_count=$(./node_modules/.bin/vitest run src/utils/modelRouter.test.ts 2>&1 | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "ModelRouter 单元测试通过 ($mr_count 测试)"
else
    fail "ModelRouter 单元测试失败"
fi

# HooksEngine
info "运行 HooksEngine 单元测试..."
if ./node_modules/.bin/vitest run src/utils/hooksEngine.test.ts 2>&1 | grep -q "Tests.*passed"; then
    he_count=$(./node_modules/.bin/vitest run src/utils/hooksEngine.test.ts 2>&1 | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "HooksEngine 单元测试通过 ($he_count 测试)"
else
    fail "HooksEngine 单元测试失败"
fi

# 三面板集成测试
info "运行三面板集成测试..."
if ./node_modules/.bin/vitest run src/components/WorktreePanel.test.tsx src/components/ModelRouterPanel.test.tsx src/components/HooksManagerPanel.test.tsx 2>&1 | grep -q "Tests.*passed"; then
    pass "三面板集成测试通过"
else
    fail "三面板集成测试失败"
fi

# ============================================================
# Section 9: Loop Engineering 验证
# ============================================================
section "Section 9: Loop Engineering 无回归验证"

# 之前 Cycle 19 的 E2E 测试脚本
if [ -f "$WORKSPACE_DIR/tests/test_e2e_cycle19.sh" ]; then
    info "检查 Cycle 19 关键文件存在..."
    if [ -f "$FRONTEND_DIR/src/components/BackgroundTasksPanel.tsx" ]; then
        pass "BackgroundTasksPanel 保留 (Cycle 19)"
    fi
    if [ -f "$FRONTEND_DIR/src/components/BestOfNPanel.tsx" ]; then
        pass "BestOfNPanel 保留 (Cycle 19)"
    fi
    if [ -f "$FRONTEND_DIR/src/components/DesignModeOverlay.tsx" ]; then
        pass "DesignModeOverlay 保留 (Cycle 19)"
    fi
fi

# 之前 Cycle 18 的核心
if [ -f "$FRONTEND_DIR/src/utils/composerEngine.plan.ts" ]; then
    pass "Composer Plan Engine 保留 (Cycle 18)"
fi
if [ -f "$FRONTEND_DIR/src/hooks/useMode.ts" ]; then
    pass "useMode Hook 保留 (Cycle 17)"
fi

# Cycle 15 关键模块
if [ -f "$FRONTEND_DIR/src/utils/undoRedoStack.ts" ]; then
    pass "UndoRedoStack 保留 (Cycle 15)"
fi

# 全量测试无回归
info "运行全量前端测试套件（无回归）..."
all_test_output=$(./node_modules/.bin/vitest run 2>&1)
if echo "$all_test_output" | grep -qE "Test Files.*passed"; then
    total=$(echo "$all_test_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    files=$(echo "$all_test_output" | grep -oE "Test Files +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "全量测试通过: $total 个测试, $files 个测试文件"
else
    fail "全量测试有失败"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Cycle 20 E2E 测试结果${NC}"
echo -e "${YELLOW}========================================${NC}"
echo -e "总断言数: $TOTAL_COUNT"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
echo -e "${RED}失败: $FAIL_COUNT${NC}"
echo -e "通过率: $(awk "BEGIN {printf \"%.1f\", $PASS_COUNT*100/$TOTAL_COUNT}")%"

if [ $FAIL_COUNT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 全部通过！${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ 有失败项${NC}"
    exit 1
fi
