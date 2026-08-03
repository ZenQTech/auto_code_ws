/**
 * # ============================================================
 * # MCP Filesystem Server 集成 (v1.0.0 Cycle 43 G43-01)
 * # ============================================================
 * # 核心作用：连接 @modelcontextprotocol/server-filesystem 真实服务器
 * #           提供本地文件系统的 MCP 工具/资源访问
 * # 协议版本：MCP 2024-11-05
 * # 沙箱兼容：自动检测网络可用性，禁用时回退到离线模拟模式
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-01 初次创建
 * #   - 2026-08-03 | v1.0.1 | Cycle 59 G59-FIX: 动态导入 node:child_process
 * #                                 修复浏览器端 child_process 报错导致页面崩溃
 * # ====================================
 */

import { McpClient } from './mcpClient';
import { McpToolBridge } from './mcpToolBridge';
import { McpResourceBridge } from './mcpResourceBridge';
import { McpPromptBridge } from './mcpPromptBridge';
import { StdioMcpTransport } from './mcpTransportStdio';
import type { TransportOptions } from './mcpTypes';

/**
 * 动态导入 node:child_process（避免浏览器端静态导入报错）
 * 浏览器环境下返回 null
 */
async function dynamicSpawn(
  command: string,
  args: string[],
  options: { stdio: [string, string, string]; env: Record<string, string | undefined> }
): Promise<{ on: (event: string, cb: (err: Error) => void) => void } | null> {
  // 浏览器环境检测
  if (typeof window !== 'undefined') {
    console.warn(
      '[mcpFilesystemServer] spawn() 在浏览器环境中不可用，已跳过子进程启动。请使用 Node.js 环境或离线模拟模式。'
    );
    return null;
  }
  try {
    // 使用 eval 避免 Vite 静态分析（仅在 Node 环境执行）
    const cp = await import('node:child_process');
    return cp.spawn(command, args, options) as any;
  } catch (err) {
    console.error('[mcpFilesystemServer] dynamicSpawn failed:', err);
    return null;
  }
}

// ============ 类型定义 ============

/**
 * Filesystem MCP 服务器选项
 */
export interface FilesystemServerOptions {
  /** 服务器唯一 ID */
  serverId?: string;
  /** 显示名称 */
  serverName?: string;
  /** 允许访问的根目录列表 */
  allowedDirectories: string[];
  /** 传输层类型：'real' 启动 npx 子进程，'mock' 使用离线模拟 */
  mode?: 'real' | 'mock' | 'auto';
  /** npx 命令（默认: npx） */
  npxCommand?: string;
  /** 包名（默认: @modelcontextprotocol/server-filesystem） */
  packageName?: string;
  /** 连接超时（毫秒） */
  connectTimeoutMs?: number;
}

/**
 * Filesystem MCP 服务器上下文
 */
export interface FilesystemServerContext {
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

/**
 * Filesystem 工具能力定义
 */
export interface FilesystemTools {
  read_file: { path: string };
  write_file: { path: string; content: string };
  list_directory: { path: string };
  search_files: { path: string; pattern: string };
  get_file_info: { path: string };
  list_allowed_directories: Record<string, never>;
}

// ============ 服务器启动 ============

/**
 * 启动 filesystem MCP 服务器
 * 自动检测网络可用性：
 * - 'real': 强制启动 npx 真实进程
 * - 'mock': 强制使用离线模拟
 * - 'auto': 先尝试真实，失败后回退
 */
export async function createFilesystemServer(
  options: FilesystemServerOptions,
): Promise<FilesystemServerContext> {
  const serverId = options.serverId ?? 'filesystem';
  const serverName = options.serverName ?? 'Filesystem MCP';
  const mode = options.mode ?? 'auto';
  const connectTimeoutMs = options.connectTimeoutMs ?? 10000;

  if (options.allowedDirectories.length === 0) {
    throw new Error('Filesystem server requires at least one allowed directory');
  }

  if (mode === 'mock') {
    return createMockFilesystemServer(serverId, serverName, options);
  }

  if (mode === 'real') {
    return createRealFilesystemServer(serverId, serverName, options, connectTimeoutMs);
  }

  // auto: 先尝试真实
  try {
    return await createRealFilesystemServer(serverId, serverName, options, connectTimeoutMs);
  } catch (err) {
    console.warn(
      `[Filesystem MCP] Real server failed, falling back to mock: ${err instanceof Error ? err.message : String(err)}`,
    );
    return createMockFilesystemServer(serverId, serverName, options);
  }
}

/**
 * 启动真实的 filesystem MCP 服务器（npx 进程）
 */
async function createRealFilesystemServer(
  serverId: string,
  serverName: string,
  options: FilesystemServerOptions,
  connectTimeoutMs: number,
): Promise<FilesystemServerContext> {
  const npxCommand = options.npxCommand ?? 'npx';
  const packageName = options.packageName ?? '@modelcontextprotocol/server-filesystem';
  const args = ['-y', packageName, ...options.allowedDirectories];

  // 启动子进程（动态 spawn，浏览器环境下返回 null）
  const childProcess = await dynamicSpawn(npxCommand, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env } as Record<string, string | undefined>,
  });

  // 错误处理
  let _spawnError: Error | null = null;
  if (childProcess) {
    childProcess.on('error', (err: Error) => {
      _spawnError = err;
    });
  }

  // 创建 Stdio 传输
  const transport = new StdioMcpTransport({
    type: 'stdio',
    command: npxCommand,
    args: options.allowedDirectories,
  });

  // 等待传输启动
  await transport.start();

  // 创建客户端
  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: npxCommand, args: options.allowedDirectories } as TransportOptions,
  });
  client.setTransport(transport);

  // 连接到服务器
  await Promise.race([
    client.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${connectTimeoutMs}ms`)), connectTimeoutMs),
    ),
  ]);

  // 创建桥接
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
          // 等待 1 秒后强制 SIGKILL
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

/**
 * 启动 mock filesystem MCP 服务器（离线模拟）
 * 使用 mcpMockSubprocess 框架模拟真实 stdio 行为
 */
async function createMockFilesystemServer(
  serverId: string,
  serverName: string,
  options: FilesystemServerOptions,
): Promise<FilesystemServerContext> {
  // 创建 mock 传输
  const { createMockFilesystemTransport } = await import('./mcpMockFilesystem');
  const transport = createMockFilesystemTransport(options.allowedDirectories);

  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: 'mock-filesystem' } as TransportOptions,
  });
  client.setTransport(transport);
  await client.connect();

  // 创建桥接
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

/**
 * 使用 filesystem 服务器的上下文管理器
 * 自动启动 + 关闭
 *
 * @example
 * ```ts
 * const result = await withFilesystemServer(
 *   { allowedDirectories: ['/tmp/test'] },
 *   async (ctx) => {
 *     const tools = await ctx.client.listTools();
 *     return tools.length;
 *   }
 * );
 * ```
 */
export async function withFilesystemServer<T>(
  options: FilesystemServerOptions,
  fn: (ctx: FilesystemServerContext) => Promise<T>,
): Promise<T> {
  const ctx = await createFilesystemServer(options);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}
