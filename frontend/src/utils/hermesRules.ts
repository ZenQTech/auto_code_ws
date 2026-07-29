/**
 * # ============================================================
 * # Hermes 项目级 AI 规则 (v6.39.0 Cycle 18 G18-02)
 * # ============================================================
 * # 核心作用：定义项目级 AI 行为规范
 * # 设计要点：
 * #   - 兼容 .cursorrules / .hermesrules 双格式
 * #   - 5 套预置模板
 * #   - zod 风格 schema 验证
 * #   - 注入到 system prompt
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 G18-02 初次创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

export type TypeSafety = 'strict' | 'loose' | 'off';
export type ErrorHandling = 'try_catch' | 'result_type' | 'throws';
export type ImportOrder = 'alphabetical' | 'grouped' | 'none';
export type NamingConvention = 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
export type TestFramework = 'jest' | 'vitest' | 'pytest' | 'go_test' | 'none';
export type DocLanguage = 'chinese' | 'english' | 'auto';
export type ProjectType = 'typescript' | 'python' | 'react' | 'vue' | 'generic';

/** 项目规则 */
export interface HermesRules {
  version: string;
  project_type?: ProjectType;
  rules: {
    type_safety: TypeSafety;
    error_handling: ErrorHandling;
    framework_best_practices: boolean;
    import_order: ImportOrder;
    naming_convention: NamingConvention;
    testing: {
      required: boolean;
      framework: TestFramework;
      coverage_threshold: number;
    };
    documentation: {
      required: boolean;
      language: DocLanguage;
    };
    security: {
      no_secrets_in_code: boolean;
      parameter_validation: boolean;
      input_sanitization: boolean;
    };
  };
  custom_rules: string[];
}

/** 规则模板 */
export interface RulesTemplate {
  id: string;
  name: string;
  description: string;
  projectType: ProjectType;
  rules: HermesRules;
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  rules?: HermesRules;
}

// ============================================================
// Schema 验证
// ============================================================

const VALID_TYPE_SAFETY: TypeSafety[] = ['strict', 'loose', 'off'];
const VALID_ERROR_HANDLING: ErrorHandling[] = ['try_catch', 'result_type', 'throws'];
const VALID_IMPORT_ORDER: ImportOrder[] = ['alphabetical', 'grouped', 'none'];
const VALID_NAMING: NamingConvention[] = ['camelCase', 'snake_case', 'PascalCase', 'mixed'];
const VALID_TEST_FRAMEWORK: TestFramework[] = ['jest', 'vitest', 'pytest', 'go_test', 'none'];
const VALID_DOC_LANGUAGE: DocLanguage[] = ['chinese', 'english', 'auto'];
const VALID_PROJECT_TYPE: ProjectType[] = ['typescript', 'python', 'react', 'vue', 'generic'];

