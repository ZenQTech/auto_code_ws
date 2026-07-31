/**
 * # ============================================================
 * # McpRagRealLLM - 真实 LLM 端到端 RAG 集成 (v1.0.0 Cycle 46 G46-01)
 * # ============================================================
 * # 核心作用：将 McpRagAgent 与真实 LLM Provider 端到端打通
 * #           - 多 Provider 支持（火山方舟 / DeepSeek / Anthropic / OpenAI）
 * #           - 自动 Provider 协商（按优先级尝试，回退到 mock）
 * #           - Token 用量跟踪 + 成本计算
 * #           - 流式响应 + 中断控制
 * #           - 完整 Prompt 模板（System / Context / Query / Citations）
 * #           - 引用注入：自动把 RAG 命中的来源标注到输出
 * #           - 异步批处理：多问题并发执行
 * # 对标产品：LangChain RAG + LiteLLM / Vercel AI SDK RAG
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 46 G46-01 初次创建
 * # ============================================================
 */

import type { LLMProvider, Message, ChatResponse, StreamChunk, ChatOptions, StreamOptions, ProviderName, TokenUsage, ModelInfo } from './llmProviderAdapter';
import { MockProvider, generateId, estimateTokens, calculateCost, sleep } from './llmProviderAdapter';
import type { McpRagAgent, McpRagAgentResult, McpRagAgentOptions } from './mcpRagAgent';
import type { McpRagHit } from './mcpRagEngine';

// ============ 类型定义 ============

/**
 * 真实 LLM Provider 优先级配置
 */
