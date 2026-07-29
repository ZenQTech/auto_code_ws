/**
 * # ============================================================
 * SSE 流式拦截器 (v6.42.0 Cycle 18 P1-2)
 * # ============================================================
 * 核心作用：统一封装 SSE（Server-Sent Events）流式响应处理
 * 设计决策：
 *   - 基于 fetch + ReadableStream（项目后端是 POST SSE，非 GET EventSource）
 *   - 事件路由（按 event.type 自动分发到 callback）
 *   - 心跳检测（超时无 chunk 自动断开 + 重连）
 *   - 断线自动重连（指数退避）
 *   - AbortSignal 透传（支持取消按钮）
 *   - 错误自动分类 + 上报 GlobalErrorHandler
 *   - 默认 SSE 格式：data: {json}\n\n
 * # 使用场景：
 *   - 流式对话（thinking / text 增量）
 *   - 实时工作流状态推送
 *   - 任务进度通知
 *   - 长连接事件订阅
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

import { reportError } from './globalErrorHandler';

// ============================================================
// 类型定义
// ============================================================

/** SSE 事件（解析后的） */
export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  /** 原始 data 字符串（解析失败时使用） */
  raw: string;
  /** 事件 ID（如果存在） */
  id?: string;
  /** 事件名称（如果存在，event: 字段） */
  event?: string;
}

/** SSE 流式请求选项 */
export interface SSEStreamOptions {
  /** 请求 URL（不含 API_BASE，若需要请自行拼接） */
  url: string;
  /** HTTP 方法（默认 POST） */
  method?: 'GET' | 'POST';
  /** 请求 body（自动 JSON.stringify） */
  body?: unknown;
  /** 自定义 headers */
  headers?: Record<string, string>;
  /** 外部 AbortSignal（用于取消） */
  signal?: AbortSignal;
  /** 事件路由表（type → callback） */
  events: Record<string, (data: any, event: SSEEvent) => void>;
  /** 通配回调（接收所有事件，路由前执行） */
  onEvent?: (event: SSEEvent) => void;
  /** 通用错误回调 */
  onError?: (error: SSEError) => void;
  /** 连接成功回调（流建立后） */
  onOpen?: () => void;
  /** 流结束回调（done 事件或正常关闭） */
  onClose?: () => void;
  /** 心跳超时时间（毫秒），默认 30000（30s 无 chunk 视为断流） */
  heartbeatMs?: number;
  /** 是否自动重连，默认 true */
  retry?: boolean;
  /** 最大重连次数（不含首次），默认 3 */
  maxRetries?: number;
  /** 重连退避策略（attempt 从 0 开始），默认 1s, 2s, 4s */
  retryBackoff?: (attempt: number) => number;
  /** 静默（不上报 GlobalErrorHandler），默认 false */
  silent?: boolean;
  /** 自定义解析器（默认标准 SSE 格式） */
  parser?: SSEParser;
  /** 请求 ID（用于日志追踪） */
  requestId?: string;
}

/** SSE 错误类型 */
export type SSEErrorType =
  | 'connection'    // 连接失败
  | 'parse'         // 解析失败
  | 'timeout'       // 心跳超时
  | 'aborted'       // 用户取消
  | 'server'        // 服务端 error 事件
  | 'unknown';

/** 自定义 SSE 错误 */
export class SSEError extends Error {
  public readonly type: SSEErrorType;
  public readonly status?: number;
  public readonly event?: SSEEvent;

  constructor(
    message: string,
    type: SSEErrorType,
    options: { status?: number; event?: SSEEvent; cause?: Error } = {},
  ) {
    super(message);
    this.name = 'SSEError';
    this.type = type;
    this.status = options.status;
    this.event = options.event;
    // 暂不设置 cause（lib.es2022.error.cause 在某些配置下不可用）
  }
}

/** SSE 解析器（可自定义） */
export interface SSEParser {
  /** 解析一个 chunk 字符串为事件数组 */
  parse(buffer: string, leftover: string): { events: SSEEvent[]; remaining: string };
  /** 格式化事件为发送字符串（仅用于测试） */
  format?(event: Partial<SSEEvent>): string;
}

// ============================================================
// 默认 SSE 解析器（标准 text/event-stream 格式）
// ============================================================

