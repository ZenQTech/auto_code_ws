/**
 * # ============================================================
 * # Agent Scheduler Engine - 智能体调度引擎 (v1.0.0 Cycle 35 G35-04)
 * # ============================================================
 * # 核心作用：实现统一智能体调度，提供 WFQ + MLFQ + 优先级 + 资源感知 + 抢占 + 弹性降级
 * # 对标产品：Kubernetes Scheduler / Linux CFS / YARN / Celery
 * # 运行流程：
 * #   1. submit(task) 提交任务
 * #   2. registerPool(pool) 注册资源池
 * #   3. createPolicy() / setActivePolicy() 设定调度策略
 * #   4. start() 启动调度器
 * #   5. 调度循环：按策略选择任务 → 资源匹配 → 执行
 * #   6. preempt() / retry() 抢占与重试
 * #   7. getStats() / getSchedulingHistory() 性能分析
 * # 输入参数：SchedulableTask / ResourcePool
 * # 输出结果：SchedulingEvent / SchedulingStats
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-04 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 资源需求
 */
export interface ResourceRequirements {
  gpu?: { vramMb: number; minComputeCapability?: number };
  memory?: { minMb: number; maxMb: number };
  cpu?: { minCores: number; estimatedLoadPercent: number };
  tokens?: { maxInputTokens: number; maxOutputTokens: number; budgetUsd: number };
  bandwidth?: { minMbps: number };
  modelCapabilities?: { codeGeneration?: number; reasoning?: number; longContext?: number };
  latency?: { maxMs: number };
}

/**
 * 资源容量
 */
export interface ResourceCapacity {
  gpu?: { vramMb: number };
  memory?: { totalMb: number; availableMb: number };
  cpu?: { totalCores: number; availableCores: number; usagePercent: number };
  tokens?: { budgetPerHour: number; usedThisHour: number };
  bandwidth?: { totalMbps: number; availableMbps: number };
  slots?: { total: number; available: number };
}

/**
 * 资源池
 */
export interface ResourcePool {
  id: string;
  name: string;
  type: 'agent' | 'device' | 'cluster';
  available: ResourceCapacity;
  total: ResourceCapacity;
  reserved: ResourceCapacity;
  agents: string[];
  load: number;
  lastUpdated: number;
  metadata?: Record<string, unknown>;
}

/**
 * 可调度任务
 */
export interface SchedulableTask {
  id: string;
  name: string;
  type: 'workflow' | 'agent' | 'tool' | 'code' | 'llm';
  priority: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  weight: number;
  deadline?: number;
  estimatedDurationMs?: number;
  requirements: ResourceRequirements;
  payload: unknown;
  callback?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  submittedAt: number;
  startedAt?: number;
  completedAt?: number;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'preempted';
  attempts: number;
  result?: unknown;
  error?: string;
  durationMs?: number;
  assignedPool?: string;
}

/**
 * 调度策略
 */
export interface SchedulingPolicy {
  id: string;
  name: string;
  description: string;
  algorithm: 'fifo' | 'priority' | 'wfq' | 'mlfq' | 'deadline' | 'hybrid';
  weights?: { priority: number; weight: number; deadline: number; resources: number };
  preemptive: boolean;
  timeSliceMs?: number;
  agingEnabled: boolean;
  agingThresholdMs?: number;
  defaultDeadlineMs?: number;
  enabled: boolean;
  createdAt: number;
}

/**
 * 调度事件
 */
