/**
 * # ============================================================
 * # AutoCodeReviewEngine Types - 自动化代码评审引擎类型定义 (v1.0.0 Cycle 25 G25-01)
 * # ============================================================
 * # 核心作用：定义代码评审引擎的所有类型、严重度、分类、报告结构
 * # 主要功能：
 * #   1. 5 级严重度（CRITICAL/HIGH/MEDIUM/LOW/INFO）
 * #   2. 10 个评审分类（bug/security/performance/...）
 * #   3. 单条 finding 数据模型
 * #   4. 完整 review 报告结构
 * #   5. 规则定义接口
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-01 初次创建
 * # ============================================================
 */

// ============ 严重度 ============

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '阻塞级',
  high: '严重',
  medium: '中等',
  low: '轻微',
  info: '提示',
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#0284c7',
};

export const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
  info: '💡',
};

// ============ 分类 ============

export type ReviewCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'testing'
  | 'style'
  | 'accessibility'
  | 'error-handling'
  | 'resource-leak'
  | 'type-safety';

export const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  bug: '潜在 Bug',
  security: '安全',
  performance: '性能',
  maintainability: '可维护性',
  testing: '测试',
  style: '代码风格',
  accessibility: '可访问性',
  'error-handling': '错误处理',
  'resource-leak': '资源泄漏',
  'type-safety': '类型安全',
};

// ============ Finding ============

export interface ReviewFinding {
  id: string;
  severity: Severity;
  category: ReviewCategory;
  file: string;
  line?: number;
  title: string;
  message: string;
  ruleId?: string;
  existingCode?: string;
  suggestedPatch?: string;
  why?: string;
  confidence: number;
  timestamp: number;
}

export interface RawFinding {
  line?: number;
  title: string;
  message: string;
  existingCode?: string;
  suggestedPatch?: string;
  why?: string;
  confidence?: number;
}

// ============ 报告 ============

export interface ReviewReport {
  id: string;
  timestamp: number;
  duration: number;
  fileCount: number;
  verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'BLOCK';
  findings: ReviewFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  byCategory: Partial<Record<ReviewCategory, number>>;
  metadata?: Record<string, unknown>;
}

export type ReviewVerdict = ReviewReport['verdict'];

// ============ 输入 ============

export interface ReviewInput {
  files: Record<string, string>;
  diff?: string;
  options?: ReviewOptions;
}

export interface ReviewOptions {
  enabledCategories?: ReviewCategory[];
  severityPolicy?: Partial<Record<ReviewCategory, Severity>>;
  maxFindings?: number;
  includePatches?: boolean;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_REVIEW_OPTIONS: Required<ReviewOptions> = {
  enabledCategories: [
    'bug',
    'security',
    'performance',
    'maintainability',
    'testing',
    'style',
    'accessibility',
    'error-handling',
    'resource-leak',
    'type-safety',
  ],
  severityPolicy: {},
  maxFindings: 500,
  includePatches: true,
  metadata: {},
};

// ============ 规则 ============

export interface RuleContext {
  rootDir: string;
  existingFindings: ReviewFinding[];
  includePatches: boolean;
}

export interface ReviewRule {
  id: string;
  category: ReviewCategory;
  severity: Severity;
  description: string;
  check: (file: string, content: string, context: RuleContext) => RawFinding[];
  enabled?: boolean;
}

// ============ Verdict 决策 ============

/**
 * 根据 summary 决策 verdict
 * - 任何 critical → BLOCK
 * - high >= 3 → BLOCK
 * - 1+ high 或 5+ medium → REQUEST_CHANGES
 * - 否则 → APPROVE
 */
export function decideVerdict(summary: ReviewReport['summary']): ReviewVerdict {
  if (summary.critical > 0) return 'BLOCK';
  if (summary.high >= 3) return 'BLOCK';
  if (summary.high > 0) return 'REQUEST_CHANGES';
  if (summary.medium >= 5) return 'REQUEST_CHANGES';
  return 'APPROVE';
}

// ============ Utility ============

/**
 * 生成 finding ID
 */
export function generateFindingId(): string {
  return `finding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成 report ID
 */
export function generateReportId(): string {
  return `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 提取 finding 列表中最高的严重度
 */
export function getHighestSeverity(findings: ReviewFinding[]): Severity {
  if (findings.length === 0) return 'info';
  let max: Severity = 'info';
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[max]) max = f.severity;
  }
  return max;
}

/**
 * 按严重度排序（降序）
 */
export function sortFindingsBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

/**
 * 按 file:line 生成 stable key（用于去重）
 */
export function findingKey(f: Pick<ReviewFinding, 'ruleId' | 'file' | 'line' | 'title'>): string {
  return `${f.ruleId ?? ''}::${f.file}::${f.line ?? ''}::${f.title}`;
}
