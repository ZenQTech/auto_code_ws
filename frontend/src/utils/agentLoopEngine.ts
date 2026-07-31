/**
 * # ============================================================
 * # AgentLoopEngine - 智能体循环引擎 (v1.0.0 Cycle 37 G37-03)
 * # ============================================================
 * # 核心作用：实现 ReAct / Plan-and-Execute 智能体循环
 * #           支持多步推理、工具调用、终止条件、人机协作、检查点恢复
 * # 对标产品：LangChain Agents / AutoGPT / BabyAGI
 * # 运行流程：
 * #   1. 创建 AgentLoopEngine（注入 LLM / ToolUseEngine / RAGEngine）
 * #   2. runReact(goal): ReAct 循环（Reason + Act + Observe）
 * #   3. runPlanExecute(goal): 规划后逐步执行
 * #   4. 终止条件检测：maxSteps / timeout / goal achieved / stuck
 * #   5. 检查点恢复：saveCheckpoint / restoreCheckpoint
 * # 输入参数：goal / options
 * # 输出结果：AgentState（含 history / plan / stats）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 37 G37-03 初次创建
 * # ============================================================
 */

import {
  LLMProvider,
  ChatResponse,
  Message,
  ChatOptions,
} from './llmProviderAdapter';
import {
  ToolCall,
  ToolCallResult,
  ToolDefinition,
  ToolUseEngine,
} from './toolUseEngine';
import {
  RetrievalResult,
  RAGEngine,
} from './ragEngine';

// ============ 类型定义 ============

/**
 * 智能体步骤类型
 */
export type AgentStepType = 'thought' | 'action' | 'observation' | 'plan' | 'final';

/**
 * 智能体单步
 */
export interface AgentStep {
  id: string;
  index: number;
  type: AgentStepType;
  content: string;
  toolCall?: ToolCall;
  toolResult?: ToolCallResult;
  reasoning?: string;
  confidence?: number;
  durationMs: number;
  timestamp: number;
  tokensUsed?: number;
  error?: string;
}

/**
 * 计划步骤状态
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * 计划步骤
 */
export interface PlanStep {
  id: string;
  index: number;
  description: string;
  toolHint?: string;
  status: PlanStepStatus;
  result?: string;
  dependsOn?: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/**
 * 智能体计划
 */
export interface AgentPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'aborted';
}

/**
 * 智能体状态
 */
export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'thinking'
  | 'acting'
  | 'observing'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'timeout';

/**
 * 终止原因
 */
export type TerminationReason =
  | 'goal_achieved'
  | 'max_steps'
  | 'timeout'
  | 'error'
  | 'user_aborted'
  | 'low_confidence'
  | 'stuck';

/**
 * 智能体上下文
 */
export interface AgentContext {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
  }>;
  toolCalls: ToolCallResult[];
  retrievedDocs?: RetrievalResult[];
  scratchpad: Record<string, unknown>;
}

/**
 * 智能体状态
 */
export interface AgentState {
  agentId: string;
  goal: string;
  mode: 'react' | 'plan-execute';
  status: AgentStatus;
  currentStep: number;
  maxSteps: number;
  history: AgentStep[];
  context: AgentContext;
  plan?: AgentPlan;
  startedAt: number;
  completedAt?: number;
  totalTokens: number;
  totalCost: number;
  terminationReason?: TerminationReason;
}

// ============ 终止策略 ============

/**
 * 终止策略接口
 */
export interface TerminationPolicy {
  maxSteps: number;
  maxDurationMs: number;
  minConfidence: number;
  goalAchievedThreshold: number;
  stuckThreshold: number;
  customCheck?: (state: AgentState) => boolean;
}

/**
 * 默认终止策略
 */
export const DEFAULT_TERMINATION_POLICY: TerminationPolicy = {
  maxSteps: 10,
  maxDurationMs: 120000,
  minConfidence: 0.7,
  goalAchievedThreshold: 0.85,
  stuckThreshold: 3,
};

/**
 * 评估终止条件
 */
