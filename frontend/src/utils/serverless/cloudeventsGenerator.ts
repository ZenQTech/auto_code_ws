/**
 * # ============================================================
 * # CloudEvents - 事件协议实现 (Cycle 56 G56-04)
 * # ====================================
 * # 核心作用：实现 CloudEvents v1.0 规范
 * # 特性：JSON/Avro/Protobuf 序列化 + HTTP/Kafka 绑定 + 路由
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-04 初次创建
 * # ====================================
 */

import type {
  CloudEvent,
  CloudEventsFormat,
  CloudEventRoute,
  CloudEventSubscriber,
  CloudEventSource,
  CloudEventBroker,
  CloudEventValidationResult,
  CloudEventsHttpBinding,
  CloudEventsKafkaBinding,
} from './cloudeventsTypes';

const REQUIRED_ATTRS = ['id', 'source', 'type', 'specversion'] as const;
const OPTIONAL_ATTRS = [
  'datacontenttype', 'dataschema', 'subject', 'time',
] as const;

/** CE-* 头前缀 */
const CE_HEADER_PREFIX = 'ce-';

// ============================================================
// CloudEvents 校验
// ============================================================

/**
 * 校验 CloudEvent
 */
export function validateCloudEvent(event: CloudEvent): CloudEventValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 必需属性
  for (const attr of REQUIRED_ATTRS) {
    if (!event[attr] || event[attr] === '') {
      errors.push(`缺少必需属性: ${attr}`);
    }
  }

  // 2. specversion 必须为 1.0
  if (event.specversion && event.specversion !== '1.0') {
    errors.push(`不支持的 specversion: ${event.specversion}（仅支持 1.0）`);
  }

  // 3. source 格式
  if (event.source && !/^[a-zA-Z][a-zA-Z0-9._\-/]*$/.test(event.source)) {
    warnings.push(`source 格式不规范: ${event.source}`);
  }

  // 4. type 格式
  if (event.type && !/^[a-zA-Z][a-zA-Z0-9._\-]*$/.test(event.type)) {
    warnings.push(`type 格式不规范: ${event.type}`);
  }

  // 5. time 格式
  if (event.time && !isValidRFC3339(event.time)) {
    errors.push(`time 格式错误（应为 RFC 3339）: ${event.time}`);
  }

  // 6. data 和 data_base64 互斥
  if (event.data !== undefined && event.data_base64 !== undefined) {
    errors.push('data 和 data_base64 不能同时存在');
  }

  // 7. datacontenttype
  if (event.data !== undefined && !event.datacontenttype) {
    warnings.push('data 存在但未设置 datacontenttype');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** 校验 RFC 3339 时间格式 */
function isValidRFC3339(time: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(time);
}

// ============================================================
// CloudEvent 构造器
// ============================================================

/**
 * 创建 CloudEvent
 */
export function createCloudEvent(options: {
  id?: string;
  source: string;
  type: string;
  data?: unknown;
  datacontenttype?: string;
  dataschema?: string;
  subject?: string;
  time?: string;
  extensions?: Record<string, string | number | boolean>;
}): CloudEvent {
  const event: CloudEvent = {
    id: options.id ?? generateCloudEventId(),
    source: options.source,
    type: options.type,
    specversion: '1.0',
    time: options.time ?? new Date().toISOString(),
  };
  if (options.data !== undefined) event.data = options.data;
  if (options.datacontenttype) event.datacontenttype = options.datacontenttype;
  if (options.dataschema) event.dataschema = options.dataschema;
  if (options.subject) event.subject = options.subject;
  if (options.extensions) {
    for (const [k, v] of Object.entries(options.extensions)) {
      event[k] = v;
    }
  }
  return event;
}

/** 生成 CloudEvent 唯一 ID */
export function generateCloudEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================
// CloudEvents JSON 序列化（结构化模式）
// ============================================================

/**
 * 将 CloudEvent 序列化为 JSON 字符串
 */
export function serializeCloudEventJson(event: CloudEvent): string {
  const validation = validateCloudEvent(event);
  if (!validation.valid) {
    throw new Error(`CloudEvent 校验失败: ${validation.errors.join(', ')}`);
  }
  return JSON.stringify(event);
}

/**
 * 解析 CloudEvent JSON 字符串
 */
export function parseCloudEventJson(json: string): CloudEvent {
  const event = JSON.parse(json) as CloudEvent;
  const validation = validateCloudEvent(event);
  if (!validation.valid) {
    throw new Error(`CloudEvent 校验失败: ${validation.errors.join(', ')}`);
  }
  return event;
}

// ============================================================
// CloudEvents HTTP 绑定（批量模式）
// ============================================================

/**
 * 将 CloudEvent 转换为 HTTP 绑定
 */
export function toHttpBinding(event: CloudEvent, format: CloudEventsFormat = 'json'): CloudEventsHttpBinding {
  const validation = validateCloudEvent(event);
  if (!validation.valid) {
    throw new Error(`CloudEvent 校验失败: ${validation.errors.join(', ')}`);
  }

  const headers: Record<string, string> = {
    'ce-id': event.id,
    'ce-source': event.source,
    'ce-type': event.type,
    'ce-specversion': event.specversion,
  };
  if (event.time) headers['ce-time'] = event.time;
  if (event.subject) headers['ce-subject'] = event.subject;
  if (event.dataschema) headers['ce-dataschema'] = event.dataschema;
  if (event.datacontenttype) headers['ce-datacontenttype'] = event.datacontenttype;

  // 扩展属性
  for (const [key, value] of Object.entries(event)) {
    if (
      !REQUIRED_ATTRS.includes(key as typeof REQUIRED_ATTRS[number]) &&
      !OPTIONAL_ATTRS.includes(key as typeof OPTIONAL_ATTRS[number]) &&
      key !== 'data' &&
      key !== 'data_base64'
    ) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        headers[`${CE_HEADER_PREFIX}${key}`] = String(value);
      }
    }
  }

  let body: string | undefined;
  if (format === 'json' && event.data !== undefined) {
    headers['content-type'] = event.datacontenttype ?? 'application/json';
    body = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  } else if (event.data_base64) {
    body = event.data_base64;
  }

  return { headers, body };
}

