/**
 * # ============================================================
 * # WorktreeManager - Git Worktree 隔离管理器 (v1.0.0 Cycle 20 P0-1)
 * # ============================================================
 * # 核心作用：为 Best-of-N Multi-Model、Background Tasks 等并行任务
 * #           提供基于 git worktree 概念的隔离环境
 * # 业务价值：
 * #   1. 候选之间互不干扰，可安全并行
 * #   2. 失败任务可一键丢弃，不污染主分支
 * #   3. 用户可逐个评估候选效果
 * #   4. 主 workspace 永远保持干净
 * # 运行流程：
 * #   1. 引擎持有 worktrees Map<id, WorktreeInfo>
 * #   2. 事件总线 WorktreeEventBus 处理生命周期事件
 * #   3. WorktreeStorage 负责 localStorage 持久化
 * #   4. WorktreeBackend 抽象（MockWorktreeBackend 默认 + GitWorktreeBackend 预留）
 * #   5. 单例工厂 getWorktreeManager() / resetWorktreeManager()
 * # 输入参数：
 * #   - CreateWorktreeOptions：创建选项（type/baseBranch/taskId/sessionId/label/metadata）
 * #   - MergeOptions：合并选项（targetBranch/strategy/message/deleteBranch）
 * #   - WorktreeFilter：过滤选项（status/type/taskId/sessionId/baseBranch）
 * # 输出结果：
 * #   - WorktreeInfo：worktree 完整信息
 * #   - MergeResult：合并结果（成功/冲突/提交哈希）
 * #   - DiffResult：diff 结果（文件列表/统计/hunks）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 P0-1 初次创建
 * #     - 核心 WorktreeManager 引擎
 * #     - MockWorktreeBackend（开发/测试环境）
 * #     - LocalStorageWorktreeStorage（持久化）
 * #     - 7 种事件类型 + 订阅机制
 * #     - 单例工厂 + 自动清理
 * #     - BestOfN/BackgroundTasks 集成预留
 * # ============================================================
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// 类型定义
// ============================================================================

/** Worktree 类型 */
export type WorktreeType = 'local' | 'isolated' | 'review' | 'experiment';

/** Worktree 状态 */
export type WorktreeStatus =
  | 'creating'
  | 'ready'
  | 'in-use'
  | 'modified'
  | 'merged'
  | 'discarded'
  | 'error';

/** Worktree 信息 */
export interface WorktreeInfo {
  /** 唯一 ID（UUID v4） */
  id: string;
  /** 类型 */
  type: WorktreeType;
  /** 物理路径（虚拟） */
  path: string;
  /** 分支名 */
  branch: string;
  /** 基础分支 */
  baseBranch: string;
  /** 关联任务 ID */
  taskId?: string;
  /** 关联会话 ID */
  sessionId?: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后修改时间 */
  updatedAt: number;
  /** 状态 */
  status: WorktreeStatus;
  /** 文件变更统计 */
  changes?: {
    added: number;
    modified: number;
    deleted: number;
  };
  /** 描述/标签 */
  label?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 创建选项 */
export interface CreateWorktreeOptions {
  type?: WorktreeType;
  baseBranch?: string;
  branchName?: string;
  taskId?: string;
  sessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

/** 合并选项 */
export interface MergeOptions {
  targetBranch?: string;
  strategy?: 'merge' | 'rebase' | 'squash';
  message?: string;
  deleteBranch?: boolean;
}

/** 合并结果 */
export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  commitHash?: string;
  message?: string;
}

/** Diff 结果 */
export interface DiffResult {
  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    additions: number;
    deletions: number;
    hunks: Array<{
      startLine: number;
      endLine: number;
      content: string;
    }>;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

/** 过滤选项 */
export interface WorktreeFilter {
  status?: WorktreeStatus | WorktreeStatus[];
  type?: WorktreeType;
  taskId?: string;
  sessionId?: string;
  baseBranch?: string;
}

/** 事件类型 */
export type WorktreeEvent =
  | { type: 'created'; worktree: WorktreeInfo }
  | { type: 'status-changed'; id: string; previous: WorktreeStatus; current: WorktreeStatus }
  | { type: 'removed'; id: string }
  | { type: 'merged'; id: string; result: MergeResult }
  | { type: 'discarded'; id: string }
  | { type: 'error'; id: string; error: Error };

/** 存储接口 */
export interface WorktreeStorage {
  load(): WorktreeInfo[];
  save(worktrees: WorktreeInfo[]): void;
}

/** Backend 接口 */
export interface WorktreeBackend {
  create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
  remove(id: string): Promise<void>;
  diff(id: string): Promise<DiffResult>;
  merge(id: string, options: MergeOptions): Promise<MergeResult>;
  status(id: string): Promise<WorktreeStatus>;
}

/** Manager 配置 */
export interface WorktreeManagerConfig {
  maxWorktrees?: number;
  autoCleanupDays?: number;
  storageKey?: string;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 生成 UUID v4（简化版，避免引入外部依赖） */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 兜底实现
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 生成 commit hash（模拟） */
function generateCommitHash(): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 40; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** 延迟工具 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Mock Backend（开发/测试环境）
// ============================================================================

/**
 * MockWorktreeBackend
 * 模拟 git worktree 操作，避免前端权限问题
 * 生产环境可替换为 GitWorktreeBackend（调用后端 API）
 */
export class MockWorktreeBackend implements WorktreeBackend {
  /** 模拟文件存储 */
  private mockFiles: Map<string, Map<string, string>>;
  /** 模拟冲突概率（5%） */
  private conflictRate: number;

