/**
 * # ============================================================
 * # E2EFlowValidator 测试
 * # ============================================================
 * # 核心作用：验证 E2E 流程验证器
 * # 测试维度：
 * #   1. 基础流程执行
 * #   2. 多种步骤类型
 * #   3. 响应验证
 #   4. 跳过步骤
 *   5. 错误处理
 * ====================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  E2EFlowValidator,
  createE2EFlowValidator,
  createFullStackFlow,
  createSmokeTestFlow,
  exportE2EFlowReportMarkdown,
  type E2EFlow,
  type E2EStep,
} from './e2eFlowValidator';

// ============================================================
// Mock fetch 工厂
// ============================================================

function createMockFetch(responses: Map<string, { status: number; body: string }>): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, r] of responses) {
      if (urlStr.includes(pattern)) {
        return new Response(r.body, { status: r.status });
      }
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

// ============================================================
// 基础测试
// ============================================================

describe('E2EFlowValidator', () => {
  describe('基础功能', () => {
    it('应该创建实例', () => {
      const validator = createE2EFlowValidator();
      expect(validator).toBeInstanceOf(E2EFlowValidator);
    });

    it('无步骤流程应该通过', async () => {
      const validator = createE2EFlowValidator();
      const flow: E2EFlow = {
        name: 'empty',
        description: '空流程',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [],
      };
      const report = await validator.runFlow(flow);
      expect(report.totalSteps).toBe(0);
      expect(report.overallPassed).toBe(true);
    });
  });

  // ============================================================
  // 步骤执行测试
  // ============================================================

  describe('步骤执行', () => {
    it('GET 步骤应该执行', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { status: 200, body: 'ok' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'health',
          method: 'GET', path: '/healthz', expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(true);
      expect(report.steps[0]?.statusCode).toBe(200);
    });

    it('POST 步骤应该执行', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/api/rag', { status: 200, body: '{"result":[]}' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'r', type: 'api-rag', description: 'rag',
          method: 'POST', path: '/api/rag/search',
          body: { query: 'test' }, expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(true);
    });

    it('预期状态码不匹配应该失败', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/api/rag', { status: 500, body: 'error' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'r', type: 'api-rag', description: 'rag',
          method: 'POST', path: '/api/rag/search',
          body: {}, expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(false);
      expect(report.steps[0]?.error).toContain('Expected status 200, got 500');
    });

    it('支持多个预期状态码', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/api/x', { status: 404, body: '' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'x', type: 'api-health', description: 'x',
          path: '/api/x', expectedStatus: [200, 404],
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(true);
      expect(report.steps[0]?.statusCode).toBe(404);
    });

    it('fetch 抛错应该捕获', async () => {
      const fetchImpl = vi.fn(async (): Promise<Response> => {
        throw new Error('Network down');
      }) as unknown as typeof fetch;
      const validator = createE2EFlowValidator({ fetchImpl });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'h',
          path: '/healthz',
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(false);
      expect(report.steps[0]?.error).toBe('Network down');
    });
  });

  // ============================================================
  // 响应验证测试
  // ============================================================

  describe('响应验证', () => {
    it('validateResponse 失败应该标记步骤失败', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/x', { status: 200, body: 'plain text' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'v', type: 'frontend-root', description: 'v',
          path: '/x', expectedStatus: 200,
          validateResponse: async () => '响应不是 HTML',
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(false);
      expect(report.steps[0]?.validationError).toBe('响应不是 HTML');
    });

    it('validateResponse 通过应该标记步骤通过', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/x', { status: 200, body: '<html><body>OK</body></html>' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'v', type: 'frontend-root', description: 'v',
          path: '/x', expectedStatus: 200,
          validateResponse: async (_res, body) => body.includes('<html') ? null : 'not html',
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.steps[0]?.passed).toBe(true);
    });
  });

  // ============================================================
  // 跳过步骤测试
  // ============================================================

  describe('跳过步骤', () => {
    it('skip: true 的步骤应该标记为跳过', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map()),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [
          { id: 's', type: 'custom', description: 'skipped', path: '/x', skip: true },
        ],
      };
      const report = await validator.runFlow(flow);
      expect(report.skippedSteps).toBe(1);
      expect(report.steps[0]?.durationMs).toBe(0);
    });
  });

  // ============================================================
  // 报告测试
  // ============================================================

  describe('报告生成', () => {
    it('summary 应该在所有步骤通过时显示 PASSED', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { status: 200, body: 'ok' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'health',
        description: 'health check',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'h',
          path: '/healthz', expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.summary).toContain('PASSED');
    });

    it('summary 应该在失败时显示 FAILED', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/x', { status: 500, body: 'error' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'x', type: 'custom', description: 'x',
          path: '/x', expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.summary).toContain('FAILED');
    });

    it('recommendations 应该为失败步骤生成建议', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { status: 500, body: 'fail' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'frontend-h', type: 'frontend-healthz', description: 'h',
          path: '/healthz',
        }],
      };
      const report = await validator.runFlow(flow);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain('前端');
    });

    it('导出 Markdown 应该包含所有信息', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { status: 200, body: 'ok' }],
        ])),
      });
      const flow: E2EFlow = {
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost:8080',
        backendBaseUrl: 'http://localhost:8000',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'health check',
          path: '/healthz', expectedStatus: 200,
        }],
      };
      const report = await validator.runFlow(flow);
      const md = exportE2EFlowReportMarkdown(report);
      expect(md).toContain('E2E 流程验证报告');
      expect(md).toContain('health check');
      expect(md).toContain('PASSED');
    });
  });

  // ============================================================
  // 事件订阅测试
  // ============================================================

  describe('事件订阅', () => {
    it('应该触发 flow-start 事件', async () => {
      const events: string[] = [];
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([['/x', { status: 200, body: '' }]])),
      });
      validator.subscribe((e) => events.push(e.type));
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost',
        backendBaseUrl: 'http://localhost',
        steps: [{ id: 'x', type: 'custom', description: 'x', path: '/x' }],
      });
      expect(events).toContain('flow-start');
      expect(events).toContain('step-complete');
      expect(events).toContain('flow-complete');
    });

    it('应该能取消订阅', async () => {
      const events: string[] = [];
      const validator = createE2EFlowValidator();
      const unsub = validator.subscribe((e) => events.push(e.type));
      unsub();
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost',
        backendBaseUrl: 'http://localhost',
        steps: [],
      });
      expect(events).toHaveLength(0);
    });
  });

  // ============================================================
  // 预定义流程测试
  // ============================================================

  describe('预定义流程', () => {
    it('createSmokeTestFlow 应该返回 2 个步骤', () => {
      const flow = createSmokeTestFlow('http://localhost:8080', 'http://localhost:8000');
      expect(flow.steps.length).toBe(2);
      expect(flow.steps[0]?.type).toBe('frontend-healthz');
      expect(flow.steps[1]?.type).toBe('api-health');
    });

    it('createFullStackFlow 应该返回多个步骤', () => {
      const flow = createFullStackFlow('http://localhost:8080', 'http://localhost:8000');
      expect(flow.steps.length).toBeGreaterThan(5);
      const types = flow.steps.map((s) => s.type);
      expect(types).toContain('frontend-root');
      expect(types).toContain('api-health');
      expect(types).toContain('api-rag');
      expect(types).toContain('api-volcengine');
      expect(types).toContain('cors-preflight');
    });

    it('createSmokeTestFlow 应该能运行', async () => {
      const validator = createE2EFlowValidator({
        fetchImpl: createMockFetch(new Map([
          ['/healthz', { status: 200, body: 'ok' }],
          ['/health', { status: 200, body: '{"status":"ok"}' }],
        ])),
      });
      const flow = createSmokeTestFlow('http://localhost:8080', 'http://localhost:8000');
      const report = await validator.runFlow(flow);
      expect(report.overallPassed).toBe(true);
    });
  });

  // ============================================================
  // 多种步骤类型测试
  // ============================================================

  describe('多种步骤类型', () => {
    it('前端步骤应该用 frontendBaseUrl', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        calls.push(urlStr);
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const validator = createE2EFlowValidator({ fetchImpl });
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://frontend:8080',
        backendBaseUrl: 'http://backend:8000',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'h',
          path: '/healthz', expectedStatus: 200,
        }],
      });
      expect(calls[0]).toContain('frontend:8080');
    });

    it('后端步骤应该用 backendBaseUrl', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        calls.push(urlStr);
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const validator = createE2EFlowValidator({ fetchImpl });
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://frontend:8080',
        backendBaseUrl: 'http://backend:8000',
        steps: [{
          id: 'h', type: 'api-health', description: 'h',
          path: '/health', expectedStatus: 200,
        }],
      });
      expect(calls[0]).toContain('backend:8000');
    });

    it('OPTIONS 预检请求应该不带 body', async () => {
      const calls: Array<{ method?: string; body?: BodyInit | null }> = [];
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ method: init?.method, body: init?.body });
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch;
      const validator = createE2EFlowValidator({ fetchImpl });
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost',
        backendBaseUrl: 'http://localhost',
        steps: [{
          id: 'cors', type: 'cors-preflight', description: 'cors',
          method: 'OPTIONS', path: '/api/x', expectedStatus: 204,
          body: { dummy: true },
        }],
      });
      expect(calls[0]?.method).toBe('OPTIONS');
      expect(calls[0]?.body).toBeUndefined();
    });
  });

  // ============================================================
  // URL 处理测试
  // ============================================================

  describe('URL 处理', () => {
    it('应该处理 baseUrl 尾部斜杠', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
        calls.push(typeof url === 'string' ? url : url.toString());
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;
      const validator = createE2EFlowValidator({ fetchImpl });
      await validator.runFlow({
        name: 'test',
        description: 'test',
        frontendBaseUrl: 'http://localhost/', // 尾部斜杠
        backendBaseUrl: 'http://localhost/',
        steps: [{
          id: 'h', type: 'frontend-healthz', description: 'h',
          path: '/healthz',
        }],
      });
      expect(calls[0]).toBe('http://localhost/healthz');
    });
  });
});
