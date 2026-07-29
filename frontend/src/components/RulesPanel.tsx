/**
 * # ============================================================
 * # RulesPanel - 规则编辑面板 (v1.0.0 Cycle 18 P0-1)
 * # ============================================================
 * # 核心作用：可视化编辑项目级 AI 规则
 * #           5 套预置模板选择 + 实时预览
 * # 运行流程：
 * #   1. 接收 currentRules + open 状态
 * #   2. 5 套模板卡片选择
 * #   3. 折叠面板：每个规则类别的可视化编辑
 * #   4. 实时 YAML 预览
 * #   5. 验证错误高亮
 * #   6. 保存/取消/重置按钮
 * # 输入参数：
 * #   - open: 是否打开
 * #   - onClose: 关闭回调
 * #   - currentRules: 当前规则
 * #   - onSave: 保存回调
 * #   - templates: 模板列表
 * # 输出结果：模态 JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 P0-1 初次创建
 * ============================================================
 */

import { useState, useMemo, useEffect } from 'react';
import type { HermesRules } from '../utils/hermesRules';
import { RULES_TEMPLATES, stringifyYaml, validateRules } from '../utils/hermesRules';

export interface RulesPanelProps {
  open: boolean;
  onClose: () => void;
  currentRules: HermesRules;
  onSave: (rules: HermesRules) => void;
  templates?: typeof RULES_TEMPLATES;
}

/** 模板卡片 */
const TemplateCard: React.FC<{
  template: (typeof RULES_TEMPLATES)[number];
  selected: boolean;
  onClick: () => void;
}> = ({ template, selected, onClick }) => (
  <button
    data-testid={`rules-template-${template.id}`}
    data-selected={selected}
    onClick={onClick}
    className={[
      'flex flex-col items-start gap-1 p-3 rounded border text-left transition-colors',
      selected
        ? 'border-blue-500 bg-blue-500/10'
        : 'border-surface-700 bg-surface-900/50 hover:bg-surface-800',
    ].join(' ')}
  >
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate-200">{template.name}</span>
      {selected && <span className="text-blue-300 text-xs">✓ 已选</span>}
    </div>
    <div className="text-xs text-slate-400">{template.description}</div>
    <div className="text-xs text-slate-500">
      {template.rules.custom_rules.length} 条自定义规则
    </div>
  </button>
);

/** 规则字段编辑 */
const FieldEdit: React.FC<{
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  testId: string;
}> = ({ label, value, options, onChange, testId }) => (
  <div className="flex items-center gap-2" data-testid={testId}>
    <label className="text-xs text-slate-400 w-32 shrink-0">{label}</label>
    <select
      data-testid={`${testId}-select`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm text-slate-200"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </div>
);

export const RulesPanel: React.FC<RulesPanelProps> = ({
  open,
  onClose,
  currentRules,
  onSave,
  templates = RULES_TEMPLATES,
}) => {
  const [draft, setDraft] = useState<HermesRules>(currentRules);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showYamlPreview, setShowYamlPreview] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(currentRules);
      setSelectedTemplateId(null);
    }
  }, [open, currentRules]);

  // 实时验证
  const validation = useMemo(() => validateRules(draft), [draft]);

  // 模板选择
  const handleSelectTemplate = (tpl: (typeof templates)[number]) => {
    setSelectedTemplateId(tpl.id);
    setDraft(tpl.rules);
  };

  // 更新字段
  const updateField = <K extends keyof HermesRules['rules']>(
    field: K,
    value: HermesRules['rules'][K]
  ) => {
    setDraft((d) => ({ ...d, rules: { ...d.rules, [field]: value } }));
    setSelectedTemplateId(null);
  };

  // 重置为默认
  const handleReset = () => {
    const defaultTpl = templates[templates.length - 1];
    setDraft(defaultTpl.rules);
    setSelectedTemplateId(defaultTpl.id);
  };

  // 保存
  const handleSave = () => {
    if (validation.valid) {
      onSave(draft);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="rules-panel"
      data-test-state={validation.valid ? 'valid' : 'invalid'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="p-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">项目级 AI 规则</h2>
          <button
            data-testid="rules-panel-close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl"
          >
            ×
          </button>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 模板选择 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">预置模板</h3>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  selected={selectedTemplateId === tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                />
              ))}
            </div>
          </section>

          {/* 规则编辑 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">规则编辑</h3>
            <div className="space-y-2 bg-surface-800/50 p-3 rounded">
              <FieldEdit
                label="类型安全"
                testId="rules-edit-type-safety"
                value={draft.rules.type_safety}
                options={['strict', 'loose', 'off']}
                onChange={(v) => updateField('type_safety', v as HermesRules['rules']['type_safety'])}
              />
              <FieldEdit
                label="错误处理"
                testId="rules-edit-error-handling"
                value={draft.rules.error_handling}
                options={['try_catch', 'result_type', 'throws']}
                onChange={(v) => updateField('error_handling', v as HermesRules['rules']['error_handling'])}
              />
              <FieldEdit
                label="导入顺序"
                testId="rules-edit-import-order"
                value={draft.rules.import_order}
                options={['alphabetical', 'grouped', 'none']}
                onChange={(v) => updateField('import_order', v as HermesRules['rules']['import_order'])}
              />
              <FieldEdit
                label="命名规范"
                testId="rules-edit-naming"
                value={draft.rules.naming_convention}
                options={['camelCase', 'snake_case', 'PascalCase', 'mixed']}
                onChange={(v) => updateField('naming_convention', v as HermesRules['rules']['naming_convention'])}
              />
            </div>
          </section>

          {/* 验证错误 */}
          {!validation.valid && (
            <section data-testid="rules-validation-errors">
              <h3 className="text-sm font-semibold text-red-300 mb-2">验证错误</h3>
              <ul className="bg-red-500/10 border border-red-500/30 rounded p-2 space-y-1">
                {validation.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-200">
                    • {err}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* YAML 预览 */}
          <section>
            <button
              data-testid="rules-yaml-toggle"
              onClick={() => setShowYamlPreview(!showYamlPreview)}
              className="text-sm font-semibold text-slate-300 hover:text-slate-100"
            >
              {showYamlPreview ? '▼' : '▶'} YAML 预览
            </button>
            {showYamlPreview && (
              <pre
                data-testid="rules-yaml-preview"
                className="mt-2 p-3 bg-surface-950 border border-surface-700 rounded text-xs text-slate-300 overflow-x-auto"
              >
                {stringifyYaml(draft, 2)}
              </pre>
            )}
          </section>
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-surface-700 flex items-center justify-between gap-2">
          <button
            data-testid="rules-reset"
            onClick={handleReset}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100"
          >
            重置
          </button>
          <div className="flex gap-2">
            <button
              data-testid="rules-cancel"
              onClick={onClose}
              className="px-4 py-1.5 text-sm bg-surface-700 hover:bg-surface-600 text-slate-200 rounded"
            >
              取消
            </button>
            <button
              data-testid="rules-save"
              onClick={handleSave}
              disabled={!validation.valid}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-surface-700 disabled:text-slate-500 text-white rounded font-semibold"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RulesPanel;
