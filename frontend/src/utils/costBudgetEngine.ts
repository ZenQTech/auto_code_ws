/**
 * # ============================================================
 * # Cost Budget Engine - 成本预算引擎 (v1.0.0 Cycle 28 G28-02)
 * # ============================================================
 * # 核心作用：实现 fallbackModel + 多层成本预算
 * # 层级：单次请求 / 单代理 / 单日 三层预算
 * # 参考：Claude Code 2026-06 #2 fallbackModel + #8 Cost Budget
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type BudgetLevel = 'request' | 'agent' | 'daily';
export type BudgetEnforcement = 'strict' | 'balanced' | 'lenient';
export type ModelRole = 'primary' | 'fallback';

export interface ModelSpec {
  /** 模型 ID */
  id: string;
  /** 显示名 */
  name: string;
  /** 角色 */
  role: ModelRole;
  /** 输入 $/1M token */
  inputCostPer1M: number;
  /** 输出 $/1M token */
  outputCostPer1M: number;
  /** 最大 context window */
  maxContext: number;
  /** 描述 */
  description?: string;
}

export interface BudgetLimit {
  level: BudgetLevel;
  /** 美元限额 */
  limitUsd: number;
  /** 已用 */
  usedUsd: number;
  /** 重置时间（仅 daily） */
  resetAt?: number;
  /** 代理路径（仅 agent） */
  agentPath?: string;
  /** 强制策略 */
  enforcement: BudgetEnforcement;
}

export interface FallbackChain {
  /** 主模型 ID */
  primary: string;
  /** Fallback 模型 ID 列表（按顺序） */
  fallbacks: string[];
  /** 触发 Fallback 的错误码 */
  triggerOnErrors: string[];
  /** 最大 Fallback 次数 */
  maxRetries: number;
}

export interface CostRecord {
  id: string;
  timestamp: number;
  level: BudgetLevel;
  agentPath?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingUsd: number;
  enforcement: BudgetEnforcement;
}

export type CostBudgetEventType =
  | 'budget-created'
  | 'budget-updated'
  | 'budget-exceeded'
  | 'budget-warning'
  | 'cost-recorded'
  | 'fallback-triggered'
  | 'daily-reset';

export interface CostBudgetEvent {
  type: CostBudgetEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ============ 默认配置 ============

export const DEFAULT_MODEL_SPEC: ModelSpec = {
  id: 'gpt-5.3-codex',
  name: 'GPT-5.3 Codex',
  role: 'primary',
  inputCostPer1M: 3.0,
  outputCostPer1M: 12.0,
  maxContext: 256000,
  description: '默认主模型',
};

export const DEFAULT_FALLBACK_MODELS: ModelSpec[] = [
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    role: 'fallback',
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    maxContext: 200000,
    description: '主 Fallback',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    role: 'fallback',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    maxContext: 128000,
    description: '低成本 Fallback',
  },
];

export const DEFAULT_BUDGET_LIMITS: Record<BudgetLevel, number> = {
  request: 0.5, // $0.5 per request
  agent: 5.0, // $5 per agent
  daily: 50.0, // $50 per day
};

export const DEFAULT_WARN_THRESHOLDS: Record<BudgetEnforcement, number> = {
  strict: 0.5, // 50% 警告
  balanced: 0.75, // 75% 警告
  lenient: 0.9, // 90% 警告
};

export const DEFAULT_TRIGGER_ERRORS = [
  'rate_limit',
  'timeout',
  'context_length_exceeded',
  'internal_server_error',
  'unavailable',
];

// ============ 工具函数 ============

export function generateBudgetId(): string {
  return 'budget-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function generateCostRecordId(): string {
  return 'cost-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function calculateCost(
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number
): number {
  const inputCost = (inputTokens / 1_000_000) * model.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * model.outputCostPer1M;
  return inputCost + outputCost;
}

export function isValidBudgetLevel(level: string): level is BudgetLevel {
  return ['request', 'agent', 'daily'].includes(level);
}

export function getNextDayReset(): number {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.getTime();
}

// ============ 引擎类 ============

export class CostBudgetEngine {
  private models: Map<string, ModelSpec> = new Map();
  private budgets: Map<string, BudgetLimit> = new Map();
  private records: CostRecord[] = [];
  private fallbackChain: FallbackChain;
  private warnThresholds: Record<BudgetEnforcement, number>;
  private listeners: Map<CostBudgetEventType, Set<(e: CostBudgetEvent) => void>> = new Map();
  private storageKey = 'hermes.costBudget';

