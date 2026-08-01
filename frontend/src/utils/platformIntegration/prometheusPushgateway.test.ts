/**
 * # ============================================================
 * # Prometheus Pushgateway 单元测试 (Cycle 54 G54-02)
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PrometheusPushgateway,
  escapeLabelValue,
  escapeMetricName,
  formatLabels,
  formatMetric,
  formatHistogram,
  formatMetrics,
  formatNumber,
  buildPushgatewayPath,
  isPushgatewaySuccess,
  createPushgatewayEndpoint,
  createCounter,
  createGauge,
  createHistogram,
} from './prometheusPushgateway';
import type { MetricData, HistogramData } from './platformTypes';

describe('escapeLabelValue', () => {
  it('应该转义反斜杠', () => {
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
  });
  it('应该转义换行符', () => {
    expect(escapeLabelValue('a\nb')).toBe('a\\nb');
  });
  it('应该转义引号', () => {
    expect(escapeLabelValue('a"b')).toBe('a\\"b');
  });
  it('普通字符串保持不变', () => {
    expect(escapeLabelValue('hello')).toBe('hello');
  });
});

describe('escapeMetricName', () => {
  it('应该保留合法字符', () => {
    expect(escapeMetricName('http_requests_total')).toBe('http_requests_total');
    expect(escapeMetricName('metric:name')).toBe('metric:name');
  });
  it('应该替换非法字符', () => {
    expect(escapeMetricName('http-requests/total')).toBe('http_requests_total');
    expect(escapeMetricName('a.b@c')).toBe('a_b_c');
  });
});

describe('formatLabels', () => {
  it('空标签返回空字符串', () => {
    expect(formatLabels({})).toBe('');
  });
  it('应该按字母排序', () => {
    expect(formatLabels({ b: '2', a: '1' })).toBe('{a="1",b="2"}');
  });
  it('应该转义特殊字符', () => {
    expect(formatLabels({ foo: 'a"b' })).toBe('{foo="a\\"b"}');
  });
});

describe('formatNumber', () => {
  it('整数', () => expect(formatNumber(42)).toBe('42'));
  it('浮点数', () => expect(formatNumber(3.14)).toBe('3.14'));
  it('正无穷', () => expect(formatNumber(Infinity)).toBe('+Inf'));
  it('负无穷', () => expect(formatNumber(-Infinity)).toBe('-Inf'));
  it('NaN', () => expect(formatNumber(NaN)).toBe('NaN'));
  it('0', () => expect(formatNumber(0)).toBe('0'));
});

describe('formatMetric', () => {
  it('应该格式化 counter 指标', () => {
    const m: MetricData = {
      name: 'http_requests_total',
      type: 'counter',
      labels: { method: 'GET' },
      value: 100,
      timestamp: 1700000000000,
      help: 'Total HTTP requests',
    };
    const out = formatMetric(m);
    expect(out).toContain('# HELP http_requests_total Total HTTP requests');
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('http_requests_total{method="GET"} 100 1700000000000');
  });

  it('应该格式化 gauge 指标', () => {
    const m: MetricData = {
      name: 'memory_usage_bytes',
      type: 'gauge',
      labels: {},
      value: 1024,
      timestamp: 1700000000000,
    };
    const out = formatMetric(m);
    expect(out).toContain('# TYPE memory_usage_bytes gauge');
    expect(out).toContain('memory_usage_bytes 1024 1700000000000');
  });

  it('应该添加 unit 后缀', () => {
    const m: MetricData = {
      name: 'request_duration',
      type: 'gauge',
      labels: {},
      value: 1.5,
      timestamp: 1700000000000,
      unit: 'seconds',
    };
    const out = formatMetric(m);
    expect(out).toContain('seconds');
  });
});

describe('formatHistogram', () => {
  it('应该格式化直方图', () => {
    const h: HistogramData = {
      name: 'http_request_duration_seconds',
      labels: { service: 'api' },
      buckets: [
        { le: 0.1, count: 5 },
        { le: 0.5, count: 10 },
        { le: 1, count: 15 },
      ],
      sum: 7.5,
      count: 15,
      timestamp: 1700000000000,
    };
    const out = formatHistogram(h);
    expect(out).toContain('# TYPE http_request_duration_seconds histogram');
    // Prometheus label 顺序按字母排序，le < service 所以 le 在前
    expect(out).toContain('http_request_duration_seconds_bucket{le="0.1",service="api"} 5');
    expect(out).toContain('http_request_duration_seconds_bucket{le="+Inf",service="api"} 15');
    expect(out).toContain('http_request_duration_seconds_sum{service="api"} 7.5');
    expect(out).toContain('http_request_duration_seconds_count{service="api"} 15');
  });

  it('空 buckets 应该使用默认', () => {
    const h: HistogramData = {
      name: 'latency',
      labels: {},
      buckets: [],
      sum: 1,
      count: 1,
      timestamp: 1700000000000,
    };
    const out = formatHistogram(h, [1, 5, 10]);
    expect(out).toContain('le="1"');
    expect(out).toContain('le="5"');
    expect(out).toContain('le="10"');
  });
});

describe('formatMetrics', () => {
  it('应该组合多个指标', () => {
    const m1: MetricData = { name: 'a', type: 'counter', labels: {}, value: 1, timestamp: 1 };
    const m2: MetricData = { name: 'b', type: 'gauge', labels: {}, value: 2, timestamp: 2 };
    const out = formatMetrics([m1, m2]);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });
});

describe('buildPushgatewayPath', () => {
  it('基本 job', () => {
    expect(buildPushgatewayPath('myjob')).toBe('/metrics/job/myjob');
  });
  it('job + instance', () => {
    expect(buildPushgatewayPath('myjob', 'host1')).toBe('/metrics/job/myjob/instance/host1');
  });
  it('job + grouping key', () => {
    expect(buildPushgatewayPath('myjob', undefined, { env: 'prod' })).toBe('/metrics/job/myjob/env/prod');
  });
  it('URL 编码特殊字符', () => {
    expect(buildPushgatewayPath('my job')).toBe('/metrics/job/my%20job');
  });
});

describe('isPushgatewaySuccess', () => {
  it('200 成功', () => expect(isPushgatewaySuccess(200)).toBe(true));
  it('202 成功', () => expect(isPushgatewaySuccess(202)).toBe(true));
  it('500 失败', () => expect(isPushgatewaySuccess(500)).toBe(false));
});

describe('工厂函数', () => {
  it('createCounter', () => {
    const c = createCounter('test', 5, { l: 'v' }, 'help');
    expect(c.type).toBe('counter');
    expect(c.value).toBe(5);
    expect(c.help).toBe('help');
  });
  it('createGauge', () => {
    const g = createGauge('test', 3.14);
    expect(g.type).toBe('gauge');
    expect(g.value).toBe(3.14);
  });
  it('createHistogram', () => {
    const h = createHistogram('test', [{ le: 1, count: 5 }], 2, 5);
    expect(h.buckets).toHaveLength(1);
    expect(h.count).toBe(5);
  });
  it('createPushgatewayEndpoint', () => {
    const ep = createPushgatewayEndpoint('test', 'http://localhost:9091');
    expect(ep.baseUrl).toBe('http://localhost:9091');
  });
});

describe('PrometheusPushgateway', () => {
  let pg: PrometheusPushgateway;

  beforeEach(() => {
    pg = new PrometheusPushgateway({
      mode: 'mock',
      endpoint: createPushgatewayEndpoint('test', 'http://localhost:9091'),
      jobName: 'test_job',
      enabled: true,
    });
  });

  it('应该启动和停止', async () => {
    const listener = vi.fn();
    pg.subscribe(listener);
    await pg.start();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'connected' }));
    await pg.shutdown();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'disconnected' }));
  });

  it('添加和推送 Counter', async () => {
    await pg.start();
    pg.addCounter(createCounter('requests', 10, { route: '/api' }));
    expect(pg.getBufferSize()).toEqual({ metrics: 1, histograms: 0 });
    const result = await pg.push();
    expect(result.successCount).toBe(1);
    expect(pg.getBufferSize()).toEqual({ metrics: 0, histograms: 0 });
  });

  it('添加多个指标', async () => {
    await pg.start();
    pg.addMetrics([
      createCounter('a', 1),
      createCounter('b', 2),
      createGauge('c', 3),
    ]);
    expect(pg.getBufferSize().metrics).toBe(3);
    const result = await pg.push();
    expect(result.successCount).toBe(3);
  });

  it('添加直方图', async () => {
    await pg.start();
    pg.addHistogram(createHistogram('lat', [{ le: 0.1, count: 1 }], 0.5, 1));
    const result = await pg.push();
    expect(result.successCount).toBe(1);
  });

  it('空缓冲区推送', async () => {
    await pg.start();
    const result = await pg.push();
    expect(result.successCount).toBe(0);
  });

  it('未启动时推送', async () => {
    const result = await pg.push();
    expect(result.failureCount).toBe(0);
  });

  it('清空缓冲区', async () => {
    await pg.start();
    pg.addMetric(createCounter('a', 1));
    pg.clearBuffer();
    expect(pg.getBufferSize().metrics).toBe(0);
  });

  it('历史记录', async () => {
    await pg.start();
    pg.addMetric(createCounter('a', 1));
    await pg.push();
    pg.addMetric(createCounter('b', 2));
    await pg.push();
    const history = pg.getHistory();
    expect(history.length).toBe(2);
  });

  it('健康检查 Mock', async () => {
    await pg.start();
    const h = await pg.healthCheck();
    expect(h.status).toBe('connected');
    expect(h.platform).toBe('prometheus-pushgateway');
  });

  it('健康检查禁用', async () => {
    const disabledPg = new PrometheusPushgateway({
      mode: 'mock',
      endpoint: createPushgatewayEndpoint('test', 'http://localhost:9091'),
      jobName: 'job',
      enabled: false,
    });
    const h = await disabledPg.healthCheck();
    expect(h.status).toBe('connected');
    expect(h.details).toEqual({ mode: 'mock' });
  });

  it('删除指标 Mock', async () => {
    await pg.start();
    const r = await pg.delete();
    expect(r.successCount).toBe(1);
  });

  it('更新端点', async () => {
    const listener = vi.fn();
    await pg.start();
    pg.subscribe(listener);
    pg.updateEndpoint(createPushgatewayEndpoint('new', 'http://new:9091'));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'config-updated' }));
  });

  it('forceFlush 等同于 push', async () => {
    await pg.start();
    pg.addMetric(createCounter('a', 1));
    const r = await pg.forceFlush();
    expect(r.successCount).toBe(1);
  });

  it('禁用时推送返回 0/0', async () => {
    const disabled = new PrometheusPushgateway({
      mode: 'mock',
      endpoint: createPushgatewayEndpoint('test', 'http://localhost:9091'),
      jobName: 'job',
      enabled: false,
    });
    await disabled.start();
    disabled.addMetric(createCounter('a', 1));
    const r = await disabled.push();
    expect(r.successCount).toBe(0);
  });
});
