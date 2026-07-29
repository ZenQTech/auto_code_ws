/**
 * # ============================================================
 * # ModelRouter - 智能模型路由器 (v1.0.0 Cycle 20 G20-02)
 * # ============================================================
 * # 核心作用：根据任务分类、复杂度和路由模式自动选择最合适的模型
 * # 运行流程：
 * #   1. classify() - 对 prompt 进行任务分类（11 种类型）
 * #   2. estimateComplexity() - 评估任务复杂度（1-10）
 * #   3. scoreModel() - 对每个模型评分（能力+专业+速度+成本）
 * #   4. route() - 选择分数最高的模型
 * #   5. 记录决策日志
 * # 输入参数：prompt + 可选 context（token 数/文件数等）
 * # 输出结果：ModelRoute（含选中模型+候选+原因）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 G20-02 初次创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 任务分类（11 种）
 */
export type TaskCategory =
  | 'code_generation'   // 代码生成
  | 'code_review'       // 代码审查
  | 'debugging'         // 调试
  | 'documentation'     // 文档生成
  | 'translation'       // 翻译
  | 'explanation'       // 解释
  | 'refactoring'       // 重构
  | 'testing'          // 测试
  | 'analysis'         // 分析
  | 'brainstorm'       // 头脑风暴
  | 'unknown';         // 未知

/**
 * 路由模式
 * - cost: 优先低成本
 * - balance: 平衡质量和成本
 * - intelligence: 优先高质量
 */
export type RoutingMode = 'cost' | 'balance' | 'intelligence';

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'meta' | 'other';
  /** 每 1k input tokens 成本（美元） */
  inputCostPer1k: number;
  /** 每 1k output tokens 成本（美元） */
  outputCostPer1k: number;
  /** 最大上下文窗口 */
  contextWindow: number;
  /** 能力评分（1-10） */
  capabilityScore: number;
  /** 速度评分（1-10） */
  speedScore: number;
  /** 擅长的任务分类 */
  specialties: TaskCategory[];
  /** 是否启用 */
  enabled: boolean;
}

export interface RouterContext {
  /** 任务类型（来自调用方） */
  taskType?: TaskCategory;
  /** 提示词 token 数估算 */
  promptTokens?: number;
  /** 上下文 token 数估算 */
  contextTokens?: number;
  /** 文件数量 */
  fileCount?: number;
  /** 嵌套层级（max 10） */
  nestingLevel?: number;
  /** 外部依赖数 */
  externalDependencies?: number;
  /** 是否包含代码 */
  hasCode?: boolean;
  /** 是否包含数学公式 */
  hasMath?: boolean;
  /** 用户偏好模型 */
  preferredModel?: string;
  /** 排除模型 */
  excludedModels?: string[];
}

export interface ModelRoute {
  /** 选中的模型 */
  model: string;
  /** 任务分类 */
  category: TaskCategory;
  /** 复杂度（1-10） */
  complexity: number;
  /** 路由模式 */
  mode: RoutingMode;
  /** 路由原因（用于日志） */
  reason: string;
  /** 候选模型列表（按分数排序） */
  candidates: Array<{
    model: string;
    score: number;
    reason: string;
  }>;
  /** 决策时间戳 */
  timestamp: number;
}

export interface DecisionLogFilter {
  model?: string;
  category?: TaskCategory;
  mode?: RoutingMode;
  sinceMs?: number;
  limit?: number;
}

export type RouterEventType = 'mode-changed' | 'model-registered' | 'model-unregistered' | 'route-decided';

