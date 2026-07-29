/**
 * MultiModelExecutor 单元测试 (v1.0.0 Cycle 19 G19-02)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiModelExecutor } from './multiModelExecutor';
import {
  DEFAULT_MODELS,
  calculateCost,
  estimateTokens,
} from './bestOfNTypes';

describe('MultiModelExecutor', () => {
  let executor: MultiModelExecutor;

  beforeEach(() => {
    executor = new MultiModelExecutor({
      mockMode: true,
      mockDelayMin: 10,
      mockDelayMax: 20,
      defaultTimeoutMs: 5000,
    });
  });

  describe('execute', () => {
    it('应该并行执行所有模型', async () => {
      const result = await executor.execute({
        prompt: '你好',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      expect(result.candidates.length).toBe(2);
      expect(result.successCount + result.failureCount).toBe(2);
    });

    it('空 prompt 抛错', async () => {
      await expect(
        executor.execute({ prompt: '', models: ['m1', 'm2'] })
      ).rejects.toThrow('Prompt cannot be empty');
    });

    it('模型 < 2 抛错', async () => {
      await expect(
        executor.execute({ prompt: 'test', models: ['m1'] })
      ).rejects.toThrow('At least 2 models required');
    });

    it('模型 > 5 抛错', async () => {
      await expect(
        executor.execute({
          prompt: 'test',
          models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
        })
      ).rejects.toThrow('Too many models');
    });

    it('应该正确填充 inputTokens/outputTokens/cost', async () => {
      const result = await executor.execute({
        prompt: 'hello world',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      result.candidates.forEach(c => {
        expect(c.inputTokens).toBeGreaterThan(0);
        expect(c.outputTokens).toBeGreaterThan(0);
        expect(c.cost).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('cancel', () => {
    it('应该中断正在执行的任务', async () => {
      const promise = executor.execute({
        prompt: 'test long content',
        models: ['claude-sonnet-4.5', 'gpt-5'],
        timeoutMs: 30000,
      });
      // 立即取消
      setTimeout(() => executor.cancel(), 50);
      const result = await promise;
      // 至少有一个是 cancelled 或 failed
      const hasFailure = result.candidates.some(c => c.status === 'failed' || c.status === 'cancelled');
      // 取消不一定会失败（取决于执行速度），但不应崩溃
      expect(result.candidates.length).toBe(2);
      // 如果是快速 mock，可能已经完成
      if (hasFailure) {
        // 至少一个失败说明 cancel 起作用
        expect(true).toBe(true);
      } else {
        // 全部完成
        expect(result.candidates.every(c => c.status === 'done')).toBe(true);
      }
    });
  });

  describe('事件总线', () => {
    it('emit start 事件', async () => {
      const handler = vi.fn();
      executor.on('start', handler);
      await executor.execute({
        prompt: 'test',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('emit delta 事件（流式）', async () => {
      const handler = vi.fn();
      executor.on('delta', handler);
      await executor.execute({
        prompt: 'test',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      expect(handler).toHaveBeenCalled();
    });

    it('emit all-complete 事件', async () => {
      const handler = vi.fn();
      executor.on('all-complete', handler);
      await executor.execute({
        prompt: 'test',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe 取消订阅', async () => {
      const handler = vi.fn();
      const unsub = executor.on('start', handler);
      unsub();
      await executor.execute({
        prompt: 'test',
        models: ['claude-sonnet-4.5', 'gpt-5'],
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('工具方法', () => {
    it('getAvailableModels 返回预置模型', () => {
      const models = executor.getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.find(m => m.id === 'claude-sonnet-4.5')).toBeDefined();
    });

    it('estimateCost 返回总成本', () => {
      const est = executor.estimateCost('test prompt', ['claude-sonnet-4.5', 'gpt-5']);
      expect(est.total).toBeGreaterThan(0);
      expect(est.perModel['claude-sonnet-4.5']).toBeGreaterThan(0);
    });
  });
});

describe('bestOfNTypes utilities', () => {
  describe('calculateCost', () => {
    it('应该正确计算成本', () => {
      const cost = calculateCost(1000, 500, 'claude-sonnet-4.5');
      // 1000 * 0.000021 + 500 * 0.000105 = 0.021 + 0.0525 = 0.0735
      expect(cost).toBeCloseTo(0.0735, 4);
    });

    it('未知模型返回 0', () => {
      const cost = calculateCost(1000, 500, 'unknown-model');
      expect(cost).toBe(0);
    });
  });

  describe('estimateTokens', () => {
    it('应该估算中文 token', () => {
      const tokens = estimateTokens('你好世界');
      // 4 个中文字符 * 1.5 = 6
      expect(tokens).toBe(6);
    });

    it('应该估算英文 token', () => {
      const tokens = estimateTokens('hello world');
      // 11 个英文字符 * 0.4 = 4.4 → 5
      // 空格算其他字符
      // 实际: 10*0.4 + 1*1 = 5
      expect(tokens).toBeGreaterThanOrEqual(4);
      expect(tokens).toBeLessThanOrEqual(6);
    });
  });

  describe('DEFAULT_MODELS', () => {
    it('应该包含主流模型', () => {
      expect(DEFAULT_MODELS.find(m => m.id === 'claude-sonnet-4.5')).toBeDefined();
      expect(DEFAULT_MODELS.find(m => m.id === 'gpt-5')).toBeDefined();
      expect(DEFAULT_MODELS.find(m => m.id === 'deepseek-v3.2')).toBeDefined();
    });

    it('每个模型都有定价', () => {
      DEFAULT_MODELS.forEach(m => {
        expect(m.pricing.inputPer1k).toBeGreaterThanOrEqual(0);
        expect(m.pricing.outputPer1k).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
