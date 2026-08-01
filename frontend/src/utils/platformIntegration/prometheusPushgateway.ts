/**
 * # ============================================================
 * # Prometheus Pushgateway 集成 (Cycle 54 G54-02)
 * # ============================================================
 * # 核心作用：将指标推送到真实 Prometheus Pushgateway
 * # 支持：Prometheus 文本暴露格式 + Basic Auth + 多 Job 多 Instance
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 54 G54-02 初次创建
 * # ====================================
 */

import type {
  ClientConfig,
  HealthCheckResult,
  MetricData,
  HistogramData,
  HistogramBucket,
  PlatformEndpoint,
  PlatformEvent,
  PlatformEventListener,
  PlatformExportResult,
} from './platformTypes';
import { DEFAULT_RETRY_POLICY } from './platformTypes';
import { httpRequest, httpRequestWithRetry, buildUrl, delay } from './httpClient';

export interface PushgatewayConfig extends ClientConfig {
  /** Job 名称（必填） */
  jobName: string;
  /** Instance 标识（可选） */
  instance?: string;
  /** 分组键（可选） */
  groupingKey?: Record<string, string>;
  /** 直方图桶边界（默认） */
  defaultHistogramBuckets?: number[];
}

const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * 转义 Prometheus 标签值
 * 参考：https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * 转义指标名称（合法字符：a-zA-Z0-9_:）
 */
export function escapeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

/**
 * 格式化标签
 */
export function formatLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const pairs = keys
    .sort()
    .map((k) => `${k}="${escapeLabelValue(labels[k])}"`)
    .join(',');
  return `{${pairs}}`;
}

/**
 * 将单个指标格式化为 Prometheus 文本格式
 */
export function formatMetric(metric: MetricData): string {
  const lines: string[] = [];
  const name = escapeMetricName(metric.name);
  const labels = formatLabels(metric.labels);
  if (metric.help) {
    lines.push(`# HELP ${name} ${metric.help.replace(/\n/g, ' ')}`);
  }
  lines.push(`# TYPE ${name} ${metric.type}`);
  const value = formatNumber(metric.value);
  const unit = metric.unit ? ` ${metric.unit}` : '';
  lines.push(`${name}${labels} ${value}${unit} ${metric.timestamp}`);
  return lines.join('\n');
}

/**
 * 将直方图格式化为 Prometheus 文本格式
 */
export function formatHistogram(histogram: HistogramData, buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS): string {
  const lines: string[] = [];
  const name = escapeMetricName(histogram.name);
  const labels = formatLabels(histogram.labels);
  if (histogram.help) {
    lines.push(`# HELP ${name} ${histogram.help.replace(/\n/g, ' ')}`);
  }
  lines.push(`# TYPE ${name} histogram`);

  // 使用提供的 buckets 或从 histogram.buckets 提取
  const bucketList = histogram.buckets.length > 0
    ? histogram.buckets
    : buckets.map((le) => ({ le, count: 0 }));

  let cumulativeCount = 0;
  for (const bucket of bucketList) {
    cumulativeCount = bucket.count;
    const leLabel = formatLabels({ ...histogram.labels, le: formatNumber(bucket.le) });
    lines.push(`${name}_bucket${leLabel} ${cumulativeCount} ${histogram.timestamp}`);
  }
  // +Inf bucket
  const infLabel = formatLabels({ ...histogram.labels, le: '+Inf' });
  lines.push(`${name}_bucket${infLabel} ${histogram.count} ${histogram.timestamp}`);
  lines.push(`${name}_sum${labels} ${formatNumber(histogram.sum)} ${histogram.timestamp}`);
  lines.push(`${name}_count${labels} ${histogram.count} ${histogram.timestamp}`);
  return lines.join('\n');
}

/**
 * 格式化数字
 */
export function formatNumber(value: number): string {
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  if (Number.isNaN(value)) return 'NaN';
  if (Number.isInteger(value)) return value.toString();
  // Prometheus 接受科学计数法
  return value.toString();
}

