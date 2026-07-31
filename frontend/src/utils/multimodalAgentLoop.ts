/**
 * # ============================================================
 * # Multimodal Agent Loop - 多模态智能体循环 (v1.0.0 Cycle 44 G44-04)
 * # ============================================================
 * # 核心作用：端到端多模态 Agent 循环
 * #           - 接收多模态输入（图像/音频/文件/文本）
 * #           - 智能路由到对应的 MCP 多模态工具
 * #           - 多模态上下文压缩（base64 优化）
 * #           - 多模态 LLM 内容转换（text/image_url/audio）
 * #           - 流式多模态响应
 * #           - 5 大场景 E2E 测试支持
 * # 对标产品：LangChain Multimodal / Vercel AI SDK Vision
 * # 协议版本：MCP 2024-11-05
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-04 初次创建
 * # ====================================
 */

import type {
  LLMProvider,
  Message,
  ChatResponse,
  ChatOptions,
  MultimodalContent,
  StreamChunk,
  StreamOptions,
} from './llmProviderAdapter';
import {
  type ToolCall,
  type ToolCallResult,
  ToolUseEngine,
  type ToolDefinition as HermesToolDefinition,
} from './toolUseEngine';
import { McpServerRegistry } from './mcpRegistry';
import { McpToolBridge } from './mcpToolBridge';
import { McpMultimodalToolBridge, type MultimodalToolResult, type MultimodalContentPart } from './mcpMultimodalToolBridge';
import { McpImageProcessor } from './mcpImageProcessor';
import { McpAudioProcessor } from './mcpAudioProcessor';

// ============ 类型定义 ============

/**
 * 多模态输入
 * 支持 image / audio / file / text 四种类型
 */
