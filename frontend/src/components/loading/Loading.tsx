/**
 * # ============================================================
 * # Loading 统一加载组件（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：统一的 Loading 入口组件，根据 variant 切换展示
 * #           Spinner / Skeleton / ProgressBar / Streaming 四种形态
 * # 运行流程：
 * #   1. 接收 variant 决定展示形态
 * #   2. 根据 variant 渲染对应子组件
 * #   3. 提供 size / color / text 等公共属性
 * # 输入参数：
 * #   - variant: 'spinner' | 'skeleton' | 'progress' | 'streaming' | 'dots'
 * #   - size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 * #   - color: 'hermes' | 'blue' | 'gray' | 'white' | 'current'
 * #   - text: 文字描述
 * #   - layout: 'inline' | 'block' | 'center' | 'overlay'
 * # 输出结果：Loading JSX
 * # 复用说明：
 * #   - 替代 LoadingFallback、PanelSkeleton 的内联实现
 * #   - 替代 MessageRow / ToastContainer 中散落的 animate-spin
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建：统一 Loading 入口
 * # ============================================================
 */

import { memo } from 'react';
import { Spinner, type SpinnerProps } from './Spinner';
import { Skeleton, SkeletonGroup, type SkeletonProps } from './Skeleton';
import { ProgressBar } from './ProgressBar';

export type LoadingVariant = 'spinner' | 'skeleton' | 'progress' | 'streaming' | 'dots';
export type LoadingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type LoadingLayout = 'inline' | 'block' | 'center' | 'overlay';

export interface LoadingProps {
  /** 加载形态 */
  variant?: LoadingVariant;
  /** 尺寸 */
  size?: LoadingSize;
  /** 颜色（仅 spinner / dots 生效） */
  color?: SpinnerProps['color'];
  /** 文字描述 */
  text?: string;
  /** 布局方式 */
  layout?: LoadingLayout;
  /** 进度值（仅 progress 生效） */
  value?: number;
  /** 是否不确定进度（仅 progress 生效） */
  indeterminate?: boolean;
  /** 骨架屏参数（仅 skeleton 生效） */
  skeleton?: SkeletonProps & { count?: number };
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
}

/** 尺寸 → Spinner size 映射 */
const SPINNER_SIZE_MAP: Record<LoadingSize, SpinnerProps['size']> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
};

/** 布局样式映射 */
const LAYOUT_CLASS: Record<LoadingLayout, string> = {
  inline: 'inline-flex items-center gap-2',
  block: 'flex items-center gap-2',
  center: 'flex flex-col items-center justify-center gap-3',
  overlay: 'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-50/70 backdrop-blur-sm z-10',
};

/**
 * StreamingDots 跳动点加载（v6.40.0 P2-5）
 * 三个点的顺序跳动的动画
 */
function StreamingDots({
  size = 'md',
  color = 'hermes',
  text,
  layout = 'inline',
  className = '',
  testId,
}: {
  size?: LoadingSize;
  color?: SpinnerProps['color'];
  text?: string;
  layout?: LoadingLayout;
  className?: string;
  testId?: string;
}) {
  // 点尺寸映射
  const dotSize = { xs: 4, sm: 6, md: 8, lg: 10, xl: 12 }[size];
  // 颜色 class
  const colorClass = {
    hermes: 'bg-hermes-500',
    blue: 'bg-blue-500',
    gray: 'bg-surface-500',
    white: 'bg-white',
    current: 'bg-current',
  }[color || 'hermes'];

  return (
    <div
      data-testid={testId}
      data-component="loading-dots"
      data-size={size}
      className={[LAYOUT_CLASS[layout], className].filter(Boolean).join(' ')}
      role="status"
      aria-label={text || '加载中'}
    >
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={['inline-block rounded-full', colorClass, 'animate-bounce'].join(' ')}
            style={{
              width: `${dotSize}px`,
              height: `${dotSize}px`,
              animationDelay: `${i * 0.15}s`,
              animationDuration: '0.9s',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
      {text && <span className="text-sm text-surface-700">{text}</span>}
    </div>
  );
}

/**
 * Loading 统一加载组件
 * 根据 variant 切换展示形态
 */
export const Loading = memo(function Loading({
  variant = 'spinner',
  size = 'md',
  color = 'hermes',
  text,
  layout = 'inline',
  value = 0,
  indeterminate = false,
  skeleton,
  className = '',
  'data-testid': dataTestId = 'loading',
}: LoadingProps) {
  const layoutClass = LAYOUT_CLASS[layout];

  if (variant === 'skeleton') {
    // 骨架屏：layout 默认 block
    if (skeleton?.count || (skeleton && Object.keys(skeleton).length > 1)) {
      const { count = 3, ...skeletonItemProps } = skeleton || {};
      return (
        <SkeletonGroup
          count={count}
          testIdPrefix={dataTestId}
          className={[layoutClass, className].filter(Boolean).join(' ')}
          items={Array.from({ length: count }, () => skeletonItemProps)}
        />
      );
    }
    return (
      <div
        data-testid={dataTestId}
        data-component="loading"
        data-variant="skeleton"
        className={[layoutClass, className].filter(Boolean).join(' ')}
      >
        <Skeleton
          {...(skeleton || {})}
          data-testid={`${dataTestId}-item`}
        />
      </div>
    );
  }

  if (variant === 'progress') {
    return (
      <div
        data-testid={dataTestId}
        data-component="loading"
        data-variant="progress"
        className={[layoutClass, className].filter(Boolean).join(' ')}
      >
        <ProgressBar
          value={value}
          indeterminate={indeterminate}
          size={size === 'xs' ? 'xs' : size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : 'md'}
          color={color === 'hermes' || color === 'blue' ? color : 'hermes'}
          label={text}
          showValue
          data-testid={`${dataTestId}-bar`}
        />
      </div>
    );
  }

  if (variant === 'streaming' || variant === 'dots') {
    return (
      <StreamingDots
        size={size}
        color={color}
        text={text}
        layout={layout}
        className={className}
        testId={dataTestId}
      />
    );
  }

  // 默认 spinner
  return (
    <div
      data-testid={dataTestId}
      data-component="loading"
      data-variant="spinner"
      data-size={size}
      data-layout={layout}
      className={[layoutClass, className].filter(Boolean).join(' ')}
      role="status"
      aria-label={text || '加载中'}
    >
      <Spinner
        size={SPINNER_SIZE_MAP[size]}
        color={color}
        data-testid={`${dataTestId}-spinner`}
      />
      {text && <span className="text-sm text-surface-700">{text}</span>}
    </div>
  );
});

export default Loading;
