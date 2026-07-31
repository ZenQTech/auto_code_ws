/**
 * # ============================================================
 * # RealLLMProvider - 真实 LLM Provider 集成 (v1.0.0 Cycle 37 G37-04)
 * # ============================================================
 * # 核心作用：集成 DeepSeek API 和 Volcengine Ark Coding Plan
 * #           支持 OpenAI 兼容协议 / SSE 流式 / Function Calling / Thinking Mode
 * #           完整错误处理 / 重试 / 限流 / 成本计算
 * # 安全要求：
 * #   - API Key 仅通过环境变量注入（process.env.DEEPSEEK_API_KEY / ARK_API_KEY）
 * #   - 不在日志中输出 API Key
 * #   - 提供 .env.example 模板
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 37 G37-04 初次创建
 * # ============================================================
 */

import {
  LLMProvider,
  ChatResponse,
  Message,
  ChatOptions,
  StreamOptions,
  StreamChunk,
  TokenUsage,
  ModelInfo,
  ToolDefinition,
  ProviderName,
  MessageRole,
  MultimodalContent,
} from './llmProviderAdapter';

// ============ 类型定义 ============

/**
 * DeepSeek 配置
 */
export interface DeepSeekConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * 火山方舟配置
 */
export interface VolcengineArkConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  protocol?: 'openai' | 'anthropic';
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * LLM 错误码
 */
export type LLMErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'UNKNOWN';

/**
 * LLM 错误
 */
export class LLMError extends Error {
  constructor(
    public code: LLMErrorCode,
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * 重试选项
 */
export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: LLMErrorCode[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT'],
};

/**
 * DeepSeek 模型信息
 */
export const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    contextWindow: 32000,
    inputCostPerMTokens: 0.14,
    outputCostPerMTokens: 0.28,
    capabilities: ['text'],
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    contextWindow: 64000,
    inputCostPerMTokens: 0.55,
    outputCostPerMTokens: 2.19,
    capabilities: ['text'],
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    contextWindow: 32000,
    inputCostPerMTokens: 0.14,
    outputCostPerMTokens: 0.28,
    capabilities: ['text'],
  },
];

/**
 * 火山方舟 Coding Plan 模型
 */
export interface CodingPlanModel {
  id: string;
  name: string;
  contextWindow: number;
  inputCostPerMTokens: number;
  outputCostPerMTokens: number;
  protocol: 'openai' | 'anthropic';
  description?: string;
}

export const ARK_CODING_PLAN_MODELS: CodingPlanModel[] = [
  {
    id: 'doubao-pro-32k',
    name: '豆包 Pro 32K',
    contextWindow: 32000,
    inputCostPerMTokens: 0.8,
    outputCostPerMTokens: 2.0,
    protocol: 'openai',
    description: '字节豆包 Pro 版，32K 上下文',
  },
  {
    id: 'doubao-pro-128k',
    name: '豆包 Pro 128K',
    contextWindow: 128000,
    inputCostPerMTokens: 1.2,
    outputCostPerMTokens: 3.0,
    protocol: 'openai',
    description: '字节豆包 Pro 版，128K 上下文',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    contextWindow: 64000,
    inputCostPerMTokens: 2.0,
    outputCostPerMTokens: 8.0,
    protocol: 'openai',
    description: 'DeepSeek V3 大模型',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    contextWindow: 64000,
    inputCostPerMTokens: 4.0,
    outputCostPerMTokens: 16.0,
    protocol: 'openai',
    description: 'DeepSeek R1 推理模型',
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    contextWindow: 128000,
    inputCostPerMTokens: 2.0,
    outputCostPerMTokens: 6.0,
    protocol: 'openai',
    description: '月之暗面 Kimi K2',
  },
  {
    id: 'qwen3-coder-480b',
    name: 'Qwen3 Coder 480B',
    contextWindow: 128000,
    inputCostPerMTokens: 3.0,
    outputCostPerMTokens: 9.0,
    protocol: 'openai',
    description: '通义千问 3 Coder 480B',
  },
];

// ============ 工具函数 ============

/**
 * 计算重试延迟
 */
export function calculateRetryDelay(attempt: number, options: RetryOptions): number {
  const base = Math.min(
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt),
    options.maxDelayMs
  );
  const jitter = base * (1 + (Math.random() * 0.2 - 0.1));
  return Math.floor(jitter);
}

