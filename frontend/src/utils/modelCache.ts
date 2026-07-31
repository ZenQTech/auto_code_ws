/**
 * # ============================================================
 * # ModelCache - 多模态模型缓存与懒加载引擎 (v1.0.0 Cycle 49 G49-04)
 * # ============================================================
 * # 核心作用：实现多模态模型 (CLIP/BGE/Volcengine) 的本地缓存
 * #           - IndexedDB 持久化存储
 * #           - 懒加载: 仅在需要时加载模型
 * #           - 进度回调: 加载过程可视化
 * #           - LRU 淘汰: 缓存满时自动清理最久未使用
 * #           - 多模型支持: 同时管理多个模型
 * #           - 内存+磁盘双层缓存
 * #           - 完整事件订阅
 * # 对标产品: HuggingFace transformers.js, ONNX Runtime Web
 * # 设计要点:
 * #   1. 抽象存储: MemoryStorage + IndexedDBStorage
 * #   2. 统一接口: load/save/get/has/delete
 * #   3. 进度反馈: 字节级进度
 * #   4. TTL 支持: 模型可设置过期时间
 * #   5. 容量管理: 最大条目数和最大字节数
 * # ====================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 49 G49-04 初次创建
 * # ====================================
 */

// ============ 类型定义 ============

/**
 * 缓存条目 (模型权重/元数据)
 */
export interface ModelCacheEntry {
  /** 模型唯一键 */
  key: string;
  /** 模型 ID (例如 "clip-vit-base-patch32") */
  modelId: string;
  /** 模型版本 */
  version: string;
  /** 模型类型 */
  type: 'weights' | 'config' | 'tokenizer' | 'metadata';
  /** 二进制数据 (ArrayBuffer) */
  data: ArrayBuffer;
  /** 字节数 */
  sizeBytes: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 (LRU 用) */
  lastAccessedAt: number;
  /** 访问次数 */
  accessCount: number;
  /** 过期时间 (毫秒时间戳, 0 表示永不过期) */
  expiresAt: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 缓存配置
 */
export interface ModelCacheConfig {
  /** 数据库名 */
  dbName?: string;
  /** 对象存储名 */
  storeName?: string;
  /** 最大条目数 (默认 50) */
  maxEntries?: number;
  /** 最大总字节数 (默认 500MB) */
  maxTotalBytes?: number;
  /** 默认 TTL 毫秒 (默认 7 天) */
  defaultTtlMs?: number;
  /** 存储后端 */
  backend?: 'memory' | 'indexeddb';
  /** 进度回调 */
  onProgress?: (progress: ModelCacheProgress) => void;
}

/**
 * 加载进度
 */
export interface ModelCacheProgress {
  /** 阶段: init/download/load/decode/ready */
  stage: 'init' | 'download' | 'load' | 'decode' | 'ready' | 'evict' | 'error';
  /** 模型键 */
  key: string;
  /** 已加载字节 */
  loadedBytes: number;
  /** 总字节 */
  totalBytes: number;
  /** 进度百分比 (0-100) */
  percent: number;
  /** 耗时 (ms) */
  elapsedMs: number;
  /** 错误 (仅 error 阶段) */
  error?: string;
}

/**
 * 缓存统计
 */
export interface ModelCacheStats {
  totalEntries: number;
  totalBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  loadCount: number;
  loadErrors: number;
  hitRate: number;
  avgLoadDurationMs: number;
}

/**
 * 事件
 */
export type CacheEvent =
  | { type: 'load-start'; key: string; modelId: string; at: number }
  | { type: 'load-progress'; key: string; progress: number; at: number }
  | { type: 'load-complete'; key: string; modelId: string; durationMs: number; at: number }
  | { type: 'load-error'; key: string; error: string; at: number }
  | { type: 'cache-hit'; key: string; at: number }
  | { type: 'cache-miss'; key: string; at: number }
  | { type: 'eviction'; key: string; sizeBytes: number; at: number }
  | { type: 'clear'; entriesCleared: number; at: number };

export type CacheListener = (event: CacheEvent) => void;

/**
 * 存储后端接口
 */
export interface CacheStorageBackend {
  get(key: string): Promise<ModelCacheEntry | null>;
  put(entry: ModelCacheEntry): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  size(): Promise<number>;
  totalBytes(): Promise<number>;
}

// ============ Memory Storage (内存后端, 适合测试和 SSR) ============

/**
 * 内存存储后端
 */
export class MemoryStorageBackend implements CacheStorageBackend {
  private store = new Map<string, ModelCacheEntry>();

