/**
 * # ============================================================
 * # Best-of-N Multi-Model Types (v1.0.0 Cycle 19 G19-02)
 * # ============================================================
 * # 共享类型定义：候选 / 请求 / 结果 / 事件 / 模型信息 / 成本
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-02 初次创建
 * # ============================================================
 */

/**
 * 候选状态
 */
export type CandidateStatus =
  | 'pending'
  | 'running'
  | 'streaming'
  | 'done'
  | 'failed'
  | 'cancelled';

/**
 * 单个模型候选
 */
export interface BestOfNCandidate {
  id: string;
  model: string;
  status: CandidateStatus;
  text: string;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  inputTokens: number;
  outputTokens: number;
  cost: number; // 元
  error?: string;
}

/**
 * Best-of-N 请求
 */
export interface BestOfNRequest {
  prompt: string;
  system?: string;
  models: string[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Best-of-N 结果
 */
export interface BestOfNResult {
  taskId: string;
  candidates: BestOfNCandidate[];
  totalDuration: number;
  totalCost: number;
  successCount: number;
  failureCount: number;
}

/**
 * Best-of-N 事件
 */
export type BestOfNEvent =
  | { type: 'start'; taskId: string; model: string; timestamp: number }
  | { type: 'delta'; taskId: string; model: string; text: string }
  | { type: 'done'; taskId: string; candidate: BestOfNCandidate }
  | { type: 'error'; taskId: string; model: string; error: string }
  | { type: 'all-complete'; taskId: string; result: BestOfNResult };

/**
 * 事件类型
 */
export type BestOfNEventType = BestOfNEvent['type'];

/**
 * 事件处理器
 */
export type BestOfNEventHandler = (event: BestOfNEvent) => void;

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'custom';
  maxInputTokens: number;
  maxOutputTokens: number;
  pricing: {
    inputPer1k: number;  // 元 / 1k tokens
    outputPer1k: number;
  };
  capabilities: ('chat' | 'code' | 'vision' | 'function-call')[];
}

/**
 * 成本估算
 */
export interface CostEstimate {
  total: number;
  perModel: Record<string, number>;
}

/**
 * 比较表行
 */
export interface ComparisonRow {
  model: string;
  status: CandidateStatus;
  duration: number;
  outputTokens: number;
  cost: number;
  textLength: number;
  hasCode: boolean;
  hasMarkdown: boolean;
  score?: number;
}

/**
 * 预置模型列表（含定价）
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPer1k: 0.021, outputPer1k: 0.105 },
    capabilities: ['chat', 'code', 'vision', 'function-call'],
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPer1k: 0.035, outputPer1k: 0.105 },
    capabilities: ['chat', 'code', 'vision', 'function-call'],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    maxInputTokens: 128000,
    maxOutputTokens: 8192,
    pricing: { inputPer1k: 0.018, outputPer1k: 0.072 },
    capabilities: ['chat', 'code', 'vision', 'function-call'],
  },
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    provider: 'deepseek',
    maxInputTokens: 128000,
    maxOutputTokens: 8192,
    pricing: { inputPer1k: 0.0019, outputPer1k: 0.0077 },
    capabilities: ['chat', 'code'],
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    maxInputTokens: 1000000,
    maxOutputTokens: 8192,
    pricing: { inputPer1k: 0.0007, outputPer1k: 0.0028 },
    capabilities: ['chat', 'code', 'vision', 'function-call'],
  },
];

/**
 * 模型定价快速查询
 */
const PRICING_MAP: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4.5': { input: 0.021 / 1000, output: 0.105 / 1000 },
  'gpt-5': { input: 0.035 / 1000, output: 0.105 / 1000 },
  'gpt-4o': { input: 0.018 / 1000, output: 0.072 / 1000 },
  'deepseek-v3.2': { input: 0.0019 / 1000, output: 0.0077 / 1000 },
  'gemini-2.0-flash': { input: 0.0007 / 1000, output: 0.0028 / 1000 },
};

/**
 * 计算成本（元）
 */
export function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = PRICING_MAP[model];
  if (!pricing) return 0;
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

/**
 * 估算 token 数
 */
export function estimateTokens(text: string): number {
  // 中文字符 1:1.5, 英文单词 1:1.3, 其他 1:1
  let count = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      count += 1.5;
    } else if (/[a-zA-Z]/.test(char)) {
      count += 0.4;
    } else {
      count += 1;
    }
  }
  return Math.ceil(count);
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
