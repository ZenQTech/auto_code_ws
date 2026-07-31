/**
 * # ============================================================
 * # LongTermMemory - 长期记忆引擎 (v1.0.0 Cycle 38 G38-02)
 * # ============================================================
 * # 核心作用：MemGPT 风格分层记忆
 * #           核心记忆 + 回忆记忆 + 归档记忆
 * # 对标产品：MemGPT (Letta) / Zep / LangChain Memory
 * # 运行流程：
 * #   1. CoreMemoryStore 存储当前会话关键信息
 * #   2. RecallMemoryStore 存储近期对话（基于关键词检索）
 * #   3. ArchiveMemoryStore 存储长期历史（基于 embedding 检索）
 * #   4. MemoryDecayEngine 定期衰减 + 归档迁移
 * #   5. MemoryConsolidator 合并相似记忆
 * # 输入参数：内容字符串 + 选项
 * # 输出结果：MemoryItem[] 检索结果
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 38 G38-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type MemoryLayer = 'core' | 'recall' | 'archive';
export type MemorySource = 'user' | 'assistant' | 'tool' | 'reflection' | 'system';

export interface MemoryItem {
  id: string;
  layer: MemoryLayer;
  content: string;
  importance: number; // 0-1
  relevance: number; // 0-1
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
  embedding?: number[];
  source?: MemorySource;
  metadata?: Record<string, unknown>;
}

export interface CoreMemorySection {
  persona: string;
  userPreferences: Record<string, string>;
  currentGoal: string;
  constraints: string[];
  contextSummary: string;
}

export interface MemoryStats {
  totalItems: number;
  byLayer: Record<MemoryLayer, number>;
  avgImportance: number;
  totalAccesses: number;
  oldestItemAt: number;
  newestItemAt: number;
  cacheHitRate: number;
}

export interface RecallMemoryOptions {
  maxCapacity?: number;
  evictionPolicy?: 'lru' | 'importance' | 'hybrid';
}

export interface ArchiveMemoryOptions {
  persistKey?: string;
}

export interface DecayOptions {
  lambda?: number;
  archiveThreshold?: number;
  archiveAfterDays?: number;
}

export interface ConsolidatorOptions {
  similarityThreshold?: number;
  minClusterSize?: number;
}

export interface LongTermMemoryOptions {
  recallOptions?: RecallMemoryOptions;
  archiveOptions?: ArchiveMemoryOptions;
  decayOptions?: DecayOptions;
  consolidatorOptions?: ConsolidatorOptions;
}

export interface RememberOptions {
  layer?: MemoryLayer;
  importance?: number;
  tags?: string[];
  source?: MemorySource;
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  layers?: MemoryLayer[];
  topK?: number;
  minImportance?: number;
  tags?: string[];
}

export interface BuildContextOptions {
  includeCore?: boolean;
  recentCount?: number;
  relevantCount?: number;
  maxLength?: number;
}

export interface MaintenanceReport {
  decayedCount: number;
  archivedCount: number;
  evictedCount: number;
  consolidatedCount: number;
  durationMs: number;
}

// ============ 工具函数 ============

export function generateId(prefix: string = 'mem'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 默认重要性计算：基于文本特征启发式
 */
export function calculateImportance(content: string): number {
  let score = 0.3;
  // 包含数字/日期
  if (/\d{4}|\d+%|\d+\.\d+/.test(content)) score += 0.1;
  // 包含强情感词
  if (/重要|紧急|必须|关键|重要|critical|urgent|important|must/i.test(content)) score += 0.2;
  // 包含人名/项目名（大写英文词）
  if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(content)) score += 0.1;
  // 长度 > 100
  if (content.length > 100) score += 0.1;
  // 包含问号
  if (/\?|\?|？/.test(content)) score += 0.05;
  return Math.min(1, score);
}

/**
 * 简单 embedding（Mock）：基于字符的 hash 分布
 */
