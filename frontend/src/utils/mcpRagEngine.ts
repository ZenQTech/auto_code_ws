/**
 * # ============================================================
 * # McpRagEngine - MCP × RAG 融合引擎 (v1.0.0 Cycle 45 G45-01)
 * # ============================================================
 * # 核心作用：将 MCP 资源/工具/提示词作为 RAG 检索源
 * #           - MCP 资源 → 自动文档分块 → 嵌入 → 语义检索
 * #           - MCP 工具 → 实时调用 → 结果作为 RAG 上下文
 * #           - MCP 提示词 → 模板注入 → 上下文增强
 * #           - Agent RAG 增强循环 (retrieve → inject → generate)
 * # 协议版本：MCP 2024-11-05
 * # 对标产品：LangChain MCP Adapters / LlamaIndex MCP Reader
 * # 运行流程：
 * #   1. 初始化 McpRagEngine (注入 ragEngine + mcpRegistry)
 * #   2. indexResource() 把 MCP 资源加入知识库
 * #   3. indexAllResources() 批量索引指定服务器的所有资源
 * #   4. retrieve() 混合检索 (本地文档 + MCP 资源)
 * #   5. enhance() 检索 + LLM 生成 + 提示词注入
 * #   6. agentEnhance() Agent 循环: retrieve → context → generate
 * # 输入参数：ResourceInfo / query / options
 * # 输出结果：RAG 响应 / 增强结果 / 统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 45 G45-01 初次创建
 * # ============================================================
 */

import {
  RAGEngine,
  type RAGEngineOptions,
  type RetrievalResult,
  type Citation,
  type Document,
  type AddOptions,
  MockEmbedding,
  RecursiveCharacterTextSplitter,
  MemoryVectorStore,
  BM25Retriever,
  HybridRetriever,
  HeuristicReranker,
  TextLoader,
} from './ragEngine';
import type { McpServerRegistry } from './mcpRegistry';
import type { McpToolBridge } from './mcpToolBridge';
import type { McpPromptBridge } from './mcpPromptBridge';
import type { ResourceContent } from './mcpTypes';
import { LLMProvider, ChatResponse, Message } from './llmProviderAdapter';

// ============ 类型定义 ============

/**
 * MCP 资源索引条目
 * - 记录资源 URI 与 RAG 文档 ID 的映射
 * - 用于 retrieve 时回溯到 MCP 资源
 */
export interface McpRagIndexEntry {
  /** 索引条目 ID */
  id: string;
  /** 关联的 RAG 文档 ID */
  documentId: string;
  /** MCP 服务器 ID */
  serverId: string;
  /** MCP 资源 URI */
  resourceUri: string;
  /** 资源名称 */
  resourceName: string;
  /** 资源 MIME 类型 */
  mimeType?: string;
  /** 索引时间 */
  indexedAt: number;
  /** 块数 */
  chunkCount: number;
  /** 文档大小（字节） */
  size?: number;
}

/**
 * MCP 资源索引选项
 */
export interface IndexResourceOptions {
  /** 块大小（默认 400 tokens） */
  chunkSize?: number;
  /** 块重叠（默认 50 tokens） */
  chunkOverlap?: number;
  /** 是否生成 embedding（默认 true） */
  generateEmbedding?: boolean;
  /** 标签（用于过滤） */
  tags?: string[];
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /**
   * 预先加载的内容（提供时跳过 resourceBridge.resolve）
   * - 适用场景：内容已通过其他途径获得（如文件系统直接读取）
   * - 格式：{ text?: string; blob?: string; mimeType?: string }
   */
  preloadedContent?: {
    text?: string;
    blob?: string;
    mimeType?: string;
    name?: string;
  };
}

/**
 * 混合检索选项
 */
export interface HybridSearchOptions {
  /** 返回 top K 结果（默认 5） */
  topK?: number;
  /** 最小分数阈值（默认 0.0） */
  minScore?: number;
  /** 服务器 ID 过滤（默认所有） */
  serverIds?: string[];
  /** 标签过滤 */
  tags?: string[];
  /** 是否包含本地非 MCP 文档（默认 true） */
  includeLocalDocs?: boolean;
}

