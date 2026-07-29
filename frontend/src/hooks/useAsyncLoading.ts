/**
 * # ============================================================
 * # useAsyncLoading 异步操作 loading 包装 Hook（v6.40.0 P2-5）
 * # ============================================================
 * # 核心作用：为异步操作提供 loading / error / data 状态管理
 * #           自动处理并发控制（防止重复执行）
 * #           自动处理超时（可选）
 * #           自动重试（可选）
 * # 运行流程：
 * #   1. 接收 asyncTask 函数
 * #   2. 返回 { run, loading, error, data, reset } 控制对象
 * #   3. run 调用时设置 loading=true → 执行任务 → 设置 data/error
 * # 输入参数：
 * #   - asyncTask: 异步任务函数（支持参数 + onProgress）
 * #   - options: 配置（immediate / timeout / maxRetries / onSuccess / onError）
 * # 输出结果：{ run, loading, error, data, reset, progress }
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建
 * # ============================================================
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseAsyncLoadingOptions<TArgs extends unknown[], TResult> {
  /** 是否立即执行（默认 false） */
  immediate?: boolean;
  /** 初始参数（immediate=true 时使用） */
  initialArgs?: TArgs;
  /** 超时时间（毫秒，0 表示不超时） */
  timeout?: number;
  /** 最大重试次数（默认 0） */
  maxRetries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 成功回调 */
  onSuccess?: (data: TResult, args: TArgs) => void;
  /** 失败回调 */
  onError?: (error: Error, args: TArgs) => void;
}

export interface UseAsyncLoadingResult<TArgs extends unknown[], TResult> {
  /** 触发异步任务 */
  run: (...args: TArgs) => Promise<TResult | undefined>;
  /** 是否加载中 */
  loading: boolean;
  /** 错误对象 */
  error: Error | null;
  /** 成功数据 */
  data: TResult | null;
  /** 进度（0-100） */
  progress: number;
  /** 重置状态 */
  reset: () => void;
  /** 最后一次执行是否成功 */
  isSuccess: boolean;
  /** 最后一次执行是否失败 */
  isError: boolean;
}

/**
 * useAsyncLoading 异步操作 loading 包装 Hook
 *
 * 用法：
 * ```typescript
 * const { run, loading, error, data, progress } = useAsyncLoading(
 *   async (userId: string, onProgress) => {
 *     const res = await fetchUser(userId, onProgress);
 *     return res;
 *   },
 *   {
 *     immediate: true,
 *     initialArgs: ['user_123'],
 *     onSuccess: (data) => console.log(data),
 *     onError: (err) => console.error(err),
 *     maxRetries: 2,
 *   }
 * );
 * ```
 */
export function useAsyncLoading<TArgs extends unknown[], TResult>(
  asyncTask: (...args: [...TArgs, (progress: number) => void]) => Promise<TResult>,
  options: UseAsyncLoadingOptions<TArgs, TResult> = {}
): UseAsyncLoadingResult<TArgs, TResult> {
  const {
    immediate = false,
    initialArgs,
    timeout = 0,
    maxRetries = 0,
    retryDelay = 500,
    onSuccess,
    onError,
  } = options;

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);
  const [progress, setProgress] = useState<number>(0);

  const inFlightRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef<number>(0);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // 进度回调
  const onProgressRef = useRef<(p: number) => void>((p) => {
    if (mountedRef.current) setProgress(p);
  });

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setLoading(false);
    setError(null);
    setData(null);
    setProgress(0);
    inFlightRef.current = false;
    retriesRef.current = 0;
  }, []);

  const runInternal = useCallback(
    async (args: TArgs, attempt: number = 0): Promise<TResult | undefined> => {
      // 防止外部重复执行（保留给 run 使用），但重试时 inFlightRef 仍为 true
      // 因此这里不检查 inFlightRef

      inFlightRef.current = true;
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
        setProgress(0);
      }

      // 设置超时
      let timedOut = false;
      if (timeout > 0) {
        timeoutRef.current = setTimeout(() => {
          timedOut = true;
        }, timeout);
      }

      try {
        const result = await asyncTask(...args, onProgressRef.current);

        if (timedOut) {
          throw new Error(`操作超时（${timeout}ms）`);
        }

        if (mountedRef.current) {
          setData(result);
          setProgress(100);
          setLoading(false);
        }

        inFlightRef.current = false;
        onSuccess?.(result, args);
        return result;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));

        // 重试逻辑
        if (attempt < maxRetries && !timedOut) {
          if (mountedRef.current) {
            // 进度提示
            setProgress(0);
          }
          await new Promise((r) => setTimeout(r, retryDelay));
          return runInternal(args, attempt + 1);
        }

        if (mountedRef.current) {
          setError(errorObj);
          setLoading(false);
        }

        inFlightRef.current = false;
        onError?.(errorObj, args);
        return undefined;
      } finally {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    },
    [asyncTask, timeout, maxRetries, retryDelay, onSuccess, onError]
  );

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      // 防止并发：已有任务在执行中时直接返回 undefined
      if (inFlightRef.current) {
        return undefined;
      }
      retriesRef.current = 0;
      return runInternal(args, 0);
    },
    [runInternal]
  );

  // immediate 模式：组件挂载时立即执行
  useEffect(() => {
    if (immediate && initialArgs) {
      run(...initialArgs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    run,
    loading,
    error,
    data,
    progress,
    reset,
    isSuccess: !loading && !error && data !== null,
    isError: !loading && error !== null,
  };
}

export default useAsyncLoading;
