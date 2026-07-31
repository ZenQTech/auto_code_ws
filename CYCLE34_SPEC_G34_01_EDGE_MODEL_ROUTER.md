# Cycle 34 SPEC: EdgeModelRouterEngine (端云模型路由引擎)

> **任务编号**：G34-01
> **任务名称**：EdgeModelRouterEngine - 端云模型智能路由引擎
> **SPEC 版本**：v1.0.0
> **编写时间**：2026-07-31
> **关联文档**：[CYCLE34_CODEX_TRAE_RESEARCH.md § 2](./CYCLE34_CODEX_TRAE_RESEARCH.md) / [CYCLE34_GAP_ANALYSIS.md § 5.1](./CYCLE34_GAP_ANALYSIS.md)

---

## 1. 任务概述

### 1.1 目标

实现端云模型智能路由引擎，覆盖 Cursor Router 三大优化模式（Intelligence / Balance / Cost）+ Claude Mobile 隐私 Tier 分类 + Token Budget Manager。

### 1.2 范围

**In-Scope**:
- 端侧模型 Provider 注册（Ollama / llama.cpp / Apple Foundation Models 抽象层）
- 云端模型 Provider 注册（Claude / GPT-5 / Gemini 抽象层）
- 请求级分类器（任务难度 / 任务类型 / 隐私等级）
- 三大优化模式（Intelligence / Balance / Cost）
- Token Budget Manager（单次/单代理/单日三层预算）
- 隐私 Tier 分类（Tier 1 健康/金融 → 强制本地）
- 端云成本对比（实时 token 价格 + 延迟 + 质量对比）
- 路由事件系统 + 统计

**Out-of-Scope**:
- 实际 LLM 推理（由 LLM Provider 实现）
- 端侧模型部署（Ollama 进程管理）
- 云端 API 鉴权（由 Provider 内部处理）

---

## 2. 架构设计

### 2.1 类结构

```typescript
class EdgeModelRouterEngine {
  // 核心配置
  private config: EdgeRouterConfig;
  
  // 模型注册表
  private edgeModels: Map<string, EdgeModelRegistration> = new Map();
  private cloudModels: Map<string, CloudModelRegistration> = new Map();
  
  // 路由策略
  private policies: Map<string, RoutingPolicy> = new Map();
  
  // Token 预算管理
  private budgets: TokenBudgetManager;
  
  // 路由历史（用于统计 + 学习）
  private routeHistory: RouteDecision[] = [];
  
  // 分类器
  private classifier: RequestClassifier;
  
  // 事件订阅
  private listeners: Map<EdgeRouterEvent, Set<Function>> = new Map();
}
```

### 2.2 核心数据模型

```typescript
type ModelProvider = 'ollama' | 'llamacpp' | 'apple-foundation' | 'anthropic' | 'openai' | 'google' | 'mock';
type OptimizationMode = 'intelligence' | 'balance' | 'cost';
type PrivacyTier = 1 | 2 | 3;  // 1 = 强制本地, 2 = 可上云（默认）, 3 = 推荐云端

interface EdgeModelRegistration {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  contextWindow: number;          // tokens
  capabilities: {
    codeGeneration: number;        // 0-1 score
    reasoning: number;
    summarization: number;
    longContext: number;
  };
  costPerMillionTokens: { input: number; output: number };
  avgLatencyMs: number;           // 平均响应延迟
  enabled: boolean;
  priority: number;               // 1-10, 数值越大优先级越高
  metadata?: Record<string, any>;
}

interface RoutingPolicy {
  id: string;
  name: string;
  description: string;
  mode: OptimizationMode;
  privacyThreshold: PrivacyTier;  // 低于此 Tier 强制本地
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

interface RouteRequest {
  taskType: 'code-generation' | 'code-review' | 'summarization' | 'translation' | 'classification' | 'general';
  estimatedTokens: number;
  estimatedDifficulty: 'trivial' | 'easy' | 'medium' | 'hard' | 'expert';
  privacyTier: PrivacyTier;
  requiresLongContext: boolean;
  requiresTools: boolean;
  userPreference?: { modelId?: string; provider?: ModelProvider };
  metadata?: Record<string, any>;
}

interface RouteDecision {
  id: string;
  request: RouteRequest;
  selectedModel: EdgeModelRegistration | CloudModelRegistration;
  selectedTier: 'edge' | 'cloud';
  reason: string;                 // 决策原因（用于审计）
  estimatedCost: number;          // USD
  estimatedLatencyMs: number;
  timestamp: number;
  budgetStatus: {
    requestBudgetOk: boolean;
    agentBudgetOk: boolean;
    dailyBudgetOk: boolean;
  };
}

interface TokenBudgetConfig {
  perRequest: { maxTokens: number; maxCostUsd: number };
  perAgent: { maxTokensPerHour: number; maxCostUsdPerHour: number };
  perDay: { maxTokens: number; maxCostUsd: number };
  onExceeded: 'block' | 'fallback-to-edge' | 'warn';
}

type EdgeRouterEvent =
  | 'model-registered'
  | 'model-unregistered'
  | 'policy-created'
  | 'policy-updated'
  | 'route-decided'
  | 'route-executed'
  | 'budget-exceeded'
  | 'fallback-triggered';
```

