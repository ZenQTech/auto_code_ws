/**
 * # ============================================================
 * # useCommitHistory 单元测试（v1.0.0 P2-6）
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCommitHistory, type CommitEntry } from './useCommitHistory';

describe('useCommitHistory', () => {
  const sampleCommits: CommitEntry[] = [
    { hash: 'abc1234', author: 'alice', date: '2026-07-29T10:00:00Z', message: 'feat: new feature', is_auto_commit: false },
    { hash: 'def5678', author: 'bob', date: '2026-07-28T10:00:00Z', message: 'fix: bug fix', is_auto_commit: true },
  ];

  let mockFetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetcher = vi.fn(async () => sampleCommits);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态 loading=false commits=[]', () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, immediate: false })
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.commits).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('immediate=true 时立即拉取', async () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher })
    );
    await waitFor(() => {
      expect(result.current.commits).toEqual(sampleCommits);
    });
    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });

  it('refresh() 主动刷新', async () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, immediate: false })
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.commits).toEqual(sampleCommits);
  });

  it('fetcher 抛错时设置 error', async () => {
    const errorFetcher = vi.fn(async () => {
      throw new Error('network error');
    });
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: errorFetcher })
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toBe('network error');
  });

  it('lastFetched 在成功拉取后更新', async () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, immediate: false })
    );

    expect(result.current.lastFetched).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.lastFetched).not.toBeNull();
  });

  it('autoRefreshInterval 启用定时刷新', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, autoRefreshInterval: 1000 })
    );

    await waitFor(() => {
      expect(result.current.commits).toEqual(sampleCommits);
    });

    const initialCalls = mockFetcher.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockFetcher.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('maxCount 传递给 fetcher', async () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, maxCount: 10 })
    );

    await waitFor(() => {
      expect(result.current.commits).toEqual(sampleCommits);
    });
    expect(mockFetcher).toHaveBeenCalledWith(10, undefined);
  });

  it('branch 传递给 fetcher', async () => {
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: mockFetcher, branch: 'main' })
    );

    await waitFor(() => {
      expect(result.current.commits).toEqual(sampleCommits);
    });
    expect(mockFetcher).toHaveBeenCalledWith(50, 'main');
  });

  it('防止并发：重复 refresh 不触发多次 fetcher', async () => {
    let resolveFn: (value: CommitEntry[]) => void;
    const slowFetcher = vi.fn(
      () => new Promise<CommitEntry[]>((resolve) => { resolveFn = resolve; })
    );
    const { result } = renderHook(() =>
      useCommitHistory({ fetcher: slowFetcher, immediate: false })
    );

    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });

    expect(slowFetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFn!(sampleCommits);
    });
  });
});
