/**
 * # ============================================================
 * # AutoScaler 单元测试 (Cycle 52 G52-03)
 * # ============================================================
 * # 核心作用：验证自动扩缩容器的所有功能
 * # 运行流程：
 * #   1. 实例初始化
 * #   2. 指标采样 + 滑动窗口
 * #   3. 扩容/缩容/无操作评估
 * #   4. 冷却期控制
 * #   5. 事件订阅
 * #   6. 报告生成
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-03 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoScaler, createDefaultScalingConfig } from './autoScaler';
import type { ScalingConfig, ServiceMetrics } from './autoScaler';

function createTestConfig(overrides: Partial<ScalingConfig> = {}): ScalingConfig {
  return createDefaultScalingConfig('test-service', {
    sampleIntervalMs: 50,
    cooldownMs: 100,
    ...overrides,
  });
}

describe('AutoScaler', () => {
  let scaler: AutoScaler;

  beforeEach(() => {
    scaler = new AutoScaler(createTestConfig());
  });

  describe('实例管理', () => {
    it('应该初始化正确数量的实例', () => {
      expect(scaler.getCurrentInstances()).toBe(2);
      expect(scaler.getInstances()).toHaveLength(2);
    });

    it('应该支持自定义初始实例数', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 5 }));
      expect(s.getCurrentInstances()).toBe(5);
    });

    it('实例 ID 应该是唯一的', () => {
      const instances = scaler.getInstances();
      const ids = instances.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('指标采样', () => {
    it('应该生成有效的默认指标', async () => {
      const metrics = await (scaler as unknown as { sampleMetrics: () => Promise<ServiceMetrics> }).sampleMetrics();
      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage).toBeLessThanOrEqual(1);
      expect(metrics.qps).toBeGreaterThanOrEqual(0);
    });

    it('应该支持自定义 metricsProvider', async () => {
      const customProvider = vi.fn().mockResolvedValue({
        cpuUsage: 0.9,
        memoryUsage: 0.9,
        qps: 1000,
        avgLatencyMs: 500,
        activeConnections: 100,
      });
      const s = new AutoScaler(createTestConfig({ metricsProvider: customProvider }));
      const report = await s.start(100);
      expect(customProvider).toHaveBeenCalled();
      expect(report.totalSamples).toBeGreaterThan(0);
    });
  });

  describe('滑动窗口', () => {
    it('应该维护指定大小的窗口', () => {
      const windowSize = 3;
      const s = new AutoScaler(createTestConfig({ windowSize }));
      (s as unknown as { metricsWindow: ServiceMetrics[] }).metricsWindow.length = 0;
      for (let i = 0; i < 5; i++) {
        (s as unknown as { updateWindow: (m: ServiceMetrics) => ServiceMetrics }).updateWindow({
          timestamp: Date.now(),
          cpuUsage: i / 10,
          memoryUsage: 0.5,
          qps: 100,
          avgLatencyMs: 100,
          activeConnections: 10,
        });
      }
      expect((s as unknown as { metricsWindow: ServiceMetrics[] }).metricsWindow).toHaveLength(windowSize);
    });

    it('应该计算窗口平均值', () => {
      const s = new AutoScaler(createTestConfig({ windowSize: 2 }));
      (s as unknown as { updateWindow: (m: ServiceMetrics) => ServiceMetrics }).updateWindow({
        timestamp: Date.now(),
        cpuUsage: 0.4,
        memoryUsage: 0.5,
        qps: 100,
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      const avg = (s as unknown as { updateWindow: (m: ServiceMetrics) => ServiceMetrics }).updateWindow({
        timestamp: Date.now(),
        cpuUsage: 0.6,
        memoryUsage: 0.5,
        qps: 100,
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      expect(avg.cpuUsage).toBeCloseTo(0.5, 2);
    });
  });

  describe('扩容评估', () => {
    it('CPU 高时应触发扩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 1, maxInstances: 5 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.9, // > 0.7 阈值
        memoryUsage: 0.5,
        qps: 100,
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      expect((action as { type: string }).type).toBe('scale-up');
    });

    it('内存高时应触发扩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.5,
        memoryUsage: 0.95, // > 0.8 阈值
        qps: 100,
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      expect((action as { type: string }).type).toBe('scale-up');
    });

    it('QPS 高时应触发扩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        qps: 500, // > 200 阈值
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      expect((action as { type: string }).type).toBe('scale-up');
    });

    it('延迟高时应触发扩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        qps: 100,
        avgLatencyMs: 500, // > 300 阈值
        activeConnections: 10,
      });
      expect((action as { type: string }).type).toBe('scale-up');
    });

    it('达到 maxInstances 时不应再扩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 10, maxInstances: 10 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.9,
        memoryUsage: 0.9,
        qps: 1000,
        avgLatencyMs: 500,
        activeConnections: 100,
      });
      expect((action as { type: string }).type).toBe('no-op');
    });
  });

  describe('缩容评估', () => {
    it('多个指标低时应触发缩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 5, minInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.1, // < 0.3
        memoryUsage: 0.2, // < 0.4
        qps: 20, // < 50
        avgLatencyMs: 50, // < 100
        activeConnections: 5,
      });
      expect((action as { type: string }).type).toBe('scale-down');
    });

    it('达到 minInstances 时不应再缩容', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 1, minInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.1,
        memoryUsage: 0.2,
        qps: 20,
        avgLatencyMs: 50,
        activeConnections: 5,
      });
      expect((action as { type: string }).type).toBe('no-op');
    });

    it('只有 2 个指标低时不应缩容 (需 ≥ 3 个)', () => {
      const s = new AutoScaler(createTestConfig({ initialInstances: 5, minInstances: 1 }));
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.1, // < 0.3
        memoryUsage: 0.2, // < 0.4
        qps: 100, // > 50 (不低)
        avgLatencyMs: 200, // > 100 (不低)
        activeConnections: 5,
      });
      expect((action as { type: string }).type).toBe('no-op');
    });
  });

  describe('无操作评估', () => {
    it('所有指标正常时应为 no-op', () => {
      const s = new AutoScaler(createTestConfig());
      const action = (s as unknown as { evaluate: (m: ServiceMetrics) => unknown }).evaluate({
        timestamp: Date.now(),
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        qps: 100,
        avgLatencyMs: 100,
        activeConnections: 10,
      });
      expect((action as { type: string }).type).toBe('no-op');
    });
  });

  describe('完整运行', () => {
    it('应该能启动并生成报告', async () => {
      const report = await scaler.start(200);
      expect(report.service).toBe('test-service');
      expect(report.initialInstances).toBe(2);
      expect(report.finalInstances).toBeGreaterThanOrEqual(1);
      expect(report.durationMs).toBeGreaterThan(0);
    });

    it('高负载应触发扩容', async () => {
      const s = new AutoScaler(
        createTestConfig({
          initialInstances: 1,
          maxInstances: 5,
          stepSize: 1,
          sampleIntervalMs: 30,
          cooldownMs: 50,
          metricsProvider: async () => ({
            cpuUsage: 0.95, // 高负载
            memoryUsage: 0.95,
            qps: 500,
            avgLatencyMs: 500,
            activeConnections: 50,
          }),
        })
      );
      const report = await s.start(300);
      expect(report.scaleUpCount).toBeGreaterThan(0);
      expect(report.finalInstances).toBeGreaterThan(1);
    });

    it('低负载应触发缩容', async () => {
      const s = new AutoScaler(
        createTestConfig({
          initialInstances: 5,
          minInstances: 1,
          stepSize: 1,
          sampleIntervalMs: 30,
          cooldownMs: 50,
          metricsProvider: async () => ({
            cpuUsage: 0.1, // 低负载
            memoryUsage: 0.2,
            qps: 20,
            avgLatencyMs: 50,
            activeConnections: 5,
          }),
        })
      );
      const report = await s.start(300);
      expect(report.scaleDownCount).toBeGreaterThan(0);
      expect(report.finalInstances).toBeLessThan(5);
    });

    it('应该防止重复启动', async () => {
      const promise1 = scaler.start(200);
      await expect(scaler.start(200)).rejects.toThrow('already running');
      await promise1;
    });
  });

  describe('事件订阅', () => {
    it('应该触发 start 事件', async () => {
      const listener = vi.fn();
      scaler.subscribe(listener);
      await scaler.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('start');
    });

    it('应该触发 metrics-sampled 事件', async () => {
      const listener = vi.fn();
      scaler.subscribe(listener);
      await scaler.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types.filter((t) => t === 'metrics-sampled').length).toBeGreaterThan(0);
    });

    it('应该触发 complete 事件', async () => {
      const listener = vi.fn();
      scaler.subscribe(listener);
      await scaler.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('complete');
    });

    it('subscribe 应该返回 unsubscribe 函数', () => {
      const listener = vi.fn();
      const unsub = scaler.subscribe(listener);
      unsub();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('报告生成', () => {
    it('应该生成正确的 summary', async () => {
      const report = await scaler.start(200);
      expect(report.summary).toContain('test-service');
      expect(report.summary).toContain('instances');
    });

    it('应该生成推荐建议', async () => {
      const report = await scaler.start(100);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('应该正确统计操作次数', async () => {
      const report = await scaler.start(200);
      expect(report.scaleUpCount + report.scaleDownCount + report.noOpCount).toBeGreaterThan(0);
    });
  });

  describe('优雅停止', () => {
    it('应该在 abort 后停止', async () => {
      const s = new AutoScaler(createTestConfig({ sampleIntervalMs: 50 }));
      setTimeout(() => s.abort(), 100);
      const report = await s.start(5000);
      expect(report.durationMs).toBeLessThan(5000);
    });
  });
});

describe('工厂函数', () => {
  it('createDefaultScalingConfig 应该返回有效配置', () => {
    const config = createDefaultScalingConfig('test');
    expect(config.service).toBe('test');
    expect(config.minInstances).toBe(1);
    expect(config.maxInstances).toBe(10);
    expect(config.thresholds).toBeDefined();
  });

  it('createDefaultScalingConfig 支持 overrides', () => {
    const config = createDefaultScalingConfig('test', { minInstances: 3 });
    expect(config.minInstances).toBe(3);
  });
});
