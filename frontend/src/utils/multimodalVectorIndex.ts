/**
 * # ============================================================
 * # MultimodalVectorIndex - 图文混合向量索引 (v1.0.0 Cycle 48 G48-02)
 * # ============================================================
 * # 核心作用：在 FAISS-WASM 之上构建多模态混合索引
 * #           - 文档支持多模态内容 (文本/图像/多模态)
 * #           - 跨模态检索: 文本→文档 / 图像→文档 / 多模态→文档
 * #           - 模态感知打分: 同模态加权 / 跨模态惩罚
 * #           - 文档级重排序: 综合多模态分数
 * #           - 自动 ID 生成
 * #           - 事件订阅
 * # 对标产品: Weaviate Multi-Vector / Pinecone Sparse-Dense / Milvus Hybrid Search
 * # 设计要点:
 * #   1. 文档模型: 包含多种模态的原始内容 + 预计算向量
 * #   2. 同源检索: 共享向量空间直接计算相似度
 * #   3. 模态权重: 支持配置同模态/跨模态权重
 * #   4. 重排序: 支持多模态分数综合
 * #   5. 性能: O(1) 插入 / O(n log k) TopK 检索
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 48 G48-02 初次创建
 * # ============================================================
 */

import { FAISSWasmVectorStore, createFAISSStore, type IndexType } from './faissWasmVectorStore';
import { MultimodalEmbedding, type Modality, type MultimodalInput, type EmbeddingResult } from './multimodalEmbedding';

// ============ 类型定义 ============

/**
 * 多模态文档
 */
export interface MultimodalDocument {
  /** 文档 ID */
  id: string;
  /** 文本内容 */
  text?: string;
  /** 图像 URL/Base64 */
  image?: string;
  /** 模态 (主模态) */
  primaryModality: Modality;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: number;
  /** 是否为多模态融合文档 */
  isMultimodal: boolean;
}

/**
 * 文档及其向量 (内部存储)
 */
interface IndexedDocument extends MultimodalDocument {
  /** 文本向量 (如果有) */
  textVector?: number[];
  /** 图像向量 (如果有) */
  imageVector?: number[];
  /** 多模态融合向量 (如果有) */
  fusedVector?: number[];
}

/**
 * 跨模态检索选项
 */
export interface CrossModalSearchOptions {
  /** 返回 Top K (默认 10) */
  topK?: number;
  /** 模态权重 (同模态加权, 默认 1.0) */
  sameModalityWeight?: number;
  /** 跨模态权重 (默认 0.7) */
  crossModalityWeight?: number;
  /** 最小相似度阈值 (默认 0) */
  minSimilarity?: number;
  /** 元数据过滤 (精确匹配) */
  metadataFilter?: Record<string, unknown>;
  /** 是否融合多模态分数 (默认 true) */
  fuseScores?: boolean;
}

/**
 * 跨模态检索结果
 */
export interface CrossModalSearchResult {
  /** 文档 */
  document: MultimodalDocument;
  /** 综合分数 [0, 1] */
  score: number;
  /** 原始余弦相似度 [-1, 1] */
  similarity: number;
  /** 匹配的模态 */
  matchedModality: Modality;
  /** 分数明细 (各模态贡献) */
  breakdown: {
    textScore?: number;
    imageScore?: number;
    fusedScore?: number;
  };
  /** 排名 (0-based) */
  rank: number;
}

/**
 * 索引统计
 */
export interface MultimodalIndexStats {
  /** 文档总数 */
  totalDocuments: number;
  /** 文本模态文档数 */
  textDocuments: number;
  /** 图像模态文档数 */
  imageDocuments: number;
  /** 多模态文档数 */
  multimodalDocuments: number;
  /** 向量维度 */
  dimension: number;
  /** FAISS 索引类型 */
  indexType: IndexType;
  /** 总检索次数 */
  totalSearches: number;
  /** 缓存命中数 */
  totalCacheHits: number;
  /** 平均检索耗时 (ms) */
  avgSearchTimeMs: number;
  /** 内存估算 (字节) */
  memoryBytes: number;
}

/**
 * 事件
 */
export type IndexEvent =
  | { type: 'document-added'; id: string; modality: Modality; at: number }
  | { type: 'document-removed'; id: string; at: number }
  | { type: 'search-completed'; queryModality: Modality; resultCount: number; durationMs: number; at: number }
  | { type: 'cleared'; at: number }
  | { type: 'index-rebuilt'; indexType: IndexType; at: number };