/** 验证类型值 */
function validateEnum<T extends string>(
  value: unknown,
  validValues: T[],
  fieldName: string,
  errors: string[]
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${fieldName} 必须是字符串`);
    return undefined;
  }
  if (!validValues.includes(value as T)) {
    errors.push(`${fieldName} 必须是 ${validValues.join('/')} 之一，得到 ${value}`);
    return undefined;
  }
  return value as T;
}

/** 验证布尔值 */
function validateBoolean(value: unknown, fieldName: string, errors: string[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.push(`${fieldName} 必须是布尔值`);
    return undefined;
  }
  return value;
}

/** 验证数字 */
function validateNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  errors: string[]
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || isNaN(value)) {
    errors.push(`${fieldName} 必须是数字`);
    return undefined;
  }
  if (value < min || value > max) {
    errors.push(`${fieldName} 必须在 ${min}-${max} 之间`);
    return undefined;
  }
  return value;
}

/** 验证规则对象 */
export function validateRules(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['rules 必须是对象'] };
  }

  const data = input as Record<string, any>;

  // 验证 version
  if (data.version !== undefined && typeof data.version !== 'string') {
    errors.push('version 必须是字符串');
  }

  // 验证 project_type
  const projectType = validateEnum(data.project_type, VALID_PROJECT_TYPE, 'project_type', errors);

  // 验证 rules 对象
  if (!data.rules || typeof data.rules !== 'object') {
    return { valid: false, errors: ['rules 字段必须存在且为对象'] };
  }

  const r = data.rules;

  // 验证各个字段
  const type_safety = validateEnum(r.type_safety, VALID_TYPE_SAFETY, 'rules.type_safety', errors) ?? 'strict';
  const error_handling = validateEnum(r.error_handling, VALID_ERROR_HANDLING, 'rules.error_handling', errors) ?? 'try_catch';
  const framework_best_practices = validateBoolean(r.framework_best_practices, 'rules.framework_best_practices', errors) ?? true;
  const import_order = validateEnum(r.import_order, VALID_IMPORT_ORDER, 'rules.import_order', errors) ?? 'alphabetical';
  const naming_convention = validateEnum(r.naming_convention, VALID_NAMING, 'rules.naming_convention', errors) ?? 'mixed';

  // 验证 testing
  const testingObj = r.testing || {};
  const testing_required = validateBoolean(testingObj.required, 'rules.testing.required', errors) ?? true;
  const testing_framework = validateEnum(testingObj.framework, VALID_TEST_FRAMEWORK, 'rules.testing.framework', errors) ?? 'vitest';
  const testing_coverage = validateNumber(testingObj.coverage_threshold, 'rules.testing.coverage_threshold', 0, 100, errors) ?? 80;

  // 验证 documentation
  const docObj = r.documentation || {};
  const doc_required = validateBoolean(docObj.required, 'rules.documentation.required', errors) ?? true;
  const doc_language = validateEnum(docObj.language, VALID_DOC_LANGUAGE, 'rules.documentation.language', errors) ?? 'auto';

  // 验证 security
  const secObj = r.security || {};
  const sec_no_secrets = validateBoolean(secObj.no_secrets_in_code, 'rules.security.no_secrets_in_code', errors) ?? true;
  const sec_param_val = validateBoolean(secObj.parameter_validation, 'rules.security.parameter_validation', errors) ?? true;
  const sec_input_san = validateBoolean(secObj.input_sanitization, 'rules.security.input_sanitization', errors) ?? true;

  // 验证 custom_rules
  let customRules: string[] = [];
  if (data.custom_rules !== undefined) {
    if (!Array.isArray(data.custom_rules)) {
      errors.push('custom_rules 必须是字符串数组');
    } else {
      for (const rule of data.custom_rules) {
        if (typeof rule !== 'string') {
          errors.push('custom_rules 元素必须是字符串');
        } else {
          customRules.push(rule);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const rules: HermesRules = {
    version: data.version || '1.0',
    project_type: projectType,
    rules: {
      type_safety,
      error_handling,
      framework_best_practices,
      import_order,
      naming_convention,
      testing: {
        required: testing_required,
        framework: testing_framework,
        coverage_threshold: testing_coverage,
      },
      documentation: {
        required: doc_required,
        language: doc_language,
      },
      security: {
        no_secrets_in_code: sec_no_secrets,
        parameter_validation: sec_param_val,
        input_sanitization: sec_input_san,
      },
    },
    custom_rules: customRules,
  };

  return { valid: true, errors: [], rules };
}

// ============================================================
// YAML 解析（简化版）
// ============================================================

/**
 * 简单的 YAML 解析器（仅支持本项目规则所需格式）
 * 注意：仅支持两级嵌套 + 列表，避免引入 js-yaml 依赖
 */
export function parseYaml(yaml: string): unknown {
  const lines = yaml.split('\n');
  const result: any = {};
  const stack: Array<{ indent: number; obj: any }> = [{ indent: -1, obj: result }];
  let currentList: any[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // 列表项
    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (currentList === null) continue;
      const value = trimmed === '-' ? '' : trimmed.substring(2);
      // 尝试解析布尔/数字/字符串
      currentList.push(parseScalarValue(value));
      continue;
    }

    // 键值对
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    const valueStr = trimmed.substring(colonIdx + 1).trim();

    // 弹出更浅的栈
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (valueStr === '') {
      // 嵌套对象或列表
      // 预测下一行：如果下一行缩进更大且以 - 开头，则是列表
      let isList = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine.trim() || nextLine.trim().startsWith('#')) continue;
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        if (nextIndent <= indent) break;
        if (nextLine.trim().startsWith('-')) {
          isList = true;
          break;
        }
        break;
      }

      if (isList) {
        const list: any[] = [];
        parent[key] = list;
        currentList = list;
        stack.push({ indent, obj: list });
      } else {
        const obj: any = {};
        parent[key] = obj;
        currentList = null;
        stack.push({ indent, obj });
      }
    } else if (valueStr === '[]' || valueStr === '{}') {
      // 空列表/对象
      parent[key] = valueStr === '[]' ? [] : {};
      currentList = null;
    } else {
      parent[key] = parseScalarValue(valueStr);
      currentList = null;
    }
  }

  return result;
}

function parseScalarValue(value: string): any {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  // 数字
  if (/^-?\d+(\.\d+)?$/.test(value)) return parseFloat(value);
  // 字符串（去引号）
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

/** 序列化为 YAML */
export function stringifyYaml(obj: unknown, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      // 包含特殊字符时加引号
      if (/[:#\n]/.test(obj) || obj === '') {
        return `"${obj.replace(/"/g, '\\"')}"`;
      }
    }
    return String(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => `${pad}- ${stringifyYaml(item, indent + 1).trimStart()}`).join('\n');
  }
  const entries = Object.entries(obj as Record<string, any>);
  return entries
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${pad}${key}:`;
      if (typeof value === 'object') {
        return `${pad}${key}:\n${stringifyYaml(value, indent + 1)}`;
      }
      return `${pad}${key}: ${stringifyYaml(value, indent + 1).trimStart()}`;
    })
    .join('\n');
}

/** 解析 YAML 并验证 */
export function parseAndValidateYaml(yaml: string): ValidationResult {
  try {
    const parsed = parseYaml(yaml);
    return validateRules(parsed);
  } catch (err) {
    return { valid: false, errors: [`YAML 解析失败: ${err}`] };
  }
}

// ============================================================
// 预置模板
// ============================================================

export const RULES_TEMPLATES: RulesTemplate[] = [
  {
    id: 'typescript_strict',
    name: 'TypeScript Strict',
    description: 'TypeScript 严格模式 + 完整测试覆盖',
    projectType: 'typescript',
    rules: {
      version: '1.0',
      project_type: 'typescript',
      rules: {
        type_safety: 'strict',
        error_handling: 'try_catch',
        framework_best_practices: true,
        import_order: 'alphabetical',
        naming_convention: 'camelCase',
        testing: { required: true, framework: 'vitest', coverage_threshold: 90 },
        documentation: { required: true, language: 'chinese' },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
      },
      custom_rules: [
        '禁止使用 any 类型（使用 unknown 替代）',
        '所有函数必须有完整中文注释',
        '所有用户输入必须做合法性校验',
        '所有公开 API 必须有 JSDoc 注释',
      ],
    },
  },
  {
    id: 'python_pep8',
    name: 'Python PEP8',
    description: 'Python PEP8 规范 + pytest 测试',
    projectType: 'python',
    rules: {
      version: '1.0',
      project_type: 'python',
      rules: {
        type_safety: 'loose',
        error_handling: 'try_catch',
        framework_best_practices: true,
        import_order: 'alphabetical',
        naming_convention: 'snake_case',
        testing: { required: true, framework: 'pytest', coverage_threshold: 85 },
        documentation: { required: true, language: 'chinese' },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
      },
      custom_rules: [
        '遵循 PEP8 编码规范',
        '使用 type hints',
        '所有函数必须有 docstring',
      ],
    },
  },
  {
    id: 'react_best',
    name: 'React Best Practices',
    description: 'React 最佳实践 + 组件测试',
    projectType: 'react',
    rules: {
      version: '1.0',
      project_type: 'react',
      rules: {
        type_safety: 'strict',
        error_handling: 'result_type',
        framework_best_practices: true,
        import_order: 'alphabetical',
        naming_convention: 'PascalCase',
        testing: { required: true, framework: 'vitest', coverage_threshold: 85 },
        documentation: { required: true, language: 'chinese' },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
      },
      custom_rules: [
        '函数组件优先，避免 class 组件',
        '使用 React Hooks，避免过时 API',
        '组件 props 必须有 TypeScript 类型',
        '使用 React.memo 优化性能',
      ],
    },
  },
  {
    id: 'vue_best',
    name: 'Vue Best Practices',
    description: 'Vue 3 Composition API + 组件测试',
    projectType: 'vue',
    rules: {
      version: '1.0',
      project_type: 'vue',
      rules: {
        type_safety: 'strict',
        error_handling: 'try_catch',
        framework_best_practices: true,
        import_order: 'alphabetical',
        naming_convention: 'PascalCase',
        testing: { required: true, framework: 'vitest', coverage_threshold: 80 },
        documentation: { required: true, language: 'chinese' },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
      },
      custom_rules: [
        '使用 Composition API，避免 Options API',
        '组件名使用 PascalCase',
        '使用 <script setup> 语法糖',
      ],
    },
  },
  {
    id: 'generic',
    name: 'Generic',
    description: '通用规则（适用于任何项目）',
    projectType: 'generic',
    rules: {
      version: '1.0',
      project_type: 'generic',
      rules: {
        type_safety: 'loose',
        error_handling: 'try_catch',
        framework_best_practices: true,
        import_order: 'none',
        naming_convention: 'mixed',
        testing: { required: true, framework: 'vitest', coverage_threshold: 70 },
        documentation: { required: true, language: 'auto' },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: false },
      },
      custom_rules: [
        '代码必须可读易维护',
        '关键路径必须有异常处理',
      ],
    },
  },
];

/** 通过 ID 获取模板 */
export function getTemplateById(id: string): RulesTemplate | undefined {
  return RULES_TEMPLATES.find((t) => t.id === id);
}

// ============================================================
// 规则注入
// ============================================================

/**
 * 生成规则摘要（用于注入到 system prompt）
 */
export function generateRulesSummary(rules: HermesRules): string {
  const lines: string[] = [];
  lines.push(`# Project Rules (${rules.project_type ?? 'generic'})`);
  lines.push('');
  lines.push('## Code Style');
  lines.push(`- Type Safety: ${rules.rules.type_safety}`);
  lines.push(`- Error Handling: ${rules.rules.error_handling}`);
  lines.push(`- Framework Best Practices: ${rules.rules.framework_best_practices ? 'enabled' : 'disabled'}`);
  lines.push(`- Import Order: ${rules.rules.import_order}`);
  lines.push(`- Naming Convention: ${rules.rules.naming_convention}`);
  lines.push('');
  lines.push('## Testing');
  lines.push(`- Required: ${rules.rules.testing.required ? 'yes' : 'no'}`);
  lines.push(`- Framework: ${rules.rules.testing.framework}`);
  lines.push(`- Coverage Threshold: ${rules.rules.testing.coverage_threshold}%`);
  lines.push('');
  lines.push('## Documentation');
  lines.push(`- Required: ${rules.rules.documentation.required ? 'yes' : 'no'}`);
  lines.push(`- Language: ${rules.rules.documentation.language}`);
  lines.push('');
  lines.push('## Security');
  lines.push(`- No secrets in code: ${rules.rules.security.no_secrets_in_code ? 'enforced' : 'allowed'}`);
  lines.push(`- Parameter validation: ${rules.rules.security.parameter_validation ? 'required' : 'optional'}`);
  lines.push(`- Input sanitization: ${rules.rules.security.input_sanitization ? 'required' : 'optional'}`);
  if (rules.custom_rules.length > 0) {
    lines.push('');
    lines.push('## Custom Rules');
    for (const rule of rules.custom_rules) {
      lines.push(`- ${rule}`);
    }
  }
  return lines.join('\n');
}

/**
 * 注入规则到 prompt
 */
export function injectRulesIntoPrompt(
  prompt: string,
  rules: HermesRules | null,
  options?: { prefix?: string }
): string {
  if (!rules) return prompt;
  const prefix = options?.prefix ?? '请遵循以下项目规则';
  const summary = generateRulesSummary(rules);
  return `[${prefix}]\n${summary}\n\n[User Prompt]\n${prompt}`;
}

// ============================================================
// 默认规则
// ============================================================

export const DEFAULT_RULES: HermesRules = {
  version: '1.0',
  project_type: 'generic',
  rules: {
    type_safety: 'loose',
    error_handling: 'try_catch',
    framework_best_practices: true,
    import_order: 'none',
    naming_convention: 'mixed',
    testing: { required: true, framework: 'vitest', coverage_threshold: 70 },
    documentation: { required: true, language: 'auto' },
    security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: false },
  },
  custom_rules: [],
};
