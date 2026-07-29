/**
 * SSE 流式拦截器单元测试 (v6.42.0 Cycle 18 P1-2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSSEStream,
  defaultSSEParser,
  SSEError,
} from './sseInterceptor';
import { globalErrorHandler } from './globalErrorHandler';

// ============================================================
// 辅助：创建 ReadableStream
// ============================================================

function createMockStream(chunks: (Uint8Array | string)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < queue.length) {
        controller.enqueue(queue[index++]);
      } else {
        controller.close();
      }
    },
  });
}

function createMockResponse(
  body: ReadableStream<Uint8Array> | null,
  options: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    body,
    headers: { get: (k: string) => (k === 'Content-Type' ? 'text/event-stream' : null) },
  } as unknown as Response;
}

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('SSE 流式拦截器', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    globalErrorHandler.uninstall();
    globalErrorHandler.clearReports();
    globalErrorHandler.unsubscribeAll();
  });

  afterEach(() => {
    globalErrorHandler.uninstall();
    globalErrorHandler.unsubscribeAll();
  });

  describe('事件路由', () => {
    it('按 type 分发到对应 handler', async () => {
      const thinking = vi.fn();
      const text = vi.fn();
      const stream = createMockStream([
        'data: {"type":"thinking","content":"分析中..."}\n\n',
        'data: {"type":"text","content":"你好"}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: {
          thinking: (data) => thinking(data.content),
          text: (data) => text(data.content),
        },
      });

      await sse.start();
      expect(thinking).toHaveBeenCalledWith('分析中...');
      expect(text).toHaveBeenCalledWith('你好');
    });

    it('通配 onEvent 接收所有事件', async () => {
      const onEvent = vi.fn();
      const stream = createMockStream([
        'data: {"type":"a","x":1}\n\n',
        'data: {"type":"b","y":2}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        onEvent,
      });

      await sse.start();
      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(onEvent.mock.calls[0][0].type).toBe('a');
      expect(onEvent.mock.calls[1][0].type).toBe('b');
    });

    it('无对应 handler 时事件被忽略（不抛错）', async () => {
      const stream = createMockStream(['data: {"type":"unknown","x":1}\n\n']);
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: { thinking: vi.fn() },
      });

      await expect(sse.start()).resolves.toBeUndefined();
    });

    it('单 handler 异常不影响流继续', async () => {
      const handler1 = vi.fn(() => {
        throw new Error('handler1 error');
      });
      const handler2 = vi.fn();
      const stream = createMockStream([
        'data: {"type":"a"}\n\n',
        'data: {"type":"b"}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: { a: handler1, b: handler2 },
        silent: false,
      });

      await sse.start();
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('SSE 解析器', () => {
    it('解析标准 data 格式', () => {
      const { events, remaining } = defaultSSEParser.parse(
        'data: {"type":"text","content":"hi"}\n\n',
        '',
      );
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('text');
      expect(events[0].data.content).toBe('hi');
      expect(remaining).toBe('');
    });

    it('解析多条事件', () => {
      const { events, remaining } = defaultSSEParser.parse(
        'data: {"a":1}\n\ndata: {"b":2}\n\n',
        '',
      );
      expect(events.length).toBe(2);
      expect(remaining).toBe('');
    });

    it('处理跨 chunk 的不完整事件', () => {
      const { events: e1, remaining: r1 } = defaultSSEParser.parse(
        'data: {"a":',
        '',
      );
      expect(e1.length).toBe(0);
      expect(r1).toBe('data: {"a":');

      const { events: e2 } = defaultSSEParser.parse('1}\n\n', r1);
      expect(e2.length).toBe(1);
      expect(e2[0].data.a).toBe(1);
    });

    it('解析 event 字段（自定义事件名）', () => {
      const { events } = defaultSSEParser.parse(
        'event: custom\ndata: {"x":1}\n\n',
        '',
      );
      expect(events.length).toBe(1);
      expect(events[0].event).toBe('custom');
    });

    it('非 JSON 数据使用 raw 字段', () => {
      const { events } = defaultSSEParser.parse('data: hello world\n\n', '');
      expect(events.length).toBe(1);
      expect(events[0].data.raw).toBe('hello world');
    });

    it('注释行被忽略', () => {
      const { events } = defaultSSEParser.parse(
        ': comment\ndata: {"x":1}\n\n',
        '',
      );
      expect(events.length).toBe(1);
    });
  });

  describe('取消（AbortSignal）', () => {
    it('外部 signal 触发后流停止', async () => {
      const controller = new AbortController();
      // 创建一个永远不结束的流
      const stream = new ReadableStream<Uint8Array>({
        start() {
          /* no-op */
        },
      });
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        signal: controller.signal,
        retry: false,
        heartbeatMs: 100, // 快速心跳以便测试
      });

      // 启动但不 await
      const promise = sse.start();
      // 触发 abort
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow(SSEError);
    });

    it('cancel() 方法主动取消', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start() {
          /* no-op */
        },
      });
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
        heartbeatMs: 100,
      });

      const promise = sse.start();
      setTimeout(() => sse.cancel(), 50);

      await expect(promise).rejects.toThrow(SSEError);
    });
  });

  describe('错误处理', () => {
    it('HTTP 错误抛出 SSEError', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(null, { ok: false, status: 500, statusText: 'Error' }),
      );

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
      });

      await expect(sse.start()).rejects.toThrow(SSEError);
    });

    it('网络错误抛出 SSEError type=connection', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
      });

      try {
        await sse.start();
      } catch (err) {
        expect(err).toBeInstanceOf(SSEError);
        if (err instanceof SSEError) {
          expect(err.type).toBe('connection');
        }
      }
    });

    it('服务端 error 事件触发 SSEError', async () => {
      const stream = createMockStream([
        'data: {"type":"thinking","content":"..."}\n\n',
        'data: {"type":"error","content":"模型错误"}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(stream));

      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
      });

      try {
        await sse.start();
      } catch (err) {
        expect(err).toBeInstanceOf(SSEError);
        if (err instanceof SSEError) {
          expect(err.type).toBe('server');
        }
      }
    });

    it('非静默模式上报到 GlobalErrorHandler', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed'));
      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
        silent: false,
      });

      try {
        await sse.start();
      } catch {
        /* ignore */
      }
      const reports = globalErrorHandler.getReports();
      expect(reports.length).toBeGreaterThan(0);
    });

    it('silent=true 不上报', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed'));
      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
        silent: true,
      });

      try {
        await sse.start();
      } catch {
        /* ignore */
      }
      expect(globalErrorHandler.getReports().length).toBe(0);
    });
  });

  describe('SSEError 类', () => {
    it('包含 type, status, event 字段', () => {
      const err = new SSEError('test', 'connection', { status: 500 });
      expect(err.type).toBe('connection');
      expect(err.status).toBe(500);
      expect(err.message).toBe('test');
    });

    it('继承自 Error', () => {
      const err = new SSEError('test', 'timeout');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('流状态', () => {
    it('isActive() 在流运行中为 true', () => {
      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
      });
      expect(sse.isActive()).toBe(true);
      sse.cancel();
      expect(sse.isActive()).toBe(false);
    });

    it('getRetryCount() 返回当前重试次数', () => {
      const sse = createSSEStream({
        url: '/api/test',
        events: {},
        retry: false,
      });
      expect(sse.getRetryCount()).toBe(0);
    });
  });
});
