# SPEC: G37-03 AgentLoopEngine (智能体循环引擎)

## 基本信息
- **任务编号**: G37-03
- **任务名称**: AgentLoopEngine - ReAct / Plan-and-Execute 智能体循环引擎
- **优先级**: P0
- **依赖**: G37-01 RAGEngine + G37-02 ToolUseEngine + Cycle 36 LLMProviderAdapter
- **可被依赖**: G37-04 RealLLMProvider 集成
- **周期**: Cycle 37 (2026-07-31)

---

## 一、设计目标

构建一个生产可用的智能体循环引擎，支持：
- ReAct 模式（Reason + Act + Observe 循环）
- Plan-and-Execute 模式（先规划再执行）
- 多步推理状态管理
- 工具选择策略（基于历史 / 基于 RAG 检索）
- 终止条件（最大步数 / 目标达成 / 置信度阈值 / 超时）
- 决策可解释性（Thought / Action / Observation 三元组）
- 人机协作（Human-in-the-Loop）批准点
- 检查点恢复（断点续传）
- 循环追踪与可视化

## 二、核心组件

### 2.1 AgentStep（单步执行）
```typescript
export type AgentStepType = 'thought' | 'action' | 'observation' | 'plan' | 'final';

export interface AgentStep {
  id: string;                    // step_xxx
  index: number;                 // 步序号
  type: AgentStepType;
  content: string;
  
  // 仅 action 类型
  toolCall?: ToolCall;
  toolResult?: ToolCallResult;
  
  // 仅 thought 类型
  reasoning?: string;            // 推理过程
  confidence?: number;           // 0-1
  
  // 元数据
  durationMs: number;
  timestamp: number;
  tokensUsed?: number;
  error?: string;
}
```

### 2.2 AgentPlan（执行计划）
```typescript
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  index: number;
  description: string;
  toolHint?: string;             // 推荐工具
  status: PlanStepStatus;
  result?: string;               // 执行结果摘要
  dependsOn?: string[];          // 依赖的前置步骤 ID
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface AgentPlan {
  id: string;
  goal: string;                  // 目标描述
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'aborted';
}
```

### 2.3 AgentState（运行时状态）
```typescript
export type AgentStatus = 'idle' | 'planning' | 'thinking' | 'acting' | 'observing' | 'waiting_approval' | 'completed' | 'failed' | 'aborted' | 'timeout';

export interface AgentState {
  agentId: string;
  goal: string;                  // 用户目标
  mode: 'react' | 'plan-execute';
  status: AgentStatus;
  currentStep: number;           // 当前步序号
  maxSteps: number;              // 最大步数
  history: AgentStep[];          // 历史步骤
  
  // 上下文
  context: AgentContext;
  plan?: AgentPlan;              // 仅 plan-execute 模式
  
  // 性能指标
  startedAt: number;
  completedAt?: number;
  totalTokens: number;
  totalCost: number;
  
  // 终止信息
  terminationReason?: 'goal_achieved' | 'max_steps' | 'timeout' | 'error' | 'user_aborted' | 'low_confidence';
}

export interface AgentContext {
  // LLM 消息历史
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string }>;
  
  // 工具执行历史
  toolCalls: ToolCallResult[];
  
  // 检索结果
  retrievedDocs?: RetrievalResult[];
  
  // 工作记忆
  scratchpad: Record<string, unknown>;
}
```

### 2.4 ReActStrategy（ReAct 策略）
```typescript
export interface ReActStrategy {
  // 推理提示词模板
  readonly thoughtTemplate: string;
  readonly actionTemplate: string;
  
  // 是否生成 Thought
  generateThought(state: AgentState, llm: LLMProvider): Promise<string>;
  
  // 选择 Action
  selectAction(state: AgentState, availableTools: ToolDefinition[], llm: LLMProvider): Promise<{ toolCall: ToolCall; reasoning: string }>;
  
  // 评估是否达成目标
  evaluateGoal(state: AgentState, llm: LLMProvider): Promise<{ achieved: boolean; confidence: number; finalAnswer?: string }>;
}

export class DefaultReActStrategy implements ReActStrategy {
  // 标准 ReAct 提示词：
  // Thought: 你需要分析当前状态，决定下一步行动
  // Action: 选择合适的工具，传入参数
  // Observation: 工具执行结果
  // ... (循环) ...
  // Final Answer: 基于所有 Observation 给出最终答案
}
```

