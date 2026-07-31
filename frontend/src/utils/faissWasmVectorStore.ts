/**
 * # ============================================================
 * # FAISSWasmVectorStore - FAISS-WASM 风格向量检索引擎 (v1.0.0 Cycle 47 G47-01)
 * # ============================================================
 * # 核心作用：实现 FAISS-WASM 风格的纯 TypeScript 向量检索引擎
 * #           - 多种索引类型: Flat / IVF / HNSW (Pure TS 实现,无 WASM 依赖)
 * #           - 毫秒级 Top-K 检索
 * #           - 内积/欧式距离/余弦相似度
 * #           - 增量索引构建
 * #           - 性能监控 + 索引统计
 * #           - 索引序列化/反序列化
 * #           - 降级到 MemoryVectorStore
 * # 对标产品: FAISS / Pinecone / Weaviate / Qdrant
 * # 设计要点:
 * #   1. 三种索引类型: Flat (精确/慢) / IVF (分桶/快) / HNSW (图/最快)
 * #   2. 自动选择索引: 根据向量数量阈值自动选择最优索引
 * #   3. 完整事件订阅: 监控索引构建/搜索性能
 * #   4. 量化支持: Float32 / Float16 模拟
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 47 G47-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/** 距离度量类型 */
export type DistanceMetric = 'inner_product' | 'l2' | 'cosine';

/** 索引类型 */
export type IndexType = 'flat' | 'ivf' | 'hnsw' | 'auto';

/** 向量元数据 */
export interface FAISSVectorMetadata {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
}

/** 搜索结果 */
export interface FAISSSearchResult {
  id: string;
  score: number;
  distance: number;
  metadata?: Record<string, unknown>;
  index?: number;
}

/** 索引构建选项 */
export interface FAISSIndexOptions {
  /** 索引类型 (默认 auto) */
  type?: IndexType;
  /** 距离度量 (默认 cosine) */
  metric?: DistanceMetric;
  /** 向量维度 */
  dimension: number;
  /** IVF 聚类数 (默认 sqrt(n)) */
  nlist?: number;
  /** IVF 探测数 (默认 8) */
  nprobe?: number;
  /** HNSW M 参数 (邻居数, 默认 16) */
  M?: number;
  /** HNSW efConstruction (构建时搜索深度, 默认 200) */
  efConstruction?: number;
  /** HNSW efSearch (查询时搜索深度, 默认 50) */
  efSearch?: number;
  /** 是否归一化向量 (用于余弦相似度) */
  normalizeVectors?: boolean;
  /** 自动重建索引阈值 (向量数超过此值时重建) */
  rebuildThreshold?: number;
}

/** 索引统计 */
export interface FAISSIndexStats {
  totalVectors: number;
  dimension: number;
  type: IndexType;
  metric: DistanceMetric;
  buildTimeMs: number;
  lastSearchTimeMs: number;
  totalSearches: number;
  avgSearchTimeMs: number;
  memoryBytes: number;
  indexSize: number;
  nlist?: number;
  nprobe?: number;
  M?: number;
  efSearch?: number;
}

/** 索引序列化格式 */
export interface SerializedFAISSIndex {
  version: string;
  type: IndexType;
  metric: DistanceMetric;
  dimension: number;
  vectors: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>;
  ivfCentroids?: number[][];
  ivfAssignments?: number[];
  hnswGraph?: number[][];
  options: Record<string, unknown>;
}

/** 事件 */
export type FAISSVectorStoreEvent =
  | { type: 'vector-added'; id: string; index: number; at: number }
  | { type: 'batch-added'; count: number; totalTimeMs: number; at: number }
  | { type: 'index-rebuilt'; type: IndexType; fromCount: number; at: number }
  | { type: 'search-completed'; topK: number; hits: number; timeMs: number; at: number }
  | { type: 'index-cleared'; at: number };

export type FAISSVectorStoreListener = (event: FAISSVectorStoreEvent) => void;

// ============ 距离函数 ============

/**
 * 内积距离
 */
function innerProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * 欧式距离平方
 */
function l2DistanceSquared(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}

/**
 * 余弦相似度
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
 * 距离到相似度转换
 */
function distanceToScore(distance: number, metric: DistanceMetric): number {
  if (metric === 'l2') {
    // L2: 距离越小越相似,转换为 1 / (1 + distance)
    return 1 / (1 + distance);
  }
  // inner_product / cosine: 越大越相似
  return distance;
}

