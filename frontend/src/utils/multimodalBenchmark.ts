/**
 * # ============================================================
 * # MultimodalRAGBenchmark - 多模态 RAG 性能基准 (v1.0.0 Cycle 48 G48-04)
 * # ============================================================
 * # 核心作用：多模态 RAG 系统自动化性能基准
 * #           - 多模态文档规模基准 (图文混合数据集)
 * #           - 跨模态检索压测
 * #           - 嵌入推理延迟基准
 * #           - 跨模态缓存命中率测试
 * #           - 多模态检索质量 (Recall@K)
 * #           - 性能回归检测
 * #           - 多模态专项报告
 * # 对标产品: BEIR Multimodal / MultiCLR Benchmark
 * # 设计要点:
 * #   1. 真实场景: 模拟图文混合知识库
 * #   2. 多维度指标: 延迟 / 质量 / 缓存 / 内存
 * #   3. 模态拆分: text-only / image-only / cross-modal 独立统计
 * #   4. 回归检测: 与历史基线对比
 * #   5. 报告生成: JSON / Markdown
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 48 G48-04 初次创建
 * # ============================================================
 */

import { MultimodalEmbedding, type Modality, type MultimodalInput, type EmbeddingResult } from './multimodalEmbedding';
import { MultimodalVectorIndex, type MultimodalDocument, type CrossModalSearchResult } from './multimodalVectorIndex';
import { MultimodalSemanticCache } from './multimodalSemanticCache';

// ============ 类型定义 ============

/**
 * 多模态测试文档
 */
export interface MultimodalBenchmarkDocument {
  id: string;
  text?: string;
  image?: string;
  primaryModality: Modality;
  metadata?: Record<string, unknown>;
}

/**
 * 多模态测试查询
 */
export interface MultimodalBenchmarkQuery {
  id?: string;
  /** 文本查询 (可选) */
  text?: string;
  /** 图像查询 (可选) */
  image?: string;
  /** 模态 */
  modality: Modality;
  /** 期望命中的文档 ID (用于质量评估) */
  expectedIds?: string[];
}

/**
 * 多模态延迟测试结果
 */
export interface MultimodalLatencyResult {
  testName: string;
  timestamp: number;
  modality: Modality;
  totalQueries: number;
  successQueries: number;
  failedQueries: number;
  errorRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  histogram: Array<{ range: string; count: number; percentage: number }>;
}

/**
 * 跨模态检索质量结果
 */
export interface MultimodalQualityResult {
  testName: string;
  timestamp: number;
  totalQueries: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number; // Mean Reciprocal Rank
  ndcgAt10: number;
  /** 各模态拆分质量 */
  modalityBreakdown: Record<Modality, {
    count: number;
    recallAt5: number;
  }>;
}

/**
 * 缓存基准结果
 */
export interface MultimodalCacheBenchmarkResult {
  testName: string;
  timestamp: number;
  totalQueries: number;
  exactHits: number;
  semanticTextHits: number;
  semanticImageHits: number;
  semanticFusedHits: number;
  semanticCrossHits: number;
  misses: number;
  hitRate: number;
  crossModalityHitRate: number;
  avgLookupTimeMs: number;
}

/**
 * 嵌入推理基准结果
 */
export interface EmbeddingBenchmarkResult {
  testName: string;
  timestamp: number;
  totalEmbeddings: number;
  modality: Modality;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughput: number; // embeddings/sec
  cacheHitRate: number;
}

/**
 * 综合基准报告
 */
export interface MultimodalBenchmarkReport {
  testName: string;
  timestamp: number;
  duration: number;
  /** 嵌入性能 */
  embeddingPerformance: EmbeddingBenchmarkResult[];
  /** 检索延迟 (各模态) */
  retrievalLatency: MultimodalLatencyResult[];
  /** 检索质量 */
  retrievalQuality: MultimodalQualityResult | null;
  /** 缓存性能 */
  cachePerformance: MultimodalCacheBenchmarkResult | null;
  /** 总体统计 */
  summary: {
    totalDocuments: number;
    totalQueries: number;
    overallHitRate: number;
    avgP95LatencyMs: number;
    avgRecallAt5: number;
  };
  /** Markdown 报告 */
  markdown: string;
}

// ============ 工具函数 ============

/**
 * 计算百分位数
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (sortedValues.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower] * 0) * (idx - lower);
}

/**
 * 计算直方图
 */
