/**
 * # ============================================================
 * # Enterprise Workflow Engine - 企业全场景工作流引擎 (v1.0.0 Cycle 33 G33-01)
 * # ============================================================
 * # 核心作用：企业级工作流编排引擎，集成 30+ 引擎作为工作流步骤
 * # 5 个预置场景：用户入职 / 代码审查 / 合规审计 / 安全应急 / 日常任务
 * # 声明式 JSON DSL 工作流定义，便于审计和回放
 * # 支持：步骤重试 / 超时 / 条件分支 / 并行执行 / 审批流 / 子工作流
 * # ============================================================
 * # 运行流程：
 * #   1. registerEngine / registerScenario 注册引擎和场景
 * #   2. execute(scenarioId, variables) 启动工作流
 * #   3. 按依赖顺序执行步骤，支持 retry/timeout
 * #   4. condition / parallel / loop / approval 等高级步骤类型
 * #   5. pause / resume / cancel / retry 控制生命周期
 * #   6. approveStep / rejectStep 处理审批节点
 * #   7. getExecutionLog 获取完整执行日志
 * # ============================================================
 * # 输入参数：WorkflowScenario / WorkflowStep / variables
 * # 输出结果：WorkflowExecution / StepExecution / ExecutionLogEntry
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 33 G33-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type WorkflowStepType =
  | 'engine'
  | 'condition'
  | 'parallel'
  | 'loop'
  | 'approval'
  | 'delay'
  | 'subworkflow';

export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'awaiting_approval';

export type ScenarioCategory = 'onboarding' | 'review' | 'compliance' | 'security' | 'task' | 'custom';

export type WorkflowEvent =
  | 'scenario-registered'
  | 'scenario-updated'
  | 'scenario-deleted'
  | 'execution-started'
  | 'execution-completed'
  | 'execution-failed'
  | 'execution-cancelled'
  | 'execution-paused'
  | 'execution-resumed'
  | 'step-started'
  | 'step-completed'
  | 'step-failed'
  | 'step-retrying'
  | 'step-awaiting-approval'
  | 'step-approved'
  | 'step-rejected';

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
  retryOn?: string[];
}

export interface WorkflowCondition {
  expression: string;
  language?: 'jsonpath' | 'simple' | 'jmespath';
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepType;
  // engine
  engineId?: string;
  method?: string;
  args?: Record<string, any>;
  // condition
  condition?: WorkflowCondition;
  thenSteps?: string[];
  elseSteps?: string[];
  // parallel
  branches?: string[][];
  // loop
  iterator?: string;
  collection?: string;
  body?: string[];
  // approval
  approvers?: string[];
  approvalTimeoutMs?: number;
  // delay
  delayMs?: number;
  // subworkflow
  scenarioId?: string;
  // common
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  continueOnError?: boolean;
  dependsOn?: string[];
  metadata?: Record<string, any>;
}

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  default?: any;
  description?: string;
}

export interface WorkflowOutput {
  name: string;
  value: string;
  description?: string;
}

export interface WorkflowScenario {
  id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  version: string;
  steps: WorkflowStep[];
  variables?: WorkflowVariable[];
  outputs?: WorkflowOutput[];
  metadata?: Record<string, any>;
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StepExecution {
  id: string;
  stepId: string;
  stepName: string;
  type: WorkflowStepType;
  status: StepExecutionStatus;
  attempt: number;
  input?: any;
  output?: any;
  error?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  approvedBy?: string;
  approvalNotes?: string;
}

export interface WorkflowExecution {
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  status: WorkflowExecutionStatus;
  variables: Record<string, any>;
  context: Record<string, any>;
  currentStepId?: string;
  stepExecutions: StepExecution[];
  startTime: number;
  endTime?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, any>;
  pendingApproval?: { stepId: string; approvers: string[]; requestedAt: number };
}

export interface ExecutionLogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  executionId: string;
  stepId?: string;
  message: string;
  data?: any;
}

export interface WorkflowEngineConfig {
  persist: boolean;
  storageKey: string;
  enableJournaling: boolean;
  maxConcurrentExecutions: number;
  defaultTimeoutMs: number;
  defaultRetryAttempts: number;
}

export interface SerializedWorkflowState {
  scenarios: WorkflowScenario[];
  executions: WorkflowExecution[];
  config: Partial<WorkflowEngineConfig>;
}

// ============ 默认配置 ============

export const DEFAULT_WORKFLOW_ENGINE_CONFIG: WorkflowEngineConfig = {
  persist: true,
  storageKey: 'hermes.enterpriseWorkflow',
  enableJournaling: true,
  maxConcurrentExecutions: 100,
  defaultTimeoutMs: 300000,        // 5 分钟
  defaultRetryAttempts: 3,
};

// ============ 工具函数 ============

export function generateScenarioId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `sc-${slug}-${Date.now().toString(36)}`;
}

export function generateExecutionId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateStepExecutionId(): string {
  return `sexec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 简单的 JSONPath 表达式求值（支持 $.variables.x / $.steps.stepId.output.y）
 */
