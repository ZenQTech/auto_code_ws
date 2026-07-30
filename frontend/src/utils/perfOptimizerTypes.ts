/**
 * # ============================================================
 * # PerfOptimizerEngine Types - AI 主动性能优化引擎类型定义 (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 核心作用：定义 PerfOptimizer 引擎的所有类型、性能预算、报告结构
 * # 依赖：无
 * # 主要功能：
 * #   1. Hook 使用模式分类（useMemo / useCallback / React.memo / inline）
 * #   2. 性能预算声明（max render ms / max state / max lines 等）
 * #   3. 重构建议数据模型（id / file / line / severity / impact）
 * #   4. 报告输出（JSON / Markdown / Patch）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

// ============ Hook 使用模式 ============

export type HookPattern =
  | 'useMemo'
  | 'useCallback'
  | 'React.memo'
  | 'useMemo-multiple'
  | 'useMemo-deps'
  | 'inline-arrow'
  | 'inline-object'
  | 'useState'
  | 'useEffect'
  | 'list-key';

export const PATTERN_LABELS: Record<HookPattern, string> = {
  'useMemo': 'useMemo',
  'useCallback': 'useCallback',
  'React.memo': 'React.memo',
  'useMemo-multiple': 'useMemo 串联',
  'useMemo-deps': 'useMemo 依赖',
  'inline-arrow': '内联箭头函数',
  'inline-object': '内联对象/数组',
  'useState': 'useState',
  'useEffect': 'useEffect',
  'list-key': '列表 Key',
};

export const PATTERN_ICONS: Record<HookPattern, string> = {
  'useMemo': '🧠',
  'useCallback': '🔁',
  'React.memo': '🛡️',
  'useMemo-multiple': '🔗',
  'useMemo-deps': '📦',
  'inline-arrow': '➡️',
  'inline-object': '📋',
  'useState': '📍',
  'useEffect': '⚙️',
  'list-key': '🔑',
};

// ============ Hook 使用记录 ============

export interface HookUsage {
  /** 文件路径 */
  file: string;
  /** 行号 */
  line: number;
  /** Hook 名 */
  name: string;
  /** 模式分类 */
  pattern: HookPattern;
  /** 依赖项数组内容（字符串） */
  deps?: string[];
  /** 包裹的表达式（截断 100 字符） */
  wrapped: string;
  /** 是否必要（基于规则） */
  isNecessary: boolean;
  /** 理由 */
  reason: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 重构建议（人话） */
  suggestion: string;
  /** 重构后代码 */
  refactored: string;
}

// ============ 重构建议 ============

export interface RefactorSuggestion {
  id: string;
  file: string;
  line: number;
  antiPattern: HookPattern;
  originalCode: string;
  refactoredCode: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
  estimatedImpact: number;
  estimatedLOCReduction: number;
  confidence: number;
}

// ============ 性能预算 ============

export interface PerfBudget {
  /** 单次 render 最大耗时（ms） */
  maxRenderMs: number;
  /** 单个组件最多订阅的 state 数 */
  maxStatePerComponent: number;
  /** 列表项 key 的稳定率（0-1） */
  minKeyStability: number;
  /** 组件最大行数 */
  maxComponentLines: number;
  /** 不必要 memo 数量上限 */
  maxUnnecessaryMemo: number;
  /** bundle 体积上限（KB） */
  maxBundleSize: number;
}

export const DEFAULT_BUDGET: PerfBudget = {
  maxRenderMs: 5,
  maxStatePerComponent: 5,
  minKeyStability: 0.8,
  maxComponentLines: 200,
  maxUnnecessaryMemo: 0,
  maxBundleSize: 1024,
};

// ============ 性能报告 ============

export interface PerfReport {
  id: string;
  timestamp: number;
  duration: number;
  fileCount: number;
  totalHooks: number;
  unnecessaryHooks: number;
  suggestions: RefactorSuggestion[];
  byPattern: Partial<Record<HookPattern, number>>;
  unnecessaryByPattern: Partial<Record<HookPattern, number>>;
  budgetViolations: Array<{
    metric: keyof PerfBudget;
    actual: number;
    budget: number;
  }>;
  score: number;
  estimatedBundleSize: number;
  metadata?: Record<string, unknown>;
}

// ============ 扫描输入 ============

export interface ScanInput {
  files: Record<string, string>;
  budget?: Partial<PerfBudget>;
  enabledPatterns?: HookPattern[];
}

// ============ 规则接口 ============

export interface RuleContext {
  file: string;
  allUsages: HookUsage[];
  budget: PerfBudget;
}

export interface RuleResult {
  isNecessary: boolean;
  reason: string;
  confidence: number;
  suggestion: string;
  refactored: string;
}

export interface PerfRule {
  id: string;
  pattern: HookPattern;
  description: string;
  check: (usage: HookUsage, context: RuleContext) => RuleResult;
  enabled?: boolean;
}

// ============ 工具函数 ============

export function generateUsageId(file: string, line: number, name: string): string {
  return `usage_${file}_${line}_${name}`;
}

export function generateSuggestionId(): string {
  return `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateReportId(): string {
  return `perf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function calculateScore(report: Pick<PerfReport, 'unnecessaryHooks' | 'budgetViolations' | 'suggestions' | 'estimatedBundleSize'>): number {
  let score = 100;
  score -= report.unnecessaryHooks * 2;
  score -= report.budgetViolations.length * 5;
  const highSeverity = report.suggestions.filter((s) => s.severity === 'high').length;
  score -= highSeverity * 5;
  if (report.estimatedBundleSize > 1024) {
    score -= Math.floor((report.estimatedBundleSize - 1024) / 100);
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreGrade(score: number): {
  grade: 'excellent' | 'good' | 'needs-improvement' | 'poor';
  label: string;
  icon: string;
  color: string;
} {
  if (score >= 90) return { grade: 'excellent', label: '优秀', icon: '🟢', color: '#16a34a' };
  if (score >= 75) return { grade: 'good', label: '良好', icon: '🟡', color: '#ca8a04' };
  if (score >= 60) return { grade: 'needs-improvement', label: '需改进', icon: '🟠', color: '#ea580c' };
  return { grade: 'poor', label: '差', icon: '🔴', color: '#dc2626' };
}
