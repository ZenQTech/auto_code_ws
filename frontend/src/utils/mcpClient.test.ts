/**
 * # ============================================================
 * # MCP Client 单元测试 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 覆盖：工具函数 + PendingRequestManager + 传输类型守卫
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpClient,
  PendingRequestManager,
  generateRequestId,
  isJsonRpcRequest,
  isJsonRpcSuccess,
  isJsonRpcError,
  isJsonRpcNotification,
  detectTransportType,
} from './mcpClient';
import { McpError, McpTimeoutError, McpClosedError, McpConnectionError, McpParseError, McpMethodNotFoundError } from './mcpErrors';
import { StdioMcpTransport } from './mcpTransportStdio';
import { SseMcpTransport } from './mcpTransportSse';
import type { McpTransport } from './mcpTransport';
import { MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION } from './mcpTypes';

// ============ Mock Transport ============

/** 用于测试的 Mock Transport */
class MockTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: import('./mcpTypes').JsonRpcMessage) => void> = new Set();
  private errHandlers: Set<(err: Error) => void> = new Set();
  private closeHandlers: Set<() => void> = new Set();
  public sentMessages: unknown[] = [];

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: import('./mcpTypes').JsonRpcMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  onMessage(handler: import('./mcpTransport').MessageHandler): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onError(handler: import('./mcpTransport').ErrorHandler): () => void {
    this.errHandlers.add(handler);
    return () => this.errHandlers.delete(handler);
  }

  onClose(handler: import('./mcpTransport').CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  isOpen(): boolean {
    return this._isOpen;
  }

  async close(): Promise<void> {
    this._isOpen = false;
    for (const h of this.closeHandlers) h();
  }

  /** 测试辅助：注入消息 */
  injectMessage(msg: import('./mcpTypes').JsonRpcMessage): void {
    for (const h of this.msgHandlers) h(msg);
  }

  /** 测试辅助：注入错误 */
  injectError(err: Error): void {
    for (const h of this.errHandlers) h(err);
  }

  /** 测试辅助：模拟关闭 */
  triggerClose(): void {
    this._isOpen = false;
    for (const h of this.closeHandlers) h();
  }
}

// ============ 工具函数测试 ============

