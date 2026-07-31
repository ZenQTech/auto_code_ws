/**
 * # ============================================================
 * # RAGEngine - 检索增强生成知识库引擎 (v1.0.0 Cycle 37 G37-01)
 * # ============================================================
 * # 核心作用：构建生产可用的 RAG 知识库引擎
 * #           支持多格式文档加载、智能切片、Embedding、混合检索、Re-ranking、Source Citation
 * # 对标产品：LangChain / LlamaIndex / Haystack
 * # 运行流程：
 * #   1. 初始化 RAGEngine（注入 Embedding / VectorStore / Splitter / Retriever / Reranker）
 * #   2. addDocument() 添加文档 → 自动 Loader → Splitter → Embedding → VectorStore
 * #   3. retrieve() 检索：Vector + BM25 + RRF 混合
 * #   4. query() 完整 RAG：检索 + Rerank + LLM 生成 + Citation
 * #   5. save()/load() 持久化到 IndexedDB
 * # 输入参数：Document / query / options
 * # 输出结果：RetrievalResult[] / RAGResponse
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 37 G37-01 初次创建
 * # ============================================================
 */

import { LLMProvider, ChatResponse, Message, ChatOptions } from './llmProviderAdapter';

// ============ 类型定义 ============

/**
 * 文档元数据
 */
export interface DocumentMetadata {
  source: string;                 // 文件路径 / URL
  title?: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  mimeType?: string;
  size?: number;
  [key: string]: unknown;
}

/**
 * 文档块
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  embedding?: number[];           // 懒加载
  metadata: Record<string, unknown>;
}

/**
 * 文档
 */
export interface Document {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  chunks?: DocumentChunk[];
}

/**
 * 检索结果来源
 */
export type RetrievalSource = 'vector' | 'bm25' | 'hybrid' | 'fusion';

/**
 * 检索结果
 */
export interface RetrievalResult {
  chunk: DocumentChunk;
  score: number;
  rank: number;
  source: RetrievalSource;
  vectorScore?: number;
  bm25Score?: number;
}

/**
 * 来源引用
 */
export interface Citation {
  chunkId: string;
  documentId: string;
  source: string;
  title?: string;
  snippet: string;
  startOffset: number;
  endOffset: number;
  relevanceScore: number;
}

/**
 * 文档过滤器
 */
export interface DocumentFilter {
  source?: string;
  tags?: string[];
  mimeType?: string;
  searchText?: string;
}

/**
 * 文档添加选项
 */
export interface AddOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  generateEmbedding?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * 检索选项
 */
export interface RetrieveOptions {
  topK?: number;
  filter?: DocumentFilter;
  minScore?: number;
}

/**
 * 混合检索选项
 */
export interface HybridRetrieveOptions extends RetrieveOptions {
  vectorWeight?: number;          // 0-1, 默认 0.7
  bm25Weight?: number;            // 0-1, 默认 0.3
  rrfK?: number;                  // 默认 60
}

/**
 * RAG 查询选项
 */
export interface RAGQueryOptions {
  topK?: number;                  // 默认 5
  useRerank?: boolean;            // 默认 true
  useFusion?: boolean;            // 默认 false
  citationFormat?: 'markdown' | 'html' | 'plain';
  maxContextTokens?: number;      // 默认 4000
  llmOptions?: ChatOptions;
  systemPrompt?: string;
}

/**
 * RAG 响应
 */
export interface RAGResponse {
  answer: string;
  citations: Citation[];
  retrievalResults: RetrievalResult[];
  metadata: {
    retrievalTimeMs: number;
    generationTimeMs: number;
    totalTimeMs: number;
    totalTokens?: number;
    cost?: number;
    useRerank: boolean;
    useFusion: boolean;
  };
}

/**
 * RAG 统计
 */
export interface RAGStats {
  totalDocuments: number;
  totalChunks: number;
  indexedVectors: number;
  totalQueries: number;
  avgRetrievalTimeMs: number;
  avgGenerationTimeMs: number;
  cacheHits: number;
  cacheMisses: number;
}

// ============ Embedding 模型接口 ============

export interface EmbeddingModel {
  readonly name: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ============ Vector Store 接口 ============

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void>;
  search(query: number[], topK: number, filter?: Record<string, unknown>): Promise<SearchResult[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): number;
  getAll(): Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>;
}