export interface ProviderPriority {
  /** Provider 名称 */
  provider: ProviderName;
  /** 优先级（数字越小越优先，默认 100） */
  priority: number;
  /** 失败阈值（连续失败多少次后跳过，默认 3） */
  failureThreshold?: number;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 真实 LLM RAG 配置
 */
export interface McpRagRealLLMConfig {
  /** 候选 Provider 列表（按优先级排序） */
  providers: ProviderPriority[];
  /** 默认 Provider 名称（如果候选列表都不可用时使用 mock） */
  defaultProvider?: ProviderName;
  /** 最大重试次数（默认 2） */
  maxRetries?: number;
  /** 重试间隔（毫秒，默认 1000） */
  retryDelayMs?: number;
  /** 是否启用流式（默认 true） */
  enableStreaming?: boolean;
  /** 上下文 token 上限（默认 4000） */
  maxContextTokens?: number;
  /** 引用注入前缀（默认 "参考："） */
  citationPrefix?: string;
  /** 系统提示词模板 */
  systemPromptTemplate?: string;
  /** 用户提示词模板（{query} / {context} / {citations} 占位） */
  userPromptTemplate?: string;
}

/**
 * 真实 LLM RAG 增强选项
 */
export interface McpRagRealLLMOptions {
  /** Agent 选项 */
  agentOptions?: McpRagAgentOptions;
  /** LLM 聊天选项 */
  llmOptions?: ChatOptions;
  /** 强制使用指定 Provider */
  forceProvider?: ProviderName;
  /** 进度回调 */
  onProgress?: (phase: RAGPhase, message: string, data?: unknown) => void;
  /** 流式 chunk 回调 */
  onChunk?: (chunk: string) => void;
  /** 引用回调 */
  onCitations?: (citations: RAGCitation[]) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * RAG 执行阶段
 */
export type RAGPhase =
  | 'initializing'
  | 'selecting-provider'
  | 'retrieving'
  | 'assembling-context'
  | 'calling-llm'
  | 'streaming'
  | 'parsing-citations'
  | 'completed'
  | 'fallback'
  | 'error';

/**
 * RAG 引用
 */
export interface RAGCitation {
  /** 引用编号 [1] [2] [3] */
  index: number;
  /** 文档 ID */
  documentId: string;
  /** 资源 URI（如果是 MCP 资源） */
  resourceUri?: string;
  /** 服务器 ID */
  serverId?: string;
  /** 引用内容片段 */
  snippet: string;
  /** 相关性分数 */
  score: number;
  /** 文档标题/名称 */
  title?: string;
}

/**
 * 真实 LLM RAG 结果
 */
export interface McpRagRealLLMResult {
  /** 最终答案 */
  answer: string;
  /** 实际使用的 Provider 名称 */
  providerUsed: ProviderName;
  /** 实际使用的模型 */
  modelUsed: string;
  /** 引用列表 */
  citations: RAGCitation[];
  /** Token 用量 */
  usage: TokenUsage;
  /** 成本（USD） */
  cost: number;
  /** 是否降级到 mock */
  fallback: boolean;
  /** 各阶段耗时 */
  timings: {
    providerSelectionMs: number;
    retrievalMs: number;
    llmCallMs: number;
    totalMs: number;
  };
  /** Agent 执行的中间步骤 */
  agentResult: McpRagAgentResult;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 真实 LLM RAG 事件
 */
export type McpRagRealLLMEvent =
  | { type: 'provider-selected'; provider: ProviderName; model: string; at: number }
  | { type: 'retrieval-started'; query: string; at: number }
  | { type: 'retrieval-completed'; hits: McpRagHit[]; at: number }
  | { type: 'llm-called'; provider: ProviderName; model: string; tokens: number; at: number }
  | { type: 'fallback-triggered'; reason: string; at: number }
  | { type: 'completed'; result: McpRagRealLLMResult; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpRagRealLLMListener = (event: McpRagRealLLMEvent) => void;

/**
 * 真实 LLM RAG 统计
 */
export interface McpRagRealLLMStats {
  totalQueries: number;
  successQueries: number;
  fallbackQueries: number;
  failedQueries: number;
  totalTokensUsed: number;
  totalCost: number;
  providerUsage: Record<ProviderName, number>;
  avgLatencyMs: number;
}

// ============ 默认模板 ============

const DEFAULT_SYSTEM_PROMPT = `你是一位专业的 AI 助手，能够基于上下文信息回答用户问题。
要求：
1. 必须基于提供的上下文信息回答问题，不要编造事实
2. 引用上下文时，在对应位置标注引用编号 [1] [2] 等
3. 如果上下文不足以回答问题，明确告知用户
4. 保持回答简洁、准确、有条理`;

const DEFAULT_USER_PROMPT = `## 上下文信息

{context}

## 引用来源

{citations}

## 用户问题

{query}

## 回答要求

请基于上述上下文信息回答用户问题。在引用对应内容时，请使用引用编号（如 [1] [2]）标注来源。`;

// ============ Provider 健康度跟踪 ============

/**
 * Provider 失败跟踪器
 */
class ProviderHealthTracker {
  private failures: Map<ProviderName, number> = new Map();
  private lastFailure: Map<ProviderName, number> = new Map();
  private disabledUntil: Map<ProviderName, number> = new Map();

  /** 记录一次失败 */
  recordFailure(provider: ProviderName, threshold: number = 3, cooldownMs: number = 60000): void {
    const current = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, current);
    this.lastFailure.set(provider, Date.now());

    // 达到阈值后进入冷却
    if (current >= threshold) {
      this.disabledUntil.set(provider, Date.now() + cooldownMs);
    }
  }

  /** 记录一次成功，重置失败计数 */
  recordSuccess(provider: ProviderName): void {
    this.failures.delete(provider);
    this.disabledUntil.delete(provider);
  }

  /** 是否可用 */
  isAvailable(provider: ProviderName): boolean {
    const disabledUntil = this.disabledUntil.get(provider);
    if (!disabledUntil) return true;
    if (Date.now() >= disabledUntil) {
      // 冷却结束
      this.disabledUntil.delete(provider);
      this.failures.delete(provider);
      return true;
    }
    return false;
  }

  /** 获取当前失败次数 */
  getFailureCount(provider: ProviderName): number {
    return this.failures.get(provider) ?? 0;
  }

  /** 重置 */
  reset(): void {
    this.failures.clear();
    this.lastFailure.clear();
    this.disabledUntil.clear();
  }
}

// ============ 工具函数 ============

/**
 * 格式化上下文为文本
 */
function formatContext(hits: McpRagHit[], maxTokens: number = 4000): string {
  const parts: string[] = [];
  let totalTokens = 0;

  for (const hit of hits) {
    const text = hit.content || '';
    const tokens = estimateTokens(text);
    if (totalTokens + tokens > maxTokens) break;

    parts.push(`[${parts.length + 1}] ${text.trim()}`);
    totalTokens += tokens;
  }

  return parts.join('\n\n');
}

/**
 * 格式化引用列表
 */
function formatCitations(hits: McpRagHit[]): string {
  return hits
    .map((hit, idx) => {
      const title = (hit.result.chunk?.metadata?.title as string | undefined) || hit.resourceUri || hit.documentId;
      return `[${idx + 1}] ${title}${hit.serverId ? ` (来源: ${hit.serverId})` : ''} - 相关性: ${hit.score.toFixed(3)}`;
    })
    .join('\n');
}

/**
 * 从 Agent 结果提取引用
 */
function extractCitations(hits: McpRagHit[]): RAGCitation[] {
  return hits.map((hit, idx) => ({
    index: idx + 1,
    documentId: hit.documentId,
    resourceUri: hit.resourceUri,
    serverId: hit.serverId,
    snippet: hit.content.slice(0, 200),
    score: hit.score,
    title: hit.result.chunk?.metadata?.title as string | undefined,
  }));
}

// ============ McpRagRealLLM 主类 ============

/**
 * 真实 LLM 端到端 RAG 集成
 *
 * 设计要点：
 *   1. Provider 协商：按优先级选择可用 Provider，支持自动降级
 *   2. 健康度跟踪：失败的 Provider 进入冷却期，避免反复失败
 *   3. Token / 成本统计：完整跟踪每次调用的消耗
 *   4. 流式响应：支持流式 chunk 回调
 *   5. 引用注入：自动从 RAG 命中提取引用并附加到上下文
 */
export class McpRagRealLLM {
  private readonly config: Required<McpRagRealLLMConfig>;
  private readonly ragAgent: McpRagAgent;
  /** 可用的 LLM Providers（按 name 索引） */
  private readonly providers: Map<ProviderName, LLMProvider> = new Map();
  /** Mock Provider（兜底） */
  private readonly mockProvider: MockProvider;
  /** 健康度跟踪 */
  private readonly healthTracker: ProviderHealthTracker = new ProviderHealthTracker();
  /** 事件监听器 */
  private readonly listeners: Set<McpRagRealLLMListener> = new Set();
  /** 统计 */
  private stats: McpRagRealLLMStats = {
    totalQueries: 0,
    successQueries: 0,
    fallbackQueries: 0,
    failedQueries: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    providerUsage: {} as Record<ProviderName, number>,
    avgLatencyMs: 0,
  };
  private _totalLatencyMs = 0;