  async get(key: string): Promise<ModelCacheEntry | null> {
    return this.store.get(key) ?? null;
  }

  async put(entry: ModelCacheEntry): Promise<void> {
    // 深拷贝数据以避免外部修改
    const cloned: ModelCacheEntry = {
      ...entry,
      data: entry.data.slice(0),
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    };
    this.store.set(entry.key, cloned);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async totalBytes(): Promise<number> {
    let total = 0;
    for (const entry of this.store.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }
}

// ============ IndexedDB Storage (持久化后端) ============

/**
 * IndexedDB 存储后端
 *  - 在浏览器环境中持久化模型
 *  - 在不支持 IndexedDB 的环境 (Node.js) 自动降级到内存
 */
export class IndexedDBStorageBackend implements CacheStorageBackend {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;
  private memoryFallback: MemoryStorageBackend | null = null;

  constructor(dbName: string = 'multimodal-model-cache', storeName: string = 'models') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async getDB(): Promise<IDBDatabase | MemoryStorageBackend> {
    // 检查 IndexedDB 可用性
    if (typeof indexedDB === 'undefined') {
      if (!this.memoryFallback) {
        this.memoryFallback = new MemoryStorageBackend();
      }
      return this.memoryFallback;
    }
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => {
        // 降级到内存
        if (!this.memoryFallback) {
          this.memoryFallback = new MemoryStorageBackend();
        }
        resolve(this.memoryFallback);
      };
    });
  }

  async get(key: string): Promise<ModelCacheEntry | null> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.get(key);
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }
        resolve(result as ModelCacheEntry);
      };
      request.onerror = () => resolve(null);
    });
  }

  async put(entry: ModelCacheEntry): Promise<void> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.put(entry);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<boolean> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.delete(key);
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  async has(key: string): Promise<boolean> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.has(key);
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.count(key);
      request.onsuccess = () => resolve((request.result ?? 0) > 0);
      request.onerror = () => resolve(false);
    });
  }

  async keys(): Promise<string[]> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.keys();
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve((request.result ?? []) as string[]);
      request.onerror = () => resolve([]);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.clear();
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  async size(): Promise<number> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.size();
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () => resolve(0);
    });
  }

  async totalBytes(): Promise<number> {
    const db = await this.getDB();
    if (db instanceof MemoryStorageBackend) {
      return db.totalBytes();
    }
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = (request.result ?? []) as ModelCacheEntry[];
        const total = entries.reduce((s, e) => s + e.sizeBytes, 0);
        resolve(total);
      };
      request.onerror = () => resolve(0);
    });
  }
}

// ============ 进度事件工具 ============

/**
 * 创建带节流的进度回调
 */
function createThrottledProgress(
  baseProgress: ModelCacheProgress,
  callback: (p: ModelCacheProgress) => void,
  throttleMs: number = 50
): (update: Partial<ModelCacheProgress>) => void {
  let lastCall = 0;
  return (update: Partial<ModelCacheProgress>) => {
    const now = Date.now();
    if (now - lastCall >= throttleMs) {
      lastCall = now;
      callback({ ...baseProgress, ...update, elapsedMs: now - baseProgress.elapsedMs });
    }
  };
}

// ============ ModelCache 主类 ============

/**
 * 模型加载器接口
 *  - 实际下载/解码模型权重
 */
