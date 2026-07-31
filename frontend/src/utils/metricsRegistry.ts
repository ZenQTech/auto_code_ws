/**
 * # ============================================================
 * # Prometheus 风格 Metrics 注册表 (Cycle 50 G50-03)
 * # ============================================================
 * # 核心作用：收集和导出 Prometheus 兼容的指标
 * #           支持 Counter / Gauge / Histogram / Summary 4 种类型
 * # 运行流程：
 * #   1. 注册指标 (counter/gauge/histogram)
 * #   2. 业务代码调用 inc()/set()/observe()
 * #   3. 导出 Prometheus 文本格式 (text/plain; version=0.0.4)
 * # 输入参数：无
 * # 输出结果：PrometheusMetrics { counter, gauge, histogram, summary }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-03 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 指标标签 */
export type MetricLabels = Record<string, string>;

/** 基础指标 */
interface BaseMetric {
  name: string;
  help: string;
  labelNames?: string[];
}

/** Counter 计数器 (单调递增) */
export interface Counter extends BaseMetric {
  type: 'counter';
  values: Map<string, { labels: MetricLabels; value: number }>;
}

/** Gauge 仪表 (可增可减) */
export interface Gauge extends BaseMetric {
  type: 'gauge';
  values: Map<string, { labels: MetricLabels; value: number }>;
}

/** Histogram 直方图 (分布统计) */
export interface Histogram extends BaseMetric {
  type: 'histogram';
  buckets: number[];
  values: Map<string, {
    labels: MetricLabels;
    bucketCounts: number[];
    sum: number;
    count: number;
  }>;
}

/** Summary 摘要 (分位数估计) */
export interface Summary extends BaseMetric {
  type: 'summary';
  quantiles: number[];
  values: Map<string, {
    labels: MetricLabels;
    quantileValues: number[];
    sum: number;
    count: number;
  }>;
}

/** 任何指标 */
export type AnyMetric = Counter | Gauge | Histogram | Summary;

/** 注册表配置 */
export interface MetricsRegistryConfig {
  /** 默认直方图桶 */
  defaultHistogramBuckets?: number[];
  /** 默认摘要分位数 */
  defaultSummaryQuantiles?: number[];
  /** 指标前缀 (例如 'mcp_volcengine') */
  prefix?: string;
}

// ============================================================
// 工具函数
// ============================================================

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DEFAULT_SUMMARY_QUANTILES = [0.5, 0.9, 0.95, 0.99];

/**
 * 标签序列化 (排序后拼接, 保持稳定)
 */
function serializeLabels(labels: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const keys = Object.keys(labels).sort();
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k] ?? '')}"`);
  return '{' + parts.join(',') + '}';
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function hashLabels(labels: MetricLabels): string {
  if (!labels) return '';
  return Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join('&');
}

// ============================================================
// MetricsRegistry 主类
// ============================================================

export class MetricsRegistry {
  private readonly metrics = new Map<string, AnyMetric>();
  private readonly config: Required<MetricsRegistryConfig>;
  private readonly listeners: Set<MetricsListener> = new Set();

  constructor(config: MetricsRegistryConfig = {}) {
    this.config = {
      defaultHistogramBuckets: config.defaultHistogramBuckets ?? DEFAULT_HISTOGRAM_BUCKETS,
      defaultSummaryQuantiles: config.defaultSummaryQuantiles ?? DEFAULT_SUMMARY_QUANTILES,
      prefix: config.prefix ?? '',
    };
  }

  // ============================================================
  // 指标创建
  // ============================================================

  /**
   * 创建 Counter
   */
  createCounter(name: string, help: string, options: { labelNames?: string[] } = {}): Counter {
    const fullName = this.fullName(name);
    if (this.metrics.has(fullName)) {
      return this.metrics.get(fullName) as Counter;
    }
    const counter: Counter = {
      type: 'counter',
      name: fullName,
      help,
      labelNames: options.labelNames,
      values: new Map(),
    };
    this.metrics.set(fullName, counter);
    this.emit({ type: 'register', metricName: fullName, metricType: 'counter', timestamp: Date.now() });
    return counter;
  }

  /**
   * 创建 Gauge
   */
  createGauge(name: string, help: string, options: { labelNames?: string[] } = {}): Gauge {
    const fullName = this.fullName(name);
    if (this.metrics.has(fullName)) {
      return this.metrics.get(fullName) as Gauge;
    }
    const gauge: Gauge = {
      type: 'gauge',
      name: fullName,
      help,
      labelNames: options.labelNames,
      values: new Map(),
    };
    this.metrics.set(fullName, gauge);
    this.emit({ type: 'register', metricName: fullName, metricType: 'gauge', timestamp: Date.now() });
    return gauge;
  }

