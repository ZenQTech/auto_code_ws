/**
 * # ============================================================
 * useAsyncLoading 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncLoading } from './useAsyncLoading';

describe('useAsyncLoading', () => {
  it('初始状态 loading=false error=null data=null', async () => {
    const task = vi.fn(async () => 'result');
    const { result } = renderHook(() => useAsyncLoading(task));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it('run 调用后 loading=true', async () => {
    const task = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'result';
    });
    const { result } = renderHook(() => useAsyncLoading(task));

    act(() => {
      result.current.run();
    });

    expect(result.current.loading).toBe(true);
  });

  it('成功后设置 data 并 loading=false', async () => {
    const task = vi.fn(async () => 'success-data');
    const { result } = renderHook(() => useAsyncLoading(task));

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.data).toBe('success-data');
    expect(result.current.loading).toBe(false);
    expect(result.current.isSuccess).toBe(true);
  });

  it('失败后设置 error 并 loading=false', async () => {
    const task = vi.fn(async () => {
      throw new Error('failed');
    });
    const { result } = renderHook(() => useAsyncLoading(task));

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.error?.message).toBe('failed');
    expect(result.current.loading).toBe(false);
    expect(result.current.isError).toBe(true);
  });

  it('onSuccess 回调在成功后触发', async () => {
    const onSuccess = vi.fn();
    const task = vi.fn(async () => 'data');
    const { result } = renderHook(() => useAsyncLoading(task, { onSuccess }));

    await act(async () => {
      await result.current.run('arg1');
    });

    expect(onSuccess).toHaveBeenCalledWith('data', ['arg1']);
  });

  it('onError 回调在失败后触发', async () => {
    const onError = vi.fn();
    const task = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useAsyncLoading(task, { onError }));

    await act(async () => {
      await result.current.run('arg1');
    });

    expect(onError).toHaveBeenCalled();
  });

  it('maxRetries=2 时失败后重试', async () => {
    let attempts = 0;
    const task = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('retry');
      return 'finally';
    });
    const { result } = renderHook(() =>
      useAsyncLoading(task, { maxRetries: 2, retryDelay: 10 })
    );

    await act(async () => {
      await result.current.run();
    });

    expect(attempts).toBe(3);
    expect(result.current.data).toBe('finally');
  });

  it('maxRetries=0 不重试', async () => {
    const task = vi.fn(async () => {
      throw new Error('no-retry');
    });
    const { result } = renderHook(() => useAsyncLoading(task, { maxRetries: 0 }));

    await act(async () => {
      await result.current.run();
    });

    expect(task).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe('no-retry');
  });

  it('reset 清除所有状态', async () => {
    const task = vi.fn(async () => 'data');
    const { result } = renderHook(() => useAsyncLoading(task));

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.data).toBe('data');

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('immediate=true 时组件挂载即执行', async () => {
    const task = vi.fn(async () => 'immediate-data');
    const { result } = renderHook(() =>
      useAsyncLoading(task, { immediate: true, initialArgs: ['init-arg'] })
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBe('immediate-data');
    });
  });

  it('防止并发：第二次 run 在第一次未完成时返回 undefined', async () => {
    const task = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'data';
    });
    const { result } = renderHook(() => useAsyncLoading(task));

    act(() => {
      result.current.run();
    });

    let second: unknown = 'pending';
    await act(async () => {
      second = await result.current.run();
    });

    expect(second).toBeUndefined();
  });

  it('progress 回调更新 progress 状态', async () => {
    const task = vi.fn(async (_arg: string, onProgress) => {
      onProgress(50);
      await new Promise((r) => setTimeout(r, 10));
      onProgress(100);
      return 'done';
    });
    const { result } = renderHook(() => useAsyncLoading(task));

    await act(async () => {
      await result.current.run('x');
    });

    expect(result.current.progress).toBe(100);
  });
});
