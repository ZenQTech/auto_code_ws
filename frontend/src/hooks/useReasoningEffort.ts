/**
 * # ============================================================
 * # useReasoningEffort Hook (v1.0.0)
 * # Cycle 66 G66-01
 * # ====================================
 * # 核心作用：封装 reasoning effort API 调用
 * # 功能：
 * #   1. 获取/设置 agent 的 reasoning effort
 * #   2. 自动轮询（可选）
 * #   3. 错误处理
 * #   4. 历史记录查询
 * #   5. 快捷键支持（increase/decrease/cycle）
 * # 输入参数：agentId, options
 * # 输出结果：状态 + actions
 * # 对标：Codex CLI model_reasoning_effort
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 66 G66-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ChangeSource = 'user' | 'keyboard' | 'api' | 'csv';

export interface ReasoningChange {
  effort: ReasoningEffort;
  previous_effort: ReasoningEffort | string;
  timestamp: number;
  source: ChangeSource | string;
}

export interface UseReasoningEffortOptions {
  agentId: string;
  defaultEffort?: ReasoningEffort;
  autoRefresh?: boolean;
  refreshMs?: number;
  baseUrl?: string;
}

export interface UseReasoningEffortResult {
  effort: ReasoningEffort;
  previousEffort: ReasoningEffort | null;
  isUpdating: boolean;
  loading: boolean;
  error: string | null;
  history: ReasoningChange[];
  updatedAt: number;

  setEffort: (effort: ReasoningEffort, source?: ChangeSource) => Promise<boolean>;
  increase: (source?: ChangeSource) => Promise<void>;
  decrease: (source?: ChangeSource) => Promise<void>;
  cycle: (source?: ChangeSource) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/agent-roles';
const DEFAULT_REFRESH_MS = 0; // 默认不自动轮询
const EFFORT_ORDER: ReasoningEffort[] = ['low', 'medium', 'high'];

// ============================================================
// Hook
// ============================================================

export function useReasoningEffort(
  options: UseReasoningEffortOptions,
): UseReasoningEffortResult {
  const {
    agentId,
    defaultEffort = 'medium',
    autoRefresh = false,
    refreshMs = DEFAULT_REFRESH_MS,
    baseUrl = DEFAULT_BASE_URL,
  } = options;

  // 状态
  const [effort, setEffortState] = useState<ReasoningEffort>(defaultEffort);
  const [previousEffort, setPreviousEffort] = useState<ReasoningEffort | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ReasoningChange[]>([]);
  const [updatedAt, setUpdatedAt] = useState(0);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // 错误处理
  // ============================================================

  const handleError = useCallback((err: unknown, op: string) => {
    let msg = `Unknown error in ${op}`;
    if (err instanceof Error) msg = err.message;
    else if (typeof err === 'string') msg = err;
    setError(msg);
    // eslint-disable-next-line no-console
    console.error(`[useReasoningEffort] ${op}:`, err);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ============================================================
  // API 调用
  // ============================================================

  const refresh = useCallback(async (): Promise<void> => {
    if (!agentId) return;
    setLoading(true);
    try {
      const resp = await fetch(`${baseUrl}/instances/${agentId}/reasoning`);
      if (!resp.ok) {
        if (resp.status === 404) {
          setError(`Agent not found: ${agentId}`);
        } else {
          setError(`HTTP ${resp.status}`);
        }
        return;
      }
      const data = await resp.json();
      if (data.effort) {
        setEffortState(data.effort as ReasoningEffort);
        setUpdatedAt(data.updated_at || 0);
      }
    } catch (err) {
      handleError(err, 'refresh');
    } finally {
      setLoading(false);
    }
  }, [agentId, baseUrl, handleError]);

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (!agentId) return;
    try {
      const resp = await fetch(
        `${baseUrl}/instances/${agentId}/reasoning/history?limit=20`,
      );
      if (!resp.ok) {
        return; // 静默失败，不影响主流程
      }
      const data = await resp.json();
      if (data.history) {
        setHistory(data.history as ReasoningChange[]);
      }
    } catch (err) {
      // 静默
    }
  }, [agentId, baseUrl]);

  const setEffort = useCallback(
    async (newEffort: ReasoningEffort, source: ChangeSource = 'user'): Promise<boolean> => {
      if (!agentId) return false;
      if (!EFFORT_ORDER.includes(newEffort)) {
        setError(`Invalid effort: ${newEffort}`);
        return false;
      }
      setIsUpdating(true);
      setError(null);
      try {
        const resp = await fetch(
          `${baseUrl}/instances/${agentId}/reasoning`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ effort: newEffort }),
          },
        );
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.effort) {
          setEffortState(data.effort as ReasoningEffort);
        }
        if (data.previous_effort) {
          setPreviousEffort(data.previous_effort as ReasoningEffort);
        }
        if (data.updated_at) {
          setUpdatedAt(data.updated_at);
        }
        // 记录 source（用于审计）
        // eslint-disable-next-line no-console
        console.debug(`[useReasoningEffort] set via ${source}: ${newEffort}`);
        // 刷新历史
        void refreshHistory();
        return true;
      } catch (err) {
        handleError(err, 'setEffort');
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [agentId, baseUrl, handleError, refreshHistory],
  );

  // ============================================================
  // 快捷操作
  // ============================================================

  const increase = useCallback(
    async (source: ChangeSource = 'user') => {
      const idx = EFFORT_ORDER.indexOf(effort);
      // 提高 effort（low → medium → high）
      const next = EFFORT_ORDER[Math.min(2, idx + 1)];
      if (next !== effort) {
        await setEffort(next, source);
      }
    },
    [effort, setEffort],
  );

  const decrease = useCallback(
    async (source: ChangeSource = 'user') => {
      const idx = EFFORT_ORDER.indexOf(effort);
      // 降低 effort（high → medium → low）
      const next = EFFORT_ORDER[Math.max(0, idx - 1)];
      if (next !== effort) {
        await setEffort(next, source);
      }
    },
    [effort, setEffort],
  );

  const cycle = useCallback(
    async (source: ChangeSource = 'user') => {
      const idx = EFFORT_ORDER.indexOf(effort);
      const next = EFFORT_ORDER[(idx + 1) % EFFORT_ORDER.length];
      await setEffort(next, source);
    },
    [effort, setEffort],
  );

  // ============================================================
  // 副作用
  // ============================================================

  // 初始加载
  useEffect(() => {
    if (agentId) {
      void refresh();
      void refreshHistory();
    }
  }, [agentId, refresh, refreshHistory]);

  // 自动轮询
  useEffect(() => {
    if (autoRefresh && refreshMs > 0 && agentId) {
      pollTimerRef.current = setInterval(() => {
        void refresh();
      }, refreshMs);
      return () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }
    return undefined;
  }, [autoRefresh, refreshMs, agentId, refresh]);

  // 清理
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  return {
    effort,
    previousEffort,
    isUpdating,
    loading,
    error,
    history,
    updatedAt,
    setEffort,
    increase,
    decrease,
    cycle,
    refresh,
    clearError,
  };
}

export { EFFORT_ORDER };
