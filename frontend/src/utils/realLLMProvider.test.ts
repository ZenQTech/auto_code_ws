/**
 * # RealLLMProvider - 单元测试
 * # Cycle 37 G37-04
 * # 注意：真实 API 调用需要环境变量，使用 Mock fetch 测试
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DeepSeekProvider,
  VolcengineArkProvider,
  LLMError,
  calculateRetryDelay,
  isLLMErrorRetryable,
  maskApiKey,
  httpStatusToLLMErrorCode,
  fetchWithRetry,
  toOpenAIMessages,
  fromOpenAITools,
  fromOpenAIResponse,
  parseSSEStream,
  DEEPSEEK_MODELS,
  ARK_CODING_PLAN_MODELS,
  loadProviderConfigsFromEnv,
  validateProviderConfigs,
  createDeepSeekProvider,
  createVolcengineArkProvider,
  ENV_EXAMPLE_CONTENT,
  GITIGNORE_CONTENT,
  DEFAULT_RETRY_OPTIONS,
  DeepSeekConfig,
  VolcengineArkConfig,
} from './realLLMProvider';
import { Message, ToolDefinition, TokenUsage } from './llmProviderAdapter';

// ============ Mock fetch ============

const originalFetch = global.fetch;

function mockFetchResponse(body: any, status: number = 200, contentType: string = 'application/json') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: (k: string) => k.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  });
}

describe('工具函数', () => {
  it('maskApiKey 短 key', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('abc')).toBe('***');
  });

  it('maskApiKey 长 key', () => {
    const masked = maskApiKey('sk-1234567890abcdef');
    expect(masked).toContain('***');
    expect(masked).toMatch(/cdef$/);
    expect(masked.length).toBeLessThan(20);
    expect(masked.length).toBeGreaterThan(8);
  });

  it('calculateRetryDelay 指数退避', () => {
    const d0 = calculateRetryDelay(0, DEFAULT_RETRY_OPTIONS);
    const d1 = calculateRetryDelay(1, DEFAULT_RETRY_OPTIONS);
    const d2 = calculateRetryDelay(2, DEFAULT_RETRY_OPTIONS);
    expect(d0).toBeGreaterThanOrEqual(900);
    expect(d1).toBeGreaterThanOrEqual(d0 * 1.8);
    expect(d2).toBeGreaterThanOrEqual(d1 * 1.8);
  });

  it('calculateRetryDelay 上限', () => {
    const d = calculateRetryDelay(100, DEFAULT_RETRY_OPTIONS);
    expect(d).toBeLessThanOrEqual(DEFAULT_RETRY_OPTIONS.maxDelayMs * 1.1);
  });

  it('isLLMErrorRetryable', () => {
    expect(isLLMErrorRetryable('RATE_LIMIT', DEFAULT_RETRY_OPTIONS)).toBe(true);
    expect(isLLMErrorRetryable('SERVER_ERROR', DEFAULT_RETRY_OPTIONS)).toBe(true);
    expect(isLLMErrorRetryable('NETWORK_ERROR', DEFAULT_RETRY_OPTIONS)).toBe(true);
    expect(isLLMErrorRetryable('TIMEOUT', DEFAULT_RETRY_OPTIONS)).toBe(true);
    expect(isLLMErrorRetryable('AUTHENTICATION_ERROR', DEFAULT_RETRY_OPTIONS)).toBe(false);
    expect(isLLMErrorRetryable('INVALID_REQUEST', DEFAULT_RETRY_OPTIONS)).toBe(false);
  });

  it('httpStatusToLLMErrorCode', () => {
    expect(httpStatusToLLMErrorCode(401)).toBe('AUTHENTICATION_ERROR');
    expect(httpStatusToLLMErrorCode(403)).toBe('AUTHENTICATION_ERROR');
    expect(httpStatusToLLMErrorCode(404)).toBe('MODEL_NOT_FOUND');
    expect(httpStatusToLLMErrorCode(429)).toBe('RATE_LIMIT');
    expect(httpStatusToLLMErrorCode(400)).toBe('INVALID_REQUEST');
    expect(httpStatusToLLMErrorCode(413)).toBe('CONTEXT_LENGTH_EXCEEDED');
    expect(httpStatusToLLMErrorCode(500)).toBe('SERVER_ERROR');
    expect(httpStatusToLLMErrorCode(503)).toBe('SERVER_ERROR');
  });
});

describe('LLMError', () => {
  it('创建错误', () => {
    const err = new LLMError('AUTHENTICATION_ERROR', 'Invalid API key', 401);
    expect(err.code).toBe('AUTHENTICATION_ERROR');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid API key');
    expect(err.name).toBe('LLMError');
  });
});

describe('OpenAI 协议转换', () => {
  it('toOpenAIMessages 简单消息', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ];
    const result = toOpenAIMessages(messages);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('You are helpful');
  });

  it('toOpenAIMessages tool 消息', () => {
    const messages: Message[] = [
      { role: 'tool', content: 'result', toolCallId: 'call_1' },
    ];
    const result = toOpenAIMessages(messages);
    expect(result[0].tool_call_id).toBe('call_1');
  });

  it('toOpenAIMessages 多模态', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '描述' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(Array.isArray(result[0].content)).toBe(true);
  });

  it('fromOpenAITools 空', () => {
    expect(fromOpenAITools(undefined)).toBeUndefined();
    expect(fromOpenAITools([])).toBeUndefined();
  });

  it('fromOpenAITools 有工具', () => {
    const tools: ToolDefinition[] = [
      { name: 't1', description: 'd', parameters: { type: 'object', properties: {} } },
    ];
    const result = fromOpenAITools(tools);
    expect(result?.length).toBe(1);
    expect(result?.[0].type).toBe('function');
  });

  it('fromOpenAIResponse 完整响应', () => {
    const resp = {
      id: 'chatcmpl-1',
      model: 'deepseek-chat',
      choices: [{
        message: { role: 'assistant', content: 'Hello' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = fromOpenAIResponse(resp, 'deepseek', performance.now() - 100);
    expect(result.content).toBe('Hello');
    expect(result.usage.totalTokens).toBe(15);
    expect(result.finishReason).toBe('stop');
    expect(result.provider).toBe('deepseek');
  });

  it('fromOpenAIResponse 工具调用', () => {
    const resp = {
      id: 'chatcmpl-1',
      model: 'deepseek-chat',
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [
            { id: 'c1', function: { name: 't1', arguments: '{"x":1}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = fromOpenAIResponse(resp, 'deepseek', performance.now());
    expect(result.toolCalls?.[0].name).toBe('t1');
    expect(result.toolCalls?.[0].arguments.x).toBe(1);
  });

  it('fromOpenAIResponse thinking content (DeepSeek Reasoner)', () => {
    const resp = {
      id: 'chatcmpl-1',
      model: 'deepseek-reasoner',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Final answer',
          reasoning_content: 'Thinking process...',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const result = fromOpenAIResponse(resp, 'deepseek', performance.now());
    expect(result.content).toBe('Final answer');
    expect((result as any).thinking).toBe('Thinking process...');
  });
});

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;
  const validConfig: DeepSeekConfig = {
    apiKey: 'sk-test-1234567890',
    baseURL: 'https://api.deepseek.com/v1',
  };

  beforeEach(() => {
    provider = new DeepSeekProvider(validConfig);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('name 和 supportedModels', () => {
    expect(provider.name).toBe('deepseek');
    expect(provider.supportedModels).toContain('deepseek-chat');
    expect(provider.supportedModels).toContain('deepseek-reasoner');
  });

  it('缺少 apiKey 抛出错误', () => {
    expect(() => new DeepSeekProvider({ apiKey: '' })).toThrow(LLMError);
  });

  it('chat 成功', async () => {
    global.fetch = mockFetchResponse({
      id: 'chatcmpl-1',
      model: 'deepseek-chat',
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    const response = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(response.content).toBe('Hi');
    expect(response.usage.totalTokens).toBe(8);
  });

  it('chat 带 tools', async () => {
    global.fetch = mockFetchResponse({
      id: 'chatcmpl-1',
      model: 'deepseek-chat',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    await provider.chatWithTools(
      [{ role: 'user', content: 'test' }],
      [{ name: 't1', description: 'd', parameters: { type: 'object', properties: {} } }]
    );
    expect(global.fetch).toHaveBeenCalled();
  });

  it('chat 401 错误', async () => {
    global.fetch = mockFetchResponse({ error: 'Invalid' }, 401);
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(LLMError);
  });

  it('chat 429 限流（非重试场景）', async () => {
    const testProvider = new DeepSeekProvider({
      ...validConfig,
      maxRetries: 0, // 关闭重试
    });
    global.fetch = mockFetchResponse({ error: 'Rate limit' }, 429);
    await expect(testProvider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(LLMError);
  });

  it('embed 不支持', async () => {
    await expect(provider.embed('test')).rejects.toThrow(LLMError);
  });

  it('getModelInfo', () => {
    const info = provider.getModelInfo('deepseek-chat');
    expect(info?.contextWindow).toBe(32000);
  });

  it('calculateCost', () => {
    const cost = provider.calculateCost({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(0.42, 2);
  });

  it('calculateCost 未知模型返回 0', () => {
    const cost = provider.calculateCost({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    }, 'unknown-model');
    expect(cost).toBe(0);
  });

  it('thinkThenAnswer', async () => {
    global.fetch = mockFetchResponse({
      id: 'chatcmpl-1',
      model: 'deepseek-reasoner',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Final',
          reasoning_content: 'Thinking...',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const result = await provider.thinkThenAnswer('solve this');
    expect(result.thinking).toBe('Thinking...');
    expect(result.answer).toBe('Final');
  });
});

describe('VolcengineArkProvider', () => {
  let provider: VolcengineArkProvider;
  const validConfig: VolcengineArkConfig = {
    apiKey: 'test-ark-key',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  };

  beforeEach(() => {
    provider = new VolcengineArkProvider(validConfig);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('name 和 supportedModels', () => {
    expect(provider.name).toBe('volcengine-ark');
    expect(provider.supportedModels).toContain('doubao-pro-32k');
    expect(provider.supportedModels).toContain('deepseek-v3');
  });

  it('缺少 apiKey 抛出错误', () => {
    expect(() => new VolcengineArkProvider({ apiKey: '' })).toThrow(LLMError);
  });

  it('chat OpenAI 协议', async () => {
    global.fetch = mockFetchResponse({
      id: 'chatcmpl-1',
      model: 'doubao-pro-32k',
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    const response = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(response.content).toBe('Hi');
    expect(response.provider).toBe('volcengine-ark');
  });

  it('chat Anthropic 协议', async () => {
    const anthropicProvider = new VolcengineArkProvider({ ...validConfig, protocol: 'anthropic' });
    global.fetch = mockFetchResponse({
      id: 'msg-1',
      model: 'doubao-pro-32k',
      content: [{ type: 'text', text: 'Anthropic response' }],
      usage: { input_tokens: 5, output_tokens: 3 },
      stop_reason: 'end_turn',
    });
    const response = await anthropicProvider.chat([{ role: 'user', content: 'hello' }]);
    expect(response.content).toBe('Anthropic response');
  });

  it('listCodingPlanModels', () => {
    const models = provider.listCodingPlanModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeDefined();
  });

  it('getEndpointInfo', () => {
    const info = provider.getEndpointInfo('deepseek-v3');
    expect(info?.name).toContain('DeepSeek');
  });

  it('embed', async () => {
    global.fetch = mockFetchResponse({
      data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
    });
    const embeddings = await provider.embed(['text1', 'text2']);
    expect(embeddings.length).toBe(2);
    expect(embeddings[0].length).toBe(3);
  });

  it('calculateCost', () => {
    const cost = provider.calculateCost({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    }, 'doubao-pro-32k');
    expect(cost).toBeCloseTo(2.8, 1);
  });
});

describe('DEEPSEEK_MODELS', () => {
  it('包含主要模型', () => {
    expect(DEEPSEEK_MODELS.length).toBeGreaterThan(0);
    expect(DEEPSEEK_MODELS.find(m => m.id === 'deepseek-chat')).toBeDefined();
    expect(DEEPSEEK_MODELS.find(m => m.id === 'deepseek-reasoner')).toBeDefined();
  });
});

describe('ARK_CODING_PLAN_MODELS', () => {
  it('包含 9 个模型', () => {
    expect(ARK_CODING_PLAN_MODELS.length).toBeGreaterThanOrEqual(6);
    expect(ARK_CODING_PLAN_MODELS.find(m => m.id === 'deepseek-v3')).toBeDefined();
    expect(ARK_CODING_PLAN_MODELS.find(m => m.id === 'kimi-k2')).toBeDefined();
  });
});

describe('配置加载器', () => {
  it('从 process.env 加载', () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      DEEPSEEK_API_KEY: 'sk-test',
      ARK_API_KEY: 'ark-test',
    };
    const configs = loadProviderConfigsFromEnv();
    expect(configs.deepseek?.apiKey).toBe('sk-test');
    expect(configs.volcengineArk?.apiKey).toBe('ark-test');
    process.env = originalEnv;
  });

  it('没有环境变量返回空', () => {
    const originalEnv = process.env;
    process.env = {};
    const configs = loadProviderConfigsFromEnv();
    expect(configs.deepseek).toBeUndefined();
    expect(configs.volcengineArk).toBeUndefined();
    process.env = originalEnv;
  });

  it('validateProviderConfigs', () => {
    const result1 = validateProviderConfigs({
      deepseek: { apiKey: 'sk-test' },
    });
    expect(result1.valid).toBe(true);

    const result2 = validateProviderConfigs({
      deepseek: { apiKey: '' },
    });
    expect(result2.valid).toBe(false);
  });
});

describe('工厂函数', () => {
  it('createDeepSeekProvider 无 key 返回 null', () => {
    const originalEnv = process.env;
    process.env = {};
    expect(createDeepSeekProvider()).toBeNull();
    process.env = originalEnv;
  });

  it('createDeepSeekProvider 有 key 成功', () => {
    const provider = createDeepSeekProvider({ apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
  });

  it('createVolcengineArkProvider 有 key 成功', () => {
    const provider = createVolcengineArkProvider({ apiKey: 'ark-test' });
    expect(provider).toBeInstanceOf(VolcengineArkProvider);
  });
});

describe('环境配置模板', () => {
  it('ENV_EXAMPLE_CONTENT 包含必要变量', () => {
    expect(ENV_EXAMPLE_CONTENT).toContain('DEEPSEEK_API_KEY');
    expect(ENV_EXAMPLE_CONTENT).toContain('ARK_API_KEY');
    expect(ENV_EXAMPLE_CONTENT).toContain('DEEPSEEK_BASE_URL');
  });

  it('GITIGNORE_CONTENT 包含 .env', () => {
    expect(GITIGNORE_CONTENT).toContain('.env');
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('成功响应直接返回', async () => {
    global.fetch = mockFetchResponse({ ok: true });
    const response = await fetchWithRetry('https://api.test/chat', { method: 'GET' });
    expect(response.ok).toBe(true);
  });

  it('401 不重试', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Unauthorized',
        headers: { get: () => null },
        json: async () => ({}),
      };
    });
    await expect(fetchWithRetry('https://api.test/chat', { method: 'GET' }, {
      ...DEFAULT_RETRY_OPTIONS, maxRetries: 2,
    })).rejects.toThrow(LLMError);
    expect(calls).toBe(1); // 不重试
  });

  it('429 重试（无 retry-after）', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        return {
          ok: false,
          status: 429,
          statusText: 'Rate limit',
          text: async () => 'Rate limit',
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => '{}',
        json: async () => ({}),
      };
    });
    const response = await fetchWithRetry('https://api.test/chat', { method: 'GET' }, {
      ...DEFAULT_RETRY_OPTIONS, maxRetries: 3, initialDelayMs: 10,
    });
    expect(response.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
