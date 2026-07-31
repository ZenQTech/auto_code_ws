/**
 * # ============================================================
 * # RAGMonitor - RAG 质量评估与监控 (v1.0.0 Cycle 46 G46-02)
 * # ============================================================
 * # 核心作用：对 RAG 系统的质量、性能、成本进行全方位监控
 * #           - 检索质量评估：命中率 / Top-K 准确率 / 引用准确率
 * #           - 性能监控：检索延迟 / LLM 延迟 / 总延迟 / 吞吐量
 * #           - 成本统计：Token 用量 / 按 Provider 拆分 / 单查询成本
 * #           - 告警系统：阈值告警 / 异常检测 / 趋势分析
 * #           - 历史记录：可查询 / 可回放 / 可导出
 * #           - 仪表盘数据：实时聚合 / 时间窗口 / 多维度
 * # 对标产品：LangSmith / LangFuse / Helicone / Phoenix
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 46 G46-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 监控配置
 */
export interface RAGMonitorConfig {
  /** 最大历史记录数（默认 10000） */
  maxHistory?: number;
  /** 时间窗口大小（毫秒，默认 60_000） */
  windowSizeMs?: number;
  /** 告警阈值 */
  thresholds?: {
    /** 最大延迟（毫秒，默认 5000） */
    maxLatencyMs?: number;
    /** 最小命中率（0-1，默认 0.5） */
    minHitRate?: number;
    /** 最大单查询成本（USD，默认 0.5） */
    maxCostPerQuery?: number;
    /** 最大错误率（0-1，默认 0.1） */
    maxErrorRate?: number;
  };
}

/**
 * 单次查询记录
 */
export interface RAGQueryRecord {
  /** 记录 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 查询 */
  query: string;
  /** 命中数 */
  hitCount: number;
  /** Top-K */
  topK: number;
  /** 是否成功 */
  success: boolean;
  /** Provider */
  provider: string;
  /** Token 用量 */
  tokens: { input: number; output: number; total: number };
  /** 成本 */
  cost: number;
  /** 耗时分解 */
  latency: { retrievalMs: number; llmMs: number; totalMs: number };
  /** 引用数 */
  citationCount: number;
  /** 错误信息（如果有） */
  error?: string;
  /** 自定义标签 */
  tags?: Record<string, string>;
}

/**
 * 命中质量评估
 */
export interface HitQualityAssessment {
  /** 记录 ID */
  recordId: string;
  /** Top-K 准确率（实际命中的相关性分数，0-1） */
  topKAccuracy: number;
  /** 是否有相关结果（任何分数 > 0.5） */
  hasRelevant: boolean;
  /** 最佳命中分数 */
  bestScore: number;
  /** 平均命中分数 */
  avgScore: number;
  /** 引用准确率（实际引用的命中比例，0-1） */
  citationAccuracy: number;
}

/**
 * 时间窗口聚合
 */
export interface WindowAggregation {
  /** 窗口开始时间 */
  startTime: number;
  /** 窗口结束时间 */
  endTime: number;
  /** 查询数 */
  queryCount: number;
  /** 成功率 */
  successRate: number;
  /** 平均命中率 */
  avgHitRate: number;
  /** 平均延迟（毫秒） */
  avgLatencyMs: number;
  /** P50 延迟（毫秒） */
  p50LatencyMs: number;
  /** P95 延迟（毫秒） */
  p95LatencyMs: number;
  /** P99 延迟（毫秒） */
  p99LatencyMs: number;
  /** 总 Token 用量 */
  totalTokens: number;
  /** 总成本 */
  totalCost: number;
  /** 平均引用数 */
  avgCitations: number;
}

/**
 * 告警事件
 */
export interface AlertEvent {
  /** 告警 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 严重程度 */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** 告警类型 */
  type: 'latency' | 'hit-rate' | 'cost' | 'error-rate' | 'token-usage';
  /** 告警消息 */
  message: string;
  /** 当前值 */
  currentValue: number;
  /** 阈值 */
  threshold: number;
  /** 受影响的查询 ID 列表 */
  affectedQueryIds?: string[];
}

/**
 * 监控事件
 */