export interface MultimodalInput {
  /** 输入 ID */
  id: string;
  /** 输入类型 */
  type: 'image' | 'audio' | 'file' | 'text';
  /** 文本内容（text 类型必填） */
  text?: string;
  /** base64 数据（image/audio/file 必填） */
  data?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件名（file 类型可选） */
  filename?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 智能路由策略
 */
export type RoutingStrategy = 'auto' | 'explicit' | 'llm-decide';

/**
 * 智能路由决策
 */
export interface RoutingDecision {
  /** 输入 ID */
  inputId: string;
  /** 选中的工具限定名 */
  toolName: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
  /** 决策原因 */
  reason: string;
  /** 决策耗时 */
  durationMs: number;
  /** 决策来源 */
  source: 'rule' | 'llm' | 'explicit';
}

/**
 * 多模态工具调用详情
 */
export interface MultimodalToolExecution {
  callId: string;
  toolName: string;
  inputId: string;
  result: MultimodalToolResult;
  llmContent: Array<{
    type: 'text' | 'image_url' | 'audio';
    text?: string;
    image_url?: { url: string };
    input_audio?: { data: string; format: string };
  }>;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

/**
 * 多模态 Agent 运行选项
 */
export interface MultimodalAgentOptions {
  /** 路由策略 */
  routingStrategy?: RoutingStrategy;
  /** 最大步数 */
  maxSteps?: number;
  /** 温度 */
  temperature?: number;
  /** 模型覆盖 */
  model?: string;
  /** 是否启用流式响应 */
  stream?: boolean;
  /** 显式工具映射（覆盖自动路由） */
  explicitToolMap?: Record<string, string>;
  /** 压缩阈值（字节） */
  compressionThreshold?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 多模态 Agent 运行结果
 */
export interface MultimodalAgentResult {
  /** 响应文本 */
  content: string;
  /** 多模态内容（LLM 格式） */
  multimodalContent: MultimodalContent[];
  /** 工具执行详情 */
  toolExecutions: MultimodalToolExecution[];
  /** 路由决策 */
  routingDecisions: RoutingDecision[];
  /** 输入摘要 */
  inputSummary: {
    total: number;
    images: number;
    audios: number;
    files: number;
    texts: number;
  };
  /** 总 token 数 */
  totalTokens: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 步骤数 */
  steps: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 结束原因 */
  terminationReason?: 'completed' | 'max_steps' | 'error' | 'no_tool' | 'aborted';
  /** 时间戳 */
  timestamp: number;
}

/**
 * 流式事件
 */
export type MultimodalStreamEvent =
  | { type: 'input-processed'; input: MultimodalInput; at: number }
  | { type: 'routing-decision'; decision: RoutingDecision; at: number }
  | { type: 'tool-execution-start'; toolName: string; inputId: string; at: number }
  | { type: 'tool-execution-complete'; execution: MultimodalToolExecution; at: number }
  | { type: 'text-delta'; text: string; at: number }
  | { type: 'multimodal-delta'; part: MultimodalContentPart; at: number }
  | { type: 'final'; result: MultimodalAgentResult; at: number }
  | { type: 'error'; error: Error; at: number };

export type MultimodalStreamListener = (event: MultimodalStreamEvent) => void;

/**
 * 智能体选项
 */
export interface MultimodalAgentLoopOptions {
  /** LLM Provider */
  llmProvider: LLMProvider;
  /** MCP 服务器注册表 */
  mcpRegistry: McpServerRegistry;
  /** MCP 工具桥接 */
  toolBridge: McpToolBridge;
  /** 多模态工具桥接（可选，自动创建） */
  multimodalBridge?: McpMultimodalToolBridge;
  /** 图像处理器（可选） */
  imageProcessor?: McpImageProcessor;
  /** 音频处理器（可选） */
  audioProcessor?: McpAudioProcessor;
  /** 工具引擎（可选） */
  toolEngine?: ToolUseEngine;
  /** 自动连接已启用的 MCP 服务器 */
  autoConnect?: boolean;
  /** 路由策略 */
  routingStrategy?: RoutingStrategy;
  /** 回调：输入处理 */
  onInputProcessed?: (input: MultimodalInput) => void;
  /** 回调：路由决策 */
  onRoutingDecision?: (decision: RoutingDecision) => void;
  /** 回调：工具执行 */
  onToolExecution?: (execution: MultimodalToolExecution) => void;
  /** 回调：错误 */
  onError?: (error: Error) => void;
}

// ============ 路由规则 ============

/**
 * 内置路由规则
 * 根据输入类型选择合适的 MCP 工具
 */
const ROUTING_RULES: Array<{
  type: 'image' | 'audio' | 'file' | 'text';
  patterns: RegExp[];
  tool: string;
  description: string;
}> = [
  // 图像 OCR
  {
    type: 'image',
    patterns: [/ocr|文字|识别|提取文字|text|extract/i],
    tool: 'image_ocr',
    description: '图像 OCR 文字识别',
  },
  // 图像描述
  {
    type: 'image',
    patterns: [/描述|describe|说明|这是什么|caption/i],
    tool: 'image_describe',
    description: '图像内容描述',
  },
  // 图像尺寸调整
  {
    type: 'image',
    patterns: [/调整|resize|缩放|尺寸|大小/i],
    tool: 'image_resize',
    description: '调整图像尺寸',
  },
  // 图像格式转换
  {
    type: 'image',
    patterns: [/转换|convert|格式|format/i],
    tool: 'image_convert',
    description: '图像格式转换',
  },
  // 默认图像处理
  {
    type: 'image',
    patterns: [/.*/],
    tool: 'image_describe',
    description: '默认图像处理（描述）',
  },
  // 音频转写
  {
    type: 'audio',
    patterns: [/转写|transcribe|听写|语音转文字|asr/i],
    tool: 'audio_transcribe',
    description: '音频转文字',
  },
  // 音频元数据
  {
    type: 'audio',
    patterns: [/元数据|metadata|信息|时长|duration/i],
    tool: 'audio_metadata',
    description: '音频元数据提取',
  },
  // 音频片段
  {
    type: 'audio',
    patterns: [/剪辑|clip|片段|截取|提取/i],
    tool: 'audio_clip',
    description: '音频片段提取',
  },
  // 默认音频处理
  {
    type: 'audio',
    patterns: [/.*/],
    tool: 'audio_transcribe',
    description: '默认音频处理（转写）',
  },
  // 文件 - 默认描述
  {
    type: 'file',
    patterns: [/.*/],
    tool: 'image_describe',
    description: '文件处理（使用图像描述）',
  },
];

/**
 * 根据输入类型和用户消息路由到合适的工具
 */
export function routeInput(
  input: MultimodalInput,
  userMessage: string,
  explicitMap?: Record<string, string>,
): RoutingDecision {
  const start = Date.now();

  // 1. 显式映射优先
  if (explicitMap?.[input.id]) {
    return {
      inputId: input.id,
      toolName: explicitMap[input.id],
      arguments: buildArgsForTool(input, explicitMap[input.id]),
      reason: 'explicit mapping',
      durationMs: Date.now() - start,
      source: 'explicit',
    };
  }

  // 2. 规则匹配
  const candidates = ROUTING_RULES.filter((r) => r.type === input.type);
  for (const rule of candidates) {
    for (const pattern of rule.patterns) {
      if (pattern.test(userMessage)) {
        return {
          inputId: input.id,
          toolName: rule.tool,
          arguments: buildArgsForTool(input, rule.tool),
          reason: `rule: ${rule.description}`,
          durationMs: Date.now() - start,
          source: 'rule',
        };
      }
    }
  }

  // 3. 默认（理论上不会走到这里，因为有 /.*/ 默认规则）
  return {
    inputId: input.id,
    toolName: input.type === 'image' ? 'image_describe' : 'audio_transcribe',
    arguments: buildArgsForTool(input, input.type === 'image' ? 'image_describe' : 'audio_transcribe'),
    reason: 'fallback default',
    durationMs: Date.now() - start,
    source: 'rule',
  };
}

/**
 * 根据工具构造参数
 */
function buildArgsForTool(input: MultimodalInput, toolName: string): Record<string, unknown> {
  if (input.type === 'image') {
    if (toolName === 'image_resize') {
      return { image: input.data, mimeType: input.mimeType, width: 512 };
    }
    if (toolName === 'image_convert') {
      return { image: input.data, mimeType: input.mimeType, targetFormat: 'png' };
    }
    return { image: input.data, mimeType: input.mimeType };
  }
  if (input.type === 'audio') {
    if (toolName === 'audio_clip') {
      return { audio: input.data, mimeType: input.mimeType, startMs: 0, endMs: 5000 };
    }
    return { audio: input.data, mimeType: input.mimeType };
  }
  return { data: input.data, mimeType: input.mimeType, text: input.text };
}

// ============ 多模态智能体循环 ============

/**
 * 多模态智能体循环
 * 提供端到端的多模态处理能力：
 * 1. 接收多模态输入（图像/音频/文件/文本）
 * 2. 智能路由到对应 MCP 多模态工具
 * 3. 多模态上下文压缩
 * 4. 多模态 LLM 内容转换
 * 5. 流式响应
 */
export class MultimodalAgentLoop {
  private llm: LLMProvider;
  private mcpRegistry: McpServerRegistry;
  private toolBridge: McpToolBridge;
  private multimodalBridge: McpMultimodalToolBridge;
  private imageProcessor: McpImageProcessor;
  private audioProcessor: McpAudioProcessor;
  private toolEngine: ToolUseEngine;
  private autoConnect: boolean;
  private defaultRoutingStrategy: RoutingStrategy;

