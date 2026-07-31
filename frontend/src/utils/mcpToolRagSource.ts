/**
 * # ============================================================
 * # McpToolRagSource - MCP 工具作为 RAG 检索源 (v1.0.0 Cycle 45 G45-03)
 * # ============================================================
 * # 核心作用：将 MCP 工具调用结果（如 fetch 网页、git log、query DB）
 * #           转化为 RAG 可检索的临时文档
 * #           - 工具结果捕获（text / json / markdown / html）
 * #           - 多工具并发调用与结果聚合
 * #           - TTL 缓存（避免重复抓取）
 * #           - 临时文档管理（自动清理）
 * #           - RAG 检索：临时文档 + 持久化知识库混合检索
 * # 对标产品：LangChain Tool Retriever / LlamaIndex ToolRetriever
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 45 G45-03 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import { getDefaultMcpServerRegistry } from './mcpRegistry';
import type { McpRagEngine, McpRagHit } from './mcpRagEngine';

// ============ 类型定义 ============

/**
 * 工具结果内容类型
 */
export type ToolContentKind = 'text' | 'json' | 'markdown' | 'html' | 'code' | 'unknown';

/**
 * 工具调用结果（已转换）
 */
export interface McpToolResult {
  /** 服务器 ID */
  serverId: string;
  /** 工具名 */
  toolName: string;
  /** 调用参数 */
  args: Record<string, unknown>;
  /** 文本内容（已拼接） */
  text: string;
  /** 内容类型（自动推断） */
  kind: ToolContentKind;
  /** 结构化数据（如果可解析） */
  data?: unknown;
  /** 原始内容数组 */
  rawContent: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  /** 时间戳 */
  timestamp: number;
  /** 调用耗时（ms） */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 元数据 */
  metadata?: {
    /** 来源 URL（如 fetch） */
    url?: string;
    /** 资源 URI */
    uri?: string;
    /** 内容长度 */
    length?: number;
    /** 内容哈希 */
    hash?: string;
  };
}

/**
 * MCP 工具源选项
 */
export interface McpToolRagSourceOptions {
  /** MCP 注册表（默认全局） */
  registry?: ReturnType<typeof getDefaultMcpServerRegistry>;
  /** RAG 引擎 */
  ragEngine: McpRagEngine;
  /** TTL（毫秒，默认 5 分钟） */
  ttlMs?: number;
  /** 最大缓存条目数（默认 100） */
  maxCacheSize?: number;
  /** 是否在 retrieve 后清理临时文档（默认 true） */
  cleanupAfterRetrieve?: boolean;
  /** 是否对结果做摘要（默认 false，需要 LLM） */
  summarize?: boolean;
}

/**
 * retrieve 选项
 */
export interface McpToolSourceRetrieveOptions {
  /** 调用的工具列表（qualifiedName 或 toolName） */
  toolCalls: Array<{
    /** 服务器 ID */
    serverId: string;
    /** 工具名 */
    toolName: string;
    /** 参数 */
    args: Record<string, unknown>;
  }>;
  /** 检索 query */
  query: string;
  /** topK（默认 5） */
  topK?: number;
  /** 是否并发调用（默认 true） */
  parallel?: boolean;
  /** 并发数（默认 3） */
  concurrency?: number;
  /** 是否使用缓存（默认 true） */
  useCache?: boolean;
  /** 强制刷新缓存 */
  forceRefresh?: boolean;
  /** 进度回调 */
  onProgress?: (completed: number, total: number, current: string) => void;
}

/**
 * retrieve 结果
 */
export interface McpToolSourceRetrieveResult {
  /** 工具调用结果 */
  toolResults: McpToolResult[];
  /** RAG 命中（来自临时文档 + 持久化知识库） */
  hits: Array<McpRagHit & { source: 'tool-temp' | 'persistent' }>;
  /** 总耗时（ms） */
  durationMs: number;
  /** 临时文档 ID（如果 cleanupAfterRetrieve=false） */
  tempDocIds: string[];
  /** 成功 / 失败统计 */
  stats: {
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    cacheHits: number;
    cacheMisses: number;
  };
}

/**
 * 缓存项
 */
interface ToolCacheEntry {
  result: McpToolResult;
  expiresAt: number;
  /** 关联的 RAG 文档 ID（已索引到 RAG 引擎） */
  ragDocId?: string;
}

/**
 * 桥接事件
 */
