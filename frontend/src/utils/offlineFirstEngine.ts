/**
 * # ============================================================
 * # Offline First Engine - 离线优先工作流引擎 (v1.0.0 Cycle 34 G34-02)
 * # ============================================================
 * # 核心作用：实现离线优先工作流，覆盖断网检测 + 本地队列 + CRDT 同步 + 引擎降级
 * # 对标 Trae Solo 离线模式 + Local-First 七大原则
 * # 运行流程：
 * #   1. 初始化引擎 + 网络状态检测器
 * #   2. start() 启动网络监听（online/offline 事件 + 主动 ping）
 * #   3. enqueue() 将操作加入本地队列
 * #   4. 联网后自动 syncNow() 同步队列
 * #   5. createCRDT() 创建 CRDT 文档（LWW-Map / G-Counter / OR-Set / LWW-Register）
 * #   6. updateCRDT() 更新 CRDT 状态（自动合并冲突）
 * #   7. registerFallback() 注册引擎降级链
 * #   8. executeWithFallback() 自动选择主引擎或降级
 * # 输入参数：
 * #   - config: OfflineFirstConfig（可选）
 * #   - operation: OperationLogEntry
 * #   - crdtType: 'counter' / 'register' / 'set' / 'map'
 * # 输出结果：
 * #   - 网络状态、操作队列、CRDT 文档、降级结果
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 34 G34-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type NetworkStatus = 'online' | 'offline' | 'unstable';

export type OperationStatus = 'pending' | 'syncing' | 'completed' | 'failed' | 'cancelled';

export type OperationType = 'create' | 'update' | 'delete' | 'execute' | 'message' | 'config';

export type SyncState = 'idle' | 'syncing' | 'paused' | 'error';

export type CRDTType = 'counter' | 'register' | 'set' | 'map';

export interface NetworkState {
  status: NetworkStatus;
  lastOnline: number;
  lastOffline: number;
  latencyMs: number | null;
  consecutiveFailures: number;
  pingEndpoint: string;
}

export interface OperationLogEntry {
  id: string;
  type: OperationType;
  collection: string;
  targetId: string;
  payload: any;
  status: OperationStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledFor: number;
  lastAttempt?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface CRDTDocument {
  id: string;
  collection: string;
  type: CRDTType;
  state: any;
  vectorClock: Record<string, number>;
  version: number;
  lastModified: number;
  history: Array<{ op: any; node: string; timestamp: number }>;
}

export interface FallbackChain {
  primaryEngine: string;
  fallbacks: Array<{
    engine: string;
    method: string;
    condition: 'always' | 'on-error' | 'on-resource-limit';
  }>;
  degradedFeatures: string[];
}

export interface OfflineFirstConfig {
  pingEndpoint: string;
  pingIntervalMs: number;
  maxQueueSize: number;
  maxRetries: number;
  retryBackoffMs: number;
  syncIntervalMs: number;
  persist: boolean;
  autoStart: boolean;
  nodeId: string;
}

export interface SyncStats {
  totalOperations: number;
  pendingOperations: number;
  failedOperations: number;
  completedOperations: number;
  avgSyncLatencyMs: number;
  totalSyncTime: number;
  lastSyncAt: number;
  lastSyncSuccessAt: number;
  lastSyncErrorAt: number;
}

export interface SyncResult {
  success: boolean;
  totalProcessed: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  errors?: Array<{ id: string; error: string }>;
}

export interface BudgetUsage {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

export type OfflineEvent =
  | 'network-status-changed'
  | 'operation-queued'
  | 'operation-synced'
  | 'operation-failed'
  | 'sync-started'
  | 'sync-completed'
  | 'sync-failed'
  | 'crdt-updated'
  | 'crdt-conflict-resolved'
  | 'engine-degraded'
  | 'fallback-triggered';

// ============ 默认配置 ============

export const DEFAULT_OFFLINE_FIRST_CONFIG: OfflineFirstConfig = {
  pingEndpoint: '/api/health',
  pingIntervalMs: 30000,
  maxQueueSize: 10000,
  maxRetries: 3,
  retryBackoffMs: 1000,
  syncIntervalMs: 5000,
  persist: true,
  autoStart: true,
  nodeId: `node-${Math.random().toString(36).slice(2, 9)}`,
};

// ============ 工具函数 ============

export function generateOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateCRDTId(): string {
  return `crdt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ CRDT 实现 ============

/**
 * LWW-Register: Last-Write-Wins Register
 */
