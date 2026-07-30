/**
 * # ============================================================
 * # Marketplace Engine - 技能市场核心实现 (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 * # 核心作用：实现 Skills Marketplace 的浏览/安装/评分/评论
 * # 运行流程：
 * #   1. 加载示例数据（6 个示例技能 + 5 条评论）
 * #   2. listSkills 按分类/排序过滤
 * #   3. installSkill 安装到本地（标记 installed=true）
 * #   4. rateSkill/commentOnSkill 用户评分评论
 * #   5. 事件总线实时通知
 * # 输入参数：listSkills(filter) / installSkill(id) / rateSkill(id, rating) / commentOnSkill(id, content)
 * # 输出结果：MarketplaceSkill / MarketplaceComment / MarketplaceStats
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-02 初次创建
 * # ============================================================
 */

import {
  MarketplaceSkill,
  MarketplaceComment,
  MarketplaceRating,
  MarketplaceStats,
  MarketplaceEvent,
  MarketplaceEventType,
  MarketplaceConfig,
  MarketplaceSortBy,
  SkillCategory,
  DEFAULT_MARKETPLACE_CONFIG,
  generateMarketplaceId,
  detectSentiment,
  isValidComment,
} from './marketplaceTypes';
import { SAMPLE_MARKETPLACE_SKILLS, SAMPLE_MARKETPLACE_COMMENTS } from './marketplaceSamples';

/**
 * 技能市场引擎
 */
export class SkillsMarketplace {
  private config: MarketplaceConfig;
  private skills: Map<string, MarketplaceSkill> = new Map();
  private comments: Map<string, MarketplaceComment[]> = new Map();
  private ratings: MarketplaceRating[] = [];
  private listeners: Map<MarketplaceEventType, Set<(e: MarketplaceEvent) => void>> = new Map();
  private storageKey = 'hermes.marketplace';
  private ratingsStorageKey = 'hermes.marketplace.ratings';

