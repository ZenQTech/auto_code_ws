/**
 * CostBudgetEngine 单元测试 (v1.0.0 Cycle 28 G28-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostBudgetEngine,
  getDefaultCostBudgetEngine,
  resetDefaultCostBudgetEngine,
  calculateCost,
  isValidBudgetLevel,
  getNextDayReset,
  DEFAULT_MODEL_SPEC,
} from './costBudgetEngine';

describe('CostBudgetEngine', () => {
  let engine: CostBudgetEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new CostBudgetEngine();
  });

  describe('初始化', () => {
    it('注册默认模型', () => {
      expect(engine.getModel(DEFAULT_MODEL_SPEC.id)).toBeDefined();
    });

    it('注册 Fallback 模型', () => {
      const models = engine.listModels();
      const fallbacks = models.filter((m) => m.role === 'fallback');
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it('创建默认预算（request + daily）', () => {
      const budgets = engine.listBudgets();
      const requestBudget = budgets.find((b) => b.level === 'request');
      const dailyBudget = budgets.find((b) => b.level === 'daily');
      expect(requestBudget).toBeDefined();
      expect(dailyBudget).toBeDefined();
    });

    it('daily 预算有 resetAt', () => {
      const budgets = engine.listBudgets();
      const daily = budgets.find((b) => b.level === 'daily');
      expect(daily?.resetAt).toBeDefined();
      expect(daily!.resetAt!).toBeGreaterThan(Date.now());
    });
  });

  describe('Fallback 链', () => {
    it('无错误时返回主模型', () => {
      expect(engine.resolveModel()).toBe(DEFAULT_MODEL_SPEC.id);
    });

    it('rate_limit 错误时 fallback', () => {
      const fallback = engine.resolveModel('rate_limit');
      expect(fallback).not.toBe(DEFAULT_MODEL_SPEC.id);
    });

    it('未配置的错误不触发 fallback', () => {
      const model = engine.resolveModel('unrelated_error');
      expect(model).toBe(DEFAULT_MODEL_SPEC.id);
    });

    it('setFallbackChain 自定义', () => {
      engine.setFallbackChain({ fallbacks: ['custom-model'] });
      const model = engine.resolveModel('timeout');
      expect(model).toBe('custom-model');
    });
  });

  describe('预算检查', () => {
    it('默认允许', () => {
      const result = engine.checkBudget({ level: 'request' });
      expect(result.allowed).toBe(true);
    });

    it('超限时拒绝', () => {
      engine.createBudget({ level: 'request', limitUsd: 0.001 });
      engine.recordCost({
        level: 'request',
        modelId: DEFAULT_MODEL_SPEC.id,
        inputTokens: 1000,
        outputTokens: 1000,
      });
      const result = engine.checkBudget({ level: 'request', estimatedCostUsd: 1 });
      expect(result.allowed).toBe(false);
    });

    it('remainingUsd 正确计算', () => {
      engine.createBudget({ level: 'request', limitUsd: 1.0 });
      engine.recordCost({
        level: 'request',
        modelId: DEFAULT_MODEL_SPEC.id,
        inputTokens: 100000, // 0.3 USD
        outputTokens: 0,
      });
      const result = engine.checkBudget({ level: 'request' });
      expect(result.remainingUsd).toBeCloseTo(0.7, 1);
    });

    it('agent 路径独立预算', () => {
      const result1 = engine.checkBudget({ level: 'request', agentPath: '/root/a' });
      const result2 = engine.checkBudget({ level: 'request', agentPath: '/root/b' });
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('成本记录', () => {
    it('正确计算成本', () => {
      const model = engine.getModel(DEFAULT_MODEL_SPEC.id)!;
      const record = engine.recordCost({
        level: 'request',
        modelId: DEFAULT_MODEL_SPEC.id,
        inputTokens: 1_000_000, // 1M tokens
        outputTokens: 1_000_000,
      });
      expect(record.costUsd).toBeCloseTo(model.inputCostPer1M + model.outputCostPer1M, 2);
    });

    it('未知 model 抛错', () => {
      expect(() =>
        engine.recordCost({ level: 'request', modelId: 'non-existent', inputTokens: 100, outputTokens: 100 })
      ).toThrow();
    });

    it('记录后预算已用增加', () => {
      const before = engine.getBudget('default-request')!.usedUsd;
      engine.recordCost({
        level: 'request',
        modelId: DEFAULT_MODEL_SPEC.id,
        inputTokens: 1000,
        outputTokens: 1000,
      });
      const after = engine.getBudget('default-request')!.usedUsd;
      expect(after).toBeGreaterThan(before);
    });

    it('listRecords 按 level 过滤', () => {
      engine.recordCost({ level: 'request', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 100, outputTokens: 100 });
      engine.recordCost({ level: 'daily', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 100, outputTokens: 100 });
      const requestRecords = engine.listRecords({ level: 'request' });
      expect(requestRecords.every((r) => r.level === 'request')).toBe(true);
    });

    it('getTotalCost 正确求和', () => {
      engine.recordCost({ level: 'request', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 1000, outputTokens: 1000 });
      engine.recordCost({ level: 'request', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 1000, outputTokens: 1000 });
      const total = engine.getTotalCost({ level: 'request' });
      expect(total).toBeGreaterThan(0);
    });
  });

  describe('每日重置', () => {
    it('过 resetAt 后重置 usedUsd', () => {
      const daily = engine.getBudget('default-daily')!;
      // 模拟重置时间已过
      daily.resetAt = Date.now() - 1000;
      daily.usedUsd = 10;
      const result = engine.checkBudget({ level: 'daily' });
      expect(result.allowed).toBe(true);
      expect(daily.usedUsd).toBe(0);
    });
  });

  describe('事件系统', () => {
    it('订阅 cost-recorded', () => {
      const events: any[] = [];
      engine.on('cost-recorded', (e) => events.push(e));
      engine.recordCost({ level: 'request', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 100, outputTokens: 100 });
      expect(events.length).toBe(1);
    });

    it('订阅 fallback-triggered', () => {
      const events: any[] = [];
      engine.on('fallback-triggered', (e) => events.push(e));
      engine.resolveModel('rate_limit');
      expect(events.length).toBe(1);
    });

    it('订阅 budget-exceeded', () => {
      const events: any[] = [];
      engine.on('budget-exceeded', (e) => events.push(e));
      engine.createBudget({ level: 'request', limitUsd: 0.0001 });
      engine.recordCost({ level: 'request', modelId: DEFAULT_MODEL_SPEC.id, inputTokens: 100000, outputTokens: 100000 });
      engine.checkBudget({ level: 'request', estimatedCostUsd: 1 });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('CRUD', () => {
    it('registerModel 添加', () => {
      engine.registerModel({
        id: 'custom',
        name: 'Custom',
        role: 'fallback',
        inputCostPer1M: 1,
        outputCostPer1M: 2,
        maxContext: 100000,
      });
      expect(engine.getModel('custom')).toBeDefined();
    });

    it('createBudget 独立 ID', () => {
      const b1 = engine.createBudget({ level: 'agent', limitUsd: 1, agentPath: '/root/a' });
      const b2 = engine.createBudget({ level: 'agent', limitUsd: 2, agentPath: '/root/b' });
      expect(b1.limitUsd).toBe(1);
      expect(b2.limitUsd).toBe(2);
    });
  });
});

describe('工具函数', () => {
  describe('calculateCost', () => {
    it('正确计算', () => {
      const cost = calculateCost(
        { id: 'm', name: 'm', role: 'primary', inputCostPer1M: 3, outputCostPer1M: 15, maxContext: 100000 },
        1_000_000,
        1_000_000
      );
      expect(cost).toBe(18);
    });

    it('0 token 返回 0', () => {
      expect(calculateCost(
        { id: 'm', name: 'm', role: 'primary', inputCostPer1M: 3, outputCostPer1M: 15, maxContext: 100000 },
        0,
        0
      )).toBe(0);
    });
  });

  describe('isValidBudgetLevel', () => {
    it('有效', () => {
      expect(isValidBudgetLevel('request')).toBe(true);
      expect(isValidBudgetLevel('agent')).toBe(true);
      expect(isValidBudgetLevel('daily')).toBe(true);
    });
    it('无效', () => {
      expect(isValidBudgetLevel('weekly')).toBe(false);
    });
  });

  describe('getNextDayReset', () => {
    it('返回明天 0 点', () => {
      const reset = getNextDayReset();
      const date = new Date(reset);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
      expect(reset).toBeGreaterThan(Date.now());
    });
  });
});

describe('单例', () => {
  beforeEach(() => {
    resetDefaultCostBudgetEngine();
  });

  it('getDefault 返回相同实例', () => {
    const a = getDefaultCostBudgetEngine();
    const b = getDefaultCostBudgetEngine();
    expect(a).toBe(b);
  });
});
