/**
 * # ============================================================
 * # MultiAgentEngine - 多 Agent 协作引擎 (v1.0.0 Cycle 38 G38-01)
 * # ============================================================
 * # 核心作用：实现 Manager-Worker 模式的多 Agent 协作
 * #           任务分解 / 能力匹配 / 并行执行 / 结果融合
 * # 对标产品：AutoGen GroupChat / LangGraph Supervisor / CrewAI
 * # 运行流程：
 * #   1. 创建 Manager + N 个 Worker Agent
 * #   2. Manager 分解任务为子任务列表
 * #   3. TaskScheduler 按依赖关系调度执行
 * #   4. Worker 并行/串行执行子任务
 * #   5. Manager 融合结果返回
 * # 输入参数：AgentDefinition[] + TaskDefinition[]
 * # 输出结果：CrewResult（含任务执行汇总）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 38 G38-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type AgentRole = 'manager' | 'worker' | 'reviewer' | 'observer';

export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type ExecutionMode = 'sequential' | 'parallel' | 'hybrid';

export type CrewStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentCapability {
  name: string;
  description?: string;
  proficiency: number; // 0-1
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  capabilities: AgentCapability[];
  systemPrompt?: string;
  llmProvider?: string;
  maxConcurrentTasks?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  priority?: TaskPriority;
  dependencies?: string[];
  payload?: Record<string, unknown>;
  deadline?: number;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: unknown;
  error?: string;
  assignedAgentId?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  retryCount?: number;
}

export type MessageType =
  | 'task_assignment'
  | 'task_result'
  | 'status_update'
  | 'request_help'
  | 'broadcast'
  | 'private';

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | 'broadcast';
  type: MessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface CrewResult {
  crewId: string;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  totalDurationMs: number;
  aggregatedOutput: Record<string, unknown>;
  taskResults: TaskResult[];
}

export interface Crew {
  id: string;
  name: string;
  description?: string;
  agents: AgentDefinition[];
  tasks: TaskDefinition[];
  executionMode: ExecutionMode;
  startedAt?: number;
  completedAt?: number;
  status: CrewStatus;
  result?: CrewResult;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  retryableErrors: string[];
}

export interface MultiAgentEngineOptions {
  retryPolicy?: Partial<RetryPolicy>;
  defaultTimeoutMs?: number;
  llmProvider?: (prompt: string, options?: { json?: boolean }) => Promise<string>;
  maxConcurrentTasks?: number;
}

export interface ExecuteOptions {
  timeoutMs?: number;
  onTaskStart?: (task: TaskDefinition, agent: AgentDefinition) => void;
  onTaskComplete?: (task: TaskDefinition, result: TaskResult) => void;
  onMessage?: (message: AgentMessage) => void;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  retryableErrors: ['timeout', 'network', 'rate_limit', 'overloaded'],
};

const DEFAULT_TIMEOUT_MS = 30000;

// ============ 工具函数 ============

export function generateId(prefix: string = 'ma'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 默认 LLM Provider（Mock）：返回 JSON 格式的任务分解结果
 */
export async function defaultLLMProvider(prompt: string, options?: { json?: boolean }): Promise<string> {
  if (options?.json || prompt.includes('JSON')) {
    // 简单 Mock：返回 1-3 个示例任务
    const taskCount = 1 + Math.floor(Math.random() * 3);
    const tasks = Array.from({ length: taskCount }, (_, i) => ({
      id: `subtask-${i + 1}`,
      title: `子任务 ${i + 1}`,
      description: `执行子任务 ${i + 1}（自动生成）`,
      requiredCapabilities: ['general'],
    }));
    return JSON.stringify({ tasks });
  }
  return `Mock response: 收到 prompt (长度 ${prompt.length})`;
}

// ============ MessageBus ============

export class MessageBus {
  private messages: AgentMessage[] = [];
  private subscribers: Map<string, Array<(msg: AgentMessage) => void>> = new Map();
  private maxHistory: number;

