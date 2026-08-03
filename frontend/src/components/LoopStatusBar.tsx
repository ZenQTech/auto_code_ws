/**
 * # ============================================================
 * LoopStatusBar - Loop 状态条 + Goal mode 岛台 (v1.1.0)
 * Cycle 58 G58-03 → Cycle 60 G60-2.1 升级
 * # ============================================================
 * 核心作用：顶部持续可见的 Loop 状态条 + Goal mode 操作岛台
 * 运行流程：
 *   1. 接收 loopState + vibeState + sessionActive
 *   2. 显示当前阶段 + 进度条 + ETA
 *   3. Goal mode 操作岛台：⏸▶️✖️🗑️ + Auto-Follow 开关 + ThemeSwitcher
 *   4. 当 Vibe Session 激活时高亮
 * 设计要点：
 *   - 轻量级渲染（不重渲染整个页面）
 *   - 阶段徽章 + 颜色编码
 *   - 进度条 + 百分比
 *   - 所有新 Props 可选（向后兼容）
 *   - 移动端自动收起 stage 文字
 * 输入参数：{ loopState, progress, eta, history, vibeState, sessionActive,
 *           onPause?, onResume?, onCancel?, onClear?,
 *           onToggleAutoFollow?, autoFollowEnabled?, onThemeClick? }
 * 输出结果：状态条 + 操作岛台 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 *   - 2026-08-03 | v1.1.0 | Cycle 60 G60-2.1 升级为 Goal mode 岛台
 * ============================================================
 */

import React from 'react';

import { ThemeSwitcher } from './ThemeSwitcher';
import { IconButton } from './ui/IconButton';
import type { LoopState, LoopTransition } from '../hooks/useLoopState';
import type { VibeState } from '../hooks/useVibeCoding';

// ============================================================
// 类型
// ============================================================

export interface LoopStatusBarProps {
  loopState: LoopState | null;
  progress: number;
  eta: number;
  history: LoopTransition[];
  vibeState: VibeState;
  sessionActive: boolean;

  // v1.1.0 新增：Goal mode 操作岛台回调（全部可选）
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onClear?: () => void;
  onToggleAutoFollow?: () => void;
  autoFollowEnabled?: boolean;
  /** 是否显示主题切换器（默认 true） */
  showThemeSwitcher?: boolean;
}

