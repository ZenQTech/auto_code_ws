/**
 * # ============================================================
 * PlanExecutorPanel - Plan 执行面板 (v1.0.0)
 * Cycle 58 G58-05
 * # ============================================================
 * 核心作用：ComposerPlan 真正可执行的 UI 面板
 * 运行流程：
 *   1. 接收 planId + sessionId
 *   2. 通过 SSE 订阅 plan/step 事件
 *   3. 实时显示每 step 的状态
 *   4. 提供 pause/resume/cancel 控制
 *   5. 显示 step 输出预览
 * 设计要点：
 *   - 独立 panel（不依赖 Vibe Coding 主舞台）
 *   - 可关闭
 *   - 支持嵌入式 step 重试
 * 输入参数：{ planId, sessionId, onClose }
 * 输出结果：Plan 执行进度 UI
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-05 初次创建
 * ============================================================
 */

import React, { useEffect, useState } from 'react';

// ============================================================
// 类型
// ====================================

export interface PlanStep {
  id: string;
  order: number;
  name: string;
  description: string;
  estimatedDuration: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: {
    filesChanged: string[];
    tokensUsed: number;
  };
  error?: string;
  retryCount?: number;
}

export interface Plan {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
}

export interface PlanExecutorPanelProps {
  planId?: string;
  sessionId?: string;
  onClose: () => void;
}

// ============================================================
// 常量
// ====================================

const DEFAULT_BASE_URL = '/api/vibe-coding';
const isBrowser = typeof window !== 'undefined';

const STEP_STATUS_COLORS: Record<PlanStep['status'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

const STEP_STATUS_LABELS: Record<PlanStep['status'], string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

// ============================================================
// 组件
// ====================================

const PlanExecutorPanel: React.FC<PlanExecutorPanelProps> = ({
  planId,
  sessionId,
  onClose,
}) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // 拉取 Plan 详情
  useEffect(() => {
    if (!isBrowser || !planId) return;
    const controller = new AbortController();
    fetch(`${DEFAULT_BASE_URL}/plan/${planId}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: Plan) => setPlan(data))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(`Plan 拉取失败: ${err}`);
        }
      });
    return () => controller.abort();
  }, [planId]);

  // 订阅 SSE step 事件
  useEffect(() => {
    if (!isBrowser || !sessionId) return;
    const es = new EventSource(`${DEFAULT_BASE_URL}/session/${sessionId}/events`);

    const handleStep = (e: MessageEvent) => {
      try {
        const step = JSON.parse(e.data) as PlanStep;
        setPlan((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            steps: prev.steps.map((s) => (s.id === step.id ? step : s)),
          };
        });
      } catch (err) {
        console.warn('PlanExecutorPanel: parse step failed', err);
      }
    };

    es.addEventListener('vibe_step_started', handleStep);
    es.addEventListener('vibe_step_completed', handleStep);
    es.addEventListener('vibe_step_failed', handleStep);
    es.addEventListener('vibe_plan_completed', () => {
      setIsExecuting(false);
    });
    es.onerror = () => {
      // 自动重连
    };

    return () => es.close();
  }, [sessionId]);

  const handleStart = async () => {
    if (!planId) return;
    setIsExecuting(true);
    setError(null);
    try {
      const res = await fetch(`${DEFAULT_BASE_URL}/plan/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        throw new Error(`Plan 执行失败: ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsExecuting(false);
    }
  };

  const handlePause = async () => {
    if (!planId) return;
    try {
      await fetch(`${DEFAULT_BASE_URL}/plan/${planId}/pause`, { method: 'POST' });
    } catch (err) {
      console.warn('Plan pause failed', err);
    }
  };

  const handleCancel = async () => {
    if (!planId) return;
    try {
      await fetch(`${DEFAULT_BASE_URL}/plan/${planId}/cancel`, { method: 'POST' });
      setIsExecuting(false);
    } catch (err) {
      console.warn('Plan cancel failed', err);
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
        <div className="mb-3 p-2 text-xs bg-red-50 text-red-700 rounded">{error}</div>
      )}

      {!plan ? (
        <div className="text-xs text-surface-500">
          {planId ? '加载中...' : '当前没有 Plan'}
        </div>
      ) : (
        <>
          <div className="mb-3">
            <div className="text-sm font-medium text-surface-800">{plan.title}</div>
            <div className="text-xs text-surface-500 mt-1">{plan.description}</div>
            <div className="text-xs text-surface-400 mt-1">
              状态: <span className="font-medium">{plan.status}</span>
              {' · '}
              step 数: {plan.steps.length}
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="flex gap-2 mb-3">
            {plan.status === 'confirmed' && !isExecuting && (
              <button
                onClick={handleStart}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white
                           bg-gradient-to-r from-fuchsia-500 to-cyan-500 rounded-lg
                           hover:opacity-90"
                data-testid="plan-start-btn"
              >
                ▶ 启动
              </button>
            )}
            {isExecuting && (
              <>
                <button
                  onClick={handlePause}
                  className="flex-1 px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg
                             hover:bg-amber-200"
                >
                  ⏸ Pause
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg
                             hover:bg-red-200"
                >
                  ⏹ Cancel
                </button>
              </>
            )}
          </div>

          {/* Step 列表 */}
          <div className="space-y-1.5 max-h-96 overflow-y-auto" data-testid="plan-steps-list">
            {plan.steps.map((step) => (
              <div
                key={step.id}
                className="p-2 bg-surface-50 rounded-lg text-xs space-y-1"
                data-testid={`plan-step-${step.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-surface-400">#{step.order}</span>
                    <span className="font-medium text-surface-800">{step.name}</span>
                  </div>
                  <div className={`px-1.5 py-0.5 rounded-full ${STEP_STATUS_COLORS[step.status]}`}>
                    {STEP_STATUS_LABELS[step.status]}
                  </div>
                </div>
                <div className="text-surface-500">{step.description}</div>
                {step.result && step.result.filesChanged.length > 0 && (
                  <div className="text-surface-600">
                    📝 {step.result.filesChanged.length} files · {step.result.tokensUsed} tokens
                  </div>
                )}
                {step.error && (
                  <div className="text-red-600">❌ {step.error}</div>
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
