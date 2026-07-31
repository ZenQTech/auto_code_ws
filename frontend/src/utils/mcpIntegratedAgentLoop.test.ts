/**
 * # ============================================================
 * # MCP Integrated Agent Loop 单元测试 (v1.0.0 Cycle 42 G42-04)
 * # ============================================================
 * # 覆盖：MCP 集成智能体循环
 * #       - 资源引用提取
 * #       - 提示词引用提取
 * #       - 单步运行
 * #       - 多步运行（含工具调用）
 * #       - 端到端场景
 * #       - 统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMcpIntegratedAgentLoop, extractMcpResourceRefs, extractMcpPromptRefs } from './mcpIntegratedAgentLoop';
import { McpServerRegistry } from './mcpRegistry';
import { McpClient } from './mcpClient';
import { McpToolBridge, createMcpToolBridge } from './mcpToolBridge';
import { McpResourceBridge, createMcpResourceBridge, buildHermesResourceUri } from './mcpResourceBridge';
import { McpPromptBridge, createMcpPromptBridge } from './mcpPromptBridge';
import { type LLMProvider, type Message, type ChatResponse } from './llmProviderAdapter';
import type { McpTransport } from './mcpTransport';
import type { JsonRpcMessage, Tool, Resource, Prompt } from './mcpTypes';

class AgentMockTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public tools: Tool[] = [];
  public resources: Resource[] = [];
  public prompts: Prompt[] = [];
  public toolResults: Map<string, unknown> = new Map();
  public resourceContents: Map<string, string> = new Map();
  public promptResults: Map<string, string> = new Map();

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: unknown): Promise<void> {
    const msg = message as JsonRpcMessage & { method?: string; params?: Record<string, unknown> };
    if ('method' in msg && msg.method === 'initialize' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: 'agent-test', version: '1.0.0' },
            },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'tools/list' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({ jsonrpc: '2.0', id: msg.id, result: { tools: this.tools } } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'tools/call' && 'id' in msg) {
      const params = msg.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      const name = params?.name ?? '';
      setTimeout(() => {
        const result = this.toolResults.get(name) ?? { result: 'ok' };
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'resources/list' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({ jsonrpc: '2.0', id: msg.id, result: { resources: this.resources } } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'resources/read' && 'id' in msg) {
      const params = msg.params as { uri: string } | undefined;
      const uri = params?.uri ?? '';
      setTimeout(() => {
        const text = this.resourceContents.get(uri) ?? 'default content';
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: { contents: [{ uri, mimeType: 'text/plain', text }] },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'prompts/list' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({ jsonrpc: '2.0', id: msg.id, result: { prompts: this.prompts } } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'prompts/get' && 'id' in msg) {
      const params = msg.params as { name: string } | undefined;
      const name = params?.name ?? '';
      setTimeout(() => {
        const text = this.promptResults.get(name) ?? `Prompt: ${name}`;
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: { messages: [{ role: 'user', content: { type: 'text', text } }] },
          } as JsonRpcMessage);
        }
      }, 1);
    }
  }

  onMessage(h: (msg: JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }
  onError(): () => void {
    return () => {};
  }
  onClose(): () => void {
    return () => {};
  }
  isOpen(): boolean {
    return this._isOpen;
  }
  async close(): Promise<void> {
    this._isOpen = false;
  }
}

async function createConnectedClient(transport: AgentMockTransport, serverId: string): Promise<McpClient> {
  const client = new McpClient({
    serverId,
    serverName: 'Agent Test',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  await client.connect();
  return client;
}

/**
 * 创建一个可定制的 mock LLM
 * 通过 shouldCallTool 控制是否返回工具调用
 */
