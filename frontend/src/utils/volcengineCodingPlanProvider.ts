/**
 * # ============================================================
 * # Volcengine Coding Plan Provider (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 核心作用：适配火山方舟 Coding Plan LLM 到 LLMProvider 接口
 * #           用于 McpIntegratedAgentLoop 端到端集成
 * # 协议：OpenAI 兼容 + Anthropic 兼容
 * # Base URL: https://ark.cn-beijing.volces.com/api/v3
 * # 沙箱兼容：当 API Key 不可用时自动回退到 mock 实现
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * #   - 2026-07-31 | v1.0.1 | 修复 TypeScript 严格模式错误
 * # ====================================
 */

import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  StreamOptions,
  StreamChunk,
  ModelInfo,
  TokenUsage,
  ProviderName,
} from './llmProviderAdapter';
import { VolcengineArkProvider as RealVolcengineArkProvider, type VolcengineArkConfig } from './realLLMProvider';

// ============ 类型定义 ============

/**
 * Coding Plan Provider 配置
 */
export interface VolcengineCodingPlanConfig {
  /** API Key */
  apiKey?: string;
  /** Base URL（默认火山方舟 Coding Plan 端点） */
  baseURL?: string;
  /** 默认模型（默认 doubao-pro-32k） */
  defaultModel?: string;
  /** 协议（默认 openai） */
  protocol?: 'openai' | 'anthropic';
  /** 强制使用 mock（即使有 API Key） */
  forceMock?: boolean;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * Coding Plan Provider 统计
 */
export interface VolcengineCodingPlanStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

// ============ Mock Provider（沙箱兼容）============

/**
 * Mock Coding Plan Provider
 * 当 API Key 不可用时使用，模拟 Coding Plan 响应
 */
export class MockVolcengineCodingPlanProvider implements LLMProvider {
  readonly name: ProviderName = 'volcengine-ark' as ProviderName;
  readonly displayName: string = '火山方舟 Coding Plan (Mock)';
  readonly defaultModel: string = 'doubao-pro-32k';
  readonly models: ModelInfo[] = [
    {
      id: 'doubao-pro-32k',
      name: 'Doubao Pro 32K',
      contextWindow: 32000,
      inputCostPerMTokens: 0.8,
      outputCostPerMTokens: 2.0,
      capabilities: ['text'],
    },
    {
      id: 'doubao-pro-128k',
      name: 'Doubao Pro 128K',
      contextWindow: 128000,
      inputCostPerMTokens: 1.2,
      outputCostPerMTokens: 3.0,
      capabilities: ['text'],
    },
  ];

  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private stats: VolcengineCodingPlanStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
  };

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const start = Date.now();
    this.stats.totalRequests += 1;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
      ? (lastUserMsg.content as Array<{ text?: string }>).map((c) => c.text || '').join(' ')
      : '';

    // 模拟工具调用决策
    const hasToolKeywords = /调用|执行|查询|获取|读取|列出|使用.*工具/.test(userText);
    const hasToolDefs = options?.tools && options.tools.length > 0;

