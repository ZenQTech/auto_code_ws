/**
 * # ============================================================
 * # Agent v2 API 客户端
 * # ============================================================
 * # 核心作用：封装 Agent v2 自进化智能体的 API 调用
 * # 创建日期：2026-07-28
 * # 关联阶段：Cycle 14 P0-1
 * # 依赖：fetch API
 * # 修改记录：
 * #   - 2026-07-28 | v1.0.0 | 初始版本（18 端点全覆盖）
 * # ============================================================
 */

const API_BASE = '/api';
const AGENT_V2_BASE = `${API_BASE}/agent-v2`;

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${AGENT_V2_BASE}${path}`;
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

export type ScheduleType = 'cron' | 'interval' | 'event' | 'one_shot';
export type AutomationStatus = 'active' | 'paused' | 'disabled';
export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SuggestionSource = 'memory' | 'pattern' | 'automation' | 'background';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface ProactivePattern {
  pattern_id: string;
  description: string;
  trigger_conditions: string[];
  confidence: number;
  occurrences: number;
  last_triggered: string;
  suggested_action: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ProactiveSuggestion {
  suggestion_id: string;
  title: string;
  description: string;
  confidence: number;
  source: SuggestionSource;
  action_url: string | null;
  created_at: string;
  expires_at: string | null;
  metadata: Record<string, any>;
  status: SuggestionStatus;
}

export interface ThreadAutomation {
  automation_id: string;
  name: string;
  schedule: string;
  schedule_type: ScheduleType;
  action: string;
  enabled: boolean;
  status: AutomationStatus;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  max_runs: number | null;
  created_at: string;
  owner: string;
  metadata: Record<string, any>;
}

export interface BackgroundTask {
  task_id: string;
  name: string;
  action: string;
  automation_id: string | null;
  status: BackgroundTaskStatus;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  retry_count: number;
  max_retries: number;
  metadata: Record<string, any>;
}

export interface IdleStatus {
  is_idle: boolean;
  last_activity: string;
  idle_seconds: number;
  idle_threshold: number;
  auto_turn_enabled: boolean;
  next_auto_turn: string | null;
}

export interface AgentV2Stats {
  total_patterns: number;
  high_confidence_patterns: number;
  total_suggestions: number;
  pending_suggestions: number;
  accepted_suggestions: number;
  rejected_suggestions: number;
  total_automations: number;
  active_automations: number;
  total_background_tasks: number;
  background_tasks_by_status: Record<string, number>;
  last_idle_check: string;
}

export interface AgentV2Health {
  success: boolean;
  service: string;
  version: string;
  status: string;
  subsystems: Record<string, string>;
  stats: {
    total_patterns: number;
    total_suggestions: number;
    total_automations: number;
    total_background_tasks: number;
  };
  timestamp: string;
}

// ============================================================
// API 函数
// ============================================================

export async function fetchHealth(): Promise<AgentV2Health> {
  return apiFetch('/health');
}

export async function fetchStats(): Promise<{ success: boolean; data: AgentV2Stats }> {
  return apiFetch('/stats');
}

export async function fetchDashboard(): Promise<{ success: boolean; data: any }> {
  return apiFetch('/dashboard');
}

// Patterns
export async function listPatterns(
  min_confidence?: number,
  limit: number = 50,
): Promise<{ success: boolean; count: number; patterns: ProactivePattern[] }> {
  const params = new URLSearchParams();
  if (min_confidence !== undefined) params.set('min_confidence', String(min_confidence));
  params.set('limit', String(limit));
  return apiFetch(`/proactive/patterns?${params.toString()}`);
}

export async function getPattern(patternId: string): Promise<{ success: boolean; pattern: ProactivePattern }> {
  return apiFetch(`/proactive/patterns/${patternId}`);
}

export async function removePattern(patternId: string): Promise<{ success: boolean; removed: boolean }> {
  return apiFetch(`/proactive/patterns/${patternId}`, { method: 'DELETE' });
}

export async function recordOperation(payload: {
  type: string;
  target: string;
  description: string;
  suggested_action: string;
  context?: Record<string, any>;
}): Promise<{ success: boolean; count: number; suggestions: ProactiveSuggestion[] }> {
  return apiFetch('/proactive/operations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Suggestions
export async function createSuggestion(payload: {
  title: string;
  description: string;
  source?: SuggestionSource;
  confidence?: number;
  action_url?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; suggestion: ProactiveSuggestion }> {
  return apiFetch('/proactive/suggestions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listSuggestions(
  status?: SuggestionStatus,
  source?: SuggestionSource,
  min_confidence: number = 0,
  limit: number = 50,
): Promise<{ success: boolean; count: number; suggestions: ProactiveSuggestion[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (source) params.set('source', source);
  params.set('min_confidence', String(min_confidence));
  params.set('limit', String(limit));
  return apiFetch(`/proactive/suggestions?${params.toString()}`);
}

export async function getSuggestion(suggestionId: string): Promise<{ success: boolean; suggestion: ProactiveSuggestion }> {
  return apiFetch(`/proactive/suggestions/${suggestionId}`);
}

export async function acceptSuggestion(suggestionId: string): Promise<{ success: boolean; suggestion: ProactiveSuggestion }> {
  return apiFetch(`/proactive/suggestions/${suggestionId}/accept`, { method: 'POST' });
}

export async function rejectSuggestion(suggestionId: string): Promise<{ success: boolean; suggestion: ProactiveSuggestion }> {
  return apiFetch(`/proactive/suggestions/${suggestionId}/reject`, { method: 'POST' });
}

// Automations
export async function listAutomations(
  enabledOnly: boolean = false,
  owner?: string,
): Promise<{ success: boolean; count: number; automations: ThreadAutomation[] }> {
  const params = new URLSearchParams();
  params.set('enabled_only', String(enabledOnly));
  if (owner) params.set('owner', owner);
  return apiFetch(`/automations?${params.toString()}`);
}

export async function createAutomation(payload: {
  name: string;
  schedule: string;
  action: string;
  schedule_type?: ScheduleType;
  enabled?: boolean;
  max_runs?: number;
  owner?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; automation: ThreadAutomation }> {
  return apiFetch('/automations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getAutomation(automationId: string): Promise<{ success: boolean; automation: ThreadAutomation }> {
  return apiFetch(`/automations/${automationId}`);
}

export async function updateAutomation(
  automationId: string,
  payload: Partial<ThreadAutomation>,
): Promise<{ success: boolean; automation: ThreadAutomation }> {
  return apiFetch(`/automations/${automationId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteAutomation(automationId: string): Promise<{ success: boolean; removed: boolean }> {
  return apiFetch(`/automations/${automationId}`, { method: 'DELETE' });
}

export async function triggerAutomation(automationId: string): Promise<{ success: boolean; task: BackgroundTask }> {
  return apiFetch(`/automations/${automationId}/trigger`, { method: 'POST' });
}

// Background Tasks
export async function listBackgroundTasks(
  status?: BackgroundTaskStatus,
  automationId?: string,
  limit: number = 100,
): Promise<{ success: boolean; count: number; tasks: BackgroundTask[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (automationId) params.set('automation_id', automationId);
  params.set('limit', String(limit));
  return apiFetch(`/background/tasks?${params.toString()}`);
}

export async function getBackgroundTask(taskId: string): Promise<{ success: boolean; task: BackgroundTask }> {
  return apiFetch(`/background/tasks/${taskId}`);
}

export async function cancelBackgroundTask(taskId: string): Promise<{ success: boolean; cancelled: boolean }> {
  return apiFetch(`/background/tasks/${taskId}/cancel`, { method: 'POST' });
}

// Self-Directing
export async function fetchIdleStatus(): Promise<{ success: boolean; status: IdleStatus }> {
  return apiFetch('/self-directing/idle-status');
}

export async function triggerAutoTurn(): Promise<{ success: boolean; count: number; suggestions: ProactiveSuggestion[] }> {
  return apiFetch('/self-directing/auto-turn', { method: 'POST' });
}

export async function recordActivity(): Promise<{ success: boolean; status: IdleStatus }> {
  return apiFetch('/self-directing/activity', { method: 'POST' });
}

export async function setConfig(payload: {
  idle_threshold?: number;
  auto_turn_enabled?: boolean;
}): Promise<{ success: boolean; status: IdleStatus }> {
  return apiFetch('/self-directing/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============================================================
// 辅助函数
// ============================================================

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'text-green-600 bg-green-50 border-green-200';
  if (confidence >= 0.6) return 'text-blue-600 bg-blue-50 border-blue-200';
  if (confidence >= 0.4) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

export function getStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    pending: 'text-amber-600 bg-amber-50',
    accepted: 'text-green-600 bg-green-50',
    rejected: 'text-red-600 bg-red-50',
    running: 'text-blue-600 bg-blue-50',
    completed: 'text-green-600 bg-green-50',
    failed: 'text-red-600 bg-red-50',
    cancelled: 'text-gray-600 bg-gray-50',
    active: 'text-green-600 bg-green-50',
    paused: 'text-amber-600 bg-amber-50',
    disabled: 'text-gray-600 bg-gray-50',
  };
  return colorMap[status] || 'text-gray-600 bg-gray-50';
}

export function getSourceIcon(source: string): string {
  const iconMap: Record<string, string> = {
    memory: '🧠',
    pattern: '🔁',
    automation: '⚙️',
    background: '🔄',
  };
  return iconMap[source] || '💡';
}
