/**
 * # ============================================================
 * useVibeCoding - Vibe Coding 会话管理 Hook (v1.0.0)
 * Cycle 58 G58-01
 * # ============================================================
 * 核心作用：管理 Vibe Coding 会话的状态机（idle/clarifying/planning/executing/reviewing/done/paused/cancelled/error）
 * 运行流程：
 *   1. 用户点击「开始」→ 创建 session → 进入 clarifying 阶段
 *   2. 总架构师（clarification_service）发起澄清问题
 *   3. 用户回答 → 进入 planning 阶段
 *   4. AI 生成 Plan → 用户确认 → 进入 executing 阶段
 *   5. 按 Plan step 逐步执行 → 进入 reviewing 阶段
 *   6. 质量保障智能体审核 → 进入 done 阶段
 *   7. 用户可随时 pause/resume/cancel
 * 设计要点：
 *   - 通过 SSE 订阅服务端状态变更
 *   - 本地状态机与服务端状态机同步
 *   - 失败重试机制（最多 3 次）
 * 输入参数：{ initialSessionId?: string }
 * 输出结果：{ session, state, startSession, pause, resume, cancel, isLoading, error }
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-01 初次创建
 * ============================================================
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

// ============================================================
// 类型定义
// ============================================================

/** Vibe Coding 会话状态机阶段 */
export type VibeState =
  | 'idle'
  | 'clarifying'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'done'
  | 'paused'
  | 'cancelled'
  | 'error';

/** Vibe Coding 会话 */
export interface VibeSession {
  id: string;
  prompt: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  state: VibeState;
  planId?: string;
  steps: VibeStep[];
  metrics: {
    tokens: number;
    duration: number;
    filesChanged: number;
  };
}

/** Vibe Coding 单步 */
export interface VibeStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  retryCount?: number;
}

/** Hook 返回值 */
export interface UseVibeCodingResult {
  session: VibeSession | null;
  state: VibeState;
  isLoading: boolean;
  error: string | null;
  startSession: (prompt: string, model?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  /** v1.1.0 G60-2.2 新增：清空当前 session（重置本地状态） */
  clearSession: () => void;
  /** v1.1.0 G60-2.2 新增：恢复/订阅指定历史 session */
  resumeSession: (sessionId: string) => Promise<void>;
  retryStep: (stepId: string) => Promise<void>;
  /** 已完成的 step 折叠列表 */
  completedSteps: VibeStep[];
}

// ============================================================
// 内部状态管理
// ============================================================

interface VibeCodingState {
  session: VibeSession | null;
  state: VibeState;
  isLoading: boolean;
  error: string | null;
}

type VibeCodingAction =
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_SESSION'; session: VibeSession }
  | { type: 'UPDATE_STATE'; state: VibeState }
  | { type: 'UPDATE_STEP'; step: VibeStep }
  | { type: 'RESET' };

const INITIAL_STATE: VibeCodingState = {
  session: null,
  state: 'idle',
  isLoading: false,
  error: null,
};

function vibeCodingReducer(
  state: VibeCodingState,
  action: VibeCodingAction
): VibeCodingState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_SESSION':
      return {
        ...state,
        session: action.session,
        state: action.session.state,
        error: null,
      };
    case 'UPDATE_STATE':
      return {
        ...state,
        state: action.state,
        session: state.session
          ? { ...state.session, state: action.state, updatedAt: new Date().toISOString() }
          : null,
      };
    case 'UPDATE_STEP':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          steps: state.session.steps.map((s) =>
            s.id === action.step.id ? action.step : s
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ============================================================
// 辅助函数
// ====================================

/** 浏览器环境检测 */
const isBrowser = typeof window !== 'undefined';

/** 默认 base URL */
const DEFAULT_BASE_URL = '/api/vibe-coding';

// ============================================================
// Hook 实现
// ============================================================

export interface UseVibeCodingOptions {
  initialSessionId?: string;
  baseUrl?: string;
}

export function useVibeCoding(options: UseVibeCodingOptions = {}): UseVibeCodingResult {
  const { initialSessionId, baseUrl = DEFAULT_BASE_URL } = options;
  const [state, dispatch] = useReducer(vibeCodingReducer, INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 订阅 SSE 事件
  const subscribeSSE = useCallback((sessionId: string) => {
    if (!isBrowser) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = new EventSource(`${baseUrl}/session/${sessionId}/events`);
    eventSourceRef.current = es;

    es.addEventListener('vibe_session_started', (e: MessageEvent) => {
      try {
        const session = JSON.parse(e.data) as VibeSession;
        dispatch({ type: 'SET_SESSION', session });
      } catch (err) {
        console.warn('useVibeCoding: parse session failed', err);
      }
    });

    es.addEventListener('vibe_state_changed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { state: VibeState };
        dispatch({ type: 'UPDATE_STATE', state: data.state });
      } catch (err) {
        console.warn('useVibeCoding: parse state failed', err);
      }
    });

    es.addEventListener('vibe_step_completed', (e: MessageEvent) => {
      try {
        const step = JSON.parse(e.data) as VibeStep;
        dispatch({ type: 'UPDATE_STEP', step });
      } catch (err) {
        console.warn('useVibeCoding: parse step failed', err);
      }
    });

    es.addEventListener('vibe_step_started', (e: MessageEvent) => {
      try {
        const step = JSON.parse(e.data) as VibeStep;
        dispatch({ type: 'UPDATE_STEP', step });
      } catch (err) {
        console.warn('useVibeCoding: parse step started failed', err);
      }
    });

    es.addEventListener('vibe_step_failed', (e: MessageEvent) => {
      try {
        const step = JSON.parse(e.data) as VibeStep;
        dispatch({ type: 'UPDATE_STEP', step });
      } catch (err) {
        console.warn('useVibeCoding: parse step failed', err);
      }
    });

    es.onerror = (err) => {
      console.warn('useVibeCoding: SSE error', err);
      // 自动重连由浏览器 EventSource 处理
    };
  }, [baseUrl]);

  // 启动 session
  const startSession = useCallback(
    async (prompt: string, model: string = 'claude-sonnet-4-20250514') => {
      if (!isBrowser) return;
      if (!prompt || prompt.trim().length === 0) {
        dispatch({ type: 'SET_ERROR', error: 'prompt 不能为空' });
        return;
      }
      if (prompt.length > 10000) {
        dispatch({ type: 'SET_ERROR', error: 'prompt 长度不能超过 10000 字符' });
        return;
      }
      dispatch({ type: 'SET_LOADING', isLoading: true });
      dispatch({ type: 'SET_ERROR', error: null });

      try {
        const res = await fetch(`${baseUrl}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model }),
        });
        if (!res.ok) {
          throw new Error(`创建 session 失败: ${res.status}`);
        }
        const session = (await res.json()) as VibeSession;
        dispatch({ type: 'SET_SESSION', session });
        subscribeSSE(session.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'SET_ERROR', error: message });
      } finally {
        dispatch({ type: 'SET_LOADING', isLoading: false });
      }
    },
    [baseUrl, subscribeSSE]
  );

  // 暂停
  const pause = useCallback(async () => {
    if (!state.session) return;
    try {
      const res = await fetch(`${baseUrl}/session/${state.session.id}/pause`, {
        method: 'POST',
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_STATE', state: 'paused' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_ERROR', error: message });
    }
  }, [state.session, baseUrl]);

  // 恢复
  const resume = useCallback(async () => {
    if (!state.session) return;
    try {
      const res = await fetch(`${baseUrl}/session/${state.session.id}/resume`, {
        method: 'POST',
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_STATE', state: 'executing' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_ERROR', error: message });
    }
  }, [state.session, baseUrl]);

  // 取消
  const cancel = useCallback(async () => {
    if (!state.session) return;
    try {
      const res = await fetch(`${baseUrl}/session/${state.session.id}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_STATE', state: 'cancelled' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_ERROR', error: message });
    }
  }, [state.session, baseUrl]);

