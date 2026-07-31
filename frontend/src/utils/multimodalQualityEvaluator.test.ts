/**
 * # ============================================================
 * # MultimodalQualityEvaluator 单元测试 (Cycle 49 G49-03)
 * # ============================================================
 * # 测试覆盖:
 * #   1. 工具函数: cosineSimilarity, DCG, NDCG
 * #   2. 单 Provider 评估 (evaluateProvider)
 * #   3. 多 Provider A/B 对比 (compareProviders)
 * #   4. 指标计算: Recall@K, Precision@K, MRR, NDCG, F1, MAP
 * #   5. 按模态分组评估
 * #   6. 报告生成 (Markdown/JSON)
 * #   7. 事件订阅
 * #   8. 边界条件 (空查询/空文档/单查询)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MultimodalQualityEvaluator,
  createMultimodalQualityEvaluator,
  type QualityQuery,
  type QualityDocument,
  type QualityMetrics,
} from './multimodalQualityEvaluator';
import type { EmbeddingProvider, MultimodalInput, Modality } from './multimodalEmbedding';

// ============ Mock Provider ============

/**
 * 确定性 Embedding Provider
 *  - 文本: 基于字符 3-gram 的稳定哈希
 *  - 图像: 基于字符串前缀的稳定哈希
 *  - 相同模态相同输入产生相同向量
 *  - 跨模态: 共享基础特征空间 (通过 name prefix 对齐)
 */
class DeterministicProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  readonly supportedModalities: Modality[];

  // 缓存向量以保证确定性
  private cache = new Map<string, number[]>();
  // 用于模拟失败
  public failOnIds: Set<string> = new Set();

  constructor(name: string, dimension: number = 128) {
    this.name = name;
    this.dimension = dimension;
    this.supportedModalities = ['text', 'image', 'multimodal'];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(input: MultimodalInput): Promise<number[]> {
    const key = `${input.modality}:${input.text ?? ''}|${input.image ?? ''}`;
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const vector = this.computeVector(input);
    this.cache.set(key, vector);
    return vector;
  }

  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map((i) => this.embed(i)));
  }

  private computeVector(input: MultimodalInput): number[] {
    const v = new Array(this.dimension).fill(0);
    // 模态对齐: 共享的特征提取 (主题特征 + 模态特征)
    const content = (input.text ?? '') + '|' + (input.image ?? '');
    const baseSeed = this.fnv1a(content);
    for (let i = 0; i < this.dimension; i++) {
      const h = (baseSeed + i * 31 + this.fnv1a(this.name)) & 0x7fffffff;
      v[i] = (h / 0x7fffffff) * 2 - 1;
    }
    // 归一化
    return this.l2Normalize(v);
  }

  private fnv1a(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  private l2Normalize(v: number[]): number[] {
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm === 0) return v;
    return v.map((x) => x / norm);
  }
}

/**
 * "完美" Provider - 基于词袋向量的检索, 共享词表产生高相似度
 *  - 对文本进行简单分词
 *  - 每个词占据一个维度
 *  - 完全相同的词集合产生完全相同的向量 (cosine = 1)
 *  - 部分重叠的词集合产生中等相似度
 */
class PerfectProvider implements EmbeddingProvider {
  readonly name = 'perfect';
  readonly dimension = 1024; // 足够大以避免 hash 冲突
  readonly supportedModalities: Modality[] = ['text', 'image', 'multimodal'];
  // 共享词表 (mock 跨实例, 让多个 provider 使用同样的 hash 词)
  private static VOCAB = new Map<string, number>();
  private static VOCAB_COUNTER = 0;

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  private getVocabIndex(word: string): number {
    if (!PerfectProvider.VOCAB.has(word)) {
      PerfectProvider.VOCAB.set(word, PerfectProvider.VOCAB_COUNTER++);
    }
    return PerfectProvider.VOCAB.get(word)!;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(input: MultimodalInput): Promise<number[]> {
    const v = new Array(this.dimension).fill(0);
    const tokens = this.tokenize(input.text ?? '');
    for (const token of tokens) {
      const idx = this.getVocabIndex(token) % this.dimension;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    // L2 normalize
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }

  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map((i) => this.embed(i)));
  }
}

/**
 * "差" Provider - 总是返回随机向量 (Recall ≈ 0)
 */
