/**
 * useOptimisticMutation Hook 单元测试 (v6.43.0 Cycle 18 P1-3)
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimisticMutation } from './useOptimisticMutation';

describe('useOptimisticMutation', () => {
  it('初始 state 正确', () => {
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: async () => ({}),
        rollback: vi.fn(),
      }),
    );

    expect(result.current.state).toEqual({
      isLoading: false,
      error: null,
      successCount: 0,
      errorCount: 0,
    });
  });

  it('mutate 成功后 state 更新', async () => {
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: async () => ({ id: 'real' }),
        rollback: vi.fn(),
      }),
    );

    await act(async () => {
      const r = await result.current.mutate({ id: 'temp' });
      expect(r.success).toBe(true);
    });

    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.successCount).toBe(1);
    expect(result.current.state.errorCount).toBe(0);
  });

  it('mutate 失败后 state 包含 error', async () => {
    const rollback = vi.fn();
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: async () => {
          throw new Error('fail');
        },
        rollback,
      }),
    );

    await act(async () => {
      const r = await result.current.mutate({ id: 'x' });
      expect(r.success).toBe(false);
    });

    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.error?.message).toBe('fail');
    expect(result.current.state.successCount).toBe(0);
    expect(result.current.state.errorCount).toBe(1);
    expect(rollback).toHaveBeenCalled();
  });

  it('mutate 期间 isLoading=true', async () => {
    let resolveMutation: (value: unknown) => void = () => {};
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: () =>
          new Promise((resolve) => {
            resolveMutation = resolve;
          }),
        rollback: vi.fn(),
      }),
    );

    act(() => {
      result.current.mutate({});
    });

    expect(result.current.state.isLoading).toBe(true);

    await act(async () => {
      resolveMutation({ ok: true });
    });

    expect(result.current.state.isLoading).toBe(false);
  });

  it('重入检测：同时只允许一个 mutation', async () => {
    let resolveMutation: (value: unknown) => void = () => {};
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: () =>
          new Promise((resolve) => {
            resolveMutation = resolve;
          }),
        rollback: vi.fn(),
      }),
    );

    let secondResult: { success: boolean; error?: Error } | undefined;

    await act(async () => {
      // 第一次 mutation（不 await）
      const firstPromise = result.current.mutate({});
      // 立即发起第二次 mutation（在第一次完成前）
      const secondPromise = result.current.mutate({});
      // 收集第二次结果
      secondPromise.then((r) => {
        secondResult = r;
      });
      // 等待第二次的 then 微任务执行
      await Promise.resolve();
      // 完成第一次 mutation
      resolveMutation({ ok: true });
      await firstPromise;
    });

    expect(secondResult).toBeDefined();
    expect(secondResult?.success).toBe(false);
    expect(secondResult?.error?.message).toMatch(/进行中/);
  });

  it('reset 重置 state', async () => {
    const { result } = renderHook(() =>
      useOptimisticMutation({
        optimistic: vi.fn(),
        mutation: async () => {
          throw new Error('fail');
        },
        rollback: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.mutate({});
    });

    expect(result.current.state.errorCount).toBe(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toEqual({
      isLoading: false,
      error: null,
      successCount: 0,
      errorCount: 0,
    });
  });
});
