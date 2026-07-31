/**
 * # ============================================================
 * # LoadTester 测试
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  LoadTester,
  createLoadTester,
  exportPerfReportMarkdown,
  computePercentile,
} from './loadTester';

describe('LoadTester', () => {
  describe('基础功能', () => {
    it('应该创建实例', () => {
      const tester = createLoadTester();
      expect(tester).toBeInstanceOf(LoadTester);
    });

    it('应该执行基本压测', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        await new Promise((r) => setTimeout(r, 1));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost:8080/healthz',
        connections: 2,
        durationMs: 100,
        fetchImpl,
      });
      expect(report.totalRequests).toBeGreaterThan(0);
      expect(report.successfulRequests).toBe(report.totalRequests);
      expect(report.errorRate).toBe(0);
    });

    it('应该正确处理错误请求', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        return new Response('error', { status: 500 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost:8080/api/x',
        connections: 1,
        durationMs: 50,
        fetchImpl,
      });
      expect(report.errorRate).toBeGreaterThan(0);
      expect(report.statusCodeDistribution[500]).toBeGreaterThan(0);
    });

    it('应该捕获 fetch 抛错', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        throw new Error('Network down');
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost:8080/x',
        connections: 1,
        durationMs: 30,
        fetchImpl,
      });
      expect(report.errorRate).toBe(1);
      expect(report.errors[0]?.error).toBe('Network down');
    });
  });

  describe('并发控制', () => {
    it('应该并行运行多个连接', async () => {
      let active = 0;
      let maxActive = 0;
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      await tester.run({
        url: 'http://localhost/x',
        connections: 5,
        durationMs: 50,
        fetchImpl,
      });
      expect(maxActive).toBeGreaterThan(1);
    });
  });

  describe('预热阶段', () => {
    it('应该执行预热', async () => {
      let callCount = 0;
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        callCount++;
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 50,
        warmupMs: 30,
        fetchImpl,
      });
      // 预热阶段的请求不应计入 totalRequests
      expect(callCount).toBeGreaterThan(report.totalRequests);
    });
  });

  describe('中断信号', () => {
    it('应该响应 abort 信号', async () => {
      const controller = new AbortController();
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        await new Promise((r) => setTimeout(r, 100));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      setTimeout(() => controller.abort(), 30);
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 10000,
        signal: controller.signal,
        fetchImpl,
      });
      // 压测被中断, 请求数应该少于正常 10s 应有数量
      expect(report.actualDurationMs).toBeLessThan(1000);
    });
  });

  describe('进度回调', () => {
    it('应该调用 onProgress 回调', async () => {
      const progresses: number[] = [];
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 100,
        fetchImpl,
        onProgress: (p) => progresses.push(p.percent),
      });
      expect(progresses.length).toBeGreaterThan(0);
      expect(progresses[progresses.length - 1]).toBeGreaterThanOrEqual(80);
    });
  });

  describe('POST 请求', () => {
    it('应该支持 POST 方法和 body', async () => {
      let receivedBody: string | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        receivedBody = init?.body as string;
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      await tester.run({
        url: 'http://localhost/api/rag',
        method: 'POST',
        body: { query: 'test' },
        connections: 1,
        durationMs: 30,
        fetchImpl,
      });
      expect(receivedBody).toBe(JSON.stringify({ query: 'test' }));
    });

    it('GET 请求不应该有 body', async () => {
      let receivedBody: BodyInit | null | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        receivedBody = init?.body;
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      await tester.run({
        url: 'http://localhost/api/x',
        method: 'GET',
        body: { should: 'ignore' },
        connections: 1,
        durationMs: 30,
        fetchImpl,
      });
      expect(receivedBody).toBeUndefined();
    });
  });

  describe('期望检查', () => {
    it('expectedQps 不满足时应该报告失败', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        await new Promise((r) => setTimeout(r, 50));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 50,
        expectedQps: 10000, // 期望 10000 QPS
        fetchImpl,
      });
      expect(report.passed).toBe(false);
      expect(report.expectationResults.some((r) => r.metric === 'qps' && !r.passed)).toBe(true);
    });

    it('expectedP95Ms 不满足时应该报告失败', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        await new Promise((r) => setTimeout(r, 100));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 30,
        expectedP95Ms: 1, // 期望 P95 < 1ms (不可能)
        fetchImpl,
      });
      expect(report.passed).toBe(false);
    });

    it('maxErrorRate 不满足时应该报告失败', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        return new Response('error', { status: 500 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 30,
        maxErrorRate: 0, // 零容忍
        fetchImpl,
      });
      expect(report.passed).toBe(false);
    });

    it('所有期望满足时应该通过', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 2,
        durationMs: 50,
        expectedQps: 1,
        expectedP95Ms: 1000,
        maxErrorRate: 1,
        fetchImpl,
      });
      expect(report.passed).toBe(true);
    });
  });

  describe('报告生成', () => {
    it('应该正确计算 QPS', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 100,
        fetchImpl,
      });
      expect(report.qps).toBeGreaterThan(0);
    });

    it('应该正确计算 P95/P99', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 2,
        durationMs: 100,
        fetchImpl,
      });
      expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
      expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
    });

    it('应该生成 Markdown 报告', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => new Response('ok', { status: 200 })) as unknown as typeof fetch;
      const tester = createLoadTester();
      const report = await tester.run({
        url: 'http://localhost/x',
        connections: 1,
        durationMs: 50,
        fetchImpl,
      });
      const md = exportPerfReportMarkdown(report);
      expect(md).toContain('性能压测报告');
      expect(md).toContain('QPS');
      expect(md).toContain('P95');
    });
  });

  describe('百分位计算', () => {
    it('空数组应该返回 0', () => {
      expect(computePercentile([], 50)).toBe(0);
    });

    it('单元素数组应该返回该元素', () => {
      expect(computePercentile([5], 50)).toBe(5);
      expect(computePercentile([5], 95)).toBe(5);
    });

    it('应该正确计算 P50', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      // 线性插值: rank = 0.5 * 9 = 4.5, values[4]*0.5 + values[5]*0.5 = 5*0.5 + 6*0.5 = 5.5
      expect(computePercentile(values, 50)).toBe(5.5);
    });

    it('应该正确计算 P95', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = computePercentile(values, 95);
      expect(p95).toBeGreaterThanOrEqual(94);
      expect(p95).toBeLessThanOrEqual(100);
    });
  });
});
