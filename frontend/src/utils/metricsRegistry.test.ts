/**
 * # ============================================================
 * # MetricsRegistry 单元测试 (Cycle 50 G50-03)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsRegistry, createMetricsRegistry, getMetricsRegistry, resetMetricsRegistry, type MetricsEvent } from './metricsRegistry';

describe('MetricsRegistry - Counter', () => {
  it('应能创建和增加 Counter', () => {
    const r = createMetricsRegistry();
    const c = r.createCounter('test_counter', 'Test counter');
    r.inc('test_counter');
    r.inc('test_counter');
    r.inc('test_counter', {}, 3);
    expect((c.values.values().next().value as { value: number } | undefined)?.value).toBe(5);
  });

  it('Counter 应支持标签', () => {
    const r = createMetricsRegistry();
    r.createCounter('http_requests', 'HTTP requests', { labelNames: ['method', 'status'] });
    r.inc('http_requests', { method: 'GET', status: '200' });
    r.inc('http_requests', { method: 'POST', status: '500' });
    r.inc('http_requests', { method: 'GET', status: '200' });
    const m = r.getMetric('http_requests');
    expect(m?.values.size).toBe(2);
  });

  it('应拒绝非 Counter', () => {
    const r = createMetricsRegistry();
    expect(() => r.inc('nonexistent')).toThrow('not found');
  });
});

describe('MetricsRegistry - Gauge', () => {
  it('应能创建和设置 Gauge', () => {
    const r = createMetricsRegistry();
    r.createGauge('temperature', 'CPU temperature');
    r.set('temperature', 45.5);
    r.set('temperature', 50.0);
    const m = r.getMetric('temperature');
    const v = m?.values.values().next().value as { value: number } | undefined;
    expect(v?.value).toBe(50.0);
  });

  it('Gauge 应支持标签', () => {
    const r = createMetricsRegistry();
    r.createGauge('memory_used', 'Memory used', { labelNames: ['host'] });
    r.set('memory_used', 1024, { host: 'server1' });
    r.set('memory_used', 2048, { host: 'server2' });
    expect(r.getMetric('memory_used')?.values.size).toBe(2);
  });

  it('应拒绝非 Gauge', () => {
    const r = createMetricsRegistry();
    r.createCounter('test_c', 'test');
    expect(() => r.set('test_c', 1)).toThrow('Gauge');
  });
});

describe('MetricsRegistry - Histogram', () => {
  it('应能观察值', () => {
    const r = createMetricsRegistry();
    r.createHistogram('latency', 'Request latency', { buckets: [0.1, 0.5, 1, 5] });
    r.observe('latency', 0.05);
    r.observe('latency', 0.3);
    r.observe('latency', 0.7);
    r.observe('latency', 3.0);
    const m = r.getMetric('latency');
    const v = m?.values.values().next().value as { count: number; sum: number; bucketCounts: number[] } | undefined;
    expect(v?.count).toBe(4);
    expect(v?.sum).toBe(4.05);
  });

  it('应正确分桶', () => {
    const r = createMetricsRegistry();
    r.createHistogram('h', 'test', { buckets: [1, 5, 10] });
    r.observe('h', 0.5); // bucket 0 (le=1)
    r.observe('h', 3); // bucket 1 (le=5)
    r.observe('h', 7); // bucket 2 (le=10)
    r.observe('h', 20); // +Inf
    const m = r.getMetric('h');
    const v = m?.values.values().next().value as { bucketCounts: number[] } | undefined;
    expect(v?.bucketCounts).toEqual([1, 2, 3, 4]); // 各 bucket 累计
  });

  it('Histogram 应支持标签', () => {
    const r = createMetricsRegistry();
    r.createHistogram('h2', 'test', { labelNames: ['endpoint'] });
    r.observe('h2', 0.1, { endpoint: '/a' });
    r.observe('h2', 0.2, { endpoint: '/a' });
    r.observe('h2', 0.3, { endpoint: '/b' });
    expect(r.getMetric('h2')?.values.size).toBe(2);
  });
});

describe('MetricsRegistry - Summary', () => {
  it('应能观察值', () => {
    const r = createMetricsRegistry();
    r.createSummary('req_duration', 'Request duration');
    r.observeSummary('req_duration', 0.1);
    r.observeSummary('req_duration', 0.5);
    r.observeSummary('req_duration', 1.0);
    const m = r.getMetric('req_duration');
    const v = m?.values.values().next().value as { count: number; sum: number } | undefined;
    expect(v?.count).toBe(3);
    expect(v?.sum).toBeCloseTo(1.6, 1);
  });
});

describe('MetricsRegistry - 导出', () => {
  it('应能导出 Prometheus 格式', () => {
    const r = createMetricsRegistry();
    r.createCounter('test_c', 'Test counter');
    r.inc('test_c', {}, 5);
    const text = r.exportPrometheus();
    expect(text).toContain('# HELP test_c Test counter');
    expect(text).toContain('# TYPE test_c counter');
    expect(text).toContain('test_c 5');
  });

  it('Prometheus 导出应包含直方图', () => {
    const r = createMetricsRegistry();
    r.createHistogram('h3', 'h3 help', { buckets: [1, 5] });
    r.observe('h3', 2);
    r.observe('h3', 6);
    const text = r.exportPrometheus();
    expect(text).toContain('h3_bucket');
    expect(text).toContain('le="1"');
    expect(text).toContain('le="5"');
    expect(text).toContain('le="+Inf"');
    expect(text).toContain('h3_sum');
    expect(text).toContain('h3_count');
  });

  it('Prometheus 导出应包含 Summary', () => {
    const r = createMetricsRegistry();
    r.createSummary('s1', 's1 help', { quantiles: [0.5, 0.9] });
    r.observeSummary('s1', 1.0);
    const text = r.exportPrometheus();
    expect(text).toContain('s1_sum');
    expect(text).toContain('s1_count');
    expect(text).toContain('quantile="0.5"');
  });

  it('应能导出 JSON', () => {
    const r = createMetricsRegistry();
    r.createCounter('jc', 'json counter');
    r.inc('jc', {}, 10);
    const json = r.exportJson();
    expect(json.jc).toBeTruthy();
  });
});

describe('MetricsRegistry - 前缀', () => {
  it('应自动添加前缀', () => {
    const r = new MetricsRegistry({ prefix: 'mcp' });
    r.createCounter('api_calls', 'API calls');
    expect(r.listMetrics()).toContain('mcp_api_calls');
  });

  it('已有前缀不应重复添加', () => {
    const r = new MetricsRegistry({ prefix: 'mcp' });
    r.createCounter('mcp_api_calls', 'API calls');
    expect(r.listMetrics()).toContain('mcp_api_calls');
    expect(r.listMetrics().filter((n) => n === 'mcp_api_calls')).toHaveLength(1);
  });
});

describe('MetricsRegistry - 管理', () => {
  it('应能列出所有指标', () => {
    const r = createMetricsRegistry();
    r.createCounter('c1', 'c1');
    r.createGauge('g1', 'g1');
    r.createHistogram('h1', 'h1');
    const list = r.listMetrics();
    expect(list.length).toBe(3);
  });

  it('重复创建同名指标应返回已存在的', () => {
    const r = createMetricsRegistry();
    const c1 = r.createCounter('dup', 'dup');
    const c2 = r.createCounter('dup', 'dup');
    expect(c1).toBe(c2);
  });

  it('reset 应清空所有值', () => {
    const r = createMetricsRegistry();
    r.createCounter('rc', 'rc');
    r.inc('rc', {}, 100);
    r.reset();
    const m = r.getMetric('rc');
    expect(m?.values.size).toBe(0);
  });

  it('reset 后重新 inc 应从 0 开始', () => {
    const r = createMetricsRegistry();
    r.createCounter('rc2', 'rc2');
    r.inc('rc2', {}, 100);
    r.reset();
    r.inc('rc2', {}, 5);
    const m = r.getMetric('rc2');
    const v = m?.values.values().next().value as { value: number } | undefined;
    expect(v?.value).toBe(5);
  });
});

describe('MetricsRegistry - 事件订阅', () => {
  it('应触发 register 事件', () => {
    const r = createMetricsRegistry();
    const events: MetricsEvent[] = [];
    r.subscribe((e) => events.push(e));
    r.createCounter('ec', 'ec');
    expect(events.some((e) => e.type === 'register')).toBe(true);
  });

  it('应触发 observe 事件', () => {
    const r = createMetricsRegistry();
    r.createCounter('ec2', 'ec2');
    const events: MetricsEvent[] = [];
    r.subscribe((e) => events.push(e));
    r.inc('ec2');
    expect(events.some((e) => e.type === 'observe')).toBe(true);
  });
});

describe('MetricsRegistry - 默认注册表', () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it('getMetricsRegistry 应返回预注册核心指标', () => {
    const r = getMetricsRegistry();
    expect(r.getMetric('volcengine_api_requests_total')).toBeTruthy();
    expect(r.getMetric('multimodal_embeddings_total')).toBeTruthy();
    expect(r.getMetric('multimodal_searches_total')).toBeTruthy();
  });

  it('resetMetricsRegistry 应清空', () => {
    getMetricsRegistry();
    resetMetricsRegistry();
    const r = getMetricsRegistry();
    expect(r.listMetrics().length).toBeGreaterThan(0);
  });
});

describe('MetricsRegistry - 标签值转义', () => {
  it('应转义特殊字符', () => {
    const r = createMetricsRegistry();
    r.createCounter('esc', 'esc', { labelNames: ['msg'] });
    r.inc('esc', { msg: 'hello "world"\nfoo\\bar' });
    const text = r.exportPrometheus();
    expect(text).toContain('\\"world\\"');
    expect(text).toContain('\\n');
  });
});