### 2.3 路由决策流程

```
RouteRequest
   ↓
[1] 隐私 Tier 过滤
   ├─ Tier 1 → 强制端侧
   └─ Tier 2/3 → 继续
   ↓
[2] 难度评估
   ├─ Trivial/Easy → 端侧优先
   └─ Hard/Expert → 云端优先
   ↓
[3] 优化模式选择
   ├─ Intelligence → 云端前沿模型
   ├─ Balance → 平衡选择
   └─ Cost → 端侧优先 + 经济云端
   ↓
[4] Token Budget 检查
   ├─ 单次预算超 → fallback
   ├─ 单代理预算超 → fallback
   └─ 单日预算超 → 强制端侧
   ↓
[5] 能力匹配
   └─ 模型能力 ≥ 任务要求
   ↓
[6] 成本对比
   └─ 选择最经济选项
   ↓
[7] 用户偏好覆盖
   └─ 用户指定模型优先
   ↓
RouteDecision
```

### 2.4 核心 API

```typescript
class EdgeModelRouterEngine {
  constructor(config?: Partial<EdgeRouterConfig>);
  
  // 模型注册
  registerEdgeModel(model: Omit<EdgeModelRegistration, 'id'> & { id?: string }): EdgeModelRegistration;
  registerCloudModel(model: Omit<CloudModelRegistration, 'id'> & { id?: string }): CloudModelRegistration;
  unregisterModel(modelId: string): boolean;
  listModels(filter?: { tier?: 'edge' | 'cloud'; provider?: ModelProvider; enabled?: boolean }): Array<EdgeModelRegistration | CloudModelRegistration>;
  getModel(modelId: string): EdgeModelRegistration | CloudModelRegistration | undefined;
  enableModel(modelId: string, enabled: boolean): void;
  
  // 策略管理
  createPolicy(policy: Omit<RoutingPolicy, 'id' | 'createdAt' | 'updatedAt'>): RoutingPolicy;
  updatePolicy(policyId: string, updates: Partial<RoutingPolicy>): RoutingPolicy;
  deletePolicy(policyId: string): boolean;
  getPolicy(policyId: string): RoutingPolicy | undefined;
  listPolicies(): RoutingPolicy[];
  setActivePolicy(policyId: string): void;
  getActivePolicy(): RoutingPolicy;
  
  // 路由决策
  route(request: RouteRequest, options?: { policyId?: string }): RouteDecision;
  routeAndExecute(request: RouteRequest, options?: { policyId?: string }): Promise<{
    decision: RouteDecision;
    response?: any;  // 由 mock provider 模拟
  }>;
  
  // Token Budget
  getBudgetConfig(): TokenBudgetConfig;
  updateBudgetConfig(updates: Partial<TokenBudgetConfig>): TokenBudgetConfig;
  getBudgetUsage(scope: 'request' | 'agent' | 'daily', agentId?: string): {
    used: number;
    limit: number;
    remaining: number;
    resetAt: number;
  };
  resetBudget(scope: 'request' | 'agent' | 'daily', agentId?: string): void;
  
  // 统计
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
  };
  getRouteHistory(filter?: { since?: number; tier?: 'edge' | 'cloud'; limit?: number }): RouteDecision[];
  
  // 事件订阅
  on(event: EdgeRouterEvent, listener: (e: any) => void): () => void;
  emit(event: EdgeRouterEvent, data: any): void;
}
```

### 2.5 隐私 Tier 分类器

```typescript
class RequestClassifier {
  classifyPrivacyTier(request: RouteRequest): PrivacyTier;
  classifyDifficulty(request: RouteRequest): 'trivial' | 'easy' | 'medium' | 'hard' | 'expert';
  
  // 关键词识别
  private detectSensitiveKeywords(text: string): boolean;  // 健康/金融/医疗
}
```

**Tier 1 触发关键词**：`医疗` / `健康` / `金融` / `银行` / `密码` / `身份证` / `医保` / `病历` / `credit card` / `ssn` / `password` / `health` / `medical` / `financial`

### 2.6 三大优化模式策略

```typescript
const OPTIMIZATION_MODE_PRESETS: Record<OptimizationMode, Partial<RoutingPolicy>> = {
  intelligence: {
    name: 'Intelligence',
    description: '偏向最强前沿模型，仅 trivial 任务下沉',
    mode: 'intelligence',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.7 },
    preferredProviders: ['anthropic', 'openai', 'google'],
  },
  balance: {
    name: 'Balance',
    description: '默认平衡，权衡质量与成本',
    mode: 'balance',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.5 },
  },
  cost: {
    name: 'Cost',
    description: '最大化使用经济型模型，仅高难度任务上调到前沿',
    mode: 'cost',
    privacyThreshold: 1,
    capabilities: { minReasoning: 0.3 },
    preferredProviders: ['ollama', 'anthropic', 'openai'],
  },
};
```

