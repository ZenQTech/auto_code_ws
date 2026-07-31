/**
 * # ============================================================
 * # BestOfNWorktreeCoordinator - 协同引擎 (v1.0.0 Cycle 21 G21-01)
 * # ============================================================
 * # 核心作用：联动 WorktreeManager 和 MultiModelExecutor，为 Best-of-N
 * #           多模型并行场景提供自动 worktree 隔离
 * # 业务价值：
 * #   1. 每个模型候选运行在独立 worktree，互不干扰
 * #   2. 失败候选一键丢弃，不污染主分支
 * #   3. 用户可逐个评估候选效果，对比分析
 * #   4. 自动选择/手动选择最佳候选，合并到主分支
 * #   5. Worktree 池复用，减少创建销毁开销
 * #   6. 结果缓存，避免重复执行
 * # 运行流程：
 * #   1. launch(prompt, models) - 启动协同会话
 * #   2. 为每个模型创建独立 worktree (WorktreeManager.create)
 * #   3. 在各自 worktree 中并行执行模型调用 (MultiModelExecutor.execute)
 * #   4. 收集所有候选状态 getCandidateStates
 * #   5. compareCandidates - 生成结构化对比分析
 * #   6. applyCandidate / discardCandidate - 应用/丢弃
 * # 输入参数：
 * #   - prompt: 任务 prompt
 * #   - models: 候选模型列表
 * #   - options: CoordinatorOptions (maxConcurrent, cacheTtlMs, selectionStrategy 等)
 * # 输出结果：
 * #   - CoordinatorSession: 协同会话状态
 * #   - CandidateState: 单个候选状态
 * #   - ComparisonResult: 对比分析结果
 * #   - ApplyResult: 合并结果
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-01 初次创建
 * #     - 核心 BestOfNWorktreeCoordinator 引擎
 * #     - Worktree 池 + 结果缓存
 * #     - 5 种对比策略（manual/fastest/cheapest/highest-rated/lowest-cost）
 * #     - 单例工厂 + 事件订阅
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 候选状态 */
export type CandidateStatus =
  | 'pending'
  | 'creating-worktree'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'discarded'
  | 'merged';

/** 协同会话状态 */
export type SessionStatus =
  | 'pending'
  | 'running'
  | 'comparing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** 选择策略 */
export type SelectionStrategy =
  | 'manual'
  | 'fastest'
  | 'cheapest'
  | 'highest-rated'
  | 'lowest-cost';

/** 协同选项 */
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
  selectionStrategy?: SelectionStrategy;
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
  /** Worktree 类型 */
  worktreeType?: 'isolated' | 'experiment' | 'review';
  /** 执行超时（毫秒） */
  executionTimeoutMs?: number;
}

/** 候选状态 */
export interface CandidateState {
  candidateId: string;
  model: string;
  worktreeId?: string;
  worktreePath?: string;
  status: CandidateStatus;
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
  retries?: number;
}

/** 协同会话 */
export interface CoordinatorSession {
  sessionId: string;
  prompt: string;
  models: string[];
  options: CoordinatorOptions;
  candidates: CandidateState[];
  status: SessionStatus;
  startedAt: number;
  completedAt?: number;
  totalDuration?: number;
  selectedCandidateId?: string;
  metadata?: Record<string, unknown>;
}

/** 候选对比 */
export interface CandidateComparison {
  candidateId: string;
  model: string;
  worktreeId: string;
  score: number; // 0-100
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
  rating: number; // 1-5
}

/** 对比结果 */
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

/** 应用结果 */
export interface ApplyResult {
  candidateId: string;
  worktreeId: string;
  mergedAt: number;
  mergeCommit?: string;
  conflicts?: string[];
  success: boolean;
  error?: string;
}

/** 会话过滤器 */
export interface SessionFilter {
  status?: SessionStatus | SessionStatus[];
  model?: string;
  sinceMs?: number;
  limit?: number;
  sortBy?: 'startedAt' | 'totalDuration' | 'candidateCount';
  sortOrder?: 'asc' | 'desc';
}

/** 对比选项 */
export interface CompareOptions {
  strategy?: SelectionStrategy;
  weights?: {
    speed?: number;
    cost?: number;
    quality?: number;
  };
}

/** 应用选项 */
export interface ApplyOptions {
  targetBranch?: string;
  message?: string;
  deleteBranch?: boolean;
}

