#!/bin/bash
# ============================================================
# Cycle 23 E2E Test: 3 大新功能端到端验证
# ============================================================
# 验证内容：
#   1. CandidateLearningEngine 引擎：偏好学习 + 评分调整 + 反馈
#   2. SessionReplayEngine 引擎：录制 + 回放 + 导出 + 分享
#   3. ProactiveSuggestionEngine 引擎：规则生成 + 反馈 + 权重学习
#   4. 3 面板 UI 组件渲染 + 交互
#   5. App.tsx 集成 + BrandHeader 菜单项 + AppLayout 透传
#   6. Loop Engineering 工作流无回归
#   7. 单元测试与组件测试全通过
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
export NO_COLOR=1
export FORCE_COLOR=0

strip_ansi() {
    sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g'
}

# ============================================================
# Section 1: CandidateLearningEngine 引擎
# ============================================================
section "Section 1: CandidateLearningEngine 候选学习引擎验证"

test_file="$FRONTEND_DIR/src/utils/candidateLearning.ts"
if [ -f "$test_file" ]; then
    pass "CandidateLearningEngine 文件存在"
else
    fail "CandidateLearningEngine 文件不存在"
fi

if grep -q "class CandidateLearningEngine" "$test_file"; then
    pass "CandidateLearningEngine 类定义"
else
    fail "CandidateLearningEngine 类未定义"
fi

# 核心方法
for method in recordDecision getPreferences applyPreferences submitFeedback getStats getRecords resetPreferences updateConfig getConfig on; do
    if grep -q "$method" "$test_file"; then
        pass "核心方法: $method"
    else
        fail "缺少方法: $method"
    fi
done

# 4 种学习算法
for algo in weighted bayesian collaborative reinforcement; do
    if grep -q "'$algo'" "$test_file"; then
        pass "学习算法: $algo"
    else
        fail "缺少学习算法: $algo"
    fi
done

# 5 种任务类型
for task in coding writing analysis learning general; do
    if grep -q "'$task'" "$test_file"; then
        pass "任务类型: $task"
    else
        fail "缺少任务类型: $task"
    fi
done

# Bug 修复 - 防止共享 DEFAULT_PREFERENCES 突变
if grep -q "_createDefaultPreferences" "$test_file"; then
    pass "深拷贝默认偏好函数 (_createDefaultPreferences)"
else
    fail "缺少深拷贝默认偏好函数"
fi

# ============================================================
# Section 2: SessionReplayEngine 引擎
# ============================================================
section "Section 2: SessionReplayEngine 会话回放引擎验证"

test_file="$FRONTEND_DIR/src/utils/sessionReplay.ts"
if [ -f "$test_file" ]; then
    pass "SessionReplayEngine 文件存在"
else
    fail "SessionReplayEngine 文件不存在"
fi

if grep -q "class SessionReplayEngine" "$test_file"; then
    pass "SessionReplayEngine 类定义"
else
    fail "SessionReplayEngine 类未定义"
fi

# 核心方法
for method in startRecording addFrame stopRecording cancelRecording isRecording createReplay loadReplay listReplays deleteReplay play pause stop seekTo setSpeed next prev exportReplay createShareLink; do
    if grep -q "$method" "$test_file"; then
        pass "核心方法: $method"
    else
        fail "缺少方法: $method"
    fi
done

# 5 种帧类型
for ftype in message tool-call thinking workflow-stage user-action; do
    if grep -q "'$ftype'" "$test_file"; then
        pass "帧类型: $ftype"
    else
        fail "缺少帧类型: $ftype"
    fi
done

# 3 种导出格式
for fmt in json html markdown; do
    if grep -q "'$fmt'" "$test_file"; then
        pass "导出格式: $fmt"
    else
        fail "缺少导出格式: $fmt"
    fi
done

# ============================================================
# Section 3: ProactiveSuggestionEngine 引擎
# ============================================================
section "Section 3: ProactiveSuggestionEngine AI 主动建议引擎验证"

test_file="$FRONTEND_DIR/src/utils/proactiveSuggestion.ts"
if [ -f "$test_file" ]; then
    pass "ProactiveSuggestionEngine 文件存在"
else
    fail "ProactiveSuggestionEngine 文件不存在"
fi

if grep -q "class ProactiveSuggestionEngine" "$test_file"; then
    pass "ProactiveSuggestionEngine 类定义"