  constructor(conflictRate: number = 0.05) {
    this.mockFiles = new Map();
    this.conflictRate = conflictRate;
  }

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    // 模拟 100-300ms 创建延迟
    await delay(100 + Math.random() * 200);

    const id = generateUUID();
    const path = `/mock/worktrees/${id}`;
    const branch = options.branchName || `wt-${id.slice(0, 8)}`;

    // 初始化空文件树
    this.mockFiles.set(id, new Map());

    return {
      id,
      type: options.type || 'isolated',
      path,
      branch,
      baseBranch: options.baseBranch || 'main',
      taskId: options.taskId,
      sessionId: options.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'ready',
      label: options.label,
      metadata: options.metadata,
      changes: { added: 0, modified: 0, deleted: 0 },
    };
  }

  async remove(id: string): Promise<void> {
    await delay(50);
    this.mockFiles.delete(id);
  }

  async diff(id: string): Promise<DiffResult> {
    await delay(50);
    const files = this.mockFiles.get(id);
    if (!files) {
      return { files: [], totalAdditions: 0, totalDeletions: 0 };
    }
    const result: DiffResult['files'] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    files.forEach((content, path) => {
      const additions = content.split('\n').length;
      totalAdditions += additions;
      result.push({
        path,
        status: 'added',
        additions,
        deletions: 0,
        hunks: [
          {
            startLine: 1,
            endLine: additions,
            content: content.slice(0, 500),
          },
        ],
      });
    });
    return { files: result, totalAdditions, totalDeletions };
  }

  async merge(_id: string, _options: MergeOptions): Promise<MergeResult> {
    await delay(200 + Math.random() * 300);
    if (Math.random() < this.conflictRate) {
      return {
        success: false,
        conflicts: ['src/components/Header.tsx', 'src/utils/api.ts'],
        message: '检测到合并冲突',
      };
    }
    return {
      success: true,
      commitHash: generateCommitHash(),
      message: 'Worktree 合并成功',
    };
  }

  async status(id: string): Promise<WorktreeStatus> {
    return this.mockFiles.has(id) ? 'ready' : 'error';
  }

  /** 测试辅助：注入模拟文件 */
  injectMockFiles(id: string, files: Record<string, string>): void {
    const map = new Map<string, string>();
    Object.entries(files).forEach(([path, content]) => {
      map.set(path, content);
    });
    this.mockFiles.set(id, map);
  }
}

// ============================================================================
// LocalStorage 存储
// ============================================================================

/**
 * LocalStorageWorktreeStorage
 * 持久化 worktree 元信息到 localStorage
 * 注：仅存储 WorktreeInfo（不存储实际文件内容）
 */
export class LocalStorageWorktreeStorage implements WorktreeStorage {
  /** 最多保留条数 */
  private readonly maxItems: number;

  constructor(private key: string, maxItems: number = 50) {
    this.maxItems = maxItems;
  }

  load(): WorktreeInfo[] {
    try {
      // 服务端渲染兜底
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as WorktreeInfo[];
    } catch (err) {
      // 静默降级：解析失败返回空数组
      if (typeof console !== 'undefined') {
        console.warn('[WorktreeStorage] load failed:', err);
      }
      return [];
    }
  }

  save(worktrees: WorktreeInfo[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      // 仅保留最近 N 条
      const trimmed = worktrees.slice(-this.maxItems);
      localStorage.setItem(this.key, JSON.stringify(trimmed));
    } catch (err) {
      // 静默降级
      if (typeof console !== 'undefined') {
        console.warn('[WorktreeStorage] save failed:', err);
      }
    }
  }

