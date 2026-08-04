/**
 * # ============================================================
 * useGoalLoop Hook 单元测试
 * Cycle 61 G61-02
 * # ====================================
 */

// @vitest-environment happy-dom
// 显式导入 jest-dom 以确保 toBeInTheDocument 等 matcher 可用
import '@testing-library/jest-dom/vitest';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGoalLoop } from '../hooks/useGoalLoop';

const BASE_URL = '/api';

describe('useGoalLoop - 基础', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应初始化为 empty state', () => {
    const { result } = renderHook(() => useGoalLoop());
    expect(result.current.goals).toEqual([]);
    expect(result.current.plans).toEqual([]);
    expect(result.current.currentGoal).toBeNull();
    expect(result.current.currentPlan).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('应成功加载 Goal 列表', async () => {
    const mockGoals = [
      { id: 'g1', title: 'Goal 1', status: 'draft' },
      { id: 'g2', title: 'Goal 2', status: 'active' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    await act(async () => {
      await result.current.refreshGoals();
    });

    await waitFor(() => {
      expect(result.current.goals).toEqual(mockGoals);
    });
    expect(result.current.goalsError).toBeNull();
  });

  it('应处理 fetch 错误（静默保留旧数据）', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('Network error');
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    await act(async () => {
      await result.current.refreshGoals();
    });

    await waitFor(() => {
      expect(result.current.goalsError).toBe('Network error');
    });
    expect(result.current.goals).toEqual([]);
  });
});

describe('useGoalLoop - Goal 选择 + 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应自动恢复持久化的 currentGoal', async () => {
    localStorage.setItem('hermes.goal.currentId', 'g1');
    const mockGoals = [
      { id: 'g1', title: 'Goal 1', status: 'draft' },
      { id: 'g2', title: 'Goal 2', status: 'active' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    await act(async () => {
      await result.current.refreshGoals();
    });

    await waitFor(() => {
      expect(result.current.currentGoal?.id).toBe('g1');
    });
  });

  it('应持久化 setCurrentGoal', () => {
    const { result } = renderHook(() => useGoalLoop());
    act(() => {
      result.current.setCurrentGoal({ id: 'g2', title: 'Test', status: 'active' });
    });
    expect(localStorage.getItem('hermes.goal.currentId')).toBe('g2');
  });

  it('应清空持久化（setCurrentGoal(null)）', () => {
    localStorage.setItem('hermes.goal.currentId', 'g1');
    const { result } = renderHook(() => useGoalLoop());
    act(() => {
      result.current.setCurrentGoal(null);
    });
    expect(localStorage.getItem('hermes.goal.currentId')).toBeNull();
  });
});

describe('useGoalLoop - Plan CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应成功创建 Plan', async () => {
    const mockPlan = {
      plan_id: 'p1',
      goal_id: 'g1',
      title: 'Plan 1',
      description: '',
      status: 'draft',
      steps: [],
      progress: 0,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, plan: mockPlan }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    let plan: unknown = null;
    await act(async () => {
      plan = await result.current.createPlan('g1', 'Plan 1');
    });
    expect(plan).toEqual(mockPlan);
    expect(result.current.currentPlan).toEqual(mockPlan);
  });

  it('应拒绝空标题', async () => {
    const { result } = renderHook(() => useGoalLoop());
    let plan: unknown = null;
    await act(async () => {
      plan = await result.current.createPlan('g1', '');
    });
    expect(plan).toBeNull();
    expect(result.current.error).toContain('不能为空');
  });

  it('应成功加载 Plan 列表', async () => {
    const mockPlans = [
      { plan_id: 'p1', goal_id: 'g1', title: 'Plan 1', steps: [], progress: 0, status: 'draft' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, plans: mockPlans }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    await act(async () => {
      await result.current.loadPlans('g1');
    });
    expect(result.current.plans).toEqual(mockPlans);
  });
});