/**
 * 检索命中
 */
export interface McpRagHit {
  /** 命中类型 */
  type: 'mcp-resource' | 'local-document';
  /** 检索结果 */
  result: RetrievalResult;
  /** MCP 资源 URI（仅 mcp-resource 类型） */
  resourceUri?: string;
  /** 服务器 ID（仅 mcp-resource 类型） */
  serverId?: string;
  /** 文档 ID */
  documentId: string;
  /** 块 ID */
  chunkId: string;
  /** 片段内容 */
  content: string;
  /** 关联分数 */
  score: number;
}

/**
 * Agent RAG 增强选项
 */
export interface AgentRagEnhanceOptions {
  /** 检索 top K（默认 5） */
  topK?: number;
  /** 提示词模板（可选，使用 MCP 提示词时） */
  promptName?: string;
  /** 提示词参数 */
  promptArgs?: Record<string, string>;
  /** LLM 选项 */
  llmOptions?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** 上下文最大 tokens（默认 4000） */
  maxContextTokens?: number;
  /** 是否使用 rerank（默认 true） */
  useRerank?: boolean;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 是否流式回调 */
  onChunk?: (chunk: string) => void;
  /** 检索命中回调 */
  onHit?: (hit: McpRagHit) => void;
}

/**
 * Agent RAG 增强结果
 */
export interface AgentRagEnhanceResult {
  /** LLM 生成的最终答案 */
  answer: string;
  /** 检索命中（含来源） */
  hits: McpRagHit[];
  /** 引用 */
  citations: Citation[];
  /** 元数据 */
  metadata: {
    query: string;
    retrievalTimeMs: number;
    generationTimeMs: number;
    totalTimeMs: number;
    totalTokens?: number;
    indexedResources: number;
    useRerank: boolean;
    usePrompt: boolean;
    timestamp: number;
  };
}

/**
 * 引擎事件
 */
