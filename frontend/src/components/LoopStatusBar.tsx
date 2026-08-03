/**
 * # ============================================================
 * LoopStatusBar - Loop 状态条 (v1.0.0)
 * Cycle 58 G58-03
 * # ============================================================
 * 核心作用：顶部持续可见的 Loop 状态条
 * 运行流程：
 *   1. 接收 loopState + vibeState
 *   2. 显示当前阶段 + 进度条 + ETA
 *   3. 当 Vibe Session 激活时高亮
 * 设计要点：
 *   - 轻量级渲染（不重渲染整个页面）
 *   - 阶段徽章 + 颜色编码
 *   - 进度条 + 百分比
 * 输入参数：{ loopState, progress, eta, history, vibeState, sessionActive }
 * 输出结果：状态条 UI
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 * ============================================================
 */

import React from 'react';

import type { LoopState, LoopTransition } from '../hooks/useLoopState';
import type { VibeState } from '../hooks/useVibeCoding';

// ============================================================
// 类型
// ====================================

export interface LoopStatusBarProps {
  loopState: LoopState | null;
  progress: number;
  eta: number;
  history: LoopTransition[];
  vibeState: VibeState;
  sessionActive: boolean;
}

// ============================================================
// 阶段样式
// ====================================

const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  idle: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  clarifying: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-400' },
  designing: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-400' },
  prompting: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-400' },
  executing: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  reviewing: { bg: 'bg-cyan-100', text: 'text-cyan-700', dot: 'bg-cyan-400' },
  done: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  paused: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' },
  error: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' },
};

const VIBE_STAGE_LABELS: Record<VibeState, string> = {
  idle: '空闲',
  clarifying: '澄清中',
  planning: '生成 Plan',
  executing: '执行中',
  reviewing: '审核中',
  done: '已完成',
  paused: '已暂停',
  cancelled: '已取消',
  error: '错误',
};

// ============================================================
// 组件
// ============================================================

const LoopStatusBar: React.FC<LoopStatusBarProps> = ({
  loopState,
  progress,
  eta,
  history,
  vibeState,
  sessionActive,
}) => {
  const stage = loopState?.stage ?? 'idle';
  const colors = STAGE_COLORS[stage] ?? STAGE_COLORS.idle;
  const lastTransition = history.length > 0 ? history[history.length - 1] : null;

  return (
    <header
      className={`sticky top-0 z-30 border-b border-surface-200 backdrop-blur
                  ${sessionActive ? 'bg-white/95 shadow-sm' : 'bg-white/60'}`}
      data-testid="loop-status-bar"
    >
      <div className="container mx-auto px-4 py-2 flex items-center gap-3">
        {/* Logo + Title */}
        <div className="flex items-center gap-2 min-w-[180px]">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 via-purple-500
                          to-cyan-500 flex items-center justify-center text-white text-sm font-bold">
            🌊
          </div>
          <div>
            <div className="text-sm font-semibold text-surface-800">Vibe Coding</div>
            <div className="text-xs text-surface-500">Loop Engineering v7</div>
          </div>
        </div>

        {/* Loop 阶段徽章 */}
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-full ${colors.bg}`}
          data-testid="loop-stage-badge"
        >
          <div className={`w-2 h-2 rounded-full ${colors.dot} animate-pulse`} />
          <span className={`text-xs font-medium ${colors.text}`}>
            Loop: {stage}
          </span>
        </div>

        {/* Vibe 状态徽章 */}
        {sessionActive && (
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-hermes-100"
            data-testid="vibe-state-badge"
          >
            <div className="w-2 h-2 rounded-full bg-hermes-500 animate-pulse" />
            <span className="text-xs font-medium text-hermes-700">
              Vibe: {VIBE_STAGE_LABELS[vibeState]}
            </span>
          </div>
        )}

        {/* 进度条 */}
        <div className="flex-1 min-w-[200px] flex items-center gap-2">
          <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-500
                         transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              data-testid="loop-progress-bar"
            />
          </div>
          <span className="text-xs text-surface-600 font-mono w-12 text-right">
            {Math.round(progress * 100)}%
          </span>
          {eta > 0 && (
            <span className="text-xs text-surface-500 font-mono w-16">
              ETA: {eta}s
            </span>
          )}
        </div>

        {/* 最近一次迁移 */}
        {lastTransition && (
          <div
            className="hidden md:flex items-center gap-1 text-xs text-surface-500"
            data-testid="loop-last-transition"
          >
            <span>{lastTransition.from_state}</span>
            <span>→</span>
            <span className="font-medium text-surface-700">{lastTransition.to_state}</span>
          </div>
        )}

        {/* Step 计数 */}
        {sessionActive && history.length > 0 && (
          <div className="text-xs text-surface-500 font-mono">
            steps: {history.length}
          </div>
        )}
      </div>
    </header>
  );
};

export default LoopStatusBar;
