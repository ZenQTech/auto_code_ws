/**
 * # ============================================================
 * # Knative Serving Generator - 资源生成器 (Cycle 56 G56-01)
 * # ============================================================
 * # 核心作用：声明式构造 Knative Serving 资源
 * # 资源：Service / Configuration / Route / Revision
 * # 部署策略：rolling / blue-green / canary
 * # 流量切分：百分比切分 + 标签切分 + 蓝绿部署
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-01 初次创建
 * # ====================================
 */

import type {
  KnativeService,
  KnativeConfiguration,
  KnativeRoute,
  KnativeRevision,
  TrafficTarget,
  TrafficSplitConfig,
  KnativeDeployOptions,
  KnativeDeployStrategy,
  AutoScalingAnnotations,
} from './knativeTypes';

// ============================================================
// 自动扩缩容注解
// ============================================================

/**
 * 生成自动扩缩容注解（Knative 约定）
 * @param config 自动扩缩容配置
 * @returns 注解键值对
 */
export function buildAutoScalingAnnotations(
  config: AutoScalingAnnotations = {}
): Record<string, string> {
  const annotations: Record<string, string> = {};

  if (config.minScale !== undefined) {
    annotations['autoscaling.knative.dev/min-scale'] = String(config.minScale);
  }
  if (config.maxScale !== undefined) {
    annotations['autoscaling.knative.dev/max-scale'] = String(config.maxScale);
  }
  if (config.target !== undefined) {
    annotations['autoscaling.knative.dev/metric'] = 'concurrency';
    annotations['autoscaling.knative.dev/target'] = String(config.target);
  }
  if (config.targetUtilizationPercentage !== undefined) {
    annotations['autoscaling.knative.dev/metric'] = 'cpu';
    annotations['autoscaling.knative/dev-target-utilization-percentage'] =
      String(config.targetUtilizationPercentage);
  }
  if (config.allowZero !== undefined) {
    annotations['autoscaling.knative.dev/allow-zero-scale'] = String(config.allowZero);
  }
  if (config.initialScale !== undefined) {
    annotations['autoscaling.knative.dev/initial-scale'] = String(config.initialScale);
  }
  if (config.window) {
    annotations['autoscaling.knative.dev/window'] = config.window;
  }
  if (config.panicThresholdPercentage !== undefined) {
    annotations['autoscaling.knative.dev/panic-threshold-percentage'] =
      String(config.panicThresholdPercentage);
  }
  if (config.panicWindow) {
    annotations['autoscaling.knative.dev/panic-window'] = config.panicWindow;
  }

  return annotations;
}

// ============================================================
// 流量切分
// ============================================================

/**
 * 解析流量切分配置为 TrafficTarget 列表
 * @param config 流量切分配置
 * @returns TrafficTarget 数组
 */
export function buildTrafficTargets(config: TrafficSplitConfig = {}): TrafficTarget[] {
  // 优先级：allToLatest > customSplit > tagSplit > blueGreen
  if (config.allToLatest) {
    return [{ percent: 100, latestRevision: true }];
  }

  if (config.customSplit) {
    const targets: TrafficTarget[] = [];
    let totalPercent = 0;
    for (const [revisionName, percent] of Object.entries(config.customSplit)) {
      targets.push({ percent, revisionName });
      totalPercent += percent;
    }
    if (totalPercent !== 100) {
      throw new Error(
        `流量切分总和必须为 100%，当前为 ${totalPercent}%（revisions: ${Object.keys(config.customSplit).join(', ')}）`
      );
    }
    return targets;
  }

  if (config.tagSplit) {
    const targets: TrafficTarget[] = [];
    let totalPercent = 0;
    for (const [tag, { revisionName, percent }] of Object.entries(config.tagSplit)) {
      targets.push({ percent, revisionName, tag });
      totalPercent += percent;
    }
    if (totalPercent !== 100) {
      throw new Error(`标签流量切分总和必须为 100%，当前为 ${totalPercent}%`);
    }
    return targets;
  }

  if (config.blueGreen) {
    return [
      { percent: config.blueGreen.bluePercent, tag: 'blue' },
      { percent: config.blueGreen.greenPercent, revisionName: 'green', tag: 'green' },
    ];
  }

  // 默认 100% 到 latest
  return [{ percent: 100, latestRevision: true }];
}

// ============================================================
// Revision 名称生成
// ============================================================

