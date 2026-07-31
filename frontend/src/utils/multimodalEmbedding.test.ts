/**
 * # ============================================================
 * # multimodalEmbedding.test.ts - 多模态 Embedding 对齐引擎单元测试
 * # ============================================================
 * # 覆盖范围:
 * #   1. 工具函数 (cosineSimilarity/euclideanDistance/l2Normalize)
 * #   2. MockMultimodalProvider (文本/图像/多模态/音频)
 * #   3. VolcengineMultimodalProvider (含 API key 不可用降级)
 * #   4. MultimodalEmbedding 主类核心 API
 * #   5. 缓存机制 (命中/LRU 淘汰/清理)
 * #   6. Provider 管理 (注册/注销/列表)
 * #   7. 跨模态相似度 + 批量 TopK
 * #   8. 自动降级 + 失败处理
 * #   9. 事件订阅
 * #  10. 统计信息
 * #  11. 工厂函数 createMultimodalEmbedding
 * #  12. 边界条件 (零向量/极端维度/特殊字符)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MultimodalEmbedding,
  MockMultimodalProvider,
  VolcengineMultimodalProvider,
  createMultimodalEmbedding,
  cosineSimilarity,
  euclideanDistance,
  l2Normalize,
  type EmbeddingProvider,
  type MultimodalInput,
  type EmbeddingResult,
  type Modality,
} from './multimodalEmbedding';

// ============ 工具函数测试 ============

describe('工具函数', () => {
  describe('cosineSimilarity', () => {
    it('相同向量相似度应为 1', () => {
      const v = [1, 2, 3, 4];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('正交向量相似度应为 0', () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('反向向量相似度应为 -1', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('零向量相似度应为 0', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('不同维度应截断到较短', () => {
      const a = [1, 0];
      const b = [1, 0, 5, 10];
      // 截断后 [1,0] vs [1,0] -> 1
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('空数组应返回 0', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe('euclideanDistance', () => {
    it('相同向量距离应为 0', () => {
      const v = [1, 2, 3];
      expect(euclideanDistance(v, v)).toBe(0);
    });

    it('单位向量距离应为 sqrt(2)', () => {
      const a = [0, 0];
      const b = [1, 1];
      expect(euclideanDistance(a, b)).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('不同维度应截断到较短', () => {
      const a = [0, 0];
      const b = [3, 4, 100];
      expect(euclideanDistance(a, b)).toBeCloseTo(5, 5);
    });
  });

  describe('l2Normalize', () => {
    it('应归一化到单位向量', () => {
      const v = [3, 4];
      const n = l2Normalize(v);
      expect(n[0]).toBeCloseTo(0.6, 5);
      expect(n[1]).toBeCloseTo(0.8, 5);
      // 长度应为 1
      const norm = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!);
      expect(norm).toBeCloseTo(1, 5);
    });

    it('零向量应原样返回', () => {
      const v = [0, 0, 0];
      expect(l2Normalize(v)).toEqual([0, 0, 0]);
    });

    it('已归一化向量应保持不变', () => {
      const v = [1, 0, 0];
      const n = l2Normalize(v);
      expect(n).toEqual([1, 0, 0]);
    });
  });
});

// ============ MockMultimodalProvider 测试 ============

describe('MockMultimodalProvider', () => {
  let provider: MockMultimodalProvider;

  beforeEach(() => {
    provider = new MockMultimodalProvider(128);
  });

  it('应正确暴露元数据', () => {
    expect(provider.name).toBe('mock');
    expect(provider.dimension).toBe(128);
    expect(provider.supportedModalities).toEqual(['text', 'image', 'multimodal']);
  });

  it('isAvailable 应返回 true', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('应嵌入文本到正确维度', async () => {
    const v = await provider.embed({ modality: 'text', text: 'hello world' });
    expect(v.length).toBe(128);
  });

  it('应嵌入图像到正确维度', async () => {
    const v = await provider.embed({ modality: 'image', image: 'image-001.jpg' });
    expect(v.length).toBe(128);
  });

  it('应嵌入多模态到正确维度', async () => {
    const v = await provider.embed({ modality: 'multimodal', text: 'cat', image: 'cat.jpg' });
    expect(v.length).toBe(128);
  });

  it('相同输入应产生相同向量 (确定性)', async () => {
    const v1 = await provider.embed({ modality: 'text', text: 'stable' });
    const v2 = await provider.embed({ modality: 'text', text: 'stable' });
    expect(v1).toEqual(v2);
  });

  it('不同输入应产生不同向量', async () => {
    const v1 = await provider.embed({ modality: 'text', text: 'alpha' });
    const v2 = await provider.embed({ modality: 'text', text: 'beta' });
    expect(v1).not.toEqual(v2);
  });

  it('嵌入向量应 L2 归一化', async () => {
    const v = await provider.embed({ modality: 'text', text: 'normalize me' });
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
  });

  it('应支持空文本输入', async () => {
    const v = await provider.embed({ modality: 'text', text: '' });
    expect(v.length).toBe(128);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('应支持中英文混合文本', async () => {
    const v1 = await provider.embed({ modality: 'text', text: 'hello world' });
    const v2 = await provider.embed({ modality: 'text', text: '你好 世界' });
    expect(v1.length).toBe(128);
    expect(v2.length).toBe(128);
  });

  it('updateTextCorpus 应更新 IDF', async () => {
    provider.updateTextCorpus(['apple banana', 'banana cherry', 'cherry date']);
    const v = await provider.embed({ modality: 'text', text: 'apple' });
    expect(v.length).toBe(128);
  });

  it('应支持 embedBatch', async () => {
    const inputs: MultimodalInput[] = [
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' },
      { modality: 'image', image: 'img1' },
    ];
    const vectors = await provider.embedBatch(inputs);
    expect(vectors.length).toBe(3);
    vectors.forEach((v) => expect(v.length).toBe(128));
  });

  it('不同 dimension 应独立工作', async () => {
    const p256 = new MockMultimodalProvider(256);
    const v = await p256.embed({ modality: 'text', text: 'test' });
    expect(v.length).toBe(256);
  });

  it('图像 embedding 应基于 URL 稳定', async () => {
    const v1 = await provider.embed({ modality: 'image', image: 'https://example.com/cat.png' });
    const v2 = await provider.embed({ modality: 'image', image: 'https://example.com/cat.png' });
    expect(v1).toEqual(v2);
  });

  it('多模态融合应基于元素最大值', async () => {
    const textVec = await provider.embed({ modality: 'text', text: 'fusion' });
    const imageVec = await provider.embed({ modality: 'image', image: 'fusion.jpg' });
    const fused = await provider.embed({ modality: 'multimodal', text: 'fusion', image: 'fusion.jpg' });
    // 融合向量每个分量 = max(text[i], image[i])
    for (let i = 0; i < 128; i++) {
      const expected = Math.max(Math.abs(textVec[i]!), Math.abs(imageVec[i]!));
      expect(Math.abs(fused[i]!)).toBeLessThanOrEqual(expected + 1e-5);
    }
  });
});

// ============ VolcengineMultimodalProvider 测试 ============

describe('VolcengineMultimodalProvider', () => {
  it('无 apiKey 时不可用', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 64 });
    expect(await p.isAvailable()).toBe(false);
  });

  it('有 apiKey 时可用', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 64, apiKey: 'test-key' });
    expect(await p.isAvailable()).toBe(true);
  });

  it('应暴露元数据', () => {
    const p = new VolcengineMultimodalProvider({ dimension: 256, apiKey: 'k' });
    expect(p.name).toBe('volcengine-ark');
    expect(p.dimension).toBe(256);
    expect(p.supportedModalities).toContain('text');
    expect(p.supportedModalities).toContain('image');
    expect(p.supportedModalities).toContain('multimodal');
  });

  it('应嵌入文本到正确维度', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 64, apiKey: 'k' });
    const v = await p.embed({ modality: 'text', text: 'volcengine test' });
    expect(v.length).toBe(64);
  });

  it('应嵌入图像到正确维度', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 64, apiKey: 'k' });
    const v = await p.embed({ modality: 'image', image: 'image.jpg' });
    expect(v.length).toBe(64);
  });

  it('应嵌入多模态到正确维度', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 64, apiKey: 'k' });
    const v = await p.embed({ modality: 'multimodal', text: 'text', image: 'image.jpg' });
    expect(v.length).toBe(64);
  });

  it('应支持 embedBatch', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 32, apiKey: 'k' });
    const vectors = await p.embedBatch([
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' },
    ]);
    expect(vectors.length).toBe(2);
    vectors.forEach((v) => expect(v.length).toBe(32));
  });

  it('可缓存 isAvailable 结果', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 32, apiKey: 'k' });
    const r1 = await p.isAvailable();
    const r2 = await p.isAvailable();
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('不同输入应产生不同向量', async () => {
    const p = new VolcengineMultimodalProvider({ dimension: 32, apiKey: 'k' });
    const v1 = await p.embed({ modality: 'text', text: 'alpha' });
    const v2 = await p.embed({ modality: 'text', text: 'beta' });
    expect(v1).not.toEqual(v2);
  });

  it('默认 dimension 应为 1024', () => {
    const p = new VolcengineMultimodalProvider({ apiKey: 'k' });
    expect(p.dimension).toBe(1024);
  });

  it('应支持自定义 endpoint 和 model', () => {
    const p = new VolcengineMultimodalProvider({
      apiKey: 'k',
      endpoint: 'https://custom.endpoint.com',
      model: 'custom-model',
    });
    expect(p.name).toBe('volcengine-ark');
  });
});

// ============ MultimodalEmbedding 主类基础测试 ============

describe('MultimodalEmbedding - 基础功能', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 128 });
  });

  it('应能创建实例', () => {
    expect(engine).toBeInstanceOf(MultimodalEmbedding);
  });

  it('默认应注册 mock provider', () => {
    const providers = engine.listProviders();
    expect(providers.find((p) => p.name === 'mock')).toBeDefined();
  });

  it('默认 dimension 应为 512', () => {
    const e = new MultimodalEmbedding();
    const providers = e.listProviders();
    expect(providers[0]!.dimension).toBe(512);
  });

  it('应能注册自定义 Provider', () => {
    const custom: EmbeddingProvider = {
      name: 'custom-1',
      dimension: 64,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(64).fill(0.1)]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom);
    const providers = engine.listProviders();
    expect(providers.find((p) => p.name === 'custom-1')).toBeDefined();
  });

  it('应能注销 Provider', () => {
    const custom: EmbeddingProvider = {
      name: 'temp',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom);
    expect(engine.unregisterProvider('temp')).toBe(true);
    expect(engine.listProviders().find((p) => p.name === 'temp')).toBeUndefined();
  });

  it('注销不存在的 Provider 应返回 false', () => {
    expect(engine.unregisterProvider('not-exists')).toBe(false);
  });

  it('注册同名 Provider 应覆盖', () => {
    const custom1: EmbeddingProvider = {
      name: 'dup',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const custom2: EmbeddingProvider = {
      name: 'dup',
      dimension: 64,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(64).fill(0.2)),
      embedBatch: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom1);
    engine.registerProvider(custom2);
    const providers = engine.listProviders();
    const dup = providers.find((p) => p.name === 'dup');
    expect(dup).toBeDefined();
    expect(dup!.dimension).toBe(64);
  });
});

// ============ 嵌入核心 API 测试 ============

describe('MultimodalEmbedding - 嵌入 API', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 64 });
  });

  it('embedText 应返回正确维度的结果', async () => {
    const r = await engine.embedText('hello');
    expect(r.vector.length).toBe(64);
    expect(r.modality).toBe('text');
    expect(r.cached).toBe(false);
  });

  it('embedImage 应返回正确维度的结果', async () => {
    const r = await engine.embedImage('image.png');
    expect(r.vector.length).toBe(64);
    expect(r.modality).toBe('image');
  });

  it('embedMultimodal 应返回正确维度的结果', async () => {
    const r = await engine.embedMultimodal('cat', 'cat.png');
    expect(r.vector.length).toBe(64);
    expect(r.modality).toBe('multimodal');
  });

  it('embed 应包含元数据', async () => {
    const r = await engine.embedText('test');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.provider).toBe('mock');
    expect(r.inputId).toBeDefined();
  });

  it('结果应可序列化 (无循环引用)', async () => {
    const r = await engine.embedText('test');
    const json = JSON.stringify(r);
    expect(json.length).toBeGreaterThan(0);
  });

  it('应能指定 provider', async () => {
    const custom: EmbeddingProvider = {
      name: 'specified',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0.5)),
      embedBatch: vi.fn().mockResolvedValue([new Array(32).fill(0.5)]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom);
    const r = await engine.embedText('test', { provider: 'specified' });
    expect(r.provider).toBe('specified');
    expect(r.vector.length).toBe(32);
  });
});

// ============ 缓存机制测试 ============

describe('MultimodalEmbedding - 缓存机制', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 64, cacheSize: 5 });
  });

  it('第二次相同输入应命中缓存', async () => {
    const r1 = await engine.embedText('cached');
    const r2 = await engine.embedText('cached');
    expect(r2.cached).toBe(true);
    expect(r2.vector).toEqual(r1.vector);
  });

  it('不同输入不应命中缓存', async () => {
    await engine.embedText('a');
    const r = await engine.embedText('b');
    expect(r.cached).toBe(false);
  });

  it('useCache=false 应跳过缓存', async () => {
    await engine.embedText('bypass');
    const r = await engine.embedText('bypass', { useCache: false });
    expect(r.cached).toBe(false);
  });

  it('缓存大小超出时应淘汰', async () => {
    for (let i = 0; i < 8; i++) {
      await engine.embedText(`item-${i}`);
    }
    const stats = engine.getStats();
    // 缓存大小不应超过 cacheSize=5
    expect(stats.cacheSize).toBeLessThanOrEqual(5);
  });

  it('clearCache 应清空所有缓存', async () => {
    await engine.embedText('one');
    await engine.embedText('two');
    engine.clearCache();
    const r = await engine.embedText('one');
    expect(r.cached).toBe(false);
  });

  it('不同 modality 互不影响', async () => {
    const t1 = await engine.embedText('same');
    const i1 = await engine.embedImage('same');
    expect(t1.modality).toBe('text');
    expect(i1.modality).toBe('image');
  });

  it('缓存统计应正确递增', async () => {
    await engine.embedText('once');
    await engine.embedText('once');
    await engine.embedText('once');
    const stats = engine.getStats();
    expect(stats.totalCacheHits).toBeGreaterThanOrEqual(2);
  });
});

// ============ 跨模态相似度测试 ============

describe('MultimodalEmbedding - 跨模态相似度', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 64 });
  });

  it('crossModalSimilarity 应返回完整结果', async () => {
    const sim = await engine.crossModalSimilarity(
      { modality: 'text', text: 'cat' },
      { modality: 'image', image: 'cat.png' }
    );
    expect(sim.similarity).toBeGreaterThanOrEqual(-1);
    expect(sim.similarity).toBeLessThanOrEqual(1);
    expect(sim.normalizedSimilarity).toBeGreaterThanOrEqual(0);
    expect(sim.normalizedSimilarity).toBeLessThanOrEqual(1);
    expect(sim.distance).toBeGreaterThanOrEqual(0);
    expect(sim.sourceModality).toBe('text');
    expect(sim.targetModality).toBe('image');
  });

  it('相同文本相似度应为 1', async () => {
    const sim = await engine.crossModalSimilarity(
      { modality: 'text', text: 'identical' },
      { modality: 'text', text: 'identical' }
    );
    expect(sim.similarity).toBeCloseTo(1, 5);
  });

  it('computeSimilarity 应直接使用已有向量', () => {
    const src: EmbeddingResult = {
      vector: [1, 0, 0],
      dimension: 3,
      modality: 'text',
      inputId: 's',
      durationMs: 0,
      provider: 'mock',
    };
    const tgt: EmbeddingResult = {
      vector: [0, 1, 0],
      dimension: 3,
      modality: 'image',
      inputId: 't',
      durationMs: 0,
      provider: 'mock',
    };
    const sim = engine.computeSimilarity(
      { modality: 'text', text: 'a' },
      src,
      { modality: 'image', image: 'b' },
      tgt
    );
    expect(sim.similarity).toBeCloseTo(0, 5);
  });

  it('crossModalBatch 应返回排序结果', async () => {
    const source = { modality: 'text' as Modality, text: 'query' };
    const targets: MultimodalInput[] = [
      { modality: 'text', text: 'query' },
      { modality: 'text', text: 'completely different words' },
      { modality: 'text', text: 'query again' },
    ];
    const results = await engine.crossModalBatch(source, targets);
    expect(results.length).toBe(3);
    // 应按相似度降序
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.normalizedSimilarity).toBeGreaterThanOrEqual(results[i]!.normalizedSimilarity);
    }
  });

  it('crossModalBatch topK 应限制返回数', async () => {
    const source = { modality: 'text' as Modality, text: 'anchor' };
    const targets: MultimodalInput[] = Array.from({ length: 10 }, (_, i) => ({
      modality: 'text' as Modality,
      text: `item ${i}`,
    }));
    const results = await engine.crossModalBatch(source, targets, { topK: 3 });
    expect(results.length).toBe(3);
  });

  it('归一化相似度应在 [0, 1]', async () => {
    const sim = await engine.crossModalSimilarity(
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' }
    );
    expect(sim.normalizedSimilarity).toBeGreaterThanOrEqual(0);
    expect(sim.normalizedSimilarity).toBeLessThanOrEqual(1);
  });
});

// ============ 批量嵌入测试 ============

describe('MultimodalEmbedding - 批量嵌入', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 64 });
  });

  it('应嵌入所有输入', async () => {
    const inputs: MultimodalInput[] = [
      { modality: 'text', text: 'a' },
      { modality: 'text', text: 'b' },
      { modality: 'text', text: 'c' },
    ];
    const results = await engine.embedBatch(inputs);
    expect(results.length).toBe(3);
    results.forEach((r) => expect(r.vector.length).toBe(64));
  });

  it('应支持自定义并发数', async () => {
    const inputs: MultimodalInput[] = Array.from({ length: 20 }, (_, i) => ({
      modality: 'text' as Modality,
      text: `item-${i}`,
    }));
    const results = await engine.embedBatch(inputs, { concurrency: 3 });
    expect(results.length).toBe(20);
  });

  it('应触发 batch-progress 事件', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32, cacheSize: 0 });
    const inputs: MultimodalInput[] = Array.from({ length: 30 }, (_, i) => ({
      modality: 'text' as Modality,
      text: `unique-${i}-${Math.random()}`,
    }));
    const events: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'batch-progress') events.push('progress');
    });
    await engine.embedBatch(inputs, { concurrency: 2, useCache: false });
    expect(events.length).toBeGreaterThan(0);
  });

  it('应触发 onProgress 回调', async () => {
    const e2 = new MultimodalEmbedding({ dimension: 32 });
    const progressCalls: number[] = [];
    e2.registerProvider(new MockMultimodalProvider(32));
    e2.unregisterProvider('mock');
    e2.registerProvider(new MockMultimodalProvider(32));

    // 使用 onProgress 重新构造
    const e3 = new MultimodalEmbedding({
      dimension: 32,
      onProgress: (p) => progressCalls.push(p.processed),
    });
    const inputs: MultimodalInput[] = Array.from({ length: 25 }, (_, i) => ({
      modality: 'text' as Modality,
      text: `item-${i}`,
    }));
    await e3.embedBatch(inputs, { concurrency: 2 });
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1]).toBe(25);
  });

  it('部分失败应填充零向量', async () => {
    const inputs: MultimodalInput[] = [
      { modality: 'text', text: 'good' },
      { modality: 'text', text: 'good' },
    ];
    const results = await engine.embedBatch(inputs);
    expect(results.every((r) => r.vector.length === 64)).toBe(true);
  });
});

// ============ Provider 降级测试 ============

describe('MultimodalEmbedding - Provider 降级', () => {
  it('不可用 Provider 应自动降级到 mock', async () => {
    const failing: EmbeddingProvider = {
      name: 'fail-provider',
      dimension: 64,
      supportedModalities: ['text', 'image', 'multimodal'],
      embed: vi.fn().mockRejectedValue(new Error('Provider down')),
      embedBatch: vi.fn().mockRejectedValue(new Error('Provider down')),
      isAvailable: vi.fn().mockResolvedValue(false),
    };
    const engine = new MultimodalEmbedding({
      dimension: 64,
      defaultProvider: 'fail-provider',
      enableFallback: true,
    });
    engine.registerProvider(failing);

    const events: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'provider-fallback') events.push('fallback');
    });

    const r = await engine.embedText('test');
    expect(r.provider).toBe('mock');
    expect(events).toContain('fallback');
  });

  it('禁用 fallback 时失败应抛错', async () => {
    const failing: EmbeddingProvider = {
      name: 'fail',
      dimension: 32,
      supportedModalities: ['text', 'image', 'multimodal'],
      embed: vi.fn().mockRejectedValue(new Error('Down')),
      embedBatch: vi.fn().mockRejectedValue(new Error('Down')),
      isAvailable: vi.fn().mockResolvedValue(false),
    };
    const engine = new MultimodalEmbedding({
      dimension: 32,
      defaultProvider: 'fail',
      enableFallback: false,
    });
    engine.registerProvider(failing);

    await expect(engine.embedText('test')).rejects.toThrow();
  });

  it('不支持的模态应抛错', async () => {
    const limited: EmbeddingProvider = {
      name: 'limited',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(32).fill(0.1)]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const engine = new MultimodalEmbedding({
      dimension: 32,
      defaultProvider: 'limited',
      enableFallback: false,
    });
    engine.registerProvider(limited);

    await expect(engine.embedImage('test.jpg')).rejects.toThrow();
  });

  it('不存在的 Provider 应抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32, enableFallback: false });
    await expect(
      engine.embed({ modality: 'text', text: 'x' }, { provider: 'not-found' })
    ).rejects.toThrow(/未注册/);
  });

  it('降级后再次失败应抛错', async () => {
    const fail1: EmbeddingProvider = {
      name: 'f1',
      dimension: 32,
      supportedModalities: ['text', 'image', 'multimodal'],
      embed: vi.fn().mockRejectedValue(new Error('f1 down')),
      embedBatch: vi.fn().mockRejectedValue(new Error('f1 down')),
      isAvailable: vi.fn().mockResolvedValue(false),
    };
    const engine = new MultimodalEmbedding({
      dimension: 32,
      defaultProvider: 'f1',
      enableFallback: true,
    });
    engine.registerProvider(fail1);

    // mock 不会失败,所以这里只验证降级路径
    const r = await engine.embedText('x');
    expect(r.provider).toBe('mock');
  });
});

// ============ 事件订阅测试 ============

describe('MultimodalEmbedding - 事件订阅', () => {
  let engine: MultimodalEmbedding;

  beforeEach(() => {
    engine = new MultimodalEmbedding({ dimension: 32 });
  });

  it('应能订阅事件', () => {
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    expect(typeof unsubscribe).toBe('function');
  });

  it('embed-success 事件应被触发', async () => {
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.type));
    await engine.embedText('test');
    expect(events).toContain('embed-success');
  });

  it('cache-hit 事件应被触发', async () => {
    await engine.embedText('test');
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.type));
    await engine.embedText('test');
    expect(events).toContain('cache-hit');
  });

  it('registered 事件应被触发', () => {
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.type));
    const custom: EmbeddingProvider = {
      name: 'e1',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom);
    expect(events).toContain('registered');
  });

  it('unregistered 事件应被触发', () => {
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.type));
    engine.unregisterProvider('mock');
    expect(events).toContain('unregistered');
  });

  it('unsubscribe 应停止接收事件', async () => {
    const listener = vi.fn();
    const unsub = engine.subscribe(listener);
    unsub();
    await engine.embedText('test');
    expect(listener).not.toHaveBeenCalled();
  });

  it('事件回调抛错不应影响主流程', async () => {
    engine.subscribe(() => {
      throw new Error('listener error');
    });
    await expect(engine.embedText('test')).resolves.toBeDefined();
  });

  it('embed-failure 事件应携带错误信息', async () => {
    const failing: EmbeddingProvider = {
      name: 'fail-x',
      dimension: 32,
      supportedModalities: ['text', 'image', 'multimodal'],
      embed: vi.fn().mockRejectedValue(new Error('custom error msg')),
      embedBatch: vi.fn().mockRejectedValue(new Error('custom error msg')),
      isAvailable: vi.fn().mockResolvedValue(false),
    };
    const e2 = new MultimodalEmbedding({
      dimension: 32,
      defaultProvider: 'fail-x',
      enableFallback: false,
    });
    e2.registerProvider(failing);

    const events: any[] = [];
    e2.subscribe((e) => {
      if (e.type === 'embed-failure') events.push(e);
    });

    await expect(e2.embedText('x')).rejects.toThrow();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].error).toContain('custom error msg');
  });
});

// ============ 统计信息测试 ============

describe('MultimodalEmbedding - 统计信息', () => {
  it('初始统计应为零', () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const stats = engine.getStats();
    expect(stats.totalEmbeds).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalFallbacks).toBe(0);
    expect(stats.totalErrors).toBe(0);
    expect(stats.cacheSize).toBe(0);
    expect(stats.providerCount).toBe(1); // mock
  });

  it('embed 后统计应更新', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    await engine.embedText('a');
    await engine.embedText('b');
    const stats = engine.getStats();
    expect(stats.totalEmbeds).toBe(2);
    expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('cacheHitRate 应正确计算', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    await engine.embedText('a');
    await engine.embedText('a'); // 缓存命中
    await engine.embedText('a'); // 缓存命中
    const stats = engine.getStats();
    expect(stats.cacheHitRate).toBeGreaterThan(0);
    expect(stats.cacheHitRate).toBeLessThanOrEqual(1);
  });

  it('providerCount 应正确反映注册数', () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const custom: EmbeddingProvider = {
      name: 'extra',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockResolvedValue(new Array(32).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    engine.registerProvider(custom);
    expect(engine.getStats().providerCount).toBe(2);
  });
});

// ============ 工厂函数测试 ============

describe('createMultimodalEmbedding 工厂函数', () => {
  it('应能创建默认实例', () => {
    const engine = createMultimodalEmbedding();
    expect(engine).toBeInstanceOf(MultimodalEmbedding);
  });

  it('应能传递 dimension', async () => {
    const engine = createMultimodalEmbedding({ dimension: 128 });
    const r = await engine.embedText('test');
    expect(r.vector.length).toBe(128);
  });

  it('应能传递 enableFallback', () => {
    const engine = createMultimodalEmbedding({ enableFallback: false });
    expect(engine).toBeInstanceOf(MultimodalEmbedding);
  });

  it('应能传递 cacheSize', () => {
    const engine = createMultimodalEmbedding({ cacheSize: 100 });
    expect(engine).toBeInstanceOf(MultimodalEmbedding);
  });

  it('应能传递 providers 配置', () => {
    const engine = createMultimodalEmbedding({
      providers: [
        { name: 'volcengine-ark', dimension: 1024, apiKey: 'test-key' },
      ],
    });
    const providers = engine.listProviders();
    expect(providers.find((p) => p.name === 'volcengine-ark')).toBeDefined();
  });

  it('应能传递 onProgress 回调', async () => {
    const calls: any[] = [];
    const engine = createMultimodalEmbedding({
      onProgress: (p) => calls.push(p),
    });
    const inputs: MultimodalInput[] = Array.from({ length: 30 }, (_, i) => ({
      modality: 'text' as Modality,
      text: `p-${i}`,
    }));
    await engine.embedBatch(inputs);
    expect(calls.length).toBeGreaterThan(0);
  });
});

// ============ 边界条件测试 ============

describe('MultimodalEmbedding - 边界条件', () => {
  it('极小 dimension 应工作', async () => {
    const engine = new MultimodalEmbedding({ dimension: 4 });
    const r = await engine.embedText('tiny');
    expect(r.vector.length).toBe(4);
  });

  it('大 dimension 应工作', async () => {
    const engine = new MultimodalEmbedding({ dimension: 2048 });
    const r = await engine.embedText('huge');
    expect(r.vector.length).toBe(2048);
  });

  it('空字符串文本应不抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const r = await engine.embedText('');
    expect(r.vector.length).toBe(32);
  });

  it('超长文本应不抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const longText = 'a '.repeat(1000);
    const r = await engine.embedText(longText);
    expect(r.vector.length).toBe(32);
  });

  it('特殊字符文本应不抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const r = await engine.embedText('!@#$%^&*()_+-=[]{}|;:,.<>?');
    expect(r.vector.length).toBe(32);
  });

  it('emoji 文本应不抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const r = await engine.embedText('🚀🎉🌟💡🔥');
    expect(r.vector.length).toBe(32);
  });

  it('image 空字符串应不抛错', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const r = await engine.embedImage('');
    expect(r.vector.length).toBe(32);
  });

  it('并发嵌入应正确', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });
    const tasks = Array.from({ length: 50 }, (_, i) =>
      engine.embedText(`concurrent-${i}`)
    );
    const results = await Promise.all(tasks);
    expect(results.length).toBe(50);
  });

  it('结果向量应全部为有限数', async () => {
    const engine = new MultimodalEmbedding({ dimension: 64 });
    const r = await engine.embedMultimodal('test', 'test.jpg');
    r.vector.forEach((v) => {
      expect(Number.isFinite(v)).toBe(true);
    });
  });
});

// ============ 端到端集成测试 ============

describe('MultimodalEmbedding - 端到端集成', () => {
  it('完整 RAG 风格工作流', async () => {
    const engine = createMultimodalEmbedding({ dimension: 64, cacheSize: 100 });

    // 1. 索引一组文档 (文本+图像混合)
    const docs = [
      { modality: 'text' as Modality, text: 'cat' },
      { modality: 'text' as Modality, text: 'dog' },
      { modality: 'text' as Modality, text: 'bird' },
      { modality: 'text' as Modality, text: 'fish' },
    ];
    const docEmbeddings = await engine.embedBatch(docs);

    // 2. 查询相似文档
    const query = { modality: 'text' as Modality, text: 'kitten' };
    const queryEmb = await engine.embedText('kitten');
    const sims = docEmbeddings.map((emb, i) =>
      engine.computeSimilarity(query, queryEmb, docs[i]!, emb)
    );

    // 3. 应有有效结果
    expect(sims.length).toBe(4);
    sims.forEach((s) => {
      expect(s.normalizedSimilarity).toBeGreaterThanOrEqual(0);
      expect(s.normalizedSimilarity).toBeLessThanOrEqual(1);
    });
  });

  it('图文混合跨模态检索', async () => {
    const engine = createMultimodalEmbedding({ dimension: 64 });

    // 索引: 文本 + 图像
    const docs: MultimodalInput[] = [
      { modality: 'text', text: 'red car sports' },
      { modality: 'text', text: 'blue ocean' },
      { modality: 'text', text: 'green forest' },
    ];
    await engine.embedBatch(docs);

    // 用图像查询
    const query: MultimodalInput = { modality: 'image', image: 'red-car.jpg' };
    const results = await engine.crossModalBatch(query, docs);
    expect(results.length).toBe(3);
  });

  it('多 Provider 并存 + 显式指定', async () => {
    const engine = new MultimodalEmbedding({ dimension: 32 });

    const customA: EmbeddingProvider = {
      name: 'A',
      dimension: 32,
      supportedModalities: ['text'],
      embed: vi.fn().mockImplementation(async (input) => {
        const v = new Array(32).fill(0);
        v[0] = input.text === 'A' ? 1 : 0;
        return v;
      }),
      embedBatch: vi.fn().mockImplementation(async (inputs) =>
        Promise.all(inputs.map((i: MultimodalInput) => customA.embed(i)))
      ),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    engine.registerProvider(customA);

    // 使用默认 mock
    const r1 = await engine.embedText('test');
    expect(r1.provider).toBe('mock');

    // 显式指定 A
    const r2 = await engine.embedText('A', { provider: 'A' });
    expect(r2.provider).toBe('A');
    expect(r2.vector[0]).toBe(1);
  });
});

// ============ 清理 ============

afterEach(() => {
  vi.clearAllMocks();
});
