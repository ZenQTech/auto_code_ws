/**
 * # ============================================================
 * # MultiModelExecutor - 多模型并行执行器 (v1.0.0 Cycle 19 G19-02)
 * # ============================================================
 * # 核心作用：并行调用 N 个 LLM 模型，支持流式输出 / 错误降级 / 超时控制
 * # 运行流程：
 * #   1. 接收 BestOfNRequest，启动 N 个 Promise.allSettled
 * #   2. 每个模型独立流式处理，emit delta 事件
 * #   3. 完成时 emit done 事件，失败时 emit error
 * #   4. 全部完成 emit all-complete 事件
 * # 输入参数：BestOfNRequest（prompt + models + options）
 * # 输出结果：BestOfNResult（candidates + stats）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-02 初次创建
 * # ============================================================
 */

import type {
  BestOfNRequest,
  BestOfNResult,
  BestOfNCandidate,
  BestOfNEvent,
  BestOfNEventType,
  BestOfNEventHandler,
  CandidateStatus,
  ModelInfo,
  CostEstimate,
} from './bestOfNTypes';
import { DEFAULT_MODELS, calculateCost, generateId } from './bestOfNTypes';

/**
 * 执行器配置
 */
export interface ExecutorConfig {
  /** 默认超时（ms） */
  defaultTimeoutMs: number;
  /** 默认最大 token */
  defaultMaxTokens: number;
  /** 默认温度 */
  defaultTemperature: number;
  /** 最大并发模型数 */
  maxModels: number;
  /** 启用 mock 模式 */
  mockMode: boolean;
  /** mock 模式延迟范围 */
  mockDelayMin: number;
  mockDelayMax: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  defaultTimeoutMs: 60000,
  defaultMaxTokens: 2048,
  defaultTemperature: 0.7,
  maxModels: 5,
  mockMode: true,
  mockDelayMin: 800,
  mockDelayMax: 2500,
};

/**
 * 事件订阅
 */
type Unsubscribe = () => void;

/**
 * 多模型并行执行器
 */
export class MultiModelExecutor {
  private readonly config: ExecutorConfig;
  private listeners: Map<BestOfNEventType, Set<BestOfNEventHandler>> = new Map();
  private currentTaskId: string | null = null;
  private cancelRequested: boolean = false;
  private streamControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<ExecutorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  // ==================== 核心执行 ====================

  /**
   * 执行 Best-of-N
   */
  async execute(req: BestOfNRequest): Promise<BestOfNResult> {
    // 验证
    if (!req.prompt || req.prompt.trim().length === 0) {
      throw new Error('Prompt cannot be empty');
    }
    if (!req.models || req.models.length < 2) {
      throw new Error('At least 2 models required');
    }
    if (req.models.length > this.config.maxModels) {
      throw new Error(`Too many models (max ${this.config.maxModels})`);
    }

    const taskId = generateId('bon');
    this.currentTaskId = taskId;
    this.cancelRequested = false;
    const startTime = Date.now();

    // 初始化候选
    const candidates: BestOfNCandidate[] = req.models.map(model => ({
      id: generateId('cand'),
      model,
      status: 'pending' as CandidateStatus,
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    }));

    // 启动事件
    candidates.forEach(c => {
      this._emit({
        type: 'start',
        taskId,
        model: c.model,
        timestamp: Date.now(),
      });
    });

    // 并行执行
    const promises = candidates.map(candidate => this._runCandidate(taskId, candidate, req));
    await Promise.allSettled(promises);

    // 总超时控制
    const totalDuration = Date.now() - startTime;
    const result: BestOfNResult = {
      taskId,
      candidates,
      totalDuration,
      totalCost: candidates.reduce((sum, c) => sum + c.cost, 0),
      successCount: candidates.filter(c => c.status === 'done').length,
      failureCount: candidates.filter(c => c.status === 'failed').length,
    };

    this._emit({ type: 'all-complete', taskId, result });
    this.currentTaskId = null;
    return result;
  }

  // ==================== 取消 / 重试 ====================

