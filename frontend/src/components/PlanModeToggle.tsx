/**
 * # ============================================================
 * PlanModeToggle - Plan 模式开关组件 (v1.1.0)
 * Cycle 60+ Solo 重构 - 对标 Codex/Trae Plan Mode
 * # ============================================================
 * 核心作用：提供"先出计划再执行"的 Plan 模式开关
 * 设计要点（v1.1.0 视觉强化）：
 *   - 三态切换：off / plan-only / plan-then-execute
 *   - 持久化到 localStorage
 *   - 状态广播（zustand-like 事件）
 *   - 视觉化展示当前 plan 阶段（澄清/规划/执行/审阅）
 *   - 与 useVibeCoding 协同
 *   - v1.1.0 强化视觉差异：
 *     - off 状态：边框虚线 + 灰色 + 透明度（更明显的"未启用"感）
 *     - plan-only 状态：实色背景 + 状态点
 *     - plan-then-execute 状态：实色背景 + 渐变 + 状态点
 *     - 状态点 + 边框 + 阴影组合，三态一眼可辨
 * 输入参数：
 *   - onChange?: (mode: PlanMode) => void
 *   - compact?: boolean 紧凑模式（仅图标）
 *   - showLabel?: boolean 显示文字标签
 * 输出结果：UI 组件
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Solo 重构 - 初次创建
 *   - 2026-08-04 | v1.1.0 | G60-FIX-17 强化三态视觉差异：
 *                                - off 状态：虚线边框 + 灰度配色 + 弱化对比
 *                                - plan-only 状态：amber 色实心 + 状态点
 *                                - plan-then-execute 状态：hermes 渐变 + 状态点 + 阴影
 *                                - 三态配色 + 边框 + 状态点三重区分，避免单看颜色混淆
 *                                - 文字尺寸 11px，紧凑化
 *                                - 圆角 6px，更接近 Codex 风格
 * ============================================================
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================
// 类型
// ====================================

export type PlanMode = 'off' | 'plan-only' | 'plan-then-execute';

export interface PlanModeState {
  mode: PlanMode;
  enabled: boolean;
}

export interface PlanModeToggleProps {
  onChange?: (mode: PlanMode) => void;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
  'data-testid'?: string;
}

// ============================================================
// 配置
// ====================================

const STORAGE_KEY = 'hermes.solo.planMode';

/**
 * v1.1.0 三态视觉配置
 * 每种状态有独立的：
 *   - bg/activeBg: 背景（inactive 浅色 / active 实色或渐变）
 *   - activeText: 激活时文字色
 *   - text: 非激活时文字色
 *   - border: 边框（off 虚线，其它实线）
 *   - dotColor: 状态点颜色
 *   - 阴影（active 状态提升对比度）
 */
const PLAN_MODE_META: Record<
  PlanMode,
  {
    label: string;
    emoji: string;
    shortLabel: string;
    activeBg: string; // 激活时背景类
    activeText: string; // 激活时文字色
    text: string; // 非激活文字色
    border: string; // 边框类
    dotColor: string; // 状态点颜色
    description: string;
  }
> = {
  'off': {
    label: '直接执行',
    shortLabel: 'OFF',
    emoji: '⚡',
    activeBg: 'bg-[var(--bg-elevated)]',
    activeText: 'text-[var(--text-secondary)]',
    text: 'text-[var(--text-tertiary)]',
    border: 'border-dashed border-[var(--border-color)]',
    dotColor: 'bg-[var(--text-tertiary)]',
    description: '提交后直接执行，无须确认计划（最快速）',
  },
  'plan-only': {
    label: '仅规划',
    shortLabel: 'PLAN',
    emoji: '📋',
    activeBg: 'bg-amber-500/15 dark:bg-amber-500/20',
    activeText: 'text-amber-700 dark:text-amber-300',
    text: 'text-[var(--text-secondary)]',
    border: 'border-solid border-amber-500/50',
    dotColor: 'bg-amber-500',
    description: 'AI 仅生成计划，等待你确认后再决定是否执行（推荐）',
  },
  'plan-then-execute': {
    label: '规划后执行',
    shortLabel: 'AUTO',
    emoji: '🎯',
    activeBg: 'bg-gradient-to-r from-hermes-500/20 to-hermes-400/20 dark:from-hermes-500/30 dark:to-hermes-400/30',
    activeText: 'text-hermes-700 dark:text-hermes-300',
    text: 'text-[var(--text-secondary)]',
    border: 'border-solid border-hermes-500/50',
    dotColor: 'bg-hermes-500',
    description: '先生成计划，确认后自动进入执行阶段（全自动）',
  },
};