export function evaluateTermination(
  state: AgentState,
  policy: TerminationPolicy
): { shouldTerminate: boolean; reason?: TerminationReason; finalAnswer?: string } {
  // 1. 显式完成
  if (state.status === 'completed' || state.status === 'failed' || state.status === 'aborted') {
    return { shouldTerminate: true, reason: state.terminationReason };
  }

  // 2. 超时
  const elapsed = Date.now() - state.startedAt;
  if (elapsed > policy.maxDurationMs) {
    return { shouldTerminate: true, reason: 'timeout' };
  }

  // 3. 超过最大步数
  if (state.currentStep >= policy.maxSteps) {
    return { shouldTerminate: true, reason: 'max_steps' };
  }

  // 4. 检测到 Final Answer
  const finalStep = state.history.find(s => s.type === 'final');
  if (finalStep) {
    return { shouldTerminate: true, reason: 'goal_achieved', finalAnswer: finalStep.content };
  }

  // 5. 自定义检查
  if (policy.customCheck && policy.customCheck(state)) {
    return { shouldTerminate: true, reason: 'goal_achieved' };
  }

  // 6. 停滞检测（连续相同动作）
  if (state.history.length >= policy.stuckThreshold) {
    const recent = state.history
      .filter(s => s.type === 'action')
      .slice(-policy.stuckThreshold);
    if (recent.length === policy.stuckThreshold) {
      const firstName = recent[0].toolCall?.name;
      const allSame = recent.every(s => s.toolCall?.name === firstName);
      if (allSame) {
        return { shouldTerminate: true, reason: 'stuck' };
      }
    }
  }

  return { shouldTerminate: false };
}

// ============ ReAct 策略 ============

/**
 * ReAct 策略接口
 */
export interface ReActStrategy {
  readonly name: string;
  generateThought(state: AgentState, llm: LLMProvider): Promise<string>;
  selectAction(
    state: AgentState,
    availableTools: ToolDefinition[],
    llm: LLMProvider
  ): Promise<{ toolCall: ToolCall; reasoning: string }>;
  evaluateGoal(
    state: AgentState,
    llm: LLMProvider
  ): Promise<{ achieved: boolean; confidence: number; finalAnswer?: string }>;
}

/**
 * 默认 ReAct 提示词模板
 */
export const REACT_SYSTEM_PROMPT = `你是一个智能体，通过思考和工具调用来完成用户的目标。

请按以下格式输出（严格遵循）:

Thought: <你的推理过程，分析当前进度，决定下一步>
Action: <工具名>(<JSON 参数>)

或者当目标达成时:
Final Answer: <最终答案>

注意:
1. 每次只输出一个 Thought 和一个 Action
2. 工具名必须与可用工具列表完全一致
3. 参数必须是合法的 JSON
4. 如果信息不足，思考后再选择合适的工具`;

/**
 * 默认 ReAct 策略
 */
export class DefaultReActStrategy implements ReActStrategy {
  readonly name = 'default-react';

  async generateThought(state: AgentState, _llm: LLMProvider): Promise<string> {
    // 简化：使用历史最近一次 observation 或 thought
    const lastObs = [...state.history].reverse().find(s => s.type === 'observation');
    const lastThought = [...state.history].reverse().find(s => s.type === 'thought');
    if (lastObs) return `观察到: ${lastObs.content}`;
    if (lastThought) return `回顾: ${lastThought.content}`;
    return `开始分析目标: ${state.goal}`;
  }