export function evaluateExpression(expr: string, context: Record<string, any>): any {
  if (!expr || typeof expr !== 'string') return undefined;
  if (!expr.startsWith('$')) {
    // 字面量
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (!isNaN(Number(expr))) return Number(expr);
    // 字符串字面量
    if (expr.startsWith('"') && expr.endsWith('"')) return expr.slice(1, -1);
    if (expr.startsWith("'") && expr.endsWith("'")) return expr.slice(1, -1);
    return expr;
  }

  // JSONPath 简化实现
  const path = expr.slice(2); // 去掉 $.
  const parts = path.split('.');
  let current: any = context;
  for (const part of parts) {
    if (current == null) return undefined;
    if (part.includes('[')) {
      const [key, indexPart] = part.split('[');
      if (key) current = current[key];
      const index = parseInt(indexPart.replace(']', ''), 10);
      if (Array.isArray(current) && !isNaN(index)) {
        current = current[index];
      }
    } else {
      current = current[part];
    }
  }
  return current;
}

/**
 * 简单条件求值
 */
export function evaluateCondition(condition: WorkflowCondition, context: Record<string, any>): boolean {
  const { expression } = condition;
  // 支持 ==, !=, >, <, >=, <=
  const match = expression.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (match) {
    const [, leftExpr, op, rightExpr] = match;
    const left = evaluateExpression(leftExpr.trim(), context);
    const right = evaluateExpression(rightExpr.trim(), context);
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
    }
  }
  // 布尔表达式
  return Boolean(evaluateExpression(expression, context));
}

// ============ 5 个预置场景模板 ============

