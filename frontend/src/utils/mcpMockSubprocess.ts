/**
 * # ============================================================
 * # MCP Mock Subprocess (v1.0.0 Cycle 40 G40-01)
 * # ============================================================
 * # 核心作用：模拟真实 MCP stdio 服务器进程
 * #           用于端到端测试 StdioMcpTransport
 * #           支持脚本化响应 + 场景模拟 + 性能基准
 * # 替代：无需启动真实 npx 子进程
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-01 初次创建
 * # ============================================================
 */

import type { JsonRpcMessage, JsonRpcRequest } from './mcpTypes';

// ============ 类型定义 ============

/**
 * Mock 进程脚本定义
 * 控制 mock 进程对客户端消息的响应行为
 */
export type ResponseScript =
  | { type: 'echo' }
  | { type: 'fixture'; responses: Map<string, JsonRpcMessage> }
  | {
      type: 'functional';
      handler: (req: JsonRpcRequest) => JsonRpcMessage | Promise<JsonRpcMessage>;
    }
  | { type: 'initialize-then-tools'; tools: unknown[]; resources?: unknown[]; prompts?: unknown[] };

/**
 * Mock 进程配置
 */
export interface MockSubprocessOptions {
  /** 响应脚本 */
  script?: ResponseScript;
  /** 全局响应延迟（毫秒） */
  responseDelayMs?: number;
  /** 是否自动响应 initialize */
  autoInitialize?: boolean;
  /** 服务器名称 */
  serverName?: string;
  /** 服务器版本 */
  serverVersion?: string;
  /** 模拟能力 */
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: Record<string, never>;
  };
}

/**
 * 进程统计信息
 */
export interface MockSubprocessStats {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  startedAt: number;
  endedAt?: number;
  errors: number;
}

// ============ 内部流类型 ============

/**
 * 简单的 ReadableStream 实现（用于模拟 stdout/stderr）
 */
class MockReadableStream {
  private chunks: string[] = [];
  private listeners: Array<(chunk: string) => void> = [];
  private closed: boolean = false;

  push(chunk: string): void {
    if (this.closed) return;
    this.chunks.push(chunk);
    // 异步通知
    setTimeout(() => {
      if (this.closed) return;
      while (this.chunks.length > 0) {
        const c = this.chunks.shift()!;
        for (const l of this.listeners) {
          try {
            l(c);
          } catch {
            /* ignore */
          }
        }
      }
    }, 0);
  }

  close(): void {
    this.closed = true;
  }

