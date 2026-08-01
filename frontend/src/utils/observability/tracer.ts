/**
 * # ============================================================
 * # Tracer - 追踪器主类 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：管理 Span 生命周期、采样决策、批量导出
 * # 实现 OpenTelemetry Tracer 规范
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
 * # ====================================
 */

import type {
  SpanData,
  Attributes,
  TraceContext,
  TracerConfig,
  TraceEvent,
  TraceListener,
  Resource,
  SpanId,
  TraceId,
  SpanStatusCode,
  SpanKind,
  SpanLink,
  TraceReport,
  ExportResult,
  Sampler,
  SamplingResult,
  SamplingDecision,
  SpanProcessor,
} from './traceTypes';
import { TRACE_FLAG_SAMPLED } from './traceTypes';
import {
  generateTraceId,
  generateSpanId,
  createRootContext,
  createChildContext,
  formatContext,
} from './traceContext';
import { Span, NonRecordingSpan } from './span';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
} from './spanExporter';
import type { SpanExporter } from './traceTypes';

// ============================================================
// 默认采样器
// ====================================

/** AlwaysOn 采样器 - 总是采样 */
export class AlwaysOnSampler implements Sampler {
  name = 'always-on';
  description = 'Always sample all traces';
  shouldSample(_context: TraceContext, _name: string, _attributes?: Attributes): SamplingResult {
    return { decision: 'record-and-sample' };
  }
}

/** AlwaysOff 采样器 - 从不采样 */
export class AlwaysOffSampler implements Sampler {
  name = 'always-off';
  description = 'Never sample any traces';
  shouldSample(_context: TraceContext, _name: string, _attributes?: Attributes): SamplingResult {
    return { decision: 'drop' };
  }
}

/** TraceIdRatioBased 采样器 - 基于比例采样 */
export class TraceIdRatioBasedSampler implements Sampler {
  name = 'trace-id-ratio';
  description = 'Sample based on probability';
  private readonly ratio: number;
  constructor(ratio: number) {
    this.ratio = Math.max(0, Math.min(1, ratio));
  }
  shouldSample(_context: TraceContext, _name: string, _attributes?: Attributes): SamplingResult {
    return {
      decision: Math.random() < this.ratio ? 'record-and-sample' : 'drop',
    };
  }
}

/** ParentBased 采样器 - 基于父级决策 */
export class ParentBasedSampler implements Sampler {
  name = 'parent-based';
  description = 'Respect parent sampling decision';
  private readonly root: Sampler;
  constructor(root: Sampler) {
    this.root = root;
  }
  shouldSample(context: TraceContext, name: string, attributes?: Attributes): SamplingResult {
    const isSampled = (context.traceFlags & TRACE_FLAG_SAMPLED) !== 0;
    if (context.spanId && isSampled) {
      return { decision: 'record-and-sample' };
    }
    return this.root.shouldSample(context, name, attributes);
  }
}

// ============================================================
// Tracer 主类
// ====================================

/** 默认 Tracer 配置 */
export function createDefaultTracerConfig(
  serviceName: string,
  overrides: Partial<TracerConfig> = {}
): TracerConfig {
  return {
    serviceName,
    serviceVersion: '1.0.0',
    deploymentEnvironment: 'production',
    samplingRate: 1.0,
    maxBufferedSpans: 10000,
    batchSize: 512,
    batchIntervalMs: 5000,
    enabled: true,
    ...overrides,
  };
}

/**
 * Tracer 主类 - 管理所有追踪
 */
export class Tracer {
  private readonly config: TracerConfig;
  private readonly resource: Resource;
  private readonly exporter: SpanExporter;
  private readonly processor: BatchSpanProcessor;
  private readonly sampler: Sampler;
  private readonly activeSpans: Map<SpanId, Span> = new Map();
  private readonly allSpans: SpanData[] = [];
  private readonly listeners: Set<TraceListener> = new Set();
  private currentContext: TraceContext | null = null;
  private running = false;
  private aborted = false;
  private dropCount = 0;
  private errorCount = 0;

  constructor(
    config: TracerConfig,
    exporter?: SpanExporter,
    sampler?: Sampler
  ) {
    this.config = config;
    this.resource = {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      deploymentEnvironment: config.deploymentEnvironment,
      hostName: typeof window !== 'undefined' ? window.location.hostname : 'node',
      processId: typeof process !== 'undefined' && typeof (process as { pid?: number }).pid === 'number' ? (process as { pid?: number }).pid : undefined,
      attributes: config.resourceAttributes,
    };
    this.exporter = exporter ?? new InMemorySpanExporter();
    this.sampler = sampler ?? new ParentBasedSampler(new TraceIdRatioBasedSampler(config.samplingRate));
    this.processor = new BatchSpanProcessor(this.exporter, {
      maxBatchSize: config.batchSize,
      maxQueueSize: config.maxBufferedSpans,
      scheduledDelayMs: config.batchIntervalMs,
    });
  }

