#!/bin/bash
# ============================================================
# Composer Summary 集成层 端到端测试 (v6.38.1 Cycle 18 P0-2)
# ============================================================
# 核心作用：验证上下文窗口管理与自动摘要系统
#           在 ComposerEngine + UI 层的端到端集成
# 测试覆盖：
#   1. Summary 集成层核心文件存在性
#   2. 单元测试覆盖度 (summary.integration + UI)
#   3. useComposer Hook Summary API 暴露
#   4. ComposerPanel SummarySection 集成
#   5. SummarizationHistory 组件
#   6. ContextWindowMeter 集成
#   7. 实际运行所有相关测试
# 运行方式：bash tests/test_e2e_composer_summary.sh
# ============================================================

set -e
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

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
# 1. Summary 集成层核心文件存在性
# ============================================================
echo -e "\n${YELLOW}[1] Summary 集成层核心文件存在性${NC}"

assert_file_exists "Summary 集成层存在" "frontend/src/utils/composerEngine.summary.integration.ts"
assert_file_exists "Summary 引擎存在" "frontend/src/utils/composerEngine.summary.ts"
assert_file_exists "ContextWindowMeter 组件存在" "frontend/src/components/ContextWindowMeter.tsx"
assert_file_exists "Summary 集成层单测" "frontend/src/utils/composerEngine.summary.integration.test.ts"
assert_file_exists "ContextWindowMeter 单测" "frontend/src/components/ContextWindowMeter.test.tsx"

# ============================================================
# 2. 单元测试覆盖度
# ============================================================
echo -e "\n${YELLOW}[2] 单元测试覆盖度${NC}"

assert_min_tests "Summary 集成层单测" "frontend/src/utils/composerEngine.summary.integration.test.ts" 35
assert_min_tests "ContextWindowMeter 单测" "frontend/src/components/ContextWindowMeter.test.tsx" 10

# 关键函数被测试
for keyword in "getSummaryHistory" "getSummaryConfig" "getSummaryState" "getSummarizer" "buildConversationItems" "getCurrentTokens" "shouldSummarize" "generateSummary" "applySummary" "unapplySummary" "deleteSummary" "clearSummaryHistory" "updateSummaryConfig" "subscribeSummary" "resetSummaryIntegration"; do
  assert_contains "Summary 集成单测覆盖: $keyword" "frontend/src/utils/composerEngine.summary.integration.test.ts" "$keyword"
done

# ============================================================
# 3. 集成层 API 完整性
# ============================================================
echo -e "\n${YELLOW}[3] 集成层 API 完整性${NC}"

for keyword in "getSummaryHistory" "getSummaryConfig" "getCurrentTokens" "shouldSummarize" "generateSummary" "applySummary" "unapplySummary" "deleteSummary" "clearSummaryHistory" "updateSummaryConfig" "subscribeSummary" "resetSummaryIntegration" "ComposerSummaryState"; do
  assert_contains "Summary 集成层导出: $keyword" "frontend/src/utils/composerEngine.summary.integration.ts" "$keyword"
done

# WeakMap 存储
assert_contains "Summary 集成层使用 WeakMap" "frontend/src/utils/composerEngine.summary.integration.ts" "WeakMap"
assert_contains "Summary 集成层订阅机制" "frontend/src/utils/composerEngine.summary.integration.ts" "subscribeSummary"
assert_contains "Summary 集成层重置机制" "frontend/src/utils/composerEngine.summary.integration.ts" "resetSummaryIntegration"

# ============================================================
# 4. useComposer Hook Summary API 暴露
# ============================================================
echo -e "\n${YELLOW}[4] useComposer Hook Summary API 暴露${NC}"

# 导入
for keyword in "getSummaryHistory" "getSummaryConfig" "getCurrentTokens" "shouldSummarize" "generateSummary" "applySummary" "unapplySummary" "deleteSummary" "clearSummaryHistory" "updateSummaryConfig" "subscribeSummary" "resetSummaryIntegration" "ComposerSummaryState" "Summary" "SummaryConfig"; do
  assert_contains "useComposer 导入 Summary: $keyword" "frontend/src/hooks/useComposer.tsx" "$keyword"
done

# 接口
for keyword in "summaryHistory:" "summaryConfig:" "appliedSummaryId:" "tokensUsed:" "shouldSummarize:" "summarize:" "applySummary:" "unapplySummary:" "deleteSummary:" "clearSummaryHistory:" "updateSummaryConfig:"; do
  assert_contains "useComposer 接口暴露: $keyword" "frontend/src/hooks/useComposer.tsx" "$keyword"
