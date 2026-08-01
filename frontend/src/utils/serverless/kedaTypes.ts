/**
 * # ============================================================
 * # KEDA - 事件驱动自动扩缩容类型定义 (Cycle 56 G56-02)
 * # ============================================================
 * # 核心作用：定义 KEDA CRD 类型 + 30+ 内置 Scaler
 * # CRD: ScaledObject / ScaledJob / TriggerAuthentication
 * # 规范：keda.sh/v1alpha1
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-02 初次创建
 * # ====================================
 */

/** KEDA API 版本 */
export type KedaApiVersion = 'keda.sh/v1alpha1';

/** 30+ 内置 Scaler 类型 */
export type ScalerType =
  // 消息队列
  | 'kafka'
  | 'rabbitmq'
  | 'amqp'
  | 'rocketmq'
  | 'pulsar'
  | 'nats'
  | 'aws-sqs'
  | 'aws-kinesis-stream'
  | 'gcp-pubsub'
  | 'azure-servicebus'
  | 'azure-eventhub'
  | 'beanstalkd'
  | 'redis-streams'
  | 'redis-list'
  // 数据库
  | 'mysql'
  | 'postgresql'
  | 'mongodb'
  | 'cassandra'
  | 'redis'
  | 'mssql'
  | 'cratedb'
  // 监控/指标
  | 'prometheus'
  | 'datadog'
  | 'stackdriver'
  | 'influxdb'
  | 'sysmetric'
  // CPU/Memory（Metrics API）
  | 'cpu'
  | 'memory'
  // 定时任务
  | 'cron'
  // 外部
  | 'external'
  | 'external-push'
  | 'webhook'
  | 'liiklus'
  | 'gcp-storage'
  | 'azure-blob'
  | 'azure-log-analytics'
  | 'aws-cloudwatch'
  | 'aws-dynamodb'
  | 'aws-dynamodb-streams'
  | 'aws-kafka'
  | 'aws-sqs'
  | 'openshift-prometheus'
  | 'kubernetes-workload'
  | 'memory'
  | 'rabbitmq-stream'
  | 'solr';

/** Scaler 触发器配置（通用） */
export interface ScalerTrigger {
  type: ScalerType;
  name?: string;
  /** 缩容冷却期（秒） */
  cooldownPeriod?: number;
  /** 预热冷却期（秒） */
  pollingInterval?: number;
  /** 触发元数据（按 Scaler 类型） */
  metadata: Record<string, string>;
  /** 触发认证引用 */
  authenticationRef?: {
    name: string;
    kind?: 'TriggerAuthentication' | 'ClusterTriggerAuthentication';
  };
  /** 外部指标源（external scaler） */
  metricType?: 'AverageValue' | 'Value';
}

/** KEDA ScaledObject Spec */
export interface ScaledObjectSpec {
  /** 目标工作负载 */
  workloadRef: {
    apiVersion?: string;
    kind: 'Deployment' | 'StatefulSet' | 'Custom';
    name: string;
  };
  /** 触发器列表 */
  triggers: ScalerTrigger[];
  /** 最小副本数 */
  minReplicaCount?: number;
  /** 最大副本数 */
  maxReplicaCount?: number;
  /** 高级扩缩容选项 */
  advanced?: {
    horizontalPodAutoscalerConfig?: {
      name?: string;
      behavior?: Record<string, unknown>;
    };
    restoreToOriginalReplicaCount?: boolean;
    scalingModifiers?: Record<string, unknown>;
  };
  /** 回退配置（指标不可用时） */
  fallback?: {
    failureThreshold: number;
    replicas: number;
  };
  /** 空闲副本（0 → idle） */
  idleReplicaCount?: number;
}

/** KEDA ScaledObject 状态 */
export interface ScaledObjectStatus {
  /** 状态条件 */
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason?: string;
    message?: string;
  }>;
  /** 当前副本数 */
  replicaCount?: number;
  /** 外部指标名 */
  externalMetricNames?: string[];
  /** 当前激活的触发器 */
  activeTriggers?: string[];
  /** HPA 名称 */
  hpaName?: string;
}

/** KEDA ScaledObject CRD */
export interface KedaScaledObject {
  apiVersion: 'keda.sh/v1alpha1';
  kind: 'ScaledObject';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
  };
  spec: ScaledObjectSpec;
  status?: ScaledObjectStatus;
}

/** TriggerAuthentication Secret 引用 */
export interface AuthSecret {
  parameter: string;
  name: string;
  key: string;
}

/** TriggerAuthentication 资源 */
export interface TriggerAuthenticationSpec {
  /** Secret 引用列表 */
  secretTargetRef?: AuthSecret[];
  /** ConfigMap 引用 */
  configMapTargetRef?: AuthSecret[];
  /** 环境变量引用 */
  env?: Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }>;
  /** Pod 身份（Azure Workload Identity） */
  podIdentity?: {
    provider: 'azure' | 'aws' | 'gcp' | 'azure-workload';
    identityId?: string;
  };
}

/** TriggerAuthentication CRD */
export interface KedaTriggerAuthentication {
  apiVersion: 'keda.sh/v1alpha1';
  kind: 'TriggerAuthentication';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  spec: TriggerAuthenticationSpec;
}

/** Cron 触发器配置（便捷预设） */
export interface CronScalerConfig {
  /** 命名 */
  name: string;
  /** Cron 表达式 */
  schedule: string;
  /** 时区（默认 UTC） */
  timezone?: string;
  /** 起始副本 */
  startReplicaCount: number;
  /** 结束副本 */
  endReplicaCount: number;
  /** 持续时间（秒） */
  duration?: number;
}

/** Prometheus 触发器配置 */
export interface PrometheusScalerConfig {
  name: string;
  /** Prometheus Server 地址 */
  serverAddress: string;
  /** PromQL 查询 */
  query: string;
  /** 阈值 */
  threshold: number;
  /** 自定义头 */
  customHeaders?: Record<string, string>;
  /** 忽略空值 */
  ignoreNullValues?: boolean;
  /** 认证引用 */
  authenticationRef?: string;
}

/** Kafka 触发器配置 */
export interface KafkaScalerConfig {
  name: string;
  /** Bootstrap Server */
  bootstrapServers: string;
  /** 消费组 */
  consumerGroup: string;
  /** Topic */
  topic: string;
  /** 阈值（lag） */
  lagThreshold: number;
  /** 激活阈值 */
  activationLagThreshold?: number;
  /** 偏移重置策略 */
  offsetResetPolicy?: 'earliest' | 'latest';
  /** 允许空闲消费者 */
  allowIdleConsumers?: boolean;
}

/** KEDA 部署配置 */
export interface KedaDeployOptions {
  /** ScaledObject 名称 */
  name: string;
  /** 命名空间 */
  namespace?: string;
  /** 目标工作负载 */
  workloadRef: {
    kind: 'Deployment' | 'StatefulSet' | 'Custom';
    name: string;
    apiVersion?: string;
  };
  /** 触发器列表 */
  triggers: ScalerTrigger[];
  /** 最小副本 */
  minReplicaCount?: number;
  /** 最大副本 */
  maxReplicaCount?: number;
  /** 空闲副本 */
  idleReplicaCount?: number;
  /** 回退配置 */
  fallback?: { failureThreshold: number; replicas: number };
  /** 标签 */
  labels?: Record<string, string>;
}
