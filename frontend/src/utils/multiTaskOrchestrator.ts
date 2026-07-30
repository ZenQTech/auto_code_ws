/**
 * # ============================================================
 * # MultiTaskOrchestrator - 多任务并行编排引擎 (v1.0.0 Cycle 24 G24-02)
 * # ============================================================
 * # 核心作用：支持 5-10 个 vibe coding 任务并行执行，提供依赖编排、冲突检测、预算控制
 * # 运行流程：
 * #   1. 引擎持有 tasks Map<id, MultiTask>
 * #   2. createTask 创建任务并加入 pending 队列
 * #   3. start() 调度器按 maxConcurrent + 依赖关系选择可执行任务
 * #   4. updateProgress/completeTask 推进任务状态
 * #   5. detectConflicts 在调度前发现文件冲突
 * #   6. 事件总线 OrchestratorEventBus 通知 UI
 * # 输入参数：createTask(input), start(taskId), updateProgress(taskId, progress, step) 等
 * # 输出结果：MultiTask 对象列表 + 实时事件流
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 多任务类型
 */
export type MultiTaskType =
  | 'requirement'
  | 'architecture'
  | 'implementation'
  | 'testing'
  | 'review'
  | 'documentation'
  | 'refactor'
  | 'deployment';

export const MULTI_TASK_TYPE_LABELS: Record<MultiTaskType, string> = {
  requirement: '需求分析',
  architecture: '架构设计',
  implementation: '代码实现',
  testing: '测试',
  review: '代码评审',
  documentation: '文档生成',
  refactor: '重构',
  deployment: '部署',
};

export const MULTI_TASK_TYPE_ICONS: Record<MultiTaskType, string> = {
  requirement: '📋',
  architecture: '🏗️',
  implementation: '💻',
  testing: '🧪',
  review: '🔍',
  documentation: '📚',
  refactor: '♻️',
  deployment: '🚀',
};

export const MULTI_TASK_TYPE_RESOURCE_LEVELS: Record<MultiTaskType, 'low' | 'medium' | 'high'> = {
  requirement: 'low',
  architecture: 'medium',
  implementation: 'high',
  testing: 'medium',
  review: 'medium',
  documentation: 'low',
  refactor: 'high',
  deployment: 'medium',
};

/**
 * 任务状态
 */
export type MultiTaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 冲突解决策略
 */
export type ConflictPolicy = 'detect' | 'queue' | 'allow';

/**
 * 任务错误
 */
export interface MultiTaskError {
  code: string;
  message: string;
  stack?: string;
  timestamp: number;
}

/**
 * 多任务对象
 */
export interface MultiTask {
  id: string;
  name: string;
  type: MultiTaskType;
  description: string;
  status: MultiTaskStatus;
  priority: number; // 0-9, 9 最高
  dependsOn: string[];
  blockedBy: string[];
  progress: number; // 0-100
  currentStep?: string;
  totalSteps: number;
  completedSteps: number;
  startedAt?: number;
  finishedAt?: number;
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  costSoFar: number;
  tokensConsumed: { input: number; output: number };
  model: string;
  worktreeId?: string;
  branch?: string;
  files: string[];
  result?: string;
  error?: MultiTaskError;
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 编排配置
 */
export interface MultiTaskConfig {
  maxConcurrent: number;
  maxRetries: number;
  totalBudget: number;
  perTaskBudget: number;
  conflictPolicy: ConflictPolicy;
  autoStart: boolean;
  worktreeIsolation: boolean;
  defaultModel: string;
}

/**
 * 编排统计
 */
export interface OrchestrationStats {
  totalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  pausedTasks: number;
  cancelledTasks: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  averageDurationMs: number;
  concurrency: number;
  conflictCount: number;
  budgetUsage: number; // 0-1
}

/**
 * 任务过滤器
 */
export interface MultiTaskFilter {
  status?: MultiTaskStatus | MultiTaskStatus[];
  type?: MultiTaskType | MultiTaskType[];
  priority?: { min?: number; max?: number };
  name?: string;
}

/**
 * 冲突信息
 */
export interface TaskConflict {
  taskA: string;
  taskB: string;
  files: string[];
  detectedAt: number;
}

/**
 * 事件类型
 */
export type OrchestratorEventType =
  | 'task-created'
  | 'task-started'
  | 'task-progress'
  | 'task-paused'
  | 'task-resumed'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-retried'
  | 'conflict-detected'
  | 'budget-exceeded'
  | 'config-updated'
  | 'engine-reset';

export type OrchestratorEventHandler = (payload: any) => void;

/**
 * 默认配置
 */
export const DEFAULT_MULTI_TASK_CONFIG: MultiTaskConfig = {
  maxConcurrent: 5,
  maxRetries: 2,
  totalBudget: 10,
  perTaskBudget: 2,
  conflictPolicy: 'detect',
  autoStart: true,
  worktreeIsolation: true,
  defaultModel: 'claude-sonnet-4-5',
};

// ============ 事件总线 ============

export class OrchestratorEventBus {
  private listeners: Map<OrchestratorEventType, Set<OrchestratorEventHandler>> = new Map();

