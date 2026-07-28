/**
 * # ============================================================
 * Verification Loop 高级 API 客户端（v1.0.0 - Cycle 10 P1-10）
 * # ============================================================
 * 核心作用：封装 /api/verification/* 全部端点（任务 CRUD、4 维度验证、
 *           自动修复、基线管理、Webhook 触发、报告生成）
 * 运行流程：
 *   1. 组件挂载时调用 fetchStats() / fetchHealth() 拉取全局状态
 *   2. 用户创建任务时调用 createTask()
 *   3. 任务执行时调用 runTask() / cancelTask() / retryTask()
 *   4. 基线管理时调用 listBaselines() / createBaseline() / deleteBaseline()
 *   5. Webhook 触发时调用 triggerWebhook()
 * 输入参数：每个函数接收对应的参数对象
 * 输出结果：Promise<T>，T 为后端 API 响应类型
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

/** 触发源 */
export type TriggerType = 'commit' | 'pr' | 'cron' | 'manual';

/** 验证维度 */
export type Dimension = 'syntax' | 'module' | 'integration' | 'performance';

/** 任务状态 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

/** 验证任务 */
export interface VerificationTask {
  task_id: string;
  trigger: string;
  commit_sha: string;
  project_path: string;
  dimensions: string[];
  status: TaskStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  retry_count: number;
  error_message?: string | null;
  estimated_duration_seconds: number;
}

/** 验证结果（单维度） */
export interface VerificationResultItem {
  result_id: string;
  task_id: string;
  dimension: string;
  status: string;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  duration_seconds: number;
  output: string;
  error_details: string[];
  created_at: string;
}

/** 修复动作 */
export interface FixAction {
  action_id: string;
  task_id: string;
  error_type: string;
  error_signature: string;
  agent_invoked: string;
  fix_strategy: string;
  status: string;
  result_summary: string;
  retry_count: number;
  started_at: string;
  completed_at?: string | null;
}

/** 任务详情（含结果 + 修复记录） */
export interface TaskDetail {
  task: VerificationTask;
  results: VerificationResultItem[];
  fix_actions: FixAction[];
}

/** 性能基线 */
export interface PerformanceBaseline {
  baseline_id: string;
  name: string;
  project_path: string;
  metric_name: string;
  metric_value: number;
  unit: string;
  commit_sha: string;
  created_at: string;
  expired: boolean;
}

/** 统计 */
export interface VerificationStats {
  total_tasks: number;
  by_status: Record<string, number>;
  by_trigger: Record<string, number>;
  by_dimension: Record<string, number>;
  total_baselines: number;
  verification_dir: string;
}

/** 健康检查 */
export interface HealthInfo {
  success: boolean;
  service: string;
  version: string;
  features: string[];
}

// ============================================================
// 任务管理 API
// ============================================================

/** 创建任务 */
export async function createTask(req: {
  trigger: TriggerType;
  commit_sha: string;
  project_path: string;
  dimensions: Dimension[];
  metadata?: Record<string, any>;
}): Promise<{
  success: boolean;
  task_id: string;
  status: string;
  created_at: string;
  estimated_duration_seconds: number;
  message?: string;
}> {
  return apiFetch('/verification/tasks', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** 列出任务 */
export async function listTasks(params: {
  status?: TaskStatus;
  trigger?: TriggerType;
  limit?: number;
} = {}): Promise<{ success: boolean; data: VerificationTask[]; total: number }> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.trigger) search.set('trigger', params.trigger);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiFetch(`/verification/tasks${qs ? `?${qs}` : ''}`);
}

/** 任务详情 */
export async function getTask(taskId: string): Promise<{
  success: boolean;
  task: VerificationTask;
  results: VerificationResultItem[];
  fix_actions: FixAction[];
}> {
  return apiFetch(`/verification/tasks/${encodeURIComponent(taskId)}`);
}

/** 执行任务 */
export async function runTask(taskId: string): Promise<{
  success: boolean;
  task_id: string;
  status: string;
  message: string;
}> {
  return apiFetch(`/verification/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
  });
}

/** 取消任务 */
export async function cancelTask(taskId: string): Promise<{
  success: boolean;
  task_id: string;
  status: string;
}> {
  return apiFetch(`/verification/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
  });
}

/** 重试任务 */
export async function retryTask(taskId: string): Promise<{
  success: boolean;
  task_id: string;
  status: string;
  message: string;
}> {
  return apiFetch(`/verification/tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST',
  });
}

/** 任务结果 */
export async function getTaskResults(taskId: string): Promise<{
  success: boolean;
  task_id: string;
  data: VerificationResultItem[];
  total: number;
}> {
  return apiFetch(`/verification/results/${encodeURIComponent(taskId)}`);
}

// ============================================================
// 性能基线 API
// ============================================================

/** 列出基线 */
export async function listBaselines(): Promise<{
  success: boolean;
  data: PerformanceBaseline[];
  total: number;
}> {
  return apiFetch('/verification/baselines');
}

/** 创建基线 */
export async function createBaseline(req: {
  name: string;
  project_path: string;
  metric_name?: string;
  metric_value: number;
  unit?: string;
  commit_sha?: string;
}): Promise<{ success: boolean; baseline_id: string; message: string }> {
  return apiFetch('/verification/baselines', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ============================================================
// Webhook API
// ============================================================

/** 触发 Webhook */
export async function triggerWebhook(req: {
  event: 'push' | 'pull_request';
  project_path: string;
  payload: Record<string, any>;
}): Promise<{ success: boolean; task_id: string; status: string; message: string }> {
  return apiFetch('/verification/webhook/git', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ============================================================
// 统计与健康检查 API
// ============================================================

/** 统计 */
export async function fetchStats(): Promise<{ success: boolean; data: VerificationStats }> {
  return apiFetch('/verification/stats');
}

/** 健康检查 */
export async function fetchHealth(): Promise<HealthInfo> {
  return apiFetch('/verification/health');
}

// ============================================================
// 辅助函数
// ============================================================

/** 基线表单状态 */
export interface BaselineFormState {
  name: string;
  project_path: string;
  metric_name: string;
  metric_value: number;
  unit: string;
  commit_sha: string;
}

/** 状态颜色映射 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'passed':
      return 'bg-green-100 text-green-700 border-green-300';
    case 'failed':
      return 'bg-red-100 text-red-700 border-red-300';
    case 'running':
      return 'bg-blue-100 text-blue-700 border-blue-300';
    case 'cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    case 'blocked':
      return 'bg-orange-100 text-orange-700 border-orange-300';
    case 'pending':
    default:
      return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  }
}

/** 维度颜色 */
export function getDimensionColor(dimension: string): string {
  switch (dimension) {
    case 'syntax':
      return 'bg-purple-100 text-purple-700';
    case 'module':
      return 'bg-blue-100 text-blue-700';
    case 'integration':
      return 'bg-cyan-100 text-cyan-700';
    case 'performance':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/** 触发源图标 */
export function getTriggerIcon(trigger: string): string {
  switch (trigger) {
    case 'commit':
      return '📌';
    case 'pr':
      return '🔀';
    case 'cron':
      return '⏰';
    case 'manual':
    default:
      return '🖱️';
  }
}

/** 格式化时间戳 */
export function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/** 格式化耗时 */
export function formatDuration(seconds?: number): string {
  if (seconds == null) return '-';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s}s`;
}
