/**
 * # ============================================================
 * # useGoalAutomationApi - Goal 自动轮转 + 多 Agent 委派 API 客户端
 * # ============================================================
 * # 核心作用：封装 Cycle 14 P1-4 全部 REST 端点
 * #   1. Auto-Turn Engine - 5 触发器 + 3 策略 + 暂停/恢复
 * #   2. Agent Registry - 7 角色 + 健康监控 + 负载分布
 * #   3. Multi-Agent Delegation - 委派决策 + 故障转移 + 完成回调
 * # 运行流程：
 * #   1. 组件调用 registerGoal / listAgents / delegate
 * #   2. 后端返回结果，前端保存到状态
 * #   3. 失败时抛出 Error 供组件 catch
 * # 输入参数：通过方法参数传递 API 端点和数据
 * # 输出结果：统一的 Promise<ApiResponse> 返回值
 * # 修改记录：
 * #   - 2026-07-28 | v6.32.0 | Cycle 14 P1-4 初始版本
 * # ============================================================
 */

import { useState } from 'react';
import { API_BASE, apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

export type TurnStrategy = 'conservative' | 'standard' | 'aggressive';
export type TurnTrigger =
  | 'time_based'
  | 'ac_completed'
  | 'token_budget'
  | 'manual'
  | 'external';
export type TurnState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'failed';
export type AgentRole =
  | 'architect'
  | 'implementer'
  | 'verifier'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'orchestrator';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ACType =
  | 'implementation'
  | 'verification'
  | 'review'
  | 'testing'
  | 'documentation'
  | 'architecture'
  | 'integration'
  | 'unknown';
export type DelegationDecision =
  | 'delegated'
  | 'queued'
  | 'failed'
  | 'rejected';
export type AgentStatus = 'available' | 'busy' | 'offline';

export interface TurnConfig {
  goal_id: string;
  strategy: TurnStrategy;
  interval_seconds: number;
  max_turns: number;
  auto_verify: boolean;
  auto_progress: boolean;
  triggers: TurnTrigger[];
  enabled: boolean;
}

export interface TurnRecord {
  turn_id: string;
  goal_id: string;
  turn_number: number;
  strategy: TurnStrategy;
  state: TurnState;
  trigger: TurnTrigger;
  ac_processed: string[];
  ac_passed: string[];
  ac_failed: string[];
  agents_used: string[];
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  error: string | null;
  notes: string;
}

export interface ActiveGoal {
  goal_id: string;
  state: TurnState;
  strategy: TurnStrategy;
  turn_count: number;
  max_turns: number;
  interval_seconds: number;
  auto_verify: boolean;
  auto_progress: boolean;
  last_turn_at: string | null;
  enabled: boolean;
}

export interface AgentSpec {
  agent_id: string;
  role: AgentRole;
  name: string;
  capabilities: string[];
  risk_levels: RiskLevel[];
  max_load: number;
  current_load: number;
  total_tasks: number;
  success_count: number;
  failure_count: number;
  status: AgentStatus;
  last_heartbeat: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface DelegationRequest {
  goal_id: string;
  ac_id: string;
  ac_title?: string;
  ac_type?: ACType | null;
  risk_level?: RiskLevel;
  required_capabilities?: string[];
  priority?: number;
  context?: Record<string, unknown>;
}

export interface DelegationResult {
  delegation_id: string;
  goal_id: string;
  ac_id: string;
  ac_type: ACType;
  risk_level: RiskLevel;
  agent_id: string;
  agent_role: AgentRole | '';
  decision: DelegationDecision;
  reason: string;
  fallback_attempts: string[];
  created_at: string;
  completed_at: string | null;
  output: Record<string, unknown>;
}

export interface LoadDistribution {
  total_agents: number;
  by_role: Partial<Record<AgentRole, number>>;
  by_status: Partial<Record<AgentStatus, number>>;
  avg_load: number;
}

export interface AutoTurnStats {
  total_goals: number;
  total_turns: number;
  passed_acs: number;
  failed_acs: number;
  state_distribution: Record<string, number>;
  storage_dir: string;
}

export interface DelegationStats {
  total_agents: number;
  total_delegations: number;
  delegated: number;
  queued: number;
  failed: number;
  rejected: number;
  completed: number;
  load_distribution: LoadDistribution;
}

export interface GoalAutomationStats {
  success: boolean;
  auto_turn: AutoTurnStats;
  delegation: DelegationStats;
}

// ============================================================
// 常量
// ============================================================

const GOAL_API_BASE = `${API_BASE}/goal-automation`;

/** 策略展示信息 */
export const STRATEGY_OPTIONS: Array<{
  value: TurnStrategy;
  label: string;
  description: string;
  color: string;
}> = [
  {
    value: 'conservative',
    label: '🛡️ 保守',
    description: '每个 AC 验证后再下一步',
    color: 'text-blue-600',
  },
  {
    value: 'standard',
    label: '⚡ 标准',
    description: '批量推进，平衡速度与稳定',
    color: 'text-violet-600',
  },
  {
    value: 'aggressive',
    label: '🚀 激进',
    description: '最大化并行执行',
    color: 'text-pink-600',
  },
];

/** 角色展示信息 */
export const ROLE_OPTIONS: Array<{
  value: AgentRole;
  label: string;
  icon: string;
  color: string;
}> = [
  { value: 'architect', label: '架构师', icon: '🏛️', color: 'text-purple-600' },
  { value: 'implementer', label: '实施者', icon: '🔨', color: 'text-blue-600' },
  { value: 'verifier', label: '验证者', icon: '✅', color: 'text-green-600' },
  { value: 'reviewer', label: '审查者', icon: '👁️', color: 'text-orange-600' },
  { value: 'tester', label: '测试者', icon: '🧪', color: 'text-cyan-600' },
  { value: 'documenter', label: '文档者', icon: '📝', color: 'text-yellow-600' },
  { value: 'orchestrator', label: '编排者', icon: '🎼', color: 'text-pink-600' },
];

/** 风险等级展示信息 */
export const RISK_OPTIONS: Array<{
  value: RiskLevel;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}> = [
  { value: 'low', label: '低', icon: '🟢', color: 'text-green-700', bgColor: 'bg-green-50' },
  { value: 'medium', label: '中', icon: '🟡', color: 'text-yellow-700', bgColor: 'bg-yellow-50' },
  { value: 'high', label: '高', icon: '🟠', color: 'text-orange-700', bgColor: 'bg-orange-50' },
  { value: 'critical', label: '严重', icon: '🔴', color: 'text-red-700', bgColor: 'bg-red-50' },
];

/** 状态展示信息 */
export const STATE_OPTIONS: Record<TurnState, { label: string; color: string; bgColor: string }> = {
  idle: { label: '空闲', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  running: { label: '运行中', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  paused: { label: '已暂停', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  stopped: { label: '已停止', color: 'text-gray-500', bgColor: 'bg-gray-200' },
  completed: { label: '已完成', color: 'text-green-700', bgColor: 'bg-green-100' },
  failed: { label: '失败', color: 'text-red-700', bgColor: 'bg-red-100' },
};

/** 委派决策展示信息 */
export const DECISION_OPTIONS: Record<
  DelegationDecision,
  { label: string; color: string; icon: string }
> = {
  delegated: { label: '已委派', color: 'text-green-700', icon: '✅' },
  queued: { label: '排队中', color: 'text-yellow-700', icon: '⏳' },
  failed: { label: '失败', color: 'text-red-700', icon: '❌' },
  rejected: { label: '已拒绝', color: 'text-gray-700', icon: '🚫' },
};

/** AC 类型展示信息 */
export const AC_TYPE_OPTIONS: Array<{ value: ACType; label: string; icon: string }> = [
  { value: 'implementation', label: '实施', icon: '🔨' },
  { value: 'verification', label: '验证', icon: '✅' },
  { value: 'review', label: '审查', icon: '👁️' },
  { value: 'testing', label: '测试', icon: '🧪' },
  { value: 'documentation', label: '文档', icon: '📝' },
  { value: 'architecture', label: '架构', icon: '🏛️' },
  { value: 'integration', label: '集成', icon: '🔗' },
  { value: 'unknown', label: '未知', icon: '❓' },
];

// ============================================================
// Auto-Turn API
// ============================================================

export async function getHealth(): Promise<{ status: string; version: string; module: string; components: Record<string, string> }> {
  return apiFetch(`/goal-automation/health`);
}

export async function getStats(): Promise<GoalAutomationStats> {
  return apiFetch(`/goal-automation/stats`);
}

export async function listActiveGoals(): Promise<{ success: boolean; goals: ActiveGoal[] }> {
  return apiFetch(`/goal-automation/goals`);
}

export async function registerGoalConfig(
  config: TurnConfig,
): Promise<{ success: boolean; goal_id: string; config: TurnConfig; state: TurnState }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(config.goal_id)}/auto-turn/config`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getGoalConfig(
  goalId: string,
): Promise<{ success: boolean; goal_id: string; config: TurnConfig; state: TurnState }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/config`);
}

export async function unregisterGoalConfig(goalId: string): Promise<{ success: boolean; goal_id: string; unregistered: boolean }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/config`, {
    method: 'DELETE',
  });
}

export async function triggerTurn(
  goalId: string,
  trigger: TurnTrigger = 'manual',
  maxAcPerTurn?: number,
): Promise<{ success: boolean; turn_record: TurnRecord }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/trigger`, {
    method: 'POST',
    body: JSON.stringify({ trigger, max_ac_per_turn: maxAcPerTurn ?? null }),
  });
}