export class LWWRegister<T = any> {
  private value: T;
  private timestamp: number;
  private nodeId: string;

  constructor(value: T, timestamp: number = 0, nodeId: string = 'init') {
    this.value = value;
    this.timestamp = timestamp;
    this.nodeId = nodeId;
  }

  set(value: T, timestamp: number, nodeId: string): void {
    if (timestamp > this.timestamp || (timestamp === this.timestamp && nodeId > this.nodeId)) {
      this.value = value;
      this.timestamp = timestamp;
      this.nodeId = nodeId;
    }
  }

  get(): T {
    return this.value;
  }

  merge(other: LWWRegister<T>): void {
    if (other.timestamp > this.timestamp || (other.timestamp === this.timestamp && other.nodeId > this.nodeId)) {
      this.value = other.value;
      this.timestamp = other.timestamp;
      this.nodeId = other.nodeId;
    }
  }

  serialize(): { value: T; timestamp: number; nodeId: string } {
    return { value: this.value, timestamp: this.timestamp, nodeId: this.nodeId };
  }
}

/**
 * G-Counter: Grow-only Counter
 */
export class GCounter {
  private counts: Map<string, number> = new Map();

  increment(nodeId: string, amount: number = 1): void {
    const current = this.counts.get(nodeId) || 0;
    this.counts.set(nodeId, current + amount);
  }

  value(): number {
    let total = 0;
    for (const v of this.counts.values()) total += v;
    return total;
  }

  merge(other: GCounter): void {
    for (const [node, count] of other.counts.entries()) {
      const current = this.counts.get(node) || 0;
      if (count > current) this.counts.set(node, count);
    }
  }

  serialize(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  static fromSerialized(data: Record<string, number>): GCounter {
    const counter = new GCounter();
    for (const [k, v] of Object.entries(data)) counter.counts.set(k, v);
    return counter;
  }
}

/**
 * OR-Set: Observed-Remove Set
 */
export class ORSet<T = any> {
  private elements: Map<string, { value: T; added: number[]; removed: number[] }> = new Map();

  add(value: T, tag: number): void {
    const key = JSON.stringify(value);
    if (!this.elements.has(key)) {
      this.elements.set(key, { value, added: [], removed: [] });
    }
    const entry = this.elements.get(key)!;
    if (!entry.added.includes(tag)) {
      entry.added.push(tag);
    }
  }

  remove(value: T, tag: number): boolean {
    const key = JSON.stringify(value);
    const entry = this.elements.get(key);
    if (!entry) return false;
    if (!entry.removed.includes(tag)) {
      entry.removed.push(tag);
    }
    return true;
  }

  has(value: T): boolean {
    const key = JSON.stringify(value);
    const entry = this.elements.get(key);
    if (!entry) return false;
    return entry.added.length > entry.removed.length;
  }