export type IndexListener = (event: IndexEvent) => void;

// ============ 工具函数 ============

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
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
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 估算文档内存占用
 */
function estimateDocMemory(doc: IndexedDocument): number {
  return (
    (doc.text?.length ?? 0) * 2 +
    (doc.image?.length ?? 0) * 2 +
    (doc.textVector?.length ?? 0) * 8 +
    (doc.imageVector?.length ?? 0) * 8 +
    (doc.fusedVector?.length ?? 0) * 8 +
    200 // metadata + structure
  );
}

/**
 * 生成文档 ID
 */
function generateDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// ============ MultimodalVectorIndex 主类 ============

/**
 * 图文混合向量索引
 *
 * 核心功能:
 *   1. 多模态文档管理
 *   2. 跨模态检索
 *   3. 模态感知打分
 *   4. 多模态分数融合
 *   5. 性能监控
 */
export class MultimodalVectorIndex {
  private readonly embedding: MultimodalEmbedding;
  private readonly dimension: number;
  private readonly indexType: IndexType;
  /** FAISS 索引: 存储所有文档的融合向量 */
  private readonly fusedIndex: FAISSWasmVectorStore;
  /** FAISS 索引: 存储文本向量 */
  private readonly textIndex: FAISSWasmVectorStore;
  /** FAISS 索引: 存储图像向量 */
  private readonly imageIndex: FAISSWasmVectorStore;
  /** 文档存储 */
  private readonly documents: Map<string, IndexedDocument> = new Map();
  /** 事件订阅 */
  private readonly listeners: Set<IndexListener> = new Set();
  /** 统计 */
  private stats = {
    totalSearches: 0,
    totalCacheHits: 0,
    totalSearchTimeMs: 0,
    textCount: 0,
    imageCount: 0,
    multimodalCount: 0,
  };

  constructor(config: {
    embedding?: MultimodalEmbedding;
    dimension?: number;
    indexType?: IndexType;
  } = {}) {
    this.embedding = config.embedding ?? new MultimodalEmbedding({ dimension: config.dimension ?? 512 });
    this.dimension = config.dimension ?? 512;
    this.indexType = config.indexType ?? 'flat';

    // 三个 FAISS 索引
    this.fusedIndex = createFAISSStore(this.dimension, { type: this.indexType });
    this.textIndex = createFAISSStore(this.dimension, { type: this.indexType });
    this.imageIndex = createFAISSStore(this.dimension, { type: this.indexType });
  }

  // ============ 文档管理 API ============

  /**
   * 添加文档 (自动向量化)
   */
  async addDocument(doc: Omit<MultimodalDocument, 'id' | 'createdAt' | 'isMultimodal'> & { id?: string }): Promise<MultimodalDocument> {
    const id = doc.id ?? generateDocId();
    const isMultimodal = !!(doc.text && doc.image);

    let textVector: number[] | undefined;
    let imageVector: number[] | undefined;
    let fusedVector: number[] | undefined;

    // 计算文本向量
    if (doc.text) {
      const r = await this.embedding.embedText(doc.text);
      textVector = r.vector;
    }

    // 计算图像向量
    if (doc.image) {
      const r = await this.embedding.embedImage(doc.image);
      imageVector = r.vector;
    }

    // 计算融合向量
    if (isMultimodal && doc.text && doc.image) {
      const r = await this.embedding.embedMultimodal(doc.text, doc.image);
      fusedVector = r.vector;
    } else if (textVector) {
      fusedVector = textVector;
    } else if (imageVector) {
      fusedVector = imageVector;
    }

    if (!fusedVector) {
      throw new Error('文档必须包含 text 或 image 至少一项');
    }

    // 存储到 FAISS
    this.fusedIndex.add(id, new Float32Array(fusedVector));
    if (textVector) this.textIndex.add(id, new Float32Array(textVector));
    if (imageVector) this.imageIndex.add(id, new Float32Array(imageVector));

    // 存储文档
    const fullDoc: IndexedDocument = {
      id,
      text: doc.text,
      image: doc.image,
      primaryModality: doc.primaryModality,
      metadata: doc.metadata,
      createdAt: Date.now(),
      isMultimodal,
      textVector,
      imageVector,
      fusedVector,
    };
    this.documents.set(id, fullDoc);

    // 更新统计
    if (isMultimodal) this.stats.multimodalCount += 1;
    else if (doc.text) this.stats.textCount += 1;
    else if (doc.image) this.stats.imageCount += 1;

    this.emit({ type: 'document-added', id, modality: doc.primaryModality, at: Date.now() });
    return { ...fullDoc };
  }