  subscribe(listener: (chunk: string) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

/**
 * 简单的 WritableStream 实现（用于模拟 stdin）
 */
class MockWritableStream {
  private messages: JsonRpcMessage[] = [];
  private rawChunks: string[] = [];
  private messageListeners: Array<(msg: JsonRpcMessage) => void> = [];
  private rawListeners: Array<(chunk: string) => void> = [];

  /** 客户端写入数据（由测试驱动） */
  write(data: string): void {
    this.rawChunks.push(data);
    for (const l of this.rawListeners) l(data);

    // 尝试解析为 JSON-RPC 消息
    const lines = data.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.messages.push(msg);
        for (const l of this.messageListeners) l(msg);
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }

  onMessage(listener: (msg: JsonRpcMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  onRaw(listener: (chunk: string) => void): () => void {
    this.rawListeners.push(listener);
    return () => {
      this.rawListeners = this.rawListeners.filter((l) => l !== listener);
    };
  }

  getMessages(): JsonRpcMessage[] {
    return [...this.messages];
  }

  getRawChunks(): string[] {
    return [...this.rawChunks];
  }
}

// ============ MockSubprocess 主类 ============

/**
 * Mock 子进程
 * 模拟真实 MCP stdio 服务器的所有行为
 */
export class MockSubprocess {
  private options: Required<MockSubprocessOptions>;
  private stdout: MockReadableStream;
  private stderr: MockReadableStream;
  private stdin: MockWritableStream;
  private _isRunning: boolean = false;
  private _exitCode: number | null = null;
  private _exitListeners: Array<(code: number | null) => void> = [];
  private _errorListeners: Array<(err: Error) => void> = [];
  private stats: MockSubprocessStats;
  private fixtureIndex: number = 0;

  constructor(options: MockSubprocessOptions = {}) {
    this.options = {
      script: options.script ?? { type: 'echo' },
      responseDelayMs: options.responseDelayMs ?? 0,
      autoInitialize: options.autoInitialize ?? true,
      serverName: options.serverName ?? 'mock-server',
      serverVersion: options.serverVersion ?? '1.0.0',
      capabilities: options.capabilities ?? {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
    };
    this.stdout = new MockReadableStream();
    this.stderr = new MockReadableStream();
    this.stdin = new MockWritableStream();
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      startedAt: 0,
      errors: 0,
    };

    // 监听客户端写入
    this.stdin.onRaw((chunk) => {
      this.stats.messagesReceived += 1;
      this.stats.bytesReceived += chunk.length;
    });

    this.stdin.onMessage((msg) => {
      void this.handleIncoming(msg);
    });
  }

  // ============ 生命周期 ============

  /**
   * 启动 mock 进程
   */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this._exitCode = null;
    this.stats.startedAt = Date.now();
  }

  /**
   * 终止 mock 进程
   */
  kill(exitCode: number = 0): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    this._exitCode = exitCode;
    this.stats.endedAt = Date.now();
    this.stdout.close();
    this.stderr.close();
    for (const l of this._exitListeners) {
      try {
        l(exitCode);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 模拟错误
   */
  emitError(err: Error): void {
    this.stats.errors += 1;
    for (const l of this._errorListeners) {
      try {
        l(err);
      } catch {
        /* ignore */
      }
    }
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  getExitCode(): number | null {
    return this._exitCode;
  }

  // ============ 事件订阅 ============

  onExit(listener: (code: number | null) => void): () => void {
    this._exitListeners.push(listener);
    return () => {
      this._exitListeners = this._exitListeners.filter((l) => l !== listener);
    };
  }

  onError(listener: (err: Error) => void): () => void {
    this._errorListeners.push(listener);
    return () => {
      this._errorListeners = this._errorListeners.filter((l) => l !== listener);
    };
  }

  // ============ 流访问 ============

  getStdout(): MockReadableStream {
    return this.stdout;
  }

  getStderr(): MockReadableStream {
    return this.stderr;
  }

  getStdin(): MockWritableStream {
    return this.stdin;
  }

  // ============ 测试辅助 ============

  /**
   * 测试驱动：客户端写入数据
   */
  writeToStdin(data: string): void {
    this.stdin.write(data);
  }

  /**
   * 主动发送 JSON-RPC 消息到 stdout
   */
  send(message: JsonRpcMessage): void {
    if (!this._isRunning) return;
    const data = JSON.stringify(message) + '\n';
    this.stdout.push(data);
    this.stats.messagesSent += 1;
    this.stats.bytesSent += data.length;
  }

  /**
   * 主动写入 stderr
   */
  logToStderr(text: string): void {
    this.stderr.push(text + '\n');
  }

  getStats(): MockSubprocessStats {
    return { ...this.stats };
  }

  // ============ 内部：响应处理 ============

  private async handleIncoming(msg: JsonRpcMessage): Promise<void> {
    // 仅处理请求
    if (!('method' in msg) || !('id' in msg)) return;
    const req = msg as JsonRpcRequest;

    const delay = this.options.responseDelayMs;
    const fire = async () => {
      if (!this._isRunning) return;
      try {
        const response = await this.buildResponse(req);
        if (response) {
          this.send(response);
        }
      } catch (err) {
        // 构造错误响应
        const errorId = req.id;
        this.send({
          jsonrpc: '2.0',
          id: errorId,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    };

    if (delay > 0) {
      setTimeout(fire, delay);
    } else {
      await fire();
    }
  }

  private async buildResponse(req: JsonRpcRequest): Promise<JsonRpcMessage | null> {
    const script = this.options.script;

    // 特殊处理：initialize 请求
    if (req.method === 'initialize') {
      if (this.options.autoInitialize) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: this.options.capabilities,
            serverInfo: {
              name: this.options.serverName,
              version: this.options.serverVersion,
            },
          },
        };
      }
    }

    // 处理 notifications/initialized（不返回响应）
    if (req.method === 'notifications/initialized') {
      return null;
    }

    switch (script.type) {
      case 'echo':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { echo: req.params ?? null, method: req.method },
        };

      case 'fixture': {
        const responses = Array.from(script.responses.values());
        const response = responses[this.fixtureIndex % responses.length];
        this.fixtureIndex += 1;
        if (!response) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32603, message: 'No more fixtures' },
          };
        }
        // 覆盖 id 为当前请求 id
        return { ...response, id: req.id } as JsonRpcMessage;
      }

      case 'functional':
        return await script.handler(req);

      case 'initialize-then-tools': {
        if (req.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { tools: script.tools },
          };
        }
        if (req.method === 'resources/list' && script.resources) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { resources: script.resources },
          };
        }
        if (req.method === 'prompts/list' && script.prompts) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { prompts: script.prompts },
          };
        }
        // 默认回显
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { method: req.method, params: req.params ?? null },
        };
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建 Mock 子进程（标准用法）
 */
export function createMockSubprocess(options?: MockSubprocessOptions): MockSubprocess {
  const proc = new MockSubprocess(options);
  proc.start();
  return proc;
}

/**
 * 创建回显式 Mock（用于基础测试）
 */
export function createEchoMockSubprocess(): MockSubprocess {
  return createMockSubprocess({ script: { type: 'echo' } });
}

/**
 * 创建带工具列表的 Mock（用于工具调用测试）
 */
export function createToolsMockSubprocess(tools: Array<{
  name: string;
  description?: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown> };
}>): MockSubprocess {
  return createMockSubprocess({
    script: { type: 'initialize-then-tools', tools },
  });
}

// ============ 测试辅助工具 ============

/**
 * 等待下一次消息（用于异步测试）
 */
export function waitForNextMessage(
  stream: MockReadableStream,
  timeoutMs: number = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);
    const unsub = stream.subscribe((chunk) => {
      clearTimeout(timer);
      unsub();
      resolve(chunk);
    });
  });
}

/**
 * 等待消息总数达到 N
 */
export function waitForMessageCount(
  stream: MockReadableStream,
  count: number,
  timeoutMs: number = 5000,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          `Timeout waiting for ${count} messages (got ${messages.length} in ${timeoutMs}ms)`,
        ),
      );
    }, timeoutMs);
    const unsub = stream.subscribe((chunk) => {
      messages.push(chunk);
      if (messages.length >= count) {
        clearTimeout(timer);
        unsub();
        resolve(messages);
      }
    });
  });
}

/**
 * 解析流中的所有 JSON 消息
 */
export function parseStdoutMessages(raw: string | string[]): JsonRpcMessage[] {
  const text = Array.isArray(raw) ? raw.join('\n') : raw;
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as JsonRpcMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is JsonRpcMessage => m !== null);
}

// 显式引用防止 tree-shake
export type { JsonRpcMessage, JsonRpcRequest };
