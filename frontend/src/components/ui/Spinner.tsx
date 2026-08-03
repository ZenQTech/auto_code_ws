/**
 * # ============================================================
 * Spinner - 加载旋转器 (v1.0.0)
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：统一加载动画组件，支持 sm/md/lg 三档
 * 设计要点：纯 CSS 动画、GPU 合成、颜色可继承
 * 输入参数：{ size?: 'sm' | 'md' | 'lg', className?: string }
 * 输出结果：旋转动画元素
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** 自定义颜色（默认 inherit） */
  color?: string;
}

const SIZE_CLASSES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'w-3 h-3 border',
  md: 'w-4 h-4 border-2',
  lg: 'w-6 h-6 border-2',
};

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '', color }) => {
  const style: React.CSSProperties = color
    ? { borderTopColor: color, borderRightColor: color, borderBottomColor: 'transparent', borderLeftColor: 'transparent' }
    : {};
  return (
    <span
      role="status"
      aria-label="加载中"
      className={`inline-block rounded-full border-current border-t-transparent animate-spin ${SIZE_CLASSES[size]} ${className}`}
      style={style}
    />
  );
};

export default Spinner;
