/**
 * # ============================================================
 * # MCP Integrated Agent Loop - MCP 集成智能体循环 (v1.0.0 Cycle 42 G42-04)
 * # ============================================================
 * # 核心作用：Hermes Agent Loop 与 MCP 工具/资源/提示词的端到端集成
 * #           - 自动注册所有 MCP 工具到 ToolRegistry
 * #           - LLM tool_call → MCP 工具执行（通过 McpToolBridge）
 * #           - 提示词渲染时自动注入 MCP 提示词列表
 * #           - 资源引用解析: @mcp://<serverId>/<uri>
 * #           - 端到端场景: 用户输入 → Agent → MCP 工具 → 结果
 * #           - 真实 LLM 集成（DeepSeek / 火山方舟）
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-04 初次创建
 * # ============================================================
 */

import type {
  LLMProvider,
  Message,
  ChatResponse,
  ChatOptions,
  ToolDefinition as LlmToolDefinition,
} from './llmProviderAdapter';
import {
  type ToolDefinition,
  type ToolCall,
  type ToolCallResult,
  ToolUseEngine,
} from './toolUseEngine';
import { McpServerRegistry } from './mcpRegistry';
import { McpToolBridge } from './mcpToolBridge';
import {
  McpResourceBridge,
  type ResourceInfo,
  type ResolvedResource,
  buildHermesResourceUri,
} from './mcpResourceBridge';
import {
  McpPromptBridge,
  type HermesPromptDefinition,
  type PromptExecutionContext,
  type RenderedHermesPrompt,
} from './mcpPromptBridge';

// ============ 类型定义 ============

/**
 * Agent 循环选项
 */
export interface McpAgentRunOptions {
  /** 运行模式 */
  mode?: 'react' | 'simple' | 'multi-step';
  /** 注入的提示词限定名列表 */
  prompts?: string[];
  /** 资源引用列表（@mcp://...） */
  resources?: string[];
  /** 最大步数 */
  maxSteps?: number;
  /** 温度 */
  temperature?: number;
  /** 模型覆盖 */
  model?: string;
  /** 元数据（用于插值） */
  metadata?: PromptExecutionContext['metadata'];
  /** 是否在响应中包含工具调用详情 */
  includeToolDetails?: boolean;
}

/**
 * 工具执行详情
 */
export interface ToolExecutionDetail {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: ToolCallResult;
  /** 是否是 MCP 工具 */
  isMcp: boolean;
  durationMs: number;
  timestamp: number;
}

/**
 * 资源解析详情
 */
export interface ResourceResolutionDetail {
  uri: string;
  content?: ResolvedResource;
  error?: string;
  durationMs: number;
  timestamp: number;
}

/**
 * 提示词渲染详情
 */
export interface PromptRenderDetail {
  qualifiedName: string;
  rendered: RenderedHermesPrompt;
  durationMs: number;
  timestamp: number;
}

/**
 * Agent 运行结果
 */
export interface McpAgentRunResult {
  /** 响应文本 */
  content: string;
  /** 工具执行详情列表 */
  toolExecutions: ToolExecutionDetail[];
  /** 资源解析详情 */
  resourceResolutions: ResourceResolutionDetail[];
  /** 提示词渲染详情 */
  promptRenders: PromptRenderDetail[];
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
  terminationReason?: 'completed' | 'max_steps' | 'error' | 'aborted';
  /** 时间戳 */
  timestamp: number;
}

/**
 * 集成 Agent 选项
 */