  values(): T[] {
    const result: T[] = [];
    for (const entry of this.elements.values()) {
      if (entry.added.length > entry.removed.length) {
        result.push(entry.value);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): void {
    for (const [key, otherEntry] of other.elements.entries()) {
      if (!this.elements.has(key)) {
        this.elements.set(key, { ...otherEntry });
      } else {
        const entry = this.elements.get(key)!;
        // 合并 added
        for (const tag of otherEntry.added) {
          if (!entry.added.includes(tag)) entry.added.push(tag);
        }
        // 合并 removed
        for (const tag of otherEntry.removed) {
          if (!entry.removed.includes(tag)) entry.removed.push(tag);
        }
      }
    }
  }

  serialize(): Array<{ key: string; value: T; added: number[]; removed: number[] }> {
    const result = [];
    for (const [key, entry] of this.elements.entries()) {
      result.push({ key, ...entry });
    }
    return result;
  }
}

/**
 * LWW-Map: Last-Write-Wins Map
 */
export class LWWMap<V = any> {
  private entries: Map<string, LWWRegister<V>> = new Map();

  set(key: string, value: V, timestamp: number, nodeId: string): void {
    if (!this.entries.has(key)) {
      this.entries.set(key, new LWWRegister(value, timestamp, nodeId));
    } else {
      this.entries.get(key)!.set(value, timestamp, nodeId);
    }
  }

  get(key: string): V | undefined {
    return this.entries.get(key)?.get();
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  entries_obj(): Array<[string, V]> {
    return Array.from(this.entries.entries()).map(([k, reg]) => [k, reg.get()]);
  }

  size(): number {
    return this.entries.size;
  }

  merge(other: LWWMap<V>): void {
    for (const [key, reg] of other.entries.entries()) {
      if (!this.entries.has(key)) {
        this.entries.set(key, new LWWRegister(reg.get(), 0, 'init'));
      }
      this.entries.get(key)!.merge(reg);
    }
  }
}

// ============ 引擎主类 ============

export class OfflineFirstEngine {
  private config: OfflineFirstConfig;
  private networkState: NetworkState;
  private operationQueue: OperationLogEntry[] = [];
  private crdtDocuments: Map<string, CRDTDocument> = new Map();
  private engineFallbacks: Map<string, FallbackChain> = new Map();
  private syncState: SyncState = 'idle';
  private syncStats: SyncStats = {
    totalOperations: 0,
    pendingOperations: 0,
    failedOperations: 0,
    completedOperations: 0,
    avgSyncLatencyMs: 0,
    totalSyncTime: 0,
    lastSyncAt: 0,
    lastSyncSuccessAt: 0,
    lastSyncErrorAt: 0,
  };
  private listeners: Map<OfflineEvent, Set<(e: any) => void>> = new Map();
  private pingTimer: any = null;
  private syncTimer: any = null;
  private storageKey = 'hermes.offlineFirst';

  constructor(config: Partial<OfflineFirstConfig> = {}) {
    this.config = { ...DEFAULT_OFFLINE_FIRST_CONFIG, ...config };
    this.networkState = {
      status: typeof navigator !== 'undefined' && (navigator as any).onLine ? 'online' : 'offline',
      lastOnline: 0,
      lastOffline: 0,
      latencyMs: null,
      consecutiveFailures: 0,
      pingEndpoint: this.config.pingEndpoint,
    };
    if (this.config.persist) {
      this.load();
    }
    if (this.config.autoStart && typeof window !== 'undefined') {
      this.start();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state = JSON.parse(raw);
        if (Array.isArray(state.operationQueue)) this.operationQueue = state.operationQueue;
        if (state.crdtDocuments) {
          for (const [k, v] of Object.entries(state.crdtDocuments)) {
            this.crdtDocuments.set(k, v as CRDTDocument);
          }
        }
        if (state.engineFallbacks) {
          for (const [k, v] of Object.entries(state.engineFallbacks)) {
            this.engineFallbacks.set(k, v as FallbackChain);
          }
        }
      }
    } catch (e) {
      console.warn('OfflineFirstEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state = {
        operationQueue: this.operationQueue.slice(-this.config.maxQueueSize),
        crdtDocuments: Object.fromEntries(this.crdtDocuments),
        engineFallbacks: Object.fromEntries(this.engineFallbacks),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('OfflineFirstEngine: failed to save state', e);
    }
  }

  // ============ 事件订阅 ============

  on(event: OfflineEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: OfflineEvent, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(data); } catch (e) { console.error('Listener error:', e); }
      }
    }
  }

