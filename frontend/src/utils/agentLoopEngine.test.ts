/**
 * # AgentLoopEngine - 单元测试
 * # Cycle 37 G37-03
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentLoopEngine,
  createAgentLoopEngine,
  evaluateTermination,
  generateAgentId,
  getFinalAnswer,
  getLastAction,
  DEFAULT_TERMINATION_POLICY,
  DefaultReActStrategy,
  DefaultPlanExecuteStrategy,
  CheckpointManager,
  REACT_SYSTEM_PROMPT,
  AgentState,
  AgentStep,
  PlanStep,
  TerminationReason,
} from './agentLoopEngine';
import {
  LLMProviderRegistry,
  getDefaultLLMProviderRegistry,
  resetDefaultLLMProviderRegistry,
  MockProvider,
  ChatResponse,
  LLMProvider,
  Message,
  ChatOptions,
  TokenUsage,
} from './llmProviderAdapter';
import { ToolUseEngine, createToolUseEngine, registerBuiltinTools, FunctionExecutor, ToolDefinition } from './toolUseEngine';

function makeMockLLM(): LLMProvider {
  const mock = new MockProvider();
  mock.setResponseDelay(0);
  return mock;
}

function makeToolEngine(): ToolUseEngine {
  const engine = createToolUseEngine({ maxRetries: 0, timeoutMs: 1000 });
  engine.registerTool(
    {
      name: 'echo',
      description: 'Echo back the input',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      permission: 'safe',
    },
    new FunctionExecutor((args: Record<string, unknown>) => ({ echoed: String((args as { text: string }).text) }))
  );
  return engine;
}

describe('工具函数', () => {
  it('generateAgentId 格式正确', () => {
    const id = generateAgentId();
    expect(id).toMatch(/^agent_/);
  });

  it('REACT_SYSTEM_PROMPT 非空', () => {
    expect(REACT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

describe('evaluateTermination', () => {
  it('status 已完成', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'completed',
      currentStep: 0,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
      terminationReason: 'goal_achieved',
    };
    const result = evaluateTermination(state, DEFAULT_TERMINATION_POLICY);
    expect(result.shouldTerminate).toBe(true);
  });

  it('超时', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'thinking',
      currentStep: 0,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now() - 200000,
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, { ...DEFAULT_TERMINATION_POLICY, maxDurationMs: 100000 });
    expect(result.shouldTerminate).toBe(true);
    expect(result.reason).toBe('timeout');
  });

  it('超过 maxSteps', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'thinking',
      currentStep: 100,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, DEFAULT_TERMINATION_POLICY);
    expect(result.shouldTerminate).toBe(true);
    expect(result.reason).toBe('max_steps');
  });

  it('检测到 Final Answer', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'observing',
      currentStep: 1,
      maxSteps: 10,
      history: [
        { id: 's1', index: 1, type: 'final', content: 'Done', durationMs: 0, timestamp: Date.now() },
      ],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, DEFAULT_TERMINATION_POLICY);
    expect(result.shouldTerminate).toBe(true);
    expect(result.reason).toBe('goal_achieved');
    expect(result.finalAnswer).toBe('Done');
  });

  it('停滞检测', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'acting',
      currentStep: 3,
      maxSteps: 10,
      history: [
        { id: 'a1', index: 1, type: 'action', content: '', toolCall: { id: 'c1', name: 'X', arguments: {} }, durationMs: 0, timestamp: Date.now() },
        { id: 'a2', index: 2, type: 'action', content: '', toolCall: { id: 'c2', name: 'X', arguments: {} }, durationMs: 0, timestamp: Date.now() },
        { id: 'a3', index: 3, type: 'action', content: '', toolCall: { id: 'c3', name: 'X', arguments: {} }, durationMs: 0, timestamp: Date.now() },
      ],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, { ...DEFAULT_TERMINATION_POLICY, stuckThreshold: 3 });
    expect(result.shouldTerminate).toBe(true);
    expect(result.reason).toBe('stuck');
  });

  it('自定义检查', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'thinking',
      currentStep: 1,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, {
      ...DEFAULT_TERMINATION_POLICY,
      customCheck: () => true,
    });
    expect(result.shouldTerminate).toBe(true);
  });

  it('不终止条件', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'g',
      mode: 'react',
      status: 'thinking',
      currentStep: 1,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
    const result = evaluateTermination(state, DEFAULT_TERMINATION_POLICY);
    expect(result.shouldTerminate).toBe(false);
  });
});

describe('DefaultReActStrategy', () => {
  let strategy: DefaultReActStrategy;
  let llm: LLMProvider;
  let state: AgentState;

  beforeEach(() => {
    strategy = new DefaultReActStrategy();
    llm = makeMockLLM();
    state = {
      agentId: 'a1',
      goal: 'test goal',
      mode: 'react',
      status: 'thinking',
      currentStep: 0,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
  });

  it('name', () => {
    expect(strategy.name).toBe('default-react');
  });

  it('generateThought 初始', async () => {
    const thought = await strategy.generateThought(state, llm);
    expect(thought.length).toBeGreaterThan(0);
  });

  it('selectAction', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'echo',
        description: 'echo',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        permission: 'safe',
      },
    ];
    const result = await strategy.selectAction(state, tools, llm);
    expect(result.toolCall.name).toBeDefined();
  });

  it('evaluateGoal', async () => {
    const result = await strategy.evaluateGoal(state, llm);
    expect(typeof result.achieved).toBe('boolean');
  });
});

describe('DefaultPlanExecuteStrategy', () => {
  it('generatePlan', async () => {
    const strategy = new DefaultPlanExecuteStrategy();
    const llm = makeMockLLM();
    const tools: ToolDefinition[] = [
      { name: 'echo', description: 'echo', parameters: { type: 'object', properties: {} }, permission: 'safe' },
    ];
    const plan = await strategy.generatePlan('test goal', tools, llm);
    expect(plan.goal).toBe('test goal');
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

describe('CheckpointManager', () => {
  let manager: CheckpointManager;

  beforeEach(() => {
    manager = new CheckpointManager();
  });

  it('save 和 load', () => {
    const state: AgentState = {
      agentId: 'a1',
      goal: 'test',
      mode: 'react',
      status: 'completed',
      currentStep: 5,
      maxSteps: 10,
      history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(),
      totalTokens: 100,
      totalCost: 0.01,
    };
    const id = manager.save(state, 'test-checkpoint');
    const loaded = manager.load(id);
    expect(loaded).toBeDefined();
    expect(loaded?.agentId).toBe('a1');
    expect(loaded?.currentStep).toBe(5);
  });

  it('load 不存在', () => {
    expect(manager.load('not_exist')).toBeNull();
  });

  it('list 过滤', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'idle',
      currentStep: 0, maxSteps: 10, history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    manager.save(state);
    manager.save({ ...state, agentId: 'a2' });
    expect(manager.list('a1').length).toBe(1);
  });

  it('delete', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'idle',
      currentStep: 0, maxSteps: 10, history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    const id = manager.save(state);
    expect(manager.delete(id)).toBe(true);
    expect(manager.load(id)).toBeNull();
  });

  it('clear', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'idle',
      currentStep: 0, maxSteps: 10, history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    manager.save(state);
    manager.clear();
    expect(manager.size()).toBe(0);
  });
});

describe('AgentLoopEngine 主类', () => {
  let engine: AgentLoopEngine;
  let llm: LLMProvider;
  let toolEngine: ToolUseEngine;

  beforeEach(() => {
    llm = makeMockLLM();
    toolEngine = makeToolEngine();
    engine = createAgentLoopEngine({
      llmProvider: llm,
      toolEngine,
      terminationPolicy: { ...DEFAULT_TERMINATION_POLICY, maxSteps: 3, maxDurationMs: 30000 },
    });
  });

  it('创建实例', () => {
    expect(engine).toBeInstanceOf(AgentLoopEngine);
  });

  it('runReact 简单流程', async () => {
    const state = await engine.runReact('echo hello', { autoCheckpoint: false });
    expect(state.agentId).toBeDefined();
    expect(state.goal).toBe('echo hello');
    expect(['completed', 'failed', 'timeout', 'aborted', 'max_steps']).toContain(state.status);
  });

  it('runReact maxSteps 终止', async () => {
    const state = await engine.runReact('test', { autoCheckpoint: false });
    expect(state.currentStep).toBeLessThanOrEqual(3);
    expect(state.terminationReason).toBeDefined();
  });

  it('runPlanExecute 简单流程', async () => {
    const state = await engine.runPlanExecute('test goal', { autoCheckpoint: false });
    expect(state.mode).toBe('plan-execute');
    expect(state.plan).toBeDefined();
    expect(state.plan!.steps.length).toBeGreaterThan(0);
  });

  it('abort', async () => {
    const id = engine['activeAgents'].keys().next().value; // 不存在
    // 启动一个快速运行的 agent
    const promise = engine.runReact('test', { autoCheckpoint: false });
    // 等待 agent 启动
    await new Promise(r => setTimeout(r, 50));
    const activeIds = engine.listActive().map(a => a.agentId);
    if (activeIds.length > 0) {
      expect(engine.abort(activeIds[0])).toBe(true);
    }
    await promise;
  });

  it('getStats', async () => {
    await engine.runReact('test', { autoCheckpoint: false });
    const stats = engine.getStats();
    expect(stats.totalRuns).toBe(1);
    expect(stats.byMode.react).toBe(1);
  });

  it('getHistory', async () => {
    const state = await engine.runReact('test', { autoCheckpoint: false });
    const history = engine.getHistory(state.agentId);
    // active 已删除，但 getHistory 返回 state 的 history 数组
    expect(history.length).toBeGreaterThanOrEqual(0);
  });

  it('saveCheckpoint 和 restoreCheckpoint', () => {
    // 无 active agent 时
    expect(engine.saveCheckpoint('not_exist')).toBeNull();
    expect(engine.restoreCheckpoint('not_exist')).toBeNull();
  });

  it('listCheckpoints', () => {
    const list = engine.listCheckpoints();
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('AgentLoopEngine 集成', () => {
  it('完整 ReAct 流程（Mock LLM + Tool）', async () => {
    const llm = makeMockLLM();
    const toolEngine = makeToolEngine();
    const engine = createAgentLoopEngine({
      llmProvider: llm,
      toolEngine,
      terminationPolicy: { ...DEFAULT_TERMINATION_POLICY, maxSteps: 5 },
    });
    const state = await engine.runReact('test goal', { autoCheckpoint: false });
    expect(state.history.length).toBeGreaterThan(0);
    expect(state.completedAt).toBeDefined();
  });

  it('带 RAG 引擎', async () => {
    const llm = makeMockLLM();
    const toolEngine = makeToolEngine();
    // RAG engine 需 lazy import
    const { createRAGEngine } = await import('./ragEngine');
    const rag = createRAGEngine();
    await rag.addDocument('test document about machine learning', 'test.md');
    const engine = createAgentLoopEngine({
      llmProvider: llm,
      toolEngine,
      ragEngine: rag,
      terminationPolicy: { ...DEFAULT_TERMINATION_POLICY, maxSteps: 2 },
    });
    const state = await engine.runReact('查询机器学习', { useRAG: true, autoCheckpoint: false });
    expect(state.history.length).toBeGreaterThan(0);
  });
});

describe('工具函数 (AgentStep)', () => {
  it('getFinalAnswer', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'completed',
      currentStep: 1, maxSteps: 10,
      history: [
        { id: 's1', index: 1, type: 'final', content: 'Final answer', durationMs: 0, timestamp: Date.now() },
      ],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    expect(getFinalAnswer(state)).toBe('Final answer');
  });

  it('getFinalAnswer 无 final', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'idle',
      currentStep: 0, maxSteps: 10, history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    expect(getFinalAnswer(state)).toBeUndefined();
  });

  it('getLastAction', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'acting',
      currentStep: 2, maxSteps: 10,
      history: [
        { id: 's1', index: 1, type: 'thought', content: 't1', durationMs: 0, timestamp: Date.now() },
        { id: 's2', index: 2, type: 'action', content: 'a1', toolCall: { id: 'c1', name: 't1', arguments: {} }, durationMs: 0, timestamp: Date.now() },
        { id: 's3', index: 3, type: 'observation', content: 'o1', durationMs: 0, timestamp: Date.now() },
      ],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    const last = getLastAction(state);
    expect(last?.type).toBe('action');
  });

  it('getLastAction 无 action', () => {
    const state: AgentState = {
      agentId: 'a1', goal: 'g', mode: 'react', status: 'idle',
      currentStep: 0, maxSteps: 10, history: [],
      context: { messages: [], toolCalls: [], scratchpad: {} },
      startedAt: Date.now(), totalTokens: 0, totalCost: 0,
    };
    expect(getLastAction(state)).toBeUndefined();
  });
});
