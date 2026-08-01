/**
 * # ============================================================
 * # Span - 追踪基本单元 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：表示分布式追踪中的一个工作单元
 * # 遵循 OpenTelemetry Span 规范
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
 * # ====================================
 */

import type {
  SpanData,
  SpanId,
  TraceId,
  Attributes,
  SpanEvent,
  SpanLink,
  SpanStatus,
  SpanStatusCode,
  SpanKind,
  Resource,
  AttributeValue,
} from './traceTypes';

/** Span 内部状态 */
interface SpanInternalState {
  ended: boolean;
}

/**
 * Span 类 - 追踪基本单元
 *
 * 使用示例:
 * ```ts
 * const span = new Span({
 *   traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
 *   spanId: '00f067aa0ba902b7',
 *   name: 'GET /api/users',
 *   kind: 'server',
 *   startTimeMs: Date.now(),
 *   resource: { serviceName: 'api', ... },
 *   attributes: { 'http.method': 'GET' },
 *   events: [],
 *   links: [],
 *   status: { code: 'UNSET' },
 *   sampled: true,
 * });
 *
 * span.setAttribute('user.id', '123');
 * span.addEvent('cache-miss');
 * span.setStatus({ code: 'OK' });
 * span.end();
 * ```
 */
export class Span {
  private data: SpanData;
  private state: SpanInternalState = { ended: false };
  /** 结束回调 */
  private readonly onEndCallback: ((span: SpanData) => void) | undefined;

  constructor(
    data: SpanData,
    onEndCallback?: (span: SpanData) => void
  ) {
    // 直接使用传入的 data 引用，以便外部（如 tracer.allSpans）能同步看到属性变化
    this.data = data;
    this.onEndCallback = onEndCallback;
  }

  /**
   * 获取 Span ID
   */
  getSpanId(): SpanId {
    return this.data.spanId;
  }

  /**
   * 获取 Trace ID
   */
  getTraceId(): TraceId {
    return this.data.traceId;
  }

  /**
   * 获取父 Span ID
   */
  getParentSpanId(): SpanId | undefined {
    return this.data.parentSpanId;
  }

  /**
   * 获取操作名称
   */
  getName(): string {
    return this.data.name;
  }

  /**
   * 设置操作名称
   */
  setName(name: string): this {
    if (this.state.ended) {
      throw new Error('Cannot set name on ended span');
    }
    this.data.name = name;
    return this;
  }

  /**
   * 获取 Span 类型
   */
  getKind(): SpanKind {
    return this.data.kind;
  }

  /**
   * 设置 Span 类型
   */
  setKind(kind: SpanKind): this {
    if (this.state.ended) {
      throw new Error('Cannot set kind on ended span');
    }
    this.data.kind = kind;
    return this;
  }

  /**
   * 设置属性
   */
  setAttribute(key: string, value: AttributeValue): this {
    if (this.state.ended) {
      throw new Error(`Cannot set attribute on ended span: ${key}`);
    }
    this.data.attributes[key] = value;
    return this;
  }

  /**
   * 批量设置属性
   */
  setAttributes(attributes: Attributes): this {
    if (this.state.ended) {
      throw new Error('Cannot set attributes on ended span');
    }
    Object.assign(this.data.attributes, attributes);
    return this;
  }

  /**
   * 获取属性
   */
  getAttribute(key: string): AttributeValue | undefined {
    return this.data.attributes[key];
  }

  /**
   * 获取所有属性
   */
  getAttributes(): Attributes {
    return { ...this.data.attributes };
  }

  /**
   * 添加事件
   */
  addEvent(name: string, attributes?: Attributes): this {
    if (this.state.ended) {
      throw new Error('Cannot add event on ended span');
    }
    const event: SpanEvent = {
      name,
      timestamp: Date.now(),
      attributes,
    };
    this.data.events.push(event);
    return this;
  }

  /**
   * 添加链接
   */
  addLink(link: SpanLink): this {
    if (this.state.ended) {
      throw new Error('Cannot add link on ended span');
    }
    this.data.links.push(link);
    return this;
  }

