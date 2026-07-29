/**
 * # ============================================================
 * # BackgroundTaskEngine - 后台任务引擎 (v1.0.0 Cycle 19 G19-01)
 * # ============================================================
 * # 核心作用：管理多任务并行执行的生命周期，支持创建/启动/暂停/恢复/取消/重试
 * # 运行流程：
 * #   1. 引擎持有 tasks Map<id, BackgroundTask>
 * #   2. 事件总线 TaskEventBus 处理进度通知
 * #   3. TaskStorage 负责 localStorage 持久化
 * #   4. 调度器：单实例内最多 3 个 running 任务（可配置）
 * # 输入参数：createTask(payload, options), startTask(id) 等
 * # 输出结果：任务对象 + 事件流
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-01 初次创建
 * # ============================================================
 */

/**
 * 任务类型
 */
export type TaskType =
  | 'composer'
  | 'agent'
  | 'review'
  | 'best-of-n'
  | 'brainstorm';

/**
 * 任务状态
 */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled';

/**
 * 任务负载 - 联合类型
 */
export type TaskPayload =
  | { type: 'composer'; prompt: string; context?: Record<string, unknown> }
  | { type: 'agent'; task: string; tools?: string[] }
  | { type: 'review'; files: string[] }
  | { type: 'best-of-n'; prompt: string; models: string[] }
  | { type: 'brainstorm'; topic: string };

/**
 * 任务结果 - 联合类型
 */
export type TaskResult =
  | { type: 'composer'; summary: string; edits?: number }
  | { type: 'agent'; output: string; artifacts?: string[] }
  | { type: 'review'; issues: number; score?: number }
  | { type: 'best-of-n'; candidates?: number; selected?: string }
  | { type: 'brainstorm'; plan?: string; questions?: string[] };

/**
 * 任务错误
 */
export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  timestamp: number;
}

/**
 * 后台任务对象
 */
export interface BackgroundTask {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  progress: number; // 0-100
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number; // ms
  payload: TaskPayload;
  result?: TaskResult;
  error?: TaskError;
  metadata?: Record<string, unknown>;
}

/**
 * 任务事件类型
 */
export type TaskEventType =
  | 'created'
  | 'started'
  | 'progress'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'completed'
  | 'error'
  | 'updated';

/**
 * 任务事件负载
 */
export type TaskEventPayload =
  | { type: 'created'; task: BackgroundTask }
  | { type: 'started'; taskId: string; timestamp: number }
  | { type: 'progress'; taskId: string; progress: number; message?: string }
  | { type: 'paused'; taskId: string }
  | { type: 'resumed'; taskId: string }
  | { type: 'cancelled'; taskId: string }
  | { type: 'completed'; task: BackgroundTask }
  | { type: 'error'; taskId: string; error: TaskError }
  | { type: 'updated'; task: BackgroundTask };

/**
 * 任务事件处理器
 */
export type TaskEventHandler = (payload: TaskEventPayload) => void;

/**
 * 任务过滤器
 */
