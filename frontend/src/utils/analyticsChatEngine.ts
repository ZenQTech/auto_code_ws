/**
 * # ============================================================
 * # Analytics Chat Engine - 自然语言分析查询 (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 * # 核心作用：自然语言查询用量数据 + 图表生成 + 数据导出
 * # 运行流程：
 * #   1. query(question) 解析问句 -> 检测时间范围/查询类型
 * #   2. 根据类型聚合 UsageRecord 数据
 * #   3. 生成 ChartSpec（bar/line/pie/table）
 * #   4. 推断 followUpQuestions
 * #   5. 事件总线通知 + 历史记录
 * # 输入参数：query(question) / generateChart(data, type) / exportData(result, format)
 * # 输出结果：QueryResult / ChartSpec / CSV/JSON 字符串
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-03 初次创建
 * # ============================================================
 */

import {
  UsageRecord,
  BudgetStatus,
  QueryResult,
  ChartSpec,
  ChartType,
  AnalyticsEvent,
  AnalyticsEventType,
  AnalyticsConfig,
  AnalyticsTimeRange,
  ChatTurn,
  DEFAULT_ANALYTICS_CONFIG,
  TIME_RANGE_MS,
  detectQueryType,
  detectTimeRange,
  formatCurrency,
  formatNumber,
  generateAnalyticsId,
} from './analyticsChatTypes';
import { generateSampleUsageData, SAMPLE_BUDGETS } from './analyticsChatSamples';

/**
 * AnalyticsChat 分析聊天引擎
 */