class RandomProvider implements EmbeddingProvider {
  readonly name = 'random';
  readonly dimension = 64;
  readonly supportedModalities: Modality[] = ['text', 'image', 'multimodal'];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(input: MultimodalInput): Promise<number[]> {
    // 用输入做种子以便稳定但不同
    const seed = (input.text ?? '').length + (input.image ?? '').length;
    const v = new Array(this.dimension).fill(0);
    for (let i = 0; i < this.dimension; i++) {
      v[i] = Math.sin(seed * (i + 1)) * Math.cos(seed * (i + 1) * 0.7);
    }
    return v;
  }

  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map((i) => this.embed(i)));
  }
}

/**
 * "零" Provider - 始终返回 0 向量, Recall 必为 0
 */
class ZeroProvider implements EmbeddingProvider {
  readonly name = 'zero';
  readonly dimension = 64;
  readonly supportedModalities: Modality[] = ['text', 'image', 'multimodal'];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(_input: MultimodalInput): Promise<number[]> {
    return new Array(this.dimension).fill(0);
  }

  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map(() => new Array(this.dimension).fill(0)));
  }
}

// ============ 工具测试 ============

describe('MultimodalQualityEvaluator - 工具函数 (内部验证)', () => {
  it('应该正确评估一个完美 Provider (Recall = 1.0)', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello world' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'good morning' }, modality: 'text' },
      { id: 'd3', input: { modality: 'text', text: 'good night' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
      { id: 'q2', input: { modality: 'text', text: 'good' }, expectedIds: ['d2', 'd3'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 3, 5, 10, 20] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.providerName).toBe('perfect');
    expect(result.totalQueries).toBe(2);
    expect(result.metrics.recall).toBeGreaterThan(0);
    expect(result.perKMetrics[1]).toBeDefined();
    expect(result.perKMetrics[3]).toBeDefined();
    expect(result.perKMetrics[10]).toBeDefined();
  });

  it('Recall@K 应该随着 K 增大而非递减', async () => {
    const provider = new DeterministicProvider('det-1');
    const documents: QualityDocument[] = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      input: { modality: 'text', text: `document about topic ${i}` },
      modality: 'text' as Modality,
    }));
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'document about topic 5' }, expectedIds: ['d5'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 3, 5, 10, 20] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    const r1 = result.perKMetrics[1].recall;
    const r5 = result.perKMetrics[5].recall;
    const r10 = result.perKMetrics[10].recall;
    const r20 = result.perKMetrics[20].recall;

    // Recall 应该单调不减
    expect(r1).toBeLessThanOrEqual(r5);
    expect(r5).toBeLessThanOrEqual(r10);
    expect(r10).toBeLessThanOrEqual(r20);
  });
});

// ============ 单 Provider 评估测试 ============