export interface RouterEvent {
  type: RouterEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type RouterEventHandler = (event: RouterEvent) => void;

// ============================================================
// 预置模型
// ============================================================

export const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    contextWindow: 200000,
    capabilityScore: 9.5,
    speedScore: 7,
    specialties: ['code_generation', 'code_review', 'refactoring', 'analysis'],
    enabled: true,
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
    contextWindow: 128000,
    capabilityScore: 9.0,
    speedScore: 8,
    specialties: ['code_generation', 'brainstorm', 'explanation'],
    enabled: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.015,
    contextWindow: 128000,
    capabilityScore: 8.5,
    speedScore: 9,
    specialties: ['code_generation', 'translation', 'explanation'],
    enabled: true,
  },
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    provider: 'deepseek',
    inputCostPer1k: 0.0014,
    outputCostPer1k: 0.0028,
    contextWindow: 128000,
    capabilityScore: 8.0,
    speedScore: 8,
    specialties: ['code_generation', 'code_review', 'debugging'],
    enabled: true,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    inputCostPer1k: 0.0001,
    outputCostPer1k: 0.0004,
    contextWindow: 1000000,
    capabilityScore: 7.5,
    speedScore: 10,
    specialties: ['documentation', 'translation', 'analysis'],
    enabled: true,
  },
];

// ============================================================
// 关键词模式
// ============================================================

const KEYWORD_PATTERNS: Record<TaskCategory, RegExp[]> = {
  code_generation: [
    /编写/, /实现/, /添加.*功能/, /写.*代码/, /写.*函数/, /创建.*类/,
    /create.*function/i, /implement/i, /add.*feature/i, /write.*code/i, /generate.*code/i,
  ],
  code_review: [
    /审查/, /review/i, /检查.*代码/, /check.*code/i, /看.*代码/, /evaluate.*code/i,
  ],
  debugging: [
    /调试/, /debug/i, /修复.*bug/i, /fix.*bug/i, /错误/, /报错/, /异常/,
    /troubleshoot/i, /trace.*error/i, /error/i,
  ],
  documentation: [
    /文档/, /documentation/i, /注释/, /comment/i, /README/, /api.*doc/i,
    /jsdoc/i, /docstring/i,
  ],
  translation: [
    /翻译/, /translate/i, /转换.*语言/, /convert.*language/i, /中英/,
  ],
  explanation: [
    /解释/, /explain/i, /说明/, /describe/i, /什么是/, /how.*work/i, /what.*is/i,
  ],
  refactoring: [
    /重构/, /refactor/i, /优化.*结构/, /reorganize/i, /clean.*up/i, /improve.*structure/i,
  ],
  testing: [
    /测试/, /test/i, /单元测试/, /unit test/i, /integration test/i, /e2e.*test/i,
  ],
  analysis: [
    /分析/, /analyze/i, /评估/, /evaluate/i, /compare/i, /study/i, /assess/i,
  ],
  brainstorm: [
    /头脑风暴/, /brainstorm/i, /想法/, /idea/i, /建议/, /suggest/i, /propose/i, /ideate/i,
  ],
  unknown: [],
};

// ============================================================
// 事件总线
// ============================================================

class RouterEventBus {
  private listeners: Map<RouterEventType, Set<RouterEventHandler>> = new Map();