export type McpRagEngineEvent =
  | { type: 'indexed'; entry: McpRagIndexEntry; at: number }
  | { type: 'batch-indexed'; count: number; durationMs: number; at: number }
  | { type: 'retrieved'; query: string; hitCount: number; durationMs: number; at: number }
  | { type: 'enhanced'; result: AgentRagEnhanceResult; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpRagEngineListener = (event: McpRagEngineEvent) => void;

/**
 * 引擎统计
 */
export interface McpRagEngineStats {
  totalIndexedResources: number;
  totalIndexEntries: number;
  totalRetrievals: number;
  totalEnhancements: number;
  avgRetrievalTimeMs: number;
  avgEnhanceTimeMs: number;
  totalChunks: number;
  totalTokensUsed: number;
}

// ============ 工具函数 ============

/**
 * 解析 ResourceContent 为纯文本
 * - text 类型直接返回 text
 * - blob 类型尝试 base64 解码（如果可读）
 */
function resourceContentToText(content: ResourceContent): string {
  if ('text' in content) {
    return content.text;
  }
  if ('blob' in content) {
    // 尝试 base64 解码（如果是 UTF-8 文本）
    try {
      if (typeof atob === 'function') {
        return atob(content.blob);
      }
    } catch {
      // 忽略
    }
    return `[二进制 blob: ${content.blob.length} chars]`;
  }
  return '';
}

// ============ Resource Bridge 简化接口 ============

/**
 * Resource Bridge 最小接口（McpRagEngine 仅依赖此子集）
 * - 避免与完整 McpResourceBridge 类型循环依赖
 */
export interface ResourceResolver {
  resolve(uri: string): Promise<{
    info?: { name?: string; mimeType?: string; serverName?: string; serverId?: string };
    content: ResourceContent | ResourceContent[];
  } | null>;
  getResources?(): Promise<Array<{ uri: string; name: string; mimeType?: string; serverId?: string }>>;
  listResources?(serverId: string): Promise<Array<{ uri: string; name: string; mimeType?: string }>>;
}

// ============ McpRagEngine 主体类 ============

/**
 * MCP × RAG 融合引擎
 *
 * 设计要点：
 *   1. 复用现有 RAGEngine（避免重复实现嵌入/检索/重排）
 *   2. 维护 MCP 资源 → 文档的索引映射
 *   3. 支持本地文档 + MCP 资源的混合检索
 *   4. Agent RAG 增强循环：retrieve → context assembly → prompt injection → LLM
 */
export class McpRagEngine {
  private ragEngine: RAGEngine;
  private mcpRegistry?: McpServerRegistry;
  private resourceBridge?: ResourceResolver;
  private toolBridge?: McpToolBridge;
  private promptBridge?: McpPromptBridge;
  private llmProvider?: LLMProvider;

  /** 资源 URI → 索引条目 */
  private indexMap: Map<string, McpRagIndexEntry> = new Map();
  /** 文档 ID → 索引条目 */
  private docToEntry: Map<string, McpRagIndexEntry> = new Map();
  /** 事件监听器 */
  private listeners: Set<McpRagEngineListener> = new Set();
  /** 统计 */
  private stats: McpRagEngineStats = {
    totalIndexedResources: 0,
    totalIndexEntries: 0,
    totalRetrievals: 0,
    totalEnhancements: 0,
    avgRetrievalTimeMs: 0,
    avgEnhanceTimeMs: 0,
    totalChunks: 0,
    totalTokensUsed: 0,
  };
  /** 内部累计耗时 */
  private _totalRetrievalTimeMs = 0;
  private _totalEnhanceTimeMs = 0;
  /** 自动刷新订阅 */
  private unsubscribeFunctions: Array<() => void> = [];

  constructor(options: {
    ragEngine?: RAGEngine;
    mcpRegistry?: McpServerRegistry;
    resourceBridge?: ResourceResolver;
    toolBridge?: McpToolBridge;
    promptBridge?: McpPromptBridge;
    llmProvider?: LLMProvider;
  } = {}) {
    this.ragEngine = options.ragEngine ?? this.createDefaultRagEngine();
    this.mcpRegistry = options.mcpRegistry;
    this.resourceBridge = options.resourceBridge;
    this.toolBridge = options.toolBridge;
    this.promptBridge = options.promptBridge;
    this.llmProvider = options.llmProvider;
  }

  // ============ 工厂方法 ============

  /**
   * 创建默认 RAG 引擎
   * - Mock Embedding (256 维)
   * - RecursiveCharacterTextSplitter
   * - MemoryVectorStore
   * - HybridRetriever (Vector + BM25 内部)
   * - HeuristicReranker
   * - TextLoader
   *
   * 注意：不传 retriever，让 RAGEngine 内部创建默认 HybridRetriever
   *  （RAGEngine 内部维护的 bm25Retriever 会随 addDocument 自动更新）
   */
  private createDefaultRagEngine(): RAGEngine {
    const embedding = new MockEmbedding({ dimension: 256 });
    const splitter = new RecursiveCharacterTextSplitter();
    const vectorStore = new MemoryVectorStore();
    const reranker = new HeuristicReranker();
    const loader = new TextLoader();

    const options: RAGEngineOptions = {
      embeddingModel: embedding,
      splitter,
      vectorStore,
      reranker,
      loader,
      // 不传 retriever，使用 RAGEngine 默认的 HybridRetriever
      // （HybridRetriever 内部使用 RAGEngine 维护的 bm25Retriever，
      //   文档添加时自动同步）
    };
    return new RAGEngine(options);
  }

  // ============ 事件订阅 ============

  /**
   * 订阅引擎事件
   */
  on(listener: McpRagEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: McpRagEngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // 监听器错误不影响主流程
        console.error('[McpRagEngine] listener error:', err);
      }
    }
  }

  // ============ MCP 资源索引 ============

  /**
   * 索引单个 MCP 资源
   * - 读取资源内容（支持 preloadedContent 跳过 bridge）
   * - 转换为纯文本
   * - 添加到 RAG 知识库
   * - 记录索引映射
   */
  async indexResource(
    serverId: string,
    resourceUri: string,
    options: IndexResourceOptions = {}
  ): Promise<McpRagIndexEntry> {
    if (!this.resourceBridge) {
      throw new Error('resourceBridge 未配置，无法索引资源');
    }

    try {
      // 1. 解析资源：优先使用 preloadedContent，否则通过 resourceBridge
      let fullText = '';
      let resolvedInfo: { name?: string; mimeType?: string; serverName?: string } | null = null;

      if (options.preloadedContent) {
        // 1a. 使用预先加载的内容
        const pc = options.preloadedContent;
        if (pc.text) {
          fullText = pc.text;
        } else if (pc.blob) {
          fullText = pc.blob;
        } else {
          throw new Error('preloadedContent 必须包含 text 或 blob');
        }
        resolvedInfo = {
          name: pc.name ?? resourceUri.split('/').pop() ?? resourceUri,
          mimeType: pc.mimeType,
        };
      } else {
        // 1b. 通过 resourceBridge 解析资源
        const resolved = await this.resourceBridge.resolve(resourceUri);
        if (!resolved || !resolved.content) {
          throw new Error(`资源解析失败或无内容: ${resourceUri}`);
        }

        const contents = Array.isArray(resolved.content)
          ? resolved.content
          : [resolved.content];

        for (const content of contents) {
          const text = resourceContentToText(content);
          if (text) fullText += text + '\n\n';
        }

        resolvedInfo = {
          name: resolved.info?.name,
          mimeType: resolved.info?.mimeType,
          serverName: resolved.info?.serverName,
        };
      }

      if (!fullText.trim()) {
        throw new Error(`资源内容为空: ${resourceUri}`);
      }

      // 3. 构造 RAG 文档
      const docId = `mcp-${serverId}-${this.hashUri(resourceUri)}`;
      const document: Document = {
        id: docId,
        content: fullText,
        metadata: {
          source: resourceUri,
          title: resolvedInfo?.name ?? resourceUri,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mimeType: resolvedInfo?.mimeType,
          tags: options.tags ?? ['mcp', `server:${serverId}`],
          serverId,
          serverName: resolvedInfo?.serverName,
          indexedFromMcp: true,
          ...options.metadata,
        },
      };

      // 4. 添加到 RAG 引擎
      const addOptions: AddOptions = {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
        generateEmbedding: options.generateEmbedding ?? true,
      };
      const returnedId = await this.ragEngine.addDocument(document, undefined, addOptions);
      const finalId = returnedId ?? docId;
      // 重新获取文档以读取 chunks
      const addedDoc = this.ragEngine.getDocument(finalId);
      const chunkCount = addedDoc?.chunks?.length ?? 0;

      // 5. 创建索引条目
      const entry: McpRagIndexEntry = {
        id: `idx-${finalId}`,
        documentId: finalId,
        serverId,
        resourceUri,
        resourceName: resolvedInfo?.name ?? resourceUri,
        mimeType: resolvedInfo?.mimeType,
        indexedAt: Date.now(),
        chunkCount,
        size: fullText.length,
      };

      this.indexMap.set(resourceUri, entry);
      this.docToEntry.set(finalId, entry);
      this.stats.totalIndexedResources += 1;
      this.stats.totalIndexEntries = this.indexMap.size;
      this.stats.totalChunks += chunkCount;

      this.emit({ type: 'indexed', entry, at: Date.now() });
      return entry;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'error', error, at: Date.now() });
      throw error;
    }
  }

  /**
   * 批量索引 MCP 资源
   * - 遍历指定服务器的所有资源
   * - 并发（受限）执行 indexResource
   * - 返回成功/失败统计
   */
  async indexAllResources(
    serverId: string,
    options: IndexResourceOptions & { concurrency?: number } = {}
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    entries: McpRagIndexEntry[];
    errors: Array<{ uri: string; error: string }>;
  }> {
    if (!this.resourceBridge) {
      throw new Error('resourceBridge 未配置');
    }
    const startTime = Date.now();
    const concurrency = options.concurrency ?? 3;

    // 1. 列出资源
    const resources = await this.listResourcesForServer(serverId);

    const entries: McpRagIndexEntry[] = [];
    const errors: Array<{ uri: string; error: string }> = [];

    // 2. 简单并发池
    let cursor = 0;
    const total = resources.length;

    const self = this;
    async function worker() {
      while (cursor < total) {
        const idx = cursor++;
        const resource = resources[idx];
        try {
          const entry = await self.indexResource(serverId, resource.uri, options);
          entries.push(entry);
        } catch (err) {
          errors.push({
            uri: resource.uri,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const durationMs = Date.now() - startTime;
    this.emit({ type: 'batch-indexed', count: entries.length, durationMs, at: Date.now() });

    return {
      total,
      succeeded: entries.length,
      failed: errors.length,
      durationMs,
      entries,
      errors,
    };
  }

  /**
   * 列出指定服务器的所有资源
   * - 通过 resourceBridge.getResources() 或 fallback 到空数组
   */
  private async listResourcesForServer(
    serverId: string
  ): Promise<Array<{ uri: string; name: string; mimeType?: string }>> {
    if (!this.resourceBridge) return [];
    try {
      // 尝试通过 bridge 获取资源列表
      if (typeof this.resourceBridge.getResources === 'function') {
        const all = await this.resourceBridge.getResources();
        return all
          .filter((r) => r.serverId === serverId)
          .map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType }));
      }
      if (typeof this.resourceBridge.listResources === 'function') {
        return await this.resourceBridge.listResources(serverId);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * 移除资源索引
   */
  async removeResourceIndex(resourceUri: string): Promise<boolean> {
    const entry = this.indexMap.get(resourceUri);
    if (!entry) return false;
    this.indexMap.delete(resourceUri);
    this.docToEntry.delete(entry.documentId);
    await this.ragEngine.deleteDocument(entry.documentId);
    this.stats.totalIndexEntries = this.indexMap.size;
    this.stats.totalChunks = Math.max(0, this.stats.totalChunks - entry.chunkCount);
    return true;
  }

  /**
   * 清空所有 MCP 资源索引（不影响非 MCP 文档）
   */
  async clearResourceIndexes(): Promise<number> {
    let removed = 0;
    const uris = Array.from(this.indexMap.keys());
    for (const uri of uris) {
      const entry = this.indexMap.get(uri);
      if (!entry) continue;
      this.docToEntry.delete(entry.documentId);
      await this.ragEngine.deleteDocument(entry.documentId);
      removed++;
    }
    this.indexMap.clear();
    this.stats.totalIndexEntries = 0;
    this.stats.totalChunks = 0;
    return removed;
  }

  // ============ 检索 ============

  /**
   * 混合检索（本地文档 + MCP 资源）
   * - 委托给 RAGEngine
   * - 后处理按 serverId/tags 过滤
   * - 转换为 McpRagHit 格式
   */
  async retrieve(query: string, options: HybridSearchOptions = {}): Promise<McpRagHit[]> {
    const startTime = Date.now();
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0;
    const includeLocalDocs = options.includeLocalDocs ?? true;

    try {
      // 1. 调用 RAGEngine 检索
      const results: RetrievalResult[] = await this.ragEngine.retrieve(query, {
        topK: topK * 2, // 拉取更多再过滤
      });

      // 2. 后处理 + 转换为 McpRagHit
      const hits: McpRagHit[] = [];
      for (const r of results) {
        if (r.score < minScore) continue;

        const entry = this.docToEntry.get(r.chunk.documentId);

        // 判断是否 MCP 资源
        if (entry) {
          // MCP 资源
          if (options.serverIds && !options.serverIds.includes(entry.serverId)) {
            continue;
          }
          if (options.tags && options.tags.length > 0) {
            const docTags = (r.chunk.metadata?.tags as string[]) ?? [];
            if (!options.tags.some((t) => docTags.includes(t))) continue;
          }
          hits.push({
            type: 'mcp-resource',
            result: r,
            resourceUri: entry.resourceUri,
            serverId: entry.serverId,
            documentId: r.chunk.documentId,
            chunkId: r.chunk.id,
            content: r.chunk.content,
            score: r.score,
          });
        } else {
          // 本地文档
          if (!includeLocalDocs) continue;
          hits.push({
            type: 'local-document',
            result: r,
            documentId: r.chunk.documentId,
            chunkId: r.chunk.id,
            content: r.chunk.content,
            score: r.score,
          });
        }

        if (hits.length >= topK) break;
      }

      const durationMs = Date.now() - startTime;
      this.stats.totalRetrievals += 1;
      this._totalRetrievalTimeMs += durationMs;
      this.stats.avgRetrievalTimeMs =
        this._totalRetrievalTimeMs / this.stats.totalRetrievals;

      this.emit({ type: 'retrieved', query, hitCount: hits.length, durationMs, at: Date.now() });
      return hits;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'error', error, at: Date.now() });
      throw error;
    }
  }

  // ============ Agent RAG 增强循环 ============

  /**
   * Agent RAG 增强：retrieve → context → prompt → LLM
   * - 自动检索相关 MCP 资源
   * - 组装上下文（含 prompt 模板）
   * - 调用 LLM 生成最终答案
   * - 记录引用
   */
  async enhance(
    query: string,
    options: AgentRagEnhanceOptions = {}
  ): Promise<AgentRagEnhanceResult> {
    const startTime = Date.now();
    const retrievalStart = Date.now();

    if (!this.llmProvider) {
      throw new Error('llmProvider 未配置，无法执行 enhance');
    }

    // 1. 检索
    const hits = await this.retrieve(query, { topK: options.topK ?? 5 });
    const retrievalTimeMs = Date.now() - retrievalStart;

    // 触发命中回调
    if (options.onHit) {
      for (const hit of hits) {
        try {
          options.onHit(hit);
        } catch {
          // 忽略回调错误
        }
      }
    }

    // 2. 组装上下文
    const maxContextTokens = options.maxContextTokens ?? 4000;
    const contextText = this.assembleContext(hits, maxContextTokens);

    // 3. 解析 prompt 模板
    let systemPrompt = options.systemPrompt ?? this.defaultSystemPrompt();
    if (options.promptName && this.promptBridge) {
      try {
        const promptResult = await this.promptBridge.render(
          options.promptName,
          {
            args: options.promptArgs ?? {},
          }
        );
        if (promptResult?.messages) {
          for (const msg of promptResult.messages) {
            const c = msg.content as any;
            if (c.type === 'text' && c.text) {
              systemPrompt = c.text;
              break;
            } else if (c.type === 'resource') {
              const rc = c.resource;
              if (rc && 'text' in rc) {
                systemPrompt = rc.text;
                break;
              }
            }
          }
        }
      } catch {
        // 忽略 prompt 解析错误，使用默认 system prompt
      }
    }

    // 4. 构造 LLM 消息
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: this.buildUserPrompt(query, contextText),
      },
    ];

    // 5. 调用 LLM
    const generationStart = Date.now();
    const llmResponse: ChatResponse = await this.llmProvider.chat(messages, {
      ...options.llmOptions,
    });
    const generationTimeMs = Date.now() - generationStart;

    // 6. 流式回调
    if (options.onChunk) {
      // 模拟流式（如果 LLM 是一次性返回）
      for (const char of llmResponse.content) {
        try {
          options.onChunk(char);
        } catch {
          // 忽略回调错误
        }
      }
    }

    // 7. 构造引用
    const citations: Citation[] = hits.map((hit) => ({
      chunkId: hit.chunkId,
      documentId: hit.documentId,
      source: hit.type === 'mcp-resource' ? hit.resourceUri ?? 'mcp' : hit.documentId,
      title:
        hit.type === 'mcp-resource'
          ? hit.resourceUri?.split('/').pop()
          : hit.documentId,
      snippet: hit.content.substring(0, 200),
      startOffset: 0,
      endOffset: Math.min(hit.content.length, 200),
      relevanceScore: hit.score,
    }));

    // 8. 更新统计
    const totalTimeMs = Date.now() - startTime;
    this.stats.totalEnhancements += 1;
    this._totalEnhanceTimeMs += totalTimeMs;
    this.stats.avgEnhanceTimeMs =
      this._totalEnhanceTimeMs / this.stats.totalEnhancements;
    if (llmResponse.usage?.totalTokens) {
      this.stats.totalTokensUsed += llmResponse.usage.totalTokens;
    }

    const result: AgentRagEnhanceResult = {
      answer: llmResponse.content,
      hits,
      citations,
      metadata: {
        query,
        retrievalTimeMs,
        generationTimeMs,
        totalTimeMs,
        totalTokens: llmResponse.usage?.totalTokens,
        indexedResources: this.indexMap.size,
        useRerank: options.useRerank ?? true,
        usePrompt: !!options.promptName,
        timestamp: Date.now(),
      },
    };

    this.emit({ type: 'enhanced', result, at: Date.now() });
    return result;
  }

  /**
   * 默认系统提示词
   */
  private defaultSystemPrompt(): string {
    return [
      '你是一个智能助手，能够利用检索增强生成（RAG）技术回答用户问题。',
      '根据提供的上下文，给出准确、有依据的回答。',
      '回答中应该标注信息来源（引用）。',
    ].join('\n');
  }

  /**
   * 组装检索上下文
   * - 按 hit 顺序拼接
   * - 控制总 token 数
   * - 添加来源标记
   */
  private assembleContext(hits: McpRagHit[], maxTokens: number): string {
    const parts: string[] = [];
    let estimatedTokens = 0;

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const marker =
        hit.type === 'mcp-resource'
          ? `[来源 ${i + 1}: MCP ${hit.serverId} - ${hit.resourceUri}]`
          : `[来源 ${i + 1}: ${hit.documentId}]`;
      const chunk = `${marker}\n${hit.content}`;
      const chunkTokens = this.estimateTokens(chunk);
      if (estimatedTokens + chunkTokens > maxTokens) {
        // 截断当前块以满足约束
        const remaining = maxTokens - estimatedTokens;
        if (remaining > 50) {
          const truncated = chunk.substring(0, remaining * 3); // 粗略字符换算
          parts.push(truncated + '\n[...内容已截断]');
        }
        break;
      }
      parts.push(chunk);
      estimatedTokens += chunkTokens;
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * 构造用户提示词
   */
  private buildUserPrompt(query: string, context: string): string {
    return [
      '# 检索上下文',
      context || '(无相关上下文)',
      '',
      '# 用户问题',
      query,
      '',
      '# 回答要求',
      '1. 基于上下文回答问题',
      '2. 标注信息来源 [来源 N]',
      '3. 如果上下文不相关，明确说明',
    ].join('\n');
  }

  /**
   * 估算 token 数（简单实现）
   */
  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  // ============ MCP 工具检索 ============

  /**
   * 调用 MCP 工具并将结果加入 RAG 上下文
   * - 工具结果作为临时上下文来源
   * - 不写入持久化知识库
   * - 用于实时检索（如 fetch 工具 → 网页内容）
   */
  async retrieveViaTool(
    toolName: string,
    args: Record<string, unknown>,
    query: string
  ): Promise<{ toolResult: string; hits: McpRagHit[] }> {
    if (!this.toolBridge) {
      throw new Error('toolBridge 未配置');
    }

    try {
      // 1. 调用工具
      const result = await this.toolBridge.execute({
        id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: toolName,
        arguments: args,
      });
      if (!result.success) {
        const errMsg =
          typeof result.error === 'string'
            ? result.error
            : result.error?.message ?? '工具调用失败';
        throw new Error(errMsg);
      }

      // 2. 提取文本内容
      const contents = (result.result as any)?.content ?? [];
      let toolText = '';
      for (const c of contents) {
        if (c.type === 'text' && c.text) {
          toolText += c.text + '\n\n';
        }
      }

      // 3. 临时添加为文档（用于检索）
      const tempDocId = `mcp-tool-${toolName}-${Date.now()}`;
      const document: Document = {
        id: tempDocId,
        content: toolText,
        metadata: {
          source: `mcp-tool:${toolName}`,
          title: `Tool result: ${toolName}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tags: ['mcp-tool', `tool:${toolName}`],
          temporary: true,
        },
      };
      await this.ragEngine.addDocument(document, undefined, { generateEmbedding: true });

      // 4. 检索
      const hits = await this.retrieve(query, { topK: 5 });

      // 5. 清理临时文档
      await this.ragEngine.deleteDocument(tempDocId);

      return { toolResult: toolText, hits };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'error', error, at: Date.now() });
      throw error;
    }
  }

  // ============ 工具方法 ============

  /**
   * URI 哈希（用于生成稳定 ID）
   */
  private hashUri(uri: string): string {
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      const c = uri.charCodeAt(i);
      hash = (hash << 5) - hash + c;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 获取所有索引条目
   */
  getIndexEntries(): McpRagIndexEntry[] {
    return Array.from(this.indexMap.values());
  }

  /**
   * 获取统计
   */
  getStats(): McpRagEngineStats {
    return { ...this.stats };
  }

  /**
   * 获取底层 RAG 引擎（用于高级用法）
   */
  getRagEngine(): RAGEngine {
    return this.ragEngine;
  }

  /**
   * 同步所有资源索引到当前 registry
   * - 重新读取所有服务器的资源
   * - 增量索引新增的资源
   * - 移除已不存在的资源索引
   */
  async syncWithRegistry(): Promise<{
    added: McpRagIndexEntry[];
    removed: string[];
    kept: number;
  }> {
    if (!this.resourceBridge || !this.mcpRegistry) {
      return { added: [], removed: [], kept: 0 };
    }

    const added: McpRagIndexEntry[] = [];
    const removed: string[] = [];

    // 1. 获取当前所有资源
    const currentUris = new Set<string>();
    try {
      if (typeof this.resourceBridge.getResources === 'function') {
        const allResources = await this.resourceBridge.getResources();
        for (const r of allResources) {
          currentUris.add(r.uri);
        }
      }
    } catch {
      // 忽略
    }

    // 2. 找出新增的
    for (const uri of currentUris) {
      if (!this.indexMap.has(uri)) {
        // 提取 serverId from uri (假设 mcp://serverId/... 格式)
        const m = uri.match(/^mcp:\/\/([^/]+)\//);
        const serverId = m ? m[1] : 'unknown';
        try {
          const entry = await this.indexResource(serverId, uri);
          added.push(entry);
        } catch {
          // 忽略单个失败
        }
      }
    }

    // 3. 找出已移除的
    for (const uri of Array.from(this.indexMap.keys())) {
      if (!currentUris.has(uri)) {
        await this.removeResourceIndex(uri);
        removed.push(uri);
      }
    }

    return { added, removed, kept: this.indexMap.size };
  }

  /**
   * 销毁引擎，清理资源
   */
  dispose(): void {
    for (const unsub of this.unsubscribeFunctions) {
      try {
        unsub();
      } catch {
        // 忽略
      }
    }
    this.unsubscribeFunctions = [];
    this.indexMap.clear();
    this.docToEntry.clear();
    this.listeners.clear();
  }
}

// ============ 工厂函数 ============

/**
 * 创建 McpRagEngine 实例
 */
export function createMcpRagEngine(options?: {
  ragEngine?: RAGEngine;
  mcpRegistry?: McpServerRegistry;
  resourceBridge?: ResourceResolver;
  toolBridge?: McpToolBridge;
  promptBridge?: McpPromptBridge;
  llmProvider?: LLMProvider;
}): McpRagEngine {
  return new McpRagEngine(options);
}

export default McpRagEngine;
