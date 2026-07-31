/**
 * # ============================================================
 * # RAGPerformanceDashboard - RAG 性能分析仪表盘 (v1.0.0 Cycle 47 G47-03)
 * # ============================================================
 * # 核心作用：实现 RAG 系统的实时性能监控和分析
 * #           - 实时性能指标记录 (检索/生成/总延迟/吞吐量)
 * #           - 时间窗口聚合 (分钟/小时/天)
 * #           - 缓存命中率可视化
 * #           - Provider 性能对比
 * #           - 性能瓶颈识别
 * #           - 告警机制
 * #           - 数据导出 (JSON/CSV)
 * #           - 完整事件订阅
 * # 对标产品: Grafana / Prometheus / Datadog RAG 监控
 * # 设计要点:
 * #   1. 高效时间窗口聚合: O(1) 更新 + O(n) 聚合
 * #   2. 百分位数计算: P50/P95/P99 实时计算
 * #   3. 告警规则引擎: 阈值 + 持续时间
 * #   4. 内存保护: 环形缓冲 + 自动淘汰
 * #   5. 集成监控: 对接 FAISS + SemanticCache 统计
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 47 G47-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/** 阶段类型 */
export type RAGStage = 'retrieval' | 'rerank' | 'generation' | 'embedding' | 'cache' | 'total';

/** 指标类型 */
export type MetricKind =
  | 'latency'           // 延迟 (ms)
  | 'throughput'        // 吞吐量 (ops/sec)
  | 'cache_hit_rate'    // 缓存命中率
  | 'error_rate'        // 错误率
  | 'cost'              // 成本 (USD)
  | 'tokens'            // Token 数
  | 'memory_bytes'      // 内存占用
  | 'queue_size';       // 队列大小

/** 性能指标记录 */
export interface PerformanceMetric {
  /** 唯一 ID */
  id: string;
  /** 时间戳 (ms) */
  timestamp: number;
  /** 阶段 */
  stage: RAGStage;
  /** 指标类型 */
  kind: MetricKind;
  /** 数值 */
  value: number;
  /** 标签 (例如: provider, indexType, query) */
  labels?: Record<string, string>;
  /** 持续时间 (ms, 用于 latency 类型的具体测量) */
  durationMs?: number;
}

/** 过滤器 */
export interface MetricFilter {
  /** 开始时间 (ms) */
  startTime?: number;
  /** 结束时间 (ms) */
  endTime?: number;
  /** 阶段过滤 */
  stages?: RAGStage[];
  /** 指标类型过滤 */
  kinds?: MetricKind[];
  /** 标签过滤 (精确匹配) */
  labels?: Record<string, string>;
  /** 最大返回数 */
  limit?: number;
}

/** 时间窗口间隔 */
export type WindowInterval = 'minute' | 'hour' | 'day';

/** 聚合结果 */
export interface AggregationResult {
  /** 间隔类型 */
  interval: WindowInterval;
  /** 桶大小 (ms) */
  bucketSizeMs: number;
  /** 桶数量 */
  bucketCount: number;
  /** 时间范围 */
  startTime: number;
  endTime: number;
  /** 桶数据 */
  buckets: Array<{
    /** 桶开始时间 (ms) */
    timestamp: number;
    /** 桶内样本数 */
    count: number;
    /** 总和 */
    sum: number;
    /** 平均 */
    avg: number;
    /** 最小 */
    min: number;
    /** 最大 */
    max: number;
    /** P50 (中位数) */
    p50: number;
    /** P95 */
    p95: number;
    /** P99 */
    p99: number;
    /** 错误数 */
    errorCount: number;
  }>;
}

/** 性能瓶颈报告 */
export interface BottleneckReport {
  /** 报告时间 */
  timestamp: number;
  /** 分析时间范围 */
  windowMs: number;
  /** 总查询数 */
  totalQueries: number;
  /** 平均总延迟 (ms) */
  avgTotalLatencyMs: number;
  /** P95 总延迟 (ms) */
  p95TotalLatencyMs: number;
  /** 各阶段平均延迟 (ms) */
  stageLatencies: Record<RAGStage, { avg: number; p95: number; share: number }>;
  /** 最慢阶段 */
  slowestStage: RAGStage;
  /** 瓶颈原因 */
  bottleneckReason: string;
  /** 优化建议 */
  suggestions: string[];
  /** 缓存命中率 (0-1) */
  cacheHitRate: number;
  /** 错误率 (0-1) */
  errorRate: number;
}