function createMockLlm(options: { shouldCallTool?: boolean } = {}): LLMProvider & { calls: Array<{ messages: Message[]; options?: { tools?: unknown } }> } {
  const calls: Array<{ messages: Message[]; options?: { tools?: unknown } }> = [];
  let callCount = 0;
  const llm: LLMProvider & { calls: typeof calls } = {
    name: 'mock',
    displayName: 'Mock',
    defaultModel: 'mock-model',
    models: [],
    calls,
    async chat(messages: Message[], opts?: { tools?: unknown }): Promise<ChatResponse> {
      calls.push({ messages, options: opts });
      callCount += 1;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';

      // 检查消息中是否有系统消息提到工具
      const sysMsg = messages.find((m) => m.role === 'system');
      const sysText = typeof sysMsg?.content === 'string' ? sysMsg.content : '';
      const hasTools = sysText.includes('mcp__');

      // 第一次 LLM 调用如果 shouldCallTool=true 且有工具可用，返回工具调用
      // 第二次（工具结果后）返回正常文本
      if (options.shouldCallTool && hasTools && callCount === 1) {
        // 注意：parseOpenAIToolCalls 期望 tool_calls 字段（OpenAI 格式）
        // 我们故意模拟 OpenAI 原始响应格式
        const response = {
          id: `mock-${Date.now()}`,
          model: 'mock-model',
          provider: 'mock',
          content: 'I need to call a tool',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'mcp__test__echo',
                arguments: JSON.stringify({ text: 'hello' }),
              },
            },
          ],
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          finishReason: 'tool_use',
          durationMs: 50,
        };
        return response as unknown as ChatResponse;
      }
      return {
        id: `mock-${Date.now()}`,
        model: 'mock-model',
        provider: 'mock',
        content: `Response to: ${userText}`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
        durationMs: 50,
      };
    },
    async *stream() {
      yield { type: 'text', text: '', timestamp: Date.now() };
    },
    countTokens(text: string) {
      return Math.ceil(text.length / 4);
    },
    calculateCost() {
      return 0;
    },
    validateConfig() {
      return { valid: true, errors: [] };
    },
    async initialize() {},
    dispose() {},
    on() {
      return () => {};
    },
  };
  return llm;
}

// ============ 资源引用提取测试 ============

describe('mcpIntegratedAgentLoop - 资源引用提取', () => {
  it('从消息中提取 @mcp:// 资源引用', () => {
    const refs = extractMcpResourceRefs('请阅读 @mcp://filesystem/file%3A%2F%2F%2Fdata.txt');
    expect(refs.length).toBe(1);
    expect(refs[0]).toContain('filesystem');
  });

  it('无资源引用返回空数组', () => {
    expect(extractMcpResourceRefs('普通消息')).toEqual([]);
  });

  it('提取多个资源引用', () => {
    const refs = extractMcpResourceRefs('看 @mcp://a/uri1 和 @mcp://b/uri2');
    expect(refs.length).toBe(2);
  });
});

describe('mcpIntegratedAgentLoop - 提示词引用提取', () => {
  it('提取 /prompt 形式', () => {
    const refs = extractMcpPromptRefs('使用 /prompt mcp:fs::greet');
    expect(refs).toContain('mcp:fs::greet');
  });

  it('提取 @prompt: 形式', () => {
    const refs = extractMcpPromptRefs('使用 @prompt:mcp:fs::greet');
    expect(refs).toContain('mcp:fs::greet');
  });
});

// ============ Agent Loop 测试 ============

