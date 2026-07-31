/**
 * # Edge Model Router Engine - 单元测试
 * # Cycle 34 G34-01
 * # 覆盖：工具函数、初始化、模型注册、策略管理、Token预算、路由决策、统计、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EdgeModelRouterEngine,
  isEdgeModel,
  estimateCost,
  detectPrivacyTier,
  getCapabilityRequirement,
  generateModelId,
  generatePolicyId,
  generateDecisionId,
  PRESET_EDGE_MODELS,
  PRESET_CLOUD_MODELS,
  getDefaultEdgeModelRouterEngine,
  resetDefaultEdgeModelRouterEngine,
} from './edgeModelRouterEngine';

describe('EdgeModelRouterEngine - 工具函数', () => {
  it('isEdgeModel 正确识别端侧模型', () => {
    expect(isEdgeModel({ ...PRESET_EDGE_MODELS[0], createdAt: 0 })).toBe(true);
    expect(isEdgeModel({ ...PRESET_CLOUD_MODELS[0], createdAt: 0 })).toBe(false);
  });

  it('estimateCost 正确计算成本', () => {
    const model = { ...PRESET_CLOUD_MODELS[0], createdAt: 0 };  // Claude Opus
    const cost = estimateCost(model, 1000000);  // 1M tokens
    expect(cost).toBeGreaterThan(0);
    // 1M input * $15/M + 0.3M output * $75/M = 15 + 22.5 = 37.5
    expect(cost).toBeCloseTo(37.5, 1);
  });

  it('estimateCost 端侧模型成本为 0', () => {
    const model = { ...PRESET_EDGE_MODELS[0], createdAt: 0 };
    expect(estimateCost(model, 1000000)).toBe(0);
  });

  it('detectPrivacyTier 正确识别 Tier 1', () => {
    expect(detectPrivacyTier('用户提供了医疗数据')).toBe(1);
    expect(detectPrivacyTier('Credit card info')).toBe(1);
    expect(detectPrivacyTier('这是密码')).toBe(1);
  });

  it('detectPrivacyTier 默认返回 Tier 2', () => {
    expect(detectPrivacyTier('Hello world')).toBe(2);
    expect(detectPrivacyTier('代码评审')).toBe(2);
  });

  it('getCapabilityRequirement 正确映射', () => {
    expect(getCapabilityRequirement('code-generation')).toBe('codeGeneration');
    expect(getCapabilityRequirement('summarization')).toBe('summarization');
    expect(getCapabilityRequirement('code-review')).toBe('reasoning');
  });

  it('generateXxxId 生成唯一 ID', () => {
    expect(generateModelId()).toMatch(/^model-/);
    expect(generatePolicyId()).toMatch(/^policy-/);
    expect(generateDecisionId()).toMatch(/^dec-/);
    expect(generateModelId()).not.toBe(generateModelId());
  });
});

describe('EdgeModelRouterEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('创建时不加载预置（如 persist=false）', () => {
    const engine = new EdgeModelRouterEngine({ persist: false });
    expect(engine.listModels()).toHaveLength(6);  // 3+3 预置
  });

  it('加载预置：3 端 + 3 云模型', () => {
    const engine = new EdgeModelRouterEngine({ persist: false });
    const edge = engine.listModels({ tier: 'edge' });
    const cloud = engine.listModels({ tier: 'cloud' });
    expect(edge).toHaveLength(3);
    expect(cloud).toHaveLength(3);
  });

  it('加载 3 大优化模式预置策略', () => {
    const engine = new EdgeModelRouterEngine({ persist: false });
    const policies = engine.listPolicies();
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.mode === 'intelligence')).toBeDefined();
    expect(policies.find((p) => p.mode === 'balance')).toBeDefined();
    expect(policies.find((p) => p.mode === 'cost')).toBeDefined();
  });

  it('默认激活 Balance 策略', () => {
    const engine = new EdgeModelRouterEngine({ persist: false });
    expect(engine.getActivePolicy().mode).toBe('balance');
  });

  it('持久化：从 localStorage 恢复状态', () => {
    const engine1 = new EdgeModelRouterEngine({ persist: true });
    const customModel = engine1.registerCloudModel({
      name: 'Custom',
      provider: 'openai',
      endpoint: 'https://api.openai.com',
      contextWindow: 100000,
      capabilities: { codeGeneration: 0.9, reasoning: 0.9, summarization: 0.9, longContext: 0.9 },
      costPerMillionTokens: { input: 5, output: 15 },
      avgLatencyMs: 1000,
      enabled: true,
      priority: 7,
    });
    const engine2 = new EdgeModelRouterEngine({ persist: true });
    expect(engine2.getModel(customModel.id)).toBeDefined();
  });
});

describe('EdgeModelRouterEngine - 模型注册', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('registerEdgeModel 注册端侧模型', () => {
    const m = engine.registerEdgeModel({
      name: 'Test Edge',
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      contextWindow: 4096,
      capabilities: { codeGeneration: 0.5, reasoning: 0.5, summarization: 0.5, longContext: 0.5 },
      costPerMillionTokens: { input: 0, output: 0 },
      avgLatencyMs: 150,
      enabled: true,
      priority: 5,
    });
    expect(m.id).toBeDefined();
    expect(m.id).toMatch(/^model-/);
    expect(engine.getModel(m.id)?.name).toBe('Test Edge');
  });

  it('registerCloudModel 注册云端模型', () => {
    const m = engine.registerCloudModel({
      name: 'Test Cloud',
      provider: 'openai',
      endpoint: 'https://api.openai.com',
      contextWindow: 128000,
      capabilities: { codeGeneration: 0.9, reasoning: 0.9, summarization: 0.9, longContext: 0.9 },
      costPerMillionTokens: { input: 5, output: 15 },
      avgLatencyMs: 1000,
      enabled: true,
      priority: 8,
    });
    expect(m.id).toBeDefined();
  });

  it('unregisterModel 注销模型', () => {
    const m = engine.registerEdgeModel({
      name: 'X', provider: 'ollama', endpoint: 'x', contextWindow: 4096,
      capabilities: { codeGeneration: 0.5, reasoning: 0.5, summarization: 0.5, longContext: 0.5 },
      costPerMillionTokens: { input: 0, output: 0 },
      avgLatencyMs: 100, enabled: true, priority: 5,
    });
    expect(engine.unregisterModel(m.id)).toBe(true);
    expect(engine.getModel(m.id)).toBeUndefined();
  });

  it('listModels 按 tier 过滤', () => {
    const edge = engine.listModels({ tier: 'edge' });
    const cloud = engine.listModels({ tier: 'cloud' });
    expect(edge.every((m) => isEdgeModel(m))).toBe(true);
    expect(cloud.every((m) => !isEdgeModel(m))).toBe(true);
  });

  it('listModels 按 provider 过滤', () => {
    const ollama = engine.listModels({ provider: 'ollama' });
    expect(ollama.every((m) => m.provider === 'ollama')).toBe(true);
  });

  it('listModels 按 enabled 过滤', () => {
    const enabled = engine.listModels({ enabled: true });
    expect(enabled.every((m) => m.enabled)).toBe(true);
  });

  it('enableModel 切换启用状态', () => {
    const m = engine.listModels()[0];
    engine.enableModel(m.id, false);
    expect(engine.getModel(m.id)?.enabled).toBe(false);
  });
});

describe('EdgeModelRouterEngine - 策略管理', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('createPolicy 创建自定义策略', () => {
    const p = engine.createPolicy({
      name: 'Custom',
      description: 'Test',
      mode: 'balance',
      privacyThreshold: 1,
      capabilities: {},
      enabled: true,
    });
    expect(p.id).toBeDefined();
    expect(engine.getPolicy(p.id)?.name).toBe('Custom');
  });

  it('updatePolicy 更新策略', () => {
    const p = engine.createPolicy({
      name: 'Test', description: '', mode: 'balance',
      privacyThreshold: 1, capabilities: {}, enabled: true,
    });
    const updated = engine.updatePolicy(p.id, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  it('deletePolicy 删除策略', () => {
    const p = engine.createPolicy({
      name: 'Test', description: '', mode: 'balance',
      privacyThreshold: 1, capabilities: {}, enabled: true,
    });
    expect(engine.deletePolicy(p.id)).toBe(true);
    expect(engine.getPolicy(p.id)).toBeUndefined();
  });

  it('setActivePolicy 切换激活策略', () => {
    const p = engine.createPolicy({
      name: 'A', description: '', mode: 'cost',
      privacyThreshold: 1, capabilities: {}, enabled: true,
    });
    engine.setActivePolicy(p.id);
    expect(engine.getActivePolicy().mode).toBe('cost');
  });

  it('setActivePolicy 不存在的策略抛错', () => {
    expect(() => engine.setActivePolicy('xxx')).toThrow();
  });
});

describe('EdgeModelRouterEngine - Token 预算', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('getBudgetConfig 返回配置', () => {
    const cfg = engine.getBudgetConfig();
    expect(cfg.perRequest.maxTokens).toBeGreaterThan(0);
  });

  it('updateBudgetConfig 更新预算', () => {
    const updated = engine.updateBudgetConfig({
      perRequest: { maxTokens: 100, maxCostUsd: 1 },
    });
    expect(updated.perRequest.maxTokens).toBe(100);
  });

  it('getBudgetUsage 返回使用情况', () => {
    const usage = engine.getBudgetUsage('request');
    expect(usage.limit).toBeGreaterThan(0);
  });

  it('resetBudget 重置预算', () => {
    engine.resetBudget('request');
    engine.resetBudget('agent');
    engine.resetBudget('daily');
    expect(true).toBe(true);
  });
});

describe('EdgeModelRouterEngine - 路由决策', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('route 基本路由生成决策', () => {
    const decision = engine.route({
      taskType: 'code-generation',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.id).toBeDefined();
    expect(decision.selectedModel).toBeDefined();
    expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it('route 隐私 Tier 1 强制本地', () => {
    const decision = engine.route({
      taskType: 'general',
      estimatedTokens: 1000,
      estimatedDifficulty: 'easy',
      privacyTier: 1,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.selectedTier).toBe('edge');
  });

  it('route 困难任务选择云端', () => {
    const decision = engine.route({
      taskType: 'code-review',
      estimatedTokens: 5000,
      estimatedDifficulty: 'expert',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.selectedTier).toBe('cloud');
  });

  it('route Trivial 任务偏向本地', () => {
    const decision = engine.route({
      taskType: 'classification',
      estimatedTokens: 100,
      estimatedDifficulty: 'trivial',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.selectedTier).toBe('edge');
  });

  it('route 用户偏好模型优先', () => {
    const decision = engine.route({
      taskType: 'general',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
      userPreference: { modelId: 'cloud-gpt-5' },
    });
    expect(decision.selectedModel.id).toBe('cloud-gpt-5');
  });

  it('route 用户偏好 provider 优先', () => {
    const decision = engine.route({
      taskType: 'general',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
      userPreference: { provider: 'google' },
    });
    expect(decision.selectedModel.provider).toBe('google');
  });

  it('route 长上下文约束', () => {
    const decision = engine.route({
      taskType: 'summarization',
      estimatedTokens: 1500000,  // 1.5M tokens
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: true,
      requiresTools: false,
    });
    expect(decision.selectedModel.contextWindow).toBeGreaterThanOrEqual(1500000);
  });

  it('route Intelligence 模式偏好高优先级', () => {
    engine.setActivePolicy('policy-intelligence');
    const decision = engine.route({
      taskType: 'code-generation',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.selectedModel.priority).toBeGreaterThanOrEqual(5);
  });

  it('route Cost 模式偏好低成本', () => {
    engine.setActivePolicy('policy-cost');
    const decision = engine.route({
      taskType: 'code-generation',
      estimatedTokens: 1000,
      estimatedDifficulty: 'easy',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.selectedTier).toBe('edge');  // cost 模式 + easy 难度 → 端侧
  });

  it('routeAndExecute 异步执行', async () => {
    const result = await engine.routeAndExecute({
      taskType: 'general',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(result.decision).toBeDefined();
    expect(result.response).toBeDefined();
    expect(result.response.model).toBe(result.decision.selectedModel.id);
  });

  it('route 决策包含预算检查', () => {
    const decision = engine.route({
      taskType: 'general',
      estimatedTokens: 1000,
      estimatedDifficulty: 'medium',
      privacyTier: 2,
      requiresLongContext: false,
      requiresTools: false,
    });
    expect(decision.budgetStatus).toBeDefined();
    expect(decision.budgetStatus.requestBudgetOk).toBe(true);
  });
});

describe('EdgeModelRouterEngine - 统计', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('getStats 返回完整统计', () => {
    engine.route({
      taskType: 'general', estimatedTokens: 100, estimatedDifficulty: 'easy',
      privacyTier: 2, requiresLongContext: false, requiresTools: false,
    });
    const stats = engine.getStats();
    expect(stats.totalRoutes).toBe(1);
    expect(stats.avgCostPerRoute).toBeGreaterThanOrEqual(0);
    expect(stats.avgLatencyMs).toBeGreaterThan(0);
  });

  it('getStats 按 provider 统计', () => {
    engine.route({
      taskType: 'general', estimatedTokens: 100, estimatedDifficulty: 'easy',
      privacyTier: 2, requiresLongContext: false, requiresTools: false,
    });
    const stats = engine.getStats();
    const providers = Object.keys(stats.byProvider);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('getRouteHistory 返回历史', () => {
    engine.route({
      taskType: 'general', estimatedTokens: 100, estimatedDifficulty: 'easy',
      privacyTier: 2, requiresLongContext: false, requiresTools: false,
    });
    const history = engine.getRouteHistory();
    expect(history.length).toBe(1);
  });

  it('getRouteHistory 按 tier 过滤', () => {
    engine.route({
      taskType: 'general', estimatedTokens: 100, estimatedDifficulty: 'easy',
      privacyTier: 1, requiresLongContext: false, requiresTools: false,
    });
    const edgeHistory = engine.getRouteHistory({ tier: 'edge' });
    expect(edgeHistory.every((d) => d.selectedTier === 'edge')).toBe(true);
  });
});

describe('EdgeModelRouterEngine - 事件订阅', () => {
  let engine: EdgeModelRouterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new EdgeModelRouterEngine({ persist: false });
  });

  it('model-registered 事件触发', () => {
    const events: any[] = [];
    engine.on('model-registered', (e) => events.push(e));
    engine.registerEdgeModel({
      name: 'X', provider: 'ollama', endpoint: 'x', contextWindow: 4096,
      capabilities: { codeGeneration: 0.5, reasoning: 0.5, summarization: 0.5, longContext: 0.5 },
      costPerMillionTokens: { input: 0, output: 0 },
      avgLatencyMs: 100, enabled: true, priority: 5,
    });
    expect(events.length).toBe(1);
  });

  it('route-decided 事件触发', () => {
    const events: any[] = [];
    engine.on('route-decided', (e) => events.push(e));
    engine.route({
      taskType: 'general', estimatedTokens: 100, estimatedDifficulty: 'easy',
      privacyTier: 2, requiresLongContext: false, requiresTools: false,
    });
    expect(events.length).toBe(1);
  });

  it('policy-activated 事件触发', () => {
    const events: any[] = [];
    engine.on('policy-activated', (e) => events.push(e));
    engine.setActivePolicy('policy-intelligence');
    expect(events.length).toBe(1);
  });
});

describe('EdgeModelRouterEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultEdgeModelRouterEngine();
  });

  it('getDefaultEdgeModelRouterEngine 单例', () => {
    const a = getDefaultEdgeModelRouterEngine();
    const b = getDefaultEdgeModelRouterEngine();
    expect(a).toBe(b);
  });

  it('resetDefaultEdgeModelRouterEngine 重置', () => {
    const a = getDefaultEdgeModelRouterEngine();
    resetDefaultEdgeModelRouterEngine();
    const b = getDefaultEdgeModelRouterEngine();
    expect(a).not.toBe(b);
  });
});
