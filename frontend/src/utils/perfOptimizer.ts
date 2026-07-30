/**
 * # ============================================================
 * # PerfOptimizerEngine - AI 主动性能优化引擎 (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 核心作用：基于静态分析 + 启发式规则，识别 React 性能反模式，生成重构建议
 * # 依赖：G25-03 规则库
 * # 主要功能：
 * #   1. 扫描 useMemo / useCallback / React.memo / inline 等
 * #   2. 20+ 反模式规则检测
 * #   3. 自动生成重构 diff
 * #   4. 性能预算检查（max render / max state / max lines 等）
 * #   5. 报告导出（JSON / Markdown / Patch）
 * #   6. 事件订阅（usage-detected / scan-complete / error）
 * # 运行流程：
 * #   1. scan(input) → 扫描所有文件 → 提取 hook usages
 * #   2. 应用每条规则 → 标记 isNecessary → 生成 suggestions
 * #   3. 检查预算 → 计算 score → 生成报告
 * # 输入参数：
 * #   - input: { files: Record<string,string>, budget?: Partial<PerfBudget> }
 * # 输出结果：
 * #   - PerfReport（包含 suggestions / byPattern / budgetViolations / score）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

import {
  ALL_PERF_RULES,
  RULES_BY_PATTERN,
} from './perfOptimizerRules';
import {
  DEFAULT_BUDGET,
  calculateScore,
  generateReportId,
  generateSuggestionId,
  scoreGrade,
} from './perfOptimizerTypes';
import type {
  HookPattern,
  HookUsage,
  PerfBudget,
  PerfReport,
  PerfRule,
  RefactorSuggestion,
  RuleContext,
  ScanInput,
} from './perfOptimizerTypes';

// ============================================================================
// 事件类型
// ============================================================================

export type PerfEventMap = {
  'usage-detected': (usage: HookUsage) => void;
  'scan-complete': (report: PerfReport) => void;
  error: (err: Error) => void;
};

// ============================================================================
// 扫描辅助函数
// ============================================================================

/**
 * 在 line 中找到 useMemo/useCallback 等调用，从 argsStart 开始跟踪括号深度，
 * 找到匹配的 ')' 作为参数列表的结束。返回 [argStart, argEnd]（含括号）。
 * argsStart 应指向 '(' 本身。
 */
function findCallArgs(line: string, argsStart: number): [number, number] | null {
  if (line[argsStart] !== '(') return null;
  let depth = 0;
  for (let i = argsStart; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') {
      depth--;
      if (depth === 0) return [argsStart, i];
    }
  }
  return null;
}

/**
 * 提取 useMemo 调用
 */
function extractUseMemo(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const re = /useMemo\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(re);
    if (!m) continue;
    // m[0] = "useMemo(", m.index 是 'u' 位置，加 m[0].length - 1 指向 '('
    const parenStart = m.index! + m[0].length - 1;
    const found = findCallArgs(line, parenStart);
    if (!found) continue;
    // 提取 args 内部内容（不含括号）
    const args = line.slice(found[0] + 1, found[1]);
    let wrapped = args;
    let deps: string[] | undefined;
    const lastBracket = args.lastIndexOf(']');
    const startBracket = args.lastIndexOf('[');
    if (startBracket >= 0 && lastBracket > startBracket) {
      const beforeBracket = args.lastIndexOf(',', lastBracket);
      if (beforeBracket > 0) {
        wrapped = args.slice(0, beforeBracket).trim();
        const depsContent = args.slice(startBracket + 1, lastBracket).trim();
        deps = depsContent.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    usages.push({
      file,
      line: i + 1,
      name: 'useMemo',
      pattern: 'useMemo',
      deps,
      wrapped: wrapped.length > 200 ? wrapped.slice(0, 200) + '...' : wrapped,
      isNecessary: true,
      reason: '',
      confidence: 0,
      suggestion: '',
      refactored: '',
    });
  }
  return usages;
}

/**
 * 提取 useCallback 调用
 */
function extractUseCallback(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const re = /useCallback\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(re);
    if (!m) continue;
    const parenStart = m.index! + m[0].length - 1;
    const found = findCallArgs(line, parenStart);
    if (!found) continue;
    const args = line.slice(found[0] + 1, found[1]);
    let wrapped = args;
    let deps: string[] | undefined;
    const lastBracket = args.lastIndexOf(']');
    const startBracket = args.lastIndexOf('[');
    if (startBracket >= 0 && lastBracket > startBracket) {
      const beforeBracket = args.lastIndexOf(',', lastBracket);
      if (beforeBracket > 0) {
        wrapped = args.slice(0, beforeBracket).trim();
        const depsContent = args.slice(startBracket + 1, lastBracket).trim();
        deps = depsContent.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    usages.push({
      file,
      line: i + 1,
      name: 'useCallback',
      pattern: 'useCallback',
      deps,
      wrapped: wrapped.length > 200 ? wrapped.slice(0, 200) + '...' : wrapped,
      isNecessary: true,
      reason: '',
      confidence: 0,
      suggestion: '',
      refactored: '',
    });
  }
  return usages;
}

/**
 * 提取 React.memo
 */
function extractReactMemo(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const re = /React\.memo\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) {
      const wrapped = line.trim();
      usages.push({
        file,
        line: i + 1,
        name: 'React.memo',
        pattern: 'React.memo',
        wrapped: wrapped.length > 100 ? wrapped.slice(0, 100) + '...' : wrapped,
        isNecessary: true,
        reason: '',
        confidence: 0,
        suggestion: '',
        refactored: '',
      });
    }
  }
  return usages;
}

