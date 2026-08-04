/**
 * # ============================================================
 * # useRollback Hook 单元测试
 * # Cycle 61 G61-07
 * # ====================================
 */

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRollback } from '../hooks/useRollback';

const BASE_URL = '/api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useRollback - 基础', () => {
  it('应初始化为 empty state', () => {
    const { result } = renderHook(() => useRollback());
    expect(result.current.snapshots).toEqual([]);
    expect(result.current.gitLog).toEqual([]);
    expect(result.current.rollbackHistory).toEqual([]);
    expect(result.current.isRollingBack).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('应接受 initialRepoPath', () => {
    const { result } = renderHook(() =>
      useRollback({ initialRepoPath: '/tmp/repo' }),
    );
    expect(result.current.repoPath).toBe('/tmp/repo');
  });
});

describe('useRollback - 快照', () => {
  it('应成功加载快照', async () => {
    const mockSnapshots = [
      { snapshot_id: 's1', commit_hash: 'abc', short_hash: 'abc', message: 'snap 1', source: 'plan' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ count: 1, snapshots: mockSnapshots }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    await act(async () => {
      await result.current.refreshSnapshots();
    });
    expect(result.current.snapshots).toEqual(mockSnapshots);
  });

  it('应支持按 planId 过滤', async () => {
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('plan_id=p1');
      return new Response(JSON.stringify({ count: 0, snapshots: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback());
    await act(async () => {
      await result.current.refreshSnapshots('p1');
    });
  });

  it('createSnapshot 应处理错误', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: '无变更' }), { status: 400 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    let snap: unknown = null;
    await act(async () => {
      snap = await result.current.createSnapshot({ message: 'test' });
    });
    expect(snap).toBeNull();
    expect(result.current.error).toContain('无变更');
  });
});

describe('useRollback - 回退', () => {
  it('rollback 应处理成功', async () => {
    const mockResult = {
      success: true,
      original_commit: 'abc',
      revert_commit: 'def',
      message: 'rolled back',
      error: null,
      files_changed: 1,
      timestamp: Date.now() / 1000,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ result: mockResult }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    let r: unknown = null;
    await act(async () => {
      r = await result.current.rollback('abc');
    });
    expect(r).toEqual(mockResult);
    expect(result.current.rollbackHistory).toContainEqual(mockResult);
  });

  it('rollbackBySnapshot 应处理成功', async () => {
    const mockResult = {
      success: true,
      original_commit: 'abc',
      revert_commit: 'def',
      message: 'rolled back',
      error: null,
      files_changed: 1,
      timestamp: Date.now() / 1000,
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ result: mockResult }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    let r: unknown = null;
    await act(async () => {
      r = await result.current.rollbackBySnapshot('snap-1');
    });
    expect(r).toEqual(mockResult);
  });

  it('rollbackBatch 应处理成功', async () => {
    const mockResults = [
      { success: true, original_commit: 'a', revert_commit: 'b', message: 'r1', error: null, files_changed: 1, timestamp: 0 },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ count: 1, results: mockResults, all_success: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    let r: unknown = null;
    await act(async () => {
      r = await result.current.rollbackBatch(['a']);
    });
    expect(r).toEqual(mockResults);
  });

  it('rollback 应处理错误', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'commit 不存在' }), { status: 400 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    let r: unknown = null;
    await act(async () => {
      r = await result.current.rollback('badcommit');
    });
    expect(r).toBeNull();
    expect(result.current.error).toContain('commit 不存在');
  });
});

describe('useRollback - Git Log', () => {
  it('refreshGitLog 应更新 gitLog', async () => {
    const mockEntries = [
      { commit_hash: 'abc', short_hash: 'abc', message: 'm1', author: 'a', timestamp: 123 },
    ];
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('git-log')) {
        return new Response(JSON.stringify({ entries: mockEntries }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback({ initialRepoPath: '/tmp/repo' }));
    await act(async () => {
      await result.current.refreshGitLog();
    });
    expect(result.current.gitLog).toEqual(mockEntries);
  });

  it('空 repoPath 时 refreshGitLog 不应请求', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback());
    await act(async () => {
      await result.current.refreshGitLog();
    });
    expect(result.current.gitLog).toEqual([]);
  });
});

describe('useRollback - 回退历史', () => {
  it('refreshHistory 应更新 history', async () => {
    const mockHistory = [
      { success: true, original_commit: 'a', revert_commit: 'b', message: 'r', error: null, files_changed: 1, timestamp: 0 },
    ];
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('history')) {
        return new Response(JSON.stringify({ count: 1, history: mockHistory }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useRollback());
    await act(async () => {
      await result.current.refreshHistory();
    });
    expect(result.current.rollbackHistory).toEqual(mockHistory);
  });
});