  // 状态
  private connectedServers: Set<string> = new Set();
  private registeredTools: Set<string> = new Set();
  private streamListeners: Set<MultimodalStreamListener> = new Set();

  // 回调
  private onInputProcessed?: (input: MultimodalInput) => void;
  private onRoutingDecision?: (decision: RoutingDecision) => void;
  private onToolExecution?: (execution: MultimodalToolExecution) => void;
  private onError?: (error: Error) => void;

  // 统计
  private stats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    totalInputs: 0,
    totalImageInputs: 0,
    totalAudioInputs: 0,
    totalFileInputs: 0,
    totalTextInputs: 0,
    totalToolExecutions: 0,
    totalMultimodalExecutions: 0,
    totalRoutingDecisions: 0,
    ruleBasedRoutes: 0,
    llmBasedRoutes: 0,
    explicitRoutes: 0,
    totalCompressionSavings: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  };

  constructor(options: MultimodalAgentLoopOptions) {
    this.llm = options.llmProvider;
    this.mcpRegistry = options.mcpRegistry;
    this.toolBridge = options.toolBridge;

    // 创建或使用多模态桥接
    this.multimodalBridge =
      options.multimodalBridge ?? new McpMultimodalToolBridge(options.toolBridge);
    this.multimodalBridge.declareCapabilities([
      { toolName: 'image_ocr', outputTypes: ['text'], maxSize: 50_000 },
      { toolName: 'image_describe', outputTypes: ['text'], maxSize: 5_000 },
      { toolName: 'image_resize', outputTypes: ['image'], maxSize: 5_000_000 },
      { toolName: 'image_convert', outputTypes: ['image'], maxSize: 5_000_000 },
      { toolName: 'image_to_base64', outputTypes: ['text'], maxSize: 5_000_000 },
      { toolName: 'audio_transcribe', outputTypes: ['text'], maxSize: 50_000 },
      { toolName: 'audio_synthesize', outputTypes: ['audio'], maxSize: 5_000_000 },
      { toolName: 'audio_convert', outputTypes: ['audio'], maxSize: 5_000_000 },
      { toolName: 'audio_metadata', outputTypes: ['text'], maxSize: 1_000 },
      { toolName: 'audio_clip', outputTypes: ['audio'], maxSize: 5_000_000 },
    ]);

    this.imageProcessor = options.imageProcessor ?? new McpImageProcessor();
    this.audioProcessor = options.audioProcessor ?? new McpAudioProcessor();
    this.autoConnect = options.autoConnect ?? true;
    this.defaultRoutingStrategy = options.routingStrategy ?? 'auto';
    this.toolEngine = options.toolEngine ?? new ToolUseEngine();

    this.onInputProcessed = options.onInputProcessed;
    this.onRoutingDecision = options.onRoutingDecision;
    this.onToolExecution = options.onToolExecution;
    this.onError = options.onError;
  }

