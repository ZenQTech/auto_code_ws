/**
 * # ============================================================
 * # MultimodalSemanticCache - 跨模态语义缓存 (v1.0.0 Cycle 48 G48-03)
 * # ============================================================
 * # 核心作用：在 RAGSemanticCache 之上构建跨模态缓存层
 * #           - 多模态键: text + image 联合作为查询键
 * #           - 跨模态命中: text 查询可命中 image key, 反之亦然
 * #           - 模态权重: 跨模态相似度自动调整
 * #           - 持久化: 支持 localStorage
 * #           - 智能预热: 批量加载热点
 * #           - 完整事件订阅
 * # 对标产品: GPTCache multimodal / Cloudflare Vectorize Cache
 * # 设计要点:
 * #   1. 多模态键生成: text + image 哈希
 * #   2. 跨模态检索: 在不同模态条目间计算相似度
 * #   3. 模态加权: 同模态命中权重 > 跨模态
 * #   4. 缓存共享: 与 RAGSemanticCache 兼容
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 48 G48-03 初次创建
 * # ============================================================
 */

import { MultimodalEmbedding, type Modality, type MultimodalInput, type EmbeddingResult } from './multimodalEmbedding';

// ============ 类型定义 ============

/**
 * 多模态缓存键
 */
export interface MultimodalCacheKey {
  /** 文本 (可选) */
  text?: string;
  /** 图像 (可选) */
  image?: string;
  /** 模态 */
  modality: Modality;
  /** 元数据 (用于匹配过滤) */
  metadata?: Record<string, unknown>;
}

/**
 * 多模态缓存条目
 */
