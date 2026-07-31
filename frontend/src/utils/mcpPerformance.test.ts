/**
 * # ============================================================
 * # MCP 性能基准测试 (v1.0.0 Cycle 40 G40-04)
 * # ============================================================
 * # 覆盖：关键操作的性能基线
 * #       - 工具调用吞吐量
 * #       - 资源加载延迟
 * #       - 提示词渲染吞吐量
 * #       - 注册表操作延迟
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpClient } from './mcpClient';
import {
  McpPromptRegistry,
  type McpPromptClient,
} from './mcpPromptIntegration';
import { classifyContent, formatBytes, base64ByteSize } from '../components/McpResourceViewer';
import type { Tool, Resource, Prompt, PromptMessage } from './mcpTypes';
import type { McpTransport } from './mcpTransport';

// ============ Mock Transport ============

class BenchMockTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: import('./mcpTypes').JsonRpcMessage) => void> = new Set();
  private errHandlers: Set<(err: Error) => void> = new Set();
  private closeHandlers: Set<() => void> = new Set();

  async start(): Promise<void> {
    this._isOpen = true;
  }
  async send(_msg: unknown): Promise<void> {
    const msg = _msg as { method: string; id: string | number; params?: Record<string, unknown> };
    // 立即异步响应
    setTimeout(() => {
      let result: unknown = null;
      if (msg.method === 'initialize') {
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'bench', version: '1.0.0' },
        };
      } else if (msg.method === 'tools/list') {
        result = { tools: this.generateTools(10) };
      } else if (msg.method === 'tools/call') {
        result = { content: [{ type: 'text', text: 'ok' }] };
      } else if (msg.method === 'resources/list') {
        result = { resources: this.generateResources(20) };
      } else if (msg.method === 'resources/read') {
        result = { contents: [{ uri: msg.params?.uri, mimeType: 'text/plain', text: 'x' }] };
      } else if (msg.method === 'prompts/list') {
        result = { prompts: this.generatePrompts(15) };
      } else if (msg.method === 'prompts/get') {
        result = { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] };
      }
      if (result !== null) {
        for (const h of this.msgHandlers) {
          try {
            h({ jsonrpc: '2.0', id: msg.id, result } as import('./mcpTypes').JsonRpcMessage);
          } catch {
            // 静默
          }
        }
      }
    }, 0);
  }
  onMessage(handler: (msg: import('./mcpTypes').JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }
  onError(handler: (err: Error) => void): () => void {
    this.errHandlers.add(handler);
    return () => this.errHandlers.delete(handler);
  }
  onClose(handler: () => void): () => void {
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

  private generateTools(n: number): Tool[] {
    return Array.from({ length: n }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}`,
      inputSchema: { type: 'object' as const },
    }));
  }
  private generateResources(n: number): Resource[] {
    const mimes = ['text/plain', 'image/png', 'application/json', 'application/pdf'];
    return Array.from({ length: n }, (_, i) => ({
      uri: `file:///r${i}`,
      name: `R${i}`,
      mimeType: mimes[i % mimes.length] ?? 'text/plain',
    }));
  }
  private generatePrompts(n: number): Prompt[] {
    return Array.from({ length: n }, (_, i) => ({
      name: `prompt_${i}`,
      description: `Prompt ${i}`,
      arguments: i % 2 === 0 ? [{ name: 'x', required: true }] : undefined,
    }));
  }
}

// ============ 性能基准 ============

describe('MCP 性能 - 工具调用', () => {
  /**
   * 辅助：创建带 BenchMockTransport 的 McpClient
   */
  function createBenchClient(transport: BenchMockTransport): McpClient {
    const client = new McpClient({
      serverId: 'bench',
      serverName: 'Bench',
      transport: { type: 'stdio', command: 'mock' },
    });
    client.setTransport(transport);
    return client;
  }

  it('串行 50 次工具调用 < 2s', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      await client.callTool(`tool_${i % 10}`, { i });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);

    await client.close();
  });

  it('并发 50 次工具调用 < 1s', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const start = Date.now();
    const promises = Array.from({ length: 50 }, (_, i) =>
      client.callTool(`tool_${i % 10}`, { i }),
    );
    await Promise.all(promises);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    await client.close();
  });

  it('单次工具调用延迟 < 100ms', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const start = Date.now();
    await client.callTool('tool_0', {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);

    await client.close();
  });
});

describe('MCP 性能 - 资源操作', () => {
  function createBenchClient(transport: BenchMockTransport): McpClient {
    const client = new McpClient({
      serverId: 'bench',
      serverName: 'Bench',
      transport: { type: 'stdio', command: 'mock' },
    });
    client.setTransport(transport);
    return client;
  }

  it('list 20 个资源 < 200ms', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const start = Date.now();
    const resources = await client.listResources();
    const elapsed = Date.now() - start;
    expect(resources.length).toBe(20);
    expect(elapsed).toBeLessThan(200);

    await client.close();
  });

  it('并发 50 次 readResource < 1s', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const start = Date.now();
    const promises = Array.from({ length: 50 }, (_, i) =>
      client.readResource(`file:///r${i % 20}`),
    );
    await Promise.all(promises);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    await client.close();
  });
});

