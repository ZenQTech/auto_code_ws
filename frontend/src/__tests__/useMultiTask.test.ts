/**
 * # ============================================================
 * # useMultiTask Hook 单元测试 (v1.0.0)
 * # Cycle 62 G62-01
 * # ====================================
 */

import { renderHook, act } from '@testing-library/react';
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiTask } from '../hooks/useMultiTask';

const mockTask = {
  task_id: 'task-123',
  title: 'Test Task',
  prompt: 'test prompt',
  status: 'pending' as const,
  created_at: Date.now(),
  updated_at: Date.now(),
  started_at: null,
  completed_at: null,
  context_ids: [],
  plan_id: null,
  execution_id: null,
  resource_usage: {
    cpu_percent: 0,
    memory_mb: 0,
    tokens_used: 0,
    elapsed_seconds: 0,
  },
  error: null,
  result: null,
  metadata: {},
  elapsed_s: 0,
};

describe('useMultiTask Hook', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应该初始化为空任务列表', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, tasks: [] }),
    });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.activeTaskId).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('应该加载任务列表', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, tasks: [mockTask] }),
    });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].task_id).toBe('task-123');
  });

  it('应该创建任务', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, tasks: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, task: { ...mockTask, status: 'running' } }),
      });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    let created;
    await act(async () => {
      created = await result.current.createTask({
        title: 'New',
        prompt: 'Do something',
      });
    });

    expect(created).toBeTruthy();
    expect(created?.status).toBe('running');
    expect(result.current.tasks).toHaveLength(1);
  });

  it('应该处理创建失败', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, tasks: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ detail: '资源配额耗尽' }),
      });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    let created;
    await act(async () => {
      created = await result.current.createTask({
        title: 'New',
        prompt: 'Do something',
      });
    });

    expect(created).toBeNull();
    expect(result.current.error).toContain('资源配额耗尽');
  });

  it('应该设置活跃任务', async () => {
    const { result } = renderHook(() => useMultiTask());

    act(() => {
      result.current.setActiveTaskId('task-abc');
    });

    expect(result.current.activeTaskId).toBe('task-abc');
  });

  it('应该删除任务', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, tasks: [mockTask] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, deleted: true }),
      });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.tasks).toHaveLength(1);

    await act(async () => {
      await result.current.deleteTask('task-123');
    });

    expect(result.current.tasks).toHaveLength(0);
  });

  it('应该暂停任务', async () => {
    const runningTask = { ...mockTask, status: 'running' as const };
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, tasks: [runningTask] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, task: { ...runningTask, status: 'paused' } }),
      });

    const { result } = renderHook(() => useMultiTask());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      await result.current.pauseTask('task-123');
    });

    const updated = result.current.tasks.find((t) => t.task_id === 'task-123');
    expect(updated?.status).toBe('paused');
  });

  it('应该获取统计', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, tasks: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          stats: { total: 3, by_status: { running: 1, completed: 2 } },
        }),
      });

    const { result } = renderHook(() => useMultiTask());

    // Wait for initial refresh
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    let stats;
    await act(async () => {
      stats = await result.current.getStats();
    });

    expect(stats).toBeTruthy();
    expect(stats?.total).toBe(3);
  });
});
