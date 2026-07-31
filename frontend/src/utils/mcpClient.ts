/**
 * # ============================================================
 * # MCP Client - Model Context Protocol 客户端 (v1.0.4 Cycle 41 G41-03)
 * # ============================================================
 * # 核心作用：实现 MCP 协议客户端核心功能
 * #           生命周期管理 + 请求响应管理 + 能力发现 + 通知订阅
 * # 对标产品：@modelcontextprotocol/sdk (TypeScript 官方 SDK)
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-01 初次创建
 * #   - 2026-07-31 | v1.0.1 | Cycle 40 G40-04 新增 isReady/isClosed/disconnect/on/onNotification
 * #   - 2026-07-31 | v1.0.2 | Cycle 41 G41-01 新增 subscribeResource/unsubscribeResource
 * #   - 2026-07-31 | v1.0.3 | Cycle 41 G41-02 新增 complete 参数补全
 * #   - 2026-07-31 | v1.0.4 | Cycle 41 G41-03 新增 createSamplingMessage
 * # ============================================================
 */

import {
  type ClientCapabilities,
  type InitializeResult,
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcSuccess,
  type LogLevel,
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  type McpClientOptions,
  type McpClientState,
  NOTIFICATION_MESSAGE,
  NOTIFICATION_PROGRESS,
  NOTIFICATION_PROMPTS_LIST_CHANGED,
  NOTIFICATION_RESOURCES_LIST_CHANGED,
  NOTIFICATION_RESOURCES_UPDATED,
  NOTIFICATION_TOOLS_LIST_CHANGED,
  type Prompt,
  type PromptGetResult,
  type PromptMessage,
  type Resource,
  type ResourceContent,
  type ServerInfo,
  type Tool,
  type ToolCallResult,
  type TransportOptions,
} from './mcpTypes';
import {
  McpClosedError,
  McpConnectionError,
  McpError,
  McpNotConnectedError,
  McpTimeoutError,
  createMcpErrorFromCode,
} from './mcpErrors';
import { StdioMcpTransport } from './mcpTransportStdio';
import { SseMcpTransport } from './mcpTransportSse';
import type { McpTransport } from './mcpTransport';

// ============ 工具函数 ============

/**
 * 生成唯一请求 ID
 * 使用 crypto.randomUUID (Node 14.17+ / 现代浏览器)
 * 降级方案：使用时间戳 + 随机数
 */
export function generateRequestId(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 判断是否为 JSON-RPC 请求
 */
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { jsonrpc?: string }).jsonrpc === '2.0' &&
    typeof (msg as { method?: string }).method === 'string' &&
    'id' in (msg as object)
  );
}

/**
 * 判断是否为 JSON-RPC 成功响应
 */
export function isJsonRpcSuccess(msg: unknown): msg is JsonRpcSuccess {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { jsonrpc?: string }).jsonrpc === '2.0' &&
    'result' in (msg as object) &&
    'id' in (msg as object) &&
    !(msg as { error?: unknown }).error
  );
}

/**
 * 判断是否为 JSON-RPC 错误响应
 */
export function isJsonRpcError(msg: unknown): msg is JsonRpcError {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { jsonrpc?: string }).jsonrpc === '2.0' &&
    typeof (msg as { error?: unknown }).error === 'object' &&
    (msg as { error?: unknown }).error !== null
  );
}

/**
 * 判断是否为 JSON-RPC 通知
 */
export function isJsonRpcNotification(msg: unknown): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { jsonrpc?: string }).jsonrpc === '2.0' &&
    typeof (msg as { method?: string }).method === 'string' &&
    !('id' in (msg as object))
  );
}

// ============ 待处理请求管理器 ============

interface PendingRequest {
  id: string | number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: McpError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  sentAt: number;
}

/**
 * 管理所有 in-flight 的 JSON-RPC 请求
 * 负责 ID 分配、超时管理、响应匹配
 */
export class PendingRequestManager {
  private requests: Map<string | number, PendingRequest> = new Map();
  private closed: boolean = false;