  // ============ 初始化 ============

  /**
   * 初始化：连接已启用的 MCP 服务器并注册多模态工具
   */
  async initialize(): Promise<{ connectedServers: number; registeredTools: number }> {
    if (!this.autoConnect) {
      return { connectedServers: 0, registeredTools: 0 };
    }

    const allServers = this.mcpRegistry.list();
    const enabledServers = allServers.filter(
      (s) => s.enabledByDefault && !this.connectedServers.has(s.id),
    );

    for (const def of enabledServers) {
      try {
        const status = this.mcpRegistry.getStatus(def.id);
        if (!status?.connected) {
          await this.mcpRegistry.connect(def.id);
        }
        const client = this.mcpRegistry.getClient(def.id);
        if (client) {
          await this.toolBridge.registerServer(def.id, client);
          this.connectedServers.add(def.id);
        }
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    return {
      connectedServers: this.connectedServers.size,
      registeredTools: this.registeredTools.size,
    };
  }

  /**
   * 同步桥接工具到 ToolEngine
   */
  private syncBridgeToolsToEngine(): void {
    const bridgeDefs = this.toolBridge.getDefinitions();
    const executor = this.toolBridge.createExecutor();
    for (const def of bridgeDefs) {
      if (!this.toolEngine.getTool(def.name)) {
        this.toolEngine.registerTool(def, executor);
        this.registeredTools.add(def.name);
      }
    }
  }

  // ============ Agent 运行 ============

  /**
   * 运行多模态 Agent 循环（核心方法）
   */
  async run(
    userMessage: string,
    inputs: MultimodalInput[],
    options: MultimodalAgentOptions = {},
  ): Promise<MultimodalAgentResult> {
    const startTime = Date.now();
    this.stats.totalRuns += 1;
    this.syncBridgeToolsToEngine();

    const routingStrategy = options.routingStrategy ?? this.defaultRoutingStrategy;

    // 1. 输入统计
    const inputSummary = this.summarizeInputs(inputs);
    this.stats.totalInputs += inputs.length;
    this.stats.totalImageInputs += inputSummary.images;
    this.stats.totalAudioInputs += inputSummary.audios;
    this.stats.totalFileInputs += inputSummary.files;
    this.stats.totalTextInputs += inputSummary.texts;

    for (const input of inputs) {
      this.emit({ type: 'input-processed', input, at: Date.now() });
      this.onInputProcessed?.(input);
    }

    const result: MultimodalAgentResult = {
      content: '',
      multimodalContent: [],
      toolExecutions: [],
      routingDecisions: [],
      inputSummary,
      totalTokens: 0,
      durationMs: 0,
      steps: 0,
      success: false,
      timestamp: startTime,
    };

    try {
      // 2. 路由每个多模态输入到对应工具
      for (const input of inputs) {
        if (input.type === 'text') {
          // 文本类型不需要工具调用，直接合并到 userMessage
          continue;
        }

        const decision = this.makeRoutingDecision(input, userMessage, routingStrategy, options);
        result.routingDecisions.push(decision);
        this.stats.totalRoutingDecisions += 1;
        if (decision.source === 'rule') this.stats.ruleBasedRoutes += 1;
        else if (decision.source === 'llm') this.stats.llmBasedRoutes += 1;
        else this.stats.explicitRoutes += 1;

        this.emit({ type: 'routing-decision', decision, at: Date.now() });
        this.onRoutingDecision?.(decision);

        // 3. 执行多模态工具
        this.emit({
          type: 'tool-execution-start',
          toolName: decision.toolName,
          inputId: input.id,
          at: Date.now(),
        });

        const toolStart = Date.now();
        const mmResult = await this.executeMultimodalTool(input, decision);
        const llmContent = this.multimodalBridge.toLLMContent(mmResult);
        const execution: MultimodalToolExecution = {
          callId: mmResult.callId,
          toolName: decision.toolName,
          inputId: input.id,
          result: mmResult,
          llmContent,
          durationMs: Date.now() - toolStart,
          success: mmResult.success,
          timestamp: Date.now(),
        };
        result.toolExecutions.push(execution);
        this.stats.totalToolExecutions += 1;
        this.stats.totalMultimodalExecutions += 1;
        if (mmResult.compressionRatio) {
          this.stats.totalCompressionSavings += Math.floor(
            mmResult.parts.reduce((sum, p) => sum + (p.data?.length ?? 0) + (p.text?.length ?? 0), 0) *
              mmResult.compressionRatio,
          );
        }

        this.emit({ type: 'tool-execution-complete', execution, at: Date.now() });
        this.onToolExecution?.(execution);

        // 4. 添加到 multimodalContent
        for (const part of mmResult.parts) {
          if (part.type === 'text' && part.text) {
            result.multimodalContent.push({
              type: 'text',
              text: `[${decision.toolName}] ${part.text}`,
            });
          } else if (part.type === 'image' && part.data) {
            result.multimodalContent.push({
              type: 'image',
              data: part.data,
              mimeType: part.mimeType,
            });
          } else if (part.type === 'audio' && part.data) {
            result.multimodalContent.push({
              type: 'audio',
              data: part.data,
              mimeType: part.mimeType,
            });
          } else if (part.type === 'file') {
            result.multimodalContent.push({
              type: 'file',
              data: part.data,
              mimeType: part.mimeType,
              url: part.metadata?.uri as string | undefined,
            });
          }
        }
      }

      // 5. 构造 LLM 消息
      const messages = this.buildMessages(userMessage, inputs, result);
      const chatOptions: ChatOptions = {
        temperature: options.temperature ?? 0.7,
        model: options.model,
        tools: this.buildLlmToolDefs(),
      };

      // 6. Agent 循环
      const maxSteps = options.maxSteps ?? 3;
      const loopResult = await this.executeAgentLoop(messages, maxSteps, chatOptions, result);
      result.content = loopResult.content;
      result.totalTokens = loopResult.totalTokens;
      result.steps = loopResult.steps;
      result.terminationReason = loopResult.terminationReason;

      result.durationMs = Date.now() - startTime;
      result.success = !result.error && loopResult.terminationReason !== 'error';
      this.stats.totalTokens += result.totalTokens;
      this.stats.totalDurationMs += result.durationMs;
      if (result.success) {
        this.stats.successRuns += 1;
      } else {
        this.stats.failedRuns += 1;
      }
      this.emit({ type: 'final', result, at: Date.now() });
      return result;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.durationMs = Date.now() - startTime;
      result.success = false;
      result.terminationReason = 'error';
      this.stats.failedRuns += 1;
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.emit({ type: 'error', error: err as Error, at: Date.now() });
      return result;
    }
  }

  /**
   * 流式运行（生成器模式）
   */
  async *runStream(
    userMessage: string,
    inputs: MultimodalInput[],
    options: MultimodalAgentOptions = {},
  ): AsyncGenerator<MultimodalStreamEvent, MultimodalAgentResult, void> {
    // 注册一次性 listener
    const events: MultimodalStreamEvent[] = [];
    const collector: MultimodalStreamListener = (e) => events.push(e);
    this.streamListeners.add(collector);

    let result!: MultimodalAgentResult;
    const runPromise = this.run(userMessage, inputs, options).then((r) => {
      result = r;
    });

    // 定期 yield 事件
    let lastIdx = 0;
    while (!result) {
      await new Promise((r) => setTimeout(r, 10));
      while (lastIdx < events.length) {
        yield events[lastIdx++];
      }
    }

    await runPromise;
    this.streamListeners.delete(collector);

    // 输出剩余事件
    while (lastIdx < events.length) {
      yield events[lastIdx++];
    }

    return result;
  }

  // ============ 路由 ============

  private makeRoutingDecision(
    input: MultimodalInput,
    userMessage: string,
    strategy: RoutingStrategy,
    options: MultimodalAgentOptions,
  ): RoutingDecision {
    if (strategy === 'explicit') {
      const toolName = options.explicitToolMap?.[input.id] ?? this.defaultToolForType(input.type);
      return {
        inputId: input.id,
        toolName,
        arguments: buildArgsForTool(input, toolName),
        reason: 'explicit strategy',
        durationMs: 0,
        source: 'explicit',
      };
    }
    // auto / llm-decide 都先用规则（llm-decide 留给将来扩展）
    return routeInput(input, userMessage, options.explicitToolMap);
  }

  private defaultToolForType(type: MultimodalInput['type']): string {
    if (type === 'image') return 'image_describe';
    if (type === 'audio') return 'audio_transcribe';
    if (type === 'file') return 'image_describe';
    return 'image_describe';
  }

  // ============ 工具执行 ============

  private async executeMultimodalTool(
    input: MultimodalInput,
    decision: RoutingDecision,
  ): Promise<MultimodalToolResult> {
    // 1. 优先尝试 MCP 工具（通过 multimodalBridge）
    try {
      const call: ToolCall = {
        id: `mm-${input.id}-${Date.now()}`,
        name: decision.toolName,
        arguments: decision.arguments,
      };
      return await this.multimodalBridge.invokeMultimodal(call);
    } catch (err) {
      // 2. 回退到本地 processor
      return this.executeLocalProcessor(input, decision.toolName);
    }
  }

  private async executeLocalProcessor(
    input: MultimodalInput,
    toolName: string,
  ): Promise<MultimodalToolResult> {
    const start = Date.now();
    try {
      if (input.type === 'image' && toolName.startsWith('image_')) {
        const result = await this.imageProcessor.dispatch(toolName, {
          image: input.data,
          mimeType: input.mimeType,
        });
        return this.convertLocalResultToMultimodal(input, toolName, result, start);
      }
      if (input.type === 'audio' && toolName.startsWith('audio_')) {
        const result = await this.audioProcessor.dispatch(toolName, {
          audio: input.data,
          mimeType: input.mimeType,
        });
        return this.convertLocalResultToMultimodal(input, toolName, result, start);
      }
      throw new Error(`No processor available for tool ${toolName}`);
    } catch (err) {
      return {
        callId: `local-${input.id}`,
        toolName,
        success: false,
        parts: [
          {
            type: 'text',
            text: `本地处理失败: ${err instanceof Error ? err.message : String(err)}`,
            metadata: { source: 'local-processor-error' },
          },
        ],
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      };
    }
  }

  private convertLocalResultToMultimodal(
    input: MultimodalInput,
    toolName: string,
    result: { success: boolean; data?: unknown; error?: string; durationMs: number },
    start: number,
  ): MultimodalToolResult {
    const parts: MultimodalContentPart[] = [];
    if (result.success && result.data) {
      const data = result.data as Record<string, unknown>;
      // OCR / describe / transcribe / metadata → 文本
      if ('text' in data && typeof data.text === 'string') {
        parts.push({ type: 'text', text: data.text, metadata: { source: 'local', toolName } });
      } else if ('description' in data && typeof data.description === 'string') {
        parts.push({ type: 'text', text: data.description, metadata: { source: 'local', toolName } });
      } else if ('audio' in data && typeof data.audio === 'string') {
        parts.push({
          type: 'audio',
          data: data.audio,
          mimeType: (data.mimeType as string) ?? 'audio/wav',
          metadata: { source: 'local', toolName },
        });
      } else if ('image' in data && typeof data.image === 'string') {
        parts.push({
          type: 'image',
          data: data.image,
          mimeType: (data.mimeType as string) ?? 'image/png',
          metadata: { source: 'local', toolName },
        });
      } else {
        // 兜底：序列化整个 data
        try {
          parts.push({
            type: 'text',
            text: JSON.stringify(data, null, 2),
            metadata: { source: 'local', toolName, serialized: true },
          });
        } catch {
          // 忽略
        }
      }
    }
    return {
      callId: `local-${input.id}`,
      toolName,
      success: result.success,
      parts,
      error: result.error,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
  }

  // ============ Agent 循环 ============

  private async executeAgentLoop(
    messages: Message[],
    maxSteps: number,
    chatOptions: ChatOptions,
    _result: MultimodalAgentResult,
  ): Promise<{
    content: string;
    totalTokens: number;
    steps: number;
    terminationReason: MultimodalAgentResult['terminationReason'];
  }> {
    let currentMessages = [...messages];
    let totalTokens = 0;
    let step = 0;
    let content = '';
    let terminationReason: MultimodalAgentResult['terminationReason'] = 'completed';

    for (step = 1; step <= maxSteps; step++) {
      let response: ChatResponse;
      try {
        response = await this.llm.chat(currentMessages, chatOptions);
      } catch (err) {
        terminationReason = 'error';
        break;
      }
      totalTokens += response.usage?.totalTokens ?? 0;

      const toolCalls = this.toolEngine.parseOpenAIToolCalls(response);
      if (toolCalls.length === 0) {
        content = response.content;
        terminationReason = 'completed';
        break;
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content || '',
      };
      currentMessages.push(assistantMessage);

      for (const call of toolCalls) {
        const isMcp = call.name.startsWith('mcp__');
        let toolResult: ToolCallResult;
        if (isMcp) {
          toolResult = await this.toolBridge.execute(call);
        } else {
          toolResult = await this.toolEngine.executeCall(call);
        }
        currentMessages.push({
          role: 'tool',
          content: toolResult.success
            ? JSON.stringify(toolResult.result ?? '')
            : JSON.stringify({ error: toolResult.error?.message ?? 'unknown' }),
        });
      }

      if (step === maxSteps) {
        try {
          const finalResponse = await this.llm.chat(currentMessages, chatOptions);
          totalTokens += finalResponse.usage?.totalTokens ?? 0;
          content = finalResponse.content;
        } catch {
          content = '(达到最大步数)';
        }
        terminationReason = 'max_steps';
        break;
      }
    }

    if (step > maxSteps) {
      terminationReason = 'max_steps';
    }

    return { content, totalTokens, steps: step, terminationReason };
  }

  // ============ 消息构建 ============

  private buildMessages(
    userMessage: string,
    inputs: MultimodalInput[],
    result: MultimodalAgentResult,
  ): Message[] {
    const messages: Message[] = [];

    // 系统消息
    const tools = this.toolEngine.listTools({ enabled: true });
    const systemText = [
      '你是一个多模态智能助手，可以处理图像/音频/文件等输入。',
      '已通过 MCP 工具对多模态输入进行了预处理，结果如下：',
      '',
      ...result.multimodalContent.map((m) => {
        if (m.type === 'text') return `- 文本: ${m.text}`;
        if (m.type === 'image') return `- 图像 (${m.mimeType ?? 'image/png'})`;
        if (m.type === 'audio') return `- 音频 (${m.mimeType ?? 'audio/wav'})`;
        if (m.type === 'file') return `- 文件 ${m.url ?? ''} (${m.mimeType ?? 'unknown'})`;
        return '';
      }),
      '',
      `可用工具数: ${tools.length}`,
    ].join('\n');
    messages.push({ role: 'system', content: systemText });

    // 用户消息（包含多模态内容）
    const textInputs = inputs.filter((i) => i.type === 'text' && i.text);
    const userText = textInputs.map((i) => i.text).join('\n') || userMessage;
    const multimodalParts: MultimodalContent[] = [
      { type: 'text', text: userText },
    ];

    // 注入多模态内容到 user 消息
    for (const part of result.multimodalContent) {
      multimodalParts.push(part);
    }

    if (multimodalParts.length === 1) {
      messages.push({ role: 'user', content: userText });
    } else {
      messages.push({ role: 'user', content: multimodalParts });
    }

    return messages;
  }

  private buildLlmToolDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.toolEngine
      .listTools({ enabled: true })
      .map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters as unknown as Record<string, unknown>,
      }));
  }