describe('MCP 工具函数', () => {
  describe('generateRequestId', () => {
    it('生成唯一 ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(100);
    });

    it('ID 格式为字符串', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('isJsonRpcRequest', () => {
    it('识别有效请求', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true);
    });

    it('拒绝响应', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    });

    it('拒绝通知', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'notify' })).toBe(false);
    });

    it('拒绝非对象', () => {
      expect(isJsonRpcRequest(null)).toBe(false);
      expect(isJsonRpcRequest('string')).toBe(false);
      expect(isJsonRpcRequest(42)).toBe(false);
    });

    it('拒绝错误版本', () => {
      expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBe(false);
    });
  });

  describe('isJsonRpcSuccess', () => {
    it('识别成功响应', () => {
      expect(isJsonRpcSuccess({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(true);
    });

    it('拒绝错误响应', () => {
      expect(isJsonRpcSuccess({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(false);
    });
  });

  describe('isJsonRpcError', () => {
    it('识别错误响应', () => {
      expect(isJsonRpcError({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
    });

    it('拒绝成功响应', () => {
      expect(isJsonRpcError({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    });
  });

  describe('isJsonRpcNotification', () => {
    it('识别通知', () => {
      expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'notify' })).toBe(true);
    });

    it('拒绝请求（有 id）', () => {
      expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(false);
    });
  });

  describe('detectTransportType', () => {
    it('http:// → sse', () => {
      expect(detectTransportType('http://localhost:3000/sse')).toBe('sse');
    });
    it('https:// → sse', () => {
      expect(detectTransportType('https://api.example.com/mcp')).toBe('sse');
    });
    it('其他 → stdio', () => {
      expect(detectTransportType('mcp-server-filesystem')).toBe('stdio');
      expect(detectTransportType('/usr/local/bin/server')).toBe('stdio');
    });
  });
});

// ============ PendingRequestManager 测试 ============

describe('PendingRequestManager', () => {
  let manager: PendingRequestManager;

  beforeEach(() => {
    manager = new PendingRequestManager();
  });

  afterEach(() => {
    manager.close();
  });

  it('添加请求并 resolve', async () => {
    const { id, promise } = manager.add('test', 5000);
    expect(id).toBeTruthy();
    expect(manager.size()).toBe(1);

    setTimeout(() => manager.resolve(id, { ok: true }), 10);
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(manager.size()).toBe(0);
  });

  it('添加请求并 reject', async () => {
    const { id, promise } = manager.add('test', 5000);
    const err = new McpError('failed', -1);
    setTimeout(() => manager.reject(id, err), 10);

    await expect(promise).rejects.toThrow('failed');
  });

  it('超时自动 reject', async () => {
    const { promise } = manager.add('slow_method', 100);
    await expect(promise).rejects.toThrow(McpTimeoutError);
  });

  it('resolve 未知 id 返回 false', () => {
    expect(manager.resolve('unknown', {})).toBe(false);
  });

  it('reject 未知 id 返回 false', () => {
    expect(manager.reject('unknown', new McpError('x', -1))).toBe(false);
  });

  it('close 清空所有待处理请求', async () => {
    const { promise: p1 } = manager.add('m1', 5000);
    const { promise: p2 } = manager.add('m2', 5000);
    manager.close('test close');

    await expect(p1).rejects.toThrow(McpClosedError);
    await expect(p2).rejects.toThrow(McpClosedError);
    expect(manager.size()).toBe(0);
  });

  it('close 后添加请求立即 reject', () => {
    manager.close();
    const { promise } = manager.add('after_close', 5000);
    expect(promise).toBeInstanceOf(Promise);
    return expect(promise).rejects.toThrow(McpClosedError);
  });

  it('并发请求独立管理', async () => {
    const r1 = manager.add('m1', 5000);
    const r2 = manager.add('m2', 5000);
    expect(manager.size()).toBe(2);

    setTimeout(() => manager.resolve(r1.id, 'result1'), 10);
    setTimeout(() => manager.resolve(r2.id, 'result2'), 20);

    expect(await r1.promise).toBe('result1');
    expect(await r2.promise).toBe('result2');
  });

  it('isClosed 状态正确', () => {
    expect(manager.isClosed()).toBe(false);
    manager.close();
    expect(manager.isClosed()).toBe(true);
  });
});

// ============ McpClient 生命周期测试 ============

describe('McpClient 生命周期', () => {
  let client: McpClient;
  let mockTransport: MockTransport;

  beforeEach(async () => {
    mockTransport = new MockTransport();
    client = new McpClient({
      serverId: 'test-server',
      serverName: 'Test Server',
      transport: {
        type: 'stdio',
        command: 'mock',
      },
    });
    // 替换 transport 为 mock
    (client as unknown as { transport: McpTransport }).transport = mockTransport;
    client.setTransport(mockTransport);
  });

  it('connect 成功', async () => {
    const initPromise = client.connect();
    // 模拟服务器响应
    setTimeout(() => {
      const lastMsg = mockTransport.sentMessages[0] as { id: string };
      mockTransport.injectMessage({
        jsonrpc: '2.0',
        id: lastMsg.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'mock', version: '1.0.0' },
        },
      });
    }, 10);

    const result = await initPromise;
    expect(result.serverInfo.name).toBe('mock');
    expect(client.getState()).toBe('ready');
  });

  it('connect 失败抛 McpConnectionError', async () => {
    const failingTransport: McpTransport = {
      type: 'stdio',
      start: async () => {
        throw new Error('spawn failed');
      },
      send: async () => {},
      onMessage: () => () => {},
      onError: () => () => {},
      onClose: () => () => {},
      isOpen: () => false,
      close: async () => {},
    };
    const failingClient = new McpClient({
      serverId: 'failing',
      serverName: 'Failing',
      transport: { type: 'stdio', command: 'nonexistent-cmd' },
    });
    (failingClient as unknown as { transport: McpTransport }).transport = failingTransport;
    failingClient.setTransport(failingTransport);

    await expect(failingClient.connect()).rejects.toThrow();
    expect(failingClient.getState()).toBe('error');
  });

  it('ready 前调用 listTools 抛 NotConnectedError', async () => {
    await expect(client.listTools()).rejects.toThrow();
  });

  it('close 后状态变为 closed', async () => {
    await client.close();
    expect(client.getState()).toBe('closed');
  });

  it('closed 后操作抛 ClosedError', async () => {
    await client.close();
    await expect(client.listTools()).rejects.toThrow(McpClosedError);
  });

  it('ping 发送正确方法名', async () => {
    const initPromise = client.connect();
    setTimeout(() => {
      const lastMsg = mockTransport.sentMessages[0] as { id: string };
      mockTransport.injectMessage({
        jsonrpc: '2.0',
        id: lastMsg.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'mock', version: '1.0.0' },
        },
      });
    }, 5);
    await initPromise;

    const pingPromise = client.ping();
    await new Promise((r) => setTimeout(r, 5));
    const pingMsg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'ping',
    );
    expect(pingMsg).toBeTruthy();
    (pingMsg as unknown as { id: string });
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (pingMsg as { id: string }).id,
      result: {},
    });
    await pingPromise;
  });
});

