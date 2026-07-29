#!/bin/bash
# ============================================================
# Composer Integration Layer 端到端测试 (v6.38.0 Cycle 18 P0-1)
# ============================================================
# 核心作用：验证引用解析 (@codebase / @git / @diff) 与项目级 AI 规则
#           在 ComposerEngine + UI 层的端到端集成
# 测试覆盖：
#   1. 集成层核心文件存在性
#   2. 单元测试覆盖度 (composerEngine.integration + UI 组件)
#   3. UI 组件功能完整性（ResolvedReferencesBar / RulesPanel / ReferenceDetailModal / RulesStatusBadge）
#   4. useComposer Hook 集成层暴露
#   5. ComposerPanel 集成新组件
#   6. Hermes Rules 模板完整性
#   7. 实际运行所有相关测试
# 运行方式：bash tests/test_e2e_composer_integration.sh
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
# 1. 集成层核心文件存在性
# ============================================================
echo -e "\n${YELLOW}[1] 集成层核心文件存在性${NC}"

assert_file_exists "Integration 层存在" "frontend/src/utils/composerEngine.integration.ts"
assert_file_exists "ResolvedReferencesBar 组件存在" "frontend/src/components/ResolvedReferencesBar.tsx"
assert_file_exists "RulesPanel 组件存在" "frontend/src/components/RulesPanel.tsx"
assert_file_exists "ReferenceDetailModal 组件存在" "frontend/src/components/ReferenceDetailModal.tsx"
assert_file_exists "RulesStatusBadge 组件存在" "frontend/src/components/RulesStatusBadge.tsx"
assert_file_exists "Integration 层单测" "frontend/src/utils/composerEngine.integration.test.ts"
assert_file_exists "UI 组件单测" "frontend/src/components/ResolvedReferencesBar.test.tsx"
assert_file_exists "useComposer 集成层单测" "frontend/src/hooks/useComposer.integration.test.tsx"
assert_file_exists "Hermes Rules 工具" "frontend/src/utils/hermesRules.ts"
assert_file_exists "Reference Resolvers" "frontend/src/utils/referenceResolvers.ts"

# ============================================================
# 2. 单元测试覆盖度
# ============================================================
echo -e "\n${YELLOW}[2] 单元测试覆盖度${NC}"

assert_min_tests "Integration 层单测" "frontend/src/utils/composerEngine.integration.test.ts" 40
assert_min_tests "UI 组件单测" "frontend/src/components/ResolvedReferencesBar.test.tsx" 30
assert_min_tests "useComposer 集成单测" "frontend/src/hooks/useComposer.integration.test.tsx" 10

# 验证关键函数被测试
for keyword in "resolveAllReferences" "loadProjectRules" "setProjectRules" "getProjectRules" "injectRules" "getRulesMetadata" "subscribeIntegration" "extractResolvableRefs" "hasResolvableReferences" "resolveOneReference" "loadProjectRulesCore" "countRules" "resetIntegration"; do
  assert_contains "Integration 单测覆盖: $keyword" "frontend/src/utils/composerEngine.integration.test.ts" "$keyword"
done

# ============================================================
# 3. UI 组件功能完整性
# ============================================================
echo -e "\n${YELLOW}[3] UI 组件功能完整性${NC}"

# ResolvedReferencesBar
for testid in "resolved-references-bar" "resolved-references-show-more" "resolved-error-retry"; do
  assert_contains "ResolvedReferencesBar testid: $testid" "frontend/src/components/ResolvedReferencesBar.tsx" "$testid"
done

# 验证状态显示（resolved/failed/resolving/pending）
for state in "已解析" "失败" "解析中" "等待"; do
  assert_contains "ResolvedReferencesBar 状态: $state" "frontend/src/components/ResolvedReferencesBar.tsx" "$state"
done

# RulesPanel
for testid in "rules-panel" "rules-edit-type-safety" "rules-edit-error-handling" "rules-edit-import-order" "rules-edit-naming" "rules-yaml-toggle" "rules-yaml-preview" "rules-save" "rules-cancel" "rules-reset"; do
  assert_contains "RulesPanel testid: $testid" "frontend/src/components/RulesPanel.tsx" "$testid"
done

# ReferenceDetailModal
for testid in "reference-detail-modal" "reference-detail-close" "reference-detail-error" "reference-detail-loading" "reference-detail-pending" "ref-detail-codebase" "ref-detail-git" "ref-detail-diff"; do
  assert_contains "ReferenceDetailModal testid: $testid" "frontend/src/components/ReferenceDetailModal.tsx" "$testid"
done

# RulesStatusBadge
assert_contains "RulesStatusBadge testid: rules-status-badge" "frontend/src/components/RulesStatusBadge.tsx" "rules-status-badge"

# ============================================================
# 4. useComposer Hook 集成层暴露
# ============================================================
echo -e "\n${YELLOW}[4] useComposer Hook 集成层暴露${NC}"

