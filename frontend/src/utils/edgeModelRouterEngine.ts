/**
 * # ============================================================
 * # Edge Model Router Engine - 端云模型路由引擎 (v1.0.0 Cycle 34 G34-01)
 * # ============================================================
 * # 核心作用：实现端云模型智能路由，覆盖 Cursor Router 三大优化模式
 * #           + Claude Mobile 隐私 Tier 分类 + Token Budget Manager
 * # 运行流程：
 * #   1. 初始化引擎 + 加载预置 3 端 + 3 云模型
 * #   2. registerEdgeModel / registerCloudModel 注册自定义模型
 * #   3. createPolicy 创建路由策略（3 大预置：Intelligence/Balance/Cost）
 * #   4. setActivePolicy 设定当前激活策略
 * #   5. route(request) 执行 7 步路由决策：隐私Tier→难度→优化模式→Token预算→能力匹配→成本对比→用户偏好
 * #   6. routeAndExecute(route) 模拟执行（mock provider）
 * #   7. getStats / getRouteHistory 路由统计与历史
 * # 输入参数：
 * #   - config: EdgeRouterConfig（可选）
 * #   - model: EdgeModelRegistration / CloudModelRegistration
 * #   - request: RouteRequest（任务类型/难度/隐私/Token 估算等）
 * # 输出结果：
 * #   - 路由决策 RouteDecision（选中的模型 + 决策原因 + 成本估算）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 34 G34-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 模型 Provider 类型
 */
export type ModelProvider =
  | 'ollama'
  | 'llamacpp'
  | 'apple-foundation'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mock';

/**
 * 优化模式（对标 Cursor Router）
 */
export type OptimizationMode = 'intelligence' | 'balance' | 'cost';

/**
 * 隐私 Tier 分类（对标 Claude Mobile）
 * Tier 1 = 强制本地（健康/金融/医疗/密码等敏感数据）
 * Tier 2 = 可上云（通用内容，默认）
 * Tier 3 = 推荐云端（公开数据/合成内容）
 */
export type PrivacyTier = 1 | 2 | 3;

/**
 * 任务难度等级
 */
export type TaskDifficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'expert';

/**
 * 任务类型
 */
export type TaskType =
  | 'code-generation'
  | 'code-review'
  | 'summarization'
  | 'translation'
  | 'classification'
  | 'general';

/**
 * 模型能力评分（0-1）
 */
export interface ModelCapabilities {
  codeGeneration: number;
  reasoning: number;
  summarization: number;
  longContext: number;
}

/**
 * 端侧模型注册
 */
export interface EdgeModelRegistration {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  contextWindow: number;
  capabilities: ModelCapabilities;
  costPerMillionTokens: { input: number; output: number };
  avgLatencyMs: number;
  enabled: boolean;
  priority: number;
  createdAt: number;
  metadata?: Record<string, any>;
}

/**
 * 云端模型注册
 */
export interface CloudModelRegistration {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  contextWindow: number;
  capabilities: ModelCapabilities;
  costPerMillionTokens: { input: number; output: number };
  avgLatencyMs: number;
  enabled: boolean;
  priority: number;
  createdAt: number;
  metadata?: Record<string, any>;
}

/**
 * 统一模型注册
 */
export type ModelRegistration = EdgeModelRegistration | CloudModelRegistration;

/**
 * Token 预算配置
 */
export interface TokenBudgetConfig {
  perRequest: { maxTokens: number; maxCostUsd: number };
  perAgent: { maxTokensPerHour: number; maxCostUsdPerHour: number };
  perDay: { maxTokens: number; maxCostUsd: number };
  onExceeded: 'block' | 'fallback-to-edge' | 'warn';
}

/**
 * Token 预算使用情况
 */