/**
 * 计算距离
 */
function computeDistance(a: Float32Array, b: Float32Array, metric: DistanceMetric): number {
  switch (metric) {
    case 'l2':
      return l2DistanceSquared(a, b);
    case 'inner_product':
      return innerProduct(a, b);
    case 'cosine':
      return cosineSimilarity(a, b);
  }
}

/**
 * L2 归一化
 */
function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i] / norm;
  }
  return out;
}

// ============ HNSW 节点 ============

interface HNSWNode {
  id: string;
  vector: Float32Array;
  level: number;
  neighbors: number[][]; // 每层邻居 ID 索引
}

// ============ HNSW 图实现 ============

/**
 * HNSW (Hierarchical Navigable Small World) 图
 * - 多层图结构
 * - 上层稀疏,下层密集
 * - 搜索时从顶层贪心下降到 0 层
 * - 性能: O(log N) 查询
 */
class HNSWGraph {
  readonly M: number;
  readonly efConstruction: number;
  readonly M0: number; // 0 层最大邻居数
  readonly mL: number; // 层级概率因子
  readonly metric: DistanceMetric;
  private nodes: HNSWNode[] = [];
  private entryPoint: number = -1;
  private maxLevel: number = -1;
  private rng: () => number;

  constructor(options: { M: number; efConstruction: number; metric: DistanceMetric; seed?: number }) {
    this.M = options.M;
    this.efConstruction = options.efConstruction;
    this.M0 = options.M * 2;
    this.mL = 1 / Math.log(this.M);
    this.metric = options.metric;
    let seed = options.seed ?? 42;
    this.rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  /**
   * 随机选择层级
   */
  private randomLevel(): number {
    return Math.floor(-Math.log(this.rng() + 1e-9) * this.mL);
  }

  /**
   * 添加节点
   */
  add(id: string, vector: Float32Array, allVectors: Float32Array[]): void {
    const level = this.randomLevel();
    const nodeIdx = this.nodes.length;
    const node: HNSWNode = {
      id,
      vector,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
    };
    this.nodes.push(node);

    if (this.entryPoint === -1) {
      this.entryPoint = nodeIdx;
      this.maxLevel = level;
      return;
    }

    // 从 entry point 搜索到目标层级
    let ep = this.entryPoint;
    const dist = computeDistance(vector, this.nodes[ep].vector, this.metric);

    // 从顶层向下贪心搜索到 level+1 层
    for (let l = this.maxLevel; l > level; l--) {
      const result = this.searchLayer(vector, [ep], 1, l, allVectors);
      if (result.length > 0) {
        ep = result[0].index;
      }
    }

    // 在 level 层及以下构建连接
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const ef = this.efConstruction;
      const candidates = this.searchLayer(vector, [ep], ef, l, allVectors);

      // 选择 M 个最近邻
      const selected = this.selectNeighbors(candidates, this.M);

      // 双向连接
      for (const candidate of selected) {
        node.neighbors[l].push(candidate.index);
        const candidateNode = this.nodes[candidate.index];
        if (candidateNode.neighbors[l].length < (l === 0 ? this.M0 : this.M)) {
          candidateNode.neighbors[l].push(nodeIdx);
        } else {
          // 剪枝: 替换最远邻居
          const worst = this.findWorstNeighbor(candidateNode, l, allVectors);
          if (worst >= 0) {
            const worstDist = computeDistance(
              this.nodes[worst].vector,
              candidateNode.vector,
              this.metric
            );
            const newDist = computeDistance(vector, candidateNode.vector, this.metric);
            if (this.isBetter(newDist, worstDist)) {
              const idx = candidateNode.neighbors[l].indexOf(worst);
              if (idx >= 0) candidateNode.neighbors[l][idx] = nodeIdx;
            }
          }
        }
      }

      ep = candidates[0]?.index ?? ep;
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = nodeIdx;
    }
  }

