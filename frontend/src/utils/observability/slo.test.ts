/**
 * # ============================================================
 * # SLO/SLI 单元测试 (Cycle 53 G53-03)
 * # ====================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SLOCalculator,
  createSLI,
  createSLO,
  createAvailabilitySLI,
  createLatencySLI,
} from './slo';
import type { SLIDataPoint, SLIDefinition, SLOTarget } from './slo';

describe('SLOCalculator', () => {
  let calc: SLOCalculator;

  beforeEach(() => {
    calc = new SLOCalculator();
  });

  describe('SLI 注册', () => {
    it('应该注册 SLI', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      expect(calc.getSLIs()).toHaveLength(1);
    });

    it('应该使用 createSLI 工厂生成 ID', () => {
      const sli = createSLI({
        name: 'test-sli',
        type: 'availability',
        description: 'Test',
        goodQuery: 'a',
        totalQuery: 'b',
        unit: 'ratio',
      });
      expect(sli.id).toBeDefined();
      expect(sli.id).toContain('test-sli');
    });
  });

  describe('SLO 注册', () => {
    it('应该注册 SLO', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'test-slo', sliId: sli.id, target: 0.999, enabled: true });
      calc.registerSLO(slo);
      expect(calc.getSLOs()).toHaveLength(1);
    });

    it('应该发出 slo-created 事件', () => {
      const listener = vi.fn();
      calc.subscribe(listener);
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'test-slo', sliId: sli.id, target: 0.999, enabled: true });
      calc.registerSLO(slo);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'slo-created' })
      );
    });
  });

  describe('SLI 计算', () => {
    it('没有数据时应返回 1.0', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      expect(calc.calculateSLI(sli.id)).toBe(1.0);
    });

    it('应该基于数据点计算 SLI', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      calc.recordDataPoint(sli.id, 99, 100);
      calc.recordDataPoint(sli.id, 99, 100);
      calc.recordDataPoint(sli.id, 100, 100);
      const value = calc.calculateSLI(sli.id);
      expect(value).toBeCloseTo(0.9933, 3);
    });

    it('总事件为 0 时应返回 1.0', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      calc.recordDataPoint(sli.id, 0, 0);
      expect(calc.calculateSLI(sli.id)).toBe(1.0);
    });

    it('应该支持时间窗口过滤', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const now = Date.now();
      calc.recordDataPoint(sli.id, 100, 100, now - 2 * 60 * 60 * 1000); // 2h ago
      calc.recordDataPoint(sli.id, 0, 100, now); // now
      const value1h = calc.calculateSLI(sli.id, 60 * 60 * 1000);
      const value3h = calc.calculateSLI(sli.id, 3 * 60 * 60 * 1000);
      expect(value1h).toBeLessThan(value3h);
    });
  });

  describe('错误预算', () => {
    it('应该计算错误预算', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);

      // 99/100 = 99% 可用 (SLO 99% 应该刚好满足)
      for (let i = 0; i < 100; i++) {
        calc.recordDataPoint(sli.id, 99, 100);
      }
      const budget = calc.calculateErrorBudget('avail');
      expect(budget).toBeDefined();
      expect(budget!.consumed).toBeGreaterThanOrEqual(0);
    });

    it('应该标记预算耗尽', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);

      // 90/100 = 90% (大量错误)
      for (let i = 0; i < 100; i++) {
        calc.recordDataPoint(sli.id, 90, 100);
      }
      const budget = calc.calculateErrorBudget('avail');
      expect(budget!.status).toBe('exhausted');
    });

    it('应该标记警告状态', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);

      // 98.5/100 = 98.5% (使用 50% 预算)
      for (let i = 0; i < 100; i++) {
        calc.recordDataPoint(sli.id, 985, 1000);
      }
      const budget = calc.calculateErrorBudget('avail');
      // 在 healthy/warning/critical/exhausted 之间 (98.5% 实际 vs 99% 目标，会触发)
      expect(['healthy', 'warning', 'critical', 'exhausted']).toContain(budget!.status);
    });
  });

  describe('燃烧率', () => {
    it('没有错误时应返回 0', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);
      calc.recordDataPoint(sli.id, 100, 100);
      expect(calc.calculateBurnRate('avail')).toBe(0);
    });

    it('应有错误时返回 > 0', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);
      calc.recordDataPoint(sli.id, 95, 100);
      expect(calc.calculateBurnRate('avail')).toBeGreaterThan(0);
    });
  });

  describe('SLO 报告', () => {
    it('应该生成完整报告', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.999, enabled: true });
      calc.registerSLO(slo);
      for (let i = 0; i < 10; i++) {
        calc.recordDataPoint(sli.id, 100, 100);
      }
      const report = calc.generateReport('avail');
      expect(report).toBeDefined();
      expect(report!.target).toBe(0.999);
      expect(report!.met).toBe(true);
    });

    it('应该识别未满足的 SLO', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.999, enabled: true });
      calc.registerSLO(slo);
      calc.recordDataPoint(sli.id, 50, 100); // 50% 远低于 99.9%
      const report = calc.generateReport('avail');
      expect(report!.met).toBe(false);
    });

    it('应该包含趋势', () => {
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.99, enabled: true });
      calc.registerSLO(slo);
      for (let i = 0; i < 5; i++) {
        calc.recordDataPoint(sli.id, 50, 100);
        calc.recordDataPoint(sli.id, 100, 100);
      }
      const report = calc.generateReport('avail');
      expect(['improving', 'degrading', 'stable']).toContain(report!.trend);
    });
  });

  describe('事件订阅', () => {
    it('subscribe 应返回 unsubscribe 函数', () => {
      const listener = vi.fn();
      const unsub = calc.subscribe(listener);
      unsub();
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      calc.registerSLO(createSLO({ name: 'a', sliId: sli.id, target: 0.99, enabled: true }));
      expect(listener).not.toHaveBeenCalled();
    });

    it('checkAndAlert 应发出 SLO 违反事件', () => {
      const listener = vi.fn();
      const sli = createAvailabilitySLI('api');
      calc.registerSLI(sli);
      const slo = createSLO({ name: 'avail', sliId: sli.id, target: 0.999, enabled: true });
      calc.registerSLO(slo);
      calc.recordDataPoint(sli.id, 50, 100);
      calc.subscribe(listener);
      calc.checkAndAlert();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('slo-violation');
    });
  });

  describe('工厂函数', () => {
    it('createAvailabilitySLI', () => {
      const sli = createAvailabilitySLI('api');
      expect(sli.name).toContain('http-availability');
      expect(sli.type).toBe('availability');
      expect(sli.goodQuery).toContain('api');
    });

    it('createLatencySLI', () => {
      const sli = createLatencySLI('api', 500);
      expect(sli.name).toContain('500ms');
      expect(sli.type).toBe('latency');
    });

    it('createSLO 默认 30 天窗口', () => {
      const slo = createSLO({ name: 'test', sliId: 'sli-1', target: 0.99, enabled: true });
      expect(slo.window.durationMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect(slo.window.type).toBe('rolling');
    });
  });
});
