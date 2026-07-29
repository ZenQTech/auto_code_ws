/**
 * # ============================================================
 * useLlmJudgeApi - LLM-as-Judge 验证层 API 客户端
 * # ============================================================
 * 核心作用：封装 /api/llm_judge 端点调用
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0 (Cycle 13 P1-2)
 * 修改记录：
 *   - 2026-07-28 | v1.0.0 | 新建
 * ============================================================
 */

const API_BASE = '/api';
const JUDGE_BASE = `${API_BASE}/llm-judge`;

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${JUDGE_BASE}${path}`;
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ============================================================
// 类型定义
// ============================================================
export type Dimension =
  | 'correctness'
  | 'style'
  | 'safety'
  | 'performance'
  | 'maintainability';

export type JudgeTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'vetoed'
  | 'cancelled';

export type ConsensusStrategy =
  | 'weighted_average'
  | 'majority_vote'
  | 'strict_unanimous';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type Domain =
  | 'general'
  | 'backend'
  | 'frontend'
  | 'database'
  | 'security'
  | 'performance'
  | 'testing'
  | 'docs';

export type AdapterType = 'mock' | 'claude' | 'gpt' | 'gemini' | 'custom';

export interface JudgeScore {
  correctness: number;
  style: number;
  safety: number;
  performance: number;
  maintainability: number;
}

export interface JudgeInfo {
  judge_id: string;
  name: string;
  model: string;
  weight: number;
  adapter: string;
  enabled: boolean;
  specialties: string[];
  total_runs: number;
  total_failures: number;
  avg_latency_ms: number;
  created_at: string;
}

export interface JudgeReport {
  report_id: string;
  task_id: string;
  judge_id: string;
  judge_name: string;
  model: string;
  scores: JudgeScore;
  overall_pass: boolean;
  overall_score: number;
  issues: string[];
  suggestions: string[];
  latency_ms: number;
  raw_response: string;
  created_at: string;
  error: string;
}

export interface JudgeConsensus {
  consensus_id: string;
  task_id: string;
  aggregated_scores: JudgeScore;
  overall_pass: boolean;
  overall_score: number;
  divergence: Record<string, number>;
  needs_review: boolean;
  safety_veto: boolean;
  judge_count: number;
  strategy: string;
  created_at: string;
}

export interface JudgeTask {
  task_id: string;
  task_description: string;
  code_diff: string;
  test_results: string;
  context: Record<string, any>;
  rubric: string[];
  difficulty: string;
  domain: string;
  use_consensus: boolean;
  metadata: Record<string, any>;
  status: string;
  created_at: string;
  started_at: string;
  completed_at: string;
  error: string;
  reports: JudgeReport[];
  consensus: JudgeConsensus | null;
  tags: string[];
}

export interface JudgeStats {
  pool_stats: {
    total_judges: number;
    enabled_judges: number;
    adapters: Record<string, number>;
  };
  store_stats: {
    total_tasks: number;
    by_status: Record<string, number>;
    consensus_count: number;
    vetoed_count: number;
  };
}

export interface JudgeHealth {
  success: boolean;
  service: string;
  version: string;
  total_judges: number;
  enabled_judges: number;
  pool_stats: any;
}

// ============================================================
// API 函数
// ============================================================

/** 健康检查 */
export async function fetchHealth(): Promise<JudgeHealth> {
  return apiFetch('/health');
}

/** 提交 Judge 任务（同步） */
export async function submitTask(payload: {
  task_description: string;
  code_diff: string;
  test_results?: string;
  rubric?: string[];
  difficulty?: Difficulty;
  domain?: Domain;
  use_consensus?: boolean;
  consensus_strategy?: ConsensusStrategy;
  tags?: string[];
  context?: Record<string, any>;
  metadata?: Record<string, any>;
  execute_sync?: boolean;
}): Promise<{ success: boolean; task: JudgeTask; verifier_result?: any }> {
  return apiFetch('/judge', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 列出任务 */
export async function listTasks(
  status?: JudgeTaskStatus,
  limit: number = 50
): Promise<{ success: boolean; count: number; tasks: JudgeTask[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  return apiFetch(`/tasks?${params.toString()}`);
}

/** 获取任务详情 */
export async function getTask(taskId: string): Promise<{ success: boolean; task: JudgeTask }> {
  return apiFetch(`/tasks/${taskId}`);
}

/** 取消任务 */
export async function cancelTask(taskId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/tasks/${taskId}/cancel`, { method: 'POST' });
}

/** 列出 Judge */
export async function listJudges(
  enabledOnly: boolean = false
): Promise<{ success: boolean; count: number; judges: JudgeInfo[] }> {
  const params = new URLSearchParams();
  params.set('enabled_only', String(enabledOnly));
  return apiFetch(`/pool/judges?${params.toString()}`);
}

/** 注册 Judge */
export async function registerJudge(payload: {
  name: string;
  model: string;
  weight?: number;
  adapter: AdapterType;
  specialties?: string[];
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; judge: JudgeInfo }> {
  return apiFetch('/pool/judges', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 启用/禁用 Judge */
export async function setJudgeEnabled(
  judgeId: string,
  enabled: boolean
): Promise<{ success: boolean; judge: JudgeInfo }> {
  return apiFetch(`/pool/judges/${judgeId}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
  });
}

/** 获取统计 */
export async function fetchStats(): Promise<{ success: boolean; data: JudgeStats }> {
  return apiFetch('/stats');
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取维度的颜色 */
export function getDimensionColor(score: number): string {
  if (score >= 8) return 'text-green-600 bg-green-50 border-green-200';
  if (score >= 6) return 'text-blue-600 bg-blue-50 border-blue-200';
  if (score >= 4) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

/** 获取状态颜色 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-600 bg-green-50 border-green-200';
    case 'failed':
    case 'vetoed':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'running':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'cancelled':
      return 'text-gray-600 bg-gray-50 border-gray-200';
    default:
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  }
}

/** 维度说明 */
export const DIMENSION_DESC: Record<Dimension, string> = {
  correctness: '代码是否正确实现任务',
  style: '是否遵循项目编码规范',
  safety: '是否存在注入/溢出等安全问题',
  performance: '性能表现（避免 O(n³) 等）',
  maintainability: '可读性与可维护性',
};

export const ALL_DIMENSIONS: Dimension[] = [
  'correctness',
  'style',
  'safety',
  'performance',
  'maintainability',
];

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const DOMAINS: Domain[] = [
  'general',
  'backend',
  'frontend',
  'database',
  'security',
  'performance',
  'testing',
  'docs',
];

export const CONSENSUS_STRATEGIES: ConsensusStrategy[] = [
  'weighted_average',
  'majority_vote',
  'strict_unanimous',
];

export const ADAPTERS: AdapterType[] = ['mock', 'claude', 'gpt', 'gemini', 'custom'];
