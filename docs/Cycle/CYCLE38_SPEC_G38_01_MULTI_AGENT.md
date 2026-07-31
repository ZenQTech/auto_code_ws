# CYCLE38 规格说明书：G38-01 多 Agent 协作引擎（Manager-Worker）

> 周期：Cycle 38  
> 任务 ID：G38-01  
> 模块名称：MultiAgentEngine  
> 版本：v1.0.0  
> 日期：2026-07-31

---

## 一、模块定位

### 1.1 核心作用

实现 Manager Agent 协调多个 Worker Agent 协作完成复杂任务，支持任务分解、并行/串行执行、结果融合、失败重试等高级能力。

### 1.2 对标产品

- **AutoGen**（Microsoft）- GroupChat 多 Agent 模式
- **LangGraph** - Supervisor 多 Agent 编排
- **CrewAI** - Crew 团队协作

### 1.3 与现有模块关系

- **G37-03 AgentLoopEngine**：单 Agent ReAct/Plan-Execute，本模块是其多 Agent 扩展
- **G37-02 ToolUseEngine**：Worker 可调用工具
- **G37-04 RealLLMProvider**：Worker/Manager 可调用真实 LLM

---

## 二、核心数据结构

### 2.1 AgentRole（角色定义）

```typescript
export type AgentRole = 'manager' | 'worker' | 'reviewer' | 'observer';

export interface AgentCapability {
  name: string;            // 能力名：'search' | 'code' | 'analysis' | 'writing' | ...
  description: string;
  proficiency: number;     // 熟练度 0-1
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  capabilities: AgentCapability[];
  systemPrompt?: string;
  llmProvider?: string;    // 默认 'deepseek'
  maxConcurrentTasks?: number;
  timeoutMs?: number;
}
```

### 2.2 Task（任务定义）

```typescript
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: string[];   // 所需能力列表
  priority: TaskPriority;
  dependencies?: string[];          // 依赖的其他任务 ID
  payload?: Record<string, unknown>;
  deadline?: number;                // 截止时间戳
  parentTaskId?: string;            // 父任务（任务分解时）
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
```

### 2.3 Message（消息总线）

```typescript
export type MessageType = 'task_assignment' | 'task_result' | 'status_update' | 'request_help' | 'broadcast' | 'private';

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | 'broadcast';
  type: MessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string;   // 关联任务/会话
}
```

### 2.4 Crew（团队）

```typescript
export interface Crew {
  id: string;
  name: string;
  description?: string;
  agents: AgentDefinition[];       // 包含 1 个 Manager + N 个 Worker
  tasks: TaskDefinition[];
  executionMode: 'sequential' | 'parallel' | 'hybrid';
  startedAt?: number;
  completedAt?: number;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: CrewResult;
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
```

---

## 三、核心组件

### 3.1 ManagerAgent（管理者）

```typescript
export class ManagerAgent {
  constructor(definition: AgentDefinition, options?: ManagerAgentOptions);
  
  // 任务分解：输入复杂任务，输出子任务列表
  async decomposeTask(goal: string, context?: Record<string, unknown>): Promise<TaskDefinition[]>;
  
  // Worker 选择：根据能力匹配最合适的 Worker
  selectWorker(task: TaskDefinition, workers: AgentDefinition[]): AgentDefinition | null;
  
  // 结果融合：合并多个 Worker 输出
  async aggregateResults(results: TaskResult[]): Promise<Record<string, unknown>>;
  
  // 进度监控
  getProgress(crew: Crew): { completed: number; total: number; percent: number };
}
```

**任务分解算法**：
1. LLM 分析用户目标（System Prompt 注入"你是任务分解专家"）
2. 输出 JSON 格式子任务列表
3. 自动注入 dependencies（任务依赖图）
4. 自动注入 requiredCapabilities（能力需求）

**Worker 路由算法**：
1. 过滤 role='worker' 的 Agent
2. 计算任务所需能力与 Worker 能力的匹配分数
3. 选择分数最高且当前空闲的 Worker
4. 若无空闲 Worker 加入队列

### 3.2 WorkerAgent（执行者）