describe('MCP 性能 - 提示词渲染', () => {
  function createBenchClient(transport: BenchMockTransport): McpClient {
    const client = new McpClient({
      serverId: 'bench',
      serverName: 'Bench',
      transport: { type: 'stdio', command: 'mock' },
    });
    client.setTransport(transport);
    return client;
  }

  it('渲染 100 次提示词 < 1s', async () => {
    const transport = new BenchMockTransport();
    const client = createBenchClient(transport);
    await client.connect();

    const promptRegistry = new McpPromptRegistry();
    const promptClient: McpPromptClient = {
      listPrompts: () => client.listPrompts(),
      getPrompt: (name, args) => client.getPrompt(name, args),
    };
    promptRegistry.registerClient('bench', promptClient);
    await promptRegistry.loadFromServer('bench', 'Bench');

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      await promptRegistry.render(`mcp:bench::prompt_${i % 15}`, {
        args: { x: 'value' },
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    await client.close();
  });
});

describe('MCP 性能 - 分类器', () => {
  it('10000 次 classifyContent < 100ms', () => {
    const mimes = [
      'text/plain',
      'image/png',
      'image/jpeg',
      'application/json',
      'text/markdown',
      'application/pdf',
      'audio/mpeg',
      'video/mp4',
    ];
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      classifyContent(mimes[i % mimes.length]);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('10000 次 formatBytes < 100ms', () => {
    const sizes = [100, 1024, 1024 * 1024, 1024 * 1024 * 1024, 50 * 1024 * 1024];
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      formatBytes(sizes[i % sizes.length] ?? 0);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('10000 次 base64ByteSize < 200ms', () => {
    const b64s = [
      'AAAA',
      'AAAABBBBCCCCDDDD',
      'MDEyMzQ1Njc4OQ==',
      'a'.repeat(100),
      'b'.repeat(1000),
    ];
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      base64ByteSize(b64s[i % b64s.length] ?? '');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe('MCP 性能 - 注册表操作', () => {
  it('1000 次 register/unregister < 500ms', () => {
    const registry = new McpPromptRegistry();
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      registry.register({
        id: `mcp:s::p${i}`,
        name: `p${i}`,
        arguments: [],
        source: 'mcp:s',
        tags: [],
        createdAt: i,
        metadata: { serverName: 'S' },
      });
    }
    for (let i = 0; i < 1000; i++) {
      registry.unregister(`mcp:s::p${i}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('10000 次 get < 100ms', () => {
    const registry = new McpPromptRegistry();
    for (let i = 0; i < 100; i++) {
      registry.register({
        id: `mcp:s::p${i}`,
        name: `p${i}`,
        arguments: [],
        source: 'mcp:s',
        tags: [],
        createdAt: i,
        metadata: { serverName: 'S' },
      });
    }
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      registry.get(`mcp:s::p${i % 100}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('10000 次 search < 500ms', () => {
    const registry = new McpPromptRegistry();
    for (let i = 0; i < 100; i++) {
      registry.register({
        id: `mcp:s::p${i}`,
        name: `prompt_${i}`,
        description: `Description for prompt ${i}`,
        arguments: [],
        source: 'mcp:s',
        tags: [],
        createdAt: i,
        metadata: { serverName: 'S' },
      });
    }
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      registry.search(`prompt_${i % 100}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('MCP 性能 - Mock Subprocess', () => {
  it('1000 次 write/send 循环 < 500ms', async () => {
    const { createMockSubprocess } = await import('./mcpMockSubprocess');
    const proc = createMockSubprocess();
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      proc.writeToStdin(
        JSON.stringify({ jsonrpc: '2.0', id: i, method: 'test' }) + '\n',
      );
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    proc.kill();
  });

  it('100 次 parseStdoutMessages 1KB 消息 < 200ms', async () => {
    const { parseStdoutMessages } = await import('./mcpMockSubprocess');
    const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: 'x'.repeat(1024) } });
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      parseStdoutMessages(msg);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe('MCP 性能 - 客户端生命周期', () => {
  function createBenchClient(transport: BenchMockTransport): McpClient {
    const client = new McpClient({
      serverId: 'bench',
      serverName: 'Bench',
      transport: { type: 'stdio', command: 'mock' },
    });
    client.setTransport(transport);
    return client;
  }

  it('10 次完整生命周期 < 1s', async () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      const transport = new BenchMockTransport();
      const client = createBenchClient(transport);
      await client.connect();
      await client.listTools();
      await client.close();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('MCP 性能 - 提示词参数校验', () => {
  it('10000 次 validateArgs < 200ms', async () => {
    const { validateArgs } = await import('./mcpPromptIntegration');
    const prompt = {
      id: 'mcp:s::p',
      name: 'p',
      arguments: [
        { name: 'a', required: true },
        { name: 'b', required: false },
        { name: 'c', required: false, enum: ['x', 'y', 'z'] },
        { name: 'd', required: false, pattern: '^\\d+$' },
      ],
      source: 'mcp:s',
      tags: [],
      createdAt: 0,
      metadata: { serverName: 'S' },
    };
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      validateArgs(prompt, { a: 'x', c: 'x', d: '123' });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe('MCP 性能 - 插值', () => {
  it('10000 次 interpolate < 200ms', async () => {
    const { interpolate } = await import('./mcpPromptIntegration');
    const template = 'Hello ${args.name}, you are ${args.age} years old in ${metadata.env.PATH}';
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      interpolate(template, {
        args: { name: 'Alice', age: '30' },
        metadata: { env: { PATH: '/usr/bin' } },
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
