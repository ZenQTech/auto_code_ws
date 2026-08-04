/**
 * # ============================================================
 * GoalLoopView - Goal 三层可视化组件 (v1.0.0)
 * Cycle 61 G61-02 - Goal mode 完整循环 UI
 * # ============================================================
 * 核心作用：以三层结构（Goal-Plan-Step）可视化展示当前循环进度
 *           支持：Goal 选择、Plan CRUD、Step 状态切换、进度条
 * 运行流程：
 *   1. 显示 Goal 列表（左侧栏）
 *   2. 选择 Goal → 显示其下所有 Plan（中栏）
 *   3. 选择 Plan → 显示 Step 列表（右侧栏）+ 进度条
 *   4. 支持添加 Step、启动/暂停 Plan、修改 Step 状态
 * 设计要点：
 *   - 三栏响应式布局（移动端自动堆叠）
 *   - 主题色配色（hermes 品牌色 + 状态色）
 *   - 实时刷新进度
 *   - 紧凑模式（嵌入式使用）
 * 输入参数：{ compact?: boolean, onClose?: () => void }
 * 输出结果：完整三层可视化 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Cycle 61 G61-02 初次创建
 * ====================================
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useGoalLoop, type GoalPlan, type PlanStep, type StepStatus } from '../hooks/useGoalLoop';
import { useIsMobile } from '../hooks/useResponsive';

// ============================================================
// 类型
// ============================================================

export interface GoalLoopViewProps {
  /** 紧凑模式（嵌入式使用） */
  compact?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
  /** 测试 ID */
  testId?: string;
}

// ============================================================
// 状态配色
// ============================================================

const STEP_STATUS_COLORS: Record<StepStatus, { dot: string; bg: string; text: string; label: string }> = {
  pending: { dot: 'bg-gray-400', bg: 'bg-gray-500/10', text: 'text-gray-400', label: '待执行' },
  running: { dot: 'bg-blue-400 animate-pulse', bg: 'bg-blue-500/10', text: 'text-blue-400', label: '执行中' },
  success: { dot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', label: '成功' },
  failed: { dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-400', label: '失败' },
  skipped: { dot: 'bg-yellow-400', bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: '跳过' },
  cancelled: { dot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', label: '取消' },
};

const PLAN_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: '草稿' },
  pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: '待执行' },
  running: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: '执行中' },
  paused: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: '暂停' },
  completed: { bg: 'bg-green-500/15', text: 'text-green-400', label: '完成' },
  failed: { bg: 'bg-red-500/15', text: 'text-red-400', label: '失败' },
  cancelled: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: '取消' },
};

// ============================================================
// 子组件：Step 行
// ============================================================

