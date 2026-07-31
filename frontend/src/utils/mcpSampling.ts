/**
 * # ============================================================
 * # MCP Sampling - 服务器主动 LLM 调用 (v1.0.0 Cycle 41 G41-03)
 * # ============================================================
 * # 核心作用：实现 MCP sampling/createMessage 协议
 * #           - 接收服务器采样请求
 * #           - 路由到 LLM Provider
 * #           - 审批流（人工介入）
 * #           - 结果回传
 * # 协议参考：MCP 2024-11-05 sampling
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-03 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';

/**
 * 采样消息角色
 */
export type SamplingRole = 'user' | 'assistant';

/**
 * 文本内容
 */
export interface SamplingTextContent {
  type: 'text';
  text: string;
  annotations?: Record<string, unknown>;
}

/**
 * 图像内容
 */
export interface SamplingImageContent {
  type: 'image';
  data: string; // base64
  mimeType: string;
  annotations?: Record<string, unknown>;
}

/**
 * 音频内容
 */
export interface SamplingAudioContent {
  type: 'audio';
  data: string; // base64
  mimeType: string;
  annotations?: Record<string, unknown>;
}

export type SamplingContent = SamplingTextContent | SamplingImageContent | SamplingAudioContent;

/**
 * 采样消息
 */
export interface SamplingMessage {
  role: SamplingRole;
  content: SamplingContent;
}

/**
 * 模型偏好
 */
export interface ModelHint {
  name?: string;
}

export interface ModelPreferences {
  hints?: ModelHint[];
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

/**
 * 包含上下文信息
 */
export interface SamplingIncludeContext {
  /** none: 不包含 | thisServer: 仅本服务器 | allServers: 全部 */
  scope: 'none' | 'thisServer' | 'allServers';
}

export interface SamplingCreateRequest {
  messages: SamplingMessage[];
  modelPreferences?: ModelPreferences;
  systemPrompt?: string;
  includeContext?: SamplingIncludeContext;
  temperature?: number;
  maxTokens: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export type SamplingStopReason = 'endTurn' | 'stopSequence' | 'maxTokens' | string;

export interface SamplingCreateResponse {
  model: string;
  stopReason?: SamplingStopReason;
  role: 'assistant';
  content: SamplingContent;
}

/**
 * 审批回调：用户可在执行前审批/拒绝
 */
export type SamplingApprover = (request: SamplingCreateRequest) => Promise<boolean>;

/**
 * LLM 执行器：将请求转换为模型响应
 */
export type SamplingExecutor = (request: SamplingCreateRequest) => Promise<SamplingCreateResponse>;

/**
 * 默认执行器：使用简单回显（仅用于开发/测试）
 */
export const defaultSamplingExecutor: SamplingExecutor = async (request) => {
  const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
  const text = lastUserMsg && lastUserMsg.content.type === 'text' ? lastUserMsg.content.text : '';
  return {
    model: 'echo',
    stopReason: 'endTurn',
    role: 'assistant',
    content: { type: 'text', text: `[echo] ${text}` },
  };
};

/**
 * 采样处理器
 */
export class SamplingHandler {
  private client: McpClient | null = null;
  private executor: SamplingExecutor;
  private approver: SamplingApprover | null = null;
  private stats = {
    total: 0,
    approved: 0,
    rejected: 0,
    errors: 0,
  };
  private history: SamplingRequestRecord[] = [];
  private maxHistory: number;
  private listeners: Set<SamplingEventListener> = new Set();

  constructor(options: {
    executor?: SamplingExecutor;
    approver?: SamplingApprover | null;
    maxHistory?: number;
  } = {}) {
    this.executor = options.executor ?? defaultSamplingExecutor;
    this.approver = options.approver ?? null;
    this.maxHistory = options.maxHistory ?? 100;
  }

  /**
   * 绑定客户端
   */
  attachClient(client: McpClient | null): void {
    this.client = client;
  }

  /**
   * 设置执行器
   */
  setExecutor(executor: SamplingExecutor): void {
    this.executor = executor;
  }

  /**
   * 设置审批器
   */
  setApprover(approver: SamplingApprover | null): void {
    this.approver = approver;
  }