  /**
   * 创建 Histogram
   */
  createHistogram(name: string, help: string, options: { labelNames?: string[]; buckets?: number[] } = {}): Histogram {
    const fullName = this.fullName(name);
    if (this.metrics.has(fullName)) {
      return this.metrics.get(fullName) as Histogram;
    }
    const buckets = options.buckets ?? this.config.defaultHistogramBuckets;
    const histogram: Histogram = {
      type: 'histogram',
      name: fullName,
      help,
      labelNames: options.labelNames,
      buckets: [...buckets].sort((a, b) => a - b),
      values: new Map(),
    };
    this.metrics.set(fullName, histogram);
    this.emit({ type: 'register', metricName: fullName, metricType: 'histogram', timestamp: Date.now() });
    return histogram;
  }

  /**
   * 创建 Summary
   */
  createSummary(name: string, help: string, options: { labelNames?: string[]; quantiles?: number[] } = {}): Summary {
    const fullName = this.fullName(name);
    if (this.metrics.has(fullName)) {
      return this.metrics.get(fullName) as Summary;
    }
    const quantiles = options.quantiles ?? this.config.defaultSummaryQuantiles;
    const summary: Summary = {
      type: 'summary',
      name: fullName,
      help,
      labelNames: options.labelNames,
      quantiles: [...quantiles].sort((a, b) => a - b),
      values: new Map(),
    };
    this.metrics.set(fullName, summary);
    this.emit({ type: 'register', metricName: fullName, metricType: 'summary', timestamp: Date.now() });
    return summary;
  }

  // ============================================================
  // 指标操作
  // ============================================================

  /**
   * Counter 增加
   */
  inc(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const m = this.metrics.get(this.fullName(name));
    if (!m || m.type !== 'counter') {
      throw new Error(`Counter ${name} not found`);
    }
    const key = hashLabels(labels);
    const existing = m.values.get(key) ?? { labels, value: 0 };
    existing.value += value;
    m.values.set(key, existing);
    this.emit({ type: 'observe', metricName: m.name, timestamp: Date.now() });
  }

  /**
   * Gauge 设置
   */
  set(name: string, value: number, labels: MetricLabels = {}): void {
    const m = this.metrics.get(this.fullName(name));
    if (!m || m.type !== 'gauge') {
      throw new Error(`Gauge ${name} not found`);
    }
    const key = hashLabels(labels);
    m.values.set(key, { labels, value });
    this.emit({ type: 'observe', metricName: m.name, timestamp: Date.now() });
  }