  /**
   * 批量添加文档
   */
  async addDocuments(docs: Array<Omit<MultimodalDocument, 'id' | 'createdAt' | 'isMultimodal'> & { id?: string }>): Promise<MultimodalDocument[]> {
    const results: MultimodalDocument[] = [];
    for (const doc of docs) {
      results.push(await this.addDocument(doc));
    }
    return results;
  }

  /**
   * 获取文档
   */
  getDocument(id: string): MultimodalDocument | undefined {
    const doc = this.documents.get(id);
    if (!doc) return undefined;
    return {
      id: doc.id,
      text: doc.text,
      image: doc.image,
      primaryModality: doc.primaryModality,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      isMultimodal: doc.isMultimodal,
    };
  }

  /**
   * 列出所有文档
   */
  listDocuments(): MultimodalDocument[] {
    return Array.from(this.documents.values()).map((doc) => ({
      id: doc.id,
      text: doc.text,
      image: doc.image,
      primaryModality: doc.primaryModality,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      isMultimodal: doc.isMultimodal,
    }));
  }

  /**
   * 删除文档
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    this.fusedIndex.delete(id);
    if (doc.textVector) this.textIndex.delete(id);
    if (doc.imageVector) this.imageIndex.delete(id);
    this.documents.delete(id);

    if (doc.isMultimodal) this.stats.multimodalCount = Math.max(0, this.stats.multimodalCount - 1);
    else if (doc.text) this.stats.textCount = Math.max(0, this.stats.textCount - 1);
    else if (doc.image) this.stats.imageCount = Math.max(0, this.stats.imageCount - 1);

    this.emit({ type: 'document-removed', id, at: Date.now() });
    return true;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents.clear();
    this.fusedIndex.clear();
    this.textIndex.clear();
    this.imageIndex.clear();
    this.stats.textCount = 0;
    this.stats.imageCount = 0;
    this.stats.multimodalCount = 0;
    this.emit({ type: 'cleared', at: Date.now() });
  }

  // ============ 检索 API ============

  /**
   * 跨模态检索: 文本查询
   */
  async searchByText(text: string, options: CrossModalSearchOptions = {}): Promise<CrossModalSearchResult[]> {
    const startTime = Date.now();
    const emb = await this.embedding.embedText(text);
    const results = await this.crossModalSearch(emb, 'text', options);
    this.recordSearch(startTime, results.length, 'text');
    return results;
  }

  /**
   * 跨模态检索: 图像查询
   */
  async searchByImage(image: string, options: CrossModalSearchOptions = {}): Promise<CrossModalSearchResult[]> {
    const startTime = Date.now();
    const emb = await this.embedding.embedImage(image);
    const results = await this.crossModalSearch(emb, 'image', options);
    this.recordSearch(startTime, results.length, 'image');
    return results;
  }

  /**
   * 跨模态检索: 多模态查询
   */
  async searchByMultimodal(text: string, image: string, options: CrossModalSearchOptions = {}): Promise<CrossModalSearchResult[]> {
    const startTime = Date.now();
    const emb = await this.embedding.embedMultimodal(text, image);
    const results = await this.crossModalSearch(emb, 'multimodal', options);
    this.recordSearch(startTime, results.length, 'multimodal');
    return results;
  }