export class AnalyticsChat {
  private config: AnalyticsConfig;
  private usageData: UsageRecord[] = [];
  private budgets: BudgetStatus[] = [];
  private history: ChatTurn[] = [];
  private listeners: Map<AnalyticsEventType, Set<(e: AnalyticsEvent) => void>> = new Map();
  private storageKey = 'hermes.analyticsChat';

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    this.initializeData();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw =
        typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.history)) {
          this.history = data.history.slice(-this.config.maxHistoryTurns);
        }
        if (data && Array.isArray(data.budgets)) {
          this.budgets = data.budgets;
        }
      }
    } catch (e) {
      console.warn('AnalyticsChat: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        history: this.history.slice(-this.config.maxHistoryTurns),
        budgets: this.budgets,
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('AnalyticsChat: failed to save', e);
    }
  }

  private initializeData(): void {
    if (this.usageData.length === 0) {
      this.usageData = generateSampleUsageData(1200);
    }
    if (this.budgets.length === 0) {
      this.budgets = [...SAMPLE_BUDGETS];
    }
  }

  // ============ 事件总线 ============

  on(event: AnalyticsEventType, listener: (e: AnalyticsEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: AnalyticsEventType, listener: (e: AnalyticsEvent) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: AnalyticsEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (e) {
          console.error('AnalyticsChat listener error:', e);
        }
      }
    }
  }

  // ============ 核心 API ============

  /**
   * 自然语言查询
   */
  async query(question: string): Promise<QueryResult> {
    const startTime = Date.now();
    try {
      const timeRange = detectTimeRange(question);
      const queryType = detectQueryType(question);
      const records = this.filterByTimeRange(this.usageData, timeRange);

      let result: QueryResult;
      switch (queryType) {
        case 'usage-by-team':
          result = this.queryUsageByTeam(question, records, timeRange);
          break;
        case 'usage-by-model':
          result = this.queryUsageByModel(question, records, timeRange);
          break;
        case 'usage-by-skill':
          result = this.queryUsageBySkill(question, records, timeRange);
          break;
        case 'cost-by-period':
          result = this.queryCostByPeriod(question, records, timeRange);
          break;
        case 'top-skills':
          result = this.queryTopSkills(question, records, timeRange);
          break;
        case 'top-models':
          result = this.queryTopModels(question, records, timeRange);
          break;
        case 'budget-status':
          result = this.queryBudgetStatus(question);
          break;
        case 'session-stats':
          result = this.querySessionStats(question, records, timeRange);
          break;
        case 'trend':
          result = this.queryTrend(question, records, timeRange);
          break;
        case 'comparison':
          result = this.queryComparison(question, records, timeRange);
          break;
        default:
          result = this.queryUnknown(question, records, timeRange);
      }

      result.executionTimeMs = Date.now() - startTime;
      result.timestamp = Date.now();

      // 添加到历史
      const turn: ChatTurn = {
        id: generateAnalyticsId('turn'),
        question,
        result,
        timestamp: Date.now(),
      };
      this.history.push(turn);
      if (this.history.length > this.config.maxHistoryTurns) {
        this.history = this.history.slice(-this.config.maxHistoryTurns);
      }
      this.save();

      this.emit({
        type: 'query-executed',
        timestamp: Date.now(),
        data: { queryType, question, executionTimeMs: result.executionTimeMs },
      });
      if (result.chartSpec) {
        this.emit({
          type: 'chart-generated',
          timestamp: Date.now(),
          data: { chartType: result.chartSpec.type },
        });
      }
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.emit({
        type: 'query-failed',
        timestamp: Date.now(),
        data: { question, error: errMsg },
      });
      throw e;
    }
  }

  // ============ 查询实现 ============

  private filterByTimeRange(records: UsageRecord[], range: AnalyticsTimeRange): UsageRecord[] {
    if (range === 'all-time') return records;
    const rangeMs = TIME_RANGE_MS[range];
    if (rangeMs === null) return records;
    const cutoff = Date.now() - rangeMs;
    return records.filter((r) => r.timestamp >= cutoff);
  }

  private queryUsageByTeam(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const grouped = new Map<string, { cost: number; tokens: number; count: number }>();
    for (const r of records) {
      const cur = grouped.get(r.team) ?? { cost: 0, tokens: 0, count: 0 };
      cur.cost += r.cost;
      cur.tokens += r.promptTokens + r.completionTokens;
      cur.count += 1;
      grouped.set(r.team, cur);
    }
    const sorted = Array.from(grouped.entries())
      .map(([team, v]) => ({ team, ...v }))
      .sort((a, b) => b.cost - a.cost);
    const top = sorted[0];
    const answer = top
      ? `${timeRange} 内，${top.team} 用了 ${formatCurrency(top.cost)}（${formatNumber(top.tokens)} tokens, ${top.count} 次调用），排名第一。`
      : '没有数据。';

    return {
      query: question,
      queryType: 'usage-by-team',
      answer,
      data: { teams: sorted },
      chartSpec: this.config.generateCharts
        ? {
            type: 'bar',
            title: '按团队用量统计',
            xAxis: { label: 'Team', values: sorted.map((s) => s.team) },
            yAxis: { label: 'Cost (USD)', values: sorted.map((s) => Math.round(s.cost * 100) / 100) },
            series: [{ name: 'Cost', values: sorted.map((s) => s.cost) }],
          }
        : undefined,
      followUpQuestions: [
        `${top?.team ?? ''} 用得最多的模型是什么？`,
        `${top?.team ?? ''} 用了哪些技能？`,
        '对比 frontend-team 和 backend-team 的成本',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryUsageByModel(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const grouped = new Map<string, { cost: number; tokens: number; count: number }>();
    for (const r of records) {
      const cur = grouped.get(r.model) ?? { cost: 0, tokens: 0, count: 0 };
      cur.cost += r.cost;
      cur.tokens += r.promptTokens + r.completionTokens;
      cur.count += 1;
      grouped.set(r.model, cur);
    }
    const sorted = Array.from(grouped.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost);
    const top = sorted[0];
    const answer = top
      ? `${timeRange} 内，${top.model} 成本 ${formatCurrency(top.cost)}，调用 ${top.count} 次。`
      : '没有数据。';

    return {
      query: question,
      queryType: 'usage-by-model',
      answer,
      data: { models: sorted },
      chartSpec: this.config.generateCharts
        ? {
            type: 'pie',
            title: '按模型成本占比',
            xAxis: { label: 'Model', values: sorted.map((s) => s.model) },
            yAxis: { label: 'Cost', values: sorted.map((s) => Math.round(s.cost * 100) / 100) },
            series: [{ name: 'Cost', values: sorted.map((s) => s.cost) }],
          }
        : undefined,
      followUpQuestions: [
        `哪个团队用 ${top?.model ?? ''} 最多？`,
        `${top?.model ?? ''} 和其他模型的对比`,
        '最近 7 天的模型使用趋势',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryUsageBySkill(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const grouped = new Map<string, { cost: number; tokens: number; count: number }>();
    for (const r of records) {
      const cur = grouped.get(r.skill) ?? { cost: 0, tokens: 0, count: 0 };
      cur.cost += r.cost;
      cur.tokens += r.promptTokens + r.completionTokens;
      cur.count += 1;
      grouped.set(r.skill, cur);
    }
    const sorted = Array.from(grouped.entries())
      .map(([skill, v]) => ({ skill, ...v }))
      .sort((a, b) => b.count - a.count);
    const top = sorted[0];
    const targetSkill = this.extractSkillName(question);
    let answer: string;
    if (targetSkill) {
      const found = sorted.find((s) => s.skill === targetSkill);
      answer = found
        ? `${targetSkill} 累计调用 ${found.count} 次，成本 ${formatCurrency(found.cost)}。`
        : `没有找到技能 ${targetSkill} 的数据。`;
    } else {
      answer = top
        ? `${timeRange} 内，${top.skill} 调用 ${top.count} 次，排名第一。`
        : '没有数据。';
    }

    return {
      query: question,
      queryType: 'usage-by-skill',
      answer,
      data: { skills: sorted },
      chartSpec: this.config.generateCharts
        ? {
            type: 'bar',
            title: '按技能调用次数',
            xAxis: { label: 'Skill', values: sorted.map((s) => s.skill) },
            yAxis: { label: 'Count', values: sorted.map((s) => s.count) },
            series: [{ name: 'Count', values: sorted.map((s) => s.count) }],
          }
        : undefined,
      followUpQuestions: [
        `${top?.skill ?? ''} 的成本是多少？`,
        '哪个技能增长最快？',
        '未启用的技能有哪些？',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryCostByPeriod(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = records.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);
    const answer = `${timeRange} 内，总成本 ${formatCurrency(totalCost)}，总 token ${formatNumber(totalTokens)}。`;

    // 按天聚合趋势
    const dailyMap = new Map<string, number>();
    for (const r of records) {
      const day = new Date(r.timestamp).toISOString().slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + r.cost);
    }
    const days = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b));

    return {
      query: question,
      queryType: 'cost-by-period',
      answer,
      data: { totalCost, totalTokens, dailyBreakdown: days },
      chartSpec: this.config.generateCharts
        ? {
            type: 'line',
            title: `${timeRange} 成本趋势`,
            xAxis: { label: 'Date', values: days.map(([d]) => d) },
            yAxis: { label: 'Cost', values: days.map(([, v]) => Math.round(v * 100) / 100) },
            series: [{ name: 'Cost', values: days.map(([, v]) => v) }],
          }
        : undefined,
      followUpQuestions: [
        '哪个模型成本最高？',
        '哪个团队贡献了最多成本？',
        '本月预算使用率是多少？',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryTopSkills(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    return this.queryUsageBySkill(question, records, timeRange);
  }

  private queryTopModels(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    return this.queryUsageByModel(question, records, timeRange);
  }

  private queryBudgetStatus(question: string): QueryResult {
    const sorted = [...this.budgets].sort((a, b) => b.utilizationPercent - a.utilizationPercent);
    const top = sorted[0];
    const answer = top
      ? `${top.budgetId}（${top.scope}）已使用 ${formatCurrency(top.used)} / ${formatCurrency(top.limit)}，利用率 ${top.utilizationPercent.toFixed(1)}%（${top.alertLevel}）。`
      : '没有预算数据。';

    return {
      query: question,
      queryType: 'budget-status',
      answer,
      data: { budgets: sorted },
      chartSpec: this.config.generateCharts
        ? {
            type: 'bar',
            title: '预算使用率',
            xAxis: { label: 'Budget', values: sorted.map((b) => b.budgetId) },
            yAxis: { label: 'Utilization %', values: sorted.map((b) => b.utilizationPercent) },
            series: [{ name: 'Utilization', values: sorted.map((b) => b.utilizationPercent) }],
          }
        : undefined,
      followUpQuestions: [
        '哪些预算超限了？',
        '本月预算还能用多久？',
        '降低预算的建议',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private querySessionStats(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const sessions = new Set(records.map((r) => r.sessionId));
    const successCount = records.filter((r) => r.status === 'success').length;
    const errorCount = records.filter((r) => r.status === 'error').length;
    const timeoutCount = records.filter((r) => r.status === 'timeout').length;
    const totalCount = records.length;
    const answer = `${timeRange} 内，${sessions.size} 个会话，${totalCount} 次请求（成功 ${successCount} / 失败 ${errorCount} / 超时 ${timeoutCount}），成功率 ${((successCount / totalCount) * 100).toFixed(1)}%。`;

    return {
      query: question,
      queryType: 'session-stats',
      answer,
      data: { sessionCount: sessions.size, totalCount, successCount, errorCount, timeoutCount },
      chartSpec: this.config.generateCharts
        ? {
            type: 'pie',
            title: '请求状态分布',
            xAxis: { label: 'Status', values: ['success', 'error', 'timeout'] },
            yAxis: { label: 'Count', values: [successCount, errorCount, timeoutCount] },
            series: [{ name: 'Status', values: [successCount, errorCount, timeoutCount] }],
          }
        : undefined,
      followUpQuestions: [
        '失败最多的会话是哪个？',
        '请求延迟分布如何？',
        '本周会话增长趋势',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryTrend(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    return this.queryCostByPeriod(question, records, timeRange);
  }

  private queryComparison(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const grouped = new Map<string, number>();
    for (const r of records) {
      grouped.set(r.team, (grouped.get(r.team) ?? 0) + r.cost);
    }
    const sorted = Array.from(grouped.entries())
      .map(([team, cost]) => ({ team, cost }))
      .sort((a, b) => b.cost - a.cost);
    const top = sorted[0];
    const second = sorted[1];
    const answer = top && second
      ? `${timeRange} 内，${top.team}（${formatCurrency(top.cost)}）比 ${second.team}（${formatCurrency(second.cost)}）多 ${formatCurrency(top.cost - second.cost)}。`
      : '数据不足，无法对比。';

    return {
      query: question,
      queryType: 'comparison',
      answer,
      data: { teams: sorted },
      chartSpec: this.config.generateCharts
        ? {
            type: 'bar',
            title: '团队成本对比',
            xAxis: { label: 'Team', values: sorted.map((s) => s.team) },
            yAxis: { label: 'Cost', values: sorted.map((s) => Math.round(s.cost * 100) / 100) },
            series: [{ name: 'Cost', values: sorted.map((s) => s.cost) }],
          }
        : undefined,
      followUpQuestions: [
        '差异的主要原因是什么？',
        '如何缩小差距？',
        '未来一周的趋势预测',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  private queryUnknown(
    question: string,
    records: UsageRecord[],
    timeRange: AnalyticsTimeRange
  ): QueryResult {
    const total = records.length;
    const answer = `未识别的查询类型。可尝试：\n• "${timeRange} 内每个团队的用量"\n• "哪个模型成本最高？"\n• "code-review 技能累计调用次数？"\n• "今天的预算使用率？"\n（共 ${total} 条可用数据记录）`;

    return {
      query: question,
      queryType: 'unknown',
      answer,
      data: {},
      followUpQuestions: [
        '按团队查询用量',
        '按模型查询用量',
        '今天的预算使用率',
        '热门技能',
      ],
      executionTimeMs: 0,
      timestamp: 0,
    };
  }

  // ============ 工具方法 ============

  private extractSkillName(question: string): string | null {
    const lower = question.toLowerCase();
    for (const skill of ['code-review', 'refactor-assistant', 'test-generator', 'doc-generator', 'security-scanner', 'ci-cd-pipeline', 'api-design']) {
      if (lower.includes(skill)) return skill;
    }
    return null;
  }

  /**
   * 生成图表
   */
  generateChart(_data: QueryResult['data'], type: ChartType, title: string = 'Chart'): ChartSpec {
    return {
      type,
      title,
      xAxis: { label: 'X', values: [] },
      yAxis: { label: 'Y', values: [] },
      series: [],
    };
  }

  /**
   * 导出数据
   */
  exportData(result: QueryResult, format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(result, null, 2);
    }
    // CSV
    const data = result.data as Record<string, unknown>;
    const rows: string[] = [];
    if (Array.isArray(data.teams)) {
      rows.push('team,cost,tokens,count');
      for (const t of data.teams as Array<{ team: string; cost: number; tokens: number; count: number }>) {
        rows.push(`${t.team},${t.cost.toFixed(4)},${t.tokens},${t.count}`);
      }
    } else if (Array.isArray(data.models)) {
      rows.push('model,cost,tokens,count');
      for (const m of data.models as Array<{ model: string; cost: number; tokens: number; count: number }>) {
        rows.push(`${m.model},${m.cost.toFixed(4)},${m.tokens},${m.count}`);
      }
    } else if (Array.isArray(data.skills)) {
      rows.push('skill,cost,tokens,count');
      for (const s of data.skills as Array<{ skill: string; cost: number; tokens: number; count: number }>) {
        rows.push(`${s.skill},${s.cost.toFixed(4)},${s.tokens},${s.count}`);
      }
    } else if (Array.isArray(data.budgets)) {
      rows.push('budgetId,scope,used,limit,utilization,alertLevel');
      for (const b of data.budgets as BudgetStatus[]) {
        rows.push(`${b.budgetId},${b.scope},${b.used},${b.limit},${b.utilizationPercent},${b.alertLevel}`);
      }
    } else {
      rows.push('key,value');
      for (const [k, v] of Object.entries(data)) {
        rows.push(`${k},${JSON.stringify(v)}`);
      }
    }
    this.emit({
      type: 'data-exported',
      timestamp: Date.now(),
      data: { format, queryType: result.queryType },
    });
    return rows.join('\n');
  }

  // ============ 历史管理 ============

  getHistory(): ChatTurn[] {
    return this.history.slice();
  }

  clearHistory(): void {
    this.history = [];
    this.save();
    this.emit({ type: 'history-cleared', timestamp: Date.now() });
  }

  deleteTurn(turnId: string): void {
    this.history = this.history.filter((t) => t.id !== turnId);
    this.save();
  }

  // ============ 数据管理 ============

  addUsageRecord(record: UsageRecord): void {
    this.usageData.push(record);
  }

  setBudgets(budgets: BudgetStatus[]): void {
    this.budgets = budgets;
    this.save();
  }

  getUsageData(): UsageRecord[] {
    return this.usageData.slice();
  }

  getBudgets(): BudgetStatus[] {
    return this.budgets.slice();
  }

  // ============ 建议查询 ============

  getSuggestedQueries(): string[] {
    return [
      '上个季度哪个团队用了最多 token？',
      'code-review 技能累计调用次数？',
      '哪个模型成本最高？',
      '今天的预算使用率？',
      '本周会话统计',
      'frontend-team 和 backend-team 的成本对比',
    ];
  }
}

// ============ 全局单例 ============

let _defaultAnalyticsChat: AnalyticsChat | null = null;

export function getDefaultAnalyticsChat(): AnalyticsChat {
  if (!_defaultAnalyticsChat) {
    _defaultAnalyticsChat = new AnalyticsChat();
  }
  return _defaultAnalyticsChat;
}

export function resetDefaultAnalyticsChat(): void {
  _defaultAnalyticsChat = null;
}