  constructor(ragAgent: McpRagAgent, config: McpRagRealLLMConfig) {
    this.ragAgent = ragAgent;
    this.config = {
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 1000,
      enableStreaming: config.enableStreaming ?? true,
      maxContextTokens: config.maxContextTokens ?? 4000,
      citationPrefix: config.citationPrefix ?? '参考：',
      systemPromptTemplate: config.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT,
      userPromptTemplate: config.userPromptTemplate ?? DEFAULT_USER_PROMPT,
      defaultProvider: config.defaultProvider ?? 'mock',
      providers: config.providers,
    };
    this.mockProvider = new MockProvider();
  }

  // ============ Provider 管理 ============

  /**
   * 注册 LLM Provider
   */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * 注销 Provider
   */
  unregisterProvider(name: ProviderName): void {
    this.providers.delete(name);
  }

  /**
   * 获取所有已注册的 Provider
   */
  getRegisteredProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 选择可用的 Provider（按优先级 + 健康度）
   */
  private selectProvider(forceProvider?: ProviderName): LLMProvider | null {
    const startTime = Date.now();

    try {
      // 强制指定
      if (forceProvider) {
        if (forceProvider === 'mock') return this.mockProvider;
        const provider = this.providers.get(forceProvider);
        if (provider && this.healthTracker.isAvailable(forceProvider)) {
          return provider;
        }
        return null;
      }

      // 按优先级排序
      const candidates = [...this.config.providers]
        .filter((c) => c.enabled !== false)
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

      for (const candidate of candidates) {
        if (!this.healthTracker.isAvailable(candidate.provider)) continue;
        const provider = this.providers.get(candidate.provider);
        if (provider) {
          this.emit({
            type: 'provider-selected',
            provider: candidate.provider,
            model: provider.defaultModel,
            at: startTime,
          });
          return provider;
        }
      }

      // 所有 Provider 都不可用 → 用 mock
      return null;
    } catch (err) {
      this.emit({ type: 'error', error: err as Error, at: startTime });
      return null;
    }
  }

  // ============ 事件订阅 ============

  on(listener: McpRagRealLLMListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: McpRagRealLLMEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[McpRagRealLLM] listener error:', err);
      }
    }
  }

  // ============ 核心 API ============

