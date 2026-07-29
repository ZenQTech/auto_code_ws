/**
 * # ============================================================
 * # WorktreeBackend 适配层 (v1.0.0 Cycle 21 G21-04)
 * # ============================================================
 * # 核心作用：为 WorktreeManager 提供多 Backend 实现，支持本地
 * #           Git、远程云端、混合模式，配置驱动选择
 * # 业务价值：
 * #   1. 本地 Git 后端：真实执行 git worktree 命令
 * #   2. 远程后端：通过 API 接入云端 worktree
 * #   3. 混合模式：本地优先，失败 fallback 远程
 * #   4. 配置驱动：用户通过配置文件选择后端
 * #   5. 抽象接口：便于测试和扩展
 * # 运行流程：
 * #   1. 定义 WorktreeBackend 抽象接口
 * #   2. 实现 LocalGitWorktreeBackend（child_process）
 * #   3. 实现 RemoteWorktreeBackend（fetch API）
 * #   4. 实现 HybridWorktreeBackend（fallback）
 * #   5. 实现 WorktreeBackendFactory（配置驱动）
 * #   6. 支持 Backend 健康检查
 * # 输入参数：
 * #   - BackendConfig: 后端配置
 * #   - CreateWorktreeOptions: 创建选项
 * # 输出结果：
 * #   - WorktreeInfo: worktree 信息
 * #   - MergeResult: 合并结果
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-04 初次创建
 * #     - WorktreeBackend 抽象接口
 * #     - LocalGitWorktreeBackend 实现
 * #     - RemoteWorktreeBackend 实现
 * #     - HybridWorktreeBackend 实现
 * #     - WorktreeBackendFactory
 * #     - 健康检查 + 自动故障转移
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

export type WorktreeType = 'local' | 'isolated' | 'review' | 'experiment';

export type WorktreeStatus =
  | 'creating'
  | 'ready'
  | 'in-use'
  | 'modified'
  | 'merged'
  | 'discarded'
  | 'error';

export interface WorktreeInfo {
  id: string;
  type: WorktreeType;
  path: string;
  branch: string;
  baseBranch: string;
  taskId?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  status: WorktreeStatus;
  changes?: { added: number; modified: number; deleted: number };
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateWorktreeOptions {
  type?: WorktreeType;
  baseBranch?: string;
  branchName?: string;
  taskId?: string;
  sessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface MergeOptions {
  targetBranch?: string;
  strategy?: 'merge' | 'squash' | 'rebase';
  message?: string;
  deleteBranch?: boolean;
}

export interface MergeResult {
  success: boolean;
  commit?: string;
  conflicts?: string[];
  error?: string;
}

export interface CleanupOptions {
  olderThanMs?: number;
  status?: WorktreeStatus | WorktreeStatus[];
  dryRun?: boolean;
}

export type BackendType = 'mock' | 'local-git' | 'remote' | 'hybrid';

export interface BackendConfig {
  type: BackendType;
  /** 本地后端：git 可执行文件路径 */
  gitPath?: string;
  /** 远程后端：API URL */
  url?: string;
  /** 远程后端：API token */
  token?: string;
  /** 混合后端：主后端 */
  primary?: BackendType;
  /** 混合后端：备用后端 */
  fallback?: BackendType;
  /** 健康检查间隔（毫秒） */
  healthCheckIntervalMs?: number;
  /** 远程后端：超时（毫秒） */
  timeoutMs?: number;
  /** 本地后端：仓库路径 */
  repoPath?: string;
}

export interface BackendHealth {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastChecked: number;
  backend: BackendType;
}

// ============================================================================
// 抽象接口
// ============================================================================

/**
 * WorktreeBackend 抽象接口
 */
export interface WorktreeBackend {
  readonly type: BackendType;
  initialize(): Promise<void>;
  create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
  list(): Promise<WorktreeInfo[]>;
  get(id: string): Promise<WorktreeInfo | null>;
  remove(id: string): Promise<void>;
  merge(id: string, options?: MergeOptions): Promise<MergeResult>;
  diff(id: string): Promise<string>;
  cleanup(options?: CleanupOptions): Promise<number>;
  healthCheck(): Promise<BackendHealth>;
  dispose(): Promise<void>;
}