function calculateHistogram(values: number[], bins: number = 10): Array<{ range: string; count: number; percentage: number }> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / bins;
  const buckets: number[] = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), bins - 1);
    buckets[idx] += 1;
  }
  return buckets.map((count, i) => {
    const start = min + i * step;
    const end = i === bins - 1 ? max : min + (i + 1) * step;
    return {
      range: `${start.toFixed(0)}-${end.toFixed(0)}ms`,
      count,
      percentage: (count / values.length) * 100,
    };
  });
}

/**
 * 计算 MRR
 */
function calculateMRR(results: CrossModalSearchResult[], expectedIds: string[]): number {
  if (expectedIds.length === 0) return 0;
  for (let i = 0; i < results.length; i++) {
    if (expectedIds.includes(results[i]!.document.id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * 计算 Recall@K
 */
function calculateRecallAtK(results: CrossModalSearchResult[], expectedIds: string[], k: number): number {
  if (expectedIds.length === 0) return 0;
  const retrieved = new Set(results.slice(0, k).map((r) => r.document.id));
  const hit = expectedIds.filter((id) => retrieved.has(id)).length;
  return hit / expectedIds.length;
}

/**
 * 计算 NDCG@K
 */
function calculateNDCGAtK(results: CrossModalSearchResult[], expectedIds: string[], k: number): number {
  if (expectedIds.length === 0) return 0;
  const expected = new Set(expectedIds);
  let dcg = 0;
  for (let i = 0; i < Math.min(k, results.length); i++) {
    if (expected.has(results[i]!.document.id)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(k, expectedIds.length); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

// ============ MultimodalRAGBenchmark 主类 ============

/**
 * 多模态 RAG 性能基准
 *
 * 使用方法:
 *   1. 创建 benchmark 实例
 *   2. 准备测试文档和查询
 *   3. 调用对应测试方法
 *   4. 生成报告
 */
export class MultimodalRAGBenchmark {
  private readonly embedding: MultimodalEmbedding;
  private readonly index: MultimodalVectorIndex;
  private readonly cache: MultimodalSemanticCache<string>;

  constructor(config: {
    embedding?: MultimodalEmbedding;
    index?: MultimodalVectorIndex;
    cache?: MultimodalSemanticCache<string>;
    dimension?: number;
  } = {}) {
    const dim = config.dimension ?? 256;
    this.embedding = config.embedding ?? new MultimodalEmbedding({ dimension: dim });
    this.index = config.index ?? new MultimodalVectorIndex({ embedding: this.embedding, dimension: dim });
    this.cache = config.cache ?? new MultimodalSemanticCache<string>({ dimension: dim });
  }

  // ============ 准备 API ============

  /**
   * 索引测试文档
   */
  async indexDocuments(docs: MultimodalBenchmarkDocument[]): Promise<number> {
    let count = 0;
    for (const doc of docs) {
      await this.index.addDocument({
        id: doc.id,
        text: doc.text,
        image: doc.image,
        primaryModality: doc.primaryModality,
        metadata: doc.metadata,
      });
      count += 1;
    }
    return count;
  }

  // ============ 延迟基准 ============

  /**
   * 嵌入推理延迟基准
   */
  async benchmarkEmbedding(
    inputs: MultimodalInput[],
    options: { name?: string } = {}
  ): Promise<EmbeddingBenchmarkResult> {
    const testName = options.name ?? 'embedding-latency';
    const startTime = Date.now();
    const latencies: number[] = [];
    let cacheHits = 0;

    for (const input of inputs) {
      const t0 = Date.now();
      const r = await this.embedding.embed(input);
      latencies.push(Date.now() - t0);
      if (r.cached) cacheHits += 1;
    }

    const totalDuration = Date.now() - startTime;
    const sorted = [...latencies].sort((a, b) => a - b);
    const throughput = inputs.length / (totalDuration / 1000);

    return {
      testName,
      timestamp: startTime,
      totalEmbeddings: inputs.length,
      modality: inputs[0]?.modality ?? 'text',
      avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / latencies.length,
      p50LatencyMs: percentile(sorted, 0.5),
      p95LatencyMs: percentile(sorted, 0.95),
      p99LatencyMs: percentile(sorted, 0.99),
      throughput,
      cacheHitRate: inputs.length > 0 ? cacheHits / inputs.length : 0,
    };
  }

  /**
   * 检索延迟基准 (按模态分组)
   */
  async benchmarkRetrievalLatency(
    queries: MultimodalBenchmarkQuery[],
    options: { name?: string; topK?: number } = {}
  ): Promise<MultimodalLatencyResult[]> {
    const topK = options.topK ?? 10;
    const results: MultimodalLatencyResult[] = [];
    const testName = options.name ?? 'retrieval-latency';

    // 按模态分组
    const groups: Record<Modality, MultimodalBenchmarkQuery[]> = {
      text: [],
      image: [],
      multimodal: [],
      audio: [],
    };
    for (const q of queries) {
      groups[q.modality].push(q);
    }

    for (const modality of Object.keys(groups) as Modality[]) {
      const group = groups[modality];
      if (group.length === 0) continue;

      const latencies: number[] = [];
      let success = 0;
      let failed = 0;

      for (const q of group) {
        try {
          const t0 = Date.now();
          if (q.modality === 'text') {
            await this.index.searchByText(q.text ?? '', { topK });
          } else if (q.modality === 'image') {
            await this.index.searchByImage(q.image ?? '', { topK });
          } else if (q.modality === 'multimodal') {
            await this.index.searchByMultimodal(q.text ?? '', q.image ?? '', { topK });
          }
          latencies.push(Date.now() - t0);
          success += 1;
        } catch (e) {
          failed += 1;
        }
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      results.push({
        testName: `${testName}-${modality}`,
        timestamp: Date.now(),
        modality,
        totalQueries: group.length,
        successQueries: success,
        failedQueries: failed,
        errorRate: failed / group.length,
        avgLatencyMs: latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0,
        minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
        maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
        p50LatencyMs: percentile(sorted, 0.5),
        p95LatencyMs: percentile(sorted, 0.95),
        p99LatencyMs: percentile(sorted, 0.99),
        histogram: calculateHistogram(latencies),
      });
    }

    return results;
  }

  // ============ 质量基准 ============

  /**
   * 检索质量基准 (Recall / MRR / NDCG)
   */
  async benchmarkQuality(
    queries: MultimodalBenchmarkQuery[],
    options: { name?: string; topK?: number } = {}
  ): Promise<MultimodalQualityResult | null> {
    const topK = options.topK ?? 10;
    const testName = options.name ?? 'retrieval-quality';

    // 过滤有期望命中的查询
    const validQueries = queries.filter((q) => q.expectedIds && q.expectedIds.length > 0);
    if (validQueries.length === 0) return null;

    let recallAt1Sum = 0;
    let recallAt5Sum = 0;
    let recallAt10Sum = 0;
    let mrrSum = 0;
    let ndcgAt10Sum = 0;

    const modalityStats: Record<Modality, { count: number; recallSum: number }> = {
      text: { count: 0, recallSum: 0 },
      image: { count: 0, recallSum: 0 },
      multimodal: { count: 0, recallSum: 0 },
      audio: { count: 0, recallSum: 0 },
    };

    for (const q of validQueries) {
      let results: CrossModalSearchResult[];
      if (q.modality === 'text') {
        results = await this.index.searchByText(q.text ?? '', { topK });
      } else if (q.modality === 'image') {
        results = await this.index.searchByImage(q.image ?? '', { topK });
      } else {
        results = await this.index.searchByMultimodal(q.text ?? '', q.image ?? '', { topK });
      }

      const expected = q.expectedIds!;
      const r1 = calculateRecallAtK(results, expected, 1);
      const r5 = calculateRecallAtK(results, expected, 5);
      const r10 = calculateRecallAtK(results, expected, 10);
      const mrr = calculateMRR(results, expected);
      const ndcg = calculateNDCGAtK(results, expected, 10);

      recallAt1Sum += r1;
      recallAt5Sum += r5;
      recallAt10Sum += r10;
      mrrSum += mrr;
      ndcgAt10Sum += ndcg;

      modalityStats[q.modality].count += 1;
      modalityStats[q.modality].recallSum += r5;
    }

    const n = validQueries.length;
    const modalityBreakdown: MultimodalQualityResult['modalityBreakdown'] = {
      text: { count: 0, recallAt5: 0 },
      image: { count: 0, recallAt5: 0 },
      multimodal: { count: 0, recallAt5: 0 },
      audio: { count: 0, recallAt5: 0 },
    };
    for (const m of Object.keys(modalityStats) as Modality[]) {
      const s = modalityStats[m];
      modalityBreakdown[m] = {
        count: s.count,
        recallAt5: s.count > 0 ? s.recallSum / s.count : 0,
      };
    }

    return {
      testName,
      timestamp: Date.now(),
      totalQueries: n,
      recallAt1: recallAt1Sum / n,
      recallAt5: recallAt5Sum / n,
      recallAt10: recallAt10Sum / n,
      mrr: mrrSum / n,
      ndcgAt10: ndcgAt10Sum / n,
      modalityBreakdown,
    };
  }

  // ============ 缓存基准 ============

  /**
   * 缓存性能基准
   */
  async benchmarkCache(
    queries: MultimodalBenchmarkQuery[],
    loader: (q: MultimodalBenchmarkQuery) => Promise<string>,
    options: { name?: string } = {}
  ): Promise<MultimodalCacheBenchmarkResult> {
    const testName = options.name ?? 'cache-benchmark';
    const startTime = Date.now();
    const initialStats = this.cache.getStats();
    const startQueries = initialStats.totalQueries;
    const startExact = initialStats.exactHits;
    const startText = initialStats.semanticTextHits;
    const startImage = initialStats.semanticImageHits;
    const startFused = initialStats.semanticFusedHits;
    const startCross = initialStats.semanticCrossHits;
    const startMisses = initialStats.misses;

    for (const q of queries) {
      const key = {
        modality: q.modality,
        text: q.text,
        image: q.image,
      };
      await this.cache.getOrSet(key, () => loader(q));
    }

    const endStats = this.cache.getStats();
    const dExact = endStats.exactHits - startExact;
    const dText = endStats.semanticTextHits - startText;
    const dImage = endStats.semanticImageHits - startImage;
    const dFused = endStats.semanticFusedHits - startFused;
    const dCross = endStats.semanticCrossHits - startCross;
    const dMisses = endStats.misses - startMisses;
    const dQueries = endStats.totalQueries - startQueries;

    return {
      testName,
      timestamp: startTime,
      totalQueries: dQueries,
      exactHits: dExact,
      semanticTextHits: dText,
      semanticImageHits: dImage,
      semanticFusedHits: dFused,
      semanticCrossHits: dCross,
      misses: dMisses,
      hitRate: dQueries > 0 ? (dExact + dText + dImage + dFused + dCross) / dQueries : 0,
      crossModalityHitRate: dQueries > 0 ? dCross / dQueries : 0,
      avgLookupTimeMs: dQueries > 0 ? (endStats.avgLookupTimeMs - initialStats.avgLookupTimeMs) : 0,
    };
  }

  // ============ 综合报告 ============

  /**
   * 运行完整基准测试套件
   */
  async runFullSuite(config: {
    testName?: string;
    documents: MultimodalBenchmarkDocument[];
    queries: MultimodalBenchmarkQuery[];
    cacheLoader?: (q: MultimodalBenchmarkQuery) => Promise<string>;
  }): Promise<MultimodalBenchmarkReport> {
    const testName = config.testName ?? 'multimodal-rag-benchmark';
    const startTime = Date.now();

    // 1. 索引文档
    await this.indexDocuments(config.documents);

    // 2. 嵌入基准
    const embedInputs: MultimodalInput[] = config.queries.map((q) => ({
      modality: q.modality,
      text: q.text,
      image: q.image,
    }));
    const embeddingPerformance = [await this.benchmarkEmbedding(embedInputs, { name: `${testName}-embed` })];

    // 3. 检索延迟基准
    const retrievalLatency = await this.benchmarkRetrievalLatency(config.queries, { name: testName });

    // 4. 检索质量基准
    const retrievalQuality = await this.benchmarkQuality(config.queries, { name: testName });

    // 5. 缓存基准
    let cachePerformance: MultimodalCacheBenchmarkResult | null = null;
    if (config.cacheLoader) {
      cachePerformance = await this.benchmarkCache(config.queries, config.cacheLoader, { name: testName });
    }

    const duration = Date.now() - startTime;

    // 计算汇总
    const overallHitRate = cachePerformance?.hitRate ?? 0;
    const avgP95LatencyMs = retrievalLatency.length > 0
      ? retrievalLatency.reduce((s, r) => s + r.p95LatencyMs, 0) / retrievalLatency.length
      : 0;
    const avgRecallAt5 = retrievalQuality?.recallAt5 ?? 0;

    const summary = {
      totalDocuments: config.documents.length,
      totalQueries: config.queries.length,
      overallHitRate,
      avgP95LatencyMs,
      avgRecallAt5,
    };

    const markdown = this.generateMarkdown({
      testName,
      timestamp: startTime,
      duration,
      embeddingPerformance,
      retrievalLatency,
      retrievalQuality,
      cachePerformance,
      summary,
      markdown: '',
    });

    return {
      testName,
      timestamp: startTime,
      duration,
      embeddingPerformance,
      retrievalLatency,
      retrievalQuality,
      cachePerformance,
      summary,
      markdown,
    };
  }

  // ============ 报告生成 ============

  /**
   * 生成 Markdown 报告
   */
  generateMarkdown(report: MultimodalBenchmarkReport): string {
    const lines: string[] = [];
    lines.push(`# ${report.testName}`);
    lines.push('');
    lines.push(`**Generated**: ${new Date(report.timestamp).toISOString()}`);
    lines.push(`**Duration**: ${report.duration}ms`);
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    lines.push(`- Total Documents: ${report.summary.totalDocuments}`);
    lines.push(`- Total Queries: ${report.summary.totalQueries}`);
    lines.push(`- Overall Cache Hit Rate: ${(report.summary.overallHitRate * 100).toFixed(2)}%`);
    lines.push(`- Avg P95 Latency: ${report.summary.avgP95LatencyMs.toFixed(2)}ms`);
    lines.push(`- Avg Recall@5: ${(report.summary.avgRecallAt5 * 100).toFixed(2)}%`);
    lines.push('');

    if (report.embeddingPerformance.length > 0) {
      lines.push('## Embedding Performance');
      lines.push('');
      lines.push('| Test | Total | Avg (ms) | P50 | P95 | P99 | Throughput (qps) | Cache Hit |');
      lines.push('|------|-------|----------|-----|-----|-----|------------------|-----------|');
      for (const e of report.embeddingPerformance) {
        lines.push(`| ${e.testName} | ${e.totalEmbeddings} | ${e.avgLatencyMs.toFixed(2)} | ${e.p50LatencyMs.toFixed(2)} | ${e.p95LatencyMs.toFixed(2)} | ${e.p99LatencyMs.toFixed(2)} | ${e.throughput.toFixed(2)} | ${(e.cacheHitRate * 100).toFixed(2)}% |`);
      }
      lines.push('');
    }

    if (report.retrievalLatency.length > 0) {
      lines.push('## Retrieval Latency');
      lines.push('');
      lines.push('| Modality | Total | Avg (ms) | P50 | P95 | P99 | Error Rate |');
      lines.push('|----------|-------|----------|-----|-----|-----|------------|');
      for (const r of report.retrievalLatency) {
        lines.push(`| ${r.modality} | ${r.totalQueries} | ${r.avgLatencyMs.toFixed(2)} | ${r.p50LatencyMs.toFixed(2)} | ${r.p95LatencyMs.toFixed(2)} | ${r.p99LatencyMs.toFixed(2)} | ${(r.errorRate * 100).toFixed(2)}% |`);
      }
      lines.push('');
    }

    if (report.retrievalQuality) {
      const q = report.retrievalQuality;
      lines.push('## Retrieval Quality');
      lines.push('');
      lines.push(`- Recall@1: ${(q.recallAt1 * 100).toFixed(2)}%`);
      lines.push(`- Recall@5: ${(q.recallAt5 * 100).toFixed(2)}%`);
      lines.push(`- Recall@10: ${(q.recallAt10 * 100).toFixed(2)}%`);
      lines.push(`- MRR: ${q.mrr.toFixed(4)}`);
      lines.push(`- NDCG@10: ${q.ndcgAt10.toFixed(4)}`);
      lines.push('');
      lines.push('### Per-Modality Recall@5');
      lines.push('');
      lines.push('| Modality | Count | Recall@5 |');
      lines.push('|----------|-------|----------|');
      for (const [m, s] of Object.entries(q.modalityBreakdown)) {
        lines.push(`| ${m} | ${s.count} | ${(s.recallAt5 * 100).toFixed(2)}% |`);
      }
      lines.push('');
    }

    if (report.cachePerformance) {
      const c = report.cachePerformance;
      lines.push('## Cache Performance');
      lines.push('');
      lines.push(`- Total Queries: ${c.totalQueries}`);
      lines.push(`- Hit Rate: ${(c.hitRate * 100).toFixed(2)}%`);
      lines.push(`- Cross-Modality Hit Rate: ${(c.crossModalityHitRate * 100).toFixed(2)}%`);
      lines.push(`- Exact Hits: ${c.exactHits}`);
      lines.push(`- Semantic Text Hits: ${c.semanticTextHits}`);
      lines.push(`- Semantic Image Hits: ${c.semanticImageHits}`);
      lines.push(`- Semantic Fused Hits: ${c.semanticFusedHits}`);
      lines.push(`- Semantic Cross Hits: ${c.semanticCrossHits}`);
      lines.push(`- Misses: ${c.misses}`);
      lines.push(`- Avg Lookup: ${c.avgLookupTimeMs.toFixed(2)}ms`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ============ 工厂函数 ============

/**
 * 创建多模态 RAG 性能基准
 */
export function createMultimodalBenchmark(config: {
  embedding?: MultimodalEmbedding;
  index?: MultimodalVectorIndex;
  cache?: MultimodalSemanticCache<string>;
  dimension?: number;
} = {}): MultimodalRAGBenchmark {
  return new MultimodalRAGBenchmark(config);
}
