# G35-01: WorkflowOrchestratorEngine SPEC

> **任务 ID**: G35-01
> **任务名称**: 工作流编排引擎（DAG-based）
> **版本**: v1.0.0
> **日期**: 2026-07-31
> **状态**: 设计阶段

---

## 1. 概述

实现基于 DAG 的工作流编排引擎，提供完整的有向无环图定义、节点执行、并行分支、条件边、嵌套子图与可视化执行能力。

## 2. 对标产品

- **LangGraph**: StateGraph 抽象 + Node + Edge + Reducer
- **Prefect**: Flow/Task + 动态编排
- **Apache Airflow**: DAG + Branch + SubDAG

## 3. 核心类型

### 3.1 节点类型（6 大类）

```typescript
export type NodeType =
  | 'llm'         // LLM 调用节点
  | 'tool'        // 工具调用节点
  | 'code'        // 代码执行节点
  | 'condition'   // 条件分支节点
  | 'parallel'    // 并行执行节点
  | 'subgraph';   // 嵌套子图节点
```

### 3.2 边类型

```typescript
export type EdgeType =
  | 'default'     // 直接边
  | 'conditional' // 条件边（运行时评估）
  | 'parallel'    // 并行边
  | 'fallback';   // 失败回退边
```

### 3.3 节点定义

```typescript
export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: NodeConfig;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  timeoutMs?: number;
  retryCount?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}
```

### 3.4 边定义

```typescript
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  condition?: string;  // 条件表达式
  priority?: number;
  metadata?: Record<string, unknown>;
}
```

### 3.5 工作流定义

```typescript
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryPoint: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

### 3.6 工作流实例

```typescript
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  nodeStates: Map<string, NodeState>;
  context: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### 3.7 节点状态

```typescript
export interface NodeState {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  attempts: number;
  durationMs?: number;
}
```

## 4. 核心 API

### 4.1 工作流管理

```typescript
class WorkflowOrchestratorEngine {
  registerWorkflow(definition: WorkflowDefinition): void;
  updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): void;
  deleteWorkflow(id: string): boolean;
  getWorkflow(id: string): WorkflowDefinition | undefined;
  listWorkflows(): WorkflowDefinition[];
}
```

### 4.2 实例管理

```typescript
class WorkflowOrchestratorEngine {
  createInstance(definitionId: string, initialContext: Record<string, unknown>): WorkflowInstance;
  startInstance(instanceId: string): Promise<void>;
  pauseInstance(instanceId: string): Promise<void>;
  resumeInstance(instanceId: string): Promise<void>;
  cancelInstance(instanceId: string): Promise<void>;
  getInstance(instanceId: string): WorkflowInstance | undefined;
  listInstances(filter?: InstanceFilter): WorkflowInstance[];
}
```

### 4.3 节点执行

```typescript
class WorkflowOrchestratorEngine {
  // 节点执行器注册
  registerNodeExecutor(type: NodeType, executor: NodeExecutor): void;
  
  // 节点回调
  onNodeStart(instanceId: string, nodeId: string): void;
  onNodeComplete(instanceId: string, nodeId: string, output: unknown): void;
  onNodeError(instanceId: string, nodeId: string, error: Error): void;
}
```

### 4.4 高级功能

```typescript
class WorkflowOrchestratorEngine {
  // Subgraph 支持
  registerSubgraph(workflowId: string, parentNodeId: string): void;
  
  // 可视化
  getExecutionGraph(instanceId: string): ExecutionGraph;
  
  // 统计
  getStats(): WorkflowStats;
  
  // 持久化
  exportState(instanceId: string): SerializedState;
  importState(state: SerializedState): WorkflowInstance;
}
```

## 5. 预置工作流

### 5.1 Sequential Pipeline（顺序管道）
- 3 节点：A → B → C

### 5.2 Parallel Fan-out（并行扇出）
- 1 节点 → 3 并行节点 → 1 聚合节点

### 5.3 Conditional Branch（条件分支）
- 1 节点 → 2 条件边 → A 或 B

### 5.4 Loop with Limit（限制循环）
- A → B → (条件回 A) → C

### 5.5 Subgraph Composition（子图组合）
- 主图 + 2 子图（可复用）

## 6. 事件系统

```typescript
export type OrchestratorEvent =
  | 'workflow-registered'
  | 'workflow-updated'
  | 'workflow-deleted'
  | 'instance-created'
  | 'instance-started'
  | 'instance-paused'
  | 'instance-resumed'
  | 'instance-completed'
  | 'instance-failed'
  | 'instance-cancelled'
  | 'node-started'
  | 'node-completed'
  | 'node-failed'
  | 'node-skipped';
```

## 7. 默认配置

```typescript
export const DEFAULT_ORCHESTRATOR_CONFIG = {
  maxConcurrentInstances: 100,
  maxConcurrentNodes: 50,
  defaultTimeoutMs: 30000,
  maxRetries: 3,
  persistEnabled: true,
  visualizationEnabled: true,
  eventHistorySize: 1000,
};
```

## 8. 单例模式

```typescript
export function getDefaultWorkflowOrchestratorEngine(): WorkflowOrchestratorEngine;
export function resetDefaultWorkflowOrchestratorEngine(): void;
```

## 9. 单元测试覆盖

| 类别 | 测试数 | 覆盖点 |
|------|--------|--------|
| 工具函数 | 5 | generateXxxId |
| 初始化 | 3 | 默认配置 + 预置工作流 |
| 工作流管理 | 8 | register/update/delete/get/list |
| 实例管理 | 10 | create/start/pause/resume/cancel |
| 节点执行 | 12 | 各类型节点 + 错误处理 |
| 边处理 | 8 | 条件边 + 并行边 + 回退边 |
| 嵌套子图 | 5 | registerSubgraph + 嵌套执行 |
| 持久化 | 4 | exportState/importState |
| 事件 | 4 | 订阅 + 触发 |
| 统计 | 3 | 实例/节点统计 |
| 单例 | 2 | getDefault/resetDefault |
| **合计** | **~65** | |

## 10. 验收标准

- ✅ 6 种节点类型全部实现
- ✅ 4 种边类型全部实现
- ✅ 5 个预置工作流可运行
- ✅ 嵌套子图支持
- ✅ 可视化执行图 API
- ✅ 持久化 + 恢复
- ✅ 事件订阅 + 触发
- ✅ 65+ 单元测试通过
- ✅ TypeScript 0 错误
- ✅ 与 `dynamicWorkflowEngine` 兼容

## 11. 依赖与集成

### 依赖
- 无外部依赖（纯前端实现）

### 集成
- 可被 `orchestratedAgentEngine` 调用（作为底层执行引擎）
- 可被 `agentSchedulerEngine` 调用（提交 DAG 任务）
- 可被 `taskCheckpointEngine` 调用（保存实例状态）
- UI 面板: `WorkflowOrchestratorPanel.tsx`