describe('mcpIntegratedAgentLoop - 基础运行', () => {
  let registry: McpServerRegistry;
  let toolBridge: McpToolBridge;
  let resourceBridge: McpResourceBridge;
  let promptBridge: McpPromptBridge;
  let transport: AgentMockTransport;
  let client: McpClient;
  let llm: ReturnType<typeof createMockLlm>;

  beforeEach(async () => {
    registry = new McpServerRegistry({ storageKey: 'test-registry', persistEnabled: false });
    toolBridge = createMcpToolBridge();
    resourceBridge = createMcpResourceBridge();
    promptBridge = createMcpPromptBridge();

    transport = new AgentMockTransport();
    transport.tools = [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    ];
    transport.toolResults.set('echo', { echoed: 'hello' });
    client = await createConnectedClient(transport, 'test');
    llm = createMockLlm();
  });

  afterEach(async () => {
    toolBridge.dispose();
    resourceBridge.dispose();
    promptBridge.dispose();
    await client.disconnect();
  });

  it('简单模式运行', async () => {
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      autoConnect: false,
    });
    const result = await agent.runWithMcp('Hello', { mode: 'simple' });
    expect(result.success).toBe(true);
    expect(result.steps).toBe(1);
    expect(result.content).toContain('Hello');
  });

  it('多步模式自动工具调用', async () => {
    const llmWithTool = createMockLlm({ shouldCallTool: true });
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llmWithTool,
      mcpRegistry: registry,
      toolBridge,
      autoConnect: false,
    });
    await toolBridge.registerServer('test', client);
    const result = await agent.runWithMcp('call the tool', { mode: 'multi-step', maxSteps: 3 });
    expect(result.toolExecutions.length).toBeGreaterThan(0);
  });

  it('系统消息包含工具列表', async () => {
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      autoConnect: false,
    });
    await toolBridge.registerServer('test', client);
    await agent.runWithMcp('test', { mode: 'simple' });
    const firstCall = llm.calls[0];
    const sysMsg = firstCall.messages.find((m) => m.role === 'system');
    expect(sysMsg).toBeDefined();
    if (typeof sysMsg?.content === 'string') {
      expect(sysMsg.content).toContain('mcp__test__echo');
    }
  });

  it('资源引用被解析', async () => {
    transport.resources = [{ uri: 'file:///data.txt', name: 'Data', mimeType: 'text/plain' }];
    transport.resourceContents.set('file:///data.txt', 'Resource content here');
    await resourceBridge.registerServer('test', client);

    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      resourceBridge,
      autoConnect: false,
    });
    const hermesUri = buildHermesResourceUri('test', 'file:///data.txt');
    const result = await agent.runWithMcp(`看这个 @${hermesUri}`, { mode: 'simple' });
    expect(result.resourceResolutions.length).toBe(1);
    expect(result.resourceResolutions[0].content).toBeDefined();
  });

  it('提示词引用被渲染', async () => {
    transport.prompts = [{ name: 'greet', description: 'Greet', arguments: [{ name: 'name', required: true }] }];
    transport.promptResults.set('greet', 'Hello ${args.name}!');
    await promptBridge.registerServer('test', client);

    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      promptBridge,
      autoConnect: false,
    });
    const result = await agent.runWithMcp('use prompt /prompt mcp:test::greet name=Alice', { mode: 'simple' });
    expect(result.promptRenders.length).toBe(1);
  });

  it('资源解析失败时仍能继续', async () => {
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      resourceBridge,
      autoConnect: false,
    });
    const result = await agent.runWithMcp(`看 @mcp://nonexistent/uri`, { mode: 'simple' });
    expect(result.resourceResolutions.length).toBe(1);
    expect(result.resourceResolutions[0].error).toBeDefined();
  });

  it('统计正确累计', async () => {
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      autoConnect: false,
    });
    await agent.runWithMcp('run 1', { mode: 'simple' });
    await agent.runWithMcp('run 2', { mode: 'simple' });
    const stats = agent.getStats();
    expect(stats.totalRuns).toBe(2);
    expect(stats.successRuns).toBe(2);
  });
});

// ============ 集成测试 ============

describe('mcpIntegratedAgentLoop - 集成场景', () => {
  it('完整链路：工具+资源+提示词 端到端', async () => {
    const registry = new McpServerRegistry({ storageKey: 'test-e2e', persistEnabled: false });
    const toolBridge = createMcpToolBridge();
    const resourceBridge = createMcpResourceBridge();
    const promptBridge = createMcpPromptBridge();
    const transport = new AgentMockTransport();
    transport.tools = [{ name: 'summarize', description: 'Summarize', inputSchema: { type: 'object' } }];
    transport.resources = [{ uri: 'file:///doc.txt', name: 'Doc', mimeType: 'text/plain' }];
    transport.resourceContents.set('file:///doc.txt', 'Document content');
    transport.prompts = [{ name: 'analyze', description: 'Analyze' }];
    transport.promptResults.set('analyze', 'Analysis template');

    const client = await createConnectedClient(transport, 'e2e');
    await toolBridge.registerServer('e2e', client);
    await resourceBridge.registerServer('e2e', client);
    await promptBridge.registerServer('e2e', client);

    const llm = createMockLlm();
    const agent = createMcpIntegratedAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      resourceBridge,
      promptBridge,
      autoConnect: false,
    });

    const result = await agent.runWithMcp(
      `analyze @${buildHermesResourceUri('e2e', 'file:///doc.txt')}`,
      { mode: 'simple' },
    );
    expect(result.success).toBe(true);

    toolBridge.dispose();
    resourceBridge.dispose();
    promptBridge.dispose();
    await client.disconnect();
  });
});

// ============ 性能基准 ============

describe('mcpIntegratedAgentLoop - 性能基准', () => {
  it('extractMcpResourceRefs 10000 次 < 50ms', () => {
    const msg = 'look at @mcp://fs/file%3A%2F%2F%2Fhome and @mcp://git/repo';
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      extractMcpResourceRefs(msg);
    }
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('extractMcpPromptRefs 10000 次 < 50ms', () => {
    const msg = 'use /prompt mcp:fs::greet and @prompt:mcp:fs::summarize';
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      extractMcpPromptRefs(msg);
    }
    expect(performance.now() - start).toBeLessThan(100);
  });
});