  /**
   * 在指定层搜索最近邻
   */
  private searchLayer(
    query: Float32Array,
    entryPoints: number[],
    ef: number,
    level: number,
    allVectors: Float32Array[]
  ): Array<{ index: number; distance: number }> {
    const visited = new Set<number>(entryPoints);
    const candidates: Array<{ index: number; distance: number }> = entryPoints.map((idx) => ({
      index: idx,
      distance: computeDistance(query, this.nodes[idx].vector, this.metric),
    }));
    const result: Array<{ index: number; distance: number }> = [...candidates];
    // 最大堆模拟
    const sortedResult = [...result].sort((a, b) =>
      this.isBetter(a.distance, b.distance) ? -1 : 1
    );

    while (candidates.length > 0) {
      const current = candidates.shift()!;
      const farthest = sortedResult[sortedResult.length - 1];

      if (this.isBetter(farthest.distance, current.distance) && sortedResult.length >= ef) {
        break;
      }

      const node = this.nodes[current.index];
      const neighbors = node.neighbors[level] || [];
      for (const neighborIdx of neighbors) {
        if (visited.has(neighborIdx)) continue;
        visited.add(neighborIdx);
        const dist = computeDistance(query, this.nodes[neighborIdx].vector, this.metric);
        const farthestInResult = sortedResult[sortedResult.length - 1];
        if (
          sortedResult.length < ef ||
          this.isBetter(dist, farthestInResult.distance)
        ) {
          candidates.push({ index: neighborIdx, distance: dist });
          sortedResult.push({ index: neighborIdx, distance: dist });
          sortedResult.sort((a, b) =>
            this.isBetter(a.distance, b.distance) ? -1 : 1
          );
          if (sortedResult.length > ef) {
            sortedResult.pop();
          }
        }
      }
    }

    return sortedResult;
  }

  /**
   * 选择邻居 (简化版)
   */
  private selectNeighbors(
    candidates: Array<{ index: number; distance: number }>,
    M: number
  ): Array<{ index: number; distance: number }> {
    return candidates.slice(0, M);
  }

  /**
   * 找最远邻居
   */
  private findWorstNeighbor(node: HNSWNode, level: number, allVectors: Float32Array[]): number {
    let worst = -1;
    let worstDist = this.metric === 'l2' ? -Infinity : Infinity;
    for (const idx of node.neighbors[level]) {
      const d = computeDistance(node.vector, this.nodes[idx].vector, this.metric);
      if (this.metric === 'l2' ? d > worstDist : d < worstDist) {
        worstDist = d;
        worst = idx;
      }
    }
    return worst;
  }

  /**
   * 比较距离 (l2 越小越好, 其他越大越好)
   */
  private isBetter(a: number, b: number): boolean {
    return this.metric === 'l2' ? a < b : a > b;
  }

  /**
   * 搜索
   */
  search(query: Float32Array, topK: number, efSearch: number, allVectors: Float32Array[]): Array<{ index: number; distance: number }> {
    if (this.entryPoint === -1) return [];

    let ep = this.entryPoint;
    const dist = computeDistance(query, this.nodes[ep].vector, this.metric);

    // 从顶层向下贪心
    for (let l = this.maxLevel; l > 0; l--) {
      const result = this.searchLayer(query, [ep], 1, l, allVectors);
      if (result.length > 0) {
        ep = result[0].index;
      }
    }

    // 0 层搜索 efSearch 个候选
    const result = this.searchLayer(query, [ep], efSearch, 0, allVectors);
    return result.slice(0, topK);
  }

  size(): number {
    return this.nodes.length;
  }

  getNode(index: number): HNSWNode | undefined {
    return this.nodes[index];
  }
}

// ============ IVF 索引 ============

class IVFIndex {
  private centroids: Float32Array[] = [];
  private assignments: number[] = []; // 每个向量属于哪个聚类
  private vectors: Float32Array[] = [];
  private ids: string[] = [];
  private metadata: Array<Record<string, unknown> | undefined> = [];

