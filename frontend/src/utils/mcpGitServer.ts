/**
 * # ============================================================
 * # MCP Git Server 集成 (v1.0.0 Cycle 43 G43-02)
 * # ============================================================
 * # 核心作用：连接 @modelcontextprotocol/server-git 真实服务器
 * #           提供 git 仓库操作的 MCP 工具
 * # 协议版本：MCP 2024-11-05
 * # 沙箱兼容：auto 模式自动回退到离线模拟
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-02 初次创建
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
 */
async function dynamicSpawn(
  command: string,
  args: string[],
  options: { stdio: [string, string, string]; env: Record<string, string | undefined> }
): Promise<{ on: (event: string, cb: (err: Error) => void) => void } | null> {
  if (typeof window !== 'undefined') {
    console.warn('[mcpGitServer] spawn() 在浏览器环境中不可用');
    return null;
  }
  try {
    const cp = await import('node:child_process');
    return cp.spawn(command, args, options) as any;
  } catch (err) {
    console.error('[mcpGitServer] dynamicSpawn failed:', err);
    return null;
  }
}

// ============ 类型定义 ============

/**
 * Git MCP 服务器选项
 */
export interface GitServerOptions {
  /** 服务器唯一 ID */
  serverId?: string;
  /** 显示名称 */
  serverName?: string;
  /** git 仓库根目录 */
  repositoryPath: string;
  /** 传输层类型：'real' 启动 npx 子进程，'mock' 使用离线模拟 */
  mode?: 'real' | 'mock' | 'auto';
  /** npx 命令（默认: npx） */
  npxCommand?: string;
  /** 包名（默认: @modelcontextprotocol/server-git） */
  packageName?: string;
  /** 连接超时（毫秒） */
  connectTimeoutMs?: number;
  /** mock 模式：自定义提交历史 */
  commits?: import('./mcpMockGit').GitCommit[];
  /** mock 模式：自定义工作区状态 */
  status?: import('./mcpMockGit').GitStatus;
  /** mock 模式：自定义分支 */
  branches?: import('./mcpMockGit').GitBranch[];
}

/**
 * Git MCP 服务器上下文
 */
export interface GitServerContext {
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

/**
 * 启动 git MCP 服务器
 */
export async function createGitServer(options: GitServerOptions): Promise<GitServerContext> {
  const serverId = options.serverId ?? 'git';
  const serverName = options.serverName ?? 'Git MCP';
  const mode = options.mode ?? 'auto';
  const connectTimeoutMs = options.connectTimeoutMs ?? 10000;

  if (!options.repositoryPath) {
    throw new Error('Git server requires repositoryPath');
  }

  if (mode === 'mock') {
    return createMockGitServer(serverId, serverName, options);
  }

  if (mode === 'real') {
    return createRealGitServer(serverId, serverName, options, connectTimeoutMs);
  }

  try {
    return await createRealGitServer(serverId, serverName, options, connectTimeoutMs);
  } catch (err) {
    console.warn(
      `[Git MCP] Real server failed, falling back to mock: ${err instanceof Error ? err.message : String(err)}`,
    );
    return createMockGitServer(serverId, serverName, options);
  }
}

async function createRealGitServer(
  serverId: string,
  serverName: string,
  options: GitServerOptions,
  connectTimeoutMs: number,
): Promise<GitServerContext> {
  const npxCommand = options.npxCommand ?? 'npx';
  const packageName = options.packageName ?? '@modelcontextprotocol/server-git';
  const args = ['-y', packageName, '--repository', options.repositoryPath];

  const childProcess = await dynamicSpawn(npxCommand, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env } as Record<string, string | undefined>,
  });

  const transport = new StdioMcpTransport({
    type: 'stdio',
    command: npxCommand,
    args: ['--repository', options.repositoryPath],
  });

  await transport.start();

  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: npxCommand, args: ['--repository', options.repositoryPath] } as TransportOptions,
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

async function createMockGitServer(
  serverId: string,
  serverName: string,
  options: GitServerOptions,
): Promise<GitServerContext> {
  const { createMockGitTransport } = await import('./mcpMockGit');
  const transport = createMockGitTransport(options.repositoryPath, {
    commits: options.commits,
    status: options.status,
    branches: options.branches,
  });

  const client = new McpClient({
    serverId,
    serverName,
    transport: { type: 'stdio', command: 'mock-git' } as TransportOptions,
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

/**
 * 使用 git 服务器的上下文管理器
 */
export async function withGitServer<T>(
  options: GitServerOptions,
  fn: (ctx: GitServerContext) => Promise<T>,
): Promise<T> {
  const ctx = await createGitServer(options);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}