export interface BudgetUsage {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * 路由策略
 */
export interface RoutingPolicy {
  id: string;
  name: string;
  description: string;
  mode: OptimizationMode;
  privacyThreshold: PrivacyTier;
  capabilities: {
    minReasoning?: number;
    minLongContext?: number;
    maxLatencyMs?: number;
    maxCostPerRequest?: number;
  };
  preferredProviders?: ModelProvider[];
  blockedModels?: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 路由请求
 */
export interface RouteRequest {
  taskType: TaskType;
  estimatedTokens: number;
  estimatedDifficulty: TaskDifficulty;
  privacyTier: PrivacyTier;
  requiresLongContext: boolean;
  requiresTools: boolean;
  userPreference?: { modelId?: string; provider?: ModelProvider };
  agentId?: string;
  metadata?: Record<string, any>;
}

/**
 * 路由决策
 */
export interface RouteDecision {
  id: string;
  request: RouteRequest;
  selectedModel: ModelRegistration;
  selectedTier: 'edge' | 'cloud';
  reason: string;
  estimatedCost: number;
  estimatedLatencyMs: number;
  timestamp: number;
  policyId: string;
  budgetStatus: {
    requestBudgetOk: boolean;
    agentBudgetOk: boolean;
    dailyBudgetOk: boolean;
  };
  fallbackApplied: boolean;
  fallbackReason?: string;
}

/**
 * 引擎配置
 */
export interface EdgeRouterConfig {
  budget: TokenBudgetConfig;
  maxRouteHistory: number;
  persist: boolean;
}

export type EdgeRouterEvent =
  | 'model-registered'
  | 'model-unregistered'
  | 'policy-created'
  | 'policy-updated'
  | 'policy-activated'
  | 'route-decided'
  | 'budget-exceeded'
  | 'fallback-triggered';

// ============ 默认配置 ============

export const DEFAULT_EDGE_ROUTER_CONFIG: EdgeRouterConfig = {
  budget: {
    perRequest: { maxTokens: 200000, maxCostUsd: 5 },
    perAgent: { maxTokensPerHour: 1000000, maxCostUsdPerHour: 50 },
    perDay: { maxTokens: 10000000, maxCostUsd: 500 },
    onExceeded: 'fallback-to-edge',
  },
  maxRouteHistory: 1000,
  persist: true,
};

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = DEFAULT_EDGE_ROUTER_CONFIG.budget;

// ============ 工具函数 ============

export function generateModelId(): string {
  return `model-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generatePolicyId(): string {
  return `policy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateDecisionId(): string {
  return `dec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 判断模型是端侧还是云端
 */
export function isEdgeModel(model: ModelRegistration): model is EdgeModelRegistration {
  return model.provider === 'ollama' || model.provider === 'llamacpp' || model.provider === 'apple-foundation';
}

/**
 * 估算请求成本
 */
export function estimateCost(
  model: ModelRegistration,
  inputTokens: number,
  outputTokens: number = Math.floor(inputTokens * 0.3),
): number {
  const inputCost = (inputTokens / 1_000_000) * model.costPerMillionTokens.input;
  const outputCost = (outputTokens / 1_000_000) * model.costPerMillionTokens.output;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * 隐私 Tier 1 触发关键词
 */
const PRIVACY_TIER_1_KEYWORDS = [
  // 中文
  '医疗', '健康', '金融', '银行', '密码', '身份证', '医保', '病历',
  '处方', '账号', '信用卡', '私钥', '手机号', '地址',
  // 英文
  'health', 'medical', 'financial', 'bank', 'password', 'ssn',
  'credit card', 'medical record', 'private key', 'phone number',
  'address', 'passport',
];

/**
 * 自动检测隐私 Tier（基于文本内容）
 */
export function detectPrivacyTier(text: string): PrivacyTier {
  const lower = text.toLowerCase();
  for (const keyword of PRIVACY_TIER_1_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return 1;
    }
  }
  return 2;
}

/**
 * 基于任务类型映射能力要求
 */
export function getCapabilityRequirement(taskType: TaskType): keyof ModelCapabilities {
  switch (taskType) {
    case 'code-generation':
      return 'codeGeneration';
    case 'code-review':
      return 'reasoning';
    case 'summarization':
      return 'summarization';
    case 'translation':
      return 'summarization';
    case 'classification':
      return 'reasoning';
    case 'general':
    default:
      return 'reasoning';
  }
}

// ============ 预置模型与策略 ============

export const PRESET_EDGE_MODELS: Omit<EdgeModelRegistration, 'createdAt'>[] = [
  {
    id: 'edge-ollama-llama3-8b',
    name: 'Llama 3 8B (Ollama)',
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    contextWindow: 8192,
    capabilities: { codeGeneration: 0.6, reasoning: 0.5, summarization: 0.7, longContext: 0.3 },
    costPerMillionTokens: { input: 0, output: 0 },
    avgLatencyMs: 200,
    enabled: true,
    priority: 5,
  },
  {
    id: 'edge-ollama-qwen2-5-7b',
    name: 'Qwen 2.5 7B (Ollama)',
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    contextWindow: 32768,
    capabilities: { codeGeneration: 0.7, reasoning: 0.6, summarization: 0.7, longContext: 0.6 },
    costPerMillionTokens: { input: 0, output: 0 },
    avgLatencyMs: 250,
    enabled: true,
    priority: 5,
  },
  {
    id: 'edge-apple-foundation-4b',
    name: 'Apple Foundation 4B',
    provider: 'apple-foundation',
    endpoint: 'apple://on-device',
    contextWindow: 8192,
    capabilities: { codeGeneration: 0.5, reasoning: 0.4, summarization: 0.6, longContext: 0.2 },
    costPerMillionTokens: { input: 0, output: 0 },
    avgLatencyMs: 100,
    enabled: true,
    priority: 4,
  },
];

export const PRESET_CLOUD_MODELS: Omit<CloudModelRegistration, 'createdAt'>[] = [
  {
    id: 'cloud-claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    contextWindow: 200000,
    capabilities: { codeGeneration: 0.95, reasoning: 0.98, summarization: 0.9, longContext: 0.95 },
    costPerMillionTokens: { input: 15, output: 75 },
    avgLatencyMs: 1500,
    enabled: true,
    priority: 10,
  },
  {
    id: 'cloud-gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    contextWindow: 128000,
    capabilities: { codeGeneration: 0.92, reasoning: 0.95, summarization: 0.88, longContext: 0.9 },
    costPerMillionTokens: { input: 10, output: 30 },
    avgLatencyMs: 1200,
    enabled: true,
    priority: 9,
  },
  {
    id: 'cloud-gemini-2-5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    endpoint: 'https://generativelanguage.googleapis.com/v1',
    contextWindow: 2000000,
    capabilities: { codeGeneration: 0.88, reasoning: 0.93, summarization: 0.9, longContext: 0.98 },
    costPerMillionTokens: { input: 5, output: 20 },
    avgLatencyMs: 1400,
    enabled: true,
    priority: 8,
  },
];

export const OPTIMIZATION_MODE_PRESETS: Record<OptimizationMode, Omit<RoutingPolicy, 'id' | 'createdAt' | 'updatedAt'>> = {
  intelligence: {
    name: 'Intelligence',
    description: '偏向最强前沿模型，仅 trivial 任务下沉',
    mode: 'intelligence',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.7 },
    preferredProviders: ['anthropic', 'openai', 'google'],
    enabled: true,
  },
  balance: {
    name: 'Balance',
    description: '默认平衡，权衡质量与成本',
    mode: 'balance',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.5 },
    enabled: true,
  },
  cost: {
    name: 'Cost',
    description: '最大化使用经济型模型，仅高难度任务上调到前沿',
    mode: 'cost',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.3 },
    preferredProviders: ['ollama', 'anthropic', 'openai'],
    enabled: true,
  },
};

// ============ Token Budget Manager ============

class TokenBudgetManager {
  private requestUsage: Array<{ tokens: number; cost: number; timestamp: number }> = [];
  private agentUsage: Map<string, Array<{ tokens: number; cost: number; timestamp: number }>> = new Map();
  private dailyUsage = { tokens: 0, cost: 0, date: this.getToday() };

  constructor(private config: TokenBudgetConfig) {}

  private getToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private resetIfNewDay(): void {
    const today = this.getToday();
    if (this.dailyUsage.date !== today) {
      this.dailyUsage = { tokens: 0, cost: 0, date: today };
    }
  }

  checkBudget(
    estimatedTokens: number,
    estimatedCost: number,
    agentId?: string,
  ): {
    requestBudgetOk: boolean;
    agentBudgetOk: boolean;
    dailyBudgetOk: boolean;
    fallbackReason?: string;
  } {
    this.resetIfNewDay();
    const now = Date.now();

    // 1. 单次预算
    const requestBudgetOk =
      estimatedTokens <= this.config.perRequest.maxTokens &&
      estimatedCost <= this.config.perRequest.maxCostUsd;

    // 2. 单代理预算（最近 1 小时）
    const agentBudgetOk = this.checkAgentBudget(agentId || 'default', estimatedCost, now);

    // 3. 单日预算
    const dailyBudgetOk =
      this.dailyUsage.tokens + estimatedTokens <= this.config.perDay.maxTokens &&
      this.dailyUsage.cost + estimatedCost <= this.config.perDay.maxCostUsd;

    let fallbackReason: string | undefined;
    if (!requestBudgetOk) fallbackReason = 'Request budget exceeded';
    else if (!agentBudgetOk) fallbackReason = 'Agent budget exceeded';
    else if (!dailyBudgetOk) fallbackReason = 'Daily budget exceeded';

    return {
      requestBudgetOk,
      agentBudgetOk,
      dailyBudgetOk,
      fallbackReason,
    };
  }

  private checkAgentBudget(agentId: string, additionalCost: number, now: number): boolean {
    const oneHourAgo = now - 3600 * 1000;
    const usage = this.agentUsage.get(agentId) || [];
    const recentUsage = usage.filter((u) => u.timestamp > oneHourAgo);
    this.agentUsage.set(agentId, recentUsage);

    const totalCost = recentUsage.reduce((sum, u) => sum + u.cost, 0);
    return totalCost + additionalCost <= this.config.perAgent.maxCostUsdPerHour;
  }

  recordUsage(tokens: number, cost: number, agentId?: string): void {
    this.resetIfNewDay();
    const now = Date.now();
    this.requestUsage.push({ tokens, cost, timestamp: now });

    // 清理过期的 request 记录
    const fiveMinAgo = now - 300 * 1000;
    this.requestUsage = this.requestUsage.filter((u) => u.timestamp > fiveMinAgo);

    // 累加 agent usage
    const id = agentId || 'default';
    const agentList = this.agentUsage.get(id) || [];
    agentList.push({ tokens, cost, timestamp: now });
    this.agentUsage.set(id, agentList);

    // 累加 daily usage
    this.dailyUsage.tokens += tokens;
    this.dailyUsage.cost += cost;
  }

  getUsage(scope: 'request' | 'agent' | 'daily', agentId?: string): BudgetUsage {
    this.resetIfNewDay();
    const now = Date.now();

    if (scope === 'request') {
      const fiveMinAgo = now - 300 * 1000;
      const recent = this.requestUsage.filter((u) => u.timestamp > fiveMinAgo);
      const totalCost = recent.reduce((sum, u) => sum + u.cost, 0);
      return {
        used: totalCost,
        limit: this.config.perRequest.maxCostUsd,
        remaining: Math.max(0, this.config.perRequest.maxCostUsd - totalCost),
        resetAt: now + 300 * 1000,
      };
    }

    if (scope === 'agent') {
      const id = agentId || 'default';
      const oneHourAgo = now - 3600 * 1000;
      const usage = (this.agentUsage.get(id) || []).filter((u) => u.timestamp > oneHourAgo);
      const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
      return {
        used: totalCost,
        limit: this.config.perAgent.maxCostUsdPerHour,
        remaining: Math.max(0, this.config.perAgent.maxCostUsdPerHour - totalCost),
        resetAt: now + 3600 * 1000,
      };
    }

    // daily
    return {
      used: this.dailyUsage.cost,
      limit: this.config.perDay.maxCostUsd,
      remaining: Math.max(0, this.config.perDay.maxCostUsd - this.dailyUsage.cost),
      resetAt: now + 24 * 3600 * 1000,
    };
  }

  reset(scope: 'request' | 'agent' | 'daily', agentId?: string): void {
    if (scope === 'request') this.requestUsage = [];
    else if (scope === 'agent') this.agentUsage.delete(agentId || 'default');
    else if (scope === 'daily') this.dailyUsage = { tokens: 0, cost: 0, date: this.getToday() };
  }
}

// ============ 引擎主类 ============

export class EdgeModelRouterEngine {
  private config: EdgeRouterConfig;
  private edgeModels: Map<string, EdgeModelRegistration> = new Map();
  private cloudModels: Map<string, CloudModelRegistration> = new Map();
  private policies: Map<string, RoutingPolicy> = new Map();
  private activePolicyId: string | null = null;
  private routeHistory: RouteDecision[] = [];
  private budgetManager: TokenBudgetManager;
  private listeners: Map<EdgeRouterEvent, Set<(e: any) => void>> = new Map();
  private storageKey = 'hermes.edgeModelRouter';

  constructor(config: Partial<EdgeRouterConfig> = {}) {
    this.config = { ...DEFAULT_EDGE_ROUTER_CONFIG, ...config };
    this.budgetManager = new TokenBudgetManager(this.config.budget);
    if (this.config.persist) {
      this.load();
    } else {
      this.loadPresetModelsAndPolicies();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state = JSON.parse(raw);
        if (state.edgeModels) {
          for (const m of state.edgeModels) this.edgeModels.set(m.id, m);
        }
        if (state.cloudModels) {
          for (const m of state.cloudModels) this.cloudModels.set(m.id, m);
        }
        if (state.policies) {
          for (const p of state.policies) this.policies.set(p.id, p);
        }
        if (state.activePolicyId) this.activePolicyId = state.activePolicyId;
        if (state.routeHistory) this.routeHistory = state.routeHistory;
      }
    } catch (e) {
      console.warn('EdgeModelRouterEngine: failed to load state', e);
    }
    // 如果没有加载到任何内容，加载预置
    if (this.edgeModels.size === 0 && this.cloudModels.size === 0) {
      this.loadPresetModelsAndPolicies();
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state = {
        edgeModels: Array.from(this.edgeModels.values()),
        cloudModels: Array.from(this.cloudModels.values()),
        policies: Array.from(this.policies.values()),
        activePolicyId: this.activePolicyId,
        routeHistory: this.routeHistory.slice(-this.config.maxRouteHistory),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('EdgeModelRouterEngine: failed to save state', e);
    }
  }

  private loadPresetModelsAndPolicies(): void {
    for (const m of PRESET_EDGE_MODELS) {
      if (!this.edgeModels.has(m.id)) {
        this.edgeModels.set(m.id, { ...m, createdAt: Date.now() });
      }
    }
    for (const m of PRESET_CLOUD_MODELS) {
      if (!this.cloudModels.has(m.id)) {
        this.cloudModels.set(m.id, { ...m, createdAt: Date.now() });
      }
    }
    for (const mode of Object.keys(OPTIMIZATION_MODE_PRESETS) as OptimizationMode[]) {
      const id = `policy-${mode}`;
      if (!this.policies.has(id)) {
        this.policies.set(id, {
          ...OPTIMIZATION_MODE_PRESETS[mode],
          id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    if (!this.activePolicyId) {
      this.activePolicyId = 'policy-balance';
    }
    if (this.config.persist) this.save();
  }

  // ============ 事件订阅 ============

  on(event: EdgeRouterEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: EdgeRouterEvent, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(data); } catch (e) { console.error('Listener error:', e); }
      }
    }
  }

  // ============ 模型注册 ============

  registerEdgeModel(model: Omit<EdgeModelRegistration, 'id' | 'createdAt'> & { id?: string }): EdgeModelRegistration {
    const id = model.id || generateModelId();
    const registration: EdgeModelRegistration = { ...model, id, createdAt: Date.now() };
    this.edgeModels.set(id, registration);
    if (this.config.persist) this.save();
    this.emit('model-registered', { model: registration });
    return registration;
  }

  registerCloudModel(model: Omit<CloudModelRegistration, 'id' | 'createdAt'> & { id?: string }): CloudModelRegistration {
    const id = model.id || generateModelId();
    const registration: CloudModelRegistration = { ...model, id, createdAt: Date.now() };
    this.cloudModels.set(id, registration);
    if (this.config.persist) this.save();
    this.emit('model-registered', { model: registration });
    return registration;
  }

  unregisterModel(modelId: string): boolean {
    let removed = false;
    if (this.edgeModels.delete(modelId)) removed = true;
    if (this.cloudModels.delete(modelId)) removed = true;
    if (removed) {
      if (this.config.persist) this.save();
      this.emit('model-unregistered', { modelId });
    }
    return removed;
  }

  listModels(filter?: { tier?: 'edge' | 'cloud'; provider?: ModelProvider; enabled?: boolean }): ModelRegistration[] {
    let all: ModelRegistration[] = [
      ...Array.from(this.edgeModels.values()),
      ...Array.from(this.cloudModels.values()),
    ];
    if (filter?.tier === 'edge') all = all.filter((m) => isEdgeModel(m));
    if (filter?.tier === 'cloud') all = all.filter((m) => !isEdgeModel(m));
    if (filter?.provider) all = all.filter((m) => m.provider === filter.provider);
    if (filter?.enabled !== undefined) all = all.filter((m) => m.enabled === filter.enabled);
    return all;
  }

  getModel(modelId: string): ModelRegistration | undefined {
    return this.edgeModels.get(modelId) || this.cloudModels.get(modelId);
  }

  enableModel(modelId: string, enabled: boolean): void {
    const m = this.getModel(modelId);
    if (m) {
      m.enabled = enabled;
      if (this.config.persist) this.save();
    }
  }

  // ============ 策略管理 ============

  createPolicy(policy: Omit<RoutingPolicy, 'id' | 'createdAt' | 'updatedAt'>): RoutingPolicy {
    const id = generatePolicyId();
    const newPolicy: RoutingPolicy = {
      ...policy,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.policies.set(id, newPolicy);
    if (this.config.persist) this.save();
    this.emit('policy-created', { policy: newPolicy });
    return newPolicy;
  }

  updatePolicy(policyId: string, updates: Partial<RoutingPolicy>): RoutingPolicy {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy not found: ${policyId}`);
    Object.assign(policy, updates, { updatedAt: Date.now() });
    if (this.config.persist) this.save();
    this.emit('policy-updated', { policy });
    return policy;
  }