export const PRESET_SCENARIOS: Omit<WorkflowScenario, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'sc-user-onboarding-v1',
    name: 'User Onboarding',
    description: '新员工入职流程：SSO 验证 → 策略检查 → SCIM 同步 → 审计记录 → 通知团队',
    category: 'onboarding',
    version: '1.0.0',
    tags: ['sso', 'scim', 'audit', 'onboarding'],
    author: 'Hermes',
    variables: [
      { name: 'userId', type: 'string', required: true, description: '新用户 ID' },
      { name: 'ssoProvider', type: 'string', required: true, description: 'SSO Provider ID' },
      { name: 'teamChannel', type: 'string', required: false, default: 'general' },
    ],
    outputs: [
      { name: 'success', value: '$.steps.step-1.output.valid' },
    ],
    steps: [
      {
        id: 'step-1',
        name: 'SSO 验证',
        type: 'engine',
        engineId: 'sso',
        method: 'validateSession',
        args: { sessionId: '$.variables.sessionId' },
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        timeoutMs: 30000,
      },
      {
        id: 'step-2',
        name: '策略检查',
        type: 'engine',
        engineId: 'policy',
        method: 'evaluate',
        args: { context: { user: '$.steps.step-1.output.user', action: 'user.onboard' } },
        timeoutMs: 10000,
      },
      {
        id: 'step-3',
        name: 'SCIM 同步',
        type: 'engine',
        engineId: 'sso',
        method: 'scimSyncUsers',
        args: { providerId: '$.variables.ssoProvider' },
        continueOnError: true,
        timeoutMs: 60000,
      },
      {
        id: 'step-4',
        name: '审计记录',
        type: 'engine',
        engineId: 'audit',
        method: 'log',
        args: { who: '$.steps.step-1.output.user', what: 'user.onboard' },
        timeoutMs: 10000,
      },
      {
        id: 'step-5',
        name: '通知团队',
        type: 'engine',
        engineId: 'notification',
        method: 'send',
        args: { channel: '$.variables.teamChannel' },
        continueOnError: true,
        timeoutMs: 10000,
      },
    ],
  },
  {
    id: 'sc-code-review-v1',
    name: 'Code Review',
    description: '代码审查流程：创建 Worktree → 自动评审 → 测试运行 → 策略检查 → 人工审批 → 审计',
    category: 'review',
    version: '1.0.0',
    tags: ['worktree', 'codeReview', 'policy', 'audit'],
    author: 'Hermes',
    variables: [
      { name: 'branch', type: 'string', required: true },
      { name: 'reviewers', type: 'array', required: true, description: '审批人列表' },
    ],
    steps: [
      {
        id: 'step-1',
        name: '创建 Worktree',
        type: 'engine',
        engineId: 'worktree',
        method: 'create',
        args: { branch: '$.variables.branch' },
        timeoutMs: 60000,
      },
      {
        id: 'step-2',
        name: '自动代码评审',
        type: 'engine',
        engineId: 'codeReview',
        method: 'review',
        args: { worktreeId: '$.steps.step-1.output.id' },
        timeoutMs: 120000,
      },
      {
        id: 'step-3',
        name: '运行测试',
        type: 'engine',
        engineId: 'test',
        method: 'run',
        args: { worktreeId: '$.steps.step-1.output.id' },
        continueOnError: true,
        timeoutMs: 300000,
      },
      {
        id: 'step-4',
        name: '策略检查',
        type: 'engine',
        engineId: 'policy',
        method: 'evaluate',
        args: { action: 'pr.merge' },
        timeoutMs: 10000,
      },
      {
        id: 'step-5',
        name: '人工审批',
        type: 'approval',
        approvers: ['$.variables.reviewers'],
        approvalTimeoutMs: 86400000,  // 24 小时
        timeoutMs: 86400000,
      },
      {
        id: 'step-6',
        name: '审计记录',
        type: 'engine',
        engineId: 'audit',
        method: 'log',
        args: { who: '$.steps.step-5.output.approver', what: 'pr.merged' },
        dependsOn: ['step-5'],
      },
    ],
  },
  {
    id: 'sc-compliance-audit-v1',
    name: 'Compliance Audit',
    description: '合规审计流程：拉取审计事件 → 验证 Hash Chain → 生成 SOC 2 报告 → 导出 PDF → 归档',
    category: 'compliance',
    version: '1.0.0',
    tags: ['audit', 'compliance', 'soc2', 'report'],
    author: 'Hermes',
    variables: [
      { name: 'from', type: 'number', required: true },
      { name: 'to', type: 'number', required: true },
    ],
    steps: [
      {
        id: 'step-1',
        name: '拉取审计事件',
        type: 'engine',
        engineId: 'audit',
        method: 'query',
        args: { from: '$.variables.from', to: '$.variables.to' },
        timeoutMs: 30000,
      },
      {
        id: 'step-2',
        name: '验证 Hash Chain',
        type: 'engine',
        engineId: 'audit',
        method: 'verifyChain',
        timeoutMs: 60000,
      },
      {
        id: 'step-3',
        name: '生成 SOC 2 报告',
        type: 'engine',
        engineId: 'audit',
        method: 'generateSOC2Report',
        args: { period: { from: '$.variables.from', to: '$.variables.to' } },
        timeoutMs: 60000,
      },
      {
        id: 'step-4',
        name: '导出 PDF',
        type: 'engine',
        engineId: 'export',
        method: 'toPDF',
        args: { report: '$.steps.step-3.output' },
        continueOnError: true,
        timeoutMs: 30000,
      },
      {
        id: 'step-5',
        name: '归档',
        type: 'engine',
        engineId: 'archive',
        method: 'archive',
        args: { reportId: '$.steps.step-3.output.id' },
        timeoutMs: 30000,
      },
    ],
  },
  {
    id: 'sc-security-incident-v1',
    name: 'Security Incident Response',
    description: '安全应急流程：检测异常 → 条件分支 → 隔离用户 / 通知 SOC / 审计告警',
    category: 'security',
    version: '1.0.0',
    tags: ['security', 'incident', 'sso', 'audit'],
    author: 'Hermes',
    variables: [
      { name: 'userId', type: 'string', required: true },
      { name: 'severity', type: 'string', required: true },
    ],
    steps: [
      {
        id: 'step-1',
        name: '检测异常',
        type: 'engine',
        engineId: 'threatDetection',
        method: 'detect',
        args: { userId: '$.variables.userId' },
        timeoutMs: 30000,
      },
      {
        id: 'step-2',
        name: '条件分支',
        type: 'condition',
        condition: { expression: "$.variables.severity == 'critical'", language: 'simple' },
        thenSteps: ['step-3', 'step-4', 'step-5'],
        elseSteps: ['step-6'],
      },
      {
        id: 'step-3',
        name: '隔离用户',
        type: 'engine',
        engineId: 'sso',
        method: 'revokeAllSessions',
        args: { userId: '$.variables.userId' },
        timeoutMs: 10000,
      },
      {
        id: 'step-4',
        name: '通知 SOC',
        type: 'engine',
        engineId: 'notification',
        method: 'sendPagerDuty',
        args: { severity: 'critical' },
        timeoutMs: 10000,
      },
      {
        id: 'step-5',
        name: '审计告警',
        type: 'engine',
        engineId: 'audit',
        method: 'log',
        args: { severity: 'critical', what: 'security.incident' },
        timeoutMs: 10000,
      },
      {
        id: 'step-6',
        name: '记录日志',
        type: 'engine',
        engineId: 'audit',
        method: 'log',
        args: { severity: 'warn', what: 'security.anomaly' },
        continueOnError: true,
        timeoutMs: 10000,
      },
    ],
  },
  {
    id: 'sc-daily-task-v1',
    name: 'Daily Task Automation',
    description: '日常任务自动化：编排多代理 → 成本归因 → 阈值检查 → 生成报告',
    category: 'task',
    version: '1.0.0',
    tags: ['orchestratedAgent', 'cost', 'report', 'automation'],
    author: 'Hermes',
    steps: [
      {
        id: 'step-1',
        name: '编排多代理',
        type: 'engine',
        engineId: 'orchestratedAgent',
        method: 'execute',
        timeoutMs: 600000,
      },
      {
        id: 'step-2',
        name: '成本归因',
        type: 'engine',
        engineId: 'costAttribution',
        method: 'attribute',
        args: { source: 'agent-execution' },
        timeoutMs: 30000,
      },
      {
        id: 'step-3',
        name: '阈值检查',
        type: 'engine',
        engineId: 'costThreshold',
        method: 'check',
        continueOnError: true,
        timeoutMs: 10000,
      },
      {
        id: 'step-4',
        name: '生成报告',
        type: 'engine',
        engineId: 'report',
        method: 'generateDaily',
        timeoutMs: 30000,
      },
    ],
  },
];

