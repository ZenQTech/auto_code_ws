/**
 * # ============================================================
 * # Task Checkpoint Engine - 任务检查点引擎 (v1.0.0 Cycle 35 G35-03)
 * # ============================================================
 * # 核心作用：实现统一任务检查点引擎，支持完整+增量快照、Time Travel、版本管理、Diff
 * # 对标产品：Temporal / Event Sourcing / Git
 * # 运行流程：
 * #   1. createThread() 创建线程
 * #   2. saveCheckpoint() / saveIncremental() 保存快照
 * #   3. createBranch() / switchBranch() 分支管理
 * #   4. createTag() 标签管理
 * #   5. restore() / checkout() Time Travel
 * #   6. diff() 对比两版本
 * #   7. compress() / cleanup() 压缩与清理
 * # 输入参数：ThreadId / Checkpoint
 * # 输出结果：Version / CheckpointDiff
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 检查点
 */
export interface Checkpoint {
  id: string;
  threadId: string;
  version: number;
  parentVersion?: number;
  branch: string;
  tag?: string;
  type: 'full' | 'incremental';
  state: Record<string, unknown>;
  diff?: Record<string, unknown>;
  baseVersion?: number;
  size: number;
  compressedSize?: number;
  message?: string;
  createdAt: number;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

/**
 * 版本
 */
export interface Version {
  version: number;
  threadId: string;
  branch: string;
  checkpointId: string;
  createdAt: number;
  createdBy: string;
  message?: string;
  tags: string[];
  parentVersion?: number;
}

/**
 * 分支
 */
export interface Branch {
  name: string;
  threadId: string;
  headVersion: number;
  createdAt: number;
  createdBy: string;
  description?: string;
  protected: boolean;
}

/**
 * 标签
 */
export interface Tag {
  name: string;
  threadId: string;
  version: number;
  createdAt: number;
  message?: string;
}

/**
 * 线程
 */
export interface Thread {
  id: string;
  name: string;
  description?: string;
  engine: string;
  engineInstanceId: string;
  createdAt: number;
  lastActivityAt: number;
  branchCount: number;
  versionCount: number;
  totalSize: number;
  metadata?: Record<string, unknown>;
}

/**
 * Diff 结果
 */
export interface CheckpointDiff {
  fromVersion: number;
  toVersion: number;
  added: string[];
  removed: string[];
  modified: string[];
  changes: Array<{
    path: string;
    before: unknown;
    after: unknown;
    type: 'added' | 'removed' | 'modified';
  }>;
  summary: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
  };
}

/**
 * 引擎事件
 */
export type CheckpointEvent =
  | 'thread-created'
  | 'thread-deleted'
  | 'checkpoint-saved'
  | 'checkpoint-deleted'
  | 'version-created'
  | 'branch-created'
  | 'branch-switched'
  | 'branch-deleted'
  | 'tag-created'
  | 'tag-deleted'
  | 'restore-completed'
  | 'cleanup-completed';

/**
 * 引擎配置
 */
export interface CheckpointConfig {
  maxVersionsPerThread: number;
  autoSaveIntervalMs: number;
  autoSaveSteps: number;
  autoCleanup: boolean;
  enableCompression: boolean;
  enablePersistence: boolean;
  enableSync: boolean;
}

// ============ 默认配置 ============

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  maxVersionsPerThread: 100,
  autoSaveIntervalMs: 300000,
  autoSaveSteps: 10,
  autoCleanup: true,
  enableCompression: true,
  enablePersistence: true,
  enableSync: true,
};

// ============ 工具函数 ============

