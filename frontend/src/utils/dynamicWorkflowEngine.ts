/**
 * # ============================================================
 * # Dynamic Workflow Engine - 动态工作流引擎 (v1.0.0 Cycle 30 G30-02)
 * # ============================================================
 * # 核心作用：Phase-based 确定性编排 + Journaled Execution + Resume/Replay
 * # 参考：codex-flow + kedarkolluri/codex PR #27 Dynamic Workflows
 * # ============================================================
 * # 运行流程：
 * #   1. registerWorkflow(def) 注册工作流定义
 * #   2. start(workflowId, options) 启动工作流
 * #   3. 按依赖顺序执行 phase，支持并行组
 * #   4. 每个 phase 完成/失败时写入 journal
 * #   5. pause/resume/replay 控制工作流生命周期
 * #   6. 提供 fan-out/verify/aggregate 等高阶模板
 * # ============================================================
 * # 输入参数：WorkflowDefinition / StartOptions
 * # 输出结果：WorkflowInstance / JournalEntry / PhaseState
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 30 G30-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * Phase 类型
 */
export type PhaseType =
  | 'init'
  | 'execute'
  | 'verify'
  | 'fanout'
  | 'aggregate'
  | 'cleanup'
  | 'custom';

/**
 * Phase 状态
 */
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retrying';

/**
 * 工作流状态
 */
export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Phase 契约
 */
export interface PhaseContract {
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  validateInput?: (input: unknown) => { valid: boolean; errors?: string[] };
  validateOutput?: (output: unknown) => { valid: boolean; errors?: string[] };
}

/**
 * 阶段执行上下文
 */
export interface PhaseContext {
  workflowId: string;
  instanceId: string;
  phaseId: string;
  input: unknown;
  upstreamOutputs: Record<string, unknown>;
  abortSignal: AbortSignal;
}

/**
 * 阶段执行结果
 */
export interface PhaseResult {
  status: 'success' | 'failure';
  output?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
}

/**
 * Phase 定义
 */
export interface WorkflowPhase {
  id: string;
  name: string;
  type: PhaseType;
  description?: string;
  dependsOn: string[];
  contract: PhaseContract;
  execute: (ctx: PhaseContext) => Promise<PhaseResult>;
  retryBudget: number;
  timeoutMs?: number;
  parallelGroup?: string;
}

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  phases: WorkflowPhase[];
  parallelGroups?: string[][];
  metadata?: Record<string, unknown>;
}

/**
 * 阶段运行时状态
 */
