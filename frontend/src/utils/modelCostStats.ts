/**
 * # ============================================================
 * # ModelCostStats - 模型路由成本统计 (v1.0.0 Cycle 21 G21-03)
 * # ============================================================
 * # 核心作用：为 ModelRouter 提供成本统计能力，记录每次路由
 * #           决策的成本、token 消耗、模型分布，并提供 Dashboard 数据
 * # 业务价值：
 * #   1. 成本可视化：实时查看成本分布、趋势
 * #   2. 模型选型优化：识别"过度使用高端模型"场景
 * #   3. 预算规划：基于历史趋势预测月度成本
 * #   4. A/B 测试：对比不同路由模式的成本差异
 * # 运行流程：
 * #   1. recordRoute() - 记录单次路由决策
 * #   2. getStats() - 获取聚合统计
 * #   3. getDailyTrend() - 获取每日成本趋势
 * #   4. getModelRanking() - 获取模型成本排行
 * #   5. exportData() - 导出 JSON/CSV 格式
 * # 输入参数：
 * #   - ModelRoute: 路由决策（来自 ModelRouter）
 * #   - tokens: 实际 token 消耗
 * #   - cost: 实际成本
 * # 输出结果：
 * #   - ModelCostStats: 成本统计
 * #   - DailyCostEntry: 每日成本
 * #   - ModelCostEntry: 模型成本
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-03 初次创建
 * #     - 核心 ModelCostStats 引擎
 * #     - 5 种聚合维度（model/category/day/taskType/hour）
 * #     - 成本阈值告警
 * #     - 持久化（localStorage）
 * #     - 单例工厂
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 任务分类 */
export type TaskCategory =
  | 'code_generation'
  | 'code_review'
  | 'debugging'
  | 'documentation'
  | 'translation'
  | 'explanation'
  | 'refactoring'
  | 'testing'
  | 'analysis'
  | 'brainstorm'
  | 'unknown';

/** 路由模式 */
export type RoutingMode = 'cost' | 'balance' | 'intelligence' | 'speed';

/** 路由决策 */
export interface ModelRoute {
  model: string;
  category: TaskCategory;
  complexity: number;
  mode: RoutingMode;
  reason: string;
  candidates: Array<{ model: string; score: number; reason: string }>;
  timestamp: number;
}

/** 模型成本条目 */
export interface ModelCostEntry {
  model: string;
  count: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  avgComplexity: number;
  successRate: number;
  avgCostPerCall: number;
}

/** 分类成本条目 */
export interface CategoryCostEntry {
  category: TaskCategory;
  count: number;
  cost: number;
  topModel: string;
  avgCost: number;
}

/** 每日成本条目 */
export interface DailyCostEntry {
  date: string; // YYYY-MM-DD
  decisions: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, number>;
}

/** 成本统计 */
export interface ModelCostStats {
  totalDecisions: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Record<string, ModelCostEntry>;
  byCategory: Record<TaskCategory, CategoryCostEntry>;
  byMode: Record<RoutingMode, { count: number; cost: number }>;
  byDay: DailyCostEntry[];
  byHour: Array<{ hour: number; cost: number; decisions: number }>;
  costTrend: 'up' | 'down' | 'stable';
  trendDelta: number; // 百分比
  avgCostPerDecision: number;
  topModel: string;
  topCategory: TaskCategory;
  periodStart: number;
  periodEnd: number;
}

/** 告警配置 */
export interface CostAlertConfig {
  /** 单日成本阈值 */
  dailyThreshold?: number;
  /** 单次成本阈值 */
  perCallThreshold?: number;
  /** 月度预算 */
  monthlyBudget?: number;
  /** 告警回调 */
  onAlert?: (alert: CostAlert) => void;
}

/** 告警 */
export interface CostAlert {
  type: 'daily' | 'per-call' | 'monthly';
  threshold: number;
  actual: number;
  percent: number;
  message: string;
  timestamp: number;
}

/** 路由记录 */
export interface RouteRecord {
  route: ModelRoute;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  success: boolean;
  timestamp: number;
}