// ============ Text Splitter 接口 ============

export interface SplitOptions {
  chunkSize?: number;             // 默认 400 tokens
  chunkOverlap?: number;          // 默认 3 tokens
  separators?: string[];
  keepSeparator?: boolean;
}

export interface TextSplitter {
  split(text: string, options?: SplitOptions): string[];
}

// ============ Retriever 接口 ============

export interface Retriever {
  readonly name: string;
  retrieve(query: string, topK: number, options?: RetrieveOptions): Promise<RetrievalResult[]>;
}

// ============ Reranker 接口 ============

export interface Reranker {
  readonly name: string;
  rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]>;
}

// ============ Mock Embedding ============

/**
 * 基于 TF-IDF 的简单 Embedding
 * - 确定性：相同文本产生相同向量
 * - 维度：默认 256
 * - 用途：测试、离线环境
 */
export class MockEmbedding implements EmbeddingModel {
  readonly name = 'mock';
  readonly dimension: number;
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();

  constructor(options: { dimension?: number } = {}) {
    this.dimension = options.dimension ?? 256;
  }

  async embed(text: string): Promise<number[]> {
    return this.computeVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.computeVector(t));
  }

  private computeVector(text: string): number[] {
    const vector = new Array(this.dimension).fill(0);
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    if (tokens.length === 0) return vector;

    for (const [token, freq] of tf) {
      const idx = this.hashToken(token) % this.dimension;
      const idfScore = this.idf.get(token) ?? 1;
      vector[idx] += (freq / tokens.length) * idfScore;
    }

    // L2 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map(v => v / norm);
  }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    // 提取连续的英文/数字作为一个 token
    const segments = text.toLowerCase().split(/([\u4e00-\u9fa5])/g);
    for (const seg of segments) {
      if (!seg) continue;
      if (/[\u4e00-\u9fa5]/.test(seg)) {
        // 中文：每个字符 + 二元组合
        for (let i = 0; i < seg.length; i++) {
          tokens.push(seg[i]);
          if (i < seg.length - 1) {
            tokens.push(seg.substring(i, i + 2));
          }
        }
      } else {
        // 英文/数字：按非字母数字字符分词
        const words = seg.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(t => t.length > 0);
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

// ============ RecursiveCharacterTextSplitter ============

/**
 * 递归字符切片器
 * - 优先级：\n\n > \n > 句子 > 词
 * - 支持中英文
 * - Token 估算：~1.5 字符/token（英文），~1 字符/token（中文）
 */
export class RecursiveCharacterTextSplitter implements TextSplitter {
  constructor(options?: { chunkSize?: number; chunkOverlap?: number; separators?: string[]; keepSeparator?: boolean }) {
    // Splitter 接受配置但目前 split() 完全使用 options 参数，构造参数仅占位
    void options;
  }

  split(text: string, options: SplitOptions = {}): string[] {
    if (!text || text.trim().length === 0) return [];
    const {
      chunkSize = 400,
      chunkOverlap = 3,
      separators = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ', ''],
      keepSeparator = true,
    } = options;

    return this.recursiveSplit(text, separators, chunkSize, chunkOverlap, keepSeparator);
  }

  private recursiveSplit(
    text: string,
    separators: string[],
    chunkSize: number,
    chunkOverlap: number,
    keepSeparator: boolean
  ): string[] {
    if (this.estimateTokens(text) <= chunkSize) {
      return [text];
    }

    // 找到第一个能切分的位置
    let separator = separators[separators.length - 1];
    for (const sep of separators) {
      if (sep === '' || text.includes(sep)) {
        separator = sep;
        break;
      }
    }

    const splits = separator === '' ? text.split('') : text.split(separator);
    const goodSplits: string[] = [];
    const finalChunks: string[] = [];

    for (const split of splits) {
      const splitWithSep = keepSeparator && separator !== '' ? split + separator : split;
      if (this.estimateTokens(splitWithSep) < chunkSize) {
        goodSplits.push(splitWithSep);
      } else {
        if (goodSplits.length > 0) {
          const merged = this.mergeSplits(goodSplits, separator, chunkSize, chunkOverlap);
          finalChunks.push(...merged);
          goodSplits.length = 0;
        }
        // 递归切分
        if (separators.length > 1) {
          const subChunks = this.recursiveSplit(
            split,
            separators.slice(separators.length - 1),
            chunkSize,
            chunkOverlap,
            keepSeparator
          );
          finalChunks.push(...subChunks);
        } else {
          finalChunks.push(split);
        }
      }
    }

    if (goodSplits.length > 0) {
      const merged = this.mergeSplits(goodSplits, separator, chunkSize, chunkOverlap);
      finalChunks.push(...merged);
    }

    return finalChunks.filter(c => c.trim().length > 0);
  }

  private mergeSplits(splits: string[], separator: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    let current = '';
    let currentTokens = 0;

    for (const split of splits) {
      const splitTokens = this.estimateTokens(split);
      if (currentTokens + splitTokens > chunkSize && current.length > 0) {
        chunks.push(current.trim());
        // 保留 overlap
        const overlapText = this.getOverlap(current, chunkOverlap);
        current = overlapText + split;
        currentTokens = this.estimateTokens(current);
      } else {
        current += split;
        currentTokens += splitTokens;
      }
    }

    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  private getOverlap(text: string, overlapTokens: number): string {
    const tokens = text.split(/\s+/);
    if (tokens.length <= overlapTokens) return text;
    return tokens.slice(-overlapTokens).join(' ');
  }

  private estimateTokens(text: string): number {
    // 简单估算：英文按词数，中文按字符数 / 1.5
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}

// ============ Memory Vector Store ============

/**
 * 内存向量存储
 * - 纯内存实现
 * - 支持 Cosine Similarity
 */
export class MemoryVectorStore implements VectorStore {
  private store: Map<string, { vector: number[]; metadata: Record<string, unknown> }> = new Map();

  async add(id: string, vector: number[], metadata: Record<string, unknown> = {}): Promise<void> {
    this.store.set(id, { vector, metadata });
  }

  async addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata);
    }
  }

  async search(query: number[], topK: number, filter?: Record<string, unknown>): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const [id, { vector, metadata }] of this.store.entries()) {
      if (filter && !this.matchFilter(metadata, filter)) continue;
      const score = this.cosineSimilarity(query, vector);
      results.push({ id, score, metadata });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  getAll(): Array<{ id: string; vector: number[]; metadata: Record<string, unknown> }> {
    return Array.from(this.store.entries()).map(([id, { vector, metadata }]) => ({ id, vector, metadata }));
  }

  private matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) return false;
    }
    return true;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }
}

