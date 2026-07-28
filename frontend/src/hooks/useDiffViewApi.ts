/**
 * # ============================================================
 * DiffView 高级 API 客户端（v1.0.0 - Cycle 9 P1-7）
 * # ============================================================
 * 核心作用：封装 /api/diff-view/* 全部端点（多格式 diff / 快照管理 /
 *           任意 ref 对比 / 暂存控制 / 健康检查 / 格式列表）
 * 运行流程：
 *   1. 组件挂载时调用 fetchFormats() 拉取可用格式元数据
 *   2. 用户切换格式时调用 fetchWorkspace() 重新拉取对应格式的 diff
 *   3. 用户创建/恢复/删除快照时调用对应的 API
 *   4. 用户比较两个 ref 时调用 fetchCompare()
 *   5. 用户暂存/取消暂存文件时调用 stageFile / unstageFile
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

/** 支持的 diff 输出格式 */
export type DiffFormatName = 'unified' | 'side_by_side' | 'json_patch' | 'stats';

/** 单个 diff 行 */
export interface DiffLine {
  line_type: 'add' | 'del' | 'ctx' | 'meta';
  content: string;
  old_line_no: number | null;
  new_line_no: number | null;
}

/** 单文件 diff 详情 */
export interface FileDiffData {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  old_path: string | null;
  is_staged: boolean;
  patch_unified: string;
  lines: DiffLine[];
  side_by_side: { rows: any[]; row_count: number };
  json_patch: Array<{ op: 'add' | 'remove'; line: number; content: string }>;
  error: string | null;
}

/** 汇总统计 */
export interface DiffStatsData {
  total_files: number;
  total_additions: number;
  total_deletions: number;
  by_status: Record<string, number>;
}

/** 一次 diff 操作的结果 */
export interface DiffResultData {
  format: string;
  files: FileDiffData[];
  stats: DiffStatsData;
  base_ref: string | null;
  target_ref: string | null;
  error: string | null;
}

/** 工作区 diff 响应包装 */
export interface WorkspaceDiffResponse {
  success: boolean;
  action: string;
  data: DiffResultData;
}

/** 任意 ref 对比响应包装 */
export interface CompareDiffResponse {
  success: boolean;
  action: string;
  data: DiffResultData;
}

/** 快照 vs 工作区 diff 响应包装 */
export interface SnapshotDiffResponse {
  success: boolean;
  action: string;
  data?: DiffResultData;
  error?: string;
}

/** 快照元数据 */
export interface SnapshotData {
  id: string;
  project_path: string;
  label: string;
  description: string;
  created_at: string;
  file_count: number;
  total_size: number;
  file_hashes: Record<string, string>;
  storage_dir: string;
}

/** 列出快照响应 */
export interface ListSnapshotsResponse {
  success: boolean;
  action: string;
  count: number;
  snapshots: SnapshotData[];
}

/** 创建快照响应 */
export interface CreateSnapshotResponse {
  success: boolean;
  action: string;
  snapshot: SnapshotData;
}

/** 恢复快照响应 */
export interface RestoreSnapshotResponse {
  success: boolean;
  action: string;
  snapshot_id: string;
  message: string;
  file_count: number;
}

/** 删除快照响应 */
export interface DeleteSnapshotResponse {
  success: boolean;
  action: string;
  snapshot_id: string;
  message: string;
}

/** 暂存/取消暂存响应 */
export interface StageResponse {
  success: boolean;
  action: string;
  file_path?: string;
  message: string;
}

/** 列出格式响应 */
export interface ListFormatsResponse {
  success: boolean;
  action: string;
  formats: Array<{ name: string; description: string }>;
}

/** 健康检查响应 */
export interface DiffViewHealthResponse {
  success: boolean;
  action: string;
  service: string;
  version: string;
  supported_formats: DiffFormatName[];
}

// ============================================================
// 工作区 diff
// ============================================================

/**
 * 工作区 diff 请求参数
 */
export interface WorkspaceDiffParams {
  project_path: string;
  staged?: boolean;
  format?: DiffFormatName;
  path_filter?: string;
  status_filter?: string[];
}

/**
 * 获取工作区 diff（多格式）
 * 端点：POST /api/diff-view/workspace
 * 返回值：完整 DiffResultData（包含 files + stats + format）
 */
export async function fetchWorkspaceDiff(
  params: WorkspaceDiffParams,
): Promise<WorkspaceDiffResponse> {
  return apiFetch<WorkspaceDiffResponse>('/diff-view/workspace', {
    method: 'POST',
    body: JSON.stringify({
      project_path: params.project_path,
      staged: params.staged ?? false,
      format: params.format ?? 'unified',
      path_filter: params.path_filter,
      status_filter: params.status_filter,
    }),
  });
}

// ============================================================
// 任意 ref 对比
// ============================================================

/**
 * 任意 ref 对比请求参数
 */
export interface CompareDiffParams {
  project_path: string;
  base_ref: string;
  target_ref: string;
  format?: DiffFormatName;
  path_filter?: string;
}

