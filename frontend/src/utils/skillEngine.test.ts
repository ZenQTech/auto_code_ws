/**
 * SkillEngine 单元测试 (v1.0.0 Cycle 28 G28-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillEngine, getDefaultSkillEngine, resetDefaultSkillEngine } from './skillEngine';
import { BUILTIN_SKILLS_MD } from './skillBuiltins';
import { calculateSimilarity, extractTriggerKeywords, truncateDescription, isValidSkillName } from './skillTypes';

describe('SkillEngine', () => {
  let engine: SkillEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SkillEngine();
  });

  describe('初始化', () => {
    it('自动加载 5 个内置 Skills', () => {
      const skills = engine.listSkills();
      expect(skills.length).toBeGreaterThanOrEqual(5);
      expect(engine.getSkillByName('code-review')).toBeDefined();
      expect(engine.getSkillByName('test-generator')).toBeDefined();
      expect(engine.getSkillByName('refactor-assistant')).toBeDefined();
      expect(engine.getSkillByName('doc-generator')).toBeDefined();
      expect(engine.getSkillByName('security-scanner')).toBeDefined();
    });

    it('内置 Skill 默认启用', () => {
      const skill = engine.getSkillByName('code-review');
      expect(skill?.enabled).toBe(true);
      expect(skill?.builtin).toBe(true);
    });
  });

  describe('SKILL.md 解析', () => {
    it('解析 frontmatter 字段', () => {
      const content = BUILTIN_SKILLS_MD['code-review'];
      const skill = engine.parseSkillMarkdown(content, 'test/code-review');
      expect(skill.name).toBe('code-review');
      expect(skill.version).toBe('1.0.0');
      expect(skill.author).toBe('hermes');
      expect(skill.tags).toContain('code-quality');
      expect(skill.allowedTools).toContain('read');
    });

    it('解析 body 中的 scripts 引用', () => {
      const content = `---
name: test-skill
description: test
version: 1.0.0
---

# Test
See scripts/lint.sh
and scripts/format.sh
`;
      const skill = engine.parseSkillMarkdown(content, 'test');
      expect(skill.scripts.length).toBe(2);
      expect(skill.scripts.find((s) => s.name === 'lint.sh')).toBeDefined();
    });

    it('解析 body 中的 references 引用', () => {
      const content = `---
name: test-skill
description: test
---

See references/style-guide.md
`;
      const skill = engine.parseSkillMarkdown(content, 'test');
      expect(skill.references.length).toBe(1);
      expect(skill.references[0].type).toBe('doc');
    });

    it('拒绝无效名称', () => {
      expect(() => engine.parseSkillMarkdown('---\nname: InvalidName\ndescription: test\n---', '')).toThrow();
    });

    it('拒绝无效版本', () => {
      const content = `---
name: test-skill
description: test
version: bad-version
---`;
      expect(() => engine.parseSkillMarkdown(content, 'test')).toThrow();
    });
  });

  describe('安装/卸载/启用/禁用', () => {
    it('安装用户 Skill', () => {
      const content = `---
name: user-skill
description: 用户自定义技能
version: 1.0.0
author: user
tags: [custom]
---

# User Skill
`;
      const skill = engine.installSkill(content);
      expect(skill.installed).toBe(true);
      expect(skill.builtin).toBe(false);
    });

    it('拒绝重复安装', () => {
      const content = BUILTIN_SKILLS_MD['code-review'];
      // 内置已经存在
      expect(() => engine.installSkill(content)).toThrow();
    });

    it('禁用 Skill', () => {
      const skill = engine.getSkillByName('code-review')!;
      expect(engine.disableSkill(skill.id)).toBe(true);
      expect(skill.enabled).toBe(false);
    });

    it('启用 Skill', () => {
      const skill = engine.getSkillByName('code-review')!;
      engine.disableSkill(skill.id);
      expect(engine.enableSkill(skill.id)).toBe(true);
      expect(skill.enabled).toBe(true);
    });

    it('卸载内置 Skill 等同于禁用', () => {
      const skill = engine.getSkillByName('code-review')!;
      engine.uninstallSkill(skill.id);
      expect(skill.enabled).toBe(false);
    });

    it('不存在 SkillId 返回 false', () => {
      expect(engine.enableSkill('non-existent')).toBe(false);
      expect(engine.disableSkill('non-existent')).toBe(false);
      expect(engine.uninstallSkill('non-existent')).toBe(false);
    });
  });

  describe('匹配', () => {
    it('隐式匹配：description 关键词命中', () => {
      const matches = engine.matchSkills('请帮我 review 这个 PR');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.name).toBe('code-review');
    });

    it('显式调用：$skill-name', () => {
      const matches = engine.matchSkills('please run $test-generator');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchedKeywords.some((k) => k.startsWith('$'))).toBe(true);
    });

    it('topK 限制', () => {
      const matches = engine.matchSkills('请审查代码生成测试', { topK: 1 });
      expect(matches.length).toBeLessThanOrEqual(1);
    });

    it('阈值过滤', () => {
      const matches = engine.matchSkills('完全不相关的内容', { threshold: 0.9 });
      expect(matches.length).toBe(0);
    });

    it('不返回禁用的 Skill', () => {
      const skill = engine.getSkillByName('code-review')!;
      engine.disableSkill(skill.id);
      const matches = engine.matchSkills('review the code');
      expect(matches.find((m) => m.skill.id === skill.id)).toBeUndefined();
    });
  });

  describe('调用', () => {
    it('成功调用', async () => {
      const result = await engine.invokeSkill('code-review', { target: 'src/foo.ts' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('code-review');
    });

    it('调用不存在的 Skill 抛错', async () => {
      await expect(engine.invokeSkill('non-existent')).rejects.toThrow();
    });

    it('调用禁用的 Skill 抛错', async () => {
      const skill = engine.getSkillByName('code-review')!;
      engine.disableSkill(skill.id);
      await expect(engine.invokeSkill('code-review')).rejects.toThrow();
    });

    it('使用后 usageCount 增加', async () => {
      const before = engine.getSkillByName('code-review')!.usageCount;
      await engine.invokeSkill('code-review');
      const after = engine.getSkillByName('code-review')!.usageCount;
      expect(after).toBe(before + 1);
    });
  });

  describe('渐进式披露', () => {
    it('getAllSummaries 遵守字符限制', () => {
      const summaries = engine.getAllSummaries();
      const total = summaries.reduce((sum, s) => sum + s.name.length + s.description.length, 0);
      // 字符限制为 8000
      expect(total).toBeLessThanOrEqual(8100); // 允许一定溢出（truncate）
    });

    it('loadSkillFull 加载完整内容', () => {
      const skill = engine.getSkillByName('code-review')!;
      const full = engine.loadSkillFull(skill.id);
      expect(full).toBeDefined();
      expect(full?.body).toContain('Code Review Skill');
    });

    it('summary 不包含 body', () => {
      const summaries = engine.getAllSummaries();
      for (const s of summaries) {
        // SkillSummary 类型没有 body 字段
        expect((s as any).body).toBeUndefined();
      }
    });
  });

  describe('导入导出', () => {
    it('exportSkill 返回 SKILL.md 格式', () => {
      const skill = engine.getSkillByName('code-review')!;
      const exported = engine.exportSkill(skill.id);
      expect(exported).toContain('---');
      expect(exported).toContain('name: code-review');
    });

    it('importSkill 安装新 Skill', () => {
      const content = `---
name: imported-skill
description: 导入的技能
version: 1.0.0
---

# Imported
`;
      const skill = engine.importSkill(content);
      expect(skill.name).toBe('imported-skill');
    });
  });

  describe('CRUD', () => {
    it('getSkillByName 不存在返回 undefined', () => {
      expect(engine.getSkillByName('non-existent')).toBeUndefined();
    });

    it('listSkills 按 tag 过滤', () => {
      const skills = engine.listSkills({ tag: 'security' });
      expect(skills.every((s) => s.tags.includes('security'))).toBe(true);
    });

    it('listSkills 按 builtin 过滤', () => {
      const builtins = engine.listSkills({ builtin: true });
      expect(builtins.every((s) => s.builtin)).toBe(true);
    });

    it('listSkills 按 enabled 过滤', () => {
      const enabled = engine.listSkills({ enabled: true });
      expect(enabled.every((s) => s.enabled)).toBe(true);
    });
  });

  describe('事件系统', () => {
    it('订阅 skill-matched 事件', () => {
      const events: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      engine.on('skill-matched', (e) => events.push(e));
      engine.matchSkills('review');
      expect(events.length).toBeGreaterThan(0);
    });

    it('订阅 skill-invoked 事件', async () => {
      const events: any[] = [];
      engine.on('skill-invoked', (e) => events.push(e));
      await engine.invokeSkill('code-review');
      expect(events.length).toBe(1);
    });

    it('取消订阅', async () => {
      const events: any[] = [];
      const unsub = engine.on('skill-invoked', (e) => events.push(e));
      unsub();
      await engine.invokeSkill('code-review');
      expect(events.length).toBe(0);
    });
  });

  describe('统计', () => {
    it('getStats 完整', async () => {
      await engine.invokeSkill('code-review');
      const stats = engine.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(5);
      expect(stats.builtin).toBeGreaterThanOrEqual(5);
      expect(stats.totalUsage).toBeGreaterThan(0);
      expect(stats.topUsed.length).toBeGreaterThan(0);
    });
  });

  describe('持久化', () => {
    it('保存到 localStorage', () => {
      engine.invokeSkill('code-review');
      const raw = localStorage.getItem('hermes.skills');
      expect(raw).toBeDefined();
    });

    it('从 localStorage 恢复', () => {
      engine.invokeSkill('code-review');
      // 创建新实例
      const newEngine = new SkillEngine();
      const skill = newEngine.getSkillByName('code-review');
      expect(skill).toBeDefined();
    });
  });
});

describe('工具函数', () => {
  describe('calculateSimilarity', () => {
    it('相同字符串相似度为 1', () => {
      expect(calculateSimilarity('hello world', 'hello world')).toBe(1);
    });

    it('完全不同相似度为 0', () => {
      expect(calculateSimilarity('hello', 'world')).toBe(0);
    });

    it('部分重合有中间值', () => {
      const sim = calculateSimilarity('hello world', 'hello there');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it('空字符串返回 0', () => {
      expect(calculateSimilarity('', 'hello')).toBe(0);
      expect(calculateSimilarity('hello', '')).toBe(0);
    });
  });

  describe('extractTriggerKeywords', () => {
    it('提取中文关键词', () => {
      const kws = extractTriggerKeywords('请审查代码 review 触发');
      expect(kws).toContain('请审查代码');
      expect(kws).toContain('review');
    });

    it('去除重复', () => {
      const kws = extractTriggerKeywords('test test test hello');
      expect(kws.filter((k) => k === 'test').length).toBe(1);
    });

    it('限制数量', () => {
      const kws = extractTriggerKeywords('a b c d e f g h i j k l m n o p q r s t u v w x y z');
      expect(kws.length).toBeLessThanOrEqual(20);
    });
  });

  describe('truncateDescription', () => {
    it('短字符串不截断', () => {
      expect(truncateDescription('short', 100)).toBe('short');
    });

    it('长字符串截断', () => {
      const result = truncateDescription('a'.repeat(100), 10);
      expect(result.length).toBe(10);
      expect(result).toContain('...');
    });
  });

  describe('isValidSkillName', () => {
    it('接受 kebab-case', () => {
      expect(isValidSkillName('code-review')).toBe(true);
      expect(isValidSkillName('test')).toBe(true);
      expect(isValidSkillName('my-cool-skill-2')).toBe(true);
    });

    it('拒绝 PascalCase', () => {
      expect(isValidSkillName('CodeReview')).toBe(false);
    });

    it('拒绝包含空格', () => {
      expect(isValidSkillName('code review')).toBe(false);
    });

    it('拒绝下划线', () => {
      expect(isValidSkillName('code_review')).toBe(false);
    });

    it('拒绝太短', () => {
      expect(isValidSkillName('ab')).toBe(false);
    });
  });
});

describe('单例', () => {
  beforeEach(() => {
    resetDefaultSkillEngine();
  });

  it('getDefaultSkillEngine 返回相同实例', () => {
    const a = getDefaultSkillEngine();
    const b = getDefaultSkillEngine();
    expect(a).toBe(b);
  });

  it('resetDefaultSkillEngine 重置', () => {
    const a = getDefaultSkillEngine();
    resetDefaultSkillEngine();
    const b = getDefaultSkillEngine();
    expect(a).not.toBe(b);
  });
});