/**
 * 批量指标格式化为完整暴露格式
 */
export function formatMetrics(
  metrics: MetricData[],
  histograms: HistogramData[] = []
): string {
  const parts: string[] = [];
  for (const m of metrics) {
    parts.push(formatMetric(m));
  }
  for (const h of histograms) {
    parts.push(formatHistogram(h));
  }
  return parts.join('\n');
}

/**
 * 构建 Pushgateway URL
 * URL 格式：/metrics/job/<job>[/instance/<instance>][/<group>/<value>]*
 */
export function buildPushgatewayPath(jobName: string, instance?: string, groupingKey?: Record<string, string>): string {
  const segments: string[] = ['metrics', 'job', encodeURIComponent(jobName)];
  if (instance) {
    segments.push('instance', encodeURIComponent(instance));
  }
  if (groupingKey) {
    for (const [k, v] of Object.entries(groupingKey)) {
      segments.push(encodeURIComponent(k), encodeURIComponent(v));
    }
  }
  return '/' + segments.join('/');
}

/**
 * 解析 Pushgateway 响应
 * 200/202 表示成功
 */
export function isPushgatewaySuccess(status: number): boolean {
  return status === 200 || status === 202;
}

/**
 * Prometheus Pushgateway 推送器主类
 */
export class PrometheusPushgateway {
  readonly name = 'prometheus-pushgateway';
  private readonly config: PushgatewayConfig;
  private readonly listeners: Set<PlatformEventListener> = new Set();
  private readonly history: PlatformExportResult[] = [];
  private readonly metricsBuffer: MetricData[] = [];
  private readonly histogramsBuffer: HistogramData[] = [];
  private running = false;

  constructor(config: PushgatewayConfig) {
    this.config = {
      ...config,
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
      enabled: config.enabled ?? true,
      defaultHistogramBuckets: config.defaultHistogramBuckets ?? DEFAULT_HISTOGRAM_BUCKETS,
    };
  }

  async start(): Promise<void> {
    this.running = true;
    this.emit({ type: 'connected', platform: this.name, timestamp: Date.now() });
  }

  async shutdown(): Promise<void> {
    // 关闭前先 flush（仅在有缓冲数据时）
    if (this.metricsBuffer.length > 0 || this.histogramsBuffer.length > 0) {
      await this.push();
    }
    this.running = false;
    this.emit({ type: 'disconnected', platform: this.name, timestamp: Date.now() });
  }

  /**
   * 添加 Counter 便捷方法
   */
  addCounter(metric: MetricData): void {
    this.metricsBuffer.push(metric);
  }

  /**
   * 添加 Gauge 便捷方法
   */
  addGauge(metric: MetricData): void {
    this.metricsBuffer.push(metric);
  }

  /**
   * 添加单个指标到缓冲区
   */
  addMetric(metric: MetricData): void {
    this.metricsBuffer.push(metric);
  }

  /**
   * 批量添加指标
   */
  addMetrics(metrics: MetricData[]): void {
    this.metricsBuffer.push(...metrics);
  }

  /**
   * 添加直方图
   */
  addHistogram(histogram: HistogramData): void {
    this.histogramsBuffer.push(histogram);
  }