export interface McpIntegratedAgentLoopOptions {
  /** LLM Provider */
  llmProvider: LLMProvider;
  /** MCP 服务器注册表 */
  mcpRegistry: McpServerRegistry;
  /** 工具桥接 */
  toolBridge: McpToolBridge;
  /** 资源桥接 */
  resourceBridge?: McpResourceBridge;
  /** 提示词桥接 */
  promptBridge?: McpPromptBridge;
  /** 工具引擎（可选，使用已有的或创建新的） */
  toolEngine?: ToolUseEngine;
  /** 自动连接已启用的 MCP 服务器 */
  autoConnect?: boolean;
  /** 回调：步骤完成 */
  onStep?: (step: number, toolExecution?: ToolExecutionDetail) => void;
  /** 回调：工具调用 */
  onToolCall?: (call: ToolCall, isMcp: boolean) => void;
  /** 回调：资源解析 */
  onResourceResolve?: (detail: ResourceResolutionDetail) => void;
  /** 回调：提示词渲染 */
  onPromptRender?: (detail: PromptRenderDetail) => void;
  /** 回调：错误 */
  onError?: (error: Error) => void;
}

// ============ 资源引用解析 ============

/**
 * 资源引用模式
 * @mcp://<serverId>/<originalUri>
 */
const RESOURCE_REF_PATTERN = /@mcp:\/\/([a-zA-Z0-9_-]+)\/([^\s]+)/g;

/**
 * 从用户消息中提取 MCP 资源引用
 */
export function extractMcpResourceRefs(message: string): string[] {
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  // 重置 regex 状态
  RESOURCE_REF_PATTERN.lastIndex = 0;
  while ((match = RESOURCE_REF_PATTERN.exec(message)) !== null) {
    // 完整 URI
    const serverId = match[1];
    const originalUri = decodeURIComponent(match[2]);
    refs.push(buildHermesResourceUri(serverId, originalUri));
  }
  return refs;
}

/**
 * 提示词引用模式
 * /prompt <qualifiedName> 或 @prompt:<qualifiedName>
 */
const PROMPT_REF_PATTERN = /(?:^|\s)(?:\/prompt\s+|@prompt:)(mcp:[a-zA-Z0-9_-]+::[^\s]+)/g;

/**
 * 从用户消息中提取 MCP 提示词引用
 */