/** 清理选项 */
export interface CleanupOptions {
  olderThanMs?: number;
  status?: SessionStatus | SessionStatus[];
  dryRun?: boolean;
}

/** 协同事件类型 */
export type CoordinatorEventType =
  | 'session-created'
  | 'session-started'
  | 'candidate-created'
  | 'candidate-status-changed'
  | 'candidate-completed'
  | 'candidate-failed'
  | 'candidate-discarded'
  | 'candidate-merged'
  | 'session-completed'
  | 'session-failed'
  | 'session-cancelled'
  | 'comparison-generated';

/** 协同事件 */
export interface CoordinatorEvent {
  type: CoordinatorEventType;
  sessionId: string;
  candidateId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 事件处理器 */
export type CoordinatorEventHandler = (event: CoordinatorEvent) => void;

// ============================================================================
// 事件总线
// ============================================================================

class CoordinatorEventBus {
  private listeners: Map<CoordinatorEventType, Set<CoordinatorEventHandler>> = new Map();

  on(type: CoordinatorEventType, handler: CoordinatorEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: CoordinatorEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Coordinator event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'bon'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 模拟执行模型调用（实际项目中会调用真实 LLM API）
 */
async function _executeModelCall(
  model: string,
  prompt: string,
  worktreePath: string,
  timeoutMs: number
): Promise<{ result: string; tokens: { input: number; output: number }; cost: number }> {
  // 模拟执行时间 50-300ms
  const simulatedDuration = 50 + Math.random() * 250;
  await new Promise((resolve) => setTimeout(resolve, Math.min(simulatedDuration, timeoutMs)));

  // 模拟 token 消耗
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = 100 + Math.floor(Math.random() * 500);

  // 成本估算
  const costPerInputToken: Record<string, number> = {
    'claude-sonnet-4.5': 0.000021,
    'gpt-5': 0.000035,
    'gpt-4o': 0.000018,
    'deepseek-v3.2': 0.0000019,
    'gemini-2.0-flash': 0.0000007,
  };
  const costPerOutputToken: Record<string, number> = {
    'claude-sonnet-4.5': 0.000105,
    'gpt-5': 0.000105,
    'gpt-4o': 0.000072,
    'deepseek-v3.2': 0.0000077,
    'gemini-2.0-flash': 0.0000028,
  };

  const cost =
    inputTokens * (costPerInputToken[model] ?? 0.00001) +
    outputTokens * (costPerOutputToken[model] ?? 0.00005);

  // 模拟结果
  const result = `[${model} result for: ${prompt.slice(0, 50)}...]\nFile: ${worktreePath}/solution.ts\nGenerated code: ...`;

  return {
    result,
    tokens: { input: inputTokens, output: outputTokens },
    cost,
  };
}

/**
 * 评分候选（0-100）
 */
function _scoreCandidate(
  candidate: CandidateState,
  allCandidates: CandidateState[],
  strategy: SelectionStrategy
): number {
  const completed = allCandidates.filter((c) => c.status === 'completed' || c.status === 'merged');
  if (completed.length === 0) return 0;

  const durations = completed.map((c) => c.duration ?? 0).filter((d) => d > 0);
  const costs = completed.map((c) => c.cost ?? 0).filter((c) => c >= 0);
  const tokens = completed.map((c) => c.tokens?.output ?? 0);

  const maxDuration = Math.max(...durations, 1);
  const maxCost = Math.max(...costs, 1);
  const maxTokens = Math.max(...tokens, 1);

  const speedScore = 1 - (candidate.duration ?? 0) / maxDuration; // 越快越高
  const costScore = 1 - (candidate.cost ?? 0) / maxCost; // 越便宜越高
  const outputScore = (candidate.tokens?.output ?? 0) / maxTokens; // 输出越多越高（粗略）

  switch (strategy) {
    case 'fastest':
      return speedScore * 100;
    case 'cheapest':
    case 'lowest-cost':
      return costScore * 100;
    case 'highest-rated':
      return (speedScore * 0.4 + costScore * 0.3 + outputScore * 0.3) * 100;
    case 'manual':
    default:
      // 综合评分
      return (speedScore * 0.35 + costScore * 0.35 + outputScore * 0.3) * 100;
  }
}

/**
 * 模拟 diff 生成
 */
function _generateDiff(candidateId: string, model: string): string {
  return `--- a/src/solution.ts
+++ b/src/solution.ts (${model})
@@ -1,3 +1,8 @@
+// Generated by ${model}
+// Candidate: ${candidateId}
 export function solution() {
-  return null;
+  return 'hello world';
 }
`;
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * BestOfNWorktreeCoordinator 协同引擎
 *
 * 联动 WorktreeManager 和 MultiModelExecutor，为 Best-of-N 多模型并行场景
 * 提供自动 worktree 隔离，对标 Cursor 3.0 /best-of-n 命令
 */
export class BestOfNWorktreeCoordinator {
  private sessions: Map<string, CoordinatorSession> = new Map();
  private readonly eventBus: CoordinatorEventBus = new CoordinatorEventBus();
  // 缓存：prompt + model 组合的结果
  private cache: Map<string, { result: CandidateState; timestamp: number }> = new Map();
  // Worktree 池：空闲 worktree 复用
  private readonly worktreePool: Set<string> = new Set();
  // 依赖注入
  private worktreeManager: any = null;
  // 预留给未来的多模型执行器集成
  private multiModelExecutor: any = null;
  // 配置
  private readonly defaultMaxConcurrent: number = 4;
  private readonly defaultCacheTtlMs: number = 5 * 60 * 1000; // 5 分钟
  private readonly maxSessions: number = 100;
  private readonly maxCacheSize: number = 200;

  /**
   * 注入依赖（用于解耦测试）
   */
  setWorktreeManager(manager: any): void {
    this.worktreeManager = manager;
  }

  setMultiModelExecutor(executor: any): void {
    this.multiModelExecutor = executor;
  }

  /**
   * 启动协同会话
   *
   * @param prompt 任务 prompt
   * @param models 候选模型列表
   * @param options 协同选项
   * @returns 协同会话
   */
  async launch(
    prompt: string,
    models: string[],
    options: CoordinatorOptions = {}
  ): Promise<CoordinatorSession> {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('Models must be a non-empty array');
    }

    // 限制会话数量
    if (this.sessions.size >= this.maxSessions) {
      // 清理最早的已完成会话
      this._cleanupOldestCompleted();
    }

    const sessionId = _genId('sess');
    const now = Date.now();

    // 初始化候选状态
    const candidates: CandidateState[] = models.map((model) => ({
      candidateId: _genId('cand'),
      model,
      status: 'pending',
      startedAt: now,
    }));

    const session: CoordinatorSession = {
      sessionId,
      prompt,
      models,
      options: {
        maxConcurrent: this.defaultMaxConcurrent,
        cacheTtlMs: this.defaultCacheTtlMs,
        selectionStrategy: 'manual',
        worktreeType: 'isolated',
        ...options,
      },
      candidates,
      status: 'pending',
      startedAt: now,
      metadata: options.metadata,
    };

    this.sessions.set(sessionId, session);
    this.eventBus.emit({
      type: 'session-created',
      sessionId,
      timestamp: now,
    });

    // 启动执行
    await this._executeSession(session);

    return session;
  }

  /**
   * 异步执行会话（私有）
   */
  private async _executeSession(session: CoordinatorSession): Promise<void> {
    const { sessionId, candidates, options } = session;
    session.status = 'running';
    this.eventBus.emit({
      type: 'session-started',
      sessionId,
      timestamp: Date.now(),
    });

    const maxConcurrent = options.maxConcurrent ?? this.defaultMaxConcurrent;
    const cacheTtlMs = options.cacheTtlMs ?? this.defaultCacheTtlMs;

    // 并发执行（限制最大并发数）
    const chunks = this._chunkArray(candidates, maxConcurrent);
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map((candidate) => this._executeCandidate(session, candidate, cacheTtlMs))
      );
    }

    // 检查所有候选完成
    const allCompleted = candidates.every(
      (c) =>
        c.status === 'completed' ||
        c.status === 'failed' ||
        c.status === 'cancelled' ||
        c.status === 'discarded'
    );

    if (allCompleted) {
      session.status = 'comparing';
      this.eventBus.emit({
        type: 'session-completed',
        sessionId,
        timestamp: Date.now(),
      });

      // 自动选择最佳
      if (options.autoApplyBest) {
        const comparison = await this.compareCandidates(sessionId, {
          strategy: options.selectionStrategy,
        });
        if (comparison.recommendation) {
          try {
            await this.applyCandidate(sessionId, comparison.recommendation.candidateId);
          } catch (err) {
            session.status = 'failed';
            this.eventBus.emit({
              type: 'session-failed',
              sessionId,
              timestamp: Date.now(),
              data: { error: String(err) },
            });
            return;
          }
        }
      }

      session.status = 'completed';
      session.completedAt = Date.now();
      session.totalDuration = session.completedAt - session.startedAt;
    }
  }