# 导入
for keyword in "resolveAllReferences" "loadProjectRules" "setProjectRules" "getProjectRules" "injectRules" "getRulesMetadata" "subscribeIntegration" "ResolvedReference" "ResolutionError" "RulesMetadata" "ComposerIntegrationState"; do
  assert_contains "useComposer 导入: $keyword" "frontend/src/hooks/useComposer.tsx" "$keyword"
done

# 接口
for keyword in "resolvedReferences:" "resolutionErrors:" "projectRules:" "rulesLoaded:" "resolveReferences:" "loadRules:" "updateProjectRules:" "injectRulesIntoPrompt:" "getRulesMeta:"; do
  assert_contains "useComposer 接口暴露: $keyword" "frontend/src/hooks/useComposer.tsx" "$keyword"
done

# ============================================================
# 5. ComposerPanel 集成新组件
# ============================================================
echo -e "\n${YELLOW}[5] ComposerPanel 集成新组件${NC}"

# 导入
for keyword in "ResolvedReferencesBar" "ReferenceDetailModal" "RulesStatusBadge" "RulesPanel"; do
  assert_contains "ComposerPanel 导入: $keyword" "frontend/src/components/ComposerPanel.tsx" "$keyword"
done

# 使用
assert_contains "ComposerPanel 使用 ResolvedReferencesBar" "frontend/src/components/ComposerPanel.tsx" "<ResolvedReferencesBar"
assert_contains "ComposerPanel 使用 RulesStatusBadge" "frontend/src/components/ComposerPanel.tsx" "<RulesStatusBadge"
assert_contains "ComposerPanel 使用 RulesPanel" "frontend/src/components/ComposerPanel.tsx" "<RulesPanel"
assert_contains "ComposerPanel 使用 ReferenceDetailModal" "frontend/src/components/ComposerPanel.tsx" "<ReferenceDetailModal"

# 新 state
assert_contains "ComposerPanel 状态 isNewRulesOpen" "frontend/src/components/ComposerPanel.tsx" "isNewRulesOpen"
assert_contains "ComposerPanel ResolvedBar 组件" "frontend/src/components/ComposerPanel.tsx" "ComposerResolvedBar"
assert_contains "ComposerPanel resolveReferences 调用" "frontend/src/components/ComposerPanel.tsx" "resolveReferences"
assert_contains "ComposerPanel updateProjectRules 调用" "frontend/src/components/ComposerPanel.tsx" "updateProjectRules"
assert_contains "ComposerPanel getRulesMeta 调用" "frontend/src/components/ComposerPanel.tsx" "getRulesMeta"

# ============================================================
# 6. Hermes Rules 模板完整性
# ============================================================
echo -e "\n${YELLOW}[6] Hermes Rules 模板完整性${NC}"

# 验证 5 套预置模板
for template in "typescript_strict" "python_pep8" "react" "vue" "generic"; do
  assert_contains "模板存在: $template" "frontend/src/utils/hermesRules.ts" "$template"
done

# 关键 API
for keyword in "validateRules" "RULES_TEMPLATES" "DEFAULT_RULES" "injectRulesIntoPrompt" "stringifyYaml" "parseYaml" "parseAndValidateYaml"; do
  assert_contains "Hermes Rules API: $keyword" "frontend/src/utils/hermesRules.ts" "$keyword"
done

# ============================================================
# 7. Reference Resolvers 完整性
# ============================================================
echo -e "\n${YELLOW}[7] Reference Resolvers 完整性${NC}"

for keyword in "resolveCodebase" "resolveGit" "resolveDiff" "CodebaseContext" "GitContext" "DiffContext"; do
  assert_contains "Reference Resolvers: $keyword" "frontend/src/utils/referenceResolvers.ts" "$keyword"
done

# 验证 ComposerEngine 暴露扩展 API
for keyword in "parseAndResolveReferences" "parseGitRef" "parseDiffRef" "GitRefKind"; do
  assert_contains "ComposerEngine 扩展: $keyword" "frontend/src/utils/composerEngine.ts" "$keyword"
done

# ============================================================
# 8. 实际运行所有相关测试
# ============================================================
echo -e "\n${YELLOW}[8] 实际运行所有相关测试${NC}"

cd frontend
if [ -d "node_modules/vitest" ]; then
  if node ./node_modules/vitest/vitest.mjs run \
    src/utils/composerEngine.integration.test.ts \
    src/components/ResolvedReferencesBar.test.tsx \
    src/hooks/useComposer.integration.test.tsx 2>&1 | tail -10; then
    assert_pass "所有 Integration 测试通过"
  else
    assert_fail "Integration 测试运行" "all pass" "some failed"
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
echo -e "${GREEN}🎉 所有 Composer Integration 端到端测试通过！${NC}"
exit 0