  constructor(options?: { maxHistory?: number }) {
    this.maxHistory = options?.maxHistory ?? 1000;
  }

  publish(message: AgentMessage): void {
    this.messages.push(message);
    if (this.messages.length > this.maxHistory) {
      this.messages.shift();
    }

    // 通知订阅者
    if (message.toAgentId === 'broadcast') {
      // 广播：通知所有订阅者
      for (const handlers of this.subscribers.values()) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (err) {
            // 订阅者错误不影响消息总线
            void err;
          }
        }
      }
    } else {
      const handlers = this.subscribers.get(message.toAgentId);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (err) {
            void err;
          }
        }
      }
    }
  }

  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, []);
    }
    this.subscribers.get(agentId)!.push(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.subscribers.get(agentId);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  getHistory(agentId?: string): AgentMessage[] {
    if (!agentId) return [...this.messages];
    return this.messages.filter(
      (m) => m.fromAgentId === agentId || m.toAgentId === agentId || m.toAgentId === 'broadcast',
    );
  }

  clear(): void {
    this.messages = [];
  }

  size(): number {
    return this.messages.length;
  }
}

// ============ TaskScheduler ============

export class TaskScheduler {
  private taskMap: Map<string, TaskDefinition> = new Map();
  private statusMap: Map<string, TaskStatus> = new Map();
  private retryCountMap: Map<string, number> = new Map();

  schedule(tasks: TaskDefinition[]): void {
    for (const task of tasks) {
      this.taskMap.set(task.id, task);
      this.statusMap.set(task.id, 'pending');
      this.retryCountMap.set(task.id, 0);
    }
  }

  getReadyTasks(): TaskDefinition[] {
    const ready: TaskDefinition[] = [];
    for (const [id, task] of this.taskMap.entries()) {
      if (this.statusMap.get(id) !== 'pending') continue;
      if (this.dependenciesSatisfied(task)) {
        ready.push(task);
      }
    }
    // 按优先级排序
    const priorityMap: Record<TaskPriority, number> = {
      urgent: 4,
      high: 3,
      normal: 2,
      low: 1,
    };
    return ready.sort(
      (a, b) => (priorityMap[b.priority || 'normal'] - priorityMap[a.priority || 'normal']),
    );
  }

  private dependenciesSatisfied(task: TaskDefinition): boolean {
    if (!task.dependencies || task.dependencies.length === 0) return true;
    for (const dep of task.dependencies) {
      const status = this.statusMap.get(dep);
      if (status !== 'completed') return false;
    }
    return true;
  }

  markAssigned(taskId: string): void {
    this.statusMap.set(taskId, 'assigned');
  }

  markRunning(taskId: string): void {
    this.statusMap.set(taskId, 'running');
  }

  markCompleted(taskId: string): void {
    this.statusMap.set(taskId, 'completed');
  }

  markFailed(taskId: string, _error: string): void {
    this.statusMap.set(taskId, 'failed');
  }

  canRetry(taskId: string, maxRetries: number): boolean {
    const count = this.retryCountMap.get(taskId) || 0;
    return count < maxRetries;
  }

  incrementRetry(taskId: string): number {
    const count = (this.retryCountMap.get(taskId) || 0) + 1;
    this.retryCountMap.set(taskId, count);
    return count;
  }

  getStatus(taskId: string): TaskStatus | undefined {
    return this.statusMap.get(taskId);
  }

  getAllStatuses(): Record<string, TaskStatus> {
    return Object.fromEntries(this.statusMap);
  }

  getCompletedCount(): number {
    let count = 0;
    for (const status of this.statusMap.values()) {
      if (status === 'completed') count++;
    }
    return count;
  }

  getTotalCount(): number {
    return this.taskMap.size;
  }
}

// ============ WorkerAgent ============

export class WorkerAgent {
  private definition: AgentDefinition;
  private engine: MultiAgentEngine;
  private busy: boolean = false;

  constructor(definition: AgentDefinition, engine: MultiAgentEngine) {
    this.definition = definition;
    this.engine = engine;
  }