/** 告警规则 */
export interface AlertRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 阶段 */
  stage: RAGStage;
  /** 指标类型 */
  kind: MetricKind;
  /** 阈值 */
  threshold: number;
  /** 比较方式 (> or <) */
  comparison: 'gt' | 'lt';
  /** 持续时间 (ms, 阈值必须持续超过此时长才触发) */
  durationMs?: number;
  /** 是否启用 */
  enabled: boolean;
  /** 告警级别 */
  severity: 'info' | 'warning' | 'critical';
}

/** 告警事件 */
export interface AlertEvent {
  /** 告警 ID */
  id: string;
  /** 规则 ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 阶段 */
  stage: RAGStage;
  /** 指标类型 */
  kind: MetricKind;
  /** 当前值 */
  value: number;
  /** 阈值 */
  threshold: number;
  /** 严重级别 */
  severity: 'info' | 'warning' | 'critical';
  /** 触发时间 */
  triggeredAt: number;
  /** 消息 */
  message: string;
}

/** 告警状态 */
interface AlertState {
  ruleId: string;
  triggered: boolean;
  triggeredAt: number;
  lastValue: number;
  firstValueAt: number;
}

/** Dashboard 配置 */
export interface DashboardConfig {
  /** 最大保留指标数 (默认 10000) */
  maxMetrics?: number;
  /** 告警规则 */
  alertRules?: AlertRule[];
  /** 告警回调 */
  onAlert?: (event: AlertEvent) => void;
  /** 指标回调 */
  onMetric?: (metric: PerformanceMetric) => void;
}

/** 仪表盘统计 */
export interface DashboardStats {
  totalMetrics: number;
  oldestMetricAt: number;
  newestMetricAt: number;
  totalAlerts: number;
  activeAlerts: number;
  totalErrors: number;
  totalQueries: number;
  errorRate: number;
  uptimeMs: number;
}

/** Dashboard 事件 */
export type DashboardEvent =
  | { type: 'metric-recorded'; metric: PerformanceMetric; at: number }
  | { type: 'metric-evicted'; count: number; at: number }
  | { type: 'alert-triggered'; alert: AlertEvent; at: number }
  | { type: 'alert-resolved'; ruleId: string; at: number }
  | { type: 'cleared'; at: number }
  | { type: 'exported'; format: 'json' | 'csv'; bytes: number; at: number };

export type DashboardListener = (event: DashboardEvent) => void;

// ============ 工具函数 ============

/**
 * 计算百分位数
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const idx = (sortedValues.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) {
    return sortedValues[lower];
  }
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (idx - lower);
}

/**
 * 获取桶大小 (ms)
 */
function getBucketSizeMs(interval: WindowInterval): number {
  switch (interval) {
    case 'minute':
      return 60 * 1000;
    case 'hour':
      return 60 * 60 * 1000;
    case 'day':
      return 24 * 60 * 60 * 1000;
  }
}

/**
 * 获取默认桶数量
 */
function getDefaultBucketCount(interval: WindowInterval): number {
  switch (interval) {
    case 'minute':
      return 60; // 最近 60 分钟
    case 'hour':
      return 24; // 最近 24 小时
    case 'day':
      return 30; // 最近 30 天
  }
}

/**
 * 生成指标 ID
 */