export function extractMcpPromptRefs(message: string): string[] {
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  PROMPT_REF_PATTERN.lastIndex = 0;
  while ((match = PROMPT_REF_PATTERN.exec(message)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

// ============ MCP 集成智能体循环 ============

/**
 * MCP 集成智能体循环
 * 提供端到端的 MCP 集成能力：
 * 1. 启动时自动注册所有 MCP 工具到 ToolRegistry
 * 2. 支持资源引用解析
 * 3. 支持提示词注入
 * 4. 路由 LLM tool_call 到对应执行器（本地工具 vs MCP 工具）
 */
export class McpIntegratedAgentLoop {
  private llm: LLMProvider;
  private mcpRegistry: McpServerRegistry;
  private toolBridge: McpToolBridge;
  private resourceBridge?: McpResourceBridge;
  private promptBridge?: McpPromptBridge;
  private toolEngine: ToolUseEngine;
  private autoConnect: boolean;
  private connectedServers: Set<string> = new Set();
  private registeredTools: Set<string> = new Set();

  // 回调
  private onStep?: (step: number, toolExecution?: ToolExecutionDetail) => void;
  private onToolCall?: (call: ToolCall, isMcp: boolean) => void;
  private onResourceResolve?: (detail: ResourceResolutionDetail) => void;
  private onPromptRender?: (detail: PromptRenderDetail) => void;
  private onError?: (error: Error) => void;

  // 统计
  private stats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    totalToolExecutions: 0,
    mcpToolExecutions: 0,
    localToolExecutions: 0,
    totalResourceResolutions: 0,
    totalPromptRenders: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  };

  constructor(options: McpIntegratedAgentLoopOptions) {
    this.llm = options.llmProvider;
    this.mcpRegistry = options.mcpRegistry;
    this.toolBridge = options.toolBridge;
    this.resourceBridge = options.resourceBridge;
    this.promptBridge = options.promptBridge;
    this.autoConnect = options.autoConnect ?? true;
    this.onStep = options.onStep;
    this.onToolCall = options.onToolCall;
    this.onResourceResolve = options.onResourceResolve;
    this.onPromptRender = options.onPromptRender;
    this.onError = options.onError;

    // 创建或使用工具引擎
    this.toolEngine = options.toolEngine ?? new ToolUseEngine();
  }

  // ============ 初始化 ============

  /**
   * 初始化：连接所有已启用的 MCP 服务器并注册其工具
   */
  async initialize(): Promise<{ connectedServers: number; registeredTools: number }> {
    if (!this.autoConnect) {
      return { connectedServers: 0, registeredTools: 0 };
    }

    // 尝试连接所有内置 + 启用的自定义服务器
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

          // 同步注册到 ToolRegistry
          await this.syncToolsToRegistry(def.id);
        }
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
        // 跳过连接/注册失败的服务器
      }
    }

    return {
      connectedServers: this.connectedServers.size,
      registeredTools: this.registeredTools.size,
    };
  }

  /**
   * 同步 MCP 工具到 ToolRegistry
   */
  async syncToolsToRegistry(serverId: string): Promise<number> {
    const client = this.mcpRegistry.getClient(serverId);
    if (!client) return 0;

    // 注册到 ToolBridge
    await this.toolBridge.registerServer(serverId, client);

    // 同步到 ToolEngine（通过公共方法）
    const executor = this.toolBridge.createExecutor();
    const defs = this.toolBridge.getDefinitions().filter(
      (d) => d.name.startsWith(`mcp__${serverId}__`),
    );

    for (const def of defs) {
      this.toolEngine.registerTool(def, executor);
      this.registeredTools.add(def.name);
    }
    return defs.length;
  }

  // ============ Agent 运行 ============

  /**
   * 运行 Agent 循环（带 MCP 集成）
   */
  async runWithMcp(userMessage: string, options: McpAgentRunOptions = {}): Promise<McpAgentRunResult> {
    const startTime = Date.now();
    this.stats.totalRuns += 1;

    // 0. 自动同步 toolBridge 工具到 toolEngine
    this.syncBridgeToolsToEngine();

    const result: McpAgentRunResult = {
      content: '',
      toolExecutions: [],
      resourceResolutions: [],
      promptRenders: [],
      totalTokens: 0,
      durationMs: 0,
      steps: 0,
      success: false,
      timestamp: startTime,
    };

    try {
      // 1. 提取并解析资源引用
      if (this.resourceBridge) {
        const explicitResources = options.resources ?? [];
        const inlineResources = extractMcpResourceRefs(userMessage);
        const allResources = [...explicitResources, ...inlineResources];
        for (const uri of allResources) {
          const resStart = Date.now();
          try {
            const resolved = await this.resourceBridge.resolve(uri);
            const detail: ResourceResolutionDetail = {
              uri,
              content: resolved,
              durationMs: Date.now() - resStart,
              timestamp: Date.now(),
            };
            result.resourceResolutions.push(detail);
            this.onResourceResolve?.(detail);
            this.stats.totalResourceResolutions += 1;
          } catch (err) {
            const detail: ResourceResolutionDetail = {
              uri,
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - resStart,
              timestamp: Date.now(),
            };
            result.resourceResolutions.push(detail);
            this.onResourceResolve?.(detail);
          }
        }
      }

      // 2. 渲染提示词
      if (this.promptBridge) {
        const promptRefs = options.prompts ?? extractMcpPromptRefs(userMessage);
        for (const qn of promptRefs) {
          const renderStart = Date.now();
          try {
            const ctx: PromptExecutionContext = {
              args: this.extractPromptArgsFromMessage(userMessage, qn),
              metadata: options.metadata,
            };
            const rendered = await this.promptBridge.render(qn, ctx);
            const detail: PromptRenderDetail = {
              qualifiedName: qn,
              rendered,
              durationMs: Date.now() - renderStart,
              timestamp: Date.now(),
            };
            result.promptRenders.push(detail);
            this.onPromptRender?.(detail);
            this.stats.totalPromptRenders += 1;
          } catch (err) {
            this.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      // 3. 构造消息
      const messages: Message[] = [];

      // 注入系统消息：MCP 工具定义 + 资源 + 提示词
      const systemMessage = this.buildSystemMessage(result, options);
      if (systemMessage) {
        messages.push({ role: 'system', content: systemMessage });
      }

      // 注入渲染后的提示词消息
      for (const pr of result.promptRenders) {
        for (const msg of pr.rendered.messages) {
          messages.push({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          });
        }
      }

      // 注入资源解析结果
      if (result.resourceResolutions.length > 0) {
        const resourceContext = result.resourceResolutions
          .map((r) => {
            if (r.content && 'text' in r.content.content) {
              return `[Resource ${r.uri}]:\n${r.content.content.text}`;
            }
            if (r.content && 'blob' in r.content.content) {
              return `[Resource ${r.uri}]: (binary, ${r.content.content.blob.length} bytes)`;
            }
            return `[Resource ${r.uri}]: (failed: ${r.error})`;
          })
          .join('\n\n');
        messages.push({
          role: 'system',
          content: `以下是用户消息中引用的 MCP 资源内容：\n\n${resourceContext}`,
        });
      }

      // 注入用户消息（清理资源引用标记）
      messages.push({
        role: 'user',
        content: this.cleanMessageRefs(userMessage),
      });

      // 4. Agent 循环
      const mode = options.mode ?? 'multi-step';
      if (mode === 'simple') {
        // 单步模式
        const response = await this.chatOnce(messages, options);
        result.content = response.content;
        result.totalTokens = response.usage?.totalTokens ?? 0;
        result.steps = 1;
        result.terminationReason = 'completed';
      } else {
        // 多步模式（ReAct 风格）
        const maxSteps = options.maxSteps ?? 5;
        const loopResult = await this.executeAgentLoop(messages, maxSteps, options, result);
        result.content = loopResult.content;
        result.totalTokens = loopResult.totalTokens;
        result.steps = loopResult.steps;
        result.terminationReason = loopResult.terminationReason;
      }

      result.durationMs = Date.now() - startTime;
      result.success = !result.error;
      this.stats.totalTokens += result.totalTokens;
      this.stats.totalDurationMs += result.durationMs;
      if (result.success) {
        this.stats.successRuns += 1;
      } else {
        this.stats.failedRuns += 1;
      }
      return result;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.durationMs = Date.now() - startTime;
      result.success = false;
      result.terminationReason = 'error';
      this.stats.failedRuns += 1;
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      return result;
    }
  }

  // ============ 列出可用工具/资源/提示词 ============

  /**
   * 列出所有可用工具（MCP + 本地）
   */
  listAvailableTools(): ToolDefinition[] {
    return this.toolEngine.listTools({ enabled: true });
  }

  /**
   * 列出所有可用资源
   */
  listAvailableResources(): ResourceInfo[] {
    return this.resourceBridge?.list() ?? [];
  }

  /**
   * 列出所有可用提示词
   */
  listAvailablePrompts(): HermesPromptDefinition[] {
    return this.promptBridge?.list() ?? [];
  }

  // ============ 统计 ============

  getStats() {
    return {
      ...this.stats,
      connectedServers: this.connectedServers.size,
      registeredMcpTools: this.registeredTools.size,
    };
  }

  // ============ 资源释放 ============

  dispose(): void {
    this.connectedServers.clear();
    this.registeredTools.clear();
  }

  // ============ 私有方法 ============

  /**
   * 同步 toolBridge 中的工具到 toolEngine
   * 这样 LLM 工具列表和系统消息就能看到 MCP 工具
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

  /**
   * 将 Hermes ToolDefinition 转换为 LLM 所需的 ToolDefinition 格式
   */
  private buildLlmToolDefs(): LlmToolDefinition[] {
    const hermesDefs = this.toolEngine.listTools({ enabled: true });
    return hermesDefs.map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters as unknown as Record<string, unknown>,
    }));
  }

  private async chatOnce(messages: Message[], options: McpAgentRunOptions): Promise<ChatResponse> {
    const chatOptions: ChatOptions = {
      temperature: options.temperature ?? 0.7,
      model: options.model,
      tools: this.buildLlmToolDefs(),
    };
    return await this.llm.chat(messages, chatOptions);
  }

  private async executeAgentLoop(
    messages: Message[],
    maxSteps: number,
    options: McpAgentRunOptions,
    result: McpAgentRunResult,
  ): Promise<{ content: string; totalTokens: number; steps: number; terminationReason: McpAgentRunResult['terminationReason'] }> {
    const chatOptions: ChatOptions = {
      temperature: options.temperature ?? 0.7,
      model: options.model,
      tools: this.buildLlmToolDefs(),
    };

    let currentMessages = [...messages];
    let totalTokens = 0;
    let step = 0;
    let content = '';
    let terminationReason: McpAgentRunResult['terminationReason'] = 'completed';

    for (step = 1; step <= maxSteps; step++) {
      const response = await this.llm.chat(currentMessages, chatOptions);
      totalTokens += response.usage?.totalTokens ?? 0;
      result.totalTokens = totalTokens;
      result.steps = step;

      const toolCalls = this.toolEngine.parseOpenAIToolCalls(response);

      if (toolCalls.length === 0) {
        // 无工具调用，结束
        content = response.content;
        terminationReason = 'completed';
        break;
      }

      // 执行所有工具调用
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content || '',
        // 注：实际 OpenAI 格式会包含 tool_calls 字段
      };
      currentMessages.push(assistantMessage);

      for (const call of toolCalls) {
        const isMcp = call.name.startsWith('mcp__');
        this.onToolCall?.(call, isMcp);

        const toolStart = Date.now();
        const toolResult = await this.executeToolCall(call, isMcp);
        const toolDuration = Date.now() - toolStart;

        const detail: ToolExecutionDetail = {
          callId: call.id,
          toolName: call.name,
          arguments: call.arguments,
          result: toolResult,
          isMcp,
          durationMs: toolDuration,
          timestamp: Date.now(),
        };
        result.toolExecutions.push(detail);

        if (isMcp) {
          this.stats.mcpToolExecutions += 1;
        } else {
          this.stats.localToolExecutions += 1;
        }
        this.stats.totalToolExecutions += 1;

        this.onStep?.(step, detail);

        // 添加工具结果到消息
        currentMessages.push({
          role: 'tool',
          content: toolResult.success
            ? JSON.stringify(toolResult.result ?? '')
            : JSON.stringify({ error: toolResult.error?.message ?? 'unknown' }),
        });
      }

      // 检查是否达到 maxSteps
      if (step === maxSteps) {
        terminationReason = 'max_steps';
        // 最后一次响应
        const finalResponse = await this.llm.chat(currentMessages, chatOptions);
        totalTokens += finalResponse.usage?.totalTokens ?? 0;
        content = finalResponse.content;
        break;
      }
    }

    if (step > maxSteps) {
      terminationReason = 'max_steps';
    }

    return { content, totalTokens, steps: step, terminationReason };
  }

  private async executeToolCall(call: ToolCall, isMcp: boolean): Promise<ToolCallResult> {
    if (isMcp) {
      return await this.toolBridge.execute(call);
    }
    return await this.toolEngine.executeCall(call);
  }

  private buildSystemMessage(_result: McpAgentRunResult, _options: McpAgentRunOptions): string | null {
    const parts: string[] = [];

    // 1. 基础系统提示词
    parts.push(
      '你是一个智能助手，可以访问 MCP（Model Context Protocol）服务器提供的工具、资源和提示词。',
    );

    // 2. 可用工具列表
    const tools = this.toolEngine.listTools({ enabled: true });
    if (tools.length > 0) {
      const mcpTools = tools.filter((t) => t.name.startsWith('mcp__'));
      const localTools = tools.filter((t) => !t.name.startsWith('mcp__'));
      parts.push(`\n## 可用工具（共 ${tools.length} 个）`);
      if (mcpTools.length > 0) {
        parts.push(`\n### MCP 工具 (${mcpTools.length} 个)：`);
        for (const t of mcpTools) {
          parts.push(`- ${t.name}: ${t.description}`);
        }
      }
      if (localTools.length > 0) {
        parts.push(`\n### 本地工具 (${localTools.length} 个)：`);
        for (const t of localTools) {
          parts.push(`- ${t.name}: ${t.description}`);
        }
      }
    }

    // 3. 可用资源
    if (this.resourceBridge) {
      const resources = this.resourceBridge.list();
      if (resources.length > 0) {
        parts.push(`\n## 可用资源（共 ${resources.length} 个）`);
        parts.push('用户可以使用 @mcp://<serverId>/<uri> 引用资源');
        const grouped = this.groupByServer(resources, (r) => r.serverId ?? 'unknown');
        for (const [serverId, items] of Object.entries(grouped)) {
          parts.push(`\n### 服务器 ${serverId}：`);
          for (const r of items.slice(0, 10)) {
            parts.push(`- ${r.uri} (${r.name})`);
          }
          if (items.length > 10) {
            parts.push(`- ... (共 ${items.length} 个)`);
          }
        }
      }
    }

    // 4. 可用提示词
    if (this.promptBridge) {
      const prompts = this.promptBridge.list();
      if (prompts.length > 0) {
        parts.push(`\n## 可用提示词（共 ${prompts.length} 个）`);
        parts.push('用户可以使用 /prompt <qualifiedName> 或 @prompt:<qualifiedName> 引用提示词');
        for (const p of prompts.slice(0, 10)) {
          parts.push(`- ${p.qualifiedName}: ${p.description ?? p.name}`);
        }
        if (prompts.length > 10) {
          parts.push(`- ... (共 ${prompts.length} 个)`);
        }
      }
    }

    // 5. 工具调用提示
    parts.push(`\n## 工具调用`);
    parts.push('- 使用工具时严格按工具名（含命名空间）调用');
    parts.push('- 工具参数必须是合法的 JSON');
    parts.push('- 如果工具执行失败，分析错误信息后重试或尝试其他工具');

    return parts.join('\n');
  }

  private cleanMessageRefs(message: string): string {
    return message
      .replace(/@mcp:\/\/[^\s]+/g, (match) => `[资源引用: ${match}]`)
      .replace(/@prompt:[^\s]+/g, (match) => `[提示词引用: ${match}]`)
      .replace(/\/prompt\s+\S+/g, (match) => `[提示词引用: ${match}]`);
  }

  private extractPromptArgsFromMessage(message: string, _qualifiedName: string): Record<string, string> {
    // 简化：从消息中提取 <key>=<value> 模式作为参数
    const args: Record<string, string> = {};
    const argPattern = /(\w+)=("[^"]*"|\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = argPattern.exec(message)) !== null) {
      let val = match[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      args[match[1]] = val;
    }
    return args;
  }

  private groupByServer<T>(items: T[], getKey: (item: T) => string): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const item of items) {
      const key = getKey(item);
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
    return result;
  }
}

// ============ 工厂函数 ============

/**
 * 创建 MCP 集成智能体循环
 */
export function createMcpIntegratedAgentLoop(
  options: McpIntegratedAgentLoopOptions,
): McpIntegratedAgentLoop {
  return new McpIntegratedAgentLoop(options);
}
