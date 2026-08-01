/**
 * # ============================================================
 * # Jaeger/Tempo 分布式追踪后端适配器 (Cycle 54 G54-04)
 * # ============================================================
 * # 核心作用：统一抽象 Jaeger 和 Tempo 的 HTTP API
 * # 支持：服务列表 / 操作列表 / Trace 查询 / Span 详情 / 服务拓扑
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 54 G54-04 初次创建
 * # ====================================
 */

import type {
  ClientConfig,
  HealthCheckResult,
  PlatformEndpoint,
  PlatformEvent,
  PlatformEventListener,
  PlatformExportResult,
} from './platformTypes';
import { DEFAULT_RETRY_POLICY } from './platformTypes';
import { httpRequest, httpRequestWithRetry, buildUrl, delay } from './httpClient';
import type { SpanData } from '../observability/traceTypes';

/** 后端类型 */
export type TraceBackendType = 'jaeger' | 'tempo' | 'zipkin' | 'otlp-http';

/** 服务信息 */
export interface TraceService {
  name: string;
  operations?: string[];
}

/** Trace 搜索结果 */
export interface TraceSearchResult {
  traceId: string;
  rootService?: string;
  rootOperation?: string;
  startTimeMs: number;
  durationMs: number;
  spanCount: number;
  services: string[];
}

/** 详细 Trace */
export interface TraceDetail {
  traceId: string;
  spans: SpanData[];
  processes: Record<string, { serviceName: string; tags: Record<string, string> }>;
  warnings?: string[];
}

/** 通用搜索参数 */
export interface TraceSearchParams {
  service?: string;
  operation?: string;
  tags?: Record<string, string>;
  minDurationMs?: number;
  maxDurationMs?: number;
  lookbackMinutes?: number;
  limit?: number;
  startTimeMs?: number;
  endTimeMs?: number;
}

export interface TraceBackendConfig extends ClientConfig {
  /** 后端类型 */
  backendType: TraceBackendType;
  /** Trace ID 字符长度（用于验证） */
  traceIdLength?: number;
}

/** Jaeger Span JSON 格式 */
interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references?: Array<{ refType: string; traceID: string; spanID: string }>;
  startTime: number; // microseconds
  duration: number; // microseconds
  tags?: Array<{ key: string; type: string; value: unknown }>;
  logs?: Array<{ timestamp: number; fields: Array<{ key: string; type: string; value: unknown }> }>;
  processID: string;
  warnings?: string[];
}

interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName: string; tags: Array<{ key: string; value: unknown }> }>;
  warnings?: string[];
}

interface JaegerSearchResponse {
  data?: Array<{
    traceID: string;
    processes: Record<string, { serviceName: string }>;
    spans: JaegerSpan[];
  }>;
  total?: number;
  limit?: number;
  offset?: number;
  errors?: Array<{ code: number; msg: string }>;
}

/** Tempo Trace 格式 */
interface TempoTraceResponse {
  batches?: Array<{
    resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: Array<{
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        name: string;
        kind: string;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number } }>;
        status?: { code: number; message?: string };
        events?: Array<{ timeUnixNano: string; name: string; attributes?: Array<{ key: string; value: { stringValue?: string } }> }>;
      }>;
    }>;
  }>;
}

interface TempoSearchResponse {
  traces?: Array<{
    traceID: string;
    rootServiceName: string;
    rootTraceName: string;
    startTimeUnixNano: string;
    durationMs: number;
    spanSet?: { spans?: Array<{ spanID: string }> };
  }>;
}

/**
 * 将 Jaeger Span 转换为内部 SpanData 格式
 */