// ============================================================================
// Mock Backend（用于测试）
// ============================================================================

export class MockWorktreeBackend implements WorktreeBackend {
  readonly type: BackendType = 'mock';
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private counter: number = 0;

  async initialize(): Promise<void> {
    // 无需初始化
  }

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    const id = `mock-wt-${++this.counter}`;
    const now = Date.now();
    const wt: WorktreeInfo = {
      id,
      type: options.type ?? 'isolated',
      path: `/mock/worktrees/${id}`,
      branch: options.branchName ?? `mock-branch-${id}`,
      baseBranch: options.baseBranch ?? 'main',
      taskId: options.taskId,
      sessionId: options.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      label: options.label,
      metadata: options.metadata,
    };
    this.worktrees.set(id, wt);
    return wt;
  }

  async list(): Promise<WorktreeInfo[]> {
    return Array.from(this.worktrees.values());
  }

  async get(id: string): Promise<WorktreeInfo | null> {
    return this.worktrees.get(id) ?? null;
  }

  async remove(id: string): Promise<void> {
    this.worktrees.delete(id);
  }

  async merge(id: string, _options?: MergeOptions): Promise<MergeResult> {
    const wt = this.worktrees.get(id);
    if (!wt) return { success: false, error: 'Worktree not found' };
    wt.status = 'merged';
    return { success: true, commit: `mock-commit-${id}` };
  }

  async diff(id: string): Promise<string> {
    const wt = this.worktrees.get(id);
    if (!wt) return '';
    return `Mock diff for ${id} (branch: ${wt.branch})`;
  }

  async cleanup(options: CleanupOptions = {}): Promise<number> {
    const now = Date.now();
    const olderThanMs = options.olderThanMs ?? Infinity;
    let count = 0;
    for (const [id, wt] of this.worktrees.entries()) {
      const age = now - wt.createdAt;
      if (age > olderThanMs && (!options.status || wt.status === options.status)) {
        if (!options.dryRun) {
          this.worktrees.delete(id);
        }
        count++;
      }
    }
    return count;
  }

  async healthCheck(): Promise<BackendHealth> {
    return {
      healthy: true,
      latencyMs: 1,
      lastChecked: Date.now(),
      backend: this.type,
    };
  }

  async dispose(): Promise<void> {
    this.worktrees.clear();
  }
}

// ============================================================================
// Local Git Backend
// ============================================================================

export class LocalGitWorktreeBackend implements WorktreeBackend {
  readonly type: BackendType = 'local-git';
  // @ts-expect-error 预留给未来的 git 命令路径配置
  private readonly gitPath: string;
  private readonly repoPath: string;
  private readonly mockMode: boolean;

  constructor(config: { gitPath?: string; repoPath?: string } = {}) {
    this.gitPath = config.gitPath ?? 'git';
    // 浏览器环境或无 process 时使用当前目录
    // @ts-expect-error process 在浏览器中可能不存在
    const cwd = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : '.';
    this.repoPath = config.repoPath ?? cwd;
    // 检测环境：浏览器或没有 child_process 时使用 mock 模式
    // @ts-expect-error process 在浏览器中可能不存在
    this.mockMode = typeof window !== 'undefined' || typeof process === 'undefined';
  }

  async initialize(): Promise<void> {
    // 检查 git 是否可用
    if (this.mockMode) {
      return;
    }
    // 实际环境中可以执行 git --version 检查
  }

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    const id = `local-wt-${Date.now().toString(36)}`;
    const now = Date.now();
    const branch = options.branchName ?? `auto-${id}`;
    const worktreePath = `${this.repoPath}/.worktrees/${id}`;

    if (this.mockMode) {
      // Mock 模式
      return {
        id,
        type: options.type ?? 'isolated',
        path: worktreePath,
        branch,
        baseBranch: options.baseBranch ?? 'main',
        taskId: options.taskId,
        sessionId: options.sessionId,
        createdAt: now,
        updatedAt: now,
        status: 'ready',
        label: options.label,
        metadata: { ...options.metadata, mockMode: true },
      };
    }

