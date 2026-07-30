/**
 * # ============================================================
 * # Agent Template Engine 单元测试 (v1.0.0 Cycle 27 G27-05)
 * # ============================================================
 * # 覆盖：模板查询、用户模板 CRUD、市场安装/卸载、评分、导入导出
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentTemplateEngine,
  getDefaultAgentTemplateEngine,
  resetDefaultAgentTemplateEngine,
} from './agentTemplateEngine';
import { BUILTIN_AGENT_TEMPLATES, COMMUNITY_AGENT_TEMPLATES } from './agentTemplateBuiltins';
import { generateTemplateId, isValidTemplateName } from './agentTemplateTypes';

describe('AgentTemplateEngine', () => {
  let engine: AgentTemplateEngine;

  beforeEach(() => {
    engine = new AgentTemplateEngine({ persist: false });
  });

  describe('初始状态', () => {
    it('加载所有 builtin 模板', () => {
      const installed = engine.listInstalled();
      expect(installed.length).toBe(BUILTIN_AGENT_TEMPLATES.length);
    });

    it('builtin 模板都是 builtin scope', () => {
      const builtin = engine.listInstalled({ scope: 'builtin' });
      expect(builtin.length).toBe(BUILTIN_AGENT_TEMPLATES.length);
      builtin.forEach((t) => expect(t.scope).toBe('builtin'));
    });

    it('初始无用户模板', () => {
      const user = engine.listInstalled({ scope: 'user' });
      expect(user.length).toBe(0);
    });

    it('统计信息正确', () => {
      const stats = engine.getStats();
      expect(stats.builtinCount).toBe(BUILTIN_AGENT_TEMPLATES.length);
      expect(stats.userCount).toBe(0);
      expect(stats.communityCount).toBe(0);
    });
  });

  describe('模板查询', () => {
    it('通过 ID 获取模板', () => {
      const t = engine.getTemplate('builtin-code-reviewer');
      expect(t).toBeDefined();
      expect(t?.name).toBe('code-reviewer');
    });

    it('通过名称获取模板', () => {
      const t = engine.getTemplateByName('code-reviewer');
      expect(t).toBeDefined();
      expect(t?.id).toBe('builtin-code-reviewer');
    });

    it('通过名称 + scope 过滤', () => {
      const t = engine.getTemplateByName('code-reviewer', 'builtin');
      expect(t).toBeDefined();
    });

    it('不存在的 ID 返回 undefined', () => {
      expect(engine.getTemplate('not-exist')).toBeUndefined();
    });

    it('按 category 过滤', () => {
      const codeReview = engine.listInstalled({ category: 'code-review' });
      expect(codeReview.length).toBe(1);
      expect(codeReview[0].name).toBe('code-reviewer');
    });

    it('按关键字搜索（name/displayName/description/tags）', () => {
      const byName = engine.listInstalled({ search: 'code-reviewer' });
      expect(byName.length).toBeGreaterThan(0);
      const byTag = engine.listInstalled({ search: 'debug' });
      expect(byTag.length).toBeGreaterThan(0);
      const byDesc = engine.listInstalled({ search: '性能' });
      expect(byDesc.length).toBeGreaterThan(0);
    });

    it('空搜索返回全部', () => {
      const all = engine.listInstalled();
      const searched = engine.listInstalled({ search: '' });
      expect(all.length).toBe(searched.length);
    });
  });

  describe('用户模板 CRUD', () => {
    it('创建用户模板', () => {
      const t = engine.createUserTemplate({
        name: 'my-custom-agent',
        category: 'general',
        displayName: '我的自定义',
        description: '测试',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '你是测试',
        tools: ['Read'],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: ['test'],
        icon: '🧪',
      });
      expect(t.id).toBe('user-my-custom-agent');
      expect(t.scope).toBe('user');
      expect(t.version).toBe('1.0.0');
    });

    it('非法名称抛错', () => {
      expect(() =>
        engine.createUserTemplate({
          name: 'Invalid Name!',
          category: 'general',
          displayName: 't',
          description: '',
          role: 'worker',
          model: 'sonnet',
          reasoningEffort: 'medium',
          systemPrompt: '',
          tools: [],
          constraints: [],
          contextWindow: 8000,
          timeoutMs: 30000,
          worktreeIsolation: false,
          tags: [],
          icon: '🤖',
        })
      ).toThrow();
    });

    it('重复名称抛错', () => {
      const base = {
        category: 'general' as const,
        displayName: 't',
        description: '',
        role: 'worker' as const,
        model: 'sonnet' as const,
        reasoningEffort: 'medium' as const,
        systemPrompt: '',
        tools: [] as string[],
        constraints: [] as string[],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [] as string[],
        icon: '🤖',
      };
      engine.createUserTemplate({ ...base, name: 'dup-name' });
      expect(() => engine.createUserTemplate({ ...base, name: 'dup-name' })).toThrow();
    });

    it('更新用户模板', () => {
      const t = engine.createUserTemplate({
        name: 'to-update',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: 'old',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      const updated = engine.updateUserTemplate(t.id, { displayName: '新名', description: '新描述' });
      expect(updated.displayName).toBe('新名');
      expect(updated.systemPrompt).toBe('old'); // 未变更
    });

    it('不能更新 builtin', () => {
      expect(() => engine.updateUserTemplate('builtin-code-reviewer', { displayName: 'x' })).toThrow();
    });

    it('不能删除 builtin', () => {
      expect(() => engine.deleteUserTemplate('builtin-code-reviewer')).toThrow();
    });

    it('删除用户模板', () => {
      const t = engine.createUserTemplate({
        name: 'to-delete',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      const ok = engine.deleteUserTemplate(t.id);
      expect(ok).toBe(true);
      expect(engine.getTemplate(t.id)).toBeUndefined();
    });

    it('删除不存在的模板返回 false', () => {
      expect(engine.deleteUserTemplate('not-exist')).toBe(false);
    });
  });

  describe('市场安装/卸载', () => {
    it('从社区市场安装模板', () => {
      const communityId = COMMUNITY_AGENT_TEMPLATES[0].id;
      const t = engine.installTemplate(communityId);
      expect(t).toBeDefined();
      expect(engine.getTemplate(communityId)).toBeDefined();
    });

    it('安装 builtin 不会重复', () => {
      const t = engine.installTemplate('builtin-code-reviewer');
      expect(t.id).toBe('builtin-code-reviewer');
    });

    it('卸载用户/社区模板', () => {
      const communityId = COMMUNITY_AGENT_TEMPLATES[0].id;
      engine.installTemplate(communityId);
      const ok = engine.uninstallTemplate(communityId);
      expect(ok).toBe(true);
    });

    it('不能卸载 builtin', () => {
      expect(() => engine.uninstallTemplate('builtin-code-reviewer')).toThrow();
    });

    it('卸载不存在的返回 false', () => {
      expect(engine.uninstallTemplate('not-exist')).toBe(false);
    });

    it('市场列表包含 builtin + community', () => {
      const market = engine.getMarketList();
      expect(market.length).toBe(BUILTIN_AGENT_TEMPLATES.length + COMMUNITY_AGENT_TEMPLATES.length);
    });

    it('市场列表标记 installed 状态', () => {
      const market = engine.getMarketList();
      const builtins = market.filter((m) => m.template.scope === 'builtin');
      builtins.forEach((m) => expect(m.installed).toBe(true));
    });

    it('市场按关键字搜索', () => {
      const market = engine.getMarketList({ search: 'react' });
      expect(market.length).toBeGreaterThan(0);
    });

    it('市场按 category 过滤', () => {
      const market = engine.getMarketList({ category: 'performance' });
      expect(market.length).toBeGreaterThan(0);
      market.forEach((m) => expect(m.template.category).toBe('performance'));
    });
  });

  describe('模板更新', () => {
    it('用户模板更新自动 bump patch version', () => {
      const t = engine.createUserTemplate({
        name: 'ver-test',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      const updated = engine.updateTemplate(t.id);
      expect(updated.version).not.toBe('1.0.0');
      expect(updated.version).toBe('1.0.1');
    });

    it('社区模板更新为最新版本', () => {
      const communityId = COMMUNITY_AGENT_TEMPLATES[0].id;
      engine.installTemplate(communityId);
      const updated = engine.updateTemplate(communityId);
      expect(updated).toBeDefined();
    });

    it('builtin 模板更新不变更', () => {
      const t1 = engine.getTemplate('builtin-code-reviewer');
      const t2 = engine.updateTemplate('builtin-code-reviewer');
      expect(t2.version).toBe(t1?.version);
    });
  });

  describe('模板评分', () => {
    it('评分模板', () => {
      const updated = engine.rateTemplate('builtin-code-reviewer', 5, '很好用');
      expect(updated.rating).toBe(5);
      expect(updated.ratingCount).toBe(1);
    });

    it('评分替换旧评分', () => {
      engine.rateTemplate('builtin-code-reviewer', 3);
      const updated = engine.rateTemplate('builtin-code-reviewer', 5);
      expect(updated.rating).toBe(5);
    });

    it('评分超出范围抛错', () => {
      expect(() => engine.rateTemplate('builtin-code-reviewer', 6)).toThrow();
      expect(() => engine.rateTemplate('builtin-code-reviewer', -1)).toThrow();
    });

    it('评分不存在的模板抛错', () => {
      expect(() => engine.rateTemplate('not-exist', 5)).toThrow();
    });
  });

  describe('模板派生（fork）', () => {
    it('从 builtin 派生', () => {
      const forked = engine.forkTemplate('builtin-code-reviewer', 'my-reviewer');
      expect(forked.id).toBe('user-my-reviewer');
      expect(forked.scope).toBe('user');
      expect(forked.version).toBe('1.0.0');
      expect(forked.name).toBe('my-reviewer');
      // 应保留原始 systemPrompt
      expect(forked.systemPrompt).toBe(engine.getTemplate('builtin-code-reviewer')?.systemPrompt);
    });

    it('从 community 派生', () => {
      const communityId = COMMUNITY_AGENT_TEMPLATES[0].id;
      const forked = engine.forkTemplate(communityId, 'my-fork');
      expect(forked.id).toBe('user-my-fork');
    });

    it('派生重名抛错', () => {
      engine.forkTemplate('builtin-code-reviewer', 'a-fork');
      expect(() => engine.forkTemplate('builtin-code-reviewer', 'a-fork')).toThrow();
    });

    it('派生名称非法抛错', () => {
      expect(() => engine.forkTemplate('builtin-code-reviewer', 'Invalid Name')).toThrow();
    });

    it('派生不存在模板抛错', () => {
      expect(() => engine.forkTemplate('not-exist', 'foo')).toThrow();
    });
  });

  describe('导入导出', () => {
    it('导出模板为 JSON', () => {
      const json = engine.exportTemplate('builtin-code-reviewer');
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe('builtin-code-reviewer');
    });

    it('导出不存在模板抛错', () => {
      expect(() => engine.exportTemplate('not-exist')).toThrow();
    });

    it('导出所有用户模板', () => {
      engine.createUserTemplate({
        name: 'a-tpl',
        category: 'general',
        displayName: 'A',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      const json = engine.exportAllUserTemplates();
      const parsed = JSON.parse(json);
      expect(parsed.templates.length).toBe(1);
    });

    it('导入模板（数组）', () => {
      const json = JSON.stringify([
        {
          name: 'imported-1',
          displayName: 'I1',
          description: '',
          systemPrompt: 'p',
          tools: [],
          constraints: [],
          contextWindow: 8000,
          timeoutMs: 30000,
          icon: '🤖',
        },
      ]);
      const imported = engine.importTemplates(json);
      expect(imported.length).toBe(1);
      expect(imported[0].scope).toBe('user');
    });

    it('导入模板（对象+ templates 字段）', () => {
      const json = JSON.stringify({
        templates: [
          {
            name: 'imported-2',
            displayName: 'I2',
            description: '',
            systemPrompt: 'p',
            tools: [],
            constraints: [],
            contextWindow: 8000,
            timeoutMs: 30000,
            icon: '🤖',
          },
        ],
      });
      const imported = engine.importTemplates(json);
      expect(imported.length).toBe(1);
    });

    it('导入无效 JSON 抛错', () => {
      expect(() => engine.importTemplates('not json')).toThrow();
    });

    it('导入非法名称的模板被跳过', () => {
      const json = JSON.stringify([
        { name: 'Invalid Name!', displayName: 'X' },
        { name: 'valid-name', displayName: 'OK' },
      ]);
      const imported = engine.importTemplates(json);
      expect(imported.length).toBe(1);
      expect(imported[0].name).toBe('valid-name');
    });
  });

  describe('事件系统', () => {
    it('订阅 template-installed 事件', () => {
      const handler = (e: any) => {
        expect(e.type).toBe('template-installed');
        expect(e.data?.source).toBe('created');
      };
      engine.on('template-installed', handler);
      engine.createUserTemplate({
        name: 'event-test',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
    });

    it('订阅 template-uninstalled 事件', () => {
      let called = false;
      engine.on('template-uninstalled', () => {
        called = true;
      });
      const t = engine.createUserTemplate({
        name: 'to-uninst',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      engine.deleteUserTemplate(t.id);
      expect(called).toBe(true);
    });

    it('订阅 template-updated 事件', () => {
      let called = false;
      engine.on('template-updated', () => {
        called = true;
      });
      const t = engine.createUserTemplate({
        name: 'to-upd',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      engine.updateTemplate(t.id);
      expect(called).toBe(true);
    });

    it('订阅 template-rated 事件', () => {
      let called = false;
      engine.on('template-rated', () => {
        called = true;
      });
      engine.rateTemplate('builtin-code-reviewer', 4);
      expect(called).toBe(true);
    });

    it('订阅 template-imported 事件', () => {
      let called = false;
      engine.on('template-imported', () => {
        called = true;
      });
      engine.importTemplates(JSON.stringify([{ name: 'imp', displayName: 'I' }]));
      expect(called).toBe(true);
    });

    it('off 取消订阅', () => {
      const handler = () => {
        throw new Error('should not be called');
      };
      engine.on('template-rated', handler);
      engine.off('template-rated', handler);
      engine.rateTemplate('builtin-code-reviewer', 4);
    });
  });

  describe('清空', () => {
    it('clearUserTemplates 保留 builtin', () => {
      engine.createUserTemplate({
        name: 'will-be-cleared',
        category: 'general',
        displayName: 't',
        description: '',
        role: 'worker',
        model: 'sonnet',
        reasoningEffort: 'medium',
        systemPrompt: '',
        tools: [],
        constraints: [],
        contextWindow: 8000,
        timeoutMs: 30000,
        worktreeIsolation: false,
        tags: [],
        icon: '🤖',
      });
      engine.clearUserTemplates();
      expect(engine.getTemplate('user-will-be-cleared')).toBeUndefined();
      expect(engine.getTemplate('builtin-code-reviewer')).toBeDefined();
    });
  });

  describe('启用/禁用社区市场', () => {
    it('enableCommunity=false 时市场不含社区模板', () => {
      const e = new AgentTemplateEngine({ persist: false, enableCommunity: false });
      const market = e.getMarketList();
      const communityInMarket = market.filter((m) => m.template.scope === 'community');
      expect(communityInMarket.length).toBe(0);
    });

    it('enableCommunity=true 时市场含社区模板', () => {
      const market = engine.getMarketList();
      const communityInMarket = market.filter((m) => m.template.scope === 'community');
      expect(communityInMarket.length).toBeGreaterThan(0);
    });
  });

  describe('工具函数', () => {
    it('generateTemplateId 格式正确', () => {
      expect(generateTemplateId('builtin', 'foo')).toBe('builtin-foo');
      expect(generateTemplateId('user', 'bar')).toBe('user-bar');
      expect(generateTemplateId('team', 'baz')).toBe('team-baz');
      expect(generateTemplateId('community', 'qux')).toBe('community-qux');
    });

    it('isValidTemplateName 校验 kebab-case', () => {
      expect(isValidTemplateName('ab')).toBe(false); // 太短
      expect(isValidTemplateName('foo')).toBe(true); // 3 字符是 min
      expect(isValidTemplateName('foo-bar')).toBe(true);
      expect(isValidTemplateName('a-b-c-d')).toBe(true);
      expect(isValidTemplateName('Foo-Bar')).toBe(false);
      expect(isValidTemplateName('foo_bar')).toBe(false);
      expect(isValidTemplateName('123-foo')).toBe(false);
      expect(isValidTemplateName('-foo')).toBe(false);
      expect(isValidTemplateName('foo-')).toBe(false);
      expect(isValidTemplateName('foo--bar')).toBe(false); // 双连字符
    });
  });

  describe('单例', () => {
    it('getDefaultAgentTemplateEngine 返回同一实例', () => {
      resetDefaultAgentTemplateEngine();
      const e1 = getDefaultAgentTemplateEngine();
      const e2 = getDefaultAgentTemplateEngine();
      expect(e1).toBe(e2);
    });

    it('resetDefaultAgentTemplateEngine 重置单例', () => {
      const e1 = getDefaultAgentTemplateEngine();
      resetDefaultAgentTemplateEngine();
      const e2 = getDefaultAgentTemplateEngine();
      expect(e1).not.toBe(e2);
    });
  });
});
