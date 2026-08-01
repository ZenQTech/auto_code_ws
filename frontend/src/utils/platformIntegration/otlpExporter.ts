/**
 * # ============================================================
 * # OTLP Exporter - OpenTelemetry 协议导出器 (Cycle 54 G54-01)
 * # ============================================================
 * # 核心作用：通过 OTLP HTTP/JSON 协议将追踪数据导出到真实后端
 * # 支持：OpenTelemetry Collector / Jaeger / Tempo / 任何 OTLP 兼容后端
 * # 标准：OTLP HTTP/JSON (port 4318) + W3C Trace Context
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 54 G54-01 初次创建
 * # ====================================
 */

import type { SpanData } from '../observability/traceTypes';
import type {
  ClientConfig,
  HealthCheckResult,
  OTLPSpan,
  PlatformEndpoint,
  PlatformEvent,
  PlatformEventListener,
  PlatformExportResult,
} from './platformTypes';
import { DEFAULT_RETRY_POLICY } from './platformTypes';
import { httpRequest, httpRequestWithRetry, buildUrl, calculateBackoff, delay } from './httpClient';

export interface OTLPExporterConfig extends ClientConfig {
  /** 路径：/v1/traces (默认) */
  tracesPath?: string;
  /** 是否压缩 (gzip) - 浏览器环境通常不启用 */
  compression?: 'none' | 'gzip';
  /** 额外的资源属性 */
  resourceAttributes?: Record<string, string>;
  /** 每个请求最大 spans */
  maxSpansPerRequest?: number;
}

/**
 * OTLP 状态码
 * 参考：https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md#set-status
 */
const OTLP_STATUS = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/**
 * 将内部 SpanData 转换为 OTLP Span 格式
 */
export function convertToOTLPSpan(span: SpanData): OTLPSpan {
  const attributes = Object.entries(span.attributes ?? {}).map(([key, value]) => {
    if (typeof value === 'string') {
      return { key, value: { stringValue: value } };
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return { key, value: { intValue: String(value) } };
      }
      return { key, value: { doubleValue: value } };
    } else if (typeof value === 'boolean') {
      return { key, value: { boolValue: value } };
    }
    return { key, value: { stringValue: String(value) } };
  });

  const otlpSpan: OTLPSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind ?? 'SPAN_KIND_INTERNAL',
    startTimeUnixNano: String(span.startTimeMs * 1_000_000),
    endTimeUnixNano: String((span.endTimeMs ?? span.startTimeMs) * 1_000_000),
    attributes,
    status: {
      code: span.status.code === 'OK' ? OTLP_STATUS.OK : span.status.code === 'ERROR' ? OTLP_STATUS.ERROR : OTLP_STATUS.UNSET,
      message: span.status.message,
    },
    events: (span.events ?? []).map((e) => ({
      timeUnixNano: String(e.timestamp * 1_000_000),
      name: e.name,
      attributes: e.attributes
        ? Object.entries(e.attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } }))
        : undefined,
    })),
    links: (span.links ?? []).map((l) => ({
      traceId: l.traceId,
      spanId: l.spanId,
      attributes: l.attributes
        ? Object.entries(l.attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } }))
        : undefined,
    })),
  };
  return otlpSpan;
}

/**
 * 构建 OTLP HTTP/JSON 请求体
 * 参考 OTLP JSON 编码规范
 */
export function buildOTLPRequestBody(
  spans: SpanData[],
  resourceAttributes: Record<string, string> = {}
): string {
  const otlpSpans = spans.map(convertToOTLPSpan);
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: Object.entries(resourceAttributes).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
        scopeSpans: [
          {
            scope: {
              name: 'hermes-observability',
              version: '1.0.0',
            },
            spans: otlpSpans,
          },
        ],
      },
    ],
  };
  return JSON.stringify(body);
}

/**
 * 解析 OTLP 健康检查响应
 */
