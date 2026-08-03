/**
 * # ============================================================
 * useLoopState - Loop 状态机客户端 Hook (v1.0.0)
 * Cycle 58 G58-03
 * # ============================================================
 * 核心作用：订阅 Loop 状态机的实时变更，提供给 LoopStatusBar 显示
 * 运行流程：
 *   1. 启动 SSE 订阅 /api/loop-state/machine/events
 *   2. 接收 loop_state_changed 事件 → 更新 state
 *   3. 接收 history 增量 → 更新 history
 *   4. 计算 progress / eta
 * 设计要点：
 *   - 自动重连
 *   - 节流更新（最多 1s 一次）
 *   - 历史保留最近 100 条
 * 输入参数：{ baseUrl?: string }
 * 输出结果：{ state, progress, eta, history, isLoading, error }
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 * ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ====================================

/** Loop 状态机阶段 */
export type LoopStage =
  | 'idle'
  | 'clarifying'
  | 'designing'
  | 'prompting'
  | 'executing'
  | 'reviewing'
  | 'done'
  | 'paused'
  | 'error';

/** Loop 状态 */
export interface LoopState {
  stage: LoopStage;
  progress: number;
  eta_seconds: number;
  session_id: string;
  sub_state: Record<string, unknown>;
}

/** Loop 状态机迁移记录 */
export interface LoopTransition {
  from_state: string;
  to_state: string;
  at: string;
  metadata: Record<string, unknown>;
}

/** Hook 返回值 */
export interface UseLoopStateResult {
  state: LoopState | null;
  progress: number;
  eta: number;
  history: LoopTransition[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// ============================================================
// 常量
// ====================================

const DEFAULT_BASE_URL = '/api/loop-state';
const MAX_HISTORY = 100;
const isBrowser = typeof window !== 'undefined';

// ============================================================
// Hook 实现
// ====================================

export interface UseLoopStateOptions {
  baseUrl?: string;
  /** 初始 sessionId（可选） */
  sessionId?: string;
  /** 节流间隔（ms） */
  throttleMs?: number;
}

export function useLoopState(options: UseLoopStateOptions = {}): UseLoopStateResult {
  const { baseUrl = DEFAULT_BASE_URL, sessionId, throttleMs = 1000 } = options;
  const [state, setState] = useState<LoopState | null>(null);
  const [history, setHistory] = useState<LoopTransition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<LoopState | null>(null);
  const throttleTimerRef = useRef<number | null>(null);

  // 节流应用更新
  const applyThrottledUpdate = useCallback(
    (newState: LoopState) => {
      const now = Date.now();
      const elapsed = now - lastUpdateRef.current;
      if (elapsed >= throttleMs) {
        lastUpdateRef.current = now;
        setState(newState);
      } else {
        // 缓存并延迟应用
        pendingUpdateRef.current = newState;
        if (throttleTimerRef.current === null) {
          throttleTimerRef.current = window.setTimeout(() => {
            if (pendingUpdateRef.current) {
              lastUpdateRef.current = Date.now();
              setState(pendingUpdateRef.current);
              pendingUpdateRef.current = null;
            }
            throttleTimerRef.current = null;
          }, throttleMs - elapsed);
        }
      }
    },
    [throttleMs]
  );

  // 主动刷新
  const refresh = useCallback(async () => {
    if (!isBrowser) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/machine`);
      if (!res.ok) {
        throw new Error(`Loop state 拉取失败: ${res.status}`);
      }
      const data = (await res.json()) as {
        state: LoopState;
        history: LoopTransition[];
      };
      setState(data.state);
      setHistory(data.history.slice(-MAX_HISTORY));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl]);

  // 订阅 SSE
  useEffect(() => {
    if (!isBrowser) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const url = sessionId
      ? `${baseUrl}/machine/events?session_id=${encodeURIComponent(sessionId)}`
      : `${baseUrl}/machine/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('loop_state_changed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as LoopState;
        applyThrottledUpdate(data);
        // 记录迁移
        setHistory((prev) => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.to_state === data.stage) return prev;
          }
          const next = [
            ...prev,
            {
              from_state: prev.length > 0 ? prev[prev.length - 1].to_state : 'idle',
              to_state: data.stage,
              at: new Date().toISOString(),
              metadata: {},
            },
          ];
          return next.slice(-MAX_HISTORY);
        });
      } catch (err) {
        console.warn('useLoopState: parse failed', err);
      }
    });

    es.onerror = () => {
      // EventSource 自动重连
    };

    // 主动拉取一次
    refresh();

    return () => {
      es.close();
      eventSourceRef.current = null;
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [baseUrl, sessionId, applyThrottledUpdate, refresh]);

  return {
    state,
    progress: state?.progress ?? 0,
    eta: state?.eta_seconds ?? 0,
    history,
    isLoading,
    error,
    refresh,
  };
}

export default useLoopState;
