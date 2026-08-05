/**
 * # ============================================================
 * # useThinkingStream Hook (v1.0.0)
 * # Cycle 67 G67-01
 * # ====================================
 * # 核心作用：封装 ThinkingStream 相关的状态管理
 * # 功能：
 * #   1. 从 REST API 加载历史 thinking steps
 * #   2. 通过 WebSocket 订阅实时 thinking_* 事件
 * #   3. 维护 current step（增量更新 content）
 * #   4. 已完成 step 推入 history 列表
 * #   5. 提供 clear / refresh / export 等操作
 * #   6. 节流：避免高频 delta 触发频繁 re-render
 * # 输入参数：sessionId, wsUrl, options
 * # 输出结果：状态 + actions
 * # 对标：Codex PR #6006 reasoning stream
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
 * # ====================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ============================================================
// 类型定义
// ====================================

export type ThinkingStatus = 'running' | 'completed' | 'truncated';

export interface ThinkingStep {
  step_id: string;
  session_id: string;
  agent_id: string;
  step_index: number;
  content: string;
  started_at: number;
  ended_at: number | null;
  status: ThinkingStatus;
  summary: string;
  model: string;
  tokens: number;
  duration_ms: number;
  metadata: Record<string, any>;
}

export interface ThinkingStats {
  session_id: string;
  total_steps: number;
  total_tokens: number;
  running_steps: number;
  completed_steps: number;
  truncated_steps: number;
  total_duration_ms: number;
}

export interface UseThinkingStreamOptions {
  sessionId: string;
  /** WebSocket URL（可选，未提供时只使用 REST） */
  wsUrl?: string;
  /** 是否自动连接 WebSocket */
  autoConnect?: boolean;
  /** 初始是否自动加载历史 */
  autoLoad?: boolean;
  /** delta 节流间隔（ms） */
  throttleMs?: number;
  /** REST API base URL */
  baseUrl?: string;
  /** 最大保留 step 数量（前端限制） */
  maxSteps?: number;
}

export interface UseThinkingStreamResult {
  // 数据
  steps: ThinkingStep[];
  currentStep: ThinkingStep | null;
  isStreaming: boolean;
  totalSteps: number;
  totalTokens: number;
  totalDurationMs: number;
  stats: ThinkingStats | null;

  // 状态
  loading: boolean;
  error: string | null;
  connected: boolean;

  // 操作
  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;
  clear: () => Promise<void>;
  exportThinking: (format?: 'json' | 'markdown') => Promise<string>;
  reconnect: () => void;
  clearError: () => void;
}

// ============================================================
// 常量
// ====================================

const DEFAULT_BASE_URL = '/api/thinking';
const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_MAX_STEPS = 200;

// ============================================================
// Hook 实现
// ====================================

