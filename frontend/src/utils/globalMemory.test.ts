/**
 * # ============================================================
 * # GlobalMemoryEngine 单元测试 (Cycle 24 G24-01)
 * # ============================================================
 * # 测试覆盖：
 * #   1. 引擎构造与单例管理
 * #   2. 写入（remember / rememberMany）
 * #   3. 读取（recall / recallById / recallByType）
 * #   4. 更新（update / boostImportance / touchAccess）
 * #   5. 删除（forget / forgetMany / forgetByQuery / clear）
 * #   6. 压缩（compress / autoCompressIfNeeded）
 * #   7. 导入导出（JSON / Markdown）
 * #   8. 统计与配置
 * #   9. 事件订阅
 * #  10. FIFO 清理与 TTL 过期
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GlobalMemoryEngine,
  getGlobalMemoryEngine,
  resetGlobalMemoryEngine,
  setGlobalMemoryEngine,
  isGlobalMemoryEngineInitialized,
} from './globalMemory';

// 提供 mock localStorage
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

beforeEach(() => {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      (globalThis.localStorage as Storage).clear();
    } catch {
      // ignore
    }
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
  resetGlobalMemoryEngine();
});

afterEach(() => {
  resetGlobalMemoryEngine();
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      (globalThis.localStorage as Storage).clear();
    } catch {
      // ignore
    }
  }
});

describe('GlobalMemoryEngine - 构造与单例', () => {
  it('应能创建实例', () => {
    const engine = new GlobalMemoryEngine();
    expect(engine).toBeInstanceOf(GlobalMemoryEngine);
  });

  it('默认配置应正确', () => {
    const engine = new GlobalMemoryEngine();
    const config = engine.getConfig();
    expect(config.maxEntries).toBe(1000);
    expect(config.autoCompress).toBe(true);
    expect(config.compressionThreshold).toBe(500);
  });

  it('应能接受自定义配置', () => {
    const engine = new GlobalMemoryEngine({ maxEntries: 50, autoCompress: false });
    const config = engine.getConfig();
    expect(config.maxEntries).toBe(50);
    expect(config.autoCompress).toBe(false);
  });

  it('单例工厂应返回同一实例', () => {
    const a = getGlobalMemoryEngine();
    const b = getGlobalMemoryEngine();
    expect(a).toBe(b);
  });

  it('resetGlobalMemoryEngine 应清空并重置', () => {
    const a = getGlobalMemoryEngine();
    a.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    resetGlobalMemoryEngine();
    const b = getGlobalMemoryEngine();
    expect(b.getStats().totalEntries).toBe(0);
  });

  it('isInitialized 应正确反映状态', () => {
    expect(isGlobalMemoryEngineInitialized()).toBe(false);
    getGlobalMemoryEngine();
    expect(isGlobalMemoryEngineInitialized()).toBe(true);
  });

  it('setGlobalMemoryEngine 应能注入自定义实例', () => {
    const custom = new GlobalMemoryEngine();
    setGlobalMemoryEngine(custom);
    expect(getGlobalMemoryEngine()).toBe(custom);
  });
});

describe('GlobalMemoryEngine - 写入', () => {
  it('应能记住一条', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'preference', content: '喜欢 TypeScript', tags: ['lang'], scope: 'user', metadata: {} });
    expect(e.id).toBeDefined();
    expect(e.accessCount).toBe(0);
    expect(e.importance).toBe(0.5);
  });

  it('应能批量记住', () => {
    const engine = new GlobalMemoryEngine();
    const results = engine.rememberMany([
      { type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} },
      { type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {} },
    ]);
    expect(results.length).toBe(2);
  });

  it('超过 maxEntries 应触发 FIFO 清理', () => {
    const engine = new GlobalMemoryEngine({ maxEntries: 3, autoCompress: false });
    for (let i = 0; i < 5; i++) {
      engine.remember({ type: 'fact', content: `c${i}`, tags: [], scope: 'user', metadata: {} });
    }
    expect(engine.getStats().totalEntries).toBeLessThanOrEqual(3);
  });

  it('应触发 memory-created 事件', () => {
    const engine = new GlobalMemoryEngine();
    const handler = vi.fn();
    engine.on('memory-created', handler);
    engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('应能设置默认 TTL', () => {
    const engine = new GlobalMemoryEngine({ defaultTtlMs: 1000 });
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(e.expiresAt).toBeDefined();
    expect(e.expiresAt! > Date.now()).toBe(true);
  });
});

describe('GlobalMemoryEngine - 读取', () => {
  it('recall 应返回所有条目（无过滤）', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'preference', content: 'b', tags: [], scope: 'user', metadata: {} });
    expect(engine.recall().length).toBe(2);
  });

  it('recallById 应返回对应条目', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(engine.recallById(e.id)?.content).toBe('x');
  });

  it('recallByType 应只返回指定类型', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'preference', content: 'b', tags: [], scope: 'user', metadata: {} });
    expect(engine.recallByType('fact').length).toBe(1);
  });

  it('类型过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'rule', content: 'b', tags: [], scope: 'user', metadata: {} });
    expect(engine.recall({ types: ['rule'] }).length).toBe(1);
  });

  it('标签过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: ['ts', 'js'], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'b', tags: ['py'], scope: 'user', metadata: {} });
    expect(engine.recall({ tags: ['ts'] }).length).toBe(1);
  });

  it('范围过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'project', projectId: 'p1', metadata: {} });
    expect(engine.recall({ scope: 'project' }).length).toBe(1);
  });

  it('重要性过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {}, importance: 0.3 });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {}, importance: 0.9 });
    expect(engine.recall({ minImportance: 0.5 }).length).toBe(1);
  });

  it('关键词过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'TypeScript 严格模式', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'Python 解释器', tags: [], scope: 'user', metadata: {} });
    const results = engine.recall({ query: 'TypeScript' });
    expect(results.length).toBe(1);
  });

  it('排序：importance', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {}, importance: 0.3 });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {}, importance: 0.9 });
    const results = engine.recall({ sortBy: 'importance' });
    expect(results[0].content).toBe('b');
  });

  it('排序：recency', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    setTimeout(() => {
      const b = engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {} });
      const results = engine.recall({ sortBy: 'recency' });
      expect(results[0].id).toBe(b.id);
    }, 10);
  });

  it('limit 限制', () => {
    const engine = new GlobalMemoryEngine();
    for (let i = 0; i < 5; i++) {
      engine.remember({ type: 'fact', content: `c${i}`, tags: [], scope: 'user', metadata: {} });
    }
    expect(engine.recall({ limit: 3 }).length).toBe(3);
  });

  it('触摸访问应增加 accessCount', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    engine.touchAccess(e.id);
    engine.touchAccess(e.id);
    const updated = engine.recallById(e.id);
    expect(updated?.accessCount).toBeGreaterThanOrEqual(2);
  });
});

describe('GlobalMemoryEngine - 更新', () => {
  it('update 应修改字段', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    const updated = engine.update(e.id, { content: 'y', importance: 0.9 });
    expect(updated?.content).toBe('y');
    expect(updated?.importance).toBe(0.9);
  });

  it('update 不存在的 ID 应返回 null', () => {
    const engine = new GlobalMemoryEngine();
    expect(engine.update('non-existent', { content: 'y' })).toBeNull();
  });

  it('boostImportance 应调整重要性', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {}, importance: 0.5 });
    engine.boostImportance(e.id, 0.3);
    const updated = engine.getAll().find((m) => m.id === e.id);
    // boostImportance 内部用 update 触发 updatedAt 变更，不会触发 touchAccess
    expect(updated?.importance).toBeCloseTo(0.8, 2);
  });

  it('boostImportance 限制在 [0,1]', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {}, importance: 0.9 });
    engine.boostImportance(e.id, 0.5);
    const updated = engine.getAll().find((m) => m.id === e.id);
    expect(updated?.importance).toBe(1);
  });
});

describe('GlobalMemoryEngine - 删除', () => {
  it('forget 应删除并返回 true', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(engine.forget(e.id)).toBe(true);
    expect(engine.recallById(e.id)).toBeNull();
  });

  it('forget 不存在的 ID 应返回 false', () => {
    const engine = new GlobalMemoryEngine();
    expect(engine.forget('non-existent')).toBe(false);
  });

  it('forgetMany 应返回删除数量', () => {
    const engine = new GlobalMemoryEngine();
    const a = engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    const b = engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {} });
    expect(engine.forgetMany([a.id, b.id, 'non-existent'])).toBe(2);
  });

  it('forgetByQuery 应按查询删除', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'ts', tags: ['ts'], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'py', tags: ['py'], scope: 'user', metadata: {} });
    const removed = engine.forgetByQuery({ tags: ['ts'] });
    expect(removed).toBe(1);
  });

  it('clear 应清空所有', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {} });
    expect(engine.clear()).toBe(2);
    expect(engine.getStats().totalEntries).toBe(0);
  });

  it('clear(scope) 应只清空指定范围', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'project', projectId: 'p', metadata: {} });
    expect(engine.clear('user')).toBe(1);
  });
});

describe('GlobalMemoryEngine - 压缩', () => {
  it('compress 应合并相似记忆', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'TypeScript is great', tags: ['ts', 'lang'], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'TypeScript is awesome', tags: ['ts', 'lang'], scope: 'user', metadata: {} });
    const result = engine.compress();
    expect(result.merged).toBeGreaterThan(0);
  });

  it('autoCompressIfNeeded 应在超阈值时自动压缩', () => {
    const engine = new GlobalMemoryEngine({ compressionThreshold: 3, maxEntries: 100 });
    // 创建 3 条高度相似的记忆（共享多个 tag + 高度内容重叠）
    for (let i = 0; i < 3; i++) {
      engine.remember({
        type: 'fact',
        content: `TypeScript 严格模式 feature ${i}`,
        tags: ['ts', 'lang', 'strict'],
        scope: 'user',
        metadata: {},
      });
    }
    // 第 3 次 remember 会自动触发 autoCompressIfNeeded
    // 验证：合并后总条数 < 3
    expect(engine.getStats().totalEntries).toBeLessThan(3);
  });

  it('autoCompress 关闭时应不压缩', () => {
    const engine = new GlobalMemoryEngine({ compressionThreshold: 3, autoCompress: false, maxEntries: 100 });
    for (let i = 0; i < 3; i++) {
      engine.remember({ type: 'fact', content: `TypeScript feature ${i}`, tags: ['ts', `tag${i}`], scope: 'user', metadata: {} });
    }
    expect(engine.autoCompressIfNeeded()).toBe(false);
  });
});

describe('GlobalMemoryEngine - 导入导出', () => {
  it('export JSON 应正确序列化', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: ['t'], scope: 'user', metadata: {} });
    const json = engine.export('json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  it('import JSON 应能解析回', () => {
    const a = new GlobalMemoryEngine();
    a.remember({ type: 'fact', content: 'a', tags: ['t'], scope: 'user', metadata: {} });
    a.remember({ type: 'fact', content: 'b', tags: [], scope: 'user', metadata: {} });
    const json = a.export('json');
    const b = new GlobalMemoryEngine();
    const count = b.import(json, 'json');
    expect(count).toBe(2);
    expect(b.getStats().totalEntries).toBe(2);
  });

  it('export Markdown 应包含正确格式', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'preference', content: 'TypeScript', tags: ['lang'], scope: 'user', metadata: {} });
    const md = engine.export('markdown');
    expect(md).toContain('# Global Memory Export');
    expect(md).toContain('用户偏好');
    expect(md).toContain('TypeScript');
  });

  it('import Markdown 应能解析', () => {
    const md = `# Global Memory Export

## [用户偏好] ts, lang
**Scope**: 用户级 | **Importance**: 0.50 | **Accesses**: 0

TypeScript 优先

---
`;
    const engine = new GlobalMemoryEngine();
    const count = engine.import(md, 'markdown');
    expect(count).toBeGreaterThan(0);
  });

  it('import 非法 JSON 应返回 0', () => {
    const engine = new GlobalMemoryEngine();
    expect(engine.import('not json', 'json')).toBe(0);
  });

  it('export 应能按范围过滤', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'b', tags: [], scope: 'project', projectId: 'p', metadata: {} });
    const json = engine.export('json', 'user');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
  });
});

describe('GlobalMemoryEngine - 统计与配置', () => {
  it('getStats 应正确统计', () => {
    const engine = new GlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'preference', content: 'b', tags: [], scope: 'user', metadata: {} });
    const stats = engine.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.byType.fact).toBe(1);
    expect(stats.byType.preference).toBe(1);
    expect(stats.byScope.user).toBe(2);
  });

  it('updateConfig 应更新并触发事件', () => {
    const engine = new GlobalMemoryEngine();
    const handler = vi.fn();
    engine.on('config-updated', handler);
    engine.updateConfig({ maxEntries: 50 });
    expect(engine.getConfig().maxEntries).toBe(50);
    expect(handler).toHaveBeenCalled();
  });

  it('cleanExpired 应清理过期记忆', () => {
    const engine = new GlobalMemoryEngine();
    const e = engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    // 强制设置过期
    engine.update(e.id, { expiresAt: Date.now() - 1000 });
    const removed = engine.cleanExpired();
    expect(removed).toBe(1);
  });
});

describe('GlobalMemoryEngine - 事件订阅', () => {
  it('on 应返回取消订阅函数', () => {
    const engine = new GlobalMemoryEngine();
    const handler = vi.fn();
    const off = engine.on('memory-created', handler);
    off();
    engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler 异常不应影响其他 handler', () => {
    const engine = new GlobalMemoryEngine();
    const errorHandler = vi.fn(() => {
      throw new Error('handler error');
    });
    const okHandler = vi.fn();
    engine.on('memory-created', errorHandler);
    engine.on('memory-created', okHandler);
    engine.remember({ type: 'fact', content: 'x', tags: [], scope: 'user', metadata: {} });
    expect(okHandler).toHaveBeenCalled();
  });

  it('localStorage 持久化', () => {
    if (typeof localStorage === 'undefined') return;
    const a = new GlobalMemoryEngine();
    a.remember({ type: 'fact', content: 'persisted', tags: [], scope: 'user', metadata: {} });
    const b = new GlobalMemoryEngine();
    expect(b.getStats().totalEntries).toBe(1);
    expect(b.recall()[0].content).toBe('persisted');
  });
});