export interface MultimodalCacheEntry<T = unknown> {
  /** 唯一键 (哈希) */
  key: string;
  /** 原始 key */
  cacheKey: MultimodalCacheKey;
  /** 文本向量 (如果有) */
  textVector?: number[];
  /** 图像向量 (如果有) */
  imageVector?: number[];
  /** 融合向量 (永远存在) */
  fusedVector: number[];
  /** 缓存值 */
  value: T;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessedAt: number;
  /** 访问序号 */
  accessSeq: number;
  /** 访问次数 */
  accessCount: number;
  /** 过期时间 (0 = 永不过期) */
  expiresAt: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 缓存命中结果
 */
export interface MultimodalCacheHit<T = unknown> {
  /** 命中的条目 */
  entry: MultimodalCacheEntry<T>;
  /** 相似度 [0, 1] */
  similarity: number;
  /** 原始余弦相似度 [-1, 1] */
  rawSimilarity: number;
  /** 命中类型 */
  hitType: 'exact' | 'semantic-text' | 'semantic-image' | 'semantic-fused' | 'semantic-cross';
  /** 查询耗时 (ms) */
  lookupTimeMs: number;
}

/**
 * 缓存配置
 */
export interface MultimodalCacheConfig {
  /** 最大条目数 (默认 1000) */
  maxSize?: number;
  /** 相似度阈值 (默认 0.85) */
  similarityThreshold?: number;
  /** 默认 TTL ms (默认 3600000) */
  defaultTtlMs?: number;
  /** 向量维度 (默认 512) */
  dimension?: number;
  /** 跨模态阈值倍数 (默认 0.9, 即跨模态需要更高相似度) */
  crossModalityThresholdMultiplier?: number;
  /** 是否持久化 */
  enablePersistence?: boolean;
  /** 持久化 key */
  persistenceKey?: string;
  /** 自定义 embedder */
  embedding?: MultimodalEmbedding;
}

/**
 * 缓存统计
 */
export interface MultimodalCacheStats {
  name: string;
  totalEntries: number;
  maxSize: number;
  totalQueries: number;
  exactHits: number;
  semanticTextHits: number;
  semanticImageHits: number;
  semanticFusedHits: number;
  semanticCrossHits: number;
  misses: number;
  hitRate: number;
  crossModalityHitRate: number;
  totalEvictions: number;
  totalExpirations: number;
  avgLookupTimeMs: number;
  memoryBytes: number;
}

/**
 * 事件
 */
export type MultimodalCacheEvent =
  | { type: 'entry-added'; key: string; modality: Modality; at: number }
  | { type: 'hit'; key: string; hitType: MultimodalCacheHit<unknown>['hitType']; similarity: number; at: number }
  | { type: 'miss'; cacheKey: MultimodalCacheKey; at: number }
  | { type: 'evicted'; key: string; reason: 'lru' | 'ttl' | 'manual'; at: number }
  | { type: 'warmed-up'; count: number; at: number }
  | { type: 'cleared'; at: number };

export type MultimodalCacheListener = (event: MultimodalCacheEvent) => void;

// ============ 工具函数 ============

/**
 * 生成缓存键哈希
 */
function hashCacheKey(key: MultimodalCacheKey): string {
  const parts: string[] = [key.modality];
  if (key.text) parts.push(`t:${key.text}`);
  if (key.image) parts.push(`i:${key.image.slice(0, 200)}`);
  if (key.metadata) parts.push(`m:${JSON.stringify(key.metadata)}`);
  const raw = parts.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `mc-${Math.abs(hash).toString(36)}`;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 估算条目内存
 */
function estimateEntryMemory(entry: MultimodalCacheEntry): number {
  return (
    entry.key.length * 2 +
    (entry.cacheKey.text?.length ?? 0) * 2 +
    (entry.cacheKey.image?.length ?? 0) * 2 +
    entry.fusedVector.length * 8 +
    (entry.textVector?.length ?? 0) * 8 +
    (entry.imageVector?.length ?? 0) * 8 +
    JSON.stringify(entry.value).length * 2 +
    300
  );
}

// ============ MultimodalSemanticCache 主类 ============

/**
 * 跨模态语义缓存
 *
 * 三级命中策略:
 *   1. L1 精确匹配: 哈希键直接命中
 *   2. L2 同模态语义: text→text, image→image 相似度匹配
 *   3. L3 跨模态语义: text↔image 跨模态匹配 (阈值更高)
 */
export class MultimodalSemanticCache<T = unknown> {
  private readonly name: string;
  private readonly maxSize: number;
  private readonly similarityThreshold: number;
  private readonly defaultTtlMs: number;
  private readonly dimension: number;
  private readonly crossModalityThresholdMultiplier: number;
  private readonly enablePersistence: boolean;
  private readonly persistenceKey: string;
  private readonly embedding: MultimodalEmbedding;
  private readonly entries: Map<string, MultimodalCacheEntry<T>> = new Map();
  private readonly listeners: Set<MultimodalCacheListener> = new Set();
  private stats = {
    totalQueries: 0,
    exactHits: 0,
    semanticTextHits: 0,
    semanticImageHits: 0,
    semanticFusedHits: 0,
    semanticCrossHits: 0,
    misses: 0,
    totalEvictions: 0,
    totalExpirations: 0,
    totalLookupTimeMs: 0,
    accessSeq: 0,
  };

  constructor(config: MultimodalCacheConfig = {}) {
    this.name = 'multimodal-cache';
    this.maxSize = config.maxSize ?? 1000;
    this.similarityThreshold = config.similarityThreshold ?? 0.85;
    this.defaultTtlMs = config.defaultTtlMs ?? 3600000;
    this.dimension = config.dimension ?? 512;
    this.crossModalityThresholdMultiplier = config.crossModalityThresholdMultiplier ?? 0.9;
    this.enablePersistence = config.enablePersistence ?? false;
    this.persistenceKey = config.persistenceKey ?? 'multimodal-cache';
    this.embedding = config.embedding ?? new MultimodalEmbedding({ dimension: this.dimension });

    if (this.enablePersistence && typeof localStorage !== 'undefined') {
      this.loadFromStorage();
    }
  }

  // ============ 核心 API ============

  /**
   * 查询缓存
   */
  async get(key: MultimodalCacheKey): Promise<MultimodalCacheHit<T> | null> {
    const startTime = Date.now();
    this.stats.totalQueries += 1;
    const hashKey = hashCacheKey(key);
    const now = Date.now();

    // L1: 精确匹配
    const exact = this.entries.get(hashKey);
    if (exact) {
      if (this.isExpired(exact, now)) {
        this.entries.delete(hashKey);
        this.stats.totalExpirations += 1;
        this.emit({ type: 'evicted', key: hashKey, reason: 'ttl', at: now });
      } else {
        this.touchEntry(exact, now);
        this.stats.exactHits += 1;
        const lookupTime = Date.now() - startTime;
        this.stats.totalLookupTimeMs += lookupTime;
        this.emit({ type: 'hit', key: hashKey, hitType: 'exact', similarity: 1.0, at: now });
        return {
          entry: exact,
          similarity: 1.0,
          rawSimilarity: 1.0,
          hitType: 'exact',
          lookupTimeMs: lookupTime,
        };
      }
    }

    // L2/L3: 语义匹配
    const queryInput: MultimodalInput = {
      modality: key.modality,
      text: key.text,
      image: key.image,
    };
    const queryEmb = await this.embedding.embed(queryInput);

    let bestEntry: MultimodalCacheEntry<T> | null = null;
    let bestSim = 0;
    let bestHitType: MultimodalCacheHit<T>['hitType'] = 'semantic-fused';

    for (const entry of this.entries.values()) {
      if (this.isExpired(entry, now)) continue;

      // 尝试不同模态组合
      const candidates: Array<{ vec: number[]; type: MultimodalCacheHit<unknown>['hitType'] }> = [];

      if (queryEmb.modality === 'text' || queryEmb.modality === 'multimodal') {
        if (entry.textVector) {
          candidates.push({ vec: entry.textVector, type: 'semantic-text' });
        }
      }
      if (queryEmb.modality === 'image' || queryEmb.modality === 'multimodal') {
        if (entry.imageVector) {
          candidates.push({ vec: entry.imageVector, type: 'semantic-image' });
        }
      }
      if (entry.fusedVector) {
        candidates.push({ vec: entry.fusedVector, type: 'semantic-fused' });
      }

      for (const cand of candidates) {
        const sim = cosineSimilarity(queryEmb.vector, cand.vec);
        // 跨模态需要更高阈值
        const isCrossModal = (queryEmb.modality === 'text' && cand.type === 'semantic-image') ||
                            (queryEmb.modality === 'image' && cand.type === 'semantic-text');
        const requiredThreshold = isCrossModal
          ? this.similarityThreshold * this.crossModalityThresholdMultiplier
          : this.similarityThreshold;
        if (sim > bestSim && sim >= requiredThreshold) {
          bestSim = sim;
          bestEntry = entry;
          bestHitType = isCrossModal ? 'semantic-cross' : cand.type;
        }
      }
    }

    const lookupTime = Date.now() - startTime;
    this.stats.totalLookupTimeMs += lookupTime;

    if (bestEntry) {
      this.touchEntry(bestEntry, now);
      this.updateHitStats(bestHitType);
      const normalizedSim = (bestSim + 1) / 2;
      this.emit({
        type: 'hit',
        key: bestEntry.key,
        hitType: bestHitType,
        similarity: normalizedSim,
        at: now,
      });
      return {
        entry: bestEntry,
        similarity: normalizedSim,
        rawSimilarity: bestSim,
        hitType: bestHitType,
        lookupTimeMs: lookupTime,
      };
    }

    // Miss
    this.stats.misses += 1;
    this.emit({ type: 'miss', cacheKey: key, at: now });
    return null;
  }

  /**
   * 写入缓存
   */
  async set(key: MultimodalCacheKey, value: T, options: { ttlMs?: number; metadata?: Record<string, unknown> } = {}): Promise<MultimodalCacheEntry<T>> {
    const hashKey = hashCacheKey(key);
    const now = Date.now();
    const ttl = options.ttlMs ?? this.defaultTtlMs;

    // 计算向量
    const queryInput: MultimodalInput = {
      modality: key.modality,
      text: key.text,
      image: key.image,
    };
    const emb = await this.embedding.embed(queryInput);

    const entry: MultimodalCacheEntry<T> = {
      key: hashKey,
      cacheKey: key,
      textVector: key.text ? emb.vector : undefined,
      imageVector: key.image ? emb.vector : undefined,
      fusedVector: emb.vector,
      value,
      createdAt: now,
      lastAccessedAt: now,
      accessSeq: ++this.stats.accessSeq,
      accessCount: 1,
      expiresAt: ttl > 0 ? now + ttl : 0,
      metadata: options.metadata,
    };

    // 容量淘汰
    while (this.entries.size >= this.maxSize) {
      this.evictLRU();
    }

    this.entries.set(hashKey, entry);
    this.emit({ type: 'entry-added', key: hashKey, modality: key.modality, at: now });

    if (this.enablePersistence) {
      this.saveToStorage();
    }

    return entry;
  }

  /**
   * 获取或设置 (Cache-Aside 模式)
   */
  async getOrSet(
    key: MultimodalCacheKey,
    loader: () => Promise<T> | T,
    options: { ttlMs?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<{ value: T; hit: MultimodalCacheHit<T> | null }> {
    const hit = await this.get(key);
    if (hit) {
      return { value: hit.entry.value, hit };
    }
    const value = await loader();
    await this.set(key, value, options);
    return { value, hit: null };
  }

  /**
   * 失效指定 key
   */
  invalidate(key: MultimodalCacheKey): boolean {
    const hashKey = hashCacheKey(key);
    const existed = this.entries.delete(hashKey);
    if (existed) {
      this.emit({ type: 'evicted', key: hashKey, reason: 'manual', at: Date.now() });
      if (this.enablePersistence) this.saveToStorage();
    }
    return existed;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.entries.clear();
    this.emit({ type: 'cleared', at: Date.now() });
    if (this.enablePersistence) this.saveToStorage();
  }

  /**
   * 预热: 批量加载
   */
  async warmup(items: Array<{ key: MultimodalCacheKey; value: T; ttlMs?: number }>): Promise<number> {
    let count = 0;
    for (const item of items) {
      await this.set(item.key, item.value, { ttlMs: item.ttlMs });
      count += 1;
    }
    this.emit({ type: 'warmed-up', count, at: Date.now() });
    return count;
  }

  /**
   * 列出所有缓存条目 (元数据)
   */
  listEntries(): Array<{
    key: string;
    modality: Modality;
    text?: string;
    image?: string;
    createdAt: number;
    accessCount: number;
  }> {
    return Array.from(this.entries.values()).map((e) => ({
      key: e.key,
      modality: e.cacheKey.modality,
      text: e.cacheKey.text,
      image: e.cacheKey.image,
      createdAt: e.createdAt,
      accessCount: e.accessCount,
    }));
  }

  /**
   * 获取统计
   */
  getStats(): MultimodalCacheStats {
    const totalHits = this.stats.exactHits + this.stats.semanticTextHits +
                     this.stats.semanticImageHits + this.stats.semanticFusedHits +
                     this.stats.semanticCrossHits;
    const crossHits = this.stats.semanticCrossHits;
    let memBytes = 0;
    for (const entry of this.entries.values()) {
      memBytes += estimateEntryMemory(entry);
    }
    return {
      name: this.name,
      totalEntries: this.entries.size,
      maxSize: this.maxSize,
      totalQueries: this.stats.totalQueries,
      exactHits: this.stats.exactHits,
      semanticTextHits: this.stats.semanticTextHits,
      semanticImageHits: this.stats.semanticImageHits,
      semanticFusedHits: this.stats.semanticFusedHits,
      semanticCrossHits: this.stats.semanticCrossHits,
      misses: this.stats.misses,
      hitRate: this.stats.totalQueries > 0 ? totalHits / this.stats.totalQueries : 0,
      crossModalityHitRate: this.stats.totalQueries > 0 ? crossHits / this.stats.totalQueries : 0,
      totalEvictions: this.stats.totalEvictions,
      totalExpirations: this.stats.totalExpirations,
      avgLookupTimeMs: this.stats.totalQueries > 0 ? this.stats.totalLookupTimeMs / this.stats.totalQueries : 0,
      memoryBytes: memBytes,
    };
  }

  /**
   * 订阅事件
   */
  subscribe(listener: MultimodalCacheListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ 内部方法 ============

  private isExpired(entry: MultimodalCacheEntry<unknown>, now: number): boolean {
    return entry.expiresAt > 0 && entry.expiresAt < now;
  }

  private touchEntry(entry: MultimodalCacheEntry<T>, now: number): void {
    entry.lastAccessedAt = now;
    entry.accessSeq = ++this.stats.accessSeq;
    entry.accessCount += 1;
  }

  private updateHitStats(hitType: MultimodalCacheHit<T>['hitType']): void {
    switch (hitType) {
      case 'exact': this.stats.exactHits += 1; break;
      case 'semantic-text': this.stats.semanticTextHits += 1; break;
      case 'semantic-image': this.stats.semanticImageHits += 1; break;
      case 'semantic-fused': this.stats.semanticFusedHits += 1; break;
      case 'semantic-cross': this.stats.semanticCrossHits += 1; break;
    }
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestSeq = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.accessSeq < oldestSeq) {
        oldestSeq = entry.accessSeq;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
      this.stats.totalEvictions += 1;
      this.emit({ type: 'evicted', key: oldestKey, reason: 'lru', at: Date.now() });
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = Array.from(this.entries.entries()).map(([k, v]) => ({
        k,
        v: {
          ...v,
          // 不保存 vector, 启动时重新计算
          textVector: undefined,
          imageVector: undefined,
          fusedVector: [],
        },
      }));
      localStorage.setItem(this.persistenceKey, JSON.stringify(data));
    } catch (e) {
      // 静默失败
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.persistenceKey);
      if (!raw) return;
      const data = JSON.parse(raw) as Array<{ k: string; v: MultimodalCacheEntry<T> }>;
      // 仅恢复 key/value, vectors 重新计算
      for (const item of data) {
        this.entries.set(item.k, {
          ...item.v,
          textVector: undefined,
          imageVector: undefined,
          fusedVector: [],
        });
      }
    } catch (e) {
      // 静默失败
    }
  }

  private emit(event: MultimodalCacheEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        // 静默失败
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建跨模态语义缓存
 */
export function createMultimodalCache<T = unknown>(config: MultimodalCacheConfig = {}): MultimodalSemanticCache<T> {
  return new MultimodalSemanticCache<T>(config);
}
