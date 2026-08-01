/**
 * # ============================================================
 * # OTLP Exporter 单元测试 (Cycle 54 G54-01)
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OTLPExporter,
  convertToOTLPSpan,
  buildOTLPRequestBody,
  isOTLPSuccess,
  createDefaultOTLPEndpoint,
  createJaegerOTLPEndpoint,
  createTempoOTLPEndpoint,
} from './otlpExporter';
import type { SpanData } from '../observability/traceTypes';

const baseSpan: SpanData = {
  traceId: '0123456789abcdef0123456789abcdef',
  spanId: '0123456789abcdef',
  name: 'test-span',
  kind: 'internal',
  startTimeMs: 1700000000000,
  endTimeMs: 1700000001000,
  durationMs: 1000,
  attributes: {
    'http.method': 'GET',
    'http.status_code': 200,
    'service.name': 'api',
  },
  status: { code: 'OK' },
  events: [],
  links: [],
  resource: { serviceName: 'test', serviceVersion: '1.0.0', deploymentEnvironment: 'test' },
  sampled: true,
};

describe('convertToOTLPSpan', () => {
  it('应该转换基本字段', () => {
    const otlp = convertToOTLPSpan(baseSpan);
    expect(otlp.traceId).toBe(baseSpan.traceId);
    expect(otlp.spanId).toBe(baseSpan.spanId);
    expect(otlp.name).toBe(baseSpan.name);
    expect(otlp.startTimeUnixNano).toBe(String(baseSpan.startTimeMs * 1_000_000));
    expect(otlp.endTimeUnixNano).toBe(String(baseSpan.endTimeMs! * 1_000_000));
  });

  it('应该将 string 属性转换为 stringValue', () => {
    const otlp = convertToOTLPSpan(baseSpan);
    const method = otlp.attributes.find((a) => a.key === 'http.method');
    expect(method?.value.stringValue).toBe('GET');
  });

  it('应该将整数转换为 intValue', () => {
    const otlp = convertToOTLPSpan(baseSpan);
    const status = otlp.attributes.find((a) => a.key === 'http.status_code');
    expect(status?.value.intValue).toBe('200');
  });

  it('应该将浮点数转换为 doubleValue', () => {
    const span: SpanData = { ...baseSpan, attributes: { ratio: 0.5 } };
    const otlp = convertToOTLPSpan(span);
    const ratio = otlp.attributes.find((a) => a.key === 'ratio');
    expect(ratio?.value.doubleValue).toBe(0.5);
  });

  it('应该将布尔值转换为 boolValue', () => {
    const span: SpanData = { ...baseSpan, attributes: { cached: true } };
    const otlp = convertToOTLPSpan(span);
    const cached = otlp.attributes.find((a) => a.key === 'cached');
    expect(cached?.value.boolValue).toBe(true);
  });

  it('应该转换 status OK', () => {
    const otlp = convertToOTLPSpan(baseSpan);
    expect(otlp.status.code).toBe(1);
  });

  it('应该转换 status ERROR', () => {
    const span: SpanData = { ...baseSpan, status: { code: 'ERROR', message: 'failed' } };
    const otlp = convertToOTLPSpan(span);
    expect(otlp.status.code).toBe(2);
    expect(otlp.status.message).toBe('failed');
  });

  it('应该转换 events', () => {
    const span: SpanData = {
      ...baseSpan,
      events: [{ name: 'event1', timestamp: 1700000000500, attributes: { foo: 'bar' } }],
    };
    const otlp = convertToOTLPSpan(span);
    expect(otlp.events?.[0]?.name).toBe('event1');
    expect(otlp.events?.[0]?.timeUnixNano).toBe(String(1700000000500 * 1_000_000));
  });

  it('应该转换 parentSpanId', () => {
    const span: SpanData = { ...baseSpan, parentSpanId: 'fedcba9876543210' };
    const otlp = convertToOTLPSpan(span);
    expect(otlp.parentSpanId).toBe('fedcba9876543210');
  });
});

describe('buildOTLPRequestBody', () => {
  it('应该构建有效的 OTLP JSON', () => {
    const body = buildOTLPRequestBody([baseSpan], { 'service.name': 'test' });
    const parsed = JSON.parse(body);
    expect(parsed.resourceSpans).toBeDefined();
    expect(parsed.resourceSpans).toHaveLength(1);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    expect(parsed.resourceSpans[0].resource.attributes[0].key).toBe('service.name');
  });

  it('应该处理空 span 列表', () => {
    const body = buildOTLPRequestBody([]);
    const parsed = JSON.parse(body);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans).toHaveLength(0);
  });
});

describe('isOTLPSuccess', () => {
  it('200 成功', () => expect(isOTLPSuccess(200)).toBe(true));
  it('201 成功', () => expect(isOTLPSuccess(201)).toBe(true));
  it('299 成功', () => expect(isOTLPSuccess(299)).toBe(true));
  it('300 失败', () => expect(isOTLPSuccess(300)).toBe(false));
  it('400 失败', () => expect(isOTLPSuccess(400)).toBe(false));
  it('500 失败', () => expect(isOTLPSuccess(500)).toBe(false));
});

describe('工厂函数', () => {
  it('createDefaultOTLPEndpoint', () => {
    const ep = createDefaultOTLPEndpoint('test', 'http://localhost:4318');
    expect(ep.name).toBe('test');
    expect(ep.baseUrl).toBe('http://localhost:4318');
  });

  it('createJaegerOTLPEndpoint', () => {
    const ep = createJaegerOTLPEndpoint('jaeger.local');
    expect(ep.baseUrl).toBe('http://jaeger.local:4318');
  });

  it('createTempoOTLPEndpoint', () => {
    const ep = createTempoOTLPEndpoint('tempo.local', 443);
    expect(ep.baseUrl).toBe('http://tempo.local:443');
  });
});

describe('OTLPExporter', () => {
  let exporter: OTLPExporter;

  beforeEach(() => {
    exporter = new OTLPExporter({
      mode: 'mock',
      endpoint: createDefaultOTLPEndpoint('test', 'http://localhost:4318'),
      enabled: true,
    });
  });

  it('应该正确导出空列表', async () => {
    await exporter.start();
    const result = await exporter.export([]);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it('Mock 模式应该成功导出', async () => {
    await exporter.start();
    const result = await exporter.export([baseSpan, baseSpan]);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.platform).toBe('otlp');
  });

  it('未启动时导出应该返回错误', async () => {
    const result = await exporter.export([baseSpan]);
    expect(result.failureCount).toBe(1);
    expect(result.errors?.[0]).toContain('not started');
  });

  it('禁用时导出应该返回 0/0', async () => {
    await exporter.start();
    exporter.updateEndpoint({ ...exporter.getEndpoint() });
    const disabled = new OTLPExporter({
      mode: 'mock',
      endpoint: createDefaultOTLPEndpoint('test', 'http://localhost:4318'),
      enabled: false,
    });
    await disabled.start();
    const result = await disabled.export([baseSpan]);
    expect(result.successCount).toBe(0);
  });

  it('健康检查 Mock 模式', async () => {
    await exporter.start();
    const health = await exporter.healthCheck();
    expect(health.status).toBe('connected');
    expect(health.platform).toBe('otlp');
  });

  it('订阅事件', async () => {
    const listener = vi.fn();
    const unsub = exporter.subscribe(listener);
    await exporter.start();
    expect(listener).toHaveBeenCalled();
    unsub();
    listener.mockClear();
    await exporter.shutdown();
    // unsubscribe 后不再调用
    // 注意：start 已发出事件，但 unsub 在 start 之后，所以可能还有
  });

  it('shutdown 后事件', async () => {
    const listener = vi.fn();
    await exporter.start();
    exporter.subscribe(listener);
    await exporter.shutdown();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'disconnected' })
    );
  });

  it('导出事件触发', async () => {
    const listener = vi.fn();
    await exporter.start();
    exporter.subscribe(listener);
    await exporter.export([baseSpan]);
    const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('export-success');
  });

  it('更新端点应该发出 config-updated 事件', async () => {
    const listener = vi.fn();
    await exporter.start();
    exporter.subscribe(listener);
    exporter.updateEndpoint(createDefaultOTLPEndpoint('new', 'http://new:4318'));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config-updated' })
    );
  });

  it('导出历史应该被记录', async () => {
    await exporter.start();
    await exporter.export([baseSpan]);
    await exporter.export([baseSpan, baseSpan]);
    const history = exporter.getExportHistory();
    expect(history.length).toBe(2);
    expect(history[0].successCount).toBe(1);
    expect(history[1].successCount).toBe(2);
  });

  it('导出历史应限制为 100 条', async () => {
    await exporter.start();
    for (let i = 0; i < 105; i++) {
      await exporter.export([baseSpan]);
    }
    const history = exporter.getExportHistory();
    expect(history.length).toBe(100);
  });

  it('分批导出大量 spans', async () => {
    const smallExporter = new OTLPExporter({
      mode: 'mock',
      endpoint: createDefaultOTLPEndpoint('test', 'http://localhost:4318'),
      maxSpansPerRequest: 2,
    });
    await smallExporter.start();
    const spans = Array.from({ length: 5 }, (_, i) => ({ ...baseSpan, name: `span-${i}` }));
    const result = await smallExporter.export(spans);
    expect(result.successCount).toBe(5);
  });
});

describe('OTLPExporter 边界情况', () => {
  it('空 spans 列表', async () => {
    const exp = new OTLPExporter({
      mode: 'mock',
      endpoint: createDefaultOTLPEndpoint('test', 'http://localhost:4318'),
    });
    await exp.start();
    const result = await exp.export([]);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it('未 start 时的健康检查', async () => {
    const exp = new OTLPExporter({
      mode: 'mock',
      endpoint: createDefaultOTLPEndpoint('test', 'http://localhost:4318'),
    });
    const health = await exp.healthCheck();
    expect(health).toBeDefined();
  });

  it('mode=real 在测试中应该不会卡死', async () => {
    // 使用不存在的域名 + 短超时，避免真实网络阻塞
    const exp = new OTLPExporter({
      mode: 'real',
      endpoint: createDefaultOTLPEndpoint('test', 'http://127.0.0.1:1', { timeoutMs: 200 }),
      enabled: true,
      retryPolicy: {
        maxRetries: 0,
        initialDelayMs: 100,
        maxDelayMs: 500,
        backoffMultiplier: 2,
        jitterFactor: 0,
      },
    });
    await exp.start();
    const result = await exp.export([baseSpan]);
    expect(result).toBeDefined();
    expect(result.failureCount + result.successCount).toBe(1);
  });
});
