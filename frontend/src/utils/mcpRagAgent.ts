/**
 * # ============================================================
 * # McpRagAgent - MCP × RAG 智能体循环 (v1.0.0 Cycle 45 G45-04)
 * # ============================================================
 * # 核心作用：智能路由的 MCP RAG 智能体
 * #           - 三源协同：资源RAG + 工具RAG + 提示词RAG
 * #           - 智能路由：基于 query 类型决定检索路径
 * #           - 工具增强：当资源不足时自动调用 MCP 工具
 * #           - 多轮迭代：可配置深度（最多 N 轮）
 * #           - 完整引用：所有来源可追溯
 * # 对标产品：LangChain Agent + RAG / Haystack Pipeline
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 45 G45-04 初次创建
 * # ============================================================
 */

import type { McpRagEngine, McpRagHit, AgentRagEnhanceResult, AgentRagEnhanceOptions } from './mcpRagEngine';
import type { McpToolRagSource, McpToolResult, McpToolSourceRetrieveResult } from './mcpToolRagSource';
import { hashText } from './mcpToolRagSource';

// ============ 类型定义 ============

/**
 * 智能体决策
 */
export type RagDecision =
  | 'resource-only' // 仅使用资源RAG
  | 'tool-only' // 仅使用工具RAG
  | 'hybrid' // 混合：先资源，不足时补工具
  | 'auto'; // 自动选择

/**
 * 智能体执行选项
 */
export interface McpRagAgentOptions {
  /** McpRagEngine 实例（可选，未传则用构造时注入的） */
  ragEngine?: McpRagEngine;
  /** McpToolRagSource 实例（可选） */
  toolSource?: McpToolRagSource;
  /** 决策策略（默认 auto） */
  decision?: RagDecision;
  /** 检索 top K（默认 5） */
  topK?: number;
  /** 工具调用配置（tool-only / hybrid 模式） */
  toolConfig?: {
    /** 候选工具（serverId + toolName） */
    candidates: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>;
    /** 并发数（默认 3） */
    concurrency?: number;
  };
  /** 是否使用 MCP 提示词（默认 false） */
  usePrompt?: boolean;
  /** 提示词名称（qualifiedName） */
  promptName?: string;
  /** 提示词参数 */
  promptArgs?: Record<string, string>;
  /** LLM 选项 */
  llmOptions?: AgentRagEnhanceOptions['llmOptions'];
  /** 系统提示词 */
  systemPrompt?: string;
  /** 上下文最大 tokens（默认 4000） */
  maxContextTokens?: number;
  /** 最小命中数（不足时触发工具检索） */
  minHitsForHybrid?: number;
  /** 进度回调 */
  onProgress?: (phase: AgentPhase, message: string, data?: unknown) => void;
}

/**
 * 智能体执行阶段
 */
export type AgentPhase =
  | 'analyzing' // 分析查询
  | 'retrieving-resources' // 检索资源
  | 'retrieving-tools' // 检索工具
  | 'assembling' // 组装上下文
  | 'generating' // 生成回答
  | 'done' // 完成
  | 'error'; // 出错

/**
 * 智能体执行步骤
 */
export interface McpRagAgentStep {
  phase: AgentPhase;
  message: string;
  timestamp: number;
  durationMs?: number;
  data?: unknown;
}

/**
 * 智能体执行结果
 */
export interface McpRagAgentResult {
  /** 最终答案 */
  answer: string;
  /** 资源 RAG 命中 */
  resourceHits: McpRagHit[];
  /** 工具调用结果 */
  toolResults: McpToolResult[];
  /** 工具 RAG 命中（tool-temp） */
  toolHits: McpRagHit[];
  /** 引用 */
  citations: AgentRagEnhanceResult['citations'];
  /** 元数据 */
  metadata: {
    query: string;
    decision: RagDecision;
    totalTimeMs: number;
    retrievalTimeMs: number;
    toolTimeMs: number;
    generationTimeMs: number;
    totalTokens?: number;
    resourceCount: number;
    toolCount: number;
    usePrompt: boolean;
    timestamp: number;
  };
  /** 执行步骤（用于 UI 展示） */
  steps: McpRagAgentStep[];
}

/**
 * 智能体事件
 */
