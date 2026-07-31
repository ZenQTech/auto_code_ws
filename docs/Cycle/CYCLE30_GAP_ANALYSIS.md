# Cycle 30 差距分析报告

**周期**：Cycle 30
**日期**：2026-07-30
**依据**：[CYCLE30_CODEX_TRAE_RESEARCH.md](./CYCLE30_CODEX_TRAE_RESEARCH.md)

---

## 一、当前 Hermes 系统盘点

### 1.1 已有能力（21 个核心引擎）

| Cycle | 模块 | 能力 |
|-------|------|------|
| C19 P0-1 | BackgroundTaskEngine | 后台任务管理 |
| C24 P1-1 | MultiTaskOrchestrator | 多任务并行 |
| C25 | VoiceInputAdapter / GlobalMemoryEngine | 语音输入 + 跨会话记忆 |
| C26 | CsvBatchEngine / SmartApprovalEngine / MtcAdapter | CSV/审批/多模任务 |
| C27 G27-01 | NestedSubAgentEngine | 3 层嵌套子代理 |
| C27 G27-02 | AgentCheckpointEngine | 代理检查点 |
| C27 G27-03 | AgentTemplateSystem | 模板系统 |
| C28 G28-01 | SkillEngine / SkillsPanel | 技能系统 |
| C28 G28-02 | CostBudgetEngine / CostBudgetPanel | 成本预算 |
| C28 G28-03 | UsageAttributionEngine / UsageAttributionPanel | 用量归因 |
| C28 G28-04 | ScopedPermissionsEngine / ScopedPermissionsPanel | 作用域权限 |
| C28 G28-05 | SlashCommandEngine / SlashCommandPanel | 斜杠命令 |
| C29 G29-01 | StackedSkillEngine / StackedSkillsPanel | 堆叠技能 |
| C29 G29-02 | SkillsMarketplace / MarketplacePanel | 技能市场 |
| C29 G29-03 | AnalyticsChat / AnalyticsChatPanel | 分析聊天 |

### 1.2 缺失能力（基于 Cycle 30 调研）

#### 类别 A：企业级成本治理（参考 Claude Enterprise Cost Threshold Alert）

| 能力 | 现状 | 差距 |
|------|------|------|
| 多级阈值告警 | 仅支持单一阈值 | ❌ 缺 75/90/95% 多级 |
| 用户级预算隔离 | 仅全局 budget | ❌ 缺 per-user 预算 |
| 告警事件 | 仅数字显示 | ❌ 缺事件通知 + 渠道 |
| 提额申请工作流 | 无 | ❌ 缺 request → approve → apply 流程 |
| Admin API | 无 | ❌ 缺编程化 API |
| hard cap 阻断 | 无 | ❌ 缺超限强制阻断 |

#### 类别 B：动态工作流编排（参考 codex-flow / Codex Orchestrated Mode）

| 能力 | 现状 | 差距 |
|------|------|------|
| Phase-based 确定性工作流 | 无 | ❌ 缺 phase 编排 |
| Journaled Execution | 无 | ❌ 缺执行日志持久化 |
| Resumable Workflow | 部分（checkpoint） | ❌ 缺 phase-level 恢复 |
| Prefix Replay | 无 | ❌ 缺前缀回放 |
| 扇出-验证-汇总模板 | 无 | ❌ 缺 fan-out/verify/aggregate 模式 |
| Retry Budget | 无 | ❌ 缺重试预算跟踪 |

#### 类别 C：多代理团队协作（参考 Codex Subagents / TRAE SOLO）

| 能力 | 现状 | 差距 |
|------|------|------|
| 6 阶段 Orchestrated Mode | 无 | ❌ 缺完整编排 |
| Worker/Explorer 角色预设 | 通用 | ❌ 缺角色模板 |
| Phase Contract 验证 | 无 | ❌ 缺契约机制 |
| Read-only Explorer 强制 | 无 | ❌ 缺只读沙箱 |
| Packet 验证 | 无 | ❌ 缺 packet 校验 |
| 沙箱配置继承 | 部分 | ❌ 缺继承链 |
| max_threads 动态配置 | 无 | ❌ 缺动态并发控制 |
| Root Synthesis 策略 | 简单拼接 | ❌ 缺智能合成 |

---

## 二、优先级排序

### P0（必做 - 本周期核心）

1. **G30-01 CostThresholdAlertEngine**（成本阈值告警引擎）
   - 多级阈值（warning/critical/blocked）
   - 告警事件 + 通知渠道
   - 提额申请工作流
   - 强制阻断机制

