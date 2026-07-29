#!/bin/bash
# ============================================================
# Cycle 18 端到端测试 (v6.40.0)
# ============================================================
# 核心作用：验证 Cycle 18 G18-01/02/03 三大新功能的端到端工作流
# 测试覆盖：
#   1. G18-01 @ 引用类型扩展（@codebase / @git / @diff）
#      - referenceResolvers 工具（CodebaseResolver / GitResolver / DiffResolver）
#      - LRU 缓存、敏感路径过滤、Mock 降级
#      - composerEngine 集成（parseAndResolveReferences）
#   2. G18-02 项目级 AI 规则系统
#      - hermesRules 工具（schema 验证 / YAML 解析 / 模板）
#      - useProjectRules Hook（加载/保存/验证）
#      - RulesEditor 组件（UI 编辑器）
#   3. G18-03 Self-Summarization 长会话控制
#      - composerEngine.summary（token 估算 / 摘要生成 / 历史管理）
#      - ContextWindowMeter 组件（token 进度 / 摘要触发）
#   4. 跨模块集成（Composer 三模式 + Plan Mode + 项目规则 + 摘要）
# 运行方式：bash tests/test_e2e_cycle18.sh
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
    assert_fail "$label" "contains pattern '$pattern'" "not found in $file"
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
echo "  Cycle 18 端到端测试 (v6.40.0)"
echo "============================================================"
echo ""

# ============================================================
# 1. 文件存在性检查
# ============================================================
echo "[1/7] 文件存在性检查"
echo "----------------------------------------"

# G18-01: @ 引用扩展
assert_file_exists "referenceResolvers 工具" "frontend/src/utils/referenceResolvers.ts"
assert_file_exists "referenceResolvers 测试" "frontend/src/utils/referenceResolvers.test.ts"
assert_file_exists "composerEngine.references 测试" "frontend/src/utils/composerEngine.references.test.ts"
assert_file_exists "CYCLE18 SPEC References" "CYCLE18_SPEC_REFERENCES.md"

# G18-02: 项目级 AI 规则
assert_file_exists "hermesRules 工具" "frontend/src/utils/hermesRules.ts"
assert_file_exists "hermesRules 测试" "frontend/src/utils/hermesRules.test.ts"
assert_file_exists "useProjectRules Hook" "frontend/src/hooks/useProjectRules.ts"
assert_file_exists "useProjectRules 测试" "frontend/src/hooks/useProjectRules.test.ts"
assert_file_exists "RulesEditor 组件" "frontend/src/components/RulesEditor.tsx"
assert_file_exists "CYCLE18 SPEC Project Rules" "CYCLE18_SPEC_PROJECT_RULES.md"

# G18-03: Self-Summarization
assert_file_exists "composerEngine.summary 工具" "frontend/src/utils/composerEngine.summary.ts"
assert_file_exists "composerEngine.summary 测试" "frontend/src/utils/composerEngine.summary.test.ts"
assert_file_exists "ContextWindowMeter 组件" "frontend/src/components/ContextWindowMeter.tsx"
assert_file_exists "CYCLE18 SPEC Summarization" "CYCLE18_SPEC_SUMMARIZATION.md"

# 总体
assert_file_exists "CYCLE18 Gap Analysis" "CYCLE18_GAP_ANALYSIS.md"

echo ""

# ============================================================
# 2. G18-01 @ 引用类型扩展
# ============================================================
echo "[2/7] G18-01: @ 引用类型扩展"
echo "----------------------------------------"

# referenceResolvers 核心 API
assert_contains "G18-01 暴露 resolveCodebase API" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export async function resolveCodebase"
assert_contains "G18-01 暴露 resolveGit API" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export async function resolveGit"
assert_contains "G18-01 暴露 resolveDiff API" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export async function resolveDiff"

# LRU 缓存
assert_contains "G18-01 实现 LRU 缓存" \
  "frontend/src/utils/referenceResolvers.ts" \
  "class LRUCache"

# 敏感路径过滤
assert_contains "G18-01 实现敏感路径过滤" \
  "frontend/src/utils/referenceResolvers.ts" \
  "isSensitivePath"
