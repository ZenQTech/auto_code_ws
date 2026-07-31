/**
 * # ============================================================
 * # ReflectionEngine - 反思与自我修正引擎 (v1.0.0 Cycle 38 G38-03)
 * # ============================================================
 * # 核心作用：Reflexion 风格 Agent 自我反思 + 迭代修正
 * #           执行 → 评估 → 反思 → 调整 → 重执行
 * # 对标产品：Reflexion (Stanford) / Self-Refine (MIT) / CRITIC
 * # 运行流程：
 * #   1. Evaluator 多维度评估执行结果
 * #   2. ReflectionGenerator 生成结构化反思
 * #   3. StrategyAdjuster 调整策略
 * #   4. 循环迭代直到通过阈值或达到最大迭代次数
 * #   5. 终止条件：quality-met / max-iterations / no-improvement
 * # 输入参数：任务描述 + 执行器函数 + 迭代配置
 * # 输出结果：ReflexionSession（包含所有迭代记录）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 38 G38-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type ReflectionType = 'success' | 'failure' | 'partial' | 'neutral';
export type TerminationCondition =
  | 'quality-met'
  | 'max-iterations'
  | 'no-improvement'
  | 'budget-exhausted'
  | 'human-cancel';

export interface Reflection {
  id: string;
  type: ReflectionType;
  taskId: string;
  iteration: number;
  evaluation: string;
  lessonsLearned: string[];
  improvementSuggestions: string[];
  emotionalTone: 'positive' | 'neutral' | 'negative';
  importance: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface Evaluation {
  taskId: string;
  iteration: number;
  score: number;
  criteria: EvaluationCriteria[];
  passed: boolean;
  feedback: string;
  evaluator: 'auto' | 'human' | 'llm';
  evaluatedAt: number;
}

export interface EvaluationCriteria {
  name: string;
  weight: number;
  score: number;
  comment?: string;
}

export interface IterationConfig {
  maxIterations: number;
  qualityThreshold: number;
  minImprovementDelta: number;
  earlyStopOnPlateau: boolean;
  plateauWindow: number;
  budgetLimit?: {
    maxTokens?: number;
    maxDurationMs?: number;
    maxCostUsd?: number;
  };
}

export interface TaskExecutionResult {
  output: string;
  success: boolean;
  error?: string;
  toolCalls?: Array<{ tool: string; args: unknown; result: unknown }>;
  steps?: Array<{ thought: string; action: string; observation: string }>;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface IterationRecord {
  iteration: number;
  strategy: string;
  execution: TaskExecutionResult;
  evaluation: Evaluation;
  reflection: Reflection;
  startedAt: number;
  completedAt: number;
}

export interface ReflexionSession {
  id: string;
  taskDescription: string;
  initialStrategy: string;
  iterations: IterationRecord[];
  finalResult?: TaskExecutionResult;
  terminationReason?: TerminationCondition;
  totalDurationMs: number;
  createdAt: number;
}

export interface EvaluatorOptions {
  llmCaller?: (
    prompt: string,
  ) => Promise<{ score: number; feedback: string }>;
  defaultCriteria?: EvaluationCriteria[];
}

export interface ReflectionGeneratorOptions {
  llmCaller?: (prompt: string) => Promise<string>;
}

export interface AdjusterOptions {
  llmCaller?: (prompt: string) => Promise<string>;
}

export interface ReflectionEngineOptions {
  evaluatorOptions?: EvaluatorOptions;
  generatorOptions?: ReflectionGeneratorOptions;
  adjusterOptions?: AdjusterOptions;
  persistKey?: string;
  defaultConfig?: Partial<IterationConfig>;
}

// ============ 工具函数 ============

export function generateId(prefix: string = 'rfl'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_CRITERIA: EvaluationCriteria[] = [
  { name: 'completeness', weight: 0.3, score: 0 },
  { name: 'correctness', weight: 0.4, score: 0 },
  { name: 'clarity', weight: 0.15, score: 0 },
  { name: 'efficiency', weight: 0.15, score: 0 },
];

export const DEFAULT_ITERATION_CONFIG: IterationConfig = {
  maxIterations: 5,
  qualityThreshold: 0.8,
  minImprovementDelta: 0.05,
  earlyStopOnPlateau: true,
  plateauWindow: 2,
};

/**
 * 加权求和计算综合得分
 */