export interface PhaseState {
  phaseId: string;
  status: PhaseStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  retries: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

/**
 * Journal 记录
 */
export interface JournalEntry {
  id: string;
  instanceId: string;
  phaseId: string;
  timestamp: number;
  status: PhaseStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  retries: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

/**
 * 工作流实例
 */
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionSnapshot: WorkflowDefinition;
  status: WorkflowStatus;
  initialInput: unknown;
  finalOutput?: unknown;
  currentPhase?: string;
  phaseStates: Record<string, PhaseState>;
  journal: JournalEntry[];
  startedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 启动选项
 */
export interface StartOptions {
  initialInput: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * 引擎配置
 */
export interface WorkflowEngineConfig {
  maxConcurrentPhases: number;
  defaultRetryBudget: number;
  defaultTimeoutMs: number;
  maxJournalEntries: number;
  persist: boolean;
}

/**
 * 引擎事件
 */
export type WorkflowEventType =
  | 'workflow-started'
  | 'workflow-paused'
  | 'workflow-resumed'
  | 'workflow-completed'
  | 'workflow-failed'
  | 'workflow-cancelled'
  | 'phase-started'
  | 'phase-completed'
  | 'phase-failed'
  | 'phase-retried'
  | 'phase-skipped'
  | 'journal-written';

export interface WorkflowEvent {
  type: WorkflowEventType;
  timestamp: number;
  instanceId: string;
  phaseId?: string;
  data?: unknown;
}

/**
 * 序列化状态
 */
export interface SerializedWorkflowState {
  workflows: WorkflowDefinition[];
  instances: WorkflowInstance[];
}

// ============ 默认配置 ============

export const DEFAULT_WORKFLOW_CONFIG: WorkflowEngineConfig = {
  maxConcurrentPhases: 4,
  defaultRetryBudget: 0,
  defaultTimeoutMs: 60_000,
  maxJournalEntries: 1000,
  persist: true,
};

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 */
export function generateWorkflowId(prefix: string = 'wf'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ 引擎主类 ============

/**
 * DynamicWorkflowEngine - 动态工作流引擎
 *
 * 实现 Phase-based 确定性编排、Journaled Execution、Resume/Replay 等能力。
 */
export class DynamicWorkflowEngine {
  private config: WorkflowEngineConfig;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private instances: Map<string, WorkflowInstance> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private listeners: Map<WorkflowEventType, Set<(e: WorkflowEvent) => void>> = new Map();
  private storageKey = 'hermes.dynamicWorkflow';

  constructor(config: Partial<WorkflowEngineConfig> = {}) {
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(this.storageKey)
          : null;
      if (raw) {
        const state: SerializedWorkflowState = JSON.parse(raw);
        if (state && Array.isArray(state.workflows)) {
          for (const wf of state.workflows) {
            this.workflows.set(wf.id, wf);
          }
        }
        // 不加载 instances（运行时状态）
      }
    } catch (e) {
      console.warn('DynamicWorkflowEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedWorkflowState = {
        workflows: Array.from(this.workflows.values()),
        instances: [],  // 不持久化实例
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('DynamicWorkflowEngine: failed to save state', e);
    }
  }

  // ============ 事件总线 ============

  on(event: WorkflowEventType, listener: (e: WorkflowEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: WorkflowEventType, listener: (e: WorkflowEvent) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: WorkflowEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (e) {
          console.error('DynamicWorkflowEngine listener error:', e);
        }
      }
    }
  }

  // ============ 工作流定义管理 ============

  /**
   * 注册工作流定义
   */
  registerWorkflow(def: WorkflowDefinition): void {
    if (this.workflows.has(def.id)) {
      throw new Error(`Workflow ${def.id} already registered`);
    }
    // 验证定义
    this.validateDefinition(def);
    this.workflows.set(def.id, def);
    this.save();
  }

  /**
   * 验证工作流定义
   */
  private validateDefinition(def: WorkflowDefinition): void {
    const phaseIds = new Set(def.phases.map((p) => p.id));
    for (const phase of def.phases) {
      for (const dep of phase.dependsOn) {
        if (!phaseIds.has(dep)) {
          throw new Error(`Phase ${phase.id} depends on non-existent phase ${dep}`);
        }
      }
    }
  }

  /**
   * 获取工作流定义
   */
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  /**
   * 列出所有工作流
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * 删除工作流
   */
  unregisterWorkflow(id: string): boolean {
    const result = this.workflows.delete(id);
    if (result) this.save();
    return result;
  }

  // ============ 启动 / 控制 ============

  /**
   * 启动工作流
   */
  start(workflowId: string, options: StartOptions): WorkflowInstance {
    const def = this.workflows.get(workflowId);
    if (!def) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const instance: WorkflowInstance = {
      id: generateWorkflowId('inst'),
      definitionId: workflowId,
      // 不使用 JSON.parse(JSON.stringify) 快照，因为会丢失 execute 函数
      // 改为直接引用原定义，因为 instances 是运行时状态不会持久化
      definitionSnapshot: def,
      status: 'pending',
      initialInput: options.initialInput,
      phaseStates: this.initPhaseStates(def),
      journal: [],
      startedAt: Date.now(),
      metadata: options.metadata,
    };

    this.instances.set(instance.id, instance);

    // 创建 AbortController
    const abortController = new AbortController();
    this.abortControllers.set(instance.id, abortController);

    this.emit({
      type: 'workflow-started',
      timestamp: Date.now(),
      instanceId: instance.id,
      data: { workflowId },
    });

    // 异步执行
    this.runWorkflow(instance, abortController.signal).catch((e) => {
      console.error('Workflow execution error:', e);
    });

    return instance;
  }

  /**
   * 启动并等待工作流完成
   */
  async startAndWait(
    workflowId: string,
    options: StartOptions
  ): Promise<WorkflowInstance> {
    const instance = this.start(workflowId, options);
    return new Promise((resolve, reject) => {
      const onComplete = (e: WorkflowEvent) => {
        if (e.instanceId === instance.id) {
          this.off('workflow-completed', onComplete);
          this.off('workflow-failed', onComplete);
          const final = this.getInstance(instance.id);
          if (final) resolve(final);
          else reject(new Error('Instance disappeared'));
        }
      };
      this.on('workflow-completed', onComplete);
      this.on('workflow-failed', onComplete);
    });
  }

  /**
   * 初始化 phase 状态
   */
  private initPhaseStates(def: WorkflowDefinition): Record<string, PhaseState> {
    const states: Record<string, PhaseState> = {};
    for (const phase of def.phases) {
      states[phase.id] = {
        phaseId: phase.id,
        status: 'pending',
        retries: 0,
      };
    }
    return states;
  }

  /**
   * 暂停工作流
   */
  pause(instanceId: string): WorkflowInstance {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    if (instance.status !== 'running') {
      throw new Error(`Cannot pause instance in status ${instance.status}`);
    }
    instance.status = 'paused';
    const ac = this.abortControllers.get(instanceId);
    if (ac) ac.abort();

    this.emit({
      type: 'workflow-paused',
      timestamp: Date.now(),
      instanceId,
    });

    return instance;
  }

  /**
   * 恢复工作流
   */
  resume(instanceId: string, fromPhase?: string): WorkflowInstance {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    if (instance.status !== 'paused' && instance.status !== 'failed') {
      throw new Error(`Cannot resume instance in status ${instance.status}`);
    }

    if (fromPhase) {
      this.resetPhaseTree(instance, fromPhase);
    } else {
      // 恢复时将所有 'running' 状态的 phase 重置为 'pending'
      // 因为 abort 可能中断了正在执行的 phase
      for (const state of Object.values(instance.phaseStates)) {
        if (state.status === 'running' || state.status === 'retrying') {
          state.status = 'pending';
        }
      }
    }

    instance.status = 'running';
    const ac = new AbortController();
    this.abortControllers.set(instanceId, ac);

    this.emit({
      type: 'workflow-resumed',
      timestamp: Date.now(),
      instanceId,
      phaseId: fromPhase,
    });

    this.runWorkflow(instance, ac.signal).catch((e) => {
      console.error('Workflow resume error:', e);
    });

    return instance;
  }

  /**
   * 从指定 phase 重新执行
   */
  replay(instanceId: string, fromPhase: string): WorkflowInstance {
    return this.resume(instanceId, fromPhase);
  }

  /**
   * 取消工作流
   */
  cancel(instanceId: string): WorkflowInstance {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    instance.status = 'cancelled';
    const ac = this.abortControllers.get(instanceId);
    if (ac) ac.abort();

    this.emit({
      type: 'workflow-cancelled',
      timestamp: Date.now(),
      instanceId,
    });

    return instance;
  }

  /**
   * 重置 phase 树（从 fromPhase 重新执行）
   */
  private resetPhaseTree(instance: WorkflowInstance, phaseId: string): void {
    const phase = instance.definitionSnapshot.phases.find((p) => p.id === phaseId);
    if (!phase) return;

    // 重置当前 phase
    instance.phaseStates[phaseId] = {
      phaseId,
      status: 'pending',
      retries: 0,
    };

    // 跳过依赖
    for (const depId of phase.dependsOn) {
      const depState = instance.phaseStates[depId];
      if (depState.status === 'pending') {
        depState.status = 'skipped';
      }
    }
  }

  // ============ 核心执行 ============

  /**
   * 运行工作流（主循环）
   */
  private async runWorkflow(
    instance: WorkflowInstance,
    abortSignal: AbortSignal
  ): Promise<void> {
    if (instance.status === 'pending') {
      instance.status = 'running';
    }

    try {
      while (!abortSignal.aborted) {
        const readyPhases = this.getReadyPhases(instance);
        if (readyPhases.length === 0) {
          // 没有可执行的 phase，判断工作流是否完成
          if (this.isAllPhasesDone(instance)) {
            instance.status = 'completed';
            instance.completedAt = Date.now();
            this.emit({
              type: 'workflow-completed',
              timestamp: Date.now(),
              instanceId: instance.id,
            });
          } else {
            // 有 phase 失败但不可执行
            instance.status = 'failed';
            instance.completedAt = Date.now();
            this.emit({
              type: 'workflow-failed',
              timestamp: Date.now(),
              instanceId: instance.id,
              data: { reason: 'Some phases failed' },
            });
          }
          return;
        }

        // 按并行组分组
        const groups = this.groupByParallelGroup(readyPhases, instance);

        for (const group of groups) {
          if (abortSignal.aborted) return;
          // 同组并行执行
          await Promise.allSettled(
            group.map((phaseId) => this.executePhase(instance, phaseId, abortSignal))
          );
          // 关键修复：执行完一个组后，检查 workflow 状态
          // 如果 instance 已经被标记为 paused/cancelled/failed，停止后续执行
          if (
            instance.status === 'paused' ||
            instance.status === 'cancelled' ||
            instance.status === 'failed'
          ) {
            return;
          }
        }
      }
    } catch (e) {
      console.error('[runWorkflow] caught error:', e);
      instance.status = 'failed';
      instance.completedAt = Date.now();
      this.emit({
        type: 'workflow-failed',
        timestamp: Date.now(),
        instanceId: instance.id,
        data: { error: String(e) },
      });
    }
  }

  /**
   * 获取可执行的 phase 列表
   */
  private getReadyPhases(instance: WorkflowInstance): string[] {
    const ready: string[] = [];
    for (const phase of instance.definitionSnapshot.phases) {
      const state = instance.phaseStates[phase.id];
      if (state.status !== 'pending') continue;

      // 检查所有依赖是否完成
      const allDepsCompleted = phase.dependsOn.every((depId) => {
        const depState = instance.phaseStates[depId];
        return depState && depState.status === 'completed';
      });

      if (allDepsCompleted) {
        ready.push(phase.id);
      }
    }
    return ready;
  }

  /**
   * 按并行组分组
   */
  private groupByParallelGroup(
    phaseIds: string[],
    instance: WorkflowInstance
  ): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();

    // 先按 parallelGroup 分组
    for (const phaseId of phaseIds) {
      if (processed.has(phaseId)) continue;
      const phase = instance.definitionSnapshot.phases.find((p) => p.id === phaseId);
      if (!phase || !phase.parallelGroup) continue;

      const groupPeers = phaseIds.filter((id) => {
        const p = instance.definitionSnapshot.phases.find((pp) => pp.id === id);
        return p && p.parallelGroup === phase.parallelGroup;
      });

      for (const peer of groupPeers) processed.add(peer);
      groups.push(groupPeers);
    }

    // 剩余的单独成组（串行）
    for (const phaseId of phaseIds) {
      if (!processed.has(phaseId)) {
        processed.add(phaseId);
        groups.push([phaseId]);
      }
    }

    return groups;
  }