### 2.7 预置模型（Mock Provider）

```typescript
const PRESET_EDGE_MODELS: EdgeModelRegistration[] = [
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

const PRESET_CLOUD_MODELS: CloudModelRegistration[] = [
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
```

### 2.8 Token Budget Manager

```typescript
class TokenBudgetManager {
  private requestUsage: { tokens: number; cost: number; timestamp: number }[] = [];
  private agentUsage: Map<string, Array<{ tokens: number; cost: number; timestamp: number }>> = new Map();
  private dailyUsage: { tokens: number; cost: number; date: string } = { tokens: 0, cost: 0, date: '' };
  
  constructor(private config: TokenBudgetConfig) {}
  
  checkBudget(request: RouteRequest, estimatedCost: number, estimatedTokens: number, agentId?: string): {
    requestBudgetOk: boolean;
    agentBudgetOk: boolean;
    dailyBudgetOk: boolean;
    fallbackReason?: string;
  };
  
  recordUsage(tokens: number, cost: number, agentId?: string): void;
  
  getUsage(scope: 'request' | 'agent' | 'daily', agentId?: string): BudgetUsage;
  
  reset(scope: 'request' | 'agent' | 'daily', agentId?: string): void;
}
```

---

## 3. 实施步骤

### Phase 1: 数据模型 + 基础结构（30 分钟）
- 定义所有 TypeScript 接口和类型
- 实现 `EdgeModelRouterEngine` 类骨架
- 实现事件订阅基础设施

### Phase 2: 模型注册 + 预置（30 分钟）
- `registerEdgeModel` / `registerCloudModel` / `unregisterModel`
- `loadPresetModels` 加载 3+3 预置模型
- 单元测试：15 个

### Phase 3: 策略管理（30 分钟）
- `createPolicy` / `updatePolicy` / `deletePolicy`
- `setActivePolicy` / `getActivePolicy`
- 三大优化模式预置
- 单元测试：12 个

### Phase 4: Token Budget Manager（30 分钟）
- 单次/单代理/单日三层预算
- 预算超限 fallback
- 单元测试：15 个

### Phase 5: 路由决策核心（60 分钟）
- `RequestClassifier` 难度 + 隐私分类
- 路由决策 7 步流程
- `route` / `routeAndExecute`
- 单元测试：20 个

### Phase 6: 统计 + 事件 + 单例（30 分钟）
- `getStats` / `getRouteHistory`
- 事件订阅完整实现
- `getDefaultEdgeModelRouterEngine` 单例
- 单元测试：13 个

**预计总测试数**：约 75-85 个

---

## 4. 验收标准

### 4.1 功能验收
- ✅ 支持 6+ 预置模型（3 端 + 3 云）
- ✅ 三大优化模式正确路由
- ✅ 隐私 Tier 1 强制本地
- ✅ Token Budget 超限 fallback
- ✅ 用户偏好可覆盖默认路由
- ✅ 路由决策可追溯（reason + timestamp）
- ✅ 端云成本实时对比

### 4.2 质量验收
- ✅ TypeScript 0 错误
- ✅ 单元测试 100% 通过
- ✅ 单元测试覆盖率 ≥ 85%
- ✅ 与 ModelRouter (C11) 接口兼容
- ✅ 与 CostAttribution (C31) 数据格式一致

### 4.3 性能验收
- ✅ 路由决策耗时 < 5ms
- ✅ 内存占用 < 5MB
- ✅ 支持 1000+ 路由历史记录

---

## 5. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 端侧模型依赖 Ollama 进程 | 🟡 中 | Provider 抽象层 + 健康检查 |
| 隐私分类误判 | 🟡 中 | 关键词集合 + 用户显式覆盖 |
| Token Budget 边界情况 | 🟢 低 | 多种 onExceeded 策略 |
| Provider 端点变更 | 🟢 低 | 配置驱动 + 热更新 |

---

## 6. 与现有模块集成点

```typescript
// ModelRouter (C11) - 扩展云端路由
EdgeModelRouterEngine → extends ModelRouter.cloudModels

// CostAttribution (C31) - 端云成本拆分
EdgeModelRouterEngine → recordUsage → CostAttributionEngine

// CostBudget (C29) - 联动三层预算
EdgeModelRouterEngine.TokenBudgetManager → CostBudgetEngine

// BackgroundTask (C4) - 任务路由
BackgroundTask.execute → EdgeModelRouterEngine.route
```

---

## 7. 文件结构

```
frontend/src/utils/
  edgeModelRouterEngine.ts          # 核心引擎 (~1100 行)
  edgeModelRouterEngine.test.ts     # 单元测试 (~85 用例)
  edgeModelRouterTypes.ts           # 类型定义 (可选)
```

```
frontend/src/components/
  EdgeModelRouterPanel.tsx          # UI 面板
```

```
frontend/src/components/
  Cycle34E2E.test.tsx               # 3 引擎 E2E
```

---

## SPEC 结束

> **下一步**：基于本 SPEC 实现 `edgeModelRouterEngine.ts` + 单元测试
