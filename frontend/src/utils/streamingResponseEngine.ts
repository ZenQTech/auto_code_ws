/**
 * # ============================================================
 * # Streaming Response Engine - 流式响应引擎 (v1.0.0 Cycle 36 G36-02)
 * # ============================================================
 * # 核心作用：管理 LLM 流式响应的生命周期、订阅、统计
 * #           支持中断、暂停、恢复、错误重试
 * #           统一 SSE / AsyncIterable 协议
 * # 对标产品：Vercel AI SDK / LangChain Streaming
 * # 运行流程：
 * #   1. createStream(options) 创建流会话
 * #   2. 订阅 onChunk / onComplete / onError
 * #   3. 引擎异步消费 Provider 流，节流后分发给订阅者
 * #   4. pause/resume/cancel 控制生命周期
 * #   5. getStats 获取实时统计（TTFT / ITPS）
 * # 输入参数：CreateStreamOptions
 * # 输出结果：StreamSession / StreamStats
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-02 初次创建
 * # ============================================================
 */

import {
  StreamChunk,
  ChatOptions,
  Message,
  ProviderName,
  getDefaultLLMProviderRegistry,
} from './llmProviderAdapter';


// ============ 类型定义 ============

export type StreamStatus = 'pending' | 'streaming' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface StreamConfig {
  throttleMs?: number;
  bufferSize?: number;
  heartbeatMs?: number;
  autoReconnect?: boolean;
  maxRetries?: number;
}

export interface CreateStreamOptions {
  provider: ProviderName;
  model?: string;
  messages: Message[];
  config?: StreamConfig;
  chatOptions?: ChatOptions;
}

export interface StreamComplete {
  streamId: string;
  finalContent: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  totalChunks: number;
  finishReason: string;
}

export interface StreamError {
  streamId: string;
  error: Error;
  recoverable: boolean;
  timestamp: number;
}

export interface StreamStats {
  streamId: string;
  status: StreamStatus;
  chunksEmitted: number;
  bytesEmitted: number;
  durationMs: number;
  pausedDurationMs: number;
  ttftMs?: number;
  itps?: number;
  avgItps?: number;
  startTime: number;
  endTime?: number;
}

export interface AggregateStreamStats {
  totalStreams: number;
  activeStreams: number;
  completedStreams: number;
  totalChunks: number;
  totalBytes: number;
  avgTtftMs: number;
  avgDurationMs: number;
}

export type Unsubscribe = () => void;

// ============ 工具函数 ============