export async function pauseGoal(goalId: string): Promise<{ success: boolean; goal_id: string; state: TurnState }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/pause`, {
    method: 'POST',
  });
}

export async function resumeGoal(goalId: string): Promise<{ success: boolean; goal_id: string; state: TurnState }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/resume`, {
    method: 'POST',
  });
}

export async function stopGoal(goalId: string): Promise<{ success: boolean; goal_id: string; state: TurnState }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/stop`, {
    method: 'POST',
  });
}

export async function getTurnHistory(
  goalId: string,
  limit: number = 50,
): Promise<{ success: boolean; goal_id: string; count: number; history: TurnRecord[] }> {
  return apiFetch(`/goal-automation/goals/${encodeURIComponent(goalId)}/auto-turn/history?limit=${limit}`);
}

// ============================================================
// Agent API
// ============================================================

export async function registerAgent(
  spec: Omit<AgentSpec, 'current_load' | 'total_tasks' | 'success_count' | 'failure_count' | 'status' | 'last_heartbeat' | 'created_at'>,
): Promise<{ success: boolean; agent: AgentSpec }> {
  return apiFetch(`/goal-automation/agents`, {
    method: 'POST',
    body: JSON.stringify(spec),
  });
}

export async function listAgents(
  role?: AgentRole,
  status?: AgentStatus,
): Promise<{ success: boolean; count: number; agents: AgentSpec[] }> {
  const params = new URLSearchParams();
  if (role) params.append('role', role);
  if (status) params.append('status', status);
  const qs = params.toString();
  return apiFetch(`/goal-automation/agents${qs ? '?' + qs : ''}`);
}

export async function getAgent(agentId: string): Promise<{ success: boolean; agent: AgentSpec }> {
  return apiFetch(`/goal-automation/agents/${encodeURIComponent(agentId)}`);
}

export async function unregisterAgent(agentId: string): Promise<{ success: boolean; agent_id: string; unregistered: boolean }> {
  return apiFetch(`/goal-automation/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
}

