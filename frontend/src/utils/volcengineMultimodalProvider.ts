/**
 * # ============================================================
 * # VolcengineMultimodalProvider - 火山方舟多模态 Embedding Provider
 * # ============================================================
 * # 核心作用：对接火山方舟多模态 Embedding API
 * #           替换占位实现，提供真实生产级多模态向量
 * # API 端点: https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal
 * # 支持模型: doubao-embedding-vision, doubao-embedding
 * # 协议: OpenAI 兼容 + 自定义 multimodal 扩展
 * # 沙箱兼容: API Key 不可用时自动降级到 CLIPLocalProvider
 * # 设计原则:
 * #   1. 真实 API 优先: 有 API Key 时调用真实服务
 * #   2. 透明降级: 失败/无 Key 时使用本地 fallback
 * #   3. 成本可控: 实时统计 token 用量和费用
 * #   4. 重试机制: 临时性错误自动重试
 * #   5. 完整事件: API 调用/重试/降级都有事件通知
 * # 对标: OpenAI CLIP API, Cohere Embed v3
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 49 G49-02 初次创建
 * # ============================================================
 */

import type { EmbeddingProvider, MultimodalInput, Modality } from './multimodalEmbedding';
import { CLIPLocalProvider } from './clipLocalProvider';

// ============ 类型定义 ============

/** 火山方舟多模态 Provider 配置 */
export interface VolcengineMultimodalConfig {
  /** API Key */
  apiKey?: string;
  /** Base URL（默认火山方舟） */
  baseURL?: string;
  /** 模型 ID（默认 doubao-embedding-vision） */
  model?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试退避基数（毫秒） */
  retryBackoffMs?: number;
  /** 强制使用 fallback（即使有 API Key） */
  forceFallback?: boolean;
  /** 自定义 fetch 实现（用于测试） */
  fetchImpl?: typeof fetch;
  /** 降级 Provider（默认 CLIPLocalProvider） */
  fallbackProvider?: EmbeddingProvider;
  /** 输入价格 (USD per 1M tokens) */
  inputCostPerMTokens?: number;
  /** 图像价格 (USD per 1K images) */
  imageCostPerK?: number;
}

/** API 统计 */
export interface VolcengineMultimodalStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  fallbackRequests: number;
  totalInputTokens: number;
  totalImages: number;
  totalDurationMs: number;
  totalRetries: number;
  totalCostUsd: number;
}

/** 火山方舟 API 响应 */
interface VolcengineMultimodalResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens?: number;
    image_tokens?: number;
    image_count?: number;
  };
}

/** 事件类型 */
export type VolcengineMultimodalEvent =
  | { type: 'api-call'; modality: Modality; model: string; at: number }
  | { type: 'api-success'; modality: Modality; durationMs: number; tokens: number; at: number }
  | { type: 'api-failure'; modality: Modality; error: string; attempt: number; at: number }
  | { type: 'fallback'; reason: string; modality: Modality; at: number }
  | { type: 'retry'; attempt: number; maxRetries: number; error: string; at: number };

export type VolcengineMultimodalListener = (event: VolcengineMultimodalEvent) => void;

// ============ 默认模型配置 ============

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-embedding-vision';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF = 1000;
const DEFAULT_INPUT_COST = 0.5; // USD per 1M tokens
const DEFAULT_IMAGE_COST = 1.0; // USD per 1K images

// ============ Provider 实现 ============

/**
 * 火山方舟多模态 Embedding Provider
 *
 * 真实 API 路径: POST /embeddings/multimodal
 * 请求体: { model, input: { text?, image? } }
 * 响应: { data: [{ embedding: number[] }], usage: {...} }
 */