  /**
   * 通用跨模态检索 (基于已嵌入向量)
   */
  private async crossModalSearch(
    queryEmb: EmbeddingResult,
    queryModality: Modality,
    options: CrossModalSearchOptions
  ): Promise<CrossModalSearchResult[]> {
    const topK = options.topK ?? 10;
    const sameWeight = options.sameModalityWeight ?? 1.0;
    const crossWeight = options.crossModalityWeight ?? 0.7;
    const minSim = options.minSimilarity ?? -1;
    const fuseScores = options.fuseScores ?? true;

    // 搜索候选 (从融合索引)
    const queryVec = new Float32Array(queryEmb.vector);
    const candidates = this.fusedIndex.search(queryVec, topK * 3);

    // 计算各模态分数
    const scored: CrossModalSearchResult[] = [];
    for (const c of candidates) {
      const doc = this.documents.get(c.id);
      if (!doc) continue;

      // 元数据过滤
      if (options.metadataFilter) {
        let pass = true;
        for (const [key, value] of Object.entries(options.metadataFilter)) {
          if (doc.metadata?.[key] !== value) {
            pass = false;
            break;
          }
        }
        if (!pass) continue;
      }

      // 计算各模态分数
      let textScore: number | undefined;
      let imageScore: number | undefined;
      let fusedScore = c.score; // FAISS 已计算的余弦相似度

      if (doc.textVector) {
        textScore = cosineSimilarity(queryEmb.vector, doc.textVector);
      }
      if (doc.imageVector) {
        imageScore = cosineSimilarity(queryEmb.vector, doc.imageVector);
      }

      // 综合分数计算
      const isSameModality = doc.primaryModality === queryModality;
      const modalityWeight = isSameModality ? sameWeight : crossWeight;

      let finalScore: number;
      let matchedModality: Modality = doc.primaryModality;
      const breakdown: { textScore?: number; imageScore?: number; fusedScore?: number } = { fusedScore };

      if (fuseScores && (textScore !== undefined || imageScore !== undefined)) {
        // 多模态融合: 加权平均
        const scores: number[] = [];
        const weights: number[] = [];

        if (fusedScore !== undefined) {
          scores.push(fusedScore);
          weights.push(0.5);
        }
        if (textScore !== undefined) {
          scores.push(textScore);
          weights.push(0.3);
          breakdown.textScore = textScore;
        }
        if (imageScore !== undefined) {
          scores.push(imageScore);
          weights.push(0.2);
          breakdown.imageScore = imageScore;
        }

        const totalWeight = weights.reduce((s, w) => s + w, 0);
        const weightedSum = scores.reduce((s, v, i) => s + v * weights[i]!, 0);
        finalScore = weightedSum / totalWeight;

        // 选择最匹配的模态
        if (textScore !== undefined && imageScore !== undefined) {
          matchedModality = textScore > imageScore ? 'text' : 'image';
        } else if (textScore !== undefined) {
          matchedModality = 'text';
        } else if (imageScore !== undefined) {
          matchedModality = 'image';
        }
      } else {
        // 仅用融合分数
        finalScore = fusedScore;
        if (textScore !== undefined) breakdown.textScore = textScore;
        if (imageScore !== undefined) breakdown.imageScore = imageScore;
      }

      finalScore = finalScore * modalityWeight;

      // 阈值过滤
      if (finalScore < minSim) continue;

      scored.push({
        document: {
          id: doc.id,
          text: doc.text,
          image: doc.image,
          primaryModality: doc.primaryModality,
          metadata: doc.metadata,
          createdAt: doc.createdAt,
          isMultimodal: doc.isMultimodal,
        },
        score: Math.max(0, Math.min(1, (finalScore + 1) / 2)), // 归一化到 [0, 1]
        similarity: finalScore,
        matchedModality,
        breakdown,
        rank: 0,
      });
    }

    // 排序并取 Top K
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);
    topResults.forEach((r, i) => (r.rank = i));
    return topResults;
  }

  // ============ 统计 API ============

  /**
   * 获取统计信息
   */
  getStats(): MultimodalIndexStats {
    const total = this.documents.size;
    let memBytes = 0;
    for (const doc of this.documents.values()) {
      memBytes += estimateDocMemory(doc);
    }
    return {
      totalDocuments: total,
      textDocuments: this.stats.textCount,
      imageDocuments: this.stats.imageCount,
      multimodalDocuments: this.stats.multimodalCount,
      dimension: this.dimension,
      indexType: this.indexType,
      totalSearches: this.stats.totalSearches,
      totalCacheHits: this.stats.totalCacheHits,
      avgSearchTimeMs: this.stats.totalSearches > 0
        ? this.stats.totalSearchTimeMs / this.stats.totalSearches
        : 0,
      memoryBytes: memBytes,
    };
  }

  /**
   * 订阅事件
   */
  subscribe(listener: IndexListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ 内部方法 ============

  private recordSearch(startTime: number, resultCount: number, modality: Modality): void {
    const durationMs = Date.now() - startTime;
    this.stats.totalSearches += 1;
    this.stats.totalSearchTimeMs += durationMs;
    this.emit({
      type: 'search-completed',
      queryModality: modality,
      resultCount,
      durationMs,
      at: Date.now(),
    });
  }

  private emit(event: IndexEvent): void {
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
 * 创建多模态向量索引
 */
export function createMultimodalIndex(config: {
  embedding?: MultimodalEmbedding;
  dimension?: number;
  indexType?: IndexType;
} = {}): MultimodalVectorIndex {
  return new MultimodalVectorIndex(config);
}