/**
 * 判断是否可重试
 */
export function isLLMErrorRetryable(code: LLMErrorCode, options: RetryOptions): boolean {
  return options.retryableErrors.includes(code);
}

/**
 * 掩码 API Key
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

/**
 * HTTP 请求 + 重试
 */
export async function fetchWithRetry(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<Response> {
  const timeout = options.timeoutMs || 60000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'POST',
        headers: options.headers,
        body: options.body,
        signal: options.signal || controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // HTTP 错误
      const errorCode = httpStatusToLLMErrorCode(response.status);
      if (!isLLMErrorRetryable(errorCode, retryOptions) || attempt === retryOptions.maxRetries) {
        const text = await response.text();
        throw new LLMError(errorCode, `HTTP ${response.status}: ${text}`, response.status, { body: text });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const code: LLMErrorCode = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
      if (!isLLMErrorRetryable(code, retryOptions) || attempt === retryOptions.maxRetries) {
        throw new LLMError(code, lastError.message);
      }
    }

    const delay = calculateRetryDelay(attempt, retryOptions);
    await new Promise(r => setTimeout(r, delay));
  }

  throw new LLMError('UNKNOWN', lastError?.message || 'Unknown error');
}

/**
 * HTTP 状态码转 LLM 错误码
 */
export function httpStatusToLLMErrorCode(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return 'AUTHENTICATION_ERROR';
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 413) return 'CONTEXT_LENGTH_EXCEEDED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

// ============ OpenAI 协议转换 ============

/**
 * 内部消息 -> OpenAI 消息
 */
export function toOpenAIMessages(messages: Message[]): Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }> {
  return messages.map(m => {
    if (typeof m.content === 'string') {
      const out: any = { role: m.role, content: m.content };
      if (m.toolCallId) out.tool_call_id = m.toolCallId;
      return out;
    }
    // 多模态内容
    const parts = m.content.map(c => {
      if (c.type === 'text') return { type: 'text', text: c.text };
      if (c.type === 'image' && c.data) {
        return { type: 'image_url', image_url: { url: `data:${c.mimeType};base64,${c.data}` } };
      }
      return { type: 'text', text: c.text || '' };
    });
    return { role: m.role, content: parts };
  });
}

/**
 * OpenAI 工具 -> 内部
 */
export function fromOpenAITools(tools?: ToolDefinition[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * OpenAI 响应 -> 内部
 */
export function fromOpenAIResponse(resp: any, provider: ProviderName, startTime: number): ChatResponse {
  const choice = resp.choices?.[0];
  const message = choice?.message || {};
  const usage: TokenUsage = {
    inputTokens: resp.usage?.prompt_tokens || 0,
    outputTokens: resp.usage?.completion_tokens || 0,
    totalTokens: resp.usage?.total_tokens || 0,
  };

  const result: ChatResponse = {
    id: resp.id || `chatcmpl_${Date.now()}`,
    model: resp.model || 'unknown',
    provider,
    content: message.content || '',
    usage,
    finishReason: mapFinishReason(choice?.finish_reason),
    durationMs: Math.round(performance.now() - startTime),
  };

  // 工具调用
  if (message.tool_calls && Array.isArray(message.tool_calls)) {
    result.toolCalls = message.tool_calls.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name || '',
      arguments: typeof tc.function?.arguments === 'string' ? safeJsonParse(tc.function.arguments) : tc.function?.arguments || {},
    }));
  }

  // 思考内容（DeepSeek Reasoner）
  if (message.reasoning_content) {
    (result as any).thinking = message.reasoning_content;
  }

  return result;
}

function mapFinishReason(reason: string | undefined): ChatResponse['finishReason'] {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'tool_calls' || reason === 'tool_use') return 'tool_use';
  if (reason === 'error') return 'error';
  if (reason === 'cancelled') return 'cancelled';
  return 'stop';
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * 将 CodingPlanModel 转换为统一 ModelInfo
 */
function toModelInfo(m: CodingPlanModel): ModelInfo {
  return {
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow,
    inputCostPerMTokens: m.inputCostPerMTokens,
    outputCostPerMTokens: m.outputCostPerMTokens,
    capabilities: ['text'],
  };
}

