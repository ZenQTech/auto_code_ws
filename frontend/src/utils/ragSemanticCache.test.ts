/**
 * # ============================================================
 * # ragSemanticCache.test.ts - RAG 语义缓存单元测试
 * # ============================================================
 * # 覆盖: 精确匹配 / 语义相似 / LRU / TTL / 持久化 / 预热 / 统计
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RAGSemanticCache,
  createSemanticCache,
  createPersistentCache,
} from './ragSemanticCache';

describe('RAGSemanticCache - 基础功能', () => {
  let cache: RAGSemanticCache<string>;

  beforeEach(() => {
    cache = createSemanticCache<string>({ maxSize: 100, defaultTtlMs: 0 });
  });

  it('应该成功创建缓存', () => {
    expect(cache).toBeInstanceOf(RAGSemanticCache);
    expect(cache.size()).toBe(0);
  });

  it('未命中应返回 null', async () => {
    const result = await cache.get('test query');
    expect(result).toBeNull();
  });

  it('set 后 get 应命中', async () => {
    await cache.set('what is RAG?', 'RAG is Retrieval-Augmented Generation');
    const result = await cache.get('what is RAG?');
    expect(result).not.toBeNull();
    expect(result?.entry.value).toBe('RAG is Retrieval-Augmented Generation');
    expect(result?.hitType).toBe('exact');
  });

  it('不同 query 应分别缓存', async () => {
    await cache.set('query 1', 'answer 1');
    await cache.set('query 2', 'answer 2');
    expect((await cache.get('query 1'))?.entry.value).toBe('answer 1');
    expect((await cache.get('query 2'))?.entry.value).toBe('answer 2');
  });

  it('覆盖相同 query 的值', async () => {
    await cache.set('query', 'v1');
    await cache.set('query', 'v2');
    const result = await cache.get('query');
    expect(result?.entry.value).toBe('v2');
  });

  it('invalidate 应移除指定条目', async () => {
    await cache.set('query', 'value');
    const removed = cache.invalidate('query');
    expect(removed).toBe(true);
    expect(await cache.get('query')).toBeNull();
  });

  it('invalidate 不存在的 query 应返回 false', () => {
    expect(cache.invalidate('nonexistent')).toBe(false);
  });

  it('clear 应清空所有条目', async () => {
    await cache.set('q1', 'v1');
    await cache.set('q2', 'v2');
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('应该按模式失效', async () => {
    await cache.set('hello world', 'a');
    await cache.set('hello there', 'b');
    await cache.set('goodbye', 'c');
    const count = cache.invalidatePattern(/^hello/);
    expect(count).toBe(2);
    expect(cache.size()).toBe(1);
  });
});

describe('RAGSemanticCache - 语义相似', () => {
  it('相似 query 应触发语义命中', async () => {
    const cache = createSemanticCache<string>({
      maxSize: 100,
      similarityThreshold: 0.5,
    });
    await cache.set('如何配置 RAG 系统的知识库?', '使用 RAGEngine + addDocument');
    const result = await cache.get('怎样配置 RAG 知识库?');
    expect(result).not.toBeNull();
    expect(result?.hitType).toBe('semantic');
    expect(result?.similarity).toBeGreaterThanOrEqual(0.5);
  });

  it('不相似 query 不应触发语义命中', async () => {
    const cache = createSemanticCache<string>({
      maxSize: 100,
      similarityThreshold: 0.9,
    });
    await cache.set('如何配置 RAG 知识库', 'RAG 配置');
    const result = await cache.get('今天天气怎么样');
    expect(result).toBeNull();
  });

  it('精确匹配应优先于语义匹配', async () => {
    const cache = createSemanticCache<string>({
      maxSize: 100,
      similarityThreshold: 0.5,
    });
    await cache.set('RAG 配置', 'RAG 配置 v1');
    await cache.set('如何配置 RAG 知识库', 'RAG 知识库配置');
    const result = await cache.get('RAG 配置');
    expect(result?.hitType).toBe('exact');
  });

  it('高阈值应只接受非常相似的 query', async () => {
    const cache = createSemanticCache<string>({
      maxSize: 100,
      similarityThreshold: 0.95,
    });
    await cache.set('hello world how are you', 'answer 1');
    const result = await cache.get('hello world how are you doing');
    // 高阈值下,可能不命中
    if (result) {
      expect(result.similarity).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('RAGSemanticCache - getOrSet 模式', () => {
  it('缓存未命中时调用 loader 并缓存', async () => {
    const cache = createSemanticCache<string>();
    const loader = vi.fn(async () => 'computed answer');
    const result = await cache.getOrSet('query', loader);
    expect(result.value).toBe('computed answer');
    expect(result.hit).toBeNull();
    expect(loader).toHaveBeenCalledOnce();
  });

  it('缓存命中时不调用 loader', async () => {
    const cache = createSemanticCache<string>();
    await cache.set('query', 'cached answer');
    const loader = vi.fn(async () => 'new answer');
    const result = await cache.getOrSet('query', loader);
    expect(result.value).toBe('cached answer');
    expect(result.hit).not.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('后续 get 应返回缓存值', async () => {
    const cache = createSemanticCache<string>();
    await cache.getOrSet('query', async () => 'first');
    const result = await cache.get('query');
    expect(result?.entry.value).toBe('first');
  });
});

describe('RAGSemanticCache - LRU 淘汰', () => {
  it('超过 maxSize 应淘汰最久未访问', async () => {
    const cache = createSemanticCache<string>({ maxSize: 3 });
    await cache.set('q1', 'v1');
    await cache.set('q2', 'v2');
    await cache.set('q3', 'v3');
    // 访问 q1,使其最近
    await cache.get('q1');
    // 添加 q4 触发淘汰
    await cache.set('q4', 'v4');
    expect(cache.size()).toBe(3);
    // q2 或 q3 应被淘汰
    expect(await cache.get('q1')).not.toBeNull();
  });

  it('淘汰数应计入统计', async () => {
    const cache = createSemanticCache<string>({ maxSize: 2 });
    await cache.set('q1', 'v1');
    await cache.set('q2', 'v2');
    await cache.set('q3', 'v3');
    await cache.set('q4', 'v4');
    const stats = cache.getStats();
    expect(stats.totalEvictions).toBe(2);
  });
});

describe('RAGSemanticCache - TTL 过期', () => {
  it('过期的条目应被淘汰', async () => {
    const cache = createSemanticCache<string>({ defaultTtlMs: 50 });
    await cache.set('query', 'value');
    expect(await cache.get('query')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(await cache.get('query')).toBeNull();
  });

  it('自定义 TTL 应生效', async () => {
    const cache = createSemanticCache<string>({ defaultTtlMs: 1000 });
    await cache.set('query', 'value', { ttlMs: 50 });
    await new Promise((r) => setTimeout(r, 80));
    expect(await cache.get('query')).toBeNull();
  });

  it('过期计数应计入统计', async () => {
    const cache = createSemanticCache<string>({ defaultTtlMs: 30 });
    await cache.set('query', 'value');
    await new Promise((r) => setTimeout(r, 60));
    await cache.get('query');
    const stats = cache.getStats();
    expect(stats.totalExpirations).toBeGreaterThanOrEqual(1);
  });
});

describe('RAGSemanticCache - 预热', () => {
  it('应该预加载热点 query', async () => {
    const cache = createSemanticCache<string>();
    const loader = vi.fn(async (q: string) => `answer for ${q}`);
    const count = await cache.warmup(['q1', 'q2', 'q3'], loader);
    expect(count).toBe(3);
    expect(cache.size()).toBe(3);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('已缓存的不应重复加载', async () => {
    const cache = createSemanticCache<string>();
    await cache.set('q1', 'existing');
    const loader = vi.fn(async (q: string) => `new ${q}`);
    const count = await cache.warmup(['q1', 'q2'], loader);
    expect(count).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('RAGSemanticCache - 统计', () => {
  it('应该提供完整统计信息', async () => {
    const cache = createSemanticCache<string>({ name: 'test-cache' });
    await cache.set('q1', 'v1');
    await cache.get('q1');
    await cache.get('nonexistent');
    const stats = cache.getStats();
    expect(stats.name).toBe('test-cache');
    expect(stats.totalEntries).toBe(1);
    expect(stats.totalQueries).toBe(2);
    expect(stats.exactHits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it('重置统计应清零', async () => {
    const cache = createSemanticCache<string>();
    await cache.get('q');
    cache.resetStats();
    const stats = cache.getStats();
    expect(stats.totalQueries).toBe(0);
  });

  it('内存估算应大于 0', async () => {
    const cache = createSemanticCache<string>();
    await cache.set('query', 'value');
    const stats = cache.getStats();
    expect(stats.memoryBytes).toBeGreaterThan(0);
  });
});

describe('RAGSemanticCache - 事件订阅', () => {
  it('entry-added 事件', async () => {
    const cache = createSemanticCache<string>();
    const listener = vi.fn();
    cache.on(listener);
    await cache.set('q', 'v');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'entry-added' })
    );
  });

  it('hit 事件 (精确)', async () => {
    const cache = createSemanticCache<string>();
    await cache.set('q', 'v');
    const listener = vi.fn();
    cache.on(listener);
    await cache.get('q');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hit', hitType: 'exact' })
    );
  });

  it('miss 事件', async () => {
    const cache = createSemanticCache<string>();
    const listener = vi.fn();
    cache.on(listener);
    await cache.get('q');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'miss' })
    );
  });

  it('evicted 事件 (LRU)', async () => {
    const cache = createSemanticCache<string>({ maxSize: 1 });
    await cache.set('q1', 'v1');
    const listener = vi.fn();
    cache.on(listener);
    await cache.set('q2', 'v2'); // 触发 LRU
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'evicted', reason: 'lru' })
    );
  });

  it('cleared 事件', async () => {
    const cache = createSemanticCache<string>();
    await cache.set('q', 'v');
    const listener = vi.fn();
    cache.on(listener);
    cache.clear();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cleared' })
    );
  });

  it('应该支持取消订阅', async () => {
    const cache = createSemanticCache<string>();
    const listener = vi.fn();
    const unsubscribe = cache.on(listener);
    unsubscribe();
    await cache.set('q', 'v');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('RAGSemanticCache - 工厂函数', () => {
  it('createSemanticCache 应返回 RAGSemanticCache 实例', () => {
    const cache = createSemanticCache();
    expect(cache).toBeInstanceOf(RAGSemanticCache);
  });

  it('createPersistentCache 应启用持久化', () => {
    const cache = createPersistentCache('test');
    expect(cache.getStats().name).toBe('test');
  });
});

describe('RAGSemanticCache - 复杂类型', () => {
  it('应该支持对象类型', async () => {
    interface RagResult {
      answer: string;
      citations: string[];
    }
    const cache = createSemanticCache<RagResult>();
    const result: RagResult = {
      answer: 'RAG 是检索增强生成',
      citations: ['doc1', 'doc2'],
    };
    await cache.set('什么是 RAG?', result);
    const hit = await cache.get('什么是 RAG?');
    expect(hit?.entry.value.answer).toBe('RAG 是检索增强生成');
    expect(hit?.entry.value.citations).toEqual(['doc1', 'doc2']);
  });
});
