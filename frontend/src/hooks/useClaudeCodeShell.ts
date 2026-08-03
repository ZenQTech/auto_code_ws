/**
 * # ============================================================
 * useClaudeCodeShell - Claude Code CLI 客户端 Hook (v1.0.0)
 * Cycle 58 G58-02
 * # ============================================================
 * 核心作用：在前端调用 Claude Code CLI 进行真实进程级调用
 * 运行流程：
 *   1. 用户在 VibeCoding 模式下点击「让 Claude Code Shell 处理」
 *   2. 前端调用 /api/claude-shell/invoke
 *   3. 后端启动 `claude -p "prompt"` 子进程
 *   4. 流式接收 stdout/stderr → 推 SSE 事件
 *   5. 前端通过 SSE 接收 chunks
 *   6. 用户可随时 cancel
 * 设计要点：
 *   - 自动重连 SSE
 *   - 超时熔断
 *   - cancel 可终止流
 *   - 降级提示：若 claude CLI 不在 PATH
 * 输入参数：{ baseUrl?: string }
 * 输出结果：{ invoke, cancel, isRunning, output, error, isAvailable }
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-02 初次创建
 * ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ====================================

/** Claude Code Shell 输出 chunk */
export interface ClaudeShellChunk {
  stream_id: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
  timestamp: number;
}

/** Hook 返回值 */
export interface UseClaudeCodeShellResult {
  isRunning: boolean;
  output: string;
  chunks: ClaudeShellChunk[];
  error: string | null;
  isAvailable: boolean;
  invoke: (prompt: string, args?: string[]) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

// ============================================================
// 常量
// ====================================

const DEFAULT_BASE_URL = '/api/claude-shell';
const isBrowser = typeof window !== 'undefined';

// ============================================================
// Hook 实现
// ============================================================

export interface UseClaudeCodeShellOptions {
  baseUrl?: string;
  /** 单次调用最大时长（秒） */
  maxDuration?: number;
}

export function useClaudeCodeShell(
  options: UseClaudeCodeShellOptions = {}
): UseClaudeCodeShellResult {
  const { baseUrl = DEFAULT_BASE_URL, maxDuration = 300 } = options;
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState('');
  const [chunks, setChunks] = useState<ClaudeShellChunk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<number | null>(null);

  // 检测 claude CLI 是否可用
  useEffect(() => {
    if (!isBrowser) return;
    const controller = new AbortController();
    fetch(`${baseUrl}/health`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { available: boolean }) => {
        setIsAvailable(data.available);
      })
      .catch((err) => {
        console.warn('useClaudeCodeShell: health check failed', err);
        setIsAvailable(false);
      });
    return () => controller.abort();
  }, [baseUrl]);

  // 清理函数
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // 卸载时清理
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // 调用 Claude Code CLI
  const invoke = useCallback(
    async (prompt: string, args?: string[]) => {
      if (!isBrowser) return;
      // 合法性校验
      if (!prompt || prompt.trim().length === 0) {
        setError('prompt 不能为空');
        return;
      }
      if (prompt.length > 10000) {
        setError('prompt 长度不能超过 10000 字符');
        return;
      }

      // 重置
      setError(null);
      setOutput('');
      setChunks([]);
      setIsRunning(true);

      try {
        // 1. 触发 invoke 端点
        const res = await fetch(`${baseUrl}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, args: args ?? [] }),
        });
        if (!res.ok) {
          throw new Error(`触发 Claude Shell 失败: ${res.status}`);
        }
        const data = (await res.json()) as { stream_id: string };
        const { stream_id } = data;

        // 2. 订阅 SSE
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        const es = new EventSource(`${baseUrl}/invoke/${stream_id}/events`);
        eventSourceRef.current = es;

        es.addEventListener('claude_shell_output', (e: MessageEvent) => {
          try {
            const chunk = JSON.parse(e.data) as ClaudeShellChunk;
            setChunks((prev) => [...prev, chunk]);
            setOutput((prev) => prev + chunk.chunk);
          } catch (err) {
            console.warn('useClaudeCodeShell: parse chunk failed', err);
          }
        });

        es.addEventListener('claude_shell_done', () => {
          es.close();
          eventSourceRef.current = null;
          setIsRunning(false);
          if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        });

        es.addEventListener('claude_shell_error', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { error: string };
            setError(data.error);
          } catch {
            setError('Claude Shell 调用失败');
          }
          es.close();
          eventSourceRef.current = null;
          setIsRunning(false);
        });

        es.onerror = () => {
          // EventSource 自动重连
        };

        // 3. 设置超时熔断
        timeoutRef.current = window.setTimeout(() => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          setError(`Claude Shell 调用超时（${maxDuration}s）`);
          setIsRunning(false);
        }, maxDuration * 1000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsRunning(false);
      }
    },
    [baseUrl, maxDuration]
  );

  // 取消
  const cancel = useCallback(() => {
    cleanup();
    // 通知后端取消
    if (isBrowser) {
      fetch(`${baseUrl}/cancel`, { method: 'POST' }).catch(() => {
        // 静默失败
      });
    }
  }, [cleanup, baseUrl]);

  // 清空输出
  const clear = useCallback(() => {
    setOutput('');
    setChunks([]);
    setError(null);
  }, []);

  return {
    isRunning,
    output,
    chunks,
    error,
    isAvailable,
    invoke,
    cancel,
    clear,
  };
}

export default useClaudeCodeShell;
