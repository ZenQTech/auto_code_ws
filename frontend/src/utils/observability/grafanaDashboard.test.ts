/**
 * # ============================================================
 * # Grafana/PromQL 单元测试 (Cycle 53 G53-02)
 * # ============================================================
 * # 核心作用：验证 PromQL 构建器和 Grafana 仪表盘生成器
 * # ====================================
 */

import { describe, it, expect } from 'vitest';
import { PromQLBuilder, PromQLTemplates } from './promql';
import {
  GrafanaDashboardBuilder,
  createApplicationMonitoringDashboard,
  createRAGSystemDashboard,
} from './grafanaDashboard';

describe('PromQLBuilder', () => {
  describe('基本操作', () => {
    it('应该构建简单指标查询', () => {
      const q = new PromQLBuilder().metric('up').toString();
      expect(q).toBe('up');
    });

    it('应该构建带标签的指标', () => {
      const q = new PromQLBuilder()
        .metric('http_requests_total', { service: 'api', status: '200' })
        .toString();
      expect(q).toBe('http_requests_total{service="api", status="200"}');
    });

    it('应该添加函数调用', () => {
      const q = new PromQLBuilder()
        .metric('http_requests_total')
        .fn('rate', '[5m]')
        .toString();
      expect(q).toBe('http_requests_total rate([5m])');
    });

    it('应该支持多个函数参数', () => {
      const q = new PromQLBuilder()
        .fn('histogram_quantile', '0.95', 'rate_value')
        .toString();
      expect(q).toBe('histogram_quantile(0.95, rate_value)');
    });

    it('应该支持算术运算', () => {
      const q = new PromQLBuilder()
        .metric('total')
        .op('/', 'count')
        .toString();
      expect(q).toBe('total / count');
    });

    it('应该支持 by 子句', () => {
      const q = new PromQLBuilder()
        .fn('sum', 'value')
        .by('service', 'status')
        .toString();
      expect(q).toBe('sum(value) by (service, status)');
    });

    it('应该支持 without 子句', () => {
      const q = new PromQLBuilder()
        .fn('sum', 'value')
        .without('instance')
        .toString();
      expect(q).toBe('sum(value) without (instance)');
    });

    it('应该支持 time range', () => {
      const q = new PromQLBuilder().metric('up').range('5m').toString();
      expect(q).toBe('up [5m]');
    });

    it('应该支持 topk', () => {
      const q = new PromQLBuilder().topk(5, 'value').toString();
      expect(q).toBe('topk(5, value)');
    });

    it('应该支持 bottomk', () => {
      const q = new PromQLBuilder().bottomk(3, 'value').toString();
      expect(q).toBe('bottomk(3, value)');
    });

    it('应该支持括号分组', () => {
      const q = new PromQLBuilder()
        .fn('sum', 'a')
        .paren()
        .op('+', 'b')
        .closeParen()
        .toString();
      expect(q).toBe('sum(a) ( + b )');
    });
  });

  describe('特殊字符处理', () => {
    it('应该转义标签值中的双引号', () => {
      const q = new PromQLBuilder()
        .metric('test', { name: 'say "hi"' })
        .toString();
      expect(q).toBe('test{name="say \\"hi\\""}');
    });

    it('应该转义标签值中的反斜杠', () => {
      const q = new PromQLBuilder()
        .metric('test', { path: 'C:\\path' })
        .toString();
      expect(q).toBe('test{path="C:\\\\path"}');
    });
  });

  describe('克隆和重置', () => {
    it('应该克隆构建器', () => {
      const b1 = new PromQLBuilder().metric('a');
      const b2 = b1.clone();
      b2.metric('b');
      expect(b1.toString()).toBe('a');
      expect(b2.toString()).toBe('a b');
    });

    it('应该重置构建器', () => {
      const b = new PromQLBuilder().metric('a').metric('b');
      b.reset();
      expect(b.toString()).toBe('');
    });
  });

  describe('模板', () => {
    it('httpRequestRate 模板', () => {
      const q = PromQLTemplates.httpRequestRate('api');
      expect(q).toContain('http_requests_total');
      expect(q).toContain('service="api"');
      expect(q).toContain('rate');
    });

    it('p95Latency 模板', () => {
      const q = PromQLTemplates.p95Latency('api');
      expect(q).toContain('histogram_quantile');
      expect(q).toContain('0.95');
    });

    it('qps 模板', () => {
      const q = PromQLTemplates.qps('api');
      expect(q).toContain('sum');
      expect(q).toContain('rate');
    });
  });
});