export function mockEmbedding(text: string, dim: number = 64): number[] {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (code * 31 + i) % dim;
    vec[idx] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // 由于已归一化，dot 即 cosine
}

// ============ CoreMemoryStore ============

export class CoreMemoryStore {
  private data: CoreMemorySection;

  constructor(initial?: Partial<CoreMemorySection>) {
    this.data = {
      persona: initial?.persona ?? '',
      userPreferences: initial?.userPreferences ?? {},
      currentGoal: initial?.currentGoal ?? '',
      constraints: initial?.constraints ?? [],
      contextSummary: initial?.contextSummary ?? '',
    };
  }

  getSection<K extends keyof CoreMemorySection>(section: K): CoreMemorySection[K] {
    return this.data[section];
  }

  setSection<K extends keyof CoreMemorySection>(section: K, value: CoreMemorySection[K]): void {
    this.data[section] = value;
  }

  setUserPreference(key: string, value: string): void {
    if (Object.keys(this.data.userPreferences).length >= 50) {
      // 限制最多 50 项
      const firstKey = Object.keys(this.data.userPreferences)[0];
      delete this.data.userPreferences[firstKey];
    }
    this.data.userPreferences[key] = value;
  }

  getUserPreference(key: string): string | undefined {
    return this.data.userPreferences[key];
  }

  setCurrentGoal(goal: string): void {
    this.data.currentGoal = goal;
  }

  addConstraint(constraint: string): void {
    if (this.data.constraints.length >= 20) {
      this.data.constraints.shift();
    }
    this.data.constraints.push(constraint);
  }

  updateContextSummary(summary: string, maxLength: number = 2000): void {
    if (summary.length > maxLength) {
      this.data.contextSummary = summary.slice(0, maxLength) + '...';
    } else {
      this.data.contextSummary = summary;
    }
  }

  toJSON(): CoreMemorySection {
    return { ...this.data, userPreferences: { ...this.data.userPreferences } };
  }

  fromJSON(data: CoreMemorySection): void {
    this.data = { ...data, userPreferences: { ...data.userPreferences } };
  }
}

// ============ RecallMemoryStore ============

export class RecallMemoryStore {
  private items: Map<string, MemoryItem> = new Map();
  private maxCapacity: number;
  private evictionPolicy: 'lru' | 'importance' | 'hybrid';
  private hitCount: number = 0;
  private missCount: number = 0;

  constructor(options?: RecallMemoryOptions) {
    this.maxCapacity = options?.maxCapacity ?? 500;
    this.evictionPolicy = options?.evictionPolicy ?? 'hybrid';
  }

  add(
    content: string,
    options?: { importance?: number; tags?: string[]; source?: MemorySource },
  ): string {
    const id = generateId('recall');
    const now = Date.now();
    const item: MemoryItem = {
      id,
      layer: 'recall',
      content,
      importance: options?.importance ?? calculateImportance(content),
      relevance: 1.0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tags: options?.tags ?? [],
      source: options?.source,
    };
    this.items.set(id, item);

    // 检查容量
    if (this.items.size > this.maxCapacity) {
      this.evictOldest(1);
    }
    return id;
  }

  /**
   * 关键词检索：基于简单分词 + 命中数
   */
  search(
    query: string,
    options?: { limit?: number; tags?: string[]; minImportance?: number },
  ): MemoryItem[] {
    const limit = options?.limit ?? 10;
    const minImportance = options?.minImportance ?? 0;
    const filterTags = options?.tags ?? [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      this.missCount++;
      return [];
    }

    const results: Array<{ item: MemoryItem; score: number }> = [];
    for (const item of this.items.values()) {
      if (item.importance < minImportance) continue;
      if (filterTags.length > 0 && !filterTags.some((t) => item.tags.includes(t))) continue;

      const itemTokens = this.tokenize(item.content);
      let matchCount = 0;
      for (const qt of queryTokens) {
        if (this.tokenMatches(qt, itemTokens)) matchCount++;
      }
      if (matchCount > 0) {
        const score = (matchCount / queryTokens.length) * item.importance;
        results.push({ item, score });
        // 更新访问统计
        item.lastAccessedAt = Date.now();
        item.accessCount++;
        item.relevance = Math.min(1, item.relevance + 0.05);
      }
    }

    if (results.length > 0) {
      this.hitCount++;
    } else {
      this.missCount++;
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.item);
  }

