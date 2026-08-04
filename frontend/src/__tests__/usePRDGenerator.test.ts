/**
 * # ============================================================
 * # usePRDGenerator Hook 单元测试
 * # Cycle 63 G63-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { usePRDGenerator } from '../hooks/usePRDGenerator';

const originalFetch = globalThis.fetch;

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  } as Response);
}

function mockFetchError(status: number, detail = 'error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ detail }),
  } as Response);
}

describe('usePRDGenerator - 基础', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('应正确初始化 hook', () => {
    const { result } = renderHook(() => usePRDGenerator());
    expect(result.current.prds).toEqual([]);
    expect(result.current.currentPRD).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.generating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('listPRDs 应正确获取列表', async () => {
    const mockData = {
      success: true,
      total: 2,
      prds: [
        { prd_id: 'p1', title: 'T1', current_version: 1, updated_at: 1000 },
        { prd_id: 'p2', title: 'T2', current_version: 2, updated_at: 2000 },
      ],
    };
    globalThis.fetch = mockFetchOk(mockData) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    await act(async () => {
      await result.current.listPRDs();
    });
    await waitFor(() => {
      expect(result.current.prds).toHaveLength(2);
    });
  });

  it('listPRDs 失败应设置 error', async () => {
    globalThis.fetch = mockFetchError(500, 'server error') as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    await act(async () => {
      await result.current.listPRDs();
    });
    expect(result.current.error).toContain('listPRDs');
  });

  it('generatePRD 应返回文档', async () => {
    const mockPRD = {
      prd_id: 'p1',
      title: 'T1',
      goals: ['g1'],
      user_scenarios: [],
      acceptance_criteria: [],
      tasks: [],
      risks: [],
      version: 1,
      created_at: 1000,
      updated_at: 1000,
    };
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('/generate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, prd: mockPRD, version: 1 }),
        };
      }
      if (url.includes('/_list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, prds: [mockPRD], total: 1 }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    let prd: unknown = null;
    await act(async () => {
      prd = await result.current.generatePRD({ requirement: '实现 Todo List 应用' });
    });
    expect(prd).not.toBeNull();
    expect((prd as { prd_id: string }).prd_id).toBe('p1');
    expect(result.current.generating).toBe(false);
    expect(callCount).toBeGreaterThanOrEqual(2); // generate + listPRDs
  });

  it('generatePRD 校验失败应捕获错误', async () => {
    globalThis.fetch = mockFetchError(400, '需求至少 10 个字符') as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    let prd: unknown = 'placeholder';
    await act(async () => {
      prd = await result.current.generatePRD({ requirement: '太短' });
    });
    expect(prd).toBeNull();
    expect(result.current.error).toContain('需求至少');
  });

  it('deletePRD 应正确删除', async () => {
    let deleteCalled = false;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') {
        deleteCalled = true;
        return { ok: true, status: 200, json: async () => ({ success: true, prd_id: 'p1' }) };
      }
      if (url.includes('/_list')) {
        return { ok: true, status: 200, json: async () => ({ success: true, prds: [], total: 0 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    let ok = false;
    await act(async () => {
      ok = await result.current.deletePRD('p1');
    });
    expect(ok).toBe(true);
    expect(deleteCalled).toBe(true);
  });

  it('clearError 应清除错误', async () => {
    globalThis.fetch = mockFetchError(500) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    await act(async () => {
      await result.current.listPRDs();
    });
    expect(result.current.error).not.toBeNull();
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('loadStats 应正确加载', async () => {
    globalThis.fetch = mockFetchOk({
      success: true,
      stats: { total_prds: 5, total_versions: 10, rate_limit_per_hour: 100 },
    }) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    await act(async () => {
      await result.current.loadStats();
    });
    expect(result.current.stats?.total_prds).toBe(5);
  });

  it('iteratePRD 应更新 currentPRD', async () => {
    const newPRD = {
      prd_id: 'p1',
      title: 'T1 v2',
      goals: ['g1', 'g2'],
      user_scenarios: [],
      acceptance_criteria: [],
      tasks: [],
      risks: [],
      version: 2,
      created_at: 1000,
      updated_at: 2000,
    };
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('/iterate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, prd: newPRD, version: 2, diff: [] }),
        };
      }
      if (url.includes('/p1?include_history=true') || url.match(/\/p1\?/)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            prd: newPRD,
            current_version: 2,
            history: [
              { version: 1, content: { ...newPRD, version: 1 }, diff_summary: 'initial', created_at: 1000 },
              { version: 2, content: newPRD, diff_summary: 'updated', created_at: 2000 },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    let prd: unknown = null;
    await act(async () => {
      prd = await result.current.iteratePRD('p1', { feedback: '增加多语言支持' });
    });
    expect(prd).not.toBeNull();
    expect((prd as { version: number }).version).toBe(2);
    expect(result.current.currentPRD?.version).toBe(2);
  });

  it('computeDiff 应返回 diff ops', async () => {
    const mockDiff = [
      { field: 'goals', op: 'added', path: 'goals', before: null, after: 'g3', summary: '新增目标' },
    ];
    globalThis.fetch = mockFetchOk({ success: true, diff: mockDiff, summary: '新增 1 项' }) as typeof fetch;
    const { result } = renderHook(() => usePRDGenerator());
    let diff: unknown = null;
    await act(async () => {
      diff = await result.current.computeDiff('p1', 1, 2);
    });
    expect(diff).not.toBeNull();
    expect((diff as unknown[]).length).toBe(1);
  });
});