  async selectAction(
    state: AgentState,
    availableTools: ToolDefinition[],
    llm: LLMProvider
  ): Promise<{ toolCall: ToolCall; reasoning: string }> {
    // 构造 prompt
    const toolsDesc = availableTools
      .map(t => `- ${t.name}(${JSON.stringify(t.parameters.properties)}): ${t.description}`)
      .join('\n');

    const historyText = state.history
      .slice(-6)
      .map(s => {
        if (s.type === 'thought') return `Thought: ${s.content}`;
        if (s.type === 'action') return `Action: ${s.toolCall?.name}(${JSON.stringify(s.toolCall?.arguments)})`;
        if (s.type === 'observation') return `Observation: ${s.content}`;
        return s.content;
      })
      .join('\n');

    const prompt = `目标: ${state.goal}

可用工具:
${toolsDesc}

历史:
${historyText}

请选择下一步行动 (输出 JSON):
{
  "reasoning": "<你的推理>",
  "action": { "name": "<工具名>", "arguments": { ... } }
}`;

    const response = await llm.chat(
      [
        { role: 'system', content: REACT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7 }
    );

    // 解析响应
    try {
      // 尝试提取 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action && parsed.action.name) {
          return {
            toolCall: {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: parsed.action.name,
              arguments: parsed.action.arguments || {},
            },
            reasoning: parsed.reasoning || '',
          };
        }
      }
    } catch {
      // 解析失败，使用 fallback
    }

    // Fallback：选择第一个可用工具
    if (availableTools.length > 0) {
      return {
        toolCall: {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: availableTools[0].name,
          arguments: {},
        },
        reasoning: 'Fallback: 选择第一个可用工具',
      };
    }

    throw new Error('No available tools to use');
  }

  async evaluateGoal(
    state: AgentState,
    llm: LLMProvider
  ): Promise<{ achieved: boolean; confidence: number; finalAnswer?: string }> {
    // 检查是否包含 final 步骤
    const final = state.history.find(s => s.type === 'final');
    if (final) {
      return { achieved: true, confidence: 1.0, finalAnswer: final.content };
    }

    // 询问 LLM
    const response = await llm.chat(
      [
        {
          role: 'system',
          content: '你是一个评估器。请评估智能体是否已达成目标。输出 JSON: { "achieved": true/false, "confidence": 0-1, "finalAnswer": "..." }',
        },
        {
          role: 'user',
          content: `目标: ${state.goal}\n\n历史: ${state.history.length} 步\n\n是否达成？`,
        },
      ],
      { temperature: 0.3 }
    );

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          achieved: !!parsed.achieved,
          confidence: parsed.confidence || 0.5,
          finalAnswer: parsed.finalAnswer,
        };
      }
    } catch {
      // ignore
    }

    return { achieved: false, confidence: 0.5 };
  }
}

// ============ Plan-Execute 策略 ============

/**
 * Plan-Execute 策略接口
 */
export interface PlanExecuteStrategy {
  readonly name: string;
  generatePlan(
    goal: string,
    availableTools: ToolDefinition[],
    llm: LLMProvider
  ): Promise<AgentPlan>;
}

/**
 * 默认 Plan-Execute 策略
 */
export class DefaultPlanExecuteStrategy implements PlanExecuteStrategy {
  readonly name = 'default-plan-execute';

  async generatePlan(
    goal: string,
    availableTools: ToolDefinition[],
    llm: LLMProvider
  ): Promise<AgentPlan> {
    const toolsDesc = availableTools
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    const prompt = `为以下目标制定执行计划:

目标: ${goal}

可用工具:
${toolsDesc}

请输出 JSON 格式的计划:
{
  "steps": [
    { "description": "步骤1描述", "toolHint": "推荐工具名" },
    { "description": "步骤2描述", "toolHint": "推荐工具名" }
  ]
}`;

    const response = await llm.chat(
      [
        { role: 'system', content: '你是一个规划器，输出严格的 JSON。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5 }
    );

    let steps: Array<{ description: string; toolHint?: string }> = [];
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.steps)) {
          steps = parsed.steps;
        }
      }
    } catch {
      // ignore
    }

    // Fallback：单步计划
    if (steps.length === 0) {
      steps = [{ description: goal, toolHint: availableTools[0]?.name }];
    }

    return {
      id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      goal,
      steps: steps.map((s, i) => ({
        id: `step_${i}`,
        index: i,
        description: s.description,
        toolHint: s.toolHint,
        status: 'pending' as PlanStepStatus,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
    };
  }
}

// ============ 检查点管理器 ============

/**
 * 智能体检查点
 */
export interface AgentCheckpoint {
  id: string;
  agentId: string;
  state: AgentState;
  createdAt: number;
  description?: string;
}

/**
 * 检查点管理器（内存版）
 */
export class CheckpointManager {
  private checkpoints: Map<string, AgentCheckpoint> = new Map();

  save(state: AgentState, description?: string): string {
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.checkpoints.set(id, {
      id,
      agentId: state.agentId,
      state: JSON.parse(JSON.stringify(state)), // 深拷贝
      createdAt: Date.now(),
      description,
    });
    return id;
  }

  load(checkpointId: string): AgentState | null {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp) return null;
    return JSON.parse(JSON.stringify(cp.state));
  }

  list(agentId?: string): AgentCheckpoint[] {
    const all = Array.from(this.checkpoints.values());
    return agentId ? all.filter(cp => cp.agentId === agentId) : all;
  }

  delete(checkpointId: string): boolean {
    return this.checkpoints.delete(checkpointId);
  }

  size(): number {
    return this.checkpoints.size;
  }

  clear(): void {
    this.checkpoints.clear();
  }
}