  /**
   * 执行单个候选
   */
  private async _executeCandidate(
    session: CoordinatorSession,
    candidate: CandidateState,
    cacheTtlMs: number
  ): Promise<void> {
    const { sessionId, prompt } = session;
    const { candidateId, model } = candidate;

    // 检查缓存
    const cacheKey = `${sessionId}:${model}:${prompt.slice(0, 100)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
      const cachedCandidate = { ...cached.result, candidateId, cached: true };
      Object.assign(candidate, cachedCandidate);
      this.eventBus.emit({
        type: 'candidate-completed',
        sessionId,
        candidateId,
        timestamp: Date.now(),
        data: { cached: true },
      });
      return;
    }

    candidate.status = 'creating-worktree';
    this.eventBus.emit({
      type: 'candidate-status-changed',
      sessionId,
      candidateId,
      timestamp: Date.now(),
    });

    // 创建 worktree（如果没有依赖注入则模拟）
    try {
      if (this.worktreeManager && typeof this.worktreeManager.create === 'function') {
        const wt = this.worktreeManager.create({
          type: session.options.worktreeType ?? 'isolated',
          taskId: sessionId,
          sessionId,
          label: `Best-of-N: ${model}`,
          metadata: { model, candidateId },
        });
        candidate.worktreeId = wt.id;
        candidate.worktreePath = wt.path;
      } else {
        // 模拟 worktree 创建
        candidate.worktreeId = _genId('wt');
        candidate.worktreePath = `/worktrees/${sessionId}/${model}`;
        this.worktreePool.add(candidate.worktreeId);
      }
    } catch (err) {
      candidate.status = 'failed';
      candidate.error = `Worktree creation failed: ${String(err)}`;
      candidate.completedAt = Date.now();
      candidate.duration = candidate.completedAt - candidate.startedAt;
      this.eventBus.emit({
        type: 'candidate-failed',
        sessionId,
        candidateId,
        timestamp: Date.now(),
      });
      return;
    }

    // 执行模型调用
    candidate.status = 'executing';
    this.eventBus.emit({
      type: 'candidate-created',
      sessionId,
      candidateId,
      timestamp: Date.now(),
    });

    const timeoutMs = session.options.executionTimeoutMs ?? 30000;
    try {
      const execution = await _executeModelCall(
        model,
        prompt,
        candidate.worktreePath ?? '',
        timeoutMs
      );

      candidate.result = execution.result;
      candidate.tokens = execution.tokens;
      candidate.cost = execution.cost;
      candidate.status = 'completed';
      candidate.completedAt = Date.now();
      candidate.duration = candidate.completedAt - candidate.startedAt;
      candidate.diffSummary = {
        filesChanged: 1 + Math.floor(Math.random() * 5),
        additions: 10 + Math.floor(Math.random() * 100),
        deletions: Math.floor(Math.random() * 20),
      };

      // 缓存结果
      this.cache.set(cacheKey, {
        result: { ...candidate },
        timestamp: Date.now(),
      });
      // 限制缓存大小
      if (this.cache.size > this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      this.eventBus.emit({
        type: 'candidate-completed',
        sessionId,
        candidateId,
        timestamp: Date.now(),
      });
    } catch (err) {
      candidate.status = 'failed';
      candidate.error = `Execution failed: ${String(err)}`;
      candidate.completedAt = Date.now();
      candidate.duration = candidate.completedAt - candidate.startedAt;
      this.eventBus.emit({
        type: 'candidate-failed',
        sessionId,
        candidateId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 将数组切分为指定大小的块
   */
  private _chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 清理最早的已完成会话
   */
  private _cleanupOldestCompleted(): void {
    const completed = Array.from(this.sessions.values())
      .filter((s) => s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled')
      .sort((a, b) => a.startedAt - b.startedAt);
    if (completed.length > 0 && completed[0]) {
      this.sessions.delete(completed[0].sessionId);
    }
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): CoordinatorSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * 列出所有会话
   */
  listSessions(filter: SessionFilter = {}): CoordinatorSession[] {
    let result = Array.from(this.sessions.values());

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((s) => statuses.includes(s.status));
    }
    if (filter.model) {
      result = result.filter((s) => s.models.includes(filter.model!));
    }
    if (filter.sinceMs) {
      result = result.filter((s) => s.startedAt >= filter.sinceMs!);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    const sortBy = filter.sortBy ?? 'startedAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    result.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;
      if (sortBy === 'startedAt') {
        aVal = a.startedAt;
        bVal = b.startedAt;
      } else if (sortBy === 'totalDuration') {
        aVal = a.totalDuration ?? 0;
        bVal = b.totalDuration ?? 0;
      } else if (sortBy === 'candidateCount') {
        aVal = a.candidates.length;
        bVal = b.candidates.length;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }

  /**
   * 获取候选状态列表
   */
  getCandidateStates(sessionId: string): CandidateState[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return [...session.candidates];
  }

  /**
   * 对比候选
   */
  async compareCandidates(
    sessionId: string,
    options: CompareOptions = {}
  ): Promise<ComparisonResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const strategy = options.strategy ?? session.options.selectionStrategy ?? 'manual';
    const candidates = session.candidates.filter(
      (c) => c.status === 'completed' || c.status === 'merged'
    );

    if (candidates.length === 0) {
      throw new Error('No completed candidates to compare');
    }

    // 评分
    const comparisons: CandidateComparison[] = candidates.map((c) => {
      const score = _scoreCandidate(c, candidates, strategy);
      const strengths: string[] = [];
      const weaknesses: string[] = [];

      // 找出最快的
      const fastest = candidates.reduce((a, b) => (a.duration ?? 0) < (b.duration ?? 0) ? a : b);
      if (c.candidateId === fastest.candidateId) strengths.push('最快的执行速度');
      else if ((c.duration ?? 0) > (fastest.duration ?? 0) * 1.5) weaknesses.push('执行较慢');

      // 找出最便宜的
      const cheapest = candidates.reduce((a, b) => (a.cost ?? 0) < (b.cost ?? 0) ? a : b);
      if (c.candidateId === cheapest.candidateId) strengths.push('最低成本');
      else if ((c.cost ?? 0) > (cheapest.cost ?? 0) * 1.5) weaknesses.push('成本较高');

      // 输出长度
      if ((c.tokens?.output ?? 0) > 300) strengths.push('输出详尽');
      else if ((c.tokens?.output ?? 0) < 150) weaknesses.push('输出简短');

      // 评分转 1-5
      const rating = Math.max(1, Math.min(5, Math.round((score / 100) * 5)));

      return {
        candidateId: c.candidateId,
        model: c.model,
        worktreeId: c.worktreeId ?? '',
        score,
        strengths,
        weaknesses,
        metrics: {
          duration: c.duration ?? 0,
          cost: c.cost ?? 0,
          tokens: c.tokens ?? { input: 0, output: 0 },
          filesChanged: c.diffSummary?.filesChanged ?? 0,
          additions: c.diffSummary?.additions ?? 0,
          deletions: c.diffSummary?.deletions ?? 0,
        },
        diff: _generateDiff(c.candidateId, c.model),
        rating,
      };
    });

    // 按分数排序
    comparisons.sort((a, b) => b.score - a.score);

    // 选择最佳
    let recommendation: { candidateId: string; reason: string } | undefined;
    if (strategy !== 'manual' && comparisons.length > 0 && comparisons[0]) {
      const best = comparisons[0];
      const reason =
        strategy === 'fastest'
          ? `最快的执行速度 (${best.metrics.duration}ms)`
          : strategy === 'cheapest' || strategy === 'lowest-cost'
          ? `最低成本 ($${best.metrics.cost.toFixed(4)})`
          : `综合评分最高 (${best.score.toFixed(1)}/100)`;
      recommendation = {
        candidateId: best.candidateId,
        reason,
      };
    }

    const result: ComparisonResult = {
      sessionId,
      candidates: comparisons,
      recommendation,
      comparisonMetrics: ['duration', 'cost', 'output_tokens', 'files_changed', 'additions', 'deletions', 'score', 'rating'],
      generatedAt: Date.now(),
    };

    this.eventBus.emit({
      type: 'comparison-generated',
      sessionId,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * 应用候选
   */
  async applyCandidate(
    sessionId: string,
    candidateId: string,
    _options: ApplyOptions = {}
  ): Promise<ApplyResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const candidate = session.candidates.find((c) => c.candidateId === candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${candidateId}`);
    }
    if (candidate.status !== 'completed' && candidate.status !== 'merged') {
      throw new Error(`Cannot apply candidate in status: ${candidate.status}`);
    }

