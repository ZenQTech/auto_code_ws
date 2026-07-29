/**
 * ModelCostStats 单元测试 (v1.0.0 Cycle 21 G21-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelCostStatsCollector,
  getModelCostStats,
  resetModelCostStats,
  isModelCostStatsInitialized,
  type ModelRoute,
} from './modelCostStats';

function makeRoute(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    model: 'claude-sonnet-4.5',
    category: 'code_generation',
    complexity: 5,
    mode: 'balance',
    reason: 'Test',
    candidates: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ModelCostStatsCollector', () => {
  let collector: ModelCostStatsCollector;

  beforeEach(() => {
    resetModelCostStats();
    collector = getModelCostStats();
  });

  describe('单例', () => {
    it('返回相同实例', () => {
      const a = getModelCostStats();
      const b = getModelCostStats();
      expect(a).toBe(b);
    });

    it('isModelCostStatsInitialized', () => {
      expect(isModelCostStatsInitialized()).toBe(true);
    });
  });

  describe('recordRoute', () => {
    it('记录单次路由', () => {
      const record = collector.recordRoute({
        route: makeRoute(),
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.05,
        success: true,
      });
      expect(record.timestamp).toBeDefined();
    });

    it('使用当前时间如果未指定', () => {
      const before = Date.now();
      const record = collector.recordRoute({
        route: makeRoute(),
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.05,
        success: true,
      });
      expect(record.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getStats', () => {
    it('空统计', () => {
      const stats = collector.getStats();
      expect(stats.totalDecisions).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    it('聚合多个记录', () => {
      collector.recordRoute({ route: makeRoute({ model: 'claude-sonnet-4.5' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      collector.recordRoute({ route: makeRoute({ model: 'gpt-5' }), inputTokens: 2000, outputTokens: 1000, cost: 0.10, success: true });
      const stats = collector.getStats();
      expect(stats.totalDecisions).toBe(2);
      expect(stats.totalCost).toBeCloseTo(0.15, 5);
    });

    it('按模型聚合', () => {
      collector.recordRoute({ route: makeRoute({ model: 'claude-sonnet-4.5' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      collector.recordRoute({ route: makeRoute({ model: 'claude-sonnet-4.5' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const stats = collector.getStats();
      expect(stats.byModel['claude-sonnet-4.5']?.count).toBe(2);
    });

    it('按分类聚合', () => {
      collector.recordRoute({ route: makeRoute({ category: 'code_generation' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      collector.recordRoute({ route: makeRoute({ category: 'debugging' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const stats = collector.getStats();
      expect(stats.byCategory.code_generation?.count).toBe(1);
      expect(stats.byCategory.debugging?.count).toBe(1);
    });

    it('按模式聚合', () => {
      collector.recordRoute({ route: makeRoute({ mode: 'cost' }), inputTokens: 1000, outputTokens: 500, cost: 0.01, success: true });
      collector.recordRoute({ route: makeRoute({ mode: 'intelligence' }), inputTokens: 1000, outputTokens: 500, cost: 0.10, success: true });
      const stats = collector.getStats();
      expect(stats.byMode.cost.count).toBe(1);
      expect(stats.byMode.intelligence.count).toBe(1);
    });

    it('计算趋势', () => {
      // 早期记录
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 天前
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.01, success: true, timestamp: oldTime });
      // 最近记录
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.10, success: true });
      const stats = collector.getStats();
      expect(stats.costTrend).toBe('up');
    });

    it('计算 avgCostPerDecision', () => {
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.10, success: true });
      const stats = collector.getStats();
      expect(stats.avgCostPerDecision).toBeCloseTo(0.075, 5);
    });
  });

  describe('getDailyTrend', () => {
    it('返回每日趋势', () => {
      const today = Date.now();
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true, timestamp: today });
      const trend = collector.getDailyTrend(7);
      expect(Array.isArray(trend)).toBe(true);
    });
  });

  describe('getModelRanking', () => {
    it('按成本排序', () => {
      collector.recordRoute({ route: makeRoute({ model: 'claude-sonnet-4.5' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      collector.recordRoute({ route: makeRoute({ model: 'gpt-5' }), inputTokens: 1000, outputTokens: 500, cost: 0.20, success: true });
      const ranking = collector.getModelRanking();
      expect(ranking[0].model).toBe('gpt-5');
      expect(ranking[0].cost).toBeCloseTo(0.20, 5);
    });
  });

  describe('getRecords', () => {
    it('按过滤条件返回记录', () => {
      collector.recordRoute({ route: makeRoute({ model: 'claude-sonnet-4.5' }), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const records = collector.getRecords({ model: 'claude-sonnet-4.5' });
      expect(records.length).toBe(1);
    });

    it('限制数量', () => {
      for (let i = 0; i < 5; i++) {
        collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      }
      const records = collector.getRecords({}, 3);
      expect(records.length).toBe(3);
    });
  });

  describe('exportData', () => {
    it('导出 JSON', () => {
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const json = collector.exportData('json');
      expect(json).toContain('totalDecisions');
    });

    it('导出 CSV', () => {
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const csv = collector.exportData('csv');
      expect(csv).toContain('timestamp');
      expect(csv).toContain('model');
    });
  });

  describe('告警', () => {
    it('配置告警回调', () => {
      collector.setAlertConfig({
        perCallThreshold: 0.01,
        onAlert: () => {},
      });
      const config = collector.getAlertConfig();
      expect(config.perCallThreshold).toBe(0.01);
    });

    it('单次成本超阈值触发告警', () => {
      let alertFired = false;
      collector.setAlertConfig({
        perCallThreshold: 0.01,
        onAlert: () => { alertFired = true; },
      });
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      expect(alertFired).toBe(true);
    });
  });

  describe('clear', () => {
    it('清空所有记录', () => {
      collector.recordRoute({ route: makeRoute(), inputTokens: 1000, outputTokens: 500, cost: 0.05, success: true });
      const cleared = collector.clear();
      expect(cleared).toBeGreaterThan(0);
      expect(collector.getRecords().length).toBe(0);
    });
  });
});