/**
 * 标准 SSE 解析器
 * 格式：
 *   data: {"type":"text","content":"hello"}\n\n
 *   data: {"type":"text","content":" world"}\n\n
 *   event: custom\n
 *   data: {"x":1}\n\n
 *   id: 123\n
 *   data: {"y":2}\n\n
 */
export const defaultSSEParser: SSEParser = {
  parse(buffer, leftover) {
    const combined = leftover + buffer;
    const events: SSEEvent[] = [];
    // 按 \n\n 或 \r\n\r\n 分隔
    const parts = combined.split(/\r?\n\r?\n/);
    const remaining = parts.pop() || '';

    for (const part of parts) {
      if (!part.trim()) continue;

      let eventName: string | undefined;
      let eventId: string | undefined;
      const dataLines: string[] = [];

      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith(':')) {
          // 注释行，忽略
          continue;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
          // 没有冒号，整行作为字段名（值为空）
          if (line === 'data') dataLines.push('');
          continue;
        }
        const field = line.slice(0, colonIndex);
        let value = line.slice(colonIndex + 1);
        // SSE 规范：value 前的单个空格被忽略
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'data') {
          dataLines.push(value);
        } else if (field === 'event') {
          eventName = value;
        } else if (field === 'id') {
          eventId = value;
        }
        // retry / 其他字段忽略
      }

      const raw = dataLines.join('\n');
      if (!raw) continue;

      let data: Record<string, unknown> = {};
      let type = eventName || 'message';

      // 尝试解析为 JSON
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
          // 如果 JSON 中有 type 字段，优先使用
          if (typeof data.type === 'string') {
            type = data.type;
          }
        } else {
          data = { value: parsed };
        }
      } catch {
        // 解析失败，使用原始字符串
        data = { raw };
        type = eventName || 'message';
      }

      events.push({
        type,
        data,
        raw,
        id: eventId,
        event: eventName,
      });
    }

    return { events, remaining };
  },
};

// ============================================================
// 工具函数
// ============================================================

/** 休眠 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 核心：SSE 流控制器
// ============================================================

/** SSE 流控制器（提供 start / cancel 接口） */
export interface SSEStream {
  /** 启动流（自动重试） */
  start(): Promise<void>;
  /** 取消流（不会再重试） */
  cancel(): void;
  /** 当前是否活跃 */
  isActive(): boolean;
  /** 当前重试次数 */
  getRetryCount(): number;
}

/**
 * 创建 SSE 流（统一封装）
 * @param options 配置选项
 * @returns SSEStream 控制器
 */