/**
 * 比较任意两个 git ref（commit/branch/tag）
 * 端点：POST /api/diff-view/compare
 */
export async function fetchCompareDiff(
  params: CompareDiffParams,
): Promise<CompareDiffResponse> {
  return apiFetch<CompareDiffResponse>('/diff-view/compare', {
    method: 'POST',
    body: JSON.stringify({
      project_path: params.project_path,
      base_ref: params.base_ref,
      target_ref: params.target_ref,
      format: params.format ?? 'unified',
      path_filter: params.path_filter,
    }),
  });
}

// ============================================================
// 快照 vs 工作区 diff
// ============================================================

/**
 * 对比快照与工作区
 * 端点：POST /api/diff-view/snapshot-vs-worktree
 */
export async function fetchSnapshotVsWorktree(
  project_path: string,
  snapshot_id: string,
): Promise<SnapshotDiffResponse> {
  return apiFetch<SnapshotDiffResponse>('/diff-view/snapshot-vs-worktree', {
    method: 'POST',
    body: JSON.stringify({ project_path, snapshot_id }),
  });
}

// ============================================================
// 快照管理
// ============================================================

/**
 * 列出快照
 * 端点：GET /api/diff-view/snapshots?project_path=...
 */
export async function listSnapshots(
  project_path: string,
): Promise<ListSnapshotsResponse> {
  return apiFetch<ListSnapshotsResponse>(
    `/diff-view/snapshots?project_path=${encodeURIComponent(project_path)}`,
  );
}

/**
 * 创建快照请求参数
 */
export interface CreateSnapshotParams {
  project_path: string;
  label?: string;
  description?: string;
  include_globs?: string[];
}

/**
 * 创建快照
 * 端点：POST /api/diff-view/snapshots
 */
export async function createSnapshot(
  params: CreateSnapshotParams,
): Promise<CreateSnapshotResponse> {
  return apiFetch<CreateSnapshotResponse>('/diff-view/snapshots', {
    method: 'POST',
    body: JSON.stringify({
      project_path: params.project_path,
      label: params.label ?? '',
      description: params.description ?? '',
      include_globs: params.include_globs,
    }),
  });
}

/**
 * 恢复快照
 * 端点：POST /api/diff-view/snapshots/{id}/restore?project_path=...
 */
export async function restoreSnapshot(
  project_path: string,
  snapshot_id: string,
): Promise<RestoreSnapshotResponse> {
  return apiFetch<RestoreSnapshotResponse>(
    `/diff-view/snapshots/${encodeURIComponent(snapshot_id)}/restore?project_path=${encodeURIComponent(project_path)}`,
    { method: 'POST' },
  );
}

/**
 * 删除快照
 * 端点：DELETE /api/diff-view/snapshots/{id}?project_path=...
 */
export async function deleteSnapshot(
  project_path: string,
  snapshot_id: string,
): Promise<DeleteSnapshotResponse> {
  return apiFetch<DeleteSnapshotResponse>(
    `/diff-view/snapshots/${encodeURIComponent(snapshot_id)}?project_path=${encodeURIComponent(project_path)}`,
    { method: 'DELETE' },
  );
}

// ============================================================
// 暂存控制
// ============================================================

/**
 * 暂存单个文件
 * 端点：POST /api/diff-view/stage
 */
export async function stageFile(
  project_path: string,
  file_path: string,
): Promise<StageResponse> {
  return apiFetch<StageResponse>('/diff-view/stage', {
    method: 'POST',
    body: JSON.stringify({ project_path, file_path }),
  });
}

/**
 * 取消暂存单个文件
 * 端点：POST /api/diff-view/unstage
 */
export async function unstageFile(
  project_path: string,
  file_path: string,
): Promise<StageResponse> {
  return apiFetch<StageResponse>('/diff-view/unstage', {
    method: 'POST',
    body: JSON.stringify({ project_path, file_path }),
  });
}

/**
 * 全部暂存
 * 端点：POST /api/diff-view/stage-all
 */
export async function stageAllFiles(
  project_path: string,
): Promise<StageResponse> {
  return apiFetch<StageResponse>('/diff-view/stage-all', {
    method: 'POST',
    body: JSON.stringify({ project_path }),
  });
}

// ============================================================
// 元信息
// ============================================================

/**
 * 获取支持的输出格式列表
 * 端点：GET /api/diff-view/formats
 */
export async function fetchFormats(): Promise<ListFormatsResponse> {
  return apiFetch<ListFormatsResponse>('/diff-view/formats');
}

/**
 * 健康检查
 * 端点：GET /api/diff-view/health
 */
export async function fetchDiffViewHealth(): Promise<DiffViewHealthResponse> {
  return apiFetch<DiffViewHealthResponse>('/diff-view/health');
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化字节数为可读字符串
 * 输入：bytes（字节数）
 * 输出：人类可读字符串（如 "1.2 MB"）
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 格式化 ISO 时间为本地可读字符串
 * 输入：isoString（ISO 8601 格式）
 * 输出：YYYY-MM-DD HH:MM:SS
 */
export function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return isoString;
  }
}