2. **G30-02 DynamicWorkflowEngine**（动态工作流引擎）
   - Phase-based 编排
   - Journaled Execution
   - Resume from any phase
   - 扇出-验证-汇总模板

3. **G30-03 OrchestratedAgentEngine**（编排多代理引擎）
   - 6 阶段 Orchestrated Mode
   - Worker/Explorer 角色预设
   - Phase Contract 验证
   - Retry Budget 跟踪

### P1（可延后 - 下一周期）

- Admin API for Spend Management
- Prefix Replay Engine
- Worktree Backend 适配层
- Cost Anomaly Detection
- 实时 TUI Monitor

---

## 三、目标架构

```
┌──────────────────────────────────────────────────────────────────┐
│                   Hermes Cycle 30 架构演进                       │
├──────────────────────────────────────────────────────────────────┤
│  UI Layer                                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │ CostAlert  │ │ Workflow   │ │Orchestrator│ │  ...       │  │
│  │ Panel      │ │ Studio     │ │ Panel      │ │            │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Engine Layer                                                      │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐   │
│  │CostThresholdAlert│ │DynamicWorkflow   │ │Orchestrated  │   │
│  │  Engine   (NEW)  │ │  Engine   (NEW)  │ │AgentEngine   │   │
│  │                  │ │                  │ │   (NEW)      │   │
│  │ - 多级阈值       │ │ - Phase 编排     │ │ - 6 阶段     │   │
│  │ - 告警事件       │ │ - Journal 日志   │ │ - Worker     │   │
│  │ - 提额申请       │ │ - Resume/Replay  │ │ - Explorer   │   │
│  │ - 强制阻断       │ │ - Fan-Out 模板   │ │ - Reviewer   │   │
│  └──────────────────┘ └──────────────────┘ └──────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  Existing Engines (C19-C29)                                       │
│  BackgroundTask · MultiTaskOrch · CostBudget · Skill · ...      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 四、任务分解

### 4.1 G30-01 CostThresholdAlertEngine (P0)

**核心功能**：
- 多级阈值：warning (75%) / critical (90%) / blocked (100%)
- 告警级别：info / warning / critical / blocked
- 通知渠道：in-app / email mock / webhook
- 提额申请：request → pending → approved/denied → apply
- 强制阻断：超 100% 自动暂停执行

**数据模型**：
```typescript
type AlertLevel = 'info' | 'warning' | 'critical' | 'blocked';
type ThresholdConfig = { warning: number; critical: number; blocked: number };
type SpendAlert = {
  id: string;
  scope: 'org' | 'team' | 'user';
  scopeId: string;
  level: AlertLevel;
  threshold: number;
  currentSpend: number;
  budget: number;
  timestamp: number;
  acknowledged: boolean;
};
type QuotaRequest = {
  id: string;
  requester: string;
  scope: 'org' | 'team' | 'user';
  scopeId: string;
  currentBudget: number;
  requestedBudget: number;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  reviewer?: string;
  reviewedAt?: number;
};
```

**API**：
```typescript
class CostThresholdAlertEngine {
  // 配置
  setThresholds(scope: ScopeRef, config: ThresholdConfig): void;
  getThresholds(scope: ScopeRef): ThresholdConfig;
  
  // 监控
  recordSpend(scope: ScopeRef, amount: number, source: string): void;
  checkThresholds(scope: ScopeRef): SpendAlert[];
  getActiveAlerts(scope?: ScopeRef): SpendAlert[];
  
  // 告警
  acknowledge(alertId: string, userId: string): void;
  
  // 提额申请
  requestQuotaIncrease(req: Omit<QuotaRequest, 'id' | 'status'>): QuotaRequest;
  reviewQuotaRequest(reqId: string, decision: 'approved' | 'denied', reviewer: string): QuotaRequest;
  applyApprovedRequest(reqId: string): void;
  
  // 阻断
  isBlocked(scope: ScopeRef): boolean;
  enforceBlock(scope: ScopeRef): { allowed: boolean; reason?: string };
  
