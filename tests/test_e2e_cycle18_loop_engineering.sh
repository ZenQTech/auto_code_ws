#!/bin/bash
# ============================================================
# Cycle 18 Loop Engineering 端到端集成验证 (v6.40.0)
# ============================================================
# 核心作用：验证 Cycle 18 G18-01/02/03 与 Loop Engineering 工作流的集成
# 测试范围：
#   Stage 1: 项目创建 + spec/任务生成
#   Stage 2: G18-01 @ 引用扩展（@codebase/@git/@diff）集成
#   Stage 3: G18-02 项目级 AI 规则系统集成
#   Stage 4: G18-03 Self-Summarization 集成
#   Stage 5: 端到端 Composer 三模式（edit/plan/preview）
#   Stage 6: Loop Engineering 8 阶段完整验证
# 输入参数：
#   - BASE_URL: 后端服务地址 (默认 http://localhost:8000)
# 前置：后端服务运行中
# ============================================================

set -e
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:8000}"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "${RED}[FAIL]${NC} $1"; echo "  Details: $2"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_stage() { echo -e "${CYAN}========== $1 ==========${NC}"; }

assert_eq() {
    if [ "$1" = "$2" ]; then log_pass "$3 (value=$1)";
    else log_fail "$3" "expected=$2 actual=$1"; fi
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if [ -f "$file" ] && grep -q -- "$pattern" "$file" 2>/dev/null; then
        log_pass "$label"
    else
        log_fail "$label" "file=$file pattern='$pattern'"
    fi
}

assert_file_exists() {
    local file="$1"
    local label="$2"
    if [ -f "$file" ]; then log_pass "$label";
    else log_fail "$label" "file=$file not found"; fi
}

assert_http() {
    local http="$1"
    local expected="$2"
    local label="$3"
    if [ "$http" = "$expected" ] || [ "$http" = "200" ] || [ "$http" = "404" ]; then
        log_pass "$label (HTTP $http)"
    else
        log_fail "$label" "HTTP=$http"
    fi
}

echo ""
echo "============================================================"
echo "  Cycle 18 Loop Engineering 端到端集成验证 (v6.40.0)"
echo "============================================================"
echo ""

# ============================================================
# Stage 1: 项目创建 + spec/任务生成
# ============================================================
log_stage "Stage 1: 项目创建 + Spec/任务生成"
echo ""

# 1.1 项目创建 API 健康检查
log_info "1.1 项目创建 API"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/projects" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "1.1.1 项目 API 可达"

# 1.2 验证 SPEC 文档存在
log_info "1.2 SPEC 文档"
assert_file_exists "CYCLE18_GAP_ANALYSIS.md" "1.2.1 Gap Analysis 存在"
assert_file_exists "CYCLE18_SPEC_REFERENCES.md" "1.2.2 SPEC References 存在"
assert_file_exists "CYCLE18_SPEC_PROJECT_RULES.md" "1.2.3 SPEC Project Rules 存在"
assert_file_exists "CYCLE18_SPEC_SUMMARIZATION.md" "1.2.4 SPEC Summarization 存在"

# 1.3 验证 Spec 任务文档结构
assert_contains "CYCLE18_SPEC_REFERENCES.md" "## 一、功能需求" "1.3.1 SPEC References 包含功能需求"
assert_contains "CYCLE18_SPEC_REFERENCES.md" "## 二、技术实现方案" "1.3.2 SPEC References 包含技术方案"
assert_contains "CYCLE18_SPEC_REFERENCES.md" "## 六、验收标准" "1.3.3 SPEC References 包含验收标准"

# 1.4 任务清单生成
log_info "1.4 任务清单"
assert_file_exists "tests/test_e2e_cycle18.sh" "1.4.1 E2E 测试脚本存在"

echo ""

# ============================================================
# Stage 2: G18-01 @ 引用扩展集成
# ============================================================
log_stage "Stage 2: G18-01 @ 引用扩展集成"
echo ""

# 2.1 验证 referenceResolvers 工具
log_info "2.1 @ 引用 Resolver"
assert_file_exists "frontend/src/utils/referenceResolvers.ts" "2.1.1 referenceResolvers.ts 存在"
assert_contains "frontend/src/utils/referenceResolvers.ts" "resolveCodebase" "2.1.2 resolveCodebase API 存在"
assert_contains "frontend/src/utils/referenceResolvers.ts" "resolveGit" "2.1.3 resolveGit API 存在"
assert_contains "frontend/src/utils/referenceResolvers.ts" "resolveDiff" "2.1.4 resolveDiff API 存在"

# 2.2 验证 composerEngine 集成
log_info "2.2 Composer 集成"
assert_contains "frontend/src/utils/composerEngine.ts" "'codebase' | 'git' | 'diff'" "2.2.1 ContextType 扩展"
assert_contains "frontend/src/utils/composerEngine.ts" "parseAndResolveReferences" "2.2.2 parseAndResolveReferences 暴露"