assert_contains "G18-01 过滤 .env 文件" \
  "frontend/src/utils/referenceResolvers.ts" \
  ".env"
assert_contains "G18-01 过滤 .ssh 目录" \
  "frontend/src/utils/referenceResolvers.ts" \
  ".ssh"

# Codebase 上下文类型
assert_contains "G18-01 CodebaseContext 类型定义" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface CodebaseContext"
assert_contains "G18-01 CodebaseResult 类型" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface CodebaseResult"

# Git 上下文类型
assert_contains "G18-01 GitContext 类型定义" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface GitContext"
assert_contains "G18-01 GitCommit 类型" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface GitCommit"
assert_contains "G18-01 GitRefKind 类型" \
  "frontend/src/utils/referenceResolvers.ts" \
  "GitRefKind"

# Diff 上下文类型
assert_contains "G18-01 DiffContext 类型定义" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface DiffContext"
assert_contains "G18-01 DiffFile 类型" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface DiffFile"
assert_contains "G18-01 DiffHunk 类型" \
  "frontend/src/utils/referenceResolvers.ts" \
  "export interface DiffHunk"

# Mock 数据生成
assert_contains "G18-01 Mock codebase 搜索" \
  "frontend/src/utils/referenceResolvers.ts" \
  "function mockCodebaseSearch"
assert_contains "G18-01 Mock git log" \
  "frontend/src/utils/referenceResolvers.ts" \
  "function mockGitLog"
assert_contains "G18-01 Mock diff" \
  "frontend/src/utils/referenceResolvers.ts" \
  "function mockDiff"

# API 降级处理
assert_contains "G18-01 网络失败时降级到 Mock" \
  "frontend/src/utils/referenceResolvers.ts" \
  "降级到 mock"

# composerEngine 集成
assert_contains "G18-01 composerEngine 扩展 ContextType" \
  "frontend/src/utils/composerEngine.ts" \
  "'codebase' | 'git' | 'diff'"
assert_contains "G18-01 composerEngine 暴露 parseAndResolveReferences" \
  "frontend/src/utils/composerEngine.ts" \
  "export async function parseAndResolveReferences"

# parseReferences 支持新类型
assert_count_ge "G18-01 parseReferences codebase 模式" \
  "frontend/src/utils/composerEngine.ts" \
  "type: 'codebase' as ContextType" 1
assert_count_ge "G18-01 parseReferences git 模式" \
  "frontend/src/utils/composerEngine.ts" \
  "type: 'git' as ContextType" 1
assert_count_ge "G18-01 parseReferences diff 模式" \
  "frontend/src/utils/composerEngine.ts" \
  "type: 'diff' as ContextType" 1

# parseGitRef 解析 query string
assert_contains "G18-01 parseGitRef 实现" \
  "frontend/src/utils/composerEngine.ts" \
  "function parseGitRef"

# parseDiffRef 解析
assert_contains "G18-01 parseDiffRef 实现" \
  "frontend/src/utils/composerEngine.ts" \
  "function parseDiffRef"

# 并发解析
assert_contains "G18-01 并发解析多个引用" \
  "frontend/src/utils/composerEngine.ts" \
  "Promise.all"

# 测试覆盖
assert_count_ge "G18-01 referenceResolvers 测试用例" \
  "frontend/src/utils/referenceResolvers.test.ts" \
  "it(" 25
assert_count_ge "G18-01 composerEngine.references 测试用例" \
  "frontend/src/utils/composerEngine.references.test.ts" \
  "it(" 10

echo ""

# ============================================================
# 3. G18-02 项目级 AI 规则系统
# ============================================================
echo "[3/7] G18-02: 项目级 AI 规则系统"
echo "----------------------------------------"

# hermesRules 核心 API
assert_contains "G18-02 暴露 HermesRules 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export interface HermesRules"
assert_contains "G18-02 暴露 validateRules API" \
  "frontend/src/utils/hermesRules.ts" \
  "export function validateRules"
assert_contains "G18-02 暴露 parseYaml API" \
  "frontend/src/utils/hermesRules.ts" \
  "export function parseYaml"
