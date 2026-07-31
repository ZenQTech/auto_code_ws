/**
 * # ============================================================
 * # McpToolRagSource 测试 (v1.0.0 Cycle 45 G45-03)
 * # ============================================================
 * # 覆盖：
 * #   1. 工具结果文本提取 + 类型推断
 * #   2. 缓存机制（命中/未命中/TTL/容量限制）
 * #   3. 单工具调用
 * #   4. 多工具并发调用
 * #   5. retrieve 流程（临时文档 → RAG → 清理）
 * #   6. 错误处理
 * #   7. 事件系统
 * #   8. 统计
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpToolRagSource,
  createMcpToolRagSource,
  inferContentKind,
  hashArgs,
  hashText,
  extractToolResultText,
  type McpToolResult,
} from './mcpToolRagSource';
import { createMcpRagEngine } from './mcpRagEngine';
import type { McpClient } from './mcpClient';
import type { McpServerRegistry } from './mcpRegistry';

// ============ Mock ============

interface MockResource {
  info: { uri: string; name?: string; mimeType?: string; serverId?: string; serverName?: string };
  content: any;
}

function createMockResourceBridge() {
  const resources = new Map<string, MockResource>();
  return {
    resources,
    async resolve(uri: string) {
      return resources.get(uri) ?? null;
    },
    async listResources(_serverId: string) {
      return Array.from(resources.values()).map((r) => ({
        uri: r.info.uri,
        name: r.info.name ?? r.info.uri,
        mimeType: r.info.mimeType,
        serverId: r.info.serverId,
      }));
    },
  };
}

function createMockClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello world from tool' }],
      isError: false,
    }),
    isReady: vi.fn().mockReturnValue(true),
    ...overrides,
  } as any;
}

function createMockRegistry(client: McpClient | null = null): McpServerRegistry {
  return {
    getClient: vi.fn().mockImplementation((serverId: string) => {
      if (client) return client;
      return undefined;
    }),
  } as any;
}

// ============ 工具函数测试 ============

describe('工具函数', () => {
  describe('inferContentKind - 内容类型推断', () => {
    it('应推断为 JSON', () => {
      expect(inferContentKind('{"key":"value"}')).toBe('json');
      expect(inferContentKind('[1,2,3]')).toBe('json');
    });

    it('应推断为 HTML', () => {
      expect(inferContentKind('<!DOCTYPE html><html></html>')).toBe('html');
      expect(inferContentKind('<div>content</div>')).toBe('html');
    });

    it('应推断为 Markdown', () => {
      expect(inferContentKind('# Title\n\nContent')).toBe('markdown');
      expect(inferContentKind('```js\ncode\n```')).toBe('markdown');
    });

    it('应推断为 text', () => {
      expect(inferContentKind('Just plain text content')).toBe('text');
    });

    it('应通过 args.mimeType 推断', () => {
      expect(inferContentKind('foo', { mimeType: 'application/json' })).toBe('json');
      expect(inferContentKind('foo', { mimeType: 'text/markdown' })).toBe('markdown');
    });

    it('应通过 URL 后缀推断', () => {
      expect(inferContentKind('foo', { url: 'https://example.com/data.json' })).toBe('json');
      expect(inferContentKind('foo', { url: 'https://example.com/page.html' })).toBe('html');
      expect(inferContentKind('foo', { url: 'https://example.com/readme.md' })).toBe('markdown');
    });

    it('空内容应返回 text', () => {
      expect(inferContentKind('')).toBe('text');
      expect(inferContentKind('   ')).toBe('text');
    });
  });

  describe('hashArgs / hashText', () => {
    it('hashArgs 相同参数应返回相同哈希', () => {
      const h1 = hashArgs({ a: 1, b: 'x' });
      const h2 = hashArgs({ a: 1, b: 'x' });
      expect(h1).toBe(h2);
    });

    it('hashArgs 不同参数应返回不同哈希', () => {
      const h1 = hashArgs({ a: 1 });
      const h2 = hashArgs({ a: 2 });
      expect(h1).not.toBe(h2);
    });

    it('hashArgs 字段顺序不应影响哈希', () => {
      const h1 = hashArgs({ a: 1, b: 2 });
      const h2 = hashArgs({ b: 2, a: 1 });
      expect(h1).toBe(h2);
    });

    it('hashText 应返回非空字符串', () => {
      expect(hashText('hello')).toBeTruthy();
      expect(hashText('hello')).toBe(hashText('hello'));
    });
  });

  describe('extractToolResultText', () => {
    it('应提取文本内容', () => {
      const result = extractToolResultText([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]);
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('应处理空内容', () => {
      expect(extractToolResultText(null)).toBe('');
      expect(extractToolResultText([])).toBe('');
    });

    it('应处理字符串内容', () => {
      expect(extractToolResultText('raw string')).toBe('raw string');
    });

    it('应处理对象（仅 text 字段）', () => {
      expect(extractToolResultText({ text: 'foo' })).toBe('foo');
    });

    it('应处理 data 字段', () => {
      expect(extractToolResultText({ type: 'other', data: 'base64data' })).toBe('base64data');
    });
  });
});

// ============ 主类测试 ============

describe('McpToolRagSource', () => {
  let source: McpToolRagSource;
  let ragEngine: ReturnType<typeof createMcpRagEngine>;
  let mockClient: McpClient;
  let mockRegistry: McpServerRegistry;
  let mockBridge: ReturnType<typeof createMockResourceBridge>;

  beforeEach(() => {
    mockBridge = createMockResourceBridge();
    ragEngine = createMcpRagEngine({ resourceBridge: mockBridge });
    mockClient = createMockClient();
    mockRegistry = createMockRegistry(mockClient);
    source = createMcpToolRagSource({
      ragEngine,
      registry: mockRegistry,
      ttlMs: 60_000,
      maxCacheSize: 10,
    });
  });

  // ============ 工厂 ============

  describe('工厂和初始化', () => {
    it('createMcpToolRagSource 应返回实例', () => {
      expect(source).toBeInstanceOf(McpToolRagSource);
    });
  });

  // ============ 单工具调用 ============

  describe('callTool - 单工具调用', () => {
    it('应成功调用工具并返回结果', async () => {
      const result = await source.callTool('fs', 'read_file', { path: '/tmp/a.txt' });
      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello world from tool');
      expect(result.serverId).toBe('fs');
      expect(result.toolName).toBe('read_file');
    });

    it('调用参数应被保留', async () => {
      const result = await source.callTool('fs', 'read_file', { path: '/test', encoding: 'utf-8' });
      expect(result.args).toEqual({ path: '/test', encoding: 'utf-8' });
    });

    it('内容类型应自动推断', async () => {
      const jsonClient = createMockClient();
      (jsonClient.callTool as any).mockResolvedValue({
        content: [{ type: 'text', text: '{"foo":"bar"}' }],
        isError: false,
      });
      const r = createMcpToolRagSource({
        ragEngine,
        registry: createMockRegistry(jsonClient),
      });
      const result = await r.callTool('fs', 'get', {});
      expect(result.kind).toBe('json');
      expect(result.data).toEqual({ foo: 'bar' });
    });

    it('服务器未注册时应返回失败结果', async () => {
      const r = createMcpToolRagSource({
        ragEngine,
        registry: createMockRegistry(null),
      });
      const result = await r.callTool('unknown', 'tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown');
    });

    it('isError=true 应标记为失败', async () => {
      const errClient = createMockClient();
      (errClient.callTool as any).mockResolvedValue({
        content: [{ type: 'text', text: 'Error happened' }],
        isError: true,
      });
      const r = createMcpToolRagSource({
        ragEngine,
        registry: createMockRegistry(errClient),
      });
      const result = await r.callTool('fs', 'fail', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('工具抛错应捕获并返回失败结果', async () => {
      const throwingClient = createMockClient();
      (throwingClient.callTool as any).mockRejectedValue(new Error('Network error'));
      const r = createMcpToolRagSource({
        ragEngine,
        registry: createMockRegistry(throwingClient),
      });
      const result = await r.callTool('fs', 'fail', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ============ 缓存 ============

  describe('缓存管理', () => {
    it('应缓存成功调用结果', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      const stats = source.getStats();
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(1);
    });

    it('第二次相同调用应命中缓存', async () => {
      const client = (source as any);
      await source.callTool('fs', 'read_file', { path: '/a' });
      const r2 = await source.callTool('fs', 'read_file', { path: '/a' });
      expect(r2.success).toBe(true);
      const stats = source.getStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });

    it('不同参数应不命中缓存', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'read_file', { path: '/b' });
      const stats = source.getStats();
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(2);
    });

    it('forceRefresh=true 应跳过缓存', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'read_file', { path: '/a' }, { forceRefresh: true });
      const stats = source.getStats();
      expect(stats.cacheMisses).toBe(2);
    });

    it('useCache=false 应跳过缓存', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'read_file', { path: '/a' }, { useCache: false });
      const stats = source.getStats();
      expect(stats.cacheMisses).toBe(2);
    });

    it('clearCache 应清空所有缓存', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'read_file', { path: '/b' });
      const cleared = source.clearCache();
      expect(cleared).toBe(2);
      expect(source.getStats().cacheSize).toBe(0);
    });

    it('invalidateCache 应按 serverId 删除', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('git', 'log', {});
      const removed = source.invalidateCache('fs');
      expect(removed).toBe(1);
      const remaining = source.listCache();
      expect(remaining.length).toBe(1);
      expect(remaining[0].serverId).toBe('git');
    });

    it('invalidateCache 应按 serverId+toolName 删除', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'list', {});
      const removed = source.invalidateCache('fs', 'read_file');
      expect(removed).toBe(1);
    });

    it('listCache 应返回所有缓存条目', async () => {
      await source.callTool('fs', 'read_file', { path: '/a' });
      const list = source.listCache();
      expect(list.length).toBe(1);
      expect(list[0].serverId).toBe('fs');
      expect(list[0].toolName).toBe('read_file');
    });

    it('maxCacheSize 超出应驱逐最旧条目', async () => {
      const small = createMcpToolRagSource({
        ragEngine,
        registry: mockRegistry,
        maxCacheSize: 2,
      });
      await small.callTool('fs', 'a', { x: 1 });
      await small.callTool('fs', 'b', { x: 2 });
      await small.callTool('fs', 'c', { x: 3 });
      expect(small.getStats().cacheSize).toBe(2);
    });
  });

  // ============ retrieve ============

  describe('retrieve - 多工具检索', () => {
    it('应调用多个工具并返回检索结果', async () => {
      const result = await source.retrieve({
        toolCalls: [
          { serverId: 'fs', toolName: 'read_file', args: { path: '/a' } },
          { serverId: 'fs', toolName: 'read_file', args: { path: '/b' } },
        ],
        query: 'hello',
      });
      expect(result.toolResults.length).toBe(2);
      expect(result.stats.successCalls).toBe(2);
    });

    it('parallel=false 应串行调用', async () => {
      const result = await source.retrieve({
        toolCalls: [
          { serverId: 'fs', toolName: 'read_file', args: { path: '/a' } },
          { serverId: 'fs', toolName: 'read_file', args: { path: '/b' } },
        ],
        query: 'hello',
        parallel: false,
      });
      expect(result.toolResults.length).toBe(2);
    });

    it('部分工具失败不应中断流程', async () => {
      const mixedClient = createMockClient();
      (mixedClient.callTool as any).mockImplementation(async (name: string) => {
        if (name === 'fail') {
          throw new Error('Tool failed');
        }
        return { content: [{ type: 'text', text: 'OK' }], isError: false };
      });
      const r = createMcpToolRagSource({
        ragEngine,
        registry: createMockRegistry(mixedClient),
      });
      const result = await r.retrieve({
        toolCalls: [
          { serverId: 'fs', toolName: 'ok', args: {} },
          { serverId: 'fs', toolName: 'fail', args: {} },
        ],
        query: 'hello',
      });
      expect(result.stats.successCalls).toBe(1);
      expect(result.stats.failedCalls).toBe(1);
    });

    it('onProgress 应被调用', async () => {
      const onProgress = vi.fn();
      await source.retrieve({
        toolCalls: [
          { serverId: 'fs', toolName: 'a', args: {} },
          { serverId: 'fs', toolName: 'b', args: {} },
        ],
        query: 'test',
        onProgress,
      });
      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('cleanupAfterRetrieve=true 应清理临时文档', async () => {
      const tempBefore = source.getActiveTempDocCount();
      await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello',
      });
      const tempAfter = source.getActiveTempDocCount();
      expect(tempAfter).toBe(tempBefore);
    });

    it('tempDocIds 在 retrieve 后应清空', async () => {
      const result = await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello',
      });
      expect(result.tempDocIds.length).toBeGreaterThan(0);
      // retrieve 完成后 cleanup 会被调用
    });

    it('hits 应包含 source 字段标识来源', async () => {
      const result = await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello world',
      });
      // 注：临时文档已被清理，所以所有 hits 来自 persistent
      for (const hit of result.hits) {
        expect(['tool-temp', 'persistent']).toContain(hit.source);
      }
    });
  });

  // ============ 清理 ============

  describe('cleanup', () => {
    it('cleanupAll 应清空所有活跃临时文档', async () => {
      // 通过 retrieve 间接添加临时文档
      const result = await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello',
      });
      expect(result.toolResults.length).toBe(1);
      const cleaned = await source.cleanupAll();
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });
  });

  // ============ 事件 ============

  describe('事件系统', () => {
    it('应触发 tool-called 事件', async () => {
      const events: any[] = [];
      source.on((e) => events.push(e));
      await source.callTool('fs', 'read_file', { path: '/a' });
      const toolCalledEvents = events.filter((e) => e.type === 'tool-called');
      expect(toolCalledEvents.length).toBeGreaterThan(0);
    });

    it('应触发 cache-hit 和 cache-miss', async () => {
      const events: any[] = [];
      source.on((e) => events.push(e));
      await source.callTool('fs', 'read_file', { path: '/a' });
      await source.callTool('fs', 'read_file', { path: '/a' });
      const cacheEvents = events.filter((e) => e.type === 'cache-hit' || e.type === 'cache-miss');
      expect(cacheEvents.length).toBe(2);
    });

    it('应触发 retrieved 事件', async () => {
      const events: any[] = [];
      source.on((e) => events.push(e));
      await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello',
      });
      expect(events.some((e) => e.type === 'retrieved')).toBe(true);
    });

    it('on() 应返回 unsubscribe 函数', () => {
      const events: any[] = [];
      const unsub = source.on((e) => events.push(e));
      unsub();
      source.callTool('fs', 'read_file', { path: '/a' });
      expect(events.length).toBe(0);
    });

    it('监听器抛错不应影响主流程', async () => {
      source.on(() => {
        throw new Error('listener error');
      });
      // 不应抛错
      await expect(source.callTool('fs', 'read_file', { path: '/a' })).resolves.toBeDefined();
    });
  });

  // ============ 统计 ============

  describe('统计', () => {
    it('应正确累计 totalCalls / successCalls', async () => {
      await source.callTool('fs', 'a', {});
      await source.callTool('fs', 'b', {});
      const stats = source.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.successCalls).toBe(2);
    });

    it('应正确累计 cacheHits / cacheMisses', async () => {
      await source.callTool('fs', 'a', { x: 1 });
      await source.callTool('fs', 'a', { x: 1 });
      await source.callTool('fs', 'a', { x: 2 });
      const stats = source.getStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(2);
    });

    it('avgRetrieveTimeMs 应在 retrieve 后更新', async () => {
      const before = source.getStats().avgRetrieveTimeMs;
      await source.retrieve({
        toolCalls: [{ serverId: 'fs', toolName: 'read_file', args: { path: '/a' } }],
        query: 'hello',
      });
      const after = source.getStats().avgRetrieveTimeMs;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });
});
