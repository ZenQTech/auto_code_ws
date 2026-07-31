/**
 * # ============================================================
 * # 真实 Volcengine 多模态 API 客户端 (Cycle 50 G50-01)
 * # ============================================================
 * # 核心作用：对接火山方舟多模态 Embedding API
 * #           集成 ApiKeyManager + RateLimiter + 监控埋点
 * # 运行流程：
 * #   1. 从 ApiKeyManager 获取 API Key
 * #   2. 通过 RateLimiter 限流
 * #   3. 调用真实 HTTPS API (doubao-embedding-vision)
 * #   4. 错误重试 + 降级到本地 Provider
 * #   5. 上报 metrics 到监控
 * # 输入参数：
 * #   - input: { text?: string; image?: string } 多模态输入
 * #   - options: { signal?: AbortSignal; priority?: number }
 * # 输出结果：
 * #   - Promise<RealVolcengineResponse>: { embedding, usage, cost, latencyMs }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-01 初次创建
 * # ====================================
 */

import { ApiKeyManager, getApiKeyManager } from './apiKeyManager';
import { RateLimiter, createVolcengineRateLimiter } from './rateLimiter';
import { CLIPLocalProvider, type CLIPLocalProviderConfig } from './clipLocalProvider';
import type { EmbeddingProvider, MultimodalInput, Modality } from './multimodalEmbedding';

// ============================================================
// 类型定义
// ============================================================

/** 真实 API 响应 */
export interface RealVolcengineResponse {
  /** Embedding 向量 */
  embedding: number[];
  /** Token 使用量 */
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  /** 成本 (USD) */
  cost: number;
  /** 端到端延迟 (毫秒) */
  latencyMs: number;
  /** 端点 */
  endpoint: string;
  /** 模型 */
  model: string;
}

/** 客户端配置 */
export interface RealVolcengineConfig {
  /** API Key 管理器 (默认全局单例) */
  apiKeyManager?: ApiKeyManager;
  /** 限流器 (默认火山方舟推荐配置) */
  rateLimiter?: RateLimiter;
  /** 降级 Provider (默认 CLIPLocalProvider) */
  fallbackProvider?: EmbeddingProvider;
  /** 强制使用 fallback (跳过 API 调用) */
  forceFallback?: boolean;
  /** 自定义 fetch 实现 (用于测试/SSR) */
  fetchImpl?: typeof fetch;
  /** 基础 URL (默认火山方舟北京) */
  baseURL?: string;
  /** 模型 (默认 doubao-embedding-vision) */
  model?: string;
  /** 最大重试次数 (默认 3) */
  maxRetries?: number;
  /** 重试退避基数 (毫秒, 默认 200) */
  retryBackoffMs?: number;
  /** 输入 token 单价 (USD per 1M tokens, 默认 $0.0008) */
  inputCostPerMTokens?: number;
  /** 图像单价 (USD per 1K images, 默认 $0.002) */
  imageCostPerK?: number;
  /** 请求超时 (毫秒, 默认 30000) */
  timeoutMs?: number;
  /** 监控上报回调 */
  onMetric?: (metric: RealVolcengineMetric) => void;
}

/** 监控埋点 */
export interface RealVolcengineMetric {
  type: 'success' | 'retry' | 'fallback' | 'error' | 'rate-limit';
  timestamp: number;
  latencyMs?: number;
  cost?: number;
  error?: string;
  statusCode?: number;
}

/** 客户端事件 */
export interface RealVolcengineEvent {
  type: 'request' | 'success' | 'retry' | 'fallback' | 'error' | 'rate-limit' | 'quota-exceeded';
  timestamp: number;
  provider: 'api' | 'fallback';
  durationMs?: number;
  cost?: number;
  retryCount?: number;
  error?: string;
  statusCode?: number;
}

export type RealVolcengineListener = (event: RealVolcengineEvent) => void;

/** 客户端统计 */
export interface RealVolcengineStats {
  totalRequests: number;
  successRequests: number;
  fallbackRequests: number;
  errorRequests: number;
  rateLimitedRequests: number;
  retriedRequests: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
}

// ============================================================
// 真实 API 响应 Schema (火山方舟)
// ====================================

interface VolcengineAPIResponse {
  /** 模型生成的 embedding */
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  /** 模型名 */
  model: string;
  /** Object 类型 */
  object: string;
  /** Token 使用 */
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface VolcengineAPIError {
  error: {
    code: string;
    message: string;
    type: string;
  };
}

// ============================================================
// RealVolcengineClient 主类
// ============================================================

export class RealVolcengineClient {
  private readonly config: Required<Omit<RealVolcengineConfig, 'fallbackProvider' | 'apiKeyManager' | 'rateLimiter' | 'onMetric' | 'fetchImpl'>> & {
    apiKeyManager: ApiKeyManager;
    rateLimiter: RateLimiter;
    fallbackProvider: EmbeddingProvider;
    onMetric?: (m: RealVolcengineMetric) => void;
    fetchImpl: typeof fetch;
  };
  private readonly listeners: Set<RealVolcengineListener> = new Set();
  private readonly stats_: RealVolcengineStats = {
    totalRequests: 0,
    successRequests: 0,
    fallbackRequests: 0,
    errorRequests: 0,
    rateLimitedRequests: 0,
    retriedRequests: 0,
    totalCostUsd: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
  };
  private latencies: number[] = [];