  /**
   * 注册新的待处理请求，返回 Promise
   */
  add(
    method: string,
    timeoutMs: number,
  ): { id: string | number; promise: Promise<unknown> } {
    if (this.closed) {
      return {
        id: 0,
        promise: Promise.reject(new McpClosedError('RequestManager is closed')),
      };
    }

    const id = generateRequestId();
    let resolveFn!: (value: unknown) => void;
    let rejectFn!: (err: McpError) => void;

    const promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const timeoutId = setTimeout(() => {
      if (this.requests.has(id)) {
        this.requests.delete(id);
        rejectFn(new McpTimeoutError(method, timeoutMs));
      }
    }, timeoutMs);

    this.requests.set(id, {
      id,
      method,
      resolve: resolveFn,
      reject: rejectFn,
      timeoutId,
      sentAt: Date.now(),
    });

    return { id, promise };
  }

  /**
   * 处理成功响应
   */
  resolve(id: string | number, result: unknown): boolean {
    const req = this.requests.get(id);
    if (!req) return false;
    clearTimeout(req.timeoutId);
    this.requests.delete(id);
    req.resolve(result);
    return true;
  }

  /**
   * 处理错误响应
   */
  reject(id: string | number, err: McpError): boolean {
    const req = this.requests.get(id);
    if (!req) return false;
    clearTimeout(req.timeoutId);
    this.requests.delete(id);
    req.reject(err);
    return true;
  }

  /**
   * 关闭管理器，取消所有待处理请求
   */
  close(reason: string = 'Manager closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const req of this.requests.values()) {
      clearTimeout(req.timeoutId);
      req.reject(new McpClosedError(reason));
    }
    this.requests.clear();
  }

  /** 当前待处理请求数量 */
  size(): number {
    return this.requests.size;
  }

  /** 是否已关闭 */
  isClosed(): boolean {
    return this.closed;
  }
}

// ============ MCP 客户端主类 ============

/**
 * MCP 协议客户端
 * 使用步骤：
 *   1. const client = new McpClient(options)
 *   2. await client.connect()  // 握手
 *   3. await client.listTools() // 发现能力
 *   4. await client.callTool(name, args) // 调用能力
 *   5. await client.close() // 关闭
 */
export class McpClient {
  private readonly options: Required<Pick<McpClientOptions, 'serverId' | 'serverName' | 'defaultTimeoutMs' | 'autoReconnect' | 'maxReconnectAttempts' | 'protocolVersion' | 'clientInfo'>> & {
    capabilities: ClientCapabilities;
  };
  private transport: McpTransport;
  private pendingManager: PendingRequestManager = new PendingRequestManager();
  private _state: McpClientState = 'idle';
  private _serverInfo: ServerInfo | undefined = undefined;
  private _capabilities: InitializeResult['capabilities'] | undefined = undefined;
  private _lastError: Error | undefined = undefined;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // 通知事件订阅者
  private toolsListChangedHandlers: Set<() => void> = new Set();
  private resourcesListChangedHandlers: Set<() => void> = new Set();
  private promptsListChangedHandlers: Set<() => void> = new Set();
  private resourceUpdatedHandlers: Set<(uri: string) => void> = new Set();
  private logMessageHandlers: Set<(level: LogLevel, logger?: string, data?: unknown) => void> = new Set();
  private progressHandlers: Set<(progress: number, total?: number, message?: string) => void> = new Set();
  private notificationHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();

  constructor(options: McpClientOptions) {
    this.options = {
      serverId: options.serverId,
      serverName: options.serverName,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
      autoReconnect: options.autoReconnect ?? false,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 3,
      protocolVersion: options.protocolVersion ?? MCP_PROTOCOL_VERSION,
      clientInfo: options.clientInfo ?? MCP_CLIENT_INFO,
      capabilities: options.capabilities ?? {},
    };

    // 根据传输类型创建 transport
    this.transport = this.createTransport(options.transport);
    this.bindTransport();
  }

  // ============ 传输层管理 ============

  private createTransport(transportOptions: TransportOptions | McpTransport): McpTransport {
    // 已经是 McpTransport 实例（用于测试或动态注入）
    if (this.isMcpTransport(transportOptions)) {
      return transportOptions;
    }
    if (transportOptions.type === 'stdio') {
      return new StdioMcpTransport(transportOptions);
    }
    if (transportOptions.type === 'sse') {
      return new SseMcpTransport(transportOptions);
    }
    throw new McpConnectionError(`Unknown transport type: ${(transportOptions as { type: string }).type}`);
  }

