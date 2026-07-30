/**
 * # ============================================================
 * # Nested Sub-Agent Types - 嵌套子代理类型定义 (v1.0.0 Cycle 27 G27-01)
 * # ============================================================
 * # 核心作用：定义嵌套子代理引擎的所有类型、常量与默认配置
 * # 参考：Claude Code 2026-06 #1 Nested Sub-Agents + Codex v0.145 V2
 * # 运行流程：
 * #   1. 定义 AgentRole / ModelChoice / ReasoningEffort 等枚举
 * #   2. 定义 SubAgentConfig / SubAgentNode / AgentTask 等核心数据结构
 * #   3. 定义 NestedSubAgentConfig / Event / Tree 等运行时类型
 * #   4. 导出默认配置、工具函数、ID 生成器
 * # 输入参数：无（仅类型定义）
 * # 输出结果：所有类型常量与默认配置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-01 初次创建
 * # ============================================================
 */

// ============ 枚举类型 ============

/**
 * 代理角色枚举
 * 描述代理在嵌套树中的职责
 */
export type AgentRole =
  | 'coordinator' // 顶层协调者
  | 'researcher' // 研究者
  | 'analyzer' // 分析者
  | 'builder' // 构建者
  | 'reviewer' // 审查者
  | 'tester' // 测试者
  | 'refactorer' // 重构者
  | 'documenter' // 文档者
  | 'custom'; // 自定义

/**
 * 模型选择
 * inherit 表示继承父级
 */
export type ModelChoice =
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'inherit';

/**
 * 推理强度
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * 代理状态
 */
export type AgentStatus =
  | 'idle' // 空闲
  | 'running' // 运行中
  | 'paused' // 暂停
  | 'completed' // 完成
  | 'failed' // 失败
  | 'timeout' // 超时
  | 'cancelled'; // 已取消

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 嵌套子代理事件类型
 */
export type NestedSubAgentEventType =
  | 'agent-created'
  | 'agent-started'
  | 'agent-completed'
  | 'agent-failed'
  | 'agent-timed-out'
  | 'agent-paused'
  | 'agent-resumed'
  | 'agent-cancelled'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'tree-restored'
  | 'depth-limit-reached'
  | 'cycle-detected'
  | 'context-compacted';

// ============ 核心数据结构 ============

/**
 * 单个代理配置
 * 用于 createRootAgent / createChildAgent
 */
export interface SubAgentConfig {
  /** 代理唯一 ID（用户指定或自动生成） */
  id?: string;
  /** 代理角色 */
  role: AgentRole;
  /** 自定义名称（kebab-case） */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 使用的模型 */
  model: ModelChoice;
  /** 推理强度 */
  reasoningEffort: ReasoningEffort;
  /** 系统提示词 */
  systemPrompt: string;
  /** 允许使用的工具列表（空数组表示无工具） */
  tools: string[];
  /** 约束条件（不可违反的硬性规则） */
  constraints: string[];
  /** 上下文窗口大小（token 数，默认 8000） */
  contextWindow: number;
  /** 超时时间（毫秒，0 表示不超时） */
  timeoutMs: number;
}

/**
 * 代理节点（运行时状态）
 * 描述嵌套树中的一个节点
 */