  constructor(config: Partial<MarketplaceConfig> = {}) {
    this.config = { ...DEFAULT_MARKETPLACE_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    // 加载示例数据
    this.loadSamples();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw =
        typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.installedSkills)) {
          // 合并已安装状态
          for (const item of data.installedSkills) {
            const existing = this.skills.get(item.id);
            if (existing) {
              existing.installed = true;
              existing.installedAt = item.installedAt;
            }
          }
        }
        if (data && Array.isArray(data.comments)) {
          for (const c of data.comments) {
            if (!this.comments.has(c.skillId)) {
              this.comments.set(c.skillId, []);
            }
            this.comments.get(c.skillId)!.push(c);
          }
        }
      }
      const ratingsRaw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(this.ratingsStorageKey)
          : null;
      if (ratingsRaw) {
        const data = JSON.parse(ratingsRaw);
        if (data && Array.isArray(data.ratings)) {
          this.ratings = data.ratings;
        }
      }
    } catch (e) {
      console.warn('SkillsMarketplace: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const installedSkills = Array.from(this.skills.values())
        .filter((s) => s.installed)
        .map((s) => ({ id: s.id, installedAt: s.installedAt }));
      const allComments: MarketplaceComment[] = [];
      for (const list of this.comments.values()) {
        allComments.push(...list);
      }
      const data = { installedSkills, comments: allComments };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
      const ratingsData = { ratings: this.ratings };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.ratingsStorageKey, JSON.stringify(ratingsData));
      }
    } catch (e) {
      console.warn('SkillsMarketplace: failed to save', e);
    }
  }

  private loadSamples(): void {
    // 如果还没加载，加载示例数据
    if (this.skills.size === 0) {
      for (const skill of SAMPLE_MARKETPLACE_SKILLS) {
        this.skills.set(skill.id, { ...skill });
      }
    }
    if (this.comments.size === 0) {
      for (const c of SAMPLE_MARKETPLACE_COMMENTS) {
        if (!this.comments.has(c.skillId)) {
          this.comments.set(c.skillId, []);
        }
        this.comments.get(c.skillId)!.push(c);
      }
    }
  }

  // ============ 事件总线 ============

  on(event: MarketplaceEventType, listener: (e: MarketplaceEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: MarketplaceEventType, listener: (e: MarketplaceEvent) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: MarketplaceEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (e) {
          console.error('SkillsMarketplace listener error:', e);
        }
      }
    }
  }

  // ============ 列表查询 ============

  /**
   * 列出市场技能（支持过滤+排序）
   */
  listSkills(filter?: {
    category?: SkillCategory | 'all';
    sortBy?: MarketplaceSortBy;
    searchQuery?: string;
    installedOnly?: boolean;
  }): MarketplaceSkill[] {
    let result = Array.from(this.skills.values());

    if (filter?.category && filter.category !== 'all') {
      result = result.filter((s) => s.category === filter.category);
    }
    if (filter?.installedOnly) {
      result = result.filter((s) => s.installed);
    }
    if (filter?.searchQuery) {
      const q = filter.searchQuery.toLowerCase().trim();
      if (q.length > 0) {
        result = result.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.displayName.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
    }

    const sortBy = filter?.sortBy ?? 'installs';
    result.sort((a, b) => {
      switch (sortBy) {
        case 'installs':
          return b.installs - a.installs;
        case 'rating':
          return b.rating - a.rating || b.ratingCount - a.ratingCount;
        case 'newest':
          return b.publishedAt - a.publishedAt;
        case 'name':
          return a.displayName.localeCompare(b.displayName);
        default:
          return 0;
      }
    });

    return result;
  }

  /**
   * 获取单个技能
   */
  getSkill(skillId: string): MarketplaceSkill | null {
    return this.skills.get(skillId) ?? null;
  }

  /**
   * 搜索技能（语义搜索）
   */
  searchSkills(query: string): MarketplaceSkill[] {
    return this.listSkills({ searchQuery: query });
  }

  // ============ 安装管理 ============

  /**
   * 安装技能
   */
  installSkill(skillId: string): MarketplaceSkill {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (skill.installed) {
      // 已安装，幂等返回
      return skill;
    }
    skill.installed = true;
    skill.installedAt = Date.now();
    skill.installs += 1;
    this.save();
    this.emit({
      type: 'skill-installed',
      timestamp: Date.now(),
      skillId,
      data: { name: skill.name, displayName: skill.displayName },
    });
    return skill;
  }

  /**
   * 卸载技能
   */
  uninstallSkill(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (!skill.installed) {
      return;
    }
    skill.installed = false;
    skill.installedAt = undefined;
    this.save();
    this.emit({
      type: 'skill-uninstalled',
      timestamp: Date.now(),
      skillId,
      data: { name: skill.name },
    });
  }

  /**
   * 批量安装
   */
  installMany(skillIds: string[]): MarketplaceSkill[] {
    const result: MarketplaceSkill[] = [];
    for (const id of skillIds) {
      try {
        result.push(this.installSkill(id));
      } catch (e) {
        console.warn('installMany error:', e);
      }
    }
    return result;
  }

  // ============ 评分 ============

  /**
   * 评分技能
   */
  rateSkill(skillId: string, rating: 1 | 2 | 3 | 4 | 5, ratedBy: string = 'current-user'): void {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (rating < 1 || rating > 5) {
      throw new Error(`Rating must be between 1 and 5, got ${rating}`);
    }
    // 检查是否已评分（同一用户只能评一次）
    const existing = this.ratings.find(
      (r) => r.skillId === skillId && r.ratedBy === ratedBy
    );
    if (existing) {
      existing.rating = rating;
      existing.ratedAt = Date.now();
    } else {
      this.ratings.push({
        skillId,
        rating,
        ratedAt: Date.now(),
        ratedBy,
      });
    }
    // 重新计算平均分
    const skillRatings = this.ratings.filter((r) => r.skillId === skillId);
    const total = skillRatings.reduce((sum, r) => sum + r.rating, 0);
    skill.rating = Math.round((total / skillRatings.length) * 10) / 10;
    skill.ratingCount = skillRatings.length;
    this.save();
    this.emit({
      type: 'skill-rated',
      timestamp: Date.now(),
      skillId,
      data: { rating, newAvg: skill.rating, totalRatings: skill.ratingCount },
    });
  }

  /**
   * 获取技能的所有评分
   */
  getRatings(skillId: string): MarketplaceRating[] {
    return this.ratings.filter((r) => r.skillId === skillId);
  }

  /**
   * 获取用户对某技能的评分
   */
  getUserRating(skillId: string, ratedBy: string = 'current-user'): MarketplaceRating | null {
    return (
      this.ratings.find((r) => r.skillId === skillId && r.ratedBy === ratedBy) ?? null
    );
  }

  // ============ 评论 ============

  /**
   * 添加评论
   */
  commentOnSkill(
    skillId: string,
    content: string,
    author: string = 'current-user',
    rating?: 1 | 2 | 3 | 4 | 5
  ): MarketplaceComment {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    const validation = isValidComment(content, this.config.maxCommentLength);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    // 检查重复评论
    if (!this.config.allowDuplicateComments) {
      const existing = this.comments.get(skillId) ?? [];
      const dup = existing.find(
        (c) => c.author === author && c.content === content
      );
      if (dup) {
        throw new Error('已发表过相同内容的评论');
      }
    }
    const comment: MarketplaceComment = {
      id: generateMarketplaceId('cmt'),
      skillId,
      author,
      rating: rating ?? 5,
      content,
      sentiment: detectSentiment(content),
      createdAt: Date.now(),
      helpful: 0,
      flagged: false,
    };
    if (!this.comments.has(skillId)) {
      this.comments.set(skillId, []);
    }
    this.comments.get(skillId)!.push(comment);
    this.save();
    this.emit({
      type: 'comment-added',
      timestamp: Date.now(),
      skillId,
      data: { commentId: comment.id, sentiment: comment.sentiment },
    });
    // 如果同时评分
    if (rating !== undefined) {
      try {
        this.rateSkill(skillId, rating, author);
      } catch (e) {
        // ignore
      }
    }
    return comment;
  }

  /**
   * 获取技能的所有评论
   */
  getComments(skillId: string, sortBy: 'newest' | 'oldest' | 'helpful' = 'newest'): MarketplaceComment[] {
    const list = (this.comments.get(skillId) ?? []).slice();
    list.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return b.createdAt - a.createdAt;
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'helpful':
          return b.helpful - a.helpful;
        default:
          return 0;
      }
    });
    return list;
  }

  /**
   * 标记评论有用
   */
  markCommentHelpful(commentId: string): void {
    for (const list of this.comments.values()) {
      const c = list.find((cm) => cm.id === commentId);
      if (c) {
        c.helpful += 1;
        this.save();
        return;
      }
    }
  }

  /**
   * 举报评论
   */
  flagComment(commentId: string): void {
    for (const list of this.comments.values()) {
      const c = list.find((cm) => cm.id === commentId);
      if (c) {
        c.flagged = true;
        this.save();
        this.emit({
          type: 'comment-flagged',
          timestamp: Date.now(),
          data: { commentId, skillId: c.skillId },
        });
        return;
      }
    }
  }

  // ============ 统计 ============

  /**
   * 获取市场统计
   */
  getStats(): MarketplaceStats {
    const all = Array.from(this.skills.values());
    const installed = all.filter((s) => s.installed);
    const totalInstalls = all.reduce((sum, s) => sum + s.installs, 0);
    const totalRating = all.reduce((sum, s) => sum + s.rating * s.ratingCount, 0);
    const totalRatingCount = all.reduce((sum, s) => sum + s.ratingCount, 0);
    const averageRating =
      totalRatingCount > 0
        ? Math.round((totalRating / totalRatingCount) * 10) / 10
        : 0;

    // 统计分类
    const categoryCount = new Map<SkillCategory, number>();
    for (const s of all) {
      categoryCount.set(s.category, (categoryCount.get(s.category) ?? 0) + 1);
    }
    let topCategory: SkillCategory | null = null;
    let maxCount = 0;
    for (const [cat, count] of categoryCount) {
      if (count > maxCount) {
        topCategory = cat;
        maxCount = count;
      }
    }

    // 7 天内更新
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyUpdated = all.filter((s) => s.updatedAt >= sevenDaysAgo).length;

    // 评论总数
    let totalComments = 0;
    for (const list of this.comments.values()) {
      totalComments += list.length;
    }

    return {
      totalSkills: all.length,
      installedSkills: installed.length,
      totalInstalls,
      averageRating,
      totalComments,
      topCategory,
      recentlyUpdated,
    };
  }

  // ============ 重置 ============

  /**
   * 重置市场（清空已安装状态和评论）
   */
  reset(): void {
    for (const skill of this.skills.values()) {
      skill.installed = false;
      skill.installedAt = undefined;
    }
    this.comments.clear();
    this.ratings = [];
    this.save();
  }

  /**
   * 清理所有数据并重新加载
   */
  reload(): void {
    this.skills.clear();
    this.comments.clear();
    this.ratings = [];
    this.loadSamples();
    this.save();
    this.emit({ type: 'marketplace-loaded', timestamp: Date.now() });
  }
}

// ============ 全局单例 ============

let _defaultMarketplace: SkillsMarketplace | null = null;

/**
 * 获取默认市场引擎实例（单例）
 */
export function getDefaultMarketplace(): SkillsMarketplace {
  if (!_defaultMarketplace) {
    _defaultMarketplace = new SkillsMarketplace();
  }
  return _defaultMarketplace;
}

/**
 * 重置默认市场（用于测试）
 */
export function resetDefaultMarketplace(): void {
  if (_defaultMarketplace) {
    _defaultMarketplace.reset();
  }
  _defaultMarketplace = null;
}