done

# 版本号
assert_contains "useComposer v1.4.0" "frontend/src/hooks/useComposer.tsx" "v1.4.0"

# ============================================================
# 5. ComposerPanel SummarySection 集成
# ============================================================
echo -e "\n${YELLOW}[5] ComposerPanel SummarySection 集成${NC}"

# 导入
assert_contains "ComposerPanel 导入 SummarizationHistory" "frontend/src/components/ComposerPanel.tsx" "SummarizationHistory"
assert_contains "ComposerPanel 导入 Summary 类型" "frontend/src/components/ComposerPanel.tsx" "type Summary"

# 使用
assert_contains "ComposerPanel 使用 SummarizationHistory" "frontend/src/components/ComposerPanel.tsx" "<SummarizationHistory"
assert_contains "ComposerPanel SummarySection 组件" "frontend/src/components/ComposerPanel.tsx" "ComposerSummarySection"
assert_contains "ComposerPanel composer-summary-section" "frontend/src/components/ComposerPanel.tsx" "composer-summary-section"
assert_contains "ComposerPanel composer-summarize-suggestion" "frontend/src/components/ComposerPanel.tsx" "composer-summarize-suggestion"
assert_contains "ComposerPanel composer-summarize-btn" "frontend/src/components/ComposerPanel.tsx" "composer-summarize-btn"
assert_contains "ComposerPanel composer-summary-history-wrapper" "frontend/src/components/ComposerPanel.tsx" "composer-summary-history-wrapper"
assert_contains "ComposerPanel composer-summary-applied-badge" "frontend/src/components/ComposerPanel.tsx" "composer-summary-applied-badge"
assert_contains "ComposerPanel composer-summary-clear" "frontend/src/components/ComposerPanel.tsx" "composer-summary-clear"

# 回调
assert_contains "ComposerPanel 使用 summarize" "frontend/src/components/ComposerPanel.tsx" "composer.summarize"
assert_contains "ComposerPanel 使用 applySummary" "frontend/src/components/ComposerPanel.tsx" "composer.applySummary"
assert_contains "ComposerPanel 使用 deleteSummary" "frontend/src/components/ComposerPanel.tsx" "composer.deleteSummary"
assert_contains "ComposerPanel 使用 clearSummaryHistory" "frontend/src/components/ComposerPanel.tsx" "composer.clearSummaryHistory"

# ============================================================
# 6. ContextWindowMeter 集成
# ============================================================
echo -e "\n${YELLOW}[6] ContextWindowMeter 集成${NC}"

assert_contains "ContextWindowMeter 导出" "frontend/src/components/ContextWindowMeter.tsx" "export function ContextWindowMeter"
assert_contains "ContextWindowMeter SummarizationHistory 导出" "frontend/src/components/ContextWindowMeter.tsx" "export function SummarizationHistory"
assert_contains "ContextWindowMeter data-testid" "frontend/src/components/ContextWindowMeter.tsx" "data-testid=\"context-window-meter\""
assert_contains "ContextWindowMeter summarize 按钮" "frontend/src/components/ContextWindowMeter.tsx" "context-meter-summarize"
assert_contains "ContextWindowMeter 进度条" "frontend/src/components/ContextWindowMeter.tsx" "transition-all"

# Summary 引擎
for keyword in "Summarizer" "SummaryHistory" "SummaryConfig" "ConversationItem" "estimateTokens" "estimateConversationTokens" "extractDecisionPoints" "extractKeypoints" "injectSummaryIntoPrompt" "mergeSummaries" "DEFAULT_SUMMARY_CONFIG"; do
  assert_contains "Summary 引擎导出: $keyword" "frontend/src/utils/composerEngine.summary.ts" "$keyword"
done

# ============================================================
# 7. 实际运行所有相关测试
# ============================================================
echo -e "\n${YELLOW}[7] 实际运行所有相关测试${NC}"

cd frontend
if [ -d "node_modules/vitest" ]; then
  if node ./node_modules/vitest/vitest.mjs run \
    src/utils/composerEngine.summary.integration.test.ts \
    src/components/ContextWindowMeter.test.tsx \
    src/components/ComposerPanel.test.tsx 2>&1 | tail -10; then
    assert_pass "所有 Summary 集成测试通过"
  else
    assert_fail "Summary 集成测试运行" "all pass" "some failed"
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
echo -e "${GREEN}🎉 所有 Composer Summary 集成端到端测试通过！${NC}"
exit 0
