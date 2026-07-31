# G35-04: AgentSchedulerEngine SPEC

> **任务 ID**: G35-04
> **任务名称**: 智能体调度引擎（WFQ + MLFQ + 资源感知）
> **版本**: v1.0.0
> **日期**: 2026-07-31
> **状态**: 设计阶段

---

## 1. 概述

实现统一智能体调度引擎，提供加权公平队列（WFQ）+ 多级反馈队列（MLFQ）+ 优先级队列混合、资源感知调度（GPU/内存/Token/优先级）、抢占策略、弹性降级、调度性能分析与可视化。

## 2. 对标产品

- **Kubernetes Scheduler**: 资源声明 + 节点选择 + 公平调度
- **Linux CFS**: Completely Fair Scheduler
- **YARN**: Capacity Scheduler + Fair Scheduler
- **Celery**: 优先级队列 + 速率限制

## 3. 核心类型

### 3.1 任务定义

```typescript
export interface SchedulableTask {
  id: string;
  name: string;
  type: 'workflow' | 'agent' | 'tool' | 'code' | 'llm';
  priority: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;  // 0-9
  weight: number;           // WFQ 权重（0-100）
  deadline?: number;        // 截止时间（ms）
  estimatedDurationMs?: number;
  requirements: ResourceRequirements;
  payload: unknown;
  callback?: string;        // 任务来源引用
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
}
```

### 3.2 资源需求

```typescript
export interface ResourceRequirements {
  gpu?: { vramMb: number; minComputeCapability?: number };
  memory?: { minMb: number; maxMb: number };
  cpu?: { minCores: number; estimatedLoadPercent: number };
  tokens?: { maxInputTokens: number; maxOutputTokens: number; budgetUsd: number };
  bandwidth?: { minMbps: number };
  modelCapabilities?: { codeGeneration?: number; reasoning?: number; longContext?: number };
  latency?: { maxMs: number };
}
```

### 3.3 资源池

```typescript
export interface ResourcePool {
  id: string;
  name: string;
  type: 'agent' | 'device' | 'cluster';
  available: ResourceCapacity;
  total: ResourceCapacity;
  reserved: ResourceCapacity;
  agents: string[];  // 关联的 agent/device IDs
  load: number;      // 0-100
  lastUpdated: number;
  metadata?: Record<string, unknown>;
}
```

### 3.4 资源容量

```typescript
export interface ResourceCapacity {
  gpu?: { vramMb: number };
  memory?: { totalMb: number; availableMb: number };
  cpu?: { totalCores: number; availableCores: number; usagePercent: number };
  tokens?: { budgetPerHour: number; usedThisHour: number };
  bandwidth?: { totalMbps: number; availableMbps: number };
  slots?: { total: number; available: number };
}
```

### 3.5 调度策略

```typescript
export interface SchedulingPolicy {
  id: string;
  name: string;
  description: string;
  algorithm: 'fifo' | 'priority' | 'wfq' | 'mlfq' | 'deadline' | 'hybrid';
  weights?: { priority: number; weight: number; deadline: number; resources: number };
  preemptive: boolean;
  timeSliceMs?: number;     // 时间片（MLFQ）
  agingEnabled: boolean;    // 防止 starvation
  agingThresholdMs?: number;
  defaultDeadlineMs?: number;
  enabled: boolean;
}
```

### 3.6 调度事件

```typescript
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
```

### 3.7 性能统计

```typescript
export interface SchedulingStats {
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
  totalPreempted: number;
  currentQueued: number;
  currentRunning: number;
  
  // 延迟统计
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  latencyMax: number;
  
  // 队列统计
  queueLengthByPriority: Record<string, number>;
  queueLengthByType: Record<string, number>;
  
  // 资源统计
  poolUtilization: Record<string, number>;
  resourceUtilization: {
    gpu: number;
    memory: number;
    cpu: number;
    tokens: number;
  };
  
  // 抢占统计
  preemptionsByReason: Record<string, number>;
  timeoutsByType: Record<string, number>;
}
```

## 4. 核心 API

### 4.1 任务管理

```typescript
class AgentSchedulerEngine {
  // 提交任务
  submit(task: Omit<SchedulableTask, 'id' | 'status' | 'attempts' | 'createdAt' | 'submittedAt'>): SchedulableTask;
  
  // 取消任务
  cancel(taskId: string): boolean;
  
  // 获取任务
  getTask(taskId: string): SchedulableTask | undefined;
  
  // 任务列表
  listTasks(filter?: TaskFilter): SchedulableTask[];
}
```

### 4.2 资源池管理

```typescript
class AgentSchedulerEngine {
  // 注册资源池
  registerPool(pool: Omit<ResourcePool, 'lastUpdated'>): ResourcePool;
  
  // 更新资源
  updatePoolCapacity(poolId: string, capacity: Partial<ResourceCapacity>): void;
  
  // 资源预留
  reserveResources(taskId: string, poolId: string, requirements: ResourceRequirements): boolean;
  
  // 资源释放
  releaseResources(taskId: string, poolId: string): void;
}
```

### 4.3 调度策略

```typescript
class AgentSchedulerEngine {
  // 策略管理
  createPolicy(policy: Omit<SchedulingPolicy, 'id'>): SchedulingPolicy;
  setActivePolicy(policyId: string): void;
  getActivePolicy(): SchedulingPolicy;
  listPolicies(): SchedulingPolicy[];
}
```

