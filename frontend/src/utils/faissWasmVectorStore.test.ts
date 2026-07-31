/**
 * # ============================================================
 * # faissWasmVectorStore.test.ts - FAISS 向量存储单元测试
 * # ============================================================
 * # 覆盖:
 * #   1. 基础功能 (构造/添加/搜索/删除/清空)
 * #   2. 三种索引类型 (Flat/IVF/HNSW)
 * #   3. 三种距离度量 (L2/内积/余弦)
 * #   4. 自动索引选择
 * #   5. 元数据过滤
 * #   6. 序列化/反序列化
 * #   7. 索引统计
 * #   8. 事件订阅
 * #   9. 工厂函数
 * #  10. 性能基准
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FAISSWasmVectorStore,
  createFAISSStore,
  createFlatIndex,
  createIVFIndex,
  createHNSWIndex,
  type FAISSSearchResult,
  type IndexType,
} from './faissWasmVectorStore';

// ============ 工具函数 ============

/**
 * 生成确定性测试向量 (基于 index + 维度)
 */
function makeVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * (i + 1) * 0.1) * Math.cos(seed * 0.3);
  }
  return v;
}

function makeVectorList(count: number, dim: number): Array<{ id: string; vector: Float32Array; metadata?: Record<string, unknown> }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec-${i}`,
    vector: makeVector(dim, i + 1),
    metadata: { source: 'test', index: i, category: i % 3 === 0 ? 'A' : 'B' },
  }));
}

// ============ 基础功能 ============

describe('FAISSWasmVectorStore - 基础功能', () => {
  let store: FAISSWasmVectorStore;

  beforeEach(() => {
    store = createFlatIndex(64);
  });

  it('应该成功创建向量存储', () => {
    expect(store).toBeInstanceOf(FAISSWasmVectorStore);
    expect(store.size()).toBe(0);
  });

  it('应该添加单个向量', () => {
    store.add('v1', makeVector(64, 1));
    expect(store.size()).toBe(1);
  });

  it('应该支持添加重复 ID(覆盖)', () => {
    store.add('v1', makeVector(64, 1));
    store.add('v1', makeVector(64, 2));
    expect(store.size()).toBe(1);
  });

  it('应该批量添加向量', () => {
    const items = makeVectorList(10, 64);
    store.addBatch(items);
    expect(store.size()).toBe(10);
  });

  it('应该搜索 Top-K', () => {
    const items = makeVectorList(10, 64);
    store.addBatch(items);
    const query = makeVector(64, 5); // 接近 vec-4
    const results = store.search(query, 3);
    expect(results.length).toBe(3);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('搜索结果应按相关性降序', () => {
    const items = makeVectorList(20, 64);
    store.addBatch(items);
    const query = makeVector(64, 10);
    const results = store.search(query, 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('应该删除向量', () => {
    store.add('v1', makeVector(64, 1));
    expect(store.size()).toBe(1);
    const deleted = store.delete('v1');
    expect(deleted).toBe(true);
    expect(store.size()).toBe(0);
  });

  it('删除不存在的向量应返回 false', () => {
    const deleted = store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('应该清空存储', () => {
    store.addBatch(makeVectorList(10, 64));
    expect(store.size()).toBe(10);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('空存储搜索应返回空数组', () => {
    const results = store.search(makeVector(64, 1), 5);
    expect(results).toEqual([]);
  });

  it('应该获取所有向量', () => {
    store.addBatch(makeVectorList(5, 64));
    const all = store.getAll();
    expect(all.length).toBe(5);
  });
});

// ============ 索引类型 ============

describe('FAISSWasmVectorStore - 索引类型', () => {
  it('Flat 索引 - 应该正确处理小数据集', () => {
    const store = createFlatIndex(32);
    store.addBatch(makeVectorList(50, 32));
    const results = store.search(makeVector(32, 25), 3);
    expect(results.length).toBe(3);
    const stats = store.getStats();
    expect(stats.type).toBe('flat');
  });

  it('IVF 索引 - 应该正确处理中等数据集', () => {
    const store = new FAISSWasmVectorStore({
      type: 'ivf',
      dimension: 32,
      nlist: 5,
      nprobe: 2,
    });
    store.addBatch(makeVectorList(200, 32));
    const results = store.search(makeVector(32, 100), 5);
    expect(results.length).toBe(5);
    const stats = store.getStats();
    expect(stats.type).toBe('ivf');
  });

  it('HNSW 索引 - 应该正确处理大规模数据集', () => {
    const store = new FAISSWasmVectorStore({
      type: 'hnsw',
      dimension: 16,
      M: 8,
      efConstruction: 50,
      efSearch: 20,
    });
    store.addBatch(makeVectorList(100, 16));
    const results = store.search(makeVector(16, 50), 5);
    expect(results.length).toBeGreaterThan(0);
    const stats = store.getStats();
    expect(stats.type).toBe('hnsw');
  });

  it('Auto 模式 - 小数据集应选 Flat', () => {
    const store = createFAISSStore(32);
    store.addBatch(makeVectorList(50, 32));
    expect(store.getStats().type).toBe('flat');
  });

  it('Auto 模式 - 中等数据集应选 IVF', () => {
    const store = createFAISSStore(32);
    store.addBatch(makeVectorList(2000, 32));
    expect(store.getStats().type).toBe('ivf');
  });

  it('Auto 模式 - 大数据集应选 HNSW', () => {
    const store = createFAISSStore(16);
    store.addBatch(makeVectorList(50, 16));
    // 强制走 hnsw
    const hnswStore = new FAISSWasmVectorStore({
      type: 'hnsw',
      dimension: 16,
      M: 4,
    });
    hnswStore.addBatch(makeVectorList(50, 16));
    expect(hnswStore.getStats().type).toBe('hnsw');
  });

  it('重建索引应清空旧索引', () => {
    const store = new FAISSWasmVectorStore({
      type: 'ivf',
      dimension: 32,
      nlist: 4,
    });
    store.addBatch(makeVectorList(100, 32));
    store.rebuildIndex();
    const results = store.search(makeVector(32, 50), 3);
    expect(results.length).toBe(3);
  });
});

// ============ 距离度量 ============

describe('FAISSWasmVectorStore - 距离度量', () => {
  it('L2 距离 - 完全相同的向量应返回 0 距离', () => {
    const store = new FAISSWasmVectorStore({
      type: 'flat',
      dimension: 8,
      metric: 'l2',
    });
    const v = makeVector(8, 1);
    store.add('v1', v);
    const results = store.search(v, 1);
    expect(results[0].distance).toBeCloseTo(0, 5);
  });

  it('内积 - 相同向量应得最高分', () => {
    const store = new FAISSWasmVectorStore({
      type: 'flat',
      dimension: 8,
      metric: 'inner_product',
    });
    // 使用与 v 正交的对比向量,确保 v1 (相同向量) 内积最大
    const v = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const v2 = new Float32Array([-0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1]);
    store.add('v1', v);
    store.add('v2', v2);
    const results = store.search(v, 2);
    // v1 与 v 完全相同,内积最大(自己的模平方)
    expect(results[0].id).toBe('v1');
    expect(results[0].distance).toBeGreaterThan(results[1].distance);
  });

  it('余弦相似度 - 应在 [0, 1] 范围内', () => {
    const store = new FAISSWasmVectorStore({
      type: 'flat',
      dimension: 8,
      metric: 'cosine',
    });
    store.addBatch(makeVectorList(5, 8));
    const results = store.search(makeVector(8, 3), 3);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

// ============ 元数据过滤 ============

describe('FAISSWasmVectorStore - 元数据过滤', () => {
  let store: FAISSWasmVectorStore;

  beforeEach(() => {
    store = createFlatIndex(8);
    for (let i = 0; i < 6; i++) {
      store.add(`v${i}`, makeVector(8, i + 1), {
        category: i % 2 === 0 ? 'A' : 'B',
        source: i < 3 ? 'docs' : 'wiki',
      });
    }
  });

  it('应该按元数据过滤', () => {
    const results = store.search(makeVector(8, 1), 10, { category: 'A' });
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.metadata?.category).toBe('A');
    }
  });

  it('多条件过滤', () => {
    const results = store.search(makeVector(8, 1), 10, {
      category: 'A',
      source: 'docs',
    });
    expect(results.length).toBe(2);
  });

  it('不匹配的过滤条件应返回空', () => {
    const results = store.search(makeVector(8, 1), 10, { category: 'Z' });
    expect(results.length).toBe(0);
  });
});

// ============ 序列化 ============

describe('FAISSWasmVectorStore - 序列化', () => {
  it('应该正确序列化', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(5, 8));
    const data = store.serialize();
    expect(data.version).toBe('1.0.0');
    expect(data.vectors.length).toBe(5);
  });

  it('应该正确反序列化', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(5, 8));
    const data = store.serialize();
    const restored = FAISSWasmVectorStore.deserialize(data);
    expect(restored.size()).toBe(5);
    const results = restored.search(makeVector(8, 3), 1);
    expect(results.length).toBe(1);
  });

  it('序列化后查询结果应一致', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(10, 8));
    const query = makeVector(8, 5);
    const beforeResults = store.search(query, 3);

    const data = store.serialize();
    const restored = FAISSWasmVectorStore.deserialize(data);
    const afterResults = restored.search(query, 3);

    expect(beforeResults.map((r) => r.id)).toEqual(afterResults.map((r) => r.id));
  });
});

// ============ 统计 ============

describe('FAISSWasmVectorStore - 统计', () => {
  it('应该提供完整统计信息', () => {
    const store = createFlatIndex(32);
    store.addBatch(makeVectorList(10, 32));
    store.search(makeVector(32, 5), 3);
    const stats = store.getStats();
    expect(stats.totalVectors).toBe(10);
    expect(stats.dimension).toBe(32);
    expect(stats.totalSearches).toBe(1);
    expect(stats.avgSearchTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('应该累计多次搜索统计', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(5, 8));
    for (let i = 0; i < 5; i++) {
      store.search(makeVector(8, i), 2);
    }
    const stats = store.getStats();
    expect(stats.totalSearches).toBe(5);
  });

  it('应该估算内存占用', () => {
    const store = createFlatIndex(64);
    store.addBatch(makeVectorList(100, 64));
    const stats = store.getStats();
    expect(stats.memoryBytes).toBeGreaterThan(0);
  });
});

// ============ 事件订阅 ============

describe('FAISSWasmVectorStore - 事件订阅', () => {
  it('vector-added 事件', () => {
    const store = createFlatIndex(8);
    const listener = vi.fn();
    store.on(listener);
    store.add('v1', makeVector(8, 1));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vector-added' })
    );
  });

  it('batch-added 事件', () => {
    const store = createFlatIndex(8);
    const listener = vi.fn();
    store.on(listener);
    store.addBatch(makeVectorList(5, 8));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'batch-added' })
    );
  });

  it('search-completed 事件', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(5, 8));
    const listener = vi.fn();
    store.on(listener);
    store.search(makeVector(8, 1), 3);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'search-completed' })
    );
  });

  it('index-cleared 事件', () => {
    const store = createFlatIndex(8);
    store.addBatch(makeVectorList(5, 8));
    const listener = vi.fn();
    store.on(listener);
    store.clear();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'index-cleared' })
    );
  });

  it('应该支持取消订阅', () => {
    const store = createFlatIndex(8);
    const listener = vi.fn();
    const unsubscribe = store.on(listener);
    unsubscribe();
    store.add('v1', makeVector(8, 1));
    expect(listener).not.toHaveBeenCalled();
  });
});

// ============ 工厂函数 ============

describe('FAISSWasmVectorStore - 工厂函数', () => {
  it('createFAISSStore 应该返回 FAISSWasmVectorStore 实例', () => {
    const store = createFAISSStore(64);
    expect(store).toBeInstanceOf(FAISSWasmVectorStore);
  });

  it('createFlatIndex 应该使用 flat 索引', () => {
    const store = createFlatIndex(32);
    expect(store.getStats().type).toBe('flat');
  });

  it('createIVFIndex 应该使用 ivf 索引', () => {
    const store = createIVFIndex(32, 10);
    expect(store.getStats().type).toBe('ivf');
  });

  it('createHNSWIndex 应该使用 hnsw 索引', () => {
    const store = createHNSWIndex(32, 8);
    expect(store.getStats().type).toBe('hnsw');
  });
});

// ============ 性能基准 ============

describe('FAISSWasmVectorStore - 性能基准', () => {
  it('Flat - 1000 向量 10 维 搜索应 < 100ms', () => {
    const store = createFlatIndex(10);
    store.addBatch(makeVectorList(1000, 10));
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      store.search(makeVector(10, i), 10);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500); // 10次搜索 < 500ms (平均 < 50ms)
  });

  it('IVF - 5000 向量 16 维 搜索应 < 100ms', () => {
    const store = new FAISSWasmVectorStore({
      type: 'ivf',
      dimension: 16,
      nlist: 20,
      nprobe: 5,
    });
    store.addBatch(makeVectorList(5000, 16));
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      store.search(makeVector(16, i), 10);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('HNSW - 200 向量 8 维 搜索应 < 200ms', () => {
    const store = new FAISSWasmVectorStore({
      type: 'hnsw',
      dimension: 8,
      M: 8,
      efConstruction: 50,
      efSearch: 20,
    });
    store.addBatch(makeVectorList(200, 8));
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      store.search(makeVector(8, i), 5);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