    if (hasToolKeywords && hasToolDefs) {
      // 模拟工具调用响应
      const firstTool = options.tools![0];
      const toolCall = {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: firstTool.name,
        arguments: this.inferToolArgs(firstTool.name, userText),
      };
      const inputTokens = this.estimateTokens(messages);
      const outputTokens = 100;
      this.stats.successRequests += 1;
      this.stats.totalInputTokens += inputTokens;
      this.stats.totalOutputTokens += outputTokens;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        id: `chatcmpl-mock-${Date.now()}`,
        model: options?.model || this.defaultModel,
        provider: this.name,
        content: '',
        toolCalls: [toolCall],
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        finishReason: 'tool_use',
        durationMs: Date.now() - start,
      };
    }

    // 普通文本响应
    const content = `[Mock Coding Plan] 这是对"${userText.slice(0, 100)}"的模拟响应。\n\n实际生产环境需配置 ARK_API_KEY 环境变量以调用真实的火山方舟 Coding Plan。`;
    const inputTokens = this.estimateTokens(messages);
    const outputTokens = this.estimateTokens([{ role: 'assistant', content }]);
    this.stats.successRequests += 1;
    this.stats.totalInputTokens += inputTokens;
    this.stats.totalOutputTokens += outputTokens;
    this.stats.totalDurationMs += Date.now() - start;

    return {
      id: `chatcmpl-mock-${Date.now()}`,
      model: options?.model || this.defaultModel,
      provider: this.name,
      content,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      finishReason: 'stop',
      durationMs: Date.now() - start,
    };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    const response = await this.chat(messages, options);
    const streamId = `stream-${Date.now()}`;
    let sequence = 0;

    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield {
          streamId,
          sequence: sequence++,
          type: 'tool_call',
          toolCall: tc,
          timestamp: Date.now(),
        };
      }
    } else {
      const text = response.content;
      const throttleMs = options?.throttleMs ?? 10;
      for (const char of text) {
        await new Promise((r) => setTimeout(r, throttleMs));
        yield {
          streamId,
          sequence: sequence++,
          type: 'text',
          text: char,
          timestamp: Date.now(),
        };
      }
    }

    yield {
      streamId,
      sequence,
      type: 'usage',
      usage: response.usage,
      timestamp: Date.now(),
    };
    yield {
      streamId,
      sequence: sequence + 1,
      type: 'done',
      timestamp: Date.now(),
    };
  }

  countTokens(text: string): number {
    return this.estimateTokens([{ role: 'user', content: text }]);
  }

  calculateCost(usage: TokenUsage, model?: string): number {
    const m = this.models.find((x) => x.id === (model || this.defaultModel));
    if (!m) return 0;
    return (usage.inputTokens / 1_000_000) * m.inputCostPerMTokens +
           (usage.outputTokens / 1_000_000) * m.outputCostPerMTokens;
  }

  validateConfig(): { valid: boolean; errors: string[] } {
    return { valid: true, errors: [] };
  }

  async initialize(): Promise<void> {
    // mock 无需初始化
  }

  dispose(): void {
    this.listeners.clear();
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
    return () => {
      const arr = this.listeners.get(event) ?? [];
      const idx = arr.indexOf(callback);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  getStats(): VolcengineCodingPlanStats {
    return { ...this.stats };
  }

  private estimateTokens(messages: Message[]): number {
    const total = messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join(' ');
    return Math.ceil(total.length / 4);
  }

  private inferToolArgs(toolName: string, userText: string): Record<string, unknown> {
    // 简单的参数推断
    if (toolName.includes('read_file')) {
      const match = userText.match(/["']([^"']+\.[a-z]+)["']/);
      return { path: match?.[1] ?? '/test/file.txt' };
    }
    if (toolName.includes('list_directory')) {
      return { path: '/test' };
    }
    if (toolName.includes('git_status')) {
      return {};
    }
    return {};
  }
}

// ============ Real Provider 适配器 ============

/**
 * 火山方舟 Coding Plan Provider
 * 适配 realLLMProvider.VolcengineArkProvider 到 LLMProvider 接口
 * 当 API Key 可用时使用真实 API，否则回退到 mock
 */
export class VolcengineCodingPlanProvider implements LLMProvider {
  readonly name: ProviderName = 'volcengine-ark' as ProviderName;
  readonly displayName: string = '火山方舟 Coding Plan';
  readonly defaultModel: string;
  readonly models: ModelInfo[];

  private realProvider: RealVolcengineArkProvider | null = null;
  private mockProvider: MockVolcengineCodingPlanProvider;
  private isRealMode: boolean = false;
  private config: VolcengineCodingPlanConfig;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();

  constructor(config: VolcengineCodingPlanConfig = {}) {
    this.config = config;
    this.mockProvider = new MockVolcengineCodingPlanProvider();
    this.defaultModel = config.defaultModel ?? 'doubao-pro-32k';
    this.models = this.mockProvider.models;

    // 决定是否使用真实 provider
    if (!config.forceMock && config.apiKey) {
      try {
        const arkConfig: VolcengineArkConfig = {
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          defaultModel: config.defaultModel,
          protocol: config.protocol,
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
        };
        this.realProvider = new RealVolcengineArkProvider(arkConfig);
        this.isRealMode = true;
      } catch (err) {
        console.warn(
          `[VolcengineCodingPlan] Failed to init real provider, using mock: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.isRealMode = false;
      }
    }
  }

  get isReal(): boolean {
    return this.isRealMode;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (this.isRealMode && this.realProvider) {
      try {
        return await this.realProvider.chat(messages, options);
      } catch (err) {
        console.warn(
          `[VolcengineCodingPlan] Real API call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Fallback to mock
        return this.mockProvider.chat(messages, options);
      }
    }
    return this.mockProvider.chat(messages, options);
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    if (this.isRealMode && this.realProvider) {
      yield* this.realProvider.stream(messages, options);
    } else {
      yield* this.mockProvider.stream(messages, options);
    }
  }

  countTokens(text: string, _model?: string): number {
    return this.mockProvider.countTokens(text);
  }

  calculateCost(usage: TokenUsage, model?: string): number {
    return this.mockProvider.calculateCost(usage, model);
  }

  validateConfig(): { valid: boolean; errors: string[] } {
    if (this.isRealMode) {
      return { valid: true, errors: [] };
    }
    return { valid: true, errors: ['API key not provided, using mock provider'] };
  }

  async initialize(): Promise<void> {
    // real provider 无需异步初始化
  }

  dispose(): void {
    this.mockProvider.dispose();
    this.listeners.clear();
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
    return () => {
      const arr = this.listeners.get(event) ?? [];
      const idx = arr.indexOf(callback);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }
}

// ============ 工厂函数 ============

/**
 * 创建 Coding Plan Provider
 * - 如果有 ARK_API_KEY 环境变量，使用真实 API
 * - 否则使用 mock 实现
 */
export function createVolcengineCodingPlanProvider(
  config: VolcengineCodingPlanConfig = {},
): VolcengineCodingPlanProvider {
  // 从环境变量读取 API Key（如果在 Node.js 环境）
  const envApiKey = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.ARK_API_KEY;
  const finalConfig: VolcengineCodingPlanConfig = {
    ...config,
    apiKey: config.apiKey ?? envApiKey,
  };
  return new VolcengineCodingPlanProvider(finalConfig);
}