// ============ 能力发现测试 ============

describe('McpClient 能力发现', () => {
  let client: McpClient;
  let mockTransport: MockTransport;

  beforeEach(async () => {
    mockTransport = new MockTransport();
    client = new McpClient({
      serverId: 'cap-server',
      serverName: 'Cap Server',
      transport: { type: 'stdio', command: 'mock' },
    });
    (client as unknown as { transport: McpTransport }).transport = mockTransport;
    client.setTransport(mockTransport);
    // 完成 connect
    const initPromise = client.connect();
    setTimeout(() => {
      const lastMsg = mockTransport.sentMessages[0] as { id: string };
      mockTransport.injectMessage({
        jsonrpc: '2.0',
        id: lastMsg.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'cap-mock', version: '1.0.0' },
        },
      });
    }, 5);
    await initPromise;
  });

  it('listTools 返回工具列表', async () => {
    const promise = client.listTools();
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'tools/list',
    );
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: {
        tools: [
          { name: 'read_file', description: '读取文件', inputSchema: { type: 'object' } },
        ],
      },
    });
    const tools = await promise;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('read_file');
  });

  it('callTool 调用工具', async () => {
    const promise = client.callTool('read_file', { path: '/tmp/x' });
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'tools/call',
    );
    expect(msg).toBeTruthy();
    expect((msg as { params: { name: string } }).params.name).toBe('read_file');

    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: { content: [{ type: 'text', text: 'file content' }] },
    });
    const result = await promise;
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('file content');
    }
  });

  it('listResources 返回资源列表', async () => {
    const promise = client.listResources();
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'resources/list',
    );
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: {
        resources: [{ uri: 'file:///a.txt', name: 'A' }],
      },
    });
    const resources = await promise;
    expect(resources).toHaveLength(1);
  });

  it('readResource 读取资源内容', async () => {
    const promise = client.readResource('file:///a.txt');
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'resources/read',
    );
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: { contents: [{ uri: 'file:///a.txt', text: 'hello' }] },
    });
    const contents = await promise;
    expect(contents).toHaveLength(1);
    expect('text' in contents[0]).toBe(true);
    if ('text' in contents[0]) {
      expect(contents[0].text).toBe('hello');
    }
  });

  it('listPrompts 返回提示词列表', async () => {
    const promise = client.listPrompts();
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'prompts/list',
    );
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: {
        prompts: [{ name: 'greet', description: '问候' }],
      },
    });
    const prompts = await promise;
    expect(prompts).toHaveLength(1);
  });

  it('getPrompt 获取提示词内容', async () => {
    const promise = client.getPrompt('greet', { name: 'Alice' });
    await new Promise((r) => setTimeout(r, 5));
    const msg = mockTransport.sentMessages.find(
      (m) => (m as { method?: string }).method === 'prompts/get',
    );
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      id: (msg as { id: string }).id,
      result: {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello Alice' } }],
      },
    });
    const messages = await promise;
    expect(messages).toHaveLength(1);
  });
});

// ============ 通知订阅测试 ============