### 2.5 PlanExecuteStrategy（规划执行策略）
```typescript
export interface PlanExecuteStrategy {
  // 生成计划
  generatePlan(goal: string, availableTools: ToolDefinition[], llm: LLMProvider, rag?: RAGEngine): Promise<AgentPlan>;
  
  // 执行下一步
  executeNextStep(state: AgentState, llm: LLMProvider, toolEngine: ToolUseEngine, rag?: RAGEngine): Promise<AgentStep>;
  
  // 重新规划（步骤失败时）
  replan(state: AgentState, failedStep: PlanStep, llm: LLMProvider, toolEngine: ToolUseEngine): Promise<AgentPlan>;
}

export class DefaultPlanExecuteStrategy implements PlanExecuteStrategy {
  // 1. 调用 LLM 生成结构化计划（JSON）
  // 2. 用户审核（可选）
  // 3. 逐步执行计划
  // 4. 失败时重试 / 重规划
}
```

### 2.6 TerminationPolicy（终止策略）
```typescript
export interface TerminationPolicy {
  maxSteps: number;              // 默认 10
  maxDurationMs: number;         // 默认 120000
  minConfidence: number;         // 默认 0.7
  goalAchievedThreshold: number; // 默认 0.85
  stuckThreshold: number;        // 默认 3 (连续重复动作)
  customCheck?: (state: AgentState) => boolean;
}

export class DefaultTerminationPolicy implements TerminationPolicy {
  evaluate(state: AgentState): { shouldTerminate: boolean; reason?: string };
}
```

### 2.7 HumanApproval（人机协作）
```typescript
export interface ApprovalRequest {
  id: string;
  agentId: string;
  step: AgentStep;
  message: string;               // 审批理由
  options: Array<{ id: string; label: string; description?: string }>;
  timeoutMs?: number;
  defaultAction?: string;        // 超时默认操作
}

export interface ApprovalResponse {
  requestId: string;
  action: string;                // option id
  userComment?: string;
  timestamp: number;
}

export class HumanApprovalHandler {
  request(request: ApprovalRequest): Promise<ApprovalResponse>;
  // 触发条件: 危险工具 / 用户配置 / 每 N 步
}
```

### 2.8 Checkpoint（检查点）
```typescript
export interface AgentCheckpoint {
  agentId: string;
  state: AgentState;
  createdAt: number;
  // 压缩 / 加密（可选）
}

export class CheckpointManager {
  save(state: AgentState): Promise<string>;   // 返回 checkpointId
  load(checkpointId: string): Promise<AgentState | null>;
  list(agentId?: string): AgentCheckpoint[];
  delete(checkpointId: string): Promise<boolean>;
}
```

## 三、AgentLoopEngine 主类

```typescript
export interface AgentLoopEngineOptions {
  llmProvider: LLMProvider;
  toolEngine: ToolUseEngine;
  ragEngine?: RAGEngine;         // 可选，提供上下文检索
  reactStrategy?: ReActStrategy;
  planStrategy?: PlanExecuteStrategy;
  terminationPolicy?: TerminationPolicy;
  approvalHandler?: HumanApprovalHandler;
  checkpointManager?: CheckpointManager;
  
  // 回调
  onStep?: (step: AgentStep, state: AgentState) => void;
  onPlan?: (plan: AgentPlan, state: AgentState) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onStateChange?: (state: AgentState) => void;
  onComplete?: (state: AgentState) => void;
  onError?: (error: Error, state: AgentState) => void;
}

export class AgentLoopEngine {
  // 任务执行
  runReact(goal: string, options?: RunOptions): Promise<AgentState>;
  runPlanExecute(goal: string, options?: RunOptions): Promise<AgentState>;
  
  // 中断
  pause(agentId: string): boolean;
  resume(agentId: string): Promise<AgentState>;
  abort(agentId: string, reason?: string): boolean;
  
  // 状态查询
  getState(agentId: string): AgentState | undefined;
  listActive(): AgentState[];
  getHistory(agentId: string): AgentStep[];
  
  // 检查点
  saveCheckpoint(agentId: string): Promise<string>;
  restoreCheckpoint(checkpointId: string): Promise<AgentState>;
  
  // 审批响应
  respondToApproval(requestId: string, response: ApprovalResponse): boolean;
  
  // 统计
  getStats(): EngineStats;
}

export interface RunOptions {
  initialMessages?: Array<{ role: 'user' | 'system'; content: string }>;
  context?: Record<string, unknown>;
  useRAG?: boolean;              // 默认 false
  ragTopK?: number;              // 默认 3
  requirePlanApproval?: boolean; // 默认 true
  autoCheckpoint?: boolean;      // 默认 true (每 5 步)
}

export interface EngineStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  avgSteps: number;
  avgTokens: number;
  byMode: {
    react: ModeStats;
    'plan-execute': ModeStats;
  };
}
```

