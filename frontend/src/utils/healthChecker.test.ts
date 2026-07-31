/**
 * # ============================================================
 * # HealthChecker 测试
 * # ============================================================
 * # 核心作用：验证健康检查器的所有功能
 * # 测试维度：
 * #   1. 基础健康检查 (端点)
 * #   2. 重试机制
 * #   3. 自定义检查
 * #   4. 必选 vs 可选服务
 * #   5. 报告生成
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HealthChecker,
  createHealthChecker,
  createDefaultStackConfig,
  exportHealthReportMarkdown,
  type HealthCheckReport,
  type ServiceCheckResult,
} from './healthChecker';

// ============================================================
// 测试辅助: Mock fetch
// ============================================================

interface MockResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: string;
}

function createMockFetch(responses: Map<string, MockResponse | ((url: string) => MockResponse)>): typeof fetch {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    let res: MockResponse | undefined;
    for (const [pattern, r] of responses) {
      if (urlStr.includes(pattern)) {
        res = typeof r === 'function' ? r(urlStr) : r;
        break;
      }
    }
    if (!res) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(res.body ?? '', { status: res.status, statusText: res.statusText ?? '' });
  }) as unknown as typeof fetch;
}

// ============================================================
// 基础功能测试
// ============================================================

describe('HealthChecker', () => {
  describe('基础功能', () => {
    it('应该创建空实例', () => {
      const checker = createHealthChecker();
      expect(checker).toBeInstanceOf(HealthChecker);
    });

    it('应该添加服务', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: true, status: 200 }],
        ])),
      });
      checker.addService({
        name: 'test',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
      });
      const report = await checker.checkAll();
      expect(report.totalServices).toBe(1);
      expect(report.passedServices).toBe(1);
    });

    it('无服务时应该返回空报告', async () => {
      const checker = createHealthChecker();
      const report = await checker.checkAll();
      expect(report.totalServices).toBe(0);
      expect(report.overallPassed).toBe(true);
    });
  });

  // ============================================================
  // 端点检查测试
  // ============================================================

  describe('端点检查', () => {
    it('健康端点 200 应该通过', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: true, status: 200 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost:8080',
        healthPath: '/healthz',
        required: true,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(true);
      expect(report.services[0]?.endpointChecks[0]?.statusCode).toBe(200);
    });

    it('健康端点 500 应该失败', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost:8000',
        healthPath: '/healthz',
        required: true,
        retries: 1, // 减少重试以加快测试
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(false);
      expect(report.overallPassed).toBe(false);
    });

    it('健康端点 404 应该失败', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: false, status: 404 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost:8000',
        healthPath: '/healthz',
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(false);
    });

    it('应该检查所有 criticalPaths', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: true, status: 200 }],
          ['/api', { ok: true, status: 200 }],
          ['/metrics', { ok: true, status: 200 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost:8000',
        healthPath: '/healthz',
        criticalPaths: ['/api/v1', '/api/metrics'],
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.endpointChecks.length).toBe(3);
    });

    it('URL 拼接应该正确处理尾部斜杠', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: true, status: 200 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost:8080/', // 尾部斜杠
        healthPath: '/healthz',
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(true);
    });
  });

  // ============================================================
  // 重试机制测试
  // ============================================================

  describe('重试机制', () => {
    it('应该重试失败的端点', async () => {
      let count = 0;
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        count++;
        if (count < 3) {
          return new Response('Error', { status: 500 });
        }
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch;
      const checker = createHealthChecker({ fetchImpl });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 3,
        retryDelayMs: 10,
      });
      const report = await checker.checkAll();
      expect(count).toBe(3); // 失败 2 次 + 成功 1 次
      expect(report.services[0]?.passed).toBe(true);
    });

    it('所有重试失败后应该报告失败', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => new Response('Error', { status: 500 })) as unknown as typeof fetch;
      const checker = createHealthChecker({ fetchImpl });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 2,
        retryDelayMs: 10,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(false);
      expect(report.services[0]?.error).toContain('Health endpoint failed');
    });

    it('fetch 抛错应该被捕获', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        throw new Error('Network error');
      }) as unknown as typeof fetch;
      const checker = createHealthChecker({ fetchImpl });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
        retryDelayMs: 10,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(false);
    });
  });

  // ============================================================
  // 自定义检查测试
  // ============================================================

  describe('自定义检查', () => {
    it('应该执行自定义检查并通过', async () => {
      const checker = createHealthChecker();
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        retries: 1,
        customChecks: [
          {
            name: 'check-config',
            description: '配置文件正确',
            check: async () => ({ passed: true, durationMs: 1, details: { config: 'ok' } }),
          },
        ],
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.customCheckResults.length).toBe(1);
      expect(report.services[0]?.customCheckResults[0]?.passed).toBe(true);
    });

    it('自定义检查失败应该标记服务失败', async () => {
      const checker = createHealthChecker();
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        retries: 1,
        customChecks: [
          {
            name: 'check-config',
            description: '配置文件',
            check: async () => ({ passed: false, durationMs: 1, error: 'Config missing' }),
          },
        ],
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(false);
    });

    it('自定义检查抛错应该被捕获', async () => {
      const checker = createHealthChecker();
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        retries: 1,
        customChecks: [
          {
            name: 'check-throw',
            description: '抛错测试',
            check: async () => { throw new Error('Test error'); },
          },
        ],
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.customCheckResults[0]?.passed).toBe(false);
      expect(report.services[0]?.customCheckResults[0]?.error).toBe('Test error');
    });

    it('应该支持多个自定义检查', async () => {
      const checker = createHealthChecker();
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        retries: 1,
        customChecks: [
          { name: 'c1', description: 'c1', check: async () => ({ passed: true, durationMs: 1 }) },
          { name: 'c2', description: 'c2', check: async () => ({ passed: true, durationMs: 1 }) },
          { name: 'c3', description: 'c3', check: async () => ({ passed: false, durationMs: 1, error: 'c3 failed' }) },
        ],
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.customCheckResults.length).toBe(3);
      expect(report.services[0]?.passed).toBe(false);
    });

    it('应该跨检查共享 state', async () => {
      const checker = createHealthChecker();
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        retries: 1,
        customChecks: [
          {
            name: 'set',
            description: 'set',
            check: async (ctx) => {
              ctx.state.set('token', 'abc');
              return { passed: true, durationMs: 1 };
            },
          },
          {
            name: 'get',
            description: 'get',
            check: async (ctx) => {
              const token = ctx.state.get('token');
              return { passed: token === 'abc', durationMs: 1, details: { token } };
            },
          },
        ],
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(true);
    });
  });

  // ============================================================
  // 必选 vs 可选服务测试
  // ============================================================

  describe('必选 vs 可选服务', () => {
    it('必选服务失败应该导致 overallPassed = false', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'critical',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        required: true,
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.overallPassed).toBe(false);
      expect(report.criticalFailures).toBe(1);
    });

    it('可选服务失败不应该导致 overallPassed = false', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: true, status: 200 }],
          ['/grafana', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'critical',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        required: true,
        retries: 1,
      });
      checker.addService({
        name: 'optional',
        type: 'monitoring',
        baseUrl: 'http://localhost',
        healthPath: '/grafana',
        required: false,
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.overallPassed).toBe(true);
      expect(report.criticalFailures).toBe(0);
      expect(report.failedServices).toBe(1);
    });

    it('默认服务应该是必选', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
        // 未设置 required
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.required).toBe(true);
    });
  });

  // ============================================================
  // 报告生成测试
  // ============================================================

  describe('报告生成', () => {
    it('summary 应该在整体通过时显示 HEALTHY', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: true, status: 200 }]])),
      });
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        required: true,
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.summary).toContain('HEALTHY');
      expect(report.summary).toContain('1/1');
    });

    it('summary 应该在失败时列出失败服务', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz-a', { ok: true, status: 200 }],
          ['/healthz-b', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'svc-a',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz-a',
        required: true,
        retries: 1,
      });
      checker.addService({
        name: 'svc-b',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz-b',
        required: true,
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.summary).toContain('UNHEALTHY');
      expect(report.summary).toContain('svc-b');
    });

    it('recommendations 应该为失败服务生成建议', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { ok: false, status: 500 }],
        ])),
      });
      checker.addService({
        name: 'backend-svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain('backend-svc');
    });

    it('导出 Markdown 应该包含所有必要信息', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: true, status: 200 }]])),
      });
      checker.addService({
        name: 'frontend-svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        required: true,
        retries: 1,
      });
      const report = await checker.checkAll();
      const md = exportHealthReportMarkdown(report);
      expect(md).toContain('# 部署健康检查报告');
      expect(md).toContain('HEALTHY');
      expect(md).toContain('frontend-svc');
      expect(md).toContain('/healthz');
    });
  });

  // ============================================================
  // 事件订阅测试
  // ============================================================

  describe('事件订阅', () => {
    it('应该触发 start 事件', async () => {
      const events: string[] = [];
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: true, status: 200 }]])),
      });
      checker.subscribe((e) => events.push(e.type));
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      await checker.checkAll();
      expect(events).toContain('start');
      expect(events).toContain('complete');
    });

    it('应该触发 service-pass 事件', async () => {
      const events: Array<{ type: string; service?: string }> = [];
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: true, status: 200 }]])),
      });
      checker.subscribe((e) => events.push(e));
      checker.addService({
        name: 'my-svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      await checker.checkAll();
      const passEvent = events.find((e) => e.type === 'service-pass');
      expect(passEvent).toBeDefined();
      if (passEvent && 'service' in passEvent) {
        expect(passEvent.service).toBe('my-svc');
      }
    });

    it('应该触发 service-fail 事件', async () => {
      const events: Array<{ type: string; service?: string; error?: string }> = [];
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: false, status: 500 }]])),
      });
      checker.subscribe((e) => events.push(e as any));
      checker.addService({
        name: 'my-svc',
        type: 'backend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      await checker.checkAll();
      const failEvent = events.find((e) => e.type === 'service-fail');
      expect(failEvent).toBeDefined();
      if (failEvent) {
        expect(failEvent.service).toBe('my-svc');
      }
    });

    it('应该能取消订阅', async () => {
      const events: string[] = [];
      const checker = createHealthChecker();
      const unsub = checker.subscribe((e) => events.push(e.type));
      unsub();
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      await checker.checkAll();
      expect(events).toHaveLength(0);
    });

    it('listener 抛错不应该中断检查', async () => {
      const checker = createHealthChecker({
        fetchImpl: createMockFetch(new Map([['/healthz', { ok: true, status: 200 }]])),
      });
      checker.subscribe(() => { throw new Error('Listener error'); });
      checker.addService({
        name: 'svc',
        type: 'frontend',
        baseUrl: 'http://localhost',
        healthPath: '/healthz',
        retries: 1,
      });
      const report = await checker.checkAll();
      expect(report.services[0]?.passed).toBe(true);
    });
  });

  // ============================================================
  // 默认栈配置测试
  // ============================================================

  describe('默认栈配置', () => {
    it('应该创建 5 个默认服务', () => {
      const services = createDefaultStackConfig();
      expect(services.length).toBe(5);
      const types = services.map((s) => s.type);
      expect(types).toContain('frontend');
      expect(types).toContain('backend');
      expect(types).toContain('database');
      expect(types).toContain('monitoring');
    });

    it('frontend 和 backend 应该是必选', () => {
      const services = createDefaultStackConfig();
      const frontend = services.find((s) => s.name === 'frontend');
      const backend = services.find((s) => s.name === 'backend');
      expect(frontend?.required).toBe(true);
      expect(backend?.required).toBe(true);
    });

    it('postgres 应该是可选', () => {
      const services = createDefaultStackConfig();
      const postgres = services.find((s) => s.name === 'postgres');
      expect(postgres?.required).toBe(false);
    });

    it('应该支持自定义 baseHost', () => {
      const services = createDefaultStackConfig('myhost');
      const frontend = services.find((s) => s.name === 'frontend');
      expect(frontend?.baseUrl).toContain('myhost');
    });
  });
});
