/**
 * HookTemplateMarketplace 单元测试 (v1.0.0 Cycle 21 G21-05)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HookTemplateMarketplace,
  getHookTemplateMarketplace,
  resetHookTemplateMarketplace,
  isHookTemplateMarketplaceInitialized,
  PRESET_TEMPLATES,
} from './hookTemplateMarketplace';

describe('HookTemplateMarketplace', () => {
  let marketplace: HookTemplateMarketplace;

  beforeEach(() => {
    resetHookTemplateMarketplace();
    marketplace = getHookTemplateMarketplace();
  });

  describe('单例', () => {
    it('返回相同实例', () => {
      const a = getHookTemplateMarketplace();
      const b = getHookTemplateMarketplace();
      expect(a).toBe(b);
    });

    it('isHookTemplateMarketplaceInitialized', () => {
      expect(isHookTemplateMarketplaceInitialized()).toBe(true);
    });
  });

  describe('预置模板', () => {
    it('加载 8 个预置模板', () => {
      expect(PRESET_TEMPLATES.length).toBe(8);
    });

    it('包含 ESLint 模板', () => {
      const found = marketplace.get('preset-eslint-check');
      expect(found).toBeDefined();
      expect(found?.category).toBe('quality');
    });

    it('包含 Prettier 模板', () => {
      const found = marketplace.get('preset-prettier-format');
      expect(found).toBeDefined();
    });

    it('包含 TypeScript 检查模板', () => {
      const found = marketplace.get('preset-typescript-check');
      expect(found).toBeDefined();
    });

    it('包含 Vitest 测试模板', () => {
      const found = marketplace.get('preset-vitest-run');
      expect(found).toBeDefined();
      expect(found?.category).toBe('testing');
    });

    it('包含覆盖率检查模板', () => {
      const found = marketplace.get('preset-coverage-check');
      expect(found).toBeDefined();
    });

    it('包含提交信息校验模板', () => {
      const found = marketplace.get('preset-commit-msg-check');
      expect(found).toBeDefined();
      expect(found?.category).toBe('git');
    });

    it('包含敏感信息扫描模板', () => {
      const found = marketplace.get('preset-secrets-scan');
      expect(found).toBeDefined();
    });

    it('包含 Slack 通知模板', () => {
      const found = marketplace.get('preset-slack-notify');
      expect(found).toBeDefined();
      expect(found?.category).toBe('collaboration');
    });
  });

  describe('list', () => {
    it('列出所有模板', () => {
      const list = marketplace.list();
      expect(list.length).toBeGreaterThanOrEqual(8);
    });

    it('按分类过滤', () => {
      const quality = marketplace.list({ category: 'quality' });
      expect(quality.every((t) => t.category === 'quality')).toBe(true);
    });

    it('按标签过滤', () => {
      const eslint = marketplace.list({ tag: 'eslint' });
      expect(eslint.every((t) => t.tags.includes('eslint'))).toBe(true);
    });

    it('按搜索过滤', () => {
      const results = marketplace.list({ search: 'eslint' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('按评分过滤', () => {
      const highRated = marketplace.list({ minRating: 4.5 });
      expect(highRated.every((t) => t.rating >= 4.5)).toBe(true);
    });

    it('按 verified 过滤', () => {
      const verified = marketplace.list({ verified: true });
      expect(verified.every((t) => t.verified)).toBe(true);
    });

    it('按评分排序', () => {
      const sorted = marketplace.list({ sortBy: 'rating', sortOrder: 'desc' });
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (prev && curr) {
          expect(prev.rating).toBeGreaterThanOrEqual(curr.rating);
        }
      }
    });
  });

  describe('addTemplate', () => {
    it('添加自定义模板', () => {
      const tpl = marketplace.addTemplate({
        name: 'Custom Hook',
        description: 'My custom hook',
        category: 'custom',
        tags: ['custom'],
        author: 'me',
        verified: false,
        icon: 'custom',
        hookDefinition: {
          type: 'before_prompt',
          name: 'Custom',
          scope: 'user',
          enabled: true,
          action: { type: 'webhook', url: 'https://test' },
          priority: 100,
          timeoutMs: 5000,
          retries: 0,
          fallback: 'ignore',
        },
        version: '1.0.0',
      });
      expect(tpl.id).toBeDefined();
      expect(tpl.installCount).toBe(0);
    });
  });

  describe('installTemplate', () => {
    it('安装模板', () => {
      const result = marketplace.installTemplate('preset-eslint-check');
      expect(result.success).toBe(true);
      expect(result.hookId).toBeDefined();
    });

    it('不存在模板返回失败', () => {
      const result = marketplace.installTemplate('non-existent');
      expect(result.success).toBe(false);
    });

    it('重复安装返回失败', () => {
      marketplace.installTemplate('preset-eslint-check');
      const result = marketplace.installTemplate('preset-eslint-check');
      expect(result.success).toBe(false);
    });

    it('安装次数递增', () => {
      const before = marketplace.get('preset-eslint-check')?.installCount ?? 0;
      marketplace.installTemplate('preset-eslint-check');
      const after = marketplace.get('preset-eslint-check')?.installCount ?? 0;
      expect(after).toBe(before + 1);
    });
  });

  describe('uninstallTemplate', () => {
    it('卸载已安装模板', () => {
      marketplace.installTemplate('preset-eslint-check');
      const success = marketplace.uninstallTemplate('preset-eslint-check');
      expect(success).toBe(true);
    });

    it('卸载未安装返回 false', () => {
      const success = marketplace.uninstallTemplate('preset-eslint-check');
      expect(success).toBe(false);
    });
  });

  describe('isInstalled', () => {
    it('正确返回安装状态', () => {
      expect(marketplace.isInstalled('preset-eslint-check')).toBe(false);
      marketplace.installTemplate('preset-eslint-check');
      expect(marketplace.isInstalled('preset-eslint-check')).toBe(true);
    });
  });

  describe('getInstalledTemplates', () => {
    it('返回已安装模板', () => {
      marketplace.installTemplate('preset-eslint-check');
      marketplace.installTemplate('preset-vitest-run');
      const installed = marketplace.getInstalledTemplates();
      expect(installed.length).toBe(2);
    });
  });

  describe('rateTemplate', () => {
    it('评分模板', () => {
      marketplace.rateTemplate('preset-eslint-check', 5);
      const t = marketplace.get('preset-eslint-check');
      expect(t?.rating).toBeGreaterThan(4);
    });

    it('拒绝无效评分', () => {
      expect(() => marketplace.rateTemplate('preset-eslint-check', 6)).toThrow();
      expect(() => marketplace.rateTemplate('preset-eslint-check', -1)).toThrow();
    });

    it('不存在模板抛错', () => {
      expect(() => marketplace.rateTemplate('non-existent', 5)).toThrow();
    });
  });

  describe('search', () => {
    it('搜索模板', () => {
      const results = marketplace.search('eslint');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getByCategory', () => {
    it('按分类获取', () => {
      const quality = marketplace.getByCategory('quality');
      expect(quality.length).toBeGreaterThan(0);
      expect(quality.every((t) => t.category === 'quality')).toBe(true);
    });
  });

  describe('getCategories', () => {
    it('返回所有分类', () => {
      const cats = marketplace.getCategories();
      expect(cats.length).toBeGreaterThan(0);
      expect(cats).toContain('quality');
      expect(cats).toContain('testing');
    });
  });

  describe('getAllTags', () => {
    it('返回所有标签', () => {
      const tags = marketplace.getAllTags();
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  describe('exportHookDefinition', () => {
    it('导出 hook 定义', () => {
      const def = marketplace.exportHookDefinition('preset-eslint-check');
      expect(def).toBeDefined();
      expect(def?.id).toBeDefined();
      expect(def?.type).toBe('after_response');
    });

    it('不存在模板返回 null', () => {
      expect(marketplace.exportHookDefinition('non-existent')).toBeNull();
    });
  });

  describe('removeTemplate', () => {
    it('删除自定义模板', () => {
      const tpl = marketplace.addTemplate({
        name: 'Test',
        description: 'Test',
        category: 'custom',
        tags: [],
        author: 'me',
        verified: false,
        hookDefinition: {
          type: 'before_prompt',
          name: 't',
          scope: 'user',
          enabled: true,
          action: { type: 'webhook', url: 'https://test' },
          priority: 100,
          timeoutMs: 5000,
          retries: 0,
          fallback: 'ignore',
        },
        version: '1.0.0',
      });
      const success = marketplace.removeTemplate(tpl.id);
      expect(success).toBe(true);
    });

    it('不能删除预置模板', () => {
      const success = marketplace.removeTemplate('preset-eslint-check');
      expect(success).toBe(false);
    });
  });

  describe('getStats', () => {
    it('返回统计', () => {
      const stats = marketplace.getStats();
      expect(stats.totalTemplates).toBeGreaterThan(0);
      expect(stats.verifiedCount).toBeGreaterThan(0);
      expect(stats.avgRating).toBeGreaterThan(0);
    });
  });
});
