/**
 * # ============================================================
 * # Jaeger/Tempo 追踪后端适配器单元测试 (Cycle 54 G54-04)
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TraceBackendAdapter,
  convertJaegerSpan,
  convertTempoSpan,
  parseJaegerSearchResponse,
  parseJaegerTrace,
  parseTempoSearchResponse,
  parseTempoTrace,
  createJaegerEndpoint,
  createTempoEndpoint,
  isValidTraceId,
} from './traceBackendAdapter';
import type { SpanData } from '../observability/traceTypes';

describe('convertJaegerSpan', () => {
  it('应该转换基本字段', () => {
    const span = {
      traceID: 'ABC123',
      spanID: 'DEF456',
      operationName: 'test-op',
      startTime: 1700000000000000,
      duration: 1000000,
      tags: [],
      processID: 'p1',
    };
    const processes = { p1: { serviceName: 'test-service', tags: [] } };
    const result = convertJaegerSpan(span, processes);
    expect(result.traceId).toBe('abc123');
    expect(result.spanId).toBe('def456');
    expect(result.name).toBe('test-op');
    expect(result.startTimeMs).toBe(1700000000000);
    expect(result.durationMs).toBe(1000);
  });

  it('应该转换父 span ID', () => {
    const span = {
      traceID: 'abc',
      spanID: 'def',
      operationName: 'child',
      references: [{ refType: 'CHILD_OF', traceID: 'abc', spanID: 'parent' }],
      startTime: 1,
      duration: 1,
      tags: [],
      processID: 'p1',
    };
    const processes = { p1: { serviceName: 's', tags: [] } };
    const result = convertJaegerSpan(span, processes);
    expect(result.parentSpanId).toBe('parent');
  });

  it('应该处理 FOLLOWS_FROM', () => {
    const span = {
      traceID: 'abc',
      spanID: 'def',
      operationName: 'child',
      references: [{ refType: 'FOLLOWS_FROM', traceID: 'abc', spanID: 'parent' }],
      startTime: 1,
      duration: 1,
      tags: [],
      processID: 'p1',
    };
    const processes = { p1: { serviceName: 's', tags: [] } };
    const result = convertJaegerSpan(span, processes);
    expect(result.parentSpanId).toBe('parent');
  });

  it('应该转换 error tag 为 ERROR 状态', () => {
    const span = {
      traceID: 'abc',
      spanID: 'def',
      operationName: 'fail',
      startTime: 1,
      duration: 1,
      tags: [{ key: 'error', type: 'bool', value: true }],
      processID: 'p1',
    };
    const processes = { p1: { serviceName: 's', tags: [] } };
    const result = convertJaegerSpan(span, processes);
    expect(result.status.code).toBe('ERROR');
  });

  it('应该转换 logs 到 events', () => {
    const span = {
      traceID: 'abc',
      spanID: 'def',
      operationName: 'op',
      startTime: 1,
      duration: 1,
      tags: [],
      logs: [{ timestamp: 500, fields: [{ key: 'event', type: 'string', value: 'something' }] }],
      processID: 'p1',
    };
    const processes = { p1: { serviceName: 's', tags: [] } };
    const result = convertJaegerSpan(span, processes);
    expect(result.events.length).toBe(1);
    expect(result.events[0].name).toBe('event');
  });
});

describe('parseJaegerSearchResponse', () => {
  it('应该解析搜索响应', () => {
    const res = {
      data: [
        {
          traceID: 'abc',
          processes: { p1: { serviceName: 'api' } },
          spans: [
            { traceID: 'abc', spanID: '1', operationName: 'GET', startTime: 100, duration: 50, tags: [], processID: 'p1' },
            { traceID: 'abc', spanID: '2', operationName: 'Handler', startTime: 110, duration: 30, tags: [], processID: 'p1' },
          ],
        },
      ],
    };
    const results = parseJaegerSearchResponse(res);
    expect(results.length).toBe(1);
    expect(results[0].traceId).toBe('abc');
    expect(results[0].rootOperation).toBe('GET');
    expect(results[0].spanCount).toBe(2);
  });

  it('空响应', () => {
    expect(parseJaegerSearchResponse({})).toEqual([]);
    expect(parseJaegerSearchResponse({ data: [] })).toEqual([]);
  });
});

describe('parseJaegerTrace', () => {
  it('应该解析 trace 详情', () => {
    const trace = {
      traceID: 'abc',
      spans: [
        { traceID: 'abc', spanID: '1', operationName: 'A', startTime: 1, duration: 1, tags: [], processID: 'p1' },
      ],
      processes: { p1: { serviceName: 'svc', tags: [{ key: 'env', value: 'prod' }] } },
    };
    const detail = parseJaegerTrace(trace);
    expect(detail.traceId).toBe('abc');
    expect(detail.spans.length).toBe(1);
    expect(detail.processes.p1.serviceName).toBe('svc');
  });
});

describe('convertTempoSpan', () => {
  it('应该转换 Tempo span', () => {
    const span = {
      traceId: 'AA',
      spanId: 'BB',
      parentSpanId: 'CC',
      name: 'test',
      kind: 'SPAN_KIND_SERVER',
      startTimeUnixNano: '1700000000000000000',
      endTimeUnixNano: '1700000001000000000',
      attributes: [
        { key: 'http.method', value: { stringValue: 'GET' } },
        { key: 'http.status_code', value: { intValue: '200' } },
      ],
      events: [{ timeUnixNano: '1700000000500000000', name: 'event1' }],
    };
    const result = convertTempoSpan(span as never);
    expect(result.traceId).toBe('aa');
    expect(result.parentSpanId).toBe('cc');
    expect(result.attributes['http.method']).toBe('GET');
    expect(result.attributes['http.status_code']).toBe(200);
    expect(result.events.length).toBe(1);
  });

  it('应该处理 double value', () => {
    const span = {
      traceId: 'A',
      spanId: 'B',
      name: 'test',
      kind: 'SPAN_KIND_INTERNAL',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '2000000000',
      attributes: [{ key: 'ratio', value: { doubleValue: 0.5 } }],
    };
    const result = convertTempoSpan(span as never);
    expect(result.attributes['ratio']).toBe(0.5);
  });

  it('应该处理 bool value', () => {
    const span = {
      traceId: 'A',
      spanId: 'B',
      name: 'test',
      kind: 'SPAN_KIND_INTERNAL',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      attributes: [{ key: 'cached', value: { boolValue: true } }],
    };
    const result = convertTempoSpan(span as never);
    expect(result.attributes['cached']).toBe(true);
  });

  it('应该处理 ERROR status', () => {
    const span = {
      traceId: 'A',
      spanId: 'B',
      name: 'fail',
      kind: 'SPAN_KIND_INTERNAL',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      status: { code: 2, message: 'oops' },
    };
    const result = convertTempoSpan(span as never);
    expect(result.status.code).toBe('ERROR');
  });
});

describe('parseTempoSearchResponse', () => {
  it('应该解析', () => {
    const res = {
      traces: [
        {
          traceID: 'abc',
          rootServiceName: 'api',
          rootTraceName: 'GET /users',
          startTimeUnixNano: '1700000000000000000',
          durationMs: 100,
          spanSet: { spans: [{ spanID: '1' }] },
        },
      ],
    };
    const results = parseTempoSearchResponse(res);
    expect(results.length).toBe(1);
    expect(results[0].rootService).toBe('api');
  });
});

describe('parseTempoTrace', () => {
  it('应该解析', () => {
    const trace = {
      batches: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'api' } }] },
          scopeSpans: [
            {
              scope: { name: 'test' },
              spans: [
                { traceId: 'AA', spanId: 'BB', name: 'test', kind: 'SPAN_KIND_INTERNAL', startTimeUnixNano: '1', endTimeUnixNano: '2' },
              ],
            },
          ],
        },
      ],
    };
    const detail = parseTempoTrace(trace);
    expect(detail.spans.length).toBe(1);
    expect(detail.processes.p1.serviceName).toBe('api');
  });
});

describe('工厂函数', () => {
  it('createJaegerEndpoint', () => {
    const ep = createJaegerEndpoint('jaeger.local', 16686);
    expect(ep.baseUrl).toBe('http://jaeger.local:16686');
    expect(ep.protocol).toBe('http');
  });

  it('createJaegerEndpoint 带认证', () => {
    const ep = createJaegerEndpoint('jaeger.local', 16686, { username: 'admin', password: 'admin' });
    expect(ep.credentials?.scheme).toBe('basic');
  });

  it('createTempoEndpoint', () => {
    const ep = createTempoEndpoint('tempo.local', 3200);
    expect(ep.baseUrl).toBe('http://tempo.local:3200');
  });
});

describe('isValidTraceId', () => {
  it('有效 32 字符', () => {
    expect(isValidTraceId('0123456789abcdef0123456789abcdef')).toBe(true);
  });
  it('小写有效', () => {
    expect(isValidTraceId('0123456789abcdef0123456789abcdef')).toBe(true);
  });
  it('大写有效', () => {
    expect(isValidTraceId('0123456789ABCDEF0123456789ABCDEF')).toBe(true);
  });
  it('空字符串无效', () => {
    expect(isValidTraceId('')).toBe(false);
  });
  it('包含非 hex 字符', () => {
    expect(isValidTraceId('xyz')).toBe(false);
  });
  it('长度不对', () => {
    expect(isValidTraceId('abc')).toBe(false);
  });
  it('自定义长度 16', () => {
    expect(isValidTraceId('0123456789abcdef', 16)).toBe(true);
  });
});

describe('TraceBackendAdapter - Jaeger Mock', () => {
  let adapter: TraceBackendAdapter;

  beforeEach(() => {
    adapter = new TraceBackendAdapter({
      mode: 'mock',
      endpoint: createJaegerEndpoint('localhost', 16686),
      backendType: 'jaeger',
    });
  });

  it('启动和停止', async () => {
    const listener = vi.fn();
    adapter.subscribe(listener);
    await adapter.start();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'connected' }));
    await adapter.shutdown();
  });

  it('backendType 应该正确', () => {
    expect(adapter.getBackendType()).toBe('jaeger');
  });

  it('listServices Mock', async () => {
    await adapter.start();
    const services = await adapter.listServices();
    expect(services.length).toBeGreaterThan(0);
  });

  it('listOperations Mock', async () => {
    await adapter.start();
    const ops = await adapter.listOperations('api-gateway');
    expect(ops.length).toBeGreaterThan(0);
  });

  it('searchTraces Mock', async () => {
    await adapter.start();
    const results = await adapter.searchTraces({ service: 'api-gateway', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('searchTraces 空参数', async () => {
    await adapter.start();
    const results = await adapter.searchTraces();
    expect(Array.isArray(results)).toBe(true);
  });

  it('getTrace Mock', async () => {
    await adapter.start();
    const trace = await adapter.getTrace('123');
    expect(trace).toBeDefined();
    expect(trace?.spans.length).toBe(2);
  });

  it('未启动应该返回空', async () => {
    const services = await adapter.listServices();
    expect(services).toEqual([]);
  });

  it('健康检查 Mock', async () => {
    await adapter.start();
    const h = await adapter.healthCheck();
    expect(h.status).toBe('connected');
    expect(h.details?.backend).toBe('jaeger');
  });

  it('更新端点', async () => {
    const listener = vi.fn();
    await adapter.start();
    adapter.subscribe(listener);
    adapter.updateEndpoint(createJaegerEndpoint('new', 16686));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'config-updated' }));
  });

  it('name 应该反映 backend type', () => {
    expect(adapter.name).toBe('trace-jaeger');
  });
});

describe('TraceBackendAdapter - Tempo Mock', () => {
  it('listServices', async () => {
    const adapter = new TraceBackendAdapter({
      mode: 'mock',
      endpoint: createTempoEndpoint('localhost', 3200),
      backendType: 'tempo',
    });
    await adapter.start();
    const services = await adapter.listServices();
    expect(services.length).toBeGreaterThan(0);
  });

  it('healthCheck', async () => {
    const adapter = new TraceBackendAdapter({
      mode: 'mock',
      endpoint: createTempoEndpoint('localhost', 3200),
      backendType: 'tempo',
    });
    await adapter.start();
    const h = await adapter.healthCheck();
    expect(h.details?.backend).toBe('tempo');
  });

  it('name 应该是 trace-tempo', () => {
    const adapter = new TraceBackendAdapter({
      mode: 'mock',
      endpoint: createTempoEndpoint('localhost', 3200),
      backendType: 'tempo',
    });
    expect(adapter.name).toBe('trace-tempo');
  });
});