  /**
   * 执行真实 LLM RAG 查询
   *
   * 流程：
   *   1. 选择可用 Provider
   *   2. 调用 Agent 检索 RAG 命中
   *   3. 组装 Prompt（系统 + 上下文 + 引用 + 查询）
   *   4. 调用 LLM 生成答案
   *   5. 提取引用 + 统计 token/成本
   */
  async query(query: string, options: McpRagRealLLMOptions = {}): Promise<McpRagRealLLMResult> {
    const totalStart = Date.now();
    this.stats.totalQueries += 1;

    const result: McpRagRealLLMResult = {
      answer: '',
      providerUsed: 'mock',
      modelUsed: 'mock-fast',
      citations: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: 0,
      fallback: false,
      timings: {
        providerSelectionMs: 0,
        retrievalMs: 0,
        llmCallMs: 0,
        totalMs: 0,
      },
      agentResult: {} as McpRagAgentResult,
      success: false,
    };

    try {
      options.onProgress?.('initializing', '初始化真实 LLM RAG 查询', { query });

      // 检查中断
      if (options.signal?.aborted) {
        throw new Error('Query aborted');
      }

      // 1. 选择 Provider
      const providerStart = Date.now();
      let provider = this.selectProvider(options.forceProvider);
      result.timings.providerSelectionMs = Date.now() - providerStart;

      if (!provider) {
        // 降级到 mock
        provider = this.mockProvider;
        result.fallback = true;
        result.providerUsed = 'mock';
        result.modelUsed = provider.defaultModel;
        this.stats.fallbackQueries += 1;
        this.emit({
          type: 'fallback-triggered',
          reason: 'No available real LLM provider',
          at: Date.now(),
        });
        options.onProgress?.('fallback', '所有 Provider 不可用，降级到 mock', { provider: 'mock' });
      } else {
        result.providerUsed = provider.name;
        result.modelUsed = options.llmOptions?.model || provider.defaultModel;
      }

      // 2. RAG 检索
      const retrievalStart = Date.now();
      this.emit({ type: 'retrieval-started', query, at: retrievalStart });
      options.onProgress?.('retrieving', '执行 RAG 检索', { query });

      const agentResult = await this.ragAgent.run(query, options.agentOptions ?? {});
      const hits: McpRagHit[] = (agentResult as any).resourceHits ?? (agentResult as any).hits ?? [];
      const citations = extractCitations(hits);

      result.agentResult = agentResult;
      result.citations = citations;
      result.timings.retrievalMs = Date.now() - retrievalStart;

      this.emit({ type: 'retrieval-completed', hits, at: Date.now() });
      options.onProgress?.('assembling-context', '组装上下文', { hitCount: hits.length });
      options.onCitations?.(citations);

      // 3. 组装 Prompt
      const systemPrompt = this.config.systemPromptTemplate;
      const contextText = formatContext(hits, this.config.maxContextTokens);
      const citationText = formatCitations(hits);
      const userPrompt = this.config.userPromptTemplate
        .replace('{context}', contextText || '（无相关上下文）')
        .replace('{citations}', citationText || '（无引用）')
        .replace('{query}', query);

      // 4. 调用 LLM
      const llmStart = Date.now();
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      options.onProgress?.('calling-llm', `调用 ${provider.displayName}`, {
        provider: provider.name,
        model: result.modelUsed,
      });

      let response: ChatResponse | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        if (options.signal?.aborted) {
          throw new Error('Query aborted during LLM call');
        }

        try {
          if (this.config.enableStreaming && options.onChunk) {
            // 流式模式
            const chunks: string[] = [];
            for await (const chunk of provider.stream(messages, {
              ...options.llmOptions,
              model: result.modelUsed,
            })) {
              if (options.signal?.aborted) break;
              if (chunk.type === 'text' && chunk.text) {
                chunks.push(chunk.text);
                options.onChunk(chunk.text);
              } else if (chunk.type === 'error') {
                throw new Error(chunk.error || 'Stream error');
              }
            }
            response = {
              id: generateId('stream'),
              model: result.modelUsed,
              provider: provider.name,
              content: chunks.join(''),
              usage: { inputTokens: estimateTokens(userPrompt), outputTokens: estimateTokens(chunks.join('')), totalTokens: 0 },
              finishReason: 'stop',
              durationMs: Date.now() - llmStart,
            };
            response.usage.totalTokens = response.usage.inputTokens + response.usage.outputTokens;
          } else {
            // 非流式
            response = await provider.chat(messages, {
              ...options.llmOptions,
              model: result.modelUsed,
            });
          }
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err as Error;
          this.healthTracker.recordFailure(provider.name);
          if (attempt < this.config.maxRetries) {
            await sleep(this.config.retryDelayMs * Math.pow(2, attempt));
          }
        }
      }

      if (lastError || !response) {
        // 降级到 mock
        if (!result.fallback) {
          result.fallback = true;
          result.providerUsed = 'mock';
          result.modelUsed = this.mockProvider.defaultModel;
          provider = this.mockProvider;
          this.stats.fallbackQueries += 1;
          this.emit({
            type: 'fallback-triggered',
            reason: `LLM call failed: ${lastError?.message}`,
            at: Date.now(),
          });
          response = await provider.chat(messages, options.llmOptions);
        } else {
          throw lastError;
        }
      }

      result.answer = response.content;
      result.usage = response.usage;
      result.cost = provider.calculateCost(response.usage, result.modelUsed);
      result.timings.llmCallMs = Date.now() - llmStart;

      // 5. 统计
      this.healthTracker.recordSuccess(provider.name);
      this.stats.successQueries += 1;
      this.stats.totalTokensUsed += response.usage.totalTokens;
      this.stats.totalCost += result.cost;
      this.stats.providerUsage[provider.name] = (this.stats.providerUsage[provider.name] ?? 0) + 1;

      this.emit({
        type: 'llm-called',
        provider: provider.name,
        model: result.modelUsed,
        tokens: response.usage.totalTokens,
        at: Date.now(),
      });

      result.timings.totalMs = Date.now() - totalStart;
      this._totalLatencyMs += result.timings.totalMs;
      this.stats.avgLatencyMs = this._totalLatencyMs / this.stats.totalQueries;
      result.success = true;

      this.emit({ type: 'completed', result, at: Date.now() });
      options.onProgress?.('completed', '查询完成', { result });

      return result;
    } catch (err) {
      this.stats.failedQueries += 1;
      result.timings.totalMs = Date.now() - totalStart;
      result.error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', error: err as Error, at: Date.now() });
      options.onProgress?.('error', '查询失败', { error: result.error });
      return result;
    }
  }

