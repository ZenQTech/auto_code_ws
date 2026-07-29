/**
 * # ============================================================
 * useOptimisticMutation Hook (v6.43.0 Cycle 18 P1-3)
 * # ============================================================
 * 核心作用：React Hook 封装乐观更新，提供 loading / error 状态
 * 适用场景：在 React 组件中需要乐观更新 + 状态跟踪
 * 配套组件：optimisticUpdate.ts（核心执行器）
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

import { useCallback, useRef, useState } from 'react';
import {
  optimisticUpdate,
  type OptimisticUpdateOptions,
  type OptimisticUpdateResult,
  type OptimisticState,
} from '../utils/optimisticUpdate';

export interface UseOptimisticMutationOptions<TData, TVariables>
  extends OptimisticUpdateOptions<TData, TVariables> {
  /** 是否在组件卸载时自动 abort（占位预留） */
  autoAbortOnUnmount?: boolean;
}

export interface UseOptimisticMutationReturn<TData, TVariables> {
  /** 触发乐观更新 */
  mutate: (variables: TVariables) => Promise<OptimisticUpdateResult<TData>>;
  /** 状态：loading / error / counts */
  state: OptimisticState;
  /** 重置 state */
  reset: () => void;
}

/**
 * 乐观更新 Hook
 * @param options 配置
 * @returns mutate 函数 + state
 *
 * @example
 * const { mutate, state } = useOptimisticMutation({
 *   optimistic: (item) => setItems((prev) => [...prev, item]),
 *   mutation: (item) => apiFetch('/items', { method: 'POST', body: JSON.stringify(item) }),
 *   rollback: (item) => setItems((prev) => prev.filter((i) => i.id !== item.id)),
 *   onError: (err) => showToast(`操作失败: ${err.message}`),
 * });
 *
 * // 调用
 * const handleAdd = async () => {
 *   const tempItem = { id: generateTempId(), name: 'New' };
 *   await mutate(tempItem);
 * };
 */
export function useOptimisticMutation<TData = unknown, TVariables = unknown>(
  options: UseOptimisticMutationOptions<TData, TVariables>,
): UseOptimisticMutationReturn<TData, TVariables> {
  const { optimistic, mutation, rollback, onSuccess, onError, onSettled } = options;

  const [state, setState] = useState<OptimisticState>({
    isLoading: false,
    error: null,
    successCount: 0,
    errorCount: 0,
  });

  // 防止重入（同一 mutation 串行）
  const inFlightRef = useRef<boolean>(false);

  // 用 ref 保存最新 options（避免 useEffect 重置）
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(
    async (variables: TVariables): Promise<OptimisticUpdateResult<TData>> => {
      if (inFlightRef.current) {
        // 同一时刻仅允许一个 mutation（避免状态混乱）
        return {
          success: false,
          error: new Error('已有 mutation 在进行中，请稍候'),
        };
      }

      inFlightRef.current = true;
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const result = await optimisticUpdate<TData, TVariables>(
        {
          optimistic,
          mutation,
          rollback,
          onSuccess,
          onError,
          onSettled,
        },
        variables,
      );

      inFlightRef.current = false;

      setState((prev) => ({
        isLoading: false,
        error: result.error || null,
        successCount: prev.successCount + (result.success ? 1 : 0),
        errorCount: prev.errorCount + (result.success ? 0 : 1),
      }));

      return result;
    },
    [optimistic, mutation, rollback, onSuccess, onError, onSettled],
  );

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      error: null,
      successCount: 0,
      errorCount: 0,
    });
  }, []);

  return { mutate, state, reset };
}

export default useOptimisticMutation;
