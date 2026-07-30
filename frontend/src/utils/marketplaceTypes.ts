/**
 * # ============================================================
 * # Marketplace Types - 技能市场类型定义 (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 * # 核心作用：定义 Skills Marketplace 的数据类型
 * # 参考：Codex Skills Marketplace + skills-hub.ai
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-02 初次创建
 * # ============================================================
 */

// ============ 基础类型 ============

export type SkillCategory =
  | 'code-quality'
  | 'security'
  | 'devops'
  | 'documentation'
  | 'testing'
  | 'refactoring'
  | 'productivity'
  | 'integration';

export type MarketplaceSortBy = 'installs' | 'rating' | 'newest' | 'name';

export type CommentSentiment = 'positive' | 'neutral' | 'negative';

// ============ 主体类型 ============

/**
 * 市场技能条目（比 Skill 多了市场维度信息）
 */
export interface MarketplaceSkill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  longDescription: string;
  author: string;
  authorVerified: boolean;
  category: SkillCategory;
  tags: string[];
  version: string;
  /** 发布时间戳 */
  publishedAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 安装次数 */
  installs: number;
  /** 周活跃用户 */
  weeklyActiveUsers: number;
  /** 平均评分 (1-5) */
  rating: number;
  /** 评分数量 */
  ratingCount: number;
  /** 缩略图 URL（emoji 或路径） */
  thumbnail: string;
  /** 仓库链接 */
  repositoryUrl?: string;
  /** 文档链接 */
  documentationUrl?: string;
  /** 已安装标记 */
  installed: boolean;
  /** 安装时间戳 */
  installedAt?: number;
  /** 兼容性：Codex / Claude Code / Hermes / All */
  compatibility: Array<'codex' | 'claude-code' | 'hermes'>;
  /** 必需权限 */
  requiredPermissions: string[];
  /** 估计 Token 开销 */
  estimatedTokenCost: number;
}

export interface MarketplaceComment {
  id: string;
  skillId: string;
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  content: string;
  sentiment: CommentSentiment;
  createdAt: number;
  helpful: number;
  flagged: boolean;
}

export interface MarketplaceRating {
  skillId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  ratedAt: number;
  ratedBy: string;
}

export interface MarketplaceStats {
  totalSkills: number;
  installedSkills: number;
  totalInstalls: number;
  averageRating: number;
  totalComments: number;
  topCategory: SkillCategory | null;
  recentlyUpdated: number;
}

export type MarketplaceEventType =
  | 'marketplace-loaded'
  | 'skill-installed'
  | 'skill-uninstalled'
  | 'skill-rated'
  | 'comment-added'
  | 'comment-flagged'
  | 'search-performed';

export interface MarketplaceEvent {
  type: MarketplaceEventType;
  timestamp: number;
  skillId?: string;
  data?: Record<string, unknown>;
}

// ============ 引擎配置 ============

export interface MarketplaceConfig {
  /** 是否启用持久化（localStorage） */
  persist: boolean;
  /** 默认分类 */
  defaultCategory: SkillCategory;
  /** 单页显示数量 */
  pageSize: number;
  /** 评论最大长度 */
  maxCommentLength: number;
  /** 是否允许重复评论 */
  allowDuplicateComments: boolean;
}

export const DEFAULT_MARKETPLACE_CONFIG: MarketplaceConfig = {
  persist: true,
  defaultCategory: 'code-quality',
  pageSize: 12,
  maxCommentLength: 500,
  allowDuplicateComments: false,
};

// ============ 工具函数 ============

export const MARKETPLACE_CATEGORIES: Array<{
  value: SkillCategory;
  label: string;
  icon: string;
}> = [
  { value: 'code-quality', label: '代码质量', icon: '✨' },
  { value: 'security', label: '安全审计', icon: '🔒' },
  { value: 'devops', label: 'DevOps', icon: '⚙️' },
  { value: 'documentation', label: '文档生成', icon: '📚' },
  { value: 'testing', label: '测试', icon: '🧪' },
  { value: 'refactoring', label: '重构', icon: '🔧' },
  { value: 'productivity', label: '生产力', icon: '⚡' },
  { value: 'integration', label: '集成', icon: '🔌' },
];

export function generateMarketplaceId(prefix: string): string {
  return (
    'mp-' +
    prefix +
    '-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * 推断评论情感（基于关键词）
 */
export function detectSentiment(content: string): CommentSentiment {
  const positive = ['great', 'excellent', 'amazing', 'good', 'love', 'perfect', 'helpful', '好', '棒', '优秀', '推荐'];
  const negative = ['bad', 'broken', 'terrible', 'awful', 'hate', 'useless', 'buggy', '差', '烂', '不推荐', '故障'];

  const lower = content.toLowerCase();
  let posCount = 0;
  let negCount = 0;
  for (const kw of positive) {
    if (lower.includes(kw)) posCount++;
  }
  for (const kw of negative) {
    if (lower.includes(kw)) negCount++;
  }
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

/**
 * 验证评论内容
 */
export function isValidComment(content: string, maxLength: number): { valid: boolean; reason?: string } {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: '评论内容不能为空' };
  }
  if (content.length > maxLength) {
    return { valid: false, reason: `评论长度不能超过 ${maxLength} 字符` };
  }
  if (content.length < 4) {
    return { valid: false, reason: '评论至少 4 个字符' };
  }
  return { valid: true };
}
