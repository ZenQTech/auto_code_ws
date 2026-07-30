# Cycle 24 SPEC: Parallel Multi-Task Orchestration

## 概述

实现一个**多任务并行编排引擎**，让用户能同时运行多个 vibe coding 任务（PRD 撰写、架构设计、单元测试、UI 优化等），实时观察各任务的进度/输出/成本，并支持任务间的依赖编排与冲突避免。

## 设计目标

1. **并行执行**：支持 5-10 个 SOLO 任务同时运行（参考 TRAE Pro 10 concurrent / Ultra 20 concurrent）
2. **实时可视化**：每个任务的进度、token 消耗、当前活动 step 实时更新
3. **依赖编排**：任务可以声明前置依赖，自动按拓扑排序执行
4. **资源隔离**：每个任务使用独立 worktree / 端口 / 临时文件
5. **冲突避免**：文件修改冲突检测、API 限流感知、成本预算控制

## 核心功能

### 1. 任务类型 (TaskType)

| 类型 | 描述 | 资源需求 |
|------|------|----------|
| `requirement` | 需求分析/PRD 撰写 | 低（仅 LLM 调用） |
| `architecture` | 架构设计/接口定义 | 中（可能需要搜索） |
| `implementation` | 代码实现 | 高（需要 worktree + 工具调用） |
| `testing` | 测试生成/执行 | 中（需要 worktree） |
| `review` | 代码评审/修复 | 中（需要读取 diff） |
| `documentation` | 文档生成 | 低（仅 LLM 调用） |
| `refactor` | 代码重构 | 高（需要 worktree） |
| `deployment` | 部署/集成 | 中（需要外部 API） |

### 2. 数据结构

```typescript
interface MultiTask {
  id: string;
  name: string;
  type: TaskType;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: number;         // 0-9, 9 最高
  dependsOn: string[];      // 前置任务 ID 列表
  blockedBy: string[];      // 运行时阻塞任务 ID
  progress: number;         // 0-100
  currentStep?: string;     // 当前 step 描述
  totalSteps: number;
  completedSteps: number;
  startedAt?: number;
  finishedAt?: number;
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  costSoFar: number;        // USD
  tokensConsumed: { input: number; output: number };
  model: string;            // 使用的模型
  worktreeId?: string;      // worktree 隔离 ID
  branch?: string;          // Git 分支
  files: string[];          // 涉及的文件路径
  result?: string;          // 任务最终输出
  error?: { code: string; message: string; stack?: string };
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface MultiTaskConfig {
  maxConcurrent: number;    // 最大并发数（默认 5）
  maxRetries: number;       // 单任务最大重试次数（默认 2）
  totalBudget: number;      // 总预算（USD，默认 10）
  perTaskBudget: number;    // 单任务预算（默认 2）
  conflictPolicy: 'detect' | 'queue' | 'allow';  // 文件冲突策略
  autoStart: boolean;       // 任务创建后自动开始
  worktreeIsolation: boolean;  // 是否默认使用 worktree
}

interface OrchestrationStats {
  totalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  averageDurationMs: number;
  concurrency: number;
  conflictCount: number;
}
```

### 3. 核心 API

