/**
 * # ============================================================
 * # /import API Hook - Cycle 11 P3-1
 * # ============================================================
 * # 核心作用：封装 /api/import REST 端点的 TypeScript 客户端
 * # 提供：8 个 API 函数 + 完整类型定义
 * # 输入参数：HTTP 请求
 * # 输出结果：Promise<T>
 * # 修改记录：
 * #   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

export type ImportSource = 'claude_code' | 'cursor' | 'codex' | 'trae';

export type DataType =
  | 'settings'
  | 'mcp_servers'
  | 'plugins'
  | 'sessions'
  | 'commands'
  | 'memories';

export type ImportStatus =
  | 'pending'
  | 'detecting'
  | 'previewing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

export interface DetectedSource {
  source: ImportSource;
  install_path: string;
  available: boolean;
  version: string | null;
  data_types: DataType[];
  size_bytes: number;
  last_modified: string | null;
  error: string | null;
}

export interface PreviewItem {
  source: ImportSource;
  data_type: DataType;
  source_path: string;
  target_path: string;
  size_bytes: number;
  item_count: number;
  conflicts: string[];
  transform_notes: string[];
  error: string | null;
}

export interface ImportTask {
  task_id: string;
  source: ImportSource;
  data_types: DataType[];
  status: ImportStatus;
  progress: number;
  started_at: string;
  completed_at: string | null;
  items_total: number;
  items_completed: number;
  items_failed: number;
  error: string | null;
  rollback_available: boolean;
  log: string[];
  results: Array<{
    data_type: DataType;
    source_path: string;
    target_path: string;
    size_bytes: number;
    success: boolean;
    error?: string;
  }>;
}

export interface ImportStats {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  supported_sources: ImportSource[];
  supported_data_types: DataType[];
  hermes_home: string;
}

// ============================================================
// API 基础配置
// ============================================================

const API_BASE = '/api/import';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================
// API 函数
// ============================================================

/** 健康检查 */
export async function fetchHealth(): Promise<{ status: string; version: string }> {
  return apiFetch('/health');
}

/** 列出支持的格式 */
export async function fetchFormats(): Promise<{
  sources: Array<{ value: ImportSource; name: string }>;
  data_types: Array<{ value: DataType; name: string }>;
}> {
  return apiFetch('/formats');
}

/** 检测已安装的 IDE */
export async function detectSources(sources?: ImportSource[]): Promise<{
  count: number;
  sources: DetectedSource[];
}> {
  return apiFetch('/detect', {
    method: 'POST',
    body: JSON.stringify({ sources: sources || null }),
  });
}

/** 预览待迁移项 */
export async function previewImport(
  source: ImportSource,
  data_types: DataType[],
  install_path?: string,
): Promise<{ count: number; items: PreviewItem[] }> {
  return apiFetch('/preview', {
    method: 'POST',
    body: JSON.stringify({ source, data_types, install_path: install_path || null }),
  });
}

/** 执行导入（异步） */
export async function runImport(
  source: ImportSource,
  data_types: DataType[],
  install_path?: string,
): Promise<{ success: boolean; task_id: string; status: string; items_total: number }> {
  return apiFetch('/run', {
    method: 'POST',
    body: JSON.stringify({ source, data_types, install_path: install_path || null }),
  });
}

/** 查询任务状态 */
export async function getStatus(task_id: string): Promise<ImportTask> {
  return apiFetch(`/status/${task_id}`);
}

/** 列出所有任务 */
export async function listTasks(
  source?: ImportSource,
  status?: ImportStatus,
): Promise<{ count: number; tasks: ImportTask[] }> {
  const params = new URLSearchParams();
  if (source) params.append('source', source);
  if (status) params.append('status', status);
  const qs = params.toString();
  return apiFetch(`/list${qs ? `?${qs}` : ''}`);
}

/** 取消任务 */
export async function cancelTask(task_id: string): Promise<{ success: boolean }> {
  return apiFetch(`/${task_id}`, { method: 'DELETE' });
}

/** 回滚任务 */
export async function rollbackTask(task_id: string): Promise<{ success: boolean }> {
  return apiFetch(`/${task_id}?rollback=true`, { method: 'DELETE' });
}

/** 统计 */
export async function fetchStats(): Promise<ImportStats> {
  return apiFetch('/stats');
}

// ============================================================
// 辅助函数
// ============================================================

/** 状态徽章颜色 */
export function getStatusColor(status: ImportStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 border-green-300';
    case 'failed':
      return 'bg-red-100 text-red-700 border-red-300';
    case 'running':
    case 'detecting':
    case 'previewing':
      return 'bg-blue-100 text-blue-700 border-blue-300';
    case 'cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    case 'rolled_back':
      return 'bg-orange-100 text-orange-700 border-orange-300';
    case 'pending':
    default:
      return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  }
}

/** 数据源图标 */
export function getSourceIcon(source: ImportSource): string {
  switch (source) {
    case 'claude_code':
      return '🤖';
    case 'cursor':
      return '⌨️';
    case 'codex':
      return '📘';
    case 'trae':
      return '🎯';
    default:
      return '📦';
  }
}

/** 数据源显示名 */
export function getSourceName(source: ImportSource): string {
  switch (source) {
    case 'claude_code':
      return 'Claude Code';
    case 'cursor':
      return 'Cursor';
    case 'codex':
      return 'Codex';
    case 'trae':
      return 'TRAE';
    default:
      return source;
  }
}

/** 数据类型显示名 */
export function getDataTypeName(data_type: DataType): string {
  switch (data_type) {
    case 'settings':
      return '设置';
    case 'mcp_servers':
      return 'MCP 服务器';
    case 'plugins':
      return '插件';
    case 'sessions':
      return '会话';
    case 'commands':
      return '命令';
    case 'memories':
      return '记忆';
    default:
      return data_type;
  }
}

/** 格式化文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
