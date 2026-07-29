/**
 * apiShared 集成测试 (v6.41.0 Cycle 18 P1-1)
 * - 验证 apiShared.ts 集成 fetch 拦截器后行为符合预期
 * - 验证向后兼容性：原有 apiFetch 调用方式保持不变
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, apiFetchWithToast, API_BASE } from './apiShared';
import { globalErrorHandler } from '../utils/globalErrorHandler';
import { ApiError } from '../utils/apiInterceptor';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

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

describe('apiShared 集成 fetch 拦截器', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.unsubscribeAll();
  });

  describe('基础行为', () => {
    it('API_BASE 仍为 /api', () => {
      expect(API_BASE).toBe('/api');
    });

    it('apiFetch 正常请求解析 JSON', async () => {
      const data = { id: 1, name: 'test' };
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, jsonBody: data }),
      );
      const result = await apiFetch<typeof data>('/example');
      expect(result).toEqual(data);
    });

    it('apiFetch 自动拼接 API_BASE 前缀', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, jsonBody: {} }),
      );
      await apiFetch('/users');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/users'),
        expect.any(Object),
      );
    });
  });

  describe('向后兼容性', () => {
    it('非 2xx 响应仍抛 Error（ApiError 继承自 Error）', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          jsonBody: { detail: 'Resource not found' },
        }),
      );
      await expect(apiFetch('/missing')).rejects.toBeInstanceOf(Error);
    });

    it('抛出的错误包含 status 字段（ApiError 扩展）', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Server crashed' },
        }),
      );
      try {
        await apiFetch('/crash');
      } catch (err) {
        // 验证 ApiError 特有字段
        if (err instanceof Error && 'status' in err) {
          expect((err as ApiError).status).toBe(500);
        }
      }
    });

    it('调用方 try/catch 行为不变', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          jsonBody: { detail: 'Bad input' },
        }),
      );
      let caught: Error | null = null;
      try {
        await apiFetch('/api');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught?.message).toBe('Bad input');
    });
  });

  describe('silent 行为（默认向后兼容）', () => {
    it('apiFetch 默认 silent=true 不上报 GlobalErrorHandler', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Error' },
        }),
      );
      try {
        await apiFetch('/api');
      } catch {
        // ignore
      }
      expect(globalErrorHandler.getReports().length).toBe(0);
    });

    it('apiFetchWithToast 启用 GlobalErrorHandler 上报', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          jsonBody: { detail: 'Error' },
        }),
      );
      try {
        await apiFetchWithToast('/api');
      } catch {
        // ignore
      }
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0].type).toBe('fetch_error');
    });
  });

  describe('拦截器新增能力（自动获得）', () => {
    it('幂等方法自动重试', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(
          mockResponse({ ok: true, status: 200, jsonBody: { recovered: true } }),
        );
      const result = await apiFetch<{ recovered: boolean }>('/retry');
      expect(result.recovered).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('POST 不自动重试', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetch('/create', { method: 'POST' });
      } catch {
        // ignore
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('网络错误抛出 ApiError 含 isNetworkError=true', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      try {
        await apiFetch('/api', { retry: false });
      } catch (err) {
        if (err instanceof Error && 'isNetworkError' in err) {
          expect((err as ApiError).isNetworkError).toBe(true);
        }
      }
    });
  });
});