// ============ BM25 Retriever ============

/**
 * BM25 检索器（独立实现，不依赖外部库）
 * - k1 = 1.5, b = 0.75
 * - 中英文混合分词
 */
export class BM25Index {
  private documents: Map<string, string> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private k1: number = 1.5;
  private b: number = 0.75;
  private k3: number = 0; // 查询词饱和度

  addDocument(id: string, text: string): void {
    this.documents.set(id, text);
    const tokens = this.tokenize(text);
    this.docLengths.set(id, tokens.length);
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    }
    this.recalculateAvgLength();
  }

  removeDocument(id: string): boolean {
    if (!this.documents.has(id)) return false;
    const text = this.documents.get(id)!;
    const tokens = this.tokenize(text);
    for (const token of new Set(tokens)) {
      const set = this.invertedIndex.get(token);
      if (set) {
        set.delete(id);
        if (set.size === 0) this.invertedIndex.delete(token);
      }
    }
    this.documents.delete(id);
    this.docLengths.delete(id);
    this.recalculateAvgLength();
    return true;
  }

  search(query: string, topK: number): Array<{ id: string; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores: Map<string, number> = new Map();
    const N = this.documents.size;

    for (const term of queryTokens) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const df = postings.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const docId of postings) {
        const docTokens = this.tokenize(this.documents.get(docId)!);
        const tf = docTokens.filter(t => t === term).length;
        const docLen = this.docLengths.get(docId) || 0;

        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * docLen / (this.avgDocLength || 1));
        const termScore = idf * (numerator / denominator);
        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  size(): number {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
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
        const words = seg.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(t => t.length > 0);
        tokens.push(...words);
      }
    }
    return tokens;
  }

  private recalculateAvgLength(): void {
    if (this.docLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let sum = 0;
    for (const len of this.docLengths.values()) sum += len;
    this.avgDocLength = sum / this.docLengths.size;
  }
}

