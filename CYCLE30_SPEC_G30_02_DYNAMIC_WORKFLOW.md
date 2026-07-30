# G30-02: Dynamic Workflow Engine (动态工作流引擎)

**任务编号**: G30-02
**周期**: Cycle 30
**版本**: v6.84.0
**日期**: 2026-07-30
**重要性**: P0（确定性工作流核心能力）
**参考**: [codex-flow](https://github.com/Dmatut7/codex-flow) + [kedarkolluri/codex PR #27](https://github.com/kedarkolluri/codex/pull/27)

---

## 一、需求背景

### 1.1 业务问题

Hermes 当前工作流是 **Phase 1-6 阶段管理**（需求/架构/任务/执行/测试/提交），缺少：

- **Phase-based 确定性编排**：开发者无法定义自己的多阶段工作流
- **Journaled Execution**：执行历史仅停留在任务级别，缺少 phase 级别日志
- **Resumable Workflow**：当前只能从断点恢复整体任务，不能从某个 phase 恢复
- **Prefix Replay**：缺少"用相同前缀重新执行"的能力
- **扇出-验证-汇总模板**：缺少 fan-out / verify / aggregate 模式

参考 codex-flow 设计理念，我们需要构建一个 **确定性、可恢复、有日志** 的工作流引擎。

### 1.2 目标

1. **Phase-based 编排**：每个 phase 有明确 input/output 契约，支持自定义 phase 类型
2. **Journaled Execution**：每个 phase 完成/失败/重试都写入持久化 journal
3. **Resume from any phase**：支持从任意 phase 恢复，跳过已完成 phase
4. **Replay from prefix**：从指定 phase 重新执行，复用之前的输出
5. **扇出-验证-汇总模板**：内置 3 种高阶工作流模板
6. **并行组**：phase 可声明并行组（parallel groups）

---

## 二、数据模型

### 2.1 类型定义

```typescript
// Phase 类型
export type PhaseType =
  | 'init'         // 初始化
  | 'execute'      // 通用执行
  | 'verify'       // 验证
  | 'fanout'       // 扇出（并行派发子任务）
  | 'aggregate'    // 汇总（合并子任务结果）
  | 'cleanup'      // 清理
  | 'custom';      // 自定义

// Phase 状态
export type PhaseStatus =
  | 'pending'      // 待执行
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'skipped'      // 跳过（依赖失败时）
  | 'retrying';    // 重试中

// 工作流状态
export type WorkflowStatus =
  | 'pending'      // 待开始
  | 'running'      // 运行中
  | 'paused'       // 暂停
  | 'completed'    // 完成
  | 'failed'       // 失败
  | 'cancelled';   // 取消

// 阶段输入/输出契约
export interface PhaseContract {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  validateInput?: (input: unknown) => { valid: boolean; errors?: string[] };
  validateOutput?: (output: unknown) => { valid: boolean; errors?: string[] };
}

// 阶段定义
export interface WorkflowPhase {
  id: string;
  name: string;
  type: PhaseType;
  description?: string;
  dependsOn: string[];                  // 依赖的 phase id
  contract: PhaseContract;
  execute: (ctx: PhaseContext) => Promise<PhaseResult>;
  retryBudget: number;                   // 最大重试次数（0 = 不重试）
  timeoutMs?: number;                    // 超时时间
  parallelGroup?: string;                // 并行组标识
}

// 阶段执行上下文
export interface PhaseContext {
  workflowId: string;
  instanceId: string;
  phaseId: string;
  input: unknown;
  upstreamOutputs: Record<string, unknown>;  // 依赖 phase 的输出
  abortSignal: AbortSignal;
}

// 阶段执行结果
export interface PhaseResult {
  status: 'success' | 'failure';
  output?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
}

// 工作流定义
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  phases: WorkflowPhase[];
  parallelGroups?: string[][];           // 并行组定义
  metadata?: Record<string, unknown>;
}

// 阶段状态（运行时）
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
  abortController?: AbortController;
}

// Journal 记录
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

// 工作流实例
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionSnapshot: WorkflowDefinition;  // 定义快照（用于恢复）
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

// 启动选项
export interface StartOptions {
  initialInput: unknown;
  metadata?: Record<string, unknown>;
  persistImmediately?: boolean;
}

// 引擎事件
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
```

### 2.2 默认配置

```typescript
export const DEFAULT_WORKFLOW_CONFIG: WorkflowEngineConfig = {
  maxConcurrentPhases: 4,
  defaultRetryBudget: 0,
  defaultTimeoutMs: 60_000,
  persistJournals: true,
  maxJournalEntries: 1000,
  autoCleanupOnComplete: false,
  persist: true,
};
```

---

## 三、核心 API

### 3.1 DynamicWorkflowEngine 类

```typescript
export class DynamicWorkflowEngine {
  constructor(config?: Partial<WorkflowEngineConfig>);
  
  // ========== 工作流定义 ==========
  
  /**
   * 注册工作流定义
   */
  registerWorkflow(def: WorkflowDefinition): void;
  
  /**
   * 获取工作流定义
   */
  getWorkflow(id: string): WorkflowDefinition | undefined;
  
  /**
   * 列出所有工作流
   */
  listWorkflows(): WorkflowDefinition[];
  
  /**
   * 删除工作流
   */
  unregisterWorkflow(id: string): boolean;
  
  // ========== 启动 / 控制 ==========
  
  /**
   * 启动工作流
   */
  start(workflowId: string, options: StartOptions): WorkflowInstance;
  
  /**
   * 启动工作流（async，等待完成）
   */
  async startAndWait(workflowId: string, options: StartOptions): Promise<WorkflowInstance>;
  
  /**
   * 暂停工作流
   */
  pause(instanceId: string): WorkflowInstance;
  
  /**
   * 恢复工作流
   */
  resume(instanceId: string, fromPhase?: string): WorkflowInstance;
  
  /**
   * 从指定 phase 重新执行（replay）
   */
  replay(instanceId: string, fromPhase: string): WorkflowInstance;
  
  /**
   * 取消工作流
   */
  cancel(instanceId: string): WorkflowInstance;
  
  // ========== 模板 ==========
  
  /**
   * 构建扇出-验证-汇总工作流
   */
  buildFanOutVerifyAggregate(config: {
    name: string;
    fanoutCount: number;
    verifierCount: number;
    aggregatorType: 'merge' | 'vote' | 'best' | 'consensus';
    fanoutPhase: WorkflowPhase;
    verifyPhase: WorkflowPhase;
    aggregatePhase: WorkflowPhase;
  }): WorkflowDefinition;
  
  /**
   * 构建 Review-Repair-Validate 工作流
   */
  buildReviewRepairValidate(config: {
    name: string;
    reviewRounds: number;
    reviewPhase: WorkflowPhase;
    repairPhase: WorkflowPhase;
    validatePhase: WorkflowPhase;
  }): WorkflowDefinition;
  
  /**
   * 构建线性管道工作流
   */
  buildPipeline(config: {
    name: string;
    phases: Array<Pick<WorkflowPhase, 'id' | 'name' | 'type' | 'execute' | 'retryBudget' | 'timeoutMs'>>;
  }): WorkflowDefinition;
  
  // ========== 查询 ==========
  
  /**
   * 获取工作流实例
   */
  getInstance(instanceId: string): WorkflowInstance | undefined;
  
  /**
   * 列出工作流实例
   */
  listInstances(filter?: {
    status?: WorkflowStatus;
    definitionId?: string;
    startedAfter?: number;
    startedBefore?: number;
  }): WorkflowInstance[];
  
  /**
   * 获取 Journal
   */
  getJournal(instanceId: string): JournalEntry[];
  
  /**
   * 获取 phase 状态
   */
  getPhaseState(instanceId: string, phaseId: string): PhaseState | undefined;
  
  // ========== 统计 ==========
  
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
  };
  
  // ========== 事件 ==========
  
  on(event: WorkflowEventType, listener: (e: WorkflowEvent) => void): () => void;
  off(event: WorkflowEventType, listener: (e: WorkflowEvent) => void): void;
  
  // ========== 持久化 ==========
  
  exportState(): SerializedWorkflowState;
  importState(state: SerializedWorkflowState): void;
  clear(): void;
}
```

---

## 四、关键算法

### 4.1 阶段依赖解析

```typescript
private getReadyPhases(instance: WorkflowInstance): string[] {
  const ready: string[] = [];
  for (const phase of instance.definitionSnapshot.phases) {
    const state = instance.phaseStates[phase.id];
    if (state.status !== 'pending') continue;
    
    // 检查所有依赖是否完成
    const allDepsCompleted = phase.dependsOn.every(depId => {
      const depState = instance.phaseStates[depId];
      return depState && depState.status === 'completed';
    });
    
    if (allDepsCompleted) {
      ready.push(phase.id);
    }
  }
  return ready;
}
```

### 4.2 并行组调度

```typescript
private async runReadyPhases(instance: WorkflowInstance): Promise<void> {
  const ready = this.getReadyPhases(instance);
  
  // 按并行组分组
  const groups = this.groupByParallelGroup(ready, instance);
  
  for (const group of groups) {
    // 同组并行
    await Promise.allSettled(
      group.map(phaseId => this.executePhase(instance, phaseId))
    );
  }
}
```

### 4.3 Journal 写入

```typescript
private writeJournal(instance: WorkflowInstance, phaseId: string, state: PhaseState): void {
  const entry: JournalEntry = {
    id: generateId('journal'),
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
  
  if (this.config.persist) this.persistInstance(instance);
  
  this.emit({
    type: 'journal-written',
    timestamp: Date.now(),
    instanceId: instance.id,
    phaseId,
    data: entry,
  });
}
```

### 4.4 Resume from phase

```typescript
resume(instanceId: string, fromPhase?: string): WorkflowInstance {
  const instance = this.getInstance(instanceId);
  if (!instance) throw new Error(`Instance ${instanceId} not found`);
  if (instance.status !== 'paused' && instance.status !== 'failed') {
    throw new Error(`Cannot resume instance in status ${instance.status}`);
  }
  
  // 如果指定了 fromPhase，将该 phase 及其依赖重置为 pending
  if (fromPhase) {
    this.resetPhaseTree(instance, fromPhase);
  }
  
  instance.status = 'running';
  this.persistInstance(instance);
  
  this.emit({
    type: 'workflow-resumed',
    timestamp: Date.now(),
    instanceId,
    phaseId: fromPhase,
  });
  
  // 异步继续执行
  this.continueExecution(instance);
  
  return instance;
}

private resetPhaseTree(instance: WorkflowInstance, phaseId: string): void {
  const phase = instance.definitionSnapshot.phases.find(p => p.id === phaseId);
  if (!phase) return;
  
  // 重置当前 phase
  instance.phaseStates[phaseId] = {
    phaseId,
    status: 'pending',
    retries: 0,
  };
  
  // 重置所有依赖（递归）
  for (const dep of phase.dependsOn) {
    this.resetPhaseTree(instance, dep);
  }
  
  // 跳过已完成 phase
  for (const depId of phase.dependsOn) {
    const depState = instance.phaseStates[depId];
    if (depState.status === 'pending') {
      depState.status = 'skipped';
    }
  }
}
```

---

## 五、UI 组件设计

### 5.1 WorkflowStudioPanel

**功能**：
- 左侧：工作流定义列表（注册/编辑/删除）
- 中间：可视化 phase 流程图（DAG 渲染）
- 右侧：实例运行状态 + Journal 日志
- 工具栏：启动 / 暂停 / 恢复 / 重放 / 取消 按钮
- 模板库：3 个高阶模板一键生成

**布局**：
```
┌────────────────────────────────────────────────────────┐
│  🔄 Dynamic Workflow Studio                           │
│  ────────────────────────────────────────────────       │
│  [新建] [模板: 扇出-验证-汇总] [模板: 评审-修复-验证]   │
│  ────────────────────────────────────────────────       │
│  ┌──────────┐  ┌────────────────┐  ┌─────────────┐  │
│  │ 工作流    │  │  流程图         │  │  实例状态   │  │
│  │          │  │                │  │             │  │
│  │ • wf-001 │  │  ┌──┐          │  │ 状态: 运行  │  │
│  │   3 phase│  │  │A ├→┌──┐    │  │ Phase 1/3   │  │
│  │ • wf-002 │  │  └──┘  │B │    │  │             │  │
│  │   5 phase│  │        └─┬┘    │  │ Journal:    │  │
│  │          │  │          ↓     │  │  10:23 A ✓  │  │
│  │          │  │        ┌──┐    │  │  10:24 B ✓  │  │
│  │          │  │        │C │    │  │  10:25 C ▶  │  │
│  │          │  │        └──┘    │  │             │  │
│  └──────────┘  └────────────────┘  └─────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 六、测试策略

### 6.1 单元测试（40 个用例）

**定义管理** (5)
- 注册工作流
- 获取工作流
- 列出工作流
- 删除工作流
- 重复注册报错

**基本执行** (8)
- 启动线性工作流
- 启动并行工作流
- 阶段依赖正确解析
- 阶段失败工作流失败
- 阶段跳过（依赖失败）
- 工作流完成
- 启动超时
- 启动 + 等待

**暂停/恢复** (6)
- 暂停运行中工作流
- 恢复暂停工作流
- 从指定 phase 恢复
- 重放整个工作流
- 从指定 phase 重放
- 取消运行中工作流

**模板** (5)
- buildFanOutVerifyAggregate
- buildReviewRepairValidate
- buildPipeline
- merge 聚合
- vote 聚合

**重试与超时** (4)
- 阶段重试
- 重试耗尽
- 阶段超时
- 错误传播

**Journal** (4)
- 写入 journal
- 限制 journal 大小
- 获取 journal
- journal 持久化

**并行组** (3)
- 同组并行
- 跨组串行
- 部分失败处理

**事件 & 持久化** (5)
- 11 种事件
- 事件解订阅
- 导出状态
- 导入状态
- 清空

### 6.2 组件测试（10 个用例）

- 面板开关
- 工作流列表显示
- 流程图渲染
- 启动按钮
- 暂停按钮
- 恢复按钮
- 重放按钮
- 取消按钮
- Journal 显示
- 模板按钮

---

## 七、集成方案

### 7.1 与 BackgroundTaskEngine 集成

```typescript
// 启动工作流时创建后台任务
backgroundEngine.register('workflow-' + instanceId, {
  name: `Workflow: ${workflow.name}`,
  run: async (ctx) => {
    await workflowEngine.startAndWait(workflowId, { initialInput });
  },
  cancel: () => workflowEngine.cancel(instanceId),
});
```

### 7.2 与 MultiTaskOrchestrator 集成

```typescript
// FanOut phase 内部使用 MultiTaskOrchestrator 并行执行子任务
const fanoutPhase: WorkflowPhase = {
  id: 'fanout',
  type: 'fanout',
  execute: async (ctx) => {
    const tasks = await multiOrchestrator.parallel(subTasks);
    return { status: 'success', output: tasks };
  },
  ...
};
```

---

## 八、验收清单

- [ ] 数据模型 + 类型定义完整
- [ ] 核心 API 100% 实现
- [ ] 40 个单元测试通过
- [ ] 10 个组件测试通过
- [ ] UI 面板完整可用
- [ ] 3 个高阶模板可用
- [ ] 与 BackgroundTaskEngine 集成
- [ ] 事件系统完整
- [ ] 持久化可用
- [ ] 文档完整

---

*G30-02 SPEC · Cycle 30 · 完成*