  getDefinition(): AgentDefinition {
    return this.definition;
  }

  isBusy(): boolean {
    return this.busy;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  async executeTask(
    task: TaskDefinition,
    context: Record<string, unknown>,
  ): Promise<TaskResult> {
    const startedAt = Date.now();
    this.busy = true;

    try {
      // 构造 prompt
      const prompt = this.buildPrompt(task, context);

      // 调用 LLM（通过 engine）
      const llmProvider = this.engine.getLLMProvider();
      const output = await llmProvider(prompt, { json: false });

      return {
        taskId: task.id,
        status: 'completed',
        output,
        assignedAgentId: this.definition.id,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        retryCount: 0,
      };
    } catch (err) {
      return {
        taskId: task.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        assignedAgentId: this.definition.id,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        retryCount: 0,
      };
    } finally {
      this.busy = false;
    }
  }

  private buildPrompt(task: TaskDefinition, context: Record<string, unknown>): string {
    const parts: string[] = [];
    if (this.definition.systemPrompt) {
      parts.push(`【系统提示】\n${this.definition.systemPrompt}`);
    }
    parts.push(`【任务标题】\n${task.title}`);
    parts.push(`【任务描述】\n${task.description}`);
    if (Object.keys(context).length > 0) {
      parts.push(`【上下文】\n${JSON.stringify(context, null, 2)}`);
    }
    return parts.join('\n\n');
  }
}

// ============ ManagerAgent ============

export class ManagerAgent {
  private definition: AgentDefinition;
  private engine: MultiAgentEngine;

  constructor(definition: AgentDefinition, engine: MultiAgentEngine) {
    this.definition = definition;
    this.engine = engine;
  }

  getDefinition(): AgentDefinition {
    return this.definition;
  }

  /**
   * 任务分解：调用 LLM 将复杂任务分解为子任务列表
   */
  async decomposeTask(
    goal: string,
    _context?: Record<string, unknown>,
  ): Promise<TaskDefinition[]> {
    const llmProvider = this.engine.getLLMProvider();
    const prompt = `你是任务分解专家。请将以下复杂任务分解为多个子任务，输出 JSON 格式：
{
  "tasks": [
    { "id": "t1", "title": "...", "description": "...", "requiredCapabilities": ["..."] }
  ]
}

【目标】
${goal}`;

    const response = await llmProvider(prompt, { json: true });
    return this.parseTaskResponse(response);
  }

  private parseTaskResponse(response: string): TaskDefinition[] {
    try {
      const parsed = JSON.parse(response);
      if (parsed && Array.isArray(parsed.tasks)) {
        return parsed.tasks.map((t: any, idx: number) => ({
          id: t.id || `subtask-${idx + 1}`,
          title: t.title || `子任务 ${idx + 1}`,
          description: t.description || '',
          requiredCapabilities: t.requiredCapabilities || ['general'],
          priority: t.priority || 'normal',
          dependencies: t.dependencies || [],
        }));
      }
    } catch (err) {
      void err;
    }
    // fallback
    return [
      {
        id: 'fallback-1',
        title: '主任务',
        description: response.slice(0, 200),
        requiredCapabilities: ['general'],
        priority: 'normal',
      },
    ];
  }

  /**
   * Worker 选择：根据能力匹配最合适的 Worker
   */
  selectWorker(task: TaskDefinition, workers: WorkerAgent[]): WorkerAgent | null {
    const available = workers.filter((w) => !w.isBusy());
    if (available.length === 0) return null;

    // 计算匹配分数
    let best: WorkerAgent | null = null;
    let bestScore = -1;
    for (const worker of available) {
      const score = this.calculateMatchScore(task, worker.getDefinition());
      if (score > bestScore) {
        bestScore = score;
        best = worker;
      }
    }
    return best;
  }