export function calculateWeightedScore(criteria: EvaluationCriteria[]): number {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const sum = criteria.reduce((s, c) => s + c.score * c.weight, 0);
  return sum / totalWeight;
}

/**
 * 基于输出内容的快速启发式评分（无 LLM 时的回退方案）
 */
export function heuristicScore(result: TaskExecutionResult): number {
  let score = 0.5;
  // 成功 +0.2
  if (result.success) score += 0.2;
  // 有输出 +0.1
  if (result.output && result.output.length > 10) score += 0.1;
  // 无错误 +0.1
  if (!result.error) score += 0.1;
  // 步骤数 1-5 之间 +0.05
  const stepCount = result.steps?.length ?? 0;
  if (stepCount >= 1 && stepCount <= 5) score += 0.05;
  // 工具调用有结果 +0.05
  if (result.toolCalls && result.toolCalls.length > 0) score += 0.05;
  return Math.min(1, score);
}

/**
 * 启发式：检测是否处于 plateau
 */
export function isPlateau(
  scores: number[],
  windowSize: number,
  delta: number,
): boolean {
  if (scores.length < windowSize + 1) return false;
  const recent = scores.slice(-windowSize - 1);
  let allStable = true;
  for (let i = 1; i < recent.length; i++) {
    if (Math.abs(recent[i] - recent[i - 1]) > delta) {
      allStable = false;
      break;
    }
  }
  return allStable;
}

// ============ Evaluator ============

export class Evaluator {
  private llmCaller?: (
    prompt: string,
  ) => Promise<{ score: number; feedback: string }>;
  private customCriteria: Map<
    string,
    (result: TaskExecutionResult) => Promise<{ score: number; comment?: string }>
  > = new Map();

  constructor(options?: EvaluatorOptions) {
    this.llmCaller = options?.llmCaller;
  }

  /**
   * 多维度评估
   */
  async evaluate(
    result: TaskExecutionResult,
    criteria: EvaluationCriteria[] = DEFAULT_CRITERIA,
  ): Promise<Evaluation> {
    const filledCriteria: EvaluationCriteria[] = [];

    for (const c of criteria) {
      let score = 0;
      let comment: string | undefined;

      // 优先用自定义评估器
      const custom = this.customCriteria.get(c.name);
      if (custom) {
        const out = await custom(result);
        score = out.score;
        comment = out.comment;
      } else {
        score = this.heuristicForCriterion(c.name, result);
      }

      filledCriteria.push({ ...c, score, comment });
    }

    const totalScore = calculateWeightedScore(filledCriteria);
    const passed = totalScore >= 0.8; // 默认阈值

    // 如果有 LLM caller，使用 LLM 评分微调
    let feedback = this.buildFeedback(filledCriteria, totalScore);
    if (this.llmCaller && !result.success) {
      try {
        const llm = await this.llmCaller(
          `评估以下执行结果（0-1 分）：\n${result.output.slice(0, 500)}`,
        );
        feedback = llm.feedback;
      } catch {
        // 忽略 LLM 失败
      }
    }

    return {
      taskId: '',
      iteration: 0,
      score: totalScore,
      criteria: filledCriteria,
      passed,
      feedback,
      evaluator: this.llmCaller ? 'llm' : 'auto',
      evaluatedAt: Date.now(),
    };
  }

  /**
   * 快速评分（仅 1 个综合分）
   */
  async quickScore(result: TaskExecutionResult): Promise<number> {
    if (this.llmCaller) {
      try {
        const out = await this.llmCaller(
          `快速评分此结果质量（0-1）：\n${result.output.slice(0, 200)}`,
        );
        return out.score;
      } catch {
        // 失败回退到启发式
      }
    }
    return heuristicScore(result);
  }

