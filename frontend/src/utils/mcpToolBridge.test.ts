/**
 * # ============================================================
 * # MCP Tool Bridge 单元测试 (v1.0.0 Cycle 42 G42-01)
 * # ============================================================
 * # 覆盖：MCP Tool Bridge 全功能
 * #       - 工具限定名构造/解析
 * #       - 工具注册/注销
 * #       - 工具执行路由
 * #       - 事件分发
 * #       - 性能基准
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpToolBridge,
  createMcpToolBridge,
  buildMcpToolName,
  parseMcpToolName,
  convertMcpToolToHermes,
} from './mcpToolBridge';
import { McpClient } from './mcpClient';
import type { McpTransport } from './mcpTransport';
import type { JsonRpcMessage, Tool, ToolCallResult, ToolContent } from './mcpTypes';

// ============ Mock Transport ============

class MockBridgeTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public tools: Tool[] = [];
  public toolResults: Map<string, ToolCallResult> = new Map();
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
              capabilities: { tools: {} },
              serverInfo: { name: 'bridge-test', version: '1.0.0' },
            },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'tools/list' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: this.tools },
          } as JsonRpcMessage);
        }
      }, 1);
    } else if ('method' in msg && msg.method === 'tools/call' && 'id' in msg) {
      const params = msg.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      const toolName = params?.name ?? '';
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
        const result = this.toolResults.get(toolName) ?? {
          content: [{ type: 'text', text: `result: ${toolName}` } as ToolContent],
        };
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result,
          } as JsonRpcMessage);
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

async function createConnectedClient(transport: MockBridgeTransport): Promise<McpClient> {
  const client = new McpClient({
    serverId: 'test',
    serverName: 'Test',
    transport: { type: 'stdio', command: 'mock' },
  });
  client.setTransport(transport);
  await client.connect();
  return client;
}

// ============ 工具名构造/解析测试 ============

describe('mcpToolBridge - 工具名工具函数', () => {
  it('buildMcpToolName 构造限定名', () => {
    expect(buildMcpToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
  });

  it('parseMcpToolName 解析限定名', () => {
    const result = parseMcpToolName('mcp__filesystem__read_file');
    expect(result).toEqual({ serverId: 'filesystem', toolName: 'read_file' });
  });

  it('parseMcpToolName 解析多下划线工具名', () => {
    const result = parseMcpToolName('mcp__git__commit_changes');
    expect(result).toEqual({ serverId: 'git', toolName: 'commit_changes' });
  });

  it('parseMcpToolName 拒绝非 MCP 工具名', () => {
    expect(parseMcpToolName('read_file')).toBeNull();
    expect(parseMcpToolName('mcp__filesystem')).toBeNull();
    expect(parseMcpToolName('mcp___read')).toBeNull();
  });

  it('convertMcpToolToHermes 转换工具', () => {
    const mcpTool: Tool = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };
    const hermes = convertMcpToolToHermes('filesystem', 'Filesystem', mcpTool);
    expect(hermes.name).toBe('mcp__filesystem__read_file');
    expect(hermes.description).toBe('Filesystem: Read a file');
    expect(hermes.category).toBe('mcp');
    expect(hermes.permission).toBe('auto');
  });
});

// ============ 注册/注销测试 ============

describe('mcpToolBridge - 注册/注销', () => {
  let transport: MockBridgeTransport;
  let client: McpClient;
  let bridge: McpToolBridge;

  beforeEach(async () => {
    transport = new MockBridgeTransport();
    transport.tools = [
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
      { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpToolBridge();
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('注册服务器工具', async () => {
    const count = await bridge.registerServer('test', client);
    expect(count).toBe(2);
    expect(bridge.list().length).toBe(2);
  });

  it('注册后获取 Hermes 定义', async () => {
    await bridge.registerServer('test', client);
    const defs = bridge.getDefinitions();
    expect(defs.length).toBe(2);
    expect(defs[0].name).toBe('mcp__test__read_file');
  });

  it('注销服务器', async () => {
    await bridge.registerServer('test', client);
    await bridge.unregisterServer('test');
    expect(bridge.list().length).toBe(0);
  });

  it('重复注册先清理旧工具', async () => {
    await bridge.registerServer('test', client);
    transport.tools = [{ name: 'new_tool', description: 'New', inputSchema: { type: 'object' } }];
    await bridge.registerServer('test', client);
    expect(bridge.list().length).toBe(1);
    expect(bridge.list()[0].mcpTool.name).toBe('new_tool');
  });

  it('未就绪客户端注册抛出错误', async () => {
    await client.disconnect();
    await expect(bridge.registerServer('test', client)).rejects.toThrow();
  });

  it('注销不存在的服务器静默', async () => {
    await bridge.unregisterServer('nonexistent');
    expect(bridge.list().length).toBe(0);
  });

  it('unregisterAll 清理所有', async () => {
    await bridge.registerServer('test', client);
    const transport2 = new MockBridgeTransport();
    const client2 = await createConnectedClient(transport2);
    await bridge.registerServer('server2', client2);
    expect(bridge.list().length).toBe(2);
    await bridge.unregisterAll();
    expect(bridge.list().length).toBe(0);
    await client2.disconnect();
  });
});

// ============ 工具执行测试 ============

describe('mcpToolBridge - 工具执行', () => {
  let transport: MockBridgeTransport;
  let client: McpClient;
  let bridge: McpToolBridge;

  beforeEach(async () => {
    transport = new MockBridgeTransport();
    transport.tools = [
      { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } },
    ];
    client = await createConnectedClient(transport);
    bridge = createMcpToolBridge();
    await bridge.registerServer('test', client);
  });

  afterEach(async () => {
    bridge.dispose();
    await client.disconnect();
  });

  it('成功执行工具', async () => {
    transport.toolResults.set('echo', {
      content: [{ type: 'text', text: 'echoed!' } as ToolContent],
    });
    const result = await bridge.execute({
      id: 'call-1',
      name: 'mcp__test__echo',
      arguments: { x: 1 },
    });
    expect(result.success).toBe(true);
    expect(result.name).toBe('mcp__test__echo');
  });

  it('工具失败标记 isError', async () => {
    transport.toolResults.set('echo', {
      content: [{ type: 'text', text: 'error happened' } as ToolContent],
      isError: true,
    });
    const result = await bridge.execute({
      id: 'call-2',
      name: 'mcp__test__echo',
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });

  it('网络失败捕获错误', async () => {
    transport.failNext = true;
    const result = await bridge.execute({
      id: 'call-3',
      name: 'mcp__test__echo',
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });

  it('非 MCP 工具名返回 NOT_FOUND', async () => {
    const result = await bridge.execute({
      id: 'call-4',
      name: 'regular_tool',
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('不存在的服务器返回 NOT_FOUND', async () => {
    const result = await bridge.execute({
      id: 'call-5',
      name: 'mcp__nonexistent__tool',
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('不存在的工具返回 NOT_FOUND', async () => {
    const result = await bridge.execute({
      id: 'call-6',
      name: 'mcp__test__nonexistent',
      arguments: {},
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('统计调用次数', async () => {
    await bridge.execute({ id: '1', name: 'mcp__test__echo', arguments: {} });
    await bridge.execute({ id: '2', name: 'mcp__test__echo', arguments: {} });
    const stats = bridge.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.successCalls).toBe(2);
    expect(stats.failureCalls).toBe(0);
  });
});

// ============ 事件分发测试 ============

describe('mcpToolBridge - 事件分发', () => {
  it('server-registered 事件', async () => {
    const transport = new MockBridgeTransport();
    transport.tools = [{ name: 't1', description: 'T1', inputSchema: { type: 'object' } }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpToolBridge();
    const listener = vi.fn();
    bridge.on(listener);

    await bridge.registerServer('test', client);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'server-registered', serverId: 'test' }),
    );

    bridge.dispose();
    await client.disconnect();
  });

  it('server-unregistered 事件', async () => {
    const transport = new MockBridgeTransport();
    const client = await createConnectedClient(transport);
    const bridge = createMcpToolBridge();
    const listener = vi.fn();
    bridge.on(listener);
    await bridge.registerServer('test', client);
    listener.mockClear();

    await bridge.unregisterServer('test');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'server-unregistered' }),
    );

    bridge.dispose();
    await client.disconnect();
  });

  it('tool-executed 事件', async () => {
    const transport = new MockBridgeTransport();
    transport.tools = [{ name: 't1', description: 'T1', inputSchema: { type: 'object' } }];
    const client = await createConnectedClient(transport);
    const bridge = createMcpToolBridge();
    const events: string[] = [];
    bridge.on((e) => events.push(e.type));
    await bridge.registerServer('test', client);
    events.length = 0;

    await bridge.execute({ id: '1', name: 'mcp__test__t1', arguments: {} });
    expect(events).toContain('tool-executed');

    bridge.dispose();
    await client.disconnect();
  });

  it('on 返回取消订阅', async () => {
    const bridge = createMcpToolBridge();
    const listener = vi.fn();
    const off = bridge.on(listener);
    off();
    // dispose 会调用，但 listener 不应被调用
    bridge.dispose();
  });
});

// ============ registerToToolRegistry 测试 ============

describe('mcpToolBridge - 集成到 ToolRegistry', () => {
  it('同步注册到外部 Registry', async () => {
    const transport = new MockBridgeTransport();
    transport.tools = [
      { name: 't1', description: 'T1', inputSchema: { type: 'object' } },
      { name: 't2', description: 'T2', inputSchema: { type: 'object' } },
    ];
    const client = await createConnectedClient(transport);
    const bridge = createMcpToolBridge();
    await bridge.registerServer('test', client);

    // Mock external registry
    const externalReg = {
      register: vi.fn(),
    };
    const count = await bridge.registerToToolRegistry(externalReg);
    expect(count).toBe(2);
    expect(externalReg.register).toHaveBeenCalledTimes(2);

    bridge.dispose();
    await client.disconnect();
  });
});

// ============ 性能基准 ============

describe('mcpToolBridge - 性能基准', () => {
  it('解析 10000 次限定名 < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      parseMcpToolName('mcp__filesystem__read_file');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('构造 10000 次限定名 < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      buildMcpToolName('filesystem', 'read_file');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
