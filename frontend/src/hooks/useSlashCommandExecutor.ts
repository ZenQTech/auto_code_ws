/**
 * # ============================================================
 * useSlashCommandExecutor - Slash Command 执行 Hook
 * # ============================================================
 * 核心作用：执行 Slash Commands 并管理执行历史
 * 封装 API：
 *   - useSlashCommandExecutor() - 核心执行器
 *   - executeSlashCommand() - 一次性执行（无需 hook 状态）
 *   - useSlashCommandHistory() - 加载执行历史
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from './apiShared';
import type { ExecutionResult } from './slashCommandShared';

// ============================================================
// 类型定义
// ============================================================

/** 执行上下文 */
export interface ExecutionContext {
  user_id?: string;
  session_id?: string;
  project?: string;
  app_mode?: 'chat' | 'coding' | null;
  extra?: Record<string, unknown>;
}

/** Hook 返回值 */
export interface UseSlashCommandExecutorResult {
  /** 执行命令 */
  execute: (command: string, args?: string[], context?: ExecutionContext) => Promise<ExecutionResult>;
  /** 最后一次执行结果 */
  lastResult: ExecutionResult | null;
  /** 正在执行中 */
  isExecuting: boolean;
  /** 执行历史 */
  history: ExecutionResult[];
  /** 错误 */
  error: Error | null;
  /** 清空历史 */
  clearHistory: () => Promise<void>;
  /** 重新加载历史 */
  refetchHistory: () => Promise<void>;
}

// ============================================================
// Hook: 执行器
// ============================================================

/**
 * useSlashCommandExecutor - 执行 Slash Commands 并管理历史
 *
 * @param options.autoLoadHistory 是否在挂载时自动加载历史（默认 true）
 * @param options.historyLimit 历史记录上限（默认 50）
 */
export function useSlashCommandExecutor(
  options: { autoLoadHistory?: boolean; historyLimit?: number } = {}
): UseSlashCommandExecutorResult {
  const { autoLoadHistory = true, historyLimit = 50 } = options;

  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [history, setHistory] = useState<ExecutionResult[]>([]);
  const [error, setError] = useState<Error | null>(null);

  // 防止 unmount 后 setState
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (
      command: string,
      args: string[] = [],
      context: ExecutionContext = {}
    ): Promise<ExecutionResult> => {
      setIsExecuting(true);
      setError(null);
      try {
        const result = await apiFetch<ExecutionResult>('/slash-commands/execute', {
          method: 'POST',
          body: JSON.stringify({ command, args, context }),
        });
        if (mountedRef.current) {
          setLastResult(result);
          // 添加到本地历史（去重最新）
          setHistory((prev) => {
            const next = [result, ...prev];
            return next.slice(0, historyLimit);
          });
        }
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        // 构造失败结果
        const failedResult: ExecutionResult = {
          command,
          status: 'failed',
          message: `执行失败: ${e.message}`,
          data: null,
          duration_ms: 0,
          error: e.message,
        };
        if (mountedRef.current) {
          setLastResult(failedResult);
          setHistory((prev) => [failedResult, ...prev].slice(0, historyLimit));
        }
        return failedResult;
      } finally {
        if (mountedRef.current) setIsExecuting(false);
      }
    },
    [historyLimit]
  );

  const refetchHistory = useCallback(async () => {
    try {
      const result = await apiFetch<{ history: ExecutionResult[] }>(
        `/slash-commands/history/list?limit=${historyLimit}`
      );
      if (mountedRef.current) {
        setHistory(result.history || []);
      }
    } catch (err) {
      // 静默失败
      console.warn('[useSlashCommandExecutor] 加载历史失败:', err);
    }
  }, [historyLimit]);

  const clearHistory = useCallback(async () => {
    try {
      await apiFetch('/slash-commands/history/clear', { method: 'POST' });
      if (mountedRef.current) setHistory([]);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setError(e);
      throw e;
    }
  }, []);

  // 自动加载历史
  useEffect(() => {
    if (autoLoadHistory) {
      refetchHistory();
    }
  }, [autoLoadHistory, refetchHistory]);

  return {
    execute,
    lastResult,
    isExecuting,
    history,
    error,
    clearHistory,
    refetchHistory,
  };
}

// ============================================================
// 独立函数: 一次性执行
// ============================================================

/**
 * executeSlashCommand - 一次性执行命令（不需要响应式状态）
 *
 * 适用于一次性操作，例如用户从键盘快捷键触发命令
 */
export async function executeSlashCommand(
  command: string,
  args: string[] = [],
  context: ExecutionContext = {}
): Promise<ExecutionResult> {
  return apiFetch<ExecutionResult>('/slash-commands/execute', {
    method: 'POST',
    body: JSON.stringify({ command, args, context }),
  });
}

// ============================================================
// Hook: 历史查看器
// ============================================================

export interface UseSlashCommandHistoryResult {
  history: ExecutionResult[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * useSlashCommandHistory - 仅加载执行历史
 */
export function useSlashCommandHistory(
  options: { limit?: number; autoLoad?: boolean } = {}
): UseSlashCommandHistoryResult {
  const { limit = 50, autoLoad = true } = options;
  const [history, setHistory] = useState<ExecutionResult[]>([]);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ history: ExecutionResult[] }>(
        `/slash-commands/history/list?limit=${limit}`
      );
      if (mountedRef.current) {
        setHistory(result.history || []);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [limit]);

  const clear = useCallback(async () => {
    try {
      await apiFetch('/slash-commands/history/clear', { method: 'POST' });
      if (mountedRef.current) setHistory([]);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, []);

  useEffect(() => {
    if (autoLoad) refetch();
  }, [autoLoad, refetch]);

  return { history, loading, error, refetch, clear };
}

// ============================================================
// 默认导出
// ============================================================

export default useSlashCommandExecutor;