  /**
   * 执行单个 phase
   */
  private async executePhase(
    instance: WorkflowInstance,
    phaseId: string,
    abortSignal: AbortSignal
  ): Promise<void> {
    const phase = instance.definitionSnapshot.phases.find((p) => p.id === phaseId);
    if (!phase) return;

    const state = instance.phaseStates[phaseId];
    if (!state || state.status === 'completed' || state.status === 'skipped') return;

    state.status = 'running';
    state.startedAt = Date.now();
    instance.currentPhase = phaseId;

    this.emit({
      type: 'phase-started',
      timestamp: Date.now(),
      instanceId: instance.id,
      phaseId,
    });

    // 构造输入
    const upstreamOutputs: Record<string, unknown> = {};
    for (const dep of phase.dependsOn) {
      const depState = instance.phaseStates[dep];
      if (depState?.output !== undefined) {
        upstreamOutputs[dep] = depState.output;
      }
    }

    const input = upstreamOutputs[Object.keys(upstreamOutputs)[0]] ?? instance.initialInput;
    state.input = input;

    // 验证输入
    if (phase.contract.validateInput) {
      const result = phase.contract.validateInput(input);
      if (!result.valid) {
        state.status = 'failed';
        state.error = `Input validation failed: ${result.errors?.join('; ')}`;
        state.completedAt = Date.now();
        state.durationMs = state.completedAt - state.startedAt;
        this.writeJournal(instance, phaseId, state);
        this.emit({
          type: 'phase-failed',
          timestamp: Date.now(),
          instanceId: instance.id,
          phaseId,
          data: { error: state.error },
        });
        return;
      }
    }

    // 执行（带重试）
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= phase.retryBudget; attempt++) {
      if (abortSignal.aborted) return;
      try {
        const ctx: PhaseContext = {
          workflowId: instance.definitionId,
          instanceId: instance.id,
          phaseId,
          input,
          upstreamOutputs,
          abortSignal,
        };

        const executePromise = phase.execute(ctx);
        const timeoutMs = phase.timeoutMs ?? this.config.defaultTimeoutMs;
        const result = await this.withTimeout(executePromise, timeoutMs, abortSignal);

        // 验证输出
        if (phase.contract.validateOutput) {
          const validation = phase.contract.validateOutput(result.output);
          if (!validation.valid) {
            throw new Error(`Output validation failed: ${validation.errors?.join('; ')}`);
          }
        }

        state.status = 'completed';
        state.output = result.output;
        state.completedAt = Date.now();
        state.durationMs = state.completedAt - state.startedAt;
        state.error = undefined;
        this.writeJournal(instance, phaseId, state);

        this.emit({
          type: 'phase-completed',
          timestamp: Date.now(),
          instanceId: instance.id,
          phaseId,
          data: { output: result.output, durationMs: state.durationMs },
        });
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        state.retries++;
        if (attempt < phase.retryBudget) {
          state.status = 'retrying';
          this.emit({
            type: 'phase-retried',
            timestamp: Date.now(),
            instanceId: instance.id,
            phaseId,
            data: { attempt: attempt + 1, error: lastError },
          });
        }
      }
    }

