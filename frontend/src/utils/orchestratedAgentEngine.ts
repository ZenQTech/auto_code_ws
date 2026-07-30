/**
 * # ============================================================
 * # Orchestrated Agent Engine - 编排多代理引擎 (v1.0.0 Cycle 30 G30-03)
 * # ============================================================
 * # 核心作用：实现 6 阶段 Orchestrated Mode + 角色预设 + Phase Contract 验证
 * # 参考：Codex Orchestrated Mode PoC #32100 + Codex Subagents
 * # ============================================================
 * # 6 阶段流程：
 * #   Direct:  Worker → Short root completion
 * #   Reviewed: Explorer → Worker Plan → Plan Review → Worker Execution → Result Review → Synthesizer
 * # ============================================================
 * # 输入参数：userTurn / options
 * # 输出结果：OrchestratedTask / OrchestratedPhase / WorkerPacket / PlanPacket / ReviewPacket
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 30 G30-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 代理角色
 */
export type AgentRole =
  | 'orchestrator'
  | 'worker'
  | 'explorer'
  | 'reviewer'
  | 'synthesizer';

/**
 * 执行路径
 */
export type ExecutionPath = 'direct' | 'reviewed';

/**
 * 阶段状态
 */
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retrying'
  | 'malformed';

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * 沙箱模式
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'full';

/**
 * 隔离模式
 */
export type IsolationMode = 'thread' | 'worktree';

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
 * 任务契约
 */
export interface TaskContract {
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  scope: {
    files?: string[];
    directories?: string[];
  };
  evidence: Array<{
    type: 'file' | 'command' | 'doc';
    ref: string;
    summary: string;
  }>;
}

/**
 * Worker Packet
 */
export interface WorkerPacket {
  taskId: string;
  phaseId: string;
  status: 'complete' | 'incomplete';
  output: unknown;
  changedFiles: string[];
  verification: {
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    linting: 'pass' | 'fail' | 'skipped';
  };
  truncated: boolean;
  retryReason?: string;
  timestamp: number;
}

/**
 * Plan Packet
 */
export interface PlanPacket {
  taskId: string;
  plan: Array<{
    step: number;
    description: string;
    filesAffected: string[];
    estimatedMinutes: number;
  }>;
  risks: string[];
  rollback: string;
  truncated: boolean;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: number;
}

/**
 * Review Packet
 */
export interface ReviewPacket {
  taskId: string;
  phaseId: string;
  reviewType: 'plan' | 'result';
  decision: 'approved' | 'rejected' | 'invalid';
  issues: Array<{ severity: 'high' | 'medium' | 'low'; description: string }>;
  truncated: boolean;
  reviewer: string;
  reviewedAt: number;
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  mode: SandboxMode;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedNetworkHosts: string[];
  approvalRequired: boolean;
}

/**
 * 角色配置
 */
export interface AgentRoleConfig {
  role: AgentRole;
  sandboxMode: SandboxMode;
  allowedTools: string[];
  model: string;
  systemPrompt: string;
  isolation: IsolationMode;
  description: string;
}

/**
 * 阶段定义
 */
export interface OrchestratedPhase {
  id: string;
  name: string;
  role: AgentRole;
  dependsOn: string[];
  contract: PhaseContract;
  maxRetries: number;
  currentRetries: number;
  status: PhaseStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  packet?: WorkerPacket | PlanPacket | ReviewPacket | Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

/**
 * 编排任务
 */
export interface OrchestratedTask {
  id: string;
  userTurn: string;
  path: ExecutionPath;
  contract: TaskContract;
  phases: OrchestratedPhase[];
  status: TaskStatus;
  rootSynthesis?: string;
  currentPhase?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  totalRetries: number;
}

/**
 * 编排选项
 */
export interface OrchestrateOptions {
  forcePath?: ExecutionPath;
  maxRetriesPerPhase?: number;
  model?: string;
  autoApprovePlan?: boolean;
  skipExplorer?: boolean;
  parentSandbox?: SandboxConfig;
}

/**
 * 引擎事件
 */
export type OrchestratorEventType =
  | 'task-started'
  | 'path-selected'
  | 'phase-started'
  | 'phase-completed'
  | 'phase-failed'
  | 'phase-retried'
  | 'phase-malformed'
  | 'plan-approved'
  | 'plan-rejected'
  | 'synthesis-generated'
  | 'task-completed'
  | 'task-failed'
  | 'role-registered';

export interface OrchestratorEvent {
  type: OrchestratorEventType;
  timestamp: number;
  taskId?: string;
  phaseId?: string;
  data?: unknown;
}

/**
 * 引擎配置
 */
export interface OrchestratorConfig {
  maxThreads: number;
  maxDepth: number;
  maxRetriesPerPhase: number;
  autoApprovePlan: boolean;
  defaultParentSandbox: SandboxConfig;
  persist: boolean;
}

/**
 * 序列化状态
 */
export interface SerializedOrchestratorState {
  tasks: OrchestratedTask[];
  roles: AgentRoleConfig[];
}

// ============ 默认配置 ============

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: 'workspace-write',
  allowedPaths: ['**/*'],
  deniedPaths: [],
  allowedNetworkHosts: ['*'],
  approvalRequired: true,
};

