/**
 * # McpRagRealLLM 单元测试 (v1.0.0 Cycle 46 G46-01)
 * 测试真实 LLM 端到端 RAG 集成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpRagRealLLM, createDefaultMcpRagRealLLM, type McpRagRealLLMConfig } from './mcpRagRealLLM';
import { McpRagAgent, type McpRagAgentResult, type RagDecision } from './mcpRagAgent';
import type { LLMProvider, Message, ChatResponse, ChatOptions, ProviderName } from './llmProviderAdapter';
import { generateId, estimateTokens } from './llmProviderAdapter';
import type { McpRagHit, McpRagEngine, AgentRagEnhanceResult } from './mcpRagEngine';

// ============ Mock Provider ============

class MockVolcengineProvider implements LLMProvider {
  readonly name: ProviderName = 'volcengine-ark';
  readonly displayName = '火山方舟 (Mock)';
  readonly defaultModel = 'doubao-pro-32k';
  readonly models = [
    { id: 'doubao-pro-32k', name: 'Doubao Pro 32K', contextWindow: 32000, inputCostPerMTokens: 0.8, outputCostPerMTokens: 2.0, capabilities: ['text' as const] },
  ];

  private responses: string[] = [];
  private callCount = 0;
  private shouldFail = false;

  setResponses(responses: string[]): void {
    this.responses = responses;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  getCallCount(): number {
    return this.callCount;
  }

  async chat(messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    this.callCount += 1;
    if (this.shouldFail) {
      throw new Error('Mock failure');
    }
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const query = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const content = this.responses.length > 0
      ? this.responses.shift()!
      : `Mock volcengine response to: ${query.slice(0, 50)}`;

    const usage = {
      inputTokens: estimateTokens(JSON.stringify(messages)),
      outputTokens: estimateTokens(content),
      totalTokens: 0,
    };
    usage.totalTokens = usage.inputTokens + usage.outputTokens;

    return {
      id: generateId('ark'),
      model: this.defaultModel,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop' as const,
      durationMs: 50,
    };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<any> {
    const response = await this.chat(messages, options);
    const chars = response.content.split('');
    for (let i = 0; i < chars.length; i++) {
      yield {
        streamId: generateId('stream'),
        sequence: i,
        type: 'text',
        text: chars[i],
        timestamp: Date.now(),
      };
    }
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }

  calculateCost(usage: any, model?: string): number {
    const m = model || this.defaultModel;
    const pricing: Record<string, { input: number; output: number }> = {
      'doubao-pro-32k': { input: 0.8, output: 2.0 },
    };
    const p = pricing[m] || { input: 0, output: 0 };
    return (usage.inputTokens / 1_000_000) * p.input + (usage.outputTokens / 1_000_000) * p.output;
  }

  validateConfig() {
    return { valid: true, errors: [] };
  }

  async initialize(): Promise<void> {}
  dispose(): void {}
  on(_event: string, _callback: (data: unknown) => void): () => void {
    return () => {};
  }
}

class MockDeepSeekProvider implements LLMProvider {
  readonly name: ProviderName = 'deepseek';
  readonly displayName = 'DeepSeek (Mock)';
  readonly defaultModel = 'deepseek-chat';
  readonly models = [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 128000, inputCostPerMTokens: 0.14, outputCostPerMTokens: 0.28, capabilities: ['text' as const] },
  ];

  async chat(messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const query = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const content = `Mock deepseek response to: ${query.slice(0, 30)}`;
    const usage = {
      inputTokens: estimateTokens(JSON.stringify(messages)),
      outputTokens: estimateTokens(content),
      totalTokens: 0,
    };
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
    return {
      id: generateId('ds'),
      model: this.defaultModel,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop' as const,
      durationMs: 30,
    };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<any> {
    const response = await this.chat(messages, options);
    const chars = response.content.split('');
    for (let i = 0; i < chars.length; i++) {
      yield { streamId: generateId('s'), sequence: i, type: 'text', text: chars[i], timestamp: Date.now() };
    }
  }

  countTokens(text: string): number { return estimateTokens(text); }
  calculateCost(usage: any, _model?: string): number {
    return (usage.inputTokens / 1_000_000) * 0.14 + (usage.outputTokens / 1_000_000) * 0.28;
  }
  validateConfig() { return { valid: true, errors: [] }; }
  async initialize(): Promise<void> {}
  dispose(): void {}
  on(_event: string, _cb: (data: unknown) => void): () => void { return () => {}; }
}

// ============ Mock Agent ============

function createMockAgent(hits: McpRagHit[] = []): McpRagAgent {
  const mockAgentResult: McpRagAgentResult = {
    answer: '',
    hits,
    citations: [],
    decision: 'auto' as RagDecision,
    steps: [],
    success: true,
    durationMs: 10,
  } as any;

  const mockAgent = {
    run: vi.fn().mockResolvedValue(mockAgentResult),
  } as unknown as McpRagAgent;

  return mockAgent;
}

function createMockHit(overrides: Partial<McpRagHit> = {}): McpRagHit {
  return {
    type: 'mcp-resource',
    result: {
      chunkId: 'chunk-1',
      content: 'Mock RAG content for testing',
      score: 0.95,
      document: {
        id: 'doc-1',
        content: 'Mock document content',
        metadata: { title: 'Mock Document', source: 'mock://doc-1' },
      },
    } as any,
    documentId: 'doc-1',
    chunkId: 'chunk-1',
    content: 'Mock RAG content for testing',
    score: 0.95,
    serverId: 'mock-server',
    resourceUri: 'mock://doc-1',
    ...overrides,
  } as McpRagHit;
}

// ============ 测试用例 ============

describe('McpRagRealLLM', () => {
  describe('构造与配置', () => {
    it('应该正确创建实例', () => {
      const agent = createMockAgent();
      const config: McpRagRealLLMConfig = {
        providers: [{ provider: 'mock', priority: 100 }],
      };
      const realLLM = new McpRagRealLLM(agent, config);
      expect(realLLM).toBeDefined();
    });

    it('应该支持默认配置', () => {
      const agent = createMockAgent();
      const realLLM = createDefaultMcpRagRealLLM(agent);
      expect(realLLM).toBeDefined();
    });

    it('应该支持 registerProvider / unregisterProvider', () => {
      const agent = createMockAgent();
      const realLLM = new McpRagRealLLM(agent, { providers: [] });
      const provider = new MockVolcengineProvider();

      realLLM.registerProvider(provider);
      expect(realLLM.getRegisteredProviders()).toContain(provider);

      realLLM.unregisterProvider('volcengine-ark');
      expect(realLLM.getRegisteredProviders()).not.toContain(provider);
    });
  });

  describe('Provider 选择', () => {
    it('应该按优先级选择 Provider', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [
          { provider: 'volcengine-ark', priority: 10 },
          { provider: 'deepseek', priority: 20 },
        ],
      });
      const volcengine = new MockVolcengineProvider();
      const deepseek = new MockDeepSeekProvider();
      realLLM.registerProvider(volcengine);
      realLLM.registerProvider(deepseek);

      const result = await realLLM.query('test query');

      expect(result.success).toBe(true);
      expect(result.providerUsed).toBe('volcengine-ark');
      expect(volcengine.getCallCount()).toBe(1);
    });

    it('应该支持 forceProvider 强制指定', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [
          { provider: 'volcengine-ark', priority: 10 },
          { provider: 'deepseek', priority: 20 },
        ],
      });
      const volcengine = new MockVolcengineProvider();
      const deepseek = new MockDeepSeekProvider();
      realLLM.registerProvider(volcengine);
      realLLM.registerProvider(deepseek);

      const result = await realLLM.query('test', { forceProvider: 'deepseek' });

      expect(result.providerUsed).toBe('deepseek');
    });

    it('应该在所有 Provider 不可用时降级到 mock', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [
          { provider: 'volcengine-ark', priority: 10 },
        ],
      });

      // 不注册任何 provider
      const result = await realLLM.query('test');

      expect(result.fallback).toBe(true);
      expect(result.providerUsed).toBe('mock');
    });
  });

  describe('查询执行', () => {
    it('应该成功执行查询', async () => {
      const hits = [createMockHit()];
      const agent = createMockAgent(hits);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      provider.setResponses(['This is a test response from volcengine.']);
      realLLM.registerProvider(provider);

      const result = await realLLM.query('What is RAG?');

      expect(result.success).toBe(true);
      expect(result.answer).toBe('This is a test response from volcengine.');
      expect(result.citations.length).toBe(1);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('应该在 RAG 命中为空时返回 no-context 答案', async () => {
      const agent = createMockAgent([]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      provider.setResponses(['No relevant context found.']);
      realLLM.registerProvider(provider);

      const result = await realLLM.query('obscure question');

      expect(result.success).toBe(true);
      expect(result.citations.length).toBe(0);
    });

    it('应该支持进度回调', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      const phases: string[] = [];
      await realLLM.query('test', {
        onProgress: (phase) => phases.push(phase),
      });

      expect(phases).toContain('initializing');
      expect(phases).toContain('retrieving');
      expect(phases).toContain('calling-llm');
      expect(phases).toContain('completed');
    });

    it('应该支持流式回调', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
        enableStreaming: true,
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      const chunks: string[] = [];
      await realLLM.query('test', {
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('应该支持引用回调', async () => {
      const hits = [createMockHit(), createMockHit({ documentId: 'doc-2' })];
      const agent = createMockAgent(hits);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      let receivedCitations: any[] = [];
      await realLLM.query('test', {
        onCitations: (citations) => { receivedCitations = citations; },
      });

      expect(receivedCitations.length).toBe(2);
      expect(receivedCitations[0].index).toBe(1);
      expect(receivedCitations[1].index).toBe(2);
    });
  });

  describe('错误处理与降级', () => {
    it('应该在 LLM 调用失败时降级到 mock', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
        maxRetries: 1,
        retryDelayMs: 10,
      });
      const provider = new MockVolcengineProvider();
      provider.setShouldFail(true);
      realLLM.registerProvider(provider);

      const result = await realLLM.query('test');

      expect(result.fallback).toBe(true);
      expect(result.providerUsed).toBe('mock');
    });

    it('应该在 mock 也失败时返回错误', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [],
        maxRetries: 0,
      });

      // 模拟 mock 也失败 - 通过信号中断
      const controller = new AbortController();
      controller.abort();
      const result = await realLLM.query('test', { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该支持 AbortSignal 中断', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      const controller = new AbortController();
      controller.abort();
      const result = await realLLM.query('test', { signal: controller.signal });

      expect(result.success).toBe(false);
    });
  });

  describe('健康度跟踪', () => {
    it('应该跟踪 Provider 失败次数', () => {
      const agent = createMockAgent();
      const realLLM = new McpRagRealLLM(agent, { providers: [] });
      const health = realLLM.getProviderHealth();
      expect(health.mock).toBeDefined();
    });

    it('应该支持重置健康度', () => {
      const agent = createMockAgent();
      const realLLM = new McpRagRealLLM(agent, { providers: [] });
      realLLM.resetHealth();
      const health = realLLM.getProviderHealth();
      expect(health.mock.failures).toBe(0);
    });
  });

  describe('统计', () => {
    it('应该跟踪查询统计', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      await realLLM.query('q1');
      await realLLM.query('q2');

      const stats = realLLM.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.successQueries).toBe(2);
      expect(stats.totalTokensUsed).toBeGreaterThan(0);
      expect(stats.providerUsage['volcengine-ark']).toBe(2);
    });

    it('应该支持重置统计', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      await realLLM.query('q1');
      realLLM.resetStats();
      const stats = realLLM.getStats();
      expect(stats.totalQueries).toBe(0);
    });
  });

  describe('批量查询', () => {
    it('应该并发执行多个查询', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      const results = await realLLM.batchQuery(['q1', 'q2', 'q3']);

      expect(results.length).toBe(3);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe('事件订阅', () => {
    it('应该发出 provider-selected 事件', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      realLLM.registerProvider(provider);

      const events: string[] = [];
      realLLM.on((e) => events.push(e.type));

      await realLLM.query('test');

      expect(events).toContain('provider-selected');
      expect(events).toContain('retrieval-started');
      expect(events).toContain('completed');
    });

    it('应该支持退订', async () => {
      const agent = createMockAgent();
      const realLLM = new McpRagRealLLM(agent, { providers: [] });
      const events: any[] = [];
      const unsubscribe = realLLM.on((e) => events.push(e));
      unsubscribe();
      // 退订后即使有事件也不应触发
      // 这里只验证退订函数存在
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('Prompt 模板', () => {
    it('应该使用默认 Prompt 模板', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
      });
      const provider = new MockVolcengineProvider();
      let capturedMessages: Message[] = [];
      const originalChat = provider.chat.bind(provider);
      provider.chat = async (msgs, opts) => {
        capturedMessages = msgs;
        return originalChat(msgs, opts);
      };
      realLLM.registerProvider(provider);

      await realLLM.query('test');

      expect(capturedMessages.length).toBe(2);
      expect(capturedMessages[0].role).toBe('system');
      expect(capturedMessages[1].role).toBe('user');
    });

    it('应该支持自定义 Prompt 模板', async () => {
      const agent = createMockAgent([createMockHit()]);
      const realLLM = new McpRagRealLLM(agent, {
        providers: [{ provider: 'volcengine-ark', priority: 10 }],
        systemPromptTemplate: 'CUSTOM SYSTEM',
        userPromptTemplate: 'QUERY: {query}',
      });
      const provider = new MockVolcengineProvider();
      let capturedMessages: Message[] = [];
      const originalChat = provider.chat.bind(provider);
      provider.chat = async (msgs, opts) => {
        capturedMessages = msgs;
        return originalChat(msgs, opts);
      };
      realLLM.registerProvider(provider);

      await realLLM.query('my question');

      expect(capturedMessages[0].content).toBe('CUSTOM SYSTEM');
      expect(capturedMessages[1].content).toBe('QUERY: my question');
    });
  });
});