    // 重试耗尽
    state.status = 'failed';
    state.error = lastError;
    state.completedAt = Date.now();
    state.durationMs = state.completedAt - (state.startedAt ?? Date.now());
    this.writeJournal(instance, phaseId, state);

    this.emit({
      type: 'phase-failed',
      timestamp: Date.now(),
      instanceId: instance.id,
      phaseId,
      data: { error: state.error, retries: state.retries },
    });
  }

  /**
   * 带超时和 abort 的 Promise
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    abortSignal: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Phase execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Phase execution aborted'));
      };
      abortSignal.addEventListener('abort', onAbort);

      promise
        .then((result) => {
          clearTimeout(timer);
          abortSignal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          abortSignal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }

  /**
   * 写入 journal
   */
  private writeJournal(
    instance: WorkflowInstance,
    phaseId: string,
    state: PhaseState
  ): void {
    const entry: JournalEntry = {
      id: generateWorkflowId('journal'),
      instanceId: instance.id,
      phaseId,
      timestamp: Date.now(),
      status: state.status,
      input: state.input,
      output: state.output,
      error: state.error,
      retries: state.retries,
      durationMs: state.durationMs ?? 0,
    };
    instance.journal.push(entry);

    // 限制 journal 大小
    if (instance.journal.length > this.config.maxJournalEntries) {
      instance.journal = instance.journal.slice(-this.config.maxJournalEntries);
    }

    this.emit({
      type: 'journal-written',
      timestamp: Date.now(),
      instanceId: instance.id,
      phaseId,
      data: entry,
    });
  }

