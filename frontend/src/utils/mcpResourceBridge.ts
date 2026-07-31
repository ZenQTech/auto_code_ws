/**
 * # ============================================================
 * # MCP Resource Bridge - MCP 资源桥接 (v1.0.0 Cycle 42 G42-02)
 * # ============================================================
 * # 核心作用：将 MCP 资源集成到 Hermes 资源池
 * #           - MCP Resource ↔ Hermes ResourceInfo 转换
 * #           - URI 引用解析：mcp://<serverId>/<uri>
 * #           - 资源订阅自动同步到 Hermes 资源池
 * #           - 资源读取懒加载 + 缓存
 * #           - 资源搜索 + 过滤
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-02 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import type { Resource, ResourceContent } from './mcpTypes';

// ============ 类型定义 ============

/**
 * Hermes 资源信息（统一格式）
 */
export interface ResourceInfo {
  /** 资源唯一 ID */
  id: string;
  /** 资源 URI（Hermes 格式：mcp://<serverId>/<originalUri>） */
  uri: string;
  /** 资源名称 */
  name: string;
  /** 资源描述 */
  description?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 来源（mcp / builtin / user） */
  source: 'mcp' | 'builtin' | 'user';
  /** MCP 服务器 ID（来自 MCP 时） */
  serverId?: string;
  /** 服务器名称 */
  serverName?: string;
  /** 原始 MCP URI（来自 MCP 时） */
  originalUri?: string;
  /** 是否已订阅 */
  subscribed?: boolean;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 已解析的资源引用
 */
export interface ResolvedResource {
  info: ResourceInfo;
  content: ResourceContent;
  /** 是否来自缓存 */
  cached: boolean;
  /** 解析耗时 */
  durationMs: number;
}

/**
 * 桥接事件
 */
export type McpResourceBridgeEvent =
  | { type: 'server-registered'; serverId: string; resourceCount: number; at: number }
  | { type: 'server-unregistered'; serverId: string; resourceCount: number; at: number }
  | { type: 'resource-added'; resource: ResourceInfo; at: number }
  | { type: 'resource-removed'; resource: ResourceInfo; at: number }
  | { type: 'resource-updated'; resource: ResourceInfo; at: number }
  | { type: 'resource-resolved'; uri: string; durationMs: number; cached: boolean; at: number }
  | { type: 'subscribed'; uri: string; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpResourceBridgeListener = (event: McpResourceBridgeEvent) => void;

/**
 * 缓存项
 */
interface CacheEntry {
  content: ResourceContent;
  expiresAt: number;
}

/**
 * 资源统计
 */
export interface McpResourceStats {
  totalServers: number;
  totalResources: number;
  totalResolutions: number;
  cacheHits: number;
  cacheMisses: number;
  subscriptions: number;
}

// ============ 工具函数 ============

/**
 * 构造 Hermes 格式 URI
 * 格式: mcp://<serverId>/<encodedOriginalUri>
 * 完整保留原始 URI（包括 file://、https:// 等协议），仅做 URL 编码
 */
export function buildHermesResourceUri(serverId: string, originalUri: string): string {
  return `mcp://${serverId}/${encodeURIComponent(originalUri)}`;
}

/**
 * 解析 Hermes 格式 URI
 * @returns null 表示不是 MCP Hermes URI
 */
export function parseHermesResourceUri(uri: string): { serverId: string; originalUri: string } | null {
  const match = uri.match(/^mcp:\/\/([a-zA-Z0-9_-]+)\/(.+)$/);
  if (!match) return null;
  return { serverId: match[1], originalUri: decodeURIComponent(match[2]) };
}

/**
 * MCP Resource → Hermes ResourceInfo 转换
 */
export function convertMcpResourceToHermes(
  serverId: string,
  serverName: string,
  resource: Resource,
): ResourceInfo {
  return {
    id: `mcp:${serverId}:${resource.uri}`,
    uri: buildHermesResourceUri(serverId, resource.uri),
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
    source: 'mcp',
    serverId,
    serverName,
    originalUri: resource.uri,
    subscribed: false,
    createdAt: Date.now(),
  };
}

// ============ 资源桥接主类 ============

/**
 * MCP 资源桥接
 * 负责：
 * 1. 收集所有 MCP 服务器的资源
 * 2. 提供统一 URI 解析
 * 3. 懒加载资源内容 + TTL 缓存
 * 4. 资源订阅同步
 */
export class McpResourceBridge {
  /** 资源池（key: hermes uri） */
  private readonly resources: Map<string, ResourceInfo> = new Map();
  /** 服务器资源映射 */
  private readonly serverResources: Map<string, Set<string>> = new Map();
  /** 服务器客户端 */
  private readonly serverClients: Map<string, McpClient> = new Map();
  /** 变更通知解绑 */
  private readonly unsubscribers: Map<string, () => void> = new Map();
  /** 缓存 */
  private readonly cache: Map<string, CacheEntry> = new Map();
  /** 事件监听 */
  private readonly listeners: Set<McpResourceBridgeListener> = new Set();
  /** 缓存 TTL（毫秒） */
  private readonly cacheTtlMs: number;
  /** 缓存最大大小 */
  private readonly maxCacheSize: number;
  /** 统计 */
  private stats = {
    totalResolutions: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  /** 订阅 URI 集合 */
  private readonly subscriptions: Set<string> = new Set();

  constructor(options: { cacheTtlMs?: number; maxCacheSize?: number } = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.maxCacheSize = options.maxCacheSize ?? 500;
  }

  /**
   * 注册服务器资源
   * @returns 注册的资源数量
   */
  async registerServer(serverId: string, client: McpClient): Promise<number> {
    if (!client.isReady()) {
      throw new Error(`Client for server '${serverId}' is not ready`);
    }
    if (this.serverResources.has(serverId)) {
      await this.unregisterServer(serverId);
    }
    this.serverClients.set(serverId, client);

    const mcpResources = await client.listResources();
    const serverName = client.getServerInfo()?.name ?? serverId;
    const resourceSet = new Set<string>();

    for (const mcpResource of mcpResources) {
      const info = convertMcpResourceToHermes(serverId, serverName, mcpResource);
      this.resources.set(info.uri, info);
      resourceSet.add(info.uri);
      this.emit({ type: 'resource-added', resource: info, at: Date.now() });
    }
    this.serverResources.set(serverId, resourceSet);

    // 订阅资源列表变更
    const unsub = client.onResourcesListChanged(async () => {
      await this.handleServerResourcesChanged(serverId, client);
    });
    this.unsubscribers.set(serverId, unsub);

    this.emit({ type: 'server-registered', serverId, resourceCount: resourceSet.size, at: Date.now() });
    return resourceSet.size;
  }

  /**
   * 注销服务器
   */
  async unregisterServer(serverId: string): Promise<void> {
    const resourceSet = this.serverResources.get(serverId);
    if (!resourceSet) return;

    const unsub = this.unsubscribers.get(serverId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(serverId);
    }

    for (const uri of resourceSet) {
      const info = this.resources.get(uri);
      if (info) {
        // 取消订阅
        if (info.subscribed) {
          try {
            const client = this.serverClients.get(serverId);
            if (client && client.isReady()) {
              await client.unsubscribeResource(info.originalUri ?? '');
            }
          } catch {
            // 静默
          }
        }
        this.subscriptions.delete(uri);
        this.cache.delete(uri);
        this.resources.delete(uri);
        this.emit({ type: 'resource-removed', resource: info, at: Date.now() });
      }
    }
    this.serverResources.delete(serverId);
    this.serverClients.delete(serverId);

    this.emit({ type: 'server-unregistered', serverId, resourceCount: resourceSet.size, at: Date.now() });
  }

  /**
   * 注销所有服务器
   */
  async unregisterAll(): Promise<void> {
    const serverIds = Array.from(this.serverResources.keys());
    for (const id of serverIds) {
      await this.unregisterServer(id);
    }
  }

  /**
   * 列出所有资源
   */
  list(): ResourceInfo[] {
    return Array.from(this.resources.values());
  }

  /**
   * 列出指定服务器的资源
   */
  listByServer(serverId: string): ResourceInfo[] {
    const set = this.serverResources.get(serverId);
    if (!set) return [];
    return Array.from(set)
      .map((uri) => this.resources.get(uri))
      .filter((r): r is ResourceInfo => r !== undefined);
  }

  /**
   * 获取资源信息
   */
  get(uri: string): ResourceInfo | undefined {
    return this.resources.get(uri);
  }

  /**
   * 解析资源（懒加载）
   */
  async resolve(uri: string): Promise<ResolvedResource> {
    const startTime = Date.now();
    this.stats.totalResolutions += 1;

    // 检查缓存
    const cached = this.cache.get(uri);
    if (cached && cached.expiresAt > Date.now()) {
      this.stats.cacheHits += 1;
      const info = this.resources.get(uri);
      if (!info) {
        throw new Error(`Resource not found: ${uri}`);
      }
      const durationMs = Date.now() - startTime;
      this.emit({ type: 'resource-resolved', uri, durationMs, cached: true, at: Date.now() });
      return { info, content: cached.content, cached: true, durationMs };
    }

    this.stats.cacheMisses += 1;

    // 解析 URI
    const parsed = parseHermesResourceUri(uri);
    if (!parsed) {
      throw new Error(`Invalid Hermes resource URI: ${uri}`);
    }

    const info = this.resources.get(uri);
    if (!info) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const client = this.serverClients.get(parsed.serverId);
    if (!client || !client.isReady()) {
      throw new Error(`Server '${parsed.serverId}' is not connected`);
    }

    const contents: ResourceContent[] = await client.readResource(parsed.originalUri);
    if (contents.length === 0) {
      throw new Error(`Resource has no content: ${uri}`);
    }

    const content = contents[0];
    this.putCache(uri, content);

    const durationMs = Date.now() - startTime;
    this.emit({ type: 'resource-resolved', uri, durationMs, cached: false, at: Date.now() });
    return { info, content, cached: false, durationMs };
  }

  /**
   * 搜索资源
   */
  search(query: string, options: { serverId?: string; mimeType?: string } = {}): ResourceInfo[] {
    const q = query.toLowerCase();
    let results = Array.from(this.resources.values());
    if (options.serverId) {
      results = results.filter((r) => r.serverId === options.serverId);
    }
    if (options.mimeType) {
      results = results.filter((r) => r.mimeType?.startsWith(options.mimeType!));
    }
    if (q) {
      results = results.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.uri.toLowerCase().includes(q),
      );
    }
    return results;
  }

  /**
   * 订阅资源更新
   */
  async subscribe(uri: string): Promise<boolean> {
    const info = this.resources.get(uri);
    if (!info || !info.serverId || !info.originalUri) {
      throw new Error(`Resource not found: ${uri}`);
    }
    if (info.subscribed) return false;

    const client = this.serverClients.get(info.serverId);
    if (!client || !client.isReady()) {
      throw new Error(`Server '${info.serverId}' is not connected`);
    }

    await client.subscribeResource(info.originalUri);
    info.subscribed = true;
    this.subscriptions.add(uri);
    this.emit({ type: 'subscribed', uri, at: Date.now() });
    return true;
  }

  /**
   * 取消订阅
   */
  async unsubscribe(uri: string): Promise<boolean> {
    const info = this.resources.get(uri);
    if (!info || !info.serverId || !info.originalUri || !info.subscribed) return false;

    const client = this.serverClients.get(info.serverId);
    if (client && client.isReady()) {
      try {
        await client.unsubscribeResource(info.originalUri);
      } catch {
        // 静默
      }
    }
    info.subscribed = false;
    this.subscriptions.delete(uri);
    return true;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取统计
   */
  getStats(): McpResourceStats {
    return {
      totalServers: this.serverResources.size,
      totalResources: this.resources.size,
      totalResolutions: this.stats.totalResolutions,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      subscriptions: this.subscriptions.size,
    };
  }

  /**
   * 订阅事件
   */
  on(listener: McpResourceBridgeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.resources.clear();
    this.serverResources.clear();
    this.serverClients.clear();
    this.cache.clear();
    this.subscriptions.clear();
    this.listeners.clear();
  }

  // ============ 私有方法 ============

  private putCache(uri: string, content: ResourceContent): void {
    if (this.cache.size >= this.maxCacheSize) {
      // 简单 FIFO 淘汰
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(uri, {
      content,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private async handleServerResourcesChanged(serverId: string, client: McpClient): Promise<void> {
    try {
      const oldSet = this.serverResources.get(serverId) ?? new Set<string>();
      const newMcpResources = await client.listResources();
      const newSet = new Set<string>();
      const serverName = client.getServerInfo()?.name ?? serverId;

      for (const mcpRes of newMcpResources) {
        const info = convertMcpResourceToHermes(serverId, serverName, mcpRes);
        newSet.add(info.uri);
        if (!oldSet.has(info.uri)) {
          this.resources.set(info.uri, info);
          this.emit({ type: 'resource-added', resource: info, at: Date.now() });
        }
      }
      for (const uri of oldSet) {
        if (!newSet.has(uri)) {
          const info = this.resources.get(uri);
          if (info) {
            this.resources.delete(uri);
            this.cache.delete(uri);
            this.subscriptions.delete(uri);
            this.emit({ type: 'resource-removed', resource: info, at: Date.now() });
          }
        }
      }
      this.serverResources.set(serverId, newSet);
    } catch (err) {
      this.emit({
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        at: Date.now(),
      });
    }
  }

  private emit(event: McpResourceBridgeEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 创建 MCP 资源桥接
 */
export function createMcpResourceBridge(options?: { cacheTtlMs?: number; maxCacheSize?: number }): McpResourceBridge {
  return new McpResourceBridge(options);
}
