/**
 * # ============================================================
 * # Agent Template Types - 代理模板类型 (v1.0.0 Cycle 27 G27-05)
 * # ============================================================
 * # 核心作用：定义代理模板系统的类型、配置与元数据
 * # 参考：Claude Code 2026-06 #9 subagent + Codex /agents 命令
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-05 初次创建
 * # ============================================================
 */

/**
 * 模板作用域
 */
export type AgentTemplateScope = 'builtin' | 'user' | 'team' | 'community';

/**
 * 模板分类
 */
export type AgentTemplateCategory =
  | 'code-review' // 代码评审
  | 'debugging' // 调试
  | 'testing' // 测试
  | 'refactoring' // 重构
  | 'security' // 安全审计
  | 'documentation' // 文档
  | 'performance' // 性能
  | 'migration' // 迁移
  | 'general'; // 通用

/**
 * 模板角色（对应 SubAgentConfig.role）
 */
export type AgentTemplateRole = 'worker' | 'reviewer' | 'planner' | 'executor' | 'coordinator';

/**
 * 模型偏好
 */
export type AgentTemplateModel = 'haiku' | 'sonnet' | 'opus';

/**
 * 推理强度
 */
export type AgentTemplateReasoning = 'low' | 'medium' | 'high';

/**
 * 代理模板
 */
export interface AgentTemplate {
  /** 唯一 ID（builtin-xxx 或 user-xxx） */
  id: string;
  /** 模板名（短名） */
  name: string;
  /** 模板分类 */
  category: AgentTemplateCategory;
  /** 作用域 */
  scope: AgentTemplateScope;
  /** 显示名（中文/英文） */
  displayName: string;
  /** 描述 */
  description: string;
  /** 角色 */
  role: AgentTemplateRole;
  /** 推荐模型 */
  model: AgentTemplateModel;
  /** 推理强度 */
  reasoningEffort: AgentTemplateReasoning;
  /** 系统提示（Markdown） */
  systemPrompt: string;
  /** 工具白名单 */
  tools: string[];
  /** 约束 */
  constraints: string[];
  /** 上下文窗口 */
  contextWindow: number;
  /** 超时（毫秒） */
  timeoutMs: number;
  /** 是否隔离 worktree */
  worktreeIsolation: boolean;
  /** 标签（用于搜索） */
  tags: string[];
  /** 作者（builtin 为空） */
  author?: string;
  /** 版本（SemVer） */
  version: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 安装次数（市场用） */
  installCount?: number;
  /** 评分 0-5 */
  rating?: number;
  /** 评分人数 */
  ratingCount?: number;
  /** 缩略图（emoji） */
  icon: string;
}

/**
 * 模板市场项（包含已安装状态）
 */
export interface AgentTemplateMarketEntry {
  template: AgentTemplate;
  installed: boolean;
  installedAt?: number;
  installedVersion?: string;
  hasUpdate: boolean;
}

/**
 * 模板安装记录
 */
export interface AgentTemplateInstall {
  templateId: string;
  installedAt: number;
  version: string;
}

/**
 * 模板引擎配置
 */
export interface AgentTemplateConfig {
  /** 最大保留模板数（含 builtin） */
  maxTemplates: number;
  /** 持久化 */
  persist: boolean;
  /** 启用社区市场（mock） */
  enableCommunity: boolean;
  /** 默认安装目录（mock） */
  installPath: string;
}

/**
 * 事件类型
 */
export type AgentTemplateEventType =
  | 'template-installed'
  | 'template-uninstalled'
  | 'template-updated'
  | 'template-rated'
  | 'market-refreshed'
  | 'template-imported'
  | 'template-exported';

/**
 * 事件
 */
export interface AgentTemplateEvent {
  type: AgentTemplateEventType;
  timestamp: number;
  templateId?: string;
  data?: Record<string, unknown>;
}

/**
 * 模板评分
 */
export interface AgentTemplateRating {
  templateId: string;
  score: number;
  comment?: string;
  ratedAt: number;
}

/**
 * 默认配置
 */
export const DEFAULT_AGENT_TEMPLATE_CONFIG: AgentTemplateConfig = {
  maxTemplates: 200,
  persist: true,
  enableCommunity: true,
  installPath: '~/.hermes/agents/',
};

/**
 * 分类元数据
 */
export const TEMPLATE_CATEGORY_METADATA: Record<AgentTemplateCategory, { label: string; icon: string; color: string }> = {
  'code-review': { label: '代码评审', icon: '🔍', color: 'text-blue-500' },
  debugging: { label: '调试排错', icon: '🐛', color: 'text-red-500' },
  testing: { label: '测试编写', icon: '🧪', color: 'text-green-500' },
  refactoring: { label: '重构优化', icon: '♻️', color: 'text-purple-500' },
  security: { label: '安全审计', icon: '🔒', color: 'text-orange-500' },
  documentation: { label: '文档生成', icon: '📚', color: 'text-cyan-500' },
  performance: { label: '性能优化', icon: '⚡', color: 'text-yellow-500' },
  migration: { label: '迁移重构', icon: '🚚', color: 'text-pink-500' },
  general: { label: '通用', icon: '🤖', color: 'text-slate-500' },
};

/**
 * 作用域元数据
 */
export const TEMPLATE_SCOPE_METADATA: Record<AgentTemplateScope, { label: string; icon: string; color: string }> = {
  builtin: { label: '内置', icon: '🏠', color: 'text-slate-500' },
  user: { label: '用户', icon: '👤', color: 'text-blue-500' },
  team: { label: '团队', icon: '👥', color: 'text-purple-500' },
  community: { label: '社区', icon: '🌐', color: 'text-green-500' },
};

/**
 * 模型元数据
 */
export const TEMPLATE_MODEL_METADATA: Record<AgentTemplateModel, { label: string; cost: number; speed: number }> = {
  haiku: { label: 'Haiku', cost: 0.0001, speed: 10 },
  sonnet: { label: 'Sonnet', cost: 0.003, speed: 5 },
  opus: { label: 'Opus', cost: 0.015, speed: 2 },
};

/**
 * 推理强度元数据
 */
export const TEMPLATE_REASONING_METADATA: Record<AgentTemplateReasoning, { label: string; icon: string }> = {
  low: { label: '低', icon: '🟢' },
  medium: { label: '中', icon: '🟡' },
  high: { label: '高', icon: '🔴' },
};

/**
 * 角色元数据
 */
export const TEMPLATE_ROLE_METADATA: Record<AgentTemplateRole, { label: string; icon: string }> = {
  worker: { label: '工作者', icon: '⚒️' },
  reviewer: { label: '审查者', icon: '👁️' },
  planner: { label: '规划者', icon: '🧭' },
  executor: { label: '执行者', icon: '🎯' },
  coordinator: { label: '协调者', icon: '🎼' },
};

/**
 * 生成模板 ID
 */
export function generateTemplateId(scope: AgentTemplateScope, name: string): string {
  const prefix = scope === 'builtin' ? 'builtin' : scope === 'user' ? 'user' : scope === 'team' ? 'team' : 'community';
  return `${prefix}-${name}`;
}

/**
 * 校验模板名称（kebab-case）
 * 规则：以小写字母开头，仅含小写字母/数字/单个连字符
 *      不能以连字符开头/结尾，不能有连续连字符
 */
export function isValidTemplateName(name: string): boolean {
  if (name.length < 3 || name.length > 33) return false;
  if (name.startsWith('-') || name.endsWith('-')) return false;
  if (name.includes('--')) return false;
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name);
}