export interface ModelLoader {
  /** 加载模型 (返回二进制数据) */
  load(
    modelId: string,
    type: ModelCacheEntry['type'],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ArrayBuffer>;
  /** 是否支持该模型 ID */
  supports(modelId: string, type: ModelCacheEntry['type']): boolean;
}

/**
 * Mock Model Loader (用于测试)
 *  - 生成指定大小的伪数据
 */
export class MockModelLoader implements ModelLoader {
  private fakeData: Map<string, ArrayBuffer> = new Map();
  private simulatedLatencyMs: number;
  private shouldFail: boolean = false;
  /** load() 实际被调用次数 (包括缓存命中) */
  public loadCallCount: number = 0;
  /** 实际加载 (非缓存命中) 次数 */
  public actualLoadCount: number = 0;

  constructor(opts: { simulatedLatencyMs?: number } = {}) {
    this.simulatedLatencyMs = opts.simulatedLatencyMs ?? 10;
  }

  setFailure(fail: boolean): void {
    this.shouldFail = fail;
  }

  async load(
    modelId: string,
    type: ModelCacheEntry['type'],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ArrayBuffer> {
    this.loadCallCount += 1;
    if (this.shouldFail) {
      throw new Error('Mock loader failure');
    }
    const key = `${modelId}:${type}`;
    if (this.fakeData.has(key)) {
      // 缓存命中, 不计入 actualLoad
      return this.fakeData.get(key)!;
    }
    this.actualLoadCount += 1;
    // 生成 1KB 模拟数据
    const size = 1024;
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < size; i++) {
      view[i] = (i * 31 + modelId.length) & 0xff;
    }
    // 模拟分块下载进度
    if (onProgress) {
      for (let p = 0; p <= 100; p += 20) {
        onProgress(Math.floor((size * p) / 100), size);
        await new Promise((r) => setTimeout(r, this.simulatedLatencyMs));
      }
    } else {
      await new Promise((r) => setTimeout(r, this.simulatedLatencyMs));
    }
    this.fakeData.set(key, buffer);
    return buffer;
  }

  supports(modelId: string, _type: ModelCacheEntry['type']): boolean {
    return typeof modelId === 'string' && modelId.length > 0;
  }
}

/**
 * 多模态模型缓存与懒加载引擎
 */
export class ModelCache {
  private config: Required<Omit<ModelCacheConfig, 'onProgress'>> & { onProgress?: (p: ModelCacheProgress) => void };
  private backend: CacheStorageBackend;
  private loader: ModelLoader;
  private listeners: Set<CacheListener> = new Set();
  private stats_ = {
    hits: 0,
    misses: 0,
    evictions: 0,
    loadCount: 0,
    loadErrors: 0,
    totalLoadDurationMs: 0,
  };
  // 内存中的活跃模型 (避免重复访问后端)
  private memoryCache = new Map<string, ModelCacheEntry>();

  constructor(loader: ModelLoader, config: ModelCacheConfig = {}) {
    this.config = {
      dbName: config.dbName ?? 'multimodal-model-cache',
      storeName: config.storeName ?? 'models',
      maxEntries: config.maxEntries ?? 50,
      maxTotalBytes: config.maxTotalBytes ?? 500 * 1024 * 1024,
      defaultTtlMs: config.defaultTtlMs ?? 7 * 24 * 60 * 60 * 1000,
      backend: config.backend ?? 'memory',
      onProgress: config.onProgress,
    };
    this.loader = loader;
    this.backend =
      this.config.backend === 'indexeddb'
        ? new IndexedDBStorageBackend(this.config.dbName, this.config.storeName)
        : new MemoryStorageBackend();
  }

  // ============ 核心 API ============