describe('useGoalLoop - Step 操作', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应成功添加 Step', async () => {
    const mockStep = {
      step_id: 's1',
      plan_id: 'p1',
      title: 'Step 1',
      description: '',
      order: 0,
      status: 'pending',
      strategy: 'retry',
      retry_count: 0,
      max_retries: 3,
      output: '',
      error: '',
      exit_code: null,
      created_at: Date.now() / 1000,
      started_at: null,
      finished_at: null,
      verify_item_id: null,
      verify_result: null,
      metadata: {},
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, step: mockStep }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    act(() => {
      result.current.setCurrentPlan({
        plan_id: 'p1',
        goal_id: 'g1',
        title: 'Plan 1',
        description: '',
        status: 'pending',
        steps: [],
        created_at: Date.now() / 1000,
        started_at: null,
        finished_at: null,
        progress: 0,
        metadata: {},
      });
    });

    let step: unknown = null;
    await act(async () => {
      step = await result.current.addStep('p1', 'Step 1');
    });
    expect(step).toEqual(mockStep);
  });

  it('应拒绝空 Step 标题', async () => {
    const { result } = renderHook(() => useGoalLoop());
    let step: unknown = null;
    await act(async () => {
      step = await result.current.addStep('p1', '');
    });
    expect(step).toBeNull();
    expect(result.current.error).toContain('不能为空');
  });

  it('应成功更新 Step 状态', async () => {
    const updatedStep = {
      step_id: 's1',
      plan_id: 'p1',
      title: 'Step 1',
      order: 0,
      status: 'running',
      strategy: 'retry',
      retry_count: 0,
      max_retries: 3,
      output: '',
      error: '',
      exit_code: null,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, step: updatedStep }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    act(() => {
      result.current.setCurrentPlan({
        plan_id: 'p1',
        goal_id: 'g1',
        title: 'Plan 1',
        status: 'pending',
        steps: [
          {
            step_id: 's1',
            plan_id: 'p1',
            title: 'Step 1',
            order: 0,
            status: 'pending',
            strategy: 'retry',
            retry_count: 0,
            max_retries: 3,
            output: '',
            error: '',
            exit_code: null,
            created_at: 0,
            started_at: null,
            finished_at: null,
            verify_item_id: null,
            verify_result: null,
            metadata: {},
            prompt: '',
            tool: '',
            command: '',
            file_path: '',
          },
        ],
        created_at: 0,
        started_at: null,
        finished_at: null,
        progress: 0,
        metadata: {},
      });
    });

    let result_step: unknown = null;
    await act(async () => {
      result_step = await result.current.updateStepStatus('p1', 's1', 'running');
    });
    expect(result_step).toEqual(updatedStep);
  });
});

describe('useGoalLoop - Plan 状态操作', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['start', 'start'],
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['complete', 'complete'],
    ['cancel', 'cancel'],
  ])('应成功执行 Plan %s 操作', async (action) => {
    const mockPlan = { plan_id: 'p1', goal_id: 'g1', title: 'Plan', status: action, steps: [] };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, plan: mockPlan }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    let returned: unknown = null;
    await act(async () => {
      const fn = result.current[`${action}Plan` as keyof typeof result.current] as (id: string) => Promise<unknown>;
      returned = await fn('p1');
    });
    expect(returned).toEqual(mockPlan);
  });
});

describe('useGoalLoop - 进度刷新', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应成功刷新 Plan 进度', async () => {
    const mockProgress = {
      plan_id: 'p1',
      goal_id: 'g1',
      status: 'running',
      progress: 0.5,
      step_stats: { pending: 1, running: 1, success: 1, failed: 0, skipped: 0, cancelled: 0 },
      total_steps: 3,
      duration_ms: 1000,
      running_step: 's2',
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, progress: mockProgress }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useGoalLoop());
    await act(async () => {
      await result.current.refreshPlanProgress('p1');
    });

    expect(result.current.planProgress).toEqual(mockProgress);
  });
});