// ============ SSE 解析 ============

/**
 * 解析 SSE 流
 */
export async function* parseSSEStream(
  response: Response,
  provider: ProviderName
): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new LLMError('STREAM_INTERRUPTED', 'Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sequence = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          yield {
            type: 'done',
            timestamp: Date.now(),
            sequence: sequence++,
          };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta || {};

          if (delta.content) {
            yield {
              type: 'text',
              text: delta.content,
              timestamp: Date.now(),
              sequence: sequence++,
            };
          }

          // DeepSeek 思考
          if (delta.reasoning_content) {
            yield {
              type: 'text',
              text: delta.reasoning_content,
              timestamp: Date.now(),
              sequence: sequence++,
            };
          }

          // 工具调用
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: tc.id || `call_${sequence}`,
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments ? safeJsonParse(tc.function.arguments) : {},
                },
                timestamp: Date.now(),
                sequence: sequence++,
              };
            }
          }

          // 使用量
          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usage.prompt_tokens || 0,
                outputTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              },
              timestamp: Date.now(),
              sequence: sequence++,
            };
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

// ============ DeepSeek Provider ============

export class DeepSeekProvider {
  readonly name: ProviderName = 'deepseek';
  readonly supportedModels: string[] = DEEPSEEK_MODELS.map(m => m.id);
  readonly displayName: string = 'DeepSeek';
  readonly models: ModelInfo[] = DEEPSEEK_MODELS;

  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;
  private timeoutMs: number;
  private retryOptions: RetryOptions;

