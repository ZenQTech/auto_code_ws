/**
 * # ============================================================
 * # multimodalVectorIndex.test.ts - 图文混合向量索引单元测试
 * # ============================================================
 * # 覆盖范围:
 * #   1. 文档管理 (添加/获取/列表/删除/清空)
 * #   2. 跨模态检索 (文本/图像/多模态查询)
 * #   3. 模态权重与重排序
 * #   4. 元数据过滤
 * #   5. 阈值过滤
 * #   6. 统计信息
 * #   7. 事件订阅
 * #   8. 工厂函数
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MultimodalVectorIndex,
  createMultimodalIndex,
  type MultimodalDocument,
  type CrossModalSearchResult,
} from './multimodalVectorIndex';
import type { Modality } from './multimodalEmbedding';

// ============ 文档管理测试 ============

describe('MultimodalVectorIndex - 文档管理', () => {
  let index: MultimodalVectorIndex;

  beforeEach(() => {
    index = createMultimodalIndex({ dimension: 64 });
  });

  it('应能创建空索引', () => {
    expect(index).toBeInstanceOf(MultimodalVectorIndex);
    expect(index.listDocuments().length).toBe(0);
  });

  it('应能添加纯文本文档', async () => {
    const doc = await index.addDocument({
      text: 'hello world',
      primaryModality: 'text',
    });
    expect(doc.id).toBeDefined();
    expect(doc.text).toBe('hello world');
    expect(doc.isMultimodal).toBe(false);
    expect(doc.primaryModality).toBe('text');
    expect(doc.createdAt).toBeGreaterThan(0);
  });

  it('应能添加纯图像文档', async () => {
    const doc = await index.addDocument({
      image: 'image1.jpg',
      primaryModality: 'image',
    });
    expect(doc.id).toBeDefined();
    expect(doc.image).toBe('image1.jpg');
    expect(doc.isMultimodal).toBe(false);
  });

  it('应能添加多模态文档', async () => {
    const doc = await index.addDocument({
      text: 'cat',
      image: 'cat.png',
      primaryModality: 'multimodal',
    });
    expect(doc.isMultimodal).toBe(true);
  });

  it('应支持自定义文档 ID', async () => {
    const doc = await index.addDocument({
      id: 'custom-1',
      text: 'test',
      primaryModality: 'text',
    });
    expect(doc.id).toBe('custom-1');
    expect(index.getDocument('custom-1')).toBeDefined();
  });

  it('应支持元数据', async () => {
    const doc = await index.addDocument({
      text: 'test',
      primaryModality: 'text',
      metadata: { source: 'test', category: 'A' },
    });
    expect(doc.metadata?.source).toBe('test');
  });

  it('应能批量添加文档', async () => {
    const docs = await index.addDocuments([
      { text: 'a', primaryModality: 'text' },
      { text: 'b', primaryModality: 'text' },
      { image: 'img.jpg', primaryModality: 'image' },
    ]);
    expect(docs.length).toBe(3);
    expect(index.listDocuments().length).toBe(3);
  });

  it('无 text/image 应抛错', async () => {
    await expect(
      index.addDocument({ primaryModality: 'text' })
    ).rejects.toThrow();
  });

  it('getDocument 不存在应返回 undefined', () => {
    expect(index.getDocument('not-exists')).toBeUndefined();
  });

  it('listDocuments 应返回所有文档', async () => {
    await index.addDocuments([
      { text: 'a', primaryModality: 'text' },
      { text: 'b', primaryModality: 'text' },
    ]);
    const docs = index.listDocuments();
    expect(docs.length).toBe(2);
  });

  it('应能删除文档', async () => {
    const doc = await index.addDocument({
      text: 'temp',
      primaryModality: 'text',
    });
    expect(index.removeDocument(doc.id)).toBe(true);
    expect(index.getDocument(doc.id)).toBeUndefined();
  });

  it('删除不存在的文档应返回 false', () => {
    expect(index.removeDocument('not-exists')).toBe(false);
  });

  it('clear 应清空所有文档', async () => {
    await index.addDocuments([
      { text: 'a', primaryModality: 'text' },
      { text: 'b', primaryModality: 'text' },
    ]);
    index.clear();
    expect(index.listDocuments().length).toBe(0);
  });
});

// ============ 跨模态检索测试 ============

describe('MultimodalVectorIndex - 跨模态检索', () => {
  let index: MultimodalVectorIndex;

  beforeEach(async () => {
    index = createMultimodalIndex({ dimension: 64 });
    await index.addDocuments([
      { id: '1', text: 'red sports car', primaryModality: 'text' },
      { id: '2', text: 'blue ocean waves', primaryModality: 'text' },
      { id: '3', text: 'green forest trees', primaryModality: 'text' },
      { id: '4', image: 'red-car.jpg', primaryModality: 'image' },
      { id: '5', image: 'blue-ocean.jpg', primaryModality: 'image' },
      { id: '6', text: 'cat', image: 'cat.png', primaryModality: 'multimodal' },
    ]);
  });

  it('searchByText 应返回排序结果', async () => {
    const results = await index.searchByText('red vehicle');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('searchByImage 应返回结果', async () => {
    const results = await index.searchByImage('red-car.jpg');
    expect(results.length).toBeGreaterThan(0);
    // 第一个结果应该是 "red-car.jpg"
    expect(results[0]!.document.id).toBe('4');
  });

  it('searchByMultimodal 应返回结果', async () => {
    const results = await index.searchByMultimodal('cat', 'cat.png');
    expect(results.length).toBeGreaterThan(0);
  });

  it('topK 应限制返回数', async () => {
    const results = await index.searchByText('something', { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('结果应包含文档元数据', async () => {
    const results = await index.searchByText('red');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.document.id).toBeDefined();
    expect(results[0]!.document.createdAt).toBeGreaterThan(0);
  });

  it('结果分数应在 [0, 1]', async () => {
    const results = await index.searchByText('red');
    results.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });

  it('结果应包含 breakdown', async () => {
    const results = await index.searchByText('red');
    expect(results.length).toBeGreaterThan(0);
    // fusedScore 应始终存在
    expect(results[0]!.breakdown.fusedScore).toBeDefined();
  });

  it('matchedModality 应正确识别', async () => {
    const results = await index.searchByText('red car');
    expect(results.length).toBeGreaterThan(0);
    // 应有匹配的模态
    results.forEach((r) => {
      expect(['text', 'image', 'multimodal']).toContain(r.matchedModality);
    });
  });
});

// ============ 模态权重测试 ============

describe('MultimodalVectorIndex - 模态权重', () => {
  let index: MultimodalVectorIndex;

  beforeEach(async () => {
    index = createMultimodalIndex({ dimension: 64 });
    await index.addDocuments([
      { id: 'text-1', text: 'apple fruit', primaryModality: 'text' },
      { id: 'image-1', image: 'apple.jpg', primaryModality: 'image' },
    ]);
  });

  it('同模态权重应高于跨模态', async () => {
    // 用 text 查询, text-1 是同模态, image-1 是跨模态
    const results = await index.searchByText('apple', {
      sameModalityWeight: 1.0,
      crossModalityWeight: 0.5,
    });
    expect(results.length).toBe(2);
    // 同模态文档应排名靠前
    const textIdx = results.findIndex((r) => r.document.id === 'text-1');
    const imageIdx = results.findIndex((r) => r.document.id === 'image-1');
    if (textIdx !== -1 && imageIdx !== -1) {
      expect(results[textIdx]!.score).toBeGreaterThanOrEqual(results[imageIdx]!.score);
    }
  });

  it('高跨模态权重应允许跨模态高分', async () => {
    const results = await index.searchByText('apple', {
      sameModalityWeight: 1.0,
      crossModalityWeight: 1.0,
    });
    expect(results.length).toBe(2);
  });

  it('minSimilarity 应过滤低分结果', async () => {
    const results = await index.searchByText('completely unrelated xyz', {
      minSimilarity: 0.5,
    });
    // 全部被过滤
    expect(results.length).toBe(0);
  });

  it('fuseScores=false 应只使用融合分数', async () => {
    const results = await index.searchByText('apple', {
      fuseScores: false,
    });
    expect(results.length).toBe(2);
    // 所有结果都应有 fusedScore
    results.forEach((r) => {
      expect(r.breakdown.fusedScore).toBeDefined();
    });
  });
});

// ============ 元数据过滤测试 ============

describe('MultimodalVectorIndex - 元数据过滤', () => {
  let index: MultimodalVectorIndex;

  beforeEach(async () => {
    index = createMultimodalIndex({ dimension: 64 });
    await index.addDocuments([
      { id: '1', text: 'doc1', primaryModality: 'text', metadata: { category: 'A' } },
      { id: '2', text: 'doc2', primaryModality: 'text', metadata: { category: 'B' } },
      { id: '3', text: 'doc3', primaryModality: 'text', metadata: { category: 'A', priority: 1 } },
    ]);
  });

  it('应按元数据过滤', async () => {
    const results = await index.searchByText('doc', {
      metadataFilter: { category: 'A' },
    });
    expect(results.length).toBe(2);
    results.forEach((r) => {
      expect(r.document.metadata?.category).toBe('A');
    });
  });

  it('多字段元数据过滤', async () => {
    const results = await index.searchByText('doc', {
      metadataFilter: { category: 'A', priority: 1 },
    });
    expect(results.length).toBe(1);
    expect(results[0]!.document.id).toBe('3');
  });

  it('无匹配元数据应返回空', async () => {
    const results = await index.searchByText('doc', {
      metadataFilter: { category: 'Z' },
    });
    expect(results.length).toBe(0);
  });
});

// ============ 统计测试 ============

describe('MultimodalVectorIndex - 统计', () => {
  it('初始统计应为零', () => {
    const index = createMultimodalIndex({ dimension: 32 });
    const stats = index.getStats();
    expect(stats.totalDocuments).toBe(0);
    expect(stats.textDocuments).toBe(0);
    expect(stats.imageDocuments).toBe(0);
    expect(stats.multimodalDocuments).toBe(0);
    expect(stats.dimension).toBe(32);
    expect(stats.totalSearches).toBe(0);
  });

  it('添加文档后统计应更新', async () => {
    const index = createMultimodalIndex({ dimension: 32 });
    await index.addDocument({ text: 'a', primaryModality: 'text' });
    await index.addDocument({ image: 'b.jpg', primaryModality: 'image' });
    await index.addDocument({ text: 'c', image: 'c.jpg', primaryModality: 'multimodal' });
    const stats = index.getStats();
    expect(stats.textDocuments).toBe(1);
    expect(stats.imageDocuments).toBe(1);
    expect(stats.multimodalDocuments).toBe(1);
  });

  it('检索后统计应更新', async () => {
    const index = createMultimodalIndex({ dimension: 32 });
    await index.addDocument({ text: 'test', primaryModality: 'text' });
    await index.searchByText('test');
    const stats = index.getStats();
    expect(stats.totalSearches).toBe(1);
    expect(stats.avgSearchTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('删除文档后统计应更新', async () => {
    const index = createMultimodalIndex({ dimension: 32 });
    const doc = await index.addDocument({ text: 'temp', primaryModality: 'text' });
    index.removeDocument(doc.id);
    const stats = index.getStats();
    expect(stats.textDocuments).toBe(0);
  });

  it('应正确计算内存估算', async () => {
    const index = createMultimodalIndex({ dimension: 32 });
    await index.addDocument({ text: 'hello', primaryModality: 'text' });
    const stats = index.getStats();
    expect(stats.memoryBytes).toBeGreaterThan(0);
  });
});

// ============ 事件测试 ============

describe('MultimodalVectorIndex - 事件', () => {
  let index: MultimodalVectorIndex;

  beforeEach(() => {
    index = createMultimodalIndex({ dimension: 32 });
  });

  it('应能订阅事件', () => {
    const listener = vi.fn();
    const unsub = index.subscribe(listener);
    expect(typeof unsub).toBe('function');
  });

  it('document-added 事件应被触发', async () => {
    const events: string[] = [];
    index.subscribe((e) => events.push(e.type));
    await index.addDocument({ text: 'a', primaryModality: 'text' });
    expect(events).toContain('document-added');
  });

  it('document-removed 事件应被触发', async () => {
    const doc = await index.addDocument({ text: 'a', primaryModality: 'text' });
    const events: string[] = [];
    index.subscribe((e) => events.push(e.type));
    index.removeDocument(doc.id);
    expect(events).toContain('document-removed');
  });

  it('cleared 事件应被触发', async () => {
    await index.addDocument({ text: 'a', primaryModality: 'text' });
    const events: string[] = [];
    index.subscribe((e) => events.push(e.type));
    index.clear();
    expect(events).toContain('cleared');
  });

  it('search-completed 事件应被触发', async () => {
    await index.addDocument({ text: 'a', primaryModality: 'text' });
    const events: any[] = [];
    index.subscribe((e) => {
      if (e.type === 'search-completed') events.push(e);
    });
    await index.searchByText('a');
    expect(events.length).toBe(1);
    expect(events[0].queryModality).toBe('text');
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('unsubscribe 应停止接收事件', async () => {
    const listener = vi.fn();
    const unsub = index.subscribe(listener);
    unsub();
    await index.addDocument({ text: 'a', primaryModality: 'text' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('事件回调抛错不应影响主流程', async () => {
    index.subscribe(() => {
      throw new Error('listener error');
    });
    await expect(
      index.addDocument({ text: 'a', primaryModality: 'text' })
    ).resolves.toBeDefined();
  });
});

// ============ 工厂函数测试 ============

describe('createMultimodalIndex 工厂函数', () => {
  it('应能创建默认实例', () => {
    const index = createMultimodalIndex();
    expect(index).toBeInstanceOf(MultimodalVectorIndex);
  });

  it('应能传递 dimension', () => {
    const index = createMultimodalIndex({ dimension: 128 });
    const stats = index.getStats();
    expect(stats.dimension).toBe(128);
  });

  it('应能传递 indexType', () => {
    const index = createMultimodalIndex({ indexType: 'flat' });
    const stats = index.getStats();
    expect(stats.indexType).toBe('flat');
  });

  it('应能传递自定义 embedding', async () => {
    const customEmb = new (await import('./multimodalEmbedding')).MultimodalEmbedding({ dimension: 32 });
    const index = createMultimodalIndex({ embedding: customEmb, dimension: 32 });
    expect(index).toBeInstanceOf(MultimodalVectorIndex);
  });
});

// ============ 端到端测试 ============

describe('MultimodalVectorIndex - 端到端', () => {
  it('完整多模态 RAG 工作流', async () => {
    const index = createMultimodalIndex({ dimension: 64 });

    // 1. 索引多模态知识库
    await index.addDocuments([
      { id: 'doc1', text: 'A red sports car parked in the garage', image: 'car1.jpg', primaryModality: 'multimodal' },
      { id: 'doc2', text: 'A blue ocean with waves', image: 'ocean1.jpg', primaryModality: 'multimodal' },
      { id: 'doc3', text: 'A green forest with tall trees', image: 'forest1.jpg', primaryModality: 'multimodal' },
      { id: 'doc4', text: 'A cute cat sitting on a sofa', image: 'cat1.jpg', primaryModality: 'multimodal' },
    ]);

    // 2. 文本查询
    const textResults = await index.searchByText('vehicle', { topK: 2 });
    expect(textResults.length).toBeGreaterThan(0);
    expect(textResults[0]!.document.id).toBe('doc1');

    // 3. 图像查询
    const imageResults = await index.searchByImage('cat1.jpg', { topK: 2 });
    expect(imageResults.length).toBeGreaterThan(0);

    // 4. 多模态查询
    const multiResults = await index.searchByMultimodal('ocean', 'ocean1.jpg', { topK: 1 });
    expect(multiResults[0]!.document.id).toBe('doc2');
  });

  it('大数据集检索性能', async () => {
    const index = createMultimodalIndex({ dimension: 64, indexType: 'flat' });
    const docs = Array.from({ length: 50 }, (_, i) => ({
      id: `d${i}`,
      text: `document number ${i} with content ${Math.random()}`,
      primaryModality: 'text' as Modality,
    }));
    await index.addDocuments(docs);
    const start = Date.now();
    const results = await index.searchByText('document', { topK: 5 });
    const elapsed = Date.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ============ 清理 ============

afterEach(() => {
  vi.clearAllMocks();
});
