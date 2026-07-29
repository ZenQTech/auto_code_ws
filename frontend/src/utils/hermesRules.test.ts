/**
 * Hermes Rules 测试 (v6.39.0 Cycle 18 G18-02)
 */

import { describe, it, expect } from 'vitest';
import {
  validateRules,
  parseYaml,
  stringifyYaml,
  parseAndValidateYaml,
  RULES_TEMPLATES,
  getTemplateById,
  generateRulesSummary,
  injectRulesIntoPrompt,
  DEFAULT_RULES,
  type HermesRules,
} from './hermesRules';

describe('hermesRules 验证 (Cycle 18 G18-02)', () => {
  describe('validateRules', () => {
    it('应该验证合法规则', () => {
      const valid: HermesRules = {
        version: '1.0',
        project_type: 'typescript',
        rules: {
          type_safety: 'strict',
          error_handling: 'try_catch',
          framework_best_practices: true,
          import_order: 'alphabetical',
          naming_convention: 'camelCase',
          testing: { required: true, framework: 'vitest', coverage_threshold: 80 },
          documentation: { required: true, language: 'chinese' },
          security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
        },
        custom_rules: ['rule1', 'rule2'],
      };
      const result = validateRules(valid);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.rules).toBeDefined();
    });

    it('应该检测缺失的 rules 字段', () => {
      const result = validateRules({ version: '1.0' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('应该检测无效的 type_safety 值', () => {
      const result = validateRules({
        rules: { type_safety: 'invalid' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type_safety'))).toBe(true);
    });

    it('应该检测无效的 coverage_threshold', () => {
      const result = validateRules({
        rules: { testing: { coverage_threshold: 150 } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('coverage_threshold'))).toBe(true);
    });

    it('应该使用默认值', () => {
      const result = validateRules({
        rules: {},
      });
      expect(result.valid).toBe(true);
      if (result.rules) {
        expect(result.rules.rules.type_safety).toBe('strict');
      }
    });

    it('应该拒绝非对象输入', () => {
      expect(validateRules(null).valid).toBe(false);
      expect(validateRules(undefined).valid).toBe(false);
      expect(validateRules('string').valid).toBe(false);
      expect(validateRules(123).valid).toBe(false);
    });
  });

  describe('YAML 解析', () => {
    it('应该解析简单 YAML', () => {
      const yaml = 'name: test\nage: 30';
      const parsed = parseYaml(yaml);
      expect(parsed).toEqual({ name: 'test', age: 30 });
    });

    it('应该解析布尔值', () => {
      const yaml = 'enabled: true\ndisabled: false';
      const parsed = parseYaml(yaml) as { enabled: boolean; disabled: boolean };
      expect(parsed.enabled).toBe(true);
      expect(parsed.disabled).toBe(false);
    });

    it('应该解析嵌套对象', () => {
      const yaml = 'rules:\n  type_safety: strict\n  testing:\n    required: true';
      const parsed = parseYaml(yaml) as any;
      expect(parsed.rules.type_safety).toBe('strict');
      expect(parsed.rules.testing.required).toBe(true);
    });

    it('应该解析列表', () => {
      const yaml = 'items:\n  - one\n  - two\n  - three';
      const parsed = parseYaml(yaml) as any;
      expect(parsed.items).toEqual(['one', 'two', 'three']);
    });

    it('应该跳过注释', () => {
      const yaml = '# this is comment\nname: test';
      const parsed = parseYaml(yaml) as any;
      expect(parsed.name).toBe('test');
    });

    it('应该解析带引号的字符串', () => {
      const yaml = 'name: "test with spaces"';
      const parsed = parseYaml(yaml) as any;
      expect(parsed.name).toBe('test with spaces');
    });
  });

  describe('YAML 验证集成', () => {
    it('应该解析并验证完整规则', () => {
      const yaml = `
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

custom_rules:
  - "禁止使用 any 类型"
  - "所有函数必须有注释"
`;
      const result = parseAndValidateYaml(yaml);
      expect(result.valid).toBe(true);
      expect(result.rules).toBeDefined();
      if (result.rules) {
        expect(result.rules.project_type).toBe('typescript');
        expect(result.rules.custom_rules).toHaveLength(2);
      }
    });

    it('应该捕获 YAML 验证错误', () => {
      const yaml = `
rules:
  type_safety: invalid_value
`;
      const result = parseAndValidateYaml(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('YAML 序列化', () => {
    it('应该正确序列化对象', () => {
      const obj = {
        name: 'test',
        enabled: true,
        count: 42,
      };
      const yaml = stringifyYaml(obj);
      expect(yaml).toContain('name: test');
      expect(yaml).toContain('enabled: true');
      expect(yaml).toContain('count: 42');
    });

    it('应该正确序列化嵌套对象', () => {
      const obj = {
        rules: {
          type_safety: 'strict',
          testing: { required: true },
        },
      };
      const yaml = stringifyYaml(obj);
      expect(yaml).toContain('rules:');
      expect(yaml).toContain('  type_safety: strict');
      expect(yaml).toContain('  testing:');
    });

    it('应该正确序列化数组', () => {
      const obj = {
        items: ['a', 'b', 'c'],
      };
      const yaml = stringifyYaml(obj);
      expect(yaml).toContain('items:');
      expect(yaml).toContain('- a');
      expect(yaml).toContain('- b');
    });

    it('应该为包含特殊字符的字符串加引号', () => {
      const obj = { name: 'test: value' };
      const yaml = stringifyYaml(obj);
      expect(yaml).toContain('"test: value"');
    });
  });

  describe('Templates', () => {
    it('应该有 5 套预置模板', () => {
      expect(RULES_TEMPLATES.length).toBe(5);
    });

    it('应该包含 TypeScript Strict 模板', () => {
      const t = getTemplateById('typescript_strict');
      expect(t).toBeDefined();
      expect(t?.projectType).toBe('typescript');
      expect(t?.rules.rules.type_safety).toBe('strict');
    });

    it('应该包含 Python PEP8 模板', () => {
      const t = getTemplateById('python_pep8');
      expect(t).toBeDefined();
      expect(t?.projectType).toBe('python');
      expect(t?.rules.rules.naming_convention).toBe('snake_case');
    });

    it('应该包含 React Best Practices 模板', () => {
      const t = getTemplateById('react_best');
      expect(t).toBeDefined();
      expect(t?.projectType).toBe('react');
    });

    it('应该包含 Vue Best Practices 模板', () => {
      const t = getTemplateById('vue_best');
      expect(t).toBeDefined();
      expect(t?.projectType).toBe('vue');
    });

    it('应该包含 Generic 模板', () => {
      const t = getTemplateById('generic');
      expect(t).toBeDefined();
      expect(t?.projectType).toBe('generic');
    });

    it('应该为未知 ID 返回 undefined', () => {
      expect(getTemplateById('unknown')).toBeUndefined();
    });
  });

  describe('Rule Injection', () => {
    it('应该生成规则摘要', () => {
      const summary = generateRulesSummary(DEFAULT_RULES);
      expect(summary).toContain('# Project Rules');
      expect(summary).toContain('## Code Style');
      expect(summary).toContain('## Testing');
      expect(summary).toContain('## Security');
    });

    it('应该包含自定义规则', () => {
      const rules: HermesRules = {
        ...DEFAULT_RULES,
        custom_rules: ['rule A', 'rule B'],
      };
      const summary = generateRulesSummary(rules);
      expect(summary).toContain('## Custom Rules');
      expect(summary).toContain('- rule A');
      expect(summary).toContain('- rule B');
    });

    it('应该注入规则到 prompt', () => {
      const injected = injectRulesIntoPrompt('user prompt', DEFAULT_RULES);
      expect(injected).toContain('[User Prompt]');
      expect(injected).toContain('user prompt');
      expect(injected).toContain('# Project Rules');
    });

    it('应该支持自定义 prefix', () => {
      const injected = injectRulesIntoPrompt('test', DEFAULT_RULES, { prefix: '项目规范' });
      expect(injected).toContain('[项目规范]');
    });

    it('空规则时直接返回原 prompt', () => {
      const injected = injectRulesIntoPrompt('test', null);
      expect(injected).toBe('test');
    });
  });

  describe('DEFAULT_RULES', () => {
    it('应该是合法的 HermesRules', () => {
      const result = validateRules(DEFAULT_RULES);
      expect(result.valid).toBe(true);
    });

    it('应该有合理的默认值', () => {
      expect(DEFAULT_RULES.version).toBe('1.0');
      expect(DEFAULT_RULES.project_type).toBe('generic');
      expect(DEFAULT_RULES.custom_rules).toEqual([]);
    });
  });
});