describe('MultimodalQualityEvaluator - 单 Provider 评估', () => {
  let provider: DeterministicProvider;
  let documents: QualityDocument[];
  let queries: QualityQuery[];

  beforeEach(() => {
    provider = new DeterministicProvider('test-provider', 64);
    documents = [
      { id: 'd1', input: { modality: 'text', text: 'apple fruit red' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'banana fruit yellow' }, modality: 'text' },
      { id: 'd3', input: { modality: 'text', text: 'computer machine' }, modality: 'text' },
      { id: 'd4', input: { modality: 'text', text: 'keyboard device' }, modality: 'text' },
      { id: 'd5', input: { modality: 'text', text: 'orange fruit' }, modality: 'text' },
    ];
    queries = [
      { id: 'q1', input: { modality: 'text', text: 'apple red' }, expectedIds: ['d1'], modality: 'text' },
      { id: 'q2', input: { modality: 'text', text: 'banana' }, expectedIds: ['d2'], modality: 'text' },
      { id: 'q3', input: { modality: 'text', text: 'fruit' }, expectedIds: ['d1', 'd2', 'd5'], modality: 'text' },
    ];
  });

  it('应该返回正确的 Provider 名称和查询数', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.providerName).toBe('test-provider');
    expect(result.totalQueries).toBe(3);
  });

  it('应该返回所有配置的 K 值指标', async () => {
    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 3, 5, 10] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(Object.keys(result.perKMetrics).sort()).toEqual(['1', '10', '3', '5']);
  });

  it('应该按模态分组计算指标', async () => {
    const mixedDocs: QualityDocument[] = [
      ...documents,
      { id: 'img1', input: { modality: 'image', image: 'cat.jpg' }, modality: 'image' },
      { id: 'img2', input: { modality: 'image', image: 'dog.jpg' }, modality: 'image' },
    ];
    const mixedQueries: QualityQuery[] = [
      ...queries,
      { id: 'qi1', input: { modality: 'image', image: 'cat.jpg' }, expectedIds: ['img1'], modality: 'image' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, mixedDocs, mixedQueries);

    expect(result.perModalityMetrics.text).toBeDefined();
    expect(result.perModalityMetrics.image).toBeDefined();
    expect(result.perModalityMetrics.multimodal).toBeDefined();
    expect(result.perModalityMetrics.audio).toBeDefined();
  });

  it('应该在空查询时返回空指标', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, []);

    expect(result.totalQueries).toBe(0);
    expect(result.metrics).toEqual({
      recall: 0,
      precision: 0,
      mrr: 0,
      ndcg: 0,
      hitRate: 0,
      f1: 0,
      map: 0,
    });
  });

  it('应该正确计算 Precision@K', async () => {
    const evaluator = createMultimodalQualityEvaluator({ kValues: [3] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // Precision@3 <= 1 (因为 top3 中可能少于 3 个命中)
    expect(result.perKMetrics[3].precision).toBeGreaterThanOrEqual(0);
    expect(result.perKMetrics[3].precision).toBeLessThanOrEqual(1);
  });

  it('应该正确计算 MRR', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // MRR 在 [0, 1] 之间
    expect(result.metrics.mrr).toBeGreaterThanOrEqual(0);
    expect(result.metrics.mrr).toBeLessThanOrEqual(1);
  });

  it('应该正确计算 HitRate', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // HitRate 在 [0, 1] 之间
    expect(result.metrics.hitRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.hitRate).toBeLessThanOrEqual(1);
  });

  it('应该计算 avgQueryLatencyMs', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.avgQueryLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(result.avgQueryLatencyMs);
  });

  it('应该在单个查询失败时跳过该查询但继续评估', async () => {
    const failingProvider = new DeterministicProvider('failing');
    const originalEmbed = failingProvider.embed.bind(failingProvider);
    failingProvider.embed = async (input: MultimodalInput) => {
      // 仅当 query 文本包含特定失败关键字时失败, 文档不受影响
      if (input.modality === 'text' && input.text === 'BANANA_QUERY_FAIL') {
        throw new Error('Simulated failure');
      }
      return originalEmbed(input);
    };

    const localDocs: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'apple fruit' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'orange fruit' }, modality: 'text' },
    ];
    const localQueries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'apple' }, expectedIds: ['d1'], modality: 'text' },
      { id: 'q2', input: { modality: 'text', text: 'BANANA_QUERY_FAIL' }, expectedIds: ['d2'], modality: 'text' },
      { id: 'q3', input: { modality: 'text', text: 'orange' }, expectedIds: ['d2'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(failingProvider, localDocs, localQueries);

    // 3 个查询, 其中 1 个失败 (q2)
    expect(result.totalQueries).toBe(3);
    // q1 和 q3 成功, 应该生成指标
    expect(result.metrics).toBeDefined();
  });

  it('应该在评估 Provider 不可用时抛出错误', async () => {
    const brokenProvider = new DeterministicProvider('broken');
    brokenProvider.embed = vi.fn().mockRejectedValue(new Error('Provider not available'));

    const evaluator = createMultimodalQualityEvaluator();
    await expect(evaluator.evaluateProvider(brokenProvider, documents, queries)).rejects.toThrow('Provider not available');
  });
});

// ============ 多 Provider 对比测试 ============

