/**
 * # ============================================================
 * # RAGSemanticCache - RAG 智能语义缓存层 (v1.0.0 Cycle 47 G47-02)
 * # ============================================================
 * # 核心作用：实现 RAG 系统的智能缓存,降低重复查询的 LLM 调用成本
 * #           - 精确匹配缓存 (O(1) 哈希查找)
 * #           - 语义相似度缓存 (cosine similarity)
 * #           - LRU 淘汰策略
 * #           - TTL 过期机制
 * #           - 缓存预热
 * #           - 命中率统计
 * #           - 持久化支持
 * # 对标产品: GPTCache / LangChain Cache / MemCache
 * # 设计要点:
 * #   1. 双层缓存: 精确匹配 (L1) + 语义相似 (L2)
 * #   2. LRU 淘汰: 超出容量时淘汰最久未访问
 * #   3. TTL 过期: 超过 TTL 自动失效
 * #   4. 缓存预热: 启动时加载历史热点
 * #   5. 跨 session 共享: 支持持久化到 localStorage/IndexedDB
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 47 G47-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 缓存条目
 */
export interface CacheEntry<T = unknown> {
  /** 唯一键 (query 哈希) */
  key: string;
  /** 原始 query */
  query: string;
  /** query embedding (用于语义相似度) */
  embedding: Float32Array;
  /** 缓存值 */
  value: T;
  /** 创建时间 (ms) */
  createdAt: number;
  /** 最后访问时间 (ms) */
  lastAccessedAt: number;
  /** 访问序号 (单调递增, 用于 LRU 决胜) */
  accessSeq: number;
  /** 访问次数 */
  accessCount: number;
  /** 过期时间 (ms, 0 = 永不过期) */
  expiresAt: number;
  /** 命中类型 (创建时) */
  hitType: 'exact';
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 缓存命中结果
 */
export interface CacheHit<T = unknown> {
  /** 命中的缓存条目 */
  entry: CacheEntry<T>;
  /** 相似度 [0, 1] */
  similarity: number;
  /** 命中类型: exact(精确) / semantic(语义) */
  hitType: 'exact' | 'semantic';
  /** 查询耗时 (ms) */
  lookupTimeMs: number;
}

/**
 * 缓存配置
 */
export interface SemanticCacheConfig {
  /** 最大缓存条目数 (默认 1000) */
  maxSize?: number;
  /** 语义相似度阈值 [0, 1], 低于此值不命中 (默认 0.85) */
  similarityThreshold?: number;
  /** 默认 TTL (ms, 0 = 永不过期, 默认 3600000 = 1h) */
  defaultTtlMs?: number;
  /** 嵌入维度 (用于查询向量化) */
  embeddingDimension?: number;
  /** 是否启用持久化 */
  enablePersistence?: boolean;
  /** 持久化 key (localStorage) */
  persistenceKey?: string;
  /** 嵌入函数 (可选, 默认使用 TF-IDF) */
  embedder?: (text: string) => Float32Array | Promise<Float32Array>;
  /** 缓存名称 (用于多缓存区分) */
  name?: string;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  /** 缓存名称 */
  name: string;
  /** 总条目数 */
  totalEntries: number;
  /** 最大容量 */
  maxSize: number;
  /** 总查询数 */
  totalQueries: number;
  /** 精确命中数 */
  exactHits: number;
  /** 语义命中数 */
  semanticHits: number;
  /** 未命中数 */
  misses: number;
  /** 命中率 [0, 1] */
  hitRate: number;
  /** 精确命中率 [0, 1] */
  exactHitRate: number;
  /** 语义命中率 [0, 1] */
  semanticHitRate: number;
  /** 总淘汰数 (LRU) */
  totalEvictions: number;
  /** 总过期数 (TTL) */
  totalExpirations: number;
  /** 平均查询耗时 (ms) */
  avgLookupTimeMs: number;
  /** 内存估算 (字节) */
  memoryBytes: number;
  /** 最早条目时间 */
  oldestEntryAt: number;
  /** 最新条目时间 */
  newestEntryAt: number;
}

/**
 * 缓存事件
 */
export type CacheEvent =
  | { type: 'entry-added'; key: string; query: string; at: number }
  | { type: 'hit'; key: string; hitType: 'exact' | 'semantic'; similarity: number; at: number }
  | { type: 'miss'; query: string; at: number }
  | { type: 'evicted'; key: string; reason: 'lru' | 'ttl' | 'manual'; at: number }
  | { type: 'cleared'; at: number }
  | { type: 'warmed-up'; count: number; at: number };

export type CacheListener = (event: CacheEvent) => void;

// ============ TF-IDF Embedder (默认) ============

/**
 * 简单 TF-IDF Embedder (默认实现)
 * - 确定性: 相同文本产生相同向量
 * - 轻量: 纯 JS, 无外部依赖
 * - 用途: 语义相似度计算
 */
class TFIDFEmbedder {
  private dimension: number;
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();