/**
 * 从 HTTP 头解析 CloudEvent（批量模式）
 */
export function fromHttpBinding(binding: CloudEventsHttpBinding): CloudEvent {
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(binding.headers)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  const id = lowerHeaders['ce-id'];
  const source = lowerHeaders['ce-source'];
  const type = lowerHeaders['ce-type'];
  const specversion = lowerHeaders['ce-specversion'];

  if (!id || !source || !type || !specversion) {
    throw new Error('HTTP 绑定缺少必需 CE-* 头');
  }

  const event: CloudEvent = {
    id,
    source,
    type,
    specversion: specversion as '1.0',
  };
  if (lowerHeaders['ce-time']) event.time = lowerHeaders['ce-time'];
  if (lowerHeaders['ce-subject']) event.subject = lowerHeaders['ce-subject'];
  if (lowerHeaders['ce-dataschema']) event.dataschema = lowerHeaders['ce-dataschema'];
  if (lowerHeaders['ce-datacontenttype']) event.datacontenttype = lowerHeaders['ce-datacontenttype'];

  // 扩展属性
  const reservedHeaders = ['ce-id', 'ce-source', 'ce-type', 'ce-specversion', 'ce-time', 'ce-subject', 'ce-dataschema', 'ce-datacontenttype'];
  for (const [k, v] of Object.entries(lowerHeaders)) {
    if (k.startsWith(CE_HEADER_PREFIX) && !reservedHeaders.includes(k)) {
      const extKey = k.slice(CE_HEADER_PREFIX.length);
      event[extKey] = v;
    }
  }

  // Body
  if (binding.body) {
    if (event.datacontenttype === 'application/json') {
      try {
        event.data = JSON.parse(binding.body);
      } catch {
        event.data = binding.body;
      }
    } else {
      event.data = binding.body;
    }
  }

  return event;
}

// ============================================================
// CloudEvents Kafka 绑定
// ============================================================

/**
 * 将 CloudEvent 转换为 Kafka 消息
 */
export function toKafkaBinding(event: CloudEvent, topic: string): CloudEventsKafkaBinding {
  const validation = validateCloudEvent(event);
  if (!validation.valid) {
    throw new Error(`CloudEvent 校验失败: ${validation.errors.join(', ')}`);
  }
  const httpBinding = toHttpBinding(event, 'json');
  return {
    topic,
    key: event.subject ?? event.id,
    headers: httpBinding.headers,
    value: httpBinding.body ?? '',
  };
}

/**
 * 从 Kafka 消息解析 CloudEvent
 */
export function fromKafkaBinding(binding: CloudEventsKafkaBinding): CloudEvent {
  return fromHttpBinding({
    headers: binding.headers,
    body: binding.value,
  });
}

// ============================================================
// 事件路由匹配
// ============================================================

/**
 * 检查 CloudEvent 是否匹配路由
 */