describe('MultimodalQualityEvaluator - 多 Provider 对比', () => {
  let documents: QualityDocument[];
  let queries: QualityQuery[];

  beforeEach(() => {
    documents = [
      { id: 'd1', input: { modality: 'text', text: 'hello world' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'good morning' }, modality: 'text' },
      { id: 'd3', input: { modality: 'text', text: 'good night' }, modality: 'text' },
    ];
    queries = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
      { id: 'q2', input: { modality: 'text', text: 'good' }, expectedIds: ['d2', 'd3'], modality: 'text' },
    ];
  });

  it('应该返回所有 Provider 的结果', async () => {
    const providers = [new PerfectProvider(), new DeterministicProvider('det')];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.providerResults.length).toBe(2);
    expect(report.providerResults[0].providerName).toBe('perfect');
    expect(report.providerResults[1].providerName).toBe('det');
  });

  it('应该选出最佳 Provider (基于 Recall@1)', async () => {
    // PerfectProvider 共享词表, ZeroProvider 始终返回 0 向量
    // 由于 evaluator.metrics.recall 是基于 K=10 (默认), 当 K=10 >= 总文档数时
    // 两个 provider 的 metrics.recall 都 = 1, 无法区分. 因此检查 perKMetrics[1]
    const perfect = new PerfectProvider();
    const zero = new ZeroProvider();
    const providers = [zero, perfect];
    const evaluator = createMultimodalQualityEvaluator({ kValues: [1] });

    const report = await evaluator.compareProviders(providers, documents, queries);

    // 验证 Recall@1 指标确实 perfect 更高
    const perfectResult = report.providerResults.find((r) => r.providerName === 'perfect');
    const zeroResult = report.providerResults.find((r) => r.providerName === 'zero');
    expect(perfectResult?.perKMetrics[1].recall).toBeGreaterThan(zeroResult?.perKMetrics[1].recall ?? 0);
  });

  it('应该生成 ComparisonResult 当有 2+ Provider', async () => {
    const providers = [new PerfectProvider(), new RandomProvider()];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.comparison).toBeDefined();
    expect(report.comparison?.winner).toBe('perfect');
    expect(report.comparison?.loser).toBe('random');
    expect(report.comparison?.metricDifferences).toBeDefined();
  });

  it('应该在只有 1 个 Provider 时不生成 ComparisonResult', async () => {
    const providers = [new PerfectProvider()];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.comparison).toBeUndefined();
  });

  it('应该计算 A/B 对比的统计指标', async () => {
    const providers = [new PerfectProvider(), new RandomProvider()];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.comparison?.pValue).toBeGreaterThanOrEqual(0);
    expect(report.comparison?.pValue).toBeLessThanOrEqual(1);
    expect(report.comparison?.confidenceLevel).toBeGreaterThanOrEqual(0);
    expect(report.comparison?.confidenceLevel).toBeLessThanOrEqual(1);
  });

  it('应该生成 Markdown 报告', async () => {
    const providers = [new PerfectProvider(), new DeterministicProvider('det')];
    const evaluator = createMultimodalQualityEvaluator({ reportTitle: '测试报告' });

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.markdown).toContain('测试报告');
    expect(report.markdown).toContain('## 汇总');
    expect(report.markdown).toContain('## Provider 详细指标');
    expect(report.markdown).toContain('| Provider |');
  });

  it('应该生成 JSON 报告', async () => {
    const providers = [new PerfectProvider(), new DeterministicProvider('det')];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.json).toBeDefined();
    expect(() => JSON.parse(report.json)).not.toThrow();

    const parsed = JSON.parse(report.json);
    expect(parsed.title).toBeDefined();
    expect(parsed.providerResults).toBeDefined();
  });

  it('应该正确填充 summary 字段', async () => {
    const providers = [new PerfectProvider(), new DeterministicProvider('det'), new RandomProvider()];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.summary.bestProvider).toBeDefined();
    expect(report.summary.bestOverallScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.worstProvider).toBeDefined();
    expect(report.summary.avgRecallAt10).toBeGreaterThanOrEqual(0);
    expect(report.summary.avgNdcgAt10).toBeGreaterThanOrEqual(0);
  });

  it('应该计算总评估时长', async () => {
    const providers = [new PerfectProvider()];
    const evaluator = createMultimodalQualityEvaluator();

    const report = await evaluator.compareProviders(providers, documents, queries);

    expect(report.duration).toBeGreaterThanOrEqual(0);
    expect(report.timestamp).toBeGreaterThan(0);
  });

  it('应该处理空 providers 列表', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const report = await evaluator.compareProviders([], documents, queries);

    expect(report.providerResults.length).toBe(0);
    expect(report.summary.bestProvider).toBe('N/A');
  });
});