/**
 * 提取 useState
 */
function extractUseState(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const re = /useState\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) {
      const wrapped = line.trim();
      usages.push({
        file,
        line: i + 1,
        name: 'useState',
        pattern: 'useState',
        wrapped: wrapped.length > 100 ? wrapped.slice(0, 100) + '...' : wrapped,
        isNecessary: true,
        reason: '',
        confidence: 0,
        suggestion: '',
        refactored: '',
      });
    }
  }
  return usages;
}

/**
 * 提取 useEffect
 */
function extractUseEffect(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const re = /useEffect\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) {
      // useEffect 通常跨多行，简单处理：截取 100 字符
      let wrapped = line;
      // 如果括号未闭合，继续拼接下一行
      let depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      let j = i;
      while (depth > 0 && j < lines.length - 1) {
        j++;
        wrapped += '\n' + lines[j];
        depth += (lines[j].match(/\(/g) || []).length;
        depth -= (lines[j].match(/\)/g) || []).length;
      }
      usages.push({
        file,
        line: i + 1,
        name: 'useEffect',
        pattern: 'useEffect',
        wrapped: wrapped.length > 200 ? wrapped.slice(0, 200) + '...' : wrapped,
        isNecessary: true,
        reason: '',
        confidence: 0,
        suggestion: '',
        refactored: '',
      });
    }
  }
  return usages;
}

/**
 * 提取 list key 使用（map().JSX）
 */
function extractListKey(file: string, content: string): HookUsage[] {
  const usages: HookUsage[] = [];
  const lines = content.split('\n');
  const mapRe = /\.map\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mapRe.test(line)) {
      // 拼接跨行
      let wrapped = line;
      let j = i;
      const maxLookAhead = 5;
      let k = 0;
      while ((!wrapped.includes('=>') || !wrapped.includes(')')) && k < maxLookAhead && j < lines.length - 1) {
        j++;
        wrapped += '\n' + lines[j];
        k++;
      }
      usages.push({
        file,
        line: i + 1,
        name: 'map()',
        pattern: 'list-key',
        wrapped: wrapped.length > 200 ? wrapped.slice(0, 200) + '...' : wrapped,
        isNecessary: true,
        reason: '',
        confidence: 0,
        suggestion: '',
        refactored: '',
      });
    }
  }
  return usages;
}

/**
 * 估算 bundle 体积（基于代码长度）
 */
function estimateBundleSize(files: Record<string, string>): number {
  let total = 0;
  for (const content of Object.values(files)) {
    // 假设 minified 后每字符 ~1 byte
    total += content.length;
  }
  // 加上 gzip 压缩比约 0.3，再加上一些 overhead
  return Math.round((total * 0.3) / 1024);
}

// ============================================================================
// 主引擎
// ============================================================================

export class PerfOptimizerEngine {
  private rules: Map<string, PerfRule> = new Map();
  private listeners: Map<string, Set<Function>> = new Map();
  private stats = { scans: 0, suggestions: 0, rules: 0 };
  private budget: PerfBudget;