  // 事件
  on(event: AlertEventType, listener: (e: AlertEvent) => void): () => void;
  // 事件类型: 'alert-triggered' | 'alert-acknowledged' | 'quota-requested' | 'quota-reviewed' | 'block-enforced'
}
```

### 4.2 G30-02 DynamicWorkflowEngine (P0)

**核心功能**：
- Phase-based 编排：每个 phase 有明确的 input/output 契约
- 6 种内置 phase 类型：init / execute / verify / fanout / aggregate / cleanup
- Journaled Execution：每个 phase 完成后写入持久化 journal
- Resume from any phase：从断点恢复，跳过已完成 phase
- Replay from prefix：从某个 phase 重新执行，复用之前的 phase 输出
- 扇出-验证-汇总模板：fanout → verify → aggregate 三阶段

**数据模型**：
```typescript
type PhaseType = 'init' | 'execute' | 'verify' | 'fanout' | 'aggregate' | 'cleanup' | 'custom';
type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type WorkflowPhase = {
  id: string;
  name: string;
  type: PhaseType;
  dependsOn: string[];
  inputContract: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  execute: (ctx: WorkflowContext) => Promise<PhaseResult>;
  retryBudget: number;
  timeoutMs?: number;
};
type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  phases: WorkflowPhase[];
  parallelGroups?: string[][];
};
type WorkflowInstance = {
  id: string;
  definitionId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  currentPhase?: string;
  phaseStates: Record<string, PhaseState>;
  journal: JournalEntry[];
  startedAt: number;
  completedAt?: number;
};
type JournalEntry = {
  phaseId: string;
  timestamp: number;
  status: PhaseStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  retries: number;
  durationMs: number;
};
```

**API**：
```typescript
class DynamicWorkflowEngine {
  // 定义
  registerWorkflow(def: WorkflowDefinition): void;
  getWorkflow(id: string): WorkflowDefinition | undefined;
  listWorkflows(): WorkflowDefinition[];
  
  // 执行
  start(workflowId: string, initialInput: unknown, options?: StartOptions): WorkflowInstance;
  pause(instanceId: string): void;
  resume(instanceId: string, fromPhase?: string): void;
  replay(instanceId: string, fromPhase: string): void;
  cancel(instanceId: string): void;
  
  // 模板
  buildFanOutVerifyAggregate(config: { fanoutCount: number; verifierCount: number; aggregatorType: 'merge' | 'vote' | 'best' }): WorkflowDefinition;
  buildReviewRepairValidate(config: { reviewRounds: number }): WorkflowDefinition;
  
  // 查询
  getInstance(id: string): WorkflowInstance | undefined;
  getJournal(instanceId: string): JournalEntry[];
  listInstances(filter?: { status?: WorkflowInstance['status']; definitionId?: string }): WorkflowInstance[];
  
  // 事件
  on(event: WorkflowEventType, listener: (e: WorkflowEvent) => void): () => void;
  // 事件: 'workflow-started' | 'phase-started' | 'phase-completed' | 'phase-failed' | 'workflow-completed' | 'workflow-paused' | 'workflow-resumed' | 'journal-written'
}
```

### 4.3 G30-03 OrchestratedAgentEngine (P0)

**核心功能**：
- 6 阶段 Orchestrated Mode：User turn → Task Contract → (Direct | Reviewed) execution → Root completion/synthesis
- Direct Execution：Worker → 短 Root completion（用于窄范围跟进）
- Reviewed Execution：Explorer → Worker Plan → Plan Review → Worker Execution → Result Review → Root synthesis
- Worker/Explorer/Reviewer 三个角色预设
- Phase Contract 验证：每个阶段有 input/output 契约
- Retry Budget：每个子阶段有最大重试次数
- 沙箱继承：subagent 继承父会话的 sandbox 配置
- max_threads/max_depth 动态控制

**数据模型**：
```typescript
type AgentRole = 'orchestrator' | 'worker' | 'explorer' | 'reviewer' | 'synthesizer';
type ExecutionPath = 'direct' | 'reviewed';
type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'retrying';

type PhaseContract = {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  validate: (data: unknown) => { valid: boolean; errors?: string[] };
};

type OrchestratedPhase = {
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
  startedAt?: number;
  completedAt?: number;
};

type OrchestratedTask = {
  id: string;
  userTurn: string;
  path: ExecutionPath;
  contract: TaskContract;
  phases: OrchestratedPhase[];
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  rootSynthesis?: string;
  createdAt: number;
  completedAt?: number;
};

type AgentRoleConfig = {
  role: AgentRole;
  sandboxMode: 'read-only' | 'workspace-write' | 'full';
  allowedTools: string[];
  model: string;
  systemPrompt: string;
  isolation: 'thread' | 'worktree';
};

type TaskContract = {
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  scope: { files?: string[]; directories?: string[] };
  evidence: Array<{ type: 'file' | 'command' | 'doc'; ref: string; summary: string }>;
};
```

**API**：
```typescript
class OrchestratedAgentEngine {
  // 角色管理
  registerRole(config: AgentRoleConfig): void;
  getRole(role: AgentRole): AgentRoleConfig;
  listRoles(): AgentRole[];
  