  /**
   * 类型守卫：判断是否为 McpTransport 实例
   * 通过 duck-typing 识别：存在 start/send/onMessage/onError/onClose/isOpen/close 等方法
   */
  private isMcpTransport(obj: unknown): obj is McpTransport {
    if (typeof obj !== 'object' || obj === null) return false;
    const t = obj as Record<string, unknown>;
    return (
      typeof t.start === 'function' &&
      typeof t.send === 'function' &&
      typeof t.onMessage === 'function' &&
      typeof t.onError === 'function' &&
      typeof t.onClose === 'function' &&
      typeof t.isOpen === 'function' &&
      typeof t.close === 'function' &&
      typeof t.type === 'string' &&
      (t.type === 'stdio' || t.type === 'sse')
    );
  }

  private bindTransport(): void {
    this.transport.onMessage((msg) => {
      this.handleIncomingMessage(msg);
    });
    this.transport.onError((err) => {
      this._lastError = err;
    });
    this.transport.onClose(() => {
      if (this._state === 'ready' || this._state === 'connecting') {
        this._state = 'closed';
        if (this.options.autoReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      }
    });
  }

  /**
   * 处理接收到的消息
   */
  private handleIncomingMessage(msg: JsonRpcMessage): void {
    if (isJsonRpcSuccess(msg)) {
      this.pendingManager.resolve(msg.id, msg.result);
      return;
    }
    if (isJsonRpcError(msg)) {
      const err = createMcpErrorFromCode(
        msg.error.code,
        msg.error.message,
        msg.error.data,
      );
      // 服务器错误响应可能携带 null id（协议错误）
      if (msg.id !== null && msg.id !== undefined) {
        this.pendingManager.reject(msg.id, err);
      }
      return;
    }
    if (isJsonRpcNotification(msg)) {
      this.handleNotification(msg.method, msg.params);
    }
  }

  /**
   * 处理通知消息
   */
  private handleNotification(method: string, params?: Record<string, unknown>): void {
    // 通用通知订阅
    for (const h of this.notificationHandlers) {
      try {
        h({ jsonrpc: '2.0', method, params } as JsonRpcMessage);
      } catch {
        /* ignore */
      }
    }

    switch (method) {
      case NOTIFICATION_TOOLS_LIST_CHANGED:
        for (const h of this.toolsListChangedHandlers) {
          try { h(); } catch { /* ignore */ }
        }
        break;
      case NOTIFICATION_RESOURCES_LIST_CHANGED:
        for (const h of this.resourcesListChangedHandlers) {
          try { h(); } catch { /* ignore */ }
        }
        break;
      case NOTIFICATION_PROMPTS_LIST_CHANGED:
        for (const h of this.promptsListChangedHandlers) {
          try { h(); } catch { /* ignore */ }
        }
        break;
      case NOTIFICATION_RESOURCES_UPDATED: {
        const uri = (params as { uri?: string } | undefined)?.uri;
        if (uri) {
          for (const h of this.resourceUpdatedHandlers) {
            try { h(uri); } catch { /* ignore */ }
          }
        }
        break;
      }
      case NOTIFICATION_MESSAGE: {
        const p = (params ?? {}) as { level?: LogLevel; logger?: string; data?: unknown };
        for (const h of this.logMessageHandlers) {
          try { h(p.level || 'info', p.logger, p.data); } catch { /* ignore */ }
        }
        break;
      }
      case NOTIFICATION_PROGRESS: {
        const p = (params ?? {}) as { progress?: number; total?: number; message?: string };
        for (const h of this.progressHandlers) {
          try { h(p.progress ?? 0, p.total, p.message); } catch { /* ignore */ }
        }
        break;
      }
      default:
        // 忽略未知通知
        break;
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect().catch(() => {
        // 重连失败由 _state 反映
      });
    }, delay);
  }

  // ============ 公共 API ============

  /**
   * 注入/替换 transport（主要用于测试或动态重连）
   */
  setTransport(transport: McpTransport): void {
    this.transport = transport;
    this.bindTransport();
  }

