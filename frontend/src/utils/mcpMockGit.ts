/**
 * # ============================================================
 * # MCP Mock Git Transport (v1.0.0 Cycle 43 G43-02)
 * # ============================================================
 * # 核心作用：模拟 @modelcontextprotocol/server-git 的离线行为
 * #           工具: git_status / git_diff / git_log / git_show
 * #           / git_branch_list / git_commit
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-02 初次创建
 * # ============================================================
 */

import { BaseTransport } from './mcpTransport';
import type { JsonRpcMessage, JsonRpcRequest } from './mcpTypes';
import * as path from 'node:path';

// ============ 类型定义 ============

export interface MockGitConfig {
  repositoryPath: string;
  /** 模拟延迟（毫秒） */
  responseDelayMs?: number;
  /** 模拟的提交历史 */
  commits?: GitCommit[];
  /** 模拟的工作区状态 */
  status?: GitStatus;
  /** 模拟的分支 */
  branches?: GitBranch[];
}

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files?: string[];
}

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

// ============ Mock Transport 实现 ============

export function createMockGitTransport(
  repositoryPath: string,
  options: Partial<MockGitConfig> = {},
): MockGitTransport {
  return new MockGitTransport({
    repositoryPath,
    responseDelayMs: options.responseDelayMs ?? 0,
    commits: options.commits ?? [
      {
        hash: 'a1b2c3d4e5f6',
        author: 'Test Author',
        email: 'test@example.com',
        date: '2026-07-30T10:00:00Z',
        message: 'Initial commit',
        files: ['README.md', 'src/index.ts'],
      },
      {
        hash: 'f6e5d4c3b2a1',
        author: 'Test Author',
        email: 'test@example.com',
        date: '2026-07-31T14:00:00Z',
        message: 'Add MCP integration',
        files: ['src/mcp/client.ts', 'src/mcp/server.ts'],
      },
    ],
    status: options.status ?? {
      branch: 'main',
      modified: ['src/mcp/integration.ts'],
      added: ['src/mcp/test.ts'],
      deleted: [],
      untracked: ['.env.local'],
    },
    branches: options.branches ?? [
      { name: 'main', current: true },
      { name: 'develop', current: false },
      { name: 'feature/mcp-integration', current: false, remote: 'origin/feature/mcp-integration' },
    ],
  });
}

export class MockGitTransport extends BaseTransport {
  public readonly type = 'stdio' as const;
  private readonly config: Required<MockGitConfig>;

  constructor(config: MockGitConfig) {
    super();
    this.config = {
      repositoryPath: config.repositoryPath,
      responseDelayMs: config.responseDelayMs ?? 0,
      commits: config.commits ?? [],
      status: config.status ?? { branch: 'main', modified: [], added: [], deleted: [], untracked: [] },
      branches: config.branches ?? [],
    };
  }

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!('method' in message)) {
      return;
    }
    const req = message as JsonRpcRequest;

    setTimeout(() => {
      try {
        const response = this.handleRequest(req);
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

  private handleRequest(req: JsonRpcRequest): JsonRpcMessage {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-git', version: '1.0.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: this.listToolDefinitions() },
        };

      case 'tools/call': {
        const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
        const toolName = params?.name ?? '';
        const args = params?.arguments ?? {};
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: this.callTool(toolName, args),
        };
      }

      case 'notifications/initialized':
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
        name: 'git_status',
        description: 'Shows the working tree status.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'git_diff',
        description: 'Show changes between commits, commit and working tree, etc.',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string', description: 'Commit hash or ref' } },
        },
      },
      {
        name: 'git_log',
        description: 'Show commit logs.',
        inputSchema: {
          type: 'object',
          properties: {
            max_count: { type: 'number', description: 'Maximum number of commits' },
          },
        },
      },
      {
        name: 'git_show',
        description: 'Show various types of objects.',
        inputSchema: {
          type: 'object',
          properties: { commit: { type: 'string', description: 'Commit hash' } },
          required: ['commit'],
        },
      },
      {
        name: 'git_branch_list',
        description: 'List all branches.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  private callTool(
    name: string,
    _args: Record<string, unknown>,
  ): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      switch (name) {
        case 'git_status':
          return this.handleStatus();
        case 'git_diff':
          return this.handleDiff();
        case 'git_log':
          return this.handleLog();
        case 'git_show':
          return this.handleShow();
        case 'git_branch_list':
          return this.handleBranchList();
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

  private handleStatus() {
    const s = this.config.status;
    const lines: string[] = [];
    lines.push(`On branch ${s.branch}`);
    if (s.modified.length > 0) {
      lines.push('Changes not staged for commit:');
      s.modified.forEach((f) => lines.push(`  modified: ${f}`));
    }
    if (s.added.length > 0) {
      lines.push('Changes to be committed:');
      s.added.forEach((f) => lines.push(`  new file: ${f}`));
    }
    if (s.untracked.length > 0) {
      lines.push('Untracked files:');
      s.untracked.forEach((f) => lines.push(`  ${f}`));
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private handleDiff() {
    return {
      content: [
        {
          type: 'text',
          text: `diff --git a/src/mcp/integration.ts b/src/mcp/integration.ts
+ new MCP integration module`,
        },
      ],
    };
  }

  private handleLog() {
    const lines = this.config.commits.map(
      (c) => `commit ${c.hash}\nAuthor: ${c.author} <${c.email}>\nDate: ${c.date}\n\n    ${c.message}\n`,
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private handleShow() {
    const c = this.config.commits[0];
    if (!c) {
      return { content: [{ type: 'text', text: 'No commits' }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: `commit ${c.hash}\nAuthor: ${c.author} <${c.email}>\nDate: ${c.date}\n\n    ${c.message}`,
        },
      ],
    };
  }

  private handleBranchList() {
    const lines = this.config.branches.map((b) => `${b.current ? '* ' : '  '}${b.name}${b.remote ? ' -> ' + b.remote : ''}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
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
