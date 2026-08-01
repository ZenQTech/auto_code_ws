/**
 * # ============================================================
 * # Platform Integration Types - 平台集成类型定义 (Cycle 54)
 * # ============================================================
 * # 核心作用：定义真实可观测性平台接入所需的共享类型
 * # 支持：OTLP / Prometheus remote_write / Grafana / Jaeger / Tempo
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 54 G54-01 初次创建
 * # ====================================
 */

/** HTTP 方法类型 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** 平台凭证类型 */
export type AuthScheme = 'none' | 'basic' | 'bearer' | 'api-key' | 'x-api-key';

/** 平台认证凭证 */
export interface PlatformCredentials {
  /** 认证方案 */
  scheme: AuthScheme;
  /** 用户名（basic） */
  username?: string;
  /** 密码（basic） */
  password?: string;
  /** Bearer Token */
  token?: string;
  /** API Key 头名称 */
  apiKeyHeader?: string;
  /** API Key 值 */
  apiKeyValue?: string;
  /** 自定义头 */
  customHeaders?: Record<string, string>;
}

/** 通用平台端点配置 */
export interface PlatformEndpoint {
  /** 端点名称 */
  name: string;
  /** 基础 URL */
  baseUrl: string;
  /** 端口（可选） */
  port?: number;
  /** 协议 */
  protocol: 'http' | 'https';
  /** 路径前缀 */
  pathPrefix?: string;
  /** 认证凭证 */
  credentials?: PlatformCredentials;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 启用 TLS 验证 */
  verifyTls?: boolean;
  /** 额外元数据 */
  metadata?: Record<string, string>;
}

/** 平台传输模式 */
export type TransportMode = 'mock' | 'real' | 'hybrid';

/** 平台连接状态 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting'
  | 'disabled';

/** 平台健康检查结果 */
export interface HealthCheckResult {
  /** 平台名称 */
  platform: string;
  /** 状态 */
  status: ConnectionStatus;
  /** 延迟（毫秒） */
  latencyMs: number;
  /** 时间戳 */
  timestamp: number;
  /** 错误信息 */
  error?: string;
  /** 详细响应 */
  details?: Record<string, unknown>;
}

/** 重试策略 */
export interface RetryPolicy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelayMs: number;
  /** 最大延迟（毫秒） */
  maxDelayMs: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 抖动因子 0-1 */
  jitterFactor: number;
}

/** 默认重试策略 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/** 导出结果 */
export interface PlatformExportResult {
  /** 平台名称 */
  platform: string;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failureCount: number;
  /** 持续时间（毫秒） */
  durationMs: number;
  /** 时间戳 */
  timestamp: number;
  /** 错误 */
  errors?: string[];
  /** HTTP 状态码 */
  httpStatus?: number;
  /** 重试次数 */
  retries: number;
}

/** 指标类型 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

/** 标签 */
export type Labels = Record<string, string>;

/** 通用指标数据 */
export interface MetricData {
  /** 指标名称 */
  name: string;
  /** 指标类型 */
  type: MetricType;
  /** 标签 */
  labels: Labels;
  /** 值 */
  value: number;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 帮助说明 */
  help?: string;
  /** 单位 */
  unit?: string;
}

/** 直方图桶 */
export interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

/** 完整直方图 */
export interface HistogramData {
  name: string;
  labels: Labels;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  timestamp: number;
  help?: string;
  unit?: string;
}

/** Span 数据 OTLP 形式 */
export interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number } }[];
  status: { code: number; message?: string };
  events?: { timeUnixNano: string; name: string; attributes?: { key: string; value: unknown }[] }[];
  links?: { traceId: string; spanId: string; attributes?: { key: string; value: unknown }[] }[];
}

/** 事件监听器 */
export type PlatformEventListener = (event: PlatformEvent) => void;

/** 平台事件 */
export interface PlatformEvent {
  type:
    | 'connected'
    | 'disconnected'
    | 'export-success'
    | 'export-failure'
    | 'retry'
    | 'health-check'
    | 'config-updated'
    | 'error';
  platform: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 通用客户端配置 */
export interface ClientConfig {
  /** 传输模式 */
  mode: TransportMode;
  /** 端点配置 */
  endpoint: PlatformEndpoint;
  /** 重试策略 */
  retryPolicy?: RetryPolicy;
  /** 是否启用 */
  enabled?: boolean;
  /** 客户端标签（用于标识来源） */
  clientMetadata?: Record<string, string>;
}

/** 创建通用配置 */
export function createDefaultEndpoint(
  name: string,
  baseUrl: string,
  options: { protocol?: 'http' | 'https'; pathPrefix?: string; timeoutMs?: number } = {}
): PlatformEndpoint {
  return {
    name,
    baseUrl,
    protocol: options.protocol ?? 'https',
    pathPrefix: options.pathPrefix,
    timeoutMs: options.timeoutMs ?? 10000,
    verifyTls: true,
  };
}
