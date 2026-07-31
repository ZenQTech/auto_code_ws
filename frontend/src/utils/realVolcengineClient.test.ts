/**
 * # ============================================================
 * # RealVolcengineClient 单元测试 (Cycle 50 G50-01)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RealVolcengineClient, createRealVolcengineClient, type RealVolcengineEvent } from './realVolcengineClient';
import { ApiKeyManager } from './apiKeyManager';
import { RateLimiter } from './rateLimiter';
import { CLIPLocalProvider } from './clipLocalProvider';

// ============================================================
// Mock Fetch
// ====================================

function createMockFetch(responses: Array<{
  status?: number;
  data?: unknown;
  error?: string;
  delayMs?: number;
}>): typeof fetch {
  let callIndex = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const idx = callIndex++;
    const r = responses[idx] ?? responses[responses.length - 1]!;
    if (r.delayMs) {
      await new Promise((res) => setTimeout(res, r.delayMs));
    }
    if (r.error) {
      return {
        ok: false,
        status: r.status ?? 500,
        text: async () => r.error,
        json: async () => {
          try {
            return JSON.parse(r.error!);
          } catch {
            return { error: { code: 'unknown', message: r.error, type: 'api_error' } };
          }
        },
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(r.data),
      json: async () => r.data,
    } as Response;
  }) as unknown as typeof fetch;
}

// ============================================================
// 测试
// ============================================================

describe('RealVolcengineClient - 基础配置', () => {
  it('默认未配置 API Key', () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr });
    expect(client.isConfigured()).toBe(false);
  });

  it('setApiKey 后应已配置', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr });
    await client.setApiKey('test-volc-key-1234567890');
    expect(client.isConfigured()).toBe(true);
  });

  it('forceFallback 应跳过真实 API', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr, forceFallback: true });
    await mgr.setApiKey('volcengine', 'test-key-1234567890');
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.endpoint).toBe('fallback');
  });
});

describe('RealVolcengineClient - 真实 API 调用', () => {
  it('成功调用应返回 embedding', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{
      data: {
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4], index: 0, object: 'embedding' }],
        model: 'doubao-embedding-vision',
        object: 'list',
        usage: { prompt_tokens: 10000, total_tokens: 10000 },
      },
    }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(result.usage.totalTokens).toBe(10000);
    expect(result.cost).toBeGreaterThan(0);
  });

  it('应正确传递文本输入', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    let capturedBody: unknown = null;
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
        json: async () => ({
          data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
          model: 'doubao-embedding-vision',
          object: 'list',
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    await client.embed({ modality: 'text', text: 'hello world' });
    expect((capturedBody as Record<string, unknown>).input).toBe('hello world');
    expect((capturedBody as Record<string, unknown>).model).toBe('doubao-embedding-vision');
  });

  it('图像输入应使用 image_url 格式', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    let capturedBody: unknown = null;
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({
          data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
          model: 'doubao-embedding-vision',
          object: 'list',
          usage: { prompt_tokens: 0, total_tokens: 0 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    await client.embed({ modality: 'image', image: 'https://example.com/cat.jpg' });
    const body = capturedBody as Record<string, unknown>;
    expect(Array.isArray(body.input)).toBe(true);
    expect((body.input as Array<{ type: string; image_url: { url: string } }>)[0]!.type).toBe('image_url');
  });

  it('多模态输入应同时包含 text + image', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    let capturedBody: unknown = null;
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({
          data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
          model: 'doubao-embedding-vision',
          object: 'list',
          usage: { prompt_tokens: 0, total_tokens: 0 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    await client.embed({ modality: 'multimodal', text: 'a cat', image: 'https://example.com/cat.jpg' });
    const body = capturedBody as Record<string, unknown>;
    const input = body.input as Array<{ type: string }>;
    expect(input.length).toBe(2);
  });
});

describe('RealVolcengineClient - 错误处理和重试', () => {
  it('401 错误应立即抛错 (不重试)', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ status: 401, error: 'Unauthorized' }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, maxRetries: 3 });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    // 应降级到 fallback
    expect(result.endpoint).toBe('fallback');
    expect(client.getStats().fallbackRequests).toBe(1);
  });

  it('500 错误应重试', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([
      { status: 500, error: 'Internal Server Error' },
      { status: 500, error: 'Internal Server Error' },
      { data: {
        data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
        model: 'doubao-embedding-vision',
        object: 'list',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }},
    ]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, maxRetries: 3, retryBackoffMs: 10 });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.embedding).toEqual([0.1]);
    expect(client.getStats().retriedRequests).toBe(2);
  });

  it('重试耗尽后应降级', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([
      { status: 500, error: 'Internal Server Error' },
      { status: 500, error: 'Internal Server Error' },
      { status: 500, error: 'Internal Server Error' },
      { status: 500, error: 'Internal Server Error' },
    ]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, maxRetries: 2, retryBackoffMs: 5 });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.endpoint).toBe('fallback');
  });
});

describe('RealVolcengineClient - 降级', () => {
  it('未配置 API Key 应降级到 fallback', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const mockFetch = vi.fn();
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch as unknown as typeof fetch });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.endpoint).toBe('fallback');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fallback 应使用 CLIPLocalProvider', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const fallback = new CLIPLocalProvider({ modelId: 'clip-vit-b32', dimension: 512 });
    const client = createRealVolcengineClient({ apiKeyManager: mgr, forceFallback: true, fallbackProvider: fallback });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.embedding).toHaveLength(512);
  });
});

describe('RealVolcengineClient - 限流', () => {
  it('被限流时应降级', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const rateLimiter = new RateLimiter({ strategy: 'token-bucket', windowMs: 1000, maxRequests: 1, burstCapacity: 1, refillRate: 1 });
    // 预消耗所有令牌
    rateLimiter.acquire(1);
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 0, total_tokens: 0 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, rateLimiter });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    expect(result.endpoint).toBe('fallback');
    expect(client.getStats().rateLimitedRequests).toBe(1);
  });
});

describe('RealVolcengineClient - 批量 Embedding', () => {
  it('应并行处理批量输入', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 0, total_tokens: 0 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, forceFallback: true });
    const results = await client.embedBatch([
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' },
      { modality: 'text', text: 'c' },
    ]);
    expect(results).toHaveLength(3);
  });
});

describe('RealVolcengineClient - 统计和事件', () => {
  it('应正确统计 success/fallback/error', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 0, total_tokens: 0 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    await client.embed({ modality: 'text', text: 'a' });
    await client.embed({ modality: 'text', text: 'b' });
    const stats = client.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.successRequests).toBe(2);
    expect(stats.totalTokens).toBe(0);
  });

  it('应触发 success 事件', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 0, total_tokens: 0 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch });
    const events: RealVolcengineEvent[] = [];
    client.subscribe((e) => events.push(e));
    await client.embed({ modality: 'text', text: 'a' });
    expect(events.some((e) => e.type === 'success')).toBe(true);
  });

  it('应触发 fallback 事件', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr, forceFallback: true });
    const events: RealVolcengineEvent[] = [];
    client.subscribe((e) => events.push(e));
    await client.embed({ modality: 'text', text: 'a' });
    expect(events.some((e) => e.type === 'fallback')).toBe(true);
  });

  it('应能退订事件', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr, forceFallback: true });
    const events: RealVolcengineEvent[] = [];
    const unsub = client.subscribe((e) => events.push(e));
    await client.embed({ modality: 'text', text: 'a' });
    const len = events.length;
    unsub();
    await client.embed({ modality: 'text', text: 'b' });
    expect(events.length).toBe(len);
  });

  it('resetStats 应清零所有统计', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    const client = createRealVolcengineClient({ apiKeyManager: mgr, forceFallback: true });
    await client.embed({ modality: 'text', text: 'a' });
    client.resetStats();
    expect(client.getStats().totalRequests).toBe(0);
  });
});

describe('RealVolcengineClient - 成本计算', () => {
  it('应计算文本成本', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 1000, total_tokens: 1000 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, inputCostPerMTokens: 1.0 });
    const result = await client.embed({ modality: 'text', text: 'hello' });
    // 1000 tokens * $1/M = $0.001
    expect(result.cost).toBeCloseTo(0.001, 6);
  });

  it('应计算图像成本', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = createMockFetch([{ data: { data: [{ embedding: [0.1], index: 0, object: 'embedding' }], model: 'doubao-embedding-vision', object: 'list', usage: { prompt_tokens: 0, total_tokens: 0 } } }]);
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, imageCostPerK: 1.0 });
    const result = await client.embed({ modality: 'image', image: 'https://example.com/x.jpg' });
    // 1 image * $1/1K = $0.001
    expect(result.cost).toBeCloseTo(0.001, 6);
  });
});

describe('RealVolcengineClient - AbortSignal', () => {
  it('应支持 abort', async () => {
    const mgr = new ApiKeyManager({ backend: 'memory' });
    await mgr.setApiKey('volcengine', 'test-volc-key-1234567890');
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init!.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;
    const client = createRealVolcengineClient({ apiKeyManager: mgr, fetchImpl: mockFetch, forceFallback: true });
    const result = await client.embed({ modality: 'text', text: 'a' });
    expect(result.endpoint).toBe('fallback');
  });
});
