/**
 * # LLM Provider Adapter - 单元测试
 * # Cycle 36 G36-01
 * # 覆盖：类型定义、错误类、工具函数、Mock Provider、各 Provider、Registry、UsageTracker、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LLMProviderRegistry,
  MockProvider,
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  UsageTracker,
  LLMError,
  MODEL_PRICING,
  PROVIDER_MODELS,
  DEFAULT_RETRY_CONFIG,
  generateId,
  estimateTokens,
  calculateCost,
  isRetryableError,
  sleep,
  withRetry,
  convertMessagesToAnthropic,
  convertMessagesToOpenAI,
  createProvider,
  getDefaultLLMProviderRegistry,
  resetDefaultLLMProviderRegistry,
  getDefaultUsageTracker,
  resetDefaultUsageTracker,
} from './llmProviderAdapter';

describe('LLM Provider Adapter - 类型与常量', () => {
  it('MODEL_PRICING 包含主流模型', () => {
    expect(MODEL_PRICING['claude-sonnet-4-5']).toBeDefined();
    expect(MODEL_PRICING['gpt-4o']).toBeDefined();
    expect(MODEL_PRICING['llama3.2']).toBeDefined();
  });

  it('PROVIDER_MODELS 包含 4 个 Provider', () => {
    expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.openai.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.ollama.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.mock.length).toBeGreaterThan(0);
  });

  it('DEFAULT_RETRY_CONFIG 配置正确', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
  });
});

describe('LLM Provider Adapter - 工具函数', () => {
  it('generateId 生成唯一 ID', () => {
    const id1 = generateId('test');
    const id2 = generateId('test');
    expect(id1).toMatch(/^test-/);
    expect(id2).toMatch(/^test-/);
    expect(id1).not.toBe(id2);
  });

  it('estimateTokens 估算', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(100))).toBeGreaterThan(20);
  });

  it('calculateCost 计算成本', () => {
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    const cost = calculateCost(usage, 'claude-sonnet-4-5');
    expect(cost).toBeGreaterThan(0);
  });

  it('calculateCost 未知模型返回 0', () => {
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    expect(calculateCost(usage, 'unknown-model')).toBe(0);
  });

  it('isRetryableError 判断 LLMError', () => {
    const retryable = new LLMError('mock', 'rate_limit', true);
    const notRetryable = new LLMError('mock', 'auth', false);
    expect(isRetryableError(retryable)).toBe(true);
    expect(isRetryableError(notRetryable)).toBe(false);
    expect(isRetryableError(new Error('test'))).toBe(false);
  });

  it('sleep 等待', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('withRetry 成功不重试', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('withRetry 失败重试到成功', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new LLMError('mock', 'rate_limit', true);
        }
        return 'ok';
      },
      { maxRetries: 3, initialDelayMs: 10 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('withRetry 不可重试错误立即抛出', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new LLMError('mock', 'auth', false);
      })
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('withRetry AbortSignal 取消', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRetry(
        async () => 'ok',
        {},
        controller.signal
      )
    ).rejects.toThrow();
  });

  it('convertMessagesToAnthropic 转换', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Hello' },
    ];
    const result = convertMessagesToAnthropic(messages);
    expect(result.system).toBe('You are helpful');
    expect(result.messages).toHaveLength(1);
  });

  it('convertMessagesToOpenAI 转换', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Hello' },
    ];
    const result = convertMessagesToOpenAI(messages);
    expect(result).toHaveLength(2);
  });
});

describe('LLM Provider Adapter - LLMError', () => {
  it('构造错误对象', () => {
    const err = new LLMError('anthropic', 'rate_limit', true, 429, 'Too many requests');
    expect(err.name).toBe('LLMError');
    expect(err.provider).toBe('anthropic');
    expect(err.type).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Too many requests');
  });

  it('默认错误消息', () => {
    const err = new LLMError('openai', 'auth', false, 401);
    expect(err.message).toContain('auth');
  });
});

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  it('初始化', () => {
    expect(provider.name).toBe('mock');
    expect(provider.displayName).toBe('Mock Provider');
    expect(provider.defaultModel).toBe('mock-fast');
  });

  it('validateConfig 始终有效', () => {
    const result = provider.validateConfig();
    expect(result.valid).toBe(true);
  });

  it('countTokens 估算', () => {
    expect(provider.countTokens('hello world')).toBeGreaterThan(0);
  });

  it('calculateCost 本地免费', () => {
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    expect(provider.calculateCost(usage, 'mock-fast')).toBe(0);
  });

  it('chat 返回响应', async () => {
    const response = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(response.id).toBeDefined();
    expect(response.provider).toBe('mock');
    expect(response.content).toBeTruthy();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('chat 匹配预置响应', async () => {
    const response = await provider.chat([{ role: 'user', content: 'tell me a poem' }]);
    expect(response.content).toContain('Roses are red');
  });

  it('stream 流式输出', async () => {
    const stream = provider.stream([{ role: 'user', content: 'hello' }]);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      if (chunk.type === 'text' && chunk.text) {
        chunks.push(chunk.text);
      }
      if (chunk.type === 'done') break;
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('事件订阅', () => {
    const events: any[] = [];
    provider.on('chat-completed', (d) => events.push(d));
    return provider.chat([{ role: 'user', content: 'test' }]).then(() => {
      expect(events.length).toBe(1);
    });
  });

  it('setMockResponse 设置响应', async () => {
    provider.setMockResponse('foo', 'bar response');
    const response = await provider.chat([{ role: 'user', content: 'say foo' }]);
    expect(response.content).toBe('bar response');
  });

  it('setResponseDelay 设置延迟', async () => {
    provider.setResponseDelay(50);
    const start = Date.now();
    await provider.chat([{ role: 'user', content: 'test' }]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('dispose 清理', () => {
    provider.dispose();
    expect(() => provider.chat([{ role: 'user', content: 'test' }])).not.toThrow();
  });
});

describe('AnthropicProvider', () => {
  it('初始化', () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    expect(provider.name).toBe('anthropic');
    expect(provider.displayName).toBe('Anthropic Claude');
    expect(provider.defaultModel).toBe('claude-sonnet-4-5');
  });

  it('validateConfig 缺少 API key 失败', () => {
    const provider = new AnthropicProvider({});
    const result = provider.validateConfig();
    expect(result.valid).toBe(false);
  });

  it('chat 缺 API key 抛错', async () => {
    const provider = new AnthropicProvider({});
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow();
  });

  it('chat 有 API key 返回响应', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const response = await provider.chat([{ role: 'user', content: 'test' }]);
    expect(response.provider).toBe('anthropic');
    expect(response.content).toBeTruthy();
  });

  it('calculateCost 计算', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' });
    const usage = { inputTokens: 1000000, outputTokens: 500000, totalTokens: 1500000 };
    const cost = provider.calculateCost(usage);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('OpenAIProvider', () => {
  it('初始化', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' });
    expect(provider.name).toBe('openai');
    expect(provider.displayName).toBe('OpenAI');
    expect(provider.defaultModel).toBe('gpt-4o-mini');
  });

  it('chat 响应', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test' });
    const response = await provider.chat([{ role: 'user', content: 'test' }]);
    expect(response.provider).toBe('openai');
  });

  it('calculateCost 计算', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' });
    const usage = { inputTokens: 1000000, outputTokens: 500000, totalTokens: 1500000 };
    const cost = provider.calculateCost(usage, 'gpt-4o');
    expect(cost).toBeGreaterThan(0);
  });
});

describe('OllamaProvider', () => {
  it('初始化', () => {
    const provider = new OllamaProvider({});
    expect(provider.name).toBe('ollama');
    expect(provider.defaultModel).toBe('llama3.2');
  });

  it('getBaseUrl', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://custom:1234' });
    expect(provider.getBaseUrl()).toBe('http://custom:1234');
  });

  it('chat 响应', async () => {
    const provider = new OllamaProvider({});
    const response = await provider.chat([{ role: 'user', content: 'test' }]);
    expect(response.provider).toBe('ollama');
  });

  it('calculateCost 本地免费', () => {
    const provider = new OllamaProvider({});
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    expect(provider.calculateCost(usage, 'llama3.2')).toBe(0);
  });
});

describe('LLMProviderRegistry', () => {
  let registry: LLMProviderRegistry;

  beforeEach(() => {
    registry = new LLMProviderRegistry();
  });

  it('注册 Provider', () => {
    const mock = new MockProvider();
    registry.register('mock', mock);
    expect(registry.has('mock')).toBe(true);
    expect(registry.get('mock')).toBe(mock);
  });

  it('注销 Provider', () => {
    registry.register('mock', new MockProvider());
    expect(registry.unregister('mock')).toBe(true);
    expect(registry.has('mock')).toBe(false);
  });

  it('list 获取所有 Provider', () => {
    registry.register('mock', new MockProvider());
    registry.register('ollama', new OllamaProvider({}));
    expect(registry.list().length).toBe(2);
  });

  it('设置默认 Provider', () => {
    registry.register('mock', new MockProvider());
    registry.setDefault('mock');
    expect(registry.getDefaultName()).toBe('mock');
  });

  it('setDefault 未注册抛错', () => {
    expect(() => registry.setDefault('mock')).toThrow();
  });

  it('getDefault 未设置抛错', () => {
    expect(() => registry.getDefault()).toThrow();
  });

  it('getDefault 获取默认', () => {
    const mock = new MockProvider();
    registry.register('mock', mock);
    registry.setDefault('mock');
    expect(registry.getDefault()).toBe(mock);
  });

  it('事件订阅', () => {
    const events: any[] = [];
    registry.on('provider-registered', (d) => events.push(d));
    registry.register('mock', new MockProvider());
    expect(events.length).toBe(1);
  });

  it('取消订阅', () => {
    const events: any[] = [];
    const unsub = registry.on('provider-registered', (d) => events.push(d));
    unsub();
    registry.register('mock', new MockProvider());
    expect(events.length).toBe(0);
  });
});

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it('记录使用', () => {
    tracker.record('mock', 'mock-fast', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0.001);
    expect(tracker.getRecords().length).toBe(1);
  });

  it('getTotal 汇总', () => {
    tracker.record('mock', 'mock-fast', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0.001);
    tracker.record('mock', 'mock-fast', { inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 0.002);
    const total = tracker.getTotal();
    expect(total.totalInputTokens).toBe(300);
    expect(total.totalOutputTokens).toBe(150);
    expect(total.totalTokens).toBe(450);
    expect(total.totalCost).toBeCloseTo(0.003);
    expect(total.callCount).toBe(2);
  });

  it('getByProvider 按 Provider 分组', () => {
    tracker.record('mock', 'mock-fast', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0);
    tracker.record('ollama', 'llama3.2', { inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 0);
    const byProvider = tracker.getByProvider();
    expect(byProvider.mock.callCount).toBe(1);
    expect(byProvider.ollama.callCount).toBe(1);
  });

  it('getByModel 按模型分组', () => {
    tracker.record('mock', 'mock-fast', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0);
    tracker.record('mock', 'mock-smart', { inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 0);
    const byModel = tracker.getByModel();
    expect(byModel['mock-fast'].callCount).toBe(1);
    expect(byModel['mock-smart'].callCount).toBe(1);
  });

  it('reset 清空', () => {
    tracker.record('mock', 'mock-fast', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0);
    tracker.reset();
    expect(tracker.getRecords().length).toBe(0);
  });
});

describe('createProvider 工厂', () => {
  it('创建 Mock Provider', () => {
    const p = createProvider('mock');
    expect(p.name).toBe('mock');
  });

  it('创建 Anthropic Provider', () => {
    const p = createProvider('anthropic', { apiKey: 'test' });
    expect(p.name).toBe('anthropic');
  });

  it('创建 OpenAI Provider', () => {
    const p = createProvider('openai', { apiKey: 'test' });
    expect(p.name).toBe('openai');
  });

  it('创建 Ollama Provider', () => {
    const p = createProvider('ollama');
    expect(p.name).toBe('ollama');
  });

  it('未知 Provider 抛错', () => {
    expect(() => createProvider('unknown' as any)).toThrow();
  });
});

describe('全局单例', () => {
  beforeEach(() => {
    resetDefaultLLMProviderRegistry();
    resetDefaultUsageTracker();
  });

  it('getDefaultLLMProviderRegistry 单例', () => {
    const r1 = getDefaultLLMProviderRegistry();
    const r2 = getDefaultLLMProviderRegistry();
    expect(r1).toBe(r2);
  });

  it('默认注册 Mock Provider', () => {
    const r = getDefaultLLMProviderRegistry();
    expect(r.has('mock')).toBe(true);
  });

  it('getDefaultUsageTracker 单例', () => {
    const t1 = getDefaultUsageTracker();
    const t2 = getDefaultUsageTracker();
    expect(t1).toBe(t2);
  });

  it('resetDefaultLLMProviderRegistry', () => {
    const r1 = getDefaultLLMProviderRegistry();
    resetDefaultLLMProviderRegistry();
    const r2 = getDefaultLLMProviderRegistry();
    expect(r1).not.toBe(r2);
  });
});
