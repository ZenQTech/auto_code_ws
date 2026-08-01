/**
 * # ============================================================
 * # OpenFaaS Generator - 函数生成器 (Cycle 56 G56-03)
 * # ============================================================
 * # 核心作用：声明式构造 OpenFaaS Function + Profile + Function Store
 * # 特性：Watchdog 模式 (http/tcp/cluster) + Function Store
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-03 初次创建
 * # ====================================
 */

import type {
  OpenFaasFunction,
  OpenFaasProfile,
  OpenFaasDeployOptions,
  StoreFunction,
  WatchdogConfig,
  FunctionInvocation,
  FunctionInvocationResult,
  FunctionEnvVar,
  FunctionResources,
  FunctionLimits,
  FunctionProbes,
} from './openfaasTypes';
import { OFFICIAL_FUNCTION_STORE, COMMUNITY_FUNCTION_STORE } from './openfaasStore';

// ============================================================
// Function Builder
// ============================================================

/**
 * 创建 OpenFaaS Function
 * @param options 部署选项
 * @returns OpenFaasFunction
 */
export function createOpenFaasFunction(options: OpenFaasDeployOptions): OpenFaasFunction {
  const env: FunctionEnvVar[] = Object.entries(options.environment ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  const labels: Record<string, string> = {
    'faas_function': options.name,
    ...options.labels,
  };

  const annotations: Record<string, string> = {
    'prometheus.io/scrape': 'true',
    'prometheus.io/port': '8080',
    'prometheus.io/path': '/metrics',
    ...options.annotations,
  };

  if (options.readOnlyRootFilesystem) {
    annotations['com.openfaas.readonly_root_filesystem'] = 'true';
  }

  if (options.healthCheckPath) {
    annotations['com.openfaas.healthcheck.path'] = options.healthCheckPath;
  }

  if (options.watchdog) {
    annotations['com.openfaas.watchdog.mode'] = options.watchdog;
  }

  // 资源限制转换为 K8s 风格
  const resources: FunctionResources | undefined = options.resources;
  const limits: FunctionLimits | undefined = options.limits;
  const probes: FunctionProbes | undefined = options.probes;

  return {
    apiVersion: 'openfaas.com/v1',
    kind: 'Function',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'openfaas-fn',
      labels,
      annotations,
    },
    spec: {
      name: options.name,
      image: options.image,
      handler: options.handler,
      trigger: options.trigger ?? 'http',
      environment: env,
      resources,
      limits,
      probes,
      secrets: options.secrets,
      readOnlyRootFilesystem: options.readOnlyRootFilesystem,
      healthCheckPath: options.healthCheckPath,
      watchdog: options.watchdog,
    },
  };
}

// ============================================================
// Profile Builder
// ============================================================

/**
 * 创建 OpenFaaS Profile（横切配置）
 */
export function createOpenFaasProfile(options: {
  name: string;
  namespace?: string;
  resources?: FunctionResources;
  limits?: FunctionLimits;
  probes?: FunctionProbes;
  environment?: Record<string, string>;
}): OpenFaasProfile {
  return {
    apiVersion: 'openfaas.com/v1',
    kind: 'Profile',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'openfaas-fn',
    },
    spec: {
      resources: options.resources,
      limits: options.limits,
      probes: options.probes,
      environment: options.environment
        ? Object.entries(options.environment).map(([name, value]) => ({ name, value }))
        : undefined,
    },
  };
}

// ============================================================
// Watchdog 配置
// ============================================================

/**
 * 创建 Watchdog 配置
 */
export function buildWatchdogConfig(config: WatchdogConfig): WatchdogConfig {
  return {
    mode: config.mode,
    upstreamUrl: config.upstreamUrl,
    port: config.port,
    clusterFunction: config.clusterFunction,
    timeout: config.timeout ?? 60,
  };
}

// ============================================================
// Function Store
// ============================================================

/**
 * 浏览 Function Store
 * @param filters 过滤条件
 * @returns 匹配的函数列表
 */