  clear(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// 内存存储（测试环境）
// ============================================================================

/**
 * MemoryWorktreeStorage
 * 纯内存存储，用于单元测试
 */
export class MemoryWorktreeStorage implements WorktreeStorage {
  private data: WorktreeInfo[] = [];

  load(): WorktreeInfo[] {
    return [...this.data];
  }

  save(worktrees: WorktreeInfo[]): void {
    this.data = [...worktrees];
  }

  clear(): void {
    this.data = [];
  }
}

// ============================================================================
// 核心引擎
// ============================================================================

/**
 * WorktreeManager
 * 生命周期：constructor → load() → create/list/remove/merge/diff → cleanup → dispose
 * 单例：使用 getWorktreeManager() 获取
 */
export class WorktreeManager {
  /** worktree 映射表 */
  private worktrees: Map<string, WorktreeInfo>;
  /** 事件订阅者 */
  private subscribers: Set<(event: WorktreeEvent) => void>;
  /** 存储 */
  private storage: WorktreeStorage;
  /** 后端 */
  private backend: WorktreeBackend;
  /** 配置 */
  private config: Required<WorktreeManagerConfig>;
  /** 是否已 dispose */
  private disposed: boolean;

  constructor(options: {
    backend?: WorktreeBackend;
    storage?: WorktreeStorage;
    config?: WorktreeManagerConfig;
  } = {}) {
    this.worktrees = new Map();
    this.subscribers = new Set();
    this.backend = options.backend || new MockWorktreeBackend();
    this.storage = options.storage || new LocalStorageWorktreeStorage('hermes.worktrees.v1');
    this.config = {
      maxWorktrees: options.config?.maxWorktrees ?? 10,
      autoCleanupDays: options.config?.autoCleanupDays ?? 7,
      storageKey: options.config?.storageKey || 'hermes.worktrees.v1',
    };
    this.disposed = false;

    // 从存储恢复
    this.load();
  }

  // --------------------------------------------------------------------------
  // 核心 CRUD
  // --------------------------------------------------------------------------

  /**
   * 创建 worktree
   * @throws 当 worktree 数量超过上限或后端失败
   */
  async create(options: CreateWorktreeOptions = {}): Promise<WorktreeInfo> {
    this.ensureAlive();

    // 数量限制检查
    const activeCount = this.countActive();
    if (activeCount >= this.config.maxWorktrees) {
      throw new Error(
        `Worktree 数量已达上限 (${this.config.maxWorktrees})，请先清理`,
      );
    }

    // 调用后端
    const worktree = await this.backend.create(options);
    this.worktrees.set(worktree.id, worktree);
    this.persist();
    this.emit({ type: 'created', worktree });
    return worktree;
  }

  /**
   * 列出 worktree
   */
  list(filter?: WorktreeFilter): WorktreeInfo[] {
    this.ensureAlive();
    const all = Array.from(this.worktrees.values());
    if (!filter) return all;

    return all.filter((w) => {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(w.status)) return false;
      }
      if (filter.type && w.type !== filter.type) return false;
      if (filter.taskId && w.taskId !== filter.taskId) return false;
      if (filter.sessionId && w.sessionId !== filter.sessionId) return false;
      if (filter.baseBranch && w.baseBranch !== filter.baseBranch) return false;
      return true;
    });
  }

  /**
   * 获取单个 worktree
   */
  get(id: string): WorktreeInfo | null {
    this.ensureAlive();
    return this.worktrees.get(id) || null;
  }

  /**
   * 移除 worktree
   */
  async remove(id: string): Promise<void> {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) {
      throw new Error(`Worktree ${id} 不存在`);
    }
    await this.backend.remove(id);
    this.worktrees.delete(id);
    this.persist();
    this.emit({ type: 'removed', id });
  }

  /**
   * 合并 worktree
   */
  async merge(id: string, options: MergeOptions = {}): Promise<MergeResult> {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) {
      throw new Error(`Worktree ${id} 不存在`);
    }
    if (wt.status === 'merged' || wt.status === 'discarded') {
      throw new Error(`Worktree ${id} 已终态 (${wt.status})，无法合并`);
    }

    const result = await this.backend.merge(id, options);
    if (result.success) {
      this.updateStatus(id, 'merged');
      // 可选：删除 worktree 分支
      if (options.deleteBranch) {
        await this.backend.remove(id);
        this.worktrees.delete(id);
        this.persist();
      }
    }
    this.emit({ type: 'merged', id, result });
    return result;
  }

