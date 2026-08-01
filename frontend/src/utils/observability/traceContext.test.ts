/**
 * # ============================================================
 * # OpenTelemetry 追踪系统 单元测试 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：验证分布式追踪系统的所有功能
 * # 运行流程：
 * #   1. TraceContext 生成/序列化/反序列化
# #   2. Span 创建/属性/事件/状态/生命周期
# #   3. Tracer 启动/管理/采样/导出
# #   4. 批量处理器/导出器
# # ====================================
# # 修改记录：
# #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
# # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  isValidTraceId,
  isValidSpanId,
  serializeTraceparent,
  deserializeTraceparent,
  serializeTracestate,
  deserializeTracestate,
  createRootContext,
  createChildContext,
  injectContextIntoHeaders,
  extractContextFromHeaders,
  formatContext,
} from './traceContext';
import { Span, NonRecordingSpan } from './span';
import {
  ConsoleSpanExporter,
  InMemorySpanExporter,
  BatchSpanProcessor,
} from './spanExporter';
import {
  Tracer,
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
  createDefaultTracerConfig,
} from './tracer';
import type { SpanData, TracerConfig, Attributes } from './traceTypes';

describe('TraceContext', () => {
  describe('生成与验证', () => {
    it('应该生成有效的 Trace ID', () => {
      const id = generateTraceId();
      expect(id).toHaveLength(32);
      expect(isValidTraceId(id)).toBe(true);
    });

    it('应该生成有效的 Span ID', () => {
      const id = generateSpanId();
      expect(id).toHaveLength(16);
      expect(isValidSpanId(id)).toBe(true);
    });

    it('应该拒绝全零的 Trace ID', () => {
      expect(isValidTraceId('0'.repeat(32))).toBe(false);
    });

    it('应该拒绝全零的 Span ID', () => {
      expect(isValidSpanId('0'.repeat(16))).toBe(false);
    });

    it('应该拒绝长度不对的 Trace ID', () => {
      expect(isValidTraceId('abc')).toBe(false);
    });
  });

  describe('traceparent 序列化', () => {
    it('应该序列化有效的 Context', () => {
      const ctx = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      };
      expect(serializeTraceparent(ctx)).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    });

    it('应该反序列化有效的 traceparent', () => {
      const ctx = deserializeTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
      expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(ctx?.spanId).toBe('00f067aa0ba902b7');
      expect(ctx?.traceFlags).toBe(1);
    });

    it('应该拒绝无效的 traceparent', () => {
      expect(deserializeTraceparent('')).toBeNull();
      expect(deserializeTraceparent('invalid')).toBeNull();
      expect(deserializeTraceparent('00-badtraceid-00f067aa0ba902b7-01')).toBeNull();
    });

    it('应该拒绝无效的 Trace ID 在序列化时', () => {
      expect(() =>
        serializeTraceparent({ traceId: 'invalid', spanId: '00f067aa0ba902b7', traceFlags: 1 })
      ).toThrow();
    });
  });

  describe('tracestate 序列化', () => {
    it('应该序列化与反序列化', () => {
      const state = { vendor1: 'value1', vendor2: 'value2' };
      const serialized = serializeTracestate(state);
      const deserialized = deserializeTracestate(serialized);
      expect(deserialized.vendor1).toBe('value1');
      expect(deserialized.vendor2).toBe('value2');
    });

    it('应该处理空 tracestate', () => {
      expect(deserializeTracestate('')).toEqual({});
    });
  });

  describe('Context 创建', () => {
    it('应该创建根 Context', () => {
      const ctx = createRootContext();
      expect(isValidTraceId(ctx.traceId)).toBe(true);
      expect(isValidSpanId(ctx.spanId)).toBe(true);
    });

    it('子 Context 应共享 Trace ID', () => {
      const parent = createRootContext();
      const child = createChildContext(parent);
      expect(child.traceId).toBe(parent.traceId);
      expect(child.spanId).not.toBe(parent.spanId);
    });
  });

  describe('HTTP 头注入与提取', () => {
    it('应该注入 context 到 headers', () => {
      const ctx = createRootContext();
      const headers = injectContextIntoHeaders(ctx);
      expect(headers.traceparent).toBeDefined();
    });

    it('应该从 headers 提取 context', () => {
      const ctx = createRootContext();
      const headers = injectContextIntoHeaders(ctx);
      const extracted = extractContextFromHeaders(headers);
      expect(extracted?.traceId).toBe(ctx.traceId);
    });

    it('应该处理缺失的 traceparent', () => {
      expect(extractContextFromHeaders({})).toBeNull();
    });
  });

  it('应该格式化 Context 为可读字符串', () => {
    const ctx = createRootContext();
    const formatted = formatContext(ctx);
    expect(formatted).toContain('/');
    expect(formatted).toContain('flags=');
  });
});

describe('Span', () => {
  function createTestSpanData(overrides: Partial<SpanData> = {}): SpanData {
    return {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      name: 'test-span',
      kind: 'internal',
      startTimeMs: Date.now(),
      attributes: {},
      events: [],
      links: [],
      status: { code: 'UNSET' },
      resource: {
        serviceName: 'test',
        serviceVersion: '1.0.0',
        deploymentEnvironment: 'test',
      },
      sampled: true,
      ...overrides,
    };
  }

  describe('基本操作', () => {
    it('应该创建 Span', () => {
      const span = new Span(createTestSpanData());
      expect(span.getName()).toBe('test-span');
      expect(span.getTraceId()).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });

    it('应该设置属性', () => {
      const span = new Span(createTestSpanData());
      span.setAttribute('user.id', '123');
      expect(span.getAttribute('user.id')).toBe('123');
    });

    it('应该批量设置属性', () => {
      const span = new Span(createTestSpanData());
      span.setAttributes({ 'a': 1, 'b': 'two' });
      expect(span.getAttribute('a')).toBe(1);
      expect(span.getAttribute('b')).toBe('two');
    });

    it('应该重命名 Span', () => {
      const span = new Span(createTestSpanData());
      span.setName('new-name');
      expect(span.getName()).toBe('new-name');
    });
  });

  describe('事件', () => {
    it('应该添加事件', () => {
      const span = new Span(createTestSpanData());
      span.addEvent('cache-miss', { key: 'foo' });
      const events = span.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.name).toBe('cache-miss');
      expect(events[0]!.attributes?.key).toBe('foo');
    });
  });

  describe('状态', () => {
    it('应该设置 OK 状态', () => {
      const span = new Span(createTestSpanData());
      span.setStatus({ code: 'OK' });
      expect(span.getStatus().code).toBe('OK');
    });

    it('应该设置 ERROR 状态', () => {
      const span = new Span(createTestSpanData());
      span.setError('something failed');
      expect(span.getStatus().code).toBe('ERROR');
      expect(span.getAttribute('error.message')).toBe('something failed');
    });

    it('应该记录异常', () => {
      const span = new Span(createTestSpanData());
      const err = new Error('test error');
      span.recordException(err);
      const events = span.getEvents();
      expect(events.some((e) => e.name === 'exception')).toBe(true);
      expect(span.getStatus().code).toBe('ERROR');
    });
  });

  describe('生命周期', () => {
    it('应该正确结束 Span', () => {
      const span = new Span(createTestSpanData());
      expect(span.isEnded()).toBe(false);
      span.end();
      expect(span.isEnded()).toBe(true);
      expect(span.getDurationMs()).toBeDefined();
    });

    it('应该自动设置 OK 状态', () => {
      const span = new Span(createTestSpanData());
      span.end();
      expect(span.getStatus().code).toBe('OK');
    });

    it('应该防止重复结束', () => {
      const span = new Span(createTestSpanData());
      const cb = vi.fn();
      const s = new Span(createTestSpanData(), cb);
      s.end();
      s.end(); // 第二次无效果
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('end 后应阻止属性修改', () => {
      const span = new Span(createTestSpanData());
      span.end();
      expect(() => span.setAttribute('a', 1)).toThrow();
    });
  });

  it('NonRecordingSpan 应为 noop', () => {
    const span = new NonRecordingSpan('aaaa', 'bbbb');
    span.setAttribute('a', 1); // 不应抛出
    span.end();
    expect(span.isEnded()).toBe(true);
    expect(span.isSampled()).toBe(false);
  });
});

describe('SpanExporter', () => {
  describe('InMemorySpanExporter', () => {
    it('应该导出 spans 到内存', async () => {
      const exporter = new InMemorySpanExporter();
      await exporter.start();
      const span: SpanData = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'test',
        kind: 'internal',
        startTimeMs: Date.now(),
        endTimeMs: Date.now(),
        durationMs: 100,
        attributes: {},
        events: [],
        links: [],
        status: { code: 'OK' },
        resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
        sampled: true,
      };
      const result = await exporter.export([span]);
      expect(result.exportedCount).toBe(1);
      expect(exporter.getSpans()).toHaveLength(1);
    });

    it('应该支持清空', async () => {
      const exporter = new InMemorySpanExporter();
      const span: SpanData = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 't',
        kind: 'internal',
        startTimeMs: Date.now(),
        attributes: {},
        events: [],
        links: [],
        status: { code: 'OK' },
        resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
        sampled: true,
      };
      await exporter.export([span]);
      exporter.clear();
      expect(exporter.getSpans()).toHaveLength(0);
    });
  });

  describe('ConsoleSpanExporter', () => {
    it('应该调用 console.log', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exporter = new ConsoleSpanExporter();
      await exporter.start();
      const span: SpanData = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'test',
        kind: 'internal',
        startTimeMs: Date.now(),
        endTimeMs: Date.now(),
        durationMs: 100,
        attributes: {},
        events: [],
        links: [],
        status: { code: 'OK' },
        resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
        sampled: true,
      };
      await exporter.export([span]);
      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('disabled 时不应输出', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exporter = new ConsoleSpanExporter({ enabled: false });
      await exporter.export([]);
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });
});

describe('BatchSpanProcessor', () => {
  it('应该缓冲 spans', () => {
    const exporter = new InMemorySpanExporter();
    const processor = new BatchSpanProcessor(exporter, { maxBatchSize: 10, scheduledDelayMs: 60000 });
    const span: SpanData = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 't',
      kind: 'internal',
      startTimeMs: Date.now(),
      attributes: {},
      events: [],
      links: [],
      status: { code: 'OK' },
      resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
      sampled: true,
    };
    processor.onEnd(span);
    expect(processor.getBufferSize()).toBe(1);
  });

  it('应该达到批量大小时立即导出', async () => {
    const exporter = new InMemorySpanExporter();
    const processor = new BatchSpanProcessor(exporter, { maxBatchSize: 2, scheduledDelayMs: 60000 });
    for (let i = 0; i < 3; i++) {
      const span: SpanData = {
        traceId: 'a'.repeat(32),
        spanId: `b${i}`.padStart(16, 'b'),
        name: `s${i}`,
        kind: 'internal',
        startTimeMs: Date.now(),
        attributes: {},
        events: [],
        links: [],
        status: { code: 'OK' },
        resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
        sampled: true,
      };
      processor.onEnd(span);
    }
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(exporter.getSpans().length).toBeGreaterThan(0);
  });

  it('应该限制最大队列', () => {
    const exporter = new InMemorySpanExporter();
    const processor = new BatchSpanProcessor(exporter, { maxBatchSize: 100, maxQueueSize: 3, scheduledDelayMs: 60000 });
    for (let i = 0; i < 5; i++) {
      const span: SpanData = {
        traceId: 'a'.repeat(32),
        spanId: `b${i}`.padStart(16, 'b'),
        name: `s${i}`,
        kind: 'internal',
        startTimeMs: Date.now(),
        attributes: {},
        events: [],
        links: [],
        status: { code: 'OK' },
        resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
        sampled: true,
      };
      processor.onEnd(span);
    }
    expect(processor.getBufferSize()).toBeLessThanOrEqual(3);
  });

  it('forceFlush 应清空缓冲', async () => {
    const exporter = new InMemorySpanExporter();
    const processor = new BatchSpanProcessor(exporter, { maxBatchSize: 100, scheduledDelayMs: 60000 });
    const span: SpanData = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 't',
      kind: 'internal',
      startTimeMs: Date.now(),
      attributes: {},
      events: [],
      links: [],
      status: { code: 'OK' },
      resource: { serviceName: 't', serviceVersion: '1', deploymentEnvironment: 't' },
      sampled: true,
    };
    processor.onEnd(span);
    await processor.forceFlush();
    expect(processor.getBufferSize()).toBe(0);
  });
});

describe('Sampler', () => {
  const ctx = createRootContext();

  it('AlwaysOn 总是采样', () => {
    const s = new AlwaysOnSampler();
    expect(s.shouldSample(ctx, 'test').decision).toBe('record-and-sample');
  });

  it('AlwaysOff 总是不采样', () => {
    const s = new AlwaysOffSampler();
    expect(s.shouldSample(ctx, 'test').decision).toBe('drop');
  });

  it('TraceIdRatioBased 按比例采样', () => {
    const s = new TraceIdRatioBasedSampler(0);
    expect(s.shouldSample(ctx, 'test').decision).toBe('drop');
    const s2 = new TraceIdRatioBasedSampler(1);
    expect(s2.shouldSample(ctx, 'test').decision).toBe('record-and-sample');
  });

  it('ParentBased 应尊重父级决策', () => {
    const root = new AlwaysOnSampler();
    const s = new ParentBasedSampler(root);
    const sampledCtx = { ...ctx, traceFlags: 1 };
    expect(s.shouldSample(sampledCtx, 'test').decision).toBe('record-and-sample');
  });
});

describe('Tracer', () => {
  let tracer: Tracer;
  let exporter: InMemorySpanExporter;

  beforeEach(async () => {
    exporter = new InMemorySpanExporter();
    const config: TracerConfig = createDefaultTracerConfig('test-service', {
      samplingRate: 1.0,
      batchSize: 10,
      batchIntervalMs: 60000, // 长间隔避免自动导出
    });
    tracer = new Tracer(config, exporter, new AlwaysOnSampler());
    await tracer.start();
  });

  it('应该启动并管理 Span', async () => {
    const span = tracer.startSpan('test-op');
    expect(span.getName()).toBe('test-op');
    span.end();
    await tracer.forceFlush();
    expect(exporter.getFinishedSpans().length).toBe(1);
  });

  it('应该支持子 Span', () => {
    const parent = tracer.startSpan('parent');
    const child = tracer.startChildSpanFromParent('child', parent);
    expect(child.getTraceId()).toBe(parent.getTraceId());
    expect(child.getParentSpanId()).toBe(parent.getSpanId());
    parent.end();
    child.end();
  });

  it('应该在 withSpan 中捕获异常', async () => {
    await expect(
      tracer.withSpan('op', async () => {
        throw new Error('test');
      })
    ).rejects.toThrow('test');
    const errors = tracer.getErrorSpans();
    expect(errors.length).toBe(1);
  });

  it('应该正常完成 withSpan', async () => {
    const result = await tracer.withSpan('op', async () => 42);
    expect(result).toBe(42);
  });

  it('应支持事件订阅', () => {
    const listener = vi.fn();
    const unsub = tracer.subscribe(listener);
    const span = tracer.startSpan('test');
    span.end();
    const callCountAfterFirst = listener.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);
    unsub();
    const span2 = tracer.startSpan('test2');
    span2.end();
    // unsubscribe 后不应再增加调用
    expect(listener.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('AlwaysOff 采样器应丢弃 Spans', async () => {
    const offTracer = new Tracer(
      createDefaultTracerConfig('off-svc', { samplingRate: 0 }),
      new InMemorySpanExporter(),
      new AlwaysOffSampler()
    );
    await offTracer.start();
    const span = offTracer.startSpan('test');
    span.end();
    expect(span.isSampled()).toBe(false);
  });

  it('应生成完整报告', () => {
    const span = tracer.startSpan('test');
    span.setAttribute('key', 'value');
    span.end();
    const report = tracer.generateReport();
    expect(report.serviceName).toBe('test-service');
    expect(report.totalSpans).toBeGreaterThan(0);
  });

  it('应正确关闭', async () => {
    const span = tracer.startSpan('test');
    await tracer.shutdown();
    expect(span.isEnded()).toBe(true);
  });
});
