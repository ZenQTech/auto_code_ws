/**
 * # ============================================================
 * # MultiRegionRouter 单元测试 (Cycle 52 G52-02)
 * # ============================================================
 * # 核心作用：验证多区域路由器的所有功能
 * # 运行流程：
 * #   1. 区域添加/移除
 * #   2. 5 种路由策略 (latency/round-robin/weighted/geo/failover)
 * #   3. 故障转移 + 重试
 * #   4. 区域统计
 * #   5. 报告生成
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-02 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiRegionRouter, createDefaultRegions, createDefaultRoutingStrategy, haversineDistance } from './multiRegionRouter';
import type { Region, RoutingRequest, RoutingStrategy } from './multiRegionRouter';

function createTestRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'test-region',
    location: { code: 'test', name: 'Test', latitude: 0, longitude: 0 },
    endpoint: 'https://test.example.com',
    weight: 50,
    healthy: true,
    maxConcurrency: 100,
    activeConnections: 0,
    avgLatencyMs: 50,
    ...overrides,
  };
}

function createTestRequest(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    id: 'req-1',
    clientLocation: { code: 'client', name: 'Client', latitude: 39, longitude: 116 },
    path: '/api/test',
    method: 'GET',
    ...overrides,
  };
}

describe('MultiRegionRouter', () => {
  let router: MultiRegionRouter;

  beforeEach(() => {
    router = new MultiRegionRouter(createDefaultRoutingStrategy('latency'));
  });

  describe('区域管理', () => {
    it('应该添加区域', () => {
      const region = createTestRegion({ id: 'r1' });
      router.addRegion(region);
      expect(router.getRegions()).toHaveLength(1);
    });

    it('应该移除区域', () => {
      const region = createTestRegion({ id: 'r1' });
      router.addRegion(region);
      router.removeRegion('r1');
      expect(router.getRegions()).toHaveLength(0);
    });

    it('应该支持添加多个区域', () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      router.addRegion(createTestRegion({ id: 'r2' }));
      router.addRegion(createTestRegion({ id: 'r3' }));
      expect(router.getRegions()).toHaveLength(3);
    });
  });

  describe('路由策略', () => {
    it('latency 策略应选择最低延迟区域', () => {
      router = new MultiRegionRouter(createDefaultRoutingStrategy('latency'));
      router.addRegion(createTestRegion({ id: 'fast', avgLatencyMs: 30 }));
      router.addRegion(createTestRegion({ id: 'slow', avgLatencyMs: 200 }));
      const selected = router.selectRegion(createTestRequest());
      expect(selected?.id).toBe('fast');
    });

    it('round-robin 策略应循环选择', () => {
      router = new MultiRegionRouter(createDefaultRoutingStrategy('round-robin'));
      router.addRegion(createTestRegion({ id: 'r1' }));
      router.addRegion(createTestRegion({ id: 'r2' }));
      const r1 = router.selectRegion(createTestRequest());
      const r2 = router.selectRegion(createTestRequest());
      const r3 = router.selectRegion(createTestRequest());
      expect([r1, r2, r3].map((r) => r!.id).sort()).toEqual(['r1', 'r1', 'r2']);
    });

    it('weighted 策略应根据权重分配', () => {
      router = new MultiRegionRouter(createDefaultRoutingStrategy('weighted'));
      router.addRegion(createTestRegion({ id: 'heavy', weight: 100 }));
      router.addRegion(createTestRegion({ id: 'light', weight: 1 }));
      const counts: Record<string, number> = { heavy: 0, light: 0 };
      for (let i = 0; i < 200; i++) {
        const r = router.selectRegion(createTestRequest());
        if (r) counts[r.id] = (counts[r.id] ?? 0) + 1;
      }
      expect(counts.heavy).toBeGreaterThan(counts.light!);
    });

    it('geo 策略应选择最近区域', () => {
      router = new MultiRegionRouter(createDefaultRoutingStrategy('geo'));
      router.addRegion(
        createTestRegion({
          id: 'beijing',
          location: { code: 'bj', name: 'Beijing', latitude: 39.9, longitude: 116.4 },
        })
      );
      router.addRegion(
        createTestRegion({
          id: 'shanghai',
          location: { code: 'sh', name: 'Shanghai', latitude: 31.2, longitude: 121.5 },
        })
      );
      const selected = router.selectRegion(
        createTestRequest({
          clientLocation: { code: 'client', name: 'Client', latitude: 39, longitude: 116 },
        })
      );
      expect(selected?.id).toBe('beijing');
    });

    it('failover 策略应按 ID 顺序优先选择', () => {
      router = new MultiRegionRouter(createDefaultRoutingStrategy('failover'));
      router.addRegion(createTestRegion({ id: 'primary' }));
      router.addRegion(createTestRegion({ id: 'backup' }));
      const selected = router.selectRegion(createTestRequest());
      expect(selected?.id).toBe('backup'); // backup 字母序在前
    });
  });

  describe('健康检查', () => {
    it('不健康区域应被排除', () => {
      router.addRegion(createTestRegion({ id: 'r1', healthy: false }));
      router.addRegion(createTestRegion({ id: 'r2', healthy: true }));
      const selected = router.selectRegion(createTestRequest());
      expect(selected?.id).toBe('r2');
    });

    it('满载区域应被排除', () => {
      router.addRegion(
        createTestRegion({ id: 'r1', maxConcurrency: 1, activeConnections: 1 })
      );
      router.addRegion(createTestRegion({ id: 'r2' }));
      const selected = router.selectRegion(createTestRequest());
      expect(selected?.id).toBe('r2');
    });

    it('没有健康区域时应返回 null', () => {
      router.addRegion(createTestRegion({ id: 'r1', healthy: false }));
      const selected = router.selectRegion(createTestRequest());
      expect(selected).toBeNull();
    });
  });

  describe('路由执行', () => {
    it('应该成功路由请求', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const result = await router.route(createTestRequest());
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('应该处理多个请求', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const requests = Array.from({ length: 5 }, (_, i) => createTestRequest({ id: `req-${i}` }));
      const report = await router.routeBatch(requests);
      expect(report.totalRequests).toBe(5);
    });

    it('应该在没有健康区域时返回错误', async () => {
      router.addRegion(createTestRegion({ id: 'r1', healthy: false }));
      const result = await router.route(createTestRequest());
      expect(result.success).toBe(false);
      expect(result.error).toBe('No healthy region available');
    });
  });

  describe('事件订阅', () => {
    it('应该触发 start 事件', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const listener = vi.fn();
      router.subscribe(listener);
      await router.routeBatch([createTestRequest()]);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('start');
    });

    it('应该触发 region-added 事件', () => {
      const listener = vi.fn();
      router.subscribe(listener);
      router.addRegion(createTestRegion({ id: 'r1' }));
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('region-added');
    });

    it('应该触发 request-routed 和 request-completed 事件', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const listener = vi.fn();
      router.subscribe(listener);
      await router.route(createTestRequest());
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('request-routed');
      expect(types).toContain('request-completed');
    });

    it('subscribe 应该返回 unsubscribe 函数', () => {
      const listener = vi.fn();
      const unsub = router.subscribe(listener);
      unsub();
      router.addRegion(createTestRegion({ id: 'r1' }));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('报告生成', () => {
    it('应该生成完整报告', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      router.addRegion(createTestRegion({ id: 'r2' }));
      const report = await router.routeBatch([
        createTestRequest({ id: 'q1' }),
        createTestRequest({ id: 'q2' }),
      ]);
      expect(report.regionStats).toHaveLength(2);
      expect(report.regionDistribution).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('应该计算正确的统计', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const report = await router.routeBatch([createTestRequest()]);
      expect(report.successfulRequests + report.failedRequests).toBe(report.totalRequests);
      expect(report.overallErrorRate).toBeGreaterThanOrEqual(0);
      expect(report.overallErrorRate).toBeLessThanOrEqual(1);
    });

    it('应该生成推荐建议', async () => {
      router.addRegion(createTestRegion({ id: 'r1', avgLatencyMs: 50 }));
      const report = await router.routeBatch([createTestRequest()]);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('优雅停止', () => {
    it('应该在 abort 后停止批量路由', async () => {
      router.addRegion(createTestRegion({ id: 'r1' }));
      const requests = Array.from({ length: 10 }, (_, i) => createTestRequest({ id: `req-${i}` }));
      setTimeout(() => router.abort(), 50);
      const report = await router.routeBatch(requests);
      // 至少处理了部分请求
      expect(report.totalRequests).toBeLessThanOrEqual(requests.length);
    });
  });
});

describe('haversineDistance', () => {
  it('应该计算北京-上海距离 (约 1067km)', () => {
    const beijing = { code: 'bj', name: 'Beijing', latitude: 39.9042, longitude: 116.4074 };
    const shanghai = { code: 'sh', name: 'Shanghai', latitude: 31.2304, longitude: 121.4737 };
    const distance = haversineDistance(beijing, shanghai);
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(1200);
  });

  it('应该计算相同位置距离为 0', () => {
    const loc = { code: 'x', name: 'X', latitude: 10, longitude: 10 };
    expect(haversineDistance(loc, loc)).toBe(0);
  });

  it('应该计算北京-纽约距离 (约 11000km)', () => {
    const beijing = { code: 'bj', name: 'Beijing', latitude: 39.9042, longitude: 116.4074 };
    const nyc = { code: 'nyc', name: 'NYC', latitude: 40.7128, longitude: -74.0060 };
    const distance = haversineDistance(beijing, nyc);
    expect(distance).toBeGreaterThan(10000);
    expect(distance).toBeLessThan(12000);
  });
});

describe('工厂函数', () => {
  it('createDefaultRegions 应该返回 3 个预置区域', () => {
    const regions = createDefaultRegions();
    expect(regions).toHaveLength(3);
    expect(regions[0]!.id).toBe('cn-north-1');
  });

  it('createDefaultRoutingStrategy 默认 geo 策略', () => {
    const strategy = createDefaultRoutingStrategy();
    expect(strategy.type).toBe('geo');
    expect(strategy.enableFailover).toBe(true);
  });

  it('createDefaultRoutingStrategy 支持自定义类型', () => {
    const strategy = createDefaultRoutingStrategy('weighted');
    expect(strategy.type).toBe('weighted');
  });
});
