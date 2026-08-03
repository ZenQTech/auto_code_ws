/**
 * # ============================================================
 * Button - 统一按钮组件 (v1.0.0)
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：替换 47 个 panel 中散落的按钮样式，提供 5 种 variant
 * 运行流程：
 *   1. 接收 variant + size + isLoading + icon + ripple + children
 *   2. 根据 variant 应用 Tailwind 类
 *   3. loading 时显示 Spinner
 *   4. ripple=true 时启用点击波纹
 * 设计要点：
 *   - 5 个 variant: primary / ghost / icon / danger / gradient
 *   - 3 个 size: sm / md / lg
 *   - 前向 ref 透传
 *   - disabled 时禁用 hover 抬升
 * 输入参数：标准 ButtonHTMLAttributes + variant/size/isLoading/icon/ripple
 * 输出结果：标准 <button> 元素
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import React, { forwardRef } from 'react';
import { Spinner } from './Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'gradient' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
  ripple?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-hermes-500 text-white border border-hermes-500 hover:bg-hermes-600 hover:border-hermes-600 focus:ring-hermes-500',
  ghost:
    'bg-transparent text-surface-700 dark:text-surface-200 border border-transparent hover:bg-surface-100 dark:hover:bg-surface-200 focus:ring-surface-300',
  danger:
    'bg-red-500 text-white border border-red-500 hover:bg-red-600 focus:ring-red-500',
  gradient:
    'bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500 text-white border border-transparent hover:opacity-90 focus:ring-purple-500',
  outline:
    'bg-transparent text-hermes-600 dark:text-hermes-400 border border-hermes-500 hover:bg-hermes-500/10 focus:ring-hermes-500',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-2.5 py-1 text-xs rounded',
  md: 'px-3.5 py-1.5 text-sm rounded-md',
  lg: 'px-5 py-2.5 text-base rounded-lg',
};

const SIZE_SPINNER: Record<NonNullable<ButtonProps['size']>, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    icon,
    ripple = false,
    fullWidth = false,
    className = '',
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = isLoading || disabled;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      data-testid={rest['data-testid']}
      className={[
        'inline-flex items-center justify-center gap-1.5 font-medium',
        'transition-all duration-150 ease-material',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg-app)]',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
        'active:scale-[0.97]',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
        ripple ? 'ripple' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {isLoading ? (
        <Spinner size={SIZE_SPINNER[size]} color="currentColor" />
      ) : icon ? (
        <span className="inline-flex shrink-0">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  );
});

export default Button;
