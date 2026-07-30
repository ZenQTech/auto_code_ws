/**
 * # ============================================================
 * # Skill Types - 技能系统类型定义 (v1.0.0 Cycle 28 G28-01)
 * # ============================================================
 * # 核心作用：定义 Codex SKILL.md 兼容的技能系统类型
 * # 参考：OpenAI Codex 2025-12 Agent Skills
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-01 初次创建
 * # ============================================================
 */

// ============ 基础类型 ============

export type SkillScriptLanguage = 'bash' | 'python' | 'node' | 'other';

export interface SkillScript {
  name: string;
  path: string;
  language: SkillScriptLanguage;
  description: string;
}

export interface SkillReference {
  name: string;
  path: string;
  type: 'doc' | 'example' | 'spec';
}

export interface SkillAsset {
  name: string;
  path: string;
  type: 'template' | 'image' | 'binary';
}

// ============ 主体类型 ============

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  path: string;
  allowedTools: string[];
  constraints: string[];
  body: string;
  scripts: SkillScript[];
  references: SkillReference[];
  assets: SkillAsset[];
  builtin: boolean;
  installed: boolean;
  enabled: boolean;
  installedAt?: number;
  usageCount: number;
  lastUsedAt?: number;
  metadata: Record<string, unknown>;
}

// 渐进式披露：仅包含概要信息
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  builtin: boolean;
  tags: string[];
  usageCount: number;
}

// ============ 匹配与执行 ============

export interface SkillMatch {
  skill: SkillSummary;
  score: number; // 0-1
  matchedKeywords: string[];
}

export interface SkillExecutionContext {
  skillName: string;
  args: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  output?: string;
  error?: string;
  success: boolean;
}

export interface SkillExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  skillId: string;
}

// ============ 事件 ============

export type SkillEventType =
  | 'skill-installed'
  | 'skill-uninstalled'
  | 'skill-enabled'
  | 'skill-disabled'
  | 'skill-matched'
  | 'skill-invoked'
  | 'skill-completed'
  | 'skill-failed'
  | 'skill-usage-tracked';

export interface SkillEvent {
  type: SkillEventType;
  timestamp: number;
  skillId?: string;
  skillName?: string;
  data?: Record<string, unknown>;
}

// ============ 配置 ============

export interface SkillEngineConfig {
  persist: boolean;
  /** 匹配阈值 0-1 */
  matchThreshold: number;
  /** topK 数量 */
  topK: number;
  /** 渐进式披露：summary 字符上限 */
  summaryCharLimit: number;
  /** context window 比例上限 */
  contextWindowRatio: number;
  /** 内置 Skills 目录 */
  builtinDir: string;
  /** 用户 Skills 目录 */
  userDir: string;
}

export const DEFAULT_SKILL_ENGINE_CONFIG: SkillEngineConfig = {
  persist: true,
  matchThreshold: 0.05,
  topK: 5,
  summaryCharLimit: 8000,
  contextWindowRatio: 0.02,
  builtinDir: 'skills/builtin',
  userDir: 'skills/user',
};

// ============ 统计 ============

export interface SkillStats {
  total: number;
  enabled: number;
  builtin: number;
  user: number;
  totalUsage: number;
  topUsed: Array<{ name: string; count: number }>;
  recentMatches: Array<{ name: string; score: number; timestamp: number }>;
}

// ============ 工具函数 ============

export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
export const SKILL_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

export function generateSkillId(): string {
  return 'skill-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

export function isValidSkillVersion(version: string): boolean {
  return SKILL_VERSION_PATTERN.test(version);
}

/**
 * 计算两个字符串的简单相似度（基于关键词重合度）
 */
export function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  // 提取关键词（英文 + 中文）
  const aWords = new Set(aLower.match(/[a-z0-9一-鿿]+/g) || []);
  const bWords = new Set(bLower.match(/[a-z0-9一-鿿]+/g) || []);
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let intersect = 0;
  for (const w of aWords) {
    if (bWords.has(w)) intersect++;
  }
  const union = new Set([...aWords, ...bWords]).size;
  return intersect / union;
}

/**
 * 截断 description 以适应 summary 字符限制
 */
export function truncateDescription(description: string, limit: number): string {
  if (description.length <= limit) return description;
  return description.slice(0, limit - 3) + '...';
}

/**
 * 提取 description 中的关键词（用于匹配增强）
 */
export function extractTriggerKeywords(description: string): string[] {
  // 提取中文 + 英文关键词
  const words = description.match(/[a-zA-Z][a-zA-Z0-9-]+|[一-鿿]{2,}/g) || [];
  return Array.from(new Set(words.map((w) => w.toLowerCase()))).slice(0, 20);
}