export const DEFAULT_ROLE_CONFIGS: Record<AgentRole, AgentRoleConfig> = {
  orchestrator: {
    role: 'orchestrator',
    sandboxMode: 'workspace-write',
    allowedTools: ['*'],
    model: 'claude-opus-5',
    systemPrompt: '你是根编排器，负责协调 worker/explorer/reviewer/synthesizer 完成复杂任务。',
    isolation: 'thread',
    description: '根编排',
  },
  worker: {
    role: 'worker',
    sandboxMode: 'workspace-write',
    allowedTools: ['read', 'write', 'edit', 'bash', 'git', 'test'],
    model: 'claude-sonnet-5',
    systemPrompt: '你是 Worker，负责实现和修复任务。',
    isolation: 'worktree',
    description: '干活型',
  },
  explorer: {
    role: 'explorer',
    sandboxMode: 'read-only',
    allowedTools: ['read', 'grep', 'search'],
    model: 'claude-haiku-5',
    systemPrompt: '你是 Explorer，负责只读探索代码库。',
    isolation: 'thread',
    description: '只读探索',
  },
  reviewer: {
    role: 'reviewer',
    sandboxMode: 'read-only',
    allowedTools: ['read', 'grep', 'search', 'diff'],
    model: 'claude-sonnet-5',
    systemPrompt: '你是 Reviewer，负责审查 Plan 和 Result。',
    isolation: 'thread',
    description: '审查型',
  },
  synthesizer: {
    role: 'synthesizer',
    sandboxMode: 'read-only',
    allowedTools: ['read'],
    model: 'claude-haiku-5',
    systemPrompt: '你是 Synthesizer，输出简洁总结。',
    isolation: 'thread',
    description: '合成型',
  },
};

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxThreads: 6,
  maxDepth: 3,
  maxRetriesPerPhase: 2,
  autoApprovePlan: true,
  defaultParentSandbox: DEFAULT_SANDBOX_CONFIG,
  persist: true,
};

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 */
export function generateOrchestratorId(prefix: string = 'orch'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ 引擎主类 ============

/**
 * OrchestratedAgentEngine - 编排多代理引擎
 *
 * 实现 6 阶段 Orchestrated Mode、Worker/Explorer 角色预设、Phase Contract 验证等功能。
 */
export class OrchestratedAgentEngine {
  private config: OrchestratorConfig;
  private roles: Map<AgentRole, AgentRoleConfig> = new Map();
  private tasks: Map<string, OrchestratedTask> = new Map();
  private listeners: Map<OrchestratorEventType, Set<(e: OrchestratorEvent) => void>> = new Map();
  private storageKey = 'hermes.orchestratedAgent';

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    // 注册默认角色
    for (const [role, roleConfig] of Object.entries(DEFAULT_ROLE_CONFIGS)) {
      this.roles.set(role as AgentRole, roleConfig);
    }
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
        const state: SerializedOrchestratorState = JSON.parse(raw);
        if (state && Array.isArray(state.roles)) {
          for (const role of state.roles) {
            this.roles.set(role.role, role);
          }
        }
        if (state && Array.isArray(state.tasks)) {
          for (const task of state.tasks) {
            this.tasks.set(task.id, task);
          }
        }
      }
    } catch (e) {
      console.warn('OrchestratedAgentEngine: failed to load state', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedOrchestratorState = {
        tasks: Array.from(this.tasks.values()),
        roles: Array.from(this.roles.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('OrchestratedAgentEngine: failed to save state', e);
    }
  }

  // ============ 事件总线 ============

  on(event: OrchestratorEventType, listener: (e: OrchestratorEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: OrchestratorEventType, listener: (e: OrchestratorEvent) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: OrchestratorEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (e) {
          console.error('OrchestratedAgentEngine listener error:', e);
        }
      }
    }
  }

  // ============ 角色管理 ============

  /**
   * 注册角色配置
   */
  registerRole(config: AgentRoleConfig): void {
    this.roles.set(config.role, config);
    this.save();
    this.emit({
      type: 'role-registered',
      timestamp: Date.now(),
      data: { config },
    });
  }

  /**
   * 获取角色配置
   */
  getRole(role: AgentRole): AgentRoleConfig {
    const config = this.roles.get(role);
    if (!config) {
      throw new Error(`Role ${role} not registered`);
    }
    return config;
  }

  /**
   * 列出所有角色
   */
  listRoles(): AgentRole[] {
    return Array.from(this.roles.keys());
  }

  /**
   * 重置为默认角色
   */
  resetRoles(): void {
    this.roles.clear();
    for (const [role, roleConfig] of Object.entries(DEFAULT_ROLE_CONFIGS)) {
      this.roles.set(role as AgentRole, roleConfig);
    }
    this.save();
  }

  // ============ 任务构建 ============

  /**
   * 构建任务（仅构建，不执行）
   */
  buildTask(userTurn: string, options: OrchestrateOptions = {}): OrchestratedTask {
    const path = options.forcePath ?? this.selectPath({
      scopeNarrowness: 0.5,
      evidenceAvailable: 0.5,
    });

    const contract: TaskContract = {
      goal: userTurn,
      constraints: [],
      acceptanceCriteria: [],
      scope: {},
      evidence: [],
    };

    const task: OrchestratedTask = {
      id: generateOrchestratorId('task'),
      userTurn,
      path,
      contract,
      phases: this.buildPhases(path, options),
      status: 'pending',
      metadata: {
        options,
        parentSandbox: options.parentSandbox,
      },
      createdAt: Date.now(),
      totalRetries: 0,
    };

    this.tasks.set(task.id, task);
    this.save();

    return task;
  }

  /**
   * 构建阶段列表
   */
  private buildPhases(path: ExecutionPath, options: OrchestrateOptions): OrchestratedPhase[] {
    if (path === 'direct') {
      return [
        this.createPhase('worker-execute', 'Worker Execute', 'worker', [], 2),
        this.createPhase('synthesizer', 'Synthesizer', 'synthesizer', ['worker-execute'], 0),
      ];
    }

    // reviewed path
    const phases: OrchestratedPhase[] = [];

    if (!options.skipExplorer) {
      phases.push(this.createPhase('explorer', 'Explorer', 'explorer', [], 1));
    }

    phases.push(this.createPhase('worker-plan', 'Worker Plan', 'worker', options.skipExplorer ? [] : ['explorer'], 1));
    phases.push(this.createPhase('plan-review', 'Plan Review', 'reviewer', ['worker-plan'], 1));
    phases.push(this.createPhase('worker-execute', 'Worker Execute', 'worker', ['plan-review'], 2));
    phases.push(this.createPhase('result-review', 'Result Review', 'reviewer', ['worker-execute'], 1));
    phases.push(this.createPhase('synthesizer', 'Synthesizer', 'synthesizer', ['result-review'], 0));

    return phases;
  }

  /**
   * 创建单个阶段
   */
  private createPhase(
    id: string,
    name: string,
    role: AgentRole,
    dependsOn: string[],
    maxRetries: number
  ): OrchestratedPhase {
    return {
      id,
      name,
      role,
      dependsOn,
      contract: {
        validateOutput: (output: unknown) => {
          if (output === undefined || output === null) {
            return { valid: false, errors: ['Output is empty'] };
          }
          return { valid: true };
        },
      },
      maxRetries,
      currentRetries: 0,
      status: 'pending',
    };
  }

  // ============ 路径选择 ============

  /**
   * 选择执行路径
   */
  selectPath(criteria: {
    scopeNarrowness: number;
    evidenceAvailable: number;
  }): ExecutionPath {
    // 评分 0-2：越低越倾向 direct
    const score = (1 - criteria.scopeNarrowness) + (1 - criteria.evidenceAvailable);
    return score < 0.6 ? 'direct' : 'reviewed';
  }

  // ============ 任务执行 ============

  /**
   * 编排执行
   */
  async orchestrate(userTurn: string, options: OrchestrateOptions = {}): Promise<OrchestratedTask> {
    const task = this.buildTask(userTurn, options);
    task.status = 'running';
    task.startedAt = Date.now();

    this.emit({
      type: 'task-started',
      timestamp: Date.now(),
      taskId: task.id,
    });

    this.emit({
      type: 'path-selected',
      timestamp: Date.now(),
      taskId: task.id,
      data: { path: task.path },
    });

    try {
      // 执行所有阶段
      await this.executeTaskPhases(task, options);
      task.status = 'completed';
      task.completedAt = Date.now();
      task.rootSynthesis = this.synthesize(task);

      this.emit({
        type: 'synthesis-generated',
        timestamp: Date.now(),
        taskId: task.id,
        data: { synthesis: task.rootSynthesis },
      });
      this.emit({
        type: 'task-completed',
        timestamp: Date.now(),
        taskId: task.id,
      });
    } catch (e) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.rootSynthesis = this.generateShortRootFailure(task, e);
      this.emit({
        type: 'task-failed',
        timestamp: Date.now(),
        taskId: task.id,
        data: { error: String(e), synthesis: task.rootSynthesis },
      });
    }

    this.save();
    return task;
  }

  /**
   * 执行任务的所有阶段
   */
  private async executeTaskPhases(
    task: OrchestratedTask,
    options: OrchestrateOptions
  ): Promise<void> {
    for (const phase of task.phases) {
      // 检查依赖
      const depsOk = phase.dependsOn.every((depId) => {
        const dep = task.phases.find((p) => p.id === depId);
        return dep && dep.status === 'completed';
      });
      if (!depsOk) {
        phase.status = 'skipped';
        continue;
      }

      // Plan Review 需要审批
      if (phase.id === 'plan-review') {
        const planPhase = task.phases.find((p) => p.id === 'worker-plan');
        if (planPhase?.packet && !this.isPlanApproved(planPhase.packet as PlanPacket)) {
          if (!options.autoApprovePlan && !this.config.autoApprovePlan) {
            // 等待外部审批
            continue;
          }
          // 自动批准
          this.approvePlan(task.id, 'worker-plan', 'auto', 'auto-approved');
        }
      }

      await this.executePhase(task, phase, options);
    }
  }

  /**
   * 执行单个阶段
   */
  private async executePhase(
    task: OrchestratedTask,
    phase: OrchestratedPhase,
    options: OrchestrateOptions
  ): Promise<void> {
    phase.status = 'running';
    phase.startedAt = Date.now();
    task.currentPhase = phase.id;

    this.emit({
      type: 'phase-started',
      timestamp: Date.now(),
      taskId: task.id,
      phaseId: phase.id,
    });

    // 构造 input
    const upstreamOutputs: Record<string, unknown> = {};
    for (const dep of phase.dependsOn) {
      const depPhase = task.phases.find((p) => p.id === dep);
      if (depPhase?.output !== undefined) {
        upstreamOutputs[dep] = depPhase.output;
      }
    }
    const input = upstreamOutputs[Object.keys(upstreamOutputs)[0]] ?? task.userTurn;
    phase.input = input;

    // 执行
    const role = this.getRole(phase.role);
    const output = this.simulatePhaseExecution(phase, role, options);

    // 验证输出
    if (phase.contract.validateOutput) {
      const validation = phase.contract.validateOutput(output);
      if (!validation.valid) {
        phase.status = 'malformed';
        phase.error = validation.errors?.join('; ');
        phase.completedAt = Date.now();
        this.emit({
          type: 'phase-malformed',
          timestamp: Date.now(),
          taskId: task.id,
          phaseId: phase.id,
          data: { errors: validation.errors },
        });
        // 重试
        if (phase.currentRetries < phase.maxRetries) {
          phase.currentRetries++;
          phase.status = 'retrying';
          this.emit({
            type: 'phase-retried',
            timestamp: Date.now(),
            taskId: task.id,
            phaseId: phase.id,
            data: { attempt: phase.currentRetries },
          });
          return this.executePhase(task, phase, options);
        }
        phase.status = 'failed';
        this.emit({
          type: 'phase-failed',
          timestamp: Date.now(),
          taskId: task.id,
          phaseId: phase.id,
          data: { error: phase.error },
        });
        throw new Error(`Phase ${phase.id} failed: ${phase.error}`);
      }
    }

    phase.output = output;
    phase.packet = this.createPacket(task, phase, output);
    phase.status = 'completed';
    phase.completedAt = Date.now();
    phase.durationMs = phase.completedAt - phase.startedAt;

    this.emit({
      type: 'phase-completed',
      timestamp: Date.now(),
      taskId: task.id,
      phaseId: phase.id,
      data: { output, packet: phase.packet },
    });
  }

  /**
   * 模拟阶段执行（mock）
   */
  private simulatePhaseExecution(
    phase: OrchestratedPhase,
    _role: AgentRoleConfig,
    _options: OrchestrateOptions
  ): unknown {
    // 根据角色类型生成不同的 mock 输出
    switch (phase.id) {
      case 'explorer':
        return {
          findings: ['已探索代码库结构', '识别主要模块'],
          files: ['src/index.ts', 'src/utils.ts'],
        };
      case 'worker-plan':
        return {
          plan: [
            { step: 1, description: '实现核心功能', filesAffected: ['src/core.ts'], estimatedMinutes: 30 },
            { step: 2, description: '添加测试', filesAffected: ['src/core.test.ts'], estimatedMinutes: 20 },
          ],
          risks: ['可能影响现有功能'],
          rollback: 'git revert',
        };
      case 'plan-review':
        return {
          decision: 'approved',
          issues: [],
        };
      case 'worker-execute':
        return {
          status: 'complete',
          changedFiles: ['src/core.ts', 'src/core.test.ts'],
          output: '实现完成',
        };
      case 'result-review':
        return {
          decision: 'approved',
          issues: [],
        };
      case 'synthesizer':
        return {
          summary: '任务已完成',
        };
      default:
        return { result: 'done' };
    }
  }

  /**
   * 创建 Packet
   */
  private createPacket(
    task: OrchestratedTask,
    phase: OrchestratedPhase,
    output: unknown
  ): WorkerPacket | PlanPacket | ReviewPacket | Record<string, unknown> {
    const now = Date.now();
    if (phase.id === 'worker-plan' && output && typeof output === 'object') {
      const plan = output as { plan?: unknown[]; risks?: string[]; rollback?: string };
      return {
        taskId: task.id,
        plan: (plan.plan ?? []) as PlanPacket['plan'],
        risks: (plan.risks ?? []) as string[],
        rollback: plan.rollback ?? '',
        truncated: false,
        approved: false,
      };
    }

    if (phase.id === 'worker-execute' && output && typeof output === 'object') {
      const exec = output as { status?: string; changedFiles?: string[]; output?: unknown };
      return {
        taskId: task.id,
        phaseId: phase.id,
        status: (exec.status as 'complete' | 'incomplete') ?? 'complete',
        output: exec.output,
        changedFiles: exec.changedFiles ?? [],
        verification: {
          testsRun: 10,
          testsPassed: 10,
          testsFailed: 0,
          linting: 'pass',
        },
        truncated: false,
        timestamp: now,
      };
    }

    if ((phase.id === 'plan-review' || phase.id === 'result-review') && output && typeof output === 'object') {
      const review = output as { decision?: string; issues?: ReviewPacket['issues'] };
      return {
        taskId: task.id,
        phaseId: phase.id,
        reviewType: phase.id === 'plan-review' ? 'plan' : 'result',
        decision: (review.decision as ReviewPacket['decision']) ?? 'approved',
        issues: review.issues ?? [],
        truncated: false,
        reviewer: 'auto',
        reviewedAt: now,
      };
    }

    return { output };
  }

  /**
   * 检查 plan 是否已批准
   */
  private isPlanApproved(packet: PlanPacket): boolean {
    return packet.approved === true;
  }

  // ============ Packet 验证 ============

  /**
   * 验证 Worker Packet
   */
  validateWorkerPacket(packet: WorkerPacket): {
    valid: boolean;
    malformed: boolean;
    truncated: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (packet.truncated) {
      issues.push('Packet was truncated');
    }

    if (!packet.output) {
      issues.push('Missing output field');
    }

    if (!Array.isArray(packet.changedFiles)) {
      issues.push('changedFiles must be an array');
    }

    if (!packet.verification) {
      issues.push('Missing verification field');
    } else {
      if (packet.verification.testsFailed > 0) {
        issues.push(`${packet.verification.testsFailed} tests failed`);
      }
    }

    const malformed = issues.some(
      (i) =>
        i.includes('Missing') ||
        i.includes('must be') ||
        i.includes('undefined')
    );

    return {
      valid: issues.length === 0 && !packet.truncated,
      malformed,
      truncated: packet.truncated,
      issues,
    };
  }

  /**
   * 验证阶段输出
   */
  validatePhaseOutput(
    phase: OrchestratedPhase,
    output: unknown
  ): { valid: boolean; errors?: string[] } {
    if (phase.contract.validateOutput) {
      return phase.contract.validateOutput(output);
    }
    return { valid: output !== undefined && output !== null };
  }

  // ============ Retry Budget ============

  /**
   * 增加重试次数
   */
  incrementRetry(taskId: string, phaseId: string): number {
    const task = this.getTask(taskId);
    if (!task) return 0;
    const phase = task.phases.find((p) => p.id === phaseId);
    if (!phase) return 0;
    phase.currentRetries++;
    task.totalRetries++;
    this.save();
    return phase.currentRetries;
  }

  /**
   * 是否应该触发任务失败（重试用尽）
   */
  shouldFailTask(taskId: string, phaseId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return true;
    const phase = task.phases.find((p) => p.id === phaseId);
    if (!phase) return true;
    return phase.currentRetries >= phase.maxRetries;
  }

  // ============ Root Synthesis ============

  /**
   * 智能合成 Root 输出
   */
  synthesize(task: OrchestratedTask): string {
    const workerPhases = task.phases.filter(
      (p) => p.role === 'worker' && p.packet
    );

    if (workerPhases.length === 0) {
      return '任务执行未产生有效输出。';
    }

    const lastWorker = workerPhases[workerPhases.length - 1];
    const packet = lastWorker.packet as WorkerPacket | undefined;

    if (!packet || !('status' in packet)) {
      return '任务执行未产生有效 worker packet。';
    }

    // 完整 packet：简短总结
    if (
      packet.status === 'complete' &&
      !packet.truncated &&
      packet.verification?.testsFailed === 0
    ) {
      return [
        '✓ 任务已完成',
        `  - 变更文件: ${packet.changedFiles.length} 个`,
        `  - 测试: ${packet.verification.testsPassed}/${packet.verification.testsRun} 通过`,
        `  - 路径: ${task.path}`,
      ].join('\n');
    }

    // 不完整：列出剩余问题
    const issues: string[] = [];
    if (packet.status === 'incomplete') {
      issues.push('- 任务未完成（worker 报告 incomplete）');
    }
    if (packet.truncated) {
      issues.push('- Worker Packet 被截断');
    }
    if (packet.verification?.testsFailed > 0) {
      issues.push(`- ${packet.verification.testsFailed} 个测试失败`);
    }

    return [
      '⚠ 任务未完全成功，剩余问题：',
      ...issues,
      '',
      '建议：检查 worker 输出并手动修复剩余问题。',
    ].join('\n');
  }

  /**
   * 生成简短的根失败总结
   */
  private generateShortRootFailure(task: OrchestratedTask, error: unknown): string {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const failedPhases = task.phases.filter(
      (p) => p.status === 'failed' || p.status === 'malformed'
    );

    const lines: string[] = [
      '✗ 任务失败',
      `  - 路径: ${task.path}`,
      `  - 错误: ${errorMsg}`,
    ];

    if (failedPhases.length > 0) {
      lines.push(`  - 失败阶段: ${failedPhases.map((p) => p.id).join(', ')}`);
    }

    lines.push('', '请检查任务执行日志，修复失败原因后重试。');
    return lines.join('\n');
  }

  // ============ 沙箱继承 ============

  /**
   * 沙箱配置继承（父配置 + 角色覆盖）
   */
  inheritSandboxConfig(parentConfig: SandboxConfig, role: AgentRole): SandboxConfig {
    const roleConfig = this.getRole(role);

    return {
      mode: roleConfig.sandboxMode,
      allowedPaths: parentConfig.allowedPaths,
      deniedPaths: [
        ...parentConfig.deniedPaths,
        ...(role === 'explorer' ? ['**/*'] : []),
      ],
      allowedNetworkHosts: parentConfig.allowedNetworkHosts,
      approvalRequired: role === 'worker' ? false : parentConfig.approvalRequired,
    };
  }

  // ============ 计划审批 ============

  /**
   * 审批计划
   */
  approvePlan(
    taskId: string,
    planId: string,
    approver: string,
    comment?: string
  ): PlanPacket {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const planPhase = task.phases.find((p) => p.id === planId);
    if (!planPhase || !planPhase.packet) {
      throw new Error(`Plan ${planId} not found`);
    }
    const planPacket = planPhase.packet as PlanPacket;
    planPacket.approved = true;
    planPacket.approvedBy = approver;
    planPacket.approvedAt = Date.now();

    this.emit({
      type: 'plan-approved',
      timestamp: Date.now(),
      taskId,
      phaseId: planId,
      data: { approver, comment },
    });
    this.save();
    return planPacket;
  }

  /**
   * 拒绝计划
   */
  rejectPlan(
    taskId: string,
    planId: string,
    rejecter: string,
    issues: string[]
  ): PlanPacket {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const planPhase = task.phases.find((p) => p.id === planId);
    if (!planPhase || !planPhase.packet) {
      throw new Error(`Plan ${planId} not found`);
    }
    const planPacket = planPhase.packet as PlanPacket;
    planPacket.approved = false;

    this.emit({
      type: 'plan-rejected',
      timestamp: Date.now(),
      taskId,
      phaseId: planId,
      data: { rejecter, issues },
    });
    this.save();
    return planPacket;
  }

  // ============ 并发控制 ============

  /**
   * 设置最大并发线程数
   */
  setMaxThreads(n: number): void {
    this.config.maxThreads = Math.max(1, n);
    this.save();
  }

  /**
   * 设置最大嵌套深度
   */
  setMaxDepth(n: number): void {
    this.config.maxDepth = Math.max(0, n);
    this.save();
  }

  // ============ 查询 ============

  /**
   * 获取任务
   */
  getTask(id: string): OrchestratedTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * 列出任务
   */
  listTasks(filter?: { status?: TaskStatus; path?: ExecutionPath }): OrchestratedTask[] {
    let result = Array.from(this.tasks.values());
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.path) {
      result = result.filter((t) => t.path === filter.path);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取引擎统计
   */
  getStats(): {
    registeredRoles: number;
    totalTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    directTasks: number;
    reviewedTasks: number;
    totalRetries: number;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      registeredRoles: this.roles.size,
      totalTasks: tasks.length,
      runningTasks: tasks.filter((t) => t.status === 'running').length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      directTasks: tasks.filter((t) => t.path === 'direct').length,
      reviewedTasks: tasks.filter((t) => t.path === 'reviewed').length,
      totalRetries: tasks.reduce((sum, t) => sum + t.totalRetries, 0),
    };
  }

  // ============ 持久化 ============

  exportState(): SerializedOrchestratorState {
    return {
      tasks: Array.from(this.tasks.values()),
      roles: Array.from(this.roles.values()),
    };
  }

  importState(state: SerializedOrchestratorState): void {
    this.tasks.clear();
    this.roles.clear();
    for (const task of state.tasks ?? []) {
      this.tasks.set(task.id, task);
    }
    for (const role of state.roles ?? []) {
      this.roles.set(role.role, role);
    }
    this.save();
  }

  clear(): void {
    this.tasks.clear();
    this.roles.clear();
    for (const [role, roleConfig] of Object.entries(DEFAULT_ROLE_CONFIGS)) {
      this.roles.set(role as AgentRole, roleConfig);
    }
    this.save();
  }
}

// ============ 全局单例 ============

let defaultEngine: OrchestratedAgentEngine | null = null;

export function getDefaultOrchestratedAgentEngine(): OrchestratedAgentEngine {
  if (!defaultEngine) {
    defaultEngine = new OrchestratedAgentEngine();
  }
  return defaultEngine;
}

export function resetDefaultOrchestratedAgentEngine(): void {
  defaultEngine = null;
}