  // 任务执行
  async orchestrate(userTurn: string, options?: OrchestrateOptions): Promise<OrchestratedTask>;
  // options: { forcePath?: ExecutionPath; maxRetries?: number; model?: string }
  
  // 路径选择
  selectPath(task: OrchestratedTask, criteria: { scopeNarrowness: number; evidenceAvailable: number }): ExecutionPath;
  
  // 阶段执行
  async executePhase(taskId: string, phaseId: string, input: unknown): Promise<PhaseResult>;
  validatePhaseOutput(phase: OrchestratedPhase, output: unknown): { valid: boolean; errors?: string[] };
  
  // Retry Budget
  incrementRetry(taskId: string, phaseId: string): number;
  shouldFailTask(taskId: string, phaseId: string): boolean;
  
  // Root Synthesis
  synthesize(task: OrchestratedTask): string;
  // 智能合成：检测已完整 worker packet → 简短总结；否则列出剩余问题
  
  // 沙箱继承
  inheritSandboxConfig(parentConfig: SandboxConfig, role: AgentRole): SandboxConfig;
  
  // 并发控制
  setMaxThreads(n: number): void;
  setMaxDepth(n: number): void;
  
  // 查询
  getTask(id: string): OrchestratedTask | undefined;
  listTasks(filter?: { status?: OrchestratedTask['status'] }): OrchestratedTask[];
  
  // 事件
  on(event: OrchestratorEventType, listener: (e: OrchestratorEvent) => void): () => void;
  // 事件: 'task-started' | 'path-selected' | 'phase-started' | 'phase-completed' | 'phase-failed' | 'phase-retried' | 'synthesis-generated' | 'task-completed' | 'task-failed'
}
```

---

## 五、验收标准

每个模块需满足：

1. **代码完整性**：100% TypeScript 类型 + 完整中文注释
2. **测试覆盖**：单元测试 + 组件测试 + E2E 测试，覆盖率 ≥ 80%
3. **集成验证**：与现有引擎（CostBudget/MultiTaskOrch/NestedSubAgent）正确集成
4. **UI 友好**：响应式布局 + dark mode + 关键状态可视化
5. **事件系统**：所有状态变化都有事件通知
6. **持久化**：关键状态可序列化到 localStorage

---

## 六、任务分配

| Task | 文件 | 估算行数 | 估算测试数 |
|------|------|----------|------------|
| G30-01 核心引擎 | costThresholdAlertEngine.ts | 400 | 30 |
| G30-01 单元测试 | costThresholdAlertEngine.test.ts | 350 | 30 |
| G30-01 UI 面板 | CostAlertPanel.tsx | 350 | 8 |
| G30-01 组件测试 | CostAlertPanel.test.tsx | 150 | 8 |
| G30-02 核心引擎 | dynamicWorkflowEngine.ts | 500 | 40 |
| G30-02 单元测试 | dynamicWorkflowEngine.test.ts | 450 | 40 |
| G30-02 UI 面板 | WorkflowStudioPanel.tsx | 400 | 10 |
| G30-02 组件测试 | WorkflowStudioPanel.test.tsx | 180 | 10 |
| G30-03 核心引擎 | orchestratedAgentEngine.ts | 550 | 45 |
| G30-03 单元测试 | orchestratedAgentEngine.test.ts | 500 | 45 |
| G30-03 UI 面板 | OrchestratorPanel.tsx | 400 | 10 |
| G30-03 组件测试 | OrchestratorPanel.test.tsx | 180 | 10 |
| E2E 集成测试 | Cycle30E2E.test.tsx | 350 | 20 |
| 主应用集成 | App.tsx / BrandHeader.tsx / AppLayout.tsx | +50 行 | - |
| 文档 | CYCLE30_ACCEPTANCE_REPORT.md + CYCLE30_CODE_MODIFICATION_LOG.md | - | - |

**预计新增代码**：~4800 行
**预计新增测试**：~286 个

---

## 七、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 状态机复杂导致 bug | 中 | 高 | 严格单元测试覆盖所有状态转换 |
| 事件循环死锁 | 低 | 高 | 使用异步队列 + 取消令牌 |
| 持久化数据膨胀 | 中 | 中 | 限制 journal 大小，定期清理 |
| 与现有引擎冲突 | 低 | 中 | 通过 service locator 模式集成 |
| UI 性能问题 | 中 | 中 | 虚拟滚动 + memoization |

---

*Cycle 30 差距分析 · 完成*