export interface TaskFilter {
  type?: TaskType | TaskType[];
  status?: TaskStatus | TaskStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * 引擎配置
 */
export interface EngineConfig {
  /** 最大并发数 */
  maxConcurrent: number;
  /** 历史保留数 */
  maxHistory: number;
  /** 持久化 key */
  storageKey: string;
  /** 启用持久化 */
  enablePersistence: boolean;
  /** 自动清理（天） */
  autoCleanupDays: number;
}

/**
 * 创建任务选项
 */
export interface CreateTaskOptions {
  title?: string;
  metadata?: Record<string, unknown>;
  /** 自动启动（默认 false） */
  autoStart?: boolean;
}

const DEFAULT_CONFIG: EngineConfig = {
  maxConcurrent: 3,
  maxHistory: 100,
  storageKey: 'hermes.background_tasks',
  enablePersistence: true,
  autoCleanupDays: 7,
};

const ACTIVE_STATUSES: TaskStatus[] = ['pending', 'queued', 'running', 'waiting', 'paused'];
const TERMINAL_STATUSES: TaskStatus[] = ['done', 'error', 'cancelled'];

/**
 * 生成任务 ID
 */
function _genId(): string {
  return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 是否激活状态
 */
function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * 是否终态
 */
function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 任务事件总线
 */
class TaskEventBus {
  private listeners: Map<TaskEventType, Set<TaskEventHandler>> = new Map();

  on(event: TaskEventType, handler: TaskEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: TaskEventType, handler: TaskEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: TaskEventType, payload: TaskEventPayload): void {
    this.listeners.get(event)?.forEach(handler => {
      try {
        handler(payload);
      } catch (err) {
        // 静默吞掉 listener 错误
        // eslint-disable-next-line no-console
        console.error('[TaskEventBus] handler error:', err);
      }
    });
  }

  once(event: TaskEventType, handler: TaskEventHandler): void {
    const wrapped: TaskEventHandler = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    this.on(event, wrapped);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * 任务存储（localStorage）
 */
class TaskStorage {
  constructor(private readonly config: EngineConfig) {}

  save(tasks: BackgroundTask[]): void {
    if (!this.config.enablePersistence) return;
    if (typeof localStorage === 'undefined') return;
    try {
      const active = tasks.filter(t => isActiveStatus(t.status));
      const terminal = tasks.filter(t => isTerminalStatus(t.status))
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
        .slice(0, this.config.maxHistory);
      const merged = [...active, ...terminal];
      const data = {
        version: '1.0',
        tasks: merged,
        lastSync: Date.now(),
      };
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[TaskStorage] save failed:', err);
    }
  }

  load(): BackgroundTask[] {
    if (!this.config.enablePersistence) return [];
    if (typeof localStorage === 'undefined') return [];
    try {
      const data = localStorage.getItem(this.config.storageKey);
      if (!data) return [];
      const parsed = JSON.parse(data) as { version: string; tasks: BackgroundTask[] };
      // 恢复时：running/waiting/paused → queued
      return parsed.tasks.map(t => {
        if (t.status === 'running' || t.status === 'waiting' || t.status === 'paused') {
          return { ...t, status: 'queued' as TaskStatus };
        }
        return t;
      });
    } catch {
      return [];
    }
  }

  clear(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.config.storageKey);
  }
}

/**
 * 后台任务引擎
 */
export class BackgroundTaskEngine {
  private tasks: Map<string, BackgroundTask> = new Map();
  private readonly eventBus: TaskEventBus = new TaskEventBus();
  private readonly storage: TaskStorage;
  private readonly config: EngineConfig;
  private runningCount: number = 0;
  private readonly queue: string[] = [];

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
    this.storage = new TaskStorage(this.config);
    this.restore();
  }

  // ==================== 任务管理 ====================

  /**
   * 创建任务
   */
  createTask(payload: TaskPayload, options: CreateTaskOptions = {}): BackgroundTask {
    const id = _genId();
    const title = options.title ?? this._defaultTitle(payload);
    const task: BackgroundTask = {
      id,
      type: payload.type,
      title,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      payload,
      metadata: options.metadata,
    };
    this.tasks.set(id, task);
    this._emit('created', { type: 'created', task });
    this._emit('updated', { type: 'updated', task });

    if (options.autoStart ?? true) {
      this.startTask(id);
    } else {
      this._setStatus(id, 'queued');
    }
    this._persist();
    return task;
  }

  /**
   * 启动任务
   */
  startTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (!['pending', 'queued', 'paused', 'error', 'cancelled'].includes(task.status)) {
      throw new Error(`Cannot start task in status: ${task.status}`);
    }
    if (this.runningCount >= this.config.maxConcurrent) {
      this._setStatus(id, 'queued');
      this.queue.push(id);
      return;
    }
    this.runningCount++;
    const now = Date.now();
    task.startedAt = task.startedAt ?? now;
    this._setStatus(id, 'running');
    this._emit('started', { type: 'started', taskId: id, timestamp: now });
    // 模拟进度（实际应该由 Worker 驱动）
    this._simulateProgress(id);
  }

  /**
   * 暂停任务
   */
  pauseTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (task.status !== 'running') {
      throw new Error(`Cannot pause task in status: ${task.status}`);
    }
    this.runningCount = Math.max(0, this.runningCount - 1);
    this._setStatus(id, 'paused');
    this._emit('paused', { type: 'paused', taskId: id });
    this._persist();
    this._scheduleNext();
  }