export interface SubAgentNode {
  /** 节点唯一 UUID */
  uuid: string;
  /** 路径地址（如 /root/researcher/analyzer） */
  path: string;
  /** 父节点 UUID（根节点为 undefined） */
  parentUuid?: string;
  /** 节点配置 */
  config: SubAgentConfig;
  /** 嵌套深度（0, 1, 2） */
  depth: number;
  /** 状态 */
  status: AgentStatus;
  /** 子节点 UUID 列表 */
  children: string[];
  /** 当前任务 */
  currentTask?: AgentTask;
  /** 完成的任务数 */
  completedTasks: number;
  /** 失败的任务数 */
  failedTasks: number;
  /** 创建时间（毫秒） */
  createdAt: number;
  /** 启动时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 已使用 token 数（估算） */
  tokensUsed: number;
  /** 当前 context window 已用占比（0-1） */
  contextUsage: number;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 任务定义
 */
export interface AgentTask {
  id: string;
  description: string;
  input: string;
  output?: string;
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** 任务使用的 token 数 */
  tokensUsed: number;
}

/**
 * 引擎配置
 */
export interface NestedSubAgentConfig {
  /** 最大嵌套深度（默认 3） */
  maxDepth: number;
  /** 默认模型 */
  defaultModel: ModelChoice;
  /** 默认推理强度 */
  defaultReasoningEffort: ReasoningEffort;
  /** 默认超时（毫秒） */
  defaultTimeoutMs: number;
  /** 是否持久化到 localStorage */
  persist: boolean;
  /** 全局并发上限 */
  maxConcurrency: number;
  /** 上下文压缩阈值（0-1） */
  contextCompactThreshold: number;
}

/**
 * 嵌套子代理事件
 */
export interface NestedSubAgentEvent {
  type: NestedSubAgentEventType;
  timestamp: number;
  agentUuid: string;
  agentPath: string;
  data?: Record<string, unknown>;
}

/**
 * 树结构
 */
export interface SubAgentTree {
  rootUuid: string;
  totalAgents: number;
  totalCompleted: number;
  totalFailed: number;
  totalTokensUsed: number;
  maxDepthReached: number;
}

/**
 * 序列化的树（用于 checkpoint / 导入导出）
 */
export interface SerializedTree {
  version: string;
  rootUuid: string;
  nodes: Array<{
    uuid: string;
    path: string;
    parentUuid?: string;
    config: SubAgentConfig;
    depth: number;
    status: AgentStatus;
    children: string[];
    currentTask?: AgentTask;
    completedTasks: number;
    failedTasks: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    tokensUsed: number;
    contextUsage: number;
    error?: string;
    metadata: Record<string, unknown>;
  }>;
  exportedAt: number;
}

/**
 * 引擎统计信息
 */
export interface NestedSubAgentStats {
  totalAgents: number;
  totalCompleted: number;
  totalFailed: number;
  totalTokensUsed: number;
  averageDepth: number;
  maxDepthReached: number;
  byRole: Record<AgentRole, number>;
  byStatus: Record<AgentStatus, number>;
}

// ============ 默认配置 ============

/**
 * 默认嵌套子代理配置
 */
export const DEFAULT_NESTED_SUB_AGENT_CONFIG: NestedSubAgentConfig = {
  maxDepth: 3,
  defaultModel: 'sonnet',
  defaultReasoningEffort: 'medium',
  defaultTimeoutMs: 300000, // 5 分钟
  persist: true,
  maxConcurrency: 8,
  contextCompactThreshold: 0.85,
};

// ============ 工具函数 ============

/**
 * 生成节点 UUID
 */
export function generateNodeUuid(): string {
  return 'nsa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 生成任务 ID
 */
export function generateTaskId(): string {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 验证路径段（kebab-case）
 */
export function isValidPathSegment(segment: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(segment) && segment.length > 0 && segment.length <= 64;
}

/**
 * 解析路径
 * @throws Error 路径无效
 */
export function parsePath(path: string): string[] {
  if (!path || typeof path !== 'string') {
    throw new Error(`Path must be a non-empty string: ${path}`);
  }
  if (!path.startsWith('/')) {
    throw new Error(`Path must start with '/': ${path}`);
  }
  const segments = path.slice(1).split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Path cannot be empty after '/'`);
  }
  if (segments[0] !== 'root') {
    throw new Error(`Path must start with /root: ${path}`);
  }
  for (const seg of segments) {
    if (!isValidPathSegment(seg)) {
      throw new Error(`Invalid path segment: '${seg}' (must be kebab-case)`);
    }
  }
  // 校验段名是否在保留关键字内
  for (const seg of segments) {
    if (RESERVED_NAMES.has(seg)) {
      throw new Error(`Path segment cannot be reserved keyword: ${seg}`);
    }
  }
  return segments;
}

/**
 * 构造路径
 */
export function buildPath(parentPath: string, name: string): string {
  if (!isValidPathSegment(name)) {
    throw new Error(`Invalid name (must be kebab-case): ${name}`);
  }
  return parentPath === '/' || parentPath === '' ? `/${name}` : `${parentPath}/${name}`;
}

/**
 * 验证深度限制
 */
export function checkDepthLimit(parentDepth: number, maxDepth: number): void {
  if (parentDepth + 1 >= maxDepth) {
    throw new DepthLimitError(
      `Cannot create child agent: max depth ${maxDepth} reached (parent at depth ${parentDepth})`
    );
  }
}

/**
 * 保留路径段
 * 注意：'root' 不在保留字中，因为路径必须以 /root 开头
 */
const RESERVED_NAMES = new Set([
  'admin',
  'system',
  'internal',
  '..',
  '.',
  '__proto__',
  'constructor',
]);

// ============ 错误类型 ============

/**
 * 深度限制错误
 */
export class DepthLimitError extends Error {
  override name = 'DepthLimitError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * 循环检测错误
 */
export class CycleError extends Error {
  override name = 'CycleError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * 节点未找到错误
 */
export class NodeNotFoundError extends Error {
  override name = 'NodeNotFoundError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * 任务超时错误
 */
export class TaskTimeoutError extends Error {
  override name = 'TaskTimeoutError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * 配置无效错误
 */
export class InvalidConfigError extends Error {
  override name = 'InvalidConfigError';
  constructor(message: string) {
    super(message);
  }
}

// ============ 角色元数据 ============

/**
 * 角色元数据
 */
export const ROLE_METADATA: Record<AgentRole, { label: string; icon: string; color: string }> = {
  coordinator: { label: '协调者', icon: '🎯', color: 'text-purple-600' },
  researcher: { label: '研究者', icon: '🔍', color: 'text-blue-600' },
  analyzer: { label: '分析者', icon: '📊', color: 'text-cyan-600' },
  builder: { label: '构建者', icon: '🔨', color: 'text-green-600' },
  reviewer: { label: '审查者', icon: '👀', color: 'text-yellow-600' },
  tester: { label: '测试者', icon: '🧪', color: 'text-pink-600' },
  refactorer: { label: '重构者', icon: '♻️', color: 'text-orange-600' },
  documenter: { label: '文档者', icon: '📝', color: 'text-indigo-600' },
  custom: { label: '自定义', icon: '⚙️', color: 'text-slate-600' },
};

/**
 * 状态元数据
 */
export const STATUS_METADATA: Record<AgentStatus, { label: string; color: string; icon: string }> = {
  idle: { label: '空闲', color: 'text-slate-500', icon: '⚪' },
  running: { label: '运行中', color: 'text-blue-500', icon: '🔵' },
  paused: { label: '已暂停', color: 'text-yellow-500', icon: '🟡' },
  completed: { label: '已完成', color: 'text-green-500', icon: '🟢' },
  failed: { label: '已失败', color: 'text-red-500', icon: '🔴' },
  timeout: { label: '已超时', color: 'text-orange-500', icon: '⏱️' },
  cancelled: { label: '已取消', color: 'text-slate-400', icon: '⚫' },
};

/**
 * 模型元数据
 */
export const MODEL_METADATA: Record<ModelChoice, { label: string; costTier: number }> = {
  haiku: { label: 'Haiku (快速)', costTier: 1 },
  sonnet: { label: 'Sonnet (平衡)', costTier: 2 },
  opus: { label: 'Opus (强推理)', costTier: 3 },
  'gpt-5': { label: 'GPT-5 (通用)', costTier: 3 },
  'gpt-5-mini': { label: 'GPT-5 Mini', costTier: 2 },
  inherit: { label: '继承父级', costTier: 0 },
};

/**
 * 推理强度元数据
 */
export const REASONING_METADATA: Record<ReasoningEffort, { label: string; multiplier: number }> = {
  low: { label: '低', multiplier: 0.5 },
  medium: { label: '中', multiplier: 1.0 },
  high: { label: '高', multiplier: 2.0 },
};

/**
 * 默认上下文窗口（按模型）
 */
export const DEFAULT_CONTEXT_WINDOWS: Record<ModelChoice, number> = {
  haiku: 8000,
  sonnet: 200000,
  opus: 200000,
  'gpt-5': 128000,
  'gpt-5-mini': 64000,
  inherit: 200000,
};

/**
 * 估算 token 数（粗略）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 英文约 4 字符 = 1 token；中文约 1.5 字符 = 1 token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