/** 过滤选项 */
export interface CostFilter {
  model?: string;
  category?: TaskCategory;
  mode?: RoutingMode;
  sinceMs?: number;
  untilMs?: number;
  successOnly?: boolean;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 获取日期字符串 YYYY-MM-DD
 */
function _dateStr(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取小时
 */
function _hour(timestamp: number): number {
  return new Date(timestamp).getHours();
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * ModelCostStats - 模型路由成本统计
 *
 * 记录每次路由决策的成本、token 消耗、模型分布，
 * 提供 Dashboard 数据、成本趋势、模型选型建议
 */
export class ModelCostStatsCollector {
  private records: Map<string, RouteRecord> = new Map();
  // 按日期分组
  private byDay: Map<string, RouteRecord[]> = new Map();
  // 按模型分组
  private byModel: Map<string, RouteRecord[]> = new Map();
  // 按分类分组
  private byCategory: Map<TaskCategory, RouteRecord[]> = new Map();
  // 按小时分组
  private byHour: Map<number, RouteRecord[]> = new Map();
  // 按模式分组
  private byMode: Map<RoutingMode, RouteRecord[]> = new Map();
  // 告警配置
  private alertConfig: CostAlertConfig = {};
  // 持久化键
  private readonly storageKey: string = 'hermes.model-cost-stats';
  // 最大记录数
  private readonly maxRecords: number = 10000;

  constructor() {
    this._loadFromStorage();
  }

  /**
   * 记录单次路由决策
   */
  recordRoute(record: Omit<RouteRecord, 'timestamp'> & { timestamp?: number }): RouteRecord {
    const fullRecord: RouteRecord = {
      ...record,
      timestamp: record.timestamp ?? Date.now(),
    };
    const id = _genId();
    this.records.set(id, fullRecord);

    // 索引
    this._index(fullRecord);

    // 限制最大记录数
    if (this.records.size > this.maxRecords) {
      this._evictOldest();
    }

    // 检查告警
    this._checkAlerts(fullRecord);

    // 持久化（防抖）
    this._schedulePersist();

    return fullRecord;
  }

  /**
   * 索引记录
   */
  private _index(record: RouteRecord): void {
    const day = _dateStr(record.timestamp);
    if (!this.byDay.has(day)) this.byDay.set(day, []);
    this.byDay.get(day)!.push(record);

    if (!this.byModel.has(record.route.model)) this.byModel.set(record.route.model, []);
    this.byModel.get(record.route.model)!.push(record);

    if (!this.byCategory.has(record.route.category)) this.byCategory.set(record.route.category, []);
    this.byCategory.get(record.route.category)!.push(record);

    const hour = _hour(record.timestamp);
    if (!this.byHour.has(hour)) this.byHour.set(hour, []);
    this.byHour.get(hour)!.push(record);

    if (!this.byMode.has(record.route.mode)) this.byMode.set(record.route.mode, []);
    this.byMode.get(record.route.mode)!.push(record);
  }

  /**
   * 驱逐最早记录
   */
  private _evictOldest(): void {
    const sorted = Array.from(this.records.values()).sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = sorted.slice(0, this.records.size - this.maxRecords);
    toRemove.forEach((r) => {
      // 找到并删除
      for (const [id, rec] of this.records.entries()) {
        if (rec === r) {
          this.records.delete(id);
          break;
        }
      }
    });
    // 重建索引
    this._rebuildIndexes();
  }

  /**
   * 重建索引
   */
  private _rebuildIndexes(): void {
    this.byDay.clear();
    this.byModel.clear();
    this.byCategory.clear();
    this.byHour.clear();
    this.byMode.clear();
    this.records.forEach((r) => this._index(r));
  }

  /**
   * 检查告警
   */
  private _checkAlerts(record: RouteRecord): void {
    if (!this.alertConfig.onAlert) return;

    // 单次成本告警
    if (this.alertConfig.perCallThreshold && record.cost > this.alertConfig.perCallThreshold) {
      this.alertConfig.onAlert({
        type: 'per-call',
        threshold: this.alertConfig.perCallThreshold,
        actual: record.cost,
        percent: (record.cost / this.alertConfig.perCallThreshold) * 100,
        message: `单次成本 $${record.cost.toFixed(4)} 超过阈值 $${this.alertConfig.perCallThreshold}`,
        timestamp: record.timestamp,
      });
    }

    // 单日成本告警
    if (this.alertConfig.dailyThreshold) {
      const day = _dateStr(record.timestamp);
      const dailyCost = (this.byDay.get(day) ?? []).reduce((sum, r) => sum + r.cost, 0);
      if (dailyCost > this.alertConfig.dailyThreshold) {
        this.alertConfig.onAlert({
          type: 'daily',
          threshold: this.alertConfig.dailyThreshold,
          actual: dailyCost,
          percent: (dailyCost / this.alertConfig.dailyThreshold) * 100,
          message: `单日成本 $${dailyCost.toFixed(4)} 超过阈值 $${this.alertConfig.dailyThreshold}`,
          timestamp: record.timestamp,
        });
      }
    }
  }

  /**
   * 持久化
   */
  private _schedulePersist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = {
        records: Array.from(this.records.entries()),
        savedAt: Date.now(),
      };
      // 简化处理：直接保存
      if (this.records.size % 10 === 0) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (err) {
      // 忽略存储错误
    }
  }

  /**
   * 从存储加载
   */
  private _loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.records && Array.isArray(data.records)) {
        data.records.forEach(([id, rec]: [string, RouteRecord]) => {
          this.records.set(id, rec);
          this._index(rec);
        });
      }
    } catch (err) {
      // 忽略加载错误
    }
  }

  /**
   * 设置告警配置
   */
  setAlertConfig(config: CostAlertConfig): void {
    this.alertConfig = config;
  }

  /**
   * 获取告警配置
   */
  getAlertConfig(): CostAlertConfig {
    return { ...this.alertConfig };
  }

  /**
   * 获取成本统计
   */
  getStats(filter: CostFilter = {}): ModelCostStats {
    const records = this._getFilteredRecords(filter);

    if (records.length === 0) {
      return {
        totalDecisions: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        byModel: {},
        byCategory: {} as Record<TaskCategory, CategoryCostEntry>,
        byMode: {
          cost: { count: 0, cost: 0 },
          balance: { count: 0, cost: 0 },
          intelligence: { count: 0, cost: 0 },
          speed: { count: 0, cost: 0 },
        },
        byDay: [],
        byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, cost: 0, decisions: 0 })),
        costTrend: 'stable',
        trendDelta: 0,
        avgCostPerDecision: 0,
        topModel: '',
        topCategory: 'unknown',
        periodStart: filter.sinceMs ?? 0,
        periodEnd: filter.untilMs ?? Date.now(),
      };
    }

    // 按模型聚合
    const byModel: Record<string, ModelCostEntry> = {};
    const byModelRecords = new Map<string, RouteRecord[]>();
    records.forEach((r) => {
      if (!byModelRecords.has(r.route.model)) byModelRecords.set(r.route.model, []);
      byModelRecords.get(r.route.model)!.push(r);
    });
    byModelRecords.forEach((recs, model) => {
      const totalCost = recs.reduce((sum, r) => sum + r.cost, 0);
      const inputTokens = recs.reduce((sum, r) => sum + r.inputTokens, 0);
      const outputTokens = recs.reduce((sum, r) => sum + r.outputTokens, 0);
      const successCount = recs.filter((r) => r.success).length;
      byModel[model] = {
        model,
        count: recs.length,
        cost: totalCost,
        inputTokens,
        outputTokens,
        avgComplexity:
          recs.reduce((sum, r) => sum + r.route.complexity, 0) / recs.length,
        successRate: successCount / recs.length,
        avgCostPerCall: totalCost / recs.length,
      };
    });

    // 按分类聚合
    const byCategory: Record<string, CategoryCostEntry> = {};
    const byCategoryRecords = new Map<TaskCategory, RouteRecord[]>();
    records.forEach((r) => {
      if (!byCategoryRecords.has(r.route.category)) byCategoryRecords.set(r.route.category, []);
      byCategoryRecords.get(r.route.category)!.push(r);
    });
    byCategoryRecords.forEach((recs, cat) => {
      const totalCost = recs.reduce((sum, r) => sum + r.cost, 0);
      // 找 top model
      const modelCount: Record<string, number> = {};
      recs.forEach((r) => {
        modelCount[r.route.model] = (modelCount[r.route.model] ?? 0) + 1;
      });
      const topModel = Object.entries(modelCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      byCategory[cat] = {
        category: cat,
        count: recs.length,
        cost: totalCost,
        topModel,
        avgCost: totalCost / recs.length,
      };
    });

    // 按模式聚合
    const byMode: Record<RoutingMode, { count: number; cost: number }> = {
      cost: { count: 0, cost: 0 },
      balance: { count: 0, cost: 0 },
      intelligence: { count: 0, cost: 0 },
      speed: { count: 0, cost: 0 },
    };
    records.forEach((r) => {
      byMode[r.route.mode].count += 1;
      byMode[r.route.mode].cost += r.cost;
    });

    // 按日聚合
    const dayMap = new Map<string, RouteRecord[]>();
    records.forEach((r) => {
      const day = _dateStr(r.timestamp);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(r);
    });
    const byDay: DailyCostEntry[] = Array.from(dayMap.entries())
      .map(([date, recs]) => {
        const byModelCost: Record<string, number> = {};
        recs.forEach((r) => {
          byModelCost[r.route.model] = (byModelCost[r.route.model] ?? 0) + r.cost;
        });
        return {
          date,
          decisions: recs.length,
          cost: recs.reduce((sum, r) => sum + r.cost, 0),
          inputTokens: recs.reduce((sum, r) => sum + r.inputTokens, 0),
          outputTokens: recs.reduce((sum, r) => sum + r.outputTokens, 0),
          byModel: byModelCost,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // 按小时聚合
    const hourMap = new Map<number, RouteRecord[]>();
    records.forEach((r) => {
      const h = _hour(r.timestamp);
      if (!hourMap.has(h)) hourMap.set(h, []);
      hourMap.get(h)!.push(r);
    });
    const byHour = Array.from({ length: 24 }, (_, h) => {
      const recs = hourMap.get(h) ?? [];
      return {
        hour: h,
        cost: recs.reduce((sum, r) => sum + r.cost, 0),
        decisions: recs.length,
      };
    });

    // 趋势计算（最近 7 天 vs 前 7 天）
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recent = records.filter((r) => r.timestamp >= now - sevenDaysMs);
    const previous = records.filter(
      (r) => r.timestamp >= now - 2 * sevenDaysMs && r.timestamp < now - sevenDaysMs
    );
    const recentCost = recent.reduce((sum, r) => sum + r.cost, 0);
    const previousCost = previous.reduce((sum, r) => sum + r.cost, 0);
    let costTrend: 'up' | 'down' | 'stable' = 'stable';
    let trendDelta = 0;
    if (previousCost > 0) {
      trendDelta = ((recentCost - previousCost) / previousCost) * 100;
      if (trendDelta > 5) costTrend = 'up';
      else if (trendDelta < -5) costTrend = 'down';
    } else if (recentCost > 0) {
      costTrend = 'up';
      trendDelta = 100;
    }

    // Top model / category
    const topModelEntry = Object.values(byModel).sort((a, b) => b.cost - a.cost)[0];
    const topCategoryEntry = Object.values(byCategory).sort((a, b) => b.cost - a.cost)[0];

    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    return {
      totalDecisions: records.length,
      totalCost,
      totalInputTokens: records.reduce((sum, r) => sum + r.inputTokens, 0),
      totalOutputTokens: records.reduce((sum, r) => sum + r.outputTokens, 0),
      byModel,
      byCategory: byCategory as Record<TaskCategory, CategoryCostEntry>,
      byMode,
      byDay,
      byHour,
      costTrend,
      trendDelta,
      avgCostPerDecision: totalCost / records.length,
      topModel: topModelEntry?.model ?? '',
      topCategory: topCategoryEntry?.category ?? 'unknown',
      periodStart: filter.sinceMs ?? records[0]?.timestamp ?? 0,
      periodEnd: filter.untilMs ?? records[records.length - 1]?.timestamp ?? Date.now(),
    };
  }

  /**
   * 获取过滤后的记录
   */
  private _getFilteredRecords(filter: CostFilter): RouteRecord[] {
    let result = Array.from(this.records.values());

    if (filter.model) {
      result = result.filter((r) => r.route.model === filter.model);
    }
    if (filter.category) {
      result = result.filter((r) => r.route.category === filter.category);
    }
    if (filter.mode) {
      result = result.filter((r) => r.route.mode === filter.mode);
    }
    if (filter.sinceMs) {
      result = result.filter((r) => r.timestamp >= filter.sinceMs!);
    }
    if (filter.untilMs) {
      result = result.filter((r) => r.timestamp <= filter.untilMs!);
    }
    if (filter.successOnly) {
      result = result.filter((r) => r.success);
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 获取每日成本趋势
   */
  getDailyTrend(days: number = 30): DailyCostEntry[] {
    const now = Date.now();
    const since = now - days * 24 * 60 * 60 * 1000;
    const stats = this.getStats({ sinceMs: since });
    return stats.byDay;
  }

  /**
   * 获取模型成本排行
   */
  getModelRanking(filter: CostFilter = {}): ModelCostEntry[] {
    const stats = this.getStats(filter);
    return Object.values(stats.byModel).sort((a, b) => b.cost - a.cost);
  }

  /**
   * 获取记录列表
   */
  getRecords(filter: CostFilter = {}, limit?: number): RouteRecord[] {
    let result = this._getFilteredRecords(filter);
    if (limit) result = result.slice(-limit);
    return result;
  }

  /**
   * 导出数据
   */
  exportData(format: 'json' | 'csv' = 'json', filter: CostFilter = {}): string {
    if (format === 'json') {
      const stats = this.getStats(filter);
      return JSON.stringify(stats, null, 2);
    }
    if (format === 'csv') {
      const records = this._getFilteredRecords(filter);
      const headers = ['timestamp', 'model', 'category', 'mode', 'complexity', 'input_tokens', 'output_tokens', 'cost', 'success'];
      const rows = records.map((r) =>
        [
          new Date(r.timestamp).toISOString(),
          r.route.model,
          r.route.category,
          r.route.mode,
          r.route.complexity,
          r.inputTokens,
          r.outputTokens,
          r.cost.toFixed(6),
          r.success,
        ].join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }
    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * 清除记录
   */
  clear(filter: CostFilter = {}): number {
    if (Object.keys(filter).length === 0) {
      const count = this.records.size;
      this.records.clear();
      this.byDay.clear();
      this.byModel.clear();
      this.byCategory.clear();
      this.byHour.clear();
      this.byMode.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.storageKey);
      }
      return count;
    }
    const toDelete = this._getFilteredRecords(filter);
    toDelete.forEach((r) => {
      for (const [id, rec] of this.records.entries()) {
        if (rec === r) {
          this.records.delete(id);
          break;
        }
      }
    });
    this._rebuildIndexes();
    this._schedulePersist();
    return toDelete.length;
  }

  /**
   * 获取统计
   */
  getCollectorStats(): {
    totalRecords: number;
    byDayCount: number;
    byModelCount: number;
    byCategoryCount: number;
  } {
    return {
      totalRecords: this.records.size,
      byDayCount: this.byDay.size,
      byModelCount: this.byModel.size,
      byCategoryCount: this.byCategory.size,
    };
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: ModelCostStatsCollector | null = null;

/**
 * 获取 ModelCostStatsCollector 单例
 */
export function getModelCostStats(): ModelCostStatsCollector {
  if (!_instance) {
    _instance = new ModelCostStatsCollector();
  }
  return _instance;
}

/**
 * 重置 ModelCostStatsCollector 单例
 */
export function resetModelCostStats(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isModelCostStatsInitialized(): boolean {
  return _instance !== null;
}