// ============================================================
// 阶段样式
// ============================================================

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
  onPause,
  onResume,
  onCancel,
  onClear,
  onToggleAutoFollow,
  autoFollowEnabled = true,
  showThemeSwitcher = true,
}) => {
  const stage = loopState?.stage ?? 'idle';
  const colors = STAGE_COLORS[stage] ?? STAGE_COLORS.idle;
  const lastTransition = history.length > 0 ? history[history.length - 1] : null;

  // Goal mode 操作按钮启用逻辑
  const canPause = !!onPause && stage === 'executing';
  const canResume = !!onResume && stage === 'paused';
  const canCancel = !!onCancel && (stage === 'executing' || stage === 'paused');
  const hasGoalControls = onPause || onResume || onCancel || onClear || onToggleAutoFollow;

  return (
    <header
      className={[
        'sticky top-0 z-30 border-b border-[var(--border-color)]',
        'backdrop-blur transition-colors duration-200',
        sessionActive
          ? 'bg-[var(--bg-elevated)]/95 shadow-sm'
          : 'bg-[var(--bg-elevated)]/70',
      ].join(' ')}
      data-testid="loop-status-bar"
    >
      <div className="container mx-auto px-4 py-2 flex items-center gap-3">
        {/* Logo + Title */}
        <div className="flex items-center gap-2 min-w-[160px]">
          <div
            className="w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 via-purple-500
                          to-cyan-500 flex items-center justify-center text-white text-sm font-bold"
            data-testid="loop-status-logo"
          >
            🌊
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold text-[var(--text-primary)]">Vibe Coding</div>
            <div className="text-xs text-[var(--text-tertiary)]">Loop Engineering v7</div>
          </div>
        </div>

        {/* Loop 阶段徽章 */}
        <div
          className={['flex items-center gap-2 px-3 py-1 rounded-full', colors.bg].join(' ')}
          data-testid="loop-stage-badge"
        >
          <div className={['w-2 h-2 rounded-full', colors.dot, 'animate-pulse'].join(' ')} />
          <span className={['text-xs font-medium', colors.text].join(' ')}>
            <span className="hidden md:inline">Loop: </span>
            {stage}
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
        <div className="flex-1 min-w-[160px] hidden sm:flex items-center gap-2">
          <div className="flex-1 h-2 bg-[var(--bg-panel)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-500
                         transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              data-testid="loop-progress-bar"
            />
          </div>
          <span
            className="text-xs text-[var(--text-secondary)] font-mono w-12 text-right"
            data-testid="loop-progress-percent"
          >
            {Math.round(progress * 100)}%
          </span>
          {eta > 0 && (
            <span className="text-xs text-[var(--text-tertiary)] font-mono w-16 hidden md:inline">
              ETA: {eta}s
            </span>
          )}
        </div>

        {/* 最近一次迁移 */}
        {lastTransition && (
          <div
            className="hidden lg:flex items-center gap-1 text-xs text-[var(--text-tertiary)]"
            data-testid="loop-last-transition"
          >
            <span>{lastTransition.from_state}</span>
            <span>→</span>
            <span className="font-medium text-[var(--text-primary)]">{lastTransition.to_state}</span>
          </div>
        )}

        {/* Step 计数 */}
        {sessionActive && history.length > 0 && (
          <div className="hidden md:block text-xs text-[var(--text-tertiary)] font-mono">
            steps: {history.length}
          </div>
        )}

        {/* ============================================================
         * v1.1.0 G60-2.1: Goal mode 操作岛台
         * ============================================================ */}
        {hasGoalControls && (
          <div
            className="flex items-center gap-1 ml-auto pl-2 border-l border-[var(--border-color)]"
            data-testid="goal-island"
          >
            {onPause && (
              <IconButton
                icon={<span>⏸</span>}
                tooltip="暂停"
                size="sm"
                disabled={!canPause}
                onClick={onPause}
                data-testid="status-pause-btn"
              />
            )}
            {onResume && (
              <IconButton
                icon={<span>▶️</span>}
                tooltip="恢复"
                size="sm"
                disabled={!canResume}
                onClick={onResume}
                data-testid="status-resume-btn"
              />
            )}
            {onCancel && (
              <IconButton
                icon={<span>✖️</span>}
                tooltip="取消"
                size="sm"
                variant="danger"
                disabled={!canCancel}
                onClick={onCancel}
                data-testid="status-cancel-btn"
              />
            )}
            {onClear && (
              <IconButton
                icon={<span>🗑️</span>}
                tooltip="清空"
                size="sm"
                onClick={onClear}
                data-testid="status-clear-btn"
              />
            )}
            {onToggleAutoFollow && (
              <>
                <div className="h-5 w-px bg-[var(--border-color)] mx-1" />
                <IconButton
                  icon={<span>🎯</span>}
                  tooltip={`Auto-Follow: ${autoFollowEnabled ? 'ON' : 'OFF'}`}
                  size="sm"
                  active={autoFollowEnabled}
                  onClick={onToggleAutoFollow}
                  data-testid="status-auto-follow-btn"
                />
              </>
            )}
            {showThemeSwitcher && (
              <>
                <div className="h-5 w-px bg-[var(--border-color)] mx-1" />
                <ThemeSwitcher />
              </>
            )}
          </div>
        )}

        {/* 单独显示 ThemeSwitcher（无操作岛台时） */}
        {!hasGoalControls && showThemeSwitcher && (
          <div className="ml-auto">
            <ThemeSwitcher />
          </div>
        )}
      </div>
    </header>
  );
};

export default LoopStatusBar;
