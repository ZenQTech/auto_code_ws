/**
 * # ============================================================
 * # CanaryDeployment 单元测试 (Cycle 52 G52-01)
 * # ============================================================
 * # 核心作用：验证灰度发布控制器的所有功能
 * # 运行流程：
 * #   1. 基础执行 (单阶段 + 多阶段)
 * #   2. 健康度计算 (各种指标组合)
 * #   3. 自动回滚 (健康度不足时)
 * #   4. 事件订阅 (start/stage-promote/rollback/complete)
 * #   5. 优雅停止 (abort)
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-01 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanaryDeployment, createCanaryStrategy } from './canaryDeployment';
import type { CanaryStrategy, CanaryMetrics, HealthThresholds } from './canaryDeployment';

describe('CanaryDeployment', () => {
  describe('基础执行', () => {
    it('应该执行单阶段灰度', async () => {
      const strategy = createCanaryStrategy(
        'test-service',
        [{ name: 'Smoke Test', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.status).toBe('completed');
      expect(report.stages).toHaveLength(1);
      expect(report.stages[0]!.name).toBe('Smoke Test');
    });

    it('应该执行多阶段灰度', async () => {
      const strategy = createCanaryStrategy(
        'test-service',
        [
          { name: 'Stage 1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 },
          { name: 'Stage 2', trafficPercent: 50, durationMs: 100, minHealthScore: 0.5 },
          { name: 'Stage 3', trafficPercent: 100, durationMs: 100, minHealthScore: 0.5 },
        ],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.status).toBe('completed');
      expect(report.stages).toHaveLength(3);
      expect(report.currentTrafficPercent).toBe(100);
    });

    it('应该设置最终指标', async () => {
      const strategy = createCanaryStrategy(
        'test-service',
        [{ name: 'Final', trafficPercent: 100, durationMs: 100, minHealthScore: 0.5 }],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.finalMetrics).toBeDefined();
      expect(report.finalMetrics?.healthScore).toBeGreaterThanOrEqual(0);
    });

    it('应该防止重复执行', async () => {
      const strategy = createCanaryStrategy(
        'test-service',
        [{ name: 'Test', trafficPercent: 10, durationMs: 200, minHealthScore: 0.5 }],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const promise1 = deployment.execute();
      await expect(deployment.execute()).rejects.toThrow('already running');
      await promise1;
    });
  });

  describe('健康度计算', () => {
    it('应该在所有指标优秀时返回高分', () => {
      const strategy = createCanaryStrategy('test', undefined, {
        maxErrorRate: 0.05,
        maxP95LatencyMs: 500,
        minQps: 50,
        maxCpuUsage: 0.8,
      });
      const deployment = new CanaryDeployment(strategy);
      const goodMetrics: Omit<CanaryMetrics, 'healthScore'> = {
        timestamp: Date.now(),
        errorRate: 0.001,
        p95LatencyMs: 50,
        qps: 200,
        cpuUsage: 0.3,
      };
      // 内部方法测试
      const score = (deployment as unknown as { calculateHealth: (m: Omit<CanaryMetrics, 'healthScore'>) => number }).calculateHealth(goodMetrics);
      expect(score).toBeGreaterThan(0.9);
    });

    it('应该在错误率高时扣分', () => {
      const strategy = createCanaryStrategy('test', undefined, {
        maxErrorRate: 0.05,
        maxP95LatencyMs: 500,
        minQps: 50,
        maxCpuUsage: 0.8,
      });
      const deployment = new CanaryDeployment(strategy);
      const badMetrics: Omit<CanaryMetrics, 'healthScore'> = {
        timestamp: Date.now(),
        errorRate: 0.2,
        p95LatencyMs: 50,
        qps: 200,
        cpuUsage: 0.3,
      };
      const score = (deployment as unknown as { calculateHealth: (m: Omit<CanaryMetrics, 'healthScore'>) => number }).calculateHealth(badMetrics);
      expect(score).toBeLessThan(0.5);
    });

    it('应该在延迟高时扣分', () => {
      const strategy = createCanaryStrategy('test', undefined, {
        maxErrorRate: 0.05,
        maxP95LatencyMs: 500,
        minQps: 50,
        maxCpuUsage: 0.8,
      });
      const deployment = new CanaryDeployment(strategy);
      const slowMetrics: Omit<CanaryMetrics, 'healthScore'> = {
        timestamp: Date.now(),
        errorRate: 0.001,
        p95LatencyMs: 2000,
        qps: 200,
        cpuUsage: 0.3,
      };
      const score = (deployment as unknown as { calculateHealth: (m: Omit<CanaryMetrics, 'healthScore'>) => number }).calculateHealth(slowMetrics);
      expect(score).toBeLessThan(0.5);
    });

    it('应该使用自定义 healthCalculator', () => {
      const customCalc = vi.fn(() => 0.85);
      const strategy: CanaryStrategy = {
        ...createCanaryStrategy('test'),
        healthCalculator: customCalc,
      };
      const deployment = new CanaryDeployment(strategy);
      const metrics: Omit<CanaryMetrics, 'healthScore'> = {
        timestamp: Date.now(),
        errorRate: 0,
        p95LatencyMs: 50,
        qps: 200,
        cpuUsage: 0.3,
      };
      const score = (deployment as unknown as { calculateHealth: (m: Omit<CanaryMetrics, 'healthScore'>) => number }).calculateHealth(metrics);
      expect(customCalc).toHaveBeenCalled();
      expect(score).toBe(0.85);
    });

    it('健康分数应该限制在 0-1 范围', () => {
      const strategy = createCanaryStrategy('test', undefined, {
        maxErrorRate: 0.05,
        maxP95LatencyMs: 500,
        minQps: 50,
        maxCpuUsage: 0.8,
      });
      const deployment = new CanaryDeployment(strategy);
      const terribleMetrics: Omit<CanaryMetrics, 'healthScore'> = {
        timestamp: Date.now(),
        errorRate: 1.0,
        p95LatencyMs: 10000,
        qps: 0,
        cpuUsage: 1.0,
      };
      const score = (deployment as unknown as { calculateHealth: (m: Omit<CanaryMetrics, 'healthScore'>) => number }).calculateHealth(terribleMetrics);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('自动回滚', () => {
    it('应该在健康度不足时自动回滚', async () => {
      const strategy: CanaryStrategy = {
        ...createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 }),
        healthCalculator: () => 0.3, // 强制低分
      };
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.status).toBe('rolled-back');
      expect(report.rollbackReason).toBeDefined();
    });

    it('autoRollback=false 时不应该自动回滚 (应为 failed)', async () => {
      const strategy: CanaryStrategy = {
        ...createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50, autoRollback: false }),
        healthCalculator: () => 0.3,
      };
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.status).toBe('failed');
    });
  });

  describe('事件订阅', () => {
    it('应该触发 start 事件', async () => {
      const strategy = createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 });
      const deployment = new CanaryDeployment(strategy);
      const listener = vi.fn();
      deployment.subscribe(listener);
      await deployment.execute();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('start');
    });

    it('应该触发 stage-start 和 stage-metrics 事件', async () => {
      const strategy = createCanaryStrategy(
        'test',
        [{ name: 'S1', trafficPercent: 10, durationMs: 150, minHealthScore: 0.5 }],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const listener = vi.fn();
      deployment.subscribe(listener);
      await deployment.execute();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('stage-start');
      expect(types.filter((t) => t === 'stage-metrics').length).toBeGreaterThan(0);
    });

    it('应该触发 stage-promote 事件 (多阶段)', async () => {
      const strategy = createCanaryStrategy(
        'test',
        [
          { name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 },
          { name: 'S2', trafficPercent: 50, durationMs: 100, minHealthScore: 0.5 },
        ],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      const listener = vi.fn();
      deployment.subscribe(listener);
      await deployment.execute();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('stage-promote');
    });

    it('应该触发 complete 事件', async () => {
      const strategy = createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 });
      const deployment = new CanaryDeployment(strategy);
      const listener = vi.fn();
      deployment.subscribe(listener);
      await deployment.execute();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('complete');
    });

    it('subscribe 应该返回 unsubscribe 函数', async () => {
      const strategy = createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 });
      const deployment = new CanaryDeployment(strategy);
      const listener = vi.fn();
      const unsub = deployment.subscribe(listener);
      unsub();
      await deployment.execute();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('优雅停止', () => {
    it('应该在 abort 后停止', async () => {
      const strategy = createCanaryStrategy(
        'test',
        [{ name: 'S1', trafficPercent: 10, durationMs: 500, minHealthScore: 0.5 }],
        undefined,
        { sampleIntervalMs: 50 }
      );
      const deployment = new CanaryDeployment(strategy);
      setTimeout(() => deployment.abort(), 100);
      const report = await deployment.execute();
      expect(report.status).toBe('failed');
    });
  });

  describe('报告生成', () => {
    it('应该生成正确的 summary (completed)', async () => {
      const strategy = createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 });
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.summary).toContain('COMPLETED');
    });

    it('应该生成正确的 summary (rolled-back)', async () => {
      const strategy: CanaryStrategy = {
        ...createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 }),
        healthCalculator: () => 0.3,
      };
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.summary).toContain('ROLLED BACK');
    });

    it('应该为完成状态生成正向建议', async () => {
      const strategy = createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 });
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('应该为回滚状态生成改进建议', async () => {
      const strategy: CanaryStrategy = {
        ...createCanaryStrategy('test', [{ name: 'S1', trafficPercent: 10, durationMs: 100, minHealthScore: 0.5 }], undefined, { sampleIntervalMs: 50 }),
        healthCalculator: () => 0.3,
      };
      const deployment = new CanaryDeployment(strategy);
      const report = await deployment.execute();
      expect(report.recommendations.some((r) => r.includes('回滚') || r.includes('健康度'))).toBe(true);
    });
  });

  describe('工厂函数', () => {
    it('createCanaryStrategy 应该使用默认阶段', () => {
      const strategy = createCanaryStrategy('test');
      expect(strategy.stages).toHaveLength(4);
      expect(strategy.stages[0]!.trafficPercent).toBe(1);
      expect(strategy.stages[3]!.trafficPercent).toBe(100);
    });

    it('createCanaryStrategy 应该使用自定义阶段', () => {
      const strategy = createCanaryStrategy('test', [
        { name: 'Custom 1', trafficPercent: 20, durationMs: 5000, minHealthScore: 0.8 },
      ]);
      expect(strategy.stages).toHaveLength(1);
      expect(strategy.stages[0]!.name).toBe('Custom 1');
    });

    it('createCanaryStrategy 应该使用自定义阈值', () => {
      const strategy = createCanaryStrategy('test', undefined, { maxErrorRate: 0.01 });
      expect(strategy.healthThresholds.maxErrorRate).toBe(0.01);
    });

    it('createCanaryStrategy 默认 autoRollback=true', () => {
      const strategy = createCanaryStrategy('test');
      expect(strategy.autoRollback).toBe(true);
    });
  });
});