  /**
   * 注册自定义评估维度
   */
  registerCustomCriterion(
    name: string,
    fn: (result: TaskExecutionResult) => Promise<{ score: number; comment?: string }>,
  ): void {
    this.customCriteria.set(name, fn);
  }

  private heuristicForCriterion(
    name: string,
    result: TaskExecutionResult,
  ): number {
    switch (name) {
      case 'completeness':
        // 输出长度 > 50 认为较完整
        return Math.min(1, result.output.length / 200);
      case 'correctness':
        return result.success && !result.error ? 0.9 : 0.4;
      case 'clarity':
        // 段落数（换行）适中
        const lines = result.output.split('\n').filter((l) => l.trim().length > 0);
        return Math.min(1, lines.length / 5);
      case 'efficiency': {
        const steps = result.steps?.length ?? 1;
        // 1-3 步最优
        if (steps >= 1 && steps <= 3) return 1;
        if (steps <= 5) return 0.8;
        return 0.5;
      }
      default:
        return heuristicScore(result);
    }
  }

  private buildFeedback(criteria: EvaluationCriteria[], total: number): string {
    const summary = criteria
      .map((c) => `${c.name}=${c.score.toFixed(2)}`)
      .join(', ');
    return `综合得分 ${total.toFixed(2)}。维度：${summary}`;
  }
}

// ============ ReflectionGenerator ============

export class ReflectionGenerator {
  private llmCaller?: (prompt: string) => Promise<string>;

  constructor(options?: ReflectionGeneratorOptions) {
    this.llmCaller = options?.llmCaller;
  }

  /**
   * 生成反思
   */
  async generate(
    execution: TaskExecutionResult,
    evaluation: Evaluation,
    previousReflections: Reflection[] = [],
  ): Promise<Reflection> {
    const type = this.inferType(execution, evaluation);
    if (type === 'success') {
      return this.reflectOnSuccess(execution, evaluation, previousReflections);
    }
    if (type === 'failure') {
      return this.reflectOnFailure(execution, evaluation, previousReflections);
    }
    return this.reflectPartial(execution, evaluation, previousReflections);
  }

  /**
   * 成功反思
   */
  private async reflectOnSuccess(
    execution: TaskExecutionResult,
    evaluation: Evaluation,
    previousReflections: Reflection[],
  ): Promise<Reflection> {
    const lessonsLearned = [
      '执行成功完成，所有目标达成',
      `使用了 ${execution.toolCalls?.length ?? 0} 个工具调用`,
      `综合得分 ${evaluation.score.toFixed(2)}，超出阈值`,
    ];
    const improvementSuggestions = [
      '可考虑将此成功模式固化为模板',
      '记录关键参数便于后续复用',
    ];
    const importance = Math.max(0.6, evaluation.score);

    return {
      id: generateId('rfl'),
      type: 'success',
      taskId: evaluation.taskId,
      iteration: evaluation.iteration,
      evaluation: `成功，得分 ${evaluation.score.toFixed(2)}`,
      lessonsLearned,
      improvementSuggestions,
      emotionalTone: 'positive',
      importance,
      createdAt: Date.now(),
      metadata: {
        previousReflectionCount: previousReflections.length,
      },
    };
  }

