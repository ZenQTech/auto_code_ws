/**
 * # ============================================================
 * # GlobalMemoryEngine - 跨会话记忆引擎 (v1.0.0 Cycle 24 G24-01)
 * # ============================================================
 * # 核心作用：跨会话/跨 cycle 持久化用户偏好、决策、事实、上下文、反馈、规则
 * # 主要功能：
 * #   1. 6 种记忆类型（preference/decision/fact/context/feedback/rule）
 * #   2. 3 种作用范围（user/project/cycle）
 * #   3. 4 种排序方式（relevance/recency/importance/accessCount）
 * #   4. 自动 FIFO 清理 + TTL 过期
 * #   5. 智能压缩（基于标签+关键词重叠度）
 * #   6. JSON / Markdown 导入导出
 * #   7. 事件订阅 + 重要性自适应
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 24 G24-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type MemoryType =
  | 'preference'
  | 'decision'
  | 'fact'
  | 'context'
  | 'feedback'
  | 'rule';

export type MemoryScope = 'user' | 'project' | 'cycle';

export type MemorySortBy = 'relevance' | 'recency' | 'importance' | 'accessCount';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  preference: '用户偏好',
  decision: '决策记录',
  fact: '事实信息',
  context: '上下文',
  feedback: '反馈',
  rule: '规则',
};

export const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = {
  user: '用户级',
  project: '项目级',
  cycle: 'Cycle 级',
};

export interface GlobalMemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  scope: MemoryScope;
  projectId?: string;
  cycleId?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  accessCount: number;
  importance: number;
}

export interface GlobalMemoryConfig {
  maxEntries: number;
  defaultTtlMs: number;
  autoCompress: boolean;
  compressionThreshold: number;
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
}

export interface MemoryQuery {
  query?: string;
  types?: MemoryType[];
  tags?: string[];
  scope?: MemoryScope;
  projectId?: string;
  cycleId?: string;
  minImportance?: number;
  limit?: number;
  sortBy?: MemorySortBy;
}

export interface GlobalMemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  byScope: Record<MemoryScope, number>;
  totalAccessCount: number;
  averageImportance: number;
  oldestEntryAt: number | null;
  newestEntryAt: number | null;
  expiredCount: number;
}

export type GlobalMemoryEventType =
  | 'memory-created'
  | 'memory-updated'
  | 'memory-deleted'
  | 'memory-accessed'
  | 'memory-expired'
  | 'memory-compressed'
  | 'config-updated';

type GlobalMemoryEventHandler = (data?: unknown) => void;

// ============ 工具函数 ============

/** 生成唯一 ID */
function generateId(prefix: string = 'mem'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 默认配置 */
function _createDefaultConfig(): GlobalMemoryConfig {
  return {
    maxEntries: 1000,
    defaultTtlMs: 0, // 永不过期
    autoCompress: true,
    compressionThreshold: 500,
    storageBackend: 'localStorage',
  };
}

/** 内存存储实现 */
class InMemoryStorage {
  private map: Map<string, GlobalMemoryEntry> = new Map();

  list(): GlobalMemoryEntry[] {
    return Array.from(this.map.values());
  }

  load(id: string): GlobalMemoryEntry | null {
    return this.map.get(id) || null;
  }

  save(entry: GlobalMemoryEntry): void {
    this.map.set(entry.id, entry);
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }
}

/** localStorage 存储实现 */
class LocalStorageBackend {
  private key = 'global_memory_v1';

  list(): GlobalMemoryEntry[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  load(id: string): GlobalMemoryEntry | null {
    return this.list().find((e) => e.id === id) || null;
  }

  save(entry: GlobalMemoryEntry): void {
    const all = this.list();
    const idx = all.findIndex((e) => e.id === entry.id);
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    this._save(all);
  }

  saveAll(entries: GlobalMemoryEntry[]): void {
    this._save(entries);
  }

  delete(id: string): void {
    const all = this.list().filter((e) => e.id !== id);
    this._save(all);
  }

  clear(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.key);
    }
  }

  private _save(entries: GlobalMemoryEntry[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.key, JSON.stringify(entries));
    } catch {
      // 静默处理存储异常
    }
  }
}

