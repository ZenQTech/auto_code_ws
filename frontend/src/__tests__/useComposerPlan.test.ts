/**
 * # ============================================================
 * # useComposerPlan Hook 单元测试
 * # Cycle 61 G61-04
 * # ====================================
 */

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useComposerPlan } from '../hooks/useComposerPlan';

const BASE_URL = '/api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useComposerPlan - 基础', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应初始化为 empty state', () => {
    const { result } = renderHook(() => useComposerPlan());
    expect(result.current.plans).toEqual([]);
    expect(result.current.plansLoading).toBe(false);
    expect(result.current.currentPlan).toBeNull();
    expect(result.current.isExecuting).toBe(false);
    expect(result.current.currentExecution).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('应成功加载 Plan 列表', async () => {
    const mockPlans = [
      { plan_id: 'p1', title: 'Plan 1', status: 'draft', steps: [], progress: 0 },
      { plan_id: 'p2', title: 'Plan 2', status: 'completed', steps: [], progress: 1 },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: mockPlans }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    await act(async () => {
      await result.current.refreshPlans();
    });

    await waitFor(() => {
      expect(result.current.plans).toEqual(mockPlans);
    });
    expect(result.current.plansError).toBeNull();
  });
});

describe('useComposerPlan - 一键执行', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应成功执行', async () => {
    const mockExecution = {
      execution_id: 'exec-1',
      plan_id: 'p1',
      status: 'running',
      progress: 0,
      step_results: [],
      started_at: Date.now() / 1000,
      finished_at: null,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(mockExecution), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let exec: unknown = null;
    await act(async () => {
      exec = await result.current.execute({ prompt: 'test' });
    });
    expect(exec).toEqual(mockExecution);
    expect(result.current.currentExecution).toEqual(mockExecution);
  });

  it('应处理执行错误', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: '分解失败' }), { status: 500 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let exec: unknown = null;
    await act(async () => {
      exec = await result.current.execute({ prompt: 'test' });
    });
    expect(exec).toBeNull();
    expect(result.current.error).toContain('分解失败');
  });

  it('executeFromJson 应成功', async () => {
    const mockExecution = {
      execution_id: 'exec-2',
      plan_id: 'p2',
      status: 'running',
      progress: 0,
      step_results: [],
      started_at: 0,
      finished_at: null,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(mockExecution), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let exec: unknown = null;
    await act(async () => {
      exec = await result.current.executeFromJson(
        'Test Plan',
        [{ step_id: 's1', title: 'S1', action: 'noop' }],
      );
    });
    expect(exec).toEqual(mockExecution);
  });
});

describe('useComposerPlan - 控制操作', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['pausePlan', 'pause'],
    ['resumePlan', 'resume'],
    ['cancelPlan', 'cancel'],
  ])('应成功执行 %s', async (method) => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let ok: boolean = false;
    await act(async () => {
      ok = await (result.current as never)[method]('plan-1');
    });
    expect(ok).toBe(true);
  });

  it.each([
    ['retryStep', 'p1', 's1'],
    ['skipStep', 'p1', 's1'],
  ])('应成功执行 %s', async (method, planId, stepId) => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let ok: boolean = false;
    await act(async () => {
      ok = await (result.current as never)[method](planId, stepId);
    });
    expect(ok).toBe(true);
  });
});

describe('useComposerPlan - LLMCaller 注入', () => {
  it.each(['default', 'echo', 'mock'])(
    '应成功注入 %s LLMCaller',
    async (callerType) => {
      global.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ success: true, caller_type: callerType }), { status: 200 }),
      ) as unknown as typeof fetch;

      const { result } = renderHook(() => useComposerPlan());
      let ok: boolean = false;
      await act(async () => {
        ok = await result.current.injectLLMCaller(
          callerType as 'default' | 'echo' | 'mock',
          'test',
        );
      });
      expect(ok).toBe(true);
    },
  );
});

describe('useComposerPlan - Execution 刷新', () => {
  it('refreshExecution 应更新 currentExecution', async () => {
    const mockExecution = {
      execution_id: 'exec-1',
      plan_id: 'p1',
      status: 'completed',
      progress: 1,
      step_results: [],
      started_at: 0,
      finished_at: 1,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(mockExecution), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useComposerPlan());
    let exec: unknown = null;
    await act(async () => {
      exec = await result.current.refreshExecution('exec-1');
    });
    expect(exec).toEqual(mockExecution);
    expect(result.current.currentExecution).toEqual(mockExecution);
  });
});