  /**
   * 获取 diff
   */
  async diff(id: string): Promise<DiffResult> {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) {
      throw new Error(`Worktree ${id} 不存在`);
    }
    return await this.backend.diff(id);
  }

  /**
   * 丢弃 worktree
   */
  async discard(id: string): Promise<void> {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) {
      throw new Error(`Worktree ${id} 不存在`);
    }
    if (wt.status === 'merged') {
      throw new Error(`Worktree ${id} 已合并，无法丢弃`);
    }
    await this.backend.remove(id);
    this.updateStatus(id, 'discarded');
    // 短暂保留供用户查看，最终由 cleanup 清除
    this.persist();
    this.emit({ type: 'discarded', id });
  }

  // --------------------------------------------------------------------------
  // 状态与元数据
  // --------------------------------------------------------------------------

  /**
   * 更新状态
   */
  updateStatus(id: string, status: WorktreeStatus, changes?: WorktreeInfo['changes']): void {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) return;
    const previous = wt.status;
    if (previous === status) return;
    wt.status = status;
    wt.updatedAt = Date.now();
    if (changes) wt.changes = changes;
    this.worktrees.set(id, wt);
    this.persist();
    this.emit({ type: 'status-changed', id, previous, current: status });
  }

  /**
   * 更新变更统计
   */
  updateChanges(
    id: string,
    changes: { added: number; modified: number; deleted: number },
  ): void {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) return;
    wt.changes = changes;
    wt.updatedAt = Date.now();
    this.persist();
  }

  /**
   * 关联到任务
   */
  attachToTask(id: string, taskId: string): void {
    this.ensureAlive();
    const wt = this.worktrees.get(id);
    if (!wt) return;
    wt.taskId = taskId;
    wt.updatedAt = Date.now();
    this.persist();
  }

  // --------------------------------------------------------------------------
  // 事件订阅
  // --------------------------------------------------------------------------

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  subscribe(handler: (event: WorktreeEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  /**
   * 发射事件
   */
  private emit(event: WorktreeEvent): void {
    this.subscribers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // 订阅者异常不影响其他订阅者
        if (typeof console !== 'undefined') {
          console.error('[WorktreeManager] subscriber error:', err);
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // 统计与清理
  // --------------------------------------------------------------------------

  /**
   * 统计活跃 worktree 数量（非终态）
   */
  countActive(): number {
    return this.list({
      status: ['creating', 'ready', 'in-use', 'modified'],
    }).length;
  }

  /**
   * 统计总数量
   */
  count(): number {
    return this.worktrees.size;
  }

  /**
   * 自动清理：移除已合并/已丢弃 + 超过 N 天的 worktree
   * @returns 清理数量
   */
  async cleanup(): Promise<number> {
    this.ensureAlive();
    const now = Date.now();
    const cutoff = now - this.config.autoCleanupDays * 24 * 60 * 60 * 1000;
    const toRemove: string[] = [];

    this.worktrees.forEach((wt, id) => {
      if ((wt.status === 'merged' || wt.status === 'discarded') && wt.updatedAt < cutoff) {
        toRemove.push(id);
      }
    });

    for (const id of toRemove) {
      try {
        await this.backend.remove(id);
        this.worktrees.delete(id);
      } catch (err) {
        // 单个清理失败不影响其他
        if (typeof console !== 'undefined') {
          console.warn(`[WorktreeManager] cleanup ${id} failed:`, err);
        }
      }
    }

    if (toRemove.length > 0) {
      this.persist();
    }
    return toRemove.length;
  }

  /**
   * 清空所有 worktree（用于测试/重置）
   */
  async clear(): Promise<void> {
    this.ensureAlive();
    const ids = Array.from(this.worktrees.keys());
    for (const id of ids) {
      try {
        await this.backend.remove(id);
      } catch {
        // ignore
      }
    }
    this.worktrees.clear();
    this.persist();
  }

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------

  /**
   * 释放资源
   */
  dispose(): void {
    this.disposed = true;
    this.subscribers.clear();
    this.worktrees.clear();
  }

  /**
   * 确保实例未 dispose
   */
  private ensureAlive(): void {
    if (this.disposed) {
      throw new Error('WorktreeManager 已 dispose，请使用 getWorktreeManager() 获取新实例');
    }
  }

  // --------------------------------------------------------------------------
  // 持久化
  // --------------------------------------------------------------------------

  /**
   * 从存储加载
   */
  private load(): void {
    const items = this.storage.load();
    items.forEach((wt) => {
      this.worktrees.set(wt.id, wt);
    });
  }

  /**
   * 持久化到存储
   */
  private persist(): void {
    this.storage.save(Array.from(this.worktrees.values()));
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: WorktreeManager | null = null;

/**
 * 获取 WorktreeManager 单例
 */
export function getWorktreeManager(): WorktreeManager {
  if (!_instance) {
    _instance = new WorktreeManager();
  }
  return _instance;
}

/**
 * 重置 WorktreeManager 单例（用于测试）
 */
export function resetWorktreeManager(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * 注入自定义实例（用于测试）
 */
export function setWorktreeManager(manager: WorktreeManager | null): void {
  if (_instance && _instance !== manager) {
    _instance.dispose();
  }
  _instance = manager;
}
