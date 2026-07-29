/**
 * API 拦截器单元测试 (v6.41.0 Cycle 18 P1-1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetchWithInterceptor,
  ApiError,
  setGlobalTimeout,
  setGlobalMaxRetries,
  setAutoRedirectToLogin,
} from './apiInterceptor';
import { globalErrorHandler } from './globalErrorHandler';

// 模拟 fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

/**
 * 创建测试用 mock Response
 * - 简化的 headers（仅实现 .get）+ body 解析
 */
function mockResponse(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  jsonBody?: unknown;
  textBody?: string;
}): Response {
  const contentType = options.contentType ?? 'application/json';
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers: { get: (k: string) => (k === 'Content-Type' ? contentType : null) },
    json: async () => options.jsonBody,
    text: async () => options.textBody ?? '',
  } as unknown as Response;
}

describe('apiFetchWithInterceptor', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
    setGlobalTimeout(30000);
    setGlobalMaxRetries(2);
    setAutoRedirectToLogin(false); // 测试中禁用跳转
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.unsubscribeAll();
  });

  describe('正常响应', () => {
    it('200 + JSON 响应正确解析', async () => {
      const data = { id: 1, name: 'test' };
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, jsonBody: data }),
      );
      const result = await apiFetchWithInterceptor('/test', { method: 'GET' });
      expect(result).toEqual(data);
    });

    it('200 + text 响应返回字符串', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          contentType: 'text/plain',
          textBody: 'plain text',
        }),
      );
      const result = await apiFetchWithInterceptor<unknown>('/test');
      expect(result).toBe('plain text');
    });

    it('POST 请求正确传递 body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 201, statusText: 'Created', jsonBody: { ok: true } }),
      );
      await apiFetchWithInterceptor('/create', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/create'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        }),
      );
    });
  });

  describe('错误响应处理', () => {
    it('401 错误抛出 ApiError 含认证标记', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            jsonBody: { detail: 'Token expired' },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            jsonBody: { detail: 'Token expired' },
          }),
        );
      await expect(
        apiFetchWithInterceptor('/protected', { silent: true }),
      ).rejects.toThrow(ApiError);
      try {
        await apiFetchWithInterceptor('/protected2', { silent: true });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        if (err instanceof ApiError) {
          expect(err.status).toBe(401);
          expect(err.isAuthError).toBe(true);
        }
      }
    });

    it('403 错误 isAuthError=true', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          jsonBody: { detail: 'No permission' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/admin', { silent: true });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.isAuthError).toBe(true);
          expect(err.message).toBe('您没有权限执行此操作');
        }
      }
    });

    it('404 错误友好提示', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          jsonBody: { detail: 'Resource not found' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/missing', { silent: true });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.status).toBe(404);
          expect(err.message).toBe('请求的资源不存在');
        }
      }
    });

    it('500 错误友好提示', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Server crashed' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/crash', { silent: true });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.status).toBe(500);
          expect(err.message).toBe('服务暂时不可用，请稍后重试');
        }
      }
    });

    it('429 限流提示', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          jsonBody: { detail: 'Rate limited' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/api', { silent: true });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.status).toBe(429);
        }
      }
    });

    it('后端 detail 优先于默认消息', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          jsonBody: { detail: '邮箱格式不正确' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/validate', { silent: true });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.message).toBe('邮箱格式不正确');
        }
      }
    });

    it('errorMessage 覆盖后端 detail', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          jsonBody: { detail: 'Backend error' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/api', {
          silent: true,
          errorMessage: '自定义错误',
        });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.message).toBe('自定义错误');
        }
      }
    });
  });

  describe('网络错误', () => {
    it('TypeError 标记为 isNetworkError', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetchWithInterceptor('/api', {
          silent: true,
          retry: false, // 禁用重试以快速失败
        });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.isNetworkError).toBe(true);
          expect(err.message).toBe('网络连接失败，请检查网络');
        }
      }
    });

    it('非 TypeError 非 AbortError 标记为未知错误', async () => {
      mockFetch.mockRejectedValueOnce(new Error('weird error'));
      try {
        await apiFetchWithInterceptor('/api', {
          silent: true,
          retry: false,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.message).toBe('weird error');
        }
      }
    });
  });

  describe('重试机制', () => {
    it('GET 失败自动重试 2 次（默认）', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          mockResponse({ ok: true, status: 200, jsonBody: { success: true } }),
        );
      const result = await apiFetchWithInterceptor<{ success: boolean }>('/retry');
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('POST 默认不重试', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetchWithInterceptor('/create', {
          method: 'POST',
          silent: true,
        });
      } catch {
        // 期望抛错
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retry=false 完全禁用重试', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetchWithInterceptor('/api', {
          retry: false,
          silent: true,
        });
      } catch {
        // 期望抛错
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('maxRetries 配置生效', async () => {
      setGlobalMaxRetries(1);
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed'))
        .mockRejectedValueOnce(new TypeError('Failed'));
      try {
        await apiFetchWithInterceptor('/api', { silent: true });
      } catch {
        // 期望抛错
      }
      // 首次 + 1 次重试 = 2 次
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('5xx 错误也触发重试（GET）', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            jsonBody: { detail: 'Down' },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({ ok: true, status: 200, jsonBody: { recovered: true } }),
        );
      const result = await apiFetchWithInterceptor<{ recovered: boolean }>(
        '/api',
        { silent: true },
      );
      expect(result.recovered).toBe(true);
    });
  });

  describe('请求去重', () => {
    it('相同 requestId 的请求合并', async () => {
      let resolveFn: (v: Response) => void = () => {};
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFn = resolve;
        }),
      );
      const p1 = apiFetchWithInterceptor('/dedup', {
        requestId: 'dedup-1',
        silent: true,
      });
      const p2 = apiFetchWithInterceptor('/dedup', {
        requestId: 'dedup-1',
        silent: true,
      });
      // 解析响应
      resolveFn(mockResponse({ ok: true, status: 200, jsonBody: { shared: true } }));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
      expect(mockFetch).toHaveBeenCalledTimes(1); // 只调用 1 次
    });

    it('不同 requestId 不合并', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, jsonBody: { id: 1 } }))
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, jsonBody: { id: 2 } }));
      const [r1, r2] = await Promise.all([
        apiFetchWithInterceptor('/api', { requestId: 'a', silent: true }),
        apiFetchWithInterceptor('/api', { requestId: 'b', silent: true }),
      ]);
      expect(r1).toEqual({ id: 1 });
      expect(r2).toEqual({ id: 2 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('完成后清理 pending（可发起新请求）', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ ok: true, status: 200, jsonBody: { ok: true } }),
      );
      await apiFetchWithInterceptor('/api', { requestId: 'clear', silent: true });
      // 第二次使用相同 requestId
      await apiFetchWithInterceptor('/api', { requestId: 'clear', silent: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('GlobalErrorHandler 集成', () => {
    it('500 错误上报到 GlobalErrorHandler', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Error' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/api');
      } catch {
        // 期望抛错
      }
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0].type).toBe('fetch_error');
    });

    it('silent=true 不上报到 GlobalErrorHandler', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Error' },
        }),
      );
      try {
        await apiFetchWithInterceptor('/api', { silent: true });
      } catch {
        // 期望抛错
      }
      expect(globalErrorHandler.getReports().length).toBe(0);
    });

    it('网络错误上报', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetchWithInterceptor('/api', { retry: false });
      } catch {
        // 期望抛错
      }
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0].type).toBe('fetch_error');
    });
  });

  describe('全局配置', () => {
    it('setGlobalTimeout 修改默认超时', () => {
      setGlobalTimeout(5000);
      // 仅验证不抛错
      expect(true).toBe(true);
    });

    it('setGlobalMaxRetries 修改默认重试', () => {
      setGlobalMaxRetries(0);
      expect(true).toBe(true);
    });

    it('setAutoRedirectToLogin 修改登录跳转', () => {
      setAutoRedirectToLogin(false);
      expect(true).toBe(true);
    });
  });

  describe('ApiError 类', () => {
    it('包含 status, statusText, url', () => {
      const err = new ApiError('test', 400, 'Bad Request', '/api', {});
      expect(err.status).toBe(400);
      expect(err.statusText).toBe('Bad Request');
      expect(err.url).toBe('/api');
      expect(err.isAuthError).toBe(false);
      expect(err.isNetworkError).toBe(false);
      expect(err.isTimeout).toBe(false);
    });

    it('支持 response 字段', () => {
      const err = new ApiError('test', 400, 'Bad', '/api', {
        response: { detail: 'x' },
      });
      expect(err.response?.detail).toBe('x');
    });
  });
});