## 四、配置化

```typescript
export const DEFAULT_AGENT_CONFIG: AgentLoopEngineOptions = {
  terminationPolicy: {
    maxSteps: 10,
    maxDurationMs: 120000,
    minConfidence: 0.7,
    goalAchievedThreshold: 0.85,
    stuckThreshold: 3,
  },
  // 默认使用 Mock LLM
};

export function createAgentLoopEngine(options: AgentLoopEngineOptions): AgentLoopEngine {
  return new AgentLoopEngine({ ...DEFAULT_AGENT_CONFIG, ...options });
}
```

## 五、提示词模板

### 5.1 ReAct Prompt
```
你是一个智能体，需要通过工具调用来完成用户的目标。

可用工具:
{tools}

历史步骤:
{history}

当前目标: {goal}

请按以下格式输出（严格遵循）:
Thought: <你的推理过程，分析当前进度，决定下一步>
Action: <工具名>(<JSON 参数>)
Observation: <系统将填充工具执行结果>

当目标达成时，输出:
Final Answer: <最终答案>
```

### 5.2 Plan-Execute Prompt
```
你是一个规划智能体。请为以下目标制定详细的执行计划。

目标: {goal}

可用工具:
{tools}

请输出 JSON 格式的计划:
{
  "steps": [
    { "description": "...", "toolHint": "..." },
    { "description": "...", "toolHint": "..." }
  ]
}
```

## 六、测试覆盖

| 模块 | 测试数 | 重点 |
|------|--------|------|
| AgentStep / Plan | 6 | 数据结构 |
| ReActStrategy | 14 | 推理 / 动作选择 / 目标评估 |
| PlanExecuteStrategy | 10 | 计划生成 / 重新规划 |
| TerminationPolicy | 8 | 步数 / 超时 / 置信度 / 停滞 |
| HumanApproval | 6 | 请求 / 响应 / 超时 |
| CheckpointManager | 6 | 保存 / 加载 / 列表 |
| AgentLoopEngine | 22 | ReAct / Plan-Execute / 暂停恢复 / 异常 |
| 集成测试 | 8 | RAG + Tool + Agent 联合 |
| **合计** | **80** | - |

## 七、关键算法

### 7.1 ReAct 循环
```typescript
async function runReactLoop(goal: string, options: RunOptions): Promise<AgentState> {
  const state = createInitialState(goal, 'react');
  
  while (!shouldTerminate(state)) {
    // 1. Thought: 推理下一步
    const thought = await reactStrategy.generateThought(state, llm);
    const step: AgentStep = { type: 'thought', content: thought };
    state.history.push(step);
    
    // 2. Action: 选择工具
    const { toolCall, reasoning } = await reactStrategy.selectAction(
      state, toolEngine.listTools(), llm
    );
    
    // 3. 审批检查
    const tool = toolEngine.getTool(toolCall.name);
    if (tool?.permission === 'dangerous' && approvalHandler) {
      const approved = await requestApproval(state, step, toolCall);
      if (!approved) {
        state.terminationReason = 'user_aborted';
        break;
      }
    }
    
    // 4. 执行
    const result = await toolEngine.executeCall(toolCall);
    state.history.push({ type: 'action', toolCall, toolResult: result });
    state.history.push({ type: 'observation', content: formatResult(result) });
    
    // 5. 检查点
    if (state.currentStep % 5 === 0 && options.autoCheckpoint) {
      await checkpointManager.save(state);
    }
  }
  
  return state;
}
```