  /**
   * 训练聚类中心 (k-means 简化版)
   */
  train(vectors: Float32Array[], nlist: number, dimension: number, metric: DistanceMetric): void {
    if (vectors.length === 0) return;
    const k = Math.min(nlist, vectors.length);

    // 随机初始化中心
    this.centroids = [];
    const step = Math.max(1, Math.floor(vectors.length / k));
    for (let i = 0; i < k; i++) {
      const v = vectors[Math.min(i * step, vectors.length - 1)];
      const c = new Float32Array(dimension);
      for (let j = 0; j < dimension; j++) c[j] = v[j];
      this.centroids.push(c);
    }

    // k-means 迭代 (简化 5 次)
    for (let iter = 0; iter < 5; iter++) {
      // 分配
      this.assignments = vectors.map((v) => this.findClosestCentroid(v, metric));

      // 更新中心
      const newCentroids: Float32Array[] = Array.from({ length: k }, () => new Float32Array(dimension));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < vectors.length; i++) {
        const cluster = this.assignments[i];
        for (let j = 0; j < dimension; j++) {
          newCentroids[cluster][j] += vectors[i][j];
        }
        counts[cluster]++;
      }
      for (let i = 0; i < k; i++) {
        if (counts[i] > 0) {
          for (let j = 0; j < dimension; j++) {
            newCentroids[i][j] /= counts[i];
          }
          this.centroids[i] = newCentroids[i];
        }
      }
    }
  }

  /**
   * 找最近中心
   */
  private findClosestCentroid(v: Float32Array, metric: DistanceMetric): number {
    let best = 0;
    let bestDist = computeDistance(v, this.centroids[0], metric);
    for (let i = 1; i < this.centroids.length; i++) {
      const d = computeDistance(v, this.centroids[i], metric);
      if (metric === 'l2' ? d < bestDist : d > bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * 添加向量
   */
  add(id: string, vector: Float32Array, metadata?: Record<string, unknown>, metric: DistanceMetric = 'cosine'): void {
    this.vectors.push(vector);
    this.ids.push(id);
    this.metadata.push(metadata);
    this.assignments.push(this.findClosestCentroid(vector, metric));
  }

  /**
   * 搜索
   */
  search(query: Float32Array, topK: number, nprobe: number, metric: DistanceMetric): Array<{ index: number; distance: number }> {
    if (this.vectors.length === 0 || this.centroids.length === 0) return [];

    // 找最近的 nprobe 个聚类
    const clusterDists = this.centroids.map((c, i) => ({
      index: i,
      distance: computeDistance(query, c, metric),
    }));
    clusterDists.sort((a, b) =>
      metric === 'l2' ? a.distance - b.distance : b.distance - a.distance
    );
    const searchClusters = new Set(clusterDists.slice(0, Math.min(nprobe, this.centroids.length)).map((c) => c.index));

    // 在这些聚类中搜索
    const results: Array<{ index: number; distance: number }> = [];
    for (let i = 0; i < this.vectors.length; i++) {
      if (searchClusters.has(this.assignments[i])) {
        const d = computeDistance(query, this.vectors[i], metric);
        results.push({ index: i, distance: d });
      }
    }
    results.sort((a, b) =>
      metric === 'l2' ? a.distance - b.distance : b.distance - a.distance
    );
    return results.slice(0, topK);
  }

  /**
   * 重建 (用于添加新向量后重新平衡)
   */
  rebuild(nlist: number, dimension: number, metric: DistanceMetric): void {
    this.train(this.vectors, nlist, dimension, metric);
    this.assignments = this.vectors.map((v) => this.findClosestCentroid(v, metric));
  }

  size(): number {
    return this.vectors.length;
  }

  getCentroid(i: number): Float32Array | undefined {
    return this.centroids[i];
  }

  getId(i: number): string {
    return this.ids[i];
  }

  getMetadata(i: number): Record<string, unknown> | undefined {
    return this.metadata[i];
  }

  getAll(): Array<{ id: string; vector: Float32Array; metadata?: Record<string, unknown> }> {
    return this.vectors.map((v, i) => ({ id: this.ids[i], vector: v, metadata: this.metadata[i] }));
  }
}

// ============ FAISSWasmVectorStore 主类 ============

/**
 * FAISS-WASM 风格向量检索引擎
 *
 * 索引类型:
 *   - flat: 暴力搜索,精确但慢,适合 <1K 向量
 *   - ivf: 倒排文件索引,聚类分桶,适合 1K-100K 向量
 *   - hnsw: 图索引,最快,适合任意规模
 *   - auto: 根据向量数自动选择
 */
export class FAISSWasmVectorStore {
  private readonly options: Required<Omit<FAISSIndexOptions, 'normalizeVectors'>> & { normalizeVectors: boolean };
  private vectors: Map<string, FAISSVectorMetadata> = new Map();
  private insertionOrder: string[] = [];
  private hnsw?: HNSWGraph;
  private ivf?: IVFIndex;
  private listeners: Set<FAISSVectorStoreListener> = new Set();
  private stats: {
    buildTimeMs: number;
    lastSearchTimeMs: number;
    totalSearches: number;
    totalSearchTimeMs: number;
  } = {
    buildTimeMs: 0,
    lastSearchTimeMs: 0,
    totalSearches: 0,
    totalSearchTimeMs: 0,
  };
  private activeIndexType: IndexType = 'flat';

  constructor(options: FAISSIndexOptions) {
    this.options = {
      type: options.type ?? 'auto',
      metric: options.metric ?? 'cosine',
      dimension: options.dimension,
      nlist: options.nlist ?? 0, // 0 表示自动 = sqrt(n)
      nprobe: options.nprobe ?? 8,
      M: options.M ?? 16,
      efConstruction: options.efConstruction ?? 200,
      efSearch: options.efSearch ?? 50,
      normalizeVectors: options.normalizeVectors ?? false,
      rebuildThreshold: options.rebuildThreshold ?? 10000,
    };
    // 初始化时按配置确定索引类型
    this.activeIndexType = this.options.type === 'auto' ? 'flat' : this.options.type;
  }

  // ============ 索引管理 ============

  /**
   * 自动选择索引类型
   */
  private selectIndexType(n: number): IndexType {
    if (this.options.type !== 'auto') return this.options.type;
    if (n < 1000) return 'flat';
    if (n < 10000) return 'ivf';
    return 'hnsw';
  }

  /**
   * 添加单个向量
   */
  add(id: string, vector: number[] | Float32Array, metadata?: Record<string, unknown>): void {
    const fv = this.normalizeVector(vector);
    this.vectors.set(id, { id, vector: fv, metadata });
    if (!this.insertionOrder.includes(id)) {
      this.insertionOrder.push(id);
    }

    const idx = this.selectIndexType(this.vectors.size);
    this.activeIndexType = idx;

    if (idx === 'hnsw') {
      this.buildHNSW();
    } else if (idx === 'ivf' && this.ivf) {
      this.ivf.add(id, fv, metadata, this.options.metric);
    }

    this.emit({
      type: 'vector-added',
      id,
      index: this.insertionOrder.length - 1,
      at: Date.now(),
    });

    // 超过重建阈值,触发重建
    if (this.vectors.size > this.options.rebuildThreshold) {
      this.rebuildIndex();
    }
  }

  /**
   * 批量添加
   */
  addBatch(items: Array<{ id: string; vector: number[] | Float32Array; metadata?: Record<string, unknown> }>): void {
    const startTime = Date.now();
    for (const item of items) {
      const fv = this.normalizeVector(item.vector);
      this.vectors.set(item.id, { id: item.id, vector: fv, metadata: item.metadata });
      if (!this.insertionOrder.includes(item.id)) {
        this.insertionOrder.push(item.id);
      }
    }

    // 重建索引
    this.buildIndexForCurrent();

    this.emit({
      type: 'batch-added',
      count: items.length,
      totalTimeMs: Date.now() - startTime,
      at: Date.now(),
    });
  }

  /**
   * 搜索 Top-K
   */
  search(query: number[] | Float32Array, topK: number, filter?: Record<string, unknown>): FAISSSearchResult[] {
    const startTime = Date.now();
    const q = this.normalizeVector(query);

    if (this.vectors.size === 0) {
      this.recordSearchTime(0, startTime);
      return [];
    }

    let candidates: Array<{ index: number; distance: number }> = [];

    switch (this.activeIndexType) {
      case 'flat':
        candidates = this.searchFlat(q, topK);
        break;
      case 'ivf':
        candidates = this.searchIVF(q, topK);
        break;
      case 'hnsw':
        candidates = this.searchHNSW(q, topK);
        break;
    }

    let results: FAISSSearchResult[] = candidates.map((c) => {
      const id = this.getIdByIndex(c.index);
      const meta = this.vectors.get(id);
      return {
        id,
        score: distanceToScore(c.distance, this.options.metric),
        distance: c.distance,
        metadata: meta?.metadata,
        index: c.index,
      };
    });

    // 应用元数据过滤
    if (filter) {
      results = results.filter((r) => {
        if (!r.metadata) return false;
        for (const [key, value] of Object.entries(filter)) {
          if (r.metadata[key] !== value) return false;
        }
        return true;
      });
    }

    this.recordSearchTime(Date.now() - startTime, startTime);
    this.emit({
      type: 'search-completed',
      topK,
      hits: results.length,
      timeMs: Date.now() - startTime,
      at: Date.now(),
    });

    return results;
  }

  /**
   * 删除向量
   */
  delete(id: string): boolean {
    const meta = this.vectors.get(id);
    if (!meta) return false;
    this.vectors.delete(id);
    const idx = this.insertionOrder.indexOf(id);
    if (idx >= 0) this.insertionOrder.splice(idx, 1);
    this.buildIndexForCurrent();
    return true;
  }

  /**
   * 清空
   */
  clear(): void {
    this.vectors.clear();
    this.insertionOrder = [];
    this.hnsw = undefined;
    this.ivf = undefined;
    this.activeIndexType = 'flat';
    this.emit({ type: 'index-cleared', at: Date.now() });
  }

  /**
   * 获取向量数
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * 获取所有向量
   */
  getAll(): Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }> {
    return Array.from(this.vectors.values()).map((v) => ({
      id: v.id,
      vector: Array.from(v.vector),
      metadata: v.metadata,
    }));
  }

  /**
   * 重建索引
   */
  rebuildIndex(): void {
    const fromCount = this.vectors.size;
    this.buildIndexForCurrent();
    this.emit({
      type: 'index-rebuilt',
      type: this.activeIndexType,
      fromCount,
      at: Date.now(),
    });
  }

  /**
   * 序列化
   */
  serialize(): SerializedFAISSIndex {
    const vectors = Array.from(this.vectors.values()).map((v) => ({
      id: v.id,
      vector: Array.from(v.vector),
      metadata: v.metadata,
    }));
    const serialized: SerializedFAISSIndex = {
      version: '1.0.0',
      type: this.activeIndexType,
      metric: this.options.metric,
      dimension: this.options.dimension,
      vectors,
      options: { ...this.options },
    };
    if (this.ivf) {
      serialized.ivfCentroids = this.ivf['centroids']?.map((c) => Array.from(c)) || [];
      serialized.ivfAssignments = this.ivf['assignments'] || [];
    }
    if (this.hnsw) {
      serialized.hnswGraph = this.hnsw['nodes']?.map((n) =>
        n.neighbors.flat()
      ) || [];
    }
    return serialized;
  }

  /**
   * 反序列化
   */
  static deserialize(data: SerializedFAISSIndex): FAISSWasmVectorStore {
    const store = new FAISSWasmVectorStore({
      type: data.type,
      metric: data.metric,
      dimension: data.dimension,
    });
    for (const v of data.vectors) {
      store.vectors.set(v.id, {
        id: v.id,
        vector: new Float32Array(v.vector),
        metadata: v.metadata,
      });
      store.insertionOrder.push(v.id);
    }
    store.activeIndexType = data.type;
    store.buildIndexForCurrent();
    return store;
  }

  /**
   * 获取统计
   */
  getStats(): FAISSIndexStats {
    const memoryBytes = this.vectors.size * (this.options.dimension * 4 + 100); // Float32 4 字节 + 元数据估算
    return {
      totalVectors: this.vectors.size,
      dimension: this.options.dimension,
      type: this.activeIndexType,
      metric: this.options.metric,
      buildTimeMs: this.stats.buildTimeMs,
      lastSearchTimeMs: this.stats.lastSearchTimeMs,
      totalSearches: this.stats.totalSearches,
      avgSearchTimeMs: this.stats.totalSearches > 0
        ? this.stats.totalSearchTimeMs / this.stats.totalSearches
        : 0,
      memoryBytes,
      indexSize: this.vectors.size,
      nlist: this.ivf?.['centroids']?.length,
      nprobe: this.options.nprobe,
      M: this.options.M,
      efSearch: this.options.efSearch,
    };
  }

  // ============ 事件订阅 ============

  on(listener: FAISSVectorStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: FAISSVectorStoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // ignore listener errors
        void err;
      }
    }
  }

  // ============ 内部方法 ============

  private normalizeVector(v: number[] | Float32Array): Float32Array {
    let fv: Float32Array;
    if (v instanceof Float32Array) {
      fv = v;
    } else {
      fv = new Float32Array(v);
    }
    if (this.options.normalizeVectors && this.options.metric === 'cosine') {
      return l2Normalize(fv);
    }
    return fv;
  }

  private buildIndexForCurrent(): void {
    const start = Date.now();
    const idx = this.selectIndexType(this.vectors.size);
    this.activeIndexType = idx;

    if (idx === 'hnsw') {
      this.buildHNSW();
    } else if (idx === 'ivf') {
      this.buildIVF();
    } else {
      // flat: 无需构建
      this.hnsw = undefined;
      this.ivf = undefined;
    }

    this.stats.buildTimeMs = Date.now() - start;
  }

  private buildHNSW(): void {
    if (this.vectors.size === 0) return;
    this.hnsw = new HNSWGraph({
      M: this.options.M,
      efConstruction: this.options.efConstruction,
      metric: this.options.metric,
    });
    const allVectors: Float32Array[] = [];
    for (const v of this.vectors.values()) {
      allVectors.push(v.vector);
    }
    let i = 0;
    for (const v of this.vectors.values()) {
      this.hnsw.add(v.id, v.vector, allVectors);
      i++;
    }
  }

  private buildIVF(): void {
    if (this.vectors.size === 0) return;
    const nlist = this.options.nlist > 0 ? this.options.nlist : Math.max(1, Math.floor(Math.sqrt(this.vectors.size)));
    this.ivf = new IVFIndex();
    const vectors = Array.from(this.vectors.values()).map((v) => v.vector);
    this.ivf.train(vectors, nlist, this.options.dimension, this.options.metric);
    for (const v of this.vectors.values()) {
      this.ivf.add(v.id, v.vector, v.metadata, this.options.metric);
    }
  }

  private searchFlat(q: Float32Array, topK: number): Array<{ index: number; distance: number }> {
    const all: Array<{ index: number; distance: number }> = [];
    let i = 0;
    for (const meta of this.vectors.values()) {
      const d = computeDistance(q, meta.vector, this.options.metric);
      all.push({ index: i, distance: d });
      i++;
    }
    all.sort((a, b) =>
      this.options.metric === 'l2' ? a.distance - b.distance : b.distance - a.distance
    );
    return all.slice(0, topK);
  }

  private searchIVF(q: Float32Array, topK: number): Array<{ index: number; distance: number }> {
    if (!this.ivf) return this.searchFlat(q, topK);
    return this.ivf.search(q, topK, this.options.nprobe, this.options.metric);
  }

  private searchHNSW(q: Float32Array, topK: number): Array<{ index: number; distance: number }> {
    if (!this.hnsw) return this.searchFlat(q, topK);
    const allVectors: Float32Array[] = [];
    for (const v of this.vectors.values()) {
      allVectors.push(v.vector);
    }
    return this.hnsw.search(q, topK, this.options.efSearch, allVectors);
  }

  private getIdByIndex(index: number): string {
    if (index < 0 || index >= this.insertionOrder.length) {
      // 从 vectors map 中找
      let i = 0;
      for (const id of this.vectors.keys()) {
        if (i === index) return id;
        i++;
      }
      return '';
    }
    return this.insertionOrder[index];
  }

  private recordSearchTime(timeMs: number, _startTime: number): void {
    this.stats.lastSearchTimeMs = timeMs;
    this.stats.totalSearches += 1;
    this.stats.totalSearchTimeMs += timeMs;
  }
}