export function convertJaegerSpan(span: JaegerSpan, processes: Record<string, { serviceName: string; tags?: Array<{ key: string; value: unknown }> }>): SpanData {
  const process = processes[span.processID];
  const attributes: Record<string, string | number | boolean> = {};
  for (const tag of span.tags ?? []) {
    if (tag.value !== undefined && tag.value !== null) {
      attributes[tag.key] = tag.value as string | number | boolean;
    }
  }
  if (process?.tags) {
    for (const tag of process.tags) {
      if (tag.value !== undefined && tag.value !== null) {
        attributes[tag.key] = tag.value as string | number | boolean;
      }
    }
  }

  // 查找 parent span ID
  let parentSpanId: string | undefined;
  for (const ref of span.references ?? []) {
    if (ref.refType === 'CHILD_OF' || ref.refType === 'FOLLOWS_FROM') {
      parentSpanId = ref.spanID;
      break;
    }
  }

  // 转换 logs 到 events
  const events = (span.logs ?? []).map((log) => {
    const eventAttrs: Record<string, string | number | boolean> = {};
    for (const f of log.fields) {
      if (f.value !== undefined && f.value !== null) {
        eventAttrs[f.key] = f.value as string | number | boolean;
      }
    }
    return {
      name: 'event',
      timestamp: Math.floor(log.timestamp / 1000),
      attributes: eventAttrs,
    };
  });

  // 检查错误
  const errorTag = span.tags?.find((t) => t.key === 'error' && t.value === true);
  const status = errorTag
    ? { code: 'ERROR' as const, message: 'Jaeger error tag' }
    : { code: 'OK' as const };

  return {
    traceId: span.traceID.toLowerCase(),
    spanId: span.spanID.toLowerCase(),
    parentSpanId: parentSpanId?.toLowerCase(),
    name: span.operationName,
    kind: 'SPAN_KIND_INTERNAL',
    startTimeMs: Math.floor(span.startTime / 1000),
    endTimeMs: Math.floor((span.startTime + span.duration) / 1000),
    durationMs: Math.floor(span.duration / 1000),
    attributes,
    status,
    events,
    links: [],
  };
}

/**
 * 将 Tempo Span 转换为内部 SpanData
 */
export function convertTempoSpan(span: TempoTraceResponse['batches'] extends Array<infer B> ? (B extends { scopeSpans: Array<{ spans: Array<infer S> }> } ? S : never) : never): SpanData {
  const attributes: Record<string, string | number | boolean> = {};
  for (const attr of span.attributes ?? []) {
    const v = attr.value;
    if (v.stringValue !== undefined) attributes[attr.key] = v.stringValue;
    else if (v.intValue !== undefined) attributes[attr.key] = Number(v.intValue);
    else if (v.boolValue !== undefined) attributes[attr.key] = v.boolValue;
    else if (v.doubleValue !== undefined) attributes[attr.key] = v.doubleValue;
  }
  const events = (span.events ?? []).map((e) => {
    const eventAttrs: Record<string, string | number | boolean> = {};
    for (const attr of e.attributes ?? []) {
      if (attr.value.stringValue !== undefined) eventAttrs[attr.key] = attr.value.stringValue;
    }
    return {
      name: e.name,
      timestamp: Math.floor(Number(e.timeUnixNano) / 1_000_000),
      attributes: eventAttrs,
    };
  });
  const status = span.status?.code === 2 ? { code: 'ERROR' as const, message: span.status.message } : { code: 'OK' as const };
  return {
    traceId: span.traceId.toLowerCase(),
    spanId: span.spanId.toLowerCase(),
    parentSpanId: span.parentSpanId?.toLowerCase(),
    name: span.name,
    kind: span.kind || 'SPAN_KIND_INTERNAL',
    startTimeMs: Math.floor(Number(span.startTimeUnixNano) / 1_000_000),
    endTimeMs: Math.floor(Number(span.endTimeUnixNano) / 1_000_000),
    durationMs: Math.floor((Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) / 1_000_000),
    attributes,
    status,
    events,
    links: [],
  };
}

/**
 * 解析 Jaeger 搜索响应
 */
export function parseJaegerSearchResponse(res: JaegerSearchResponse): TraceSearchResult[] {
  if (!res.data) return [];
  return res.data.map((trace) => {
    const services = new Set<string>();
    for (const p of Object.values(trace.processes ?? {})) {
      services.add(p.serviceName);
    }
    const rootSpan = trace.spans.find((s) => !s.references || s.references.length === 0);
    const minStart = Math.min(...trace.spans.map((s) => s.startTime));
    const maxEnd = Math.max(...trace.spans.map((s) => s.startTime + s.duration));
    return {
      traceId: trace.traceID,
      rootService: rootSpan ? trace.processes?.[rootSpan.processID]?.serviceName : undefined,
      rootOperation: rootSpan?.operationName,
      startTimeMs: Math.floor(minStart / 1000),
      durationMs: Math.floor((maxEnd - minStart) / 1000),
      spanCount: trace.spans.length,
      services: Array.from(services),
    };
  });
}