  /**
   * 失败反思
   */
  private async reflectOnFailure(
    execution: TaskExecutionResult,
    evaluation: Evaluation,
    previousReflections: Reflection[],
  ): Promise<Reflection> {
    const rootCause = execution.error ?? '未知错误';
    const lessonsLearned = [
      `失败原因：${rootCause}`,
      `综合得分 ${evaluation.score.toFixed(2)} 低于阈值`,
      `正确性维度：${evaluation.criteria.find((c) => c.name === 'correctness')?.score.toFixed(2) ?? 'N/A'}`,
    ];

    // 如果有历史反思，提取共性问题
    if (previousReflections.length > 0) {
      const lastReflection = previousReflections[previousReflections.length - 1];
      if (lastReflection.type === 'failure') {
        lessonsLearned.push('连续失败，需要改变策略方向');
        lessonsLearned.push(`上次建议：${lastReflection.improvementSuggestions[0] ?? '无'}`);
      }
    }

    const improvementSuggestions = [
      `针对"${rootCause}"制定规避方案`,
      '增加输入验证或前置检查',
      '尝试更简单的实现路径',
      '分解任务为更小的子任务',
    ];

    return {
      id: generateId('rfl'),
      type: 'failure',
      taskId: evaluation.taskId,
      iteration: evaluation.iteration,
      evaluation: `失败，得分 ${evaluation.score.toFixed(2)}，错误：${rootCause}`,
      lessonsLearned,
      improvementSuggestions,
      emotionalTone: 'negative',
      importance: 0.8,
      createdAt: Date.now(),
      metadata: {
        rootCause,
        previousReflectionCount: previousReflections.length,
      },
    };
  }

  /**
   * 部分成功反思
   */
  private async reflectPartial(
    execution: TaskExecutionResult,
    evaluation: Evaluation,
    previousReflections: Reflection[],
  ): Promise<Reflection> {
    const passedCriteria = evaluation.criteria
      .filter((c) => c.score >= 0.7)
      .map((c) => c.name);
    const failedCriteria = evaluation.criteria
      .filter((c) => c.score < 0.7)
      .map((c) => c.name);

    return {
      id: generateId('rfl'),
      type: 'partial',
      taskId: evaluation.taskId,
      iteration: evaluation.iteration,
      evaluation: `部分成功，得分 ${evaluation.score.toFixed(2)}`,
      lessonsLearned: [
        `达标维度：${passedCriteria.join(', ') || '无'}`,
        `未达标维度：${failedCriteria.join(', ') || '无'}`,
        '需要针对弱项优化',
      ],
      improvementSuggestions: failedCriteria.map(
        (c) => `重点改进维度：${c}`,
      ),
      emotionalTone: 'neutral',
      importance: 0.5 + evaluation.score * 0.3,
      createdAt: Date.now(),
      metadata: {
        passedCriteria,
        failedCriteria,
      },
    };
  }

  /**
   * 推断反思类型
   */
  private inferType(
    execution: TaskExecutionResult,
    evaluation: Evaluation,
  ): ReflectionType {
    if (!execution.success || evaluation.score < 0.5) return 'failure';
    if (evaluation.score >= 0.85) return 'success';
    if (evaluation.score >= 0.5) return 'partial';
    return 'neutral';
  }
}

// ============ StrategyAdjuster ============

export class StrategyAdjuster {
  private llmCaller?: (prompt: string) => Promise<string>;

  constructor(options?: AdjusterOptions) {
    this.llmCaller = options?.llmCaller;
  }

  /**
   * 根据反思调整策略
   */
  async adjust(reflection: Reflection, currentStrategy: string): Promise<string> {
    const prompt = this.buildStrategyPrompt(reflection, currentStrategy);

    if (this.llmCaller) {
      try {
        return await this.llmCaller(prompt);
      } catch {
        // 失败回退到模板策略
      }
    }
    return this.templateAdjust(reflection, currentStrategy);
  }

  /**
   * 合并多条反思
   */
  async mergeReflections(reflections: Reflection[]): Promise<string> {
    if (reflections.length === 0) return '';
    if (reflections.length === 1) {
      const r = reflections[0];
      return `[反思] ${r.evaluation}\n建议: ${r.improvementSuggestions.join('; ')}`;
    }
    const lessons = reflections.flatMap((r) => r.lessonsLearned);
    const improvements = reflections.flatMap((r) => r.improvementSuggestions);
    return `[合并 ${reflections.length} 条反思]\n经验: ${lessons.join('; ')}\n建议: ${improvements.join('; ')}`;
  }

