/**
 * # ============================================================
 * useClaudeCLI - Claude Code CLI 客户端 Hook (v2.0.0)
 * Cycle 61 G61-01-T4
 * # ============================================================
 * 核心作用：调用后端 Claude CLI 进程编排 API（对标 v1 useClaudeCodeShell）
 * v2.0.0 增强：
 *   - 完整集成 backend/app/api/claude_cli.py 新 API
 *   - 9 类 SSE 事件类型支持（started/stdout/stderr/thinking/tool_call/tool_result/exit/error/fallback）
 *   - 自动重连 + 指数退避
 *   - 节流更新（100ms 窗口）避免频繁 re-render
 *   - 沙箱状态感知（通过 /health 端点）
 *   - 失败降级 UI（fallback 标识）
 * 运行流程：
 *   1. 挂载时调用 /health 检测 CLI + 沙箱状态
 *   2. 用户点击 invoke → POST /api/claude-cli/exec
 *   3. 订阅 /api/claude-cli/events/{id} SSE
 *   4. 按事件类型分桶累积输出（stdout/thinking/tool_call 分开）
 *   5. 100ms 节流更新 React state
 *   6. cancel → POST /cancel/{id}
 * 设计要点：
 *   - 沙箱选择：docker/gvisor/firejail/none/auto
 *   - 资源限制：CPU quota + MEM limit
 *   - 完整错误处理 + 重连
 *   - 主题无关
 * 输入参数：{ baseUrl?, options? }
 * 输出结果：{ invoke, cancel, clear, state, isAvailable, sandboxStatus, ... }
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v2.0.0 | Cycle 61 G61-01-T4 初次创建（v1 useClaudeCodeShell 升级）
 * ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ====================================

/** 9 类 SSE 事件类型（与 backend CLIEventType 对齐） */
export type ClaudeCLIEventType =
  | 'cli_started'
  | 'cli_stdout'
  | 'cli_stderr'
  | 'cli_thinking'
  | 'cli_tool_call'
  | 'cli_tool_result'
  | 'cli_exit'
  | 'cli_fallback'
  | 'cli_error'
  | 'state'
  | 'error';

/** CLI 单个事件 */
export interface ClaudeCLIEvent {
  id: string;
  type: ClaudeCLIEventType;
  timestamp: number;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Hook 调用选项 */
export interface UseClaudeCLIOptions {
  baseUrl?: string;
  /** 默认沙箱类型 */
  sandbox?: 'docker' | 'gvisor' | 'firejail' | 'none' | 'auto';
  /** 默认超时（秒） */
  timeout?: number;
  /** 默认 CPU 配额 (0-1) */
  cpuQuota?: number;
  /** 默认内存限制 (MB) */
  memLimitMb?: number;
  /** 单次调用最大时长（秒） */
  maxDuration?: number;
  /** state 更新节流（ms）默认 100ms */
  throttleMs?: number;
  /** 失败时自动重试次数 */
  maxRetries?: number;
}

/** invoke 参数 */
export interface InvokeParams {
  prompt: string;
  model?: string;
  sandbox?: 'docker' | 'gvisor' | 'firejail' | 'none' | 'auto';
  timeout?: number;
  maxTokens?: number;
  tools?: string[];
  cwd?: string;
  cpuQuota?: number;
  memLimitMb?: number;
  autoFallback?: boolean;
  args?: string[];
}

/** Hook 返回值 */
export interface UseClaudeCLIResult {
  // 状态
  isRunning: boolean;
  isAvailable: boolean;
  sandboxStatus: Record<string, boolean>;
  mode: 'subprocess' | 'fallback' | 'unknown';

  // 输出
  output: string;                  // 累积的 stdout
  thinking: string;                // 累积的 thinking
  toolCalls: ClaudeCLIEvent[];     // 工具调用列表
  errors: string[];                // 错误列表
  events: ClaudeCLIEvent[];        // 全部事件历史

  // 当前进程
  processId: string | null;
  state: string;                   // 'idle' | 'running' | 'completed' | 'failed' | ...