  /**
   * 连接到服务器并完成握手
   */
  async connect(): Promise<InitializeResult> {
    if (this._state === 'ready') {
      throw new McpConnectionError('Client already connected');
    }
    if (this._state === 'closed') {
      throw new McpClosedError('Client has been closed');
    }

    this._state = 'connecting';
    this._lastError = undefined;

    try {
      await this.transport.start();

      // 发送 initialize 请求
      const initResult = await this.request<InitializeResult>('initialize', {
        protocolVersion: this.options.protocolVersion,
        capabilities: this.options.capabilities,
        clientInfo: this.options.clientInfo,
      });

      this._serverInfo = initResult.serverInfo;
      this._capabilities = initResult.capabilities;

      // 发送 initialized 通知
      await this.notify('notifications/initialized', {});

      this._state = 'ready';
      this.reconnectAttempts = 0;
      return initResult;
    } catch (err) {
      this._state = 'error';
      this._lastError = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<InitializeResult> {
    if (this._state === 'ready' || this._state === 'connecting') {
      await this.close();
    }
    return await this.connect();
  }

  /**
   * 心跳
   */
  async ping(): Promise<void> {
    await this.request('ping', {});
  }

  /**
   * 关闭客户端
   */
  async close(): Promise<void> {
    if (this._state === 'closed') return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pendingManager.close('Client closed');
    await this.transport.close();
    this._state = 'closed';
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<Tool[]> {
    const result = await this.request<{ tools: Tool[] }>('tools/list', {});
    return result.tools || [];
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return await this.request<ToolCallResult>('tools/call', { name, arguments: args });
  }

  /**
   * 列出可用资源
   */
  async listResources(): Promise<Resource[]> {
    const result = await this.request<{ resources: Resource[] }>('resources/list', {});
    return result.resources || [];
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<ResourceContent[]> {
    const result = await this.request<{ contents: ResourceContent[] }>('resources/read', { uri });
    return result.contents || [];
  }

  /**
   * 订阅资源更新（Cycle 41 G41-01）
   * 服务器将在资源变化时通过 notifications/resources/updated 推送
   * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/server/resources/#subscribe
   */
  async subscribeResource(uri: string): Promise<void> {
    await this.request('resources/subscribe', { uri });
  }

  /**
   * 取消订阅资源（Cycle 41 G41-01）
   */
  async unsubscribeResource(uri: string): Promise<void> {
    await this.request('resources/unsubscribe', { uri });
  }

  /**
   * 参数补全（Cycle 41 G41-02）
   * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/client/utilities/completion
   */
  async complete(
    ref: { type: 'ref/prompt'; name: string } | { type: 'ref/resource'; uri: string },
    argument: { name: string; value: string },
  ): Promise<{ values: string[]; total?: number; hasMore?: boolean }> {
    return await this.request('completion/complete', { ref, argument });
  }

  /**
   * 服务器主动 LLM 调用（Cycle 41 G41-03）
   * 通常由 SamplingHandler 在内部调用
   * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/client/sampling
   */
  async createSamplingMessage(
    request: {
      messages: Array<{
        role: 'user' | 'assistant';
        content:
          | { type: 'text'; text: string }
          | { type: 'image'; data: string; mimeType: string }
          | { type: 'audio'; data: string; mimeType: string };
      }>;
      maxTokens: number;
      systemPrompt?: string;
      temperature?: number;
      modelPreferences?: {
        hints?: Array<{ name?: string }>;
        costPriority?: number;
        speedPriority?: number;
        intelligencePriority?: number;
      };
      stopSequences?: string[];
    },
  ): Promise<{
    model: string;
    stopReason?: string;
    role: 'assistant';
    content:
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'audio'; data: string; mimeType: string };
  }> {
    return await this.request('sampling/createMessage', request as unknown as Record<string, unknown>);
  }

  /**
   * 列出可用提示词
   */
  async listPrompts(): Promise<Prompt[]> {
    const result = await this.request<{ prompts: Prompt[] }>('prompts/list', {});
    return result.prompts || [];
  }

  /**
   * 获取提示词
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<PromptMessage[]> {
    const result = await this.request<PromptGetResult>('prompts/get', { name, arguments: args });
    return result.messages || [];
  }

  // ============ 通知订阅 ============

  onToolsListChanged(handler: () => void): () => void {
    this.toolsListChangedHandlers.add(handler);
    return () => this.toolsListChangedHandlers.delete(handler);
  }

  onResourcesListChanged(handler: () => void): () => void {
    this.resourcesListChangedHandlers.add(handler);
    return () => this.resourcesListChangedHandlers.delete(handler);
  }

  onPromptsListChanged(handler: () => void): () => void {
    this.promptsListChangedHandlers.add(handler);
    return () => this.promptsListChangedHandlers.delete(handler);
  }

  onResourceUpdated(handler: (uri: string) => void): () => void {
    this.resourceUpdatedHandlers.add(handler);
    return () => this.resourceUpdatedHandlers.delete(handler);
  }

  onLogMessage(handler: (level: LogLevel, logger?: string, data?: unknown) => void): () => void {
    this.logMessageHandlers.add(handler);
    return () => this.logMessageHandlers.delete(handler);
  }

  onProgress(handler: (progress: number, total?: number, message?: string) => void): () => void {
    this.progressHandlers.add(handler);
    return () => this.progressHandlers.delete(handler);
  }

  // ============ 状态查询 ============

  getState(): McpClientState {
    return this._state;
  }

  /**
   * 是否已就绪（与 getState() === 'ready' 等价）
   */
  isReady(): boolean {
    return this._state === 'ready';
  }

  /**
   * 是否已关闭（与 getState() === 'closed' 等价）
   */
  isClosed(): boolean {
    return this._state === 'closed';
  }

  /**
   * 断开连接（close 的别名，保留向后兼容）
   */
  async disconnect(): Promise<void> {
    await this.close();
  }

  /**
   * 通用事件订阅（向后兼容，路由到具体订阅方法）
   * @param event 事件名: 'notification' | 'tools_changed' | 'resources_changed' | 'prompts_changed' | 'resource_updated' | 'log' | 'progress'
   * @param handler 处理器
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void {
    switch (event) {
      case 'notification':
        return this.onNotification((m) => {
          const method = 'method' in m ? m.method : '';
          const params = 'params' in m ? m.params : undefined;
          handler({ method, params });
        });
      case 'tools_changed':
        return this.onToolsListChanged(handler as () => void);
      case 'resources_changed':
        return this.onResourcesListChanged(handler as () => void);
      case 'prompts_changed':
        return this.onPromptsListChanged(handler as () => void);
      case 'resource_updated':
        return this.onResourceUpdated(handler as (uri: string) => void);
      case 'log':
        return this.onLogMessage(handler as (level: LogLevel, logger?: string, data?: unknown) => void);
      case 'progress':
        return this.onProgress(handler as (progress: number, total?: number, message?: string) => void);
      default:
        // 未知事件：返回 noop 取消函数
        return () => {};
    }
  }

  /**
   * 通用通知订阅（任意 JSON-RPC notification）
   */
  onNotification(handler: (msg: JsonRpcRequest) => void): () => void {
    this.notificationHandlers.add(handler as (msg: JsonRpcMessage) => void);
    return () => {
      this.notificationHandlers.delete(handler as (msg: JsonRpcMessage) => void);
    };
  }

  getServerInfo(): ServerInfo | undefined {
    return this._serverInfo;
  }

  getCapabilities(): InitializeResult['capabilities'] | undefined {
    return this._capabilities;
  }

  getLastError(): Error | undefined {
    return this._lastError;
  }

  getServerId(): string {
    return this.options.serverId;
  }

  getServerName(): string {
    return this.options.serverName;
  }

  // ============ 内部方法 ============

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  private async request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (this._state === 'closed') {
      throw new McpClosedError('Client has been closed');
    }
    // 允许 connecting 状态：initialize 握手阶段需要发送请求
    if (this._state !== 'ready' && this._state !== 'connecting') {
      throw new McpNotConnectedError(`Client not ready (state=${this._state})`);
    }

    const timeout = timeoutMs ?? this.options.defaultTimeoutMs;
    const { id, promise } = this.pendingManager.add(method, timeout);

    const requestMsg: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    try {
      await this.transport.send(requestMsg);
      return (await promise) as T;
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpConnectionError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 发送 JSON-RPC 通知 (无 id，不等待响应)
   * 公开方法，允许 RootsManager 等外部组件发送通知
   */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this._state === 'closed') {
      throw new McpClosedError('Client has been closed');
    }
    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };
    await this.transport.send(notification as JsonRpcMessage);
  }
}

// ============ 工厂函数 ============

/**
 * 根据 URL 自动选择传输类型
 * http(s):// → SSE
 * 其他 → Stdio (作为命令)
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  return new McpClient(options);
}

/**
 * 自动检测传输类型
 */
export function detectTransportType(urlOrCommand: string): 'stdio' | 'sse' {
  if (urlOrCommand.startsWith('http://') || urlOrCommand.startsWith('https://')) {
    return 'sse';
  }
  return 'stdio';
}