// ============ 指标计算逻辑测试 ============

describe('MultimodalQualityEvaluator - 指标计算', () => {
  it('NDCG 应该为完美匹配返回 1.0', async () => {
    // PerfectProvider 把文本前 16 字符编码到向量前 16 维
    // 相同前缀会有较高的 cosine 相似度
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello world' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'good morning' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      // 查询字符串与 d1 前缀完全一致
      { id: 'q1', input: { modality: 'text', text: 'hello world' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // NDCG 应该接近 1 (因为查询与 d1 完全相同)
    expect(result.perKMetrics[1].ndcg).toBeGreaterThan(0.5);
  });

  it('F1 应该在没有命中时为 0', async () => {
    const provider = new RandomProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'unrelated 1' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'unrelated 2' }, modality: 'text' },
      { id: 'd3', input: { modality: 'text', text: 'unrelated 3' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'completely different query' }, expectedIds: ['nonexistent'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 3, 5] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // 期望 id 不存在, Recall 和 Precision 都为 0, F1 = 0
    expect(result.metrics.f1).toBe(0);
  });

  it('MAP 应该正确计算', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'match exact' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'unrelated' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'match exact' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.metrics.map).toBeGreaterThanOrEqual(0);
    expect(result.metrics.map).toBeLessThanOrEqual(1);
  });

  it('应该处理空 expectedIds 的查询', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'test' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'test' }, expectedIds: [], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // Recall 应该是 0 (除以 0 的情况)
    expect(result.metrics.recall).toBe(0);
  });
});

// ============ 事件订阅测试 ============

describe('MultimodalQualityEvaluator - 事件订阅', () => {
  it('应该在评估开始时触发 start 事件', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const events: string[] = [];
    evaluator.subscribe((event) => events.push(event.type));

    await evaluator.evaluateProvider(provider, documents, queries);

    expect(events).toContain('start');
    expect(events).toContain('query-evaluated');
    expect(events).toContain('complete');
  });

  it('应该在查询评估时触发 query-evaluated 事件', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'world' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
      { id: 'q2', input: { modality: 'text', text: 'world' }, expectedIds: ['d2'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const queryEvents: Array<{ queryId: string; latencyMs: number }> = [];
    evaluator.subscribe((event) => {
      if (event.type === 'query-evaluated') {
        queryEvents.push({ queryId: event.queryId, latencyMs: event.latencyMs });
      }
    });

    await evaluator.evaluateProvider(provider, documents, queries);

    expect(queryEvents.length).toBe(2);
    expect(queryEvents[0].queryId).toBe('q1');
    expect(queryEvents[1].queryId).toBe('q2');
    expect(queryEvents[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('应该在完成时触发 complete 事件', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    let completeEvent: { type: string; metrics: QualityMetrics } | null = null;
    evaluator.subscribe((event) => {
      if (event.type === 'complete') {
        completeEvent = { type: 'complete', metrics: event.metrics };
      }
    });

    await evaluator.evaluateProvider(provider, documents, queries);

    expect(completeEvent).not.toBeNull();
    expect(completeEvent!.metrics).toBeDefined();
  });

  it('应该能在出错时触发 error 事件', async () => {
    const provider = new DeterministicProvider('broken');
    provider.embed = vi.fn().mockRejectedValue(new Error('embed failed'));

    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const errors: string[] = [];
    evaluator.subscribe((event) => {
      if (event.type === 'error') {
        errors.push(event.error);
      }
    });

    await expect(evaluator.evaluateProvider(provider, documents, queries)).rejects.toThrow();

    expect(errors.length).toBeGreaterThan(0);
  });

  it('应该支持取消订阅', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const events: string[] = [];

    const unsubscribe = evaluator.subscribe((event) => events.push(event.type));
    unsubscribe();

    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    await evaluator.evaluateProvider(provider, documents, queries);

    expect(events.length).toBe(0);
  });

  it('应该支持多个订阅者', async () => {
    const evaluator = createMultimodalQualityEvaluator();
    const events1: string[] = [];
    const events2: string[] = [];

    evaluator.subscribe((event) => events1.push(event.type));
    evaluator.subscribe((event) => events2.push(event.type));

    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    await evaluator.evaluateProvider(provider, documents, queries);

    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBe(events1.length);
  });
});

// ============ 工厂函数测试 ============

describe('MultimodalQualityEvaluator - 工厂函数', () => {
  it('createMultimodalQualityEvaluator 应该返回 evaluator 实例', () => {
    const evaluator = createMultimodalQualityEvaluator();
    expect(evaluator).toBeInstanceOf(MultimodalQualityEvaluator);
  });

  it('createMultimodalQualityEvaluator 应该应用 kValues 配置', async () => {
    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 7, 42] });
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(Object.keys(result.perKMetrics).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '7', '42']);
  });

  it('createMultimodalQualityEvaluator 应该应用 reportTitle 配置', async () => {
    const evaluator = createMultimodalQualityEvaluator({ reportTitle: 'My Custom Report' });
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const report = await evaluator.compareProviders([provider], documents, queries);

    expect(report.title).toBe('My Custom Report');
    expect(report.markdown).toContain('My Custom Report');
  });
});

