/**
 * # ============================================================
 * # EmptyState 通用空状态组件 (v1.0.0 Cycle 23 UI/UX 优化)
 * # ============================================================
 * # 核心作用：提供统一的空状态视觉，减少重复实现
 * # 主要功能：
 * #   1. 图标 + 标题 + 描述 + 操作按钮的标准空状态结构
 * #   2. 支持自定义图标、标题、描述、操作按钮
 * #   3. 支持多种情绪色（neutral/info/success/warning/danger）
 * #   4. 内置渐入动画
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 初次创建
 * # ============================================================
 */

import type { ReactNode } from 'react';

export type EmptyStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface EmptyStateProps {
  /** 图标（emoji 或文本） */
  icon?: string | ReactNode;
  /** 主标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 主操作按钮 */
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    testId?: string;
  };
  /** 次操作按钮 */
  secondaryAction?: {
    label: string;
    onClick: () => void;
    testId?: string;
  };
  /** 情绪色 */
  tone?: EmptyStateTone;
  /** 紧凑模式 */
  compact?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  testId?: string;
}

const TONE_STYLES: Record<EmptyStateTone, { ring: string; iconBg: string; iconText: string }> = {
  neutral: {
    ring: 'ring-surface-700/50',
    iconBg: 'bg-surface-800',
    iconText: 'text-slate-400',
  },
  info: {
    ring: 'ring-blue-500/30',
    iconBg: 'bg-blue-500/15',
    iconText: 'text-blue-300',
  },
  success: {
    ring: 'ring-emerald-500/30',
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-300',
  },
  warning: {
    ring: 'ring-amber-500/30',
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-300',
  },
  danger: {
    ring: 'ring-rose-500/30',
    iconBg: 'bg-rose-500/15',
    iconText: 'text-rose-300',
  },
};

const ACTION_VARIANTS: Record<NonNullable<NonNullable<EmptyStateProps['action']>['variant']>, string> = {
  primary: 'bg-primary-500 hover:bg-primary-600 text-white',
  secondary: 'bg-surface-700 hover:bg-surface-600 text-slate-200',
  danger: 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300',
};

/**
 * 通用空状态组件
 * 参数：
 *   - icon: 顶部图标（emoji 或 React 节点）
 *   - title: 主标题
 *   - description: 描述文字
 *   - action: 主操作按钮
 *   - secondaryAction: 次操作按钮
 *   - tone: 情绪色
 *   - compact: 紧凑模式（更小内边距）
 * 返回值：空状态 JSX
 */
export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
  secondaryAction,
  tone = 'neutral',
  compact = false,
  className = '',
  testId = 'empty-state',
}: EmptyStateProps) {
  const toneStyle = TONE_STYLES[tone];
  const padding = compact ? 'py-6 px-4' : 'py-12 px-6';
  const iconSize = compact ? 'text-2xl' : 'text-4xl';
  const iconBoxSize = compact ? 'w-12 h-12' : 'w-16 h-16';

  return (
    <div
      data-testid={testId}
      data-component="empty-state"
      data-tone={tone}
      className={[
        'flex flex-col items-center justify-center text-center',
        padding,
        'rounded-xl ring-1',
        toneStyle.ring,
        'bg-gradient-to-b from-surface-900/50 to-surface-950/30',
        'animate-in fade-in duration-300',
        className,
      ].filter(Boolean).join(' ')}
    >
      {icon && (
        <div
          className={[
            iconBoxSize,
            'rounded-full flex items-center justify-center mb-3',
            toneStyle.iconBg,
            'ring-1',
            toneStyle.ring,
          ].join(' ')}
        >
          {typeof icon === 'string' ? (
            <span className={[iconSize, toneStyle.iconText].join(' ')} aria-hidden="true">
              {icon}
            </span>
          ) : (
            icon
          )}
        </div>
      )}
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-slate-400 max-w-md">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <button
              onClick={action.onClick}
              data-testid={action.testId ?? `${testId}-primary`}
              className={[
                'px-4 py-1.5 text-sm font-medium rounded-md transition',
                ACTION_VARIANTS[action.variant ?? 'primary'],
              ].join(' ')}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              data-testid={secondaryAction.testId ?? `${testId}-secondary`}
              className="px-4 py-1.5 text-sm font-medium rounded-md transition bg-surface-800 hover:bg-surface-700 text-slate-300"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