export type RAGMonitorEvent =
  | { type: 'record-added'; record: RAGQueryRecord; at: number }
  | { type: 'alert'; alert: AlertEvent; at: number }
  | { type: 'quality-assessed'; assessment: HitQualityAssessment; at: number }
  | { type: 'history-cleared'; clearedCount: number; at: number };

export type RAGMonitorListener = (event: RAGMonitorEvent) => void;

/**
 * 监控统计
 */
export interface RAGMonitorStats {
  totalRecords: number;
  successCount: number;
  failureCount: number;
  totalTokensUsed: number;
  totalCost: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalHits: number;
  avgHitRate: number;
  totalCitations: number;
  avgCitationCount: number;
  alertCount: number;
  criticalAlertCount: number;
  errorRate: number;
  byProvider: Record<string, { count: number; tokens: number; cost: number; avgLatencyMs: number }>;
  byHour: Array<{ hour: string; count: number; cost: number; latencyMs: number }>;
}

// ============ 工具函数 ============

/**
 * 计算百分位数
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

/**
 * 生成 ID
 */
function genId(prefix: string = 'rag'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ RAGMonitor 主类 ============

/**
 * RAG 质量评估与监控系统
 */
export class RAGMonitor {
  private readonly config: {
    maxHistory: number;
    windowSizeMs: number;
    thresholds: {
      maxLatencyMs: number;
      minHitRate: number;
      maxCostPerQuery: number;
      maxErrorRate: number;
    };
  };
  /** 查询历史 */
  private readonly history: RAGQueryRecord[] = [];
  /** 质量评估 */
  private readonly qualityMap: Map<string, HitQualityAssessment> = new Map();
  /** 告警历史 */
  private readonly alerts: AlertEvent[] = [];
  /** 事件监听器 */
  private readonly listeners: Set<RAGMonitorListener> = new Set();
  /** 上次窗口刷新时间 */
  private lastWindowFlush: number = Date.now();
  /** 窗口聚合缓存 */
  private windowCache: WindowAggregation | null = null;

  constructor(config: RAGMonitorConfig = {}) {
    this.config = {
      maxHistory: config.maxHistory ?? 10000,
      windowSizeMs: config.windowSizeMs ?? 60_000,
      thresholds: {
        maxLatencyMs: config.thresholds?.maxLatencyMs ?? 5000,
        minHitRate: config.thresholds?.minHitRate ?? 0.5,
        maxCostPerQuery: config.thresholds?.maxCostPerQuery ?? 0.5,
        maxErrorRate: config.thresholds?.maxErrorRate ?? 0.1,
      },
    };
  }

  // ============ 事件订阅 ============

  on(listener: RAGMonitorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RAGMonitorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // ignore
      }
    }
  }

  // ============ 记录管理 ============

  /**
   * 记录一次 RAG 查询
   */
  record(record: Omit<RAGQueryRecord, 'id' | 'timestamp'>): RAGQueryRecord {
    const fullRecord: RAGQueryRecord = {
      id: genId('rec'),
      timestamp: Date.now(),
      ...record,
    };
    this.history.push(fullRecord);

    // 超过上限，淘汰最旧
    while (this.history.length > this.config.maxHistory) {
      const removed = this.history.shift();
      if (removed) this.qualityMap.delete(removed.id);
    }

    this.emit({ type: 'record-added', record: fullRecord, at: fullRecord.timestamp });

    // 检查告警
    this.checkAlerts(fullRecord);

    return fullRecord;
  }

  /**
   * 评估命中质量
   */
  assessQuality(recordId: string, assessment: Omit<HitQualityAssessment, 'recordId'>): HitQualityAssessment {
    const full: HitQualityAssessment = { recordId, ...assessment };
    this.qualityMap.set(recordId, full);
    this.emit({ type: 'quality-assessed', assessment: full, at: Date.now() });
    return full;
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    const cleared = this.history.length;
    this.history.length = 0;
    this.qualityMap.clear();
    this.alerts.length = 0;
    this.emit({ type: 'history-cleared', clearedCount: cleared, at: Date.now() });
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number, sinceMs?: number): RAGQueryRecord[] {
    let arr = this.history;
    if (sinceMs !== undefined) {
      arr = arr.filter((r) => r.timestamp >= sinceMs);
    }
    if (limit !== undefined) {
      arr = arr.slice(-limit);
    }
    return [...arr];
  }

  /**
   * 获取质量评估
   */
  getQualityAssessment(recordId: string): HitQualityAssessment | undefined {
    return this.qualityMap.get(recordId);
  }

  /**
   * 获取告警
   */
  getAlerts(limit?: number, severity?: AlertEvent['severity']): AlertEvent[] {
    let arr = this.alerts;
    if (severity) {
      arr = arr.filter((a) => a.severity === severity);
    }
    if (limit !== undefined) {
      arr = arr.slice(-limit);
    }
    return [...arr];
  }

  // ============ 聚合分析 ============

  /**
   * 获取整体统计
   */
  getStats(): RAGMonitorStats {
    if (this.history.length === 0) {
      return {
        totalRecords: 0,
        successCount: 0,
        failureCount: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        totalHits: 0,
        avgHitRate: 0,
        totalCitations: 0,
        avgCitationCount: 0,
        alertCount: 0,
        criticalAlertCount: 0,
        errorRate: 0,
        byProvider: {},
        byHour: [],
      };
    }

    const successCount = this.history.filter((r) => r.success).length;
    const totalLatencies = this.history.map((r) => r.latency.totalMs).sort((a, b) => a - b);
    const totalHits = this.history.reduce((s, r) => s + r.hitCount, 0);
    const totalCitations = this.history.reduce((s, r) => s + r.citationCount, 0);
    const totalTokens = this.history.reduce((s, r) => s + r.tokens.total, 0);
    const totalCost = this.history.reduce((s, r) => s + r.cost, 0);
    const totalLatency = totalLatencies.reduce((s, n) => s + n, 0);

    // 按 Provider 聚合
    const byProvider: Record<string, { count: number; tokens: number; cost: number; avgLatencyMs: number }> = {};
    for (const r of this.history) {
      if (!byProvider[r.provider]) {
        byProvider[r.provider] = { count: 0, tokens: 0, cost: 0, avgLatencyMs: 0 };
      }
      const p = byProvider[r.provider];
      p.count += 1;
      p.tokens += r.tokens.total;
      p.cost += r.cost;
      p.avgLatencyMs = (p.avgLatencyMs * (p.count - 1) + r.latency.totalMs) / p.count;
    }

    // 按小时聚合
    const hourMap = new Map<string, { count: number; cost: number; latencyMs: number }>();
    for (const r of this.history) {
      const hour = new Date(r.timestamp).toISOString().slice(0, 13) + ':00';
      if (!hourMap.has(hour)) {
        hourMap.set(hour, { count: 0, cost: 0, latencyMs: 0 });
      }
      const h = hourMap.get(hour)!;
      h.count += 1;
      h.cost += r.cost;
      h.latencyMs += r.latency.totalMs;
    }
    const byHour = Array.from(hourMap.entries())
      .map(([hour, data]) => ({ hour, ...data }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      totalRecords: this.history.length,
      successCount,
      failureCount: this.history.length - successCount,
      totalTokensUsed: totalTokens,
      totalCost,
      totalLatencyMs: totalLatency,
      avgLatencyMs: totalLatency / this.history.length,
      p50LatencyMs: percentile(totalLatencies, 50),
      p95LatencyMs: percentile(totalLatencies, 95),
      p99LatencyMs: percentile(totalLatencies, 99),
      totalHits,
      avgHitRate: totalHits / (this.history.length * 5), // 假设 Top-K=5
      totalCitations,
      avgCitationCount: totalCitations / this.history.length,
      alertCount: this.alerts.length,
      criticalAlertCount: this.alerts.filter((a) => a.severity === 'critical').length,
      errorRate: (this.history.length - successCount) / this.history.length,
      byProvider,
      byHour,
    };
  }

  /**
   * 获取时间窗口聚合
   */
  getWindowAggregation(windowMs?: number): WindowAggregation {
    const now = Date.now();
    const window = windowMs ?? this.config.windowSizeMs;
    const startTime = now - window;
    const records = this.history.filter((r) => r.timestamp >= startTime);

    if (records.length === 0) {
      return {
        startTime,
        endTime: now,
        queryCount: 0,
        successRate: 0,
        avgHitRate: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        totalTokens: 0,
        totalCost: 0,
        avgCitations: 0,
      };
    }

    const successCount = records.filter((r) => r.success).length;
    const latencies = records.map((r) => r.latency.totalMs).sort((a, b) => a - b);
    const totalHits = records.reduce((s, r) => s + r.hitCount, 0);
    const totalCitations = records.reduce((s, r) => s + r.citationCount, 0);

    return {
      startTime,
      endTime: now,
      queryCount: records.length,
      successRate: successCount / records.length,
      avgHitRate: totalHits / (records.length * 5),
      avgLatencyMs: latencies.reduce((s, n) => s + n, 0) / records.length,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      totalTokens: records.reduce((s, r) => s + r.tokens.total, 0),
      totalCost: records.reduce((s, r) => s + r.cost, 0),
      avgCitations: totalCitations / records.length,
    };
  }

  /**
   * 导出历史（JSON）
   */
  exportHistory(): string {
    return JSON.stringify(
      {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        records: this.history,
        quality: Array.from(this.qualityMap.values()),
        alerts: this.alerts,
      },
      null,
      2
    );
  }

  // ============ 告警系统 ============

  /**
   * 检查单次记录的告警条件
   */
  private checkAlerts(record: RAGQueryRecord): void {
    const thresholds = this.config.thresholds;

    // 延迟告警
    if (record.latency.totalMs > thresholds.maxLatencyMs) {
      this.raiseAlert({
        severity: record.latency.totalMs > thresholds.maxLatencyMs * 2 ? 'critical' : 'warning',
        type: 'latency',
        message: `查询延迟 ${record.latency.totalMs}ms 超过阈值 ${thresholds.maxLatencyMs}ms`,
        currentValue: record.latency.totalMs,
        threshold: thresholds.maxLatencyMs,
        affectedQueryIds: [record.id],
      });
    }

    // 命中率告警
    const hitRate = record.topK > 0 ? record.hitCount / record.topK : 0;
    if (hitRate < thresholds.minHitRate && record.success) {
      this.raiseAlert({
        severity: hitRate === 0 ? 'warning' : 'info',
        type: 'hit-rate',
        message: `命中率 ${(hitRate * 100).toFixed(1)}% 低于阈值 ${(thresholds.minHitRate * 100).toFixed(1)}%`,
        currentValue: hitRate,
        threshold: thresholds.minHitRate,
        affectedQueryIds: [record.id],
      });
    }

    // 成本告警
    if (record.cost > thresholds.maxCostPerQuery) {
      this.raiseAlert({
        severity: record.cost > thresholds.maxCostPerQuery * 2 ? 'error' : 'warning',
        type: 'cost',
        message: `查询成本 $${record.cost.toFixed(4)} 超过阈值 $${thresholds.maxCostPerQuery.toFixed(4)}`,
        currentValue: record.cost,
        threshold: thresholds.maxCostPerQuery,
        affectedQueryIds: [record.id],
      });
    }
  }

  /**
   * 触发告警
   */
  private raiseAlert(alert: Omit<AlertEvent, 'id' | 'timestamp'>): void {
    const fullAlert: AlertEvent = {
      id: genId('alert'),
      timestamp: Date.now(),
      ...alert,
    };
    this.alerts.push(fullAlert);
    // 限制告警历史
    while (this.alerts.length > 1000) {
      this.alerts.shift();
    }
    this.emit({ type: 'alert', alert: fullAlert, at: fullAlert.timestamp });
  }

  // ============ 实时分析 ============

  /**
   * 获取最近 N 条记录的趋势
   */
  getRecentTrend(n: number = 100): {
    successRate: number;
    avgLatency: number;
    avgCost: number;
    avgHitRate: number;
  } {
    const recent = this.history.slice(-n);
    if (recent.length === 0) {
      return { successRate: 0, avgLatency: 0, avgCost: 0, avgHitRate: 0 };
    }
    const successCount = recent.filter((r) => r.success).length;
    const totalLat = recent.reduce((s, r) => s + r.latency.totalMs, 0);
    const totalCost = recent.reduce((s, r) => s + r.cost, 0);
    const totalHits = recent.reduce((s, r) => s + r.hitCount, 0);

    return {
      successRate: successCount / recent.length,
      avgLatency: totalLat / recent.length,
      avgCost: totalCost / recent.length,
      avgHitRate: totalHits / (recent.length * 5),
    };
  }
}

export default RAGMonitor;
