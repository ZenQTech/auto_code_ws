/**
 * # ============================================================
 * # AutoCodeReviewEngine - 自动化代码评审引擎 (v1.0.0 Cycle 25 G25-01)
 * # ============================================================
 * # 核心作用：基于规则库自动评审代码变更，输出结构化报告
 * # 主要功能：
 * #   1. 100+ 内置规则（security/performance/maintainability/testing/bug/type-safety）
 * #   2. 5 级严重度（CRITICAL/HIGH/MEDIUM/LOW/INFO）
 * #   3. 严重度自动判定 verdict（APPROVE/REQUEST_CHANGES/BLOCK）
 * #   4. 报告导出（JSON/Markdown/SARIF）
 * #   5. 规则管理（注册/启用/禁用/查询）
 * #   6. 事件订阅（finding/complete/error）
 * # 运行流程：
 * #   1. review(input) → 解析所有文件 → 应用启用的规则 → 收集 findings
 * #   2. 应用 severity policy 覆盖 → 计算 verdict → 生成报告
 * #   3. 触发 complete 事件 → 用户可调用 export*() 获取报告
 * # 输入参数：
 * #   - input: { files: Record<string,string>, options?: ReviewOptions }
 * # 输出结果：
 * #   - ReviewReport（包含 findings + summary + verdict + byCategory）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-01 初次创建
 * # ============================================================
 */

import {
  ALL_RULES,
  RULES_BY_CATEGORY,
} from './autoCodeReviewRules';
import {
  DEFAULT_REVIEW_OPTIONS,
  decideVerdict,
  findingKey,
  generateFindingId,
  generateReportId,
  getHighestSeverity,
} from './autoCodeReviewTypes';
import type {
  ReviewCategory,
  ReviewFinding,
  ReviewInput,
  ReviewOptions,
  ReviewReport,
  ReviewRule,
  ReviewVerdict,
  RuleContext,
  Severity,
} from './autoCodeReviewTypes';

// ============================================================================
// 事件类型
// ============================================================================

export type ReviewEventMap = {
  finding: (finding: ReviewFinding) => void;
  'file-start': (file: string) => void;
  'file-complete': (file: string, findings: ReviewFinding[]) => void;
  complete: (report: ReviewReport) => void;
  error: (err: Error) => void;
};

// ============================================================================
// 引擎配置
// ============================================================================

export interface EngineConfig {
  rootDir?: string;
  defaultOptions?: Partial<ReviewOptions>;
}

const DEFAULT_ENGINE_CONFIG: Required<EngineConfig> = {
  rootDir: '',
  defaultOptions: {},
};

// ============================================================================
// 主引擎
// ============================================================================

export class AutoCodeReviewEngine {
  private rules: Map<string, ReviewRule> = new Map();
  private severityPolicy: Partial<Record<ReviewCategory, Severity>> = {};
  private listeners: Map<string, Set<Function>> = new Map();
  private stats = { reviews: 0, findings: 0, rules: 0 };
  private config: Required<EngineConfig>;

  constructor(config: EngineConfig = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    // 注册所有内置规则
    for (const rule of ALL_RULES) {
      this.rules.set(rule.id, { ...rule, enabled: rule.enabled !== false });
    }
    this.stats.rules = this.rules.size;
  }

  // ============ 规则管理 ============

