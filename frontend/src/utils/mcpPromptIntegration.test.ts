/**
 * # ============================================================
 * # MCP Prompt Integration 测试 (v1.0.0 Cycle 40 G40-03)
 * # ============================================================
 * # 覆盖：MCP Prompt 转换、参数校验、插值、注册表、渲染
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makePromptId,
  parsePromptId,
  convertArgument,
  convertMcpPrompt,
  validateArgs,
  interpolate,
  renderPrompt,
  McpPromptRegistry,
  getDefaultMcpPromptRegistry,
  resetDefaultMcpPromptRegistry,
  type HermesPrompt,
  type McpPromptClient,
} from './mcpPromptIntegration';
import type { Prompt, PromptMessage } from './mcpTypes';

// ============ ID 工具 ============

describe('makePromptId', () => {
  it('生成 mcp 格式 ID', () => {
    expect(makePromptId('server1', 'greet')).toBe('mcp:server1::greet');
  });

  it('支持复杂名称', () => {
    expect(makePromptId('svr', 'with spaces')).toBe('mcp:svr::with spaces');
  });
});

describe('parsePromptId', () => {
  it('解析有效 ID', () => {
    const r = parsePromptId('mcp:foo::bar');
    expect(r).toEqual({ serverId: 'foo', promptName: 'bar' });
  });

  it('返回 null 对非 mcp 格式', () => {
    expect(parsePromptId('builtin::test')).toBeNull();
  });

  it('返回 null 对空字符串', () => {
    expect(parsePromptId('')).toBeNull();
  });
});

// ============ 转换层 ============

describe('convertArgument', () => {
  it('完整参数', () => {
    const r = convertArgument({ name: 'x', description: 'd', required: true });
    expect(r).toEqual({ name: 'x', description: 'd', required: true });
  });

  it('默认值', () => {
    const r = convertArgument({ name: 'x' });
    expect(r.required).toBe(false);
  });
});

describe('convertMcpPrompt', () => {
  it('基本转换', () => {
    const mcp: Prompt = { name: 'greet', description: 'A greeting prompt' };
    const hp = convertMcpPrompt(mcp, 'srv1', 'Server 1');
    expect(hp.id).toBe('mcp:srv1::greet');
    expect(hp.name).toBe('greet');
    expect(hp.description).toBe('A greeting prompt');
    expect(hp.source).toBe('mcp:srv1');
    expect(hp.metadata.serverName).toBe('Server 1');
    expect(hp.tags).toContain('mcp');
    expect(hp.tags).toContain('srv1');
  });

  it('带参数', () => {
    const mcp: Prompt = {
      name: 'greet',
      arguments: [{ name: 'lang', required: true }],
    };
    const hp = convertMcpPrompt(mcp, 'srv', 'S');
    expect(hp.arguments.length).toBe(1);
    expect(hp.arguments[0].required).toBe(true);
  });

  it('无参数默认为空数组', () => {
    const mcp: Prompt = { name: 'p' };
    const hp = convertMcpPrompt(mcp, 's', 'S');
    expect(hp.arguments).toEqual([]);
  });
});

// ============ 参数校验 ============

describe('validateArgs', () => {
  const prompt: HermesPrompt = {
    id: 'mcp:s::p',
    name: 'p',
    arguments: [
      { name: 'required_arg', required: true },
      { name: 'optional_arg', required: false },
      { name: 'enum_arg', required: false, enum: ['a', 'b', 'c'] },
      { name: 'pattern_arg', required: false, pattern: '^\\d+$' },
    ],
    source: 'mcp:s',
    tags: [],
    createdAt: 0,
    metadata: { serverName: 'S' },
  };

  it('无缺失', () => {
    const r = validateArgs(prompt, { required_arg: 'x' });
    expect(r.missingArgs).toEqual([]);
    expect(r.invalidArgs).toEqual([]);
  });

  it('必填参数缺失', () => {
    const r = validateArgs(prompt, {});
    expect(r.missingArgs).toContain('required_arg');
  });

  it('必填参数空字符串视为缺失', () => {
    const r = validateArgs(prompt, { required_arg: '' });
    expect(r.missingArgs).toContain('required_arg');
  });

  it('enum 校验失败', () => {
    const r = validateArgs(prompt, { required_arg: 'x', enum_arg: 'z' });
    expect(r.invalidArgs.some((a) => a.name === 'enum_arg')).toBe(true);
  });

  it('enum 校验通过', () => {
    const r = validateArgs(prompt, { required_arg: 'x', enum_arg: 'a' });
    expect(r.invalidArgs).toEqual([]);
  });

  it('pattern 校验失败', () => {
    const r = validateArgs(prompt, { required_arg: 'x', pattern_arg: 'abc' });
    expect(r.invalidArgs.some((a) => a.name === 'pattern_arg')).toBe(true);
  });

  it('pattern 校验通过', () => {
    const r = validateArgs(prompt, { required_arg: 'x', pattern_arg: '123' });
    expect(r.invalidArgs).toEqual([]);
  });
});

// ============ 插值 ============

describe('interpolate', () => {
  it('替换 args.*', () => {
    expect(interpolate('Hello ${args.name}!', { args: { name: 'Alice' } })).toBe('Hello Alice!');
  });

  it('未定义参数保持原样', () => {
    expect(interpolate('Hi ${args.missing}', { args: {} })).toBe('Hi ${args.missing}');
  });

  it('替换 metadata.user', () => {
    expect(
      interpolate('user=${metadata.user}', { args: {}, metadata: { user: 'bob' } }),
    ).toBe('user=bob');
  });

  it('替换 metadata.now', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(
      interpolate('now=${metadata.now}', { args: {}, metadata: { now } }),
    ).toBe('now=2026-01-01T00:00:00.000Z');
  });

  it('替换 metadata.env.KEY', () => {
    expect(
      interpolate('env=${metadata.env.PATH}', {
        args: {},
        metadata: { env: { PATH: '/usr/bin' } },
      }),
    ).toBe('env=/usr/bin');
  });

  it('多个变量', () => {
    const r = interpolate('${args.a}-${args.b}', { args: { a: '1', b: '2' } });
    expect(r).toBe('1-2');
  });

  it('不匹配模式', () => {
    expect(interpolate('${unknown.x}', { args: {} })).toBe('${unknown.x}');
  });
});

// ============ 渲染层 ============

describe('renderPrompt', () => {
  const prompt: HermesPrompt = {
    id: 'mcp:s::greet',
    name: 'greet',
    arguments: [{ name: 'name', required: true }],
    source: 'mcp:s',
    tags: [],
    createdAt: 0,
    metadata: { serverName: 'S' },
  };

  it('渲染成功', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn(),
      getPrompt: vi.fn().mockResolvedValue([
        {
          role: 'user',
          content: { type: 'text', text: 'Hello ${args.name}!' },
        },
      ] as PromptMessage[]),
    };
    const r = await renderPrompt(prompt, client, { args: { name: 'Alice' } });
    expect(r.missingArgs).toEqual([]);
    expect(r.invalidArgs).toEqual([]);
    expect(r.messages.length).toBe(1);
    expect((r.messages[0].content as { text: string }).text).toBe('Hello Alice!');
  });

  it('缺失必填参数', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn(),
      getPrompt: vi.fn(),
    };
    const r = await renderPrompt(prompt, client, { args: {} });
    expect(r.missingArgs).toContain('name');
    expect(r.messages).toEqual([]);
  });

  it('客户端错误抛出', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn(),
      getPrompt: vi.fn().mockRejectedValue(new Error('network fail')),
    };
    await expect(renderPrompt(prompt, client, { args: { name: 'x' } })).rejects.toThrow('network fail');
  });

  it('使用 metadata 插值', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn(),
      getPrompt: vi.fn().mockResolvedValue([
        { role: 'user', content: { type: 'text', text: 'User: ${metadata.user}' } },
      ]),
    };
    const r = await renderPrompt(prompt, client, {
      args: { name: 'x' },
      metadata: { user: 'alice' },
    });
    expect((r.messages[0].content as { text: string }).text).toBe('User: alice');
  });
});

// ============ 注册表 ============

describe('McpPromptRegistry', () => {
  let registry: McpPromptRegistry;
  beforeEach(() => {
    registry = new McpPromptRegistry();
  });
  afterEach(() => {
    registry.clear();
  });

  it('初始为空', () => {
    expect(registry.list()).toEqual([]);
    expect(registry.stats().total).toBe(0);
  });

  it('register 添加提示词', () => {
    const p: HermesPrompt = {
      id: 'mcp:s::p1',
      name: 'p1',
      arguments: [],
      source: 'mcp:s',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S' },
    };
    registry.register(p);
    expect(registry.get('mcp:s::p1')).toEqual(p);
  });

  it('unregister 移除', () => {
    registry.register({
      id: 'mcp:s::p',
      name: 'p',
      arguments: [],
      source: 'mcp:s',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S' },
    });
    expect(registry.unregister('mcp:s::p')).toBe(true);
    expect(registry.get('mcp:s::p')).toBeNull();
  });

  it('unregister 不存在的返回 false', () => {
    expect(registry.unregister('mcp:s::none')).toBe(false);
  });

  it('clear 清空', () => {
    registry.register({
      id: 'a',
      name: 'a',
      arguments: [],
      source: 'x',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  it('listByServer', () => {
    registry.register({
      id: 'mcp:s1::a',
      name: 'a',
      arguments: [],
      source: 'mcp:s1',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S1' },
    });
    registry.register({
      id: 'mcp:s2::b',
      name: 'b',
      arguments: [],
      source: 'mcp:s2',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S2' },
    });
    expect(registry.listByServer('s1').length).toBe(1);
  });

  it('listByTag', () => {
    registry.register({
      id: 'a',
      name: 'a',
      arguments: [],
      source: 'x',
      tags: ['code', 'test'],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    registry.register({
      id: 'b',
      name: 'b',
      arguments: [],
      source: 'x',
      tags: ['docs'],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    expect(registry.listByTag('code').length).toBe(1);
  });

  it('search', () => {
    registry.register({
      id: 'a',
      name: 'greet_user',
      description: 'Greet a user',
      arguments: [],
      source: 'x',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    expect(registry.search('greet').length).toBe(1);
    expect(registry.search('user').length).toBe(1);
    expect(registry.search('xxx').length).toBe(0);
  });

  it('subscribe 触发事件', () => {
    const events: string[] = [];
    registry.subscribe((event, id) => {
      events.push(`${event}:${id}`);
    });
    registry.register({
      id: 'a',
      name: 'a',
      arguments: [],
      source: 'x',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    registry.unregister('a');
    expect(events).toEqual(['added:a', 'removed:a']);
  });

  it('subscribe 返回 unsubscribe', () => {
    const listener = vi.fn();
    const unsub = registry.subscribe(listener);
    unsub();
    registry.register({
      id: 'a',
      name: 'a',
      arguments: [],
      source: 'x',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'X' },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('registerClient + loadFromServer', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn().mockResolvedValue([
        { name: 'a' },
        { name: 'b' },
      ] as Prompt[]),
      getPrompt: vi.fn(),
    };
    registry.registerClient('srv', client);
    const loaded = await registry.loadFromServer('srv', 'My Server');
    expect(loaded.length).toBe(2);
    expect(registry.list().length).toBe(2);
    expect(client.listPrompts).toHaveBeenCalled();
  });

  it('loadFromServer 客户端未注册抛出', async () => {
    await expect(registry.loadFromServer('unknown', 'X')).rejects.toThrow();
  });

  it('unregisterClient 移除所有相关提示词', () => {
    registry.register({
      id: 'mcp:s1::a',
      name: 'a',
      arguments: [],
      source: 'mcp:s1',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S1' },
    });
    registry.register({
      id: 'mcp:s2::b',
      name: 'b',
      arguments: [],
      source: 'mcp:s2',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S2' },
    });
    registry.unregisterClient('s1');
    expect(registry.get('mcp:s1::a')).toBeNull();
    expect(registry.get('mcp:s2::b')).not.toBeNull();
  });

  it('stats 统计', () => {
    registry.register({
      id: 'mcp:s1::a',
      name: 'a',
      arguments: [],
      source: 'mcp:s1',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S1' },
    });
    const s = registry.stats();
    expect(s.total).toBe(1);
    expect(s.byServer['mcp:s1']).toBe(1);
  });

  it('render 委托给 renderPrompt', async () => {
    const client: McpPromptClient = {
      listPrompts: vi.fn(),
      getPrompt: vi.fn().mockResolvedValue([
        { role: 'user', content: { type: 'text', text: 'hi' } },
      ]),
    };
    registry.registerClient('s', client);
    registry.register({
      id: 'mcp:s::p',
      name: 'p',
      arguments: [],
      source: 'mcp:s',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S' },
    });
    const r = await registry.render('mcp:s::p', { args: {} });
    expect(r).not.toBeNull();
    expect(r?.messages.length).toBe(1);
  });

  it('render 不存在的 ID 返回 null', async () => {
    const r = await registry.render('mcp:s::none', { args: {} });
    expect(r).toBeNull();
  });

  it('render 客户端未注册返回 null', async () => {
    registry.register({
      id: 'mcp:s::p',
      name: 'p',
      arguments: [],
      source: 'mcp:s',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S' },
    });
    const r = await registry.render('mcp:s::p', { args: {} });
    expect(r).toBeNull();
  });

  it('render 非 mcp ID 返回 null', async () => {
    const r = await registry.render('builtin::test', { args: {} });
    expect(r).toBeNull();
  });
});

// ============ 全局注册表 ============

describe('getDefaultMcpPromptRegistry', () => {
  afterEach(() => {
    resetDefaultMcpPromptRegistry();
  });

  it('返回单例', () => {
    const a = getDefaultMcpPromptRegistry();
    const b = getDefaultMcpPromptRegistry();
    expect(a).toBe(b);
  });

  it('reset 清除单例', () => {
    const a = getDefaultMcpPromptRegistry();
    resetDefaultMcpPromptRegistry();
    const b = getDefaultMcpPromptRegistry();
    expect(a).not.toBe(b);
  });
});
