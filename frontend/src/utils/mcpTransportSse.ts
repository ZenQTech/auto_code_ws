/**
 * # ============================================================
 * # MCP SSE Transport - 远程 SSE/HTTP 传输 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 核心作用：通过 HTTP + Server-Sent Events 与远程 MCP 服务器通信
 * #           GET → 打开 SSE 连接, 接收 server endpoint
 * #           POST → 发送 JSON-RPC 请求到 server endpoint
 * #           SSE → 接收服务器响应和通知
 * # 适用场景：远程 MCP 服务 (HTTP/SSE 协议)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

import { BaseTransport } from './mcpTransport';
import {
  type JsonRpcMessage,
  type SseTransportOptions,
} from './mcpTypes';
import { McpConnectionError, McpParseError } from './mcpErrors';

/**
 * MCP SSE 传输
 * 使用 fetch + EventSource 实现
 * 兼容浏览器和 Node.js (Node 18+ 内置 fetch)
 */
export class SseMcpTransport extends BaseTransport {
  public readonly type = 'sse' as const;

  private readonly options: Required<Omit<SseTransportOptions, 'type'>>;
  private serverEndpoint: string | null = null;
  private abortController: AbortController | null = null;

  constructor(options: SseTransportOptions) {
    super();
    this.options = {
      url: options.url,
      headers: options.headers ?? {},
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
    };
  }

  async start(): Promise<void> {
    if (this._isOpen) return;
    if (this._closed) {
      throw new McpConnectionError('Transport already closed');
    }

    this.abortController = new AbortController();

    try {
      // 1. 打开 SSE 连接 → 接收 server endpoint
      await this.openSseConnection();
      this._isOpen = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitError(error);
      throw new McpConnectionError(`Failed to start SSE transport: ${error.message}`);
    }
  }

  /**
   * 打开 SSE 连接
   * GET 请求会返回一个 SSE 流
   * 第一个事件通常是 'endpoint' 事件，data 包含 server endpoint URL
   */
  private async openSseConnection(): Promise<void> {
    const response = await fetch(this.options.url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...this.options.headers,
      },
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new McpConnectionError(
        `SSE endpoint returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new McpConnectionError('SSE response has no body');
    }

    // 异步读取 SSE 流
    this.readSseStream(response.body).catch((err) => {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
      this.emitClose();
    });
  }

  /**
   * 读取 SSE 流
   * 解析 event: / data: 字段
   */
  private async readSseStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';
    let currentData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按行处理
        let lineEnd: number;
        while ((lineEnd = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
          buffer = buffer.slice(lineEnd + 1);

          if (line.length === 0) {
            // 空行表示事件结束
            if (currentData) {
              this.handleSseEvent(currentEvent, currentData);
              currentEvent = 'message';
              currentData = '';
            }
          } else if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData = line.slice(5).trim();
          }
          // 忽略其他字段（如 id:, retry:）
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 处理单个 SSE 事件
   */
  private handleSseEvent(event: string, data: string): void {
    if (event === 'endpoint') {
      // 接收 server endpoint URL
      this.serverEndpoint = data;
      return;
    }

    if (event === 'message' || event === 'response') {
      try {
        const msg = JSON.parse(data) as JsonRpcMessage;
        this.emitMessage(msg);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.emitError(new McpParseError(`Failed to parse SSE message: ${errMsg}`));
      }
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.isOpen()) {
      throw new McpConnectionError('Transport not open');
    }
    if (!this.serverEndpoint) {
      throw new McpConnectionError('Server endpoint not yet received');
    }

    try {
      const response = await fetch(this.serverEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...this.options.headers,
        },
        body: JSON.stringify(message),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new McpConnectionError(
          `POST returned HTTP ${response.status}: ${response.statusText}`,
        );
      }

      // 响应可能是 JSON 或 SSE 流
      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/event-stream')) {
        if (response.body) {
          await this.readSseStream(response.body);
        }
      } else {
        // 尝试作为 JSON 解析
        const text = await response.text();
        if (text.trim()) {
          try {
            const msg = JSON.parse(text) as JsonRpcMessage;
            this.emitMessage(msg);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.emitError(new McpParseError(`Failed to parse response: ${errMsg}`));
          }
        }
      }
    } catch (err) {
      if (err instanceof McpConnectionError || err instanceof McpParseError) {
        throw err;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      throw new McpConnectionError(`Failed to send message: ${error.message}`);
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._isOpen = false;

    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // 静默吞掉
      }
      this.abortController = null;
    }
    this.serverEndpoint = null;
    this.emitClose();
  }
}
