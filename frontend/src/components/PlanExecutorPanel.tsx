/**
 * # ============================================================
 * # PlanExecutorPanel 组件 (v1.0.0)
 * # Cycle 61 G61-04
 * # ====================================
 * # 核心作用：ComposerPlan 真正可执行面板
 * #           - 输入 prompt → 一键执行（LLM 分解 + 自动执行）
 * #           - 实时显示执行进度（轮询）
 * #           - 步骤状态可视化
 * #           - 控制按钮：暂停 / 恢复 / 取消 / 重试 / 跳过
 * # 运行流程：
 * #   1. 用户输入 prompt
 * #   2. 点击"一键执行" → POST /api/plan-execute
 * #   3. 轮询 /api/plan-execute/{id} 刷新状态
 * #   4. 步骤状态实时更新
 * #   5. 支持展开 / 折叠子步骤详情
 * # 输入参数：onClose, compact
 * # 输出结果：React 组件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
 * # ====================================
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useComposerPlan, ExecutionState, PlanStep } from '../hooks/useComposerPlan';

export interface PlanExecutorPanelProps {
  onClose?: () => void;
  compact?: boolean;
  testId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-300',
  ready: 'bg-blue-500/20 text-blue-300',
  running: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  success: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
  skipped: 'bg-slate-500/20 text-slate-400',
  cancelled: 'bg-slate-500/20 text-slate-400',
  draft: 'bg-gray-500/20 text-gray-300',
  paused: 'bg-purple-500/20 text-purple-300',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  ready: '▶️',
  running: '🔄',
  completed: '✅',
  success: '✅',
  failed: '❌',
  skipped: '⏭️',
  cancelled: '🚫',
  draft: '📝',
  paused: '⏸️',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const icon = STATUS_ICONS[status] || '•';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${cls}`}>
      {icon} {status}
    </span>
  );
}

function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value || 0) * 100));
  return (
    <div className="w-full">
      {label && <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">{label}</div>}
      <div className="w-full h-1.5 bg-[var(--bg-elevated)] rounded overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-hermes-500 to-hermes-300 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepCard({ step, onRetry, onSkip, compact }: {
  step: PlanStep;
  onRetry: (stepId: string) => void;
  onSkip: (stepId: string) => void;
  compact: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-testid={`plan-step-${step.step_id}`}
      className={`border border-[var(--border-color)] rounded p-2 bg-[var(--bg-panel)] ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
            {step.step_id}
          </span>
          <span className="font-medium truncate">{step.title}</span>
        </div>
        <StatusBadge status={step.status} />
      </div>
      {step.action && step.action !== 'noop' && (
        <div className="mt-1 text-[10px] text-[var(--text-tertiary)] font-mono">
          action: {step.action}
        </div>
      )}
      {(step.status === 'running' || step.progress > 0) && (
        <div className="mt-1">
          <ProgressBar value={step.progress} />
        </div>
      )}
      {step.error && (
        <div className="mt-1 text-[10px] text-red-400 font-mono truncate" title={step.error}>
          ⚠ {step.error}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          data-testid={`plan-step-${step.step_id}-toggle`}
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          {expanded ? '▼ 详情' : '▶ 详情'}
        </button>
        {step.status === 'failed' && (
          <button
            type="button"
            data-testid={`plan-step-${step.step_id}-retry`}
            onClick={() => onRetry(step.step_id)}
            className="px-2 py-0.5 text-[10px] rounded bg-hermes-500/20 text-hermes-300 hover:bg-hermes-500/30"
          >
            🔄 重试
          </button>
        )}
        {(step.status === 'pending' || step.status === 'ready' || step.status === 'failed') && (
          <button
            type="button"
            data-testid={`plan-step-${step.step_id}-skip`}
            onClick={() => onSkip(step.step_id)}
            className="px-2 py-0.5 text-[10px] rounded bg-slate-500/20 text-slate-300 hover:bg-slate-500/30"
          >
            ⏭️ 跳过
          </button>
        )}
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
          attempts: {step.attempts}/{step.max_attempts}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 p-2 bg-[var(--bg-elevated)] rounded text-[10px] font-mono space-y-1">
          {step.description && (
            <div className="text-[var(--text-secondary)]">{step.description}</div>
          )}
          {step.depends_on && step.depends_on.length > 0 && (
            <div className="text-[var(--text-tertiary)]">
              depends_on: [{step.depends_on.join(', ')}]
            </div>
          )}
          {step.params && Object.keys(step.params).length > 0 && (
            <details>
              <summary className="cursor-pointer text-[var(--text-tertiary)]">params</summary>
              <pre className="mt-1 text-[10px] overflow-x-auto">
                {JSON.stringify(step.params, null, 2)}
              </pre>
            </details>
          )}
          {step.output && Object.keys(step.output).length > 0 && (
            <details>
              <summary className="cursor-pointer text-[var(--text-tertiary)]">output</summary>
              <pre className="mt-1 text-[10px] overflow-x-auto">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export const PlanExecutorPanel: React.FC<PlanExecutorPanelProps> = ({
  onClose,
  compact = false,
  testId = 'plan-executor-panel',
}) => {
  const composer = useComposerPlan();
  const [prompt, setPrompt] = useState('');
  const [autoDecompose, setAutoDecompose] = useState(true);
  const [maxSteps, setMaxSteps] = useState(8);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 加载 plan 列表
  useEffect(() => {
    void composer.refreshPlans();
  }, [composer.refreshPlans]);

  const handleExecute = useCallback(async () => {
    if (!prompt.trim()) {
      composer.setError('请输入 prompt');
      return;
    }
    await composer.execute({
      prompt: prompt.trim(),
      auto_decompose: autoDecompose,
      max_steps: maxSteps,
    });
  }, [prompt, autoDecompose, maxSteps, composer]);

  const handleCancel = useCallback(async () => {
    if (composer.currentExecution) {
      await composer.cancelPlan(composer.currentExecution.plan_id);
    }
  }, [composer]);

  const handlePause = useCallback(async () => {
    if (composer.currentExecution) {
      await composer.pausePlan(composer.currentExecution.plan_id);
    }
  }, [composer]);

  const handleResume = useCallback(async () => {
    if (composer.currentExecution) {
      await composer.resumePlan(composer.currentExecution.plan_id);
    }
  }, [composer]);

  const handleRetryStep = useCallback((stepId: string) => {
    if (composer.currentExecution) {
      void composer.retryStep(composer.currentExecution.plan_id, stepId);
    }
  }, [composer]);

  const handleSkipStep = useCallback((stepId: string) => {
    if (composer.currentExecution) {
      void composer.skipStep(composer.currentExecution.plan_id, stepId);
    }
  }, [composer]);

  const plan = composer.currentExecution?.plan || composer.currentPlan;
  const execution = composer.currentExecution;
  const isRunning = execution?.status === 'running';
  const isPaused = execution?.status === 'paused';
  const isFinished = execution && ['completed', 'failed', 'cancelled'].includes(execution.status);

  return (
    <div
      data-testid={testId}
      className={`flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)] ${compact ? 'text-xs' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">▶️ Plan Executor</span>
          {execution && (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {execution.execution_id}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            data-testid={`${testId}-close`}
            onClick={onClose}
            className="px-2 py-0.5 text-xs rounded hover:bg-[var(--bg-elevated)]"
          >
            ✕
          </button>
        )}
      </div>

      {/* Prompt 输入区 */}
      <div className="p-3 border-b border-[var(--border-color)] space-y-2">
        <textarea
          data-testid={`${testId}-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入用户需求，系统将自动调用 LLM 分解为可执行步骤…"
          rows={3}
          disabled={isRunning}
          className="w-full px-2 py-1.5 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded resize-none focus:outline-none focus:border-hermes-500 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
            <input
              type="checkbox"
              data-testid={`${testId}-auto-decompose`}
              checked={autoDecompose}
              onChange={(e) => setAutoDecompose(e.target.checked)}
              disabled={isRunning}
            />
            LLM 分解
          </label>
          <label className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
            max_steps:
            <input
              type="number"
              data-testid={`${testId}-max-steps`}
              value={maxSteps}
              onChange={(e) => setMaxSteps(Math.max(1, Math.min(20, parseInt(e.target.value) || 8)))}
              min={1}
              max={20}
              disabled={isRunning}
              className="w-12 px-1 py-0.5 text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
            />
          </label>
          <div className="flex-1" />
          {!execution && (
            <button
              type="button"
              data-testid={`${testId}-execute`}
              onClick={() => void handleExecute()}
              disabled={composer.isExecuting || !prompt.trim()}
              className="px-3 py-1 text-xs rounded bg-hermes-500 text-white hover:bg-hermes-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {composer.isExecuting ? '⏳ 执行中…' : '🚀 一键执行'}
            </button>
          )}
          {execution && isRunning && (
            <>
              <button
                type="button"
                data-testid={`${testId}-pause`}
                onClick={() => void handlePause()}
                className="px-2 py-1 text-xs rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
              >
                ⏸ 暂停
              </button>
              <button
                type="button"
                data-testid={`${testId}-cancel`}
                onClick={() => void handleCancel()}
                className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
              >
                ⏹ 取消
              </button>
            </>
          )}
          {execution && isPaused && (
            <>
              <button
                type="button"
                data-testid={`${testId}-resume`}
                onClick={() => void handleResume()}
                className="px-2 py-1 text-xs rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
              >
                ▶ 恢复
              </button>
              <button
                type="button"
                data-testid={`${testId}-cancel`}
                onClick={() => void handleCancel()}
                className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
              >
                ⏹ 取消
              </button>
            </>
          )}
          {execution && isFinished && (
            <button
              type="button"
              data-testid={`${testId}-reset`}
              onClick={() => {
                composer.setError(null);
                // 重置由 user 重新输入
              }}
              className="px-2 py-1 text-xs rounded bg-slate-500/20 text-slate-300 hover:bg-slate-500/30"
            >
              🔄 新建
            </button>
          )}
        </div>
        {composer.error && (
          <div
            data-testid={`${testId}-error`}
            className="px-2 py-1 text-[10px] rounded bg-red-500/10 text-red-300 border border-red-500/30"
          >
            ⚠ {composer.error}
          </div>
        )}
      </div>

      {/* 执行状态区 */}
      {execution && (
        <div className="p-3 border-b border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusBadge status={execution.status} />
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {plan?.title || 'Plan'}
              </span>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {plan?.steps?.length || 0} steps · {Math.round((execution.progress || 0) * 100)}%
            </span>
          </div>
          <ProgressBar value={execution.progress} />
        </div>
      )}

      {/* 步骤列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {!execution && !plan && (
          <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
            等待执行…
          </div>
        )}
        {plan && plan.steps && plan.steps.length > 0 && (
          <>
            {plan.steps.map((step) => (
              <StepCard
                key={step.step_id}
                step={step}
                onRetry={handleRetryStep}
                onSkip={handleSkipStep}
                compact={compact}
              />
            ))}
          </>
        )}
        {plan && (!plan.steps || plan.steps.length === 0) && (
          <div className="text-center text-xs text-[var(--text-tertiary)] py-8">
            计划无步骤
          </div>
        )}
      </div>

      {/* Footer */}
      {execution && (
        <div className="px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-tertiary)] flex items-center justify-between">
          <span>
            {plan?.summary &&
              Object.entries(plan.summary)
                .filter(([_, n]) => n > 0)
                .map(([s, n]) => `${STATUS_ICONS[s] || '•'} ${s}: ${n}`)
                .join(' · ')}
          </span>
          {execution.finished_at && execution.started_at && (
            <span>
              {(execution.finished_at - execution.started_at).toFixed(1)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default PlanExecutorPanel;