  /**
   * 判断所有 phase 是否已完成
   */
  private isAllPhasesDone(instance: WorkflowInstance): boolean {
    return Object.values(instance.phaseStates).every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );
  }

  // ============ 模板 ============

  /**
   * 构建扇出-验证-汇总工作流
   */
  buildFanOutVerifyAggregate(config: {
    name: string;
    fanoutCount: number;
    verifierCount: number;
    aggregatorType: 'merge' | 'vote' | 'best' | 'consensus';
    fanoutExecute: (ctx: PhaseContext, index: number) => Promise<PhaseResult>;
    verifyExecute: (ctx: PhaseContext, index: number) => Promise<PhaseResult>;
    aggregateExecute: (ctx: PhaseContext) => Promise<PhaseResult>;
  }): WorkflowDefinition {
    const wfId = generateWorkflowId('wf');
    const fanoutPhases: WorkflowPhase[] = [];
    const verifyPhases: WorkflowPhase[] = [];

    for (let i = 0; i < config.fanoutCount; i++) {
      fanoutPhases.push({
        id: `fanout-${i}`,
        name: `Fanout #${i}`,
        type: 'fanout',
        dependsOn: [],
        contract: {},
        retryBudget: 1,
        timeoutMs: 30_000,
        parallelGroup: 'fanout-group',
        execute: (ctx) => config.fanoutExecute(ctx, i),
      });
    }

    for (let i = 0; i < config.verifierCount; i++) {
      verifyPhases.push({
        id: `verify-${i}`,
        name: `Verify #${i}`,
        type: 'verify',
        dependsOn: fanoutPhases.map((p) => p.id),
        contract: {},
        retryBudget: 1,
        timeoutMs: 30_000,
        parallelGroup: 'verify-group',
        execute: (ctx) => config.verifyExecute(ctx, i),
      });
    }

    const aggregatePhase: WorkflowPhase = {
      id: 'aggregate',
      name: 'Aggregate',
      type: 'aggregate',
      dependsOn: verifyPhases.map((p) => p.id),
      contract: {},
      retryBudget: 0,
      timeoutMs: 30_000,
      execute: config.aggregateExecute,
    };

    return {
      id: wfId,
      name: config.name,
      description: `Fan-out (${config.fanoutCount}) → Verify (${config.verifierCount}) → Aggregate (${config.aggregatorType})`,
      version: '1.0.0',
      phases: [...fanoutPhases, ...verifyPhases, aggregatePhase],
      parallelGroups: [['fanout-group'], ['verify-group']],
      metadata: { aggregatorType: config.aggregatorType },
    };
  }