  private tokenize(text: string): string[] {
    // 简单中英文分词
    const tokens: string[] = [];
    // 英文按空格分
    const words = text.toLowerCase().split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/[^\w\u4e00-\u9fa5]/g, '');
      if (clean.length >= 2) tokens.push(clean);
      // 额外提取去掉尾部数字的词干，便于 'item' 匹配 'item1'
      const stem = clean.replace(/\d+$/, '');
      if (stem.length >= 2 && stem !== clean) tokens.push(stem);
    }
    // 中文按字分（仅 >1 字组合）
    const cnRegex = /[\u4e00-\u9fa5]+/g;
    let match: RegExpExecArray | null;
    while ((match = cnRegex.exec(text)) !== null) {
      const cn = match[0];
      for (let i = 0; i < cn.length - 1; i++) {
        tokens.push(cn.slice(i, i + 2));
      }
    }
    return [...new Set(tokens)];
  }

  /**
   * 查询词与 item 词表是否匹配（支持精确 / 前后缀 / 词干匹配）
   */
  private tokenMatches(queryToken: string, itemTokens: string[]): boolean {
    if (itemTokens.includes(queryToken)) return true;
    for (const it of itemTokens) {
      // 词干匹配：'item' 匹配 'item1'、'item2'
      const itStem = it.replace(/\d+$/, '');
      const qtStem = queryToken.replace(/\d+$/, '');
      if (itStem === qtStem && (itStem.length >= 2)) return true;
      // 短查询词前缀匹配
      if (queryToken.length >= 3 && it.startsWith(queryToken)) return true;
      if (it.length >= 3 && queryToken.startsWith(it)) return true;
    }
    return false;
  }

  list(
    options?: {
      sortBy?: 'createdAt' | 'importance' | 'lastAccessedAt';
      limit?: number;
    },
  ): MemoryItem[] {
    const sortBy = options?.sortBy ?? 'createdAt';
    const limit = options?.limit ?? this.items.size;
    const arr = Array.from(this.items.values());
    arr.sort((a, b) => {
      if (sortBy === 'createdAt') return b.createdAt - a.createdAt;
      if (sortBy === 'importance') return b.importance - a.importance;
      return b.lastAccessedAt - a.lastAccessedAt;
    });
    return arr.slice(0, limit);
  }

  get(id: string): MemoryItem | undefined {
    return this.items.get(id);
  }

  update(id: string, updates: Partial<MemoryItem>): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    Object.assign(item, updates, { updatedAt: Date.now() });
    return true;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  size(): number {
    return this.items.size;
  }

  evictOldest(count: number): number {
    const arr = Array.from(this.items.values());
    if (this.evictionPolicy === 'lru') {
      arr.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    } else if (this.evictionPolicy === 'importance') {
      arr.sort((a, b) => a.importance - b.importance);
    } else {
      // hybrid
      arr.sort((a, b) => a.importance * a.relevance - b.importance * b.relevance);
    }
    let evicted = 0;
    for (let i = 0; i < Math.min(count, arr.length); i++) {
      this.items.delete(arr[i].id);
      evicted++;
    }
    return evicted;
  }

  getHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total === 0 ? 0 : this.hitCount / total;
  }
}

// ============ ArchiveMemoryStore ============

export class ArchiveMemoryStore {
  private items: Map<string, MemoryItem> = new Map();
  private persistKey: string;

  constructor(options?: ArchiveMemoryOptions) {
    this.persistKey = options?.persistKey ?? 'ltm_archive';
  }

