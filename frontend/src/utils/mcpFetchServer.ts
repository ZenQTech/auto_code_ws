/**
 * # ============================================================
 * # MCP Fetch Server 集成 (v1.0.0 Cycle 43 G43-03)
 * # ============================================================
 * # 核心作用：连接 @modelcontextprotocol/server-fetch 真实服务器
 * #           提供 HTTP 请求的 MCP 工具
 * # 协议版本：MCP 2024-11-05
 * # 沙箱兼容：auto 模式自动回退到离线模拟
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-03 初次创建
 * # ============================================================
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { McpClient } from './mcpClient';
import { McpToolBridge } from './mcpToolBridge';
import { McpResourceBridge } from './mcpResourceBridge';
import { McpPromptBridge } from './mcpPromptBridge';
import { StdioMcpTransport } from './mcpTransportStdio';
import type { TransportOptions } from './mcpTypes';

// ============ 类型定义 ============

/**
 * Fetch MCP 服务器选项
 */
export interface FetchServerOptions {
  /** 服务器唯一 ID */
  serverId?: string;
  /** 显示名称 */
  serverName?: string;
  /** 允许的 URL 前缀（用于安全控制） */
  allowedUrls?: string[];
  /** 传输层类型：'real' 启动 npx 子进程，'mock' 使用离线模拟 */
  mode?: 'real' | 'mock' | 'auto';
  /** npx 命令（默认: npx） */
  npxCommand?: string;
  /** 包名（默认: @modelcontextprotocol/server-fetch） */
  packageName?: string;
  /** 连接超时（毫秒） */
  connectTimeoutMs?: number;
  /** mock 模式：模拟的响应数据 */
  mockResponses?: MockFetchResponse[];
}

/**
 * Mock 响应
 */
export interface MockFetchResponse {
  url: string;
  status: number;
  statusText: string;
  body: string;
  contentType?: string;
  headers?: Record<string, string>;
}

/**
 * Fetch MCP 服务器上下文
 */
export interface FetchServerContext {
  /** 子进程（仅 real 模式） */
  process?: ChildProcess;
  /** MCP 客户端 */
  client: McpClient;
  /** 工具桥接 */
  toolBridge: McpToolBridge;
  /** 资源桥接 */
  resourceBridge: McpResourceBridge;
  /** 提示词桥接 */
  promptBridge: McpPromptBridge;
  /** 服务器实际模式 */
  mode: 'real' | 'mock';
  /** 关闭函数 */
  close: () => Promise<void>;
}

// ============ 服务器启动 ============

export async function createFetchServer(options: FetchServerOptions): Promise<FetchServerContext> {
  const serverId = options.serverId ?? 'fetch';
  const serverName = options.serverName ?? 'Fetch MCP';
  const mode = options.mode ?? 'auto';
  const connectTimeoutMs = options.connectTimeoutMs ?? 10000;

  if (mode === 'mock') {
    return createMockFetchServer(serverId, serverName, options);
  }

  if (mode === 'real') {
    return createRealFetchServer(serverId, serverName, options, connectTimeoutMs);
  }

  try {
    return await createRealFetchServer(serverId, serverName, options, connectTimeoutMs);
  } catch (err) {
    console.warn(
      `[Fetch MCP] Real server failed, falling back to mock: ${err instanceof Error ? err.message : String(err)}`,
    );
    return createMockFetchServer(serverId, serverName, options);
  }
}

async function createRealFetchServer(
  serverId: string,
  serverName: string,
  options: FetchServerOptions,
  connectTimeoutMs: number,
): Promise<FetchServerContext> {
  const npxCommand = options.npxCommand ?? 'npx';
  const packageName = options.packageName ?? '@modelcontextprotocol/server-fetch';

  const childProcess = spawn(npxCommand, ['-y', packageName], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const transport = new StdioMcpTransport({
    type: 'stdio',
    command: npxCommand,
    args: [],
  });

  await transport.start();

  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: npxCommand, args: [] } as TransportOptions,
  });
  client.setTransport(transport);

  await Promise.race([
    client.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${connectTimeoutMs}ms`)), connectTimeoutMs),
    ),
  ]);

  const toolBridge = new McpToolBridge();
  const resourceBridge = new McpResourceBridge();
  const promptBridge = new McpPromptBridge();

  await toolBridge.registerServer(serverId, client);

  return {
    process: childProcess,
    client,
    toolBridge,
    resourceBridge,
    promptBridge,
    mode: 'real',
    close: async () => {
      try {
        toolBridge.dispose();
        resourceBridge.dispose();
        promptBridge.dispose();
        await client.disconnect();
        await transport.close();
      } finally {
        if (!childProcess.killed) {
          childProcess.kill('SIGTERM');
          const killTimer: unknown = setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 1000);
          if (
            typeof killTimer === 'object' &&
            killTimer !== null &&
            typeof (killTimer as { unref?: () => void }).unref === 'function'
          ) {
            (killTimer as { unref: () => void }).unref();
          }
        }
      }
    },
  };
}

async function createMockFetchServer(
  serverId: string,
  serverName: string,
  options: FetchServerOptions,
): Promise<FetchServerContext> {
  const { createMockFetchTransport } = await import('./mcpMockFetch');
  const transport = createMockFetchTransport({
    allowedUrls: options.allowedUrls,
    mockResponses: options.mockResponses,
  });

  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: 'mock-fetch' } as TransportOptions,
  });
  client.setTransport(transport);
  await client.connect();

  const toolBridge = new McpToolBridge();
  const resourceBridge = new McpResourceBridge();
  const promptBridge = new McpPromptBridge();

  await toolBridge.registerServer(serverId, client);

  return {
    client,
    toolBridge,
    resourceBridge,
    promptBridge,
    mode: 'mock',
    close: async () => {
      toolBridge.dispose();
      resourceBridge.dispose();
      promptBridge.dispose();
      await client.disconnect();
      await transport.close();
    },
  };
}

// ============ 上下文管理器 ============

export async function withFetchServer<T>(
  options: FetchServerOptions,
  fn: (ctx: FetchServerContext) => Promise<T>,
): Promise<T> {
  const ctx = await createFetchServer(options);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}
