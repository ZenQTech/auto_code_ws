/**
 * # ============================================================
 * IconButton - 统一图标按钮 (v1.0.0)
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：替换 47 个 panel 中散落的图标按钮，提供一致 hover/active 反馈
 * 设计要点：
 *   - 圆形 + p-2 + 背景色（hover 时变化）
 *   - active=true 时高亮（金橙背景）
 *   - 3 个 size: sm / md / lg
 * 输入参数：{ icon, onClick, active?, size?, variant?, disabled? }
 * 输出结果：圆形 icon-only 按钮
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import React, { forwardRef } from 'react';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ReactNode;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'danger' | 'primary';
  tooltip?: string;
  'data-testid'?: string;
}

const SIZE_CLASSES: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'w-7 h-7 text-sm',
  md: 'w-9 h-9 text-base',
  lg: 'w-11 h-11 text-lg',
};

const VARIANT_CLASSES: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default:
    'bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] border border-[var(--border-color)]',
  danger:
    'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200',
  primary:
    'bg-hermes-500 text-white hover:bg-hermes-600 border border-hermes-500',
};

const ACTIVE_CLASSES = {
  default: 'bg-hermes-500 text-white border-hermes-500 hover:bg-hermes-600',
  danger: 'bg-red-500 text-white border-red-500',
  primary: 'bg-hermes-600 text-white border-hermes-600',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    active = false,
    size = 'md',
    variant = 'default',
    tooltip,
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      data-testid={rest['data-testid']}
      className={[
        'inline-flex items-center justify-center rounded-full',
        'transition-all duration-150 ease-material',
        'focus:outline-none focus:ring-2 focus:ring-hermes-500 focus:ring-offset-2 focus:ring-offset-[var(--bg-app)]',
        'active:scale-[0.94]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        active ? ACTIVE_CLASSES[variant] : VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <span className="inline-flex shrink-0">{icon}</span>
    </button>
  );
});

export default IconButton;