/**
 * 生成 Revision 名称（Knative 命名约定：<service-name>-<revision-name>）
 * @param serviceName Service 名称
 * @param imageTag 镜像标签或随机 ID
 * @returns Revision 名称
 */
export function buildRevisionName(serviceName: string, imageTag?: string): string {
  const suffix = imageTag ?? generateRevisionId();
  return `${serviceName}-${sanitizeRevisionSuffix(suffix)}`;
}

/**
 * 生成 Revision ID（基于时间戳的短 ID）
 */
export function generateRevisionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

/**
 * 净化 Revision 后缀（只允许小写字母、数字、点、连字符）
 */
export function sanitizeRevisionSuffix(suffix: string): string {
  return suffix
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .slice(0, 64);
}

// ============================================================
// Service Builder
// ============================================================

/**
 * 创建 Knative Service 资源
 * @param options 部署选项
 * @returns KnativeService 资源
 */
export function createKnativeService(options: KnativeDeployOptions): KnativeService {
  const namespace = options.namespace ?? 'default';
  const strategy: KnativeDeployStrategy = options.strategy ?? 'rolling';

  // 合并注解：自动扩缩容 + 部署策略
  const annotations: Record<string, string> = {
    ...buildAutoScalingAnnotations(options.autoScaling),
  };

  // 部署策略注解
  if (strategy === 'blue-green') {
    annotations['serving.knative.dev/rollout-duration'] = '0s'; // 立即切换
  } else if (strategy === 'canary') {
    annotations['serving.knative.dev/rollout-duration'] = '300s'; // 5 分钟金丝雀
  } else {
    annotations['serving.knative.dev/rollout-duration'] = '60s';
  }

  // 构建容器环境变量
  const env = Object.entries(options.env ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  // 构建 Revision 模板
  const template = {
    metadata: {
      labels: options.labels,
      annotations,
    },
    spec: {
      containers: [
        {
          name: 'user-container',
          image: `${options.image}${options.imageTag ? `:${options.imageTag}` : ''}`,
          ports: options.ports,
          env: env.length > 0 ? env : undefined,
          resources: options.resources
            ? {
                requests: options.resources.requests as Record<string, string> | undefined,
                limits: options.resources.limits as Record<string, string> | undefined,
              }
            : undefined,
        },
      ],
      containerConcurrency: options.containerConcurrency,
      timeoutSeconds: options.timeoutSeconds,
    },
  };

  // 构建流量切分
  const traffic = options.traffic ? buildTrafficTargets(options.traffic) : undefined;

  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: options.name,
      namespace,
      labels: options.labels,
      annotations,
      generation: 1,
    },
    spec: {
      traffic,
      template: template as never,
    },
  };
}

// ============================================================
// Configuration / Route / Revision Builders
// ============================================================

/**
 * 创建 Knative Configuration（Service 的子资源）
 */
export function createKnativeConfiguration(options: KnativeDeployOptions): KnativeConfiguration {
  const namespace = options.namespace ?? 'default';
  const template = {
    metadata: {
      labels: options.labels,
      annotations: buildAutoScalingAnnotations(options.autoScaling),
    },
    spec: {
      containers: [
        {
          name: 'user-container',
          image: `${options.image}${options.imageTag ? `:${options.imageTag}` : ''}`,
        },
      ],
      containerConcurrency: options.containerConcurrency,
      timeoutSeconds: options.timeoutSeconds,
    },
  };

  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Configuration',
    metadata: {
      name: options.name,
      namespace,
      labels: options.labels,
      generation: 1,
    },
    spec: {
      template: template as never,
    },
  };
}

/**
 * 创建 Knative Route
 */
export function createKnativeRoute(options: {
  name: string;
  namespace?: string;
  traffic: TrafficSplitConfig;
  configurationName: string;
  labels?: Record<string, string>;
}): KnativeRoute {
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Route',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'default',
      labels: options.labels,
    },
    spec: {
      traffic: buildTrafficTargets(options.traffic),
    },
  };
}

/**
 * 创建 Knative Revision（手动模式）
 */
export function createKnativeRevision(options: {
  serviceName: string;
  revisionName: string;
  image: string;
  namespace?: string;
  imageTag?: string;
  containerConcurrency?: number;
  timeoutSeconds?: number;
  labels?: Record<string, string>;
}): KnativeRevision {
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Revision',
    metadata: {
      name: options.revisionName,
      namespace: options.namespace ?? 'default',
      labels: {
        'serving.knative.dev/configuration': options.serviceName,
        'serving.knative.dev/configurationGeneration': '1',
        ...options.labels,
      },
      generation: 1,
    },
    spec: {
      configurationRef: {
        apiVersion: 'serving.knative.dev/v1',
        kind: 'Configuration',
        name: options.serviceName,
      },
      containerConcurrency: options.containerConcurrency,
      timeoutSeconds: options.timeoutSeconds,
    },
  };
}

