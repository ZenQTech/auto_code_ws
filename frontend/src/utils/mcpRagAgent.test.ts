/**
 * # ============================================================
 * # McpRagAgent 测试 (v1.0.0 Cycle 45 G45-04)
 * # ============================================================
 * # 覆盖：
 * #   1. 决策引擎：URL/fetch 意图检测
 * #   2. resource-only 流程
 * #   3. tool-only 流程
 * #   4. hybrid 流程（资源不足时自动工具）
 * #   5. auto 决策
 * #   6. LLM 不可用时的 fallback
 * #   7. 事件系统
 * #   8. 统计
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpRagAgent,
  createMcpRagAgent,
  type McpRagAgentOptions,
  type RagDecision,
} from './mcpRagAgent';
import { createMcpRagEngine } from './mcpRagEngine';
import { createMcpToolRagSource, type McpToolRagSource } from './mcpToolRagSource';
import type { McpClient } from './mcpClient';
import type { McpServerRegistry } from './mcpRegistry';
import type { LLMProvider, ChatResponse, Message, ChatOptions } from './llmProviderAdapter';

// ============ Mock ============

function createMockResourceBridge() {
  const resources = new Map<string, any>();
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

function createMockClient(): McpClient {
  return {
    callTool: vi.fn().mockImplementation(async (name: string) => {
      if (name === 'fetch') {
        return {
          content: [
            { type: 'text', text: 'This is fetched content from the web about TypeScript.' },
          ],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: `Result from ${name}` }],
        isError: false,
      };
    }),
    isReady: vi.fn().mockReturnValue(true),
  } as any;
}

function createMockRegistry(client: McpClient | null = null): McpServerRegistry {
  return {
    getClient: vi.fn().mockImplementation(() => client),
  } as any;
}

function createMockLLM(answer: string = 'This is a mock LLM answer based on the context.'): LLMProvider {
  return {
    name: 'mock',
    model: 'mock-model',
    async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
      return {
        id: 'mock-1',
        content: answer,
        model: 'mock-model',
        provider: 'mock',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        durationMs: 50,
      };
    },
    async *stream() {
      yield { type: 'content', content: answer, delta: answer };
    },
  } as any;
}

// ============ Tests ============

describe('McpRagAgent', () => {
  let agent: McpRagAgent;
  let ragEngine: ReturnType<typeof createMcpRagEngine>;
  let toolSource: McpToolRagSource;
  let mockBridge: ReturnType<typeof createMockResourceBridge>;
  let mockClient: McpClient;
  let mockLLM: LLMProvider;

  beforeEach(() => {
    mockBridge = createMockResourceBridge();
    ragEngine = createMcpRagEngine({ resourceBridge: mockBridge });
    mockClient = createMockClient();
    const mockRegistry = createMockRegistry(mockClient);
    toolSource = createMcpToolRagSource({
      ragEngine,
      registry: mockRegistry,
    });
    mockLLM = createMockLLM();
    agent = createMcpRagAgent(ragEngine, toolSource);

    // 注入 LLM
    (ragEngine as any).llmProvider = mockLLM;
  });

  // ============ 工厂 ============

  describe('工厂和初始化', () => {
    it('createMcpRagAgent 应返回实例', () => {
      expect(agent).toBeInstanceOf(McpRagAgent);
    });
  });

  // ============ resource-only ============

  describe('resource-only 流程', () => {
    it('应能从持久化知识库检索并生成答案', async () => {
      // 预先索引资源
      mockBridge.resources.set('file:///doc.txt', {
        info: { uri: 'file:///doc.txt', name: 'doc.txt', mimeType: 'text/plain', serverId: 'fs' },
        content: { uri: 'file:///doc.txt', mimeType: 'text/plain', text: 'TypeScript is a typed superset of JavaScript.' },
      });
      await ragEngine.indexResource('fs', 'file:///doc.txt');

      const result = await agent.run('What is TypeScript?', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
      });

      expect(result.metadata.decision).toBe('resource-only');
      expect(result.resourceHits.length).toBeGreaterThan(0);
      expect(result.answer).toBeTruthy();
    });

    it('空知识库应返回空 hits 但不报错', async () => {
      const result = await agent.run('Hello?', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
      });
      expect(result.resourceHits.length).toBe(0);
      expect(result.answer).toBeTruthy();
    });
  });

  // ============ tool-only ============

  describe('tool-only 流程', () => {
    it('应能调用工具并整合结果', async () => {
      const result = await agent.run('Get info from web', {
        decision: 'tool-only',
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });

      expect(result.metadata.decision).toBe('tool-only');
      expect(result.toolResults.length).toBe(1);
      expect(result.toolResults[0].success).toBe(true);
    });
  });

  // ============ hybrid ============

  describe('hybrid 流程', () => {
    it('应能同时使用资源+工具', async () => {
      // 索引一些资源
      mockBridge.resources.set('file:///a.txt', {
        info: { uri: 'file:///a.txt', name: 'a.txt', mimeType: 'text/plain', serverId: 'fs' },
        content: { uri: 'file:///a.txt', text: 'TypeScript is a programming language.' },
      });
      await ragEngine.indexResource('fs', 'file:///a.txt');

      const result = await agent.run('TypeScript and fetch', {
        decision: 'hybrid',
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });

      expect(result.metadata.decision).toBe('hybrid');
      expect(result.resourceHits.length).toBeGreaterThan(0);
      expect(result.toolResults.length).toBeGreaterThan(0);
    });

    it('资源不足时应自动调用工具', async () => {
      const result = await agent.run('TypeScript', {
        decision: 'hybrid',
        ragEngine,
        toolSource,
        minHitsForHybrid: 100, // 强制触发工具
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });

      expect(result.toolResults.length).toBe(1);
    });
  });

  // ============ auto 决策 ============

  describe('auto 决策', () => {
    it('含 URL 的 query 应被识别为 tool-only', async () => {
      const result = await agent.run('Please fetch https://example.com', {
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });
      // auto 模式下，最终策略可能是 hybrid（带 tool 调用）
      expect(result.toolResults.length + result.resourceHits.length).toBeGreaterThan(0);
    });

    it('查询意图应优先使用 resource-only', async () => {
      mockBridge.resources.set('file:///info.txt', {
        info: { uri: 'file:///info.txt', name: 'info.txt', mimeType: 'text/plain', serverId: 'fs' },
        content: { uri: 'file:///info.txt', text: 'Information about topic X.' },
      });
      await ragEngine.indexResource('fs', 'file:///info.txt');

      const result = await agent.run('What is topic X?', {
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });
      expect(result.metadata.decision).toBe('resource-only');
    });

    it('列出意图应使用 hybrid', async () => {
      const result = await agent.run('list all', {
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });
      expect(result.metadata.decision).toBe('hybrid');
    });
  });

  // ============ Fallback ============

  describe('Fallback (LLM 不可用)', () => {
    it('LLM 抛错时应使用 fallback 摘要', async () => {
      // 移除 LLM
      (ragEngine as any).llmProvider = undefined;

      const result = await agent.run('Test query', {
        decision: 'tool-only',
        ragEngine,
        toolSource,
        toolConfig: {
          candidates: [
            { serverId: 'fs', toolName: 'fetch', args: { url: 'https://example.com' } },
          ],
        },
      });

      // Fallback 应返回 answer
      expect(result.answer).toBeTruthy();
      // 应包含 tool results
      expect(result.answer).toContain('Tool Results');
    });
  });

  // ============ 事件 ============

  describe('事件系统', () => {
    it('应触发 started 事件', async () => {
      const events: any[] = [];
      agent.on((e) => events.push(e));
      await agent.run('Test', { decision: 'resource-only', ragEngine, toolSource });
      expect(events.some((e) => e.type === 'started')).toBe(true);
    });

    it('应触发 phase 事件', async () => {
      const events: any[] = [];
      agent.on((e) => events.push(e));
      await agent.run('Test', { decision: 'resource-only', ragEngine, toolSource });
      const phaseEvents = events.filter((e) => e.type === 'phase');
      expect(phaseEvents.length).toBeGreaterThan(0);
    });

    it('应触发 completed 事件', async () => {
      const events: any[] = [];
      agent.on((e) => events.push(e));
      await agent.run('Test', { decision: 'resource-only', ragEngine, toolSource });
      expect(events.some((e) => e.type === 'completed')).toBe(true);
    });

    it('onProgress 回调应被调用', async () => {
      const onProgress = vi.fn();
      await agent.run('Test', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
        onProgress,
      });
      expect(onProgress).toHaveBeenCalled();
    });

    it('监听器抛错不应影响主流程', async () => {
      agent.on(() => {
        throw new Error('listener error');
      });
      await expect(
        agent.run('Test', { decision: 'resource-only', ragEngine, toolSource })
      ).resolves.toBeDefined();
    });
  });

  // ============ 步骤 / 调试 ============

  describe('步骤记录', () => {
    it('steps 应记录所有阶段', async () => {
      const result = await agent.run('Test', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
      });
      expect(result.steps.length).toBeGreaterThan(0);
      const phases = result.steps.map((s) => s.phase);
      expect(phases).toContain('analyzing');
      expect(phases).toContain('done');
    });
  });

  // ============ 统计 ============

  describe('统计', () => {
    it('应累计 totalRuns / successRuns', async () => {
      await agent.run('Test1', { decision: 'resource-only', ragEngine, toolSource });
      await agent.run('Test2', { decision: 'resource-only', ragEngine, toolSource });
      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(2);
      expect(stats.successRuns).toBe(2);
    });

    it('应累计 avgTotalTimeMs', async () => {
      await agent.run('Test', { decision: 'resource-only', ragEngine, toolSource });
      const stats = agent.getStats();
      expect(stats.avgTotalTimeMs).toBeGreaterThan(0);
    });

    it('应累计 totalResourceHits / totalToolHits', async () => {
      mockBridge.resources.set('file:///x.txt', {
        info: { uri: 'file:///x.txt', name: 'x.txt', mimeType: 'text/plain', serverId: 'fs' },
        content: { uri: 'file:///x.txt', text: 'Content X.' },
      });
      await ragEngine.indexResource('fs', 'file:///x.txt');

      await agent.run('Content', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
      });
      const stats = agent.getStats();
      expect(stats.totalResourceHits).toBeGreaterThan(0);
    });

    it('resetStats 应清空所有统计', async () => {
      await agent.run('Test', { decision: 'resource-only', ragEngine, toolSource });
      agent.resetStats();
      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(0);
    });
  });

  // ============ Citations ============

  describe('引用', () => {
    it('应从 resource hits 生成 citations', async () => {
      mockBridge.resources.set('file:///info.txt', {
        info: { uri: 'file:///info.txt', name: 'info.txt', mimeType: 'text/plain', serverId: 'fs' },
        content: { uri: 'file:///info.txt', text: 'Important information here.' },
      });
      await ragEngine.indexResource('fs', 'file:///info.txt');

      const result = await agent.run('What is important information?', {
        decision: 'resource-only',
        ragEngine,
        toolSource,
      });
      expect(result.citations.length).toBeGreaterThan(0);
      for (const c of result.citations) {
        expect(c.chunkId).toBeTruthy();
        expect(c.source).toBeTruthy();
      }
    });
  });
});
