/**
 * # ============================================================
 * # MCP SSE Transport 单元测试 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 覆盖：基本 API + SSE 事件处理 + 状态管理
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseMcpTransport } from './mcpTransportSse';
import { McpConnectionError } from './mcpErrors';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SseMcpTransport', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('构造时未启动', () => {
    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });
    expect(transport.isOpen()).toBe(false);
    expect(transport.type).toBe('sse');
  });

  it('start 成功时设置 isOpen', async () => {
    // Mock 成功返回 SSE 响应
    const encoder = new TextEncoder();
    const sseData = 'event: endpoint\ndata: http://localhost:3000/msg\n\n';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => (name === 'Content-Type' ? 'text/event-stream' : null),
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      }),
    });

    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });

    await transport.start();
    expect(transport.isOpen()).toBe(true);

    await transport.close();
  });

  it('HTTP 错误时抛连接错误', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
      body: null,
    });

    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });

    await expect(transport.start()).rejects.toThrow(McpConnectionError);
  });

  it('无 body 时抛连接错误', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      body: null,
    });

    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });

    await expect(transport.start()).rejects.toThrow(McpConnectionError);
  });

  it('send 在未启动时抛错', async () => {
    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });
    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    ).rejects.toThrow(McpConnectionError);
  });

  it('send 在 server endpoint 未就绪时抛错', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });

    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });

    await transport.start();
    // 立即 send（endpoint 还未到达）
    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    ).rejects.toThrow();

    await transport.close();
  });

  it('close 后再次 close 安全', async () => {
    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });
    await transport.close();
    await transport.close();
    expect(transport.isOpen()).toBe(false);
  });

  it('onMessage/onError/onClose 注册回调', () => {
    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
    });
    const unsub1 = transport.onMessage(() => {});
    const unsub2 = transport.onError(() => {});
    const unsub3 = transport.onClose(() => {});
    expect(typeof unsub1).toBe('function');
    expect(typeof unsub2).toBe('function');
    expect(typeof unsub3).toBe('function');
    unsub1();
    unsub2();
    unsub3();
  });

  it('带 headers 的请求', async () => {
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => (name === 'Content-Type' ? 'text/event-stream' : null),
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: endpoint\ndata: http://x/msg\n\n'));
          controller.close();
        },
      }),
    });

    const transport = new SseMcpTransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
      headers: { Authorization: 'Bearer token' },
    });

    await transport.start();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/sse',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      }),
    );

    await transport.close();
  });
});