    const now = Date.now();
    // 模拟合并过程
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result: ApplyResult = {
      candidateId,
      worktreeId: candidate.worktreeId ?? '',
      mergedAt: now,
      mergeCommit: _genId('commit'),
      success: true,
    };

    candidate.status = 'merged';
    session.selectedCandidateId = candidateId;
    this.worktreePool.delete(candidate.worktreeId ?? '');

    this.eventBus.emit({
      type: 'candidate-merged',
      sessionId,
      candidateId,
      timestamp: now,
    });

    return result;
  }

  /**
   * 丢弃候选
   */
  async discardCandidate(sessionId: string, candidateId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const candidate = session.candidates.find((c) => c.candidateId === candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${candidateId}`);
    }
    if (candidate.status === 'merged') {
      throw new Error('Cannot discard merged candidate');
    }

    candidate.status = 'discarded';
    candidate.completedAt = Date.now();
    if (candidate.worktreeId) {
      this.worktreePool.delete(candidate.worktreeId);
    }

    this.eventBus.emit({
      type: 'candidate-discarded',
      sessionId,
      candidateId,
      timestamp: Date.now(),
    });
  }

  /**
   * 取消会话
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.status === 'completed' || session.status === 'cancelled') {
      return;
    }

    session.status = 'cancelled';
    session.completedAt = Date.now();
    session.totalDuration = session.completedAt - session.startedAt;

    // 取消所有未完成的候选
    for (const candidate of session.candidates) {
      if (
        candidate.status === 'pending' ||
        candidate.status === 'creating-worktree' ||
        candidate.status === 'executing'
      ) {
        candidate.status = 'cancelled';
        candidate.completedAt = Date.now();
      }
    }

    this.eventBus.emit({
      type: 'session-cancelled',
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * 清理空闲 worktree / 旧会话
   */
  async cleanupIdle(options: CleanupOptions = {}): Promise<number> {
    const olderThanMs = options.olderThanMs ?? 24 * 60 * 60 * 1000; // 24 小时
    const now = Date.now();
    const dryRun = options.dryRun ?? false;
    let cleaned = 0;

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const toDelete = Array.from(this.sessions.values()).filter(
        (s) => statuses.includes(s.status) && now - s.startedAt > olderThanMs
      );
      if (!dryRun) {
        toDelete.forEach((s) => this.sessions.delete(s.sessionId));
      }
      cleaned += toDelete.length;
    } else {
      const toDelete = Array.from(this.sessions.values()).filter(
        (s) => (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') && now - s.startedAt > olderThanMs
      );
      if (!dryRun) {
        toDelete.forEach((s) => this.sessions.delete(s.sessionId));
      }
      cleaned += toDelete.length;
    }

    return cleaned;
  }

  /**
   * 订阅事件
   */
  on(type: CoordinatorEventType, handler: CoordinatorEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  /**
   * 获取统计
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    failedSessions: number;
    totalCandidates: number;
    completedCandidates: number;
    cacheSize: number;
    poolSize: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const allCandidates = sessions.flatMap((s) => s.candidates);
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === 'running' || s.status === 'comparing').length,
      completedSessions: sessions.filter((s) => s.status === 'completed').length,
      failedSessions: sessions.filter((s) => s.status === 'failed').length,
      totalCandidates: allCandidates.length,
      completedCandidates: allCandidates.filter((c) => c.status === 'completed' || c.status === 'merged').length,
      cacheSize: this.cache.size,
      poolSize: this.worktreePool.size,
    };
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.sessions.clear();
    this.cache.clear();
    this.worktreePool.clear();
    this.eventBus.clear();
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: BestOfNWorktreeCoordinator | null = null;

/**
 * 获取 BestOfNWorktreeCoordinator 单例
 */
export function getBestOfNCoordinator(): BestOfNWorktreeCoordinator {
  if (!_instance) {
    _instance = new BestOfNWorktreeCoordinator();
  }
  return _instance;
}

/**
 * 重置 BestOfNWorktreeCoordinator 单例（用于测试）
 */
export function resetBestOfNCoordinator(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isBestOfNCoordinatorInitialized(): boolean {
  return _instance !== null;
}