export function createSSEStream(options: SSEStreamOptions): SSEStream {
  const {
    url,
    method = 'POST',
    body,
    headers = {},
    signal: externalSignal,
    events,
    onEvent,
    onError,
    onOpen,
    onClose,
    heartbeatMs = 30000,
    retry = true,
    maxRetries = 3,
    retryBackoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 10000),
    silent = false,
    parser = defaultSSEParser,
    requestId,
  } = options;

  // 内部状态
  let active = true;
  let retryCount = 0;
  let combinedController: AbortController | null = null;

  // 组合外部 signal + 内部 signal
  function getCombinedSignal(): AbortSignal {
    if (combinedController) return combinedController.signal;
    combinedController = new AbortController();

    if (externalSignal) {
      if (externalSignal.aborted) {
        combinedController.abort();
      } else {
        externalSignal.addEventListener('abort', () => combinedController?.abort());
      }
    }

    return combinedController.signal;
  }

  /** 主动取消（外部调用） */
  function cancel(): void {
    active = false;
    combinedController?.abort();
  }

  /** 单次连接尝试 */
  async function connectOnce(_attempt: number): Promise<void> {
    const signal = getCombinedSignal();
    if (signal.aborted) {
      throw new SSEError('流已取消', 'aborted');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      // 网络错误或 abort
      if (err instanceof Error && (err.name === 'AbortError' || signal.aborted)) {
        throw new SSEError('流被中止', 'aborted', { cause: err });
      }
      throw new SSEError(
        `连接失败: ${err instanceof Error ? err.message : String(err)}`,
        'connection',
        { cause: err instanceof Error ? err : undefined },
      );
    }

    if (!response.ok) {
      throw new SSEError(
        `HTTP ${response.status}: ${response.statusText}`,
        'connection',
        { status: response.status },
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new SSEError('无法读取响应流', 'connection');
    }

    // 连接成功
    onOpen?.();
    retryCount = 0; // 重置重试计数

    const decoder = new TextDecoder();
    let leftover = '';
    let lastChunkTime = Date.now();
    let heartbeatTimer: number | null = null;

    // 心跳检测
    const resetHeartbeat = (): void => {
      lastChunkTime = Date.now();
      if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
      }
      heartbeatTimer = window.setTimeout(() => {
        const elapsed = Date.now() - lastChunkTime;
        if (elapsed >= heartbeatMs) {
          // 心跳超时，关闭 reader（自动触发重连）
          reader.cancel().catch(() => {
            /* ignore */
          });
        }
      }, heartbeatMs);
    };

    resetHeartbeat();

    try {
      while (active) {
        const readPromise = reader.read();
        const timeoutPromise = new Promise<{ done: boolean; value: undefined; timeout: true }>(
          (resolve) => {
            const timer = window.setTimeout(() => {
              resolve({ done: false, value: undefined, timeout: true });
            }, heartbeatMs);
            signal.addEventListener('abort', () => {
              window.clearTimeout(timer);
            });
          },
        );

        const result = await Promise.race([readPromise, timeoutPromise]);
        if ('timeout' in result && result.timeout) {
          // 心跳超时
          throw new SSEError('心跳超时', 'timeout');
        }

        // 检查 signal（abort 可能在 read 期间触发）
        if (signal.aborted) {
          throw new SSEError('流被中止', 'aborted');
        }

        const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
        if (done) {
          // 流正常结束
          break;
        }

        if (value) {
          resetHeartbeat();
          const chunkStr = decoder.decode(value, { stream: true });
          const { events: parsed, remaining } = parser.parse(chunkStr, leftover);
          leftover = remaining;

          for (const event of parsed) {
            // 通配回调
            onEvent?.(event);

            // 路由到具体 handler
            const handler = events[event.type];
            if (handler) {
              try {
                handler(event.data, event);
              } catch (err) {
                // 单个 handler 异常不应中断整个流
                if (!silent) {
                  reportError(
                    err instanceof Error ? err : new Error(String(err)),
                    'manual_report',
                    { eventType: event.type, requestId },
                  );
                }
              }
            }

            // 服务端显式 error 事件
            if (event.type === 'error') {
              const errMsg =
                typeof event.data.content === 'string'
                  ? event.data.content
                  : typeof event.data.message === 'string'
                  ? event.data.message
                  : '服务端返回错误';
              throw new SSEError(errMsg, 'server', { event });
            }
          }
        }
      }
    } finally {
      if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
      }
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  /** 启动流（包含重试逻辑） */
  async function start(): Promise<void> {
    let lastError: SSEError | null = null;

    while (active) {
      try {
        await connectOnce(retryCount);
        // 正常结束
        onClose?.();
        return;
      } catch (err) {
        if (err instanceof SSEError) {
          lastError = err;

          // 用户主动取消：不重试
          if (err.type === 'aborted') {
            throw err;
          }

          // 达到最大重试次数
          if (!retry || retryCount >= maxRetries) {
            // 上报
            if (!silent) {
              reportError(err, 'fetch_error', { url, method, requestId });
            }
            onError?.(err);
            throw err;
          }

          // 计算退避时间
          const delay = retryBackoff(retryCount);
          retryCount++;

          // 通知 onError（不视为失败）
          onError?.(err);

          // 等待后退避
          await sleep(delay);
        } else {
          // 未知错误
          const wrapped = new SSEError(
            err instanceof Error ? err.message : String(err),
            'unknown',
            { cause: err instanceof Error ? err : undefined },
          );
          if (!silent) {
            reportError(wrapped, 'fetch_error', { url, method, requestId });
          }
          onError?.(wrapped);
          throw wrapped;
        }
      }
    }

    // 如果到这里说明流被取消
    if (lastError && !silent) {
      onError?.(lastError);
    }
  }

  return {
    start,
    cancel,
    isActive: () => active,
    getRetryCount: () => retryCount,
  };
}

export default createSSEStream;