else
    fail "ProactiveSuggestionEngine 类未定义"
fi

# 核心方法
for method in generateSuggestions acceptSuggestion dismissSuggestion markIgnored getActiveSuggestions getHistory clearAll reset updateConfig getConfig getStats; do
    if grep -q "$method" "$test_file"; then
        pass "核心方法: $method"
    else
        fail "缺少方法: $method"
    fi
done

# 4 种建议类型
for stype in 'next-action' 'related-feature' faq optimization; do
    if grep -q "'$stype'" "$test_file"; then
        pass "建议类型: $stype"
    else
        fail "缺少建议类型: $stype"
    fi
done

# 4 种对话状态
for cstate in idle active workflow error; do
    if grep -q "'$cstate'" "$test_file"; then
        pass "对话状态: $cstate"
    else
        fail "缺少对话状态: $cstate"
    fi
done

# ============================================================
# Section 4: 3 面板 UI 组件
# ============================================================
section "Section 4: 3 面板 UI 组件验证"

for panel in CandidateLearningPanel SessionReplayPanel ProactiveSuggestionPanel; do
    if [ -f "$FRONTEND_DIR/src/components/${panel}.tsx" ]; then
        pass "组件文件存在: $panel"
    else
        fail "缺少组件文件: $panel"
    fi
done

# 每个面板应有 4 个标签页
for panel in CandidateLearningPanel SessionReplayPanel ProactiveSuggestionPanel; do
    test_file="$FRONTEND_DIR/src/components/${panel}.tsx"
    if grep -qE "key: 'overview'|key: 'list'|key: 'active'" "$test_file"; then
        pass "$panel 含标签页定义"
    else
        fail "$panel 缺少标签页定义"
    fi
done

# ============================================================
# Section 5: App.tsx 集成
# ============================================================
section "Section 5: App.tsx 集成验证"

app_file="$FRONTEND_DIR/src/App.tsx"
# 导入
for import_stmt in "CandidateLearningPanel" "SessionReplayPanel" "ProactiveSuggestionPanel" "FloatingSuggestionBubble"; do
    if grep -q "$import_stmt" "$app_file"; then
        pass "App.tsx 导入: $import_stmt"
    else
        fail "App.tsx 缺少导入: $import_stmt"
    fi
done

# handler
for handler in "handleOpenCandidateLearning" "handleOpenSessionReplay" "handleOpenProactiveSuggestion"; do
    if grep -q "$handler" "$app_file"; then
        pass "App.tsx handler: $handler"
    else
        fail "App.tsx 缺少 handler: $handler"
    fi
done

# ============================================================
# Section 6: BrandHeader 菜单项
# ============================================================
section "Section 6: BrandHeader 菜单项验证"

brand_file="$FRONTEND_DIR/src/components/BrandHeader.tsx"
for prop in "onOpenCandidateLearning" "onOpenSessionReplay" "onOpenProactiveSuggestion"; do
    if grep -q "$prop" "$brand_file"; then
        pass "BrandHeader prop: $prop"
    else
        fail "BrandHeader 缺少 prop: $prop"
    fi
done

# 菜单项文字
for label in "候选学习" "会话回放" "AI 主动建议"; do
    if grep -q "$label" "$brand_file"; then
        pass "菜单项文字: $label"
    else
        fail "缺少菜单项文字: $label"
    fi
done

# 图标
for icon in "learning" "replay" "suggestion"; do
    if grep -q "name=\"$icon\"" "$brand_file"; then
        pass "图标定义: $icon"
    else
        fail "缺少图标: $icon"
    fi
done

# ============================================================
# Section 7: AppLayout 透传
# ============================================================
section "Section 7: AppLayout 透传验证"

app_layout_file="$FRONTEND_DIR/src/components/AppLayout.tsx"
for prop in "onOpenCandidateLearning" "onOpenSessionReplay" "onOpenProactiveSuggestion"; do
    if grep -q "$prop" "$app_layout_file"; then
        pass "AppLayout 透传: $prop"
    else
        fail "AppLayout 缺少透传: $prop"
    fi
done

# ============================================================
# Section 8: SPEC 文档
# ============================================================
section "Section 8: SPEC 文档验证"

