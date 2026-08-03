/**
 * # ============================================================
 * Card - 统一卡片组件 (v1.0.0)
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：替换 47 个 panel 中散落的卡片容器样式
 * 运行流程：
 *   1. 接收 variant + onClick + children
 *   2. 根据 variant 应用背景/边框/阴影
 *   3. hoverable=true 时启用 hover 抬升效果
 * 设计要点：
 *   - 3 个 variant: default / bordered / elevated
 *   - hoverable=true 添加 transition + hover:translate-y
 *   - onClick 时显示 cursor-pointer
 * 输入参数：{ variant?, hoverable?, onClick?, children, className? }
 * 输出结果：div 卡片容器
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'bordered' | 'elevated' | 'ghost';
  hoverable?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const VARIANT_CLASSES: Record<NonNullable<CardProps['variant']>, string> = {
  default:
    'bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl',
  bordered:
    'bg-[var(--bg-elevated)] border-2 border-[var(--border-color)] rounded-xl',
  elevated:
    'bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-md)]',
  ghost:
    'bg-transparent border border-transparent rounded-xl',
};

const PADDING_CLASSES: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card: React.FC<CardProps> = ({
  variant = 'default',
  hoverable = false,
  padding = 'md',
  className = '',
  children,
  onClick,
  ...rest
}) => {
  return (
    <div
      data-testid={rest['data-testid']}
      onClick={onClick}
      className={[
        VARIANT_CLASSES[variant],
        PADDING_CLASSES[padding],
        hoverable ? 'transition-all duration-150 ease-material hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] cursor-pointer' : '',
        onClick ? 'cursor-pointer' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
};

export default Card;
