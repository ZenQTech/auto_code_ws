/**
 * # ============================================================
 * LoopStatusBar - Loop 状态条 + Goal mode 岛台 (v1.2.0)
 * Cycle 58 G58-03 → Cycle 60 G60-2.1 升级 → G60-FIX-17 暗色适配
 * # ============================================================
 * 核心作用：顶部持续可见的 Loop 状态条 + Goal mode 操作岛台
 * 运行流程：
 *   1. 接收 loopState + vibeState + sessionActive
 *   2. 显示当前阶段 + 进度条 + ETA
 *   3. Goal mode 操作岛台：⏸▶️✖️🗑️ + Auto-Follow 开关 + ThemeSwitcher
 *   4. 当 Vibe Session 激活时高亮
 * 设计要点：
 *   - 轻量级渲染（不重渲染整个页面）
 *   - 阶段徽章 + 颜色编码（暗色/亮色主题通用）
 *   - 进度条 + 百分比（hermes 品牌色）
 *   - 所有新 Props 可选（向后兼容）
 *   - 移动端自动收起 stage 文字
 *   - v1.2.0: 对标 Codex/Trae Solo 风格，紧凑 36px 高，主题色半透明徽章
 * 输入参数：{ loopState, progress, eta, history, vibeState, sessionActive,
 *           onPause?, onResume?, onCancel?, onClear?,
 *           onToggleAutoFollow?, autoFollowEnabled?, onThemeClick? }
 * 输出结果：状态条 + 操作岛台 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 *   - 2026-08-03 | v1.1.0 | Cycle 60 G60-2.1 升级为 Goal mode 岛台
 *   - 2026-08-04 | v1.2.0 | G60-FIX-17 暗色主题适配与紧凑化：
 *                                - 移除硬编码浅色背景（bg-slate-100/amber-100 等），
 *                                  改为主题色半透明（bg-amber-500/10 等）
 *                                - 增加徽章边框（border-amber-500/30 等）以确保对比度
 *                                - 高度从 ~52px 减至 36px (h-9)，更接近 Codex/Trae Solo
 *                                - 移除 container mx-auto 容器，紧贴边缘
 *                                - 进度条渐变从 from-fuchsia-500 to-cyan-500 改为
 *                                  from-hermes-500 to-hermes-400，更柔和
 *                                - Logo 渐变从 fuchsia/via-purple/to-cyan 改为
 *                                  hermes 品牌色（from-hermes-500 to-hermes-700）
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
// 阶段样式（v1.2.0 暗色主题适配：使用主题色半透明 + 边框）
// ============================================================

/**
 * 阶段配色方案
 * 颜色策略：
 *   - bg: 主题色 /10（半透明，亮色/暗色都可见）
 *   - text: 主题色实色（亮色用 -700，暗色用 -300/400）
 *   - dot: 主题色实色
 *   - border: 主题色 /30（轻微边框）
 * 主题色采用 Tailwind 标准调色板，自动适配 dark mode
 */
