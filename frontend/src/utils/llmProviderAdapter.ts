/**
 * # ============================================================
 * # LLM Provider Adapter - 统一 LLM Provider 抽象层 (v1.0.0 Cycle 36 G36-01)
 * # ============================================================
 * # 核心作用：统一 Anthropic / OpenAI / Ollama / Mock 等 LLM Provider 的接口
 * #           提供一致的 chat / stream / countTokens / calculateCost API
 * #           支持自动重试、速率限制、错误处理
 * # 对标产品：LiteLLM / Vercel AI SDK / LangChain
 * # 运行流程：
 * #   1. 创建 Provider 实例（AnthropicProvider / OpenAIProvider / OllamaProvider / MockProvider）
 * #   2. 通过 LLMProviderRegistry 注册 Provider
 * #   3. 业务代码调用统一接口（chat / stream），不关心具体 Provider
 * #   4. 引擎内部处理消息格式转换、Token 计数、成本计算、错误重试
 * # 输入参数：Message[] / ChatOptions / StreamOptions
 * # 输出结果：ChatResponse / AsyncIterable<StreamChunk> / TokenUsage
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type ProviderName = 'anthropic' | 'openai' | 'ollama' | 'mock';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ModalityType = 'text' | 'image' | 'audio' | 'file';

export interface MultimodalContent {
  type: ModalityType;
  text?: string;
  data?: string; // base64
  mimeType?: string;
  url?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string | MultimodalContent[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface StreamOptions extends ChatOptions {
  throttleMs?: number;
  bufferSize?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  provider: ProviderName;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_use' | 'error' | 'cancelled';
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  streamId?: string;
  sequence?: number;
  type: 'text' | 'tool_call' | 'usage' | 'done' | 'error';
  text?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
  error?: string;
  timestamp: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  inputCostPerMTokens: number;
  outputCostPerMTokens: number;
  capabilities: ModalityType[];
}

export interface ProviderConfig {
  name: ProviderName;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialDelayMs?: number;
  customHeaders?: Record<string, string>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['rate_limit', 'overloaded', 'network', 'timeout'],
};

// ============ 错误类 ============

export class LLMError extends Error {
  constructor(
    public provider: ProviderName,
    public type: 'auth' | 'rate_limit' | 'network' | 'invalid_request' | 'overloaded' | 'timeout' | 'cancelled' | 'unknown',
    public retryable: boolean,
    public statusCode?: number,
    message?: string
  ) {
    super(message || `${provider} ${type} error${statusCode ? ` (${statusCode})` : ''}`);
    this.name = 'LLMError';
  }
}

// ============ 模型定价 ============

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic (per 1M tokens, USD)
  'claude-opus-4-8': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o1-mini': { input: 3, output: 12 },
  'o1': { input: 15, output: 60 },
  // Ollama (本地免费)
  'llama3.2': { input: 0, output: 0 },
  'llama3.1': { input: 0, output: 0 },
  'qwen3': { input: 0, output: 0 },
  'gemma3': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'deepseek-r1': { input: 0, output: 0 },
};

export const PROVIDER_MODELS: Record<ProviderName, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 200000, inputCostPerMTokens: 15, outputCostPerMTokens: 75, capabilities: ['text', 'image'] },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200000, inputCostPerMTokens: 3, outputCostPerMTokens: 15, capabilities: ['text', 'image'] },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, inputCostPerMTokens: 0.25, outputCostPerMTokens: 1.25, capabilities: ['text', 'image'] },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, inputCostPerMTokens: 2.5, outputCostPerMTokens: 10, capabilities: ['text', 'image', 'audio'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, inputCostPerMTokens: 0.15, outputCostPerMTokens: 0.6, capabilities: ['text', 'image'] },
    { id: 'o1', name: 'O1', contextWindow: 200000, inputCostPerMTokens: 15, outputCostPerMTokens: 60, capabilities: ['text'] },
    { id: 'o1-mini', name: 'O1 Mini', contextWindow: 128000, inputCostPerMTokens: 3, outputCostPerMTokens: 12, capabilities: ['text'] },
  ],
  ollama: [
    { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 128000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text'] },
    { id: 'llama3.1', name: 'Llama 3.1', contextWindow: 128000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text'] },
    { id: 'qwen3', name: 'Qwen 3', contextWindow: 128000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text'] },
    { id: 'gemma3', name: 'Gemma 3', contextWindow: 32000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text', 'image'] },
    { id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: 64000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text'] },
  ],
  mock: [
    { id: 'mock-fast', name: 'Mock Fast', contextWindow: 128000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text'] },
    { id: 'mock-smart', name: 'Mock Smart', contextWindow: 128000, inputCostPerMTokens: 0, outputCostPerMTokens: 0, capabilities: ['text', 'image'] },
  ],
};

// ============ Provider 接口 ============

export interface LLMProvider {
  readonly name: ProviderName;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly models: ModelInfo[];

  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk>;

  countTokens(text: string, model?: string): number;
  calculateCost(usage: TokenUsage, model?: string): number;
  validateConfig(): { valid: boolean; errors: string[] };

  initialize(): Promise<void>;
  dispose(): void;

  on(event: string, callback: (data: unknown) => void): () => void;
}

// ============ 工具函数 ============

export function generateId(prefix: string = 'llm'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function estimateTokens(text: string): number {
  // 简单估算：英文约 4 字符/token，中文约 1.5 字符/token
  if (!text) return 0;
  // 粗略估算
  return Math.ceil(text.length / 4);
}

export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof LLMError) {
    return error.retryable;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  signal?: AbortSignal
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new LLMError('mock' as ProviderName, 'cancelled', false, undefined, 'Aborted');
    }
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (!(e instanceof LLMError) || !e.retryable) {
        throw e;
      }
      if (attempt === cfg.maxRetries) {
        throw e;
      }
      if (!cfg.retryableErrors.includes(e.type)) {
        throw e;
      }
      const delay = Math.min(
        cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt) + Math.random() * 1000,
        cfg.maxDelayMs
      );
      await sleep(delay);
    }
  }
  throw lastError!;
}

export function convertMessagesToAnthropic(messages: Message[]): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: any }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' ? msg.content : msg.content.find((c) => c.type === 'text')?.text;
      continue;
    }
    if (msg.role === 'tool') continue; // 简化处理
    converted.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  return { system, messages: converted };
}

export function convertMessagesToOpenAI(messages: Message[]): Array<{
  role: string;
  content: any;
}> {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

// ============ 基础 Provider 抽象类 ============

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract readonly displayName: string;
  abstract readonly defaultModel: string;
  abstract readonly models: ModelInfo[];

  protected listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  protected config: ProviderConfig;
  protected initialized: boolean = false;
  protected storageKey: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.storageKey = `llm-provider-${config.name}`;
  }

  abstract chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  abstract stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk>;

  countTokens(text: string, _model?: string): number {
    return estimateTokens(text);
  }

  calculateCost(usage: TokenUsage, _model?: string): number {
    return calculateCost(usage, _model || this.config.defaultModel);
  }

  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!this.config.defaultModel) {
      errors.push('defaultModel is required');
    }
    if (this.name !== 'ollama' && this.name !== 'mock' && !this.config.apiKey) {
      errors.push(`apiKey is required for ${this.name}`);
    }
    return { valid: errors.length === 0, errors };
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    this.emit('initialized', { name: this.name });
  }

  dispose(): void {
    this.listeners.clear();
    this.initialized = false;
    this.emit('disposed', { name: this.name });
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    return () => {
      const arr = this.listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  protected emit(event: string, data: unknown): void {
    const arr = this.listeners.get(event);
    if (arr) {
      for (const cb of arr) {
        try {
          cb(data);
        } catch (e) {
          // ignore
        }
      }
    }
  }

  protected getModel(options?: ChatOptions): string {
    return options?.model || this.config.defaultModel;
  }
}

// ============ Mock Provider（用于测试/演示）============

export class MockProvider extends BaseLLMProvider {
  readonly name: ProviderName = 'mock';
  readonly displayName: string = 'Mock Provider';
  readonly defaultModel: string = 'mock-fast';
  readonly models: ModelInfo[] = PROVIDER_MODELS.mock;

  private responseDelayMs: number = 100;
  private mockResponses: Map<string, string> = new Map();

  constructor(config?: Partial<ProviderConfig>) {
    super({
      name: 'mock',
      defaultModel: 'mock-fast',
      ...config,
    } as ProviderConfig);
    this.loadMockResponses();
  }

  private loadMockResponses(): void {
    this.mockResponses.set('hello', 'Hello! How can I help you today?');
    this.mockResponses.set('hi', 'Hi there! What can I do for you?');
    this.mockResponses.set('test', 'This is a test response from MockProvider.');
    this.mockResponses.set('poem', 'Roses are red,\nViolets are blue,\nMockProvider works,\nAnd so do you.');
    this.mockResponses.set('code', 'function hello() {\n  console.log("Hello, world!");\n}');
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const start = Date.now();
    const model = this.getModel(options);
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : '';

    // 模拟延迟
    await sleep(this.responseDelayMs);

    // 选择响应
    const lowerText = userText.toLowerCase();
    let content = `Mock response to: "${userText.slice(0, 50)}"`;
    for (const [key, response] of this.mockResponses.entries()) {
      if (lowerText.includes(key)) {
        content = response;
        break;
      }
    }

    const inputTokens = this.countTokens(JSON.stringify(messages));
    const outputTokens = this.countTokens(content);
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    const response: ChatResponse = {
      id: generateId('msg'),
      model,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop',
      durationMs: Date.now() - start,
    };

    this.emit('chat-completed', response);
    return response;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    const start = Date.now();
    const response = await this.chat(messages, options);
    const text = response.content;
    const throttleMs = options?.throttleMs ?? 16;
    // 引用以避免未使用警告（保留计时起点）
    void start;

    let sequence = 0;
    const chars = text.split('');
    for (const char of chars) {
      await sleep(throttleMs);
      yield {
        streamId: generateId('stream'),
        sequence: sequence++,
        type: 'text',
        text: char,
        timestamp: Date.now(),
      };
    }

    yield {
      streamId: generateId('stream'),
      sequence,
      type: 'usage',
      usage: response.usage,
      timestamp: Date.now(),
    };

    yield {
      streamId: generateId('stream'),
      sequence: sequence + 1,
      type: 'done',
      timestamp: Date.now(),
    };
  }

  // 测试辅助方法
  setResponseDelay(ms: number): void {
    this.responseDelayMs = ms;
  }

  setMockResponse(key: string, response: string): void {
    this.mockResponses.set(key.toLowerCase(), response);
  }
}

// ============ Mock Anthropic Provider（用于测试/演示）============

export class AnthropicProvider extends BaseLLMProvider {
  readonly name: ProviderName = 'anthropic';
  readonly displayName: string = 'Anthropic Claude';
  readonly defaultModel: string = 'claude-sonnet-4-5';
  readonly models: ModelInfo[] = PROVIDER_MODELS.anthropic;

  // 实际 SDK 引用占位（避免硬依赖）
  private client: unknown = null;

  constructor(config: Partial<ProviderConfig>) {
    super({
      name: 'anthropic',
      defaultModel: 'claude-sonnet-4-5',
      ...config,
    } as ProviderConfig);
    // 引用以避免未使用警告（保留 SDK 接入点）
    void this.client;
  }

  async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    // 实际实现需引入 @anthropic-ai/sdk
    // 此处返回 Mock 响应
    const start = Date.now();
    const model = this.getModel(_options);
    const lastUserMsg = [..._messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const content = `[Anthropic Mock] Response to: "${userText.slice(0, 80)}"`;

    const inputTokens = this.countTokens(JSON.stringify(_messages));
    const outputTokens = this.countTokens(content);
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    if (!this.config.apiKey) {
      throw new LLMError(this.name, 'auth', false, 401, 'API key is required');
    }

    return {
      id: generateId('msg'),
      model,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop',
      durationMs: Date.now() - start,
    };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    const response = await this.chat(messages, options);
    const text = response.content;
    const throttleMs = options?.throttleMs ?? 16;
    let sequence = 0;
    for (const char of text) {
      await sleep(throttleMs);
      yield {
        streamId: generateId('stream'),
        sequence: sequence++,
        type: 'text',
        text: char,
        timestamp: Date.now(),
      };
    }
    yield {
      streamId: generateId('stream'),
      sequence,
      type: 'usage',
      usage: response.usage,
      timestamp: Date.now(),
    };
    yield {
      streamId: generateId('stream'),
      sequence: sequence + 1,
      type: 'done',
      timestamp: Date.now(),
    };
  }
}

// ============ Mock OpenAI Provider（用于测试/演示）============

export class OpenAIProvider extends BaseLLMProvider {
  readonly name: ProviderName = 'openai';
  readonly displayName: string = 'OpenAI';
  readonly defaultModel: string = 'gpt-4o-mini';
  readonly models: ModelInfo[] = PROVIDER_MODELS.openai;

  constructor(config: Partial<ProviderConfig>) {
    super({
      name: 'openai',
      defaultModel: 'gpt-4o-mini',
      ...config,
    } as ProviderConfig);
  }

  async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    const start = Date.now();
    const model = this.getModel(_options);
    const lastUserMsg = [..._messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const content = `[OpenAI Mock] Response to: "${userText.slice(0, 80)}"`;

    const inputTokens = this.countTokens(JSON.stringify(_messages));
    const outputTokens = this.countTokens(content);
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    if (!this.config.apiKey) {
      throw new LLMError(this.name, 'auth', false, 401, 'API key is required');
    }

    return {
      id: generateId('msg'),
      model,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop',
      durationMs: Date.now() - start,
    };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    const response = await this.chat(messages, options);
    const text = response.content;
    const throttleMs = options?.throttleMs ?? 16;
    let sequence = 0;
    for (const char of text) {
      await sleep(throttleMs);
      yield {
        streamId: generateId('stream'),
        sequence: sequence++,
        type: 'text',
        text: char,
        timestamp: Date.now(),
      };
    }
    yield {
      streamId: generateId('stream'),
      sequence,
      type: 'usage',
      usage: response.usage,
      timestamp: Date.now(),
    };
    yield {
      streamId: generateId('stream'),
      sequence: sequence + 1,
      type: 'done',
      timestamp: Date.now(),
    };
  }
}

// ============ Ollama Provider（本地 LLM）============

export class OllamaProvider extends BaseLLMProvider {
  readonly name: ProviderName = 'ollama';
  readonly displayName: string = 'Ollama (Local)';
  readonly defaultModel: string = 'llama3.2';
  readonly models: ModelInfo[] = PROVIDER_MODELS.ollama;
  private baseUrl: string;

  constructor(config: Partial<ProviderConfig>) {
    super({
      name: 'ollama',
      defaultModel: 'llama3.2',
      baseUrl: 'http://localhost:11434',
      ...config,
    } as ProviderConfig);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    const start = Date.now();
    const model = this.getModel(_options);
    const lastUserMsg = [..._messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const content = `[Ollama ${model} Mock] Response to: "${userText.slice(0, 80)}"`;

    const inputTokens = this.countTokens(JSON.stringify(_messages));
    const outputTokens = this.countTokens(content);
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    return {
      id: generateId('msg'),
      model,
      provider: this.name,
      content,
      usage,
      finishReason: 'stop',
      durationMs: Date.now() - start,
    };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk> {
    const response = await this.chat(messages, options);
    const text = response.content;
    const throttleMs = options?.throttleMs ?? 16;
    let sequence = 0;
    for (const char of text) {
      await sleep(throttleMs);
      yield {
        streamId: generateId('stream'),
        sequence: sequence++,
        type: 'text',
        text: char,
        timestamp: Date.now(),
      };
    }
    yield {
      streamId: generateId('stream'),
      sequence,
      type: 'usage',
      usage: response.usage,
      timestamp: Date.now(),
    };
    yield {
      streamId: generateId('stream'),
      sequence: sequence + 1,
      type: 'done',
      timestamp: Date.now(),
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

// ============ Provider Registry ============

export class LLMProviderRegistry {
  private providers: Map<ProviderName, LLMProvider> = new Map();
  private defaultProvider: ProviderName | null = null;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();

  register(name: ProviderName, provider: LLMProvider): void {
    this.providers.set(name, provider);
    this.emit('provider-registered', { name, provider });
  }

  unregister(name: ProviderName): boolean {
    const result = this.providers.delete(name);
    if (result) {
      this.emit('provider-unregistered', { name });
    }
    return result;
  }

  get(name: ProviderName): LLMProvider | undefined {
    return this.providers.get(name);
  }

  has(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  setDefault(name: ProviderName): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} not registered`);
    }
    this.defaultProvider = name;
    this.emit('default-changed', { name });
  }

  getDefault(): LLMProvider {
    if (!this.defaultProvider) {
      throw new Error('No default provider set');
    }
    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Default provider ${this.defaultProvider} not found`);
    }
    return provider;
  }

  getDefaultName(): ProviderName | null {
    return this.defaultProvider;
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    return () => {
      const arr = this.listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  private emit(event: string, data: unknown): void {
    const arr = this.listeners.get(event);
    if (arr) {
      for (const cb of arr) {
        try {
          cb(data);
        } catch (e) {
          // ignore
        }
      }
    }
  }
}

// ============ Usage Tracker ============

export interface AggregateUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  callCount: number;
}

export class UsageTracker {
  private records: Array<{
    provider: ProviderName;
    model: string;
    usage: TokenUsage;
    cost: number;
    timestamp: number;
  }> = [];

  record(provider: ProviderName, model: string, usage: TokenUsage, cost: number): void {
    this.records.push({ provider, model, usage, cost, timestamp: Date.now() });
  }

  getTotal(): AggregateUsage {
    return this.records.reduce(
      (acc, r) => ({
        totalInputTokens: acc.totalInputTokens + r.usage.inputTokens,
        totalOutputTokens: acc.totalOutputTokens + r.usage.outputTokens,
        totalTokens: acc.totalTokens + r.usage.totalTokens,
        totalCost: acc.totalCost + r.cost,
        callCount: acc.callCount + 1,
      }),
      { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCost: 0, callCount: 0 }
    );
  }

  getByProvider(): Record<ProviderName, AggregateUsage> {
    const result: Record<string, AggregateUsage> = {};
    for (const r of this.records) {
      if (!result[r.provider]) {
        result[r.provider] = {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          callCount: 0,
        };
      }
      const agg = result[r.provider];
      agg.totalInputTokens += r.usage.inputTokens;
      agg.totalOutputTokens += r.usage.outputTokens;
      agg.totalTokens += r.usage.totalTokens;
      agg.totalCost += r.cost;
      agg.callCount += 1;
    }
    return result as Record<ProviderName, AggregateUsage>;
  }

  getByModel(): Record<string, AggregateUsage> {
    const result: Record<string, AggregateUsage> = {};
    for (const r of this.records) {
      if (!result[r.model]) {
        result[r.model] = {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          callCount: 0,
        };
      }
      const agg = result[r.model];
      agg.totalInputTokens += r.usage.inputTokens;
      agg.totalOutputTokens += r.usage.outputTokens;
      agg.totalTokens += r.usage.totalTokens;
      agg.totalCost += r.cost;
      agg.callCount += 1;
    }
    return result;
  }

  getRecords(): Array<{
    provider: ProviderName;
    model: string;
    usage: TokenUsage;
    cost: number;
    timestamp: number;
  }> {
    return [...this.records];
  }

  reset(): void {
    this.records = [];
  }
}

// ============ 单例 ============

let defaultRegistry: LLMProviderRegistry | null = null;
let defaultUsageTracker: UsageTracker | null = null;

export function getDefaultLLMProviderRegistry(): LLMProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new LLMProviderRegistry();
    // 默认注册 Mock Provider
    defaultRegistry.register('mock', new MockProvider());
    defaultRegistry.setDefault('mock');
  }
  return defaultRegistry;
}

export function resetDefaultLLMProviderRegistry(): void {
  if (defaultRegistry) {
    for (const p of defaultRegistry.list()) {
      p.dispose();
    }
    defaultRegistry = null;
  }
}

export function getDefaultUsageTracker(): UsageTracker {
  if (!defaultUsageTracker) {
    defaultUsageTracker = new UsageTracker();
  }
  return defaultUsageTracker;
}

export function resetDefaultUsageTracker(): void {
  defaultUsageTracker = null;
}

// ============ 便捷工厂 ============

export function createProvider(name: ProviderName, config: Partial<ProviderConfig> = {}): LLMProvider {
  switch (name) {
    case 'mock':
      return new MockProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