### 7.2 目标达成检测
```typescript
function evaluateGoal(state: AgentState): { achieved: boolean; confidence: number } {
  // 1. LLM 自评: 让 LLM 判断是否达成目标
  // 2. 历史分析: 检查是否连续多步 Observation 重复
  // 3. 置信度: 累加每步的 confidence，取平均
  // 4. 关键词匹配: 检测 Final Answer 出现
  
  if (state.history.some(s => s.type === 'final')) {
    return { achieved: true, confidence: 1.0 };
  }
  
  // 重复检测
  const lastN = state.history.slice(-3).filter(s => s.type === 'action');
  if (lastN.length === 3 && lastN.every(s => 
    s.toolCall?.name === lastN[0].toolCall?.name
  )) {
    return { achieved: false, confidence: 0.3 }; // 停滞
  }
  
  return { achieved: false, confidence: 0.7 };
}
```

### 7.3 计划生成
```typescript
async function generatePlan(goal: string): Promise<AgentPlan> {
  const prompt = `为以下目标制定计划:\n${goal}\n\n工具:\n${formatTools()}`;
  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
    responseFormat: { type: 'json' },
  });
  
  const plan = JSON.parse(response.content);
  return {
    id: generatePlanId(),
    goal,
    steps: plan.steps.map((s, i) => ({
      id: `step_${i}`,
      index: i,
      description: s.description,
      toolHint: s.toolHint,
      status: 'pending',
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'draft',
  };
}
```

## 八、安全与限制

- **最大步数**: 默认 10，最大 50
- **超时**: 默认 120s，最大 600s
- **Token 限制**: 单次 run 上限 100K
- **危险工具**: 必须人工审批
- **检查点**: 默认每 5 步自动保存
- **失败重试**: 单步失败重试 2 次
- **循环检测**: 检测重复动作，超过 3 次强制终止
- **审计**: 完整记录所有 step 到 history

## 九、性能目标

- 单步执行: < 5s（含 LLM）
- ReAct 循环 (5 步): < 30s
- Plan-Execute 循环 (10 步): < 60s
- 检查点保存: < 100ms
- 状态恢复: < 200ms
- 并发 run: 最多 5 个

## 十、API 示例

```typescript
import { createAgentLoopEngine, getDefaultLLMProviderRegistry } from './agentLoopEngine';
import { createToolUseEngine, BUILTIN_TOOLS, FunctionExecutor } from './toolUseEngine';
import { createRAGEngine } from './ragEngine';

// 1. 创建依赖
const llmRegistry = getDefaultLLMProviderRegistry();
const llm = llmRegistry.get('mock');

const toolEngine = createToolUseEngine();
BUILTIN_TOOLS.forEach(({ definition, handler }) => {
  toolEngine.registerTool(definition, new FunctionExecutor(handler));
});

const ragEngine = createRAGEngine();
await ragEngine.addDocument('北京今天的天气是晴，气温 25 度。', 'weather.md');

// 2. 创建智能体
const agent = createAgentLoopEngine({
  llmProvider: llm,
  toolEngine,
  ragEngine,
});

// 3. 运行 ReAct
const state = await agent.runReact('查询北京天气并计算穿衣指数', {
  useRAG: true,
  ragTopK: 3,
});

console.log('最终答案:', getFinalAnswer(state));
console.log('步数:', state.history.length);
console.log('Token:', state.totalTokens);

// 4. 运行 Plan-Execute
const state2 = await agent.runPlanExecute('分析最近一周的销售数据并生成报告', {
  requirePlanApproval: true, // 用户审核计划
});

// 5. 暂停 / 恢复
agent.pause(state.agentId);
setTimeout(() => agent.resume(state.agentId), 5000);
```

## 十一、未来扩展

- P1: 多智能体协作（Multi-Agent）
- P1: 长期记忆（Long-term Memory）
- P1: 反思机制（Reflection / Self-Critique）
- P2: 树搜索（Tree-of-Thoughts）
- P2: 元认知（Meta-Reasoning）
- P2: 强化学习微调