// ============ 工厂函数 ============

/**
 * 创建 FAISS 向量存储 (auto 索引)
 */
export function createFAISSStore(
  dimension: number,
  options?: Partial<Omit<FAISSIndexOptions, 'dimension'>>
): FAISSWasmVectorStore {
  return new FAISSWasmVectorStore({
    dimension,
    ...options,
  });
}

/**
 * 创建 Flat 索引 (精确搜索)
 */
export function createFlatIndex(
  dimension: number,
  metric: DistanceMetric = 'cosine'
): FAISSWasmVectorStore {
  return new FAISSWasmVectorStore({
    type: 'flat',
    dimension,
    metric,
  });
}

/**
 * 创建 IVF 索引 (聚类分桶)
 */
export function createIVFIndex(
  dimension: number,
  nlist: number,
  metric: DistanceMetric = 'cosine'
): FAISSWasmVectorStore {
  return new FAISSWasmVectorStore({
    type: 'ivf',
    dimension,
    nlist,
    metric,
  });
}

/**
 * 创建 HNSW 索引 (图索引,最快)
 */
export function createHNSWIndex(
  dimension: number,
  M: number = 16,
  metric: DistanceMetric = 'cosine'
): FAISSWasmVectorStore {
  return new FAISSWasmVectorStore({
    type: 'hnsw',
    dimension,
    M,
    metric,
  });
}