export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus,
): Promise<{ success: boolean; agent: AgentSpec }> {
  return apiFetch(`/goal-automation/agents/${encodeURIComponent(agentId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function getAgentsHealth(): Promise<{ success: boolean; health: Record<string, string>; stats: DelegationStats }> {
  return apiFetch(`/goal-automation/agents/health`);
}

export async function getLoadDistribution(): Promise<{ success: boolean; distribution: LoadDistribution }> {
  return apiFetch(`/goal-automation/agents/load`);
}

// ============================================================
// Delegation API
// ============================================================

export async function createDelegation(
  req: DelegationRequest,
): Promise<{ success: boolean; delegation: DelegationResult }> {
  return apiFetch(`/goal-automation/delegations`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function listDelegations(
  goalId?: string,
  limit: number = 100,
): Promise<{ success: boolean; count: number; history: DelegationResult[] }> {
  const params = new URLSearchParams();
  if (goalId) params.append('goal_id', goalId);
  params.append('limit', String(limit));
  return apiFetch(`/goal-automation/delegations?${params.toString()}`);
}

export async function getDelegation(
  delegationId: string,
): Promise<{ success: boolean; delegation: DelegationResult }> {
  return apiFetch(`/goal-automation/delegations/${encodeURIComponent(delegationId)}`);
}

export async function completeDelegation(
  delegationId: string,
  success: boolean = true,
  output: Record<string, unknown> = {},
): Promise<{ success: boolean; delegation_id: string; completed: boolean }> {
  return apiFetch(`/goal-automation/delegations/${encodeURIComponent(delegationId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ success, output }),
  });
}

