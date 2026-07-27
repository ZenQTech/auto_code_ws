/**
 * # ============================================================
 * slashCommandShared - Slash Commands 共享类型 + 常量
 * # ============================================================
 * 核心作用：集中定义 Slash Commands 系统的共享类型、常量和工具函数
 * 避免 useSlashCommands / useSlashCommandExecutor / SlashCommandPicker 之间的循环引用
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 执行状态 */
export type ExecutionStatus =
  | 'success'
  | 'failed'
  | 'pending'
  | 'cancelled'
  | 'unauthorized';

/** 执行结果 */
export interface ExecutionResult {
  command: string;
  status: ExecutionStatus;
  message: string;
  data: Record<string, unknown> | null;
  duration_ms: number;
  error: string | null;
}

// ============================================================
// 常量
// ============================================================

/** 状态对应的中文标签 */
export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  success: '成功',
  failed: '失败',
  pending: '执行中',
  cancelled: '已取消',
  unauthorized: '权限不足',
};

/** 状态对应的颜色 */
export const EXECUTION_STATUS_COLORS: Record<ExecutionStatus, string> = {
  success: 'text-green-600 bg-green-50 border-green-200',
  failed: 'text-red-600 bg-red-50 border-red-200',
  pending: 'text-blue-600 bg-blue-50 border-blue-200',
  cancelled: 'text-gray-600 bg-gray-50 border-gray-200',
  unauthorized: 'text-yellow-600 bg-yellow-50 border-yellow-200',
};

/** 状态对应的图标 */
export const EXECUTION_STATUS_ICONS: Record<ExecutionStatus, string> = {
  success: '✅',
  failed: '❌',
  pending: '⏳',
  cancelled: '🚫',
  unauthorized: '🔒',
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化耗时显示
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return '< 1ms';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