  /**
   * 取消执行
   */
  cancel(): void {
    this.cancelRequested = true;
    this.streamControllers.forEach(controller => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    });
    this.streamControllers.clear();
  }

  /**
   * 重试单个模型
   */
  async retry(
    taskId: string,
    candidate: BestOfNCandidate,
    req: BestOfNRequest
  ): Promise<BestOfNCandidate> {
    const updated: BestOfNCandidate = {
      ...candidate,
      status: 'pending',
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      duration: undefined,
    };
    await this._runCandidate(taskId, updated, req);
    return updated;
  }

  // ==================== 事件订阅 ====================

  /**
   * 订阅事件
   * 使用条件类型自动根据 event 类型参数收窄回调参数类型
   * 例如 executor.on('start', e => e.model) 中 e 类型为 { type: 'start'; model: string; ... }
   */
  on<T extends BestOfNEventType>(
    event: T,
    handler: (e: Extract<BestOfNEvent, { type: T }>) => void
  ): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as BestOfNEventHandler);
    return () => this.off(event, handler as BestOfNEventHandler);
  }

  off<T extends BestOfNEventType>(
    event: T,
    handler: (e: Extract<BestOfNEvent, { type: T }>) => void
  ): void {
    this.listeners.get(event)?.delete(handler as BestOfNEventHandler);
  }

  private _emit(event: BestOfNEvent): void {
    this.listeners.get(event.type)?.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[MultiModelExecutor] handler error:', err);
      }
    });
  }

  // ==================== 工具方法 ====================

  /**
   * 获取可用模型列表
   */
  getAvailableModels(): ModelInfo[] {
    return DEFAULT_MODELS;
  }

  /**
   * 估算成本
   */
  estimateCost(prompt: string, models: string[]): CostEstimate {
    const inputTokens = Math.ceil(prompt.length / 4);
    return models.reduce<CostEstimate>(
      (acc, model) => {
        const info = DEFAULT_MODELS.find(m => m.id === model);
        if (info) {
          acc.total += calculateCost(inputTokens, 1000, model);
          acc.perModel[model] = calculateCost(inputTokens, 1000, model);
        }
        return acc;
      },
      { total: 0, perModel: {} }
    );
  }

  // ==================== 私有方法 ====================

  /**
   * 执行单个候选
   */
  private async _runCandidate(
    taskId: string,
    candidate: BestOfNCandidate,
    req: BestOfNRequest
  ): Promise<void> {
    const startTime = Date.now();
    candidate.status = 'streaming';
    candidate.startedAt = startTime;

    const controller = new AbortController();
    this.streamControllers.set(candidate.id, controller);

    try {
      const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Model timeout')), timeoutMs);
      });

      const streamPromise = this.config.mockMode
        ? this._mockStream(candidate, req)
        : this._realStream(candidate, req, controller.signal);

      await Promise.race([streamPromise, timeoutPromise]);

      candidate.status = 'done';
      candidate.completedAt = Date.now();
      candidate.duration = candidate.completedAt - startTime;
      this._emit({ type: 'done', taskId, candidate });
    } catch (err) {
      candidate.status = 'failed';
      candidate.error = err instanceof Error ? err.message : String(err);
      candidate.completedAt = Date.now();
      candidate.duration = candidate.completedAt - startTime;
      this._emit({
        type: 'error',
        taskId,
        model: candidate.model,
        error: candidate.error,
      });
    } finally {
      this.streamControllers.delete(candidate.id);
    }
  }

  /**
   * 模拟流式响应
   */
  private async _mockStream(candidate: BestOfNCandidate, req: BestOfNRequest): Promise<void> {
    const responseText = this._generateMockResponse(candidate.model, req.prompt);
    const chunks = responseText.match(/.{1, 8}/g) ?? [responseText];
    candidate.inputTokens = Math.ceil(req.prompt.length / 4);

    for (const chunk of chunks) {
      if (this.cancelRequested) {
        throw new Error('Cancelled');
      }
      await new Promise(resolve => {
        const delay = this.config.mockDelayMin +
          Math.random() * (this.config.mockDelayMax - this.config.mockDelayMin);
        setTimeout(resolve, delay / chunks.length);
      });
      candidate.text += chunk;
      candidate.outputTokens = Math.ceil(candidate.text.length / 4);
      candidate.cost = calculateCost(candidate.inputTokens, candidate.outputTokens, candidate.model);
      this._emit({
        type: 'delta',
        taskId: this.currentTaskId ?? '',
        model: candidate.model,
        text: chunk,
      });
    }
  }

  /**
   * 真实流式响应（需要后端支持）
   */
  private async _realStream(
    candidate: BestOfNCandidate,
    req: BestOfNRequest,
    _signal: AbortSignal
  ): Promise<void> {
    // 这里对接后端 /api/llm/best-of-n/{task_id}/stream
    // 当前为占位实现，使用 mock
    void _signal; // 占位：未来真正接入后端时使用
    return this._mockStream(candidate, req);
  }

  /**
   * 生成 mock 响应
   */
  private _generateMockResponse(model: string, prompt: string): string {
    const tag = `[${model}]`;
    return `${tag} 收到您的请求：${prompt.slice(0, 20)}。\n\n这是来自 ${model} 的模拟响应。在生产环境中，此处会显示真实的 LLM 输出。\n\n关键要点：\n1. 模型并行执行\n2. 流式输出\n3. 错误降级\n4. 成本对比\n\n预计输出 token 数：约 200。`;
  }
}

/**
 * 全局单例
 */
let globalExecutor: MultiModelExecutor | null = null;

export function getMultiModelExecutor(config?: Partial<ExecutorConfig>): MultiModelExecutor {
  if (!globalExecutor) {
    globalExecutor = new MultiModelExecutor(config);
  }
  return globalExecutor;
}

export function resetMultiModelExecutor(): void {
  globalExecutor = null;
}