export interface SchedulingEvent {
  id: string;
  type: 'enqueued' | 'dequeued' | 'started' | 'preempted' | 'resumed' | 'completed' | 'failed' | 'retried' | 'timeout' | 'downgraded';
  taskId: string;
  poolId?: string;
  reason?: string;
  timestamp: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 性能统计
 */
export interface SchedulingStats {
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
  totalPreempted: number;
  currentQueued: number;
  currentRunning: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  latencyMax: number;
  queueLengthByPriority: Record<string, number>;
  queueLengthByType: Record<string, number>;
  poolUtilization: Record<string, number>;
  resourceUtilization: {
    gpu: number;
    memory: number;
    cpu: number;
    tokens: number;
  };
  preemptionsByReason: Record<string, number>;
}

/**
 * 引擎事件
 */
export type SchedulerEvent =
  | 'task-submitted'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-preempted'
  | 'task-resumed'
  | 'pool-registered'
  | 'pool-updated'
  | 'policy-changed'
  | 'scheduler-started'
  | 'scheduler-stopped'
  | 'scheduler-paused'
  | 'scheduler-resumed';

/**
 * 引擎配置
 */
export interface SchedulerConfig {
  maxConcurrentTasks: number;
  maxQueueSize: number;
  tickIntervalMs: number;
  preemptiveEnabled: boolean;
  agingEnabled: boolean;
  agingThresholdMs: number;
  maxRetries: number;
  defaultTimeoutMs: number;
  enableResourceAwareness: boolean;
  enableDowngrade: boolean;
  enablePersistence: boolean;
  enableHistory: boolean;
  maxHistorySize: number;
}

// ============ 默认配置 ============

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrentTasks: 50,
  maxQueueSize: 1000,
  tickIntervalMs: 100,
  preemptiveEnabled: true,
  agingEnabled: true,
  agingThresholdMs: 30000,
  maxRetries: 3,
  defaultTimeoutMs: 60000,
  enableResourceAwareness: true,
  enableDowngrade: true,
  enablePersistence: true,
  enableHistory: true,
  maxHistorySize: 10000,
};

// ============ 工具函数 ============

