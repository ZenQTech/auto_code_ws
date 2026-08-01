/**
 * # ============================================================
 * # KEDA Generator - 事件驱动自动扩缩容生成器 (Cycle 56 G56-02)
 * # ============================================================
 * # 核心作用：声明式构造 KEDA ScaledObject + TriggerAuthentication
 * # 内置 30+ Scaler: Kafka/RabbitMQ/Prometheus/Cron/MySQL/...
 * # 自定义 Scaler: external / external-push / webhook
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-02 初次创建
 * # ====================================
 */

import type {
  KedaScaledObject,
  KedaTriggerAuthentication,
  ScalerTrigger,
  ScalerType,
  KedaDeployOptions,
  CronScalerConfig,
  PrometheusScalerConfig,
  KafkaScalerConfig,
} from './kedaTypes';

// ============================================================
// 内置 Scaler 元数据校验
// ============================================================

/** 必需元数据字段映射表 */
const REQUIRED_METADATA: Partial<Record<ScalerType, string[]>> = {
  kafka: ['bootstrapServers', 'consumerGroup', 'topic', 'lagThreshold'],
  rabbitmq: ['host', 'queueName', 'mode', 'value'],
  amqp: ['host', 'queueName', 'mode', 'value'],
  rocketmq: ['host', 'mode', 'value', 'topic', 'rocketmqNamespace'],
  pulsar: ['brokerList', 'topic', 'subscription', 'msgRateThreshold'],
  nats: ['natsServerMonitoringEndpoint', 'queueGroup', 'subject', 'lagThreshold'],
  'aws-sqs': ['queueURL', 'queueRegion', 'activationQueueLength', 'queueLength'],
  'aws-kinesis-stream': ['streamName', 'awsRegion', 'shardCount'],
  'gcp-pubsub': ['subscriptionName', 'mode', 'value'],
  'azure-servicebus': ['connectionString', 'queueName', 'messageCount'],
  'azure-eventhub': ['eventHubConnectionString', 'eventHubName', 'messageCount'],
  'beanstalkd': ['host', 'queueName', 'value'],
  'redis-streams': ['address', 'stream', 'consumerGroup', 'pendingEntriesCount'],
  'redis-list': ['address', 'listName', 'listLength'],
  mysql: ['query', 'queryValue', 'host', 'port', 'username', 'password', 'dbName'],
  postgresql: ['query', 'queryValue', 'host', 'port', 'username', 'password', 'dbName'],
  mongodb: ['query', 'queryValue', 'host', 'port', 'username', 'password', 'dbName'],
  cassandra: ['query', 'queryValue', 'host', 'port', 'username', 'password', 'dbName'],
  redis: ['address', 'listName', 'listLength'],
  mssql: ['query', 'queryValue', 'host', 'port', 'username', 'password', 'dbName'],
  prometheus: ['serverAddress', 'query', 'threshold'],
  datadog: ['query', 'queryValue', 'datadogSite', 'authMode'],
  stackdriver: ['projectID', 'filter', 'query', 'queryValue'],
  influxdb: ['serverURL', 'query', 'value'],
  cpu: ['type', 'value'],
  memory: ['type', 'value'],
  cron: ['timezone', 'start', 'end', 'desiredReplicas'],
  external: ['scalerAddress', 'value'],
  'external-push': [],
  webhook: ['url', 'value'],
};

/**
 * 校验 Scaler 元数据
 * @param trigger 触发器配置
 * @returns 校验结果
 */
