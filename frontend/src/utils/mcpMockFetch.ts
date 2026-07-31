/**
 * # ============================================================
 * # MCP Mock Fetch Transport (v1.0.0 Cycle 43 G43-03)
 * # ============================================================
 * # 核心作用：模拟 @modelcontextprotocol/server-fetch 的离线行为
 * #           工具: fetch (HTTP GET/POST/PUT/DELETE)
 * #           支持 HTML/JSON/text 三种响应类型
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-03 初次创建
 * # ============================================================
 */

import { BaseTransport } from './mcpTransport';
import type { JsonRpcMessage, JsonRpcRequest } from './mcpTypes';
import type { MockFetchResponse } from './mcpFetchServer';

// ============ 类型定义 ============

export interface MockFetchConfig {
  /** 允许的 URL 前缀（空数组 = 允许所有） */
  allowedUrls?: string[];
  /** 模拟响应列表 */
  mockResponses?: MockFetchResponse[];
  /** 模拟延迟（毫秒） */
  responseDelayMs?: number;
  /** 默认响应（当 URL 没有匹配时） */
  defaultResponse?: MockFetchResponse;
}

// ============ Mock Transport 实现 ============

export function createMockFetchTransport(options: MockFetchConfig = {}): MockFetchTransport {
  return new MockFetchTransport({
    allowedUrls: options.allowedUrls ?? [],
    mockResponses: options.mockResponses ?? [
      {
        url: 'https://api.example.com/data',
        status: 200,
        statusText: 'OK',
        body: '{"name": "Example", "value": 42}',
        contentType: 'application/json',
      },
      {
        url: 'https://example.com/',
        status: 200,
        statusText: 'OK',
        body: '<!DOCTYPE html><html><head><title>Example</title></head><body>Hello, World!</body></html>',
        contentType: 'text/html',
      },
    ],
    responseDelayMs: options.responseDelayMs ?? 0,
    defaultResponse: options.defaultResponse,
  });
}

export class MockFetchTransport extends BaseTransport {
  public readonly type = 'stdio' as const;
  private readonly config: Required<MockFetchConfig>;

  constructor(config: MockFetchConfig) {
    super();
    this.config = {
      allowedUrls: config.allowedUrls ?? [],
      mockResponses: config.mockResponses ?? [],
      responseDelayMs: config.responseDelayMs ?? 0,
      defaultResponse: config.defaultResponse ?? {
        url: '*',
        status: 404,
        statusText: 'Not Found',
        body: 'Mock response not found',
        contentType: 'text/plain',
      },
    };
  }

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!('method' in message)) {
      return;
    }
    const req = message as JsonRpcRequest;

    setTimeout(() => {
      try {
        const response = this.handleRequest(req);
        this.deliverMessage(response);
      } catch (err) {
        this.deliverMessage({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }, this.config.responseDelayMs);
  }

  private deliverMessage(msg: JsonRpcMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private handleRequest(req: JsonRpcRequest): JsonRpcMessage {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-fetch', version: '1.0.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: this.listToolDefinitions() },
        };

      case 'tools/call': {
        const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
        const toolName = params?.name ?? '';
        const args = params?.arguments ?? {};
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: this.callTool(toolName, args),
        };
      }

      case 'notifications/initialized':
        return { jsonrpc: '2.0', id: req.id, result: {} };

      case 'ping':
        return { jsonrpc: '2.0', id: req.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  }

  private listToolDefinitions() {
    return [
      {
        name: 'fetch',
        description: 'Fetches a URL from the internet and optionally extracts its contents as markdown.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
              description: 'HTTP method',
              default: 'GET',
            },
            headers: { type: 'object', description: 'HTTP headers' },
            body: { type: 'string', description: 'Request body' },
          },
          required: ['url'],
        },
      },
    ];
  }

  private callTool(
    name: string,
    args: Record<string, unknown>,
  ): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      if (name !== 'fetch') {
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
      const url = args.url as string;
      if (!url) {
        return {
          content: [{ type: 'text', text: 'URL is required' }],
          isError: true,
        };
      }
      // 安全检查：allowedUrls
      if (this.config.allowedUrls.length > 0) {
        const allowed = this.config.allowedUrls.some((prefix) => url.startsWith(prefix));
        if (!allowed) {
          return {
            content: [{ type: 'text', text: `URL not allowed: ${url}` }],
            isError: true,
          };
        }
      }

      // 查找匹配的 mock 响应
      const matchedResponse = this.config.mockResponses.find((r) => r.url === url) || this.config.defaultResponse;
      const status = matchedResponse.status;
      const lines: string[] = [];
      lines.push(`HTTP/${matchedResponse.status >= 200 && matchedResponse.status < 300 ? '1.1' : '1.1'} ${status} ${matchedResponse.statusText}`);
      lines.push(`Content-Type: ${matchedResponse.contentType ?? 'text/plain'}`);
      if (matchedResponse.headers) {
        for (const [k, v] of Object.entries(matchedResponse.headers)) {
          lines.push(`${k}: ${v}`);
        }
      }
      lines.push('');
      lines.push(matchedResponse.body);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        isError: status >= 400,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    this._isOpen = false;
    this._closed = true;
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {
        /* ignore */
      }
    }
  }

  isOpen(): boolean {
    return this._isOpen && !this._closed;
  }
}
