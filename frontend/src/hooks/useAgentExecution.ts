/**
 * # ============================================================
 * # useAgentExecution Hook (v1.0.0)
 * # Cycle 64 G64-01
 * # ====================================
 * # 核心作用：实时跟踪 Agent 实例的执行状态和 Hook 事件流
 * # 运行流程：
 * #   1. 通过 WebSocket 订阅 agent 的 Hook 事件
 * #   2. 维护实例状态（status/progress/current_tool/tool_calls/tokens）
 * #   3. 维护事件历史（最多 500 条）
 * #   4. 提供 pause/resume/cancel 操作
 * #   5. WebSocket 断线自动重连（最多 5 次）
 * # 输入参数：agentId, baseUrl
 * # 输出结果：UseAgentExecutionResult
 * # 设计要点：
 * #   - 单一职责：跟踪一个 agent 的实时状态
 * #   - 心跳机制：每 30s 发送 ping
 * #   - 性能：事件批量更新，避免频繁渲染
 * #   - 错误隔离：WS 错误不影响基础数据加载
 * # 对标：Codex CLI SubagentStart/Stop Hook 事件流
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 64 G64-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type AgentStatus =
  | 'spawning'
  | 'running'
  | 'tool_calling'
  | 'output_streaming'
  | 'idle'
  | 'failed'
  | 'cancelled'
  | 'dead';

export type HookEventType =
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Progress'
  | 'Output'
  | 'Error'
  | 'Cancelled';

export interface AgentInstanceState {
  agent_id: string;
  role_name: string;
  nickname: string;
  status: AgentStatus;
  task: string;
  started_at: number;
  finished_at: number | null;
  result: string | null;
  error: string | null;
  progress: number;
  current_tool: string | null;
  tool_calls_count: number;
  tokens_used: number;
  paused: boolean;
  cancel_requested: boolean;
}

export interface HookEvent {
  event_id: string;
  agent_id: string;
  event_type: HookEventType;
  timestamp: number;
  data: Record<string, unknown>;
  parent_event_id: string | null;
}

export interface UseAgentExecutionOptions {
  agentId: string | null;
  baseUrl?: string;
  autoConnect?: boolean;
  maxHistory?: number;
  heartbeatMs?: number;
}

export interface UseAgentExecutionResult {
  instance: AgentInstanceState | null;
  events: HookEvent[];
  connected: boolean;
  error: string | null;
  reconnectCount: number;

  connect: () => void;
  disconnect: () => void;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  clearEvents: () => void;
}

const DEFAULT_BASE_URL = ''; // 同源
const DEFAULT_MAX_HISTORY = 500;
const DEFAULT_HEARTBEAT_MS = 30000;
const MAX_RECONNECT = 5;

function getWsBaseUrl(baseUrl: string): string {
  // 转换为 ws:// 或 wss://
  if (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')) {
    return baseUrl;
  }
  // 同源，从 window.location 推断
  if (typeof window === 'undefined') {
    return 'ws://localhost:8000';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}`;
}

export function useAgentExecution(options: UseAgentExecutionOptions): UseAgentExecutionResult {
  const {
    agentId,
    baseUrl = DEFAULT_BASE_URL,
    autoConnect = true,
    maxHistory = DEFAULT_MAX_HISTORY,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
  } = options;

  const [instance, setInstance] = useState<AgentInstanceState | null>(null);
  const [events, setEvents] = useState<HookEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);

  const handleError = useCallback((err: unknown, op: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(`[${op}] ${msg}`);
    // eslint-disable-next-line no-console
    console.warn(`[useAgentExecution] ${op}:`, err);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send('ping');
        } catch (e) {
          // ignore
        }
      }
    }, heartbeatMs);
  }, [heartbeatMs, stopHeartbeat]);

  const pushEvent = useCallback(
    (event: HookEvent) => {
      setEvents((prev) => {
        const next = [...prev, event];
        if (next.length > maxHistory) {
          return next.slice(next.length - maxHistory);
        }
        return next;
      });
    },
    [maxHistory],
  );

  const updateInstanceFromEvent = useCallback((event: HookEvent) => {
    if (event.event_type === 'Progress') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              progress: (event.data.progress as number) ?? prev.progress,
            }
          : prev,
      );
    } else if (event.event_type === 'SubagentStop') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              status: (event.data.status as AgentStatus) ?? 'idle',
              result: (event.data.result as string) ?? prev.result,
              progress: 1.0,
              finished_at: event.timestamp,
              current_tool: null,
            }
          : prev,
      );
    } else if (event.event_type === 'Error') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              status: 'failed',
              error: (event.data.error as string) ?? 'unknown error',
              finished_at: event.timestamp,
            }
          : prev,
      );
    } else if (event.event_type === 'Cancelled') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
              finished_at: event.timestamp,
            }
          : prev,
      );
    } else if (event.event_type === 'PreToolUse') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              status: 'tool_calling',
              current_tool: (event.data.tool_name as string) ?? prev.current_tool,
              tool_calls_count: prev.tool_calls_count + 1,
            }
          : prev,
      );
    } else if (event.event_type === 'Output') {
      setInstance((prev) =>
        prev
          ? {
              ...prev,
              status: 'output_streaming',
            }
          : prev,
      );
    }
  }, []);

  const connect = useCallback(() => {
    if (!agentId) return;
    // 清理旧连接
    if (wsRef.current) {
      shouldReconnectRef.current = false;
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }
    shouldReconnectRef.current = true;

    const wsBase = getWsBaseUrl(baseUrl);
    const url = `${wsBase}/api/agent-roles/ws/${encodeURIComponent(agentId)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      handleError(e, 'connect');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      startHeartbeat();
    };

    ws.onmessage = (msgEvent) => {
      try {
        const data = JSON.parse(msgEvent.data);
        if (data.type === 'initial') {
          // 初始消息：包含 instance + history
          if (data.instance) {
            setInstance(data.instance as AgentInstanceState);
          }
          if (Array.isArray(data.history)) {
            setEvents(data.history as HookEvent[]);
          }
        } else if (data.type === 'event') {
          const event = data.event as HookEvent;
          pushEvent(event);
          updateInstanceFromEvent(event);
        } else if (data.type === 'cancelled') {
          setInstance((prev) =>
            prev
              ? { ...prev, status: 'cancelled', finished_at: Date.now() / 1000 }
              : prev,
          );
        } else if (data.type === 'pong') {
          // ignore
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    ws.onerror = (e) => {
      handleError(e, 'websocket');
    };

    ws.onclose = () => {
      setConnected(false);
      stopHeartbeat();
      wsRef.current = null;
      // 自动重连
      if (shouldReconnectRef.current && reconnectCount < MAX_RECONNECT) {
        reconnectTimerRef.current = setTimeout(() => {
          setReconnectCount((c) => c + 1);
          connect();
        }, Math.min(1000 * Math.pow(2, reconnectCount), 10000));
      }
    };
  }, [
    agentId,
    baseUrl,
    handleError,
    pushEvent,
    reconnectCount,
    startHeartbeat,
    stopHeartbeat,
    updateInstanceFromEvent,
  ]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }
    setConnected(false);
    stopHeartbeat();
  }, [stopHeartbeat]);

  const pause = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false;
    try {
      const resp = await fetch(
        `${baseUrl}/api/agent-roles/instances/${encodeURIComponent(agentId)}/pause`,
        { method: 'POST' },
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }
      return true;
    } catch (e) {
      handleError(e, 'pause');
      return false;
    }
  }, [agentId, baseUrl, handleError]);

  const resume = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false;
    try {
      const resp = await fetch(
        `${baseUrl}/api/agent-roles/instances/${encodeURIComponent(agentId)}/resume`,
        { method: 'POST' },
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }
      return true;
    } catch (e) {
      handleError(e, 'resume');
      return false;
    }
  }, [agentId, baseUrl, handleError]);

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false;
    try {
      // 优先通过 WS 发送 cancel（更及时）
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send('cancel');
        } catch (e) {
          // ignore, fallback to HTTP
        }
      }
      const resp = await fetch(
        `${baseUrl}/api/agent-roles/instances/${encodeURIComponent(agentId)}/cancel`,
        { method: 'POST' },
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }
      return true;
    } catch (e) {
      handleError(e, 'cancel');
      return false;
    }
  }, [agentId, baseUrl, handleError]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // 自动连接
  useEffect(() => {
    if (autoConnect && agentId) {
      connect();
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, autoConnect]);

  return {
    instance,
    events,
    connected,
    error,
    reconnectCount,
    connect,
    disconnect,
    pause,
    resume,
    cancel,
    clearEvents,
  };
}