  /**
   * 启动 Tracer
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.aborted = false;
    await this.exporter.start();
    await this.processor.start();
  }

  /**
   * 关闭 Tracer
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.aborted = true;
    this.running = false;
    // 结束所有活跃 Span
    for (const span of Array.from(this.activeSpans.values())) {
      try {
        span.end();
      } catch {
        // 忽略错误
      }
    }
    this.activeSpans.clear();
    await this.processor.shutdown();
    this.emit({ type: 'tracer-shutdown', timestamp: Date.now() });
  }

  /**
   * 订阅事件
   */
  subscribe(listener: TraceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 启动新 Span (顶级)
   */
  startSpan(
    name: string,
    options: {
      kind?: SpanKind;
      attributes?: Attributes;
      links?: SpanLink[];
      startTimeMs?: number;
    } = {}
  ): Span {
    if (!this.running || this.aborted || !this.config.enabled) {
      return this.createNoopSpan();
    }
    const rootContext = createRootContext();
    this.currentContext = rootContext;
    return this.startSpanInternal(name, rootContext, options, undefined);
  }

  /**
   * 基于父 Context 启动子 Span
   */
  startChildSpan(
    name: string,
    parentContext: TraceContext,
    options: {
      kind?: SpanKind;
      attributes?: Attributes;
      links?: SpanLink[];
      startTimeMs?: number;
    } = {}
  ): Span {
    if (!this.running || this.aborted || !this.config.enabled) {
      return this.createNoopSpan();
    }
    const childContext = createChildContext(parentContext);
    return this.startSpanInternal(name, childContext, options, parentContext.spanId);
  }

  /**
   * 基于父 Span 启动子 Span
   */
  startChildSpanFromParent(
    name: string,
    parentSpan: Span | NonRecordingSpan,
    options: {
      kind?: SpanKind;
      attributes?: Attributes;
      links?: SpanLink[];
      startTimeMs?: number;
    } = {}
  ): Span {
    if (!this.running || this.aborted || !this.config.enabled) {
      return this.createNoopSpan();
    }
    const parentContext: TraceContext = {
      traceId: parentSpan.getTraceId(),
      spanId: parentSpan.getSpanId(),
      traceFlags: TRACE_FLAG_SAMPLED,
    };
    return this.startChildSpan(name, parentContext, options);
  }

  /**
   * 获取当前 Context
   */
  getCurrentContext(): TraceContext | null {
    return this.currentContext;
  }

  /**
   * 设置当前 Context
   */
  setCurrentContext(context: TraceContext | null): void {
    this.currentContext = context;
  }

  /**
   * 在 Span 上下文中执行函数
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options: {
      kind?: SpanKind;
      attributes?: Attributes;
    } = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus({ code: 'OK' });
      return result;
    } catch (err) {
      if (err instanceof Error) {
        span.recordException(err);
      } else {
        span.setError(String(err));
      }
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * 强制刷新
   */
  async forceFlush(): Promise<void> {
    await this.processor.forceFlush();
  }

  /**
   * 获取所有 Spans
   */
  getAllSpans(): SpanData[] {
    return [...this.allSpans];
  }

  /**
   * 获取已完成 Spans
   */
  getFinishedSpans(): SpanData[] {
    return this.allSpans.filter((s) => s.endTimeMs !== undefined);
  }

  /**
   * 获取错误 Spans
   */
  getErrorSpans(): SpanData[] {
    return this.allSpans.filter((s) => s.status.code === 'ERROR');
  }

  /**
   * 获取导出统计
   */
  getExportStats(): ExportResult[] {
    return this.processor.getExportStats();
  }

  /**
   * 生成报告
   */
  generateReport(): TraceReport {
    const finished = this.getFinishedSpans();
    const errors = this.getErrorSpans();
    const sortedByDuration = [...finished].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
    const p95Index = Math.floor(sortedByDuration.length * 0.05);
    const p95Threshold = sortedByDuration[p95Index]?.durationMs ?? Infinity;
    const slowSpans = finished.filter((s) => (s.durationMs ?? 0) >= p95Threshold && (s.durationMs ?? 0) > 0);
    const uniqueTraces = new Set(finished.map((s) => s.traceId)).size;
    const exportStats = this.getExportStats();
    const totalExported = exportStats.reduce((s, e) => s + e.exportedCount, 0);
    const totalFailed = exportStats.reduce((s, e) => s + e.failedCount, 0);
    const sampled = finished.length;

    return {
      id: `report-${Date.now()}`,
      serviceName: this.config.serviceName,
      timestamp: Date.now(),
      durationMs: finished.length > 0
        ? Math.max(...finished.map((s) => s.endTimeMs ?? 0)) - Math.min(...finished.map((s) => s.startTimeMs))
        : 0,
      totalSpans: this.allSpans.length,
      sampledSpans: sampled,
      droppedSpans: this.dropCount,
      errorSpans: this.errorCount,
      slowSpans: slowSpans.length,
      uniqueTraces,
      exportStats,
      spans: this.allSpans,
      summary: this.buildSummary(sampled, errors.length, uniqueTraces, totalExported, totalFailed),
      recommendations: this.buildRecommendations(errors.length, slowSpans.length, totalFailed),
    };
  }

  /**
   * 获取配置
   */
  getConfig(): TracerConfig {
    return { ...this.config };
  }

  /**
   * 获取资源
   */
  getResource(): Resource {
    return { ...this.resource };
  }

  /**
   * 获取 Span 处理器
   */
  getProcessor(): BatchSpanProcessor {
    return this.processor;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private startSpanInternal(
    name: string,
    context: TraceContext,
    options: {
      kind?: SpanKind;
      attributes?: Attributes;
      links?: SpanLink[];
      startTimeMs?: number;
    },
    parentSpanId: SpanId | undefined
  ): Span {
    // 采样决策
    const samplingResult = this.sampler.shouldSample(context, name, options.attributes);
    this.emit({ type: 'sampling-decision', timestamp: Date.now(), traceId: context.traceId, decision: samplingResult.decision });

    if (samplingResult.decision === 'drop') {
      this.dropCount++;
      this.emit({ type: 'span-dropped', timestamp: Date.now(), reason: 'sampler-decision' });
      return new NonRecordingSpan(context.traceId, context.spanId) as unknown as Span;
    }

    const spanData: SpanData = {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId,
      name,
      kind: options.kind ?? 'internal',
      startTimeMs: options.startTimeMs ?? Date.now(),
      attributes: { ...(options.attributes ?? {}), ...(samplingResult.attributes ?? {}) },
      events: [],
      links: options.links ?? [],
      status: { code: 'UNSET' as SpanStatusCode },
      resource: this.resource,
      sampled: true,
    };

    const span = new Span(spanData, (endedSpan) => this.onSpanEnd(endedSpan));
    this.activeSpans.set(spanData.spanId, span);
    this.allSpans.push(spanData);
    this.emit({
      type: 'span-started',
      timestamp: Date.now(),
      spanId: spanData.spanId,
      traceId: spanData.traceId,
      name,
    });

    // 输出上下文信息（用于调试）
    if (this.config.deploymentEnvironment === 'development') {
      // eslint-disable-next-line no-console
      console.log(`[Tracer] Started: ${name} (${formatContext(context)})`);
    }

    return span;
  }

  private onSpanEnd(span: SpanData): void {
    this.activeSpans.delete(span.spanId);
    if (span.status.code === 'ERROR') {
      this.errorCount++;
    }
    this.processor.onEnd(span);
    this.emit({
      type: 'span-ended',
      timestamp: Date.now(),
      spanId: span.spanId,
      traceId: span.traceId,
      durationMs: span.durationMs ?? 0,
    });
  }

  private createNoopSpan(): Span {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    return new NonRecordingSpan(traceId, spanId) as unknown as Span;
  }

  private emit(event: TraceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }

  private buildSummary(
    sampled: number,
    errors: number,
    uniqueTraces: number,
    exported: number,
    failed: number
  ): string {
    return `📊 Tracer Report: ${sampled} spans sampled, ${errors} errors, ${uniqueTraces} unique traces | Exported: ${exported} ok, ${failed} failed`;
  }

  private buildRecommendations(errors: number, slowSpans: number, failedExports: number): string[] {
    const recs: string[] = [];
    if (errors > 0) {
      recs.push(`检测到 ${errors} 个错误 Span，建议检查异常堆栈`);
    }
    if (slowSpans > 0) {
      recs.push(`检测到 ${slowSpans} 个慢 Span，建议分析性能瓶颈`);
    }
    if (failedExports > 0) {
      recs.push(`导出失败 ${failedExports} 个 Span，检查导出器配置`);
    }
    if (recs.length === 0) {
      recs.push('追踪系统运行正常');
    }
    return recs;
  }
}

// ============================================================
// 全局 Tracer 管理
// ============================================================

let globalTracer: Tracer | null = null;

/**
 * 获取全局 Tracer
 */
export function getGlobalTracer(): Tracer | null {
  return globalTracer;
}

/**
 * 设置全局 Tracer
 */
export function setGlobalTracer(tracer: Tracer): void {
  globalTracer = tracer;
}

/**
 * 创建并注册全局 Tracer
 */
export async function createGlobalTracer(
  serviceName: string,
  config?: Partial<TracerConfig>,
  exporter?: SpanExporter,
  sampler?: Sampler
): Promise<Tracer> {
  if (globalTracer) {
    await globalTracer.shutdown();
  }
  const tracerConfig = createDefaultTracerConfig(serviceName, config);
  const tracer = new Tracer(tracerConfig, exporter, sampler);
  await tracer.start();
  globalTracer = tracer;
  return tracer;
}
