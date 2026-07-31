# G30-03: Orchestrated Multi-Agent Engine (编排多代理引擎)

**任务编号**: G30-03
**周期**: Cycle 30
**版本**: v6.85.0
**日期**: 2026-07-30
**重要性**: P0（多代理团队协作核心能力）
**参考**: [Codex Orchestrated Mode PoC #32100](https://github.com/openai/codex/issues/32100) + [Codex Subagents](https://developers.openai.com/codex/subagents)

---

## 一、需求背景

### 1.1 业务问题

Hermes 已有 `NestedSubAgentEngine`（Cycle 27 G27-01）支持 3 层嵌套子代理，但缺少：

- **6 阶段 Orchestrated Mode**：参考 Codex Orchestrated 模式（User turn → Task Contract → Direct/Reviewed execution → Root completion/synthesis）
- **Worker/Explorer/Reviewer 角色预设**：当前所有 agent 通用
- **Phase Contract 验证**：每个阶段有 input/output 契约校验
- **Retry Budget 跟踪**：每个子阶段有最大重试次数
- **Read-only Explorer 强制**：当前 explorer 角色可写文件
- **Packet 验证**：Worker 提交的 packet 需验证完整性
- **沙箱配置继承链**：subagent 继承父会话的 sandbox + 角色覆盖
- **Root Synthesis 策略**：智能合成而非简单拼接

### 1.2 目标

1. **6 阶段 Orchestrated Mode**：完整实现 Codex PoC 的双路径执行模型
2. **4 个角色预设**：Orchestrator / Worker / Explorer / Reviewer / Synthesizer
3. **Phase Contract 验证**：每个 phase 输出必须满足契约，否则标记 malformed
4. **Retry Budget**：每个 phase 有 maxRetries，超限触发 Short root failure
5. **强制 Read-only Explorer**：explorer 角色只能读，写操作直接拒绝
6. **Packet 验证**：检测 truncated / malformed packet 并重试 Worker
7. **沙箱继承链**：父配置 + 角色覆盖 = 实际配置
8. **Root Synthesis 智能策略**：检测完整 worker packet → 简短总结；不完整则列出剩余问题

---

## 二、数据模型

### 2.1 类型定义

```typescript
// 代理角色
export type AgentRole =
  | 'orchestrator'   // 根编排
  | 'worker'         // 干活型（可写）
  | 'explorer'       // 读代码型（强制只读）
  | 'reviewer'       // 审查型
  | 'synthesizer';   // 合成型

// 执行路径
export type ExecutionPath = 'direct' | 'reviewed';

// 阶段状态
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retrying'
  | 'malformed';     // Packet 格式错误

// 任务状态
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

// 沙箱模式
export type SandboxMode = 'read-only' | 'workspace-write' | 'full';

// 隔离策略
export type IsolationMode = 'thread' | 'worktree';

// Phase 契约
export interface PhaseContract {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  validateInput?: (input: unknown) => { valid: boolean; errors?: string[] };
  validateOutput?: (output: unknown) => { valid: boolean; errors?: string[] };
}

// 任务契约
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

// Worker Packet
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

// Plan Packet
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

// 阶段定义
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
  packet?: WorkerPacket | PlanPacket | ReviewPacket;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

// Review Packet
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

// 沙箱配置
export interface SandboxConfig {
  mode: SandboxMode;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedNetworkHosts: string[];
  approvalRequired: boolean;
}

// 角色配置
export interface AgentRoleConfig {
  role: AgentRole;
  sandboxMode: SandboxMode;
  allowedTools: string[];
  model: string;
  systemPrompt: string;
  isolation: IsolationMode;
  description: string;
}

// 编排任务
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

// 编排选项
export interface OrchestrateOptions {
  forcePath?: ExecutionPath;
  maxRetriesPerPhase?: number;
  model?: string;
  autoApprovePlan?: boolean;
  skipExplorer?: boolean;
}

// 引擎事件
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
```

### 2.2 默认角色配置

```typescript
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
    systemPrompt: '你是 Worker，负责实现和修复。',
    isolation: 'worktree',
    description: '干活型',
  },
  explorer: {
    role: 'explorer',
    sandboxMode: 'read-only',
    allowedTools: ['read', 'grep', 'search'],
    model: 'claude-haiku-5',
    systemPrompt: '你是 Explorer，负责只读探索。',
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
```

---

## 三、核心 API

### 3.1 OrchestratedAgentEngine 类

```typescript
export class OrchestratedAgentEngine {
  constructor(config?: Partial<OrchestratorConfig>);
  
  // ========== 角色管理 ==========
  
  /**
   * 注册角色配置
   */
  registerRole(config: AgentRoleConfig): void;
  
  /**
   * 获取角色配置
   */
  getRole(role: AgentRole): AgentRoleConfig;
  
  /**
   * 列出所有角色
   */
  listRoles(): AgentRole[];
  
  /**
   * 重置为默认角色
   */
  resetRoles(): void;
  
  // ========== 任务编排 ==========
  
  /**
   * 编排一个用户回合（异步）
   */
  async orchestrate(
    userTurn: string,
    options?: OrchestrateOptions
  ): Promise<OrchestratedTask>;
  
  /**
   * 同步编排（仅构建任务，不执行）
   */
  buildTask(userTurn: string, options?: OrchestrateOptions): OrchestratedTask;
  
  // ========== 路径选择 ==========
  
  /**
   * 选择执行路径（直接 vs 审查）
   */
  selectPath(criteria: {
    scopeNarrowness: number;       // 0-1，越窄越倾向 direct
    evidenceAvailable: number;      // 0-1，越多证据越倾向 direct
  }): ExecutionPath;
  
  // ========== 阶段执行 ==========
  
  /**
   * 执行阶段
   */
  async executePhase(
    taskId: string,
    phaseId: string,
    input: unknown
  ): Promise<PhaseResult>;
  
  /**
   * 验证阶段输出
   */
  validatePhaseOutput(
    phase: OrchestratedPhase,
    output: unknown
  ): { valid: boolean; errors?: string[] };
  
  /**
   * 验证 Worker Packet
   */
  validateWorkerPacket(packet: WorkerPacket): {
    valid: boolean;
    malformed: boolean;
    truncated: boolean;
    issues: string[];
  };
  
  // ========== Retry Budget ==========
  
  /**
   * 增加重试次数
   */
  incrementRetry(taskId: string, phaseId: string): number;
  
  /**
   * 是否应该触发任务失败（重试用尽）
   */
  shouldFailTask(taskId: string, phaseId: string): boolean;
  
  // ========== Root Synthesis ==========
  
  /**
   * 智能合成 Root 输出
   */
  synthesize(task: OrchestratedTask): string;
  
  // ========== 沙箱继承 ==========
  
  /**
   * 沙箱配置继承（父配置 + 角色覆盖）
   */
  inheritSandboxConfig(
    parentConfig: SandboxConfig,
    role: AgentRole
  ): SandboxConfig;
  
  // ========== 计划审批 ==========
  
  /**
   * 审批计划
   */
  approvePlan(
    taskId: string,
    planId: string,
    approver: string,
    comment?: string
  ): PlanPacket;
  
  /**
   * 拒绝计划
   */
  rejectPlan(
    taskId: string,
    planId: string,
    rejecter: string,
    issues: string[]
  ): PlanPacket;
  
  // ========== 并发控制 ==========
  
  /**
   * 设置最大并发线程数
   */
  setMaxThreads(n: number): void;
  
  /**
   * 设置最大嵌套深度
   */
  setMaxDepth(n: number): void;
  
  // ========== 查询 ==========
  
  /**
   * 获取任务
   */
  getTask(id: string): OrchestratedTask | undefined;
  
  /**
   * 列出任务
   */
  listTasks(filter?: {
    status?: TaskStatus;
    path?: ExecutionPath;
  }): OrchestratedTask[];
  
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
  };
  
  // ========== 事件 ==========
  
  on(event: OrchestratorEventType, listener: (e: OrchestratorEvent) => void): () => void;
  off(event: OrchestratorEventType, listener: (e: OrchestratorEvent) => void): void;
  
  // ========== 持久化 ==========
  
  exportState(): SerializedOrchestratorState;
  importState(state: SerializedOrchestratorState): void;
  clear(): void;
}
```

---

## 四、关键算法

### 4.1 6 阶段 Orchestrated Mode 执行

```typescript
async orchestrate(userTurn: string, options?: OrchestrateOptions): Promise<OrchestratedTask> {
  const task = this.buildTask(userTurn, options);
  
  this.emit({ type: 'task-started', timestamp: Date.now(), taskId: task.id });
  task.status = 'running';
  task.startedAt = Date.now();
  
  try {
    if (task.path === 'direct') {
      await this.executeDirectPath(task);
    } else {
      await this.executeReviewedPath(task);
    }
    
    task.status = 'completed';
    task.completedAt = Date.now();
    task.rootSynthesis = this.synthesize(task);
    
    this.emit({ type: 'task-completed', timestamp: Date.now(), taskId: task.id, data: { synthesis: task.rootSynthesis } });
  } catch (e) {
    task.status = 'failed';
    task.completedAt = Date.now();
    task.rootSynthesis = this.generateShortRootFailure(task, e);
    
    this.emit({ type: 'task-failed', timestamp: Date.now(), taskId: task.id, data: { error: String(e), synthesis: task.rootSynthesis } });
  }
  
  return task;
}

private async executeDirectPath(task: OrchestratedTask): Promise<void> {
  // Direct: Worker → Short root completion
  for (const phase of task.phases.filter(p => p.role === 'worker')) {
    await this.executePhase(task.id, phase.id, this.buildPhaseInput(task, phase));
  }
}

private async executeReviewedPath(task: OrchestratedTask): Promise<void> {
  // Reviewed: Explorer → Worker Plan → Plan Review → Worker Execution → Result Review → Synthesizer
  
  for (const phase of task.phases) {
    const phaseState = task.phases.find(p => p.id === phase.id);
    if (!phaseState) continue;
    
    // Plan Review: 需要用户审批
    if (phase.role === 'worker' && phase.packet && this.isPlanPacket(phase.packet)) {
      const planPacket = phase.packet as PlanPacket;
      if (!planPacket.approved) {
        // 等待用户审批（异步）
        this.emit({ type: 'phase-completed', timestamp: Date.now(), taskId: task.id, phaseId: phase.id, data: { awaitingApproval: true } });
        continue;  // 等待 approvePlan 被外部调用
      }
    }
    
    await this.executePhase(task.id, phase.id, this.buildPhaseInput(task, phase));
  }
}
```

### 4.2 路径选择算法

```typescript
selectPath(criteria: {
  scopeNarrowness: number;
  evidenceAvailable: number;
}): ExecutionPath {
  // 评分 0-2：越低越倾向 direct
  const score = (1 - criteria.scopeNarrowness) + (1 - criteria.evidenceAvailable);
  
  // 阈值 0.6：低于此值走 direct
  return score < 0.6 ? 'direct' : 'reviewed';
}
```

### 4.3 Packet 验证

```typescript
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
  
  return {
    valid: issues.length === 0 && !packet.truncated,
    malformed: issues.length > 0 && issues.some(i => i.includes('Missing') || i.includes('must be')),
    truncated: packet.truncated,
    issues,
  };
}
```

### 4.4 智能 Root Synthesis

```typescript
synthesize(task: OrchestratedTask): string {
  // 找到 worker phase 的 packet
  const workerPhases = task.phases.filter(p => p.role === 'worker' && p.packet);
  
  if (workerPhases.length === 0) {
    return '任务执行未产生有效输出。';
  }
  
  const lastWorker = workerPhases[workerPhases.length - 1];
  const packet = lastWorker.packet as WorkerPacket;
  
  // 检测完整 worker packet：已完整 + 未截断 + 测试通过
  if (
    packet.status === 'complete' &&
    !packet.truncated &&
    packet.verification?.testsFailed === 0
  ) {
    // 简短总结（避免重复详细报告）
    return [
      `✓ 任务已完成`,
      `  - 变更文件: ${packet.changedFiles.length} 个`,
      `  - 测试: ${packet.verification.testsPassed}/${packet.verification.testsRun} 通过`,
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
```

### 4.5 沙箱继承

```typescript
inheritSandboxConfig(parentConfig: SandboxConfig, role: AgentRole): SandboxConfig {
  const roleConfig = this.getRole(role);
  
  return {
    mode: roleConfig.sandboxMode,  // 角色覆盖父配置
    allowedPaths: parentConfig.allowedPaths,  // 继承
    deniedPaths: [
      ...parentConfig.deniedPaths,
      // Explorer 角色额外禁止写路径
      ...(role === 'explorer' ? ['**/*'] : []),
    ],
    allowedNetworkHosts: parentConfig.allowedNetworkHosts,  // 继承
    approvalRequired: role === 'worker' ? false : parentConfig.approvalRequired,  // Worker 不需要审批
  };
}
```

---

## 五、UI 组件设计

### 5.1 OrchestratorPanel

**功能**：
- 顶部：路径选择器（auto/direct/reviewed）
- 中间：任务列表（按状态分组）
- 任务详情：6 阶段进度条 + Phase 状态卡片
- Phase 详情：Packet 内容 + 重试次数 + 错误信息
- 审批面板：待审批的 Plan Packet 一键 approve/reject
- 角色管理：4 个角色预设查看

**布局**：
```
┌────────────────────────────────────────────────────┐
│  🎯 Orchestrated Multi-Agent                      │
│  ──────────────────────────────────────────────     │
│  路径: [Auto ▼]   并发: [6]   深度: [3]            │
│  ──────────────────────────────────────────────     │
│  ┌──────────────┐  ┌──────────────────────┐       │
│  │ 任务列表     │  │ 任务详情              │       │
│  │              │  │                      │       │
│  │ 🟢 task-001  │  │ task-001 (Reviewed)  │       │
│  │   direct     │  │ ────────────────     │       │
│  │ 🟡 task-002  │  │ ✓ Explorer          │       │
│  │   reviewed   │  │ ✓ Worker Plan       │       │
│  │   等待审批   │  │ ▶ Worker Execute    │       │
│  │ 🔴 task-003  │  │ ○ Result Review     │       │
│  │   failed     │  │ ○ Synthesizer       │       │
│  │              │  │                      │       │
│  │              │  │ Worker Packet:       │       │
│  │              │  │ ┌──────────────────┐│       │
│  │              │  │ │ status: complete  ││       │
│  │              │  │ │ files: 5         ││       │
│  │              │  │ │ tests: 42/42 ✓   ││       │
│  │              │  │ └──────────────────┘│       │
│  │              │  │                      │       │
│  │              │  │ [Approve Plan]      │       │
│  └──────────────┘  └──────────────────────┘       │
└────────────────────────────────────────────────────┘
```

---

## 六、测试策略

### 6.1 单元测试（45 个用例）

**角色管理** (5)
- 注册角色
- 获取角色
- 列出角色
- 重置角色
- 默认角色配置

**任务构建** (4)
- 构建直接路径任务
- 构建审查路径任务
- 任务契约包含证据
- 阶段依赖正确

**路径选择** (4)
- 范围窄 + 证据多 → direct
- 范围宽 + 证据少 → reviewed
- 边界值
- 强制路径

**Direct 执行** (4)
- 单 worker 完成
- 多 worker 串行
- worker 失败处理
- 简短 root completion

**Reviewed 执行** (8)
- Explorer 阶段
- Worker Plan 阶段
- Plan Review 等待审批
- Plan 审批后继续
- Plan 拒绝后重试
- Worker Execution
- Result Review
- Synthesizer

**Packet 验证** (5)
- 完整 packet
- 截断 packet
- 缺失字段 packet
- 测试失败 packet
- 多次 malformed

**Retry Budget** (4)
- 重试增加
- 重试耗尽失败
- 跨 phase 重试
- 失败后 root synthesis

**Root Synthesis** (3)
- 完整 packet 简总结
- 不完整列出问题
- 截断列出问题

**沙箱继承** (4)
- 父 + 角色合并
- explorer 只读
- worker 写权限
- 多层继承

**事件 & 持久化** (4)
- 12 种事件
- 事件解订阅
- 导出状态
- 导入状态

### 6.2 组件测试（10 个用例）

- 面板开关
- 任务列表显示
- 任务详情显示
- 路径选择器
- 阶段进度条
- Packet 内容显示
- 审批按钮
- 拒绝按钮
- 角色管理
- 统计卡片

---

## 七、集成方案

### 7.1 与 NestedSubAgentEngine 集成

```typescript
// OrchestratedAgentEngine 的子代理通过 NestedSubAgentEngine 派生
const subAgent = nestedEngine.spawn({
  role: phase.role,
  parentPath: task.id,
  systemPrompt: roleConfig.systemPrompt,
  sandbox: this.inheritSandboxConfig(parentSandbox, phase.role),
});
```

### 7.2 与 AgentTemplateSystem 集成

```typescript
// 角色配置可从模板加载
const roleConfig = templateSystem.getRole(role);
if (roleConfig) this.registerRole(roleConfig);
```

---

## 八、验收清单

- [ ] 数据模型 + 类型定义完整
- [ ] 核心 API 100% 实现
- [ ] 45 个单元测试通过
- [ ] 10 个组件测试通过
- [ ] UI 面板完整可用
- [ ] 6 阶段 Orchestrated Mode 完整工作
- [ ] 4 角色预设可用
- [ ] 沙箱继承正确
- [ ] 智能 Root Synthesis 工作
- [ ] 事件系统完整
- [ ] 持久化可用
- [ ] 文档完整

---

*G30-03 SPEC · Cycle 30 · 完成*