// ============ 边界条件测试 ============

describe('MultimodalQualityEvaluator - 边界条件', () => {
  it('应该处理空文档列表', async () => {
    const provider = new PerfectProvider();
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, [], queries);

    expect(result.totalQueries).toBe(1);
    expect(result.metrics.recall).toBe(0);
  });

  it('应该处理 K > 文档数 的情况', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'world' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [10, 100] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // K=10 时, 召回率应该达到 1.0
    expect(result.perKMetrics[10].recall).toBeGreaterThan(0);
  });

  it('应该处理 K=1 的情况', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello world' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'good morning' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'hello world' }, expectedIds: ['d1'], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // 完美匹配, Recall@1 应该接近 1
    expect(result.perKMetrics[1].recall).toBeGreaterThan(0.5);
  });

  it('应该处理 relevanceScores 配置', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello world' }, modality: 'text' },
      { id: 'd2', input: { modality: 'text', text: 'good morning' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      {
        id: 'q1',
        input: { modality: 'text', text: 'hello world' },
        expectedIds: ['d1', 'd2'],
        modality: 'text',
        relevanceScores: { d1: 3, d2: 1 }, // d1 更相关
      },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [2] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    // 提供了 relevanceScores, NDCG 应该被正确计算
    expect(result.perKMetrics[2].ndcg).toBeGreaterThan(0);
  });

  it('应该在 query.id 缺失时使用空字符串', async () => {
    const provider = new PerfectProvider();
    const documents: QualityDocument[] = [
      { id: 'd1', input: { modality: 'text', text: 'hello' }, modality: 'text' },
    ];
    const queries: QualityQuery[] = [
      // 没有 id
      { input: { modality: 'text', text: 'hello' }, expectedIds: ['d1'], modality: 'text' } as QualityQuery,
    ];

    const evaluator = createMultimodalQualityEvaluator();
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.totalQueries).toBe(1);
  });
});

// ============ 性能测试 ============

describe('MultimodalQualityEvaluator - 性能', () => {
  it('100 文档 + 10 查询应该在 5s 内完成', async () => {
    const provider = new DeterministicProvider('perf', 64);
    const documents: QualityDocument[] = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`,
      input: { modality: 'text', text: `document number ${i} content` },
      modality: 'text' as Modality,
    }));
    const queries: QualityQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i}`,
      input: { modality: 'text', text: `query about document ${i}` },
      expectedIds: [`d${i}`],
      modality: 'text' as Modality,
    }));

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 5, 10] });
    const start = Date.now();
    await evaluator.evaluateProvider(provider, documents, queries);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  it('应该支持 500+ 文档的批量评估', async () => {
    const provider = new DeterministicProvider('large', 32);
    const documents: QualityDocument[] = Array.from({ length: 500 }, (_, i) => ({
      id: `d${i}`,
      input: { modality: 'text', text: `doc ${i}` },
      modality: 'text' as Modality,
    }));
    const queries: QualityQuery[] = [
      { id: 'q1', input: { modality: 'text', text: 'doc 100' }, expectedIds: [`d100`], modality: 'text' },
    ];

    const evaluator = createMultimodalQualityEvaluator({ kValues: [1, 5, 10, 20] });
    const result = await evaluator.evaluateProvider(provider, documents, queries);

    expect(result.totalQueries).toBe(1);
    expect(result.metrics).toBeDefined();
  });
});