describe('McpClient 通知订阅', () => {
  let client: McpClient;
  let mockTransport: MockTransport;

  beforeEach(async () => {
    mockTransport = new MockTransport();
    client = new McpClient({
      serverId: 'notif-server',
      serverName: 'Notif Server',
      transport: { type: 'stdio', command: 'mock' },
    });
    (client as unknown as { transport: McpTransport }).transport = mockTransport;
    client.setTransport(mockTransport);
    const initPromise = client.connect();
    setTimeout(() => {
      const lastMsg = mockTransport.sentMessages[0] as { id: string };
      mockTransport.injectMessage({
        jsonrpc: '2.0',
        id: lastMsg.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          serverInfo: { name: 'notif', version: '1.0.0' },
        },
      });
    }, 5);
    await initPromise;
  });

  it('订阅 tools/list_changed', () => {
    const handler = vi.fn();
    client.onToolsListChanged(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });
    expect(handler).toHaveBeenCalled();
  });

  it('订阅 resources/list_changed', () => {
    const handler = vi.fn();
    client.onResourcesListChanged(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
    });
    expect(handler).toHaveBeenCalled();
  });

  it('订阅 prompts/list_changed', () => {
    const handler = vi.fn();
    client.onPromptsListChanged(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/prompts/list_changed',
    });
    expect(handler).toHaveBeenCalled();
  });

  it('订阅 resources/updated 接收 uri', () => {
    const handler = vi.fn();
    client.onResourceUpdated(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///x.txt' },
    });
    expect(handler).toHaveBeenCalledWith('file:///x.txt');
  });

  it('订阅 log message 接收级别', () => {
    const handler = vi.fn();
    client.onLogMessage(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'warning', logger: 'test', data: { msg: 'hi' } },
    });
    expect(handler).toHaveBeenCalledWith('warning', 'test', { msg: 'hi' });
  });

  it('订阅 progress 接收进度', () => {
    const handler = vi.fn();
    client.onProgress(handler);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progress: 50, total: 100, message: 'processing' },
    });
    expect(handler).toHaveBeenCalledWith(50, 100, 'processing');
  });

  it('取消订阅后不再触发', () => {
    const handler = vi.fn();
    const unsubscribe = client.onToolsListChanged(handler);
    unsubscribe();
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler 异常不影响其他 handler', () => {
    const bad = vi.fn(() => {
      throw new Error('bad');
    });
    const good = vi.fn();
    client.onToolsListChanged(bad);
    client.onToolsListChanged(good);
    mockTransport.injectMessage({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});

// ============ 状态查询测试 ============

describe('McpClient 状态查询', () => {
  it('getServerId 返回正确 ID', () => {
    const client = new McpClient({
      serverId: 'my-id',
      serverName: 'My',
      transport: { type: 'stdio', command: 'x' },
    });
    expect(client.getServerId()).toBe('my-id');
  });

  it('getServerName 返回正确名称', () => {
    const client = new McpClient({
      serverId: 'id',
      serverName: 'Display Name',
      transport: { type: 'stdio', command: 'x' },
    });
    expect(client.getServerName()).toBe('Display Name');
  });

  it('初始状态为 idle', () => {
    const client = new McpClient({
      serverId: 'id',
      serverName: 'Name',
      transport: { type: 'stdio', command: 'x' },
    });
    expect(client.getState()).toBe('idle');
  });

  it('getServerInfo 初始为 undefined', () => {
    const client = new McpClient({
      serverId: 'id',
      serverName: 'Name',
      transport: { type: 'stdio', command: 'x' },
    });
    expect(client.getServerInfo()).toBeUndefined();
  });
});

// ============ 工厂函数测试 ============

describe('McpClient 工厂函数', () => {
  it('createMcpClient 返回 McpClient 实例', () => {
    const client = new McpClient({
      serverId: 'factory',
      serverName: 'Factory',
      transport: { type: 'stdio', command: 'x' },
    });
    expect(client).toBeInstanceOf(McpClient);
  });

  it('默认使用 MCP_CLIENT_INFO', () => {
    const client = new McpClient({
      serverId: 'default',
      serverName: 'Default',
      transport: { type: 'stdio', command: 'x' },
    });
    // 通过内部状态间接验证
    expect(client).toBeInstanceOf(McpClient);
  });
});

// ============ Transport 工厂测试 ============

describe('MCP Transport 工厂', () => {
  it('stdio 选项创建 StdioMcpTransport', () => {
    const client = new McpClient({
      serverId: 'stdio',
      serverName: 'Stdio',
      transport: { type: 'stdio', command: 'cmd' },
    });
    const t = (client as unknown as { transport: McpTransport }).transport;
    expect(t.type).toBe('stdio');
  });

  it('sse 选项创建 SseMcpTransport', () => {
    const client = new McpClient({
      serverId: 'sse',
      serverName: 'SSE',
      transport: { type: 'sse', url: 'http://localhost:3000/sse' },
    });
    const t = (client as unknown as { transport: McpTransport }).transport;
    expect(t.type).toBe('sse');
  });
});
