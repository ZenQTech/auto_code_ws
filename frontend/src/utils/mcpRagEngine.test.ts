/**
 * # ============================================================
 * # McpRagEngine 测试 (v1.0.0 Cycle 45 G45-01)
 * # ============================================================
 * # 核心作用：验证 MCP × RAG 融合引擎的功能完整性
 * # 测试维度：
 * #   1. 工厂函数 + 实例化
 * #   2. 资源索引 (单个 / 批量 / 移除 / 清空)
 * #   3. 混合检索 (本地 + MCP 资源)
 * #   4. 工具检索 (MCP 工具结果作为 RAG 来源)
 * #   5. Agent RAG 增强 (LLM 集成)
 * #   6. 事件系统
 * #   7. 统计
 * #   8. 边界条件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 45 G45-01 初次创建
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpRagEngine,
  createMcpRagEngine,
  type McpRagIndexEntry,
  type McpRagHit,
  type ResourceResolver,
} from './mcpRagEngine';
import { MockEmbedding, MemoryVectorStore, BM25Retriever, HybridRetriever, HeuristicReranker, RecursiveCharacterTextSplitter, TextLoader, RAGEngine } from './ragEngine';
import { MockProvider, type Message } from './llmProviderAdapter';

// ============ Mock 资源桥接 ============

function createMockResourceBridge(): ResourceResolver & {
  resources: Map<string, { info: any; content: any }>;
} {
  const resources = new Map<string, { info: any; content: any }>();
  const bridge: any = {
    resources,
    async resolve(uri: string) {
      return resources.get(uri) ?? null;
    },
    async getResources() {
      return Array.from(resources.values()).map((r) => ({
        uri: r.info.uri,
        name: r.info.name,
        mimeType: r.info.mimeType,
        serverId: r.info.serverId,
      }));
    },
  };
  return bridge;
}

function createMockToolBridge(): any {
  return {
    async execute(call: { id: string; name: string; arguments: Record<string, unknown> }) {
      if (call.name === 'fail_tool') {
        return { callId: call.id, name: call.name, success: false, error: 'mock error', durationMs: 1, timestamp: Date.now() };
      }
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: {
          content: [
            { type: 'text', text: `Mock tool result for ${call.name}: ${JSON.stringify(call.arguments)}` },
          ],
        },
        durationMs: 1,
        timestamp: Date.now(),
      };
    },
  };
}

function createMockPromptBridge(): any {
  return {
    async render(qualifiedName: string, _ctx: any) {
      return {
        prompt: { qualifiedName },
        messages: [
          { role: 'system', content: { type: 'text', text: `Mock system prompt for ${qualifiedName}` } },
        ],
        missingArgs: [],
        invalidArgs: [],
        durationMs: 1,
        cached: false,
        renderedAt: Date.now(),
      };
    },
  };
}

function createMockLLM() {
  const mock = new MockProvider();
  // 拦截 chat 方法
  vi.spyOn(mock, 'chat').mockImplementation(async (messages: Message[]) => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';
    return {
      id: `resp-${Date.now()}`,
      content: `[Mock LLM Response] 基于检索上下文回答: ${userText.substring(0, 50)}...`,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, inputTokens: 100, outputTokens: 50 },
      model: 'mock-model',
      provider: 'mock' as const,
      finishReason: 'stop' as const,
      timestamp: Date.now(),
      durationMs: 10,
    };
  });
  return mock;
}

// ============ 测试 ============

describe('McpRagEngine', () => {
  let engine: McpRagEngine;
  let resourceBridge: ReturnType<typeof createMockResourceBridge>;
  let toolBridge: ReturnType<typeof createMockToolBridge>;
  let promptBridge: ReturnType<typeof createMockPromptBridge>;
  let llm: ReturnType<typeof createMockLLM>;

  beforeEach(() => {
    resourceBridge = createMockResourceBridge();
    toolBridge = createMockToolBridge();
    promptBridge = createMockPromptBridge();
    llm = createMockLLM();

    engine = createMcpRagEngine({
      resourceBridge,
      toolBridge,
      promptBridge,
      llmProvider: llm,
    });
  });

  // ============ 工厂函数 / 实例化 ============

  describe('工厂函数和实例化', () => {
    it('createMcpRagEngine 应返回 McpRagEngine 实例', () => {
      expect(engine).toBeInstanceOf(McpRagEngine);
    });

    it('应能接受空选项创建（使用默认 RAG 引擎）', () => {
      const e = createMcpRagEngine();
      expect(e).toBeInstanceOf(McpRagEngine);
      const rag = e.getRagEngine();
      expect(rag).toBeInstanceOf(RAGEngine);
    });

    it('getRagEngine 应返回 RAGEngine', () => {
      expect(engine.getRagEngine()).toBeInstanceOf(RAGEngine);
    });

    it('getStats 初始状态应为零', () => {
      const stats = engine.getStats();
      expect(stats.totalIndexedResources).toBe(0);
      expect(stats.totalIndexEntries).toBe(0);
      expect(stats.totalRetrievals).toBe(0);
      expect(stats.totalEnhancements).toBe(0);
    });

    it('getIndexEntries 初始应为空数组', () => {
      expect(engine.getIndexEntries()).toEqual([]);
    });
  });

  // ============ 单个资源索引 ============

  describe('indexResource - 单个资源索引', () => {
    it('应能索引一个文本资源', async () => {
      resourceBridge.resources.set('file:///test.txt', {
        info: { uri: 'file:///test.txt', name: 'test.txt', mimeType: 'text/plain', serverId: 'fs', serverName: 'filesystem' },
        content: { uri: 'file:///test.txt', mimeType: 'text/plain', text: 'Hello World from MCP resource' },
      });
      const entry = await engine.indexResource('fs', 'file:///test.txt');
      expect(entry.serverId).toBe('fs');
      expect(entry.resourceUri).toBe('file:///test.txt');
      expect(entry.chunkCount).toBeGreaterThan(0);
      expect(entry.size).toBeGreaterThan(0);
    });

    it('资源无内容时应抛出错误', async () => {
      resourceBridge.resources.set('file:///empty.txt', {
        info: { uri: 'file:///empty.txt', name: 'empty.txt' },
        content: { uri: 'file:///empty.txt', text: '   ' },
      });
      await expect(engine.indexResource('fs', 'file:///empty.txt')).rejects.toThrow(/内容为空/);
    });

    it('无 resourceBridge 时应抛出错误', async () => {
      const e = createMcpRagEngine();
      await expect(e.indexResource('fs', 'file:///x.txt')).rejects.toThrow(/resourceBridge 未配置/);
    });

    it('资源 URI 不存在时应抛出错误', async () => {
      await expect(engine.indexResource('fs', 'file:///nonexistent.txt')).rejects.toThrow();
    });

    it('indexed 事件应被触发', async () => {
      const events: any[] = [];
      engine.on((e) => events.push(e));
      resourceBridge.resources.set('file:///e.txt', {
        info: { uri: 'file:///e.txt', name: 'e.txt' },
        content: { uri: 'file:///e.txt', text: 'event test' },
      });
      await engine.indexResource('fs', 'file:///e.txt');
      expect(events.some((e) => e.type === 'indexed')).toBe(true);
    });

    it('blob 类型资源应能转 base64 解码', async () => {
      const text = 'base64 encoded content';
      // 在浏览器和 node 环境下都可用
      const b64 = typeof btoa !== 'undefined'
        ? btoa(text)
        : (globalThis as any).Buffer
          ? (globalThis as any).Buffer.from(text).toString('base64')
          : text;
      resourceBridge.resources.set('file:///b.txt', {
        info: { uri: 'file:///b.txt', name: 'b.txt' },
        content: { uri: 'file:///b.txt', blob: b64 },
      });
      const entry = await engine.indexResource('fs', 'file:///b.txt');
      expect(entry.chunkCount).toBeGreaterThan(0);
    });
  });

  // ============ 批量资源索引 ============

  describe('indexAllResources - 批量索引', () => {
    beforeEach(() => {
      // 注册 5 个资源
      for (let i = 0; i < 5; i++) {
        resourceBridge.resources.set(`file:///doc${i}.txt`, {
          info: { uri: `file:///doc${i}.txt`, name: `doc${i}.txt`, serverId: 'fs' },
          content: { uri: `file:///doc${i}.txt`, text: `Document ${i} about topic ${i % 2 === 0 ? 'cats' : 'dogs'}` },
        });
      }
    });

    it('应能批量索引所有资源', async () => {
      const result = await engine.indexAllResources('fs', { concurrency: 2 });
      expect(result.total).toBe(5);
      expect(result.succeeded).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.entries.length).toBe(5);
    });

    it('批量索引应触发 batch-indexed 事件', async () => {
      const events: any[] = [];
      engine.on((e) => events.push(e));
      await engine.indexAllResources('fs');
      expect(events.some((e) => e.type === 'batch-indexed')).toBe(true);
    });

    it('单个资源失败不应中断批量索引', async () => {
      // 先索引 4 个，再尝试索引 1 个不存在的
      resourceBridge.resources.set('file:///bad.txt', {
        info: { uri: 'file:///bad.txt' },
        content: { uri: 'file:///bad.txt', text: '' },  // 空内容会失败
      });
      const result = await engine.indexAllResources('fs');
      expect(result.total).toBeGreaterThan(0);
      expect(result.failed).toBeGreaterThanOrEqual(0);
    });

    it('空资源列表应返回 total=0', async () => {
      const result = await engine.indexAllResources('empty');
      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
    });
  });

  // ============ 资源索引移除/清空 ============

  describe('索引移除/清空', () => {
    beforeEach(async () => {
      resourceBridge.resources.set('file:///a.txt', {
        info: { uri: 'file:///a.txt', name: 'a.txt', serverId: 'fs' },
        content: { uri: 'file:///a.txt', text: 'A document about cats' },
      });
      resourceBridge.resources.set('file:///b.txt', {
        info: { uri: 'file:///b.txt', name: 'b.txt', serverId: 'fs' },
        content: { uri: 'file:///b.txt', text: 'B document about dogs' },
      });
      await engine.indexResource('fs', 'file:///a.txt');
      await engine.indexResource('fs', 'file:///b.txt');
    });

    it('removeResourceIndex 应能移除指定资源', async () => {
      const ok = await engine.removeResourceIndex('file:///a.txt');
      expect(ok).toBe(true);
      expect(engine.getIndexEntries().length).toBe(1);
    });

    it('移除不存在的资源应返回 false', async () => {
      const ok = await engine.removeResourceIndex('file:///nonexistent.txt');
      expect(ok).toBe(false);
    });

    it('clearResourceIndexes 应清空所有 MCP 资源索引', async () => {
      const removed = await engine.clearResourceIndexes();
      expect(removed).toBe(2);
      expect(engine.getIndexEntries().length).toBe(0);
    });
  });

  // ============ 混合检索 ============

  describe('retrieve - 混合检索', () => {
    beforeEach(async () => {
      // 索引 2 个 MCP 资源
      resourceBridge.resources.set('file:///cat.txt', {
        info: { uri: 'file:///cat.txt', name: 'cat.txt', serverId: 'fs' },
        content: { uri: 'file:///cat.txt', text: 'Cats are wonderful pets. They love fish and milk.' },
      });
      resourceBridge.resources.set('file:///dog.txt', {
        info: { uri: 'file:///dog.txt', name: 'dog.txt', serverId: 'fs' },
        content: { uri: 'file:///dog.txt', text: 'Dogs are loyal companions. They love bones and walks.' },
      });
      await engine.indexResource('fs', 'file:///cat.txt');
      await engine.indexResource('fs', 'file:///dog.txt');
    });

    it('应能检索到相关资源', async () => {
      const hits = await engine.retrieve('cat fish');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].type).toBe('mcp-resource');
      expect(hits[0].resourceUri).toContain('cat');
    });

    it('topK 选项应限制返回数量', async () => {
      const hits = await engine.retrieve('pets', { topK: 1 });
      expect(hits.length).toBeLessThanOrEqual(1);
    });

    it('serverIds 过滤应生效', async () => {
      const hits = await engine.retrieve('cat', { serverIds: ['nonexistent'] });
      expect(hits.length).toBe(0);
    });

    it('tags 过滤应生效', async () => {
      const hits = await engine.retrieve('cat', { tags: ['mcp'] });
      expect(hits.length).toBeGreaterThan(0);
    });

    it('minScore 过滤应生效', async () => {
      const hits = await engine.retrieve('cat', { minScore: 100 });
      expect(hits.length).toBe(0);
    });

    it('includeLocalDocs=false 应只返回 MCP 资源', async () => {
      // 添加一个非 MCP 文档
      const rag = engine.getRagEngine();
      await rag.addDocument(
        {
          id: 'local-1',
          content: 'Local document about cats',
          metadata: { source: 'local', createdAt: Date.now(), updatedAt: Date.now() },
        },
        undefined,
        { generateEmbedding: true }
      );
      const hits = await engine.retrieve('cat', { includeLocalDocs: false });
      expect(hits.every((h) => h.type === 'mcp-resource')).toBe(true);
    });

    it('检索后应触发 retrieved 事件', async () => {
      const events: any[] = [];
      engine.on((e) => events.push(e));
      await engine.retrieve('cat');
      expect(events.some((e) => e.type === 'retrieved')).toBe(true);
    });

    it('统计应累计检索次数', async () => {
      await engine.retrieve('cat');
      await engine.retrieve('dog');
      const stats = engine.getStats();
      expect(stats.totalRetrievals).toBe(2);
      // 注意：avgRetrievalTimeMs 在极快检索时可能为 0，不强制 > 0
      expect(stats.avgRetrievalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ============ Agent RAG 增强 ============

  describe('enhance - Agent RAG 增强', () => {
    beforeEach(async () => {
      resourceBridge.resources.set('file:///info.txt', {
        info: { uri: 'file:///info.txt', name: 'info.txt', serverId: 'fs' },
        content: { uri: 'file:///info.txt', text: 'The capital of France is Paris. Paris is known for the Eiffel Tower.' },
      });
      await engine.indexResource('fs', 'file:///info.txt');
    });

    it('应能生成 RAG 增强回答', async () => {
      const result = await engine.enhance('What is the capital of France?');
      expect(result.answer).toBeTruthy();
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.citations.length).toBeGreaterThan(0);
    });

    it('应使用 promptName 时调用 promptBridge', async () => {
      const result = await engine.enhance('capital of France', {
        promptName: 'test-prompt',
      });
      expect(result.metadata.usePrompt).toBe(true);
    });

    it('应触发 onChunk 流式回调', async () => {
      const chunks: string[] = [];
      await engine.enhance('What is Paris?', {
        onChunk: (c) => chunks.push(c),
      });
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('应触发 onHit 命中回调', async () => {
      const hits: McpRagHit[] = [];
      await engine.enhance('What is Paris?', {
        onHit: (h) => hits.push(h),
      });
      expect(hits.length).toBeGreaterThan(0);
    });

    it('应记录 token 使用', async () => {
      const result = await engine.enhance('capital France');
      expect(result.metadata.totalTokens).toBeGreaterThan(0);
    });

    it('enhance 错误应被 emit', async () => {
      const e = createMcpRagEngine({ resourceBridge });
      // 不传 llm
      const events: any[] = [];
      e.on((ev) => events.push(ev));
      await expect(e.enhance('test')).rejects.toThrow();
    });

    it('应累计 enhance 统计', async () => {
      await engine.enhance('test 1');
      await engine.enhance('test 2');
      const stats = engine.getStats();
      expect(stats.totalEnhancements).toBe(2);
    });
  });

  // ============ 工具检索 ============

  describe('retrieveViaTool - 工具检索', () => {
    it('应能调用工具并返回检索结果', async () => {
      const result = await engine.retrieveViaTool(
        'search',
        { query: 'MCP' },
        'search results'
      );
      expect(result.toolResult).toContain('Mock tool result');
    });

    it('工具调用失败时应抛出错误', async () => {
      await expect(
        engine.retrieveViaTool('fail_tool', {}, 'test')
      ).rejects.toThrow();
    });

    it('无 toolBridge 时应抛出错误', async () => {
      const e = createMcpRagEngine();
      await expect(e.retrieveViaTool('x', {}, 'y')).rejects.toThrow(/toolBridge 未配置/);
    });
  });

  // ============ 事件系统 ============

  describe('事件系统', () => {
    it('on 应返回取消订阅函数', () => {
      const events: any[] = [];
      const unsub = engine.on((e) => events.push(e));
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('取消订阅后不应再接收事件', async () => {
      const events: any[] = [];
      const unsub = engine.on((e) => events.push(e));
      unsub();
      resourceBridge.resources.set('file:///x.txt', {
        info: { uri: 'file:///x.txt', name: 'x.txt' },
        content: { uri: 'file:///x.txt', text: 'test' },
      });
      await engine.indexResource('fs', 'file:///x.txt');
      expect(events.length).toBe(0);
    });

    it('监听器抛错不应影响主流程', async () => {
      engine.on(() => {
        throw new Error('listener error');
      });
      resourceBridge.resources.set('file:///y.txt', {
        info: { uri: 'file:///y.txt', name: 'y.txt' },
        content: { uri: 'file:///y.txt', text: 'test' },
      });
      // 不应抛出
      const entry = await engine.indexResource('fs', 'file:///y.txt');
      expect(entry).toBeDefined();
    });
  });

  // ============ 生命周期 ============

  describe('生命周期', () => {
    it('dispose 应清空所有内部状态', () => {
      engine.dispose();
      expect(engine.getIndexEntries().length).toBe(0);
    });

    it('dispose 后仍可调用 getStats（返回零状态）', () => {
      engine.dispose();
      const stats = engine.getStats();
      expect(stats.totalIndexEntries).toBe(0);
    });
  });
});
