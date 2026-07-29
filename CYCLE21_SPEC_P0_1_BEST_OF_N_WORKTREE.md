# Cycle 21 P0-1 SPEC: Best-of-N × Worktree 协同引擎

> **任务编号**: G21-01
> **严重程度**: P0 极高
> **目标版本**: v6.48.0
> **创建日期**: 2026-07-29

---

## 一、任务目标

实现 `BestOfNWorktreeCoordinator` 引擎，联动 WorktreeManager 和 MultiModelExecutor，为 Best-of-N 多模型并行场景提供自动 worktree 隔离，对标 Cursor 3.0 `/best-of-n` 命令。

## 二、需求规格

### 2.1 功能需求

| 编号 | 功能 | 描述 |
|------|------|------|
| FR-01 | 协同启动 | `launch(prompt, models)` 自动为每个模型创建隔离 worktree |
| FR-02 | 并行执行 | 在各自 worktree 中并行执行模型调用 |
| FR-03 | 状态查询 | `getCandidateStates()` 返回所有候选 worktree 状态 |
| FR-04 | 结果对比 | `compareCandidates()` 生成结构化对比分析 |
| FR-05 | 应用候选 | `applyCandidate(candidateId)` 合并最佳 worktree 到主分支 |
| FR-06 | 丢弃候选 | `discardCandidate(candidateId)` 清理非选中 worktree |
| FR-07 | Worktree 池 | 复用 idle worktree，减少创建销毁开销 |
| FR-08 | 结果缓存 | 相同 prompt+model 组合复用上次结果（TTL 5min） |
| FR-09 | 资源限制 | 限制最大并发 worktree 数（默认 4，可配置） |
| FR-10 | 进度追踪 | 每个候选独立 status，独立取消 |

### 2.2 非功能需求

| 编号 | 指标 | 目标值 |
|------|------|--------|
| NFR-01 | 单元测试覆盖率 | ≥ 80% |
| NFR-02 | TypeScript 错误 | 0 |
| NFR-03 | 引擎启动时间 | < 50ms |
| FR-04 | Worktree 创建时间 | < 200ms |

## 三、接口设计

### 3.1 数据结构

```typescript
export interface CoordinatorOptions {
  /** 任务描述 */
  taskDescription?: string;
  /** Worktree 基础分支 */
  baseBranch?: string;
  /** Worktree 根目录 */
  worktreeRoot?: string;
  /** 最大并发候选数 */
  maxConcurrent?: number;
  /** 缓存 TTL（毫秒） */
  cacheTtlMs?: number;
  /** 自动合并最佳候选 */
  autoApplyBest?: boolean;
  /** 选择最佳候选的策略 */
  selectionStrategy?: 'manual' | 'fastest' | 'cheapest' | 'highest-rated';
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
}

export interface CoordinatorSession {
  sessionId: string;
  prompt: string;
  models: string[];
  options: CoordinatorOptions;
  candidates: CandidateState[];
  status: 'pending' | 'running' | 'comparing' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  totalDuration?: number;
  selectedCandidateId?: string;
}

export interface CandidateState {
  candidateId: string;
  model: string;
  worktreeId?: string;
  worktreePath?: string;
  status: 'pending' | 'creating-worktree' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'discarded' | 'merged';
  startedAt: number;
  completedAt?: number;
  duration?: number;
  tokens?: { input: number; output: number };
  cost?: number;
  result?: string;
  error?: string;
  diffSummary?: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  cached?: boolean;
}

export interface ComparisonResult {
  sessionId: string;
  candidates: CandidateComparison[];
  recommendation?: {
    candidateId: string;
    reason: string;
  };
  comparisonMetrics: string[];
  generatedAt: number;
}

export interface CandidateComparison {
  candidateId: string;
  model: string;
  worktreeId: string;
  score: number;  // 0-100
  strengths: string[];
  weaknesses: string[];
  metrics: {
    duration: number;
    cost: number;
    tokens: { input: number; output: number };
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  diff: string;
}

export interface ApplyResult {
  candidateId: string;
  worktreeId: string;
  mergedAt: number;
  mergeCommit?: string;
  conflicts?: string[];
  success: boolean;
  error?: string;
}
```

### 3.2 核心方法

```typescript
export class BestOfNWorktreeCoordinator {
  launch(prompt: string, models: string[], options?: CoordinatorOptions): Promise<CoordinatorSession>;
  getSession(sessionId: string): CoordinatorSession | null;
  listSessions(filter?: SessionFilter): CoordinatorSession[];
  getCandidateStates(sessionId: string): CandidateState[];
  compareCandidates(sessionId: string, options?: CompareOptions): Promise<ComparisonResult>;
  applyCandidate(sessionId: string, candidateId: string, options?: ApplyOptions): Promise<ApplyResult>;
  discardCandidate(sessionId: string, candidateId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  cleanupIdle(options?: CleanupOptions): Promise<number>;
  
  // 单例
  static getInstance(): BestOfNWorktreeCoordinator;
  static resetInstance(): void;
}
```

## 四、验收标准

- ✅ BestOfNWorktreeCoordinator 类完整实现
- ✅ Worktree 池机制正常
- ✅ 结果缓存生效
- ✅ 单元测试覆盖 80%+ 场景
- ✅ BestOfNCoordinatorPanel UI 完整渲染
- ✅ 与 WorktreeManager、MultiModelExecutor 联动
- ✅ App.tsx 集成 + ErrorBoundary
- ✅ 文档完整（中文注释 + 函数注释）

---

**SPEC 完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
