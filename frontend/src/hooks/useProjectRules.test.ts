/**
 * useProjectRules Hook 测试 (v6.39.0 Cycle 18 G18-02)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProjectRules } from './useProjectRules';
import { DEFAULT_RULES } from '../utils/hermesRules';

describe('useProjectRules Hook (Cycle 18 G18-02)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('应该使用默认规则初始化', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.rules).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('应该返回所有模板', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.templates.length).toBe(5);
    });
  });

  it('应该应用模板', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.applyTemplate('typescript_strict');
    });

    expect(result.current.rules.rules.type_safety).toBe('strict');
    expect(result.current.rules.project_type).toBe('typescript');
  });

  it('应该保存自定义规则', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const customRules = {
      ...DEFAULT_RULES,
      custom_rules: ['my custom rule'],
    };

    await act(async () => {
      await result.current.save(customRules);
    });

    expect(result.current.rules.custom_rules).toContain('my custom rule');
  });

  it('应该拒绝无效规则', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const invalidRules = {
      version: '1.0',
      rules: {
        type_safety: 'invalid' as any,
        testing: { required: true, framework: 'vitest' as const, coverage_threshold: 80 },
        documentation: { required: true, language: 'chinese' as const },
        security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
        error_handling: 'try_catch' as any,
        framework_best_practices: true,
        import_order: 'alphabetical' as any,
        naming_convention: 'camelCase' as any,
      },
      custom_rules: [],
    };

    await act(async () => {
      try {
        await result.current.save(invalidRules);
      } catch (e) {
        // 预期会抛错
      }
    });

    expect(result.current.error).toBeTruthy();
  });

  it('应该支持部分更新', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateRules({ project_type: 'python' });
    });

    expect(result.current.rules.project_type).toBe('python');
  });

  it('应该支持重置', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateRules({ project_type: 'python' });
    });
    expect(result.current.rules.project_type).toBe('python');

    act(() => {
      result.current.reset();
    });
    expect(result.current.rules.project_type).toBe('generic');
  });

  it('应该支持 YAML 验证', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

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

custom_rules: []
`;

    let validation: any;
    await act(async () => {
      validation = await result.current.validate(yaml);
    });

    expect(validation.valid).toBe(true);
    expect(result.current.validation).toBeDefined();
  });

  it('应该捕获 YAML 验证错误', async () => {
    const { result } = renderHook(() =>
      useProjectRules({ projectId: 'test-project' })
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const invalidYaml = `
rules:
  type_safety: invalid
`;

    let validation: any;
    await act(async () => {
      validation = await result.current.validate(invalidYaml);
    });

    expect(validation.valid).toBe(false);
  });
});