export class VolcengineMultimodalProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  readonly supportedModalities: Modality[];

  private readonly config: Required<Omit<VolcengineMultimodalConfig, 'fetchImpl' | 'fallbackProvider' | 'apiKey'>> & {
    apiKey: string | undefined;
    fetchImpl: typeof fetch;
    fallbackProvider: EmbeddingProvider;
  };

  private stats: VolcengineMultimodalStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    fallbackRequests: 0,
    totalInputTokens: 0,
    totalImages: 0,
    totalDurationMs: 0,
    totalRetries: 0,
    totalCostUsd: 0,
  };

  private listeners: Set<VolcengineMultimodalListener> = new Set();
  private fallback: EmbeddingProvider;

  constructor(config: VolcengineMultimodalConfig = {}) {
    this.config = {
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? DEFAULT_BASE_URL,
      model: config.model ?? DEFAULT_MODEL,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBackoffMs: config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF,
      forceFallback: config.forceFallback ?? false,
      fetchImpl: config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (() => { throw new Error('fetch not available'); }) as unknown as typeof fetch),
      fallbackProvider: config.fallbackProvider ?? new CLIPLocalProvider({ modelId: 'clip-vit-b32' }),
      inputCostPerMTokens: config.inputCostPerMTokens ?? DEFAULT_INPUT_COST,
      imageCostPerK: config.imageCostPerK ?? DEFAULT_IMAGE_COST,
    };

    this.fallback = this.config.fallbackProvider;
    this.name = `volcengine-multimodal-${this.config.model}`;
    this.dimension = 1024; // doubao-embedding-vision 默认维度
    this.supportedModalities = ['text', 'image', 'multimodal'];
  }

  /**
   * 检查 API Key 是否可用
   */
  async isAvailable(): Promise<boolean> {
    if (this.config.forceFallback) return false;
    if (!this.config.apiKey) return false;

    // 测试 API 连接
    try {
      const result = await this.callWithRetry({
        modality: 'text',
        text: 'test',
      });
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 嵌入单个输入
   */
  async embed(input: MultimodalInput): Promise<number[]> {
    this.stats.totalRequests += 1;

    // 没有 API Key 或强制降级时直接使用 fallback
    if (!this.config.apiKey || this.config.forceFallback) {
      return this.useFallback(input, this.config.apiKey ? 'forceFallback=true' : 'no api key');
    }

    try {
      const result = await this.callWithRetry(input);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return this.useFallback(input, errorMsg);
    }
  }

  /**
   * 批量嵌入
   */
  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map((input) => this.embed(input)));
  }

  /**
   * 调用 API（含重试）
   */
  private async callWithRetry(input: MultimodalInput): Promise<number[]> {
    let lastError: string = '';
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.callAPI(input);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.emit({
          type: 'api-failure',
          modality: input.modality,
          error: lastError,
          attempt: attempt + 1,
          at: Date.now(),
        });

        if (attempt < this.config.maxRetries) {
          this.stats.totalRetries += 1;
          this.emit({
            type: 'retry',
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            error: lastError,
            at: Date.now(),
          });
          // 指数退避
          const delay = this.config.retryBackoffMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    this.stats.failedRequests += 1;
    throw new Error(`API call failed after ${this.config.maxRetries + 1} attempts: ${lastError}`);
  }

  /**
   * 调用真实 API
   */
  private async callAPI(input: MultimodalInput): Promise<number[]> {
    const startTime = Date.now();
    this.emit({
      type: 'api-call',
      modality: input.modality,
      model: this.config.model,
      at: startTime,
    });

    // 构建请求体（火山方舟 multimodal embeddings 格式）
    const requestBody: Record<string, unknown> = {
      model: this.config.model,
    };

    // 根据模态构建 input
    if (input.modality === 'text') {
      requestBody['input'] = { text: input.text ?? '' };
    } else if (input.modality === 'image') {
      requestBody['input'] = { image: input.image ?? '' };
    } else if (input.modality === 'multimodal') {
      requestBody['input'] = {
        text: input.text ?? '',
        image: input.image ?? '',
      };
    } else if (input.modality === 'audio') {
      // 音频降级为文本（API 限制）
      requestBody['input'] = { text: `[audio:${input.audio ?? ''}]` };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.config.fetchImpl(`${this.config.baseURL}/embeddings/multimodal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as VolcengineMultimodalResponse;
      const embedding = data.data[0]?.embedding;
      if (!embedding) {
        throw new Error('No embedding in response');
      }

      const durationMs = Date.now() - startTime;
      const tokens = data.usage?.total_tokens ?? 0;
      const imageCount = data.usage?.image_count ?? (input.modality === 'image' || input.modality === 'multimodal' ? 1 : 0);

      // 统计
      this.stats.successRequests += 1;
      this.stats.totalDurationMs += durationMs;
      this.stats.totalInputTokens += tokens;
      this.stats.totalImages += imageCount;

      // 成本计算
      const tokenCost = (tokens / 1_000_000) * this.config.inputCostPerMTokens;
      const imageCost = (imageCount / 1000) * this.config.imageCostPerK;
      this.stats.totalCostUsd += tokenCost + imageCost;

      this.emit({
        type: 'api-success',
        modality: input.modality,
        durationMs,
        tokens,
        at: Date.now(),
      });

      return embedding;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * 使用 fallback provider
   */
  private async useFallback(input: MultimodalInput, reason: string): Promise<number[]> {
    this.stats.fallbackRequests += 1;
    this.emit({
      type: 'fallback',
      reason,
      modality: input.modality,
      at: Date.now(),
    });
    return this.fallback.embed(input);
  }

  /**
   * 获取 API 统计
   */
  getStats(): VolcengineMultimodalStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      fallbackRequests: 0,
      totalInputTokens: 0,
      totalImages: 0,
      totalDurationMs: 0,
      totalRetries: 0,
      totalCostUsd: 0,
    };
  }

  /**
   * 订阅事件
   */
  subscribe(listener: VolcengineMultimodalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 触发事件
   */
  private emit(event: VolcengineMultimodalEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // 忽略 listener 错误
        void err;
      }
    }
  }

  /**
   * 获取当前降级 Provider
   */
  getFallbackProvider(): EmbeddingProvider {
    return this.fallback;
  }

  /**
   * 设置降级 Provider
   */
  setFallbackProvider(provider: EmbeddingProvider): void {
    this.fallback = provider;
    (this.config as { fallbackProvider: EmbeddingProvider }).fallbackProvider = provider;
  }

  /**
   * 计算单个输入的成本（估算）
   */
  estimateCost(input: MultimodalInput): { tokens: number; images: number; costUsd: number } {
    const tokens = (input.text?.length ?? 0) / 4; // 粗略估算
    const images = input.modality === 'image' || input.modality === 'multimodal' ? 1 : 0;
    const tokenCost = (tokens / 1_000_000) * this.config.inputCostPerMTokens;
    const imageCost = (images / 1000) * this.config.imageCostPerK;
    return { tokens: Math.ceil(tokens), images, costUsd: tokenCost + imageCost };
  }
}

// ============ Mock Provider（沙箱兼容）============

/**
 * Mock Volcengine Multimodal Provider
 * 用于测试和无 API Key 环境
 * 模拟真实 API 响应延迟和向量
 */
export class MockVolcengineMultimodalProvider implements EmbeddingProvider {
  readonly name: string = 'volcengine-multimodal-mock';
  readonly dimension: number = 1024;
  readonly supportedModalities: Modality[] = ['text', 'image', 'multimodal'];
  private fallback: EmbeddingProvider;

  constructor(fallbackProvider?: EmbeddingProvider) {
    this.fallback = fallbackProvider ?? new CLIPLocalProvider({ modelId: 'clip-vit-b32' });
  }

  async embed(input: MultimodalInput): Promise<number[]> {
    // 模拟 API 延迟
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.fallback.embed(input);
  }

  async embedBatch(inputs: MultimodalInput[]): Promise<number[][]> {
    return Promise.all(inputs.map((input) => this.embed(input)));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ============ 工厂函数 ============

/**
 * 创建火山方舟多模态 Provider
 * 自动检测 API Key 可用性
 */
export function createVolcengineMultimodalProvider(
  config?: VolcengineMultimodalConfig
): VolcengineMultimodalProvider {
  return new VolcengineMultimodalProvider(config);
}

/**
 * 创建 Mock Provider（用于测试）
 */
export function createMockVolcengineMultimodalProvider(
  fallbackProvider?: EmbeddingProvider
): MockVolcengineMultimodalProvider {
  return new MockVolcengineMultimodalProvider(fallbackProvider);
}
