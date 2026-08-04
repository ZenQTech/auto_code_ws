/**
 * # ============================================================
 * # useStage Hook (v1.0.0)
 * # Cycle 63 G63-03
 * # ====================================
 * # 核心作用：封装阶段检测器 API + WebSocket 订阅
 * # 运行流程：
 * #   1. 获取/强制设置当前阶段
 * #   2. 从文本检测阶段
 * #   3. 启用/禁用 Auto-Follow
 * #   4. WebSocket 实时订阅阶段变化
 * # 输入参数：sessionId, baseUrl, wsUrl
 * # 输出结果：UseStageResult
 * # 对标：Trae SOLO Auto-Follow
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type StageId = 'idle' | 'prd' | 'coding' | 'preview' | 'deploy' | 'done';

export interface StageState {
  session_id: string;
  stage: StageId;
  substage: string | null;
  confidence: number;
  auto_follow: boolean;
  entered_at: number;
  source: 'rule' | 'llm' | 'manual';
  reason: string;
}

export interface StageEvent {
  event_id: string;
  session_id: string;
  type: string;
  from_stage: StageId | null;
  to_stage: StageId | null;
  confidence: number | null;
  reason: string | null;
  timestamp: number;
}

export interface UseStageOptions {
  sessionId: string;
  baseUrl?: string;
  wsUrl?: string;
  autoConnect?: boolean;
}

export interface UseStageResult {
  // 数据
  state: StageState | null;
  history: StageEvent[];
  recentEvents: StageEvent[];

  // 状态
  loading: boolean;
  error: string | null;
  connected: boolean;

  // 操作
  refresh: () => Promise<void>;
  detect: (text: string, useLlm?: boolean) => Promise<StageState | null>;
  forceStage: (stage: StageId, reason?: string) => Promise<StageState | null>;
  setAutoFollow: (enabled: boolean) => Promise<void>;
  loadHistory: (limit?: number) => Promise<void>;
  clearError: () => void;
}

const DEFAULT_BASE_URL = '/api/stage';

export function useStage(options: UseStageOptions): UseStageResult {
  const { sessionId, baseUrl = DEFAULT_BASE_URL, wsUrl, autoConnect = true } = options;

  const [state, setState] = useState<StageState | null>(null);
  const [history, setHistory] = useState<StageEvent[]>([]);
  const [recentEvents, setRecentEvents] = useState<StageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const handleError = useCallback((err: unknown, op: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(`[${op}] ${msg}`);
    // eslint-disable-next-line no-console
    console.error(`[useStage] ${op}:`, err);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(sessionId)}`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setState(data.state);
    } catch (err) {
      handleError(err, 'refresh');
    } finally {
      setLoading(false);
    }
  }, [sessionId, baseUrl, handleError]);

  const detect = useCallback(
    async (text: string, useLlm = false): Promise<StageState | null> => {
      if (!sessionId) return null;
      try {
        const resp = await fetch(`${baseUrl}/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, text, use_llm: useLlm }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setState(data.state);
        return data.state;
      } catch (err) {
        handleError(err, 'detect');
        return null;
      }
    },
    [sessionId, baseUrl, handleError],
  );

  const forceStage = useCallback(
    async (stage: StageId, reason = 'manual override'): Promise<StageState | null> => {
      if (!sessionId) return null;
      try {
        const resp = await fetch(`${baseUrl}/force`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, stage, reason }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setState(data.state);
        return data.state;
      } catch (err) {
        handleError(err, 'forceStage');
        return null;
      }
    },
    [sessionId, baseUrl, handleError],
  );

  const setAutoFollow = useCallback(
    async (enabled: boolean) => {
      if (!sessionId) return;
      try {
        const resp = await fetch(`${baseUrl}/auto-follow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, enabled }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setState(data.state);
      } catch (err) {
        handleError(err, 'setAutoFollow');
      }
    },
    [sessionId, baseUrl, handleError],
  );

  const loadHistory = useCallback(
    async (limit = 50) => {
      if (!sessionId) return;
      try {
        const resp = await fetch(
          `${baseUrl}/${encodeURIComponent(sessionId)}/history?limit=${limit}`,
          { method: 'GET' },
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setHistory(data.events || []);
      } catch (err) {
        handleError(err, 'loadHistory');
      }
    },
    [sessionId, baseUrl, handleError],
  );

  const clearError = useCallback(() => setError(null), []);

  // WebSocket 订阅
  useEffect(() => {
    if (!autoConnect || !sessionId || !wsUrl) return;

    let closed = false;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${wsUrl}/${encodeURIComponent(sessionId)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        if (!closed) setConnected(true);
      };
      ws.onclose = () => {
        if (!closed) setConnected(false);
      };
      ws.onerror = () => {
        if (!closed) setConnected(false);
      };
      ws.onmessage = (e) => {
        try {
          const event: StageEvent = JSON.parse(e.data);
          setRecentEvents((prev) => [event, ...prev].slice(0, 20));
          if (event.type === 'stage_change' && event.to_stage) {
            setState((prev) =>
              prev
                ? { ...prev, stage: event.to_stage as StageId, confidence: event.confidence || prev.confidence, reason: event.reason || prev.reason, entered_at: event.timestamp }
                : prev,
            );
          }
        } catch {
          // 忽略无法解析的消息
        }
      };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[useStage] WebSocket 连接失败:', e);
      setConnected(false);
    }
    return () => {
      closed = true;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
      setConnected(false);
    };
  }, [autoConnect, sessionId, wsUrl]);

  // 初始加载
  useEffect(() => {
    if (sessionId) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return {
    state,
    history,
    recentEvents,
    loading,
    error,
    connected,
    refresh,
    detect,
    forceStage,
    setAutoFollow,
    loadHistory,
    clearError,
  };
}