  constructor(options: {
    models?: ModelSpec[];
    fallbackChain?: Partial<FallbackChain>;
    warnThresholds?: Partial<Record<BudgetEnforcement, number>>;
    persist?: boolean;
  } = {}) {
    // 初始化模型
    this.models.set(DEFAULT_MODEL_SPEC.id, DEFAULT_MODEL_SPEC);
    for (const m of options.models || DEFAULT_FALLBACK_MODELS) {
      this.models.set(m.id, m);
    }
    // 初始化 Fallback 链
    this.fallbackChain = {
      primary: options.fallbackChain?.primary || DEFAULT_MODEL_SPEC.id,
      fallbacks: options.fallbackChain?.fallbacks || DEFAULT_FALLBACK_MODELS.map((m) => m.id),
      triggerOnErrors: options.fallbackChain?.triggerOnErrors || DEFAULT_TRIGGER_ERRORS,
      maxRetries: options.fallbackChain?.maxRetries ?? 3,
    };
    // 初始化警告阈值
    this.warnThresholds = {
      ...DEFAULT_WARN_THRESHOLDS,
      ...options.warnThresholds,
    };
    // 初始化默认预算
    this.createDefaultBudgets();
    if (options.persist) {
      this.load();
    }
  }

  private createDefaultBudgets(): void {
    this.budgets.set('default-request', {
      level: 'request',
      limitUsd: DEFAULT_BUDGET_LIMITS.request,
      usedUsd: 0,
      enforcement: 'balanced',
    });
    this.budgets.set('default-daily', {
      level: 'daily',
      limitUsd: DEFAULT_BUDGET_LIMITS.daily,
      usedUsd: 0,
      resetAt: getNextDayReset(),
      enforcement: 'balanced',
    });
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.budgets)) {
        for (const b of data.budgets) {
          this.budgets.set(b.id, b);
        }
      }
      if (data && Array.isArray(data.records)) {
        this.records = data.records.slice(-200);
      }
    } catch (e) {
      console.warn('CostBudgetEngine: failed to load', e);
    }
  }

  private save(): void {
    try {
      const data = {
        budgets: Array.from(this.budgets.values()),
        records: this.records.slice(-200),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('CostBudgetEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: CostBudgetEventType, listener: (e: CostBudgetEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: CostBudgetEventType, listener: (e: CostBudgetEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: CostBudgetEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('CostBudgetEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 模型管理 ============

  registerModel(model: ModelSpec): void {
    this.models.set(model.id, model);
  }

  getModel(modelId: string): ModelSpec | undefined {
    return this.models.get(modelId);
  }

  listModels(): ModelSpec[] {
    return Array.from(this.models.values());
  }

  // ============ Fallback 链 ============

  getFallbackChain(): FallbackChain {
    return { ...this.fallbackChain };
  }

  setFallbackChain(chain: Partial<FallbackChain>): void {
    this.fallbackChain = { ...this.fallbackChain, ...chain };
  }

  /**
   * 决定使用哪个模型（处理 fallback）
   */
  resolveModel(error?: string): string {
    if (!error || !this.fallbackChain.triggerOnErrors.includes(error)) {
      return this.fallbackChain.primary;
    }
    // 触发 fallback
    if (this.fallbackChain.fallbacks.length > 0) {
      this.emit({
        type: 'fallback-triggered',
        timestamp: Date.now(),
        data: { primary: this.fallbackChain.primary, error, fallback: this.fallbackChain.fallbacks[0] },
      });
      return this.fallbackChain.fallbacks[0];
    }
    return this.fallbackChain.primary;
  }

  // ============ 预算管理 ============

  createBudget(options: {
    level: BudgetLevel;
    limitUsd: number;
    enforcement?: BudgetEnforcement;
    agentPath?: string;
  }): BudgetLimit {
    const id = options.agentPath
      ? `agent-${options.agentPath}`
      : `default-${options.level}`;
    const budget: BudgetLimit = {
      level: options.level,
      limitUsd: options.limitUsd,
      usedUsd: 0,
      enforcement: options.enforcement || 'balanced',
      agentPath: options.agentPath,
      resetAt: options.level === 'daily' ? getNextDayReset() : undefined,
    };
    this.budgets.set(id, budget);
    this.save();
    this.emit({
      type: 'budget-created',
      timestamp: Date.now(),
      data: { id, level: options.level, limitUsd: options.limitUsd },
    });
    return budget;
  }

  getBudget(id: string): BudgetLimit | undefined {
    return this.budgets.get(id);
  }

  listBudgets(): BudgetLimit[] {
    return Array.from(this.budgets.values());
  }

  /**
   * 检查是否允许请求（带预算检查）
   */
  checkBudget(options: {
    level: BudgetLevel;
    agentPath?: string;
    estimatedCostUsd?: number;
  }): BudgetCheckResult {
    const id = options.agentPath ? `agent-${options.agentPath}` : `default-${options.level}`;
    const budget = this.budgets.get(id);
    if (!budget) {
      return { allowed: true, remainingUsd: Infinity, enforcement: 'balanced' };
    }
    // 检查 daily 重置
    if (budget.level === 'daily' && budget.resetAt && Date.now() > budget.resetAt) {
      budget.usedUsd = 0;
      budget.resetAt = getNextDayReset();
      this.save();
      this.emit({ type: 'daily-reset', timestamp: Date.now() });
    }
    const remaining = budget.limitUsd - budget.usedUsd;
    const estimated = options.estimatedCostUsd || 0;
    if (budget.usedUsd + estimated > budget.limitUsd) {
      this.emit({
        type: 'budget-exceeded',
        timestamp: Date.now(),
        data: { id, level: budget.level, limitUsd: budget.limitUsd, usedUsd: budget.usedUsd },
      });
      return {
        allowed: false,
        reason: `Budget exceeded: ${budget.usedUsd.toFixed(4)} + ${estimated.toFixed(4)} > ${budget.limitUsd}`,
        remainingUsd: Math.max(0, remaining),
        enforcement: budget.enforcement,
      };
    }
    // 警告检查
    const warnThreshold = this.warnThresholds[budget.enforcement];
    if (remaining / budget.limitUsd < 1 - warnThreshold) {
      this.emit({
        type: 'budget-warning',
        timestamp: Date.now(),
        data: { id, remainingUsd: remaining, percent: remaining / budget.limitUsd },
      });
    }
    return {
      allowed: true,
      remainingUsd: remaining,
      enforcement: budget.enforcement,
    };
  }

  // ============ 成本记录 ============

  recordCost(options: {
    level: BudgetLevel;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    agentPath?: string;
    requestId?: string;
  }): CostRecord {
    const model = this.models.get(options.modelId);
    if (!model) {
      throw new Error(`Model not found: ${options.modelId}`);
    }
    const costUsd = calculateCost(model, options.inputTokens, options.outputTokens);
    const record: CostRecord = {
      id: generateCostRecordId(),
      timestamp: Date.now(),
      level: options.level,
      agentPath: options.agentPath,
      modelId: options.modelId,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      costUsd,
      requestId: options.requestId,
    };
    this.records.push(record);
    // 更新预算
    const budgetId = options.agentPath ? `agent-${options.agentPath}` : `default-${options.level}`;
    const budget = this.budgets.get(budgetId);
    if (budget) {
      budget.usedUsd += costUsd;
    }
    this.save();
    this.emit({
      type: 'cost-recorded',
      timestamp: Date.now(),
      data: { id: record.id, costUsd, level: options.level, modelId: options.modelId },
    });
    return record;
  }

  listRecords(filter?: { level?: BudgetLevel; modelId?: string; since?: number }): CostRecord[] {
    let result = [...this.records];
    if (filter?.level) {
      result = result.filter((r) => r.level === filter.level);
    }
    if (filter?.modelId) {
      result = result.filter((r) => r.modelId === filter.modelId);
    }
    if (filter?.since) {
      result = result.filter((r) => r.timestamp >= filter.since!);
    }
    return result;
  }

  getTotalCost(filter?: { level?: BudgetLevel; since?: number }): number {
    return this.listRecords(filter).reduce((sum, r) => sum + r.costUsd, 0);
  }
}

// ============ 单例 ============

let defaultEngine: CostBudgetEngine | null = null;

export function getDefaultCostBudgetEngine(): CostBudgetEngine {
  if (!defaultEngine) {
    defaultEngine = new CostBudgetEngine();
  }
  return defaultEngine;
}

export function resetDefaultCostBudgetEngine(): void {
  defaultEngine = null;
}