  on(type: RouterEventType, handler: RouterEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: RouterEvent): void {
    this.listeners.get(event.type)?.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Router event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================
// 路由算法
// ============================================================

/**
 * 任务分类
 */
export function classifyTask(prompt: string): TaskCategory {
  if (!prompt || typeof prompt !== 'string') {
    return 'unknown';
  }
  let bestCategory: TaskCategory = 'unknown';
  let bestScore = 0;
  for (const [category, patterns] of Object.entries(KEYWORD_PATTERNS)) {
    const cat = category as TaskCategory;
    if (cat === 'unknown') continue;
    const score = patterns.filter(p => p.test(prompt)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }
  return bestCategory;
}

/**
 * 复杂度评估
 */
export function estimateComplexity(prompt: string, context?: RouterContext): number {
  let complexity = 1;
  if (!prompt || typeof prompt !== 'string') {
    return complexity;
  }
  // 提示词长度
  if (prompt.length > 500) complexity += 1;
  if (prompt.length > 2000) complexity += 2;
  if (prompt.length > 5000) complexity += 2;
  // 上下文 token 数
  if (context?.contextTokens) {
    if (context.contextTokens > 10000) complexity += 1;
    if (context.contextTokens > 50000) complexity += 2;
  }
  // 文件数量
  if (context?.fileCount !== undefined) {
    if (context.fileCount > 5) complexity += 1;
    if (context.fileCount > 20) complexity += 2;
  }
  // 嵌套层级
  if (context?.nestingLevel !== undefined && context.nestingLevel > 3) complexity += 1;
  // 外部依赖
  if (context?.externalDependencies !== undefined && context.externalDependencies > 3) complexity += 1;
  return Math.min(complexity, 10);
}

/**
 * 模型评分
 */
export function scoreModel(
  model: ModelInfo,
  category: TaskCategory,
  complexity: number,
  mode: RoutingMode
): { score: number; reason: string } {
  if (!model.enabled) {
    return { score: -1, reason: 'disabled' };
  }
  let score = 0;
  const reasons: string[] = [];

  // 能力分
  score += model.capabilityScore * 10;
  reasons.push(`capability=${model.capabilityScore}`);

  // 专业领域加分
  if (model.specialties.includes(category)) {
    score += 20;
    reasons.push(`specialty=${category}`);
  }

  // 速度分
  score += model.speedScore * 5;
  reasons.push(`speed=${model.speedScore}`);

  // 复杂度匹配
  if (complexity >= 7 && model.capabilityScore >= 9) {
    score += 15;
    reasons.push('high-complexity-capable');
  }

  // 模式调整
  if (mode === 'cost') {
    // 优先低成本
    const costScore = 100 - (model.inputCostPer1k + model.outputCostPer1k) * 100;
    score = score * 0.3 + costScore * 0.7;
    reasons.push('cost-mode');
  } else if (mode === 'intelligence') {
    // 优先高能力
    score = score * 1.5;
    reasons.push('intelligence-mode');
  } else if (mode === 'balance') {
    // 平衡
    const costScore = 100 - (model.inputCostPer1k + model.outputCostPer1k) * 50;
    score = score * 0.7 + costScore * 0.3;
    reasons.push('balance-mode');
  }

  return { score, reason: reasons.join(', ') };
}

// ============================================================
// 主类
// ============================================================

export class ModelRouter {
  private models: Map<string, ModelInfo> = new Map();
  private decisionLog: ModelRoute[] = [];
  private mode: RoutingMode = 'balance';
  private readonly eventBus: RouterEventBus = new RouterEventBus();
  private readonly maxDecisionLog: number = 1000;

  constructor(models?: ModelInfo[]) {
    const initial = models ?? DEFAULT_MODELS;
    initial.forEach(m => this.models.set(m.id, { ...m }));
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 注册模型
   */
  registerModel(model: ModelInfo): void {
    if (!model || !model.id) {
      throw new Error('Model id is required');
    }
    this.models.set(model.id, { ...model });
    this.eventBus.emit({
      type: 'model-registered',
      timestamp: Date.now(),
      data: { modelId: model.id },
    });
  }

  /**
   * 注销模型
   */
  unregisterModel(id: string): void {
    if (this.models.delete(id)) {
      this.eventBus.emit({
        type: 'model-unregistered',
        timestamp: Date.now(),
        data: { modelId: id },
      });
    }
  }

  /**
   * 获取所有模型
   */
  listModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * 获取单个模型
   */
  getModel(id: string): ModelInfo | null {
    return this.models.get(id) ?? null;
  }

  /**
   * 设置路由模式
   */
  setMode(mode: RoutingMode): void {
    this.mode = mode;
    this.eventBus.emit({
      type: 'mode-changed',
      timestamp: Date.now(),
      data: { mode },
    });
  }

  /**
   * 获取当前模式
   */
  getMode(): RoutingMode {
    return this.mode;
  }

  /**
   * 任务分类
   */
  classify(prompt: string, _context?: RouterContext): TaskCategory {
    return classifyTask(prompt);
  }

  /**
   * 复杂度评估
   */
  estimateComplexity(prompt: string, context?: RouterContext): number {
    return estimateComplexity(prompt, context);
  }

  /**
   * 路由决策
   */
  route(prompt: string, context?: RouterContext): ModelRoute {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required');
    }
    const category = context?.taskType ?? this.classify(prompt);
    const complexity = this.estimateComplexity(prompt, context);

    // 过滤启用的模型
    let candidates = Array.from(this.models.values()).filter(m => m.enabled);

    // 应用排除列表
    if (context?.excludedModels && context.excludedModels.length > 0) {
      candidates = candidates.filter(m => !context.excludedModels!.includes(m.id));
    }

    // 用户偏好模型优先
    let preferredBoost = 0;
    if (context?.preferredModel && this.models.has(context.preferredModel)) {
      preferredBoost = 10;
    }

    // 评分排序
    const scored = candidates.map(m => {
      const { score, reason } = scoreModel(m, category, complexity, this.mode);
      const finalScore = m.id === context?.preferredModel ? score + preferredBoost : score;
      return {
        model: m.id,
        score: finalScore,
        reason: m.id === context?.preferredModel ? `${reason}, preferred` : reason,
      };
    }).sort((a, b) => b.score - a.score);

    // 选择最佳
    const best = scored[0];
    if (!best) {
      throw new Error('No available models');
    }

    const route: ModelRoute = {
      model: best.model,
      category,
      complexity,
      mode: this.mode,
      reason: `Best score: ${best.reason}`,
      candidates: scored,
      timestamp: Date.now(),
    };

    // 记录日志
    this._addToLog(route);
    this.eventBus.emit({
      type: 'route-decided',
      timestamp: Date.now(),
      data: { route },
    });

    return route;
  }

  /**
   * 获取决策日志
   */
  getDecisionLog(filter?: DecisionLogFilter): ModelRoute[] {
    let result = [...this.decisionLog];
    if (filter) {
      if (filter.model) {
        result = result.filter(r => r.model === filter.model);
      }
      if (filter.category) {
        result = result.filter(r => r.category === filter.category);
      }
      if (filter.mode) {
        result = result.filter(r => r.mode === filter.mode);
      }
      if (filter.sinceMs) {
        result = result.filter(r => r.timestamp >= filter.sinceMs!);
      }
      if (filter.limit) {
        result = result.slice(-filter.limit);
      }
    }
    return result;
  }

  /**
   * 清空决策日志
   */
  clearDecisionLog(): void {
    this.decisionLog = [];
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalDecisions: number;
    byModel: Record<string, number>;
    byCategory: Record<TaskCategory, number>;
    byMode: Record<RoutingMode, number>;
  } {
    const byModel: Record<string, number> = {};
    const byCategory: Record<TaskCategory, number> = {
      code_generation: 0,
      code_review: 0,
      debugging: 0,
      documentation: 0,
      translation: 0,
      explanation: 0,
      refactoring: 0,
      testing: 0,
      analysis: 0,
      brainstorm: 0,
      unknown: 0,
    };
    const byMode: Record<RoutingMode, number> = {
      cost: 0,
      balance: 0,
      intelligence: 0,
    };
    for (const r of this.decisionLog) {
      byModel[r.model] = (byModel[r.model] ?? 0) + 1;
      byCategory[r.category]++;
      byMode[r.mode]++;
    }
    return {
      totalDecisions: this.decisionLog.length,
      byModel,
      byCategory,
      byMode,
    };
  }

  /**
   * 订阅事件
   */
  on(event: RouterEventType, handler: RouterEventHandler): () => void {
    return this.eventBus.on(event, handler);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private _addToLog(route: ModelRoute): void {
    this.decisionLog.push(route);
    if (this.decisionLog.length > this.maxDecisionLog) {
      this.decisionLog = this.decisionLog.slice(-this.maxDecisionLog);
    }
  }
}

// ============================================================
// 单例工厂
// ============================================================

let _instance: ModelRouter | null = null;

/**
 * 获取 ModelRouter 单例
 */
export function getModelRouter(): ModelRouter {
  if (!_instance) {
    _instance = new ModelRouter();
  }
  return _instance;
}

/**
 * 重置单例（主要用于测试）
 */
export function resetModelRouter(): void {
  if (_instance) {
    _instance.clearDecisionLog();
  }
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isModelRouterInitialized(): boolean {
  return _instance !== null;
}
