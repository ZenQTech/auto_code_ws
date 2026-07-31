/**
 * # ============================================================
 * # MCP Stdio Transport - 本地子进程传输 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 核心作用：通过子进程 stdin/stdout 与本地 MCP 服务器通信
 * #           每行一条 JSON 消息
 * # 适用场景：本地命令行 MCP 服务器
 * #           例如: mcp-server-filesystem / mcp-server-git / mcp-server-github
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

import { BaseTransport } from './mcpTransport';
import {
  type JsonRpcMessage,
  type StdioTransportOptions,
} from './mcpTypes';
import { McpConnectionError, McpParseError } from './mcpErrors';

/**
 * 子进程抽象
 * 封装 Node.js child_process.spawn + 事件监听
 * 在测试中可以被 Mock
 */
interface SpawnedProcess {
  onStdoutData(handler: (chunk: string) => void): void;
  onStderrData(handler: (chunk: string) => void): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
  onError(handler: (err: Error) => void): void;
  writeStdin(data: string): void;
  kill(): void;
  waitReady(): Promise<void>;
}

/**
 * 检测是否在 Node.js 环境
 */
function isNode(): boolean {
  return typeof process !== 'undefined' && Boolean((process as { versions?: { node?: string } }).versions?.node);
}

/**
 * 加载 Node.js child_process 模块
 * 仅在 Node.js 环境下可用
 * 类型使用 unknown 以避免对 @types/node 的依赖
 */
function loadChildProcess(): unknown {
  if (!isNode()) return null;
  try {
    // 通过 eval 避免 TypeScript 检测 require
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicRequire = new Function('m', 'return require(m)');
    return dynamicRequire('child_process');
  } catch {
    return null;
  }
}

interface NodeChildProcessModule {
  spawn(command: string, args: string[], options: {
    env: Record<string, string | undefined>;
    cwd: string;
    stdio: ['pipe', 'pipe', 'pipe'];
  }): NodeChildProcess;
}

interface NodeChildProcess {
  stdin: { write(data: string): void };
  stdout: { on(event: 'data', handler: (data: Uint8Array) => void): void };
  stderr: { on(event: 'data', handler: (data: Uint8Array) => void): void };
  on(event: 'exit', handler: (code: number | null, signal: string | null) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  kill(): void;
}

/**
 * 创建子进程
 */
function createSpawnedProcess(
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined>; cwd: string },
): SpawnedProcess | null {
  const cpModule = loadChildProcess() as NodeChildProcessModule | null;
  if (!cpModule) return null;

  const proc = cpModule.spawn(command, args, {
    env: options.env,
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutHandlers: Array<(chunk: string) => void> = [];
  const stderrHandlers: Array<(chunk: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: string | null) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  proc.stdout.on('data', (data: Uint8Array) => {
    const chunk = new TextDecoder('utf-8').decode(data);
    for (const h of stdoutHandlers) h(chunk);
  });
  proc.stderr.on('data', (data: Uint8Array) => {
    const chunk = new TextDecoder('utf-8').decode(data);
    for (const h of stderrHandlers) h(chunk);
  });
  proc.on('exit', (code: number | null, signal: string | null) => {
    for (const h of exitHandlers) h(code, signal);
  });
  proc.on('error', (err: Error) => {
    for (const h of errorHandlers) h(err);
  });

  return {
    onStdoutData: (h) => stdoutHandlers.push(h),
    onStderrData: (h) => stderrHandlers.push(h),
    onExit: (h) => exitHandlers.push(h),
    onError: (h) => errorHandlers.push(h),
    writeStdin: (data) => {
      proc.stdin.write(data);
    },
    kill: () => {
      try {
        proc.kill();
      } catch {
        // 静默吞掉
      }
    },
    waitReady: () => Promise.resolve(),
  };
}

/**
 * 获取当前工作目录（兼容浏览器环境）
 */
function getCwd(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    try {
      return process.cwd();
    } catch {
      return '/';
    }
  }
  return '/';
}

/**
 * 获取当前环境变量（兼容浏览器环境）
 */
function getEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as Record<string, string | undefined>;
  }
  return {};
}

/**
 * MCP Stdio 传输
 * 通过 child_process.spawn 启动子进程
 * stdin: 写入 JSON-RPC 消息 (每行一条 JSON, 末尾加 \n)
 * stdout: 逐行读取并解析为 JSON-RPC 消息
 * stderr: 单独捕获 (用于错误日志)
 */
export class StdioMcpTransport extends BaseTransport {
  public readonly type = 'stdio' as const;

  private proc: SpawnedProcess | null = null;
  private buffer: string = '';
  private readonly options: Required<Omit<StdioTransportOptions, 'type'>>;

  constructor(options: StdioTransportOptions) {
    super();
    this.options = {
      command: options.command,
      args: options.args ?? [],
      env: options.env ?? {},
      cwd: options.cwd ?? getCwd(),
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
    };
  }

  async start(): Promise<void> {
    if (this._isOpen) return;
    if (this._closed) {
      throw new McpConnectionError('Transport already closed');
    }

    try {
      // 启动子进程
      this.proc = createSpawnedProcess(this.options.command, this.options.args, {
        env: { ...getEnv(), ...this.options.env },
        cwd: this.options.cwd,
      });

      if (!this.proc) {
        throw new McpConnectionError('Stdio transport requires Node.js environment');
      }

      // 处理子进程启动错误
      this.proc.onError((err) => {
        this.emitError(err);
        this.emitClose();
      });

      // 处理 stdout 数据（每行一条 JSON）
      this.proc.onStdoutData((chunk) => {
        this.buffer += chunk;
        this.processBuffer();
      });

      // 处理 stderr 数据
      this.proc.onStderrData((chunk) => {
        // 将 stderr 内容作为错误传递给上层
        const err = new McpConnectionError(`MCP server stderr: ${chunk.trim()}`);
        this.emitError(err);
      });

      // 处理子进程退出
      this.proc.onExit((code, signal) => {
        if (this._isOpen) {
          const err = new McpConnectionError(
            `MCP server exited unexpectedly (code=${code}, signal=${signal})`,
          );
          this.emitError(err);
        }
        this.emitClose();
      });

      // 等待子进程真正启动
      await this.proc.waitReady();

      this._isOpen = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitError(error);
      throw new McpConnectionError(`Failed to start MCP server: ${error.message}`);
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.isOpen() || !this.proc) {
      throw new McpConnectionError('Transport not open');
    }
    try {
      const json = JSON.stringify(message);
      this.proc.writeStdin(json + '\n');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new McpConnectionError(`Failed to send message: ${error.message}`);
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._isOpen = false;

    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        // 静默吞掉 kill 错误
      }
      this.proc = null;
    }
    this.buffer = '';
    this.emitClose();
  }

  /**
   * 处理 stdout 缓冲区，提取完整的 JSON 行
   */
  private processBuffer(): void {
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.emitMessage(msg);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.emitError(new McpParseError(`Failed to parse JSON: ${errMsg}. Line: ${line.slice(0, 200)}`));
      }
    }
  }
}