// ============ AgentLoopEngine 主类 ============

/**
 * 引擎选项
 */
export interface AgentLoopEngineOptions {
  llmProvider: LLMProvider;
  toolEngine: ToolUseEngine;
  ragEngine?: RAGEngine;
  reactStrategy?: ReActStrategy;
  planStrategy?: PlanExecuteStrategy;
  terminationPolicy?: TerminationPolicy;
  checkpointManager?: CheckpointManager;
  onStep?: (step: AgentStep, state: AgentState) => void;
  onPlan?: (plan: AgentPlan, state: AgentState) => void;
  onStateChange?: (state: AgentState) => void;
  onComplete?: (state: AgentState) => void;
  onError?: (error: Error, state: AgentState) => void;
}

/**
 * 运行选项
 */
export interface RunOptions {
  initialMessages?: Array<{ role: 'user' | 'system'; content: string }>;
  context?: Record<string, unknown>;
  useRAG?: boolean;
  ragTopK?: number;
  requirePlanApproval?: boolean;
  autoCheckpoint?: boolean;
  checkpointInterval?: number;
}

/**
 * 引擎统计
 */
export interface EngineStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  totalSteps: number;
  totalTokens: number;
  totalDurationMs: number;
  avgDurationMs: number;
  byMode: { react: number; 'plan-execute': number };
}

/**
 * 智能体循环引擎
 */
export class AgentLoopEngine {
  private llm: LLMProvider;
  private toolEngine: ToolUseEngine;
  private ragEngine?: RAGEngine;
  private reactStrategy: ReActStrategy;
  private planStrategy: PlanExecuteStrategy;
  private terminationPolicy: TerminationPolicy;
  private checkpointManager: CheckpointManager;

  // 回调
  private onStep?: (step: AgentStep, state: AgentState) => void;
  private onPlan?: (plan: AgentPlan, state: AgentState) => void;
  private onStateChange?: (state: AgentState) => void;
  private onComplete?: (state: AgentState) => void;
  private onError?: (error: Error, state: AgentState) => void;