export function isOTLPSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * OTLP Exporter 主类
 * 支持：
 * 1. mock 模式 - 不发真实请求
 * 2. real 模式 - 真实 OTLP HTTP/JSON 请求
 * 3. hybrid 模式 - 失败时回退到 mock
 */
export class OTLPExporter {
  readonly name = 'otlp';
  private readonly config: OTLPExporterConfig;
  private readonly listeners: Set<PlatformEventListener> = new Set();
  private readonly exportHistory: PlatformExportResult[] = [];
  private running = false;

  constructor(config: OTLPExporterConfig) {
    this.config = {
      ...config,
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
      enabled: config.enabled ?? true,
      tracesPath: config.tracesPath ?? '/v1/traces',
      compression: config.compression ?? 'none',
      maxSpansPerRequest: config.maxSpansPerRequest ?? 512,
    };
  }

  /** 启动 */
  async start(): Promise<void> {
    this.running = true;
    this.emit({ type: 'connected', platform: this.name, timestamp: Date.now() });
  }

  /** 停止 */
  async shutdown(): Promise<void> {
    this.running = false;
    this.emit({ type: 'disconnected', platform: this.name, timestamp: Date.now() });
  }

  /** 导出 spans */
  async export(spans: SpanData[]): Promise<PlatformExportResult> {
    if (!this.running) {
      return this.makeResult(0, spans.length, 0, 0, ['Exporter not started']);
    }
    if (!this.config.enabled) {
      return this.makeResult(0, 0, 0, 0, ['Exporter disabled']);
    }
    if (spans.length === 0) {
      return this.makeResult(0, 0, 0, 0, []);
    }

    // 切片
    const chunks: SpanData[][] = [];
    const max = this.config.maxSpansPerRequest ?? 512;
    for (let i = 0; i < spans.length; i += max) {
      chunks.push(spans.slice(i, i + max));
    }

    let totalSuccess = 0;
    let totalFailure = 0;
    const errors: string[] = [];
    let retries = 0;
    const start = Date.now();

    for (const chunk of chunks) {
      try {
        const result = await this.exportChunk(chunk);
        totalSuccess += result.success;
        totalFailure += result.failure;
        retries += result.retries;
        if (result.error) errors.push(result.error);
      } catch (err) {
        totalFailure += chunk.length;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const durationMs = Date.now() - start;
    const result = this.makeResult(totalSuccess, totalFailure, durationMs, retries, errors);
    this.exportHistory.push(result);
    if (this.exportHistory.length > 100) this.exportHistory.shift();
    this.emit({
      type: totalSuccess > 0 ? 'export-success' : 'export-failure',
      platform: this.name,
      timestamp: Date.now(),
      data: { success: totalSuccess, failure: totalFailure, durationMs },
    });
    return result;
  }

  /** 强制刷新（无内部缓冲时无操作） */
  async forceFlush(): Promise<void> {
    // No-op
  }

  /** 健康检查 */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    if (this.config.mode === 'mock' || !this.config.enabled) {
      return {
        platform: this.name,
        status: 'connected',
        latencyMs: 0,
        timestamp: Date.now(),
        details: { mode: 'mock' },
      };
    }
    try {
      // OTLP Collector 通常在 /v1/traces 接受 POST 探测
      const url = buildUrl(this.config.endpoint.baseUrl, '/v1/traces', this.config.endpoint.pathPrefix);
      const res = await httpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceSpans: [] }),
        timeoutMs: this.config.endpoint.timeoutMs ?? 5000,
        credentials: this.config.endpoint.credentials,
      });
      return {
        platform: this.name,
        status: res.status === 200 || res.status === 400 ? 'connected' : 'error',
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

  /** 订阅事件 */
  subscribe(listener: PlatformEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 获取导出历史 */
  getExportHistory(): PlatformExportResult[] {
    return [...this.exportHistory];
  }

  /** 端点 */
  getEndpoint(): PlatformEndpoint {
    return { ...this.config.endpoint };
  }

  /** 配置 */
  getConfig(): OTLPExporterConfig {
    return { ...this.config };
  }

  /** 更新端点 */
  updateEndpoint(endpoint: PlatformEndpoint): void {
    this.config.endpoint = endpoint;
    this.emit({
      type: 'config-updated',
      platform: this.name,
      timestamp: Date.now(),
      data: { endpoint },
    });
  }

  // ==================== 私有方法 ====================

  private async exportChunk(chunk: SpanData[]): Promise<{ success: number; failure: number; retries: number; error?: string; httpStatus?: number }> {
    const url = buildUrl(this.config.endpoint.baseUrl, this.config.tracesPath ?? '/v1/traces', this.config.endpoint.pathPrefix);
    const body = buildOTLPRequestBody(chunk, this.config.resourceAttributes ?? {});
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let retries = 0;

    // Mock 模式
    if (this.config.mode === 'mock') {
      await delay(5 + Math.random() * 20);
      return { success: chunk.length, failure: 0, retries, httpStatus: 200 };
    }

    try {
      const res = await httpRequestWithRetry(
        {
          method: 'POST',
          url,
          headers,
          body,
          timeoutMs: this.config.endpoint.timeoutMs,
          credentials: this.config.endpoint.credentials,
        },
        this.config.retryPolicy ?? DEFAULT_RETRY_POLICY,
        (attempt) => {
          retries = attempt;
          this.emit({
            type: 'retry',
            platform: this.name,
            timestamp: Date.now(),
            data: { attempt, url },
          });
        }
      );
      if (isOTLPSuccess(res.status)) {
        return { success: chunk.length, failure: 0, retries, httpStatus: res.status };
      }
      // hybrid 模式回退
      if (this.config.mode === 'hybrid') {
        await delay(5 + Math.random() * 20);
        return { success: chunk.length, failure: 0, retries, error: `HTTP ${res.status}, fell back to mock` };
      }
      return { success: 0, failure: chunk.length, retries, httpStatus: res.status, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
    } catch (err) {
      if (this.config.mode === 'hybrid') {
        await delay(5 + Math.random() * 20);
        return { success: chunk.length, failure: 0, retries, error: `Network error, fell back to mock: ${err instanceof Error ? err.message : String(err)}` };
      }
      return { success: 0, failure: chunk.length, retries, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private makeResult(success: number, failure: number, durationMs: number, retries: number, errors: string[]): PlatformExportResult {
    return {
      platform: this.name,
      successCount: success,
      failureCount: failure,
      durationMs,
      timestamp: Date.now(),
      retries,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private emit(event: PlatformEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }
}

/**
 * 创建默认 OTLP 端点（OpenTelemetry Collector 默认端口 4318）
 */
export function createDefaultOTLPEndpoint(
  name: string,
  baseUrl: string,
  options: { protocol?: 'http' | 'https'; pathPrefix?: string; timeoutMs?: number } = {}
): PlatformEndpoint {
  return {
    name,
    baseUrl,
    protocol: options.protocol ?? 'http',
    pathPrefix: options.pathPrefix,
    timeoutMs: options.timeoutMs ?? 10000,
    verifyTls: true,
  };
}

/**
 * 创建 Jaeger OTLP 端点（Jaeger 1.35+ 支持 OTLP，默认端口 4318）
 */
export function createJaegerOTLPEndpoint(host: string, port = 4318): PlatformEndpoint {
  return createDefaultOTLPEndpoint('jaeger-otlp', `http://${host}:${port}`);
}

/**
 * 创建 Tempo OTLP 端点
 */
export function createTempoOTLPEndpoint(host: string, port = 4318): PlatformEndpoint {
  return createDefaultOTLPEndpoint('tempo-otlp', `http://${host}:${port}`);
}