export type McpToolRagSourceEvent =
  | { type: 'tool-called'; serverId: string; toolName: string; success: boolean; durationMs: number; cached: boolean; at: number }
  | { type: 'cache-hit'; serverId: string; toolName: string; argsHash: string; at: number }
  | { type: 'cache-miss'; serverId: string; toolName: string; argsHash: string; at: number }
  | { type: 'retrieved'; query: string; toolCount: number; hitCount: number; durationMs: number; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpToolRagSourceListener = (event: McpToolRagSourceEvent) => void;

/**
 * 统计信息
 */
export interface McpToolRagSourceStats {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  cacheHits: number;
  cacheMisses: number;
  totalRetrieves: number;
  avgRetrieveTimeMs: number;
  cacheSize: number;
}

// ============ 工具函数 ============

/**
 * 推断内容类型
 */
export function inferContentKind(text: string, args?: Record<string, unknown>): ToolContentKind {
  if (!text || text.trim().length === 0) return 'text';

  const trimmed = text.trim();

  // 优先看 MIME 提示
  const mimeHint = (args as any)?.mimeType ?? (args as any)?.format;
  if (typeof mimeHint === 'string') {
    if (mimeHint.includes('json')) return 'json';
    if (mimeHint.includes('markdown')) return 'markdown';
    if (mimeHint.includes('html')) return 'html';
  }

  // 看 URL 后缀
  const url = (args as any)?.url;
  if (typeof url === 'string') {
    const lower = url.toLowerCase();
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  }

  // 看内容特征
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // 不是 JSON
    }
  }

  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || /^<[a-z]+>/.test(trimmed)) {
    return 'html';
  }

  if (/^#{1,6}\s/.test(trimmed) || /```/.test(trimmed)) {
    return 'markdown';
  }

  return 'text';
}

/**
 * 计算参数哈希（用于缓存键）
 */