  /**
   * 处理采样请求（供 McpClient 调用）
   */
  async handle(request: SamplingCreateRequest): Promise<SamplingCreateResponse> {
    this.stats.total += 1;
    const at = Date.now();

    this.emit({ type: 'request', request, at });

    // 审批
    if (this.approver) {
      let approved: boolean;
      try {
        approved = await this.approver(request);
      } catch (err) {
        this.stats.errors += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        this.recordHistory({ request, at, status: 'error', error });
        this.emit({ type: 'error', request, error, at });
        throw error;
      }
      if (!approved) {
        this.stats.rejected += 1;
        this.recordHistory({ request, at, status: 'rejected' });
        this.emit({ type: 'rejected', request, at });
        throw new Error('Sampling request rejected by approver');
      }
      this.stats.approved += 1;
      this.emit({ type: 'approved', request, at });
    }

    // 执行
    try {
      const response = await this.executor(request);
      this.recordHistory({ request, at, status: 'completed', response });
      this.emit({ type: 'completed', request, response, at });
      return response;
    } catch (err) {
      this.stats.errors += 1;
      const error = err instanceof Error ? err : new Error(String(err));
      this.recordHistory({ request, at, status: 'error', error });
      this.emit({ type: 'error', request, error, at });
      throw error;
    }
  }

  /**
   * 主动创建消息（不通过服务器请求）
   * 通过 McpClient.createSamplingMessage 公共方法调用
   */
  async createMessage(request: SamplingCreateRequest): Promise<SamplingCreateResponse> {
    if (!this.client) {
      throw new Error('No client attached');
    }
    // 转换为 McpClient.createSamplingMessage 接受的格式
    const clientRequest = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content as
          | { type: 'text'; text: string }
          | { type: 'image'; data: string; mimeType: string }
          | { type: 'audio'; data: string; mimeType: string },
      })),
      maxTokens: request.maxTokens,
      ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.modelPreferences
        ? {
            modelPreferences: {
              ...(request.modelPreferences.hints ? { hints: request.modelPreferences.hints } : {}),
              ...(request.modelPreferences.costPriority !== undefined
                ? { costPriority: request.modelPreferences.costPriority }
                : {}),
              ...(request.modelPreferences.speedPriority !== undefined
                ? { speedPriority: request.modelPreferences.speedPriority }
                : {}),
              ...(request.modelPreferences.intelligencePriority !== undefined
                ? { intelligencePriority: request.modelPreferences.intelligencePriority }
                : {}),
            },
          }
        : {}),
      ...(request.stopSequences ? { stopSequences: request.stopSequences } : {}),
    };
    const response = await this.client.createSamplingMessage(clientRequest);
    return {
      model: response.model,
      ...(response.stopReason !== undefined ? { stopReason: response.stopReason as SamplingStopReason } : {}),
      role: 'assistant',
      content: response.content as SamplingContent,
    };
  }

  /**
   * 订阅采样事件
   */
  on(listener: SamplingEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 获取历史
   */
  getHistory(): SamplingRequestRecord[] {
    return [...this.history];
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.history = [];
    this.listeners.clear();
    this.client = null;
  }

  // ============ 私有方法 ============

  private recordHistory(record: SamplingRequestRecord): void {
    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  private emit(event: SamplingEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 采样事件
 */
export type SamplingEvent =
  | { type: 'request'; request: SamplingCreateRequest; at: number }
  | { type: 'approved'; request: SamplingCreateRequest; at: number }
  | { type: 'rejected'; request: SamplingCreateRequest; at: number }
  | { type: 'completed'; request: SamplingCreateRequest; response: SamplingCreateResponse; at: number }
  | { type: 'error'; request: SamplingCreateRequest; error: Error; at: number };

export type SamplingEventListener = (event: SamplingEvent) => void;

/**
 * 采样历史记录
 */
export interface SamplingRequestRecord {
  request: SamplingCreateRequest;
  at: number;
  status: 'completed' | 'rejected' | 'error';
  response?: SamplingCreateResponse;
  error?: Error;
}

/**
 * 创建采样处理器
 */
export function createSamplingHandler(options: {
  executor?: SamplingExecutor;
  approver?: SamplingApprover | null;
  maxHistory?: number;
} = {}): SamplingHandler {
  return new SamplingHandler(options);
}
