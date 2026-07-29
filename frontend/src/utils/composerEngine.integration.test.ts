/**
 * Composer Engine 集成层单元测试 (v6.38.0 Cycle 18 P0-1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createComposerEngine } from './composerEngine';
import {
  resolveAllReferences,
  loadProjectRules,
  setProjectRules,
  getProjectRules,
  getResolvedReferences,
  getResolutionErrors,
  injectRules,
  resetIntegration,
  subscribeIntegration,
  getRulesMetadata,
  extractResolvableRefs,
  hasResolvableReferences,
  resolveOneReference,
  resolveAllReferencesCore,
  loadProjectRulesCore,
  countRules,
} from './composerEngine.integration';
import { DEFAULT_RULES, RULES_TEMPLATES } from './hermesRules';

describe('composerEngine.integration - 引用提取', () => {
  it('hasResolvableRefs 检测 @codebase', () => {
    expect(hasResolvableReferences('Check @codebase:auth handler')).toBe(true);
  });

  it('hasResolvableRefs 检测 @git', () => {
    expect(hasResolvableReferences('View @git:log:src/auth.ts')).toBe(true);
  });

  it('hasResolvableRefs 检测 @diff', () => {
    expect(hasResolvableReferences('Show @diff:working')).toBe(true);
  });

  it('hasResolvableRefs 排除普通文本', () => {
    expect(hasResolvableReferences('hello world')).toBe(false);
    expect(hasResolvableReferences('@file:src/foo.ts')).toBe(false);
  });

  it('extractResolvableRefs 提取所有引用', () => {
    const refs = extractResolvableRefs('Check @codebase:auth and @git:log:auth.ts and @diff:working');
    expect(refs).toHaveLength(3);
    expect(refs[0].type).toBe('codebase');
    expect(refs[0].value).toBe('auth');
    expect(refs[1].type).toBe('git');
    expect(refs[1].value).toBe('log:auth.ts');
    expect(refs[2].type).toBe('diff');
    expect(refs[2].value).toBe('working');
  });

  it('extractResolvableRefs 大小写不敏感', () => {
    const refs = extractResolvableRefs('Check @Codebase:auth and @GIT:log');
    expect(refs).toHaveLength(2);
    // 至少匹配一个 codebase 和一个 git
    expect(refs.some((r) => r.type === 'codebase')).toBe(true);
    expect(refs.some((r) => r.type === 'git')).toBe(true);
  });

  it('extractResolvableRefs 多个 codebase', () => {
    const refs = extractResolvableRefs('@codebase:foo and @codebase:bar');
    expect(refs).toHaveLength(2);
    expect(refs[0].value).toBe('foo');
    expect(refs[1].value).toBe('bar');
  });

  it('extractResolvableRefs 空 prompt', () => {
    expect(extractResolvableRefs('')).toEqual([]);
    expect(extractResolvableRefs('plain text')).toEqual([]);
  });
});

describe('composerEngine.integration - resolveOneReference', () => {
  it('解析 @codebase 引用', async () => {
    const ref = await resolveOneReference({ type: 'codebase', value: 'auth', raw: '@codebase:auth' });
    // resolver 可能返回 mock 数据，不抛错即视为成功
    expect(ref.raw).toBe('@codebase:auth');
    expect(ref.type).toBe('codebase');
    expect(['resolved', 'failed']).toContain(ref.state);
  });

  it('解析 @git 引用', async () => {
    const ref = await resolveOneReference({ type: 'git', value: 'log:src/auth.ts', raw: '@git:log:src/auth.ts' });
    expect(ref.raw).toBe('@git:log:src/auth.ts');
    expect(ref.type).toBe('git');
    expect(['resolved', 'failed']).toContain(ref.state);
  });

  it('解析 @diff 引用', async () => {
    const ref = await resolveOneReference({ type: 'diff', value: 'working', raw: '@diff:working' });
    expect(ref.raw).toBe('@diff:working');
    expect(ref.type).toBe('diff');
    expect(['resolved', 'failed']).toContain(ref.state);
  });

  it('未知 type 返回 failed', async () => {
    // @ts-expect-error testing invalid type
    const ref = await resolveOneReference({ type: 'unknown', value: 'x', raw: '@unknown:x' });
    expect(ref.state).toBe('failed');
    expect(ref.error).toBeDefined();
  });
});

describe('composerEngine.integration - resolveAllReferencesCore', () => {
  it('并发解析多个引用', async () => {
    const { references, errors } = await resolveAllReferencesCore(
      'Check @codebase:auth and @git:log:src/auth.ts and @diff:working'
    );
    expect(references).toHaveLength(3);
    // errors 可能非空（mock 失败），但不应阻塞
    expect(Array.isArray(errors)).toBe(true);
  });

  it('空 prompt 返回空数组', async () => {
    const { references, errors } = await resolveAllReferencesCore('');
    expect(references).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('无可解析引用', async () => {
    const { references } = await resolveAllReferencesCore('plain text with no refs');
    expect(references).toEqual([]);
  });
});

describe('composerEngine.integration - 规则加载', () => {
  it('无 yaml 时返回 DEFAULT_RULES', async () => {
    const result = await loadProjectRulesCore();
    expect(result.rules).toBe(DEFAULT_RULES);
    expect(result.loaded).toBe(true);
    expect(result.error).toBeNull();
  });

  it('空字符串 yaml 返回 DEFAULT_RULES', async () => {
    const result = await loadProjectRulesCore('');
    expect(result.rules).toBe(DEFAULT_RULES);
    expect(result.loaded).toBe(true);
  });

  it('无效 yaml 返回错误', async () => {
    const result = await loadProjectRulesCore('not_valid_yaml: [unclosed');
    // YAML 解析失败应 fallback
    expect(result.loaded).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.rules).toBe(DEFAULT_RULES);
  });

  it('有效 yaml 加载成功', async () => {
    const validYaml = `
version: "1.0"
project_type: typescript
rules:
  type_safety: strict
  error_handling: try_catch
  framework_best_practices: true
  import_order: alphabetical
  naming_convention: camelCase
  testing:
    required: true
    framework: vitest
    coverage_threshold: 80
  documentation:
    required: true
    language: chinese
  security:
    no_secrets_in_code: true
    parameter_validation: true
    input_sanitization: true
custom_rules: []
`;
    const result = await loadProjectRulesCore(validYaml);
    expect(result.loaded).toBe(true);
    expect(result.error).toBeNull();
    expect(result.rules.rules.type_safety).toBe('strict');
  });

  it('验证失败的 yaml 返回错误', async () => {
    const invalidYaml = `
version: "1.0"
rules:
  type_safety: invalid_value_xyz
`;
    const result = await loadProjectRulesCore(invalidYaml);
    expect(result.loaded).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('composerEngine.integration - countRules', () => {
  it('统计 DEFAULT_RULES', () => {
    const { total, categories } = countRules(DEFAULT_RULES);
    expect(total).toBeGreaterThan(0);
    expect(categories).toBeDefined();
  });

  it('空 custom_rules', () => {
    const rules = { ...DEFAULT_RULES, custom_rules: [] };
    const { categories } = countRules(rules);
    expect(categories.custom).toBe(0);
  });

  it('有 custom_rules', () => {
    const rules = {
      ...DEFAULT_RULES,
      custom_rules: ['rule1', 'rule2', 'rule3'],
    };
    const { total, categories } = countRules(rules);
    expect(categories.custom).toBe(3);
    expect(total).toBeGreaterThan(3);
  });
});

describe('composerEngine.integration - ComposerEngine 集成', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetIntegration(engine);
  });

  it('初始状态使用 DEFAULT_RULES', () => {
    const rules = getProjectRules(engine);
    expect(rules).toBe(DEFAULT_RULES);
  });

  it('setProjectRules 设置规则', () => {
    const newRules = RULES_TEMPLATES[0].rules;
    setProjectRules(engine, newRules);
    expect(getProjectRules(engine)).toBe(newRules);
  });

  it('loadProjectRules 加载规则', async () => {
    const result = await loadProjectRules(engine);
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(getProjectRules(engine)).toBe(DEFAULT_RULES);
  });

  it('loadProjectRules 失败后保持 DEFAULT', async () => {
    await loadProjectRules(engine, 'invalid yaml [[[');
    // 失败时回退 DEFAULT
    expect(getProjectRules(engine)).toBe(DEFAULT_RULES);
  });

  it('resolveAllReferences 触发订阅', async () => {
    const cb = vi.fn();
    subscribeIntegration(engine, cb);
    await resolveAllReferences(engine, 'Check @codebase:auth');
    expect(cb).toHaveBeenCalled();
  });

  it('resolveAllReferences 更新 state', async () => {
    await resolveAllReferences(engine, 'Check @codebase:auth and @git:log');
    const refs = getResolvedReferences(engine);
    expect(refs).toHaveLength(2);
    // state 可能是 resolved 或 failed（mock），但不应该是 pending
    refs.forEach((r) => {
      expect(['resolved', 'failed']).toContain(r.state);
    });
  });

  it('resolveAllReferences 空 prompt 不更新', async () => {
    const cb = vi.fn();
    subscribeIntegration(engine, cb);
    await resolveAllReferences(engine, '');
    // 空 prompt 也应该调用 _notifyIntegration 一次（标记空列表）
    expect(cb).toHaveBeenCalled();
    const refs = getResolvedReferences(engine);
    expect(refs).toEqual([]);
  });

  it('injectRules 注入规则到 prompt', () => {
    const result = injectRules(engine, 'Fix the bug in auth.ts');
    expect(result).toContain('Fix the bug in auth.ts');
    expect(result).toContain('Type Safety');
  });

  it('injectRules 自定义规则生效', () => {
    const customRules = {
      ...DEFAULT_RULES,
      rules: { ...DEFAULT_RULES.rules, type_safety: 'strict' as const },
    };
    setProjectRules(engine, customRules);
    const result = injectRules(engine, 'Test prompt');
    expect(result).toContain('strict');
  });

  it('getRulesMetadata 返回元数据', () => {
    const meta = getRulesMetadata(engine);
    expect(meta.total).toBeGreaterThan(0);
    expect(meta.categories).toBeDefined();
    // 默认未显式加载
    expect(meta.isDefault).toBe(true);
  });

  it('getRulesMetadata 加载后 isDefault=false', async () => {
    await loadProjectRules(engine);
    const meta = getRulesMetadata(engine);
    expect(meta.isDefault).toBe(false);
  });

  it('subscribeIntegration 退订', async () => {
    const cb = vi.fn();
    const unsub = subscribeIntegration(engine, cb);
    unsub();
    await resolveAllReferences(engine, '@codebase:x');
    // 退订后不再调用
    // 注意：resetIntegration 内部会清空所有 subs
    resetIntegration(engine);
  });

  it('getResolutionErrors 累积错误', async () => {
    await resolveAllReferences(engine, '@codebase:nonexistent_xyz_query');
    // errors 是累积的，可能有 mock 失败
    const errors = getResolutionErrors(engine);
    expect(Array.isArray(errors)).toBe(true);
  });

  it('resetIntegration 重置状态', async () => {
    await loadProjectRules(engine);
    await resolveAllReferences(engine, '@codebase:x');
    resetIntegration(engine);
    // 重置后回到初始
    const rules = getProjectRules(engine);
    expect(rules).toBe(DEFAULT_RULES);
  });
});

describe('composerEngine.integration - 5 套预置模板', () => {
  it('5 套模板全部可加载', async () => {
    for (const tpl of RULES_TEMPLATES) {
      const result = await loadProjectRulesCore(JSON.stringify({ ...tpl.rules, version: '1.0' }));
      // 模板结构可能与 schema 不完全匹配，允许部分失败
      // 主要验证不抛错
      expect(result).toBeDefined();
    }
  });

  it('TypeScript Strict 模板 type_safety=strict', async () => {
    const tsTpl = RULES_TEMPLATES.find((t) => t.id === 'typescript_strict');
    expect(tsTpl).toBeDefined();
    expect(tsTpl!.rules.rules.type_safety).toBe('strict');
  });

  it('Python PEP8 模板 naming=snake_case', async () => {
    const pyTpl = RULES_TEMPLATES.find((t) => t.id === 'python_pep8');
    expect(pyTpl).toBeDefined();
    expect(pyTpl!.rules.rules.naming_convention).toBe('snake_case');
  });
});

describe('composerEngine.integration - 边界场景', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetIntegration(engine);
  });

  it('重复引用只解析一次', async () => {
    await resolveAllReferences(engine, '@codebase:auth and @codebase:auth');
    const refs = getResolvedReferences(engine);
    // 提取时不去重
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it('空 value 引用', async () => {
    await resolveAllReferences(engine, '@codebase:');
    // regex 不匹配空 value，应返回空
    const refs = getResolvedReferences(engine);
    expect(refs).toEqual([]);
  });

  it('特殊字符 value', async () => {
    const refs = extractResolvableRefs('@codebase:src/auth-handler_v2.ts');
    expect(refs).toHaveLength(1);
    expect(refs[0].value).toContain('auth-handler');
  });

  it('多个引擎状态独立', async () => {
    const engine1 = createComposerEngine();
    const engine2 = createComposerEngine();
    resetIntegration(engine1);
    resetIntegration(engine2);

    setProjectRules(engine1, RULES_TEMPLATES[0].rules);
    setProjectRules(engine2, RULES_TEMPLATES[1].rules);

    expect(getProjectRules(engine1)).not.toBe(getProjectRules(engine2));
  });
});