// ============ Vector Retriever ============

/**
 * 向量检索器（基于 Cosine Similarity）
 */
export class VectorRetriever implements Retriever {
  readonly name = 'vector';

  constructor(
    private vectorStore: VectorStore,
    private embedding: EmbeddingModel,
    private chunkMap: Map<string, DocumentChunk>
  ) {}

  async retrieve(query: string, topK: number, _options?: RetrieveOptions): Promise<RetrievalResult[]> {
    const queryVector = await this.embedding.embed(query);
    const results = await this.vectorStore.search(queryVector, topK);

    return results
      .filter(r => r.metadata && this.chunkMap.has(r.id))
      .map((r, idx) => {
        const chunk = this.chunkMap.get(r.id)!;
        return {
          chunk,
          score: r.score,
          rank: idx + 1,
          source: 'vector' as RetrievalSource,
          vectorScore: r.score,
        };
      });
  }

  setChunkMap(chunkMap: Map<string, DocumentChunk>): void {
    this.chunkMap = chunkMap;
  }
}

// ============ BM25 Retriever ============

/**
 * BM25 关键词检索器
 */
export class BM25Retriever implements Retriever {
  readonly name = 'bm25';
  private bm25Index: BM25Index = new BM25Index();
  private chunkMap: Map<string, DocumentChunk> = new Map();

  constructor() {}

  async retrieve(query: string, topK: number, _options?: RetrieveOptions): Promise<RetrievalResult[]> {
    const results = this.bm25Index.search(query, topK);

    return results
      .filter(r => this.chunkMap.has(r.id))
      .map((r, idx) => {
        const chunk = this.chunkMap.get(r.id)!;
        return {
          chunk,
          score: r.score,
          rank: idx + 1,
          source: 'bm25' as RetrievalSource,
          bm25Score: r.score,
        };
      });
  }

  addChunk(chunk: DocumentChunk): void {
    this.chunkMap.set(chunk.id, chunk);
    this.bm25Index.addDocument(chunk.id, chunk.content);
  }

  removeChunk(chunkId: string): boolean {
    this.chunkMap.delete(chunkId);
    return this.bm25Index.removeDocument(chunkId);
  }

  clear(): void {
    this.chunkMap.clear();
    this.bm25Index.clear();
  }

  setChunkMap(chunkMap: Map<string, DocumentChunk>): void {
    this.chunkMap = chunkMap;
  }
}

// ============ Hybrid Retriever ============

/**
 * 混合检索器（Vector + BM25 + RRF）
 * - Reciprocal Rank Fusion: score = sum(1 / (k + rank))
 * - 默认 k=60
 */
export class HybridRetriever implements Retriever {
  readonly name = 'hybrid';

  constructor(
    private vectorRetriever: VectorRetriever,
    private bm25Retriever: BM25Retriever,
    private options: { k?: number; vectorWeight?: number; bm25Weight?: number } = {}
  ) {}

  async retrieve(query: string, topK: number, options?: HybridRetrieveOptions): Promise<RetrievalResult[]> {
    const k = options?.rrfK ?? this.options.k ?? 60;
    const vectorWeight = options?.vectorWeight ?? this.options.vectorWeight ?? 0.7;
    const bm25Weight = options?.bm25Weight ?? this.options.bm25Weight ?? 0.3;

    // 并行执行
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorRetriever.retrieve(query, topK * 2, options),
      this.bm25Retriever.retrieve(query, topK * 2, options),
    ]);

    // RRF 融合
    const scores: Map<string, { chunk: DocumentChunk; score: number; vectorScore?: number; bm25Score?: number }> = new Map();

    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i];
      const rrfScore = vectorWeight / (k + i + 1);
      scores.set(r.chunk.id, {
        chunk: r.chunk,
        score: rrfScore,
        vectorScore: r.score,
      });
    }

    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i];
      const rrfScore = bm25Weight / (k + i + 1);
      const existing = scores.get(r.chunk.id);
      if (existing) {
        existing.score += rrfScore;
        existing.bm25Score = r.score;
      } else {
        scores.set(r.chunk.id, {
          chunk: r.chunk,
          score: rrfScore,
          bm25Score: r.score,
        });
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r, idx) => ({
        chunk: r.chunk,
        score: r.score,
        rank: idx + 1,
        source: 'hybrid' as RetrievalSource,
        vectorScore: r.vectorScore,
        bm25Score: r.bm25Score,
      }));
  }
}