// ============================================================
// 全局状态（localStorage 持久化）
// ====================================

function readPlanMode(): PlanMode {
  if (typeof window === 'undefined') return 'plan-only';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'off' || raw === 'plan-only' || raw === 'plan-then-execute') {
      return raw;
    }
  } catch {
    // 忽略
  }
  return 'plan-only';
}

function writePlanMode(mode: PlanMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 忽略
  }
}

const _listeners = new Set<(mode: PlanMode) => void>();

export function getPlanMode(): PlanMode {
  return readPlanMode();
}

export function setPlanModeGlobal(mode: PlanMode): void {
  writePlanMode(mode);
  _listeners.forEach((fn) => fn(mode));
}

export function subscribePlanMode(fn: (mode: PlanMode) => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

// ============================================================
// 组件
// ====================================

export const PlanModeToggle: React.FC<PlanModeToggleProps> = ({
  onChange,
  compact = false,
  showLabel = true,
  className = '',
  'data-testid': testId = 'plan-mode-toggle',
}) => {
  const [mode, setMode] = useState<PlanMode>(() => readPlanMode());

  // 订阅全局变化
  useEffect(() => {
    const unsub = subscribePlanMode((m) => setMode(m));
    return unsub;
  }, []);

  // 持久化 + 通知
  const update = useCallback(
    (next: PlanMode) => {
      setMode(next);
      writePlanMode(next);
      _listeners.forEach((fn) => fn(next));
      onChange?.(next);
    },
    [onChange]
  );

  // 循环切换三种模式
  const cycle = useCallback(() => {
    const order: PlanMode[] = ['plan-only', 'plan-then-execute', 'off'];
    const idx = order.indexOf(mode);
    const next = order[(idx + 1) % order.length];
    update(next);
  }, [mode, update]);

  const meta = PLAN_MODE_META[mode];

  // v1.1.0 紧凑模式：显示当前状态 + 状态点，点击循环
  if (compact) {
    return (
      <button
        onClick={cycle}
        className={`px-2 py-1 rounded-md text-[11px] font-medium
                    border transition-all flex items-center gap-1
                    ${meta.border} ${meta.activeBg} ${className}`}
        title={`${meta.label} - ${meta.description}（点击切换）`}
        data-testid={testId}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dotColor}`} />
        <span className="text-sm leading-none">{meta.emoji}</span>
        {showLabel && (
          <span className={`font-semibold ${meta.activeText}`}>{meta.shortLabel}</span>
        )}
      </button>
    );
  }

  // v1.1.0 完整模式：三态 segmented control，强化视觉差异
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-md
                  bg-[var(--bg-app)] border border-[var(--border-color)]
                  ${className}`}
      data-testid={testId}
      role="radiogroup"
      aria-label="Plan 模式"
    >
      {(Object.keys(PLAN_MODE_META) as PlanMode[]).map((m) => {
        const mm = PLAN_MODE_META[m];
        const active = m === mode;
        return (
          <button
            key={m}
            onClick={() => update(m)}
            className={[
              'px-2 py-1 rounded text-[11px] font-medium transition-all',
              'flex items-center gap-1',
              'border',
              active
                ? `${mm.activeBg} ${mm.activeText} ${mm.border} shadow-sm`
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)]',
            ].join(' ')}
            title={mm.description}
            role="radio"
            aria-checked={active}
            data-testid={`${testId}-${m}`}
          >
            {/* 状态点 - 激活时更显眼 */}
            <span
              className={[
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                active ? mm.dotColor : 'bg-[var(--text-tertiary)]/40',
                active && m === 'plan-then-execute' ? 'animate-pulse' : '',
              ].join(' ')}
            />
            {/* emoji */}
            <span className="text-sm leading-none">{mm.emoji}</span>
            {/* 标签 */}
            <span className={active ? 'font-semibold' : ''}>{mm.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default PlanModeToggle;
