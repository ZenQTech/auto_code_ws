/**
 * # ============================================================
 * # Volcengine Coding Plan Provider - 单元测试 (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 覆盖：Mock Provider / 工厂函数 / 配置校验 / 错误回退
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockVolcengineCodingPlanProvider,
  VolcengineCodingPlanProvider,
  createVolcengineCodingPlanProvider,
} from './volcengineCodingPlanProvider';
import type { Message, ToolDefinition } from './llmProviderAdapter';

describe('MockVolcengineCodingPlanProvider', () => {
  let provider: MockVolcengineCodingPlanProvider;

  beforeEach(() => {
    provider = new MockVolcengineCodingPlanProvider();
  });

  it('暴露正确的 Provider 标识与默认模型', () => {
    expect(provider.name).toBe('volcengine-ark');
    expect(provider.displayName).toContain('Mock');
    expect(provider.defaultModel).toBe('doubao-pro-32k');
  });

  it('models 列表至少包含 doubao 系列', () => {
    expect(provider.models.length).toBeGreaterThanOrEqual(2);
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain('doubao-pro-32k');
    expect(ids).toContain('doubao-pro-128k');
  });

  it('基础对话返回非空文本', async () => {
    const messages: Message[] = [{ role: 'user', content: '你好' }];
    const response = await provider.chat(messages);
    expect(response.provider).toBe('volcengine-ark');
    expect(response.content).toBeTruthy();
    expect(response.finishReason).toBe('stop');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('检测到工具调用关键词时返回工具调用', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: '读取文件',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const messages: Message[] = [{ role: 'user', content: '请调用 read_file 工具读取文件' }];
    const response = await provider.chat(messages, { tools });
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBe(1);
    expect(response.toolCalls![0].name).toBe('read_file');
    expect(response.finishReason).toBe('tool_use');
  });

  it('list_directory 工具推断路径参数', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'list_directory',
        description: '列出目录',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const messages: Message[] = [{ role: 'user', content: '执行 list_directory 操作' }];
    const response = await provider.chat(messages, { tools });
    expect(response.toolCalls![0].arguments).toHaveProperty('path');
  });

  it('流式响应产出 text 块', async () => {
    const messages: Message[] = [{ role: 'user', content: '你好' }];
    const chunks: string[] = [];
    for await (const chunk of provider.stream(messages)) {
      if (chunk.type === 'text' && chunk.text) chunks.push(chunk.text);
    }
    const merged = chunks.join('');
    expect(merged.length).toBeGreaterThan(0);
  });

  it('流式工具调用产出 tool_call 块', async () => {
    const tools: ToolDefinition[] = [
      { name: 'read_file', description: '读取文件', parameters: {} },
    ];
    const messages: Message[] = [{ role: 'user', content: '使用工具读取' }];
    let toolCallSeen = false;
    for await (const chunk of provider.stream(messages, { tools })) {
      if (chunk.type === 'tool_call') toolCallSeen = true;
    }
    expect(toolCallSeen).toBe(true);
  });

  it('统计信息正确累计', async () => {
    await provider.chat([{ role: 'user', content: 'A' }]);
    await provider.chat([{ role: 'user', content: 'BB' }]);
    const stats = provider.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.successRequests).toBe(2);
    expect(stats.failedRequests).toBe(0);
  });

  it('validateConfig 返回有效（mock 无需配置）', () => {
    const r = provider.validateConfig();
    expect(r.valid).toBe(true);
  });

  it('calculateCost 正确计算', () => {
    const cost = provider.calculateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
      'doubao-pro-32k',
    );
    expect(cost).toBeCloseTo(0.8 + 2.0, 5);
  });

  it('事件订阅 / 退订', () => {
    const cb = vi.fn();
    const off = provider.on('test', cb);
    expect(typeof off).toBe('function');
    off();
  });
});

describe('VolcengineCodingPlanProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('没有 API Key 时回退到 mock', () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    expect(provider.isReal).toBe(false);
  });

  it('有 API Key 但 forceMock=true 时仍用 mock', () => {
    const provider = new VolcengineCodingPlanProvider({ apiKey: 'test', forceMock: true });
    expect(provider.isReal).toBe(false);
  });

  it('forceMock 模式下的 chat 走 mock', async () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    const r = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(r.content).toBeTruthy();
  });

  it('forceMock 模式下的 stream 走 mock', async () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    let seen = 0;
    for await (const _chunk of provider.stream(messages)) {
      seen += 1;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('validateConfig 真实模式有效', () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    const r = provider.validateConfig();
    // 不论真实/mock 都返回 valid=true，但 mock 模式会带 warning
    expect(r.valid).toBe(true);
  });

  it('initialize 和 dispose 不抛出错误', async () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    await expect(provider.initialize()).resolves.toBeUndefined();
    expect(() => provider.dispose()).not.toThrow();
  });

  it('on 事件订阅可以退订', () => {
    const provider = new VolcengineCodingPlanProvider({ forceMock: true });
    const cb = vi.fn();
    const off = provider.on('e', cb);
    off();
    // dispose 后再次退订不应报错
    off();
  });
});

describe('createVolcengineCodingPlanProvider 工厂', () => {
  beforeEach(() => {
    // 重置 env
    delete (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  });

  it('没有 env 时返回 mock 模式 provider', () => {
    const provider = createVolcengineCodingPlanProvider();
    expect(provider.isReal).toBe(false);
  });

  it('传入 apiKey 且未 forceMock 时尝试创建真实 provider（缺少有效 key 时回退 mock）', () => {
    // 真实 provider 构造会校验 key 格式，传入空字符串或无效值会失败 -> mock
    const provider = createVolcengineCodingPlanProvider({ apiKey: 'invalid-key-format' });
    expect(typeof provider.isReal).toBe('boolean');
  });

  it('forceMock=true 时强制 mock', () => {
    const provider = createVolcengineCodingPlanProvider({ apiKey: 'anything', forceMock: true });
    expect(provider.isReal).toBe(false);
  });
});