/**
 * 解析 Jaeger Trace 详情
 */
export function parseJaegerTrace(trace: JaegerTrace): TraceDetail {
  return {
    traceId: trace.traceID,
    spans: trace.spans.map((s) => convertJaegerSpan(s, trace.processes ?? {})),
    processes: Object.fromEntries(
      Object.entries(trace.processes ?? {}).map(([k, v]) => [
        k,
        {
          serviceName: v.serviceName,
          tags: Object.fromEntries((v.tags ?? []).map((t) => [t.key, String(t.value)])),
        },
      ])
    ),
    warnings: trace.warnings,
  };
}

/**
 * 解析 Tempo 搜索响应
 */
export function parseTempoSearchResponse(res: TempoSearchResponse): TraceSearchResult[] {
  if (!res.traces) return [];
  return res.traces.map((t) => ({
    traceId: t.traceID,
    rootService: t.rootServiceName,
    rootOperation: t.rootTraceName,
    startTimeMs: Math.floor(Number(t.startTimeUnixNano) / 1_000_000),
    durationMs: t.durationMs ?? 0,
    spanCount: t.spanSet?.spans?.length ?? 0,
    services: [t.rootServiceName],
  }));
}

/**
 * 解析 Tempo Trace 详情
 */
export function parseTempoTrace(trace: TempoTraceResponse): TraceDetail {
  const spans: SpanData[] = [];
  const processes: Record<string, { serviceName: string; tags: Record<string, string> }> = {};
  for (const batch of trace.batches ?? []) {
    const serviceName = batch.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue ?? 'unknown';
    processes['p1'] = { serviceName, tags: { 'service.name': serviceName } };
    for (const ss of batch.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const converted = convertTempoSpan(span as never);
        // 修复 processID
        spans.push({
          ...converted,
          attributes: { ...converted.attributes, 'service.name': serviceName },
        });
      }
    }
  }
  return {
    traceId: spans[0]?.traceId ?? '',
    spans,
    processes,
  };
}

/**
 * 追踪后端适配器
 * 统一抽象 Jaeger 和 Tempo 的 API
 */
export class TraceBackendAdapter {
  readonly name: string;
  private readonly config: TraceBackendConfig;
  private readonly listeners: Set<PlatformEventListener> = new Set();
  private readonly history: PlatformExportResult[] = [];
  private running = false;

  constructor(config: TraceBackendConfig) {
    this.config = {
      ...config,
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
      enabled: config.enabled ?? true,
      traceIdLength: config.traceIdLength ?? 32,
    };
    this.name = `trace-${config.backendType}`;
  }

  async start(): Promise<void> {
    this.running = true;
    this.emit({ type: 'connected', platform: this.name, timestamp: Date.now() });
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.emit({ type: 'disconnected', platform: this.name, timestamp: Date.now() });
  }

  /**
   * 列出所有服务
   */
  async listServices(): Promise<TraceService[]> {
    if (!this.running) return [];
    if (this.config.mode === 'mock') {
      await delay(5);
      return [
        { name: 'api-gateway', operations: ['GET /api/users', 'POST /api/orders'] },
        { name: 'user-service', operations: ['GetUser', 'CreateUser'] },
        { name: 'order-service', operations: ['ProcessOrder', 'CancelOrder'] },
        { name: 'payment-service', operations: ['Charge', 'Refund'] },
      ];
    }
    const path = this.config.backendType === 'jaeger' ? '/api/services' : '/api/search/tags';
    const url = buildUrl(this.config.endpoint.baseUrl, path, this.config.endpoint.pathPrefix);
    try {
      const res = await httpRequest({
        method: 'GET',
        url,
        timeoutMs: this.config.endpoint.timeoutMs,
        credentials: this.config.endpoint.credentials,
      });
      const data = res.body ? JSON.parse(res.body) : {};
      if (this.config.backendType === 'jaeger') {
        return (data.data ?? []).map((name: string) => ({ name }));
      }
      // Tempo 返回 tag keys，转为服务名
      return (data.tagValues ?? []).map((name: string) => ({ name }));
    } catch {
      return [];
    }
  }

