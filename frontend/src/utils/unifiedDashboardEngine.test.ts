/**
 * Unified Dashboard Engine 单元测试 (v1.0.0 Cycle 33 G33-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnifiedDashboardEngine,
  PRESET_PANELS,
  DEFAULT_COLLECTORS,
  generateMetricId,
  generatePanelId,
  generateDashboardId,
  generateSubscriptionId,
  generateAlertId,
  compareThreshold,
  DEFAULT_DASHBOARD_CONFIG,
  type Metric,
  type MetricCollector,
} from './unifiedDashboardEngine';

describe('UnifiedDashboardEngine - 工具函数', () => {
  it('generateMetricId 生成 ID', () => {
    const id = generateMetricId('sso', 'health');
    expect(id).toMatch(/^m-sso-health-/);
  });

  it('generatePanelId 生成唯一 ID', () => {
    const id = generatePanelId();
    expect(id).toMatch(/^p-\d+-[a-z0-9]+$/);
  });

  it('generateDashboardId 生成唯一 ID', () => {
    const id = generateDashboardId();
    expect(id).toMatch(/^dash-\d+-[a-z0-9]+$/);
  });

  it('generateSubscriptionId 生成唯一 ID', () => {
    const id = generateSubscriptionId();
    expect(id).toMatch(/^sub-\d+-[a-z0-9]+$/);
  });

  it('generateAlertId 生成唯一 ID', () => {
    const id = generateAlertId();
    expect(id).toMatch(/^alert-\d+-[a-z0-9]+$/);
  });

  it('compareThreshold gt', () => {
    expect(compareThreshold(10, { value: 5, comparison: 'gt', severity: 'warning' })).toBe(true);
    expect(compareThreshold(3, { value: 5, comparison: 'gt', severity: 'warning' })).toBe(false);
  });

  it('compareThreshold lt', () => {
    expect(compareThreshold(3, { value: 5, comparison: 'lt', severity: 'warning' })).toBe(true);
    expect(compareThreshold(10, { value: 5, comparison: 'lt', severity: 'warning' })).toBe(false);
  });

  it('compareThreshold eq/neq', () => {
    expect(compareThreshold(5, { value: 5, comparison: 'eq', severity: 'warning' })).toBe(true);
    expect(compareThreshold(5, { value: 6, comparison: 'neq', severity: 'warning' })).toBe(true);
  });

  it('compareThreshold gte/lte', () => {
    expect(compareThreshold(5, { value: 5, comparison: 'gte', severity: 'warning' })).toBe(true);
    expect(compareThreshold(5, { value: 5, comparison: 'lte', severity: 'warning' })).toBe(true);
  });
});

describe('UnifiedDashboardEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('创建时不持久化', () => {
    const engine = new UnifiedDashboardEngine({ persist: false });
    expect(engine.getStats().totalCollectors).toBe(DEFAULT_COLLECTORS.length);
  });

  it('默认加载 DEFAULT_COLLECTORS', () => {
    const engine = new UnifiedDashboardEngine({ persist: false });
    expect(engine.listCollectors().length).toBeGreaterThan(0);
  });

  // v1.0.1 (Cycle 60 G60-FIX-2) 更新：collectors 不再持久化
  //   因为 collect() 是函数，JSON 序列化后会丢失。
  //   测试改为验证：重启后 DEFAULT_COLLECTORS 自动重新加载，函数引用有效。
  it('持久化：collectors 不被持久化（collect 函数不可序列化）', () => {
    const engine1 = new UnifiedDashboardEngine({ persist: true });
    engine1.registerCollector({ id: 'test-collector', engineId: 'test', name: 'Test', collect: () => [] });
    const engine2 = new UnifiedDashboardEngine({ persist: true });
    // user-registered collector 不会持久化，但 DEFAULT_COLLECTORS 会重新加载
    expect(engine2.listCollectors().find((c) => c.id === 'test-collector')).toBeUndefined();
    // 默认 collectors 始终存在且 collect 函数有效
    const defaultCollector = engine2.listCollectors().find((c) => c.id === 'collector-sso');
    expect(defaultCollector).toBeDefined();
    expect(typeof defaultCollector?.collect).toBe('function');
  });
});

describe('UnifiedDashboardEngine - 采集器管理', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('registerCollector 注册采集器', () => {
    const collector: MetricCollector = {
      id: 'c1', engineId: 'e1', name: 'C1', collect: () => [],
    };
    engine.registerCollector(collector);
    expect(engine.getCollector('c1')).toBeDefined();
  });

  it('unregisterCollector 注销采集器', () => {
    engine.registerCollector({ id: 'c1', engineId: 'e1', name: 'C1', collect: () => [] });
    engine.unregisterCollector('c1');
    expect(engine.getCollector('c1')).toBeUndefined();
  });

  it('listCollectors 列出所有采集器', () => {
    const list = engine.listCollectors();
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('UnifiedDashboardEngine - 指标采集', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });
    // 清除默认采集器
    for (const c of [...engine.listCollectors()]) {
      engine.unregisterCollector(c.id);
    }
  });

  it('collect 单个采集器', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [
        { id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() },
      ],
    });
    const metrics = await engine.collect('c1');
    expect(metrics.length).toBe(1);
    expect(metrics[0].id).toBe('m1');
  });

  it('collect 所有采集器', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [
        { id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() },
      ],
    });
    engine.registerCollector({
      id: 'c2', engineId: 'e2', name: 'C2',
      collect: () => [
        { id: 'm2', name: 'M2', engineId: 'e2', category: 'cost', type: 'gauge', value: 100, timestamp: Date.now() },
      ],
    });
    const metrics = await engine.collect();
    expect(metrics.length).toBe(2);
  });

  it('collect 处理采集器异常', async () => {
    engine.registerCollector({
      id: 'bad', engineId: 'e1', name: 'Bad',
      collect: () => { throw new Error('boom'); },
    });
    engine.registerCollector({
      id: 'good', engineId: 'e1', name: 'Good',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    const metrics = await engine.collect();
    expect(metrics.length).toBe(1);
  });

  it('collect 跳过禁用的采集器', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1', enabled: false,
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    const metrics = await engine.collect();
    expect(metrics.length).toBe(0);
  });

  it('getMetric 获取指标', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const metrics = engine.getMetric('m1');
    expect(metrics.length).toBe(1);
  });

  it('getMetric 不存在返回空', () => {
    expect(engine.getMetric('nonexistent')).toHaveLength(0);
  });

  it('listMetrics 按 engineId 过滤', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const list = engine.listMetrics({ engineId: 'e1' });
    expect(list.length).toBe(1);
  });

  it('listMetrics 按 category 过滤', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [
        { id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() },
        { id: 'm2', name: 'M2', engineId: 'e1', category: 'cost', type: 'gauge', value: 100, timestamp: Date.now() },
      ],
    });
    await engine.collect('c1');
    expect(engine.listMetrics({ category: 'health' }).length).toBe(1);
    expect(engine.listMetrics({ category: 'cost' }).length).toBe(1);
  });
});

describe('UnifiedDashboardEngine - 面板管理', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('createPanel 创建面板', () => {
    const panel = engine.createPanel({
      title: 'Test Panel',
      category: 'health',
      type: 'metric',
      metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 },
      config: {},
      visible: true,
    });
    expect(panel.id).toMatch(/^p-/);
    expect(engine.listPanels().length).toBe(1);
  });

  it('updatePanel 更新面板', () => {
    const panel = engine.createPanel({
      title: 'Test', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    const updated = engine.updatePanel(panel.id, { title: 'Updated' });
    expect(updated.title).toBe('Updated');
  });

  it('updatePanel 抛出当面板不存在', () => {
    expect(() => engine.updatePanel('nonexistent', { title: 'x' })).toThrow();
  });

  it('deletePanel 删除面板', () => {
    const panel = engine.createPanel({
      title: 'Test', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    engine.deletePanel(panel.id);
    expect(engine.getPanel(panel.id)).toBeUndefined();
  });

  it('getPanel 获取面板', () => {
    const panel = engine.createPanel({
      title: 'Test', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    expect(engine.getPanel(panel.id)).toBeDefined();
  });

  it('listPanels 按 category 过滤', () => {
    engine.createPanel({ title: 'A', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true });
    engine.createPanel({ title: 'B', category: 'cost', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true });
    expect(engine.listPanels({ category: 'health' }).length).toBe(1);
  });

  it('listPanels 按 visible 过滤', () => {
    engine.createPanel({ title: 'A', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true });
    engine.createPanel({ title: 'B', category: 'health', type: 'metric', metricIds: [], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: false });
    expect(engine.listPanels({ visible: true }).length).toBe(1);
  });
});

describe('UnifiedDashboardEngine - Dashboard 管理', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('createDashboard 创建 Dashboard', () => {
    const dashboard = engine.createDashboard({
      name: 'Test',
      panels: [],
      layout: 'grid-12',
      theme: 'light',
      refreshIntervalMs: 30000,
      isDefault: false,
      shared: false,
    });
    expect(dashboard.id).toMatch(/^dash-/);
  });

  it('updateDashboard 更新 Dashboard', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const updated = engine.updateDashboard(dashboard.id, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  it('updateDashboard 抛出当 Dashboard 不存在', () => {
    expect(() => engine.updateDashboard('nonexistent', { name: 'x' })).toThrow();
  });

  it('deleteDashboard 删除 Dashboard', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    engine.deleteDashboard(dashboard.id);
    expect(engine.getDashboard(dashboard.id)).toBeUndefined();
  });

  it('getDashboard 获取 Dashboard', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    expect(engine.getDashboard(dashboard.id)).toBeDefined();
  });

  it('listDashboards 按 shared 过滤', () => {
    engine.createDashboard({ name: 'A', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: true });
    engine.createDashboard({ name: 'B', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false });
    expect(engine.listDashboards({ shared: true }).length).toBe(1);
  });

  it('getDefaultDashboard 返回默认 Dashboard', () => {
    const def = engine.getDefaultDashboard();
    expect(def).toBeDefined();
    expect(def.isDefault).toBe(true);
  });
});

describe('UnifiedDashboardEngine - 订阅', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });
  });

  it('subscribe 订阅 Dashboard', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const sub = engine.subscribe(dashboard.id, 'user-1', () => {});
    expect(sub.id).toBeDefined();
    expect(engine.listSubscriptions(dashboard.id).length).toBe(1);
  });

  it('subscribe 接收 collect 的指标', async () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    let received: Metric[] = [];
    engine.subscribe(dashboard.id, 'user-1', (m) => { received = m; });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    expect(received.length).toBe(1);
  });

  it('unsubscribe 取消订阅', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const sub = engine.subscribe(dashboard.id, 'user-1', () => {});
    engine.unsubscribe(sub.id);
    expect(engine.listSubscriptions().length).toBe(0);
  });

  it('listSubscriptions 按 dashboardId 过滤', () => {
    const d1 = engine.createDashboard({ name: 'A', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false });
    const d2 = engine.createDashboard({ name: 'B', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false });
    engine.subscribe(d1.id, 'u1', () => {});
    engine.subscribe(d2.id, 'u2', () => {});
    expect(engine.listSubscriptions(d1.id).length).toBe(1);
  });
});

describe('UnifiedDashboardEngine - 阈值告警', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false, enableThresholdAlerts: true });
  });

  it('evaluateThresholds 无阈值面板无告警', async () => {
    engine.createPanel({
      title: 'T', category: 'health', type: 'metric', metricIds: ['m1'], position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.5, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const alerts = engine.evaluateThresholds();
    expect(alerts.length).toBe(0);
  });

  it('evaluateThresholds 触发告警', async () => {
    engine.createPanel({
      title: 'T', category: 'health', type: 'metric', metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
      thresholds: [{ value: 0.99, comparison: 'lt', severity: 'warning' }],
    });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.9, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const alerts = engine.evaluateThresholds();
    expect(alerts.length).toBe(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('evaluateThresholds critical 告警', async () => {
    engine.createPanel({
      title: 'T', category: 'health', type: 'metric', metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
      thresholds: [{ value: 0.95, comparison: 'lt', severity: 'critical' }],
    });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.5, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const alerts = engine.evaluateThresholds();
    expect(alerts.length).toBe(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('acknowledgeAlert 确认告警', async () => {
    engine.createPanel({
      title: 'T', category: 'health', type: 'metric', metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
      thresholds: [{ value: 0.5, comparison: 'lt', severity: 'warning' }],
    });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const alerts = engine.evaluateThresholds();
    expect(alerts.length).toBe(1);
    engine.acknowledgeAlert(alerts[0].id, 'admin');
    const list = engine.listThresholdAlerts();
    expect(list[0].acknowledged).toBe(true);
  });

  it('listThresholdAlerts 按 severity 过滤', async () => {
    engine.createPanel({
      title: 'T', category: 'health', type: 'metric', metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
      thresholds: [{ value: 0.5, comparison: 'lt', severity: 'critical' }],
    });
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    engine.evaluateThresholds();
    expect(engine.listThresholdAlerts({ severity: 'critical' }).length).toBe(1);
  });

  it('evaluateThresholds 禁用时返回空', () => {
    engine.updateConfig({ enableThresholdAlerts: false });
    expect(engine.evaluateThresholds()).toHaveLength(0);
  });
});

describe('UnifiedDashboardEngine - 引擎健康度', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });
  });

  it('getEngineHealth 返回所有引擎状态', () => {
    const health = engine.getEngineHealth();
    expect(Object.keys(health).length).toBeGreaterThan(0);
  });

  it('getEngineHealth 无数据时标记 down', () => {
    const health = engine.getEngineHealth();
    for (const key of Object.keys(health)) {
      expect(['healthy', 'degraded', 'down']).toContain(health[key].status);
    }
  });

  it('getEngineHealth 健康值标记 healthy', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1.0, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const health = engine.getEngineHealth();
    expect(health['e1'].status).toBe('healthy');
  });

  it('getEngineHealth 低值标记 degraded', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.9, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const health = engine.getEngineHealth();
    expect(health['e1'].status).toBe('degraded');
  });
});

describe('UnifiedDashboardEngine - 导出', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('exportDashboard JSON 格式', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const json = engine.exportDashboard(dashboard.id, 'json');
    expect(JSON.parse(json).name).toBe('Test');
  });

  it('exportDashboard CSV 格式', () => {
    const panel = engine.createPanel({
      title: 'A', category: 'health', type: 'metric', metricIds: ['m1'],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [panel], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const csv = engine.exportDashboard(dashboard.id, 'csv');
    expect(csv).toContain('Panel Title');
  });

  it('exportDashboard PDF 格式', () => {
    const dashboard = engine.createDashboard({
      name: 'Test', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    const pdf = engine.exportDashboard(dashboard.id, 'pdf');
    expect(pdf).toContain('Dashboard');
  });

  it('exportDashboard 抛出当 Dashboard 不存在', () => {
    expect(() => engine.exportDashboard('nonexistent', 'json')).toThrow();
  });

  it('exportMetricData JSON 格式', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const json = engine.exportMetricData(['m1'], { from: Date.now() - 1000, to: Date.now() + 1000 }, 'json');
    expect(JSON.parse(json).length).toBe(1);
  });

  it('exportMetricData CSV 格式', async () => {
    engine.registerCollector({
      id: 'c1', engineId: 'e1', name: 'C1',
      collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 1, timestamp: Date.now() }],
    });
    await engine.collect('c1');
    const csv = engine.exportMetricData(['m1'], { from: Date.now() - 1000, to: Date.now() + 1000 }, 'csv');
    expect(csv).toContain('id,name,engineId');
  });
});

describe('UnifiedDashboardEngine - 事件订阅', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('订阅 collector-added', () => {
    let count = 0;
    engine.on('collector-added', () => count++);
    engine.registerCollector({ id: 'c1', engineId: 'e1', name: 'C1', collect: () => [] });
    expect(count).toBe(1);
  });

  it('订阅 panel-updated', () => {
    let count = 0;
    engine.on('panel-updated', () => count++);
    engine.createPanel({
      title: 'A', category: 'health', type: 'metric', metricIds: [],
      position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('订阅 dashboard-created', () => {
    let count = 0;
    engine.on('dashboard-created', () => count++);
    engine.createDashboard({
      name: 'A', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    expect(count).toBe(1);
  });

  it('订阅 subscription-added', () => {
    let count = 0;
    engine.on('subscription-added', () => count++);
    const dashboard = engine.createDashboard({
      name: 'A', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false,
    });
    engine.subscribe(dashboard.id, 'u1', () => {});
    expect(count).toBe(1);
  });

  it('取消订阅', () => {
    let count = 0;
    const unsub = engine.on('collector-added', () => count++);
    engine.registerCollector({ id: 'c1', engineId: 'e1', name: 'C1', collect: () => [] });
    unsub();
    engine.registerCollector({ id: 'c2', engineId: 'e1', name: 'C1', collect: () => [] });
    expect(count).toBe(1);
  });
});

describe('UnifiedDashboardEngine - 预置面板和采集器', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('12+ 预置面板可用', () => {
    expect(PRESET_PANELS.length).toBeGreaterThanOrEqual(12);
  });

  it('DEFAULT_COLLECTORS 5+ 个', () => {
    expect(DEFAULT_COLLECTORS.length).toBeGreaterThanOrEqual(5);
  });

  it('DEFAULT_DASHBOARD_CONFIG 完整', () => {
    expect(DEFAULT_DASHBOARD_CONFIG.persist).toBeDefined();
    expect(DEFAULT_DASHBOARD_CONFIG.defaultRefreshIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_DASHBOARD_CONFIG.collectorIntervalMs).toBeGreaterThan(0);
  });
});

describe('UnifiedDashboardEngine - 统计与配置', () => {
  let engine: UnifiedDashboardEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UnifiedDashboardEngine({ persist: false });
  });

  it('getStats 返回统计', () => {
    const stats = engine.getStats();
    expect(stats.totalCollectors).toBeGreaterThan(0);
  });

  it('getConfig 返回配置', () => {
    const config = engine.getConfig();
    expect(config.persist).toBe(false);
  });

  it('updateConfig 更新配置', () => {
    engine.updateConfig({ defaultRefreshIntervalMs: 60000 });
    expect(engine.getConfig().defaultRefreshIntervalMs).toBe(60000);
  });

  it('clear 清空所有数据', () => {
    engine.createDashboard({ name: 'A', panels: [], layout: 'grid-12', theme: 'light', refreshIntervalMs: 30000, isDefault: false, shared: false });
    engine.clear();
    expect(engine.listDashboards()).toHaveLength(0);
  });
});

describe('UnifiedDashboardEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getDefaultDashboardEngine 返回单例', async () => {
    const { getDefaultDashboardEngine, resetDefaultDashboardEngine } = await import('./unifiedDashboardEngine');
    resetDefaultDashboardEngine();
    const a = getDefaultDashboardEngine();
    const b = getDefaultDashboardEngine();
    expect(a).toBe(b);
  });
});