  constructor(config: { defaultBudget?: Partial<PerfBudget> } = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...(config.defaultBudget || {}) };
    for (const rule of ALL_PERF_RULES) {
      this.rules.set(rule.id, { ...rule, enabled: rule.enabled !== false });
    }
    this.stats.rules = this.rules.size;
  }

  // ============ 规则管理 ============

  registerRule(rule: PerfRule): void {
    this.rules.set(rule.id, { ...rule, enabled: rule.enabled !== false });
    this.stats.rules = this.rules.size;
  }

  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.stats.rules = this.rules.size;
  }

  enableRule(ruleId: string): void {
    const r = this.rules.get(ruleId);
    if (r) r.enabled = true;
  }

  disableRule(ruleId: string): void {
    const r = this.rules.get(ruleId);
    if (r) r.enabled = false;
  }

  getRules(): PerfRule[] {
    return Array.from(this.rules.values());
  }

  getEnabledRules(): PerfRule[] {
    return this.getRules().filter((r) => r.enabled !== false);
  }

  getRulesByPattern(pattern: HookPattern): PerfRule[] {
    return this.getRules().filter((r) => r.pattern === pattern);
  }

  // ============ 预算管理 ============

  setBudget(budget: Partial<PerfBudget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  getBudget(): PerfBudget {
    return { ...this.budget };
  }

  // ============ 文件扫描 ============

  scanFile(file: string, content: string): HookUsage[] {
    const usages: HookUsage[] = [
      ...extractUseMemo(file, content),
      ...extractUseCallback(file, content),
      ...extractReactMemo(file, content),
      ...extractUseState(file, content),
      ...extractUseEffect(file, content),
      ...extractListKey(file, content),
    ];
    return usages;
  }

  // ============ 主流程：scan ============

  async scan(input: ScanInput): Promise<PerfReport> {
    const startedAt = Date.now();
    const budget: PerfBudget = { ...this.budget, ...(input.budget || {}) };
    const enabledPatterns = input.enabledPatterns
      ? new Set<HookPattern>(input.enabledPatterns)
      : null;

    // 1) 提取所有 hook usages
    const allUsages: HookUsage[] = [];
    for (const [file, content] of Object.entries(input.files)) {
      try {
        const fileUsages = this.scanFile(file, content);
        for (const u of fileUsages) {
          if (!enabledPatterns || enabledPatterns.has(u.pattern)) {
            allUsages.push(u);
            this.emit('usage-detected', u);
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // 2) 应用规则
    const suggestions: RefactorSuggestion[] = [];
    const enabledRules = this.getEnabledRules();
    for (const usage of allUsages) {
      const ctx: RuleContext = {
        file: usage.file,
        allUsages,
        budget,
      };
      for (const rule of enabledRules) {
        // 规则 pattern 必须与 usage pattern 一致，或规则 pattern 是 usage pattern 的前缀（如 useMemo 适用于 useMemo-deps）
        if (rule.pattern !== usage.pattern && !usage.pattern.startsWith(rule.pattern + '-')) continue;
        try {
          const result = rule.check(usage, ctx);
          // 保留所有"不必要"的判定（一旦任一规则判定为不必要，整体就不必要）
          if (!result.isNecessary) {
            usage.isNecessary = false;
            usage.reason = result.reason;
            usage.confidence = result.confidence;
            usage.suggestion = result.suggestion;
            usage.refactored = result.refactored;
            const suggestion: RefactorSuggestion = {
              id: generateSuggestionId(),
              file: usage.file,
              line: usage.line,
              antiPattern: usage.pattern,
              originalCode: usage.wrapped,
              refactoredCode: result.refactored,
              severity: result.confidence >= 0.85 ? 'high' : result.confidence >= 0.7 ? 'medium' : 'low',
              reason: result.reason,
              estimatedImpact: Math.round(result.confidence * 0.5 * 100) / 100,
              estimatedLOCReduction: this.countLOCReduction(usage.wrapped, result.refactored),
              confidence: result.confidence,
            };
            suggestions.push(suggestion);
            this.stats.suggestions++;
          }
        } catch (err) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    // 3) 统计 byPattern
    const byPattern: Partial<Record<HookPattern, number>> = {};
    const unnecessaryByPattern: Partial<Record<HookPattern, number>> = {};
    for (const u of allUsages) {
      byPattern[u.pattern] = (byPattern[u.pattern] ?? 0) + 1;
      if (!u.isNecessary) {
        unnecessaryByPattern[u.pattern] = (unnecessaryByPattern[u.pattern] ?? 0) + 1;
      }
    }

    // 4) 检查预算
    const budgetViolations = this.checkBudgetFromUsages(allUsages, suggestions, input.files, budget);

    // 5) 计算 score
    const estimatedBundleSize = estimateBundleSize(input.files);
    const report: Omit<PerfReport, 'score'> = {
      id: generateReportId(),
      timestamp: startedAt,
      duration: Date.now() - startedAt,
      fileCount: Object.keys(input.files).length,
      totalHooks: allUsages.length,
      unnecessaryHooks: allUsages.filter((u) => !u.isNecessary).length,
      suggestions,
      byPattern,
      unnecessaryByPattern,
      budgetViolations,
      estimatedBundleSize,
      metadata: {},
    };

    const finalReport: PerfReport = {
      ...report,
      score: calculateScore(report),
    };

    this.stats.scans++;
    this.emit('scan-complete', finalReport);
    return finalReport;
  }

  private countLOCReduction(original: string, refactored: string): number {
    return Math.max(0, original.split('\n').length - refactored.split('\n').length);
  }

  // ============ 预算检查 ============

  checkBudget(report: PerfReport): Array<{ metric: keyof PerfBudget; actual: number; budget: number }> {
    return report.budgetViolations;
  }

  private checkBudgetFromUsages(
    usages: HookUsage[],
    suggestions: RefactorSuggestion[],
    files: Record<string, string>,
    budget: PerfBudget
  ): Array<{ metric: keyof PerfBudget; actual: number; budget: number }> {
    const violations: Array<{ metric: keyof PerfBudget; actual: number; budget: number }> = [];
    // unnecessary memo count
    if (suggestions.length > budget.maxUnnecessaryMemo) {
      violations.push({
        metric: 'maxUnnecessaryMemo',
        actual: suggestions.length,
        budget: budget.maxUnnecessaryMemo,
      });
    }
    // useState per file
    const stateByFile = new Map<string, number>();
    for (const u of usages) {
      if (u.pattern === 'useState') {
        stateByFile.set(u.file, (stateByFile.get(u.file) ?? 0) + 1);
      }
    }
    for (const [_file, count] of stateByFile) {
      if (count > budget.maxStatePerComponent) {
        violations.push({
          metric: 'maxStatePerComponent',
          actual: count,
          budget: budget.maxStatePerComponent,
        });
      }
    }
    // component lines
    for (const [_file, content] of Object.entries(files)) {
      const lineCount = content.split('\n').length;
      if (lineCount > budget.maxComponentLines) {
        violations.push({
          metric: 'maxComponentLines',
          actual: lineCount,
          budget: budget.maxComponentLines,
        });
      }
    }
    // bundle size
    const bundle = estimateBundleSize(files);
    if (bundle > budget.maxBundleSize) {
      violations.push({
        metric: 'maxBundleSize',
        actual: bundle,
        budget: budget.maxBundleSize,
      });
    }
    return violations;
  }

  // ============ 报告导出 ============

  exportJSON(report: PerfReport, pretty = true): string {
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  exportMarkdown(report: PerfReport): string {
    const lines: string[] = [];
    const grade = scoreGrade(report.score);
    lines.push('# Hermes Performance Optimization Report');
    lines.push('');
    lines.push(`**Report ID**: \`${report.id}\``);
    lines.push(`**Generated**: ${new Date(report.timestamp).toISOString()}`);
    lines.push(`**Files scanned**: ${report.fileCount}`);
    lines.push(`**Duration**: ${report.duration}ms`);
    lines.push(`**Overall score**: ${grade.icon} ${report.score}/100 (${grade.label})`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Total hooks detected: ${report.totalHooks}`);
    lines.push(`- Unnecessary hooks: ${report.unnecessaryHooks} (${report.totalHooks > 0 ? ((report.unnecessaryHooks / report.totalHooks) * 100).toFixed(1) : '0'}%)`);
    lines.push(`- Suggestions: ${report.suggestions.length} (🔴 ${report.suggestions.filter((s) => s.severity === 'high').length} / 🟠 ${report.suggestions.filter((s) => s.severity === 'medium').length} / 🟡 ${report.suggestions.filter((s) => s.severity === 'low').length})`);
    lines.push('');

    // By pattern
    const patterns = Object.keys(report.byPattern) as HookPattern[];
    if (patterns.length > 0) {
      lines.push('## By Pattern');
      lines.push('');
      lines.push('| Pattern | Total | Unnecessary |');
      lines.push('|---------|-------|-------------|');
      for (const p of patterns) {
        lines.push(`| ${p} | ${report.byPattern[p]} | ${report.unnecessaryByPattern[p] ?? 0} |`);
      }
      lines.push('');
    }

    // Top suggestions
    const top = [...report.suggestions]
      .sort((a, b) => this.severityRank(b.severity) - this.severityRank(a.severity))
      .slice(0, 10);
    if (top.length > 0) {
      lines.push('## Top Suggestions');
      lines.push('');
      top.forEach((s, i) => {
        const icon = s.severity === 'high' ? '🔴' : s.severity === 'medium' ? '🟠' : '🟡';
        lines.push(`### ${i + 1}. [${s.severity.toUpperCase()}] ${icon} \`${s.file}:${s.line}\``);
        lines.push(`**Pattern**: ${s.antiPattern}`);
        lines.push(`**Reason**: ${s.reason}`);
        lines.push(`**Impact**: ~${s.estimatedImpact}ms render time saved, ${s.estimatedLOCReduction} lines reduced`);
        lines.push('');
        lines.push('**Before**:');
        lines.push('```tsx');
        lines.push(s.originalCode);
        lines.push('```');
        lines.push('');
        lines.push('**After**:');
        lines.push('```tsx');
        lines.push(s.refactoredCode);
        lines.push('```');
        lines.push('');
      });
    }

    // Budget violations
    if (report.budgetViolations.length > 0) {
      lines.push('## Budget Violations');
      lines.push('');
      for (const v of report.budgetViolations) {
        lines.push(`- ❌ \`${v.metric}\`: actual=${v.actual}, budget=${v.budget}`);
      }
      lines.push('');
    } else {
      lines.push('## Budget');
      lines.push('');
      lines.push('- ✅ All budgets met');
      lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by Hermes PerfOptimizerEngine v1.0.0*');
    return lines.join('\n');
  }

  exportPatch(suggestions: RefactorSuggestion[]): string {
    const lines: string[] = [];
    lines.push('# Hermes Performance Optimization Patch');
    lines.push('# Generated by PerfOptimizerEngine v1.0.0');
    lines.push('');
    lines.push('# Apply with caution: review each change before applying.');
    lines.push('');

    const byFile = new Map<string, RefactorSuggestion[]>();
    for (const s of suggestions) {
      const arr = byFile.get(s.file) ?? [];
      arr.push(s);
      byFile.set(s.file, arr);
    }

    for (const [file, suggestions_] of byFile) {
      lines.push(`## File: ${file}`);
      lines.push('');
      for (const s of suggestions_) {
        lines.push(`### Line ${s.line} [${s.severity.toUpperCase()}]`);
        lines.push('');
        lines.push(`# Reason: ${s.reason}`);
        lines.push('');
        lines.push('- Before:');
        lines.push('```tsx');
        lines.push(s.originalCode);
        lines.push('```');
        lines.push('');
        lines.push('+ After:');
        lines.push('```tsx');
        lines.push(s.refactoredCode);
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private severityRank(s: 'high' | 'medium' | 'low'): number {
    return { high: 3, medium: 2, low: 1 }[s];
  }

  // ============ 重构建议生成 ============

  generateRefactor(usage: HookUsage): RefactorSuggestion {
    return {
      id: generateSuggestionId(),
      file: usage.file,
      line: usage.line,
      antiPattern: usage.pattern,
      originalCode: usage.wrapped,
      refactoredCode: usage.refactored,
      severity: usage.confidence >= 0.85 ? 'high' : usage.confidence >= 0.7 ? 'medium' : 'low',
      reason: usage.reason,
      estimatedImpact: Math.round(usage.confidence * 0.5 * 100) / 100,
      estimatedLOCReduction: this.countLOCReduction(usage.wrapped, usage.refactored),
      confidence: usage.confidence,
    };
  }

  generateRefactors(usages: HookUsage[]): RefactorSuggestion[] {
    return usages.filter((u) => !u.isNecessary).map((u) => this.generateRefactor(u));
  }

  // ============ 事件订阅 ============

  on<K extends keyof PerfEventMap>(event: K, listener: PerfEventMap[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off<K extends keyof PerfEventMap>(event: K, listener: PerfEventMap[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends keyof PerfEventMap>(
    event: K,
    ...args: Parameters<PerfEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as any)(...args);
      } catch {
        // ignore listener errors
      }
    }
  }

  // ============ 状态查询 ============

  getStats(): { scans: number; suggestions: number; rules: number } {
    return { ...this.stats };
  }

  clear(): void {
    this.stats = { scans: 0, suggestions: 0, rules: this.rules.size };
    this.listeners.clear();
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let defaultEngine: PerfOptimizerEngine | null = null;

export function getDefaultPerfEngine(): PerfOptimizerEngine {
  if (!defaultEngine) {
    defaultEngine = new PerfOptimizerEngine();
  }
  return defaultEngine;
}

export function resetDefaultPerfEngine(): void {
  defaultEngine?.clear();
  defaultEngine = null;
}

// ============================================================================
// 工具函数
// ============================================================================

export { calculateScore, scoreGrade } from './perfOptimizerTypes';
export const TOTAL_PERF_RULES = ALL_PERF_RULES.length;
export { RULES_BY_PATTERN };