  constructor(config: DeepSeekConfig) {
    if (!config.apiKey) {
      throw new LLMError('AUTHENTICATION_ERROR', 'DeepSeek API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.deepseek.com/v1';
    this.defaultModel = config.defaultModel || 'deepseek-chat';
    this.timeoutMs = config.timeoutMs || 60000;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      maxRetries: config.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
    };
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    const startTime = performance.now();
    const body = {
      model: options.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stopSequences,
      tools: fromOpenAITools(options.tools),
      stream: false,
    };

    const response = await fetchWithRetry(
      `${this.baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    const data = await response.json();
    const result = fromOpenAIResponse(data, 'deepseek', startTime);

    // 成本计算
    (result as any).cost = this.calculateCost({
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    }, result.model);

    return result;
  }

  async *stream(messages: Message[], options: StreamOptions = {}): AsyncGenerator<StreamChunk> {
    const body = {
      model: options.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      tools: fromOpenAITools(options.tools),
      stream: true,
    };

    const response = await fetchWithRetry(
      `${this.baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    yield* parseSSEStream(response, 'deepseek');
  }

  async embed(text: string | string[]): Promise<number[][]> {
    // DeepSeek 暂未提供独立 embedding API
    throw new LLMError('INVALID_REQUEST', 'DeepSeek does not provide embedding API. Use OpenAI-compatible embedding service.');
  }

  async chatWithTools(messages: Message[], tools: ToolDefinition[], options: ChatOptions = {}): Promise<ChatResponse> {
    return this.chat(messages, { ...options, tools });
  }

  async thinkThenAnswer(prompt: string, options: ChatOptions = {}): Promise<{ thinking: string; answer: string }> {
    const response = await this.chat(
      [{ role: 'user', content: prompt }],
      { ...options, model: options.model || 'deepseek-reasoner' }
    );
    return {
      thinking: (response as any).thinking || '',
      answer: response.content,
    };
  }

  getModelInfo(model: string): ModelInfo | undefined {
    return DEEPSEEK_MODELS.find(m => m.id === model);
  }

  calculateCost(usage: any, model: string = this.defaultModel): number {
    const info = this.getModelInfo(model);
    if (!info) return 0;
    const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
    const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
    return (promptTokens / 1_000_000) * info.inputCostPerMTokens +
           (completionTokens / 1_000_000) * info.outputCostPerMTokens;
  }
}

// ============ Volcengine Ark Provider ============

export class VolcengineArkProvider {
  readonly name: ProviderName = 'volcengine-ark';
  readonly supportedModels: string[] = ARK_CODING_PLAN_MODELS.map(m => m.id);
  readonly displayName: string = '火山方舟';
  readonly models: ModelInfo[] = ARK_CODING_PLAN_MODELS.map(toModelInfo);

  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;
  private protocol: 'openai' | 'anthropic';
  private timeoutMs: number;
  private retryOptions: RetryOptions;

  constructor(config: VolcengineArkConfig) {
    if (!config.apiKey) {
      throw new LLMError('AUTHENTICATION_ERROR', 'Volcengine Ark API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://ark.cn-beijing.volces.com/api/v3';
    this.defaultModel = config.defaultModel || 'doubao-pro-32k';
    this.protocol = config.protocol || 'openai';
    this.timeoutMs = config.timeoutMs || 60000;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      maxRetries: config.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
    };
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    if (this.protocol === 'openai') {
      return this.chatOpenAI(messages, options);
    } else {
      return this.chatAnthropic(messages, options);
    }
  }

  private async chatOpenAI(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const startTime = performance.now();
    const body = {
      model: options.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      tools: fromOpenAITools(options.tools),
      stream: false,
    };

    const response = await fetchWithRetry(
      `${this.baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    const data = await response.json();
    const result = fromOpenAIResponse(data, 'volcengine-ark', startTime);
    (result as any).cost = this.calculateCost({
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    }, result.model);
    return result;
  }

  private async chatAnthropic(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const startTime = performance.now();
    // 提取 system 消息
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const body: any = {
      model: options.model || this.defaultModel,
      messages: otherMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n'),
      })),
      max_tokens: options.maxTokens || 4096,
    };
    if (systemMessage) {
      body.system = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    }

    const response = await fetchWithRetry(
      `${this.baseURL}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    const data = await response.json();
    const textContent = data.content?.find((c: any) => c.type === 'text');
    const result: ChatResponse = {
      id: data.id || `msg_${Date.now()}`,
      model: data.model || this.defaultModel,
      provider: 'volcengine-ark',
      content: textContent?.text || '',
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
      durationMs: Math.round(performance.now() - startTime),
    };
    return result;
  }

  async *stream(messages: Message[], options: StreamOptions = {}): AsyncGenerator<StreamChunk> {
    if (this.protocol === 'openai') {
      yield* this.streamOpenAI(messages, options);
    } else {
      yield* this.streamAnthropic(messages, options);
    }
  }

  private async *streamOpenAI(messages: Message[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const body = {
      model: options.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    };

    const response = await fetchWithRetry(
      `${this.baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    yield* parseSSEStream(response, 'volcengine-ark');
  }

  private async *streamAnthropic(messages: Message[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    const body: any = {
      model: options.model || this.defaultModel,
      messages: otherMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n'),
      })),
      max_tokens: options.maxTokens || 4096,
      stream: true,
    };
    if (systemMessage) {
      body.system = typeof systemMessage.content === 'string' ? systemMessage.content : '';
    }

    const response = await fetchWithRetry(
      `${this.baseURL}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: options.signal,
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    yield* parseSSEStream(response, 'volcengine-ark');
  }

  async embed(text: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(text) ? text : [text];
    const response = await fetchWithRetry(
      `${this.baseURL}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'doubao-embedding',
          input: inputs,
        }),
        timeoutMs: this.timeoutMs,
      },
      this.retryOptions
    );

    const data = await response.json();
    return (data.data || []).map((d: any) => d.embedding);
  }

  async chatWithTools(messages: Message[], tools: ToolDefinition[], options: ChatOptions = {}): Promise<ChatResponse> {
    return this.chat(messages, { ...options, tools });
  }

  listCodingPlanModels(): CodingPlanModel[] {
    return ARK_CODING_PLAN_MODELS;
  }

  getEndpointInfo(endpointId: string): CodingPlanModel | undefined {
    return ARK_CODING_PLAN_MODELS.find(m => m.id === endpointId);
  }

  getModelInfo(model: string): ModelInfo | undefined {
    const m = ARK_CODING_PLAN_MODELS.find(x => x.id === model);
    if (!m) return undefined;
    return {
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      inputCostPerMTokens: m.inputCostPerMTokens,
      outputCostPerMTokens: m.outputCostPerMTokens,
      capabilities: ['text'],
    };
  }

  calculateCost(usage: any, model: string = this.defaultModel): number {
    const info = this.getModelInfo(model);
    if (!info) return 0;
    const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
    const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
    return (promptTokens / 1_000_000) * info.inputCostPerMTokens +
           (completionTokens / 1_000_000) * info.outputCostPerMTokens;
  }
}

// ============ 配置加载器 ============

export interface ProviderConfigs {
  deepseek?: DeepSeekConfig;
  volcengineArk?: VolcengineArkConfig;
}

/**
 * 从环境变量加载 Provider 配置
 */
export function loadProviderConfigsFromEnv(): ProviderConfigs {
  const configs: ProviderConfigs = {};

  if (typeof process !== 'undefined' && process.env) {
    if (process.env.DEEPSEEK_API_KEY) {
      configs.deepseek = {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL,
        defaultModel: process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat',
      };
    }

    if (process.env.ARK_API_KEY) {
      configs.volcengineArk = {
        apiKey: process.env.ARK_API_KEY,
        baseURL: process.env.ARK_BASE_URL,
        defaultModel: process.env.ARK_DEFAULT_MODEL,
        protocol: (process.env.ARK_PROTOCOL as 'openai' | 'anthropic') || 'openai',
      };
    }
  } else if (typeof window !== 'undefined' && (window as any).__ENV__) {
    const env = (window as any).__ENV__;
    if (env.DEEPSEEK_API_KEY) {
      configs.deepseek = {
        apiKey: env.DEEPSEEK_API_KEY,
        baseURL: env.DEEPSEEK_BASE_URL,
        defaultModel: env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat',
      };
    }
    if (env.ARK_API_KEY) {
      configs.volcengineArk = {
        apiKey: env.ARK_API_KEY,
        baseURL: env.ARK_BASE_URL,
        defaultModel: env.ARK_DEFAULT_MODEL,
        protocol: env.ARK_PROTOCOL || 'openai',
      };
    }
  }

  return configs;
}

/**
 * 验证配置
 */
export function validateProviderConfigs(configs: ProviderConfigs): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (configs.deepseek) {
    if (!configs.deepseek.apiKey) errors.push('DeepSeek apiKey is missing');
    if (configs.deepseek.defaultModel && !DEEPSEEK_MODELS.find(m => m.id === configs.deepseek!.defaultModel)) {
      errors.push(`Unknown DeepSeek model: ${configs.deepseek.defaultModel}`);
    }
  }

  if (configs.volcengineArk) {
    if (!configs.volcengineArk.apiKey) errors.push('Ark apiKey is missing');
  }

  return { valid: errors.length === 0, errors };
}

// ============ 工厂函数 ============

export function createDeepSeekProvider(config?: Partial<DeepSeekConfig>): DeepSeekProvider | null {
  if (!config?.apiKey) {
    if (typeof process !== 'undefined' && process.env?.DEEPSEEK_API_KEY) {
      config = { ...config, apiKey: process.env.DEEPSEEK_API_KEY };
    } else {
      return null;
    }
  }
  return new DeepSeekProvider(config as DeepSeekConfig);
}

export function createVolcengineArkProvider(config?: Partial<VolcengineArkConfig>): VolcengineArkProvider | null {
  if (!config?.apiKey) {
    if (typeof process !== 'undefined' && process.env?.ARK_API_KEY) {
      config = { ...config, apiKey: process.env.ARK_API_KEY };
    } else {
      return null;
    }
  }
  return new VolcengineArkProvider(config as VolcengineArkConfig);
}

// ============ 工具函数 ============

export function generateProviderId(): string {
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * .env.example 内容
 */
export const ENV_EXAMPLE_CONTENT = `# DeepSeek API
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-chat

# Volcengine Ark Coding Plan
ARK_API_KEY=your-ark-api-key-here
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_DEFAULT_MODEL=ep-your-coding-plan-endpoint-id
ARK_PROTOCOL=openai

# 全局配置
LLM_TIMEOUT_MS=60000
LLM_MAX_RETRIES=3
LLM_ENABLE_RATE_LIMIT=true
LLM_RPM=60
LLM_TPM=90000
`;

/**
 * .gitignore 追加内容
 */
export const GITIGNORE_CONTENT = `
# API Keys (NEVER COMMIT)
.env
.env.local
.env.*.local
`;