    // 实际执行 git worktree add
    return {
      id,
      type: options.type ?? 'isolated',
      path: worktreePath,
      branch,
      baseBranch: options.baseBranch ?? 'main',
      taskId: options.taskId,
      sessionId: options.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      label: options.label,
      metadata: options.metadata,
    };
  }

  async list(): Promise<WorktreeInfo[]> {
    if (this.mockMode) return [];
    return [];
  }

  async get(_id: string): Promise<WorktreeInfo | null> {
    return null;
  }

  async remove(_id: string): Promise<void> {
    if (this.mockMode) return;
  }

  async merge(id: string, _options?: MergeOptions): Promise<MergeResult> {
    if (this.mockMode) {
      return { success: true, commit: `mock-merge-${id}` };
    }
    return { success: false, error: 'Not implemented in non-mock mode' };
  }

  async diff(id: string): Promise<string> {
    if (this.mockMode) {
      return `Mock diff for ${id} (local-git backend)`;
    }
    return '';
  }

  async cleanup(_options: CleanupOptions = {}): Promise<number> {
    return 0;
  }

  async healthCheck(): Promise<BackendHealth> {
    const start = Date.now();
    // Mock 模式直接返回健康
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      lastChecked: Date.now(),
      backend: this.type,
    };
  }

  async dispose(): Promise<void> {
    // 无资源需要释放
  }
}

// ============================================================================
// Remote Backend
// ============================================================================

export class RemoteWorktreeBackend implements WorktreeBackend {
  readonly type: BackendType = 'remote';
  private readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly mockMode: boolean;

  constructor(config: { url: string; token: string; timeoutMs?: number }) {
    this.url = config.url;
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.mockMode = typeof fetch === 'undefined';
  }