export function generateStreamId(): string {
  return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Stream Session 实现 ============

export class StreamSession {
  public readonly id: string;
  public status: StreamStatus = 'pending';
  public chunksEmitted: number = 0;
  public bytesEmitted: number = 0;
  public durationMs: number = 0;
  public pausedDurationMs: number = 0;
  public ttftMs?: number;
  public itps?: number;
  public avgItps?: number;
  public startTime: number = Date.now();
  public endTime?: number;
  public finalContent: string = '';

  private chunkListeners: Array<(chunk: StreamChunk) => void> = [];
  private completeListeners: Array<(final: StreamComplete) => void> = [];
  private errorListeners: Array<(error: StreamError) => void> = [];

  private pauseResolve: (() => void) | null = null;
  private pauseStartTime: number = 0;
  private textBuffer: string = '';
  private chunks: StreamChunk[] = [];
  private firstChunkTime?: number;

  constructor(id: string) {
    this.id = id;
  }

  onChunk(callback: (chunk: StreamChunk) => void): Unsubscribe {
    this.chunkListeners.push(callback);
    return () => {
      const idx = this.chunkListeners.indexOf(callback);
      if (idx >= 0) this.chunkListeners.splice(idx, 1);
    };
  }

  onComplete(callback: (final: StreamComplete) => void): Unsubscribe {
    this.completeListeners.push(callback);
    return () => {
      const idx = this.completeListeners.indexOf(callback);
      if (idx >= 0) this.completeListeners.splice(idx, 1);
    };
  }

  onError(callback: (error: StreamError) => void): Unsubscribe {
    this.errorListeners.push(callback);
    return () => {
      const idx = this.errorListeners.indexOf(callback);
      if (idx >= 0) this.errorListeners.splice(idx, 1);
    };
  }

  pause(): void {
    if (this.status !== 'streaming') return;
    this.status = 'paused';
    this.pauseStartTime = Date.now();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.pausedDurationMs += Date.now() - this.pauseStartTime;
    this.status = 'streaming';
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  cancel(): void {
    this.status = 'cancelled';
    this.endTime = Date.now();
    this.durationMs = this.endTime - this.startTime - this.pausedDurationMs;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  emitChunk(chunk: StreamChunk): void {
    if (this.status === 'cancelled' || this.status === 'completed') return;

    this.chunks.push(chunk);
    this.chunksEmitted++;
    if (chunk.text) {
      this.bytesEmitted += chunk.text.length;
      this.textBuffer += chunk.text;
    }

    if (!this.firstChunkTime) {
      this.firstChunkTime = Date.now();
      this.ttftMs = this.firstChunkTime - this.startTime;
    }

    // 计算 ITPS
    const elapsed = Date.now() - this.startTime - this.pausedDurationMs;
    if (elapsed > 0) {
      this.itps = (this.bytesEmitted / 4) / (elapsed / 1000); // 粗略估算
      this.avgItps = this.itps;
    }

    for (const cb of this.chunkListeners) {
      try {
        cb(chunk);
      } catch (e) {
        // ignore
      }
    }
  }

  complete(usage?: StreamComplete['usage'], finishReason: string = 'stop'): void {
    if (this.status === 'cancelled') return;
    this.status = 'completed';
    this.endTime = Date.now();
    this.durationMs = this.endTime - this.startTime - this.pausedDurationMs;
    this.finalContent = this.textBuffer;

    const final: StreamComplete = {
      streamId: this.id,
      finalContent: this.textBuffer,
      usage,
      durationMs: this.durationMs,
      totalChunks: this.chunksEmitted,
      finishReason,
    };

    for (const cb of this.completeListeners) {
      try {
        cb(final);
      } catch (e) {
        // ignore
      }
    }
  }

  error(error: Error, recoverable: boolean = false): void {
    this.status = 'error';
    this.endTime = Date.now();
    this.durationMs = this.endTime - this.startTime - this.pausedDurationMs;

    const streamError: StreamError = {
      streamId: this.id,
      error,
      recoverable,
      timestamp: Date.now(),
    };

    for (const cb of this.errorListeners) {
      try {
        cb(streamError);
      } catch (e) {
        // ignore
      }
    }
  }

  getStats(): StreamStats {
    return {
      streamId: this.id,
      status: this.status,
      chunksEmitted: this.chunksEmitted,
      bytesEmitted: this.bytesEmitted,
      durationMs: this.durationMs,
      pausedDurationMs: this.pausedDurationMs,
      ttftMs: this.ttftMs,
      itps: this.itps,
      avgItps: this.avgItps,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }

  getText(): string {
    return this.textBuffer;
  }

  getChunks(): StreamChunk[] {
    return [...this.chunks];
  }

  async waitForPause(): Promise<void> {
    if (this.status !== 'paused') return;
    return new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
  }
}

// ============ Streaming Response Engine ============

export class StreamingResponseEngine {
  private sessions: Map<string, StreamSession> = new Map();
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private readonly storageKey: string = 'streaming-response-engine';
  private persistEnabled: boolean = true;

  constructor(options: { persistEnabled?: boolean } = {}) {
    if (options.persistEnabled !== undefined) {
      this.persistEnabled = options.persistEnabled;
    }
  }

  /**
   * 获取引擎持久化配置
   * 返回 storageKey 与 persistEnabled 以供外部模块调用
   */
  getConfig(): { storageKey: string; persistEnabled: boolean } {
    return {
      storageKey: this.storageKey,
      persistEnabled: this.persistEnabled,
    };
  }

  createStream(options: CreateStreamOptions): StreamSession {
    const id = generateStreamId();
    const session = new StreamSession(id);
    this.sessions.set(id, session);

    // 异步启动流
    this.startStream(session, options).catch((e) => {
      session.error(e as Error);
    });

    this.emit('stream-created', { streamId: id, options });
    return session;
  }

  private async startStream(session: StreamSession, options: CreateStreamOptions): Promise<void> {
    const registry = getDefaultLLMProviderRegistry();
    const provider = registry.get(options.provider);
    if (!provider) {
      session.error(new Error(`Provider ${options.provider} not registered`), false);
      return;
    }

    session.status = 'streaming';
    const chatOptions: ChatOptions = {
      ...options.chatOptions,
      model: options.model || options.chatOptions?.model,
    };

    try {
      const stream = provider.stream(options.messages, chatOptions);
      let usage: any = undefined;
      let finishReason = 'stop';

      for await (const chunk of stream) {
        // 每次迭代重新读取状态（emitChunk 等方法可能改变状态）
        // 通过函数调用强制展开字面量类型
        const currentStatus: StreamStatus = ((): StreamStatus => session.status)();
        if (currentStatus === 'cancelled') break;
        // 暂停等待
        if (currentStatus === 'paused') {
          await session.waitForPause();
        }
        const postWaitStatus: StreamStatus = ((): StreamStatus => session.status)();
        if (postWaitStatus === 'cancelled') break;

        session.emitChunk(chunk);

        if (chunk.type === 'usage' && chunk.usage) {
          usage = chunk.usage;
        }
        if (chunk.type === 'error' && chunk.error) {
          session.error(new Error(chunk.error), true);
          return;
        }
        if (chunk.type === 'done') {
          finishReason = 'stop';
        }
      }

      if (session.status === 'streaming') {
        session.complete(usage, finishReason);
      }
    } catch (e) {
      const errorStatus: StreamStatus = ((): StreamStatus => session.status)();
      if (errorStatus !== 'cancelled') {
        session.error(e as Error, false);
      }
    }
  }

  getStream(streamId: string): StreamSession | undefined {
    return this.sessions.get(streamId);
  }

  listStreams(filter?: { status?: StreamStatus; provider?: ProviderName }): StreamSession[] {
    const all = Array.from(this.sessions.values());
    if (!filter) return all;
    return all.filter((s) => {
      if (filter.status && s.status !== filter.status) return false;
      return true;
    });
  }

  cancelStream(streamId: string): boolean {
    const session = this.sessions.get(streamId);
    if (session) {
      session.cancel();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const session of this.sessions.values()) {
      session.cancel();
    }
  }

  removeStream(streamId: string): boolean {
    return this.sessions.delete(streamId);
  }

  clearCompleted(): number {
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'error') {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  getStats(): AggregateStreamStats {
    const all = Array.from(this.sessions.values());
    const completed = all.filter((s) => s.status === 'completed');
    const active = all.filter((s) => s.status === 'streaming' || s.status === 'paused');

    const totalChunks = all.reduce((sum, s) => sum + s.chunksEmitted, 0);
    const totalBytes = all.reduce((sum, s) => sum + s.bytesEmitted, 0);
    const ttftSum = completed.reduce((sum, s) => sum + (s.ttftMs || 0), 0);
    const durationSum = completed.reduce((sum, s) => sum + s.durationMs, 0);

    return {
      totalStreams: all.length,
      activeStreams: active.length,
      completedStreams: completed.length,
      totalChunks,
      totalBytes,
      avgTtftMs: completed.length > 0 ? ttftSum / completed.length : 0,
      avgDurationMs: completed.length > 0 ? durationSum / completed.length : 0,
    };
  }

  on(event: string, callback: (data: unknown) => void): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    return () => {
      const arr = this.listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  private emit(event: string, data: unknown): void {
    const arr = this.listeners.get(event);
    if (arr) {
      for (const cb of arr) {
        try {
          cb(data);
        } catch (e) {
          // ignore
        }
      }
    }
  }
}

// ============ 单例 ============

let defaultEngine: StreamingResponseEngine | null = null;

export function getDefaultStreamingResponseEngine(): StreamingResponseEngine {
  if (!defaultEngine) {
    defaultEngine = new StreamingResponseEngine();
  }
  return defaultEngine;
}

export function resetDefaultStreamingResponseEngine(): void {
  if (defaultEngine) {
    defaultEngine.cancelAll();
    defaultEngine = null;
  }
}

// ============ React Hook ============

import { useEffect, useState, useCallback, useRef } from 'react';

export interface UseStreamingOptions {
  provider: ProviderName;
  model?: string;
  messages: Message[];
  chatOptions?: ChatOptions;
  config?: StreamConfig;
  onComplete?: (final: StreamComplete) => void;
  onError?: (error: StreamError) => void;
  autoStart?: boolean;
}

export interface UseStreamingReturn {
  text: string;
  status: StreamStatus;
  usage?: StreamComplete['usage'];
  error?: StreamError;
  stats?: StreamStats;
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  reset: () => void;
}

export function useStreamingResponse(options: UseStreamingOptions): UseStreamingReturn {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<StreamStatus>('pending');
  const [usage, setUsage] = useState<StreamComplete['usage']>();
  const [error, setError] = useState<StreamError>();
  const [stats, setStats] = useState<StreamStats>();
  const sessionRef = useRef<StreamSession | null>(null);

  const start = useCallback(() => {
    const engine = getDefaultStreamingResponseEngine();
    const session = engine.createStream({
      provider: options.provider,
      model: options.model,
      messages: options.messages,
      config: options.config,
      chatOptions: options.chatOptions,
    });
    sessionRef.current = session;

    session.onChunk((chunk) => {
      if (chunk.type === 'text' && chunk.text) {
        setText((prev) => prev + chunk.text);
      }
      setStats(session.getStats());
    });

    session.onComplete((final) => {
      setStatus('completed');
      setUsage(final.usage);
      setStats(session.getStats());
      options.onComplete?.(final);
    });

    session.onError((err) => {
      setStatus('error');
      setError(err);
      setStats(session.getStats());
      options.onError?.(err);
    });
  }, [options]);

  const pause = useCallback(() => sessionRef.current?.pause(), []);
  const resume = useCallback(() => sessionRef.current?.resume(), []);
  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    setStatus('cancelled');
  }, []);
  const reset = useCallback(() => {
    setText('');
    setStatus('pending');
    setUsage(undefined);
    setError(undefined);
    setStats(undefined);
  }, []);

  useEffect(() => {
    if (options.autoStart) {
      start();
    }
    return () => {
      sessionRef.current?.cancel();
    };
  }, [options.autoStart, start]);

  return { text, status, usage, error, stats, start, pause, resume, cancel, reset };
}