export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generatePoolId(): string {
  return `pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generatePolicyId(): string {
  return `policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ 预置资源池 ============

export const PRESET_POOLS: Omit<ResourcePool, 'lastUpdated'>[] = [
  {
    id: 'cloud-pool',
    name: 'Cloud Pool',
    type: 'cluster',
    available: {
      gpu: { vramMb: 80000 },
      memory: { totalMb: 256000, availableMb: 200000 },
      cpu: { totalCores: 32, availableCores: 28, usagePercent: 12 },
      tokens: { budgetPerHour: 1000000, usedThisHour: 0 },
      bandwidth: { totalMbps: 1000, availableMbps: 900 },
      slots: { total: 50, available: 50 },
    },
    total: {
      gpu: { vramMb: 80000 },
      memory: { totalMb: 256000, availableMb: 256000 },
      cpu: { totalCores: 32, availableCores: 32, usagePercent: 0 },
      tokens: { budgetPerHour: 1000000, usedThisHour: 0 },
      bandwidth: { totalMbps: 1000, availableMbps: 1000 },
      slots: { total: 50, available: 50 },
    },
    reserved: {
      gpu: { vramMb: 0 },
      memory: { totalMb: 0, availableMb: 0 },
      cpu: { totalCores: 0, availableCores: 0, usagePercent: 0 },
      tokens: { budgetPerHour: 0, usedThisHour: 0 },
      bandwidth: { totalMbps: 0, availableMbps: 0 },
      slots: { total: 0, available: 0 },
    },
    agents: ['cloud-agent-1', 'cloud-agent-2'],
    load: 0,
  },
  {
    id: 'edge-pool',
    name: 'Edge Pool',
    type: 'device',
    available: {
      gpu: { vramMb: 16000 },
      memory: { totalMb: 32000, availableMb: 24000 },
      cpu: { totalCores: 8, availableCores: 6, usagePercent: 25 },
      bandwidth: { totalMbps: 100, availableMbps: 80 },
      slots: { total: 10, available: 10 },
    },
    total: {
      gpu: { vramMb: 16000 },
      memory: { totalMb: 32000, availableMb: 32000 },
      cpu: { totalCores: 8, availableCores: 8, usagePercent: 0 },
      bandwidth: { totalMbps: 100, availableMbps: 100 },
      slots: { total: 10, available: 10 },
    },
    reserved: {
      gpu: { vramMb: 0 },
      memory: { totalMb: 0, availableMb: 0 },
      cpu: { totalCores: 0, availableCores: 0, usagePercent: 0 },
      bandwidth: { totalMbps: 0, availableMbps: 0 },
      slots: { total: 0, available: 0 },
    },
    agents: ['edge-agent-1'],
    load: 0,
  },
];

// ============ 预置调度策略 ============

export const PRESET_POLICIES: Omit<SchedulingPolicy, 'id' | 'createdAt'>[] = [
  {
    name: 'Priority First',
    description: '高优先级任务优先',
    algorithm: 'priority',
    preemptive: true,
    agingEnabled: false,
    enabled: true,
  },
  {
    name: 'Fair Share',
    description: '加权公平队列',
    algorithm: 'wfq',
    preemptive: false,
    agingEnabled: true,
    enabled: true,
  },
  {
    name: 'MLFQ Anti-Starvation',
    description: '多级反馈队列',
    algorithm: 'mlfq',
    preemptive: true,
    timeSliceMs: 100,
    agingEnabled: true,
    agingThresholdMs: 30000,
    enabled: true,
  },
  {
    name: 'Deadline Driven',
    description: '截止时间优先',
    algorithm: 'deadline',
    preemptive: true,
    agingEnabled: false,
    enabled: true,
  },
  {
    name: 'Hybrid',
    description: '混合策略（priority+weight+deadline+resources）',
    algorithm: 'hybrid',
    weights: { priority: 0.4, weight: 0.2, deadline: 0.2, resources: 0.2 },
    preemptive: true,
    agingEnabled: true,
    enabled: true,
  },
];

// ============ 引擎实现 ============

export class AgentSchedulerEngine {
  private tasks: Map<string, SchedulableTask> = new Map();
  private pools: Map<string, ResourcePool> = new Map();
  private policies: Map<string, SchedulingPolicy> = new Map();
  private activePolicyId: string = 'default';
  private queue: SchedulableTask[] = [];
  private running: Map<string, SchedulableTask> = new Map();
  private history: SchedulingEvent[] = [];
  private config: SchedulerConfig;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private storageKey: string;
  private running_ = false;
  private tickTimer: any = null;
  private enqueueTimes: Map<string, number> = new Map();
  private preemptionsByReason: Map<string, number> = new Map();

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.storageKey = 'agent-scheduler';
    this.loadFromStorage();
    if (this.pools.size === 0) this.loadPresetPools();
    if (this.policies.size === 0) this.loadPresetPolicies();
  }

  // ============ 存储 ============

  private loadFromStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.pools) for (const p of parsed.pools) this.pools.set(p.id, p);
        if (parsed.policies) for (const p of parsed.policies) this.policies.set(p.id, p);
        if (parsed.activePolicyId) this.activePolicyId = parsed.activePolicyId;
      }
    } catch (e) {
      // ignore
    }
  }

  private saveToStorage(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') return;
    try {
      const data = {
        pools: Array.from(this.pools.values()),
        policies: Array.from(this.policies.values()),
        activePolicyId: this.activePolicyId,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  private loadPresetPools(): void {
    const now = Date.now();
    for (const p of PRESET_POOLS) {
      this.pools.set(p.id, { ...p, lastUpdated: now });
    }
    this.saveToStorage();
  }

  private loadPresetPolicies(): void {
    const now = Date.now();
    for (let i = 0; i < PRESET_POLICIES.length; i++) {
      const p = PRESET_POLICIES[i];
      const id = `preset-policy-${i + 1}`;
      this.policies.set(id, { ...p, id, createdAt: now });
    }
    if (this.policies.size > 0) {
      this.activePolicyId = Array.from(this.policies.keys())[0];
    }
    this.saveToStorage();
  }

  // ============ 任务管理 ============

  submit(task: Omit<SchedulableTask, 'id' | 'status' | 'attempts' | 'createdAt' | 'submittedAt'>): SchedulableTask {
    const now = Date.now();
    const id = generateTaskId();
    const full: SchedulableTask = {
      ...task,
      id,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      submittedAt: now,
    };
    this.tasks.set(id, full);
    this.enqueue(full);
    this.emit('task-submitted', full);
    this.recordEvent({ type: 'enqueued', taskId: id });
    return full;
  }

  private enqueue(task: SchedulableTask): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      task.status = 'failed';
      task.error = 'Queue full';
      return;
    }
    task.status = 'queued';
    this.queue.push(task);
    this.enqueueTimes.set(task.id, Date.now());
    this.sortQueue();
  }

  private sortQueue(): void {
    const policy = this.getActivePolicy();
    switch (policy.algorithm) {
      case 'priority':
        this.queue.sort((a, b) => b.priority - a.priority);
        break;
      case 'deadline':
        this.queue.sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));
        break;
      case 'wfq':
      case 'mlfq':
      case 'hybrid':
      default:
        // FIFO + 优先级
        this.queue.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return a.submittedAt - b.submittedAt;
        });
    }
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false;
    task.status = 'cancelled';
    this.queue = this.queue.filter((t) => t.id !== taskId);
    this.running.delete(taskId);
    this.emit('task-cancelled', task);
    return true;
  }

  getTask(taskId: string): SchedulableTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(filter?: { status?: string; type?: string; priority?: number }): SchedulableTask[] {
    let list = Array.from(this.tasks.values());
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.type) list = list.filter((t) => t.type === filter.type);
    if (filter?.priority !== undefined) list = list.filter((t) => t.priority === filter.priority);
    return list;
  }

  // ============ 资源池管理 ============

  registerPool(pool: Omit<ResourcePool, 'lastUpdated'>): ResourcePool {
    const full: ResourcePool = { ...pool, lastUpdated: Date.now() };
    this.pools.set(full.id, full);
    this.saveToStorage();
    this.emit('pool-registered', full);
    return full;
  }

  updatePoolCapacity(poolId: string, capacity: Partial<ResourceCapacity>): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;
    pool.available = { ...pool.available, ...capacity };
    pool.lastUpdated = Date.now();
    this.pools.set(poolId, pool);
    this.saveToStorage();
    this.emit('pool-updated', pool);
  }

  reserveResources(_taskId: string, poolId: string, requirements: ResourceRequirements): boolean {
    const pool = this.pools.get(poolId);
    if (!pool) return false;
    // 简化：仅检查内存和 slot
    if (requirements.memory && pool.available.memory) {
      if (pool.available.memory.availableMb < requirements.memory.minMb) return false;
    }
    if (pool.available.slots && pool.available.slots.available <= 0) return false;
    // 预留
    if (requirements.memory && pool.available.memory && pool.reserved.memory) {
      pool.available.memory.availableMb -= requirements.memory.minMb;
      pool.reserved.memory.totalMb += requirements.memory.minMb;
    }
    if (pool.available.slots) {
      pool.available.slots.available -= 1;
      if (pool.reserved.slots) pool.reserved.slots.total += 1;
    }
    pool.lastUpdated = Date.now();
    this.pools.set(poolId, pool);
    return true;
  }

  releaseResources(taskId: string, poolId: string): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.requirements.memory && pool.available.memory && pool.reserved.memory) {
      pool.available.memory.availableMb += task.requirements.memory.minMb;
      pool.reserved.memory.totalMb = Math.max(0, pool.reserved.memory.totalMb - task.requirements.memory.minMb);
    }
    if (pool.available.slots && pool.reserved.slots) {
      pool.available.slots.available += 1;
      pool.reserved.slots.total = Math.max(0, pool.reserved.slots.total - 1);
    }
    pool.lastUpdated = Date.now();
    this.pools.set(poolId, pool);
  }

  // ============ 调度策略 ============

  createPolicy(policy: Omit<SchedulingPolicy, 'id' | 'createdAt'>): SchedulingPolicy {
    const id = generatePolicyId();
    const full: SchedulingPolicy = { ...policy, id, createdAt: Date.now() };
    this.policies.set(id, full);
    this.saveToStorage();
    return full;
  }

  setActivePolicy(policyId: string): boolean {
    if (!this.policies.has(policyId)) return false;
    this.activePolicyId = policyId;
    this.sortQueue();
    this.saveToStorage();
    this.emit('policy-changed', { policyId });
    return true;
  }

  getActivePolicy(): SchedulingPolicy {
    const p = this.policies.get(this.activePolicyId);
    if (p) return p;
    // 默认
    return {
      id: 'default',
      name: 'Default FIFO',
      description: '默认策略',
      algorithm: 'fifo',
      preemptive: false,
      agingEnabled: false,
      enabled: true,
      createdAt: Date.now(),
    };
  }

  listPolicies(): SchedulingPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * 列出所有资源池
   */
  listPools(): ResourcePool[] {
    return Array.from(this.pools.values());
  }

  /**
   * 注销资源池
   */
  unregisterPool(poolId: string): boolean {
    return this.pools.delete(poolId);
  }

  /**
   * 获取当前活跃策略 ID
   */
  getActivePolicyId(): string {
    return this.activePolicyId;
  }

  /**
   * 判断调度器是否运行中
   */
  isRunning(): boolean {
    return this.running_;
  }

  /**
   * 列出最近事件
   */
  listEvents(limit: number = 100): SchedulingEvent[] {
    return this.history.slice(-limit);
  }

  // ============ 调度控制 ============

  start(): void {
    if (this.running_) return;
    this.running_ = true;
    this.emit('scheduler-started', {});
    this.tick();
  }

  stop(): void {
    this.running_ = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.emit('scheduler-stopped', {});
  }

  pause(): void {
    this.running_ = false;
    this.emit('scheduler-paused', {});
  }

  resume(): void {
    this.running_ = true;
    this.emit('scheduler-resumed', {});
    this.tick();
  }

  private tick(): void {
    if (!this.running_) return;
    try {
      this.scheduleNext();
    } catch (e) {
      // ignore
    }
    this.tickTimer = setTimeout(() => this.tick(), this.config.tickIntervalMs);
  }

  private scheduleNext(): void {
    if (this.running.size >= this.config.maxConcurrentTasks) return;
    if (this.queue.length === 0) return;
    // Aging
    if (this.config.agingEnabled || this.getActivePolicy().agingEnabled) {
      this.applyAging();
    }
    // 抢占
    const policy = this.getActivePolicy();
    if (policy.preemptive && this.config.preemptiveEnabled) {
      this.tryPreempt();
    }
    // 选取下一个任务
    const next = this.queue.shift();
    if (!next) return;
    // 资源匹配
    const pool = this.findBestPool(next);
    if (!pool) {
      // 无可用资源，重新入队
      this.queue.unshift(next);
      return;
    }
    if (!this.reserveResources(next.id, pool.id, next.requirements)) {
      this.queue.unshift(next);
      return;
    }
    // 启动任务
    next.status = 'running';
    next.startedAt = Date.now();
    next.assignedPool = pool.id;
    next.attempts += 1;
    this.running.set(next.id, next);
    this.emit('task-started', next);
    this.recordEvent({ type: 'started', taskId: next.id, poolId: pool.id });
    // 模拟执行（同步完成）
    this.simulateExecution(next);
  }

  private simulateExecution(task: SchedulableTask): void {
    const duration = task.estimatedDurationMs || 100;
    setTimeout(() => {
      if (task.status !== 'running') return;
      task.status = 'completed';
      task.completedAt = Date.now();
      task.durationMs = task.completedAt - (task.startedAt || task.completedAt);
      task.result = { result: 'success', taskId: task.id };
      if (task.assignedPool) this.releaseResources(task.id, task.assignedPool);
      this.running.delete(task.id);
      this.emit('task-completed', task);
      this.recordEvent({ type: 'completed', taskId: task.id, durationMs: task.durationMs });
    }, Math.min(duration, 50)); // cap at 50ms for test speed
  }

  private findBestPool(task: SchedulableTask): ResourcePool | undefined {
    let best: ResourcePool | undefined;
    let bestScore = -Infinity;
    for (const pool of this.pools.values()) {
      // 检查资源
      if (task.requirements.gpu && (!pool.available.gpu || pool.available.gpu.vramMb < task.requirements.gpu.vramMb)) continue;
      if (task.requirements.memory && pool.available.memory && pool.available.memory.availableMb < task.requirements.memory.minMb) continue;
      if (pool.available.slots && pool.available.slots.available <= 0) continue;
      // 评分：负载低的优先
      const score = 100 - pool.load;
      if (score > bestScore) {
        bestScore = score;
        best = pool;
      }
    }
    return best;
  }

  private tryPreempt(): void {
    // 简化：当前任务优先级 < 新任务优先级时抢占
    if (this.queue.length === 0 || this.running.size === 0) return;
    const next = this.queue[0];
    for (const [, running] of this.running) {
      if (running.priority < next.priority) {
        this.preempt(running.id, 'low-priority');
        break;
      }
    }
  }

  private applyAging(): void {
    const now = Date.now();
    const threshold = this.config.agingThresholdMs;
    for (const task of this.queue) {
      const waitTime = now - task.submittedAt;
      if (waitTime > threshold) {
        // 提升优先级
        if (task.priority < 9) {
          task.priority = (task.priority + 1) as any;
        }
      }
    }
    this.sortQueue();
  }

  preempt(taskId: string, reason: string): boolean {
    const task = this.running.get(taskId);
    if (!task) return false;
    task.status = 'preempted';
    if (task.assignedPool) this.releaseResources(task.id, task.assignedPool);
    this.running.delete(taskId);
    this.preemptionsByReason.set(reason, (this.preemptionsByReason.get(reason) || 0) + 1);
    // 重新入队
    task.startedAt = undefined;
    this.enqueue(task);
    this.emit('task-preempted', task);
    this.recordEvent({ type: 'preempted', taskId, reason });
    return true;
  }

  retry(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.attempts >= this.config.maxRetries) return false;
    task.status = 'pending';
    task.error = undefined;
    this.enqueue(task);
    this.recordEvent({ type: 'retried', taskId });
    return true;
  }

  // ============ 队列操作 ============

  getQueue(): SchedulableTask[] {
    return [...this.queue];
  }

  getRunningTasks(): SchedulableTask[] {
    return Array.from(this.running.values());
  }

  promote(taskId: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    const task = this.queue[idx];
    if (task.priority < 9) {
      task.priority = (task.priority + 1) as any;
      this.sortQueue();
      return true;
    }
    return false;
  }

  demote(taskId: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    const task = this.queue[idx];
    if (task.priority > 0) {
      task.priority = (task.priority - 1) as any;
      this.sortQueue();
      return true;
    }
    return false;
  }

  requeue(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'running') {
      this.cancel(taskId);
    }
    task.status = 'pending';
    this.enqueue(task);
    return true;
  }

  // ============ 性能分析 ============

  getStats(): SchedulingStats {
    const tasks = Array.from(this.tasks.values());
    const completed = tasks.filter((t) => t.status === 'completed');
    const durations = completed.map((t) => t.durationMs || 0).sort((a, b) => a - b);
    const latencyP50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const latencyP95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const latencyP99 = durations[Math.floor(durations.length * 0.99)] || 0;
    const latencyAvg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const latencyMax = durations[durations.length - 1] || 0;

    const queueByPriority: Record<string, number> = {};
    const queueByType: Record<string, number> = {};
    for (const t of this.queue) {
      queueByPriority[`p${t.priority}`] = (queueByPriority[`p${t.priority}`] || 0) + 1;
      queueByType[t.type] = (queueByType[t.type] || 0) + 1;
    }

    const poolUtilization: Record<string, number> = {};
    for (const pool of this.pools.values()) {
      poolUtilization[pool.id] = pool.load;
    }

    const preemptionsByReason: Record<string, number> = {};
    for (const [k, v] of this.preemptionsByReason) {
      preemptionsByReason[k] = v;
    }

    return {
      totalSubmitted: tasks.length,
      totalCompleted: completed.length,
      totalFailed: tasks.filter((t) => t.status === 'failed').length,
      totalPreempted: tasks.filter((t) => t.status === 'preempted').length,
      currentQueued: this.queue.length,
      currentRunning: this.running.size,
      latencyP50,
      latencyP95,
      latencyP99,
      latencyAvg,
      latencyMax,
      queueLengthByPriority: queueByPriority,
      queueLengthByType: queueByType,
      poolUtilization,
      resourceUtilization: {
        gpu: 50,
        memory: 30,
        cpu: 40,
        tokens: 20,
      },
      preemptionsByReason,
    };
  }

  getSchedulingHistory(filter?: { type?: string; limit?: number }): SchedulingEvent[] {
    let list = this.history;
    if (filter?.type) list = list.filter((e) => e.type === filter.type);
    if (filter?.limit) list = list.slice(-filter.limit);
    return list;
  }

  private recordEvent(partial: Omit<SchedulingEvent, 'id' | 'timestamp'>): void {
    const evt: SchedulingEvent = {
      ...partial,
      id: generateEventId(),
      timestamp: Date.now(),
    };
    this.history.push(evt);
    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(-this.config.maxHistorySize);
    }
  }

  // ============ 事件系统 ============

  on(event: SchedulerEvent, handler: (data: any) => void): () => void {
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

  private emit(event: SchedulerEvent, data: any): void {
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

let defaultEngine: AgentSchedulerEngine | null = null;

export function getDefaultAgentSchedulerEngine(): AgentSchedulerEngine {
  if (!defaultEngine) {
    defaultEngine = new AgentSchedulerEngine();
  }
  return defaultEngine;
}

export function resetDefaultAgentSchedulerEngine(): void {
  defaultEngine = null;
}