  /**
   * 恢复任务
   */
  resumeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (task.status !== 'paused') {
      throw new Error(`Cannot resume task in status: ${task.status}`);
    }
    if (this.runningCount >= this.config.maxConcurrent) {
      this._setStatus(id, 'queued');
      this.queue.push(id);
      return;
    }
    this.runningCount++;
    this._setStatus(id, 'running');
    this._emit('resumed', { type: 'resumed', taskId: id });
    this._simulateProgress(id);
  }

  /**
   * 取消任务
   */
  cancelTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (isTerminalStatus(task.status)) {
      return; // 已经结束
    }
    if (task.status === 'running' || task.status === 'waiting' || task.status === 'paused') {
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
    this._setStatus(id, 'cancelled');
    this._emit('cancelled', { type: 'cancelled', taskId: id });
    this._persist();
    this._scheduleNext();
  }

  /**
   * 重试任务
   */
  retryTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (task.status !== 'error' && task.status !== 'cancelled') {
      throw new Error(`Cannot retry task in status: ${task.status}`);
    }
    task.progress = 0;
    task.error = undefined;
    task.completedAt = undefined;
    task.duration = undefined;
    this.tasks.set(id, task);
    this.startTask(id);
  }

  /**
   * 完成任务（由外部 Worker 调用）
   */
  completeTask(id: string, result: TaskResult): void {
    const task = this.tasks.get(id);
    if (!task) return;
    this.runningCount = Math.max(0, this.runningCount - 1);
    const now = Date.now();
    task.completedAt = now;
    task.duration = (task.startedAt ? now - task.startedAt : 0);
    task.result = result;
    task.progress = 100;
    this._setStatus(id, 'done');
    this._emit('completed', { type: 'completed', task });
    this._persist();
    this._scheduleNext();
  }

  /**
   * 任务失败（由外部 Worker 调用）
   */
  failTask(id: string, error: TaskError | string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    this.runningCount = Math.max(0, this.runningCount - 1);
    const err: TaskError = typeof error === 'string'
      ? { code: 'TASK_ERROR', message: error, timestamp: Date.now() }
      : error;
    task.error = err;
    task.completedAt = Date.now();
    this._setStatus(id, 'error');
    this._emit('error', { type: 'error', taskId: id, error: err });
    this._persist();
    this._scheduleNext();
  }

  /**
   * 更新进度
   */
  updateProgress(id: string, progress: number, message?: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    const clamped = Math.max(0, Math.min(100, progress));
    task.progress = clamped;
    this._emit('progress', { type: 'progress', taskId: id, progress: clamped, message });
  }

  // ==================== 查询 ====================

  /**
   * 获取单个任务
   */
  getTask(id: string): BackgroundTask | null {
    return this.tasks.get(id) ?? null;
  }

  /**
   * 列出任务
   */
  listTasks(filter?: TaskFilter): BackgroundTask[] {
    let result = Array.from(this.tasks.values());

    if (filter) {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        result = result.filter(t => types.includes(t.type));
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        result = result.filter(t => statuses.includes(t.status));
      }
      if (filter.search) {
        const search = filter.search.toLowerCase();
        result = result.filter(t => t.title.toLowerCase().includes(search));
      }
      // 默认按 createdAt 倒序
      result.sort((a, b) => b.createdAt - a.createdAt);
      if (filter.offset) {
        result = result.slice(filter.offset);
      }
      if (filter.limit) {
        result = result.slice(0, filter.limit);
      }
    } else {
      result.sort((a, b) => b.createdAt - a.createdAt);
    }

    return result;
  }

  /**
   * 获取激活任务
   */
  getActiveTasks(): BackgroundTask[] {
    return this.listTasks({ status: ACTIVE_STATUSES });
  }

  /**
   * 获取历史任务
   */
  getHistoryTasks(): BackgroundTask[] {
    return this.listTasks({ status: TERMINAL_STATUSES });
  }

  /**
   * 任务统计
   */
  getStats(): {
    total: number;
    active: number;
    done: number;
    error: number;
    cancelled: number;
    avgDuration: number;
  } {
    const all = Array.from(this.tasks.values());
    const doneTasks = all.filter(t => t.status === 'done' && t.duration);
    return {
      total: all.length,
      active: all.filter(t => isActiveStatus(t.status)).length,
      done: all.filter(t => t.status === 'done').length,
      error: all.filter(t => t.status === 'error').length,
      cancelled: all.filter(t => t.status === 'cancelled').length,
      avgDuration: doneTasks.length > 0
        ? doneTasks.reduce((sum, t) => sum + (t.duration ?? 0), 0) / doneTasks.length
        : 0,
    };
  }

  // ==================== 事件订阅 ====================

  on(event: TaskEventType, handler: TaskEventHandler): () => void {
    return this.eventBus.on(event, handler);
  }

  once(event: TaskEventType, handler: TaskEventHandler): void {
    this.eventBus.once(event, handler);
  }

  off(event: TaskEventType, handler: TaskEventHandler): void {
    this.eventBus.off(event, handler);
  }

  // ==================== 持久化 ====================

  persist(): void {
    this._persist();
  }

  restore(): BackgroundTask[] {
    const loaded = this.storage.load();
    loaded.forEach(t => this.tasks.set(t.id, t));
    // 恢复时把 queued 的任务重新入队
    const queued = loaded.filter(t => t.status === 'queued');
    queued.forEach(t => this.queue.push(t.id));
    this._scheduleNext();
    return loaded;
  }

  // ==================== 清理 ====================

  clearHistory(): void {
    const toRemove = Array.from(this.tasks.values())
      .filter(t => isTerminalStatus(t.status))
      .map(t => t.id);
    toRemove.forEach(id => this.tasks.delete(id));
    this._persist();
  }

  removeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === 'running' || task.status === 'waiting') {
      throw new Error('Cannot remove a running task. Cancel it first.');
    }
    this.tasks.delete(id);
    this._persist();
  }

  clear(): void {
    this.tasks.clear();
    this.queue.length = 0;
    this.runningCount = 0;
    this._persist();
  }

  // ==================== 私有方法 ====================

  private _setStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = status;
    this._emit('updated', { type: 'updated', task });
  }

  private _emit(event: TaskEventType, payload: TaskEventPayload): void {
    this.eventBus.emit(event, payload);
  }

  private _persist(): void {
    this.storage.save(Array.from(this.tasks.values()));
  }

  private _defaultTitle(payload: TaskPayload): string {
    switch (payload.type) {
      case 'composer':
        return `Composer: ${payload.prompt.slice(0, 30)}${payload.prompt.length > 30 ? '...' : ''}`;
      case 'agent':
        return `Agent: ${payload.task.slice(0, 30)}${payload.task.length > 30 ? '...' : ''}`;
      case 'review':
        return `Review: ${payload.files.length} file(s)`;
      case 'best-of-n':
        return `Best-of-N: ${payload.models.length} models`;
      case 'brainstorm':
        return `Brainstorm: ${payload.topic.slice(0, 30)}${payload.topic.length > 30 ? '...' : ''}`;
    }
  }

  /**
   * 模拟进度推进（仅在无 Worker 时使用）
   * 实际使用中，Worker 应当调用 updateProgress / completeTask / failTask
   */
  private _simulateProgress(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    const interval = setInterval(() => {
      const t = this.tasks.get(id);
      if (!t || isTerminalStatus(t.status) || t.status === 'paused') {
        clearInterval(interval);
        return;
      }
      if (t.progress < 100) {
        const increment = Math.random() * 10 + 5;
        this.updateProgress(id, Math.min(100, t.progress + increment));
      } else {
        clearInterval(interval);
      }
    }, 1000);
  }

  private _scheduleNext(): void {
    while (this.queue.length > 0 && this.runningCount < this.config.maxConcurrent) {
      const nextId = this.queue.shift();
      if (nextId) {
        this.startTask(nextId);
      }
    }
  }
}

/**
 * 全局单例
 */
let globalEngine: BackgroundTaskEngine | null = null;

export function getBackgroundTaskEngine(config?: Partial<EngineConfig>): BackgroundTaskEngine {
  if (!globalEngine) {
    globalEngine = new BackgroundTaskEngine(config);
  }
  return globalEngine;
}

export function resetBackgroundTaskEngine(): void {
  globalEngine = null;
}

export const TASK_ACTIVE_STATUSES = ACTIVE_STATUSES;
export const TASK_TERMINAL_STATUSES = TERMINAL_STATUSES;
export { isActiveStatus, isTerminalStatus };
