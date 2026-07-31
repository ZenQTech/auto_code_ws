/**
 * # ============================================================
 * # MCP Mock Filesystem Transport (v1.0.0 Cycle 43 G43-01)
 * # ============================================================
 * # 核心作用：模拟 @modelcontextprotocol/server-filesystem 的离线行为
 * #           用于沙箱环境（无法 npx 下载时）的回归测试
 * #           基于 mcpMockSubprocess 框架实现
 * # 实现功能：
 * #   - read_file / write_file / list_directory / search_files
 * #   - list_allowed_directories / get_file_info
 * #   - 路径安全校验（必须在 allowedDirectories 内）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-01 初次创建
 * # ============================================================
 */

import { BaseTransport } from './mcpTransport';
import type { JsonRpcMessage, JsonRpcRequest } from './mcpTypes';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ============ 类型定义 ============

/**
 * Mock filesystem 配置
 */
export interface MockFilesystemConfig {
  allowedDirectories: string[];
  /** 模拟延迟（毫秒） */
  responseDelayMs?: number;
  /** 是否启用文件操作（默认 true） */
  enableFileOps?: boolean;
}

// ============ Mock Transport 实现 ============

/**
 * 创建 mock filesystem 传输
 * 实现完整的 MCP JSON-RPC 协议 + filesystem 工具
 */
export function createMockFilesystemTransport(
  allowedDirectories: string[],
  options: { responseDelayMs?: number; enableFileOps?: boolean } = {},
): MockFilesystemTransport {
  return new MockFilesystemTransport({
    allowedDirectories,
    responseDelayMs: options.responseDelayMs ?? 0,
    enableFileOps: options.enableFileOps ?? true,
  });
}

export class MockFilesystemTransport extends BaseTransport {
  public readonly type = 'stdio' as const;
  private readonly config: Required<MockFilesystemConfig>;
  private readonly virtualFiles: Map<string, string> = new Map();

  constructor(config: MockFilesystemConfig) {
    super();
    this.config = {
      allowedDirectories: [...config.allowedDirectories],
      responseDelayMs: config.responseDelayMs ?? 0,
      enableFileOps: config.enableFileOps ?? true,
    };
    // 初始化虚拟文件
    this.virtualFiles.set('/test/hello.txt', 'Hello, World!\nThis is a test file.');
    this.virtualFiles.set('/test/data.json', '{"name": "test", "value": 42, "items": [1, 2, 3]}');
  }

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!('method' in message)) {
      return;
    }
    const req = message as JsonRpcRequest;

    setTimeout(async () => {
      try {
        const response = await this.handleRequest(req);
        this.deliverMessage(response);
      } catch (err) {
        this.deliverMessage({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }, this.config.responseDelayMs);
  }

  private deliverMessage(msg: JsonRpcMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcMessage> {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-filesystem', version: '1.0.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            tools: this.listToolDefinitions(),
          },
        };

      case 'tools/call': {
        const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
        const toolName = params?.name ?? '';
        const args = params?.arguments ?? {};
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: await this.callTool(toolName, args),
        };
      }

      case 'notifications/initialized':
        // 静默处理
        return { jsonrpc: '2.0', id: req.id, result: {} };

      case 'ping':
        return { jsonrpc: '2.0', id: req.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  }

  private listToolDefinitions() {
    return [
      {
        name: 'read_file',
        description: 'Read the complete contents of a file from the file system.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the file' } },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write contents to a file in the file system.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List all files and directories in a given path.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the directory' } },
          required: ['path'],
        },
      },
      {
        name: 'search_files',
        description: 'Search for files matching a pattern.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Starting directory' },
            pattern: { type: 'string', description: 'Search pattern' },
          },
          required: ['path', 'pattern'],
        },
      },
      {
        name: 'get_file_info',
        description: 'Retrieve information about a file or directory.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'list_allowed_directories',
        description: 'Returns the list of directories that the server is allowed to access.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
      switch (name) {
        case 'read_file':
          return await this.handleReadFile(args.path as string);
        case 'write_file':
          return await this.handleWriteFile(args.path as string, (args.content as string) ?? '');
        case 'list_directory':
          return await this.handleListDirectory(args.path as string);
        case 'search_files':
          return this.handleSearchFiles(args.path as string, args.pattern as string);
        case 'get_file_info':
          return await this.handleGetFileInfo(args.path as string);
        case 'list_allowed_directories':
          return this.handleListAllowedDirs();
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }

  private validatePath(p: string): void {
    if (!p) throw new Error('Path is required');
    const normalized = path.resolve(p);
    const allowed = this.config.allowedDirectories.some((dir) => {
      const resolvedDir = path.resolve(dir);
      return normalized === resolvedDir || normalized.startsWith(resolvedDir + path.sep);
    });
    if (!allowed) {
      throw new Error(`Access denied: path '${p}' is not in allowed directories`);
    }
  }

  private async handleReadFile(p: string): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    this.validatePath(p);
    // 优先从虚拟文件读取
    if (this.virtualFiles.has(p)) {
      return {
        content: [{ type: 'text', text: this.virtualFiles.get(p)! }],
      };
    }
    // 尝试从真实文件系统读取（如果启用）
    if (this.config.enableFileOps) {
      try {
        const content = await fs.readFile(p, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error reading file: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
    return {
      content: [{ type: 'text', text: `File not found: ${p}` }],
      isError: true,
    };
  }

  private async handleWriteFile(p: string, content: string) {
    this.validatePath(p);
    this.virtualFiles.set(p, content);
    if (this.config.enableFileOps) {
      try {
        await fs.writeFile(p, content, 'utf-8');
      } catch (err) {
        // 写入虚拟文件即可
      }
    }
    return {
      content: [{ type: 'text', text: `Successfully wrote to ${p}` }],
    };
  }

  private async handleListDirectory(p: string) {
    this.validatePath(p);
    if (!this.config.enableFileOps) {
      return {
        content: [{ type: 'text', text: '[]' }],
      };
    }
    try {
      const entries = await fs.readdir(p, { withFileTypes: true });
      const list = entries.map((e: { isDirectory: () => boolean; name: string }) =>
        `${e.isDirectory() ? 'd' : 'f'}: ${e.name}`,
      );
      return {
        content: [{ type: 'text', text: list.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  private handleSearchFiles(p: string, pattern: string) {
    this.validatePath(p);
    const matches: string[] = [];
    for (const filePath of this.virtualFiles.keys()) {
      if (filePath.includes(pattern) || path.basename(filePath).includes(pattern)) {
        matches.push(filePath);
      }
    }
    return {
      content: [{ type: 'text', text: matches.length > 0 ? matches.join('\n') : 'No files matched' }],
    };
  }

  private async handleGetFileInfo(p: string) {
    this.validatePath(p);
    if (!this.config.enableFileOps) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ path: p, type: 'file' }) }],
      };
    }
    try {
      const stat = await fs.stat(p);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              path: p,
              type: stat.isDirectory() ? 'directory' : 'file',
              size: stat.size,
              modified: stat.mtime.toISOString(),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  private handleListAllowedDirs() {
    return {
      content: [{ type: 'text', text: this.config.allowedDirectories.join('\n') }],
    };
  }

  async close(): Promise<void> {
    this._isOpen = false;
    this._closed = true;
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {
        /* ignore */
      }
    }
  }

  isOpen(): boolean {
    return this._isOpen && !this._closed;
  }
}