export function matchRoute(event: CloudEvent, route: CloudEventRoute): boolean {
  if (!route.enabled) return false;
  if (!matchPattern(event.source, route.source)) return false;
  if (!matchPattern(event.type, route.type)) return false;
  if (route.subject && event.subject !== route.subject) return false;
  return true;
}

/** 模式匹配（支持 * 通配符） */
function matchPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === value) return true;
  // * 通配符
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }
  return false;
}

/**
 * 为事件匹配所有可用路由
 */
export function matchRoutes(event: CloudEvent, routes: CloudEventRoute[]): CloudEventRoute[] {
  return routes.filter((r) => matchRoute(event, r));
}

// ============================================================
// 事件订阅者
// ============================================================

/**
 * 创建事件订阅者
 */
export function createSubscriber(options: {
  name: string;
  protocol: 'http' | 'kafka' | 'amqp' | 'grpc';
  endpoint: string;
  filters?: CloudEventSubscriber['filters'];
  delivery?: Partial<CloudEventSubscriber['deliveryPolicy']>;
}): CloudEventSubscriber {
  return {
    id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: options.name,
    protocol: options.protocol,
    endpoint: options.endpoint,
    filters: options.filters ?? {},
    deliveryPolicy: {
      atLeastOnce: true,
      retries: 3,
      backoff: 'exponential',
      ...options.delivery,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

/**
 * 检查事件是否匹配订阅者过滤器
 */
export function matchSubscriber(event: CloudEvent, subscriber: CloudEventSubscriber): boolean {
  if (subscriber.status !== 'active') return false;
  if (subscriber.filters.source && !matchPattern(event.source, subscriber.filters.source)) return false;
  if (subscriber.filters.type && !matchPattern(event.type, subscriber.filters.type)) return false;
  if (subscriber.filters.subject && event.subject !== subscriber.filters.subject) return false;
  if (subscriber.filters.extension) {
    for (const [k, v] of Object.entries(subscriber.filters.extension)) {
      if (String(event[k]) !== v) return false;
    }
  }
  return true;
}

// ============================================================
// 事件源（生产者）
// ============================================================

/**
 * 创建事件源
 */
export function createSource(options: {
  name: string;
  type: CloudEventSource['type'];
  connection: CloudEventSource['connection'];
  eventTemplate?: Partial<CloudEvent>;
}): CloudEventSource {
  return {
    id: `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: options.name,
    type: options.type,
    connection: options.connection,
    eventTemplate: options.eventTemplate,
    status: 'active',
  };
}

// ============================================================
// 事件总线（Broker）
// ============================================================

/**
 * 创建事件总线
 */
export function createBroker(options: {
  name: string;
  type: CloudEventBroker['type'];
  endpoint: string;
}): CloudEventBroker {
  return {
    id: `broker-${Date.now().toString(36)}`,
    name: options.name,
    type: options.type,
    endpoint: options.endpoint,
    sourcesCount: 0,
    subscribersCount: 0,
    throughputEps: 0,
    health: 'healthy',
  };
}

// ============================================================
// 事件类型常量
// ============================================================

/** 常见 CloudEvents 事件类型 */
export const COMMON_EVENT_TYPES = {
  COM_CREATED: 'com.example.created',
  COM_UPDATED: 'com.example.updated',
  COM_DELETED: 'com.example.deleted',
  ORD_PLACED: 'com.shop.order.placed',
  ORD_SHIPPED: 'com.shop.order.shipped',
  USR_REGISTERED: 'com.auth.user.registered',
  PAY_COMPLETED: 'com.payment.completed',
  PAY_FAILED: 'com.payment.failed',
  NOT_SENT: 'com.notification.sent',
  AUDIT_LOG: 'com.audit.log',
} as const;

// ============================================================
// 统计工具
// ============================================================

/**
 * 计算事件统计
 */
export function computeEventStats(events: CloudEvent[]): {
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  uniqueIds: number;
  durationMs: number;
} {
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const ids = new Set<string>();
  let minTime: number | null = null;
  let maxTime: number | null = null;

  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    ids.add(e.id);
    if (e.time) {
      const t = new Date(e.time).getTime();
      if (!isNaN(t)) {
        if (minTime === null || t < minTime) minTime = t;
        if (maxTime === null || t > maxTime) maxTime = t;
      }
    }
  }

  return {
    total: events.length,
    byType,
    bySource,
    uniqueIds: ids.size,
    durationMs: minTime !== null && maxTime !== null ? maxTime - minTime : 0,
  };
}
