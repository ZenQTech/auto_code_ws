/**
 * # ============================================================
 * # Remote Worktree Adapter - 远程 Worktree 适配器 (v1.0.0 Cycle 31 G31-02)
 * # ============================================================
 * # 核心作用：抽象 local / remote / hybrid 多种 Worktree 后端
 * # 智能选择：基于成本/延迟/可用性自动选择后端
 * # 会话迁移：local ↔ remote 双向迁移
 * # 健康检查：定期 ping 后端
 * # 参考：Cursor 3 Cloud Agent Handoff、Codex App、CodexMonitor
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化适配器 + 默认配置
 * #   2. registerBackend(config) 注册后端（local/remote/hybrid）
 * #   3. healthCheck() 定期健康检查
 * #   4. create() 创建 Worktree（自动选择后端）
 * #   5. migrateToRemote() / migrateToLocal() 会话迁移
 * #   6. 触发 worktree/migration 事件
 * # ============================================================
 * # 输入参数：WorktreeCreateOptions / WorktreeBackendConfig
 * # 输出结果：Worktree / MigrationReceipt
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 31 G31-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type BackendType = 'local' | 'remote' | 'hybrid';
export type WorktreeStatus = 'creating' | 'ready' | 'syncing' | 'paused' | 'migrating' | 'error';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline';

/**
 * Worktree 基础类型
 */
export interface Worktree {
  id: string;
  backendId: string;
  branch: string;
  baseBranch: string;
  path: string;
  status: WorktreeStatus;
  createdAt: number;
  lastSyncAt?: number;
  lastError?: string;
  metadata?: Record<string, any>;
  size?: number;
  fileCount?: number;
  commitCount?: number;
}

/**
 * Worktree 创建选项
 */
export interface WorktreeCreateOptions {
  branch: string;
  baseBranch: string;
  path?: string;
  backendId?: string;
  metadata?: Record<string, any>;
}

/**
 * 后端基础配置
 */
export interface WorktreeBackendConfigBase {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
}

export interface LocalBackendConfig extends WorktreeBackendConfigBase {
  type: 'local';
  basePath: string;
}

export interface RemoteBackendConfig extends WorktreeBackendConfigBase {
  type: 'remote';
  endpoint: string;
  authToken?: string;
  region?: string;
  sshConfig?: { host: string; port: number; user: string; keyPath?: string };
}

export interface HybridBackendConfig extends WorktreeBackendConfigBase {
  type: 'hybrid';
  localPath: string;
  remoteEndpoint: string;
  syncMode: 'on-save' | 'periodic' | 'manual';
  syncIntervalMs?: number;
  authToken?: string;
}

export type WorktreeBackendConfig = LocalBackendConfig | RemoteBackendConfig | HybridBackendConfig;

/**
 * Worktree Backend 接口（所有后端实现）
 */
export interface WorktreeBackend {
  readonly id: string;
  readonly type: BackendType;
  readonly name: string;
  healthCheck(): Promise<HealthStatus>;
  createWorktree(opts: WorktreeCreateOptions): Promise<Worktree>;
  deleteWorktree(id: string): Promise<void>;
  listWorktrees(): Promise<Worktree[]>;
  syncWorktree(id: string): Promise<Worktree>;
  getWorktree(id: string): Promise<Worktree | null>;
}

/**
 * 后端选择标准
 */
export interface BackendSelectionCriteria {
  optimizeFor?: 'cost' | 'latency' | 'availability';
  maxLatencyMs?: number;
  maxCostPerHour?: number;
  requireHealth?: HealthStatus;
  preferredBackendId?: string;
}

/**
 * 迁移收据
 */
export interface MigrationReceipt {
  migrationId: string;
  worktreeId: string;
  fromBackend: string;
  toBackend: string;
  startedAt: number;
  completedAt: number;
  filesTransferred: number;
  bytesTransferred: number;
  status: 'success' | 'failed' | 'partial';
  error?: string;
}

/**
 * 后端指标
 */
export interface BackendMetrics {
  backendId: string;
  worktreeCount: number;
  averageLatencyMs: number;
  uptimePercent: number;
  totalBytesTransferred: number;
  totalMigrations: number;
  successfulMigrations: number;
  failedMigrations: number;
  lastError?: string;
  lastErrorAt?: number;
}

/**
 * 引擎事件类型
 */
export type AdapterEventType =
  | 'backend-registered'
  | 'backend-unregistered'
  | 'worktree-created'
  | 'worktree-deleted'
  | 'worktree-synced'
  | 'worktree-migrated'
  | 'health-check-completed'
  | 'health-check-failed';