  /**
   * 获取模型 (懒加载)
   *  - 命中缓存: 直接返回
   *  - 未命中: 加载并保存到缓存
   */
  async get(
    modelId: string,
    type: ModelCacheEntry['type'] = 'weights',
    options: { ttlMs?: number; forceReload?: boolean } = {}
  ): Promise<ModelCacheEntry> {
    const key = this.buildKey(modelId, type);
    const startTime = Date.now();

    // 检查内存缓存
    if (!options.forceReload && this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      if (this.isValid(entry)) {
        entry.lastAccessedAt = Date.now();
        entry.accessCount += 1;
        this.stats_.hits += 1;
        this.emit({ type: 'cache-hit', key, at: Date.now() });
        return entry;
      } else {
        this.memoryCache.delete(key);
        await this.backend.delete(key);
      }
    }

    // 检查存储后端
    if (!options.forceReload) {
      const entry = await this.backend.get(key);
      if (entry && this.isValid(entry)) {
        entry.lastAccessedAt = Date.now();
        entry.accessCount += 1;
        this.memoryCache.set(key, entry);
        this.stats_.hits += 1;
        this.emit({ type: 'cache-hit', key, at: Date.now() });
        return entry;
      } else if (entry) {
        // 过期
        await this.backend.delete(key);
      }
    }

    // 缓存未命中, 加载模型
    this.stats_.misses += 1;
    this.emit({ type: 'cache-miss', key, at: Date.now() });

    return await this.loadAndCache(modelId, type, key, options.ttlMs, startTime);
  }

  /**
   * 检查模型是否存在
   */
  async has(modelId: string, type: ModelCacheEntry['type'] = 'weights'): Promise<boolean> {
    const key = this.buildKey(modelId, type);
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      return this.isValid(entry);
    }
    const entry = await this.backend.get(key);
    if (!entry) return false;
    return this.isValid(entry);
  }

  /**
   * 主动预热 (在后台加载, 不阻塞)
   */
  async warmup(modelIds: string[], type: ModelCacheEntry['type'] = 'weights'): Promise<void> {
    await Promise.all(
      modelIds.map((id) =>
        this.get(id, type).catch((err) => {
          this.emit({
            type: 'load-error',
            key: this.buildKey(id, type),
            error: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        })
      )
    );
  }

  /**
   * 删除模型
   */
  async delete(modelId: string, type: ModelCacheEntry['type'] = 'weights'): Promise<boolean> {
    const key = this.buildKey(modelId, type);
    this.memoryCache.delete(key);
    return await this.backend.delete(key);
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const count = await this.backend.size();
    this.memoryCache.clear();
    await this.backend.clear();
    this.emit({ type: 'clear', entriesCleared: count, at: Date.now() });
  }

  /**
   * 列出所有缓存键
   */
  async listKeys(): Promise<string[]> {
    return await this.backend.keys();
  }

  /**
   * 获取统计信息
   */
  getStats(): ModelCacheStats {
    const totalOps = this.stats_.hits + this.stats_.misses;
    return {
      totalEntries: this.memoryCache.size,
      totalBytes: 0, // 实际查询后端较慢, 不在此处计算
      hits: this.stats_.hits,
      misses: this.stats_.misses,
      evictions: this.stats_.evictions,
      loadCount: this.stats_.loadCount,
      loadErrors: this.stats_.loadErrors,
      hitRate: totalOps > 0 ? this.stats_.hits / totalOps : 0,
      avgLoadDurationMs: this.stats_.loadCount > 0 ? this.stats_.totalLoadDurationMs / this.stats_.loadCount : 0,
    };
  }

  /**
   * 订阅事件
   */
  subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ 内部方法 ============

  /**
   * 加载并缓存模型
   */
  private async loadAndCache(
    modelId: string,
    type: ModelCacheEntry['type'],
    key: string,
    ttlMs: number | undefined,
    startTime: number
  ): Promise<ModelCacheEntry> {
    if (!this.loader.supports(modelId, type)) {
      throw new Error(`Loader does not support model: ${modelId} (${type})`);
    }

    this.emit({ type: 'load-start', key, modelId, at: Date.now() });

    const baseProgress: ModelCacheProgress = {
      stage: 'download',
      key,
      loadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      elapsedMs: Date.now() - startTime,
    };

    const throttledProgress = this.config.onProgress
      ? createThrottledProgress(baseProgress, (p) => this.config.onProgress!(p))
      : null;

    let data: ArrayBuffer;
    try {
      data = await this.loader.load(modelId, type, (loaded, total) => {
        if (throttledProgress) {
          throttledProgress({
            stage: 'download',
            loadedBytes: loaded,
            totalBytes: total,
            percent: total > 0 ? (loaded / total) * 100 : 0,
          });
        }
        this.emit({
          type: 'load-progress',
          key,
          progress: total > 0 ? loaded / total : 0,
          at: Date.now(),
        });
      });
    } catch (err) {
      this.stats_.loadErrors += 1;
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'load-error', key, error, at: Date.now() });
      if (this.config.onProgress) {
        this.config.onProgress({
          ...baseProgress,
          stage: 'error',
          percent: 0,
          error,
        });
      }
      throw err;
    }

    const now = Date.now();
    // ttlMs === 0 表示永不过期 (使用 expiresAt = 0 标记)
    const effectiveTtl = ttlMs ?? this.config.defaultTtlMs;
    const expiresAt = effectiveTtl === 0 ? 0 : now + effectiveTtl;
    const entry: ModelCacheEntry = {
      key,
      modelId,
      version: '1.0.0',
      type,
      data,
      sizeBytes: data.byteLength,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      expiresAt,
    };

    // 检查容量, 必要时淘汰
    await this.ensureCapacity(data.byteLength);

    // 保存
    await this.backend.put(entry);
    this.memoryCache.set(key, entry);

    const durationMs = Date.now() - startTime;
    this.stats_.loadCount += 1;
    this.stats_.totalLoadDurationMs += durationMs;

    this.emit({ type: 'load-complete', key, modelId, durationMs, at: Date.now() });

    if (this.config.onProgress) {
      this.config.onProgress({
        stage: 'ready',
        key,
        loadedBytes: data.byteLength,
        totalBytes: data.byteLength,
        percent: 100,
        elapsedMs: durationMs,
      });
    }

    return entry;
  }