  /**
   * 生成策略 Prompt
   */
  buildStrategyPrompt(reflection: Reflection, currentStrategy: string): string {
    return `基于以下反思调整策略：

当前策略：
${currentStrategy}

反思结论：
${reflection.evaluation}

改进建议：
${reflection.improvementSuggestions.map((s) => `- ${s}`).join('\n')}

请生成新的执行策略。`;
  }

  private templateAdjust(
    reflection: Reflection,
    currentStrategy: string,
  ): string {
    if (reflection.type === 'success') {
      return `${currentStrategy}\n[已成功] 当前策略有效，继续执行。`;
    }
    if (reflection.type === 'failure') {
      const first = reflection.improvementSuggestions[0] ?? '重新分析';
      return `${currentStrategy}\n[失败修正] ${first}`;
    }
    // partial / neutral
    return `${currentStrategy}\n[优化] ${reflection.improvementSuggestions.join('; ')}`;
  }
}

// ============ ReflectionEngine（主类） ============

export class ReflectionEngine {
  private evaluator: Evaluator;
  private generator: ReflectionGenerator;
  private adjuster: StrategyAdjuster;
  private reflections: Map<string, Reflection> = new Map();
  private sessions: Map<string, ReflexionSession> = new Map();
  private persistKey: string;
  private defaultConfig: Partial<IterationConfig>;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();

  constructor(options?: ReflectionEngineOptions) {
    this.evaluator = new Evaluator(options?.evaluatorOptions);
    this.generator = new ReflectionGenerator(options?.generatorOptions);
    this.adjuster = new StrategyAdjuster(options?.adjusterOptions);
    this.persistKey = options?.persistKey ?? 'reflection_engine';
    this.defaultConfig = options?.defaultConfig ?? {};
  }

  // ============ 主循环 ============

  /**
   * 执行任务并通过反思迭代优化
   */
  async executeWithReflection(
    task: string,
    executor: (
      strategy: string,
      iteration: number,
    ) => Promise<TaskExecutionResult>,
    config?: Partial<IterationConfig>,
  ): Promise<ReflexionSession> {
    const cfg: IterationConfig = { ...DEFAULT_ITERATION_CONFIG, ...this.defaultConfig, ...config };
    const startTime = Date.now();

    const session: ReflexionSession = {
      id: generateId('rfls'),
      taskDescription: task,
      initialStrategy: '',
      iterations: [],
      totalDurationMs: 0,
      createdAt: startTime,
    };

    let strategy = `初始策略：${task}`;
    session.initialStrategy = strategy;
    const scores: number[] = [];
    let terminationReason: TerminationCondition = 'max-iterations';

    for (let iter = 1; iter <= cfg.maxIterations; iter++) {
      const iterStart = Date.now();

      // 1. 执行
      let execution: TaskExecutionResult;
      try {
        const rawResult = await executor(strategy, iter);
        if (!rawResult || typeof rawResult !== 'object') {
          execution = {
            output: '',
            success: false,
            error: 'Executor returned non-object value',
            durationMs: Date.now() - iterStart,
          };
        } else {
          execution = rawResult as TaskExecutionResult;
        }
      } catch (err) {
        execution = {
          output: '',
          success: false,
          error: String(err),
          durationMs: Date.now() - iterStart,
        };
      }

      // 2. 评估
      const evaluation = await this.evaluator.evaluate(execution);
      evaluation.taskId = session.id;
      evaluation.iteration = iter;
      scores.push(evaluation.score);

      // 3. 反思
      const previousReflections = session.iterations.map((r) => r.reflection);
      const reflection = await this.generator.generate(
        execution,
        evaluation,
        previousReflections,
      );
      reflection.taskId = session.id;
      reflection.iteration = iter;
      this.reflections.set(reflection.id, reflection);

      // 4. 记录迭代
      const record: IterationRecord = {
        iteration: iter,
        strategy,
        execution,
        evaluation,
        reflection,
        startedAt: iterStart,
        completedAt: Date.now(),
      };
      session.iterations.push(record);
      this.emit('iteration', record);

      // 5. 检查质量阈值
      if (evaluation.passed && evaluation.score >= cfg.qualityThreshold) {
        session.finalResult = execution;
        terminationReason = 'quality-met';
        break;
      }

      // 6. 检查 plateau
      if (
        cfg.earlyStopOnPlateau &&
        iter > cfg.plateauWindow &&
        isPlateau(scores, cfg.plateauWindow, cfg.minImprovementDelta)
      ) {
        session.finalResult = execution;
        terminationReason = 'no-improvement';
        break;
      }

      // 7. 检查预算
      if (cfg.budgetLimit?.maxDurationMs) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= cfg.budgetLimit.maxDurationMs) {
          session.finalResult = execution;
          terminationReason = 'budget-exhausted';
          break;
        }
      }