export function useThinkingStream(
  options: UseThinkingStreamOptions,
): UseThinkingStreamResult {
  const {
    sessionId,
    wsUrl,
    autoConnect = true,
    autoLoad = true,
    throttleMs = DEFAULT_THROTTLE_MS,
    baseUrl = DEFAULT_BASE_URL,
    maxSteps = DEFAULT_MAX_STEPS,
  } = options;

  // ====================================================
  // 状态
  // ====================================================
  const [steps, setSteps] = useState<ThinkingStep[]>([]);
  const [currentStep, setCurrentStep] = useState<ThinkingStep | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<ThinkingStats | null>(null);

  // 派生数据
  const totalSteps = steps.length;
  const totalTokens = useMemo(
    () => steps.reduce((sum, s) => sum + (s.tokens || 0), 0),
    [steps],
  );
  const totalDurationMs = useMemo(
    () => steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0),
    [steps],
  );

  // 引用
  const wsRef = useRef<WebSocket | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeltaRef = useRef<{
    step_id: string;
    delta: string;
  } | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // ====================================================
  // 错误处理
  // ====================================================
  const handleError = useCallback((err: unknown, op: string) => {
    let msg = `Unknown error in ${op}`;
    if (err instanceof Error) msg = err.message;
    else if (typeof err === 'string') msg = err;
    setError(msg);
    // eslint-disable-next-line no-console
    console.error(`[useThinkingStream] ${op}:`, err);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ====================================================
  // REST API 调用
  // ====================================================
  const refresh = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await fetch(
        `${baseUrl}/${encodeURIComponent(sessionId)}?limit=${maxSteps}`,
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.steps) {
        setSteps(data.steps as ThinkingStep[]);
      }
      setError(null);
    } catch (err) {
      handleError(err, 'refresh');
    } finally {
      setLoading(false);
    }
  }, [sessionId, baseUrl, maxSteps, handleError]);

  const refreshStats = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    try {
      const resp = await fetch(
        `${baseUrl}/${encodeURIComponent(sessionId)}/stats`,
      );
      if (!resp.ok) return;
      const data = await resp.json();
      setStats(data as ThinkingStats);
    } catch {
      // 静默
    }
  }, [sessionId, baseUrl]);

  const clear = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    try {
      const resp = await fetch(
        `${baseUrl}/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      setSteps([]);
      setCurrentStep(null);
      setIsStreaming(false);
      setError(null);
      void refreshStats();
    } catch (err) {
      handleError(err, 'clear');
    }
  }, [sessionId, baseUrl, handleError, refreshStats]);

  const exportThinking = useCallback(
    async (format: 'json' | 'markdown' = 'json'): Promise<string> => {
      if (!sessionId) return '';
      const resp = await fetch(
        `${baseUrl}/${encodeURIComponent(sessionId)}/export?format=${format}`,
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (format === 'json') {
        return JSON.stringify(data, null, 2);
      }
      return data.content || '';
    },
    [sessionId, baseUrl],
  );

  // ====================================================
  // WebSocket 事件处理
  // ====================================================
  const flushPendingDelta = useCallback(() => {
    const pending = pendingDeltaRef.current;
    if (!pending) return;
    pendingDeltaRef.current = null;
    throttleTimerRef.current = null;

    setCurrentStep((prev) => {
      if (!prev || prev.step_id !== pending.step_id) return prev;
      return {
        ...prev,
        content: prev.content + pending.delta,
        tokens: (prev.tokens || 0) + 1,
      };
    });
  }, []);

  const handleThinkingStart = useCallback((data: any) => {
    const newStep: ThinkingStep = {
      step_id: data.step_id,
      session_id: data.session_id || '',
      agent_id: data.agent_id || '',
      step_index: data.step_index ?? 0,
      content: '',
      started_at: Date.now() / 1000,
      ended_at: null,
      status: 'running',
      summary: '',
      model: data.model || '',
      tokens: 0,
      duration_ms: 0,
      metadata: data.metadata || {},
    };
    setCurrentStep(newStep);
    setIsStreaming(true);
  }, []);

  const handleThinkingDelta = useCallback(
    (data: any) => {
      // 节流：累积 delta 到 pending 引用
      pendingDeltaRef.current = {
        step_id: data.step_id,
        delta: data.delta || '',
      };
      if (throttleTimerRef.current == null) {
        throttleTimerRef.current = setTimeout(flushPendingDelta, throttleMs);
      }
    },
    [flushPendingDelta, throttleMs],
  );

  const handleThinkingEnd = useCallback((data: any) => {
    // 立即 flush pending delta
    if (throttleTimerRef.current != null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    pendingDeltaRef.current = null;

    setCurrentStep((prev) => {
      if (!prev || prev.step_id !== data.step_id) return prev;
      const endedStep: ThinkingStep = {
        ...prev,
        status: 'completed',
        ended_at: Date.now() / 1000,
        summary: data.summary || '',
        tokens: data.tokens ?? prev.tokens,
        duration_ms: data.duration_ms ?? 0,
        metadata: data.metadata
          ? { ...prev.metadata, ...data.metadata }
          : prev.metadata,
      };
      setSteps((s) => [endedStep, ...s].slice(0, maxSteps));
      return null;
    });
    setIsStreaming(false);
    // 触发统计刷新
    void refreshStats();
  }, [maxSteps, refreshStats]);

  const handleWebSocketMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type || msg.event_type;
        const data = msg.payload || msg.data || {};
        switch (type) {
          case 'thinking_start':
          case 'ThinkingStart':
            handleThinkingStart(data);
            break;
          case 'thinking_delta':
          case 'ThinkingDelta':
            handleThinkingDelta(data);
            break;
          case 'thinking_end':
          case 'ThinkingEnd':
            handleThinkingEnd(data);
            break;
          default:
            // 忽略其他事件
            break;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useThinkingStream] WS parse error:', err);
      }
    },
    [handleThinkingStart, handleThinkingDelta, handleThinkingEnd],
  );

  // ====================================================
  // WebSocket 连接管理
  // ====================================================
  const connectWebSocket = useCallback(() => {
    if (!wsUrl || !sessionId) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const url = `${wsUrl}?session_id=${encodeURIComponent(sessionId)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptsRef.current = 0;
        // 订阅 thinking 事件
        ws.send(JSON.stringify({
          type: 'subscribe',
          events: ['thinking_start', 'thinking_delta', 'thinking_end'],
          session_id: sessionId,
        }));
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = () => {
        // 错误处理在 onclose
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // 自动重连（最多 5 次）
        if (
          mountedRef.current &&
          autoConnect &&
          reconnectAttemptsRef.current < 5
        ) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
          setTimeout(connectWebSocket, delay);
        }
      };
    } catch (err) {
      handleError(err, 'connectWebSocket');
    }
  }, [wsUrl, sessionId, autoConnect, handleWebSocketMessage, handleError]);

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // 忽略
      }
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnectWebSocket();
    reconnectAttemptsRef.current = 0;
    connectWebSocket();
  }, [disconnectWebSocket, connectWebSocket]);

  // ====================================================
  // 副作用
  // ====================================================

  // 初始加载
  useEffect(() => {
    if (autoLoad && sessionId) {
      void refresh();
      void refreshStats();
    }
  }, [autoLoad, sessionId, refresh, refreshStats]);

  // WebSocket 连接
  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect && sessionId && wsUrl) {
      connectWebSocket();
    }
    return () => {
      mountedRef.current = false;
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      disconnectWebSocket();
    };
  }, [autoConnect, sessionId, wsUrl, connectWebSocket, disconnectWebSocket]);

  // sessionId 变化时重置
  useEffect(() => {
    setSteps([]);
    setCurrentStep(null);
    setIsStreaming(false);
    setStats(null);
  }, [sessionId]);

  return {
    // 数据
    steps,
    currentStep,
    isStreaming,
    totalSteps,
    totalTokens,
    totalDurationMs,
    stats,

    // 状态
    loading,
    error,
    connected,

    // 操作
    refresh,
    refreshStats,
    clear,
    exportThinking,
    reconnect,
    clearError,
  };
}
