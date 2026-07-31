# CYCLE38 规格说明书：G38-03 反思与自我修正引擎（Reflexion 模式）

> 周期：Cycle 38  
> 任务 ID：G38-03  
> 模块名称：ReflectionEngine  
> 版本：v1.0.0  
> 日期：2026-07-31

---

## 一、模块定位

### 1.1 核心作用

实现 Reflexion 风格的 Agent 自我反思与迭代修正能力：执行后自动评估 → 生成反思 → 调整策略 → 重新执行，直至达到质量阈值或最大迭代次数。

### 1.2 对标产品

- **Reflexion**（Stanford NLP）- Verbal Reinforcement Learning
- **Self-Refine**（MIT）- Iterative Refinement with Self-Feedback
- **CRITIC** - 大型语言模型自我批评

### 1.3 与现有模块关系

- **G37-03 AgentLoopEngine**：基础 ReAct 循环，本模块增强其反思能力
- **G38-02 LongTermMemoryEngine**：反思结果存入长期记忆
- **G37-04 RealLLMProvider**：反思生成调用 LLM

---

## 二、核心数据结构

### 2.1 Reflection（反思）

```typescript
export type ReflectionType = 'success' | 'failure' | 'partial' | 'neutral';

export interface Reflection {
  id: string;
  type: ReflectionType;
  taskId: string;
  iteration: number;          // 第几轮迭代
  evaluation: string;         // 评估结论
  lessonsLearned: string[];   // 经验教训
  improvementSuggestions: string[];  // 改进建议
  emotionalTone: 'positive' | 'neutral' | 'negative';
  importance: number;         // 0-1
  createdAt: number;
  metadata?: Record<string, unknown>;
}
```

### 2.2 Evaluation（评估）

```typescript
export interface Evaluation {
  taskId: string;
  iteration: number;
  score: number;              // 0-1 综合质量分
  criteria: EvaluationCriteria[];
  passed: boolean;            // 是否通过阈值
  feedback: string;
  evaluator: 'auto' | 'human' | 'llm';
  evaluatedAt: number;
}

export interface EvaluationCriteria {
  name: string;
  weight: number;             // 0-1
  score: number;              // 0-1
  comment?: string;
}
```

### 2.3 IterationStrategy（迭代策略）

```typescript
export type TerminationCondition = 'quality-met' | 'max-iterations' | 'no-improvement' | 'budget-exhausted' | 'human-cancel';

export interface IterationConfig {
  maxIterations: number;       // 默认 5
  qualityThreshold: number;    // 默认 0.8
  minImprovementDelta: number; // 默认 0.05
  earlyStopOnPlateau: boolean; // 默认 true
  plateauWindow: number;       // 默认 2
  budgetLimit?: {
    maxTokens?: number;
    maxDurationMs?: number;
    maxCostUsd?: number;
  };
}
```

### 2.4 ReflexionSession（反思会话）

```typescript
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

export interface IterationRecord {
  iteration: number;
  strategy: string;
  execution: TaskExecutionResult;
  evaluation: Evaluation;
  reflection: Reflection;
  startedAt: number;
  completedAt: number;
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
```

---

## 三、核心组件

### 3.1 Evaluator（评估器）

```typescript
export class Evaluator {
  constructor(options?: EvaluatorOptions);
  
  // 多维度评估
  async evaluate(result: TaskExecutionResult, criteria: EvaluationCriteria[]): Promise<Evaluation>;
  
  // 简单评分（0-1）
  quickScore(result: TaskExecutionResult): Promise<number>;
  
  // 自定义评估器
  registerCustomCriterion(name: string, fn: (result: TaskExecutionResult) => Promise<{ score: number; comment?: string }>): void;
}
```

**内置评估维度**：
- **completeness**（完整性，权重 0.3）：输出是否完整回答任务
- **correctness**（正确性，权重 0.4）：输出是否事实正确
- **clarity**（清晰度，权重 0.15）：输出是否易于理解
- **efficiency**（效率，权重 0.15）：步骤数 / token 数是否合理

**自动评估方法**：
1. 基于规则（检查输出是否包含必要关键词）
2. 基于 LLM（调用 LLM 评分）
3. 基于测试用例（运行测试函数验证）

### 3.2 ReflectionGenerator（反思生成器）

```typescript
export class ReflectionGenerator {
  constructor(options?: ReflectionGeneratorOptions);
  
  // 生成反思
  async generate(execution: TaskExecutionResult, evaluation: Evaluation, previousReflections?: Reflection[]): Promise<Reflection>;
  
  // 成功反思
  private async reflectOnSuccess(execution: TaskExecutionResult, evaluation: Evaluation): Promise<Reflection>;
  
  // 失败反思
  private async reflectOnFailure(execution: TaskExecutionResult, evaluation: Evaluation, previousReflections?: Reflection[]): Promise<Reflection>;
}
```