  deletePolicy(policyId: string): boolean {
    const deleted = this.policies.delete(policyId);
    if (deleted) {
      if (this.activePolicyId === policyId) this.activePolicyId = null;
      if (this.config.persist) this.save();
    }
    return deleted;
  }

  getPolicy(policyId: string): RoutingPolicy | undefined {
    return this.policies.get(policyId);
  }

  listPolicies(): RoutingPolicy[] {
    return Array.from(this.policies.values());
  }

  setActivePolicy(policyId: string): void {
    if (!this.policies.has(policyId)) {
      throw new Error(`Policy not found: ${policyId}`);
    }
    this.activePolicyId = policyId;
    if (this.config.persist) this.save();
    this.emit('policy-activated', { policyId });
  }

  getActivePolicy(): RoutingPolicy {
    if (!this.activePolicyId) {
      throw new Error('No active policy set');
    }
    const policy = this.policies.get(this.activePolicyId);
    if (!policy) {
      throw new Error(`Active policy not found: ${this.activePolicyId}`);
    }
    return policy;
  }

  // ============ Token Budget ============

  getBudgetConfig(): TokenBudgetConfig {
    return { ...this.config.budget };
  }

  updateBudgetConfig(updates: Partial<TokenBudgetConfig>): TokenBudgetConfig {
    this.config.budget = { ...this.config.budget, ...updates };
    this.budgetManager = new TokenBudgetManager(this.config.budget);
    if (this.config.persist) this.save();
    return this.getBudgetConfig();
  }