  // ============ 生命周期 ============

  start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    if (!this.pingTimer && typeof setInterval !== 'undefined') {
      this.pingTimer = setInterval(() => this.ping(), this.config.pingIntervalMs);
    }
    if (!this.syncTimer && typeof setInterval !== 'undefined') {
      this.syncTimer = setInterval(() => this.autoSync(), this.config.syncIntervalMs);
    }
    // 立即执行一次
    this.ping();
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private handleOnline = (): void => {
    this.setNetworkStatus('online');
  };

  private handleOffline = (): void => {
    this.setNetworkStatus('offline');
  };

  // ============ 网络管理 ============

  async ping(): Promise<boolean> {
    if (typeof fetch === 'undefined') {
      // 在 Node 环境（测试）下，假设在线
      this.setNetworkStatus('online');
      return true;
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(this.config.pingEndpoint, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.networkState.latencyMs = Date.now() - start;
      this.networkState.consecutiveFailures = 0;
      this.setNetworkStatus(response.ok ? 'online' : 'unstable');
      return response.ok;
    } catch (err) {
      this.networkState.consecutiveFailures++;
      if (this.networkState.consecutiveFailures >= 3) {
        this.setNetworkStatus('offline');
      } else {
        this.setNetworkStatus('unstable');
      }
      return false;
    }
  }

  private setNetworkStatus(status: NetworkStatus): void {
    const prev = this.networkState.status;
    this.networkState.status = status;
    if (status === 'online' && prev !== 'online') {
      this.networkState.lastOnline = Date.now();
    }
    if (status === 'offline' && prev !== 'offline') {
      this.networkState.lastOffline = Date.now();
    }
    this.emit('network-status-changed', { prev, current: status });
  }

  getNetworkState(): NetworkState {
    return { ...this.networkState };
  }

  isOnline(): boolean {
    return this.networkState.status === 'online' || this.networkState.status === 'unstable';
  }

  onNetworkChange(listener: (state: NetworkState) => void): () => void {
    return this.on('network-status-changed', () => listener({ ...this.networkState }));
  }

  // ============ 操作队列 ============

  enqueue(operation: Omit<OperationLogEntry, 'id' | 'status' | 'attempts' | 'createdAt'>): OperationLogEntry {
    if (this.operationQueue.length >= this.config.maxQueueSize) {
      // 移除最旧失败的操作
      const failedIndex = this.operationQueue.findIndex((o) => o.status === 'failed');
      if (failedIndex >= 0) {
        this.operationQueue.splice(failedIndex, 1);
      } else {
        throw new Error('Operation queue is full');
      }
    }

    const entry: OperationLogEntry = {
      ...operation,
      id: generateOperationId(),
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
    };
    this.operationQueue.push(entry);
    if (this.config.persist) this.save();
    this.emit('operation-queued', { operation: entry });
    return entry;
  }

  cancelOperation(id: string): boolean {
    const op = this.operationQueue.find((o) => o.id === id);
    if (!op) return false;
    op.status = 'cancelled';
    if (this.config.persist) this.save();
    return true;
  }

  retryOperation(id: string): boolean {
    const op = this.operationQueue.find((o) => o.id === id);
    if (!op || op.status !== 'failed') return false;
    op.status = 'pending';
    op.attempts = 0;
    op.error = undefined;
    if (this.config.persist) this.save();
    return true;
  }

  listOperations(filter?: { status?: OperationStatus; type?: OperationType; limit?: number }): OperationLogEntry[] {
    let ops = [...this.operationQueue];
    if (filter?.status) ops = ops.filter((o) => o.status === filter.status);
    if (filter?.type) ops = ops.filter((o) => o.type === filter.type);
    if (filter?.limit) ops = ops.slice(-filter.limit);
    return ops;
  }

  // ============ 同步管理 ============

  private async autoSync(): Promise<void> {
    if (this.syncState === 'paused' || this.syncState === 'syncing') return;
    if (!this.isOnline()) return;
    const pending = this.operationQueue.filter((o) => o.status === 'pending');
    if (pending.length === 0) return;
    await this.syncNow();
  }

  async syncNow(): Promise<SyncResult> {
    if (this.syncState === 'syncing') {
      return { success: false, totalProcessed: 0, succeeded: 0, failed: 0, durationMs: 0 };
    }
    this.syncState = 'syncing';
    this.emit('sync-started', {});
    const start = Date.now();
    const result: SyncResult = { success: true, totalProcessed: 0, succeeded: 0, failed: 0, durationMs: 0 };
    const errors: Array<{ id: string; error: string }> = [];

    try {
      const pending = this.operationQueue.filter((o) => o.status === 'pending');
      for (const op of pending) {
        if (!this.isOnline()) {
          result.success = false;
          break;
        }
        result.totalProcessed++;
        try {
          this.markOperation(op.id, 'syncing');
          await this.syncOne(op);
          this.markOperation(op.id, 'completed');
          this.syncStats.completedOperations++;
          result.succeeded++;
          this.emit('operation-synced', { operationId: op.id });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          op.attempts++;
          if (op.attempts >= this.config.maxRetries) {
            this.markOperation(op.id, 'failed', errorMsg);
            this.syncStats.failedOperations++;
            result.failed++;
            errors.push({ id: op.id, error: errorMsg });
            this.emit('operation-failed', { operationId: op.id, error: errorMsg });
          } else {
            this.markOperation(op.id, 'pending', errorMsg);
            // 计算下次重试时间（指数退避）
            op.scheduledFor = Date.now() + this.getBackoffMs(op.attempts);
          }
        }
      }
      this.syncStats.lastSyncAt = Date.now();
      this.syncStats.lastSyncSuccessAt = Date.now();
      result.durationMs = Date.now() - start;
      this.syncStats.totalSyncTime += result.durationMs;
      this.syncStats.avgSyncLatencyMs = result.totalProcessed > 0
        ? Math.round(this.syncStats.totalSyncTime / Math.max(1, this.syncStats.completedOperations))
        : 0;
      if (errors.length > 0) result.errors = errors;
      this.syncState = 'idle';
      this.emit('sync-completed', { result });
      if (this.config.persist) this.save();
    } catch (err) {
      this.syncStats.lastSyncErrorAt = Date.now();
      this.syncState = 'error';
      result.success = false;
      this.emit('sync-failed', { error: err });
      if (this.config.persist) this.save();
    }

    return result;
  }

  private async syncOne(_op: OperationLogEntry): Promise<void> {
    // Mock 同步：90% 成功率
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() < 0.05) {
          reject(new Error('Mock sync failure'));
        } else {
          resolve();
        }
      }, 5);
    });
  }

  private markOperation(id: string, status: OperationStatus, error?: string): void {
    const op = this.operationQueue.find((o) => o.id === id);
    if (!op) return;
    op.status = status;
    op.lastAttempt = Date.now();
    if (error) op.error = error;
  }

  private getBackoffMs(attempts: number): number {
    return this.config.retryBackoffMs * Math.pow(2, attempts) + Math.random() * 1000;
  }

  pauseSync(): void {
    this.syncState = 'paused';
  }

  resumeSync(): void {
    if (this.syncState === 'paused') this.syncState = 'idle';
  }

  getSyncState(): SyncState {
    return this.syncState;
  }

  getSyncStats(): SyncStats {
    return { ...this.syncStats };
  }

  // ============ CRDT 文档管理 ============

  createCRDT(id: string, collection: string, type: CRDTType, initial?: any): CRDTDocument {
    let state: any;
    switch (type) {
      case 'counter':
        state = new GCounter();
        if (initial) state.increment(this.config.nodeId, initial);
        break;
      case 'register':
        state = new LWWRegister(initial, Date.now(), this.config.nodeId);
        break;
      case 'set':
        state = new ORSet();
        if (Array.isArray(initial)) {
          for (const item of initial) state.add(item, Date.now());
        }
        break;
      case 'map':
        state = new LWWMap();
        if (initial && typeof initial === 'object') {
          for (const [k, v] of Object.entries(initial)) {
            state.set(k, v, Date.now(), this.config.nodeId);
          }
        }
        break;
    }

    const doc: CRDTDocument = {
      id,
      collection,
      type,
      state,
      vectorClock: { [this.config.nodeId]: 1 },
      version: 1,
      lastModified: Date.now(),
      history: [],
    };
    this.crdtDocuments.set(id, doc);
    if (this.config.persist) this.save();
    return doc;
  }

  getCRDT(id: string): CRDTDocument | undefined {
    return this.crdtDocuments.get(id);
  }

  updateCRDT(id: string, op: (doc: any) => void, nodeId?: string): void {
    const doc = this.crdtDocuments.get(id);
    if (!doc) throw new Error(`CRDT not found: ${id}`);
    const useNodeId = nodeId || this.config.nodeId;

    op(doc.state);

    doc.vectorClock[useNodeId] = (doc.vectorClock[useNodeId] || 0) + 1;
    doc.version++;
    doc.lastModified = Date.now();
    doc.history.push({ op: 'update', node: useNodeId, timestamp: Date.now() });

    if (this.config.persist) this.save();
    this.emit('crdt-updated', { id, version: doc.version });
  }

  mergeCRDT(id: string, otherState: any, otherClock: Record<string, number> = {}): boolean {
    const doc = this.crdtDocuments.get(id);
    if (!doc) return false;

    // 检测冲突
    let hasConflict = false;
    for (const node of Object.keys(otherClock)) {
      if ((doc.vectorClock[node] || 0) < otherClock[node]) {
        hasConflict = true;
        break;
      }
    }

    // 根据类型合并
    switch (doc.type) {
      case 'counter':
        if (otherState instanceof GCounter) {
          doc.state.merge(otherState);
        } else if (typeof otherState === 'object') {
          doc.state.merge(GCounter.fromSerialized(otherState));
        }
        break;
      case 'register':
        if (otherState instanceof LWWRegister) {
          doc.state.merge(otherState);
        } else {
          const other = new LWWRegister(otherState.value, otherState.timestamp, otherState.nodeId);
          doc.state.merge(other);
        }
        break;
      case 'set':
        if (otherState instanceof ORSet) {
          doc.state.merge(otherState);
        }
        break;
      case 'map':
        if (otherState instanceof LWWMap) {
          doc.state.merge(otherState);
        }
        break;
    }

    // 更新 vector clock
    for (const [node, clock] of Object.entries(otherClock)) {
      doc.vectorClock[node] = Math.max(doc.vectorClock[node] || 0, clock);
    }

    doc.version++;
    doc.lastModified = Date.now();
    if (hasConflict) this.emit('crdt-conflict-resolved', { id });
    if (this.config.persist) this.save();
    return true;
  }

  listCRDTs(): CRDTDocument[] {
    return Array.from(this.crdtDocuments.values());
  }

  // ============ 引擎降级 ============

  registerFallback(chain: FallbackChain): void {
    this.engineFallbacks.set(chain.primaryEngine, chain);
    if (this.config.persist) this.save();
  }

  async executeWithFallback(engine: string, method: string, args: any[]): Promise<any> {
    const chain = this.engineFallbacks.get(engine);

    // 尝试主引擎
    try {
      // Mock：实际项目里会通过引擎注册表查找
      const fn = (globalThis as any)[method];
      if (typeof fn === 'function') {
        return await fn(...args);
      }
      // Fallback: 返回 mock 结果
      return { result: `Mock result from ${engine}.${method}`, degraded: false };
    } catch (err) {
      this.emit('engine-degraded', { engine, method, error: (err as Error).message });

      if (!chain) {
        throw new Error(`Engine ${engine} failed and no fallback chain registered: ${(err as Error).message}`);
      }

      // 尝试 fallback
      for (const fallback of chain.fallbacks) {
        try {
          const result = { result: `Fallback result from ${fallback.engine}.${fallback.method}`, degraded: true, fallbackEngine: fallback.engine };
          this.emit('fallback-triggered', { from: engine, to: fallback.engine });
          return result;
        } catch {
          continue;
        }
      }

      throw new Error(`All fallbacks failed for ${engine}.${method}`);
    }
  }

  getFallbackChain(engine: string): FallbackChain | undefined {
    return this.engineFallbacks.get(engine);
  }

  // ============ 统计 ============

  getStats(): {
    network: NetworkState;
    queue: { total: number; pending: number; syncing: number; completed: number; failed: number; cancelled: number; byType: Record<OperationType, number> };
    sync: SyncStats;
    crdts: { total: number; byType: Record<CRDTType, number> };
    fallbacks: { registered: number; triggered: number };
  } {
    const queueStats = {
      total: this.operationQueue.length,
      pending: 0,
      syncing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      byType: { create: 0, update: 0, delete: 0, execute: 0, message: 0, config: 0 } as Record<OperationType, number>,
    };
    for (const op of this.operationQueue) {
      if (op.status === 'pending') queueStats.pending++;
      else if (op.status === 'syncing') queueStats.syncing++;
      else if (op.status === 'completed') queueStats.completed++;
      else if (op.status === 'failed') queueStats.failed++;
      else if (op.status === 'cancelled') queueStats.cancelled++;
      queueStats.byType[op.type]++;
    }

    const crdtStats = {
      total: this.crdtDocuments.size,
      byType: { counter: 0, register: 0, set: 0, map: 0 } as Record<CRDTType, number>,
    };
    for (const doc of this.crdtDocuments.values()) {
      crdtStats.byType[doc.type]++;
    }

    return {
      network: this.getNetworkState(),
      queue: queueStats,
      sync: this.getSyncStats(),
      crdts: crdtStats,
      fallbacks: { registered: this.engineFallbacks.size, triggered: 0 },
    };
  }

  // ============ 清理 ============

  clear(): void {
    this.operationQueue = [];
    this.crdtDocuments.clear();
    this.engineFallbacks.clear();
    this.syncStats = {
      totalOperations: 0,
      pendingOperations: 0,
      failedOperations: 0,
      completedOperations: 0,
      avgSyncLatencyMs: 0,
      totalSyncTime: 0,
      lastSyncAt: 0,
      lastSyncSuccessAt: 0,
      lastSyncErrorAt: 0,
    };
    if (this.config.persist) this.save();
  }

  // ============ 单例 ============

  private static defaultInstance: OfflineFirstEngine | null = null;

  static getDefault(): OfflineFirstEngine {
    if (!OfflineFirstEngine.defaultInstance) {
      OfflineFirstEngine.defaultInstance = new OfflineFirstEngine();
    }
    return OfflineFirstEngine.defaultInstance;
  }

  static resetDefault(): void {
    if (OfflineFirstEngine.defaultInstance) {
      OfflineFirstEngine.defaultInstance.stop();
      OfflineFirstEngine.defaultInstance.clear();
    }
    OfflineFirstEngine.defaultInstance = null;
  }
}

export function getDefaultOfflineFirstEngine(): OfflineFirstEngine {
  return OfflineFirstEngine.getDefault();
}

export function resetDefaultOfflineFirstEngine(): void {
  OfflineFirstEngine.resetDefault();
}
