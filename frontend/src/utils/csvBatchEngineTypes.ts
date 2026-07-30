/**
 * # ============================================================
 * # CSV Batch Engine Types - CSV 批处理智能体引擎类型定义 (v1.0.0 Cycle 26 G26-01)
 * # ============================================================
 * # 核心作用：定义 CSV 批处理引擎的所有类型、状态、数据模型
 * # 主要功能：
 * #   1. Job/Item/Result 完整生命周期
 * #   2. CSV 解析配置（ID列、模板、并发）
 * #   3. 进度与 ETA 计算
 * #   4. 失败重试与恢复策略
 * #   5. 事件订阅机制
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-01 初次创建
 * # ============================================================
 */

// ============ 状态类型 ============

/** Job 状态 */
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** Item 状态 */
export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** 失败策略 */
export type FailureStrategy = 'fail-fast' | 'continue';

// ============ 配置 ============

/**
 * CSV 批处理配置
 */
export interface CsvBatchConfig {
  /** 最大并发数（1-10） */
  maxConcurrency: number;
  /** 单项超时（秒） */
  maxRuntimeSeconds: number;
  /** 失败时是否自动重试 */
  autoRetry: boolean;
  /** 最大重试次数（1-5） */
  maxRetries: number;
  /** 失败策略 */
  failureStrategy: FailureStrategy;
  /** 输出 CSV 路径（可选） */
  outputCsvPath?: string;
  /** 是否持久化到 localStorage */
  persist: boolean;
}

export const DEFAULT_CSV_BATCH_CONFIG: CsvBatchConfig = {
  maxConcurrency: 3,
  maxRuntimeSeconds: 60,
  autoRetry: true,
  maxRetries: 3,
  failureStrategy: 'continue',
  persist: true,
};

// ============ DSL 模板 ============

/** 模板转换类型 */
export type TemplateTransform = 'plain' | 'upper' | 'lower' | 'trim' | 'json' | 'default' | 'slice';

/** 模板转换参数 */
export interface TemplateTransformOptions {
  /** default 的回退值 */
  fallback?: string;
  /** slice 的 [start, end] */
  sliceRange?: [number, number];
}

/** 模板占位符 */
export interface TemplatePlaceholder {
  /** 列名 */
  column: string;
  /** 转换类型 */
  transform?: TemplateTransform;
  /** 转换参数 */
  options?: TemplateTransformOptions;
}

// ============ Item ============

/**
 * 单个工作项
 */
export interface CsvBatchItem {
  /** 稳定 ID（来自 id_column 或自动生成） */
  id: string;
  /** 行号（0-based） */
  rowIndex: number;
  /** 渲染后的指令 */
  renderedInstruction: string;
  /** 原始行数据 */
  rawRow: Record<string, string>;
  /** 状态 */
  status: ItemStatus;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 重试次数 */
  retries: number;
  /** 错误信息 */
  error?: string;
  /** 任务结果 */
  result?: CsvBatchResult;
}

// ============ Result ============

/**
 * 工作项结果
 */
export interface CsvBatchResult {
  /** 输出字段名 */
  outputField: string;
  /** 输出值 */
  value: unknown;
  /** 原始 JSON 字符串（如果适用） */
  rawJson?: string;
  /** 持续时间（ms） */
  duration: number;
  /** 使用的模型 */
  model?: string;
  /** Token 消耗 */
  tokens?: { input: number; output: number; total: number };
}

// ============ Job ============

/**
 * CSV 批处理 Job
 */
export interface CsvBatchJob {
  id: string;
  status: JobStatus;
  /** Job 名称 */
  name: string;
  /** 输入 CSV 文件名 */
  inputFile: string;
  /** CSV 解析后的列名 */
  columns: string[];
  /** 指令模板（含占位符） */
  instruction: string;
  /** ID 列名（缺省自动生成 row-N） */
  idColumn?: string;
  /** 输出字段名（结果 CSV 中新增的列） */
  outputField: string;
  /** 所有工作项 */
  items: CsvBatchItem[];
  /** 配置 */
  config: CsvBatchConfig;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息（整体失败时） */
  error?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============ Progress ============

/**
 * Job 进度
 */
export interface CsvBatchProgress {
  jobId: string;
  /** 总工作项数 */
  total: number;
  /** 已完成数 */
  completed: number;
  /** 失败数 */
  failed: number;
  /** 运行中数 */
  running: number;
  /** 等待中数 */
  pending: number;
  /** 估算剩余时间（秒） */
  etaSeconds: number;
  /** 已用时间（秒） */
  elapsedSeconds: number;
  /** 完成率 0-1 */
  rate: number;
}

// ============ 输入参数 ============

/**
 * 创建 Job 输入
 */
export interface CreateJobInput {
  name: string;
  inputFile: string;
  columns: string[];
  instruction: string;
  rows: Record<string, string>[];
  idColumn?: string;
  outputField: string;
  config?: Partial<CsvBatchConfig>;
  metadata?: Record<string, unknown>;
}

/**
 * 执行器函数 - 由用户传入负责执行单条工作项
 */
export type ItemExecutor = (instruction: string, item: CsvBatchItem) => Promise<unknown>;

// ============ 事件 ============

export type CsvBatchEventType =
  | 'job-created'
  | 'job-started'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'item-started'
  | 'item-completed'
  | 'item-failed'
  | 'progress';

export type CsvBatchEvent =
  | { type: 'job-created'; job: CsvBatchJob }
  | { type: 'job-started'; jobId: string }
  | { type: 'job-completed'; jobId: string }
  | { type: 'job-failed'; jobId: string; error: string }
  | { type: 'job-cancelled'; jobId: string }
  | { type: 'item-started'; jobId: string; itemId: string }
  | { type: 'item-completed'; jobId: string; itemId: string; result: CsvBatchResult }
  | { type: 'item-failed'; jobId: string; itemId: string; error: string }
  | { type: 'progress'; progress: CsvBatchProgress };

// ============ 工具函数 ============

/** 生成 Job ID */
export function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成 Item ID */
export function generateItemId(rowIndex: number, idColumn?: string, row?: Record<string, string>): string {
  if (idColumn && row && row[idColumn]) {
    return `item-${row[idColumn]}`;
  }
  return `item-row-${rowIndex}`;
}

/** 生成结果 ID */
export function generateResultId(): string {
  return `result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Job 状态显示 */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: '待执行',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const JOB_STATUS_ICONS: Record<JobStatus, string> = {
  pending: '⏸',
  running: '▶',
  paused: '⏸',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
};

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  pending: '#94a3b8',
  running: '#3b82f6',
  paused: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: '等待',
  running: '运行',
  completed: '完成',
  failed: '失败',
  skipped: '跳过',
};

export const ITEM_STATUS_ICONS: Record<ItemStatus, string> = {
  pending: '⏳',
  running: '⚙️',
  completed: '✅',
  failed: '❌',
  skipped: '⏭️',
};