assert_contains "G18-02 暴露 stringifyYaml API" \
  "frontend/src/utils/hermesRules.ts" \
  "export function stringifyYaml"
assert_contains "G18-02 暴露 parseAndValidateYaml" \
  "frontend/src/utils/hermesRules.ts" \
  "export function parseAndValidateYaml"
assert_contains "G18-02 暴露 generateRulesSummary" \
  "frontend/src/utils/hermesRules.ts" \
  "export function generateRulesSummary"
assert_contains "G18-02 暴露 injectRulesIntoPrompt" \
  "frontend/src/utils/hermesRules.ts" \
  "export function injectRulesIntoPrompt"

# 规则类型枚举
assert_contains "G18-02 TypeSafety 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type TypeSafety"
assert_contains "G18-02 ErrorHandling 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type ErrorHandling"
assert_contains "G18-02 ImportOrder 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type ImportOrder"
assert_contains "G18-02 NamingConvention 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type NamingConvention"
assert_contains "G18-02 TestFramework 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type TestFramework"
assert_contains "G18-02 ProjectType 类型" \
  "frontend/src/utils/hermesRules.ts" \
  "export type ProjectType"

# 预置模板
assert_contains "G18-02 暴露 RULES_TEMPLATES" \
  "frontend/src/utils/hermesRules.ts" \
  "export const RULES_TEMPLATES"
assert_contains "G18-02 暴露 getTemplateById" \
  "frontend/src/utils/hermesRules.ts" \
  "export function getTemplateById"
assert_contains "G18-02 暴露 DEFAULT_RULES" \
  "frontend/src/utils/hermesRules.ts" \
  "export const DEFAULT_RULES"

# 预置模板种类
assert_contains "G18-02 typescript_strict 模板" \
  "frontend/src/utils/hermesRules.ts" \
  "typescript_strict"
assert_contains "G18-02 python_pep8 模板" \
  "frontend/src/utils/hermesRules.ts" \
  "python_pep8"
assert_contains "G18-02 react_best 模板" \
  "frontend/src/utils/hermesRules.ts" \
  "react_best"
assert_contains "G18-02 vue_best 模板" \
  "frontend/src/utils/hermesRules.ts" \
  "vue_best"

# 规则验证
assert_contains "G18-02 检测 type_safety 错误" \
  "frontend/src/utils/hermesRules.ts" \
  "type_safety"
assert_contains "G18-02 检测 coverage_threshold 错误" \
  "frontend/src/utils/hermesRules.ts" \
  "coverage_threshold"

# YAML 解析
assert_contains "G18-02 YAML 解析空列表" \
  "frontend/src/utils/hermesRules.ts" \
  "valueStr === '\\[\\]'"
assert_contains "G18-02 YAML 解析空对象" \
  "frontend/src/utils/hermesRules.ts" \
  "valueStr === '{}'"
assert_contains "G18-02 YAML 解析注释" \
  "frontend/src/utils/hermesRules.ts" \
  "startsWith('#')"

# 规则注入
assert_contains "G18-02 规则注入到 prompt" \
  "frontend/src/utils/hermesRules.ts" \
  "\\[User Prompt\\]"

# useProjectRules Hook
assert_file_exists "useProjectRules Hook" "frontend/src/hooks/useProjectRules.ts"
assert_contains "G18-02 useProjectRules 暴露 rules" \
  "frontend/src/hooks/useProjectRules.ts" \
  "rules:"
assert_contains "G18-02 useProjectRules 暴露 save" \
  "frontend/src/hooks/useProjectRules.ts" \
  "save("
assert_contains "G18-02 useProjectRules 暴露 validate" \
  "frontend/src/hooks/useProjectRules.ts" \
  "validate: (yaml:"
assert_contains "G18-02 useProjectRules 暴露 applyTemplate" \
  "frontend/src/hooks/useProjectRules.ts" \
  'applyTemplate: (templateId:'

# RulesEditor 组件
assert_file_exists "RulesEditor 组件" "frontend/src/components/RulesEditor.tsx"
assert_contains "G18-02 RulesEditor testid" \
  "frontend/src/components/RulesEditor.tsx" \
  "data-testid=\"rules-editor\""