  /**
   * 确保容量足够
   *  - 超出 maxEntries 或 maxTotalBytes 时, LRU 淘汰
   *  - 优先使用内存缓存的最新 lastAccessedAt
   */
  private async ensureCapacity(newEntryBytes: number): Promise<void> {
    const keys = await this.backend.keys();
    const entries: ModelCacheEntry[] = [];
    for (const k of keys) {
      // 优先使用内存缓存 (有最新的 LRU 状态)
      const memEntry = this.memoryCache.get(k);
      if (memEntry) {
        entries.push(memEntry);
        continue;
      }
      const e = await this.backend.get(k);
      if (e) entries.push(e);
    }

    // 按 lastAccessedAt 升序 (最久未使用在前)
    entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    let totalBytes = entries.reduce((s, e) => s + e.sizeBytes, 0) + newEntryBytes;
    let totalCount = entries.length + 1;

    // 淘汰直到满足限制
    while (
      (totalCount > this.config.maxEntries || totalBytes > this.config.maxTotalBytes) &&
      entries.length > 0
    ) {
      const victim = entries.shift()!;
      await this.backend.delete(victim.key);
      this.memoryCache.delete(victim.key);
      this.stats_.evictions += 1;
      totalBytes -= victim.sizeBytes;
      totalCount -= 1;
      this.emit({
        type: 'eviction',
        key: victim.key,
        sizeBytes: victim.sizeBytes,
        at: Date.now(),
      });
    }
  }

  /**
   * 检查条目是否有效 (未过期)
   */
  private isValid(entry: ModelCacheEntry): boolean {
    if (entry.expiresAt === 0) return true;
    return Date.now() < entry.expiresAt;
  }

  /**
   * 构建缓存键
   */
  private buildKey(modelId: string, type: ModelCacheEntry['type']): string {
    return `${modelId}::${type}`;
  }

  /**
   * 触发事件
   */
  private emit(event: CacheEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        void err;
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建模型缓存
 */
export function createModelCache(loader: ModelLoader, config?: ModelCacheConfig): ModelCache {
  return new ModelCache(loader, config);
}
