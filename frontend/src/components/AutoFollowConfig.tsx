/**
 * # ============================================================
 * AutoFollowConfig - Auto-Follow 配置组件 (v1.0.0)
 * Cycle 61 G61-03-T4
 * # ============================================================
 * 核心作用：可视化配置 Auto-Follow 联动行为
 * 运行流程：
 *   1. 显示当前 enabled / 节流窗口 / 预测开关 / SplitView 状态
 *   2. 显示事件 → panel 映射表（可点击修改）
 *   3. 显示 sticky tools 列表（可增删）
 *   4. 配置变更实时持久化到 localStorage
 * 设计要点：
 *   - 折叠面板：默认显示主要配置，展开显示完整映射
 *   - 主题感知：bg-[var(--bg-panel)]
 *   - 受控/非受控：既支持 setConfig 注入，也支持内部状态
 * 输入参数：{ autoFollow, className?, testId? }
 * 输出结果：React JSX
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T4 初次创建
 * ====================================
 */

import React, { useState } from 'react';
import type { UseAutoFollowResult, AutoFollowEventType, AutoFollowConfig } from '../hooks/useAutoFollow';
import type { PanelKey } from '../hooks/useModals';

export interface AutoFollowConfigProps {
  autoFollow: UseAutoFollowResult;
  className?: string;
  testId?: string;
}

const EVENT_LABELS: Record<AutoFollowEventType, string> = {
  vibe_step_started: 'Step 启动',
  vibe_plan_generated: 'Plan 已生成',
  vibe_code_writing: '正在编写代码',
  vibe_test_running: '正在运行测试',
  vibe_step_completed: 'Step 已完成',
  vibe_step_failed: 'Step 失败',
  vibe_plan_completed: 'Plan 已完成',
  loop_state_changed: 'Loop 状态变更',
  claude_shell_output: 'Claude Shell 输出',
  spec_review_requested: 'Spec 审核',
  goal_progress_updated: 'Goal 进度',
  subagent_spawned: 'SubAgent 启动',
  subagent_completed: 'SubAgent 完成',
  diff_preview_ready: 'Diff 预览就绪',
  test_results_ready: '测试结果就绪',
};

export const AutoFollowConfig: React.FC<AutoFollowConfigProps> = ({
  autoFollow,
  className = '',
  testId = 'auto-follow-config',
}) => {
  const { enabled, setEnabled, config, setConfig, stickyTools, addSticky, removeSticky, splitView, toggleSplitView } = autoFollow;
  const [expanded, setExpanded] = useState(false);
  const [newStickyInput, setNewStickyInput] = useState('');

  const handleThrottleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v >= 50 && v <= 2000) {
      setConfig({ ...config, throttleMs: v });
    }
  };

  const handleAddSticky = () => {
    const v = newStickyInput.trim();
    if (v) {
      addSticky(v as PanelKey);
      setNewStickyInput('');
    }
  };

  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setConfig({ ...config, throttleStrategy: e.target.value as 'leading' | 'trailing' });
  };

  return (
    <div
      data-testid={testId}
      className={`p-3 rounded-md bg-[var(--bg-panel)] border border-[var(--border-color)] ${className}`}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Auto-Follow 配置
        </h3>
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          onClick={() => setExpanded((p) => !p)}
          className="text-xs text-[var(--text-secondary)] hover:text-hermes-500"
        >
          {expanded ? '收起 ▲' : '展开 ▼'}
        </button>
      </div>

      {/* 基础开关 */}
      <div className="space-y-2">
        <label
          data-testid={`${testId}-enabled`}
          className="flex items-center justify-between text-sm cursor-pointer"
        >
          <span className="text-[var(--text-primary)]">启用 Auto-Follow</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="cursor-pointer"
          />
        </label>

        <label
          data-testid={`${testId}-splitview`}
          className="flex items-center justify-between text-sm cursor-pointer"
        >
          <span className="text-[var(--text-primary)]">Split View 双栏</span>
          <input
            type="checkbox"
            checked={splitView}
            onChange={toggleSplitView}
            className="cursor-pointer"
          />
        </label>

        <label
          data-testid={`${testId}-predictive`}
          className="flex items-center justify-between text-sm cursor-pointer"
        >
          <span className="text-[var(--text-primary)]">Predictive Switch</span>
          <input
            type="checkbox"
            checked={config.predictive}
            onChange={(e) => setConfig({ ...config, predictive: e.target.checked })}
            className="cursor-pointer"
          />
        </label>
      </div>

      {/* 展开：详细配置 */}
      {expanded && (
        <div data-testid={`${testId}-expanded`} className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-3">
          {/* 节流窗口 */}
          <div>
            <label className="text-xs text-[var(--text-secondary)]">
              节流窗口（ms）: {config.throttleMs}
            </label>
            <input
              data-testid={`${testId}-throttle`}
              type="range"
              min={50}
              max={2000}
              step={50}
              value={config.throttleMs}
              onChange={handleThrottleChange}
              className="w-full"
            />
          </div>

          {/* 节流策略 */}
          <div>
            <label className="text-xs text-[var(--text-secondary)]">节流策略：</label>
            <select
              data-testid={`${testId}-strategy`}
              value={config.throttleStrategy}
              onChange={handleStrategyChange}
              className="ml-2 px-2 py-1 text-xs bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded"
            >
              <option value="leading">leading（立即触发）</option>
              <option value="trailing">trailing（窗口结束）</option>
            </select>
          </div>

          {/* 事件 → panel 映射 */}
          <div data-testid={`${testId}-mapping`}>
            <div className="text-xs text-[var(--text-secondary)] mb-1">
              事件 → Panel 映射（共 15 项）
            </div>
            <div className="max-h-40 overflow-y-auto text-xs space-y-1">
              {(Object.keys(EVENT_LABELS) as AutoFollowEventType[]).map((evType) => (
                <div
                  key={evType}
                  data-testid={`${testId}-mapping-${evType}`}
                  className="flex justify-between text-[var(--text-primary)]"
                >
                  <span>{EVENT_LABELS[evType]}</span>
                  <span className="text-[var(--text-secondary)]">
                    → {config.panelMapping[evType] || 'null'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Sticky Tools 管理 */}
          <div data-testid={`${testId}-sticky`}>
            <div className="text-xs text-[var(--text-secondary)] mb-1">
              Sticky Tools（固定，不受 Auto-Follow 影响）
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {stickyTools.length === 0 ? (
                <span className="text-xs text-[var(--text-tertiary)]">无</span>
              ) : (
                stickyTools.map((p) => (
                  <span
                    key={p}
                    data-testid={`${testId}-sticky-${p}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded
                      bg-hermes-500 text-white"
                  >
                    📌 {p}
                    <button
                      type="button"
                      data-testid={`${testId}-sticky-remove-${p}`}
                      onClick={() => removeSticky(p)}
                      className="hover:text-red-200"
                      aria-label={`移除 ${p}`}
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-1">
              <input
                data-testid={`${testId}-sticky-input`}
                type="text"
                value={newStickyInput}
                onChange={(e) => setNewStickyInput(e.target.value)}
                placeholder="panel 名称"
                className="flex-1 px-2 py-1 text-xs bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSticky();
                }}
              />
              <button
                type="button"
                data-testid={`${testId}-sticky-add`}
                onClick={handleAddSticky}
                className="px-3 py-1 text-xs rounded bg-hermes-500 text-white hover:bg-hermes-600"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoFollowConfig;