// ============================================================
// 完整应用 Stack（Service + Configuration + Route + Revision）
// ============================================================

/**
 * Knative 完整应用资源包
 */
export interface KnativeApplicationStack {
  service: KnativeService;
  configuration: KnativeConfiguration;
  route: KnativeRoute;
  revision: KnativeRevision;
}

/**
 * 构建完整 Knative 应用 Stack
 * @param options 部署选项
 * @returns 完整资源包
 */
export function buildKnativeApplicationStack(options: KnativeDeployOptions): KnativeApplicationStack {
  const revisionName = buildRevisionName(options.name, options.imageTag);

  const service = createKnativeService(options);
  const configuration = createKnativeConfiguration(options);
  const route = createKnativeRoute({
    name: options.name,
    namespace: options.namespace,
    traffic: options.traffic ?? { allToLatest: true },
    configurationName: options.name,
    labels: options.labels,
  });
  const revision = createKnativeRevision({
    serviceName: options.name,
    revisionName,
    image: options.image,
    namespace: options.namespace,
    imageTag: options.imageTag,
    containerConcurrency: options.containerConcurrency,
    timeoutSeconds: options.timeoutSeconds,
    labels: options.labels,
  });

  return { service, configuration, route, revision };
}

// ============================================================
// 流量切分验证
// ============================================================

/**
 * 验证流量切分配置
 * @param targets TrafficTarget 列表
 * @returns 验证结果
 */
export function validateTrafficSplit(targets: TrafficTarget[]): {
  valid: boolean;
  errors: string[];
  totalPercent: number;
} {
  const errors: string[] = [];
  let totalPercent = 0;

  if (targets.length === 0) {
    errors.push('流量切分不能为空');
    return { valid: false, errors, totalPercent: 0 };
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (target.percent < 0 || target.percent > 100) {
      errors.push(`TrafficTarget[${i}].percent 必须在 0-100 之间，实际为 ${target.percent}`);
    }
    if (!target.latestRevision && !target.revisionName) {
      errors.push(`TrafficTarget[${i}] 必须指定 revisionName 或 latestRevision=true`);
    }
    totalPercent += target.percent;
  }

  if (totalPercent !== 100) {
    errors.push(`流量切分总和必须为 100%，实际为 ${totalPercent}%`);
  }

  return { valid: errors.length === 0, errors, totalPercent };
}

// ============================================================
// YAML 序列化
// ============================================================

/**
 * 将 Knative 资源数组序列化为 YAML Manifest
 * @param resources 资源数组
 * @returns YAML 字符串
 */
export function buildKnativeManifestYaml(
  resources: Array<KnativeService | KnativeConfiguration | KnativeRoute | KnativeRevision>
): string {
  return resources
    .map((r) => serializeKnativeResource(r))
    .join('\n---\n');
}

/**
 * 序列化单个 Knative 资源
 */
function serializeKnativeResource(
  resource: KnativeService | KnativeConfiguration | KnativeRoute | KnativeRevision
): string {
  const lines: string[] = [];
  lines.push(`apiVersion: ${resource.apiVersion}`);
  lines.push(`kind: ${resource.kind}`);
  lines.push('metadata:');
  lines.push(`  name: ${resource.metadata.name}`);
  if (resource.metadata.namespace) {
    lines.push(`  namespace: ${resource.metadata.namespace}`);
  }
  if (resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0) {
    lines.push('  labels:');
    for (const [k, v] of Object.entries(resource.metadata.labels)) {
      lines.push(`    ${k}: ${v}`);
    }
  }
  if (resource.metadata.annotations && Object.keys(resource.metadata.annotations).length > 0) {
    lines.push('  annotations:');
    for (const [k, v] of Object.entries(resource.metadata.annotations)) {
      lines.push(`    ${k}: "${v}"`);
    }
  }
  lines.push('spec:');
  lines.push(serializeSpec(resource.spec, 1));
  return lines.join('\n');
}

function serializeSpec(spec: Record<string, unknown>, indent: number): string {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(spec)) {
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
