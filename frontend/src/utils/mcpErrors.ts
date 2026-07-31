/**
 * # ============================================================
 * # MCP Errors - MCP 错误类 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 核心作用：定义 MCP 协议使用的错误类型层次
 * #           JSON-RPC 错误码到 McpError 子类的映射
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_SERVER_ERROR_END,
  JSON_RPC_SERVER_ERROR_START,
} from './mcpTypes';

/**
 * MCP 协议错误基类
 * 实现 JSON-RPC 2.0 错误对象
 */
export class McpError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
    // 恢复原型链 (ES5 target 兼容)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 转换为 JSON-RPC 错误对象 */
  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }

  /** 是否为连接错误 */
  isConnectionError(): boolean {
    return this instanceof McpConnectionError;
  }

  /** 是否为超时错误 */
  isTimeoutError(): boolean {
    return this instanceof McpTimeoutError;
  }
}

/** JSON 解析错误 (-32700) */
export class McpParseError extends McpError {
  constructor(message: string = 'Parse error', data?: unknown) {
    super(message, JSON_RPC_PARSE_ERROR, data);
    this.name = 'McpParseError';
  }
}

/** 非法请求错误 (-32600) */
export class McpInvalidRequestError extends McpError {
  constructor(message: string = 'Invalid Request', data?: unknown) {
    super(message, JSON_RPC_INVALID_REQUEST, data);
    this.name = 'McpInvalidRequestError';
  }
}

/** 方法不存在错误 (-32601) */
export class McpMethodNotFoundError extends McpError {
  constructor(method: string, data?: unknown) {
    super(`Method not found: ${method}`, JSON_RPC_METHOD_NOT_FOUND, data);
    this.name = 'McpMethodNotFoundError';
  }
}

/** 参数错误 (-32602) */
export class McpInvalidParamsError extends McpError {
  constructor(message: string = 'Invalid params', data?: unknown) {
    super(message, JSON_RPC_INVALID_PARAMS, data);
    this.name = 'McpInvalidParamsError';
  }
}

/** 内部错误 (-32603) */
export class McpInternalError extends McpError {
  constructor(message: string = 'Internal error', data?: unknown) {
    super(message, JSON_RPC_INTERNAL_ERROR, data);
    this.name = 'McpInternalError';
  }
}

/** 连接错误 (-32000) */
export class McpConnectionError extends McpError {
  constructor(message: string = 'Connection error', data?: unknown) {
    super(message, JSON_RPC_SERVER_ERROR_END, data);
    this.name = 'McpConnectionError';
  }
}

/** 超时错误 (-32001) */
export class McpTimeoutError extends McpError {
  public readonly method: string;
  public readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number, data?: unknown) {
    super(`Request '${method}' timed out after ${timeoutMs}ms`, JSON_RPC_SERVER_ERROR_END + 1, data);
    this.name = 'McpTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** 服务器通用错误 */
export class McpServerError extends McpError {
  constructor(message: string, code: number = JSON_RPC_SERVER_ERROR_START, data?: unknown) {
    // 服务器错误码范围：-32099 (START) 到 -32000 (END)，闭区间
    if (code < JSON_RPC_SERVER_ERROR_START || code > JSON_RPC_SERVER_ERROR_END) {
      code = JSON_RPC_SERVER_ERROR_START;
    }
    super(message, code, data);
    this.name = 'McpServerError';
  }
}

/** 客户端未连接错误 */
export class McpNotConnectedError extends McpError {
  constructor(message: string = 'Client not connected') {
    super(message, -32002);
    this.name = 'McpNotConnectedError';
  }
}

/** 客户端已关闭错误 */
export class McpClosedError extends McpError {
  constructor(message: string = 'Client has been closed') {
    super(message, -32003);
    this.name = 'McpClosedError';
  }
}

/**
 * 从 JSON-RPC 错误对象创建对应的 McpError 子类
 * 用途：统一从服务器错误响应到异常对象的转换
 */
export function createMcpErrorFromCode(
  code: number,
  message: string,
  data?: unknown,
  method?: string,
  timeoutMs?: number,
): McpError {
  switch (code) {
    case JSON_RPC_PARSE_ERROR:
      return new McpParseError(message, data);
    case JSON_RPC_INVALID_REQUEST:
      return new McpInvalidRequestError(message, data);
    case JSON_RPC_METHOD_NOT_FOUND:
      return new McpMethodNotFoundError(method || 'unknown', data);
    case JSON_RPC_INVALID_PARAMS:
      return new McpInvalidParamsError(message, data);
    case JSON_RPC_INTERNAL_ERROR:
      return new McpInternalError(message, data);
    case JSON_RPC_SERVER_ERROR_END + 1:
      // 超时错误
      if (method && timeoutMs !== undefined) {
        return new McpTimeoutError(method, timeoutMs, data);
      }
      return new McpServerError(message, code, data);
    case JSON_RPC_SERVER_ERROR_END:
      return new McpConnectionError(message, data);
    default:
      if (code >= JSON_RPC_SERVER_ERROR_END && code <= JSON_RPC_SERVER_ERROR_START) {
        return new McpServerError(message, code, data);
      }
      return new McpError(message, code, data);
  }
}