  // ============ 辅助方法 ============

  private summarizeInputs(inputs: MultimodalInput[]): MultimodalAgentResult['inputSummary'] {
    return {
      total: inputs.length,
      images: inputs.filter((i) => i.type === 'image').length,
      audios: inputs.filter((i) => i.type === 'audio').length,
      files: inputs.filter((i) => i.type === 'file').length,
      texts: inputs.filter((i) => i.type === 'text').length,
    };
  }

  private emit(event: MultimodalStreamEvent): void {
    for (const listener of this.streamListeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }

  /**
   * 订阅流式事件
   */
  onStream(listener: MultimodalStreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  /**
   * 直接调用图像工具（跳过 Agent 循环）
   */
  async invokeImageTool(
    toolName: string,
    args: { image: string; mimeType?: string },
  ): Promise<MultimodalToolResult> {
    const input: MultimodalInput = {
      id: `img-${Date.now()}`,
      type: 'image',
      data: args.image,
      mimeType: args.mimeType,
      timestamp: Date.now(),
    };
    const decision: RoutingDecision = {
      inputId: input.id,
      toolName,
      arguments: { image: args.image, mimeType: args.mimeType },
      reason: 'direct image tool call',
      durationMs: 0,
      source: 'explicit',
    };
    return this.executeMultimodalTool(input, decision);
  }

  /**
   * 直接调用音频工具（跳过 Agent 循环）
   */
  async invokeAudioTool(
    toolName: string,
    args: { audio: string; mimeType?: string },
  ): Promise<MultimodalToolResult> {
    const input: MultimodalInput = {
      id: `aud-${Date.now()}`,
      type: 'audio',
      data: args.audio,
      mimeType: args.mimeType,
      timestamp: Date.now(),
    };
    const decision: RoutingDecision = {
      inputId: input.id,
      toolName,
      arguments: { audio: args.audio, mimeType: args.mimeType },
      reason: 'direct audio tool call',
      durationMs: 0,
      source: 'explicit',
    };
    return this.executeMultimodalTool(input, decision);
  }

  /**
   * 获取可用工具定义
   */
  listAvailableTools(): HermesToolDefinition[] {
    return this.toolEngine.listTools({ enabled: true });
  }

  /**
   * 获取多模态能力列表
   */
  listCapabilities() {
    return this.multimodalBridge.listCapabilities();
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      ...this.stats,
      avgCompressionSavings:
        this.stats.totalMultimodalExecutions > 0
          ? this.stats.totalCompressionSavings / this.stats.totalMultimodalExecutions
          : 0,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      totalInputs: 0,
      totalImageInputs: 0,
      totalAudioInputs: 0,
      totalFileInputs: 0,
      totalTextInputs: 0,
      totalToolExecutions: 0,
      totalMultimodalExecutions: 0,
      totalRoutingDecisions: 0,
      ruleBasedRoutes: 0,
      llmBasedRoutes: 0,
      explicitRoutes: 0,
      totalCompressionSavings: 0,
      totalTokens: 0,
      totalDurationMs: 0,
    };
    this.multimodalBridge.resetStats();
    this.imageProcessor.resetStats();
    this.audioProcessor.resetStats();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.connectedServers.clear();
    this.registeredTools.clear();
    this.streamListeners.clear();
    this.multimodalBridge.dispose();
  }
}

// ============ 工厂函数 ============

/**
 * 创建多模态智能体循环
 */
export function createMultimodalAgentLoop(
  options: MultimodalAgentLoopOptions,
): MultimodalAgentLoop {
  return new MultimodalAgentLoop(options);
}

/**
 * 便捷的多模态输入构造函数
 */
export function makeImageInput(
  data: string,
  mimeType: string = 'image/png',
  metadata?: Record<string, unknown>,
): MultimodalInput {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'image',
    data,
    mimeType,
    metadata,
    timestamp: Date.now(),
  };
}

export function makeAudioInput(
  data: string,
  mimeType: string = 'audio/wav',
  metadata?: Record<string, unknown>,
): MultimodalInput {
  return {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'audio',
    data,
    mimeType,
    metadata,
    timestamp: Date.now(),
  };
}

export function makeFileInput(
  data: string,
  filename: string,
  mimeType: string = 'application/octet-stream',
  metadata?: Record<string, unknown>,
): MultimodalInput {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'file',
    data,
    filename,
    mimeType,
    metadata,
    timestamp: Date.now(),
  };
}

export function makeTextInput(text: string, metadata?: Record<string, unknown>): MultimodalInput {
  return {
    id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'text',
    text,
    metadata,
    timestamp: Date.now(),
  };
}