  /**
   * 列出服务的操作
   */
  async listOperations(service: string): Promise<string[]> {
    if (!this.running) return [];
    if (this.config.mode === 'mock') {
      await delay(3);
      return ['GET /api/users', 'POST /api/orders', 'PUT /api/users/:id'];
    }
    if (this.config.backendType === 'jaeger') {
      const url = buildUrl(
        this.config.endpoint.baseUrl,
        `/api/services/${encodeURIComponent(service)}/operations`,
        this.config.endpoint.pathPrefix
      );
      try {
        const res = await httpRequest({
          method: 'GET',
          url,
          timeoutMs: this.config.endpoint.timeoutMs,
          credentials: this.config.endpoint.credentials,
        });
        const data = res.body ? JSON.parse(res.body) : {};
        return (data.data ?? []) as string[];
      } catch {
        return [];
      }
    }
    // Tempo 不直接支持 operations
    return [];
  }

  /**
   * 搜索 Traces
   */
  async searchTraces(params: TraceSearchParams = {}): Promise<TraceSearchResult[]> {
    if (!this.running) return [];
    if (this.config.mode === 'mock') {
      await delay(20);
      const now = Date.now();
      return Array.from({ length: Math.min(params.limit ?? 10, 20) }, (_, i) => ({
        traceId: 'mock' + i.toString(16).padStart(30, '0'),
        rootService: 'api-gateway',
        rootOperation: 'GET /api/users',
        startTimeMs: now - i * 60_000,
        durationMs: 100 + Math.floor(Math.random() * 500),
        spanCount: 5 + Math.floor(Math.random() * 20),
        services: ['api-gateway', 'user-service', 'order-service'],
      }));
    }
    const url = this.buildSearchUrl(params);
    let retries = 0;
    try {
      const res = await httpRequestWithRetry(
        {
          method: 'GET',
          url,
          timeoutMs: this.config.endpoint.timeoutMs,
          credentials: this.config.endpoint.credentials,
        },
        this.config.retryPolicy ?? DEFAULT_RETRY_POLICY,
        (attempt) => { retries = attempt; }
      );
      this.history.push({ platform: this.name, successCount: 1, failureCount: 0, durationMs: 0, timestamp: Date.now(), retries, httpStatus: res.status });
      const data = res.body ? JSON.parse(res.body) : {};
      if (this.config.backendType === 'jaeger') {
        return parseJaegerSearchResponse(data as JaegerSearchResponse);
      }
      return parseTempoSearchResponse(data as TempoSearchResponse);
    } catch (err) {
      this.history.push({ platform: this.name, successCount: 0, failureCount: 1, durationMs: 0, timestamp: Date.now(), retries, errors: [String(err)] });
      return [];
    }
  }