```typescript
class MultiTaskOrchestrator {
  // 创建任务
  createTask(input: Omit<MultiTask, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'progress' | 'costSoFar' | 'tokensConsumed' | 'completedSteps' | 'retryCount'>): MultiTask;
  createBatch(inputs: ...): MultiTask[];

  // 执行控制
  start(taskId: string): void;
  startBatch(taskIds: string[]): Promise<void>;
  pause(taskId: string): void;
  resume(taskId: string): void;
  cancel(taskId: string): void;
  retry(taskId: string): void;

  // 查询
  getTask(taskId: string): MultiTask | null;
  listTasks(filter?: Partial<MultiTask>): MultiTask[];
  getReadyTasks(): MultiTask[];  // 可立即开始的任务
  getRunningTasks(): MultiTask[];
  getStats(): OrchestrationStats;

  // 进度更新（供外部 Worker 调用）
  updateProgress(taskId: string, progress: number, currentStep?: string): void;
  recordCost(taskId: string, cost: number, tokens: { input: number; output: number }): void;
  completeTask(taskId: string, result: string): void;
  failTask(taskId: string, error: { code: string; message: string }): void;

  // 依赖管理
  resolveDependencies(tasks: MultiTask[]): MultiTask[];  // 拓扑排序
  getDependents(taskId: string): MultiTask[];
  getDependencies(taskId: string): MultiTask[];

  // 冲突检测
  detectConflicts(tasks: MultiTask[]): Array<{ taskA: string; taskB: string; files: string[] }>;
  reserveFiles(taskId: string, files: string[]): boolean;
  releaseFiles(taskId: string): void;

  // 预算控制
  getRemainingBudget(): number;
  isOverBudget(): boolean;

  // 事件
  on(type: OrchestratorEventType, handler: Function): () => void;
}
```

### 4. UI 面板（MultiTaskOrchestrationPanel）

布局：
- **Top Bar**：统计指标（活跃数/已完成/失败/总成本/并发数）
- **Control Bar**：批量开始/暂停/取消 + 创建任务按钮 + 预算滑块
- **Task Grid**：任务卡片网格（每卡片显示进度条、当前 step、成本、状态徽章）
- **Dependency Graph**：可切换的依赖关系图（节点 + 边）
- **Conflict Watcher**：冲突警告列表
- **Task Detail Drawer**：右侧抽屉显示任务详情和实时日志

功能：
- 创建任务（向导：选择类型/输入描述/设置依赖/分配资源）
- 拖拽排序优先级
- 实时进度条 + 当前活动 step
- 一键重试失败任务
- 任务间共享上下文
- 冲突文件高亮 + 解决方案提示

## 验收标准

### 功能验收
- [ ] 支持 8 种任务类型
- [ ] 支持 5-10 个并发任务（可配置）
- [ ] 拓扑排序正确处理依赖关系
- [ ] 文件冲突检测准确率 > 95%
- [ ] 预算超限时自动暂停新任务
- [ ] 任务失败自动重试（最多 N 次）
- [ ] 任务支持暂停/恢复/取消
- [ ] 实时事件流（started/progress/step/completed/failed/cancelled）
- [ ] 任务完成结果保存到 metadata

### 性能验收
- 100 个任务的拓扑排序 < 10ms
- 并发调度决策 < 5ms
- 进度更新延迟 < 100ms

### 兼容性验收
- TypeScript 0 错误
- 全量测试套件 100% 通过
- 与现有 BackgroundTasksEngine 兼容（共存）
- 与现有 WorktreeEngine 集成

## 实施计划

1. **Phase 1**：核心引擎 `frontend/src/utils/multiTaskOrchestrator.ts` + 类型定义
2. **Phase 2**：单元测试 `frontend/src/utils/multiTaskOrchestrator.test.ts`（~50 测试）
3. **Phase 3**：UI 面板 `frontend/src/components/MultiTaskOrchestrationPanel.tsx` + 组件测试
4. **Phase 4**：集成到 App.tsx + BrandHeader 菜单项 + 与 BackgroundTasksPanel 互链
5. **Phase 5**：E2E 测试 `tests/test_e2e_cycle24_part2.sh`
6. **Phase 6**：文档 + Git 提交

## 与现有功能集成

- **BackgroundTasksEngine**：MultiTaskOrchestrator 是其超集，支持多类型 + 依赖
- **WorktreePanel**：每个 implementation/refactor/testing 任务自动分配独立 worktree
- **BestOfNPanel**：在 multi-task 场景下作为 sub-task 类型
- **ModelRouterPanel**：根据任务类型自动选择模型

---

**创建日期**: 2026-07-29
**负责 Agent**: Hermes AI Agent
**目标 Cycle**: Cycle 24 P0-2
