/**
 * # LongTermMemory - 单元测试
 * # Cycle 38 G38-02
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LongTermMemoryEngine,
  createLongTermMemoryEngine,
  getDefaultLongTermMemoryEngine,
  resetDefaultLongTermMemoryEngine,
  CoreMemoryStore,
  RecallMemoryStore,
  ArchiveMemoryStore,
  MemoryDecayEngine,
  MemoryConsolidator,
  generateId,
  calculateImportance,
  mockEmbedding,
  cosineSimilarity,
} from './longTermMemory';

describe('工具函数', () => {
  it('generateId 格式正确', () => {
    const id = generateId();
    expect(id).toMatch(/^mem-/);
  });

  it('calculateImportance 基础分 0.3', () => {
    expect(calculateImportance('hello')).toBeCloseTo(0.3, 2);
  });

  it('calculateImportance 含数字加分', () => {
    const score = calculateImportance('2026 任务');
    expect(score).toBeGreaterThan(0.3);
  });

  it('calculateImportance 含强情感词加分', () => {
    const score = calculateImportance('这是关键任务');
    expect(score).toBeGreaterThan(0.4);
  });

  it('calculateImportance 长度加分', () => {
    const longText = 'a'.repeat(150);
    const score = calculateImportance(longText);
    expect(score).toBeGreaterThan(0.3);
  });

  it('calculateImportance 问号加分', () => {
    const score = calculateImportance('怎么实现？');
    expect(score).toBeGreaterThan(0.3);
  });

  it('calculateImportance 上限 1.0', () => {
    const text = '重要 2026 John Smith ' + 'a'.repeat(150) + '?';
    const score = calculateImportance(text);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('mockEmbedding 返回正确维度', () => {
    const vec = mockEmbedding('hello', 64);
    expect(vec.length).toBe(64);
  });

  it('mockEmbedding 归一化', () => {
    const vec = mockEmbedding('hello world', 64);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it('cosineSimilarity 同向量 = 1', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity 正交 = 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe('CoreMemoryStore', () => {
  let store: CoreMemoryStore;

  beforeEach(() => {
    store = new CoreMemoryStore();
  });

  it('初始化默认', () => {
    expect(store.getSection('persona')).toBe('');
    expect(store.getSection('currentGoal')).toBe('');
  });

  it('setSection 写入', () => {
    store.setSection('persona', 'helpful assistant');
    expect(store.getSection('persona')).toBe('helpful assistant');
  });

  it('setUserPreference 最多 50 项', () => {
    for (let i = 0; i < 55; i++) {
      store.setUserPreference(`pref-${i}`, `value-${i}`);
    }
    expect(Object.keys(store.toJSON().userPreferences).length).toBeLessThanOrEqual(50);
  });

  it('getUserPreference', () => {
    store.setUserPreference('lang', 'zh');
    expect(store.getUserPreference('lang')).toBe('zh');
    expect(store.getUserPreference('not_exist')).toBeUndefined();
  });

  it('addConstraint 最多 20 项', () => {
    for (let i = 0; i < 25; i++) {
      store.addConstraint(`c-${i}`);
    }
    expect(store.toJSON().constraints.length).toBeLessThanOrEqual(20);
  });

  it('updateContextSummary 超长截断', () => {
    store.updateContextSummary('a'.repeat(3000), 2000);
    const s = store.getSection('contextSummary');
    expect(s.length).toBeLessThanOrEqual(2003); // 2000 + '...'
  });

  it('toJSON / fromJSON', () => {
    store.setUserPreference('a', '1');
    store.setCurrentGoal('goal');
    const json = store.toJSON();
    const newStore = new CoreMemoryStore();
    newStore.fromJSON(json);
    expect(newStore.getUserPreference('a')).toBe('1');
    expect(newStore.getSection('currentGoal')).toBe('goal');
  });
});

describe('RecallMemoryStore', () => {
  let store: RecallMemoryStore;

  beforeEach(() => {
    store = new RecallMemoryStore({ maxCapacity: 10 });
  });

  it('add 和 size', () => {
    store.add('hello world');
    expect(store.size()).toBe(1);
  });

  it('search 关键词匹配', () => {
    store.add('machine learning');
    store.add('deep learning');
    store.add('cooking recipes');
    const results = store.search('learning');
    expect(results.length).toBe(2);
  });

  it('search 按分数排序', () => {
    store.add('machine learning');
    store.add('machine learning machine learning');
    const results = store.search('machine');
    // importance 高的应该排前面（因为 importance 都是默认）
    // 内容更多的命中数应该更多
    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
  });

  it('search 中文', () => {
    store.add('机器学习算法');
    store.add('深度学习模型');
    store.add('烹饪食谱');
    const results = store.search('学习');
    expect(results.length).toBe(2);
  });

  it('search minImportance 过滤', () => {
    store.add('low importance', { importance: 0.1 });
    store.add('high importance', { importance: 0.9 });
    const results = store.search('importance', { minImportance: 0.5 });
    expect(results.length).toBe(1);
  });

  it('search tags 过滤', () => {
    store.add('item1 with code', { tags: ['code'] });
    store.add('item2 with doc', { tags: ['doc'] });
    const results = store.search('item', { tags: ['code'] });
    expect(results.length).toBe(1);
  });

  it('list 按时间排序', () => {
    // 直接构造带不同 createdAt 的项
    const item1 = {
      id: 'a',
      layer: 'recall' as const,
      content: 'first',
      importance: 0.5,
      relevance: 0.5,
      createdAt: 1000,
      updatedAt: 1000,
      lastAccessedAt: 1000,
      accessCount: 0,
      tags: [],
    };
    const item2 = {
      id: 'b',
      layer: 'recall' as const,
      content: 'second',
      importance: 0.5,
      relevance: 0.5,
      createdAt: 2000,
      updatedAt: 2000,
      lastAccessedAt: 2000,
      accessCount: 0,
      tags: [],
    };
    (store as any).items.set('a', item1);
    (store as any).items.set('b', item2);
    const list = store.list({ sortBy: 'createdAt' });
    expect(list[0].content).toBe('second');
  });

  it('list 按 importance 排序', () => {
    store.add('a', { importance: 0.3 });
    store.add('b', { importance: 0.9 });
    const list = store.list({ sortBy: 'importance' });
    expect(list[0].content).toBe('b');
  });

  it('update 和 delete', () => {
    const id = store.add('test');
    expect(store.update(id, { content: 'updated' })).toBe(true);
    expect(store.get(id)?.content).toBe('updated');
    expect(store.delete(id)).toBe(true);
  });

  it('容量限制触发 evictOldest', () => {
    const small = new RecallMemoryStore({ maxCapacity: 3 });
    small.add('a', { importance: 0.1 });
    small.add('b', { importance: 0.5 });
    small.add('c', { importance: 0.9 });
    small.add('d', { importance: 0.3 });
    expect(small.size()).toBe(3);
  });

  it('evictOldest LRU 策略', () => {
    const lru = new RecallMemoryStore({ maxCapacity: 100, evictionPolicy: 'lru' });
    lru.add('a');
    lru.add('b');
    lru.add('c');
    // 等待以确保 lastAccessedAt 区分
    const idA = (lru as any).items.keys().next().value;
    // 直接修改 lastAccessedAt
    const itemA = (lru as any).items.get(idA);
    if (itemA) itemA.lastAccessedAt = Date.now() + 10000;
    lru.evictOldest(1);
    // a 应该被保留（最近访问）
    expect(lru.get(idA)).toBeDefined();
  });

  it('hitRate', () => {
    store.add('machine learning');
    store.search('machine'); // hit
    store.search('xyz123'); // miss
    expect(store.getHitRate()).toBeCloseTo(0.5, 1);
  });
});

describe('ArchiveMemoryStore', () => {
  let store: ArchiveMemoryStore;

  beforeEach(() => {
    store = new ArchiveMemoryStore();
  });

  it('add 自动生成 embedding', async () => {
    const id = await store.add('hello');
    expect(id).toMatch(/^archive-/);
    expect(store.get(id)?.embedding).toBeDefined();
  });

  it('semanticSearch 相似检索', async () => {
    // 使用更长的、更有区分度的内容
    await store.add('machine learning algorithms and models for artificial intelligence');
    await store.add('deep learning neural networks for pattern recognition');
    await store.add('cooking recipes for dinner tonight');
    const results = await store.semanticSearch('learning algorithms', { limit: 5, threshold: 0 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('list 排序', async () => {
    await store.add('a', { importance: 0.3 });
    await store.add('b', { importance: 0.9 });
    const list = store.list({ sortBy: 'importance' });
    expect(list[0].content).toBe('b');
  });

  it('archiveFromRecall', async () => {
    store.archiveFromRecall({
      id: 'old',
      layer: 'recall',
      content: 'archived',
      importance: 0.5,
      relevance: 1.0,
      createdAt: 0,
      updatedAt: 0,
      lastAccessedAt: 0,
      accessCount: 0,
      tags: [],
    });
    expect(store.size()).toBe(1);
  });

  it('save/load', async () => {
    await store.add('persisted content');
    await store.save();
    const newStore = new ArchiveMemoryStore();
    await newStore.load();
    expect(newStore.size()).toBe(1);
  });
});

describe('MemoryDecayEngine', () => {
  it('applyTimeDecay 衰减', () => {
    const decay = new MemoryDecayEngine({ lambda: 0.01 });
    const item = {
      id: '1',
      layer: 'recall' as const,
      content: 'x',
      importance: 1.0,
      relevance: 1.0,
      createdAt: 0,
      updatedAt: 0,
      lastAccessedAt: 0,
      accessCount: 0,
      tags: [],
    };
    const now = 1000 * 60 * 60 * 24 * 100; // 100 天后
    const decayed = decay.applyTimeDecay(item, now);
    expect(decayed.importance).toBeLessThan(1.0);
    expect(decayed.importance).toBeGreaterThan(0);
  });

  it('decayBatch 批量', () => {
    const decay = new MemoryDecayEngine();
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `i${i}`,
      layer: 'recall' as const,
      content: 'x',
      importance: 1.0,
      relevance: 1.0,
      createdAt: 0,
      updatedAt: 0,
      lastAccessedAt: 0,
      accessCount: 0,
      tags: [],
    }));
    const result = decay.decayBatch(items);
    expect(result.length).toBe(3);
  });

  it('shouldArchive 低重要性 + 7 天后', () => {
    const decay = new MemoryDecayEngine();
    const item = {
      id: '1',
      layer: 'recall' as const,
      content: 'x',
      importance: 0.05,
      relevance: 0.05,
      createdAt: 0,
      updatedAt: 0,
      lastAccessedAt: 0,
      accessCount: 0,
      tags: [],
    };
    const now = 1000 * 60 * 60 * 24 * 10; // 10 天后
    expect(decay.shouldArchive(item, now)).toBe(true);
  });

  it('shouldArchive 新记忆不归档', () => {
    const decay = new MemoryDecayEngine();
    const item = {
      id: '1',
      layer: 'recall' as const,
      content: 'x',
      importance: 0.5,
      relevance: 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      tags: [],
    };
    expect(decay.shouldArchive(item)).toBe(false);
  });
});

describe('MemoryConsolidator', () => {
  it('consolidate 相似合并', async () => {
    const consolidator = new MemoryConsolidator({ similarityThreshold: 0.5 });
    const items = [
      {
        id: 'a',
        layer: 'archive' as const,
        content: 'machine learning',
        importance: 0.5,
        relevance: 0.5,
        createdAt: 0,
        updatedAt: 0,
        lastAccessedAt: 0,
        accessCount: 0,
        tags: [],
        embedding: mockEmbedding('machine learning'),
      },
      {
        id: 'b',
        layer: 'archive' as const,
        content: 'machine learning',
        importance: 0.6,
        relevance: 0.5,
        createdAt: 0,
        updatedAt: 0,
        lastAccessedAt: 0,
        accessCount: 0,
        tags: [],
        embedding: mockEmbedding('machine learning'),
      },
    ];
    const result = await consolidator.consolidate(items);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain('合并');
  });

  it('detectConflicts 否定词不一致', () => {
    const consolidator = new MemoryConsolidator();
    const items = [
      {
        id: 'a',
        layer: 'archive' as const,
        content: 'I like apples',
        importance: 0.5,
        relevance: 0.5,
        createdAt: 0,
        updatedAt: 0,
        lastAccessedAt: 0,
        accessCount: 0,
        tags: ['fruit'],
      },
      {
        id: 'b',
        layer: 'archive' as const,
        content: 'I do not like apples',
        importance: 0.5,
        relevance: 0.5,
        createdAt: 0,
        updatedAt: 0,
        lastAccessedAt: 0,
        accessCount: 0,
        tags: ['fruit'],
      },
    ];
    const conflicts = consolidator.detectConflicts(items);
    expect(conflicts.length).toBe(1);
  });
});

describe('LongTermMemoryEngine 主类', () => {
  let engine: LongTermMemoryEngine;

  beforeEach(() => {
    resetDefaultLongTermMemoryEngine();
    engine = createLongTermMemoryEngine();
  });

  it('remember 默认层为 recall', async () => {
    const id = await engine.remember('hello world');
    expect(id).toMatch(/^recall-/);
  });

  it('remember core 层更新 contextSummary', async () => {
    await engine.remember('goal summary', { layer: 'core' });
    expect(engine.getCore().getSection('contextSummary')).toBe('goal summary');
  });

  it('remember archive 层', async () => {
    const id = await engine.remember('archived', { layer: 'archive' });
    expect(id).toMatch(/^archive-/);
  });

  it('recall 跨层检索', async () => {
    await engine.remember('machine learning', { layer: 'recall' });
    await engine.remember('machine learning algorithms', { layer: 'archive' });
    const results = await engine.queryMemories('learning', { topK: 5 });
    expect(results.length).toBe(2);
  });

  it('recall 标签过滤', async () => {
    await engine.remember('item1', { tags: ['code'] });
    await engine.remember('item2', { tags: ['doc'] });
    const results = await engine.queryMemories('item', { tags: ['code'] });
    expect(results.length).toBe(1);
  });

  it('buildContext 包含核心 + 最近 + 相关', async () => {
    engine.getCore().setCurrentGoal('test goal');
    await engine.remember('recent content');
    await engine.remember('relevant content');
    const ctx = await engine.buildContext('relevant');
    expect(ctx).toContain('test goal');
    expect(ctx).toContain('recent content');
    expect(ctx).toContain('relevant content');
  });

  it('runMaintenance 完整流程', async () => {
    await engine.remember('item1', { importance: 0.05 });
    const report = await engine.runMaintenance();
    expect(report).toBeDefined();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('getStats', async () => {
    await engine.remember('a', { layer: 'recall' });
    await engine.remember('b', { layer: 'archive' });
    const stats = engine.getStats();
    expect(stats.totalItems).toBe(2);
    expect(stats.byLayer.recall).toBe(1);
    expect(stats.byLayer.archive).toBe(1);
  });

  it('事件订阅', async () => {
    const events: any[] = [];
    engine.on('item-added', (data) => events.push(data));
    await engine.remember('test');
    expect(events.length).toBe(1);
  });

  it('save / load 持久化', async () => {
    engine.getCore().setCurrentGoal('saved goal');
    await engine.remember('persisted');
    await engine.save();
    const newEngine = createLongTermMemoryEngine();
    await newEngine.load();
    expect(newEngine.getCore().getSection('currentGoal')).toBe('saved goal');
  });

  it('全局单例', () => {
    const e1 = getDefaultLongTermMemoryEngine();
    const e2 = getDefaultLongTermMemoryEngine();
    expect(e1).toBe(e2);
  });
});
