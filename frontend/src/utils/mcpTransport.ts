/**
 * # ============================================================
 * # MCP Transport - 传输层抽象 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 核心作用：定义 MCP 传输层抽象接口
 * #           统一 Stdio / SSE / WebSocket 等不同传输方式
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

import type { JsonRpcMessage } from './mcpTypes';

/** 消息处理回调 */
export type MessageHandler = (msg: JsonRpcMessage) => void;
/** 错误处理回调 */
export type ErrorHandler = (err: Error) => void;
/** 关闭事件回调 */
export type CloseHandler = () => void;

/**
 * MCP 传输层抽象接口
 * 任何具体的传输实现（Stdio / SSE / WebSocket）都必须实现该接口
 */
export interface McpTransport {
  /** 传输类型标识 */
  readonly type: 'stdio' | 'sse';

  /** 启动传输（建立连接） */
  start(): Promise<void>;

  /** 发送 JSON-RPC 消息 */
  send(message: JsonRpcMessage): Promise<void>;

  /** 注册消息接收回调（支持多个） */
  onMessage(handler: MessageHandler): () => void;

  /** 注册错误回调 */
  onError(handler: ErrorHandler): () => void;

  /** 注册关闭回调 */
  onClose(handler: CloseHandler): () => void;

  /** 关闭传输并释放资源 */
  close(): Promise<void>;

  /** 获取传输状态 */
  isOpen(): boolean;
}

/**
 * 基础传输类
 * 实现通用的回调管理逻辑
 */
export abstract class BaseTransport implements McpTransport {
  public abstract readonly type: 'stdio' | 'sse';
  protected messageHandlers: Set<MessageHandler> = new Set();
  protected errorHandlers: Set<ErrorHandler> = new Set();
  protected closeHandlers: Set<CloseHandler> = new Set();
  protected _isOpen: boolean = false;
  protected _closed: boolean = false;

  abstract start(): Promise<void>;
  abstract send(message: JsonRpcMessage): Promise<void>;

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  isOpen(): boolean {
    return this._isOpen && !this._closed;
  }

  /** 内部方法：通知所有消息处理者 */
  protected emitMessage(msg: JsonRpcMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (err) {
        // 单个 handler 错误不影响其他
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** 内部方法：通知所有错误处理者 */
  protected emitError(err: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch {
        // 静默吞掉 handler 自身的错误
      }
    }
  }

  /** 内部方法：通知所有关闭处理者 */
  protected emitClose(): void {
    if (this._closed) return;
    this._closed = true;
    this._isOpen = false;
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // 静默吞掉 handler 自身的错误
      }
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this.emitClose();
  }
}
