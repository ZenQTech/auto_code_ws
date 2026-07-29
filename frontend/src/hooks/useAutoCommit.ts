/**
 * # ============================================================
 * # useAutoCommit 自动提交 Hook（v6.40.0 P2-6）
 * # ============================================================
 * # 核心作用：为业务组件提供"修改后自动提交"能力
 * #           集成后端 /api/git/commit 端点
 * #           支持防抖（避免短时间内多次提交）+ 节流
 * # 运行流程：
 * #   1. 接收 task_id/task_name + debounceMs
 * #   2. 业务代码调用 scheduleAutoCommit() 触发提交
 * #   3. 防抖窗口内多次调用合并为一次
 * #   4. 调用 /api/git/commit，loading/error 状态暴露
 * # 输入参数：见 UseAutoCommitOptions
 * # 输出结果：{ scheduleAutoCommit, commitNow, loading, error, lastCommit }
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-6 新建
 * # ============================================================
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseAutoCommitOptions {
  /** 任务 ID（用于 commit message） */
  taskId: string;
  /** 任务名称（用于 commit message） */
  taskName: string;
  /** 提交模式（per_module / milestone / disabled） */
  mode?: 'per_module' | 'milestone' | 'disabled';
  /** 里程碑类型（仅 mode=milestone） */
  milestone?: 'architecture_confirmed' | 'all_modules_done' | 'integration_passed' | 'final_delivery';
  /** 防抖延迟（毫秒，默认 5000） */
  debounceMs?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 自定义 fetcher */
  fetcher?: (payload: AutoCommitPayload) => Promise<AutoCommitResult>;
}

export interface AutoCommitPayload {
  task_id: string;
  task_name: string;
  mode?: string;
  milestone?: string;
  force?: boolean;
}

export interface AutoCommitResult {
  success: boolean;
  message: string;
  commit_hash?: string;
}

export interface UseAutoCommitResult {
  /** 调度一次自动提交（防抖） */
  scheduleAutoCommit: () => void;
  /** 立即执行一次提交（无防抖） */
  commitNow: () => Promise<AutoCommitResult | null>;
  /** 是否正在提交 */
  loading: boolean;
  /** 错误对象 */
  error: Error | null;
  /** 最后一次提交结果 */
  lastCommit: AutoCommitResult | null;
  /** 是否有待提交的修改 */
  hasPending: boolean;
}

const DEFAULT_API_BASE = '/api';

/**
 * 默认 fetcher：调用后端 /api/git/commit
 */
async function defaultFetcher(payload: AutoCommitPayload): Promise<AutoCommitResult> {
  const url = `${DEFAULT_API_BASE}/git/commit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auto commit failed: ${response.status} ${text}`);
  }
  return response.json();
}

/**
 * useAutoCommit 自动提交 Hook
 *
 * 用法：
 * ```typescript
 * const { scheduleAutoCommit, loading } = useAutoCommit({
 *   taskId: 'P2-5',
 *   taskName: 'Loading 状态规范',
 *   debounceMs: 5000,
 * });
 *
 * // 修改后调用
 * scheduleAutoCommit();
 * ```
 */
export function useAutoCommit(options: UseAutoCommitOptions): UseAutoCommitResult {
  const {
    taskId,
    taskName,
    mode = 'per_module',
    milestone,
    debounceMs = 5000,
    enabled = true,
    fetcher,
  } = options;

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastCommit, setLastCommit] = useState<AutoCommitResult | null>(null);
  const [hasPending, setHasPending] = useState<boolean>(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // 清理 debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const executeCommit = useCallback(async (): Promise<AutoCommitResult | null> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setHasPending(false);

    try {
      const fn = fetcherRef.current ?? defaultFetcher;
      const payload: AutoCommitPayload = {
        task_id: taskId,
        task_name: taskName,
        mode,
        milestone,
      };
      const result = await fn(payload);
      setLastCommit(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [taskId, taskName, mode, milestone]);

  const commitNow = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return executeCommit();
  }, [executeCommit]);

  const scheduleAutoCommit = useCallback(() => {
    if (!enabled) return;
    setHasPending(true);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      executeCommit();
    }, debounceMs);
  }, [enabled, debounceMs, executeCommit]);

  return {
    scheduleAutoCommit,
    commitNow,
    loading,
    error,
    lastCommit,
    hasPending,
  };
}

export default useAutoCommit;