const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  idle: {
    bg: 'bg-[var(--bg-elevated)]/60',
    text: 'text-[var(--text-secondary)]',
    dot: 'bg-[var(--text-tertiary)]',
    border: 'border-[var(--border-color)]',
  },
  clarifying: {
    bg: 'bg-amber-500/10 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
    border: 'border-amber-500/30',
  },
  designing: {
    bg: 'bg-purple-500/10 dark:bg-purple-500/15',
    text: 'text-purple-700 dark:text-purple-400',
    dot: 'bg-purple-500',
    border: 'border-purple-500/30',
  },
  prompting: {
    bg: 'bg-blue-500/10 dark:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
    border: 'border-blue-500/30',
  },
  executing: {
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    border: 'border-emerald-500/30',
  },
  reviewing: {
    bg: 'bg-cyan-500/10 dark:bg-cyan-500/15',
    text: 'text-cyan-700 dark:text-cyan-400',
    dot: 'bg-cyan-500',
    border: 'border-cyan-500/30',
  },
  done: {
    bg: 'bg-green-500/10 dark:bg-green-500/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
    border: 'border-green-500/30',
  },
  paused: {
    bg: 'bg-gray-500/10 dark:bg-gray-500/15',
    text: 'text-gray-700 dark:text-gray-400',
    dot: 'bg-gray-500',
    border: 'border-gray-500/30',
  },
  error: {
    bg: 'bg-red-500/10 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
    border: 'border-red-500/30',
  },
  cancelled: {
    bg: 'bg-gray-500/10 dark:bg-gray-500/15',
    text: 'text-gray-700 dark:text-gray-400',
    dot: 'bg-gray-500',
    border: 'border-gray-500/30',
  },
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
        'transition-colors duration-200',
        // v1.2.0 高度 36px (h-9)，对标 Codex/Trae Solo 紧凑风格
        'h-9',
        sessionActive
          ? 'bg-[var(--bg-elevated)]/95'
          : 'bg-[var(--bg-elevated)]/70',
      ].join(' ')}
      data-testid="loop-status-bar"
    >
      {/* v1.2.0: 移除 container mx-auto 容器，紧贴边缘对齐，整体间距更紧凑 */}
      <div className="h-full px-3 flex items-center gap-2.5">
        {/* Logo + Title */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <div
            className="w-6 h-6 rounded-md bg-gradient-to-br from-hermes-500 to-hermes-700
                          flex items-center justify-center text-white text-xs font-bold shadow-sm"
            data-testid="loop-status-logo"
            title="Hermes Loop Engineering"
          >
            🌊
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-semibold text-[var(--text-primary)] leading-tight">
              Vibe Coding
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">
              Loop v7
            </div>
          </div>
        </div>

        {/* Loop 阶段徽章 - v1.2.0 暗色适配 */}
        <div
          className={[
            'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border',
            colors.bg,
            colors.border,
          ].join(' ')}
          data-testid="loop-stage-badge"
        >
          <div className={['w-1.5 h-1.5 rounded-full', colors.dot, 'animate-pulse'].join(' ')} />
          <span className={['text-[11px] font-medium', colors.text].join(' ')}>
            <span className="hidden md:inline">Loop: </span>
            {stage}
          </span>
        </div>

        {/* Vibe 状态徽章 - v1.2.0 暗色适配 */}
        {sessionActive && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border
                       bg-hermes-500/10 border-hermes-500/30"
            data-testid="vibe-state-badge"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-hermes-500 animate-pulse" />
            <span className="text-[11px] font-medium text-hermes-700 dark:text-hermes-400">
              Vibe: {VIBE_STAGE_LABELS[vibeState]}
            </span>
          </div>
        )}

        {/* 进度条 - v1.2.0 颜色优化 */}
        <div className="flex-1 min-w-[140px] hidden sm:flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--bg-app)] rounded-full overflow-hidden border border-[var(--border-color)]/50">
            <div
              className="h-full bg-gradient-to-r from-hermes-500 to-hermes-400
                         transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              data-testid="loop-progress-bar"
            />
          </div>
          <span
            className="text-[11px] text-[var(--text-secondary)] font-mono w-10 text-right"
            data-testid="loop-progress-percent"
          >
            {Math.round(progress * 100)}%
          </span>
          {eta > 0 && (
            <span className="text-[11px] text-[var(--text-tertiary)] font-mono w-14 hidden md:inline">
              ETA: {eta}s
            </span>
          )}
        </div>

        {/* 最近一次迁移 */}
        {lastTransition && (
          <div
            className="hidden xl:flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]"
            data-testid="loop-last-transition"
          >
            <span>{lastTransition.from_state}</span>
            <span>→</span>
            <span className="font-medium text-[var(--text-primary)]">{lastTransition.to_state}</span>
          </div>
        )}

        {/* Step 计数 */}
        {sessionActive && history.length > 0 && (
          <div className="hidden lg:block text-[11px] text-[var(--text-tertiary)] font-mono">
            steps: {history.length}
          </div>
        )}

        {/* ============================================================
         * v1.1.0 G60-2.1: Goal mode 操作岛台
         * ============================================================ */}
        {hasGoalControls && (
          <div
            className="flex items-center gap-0.5 ml-auto pl-2 border-l border-[var(--border-color)]"
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
                <div className="h-4 w-px bg-[var(--border-color)] mx-0.5" />
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
                <div className="h-4 w-px bg-[var(--border-color)] mx-0.5" />
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
