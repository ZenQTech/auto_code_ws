/**
 * # ============================================================
 * # CloudEvents - 标准化事件协议 (Cycle 56 G56-04)
 * # ============================================================
 * # 核心作用：定义 CloudEvents v1.0 规范实现
 * # 规范：https://github.com/cloudevents/spec/blob/v1.0.2/spec.md
 * # 格式：JSON / Avro / Protobuf / XML
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-04 初次创建
 * # ====================================
 */

/** CloudEvents 协议版本 */
export type CloudEventsSpecVersion = '1.0';

/** CloudEvents 格式 */
export type CloudEventsFormat = 'json' | 'avro' | 'protobuf' | 'xml';

/** 必需属性 */
export interface CloudEventsRequiredAttributes {
  /** 事件唯一 ID */
  id: string;
  /** 事件源 */
  source: string;
  /** 事件类型 */
  type: string;
  /** Spec 版本 */
  specversion: CloudEventsSpecVersion;
}

/** 可选属性 */
export interface CloudEventsOptionalAttributes {
  /** 数据内容类型 */
  datacontenttype?: string;
  /** 数据 Schema */
  dataschema?: string;
  /** 主题 */
  subject?: string;
  /** 时间（RFC 3339） */
  time?: string;
}

/** 扩展属性（自定义字段） */
export type CloudEventsExtension = Record<string, string | number | boolean>;

/** CloudEvents 事件（结构化模式） */
export interface CloudEvent extends CloudEventsRequiredAttributes, CloudEventsOptionalAttributes {
  /** 事件数据（Base64 编码的二进制） */
  data_base64?: string;
  /** 事件数据（JSON 文本） */
  data?: unknown;
  /** 扩展属性 */
  [key: string]: unknown;
}

/** CloudEvents HTTP 绑定（批量模式） */
export interface CloudEventsHttpBinding {
  /** HTTP 头（CE-* 编码） */
  headers: Record<string, string>;
  /** HTTP Body */
  body?: string;
}

/** CloudEvents Kafka 消息绑定 */
export interface CloudEventsKafkaBinding {
  /** Kafka 消息 Key */
  key?: string;
  /** Kafka Headers */
  headers: Record<string, string>;
  /** Kafka Value */
  value: string;
  /** Topic */
  topic: string;
  /** Partition */
  partition?: number;
}

/** CloudEvents 事件路由 */
export interface CloudEventRoute {
  /** 路由 ID */
  id: string;
  /** 事件源过滤（支持通配符 *） */
  source: string;
  /** 事件类型过滤（支持通配符 *） */
  type: string;
  /** 主题过滤 */
  subject?: string;
  /** 目标 Sink */
  sink: {
    /** Sink 类型 */
    type: 'http' | 'kafka' | 'amqp' | 'sns' | 'mongodb' | 'pubsub' | 'eventgrid' | 'kinesis';
    /** Sink URL */
    url: string;
  };
  /** 转换模板 */
  transform?: {
    /** 过滤表达式（CEL） */
    filter?: string;
    /** 字段映射 */
    mappings?: Record<string, string>;
  };
  /** 启用状态 */
  enabled: boolean;
}

/** 事件订阅者 */
export interface CloudEventSubscriber {
  /** 订阅者 ID */
  id: string;
  /** 订阅者名称 */
  name: string;
  /** 协议 */
  protocol: 'http' | 'kafka' | 'amqp' | 'grpc';
  /** 端点 */
  endpoint: string;
  /** 过滤器 */
  filters: {
    source?: string;
    type?: string;
    subject?: string;
    extension?: Record<string, string>;
  };
  /** 投递策略 */
  deliveryPolicy: {
    /** 至少一次 */
    atLeastOnce?: boolean;
    /** 最多一次 */
    atMostOnce?: boolean;
    /** 重试次数 */
    retries?: number;
    /** 退避策略 */
    backoff?: 'linear' | 'exponential';
    /** 死信队列 */
    deadLetter?: string;
  };
  /** 状态 */
  status: 'active' | 'paused' | 'failed';
  /** 创建时间 */
  createdAt: string;
}

/** 事件源（生产者） */
export interface CloudEventSource {
  /** 源 ID */
  id: string;
  /** 源名称 */
  name: string;
  /** 源类型 */
  type: 'webhook' | 'cron' | 'message-queue' | 'kafka' | 'database-cdc' | 'iot';
  /** 连接信息 */
  connection: {
    url?: string;
    topic?: string;
    cron?: string;
    brokers?: string[];
    credentials?: Record<string, string>;
  };
  /** 事件模板 */
  eventTemplate?: Partial<CloudEvent>;
  /** 状态 */
  status: 'active' | 'paused' | 'error';
}

/** 事件总线（Broker） */
export interface CloudEventBroker {
  /** 代理 ID */
  id: string;
  /** 代理名称 */
  name: string;
  /** 代理类型 */
  type: 'knative-eventing' | 'nats' | 'kafka' | 'rabbitmq' | 'in-memory';
  /** 端点 */
  endpoint: string;
  /** 已注册源数 */
  sourcesCount: number;
  /** 已注册订阅者数 */
  subscribersCount: number;
  /** 事件吞吐量（events/sec） */
  throughputEps: number;
  /** 健康状态 */
  health: 'healthy' | 'degraded' | 'down';
}

/** CloudEvents 校验结果 */
export interface CloudEventValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