  constructor(config: RealVolcengineConfig = {}) {
    this.config = {
      apiKeyManager: config.apiKeyManager ?? getApiKeyManager(),
      rateLimiter: config.rateLimiter ?? createVolcengineRateLimiter(),
      fallbackProvider: config.fallbackProvider ?? new CLIPLocalProvider({ modelId: 'clip-vit-b32', dimension: 1024 } as CLIPLocalProviderConfig),
      forceFallback: config.forceFallback ?? false,
      fetchImpl: config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); }) as typeof fetch),
      baseURL: config.baseURL ?? 'https://ark.cn-beijing.volces.com/api/v3',
      model: config.model ?? 'doubao-embedding-vision',
      maxRetries: config.maxRetries ?? 3,
      retryBackoffMs: config.retryBackoffMs ?? 200,
      inputCostPerMTokens: config.inputCostPerMTokens ?? 0.0008,
      imageCostPerK: config.imageCostPerK ?? 0.002,
      timeoutMs: config.timeoutMs ?? 30000,
      onMetric: config.onMetric,
    };
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * Embedding 单个输入
   */
  async embed(input: MultimodalInput, options: { signal?: AbortSignal } = {}): Promise<RealVolcengineResponse> {
    const start = Date.now();
    this.stats_.totalRequests += 1;
    this.emit({ type: 'request', timestamp: start, provider: 'api' });

    // 1. 强制 fallback
    if (this.config.forceFallback || !this.config.apiKeyManager.hasApiKey('volcengine')) {
      return this.embedWithFallback(input, start, !this.config.apiKeyManager.hasApiKey('volcengine') ? 'no-api-key' : 'forced');
    }

    // 2. 限流检查
    const rateResult = this.config.rateLimiter.acquire(1);
    if (!rateResult.allowed) {
      this.stats_.rateLimitedRequests += 1;
      this.emit({ type: 'rate-limit', timestamp: Date.now(), provider: 'api', retryCount: 0, error: `Retry after ${rateResult.retryAfterMs}ms` });
      this.config.onMetric?.({ type: 'rate-limit', timestamp: Date.now(), error: `Retry-After: ${rateResult.retryAfterMs}ms` });
      // 触发降级
      return this.embedWithFallback(input, start, 'rate-limited');
    }

    // 3. 真实 API 调用 (含重试)
    try {
      const result = await this.callAPIWithRetry(input, options.signal);
      const latencyMs = Date.now() - start;
      this.recordSuccess(latencyMs, result.usage.totalTokens, result.cost);
      this.emit({ type: 'success', timestamp: Date.now(), provider: 'api', durationMs: latencyMs, cost: result.cost });
      this.config.onMetric?.({ type: 'success', timestamp: Date.now(), latencyMs, cost: result.cost });
      return result;
    } catch (err) {
      // 4. 错误处理
      const error = err instanceof Error ? err.message : String(err);
      this.config.rateLimiter.release(1); // 失败回滚令牌
      this.stats_.errorRequests += 1;
      this.emit({ type: 'error', timestamp: Date.now(), provider: 'api', error });
      this.config.onMetric?.({ type: 'error', timestamp: Date.now(), error });
      return this.embedWithFallback(input, start, error);
    }
  }

  /**
   * 批量 Embedding
   */
  async embedBatch(inputs: MultimodalInput[], options: { signal?: AbortSignal } = {}): Promise<RealVolcengineResponse[]> {
    return Promise.all(inputs.map((i) => this.embed(i, options)));
  }

  /**
   * 设置 API Key (便捷方法, 异步)
   */
  async setApiKey(apiKey: string, options?: { expiresAt?: number }): Promise<void> {
    await this.config.apiKeyManager.setApiKey('volcengine', apiKey, options);
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.config.apiKeyManager.hasApiKey('volcengine');
  }

  /**
   * 订阅事件
   */
  subscribe(listener: RealVolcengineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取统计
   */
  getStats(): RealVolcengineStats {
    return { ...this.stats_ };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats_.totalRequests = 0;
    this.stats_.successRequests = 0;
    this.stats_.fallbackRequests = 0;
    this.stats_.errorRequests = 0;
    this.stats_.rateLimitedRequests = 0;
    this.stats_.retriedRequests = 0;
    this.stats_.totalCostUsd = 0;
    this.stats_.totalTokens = 0;
    this.stats_.avgLatencyMs = 0;
    this.latencies = [];
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 调用真实 API (含重试)
   */
  private async callAPIWithRetry(input: MultimodalInput, signal?: AbortSignal): Promise<RealVolcengineResponse> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.stats_.retriedRequests += 1;
          const backoff = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
          this.emit({ type: 'retry', timestamp: Date.now(), provider: 'api', retryCount: attempt });
          this.config.onMetric?.({ type: 'retry', timestamp: Date.now() });
          await this.sleep(backoff);
        }
        return await this.callAPI(input, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 不重试 4xx 客户端错误 (除 429)
        if (lastError.message.includes('400') || lastError.message.includes('401') || lastError.message.includes('403')) {
          throw lastError;
        }
        if (attempt === this.config.maxRetries) {
          throw lastError;
        }
      }
    }
    throw lastError ?? new Error('Retry exhausted');
  }

  /**
   * 单次 API 调用
   */
  private async callAPI(input: MultimodalInput, signal?: AbortSignal): Promise<RealVolcengineResponse> {
    const apiKey = this.config.apiKeyManager.getApiKey('volcengine');
    if (!apiKey) {
      throw new Error('No API key configured');
    }

    const start = Date.now();
    const url = `${this.config.baseURL}/embeddings`;
    const body = this.buildRequestBody(input);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const combinedSignal = signal
      ? this.combineSignals([signal, controller.signal])
      : controller.signal;

    try {
      const response = await this.config.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: VolcengineAPIError | null = null;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // 非 JSON
        }
        const errorMessage = errorData?.error?.message ?? errorText ?? `HTTP ${response.status}`;
        throw new Error(`HTTP ${response.status}: ${errorMessage}`);
      }

      const data: VolcengineAPIResponse = await response.json();
      if (!data.data || data.data.length === 0) {
        throw new Error('Empty response data');
      }

      const embedding = data.data[0]!.embedding;
      const cost = this.calculateCost(input, data.usage);
      const latencyMs = Date.now() - start;

      return {
        embedding,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          totalTokens: data.usage.total_tokens,
        },
        cost,
        latencyMs,
        endpoint: url,
        model: data.model,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(input: MultimodalInput): Record<string, unknown> {
    // 火山方舟多模态 Embedding 支持 text + image_url
    const body: Record<string, unknown> = {
      model: this.config.model,
      encoding_format: 'float',
    };
    if (input.text && input.image) {
      body.input = [
        { type: 'text', text: input.text },
        { type: 'image_url', image_url: { url: input.image } },
      ];
    } else if (input.text) {
      body.input = input.text;
    } else if (input.image) {
      body.input = [{ type: 'image_url', image_url: { url: input.image } }];
    } else {
      throw new Error('Input must have text or image');
    }
    return body;
  }

  /**
   * 计算成本
   */
  private calculateCost(input: MultimodalInput, usage: { prompt_tokens: number; total_tokens: number }): number {
    let cost = (usage.total_tokens / 1_000_000) * this.config.inputCostPerMTokens;
    if (input.image) {
      cost += (1 / 1000) * this.config.imageCostPerK;
    }
    return Number(cost.toFixed(6));
  }

  /**
   * 使用 fallback Provider
   */
  private async embedWithFallback(input: MultimodalInput, start: number, reason: string): Promise<RealVolcengineResponse> {
    this.stats_.fallbackRequests += 1;
    this.emit({ type: 'fallback', timestamp: Date.now(), provider: 'fallback', error: reason });
    this.config.onMetric?.({ type: 'fallback', timestamp: Date.now(), error: reason });

    const embedding = await this.config.fallbackProvider.embed(input);
    const latencyMs = Date.now() - start;
    // Fallback 成本为 0 (本地)
    return {
      embedding,
      usage: { promptTokens: 0, totalTokens: 0 },
      cost: 0,
      latencyMs,
      endpoint: 'fallback',
      model: this.config.fallbackProvider.name,
    };
  }

  /**
   * 记录成功
   */
  private recordSuccess(latencyMs: number, tokens: number, cost: number): void {
    this.stats_.successRequests += 1;
    this.stats_.totalTokens += tokens;
    this.stats_.totalCostUsd += cost;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }
    this.stats_.avgLatencyMs = this.latencies.reduce((s, l) => s + l, 0) / this.latencies.length;
  }

  /**
   * 合并多个 AbortSignal
   */
  private combineSignals(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const s of signals) {
      if (s.aborted) {
        controller.abort(s.reason);
        break;
      }
      s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
    }
    return controller.signal;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private emit(event: RealVolcengineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建真实 Volcengine 客户端
 */
export function createRealVolcengineClient(config?: RealVolcengineConfig): RealVolcengineClient {
  return new RealVolcengineClient(config);
}