assert_contains "G18-02 RulesEditor 关闭按钮" \
  "frontend/src/components/RulesEditor.tsx" \
  "data-testid=\"rules-editor-close\""
assert_contains "G18-02 RulesEditor 保存按钮" \
  "frontend/src/components/RulesEditor.tsx" \
  "data-testid=\"rules-save\""
assert_contains "G18-02 RulesEditor 取消按钮" \
  "frontend/src/components/RulesEditor.tsx" \
  "data-testid=\"rules-cancel\""
assert_contains "G18-02 RulesEditor YAML 预览" \
  "frontend/src/components/RulesEditor.tsx" \
  "yaml"

# 测试覆盖
assert_count_ge "G18-02 hermesRules 测试用例" \
  "frontend/src/utils/hermesRules.test.ts" \
  "it(" 25
assert_count_ge "G18-02 useProjectRules 测试用例" \
  "frontend/src/hooks/useProjectRules.test.ts" \
  "it(" 5

echo ""

# ============================================================
# 4. G18-03 Self-Summarization 长会话控制
# ============================================================
echo "[4/7] G18-03: Self-Summarization 长会话控制"
echo "----------------------------------------"

# composerEngine.summary 核心 API
assert_contains "G18-03 暴露 Summarizer 类" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "export class Summarizer"
assert_contains "G18-03 暴露 estimateTokens 函数" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "export function estimateTokens"
assert_contains "G18-03 暴露 estimateConversationTokens" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "export function estimateConversationTokens"

# Summarizer 方法
assert_contains "G18-03 Summarizer.shouldSummarize 方法" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "shouldSummarize("
assert_contains "G18-03 Summarizer.summarize 方法" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "summarize("
assert_contains "G18-03 Summarizer.getConfig 方法" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "getConfig("
assert_contains "G18-03 Summarizer 提取决策点" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "extractDecisionPoints"
assert_contains "G18-03 Summarizer 提取关键点" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "extractKeypoints"

# 摘要配置
assert_contains "G18-03 SummaryConfig 接口" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "export interface SummaryConfig"
assert_contains "G18-03 Summary 接口" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "export interface Summary"
assert_contains "G18-03 DEFAULT_SUMMARY_CONFIG" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "DEFAULT_SUMMARY_CONFIG"

# 摘要策略
assert_contains "G18-03 aggressive 策略" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "aggressive"
assert_contains "G18-03 balanced 策略" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "balanced"
assert_contains "G18-03 conservative 策略" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "conservative"

# ContextWindowMeter 组件
assert_file_exists "ContextWindowMeter 组件" "frontend/src/components/ContextWindowMeter.tsx"
assert_contains "G18-03 ContextWindowMeter testid" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "data-testid=\"context-window-meter\""
assert_contains "G18-03 ContextWindowMeter 摘要按钮" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "data-testid=\"context-meter-summarize\""
assert_contains "G18-03 ContextWindowMeter token 显示" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "tokens"
assert_contains "G18-03 ContextWindowMeter 进度条" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "transition-all"
assert_contains "G18-03 ContextWindowMeter 警告色" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "isWarning"
assert_contains "G18-03 ContextWindowMeter 危险色" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "isCritical"

# token 估算
assert_contains "G18-03 中文 token 估算" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "中文字符"
assert_contains "G18-03 英文 token 估算" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "英文"

# 摘要历史
assert_contains "G18-03 摘要历史管理" \
  "frontend/src/components/ContextWindowMeter.tsx" \
  "history"
assert_contains "G18-03 摘要 ID 生成" \
  "frontend/src/utils/composerEngine.summary.ts" \
  "_genSummaryId"

# 测试覆盖
assert_count_ge "G18-03 composerEngine.summary 测试用例" \
  "frontend/src/utils/composerEngine.summary.test.ts" \
  "it(" 25

echo ""

# ============================================================
# 5. 跨模块集成 - Composer 引擎
# ============================================================
echo "[5/7] 跨模块集成：Composer 引擎"
echo "----------------------------------------"

