/**
 * # ============================================================
 * # OpenFaaS - 函数类型定义 (Cycle 56 G56-03)
 * # ============================================================
 * # 核心作用：定义 OpenFaaS Function CRD 类型
 * # 资源：Function / Profile / Function Store
 * # 规范：openfaas.com/v1
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-03 初次创建
 * # ====================================
 */

/** OpenFaaS API 版本 */
export type OpenFaasApiVersion = 'openfaas.com/v1';

/** 函数 Handler 语言 */
export type FunctionHandler =
  | 'node18'
  | 'node20'
  | 'python3.10'
  | 'python3.11'
  | 'go1.21'
  | 'java17'
  | 'ruby3'
  | 'csharp'
  | 'rust'
  | 'php8'
  | 'dockerfile';

/** 函数触发器（HTTP/Kafka/Cron/Event） */
export type FunctionTrigger = 'http' | 'kafka' | 'cron' | 'event' | 'redis';

/** 函数环境变量 */
export interface FunctionEnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: { name: string; key: string };
    configMapKeyRef?: { name: string; key: string };
  };
}

/** 函数资源限制 */
export interface FunctionResources {
  /** 内存限制 */
  memory?: string;
  /** CPU 限制 */
  cpu?: string;
  /** 请求内存 */
  requestsMemory?: string;
  /** 请求 CPU */
  requestsCpu?: string;
}

/** 函数探针 */
export interface FunctionProbes {
  liveness?: {
    httpGet?: { path: string; port: number };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    failureThreshold?: number;
  };
  readiness?: {
    httpGet?: { path: string; port: number };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    failureThreshold?: number;
  };
}

/** 函数限制配置 */
export interface FunctionLimits {
  /** 最大副本数 */
  maxReplicas?: number;
  /** 最小副本数 */
  minReplicas?: number;
  /** 并发限制（每次执行请求数） */
  concurrency?: number;
  /** 请求超时（秒） */
  timeout?: number;
  /** 每秒请求限制 */
  requestsPerSecond?: number;
  /** 输入字节限制 */
  inputBytesLimit?: number;
  /** 输出字节限制 */
  outputBytesLimit?: number;
  /** 标签 */
  labels?: Record<string, string>;
  /** 注解 */
  annotations?: Record<string, string>;
}

/** 函数 Spec */
export interface FunctionSpec {
  /** 函数名称 */
  name: string;
  /** 镜像 */
  image: string;
  /** Handler 语言 */
  handler?: FunctionHandler;
  /** 触发器类型 */
  trigger?: FunctionTrigger;
  /** 环境变量 */
  environment?: FunctionEnvVar[];
  /** 资源限制 */
  resources?: FunctionResources;
  /** 探针 */
  probes?: FunctionProbes;
  /** 函数限制 */
  limits?: FunctionLimits;
  /** 标签 */
  labels?: Record<string, string>;
  /** 注解 */
  annotations?: Record<string, string>;
  /** Secrets 挂载 */
  secrets?: string[];
  /** ConfigMap 挂载 */
  configMaps?: Array<{ name: string; mountPath: string }>;
  /** 只读根文件系统 */
  readOnlyRootFilesystem?: boolean;
  /** 健康检查路径 */
  healthCheckPath?: string;
  /** 自定义健康检查 */
  customHealthCheck?: boolean;
  /** Watchdog 模式 */
  watchdog?: 'http' | 'tcp' | 'cluster';
}

/** OpenFaaS Function CRD */
export interface OpenFaasFunction {
  apiVersion: 'openfaas.com/v1';
  kind: 'Function';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
  };
  spec: FunctionSpec;
}

/** OpenFaaS Profile 资源（横切配置） */
export interface OpenFaasProfile {
  apiVersion: 'openfaas.com/v1';
  kind: 'Profile';
  metadata: {
    name: string;
    namespace?: string;
  };
  spec: {
    /** 资源限制 */
    resources?: FunctionResources;
    /** 探针 */
    probes?: FunctionProbes;
    /** 限制 */
    limits?: FunctionLimits;
    /** 环境变量 */
    environment?: FunctionEnvVar[];
  };
}

/** OpenFaaS Function Store 项目 */
export interface StoreFunction {
  /** 函数名称 */
  name: string;
  /** 显示名称 */
  title: string;
  /** 描述 */
  description: string;
  /** 镜像 */
  image: string;
  /** 分类 */
  category: 'AI/ML' | 'Data' | 'HTTP' | 'Storage' | 'Utility' | 'Security';
  /** 编程语言 */
  language: FunctionHandler;
  /** 标签 */
  tags: string[];
  /** 仓库 */
  repository: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否官方 */
  official?: boolean;
}

/** Watchdog 模式 */
export type WatchdogMode = 'http' | 'tcp' | 'cluster';

/** Watchdog 配置 */
export interface WatchdogConfig {
  mode: WatchdogMode;
  /** 上游 URL（HTTP 模式） */
  upstreamUrl?: string;
  /** 端口（TCP 模式） */
  port?: number;
  /** 集群函数名称（cluster 模式） */
  clusterFunction?: string;
  /** 超时 */
  timeout?: number;
}

/** OpenFaaS 部署选项 */
export interface OpenFaasDeployOptions {
  name: string;
  namespace?: string;
  image: string;
  handler?: FunctionHandler;
  trigger?: FunctionTrigger;
  environment?: Record<string, string>;
  secrets?: string[];
  resources?: FunctionResources;
  limits?: FunctionLimits;
  probes?: FunctionProbes;
  watchdog?: WatchdogMode;
  readOnlyRootFilesystem?: boolean;
  healthCheckPath?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/** 函数调用模式 */
export interface FunctionInvocation {
  /** 函数名称 */
  functionName: string;
  /** 网关 URL */
  gatewayUrl: string;
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 请求体 */
  body?: string | Record<string, unknown>;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 超时（毫秒） */
  timeoutMs?: number;
}

/** 函数调用结果 */
export interface FunctionInvocationResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  coldStart: boolean;
}
