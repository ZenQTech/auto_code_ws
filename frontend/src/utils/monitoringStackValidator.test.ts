/**
 * # ============================================================
 * # MonitoringStackValidator 测试
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MonitoringStackValidator,
  createMonitoringStackValidator,
  exportMonitoringReportMarkdown,
  type PrometheusTarget,
} from './monitoringStackValidator';

function createMockFetch(responses: Map<string, { status: number; body: string }>): typeof fetch {
  return vi.fn(async (url: string | URL | Request): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, r] of responses) {
      if (urlStr.includes(pattern)) {
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('MonitoringStackValidator', () => {
  describe('基础功能', () => {
    it('应该创建实例', () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map()),
      });
      expect(validator).toBeInstanceOf(MonitoringStackValidator);
    });

    it('缺少 prometheusUrl 应该抛错', () => {
      expect(() => createMonitoringStackValidator({ prometheusUrl: '' })).toThrow();
    });
  });

  describe('Prometheus 检查', () => {
    it('Prometheus 不可用时应该返回错误', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 503, body: 'down' }],
        ])),
      });
      const report = await validator.validate();
      expect(report.prometheus.available).toBe(false);
      expect(report.prometheus.error).toBeDefined();
    });

    it('Prometheus 可用时应该返回版本和目标', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        expectedTargets: ['backend:8000'],
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({
            data: { activeTargets: [
              { labels: { job: 'backend', instance: 'backend:8000' }, health: 'up' },
              { labels: { job: 'frontend', instance: 'frontend:8080' }, health: 'down', lastError: 'connection refused' },
            ] }
          }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: { http_requests_total: { type: 'counter' } } }) }],
        ])),
      });
      const report = await validator.validate();
      expect(report.prometheus.available).toBe(true);
      expect(report.prometheus.version).toBe('2.50.0');
      expect(report.prometheus.activeTargets).toBe(1);
      expect(report.prometheus.totalTargets).toBe(2);
      expect(report.prometheus.targets.some((t) => t.health === 'down')).toBe(true);
    });

    it('应该报告缺失的指标', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        expectedMetrics: ['http_requests_total', 'missing_metric'],
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: { http_requests_total: { type: 'counter' } } }) }],
        ])),
      });
      const report = await validator.validate();
      const found = report.prometheus.expectedMetrics.find((m) => m.name === 'http_requests_total');
      const missing = report.prometheus.expectedMetrics.find((m) => m.name === 'missing_metric');
      expect(found?.found).toBe(true);
      expect(missing?.found).toBe(false);
    });
  });

  describe('Grafana 检查', () => {
    it('Grafana 不可用时应该返回错误', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        grafanaUrl: 'http://localhost:3000',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
          ['/api/health', { status: 500, body: 'down' }],
        ])),
      });
      const report = await validator.validate();
      expect(report.grafana.available).toBe(false);
    });

    it('Grafana 配置了 Prometheus 数据源时应该报告', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        grafanaUrl: 'http://localhost:3000',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
          ['/api/health', { status: 200, body: '{"database":"ok"}' }],
          ['/api/datasources', { status: 200, body: JSON.stringify([
            { id: 1, name: 'Prometheus', type: 'prometheus', url: 'http://prometheus:9090', isDefault: true, access: 'proxy' },
          ]) }],
        ])),
      });
      const report = await validator.validate();
      expect(report.grafana.available).toBe(true);
      expect(report.grafana.prometheusDatasourceFound).toBe(true);
      expect(report.grafana.dataSources.length).toBe(1);
    });

    it('未配置 Grafana URL 时应该跳过', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
        ])),
      });
      const report = await validator.validate();
      expect(report.grafana.error).toBe('Grafana URL not configured');
    });
  });

  describe('报告', () => {
    it('summary 应该在所有组件可用时显示 MONITORING OK', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [
            { labels: { job: 'backend', instance: 'backend:8000' }, health: 'up' },
          ] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
        ])),
      });
      const report = await validator.validate();
      expect(report.summary).toContain('MONITORING OK');
    });

    it('recommendations 应该为 down 目标生成建议', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [
            { labels: { job: 'backend', instance: 'backend:8000' }, health: 'down', lastError: 'connection refused' },
          ] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
        ])),
      });
      const report = await validator.validate();
      expect(report.recommendations.some((r) => r.includes('down'))).toBe(true);
    });

    it('导出 Markdown 应该包含所有信息', async () => {
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
        ])),
      });
      const report = await validator.validate();
      const md = exportMonitoringReportMarkdown(report);
      expect(md).toContain('监控栈验证报告');
      expect(md).toContain('Prometheus');
    });
  });

  describe('事件订阅', () => {
    it('应该触发 start 和 complete 事件', async () => {
      const events: string[] = [];
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl: createMockFetch(new Map([
          ['/-/healthy', { status: 200, body: 'ok' }],
          ['/runtimeinfo', { status: 200, body: JSON.stringify({ data: { version: '2.50.0' } }) }],
          ['/api/v1/targets', { status: 200, body: JSON.stringify({ data: { activeTargets: [] } }) }],
          ['/api/v1/metadata', { status: 200, body: JSON.stringify({ data: {} }) }],
        ])),
      });
      validator.subscribe((e) => events.push(e.type));
      await validator.validate();
      expect(events).toContain('start');
      expect(events).toContain('complete');
    });
  });

  describe('URL 处理', () => {
    it('应该处理尾部斜杠', async () => {
      let calledUrl = '';
      const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
        calledUrl = typeof url === 'string' ? url : url.toString();
        return new Response('Not Found', { status: 404 });
      }) as unknown as typeof fetch;
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090/',
        fetchImpl,
      });
      await validator.validate();
      expect(calledUrl).toBe('http://localhost:9090/-/healthy');
    });
  });

  describe('错误处理', () => {
    it('fetch 抛错应该捕获', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        throw new Error('Connection refused');
      }) as unknown as typeof fetch;
      const validator = createMonitoringStackValidator({
        prometheusUrl: 'http://localhost:9090',
        fetchImpl,
      });
      const report = await validator.validate();
      expect(report.prometheus.available).toBe(false);
      expect(report.prometheus.error).toContain('Connection refused');
    });
  });
});