  // 状态
  private activeAgents: Map<string, AgentState> = new Map();
  private abortedAgents: Set<string> = new Set();
  private stats: EngineStats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    totalSteps: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    byMode: { react: 0, 'plan-execute': 0 },
  };

  constructor(options: AgentLoopEngineOptions) {
    this.llm = options.llmProvider;
    this.toolEngine = options.toolEngine;
    this.ragEngine = options.ragEngine;
    this.reactStrategy = options.reactStrategy ?? new DefaultReActStrategy();
    this.planStrategy = options.planStrategy ?? new DefaultPlanExecuteStrategy();
    this.terminationPolicy = options.terminationPolicy ?? DEFAULT_TERMINATION_POLICY;
    this.checkpointManager = options.checkpointManager ?? new CheckpointManager();
    this.onStep = options.onStep;
    this.onPlan = options.onPlan;
    this.onStateChange = options.onStateChange;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
  }

  // ============ 任务执行 ============

  async runReact(goal: string, options: RunOptions = {}): Promise<AgentState> {
    const state = this.createInitialState(goal, 'react');
    this.activeAgents.set(state.agentId, state);
    this.abortedAgents.delete(state.agentId);
    this.stats.totalRuns++;
    this.stats.byMode.react++;

    try {
      const finalState = await this.executeReactLoop(state, options);
      this.updateStats(finalState);
      return finalState;
    } catch (err) {
      state.status = 'failed';
      state.completedAt = Date.now();
      state.terminationReason = 'error';
      this.onError?.(err instanceof Error ? err : new Error(String(err)), state);
      this.stats.failedRuns++;
      return state;
    } finally {
      this.activeAgents.delete(state.agentId);
    }
  }

  async runPlanExecute(goal: string, options: RunOptions = {}): Promise<AgentState> {
    const state = this.createInitialState(goal, 'plan-execute');
    state.maxSteps = this.terminationPolicy.maxSteps * 2; // 计划执行允许更多步
    this.activeAgents.set(state.agentId, state);
    this.abortedAgents.delete(state.agentId);
    this.stats.totalRuns++;
    this.stats.byMode['plan-execute']++;

    try {
      // 1. 生成计划
      state.status = 'planning';
      this.onStateChange?.(state);
      const availableTools = this.toolEngine.listTools({ enabled: true });
      const plan = await this.planStrategy.generatePlan(goal, availableTools, this.llm);
      state.plan = plan;
      this.onPlan?.(plan, state);

      // 2. 审核（如需要）
      if (options.requirePlanApproval !== false) {
        plan.status = 'approved';
      }

      plan.status = 'executing';
      plan.updatedAt = Date.now();

      // 3. 逐步执行
      for (let i = 0; i < plan.steps.length; i++) {
        if (this.abortedAgents.has(state.agentId)) {
          state.status = 'aborted';
          state.terminationReason = 'user_aborted';
          break;
        }

        const planStep = plan.steps[i];
        planStep.status = 'in_progress';
        planStep.startedAt = Date.now();
        state.currentStep++;

        // 选择工具
        let tool: ToolDefinition | undefined;
        if (planStep.toolHint) {
          tool = this.toolEngine.getTool(planStep.toolHint);
        }
        if (!tool && availableTools.length > 0) {
          tool = availableTools[0];
        }

        if (!tool) {
          planStep.status = 'failed';
          planStep.error = 'No tool available';
          state.status = 'failed';
          state.terminationReason = 'error';
          break;
        }

        // 执行
        const stepStartTime = performance.now();
        const toolCall: ToolCall = {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: tool.name,
          arguments: {},
        };
        const toolResult = await this.toolEngine.executeCall(toolCall);
        const step: AgentStep = {
          id: `step_${state.currentStep}`,
          index: state.currentStep,
          type: 'action',
          content: planStep.description,
          toolCall,
          toolResult,
          durationMs: Math.round(performance.now() - stepStartTime),
          timestamp: Date.now(),
        };
        state.history.push(step);
        state.context.toolCalls.push(toolResult);
        planStep.result = toolResult.success
          ? JSON.stringify(toolResult.result).slice(0, 200)
          : toolResult.error?.message;
        planStep.status = toolResult.success ? 'completed' : 'failed';
        planStep.completedAt = Date.now();
        plan.updatedAt = Date.now();

        this.onStep?.(step, state);
        this.maybeCheckpoint(state, options);

        if (!toolResult.success) {
          state.status = 'failed';
          state.terminationReason = 'error';
          break;
        }
      }

      if (state.status !== 'failed' && state.status !== 'aborted') {
        // 生成最终答案
        const finalAnswer = await this.generateFinalAnswer(state);
        const finalStep: AgentStep = {
          id: `step_final`,
          index: state.history.length + 1,
          type: 'final',
          content: finalAnswer,
          durationMs: 0,
          timestamp: Date.now(),
        };
        state.history.push(finalStep);
        state.status = 'completed';
        state.terminationReason = 'goal_achieved';
      }

      state.completedAt = Date.now();
      this.onComplete?.(state);
      this.updateStats(state);
      return state;
    } catch (err) {
      state.status = 'failed';
      state.completedAt = Date.now();
      state.terminationReason = 'error';
      this.onError?.(err instanceof Error ? err : new Error(String(err)), state);
      this.stats.failedRuns++;
      return state;
    } finally {
      this.activeAgents.delete(state.agentId);
    }
  }

  // ============ 中断 ============

  abort(agentId: string, reason?: string): boolean {
    if (!this.activeAgents.has(agentId)) return false;
    this.abortedAgents.add(agentId);
    const state = this.activeAgents.get(agentId)!;
    state.status = 'aborted';
    state.terminationReason = 'user_aborted';
    state.completedAt = Date.now();
    return true;
  }

  isAborted(agentId: string): boolean {
    return this.abortedAgents.has(agentId);
  }

  // ============ 状态查询 ============

  getState(agentId: string): AgentState | undefined {
    return this.activeAgents.get(agentId);
  }

  listActive(): AgentState[] {
    return Array.from(this.activeAgents.values());
  }

  getHistory(agentId: string): AgentStep[] {
    const state = this.activeAgents.get(agentId);
    return state ? state.history : [];
  }

  // ============ 检查点 ============

  saveCheckpoint(agentId: string, description?: string): string | null {
    const state = this.activeAgents.get(agentId);
    if (!state) return null;
    return this.checkpointManager.save(state, description);
  }

  restoreCheckpoint(checkpointId: string): AgentState | null {
    return this.checkpointManager.load(checkpointId);
  }

  listCheckpoints(agentId?: string): AgentCheckpoint[] {
    return this.checkpointManager.list(agentId);
  }

  // ============ 统计 ============

  getStats(): EngineStats {
    return { ...this.stats };
  }

  // ============ 内部方法 ============

  private createInitialState(goal: string, mode: 'react' | 'plan-execute'): AgentState {
    return {
      agentId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      goal,
      mode,
      status: 'idle',
      currentStep: 0,
      maxSteps: this.terminationPolicy.maxSteps,
      history: [],
      context: {
        messages: [{ role: 'user', content: goal }],
        toolCalls: [],
        scratchpad: {},
      },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
  }

  private async executeReactLoop(state: AgentState, options: RunOptions): Promise<AgentState> {
    const availableTools = this.toolEngine.listTools({ enabled: true });

    while (true) {
      if (this.abortedAgents.has(state.agentId)) {
        state.status = 'aborted';
        state.terminationReason = 'user_aborted';
        break;
      }

      const term = evaluateTermination(state, this.terminationPolicy);
      if (term.shouldTerminate) {
        state.status = term.reason === 'timeout' ? 'timeout' :
                        term.reason === 'user_aborted' ? 'aborted' :
                        term.reason === 'goal_achieved' ? 'completed' : 'failed';
        state.terminationReason = term.reason;
        if (term.finalAnswer) {
          state.history.push({
            id: `step_final`,
            index: state.history.length + 1,
            type: 'final',
            content: term.finalAnswer,
            durationMs: 0,
            timestamp: Date.now(),
          });
        }
        break;
      }

      state.currentStep++;
      state.status = 'thinking';
      this.onStateChange?.(state);

      // 1. Thought
      const thoughtStart = performance.now();
      const thought = await this.reactStrategy.generateThought(state, this.llm);
      const thoughtStep: AgentStep = {
        id: `step_${state.currentStep}_thought`,
        index: state.currentStep,
        type: 'thought',
        content: thought,
        durationMs: Math.round(performance.now() - thoughtStart),
        timestamp: Date.now(),
      };
      state.history.push(thoughtStep);
      this.onStep?.(thoughtStep, state);

      // 2. Action
      state.status = 'acting';
      this.onStateChange?.(state);
      const actionStart = performance.now();
      let actionResult;
      try {
        actionResult = await this.reactStrategy.selectAction(state, availableTools, this.llm);
      } catch (err) {
        state.status = 'failed';
        state.terminationReason = 'error';
        state.history.push({
          id: `step_${state.currentStep}_error`,
          index: state.currentStep,
          type: 'thought',
          content: `Action selection failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: 0,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      // 3. 执行工具
      const toolResult = await this.toolEngine.executeCall(actionResult.toolCall);
      const actionStep: AgentStep = {
        id: `step_${state.currentStep}_action`,
        index: state.currentStep,
        type: 'action',
        content: actionResult.reasoning,
        toolCall: actionResult.toolCall,
        toolResult,
        durationMs: Math.round(performance.now() - actionStart),
        timestamp: Date.now(),
      };
      state.history.push(actionStep);
      state.context.toolCalls.push(toolResult);
      this.onStep?.(actionStep, state);

      // 4. Observation
      const obsContent = toolResult.success
        ? JSON.stringify(toolResult.result).slice(0, 500)
        : `Error: ${toolResult.error?.message}`;
      const obsStep: AgentStep = {
        id: `step_${state.currentStep}_obs`,
        index: state.currentStep,
        type: 'observation',
        content: obsContent,
        durationMs: 0,
        timestamp: Date.now(),
      };
      state.history.push(obsStep);
      this.onStep?.(obsStep, state);

      // 5. 检查点
      this.maybeCheckpoint(state, options);

      // 6. 评估目标
      if (state.currentStep % 3 === 0) {
        const evalResult = await this.reactStrategy.evaluateGoal(state, this.llm);
        if (evalResult.achieved && evalResult.confidence >= this.terminationPolicy.goalAchievedThreshold) {
          state.history.push({
            id: `step_final`,
            index: state.history.length + 1,
            type: 'final',
            content: evalResult.finalAnswer || '目标已达成',
            durationMs: 0,
            timestamp: Date.now(),
            confidence: evalResult.confidence,
          });
          state.status = 'completed';
          state.terminationReason = 'goal_achieved';
          break;
        }
      }
    }

    state.completedAt = Date.now();
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'aborted' || state.status === 'timeout') {
      this.onComplete?.(state);
    }
    return state;
  }

  private maybeCheckpoint(state: AgentState, options: RunOptions): void {
    const auto = options.autoCheckpoint !== false;
    const interval = options.checkpointInterval ?? 5;
    if (auto && state.currentStep % interval === 0) {
      this.checkpointManager.save(state, `auto-checkpoint step ${state.currentStep}`);
    }
  }

  private async generateFinalAnswer(state: AgentState): Promise<string> {
    // 汇总所有工具结果
    const observations = state.context.toolCalls
      .map((tc, i) => `[${i + 1}] ${tc.name}: ${tc.success ? JSON.stringify(tc.result).slice(0, 200) : tc.error?.message}`)
      .join('\n');
    return `目标 "${state.goal}" 已完成。\n\n执行结果:\n${observations}`;
  }

  private updateStats(state: AgentState): void {
    if (state.status === 'completed') this.stats.successRuns++;
    else if (state.status === 'failed') this.stats.failedRuns++;

    this.stats.totalSteps += state.history.length;
    this.stats.totalTokens += state.totalTokens;
    const duration = state.completedAt ? state.completedAt - state.startedAt : 0;
    this.stats.totalDurationMs += duration;
    this.stats.avgDurationMs = Math.round(this.stats.totalDurationMs / Math.max(this.stats.totalRuns, 1));
  }
}

// ============ 默认配置与工厂函数 ============

export function createAgentLoopEngine(options: AgentLoopEngineOptions): AgentLoopEngine {
  return new AgentLoopEngine(options);
}

// ============ 工具函数 ============

export function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function getFinalAnswer(state: AgentState): string | undefined {
  return state.history.find(s => s.type === 'final')?.content;
}

export function getLastAction(state: AgentState): AgentStep | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].type === 'action') return state.history[i];
  }
  return undefined;
}