### 4.4 调度控制

```typescript
class AgentSchedulerEngine {
  // 启动调度
  start(): void;
  stop(): void;
  
  // 暂停/恢复
  pause(): void;
  resume(): void;
  
  // 抢占
  preempt(taskId: string, reason: string): boolean;
  
  // 重试
  retry(taskId: string): boolean;
}
```

### 4.5 队列操作

```typescript
class AgentSchedulerEngine {
  // 队列查询
  getQueue(filter?: QueueFilter): SchedulableTask[];
  getRunningTasks(): SchedulableTask[];
  
  // 队列调整
  promote(taskId: string): boolean;     // 提升优先级
  demote(taskId: string): boolean;      // 降低优先级
  requeue(taskId: string): boolean;     // 重新入队
}
```

### 4.6 性能分析

```typescript
class AgentSchedulerEngine {
  // 统计
  getStats(): SchedulingStats;
  
  // 历史
  getSchedulingHistory(filter?: EventFilter): SchedulingEvent[];
  
  // 导出
  exportReport(): SchedulingReport;
}
```

## 5. 预置调度策略

### 5.1 Priority First（默认）
- 算法：priority
- 抢占：是
- 适用：实时性要求高

### 5.2 Fair Share（公平分享）
- 算法：wfq
- 权重：所有任务 1
- 抢占：否
- 适用：多租户公平

### 5.3 MLFQ Anti-Starvation
- 算法：mlfq
- 时间片：100ms
- Aging：是
- 适用：通用场景

### 5.4 Deadline Driven
- 算法：deadline
- 抢占：是
- 适用：实时任务

### 5.5 Hybrid（混合）
- 算法：hybrid
- 权重：priority 0.4 + weight 0.2 + deadline 0.2 + resources 0.2
- 抢占：是
- 适用：复杂场景

## 6. 预置资源池

### 6.1 Cloud Pool
- GPU: NVIDIA A100 (80GB)
- 内存: 256GB
- CPU: 32 cores
- Tokens: 1M/hour

### 6.2 Edge Pool
- GPU: Apple Silicon (16GB)
- 内存: 32GB
- CPU: 8 cores
- Tokens: 0 (local)

### 6.3 Mobile Pool
- 内存: 8GB
- CPU: 4 cores
- Tokens: 0 (local)

## 7. 事件系统

```typescript
export type SchedulerEvent =
  | 'task-submitted'
  | 'task-queued'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-preempted'
  | 'task-resumed'
  | 'task-retrying'
  | 'task-timed-out'
  | 'task-downgraded'
  | 'pool-registered'
  | 'pool-updated'
  | 'pool-depleted'
  | 'pool-recovered'
  | 'policy-changed'
  | 'scheduler-started'
  | 'scheduler-stopped'
  | 'scheduler-paused'
  | 'scheduler-resumed';
```

## 8. 默认配置

```typescript
export const DEFAULT_SCHEDULER_CONFIG = {
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
```

## 9. 单例模式

```typescript
export function getDefaultAgentSchedulerEngine(): AgentSchedulerEngine;
export function resetDefaultAgentSchedulerEngine(): void;
```

## 10. 单元测试覆盖

| 类别 | 测试数 | 覆盖点 |
|------|--------|--------|
| 工具函数 | 5 | generateXxxId |
| 初始化 | 4 | 默认配置 + 预置策略/资源池 |
| 任务管理 | 10 | submit/cancel/get/list/promote/demote |
| 资源池管理 | 8 | register/update/reserve/release |
| 调度策略 | 8 | create/setActive/list + 5 种算法 |
| 优先级队列 | 6 | enqueue/dequeue + 优先级排序 |
| WFQ | 5 | 公平权重计算 |
| MLFQ | 5 | 多级 + aging |
| 抢占 | 5 | preempt + 恢复 |
| 资源感知 | 6 | 资源匹配 + 降级 |
| 弹性降级 | 4 | 超时降级 + 重试 |
| 性能分析 | 6 | p50/p95/p99 + 统计 |
| 历史 | 4 | 查询 + 过滤 |
| 持久化 | 3 | export/import |
| 事件 | 4 | subscribe/trigger |
| 控制 | 4 | start/stop/pause/resume |
| 单例 | 2 | getDefault/resetDefault |
| **合计** | **~89** | |

## 11. 验收标准

- ✅ 5 种调度算法（FIFO / Priority / WFQ / MLFQ / Deadline / Hybrid）
- ✅ 资源感知（GPU / 内存 / CPU / Token / 带宽 / 能力）
- ✅ 抢占策略（preemptive / cooperative）
- ✅ Aging 防 starvation
- ✅ 弹性降级（超时 / 资源不足）
- ✅ 性能分析（p50/p95/p99 + 队列 + 资源利用率）
- ✅ 调度历史 + 事件订阅
- ✅ 89+ 单元测试通过
- ✅ TypeScript 0 错误
- ✅ 与 `costThresholdAlertEngine` / `multiTaskOrchestrator` 兼容

## 12. 依赖与集成

### 依赖
- 无外部依赖（纯前端实现）

### 集成
- 可被 `workflowOrchestratorEngine` 调用（调度 DAG 节点）
- 可被 `agentCommunicationEngine` 调用（消息优先级排序）
- 可被 `costThresholdAlertEngine` 调用（成本感知调度）
- UI 面板: `AgentSchedulerPanel.tsx`