  // v1.1.0 G60-2.2 新增：清空当前 session
  const clearSession = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  // v1.1.0 G60-2.2 新增：恢复/订阅指定历史 session
  const resumeSession = useCallback(
    async (sessionId: string) => {
      if (!isBrowser) return;
      if (!sessionId) {
        dispatch({ type: 'SET_ERROR', error: 'sessionId 不能为空' });
        return;
      }
      dispatch({ type: 'SET_LOADING', isLoading: true });
      dispatch({ type: 'SET_ERROR', error: null });
      try {
        const res = await fetch(`${baseUrl}/session/${sessionId}`);
        if (!res.ok) {
          throw new Error(`Session 拉取失败: ${res.status}`);
        }
        const data = (await res.json()) as { session: VibeSession };
        dispatch({ type: 'SET_SESSION', session: data.session });
        subscribeSSE(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'SET_ERROR', error: message });
      } finally {
        dispatch({ type: 'SET_LOADING', isLoading: false });
      }
    },
    [baseUrl, subscribeSSE],
  );

  // 重试 step
  const retryStep = useCallback(
    async (stepId: string) => {
      if (!state.session) return;
      try {
        const res = await fetch(`${baseUrl}/session/${state.session.id}/step/${stepId}/retry`, {
          method: 'POST',
        });
        if (res.ok) {
          const step = (await res.json()) as VibeStep;
          dispatch({ type: 'UPDATE_STEP', step });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'SET_ERROR', error: message });
      }
    },
    [state.session, baseUrl]
  );

  // 初始化：若提供 initialSessionId 则订阅
  useEffect(() => {
    if (initialSessionId) {
      subscribeSSE(initialSessionId);
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [initialSessionId, subscribeSSE]);

  // 派生：已完成的 steps
  const completedSteps = (state.session?.steps ?? []).filter(
    (s) => s.status === 'completed'
  );

  return {
    session: state.session,
    state: state.state,
    isLoading: state.isLoading,
    error: state.error,
    startSession,
    pause,
    resume,
    cancel,
    clearSession, // v1.1.0 G60-2.2
    resumeSession, // v1.1.0 G60-2.2
    retryStep,
    completedSteps,
  };
}

export default useVibeCoding;