  private calculateMatchScore(task: TaskDefinition, worker: AgentDefinition): number {
    if (task.requiredCapabilities.length === 0) return 0.5;

    let totalProficiency = 0;
    let matchedCount = 0;
    for (const reqCap of task.requiredCapabilities) {
      const cap = worker.capabilities.find((c) => c.name === reqCap);
      if (cap) {
        totalProficiency += cap.proficiency;
        matchedCount++;
      }
    }

    if (matchedCount === 0) return 0.1; // 无匹配但仍可尝试
    return totalProficiency / task.requiredCapabilities.length;
  }

  /**
   * 结果融合：合并多个 Worker 输出
   */
  async aggregateResults(
    results: TaskResult[],
    _context?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const aggregated: Record<string, unknown> = {};
    for (const result of results) {
      if (result.status === 'completed') {
        aggregated[result.taskId] = result.output;
      } else {
        aggregated[result.taskId] = {
          error: result.error,
          status: result.status,
        };
      }
    }
    return aggregated;
  }

  /**
   * 进度监控
   */
  getProgress(scheduler: TaskScheduler): {
    completed: number;
    total: number;
    percent: number;
  } {
    const completed = scheduler.getCompletedCount();
    const total = scheduler.getTotalCount();
    return {
      completed,
      total,
      percent: total > 0 ? completed / total : 0,
    };
  }
}

// ============ MultiAgentEngine（主类） ============

export class MultiAgentEngine {
  private options: Required<MultiAgentEngineOptions>;
  private agents: Map<string, AgentDefinition> = new Map();
  private workers: Map<string, WorkerAgent> = new Map();
  private manager: ManagerAgent | null = null;
  private crews: Map<string, Crew> = new Map();
  private messageBus: MessageBus = new MessageBus();
  private schedulers: Map<string, TaskScheduler> = new Map();

  constructor(options?: MultiAgentEngineOptions) {
    this.options = {
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...options?.retryPolicy },
      defaultTimeoutMs: options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      llmProvider: options?.llmProvider ?? defaultLLMProvider,
      maxConcurrentTasks: options?.maxConcurrentTasks ?? 5,
    };
  }

  // ============ Agent 管理 ============

  registerAgent(definition: AgentDefinition): void {
    this.agents.set(definition.id, definition);

    if (definition.role === 'manager') {
      this.manager = new ManagerAgent(definition, this);
    } else if (definition.role === 'worker') {
      this.workers.set(definition.id, new WorkerAgent(definition, this));
    }
  }

  unregisterAgent(agentId: string): boolean {
    const removed = this.agents.delete(agentId);
    if (this.manager?.getDefinition().id === agentId) {
      this.manager = null;
    }
    this.workers.delete(agentId);
    return removed;
  }

  listAgents(filter?: { role?: AgentRole }): AgentDefinition[] {
    let result = Array.from(this.agents.values());
    if (filter?.role) {
      result = result.filter((a) => a.role === filter.role);
    }
    return result;
  }