export function generateThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateCheckpointId(): string {
  return `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateVersionNumber(): number {
  // 基础版本号生成（保留供外部/默认场景使用）
  // 推荐使用 engine.nextVersion(threadId) 保证单调递增
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export function calculateSize(state: Record<string, unknown>): number {
  return new Blob([JSON.stringify(state)]).size;
}

export function shallowDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { added: string[]; removed: string[]; modified: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) {
      added.push(key);
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      modified.push(key);
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      removed.push(key);
    }
  }
  return { added, removed, modified };
}

// ============ 引擎实现 ============

export class TaskCheckpointEngine {
  private threads: Map<string, Thread> = new Map();
  private checkpoints: Map<string, Checkpoint> = new Map();
  private versions: Map<string, Version[]> = new Map(); // threadId -> versions
  private branches: Map<string, Branch[]> = new Map(); // threadId -> branches
  private tags: Map<string, Tag[]> = new Map(); // threadId -> tags
  private currentBranch: Map<string, string> = new Map(); // threadId -> branch name
  private config: CheckpointConfig;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private storageKey: string;

  constructor(config: Partial<CheckpointConfig> = {}) {
    this.config = { ...DEFAULT_CHECKPOINT_CONFIG, ...config };
    this.storageKey = 'task-checkpoint';
    this.loadFromStorage();
  }

  /**
   * 内部方法：为指定线程生成单调递增的版本号
   * 使用时间戳 + 线程局部计数器，确保同一线程的版本号严格递增
   */
  private nextVersion(threadId: string): number {
    const versions = this.versions.get(threadId) || [];
    const lastVersion = versions.length > 0 ? versions[versions.length - 1].version : 0;
    // 时间戳（毫秒）* 1000 确保有足够粒度
    const timePart = Date.now() * 1000;
    // 取 max(时间戳, 上一个版本 + 1) 保证严格单调
    return Math.max(timePart, lastVersion + 1);
  }

  // ============ 存储 ============

  private loadFromStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.threads) for (const t of parsed.threads) this.threads.set(t.id, t);
        if (parsed.checkpoints) for (const c of parsed.checkpoints) this.checkpoints.set(c.id, c);
        if (parsed.versions) for (const [tid, vs] of parsed.versions) this.versions.set(tid, vs);
        if (parsed.branches) for (const [tid, bs] of parsed.branches) this.branches.set(tid, bs);
        if (parsed.tags) for (const [tid, ts] of parsed.tags) this.tags.set(tid, ts);
        if (parsed.currentBranch) for (const [tid, b] of parsed.currentBranch) this.currentBranch.set(tid, b);
      }
    } catch (e) {
      // ignore
    }
  }

  private saveToStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = {
        threads: Array.from(this.threads.values()),
        checkpoints: Array.from(this.checkpoints.values()).slice(-500),
        versions: Array.from(this.versions.entries()),
        branches: Array.from(this.branches.entries()),
        tags: Array.from(this.tags.entries()),
        currentBranch: Array.from(this.currentBranch.entries()),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  // ============ 线程管理 ============

  createThread(config: {
    name: string;
    description?: string;
    engine: string;
    engineInstanceId: string;
    metadata?: Record<string, unknown>;
  }): Thread {
    const id = generateThreadId();
    const now = Date.now();
    const thread: Thread = {
      id,
      name: config.name,
      description: config.description,
      engine: config.engine,
      engineInstanceId: config.engineInstanceId,
      createdAt: now,
      lastActivityAt: now,
      branchCount: 1,
      versionCount: 0,
      totalSize: 0,
      metadata: config.metadata,
    };
    this.threads.set(id, thread);
    // 默认分支
    this.branches.set(id, [{
      name: 'main',
      threadId: id,
      headVersion: 0,
      createdAt: now,
      createdBy: 'system',
      description: '默认主分支',
      protected: true,
    }]);
    this.versions.set(id, []);
    this.tags.set(id, []);
    this.currentBranch.set(id, 'main');
    this.saveToStorage();
    this.emit('thread-created', thread);
    return thread;
  }

  deleteThread(threadId: string): boolean {
    const thread = this.threads.get(threadId);
    if (!thread) return false;
    // 删除相关检查点
    const versions = this.versions.get(threadId) || [];
    for (const v of versions) {
      this.checkpoints.delete(v.checkpointId);
    }
    this.threads.delete(threadId);
    this.versions.delete(threadId);
    this.branches.delete(threadId);
    this.tags.delete(threadId);
    this.currentBranch.delete(threadId);
    this.saveToStorage();
    this.emit('thread-deleted', { threadId });
    return true;
  }

  getThread(threadId: string): Thread | undefined {
    return this.threads.get(threadId);
  }

  listThreads(): Thread[] {
    return Array.from(this.threads.values());
  }

  // ============ 检查点管理 ============

  saveCheckpoint(
    threadId: string,
    state: Record<string, unknown>,
    options: { message?: string; createdBy?: string; tag?: string } = {},
  ): Checkpoint {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    const branch = this.currentBranch.get(threadId) || 'main';
    const versions = this.versions.get(threadId) || [];
    const parentVersion = versions.length > 0 ? versions[versions.length - 1].version : undefined;
    const version = this.nextVersion(threadId);
    const id = generateCheckpointId();
    const now = Date.now();
    const checkpoint: Checkpoint = {
      id,
      threadId,
      version,
      parentVersion,
      branch,
      tag: options.tag,
      type: 'full',
      state: { ...state },
      size: calculateSize(state),
      message: options.message,
      createdAt: now,
      createdBy: options.createdBy || 'system',
    };
    this.checkpoints.set(id, checkpoint);
    // 更新版本
    const newVersion: Version = {
      version,
      threadId,
      branch,
      checkpointId: id,
      createdAt: now,
      createdBy: checkpoint.createdBy,
      message: options.message,
      tags: options.tag ? [options.tag] : [],
      parentVersion,
    };
    versions.push(newVersion);
    this.versions.set(threadId, versions);
    // 更新分支 head
    const branches = this.branches.get(threadId) || [];
    const b = branches.find((br) => br.name === branch);
    if (b) b.headVersion = version;
    this.branches.set(threadId, branches);
    // 更新线程
    thread.versionCount = versions.length;
    thread.totalSize += checkpoint.size;
    thread.lastActivityAt = now;
    this.threads.set(threadId, thread);
    // 自动清理
    if (this.config.autoCleanup && versions.length > this.config.maxVersionsPerThread) {
      this.cleanup(threadId, { keepTagged: true });
    }
    this.saveToStorage();
    this.emit('checkpoint-saved', checkpoint);
    this.emit('version-created', newVersion);
    return checkpoint;
  }

  saveIncremental(
    threadId: string,
    state: Record<string, unknown>,
    baseVersion?: number,
    options: { message?: string; createdBy?: string } = {},
  ): Checkpoint {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    const branch = this.currentBranch.get(threadId) || 'main';
    const versions = this.versions.get(threadId) || [];
    const latestVersion = versions[versions.length - 1];
    const actualBase = baseVersion ?? latestVersion?.version;
    if (actualBase === undefined) {
      // 没有基础版本，保存为完整
      return this.saveCheckpoint(threadId, state, options);
    }
    // 获取基础检查点
    const baseCheckpoint = Array.from(this.checkpoints.values()).find(
      (c) => c.threadId === threadId && c.version === actualBase,
    );
    if (!baseCheckpoint) {
      return this.saveCheckpoint(threadId, state, options);
    }
    const diffResult = shallowDiff(baseCheckpoint.state, state);
    const version = this.nextVersion(threadId);
    const id = generateCheckpointId();
    const now = Date.now();
    const checkpoint: Checkpoint = {
      id,
      threadId,
      version,
      parentVersion: latestVersion?.version,
      branch,
      type: 'incremental',
      state: {}, // 增量不存完整 state
      diff: {
        ...diffResult,
        state,
      },
      baseVersion: actualBase,
      size: calculateSize({ diff: diffResult, state }),
      message: options.message,
      createdAt: now,
      createdBy: options.createdBy || 'system',
    };
    this.checkpoints.set(id, checkpoint);
    const newVersion: Version = {
      version,
      threadId,
      branch,
      checkpointId: id,
      createdAt: now,
      createdBy: checkpoint.createdBy,
      message: options.message,
      tags: [],
      parentVersion: latestVersion?.version,
    };
    versions.push(newVersion);
    this.versions.set(threadId, versions);
    const branches = this.branches.get(threadId) || [];
    const b = branches.find((br) => br.name === branch);
    if (b) b.headVersion = version;
    this.branches.set(threadId, branches);
    thread.versionCount = versions.length;
    thread.lastActivityAt = now;
    this.threads.set(threadId, thread);
    this.saveToStorage();
    this.emit('checkpoint-saved', checkpoint);
    this.emit('version-created', newVersion);
    return checkpoint;
  }

  // ============ 版本与分支 ============

  getVersion(threadId: string, version: number): Version | undefined {
    const versions = this.versions.get(threadId) || [];
    return versions.find((v) => v.version === version);
  }

  listVersions(threadId: string, filter?: { branch?: string }): Version[] {
    let list = this.versions.get(threadId) || [];
    if (filter?.branch) {
      list = list.filter((v) => v.branch === filter.branch);
    }
    return list;
  }

  createBranch(threadId: string, branchName: string, fromVersion: number, options: { description?: string; createdBy?: string } = {}): Branch {
    const branches = this.branches.get(threadId) || [];
    if (branches.find((b) => b.name === branchName)) {
      throw new Error(`Branch ${branchName} already exists`);
    }
    const branch: Branch = {
      name: branchName,
      threadId,
      headVersion: fromVersion,
      createdAt: Date.now(),
      createdBy: options.createdBy || 'system',
      description: options.description,
      protected: false,
    };
    branches.push(branch);
    this.branches.set(threadId, branches);
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.branchCount = branches.length;
      this.threads.set(threadId, thread);
    }
    this.saveToStorage();
    this.emit('branch-created', branch);
    return branch;
  }

  switchBranch(threadId: string, branchName: string): boolean {
    const branches = this.branches.get(threadId) || [];
    const branch = branches.find((b) => b.name === branchName);
    if (!branch) return false;
    this.currentBranch.set(threadId, branchName);
    this.saveToStorage();
    this.emit('branch-switched', { threadId, branchName });
    return true;
  }

  deleteBranch(threadId: string, branchName: string): boolean {
    if (branchName === 'main') return false; // 不可删除主分支
    const branches = this.branches.get(threadId) || [];
    const idx = branches.findIndex((b) => b.name === branchName);
    if (idx < 0) return false;
    branches.splice(idx, 1);
    this.branches.set(threadId, branches);
    if (this.currentBranch.get(threadId) === branchName) {
      this.currentBranch.set(threadId, 'main');
    }
    this.saveToStorage();
    this.emit('branch-deleted', { threadId, branchName });
    return true;
  }

  listBranches(threadId: string): Branch[] {
    return this.branches.get(threadId) || [];
  }

  // ============ 标签 ============

  createTag(threadId: string, tagName: string, version: number, message?: string): Tag {
    const tags = this.tags.get(threadId) || [];
    if (tags.find((t) => t.name === tagName)) {
      throw new Error(`Tag ${tagName} already exists`);
    }
    const tag: Tag = {
      name: tagName,
      threadId,
      version,
      createdAt: Date.now(),
      message,
    };
    tags.push(tag);
    this.tags.set(threadId, tags);
    this.saveToStorage();
    this.emit('tag-created', tag);
    return tag;
  }

  deleteTag(threadId: string, tagName: string): boolean {
    const tags = this.tags.get(threadId) || [];
    const idx = tags.findIndex((t) => t.name === tagName);
    if (idx < 0) return false;
    tags.splice(idx, 1);
    this.tags.set(threadId, tags);
    this.saveToStorage();
    this.emit('tag-deleted', { threadId, tagName });
    return true;
  }

  getTag(threadId: string, tagName: string): Tag | undefined {
    const tags = this.tags.get(threadId) || [];
    return tags.find((t) => t.name === tagName);
  }

  listTags(threadId: string): Tag[] {
    return this.tags.get(threadId) || [];
  }

  // ============ Time Travel ============

  restore(threadId: string, version: number): Record<string, unknown> {
    const checkpoint = this.findCheckpointByVersion(threadId, version);
    if (!checkpoint) throw new Error(`Version ${version} not found`);
    const state = this.reconstructState(checkpoint);
    this.emit('restore-completed', { threadId, version, state });
    return state;
  }

  restoreToTag(threadId: string, tagName: string): Record<string, unknown> {
    const tag = this.getTag(threadId, tagName);
    if (!tag) throw new Error(`Tag ${tagName} not found`);
    return this.restore(threadId, tag.version);
  }

  restoreToBranch(threadId: string, branchName: string): Record<string, unknown> {
    const branches = this.branches.get(threadId) || [];
    const branch = branches.find((b) => b.name === branchName);
    if (!branch) throw new Error(`Branch ${branchName} not found`);
    return this.restore(threadId, branch.headVersion);
  }

  checkout(threadId: string, version: number): void {
    const checkpoint = this.findCheckpointByVersion(threadId, version);
    if (!checkpoint) throw new Error(`Version ${version} not found`);
    this.currentBranch.set(threadId, checkpoint.branch);
    this.saveToStorage();
  }

  // ============ Diff ============

  diff(threadId: string, fromVersion: number, toVersion: number): CheckpointDiff {
    const fromState = this.reconstructStateAt(threadId, fromVersion);
    const toState = this.reconstructStateAt(threadId, toVersion);
    const fromKeys = Object.keys(fromState);
    const toKeys = Object.keys(toState);
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    for (const k of toKeys) {
      if (!fromKeys.includes(k)) {
        added.push(k);
      } else if (JSON.stringify(fromState[k]) !== JSON.stringify(toState[k])) {
        modified.push(k);
      }
    }
    for (const k of fromKeys) {
      if (!toKeys.includes(k)) {
        removed.push(k);
      }
    }
    const changes: CheckpointDiff['changes'] = [];
    for (const k of added) {
      changes.push({ path: k, before: undefined, after: toState[k], type: 'added' });
    }
    for (const k of removed) {
      changes.push({ path: k, before: fromState[k], after: undefined, type: 'removed' });
    }
    for (const k of modified) {
      changes.push({ path: k, before: fromState[k], after: toState[k], type: 'modified' });
    }
    return {
      fromVersion,
      toVersion,
      added,
      removed,
      modified,
      changes,
      summary: {
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
      },
    };
  }

  diffBranches(threadId: string, branchA: string, branchB: string): CheckpointDiff {
    const branches = this.branches.get(threadId) || [];
    const a = branches.find((b) => b.name === branchA);
    const b = branches.find((br) => br.name === branchB);
    if (!a || !b) throw new Error('Branch not found');
    return this.diff(threadId, a.headVersion, b.headVersion);
  }

  // ============ 内部：检查点查找与状态重建 ============

  private findCheckpointByVersion(threadId: string, version: number): Checkpoint | undefined {
    const versions = this.versions.get(threadId) || [];
    const v = versions.find((vs) => vs.version === version);
    if (!v) return undefined;
    return this.checkpoints.get(v.checkpointId);
  }

  private reconstructStateAt(threadId: string, version: number): Record<string, unknown> {
    const checkpoint = this.findCheckpointByVersion(threadId, version);
    if (!checkpoint) return {};
    return this.reconstructState(checkpoint);
  }

  private reconstructState(checkpoint: Checkpoint): Record<string, unknown> {
    if (checkpoint.type === 'full') {
      return { ...checkpoint.state };
    }
    // 增量：基于 base 重建
    if (checkpoint.baseVersion !== undefined) {
      const base = this.findCheckpointByVersion(checkpoint.threadId, checkpoint.baseVersion);
      if (base) {
        return { ...base.state, ...(checkpoint.diff?.state as any) };
      }
    }
    return {};
  }

  // ============ 持久化与同步 ============

  exportThread(threadId: string): string | undefined {
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;
    const checkpoints = Array.from(this.checkpoints.values()).filter((c) => c.threadId === threadId);
    return JSON.stringify({ thread, checkpoints, versions: this.versions.get(threadId) || [] });
  }

  importThread(serialized: string): Thread {
    const data = JSON.parse(serialized);
    if (data.thread) this.threads.set(data.thread.id, data.thread);
    if (data.checkpoints) for (const c of data.checkpoints) this.checkpoints.set(c.id, c);
    if (data.versions) this.versions.set(data.thread.id, data.versions);
    this.saveToStorage();
    return data.thread;
  }

  // ============ 清理 ============

  cleanup(threadId: string, options: { keepTagged?: boolean; keepCount?: number } = {}): number {
    const versions = this.versions.get(threadId) || [];
    const tags = this.tags.get(threadId) || [];
    const keepTagged = options.keepTagged ?? true;
    const keepCount = options.keepCount ?? this.config.maxVersionsPerThread;
    const taggedVersions = new Set(tags.map((t) => t.version));
    const sorted = [...versions].sort((a, b) => a.version - b.version);
    const toDelete: string[] = [];
    for (let i = 0; i < sorted.length - keepCount; i++) {
      const v = sorted[i];
      if (keepTagged && taggedVersions.has(v.version)) continue;
      toDelete.push(v.checkpointId);
    }
    for (const id of toDelete) {
      this.checkpoints.delete(id);
    }
    const remaining = versions.filter((v) => !toDelete.includes(v.checkpointId));
    this.versions.set(threadId, remaining);
    this.saveToStorage();
    this.emit('cleanup-completed', { threadId, deleted: toDelete.length });
    return toDelete.length;
  }

  // ============ 引擎注册 ============

  registerEngine(engineId: string, instanceId: string, threadName: string): string {
    const thread = this.createThread({
      name: threadName,
      engine: engineId,
      engineInstanceId: instanceId,
    });
    return thread.id;
  }

  // ============ 统计 ============

  getStats() {
    const threads = Array.from(this.threads.values());
    return {
      threads: {
        total: threads.length,
        totalVersions: threads.reduce((s, t) => s + t.versionCount, 0),
        totalSize: threads.reduce((s, t) => s + t.totalSize, 0),
      },
      checkpoints: {
        total: this.checkpoints.size,
        full: Array.from(this.checkpoints.values()).filter((c) => c.type === 'full').length,
        incremental: Array.from(this.checkpoints.values()).filter((c) => c.type === 'incremental').length,
      },
      branches: Array.from(this.branches.values()).reduce((s, bs) => s + bs.length, 0),
      tags: Array.from(this.tags.values()).reduce((s, ts) => s + ts.length, 0),
    };
  }

  // ============ 事件系统 ============

  on(event: CheckpointEvent, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
    return () => {
      const list = this.listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private emit(event: CheckpointEvent, data: any): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const h of list) {
        try {
          h(data);
        } catch (e) {
          // ignore
        }
      }
    }
  }
}

// ============ 单例 ============

let defaultEngine: TaskCheckpointEngine | null = null;

export function getDefaultTaskCheckpointEngine(): TaskCheckpointEngine {
  if (!defaultEngine) {
    defaultEngine = new TaskCheckpointEngine();
  }
  return defaultEngine;
}

export function resetDefaultTaskCheckpointEngine(): void {
  defaultEngine = null;
}
