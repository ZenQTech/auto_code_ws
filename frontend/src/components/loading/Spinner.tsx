/**
 * # ============================================================
 * # Spinner 旋转加载图标（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：提供统一的旋转加载图标，作为最基础的 loading 原子组件
 * # 运行流程：
 * #   1. 接收 size/color/thickness 控制尺寸与配色
 * #   2. 渲染带 animate-spin 的圆形 border 元素
 * #   3. 暴露 ref 用于父组件的 transition / focus 管理
 * # 输入参数：
 * #   - size: 尺寸（sm/md/lg/xl 或 数字 px）
 * #   - color: 颜色预设（hermes/blue/gray/white/current）
 * #   - thickness: 边框厚度（thin/medium/thick 或 数字 px）
 * #   - label: 无障碍标签（屏幕阅读器）
 * # 输出结果：旋转加载图标 JSX
 * # 复用说明：被 Loading / GlobalLoading / StreamingLoading 等组件引用
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建：统一 Spinner 组件
 * # ============================================================
 */

import { forwardRef, type CSSProperties } from 'react';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerColor = 'hermes' | 'blue' | 'gray' | 'white' | 'current';
export type SpinnerThickness = 'thin' | 'medium' | 'thick';

export interface SpinnerProps {
  /** 尺寸预设或像素值 */
  size?: SpinnerSize | number;
  /** 颜色预设 */
  color?: SpinnerColor;
  /** 边框厚度预设或像素值 */
  thickness?: SpinnerThickness | number;
  /** 无障碍标签（屏幕阅读器） */
  label?: string;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 测试 ID */
  'data-testid'?: string;
}

/** 尺寸预设映射（像素） */
const SIZE_MAP: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

/** 厚度预设映射（像素） */
const THICKNESS_MAP: Record<SpinnerThickness, number> = {
  thin: 2,
  medium: 3,
  thick: 4,
};

/** 颜色预设映射（Tailwind class） */
const COLOR_MAP: Record<SpinnerColor, { track: string; head: string }> = {
  hermes: {
    track: 'border-hermes-200/40',
    head: 'border-t-hermes-500',
  },
  blue: {
    track: 'border-blue-200/40',
    head: 'border-t-blue-500',
  },
  gray: {
    track: 'border-surface-300/40',
    head: 'border-t-surface-600',
  },
  white: {
    track: 'border-white/30',
    head: 'border-t-white',
  },
  current: {
    track: 'border-current/30',
    head: 'border-t-current',
  },
};

/**
 * Spinner 旋转加载图标
 * 参数：
 *   - size: 尺寸（默认 md = 24px）
 *   - color: 颜色（默认 hermes）
 *   - thickness: 边框厚度（默认 medium = 3px）
 *   - label: 无障碍标签
 * 返回值：旋转加载图标 JSX
 */
export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(function Spinner(
  {
    size = 'md',
    color = 'hermes',
    thickness = 'medium',
    label = '加载中',
    className = '',
    style,
    'data-testid': dataTestId = 'spinner',
  },
  ref
) {
  const dimension = typeof size === 'number' ? size : SIZE_MAP[size];
  const borderWidth = typeof thickness === 'number' ? thickness : THICKNESS_MAP[thickness];
  const palette = COLOR_MAP[color];

  return (
    <div
      ref={ref}
      role="status"
      aria-label={label}
      data-testid={dataTestId}
      data-component="spinner"
      data-size={typeof size === 'number' ? `${size}px` : size}
      data-color={color}
      className={[
        'inline-block',
        'rounded-full',
        'animate-spin',
        palette.track,
        palette.head,
        className,
      ].filter(Boolean).join(' ')}
      style={{
        width: `${dimension}px`,
        height: `${dimension}px`,
        borderWidth: `${borderWidth}px`,
        borderStyle: 'solid',
        ...style,
      }}
    />
  );
});

export default Spinner;