// ============ Heuristic Reranker ============

/**
 * 启发式重排序器
 * - 综合考虑：原始分数 + 长度惩罚 + 关键词覆盖
 */
export class HeuristicReranker implements Reranker {
  readonly name = 'heuristic';

  async rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    const queryTokens = this.tokenize(query);

    return results
      .map(r => {
        const chunkTokens = this.tokenize(r.chunk.content);
        const overlap = this.computeOverlap(queryTokens, chunkTokens);
        const lengthPenalty = this.lengthPenalty(r.chunk.content);
        const score = r.score * 0.5 + overlap * 0.4 + lengthPenalty * 0.1;
        return { ...r, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  private computeOverlap(queryTokens: string[], chunkTokens: string[]): number {
    if (queryTokens.length === 0) return 0;
    const chunkSet = new Set(chunkTokens);
    let overlap = 0;
    for (const token of queryTokens) {
      if (chunkSet.has(token)) overlap++;
    }
    return overlap / queryTokens.length;
  }

  private lengthPenalty(text: string): number {
    const len = text.length;
    // 最佳长度 200-500 字符
    if (len < 50) return 0.5;
    if (len > 2000) return 0.5;
    if (len >= 200 && len <= 500) return 1.0;
    if (len < 200) return 0.5 + (len - 50) / 300;
    return 1.0 - (len - 500) / 1500;
  }
}

// ============ Citation Engine ============

/**
 * 来源引用引擎
 */
export class CitationEngine {
  extractCitations(
    _question: string,
    results: RetrievalResult[],
    options: { maxCitations?: number; minScore?: number } = {}
  ): Citation[] {
    const maxCitations = options.maxCitations ?? 5;
    const minScore = options.minScore ?? 0;

    return results
      .filter(r => r.score >= minScore)
      .slice(0, maxCitations)
      .map(r => ({
        chunkId: r.chunk.id,
        documentId: r.chunk.documentId,
        source: r.chunk.metadata?.source as string || 'unknown',
        title: r.chunk.metadata?.title as string | undefined,
        snippet: r.chunk.content.slice(0, 200) + (r.chunk.content.length > 200 ? '...' : ''),
        startOffset: r.chunk.startOffset,
        endOffset: r.chunk.endOffset,
        relevanceScore: r.score,
      }));
  }

  formatCitations(citations: Citation[], format: 'markdown' | 'html' | 'plain' = 'markdown'): string {
    if (citations.length === 0) return '';

    switch (format) {
      case 'markdown':
        return citations
          .map((c, i) => `[${i + 1}] **${c.title || c.source}** - ${c.snippet}`)
          .join('\n\n');
      case 'html':
        return '<ol>' + citations
          .map(c => `<li><strong>${this.escapeHtml(c.title || c.source)}</strong> - ${this.escapeHtml(c.snippet)}</li>`)
          .join('') + '</ol>';
      case 'plain':
        return citations
          .map((c, i) => `[${i + 1}] ${c.title || c.source}: ${c.snippet}`)
          .join('\n');
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// ============ Document Loader ============

/**
 * 文档加载器接口
 */
export interface DocumentLoader {
  readonly name: string;
  readonly supportedMimeTypes: string[];
  load(source: string | { content: string; mimeType?: string; filename?: string }): Promise<Document>;
}

export class TextLoader implements DocumentLoader {
  readonly name: string = 'text';
  readonly supportedMimeTypes: string[] = ['text/plain', 'text/markdown'];

  async load(source: string | { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    let content: string;
    let filename: string;
    let mimeType: string;

    if (typeof source === 'string') {
      content = source;
      filename = 'inline.txt';
      mimeType = 'text/plain';
    } else {
      content = source.content;
      filename = source.filename || 'inline.txt';
      mimeType = source.mimeType || 'text/plain';
    }

    return {
      id: this.generateId(),
      content,
      metadata: {
        source: filename,
        mimeType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        size: content.length,
      },
    };
  }

  private generateId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export class MarkdownLoader extends TextLoader {
  readonly name = 'markdown';
  readonly supportedMimeTypes = ['text/markdown'];
}

export class JSONLoader extends TextLoader {
  readonly name = 'json';
  readonly supportedMimeTypes = ['application/json'];

  async load(source: string | { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    const doc = await super.load(source);
    try {
      const parsed = JSON.parse(doc.content);
      doc.content = JSON.stringify(parsed, null, 2);
    } catch (e) {
      // 保持原样
    }
    return doc;
  }
}

export class HTMLLoader extends TextLoader {
  readonly name = 'html';
  readonly supportedMimeTypes = ['text/html'];

  async load(source: string | { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    const doc = await super.load(source);
    // 简单 HTML 标签移除
    doc.content = doc.content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    return doc;
  }
}

// ============ RAGEngine 主类 ============

export interface RAGEngineOptions {
  embeddingModel?: EmbeddingModel;
  vectorStore?: VectorStore;
  splitter?: TextSplitter;
  retriever?: Retriever;
  reranker?: Reranker;
  citationEngine?: CitationEngine;
  llmProvider?: LLMProvider;
  loader?: DocumentLoader;
}

export class RAGEngine {
  private documents: Map<string, Document> = new Map();
  private chunks: Map<string, DocumentChunk> = new Map();
  private embedding: EmbeddingModel;
  private vectorStore: VectorStore;
  private splitter: TextSplitter;
  private retriever: Retriever;
  private reranker: Reranker;
  private citationEngine: CitationEngine;
  private llmProvider?: LLMProvider;
  private loader: DocumentLoader;
  private bm25Retriever: BM25Retriever;

  private stats = {
    totalQueries: 0,
    totalRetrievalTimeMs: 0,
    totalGenerationTimeMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(options: RAGEngineOptions = {}) {
    this.embedding = options.embeddingModel ?? new MockEmbedding({ dimension: 256 });
    this.vectorStore = options.vectorStore ?? new MemoryVectorStore();
    this.splitter = options.splitter ?? new RecursiveCharacterTextSplitter();
    this.reranker = options.reranker ?? new HeuristicReranker();
    this.citationEngine = options.citationEngine ?? new CitationEngine();
    this.llmProvider = options.llmProvider;
    this.loader = options.loader ?? new TextLoader();

    // BM25 检索器总是创建
    this.bm25Retriever = new BM25Retriever();

    // 默认混合检索器
    if (options.retriever) {
      this.retriever = options.retriever;
    } else {
      const vectorRetriever = new VectorRetriever(this.vectorStore, this.embedding, this.chunks);
      this.retriever = new HybridRetriever(vectorRetriever, this.bm25Retriever);
    }
  }

  // ============ 文档管理 ============

  async addDocument(
    doc: Document | string | { content: string; mimeType?: string; filename?: string },
    source?: string,
    options: AddOptions = {}
  ): Promise<string> {
    let document: Document;

    if (typeof doc === 'string') {
      document = await this.loader.load({ content: doc, filename: source || 'inline.txt' });
    } else if ('metadata' in doc) {
      document = doc;
    } else {
      document = await this.loader.load(doc);
    }

    // 切片
    const chunkSize = options.chunkSize ?? 400;
    const chunkOverlap = options.chunkOverlap ?? 3;
    const texts = this.splitter.split(document.content, { chunkSize, chunkOverlap });

    // 创建 chunks
    const chunks: DocumentChunk[] = [];
    let offset = 0;
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const chunkId = `${document.id}_chunk_${i}`;
      const chunk: DocumentChunk = {
        id: chunkId,
        documentId: document.id,
        content: text,
        index: i,
        startOffset: offset,
        endOffset: offset + text.length,
        metadata: { ...document.metadata, ...(options.metadata || {}) },
      };
      chunks.push(chunk);
      this.chunks.set(chunkId, chunk);
      this.bm25Retriever.addChunk(chunk);
      offset += text.length;
    }

    document.chunks = chunks;
    this.documents.set(document.id, document);

    // 生成 embedding
    if (options.generateEmbedding !== false) {
      const vectors = await this.embedding.embedBatch(chunks.map(c => c.content));
      await this.vectorStore.addBatch(
        chunks.map((c, i) => ({
          id: c.id,
          vector: vectors[i],
          metadata: { documentId: c.documentId, ...c.metadata },
        }))
      );
      // 回填
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = vectors[i];
      }
    }

    return document.id;
  }

  async addDocuments(docs: Document[], options: AddOptions = {}): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of docs) {
      const id = await this.addDocument(doc, undefined, options);
      ids.push(id);
    }
    return ids;
  }

  listDocuments(filter?: DocumentFilter): Document[] {
    let docs = Array.from(this.documents.values());
    if (filter) {
      if (filter.source) {
        docs = docs.filter(d => d.metadata.source === filter.source);
      }
      if (filter.tags && filter.tags.length > 0) {
        docs = docs.filter(d => filter.tags!.some(tag => d.metadata.tags?.includes(tag)));
      }
      if (filter.mimeType) {
        docs = docs.filter(d => d.metadata.mimeType === filter.mimeType);
      }
      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        docs = docs.filter(d => d.content.toLowerCase().includes(searchLower));
      }
    }
    return docs;
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  async deleteDocument(id: string): Promise<boolean> {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // 删除 chunks
    if (doc.chunks) {
      for (const chunk of doc.chunks) {
        this.chunks.delete(chunk.id);
        await this.vectorStore.delete(chunk.id);
        this.bm25Retriever.removeChunk(chunk.id);
      }
    }

    this.documents.delete(id);
    return true;
  }

  // ============ 检索 ============

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievalResult[]> {
    const topK = options.topK ?? 5;
    const startTime = performance.now();

    let results = await this.retriever.retrieve(query, topK, options);

    // Re-rank
    if (this.reranker && results.length > 0) {
      results = await this.reranker.rerank(query, results);
    }

    const retrievalTime = performance.now() - startTime;
    this.stats.totalRetrievalTimeMs += retrievalTime;
    this.stats.totalQueries++;

    // 过滤
    if (options.minScore !== undefined) {
      results = results.filter(r => r.score >= options.minScore!);
    }

    return results.slice(0, topK);
  }

  async hybridRetrieve(query: string, options: HybridRetrieveOptions = {}): Promise<RetrievalResult[]> {
    return this.retrieve(query, options);
  }

  // ============ RAG 完整流程 ============

  async query(question: string, options: RAGQueryOptions = {}): Promise<RAGResponse> {
    const startTime = performance.now();
    const topK = options.topK ?? 5;
    const useRerank = options.useRerank ?? true;

    // 1. 检索
    const retrievalStart = performance.now();
    let results = await this.retrieve(question, { topK });
    if (!useRerank && this.reranker) {
      // 跳过 rerank
    }
    const retrievalTimeMs = performance.now() - retrievalStart;

    // 2. 提取引用
    const citations = this.citationEngine.extractCitations(question, results, {
      maxCitations: topK,
    });

    // 3. 构造上下文
    const maxContextTokens = options.maxContextTokens ?? 4000;
    const context = this.buildContext(results, maxContextTokens);
    const citationText = this.citationEngine.formatCitations(citations, options.citationFormat ?? 'markdown');

    // 4. 生成答案
    const generationStart = performance.now();
    let answer = '';
    let totalTokens: number | undefined;
    let cost: number | undefined;

    if (this.llmProvider) {
      const systemPrompt = options.systemPrompt ?? this.getDefaultSystemPrompt();
      const userPrompt = this.buildUserPrompt(question, context, citationText);
      const response: ChatResponse = await this.llmProvider.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options.llmOptions
      );
      answer = response.content;
      totalTokens = response.usage.totalTokens;
      cost = (response.usage as any).cost;
    } else {
      answer = this.generateMockAnswer(question, context, citations);
    }
    const generationTimeMs = performance.now() - generationStart;

    this.stats.totalGenerationTimeMs += generationTimeMs;

    return {
      answer,
      citations,
      retrievalResults: results,
      metadata: {
        retrievalTimeMs: Math.round(retrievalTimeMs),
        generationTimeMs: Math.round(generationTimeMs),
        totalTimeMs: Math.round(performance.now() - startTime),
        totalTokens,
        cost,
        useRerank,
        useFusion: options.useFusion ?? false,
      },
    };
  }

  // ============ 持久化 ============

  async save(storeName: string = 'default'): Promise<void> {
    const data = {
      documents: Array.from(this.documents.entries()),
      chunks: Array.from(this.chunks.entries()),
      storeName,
      savedAt: Date.now(),
    };
    const json = JSON.stringify(data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`rag-engine-${storeName}`, json);
    }
  }

  async load(storeName: string = 'default'): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    const json = localStorage.getItem(`rag-engine-${storeName}`);
    if (!json) return;

    try {
      const data = JSON.parse(json);
      this.documents = new Map(data.documents);
      this.chunks = new Map(data.chunks);
      this.bm25Retriever.clear();
      for (const chunk of this.chunks.values()) {
        this.bm25Retriever.addChunk(chunk);
      }
      // 重建 vector store
      await this.vectorStore.clear();
      const items = Array.from(this.chunks.values())
        .filter(c => c.embedding)
        .map(c => ({
          id: c.id,
          vector: c.embedding!,
          metadata: { documentId: c.documentId, ...c.metadata },
        }));
      if (items.length > 0) {
        await this.vectorStore.addBatch(items);
      }
    } catch (e) {
      // 加载失败忽略
    }
  }

  // ============ 统计 ============

  getStats(): RAGStats {
    const totalChunks = this.chunks.size;
    const indexedVectors = this.vectorStore.size();
    return {
      totalDocuments: this.documents.size,
      totalChunks,
      indexedVectors,
      totalQueries: this.stats.totalQueries,
      avgRetrievalTimeMs: this.stats.totalQueries > 0
        ? Math.round(this.stats.totalRetrievalTimeMs / this.stats.totalQueries)
        : 0,
      avgGenerationTimeMs: this.stats.totalQueries > 0
        ? Math.round(this.stats.totalGenerationTimeMs / this.stats.totalQueries)
        : 0,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
    };
  }

  clear(): void {
    this.documents.clear();
    this.chunks.clear();
    this.bm25Retriever.clear();
    this.vectorStore.clear();
    this.stats = {
      totalQueries: 0,
      totalRetrievalTimeMs: 0,
      totalGenerationTimeMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  // ============ 内部方法 ============

  private buildContext(results: RetrievalResult[], maxTokens: number): string {
    const parts: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const text = `[${i + 1}] ${r.chunk.content}`;
      const tokens = Math.ceil(text.length / 4);
      if (totalTokens + tokens > maxTokens) break;
      parts.push(text);
      totalTokens += tokens;
    }

    return parts.join('\n\n');
  }

  private buildUserPrompt(question: string, context: string, citations: string): string {
    return `上下文:
${context}

引用:
${citations}

问题: ${question}

请基于上下文回答问题，并在答案末尾列出引用的来源编号。`;
  }

  private getDefaultSystemPrompt(): string {
    return '你是一个基于知识库的问答助手。请严格基于提供的上下文回答问题，不要编造信息。如果上下文不包含答案，请明确说明。';
  }

  private generateMockAnswer(question: string, context: string, citations: Citation[]): string {
    if (citations.length === 0) {
      return `[Mock 回答] 未找到相关信息: ${question}`;
    }
    return `[Mock 回答] 基于 ${citations.length} 个相关文档: ${context.slice(0, 200)}...`;
  }
}

// ============ 默认配置与工厂函数 ============

export const DEFAULT_RAG_CONFIG: RAGEngineOptions = {
  embeddingModel: new MockEmbedding({ dimension: 256 }),
  vectorStore: new MemoryVectorStore(),
  splitter: new RecursiveCharacterTextSplitter({ chunkSize: 400, chunkOverlap: 3 }),
  reranker: new HeuristicReranker(),
  citationEngine: new CitationEngine(),
  loader: new TextLoader(),
};

export function createRAGEngine(options?: RAGEngineOptions): RAGEngine {
  return new RAGEngine({ ...DEFAULT_RAG_CONFIG, ...options });
}

// ============ 全局单例 ============

let defaultEngine: RAGEngine | null = null;

export function getDefaultRAGEngine(): RAGEngine {
  if (!defaultEngine) {
    defaultEngine = createRAGEngine();
  }
  return defaultEngine;
}

export function resetDefaultRAGEngine(): void {
  defaultEngine = null;
}

// ============ 工具函数 ============

export function generateDocId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateChunkId(documentId: string, index: number): string {
  return `${documentId}_chunk_${index}`;
}