  /**
   * 批量查询（并发执行）
   */
  async batchQuery(queries: string[], options: McpRagRealLLMOptions = {}): Promise<McpRagRealLLMResult[]> {
    return Promise.all(queries.map((q) => this.query(q, options)));
  }

  // ============ 统计 / 健康度 ============

  /**
   * 获取统计信息
   */
  getStats(): McpRagRealLLMStats {
    return { ...this.stats };
  }

  /**
   * 获取 Provider 健康度
   */
  getProviderHealth(): Record<ProviderName, { available: boolean; failures: number }> {
    const allProviders = new Set<ProviderName>([
      'mock',
      ...Array.from(this.providers.keys()),
    ]);
    const result: Record<string, { available: boolean; failures: number }> = {};
    for (const name of allProviders) {
      result[name] = {
        available: this.healthTracker.isAvailable(name),
        failures: this.healthTracker.getFailureCount(name),
      };
    }
    return result as Record<ProviderName, { available: boolean; failures: number }>;
  }

  /**
   * 重置健康度跟踪
   */
  resetHealth(): void {
    this.healthTracker.reset();
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalQueries: 0,
      successQueries: 0,
      fallbackQueries: 0,
      failedQueries: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      providerUsage: {} as Record<ProviderName, number>,
      avgLatencyMs: 0,
    };
    this._totalLatencyMs = 0;
  }
}

// ============ 工厂方法 ============

/**
 * 创建默认的真实 LLM RAG 实例
 * - 优先级：火山方舟 > DeepSeek > Anthropic > OpenAI > Mock
 */
export function createDefaultMcpRagRealLLM(
  ragAgent: McpRagAgent,
  providers: LLMProvider[] = []
): McpRagRealLLM {
  const config: McpRagRealLLMConfig = {
    providers: [
      { provider: 'volcengine-ark', priority: 10, failureThreshold: 3 },
      { provider: 'deepseek', priority: 20, failureThreshold: 3 },
      { provider: 'anthropic', priority: 30, failureThreshold: 3 },
      { provider: 'openai', priority: 40, failureThreshold: 3 },
      { provider: 'mock', priority: 100, failureThreshold: 999 },
    ],
    defaultProvider: 'mock',
  };
  const realLLM = new McpRagRealLLM(ragAgent, config);
  for (const provider of providers) {
    realLLM.registerProvider(provider);
  }
  return realLLM;
}

export default McpRagRealLLM;