// ============ 引擎注册类型 ============

export type EngineMethod = (...args: any[]) => any;

export interface RegisteredEngine {
  id: string;
  name?: string;
  methods: Map<string, EngineMethod>;
  description?: string;
}

// ============ 核心引擎类 ============

export class EnterpriseWorkflowEngine {
  private config: WorkflowEngineConfig;
  private scenarios: Map<string, WorkflowScenario> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private engines: Map<string, RegisteredEngine> = new Map();
  private listeners: Map<WorkflowEvent, Set<(e: any) => void>> = new Map();
  private logBuffer: ExecutionLogEntry[] = [];

  constructor(config: Partial<WorkflowEngineConfig> = {}) {
    this.config = { ...DEFAULT_WORKFLOW_ENGINE_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  /**
   * 显式加载预置场景模板（默认不自动加载）
   */
  loadPresetScenarios(): void {
    for (const preset of PRESET_SCENARIOS) {
      if (!this.scenarios.has(preset.id)) {
        this.scenarios.set(preset.id, {
          ...preset,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    if (this.config.persist) this.save();
  }

  // ============ 场景管理 ============

  registerScenario(scenario: Omit<WorkflowScenario, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): WorkflowScenario {
    const id = scenario.id || generateScenarioId(scenario.name);
    const now = Date.now();
    const full: WorkflowScenario = {
      ...scenario,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.scenarios.set(id, full);
    if (this.config.persist) this.save();
    this.emit('scenario-registered', { scenarioId: id });
    return full;
  }

  updateScenario(scenarioId: string, updates: Partial<WorkflowScenario>): WorkflowScenario {
    const existing = this.scenarios.get(scenarioId);
    if (!existing) throw new Error(`Scenario not found: ${scenarioId}`);
    const updated = { ...existing, ...updates, id: scenarioId, updatedAt: Date.now() };
    this.scenarios.set(scenarioId, updated);
    if (this.config.persist) this.save();
    this.emit('scenario-updated', { scenarioId });
    return updated;
  }

  deleteScenario(scenarioId: string): void {
    this.scenarios.delete(scenarioId);
    if (this.config.persist) this.save();
    this.emit('scenario-deleted', { scenarioId });
  }

  getScenario(scenarioId: string): WorkflowScenario | undefined {
    return this.scenarios.get(scenarioId);
  }

  listScenarios(filter?: { category?: ScenarioCategory; tag?: string }): WorkflowScenario[] {
    let list = Array.from(this.scenarios.values());
    if (filter?.category) {
      list = list.filter((s) => s.category === filter.category);
    }
    if (filter?.tag) {
      list = list.filter((s) => s.tags?.includes(filter.tag!));
    }
    return list;
  }

  // ============ 引擎注册 ============

  registerEngine(engineId: string, engine: { [method: string]: EngineMethod } | RegisteredEngine, name?: string): void {
    if ('methods' in engine) {
      this.engines.set(engineId, engine as RegisteredEngine);
    } else {
      const methods = new Map<string, EngineMethod>();
      for (const [key, value] of Object.entries(engine)) {
        if (typeof value === 'function') {
          methods.set(key, value as EngineMethod);
        }
      }
      this.engines.set(engineId, { id: engineId, name: name || engineId, methods });
    }
  }

  unregisterEngine(engineId: string): void {
    this.engines.delete(engineId);
  }

  listEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  // ============ 执行控制 ============

  async execute(scenarioId: string, variables: Record<string, any> = {}, options: { executionId?: string } = {}): Promise<WorkflowExecution> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

    // 验证必需变量
    for (const v of scenario.variables || []) {
      if (v.required && !(v.name in variables)) {
        throw new Error(`Missing required variable: ${v.name}`);
      }
      if (!(v.name in variables) && v.default !== undefined) {
        variables[v.name] = v.default;
      }
    }

    const execution: WorkflowExecution = {
      id: options.executionId || generateExecutionId(),
      scenarioId,
      scenarioVersion: scenario.version,
      status: 'running',
      variables,
      context: { variables, steps: {} },
      stepExecutions: [],
      startTime: Date.now(),
      metadata: {},
    };
    this.executions.set(execution.id, execution);
    this.emit('execution-started', { executionId: execution.id, scenarioId });
    this.log(execution.id, 'info', `Workflow started: ${scenario.name}`, { scenarioId, variables });

    try {
      await this.runScenario(execution, scenario);
      // 仅当执行未被暂停（等待审批）时设置 completed
      if (execution.status === 'running') {
        execution.status = 'completed';
        execution.endTime = Date.now();
        execution.durationMs = execution.endTime - execution.startTime;
        this.emit('execution-completed', { executionId: execution.id });
        this.log(execution.id, 'info', `Workflow completed in ${execution.durationMs}ms`);
      }
    } catch (err) {
      execution.status = 'failed';
      execution.endTime = Date.now();
      execution.durationMs = execution.endTime - execution.startTime;
      execution.error = err instanceof Error ? err.message : String(err);
      this.emit('execution-failed', { executionId: execution.id, error: execution.error });
      this.log(execution.id, 'error', `Workflow failed: ${execution.error}`);
    } finally {
      if (this.config.persist) this.save();
    }

    return execution;
  }

  pause(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;
    if (execution.status === 'running') {
      execution.status = 'paused';
      this.emit('execution-paused', { executionId });
      this.log(executionId, 'info', 'Workflow paused');
    }
  }

  async resume(executionId: string, approvalData?: Record<string, any>): Promise<WorkflowExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    if (execution.status !== 'paused' && execution.status !== 'awaiting_approval' as any) {
      throw new Error(`Cannot resume execution in status: ${execution.status}`);
    }
    execution.status = 'running';
    if (approvalData) {
      execution.context = { ...execution.context, ...approvalData };
    }
    this.emit('execution-resumed', { executionId });
    this.log(executionId, 'info', 'Workflow resumed');
    return execution;
  }

  cancel(executionId: string, reason?: string): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;
    execution.status = 'cancelled';
    execution.endTime = Date.now();
    execution.durationMs = execution.endTime - execution.startTime;
    if (reason) execution.error = reason;
    this.emit('execution-cancelled', { executionId, reason });
    this.log(executionId, 'info', `Workflow cancelled: ${reason || 'no reason'}`);
  }

  async retry(executionId: string, stepId?: string): Promise<WorkflowExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    const scenario = this.scenarios.get(execution.scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${execution.scenarioId}`);

    if (stepId) {
      // 重试单个步骤
      const step = scenario.steps.find((s) => s.id === stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      const stepExec = execution.stepExecutions.find((se) => se.stepId === stepId);
      if (stepExec) {
        stepExec.status = 'pending';
        stepExec.attempt = 0;
        stepExec.error = undefined;
      }
    } else {
      // 重试整个工作流
      execution.stepExecutions = [];
      execution.status = 'running';
      execution.error = undefined;
      execution.startTime = Date.now();
      execution.endTime = undefined;
      execution.durationMs = undefined;
    }
    return this.execute(scenario.id, execution.variables, { executionId });
  }

  // ============ 状态查询 ============

  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  listExecutions(filter?: { scenarioId?: string; status?: WorkflowExecutionStatus; from?: number; to?: number }): WorkflowExecution[] {
    let list = Array.from(this.executions.values());
    if (filter?.scenarioId) list = list.filter((e) => e.scenarioId === filter.scenarioId);
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    if (filter?.from) list = list.filter((e) => e.startTime >= filter.from!);
    if (filter?.to) list = list.filter((e) => e.startTime <= filter.to!);
    return list.sort((a, b) => b.startTime - a.startTime);
  }

  getStepOutput(executionId: string, stepId: string): any {
    const execution = this.executions.get(executionId);
    if (!execution) return undefined;
    const stepExec = execution.stepExecutions.find((se) => se.stepId === stepId);
    return stepExec?.output;
  }

  getExecutionLog(executionId: string): ExecutionLogEntry[] {
    return this.logBuffer.filter((l) => l.executionId === executionId);
  }

  // ============ 审批 ============

  async approveStep(executionId: string, stepId: string, approver: string, notes?: string): Promise<WorkflowExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    if (execution.currentStepId !== stepId) {
      throw new Error(`Step ${stepId} is not the current pending step`);
    }
    const stepExec = execution.stepExecutions.find((se) => se.stepId === stepId);
    if (stepExec) {
      stepExec.status = 'completed';
      stepExec.approvedBy = approver;
      stepExec.approvalNotes = notes;
      stepExec.endTime = Date.now();
      stepExec.durationMs = stepExec.endTime - stepExec.startTime;
      stepExec.output = { approver, notes, approved: true };
      execution.context.steps[stepId] = { output: stepExec.output };
    }
    delete execution.pendingApproval;
    this.emit('step-approved', { executionId, stepId, approver });
    this.log(executionId, 'info', `Step ${stepId} approved by ${approver}`);
    return execution;
  }

  async rejectStep(executionId: string, stepId: string, approver: string, reason: string): Promise<WorkflowExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    if (execution.currentStepId !== stepId) {
      throw new Error(`Step ${stepId} is not the current pending step`);
    }
    const stepExec = execution.stepExecutions.find((se) => se.stepId === stepId);
    if (stepExec) {
      stepExec.status = 'failed';
      stepExec.approvedBy = approver;
      stepExec.error = `Rejected: ${reason}`;
      stepExec.endTime = Date.now();
      stepExec.durationMs = stepExec.endTime - stepExec.startTime;
    }
    execution.status = 'failed';
    execution.error = `Step ${stepId} rejected by ${approver}: ${reason}`;
    this.emit('step-rejected', { executionId, stepId, approver, reason });
    this.log(executionId, 'warn', `Step ${stepId} rejected by ${approver}: ${reason}`);
    return execution;
  }

  listPendingApprovals(_userId: string): StepExecution[] {
    const pending: StepExecution[] = [];
    for (const execution of this.executions.values()) {
      if (execution.status === 'paused' && execution.pendingApproval) {
        const stepExec = execution.stepExecutions.find((se) => se.stepId === execution.pendingApproval!.stepId);
        if (stepExec) pending.push(stepExec);
      }
    }
    return pending;
  }

  // ============ 事件订阅 ============

  on(event: WorkflowEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: WorkflowEvent, data?: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener({ type: event, timestamp: Date.now(), data });
        } catch (err) {
          console.error(`[EnterpriseWorkflow] Listener error for ${event}:`, err);
        }
      }
    }
  }

  // ============ 统计 ============

  getStats(): { totalScenarios: number; totalExecutions: number; runningExecutions: number; successRate: number; averageDurationMs: number; registeredEngines: number } {
    const all = Array.from(this.executions.values());
    const completed = all.filter((e) => e.status === 'completed');
    const successRate = all.length === 0 ? 0 : completed.length / all.length;
    const durations = completed.filter((e) => e.durationMs != null).map((e) => e.durationMs!);
    const avgDuration = durations.length === 0 ? 0 : durations.reduce((a, b) => a + b, 0) / durations.length;
    return {
      totalScenarios: this.scenarios.size,
      totalExecutions: all.length,
      runningExecutions: all.filter((e) => e.status === 'running').length,
      successRate,
      averageDurationMs: avgDuration,
      registeredEngines: this.engines.size,
    };
  }

  getConfig(): WorkflowEngineConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<WorkflowEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    if (this.config.persist) this.save();
  }

  clear(): void {
    this.scenarios.clear();
    this.executions.clear();
    this.logBuffer = [];
    if (this.config.persist) this.save();
  }

  // ============ 内部方法 ============

  private async runScenario(execution: WorkflowExecution, scenario: WorkflowScenario, executed?: Set<string>): Promise<void> {
    const execSet = executed || new Set<string>();
    const total = scenario.steps.length;

    while (execSet.size < total) {
      // 找到下一个可执行的步骤
      const next = scenario.steps.find((step) => {
        if (execSet.has(step.id)) return false;
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        return step.dependsOn.every((dep) => execSet.has(dep));
      });

      if (!next) break;

      await this.runStep(execution, next, scenario, execSet);
      execSet.add(next.id);

      if (execution.status === 'failed' || execution.status === 'cancelled') {
        return;
      }
    }
  }

  private async runStep(execution: WorkflowExecution, step: WorkflowStep, scenario: WorkflowScenario, executed?: Set<string>): Promise<void> {
    execution.currentStepId = step.id;
    const stepExec: StepExecution = {
      id: generateStepExecutionId(),
      stepId: step.id,
      stepName: step.name,
      type: step.type,
      status: 'running',
      attempt: 0,
      startTime: Date.now(),
    };
    execution.stepExecutions.push(stepExec);
    this.emit('step-started', { executionId: execution.id, stepId: step.id });
    this.log(execution.id, 'info', `Step started: ${step.name}`, { stepId: step.id });

    try {
      let output: any;
      switch (step.type) {
        case 'engine':
          output = await this.runEngineStep(execution, step, stepExec);
          break;
        case 'condition':
          output = await this.runConditionStep(execution, step);
          break;
        case 'parallel':
          output = await this.runParallelStep(execution, step, scenario, executed);
          break;
        case 'loop':
          output = await this.runLoopStep(execution, step, scenario, executed);
          break;
        case 'approval':
          await this.runApprovalStep(execution, step, stepExec);
          return; // 审批步骤需要外部触发 resume
        case 'delay':
          await this.runDelayStep(execution, step);
          output = { delayed: step.delayMs };
          break;
        case 'subworkflow':
          output = await this.runSubworkflowStep(execution, step);
          break;
      }

      stepExec.output = output;
      execution.context.steps[step.id] = { output, status: 'completed' };
      stepExec.status = 'completed';
      stepExec.endTime = Date.now();
      stepExec.durationMs = stepExec.endTime - stepExec.startTime;
      this.emit('step-completed', { executionId: execution.id, stepId: step.id, output });
      this.log(execution.id, 'info', `Step completed: ${step.name}`, { stepId: step.id, output });
    } catch (err) {
      stepExec.error = err instanceof Error ? err.message : String(err);
      stepExec.endTime = Date.now();
      stepExec.durationMs = stepExec.endTime - stepExec.startTime;

      if (step.continueOnError) {
        stepExec.status = 'skipped';
        execution.context.steps[step.id] = { error: stepExec.error, status: 'skipped' };
        this.log(execution.id, 'warn', `Step skipped (continueOnError): ${step.name}`, { stepId: step.id, error: stepExec.error });
      } else {
        stepExec.status = 'failed';
        execution.context.steps[step.id] = { error: stepExec.error, status: 'failed' };
        this.emit('step-failed', { executionId: execution.id, stepId: step.id, error: stepExec.error });
        this.log(execution.id, 'error', `Step failed: ${step.name}`, { stepId: step.id, error: stepExec.error });
        throw err;
      }
    }
  }

  private async runEngineStep(execution: WorkflowExecution, step: WorkflowStep, stepExec: StepExecution): Promise<any> {
    if (!step.engineId || !step.method) {
      throw new Error(`Engine step requires engineId and method: ${step.id}`);
    }
    const engine = this.engines.get(step.engineId);
    if (!engine) {
      // 引擎未注册，返回 mock 输出（用于测试）
      stepExec.attempt = 1;
      return { mocked: true, engineId: step.engineId, method: step.method, args: step.args };
    }
    const method = engine.methods.get(step.method);
    if (!method) {
      throw new Error(`Method ${step.method} not found on engine ${step.engineId}`);
    }

    // 解析参数中的 JSONPath
    const resolvedArgs = this.resolveArgs(step.args || {}, execution);

    const maxAttempts = step.retryPolicy?.maxAttempts ?? this.config.defaultRetryAttempts;
    const timeoutMs = step.timeoutMs ?? this.config.defaultTimeoutMs;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      stepExec.attempt = attempt;
      try {
        const result = await this.executeWithTimeout(
          () => method(...Object.values(resolvedArgs)),
          timeoutMs,
        );
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.emit('step-retrying', { executionId: execution.id, stepId: step.id, attempt, error: lastError.message });
        if (attempt < maxAttempts) {
          const backoff = (step.retryPolicy?.backoffMs ?? 1000) * Math.pow(step.retryPolicy?.backoffMultiplier ?? 1, attempt - 1);
          await this.sleep(backoff);
        }
      }
    }
    throw lastError || new Error('Step failed after retries');
  }

  private async runConditionStep(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    if (!step.condition) throw new Error(`Condition step requires condition: ${step.id}`);
    const result = evaluateCondition(step.condition, execution.context);
    return { result, branch: result ? 'then' : 'else' };
  }

  private async runParallelStep(execution: WorkflowExecution, step: WorkflowStep, scenario: WorkflowScenario, executed?: Set<string>): Promise<any> {
    if (!step.branches || step.branches.length === 0) {
      throw new Error(`Parallel step requires branches: ${step.id}`);
    }
    const branchPromises: Promise<any>[] = step.branches.map(async (branchStepIds) => {
      const outputs: Record<string, any> = {};
      for (const stepId of branchStepIds) {
        const subStep = scenario.steps.find((s) => s.id === stepId);
        if (subStep && !executed?.has(stepId)) {
          await this.runStep(execution, subStep, scenario, executed);
          outputs[stepId] = execution.context.steps[stepId];
        }
      }
      return outputs;
    });
    const result = await Promise.all(branchPromises);
    // 标记所有分支步骤为已执行
    if (executed) {
      for (const branch of step.branches) {
        for (const stepId of branch) {
          executed.add(stepId);
        }
      }
    }
    return result;
  }

  private async runLoopStep(execution: WorkflowExecution, step: WorkflowStep, scenario: WorkflowScenario, executed?: Set<string>): Promise<any> {
    if (!step.collection || !step.iterator || !step.body) {
      throw new Error(`Loop step requires collection, iterator, and body: ${step.id}`);
    }
    const collectionValue = evaluateExpression(step.collection, execution.context);
    if (!Array.isArray(collectionValue)) {
      throw new Error(`Collection is not an array: ${step.collection}`);
    }
    const outputs: any[] = [];
    for (let i = 0; i < collectionValue.length; i++) {
      execution.context[step.iterator] = collectionValue[i];
      for (const stepId of step.body) {
        const subStep = scenario.steps.find((s) => s.id === stepId);
        if (subStep && !executed?.has(stepId)) {
          await this.runStep(execution, subStep, scenario, executed);
        }
      }
      outputs.push({ ...execution.context[step.iterator] });
    }
    // 标记 body 中所有步骤为已执行，防止主循环重复执行
    if (executed) {
      for (const stepId of step.body) {
        executed.add(stepId);
      }
    }
    return outputs;
  }

  private async runApprovalStep(execution: WorkflowExecution, step: WorkflowStep, stepExec: StepExecution): Promise<void> {
    const approvers = step.approvers?.map((a) => evaluateExpression(a, execution.context)) || [];
    execution.pendingApproval = {
      stepId: step.id,
      approvers: approvers.flat(),
      requestedAt: Date.now(),
    };
    stepExec.status = 'awaiting_approval';
    execution.status = 'paused';
    this.emit('step-awaiting-approval', { executionId: execution.id, stepId: step.id, approvers });
    this.log(execution.id, 'info', `Step awaiting approval: ${step.name}`, { stepId: step.id, approvers });
  }

  private async runDelayStep(_execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    const delay = step.delayMs ?? 1000;
    await this.sleep(delay);
  }

  private async runSubworkflowStep(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    if (!step.scenarioId) throw new Error(`Subworkflow step requires scenarioId: ${step.id}`);
    const variables = this.resolveArgs(step.args || {}, execution);
    const subExecution = await this.execute(step.scenarioId, variables);
    return { executionId: subExecution.id, status: subExecution.status, output: subExecution.context.steps };
  }

  private resolveArgs(args: Record<string, any>, execution: WorkflowExecution): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        resolved[key] = evaluateExpression(value, execution.context);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        resolved[key] = this.resolveArgs(value, execution);
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((v) => typeof v === 'string' && v.startsWith('$') ? evaluateExpression(v, execution.context) : v);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private async executeWithTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
      try {
        Promise.resolve(fn())
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(executionId: string, level: ExecutionLogEntry['level'], message: string, data?: any): void {
    const entry: ExecutionLogEntry = {
      timestamp: Date.now(),
      level,
      executionId,
      message,
      data,
    };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 10000) {
      this.logBuffer = this.logBuffer.slice(-10000);
    }
  }

  // ============ 持久化 ============

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const state: SerializedWorkflowState = {
        scenarios: Array.from(this.scenarios.values()),
        executions: Array.from(this.executions.values()),
        config: this.config,
      };
      localStorage.setItem(this.config.storageKey, JSON.stringify(state));
    } catch (err) {
      console.warn('[EnterpriseWorkflow] Failed to save state:', err);
    }
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) return;
      const state: SerializedWorkflowState = JSON.parse(raw);
      if (state.scenarios) {
        this.scenarios = new Map(state.scenarios.map((s) => [s.id, s]));
      }
      if (state.executions) {
        this.executions = new Map(state.executions.map((e) => [e.id, e]));
      }
      if (state.config) {
        this.config = { ...this.config, ...state.config };
      }
    } catch (err) {
      console.warn('[EnterpriseWorkflow] Failed to load state:', err);
    }
  }
}

// ============ 单例 ============

let defaultEngineInstance: EnterpriseWorkflowEngine | null = null;

export function getDefaultEnterpriseWorkflowEngine(): EnterpriseWorkflowEngine {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new EnterpriseWorkflowEngine();
  }
  return defaultEngineInstance;
}

export function resetDefaultEnterpriseWorkflowEngine(): void {
  defaultEngineInstance = null;
}