```typescript
export class WorkerAgent {
  constructor(definition: AgentDefinition, options?: WorkerAgentOptions);
  
  // 接收任务并执行
  async executeTask(task: TaskDefinition, context: Record<string, unknown>): Promise<TaskResult>;
  
  // 报告进度
  reportProgress(taskId: string, progress: number, message?: string): void;
  
  // 请求帮助
  async requestHelp(taskId: string, question: string): Promise<string>;
}
```

**任务执行流程**：
1. 接收 TaskDefinition
2. 构造 Prompt：System + Task Description + Context
3. 调用 LLM 生成执行步骤
4. 逐步执行（可调用 Tool）
5. 返回 TaskResult

### 3.3 MessageBus（消息总线）

```typescript
export class MessageBus {
  publish(message: AgentMessage): void;
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void;
  getHistory(agentId?: string): AgentMessage[];
  clear(): void;
}
```

### 3.4 TaskScheduler（任务调度器）

```typescript
export class TaskScheduler {
  schedule(crew: Crew, tasks: TaskDefinition[]): void;
  getReadyTasks(): TaskDefinition[];        // 无依赖且 pending 的任务
  markCompleted(taskId: string, result: TaskResult): void;
  markFailed(taskId: string, error: string): void;
  canRetry(task: TaskDefinition): boolean;  // 是否可重试
}
```

### 3.5 MultiAgentEngine（主类）

```typescript
export class MultiAgentEngine {
  constructor(options?: MultiAgentEngineOptions);
  
  // 创建团队
  createCrew(definition: Omit<Crew, 'id' | 'status' | 'startedAt'>): Crew;
  
  // 注册 Agent
  registerAgent(definition: AgentDefinition): void;
  unregisterAgent(agentId: string): boolean;
  listAgents(filter?: { role?: AgentRole }): AgentDefinition[];
  
  // 执行团队任务
  async executeCrew(crewId: string, options?: ExecuteOptions): Promise<CrewResult>;
  
  // 中止
  cancelCrew(crewId: string, reason?: string): boolean;
  
  // 查询
  getCrew(crewId: string): Crew | undefined;
  listCrews(filter?: { status?: Crew['status'] }): Crew[];
  getTaskResult(crewId: string, taskId: string): TaskResult | undefined;
}
```

---

## 四、执行模式

### 4.1 Sequential（串行）

- 任务按 dependencies 拓扑排序
- 一个任务完成后才执行下一个
- 适合有强依赖关系的场景

### 4.2 Parallel（并行）

- 无依赖任务并发执行
- 适合可独立执行的子任务
- 最大并发数受 Worker 数量限制

### 4.3 Hybrid（混合）

- 按依赖关系分层
- 同层内任务并行
- 跨层任务串行
- 推荐默认模式

---

## 五、错误处理

### 5.1 重试策略

```typescript
interface RetryPolicy {
  maxRetries: number;          // 默认 3
  backoffMs: number;           // 指数退避基数
  retryableErrors: string[];   // 可重试错误码
}
```

### 5.2 故障隔离

- 单个 Worker 失败不影响其他 Worker
- 单个任务失败可配置是否整体中止
- 失败任务自动重试至 maxRetries

---

## 六、性能指标

| 指标 | 目标值 |
|------|--------|
| 任务分解响应 | < 5s（取决于 LLM） |
| 单 Worker 任务执行 | < 30s（可配置） |
| 消息传递延迟 | < 10ms |
| 支持 Worker 数量 | 100+ |
| 支持并发任务数 | 50+ |

---

## 七、测试覆盖

| 测试维度 | 覆盖项 |
|---------|--------|
| ManagerAgent | 任务分解、Worker 选择、结果融合 |
| WorkerAgent | 任务执行、进度报告、帮助请求 |
| MessageBus | 发布/订阅、历史记录 |
| TaskScheduler | 拓扑排序、依赖检测、重试逻辑 |
| MultiAgentEngine | 完整流程、中止、查询 |

**目标测试数**：30+ 单元测试

---

## 八、UI 面板设计

### MultiAgentCrewPanel

- **顶部**：Crew 配置区（名称、Agent 列表、任务列表）
- **中部**：执行模式选择 + 开始/中止按钮
- **底部**：执行进度（任务卡片列表）
- **侧边栏**：消息总线实时日志

---

## 九、修改记录

- 2026-07-31 | v1.0.0 | Cycle 38 G38-01 初次创建