  /**
   * 构建 Review-Repair-Validate 工作流
   */
  buildReviewRepairValidate(config: {
    name: string;
    reviewRounds: number;
    reviewExecute: (ctx: PhaseContext) => Promise<PhaseResult>;
    repairExecute: (ctx: PhaseContext) => Promise<PhaseResult>;
    validateExecute: (ctx: PhaseContext) => Promise<PhaseResult>;
  }): WorkflowDefinition {
    const wfId = generateWorkflowId('wf');
    const phases: WorkflowPhase[] = [];

    for (let i = 0; i < config.reviewRounds; i++) {
      const isLast = i === config.reviewRounds - 1;
      phases.push({
        id: `review-${i}`,
        name: `Review Round ${i + 1}`,
        type: 'verify',
        dependsOn: i === 0 ? [] : [`repair-${i - 1}`],
        contract: {},
        retryBudget: 0,
        execute: config.reviewExecute,
      });
      if (!isLast) {
        phases.push({
          id: `repair-${i}`,
          name: `Repair Round ${i + 1}`,
          type: 'execute',
          dependsOn: [`review-${i}`],
          contract: {},
          retryBudget: 1,
          execute: config.repairExecute,
        });
      }
    }

    phases.push({
      id: 'validate',
      name: 'Final Validation',
      type: 'verify',
      dependsOn: [`review-${config.reviewRounds - 1}`],
      contract: {},
      retryBudget: 0,
      execute: config.validateExecute,
    });

    return {
      id: wfId,
      name: config.name,
      description: `Review → Repair × ${config.reviewRounds} → Validate`,
      version: '1.0.0',
      phases,
    };
  }