export interface AdapterEvent {
  type: AdapterEventType;
  timestamp: number;
  data: unknown;
}

export interface SerializedAdapterState {
  backends: WorktreeBackendConfig[];
  worktrees: Worktree[];
  backendMetrics: Record<string, BackendMetrics>;
}

// ============ 默认配置 ============

export const DEFAULT_ADAPTER_CONFIG = {
  storageKey: 'hermes.remoteWorktree',
  defaultHealthCheckIntervalMs: 60000,
  maxMigrationRetries: 3,
  migrationTimeoutMs: 300000,
  enableAutoHealthCheck: false,
};

// ============ 工具函数 ============

export function generateWorktreeId(): string {
  return `wt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateMigrationId(): string {
  return `mig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ Local Backend 实现 ============

export class LocalWorktreeBackend implements WorktreeBackend {
  readonly id: string;
  readonly type: BackendType = 'local';
  readonly name: string;
  private worktrees: Map<string, Worktree> = new Map();
  private latencyMs = 0;
  private health: HealthStatus = 'healthy';

  constructor(config: LocalBackendConfig) {
    this.id = config.id;
    this.name = config.name;
  }

  async healthCheck(): Promise<HealthStatus> {
    // 本地后端总是 healthy（除非文件系统不可访问）
    return this.health;
  }

  async createWorktree(opts: WorktreeCreateOptions): Promise<Worktree> {
    const wt: Worktree = {
      id: generateWorktreeId(),
      backendId: this.id,
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      path: opts.path || `${this.id}/${opts.branch}`,
      status: 'creating',
      createdAt: Date.now(),
      metadata: opts.metadata,
    };
    this.worktrees.set(wt.id, wt);
    // 模拟创建完成
    await new Promise((r) => setTimeout(r, 10));
    wt.status = 'ready';
    return wt;
  }

  async deleteWorktree(id: string): Promise<void> {
    this.worktrees.delete(id);
  }

  async listWorktrees(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  async syncWorktree(id: string): Promise<Worktree> {
    const wt = this.worktrees.get(id);
    if (!wt) throw new Error(`Worktree ${id} not found`);
    wt.status = 'syncing';
    wt.lastSyncAt = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    wt.status = 'ready';
    return wt;
  }

  async getWorktree(id: string): Promise<Worktree | null> {
    return this.worktrees.get(id) || null;
  }

  setLatency(ms: number): void { this.latencyMs = ms; }
  getLatency(): number { return this.latencyMs; }
  setHealth(h: HealthStatus): void { this.health = h; }
}

// ============ Remote Backend 实现 ============

export class RemoteWorktreeBackend implements WorktreeBackend {
  readonly id: string;
  readonly type: BackendType = 'remote';
  readonly name: string;
  private worktrees: Map<string, Worktree> = new Map();
  private config: RemoteBackendConfig;
  private health: HealthStatus = 'healthy';
  private failureRate = 0;

  constructor(config: RemoteBackendConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  async healthCheck(): Promise<HealthStatus> {
    // 模拟健康检查
    if (this.failureRate > 0.8) return 'offline';
    if (this.failureRate > 0.5) return 'unhealthy';
    if (this.failureRate > 0.2) return 'degraded';
    return this.health;
  }

  async createWorktree(opts: WorktreeCreateOptions): Promise<Worktree> {
    if (Math.random() < this.failureRate) throw new Error('Backend unavailable');
    const wt: Worktree = {
      id: generateWorktreeId(),
      backendId: this.id,
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      path: `${this.config.endpoint}/worktrees/${opts.branch}`,
      status: 'creating',
      createdAt: Date.now(),
      metadata: opts.metadata,
    };
    this.worktrees.set(wt.id, wt);
    await new Promise((r) => setTimeout(r, 20));
    wt.status = 'ready';
    return wt;
  }

  async deleteWorktree(id: string): Promise<void> {
    this.worktrees.delete(id);
  }

  async listWorktrees(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  async syncWorktree(id: string): Promise<Worktree> {
    const wt = this.worktrees.get(id);
    if (!wt) throw new Error(`Worktree ${id} not found`);
    wt.status = 'syncing';
    wt.lastSyncAt = Date.now();
    await new Promise((r) => setTimeout(r, 30));
    wt.status = 'ready';
    return wt;
  }

  async getWorktree(id: string): Promise<Worktree | null> {
    return this.worktrees.get(id) || null;
  }

  setHealth(h: HealthStatus): void { this.health = h; }
  setFailureRate(rate: number): void { this.failureRate = Math.max(0, Math.min(1, rate)); }
}

// ============ Hybrid Backend 实现 ============

export class HybridWorktreeBackend implements WorktreeBackend {
  readonly id: string;
  readonly type: BackendType = 'hybrid';
  readonly name: string;
  private worktrees: Map<string, Worktree> = new Map();
  private config: HybridBackendConfig;

  constructor(config: HybridBackendConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  async healthCheck(): Promise<HealthStatus> {
    return 'healthy';
  }

  async createWorktree(opts: WorktreeCreateOptions): Promise<Worktree> {
    const wt: Worktree = {
      id: generateWorktreeId(),
      backendId: this.id,
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      path: `${this.config.localPath}/${opts.branch}`,
      status: 'creating',
      createdAt: Date.now(),
      metadata: { ...opts.metadata, syncMode: this.config.syncMode },
    };
    this.worktrees.set(wt.id, wt);
    await new Promise((r) => setTimeout(r, 15));
    wt.status = 'ready';
    return wt;
  }

  async deleteWorktree(id: string): Promise<void> {
    this.worktrees.delete(id);
  }

  async listWorktrees(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  async syncWorktree(id: string): Promise<Worktree> {
    const wt = this.worktrees.get(id);
    if (!wt) throw new Error(`Worktree ${id} not found`);
    wt.status = 'syncing';
    wt.lastSyncAt = Date.now();
    await new Promise((r) => setTimeout(r, 25));
    wt.status = 'ready';
    return wt;
  }

  async getWorktree(id: string): Promise<Worktree | null> {
    return this.worktrees.get(id) || null;
  }
}

// ============ 适配器主类 ============

export class RemoteWorktreeAdapter {
  private backends: Map<string, WorktreeBackend> = new Map();
  private backendConfigs: Map<string, WorktreeBackendConfig> = new Map();
  private worktrees: Map<string, Worktree> = new Map();
  private metrics: Map<string, BackendMetrics> = new Map();
  private listeners: Map<AdapterEventType, Set<(e: AdapterEvent) => void>> = new Map();
  private storageKey = DEFAULT_ADAPTER_CONFIG.storageKey;
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.load();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state: SerializedAdapterState = JSON.parse(raw);
        if (Array.isArray(state.worktrees)) {
          for (const wt of state.worktrees) this.worktrees.set(wt.id, wt);
        }
        if (state.backendMetrics) {
          for (const [k, v] of Object.entries(state.backendMetrics)) {
            this.metrics.set(k, v);
          }
        }
      }
    } catch (e) {
      console.warn('RemoteWorktreeAdapter: failed to load state', e);
    }
  }

  private save(): void {
    try {
      const state: SerializedAdapterState = {
        backends: Array.from(this.backendConfigs.values()),
        worktrees: Array.from(this.worktrees.values()),
        backendMetrics: Object.fromEntries(this.metrics),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('RemoteWorktreeAdapter: failed to save state', e);
    }
  }

  // ============ 后端管理 ============

  registerBackend(config: WorktreeBackendConfig): WorktreeBackend {
    let backend: WorktreeBackend;
    if (config.type === 'local') {
      backend = new LocalWorktreeBackend(config);
    } else if (config.type === 'remote') {
      backend = new RemoteWorktreeBackend(config);
    } else {
      backend = new HybridWorktreeBackend(config);
    }
    this.backends.set(config.id, backend);
    this.backendConfigs.set(config.id, config);
    this.metrics.set(config.id, {
      backendId: config.id,
      worktreeCount: 0,
      averageLatencyMs: 0,
      uptimePercent: 100,
      totalBytesTransferred: 0,
      totalMigrations: 0,
      successfulMigrations: 0,
      failedMigrations: 0,
    });
    this.save();
    this.emit('backend-registered', { config });
    return backend;
  }

  unregisterBackend(backendId: string): void {
    this.backends.delete(backendId);
    this.backendConfigs.delete(backendId);
    this.save();
    this.emit('backend-unregistered', { backendId });
  }

  listBackends(): WorktreeBackendConfig[] {
    return Array.from(this.backendConfigs.values());
  }

  getBackend(id: string): WorktreeBackend | undefined {
    return this.backends.get(id);
  }

  getBackendConfig(id: string): WorktreeBackendConfig | undefined {
    return this.backendConfigs.get(id);
  }

  // ============ 智能选择 ============

  selectBackend(criteria: BackendSelectionCriteria = {}): string {
    const candidates = Array.from(this.backendConfigs.values()).filter((c) => c.enabled);
    if (candidates.length === 0) throw new Error('No enabled backends');

    if (criteria.preferredBackendId) {
      const preferred = candidates.find((c) => c.id === criteria.preferredBackendId);
      if (preferred) return preferred.id;
    }

    const optimizeFor = criteria.optimizeFor || 'availability';

    // 评分函数
    const scores = candidates.map((c) => {
      let score = c.priority;
      if (optimizeFor === 'cost') {
        // 本地便宜，远程贵
        score += c.type === 'local' ? 50 : c.type === 'hybrid' ? 30 : 0;
      } else if (optimizeFor === 'latency') {
        score += c.type === 'local' ? 50 : c.type === 'hybrid' ? 30 : 10;
      } else {
        // availability: 优先 local > hybrid > remote
        score += c.type === 'local' ? 30 : c.type === 'hybrid' ? 20 : 10;
      }
      return { id: c.id, score };
    });

    scores.sort((a, b) => b.score - a.score);
    return scores[0].id;
  }

  // ============ Worktree 操作 ============

  async create(options: WorktreeCreateOptions): Promise<Worktree> {
    const backendId = options.backendId || this.selectBackend();
    const backend = this.backends.get(backendId);
    if (!backend) throw new Error(`Backend ${backendId} not found`);
    const wt = await backend.createWorktree(options);
    this.worktrees.set(wt.id, wt);
    this.save();
    this.emit('worktree-created', { worktree: wt });
    return wt;
  }

  async delete(worktreeId: string): Promise<void> {
    const wt = this.worktrees.get(worktreeId);
    if (!wt) throw new Error(`Worktree ${worktreeId} not found`);
    const backend = this.backends.get(wt.backendId);
    if (backend) await backend.deleteWorktree(worktreeId);
    this.worktrees.delete(worktreeId);
    this.save();
    this.emit('worktree-deleted', { worktreeId });
  }

  async list(filter?: { backendId?: string; status?: WorktreeStatus }): Promise<Worktree[]> {
    let all = Array.from(this.worktrees.values());
    if (filter?.backendId) all = all.filter((w) => w.backendId === filter.backendId);
    if (filter?.status) all = all.filter((w) => w.status === filter.status);
    return all;
  }

  async get(worktreeId: string): Promise<Worktree | null> {
    return this.worktrees.get(worktreeId) || null;
  }

  async sync(worktreeId: string): Promise<Worktree> {
    const wt = this.worktrees.get(worktreeId);
    if (!wt) throw new Error(`Worktree ${worktreeId} not found`);
    const backend = this.backends.get(wt.backendId);
    if (!backend) throw new Error(`Backend ${wt.backendId} not found`);
    const synced = await backend.syncWorktree(worktreeId);
    Object.assign(wt, synced);
    this.save();
    this.emit('worktree-synced', { worktree: wt });
    return wt;
  }

  // ============ 会话迁移 ============

  async migrateToRemote(worktreeId: string, targetBackendId: string): Promise<MigrationReceipt> {
    return this.migrate(worktreeId, targetBackendId);
  }

  async migrateToLocal(worktreeId: string, targetBackendId?: string): Promise<MigrationReceipt> {
    const localBackend = Array.from(this.backendConfigs.values()).find((b) => b.type === 'local' && b.enabled);
    const target = targetBackendId || localBackend?.id;
    if (!target) throw new Error('No local backend available');
    return this.migrate(worktreeId, target);
  }

  async migrateBetweenRemotes(worktreeId: string, targetBackendId: string): Promise<MigrationReceipt> {
    return this.migrate(worktreeId, targetBackendId);
  }

  private async migrate(worktreeId: string, targetBackendId: string): Promise<MigrationReceipt> {
    const wt = this.worktrees.get(worktreeId);
    if (!wt) throw new Error(`Worktree ${worktreeId} not found`);
    const fromBackend = wt.backendId;
    if (fromBackend === targetBackendId) {
      return {
        migrationId: generateMigrationId(),
        worktreeId,
        fromBackend,
        toBackend: targetBackendId,
        startedAt: Date.now(),
        completedAt: Date.now(),
        filesTransferred: 0,
        bytesTransferred: 0,
        status: 'success',
      };
    }

    const targetBackend = this.backends.get(targetBackendId);
    if (!targetBackend) throw new Error(`Target backend ${targetBackendId} not found`);

    const startedAt = Date.now();
    wt.status = 'migrating';
    this.save();
    this.emit('worktree-migrated', { worktreeId, fromBackend, toBackend: targetBackendId, status: 'started' });

    const receipt: MigrationReceipt = {
      migrationId: generateMigrationId(),
      worktreeId,
      fromBackend,
      toBackend: targetBackendId,
      startedAt,
      completedAt: 0,
      filesTransferred: 0,
      bytesTransferred: 0,
      status: 'success',
    };

    try {
      // 模拟迁移
      const newWt = await targetBackend.createWorktree({
        branch: wt.branch,
        baseBranch: wt.baseBranch,
        metadata: { ...wt.metadata, migratedFrom: fromBackend },
      });
      receipt.filesTransferred = wt.fileCount || 10;
      receipt.bytesTransferred = wt.size || 1024;

      // 迁移完成：更新 worktree 引用
      wt.backendId = targetBackendId;
      wt.path = newWt.path;
      wt.status = 'ready';
      wt.lastSyncAt = Date.now();
      this.save();

      receipt.completedAt = Date.now();
      this.updateMetricsOnSuccess(fromBackend, targetBackendId, receipt);

      this.emit('worktree-migrated', { worktreeId, fromBackend, toBackend: targetBackendId, status: 'success', receipt });
      return receipt;
    } catch (e) {
      receipt.status = 'failed';
      receipt.error = e instanceof Error ? e.message : String(e);
      receipt.completedAt = Date.now();
      wt.status = 'error';
      wt.lastError = receipt.error;
      this.save();
      this.updateMetricsOnFailure(fromBackend, targetBackendId);
      this.emit('worktree-migrated', { worktreeId, fromBackend, toBackend: targetBackendId, status: 'failed', error: receipt.error });
      return receipt;
    }
  }

  private updateMetricsOnSuccess(from: string, to: string, receipt: MigrationReceipt): void {
    const fromMetrics = this.metrics.get(from);
    if (fromMetrics) {
      fromMetrics.totalMigrations += 1;
      fromMetrics.successfulMigrations += 1;
      fromMetrics.totalBytesTransferred += receipt.bytesTransferred;
    }
    const toMetrics = this.metrics.get(to);
    if (toMetrics) {
      toMetrics.totalMigrations += 1;
      toMetrics.successfulMigrations += 1;
    }
  }

  private updateMetricsOnFailure(from: string, _to: string): void {
    const m = this.metrics.get(from);
    if (m) m.failedMigrations += 1;
  }

  // ============ 健康检查 ============

  async healthCheck(backendId: string): Promise<HealthStatus> {
    const backend = this.backends.get(backendId);
    if (!backend) throw new Error(`Backend ${backendId} not found`);
    try {
      const status = await backend.healthCheck();
      const m = this.metrics.get(backendId);
      if (m) m.uptimePercent = status === 'healthy' ? 100 : status === 'degraded' ? 70 : status === 'unhealthy' ? 30 : 0;
      this.emit('health-check-completed', { backendId, status });
      return status;
    } catch (e) {
      this.emit('health-check-failed', { backendId, error: e });
      return 'offline';
    }
  }

  async healthCheckAll(): Promise<Map<string, HealthStatus>> {
    const result = new Map<string, HealthStatus>();
    for (const [id, backend] of this.backends) {
      const status = await backend.healthCheck();
      result.set(id, status);
    }
    return result;
  }

  getBackendMetrics(backendId: string): BackendMetrics | undefined {
    return this.metrics.get(backendId);
  }

  // ============ 事件系统 ============

  on(event: AdapterEventType, listener: (e: AdapterEvent) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(type: AdapterEventType, data: unknown): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener({ type, timestamp: Date.now(), data });
        } catch (e) {
          console.error('RemoteWorktreeAdapter listener error', e);
        }
      }
    }
  }

  // ============ 辅助 ============

  startAutoHealthCheck(intervalMs: number = 60000): void {
    this.stopAutoHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      this.healthCheckAll().catch(console.error);
    }, intervalMs);
  }

  stopAutoHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  reset(): void {
    this.stopAutoHealthCheck();
    this.backends.clear();
    this.backendConfigs.clear();
    this.worktrees.clear();
    this.metrics.clear();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
  }
}

// ============ 单例 ============

let defaultAdapter: RemoteWorktreeAdapter | null = null;

export function getDefaultRemoteWorktreeAdapter(): RemoteWorktreeAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new RemoteWorktreeAdapter();
  }
  return defaultAdapter;
}

export function resetDefaultRemoteWorktreeAdapter(): void {
  if (defaultAdapter) {
    defaultAdapter.reset();
  }
  defaultAdapter = null;
}