const StepRow: React.FC<{
  step: PlanStep;
  onUpdate: (status: StepStatus) => void;
  testId?: string;
}> = ({ step, onUpdate, testId }) => {
  const color = STEP_STATUS_COLORS[step.status];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid={`${testId}-step-${step.order}`}
      className={`rounded-md border border-[var(--border-color)] ${color.bg} p-2.5`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${color.dot} flex-shrink-0`} aria-label={color.label} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${color.text} truncate`}>
            <span className="text-[var(--text-tertiary)] mr-1">#{step.order + 1}</span>
            {step.title}
          </div>
          {step.description && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate">
              {step.description}
            </div>
          )}
        </div>
        {step.retry_count > 0 && (
          <span className="text-[10px] text-yellow-500 flex-shrink-0" title="重试次数">
            ↻{step.retry_count}/{step.max_retries}
          </span>
        )}
        {step.duration_ms() > 0 && (
          <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0" title="耗时">
            {step.duration_ms() < 1000 ? `${step.duration_ms()}ms` : `${(step.duration_ms() / 1000).toFixed(1)}s`}
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-1"
          aria-label={expanded ? '折叠' : '展开'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-[var(--border-color)] space-y-1.5">
          {step.prompt && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              <span className="text-purple-400 font-mono">prompt:</span>
              <pre className="mt-0.5 p-1.5 bg-[var(--bg-app)] rounded text-[10px] overflow-x-auto whitespace-pre-wrap font-mono">
                {step.prompt.slice(0, 500)}
              </pre>
            </div>
          )}
          {step.output && (
            <div className="text-[10px] text-[var(--text-tertiary)]">
              <span className="text-green-400 font-mono">output:</span>
              <pre className="mt-0.5 p-1.5 bg-[var(--bg-app)] rounded text-[10px] overflow-x-auto whitespace-pre-wrap font-mono max-h-24">
                {step.output.slice(0, 500)}
              </pre>
            </div>
          )}
          {step.error && (
            <div className="text-[10px] text-red-400">
              <span className="font-mono">error:</span>
              <pre className="mt-0.5 p-1.5 bg-red-900/10 rounded text-[10px] overflow-x-auto whitespace-pre-wrap font-mono max-h-24">
                {step.error.slice(0, 500)}
              </pre>
            </div>
          )}
          {step.status === 'pending' && (
            <div className="flex gap-1 mt-1">
              <button
                type="button"
                onClick={() => onUpdate('running')}
                className="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              >
                ▶ Start
              </button>
              <button
                type="button"
                onClick={() => onUpdate('skipped')}
                className="px-2 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30"
              >
                ⏭ Skip
              </button>
            </div>
          )}
          {step.status === 'running' && (
            <div className="flex gap-1 mt-1">
              <button
                type="button"
                onClick={() => onUpdate('success')}
                className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-300 hover:bg-green-500/30"
              >
                ✓ Success
              </button>
              <button
                type="button"
                onClick={() => onUpdate('failed')}
                className="px-2 py-0.5 text-[10px] rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
              >
                ✗ Failed
              </button>
            </div>
          )}
          {(step.status === 'failed' || step.status === 'success' || step.status === 'skipped') && (
            <button
              type="button"
              onClick={() => onUpdate('pending')}
              className="px-2 py-0.5 text-[10px] rounded bg-gray-500/20 text-gray-300 hover:bg-gray-500/30"
            >
              ↺ Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 子组件：Plan 卡片
// ============================================================

const PlanCard: React.FC<{
  plan: GoalPlan;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onCancel: () => void;
  testId?: string;
}> = ({ plan, selected, onSelect, onStart, onPause, onResume, onComplete, onCancel, testId }) => {
  const planColor = PLAN_STATUS_COLORS[plan.status] ?? PLAN_STATUS_COLORS.pending;
  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const step of plan.steps) {
      s[step.status] = (s[step.status] ?? 0) + 1;
    }
    return s;
  }, [plan.steps]);

  return (
    <div
      data-testid={`${testId}-${plan.plan_id}`}
      onClick={onSelect}
      className={`p-2.5 rounded-md border cursor-pointer transition-colors ${
        selected
          ? 'border-hermes-500 bg-hermes-500/10'
          : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-[var(--text-primary)] truncate">{plan.title}</div>
          {plan.description && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate">{plan.description}</div>
          )}
        </div>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${planColor.bg} ${planColor.text} flex-shrink-0`}
        >
          {planColor.label}
        </span>
      </div>

      {/* 进度条 */}
      <div className="mt-2 h-1 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-hermes-500 to-hermes-400 transition-all"
          style={{ width: `${Math.round(plan.progress * 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
        <span>
          {plan.steps.length} 步骤 · 完成 {Math.round(plan.progress * 100)}%
        </span>
        <div className="flex gap-1">
          {Object.entries(stats).map(([status, count]) => (
            <span key={status} className={`${STEP_STATUS_COLORS[status as StepStatus]?.text ?? ''}`}>
              {count}
            </span>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      {selected && (
        <div className="mt-2 flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {plan.status === 'pending' || plan.status === 'draft' ? (
            <button
              type="button"
              onClick={onStart}
              className="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              data-testid={`${testId}-plan-start`}
            >
              ▶ Start
            </button>
          ) : null}
          {plan.status === 'running' && (
            <button
              type="button"
              onClick={onPause}
              className="px-2 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30"
              data-testid={`${testId}-plan-pause`}
            >
              ⏸ Pause
            </button>
          )}
          {plan.status === 'paused' && (
            <button
              type="button"
              onClick={onResume}
              className="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              data-testid={`${testId}-plan-resume`}
            >
              ▶ Resume
            </button>
          )}
          {(plan.status === 'running' || plan.status === 'paused') && (
            <button
              type="button"
              onClick={onComplete}
              className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-300 hover:bg-green-500/30"
              data-testid={`${testId}-plan-complete`}
            >
              ✓ Complete
            </button>
          )}
          {plan.status !== 'completed' && plan.status !== 'cancelled' && (
            <button
              type="button"
              onClick={onCancel}
              className="px-2 py-0.5 text-[10px] rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
              data-testid={`${testId}-plan-cancel`}
            >
              ✗ Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const GoalLoopView: React.FC<GoalLoopViewProps> = ({
  compact = false,
  onClose,
  testId = 'goal-loop-view',
}) => {
  const isMobile = useIsMobile();
  const goalLoop = useGoalLoop();

  // 本地状态
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newStepTitle, setNewStepTitle] = useState('');

  const currentPlan = useMemo(
    () => goalLoop.plans.find((p) => p.plan_id === selectedPlanId) ?? null,
    [goalLoop.plans, selectedPlanId],
  );

  // ============================================================
  // 回调
  // ============================================================

  const handleCreatePlan = useCallback(async () => {
    if (!goalLoop.currentGoal) return;
    if (!newPlanTitle.trim()) return;
    const plan = await goalLoop.createPlan(goalLoop.currentGoal.id, newPlanTitle);
    if (plan) {
      setNewPlanTitle('');
      setSelectedPlanId(plan.plan_id);
    }
  }, [goalLoop, newPlanTitle]);

  const handleAddStep = useCallback(async () => {
    if (!currentPlan) return;
    if (!newStepTitle.trim()) return;
    await goalLoop.addStep(currentPlan.plan_id, newStepTitle);
    setNewStepTitle('');
  }, [goalLoop, currentPlan, newStepTitle]);

  const handleUpdateStep = useCallback(
    async (stepId: string, status: StepStatus) => {
      if (!currentPlan) return;
      await goalLoop.updateStepStatus(currentPlan.plan_id, stepId, status);
    },
    [goalLoop, currentPlan],
  );

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div
      data-testid={testId}
      className={`flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)] ${
        compact ? 'text-xs' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">🎯 Goal Loop</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {goalLoop.goals.length} goals · {goalLoop.plans.length} plans
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 text-xs rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            data-testid={`${testId}-close`}
          >
            ✕
          </button>
        )}
      </div>

      {/* 三栏布局 */}
      <div
        className={`flex-1 min-h-0 ${
          isMobile ? 'flex flex-col' : 'flex'
        }`}
      >
        {/* 左栏：Goal 列表 */}
        <div
          data-testid={`${testId}-goals`}
          className={`${isMobile ? 'w-full' : 'w-48'} flex-shrink-0 border-r border-[var(--border-color)] overflow-y-auto`}
        >
          <div className="p-2 text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider font-semibold border-b border-[var(--border-color)]">
            Goals
          </div>
          {goalLoop.goalsLoading ? (
            <div className="p-3 text-[10px] text-[var(--text-tertiary)]">加载中...</div>
          ) : goalLoop.goalsError ? (
            <div className="p-3 text-[10px] text-red-400">错误: {goalLoop.goalsError}</div>
          ) : goalLoop.goals.length === 0 ? (
            <div className="p-3 text-[10px] text-[var(--text-tertiary)] italic">暂无 Goal</div>
          ) : (
            <div className="p-1.5 space-y-1">
              {goalLoop.goals.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => goalLoop.setCurrentGoal(goal)}
                  data-testid={`${testId}-goal-${goal.id}`}
                  className={`w-full text-left p-2 rounded transition-colors ${
                    goalLoop.currentGoal?.id === goal.id
                      ? 'bg-hermes-500/20 border border-hermes-500/50'
                      : 'bg-[var(--bg-panel)] border border-[var(--border-color)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  <div className="text-xs font-medium truncate">{goal.title}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                    {goal.status} · {goal.tags.join(', ') || 'no tags'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 中栏：Plan 列表 */}
        <div
          data-testid={`${testId}-plans`}
          className={`${isMobile ? 'w-full' : 'w-64'} flex-shrink-0 border-r border-[var(--border-color)] overflow-y-auto`}
        >
          <div className="p-2 border-b border-[var(--border-color)] flex items-center justify-between">
            <span className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider font-semibold">
              Plans
            </span>
            <button
              type="button"
              onClick={() => goalLoop.refreshGoals()}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title="刷新"
            >
              ↻
            </button>
          </div>
          {!goalLoop.currentGoal ? (
            <div className="p-3 text-[10px] text-[var(--text-tertiary)] italic">先选择 Goal</div>
          ) : (
            <div className="p-1.5 space-y-1.5">
              {goalLoop.plansLoading ? (
                <div className="p-2 text-[10px] text-[var(--text-tertiary)]">加载中...</div>
              ) : goalLoop.plans.length === 0 ? (
                <div className="p-2 text-[10px] text-[var(--text-tertiary)] italic">暂无 Plan</div>
              ) : (
                goalLoop.plans.map((plan) => (
                  <PlanCard
                    key={plan.plan_id}
                    plan={plan}
                    selected={plan.plan_id === selectedPlanId}
                    onSelect={() => setSelectedPlanId(plan.plan_id)}
                    onStart={() => goalLoop.startPlan(plan.plan_id)}
                    onPause={() => goalLoop.pausePlan(plan.plan_id)}
                    onResume={() => goalLoop.resumePlan(plan.plan_id)}
                    onComplete={() => goalLoop.completePlan(plan.plan_id)}
                    onCancel={() => goalLoop.cancelPlan(plan.plan_id)}
                    testId={`${testId}-plan`}
                  />
                ))
              )}
              {/* 新建 Plan 输入框 */}
              <div className="pt-1 space-y-1">
                <input
                  type="text"
                  value={newPlanTitle}
                  onChange={(e) => setNewPlanTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlan();
                  }}
                  placeholder="新建 Plan..."
                  className="w-full px-2 py-1 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)]"
                  data-testid={`${testId}-new-plan-input`}
                />
                <button
                  type="button"
                  onClick={handleCreatePlan}
                  disabled={!newPlanTitle.trim()}
                  className="w-full px-2 py-1 text-[10px] rounded bg-hermes-500/20 text-hermes-400 hover:bg-hermes-500/30 disabled:opacity-50"
                  data-testid={`${testId}-new-plan-button`}
                >
                  + 创建 Plan
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：Step 详情 */}
        <div
          data-testid={`${testId}-steps`}
          className="flex-1 min-w-0 overflow-y-auto"
        >
          <div className="p-2 border-b border-[var(--border-color)] flex items-center justify-between">
            <span className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider font-semibold">
              {currentPlan ? `${currentPlan.title} · Steps` : 'Steps'}
            </span>
            {goalLoop.planProgress && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {Math.round(goalLoop.planProgress.progress * 100)}% · {goalLoop.planProgress.duration_ms}ms
              </span>
            )}
          </div>
          {!currentPlan ? (
            <div className="p-3 text-[10px] text-[var(--text-tertiary)] italic">选择 Plan 查看 Steps</div>
          ) : currentPlan.steps.length === 0 ? (
            <div className="p-3 text-[10px] text-[var(--text-tertiary)] italic">暂无 Step</div>
          ) : (
            <div className="p-2 space-y-1.5">
              {currentPlan.steps
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((step) => (
                  <StepRow
                    key={step.step_id}
                    step={step}
                    onUpdate={(status) => handleUpdateStep(step.step_id, status)}
                    testId={`${testId}`}
                  />
                ))}
            </div>
          )}

          {/* 添加 Step */}
          {currentPlan && (
            <div className="p-2 border-t border-[var(--border-color)] flex gap-1.5">
              <input
                type="text"
                value={newStepTitle}
                onChange={(e) => setNewStepTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddStep();
                }}
                placeholder="添加 Step..."
                className="flex-1 px-2 py-1 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded border border-[var(--border-color)]"
                data-testid={`${testId}-new-step-input`}
              />
              <button
                type="button"
                onClick={handleAddStep}
                disabled={!newStepTitle.trim()}
                className="px-2 py-1 text-[10px] rounded bg-hermes-500/20 text-hermes-400 hover:bg-hermes-500/30 disabled:opacity-50"
                data-testid={`${testId}-new-step-button`}
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GoalLoopView;