  /**
   * 设置状态
   */
  setStatus(status: SpanStatus): this {
    if (this.state.ended) {
      throw new Error('Cannot set status on ended span');
    }
    this.data.status = { ...status };
    return this;
  }

  /**
   * 设置错误状态
   */
  setError(message: string, attributes?: Attributes): this {
    if (this.state.ended) {
      throw new Error('Cannot set error on ended span');
    }
    this.data.status = { code: 'ERROR', message };
    this.data.attributes['error.message'] = message;
    if (attributes) {
      this.data.attributes['error.type'] = attributes['error.type'] ?? 'Error';
      if (attributes['error.stack']) {
        this.data.attributes['error.stack'] = attributes['error.stack'];
      }
    }
    return this;
  }

  /**
   * 记录异常
   */
  recordException(error: Error, attributes?: Attributes): this {
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack ?? '',
      ...attributes,
    });
    this.setError(error.message, {
      'error.type': error.name,
      'error.stack': error.stack ?? '',
    });
    return this;
  }

  /**
   * 获取状态
   */
  getStatus(): SpanStatus {
    return { ...this.data.status };
  }

  /**
   * 获取事件列表
   */
  getEvents(): SpanEvent[] {
    return [...this.data.events];
  }

  /**
   * 获取链接列表
   */
  getLinks(): SpanLink[] {
    return [...this.data.links];
  }

  /**
   * 获取开始时间
   */
  getStartTimeMs(): number {
    return this.data.startTimeMs;
  }

  /**
   * 获取持续时间
   */
  getDurationMs(): number | undefined {
    return this.data.durationMs;
  }

  /**
   * 检查是否已结束
   */
  isEnded(): boolean {
    return this.state.ended;
  }

  /**
   * 检查是否已采样
   */
  isSampled(): boolean {
    return this.data.sampled;
  }

  /**
   * 结束 Span
   */
  end(endTimeMs: number = Date.now()): void {
    if (this.state.ended) {
      return;
    }
    this.state.ended = true;
    this.data.endTimeMs = endTimeMs;
    this.data.durationMs = endTimeMs - this.data.startTimeMs;

    // 默认状态为 OK（如果未设置）
    if (this.data.status.code === 'UNSET') {
      this.data.status = { code: 'OK' };
    }

    if (this.onEndCallback) {
      this.onEndCallback(this.data);
    }
  }

  /**
   * 转换为 JSON 数据
   */
  toJSON(): SpanData {
    return { ...this.data, attributes: { ...this.data.attributes }, events: [...this.data.events], links: [...this.data.links] };
  }

  /**
   * 转换为可读字符串
   */
  toString(): string {
    const status = this.data.status.code === 'ERROR' ? '❌' : this.data.status.code === 'OK' ? '✅' : '⏳';
    const duration = this.data.durationMs !== undefined ? `${this.data.durationMs}ms` : 'in-progress';
    return `${status} ${this.data.name} [${this.data.kind}] ${duration}`;
  }
}

/**
 * NonRecordingSpan - 不记录数据的 Span (用于不采样的追踪)
 */
export class NonRecordingSpan {
  private readonly _spanId: SpanId;
  private readonly _traceId: TraceId;

  constructor(traceId: TraceId, spanId: SpanId) {
    this._traceId = traceId;
    this._spanId = spanId;
  }

  getSpanId(): SpanId {
    return this._spanId;
  }

  getTraceId(): TraceId {
    return this._traceId;
  }

  setAttribute(_key?: string, _value?: AttributeValue): this {
    return this;
  }

  setAttributes(_attributes?: Attributes): this {
    return this;
  }

  setStatus(_status?: SpanStatus): this {
    return this;
  }

  setError(_message?: string, _attributes?: Attributes): this {
    return this;
  }

  addEvent(_name?: string, _attributes?: Attributes): this {
    return this;
  }

  addLink(_link?: SpanLink): this {
    return this;
  }

  end(_endTimeMs?: number): void {
    // No-op
  }

  isEnded(): boolean {
    return true;
  }

  isSampled(): boolean {
    return false;
  }
}

/** 工厂函数 */
export function createSpan(
  data: SpanData,
  onEndCallback?: (span: SpanData) => void
): Span {
  return new Span(data, onEndCallback);
}
