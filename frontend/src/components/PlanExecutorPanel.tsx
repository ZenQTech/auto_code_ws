/**
 * # ============================================================
 * PlanExecutorPanel - Plan 执行面板 (v1.1.0)
 * Cycle 58 G58-05 升级 v1.1.0：对接后端 /api/composer-plan
 * # ============================================================
 * 核心作用：ComposerPlan 真正可执行的 UI 面板
 * 运行流程：
 *   1. 接收 planId + sessionId
 *   2. 通过 SSE 订阅 /api/composer-plan/{plan_id}/events
 *   3. 实时显示每 step 的状态
 *   4. 提供 start/pause/resume/cancel/retry/skip 控制
 *   5. 显示 step 输出预览
 * 设计要点：
 *   - 独立 panel（不依赖 Vibe Coding 主舞台）
 *   - 可关闭
 *   - 支持嵌入式 step 重试/跳过
 *   - 适配 ComposerPlan 数据模型（plan_id/step_id/action/status）
 * 输入参数：{ planId, sessionId, onClose }
 * 输出结果：Plan 执行进度 UI
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-05 初次创建
 * #   - 2026-08-03 | v1.1.0 | 切换到 /api/composer-plan 端点
 * ====================================
 */

import React, { useEffect, useState } from 'react';

// ============================================================
// 类型（与后端 ComposerPlan 对齐）
// ============================================================

export interface PlanStep {
  step_id: string;
  title: string;
  description: string;
  action: string;
  depends_on: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  progress: number;
  attempts: number;
  max_attempts: number;
  error?: string;
  output?: Record<string, unknown>;
}

export interface Plan {
  plan_id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  summary: Record<string, number>;
}

export interface PlanExecutorPanelProps {
  planId?: string;
  sessionId?: string;
  onClose: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/composer-plan';
const isBrowser = typeof window !== 'undefined';

const STEP_STATUS_COLORS: Record<PlanStep['status'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  ready: 'bg-cyan-100 text-cyan-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-orange-100 text-orange-700',
};

const STEP_STATUS_LABELS: Record<PlanStep['status'], string> = {
  pending: '等待依赖',
  ready: '就绪',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
};

const PLAN_STATUS_LABELS: Record<Plan['status'], string> = {
  draft: '草稿',
  ready: '就绪',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ============================================================
// 组件
// ============================================================

const PlanExecutorPanel: React.FC<PlanExecutorPanelProps> = ({
  planId,
  sessionId,
  onClose,
}) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);

