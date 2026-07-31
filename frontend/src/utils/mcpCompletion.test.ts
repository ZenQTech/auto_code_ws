/**
 * # ============================================================
 * # MCP Completion 单元测试 (v1.0.0 Cycle 41 G41-02)
 * # ============================================================
 * # 覆盖：CompletionProvider 全功能
 * #       - 基础补全
 * #       - 缓存命中
 * #       - in-flight 去重
 * #       - 强制刷新
 * #       - 批量补全
 * #       - 便捷方法
 * #       - 事件分发
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-02 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CompletionProvider,
  createCompletionProvider,
  createMcpCompletionClient,
  type CompletionClient,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionEvent,
} from './mcpCompletion';

// ============ Mock Client ============

class MockCompletionClient implements CompletionClient {
  public callCount: number = 0;
  public callLog: CompletionRequest[] = [];
  public responses: Map<string, CompletionResponse> = new Map();
  public delay: number = 0;
  public shouldFail: boolean = false;

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.callCount += 1;
    this.callLog.push(request);
    if (this.delay > 0) {
      await new Promise((r) => setTimeout(r, this.delay));
    }
    if (this.shouldFail) {
      throw new Error('Mock failure');
    }
    const key = `${request.ref.type}|${'name' in request.ref ? request.ref.name : request.ref.uri}|${request.argument.name}|${request.argument.value}`;
    return this.responses.get(key) ?? { values: [], total: 0 };
  }

  setResponse(request: CompletionRequest, response: CompletionResponse): void {
    const key = `${request.ref.type}|${'name' in request.ref ? request.ref.name : request.ref.uri}|${request.argument.name}|${request.argument.value}`;
    this.responses.set(key, response);
  }
}

// ============ 基础功能测试 ============

describe('CompletionProvider - 基础', () => {
  it('创建实例', () => {
    const p = new CompletionProvider();
    expect(p.getCacheStats().size).toBe(0);
  });

  it('工厂函数创建', () => {
    const p = createCompletionProvider();
    expect(p).toBeInstanceOf(CompletionProvider);
  });

  it('未绑定客户端抛错', async () => {
    const p = new CompletionProvider();
    await expect(
      p.complete({
        ref: { type: 'ref/prompt', name: 'test' },
        argument: { name: 'arg', value: 'x' },
      }),
    ).rejects.toThrow();
  });
});

// ============ 补全请求测试 ============

describe('CompletionProvider - 补全请求', () => {
  let provider: CompletionProvider;
  let client: MockCompletionClient;

  beforeEach(() => {
    provider = new CompletionProvider();
    client = new MockCompletionClient();
    provider.attachClient(client);
  });

  afterEach(() => {
    provider.dispose();
  });

  it('基本补全', async () => {
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'greet' },
      argument: { name: 'language', value: 'py' },
    };
    client.setResponse(req, { values: ['python', 'pypy'], total: 2 });
    const resp = await provider.complete(req);
    expect(resp.values).toEqual(['python', 'pypy']);
    expect(resp.total).toBe(2);
  });

  it('提示词参数补全（便捷方法）', async () => {
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'code_review' },
      argument: { name: 'language', value: 'ja' },
    };
    client.setResponse(req, { values: ['javascript', 'java'], total: 2 });
    const resp = await provider.completePromptParam('code_review', 'language', 'ja');
    expect(resp.values).toContain('javascript');
  });

  it('资源 URI 补全（便捷方法）', async () => {
    const req: CompletionRequest = {
      ref: { type: 'ref/resource', uri: 'file:///' },
      argument: { name: 'uri', value: 'a' },
    };
    client.setResponse(req, { values: ['a.txt', 'abc.md'], total: 2 });
    const resp = await provider.completeResourceUri('file:///', 'a');
    expect(resp.values.length).toBe(2);
  });

  it('工具参数补全（便捷方法）', async () => {
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: '__tool__:read_file' },
      argument: { name: 'path', value: '/usr' },
    };
    client.setResponse(req, { values: ['/usr/bin', '/usr/local'], total: 2 });
    const resp = await provider.completeToolParam('read_file', 'path', '/usr');
    expect(resp.values.length).toBe(2);
  });

  it('错误传播', async () => {
    client.shouldFail = true;
    await expect(
      provider.complete({
        ref: { type: 'ref/prompt', name: 'x' },
        argument: { name: 'y', value: 'z' },
      }),
    ).rejects.toThrow('Mock failure');
  });
});

// ============ 缓存测试 ============

describe('CompletionProvider - 缓存', () => {
  it('缓存命中避免重复请求', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider({ cacheTtlMs: 60000 });
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    await provider.complete(req);
    expect(client.callCount).toBe(1);
  });

  it('forceRefresh 绕过缓存', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    await provider.complete(req, { forceRefresh: true });
    expect(client.callCount).toBe(2);
  });

  it('缓存过期重新请求', async () => {
    vi.useFakeTimers();
    const client = new MockCompletionClient();
    const provider = new CompletionProvider({ cacheTtlMs: 100 });
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    vi.advanceTimersByTime(200);
    await provider.complete(req);
    expect(client.callCount).toBe(2);
    vi.useRealTimers();
  });

  it('clearCache 清空所有缓存', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    provider.clearCache();
    await provider.complete(req);
    expect(client.callCount).toBe(2);
  });

  it('客户端变更时清空缓存', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    provider.attachClient(new MockCompletionClient());
    expect(provider.getCacheStats().size).toBe(0);
  });

  it('LRU 清理超出 maxSize', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider({ maxCacheSize: 10, cacheTtlMs: 60000 });
    provider.attachClient(client);
    for (let i = 0; i < 25; i++) {
      const req: CompletionRequest = {
        ref: { type: 'ref/prompt', name: 'p' },
        argument: { name: 'a', value: `v${i}` },
      };
      client.setResponse(req, { values: [`v${i}`] });
      await provider.complete(req);
    }
    expect(provider.getCacheStats().size).toBeLessThanOrEqual(10);
  });
});

// ============ in-flight 去重测试 ============

describe('CompletionProvider - in-flight 去重', () => {
  it('并发请求合并为一次', async () => {
    const client = new MockCompletionClient();
    client.delay = 50;
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    const p1 = provider.complete(req);
    const p2 = provider.complete(req);
    await Promise.all([p1, p2]);
    expect(client.callCount).toBe(1);
  });

  it('不同请求不合并', async () => {
    const client = new MockCompletionClient();
    client.delay = 20;
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const r1: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: '1' },
    };
    const r2: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: '2' },
    };
    client.setResponse(r1, { values: ['1'] });
    client.setResponse(r2, { values: ['2'] });
    await Promise.all([provider.complete(r1), provider.complete(r2)]);
    expect(client.callCount).toBe(2);
  });
});

// ============ 批量补全测试 ============

describe('CompletionProvider - 批量', () => {
  it('completeBatch 并行处理', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const reqs: CompletionRequest[] = [
      { ref: { type: 'ref/prompt', name: 'p' }, argument: { name: 'a', value: '1' } },
      { ref: { type: 'ref/prompt', name: 'p' }, argument: { name: 'a', value: '2' } },
      { ref: { type: 'ref/prompt', name: 'p' }, argument: { name: 'a', value: '3' } },
    ];
    for (const r of reqs) client.setResponse(r, { values: [r.argument.value] });
    const resps = await provider.completeBatch(reqs);
    expect(resps.length).toBe(3);
  });
});

// ============ 事件分发测试 ============

describe('CompletionProvider - 事件', () => {
  it('request 事件', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const events: CompletionEvent[] = [];
    provider.on((e) => events.push(e));
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    expect(events.find((e) => e.type === 'request')).toBeDefined();
    expect(events.find((e) => e.type === 'response')).toBeDefined();
  });

  it('cache_hit 事件', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const events: CompletionEvent[] = [];
    provider.on((e) => events.push(e));
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    await provider.complete(req); // 第二次命中缓存
    expect(events.filter((e) => e.type === 'cache_hit').length).toBe(1);
  });

  it('error 事件', async () => {
    const client = new MockCompletionClient();
    client.shouldFail = true;
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const events: CompletionEvent[] = [];
    provider.on((e) => events.push(e));
    await expect(
      provider.complete({
        ref: { type: 'ref/prompt', name: 'p' },
        argument: { name: 'a', value: 'b' },
      }),
    ).rejects.toThrow();
    expect(events.find((e) => e.type === 'error')).toBeDefined();
  });

  it('取消事件订阅', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const off = provider.on(() => {});
    off();
    expect(provider.getCacheStats().inFlight).toBe(0);
  });
});

// ============ McpClient 适配器测试 ============

describe('createMcpCompletionClient', () => {
  it('适配器正确转换参数', async () => {
    const requestMock = vi.fn().mockResolvedValue({ values: ['x'], total: 1 });
    const adapter = createMcpCompletionClient({ request: requestMock });
    const resp = await adapter.complete({
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    });
    expect(requestMock).toHaveBeenCalledWith('completion/complete', {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    });
    expect(resp.values).toEqual(['x']);
  });
});

// ============ 性能测试 ============

describe('CompletionProvider - 性能', () => {
  it('1000 次缓存命中 < 50ms', async () => {
    const client = new MockCompletionClient();
    const provider = new CompletionProvider();
    provider.attachClient(client);
    const req: CompletionRequest = {
      ref: { type: 'ref/prompt', name: 'p' },
      argument: { name: 'a', value: 'b' },
    };
    client.setResponse(req, { values: ['x'] });
    await provider.complete(req);
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await provider.complete(req);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
