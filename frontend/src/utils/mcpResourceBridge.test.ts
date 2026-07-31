/**
 * # ============================================================
 * # MCP Resource Bridge 单元测试 (v1.0.0 Cycle 42 G42-02)
 * # ============================================================
 * # 覆盖：MCP Resource Bridge 全功能
 * #       - URI 构造/解析
 * #       - 资源注册/注销
 * #       - 资源解析（含缓存）
 * #       - 搜索/过滤
 * #       - 订阅管理
 * #       - 事件分发
 * #       - 性能基准
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpResourceBridge,
  createMcpResourceBridge,
  buildHermesResourceUri,
  parseHermesResourceUri,
  convertMcpResourceToHermes,
} from './mcpResourceBridge';
import { McpClient } from './mcpClient';
import type { McpTransport } from './mcpTransport';
import type { JsonRpcMessage, Resource, ResourceContent, ResourceReadResult } from './mcpTypes';

// ============ Mock Transport ============

class MockResourceTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public resources: Resource[] = [];
  public contents: Map<string, ResourceContent> = new Map();
  public failNext: boolean = false;

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: unknown): Promise<void> {
    const msg = message as JsonRpcMessage;
    if ('method' in msg && msg.method === 'initialize' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { resources: { subscribe: true } },
              serverInfo: { name: 'resource-test', version: '1.0.0' },
            },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'resources/list' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: { resources: this.resources },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'resources/read' && 'id' in msg) {
      const params = msg.params as { uri: string } | undefined;
      const uri = params?.uri ?? '';
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
        const content = this.contents.get(uri) ?? { uri, mimeType: 'text/plain', text: 'default' };
        const result: ResourceReadResult = { contents: [content] };
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result,
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && (msg.method === 'resources/subscribe' || msg.method === 'resources/unsubscribe') && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({ jsonrpc: '2.0', id: msg.id, result: {} } as JsonRpcMessage);
        }
      }, 1);
    }
  }

  onMessage(h: (msg: JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }
  onError(): () => void { return () => {}; }
  onClose(): () => void { return () => {}; }
  isOpen(): boolean { return this._isOpen; }
  async close(): Promise<void> { this._isOpen = false; }
}

async function createConnectedClient(transport: MockResourceTransport): Promise<McpClient> {
  const client = new McpClient({
    serverId: 'test',
    serverName: 'Test',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  await client.connect();
  return client;
}

// ============ URI 工具函数测试 ============

describe('mcpResourceBridge - URI 工具函数', () => {
  it('buildHermesResourceUri 构造 URI', () => {
    const uri = buildHermesResourceUri('filesystem', 'file:///home/a.txt');
    expect(uri).toBe('mcp://filesystem/file%3A%2F%2F%2Fhome%2Fa.txt');
  });

  it('parseHermesResourceUri 解析 URI', () => {
    const hermes = buildHermesResourceUri('fs', 'file:///a.txt');
    const parsed = parseHermesResourceUri(hermes);
    expect(parsed).toEqual({ serverId: 'fs', originalUri: 'file:///a.txt' });
  });

  it('parseHermesResourceUri 拒绝非 Hermes URI', () => {
    expect(parseHermesResourceUri('file:///a.txt')).toBeNull();
    expect(parseHermesResourceUri('mcp://')).toBeNull();
    expect(parseHermesResourceUri('https://a.com')).toBeNull();
  });

  it('convertMcpResourceToHermes 转换资源', () => {
    const mcp: Resource = {
      uri: 'file:///a.txt',
      name: 'A',
      description: 'desc',
      mimeType: 'text/plain',
    };
    const info = convertMcpResourceToHermes('fs', 'Filesystem', mcp);
    expect(info.id).toBe('mcp:fs:file:///a.txt');
    expect(info.name).toBe('A');
    expect(info.source).toBe('mcp');
    expect(info.serverId).toBe('fs');
    expect(info.originalUri).toBe('file:///a.txt');
  });
});

// ============ 注册/注销测试 ============

describe('mcpResourceBridge - 注册/注销', () => {
  let transport: MockResourceTransport;
  let client: McpClient;
  let bridge: McpResourceBridge;

  beforeEach(async () => {
    transport = new MockResourceTransport();
    transport.resources = [
      { uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' },
      { uri: 'file:///b.png', name: 'B', mimeType: 'image/png' },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpResourceBridge();
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('注册服务器资源', async () => {
    const count = await bridge.registerServer('test', client);
    expect(count).toBe(2);
    expect(bridge.list().length).toBe(2);
  });

  it('listByServer 列出指定服务器资源', async () => {
    await bridge.registerServer('test', client);
    const list = bridge.listByServer('test');
    expect(list.length).toBe(2);
  });

  it('注销服务器清理资源', async () => {
    await bridge.registerServer('test', client);
    await bridge.unregisterServer('test');
    expect(bridge.list().length).toBe(0);
  });

  it('重复注册先清理旧资源', async () => {
    await bridge.registerServer('test', client);
    transport.resources = [{ uri: 'file:///c.txt', name: 'C', mimeType: 'text/plain' }];
    await bridge.registerServer('test', client);
    expect(bridge.list().length).toBe(1);
  });

  it('未就绪客户端注册抛出错误', async () => {
    await client.disconnect();
    await expect(bridge.registerServer('test', client)).rejects.toThrow();
  });

  it('unregisterAll 清理所有', async () => {
    await bridge.registerServer('test', client);
    const transport2 = new MockResourceTransport();
    const client2 = await createConnectedClient(transport2);
    await bridge.registerServer('server2', client2);
    expect(bridge.list().length).toBe(2);
    await bridge.unregisterAll();
    expect(bridge.list().length).toBe(0);
    await client2.disconnect();
  });
});

// ============ 资源解析测试 ============

describe('mcpResourceBridge - 资源解析', () => {
  let transport: MockResourceTransport;
  let client: McpClient;
  let bridge: McpResourceBridge;
  let hermesUri: string;

  beforeEach(async () => {
    transport = new MockResourceTransport();
    transport.resources = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    transport.contents.set('file:///a.txt', { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'A content' });
    client = await createConnectedClient(transport);
    bridge = createMcpResourceBridge({ cacheTtlMs: 60_000 });
    await bridge.registerServer('test', client);
    hermesUri = buildHermesResourceUri('test', 'file:///a.txt');
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('解析资源', async () => {
    const resolved = await bridge.resolve(hermesUri);
    expect(resolved.cached).toBe(false);
    if ('text' in resolved.content) {
      expect(resolved.content.text).toBe('A content');
    }
  });

  it('第二次解析命中缓存', async () => {
    await bridge.resolve(hermesUri);
    const resolved = await bridge.resolve(hermesUri);
    expect(resolved.cached).toBe(true);
  });

  it('清空缓存后重新读取', async () => {
    await bridge.resolve(hermesUri);
    bridge.clearCache();
    const resolved = await bridge.resolve(hermesUri);
    expect(resolved.cached).toBe(false);
  });

  it('解析不存在的资源抛出错误', async () => {
    await expect(bridge.resolve('mcp://test/nonexistent')).rejects.toThrow();
  });

  it('解析非法 URI 抛出错误', async () => {
    await expect(bridge.resolve('invalid-uri')).rejects.toThrow();
  });

  it('服务器断连时解析失败', async () => {
    await client.disconnect();
    await expect(bridge.resolve(hermesUri)).rejects.toThrow();
  });
});

// ============ 搜索/过滤测试 ============

describe('mcpResourceBridge - 搜索/过滤', () => {
  let transport: MockResourceTransport;
  let client: McpClient;
  let bridge: McpResourceBridge;

  beforeEach(async () => {
    transport = new MockResourceTransport();
    transport.resources = [
      { uri: 'file:///readme.txt', name: 'README', description: 'Project readme', mimeType: 'text/plain' },
      { uri: 'file:///logo.png', name: 'Logo', description: 'Project logo', mimeType: 'image/png' },
      { uri: 'file:///data.json', name: 'Data', description: 'Project data', mimeType: 'application/json' },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpResourceBridge();
    await bridge.registerServer('test', client);
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('按名称搜索', () => {
    const results = bridge.search('readme');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('README');
  });

  it('按描述搜索', () => {
    const results = bridge.search('logo');
    expect(results.length).toBe(1);
  });

  it('空查询返回所有', () => {
    expect(bridge.search('').length).toBe(3);
  });

  it('按服务器 ID 过滤', () => {
    const results = bridge.search('', { serverId: 'test' });
    expect(results.length).toBe(3);
  });

  it('按 MIME 类型过滤', () => {
    const results = bridge.search('', { mimeType: 'image/' });
    expect(results.length).toBe(1);
  });
});

// ============ 订阅管理测试 ============

describe('mcpResourceBridge - 订阅管理', () => {
  let transport: MockResourceTransport;
  let client: McpClient;
  let bridge: McpResourceBridge;
  let hermesUri: string;

  beforeEach(async () => {
    transport = new MockResourceTransport();
    transport.resources = [{ uri: 'file:///a.txt', name: 'A', mimeType: 'text/plain' }];
    client = await createConnectedClient(transport);
    bridge = createMcpResourceBridge();
    await bridge.registerServer('test', client);
    hermesUri = buildHermesResourceUri('test', 'file:///a.txt');
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('订阅资源', async () => {
    const ok = await bridge.subscribe(hermesUri);
    expect(ok).toBe(true);
    expect(bridge.get(hermesUri)?.subscribed).toBe(true);
  });

  it('重复订阅返回 false', async () => {
    await bridge.subscribe(hermesUri);
    const ok = await bridge.subscribe(hermesUri);
    expect(ok).toBe(false);
  });

  it('取消订阅', async () => {
    await bridge.subscribe(hermesUri);
    const ok = await bridge.unsubscribe(hermesUri);
    expect(ok).toBe(true);
    expect(bridge.get(hermesUri)?.subscribed).toBe(false);
  });

  it('订阅不存在资源抛出错误', async () => {
    await expect(bridge.subscribe('mcp://test/nonexistent')).rejects.toThrow();
  });
});

// ============ 事件分发测试 ============

describe('mcpResourceBridge - 事件分发', () => {
  it('resource-added 事件', async () => {
    const transport = new MockResourceTransport();
    transport.resources = [{ uri: 'file:///a.txt', name: 'A' }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpResourceBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    expect(events).toContain('resource-added');
    expect(events).toContain('server-registered');
    bridge.dispose();
    await client.disconnect();
  });

  it('resource-removed 事件', async () => {
    const transport = new MockResourceTransport();
    transport.resources = [{ uri: 'file:///a.txt', name: 'A' }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpResourceBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    events.length = 0;
    await bridge.unregisterServer('test');
    expect(events).toContain('resource-removed');
    expect(events).toContain('server-unregistered');
    bridge.dispose();
    await client.disconnect();
  });

  it('resource-resolved 事件', async () => {
    const transport = new MockResourceTransport();
    transport.resources = [{ uri: 'file:///a.txt', name: 'A' }];
    transport.contents.set('file:///a.txt', { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'A' });
    const client = await createConnectedClient(transport);
    const bridge = createMcpResourceBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    const hermesUri = buildHermesResourceUri('test', 'file:///a.txt');
    await bridge.resolve(hermesUri);
    expect(events).toContain('resource-resolved');
    bridge.dispose();
    await client.disconnect();
  });
});

// ============ 性能基准 ============

describe('mcpResourceBridge - 性能基准', () => {
  it('解析 10000 次 URI < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      parseHermesResourceUri('mcp://fs/file%3A%2F%2F%2Fhome');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('构造 10000 次 URI < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      buildHermesResourceUri('fs', 'file:///home');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
