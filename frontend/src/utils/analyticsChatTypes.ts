/**
 * # ============================================================
 * # Analytics Chat Types - 自然语言分析查询类型 (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 * # 核心作用：定义自然语言分析查询引擎的数据类型
 * # 参考：Claude Code Analytics Chat + Codex /analytics 命令
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-03 初次创建
 * # ============================================================
 */

// ============ 基础类型 ============

export type QueryType =
  | 'usage-by-team'
  | 'usage-by-model'
  | 'usage-by-skill'
  | 'cost-by-period'
  | 'top-skills'
  | 'top-models'
  | 'budget-status'
  | 'session-stats'
  | 'trend'
  | 'comparison'
  | 'unknown';

export type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'none';

export type AggregationPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

export type AnalyticsTimeRange = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'last90days' | 'all-time';

// ============ 数据集类型 ============

export interface UsageRecord {
  id: string;
  timestamp: number;
  model: string;
  /** sub-agent path */
  agentPath: string;
  /** team or group */
  team: string;
  /** project or workspace */
  project: string;
  /** skill name or 'chat' */
  skill: string;
  /** session id */
  sessionId: string;
  /** prompt tokens */
  promptTokens: number;
  /** completion tokens */
  completionTokens: number;
  /** total cost in USD */
  cost: number;
  /** success / error / timeout */
  status: 'success' | 'error' | 'timeout';
}

export interface BudgetStatus {
  budgetId: string;
  scope: 'request' | 'agent' | 'daily';
  limit: number;
  used: number;
  remaining: number;
  utilizationPercent: number;
  periodStart: number;
  periodEnd: number;
  alertLevel: 'normal' | 'warning' | 'critical' | 'exceeded';
}

// ============ 查询结果类型 ============

export interface ChartSpec {
  type: ChartType;
  title: string;
  xAxis?: { label: string; values: string[] };
  yAxis?: { label: string; values: number[] };
  series?: Array<{ name: string; values: number[]; color?: string }>;
  /** table 类型时使用 */
  rows?: Array<Record<string, string | number>>;
  columns?: string[];
}

export interface QueryResult {
  query: string;
  queryType: QueryType;
  answer: string;
  data: Record<string, unknown>;
  chartSpec?: ChartSpec;
  followUpQuestions: string[];
  executionTimeMs: number;
  timestamp: number;
}

// ============ 对话历史类型 ============

export interface ChatTurn {
  id: string;
  question: string;
  result: QueryResult;
  timestamp: number;
}

// ============ 事件类型 ============

export type AnalyticsEventType =
  | 'query-executed'
  | 'query-failed'
  | 'chart-generated'
  | 'data-exported'
  | 'history-cleared';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ============ 配置 ============

export interface AnalyticsConfig {
  /** 是否启用持久化 */
  persist: boolean;
  /** 最大对话历史 */
  maxHistoryTurns: number;
  /** 默认时间范围 */
  defaultTimeRange: AnalyticsTimeRange;
  /** 是否生成图表 */
  generateCharts: boolean;
  /** 是否启用 LLM 增强（当前使用规则引擎） */
  enableLlmEnhancement: boolean;
  /** 货币单位 */
  currency: string;
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  persist: true,
  maxHistoryTurns: 50,
  defaultTimeRange: 'last30days',
  generateCharts: true,
  enableLlmEnhancement: false,
  currency: 'USD',
};

// ============ 工具函数 ============

export const TIME_RANGE_MS: Record<AnalyticsTimeRange, number | null> = {
  today: 24 * 60 * 60 * 1000,
  yesterday: 24 * 60 * 60 * 1000,
  last7days: 7 * 24 * 60 * 60 * 1000,
  last30days: 30 * 24 * 60 * 60 * 1000,
  last90days: 90 * 24 * 60 * 60 * 1000,
  'all-time': null,
};

export const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  'usage-by-team': '按团队查询用量',
  'usage-by-model': '按模型查询用量',
  'usage-by-skill': '按技能查询用量',
  'cost-by-period': '按时间统计成本',
  'top-skills': '热门技能',
  'top-models': '热门模型',
  'budget-status': '预算状态',
  'session-stats': '会话统计',
  trend: '趋势分析',
  comparison: '对比分析',
  unknown: '未知查询',
};

export function generateAnalyticsId(prefix: string): string {
  return (
    'ana-' +
    prefix +
    '-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * 格式化货币
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    return '$' + amount.toFixed(4);
  }
  return amount.toFixed(2) + ' ' + currency;
}

/**
 * 格式化大数字
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toString();
}

/**
 * 提取时间范围
 */
export function detectTimeRange(question: string): AnalyticsTimeRange {
  const lower = question.toLowerCase();
  if (lower.includes('今天') || lower.includes('today')) return 'today';
  if (lower.includes('昨天') || lower.includes('yesterday')) return 'yesterday';
  if (
    lower.includes('一周') ||
    lower.includes('7 天') ||
    lower.includes('7天') ||
    lower.includes('last7days') ||
    lower.includes('7 day')
  )
    return 'last7days';
  if (
    lower.includes('30 天') ||
    lower.includes('30天') ||
    lower.includes('一个月') ||
    lower.includes('本月') ||
    lower.includes('last30days') ||
    lower.includes('30 day')
  )
    return 'last30days';
  if (
    lower.includes('90 天') ||
    lower.includes('90天') ||
    lower.includes('三个月') ||
    lower.includes('季度') ||
    lower.includes('last90days') ||
    lower.includes('90 day') ||
    lower.includes('quarter')
  )
    return 'last90days';
  if (lower.includes('全部') || lower.includes('所有') || lower.includes('all') || lower.includes('ever'))
    return 'all-time';
  return 'last30days';
}

/**
 * 检测查询类型
 */
export function detectQueryType(question: string): QueryType {
  const lower = question.toLowerCase();
  if (lower.includes('预算') || lower.includes('budget')) return 'budget-status';
  if (lower.includes('会话') || lower.includes('session')) return 'session-stats';
  if (lower.includes('对比') || lower.includes('比较') || lower.includes('compare') || lower.includes(' vs ')) return 'comparison';
  if (lower.includes('趋势') || lower.includes('trend') || lower.includes('变化')) return 'trend';
  // 优先按实体类型识别（先具体类别，再泛化类别）
  if (lower.includes('技能') || lower.includes('skill')) return 'usage-by-skill';
  if (lower.includes('模型') || lower.includes('model')) return 'usage-by-model';
  if (lower.includes('团队') || lower.includes('team')) return 'usage-by-team';
  // 兜底：成本/热门
  if (lower.includes('成本') || lower.includes('cost') || lower.includes('花费')) return 'cost-by-period';
  if (lower.includes('热门') || lower.includes('top ') || lower.includes('最多') || lower.includes('最常用')) return 'top-skills';
  return 'unknown';
}