  getBudgetUsage(scope: 'request' | 'agent' | 'daily', agentId?: string): BudgetUsage {
    return this.budgetManager.getUsage(scope, agentId);
  }

  resetBudget(scope: 'request' | 'agent' | 'daily', agentId?: string): void {
    this.budgetManager.reset(scope, agentId);
  }

  // ============ 路由决策核心 ============

  route(request: RouteRequest, options?: { policyId?: string }): RouteDecision {
    const policy = options?.policyId
      ? this.policies.get(options.policyId) || this.getActivePolicy()
      : this.getActivePolicy();

    if (!policy) {
      throw new Error('No routing policy available');
    }

    // 7 步路由决策
    const decision = this.executeRouting(request, policy);
    this.recordDecision(decision);
    return decision;
  }

  private executeRouting(request: RouteRequest, policy: RoutingPolicy): RouteDecision {
    const allModels = this.listModels({ enabled: true });
    if (allModels.length === 0) {
      throw new Error('No enabled models available');
    }

    let candidates = [...allModels];
    const reason: string[] = [];
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    // Step 1: 隐私 Tier 过滤
    if (request.privacyTier <= policy.privacyThreshold) {
      candidates = candidates.filter((m) => isEdgeModel(m));
      reason.push(`Privacy tier ${request.privacyTier} ≤ threshold ${policy.privacyThreshold}, forced edge`);
    }

    // Step 2: 难度评估
    if (request.estimatedDifficulty === 'trivial' || request.estimatedDifficulty === 'easy') {
      const edgeFirst = candidates.filter((m) => isEdgeModel(m));
      if (edgeFirst.length > 0) {
        candidates = edgeFirst;
        reason.push(`Difficulty ${request.estimatedDifficulty}, edge first`);
      }
    } else if (request.estimatedDifficulty === 'hard' || request.estimatedDifficulty === 'expert') {
      const cloudFirst = candidates.filter((m) => !isEdgeModel(m));
      if (cloudFirst.length > 0) {
        candidates = cloudFirst;
        reason.push(`Difficulty ${request.estimatedDifficulty}, cloud first`);
      }
    }

    // Step 3: 优化模式选择
    if (policy.mode === 'intelligence') {
      candidates = candidates.filter((m) => !isEdgeModel(m) || m.priority >= 5);
      reason.push('Mode: intelligence, prefer high-priority models');
    } else if (policy.mode === 'cost') {
      candidates = candidates.sort((a, b) => estimateCost(a, request.estimatedTokens) - estimateCost(b, request.estimatedTokens));
      reason.push('Mode: cost, sorted by lowest cost');
    }

    // Step 4: 用户偏好
    if (request.userPreference?.modelId) {
      const preferred = candidates.find((m) => m.id === request.userPreference!.modelId);
      if (preferred) {
        candidates = [preferred];
        reason.push(`User preferred model: ${preferred.id}`);
      }
    } else if (request.userPreference?.provider) {
      const preferred = candidates.filter((m) => m.provider === request.userPreference!.provider);
      if (preferred.length > 0) {
        candidates = preferred;
        reason.push(`User preferred provider: ${request.userPreference.provider}`);
      }
    }

    // Step 5: 阻塞模型过滤
    if (policy.blockedModels && policy.blockedModels.length > 0) {
      candidates = candidates.filter((m) => !policy.blockedModels!.includes(m.id));
    }

    // Step 6: 能力匹配
    const requiredCapability = getCapabilityRequirement(request.taskType);
    if (policy.capabilities.minReasoning !== undefined) {
      const minCap = policy.capabilities.minReasoning;
      candidates = candidates.filter((m) => m.capabilities[requiredCapability] >= minCap);
    }
    if (request.requiresLongContext) {
      candidates = candidates.filter((m) => m.contextWindow >= request.estimatedTokens);
    }

    // Step 7: 延迟约束
    if (policy.capabilities.maxLatencyMs !== undefined) {
      candidates = candidates.filter((m) => m.avgLatencyMs <= policy.capabilities.maxLatencyMs!);
    }

    if (candidates.length === 0) {
      // Fallback: 使用任意启用的模型
      candidates = this.listModels({ enabled: true });
      fallbackApplied = true;
      fallbackReason = 'No candidates after filtering, using any enabled model';
      this.emit('fallback-triggered', { reason: fallbackReason });
    }

    // Token Budget 检查
    const selectedModel = candidates[0];
    const estimatedCost = estimateCost(selectedModel, request.estimatedTokens);
    const budgetStatus = this.budgetManager.checkBudget(
      request.estimatedTokens,
      estimatedCost,
      request.agentId,
    );

    if (!budgetStatus.requestBudgetOk || !budgetStatus.dailyBudgetOk) {
      this.emit('budget-exceeded', budgetStatus);
      if (this.config.budget.onExceeded === 'fallback-to-edge') {
        // 尝试 fallback 到端侧
        const edgeCandidates = candidates.filter((m) => isEdgeModel(m));
        if (edgeCandidates.length > 0) {
          candidates = edgeCandidates;
          fallbackApplied = true;
          fallbackReason = budgetStatus.fallbackReason;
        }
      } else if (this.config.budget.onExceeded === 'block') {
        throw new Error(`Budget exceeded: ${budgetStatus.fallbackReason}`);
      }
    }

    // 选择最佳候选
    const finalModel = this.selectBest(candidates, request);
    const finalCost = estimateCost(finalModel, request.estimatedTokens);
    this.budgetManager.recordUsage(request.estimatedTokens, finalCost, request.agentId);

    const decision: RouteDecision = {
      id: generateDecisionId(),
      request,
      selectedModel: finalModel,
      selectedTier: isEdgeModel(finalModel) ? 'edge' : 'cloud',
      reason: reason.join('; '),
      estimatedCost: finalCost,
      estimatedLatencyMs: finalModel.avgLatencyMs,
      timestamp: Date.now(),
      policyId: policy.id,
      budgetStatus,
      fallbackApplied,
      fallbackReason,
    };

    this.emit('route-decided', { decision });
    return decision;
  }

