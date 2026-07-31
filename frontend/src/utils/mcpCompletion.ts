/**
 * # ============================================================
 * # MCP Completion - 参数补全能力 (v1.0.0 Cycle 41 G41-02)
 * # ============================================================
 * # 核心作用：实现 MCP completion/complete 协议
 * #           - 工具/资源/提示词参数补全
 * #           - 多源合并
 * #           - 客户端缓存
 * #           - 防抖请求
 * # 协议参考：MCP 2024-11-05 completion
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-02 初次创建
 * # ============================================================
 */

/**
 * 补全引用类型
 * 支持对 prompt 或 resource 的参数进行补全
 */
export type CompletionRef =
  | { type: 'ref/prompt'; name: string }
  | { type: 'ref/resource'; uri: string };

/**
 * 单个参数的补全请求
 */
export interface CompletionArgument {
  /** 参数名 */
  name: string;
  /** 当前已输入的值 */
  value: string;
}

/**
 * 补全请求
 */
export interface CompletionRequest {
  ref: CompletionRef;
  argument: CompletionArgument;
}

/**
 * 补全响应
 */
export interface CompletionResponse {
  /** 补全值列表 */
  values: string[];
  /** 总数（可选） */
  total?: number;
  /** 是否还有更多（用于分页） */
  hasMore?: boolean;
}

/**
 * 缓存项
 */
interface CacheEntry {
  key: string;
  response: CompletionResponse;
  expiresAt: number;
}

/**
 * 补全事件
 */
export type CompletionEvent =
  | { type: 'request'; request: CompletionRequest; at: number }
  | { type: 'response'; request: CompletionRequest; response: CompletionResponse; at: number }
  | { type: 'error'; request: CompletionRequest; error: Error; at: number }
  | { type: 'cache_hit'; request: CompletionRequest; at: number };

export type CompletionListener = (event: CompletionEvent) => void;

/**
 * 补全请求客户端接口（兼容 McpClient）
 */
export interface CompletionClient {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/**
 * 补全器 - 统一管理补全请求
 */
export class CompletionProvider {
  private client: CompletionClient | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly cacheTtlMs: number;
  private readonly maxCacheSize: number;
  private listeners: Set<CompletionListener> = new Set();
  private inFlight: Map<string, Promise<CompletionResponse>> = new Map();

  constructor(options: { cacheTtlMs?: number; maxCacheSize?: number } = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60000; // 默认 60s
    this.maxCacheSize = options.maxCacheSize ?? 500;
  }

  /**
   * 绑定客户端
   */
  attachClient(client: CompletionClient | null): void {
    this.client = client;
    // 客户端变更，清空缓存
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * 请求补全
   * - 自动去重 in-flight
   * - 自动缓存
   * - 支持 forceRefresh 绕过缓存
   */
  async complete(
    request: CompletionRequest,
    options: { forceRefresh?: boolean } = {},
  ): Promise<CompletionResponse> {
    const key = this.cacheKey(request);
    this.emit({ type: 'request', request, at: Date.now() });

    // 缓存命中
    if (!options.forceRefresh) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        this.emit({ type: 'cache_hit', request, at: Date.now() });
        return cached.response;
      }
    }

    // in-flight 去重
    const existing = this.inFlight.get(key);
    if (existing) {
      return await existing;
    }

    if (!this.client) {
      throw new Error('No completion client attached');
    }

    const promise = (async () => {
      try {
        const response = await this.client!.complete(request);
        this.putCache(key, response);
        this.emit({ type: 'response', request, response, at: Date.now() });
        return response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit({ type: 'error', request, error, at: Date.now() });
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return await promise;
  }

  /**
   * 批量补全（多参数）
   */
  async completeBatch(requests: CompletionRequest[]): Promise<CompletionResponse[]> {
    return await Promise.all(requests.map((r) => this.complete(r)));
  }

  /**
   * 工具参数补全（便捷方法）
   */
  async completeToolParam(
    toolName: string,
    paramName: string,
    value: string,
  ): Promise<CompletionResponse> {
    return await this.complete({
      ref: { type: 'ref/prompt', name: `__tool__:${toolName}` },
      argument: { name: paramName, value },
    });
  }

  /**
   * 提示词参数补全（便捷方法）
   */
  async completePromptParam(
    promptName: string,
    paramName: string,
    value: string,
  ): Promise<CompletionResponse> {
    return await this.complete({
      ref: { type: 'ref/prompt', name: promptName },
      argument: { name: paramName, value },
    });
  }

  /**
   * 资源 URI 补全
   */
  async completeResourceUri(
    baseUri: string,
    value: string,
  ): Promise<CompletionResponse> {
    return await this.complete({
      ref: { type: 'ref/resource', uri: baseUri },
      argument: { name: 'uri', value },
    });
  }

  /**
   * 订阅补全事件
   */
  on(listener: CompletionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.listeners.clear();
    this.client = null;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; inFlight: number; maxSize: number } {
    return {
      size: this.cache.size,
      inFlight: this.inFlight.size,
      maxSize: this.maxCacheSize,
    };
  }

  // ============ 私有方法 ============

  private cacheKey(request: CompletionRequest): string {
    return `${request.ref.type}|${'name' in request.ref ? request.ref.name : request.ref.uri}|${request.argument.name}|${request.argument.value}`;
  }

  private putCache(key: string, response: CompletionResponse): void {
    // LRU 简化：超过 maxSize 时清空一半
    if (this.cache.size >= this.maxCacheSize) {
      const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxCacheSize / 2));
      for (const k of keysToDelete) {
        this.cache.delete(k);
      }
    }
    this.cache.set(key, {
      key,
      response,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private emit(event: CompletionEvent): void {
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
 * 创建补全器
 */
export function createCompletionProvider(
  options: { cacheTtlMs?: number; maxCacheSize?: number } = {},
): CompletionProvider {
  return new CompletionProvider(options);
}

/**
 * McpClient 适配器：将 McpClient 适配为 CompletionClient
 */
export function createMcpCompletionClient(
  client: { request: <T>(method: string, params?: Record<string, unknown>) => Promise<T> },
): CompletionClient {
  return {
    complete: async (request) => {
      return await client.request<CompletionResponse>('completion/complete', {
        ref: request.ref,
        argument: request.argument,
      });
    },
  };
}