  // 拉取 Plan 详情
  useEffect(() => {
    if (!isBrowser || !planId) return;
    const controller = new AbortController();
    fetch(`${DEFAULT_BASE_URL}/${planId}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.plan as Plan;
      })
      .then((data) => setPlan(data))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(`Plan 拉取失败: ${err.message ?? err}`);
        }
      });
    return () => controller.abort();
  }, [planId]);

  // 订阅 SSE 事件（/api/composer-plan/{plan_id}/events）
  useEffect(() => {
    if (!isBrowser || !planId) return;
    const es = new EventSource(`${DEFAULT_BASE_URL}/${planId}/events`);

    const refresh = async () => {
      try {
        const res = await fetch(`${DEFAULT_BASE_URL}/${planId}`);
        if (res.ok) {
          const data = await res.json();
          setPlan(data.plan);
        }
      } catch {
        /* ignore */
      }
    };

    const handleStepEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'step_status_changed' || data.type === 'step_progress' || data.type === 'step_retry') {
          refresh();
        }
      } catch (err) {
        console.warn('PlanExecutorPanel: parse step event failed', err);
      }
    };

    const handlePlanEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (
          data.type === 'plan_completed' ||
          data.type === 'plan_failed' ||
          data.type === 'plan_cancelled'
        ) {
          refresh();
          setIsActing(false);
        } else if (
          data.type === 'plan_paused' ||
          data.type === 'plan_resumed' ||
          data.type === 'plan_started'
        ) {
          refresh();
        }
      } catch (err) {
        console.warn('PlanExecutorPanel: parse plan event failed', err);
      }
    };

    es.addEventListener('step_status_changed', handleStepEvent as EventListener);
    es.addEventListener('step_progress', handleStepEvent as EventListener);
    es.addEventListener('step_retry', handleStepEvent as EventListener);
    es.addEventListener('plan_started', handlePlanEvent as EventListener);
    es.addEventListener('plan_paused', handlePlanEvent as EventListener);
    es.addEventListener('plan_resumed', handlePlanEvent as EventListener);
    es.addEventListener('plan_completed', handlePlanEvent as EventListener);
    es.addEventListener('plan_failed', handlePlanEvent as EventListener);
    es.addEventListener('plan_cancelled', handlePlanEvent as EventListener);

    es.onerror = () => {
      // EventSource 自动重连
    };

    return () => es.close();
  }, [planId]);

  const handleStart = async () => {
    if (!planId) return;
    setIsActing(true);
    setError(null);
    try {
      const res = await fetch(`${DEFAULT_BASE_URL}/${planId}/start`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsActing(false);
    }
  };

  const handlePause = async () => {
    if (!planId) return;
    try {
      const res = await fetch(`${DEFAULT_BASE_URL}/${planId}/pause`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResume = async () => {
    if (!planId) return;
    try {
      const res = await fetch(`${DEFAULT_BASE_URL}/${planId}/resume`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancel = async () => {
    if (!planId) return;
    try {
      const res = await fetch(`${DEFAULT_BASE_URL}/${planId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      setIsActing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetryStep = async (stepId: string) => {
    if (!planId) return;
    try {
      const res = await fetch(
        `${DEFAULT_BASE_URL}/${planId}/step/${stepId}/retry`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSkipStep = async (stepId: string) => {
    if (!planId) return;
    try {
      const res = await fetch(
        `${DEFAULT_BASE_URL}/${planId}/step/${stepId}/skip`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="bg-white rounded-2xl border border-surface-200 p-4 shadow-sm"
      data-testid="plan-executor-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
          <span>📋</span> Plan Executor
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-surface-400 hover:text-surface-700"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 text-xs bg-red-50 text-red-700 rounded" data-testid="plan-error">
          {error}
        </div>
      )}

      {!plan ? (
        <div className="text-xs text-surface-500" data-testid="plan-empty">
          {planId ? '加载中...' : '当前没有 Plan'}
        </div>
      ) : (
        <>
          <div className="mb-3">
            <div className="text-sm font-medium text-surface-800" data-testid="plan-title">
              {plan.title}
            </div>
            <div className="text-xs text-surface-500 mt-1">{plan.description}</div>
            <div className="text-xs text-surface-400 mt-1 flex items-center gap-2 flex-wrap">
              <span>
                状态:{' '}
                <span className="font-medium" data-testid="plan-status">
                  {PLAN_STATUS_LABELS[plan.status]}
                </span>
              </span>
              <span>·</span>
              <span>
                进度:{' '}
                <span data-testid="plan-progress">
                  {Math.round((plan.progress ?? 0) * 100)}%
                </span>
              </span>
              <span>·</span>
              <span>step 数: {plan.steps.length}</span>
            </div>
            {plan.summary && (
              <div className="text-xs text-surface-400 mt-1" data-testid="plan-summary">
                {Object.entries(plan.summary)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${k}=${n}`)
                  .join(' / ')}
              </div>
            )}
          </div>

          {/* 控制按钮 */}
          <div className="flex gap-2 mb-3 flex-wrap" data-testid="plan-controls">
            {plan.status === 'draft' && !isActing && (
              <button
                onClick={handleStart}
                className="flex-1 min-w-[80px] px-3 py-1.5 text-xs font-medium text-white
                           bg-gradient-to-r from-fuchsia-500 to-cyan-500 rounded-lg
                           hover:opacity-90"
                data-testid="plan-start-btn"
              >
                ▶ 启动
              </button>
            )}
            {plan.status === 'running' && (
              <>
                <button
                  onClick={handlePause}
                  className="flex-1 min-w-[80px] px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg
                             hover:bg-amber-200"
                  data-testid="plan-pause-btn"
                >
                  ⏸ 暂停
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 min-w-[80px] px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg
                             hover:bg-red-200"
                  data-testid="plan-cancel-btn"
                >
                  ⏹ 取消
                </button>
              </>
            )}
            {plan.status === 'paused' && (
              <>
                <button
                  onClick={handleResume}
                  className="flex-1 min-w-[80px] px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 rounded-lg
                             hover:bg-emerald-200"
                  data-testid="plan-resume-btn"
                >
                  ▶ 恢复
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 min-w-[80px] px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg
                             hover:bg-red-200"
                >
                  ⏹ 取消
                </button>
              </>
            )}
          </div>

          {/* Step 列表 */}
          <div className="space-y-1.5 max-h-96 overflow-y-auto" data-testid="plan-steps-list">
            {plan.steps.map((step) => (
              <div
                key={step.step_id}
                className="p-2 bg-surface-50 rounded-lg text-xs space-y-1"
                data-testid={`plan-step-${step.step_id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="font-mono text-surface-400 flex-shrink-0">
                      {step.action}
                    </span>
                    <span className="font-medium text-surface-800 truncate">
                      {step.title}
                    </span>
                  </div>
                  <div
                    className={`px-1.5 py-0.5 rounded-full flex-shrink-0 ${STEP_STATUS_COLORS[step.status]}`}
                  >
                    {STEP_STATUS_LABELS[step.status]}
                  </div>
                </div>
                {step.description && (
                  <div className="text-surface-500 line-clamp-2">{step.description}</div>
                )}
                {step.status === 'running' && (
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.round((step.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                )}
                {step.depends_on && step.depends_on.length > 0 && (
                  <div className="text-surface-400 text-[10px]">
                    依赖: {step.depends_on.join(', ')}
                  </div>
                )}
                {step.error && (
                  <div className="text-red-600 text-[10px]" data-testid={`step-error-${step.step_id}`}>
                    ❌ {step.error}
                  </div>
                )}
                {(step.status === 'failed' || step.status === 'cancelled') && (
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => handleRetryStep(step.step_id)}
                      className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      data-testid={`step-retry-${step.step_id}`}
                    >
                      🔄 重试
                    </button>
                    <button
                      onClick={() => handleSkipStep(step.step_id)}
                      className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      data-testid={`step-skip-${step.step_id}`}
                    >
                      ⏭ 跳过
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PlanExecutorPanel;