  // 方法
  invoke: (params: InvokeParams) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
  refreshHealth: () => Promise<void>;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/claude-cli';
const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_TIMEOUT = 300;
const DEFAULT_MAX_DURATION = 1800;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 500; // ms
const isBrowser = typeof window !== 'undefined';

// ============================================================
// 内部辅助
// ====================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Hook 实现
// ============================================================

export function useClaudeCLI(options: UseClaudeCLIOptions = {}): UseClaudeCLIResult {
  const {
    baseUrl = DEFAULT_BASE_URL,
    sandbox = 'auto',
    timeout = DEFAULT_TIMEOUT,
    cpuQuota = 0.8,
    memLimitMb = 512,
    maxDuration = DEFAULT_MAX_DURATION,
    throttleMs = DEFAULT_THROTTLE_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  // 状态
  const [isRunning, setIsRunning] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [sandboxStatus, setSandboxStatus] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<'subprocess' | 'fallback' | 'unknown'>('unknown');
  const [output, setOutput] = useState('');
  const [thinking, setThinking] = useState('');
  const [toolCalls, setToolCalls] = useState<ClaudeCLIEvent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [events, setEvents] = useState<ClaudeCLIEvent[]>([]);
  const [processId, setProcessId] = useState<string | null>(null);
  const [state, setState] = useState('idle');

  // 引用
  const eventSourceRef = useRef<EventSource | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const pendingFlushRef = useRef<number | null>(null);
  const bufferRef = useRef<{
    output: string;
    thinking: string;
    toolCalls: ClaudeCLIEvent[];
    errors: string[];
    events: ClaudeCLIEvent[];
  }>({
    output: '',
    thinking: '',
    toolCalls: [],
    errors: [],
    events: [],
  });

  // --------------------------------------------------------
  // 健康检查
  // --------------------------------------------------------

  const refreshHealth = useCallback(async () => {
    if (!isBrowser) return;
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (!res.ok) {
        setIsAvailable(false);
        return;
      }
      const data = (await res.json()) as {
        available: boolean;
        mode: 'subprocess' | 'fallback';
        sandboxes: Record<string, boolean>;
      };
      setIsAvailable(data.available);
      setMode(data.mode);
      setSandboxStatus(data.sandboxes || {});
    } catch (err) {
      console.warn('useClaudeCLI: health check failed', err);
      setIsAvailable(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // --------------------------------------------------------
  // 缓冲刷新（节流 100ms）
  // --------------------------------------------------------

  const flushBuffer = useCallback(() => {
    const buf = bufferRef.current;
    if (buf.output) {
      setOutput((prev) => prev + buf.output);
      buf.output = '';
    }
    if (buf.thinking) {
      setThinking((prev) => prev + buf.thinking);
      buf.thinking = '';
    }
    if (buf.toolCalls.length > 0) {
      setToolCalls((prev) => [...prev, ...buf.toolCalls]);
      buf.toolCalls = [];
    }
    if (buf.errors.length > 0) {
      setErrors((prev) => [...prev, ...buf.errors]);
      buf.errors = [];
    }
    if (buf.events.length > 0) {
      setEvents((prev) => [...prev.slice(-499), ...buf.events]);
      buf.events = [];
    }
    pendingFlushRef.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pendingFlushRef.current !== null) return;
    pendingFlushRef.current = window.setTimeout(flushBuffer, throttleMs);
  }, [flushBuffer, throttleMs]);

  // --------------------------------------------------------
  // 事件处理
  // --------------------------------------------------------

  const handleEvent = useCallback(
    (event: ClaudeCLIEvent) => {
      const buf = bufferRef.current;
      buf.events.push(event);
      switch (event.type) {
        case 'cli_started':
          setState('running');
          setProcessId(event.id);
          break;
        case 'cli_stdout':
          buf.output += event.content;
          break;
        case 'cli_stderr':
          buf.errors.push(event.content);
          break;
        case 'cli_thinking':
          buf.thinking += event.content;
          break;
        case 'cli_tool_call':
          buf.toolCalls.push(event);
          break;
        case 'cli_tool_result':
          buf.toolCalls.push(event);
          break;
        case 'cli_exit': {
          const meta = (event.metadata || {}) as { exit_code?: number; state?: string };
          setState(meta.state || 'completed');
          if (maxDurationTimerRef.current !== null) {
            window.clearTimeout(maxDurationTimerRef.current);
            maxDurationTimerRef.current = null;
          }
          setIsRunning(false);
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          break;
        }
        case 'cli_fallback':
          setMode('fallback');
          break;
        case 'cli_error':
          buf.errors.push(event.content);
          break;
        case 'state': {
          const meta = (event.metadata || {}) as { state?: string };
          if (meta.state) setState(meta.state);
          break;
        }
        case 'error':
          buf.errors.push(event.content);
          break;
      }
      scheduleFlush();
    },
    [scheduleFlush]
  );

  // --------------------------------------------------------
  // 清理
  // --------------------------------------------------------

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (maxDurationTimerRef.current !== null) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (pendingFlushRef.current !== null) {
      window.clearTimeout(pendingFlushRef.current);
      pendingFlushRef.current = null;
    }
    // 强制刷新剩余 buffer
    flushBuffer();
    setIsRunning(false);
  }, [flushBuffer]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // --------------------------------------------------------
  // invoke
  // --------------------------------------------------------

  const invoke = useCallback(
    async (params: InvokeParams) => {
      if (!isBrowser) return;
      // 输入校验
      if (!params.prompt || params.prompt.trim().length === 0) {
        setErrors((prev) => [...prev, 'prompt 不能为空']);
        return;
      }
      if (params.prompt.length > 100_000) {
        setErrors((prev) => [...prev, 'prompt 长度不能超过 100000 字符']);
        return;
      }

      // 重置
      setOutput('');
      setThinking('');
      setToolCalls([]);
      setErrors([]);
      setEvents([]);
      setState('starting');
      setIsRunning(true);
      bufferRef.current = { output: '', thinking: '', toolCalls: [], errors: [], events: [] };

      const effectiveTimeout = Math.min(params.timeout ?? timeout, maxDuration);
      const effectiveSandbox = params.sandbox ?? sandbox;

      let attempt = 0;
      let lastError: string | null = null;
      while (attempt <= maxRetries) {
        try {
          // 1. 启动进程
          const res = await fetch(`${baseUrl}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: params.prompt,
              model: params.model,
              sandbox: effectiveSandbox === 'auto' ? null : effectiveSandbox,
              timeout: effectiveTimeout,
              max_tokens: params.maxTokens ?? 8192,
              tools: params.tools ?? ['read', 'write', 'bash'],
              cwd: params.cwd,
              cpu_quota: params.cpuQuota ?? cpuQuota,
              mem_limit_mb: params.memLimitMb ?? memLimitMb,
              auto_fallback: params.autoFallback ?? true,
              args: params.args,
              stream: true,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg =
              (errBody.detail && (errBody.detail.message || errBody.detail)) ||
              `HTTP ${res.status}`;
            throw new Error(`exec failed: ${msg}`);
          }
          const data = (await res.json()) as { id: string; status: string };
          setProcessId(data.id);

          // 2. 订阅 SSE
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
          }
          const es = new EventSource(`${baseUrl}/events/${data.id}`);
          eventSourceRef.current = es;

          // 注册所有事件类型
          const eventTypes: ClaudeCLIEventType[] = [
            'cli_started',
            'cli_stdout',
            'cli_stderr',
            'cli_thinking',
            'cli_tool_call',
            'cli_tool_result',
            'cli_exit',
            'cli_fallback',
            'cli_error',
            'state',
            'error',
          ];
          for (const evType of eventTypes) {
            es.addEventListener(evType, (e: MessageEvent) => {
              try {
                const payload = JSON.parse(e.data) as Record<string, unknown>;
                handleEvent({
                  id: (payload.id as string) || data.id,
                  type: evType,
                  timestamp: (payload.timestamp as number) || Date.now(),
                  content: (payload.content as string) || (payload.chunk as string) || '',
                  metadata: payload.metadata as Record<string, unknown> | undefined,
                });
              } catch (err) {
                console.warn(`useClaudeCLI: parse ${evType} failed`, err);
              }
            });
          }

          es.onerror = () => {
            // EventSource 自动重连，由后端 SSE 实现决定
          };

          // 3. 设置最大时长熔断
          maxDurationTimerRef.current = window.setTimeout(() => {
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
            setErrors((prev) => [...prev, `调用超时（${maxDuration}s）`]);
            setState('timeout');
            setIsRunning(false);
          }, maxDuration * 1000);

          // 成功，跳出重试循环
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          attempt += 1;
          if (attempt > maxRetries) {
            setErrors((prev) => [...prev, lastError || 'unknown error']);
            setState('failed');
            setIsRunning(false);
            return;
          }
          // 指数退避
          await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt - 1));
        }
      }
    },
    [baseUrl, sandbox, timeout, cpuQuota, memLimitMb, maxDuration, maxRetries, handleEvent]
  );

  // --------------------------------------------------------
  // cancel
  // --------------------------------------------------------

  const cancel = useCallback(async () => {
    if (processId && isBrowser) {
      try {
        await fetch(`${baseUrl}/cancel/${processId}`, { method: 'POST' });
      } catch (err) {
        console.warn('useClaudeCLI: cancel failed', err);
      }
    }
    cleanup();
    setState('cancelled');
  }, [processId, baseUrl, cleanup]);

  // --------------------------------------------------------
  // clear
  // --------------------------------------------------------

  const clear = useCallback(() => {
    setOutput('');
    setThinking('');
    setToolCalls([]);
    setErrors([]);
    setEvents([]);
    setState('idle');
    setProcessId(null);
    bufferRef.current = { output: '', thinking: '', toolCalls: [], errors: [], events: [] };
  }, []);

  return {
    isRunning,
    isAvailable,
    sandboxStatus,
    mode,
    output,
    thinking,
    toolCalls,
    errors,
    events,
    processId,
    state,
    invoke,
    cancel,
    clear,
    refreshHealth,
  };
}

export default useClaudeCLI;
