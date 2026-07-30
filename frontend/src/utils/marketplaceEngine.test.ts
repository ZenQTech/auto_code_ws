/**
 * # ============================================================
 * # Marketplace Engine Tests (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 * # 覆盖列表/搜索/安装/卸载/评分/评论/统计等核心功能
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SkillsMarketplace } from './marketplaceEngine';
import { detectSentiment, isValidComment, generateMarketplaceId } from './marketplaceTypes';

describe('SkillsMarketplace', () => {
  let mp: SkillsMarketplace;

  beforeEach(() => {
    mp = new SkillsMarketplace({ persist: false });
  });

  describe('初始化', () => {
    it('加载示例数据：6 个技能', () => {
      const all = mp.listSkills();
      expect(all.length).toBeGreaterThanOrEqual(6);
    });

    it('加载示例评论', () => {
      const comments = mp.getComments('mp-code-review-pro');
      expect(comments.length).toBeGreaterThan(0);
    });

    it('初始所有技能未安装', () => {
      const all = mp.listSkills();
      expect(all.every((s) => !s.installed)).toBe(true);
    });
  });

  describe('listSkills - 列表', () => {
    it('列出所有技能', () => {
      const all = mp.listSkills();
      expect(all.length).toBeGreaterThan(0);
    });

    it('按分类过滤', () => {
      const securitySkills = mp.listSkills({ category: 'security' });
      expect(securitySkills.every((s) => s.category === 'security')).toBe(true);
      expect(securitySkills.length).toBeGreaterThan(0);
    });

    it('按安装数排序（默认）', () => {
      const sorted = mp.listSkills({ sortBy: 'installs' });
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].installs).toBeGreaterThanOrEqual(sorted[i].installs);
      }
    });

    it('按评分排序', () => {
      const sorted = mp.listSkills({ sortBy: 'rating' });
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].rating).toBeGreaterThanOrEqual(sorted[i].rating);
      }
    });

    it('按名称排序', () => {
      const sorted = mp.listSkills({ sortBy: 'name' });
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].displayName.localeCompare(sorted[i].displayName)).toBeLessThanOrEqual(0);
      }
    });

    it('installedOnly 过滤', () => {
      mp.installSkill('mp-code-review-pro');
      const installed = mp.listSkills({ installedOnly: true });
      expect(installed.length).toBe(1);
      expect(installed[0].id).toBe('mp-code-review-pro');
    });
  });

  describe('searchSkills - 搜索', () => {
    it('按名称搜索', () => {
      const results = mp.searchSkills('review');
      expect(results.some((s) => s.name.includes('review'))).toBe(true);
    });

    it('按标签搜索', () => {
      const results = mp.searchSkills('security');
      expect(results.length).toBeGreaterThan(0);
    });

    it('大小写不敏感', () => {
      const r1 = mp.searchSkills('REVIEW');
      const r2 = mp.searchSkills('review');
      expect(r1.length).toBe(r2.length);
    });

    it('空查询返回所有', () => {
      const all = mp.searchSkills('');
      expect(all.length).toBeGreaterThan(0);
    });
  });

  describe('installSkill - 安装', () => {
    it('成功安装', () => {
      const skill = mp.installSkill('mp-code-review-pro');
      expect(skill.installed).toBe(true);
      expect(skill.installedAt).toBeDefined();
    });

    it('安装次数+1', () => {
      const before = mp.getSkill('mp-code-review-pro')!.installs;
      mp.installSkill('mp-code-review-pro');
      const after = mp.getSkill('mp-code-review-pro')!.installs;
      expect(after).toBe(before + 1);
    });

    it('重复安装幂等', () => {
      mp.installSkill('mp-code-review-pro');
      const before = mp.getSkill('mp-code-review-pro')!.installs;
      mp.installSkill('mp-code-review-pro');
      const after = mp.getSkill('mp-code-review-pro')!.installs;
      expect(after).toBe(before);
    });

    it('安装不存在的技能抛错', () => {
      expect(() => mp.installSkill('nonexistent-skill')).toThrow();
    });
  });

  describe('uninstallSkill - 卸载', () => {
    it('成功卸载', () => {
      mp.installSkill('mp-code-review-pro');
      mp.uninstallSkill('mp-code-review-pro');
      const skill = mp.getSkill('mp-code-review-pro');
      expect(skill?.installed).toBe(false);
      expect(skill?.installedAt).toBeUndefined();
    });

    it('卸载未安装的技能不报错', () => {
      expect(() => mp.uninstallSkill('mp-code-review-pro')).not.toThrow();
    });
  });

  describe('installMany - 批量安装', () => {
    it('批量安装多个', () => {
      const result = mp.installMany(['mp-code-review-pro', 'mp-refactor-assistant']);
      expect(result.length).toBe(2);
      expect(result.every((s) => s.installed)).toBe(true);
    });

    it('跳过不存在的技能', () => {
      const result = mp.installMany(['mp-code-review-pro', 'nonexistent']);
      expect(result.length).toBe(1);
    });
  });

  describe('rateSkill - 评分', () => {
    it('成功评分', () => {
      mp.rateSkill('mp-code-review-pro', 5);
      const skill = mp.getSkill('mp-code-review-pro')!;
      expect(skill.ratingCount).toBeGreaterThan(0);
    });

    it('同一用户更新评分', () => {
      mp.rateSkill('mp-code-review-pro', 3, 'user-1');
      mp.rateSkill('mp-code-review-pro', 5, 'user-1');
      const ratings = mp.getRatings('mp-code-review-pro');
      const user1 = ratings.find((r) => r.ratedBy === 'user-1');
      expect(user1?.rating).toBe(5);
    });

    it('不同用户独立评分', () => {
      mp.rateSkill('mp-code-review-pro', 4, 'user-1');
      mp.rateSkill('mp-code-review-pro', 5, 'user-2');
      const ratings = mp.getRatings('mp-code-review-pro');
      const u1 = ratings.find((r) => r.ratedBy === 'user-1');
      const u2 = ratings.find((r) => r.ratedBy === 'user-2');
      expect(u1?.rating).toBe(4);
      expect(u2?.rating).toBe(5);
    });

    it('评分无效值抛错', () => {
      expect(() => mp.rateSkill('mp-code-review-pro', 6 as any)).toThrow();
      expect(() => mp.rateSkill('mp-code-review-pro', 0 as any)).toThrow();
    });

    it('getUserRating 返回指定用户的评分', () => {
      mp.rateSkill('mp-code-review-pro', 4, 'user-1');
      const r = mp.getUserRating('mp-code-review-pro', 'user-1');
      expect(r?.rating).toBe(4);
    });
  });

  describe('commentOnSkill - 评论', () => {
    it('成功评论', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '非常棒的工具，强烈推荐');
      expect(c.id).toBeDefined();
      expect(c.sentiment).toBe('positive');
    });

    it('拒绝空评论', () => {
      expect(() => mp.commentOnSkill('mp-code-review-pro', '')).toThrow();
    });

    it('拒绝过短评论', () => {
      expect(() => mp.commentOnSkill('mp-code-review-pro', 'abc')).toThrow();
    });

    it('拒绝超长评论', () => {
      const long = 'a'.repeat(600);
      expect(() => mp.commentOnSkill('mp-code-review-pro', long)).toThrow();
    });

    it('检测负面评论', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '太差了，烂到爆');
      expect(c.sentiment).toBe('negative');
    });

    it('检测中性评论', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '一般般，可用');
      expect(c.sentiment).toBe('neutral');
    });

    it('拒绝重复评论', () => {
      mp.commentOnSkill('mp-code-review-pro', '测试评论内容');
      expect(() => mp.commentOnSkill('mp-code-review-pro', '测试评论内容')).toThrow();
    });

    it('评论带评分', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '好用的工具，推荐', 'user-1', 4);
      expect(c.rating).toBe(4);
    });
  });

  describe('getComments - 获取评论', () => {
    beforeEach(() => {
      mp.commentOnSkill('mp-code-review-pro', '第一条评论');
    });

    it('按最新排序', () => {
      const list = mp.getComments('mp-code-review-pro', 'newest');
      expect(list.length).toBeGreaterThan(0);
    });

    it('按最旧排序', () => {
      const list = mp.getComments('mp-code-review-pro', 'oldest');
      expect(list.length).toBeGreaterThan(0);
    });
  });

  describe('markCommentHelpful & flagComment', () => {
    it('标记评论有用', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '很棒的技能');
      mp.markCommentHelpful(c.id);
      const updated = mp
        .getComments('mp-code-review-pro')
        .find((cm) => cm.id === c.id);
      expect(updated?.helpful).toBe(1);
    });

    it('举报评论', () => {
      const c = mp.commentOnSkill('mp-code-review-pro', '需要举报的评论');
      mp.flagComment(c.id);
      const updated = mp
        .getComments('mp-code-review-pro')
        .find((cm) => cm.id === c.id);
      expect(updated?.flagged).toBe(true);
    });
  });

  describe('getStats - 统计', () => {
    it('返回基本统计', () => {
      const stats = mp.getStats();
      expect(stats.totalSkills).toBeGreaterThan(0);
      expect(stats.totalInstalls).toBeGreaterThan(0);
    });

    it('已安装计数', () => {
      mp.installSkill('mp-code-review-pro');
      const stats = mp.getStats();
      expect(stats.installedSkills).toBe(1);
    });

    it('topCategory', () => {
      const stats = mp.getStats();
      expect(stats.topCategory).toBeDefined();
    });

    it('recentlyUpdated >= 0', () => {
      const stats = mp.getStats();
      expect(stats.recentlyUpdated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset - 重置', () => {
    it('清空已安装状态和评论', () => {
      mp.installSkill('mp-code-review-pro');
      mp.commentOnSkill('mp-code-review-pro', '测试评论');
      mp.reset();
      const skill = mp.getSkill('mp-code-review-pro');
      expect(skill?.installed).toBe(false);
      expect(mp.getComments('mp-code-review-pro').length).toBe(0);
    });
  });

  describe('事件订阅', () => {
    it('订阅 skill-installed 事件', () => {
      let called = 0;
      mp.on('skill-installed', () => called++);
      mp.installSkill('mp-code-review-pro');
      expect(called).toBe(1);
    });

    it('订阅 skill-rated 事件', () => {
      let called = 0;
      mp.on('skill-rated', () => called++);
      mp.rateSkill('mp-code-review-pro', 5);
      expect(called).toBe(1);
    });

    it('订阅 comment-added 事件', () => {
      let called = 0;
      mp.on('comment-added', () => called++);
      mp.commentOnSkill('mp-code-review-pro', '测试评论');
      expect(called).toBe(1);
    });

    it('off 取消订阅', () => {
      let called = 0;
      const handler = () => called++;
      mp.on('skill-installed', handler);
      mp.off('skill-installed', handler);
      mp.installSkill('mp-code-review-pro');
      expect(called).toBe(0);
    });
  });
});

describe('detectSentiment', () => {
  it('正面情感', () => {
    expect(detectSentiment('非常好用 great')).toBe('positive');
  });

  it('负面情感', () => {
    expect(detectSentiment('太烂了 bad')).toBe('negative');
  });

  it('中性情感', () => {
    expect(detectSentiment('一般般')).toBe('neutral');
  });
});

describe('isValidComment', () => {
  it('空内容无效', () => {
    expect(isValidComment('', 500).valid).toBe(false);
  });

  it('超长无效', () => {
    expect(isValidComment('a'.repeat(600), 500).valid).toBe(false);
  });

  it('过短无效', () => {
    expect(isValidComment('ab', 500).valid).toBe(false);
  });

  it('正常长度有效', () => {
    expect(isValidComment('很好的技能', 500).valid).toBe(true);
  });
});

describe('generateMarketplaceId', () => {
  it('生成带前缀的唯一 ID', () => {
    const id = generateMarketplaceId('test');
    expect(id.startsWith('mp-test-')).toBe(true);
  });

  it('多次生成 ID 不重复', () => {
    const a = generateMarketplaceId('test');
    const b = generateMarketplaceId('test');
    expect(a).not.toBe(b);
  });
});