export function hashArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify(args[k])}`);
  let hash = 0;
  const str = parts.join('&');
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash + c) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 计算文本哈希
 */
export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    hash = ((hash << 5) - hash + c) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 提取工具结果文本
 */
export function extractToolResultText(rawContent: unknown): string {
  if (!rawContent) return '';
  const contentArray = Array.isArray(rawContent) ? rawContent : [rawContent];
  let text = '';
  for (const c of contentArray) {
    if (!c) continue;
    if (typeof c === 'string') {
      text += c + '\n\n';
    } else if (typeof c === 'object') {
      const obj = c as { type?: string; text?: string; data?: string };
      if (obj.type === 'text' && obj.text) {
        text += obj.text + '\n\n';
      } else if (obj.text) {
        text += obj.text + '\n\n';
      } else if (obj.data) {
        text += obj.data + '\n\n';
      }
    }
  }
  return text.trim();
}

// ============ 主类 ============

/**
 * MCP 工具作为 RAG 检索源
 *
 * 核心功能：
 * 1. 工具调用 → 捕获结果 → 转换为 RAG 文档
 * 2. 多工具并发调用 + 缓存
 * 3. 临时文档管理（检索后自动清理）
 * 4. 与持久化 RAG 知识库混合检索
 */
export class McpToolRagSource {
  private readonly registry: ReturnType<typeof getDefaultMcpServerRegistry>;
  private readonly ragEngine: McpRagEngine;
  private readonly ttlMs: number;
  private readonly maxCacheSize: number;
  private readonly cleanupAfterRetrieve: boolean;

  /** 缓存：key = `${serverId}:${toolName}:${argsHash}` */
  private readonly cache: Map<string, ToolCacheEntry> = new Map();
  /** 活跃的临时文档 ID（未清理的） */
  private readonly activeTempDocs: Set<string> = new Set();
  /** 事件监听器 */
  private readonly listeners: Set<McpToolRagSourceListener> = new Set();
  /** 统计 */
  private stats: McpToolRagSourceStats = {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalRetrieves: 0,
    avgRetrieveTimeMs: 0,
    cacheSize: 0,
  };
  /** retrieve 累计耗时 */
  private _totalRetrieveTimeMs = 0;

  constructor(options: McpToolRagSourceOptions) {
    this.registry = options.registry ?? getDefaultMcpServerRegistry();
    this.ragEngine = options.ragEngine;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxCacheSize = options.maxCacheSize ?? 100;
    this.cleanupAfterRetrieve = options.cleanupAfterRetrieve ?? true;
  }

  // ============ 事件系统 ============

  on(listener: McpToolRagSourceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: McpToolRagSourceEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // 防止监听器抛错影响主流程
        // eslint-disable-next-line no-console
        console.error('[McpToolRagSource] listener error:', err);
      }
    }
  }

  // ============ 缓存管理 ============

  /**
   * 获取缓存条目
   */
  private getCacheEntry(serverId: string, toolName: string, args: Record<string, unknown>): ToolCacheEntry | null {
    const key = this.cacheKey(serverId, toolName, args);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.cacheSize = this.cache.size;
      return null;
    }
    return entry;
  }

  /**
   * 设置缓存条目
   */
  private setCacheEntry(serverId: string, toolName: string, args: Record<string, unknown>, result: McpToolResult, ragDocId?: string): void {
    const key = this.cacheKey(serverId, toolName, args);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.ttlMs,
      ragDocId,
    });

    // 限制缓存大小
    if (this.cache.size > this.maxCacheSize) {
      // 删除最早的
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.stats.cacheSize = this.cache.size;
  }

  /**
   * 生成缓存键
   */
  private cacheKey(serverId: string, toolName: string, args: Record<string, unknown>): string {
    return `${serverId}:${toolName}:${hashArgs(args)}`;
  }

  /**
   * 清空缓存
   */
  clearCache(): number {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.cacheSize = 0;
    return size;
  }

  /**
   * 删除特定缓存
   */
  invalidateCache(serverId: string, toolName?: string): number {
    let removed = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (toolName) {
        if (key.startsWith(`${serverId}:${toolName}:`)) {
          this.cache.delete(key);
          removed++;
        }
      } else if (key.startsWith(`${serverId}:`)) {
        this.cache.delete(key);
        removed++;
      }
    }
    this.stats.cacheSize = this.cache.size;
    return removed;
  }

  // ============ 工具调用 ============

  /**
   * 调用单个工具并获取结果
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { useCache?: boolean; forceRefresh?: boolean } = {}
  ): Promise<McpToolResult> {
    const useCache = options.useCache ?? true;
    const forceRefresh = options.forceRefresh ?? false;
    const startTime = Date.now();
    const argsHash = hashArgs(args);

    this.stats.totalCalls += 1;

    // 检查缓存
    if (useCache && !forceRefresh) {
      const cached = this.getCacheEntry(serverId, toolName, args);
      if (cached) {
        this.stats.cacheHits += 1;
        this.emit({ type: 'cache-hit', serverId, toolName, argsHash, at: Date.now() });
        this.emit({
          type: 'tool-called',
          serverId,
          toolName,
          success: true,
          durationMs: 0,
          cached: true,
          at: Date.now(),
        });
        return cached.result;
      }
    }

    this.stats.cacheMisses += 1;
    this.emit({ type: 'cache-miss', serverId, toolName, argsHash, at: Date.now() });

    // 获取 MCP 客户端
    const client = this.registry.getClient(serverId);
    if (!client) {
      this.stats.failedCalls += 1;
      const result: McpToolResult = {
        serverId,
        toolName,
        args,
        text: '',
        kind: 'unknown',
        rawContent: [],
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
        success: false,
        error: `服务器 ${serverId} 未注册或未连接`,
      };
      this.emit({
        type: 'tool-called',
        serverId,
        toolName,
        success: false,
        durationMs: result.durationMs,
        cached: false,
        at: Date.now(),
      });
      return result;
    }

    try {
      // 调用 MCP 工具
      const mcpResult = await client.callTool(toolName, args);
      const rawContent = (mcpResult?.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      const text = extractToolResultText(rawContent);
      const kind = inferContentKind(text, args);

      let data: unknown;
      if (kind === 'json') {
        try {
          data = JSON.parse(text);
        } catch {
          // 解析失败忽略
        }
      }

      const url = typeof args.url === 'string' ? args.url : undefined;
      const metadata: McpToolResult['metadata'] = {
        length: text.length,
        hash: hashText(text),
      };
      if (url !== undefined) metadata.url = url;
      if (typeof args.uri === 'string') metadata.uri = args.uri;

      const result: McpToolResult = {
        serverId,
        toolName,
        args,
        text,
        kind,
        rawContent,
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
        success: !mcpResult?.isError,
        data,
        metadata,
      };

      if (mcpResult?.isError) {
        result.error = text || 'Tool returned isError=true';
        this.stats.failedCalls += 1;
      } else {
        this.stats.successCalls += 1;
      }

      // 缓存成功结果
      if (result.success) {
        this.setCacheEntry(serverId, toolName, args, result);
      }

      this.emit({
        type: 'tool-called',
        serverId,
        toolName,
        success: result.success,
        durationMs: result.durationMs,
        cached: false,
        at: Date.now(),
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.stats.failedCalls += 1;
      const result: McpToolResult = {
        serverId,
        toolName,
        args,
        text: '',
        kind: 'unknown',
        rawContent: [],
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
        success: false,
        error: errorMsg,
      };
      this.emit({
        type: 'tool-called',
        serverId,
        toolName,
        success: false,
        durationMs: result.durationMs,
        cached: false,
        at: Date.now(),
      });
      return result;
    }
  }

  // ============ 检索主流程 ============

  /**
   * 调用多个工具并执行 RAG 检索
   * - 流程：调用工具 → 提取文本 → 索引到 RAG（临时） → retrieve → 清理
   */
  async retrieve(opts: McpToolSourceRetrieveOptions): Promise<McpToolSourceRetrieveResult> {
    const startTime = Date.now();
    const parallel = opts.parallel ?? true;
    const concurrency = opts.concurrency ?? 3;
    const useCache = opts.useCache ?? true;
    const forceRefresh = opts.forceRefresh ?? false;
    const cleanup = this.cleanupAfterRetrieve;

    this.stats.totalRetrieves += 1;

    // 1. 调用所有工具
    let toolResults: McpToolResult[];
    if (parallel) {
      toolResults = await this.callToolsParallel(
        opts.toolCalls,
        concurrency,
        useCache,
        forceRefresh,
        opts.onProgress
      );
    } else {
      toolResults = [];
      for (let i = 0; i < opts.toolCalls.length; i++) {
        const call = opts.toolCalls[i];
        const result = await this.callTool(call.serverId, call.toolName, call.args, { useCache, forceRefresh });
        toolResults.push(result);
        if (opts.onProgress) {
          opts.onProgress(i + 1, opts.toolCalls.length, call.toolName);
        }
      }
    }

    // 2. 索引成功的结果到 RAG（临时文档）
    const tempDocIds: string[] = [];
    for (const result of toolResults) {
      if (!result.success || !result.text) continue;
      try {
        const tempDocId = await this.indexToolResultAsTempDoc(result);
        tempDocIds.push(tempDocId);
        this.activeTempDocs.add(tempDocId);
      } catch (err) {
        this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)), at: Date.now() });
      }
    }

    // 3. 执行 RAG 检索（混合临时文档 + 持久化）
    let hits: Array<McpRagHit & { source: 'tool-temp' | 'persistent' }> = [];
    try {
      const rawHits = await this.ragEngine.retrieve(opts.query, {
        topK: opts.topK ?? 5,
        includeLocalDocs: true,
      });
      hits = rawHits.map((h) => ({
        ...h,
        source: tempDocIds.includes(h.documentId) ? 'tool-temp' : 'persistent',
      }));
    } catch (err) {
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)), at: Date.now() });
    }

    // 4. 清理临时文档
    if (cleanup) {
      for (const docId of tempDocIds) {
        try {
          await this.ragEngine.removeResourceIndex?.(this.docIdToResourceUri(docId));
          // 兜底：直接删除文档
          await (this.ragEngine as any).ragEngine?.deleteDocument?.(docId);
        } catch {
          // 忽略清理错误
        }
        this.activeTempDocs.delete(docId);
      }
    }

    // 5. 统计
    const successCalls = toolResults.filter((r) => r.success).length;
    const failedCalls = toolResults.length - successCalls;
    const durationMs = Date.now() - startTime;
    this._totalRetrieveTimeMs += durationMs;
    this.stats.avgRetrieveTimeMs = this._totalRetrieveTimeMs / this.stats.totalRetrieves;

    this.emit({
      type: 'retrieved',
      query: opts.query,
      toolCount: toolResults.length,
      hitCount: hits.length,
      durationMs,
      at: Date.now(),
    });

    return {
      toolResults,
      hits,
      durationMs,
      tempDocIds,
      stats: {
        totalCalls: toolResults.length,
        successCalls,
        failedCalls,
        cacheHits: this.stats.cacheHits,
        cacheMisses: this.stats.cacheMisses,
      },
    };
  }

  /**
   * 索引工具结果为临时 RAG 文档
   */
  private async indexToolResultAsTempDoc(result: McpToolResult): Promise<string> {
    // 复用 McpRagEngine 的 indexResource（preloadedContent 模式）
    const tempDocId = `mcp-tool-temp-${result.serverId}-${result.toolName}-${result.timestamp}`;
    const resourceUri = `mcp-tool://${result.serverId}/${result.toolName}?t=${result.timestamp}`;

    try {
      // 借助 ragEngine 的 ragEngine 属性添加临时文档
      const ragEngine = (this.ragEngine as any).ragEngine;
      if (ragEngine && typeof ragEngine.addDocument === 'function') {
        const document = {
          id: tempDocId,
          content: result.text,
          metadata: {
            source: result.metadata?.url ?? resourceUri,
            title: `${result.toolName} (${result.serverId})`,
            createdAt: result.timestamp,
            updatedAt: result.timestamp,
            mimeType: this.kindToMimeType(result.kind),
            tags: ['mcp-tool-temp', `server:${result.serverId}`, `tool:${result.toolName}`],
            serverId: result.serverId,
            toolName: result.toolName,
            kind: result.kind,
            temporary: true,
            url: result.metadata?.url,
            length: result.metadata?.length,
          },
        };
        await ragEngine.addDocument(document, undefined, { generateEmbedding: true });
        this.activeTempDocs.add(tempDocId);
        return tempDocId;
      }
    } catch {
      // 兜底：使用 indexResource
    }

    // 兜底路径
    await this.ragEngine.indexResource(result.serverId, resourceUri, {
      generateEmbedding: true,
      preloadedContent: {
        text: result.text,
        mimeType: this.kindToMimeType(result.kind),
        name: `${result.toolName}-${result.timestamp}`,
      },
      metadata: {
        toolName: result.toolName,
        kind: result.kind,
        temporary: true,
        url: result.metadata?.url,
      },
    });
    this.activeTempDocs.add(tempDocId);
    return tempDocId;
  }

  /**
   * docId → resourceUri 推断（用于清理）
   */
  private docIdToResourceUri(docId: string): string {
    // 临时工具文档的 uri 编码在 id 中
    const match = docId.match(/^mcp-tool-temp-([^-]+)-([^-]+)-(\d+)$/);
    if (match) {
      return `mcp-tool://${match[1]}/${match[2]}?t=${match[3]}`;
    }
    return docId;
  }

  /**
   * 类型 → MIME 映射
   */
  private kindToMimeType(kind: ToolContentKind): string {
    switch (kind) {
      case 'json':
        return 'application/json';
      case 'markdown':
        return 'text/markdown';
      case 'html':
        return 'text/html';
      case 'code':
        return 'text/x-code';
      case 'text':
      default:
        return 'text/plain';
    }
  }

  /**
   * 并发调用工具
   */
  private async callToolsParallel(
    calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>,
    concurrency: number,
    useCache: boolean,
    forceRefresh: boolean,
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<McpToolResult[]> {
    const results: McpToolResult[] = new Array(calls.length);
    let cursor = 0;
    let completed = 0;
    const total = calls.length;

    async function worker(self: McpToolRagSource) {
      while (cursor < total) {
        const idx = cursor++;
        const call = calls[idx];
        const result = await self.callTool(call.serverId, call.toolName, call.args, { useCache, forceRefresh });
        results[idx] = result;
        completed++;
        if (onProgress) {
          onProgress(completed, total, call.toolName);
        }
      }
    }

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(worker(this));
    }
    await Promise.all(workers);
    return results;
  }

  // ============ 统计 / 清理 ============

  /**
   * 获取统计
   */
  getStats(): McpToolRagSourceStats {
    return { ...this.stats, cacheSize: this.cache.size };
  }

  /**
   * 清理所有活跃的临时文档
   */
  async cleanupAll(): Promise<number> {
    const docIds = Array.from(this.activeTempDocs);
    let cleaned = 0;
    const ragEngine = (this.ragEngine as any).ragEngine;
    for (const docId of docIds) {
      try {
        if (ragEngine?.deleteDocument) {
          await ragEngine.deleteDocument(docId);
        }
        this.activeTempDocs.delete(docId);
        cleaned++;
      } catch {
        // 忽略
      }
    }
    return cleaned;
  }

  /**
   * 获取活跃临时文档数
   */
  getActiveTempDocCount(): number {
    return this.activeTempDocs.size;
  }

  /**
   * 列出缓存的工具调用
   */
  listCache(): Array<{ key: string; serverId: string; toolName: string; argsHash: string; success: boolean; age: number }> {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => {
      const parts = key.split(':');
      return {
        key,
        serverId: parts[0],
        toolName: parts[1],
        argsHash: parts[2] ?? '',
        success: entry.result.success,
        age: now - (entry.result.timestamp),
      };
    });
  }
}

// ============ 工厂函数 ============

/**
 * 创建 MCP 工具 RAG 源
 */
export function createMcpToolRagSource(options: McpToolRagSourceOptions): McpToolRagSource {
  return new McpToolRagSource(options);
}