**反思 Prompt 模板**：

```
你是一个经验丰富的 AI 反思专家。

【任务描述】
{taskDescription}

【执行结果】
{output}

【评估报告】
- 综合得分: {score}
- 通过状态: {passed}
- 详细反馈: {feedback}

【历史反思】
{previousReflections}

请生成结构化反思，包含：
1. 评估结论（成功/失败/部分）
2. 经验教训（3-5 条）
3. 改进建议（具体可执行）
4. 情感基调（积极/中立/消极）

输出 JSON 格式。
```

### 3.3 StrategyAdjuster（策略调整器）

```typescript
export class StrategyAdjuster {
  constructor(options?: AdjusterOptions);
  
  // 根据反思调整策略
  async adjust(reflection: Reflection, currentStrategy: string): Promise<string>;
  
  // 合并历史反思
  mergeReflections(reflections: Reflection[]): Promise<string>;
  
  // 生成新策略 Prompt
  buildStrategyPrompt(reflection: Reflection, currentStrategy: string): string;
}
```

**调整策略**：
- 失败 → 分析根因 → 调整方法论
- 成功 → 总结成功模式 → 复用方法
- 部分成功 → 保留有效步骤 → 替换失败步骤
- 中性 → 微调参数 → 优化细节

### 3.4 ReflectionEngine（主类）

```typescript
export class ReflectionEngine {
  constructor(options?: ReflectionEngineOptions);
  
  // 执行任务并反思迭代
  async executeWithReflection(
    task: string,
    executor: (strategy: string, iteration: number) => Promise<TaskExecutionResult>,
    config?: Partial<IterationConfig>
  ): Promise<ReflexionSession>;
  
  // 仅评估（不迭代）
  async evaluateOnly(result: TaskExecutionResult, criteria?: EvaluationCriteria[]): Promise<Evaluation>;
  
  // 反思历史
  getReflections(filter?: { taskId?: string; type?: ReflectionType }): Reflection[];
  getSession(sessionId: string): ReflexionSession | undefined;
  listSessions(): ReflexionSession[];
  
  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**主循环流程**：

```
1. 初始化 ReflexionSession，策略为 initialStrategy
2. for iteration in 1..maxIterations:
   a. 执行 executor(strategy, iteration) → TaskExecutionResult
   b. Evaluator.evaluate(result) → Evaluation
   c. 检查是否满足 qualityThreshold
      - 是：记录 terminationReason='quality-met'，退出
   d. ReflectionGenerator.generate(...) → Reflection
   e. 检查是否 plateau（连续 N 次无改进）
      - 是：记录 terminationReason='no-improvement'，退出
   f. StrategyAdjuster.adjust(...) → 新策略
   g. iteration++
3. 达到 maxIterations，记录 terminationReason='max-iterations'
4. 返回 ReflexionSession
```

---

## 四、内置评估维度

```typescript
export const DEFAULT_CRITERIA: EvaluationCriteria[] = [
  { name: 'completeness', weight: 0.3, score: 0 },
  { name: 'correctness', weight: 0.4, score: 0 },
  { name: 'clarity', weight: 0.15, score: 0 },
  { name: 'efficiency', weight: 0.15, score: 0 },
];
```

---

## 五、终止条件

| 条件 | 触发场景 |
|------|---------|
| quality-met | score ≥ qualityThreshold |
| max-iterations | 达到 maxIterations |
| no-improvement | 连续 plateauWindow 轮无改进 |
| budget-exhausted | token / 时间 / 成本超限 |
| human-cancel | 用户主动取消 |

---

## 六、性能指标

| 指标 | 目标值 |
|------|--------|
| 单轮反思生成 | < 3s（依赖 LLM） |
| 平均迭代次数 | 2-3 次 |
| 质量提升率 | ≥ 30% |
| 反思历史查询 | < 10ms |

---

## 七、测试覆盖

| 测试维度 | 覆盖项 |
|---------|--------|
| Evaluator | 多维度评估、自定义评估、快速评分 |
| ReflectionGenerator | 成功/失败/部分反思生成 |
| StrategyAdjuster | 策略调整、反思合并 |
| ReflectionEngine | 完整迭代流程、终止条件、持久化 |

**目标测试数**：30+ 单元测试

---

## 八、UI 面板设计

### ReflectionPanel

- **顶部**：任务输入 + 质量阈值/最大迭代配置
- **中部**：迭代进度（每轮一个卡片，显示评估分/反思/新策略）
- **右侧**：评估维度雷达图
- **底部**：反思历史时间线

---

## 九、修改记录

- 2026-07-31 | v1.0.0 | Cycle 38 G38-03 初次创建