export function browseStore(filters: {
  category?: StoreFunction['category'];
  language?: string;
  query?: string;
  officialOnly?: boolean;
}): StoreFunction[] {
  const all = [...OFFICIAL_FUNCTION_STORE, ...COMMUNITY_FUNCTION_STORE];
  return all.filter((fn) => {
    if (filters.category && fn.category !== filters.category) return false;
    if (filters.language && fn.language !== filters.language) return false;
    if (filters.officialOnly && !fn.official) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      if (
        !fn.name.toLowerCase().includes(q) &&
        !fn.title.toLowerCase().includes(q) &&
        !fn.description.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * 从 Store 部署函数
 */
export function deployFromStore(
  storeFunction: StoreFunction,
  overrides?: {
    name?: string;
    environment?: Record<string, string>;
    limits?: Partial<FunctionLimits>;
  }
): OpenFaasFunction {
  return createOpenFaasFunction({
    name: overrides?.name ?? storeFunction.name,
    image: storeFunction.image,
    handler: storeFunction.language,
    trigger: 'http',
    environment: {
      ...storeFunction.env,
      ...overrides?.environment,
    },
    limits: overrides?.limits
      ? {
          maxReplicas: overrides.limits.maxReplicas ?? 5,
          minReplicas: overrides.limits.minReplicas ?? 0,
          ...overrides.limits,
        }
      : { maxReplicas: 5, minReplicas: 0 },
  });
}

/**
 * 获取函数详情
 */
export function getStoreFunction(name: string): StoreFunction | undefined {
  const all = [...OFFICIAL_FUNCTION_STORE, ...COMMUNITY_FUNCTION_STORE];
  return all.find((fn) => fn.name === name);
}

// ============================================================
// 函数调用
// ============================================================

/**
 * 调用 OpenFaaS 函数（mock 实现 - 通过 HTTP 模拟）
 * @param invocation 调用配置
 * @returns 调用结果
 */
export async function invokeFunction(
  invocation: FunctionInvocation
): Promise<FunctionInvocationResult> {
  const start = Date.now();

  // mock 调用（实际生产环境通过 fetch 调用 Gateway）
  const url = `${invocation.gatewayUrl}/function/${invocation.functionName}`;
  const body =
    typeof invocation.body === 'string'
      ? invocation.body
      : JSON.stringify(invocation.body ?? {});

  // mock 返回
  return {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-cold-start': 'false',
    },
    body: JSON.stringify({
      success: true,
      echo: body,
      duration: Date.now() - start,
    }),
    durationMs: Date.now() - start,
    coldStart: Math.random() < 0.1, // 10% 概率冷启动
  };
}

// ============================================================
// 完整应用 Stack
// ============================================================

/**
 * OpenFaaS 完整应用资源包
 */
export interface OpenFaasApplicationStack {
  function: OpenFaasFunction;
  profile?: OpenFaasProfile;
}

/**
 * 构建 OpenFaaS 应用 Stack
 */
export function buildOpenFaasApplicationStack(
  options: OpenFaasDeployOptions & { profileName?: string }
): OpenFaasApplicationStack {
  const func = createOpenFaasFunction(options);
  const profile = options.profileName
    ? createOpenFaasProfile({
        name: options.profileName,
        namespace: options.namespace,
        resources: options.resources,
        limits: options.limits,
        probes: options.probes,
        environment: options.environment,
      })
    : undefined;

  return { function: func, profile };
}

// ============================================================
// YAML 序列化
// ============================================================

/**
 * 将 OpenFaaS 资源序列化为 YAML
 */
export function buildOpenFaasManifestYaml(
  func: OpenFaasFunction,
  profile?: OpenFaasProfile
): string {
  const parts: string[] = [];
  if (profile) parts.push(serializeOpenFaasResource(profile));
  parts.push(serializeOpenFaasResource(func));
  return parts.join('\n---\n');
}

function serializeOpenFaasResource(resource: OpenFaasFunction | OpenFaasProfile): string {
  const lines: string[] = [];
  lines.push(`apiVersion: ${resource.apiVersion}`);
  lines.push(`kind: ${resource.kind}`);
  lines.push('metadata:');
  lines.push(`  name: ${resource.metadata.name}`);
  if (resource.metadata.namespace) {
    lines.push(`  namespace: ${resource.metadata.namespace}`);
  }
  const metadata = resource.metadata as { labels?: Record<string, string>; annotations?: Record<string, string> };
  if (metadata.labels && Object.keys(metadata.labels).length > 0) {
    lines.push('  labels:');
    for (const [k, v] of Object.entries(metadata.labels)) {
      lines.push(`    ${k}: ${v}`);
    }
  }
  if (metadata.annotations && Object.keys(metadata.annotations).length > 0) {
    lines.push('  annotations:');
    for (const [k, v] of Object.entries(metadata.annotations)) {
      lines.push(`    ${k}: "${v}"`);
    }
  }
  lines.push('spec:');
  lines.push(serializeObject(resource.spec as unknown as Record<string, unknown>, 1));
  return lines.join('\n');
}

function serializeObject(obj: Record<string, unknown>, indent: number): string {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          lines.push(`${prefix}- ${serializeObjectInline(item as Record<string, unknown>)}`);
        } else {
          lines.push(`${prefix}- ${item}`);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeObject(value as Record<string, unknown>, indent + 1));
    } else {
      lines.push(`${prefix}${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

function serializeObjectInline(obj: Record<string, unknown>): string {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      entries.push(`${key}: { ${serializeObjectInline(value as Record<string, unknown>)} }`);
    } else {
      entries.push(`${key}: ${value}`);
    }
  }
  return entries.join(', ');
}

// ============================================================
// 函数工具方法
// ============================================================

/**
 * 验证函数名（OpenFaaS 命名规范）
 */
export function validateFunctionName(name: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (name.length === 0) errors.push('函数名不能为空');
  if (name.length > 253) errors.push('函数名不能超过 253 字符');
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(name)) {
    errors.push('函数名只能包含小写字母、数字、连字符和点，必须以字母数字开头和结尾');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 计算函数冷启动估算
 */
export function estimateColdStart(handler: string, memoryLimit?: string): number {
  const baseMs: Record<string, number> = {
    'node18': 80, 'node20': 75,
    'python3.10': 150, 'python3.11': 130,
    'go1.21': 30,
    'java17': 800,
    'ruby3': 200,
    'rust': 25,
    'php8': 180,
    'dockerfile': 200,
  };
  const base = baseMs[handler] ?? 150;
  // 内存越大启动越快
  if (memoryLimit) {
    const mb = parseMemoryMb(memoryLimit);
    if (mb >= 512) return Math.round(base * 0.7);
  }
  return base;
}

/** 解析内存字符串为 MB 数字 (支持 Ki/Mi/Gi/Ti) */
function parseMemoryMb(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*([KMGT]i?)?$/);
  if (!match) return 0;
  const num = parseFloat(match[1]!);
  const unit = match[2] ?? '';
  const multipliers: Record<string, number> = {
    '': 1, 'K': 1 / 1024, 'Ki': 1 / 1024,
    'M': 1, 'Mi': 1,
    'G': 1024, 'Gi': 1024,
    'T': 1024 * 1024, 'Ti': 1024 * 1024,
  };
  return num * (multipliers[unit] ?? 1);
}