  registerRule(rule: ReviewRule): void {
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

  getRule(ruleId: string): ReviewRule | undefined {
    return this.rules.get(ruleId);
  }

  getRules(): ReviewRule[] {
    return Array.from(this.rules.values());
  }

  getEnabledRules(): ReviewRule[] {
    return this.getRules().filter((r) => r.enabled !== false);
  }

  getRulesByCategory(category: ReviewCategory): ReviewRule[] {
    return this.getRules().filter((r) => r.category === category);
  }

  // ============ 严重度策略 ============

  setSeverityPolicy(policy: Partial<Record<ReviewCategory, Severity>>): void {
    this.severityPolicy = { ...policy };
  }

  getSeverityPolicy(): Partial<Record<ReviewCategory, Severity>> {
    return { ...this.severityPolicy };
  }

  // ============ 主流程：review ============

  async review(input: ReviewInput): Promise<ReviewReport> {
    const startedAt = Date.now();
    const options = { ...DEFAULT_REVIEW_OPTIONS, ...this.config.defaultOptions, ...input.options };
    const includePatches = options.includePatches ?? true;
    const maxFindings = options.maxFindings ?? DEFAULT_REVIEW_OPTIONS.maxFindings;
    const enabledCategories = new Set<ReviewCategory>(
      options.enabledCategories ?? DEFAULT_REVIEW_OPTIONS.enabledCategories
    );

    const allFindings: ReviewFinding[] = [];
    const fileCount = Object.keys(input.files).length;
    const seenKeys = new Set<string>();

    // 遍历每个文件应用规则
    for (const [file, content] of Object.entries(input.files)) {
      try {
        this.emit('file-start', file);
        const ctx: RuleContext = {
          rootDir: this.config.rootDir,
          existingFindings: allFindings,
          includePatches,
        };

        const fileFindings: ReviewFinding[] = [];
        const enabledRules = this.getEnabledRules().filter((r) =>
          enabledCategories.has(r.category)
        );

        for (const rule of enabledRules) {
          try {
            const raws = rule.check(file, content, ctx);
            for (const raw of raws) {
              // 严重度策略覆盖
              const policySev = options.severityPolicy?.[rule.category] ?? this.severityPolicy[rule.category];
              const severity = policySev ?? rule.severity;

              const finding: ReviewFinding = {
                id: generateFindingId(),
                severity,
                category: rule.category,
                file,
                line: raw.line,
                title: raw.title,
                message: raw.message,
                ruleId: rule.id,
                existingCode: includePatches ? raw.existingCode : undefined,
                suggestedPatch: includePatches ? raw.suggestedPatch : undefined,
                why: raw.why,
                confidence: raw.confidence ?? 0.7,
                timestamp: Date.now(),
              };

              // 去重
              const key = findingKey(finding);
              if (seenKeys.has(key)) continue;
              seenKeys.add(key);

              if (allFindings.length >= maxFindings) {
                break;
              }

              allFindings.push(finding);
              fileFindings.push(finding);
              this.stats.findings++;
              this.emit('finding', finding);
            }
            if (allFindings.length >= maxFindings) break;
          } catch (ruleErr) {
            this.emit('error', ruleErr instanceof Error ? ruleErr : new Error(String(ruleErr)));
          }
        }

        this.emit('file-complete', file, fileFindings);
        if (allFindings.length >= maxFindings) break;
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // 计算 summary
    const summary = {
      critical: allFindings.filter((f) => f.severity === 'critical').length,
      high: allFindings.filter((f) => f.severity === 'high').length,
      medium: allFindings.filter((f) => f.severity === 'medium').length,
      low: allFindings.filter((f) => f.severity === 'low').length,
      info: allFindings.filter((f) => f.severity === 'info').length,
    };

    // 按 category 统计
    const byCategory: Partial<Record<ReviewCategory, number>> = {};
    for (const f of allFindings) {
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    // 决策 verdict
    const verdict: ReviewVerdict = decideVerdict(summary);

    const report: ReviewReport = {
      id: generateReportId(),
      timestamp: startedAt,
      duration: Date.now() - startedAt,
      fileCount,
      verdict,
      findings: allFindings,
      summary,
      byCategory,
      metadata: options.metadata,
    };

    this.stats.reviews++;
    this.emit('complete', report);
    return report;
  }

  // ============ 报告导出 ============

  exportJSON(report: ReviewReport, pretty = true): string {
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  exportMarkdown(report: ReviewReport): string {
    const lines: string[] = [];
    lines.push(`# Hermes Auto Code Review Report`);
    lines.push('');
    lines.push(`**Report ID**: \`${report.id}\``);
    lines.push(`**Generated**: ${new Date(report.timestamp).toISOString()}`);
    lines.push(`**Duration**: ${report.duration}ms`);
    lines.push(`**Files reviewed**: ${report.fileCount}`);
    lines.push(`**Verdict**: ${this.formatVerdict(report.verdict)}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| 🔴 CRITICAL | ${report.summary.critical} |`);
    lines.push(`| 🟠 HIGH | ${report.summary.high} |`);
    lines.push(`| 🟡 MEDIUM | ${report.summary.medium} |`);
    lines.push(`| 🟢 LOW | ${report.summary.low} |`);
    lines.push(`| 💡 INFO | ${report.summary.info} |`);
    lines.push(`| **Total** | **${report.findings.length}** |`);
    lines.push('');

    // 按 category 分组
    const categories = Object.keys(report.byCategory) as ReviewCategory[];
    if (categories.length > 0) {
      lines.push(`## By Category`);
      lines.push('');
      lines.push(`| Category | Count |`);
      lines.push(`|----------|-------|`);
      for (const c of categories) {
        lines.push(`| ${c} | ${report.byCategory[c]} |`);
      }
      lines.push('');
    }

    // 按文件分组
    const byFile = new Map<string, ReviewFinding[]>();
    for (const f of report.findings) {
      const arr = byFile.get(f.file) ?? [];
      arr.push(f);
      byFile.set(f.file, arr);
    }

    lines.push(`## Findings by File`);
    lines.push('');
    for (const [file, findings] of byFile) {
      lines.push(`### \`${file}\` (${findings.length})`);
      lines.push('');
      for (const f of findings) {
        lines.push(`**[${f.severity.toUpperCase()}] ${f.title}**`);
        if (f.ruleId) lines.push(`> Rule: \`${f.ruleId}\` · Category: ${f.category} · Confidence: ${(f.confidence * 100).toFixed(0)}%`);
        if (f.line) lines.push(`> Location: ${f.file}:${f.line}`);
        lines.push('');
        lines.push(f.message);
        lines.push('');
        if (f.existingCode) {
          lines.push('**Current code:**');
          lines.push('```');
          lines.push(f.existingCode);
          lines.push('```');
          lines.push('');
        }
        if (f.suggestedPatch) {
          lines.push('**Suggested fix:**');
          lines.push('```');
          lines.push(f.suggestedPatch);
          lines.push('```');
          lines.push('');
        }
        if (f.why) {
          lines.push(`**Why**: ${f.why}`);
          lines.push('');
        }
      }
    }

    lines.push('---');
    lines.push('*Generated by Hermes AutoCodeReviewEngine v1.0.0*');
    return lines.join('\n');
  }

  exportSARIF(report: ReviewReport): string {
    const sarifResults = report.findings.map((f) => ({
      ruleId: f.ruleId ?? 'unknown',
      level: this.severityToSarifLevel(f.severity),
      message: { text: `${f.title}: ${f.message}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: f.line ? { startLine: f.line, endLine: f.line } : undefined,
          },
        },
      ],
    }));

    return JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'HermesAutoCodeReview',
                version: '1.0.0',
                informationUri: 'https://github.com/Hermes',
                rules: report.findings
                  .map((f) => f.ruleId)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((id) => ({
                    id,
                    name: id,
                    shortDescription: { text: `Rule ${id}` },
                  })),
              },
            },
            results: sarifResults,
          },
        ],
      },
      null,
      2
    );
  }

  private formatVerdict(v: ReviewVerdict): string {
    switch (v) {
      case 'BLOCK':
        return '🔴 BLOCK';
      case 'REQUEST_CHANGES':
        return '🟠 REQUEST_CHANGES';
      case 'APPROVE':
        return '🟢 APPROVE';
    }
  }

  private severityToSarifLevel(s: Severity): string {
    switch (s) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
      case 'info':
        return 'note';
    }
  }

  // ============ 事件订阅 ============

  on<K extends keyof ReviewEventMap>(event: K, listener: ReviewEventMap[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off<K extends keyof ReviewEventMap>(event: K, listener: ReviewEventMap[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends keyof ReviewEventMap>(
    event: K,
    ...args: Parameters<ReviewEventMap[K]>
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

  getStats(): { reviews: number; findings: number; rules: number } {
    return { ...this.stats };
  }

  clear(): void {
    this.stats = { reviews: 0, findings: 0, rules: this.rules.size };
    this.listeners.clear();
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let defaultEngine: AutoCodeReviewEngine | null = null;

export function getDefaultReviewEngine(): AutoCodeReviewEngine {
  if (!defaultEngine) {
    defaultEngine = new AutoCodeReviewEngine();
  }
  return defaultEngine;
}

export function resetDefaultReviewEngine(): void {
  defaultEngine?.clear();
  defaultEngine = null;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 获取所有规则按 category 分组的映射 */
export function getRulesByCategoryMap(): Record<ReviewCategory, ReviewRule[]> {
  const result = {} as Record<ReviewCategory, ReviewRule[]>;
  for (const [cat, rules] of Object.entries(RULES_BY_CATEGORY)) {
    result[cat as ReviewCategory] = rules;
  }
  return result;
}

/** 决策 verdict（重新导出） */
export { decideVerdict, getHighestSeverity };

/** 全局规则数量 */
export const TOTAL_BUILTIN_RULES = ALL_RULES.length;