  /**
   * 获取 Trace 详情
   */
  async getTrace(traceId: string): Promise<TraceDetail | null> {
    if (!this.running) return null;
    if (this.config.mode === 'mock') {
      await delay(15);
      const traceIdHex = traceId.toLowerCase().padStart(32, '0');
      return {
        traceId: traceIdHex,
        spans: [
          {
            traceId: traceIdHex,
            spanId: 'a'.repeat(16),
            name: 'GET /api/users',
            kind: 'SPAN_KIND_SERVER',
            startTimeMs: Date.now() - 1000,
            endTimeMs: Date.now(),
            durationMs: 1000,
            attributes: { 'http.method': 'GET', 'http.status_code': 200, 'service.name': 'api-gateway' },
            status: { code: 'OK' },
            events: [],
            links: [],
          },
          {
            traceId: traceIdHex,
            spanId: 'b'.repeat(16),
            parentSpanId: 'a'.repeat(16),
            name: 'GetUser',
            kind: 'SPAN_KIND_CLIENT',
            startTimeMs: Date.now() - 800,
            endTimeMs: Date.now() - 100,
            durationMs: 700,
            attributes: { 'db.system': 'postgres', 'service.name': 'user-service' },
            status: { code: 'OK' },
            events: [],
            links: [],
          },
        ],
        processes: {
          p1: { serviceName: 'api-gateway', tags: { 'service.name': 'api-gateway' } },
          p2: { serviceName: 'user-service', tags: { 'service.name': 'user-service' } },
        },
      };
    }
    const url = buildUrl(this.config.endpoint.baseUrl, `/api/traces/${encodeURIComponent(traceId)}`, this.config.endpoint.pathPrefix);
    try {
      const res = await httpRequest({
        method: 'GET',
        url,
        timeoutMs: this.config.endpoint.timeoutMs,
        credentials: this.config.endpoint.credentials,
      });
      const data = res.body ? JSON.parse(res.body) : {};
      if (this.config.backendType === 'jaeger') {
        // Jaeger 返回 { data: [trace] } 或直接是 trace
        const traces = data.data ?? [data];
        if (!traces || traces.length === 0) return null;
        return parseJaegerTrace(traces[0] as JaegerTrace);
      }
      return parseTempoTrace(data as TempoTraceResponse);
    } catch {
      return null;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    if (this.config.mode === 'mock' || !this.config.enabled) {
      return { platform: this.name, status: 'connected', latencyMs: 0, timestamp: Date.now(), details: { mode: 'mock', backend: this.config.backendType } };
    }
    const path = this.config.backendType === 'jaeger' ? '/' : '/api/status/version';
    const url = buildUrl(this.config.endpoint.baseUrl, path, this.config.endpoint.pathPrefix);
    try {
      const res = await httpRequest({
        method: 'GET',
        url,
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
   * 获取后端类型
   */
  getBackendType(): TraceBackendType {
    return this.config.backendType;
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
   * 获取历史
   */
  getHistory(): PlatformExportResult[] {
    return [...this.history];
  }

  /**
   * 更新端点
   */
  updateEndpoint(endpoint: PlatformEndpoint): void {
    this.config.endpoint = endpoint;
    this.emit({ type: 'config-updated', platform: this.name, timestamp: Date.now(), data: { endpoint } });
  }

  private buildSearchUrl(params: TraceSearchParams): string {
    const base = buildUrl(this.config.endpoint.baseUrl, '/api/traces', this.config.endpoint.pathPrefix);
    const query = new URLSearchParams();
    if (this.config.backendType === 'jaeger') {
      if (params.service) query.set('service', params.service);
      if (params.operation) query.set('operation', params.operation);
      if (params.tags) {
        for (const [k, v] of Object.entries(params.tags)) {
          query.set('tag', `${k}:${v}`);
        }
      }
      if (params.minDurationMs !== undefined) query.set('minDuration', String(params.minDurationMs * 1000));
      if (params.maxDurationMs !== undefined) query.set('maxDuration', String(params.maxDurationMs * 1000));
      if (params.lookbackMinutes !== undefined) query.set('lookback', `${params.lookbackMinutes}m`);
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      if (params.startTimeMs !== undefined) query.set('start', String(Math.floor(params.startTimeMs * 1000)));
      if (params.endTimeMs !== undefined) query.set('end', String(Math.floor(params.endTimeMs * 1000)));
    } else {
      // Tempo
      if (params.service) query.set('service', params.service);
      if (params.operation) query.set('name', params.operation);
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      if (params.startTimeMs !== undefined) query.set('start', String(params.startTimeMs));
      if (params.endTimeMs !== undefined) query.set('end', String(params.endTimeMs));
    }
    return `${base}?${query.toString()}`;
  }

  private emit(event: PlatformEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }
}

/**
 * 创建 Jaeger 端点（默认端口 16686 是 UI，16685 是 collector HTTP API）
 */
export function createJaegerEndpoint(host: string, port = 16686, basicAuth?: { username: string; password: string }): PlatformEndpoint {
  return {
    name: 'jaeger',
    baseUrl: `http://${host}:${port}`,
    protocol: 'http',
    timeoutMs: 10000,
    verifyTls: false,
    credentials: basicAuth ? { scheme: 'basic', username: basicAuth.username, password: basicAuth.password } : undefined,
  };
}

/**
 * 创建 Tempo 端点
 */
export function createTempoEndpoint(host: string, port = 3200, basicAuth?: { username: string; password: string }): PlatformEndpoint {
  return {
    name: 'tempo',
    baseUrl: `http://${host}:${port}`,
    protocol: 'http',
    timeoutMs: 10000,
    verifyTls: false,
    credentials: basicAuth ? { scheme: 'basic', username: basicAuth.username, password: basicAuth.password } : undefined,
  };
}

/**
 * 验证 Trace ID 格式
 */
export function isValidTraceId(traceId: string, expectedLength = 32): boolean {
  return /^[0-9a-f]+$/i.test(traceId) && traceId.length === expectedLength;
}