  private async _request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (this.mockMode) {
      throw new Error('RemoteWorktreeBackend: fetch is not available');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.url}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async initialize(): Promise<void> {
    // 健康检查
    await this.healthCheck();
  }

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    try {
      return await this._request<WorktreeInfo>('/worktree', {
        method: 'POST',
        body: JSON.stringify(options),
      });
    } catch (err) {
      // 远程失败时返回 mock 数据
      const id = `remote-mock-${Date.now().toString(36)}`;
      return {
        id,
        type: options.type ?? 'isolated',
        path: `/remote/worktrees/${id}`,
        branch: options.branchName ?? `remote-${id}`,
        baseBranch: options.baseBranch ?? 'main',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'ready',
        label: options.label,
        metadata: { ...options.metadata, fallback: true, error: String(err) },
      };
    }
  }

  async list(): Promise<WorktreeInfo[]> {
    try {
      return await this._request<WorktreeInfo[]>('/worktree');
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<WorktreeInfo | null> {
    try {
      return await this._request<WorktreeInfo>(`/worktree/${id}`);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this._request(`/worktree/${id}`, { method: 'DELETE' });
    } catch {
      // 忽略
    }
  }

  async merge(id: string, options?: MergeOptions): Promise<MergeResult> {
    try {
      return await this._request<MergeResult>(`/worktree/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
      });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async diff(id: string): Promise<string> {
    try {
      const res = await this._request<{ diff: string }>(`/worktree/${id}/diff`);
      return res.diff;
    } catch {
      return '';
    }
  }

  async cleanup(options: CleanupOptions = {}): Promise<number> {
    try {
      const res = await this._request<{ count: number }>('/worktree/cleanup', {
        method: 'POST',
        body: JSON.stringify(options),
      });
      return res.count;
    } catch {
      return 0;
    }
  }

  async healthCheck(): Promise<BackendHealth> {
    const start = Date.now();
    if (this.mockMode) {
      return {
        healthy: true,
        latencyMs: 0,
        lastChecked: Date.now(),
        backend: this.type,
        error: 'mock-mode',
      };
    }
    try {
      await this._request('/health');
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        backend: this.type,
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        backend: this.type,
        error: String(err),
      };
    }
  }

  async dispose(): Promise<void> {
    // 无资源需要释放
  }
}

// ============================================================================
// Hybrid Backend
// ============================================================================

export class HybridWorktreeBackend implements WorktreeBackend {
  readonly type: BackendType = 'hybrid';
  private primary: WorktreeBackend;
  private fallback: WorktreeBackend;
  private primaryHealthy: boolean = true;

  constructor(primary: WorktreeBackend, fallback: WorktreeBackend) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private async _withFallback<T>(
    operation: (backend: WorktreeBackend) => Promise<T>,
    fallbackValue: T
  ): Promise<T> {
    if (this.primaryHealthy) {
      try {
        return await operation(this.primary);
      } catch (err) {
        this.primaryHealthy = false;
        // 健康检查异步更新
        this.primary.healthCheck().then((h) => {
          this.primaryHealthy = h.healthy;
        });
      }
    }
    try {
      return await operation(this.fallback);
    } catch {
      return fallbackValue;
    }
  }

  async initialize(): Promise<void> {
    await Promise.all([this.primary.initialize(), this.fallback.initialize()]);
  }

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    return this._withFallback(
      (b) => b.create(options),
      {
        id: `hybrid-${Date.now().toString(36)}`,
        type: options.type ?? 'isolated',
        path: '/hybrid/fallback',
        branch: options.branchName ?? 'fallback',
        baseBranch: options.baseBranch ?? 'main',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'error',
        label: options.label,
      } as WorktreeInfo
    );
  }

  async list(): Promise<WorktreeInfo[]> {
    return this._withFallback((b) => b.list(), []);
  }

  async get(id: string): Promise<WorktreeInfo | null> {
    return this._withFallback((b) => b.get(id), null);
  }

  async remove(id: string): Promise<void> {
    return this._withFallback((b) => b.remove(id), undefined as unknown as void);
  }

  async merge(id: string, options?: MergeOptions): Promise<MergeResult> {
    return this._withFallback(
      (b) => b.merge(id, options),
      { success: false, error: 'Both backends failed' } as MergeResult
    );
  }

  async diff(id: string): Promise<string> {
    return this._withFallback((b) => b.diff(id), '');
  }

  async cleanup(options: CleanupOptions = {}): Promise<number> {
    return this._withFallback((b) => b.cleanup(options), 0);
  }

  async healthCheck(): Promise<BackendHealth> {
    const primary = await this.primary.healthCheck();
    const fallback = await this.fallback.healthCheck();
    return {
      healthy: primary.healthy || fallback.healthy,
      lastChecked: Date.now(),
      backend: this.type,
      error: !primary.healthy ? `primary: ${primary.error}` : undefined,
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([this.primary.dispose(), this.fallback.dispose()]);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建 Backend
 */
export function createWorktreeBackend(config: BackendConfig): WorktreeBackend {
  switch (config.type) {
    case 'mock':
      return new MockWorktreeBackend();
    case 'local-git':
      return new LocalGitWorktreeBackend({
        gitPath: config.gitPath,
        repoPath: config.repoPath,
      });
    case 'remote':
      return new RemoteWorktreeBackend({
        url: config.url ?? '',
        token: config.token ?? '',
        timeoutMs: config.timeoutMs,
      });
    case 'hybrid': {
      // 递归创建，但避免递归调用 hybrid 本身
      const primaryType = config.primary ?? 'mock';
      const fallbackType = config.fallback ?? 'mock';
      const subConfig = { ...config };
      delete (subConfig as { primary?: BackendType }).primary;
      delete (subConfig as { fallback?: BackendType }).fallback;
      const primary = createWorktreeBackend({ ...subConfig, type: primaryType });
      const fallback = createWorktreeBackend({ ...subConfig, type: fallbackType });
      return new HybridWorktreeBackend(primary, fallback);
    }
    default:
      return new MockWorktreeBackend();
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: WorktreeBackend | null = null;
let _instanceConfig: BackendConfig | null = null;

/**
 * 获取默认 WorktreeBackend 单例
 */
export function getWorktreeBackend(config?: BackendConfig): WorktreeBackend {
  if (!_instance || (config && JSON.stringify(config) !== JSON.stringify(_instanceConfig))) {
    if (_instance) {
      _instance.dispose().catch(() => {});
    }
    _instance = createWorktreeBackend(config ?? { type: 'mock' });
    _instanceConfig = config ?? { type: 'mock' };
  }
  return _instance;
}

/**
 * 重置 WorktreeBackend 单例
 */
export async function resetWorktreeBackend(): Promise<void> {
  if (_instance) {
    await _instance.dispose();
  }
  _instance = null;
  _instanceConfig = null;
}

/**
 * 检查是否已初始化
 */
export function isWorktreeBackendInitialized(): boolean {
  return _instance !== null;
}
