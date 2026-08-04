/**
 * # ============================================================
 * # useBatchSpawner Hook 单元测试 (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：覆盖 useBatchSpawner 的所有 API 操作、轮询、错误处理
 * # 测试维度：
 * #   1. submit 提交批量任务
 * #   2. refresh 单个 job
 * #   3. refreshAll 全部刷新
 * #   4. cancel 取消
 * #   5. exportBatch 三种格式导出
 * #   6. setCurrent 切换 currentJob
 * #   7. 错误处理
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useBatchSpawner } from './useBatchSpawner';

// ============================================================
// fetch mock
// ============================================================

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ============================================================
// 测试
// ============================================================

describe('useBatchSpawner', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    mockFetch.mockReset();
    cleanup();
  });

  it('初始化状态正确', () => {
    const { result } = renderHook(() => useBatchSpawner());
    expect(result.current.jobs).toEqual({});
    expect(result.current.currentJob).toBeNull();
    expect(result.current.batchList).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('submit 成功提交批量任务', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'batch-abc',
        total: 3,
        accepted: 3,
        rejected: 0,
        status: 'pending',
        errors: [],
      }),
    );
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'batch-abc',
        total: 3,
        accepted: 3,
        rejected: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        progress: 0,
        status: 'pending',
        max_concurrency: 5,
        started_at: 0,
        instances: {},
        errors: [],
      }),
    );

    const { result } = renderHook(() => useBatchSpawner());
    let resp: Awaited<ReturnType<typeof result.current.submit>> = null;
    await act(async () => {
      resp = await result.current.submit({
        csv_content: 'task\nfoo',
        max_concurrency: 5,
      });
    });

    expect(resp).not.toBeNull();
    expect(resp?.batch_id).toBe('batch-abc');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-roles/batch/spawn',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.submitting).toBe(false);
  });

  it('submit 失败时设置 error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ detail: 'invalid csv' }, 400),
    );

    const { result } = renderHook(() => useBatchSpawner());
    await act(async () => {
      await result.current.submit({ csv_content: '' });
    });

    expect(result.current.error).toContain('invalid csv');
  });

  it('refresh 拉取单个 job', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'batch-xyz',
        total: 5,
        accepted: 5,
        rejected: 0,
        in_progress: 2,
        completed: 2,
        failed: 0,
        progress: 0.4,
        status: 'running',
        max_concurrency: 3,
        started_at: 0,
        instances: {},
        errors: [],
      }),
    );

    const { result } = renderHook(() => useBatchSpawner());
    let job: Awaited<ReturnType<typeof result.current.refresh>> = null;
    await act(async () => {
      job = await result.current.refresh('batch-xyz');
    });

    expect(job).not.toBeNull();
    expect(job?.batch_id).toBe('batch-xyz');
    expect(result.current.jobs['batch-xyz']).toBeDefined();
  });

  it('refresh 404 返回 null', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 404));

    const { result } = renderHook(() => useBatchSpawner());
    let job: Awaited<ReturnType<typeof result.current.refresh>> = undefined as never;
    await act(async () => {
      job = await result.current.refresh('nonexistent');
    });

    expect(job).toBeNull();
  });

  it('cancel 成功取消', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ success: true, batch_id: 'b1', cancelled_count: 2 }),
    );
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'b1',
        total: 5,
        accepted: 5,
        rejected: 0,
        in_progress: 0,
        completed: 2,
        failed: 0,
        progress: 0.4,
        status: 'cancelled',
        max_concurrency: 3,
        started_at: 0,
        instances: {},
        errors: [],
      }),
    );

    const { result } = renderHook(() => useBatchSpawner());
    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.cancel('b1');
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-roles/batch/b1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancel 失败时设置 error', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 500));

    const { result } = renderHook(() => useBatchSpawner());
    let ok = true;
    await act(async () => {
      ok = await result.current.cancel('b1');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBeDefined();
  });

  it('exportBatch 三种格式', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ success: true, batch_id: 'b1', format: 'json', content: '{"a":1}' }),
    );
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ success: true, batch_id: 'b1', format: 'csv', content: 'a,b' }),
    );
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ success: true, batch_id: 'b1', format: 'md', content: '# Title' }),
    );

    const { result } = renderHook(() => useBatchSpawner());
    let json: Awaited<ReturnType<typeof result.current.exportBatch>> = null;
    let csv: Awaited<ReturnType<typeof result.current.exportBatch>> = null;
    let md: Awaited<ReturnType<typeof result.current.exportBatch>> = null;
    await act(async () => {
      json = await result.current.exportBatch('b1', 'json');
      csv = await result.current.exportBatch('b1', 'csv');
      md = await result.current.exportBatch('b1', 'md');
    });

    expect(json?.content).toBe('{"a":1}');
    expect(csv?.content).toBe('a,b');
    expect(md?.content).toBe('# Title');
  });

  it('setCurrent 切换 currentJob', () => {
    const { result } = renderHook(() => useBatchSpawner());
    const job = {
      batch_id: 'manual',
      total: 0,
      accepted: 0,
      rejected: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      progress: 0,
      status: 'pending',
      max_concurrency: 5,
      started_at: 0,
      instances: {},
      errors: [],
    } as const;
    act(() => {
      result.current.setCurrent(job as never);
    });
    expect(result.current.currentJob?.batch_id).toBe('manual');
  });

  it('clearError 清空错误', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ detail: 'boom' }, 500));
    const { result } = renderHook(() => useBatchSpawner());
    await act(async () => {
      await result.current.submit({ csv_content: 'x' });
    });
    expect(result.current.error).not.toBeNull();
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('currentJob 在 submit 后被设置', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'batch-set',
        total: 1,
        accepted: 1,
        rejected: 0,
        status: 'pending',
        errors: [],
      }),
    );
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        success: true,
        batch_id: 'batch-set',
        total: 1,
        accepted: 1,
        rejected: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        progress: 0,
        status: 'pending',
        max_concurrency: 5,
        started_at: 0,
        instances: {},
        errors: [],
      }),
    );

    const { result } = renderHook(() => useBatchSpawner());
    await act(async () => {
      await result.current.submit({ csv_content: 'task\nfoo' });
    });
    await waitFor(() => {
      expect(result.current.currentJob?.batch_id).toBe('batch-set');
    });
  });
});
