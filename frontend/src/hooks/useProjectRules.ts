/**
 * useProjectRules Hook (v6.39.0 Cycle 18 G18-02)
 * 
 * 管理项目级 AI 规则：
 *   - 加载当前规则
 *   - 应用模板
 *   - 保存修改
 *   - 验证 YAML
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  HermesRules,
  RulesTemplate,
  RULES_TEMPLATES,
  DEFAULT_RULES,
  validateRules,
  ValidationResult,
  getTemplateById,
} from '../utils/hermesRules';

export interface UseProjectRulesOptions {
  projectId: string;
  apiBase?: string;
  initialRules?: HermesRules;
  enableCache?: boolean;
}

export interface UseProjectRulesResult {
  rules: HermesRules;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  validation: ValidationResult | null;
  templates: RulesTemplate[];
  save: (rules: HermesRules) => Promise<void>;
  applyTemplate: (templateId: string) => Promise<void>;
  validate: (yaml: string) => Promise<ValidationResult>;
  updateRules: (rules: Partial<HermesRules>) => void;
  reset: () => void;
}

const STORAGE_KEY_PREFIX = 'hermes.rules.';

export function useProjectRules(options: UseProjectRulesOptions): UseProjectRulesResult {
  const { projectId, apiBase, initialRules, enableCache = true } = options;
  const [rules, setRules] = useState<HermesRules>(initialRules ?? DEFAULT_RULES);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 加载规则
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. 尝试从 localStorage 缓存
      if (enableCache && typeof window !== 'undefined') {
        const cached = window.localStorage.getItem(STORAGE_KEY_PREFIX + projectId);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            const result = validateRules(parsed);
            if (result.valid && result.rules) {
              setRules(result.rules);
              setIsLoading(false);
              return;
            }
          } catch (e) {
            // 忽略缓存错误
          }
        }
      }

      // 2. 尝试从 API 加载
      if (apiBase) {
        try {
          const response = await fetch(`${apiBase}/api/projects/${projectId}/rules`);
          if (response.ok) {
            const data = await response.json();
            if (data.rules) {
              const result = validateRules(data.rules);
              if (result.valid && result.rules) {
                setRules(result.rules);
                // 缓存
                if (enableCache && typeof window !== 'undefined') {
                  window.localStorage.setItem(
                    STORAGE_KEY_PREFIX + projectId,
                    JSON.stringify(result.rules)
                  );
                }
                setIsLoading(false);
                return;
              }
            }
          }
        } catch (e) {
          // API 失败时降级到默认值
        }
      }

      // 3. 使用默认值
      setRules(DEFAULT_RULES);
    } catch (err) {
      setError(String(err));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [projectId, apiBase, enableCache]);

  useEffect(() => {
    load();
  }, [load]);

  // 保存
  const save = useCallback(
    async (newRules: HermesRules) => {
      setIsSaving(true);
      setError(null);
      try {
        // 验证
        const result = validateRules(newRules);
        if (!result.valid || !result.rules) {
          throw new Error(result.errors.join('; '));
        }

        // 1. 尝试 API
        if (apiBase) {
          try {
            const response = await fetch(`${apiBase}/api/projects/${projectId}/rules`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rules: result.rules }),
            });
            if (response.ok) {
              setRules(result.rules);
              // 缓存
              if (enableCache && typeof window !== 'undefined') {
                window.localStorage.setItem(
                  STORAGE_KEY_PREFIX + projectId,
                  JSON.stringify(result.rules)
                );
              }
              setIsSaving(false);
              return;
            }
          } catch (e) {
            // API 失败时降级到 localStorage
          }
        }

        // 2. 降级到 localStorage
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            STORAGE_KEY_PREFIX + projectId,
            JSON.stringify(result.rules)
          );
        }
        setRules(result.rules);
      } catch (err) {
        setError(String(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [projectId, apiBase, enableCache]
  );

  // 应用模板
  const applyTemplate = useCallback(
    async (templateId: string) => {
      const template = getTemplateById(templateId);
      if (!template) throw new Error(`Template not found: ${templateId}`);
      await save(template.rules);
    },
    [save]
  );

  // 验证 YAML
  const validate = useCallback(async (yaml: string): Promise<ValidationResult> => {
    try {
      const { parseAndValidateYaml } = await import('../utils/hermesRules');
      const result = parseAndValidateYaml(yaml);
      setValidation(result);
      return result;
    } catch (err) {
      const result: ValidationResult = {
        valid: false,
        errors: [String(err)],
      };
      setValidation(result);
      return result;
    }
  }, []);

  // 部分更新
  const updateRules = useCallback((partial: Partial<HermesRules>) => {
    setRules((prev) => ({ ...prev, ...partial }));
  }, []);

  // 重置
  const reset = useCallback(() => {
    setRules(DEFAULT_RULES);
    setError(null);
    setValidation(null);
  }, []);

  return {
    rules,
    isLoading,
    isSaving,
    error,
    validation,
    templates: RULES_TEMPLATES,
    save,
    applyTemplate,
    validate,
    updateRules,
    reset,
  };
}