  getAgent(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  // ============ Crew 管理 ============

  createCrew(
    definition: Omit<Crew, 'id' | 'status' | 'startedAt'>,
  ): Crew {
    const crew: Crew = {
      id: generateId('crew'),
      ...definition,
      status: 'idle',
    };
    this.crews.set(crew.id, crew);
    return crew;
  }

  getCrew(crewId: string): Crew | undefined {
    return this.crews.get(crewId);
  }

  listCrews(filter?: { status?: CrewStatus }): Crew[] {
    let result = Array.from(this.crews.values());
    if (filter?.status) {
      result = result.filter((c) => c.status === filter.status);
    }
    return result;
  }

  getTaskResult(crewId: string, taskId: string): TaskResult | undefined {
    const crew = this.crews.get(crewId);
    if (!crew || !crew.result) return undefined;
    return crew.result.taskResults.find((r) => r.taskId === taskId);
  }

  // ============ Crew 执行 ============

  async executeCrew(crewId: string, options?: ExecuteOptions): Promise<CrewResult> {
    const crew = this.crews.get(crewId);
    if (!crew) {
      throw new Error(`Crew not found: ${crewId}`);
    }

    const startTime = Date.now();
    crew.status = 'running';
    crew.startedAt = startTime;

    // 创建调度器
    const scheduler = new TaskScheduler();
    scheduler.schedule(crew.tasks);
    this.schedulers.set(crewId, scheduler);

    const taskResults: TaskResult[] = [];

    try {
      // 根据执行模式调度
      if (crew.executionMode === 'sequential') {
        await this.executeSequential(crew, scheduler, taskResults, options);
      } else if (crew.executionMode === 'parallel') {
        await this.executeParallel(crew, scheduler, taskResults, options);
      } else {
        // hybrid
        await this.executeHybrid(crew, scheduler, taskResults, options);
      }

      // 融合结果
      let aggregated: Record<string, unknown> = {};
      if (this.manager) {
        aggregated = await this.manager.aggregateResults(taskResults);
      } else {
        for (const r of taskResults) {
          aggregated[r.taskId] = r.output;
        }
      }

      const result: CrewResult = {
        crewId,
        totalTasks: crew.tasks.length,
        successfulTasks: taskResults.filter((r) => r.status === 'completed').length,
        failedTasks: taskResults.filter((r) => r.status === 'failed').length,
        totalDurationMs: Date.now() - startTime,
        aggregatedOutput: aggregated,
        taskResults,
      };

      crew.status = result.failedTasks > 0 ? 'failed' : 'completed';
      crew.completedAt = Date.now();
      crew.result = result;

      return result;
    } catch (err) {
      crew.status = 'failed';
      crew.completedAt = Date.now();
      throw err;
    }
  }

  private async executeSequential(
    _crew: Crew,
    scheduler: TaskScheduler,
    taskResults: TaskResult[],
    options?: ExecuteOptions,
  ): Promise<void> {
    while (true) {
      const ready = scheduler.getReadyTasks();
      if (ready.length === 0) break;

      // 串行：每次只执行 1 个
      const task = ready[0];
      scheduler.markRunning(task.id);
      const result = await this.executeSingleTask(task, scheduler, options);
      taskResults.push(result);
    }
  }

  private async executeParallel(
    _crew: Crew,
    scheduler: TaskScheduler,
    taskResults: TaskResult[],
    options?: ExecuteOptions,
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    const maxConcurrent = this.options.maxConcurrentTasks;

    while (true) {
      const ready = scheduler.getReadyTasks();
      if (ready.length === 0) {
        // 等待所有 promise 完成
        await Promise.all(promises);
        if (scheduler.getReadyTasks().length === 0) break;
        continue;
      }

      const toRun = ready.slice(0, maxConcurrent - promises.length);
      for (const task of toRun) {
        scheduler.markRunning(task.id);
        const p = this.executeSingleTask(task, scheduler, options).then((result) => {
          taskResults.push(result);
        });
        promises.push(p);
      }

      // 等待一批完成
      await Promise.all(promises.splice(0, toRun.length));
    }
  }

  private async executeHybrid(
    _crew: Crew,
    scheduler: TaskScheduler,
    taskResults: TaskResult[],
    options?: ExecuteOptions,
  ): Promise<void> {
    // Hybrid：按层执行，每层内并行
    const layers = this.computeLayers(scheduler);

    for (const layer of layers) {
      const promises: Promise<void>[] = [];
      for (const task of layer) {
        scheduler.markRunning(task.id);
        promises.push(
          this.executeSingleTask(task, scheduler, options).then((result) => {
            taskResults.push(result);
          }),
        );
      }
      await Promise.all(promises);
    }
  }

  private computeLayers(scheduler: TaskScheduler): TaskDefinition[][] {
    const layers: TaskDefinition[][] = [];
    const scheduled = new Set<string>();
    const allTasks = Array.from((scheduler as any).taskMap.values()) as TaskDefinition[];

    while (scheduled.size < allTasks.length) {
      const currentLayer: TaskDefinition[] = [];
      for (const task of allTasks) {
        if (scheduled.has(task.id)) continue;
        if (scheduler.getStatus(task.id) !== 'pending') continue;
        const deps = task.dependencies || [];
        if (deps.every((d) => scheduled.has(d))) {
          currentLayer.push(task);
        }
      }
      if (currentLayer.length === 0) break; // 防止死循环
      layers.push(currentLayer);
      for (const t of currentLayer) {
        scheduled.add(t.id);
      }
    }
    return layers;
  }

  private async executeSingleTask(
    task: TaskDefinition,
    scheduler: TaskScheduler,
    options?: ExecuteOptions,
  ): Promise<TaskResult> {
    // 选择 Worker
    const workerPool = Array.from(this.workers.values());
    let selectedWorker: WorkerAgent | null = null;
    if (this.manager) {
      selectedWorker = this.manager.selectWorker(task, workerPool);
    } else {
      // 无 manager：选择第一个空闲 worker
      selectedWorker = workerPool.find((w) => !w.isBusy()) || null;
    }

    if (!selectedWorker) {
      // 无可用 worker
      return {
        taskId: task.id,
        status: 'failed',
        error: 'No available worker',
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 0,
        retryCount: 0,
      };
    }

    // 触发回调
    if (options?.onTaskStart) {
      options.onTaskStart(task, selectedWorker.getDefinition());
    }

    // 发送消息
    this.messageBus.publish({
      id: generateId('msg'),
      fromAgentId: this.manager?.getDefinition().id || 'system',
      toAgentId: selectedWorker.getDefinition().id,
      type: 'task_assignment',
      payload: { task },
      timestamp: Date.now(),
      correlationId: task.id,
    });

    // 执行（含重试）
    let lastResult: TaskResult | null = null;
    const maxRetries: number = this.options.retryPolicy.maxRetries ?? 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await selectedWorker.executeTask(task, {
        retryAttempt: attempt,
      });

      if (result.status === 'completed') {
        scheduler.markCompleted(task.id);
        result.retryCount = attempt;
        if (options?.onTaskComplete) {
          options.onTaskComplete(task, result);
        }
        return result;
      }

      lastResult = result;
      // 指数退避
      if (attempt < maxRetries) {
        const backoffMs: number = this.options.retryPolicy.backoffMs ?? 1000;
        await new Promise((r) =>
          setTimeout(r, backoffMs * Math.pow(2, attempt)),
        );
      }
    }

    // 所有重试失败
    scheduler.markFailed(task.id, lastResult?.error || 'Unknown error');
    const failedResult: TaskResult = {
      ...(lastResult as TaskResult),
      retryCount: maxRetries,
    };
    if (options?.onTaskComplete) {
      options.onTaskComplete(task, failedResult);
    }
    return failedResult;
  }

  // ============ 中止 ============

  cancelCrew(crewId: string, reason?: string): boolean {
    const crew = this.crews.get(crewId);
    if (!crew) return false;
    if (crew.status !== 'running') return false;
    crew.status = 'cancelled';
    crew.completedAt = Date.now();
    if (reason) {
      crew.description = (crew.description || '') + ` [Cancelled: ${reason}]`;
    }
    return true;
  }

  // ============ 消息总线访问 ============

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getLLMProvider(): (prompt: string, options?: { json?: boolean }) => Promise<string> {
    return this.options.llmProvider;
  }

  setLLMProvider(
    provider: (prompt: string, options?: { json?: boolean }) => Promise<string>,
  ): void {
    this.options.llmProvider = provider;
  }
}

// ============ 全局单例 ============

let defaultEngine: MultiAgentEngine | null = null;

export function getDefaultMultiAgentEngine(): MultiAgentEngine {
  if (!defaultEngine) {
    defaultEngine = new MultiAgentEngine();
  }
  return defaultEngine;
}

export function resetDefaultMultiAgentEngine(): void {
  defaultEngine = null;
}

export function createMultiAgentEngine(options?: MultiAgentEngineOptions): MultiAgentEngine {
  return new MultiAgentEngine(options);
}