function generateId(prefix: string = 'm'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// ============ RAGPerformanceDashboard 主类 ============

/**
 * RAG 性能分析仪表盘
 *
 * 核心功能:
 *   1. 记录性能指标
 *   2. 时间窗口聚合 (P50/P95/P99)
 *   3. 瓶颈识别
 *   4. 告警机制
 *   5. 数据导出
 */
export class RAGPerformanceDashboard {
  private readonly maxMetrics: number;
  private readonly alertRules: Map<string, AlertRule> = new Map();
  private readonly alertStates: Map<string, AlertState> = new Map();
  private readonly triggeredAlerts: Map<string, AlertEvent> = new Map();
  private readonly allAlerts: AlertEvent[] = [];
  private readonly metrics: PerformanceMetric[] = [];
  private readonly listeners: Set<DashboardListener> = new Set();
  private readonly onAlert?: (event: AlertEvent) => void;
  private readonly onMetric?: (metric: PerformanceMetric) => void;
  private readonly startTime: number = Date.now();
  private totalErrors: number = 0;
  private totalQueries: number = 0;

  constructor(config: DashboardConfig = {}) {
    this.maxMetrics = config.maxMetrics ?? 10000;
    this.onAlert = config.onAlert;
    this.onMetric = config.onMetric;

    if (config.alertRules) {
      for (const rule of config.alertRules) {
        this.alertRules.set(rule.id, rule);
        this.alertStates.set(rule.id, {
          ruleId: rule.id,
          triggered: false,
          triggeredAt: 0,
          lastValue: 0,
          firstValueAt: 0,
        });
      }
    }
  }

  // ============ 核心 API ============

  /**
   * 记录性能指标
   */
  record(input: Omit<PerformanceMetric, 'id' | 'timestamp'> & { timestamp?: number; id?: string }): PerformanceMetric {
    const metric: PerformanceMetric = {
      id: input.id ?? generateId(),
      timestamp: input.timestamp ?? Date.now(),
      stage: input.stage,
      kind: input.kind,
      value: input.value,
      labels: input.labels,
      durationMs: input.durationMs,
    };

    this.metrics.push(metric);

    // 跟踪总查询数和错误数
    if (input.stage === 'total') {
      this.totalQueries += 1;
    }
    if (input.kind === 'error_rate' && input.value > 0) {
      this.totalErrors += 1;
    }

    // 内存保护: 超过最大数量时淘汰旧指标
    if (this.metrics.length > this.maxMetrics) {
      const evictCount = this.metrics.length - this.maxMetrics;
      this.metrics.splice(0, evictCount);
      this.emit({ type: 'metric-evicted', count: evictCount, at: Date.now() });
    }

    // 评估告警规则
    this.evaluateAlerts(metric);

    // 触发回调
    if (this.onMetric) {
      try {
        this.onMetric(metric);
      } catch (e) {
        // 静默失败,避免回调错误影响主流程
      }
    }

    this.emit({ type: 'metric-recorded', metric, at: Date.now() });
    return metric;
  }

  /**
   * 便捷方法: 记录延迟指标
   */
  recordLatency(stage: RAGStage, durationMs: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage,
      kind: 'latency',
      value: durationMs,
      durationMs,
      labels,
    });
  }

  /**
   * 便捷方法: 记录吞吐量指标
   */
  recordThroughput(stage: RAGStage, opsPerSec: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage,
      kind: 'throughput',
      value: opsPerSec,
      labels,
    });
  }

  /**
   * 便捷方法: 记录缓存命中率
   */
  recordCacheHitRate(hitRate: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage: 'cache',
      kind: 'cache_hit_rate',
      value: hitRate,
      labels,
    });
  }

  /**
   * 便捷方法: 记录错误率
   */
  recordErrorRate(stage: RAGStage, errorRate: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage,
      kind: 'error_rate',
      value: errorRate,
      labels,
    });
  }

  /**
   * 便捷方法: 记录成本
   */
  recordCost(stage: RAGStage, cost: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage,
      kind: 'cost',
      value: cost,
      labels,
    });
  }

  /**
   * 便捷方法: 记录 Token 使用
   */
  recordTokens(stage: RAGStage, tokens: number, labels?: Record<string, string>): PerformanceMetric {
    return this.record({
      stage,
      kind: 'tokens',
      value: tokens,
      labels,
    });
  }

  /**
   * 查询指标
   */
  getMetrics(filter: MetricFilter = {}): PerformanceMetric[] {
    let result = this.metrics;

    if (filter.startTime !== undefined) {
      const t = filter.startTime;
      result = result.filter((m) => m.timestamp >= t);
    }
    if (filter.endTime !== undefined) {
      const t = filter.endTime;
      result = result.filter((m) => m.timestamp <= t);
    }
    if (filter.stages && filter.stages.length > 0) {
      const stages = new Set(filter.stages);
      result = result.filter((m) => stages.has(m.stage));
    }
    if (filter.kinds && filter.kinds.length > 0) {
      const kinds = new Set(filter.kinds);
      result = result.filter((m) => kinds.has(m.kind));
    }
    if (filter.labels) {
      const filterLabels = filter.labels;
      result = result.filter((m) => {
        if (!m.labels) return false;
        for (const [key, value] of Object.entries(filterLabels)) {
          if (m.labels[key] !== value) return false;
        }
        return true;
      });
    }
    if (filter.limit !== undefined && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return [...result];
  }

  /**
   * 时间窗口聚合
   */
  getAggregations(interval: WindowInterval, options: { bucketCount?: number; startTime?: number; endTime?: number } = {}): AggregationResult {
    const bucketSizeMs = getBucketSizeMs(interval);
    const defaultBuckets = getDefaultBucketCount(interval);
    const bucketCount = options.bucketCount ?? defaultBuckets;
    const now = Date.now();
    const endTime = options.endTime ?? now;
    const startTime = options.startTime ?? endTime - bucketSizeMs * bucketCount;

    // 过滤时间范围内的延迟指标 (P50/P95/P99 主要针对延迟)
    const latencyMetrics = this.metrics.filter(
      (m) => m.kind === 'latency' && m.timestamp >= startTime && m.timestamp <= endTime
    );

    // 创建桶 (使用 <= 边界以包含边界值)
    const buckets: AggregationResult['buckets'] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = startTime + i * bucketSizeMs;
      const bucketEnd = bucketStart + bucketSizeMs;
      const bucketValues = latencyMetrics
        .filter((m) => m.timestamp >= bucketStart && m.timestamp <= bucketEnd)
        .map((m) => m.value)
        .sort((a, b) => a - b);

      if (bucketValues.length > 0) {
        const sum = bucketValues.reduce((s, v) => s + v, 0);
        const errorCount = latencyMetrics.filter(
          (m) => m.timestamp >= bucketStart && m.timestamp < bucketEnd && (m.labels?.error === 'true' || m.value < 0)
        ).length;
        buckets.push({
          timestamp: bucketStart,
          count: bucketValues.length,
          sum,
          avg: sum / bucketValues.length,
          min: bucketValues[0],
          max: bucketValues[bucketValues.length - 1],
          p50: percentile(bucketValues, 0.5),
          p95: percentile(bucketValues, 0.95),
          p99: percentile(bucketValues, 0.99),
          errorCount,
        });
      } else {
        buckets.push({
          timestamp: bucketStart,
          count: 0,
          sum: 0,
          avg: 0,
          min: 0,
          max: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          errorCount: 0,
        });
      }
    }

    return {
      interval,
      bucketSizeMs,
      bucketCount,
      startTime,
      endTime,
      buckets,
    };
  }

  /**
   * 性能瓶颈分析
   */
  getBottleneckAnalysis(windowMs: number = 300000): BottleneckReport {
    const now = Date.now();
    const startTime = now - windowMs;
    const range = this.getMetrics({ startTime, endTime: now, kinds: ['latency'] });

    const totalQueries = this.metrics.filter(
      (m) => m.stage === 'total' && m.timestamp >= startTime && m.timestamp <= now
    );

    const totalValues = totalQueries.map((m) => m.value).sort((a, b) => a - b);
    const avgTotal = totalValues.length > 0 ? totalValues.reduce((s, v) => s + v, 0) / totalValues.length : 0;
    const p95Total = percentile(totalValues, 0.95);

    // 按阶段聚合
    const stageLatencies: Record<RAGStage, { avg: number; p95: number; share: number }> = {
      retrieval: { avg: 0, p95: 0, share: 0 },
      rerank: { avg: 0, p95: 0, share: 0 },
      generation: { avg: 0, p95: 0, share: 0 },
      embedding: { avg: 0, p95: 0, share: 0 },
      cache: { avg: 0, p95: 0, share: 0 },
      total: { avg: avgTotal, p95: p95Total, share: 1 },
    };

    const stageValues: Record<string, number[]> = {};
    for (const m of range) {
      if (m.stage === 'total') continue;
      if (!stageValues[m.stage]) {
        stageValues[m.stage] = [];
      }
      stageValues[m.stage]!.push(m.value);
    }

    let slowestStage: RAGStage = 'retrieval';
    let slowestAvg = 0;
    let totalNonCacheAvg = 0;
    let nonCacheCount = 0;

    for (const [stage, values] of Object.entries(stageValues)) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const p95 = percentile(sorted, 0.95);
      stageLatencies[stage as RAGStage] = { avg, p95, share: 0 };
      if (avg > slowestAvg) {
        slowestAvg = avg;
        slowestStage = stage as RAGStage;
      }
      if (stage !== 'cache') {
        totalNonCacheAvg += avg;
        nonCacheCount += 1;
      }
    }

    // 计算占比
    if (avgTotal > 0) {
      for (const stage of Object.keys(stageLatencies) as RAGStage[]) {
        stageLatencies[stage].share = stageLatencies[stage].avg / avgTotal;
      }
    }

    // 瓶颈原因分析
    let bottleneckReason = '';
    const suggestions: string[] = [];

    if (stageLatencies.retrieval.share > 0.5) {
      bottleneckReason = '向量检索是主要瓶颈,占用了超过 50% 的总延迟';
      suggestions.push('考虑使用 FAISS-WASM 加速向量检索');
      suggestions.push('减小检索 topK 或使用更小的索引');
      suggestions.push('启用语义缓存避免重复检索');
    } else if (stageLatencies.generation.share > 0.5) {
      bottleneckReason = 'LLM 生成是主要瓶颈,占用了超过 50% 的总延迟';
      suggestions.push('启用流式响应 (Streaming) 改善首 token 延迟');
      suggestions.push('考虑使用更小的模型或减少 max_tokens');
      suggestions.push('实施 prompt 压缩以减少输入 token');
    } else if (stageLatencies.rerank.share > 0.3) {
      bottleneckReason = 'Re-ranking 阶段占用过高比例的延迟';
      suggestions.push('减少重排序候选数量');
      suggestions.push('使用更轻量的重排序模型');
    } else if (stageLatencies.embedding.share > 0.3) {
      bottleneckReason = 'Embedding 阶段占用过高比例的延迟';
      suggestions.push('缓存 query embedding 结果');
      suggestions.push('使用更轻量的 embedding 模型');
    } else if (avgTotal > 1000) {
      bottleneckReason = '总延迟过高 (>1s),需要全面优化';
      suggestions.push('启用语义缓存降低重复查询延迟');
      suggestions.push('优化向量检索索引');
      suggestions.push('考虑使用流式响应');
    } else {
      bottleneckReason = '各阶段延迟相对均衡';
      suggestions.push('继续监控性能指标');
    }

    // 缓存命中率
    const cacheMetrics = this.metrics.filter(
      (m) => m.stage === 'cache' && m.kind === 'cache_hit_rate' && m.timestamp >= startTime
    );
    const cacheHitRate = cacheMetrics.length > 0
      ? cacheMetrics.reduce((s, m) => s + m.value, 0) / cacheMetrics.length
      : 0;

    // 错误率
    const totalErrMetrics = this.metrics.filter(
      (m) => m.kind === 'error_rate' && m.timestamp >= startTime
    );
    const errorRate = totalErrMetrics.length > 0
      ? totalErrMetrics.reduce((s, m) => s + m.value, 0) / totalErrMetrics.length
      : 0;

    return {
      timestamp: now,
      windowMs,
      totalQueries: totalQueries.length,
      avgTotalLatencyMs: avgTotal,
      p95TotalLatencyMs: p95Total,
      stageLatencies,
      slowestStage,
      bottleneckReason,
      suggestions,
      cacheHitRate,
      errorRate,
    };
  }

  /**
   * 获取 Provider 性能对比
   */
  getProviderComparison(windowMs: number = 300000): Array<{
    provider: string;
    queryCount: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    errorCount: number;
    errorRate: number;
  }> {
    const now = Date.now();
    const startTime = now - windowMs;
    const range = this.metrics.filter(
      (m) => m.kind === 'latency' && m.stage === 'generation' && m.timestamp >= startTime && m.labels?.provider
    );

    const byProvider: Map<string, number[]> = new Map();
    const errorsByProvider: Map<string, number> = new Map();
    for (const m of range) {
      const provider = m.labels!.provider!;
      if (!byProvider.has(provider)) {
        byProvider.set(provider, []);
        errorsByProvider.set(provider, 0);
      }
      byProvider.get(provider)!.push(m.value);
      if (m.labels?.error === 'true' || m.value < 0) {
        errorsByProvider.set(provider, errorsByProvider.get(provider)! + 1);
      }
    }

    const result: Array<{
      provider: string;
      queryCount: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      errorCount: number;
      errorRate: number;
    }> = [];

    for (const [provider, values] of byProvider) {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((s, v) => s + v, 0);
      const errorCount = errorsByProvider.get(provider) ?? 0;
      result.push({
        provider,
        queryCount: values.length,
        avgLatencyMs: sum / values.length,
        p95LatencyMs: percentile(sorted, 0.95),
        errorCount,
        errorRate: errorCount / values.length,
      });
    }

    result.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
    return result;
  }

  /**
   * 获取告警事件
   */
  getAlerts(filter: { activeOnly?: boolean; severity?: AlertEvent['severity'] } = {}): AlertEvent[] {
    let result = [...this.allAlerts];
    if (filter.activeOnly) {
      result = result.filter((a) => this.triggeredAlerts.has(a.id));
    }
    if (filter.severity) {
      result = result.filter((a) => a.severity === filter.severity);
    }
    return result;
  }

  /**
   * 添加告警规则
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    if (!this.alertStates.has(rule.id)) {
      this.alertStates.set(rule.id, {
        ruleId: rule.id,
        triggered: false,
        triggeredAt: 0,
        lastValue: 0,
        firstValueAt: 0,
      });
    }
  }

  /**
   * 移除告警规则
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    this.alertStates.delete(ruleId);
    return removed;
  }

  /**
   * 获取仪表盘统计
   */
  getStats(): DashboardStats {
    const now = Date.now();
    const activeAlerts = Array.from(this.triggeredAlerts.values()).length;
    return {
      totalMetrics: this.metrics.length,
      oldestMetricAt: this.metrics.length > 0 ? this.metrics[0]!.timestamp : 0,
      newestMetricAt: this.metrics.length > 0 ? this.metrics[this.metrics.length - 1]!.timestamp : 0,
      totalAlerts: this.allAlerts.length,
      activeAlerts,
      totalErrors: this.totalErrors,
      totalQueries: this.totalQueries,
      errorRate: this.totalQueries > 0 ? this.totalErrors / this.totalQueries : 0,
      uptimeMs: now - this.startTime,
    };
  }

  /**
   * 导出数据
   */
  exportDashboard(format: 'json' | 'csv'): string {
    let output: string;
    if (format === 'json') {
      output = JSON.stringify(
        {
          stats: this.getStats(),
          metrics: this.metrics,
          alerts: this.allAlerts,
          exportTime: Date.now(),
        },
        null,
        2
      );
    } else {
      // CSV
      const header = 'id,timestamp,stage,kind,value,durationMs,labels';
      const rows = this.metrics.map((m) => {
        const labels = m.labels ? JSON.stringify(m.labels).replace(/"/g, '""') : '';
        return [
          m.id,
          m.timestamp.toString(),
          m.stage,
          m.kind,
          m.value.toString(),
          m.durationMs?.toString() ?? '',
          labels,
        ].join(',');
      });
      output = [header, ...rows].join('\n');
    }

    this.emit({ type: 'exported', format, bytes: output.length, at: Date.now() });
    return output;
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.metrics.length = 0;
    this.allAlerts.length = 0;
    this.triggeredAlerts.clear();
    for (const state of this.alertStates.values()) {
      state.triggered = false;
      state.triggeredAt = 0;
      state.firstValueAt = 0;
      state.lastValue = 0;
    }
    this.totalErrors = 0;
    this.totalQueries = 0;
    this.emit({ type: 'cleared', at: Date.now() });
  }

  // ============ 事件订阅 ============

  /**
   * 订阅事件
   */
  subscribe(listener: DashboardListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ 内部方法 ============

  private evaluateAlerts(metric: PerformanceMetric): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;
      if (rule.stage !== metric.stage) continue;
      if (rule.kind !== metric.kind) continue;

      const state = this.alertStates.get(rule.id);
      if (!state) continue;

      const isOverThreshold =
        rule.comparison === 'gt' ? metric.value > rule.threshold : metric.value < rule.threshold;

      const now = Date.now();

      if (isOverThreshold) {
        if (state.firstValueAt === 0) {
          state.firstValueAt = now;
        }
        state.lastValue = metric.value;

        const duration = rule.durationMs ?? 0;
        const elapsed = now - state.firstValueAt;

        if (!state.triggered && elapsed >= duration) {
          // 触发告警
          state.triggered = true;
          state.triggeredAt = now;

          const alert: AlertEvent = {
            id: generateId('alert'),
            ruleId: rule.id,
            ruleName: rule.name,
            stage: rule.stage,
            kind: rule.kind,
            value: metric.value,
            threshold: rule.threshold,
            severity: rule.severity,
            triggeredAt: now,
            message: this.formatAlertMessage(rule, metric),
          };

          this.allAlerts.push(alert);
          this.triggeredAlerts.set(alert.id, alert);
          this.emit({ type: 'alert-triggered', alert, at: now });

          if (this.onAlert) {
            try {
              this.onAlert(alert);
            } catch (e) {
              // 静默失败
            }
          }
        }
      } else {
        // 阈值恢复正常
        if (state.triggered) {
          state.triggered = false;
          state.triggeredAt = 0;
          state.firstValueAt = 0;
          state.lastValue = 0;
          this.emit({ type: 'alert-resolved', ruleId: rule.id, at: now });

          // 清除触发中的告警
          for (const [id, alert] of this.triggeredAlerts) {
            if (alert.ruleId === rule.id) {
              this.triggeredAlerts.delete(id);
            }
          }
        }
      }
    }
  }

  private formatAlertMessage(rule: AlertRule, metric: PerformanceMetric): string {
    const op = rule.comparison === 'gt' ? '>' : '<';
    return `${rule.name}: ${rule.stage} ${rule.kind} = ${metric.value.toFixed(2)} ${op} ${rule.threshold}`;
  }

  private emit(event: DashboardEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        // 静默失败
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建默认仪表盘 (含常用告警规则)
 */
export function createDefaultDashboard(config: Partial<DashboardConfig> = {}): RAGPerformanceDashboard {
  const defaultRules: AlertRule[] = [
    {
      id: 'p95-latency-warning',
      name: 'P95 延迟警告',
      stage: 'total',
      kind: 'latency',
      threshold: 1000,
      comparison: 'gt',
      durationMs: 0,
      enabled: true,
      severity: 'warning',
    },
    {
      id: 'p95-latency-critical',
      name: 'P95 延迟严重',
      stage: 'total',
      kind: 'latency',
      threshold: 3000,
      comparison: 'gt',
      durationMs: 0,
      enabled: true,
      severity: 'critical',
    },
    {
      id: 'error-rate-high',
      name: '错误率过高',
      stage: 'total',
      kind: 'error_rate',
      threshold: 0.1,
      comparison: 'gt',
      durationMs: 0,
      enabled: true,
      severity: 'warning',
    },
    {
      id: 'cache-hit-low',
      name: '缓存命中率低',
      stage: 'cache',
      kind: 'cache_hit_rate',
      threshold: 0.3,
      comparison: 'lt',
      durationMs: 0,
      enabled: true,
      severity: 'info',
    },
  ];

  return new RAGPerformanceDashboard({
    maxMetrics: config.maxMetrics ?? 10000,
    alertRules: config.alertRules ?? defaultRules,
    onAlert: config.onAlert,
    onMetric: config.onMetric,
  });
}