describe('GrafanaDashboardBuilder', () => {
  describe('基础', () => {
    it('应该创建空仪表盘', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      const json = d.toJSON();
      expect(json.title).toBe('Test');
      expect(json.panels).toEqual([]);
    });

    it('应该添加 Service 变量', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addServiceVariable();
      const json = d.toJSON();
      expect(json.templating.list).toHaveLength(1);
      expect(json.templating.list[0]!.name).toBe('service');
    });

    it('应该添加 Interval 变量', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addIntervalVariable();
      const json = d.toJSON();
      expect(json.templating.list.some((v) => v.name === 'interval')).toBe(true);
    });
  });

  describe('面板', () => {
    it('应该添加时间序列面板', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addTimeSeriesPanel({
        title: 'CPU',
        pos: { x: 0, y: 0, w: 12, h: 8 },
        queries: [{ refId: 'A', query: 'rate(cpu[5m])' }],
      });
      const json = d.toJSON();
      expect(json.panels).toHaveLength(1);
      expect(json.panels[0]!.type).toBe('timeseries');
      expect(json.panels[0]!.title).toBe('CPU');
    });

    it('应该添加 Stat 面板', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addStatPanel({
        title: 'QPS',
        pos: { x: 0, y: 0, w: 6, h: 4 },
        queries: [{ refId: 'A', query: 'rate(http_requests_total[1m])' }],
      });
      const json = d.toJSON();
      expect(json.panels[0]!.type).toBe('stat');
    });

    it('应该添加 Gauge 面板', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addGaugePanel({
        title: 'CPU',
        pos: { x: 0, y: 0, w: 6, h: 6 },
        queries: [{ refId: 'A', query: 'cpu_usage' }],
        min: 0,
        max: 100,
      });
      const json = d.toJSON();
      expect(json.panels[0]!.type).toBe('gauge');
    });

    it('应该添加 Table 面板', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addTablePanel({
        title: 'Top',
        pos: { x: 0, y: 0, w: 12, h: 8 },
        queries: [{ refId: 'A', query: 'topk(10, value)' }],
      });
      const json = d.toJSON();
      expect(json.panels[0]!.type).toBe('table');
    });

    it('应该添加 Heatmap 面板', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addHeatmapPanel({
        title: 'Latency',
        pos: { x: 0, y: 0, w: 12, h: 8 },
        queries: [{ refId: 'A', query: 'rate(latency_bucket[5m])' }],
      });
      const json = d.toJSON();
      expect(json.panels[0]!.type).toBe('heatmap');
    });

    it('应该为面板分配递增 ID', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addStatPanel({ title: 'A', pos: { x: 0, y: 0, w: 6, h: 4 }, queries: [] });
      d.addStatPanel({ title: 'B', pos: { x: 6, y: 0, w: 6, h: 4 }, queries: [] });
      const json = d.toJSON();
      expect(json.panels[0]!.id).toBe(1);
      expect(json.panels[1]!.id).toBe(2);
    });
  });

  describe('预设仪表盘', () => {
    it('createApplicationMonitoringDashboard 应创建完整仪表盘', () => {
      const d = createApplicationMonitoringDashboard('myapp');
      const json = d.toJSON();
      expect(json.title).toContain('myapp');
      expect(json.panels.length).toBeGreaterThan(5);
      expect(d.getPanelCount()).toBe(json.panels.length);
    });

    it('createRAGSystemDashboard 应包含 RAG 指标', () => {
      const d = createRAGSystemDashboard();
      const json = d.toJSON();
      expect(json.title).toContain('RAG');
      // 检查是否有 RAG 相关的 PromQL
      const allQueries = json.panels.flatMap((p) => p.targets.map((t) => t.query));
      expect(allQueries.some((q) => q.includes('rag_vector_search'))).toBe(true);
    });
  });

  describe('元数据', () => {
    it('应该添加链接', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.addLink('Logs', '/logs', 'link');
      const json = d.toJSON();
      expect(json.links).toHaveLength(1);
      expect(json.links[0]!.title).toBe('Logs');
    });

    it('应该设置 Tags', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.setTags(['test', 'demo']);
      const json = d.toJSON();
      expect(json.tags).toEqual(['test', 'demo']);
    });

    it('应该设置刷新间隔', () => {
      const d = new GrafanaDashboardBuilder({ title: 'Test' });
      d.setRefreshInterval('10s');
      const json = d.toJSON();
      expect(json.refresh).toBe('10s');
    });
  });

  it('toString 应返回有效 JSON', () => {
    const d = new GrafanaDashboardBuilder({ title: 'Test' });
    d.addStatPanel({ title: 'A', pos: { x: 0, y: 0, w: 6, h: 4 }, queries: [{ refId: 'A', query: 'up' }] });
    const str = d.toString();
    expect(() => JSON.parse(str)).not.toThrow();
  });
});