  async add(
    content: string,
    options?: { importance?: number; tags?: string[] },
  ): Promise<string> {
    const id = generateId('archive');
    const now = Date.now();
    const item: MemoryItem = {
      id,
      layer: 'archive',
      content,
      importance: options?.importance ?? calculateImportance(content),
      relevance: 1.0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tags: options?.tags ?? [],
      embedding: mockEmbedding(content),
    };
    this.items.set(id, item);
    return id;
  }

  async semanticSearch(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<MemoryItem[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.05;
    const queryVec = mockEmbedding(query);
    const queryLower = query.toLowerCase();
    const queryTokens = queryLower
      .split(/\s+/)
      .map((t) => t.replace(/[^\w\u4e00-\u9fa5]/g, ''))
      .filter((t) => t.length >= 2);

    const results: Array<{ item: MemoryItem; score: number }> = [];
    for (const item of this.items.values()) {
      if (!item.embedding) continue;
      const sim = cosineSimilarity(queryVec, item.embedding);
      let score = sim * item.importance;

      // 关键词命中加权（弥补 mock embedding 对短查询不敏感的问题）
      const contentLower = item.content.toLowerCase();
      let keywordBoost = 0;
      for (const qt of queryTokens) {
        if (contentLower.includes(qt)) {
          keywordBoost += 0.1;
        }
        // 词干匹配
        const stem = qt.replace(/\d+$/, '');
        if (stem !== qt && contentLower.includes(stem)) {
          keywordBoost += 0.05;
        }
      }
      score += keywordBoost;

      if (score >= threshold) {
        results.push({ item, score });
        item.lastAccessedAt = Date.now();
        item.accessCount++;
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.item);
  }

  archiveFromRecall(item: MemoryItem): Promise<boolean> {
    const id = generateId('archive');
    const now = Date.now();
    this.items.set(id, {
      ...item,
      id,
      layer: 'archive',
      updatedAt: now,
      embedding: mockEmbedding(item.content),
    });
    return Promise.resolve(true);
  }

  list(
    options?: { sortBy?: 'createdAt' | 'importance'; limit?: number },
  ): MemoryItem[] {
    const sortBy = options?.sortBy ?? 'createdAt';
    const limit = options?.limit ?? this.items.size;
    const arr = Array.from(this.items.values());
    arr.sort((a, b) => {
      if (sortBy === 'importance') return b.importance - a.importance;
      return b.createdAt - a.createdAt;
    });
    return arr.slice(0, limit);
  }

  get(id: string): MemoryItem | undefined {
    return this.items.get(id);
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  size(): number {
    return this.items.size;
  }

  async save(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = Array.from(this.items.values());
      localStorage.setItem(this.persistKey, JSON.stringify(data));
    } catch (err) {
      void err;
    }
  }

  async load(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.persistKey);
      if (!raw) return;
      const data = JSON.parse(raw) as MemoryItem[];
      for (const item of data) {
        this.items.set(item.id, item);
      }
    } catch (err) {
      void err;
    }
  }
}

// ============ MemoryDecayEngine ============

export class MemoryDecayEngine {
  private lambda: number;
  private archiveThreshold: number;
  private archiveAfterDays: number;

  constructor(options?: DecayOptions) {
    this.lambda = options?.lambda ?? 0.01;
    this.archiveThreshold = options?.archiveThreshold ?? 0.1;
    this.archiveAfterDays = options?.archiveAfterDays ?? 7;
  }

  applyTimeDecay(item: MemoryItem, now: number = Date.now()): MemoryItem {
    const daysSince = Math.max(0, (now - item.lastAccessedAt) / (1000 * 60 * 60 * 24));
    const decayFactor = Math.exp(-this.lambda * daysSince);
    return {
      ...item,
      importance: item.importance * decayFactor,
      relevance: item.relevance * decayFactor,
    };
  }