// ============ 事件总线 ============

class GlobalMemoryEventBus {
  private listeners: Map<GlobalMemoryEventType, Set<GlobalMemoryEventHandler>> = new Map();

  on(type: GlobalMemoryEventType, handler: GlobalMemoryEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(type: GlobalMemoryEventType, data?: unknown): void {
    this.listeners.get(type)?.forEach((h) => {
      try {
        h(data);
      } catch {
        // 静默处理监听器异常
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============ 主引擎 ============

export class GlobalMemoryEngine {
  private entries: Map<string, GlobalMemoryEntry> = new Map();
  private config: GlobalMemoryConfig;
  private storage: InMemoryStorage | LocalStorageBackend;
  private eventBus: GlobalMemoryEventBus = new GlobalMemoryEventBus();

  constructor(config?: Partial<GlobalMemoryConfig>) {
    this.config = { ..._createDefaultConfig(), ...(config || {}) };
    this.storage = this.config.storageBackend === 'localStorage' ? new LocalStorageBackend() : new InMemoryStorage();
    this.load();
  }

  // ============ 持久化 ============

  private load(): void {
    if (this.storage instanceof LocalStorageBackend) {
      const all = this.storage.list();
      this.entries.clear();
      all.forEach((e) => this.entries.set(e.id, e));
    }
  }

  private persist(): void {
    if (this.storage instanceof LocalStorageBackend) {
      this.storage.saveAll(Array.from(this.entries.values()));
    }
  }

  // ============ 写入 API ============

  /**
   * 记住一条记忆
   */
  remember(
    input: Omit<GlobalMemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'importance'> & {
      importance?: number;
    }
  ): GlobalMemoryEntry {
    const now = Date.now();
    const entry: GlobalMemoryEntry = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      importance: input.importance ?? 0.5,
      ...input,
    };
    if (!entry.expiresAt && this.config.defaultTtlMs > 0) {
      entry.expiresAt = now + this.config.defaultTtlMs;
    }
    this.entries.set(entry.id, entry);
    this.persist();
    this.evictIfNeeded();
    this.autoCompressIfNeeded();
    this.eventBus.emit('memory-created', entry);
    return entry;
  }

  /**
   * 批量记住
   */
  rememberMany(
    inputs: Array<Omit<GlobalMemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'importance'>>
  ): GlobalMemoryEntry[] {
    return inputs.map((i) => this.remember(i));
  }

  // ============ 读取 API ============

  /**
   * 检索记忆
   */
  recall(query: MemoryQuery = {}): GlobalMemoryEntry[] {
    let results = Array.from(this.entries.values());

    // 过滤过期
    const now = Date.now();
    results = results.filter((e) => !e.expiresAt || e.expiresAt > now);

    // 类型过滤
    if (query.types && query.types.length > 0) {
      const typeSet = new Set(query.types);
      results = results.filter((e) => typeSet.has(e.type));
    }

    // 标签过滤
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
    }

    // 范围过滤
    if (query.scope) {
      results = results.filter((e) => e.scope === query.scope);
    }

    // 项目过滤
    if (query.projectId) {
      results = results.filter((e) => e.projectId === query.projectId);
    }

    // cycle 过滤
    if (query.cycleId) {
      results = results.filter((e) => e.cycleId === query.cycleId);
    }

    // 重要性过滤
    if (query.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= query.minImportance!);
    }

    // 关键词过滤
    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.content.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
      // 提升相关性评分
      results = results.map((e) => {
        const matchCount =
          (e.content.toLowerCase().includes(q) ? 1 : 0) +
          e.tags.filter((t) => t.toLowerCase().includes(q)).length;
        return { ...e, _relevance: matchCount } as GlobalMemoryEntry & { _relevance: number };
      });
    }

    // 排序
    const sortBy = query.sortBy || 'recency';
    results.sort((a, b) => {
      switch (sortBy) {
        case 'relevance': {
          const ar = (a as GlobalMemoryEntry & { _relevance?: number })._relevance || 0;
          const br = (b as GlobalMemoryEntry & { _relevance?: number })._relevance || 0;
          if (br !== ar) return br - ar;
          return b.createdAt - a.createdAt;
        }
        case 'importance':
          if (b.importance !== a.importance) return b.importance - a.importance;
          return b.createdAt - a.createdAt;
        case 'accessCount':
          if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount;
          return b.createdAt - a.createdAt;
        case 'recency':
        default:
          return b.createdAt - a.createdAt;
      }
    });

    // 限制
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    // 触摸访问
    if (query.query || query.sortBy === 'accessCount') {
      results.forEach((e) => this.touchAccess(e.id));
    }

    // 清理临时字段
    return results.map((e) => {
      const r = e as GlobalMemoryEntry & { _relevance?: number };
      if (r._relevance !== undefined) delete r._relevance;
      return r;
    });
  }

  /**
   * 按 ID 获取
   */
  recallById(id: string): GlobalMemoryEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.forget(id);
      this.eventBus.emit('memory-expired', entry);
      return null;
    }
    this.touchAccess(id);
    return entry;
  }

