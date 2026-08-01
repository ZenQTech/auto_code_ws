/**
 * # ============================================================
 * # OpenTelemetry 追踪系统 - 核心类型定义 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：定义分布式追踪所需的所有数据类型
 * # 参考标准：W3C Trace Context + OpenTelemetry Specification
 * # 输入：Span 事件、Trace 标识符、属性
 * # 输出：标准化 Span/Trace 数据结构
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
 * # ====================================
 */

/** Trace 标识符 (16 字节 hex) */
export type TraceId = string;

/** Span 标识符 (8 字节 hex) */
export type SpanId = string;

/** Span 状态码 */
export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

/** Span 类型 (客户端/服务端/内部) */
export type SpanKind = 'client' | 'server' | 'internal' | 'producer' | 'consumer';

/** Span 属性值类型 */
export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];

/** Span 属性集合 */
export type Attributes = Record<string, AttributeValue>;

/** Span 事件 */
export interface SpanEvent {
  /** 事件名称 */
  name: string;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 事件属性 */
  attributes?: Attributes;
}

/** Span 链接 (与其他 Span 的关联) */
export interface SpanLink {
  /** 关联的 Trace ID */
  traceId: TraceId;
  /** 关联的 Span ID */
  spanId: SpanId;
  /** 链接属性 */
  attributes?: Attributes;
  /** 跟踪标志位 */
  traceFlags?: number;
}

/** Span 状态 */
export interface SpanStatus {
  /** 状态码 */
  code: SpanStatusCode;
  /** 状态消息 */
  message?: string;
}

/** 采样标志位 (W3C Trace Context) */
export const TRACE_FLAG_SAMPLED = 0x01;
export const TRACE_FLAG_NONE = 0x00;

/** 采样决策 */
export type SamplingDecision = 'record-and-sample' | 'record-only' | 'drop';

/** Span 完整定义 */
export interface SpanData {
  /** Trace ID */
  traceId: TraceId;
  /** Span ID */
  spanId: SpanId;
  /** 父 Span ID (顶级 Span 无父) */
  parentSpanId?: SpanId;
  /** 操作名称 (例如: HTTP GET /api/users) */
  name: string;
  /** Span 类型 */
  kind: SpanKind;
  /** 开始时间 (毫秒) */
  startTimeMs: number;
  /** 结束时间 (毫秒) */
  endTimeMs?: number;
  /** 持续时间 (毫秒) */
  durationMs?: number;
  /** Span 属性 */
  attributes: Attributes;
  /** 事件列表 */
  events: SpanEvent[];
  /** 链接列表 */
  links: SpanLink[];
  /** Span 状态 */
  status: SpanStatus;
  /** 资源 (服务信息) */
  resource: Resource;
  /** 是否采样 */
  sampled: boolean;
}

/** 资源 (服务实例信息) */
export interface Resource {
  /** 服务名称 */
  serviceName: string;
  /** 服务版本 */
  serviceVersion: string;
  /** 部署环境 */
  deploymentEnvironment: string;
  /** 主机名 */
  hostName?: string;
  /** 进程 ID */
  processId?: number;
  /** 自定义属性 */
  attributes?: Attributes;
}

/** Trace 上下文 (W3C 标准格式) */
export interface TraceContext {
  /** Trace ID */
  traceId: TraceId;
  /** 当前 Span ID (parent) */
  spanId: SpanId;
  /** 跟踪标志 */
  traceFlags: number;
  /** Trace 状态 */
  traceState?: string;
}

/** Span 导出器接口 */
export interface SpanExporter {
  /** 导出器名称 */
  name: string;
  /** 启动导出器 */
  start(): Promise<void>;
  /** 关闭导出器 */
  shutdown(): Promise<void>;
  /** 导出 Spans */
  export(spans: SpanData[]): Promise<ExportResult>;
  /** 强制刷新 */
  forceFlush(): Promise<void>;
}

/** 导出结果 */
export interface ExportResult {
  /** 导出器名称 */
  exporter: string;
  /** 成功导出的 Span 数 */
  exportedCount: number;
  /** 失败的 Span 数 */
  failedCount: number;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/** Span 处理器接口 */
export interface SpanProcessor {
  /** 处理器名称 */
  name: string;
  /** Span 启动时调用 */
  onStart(span: SpanData): void;
  /** Span 结束时调用 */
  onEnd(span: SpanData): void;
  /** 关闭处理器 */
  shutdown(): Promise<void>;
  /** 强制刷新 */
  forceFlush(): Promise<void>;
}

/** 采样器接口 */
export interface Sampler {
  /** 采样器名称 */
  name: string;
  /** 采样器描述 */
  description: string;
  /** 决定是否采样 */
  shouldSample(context: TraceContext, name: string, attributes?: Attributes): SamplingResult;
}

/** 采样结果 */
export interface SamplingResult {
  /** 决策 */
  decision: SamplingDecision;
  /** 采样后属性 */
  attributes?: Attributes;
  /** 跟踪状态 */
  traceState?: string;
}

/** Tracer 配置 */
export interface TracerConfig {
  /** 服务名称 */
  serviceName: string;
  /** 服务版本 */
  serviceVersion: string;
  /** 部署环境 */
  deploymentEnvironment: string;
  /** 采样率 (0-1) */
  samplingRate: number;
  /** 最大缓冲 Span 数 */
  maxBufferedSpans: number;
  /** 批量导出大小 */
  batchSize: number;
  /** 批量导出间隔 (毫秒) */
  batchIntervalMs: number;
  /** 是否启用 */
  enabled: boolean;
  /** 自定义资源属性 */
  resourceAttributes?: Attributes;
}

/** Trace 报告 */
export interface TraceReport {
  /** 报告 ID */
  id: string;
  /** 服务名称 */
  serviceName: string;
  /** 时间戳 */
  timestamp: number;
  /** 总耗时 */
  durationMs: number;
  /** 处理的 Span 数 */
  totalSpans: number;
  /** 采样的 Span 数 */
  sampledSpans: number;
  /** 丢弃的 Span 数 */
  droppedSpans: number;
  /** 错误 Span 数 */
  errorSpans: number;
  /** 慢 Span 数 (> P95) */
  slowSpans: number;
  /** 唯一 Trace 数 */
  uniqueTraces: number;
  /** 导出统计 */
  exportStats: ExportResult[];
  /** Span 列表 */
  spans: SpanData[];
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 追踪事件 */
export type TraceEvent =
  | { type: 'span-started'; timestamp: number; spanId: SpanId; traceId: TraceId; name: string }
  | { type: 'span-ended'; timestamp: number; spanId: SpanId; traceId: TraceId; durationMs: number }
  | { type: 'span-exported'; timestamp: number; count: number; exporter: string }
  | { type: 'span-dropped'; timestamp: number; reason: string }
  | { type: 'export-failed'; timestamp: number; exporter: string; error: string }
  | { type: 'sampling-decision'; timestamp: number; traceId: TraceId; decision: SamplingDecision }
  | { type: 'tracer-shutdown'; timestamp: number };

export type TraceListener = (event: TraceEvent) => void;
