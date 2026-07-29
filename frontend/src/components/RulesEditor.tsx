/**
 * # ============================================================
 * # RulesEditor 组件 (v6.39.0 Cycle 18 G18-02)
 * # ============================================================
 * # 核心作用：可视化编辑项目级 AI 规则
 * # 功能：
 * #   - 模板选择（5 套预置）
 * #   - 表单编辑
 * #   - 实时验证
 * #   - YAML 预览
 * #   - 保存到项目
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 G18-02 初次创建
 * # ============================================================
 */

import React, { useState, useEffect } from 'react';
import { useProjectRules } from '../hooks/useProjectRules';
import {
  HermesRules,
  stringifyYaml,
  parseAndValidateYaml,
  type RulesTemplate,
} from '../utils/hermesRules';

export interface RulesEditorProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (rules: HermesRules) => void;
  apiBase?: string;
}

export function RulesEditor({
  projectId,
  isOpen,
  onClose,
  onSave,
  apiBase,
}: RulesEditorProps) {
  const {
    rules,
    isLoading,
    isSaving,
    error,
    validation,
    templates,
    save,
    applyTemplate,
    validate,
    updateRules,
  } = useProjectRules({ projectId, apiBase });

  const [activeTab, setActiveTab] = useState<'visual' | 'yaml'>('visual');
  const [yamlContent, setYamlContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  // 当规则变化时更新 YAML 预览
  useEffect(() => {
    setYamlContent(stringifyYaml(rules));
  }, [rules]);

  if (!isOpen) return null;

  const handleApplyTemplate = async (templateId: string) => {
    setSelectedTemplate(templateId);
    try {
      await applyTemplate(templateId);
    } catch (e) {
      console.error('Failed to apply template:', e);
    }
  };

  const handleSave = async () => {
    try {
      await save(rules);
      onSave?.(rules);
      onClose();
    } catch (e) {
      console.error('Failed to save:', e);
    }
  };

  const handleYamlChange = (newYaml: string) => {
    setYamlContent(newYaml);
    validate(newYaml);
  };

  const handleApplyYaml = () => {
    const result = parseAndValidateYaml(yamlContent);
    if (result.valid && result.rules) {
      updateRules(result.rules);
    }
  };

  return (
    <div
      data-testid="rules-editor"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <h2 className="text-lg font-semibold text-surface-50">
            项目级 AI 规则
          </h2>
          <button
            data-testid="rules-editor-close"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-100 px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-surface-400">加载中...</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-surface-700">
              <button
                data-testid="rules-tab-visual"
                onClick={() => setActiveTab('visual')}
                className={`px-4 py-2 ${
                  activeTab === 'visual'
                    ? 'text-hermes-500 border-b-2 border-hermes-500'
                    : 'text-surface-400 hover:text-surface-100'
                }`}
              >
                可视化
              </button>
              <button
                data-testid="rules-tab-yaml"
                onClick={() => setActiveTab('yaml')}
                className={`px-4 py-2 ${
                  activeTab === 'yaml'
                    ? 'text-hermes-500 border-b-2 border-hermes-500'
                    : 'text-surface-400 hover:text-surface-100'
                }`}
              >
                YAML
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'visual' ? (
                <RulesVisualEditor
                  rules={rules}
                  templates={templates}
                  selectedTemplate={selectedTemplate}
                  onApplyTemplate={handleApplyTemplate}
                  onUpdate={updateRules}
                />
              ) : (
                <RulesYamlEditor
                  yaml={yamlContent}
                  onChange={handleYamlChange}
                  onApply={handleApplyYaml}
                  validation={validation}
                />
              )}

              {error && (
                <div
                  data-testid="rules-error"
                  className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-surface-700">
              <div className="text-sm text-surface-400">
                {rules.project_type ?? 'generic'} • {rules.custom_rules.length} 条自定义规则
              </div>
              <div className="flex gap-2">
                <button
                  data-testid="rules-cancel"
                  onClick={onClose}
                  className="px-4 py-2 text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded"
                >
                  取消
                </button>
                <button
                  data-testid="rules-save"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Visual Editor
// ============================================================

interface RulesVisualEditorProps {
  rules: HermesRules;
  templates: RulesTemplate[];
  selectedTemplate: string;
  onApplyTemplate: (id: string) => void;
  onUpdate: (partial: Partial<HermesRules>) => void;
}

function RulesVisualEditor({
  rules,
  templates,
  selectedTemplate,
  onApplyTemplate,
  onUpdate,
}: RulesVisualEditorProps) {
  const updateRule = <K extends keyof HermesRules['rules']>(
    key: K,
    value: HermesRules['rules'][K]
  ) => {
    onUpdate({ rules: { ...rules.rules, [key]: value } });
  };

  const updateTesting = (partial: Partial<HermesRules['rules']['testing']>) => {
    onUpdate({ rules: { ...rules.rules, testing: { ...rules.rules.testing, ...partial } } });
  };

  const updateSecurity = (partial: Partial<HermesRules['rules']['security']>) => {
    onUpdate({ rules: { ...rules.rules, security: { ...rules.rules.security, ...partial } } });
  };

  const updateDocumentation = (partial: Partial<HermesRules['rules']['documentation']>) => {
    onUpdate({ rules: { ...rules.rules, documentation: { ...rules.rules.documentation, ...partial } } });
  };

  return (
    <div className="space-y-6">
      {/* Templates */}
      <section data-testid="rules-templates">
        <h3 className="text-sm font-semibold text-surface-200 mb-3">预置模板</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              data-testid={`rules-template-${t.id}`}
              onClick={() => onApplyTemplate(t.id)}
              className={`text-left p-3 rounded border ${
                selectedTemplate === t.id
                  ? 'border-hermes-500 bg-hermes-500/10'
                  : 'border-surface-700 bg-surface-800 hover:border-surface-600'
              }`}
            >
              <div className="font-medium text-surface-100">{t.name}</div>
              <div className="text-xs text-surface-400 mt-1">{t.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Code Style */}
      <section>
        <h3 className="text-sm font-semibold text-surface-200 mb-3">代码风格</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="类型安全">
            <select
              data-testid="rule-type-safety"
              value={rules.rules.type_safety}
              onChange={(e) => updateRule('type_safety', e.target.value as any)}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="strict">严格 (strict)</option>
              <option value="loose">宽松 (loose)</option>
              <option value="off">关闭 (off)</option>
            </select>
          </Field>
          <Field label="错误处理">
            <select
              data-testid="rule-error-handling"
              value={rules.rules.error_handling}
              onChange={(e) => updateRule('error_handling', e.target.value as any)}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="try_catch">try/catch</option>
              <option value="result_type">Result 类型</option>
              <option value="throws">throws</option>
            </select>
          </Field>
          <Field label="导入顺序">
            <select
              data-testid="rule-import-order"
              value={rules.rules.import_order}
              onChange={(e) => updateRule('import_order', e.target.value as any)}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="alphabetical">字母序</option>
              <option value="grouped">分组</option>
              <option value="none">不强制</option>
            </select>
          </Field>
          <Field label="命名规范">
            <select
              data-testid="rule-naming"
              value={rules.rules.naming_convention}
              onChange={(e) => updateRule('naming_convention', e.target.value as any)}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="camelCase">camelCase</option>
              <option value="snake_case">snake_case</option>
              <option value="PascalCase">PascalCase</option>
              <option value="mixed">混合</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center">
          <input
            type="checkbox"
            data-testid="rule-framework-best-practices"
            id="rule-framework-best-practices"
            checked={rules.rules.framework_best_practices}
            onChange={(e) => updateRule('framework_best_practices', e.target.checked)}
            className="mr-2"
          />
          <label htmlFor="rule-framework-best-practices" className="text-sm text-surface-300">
            强制框架最佳实践
          </label>
        </div>
      </section>

      {/* Testing */}
      <section>
        <h3 className="text-sm font-semibold text-surface-200 mb-3">测试</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="测试框架">
            <select
              data-testid="rule-test-framework"
              value={rules.rules.testing.framework}
              onChange={(e) => updateTesting({ framework: e.target.value as any })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="vitest">Vitest</option>
              <option value="jest">Jest</option>
              <option value="pytest">Pytest</option>
              <option value="go_test">Go test</option>
              <option value="none">无</option>
            </select>
          </Field>
          <Field label={`覆盖率阈值 (${rules.rules.testing.coverage_threshold}%)`}>
            <input
              type="range"
              data-testid="rule-coverage"
              min="0"
              max="100"
              value={rules.rules.testing.coverage_threshold}
              onChange={(e) => updateTesting({ coverage_threshold: parseInt(e.target.value) })}
              className="w-full"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center">
          <input
            type="checkbox"
            data-testid="rule-testing-required"
            id="rule-testing-required"
            checked={rules.rules.testing.required}
            onChange={(e) => updateTesting({ required: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="rule-testing-required" className="text-sm text-surface-300">
            必须有测试
          </label>
        </div>
      </section>

      {/* Documentation */}
      <section>
        <h3 className="text-sm font-semibold text-surface-200 mb-3">文档</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="文档语言">
            <select
              data-testid="rule-doc-language"
              value={rules.rules.documentation.language}
              onChange={(e) => updateDocumentation({ language: e.target.value as any })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
            >
              <option value="chinese">中文</option>
              <option value="english">English</option>
              <option value="auto">自动</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center">
          <input
            type="checkbox"
            data-testid="rule-doc-required"
            id="rule-doc-required"
            checked={rules.rules.documentation.required}
            onChange={(e) => updateDocumentation({ required: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="rule-doc-required" className="text-sm text-surface-300">
            必须有文档
          </label>
        </div>
      </section>

      {/* Security */}
      <section>
        <h3 className="text-sm font-semibold text-surface-200 mb-3">安全</h3>
        <div className="space-y-2">
          <SecurityCheckbox
            testid="rule-no-secrets"
            label="禁止在代码中包含密钥"
            checked={rules.rules.security.no_secrets_in_code}
            onChange={(v) => updateSecurity({ no_secrets_in_code: v })}
          />
          <SecurityCheckbox
            testid="rule-param-validation"
            label="参数必须验证"
            checked={rules.rules.security.parameter_validation}
            onChange={(v) => updateSecurity({ parameter_validation: v })}
          />
          <SecurityCheckbox
            testid="rule-input-sanitization"
            label="输入必须清理"
            checked={rules.rules.security.input_sanitization}
            onChange={(v) => updateSecurity({ input_sanitization: v })}
          />
        </div>
      </section>

      {/* Custom Rules */}
      <section>
        <h3 className="text-sm font-semibold text-surface-200 mb-3">自定义规则</h3>
        <CustomRulesEditor
          rules={rules.custom_rules}
          onChange={(custom_rules) => onUpdate({ custom_rules })}
        />
      </section>
    </div>
  );
}

// ============================================================
// YAML Editor
// ============================================================

interface RulesYamlEditorProps {
  yaml: string;
  onChange: (yaml: string) => void;
  onApply: () => void;
  validation: any;
}

function RulesYamlEditor({ yaml, onChange, onApply, validation }: RulesYamlEditorProps) {
  return (
    <div className="space-y-3">
      <textarea
        data-testid="rules-yaml-editor"
        value={yaml}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-96 font-mono text-sm bg-surface-950 border border-surface-700 rounded p-3 text-surface-100"
      />
      <div className="flex justify-between items-center">
        <div data-testid="rules-validation">
          {validation ? (
            validation.valid ? (
              <span className="text-green-400 text-sm">✓ YAML 验证通过</span>
            ) : (
              <span className="text-red-400 text-sm">
                ✗ {validation.errors.length} 个错误
              </span>
            )
          ) : (
            <span className="text-surface-500 text-sm">未验证</span>
          )}
        </div>
        <button
          data-testid="rules-apply-yaml"
          onClick={onApply}
          disabled={!validation?.valid}
          className="px-4 py-2 bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
        >
          应用 YAML
        </button>
      </div>
      {validation && !validation.valid && (
        <ul data-testid="rules-validation-errors" className="text-red-400 text-xs space-y-1">
          {validation.errors.map((err: string, i: number) => (
            <li key={i}>• {err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-surface-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function SecurityCheckbox({
  testid,
  label,
  checked,
  onChange,
}: {
  testid: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center">
      <input
        type="checkbox"
        data-testid={testid}
        id={testid}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mr-2"
      />
      <label htmlFor={testid} className="text-sm text-surface-300">
        {label}
      </label>
    </div>
  );
}

function CustomRulesEditor({
  rules,
  onChange,
}: {
  rules: string[];
  onChange: (rules: string[]) => void;
}) {
  const [newRule, setNewRule] = useState('');

  const handleAdd = () => {
    if (newRule.trim()) {
      onChange([...rules, newRule.trim()]);
      setNewRule('');
    }
  };

  const handleRemove = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <ul data-testid="custom-rules-list" className="space-y-1">
        {rules.map((rule, i) => (
          <li
            key={i}
            className="flex items-center justify-between p-2 bg-surface-800 rounded text-sm text-surface-200"
          >
            <span>{rule}</span>
            <button
              data-testid={`custom-rule-remove-${i}`}
              onClick={() => handleRemove(i)}
              className="text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          type="text"
          data-testid="custom-rule-input"
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="添加自定义规则..."
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-3 py-2 text-surface-100"
        />
        <button
          data-testid="custom-rule-add"
          onClick={handleAdd}
          className="px-4 py-2 bg-hermes-500 text-white rounded hover:bg-hermes-600"
        >
          添加
        </button>
      </div>
    </div>
  );
}