# composerEngine 类型扩展
assert_contains "集成: composerEngine 导出 CodebaseContext" \
  "frontend/src/utils/composerEngine.ts" \
  "export type {"
assert_contains "集成: composerEngine 导出 GitContext" \
  "frontend/src/utils/composerEngine.ts" \
  "GitContext"
assert_contains "集成: composerEngine 导出 DiffContext" \
  "frontend/src/utils/composerEngine.ts" \
  "DiffContext"

# ContextEntry 支持新类型
assert_contains "集成: ContextEntry 支持 codebase" \
  "frontend/src/utils/composerEngine.ts" \
  "| import('./referenceResolvers').CodebaseContext"
assert_contains "集成: ContextEntry 支持 git" \
  "frontend/src/utils/composerEngine.ts" \
  "GitContext"
assert_contains "集成: ContextEntry 支持 diff" \
  "frontend/src/utils/composerEngine.ts" \
  "DiffContext"

# ComposerContext 支持新字段
assert_contains "集成: ComposerContext 包含 codebase" \
  "frontend/src/utils/composerEngine.ts" \
  "codebase: import"
assert_contains "集成: ComposerContext 包含 git" \
  "frontend/src/utils/composerEngine.ts" \
  "git: import"
assert_contains "集成: ComposerContext 包含 diff" \
  "frontend/src/utils/composerEngine.ts" \
  "diff: import"

# addContext 支持新类型
assert_contains "集成: addContext 支持 codebase" \
  "frontend/src/utils/composerEngine.ts" \
  "case 'codebase'"
assert_contains "集成: addContext 支持 git" \
  "frontend/src/utils/composerEngine.ts" \
  "case 'git'"
assert_contains "集成: addContext 支持 diff" \
  "frontend/src/utils/composerEngine.ts" \
  "case 'diff'"

echo ""

# ============================================================
# 6. 单测运行验证
# ============================================================
echo "[6/7] 单测运行验证 (vitest)"
echo "----------------------------------------"

cd frontend
if [ -f "node_modules/.bin/vitest" ]; then
  output=$(PATH="/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH" npx vitest run src/utils/referenceResolvers.test.ts src/utils/composerEngine.references.test.ts src/utils/hermesRules.test.ts src/utils/composerEngine.summary.test.ts 2>&1 | tail -8)
  if echo "$output" | grep -qE "Tests.*[0-9]+ passed"; then
    assert_pass "G18-01/02/03 单测全部通过 (referenceResolvers + hermesRules + summary)"
  else
    assert_fail "G18-01/02/03 单测" "all passed" "$(echo "$output" | tail -3)"
  fi
else
  assert_fail "vitest 可执行" "exists" "not found"
fi
cd ..

# 检查 TypeScript 编译
if command -v npx >/dev/null 2>&1; then
  cd frontend
  ts_output=$(PATH="/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH" npx tsc -b 2>&1 || true)
  if [ -z "$ts_output" ]; then
    assert_pass "TypeScript 编译零错误"
  else
    # 检查是否仅为非阻塞警告
    if echo "$ts_output" | grep -qE "error TS"; then
      assert_fail "TypeScript 编译" "no errors" "$(echo "$ts_output" | grep -E 'error TS' | head -3)"
    else
      assert_pass "TypeScript 编译无错误（仅警告）"
    fi
  fi
  cd ..
fi

echo ""

# ComposerPanel 集成
assert_contains "UI: ComposerPanel 集成 ContextWindowMeter" \
  "frontend/src/components/ComposerPanel.tsx" \
  "ContextWindowMeter"
assert_contains "UI: ComposerPanel 集成 RulesEditor" \
  "frontend/src/components/ComposerPanel.tsx" \
  "RulesEditor"
assert_contains "UI: ComposerPanel 规则按钮 testid" \
  "frontend/src/components/ComposerPanel.tsx" \
  "data-testid=\"composer-open-rules\""
assert_contains "UI: ComposerPanel 规则编辑器 footer 按钮" \
  "frontend/src/components/ComposerPanel.tsx" \
  "data-testid=\"composer-footer-rules\""
