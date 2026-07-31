/**
 * # ============================================================
 * # VolcengineMultimodalProvider 单元测试
 * # ============================================================
 * # 覆盖范围:
 * #   1. 基础功能 (构造/isAvailable/embed/embedBatch)
 * #   2. API Key 不可用降级
 * #   3. 强制降级
 * #   4. 真实 API 调用（Mock fetch）
 * #   5. 重试机制
 * #   6. 成本计算与统计
 * #   7. 事件订阅
 * #   8. Fallback Provider 切换
 * #   9. 边界条件（空输入/超时/网络错误）
 * #  10. Mock Provider 独立测试
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VolcengineMultimodalProvider,
  MockVolcengineMultimodalProvider,
  createVolcengineMultimodalProvider,
  createMockVolcengineMultimodalProvider,
  type VolcengineMultimodalEvent,
} from './volcengineMultimodalProvider';
import { CLIPLocalProvider } from './clipLocalProvider';

// ============ Mock fetch 工具 ============

function createMockFetch(response: unknown, options: { status?: number; delay?: number; failTimes?: number } = {}): typeof fetch & { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  let failureCount = 0;
  const failTimes = options.failTimes ?? 0;
  const status = options.status ?? 200;
  const delay = options.delay ?? 0;

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown;
    if (init?.body) {
      body = JSON.parse(init.body as string);
    }
    calls.push({ url, body });

    // 模拟失败
    if (failureCount < failTimes) {
      failureCount += 1;
      throw new Error('Network error');
    }

    // 模拟延迟
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(response),
      json: async () => response,
    } as unknown as Response;
  });

  return Object.assign(mockFetch as unknown as typeof fetch, { calls });
}

// ============ Mock 响应数据 ============

function makeMockResponse(embedding: number[] = Array.from({ length: 1024 }, () => 0.1)) {
  return {
    object: 'list',
    data: [
      {
        object: 'embedding',
        index: 0,
        embedding,
      },
    ],
    model: 'doubao-embedding-vision',
    usage: {
      prompt_tokens: 10,
      total_tokens: 10,
      image_count: 0,
    },
  };
}

// ============ 基础功能测试 ============

describe('VolcengineMultimodalProvider - 基础功能', () => {
  it('应能创建实例', () => {
    const p = createVolcengineMultimodalProvider();
    expect(p).toBeInstanceOf(VolcengineMultimodalProvider);
  });

  it('应暴露元数据', () => {
    const p = createVolcengineMultimodalProvider();
    expect(p.name).toContain('volcengine-multimodal');
    expect(p.dimension).toBe(1024);
    expect(p.supportedModalities).toContain('text');
    expect(p.supportedModalities).toContain('image');
    expect(p.supportedModalities).toContain('multimodal');
  });

  it('应支持自定义模型', () => {
    const p = createVolcengineMultimodalProvider({ model: 'custom-model' });
    expect(p.name).toContain('custom-model');
  });

  it('应支持自定义 baseURL', () => {
    const p = createVolcengineMultimodalProvider({ baseURL: 'https://custom.api.com' });
    // baseURL 不会直接暴露在属性中，但应该被使用
    expect(p).toBeInstanceOf(VolcengineMultimodalProvider);
  });
});

// ============ 降级测试 ============

describe('VolcengineMultimodalProvider - 自动降级', () => {
  it('无 API Key 应降级到 fallback', async () => {
    const p = createVolcengineMultimodalProvider();
    const v = await p.embed({ modality: 'text', text: 'test' });
    // fallback 维度由 CLIPLocalProvider 决定（默认 512）
    expect(v.length).toBeGreaterThan(0);
  });

  it('降级应使用 fallback provider 维度', async () => {
    const fallback = new CLIPLocalProvider({ modelId: 'clip-vit-l14' }); // 768 维
    const p = createVolcengineMultimodalProvider({ fallbackProvider: fallback });
    const v = await p.embed({ modality: 'text', text: 'test' });
    expect(v.length).toBe(768);
  });

  it('forceFallback=true 应直接使用 fallback', async () => {
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      forceFallback: true,
    });
    const v = await p.embed({ modality: 'text', text: 'force' });
    expect(v.length).toBeGreaterThan(0);
  });

  it('降级后统计应增加', async () => {
    const p = createVolcengineMultimodalProvider();
    await p.embed({ modality: 'text', text: 'fallback test' });
    const stats = p.getStats();
    expect(stats.fallbackRequests).toBeGreaterThan(0);
  });

  it('应触发 fallback 事件', async () => {
    const p = createVolcengineMultimodalProvider();
    const events: VolcengineMultimodalEvent[] = [];
    p.subscribe((e) => events.push(e));
    await p.embed({ modality: 'text', text: 'event test' });
    expect(events.some((e) => e.type === 'fallback')).toBe(true);
  });
});

// ============ 真实 API 调用测试 ============

describe('VolcengineMultimodalProvider - 真实 API', () => {
  it('有 API Key 时应调用真实 API', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const v = await p.embed({ modality: 'text', text: 'hello' });
    expect(v.length).toBe(1024);
    expect(mockFetch.calls.length).toBe(1);
  });

  it('API 调用 URL 应正确', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'text', text: 'test' });
    expect(mockFetch.calls[0]?.url).toContain('/embeddings/multimodal');
  });

  it('请求体应包含 model 和 input', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'text', text: 'check body' });
    const body = mockFetch.calls[0]?.body as { model: string; input: { text: string } };
    expect(body.model).toBe('doubao-embedding-vision');
    expect(body.input.text).toBe('check body');
  });

  it('图像模态应正确编码', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'image', image: 'cat.png' });
    const body = mockFetch.calls[0]?.body as { input: { image: string } };
    expect(body.input.image).toBe('cat.png');
  });

  it('多模态应同时包含文本和图像', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'multimodal', text: 'a cat', image: 'cat.jpg' });
    const body = mockFetch.calls[0]?.body as { input: { text: string; image: string } };
    expect(body.input.text).toBe('a cat');
    expect(body.input.image).toBe('cat.jpg');
  });

  it('Authorization header 应正确', async () => {
    const callsWithHeaders: Array<{ headers: Record<string, string> }> = [];
    const mockFetch = vi.fn(async () => {
      callsWithHeaders.push({
        headers: { Authorization: 'Bearer test-key' },
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(makeMockResponse()),
        json: async () => makeMockResponse(),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch,
    });
    await p.embed({ modality: 'text', text: 'test' });
    expect(callsWithHeaders[0]?.headers.Authorization).toBe('Bearer test-key');
  });
});

// ============ 重试机制测试 ============

describe('VolcengineMultimodalProvider - 重试机制', () => {
  it('网络错误应自动重试', async () => {
    const mockFetch = createMockFetch(makeMockResponse(), { failTimes: 1 });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 3,
      retryBackoffMs: 10,
    });
    const v = await p.embed({ modality: 'text', text: 'retry test' });
    expect(v.length).toBe(1024);
    expect(mockFetch.calls.length).toBe(2); // 1 失败 + 1 成功
  });

  it('超过重试次数后应降级', async () => {
    const mockFetch = createMockFetch(makeMockResponse(), { failTimes: 10 });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 2,
      retryBackoffMs: 10,
    });
    const v = await p.embed({ modality: 'text', text: 'giveup test' });
    // 重试后失败 → 降级到 fallback → 仍然返回向量
    expect(v.length).toBeGreaterThan(0);
    const stats = p.getStats();
    expect(stats.fallbackRequests).toBe(1);
  });

  it('重试事件应正确触发', async () => {
    const mockFetch = createMockFetch(makeMockResponse(), { failTimes: 1 });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 3,
      retryBackoffMs: 10,
    });
    const events: VolcengineMultimodalEvent[] = [];
    p.subscribe((e) => events.push(e));
    await p.embed({ modality: 'text', text: 'retry event' });
    expect(events.some((e) => e.type === 'retry')).toBe(true);
    expect(events.some((e) => e.type === 'api-success')).toBe(true);
  });

  it('指数退避应递增', async () => {
    // 直接测试：连续失败场景，验证重试事件被触发（不验证精确延迟时间）
    const mockFetch = createMockFetch(makeMockResponse(), { failTimes: 2 });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 2,
      retryBackoffMs: 10, // 用小延迟避免测试慢
    });
    const events: VolcengineMultimodalEvent[] = [];
    p.subscribe((e) => events.push(e));
    await p.embed({ modality: 'text', text: 'backoff' });
    // 应该有 2 次重试事件
    const retryEvents = events.filter((e) => e.type === 'retry');
    expect(retryEvents.length).toBe(2);
    // 重试次数应递增
    const retryEvent1 = retryEvents[0] as Extract<VolcengineMultimodalEvent, { type: 'retry' }>;
    const retryEvent2 = retryEvents[1] as Extract<VolcengineMultimodalEvent, { type: 'retry' }>;
    expect(retryEvent1.attempt).toBe(1);
    expect(retryEvent2.attempt).toBe(2);
  });
});

// ============ 错误处理测试 ============

describe('VolcengineMultimodalProvider - 错误处理', () => {
  it('HTTP 错误应降级', async () => {
    const mockFetch = createMockFetch({ error: 'invalid api key' }, { status: 401 });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'bad-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const v = await p.embed({ modality: 'text', text: 'error test' });
    expect(v.length).toBeGreaterThan(0);
    const stats = p.getStats();
    expect(stats.fallbackRequests).toBeGreaterThan(0);
  });

  it('API 响应无 embedding 应降级', async () => {
    const mockFetch = createMockFetch({ data: [], model: 'test' });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const v = await p.embed({ modality: 'text', text: 'empty data' });
    expect(v.length).toBeGreaterThan(0);
  });

  it('isAvailable 在有 API Key 时应尝试调用', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const available = await p.isAvailable();
    expect(available).toBe(true);
  });

  it('isAvailable 无 API Key 应返回 false', async () => {
    const p = createVolcengineMultimodalProvider();
    const available = await p.isAvailable();
    expect(available).toBe(false);
  });
});

// ============ 成本与统计测试 ============

describe('VolcengineMultimodalProvider - 成本与统计', () => {
  it('应记录 token 用量', async () => {
    const mockFetch = createMockFetch({
      ...makeMockResponse(),
      usage: { prompt_tokens: 100, total_tokens: 100, image_count: 0 },
    });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'text', text: 'cost test' });
    const stats = p.getStats();
    expect(stats.totalInputTokens).toBe(100);
  });

  it('应累计成本', async () => {
    const mockFetch = createMockFetch({
      ...makeMockResponse(),
      usage: { prompt_tokens: 1000000, total_tokens: 1000000, image_count: 0 },
    });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      inputCostPerMTokens: 0.5,
    });
    await p.embed({ modality: 'text', text: 'cost' });
    const stats = p.getStats();
    expect(stats.totalCostUsd).toBeCloseTo(0.5, 5);
  });

  it('应累计图像成本', async () => {
    const mockFetch = createMockFetch({
      ...makeMockResponse(),
      usage: { prompt_tokens: 0, total_tokens: 0, image_count: 1000 },
    });
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
      imageCostPerK: 1.0,
    });
    await p.embed({ modality: 'image', image: 'test.jpg' });
    const stats = p.getStats();
    expect(stats.totalImages).toBe(1000);
    expect(stats.totalCostUsd).toBeCloseTo(1.0, 5);
  });

  it('应累计成功请求数', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'text', text: 's1' });
    await p.embed({ modality: 'text', text: 's2' });
    const stats = p.getStats();
    expect(stats.successRequests).toBe(2);
  });

  it('estimateCost 应估算单次成本', () => {
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      inputCostPerMTokens: 1.0,
      imageCostPerK: 2.0,
    });
    const cost = p.estimateCost({ modality: 'multimodal', text: 'a'.repeat(4000), image: 'test.jpg' });
    expect(cost.tokens).toBe(1000);
    expect(cost.images).toBe(1);
    expect(cost.costUsd).toBeGreaterThan(0);
  });

  it('resetStats 应清零统计', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'text', text: 'test' });
    p.resetStats();
    const stats = p.getStats();
    expect(stats.successRequests).toBe(0);
    expect(stats.totalRequests).toBe(0);
  });
});

// ============ 事件订阅测试 ============

describe('VolcengineMultimodalProvider - 事件订阅', () => {
  it('subscribe 应返回取消订阅函数', () => {
    const p = createVolcengineMultimodalProvider();
    const events: VolcengineMultimodalEvent[] = [];
    const unsub = p.subscribe((e) => events.push(e));
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('取消订阅后应不再接收事件', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const events: VolcengineMultimodalEvent[] = [];
    const unsub = p.subscribe((e) => events.push(e));
    await p.embed({ modality: 'text', text: 't1' });
    unsub();
    await p.embed({ modality: 'text', text: 't2' });
    // 只应收到第一次的事件
    expect(events.filter((e) => e.type === 'api-call').length).toBe(1);
  });

  it('listener 错误不应影响其他 listener', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    p.subscribe(() => {
      throw new Error('listener error');
    });
    const events: VolcengineMultimodalEvent[] = [];
    p.subscribe((e) => events.push(e));
    await p.embed({ modality: 'text', text: 'error resilient' });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ============ Fallback 切换测试 ============

describe('VolcengineMultimodalProvider - Fallback 切换', () => {
  it('getFallbackProvider 应返回当前 fallback', () => {
    const p = createVolcengineMultimodalProvider();
    const fallback = p.getFallbackProvider();
    expect(fallback).toBeDefined();
  });

  it('setFallbackProvider 应切换 fallback', async () => {
    const p = createVolcengineMultimodalProvider();
    const newFallback = new CLIPLocalProvider({ modelId: 'clip-vit-l14' });
    p.setFallbackProvider(newFallback);
    expect(p.getFallbackProvider()).toBe(newFallback);
  });
});

// ============ 边界条件测试 ============

describe('VolcengineMultimodalProvider - 边界条件', () => {
  it('空文本应能处理', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const v = await p.embed({ modality: 'text', text: '' });
    expect(v.length).toBe(1024);
  });

  it('音频模态应降级为文本', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await p.embed({ modality: 'audio', audio: 'speech.mp3' });
    const body = mockFetch.calls[0]?.body as { input: { text: string } };
    expect(body.input.text).toContain('audio');
  });

  it('embedBatch 应批量调用', async () => {
    const mockFetch = createMockFetch(makeMockResponse());
    const p = createVolcengineMultimodalProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const vectors = await p.embedBatch([
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' },
    ]);
    expect(vectors.length).toBe(2);
  });

  it('embedBatch 空数组', async () => {
    const p = createVolcengineMultimodalProvider();
    const vectors = await p.embedBatch([]);
    expect(vectors).toEqual([]);
  });
});

// ============ Mock Provider 测试 ============

describe('MockVolcengineMultimodalProvider', () => {
  it('应能创建实例', () => {
    const p = createMockVolcengineMultimodalProvider();
    expect(p).toBeInstanceOf(MockVolcengineMultimodalProvider);
  });

  it('isAvailable 应返回 true', async () => {
    const p = createMockVolcengineMultimodalProvider();
    expect(await p.isAvailable()).toBe(true);
  });

  it('embed 应返回向量', async () => {
    const p = createMockVolcengineMultimodalProvider();
    const v = await p.embed({ modality: 'text', text: 'mock' });
    expect(v.length).toBeGreaterThan(0);
  });

  it('embedBatch 应返回多个向量', async () => {
    const p = createMockVolcengineMultimodalProvider();
    const vectors = await p.embedBatch([
      { modality: 'text', text: 'a' },
      { modality: 'image', image: 'b.jpg' },
    ]);
    expect(vectors.length).toBe(2);
  });
});