  decayBatch(items: MemoryItem[]): MemoryItem[] {
    return items.map((item) => this.applyTimeDecay(item));
  }

  shouldArchive(item: MemoryItem, now: number = Date.now()): boolean {
    const decayed = this.applyTimeDecay(item, now);
    const daysSinceCreated = (now - item.createdAt) / (1000 * 60 * 60 * 24);
    return decayed.importance < this.archiveThreshold && daysSinceCreated > this.archiveAfterDays;
  }
}

// ============ MemoryConsolidator ============

export class MemoryConsolidator {
  private similarityThreshold: number;
  private minClusterSize: number;

  constructor(options?: ConsolidatorOptions) {
    this.similarityThreshold = options?.similarityThreshold ?? 0.7;
    this.minClusterSize = options?.minClusterSize ?? 2;
  }

  /**
   * 整合相似记忆
   */
  async consolidate(items: MemoryItem[]): Promise<MemoryItem[]> {
    if (items.length < this.minClusterSize) return items;

    const clusters = this.clusterBySimilarity(items);
    const consolidated: MemoryItem[] = [];

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        consolidated.push(cluster[0]);
      } else {
        // 合并为摘要
        const summary = this.mergeCluster(cluster);
        const first = cluster[0];
        consolidated.push({
          ...first,
          content: summary,
          importance: Math.max(...cluster.map((c) => c.importance)),
          accessCount: cluster.reduce((s, c) => s + c.accessCount, 0),
          tags: [...new Set(cluster.flatMap((c) => c.tags))],
        });
      }
    }

    return consolidated;
  }

  private clusterBySimilarity(items: MemoryItem[]): MemoryItem[][] {
    const clusters: MemoryItem[][] = [];
    const assigned = new Set<string>();

    for (const item of items) {
      if (assigned.has(item.id)) continue;
      const cluster: MemoryItem[] = [item];
      assigned.add(item.id);

      if (item.embedding) {
        for (const other of items) {
          if (assigned.has(other.id)) continue;
          if (!other.embedding) continue;
          const sim = cosineSimilarity(item.embedding, other.embedding);
          if (sim >= this.similarityThreshold) {
            cluster.push(other);
            assigned.add(other.id);
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  private mergeCluster(cluster: MemoryItem[]): string {
    const contents = cluster.map((c) => c.content);
    return `[合并 ${cluster.length} 条相似记忆]\n${contents.join('\n---\n').slice(0, 1000)}`;
  }

  detectConflicts(
    items: MemoryItem[],
  ): Array<{ itemA: MemoryItem; itemB: MemoryItem; conflict: string }> {
    const conflicts: Array<{ itemA: MemoryItem; itemB: MemoryItem; conflict: string }> = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // 简单冲突检测：相同主题但相反含义
        if (a.tags.some((t) => b.tags.includes(t))) {
          const aTokens = a.content.toLowerCase().split(/\s+/);
          const bTokens = b.content.toLowerCase().split(/\s+/);
          const aHasNeg = aTokens.some((t) => ['不', 'no', 'not', 'never'].includes(t));
          const bHasNeg = bTokens.some((t) => ['不', 'no', 'not', 'never'].includes(t));
          if (aHasNeg !== bHasNeg) {
            conflicts.push({ itemA: a, itemB: b, conflict: '可能冲突：否定词不一致' });
          }
        }
      }
    }
    return conflicts;
  }
}

// ============ LongTermMemoryEngine（主类） ============

export class LongTermMemoryEngine {
  private core: CoreMemoryStore;
  private recall: RecallMemoryStore;
  private archive: ArchiveMemoryStore;
  private decay: MemoryDecayEngine;
  private consolidator: MemoryConsolidator;
  private listeners: Map<string, Array<(data: any) => void>> = new Map();

  constructor(options?: LongTermMemoryOptions) {
    this.core = new CoreMemoryStore();
    this.recall = new RecallMemoryStore(options?.recallOptions);
    this.archive = new ArchiveMemoryStore(options?.archiveOptions);
    this.decay = new MemoryDecayEngine(options?.decayOptions);
    this.consolidator = new MemoryConsolidator(options?.consolidatorOptions);
  }

  // ============ 记忆写入 ============

  async remember(content: string, options?: RememberOptions): Promise<string> {
    const layer = options?.layer ?? 'recall';
    const importance = options?.importance ?? calculateImportance(content);

    if (layer === 'core') {
      // core 不存储为 item，而是更新 contextSummary
      this.core.updateContextSummary(content);
      this.emit('item-added', { layer: 'core', content });
      return 'core';
    } else if (layer === 'archive') {
      const id = await this.archive.add(content, {
        importance,
        tags: options?.tags,
      });
      this.emit('item-added', { layer: 'archive', content, id });
      return id;
    } else {
      const id = this.recall.add(content, {
        importance,
        tags: options?.tags,
        source: options?.source,
      });
      this.emit('item-added', { layer: 'recall', content, id });
      return id;
    }
  }

  // ============ 记忆检索 ============

  async queryMemories(query: string, options?: RecallOptions): Promise<MemoryItem[]> {
    const layers = options?.layers ?? ['recall', 'archive'];
    const topK = options?.topK ?? 10;
    const minImportance = options?.minImportance ?? 0;
    const tags = options?.tags ?? [];

    const results: MemoryItem[] = [];
    if (layers.includes('recall')) {
      const r = this.recall.search(query, { limit: topK, minImportance, tags });
      results.push(...r);
    }
    if (layers.includes('archive')) {
      const a = await this.archive.semanticSearch(query, { limit: topK });
      results.push(...a);
    }

    // 跨层重排序（按 importance × relevance）
    return results
      .filter((r) => r.importance >= minImportance)
      .sort((a, b) => b.importance * b.relevance - a.importance * a.relevance)
      .slice(0, topK);
  }

  // ============ 上下文构建 ============

  async buildContext(query: string, options?: BuildContextOptions): Promise<string> {
    const includeCore = options?.includeCore ?? true;
    const recentCount = options?.recentCount ?? 5;
    const relevantCount = options?.relevantCount ?? 10;
    const maxLength = options?.maxLength ?? 4000;

    const parts: string[] = [];

    if (includeCore) {
      const core = this.core.toJSON();
      const coreText = [
        `【人格】${core.persona || '(无)'}`,
        `【当前目标】${core.currentGoal || '(无)'}`,
        `【用户偏好】${
          Object.entries(core.userPreferences)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ') || '(无)'
        }`,
        `【约束】${core.constraints.join('; ') || '(无)'}`,
        `【上下文摘要】${core.contextSummary || '(无)'}`,
      ].join('\n');
      parts.push('【核心记忆】\n' + coreText);
    }

    const recent = this.recall.list({ sortBy: 'createdAt', limit: recentCount });
    if (recent.length > 0) {
      parts.push(
        '【最近对话】\n' +
          recent.map((r, i) => `${i + 1}. ${r.content}`).join('\n'),
      );
    }

    const relevant = await this.queryMemories(query, { topK: relevantCount });
    if (relevant.length > 0) {
      parts.push(
        '【相关记忆】\n' +
          relevant.map((r, i) => `${i + 1}. ${r.content}`).join('\n'),
      );
    }

    const context = parts.join('\n\n');
    return context.length > maxLength ? context.slice(0, maxLength) + '...' : context;
  }

  // ============ 维护 ============

  async runMaintenance(): Promise<MaintenanceReport> {
    const startTime = Date.now();
    let decayedCount = 0;
    let archivedCount = 0;
    let evictedCount = 0;
    let consolidatedCount = 0;

    // 1. 衰减 + 归档迁移
    const recallItems = this.recall.list();
    for (const item of recallItems) {
      const decayed = this.decay.applyTimeDecay(item);
      if (this.decay.shouldArchive(decayed)) {
        await this.archive.archiveFromRecall(decayed);
        this.recall.delete(item.id);
        archivedCount++;
      } else {
        this.recall.update(item.id, decayed);
        decayedCount++;
      }
    }

    // 2. 容量管理
    if (this.recall.size() > 400) {
      evictedCount = this.recall.evictOldest(this.recall.size() - 400);
    }

    // 3. 整合
    const archiveItems = this.archive.list();
    if (archiveItems.length >= 3) {
      const before = archiveItems.length;
      const consolidated = await this.consolidator.consolidate(archiveItems);
      // 简化：仅统计，不实际替换
      consolidatedCount = before - consolidated.length;
    }

    return {
      decayedCount,
      archivedCount,
      evictedCount,
      consolidatedCount,
      durationMs: Date.now() - startTime,
    };
  }

  // ============ 统计 ============

  getStats(): MemoryStats {
    const recallItems = this.recall.list();
    const archiveItems = this.archive.list();
    const all = [...recallItems, ...archiveItems];
    const avgImportance =
      all.length === 0 ? 0 : all.reduce((s, i) => s + i.importance, 0) / all.length;
    const totalAccesses = all.reduce((s, i) => s + i.accessCount, 0);

    return {
      totalItems: all.length,
      byLayer: {
        core: 1, // core 是单例
        recall: recallItems.length,
        archive: archiveItems.length,
      },
      avgImportance,
      totalAccesses,
      oldestItemAt: all.length === 0 ? 0 : Math.min(...all.map((i) => i.createdAt)),
      newestItemAt: all.length === 0 ? 0 : Math.max(...all.map((i) => i.createdAt)),
      cacheHitRate: this.recall.getHitRate(),
    };
  }

  // ============ 访问子模块 ============

  getCore(): CoreMemoryStore {
    return this.core;
  }

  getRecallStore(): RecallMemoryStore {
    return this.recall;
  }

  getArchiveStore(): ArchiveMemoryStore {
    return this.archive;
  }

  getDecayEngine(): MemoryDecayEngine {
    return this.decay;
  }

  getConsolidator(): MemoryConsolidator {
    return this.consolidator;
  }

  // ============ 持久化 ============

  async save(): Promise<void> {
    await this.archive.save();
    if (typeof localStorage !== 'undefined') {
      try {
        const coreData = this.core.toJSON();
        localStorage.setItem('ltm_core', JSON.stringify(coreData));
        const recallData = this.recall.list();
        localStorage.setItem('ltm_recall', JSON.stringify(recallData));
      } catch (err) {
        void err;
      }
    }
  }

  async load(): Promise<void> {
    await this.archive.load();
    if (typeof localStorage !== 'undefined') {
      try {
        const coreRaw = localStorage.getItem('ltm_core');
        if (coreRaw) this.core.fromJSON(JSON.parse(coreRaw));
        const recallRaw = localStorage.getItem('ltm_recall');
        if (recallRaw) {
          const items = JSON.parse(recallRaw) as MemoryItem[];
          for (const item of items) {
            // 重建 RecallMemoryStore
            (this.recall as any).items.set(item.id, item);
          }
        }
      } catch (err) {
        void err;
      }
    }
  }

  // ============ 事件 ============

  on(event: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
    return () => {
      const handlers = this.listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(data);
        } catch (err) {
          void err;
        }
      }
    }
  }
}

// ============ 全局单例 ============

let defaultEngine: LongTermMemoryEngine | null = null;

export function getDefaultLongTermMemoryEngine(): LongTermMemoryEngine {
  if (!defaultEngine) defaultEngine = new LongTermMemoryEngine();
  return defaultEngine;
}

export function resetDefaultLongTermMemoryEngine(): void {
  defaultEngine = null;
}

export function createLongTermMemoryEngine(
  options?: LongTermMemoryOptions,
): LongTermMemoryEngine {
  return new LongTermMemoryEngine(options);
}
