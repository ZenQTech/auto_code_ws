/**
 * # ============================================================
 * # MCP Prompt Bridge 单元测试 (v1.0.0 Cycle 42 G42-03)
 * # ============================================================
 * # 覆盖：MCP Prompt Bridge 全功能
 * #       - 限定名构造/解析
 * #       - MCP Prompt → Hermes 转换
 * #       - 参数校验
 * #       - 文本插值
 * #       - 提示词注册/注销
 * #       - 渲染（含缓存）
 * #       - 搜索/过滤
 * #       - 事件分发
 * #       - 性能基准
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpPromptBridge,
  createMcpPromptBridge,
  buildMcpPromptName,
  parseMcpPromptName,
  convertMcpPromptToHermes,
  validateHermesPromptArgs,
  interpolatePromptText,
  type HermesPromptDefinition,
} from './mcpPromptBridge';
import { McpClient } from './mcpClient';
import type { McpTransport } from './mcpTransport';
import type { JsonRpcMessage, Prompt, PromptArgument } from './mcpTypes';

// ============ Mock Transport ============

class MockPromptTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public prompts: Prompt[] = [];
  public promptArgs: Map<string, Record<string, string>> = new Map();
  public failNext: boolean = false;

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
              capabilities: { prompts: { listChanged: true } },
              serverInfo: { name: 'prompt-test', version: '1.0.0' },
            },
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
      const params = msg.params as { name: string; arguments?: Record<string, string> } | undefined;
      const name = params?.name ?? '';
      const args = params?.arguments ?? {};
      setTimeout(() => {
        if (this.failNext) {
          for (const h of this.msgHandlers) {
            h({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32603, message: 'injected failure' },
            } as JsonRpcMessage);
          }
          return;
        }
        const result = {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Prompt: ${name}, Args: ${JSON.stringify(args)}`,
              },
            },
          ],
        };
        for (const h of this.msgHandlers) {
          h({ jsonrpc: '2.0', id: msg.id, result } as JsonRpcMessage);
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

async function createConnectedClient(transport: MockPromptTransport): Promise<McpClient> {
  const client = new McpClient({
    serverId: 'test',
    serverName: 'Test',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  await client.connect();
  return client;
}

// ============ 工具函数测试 ============

describe('mcpPromptBridge - 工具函数', () => {
  it('buildMcpPromptName 构造限定名', () => {
    expect(buildMcpPromptName('fs', 'greet')).toBe('mcp:fs::greet');
  });

  it('parseMcpPromptName 解析限定名', () => {
    expect(parseMcpPromptName('mcp:fs::greet')).toEqual({ serverId: 'fs', promptName: 'greet' });
  });

  it('parseMcpPromptName 拒绝非 MCP 限定名', () => {
    expect(parseMcpPromptName('fs::greet')).toBeNull();
    expect(parseMcpPromptName('mcp:fs:greet')).toBeNull();
    expect(parseMcpPromptName('plain-name')).toBeNull();
  });

  it('convertMcpPromptToHermes 转换提示词', () => {
    const mcp: Prompt = {
      name: 'greet',
      description: 'Greet user',
      arguments: [{ name: 'name', required: true }] as PromptArgument[],
    };
    const hermes = convertMcpPromptToHermes('fs', 'Filesystem', mcp);
    expect(hermes.qualifiedName).toBe('mcp:fs::greet');
    expect(hermes.name).toBe('greet');
    expect(hermes.description).toBe('Greet user');
    expect(hermes.arguments[0].name).toBe('name');
    expect(hermes.arguments[0].required).toBe(true);
    expect(hermes.serverId).toBe('fs');
    expect(hermes.serverName).toBe('Filesystem');
    expect(hermes.tags).toContain('mcp');
  });

  it('validateHermesPromptArgs 必填校验', () => {
    const def: HermesPromptDefinition = {
      qualifiedName: 'mcp:fs::greet',
      name: 'greet',
      arguments: [{ name: 'name', required: true }],
      tags: [],
      serverId: 'fs',
      serverName: 'FS',
      createdAt: 0,
      metadata: {},
    };
    const r1 = validateHermesPromptArgs(def, {});
    expect(r1.missingArgs).toEqual(['name']);
    const r2 = validateHermesPromptArgs(def, { name: '' });
    expect(r2.missingArgs).toEqual(['name']);
    const r3 = validateHermesPromptArgs(def, { name: 'world' });
    expect(r3.missingArgs).toEqual([]);
  });

  it('validateHermesPromptArgs enum 校验', () => {
    const def: HermesPromptDefinition = {
      qualifiedName: 'mcp:x::p',
      name: 'p',
      arguments: [{ name: 'lang', required: false, enum: ['en', 'zh'] }],
      tags: [],
      serverId: 'x',
      serverName: 'X',
      createdAt: 0,
      metadata: {},
    };
    expect(validateHermesPromptArgs(def, { lang: 'en' }).invalidArgs).toEqual([]);
    expect(validateHermesPromptArgs(def, { lang: 'fr' }).invalidArgs.length).toBe(1);
  });

  it('interpolatePromptText 替换 args', () => {
    expect(interpolatePromptText('Hello ${args.name}', { args: { name: 'world' } })).toBe('Hello world');
  });

  it('interpolatePromptText 替换 metadata', () => {
    expect(
      interpolatePromptText('User: ${metadata.user}', {
        args: {},
        metadata: { user: 'alice' },
      }),
    ).toBe('User: alice');
  });

  it('interpolatePromptText 保持未定义变量原样', () => {
    expect(interpolatePromptText('${args.missing}', { args: {} })).toBe('${args.missing}');
  });
});

// ============ 注册/注销测试 ============

describe('mcpPromptBridge - 注册/注销', () => {
  let transport: MockPromptTransport;
  let client: McpClient;
  let bridge: McpPromptBridge;

  beforeEach(async () => {
    transport = new MockPromptTransport();
    transport.prompts = [
      { name: 'greet', description: 'Greet', arguments: [{ name: 'name', required: true }] },
      { name: 'summarize', description: 'Summarize text' },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpPromptBridge();
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('注册服务器提示词', async () => {
    const count = await bridge.registerServer('test', client);
    expect(count).toBe(2);
    expect(bridge.list().length).toBe(2);
  });

  it('listByServer 列出指定服务器', async () => {
    await bridge.registerServer('test', client);
    expect(bridge.listByServer('test').length).toBe(2);
  });

  it('注销服务器清理提示词', async () => {
    await bridge.registerServer('test', client);
    await bridge.unregisterServer('test');
    expect(bridge.list().length).toBe(0);
  });

  it('重复注册先清理旧提示词', async () => {
    await bridge.registerServer('test', client);
    transport.prompts = [{ name: 'new' }];
    await bridge.registerServer('test', client);
    expect(bridge.list().length).toBe(1);
  });

  it('未就绪客户端注册抛出错误', async () => {
    await client.disconnect();
    await expect(bridge.registerServer('test', client)).rejects.toThrow();
  });
});

// ============ 渲染测试 ============

describe('mcpPromptBridge - 渲染', () => {
  let transport: MockPromptTransport;
  let client: McpClient;
  let bridge: McpPromptBridge;

  beforeEach(async () => {
    transport = new MockPromptTransport();
    transport.prompts = [
      { name: 'greet', description: 'Greet', arguments: [{ name: 'name', required: true }] },
      { name: 'echo', description: 'Echo text' },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpPromptBridge({ cacheTtlMs: 60_000 });
    await bridge.registerServer('test', client);
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('渲染提示词', async () => {
    const r = await bridge.render('mcp:test::greet', { args: { name: 'Alice' } });
    expect(r.cached).toBe(false);
    expect(r.missingArgs).toEqual([]);
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].role).toBe('user');
  });

  it('第二次渲染命中缓存', async () => {
    await bridge.render('mcp:test::greet', { args: { name: 'Alice' } });
    const r = await bridge.render('mcp:test::greet', { args: { name: 'Alice' } });
    expect(r.cached).toBe(true);
  });

  it('skipCache 跳过缓存', async () => {
    await bridge.render('mcp:test::greet', { args: { name: 'A' } });
    const r = await bridge.render('mcp:test::greet', { args: { name: 'A' }, options: { skipCache: true } });
    expect(r.cached).toBe(false);
  });

  it('缺失必填参数返回错误', async () => {
    const r = await bridge.render('mcp:test::greet', { args: {} });
    expect(r.missingArgs).toEqual(['name']);
    expect(r.messages.length).toBe(0);
  });

  it('渲染不存在的提示词抛出错误', async () => {
    await expect(bridge.render('mcp:test::nonexistent', { args: {} })).rejects.toThrow();
  });

  it('MCP 错误抛出', async () => {
    transport.failNext = true;
    await expect(bridge.render('mcp:test::greet', { args: { name: 'A' } })).rejects.toThrow();
  });

  it('批量渲染', async () => {
    const results = await bridge.renderBatch([
      { qualifiedName: 'mcp:test::greet', context: { args: { name: 'A' } } },
      { qualifiedName: 'mcp:test::greet', context: { args: { name: 'B' } } },
    ]);
    expect(results.length).toBe(2);
  });

  it('服务器断连时渲染失败', async () => {
    await client.disconnect();
    await expect(bridge.render('mcp:test::greet', { args: { name: 'A' } })).rejects.toThrow();
  });

  it('清空缓存后重新渲染', async () => {
    await bridge.render('mcp:test::greet', { args: { name: 'A' } });
    bridge.clearCache();
    const r = await bridge.render('mcp:test::greet', { args: { name: 'A' } });
    expect(r.cached).toBe(false);
  });
});

// ============ 搜索/过滤测试 ============

describe('mcpPromptBridge - 搜索/过滤', () => {
  let transport: MockPromptTransport;
  let client: McpClient;
  let bridge: McpPromptBridge;

  beforeEach(async () => {
    transport = new MockPromptTransport();
    transport.prompts = [
      { name: 'greet', description: 'Greet user' },
      { name: 'summarize', description: 'Summarize content' },
      { name: 'analyze', description: 'Analyze data' },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpPromptBridge();
    await bridge.registerServer('test', client);
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('按名称搜索', () => {
    expect(bridge.search('greet').length).toBe(1);
  });

  it('按描述搜索', () => {
    expect(bridge.search('data').length).toBe(1);
  });

  it('空查询返回所有', () => {
    expect(bridge.search('').length).toBe(3);
  });

  it('按 tag 过滤', () => {
    expect(bridge.search('', { tag: 'mcp' }).length).toBe(3);
  });

  it('按服务器过滤', () => {
    expect(bridge.search('', { serverId: 'test' }).length).toBe(3);
  });
});

// ============ 事件分发测试 ============

describe('mcpPromptBridge - 事件分发', () => {
  it('server-registered 事件', async () => {
    const transport = new MockPromptTransport();
    transport.prompts = [{ name: 'greet' }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpPromptBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    expect(events).toContain('server-registered');
    bridge.dispose();
    await client.disconnect();
  });

  it('server-unregistered 事件', async () => {
    const transport = new MockPromptTransport();
    transport.prompts = [{ name: 'greet' }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpPromptBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    events.length = 0;
    await bridge.unregisterServer('test');
    expect(events).toContain('server-unregistered');
    bridge.dispose();
    await client.disconnect();
  });

  it('prompt-rendered 事件', async () => {
    const transport = new MockPromptTransport();
    transport.prompts = [{ name: 'greet', arguments: [{ name: 'name', required: true }] }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpPromptBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    await bridge.render('mcp:test::greet', { args: { name: 'A' } });
    expect(events).toContain('prompt-rendered');
    bridge.dispose();
    await client.disconnect();
  });

  it('on 返回取消订阅', async () => {
    const bridge = createMcpPromptBridge();
    const listener = vi.fn();
    const unsub = bridge.on(listener);
    unsub();
    await bridge.render('mcp:test::greet', { args: { name: 'A' } }).catch(() => {});
    expect(listener).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

// ============ 性能基准 ============

describe('mcpPromptBridge - 性能基准', () => {
  it('解析 10000 次限定名 < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      parseMcpPromptName('mcp:filesystem::greet');
    }
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('构造 10000 次限定名 < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      buildMcpPromptName('filesystem', 'greet');
    }
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('插值 10000 次 < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      interpolatePromptText('Hello ${args.name}, today is ${metadata.now}', {
        args: { name: 'A' },
        metadata: { now: new Date() },
      });
    }
    expect(performance.now() - start).toBeLessThan(100);
  });
});
