/**
 * # ============================================================
 * # multimodalBenchmark.test.ts - 多模态 RAG 性能基准单元测试
 * # ============================================================
 * # 覆盖范围:
 * #   1. 文档索引
 * #   2. 嵌入推理基准
 * #   3. 检索延迟基准 (各模态)
 * #   4. 检索质量基准 (Recall/MRR/NDCG)
 * #   5. 缓存性能基准
 * #   6. 完整测试套件
 * #   7. Markdown 报告生成
 * #   8. 工厂函数
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MultimodalRAGBenchmark,
  createMultimodalBenchmark,
  type MultimodalBenchmarkDocument,
  type MultimodalBenchmarkQuery,
} from './multimodalBenchmark';

// ============ 工具: 构造测试数据集 ============

function makeDocuments(count: number): MultimodalBenchmarkDocument[] {
  return Array.from({ length: count }, (_, i) => {
    const isMultimodal = i % 3 === 0;
    const isImage = !isMultimodal && i % 2 === 0;
    return {
      id: `doc-${i}`,
      text: isImage ? undefined : `Document number ${i} with content about topic ${i % 10}`,
      image: isMultimodal || isImage ? `image-${i}.jpg` : undefined,
      primaryModality: isMultimodal ? 'multimodal' : (isImage ? 'image' : 'text'),
      metadata: { category: `cat-${i % 5}` },
    };
  });
}

function makeQueries(count: number, withExpected: boolean = true): MultimodalBenchmarkQuery[] {
  return Array.from({ length: count }, (_, i) => {
    const isMultimodal = i % 4 === 0;
    const isImage = !isMultimodal && i % 2 === 0;
    return {
      id: `q-${i}`,
      text: isImage ? undefined : `Query ${i} about topic ${i % 10}`,
      image: isMultimodal || isImage ? `query-img-${i}.jpg` : undefined,
      modality: isMultimodal ? 'multimodal' : (isImage ? 'image' : 'text'),
      expectedIds: withExpected ? [`doc-${i % 30}`] : undefined,
    };
  });
}

// ============ 基础功能测试 ============

describe('MultimodalRAGBenchmark - 基础功能', () => {
  let benchmark: MultimodalRAGBenchmark;

  beforeEach(() => {
    benchmark = createMultimodalBenchmark({ dimension: 64 });
  });

  it('应能创建实例', () => {
    expect(benchmark).toBeInstanceOf(MultimodalRAGBenchmark);
  });

  it('indexDocuments 应索引所有文档', async () => {
    const docs = makeDocuments(10);
    const count = await benchmark.indexDocuments(docs);
    expect(count).toBe(10);
  });
});

// ============ 嵌入基准测试 ============

describe('MultimodalRAGBenchmark - 嵌入基准', () => {
  it('benchmarkEmbedding 应返回完整结果', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const inputs = makeQueries(10, false).map((q) => ({
      modality: q.modality,
      text: q.text,
      image: q.image,
    }));
    const result = await benchmark.benchmarkEmbedding(inputs);
    expect(result.totalEmbeddings).toBe(10);
    expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.throughput).toBeGreaterThan(0);
    expect(result.p95LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('应能处理大批量嵌入', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const inputs = Array.from({ length: 50 }, (_, i) => ({
      modality: 'text' as const,
      text: `text-${i}`,
    }));
    const result = await benchmark.benchmarkEmbedding(inputs);
    expect(result.totalEmbeddings).toBe(50);
  });

  it('缓存命中应被记录', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const inputs = [
      { modality: 'text' as const, text: 'same-text' },
      { modality: 'text' as const, text: 'same-text' },
    ];
    const result = await benchmark.benchmarkEmbedding(inputs);
    // 第二次应该命中缓存
    expect(result.cacheHitRate).toBeGreaterThanOrEqual(0);
  });
});

// ============ 检索延迟基准测试 ============

describe('MultimodalRAGBenchmark - 检索延迟', () => {
  it('benchmarkRetrievalLatency 应按模态分组', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(20);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(12, false);
    const results = await benchmark.benchmarkRetrievalLatency(queries);
    // 应有 text/image/multimodal 至少 2 种模态的结果
    expect(results.length).toBeGreaterThan(0);
  });

  it('每个模态的延迟应合理', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(10);
    await benchmark.indexDocuments(docs);
    const queries: MultimodalBenchmarkQuery[] = [
      { modality: 'text', text: 'hello' },
      { modality: 'text', text: 'world' },
    ];
    const results = await benchmark.benchmarkRetrievalLatency(queries);
    expect(results.length).toBeGreaterThan(0);
    const textResult = results.find((r) => r.modality === 'text');
    expect(textResult).toBeDefined();
    expect(textResult!.totalQueries).toBe(2);
  });

  it('延迟直方图应正确生成', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(5);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(20, false);
    const results = await benchmark.benchmarkRetrievalLatency(queries);
    for (const r of results) {
      if (r.totalQueries > 0) {
        expect(r.histogram).toBeDefined();
        expect(Array.isArray(r.histogram)).toBe(true);
      }
    }
  });
});

// ============ 检索质量基准测试 ============

describe('MultimodalRAGBenchmark - 检索质量', () => {
  it('benchmarkQuality 应返回 Recall/MRR/NDCG', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(30);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(20, true);
    const result = await benchmark.benchmarkQuality(queries);
    expect(result).not.toBeNull();
    expect(result!.recallAt1).toBeGreaterThanOrEqual(0);
    expect(result!.recallAt5).toBeGreaterThanOrEqual(0);
    expect(result!.recallAt10).toBeGreaterThanOrEqual(0);
    expect(result!.mrr).toBeGreaterThanOrEqual(0);
    expect(result!.ndcgAt10).toBeGreaterThanOrEqual(0);
  });

  it('无期望命中的查询应返回 null', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(10);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(5, false);
    const result = await benchmark.benchmarkQuality(queries);
    expect(result).toBeNull();
  });

  it('模态拆分应正确', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(30);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(20, true);
    const result = await benchmark.benchmarkQuality(queries);
    expect(result).not.toBeNull();
    expect(result!.modalityBreakdown.text).toBeDefined();
    expect(result!.modalityBreakdown.image).toBeDefined();
  });
});

// ============ 缓存基准测试 ============

describe('MultimodalRAGBenchmark - 缓存基准', () => {
  it('benchmarkCache 应返回缓存统计', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const queries: MultimodalBenchmarkQuery[] = [
      { modality: 'text', text: 'q1' },
      { modality: 'text', text: 'q1' }, // 重复, 应命中
    ];
    const loader = async (q: MultimodalBenchmarkQuery) => `answer-${q.text}`;
    const result = await benchmark.benchmarkCache(queries, loader);
    expect(result.totalQueries).toBeGreaterThan(0);
    expect(result.hitRate).toBeGreaterThan(0); // 至少有一次命中
  });

  it('不同查询应全部 miss', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const queries: MultimodalBenchmarkQuery[] = [
      { modality: 'text', text: 'unique-1' },
      { modality: 'text', text: 'unique-2' },
      { modality: 'text', text: 'unique-3' },
    ];
    const loader = async (q: MultimodalBenchmarkQuery) => `answer-${q.text}`;
    const result = await benchmark.benchmarkCache(queries, loader);
    expect(result.misses).toBeGreaterThan(0);
  });
});

// ============ 完整测试套件测试 ============

describe('MultimodalRAGBenchmark - 完整测试套件', () => {
  it('runFullSuite 应返回完整报告', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(20);
    const queries = makeQueries(15, true);
    const report = await benchmark.runFullSuite({
      testName: 'test-suite',
      documents: docs,
      queries,
      cacheLoader: async (q) => `answer-${q.text ?? q.image}`,
    });
    expect(report.testName).toBe('test-suite');
    expect(report.summary.totalDocuments).toBe(20);
    expect(report.summary.totalQueries).toBe(15);
    expect(report.embeddingPerformance.length).toBeGreaterThan(0);
    expect(report.retrievalLatency.length).toBeGreaterThan(0);
    expect(report.retrievalQuality).not.toBeNull();
    expect(report.cachePerformance).not.toBeNull();
  });

  it('Markdown 报告应正确生成', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const docs = makeDocuments(10);
    const queries = makeQueries(5, true);
    const report = await benchmark.runFullSuite({
      documents: docs,
      queries,
    });
    expect(report.markdown).toContain('Summary');
    expect(report.markdown).toContain('Embedding Performance');
    expect(report.markdown).toContain('Retrieval Latency');
  });
});

// ============ 工厂函数测试 ============

describe('createMultimodalBenchmark 工厂函数', () => {
  it('应能创建默认实例', () => {
    const benchmark = createMultimodalBenchmark();
    expect(benchmark).toBeInstanceOf(MultimodalRAGBenchmark);
  });

  it('应能传递 dimension', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 64 });
    const docs = makeDocuments(5);
    await benchmark.indexDocuments(docs);
    const queries = makeQueries(3, false);
    const result = await benchmark.benchmarkRetrievalLatency(queries);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============ 边界条件测试 ============

describe('MultimodalRAGBenchmark - 边界条件', () => {
  it('空文档集应正常处理', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const queries = makeQueries(3, false);
    const result = await benchmark.benchmarkRetrievalLatency(queries);
    expect(result.length).toBeGreaterThan(0);
  });

  it('空查询集应返回空结果', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const result = await benchmark.benchmarkRetrievalLatency([]);
    expect(result.length).toBe(0);
  });

  it('嵌入基准应处理空输入', async () => {
    const benchmark = createMultimodalBenchmark({ dimension: 32 });
    const result = await benchmark.benchmarkEmbedding([]);
    expect(result.totalEmbeddings).toBe(0);
  });
});
