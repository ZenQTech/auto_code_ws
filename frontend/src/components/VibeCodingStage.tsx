/**
 * # ============================================================
 * VibeCodingStage - Vibe Coding 主舞台 (v1.0.1)
 * Cycle 58 G58-01
 * # ============================================================
 * 核心作用：Vibe Coding 的核心输入与进度展示舞台
 * 运行流程：
 *   1. 显示大型输入框（prompt + model 选择）
 *   2. 「开始」按钮触发 startSession
 *   3. session 创建后显示进度（步骤列表 + 状态）
 *   4. 显示当前 stage + 状态徽章
 * 设计要点：
 *   - 大型可视化输入区
 *   - session 状态实时显示
 *   - 步骤列表可滚动
 * 输入参数：{ prompt, setPrompt, model, setModel, vibeCoding, onStart }
 * 输出结果：完整 Vibe Coding 输入与进度
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-01 初次创建
 * #   - 2026-08-03 | v1.0.1 | G60-FIX 修复 metrics 字段未定义崩溃（防御性 fallback）
 * ====================================
 */

import React from 'react';

import { useVibeCoding, type VibeStep, type VibeState } from '../hooks/useVibeCoding';

// ============================================================
// 类型
// ====================================

export interface VibeCodingStageProps {
  prompt: string;
  setPrompt: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  vibeCoding: ReturnType<typeof useVibeCoding>;
  onStart: () => Promise<void>;
}

const VIBE_STATE_BADGES: Record<VibeState, { label: string; color: string; emoji: string }> = {
  idle: { label: '空闲', color: 'bg-slate-100 text-slate-700', emoji: '⚪' },
  clarifying: { label: '澄清中', color: 'bg-amber-100 text-amber-700', emoji: '🤔' },
  planning: { label: '生成 Plan', color: 'bg-purple-100 text-purple-700', emoji: '📋' },
  executing: { label: '执行中', color: 'bg-emerald-100 text-emerald-700', emoji: '⚡' },
  reviewing: { label: '审核中', color: 'bg-cyan-100 text-cyan-700', emoji: '🔍' },
  done: { label: '已完成', color: 'bg-green-100 text-green-700', emoji: '✅' },
  paused: { label: '已暂停', color: 'bg-gray-100 text-gray-700', emoji: '⏸️' },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-700', emoji: '🚫' },
  error: { label: '错误', color: 'bg-red-100 text-red-700', emoji: '❌' },
};

/** v1.0.1 G60-FIX 新增：fallback badge（防御性） */
const DEFAULT_BADGE = { label: '未知', color: 'bg-slate-100 text-slate-700', emoji: '❓' };

const STEP_STATUS_LABELS: Record<VibeStep['status'], string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const STEP_STATUS_COLORS: Record<VibeStep['status'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

// ============================================================
// 组件
// ============================================================

const VibeCodingStage: React.FC<VibeCodingStageProps> = ({
  prompt,
  setPrompt,
  model,
  setModel,
  vibeCoding,
  onStart,
}) => {
  const { session, state, isLoading, pause, resume, cancel, retryStep } = vibeCoding;
  // v1.0.1 G60-FIX 修复：防御性 fallback，避免 undefined.color 崩溃
  const badge = VIBE_STATE_BADGES[state] ?? DEFAULT_BADGE;
  const isActive = state === 'clarifying' || state === 'planning' || state === 'executing' || state === 'reviewing';

  return (
    <div className="space-y-4" data-testid="vibe-coding-stage">
      {/* Session 状态卡片 */}
      <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-surface-800">Vibe Session</h2>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}
               data-testid="vibe-stage-badge">
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
          </div>
        </div>

        {session ? (
          <div className="text-sm text-surface-600 space-y-1">
            <div>Session ID: <span className="font-mono text-xs">{session.id}</span></div>
            <div>Model: {session.model || 'claude-sonnet-4-20250514'}</div>
            <div>Created: {session.createdAt ? new Date(session.createdAt).toLocaleString() : '刚刚'}</div>
            <div>Metrics: tokens={session.metrics?.tokens ?? 0}, files={session.metrics?.filesChanged ?? 0}</div>
          </div>
        ) : (
          <div className="text-sm text-surface-500">未启动 session</div>
        )}

        {/* 控制按钮 */}
        {session && (
          <div className="mt-3 flex gap-2">
            {isActive && (
              <button
                onClick={pause}
                className="px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg
                           hover:bg-amber-200 transition-colors"
                data-testid="pause-btn"
              >
                ⏸ Pause
              </button>
            )}
            {state === 'paused' && (
              <button
                onClick={resume}
                className="px-3 py-1.5 text-sm bg-emerald-100 text-emerald-700 rounded-lg
                           hover:bg-emerald-200 transition-colors"
                data-testid="resume-btn"
              >
                ▶ Resume
              </button>
            )}
            {(isActive || state === 'paused') && (
              <button
                onClick={cancel}
                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg
                           hover:bg-red-200 transition-colors"
                data-testid="cancel-btn"
              >
                ⏹ Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {/* 输入区（无 session 时显示） */}
      {!session && (
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-surface-800 mb-3">描述你的需求</h2>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：创建一个 React TODO 应用，支持添加、删除、标记完成，使用 TypeScript + TailwindCSS..."
            className="w-full h-40 px-4 py-3 text-sm border border-surface-200 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-hermes-400 resize-none"
            disabled={isLoading}
            data-testid="prompt-textarea"
          />
          <div className="mt-3 flex items-center gap-3">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="px-3 py-2 text-sm border border-surface-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-hermes-400"
              data-testid="model-select"
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
              <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
            </select>
            <button
              onClick={onStart}
              disabled={!prompt.trim() || isLoading}
              className="flex-1 px-4 py-2 text-sm font-medium text-white
                         bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500
                         rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              data-testid="start-session-btn"
            >
              {isLoading ? '启动中...' : '🌊 启动 Vibe Coding'}
            </button>
          </div>
        </div>
      )}

      {/* Steps 列表 */}
      {session && session.steps && session.steps.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-surface-800 mb-3">执行步骤</h2>
          <div className="space-y-2" data-testid="steps-list">
            {session.steps.map((step) => (
              <div
                key={step.id}
                className="flex items-center justify-between p-3 bg-surface-50 rounded-lg"
                data-testid={`step-${step.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`px-2 py-0.5 text-xs rounded-full ${STEP_STATUS_COLORS[step.status]}`}>
                    {STEP_STATUS_LABELS[step.status]}
                  </div>
                  <div className="text-sm text-surface-700">{step.name}</div>
                </div>
                <div className="flex items-center gap-2">
                  {step.retryCount && step.retryCount > 0 ? (
                    <span className="text-xs text-amber-600">retry: {step.retryCount}</span>
                  ) : null}
                  {step.status === 'failed' && (
                    <button
                      onClick={() => retryStep(step.id)}
                      className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded
                                 hover:bg-amber-200"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VibeCodingStage;
