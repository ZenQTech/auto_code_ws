/**
 * # ============================================================
 * # MCP Types - Model Context Protocol 类型定义 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 核心作用：定义 MCP 协议使用的所有 TypeScript 类型
 * #           JSON-RPC 2.0 消息 + MCP 能力模型
 * # 协议版本：2024-11-05 (MCP 官方规范)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * # ============================================================
 */

// ============ JSON-RPC 2.0 消息类型 ============

/**
 * JSON-RPC 2.0 请求消息
 * 用途：客户端向服务器发起的方法调用
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 成功响应
 * 用途：服务器返回方法执行结果
 */
export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

/**
 * JSON-RPC 2.0 错误响应
 * 用途：服务器返回方法执行错误
 */
export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 通知 (无 id，不需要响应)
 * 用途：单向通知 (如 initialized, notifications/*)
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** 所有 JSON-RPC 消息的联合类型 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcError | JsonRpcNotification;

// ============ JSON-RPC 错误码常量 ============

/** JSON 解析失败 */
export const JSON_RPC_PARSE_ERROR = -32700;
/** 非法请求 */
export const JSON_RPC_INVALID_REQUEST = -32600;
/** 方法不存在 */
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
/** 参数错误 */
export const JSON_RPC_INVALID_PARAMS = -32602;
/** 内部错误 */
export const JSON_RPC_INTERNAL_ERROR = -32603;
/** 服务器错误区间起点 */
export const JSON_RPC_SERVER_ERROR_START = -32099;
/** 服务器错误区间终点 */
export const JSON_RPC_SERVER_ERROR_END = -32000;

// ============ MCP 协议常量 ============

/** MCP 协议最新版本 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** MCP 客户端信息 */
export const MCP_CLIENT_INFO = {
  name: 'hermes',
  version: '6.111.0',
};

// ============ 能力 (Capabilities) 类型 ============

/** 客户端能力声明 */
export interface ClientCapabilities {
  /** 客户端文件系统根目录列表能力 */
  roots?: { listChanged?: boolean };
  /** 客户端采样能力 (LLM 补全请求) */
  sampling?: Record<string, never>;
  /** 实验性能力 */
  experimental?: Record<string, unknown>;
}

/** 服务器能力声明 */
export interface ServerCapabilities {
  /** 工具能力 */
  tools?: { listChanged?: boolean };
  /** 资源能力 */
  resources?: { subscribe?: boolean; listChanged?: boolean };
  /** 提示词能力 */
  prompts?: { listChanged?: boolean };
  /** 日志能力 */
  logging?: Record<string, never>;
}

/** 初始化结果 */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
}

/** 服务器信息 */
export interface ServerInfo {
  name: string;
  version: string;
}

// ============ 工具 (Tool) 类型 ============

/** MCP 工具定义 (符合 JSON Schema) */
export interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** 工具调用结果内容项 */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: ResourceContent };

/** 工具调用结果 */
export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
}

// ============ 资源 (Resource) 类型 ============

/** MCP 资源定义 */
export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** 资源内容（文本或二进制） */
export type ResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };

/** 资源读取结果 */
export interface ResourceReadResult {
  contents: ResourceContent[];
}

// ============ 提示词 (Prompt) 类型 ============

/** MCP 提示词参数定义 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** MCP 提示词定义 */
export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

/** 提示词消息内容 */
export type PromptMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: ResourceContent };

/** 提示词消息 */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: PromptMessageContent;
}

/** 提示词获取结果 */
export interface PromptGetResult {
  description?: string;
  messages: PromptMessage[];
}

// ============ 通知类型 ============

/** 通知类型常量 */
export const NOTIFICATION_TOOLS_LIST_CHANGED = 'notifications/tools/list_changed';
export const NOTIFICATION_RESOURCES_LIST_CHANGED = 'notifications/resources/list_changed';
export const NOTIFICATION_PROMPTS_LIST_CHANGED = 'notifications/prompts/list_changed';
export const NOTIFICATION_RESOURCES_UPDATED = 'notifications/resources/updated';
export const NOTIFICATION_MESSAGE = 'notifications/message';
export const NOTIFICATION_PROGRESS = 'notifications/progress';

// ============ 日志级别 ============

/** MCP 日志级别 */
export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

// ============ 客户端状态 ============

/** MCP 客户端状态机 */
export type McpClientState = 'idle' | 'connecting' | 'ready' | 'closed' | 'error';

// ============ 传输选项类型 ============

/** Stdio 传输选项 */
export interface StdioTransportOptions {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** 默认超时（毫秒） */
  defaultTimeoutMs?: number;
}

/** SSE 传输选项 */
export interface SseTransportOptions {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  /** 默认超时（毫秒） */
  defaultTimeoutMs?: number;
}

/** 传输选项联合类型 */
export type TransportOptions = StdioTransportOptions | SseTransportOptions;

/** MCP 客户端选项 */
export interface McpClientOptions {
  /** 客户端唯一标识 */
  serverId: string;
  /** 显示名称 */
  serverName: string;
  /** 传输配置 */
  transport: TransportOptions;
  /** 客户端信息（可选） */
  clientInfo?: { name: string; version: string };
  /** 协议版本（默认 2024-11-05） */
  protocolVersion?: string;
  /** 客户端能力声明（可选） */
  capabilities?: ClientCapabilities;
  /** 默认请求超时（毫秒） */
  defaultTimeoutMs?: number;
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}