  private selectBest(candidates: ModelRegistration[], request: RouteRequest): ModelRegistration {
    if (candidates.length === 0) {
      throw new Error('No candidates available');
    }
    if (candidates.length === 1) return candidates[0];

    const requiredCapability = getCapabilityRequirement(request.taskType);
    // 按能力评分 + 优先级排序
    const scored = candidates.map((m) => ({
      model: m,
      score: m.capabilities[requiredCapability] * 0.6 + (m.priority / 10) * 0.4,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].model;
  }

  private recordDecision(decision: RouteDecision): void {
    this.routeHistory.push(decision);
    if (this.routeHistory.length > this.config.maxRouteHistory) {
      this.routeHistory = this.routeHistory.slice(-this.config.maxRouteHistory);
    }
    if (this.config.persist) this.save();
  }

  // ============ 路由执行（Mock）============

  async routeAndExecute(
    request: RouteRequest,
    options?: { policyId?: string },
  ): Promise<{ decision: RouteDecision; response?: any }> {
    const decision = this.route(request, options);
    // Mock 执行：模拟延迟
    await new Promise((resolve) => setTimeout(resolve, decision.estimatedLatencyMs / 10));
    return {
      decision,
      response: {
        model: decision.selectedModel.id,
        content: `[Mock response from ${decision.selectedModel.name}]`,
        usage: { input: request.estimatedTokens, output: Math.floor(request.estimatedTokens * 0.3) },
        latencyMs: decision.estimatedLatencyMs,
      },
    };
  }

  // ============ 统计 ============

  getStats(): {
    totalRoutes: number;
    edgeRoutes: number;
    cloudRoutes: number;
    avgCostPerRoute: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    byProvider: Record<ModelProvider, number>;
    byOptimizationMode: Record<OptimizationMode, number>;
    byPrivacyTier: Record<PrivacyTier, number>;
    fallbackCount: number;
  } {
    const stats = {
      totalRoutes: this.routeHistory.length,
      edgeRoutes: 0,
      cloudRoutes: 0,
      avgCostPerRoute: 0,
      avgLatencyMs: 0,
      totalCostUsd: 0,
      byProvider: {} as Record<ModelProvider, number>,
      byOptimizationMode: { intelligence: 0, balance: 0, cost: 0 } as Record<OptimizationMode, number>,
      byPrivacyTier: { 1: 0, 2: 0, 3: 0 } as Record<PrivacyTier, number>,
      fallbackCount: 0,
    };

    let totalCost = 0;
    let totalLatency = 0;
    for (const d of this.routeHistory) {
      if (d.selectedTier === 'edge') stats.edgeRoutes++;
      else stats.cloudRoutes++;
      totalCost += d.estimatedCost;
      totalLatency += d.estimatedLatencyMs;
      stats.byProvider[d.selectedModel.provider] = (stats.byProvider[d.selectedModel.provider] || 0) + 1;
      const policy = this.policies.get(d.policyId);
      if (policy) stats.byOptimizationMode[policy.mode]++;
      stats.byPrivacyTier[d.request.privacyTier]++;
      if (d.fallbackApplied) stats.fallbackCount++;
    }

    stats.totalCostUsd = Number(totalCost.toFixed(6));
    stats.avgCostPerRoute = this.routeHistory.length > 0 ? Number((totalCost / this.routeHistory.length).toFixed(6)) : 0;
    stats.avgLatencyMs = this.routeHistory.length > 0 ? Math.round(totalLatency / this.routeHistory.length) : 0;

    return stats;
  }

  getRouteHistory(filter?: { since?: number; tier?: 'edge' | 'cloud'; limit?: number }): RouteDecision[] {
    let history = [...this.routeHistory];
    if (filter?.since !== undefined) history = history.filter((d) => d.timestamp >= filter.since!);
    if (filter?.tier) history = history.filter((d) => d.selectedTier === filter.tier);
    if (filter?.limit) history = history.slice(-filter.limit);
    return history;
  }

  // ============ 单例 ============

  private static defaultInstance: EdgeModelRouterEngine | null = null;

  static getDefault(): EdgeModelRouterEngine {
    if (!EdgeModelRouterEngine.defaultInstance) {
      EdgeModelRouterEngine.defaultInstance = new EdgeModelRouterEngine();
    }
    return EdgeModelRouterEngine.defaultInstance;
  }

  static resetDefault(): void {
    EdgeModelRouterEngine.defaultInstance = null;
  }
}

export function getDefaultEdgeModelRouterEngine(): EdgeModelRouterEngine {
  return EdgeModelRouterEngine.getDefault();
}

export function resetDefaultEdgeModelRouterEngine(): void {
  EdgeModelRouterEngine.resetDefault();
}