  constructor(dimension: number = 128) {
    this.dimension = dimension;
  }

  /**
   * 计算文本向量
   */
  embed(text: string): Float32Array {
    const vector = new Float32Array(this.dimension);
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return vector;

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    for (const [token, freq] of tf) {
      const idx = this.hashToken(token) % this.dimension;
      const idfScore = this.idf.get(token) ?? 1;
      vector[idx] += (freq / tokens.length) * idfScore;
    }

    // L2 归一化
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dimension; i++) {
      vector[i] /= norm;
    }
    return vector;
  }

  /**
   * 更新词汇表和 IDF
   */
  updateIdf(documents: string[]): void {
    const df = new Map<string, number>();
    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }
    const N = documents.length;
    for (const [token, freq] of df) {
      this.idf.set(token, Math.log(N / (freq + 1)) + 1);
    }
  }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const segments = text.toLowerCase().split(/([\u4e00-\u9fa5])/g);
    for (const seg of segments) {
      if (!seg) continue;
      if (/[\u4e00-\u9fa5]/.test(seg)) {
        for (let i = 0; i < seg.length; i++) {
          tokens.push(seg[i]);
          if (i < seg.length - 1) {
            tokens.push(seg.substring(i, i + 2));
          }
        }
      } else {
        const words = seg.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter((t) => t.length > 0);
        tokens.push(...words);
      }
    }
    return tokens;
  }

  private hashToken(token: string): number {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}

// ============ 工具函数 ============

/**
 * 计算 query 哈希键
 */