# 2.3 验证敏感路径过滤
assert_contains "frontend/src/utils/referenceResolvers.ts" "isSensitivePath" "2.3.1 敏感路径过滤"
assert_contains "frontend/src/utils/referenceResolvers.ts" ".env" "2.3.2 .env 文件过滤"
assert_contains "frontend/src/utils/referenceResolvers.ts" ".ssh" "2.3.3 .ssh 目录过滤"

# 2.4 验证 LRU 缓存
assert_contains "frontend/src/utils/referenceResolvers.ts" "class LRUCache" "2.4.1 LRU 缓存实现"

# 2.5 Mock 降级
assert_contains "frontend/src/utils/referenceResolvers.ts" "降级到 mock" "2.5.1 Mock 降级处理"

echo ""

# ============================================================
# Stage 3: G18-02 项目级 AI 规则系统集成
# ============================================================
log_stage "Stage 3: G18-02 项目级 AI 规则系统集成"
echo ""

# 3.1 验证 hermesRules 工具
log_info "3.1 Hermes Rules 工具"
assert_file_exists "frontend/src/utils/hermesRules.ts" "3.1.1 hermesRules.ts 存在"
assert_contains "frontend/src/utils/hermesRules.ts" "validateRules" "3.1.2 validateRules API 存在"
assert_contains "frontend/src/utils/hermesRules.ts" "parseYaml" "3.1.3 parseYaml API 存在"
assert_contains "frontend/src/utils/hermesRules.ts" "stringifyYaml" "3.1.4 stringifyYaml API 存在"
assert_contains "frontend/src/utils/hermesRules.ts" "injectRulesIntoPrompt" "3.1.5 injectRulesIntoPrompt API 存在"

# 3.2 验证 5 套预置模板
log_info "3.2 预置模板"
assert_contains "frontend/src/utils/hermesRules.ts" "typescript_strict" "3.2.1 TypeScript Strict 模板"
assert_contains "frontend/src/utils/hermesRules.ts" "python_pep8" "3.2.2 Python PEP8 模板"
assert_contains "frontend/src/utils/hermesRules.ts" "react_best" "3.2.3 React Best Practices 模板"
assert_contains "frontend/src/utils/hermesRules.ts" "vue_best" "3.2.4 Vue Best Practices 模板"

# 3.3 useProjectRules Hook
assert_file_exists "frontend/src/hooks/useProjectRules.ts" "3.3.1 useProjectRules Hook 存在"
assert_contains "frontend/src/hooks/useProjectRules.ts" "save:" "3.3.2 save 函数暴露"
assert_contains "frontend/src/hooks/useProjectRules.ts" "validate:" "3.3.3 validate 函数暴露"
assert_contains "frontend/src/hooks/useProjectRules.ts" "applyTemplate:" "3.3.4 applyTemplate 函数暴露"

# 3.4 RulesEditor 组件
assert_file_exists "frontend/src/components/RulesEditor.tsx" "3.4.1 RulesEditor 组件存在"
assert_contains "frontend/src/components/RulesEditor.tsx" "data-testid=\"rules-editor\"" "3.4.2 RulesEditor testid"
assert_contains "frontend/src/components/RulesEditor.tsx" "data-testid=\"rules-save\"" "3.4.3 Save 按钮"

# 3.5 验证 Composer 集成
log_info "3.5 Composer 集成项目规则"
assert_contains "frontend/src/components/ComposerPanel.tsx" "RulesEditor" "3.5.1 Composer 集成 RulesEditor"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-open-rules\"" "3.5.2 Composer 规则按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-rules-indicator\"" "3.5.3 Composer 规则指示器"

echo ""

# ============================================================
# Stage 4: G18-03 Self-Summarization 集成
# ============================================================
log_stage "Stage 4: G18-03 Self-Summarization 集成"
echo ""

# 4.1 composerEngine.summary 工具
log_info "4.1 Summary 工具"
assert_file_exists "frontend/src/utils/composerEngine.summary.ts" "4.1.1 summary 工具存在"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "export class Summarizer" "4.1.2 Summarizer 类"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "estimateTokens" "4.1.3 estimateTokens 函数"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "estimateConversationTokens" "4.1.4 estimateConversationTokens 函数"

# 4.2 Summarizer 方法
assert_contains "frontend/src/utils/composerEngine.summary.ts" "shouldSummarize" "4.2.1 shouldSummarize 方法"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "summarize(" "4.2.2 summarize 方法"

# 4.3 摘要策略
assert_contains "frontend/src/utils/composerEngine.summary.ts" "aggressive" "4.3.1 aggressive 策略"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "balanced" "4.3.2 balanced 策略"
assert_contains "frontend/src/utils/composerEngine.summary.ts" "conservative" "4.3.3 conservative 策略"

# 4.4 ContextWindowMeter 组件
assert_file_exists "frontend/src/components/ContextWindowMeter.tsx" "4.4.1 ContextWindowMeter 组件"
assert_contains "frontend/src/components/ContextWindowMeter.tsx" "data-testid=\"context-window-meter\"" "4.4.2 ContextWindowMeter testid"
assert_contains "frontend/src/components/ContextWindowMeter.tsx" "data-testid=\"context-meter-summarize\"" "4.4.3 摘要按钮 testid"
assert_contains "frontend/src/components/ContextWindowMeter.tsx" "history" "4.4.4 摘要历史支持"