  /**
   * 推送当前缓冲区到 Pushgateway
   */
  async push(): Promise<PlatformExportResult> {
    if (!this.running) {
      return this.makeResult(0, this.metricsBuffer.length + this.histogramsBuffer.length, 0, 0, ['Pushgateway not started']);
    }
    if (!this.config.enabled) {
      return this.makeResult(0, 0, 0, 0, ['Pushgateway disabled']);
    }
    if (this.metricsBuffer.length === 0 && this.histogramsBuffer.length === 0) {
      return this.makeResult(0, 0, 0, 0, []);
    }
    const start = Date.now();
    const count = this.metricsBuffer.length + this.histogramsBuffer.length;
    const body = formatMetrics(this.metricsBuffer, this.histogramsBuffer);
    const path = buildPushgatewayPath(this.config.jobName, this.config.instance, this.config.groupingKey);
    const url = buildUrl(this.config.endpoint.baseUrl, path, this.config.endpoint.pathPrefix);

    // Mock 模式
    if (this.config.mode === 'mock') {
      await delay(10 + Math.random() * 30);
      this.metricsBuffer.length = 0;
      this.histogramsBuffer.length = 0;
      const result = this.makeResult(count, 0, Date.now() - start, 0, []);
      this.history.push(result);
      this.emit({ type: 'export-success', platform: this.name, timestamp: Date.now(), data: { count } });
      return result;
    }

    let retries = 0;
    try {
      const res = await httpRequestWithRetry(
        {
          method: 'POST',
          url,
          headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
          body,
          timeoutMs: this.config.endpoint.timeoutMs,
          credentials: this.config.endpoint.credentials,
        },
        this.config.retryPolicy ?? DEFAULT_RETRY_POLICY,
        (attempt) => {
          retries = attempt;
          this.emit({ type: 'retry', platform: this.name, timestamp: Date.now(), data: { attempt } });
        }
      );
      if (isPushgatewaySuccess(res.status)) {
        this.metricsBuffer.length = 0;
        this.histogramsBuffer.length = 0;
        const result = this.makeResult(count, 0, Date.now() - start, retries, [], res.status);
        this.history.push(result);
        this.emit({ type: 'export-success', platform: this.name, timestamp: Date.now(), data: { count } });
        return result;
      }
      // hybrid 模式回退
      if (this.config.mode === 'hybrid') {
        this.metricsBuffer.length = 0;
        this.histogramsBuffer.length = 0;
        const result = this.makeResult(count, 0, Date.now() - start, retries, [`HTTP ${res.status}, fell back to mock`], res.status);
        this.history.push(result);
        return result;
      }
      const result = this.makeResult(0, count, Date.now() - start, retries, [`HTTP ${res.status}: ${res.body.slice(0, 200)}`], res.status);
      this.history.push(result);
      this.emit({ type: 'export-failure', platform: this.name, timestamp: Date.now(), data: { status: res.status } });
      return result;
    } catch (err) {
      if (this.config.mode === 'hybrid') {
        this.metricsBuffer.length = 0;
        this.histogramsBuffer.length = 0;
        const result = this.makeResult(count, 0, Date.now() - start, retries, [`Network error, fell back to mock: ${err instanceof Error ? err.message : String(err)}`]);
        this.history.push(result);
        return result;
      }
      const result = this.makeResult(0, count, Date.now() - start, retries, [err instanceof Error ? err.message : String(err)]);
      this.history.push(result);
      this.emit({ type: 'export-failure', platform: this.name, timestamp: Date.now(), data: { error: String(err) } });
      return result;
    }
  }

  /**
   * 强制刷新（推送当前缓冲）
   */
  async forceFlush(): Promise<PlatformExportResult> {
    return this.push();
  }

  /**
   * 删除 Pushgateway 中的指标
   * 对应 Pushgateway 的 DELETE /metrics/job/...
   */
  async delete(): Promise<PlatformExportResult> {
    if (!this.running) return this.makeResult(0, 0, 0, 0, ['Not started']);
    if (this.config.mode === 'mock') {
      await delay(5);
      return this.makeResult(1, 0, 5, 0, []);
    }
    const start = Date.now();
    const path = buildPushgatewayPath(this.config.jobName, this.config.instance, this.config.groupingKey);
    const url = buildUrl(this.config.endpoint.baseUrl, path, this.config.endpoint.pathPrefix);
    let retries = 0;
    try {
      const res = await httpRequestWithRetry(
        {
          method: 'DELETE',
          url,
          headers: {},
          timeoutMs: this.config.endpoint.timeoutMs,
          credentials: this.config.endpoint.credentials,
        },
        this.config.retryPolicy ?? DEFAULT_RETRY_POLICY,
        (attempt) => { retries = attempt; }
      );
      const success = isPushgatewaySuccess(res.status) || res.status === 404;
      return this.makeResult(success ? 1 : 0, success ? 0 : 1, Date.now() - start, retries, [], res.status);
    } catch (err) {
      return this.makeResult(0, 1, Date.now() - start, retries, [err instanceof Error ? err.message : String(err)]);
    }
  }