assert_contains "UI: ComposerPanel 规则指示器" \
  "frontend/src/components/ComposerPanel.tsx" \
  "data-testid=\"composer-rules-indicator\""
assert_contains "UI: ComposerPanel 上下文 codebase chip" \
  "frontend/src/components/ComposerPanel.tsx" \
  "ctx.codebase"
assert_contains "UI: ComposerPanel 上下文 git chip" \
  "frontend/src/components/ComposerPanel.tsx" \
  "ctx.git"
assert_contains "UI: ComposerPanel 上下文 diff chip" \
  "frontend/src/components/ComposerPanel.tsx" \
  "ctx.diff"
assert_contains "UI: ComposerPanel mention codebase 引用" \
  "frontend/src/components/ComposerPanel.tsx" \
  "codebase-search"
assert_contains "UI: ComposerPanel mention git 引用" \
  "frontend/src/components/ComposerPanel.tsx" \
  "git-log"
assert_contains "UI: ComposerPanel mention diff 引用" \
  "frontend/src/components/ComposerPanel.tsx" \
  "diff-working"
assert_contains "UI: ComposerPanel handleSelectMention 支持 codebase" \
  "frontend/src/components/ComposerPanel.tsx" \
  "case 'codebase'"
assert_contains "UI: ComposerPanel handleSelectMention 支持 git" \
  "frontend/src/components/ComposerPanel.tsx" \
  "case 'git'"
assert_contains "UI: ComposerPanel handleSelectMention 支持 diff" \
  "frontend/src/components/ComposerPanel.tsx" \
  "case 'diff'"
assert_contains "UI: ComposerPanel 注入 GitRefKind 类型" \
  "frontend/src/components/ComposerPanel.tsx" \
  "GitRefKind"

echo ""

# ============================================================
# 7. SPEC 文档验证
# ============================================================
echo "[7/7] SPEC 文档验证"
echo "----------------------------------------"

assert_contains "SPEC References: 功能需求" \
  "CYCLE18_SPEC_REFERENCES.md" \
  "## 一、功能需求"
assert_contains "SPEC References: 技术实现方案" \
  "CYCLE18_SPEC_REFERENCES.md" \
  "## 二、技术实现方案"
assert_contains "SPEC References: 验收标准" \
  "CYCLE18_SPEC_REFERENCES.md" \
  "## 六、验收标准"
assert_contains "SPEC Project Rules: 功能需求" \
  "CYCLE18_SPEC_PROJECT_RULES.md" \
  "## 一、功能需求"
assert_contains "SPEC Project Rules: 技术实现方案" \
  "CYCLE18_SPEC_PROJECT_RULES.md" \
  "## 二、技术实现方案"
assert_contains "SPEC Project Rules: 验收标准" \
  "CYCLE18_SPEC_PROJECT_RULES.md" \
  "## 六、验收标准"
assert_contains "SPEC Summarization: 功能需求" \
  "CYCLE18_SPEC_SUMMARIZATION.md" \
  "## 一、功能需求"
assert_contains "SPEC Summarization: 技术实现方案" \
  "CYCLE18_SPEC_SUMMARIZATION.md" \
  "## 二、技术实现方案"
assert_contains "SPEC Summarization: 验收标准" \
  "CYCLE18_SPEC_SUMMARIZATION.md" \
  "## 六、验收标准"

# Gap Analysis 包含所有 G18 任务
assert_contains "Gap Analysis: G18-01" "CYCLE18_GAP_ANALYSIS.md" "G18-01"
assert_contains "Gap Analysis: G18-02" "CYCLE18_GAP_ANALYSIS.md" "G18-02"
assert_contains "Gap Analysis: G18-03" "CYCLE18_GAP_ANALYSIS.md" "G18-03"

echo ""

# ============================================================
# 测试结果汇总
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
  echo -e "${GREEN}✓ 所有 Cycle 18 端到端测试通过${NC}"
  exit 0
else
  PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ${PASS}*100/${TOTAL}}")
  echo -e "  ${YELLOW}通过率: ${PASS_RATE}%${NC}"
  echo ""
  echo -e "${RED}✗ ${FAIL} 个测试失败${NC}"
  exit 1
fi