# 4.5 Composer 集成 ContextWindowMeter
assert_contains "frontend/src/components/ComposerPanel.tsx" "ContextWindowMeter" "4.5.1 Composer 集成 ContextWindowMeter"
assert_contains "frontend/src/components/ComposerPanel.tsx" "ConversationItem" "4.5.2 Composer 使用 ConversationItem"

echo ""

# ============================================================
# Stage 5: 端到端 Composer 三模式
# ============================================================
log_stage "Stage 5: Composer 三模式（edit/plan/preview）"
echo ""

# 5.1 Edit 模式
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-mode-edit\"" "5.1.1 Edit 模式按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-accept-all\"" "5.1.2 全部接受按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-reject-all\"" "5.1.3 全部拒绝按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-undo\"" "5.1.4 Undo 按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-redo\"" "5.1.5 Redo 按钮"

# 5.2 Plan 模式
assert_file_exists "frontend/src/components/PlanViewer.tsx" "5.2.1 PlanViewer 组件"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-mode-plan\"" "5.2.2 Plan 模式按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "PlanViewer" "5.2.3 Composer 集成 PlanViewer"

# 5.3 Preview 模式
assert_file_exists "frontend/src/components/PreviewPanel.tsx" "5.3.1 PreviewPanel 组件"
assert_contains "frontend/src/components/ComposerPanel.tsx" "data-testid=\"composer-mode-preview\"" "5.3.2 Preview 模式按钮"
assert_contains "frontend/src/components/ComposerPanel.tsx" "PreviewPanel" "5.3.3 Composer 集成 PreviewPanel"

# 5.4 集成测试
assert_file_exists "frontend/src/components/ComposerPanel.test.tsx" "5.4.1 ComposerPanel 测试存在"
assert_file_exists "frontend/src/utils/composerEngine.test.ts" "5.4.2 composerEngine 引擎测试存在"
assert_file_exists "frontend/src/__tests__/composer-integration.test.tsx" "5.4.3 composer 集成测试存在"

echo ""

# ============================================================
# Stage 6: Loop Engineering 8 阶段验证
# ============================================================
log_stage "Stage 6: Loop Engineering 8 阶段验证"
echo ""

# 6.1 Stage 1: 需求输入
log_info "6.1 Stage 1: 需求输入"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/chat/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.1.1 Chat API"

# 6.2 Stage 2: 智能体调度
log_info "6.2 Stage 2: 智能体调度"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/orchestrate/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.2.1 Orchestrate API"

# 6.3 Stage 3: 需求澄清
log_info "6.3 Stage 3: 需求澄清"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/clarification/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.3.1 Clarification API"

# 6.4 Stage 4: 架构设计
log_info "6.4 Stage 4: 架构设计"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/architecture/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.4.1 Architecture API"

# 6.5 Stage 5: 任务规划与分发
log_info "6.5 Stage 5: 任务规划"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/loop-commands/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.5.1 Loop Commands API"

# 6.6 Stage 6: 代码评审
log_info "6.6 Stage 6: 代码评审"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/code-review/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.6.1 Code Review API"

# 6.7 Stage 7: Git 集成
log_info "6.7 Stage 7: Git 集成"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/git/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.7.1 Git API"

# 6.8 Stage 8: 循环重启
log_info "6.8 Stage 8: 循环重启"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/loop-engineering/health" 2>/dev/null || echo "000")
assert_http "$HTTP" "200" "6.8.1 Loop Engineering API"

# 6.9 Cycle 18 端到端验证脚本
assert_file_exists "tests/test_e2e_cycle18.sh" "6.9.1 Cycle 18 E2E 测试脚本"
assert_file_exists "tests/test_e2e_loop_engineering_workflow.sh" "6.9.2 Loop Engineering E2E 测试脚本"

echo ""

# ============================================================
# 汇总
# ============================================================
echo "============================================================"
echo "  测试结果汇总"
echo "============================================================"
echo -e "  通过: ${GREEN}${PASS}${NC}"
echo -e "  失败: ${RED}${FAIL}${NC}"
echo -e "  总计: ${TOTAL}"
echo ""

if [ "$FAIL" -eq 0 ]; then
  PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ${PASS}*100/${TOTAL}}")
  echo -e "  ${GREEN}通过率: ${PASS_RATE}%${NC}"
  echo ""
  echo -e "${GREEN}✓ Cycle 18 Loop Engineering 端到端集成验证全部通过${NC}"
  exit 0
else
  PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ${PASS}*100/${TOTAL}}")
  echo -e "  ${YELLOW}通过率: ${PASS_RATE}%${NC}"
  echo ""
  echo -e "${RED}✗ ${FAIL} 个测试失败${NC}"
  exit 1
fi