export function validateScalerMetadata(trigger: ScalerTrigger): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const required = REQUIRED_METADATA[trigger.type] ?? [];

  for (const field of required) {
    if (!(field in trigger.metadata) || trigger.metadata[field] === '') {
      errors.push(`Scaler '${trigger.type}' 缺少必需字段 '${field}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// 内置 Scaler 预设构造器
// ============================================================

/**
 * 创建 Kafka 触发器
 * @param config Kafka 配置
 * @returns ScalerTrigger
 */
export function createKafkaTrigger(config: KafkaScalerConfig): ScalerTrigger {
  return {
    type: 'kafka',
    name: config.name,
    metadata: {
      bootstrapServers: config.bootstrapServers,
      consumerGroup: config.consumerGroup,
      topic: config.topic,
      lagThreshold: String(config.lagThreshold),
      activationLagThreshold:
        config.activationLagThreshold !== undefined
          ? String(config.activationLagThreshold)
          : '',
      offsetResetPolicy: config.offsetResetPolicy ?? 'latest',
      allowIdleConsumers: String(config.allowIdleConsumers ?? false),
    },
    authenticationRef: config.authenticationRef
      ? { name: config.authenticationRef, kind: 'TriggerAuthentication' }
      : undefined,
  };
}

/**
 * 创建 RabbitMQ 触发器
 */
export function createRabbitMQTrigger(config: {
  name: string;
  host: string;
  protocol?: 'amqp' | 'http';
  queueName: string;
  mode: 'QueueLength' | 'MessageRate';
  value: string;
  activationValue?: string;
  authenticationRef?: string;
}): ScalerTrigger {
  return {
    type: 'rabbitmq',
    name: config.name,
    metadata: {
      host: config.host,
      protocol: config.protocol ?? 'amqp',
      queueName: config.queueName,
      mode: config.mode,
      value: config.value,
      activationValue: config.activationValue ?? '',
    },
    authenticationRef: config.authenticationRef
      ? { name: config.authenticationRef, kind: 'TriggerAuthentication' }
      : undefined,
  };
}

/**
 * 创建 Prometheus 触发器
 */
export function createPrometheusTrigger(config: PrometheusScalerConfig): ScalerTrigger {
  return {
    type: 'prometheus',
    name: config.name,
    metadata: {
      serverAddress: config.serverAddress,
      query: config.query,
      threshold: String(config.threshold),
      activationThreshold: '',
      ignoreNullValues: String(config.ignoreNullValues ?? false),
      ...(config.customHeaders
        ? Object.fromEntries(
            Object.entries(config.customHeaders).map(([k, v]) => [`customHeader_${k}`, v])
          )
        : {}),
    },
    authenticationRef: config.authenticationRef
      ? { name: config.authenticationRef, kind: 'TriggerAuthentication' }
      : undefined,
  };
}

/**
 * 创建 Cron 触发器（定时扩缩容）
 */
export function createCronTrigger(config: CronScalerConfig): ScalerTrigger {
  return {
    type: 'cron',
    name: config.name,
    metadata: {
      timezone: config.timezone ?? 'UTC',
      start: config.schedule,
      end: config.schedule,
      desiredReplicas: String(config.startReplicaCount),
    },
  };
}

/**
 * 创建 MySQL/PostgreSQL 触发器
 */
export function createDatabaseTrigger(
  type: 'mysql' | 'postgresql' | 'mongodb' | 'mssql' | 'cratedb',
  config: {
    name: string;
    host: string;
    port: string;
    username: string;
    dbName: string;
    query: string;
    queryValue: string;
    threshold: string;
    authenticationRef?: string;
  }
): ScalerTrigger {
  return {
    type,
    name: config.name,
    metadata: {
      host: config.host,
      port: config.port,
      username: config.username,
      password: '', // 密码应通过 TriggerAuthentication 注入
      dbName: config.dbName,
      query: config.query,
      queryValue: config.queryValue,
      threshold: config.threshold,
    },
    authenticationRef: config.authenticationRef
      ? { name: config.authenticationRef, kind: 'TriggerAuthentication' }
      : undefined,
  };
}

/**
 * 创建 Redis 触发器
 */
export function createRedisTrigger(config: {
  name: string;
  address: string;
  listName?: string;
  listLength?: string;
  stream?: string;
  consumerGroup?: string;
  pendingEntriesCount?: string;
  authenticationRef?: string;
}): ScalerTrigger {
  const isStream = !!config.stream;
  return {
    type: isStream ? 'redis-streams' : 'redis-list',
    name: config.name,
    metadata: {
      address: config.address,
      listName: config.listName ?? '',
      listLength: config.listLength ?? '',
      stream: config.stream ?? '',
      consumerGroup: config.consumerGroup ?? '',
      pendingEntriesCount: config.pendingEntriesCount ?? '',
    },
    authenticationRef: config.authenticationRef
      ? { name: config.authenticationRef, kind: 'TriggerAuthentication' }
      : undefined,
  };
}

// ============================================================
// TriggerAuthentication 构造器
// ============================================================

/**
 * 创建 TriggerAuthentication（Secret 引用）
 */
export function createTriggerAuthentication(options: {
  name: string;
  namespace?: string;
  secrets?: Array<{ parameter: string; secretName: string; key: string }>;
  configMaps?: Array<{ parameter: string; configMapName: string; key: string }>;
  podIdentity?: {
    provider: 'azure' | 'aws' | 'gcp' | 'azure-workload';
    identityId?: string;
  };
  labels?: Record<string, string>;
}): KedaTriggerAuthentication {
  const spec: KedaTriggerAuthentication['spec'] = {};

  if (options.secrets && options.secrets.length > 0) {
    spec.secretTargetRef = options.secrets.map((s) => ({
      parameter: s.parameter,
      name: s.secretName,
      key: s.key,
    }));
  }

  if (options.configMaps && options.configMaps.length > 0) {
    spec.configMapTargetRef = options.configMaps.map((c) => ({
      parameter: c.parameter,
      name: c.configMapName,
      key: c.key,
    }));
  }

  if (options.podIdentity) {
    spec.podIdentity = {
      provider: options.podIdentity.provider,
      identityId: options.podIdentity.identityId,
    };
  }

  return {
    apiVersion: 'keda.sh/v1alpha1',
    kind: 'TriggerAuthentication',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'default',
      labels: options.labels,
    },
    spec,
  };
}

// ============================================================
// ScaledObject Builder
// ============================================================

/**
 * 创建 KEDA ScaledObject
 * @param options 部署选项
 * @returns KedaScaledObject
 */
export function createScaledObject(options: KedaDeployOptions): KedaScaledObject {
  return {
    apiVersion: 'keda.sh/v1alpha1',
    kind: 'ScaledObject',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'default',
      labels: options.labels,
    },
    spec: {
      workloadRef: {
        apiVersion: options.workloadRef.apiVersion ?? 'apps/v1',
        kind: options.workloadRef.kind,
        name: options.workloadRef.name,
      },
      triggers: options.triggers,
      minReplicaCount: options.minReplicaCount,
      maxReplicaCount: options.maxReplicaCount,
      idleReplicaCount: options.idleReplicaCount,
      fallback: options.fallback,
    },
  };
}

/**
 * 创建 KEDA ScaledJob（用于 Job 而非 Deployment）
 */
export function createScaledJob(options: {
  name: string;
  namespace?: string;
  jobTargetRef: {
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
          command?: string[];
          args?: string[];
          env?: Array<{ name: string; value?: string }>;
        }>;
        restartPolicy?: 'OnFailure' | 'Never';
      };
    };
  };
  triggers: ScalerTrigger[];
  minReplicaCount?: number;
  maxReplicaCount?: number;
  pollingInterval?: number;
  labels?: Record<string, string>;
}): KedaScaledObject {
  return {
    apiVersion: 'keda.sh/v1alpha1',
    kind: 'ScaledObject',
    metadata: {
      name: options.name,
      namespace: options.namespace ?? 'default',
      labels: options.labels,
    },
    spec: {
      workloadRef: {
        apiVersion: 'batch/v1',
        kind: 'Custom', // ScaledJob uses jobTargetRef, but here we mark as Custom
        name: options.name,
      },
      triggers: options.triggers,
      minReplicaCount: options.minReplicaCount,
      maxReplicaCount: options.maxReplicaCount,
      advanced: {
        restoreToOriginalReplicaCount: false,
      },
    },
  };
}

// ============================================================
// 完整应用 Stack
// ============================================================

/**
 * KEDA 完整应用资源包
 */
export interface KedaApplicationStack {
  scaledObject: KedaScaledObject;
  triggerAuthentications: KedaTriggerAuthentication[];
}

/**
 * 构建完整 KEDA 应用 Stack
 * @param options 部署选项
 * @returns 完整资源包
 */
export function buildKedaApplicationStack(
  options: KedaDeployOptions & {
    triggerAuthentications?: Array<{
      name: string;
      secrets?: Array<{ parameter: string; secretName: string; key: string }>;
      podIdentity?: {
        provider: 'azure' | 'aws' | 'gcp' | 'azure-workload';
        identityId?: string;
      };
    }>;
  }
): KedaApplicationStack {
  const scaledObject = createScaledObject(options);
  const triggerAuthentications: KedaTriggerAuthentication[] = [];

  if (options.triggerAuthentications) {
    for (const auth of options.triggerAuthentications) {
      triggerAuthentications.push(
        createTriggerAuthentication({
          name: auth.name,
          namespace: options.namespace,
          secrets: auth.secrets,
          podIdentity: auth.podIdentity,
          labels: options.labels,
        })
      );
    }
  }

  return { scaledObject, triggerAuthentications };
}

// ============================================================
// YAML 序列化
// ============================================================

/**
 * 将 KEDA 资源序列化为 YAML
 * @param scaledObject ScaledObject
 * @param auths TriggerAuthentication 列表
 * @returns YAML 字符串
 */
export function buildKedaManifestYaml(
  scaledObject: KedaScaledObject,
  auths: KedaTriggerAuthentication[] = []
): string {
  const parts: string[] = [];
  for (const auth of auths) {
    parts.push(serializeKedaResource(auth));
  }
  parts.push(serializeKedaResource(scaledObject));
  return parts.join('\n---\n');
}

function serializeKedaResource(
  resource: KedaScaledObject | KedaTriggerAuthentication
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
  lines.push('spec:');
  lines.push(serializeObject(resource.spec, 1));
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
// Scaler 元数据规范化
// ============================================================

/**
 * 标准化 Scaler 名称（去空格、转小写）
 */
export function normalizeScalerType(type: string): ScalerType {
  return type.toLowerCase().trim() as ScalerType;
}

/**
 * 列出所有支持的 Scaler 类型
 */
export function listSupportedScalers(): ScalerType[] {
  return [
    'kafka', 'rabbitmq', 'amqp', 'rocketmq', 'pulsar', 'nats',
    'aws-sqs', 'aws-kinesis-stream', 'gcp-pubsub', 'azure-servicebus', 'azure-eventhub',
    'beanstalkd', 'redis-streams', 'redis-list',
    'mysql', 'postgresql', 'mongodb', 'cassandra', 'redis', 'mssql',
    'prometheus', 'datadog', 'stackdriver', 'influxdb', 'openshift-prometheus',
    'cpu', 'memory', 'cron',
    'external', 'external-push', 'webhook', 'liiklus',
  ];
}