// ============================================================
// 元数据 API
// ============================================================

export async function listMetaRoles(): Promise<{ success: boolean; roles: Array<{ value: string; name: string }> }> {
  return apiFetch(`/goal-automation/meta/roles`);
}

export async function listMetaRiskLevels(): Promise<{ success: boolean; risk_levels: Array<{ value: string; name: string }> }> {
  return apiFetch(`/goal-automation/meta/risk-levels`);
}

export async function listMetaStrategies(): Promise<{ success: boolean; strategies: Array<{ value: string; name: string }> }> {
  return apiFetch(`/goal-automation/meta/strategies`);
}

export async function listMetaTriggers(): Promise<{ success: boolean; triggers: Array<{ value: string; name: string }> }> {
  return apiFetch(`/goal-automation/meta/triggers`);
}

export async function listMetaAcTypes(): Promise<{
  success: boolean;
  ac_types: Record<string, { preferred_roles: string[] }>;
}> {
  return apiFetch(`/goal-automation/meta/ac-types`);
}

// ============================================================
// React Hook
// ============================================================

export interface UseGoalAutomationApiReturn {
  loading: boolean;
  error: string | null;
  // Auto-Turn
  getHealth: typeof getHealth;
  getStats: typeof getStats;
  listActiveGoals: typeof listActiveGoals;
  registerGoalConfig: typeof registerGoalConfig;
  getGoalConfig: typeof getGoalConfig;
  unregisterGoalConfig: typeof unregisterGoalConfig;
  triggerTurn: typeof triggerTurn;
  pauseGoal: typeof pauseGoal;
  resumeGoal: typeof resumeGoal;
  stopGoal: typeof stopGoal;
  getTurnHistory: typeof getTurnHistory;
  // Agents
  registerAgent: typeof registerAgent;
  listAgents: typeof listAgents;
  getAgent: typeof getAgent;
  unregisterAgent: typeof unregisterAgent;
  updateAgentStatus: typeof updateAgentStatus;
  getAgentsHealth: typeof getAgentsHealth;
  getLoadDistribution: typeof getLoadDistribution;
  // Delegation
  createDelegation: typeof createDelegation;
  listDelegations: typeof listDelegations;
  getDelegation: typeof getDelegation;
  completeDelegation: typeof completeDelegation;
  // Meta
  listMetaRoles: typeof listMetaRoles;
  listMetaRiskLevels: typeof listMetaRiskLevels;
  listMetaStrategies: typeof listMetaStrategies;
  listMetaTriggers: typeof listMetaTriggers;
  listMetaAcTypes: typeof listMetaAcTypes;
}

/**
 * useGoalAutomationApi - Goal Automation 统一 API Hook
 * 提供 loading / error 状态 + 简化的调用接口
 */
export function useGoalAutomationApi(): UseGoalAutomationApiReturn {
  const [loading] = useState(false);
  const [error] = useState<string | null>(null);

  return {
    loading,
    error,
    // Auto-Turn
    getHealth,
    getStats,
    listActiveGoals,
    registerGoalConfig,
    getGoalConfig,
    unregisterGoalConfig,
    triggerTurn,
    pauseGoal,
    resumeGoal,
    stopGoal,
    getTurnHistory,
    // Agents
    registerAgent,
    listAgents,
    getAgent,
    unregisterAgent,
    updateAgentStatus,
    getAgentsHealth,
    getLoadDistribution,
    // Delegation
    createDelegation,
    listDelegations,
    getDelegation,
    completeDelegation,
    // Meta
    listMetaRoles,
    listMetaRiskLevels,
    listMetaStrategies,
    listMetaTriggers,
    listMetaAcTypes,
  };
}

// 抑制未使用变量警告（GOAL_API_BASE 保留供未来扩展）
export const __GOAL_API_BASE = GOAL_API_BASE;