  on(type: OrchestratorEventType, handler: OrchestratorEventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(type: OrchestratorEventType, payload: any): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // swallow
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(type?: OrchestratorEventType): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

// ============ 内存存储 ============

export interface OrchestratorStorage {
  save(tasks: MultiTask[]): void;
  load(): MultiTask[];
  clear(): void;
}

export class InMemoryStorage implements OrchestratorStorage {
  private store: MultiTask[] = [];

  save(tasks: MultiTask[]): void {
    this.store = tasks.map((t) => ({ ...t }));
  }

  load(): MultiTask[] {
    return this.store.map((t) => ({ ...t }));
  }

  clear(): void {
    this.store = [];
  }
}

export class LocalStorageOrchestratorStorage implements OrchestratorStorage {
  private readonly key: string;

  constructor(key: string = 'multiTaskOrchestrator:v1') {
    this.key = key;
  }

  save(tasks: MultiTask[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.key, JSON.stringify(tasks));
    } catch {
      // ignore
    }
  }

  load(): MultiTask[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
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

// ============ 引擎主体 ============

/**
 * 创建任务的输入
 */
export type CreateMultiTaskInput = Omit<
  MultiTask,
  | 'id'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'progress'
  | 'costSoFar'
  | 'tokensConsumed'
  | 'completedSteps'
  | 'retryCount'
  | 'blockedBy'
>;

export class MultiTaskOrchestrator {
  private tasks: Map<string, MultiTask> = new Map();
  private config: MultiTaskConfig;
  private storage: OrchestratorStorage;
  private eventBus: OrchestratorEventBus = new OrchestratorEventBus();
  private fileReservations: Map<string, string> = new Map(); // file -> taskId
  private conflicts: TaskConflict[] = [];
  private idCounter = 0;

  constructor(config?: Partial<MultiTaskConfig>, storage?: OrchestratorStorage) {
    this.config = { ...DEFAULT_MULTI_TASK_CONFIG, ...(config || {}) };
    this.storage = storage || new InMemoryStorage();
    this.loadFromStorage();
  }

  // ============== ID 生成 ==============

  private generateId(): string {
    this.idCounter += 1;
    return `mt-${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }

  // ============== 持久化 ==============

  private loadFromStorage(): void {
    const loaded = this.storage.load();
    for (const t of loaded) {
      this.tasks.set(t.id, t);
    }
  }

  private persist(): void {
    this.storage.save(Array.from(this.tasks.values()));
  }

  // ============== 配置管理 ==============

  getConfig(): MultiTaskConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<MultiTaskConfig>): void {
    this.config = { ...this.config, ...patch };
    this.eventBus.emit('config-updated', { config: this.config });
    this.persist();
  }

  // ============== 任务 CRUD ==============

  /**
   * 创建任务
   */
  createTask(input: CreateMultiTaskInput): MultiTask {
    const now = Date.now();
    const task: MultiTask = {
      ...input,
      id: this.generateId(),
      status: 'pending',
      progress: 0,
      costSoFar: 0,
      tokensConsumed: { input: 0, output: 0 },
      completedSteps: 0,
      retryCount: 0,
      blockedBy: [],
      maxRetries: input.maxRetries ?? this.config.maxRetries,
      model: input.model || this.config.defaultModel,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.eventBus.emit('task-created', { task });
    this.persist();

    if (this.config.autoStart) {
      this.tryStartTask(task.id);
    }

    return task;
  }

  /**
   * 批量创建任务
   */
  createBatch(inputs: CreateMultiTaskInput[]): MultiTask[] {
    const created: MultiTask[] = [];
    for (const input of inputs) {
      created.push(this.createTask(input));
    }
    return created;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): MultiTask | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 列出任务
   */
  listTasks(filter?: MultiTaskFilter): MultiTask[] {
    let result = Array.from(this.tasks.values());
    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        result = result.filter((t) => statuses.includes(t.status));
      }
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        result = result.filter((t) => types.includes(t.type));
      }
      if (filter.priority) {
        if (filter.priority.min !== undefined) {
          result = result.filter((t) => t.priority >= filter.priority!.min!);
        }
        if (filter.priority.max !== undefined) {
          result = result.filter((t) => t.priority <= filter.priority!.max!);
        }
      }
      if (filter.name) {
        const kw = filter.name.toLowerCase();
        result = result.filter((t) => t.name.toLowerCase().includes(kw));
      }
    }
    return result.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * 获取可立即开始的任务（无依赖或依赖已完成）
   */
  getReadyTasks(): MultiTask[] {
    const completed = new Set(
      this.listTasks({ status: 'completed' }).map((t) => t.id)
    );
    return this.listTasks({ status: 'pending' }).filter((task) => {
      return task.dependsOn.every((dep) => completed.has(dep));
    });
  }

  /**
   * 获取正在运行的任务
   */
  getRunningTasks(): MultiTask[] {
    return this.listTasks({ status: 'running' });
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    this.tasks.delete(taskId);
    this.releaseFiles(taskId);
    // 从其他任务的依赖中移除
    for (const t of this.tasks.values()) {
      if (t.dependsOn.includes(taskId)) {
        t.dependsOn = t.dependsOn.filter((d) => d !== taskId);
        t.updatedAt = Date.now();
      }
    }
    this.persist();
    return true;
  }

  // ============== 执行控制 ==============

  /**
   * 尝试启动任务
   */
  tryStartTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'pending') return false;

    // 检查并发数
    const running = this.getRunningTasks();
    if (running.length >= this.config.maxConcurrent) {
      return false;
    }

    // 检查依赖
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }

    // 检查预算
    if (this.isOverBudget()) {
      this.eventBus.emit('budget-exceeded', { taskId });
      return false;
    }

    // 检查文件冲突
    if (this.config.conflictPolicy === 'detect') {
      const conflicts = this.findTaskConflicts(task);
      if (conflicts.length > 0) {
        return false;
      }
    } else if (this.config.conflictPolicy === 'queue') {
      const occupied = task.files.some((f) => this.fileReservations.has(f));
      if (occupied) return false;
    }

    // 预留文件
    if (this.config.conflictPolicy !== 'allow') {
      for (const f of task.files) {
        this.fileReservations.set(f, task.id);
      }
    }

    task.status = 'running';
    task.startedAt = Date.now();
    task.updatedAt = Date.now();
    this.eventBus.emit('task-started', { task });
    this.persist();
    return true;
  }

  /**
   * 启动任务（如果失败不报错）
   */
  start(taskId: string): boolean {
    return this.tryStartTask(taskId);
  }

  /**
   * 批量启动（持续尝试直到没有新任务可启动）
   */
  startBatch(taskIds?: string[]): number {
    let started = 0;
    if (taskIds) {
      for (const id of taskIds) {
        if (this.tryStartTask(id)) started += 1;
      }
    } else {
      // 尝试启动所有 ready 任务
      let changed = true;
      while (changed) {
        changed = false;
        const ready = this.getReadyTasks();
        for (const task of ready) {
          if (this.tryStartTask(task.id)) {
            started += 1;
            changed = true;
          }
        }
      }
    }
    return started;
  }

  /**
   * 暂停任务
   */
  pause(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;
    task.status = 'paused';
    task.updatedAt = Date.now();
    this.eventBus.emit('task-paused', { task });
    this.persist();
    return true;
  }

  /**
   * 恢复任务
   */
  resume(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'paused') return false;
    task.status = 'running';
    task.updatedAt = Date.now();
    this.eventBus.emit('task-resumed', { task });
    this.persist();
    return true;
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'cancelled') return false;
    task.status = 'cancelled';
    task.finishedAt = Date.now();
    task.actualDurationMs = task.startedAt ? task.finishedAt - task.startedAt : 0;
    task.updatedAt = Date.now();
    this.releaseFiles(taskId);
    this.eventBus.emit('task-cancelled', { task });
    this.persist();
    return true;
  }

  /**
   * 重试任务
   */
  retry(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'failed' && task.status !== 'cancelled') return false;
    if (task.retryCount >= task.maxRetries) return false;

    task.retryCount += 1;
    task.status = 'pending';
    task.progress = 0;
    task.error = undefined;
    task.currentStep = undefined;
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.actualDurationMs = 0;
    task.updatedAt = Date.now();

    this.eventBus.emit('task-retried', { task });
    this.persist();

    if (this.config.autoStart) {
      return this.tryStartTask(taskId);
    }
    return true;
  }

  // ============== 进度更新 ==============

  /**
   * 更新任务进度
   */
  updateProgress(taskId: string, progress: number, currentStep?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'running') return false;

    const clamped = Math.max(0, Math.min(100, progress));
    task.progress = clamped;
    task.completedSteps = Math.floor((clamped / 100) * task.totalSteps);
    if (currentStep !== undefined) task.currentStep = currentStep;
    task.updatedAt = Date.now();
    this.eventBus.emit('task-progress', { task, progress: clamped, currentStep });
    this.persist();
    return true;
  }

  /**
   * 记录成本
   */
  recordCost(
    taskId: string,
    cost: number,
    tokens: { input: number; output: number }
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.costSoFar += cost;
    task.tokensConsumed.input += tokens.input;
    task.tokensConsumed.output += tokens.output;
    task.updatedAt = Date.now();

    if (this.isOverBudget()) {
      this.eventBus.emit('budget-exceeded', { taskId });
    }
    this.persist();
    return true;
  }

  /**
   * 完成任务
   */
  completeTask(taskId: string, result: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'cancelled') return false;

    task.status = 'completed';
    task.result = result;
    task.progress = 100;
    task.completedSteps = task.totalSteps;
    task.finishedAt = Date.now();
    task.actualDurationMs = task.startedAt ? task.finishedAt - task.startedAt : 0;
    task.updatedAt = Date.now();
    this.releaseFiles(taskId);
    this.eventBus.emit('task-completed', { task });

    // 自动启动等待的依赖任务
    this.startBatch();
    this.persist();
    return true;
  }

  /**
   * 任务失败
   */
  failTask(taskId: string, error: { code: string; message: string; stack?: string }): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'failed';
    task.error = {
      ...error,
      timestamp: Date.now(),
    };
    task.finishedAt = Date.now();
    task.actualDurationMs = task.startedAt ? task.finishedAt - task.startedAt : 0;
    task.updatedAt = Date.now();
    this.releaseFiles(taskId);
    this.eventBus.emit('task-failed', { task, error: task.error });
    this.persist();
    return true;
  }

  // ============== 依赖管理 ==============

  /**
   * 拓扑排序（Kahn 算法）
   */
  resolveDependencies(tasks?: MultiTask[]): MultiTask[] {
    const allTasks = tasks || Array.from(this.tasks.values());
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const t of allTasks) {
      inDegree.set(t.id, t.dependsOn.filter((d) => taskMap.has(d)).length);
      if (!adjacency.has(t.id)) adjacency.set(t.id, []);
      for (const dep of t.dependsOn) {
        if (!adjacency.has(dep)) adjacency.set(dep, []);
        adjacency.get(dep)!.push(t.id);
      }
    }

    const queue: MultiTask[] = [];
    for (const t of allTasks) {
      if ((inDegree.get(t.id) || 0) === 0) queue.push(t);
    }

    queue.sort((a, b) => b.priority - a.priority);

    const sorted: MultiTask[] = [];
    while (queue.length > 0) {
      const task = queue.shift()!;
      sorted.push(task);
      for (const nextId of adjacency.get(task.id) || []) {
        const next = (inDegree.get(nextId) || 0) - 1;
        inDegree.set(nextId, next);
        if (next === 0) {
          const nextTask = taskMap.get(nextId);
          if (nextTask) queue.push(nextTask);
        }
      }
    }

    return sorted;
  }

  /**
   * 获取依赖此任务的任务
   */
  getDependents(taskId: string): MultiTask[] {
    return Array.from(this.tasks.values()).filter((t) =>
      t.dependsOn.includes(taskId)
    );
  }

  /**
   * 获取此任务依赖的任务
   */
  getDependencies(taskId: string): MultiTask[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    return task.dependsOn
      .map((id) => this.tasks.get(id))
      .filter((t): t is MultiTask => !!t);
  }

  // ============== 冲突检测 ==============

  /**
   * 检测一组任务的冲突
   */
  detectConflicts(tasks: MultiTask[]): TaskConflict[] {
    const conflicts: TaskConflict[] = [];
    for (let i = 0; i < tasks.length; i += 1) {
      for (let j = i + 1; j < tasks.length; j += 1) {
        const a = tasks[i];
        const b = tasks[j];
        const overlap = a.files.filter((f) => b.files.includes(f));
        if (overlap.length > 0) {
          conflicts.push({
            taskA: a.id,
            taskB: b.id,
            files: overlap,
            detectedAt: Date.now(),
          });
        }
      }
    }
    return conflicts;
  }

  /**
   * 查找指定任务与现有运行任务的冲突
   */
  private findTaskConflicts(task: MultiTask): TaskConflict[] {
    const running = this.getRunningTasks();
    const conflicts: TaskConflict[] = [];
    for (const other of running) {
      if (other.id === task.id) continue;
      const overlap = task.files.filter((f) => other.files.includes(f));
      if (overlap.length > 0) {
        conflicts.push({
          taskA: task.id,
          taskB: other.id,
          files: overlap,
          detectedAt: Date.now(),
        });
        this.eventBus.emit('conflict-detected', { conflict: conflicts[conflicts.length - 1] });
      }
    }
    if (conflicts.length > 0) {
      this.conflicts.push(...conflicts);
    }
    return conflicts;
  }

  /**
   * 预留文件
   */
  reserveFiles(taskId: string, files: string[]): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    for (const f of files) {
      if (this.fileReservations.has(f) && this.fileReservations.get(f) !== taskId) {
        return false;
      }
    }
    for (const f of files) {
      this.fileReservations.set(f, taskId);
    }
    task.files = Array.from(new Set([...task.files, ...files]));
    this.persist();
    return true;
  }

  /**
   * 释放文件
   */
  releaseFiles(taskId: string): void {
    for (const [file, owner] of this.fileReservations.entries()) {
      if (owner === taskId) this.fileReservations.delete(file);
    }
  }

  /**
   * 获取冲突列表
   */
  getConflicts(): TaskConflict[] {
    return [...this.conflicts];
  }

  /**
   * 清除冲突记录
   */
  clearConflicts(): void {
    this.conflicts = [];
  }

  // ============== 预算控制 ==============

  getRemainingBudget(): number {
    return Math.max(0, this.config.totalBudget - this.getTotalCost());
  }

  getTotalCost(): number {
    return Array.from(this.tasks.values()).reduce((sum, t) => sum + t.costSoFar, 0);
  }

  isOverBudget(): boolean {
    return this.getTotalCost() >= this.config.totalBudget;
  }

  /**
   * 检查单任务是否超出预算
   */
  isTaskOverBudget(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return task.costSoFar >= this.config.perTaskBudget;
  }

  // ============== 统计 ==============

  getStats(): OrchestrationStats {
    const all = Array.from(this.tasks.values());
    const completed = all.filter((t) => t.status === 'completed');
    const totalDuration = completed.reduce(
      (sum, t) => sum + (t.actualDurationMs || 0),
      0
    );
    const totalInput = all.reduce((s, t) => s + t.tokensConsumed.input, 0);
    const totalOutput = all.reduce((s, t) => s + t.tokensConsumed.output, 0);
    const totalCost = all.reduce((s, t) => s + t.costSoFar, 0);

    return {
      totalTasks: all.length,
      runningTasks: all.filter((t) => t.status === 'running').length,
      completedTasks: completed.length,
      failedTasks: all.filter((t) => t.status === 'failed').length,
      pendingTasks: all.filter((t) => t.status === 'pending').length,
      pausedTasks: all.filter((t) => t.status === 'paused').length,
      cancelledTasks: all.filter((t) => t.status === 'cancelled').length,
      totalCost,
      totalTokens: { input: totalInput, output: totalOutput },
      averageDurationMs: completed.length > 0 ? totalDuration / completed.length : 0,
      concurrency: all.filter((t) => t.status === 'running').length,
      conflictCount: this.conflicts.length,
      budgetUsage: this.config.totalBudget > 0 ? totalCost / this.config.totalBudget : 0,
    };
  }

  // ============== 事件 ==============

  on(type: OrchestratorEventType, handler: OrchestratorEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  // ============== 重置 / 清理 ==============

  /**
   * 重置引擎（清空所有任务）
   */
  reset(): void {
    this.tasks.clear();
    this.conflicts = [];
    this.fileReservations.clear();
    this.idCounter = 0;
    this.eventBus.emit('engine-reset', {});
    this.storage.clear();
    this.persist();
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.eventBus.clear();
    this.reset();
  }
}

// ============ 单例 ============

let _instance: MultiTaskOrchestrator | null = null;

export function getMultiTaskOrchestrator(
  config?: Partial<MultiTaskConfig>,
  storage?: OrchestratorStorage
): MultiTaskOrchestrator {
  if (!_instance) {
    _instance = new MultiTaskOrchestrator(config, storage);
  }
  return _instance;
}

export function resetMultiTaskOrchestrator(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