export type McpRagAgentEvent =
  | { type: 'started'; query: string; decision: RagDecision; at: number }
  | { type: 'phase'; phase: AgentPhase; message: string; at: number }
  | { type: 'resource-retrieved'; hitCount: number; at: number }
  | { type: 'tool-retrieved'; toolCount: number; hitCount: number; at: number }
  | { type: 'decision-changed'; from: RagDecision; to: RagDecision; reason: string; at: number }
  | { type: 'completed'; result: McpRagAgentResult; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpRagAgentListener = (event: McpRagAgentEvent) => void;

/**
 * 智能体统计
 */
export interface McpRagAgentStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgTotalTimeMs: number;
  totalResourceHits: number;
  totalToolHits: number;
  totalTokensUsed: number;
}

// ============ 主类 ============

/**
 * MCP × RAG 智能体
 * 协调资源RAG / 工具RAG / 提示词RAG，提供智能查询路径
 */
export class McpRagAgent {
  private readonly ragEngine: McpRagEngine;
  private readonly toolSource?: McpRagToolSourceLike;
  private readonly listeners: Set<McpRagAgentListener> = new Set();
  private stats: McpRagAgentStats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    avgTotalTimeMs: 0,
    totalResourceHits: 0,
    totalToolHits: 0,
    totalTokensUsed: 0,
  };
  private _totalTimeMs = 0;

  constructor(ragEngine: McpRagEngine, toolSource?: McpToolRagSource) {
    this.ragEngine = ragEngine;
    this.toolSource = toolSource as McpRagToolSourceLike;
  }

  // ============ 事件系统 ============

  on(listener: McpRagAgentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: McpRagAgentEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[McpRagAgent] listener error:', err);
      }
    }
  }

  // ============ 决策引擎 ============

  /**
   * 自动决策：基于 query 推断最优路径
   */
  private decide(query: string, options: McpRagAgentOptions): RagDecision {
    if (options.decision && options.decision !== 'auto') {
      return options.decision;
    }

    const q = query.toLowerCase().trim();
    const hasUrl = /(https?:\/\/[^\s]+)/.test(q);
    const hasFetchIntent = /fetch|download|get page|网页|抓取|下载|读取|read|load|visit/.test(q);
    const hasQueryIntent = /what|how|why|explain|describe|分析|解释|介绍|什么是|怎么|为什么/.test(q);
    const hasListIntent = /list|show|all|find|search|列出|显示|搜索|查找|所有/.test(q);

    // URL 或 fetch 意图明显 → tool-only
    if (hasUrl || (hasFetchIntent && (hasUrl || /page|url|web/.test(q)))) {
      return 'tool-only';
    }

    // 查询意图 + 已有资源 → resource-only
    if (hasQueryIntent && !hasFetchIntent) {
      return 'resource-only';
    }

    // 列出/搜索意图 → hybrid（先看资源，必要时调工具）
    if (hasListIntent) {
      return 'hybrid';
    }

    // 默认 hybrid
    return 'hybrid';
  }

  // ============ 主流程 ============

  /**
   * 执行智能体查询
   */
  async run(query: string, options: McpRagAgentOptions = {}): Promise<McpRagAgentResult> {
    const startTime = performance.now();
    this.stats.totalRuns += 1;

    const decision = this.decide(query, options);
    this.emit({ type: 'started', query, decision, at: Date.now() });

    const steps: McpRagAgentStep[] = [];
    const onProgress = (phase: AgentPhase, message: string, data?: unknown) => {
      const step: McpRagAgentStep = { phase, message, timestamp: Date.now(), data };
      steps.push(step);
      this.emit({ type: 'phase', phase, message, at: step.timestamp });
      if (options.onProgress) {
        try {
          options.onProgress(phase, message, data);
        } catch {
          // 忽略回调错误
        }
      }
    };

    let resourceHits: McpRagHit[] = [];
    let toolResults: McpToolResult[] = [];
    let toolHits: McpRagHit[] = [];
    let retrievalTimeMs = 0;
    let toolTimeMs = 0;
    let generationTimeMs = 0;
    let totalTokens: number | undefined;

    try {
      // ========== Phase 1: 分析 ==========
      onProgress('analyzing', `Analyzing query and chose strategy: ${decision}`);

      // ========== Phase 2: 资源检索 ==========
      if (decision === 'resource-only' || decision === 'hybrid') {
        const t1 = Date.now();
        onProgress('retrieving-resources', 'Searching persistent knowledge base');
        resourceHits = await this.ragEngine.retrieve(query, {
          topK: options.topK ?? 5,
          includeLocalDocs: true,
        });
        retrievalTimeMs = Date.now() - t1;
        this.emit({ type: 'resource-retrieved', hitCount: resourceHits.length, at: Date.now() });
        onProgress('retrieving-resources', `Found ${resourceHits.length} resource hits (${retrievalTimeMs}ms)`, { hitCount: resourceHits.length });
      }

      // ========== Phase 3: 工具检索 ==========
      // - tool-only: 只用工具
      // - hybrid: 资源 + 工具（始终并行）
      // - auto: 取决于 query，但 tool-only 的语义保留
      const minHits = options.minHitsForHybrid ?? 1;
      const shouldUseTools =
        decision === 'tool-only' ||
        decision === 'hybrid' ||
        (decision === 'auto' && resourceHits.length < minHits);

      if (shouldUseTools && this.toolSource && options.toolConfig) {
        const t2 = Date.now();
        onProgress('retrieving-tools', 'Calling MCP tools for fresh data');
        const toolRetrieve: McpToolSourceRetrieveResult = await this.toolSource.retrieve({
          toolCalls: options.toolConfig.candidates,
          query,
          topK: options.topK ?? 5,
          parallel: true,
          concurrency: options.toolConfig.concurrency ?? 3,
          useCache: true,
        });
        toolTimeMs = toolRetrieve.durationMs;
        toolResults = toolRetrieve.toolResults;
        // 提取 tool-temp 命中
        toolHits = toolRetrieve.hits
          .filter((h) => h.source === 'tool-temp')
          .map((h) => {
            const { source, ...rest } = h;
            return rest as McpRagHit;
          });
        this.emit({ type: 'tool-retrieved', toolCount: toolResults.length, hitCount: toolHits.length, at: Date.now() });
        onProgress(
          'retrieving-tools',
          `Called ${toolResults.length} tools, got ${toolHits.length} hits (${toolTimeMs}ms)`,
          { toolCount: toolResults.length, hitCount: toolHits.length }
        );

        // 决策变化：auto → hybrid
        if (decision === 'auto' && toolHits.length > 0) {
          this.emit({
            type: 'decision-changed',
            from: decision,
            to: 'hybrid',
            reason: `tool hits found, switching to hybrid`,
            at: Date.now(),
          });
        }
      }

      // ========== Phase 4: 组装 + 生成 ==========
      const allHits = [...resourceHits, ...toolHits];
      onProgress('assembling', `Assembling context from ${allHits.length} hits`);

      const t3 = Date.now();
      let answer: string;
      let citations: McpRagAgentResult['citations'];

      // 优先使用 enhance 走完整 RAG + LLM
      try {
        const enhanceResult = await this.ragEngine.enhance(query, {
          topK: options.topK ?? 5,
          systemPrompt: options.systemPrompt ?? this.buildAgentSystemPrompt(decision, allHits.length),
          maxContextTokens: options.maxContextTokens,
          promptName: options.usePrompt ? options.promptName : undefined,
          promptArgs: options.promptArgs,
          llmOptions: options.llmOptions,
          onChunk: options.onProgress
            ? undefined
            : undefined,
        });
        answer = enhanceResult.answer;
        citations = enhanceResult.citations;
        totalTokens = enhanceResult.metadata.totalTokens;
        generationTimeMs = enhanceResult.metadata.generationTimeMs;
        onProgress('generating', `LLM generated answer in ${generationTimeMs}ms`, { tokens: totalTokens });
      } catch (err) {
        // LLM 不可用：fallback 到 hits 摘要
        const fallback = this.fallbackSummary(query, allHits, toolResults);
        answer = fallback.answer;
        citations = fallback.citations;
        onProgress('generating', `LLM unavailable, using fallback summary (${toolResults.length} tool results)`, { fallback: true });
      }

      // ========== Phase 5: 完成 ==========
      const totalTimeMs = performance.now() - startTime;
      this.stats.successRuns += 1;
      this._totalTimeMs += totalTimeMs;
      this.stats.avgTotalTimeMs = this._totalTimeMs / this.stats.totalRuns;
      this.stats.totalResourceHits += resourceHits.length;
      this.stats.totalToolHits += toolHits.length;
      if (totalTokens) this.stats.totalTokensUsed += totalTokens;

      const result: McpRagAgentResult = {
        answer,
        resourceHits,
        toolResults,
        toolHits,
        citations,
        metadata: {
          query,
          decision,
          totalTimeMs,
          retrievalTimeMs,
          toolTimeMs,
          generationTimeMs,
          totalTokens,
          resourceCount: resourceHits.length,
          toolCount: toolResults.length,
          usePrompt: !!options.usePrompt,
          timestamp: Date.now(),
        },
        steps,
      };

      onProgress('done', `Completed in ${totalTimeMs}ms`, { result });
      this.emit({ type: 'completed', result, at: Date.now() });
      return result;
    } catch (err) {
      this.stats.failedRuns += 1;
      const error = err instanceof Error ? err : new Error(String(err));
      onProgress('error', error.message, { error });
      this.emit({ type: 'error', error, at: Date.now() });
      throw error;
    }
  }

  // ============ 辅助方法 ============

  /**
   * 构建系统提示词
   */
  private buildAgentSystemPrompt(decision: RagDecision, hitCount: number): string {
    const lines: string[] = [
      '你是一个智能助手，能够利用 MCP × RAG 系统回答用户问题。',
      `当前使用 ${decision} 策略，检索到 ${hitCount} 条相关上下文。`,
      '请基于上下文给出准确、有依据的回答，并标注信息来源。',
    ];
    if (hitCount === 0) {
      lines.push('注意：当前没有可用的上下文，请基于通用知识回答并说明不确定性。');
    }
    return lines.join('\n');
  }

  /**
   * Fallback 摘要（LLM 不可用时）
   */
  private fallbackSummary(
    query: string,
    hits: McpRagHit[],
    toolResults: McpToolResult[]
  ): { answer: string; citations: McpRagAgentResult['citations'] } {
    const parts: string[] = [];
    parts.push(`Question: ${query}\n`);

    if (hits.length > 0) {
      parts.push('\n## Retrieved Context\n');
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        parts.push(`[${i + 1}] ${h.content.substring(0, 200)}${h.content.length > 200 ? '...' : ''}\n`);
      }
    }

    if (toolResults.length > 0) {
      parts.push('\n## Tool Results\n');
      for (let i = 0; i < toolResults.length; i++) {
        const r = toolResults[i];
        if (r.success) {
          parts.push(`[${r.toolName}@${r.serverId}] ${r.text.substring(0, 300)}${r.text.length > 300 ? '...' : ''}\n`);
        } else {
          parts.push(`[${r.toolName}@${r.serverId}] Error: ${r.error}\n`);
        }
      }
    }

    const answer = parts.join('\n');

    const citations: McpRagAgentResult['citations'] = hits.map((h) => ({
      chunkId: h.chunkId,
      documentId: h.documentId,
      source: h.type === 'mcp-resource' ? h.resourceUri ?? 'mcp' : h.documentId,
      title: h.type === 'mcp-resource' ? h.resourceUri?.split('/').pop() : h.documentId,
      snippet: h.content.substring(0, 200),
      startOffset: 0,
      endOffset: Math.min(h.content.length, 200),
      relevanceScore: h.score,
    }));

    return { answer, citations };
  }

  // ============ 统计 ============

  getStats(): McpRagAgentStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      avgTotalTimeMs: 0,
      totalResourceHits: 0,
      totalToolHits: 0,
      totalTokensUsed: 0,
    };
    this._totalTimeMs = 0;
  }
}

// ============ 内部类型 ============

/**
 * McpToolRagSource 接口子集（避免循环依赖）
 */
interface McpRagToolSourceLike {
  retrieve(opts: any): Promise<McpToolSourceRetrieveResult>;
}

// ============ 工厂函数 ============

export function createMcpRagAgent(
  ragEngine: McpRagEngine,
  toolSource?: McpToolRagSource
): McpRagAgent {
  return new McpRagAgent(ragEngine, toolSource);
}
