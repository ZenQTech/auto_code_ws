/**
 * # ============================================================
 * # MTC Adapter Types - MTC 适配器类型定义 (v1.0.0 Cycle 26 G26-03)
 * # ============================================================
 * # 核心作用：定义 MTC（More Than Coding）适配器的所有类型
 * # 主要功能：
 * #   1. 10 种文件类型检测
 * #   2. 7 种任务类型（总结/翻译/重写/分析/转换/提取/优化）
 * #   3. 6 种输出格式
 * #   4. 7 种任务参数
 * #   5. 可视化建议提取
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-03 初次创建
 * # ============================================================
 */

// ============ 文件类型 ============

export type MtcFileType =
  | 'text'        // .txt, .md, .markdown
  | 'data-csv'    // .csv
  | 'data-json'   // .json
  | 'code-ts'     // .ts, .tsx
  | 'code-js'     // .js, .jsx
  | 'code-py'     // .py
  | 'code-css'    // .css, .scss
  | 'code-html'   // .html
  | 'code-md'     // .md
  | 'unknown';

export const FILE_TYPE_LABELS: Record<MtcFileType, string> = {
  'text': '纯文本',
  'data-csv': 'CSV 数据',
  'data-json': 'JSON 数据',
  'code-ts': 'TypeScript',
  'code-js': 'JavaScript',
  'code-py': 'Python',
  'code-css': 'CSS',
  'code-html': 'HTML',
  'code-md': 'Markdown',
  'unknown': '未知',
};

export const FILE_TYPE_ICONS: Record<MtcFileType, string> = {
  'text': '📄',
  'data-csv': '📊',
  'data-json': '📋',
  'code-ts': '🔷',
  'code-js': '🟨',
  'code-py': '🐍',
  'code-css': '🎨',
  'code-html': '🌐',
  'code-md': '📝',
  'unknown': '❓',
};

// ============ 任务类型 ============

export type MtcTaskType =
  | 'summarize'   // 总结
  | 'translate'   // 翻译
  | 'rewrite'     // 重写
  | 'analyze'     // 分析
  | 'convert'     // 转换
  | 'extract'     // 提取
  | 'optimize';   // 优化

export const TASK_TYPE_LABELS: Record<MtcTaskType, string> = {
  summarize: '总结',
  translate: '翻译',
  rewrite: '重写',
  analyze: '分析',
  convert: '转换',
  extract: '提取',
  optimize: '优化',
};

export const TASK_TYPE_ICONS: Record<MtcTaskType, string> = {
  summarize: '📝',
  translate: '🌐',
  rewrite: '✏️',
  analyze: '🔍',
  convert: '🔄',
  extract: '📤',
  optimize: '⚡',
};

export const TASK_TYPE_DESCRIPTIONS: Record<MtcTaskType, string> = {
  summarize: '提取关键信息生成简洁摘要',
  translate: '跨语言翻译保持原意',
  rewrite: '调整风格语气和表达',
  analyze: '数据洞察与可视化建议',
  convert: '格式转换（JSON/YAML/CSV...）',
  extract: '结构化信息抽取',
  optimize: '代码优化与现代化建议',
};

// ============ 输出格式 ============

export type MtcOutputFormat =
  | 'markdown'
  | 'json'
  | 'csv'
  | 'yaml'
  | 'html'
  | 'text';

export const OUTPUT_FORMAT_LABELS: Record<MtcOutputFormat, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
  yaml: 'YAML',
  html: 'HTML',
  text: '纯文本',
};

// ============ 文件 ============

export interface MtcFile {
  id: string;
  name: string;
  type: MtcFileType;
  size: number;
  content: string;
  parsed?: unknown;
  loadedAt: number;
}

// ============ 任务参数 ============

export type MtcTaskParams =
  | { type: 'summarize'; maxLength?: number; language?: string; focusAreas?: string[] }
  | { type: 'translate'; from: string; to: string; preserveFormatting?: boolean }
  | { type: 'rewrite'; style: 'formal' | 'casual' | 'academic' | 'creative' | 'concise'; preserveMeaning?: boolean }
  | { type: 'analyze'; questions?: string[]; generateVisualization?: boolean }
  | { type: 'convert'; targetFormat: 'json' | 'yaml' | 'toml' | 'csv' | 'markdown' | 'html' }
  | { type: 'extract'; fields: string[]; format: 'json' | 'csv' | 'list' }
  | { type: 'optimize'; goals: string[]; preserveApi?: boolean };

// ============ 任务 ============

export interface MtcTask {
  id: string;
  type: MtcTaskType;
  fileIds: string[];
  params: MtcTaskParams;
  outputFormat: MtcOutputFormat;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: MtcResult;
  model?: string;
  tokens?: { input: number; output: number; total: number };
}

// ============ 结果 ============

export interface MtcVisualization {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'table' | 'heatmap';
  title: string;
  data: unknown;
  description: string;
}

export interface MtcResult {
  id: string;
  taskId: string;
  content: string;
  metadata?: Record<string, unknown>;
  extracted?: unknown[];
  visualization?: MtcVisualization;
  duration: number;
}

// ============ 输入参数 ============

export interface CreateTaskInput {
  type: MtcTaskType;
  fileIds: string[];
  params: MtcTaskParams;
  outputFormat: MtcOutputFormat;
  model?: string;
}

export interface MtcConfig {
  defaultModel: string;
  maxFileSize: number;
  maxConcurrency: number;
  persist: boolean;
}

export const DEFAULT_MTC_CONFIG: MtcConfig = {
  defaultModel: 'gpt-4o-mini',
  maxFileSize: 1024 * 1024, // 1MB
  maxConcurrency: 3,
  persist: true,
};

// ============ 事件 ============

export type MtcEventType =
  | 'file-loaded'
  | 'file-removed'
  | 'task-created'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'progress';

export type MtcEvent =
  | { type: 'file-loaded'; file: MtcFile }
  | { type: 'file-removed'; fileId: string }
  | { type: 'task-created'; task: MtcTask }
  | { type: 'task-started'; taskId: string }
  | { type: 'task-completed'; taskId: string; result: MtcResult }
  | { type: 'task-failed'; taskId: string; error: string }
  | { type: 'task-cancelled'; taskId: string }
  | { type: 'progress'; taskId: string; progress: number };

// ============ LLM 调用接口 ============

/** LLM 调用函数（由用户/UI 注入） */
export type LLMCaller = (prompt: string, model?: string) => Promise<string>;

// ============ 工具函数 ============

export function generateFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateResultId(): string {
  return `result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
