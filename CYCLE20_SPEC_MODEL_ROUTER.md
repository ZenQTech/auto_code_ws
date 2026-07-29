# Cycle 20 G20-02: Smart Model Router - 技术规范

> **任务编号**: G20-02
> **优先级**: P0 (必做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- 缺少智能模型路由，每次任务都使用固定模型
- Cursor Router 提供 Intelligence/Balance/Cost 三种优化模式
- 用户需要手动选择模型，无法根据任务自动选择

### 1.2 目标

- 任务分类（代码生成/文档/调试/解释/翻译等）
- 复杂度评估（token 数/嵌套层级/外部依赖数）
- 三种优化模式：Cost / Balance / Intelligence
- 自动选择最合适的模型
- 路由决策日志

---

## 二、核心数据结构

### 2.1 TaskCategory

```typescript
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
```

### 2.2 RoutingMode

```typescript
export type RoutingMode = 'cost' | 'balance' | 'intelligence';
```

### 2.3 ModelRoute

```typescript
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
```

### 2.4 ModelInfo

```typescript
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
```

---

## 三、核心 API

### 3.1 ModelRouter

```typescript
export class ModelRouter {
  private models: Map<string, ModelInfo> = new Map();
  private decisionLog: ModelRoute[] = [];
  private mode: RoutingMode = 'balance';
  private readonly eventBus: RouterEventBus = new RouterEventBus();

  /**
   * 注册模型
   */
  registerModel(model: ModelInfo): void;

  /**
   * 设置路由模式
   */
  setMode(mode: RoutingMode): void;

  /**
   * 获取当前模式
   */
  getMode(): RoutingMode;

  /**
   * 任务分类
   */
  classify(prompt: string, context?: RouterContext): TaskCategory;

  /**
   * 复杂度评估
   */
  estimateComplexity(prompt: string, context?: RouterContext): number;

  /**
   * 路由决策
   */
  route(prompt: string, context?: RouterContext): ModelRoute;

  /**
   * 获取决策日志
   */
  getDecisionLog(filter?: DecisionLogFilter): ModelRoute[];

  /**
   * 清空决策日志
   */
  clearDecisionLog(): void;

  /**
   * 订阅事件
   */
  on(event: RouterEventType, handler: RouterEventHandler): () => void;
}
```

### 3.2 RouterContext

```typescript
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
```

### 3.3 单例工厂

```typescript
export function getModelRouter(): ModelRouter;
export function resetModelRouter(): void;
```

---

## 四、路由算法

### 4.1 任务分类

基于关键词匹配的简单分类器：

```typescript
const KEYWORD_PATTERNS: Record<TaskCategory, RegExp[]> = {
  code_generation: [/编写/, /实现/, /添加.*功能/, /create.*function/i, /implement/i, /add.*feature/i],
  code_review: [/审查/, /review/i, /检查.*代码/, /check.*code/i],
  debugging: [/调试/, /debug/i, /修复.*bug/i, /fix.*bug/i, /错误/],
  documentation: [/文档/, /documentation/i, /注释/, /comment/i, /README/],
  translation: [/翻译/, /translate/i, /转换.*语言/],
  explanation: [/解释/, /explain/i, /说明/, /describe/i, /什么是/],
  refactoring: [/重构/, /refactor/i, /优化.*结构/],
  testing: [/测试/, /test/i, /单元测试/, /unit test/i],
  analysis: [/分析/, /analyze/i, /评估/, /evaluate/i],
  brainstorm: [/头脑风暴/, /brainstorm/i, /想法/, /idea/i, /建议/],
  unknown: [],
};

function classify(prompt: string): TaskCategory {
  let bestCategory: TaskCategory = 'unknown';
  let bestScore = 0;
  for (const [category, patterns] of Object.entries(KEYWORD_PATTERNS)) {
    const score = patterns.filter(p => p.test(prompt)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category as TaskCategory;
    }
  }
  return bestCategory;
}
```

### 4.2 复杂度评估

```typescript
function estimateComplexity(prompt: string, context?: RouterContext): number {
  let complexity = 1;
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
  if (context?.fileCount && context.fileCount > 5) complexity += 1;
  if (context?.fileCount && context.fileCount > 20) complexity += 2;
  // 嵌套层级
  if (context?.nestingLevel && context.nestingLevel > 3) complexity += 1;
  // 外部依赖
  if (context?.externalDependencies && context.externalDependencies > 3) complexity += 1;
  return Math.min(complexity, 10);
}
```

### 4.3 模型评分

```typescript
function scoreModel(model: ModelInfo, category: TaskCategory, complexity: number, mode: RoutingMode): number {
  let score = 0;
  // 能力分
  score += model.capabilityScore * 10;
  // 专业领域加分
  if (model.specialties.includes(category)) {
    score += 20;
  }
  // 速度分
  score += model.speedScore * 5;
  // 模式调整
  if (mode === 'cost') {
    // 优先低成本
    const costScore = 100 - (model.inputCostPer1k + model.outputCostPer1k) * 100;
    score = score * 0.3 + costScore * 0.7;
  } else if (mode === 'intelligence') {
    // 优先高能力
    score = score * 1.5;
  } else if (mode === 'balance') {
    // 平衡
    const costScore = 100 - (model.inputCostPer1k + model.outputCostPer1k) * 50;
    score = score * 0.7 + costScore * 0.3;
  }
  return score;
}
```

---

## 五、UI 组件

### 5.1 RouterDashboard

- 路由模式切换器（Cost/Balance/Intelligence）
- 模型列表（按能力/速度/成本排序）
- 决策日志（最近 100 条）
- 统计面板（每个模型的调用次数/平均成本）

### 5.2 RouterBadge

- 在 BestOfNPanel 中显示每个候选的实际选择原因
- 在 BackgroundTasks 中显示任务使用的模型

### 5.3 RouterPanel

- 集成到 BrandHeader 菜单
- 模式切换 + 日志查看 + 统计

---

## 六、预置模型

```typescript
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
```

---

## 七、测试要求

### 7.1 单元测试 (40+)

- registerModel / setMode / getMode
- classify 各类任务的分类准确性
- estimateComplexity 边界值
- route 三种模式下的模型选择
- getDecisionLog / clearDecisionLog
- 错误场景：未注册模型、空 prompt

### 7.2 集成测试 (30+)

- RouterDashboard 渲染 + 切换
- RouterPanel 菜单集成
- 与 BestOfNPanel 协同
- 与 BackgroundTasks 协同

### 7.3 E2E 测试 (30+ 断言)

- Section 1: ModelRouter 引擎 (15 项)
- Section 2: RouterDashboard UI (8 项)
- Section 3: BrandHeader 集成 (3 项)
- Section 4: BestOfN 集成 (4 项)

---

## 八、依赖与配置

### 8.1 依赖

无需新增 npm 依赖。

### 8.2 文件清单

- `frontend/src/utils/modelRouter.ts` (550 行)
- `frontend/src/utils/modelRouter.test.ts` (300 行)
- `frontend/src/components/RouterDashboard.tsx` (350 行)
- `frontend/src/components/RouterDashboard.test.tsx` (200 行)
- 修改：
  - `frontend/src/components/BrandHeader.tsx` (+30 行)
  - `frontend/src/App.tsx` (+20 行)
  - `frontend/src/utils/multiModelExecutor.ts` (+20 行)

---

## 九、验收标准

- ✅ 任务分类准确率 ≥ 80%
- ✅ 三种模式可切换
- ✅ 路由决策完整记录
- ✅ 单元测试 40+ 100% 通过
- ✅ 集成测试 30+ 100% 通过
- ✅ E2E 断言 30+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ UI 组件完整（RouterDashboard）
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 14:45
**下一步**: 创建其他 SPEC + 开始 G20-02 实施