  /**
   * 按类型获取
   */
  recallByType(type: MemoryType, limit?: number): GlobalMemoryEntry[] {
    return this.recall({ types: [type], limit, sortBy: 'recency' });
  }

  // ============ 更新 API ============

  /**
   * 更新记忆
   */
  update(id: string, patch: Partial<GlobalMemoryEntry>): GlobalMemoryEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const updated: GlobalMemoryEntry = {
      ...entry,
      ...patch,
      id: entry.id, // 不允许修改 ID
      createdAt: entry.createdAt, // 不允许修改创建时间
      updatedAt: Date.now(),
    };
    this.entries.set(id, updated);
    this.persist();
    this.eventBus.emit('memory-updated', updated);
    return updated;
  }

  /**
   * 提升重要性
   */
  boostImportance(id: string, delta: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const newImportance = Math.max(0, Math.min(1, entry.importance + delta));
    this.update(id, { importance: newImportance });
  }

  /**
   * 直接设置重要性（不触发 touchAccess）
   */
  setImportance(id: string, value: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const newImportance = Math.max(0, Math.min(1, value));
    entry.importance = newImportance;
    entry.updatedAt = Date.now();
    this.entries.set(id, entry);
    this.persist();
  }

  /**
   * 触摸访问
   */
  touchAccess(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.accessCount += 1;
    // 每次访问小幅提升重要性（0.01 上限）
    if (entry.importance < 1) {
      entry.importance = Math.min(1, entry.importance + 0.01);
    }
    entry.updatedAt = Date.now();
    this.entries.set(id, entry);
    this.persist();
    this.eventBus.emit('memory-accessed', entry);
  }

  // ============ 删除 API ============

  /**
   * 忘记一条
   */
  forget(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.persist();
    this.eventBus.emit('memory-deleted', entry);
    return true;
  }

  /**
   * 批量忘记
   */
  forgetMany(ids: string[]): number {
    return ids.reduce((acc, id) => acc + (this.forget(id) ? 1 : 0), 0);
  }

  /**
   * 按查询忘记
   */
  forgetByQuery(query: MemoryQuery): number {
    const targets = this.recall({ ...query, limit: undefined });
    return this.forgetMany(targets.map((e) => e.id));
  }

  /**
   * 清空（可选范围）
   */
  clear(scope?: MemoryScope): number {
    if (!scope) {
      const count = this.entries.size;
      this.entries.clear();
      this.persist();
      return count;
    }
    const ids = Array.from(this.entries.values())
      .filter((e) => e.scope === scope)
      .map((e) => e.id);
    return this.forgetMany(ids);
  }

  // ============ 压缩 API ============

  /**
   * 压缩：合并相似记忆
   */
  compress(): { merged: number; removed: number } {
    const all = Array.from(this.entries.values());
    const merged: GlobalMemoryEntry[] = [];
    const removedIds: string[] = [];
    let mergeCount = 0;

    for (const entry of all) {
      // 查找可合并的（相同类型 + 至少 2 个共同标签 + 内容关键词重叠 > 50%）
      const similar = merged.find((m) => {
        if (m.type !== entry.type) return false;
        const commonTags = m.tags.filter((t) => entry.tags.includes(t));
        if (commonTags.length < 2) return false;
        const overlap = this._contentOverlap(m.content, entry.content);
        return overlap > 0.5;
      });
      if (similar) {
        // 合并：保留 importance 更高 + accessCount 更大者
        const winner = similar.importance >= entry.importance ? similar : entry;
        const loser = similar.importance >= entry.importance ? entry : similar;
        winner.importance = Math.max(similar.importance, entry.importance);
        winner.accessCount = similar.accessCount + entry.accessCount;
        winner.tags = Array.from(new Set([...similar.tags, ...entry.tags]));
        winner.content = `${winner.content}\n--合并--\n${loser.content}`;
        winner.updatedAt = Date.now();
        this.entries.set(winner.id, winner);
        removedIds.push(loser.id);
        this.entries.delete(loser.id);
        mergeCount++;
      } else {
        merged.push(entry);
      }
    }

    this.persist();
    if (removedIds.length > 0) {
      this.eventBus.emit('memory-compressed', { merged: mergeCount, removed: removedIds.length });
    }
    return { merged: mergeCount, removed: removedIds.length };
  }

  /**
   * 自动压缩（如果达到阈值）
   */
  autoCompressIfNeeded(): boolean {
    if (!this.config.autoCompress) return false;
    if (this.entries.size < this.config.compressionThreshold) return false;
    const result = this.compress();
    return result.merged > 0;
  }

  /**
   * 内容关键词重叠度
   */
  private _contentOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let common = 0;
    wordsA.forEach((w) => {
      if (wordsB.has(w)) common++;
    });
    return common / Math.max(wordsA.size, wordsB.size);
  }

  // ============ 清理 API ============

  /**
   * FIFO 清理到 maxEntries
   */
  private evictIfNeeded(): void {
    if (this.entries.size <= this.config.maxEntries) return;
    const sorted = Array.from(this.entries.values()).sort((a, b) => {
      // 优先删除重要性低 + 访问少 + 较旧的
      const scoreA = a.importance * 0.6 + (a.accessCount > 0 ? 0.2 : 0) + (a.createdAt / 1e15) * 0.2;
      const scoreB = b.importance * 0.6 + (b.accessCount > 0 ? 0.2 : 0) + (b.createdAt / 1e15) * 0.2;
      return scoreA - scoreB;
    });
    const toRemove = sorted.slice(0, this.entries.size - this.config.maxEntries);
    toRemove.forEach((e) => this.entries.delete(e.id));
    this.persist();
  }

  /**
   * 清理过期记忆
   */
  cleanExpired(): number {
    const now = Date.now();
    const expired = Array.from(this.entries.values()).filter((e) => e.expiresAt && e.expiresAt < now);
    expired.forEach((e) => {
      this.entries.delete(e.id);
      this.eventBus.emit('memory-expired', e);
    });
    if (expired.length > 0) this.persist();
    return expired.length;
  }

  // ============ 导入导出 ============

  /**
   * 导出
   */
  export(format: 'json' | 'markdown', scope?: MemoryScope): string {
    let entries = Array.from(this.entries.values());
    if (scope) entries = entries.filter((e) => e.scope === scope);
    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }
    // markdown
    const lines: string[] = ['# Global Memory Export', ''];
    entries.forEach((e) => {
      lines.push(`## [${MEMORY_TYPE_LABELS[e.type]}] ${e.tags.join(', ')}`);
      lines.push(`**Scope**: ${MEMORY_SCOPE_LABELS[e.scope]} | **Importance**: ${e.importance.toFixed(2)} | **Accesses**: ${e.accessCount}`);
      lines.push('');
      lines.push(e.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    return lines.join('\n');
  }

  /**
   * 导入
   */
  import(data: string, format: 'json' | 'markdown'): number {
    if (format === 'json') {
      try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return 0;
        let count = 0;
        parsed.forEach((e) => {
          if (e && e.type && e.content) {
            this.entries.set(e.id || generateId(), {
              ...e,
              id: e.id || generateId(),
              createdAt: e.createdAt || Date.now(),
              updatedAt: e.updatedAt || Date.now(),
              accessCount: e.accessCount || 0,
              importance: e.importance ?? 0.5,
              tags: e.tags || [],
              metadata: e.metadata || {},
            });
            count++;
          }
        });
        this.persist();
        return count;
      } catch {
        return 0;
      }
    }
    // markdown 解析
    let count = 0;
    // 按 --- 分段（容忍空行差异）
    const sections = data.split(/\n-{3,}\n/).concat(data.endsWith('---') ? [] : [data.split(/\n---$/).pop() || '']);
    sections.forEach((secRaw) => {
      const sec = secRaw.trim();
      if (!sec) return;
      const lines = sec.split('\n');
      // 查找 ## [...] 行
      const h2Idx = lines.findIndex((l) => /^##\s*\[.+\]/.test(l));
      if (h2Idx < 0) return;
      const headerLine = lines[h2Idx];
      const m = headerLine.match(/^##\s*\[(.+?)\]\s*(.+)?$/);
      if (!m) return;
      const typeLabel = m[1].trim();
      const tagsStr = m[2] || '';
      const type = (Object.entries(MEMORY_TYPE_LABELS).find(([, v]) => v === typeLabel)?.[0] || 'fact') as MemoryType;
      const tags = tagsStr
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      // 找内容（**Scope** 行之后到下一个 --- 或文件结尾）
      const scopeIdx = lines.findIndex((l) => l.startsWith('**Scope**'));
      if (scopeIdx < 0) return;
      const contentLines = lines.slice(scopeIdx + 1);
      // 过滤空行 + Scope 段
      const filtered: string[] = [];
      let started = false;
      for (const l of contentLines) {
        if (!started && l.trim() === '') continue;
        started = true;
        if (l.trim() === '---') break;
        filtered.push(l);
      }
      const content = filtered.join('\n').trim();
      if (content) {
        this.remember({
          type,
          content,
          tags,
          scope: 'user',
          metadata: {},
        });
        count++;
      }
    });
    return count;
  }

  // ============ 统计 / 配置 ============

  /**
   * 获取统计
   */
  getStats(): GlobalMemoryStats {
    const all = Array.from(this.entries.values());
    const byType: Record<MemoryType, number> = {
      preference: 0,
      decision: 0,
      fact: 0,
      context: 0,
      feedback: 0,
      rule: 0,
    };
    const byScope: Record<MemoryScope, number> = {
      user: 0,
      project: 0,
      cycle: 0,
    };
    let totalImportance = 0;
    let totalAccess = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    let expiredCount = 0;
    const now = Date.now();

    all.forEach((e) => {
      byType[e.type]++;
      byScope[e.scope]++;
      totalImportance += e.importance;
      totalAccess += e.accessCount;
      if (oldest === null || e.createdAt < oldest) oldest = e.createdAt;
      if (newest === null || e.createdAt > newest) newest = e.createdAt;
      if (e.expiresAt && e.expiresAt < now) expiredCount++;
    });

    return {
      totalEntries: all.length,
      byType,
      byScope,
      totalAccessCount: totalAccess,
      averageImportance: all.length > 0 ? totalImportance / all.length : 0,
      oldestEntryAt: oldest,
      newestEntryAt: newest,
      expiredCount,
    };
  }

  getConfig(): GlobalMemoryConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<GlobalMemoryConfig>): void {
    this.config = { ...this.config, ...patch };
    this.eventBus.emit('config-updated', this.config);
  }

  /**
   * 获取所有条目（用于调试）
   */
  getAll(): GlobalMemoryEntry[] {
    return Array.from(this.entries.values());
  }

  // ============ 事件订阅 ============

  on(type: GlobalMemoryEventType, handler: GlobalMemoryEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }
}

// ============ 单例管理 ============

let _instance: GlobalMemoryEngine | null = null;

export function getGlobalMemoryEngine(): GlobalMemoryEngine {
  if (!_instance) {
    _instance = new GlobalMemoryEngine();
  }
  return _instance;
}

export function resetGlobalMemoryEngine(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

export function setGlobalMemoryEngine(engine: GlobalMemoryEngine): void {
  _instance = engine;
}

export function isGlobalMemoryEngineInitialized(): boolean {
  return _instance !== null;
}