  /**
   * 健康检查：访问 Pushgateway 的根路径或 /-/ready
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    if (this.config.mode === 'mock' || !this.config.enabled) {
      return { platform: this.name, status: 'connected', latencyMs: 0, timestamp: Date.now(), details: { mode: 'mock' } };
    }
    try {
      const url = buildUrl(this.config.endpoint.baseUrl, '/-/ready', this.config.endpoint.pathPrefix);
      const res = await httpRequest({
        method: 'GET',
        url,
        headers: {},
        timeoutMs: this.config.endpoint.timeoutMs ?? 5000,
        credentials: this.config.endpoint.credentials,
      });
      return {
        platform: this.name,
        status: res.status === 200 ? 'connected' : 'error',
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
        details: { status: res.status, body: res.body.slice(0, 200) },
      };
    } catch (err) {
      return {
        platform: this.name,
        status: 'error',
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 获取当前缓冲区大小
   */
  getBufferSize(): { metrics: number; histograms: number } {
    return { metrics: this.metricsBuffer.length, histograms: this.histogramsBuffer.length };
  }

  /**
   * 清空缓冲区（不发送）
   */
  clearBuffer(): void {
    this.metricsBuffer.length = 0;
    this.histogramsBuffer.length = 0;
  }

  /**
   * 获取推送历史
   */
  getHistory(): PlatformExportResult[] {
    return [...this.history];
  }

  /**
   * 订阅事件
   */
  subscribe(listener: PlatformEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取端点
   */
  getEndpoint(): PlatformEndpoint {
    return { ...this.config.endpoint };
  }

  /**
   * 获取配置
   */
  getConfig(): PushgatewayConfig {
    return { ...this.config };
  }

  /**
   * 更新端点
   */
  updateEndpoint(endpoint: PlatformEndpoint): void {
    this.config.endpoint = endpoint;
    this.emit({ type: 'config-updated', platform: this.name, timestamp: Date.now(), data: { endpoint } });
  }

  private makeResult(
    success: number,
    failure: number,
    durationMs: number,
    retries: number,
    errors?: string[],
    httpStatus?: number
  ): PlatformExportResult {
    return {
      platform: this.name,
      successCount: success,
      failureCount: failure,
      durationMs,
      timestamp: Date.now(),
      retries,
      errors: errors && errors.length > 0 ? errors : undefined,
      httpStatus,
    };
  }

  private emit(event: PlatformEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

/**
 * 创建 Pushgateway 默认端点（默认端口 9091）
 */
export function createPushgatewayEndpoint(
  name: string,
  baseUrl: string,
  options: { protocol?: 'http' | 'https'; timeoutMs?: number } = {}
): PlatformEndpoint {
  return {
    name,
    baseUrl,
    protocol: options.protocol ?? 'http',
    timeoutMs: options.timeoutMs ?? 10000,
    verifyTls: true,
  };
}

/**
 * 工厂函数：创建 Counter 指标
 */
export function createCounter(name: string, value: number, labels: Record<string, string> = {}, help?: string): MetricData {
  return {
    name,
    type: 'counter',
    labels,
    value,
    timestamp: Date.now(),
    help,
  };
}

/**
 * 工厂函数：创建 Gauge 指标
 */
export function createGauge(name: string, value: number, labels: Record<string, string> = {}, help?: string): MetricData {
  return {
    name,
    type: 'gauge',
    labels,
    value,
    timestamp: Date.now(),
    help,
  };
}

/**
 * 工厂函数：创建 Histogram 指标
 */
export function createHistogram(name: string, buckets: HistogramBucket[], sum: number, count: number, labels: Record<string, string> = {}, help?: string): HistogramData {
  return {
    name,
    labels,
    buckets,
    sum,
    count,
    timestamp: Date.now(),
    help,
  };
}