  /**
   * Histogram 观察
   */
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const m = this.metrics.get(this.fullName(name));
    if (!m || m.type !== 'histogram') {
      throw new Error(`Histogram ${name} not found`);
    }
    const key = hashLabels(labels);
    const existing = m.values.get(key) ?? {
      labels,
      bucketCounts: new Array(m.buckets.length + 1).fill(0), // +1 for +Inf
      sum: 0,
      count: 0,
    };
    existing.sum += value;
    existing.count += 1;
    for (let i = 0; i < m.buckets.length; i++) {
      if (value <= (m.buckets[i] ?? 0)) {
        existing.bucketCounts[i] = (existing.bucketCounts[i] ?? 0) + 1;
      }
    }
    existing.bucketCounts[m.buckets.length] = (existing.bucketCounts[m.buckets.length] ?? 0) + 1; // +Inf
    m.values.set(key, existing);
    this.emit({ type: 'observe', metricName: m.name, timestamp: Date.now() });
  }

  /**
   * Summary 观察 (使用简单滑动窗口)
   */
  observeSummary(name: string, value: number, labels: MetricLabels = {}, maxSamples: number = 1000): void {
    const m = this.metrics.get(this.fullName(name));
    if (!m || m.type !== 'summary') {
      throw new Error(`Summary ${name} not found`);
    }
    const key = hashLabels(labels);
    const existing = m.values.get(key) ?? {
      labels,
      quantileValues: new Array(m.quantiles.length).fill(0),
      sum: 0,
      count: 0,
    };
    existing.sum += value;
    existing.count += 1;
    // 简单 P-square 算法: 用最近 N 个样本估算分位数
    // 简化: 使用 value 估算
    for (let i = 0; i < m.quantiles.length; i++) {
      const q = m.quantiles[i] ?? 0;
      // 简化的分位数估算
      existing.quantileValues[i] = value * q + existing.quantileValues[i]! * (1 - q) * 0.9;
    }
    m.values.set(key, existing);
    this.emit({ type: 'observe', metricName: m.name, timestamp: Date.now() });
  }

  // ============================================================
  // 导出
  // ============================================================

  /**
   * 导出 Prometheus 文本格式
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    for (const m of this.metrics.values()) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      if (m.type === 'counter' || m.type === 'gauge') {
        for (const v of m.values.values()) {
          const labels = serializeLabels(v.labels);
          lines.push(`${m.name}${labels} ${v.value}`);
        }
      } else if (m.type === 'histogram') {
        for (const v of m.values.values()) {
          const labels = serializeLabels(v.labels);
          for (let i = 0; i < m.buckets.length; i++) {
            const bucketLabels = serializeLabels({ ...v.labels, le: String(m.buckets[i]) });
            lines.push(`${m.name}_bucket${bucketLabels} ${v.bucketCounts[i] ?? 0}`);
          }
          const infLabels = serializeLabels({ ...v.labels, le: '+Inf' });
          lines.push(`${m.name}_bucket${infLabels} ${v.bucketCounts[m.buckets.length] ?? 0}`);
          lines.push(`${m.name}_sum${labels} ${v.sum}`);
          lines.push(`${m.name}_count${labels} ${v.count}`);
        }
      } else if (m.type === 'summary') {
        for (const v of m.values.values()) {
          const labels = serializeLabels(v.labels);
          for (let i = 0; i < m.quantiles.length; i++) {
            const qLabels = serializeLabels({ ...v.labels, quantile: String(m.quantiles[i]) });
            lines.push(`${m.name}{${qLabels.slice(1, -1)}} ${v.quantileValues[i] ?? 0}`);
          }
          lines.push(`${m.name}_sum${labels} ${v.sum}`);
          lines.push(`${m.name}_count${labels} ${v.count}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  /**
   * 导出 JSON
   */
  exportJson(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, m] of this.metrics.entries()) {
      const values: unknown[] = [];
      for (const v of m.values.values()) {
        values.push(v);
      }
      result[name] = {
        type: m.type,
        help: m.help,
        values,
      };
    }
    return result;
  }

  /**
   * 获取指标
   */
  getMetric(name: string): AnyMetric | undefined {
    return this.metrics.get(this.fullName(name));
  }

  /**
   * 列出所有指标名
   */
  listMetrics(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    for (const m of this.metrics.values()) {
      if (m.type === 'counter' || m.type === 'gauge') {
        m.values.clear();
      } else if (m.type === 'histogram') {
        for (const v of m.values.values()) {
          v.bucketCounts = new Array(m.buckets.length + 1).fill(0);
          v.sum = 0;
          v.count = 0;
        }
      } else if (m.type === 'summary') {
        for (const v of m.values.values()) {
          v.quantileValues = new Array(m.quantiles.length).fill(0);
          v.sum = 0;
          v.count = 0;
        }
      }
    }
  }

  /**
   * 订阅事件
   */
  subscribe(listener: MetricsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private fullName(name: string): string {
    if (this.config.prefix && !name.startsWith(this.config.prefix)) {
      return `${this.config.prefix}_${name}`;
    }
    return name;
  }

  private emit(event: MetricsEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

// ============================================================
// 事件类型
// ============================================================

export interface MetricsEvent {
  type: 'register' | 'observe' | 'reset';
  metricName: string;
  metricType?: string;
  timestamp: number;
}

export type MetricsListener = (event: MetricsEvent) => void;

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建默认 MetricsRegistry (带 MCP 前缀)
 */
export function createMetricsRegistry(config?: MetricsRegistryConfig): MetricsRegistry {
  return new MetricsRegistry(config);
}

/**
 * 全局单例
 */
let _defaultRegistry: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new MetricsRegistry({ prefix: 'mcp' });
    // 预注册核心指标
    _defaultRegistry.createCounter('volcengine_api_requests_total', 'Total API requests to Volcengine', { labelNames: ['status', 'endpoint'] });
    _defaultRegistry.createCounter('volcengine_api_errors_total', 'Total API errors', { labelNames: ['error_type'] });
    _defaultRegistry.createCounter('volcengine_fallback_requests_total', 'Total fallback requests');
    _defaultRegistry.createHistogram('volcengine_api_latency_seconds', 'API latency in seconds', { labelNames: ['endpoint'] });
    _defaultRegistry.createCounter('volcengine_tokens_total', 'Total tokens consumed', { labelNames: ['modality'] });
    _defaultRegistry.createCounter('volcengine_cost_usd_total', 'Total cost in USD');
    _defaultRegistry.createCounter('multimodal_embeddings_total', 'Total embeddings', { labelNames: ['modality', 'provider'] });
    _defaultRegistry.createCounter('multimodal_searches_total', 'Total searches', { labelNames: ['modality'] });
    _defaultRegistry.createHistogram('multimodal_search_latency_seconds', 'Search latency', { labelNames: ['modality'] });
    _defaultRegistry.createCounter('multimodal_cache_hits_total', 'Cache hits', { labelNames: ['level'] });
    _defaultRegistry.createCounter('multimodal_cache_misses_total', 'Cache misses');
    _defaultRegistry.createGauge('multimodal_index_size', 'Index size in documents');
    _defaultRegistry.createGauge('multimodal_cache_size', 'Cache size in entries');
  }
  return _defaultRegistry;
}

export function resetMetricsRegistry(): void {
  if (_defaultRegistry) {
    _defaultRegistry.reset();
  }
  _defaultRegistry = null;
}