function hashQuery(query: string): string {
  let hash = 0;
  const normalized = query.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `q-${Math.abs(hash).toString(36)}`;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 估算内存占用
 */
function estimateEntrySize(entry: CacheEntry): number {
  return (
    entry.key.length * 2 +
    entry.query.length * 2 +
    entry.embedding.byteLength +
    JSON.stringify(entry.value).length * 2 +
    200 // 元数据
  );
}

// ============ RAGSemanticCache 主类 ============

/**
 * RAG 智能语义缓存
 *
 * 三级查询:
 *   1. L1 精确匹配: O(1) 哈希查找
 *   2. L2 语义相似: O(n) cosine 计算, 仅查询前 N 个最近访问的条目
 *   3. 未命中: 调用上游 RAG 系统
 */
export class RAGSemanticCache<T = unknown> {
  private readonly name: string;
  private readonly maxSize: number;
  private readonly similarityThreshold: number;
  private readonly defaultTtlMs: number;
  private readonly enablePersistence: boolean;
  private readonly persistenceKey: string;
  private readonly customEmbedder?: (text: string) => Float32Array | Promise<Float32Array>;
  private readonly tfidfEmbedder: TFIDFEmbedder;
  private readonly entries: Map<string, CacheEntry<T>> = new Map();
  private readonly listeners: Set<CacheListener> = new Set();
  private readonly stats: {
    totalQueries: number;
    exactHits: number;
    semanticHits: number;
    misses: number;
    totalEvictions: number;
    totalExpirations: number;
    totalLookupTimeMs: number;
    accessSeq: number;
  } = {
    totalQueries: 0,
    exactHits: 0,
    semanticHits: 0,
    misses: 0,
    totalEvictions: 0,
    totalExpirations: 0,
    totalLookupTimeMs: 0,
    accessSeq: 0,
  };

  constructor(config: SemanticCacheConfig = {}) {
    this.name = config.name ?? 'rag-cache';
    this.maxSize = config.maxSize ?? 1000;
    this.similarityThreshold = config.similarityThreshold ?? 0.85;
    this.defaultTtlMs = config.defaultTtlMs ?? 3600000; // 1 hour
    this.enablePersistence = config.enablePersistence ?? false;
    this.persistenceKey = config.persistenceKey ?? `${this.name}-cache`;
    this.customEmbedder = config.embedder;
    this.tfidfEmbedder = new TFIDFEmbedder(config.embeddingDimension ?? 128);

    if (this.enablePersistence) {
      this.loadFromStorage();
    }
  }

  // ============ 核心 API ============

  /**
   * 查询缓存
   */
  async get(query: string): Promise<CacheHit<T> | null> {
    const startTime = Date.now();
    this.stats.totalQueries += 1;
    const key = hashQuery(query);
    const now = Date.now();

    // L1: 精确匹配
    const exact = this.entries.get(key);
    if (exact) {
      if (this.isExpired(exact, now)) {
        this.entries.delete(key);
        this.stats.totalExpirations += 1;
        this.emit({ type: 'evicted', key, reason: 'ttl', at: now });
      } else {
        exact.lastAccessedAt = now;
        exact.accessSeq = ++this.stats.accessSeq;
        exact.accessCount += 1;
        const lookupTime = Date.now() - startTime;
        this.stats.exactHits += 1;
        this.stats.totalLookupTimeMs += lookupTime;
        this.emit({ type: 'hit', key, hitType: 'exact', similarity: 1.0, at: now });
        return {
          entry: exact,
          similarity: 1.0,
          hitType: 'exact',
          lookupTimeMs: lookupTime,
        };
      }
    }

    // L2: 语义相似
    const queryVec = await this.embed(query);
    let bestEntry: CacheEntry<T> | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      if (this.isExpired(entry, now)) continue;
      const sim = cosineSimilarity(queryVec, entry.embedding);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestEntry = entry;
      }
    }

    const lookupTime = Date.now() - startTime;
    this.stats.totalLookupTimeMs += lookupTime;

    if (bestEntry && bestSimilarity >= this.similarityThreshold) {
      bestEntry.lastAccessedAt = now;
      bestEntry.accessSeq = ++this.stats.accessSeq;
      bestEntry.accessCount += 1;
      this.stats.semanticHits += 1;
      this.emit({
        type: 'hit',
        key: bestEntry.key,
        hitType: 'semantic',
        similarity: bestSimilarity,
        at: now,
      });
      return {
        entry: bestEntry,
        similarity: bestSimilarity,
        hitType: 'semantic',
        lookupTimeMs: lookupTime,
      };
    }

    // Miss
    this.stats.misses += 1;
    this.emit({ type: 'miss', query, at: now });
    return null;
  }

  /**
   * 写入缓存
   */
  async set(query: string, value: T, options: { ttlMs?: number; metadata?: Record<string, unknown> } = {}): Promise<CacheEntry<T>> {
    const key = hashQuery(query);
    const now = Date.now();
    const ttl = options.ttlMs ?? this.defaultTtlMs;
    const embedding = await this.embed(query);

    const entry: CacheEntry<T> = {
      key,
      query,
      embedding,
      value,
      createdAt: now,
      lastAccessedAt: now,
      accessSeq: ++this.stats.accessSeq,
      accessCount: 1,
      expiresAt: ttl > 0 ? now + ttl : 0,
      hitType: 'exact',
      metadata: options.metadata,
    };

    // 容量淘汰
    while (this.entries.size >= this.maxSize) {
      this.evictLRU();
    }

    this.entries.set(key, entry);
    this.emit({ type: 'entry-added', key, query, at: now });

    if (this.enablePersistence) {
      this.saveToStorage();
    }

    return entry;
  }

  /**
   * 获取或设置 (Cache-Aside 模式)
   */
  async getOrSet(
    query: string,
    loader: () => Promise<T> | T,
    options: { ttlMs?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<{ value: T; hit: CacheHit<T> | null }> {
    const hit = await this.get(query);
    if (hit) {
      return { value: hit.entry.value, hit };
    }
    const value = await loader();
    await this.set(query, value, options);
    return { value, hit: null };
  }

  /**
   * 失效指定 query
   */
  invalidate(query: string): boolean {
    const key = hashQuery(query);
    const existed = this.entries.delete(key);
    if (existed && this.enablePersistence) {
      this.saveToStorage();
    }
    if (existed) {
      this.emit({ type: 'evicted', key, reason: 'manual', at: Date.now() });
    }
    return existed;
  }

  /**
   * 失效所有匹配模式的条目
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (pattern.test(entry.query)) {
        this.entries.delete(key);
        count += 1;
        this.emit({ type: 'evicted', key, reason: 'manual', at: Date.now() });
      }
    }
    if (count > 0 && this.enablePersistence) {
      this.saveToStorage();
    }
    return count;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.entries.clear();
    this.emit({ type: 'cleared', at: Date.now() });
    if (this.enablePersistence && typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.persistenceKey);
    }
  }

  /**
   * 预热 (批量预加载热点 query)
   */
  async warmup(queries: string[], loader: (q: string) => Promise<T> | T): Promise<number> {
    let count = 0;
    for (const q of queries) {
      const hit = await this.get(q);
      if (!hit) {
        const value = await loader(q);
        await this.set(q, value);
        count += 1;
      }
    }
    this.emit({ type: 'warmed-up', count, at: Date.now() });
    return count;
  }

  /**
   * 获取统计
   */
  getStats(): CacheStats {
    const now = Date.now();
    let memoryBytes = 0;
    let oldestAt = now;
    let newestAt = 0;

    for (const entry of this.entries.values()) {
      memoryBytes += estimateEntrySize(entry);
      if (entry.createdAt < oldestAt) oldestAt = entry.createdAt;
      if (entry.createdAt > newestAt) newestAt = entry.createdAt;
    }

    return {
      name: this.name,
      totalEntries: this.entries.size,
      maxSize: this.maxSize,
      totalQueries: this.stats.totalQueries,
      exactHits: this.stats.exactHits,
      semanticHits: this.stats.semanticHits,
      misses: this.stats.misses,
      hitRate: this.stats.totalQueries > 0
        ? (this.stats.exactHits + this.stats.semanticHits) / this.stats.totalQueries
        : 0,
      exactHitRate: this.stats.totalQueries > 0
        ? this.stats.exactHits / this.stats.totalQueries
        : 0,
      semanticHitRate: this.stats.totalQueries > 0
        ? this.stats.semanticHits / this.stats.totalQueries
        : 0,
      totalEvictions: this.stats.totalEvictions,
      totalExpirations: this.stats.totalExpirations,
      avgLookupTimeMs: this.stats.totalQueries > 0
        ? this.stats.totalLookupTimeMs / this.stats.totalQueries
        : 0,
      memoryBytes,
      oldestEntryAt: this.entries.size > 0 ? oldestAt : 0,
      newestEntryAt: newestAt,
    };
  }

  /**
   * 获取所有条目
   */
  getAllEntries(): CacheEntry<T>[] {
    return Array.from(this.entries.values());
  }

  /**
   * 缓存大小
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats.totalQueries = 0;
    this.stats.exactHits = 0;
    this.stats.semanticHits = 0;
    this.stats.misses = 0;
    this.stats.totalEvictions = 0;
    this.stats.totalExpirations = 0;
    this.stats.totalLookupTimeMs = 0;
  }

  // ============ 事件订阅 ============

  on(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CacheEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  // ============ 内部方法 ============

  private async embed(text: string): Promise<Float32Array> {
    if (this.customEmbedder) {
      return await this.customEmbedder(text);
    }
    return this.tfidfEmbedder.embed(text);
  }

  private isExpired(entry: CacheEntry<T>, now: number): boolean {
    return entry.expiresAt > 0 && now >= entry.expiresAt;
  }

  /**
   * LRU 淘汰
   */
  private evictLRU(): void {
    let oldest: CacheEntry<T> | null = null;
    let oldestKey = '';
    for (const [key, entry] of this.entries) {
      // 先比 lastAccessedAt (ms),相同则比 accessSeq (单调递增,保证全序)
      if (
        !oldest ||
        entry.lastAccessedAt < oldest.lastAccessedAt ||
        (entry.lastAccessedAt === oldest.lastAccessedAt && entry.accessSeq < oldest.accessSeq)
      ) {
        oldest = entry;
        oldestKey = key;
      }
    }
    if (oldest) {
      this.entries.delete(oldestKey);
      this.stats.totalEvictions += 1;
      this.emit({ type: 'evicted', key: oldestKey, reason: 'lru', at: Date.now() });
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = Array.from(this.entries.values()).map((entry) => ({
        key: entry.key,
        query: entry.query,
        embedding: Array.from(entry.embedding),
        value: entry.value,
        createdAt: entry.createdAt,
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: entry.accessCount,
        expiresAt: entry.expiresAt,
        hitType: entry.hitType,
        metadata: entry.metadata,
      }));
      localStorage.setItem(this.persistenceKey, JSON.stringify(data));
    } catch {
      // localStorage 可能满,忽略
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.persistenceKey);
      if (!raw) return;
      const data = JSON.parse(raw) as Array<Record<string, unknown>>;
      const now = Date.now();
      for (const item of data) {
        const expiresAt = item.expiresAt as number;
        if (expiresAt > 0 && now >= expiresAt) continue;
        const entry: CacheEntry<T> = {
          key: item.key as string,
          query: item.query as string,
          embedding: new Float32Array(item.embedding as number[]),
          value: item.value as T,
          createdAt: item.createdAt as number,
          lastAccessedAt: item.lastAccessedAt as number,
          accessSeq: (item.accessSeq as number | undefined) ?? ++this.stats.accessSeq,
          accessCount: item.accessCount as number,
          expiresAt,
          hitType: 'exact',
          metadata: item.metadata as Record<string, unknown> | undefined,
        };
        this.entries.set(entry.key, entry);
        this.stats.accessSeq = Math.max(this.stats.accessSeq, entry.accessSeq);
      }
    } catch {
      // 解析失败,忽略
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建语义缓存
 */
export function createSemanticCache<T = unknown>(
  config?: SemanticCacheConfig
): RAGSemanticCache<T> {
  return new RAGSemanticCache<T>(config);
}

/**
 * 创建带持久化的语义缓存
 */
export function createPersistentCache<T = unknown>(
  name: string,
  config?: Omit<SemanticCacheConfig, 'name' | 'enablePersistence' | 'persistenceKey'>
): RAGSemanticCache<T> {
  return new RAGSemanticCache<T>({
    ...config,
    name,
    enablePersistence: true,
    persistenceKey: `rag-cache-${name}`,
  });
}
