/**
 * # ============================================================
 * # useAutoCommit 单元测试（v1.0.0 P2-6）
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutoCommit, type AutoCommitResult } from './useAutoCommit';

describe('useAutoCommit', () => {
  let mockFetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetcher = vi.fn(async (): Promise<AutoCommitResult> => ({
      success: true,
      message: 'commit ok',
      commit_hash: 'abc1234',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态 loading=false', () => {
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher })
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastCommit).toBeNull();
    expect(result.current.hasPending).toBe(false);
  });

  it('scheduleAutoCommit 设置 hasPending=true', () => {
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher, debounceMs: 1000 })
    );

    act(() => {
      result.current.scheduleAutoCommit();
    });

    expect(result.current.hasPending).toBe(true);
  });

  it('防抖窗口内多次调用合并为一次', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher, debounceMs: 1000 })
    );

    act(() => {
      result.current.scheduleAutoCommit();
      result.current.scheduleAutoCommit();
      result.current.scheduleAutoCommit();
    });

    expect(mockFetcher).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('commitNow 立即提交', async () => {
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher })
    );

    await act(async () => {
      const r = await result.current.commitNow();
      expect(r?.success).toBe(true);
    });

    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(result.current.lastCommit?.commit_hash).toBe('abc1234');
  });

  it('commitNow 取消待处理的 scheduleAutoCommit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher, debounceMs: 1000 })
    );

    act(() => {
      result.current.scheduleAutoCommit();
    });

    await act(async () => {
      await result.current.commitNow();
    });

    expect(mockFetcher).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });

  it('fetcher 抛错时设置 error', async () => {
    const errorFetcher = vi.fn(async () => {
      throw new Error('commit failed');
    });
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: errorFetcher, debounceMs: 100 })
    );

    act(() => {
      result.current.scheduleAutoCommit();
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toBe('commit failed');
  });

  it('enabled=false 时不提交', () => {
    const { result } = renderHook(() =>
      useAutoCommit({ taskId: 'P2-5', taskName: 'Loading', fetcher: mockFetcher, debounceMs: 100, enabled: false })
    );

    act(() => {
      result.current.scheduleAutoCommit();
    });

    expect(result.current.hasPending).toBe(false);
    expect(mockFetcher).not.toHaveBeenCalled();
  });

  it('mode=milestone 时传递 milestone', async () => {
    const { result } = renderHook(() =>
      useAutoCommit({
        taskId: 'P2-5',
        taskName: 'Loading',
        fetcher: mockFetcher,
        mode: 'milestone',
        milestone: 'all_modules_done',
      })
    );

    await act(async () => {
      await result.current.commitNow();
    });

    expect(mockFetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'P2-5',
        task_name: 'Loading',
        mode: 'milestone',
        milestone: 'all_modules_done',
      })
    );
  });
});