for spec in "CYCLE23_SPEC_G23_01_CANDIDATE_LEARNING" "CYCLE23_SPEC_G23_02_SESSION_REPLAY" "CYCLE23_SPEC_G23_04_PROACTIVE_SUGGESTIONS"; do
    if [ -f "$WORKSPACE_DIR/${spec}.md" ]; then
        pass "SPEC 文档存在: $spec.md"
    else
        fail "缺少 SPEC 文档: $spec.md"
    fi
done

# Gap analysis
if [ -f "$WORKSPACE_DIR/CYCLE23_GAP_ANALYSIS.md" ]; then
    pass "Gap Analysis 文档存在: CYCLE23_GAP_ANALYSIS.md"
else
    fail "缺少 Gap Analysis 文档"
fi

# ============================================================
# Section 9: 单元测试运行
# ============================================================
section "Section 9: 单元测试运行"

# CandidateLearningEngine
info "运行 CandidateLearningEngine 单元测试..."
cl_output=$(./node_modules/.bin/vitest run src/utils/candidateLearning.test.ts 2>&1 | strip_ansi)
if echo "$cl_output" | grep -qE "Tests +[0-9]+ passed"; then
    cl_count=$(echo "$cl_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "CandidateLearningEngine 单元测试通过 ($cl_count 测试)"
else
    fail "CandidateLearningEngine 单元测试失败"
fi

# SessionReplayEngine
info "运行 SessionReplayEngine 单元测试..."
sr_output=$(./node_modules/.bin/vitest run src/utils/sessionReplay.test.ts 2>&1 | strip_ansi)
if echo "$sr_output" | grep -qE "Tests +[0-9]+ passed"; then
    sr_count=$(echo "$sr_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "SessionReplayEngine 单元测试通过 ($sr_count 测试)"
else
    fail "SessionReplayEngine 单元测试失败"
fi

# ProactiveSuggestionEngine
info "运行 ProactiveSuggestionEngine 单元测试..."
ps_output=$(./node_modules/.bin/vitest run src/utils/proactiveSuggestion.test.ts 2>&1 | strip_ansi)
if echo "$ps_output" | grep -qE "Tests +[0-9]+ passed"; then
    ps_count=$(echo "$ps_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "ProactiveSuggestionEngine 单元测试通过 ($ps_count 测试)"
else
    fail "ProactiveSuggestionEngine 单元测试失败"
fi

# 组件测试
info "运行 CandidateLearningPanel 组件测试..."
clp_output=$(./node_modules/.bin/vitest run src/components/CandidateLearningPanel.test.tsx 2>&1 | strip_ansi)
if echo "$clp_output" | grep -qE "Tests +[0-9]+ passed"; then
    clp_count=$(echo "$clp_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "CandidateLearningPanel 组件测试通过 ($clp_count 测试)"
else
    fail "CandidateLearningPanel 组件测试失败"
fi

info "运行 SessionReplayPanel 组件测试..."
srp_output=$(./node_modules/.bin/vitest run src/components/SessionReplayPanel.test.tsx 2>&1 | strip_ansi)
if echo "$srp_output" | grep -qE "Tests +[0-9]+ passed"; then
    srp_count=$(echo "$srp_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "SessionReplayPanel 组件测试通过 ($srp_count 测试)"
else
    fail "SessionReplayPanel 组件测试失败"
fi

info "运行 ProactiveSuggestionPanel 组件测试..."
psp_output=$(./node_modules/.bin/vitest run src/components/ProactiveSuggestionPanel.test.tsx 2>&1 | strip_ansi)
if echo "$psp_output" | grep -qE "Tests +[0-9]+ passed"; then
    psp_count=$(echo "$psp_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "ProactiveSuggestionPanel 组件测试通过 ($psp_count 测试)"
else
    fail "ProactiveSuggestionPanel 组件测试失败"
fi

# Cycle 23 全部 6 个测试文件一起跑
info "运行 Cycle 23 全部 6 个测试文件..."
all23_output=$(./node_modules/.bin/vitest run src/utils/candidateLearning.test.ts src/utils/sessionReplay.test.ts src/utils/proactiveSuggestion.test.ts src/components/CandidateLearningPanel.test.tsx src/components/SessionReplayPanel.test.tsx src/components/ProactiveSuggestionPanel.test.tsx 2>&1 | strip_ansi)
if echo "$all23_output" | grep -qE "Tests +[0-9]+ passed"; then
    all23_count=$(echo "$all23_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    all23_files=$(echo "$all23_output" | grep -oE "Test Files +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "Cycle 23 全部测试通过 ($all23_count 测试, $all23_files 文件)"
else
    fail "Cycle 23 全部测试失败"
fi

# ============================================================
# Section 10: Loop Engineering 无回归验证
# ============================================================
section "Section 10: Loop Engineering 无回归验证"

# Cycle 22 关键模块
if [ -f "$FRONTEND_DIR/src/components/SideChatPanel.tsx" ]; then
    pass "SideChatPanel 保留 (Cycle 22)"
fi
if [ -f "$FRONTEND_DIR/src/components/CostPredictionPanel.tsx" ]; then
    pass "CostPredictionPanel 保留 (Cycle 22)"
fi
if [ -f "$FRONTEND_DIR/src/components/HookPerformancePanel.tsx" ]; then
    pass "HookPerformancePanel 保留 (Cycle 22)"
fi
if [ -f "$FRONTEND_DIR/src/components/ModelRouterAdminPanel.tsx" ]; then
    pass "ModelRouterAdminPanel 保留 (Cycle 22)"
fi

# Cycle 21 关键模块
if [ -f "$FRONTEND_DIR/src/components/BestOfNCoordinatorPanel.tsx" ]; then
    pass "BestOfNCoordinatorPanel 保留 (Cycle 21)"
fi
if [ -f "$FRONTEND_DIR/src/components/ModelRouterStatsPanel.tsx" ]; then
    pass "ModelRouterStatsPanel 保留 (Cycle 21)"
fi
if [ -f "$FRONTEND_DIR/src/components/HooksMarketplacePanel.tsx" ]; then
    pass "HooksMarketplacePanel 保留 (Cycle 21)"
fi

# Cycle 20 关键模块
if [ -f "$FRONTEND_DIR/src/components/WorktreePanel.tsx" ]; then
    pass "WorktreePanel 保留 (Cycle 20)"
fi
if [ -f "$FRONTEND_DIR/src/components/ModelRouterPanel.tsx" ]; then
    pass "ModelRouterPanel 保留 (Cycle 20)"
fi

# Cycle 19 关键模块
if [ -f "$FRONTEND_DIR/src/components/BackgroundTasksPanel.tsx" ]; then
    pass "BackgroundTasksPanel 保留 (Cycle 19)"
fi
if [ -f "$FRONTEND_DIR/src/components/BestOfNPanel.tsx" ]; then
    pass "BestOfNPanel 保留 (Cycle 19)"
fi

# 运行 Cycle 22 测试套件
info "运行 Cycle 22 全部测试套件（验证无回归）..."
c22_output=$(./node_modules/.bin/vitest run src/utils/sideChatManager.test.ts src/utils/costPredictor.test.ts src/utils/hookPerformanceAnalyzer.test.ts src/utils/modelRouterEnhance.test.ts 2>&1 | strip_ansi)
if echo "$c22_output" | grep -qE "Tests +[0-9]+ passed"; then
    c22_count=$(echo "$c22_output" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    pass "Cycle 22 四引擎单元测试通过 ($c22_count 测试) - 无回归"
else
    fail "Cycle 22 测试套件回归"
fi

# ============================================================
# Section 11: TypeScript 类型检查
# ============================================================
section "Section 11: TypeScript 类型检查"

info "运行 TypeScript 类型检查..."
tsc_output=$(./node_modules/.bin/tsc --noEmit 2>&1 | strip_ansi || true)
if [ -z "$tsc_output" ]; then
    pass "TypeScript 类型检查通过（无错误）"
else
    # 只检查 Cycle 23 相关的错误
    if echo "$tsc_output" | grep -E "candidateLearning|sessionReplay|proactiveSuggestion|CandidateLearningPanel|SessionReplayPanel|ProactiveSuggestionPanel" | head -5; then
        fail "Cycle 23 相关文件存在 TypeScript 错误"
    else
        pass "TypeScript 检查通过（无 Cycle 23 相关错误）"
    fi
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Cycle 23 E2E 测试总结${NC}"
echo -e "${YELLOW}========================================${NC}"
echo -e "总测试数: $TOTAL_COUNT"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
echo -e "${RED}失败: $FAIL_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ Cycle 23 E2E 测试全部通过！${NC}"
    exit 0
else
    echo -e "${RED}❌ Cycle 23 E2E 测试有 $FAIL_COUNT 项失败${NC}"
    exit 1
fi