      // 8. 调整策略（除最后一轮外）
      if (iter < cfg.maxIterations) {
        strategy = await this.adjuster.adjust(reflection, strategy);
      }
    }

    // 收尾
    if (!session.finalResult && session.iterations.length > 0) {
      const lastRecord =
        session.iterations[session.iterations.length - 1];
      session.finalResult = lastRecord.execution;
    }
    session.terminationReason = terminationReason;
    session.totalDurationMs = Date.now() - startTime;

    this.sessions.set(session.id, session);
    this.emit('session-complete', session);
    return session;
  }

  /**
   * 仅评估（不迭代）
   */
  async evaluateOnly(
    result: TaskExecutionResult,
    criteria?: EvaluationCriteria[],
  ): Promise<Evaluation> {
    return this.evaluator.evaluate(result, criteria);
  }

  // ============ 查询 ============

  getReflections(filter?: {
    taskId?: string;
    type?: ReflectionType;
  }): Reflection[] {
    const all = Array.from(this.reflections.values());
    return all.filter((r) => {
      if (filter?.taskId && r.taskId !== filter.taskId) return false;
      if (filter?.type && r.type !== filter.type) return false;
      return true;
    });
  }

  getSession(sessionId: string): ReflexionSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): ReflexionSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  // ============ 内部组件访问 ============

  getEvaluator(): Evaluator {
    return this.evaluator;
  }

  getGenerator(): ReflectionGenerator {
    return this.generator;
  }

  getAdjuster(): StrategyAdjuster {
    return this.adjuster;
  }

  // ============ 事件总线 ============

  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    const arr = this.listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    const arr = this.listeners.get(event);
    if (arr) {
      for (const h of arr) {
        try {
          h(data);
        } catch {
          // 忽略单个 handler 错误
        }
      }
    }
  }

  // ============ 持久化 ============

  async save(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = {
        reflections: Array.from(this.reflections.entries()),
        sessions: Array.from(this.sessions.entries()),
      };
      localStorage.setItem(this.persistKey, JSON.stringify(data));
    } catch (err) {
      void err;
    }
  }

  async load(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.persistKey);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        reflections: Array<[string, Reflection]>;
        sessions: Array<[string, ReflexionSession]>;
      };
      this.reflections = new Map(data.reflections);
      this.sessions = new Map(data.sessions);
    } catch (err) {
      void err;
    }
  }

  // ============ 清理 ============

  clear(): void {
    this.reflections.clear();
    this.sessions.clear();
  }

  getStats(): {
    totalReflections: number;
    totalSessions: number;
    avgIterations: number;
    successRate: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const totalIterations = sessions.reduce(
      (s, sess) => s + sess.iterations.length,
      0,
    );
    const successCount = sessions.filter(
      (s) => s.terminationReason === 'quality-met',
    ).length;
    return {
      totalReflections: this.reflections.size,
      totalSessions: sessions.length,
      avgIterations:
        sessions.length === 0 ? 0 : totalIterations / sessions.length,
      successRate: sessions.length === 0 ? 0 : successCount / sessions.length,
    };
  }
}
