/**
 * # ============================================================
 * # Span Exporter - Span 导出器 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：将采样到的 Span 批量导出到外部系统
 * # 支持：Console Exporter (开发) + Batch Span Processor
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
 * # ====================================
 */

import type {
  SpanExporter,
  SpanData,
  ExportResult,
} from './traceTypes';

/** Console Exporter - 输出到 console (开发用) */
export class ConsoleSpanExporter implements SpanExporter {
  name = 'console';
  private enabled: boolean;
  private maxSpansPerExport: number;

  constructor(options: { enabled?: boolean; maxSpansPerExport?: number } = {}) {
    this.enabled = options.enabled ?? true;
    this.maxSpansPerExport = options.maxSpansPerExport ?? 100;
  }

  async start(): Promise<void> {
    if (this.enabled) {
      console.log('[ConsoleSpanExporter] Started');
    }
  }

  async shutdown(): Promise<void> {
    if (this.enabled) {
      console.log('[ConsoleSpanExporter] Shutdown');
    }
  }

  async export(spans: SpanData[]): Promise<ExportResult> {
    if (!this.enabled) {
      return {
        exporter: this.name,
        exportedCount: 0,
        failedCount: 0,
        timestamp: Date.now(),
      };
    }
    const exportSpans = spans.slice(0, this.maxSpansPerExport);
    for (const span of exportSpans) {
      const status = span.status.code === 'ERROR' ? '❌' : '✅';
      const duration = span.durationMs !== undefined ? `${span.durationMs}ms` : '?';
      // eslint-disable-next-line no-console
      console.log(`[Span] ${status} ${span.name} (${duration}) traceId=${span.traceId.slice(0, 8)}… spanId=${span.spanId}`);
    }
    return {
      exporter: this.name,
      exportedCount: exportSpans.length,
      failedCount: 0,
      timestamp: Date.now(),
    };
  }

  async forceFlush(): Promise<void> {
    // No buffering, no-op
  }
}

/** InMemoryExporter - 将 Span 存储到内存 (测试用) */
export class InMemorySpanExporter implements SpanExporter {
  name = 'in-memory';
  private spans: SpanData[] = [];
  private maxBuffered: number;
  private enabled: boolean;

  constructor(options: { maxBuffered?: number; enabled?: boolean } = {}) {
    this.maxBuffered = options.maxBuffered ?? 10000;
    this.enabled = options.enabled ?? true;
  }

  async start(): Promise<void> {
    // No-op
  }

  async shutdown(): Promise<void> {
    this.spans = [];
  }

  async export(spans: SpanData[]): Promise<ExportResult> {
    if (!this.enabled) {
      return {
        exporter: this.name,
        exportedCount: 0,
        failedCount: spans.length,
        timestamp: Date.now(),
      };
    }
    let exported = 0;
    let failed = 0;
    for (const span of spans) {
      if (this.spans.length < this.maxBuffered) {
        this.spans.push(span);
        exported++;
      } else {
        failed++;
      }
    }
    return {
      exporter: this.name,
      exportedCount: exported,
      failedCount: failed,
      timestamp: Date.now(),
    };
  }

  async forceFlush(): Promise<void> {
    // No-op
  }

  /**
   * 获取已收集的 Spans
   */
  getSpans(): SpanData[] {
    return [...this.spans];
  }

  /**
   * 获取已完成的 Spans (有 endTime)
   */
  getFinishedSpans(): SpanData[] {
    return this.spans.filter((s) => s.endTimeMs !== undefined);
  }

  /**
   * 清空
   */
  clear(): void {
    this.spans = [];
  }

  /**
   * 按 Trace ID 分组
   */
  getSpansByTrace(traceId: string): SpanData[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }
}

/** BatchSpanProcessor - 批量 Span 处理器 */
export class BatchSpanProcessor {
  private readonly buffer: SpanData[] = [];
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly scheduledDelayMs: number;
  private readonly exporter: SpanExporter;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private aborted = false;
  private exportStats: ExportResult[] = [];

  constructor(exporter: SpanExporter, options: {
    maxBatchSize?: number;
    maxQueueSize?: number;
    scheduledDelayMs?: number;
  } = {}) {
    this.exporter = exporter;
    this.maxBatchSize = options.maxBatchSize ?? 512;
    this.maxQueueSize = options.maxQueueSize ?? 2048;
    this.scheduledDelayMs = options.scheduledDelayMs ?? 5000;
    // 默认启动 (可以接受 spans)
    this.running = true;
  }

  /**
   * 启动处理器
   */
  async start(): Promise<void> {
    this.running = true;
    this.aborted = false;
    this.scheduleNextExport();
  }

  /**
   * 停止处理器
   */
  async shutdown(): Promise<void> {
    this.aborted = true;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.exporter.shutdown();
  }

  /**
   * 接收 Span
   */
  onEnd(span: SpanData): void {
    if (!this.running || this.aborted) return;
    if (this.buffer.length >= this.maxQueueSize) {
      // 队列已满，丢弃最早的 span
      this.buffer.shift();
    }
    this.buffer.push(span);

    // 达到批量大小，立即导出
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush().catch(() => {
        // 忽略错误
      });
    }
  }

  /**
   * 强制刷新
   */
  async forceFlush(): Promise<void> {
    await this.flush();
    await this.exporter.forceFlush();
  }

  /**
   * 获取导出统计
   */
  getExportStats(): ExportResult[] {
    return [...this.exportStats];
  }

  /**
   * 清空统计
   */
  clearStats(): void {
    this.exportStats = [];
  }

  /**
   * 缓冲大小
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * 私有方法 - 立即导出
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.maxBatchSize);
    try {
      const result = await this.exporter.export(batch);
      this.exportStats.push(result);
      // 只保留最近 100 条统计
      if (this.exportStats.length > 100) {
        this.exportStats.shift();
      }
    } catch (err) {
      const result: ExportResult = {
        exporter: this.exporter.name,
        exportedCount: 0,
        failedCount: batch.length,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
      this.exportStats.push(result);
    }
  }

  /**
   * 私有方法 - 调度下次导出
   */
  private scheduleNextExport(): void {
    if (this.aborted || !this.running) return;
    this.timer = setTimeout(async () => {
      await this.flush();
      this.scheduleNextExport();
    }, this.scheduledDelayMs);
  }
}