  /**
   * 构建线性管道
   */
  buildPipeline(config: {
    name: string;
    phases: Array<{
      id: string;
      name: string;
      type: PhaseType;
      execute: (ctx: PhaseContext) => Promise<PhaseResult>;
      retryBudget?: number;
      timeoutMs?: number;
    }>;
  }): WorkflowDefinition {
    const phases: WorkflowPhase[] = config.phases.map((p, i) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      dependsOn: i === 0 ? [] : [config.phases[i - 1].id],
      contract: {},
      retryBudget: p.retryBudget ?? this.config.defaultRetryBudget,
      timeoutMs: p.timeoutMs,
      execute: p.execute,
    }));

    return {
      id: generateWorkflowId('wf'),
      name: config.name,
      description: `Linear pipeline with ${phases.length} phases`,
      version: '1.0.0',
      phases,
    };
  }

  // ============ 查询 ============

  /**
   * 获取工作流实例
   */
  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * 列出工作流实例
   */
  listInstances(filter?: {
    status?: WorkflowStatus;
    definitionId?: string;
  }): WorkflowInstance[] {
    let result = Array.from(this.instances.values());
    if (filter?.status) {
      result = result.filter((i) => i.status === filter.status);
    }
    if (filter?.definitionId) {
      result = result.filter((i) => i.definitionId === filter.definitionId);
    }
    return result.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取 Journal
   */
  getJournal(instanceId: string): JournalEntry[] {
    const instance = this.getInstance(instanceId);
    if (!instance) return [];
    return [...instance.journal].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取 phase 状态
   */
  getPhaseState(instanceId: string, phaseId: string): PhaseState | undefined {
    const instance = this.getInstance(instanceId);
    if (!instance) return undefined;
    return instance.phaseStates[phaseId];
  }

  // ============ 统计 ============

  /**
   * 获取引擎统计
   */
  getStats(): {
    registeredWorkflows: number;
    totalInstances: number;
    runningInstances: number;
    completedInstances: number;
    failedInstances: number;
    totalJournalEntries: number;
  } {
    const instances = Array.from(this.instances.values());
    const totalJournal = instances.reduce((sum, i) => sum + i.journal.length, 0);
    return {
      registeredWorkflows: this.workflows.size,
      totalInstances: instances.length,
      runningInstances: instances.filter((i) => i.status === 'running').length,
      completedInstances: instances.filter((i) => i.status === 'completed').length,
      failedInstances: instances.filter((i) => i.status === 'failed').length,
      totalJournalEntries: totalJournal,
    };
  }

  // ============ 持久化 ============

  exportState(): SerializedWorkflowState {
    return {
      workflows: Array.from(this.workflows.values()),
      instances: [],  // 不导出实例
    };
  }

  importState(state: SerializedWorkflowState): void {
    this.workflows.clear();
    for (const wf of state.workflows ?? []) {
      this.workflows.set(wf.id, wf);
    }
    this.save();
  }

  clear(): void {
    this.workflows.clear();
    this.instances.clear();
    this.abortControllers.forEach((ac) => ac.abort());
    this.abortControllers.clear();
    this.save();
  }
}

// ============ 全局单例 ============

let defaultEngine: DynamicWorkflowEngine | null = null;

export function getDefaultDynamicWorkflowEngine(): DynamicWorkflowEngine {
  if (!defaultEngine) {
    defaultEngine = new DynamicWorkflowEngine();
  }
  return defaultEngine;
}

export function resetDefaultDynamicWorkflowEngine(): void {
  defaultEngine = null;
}
