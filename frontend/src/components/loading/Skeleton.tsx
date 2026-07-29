/**
 * # ============================================================
 * # Skeleton 骨架屏组件（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：提供统一的骨架屏加载占位，避免布局抖动
 * # 运行流程：
 * #   1. 接收 variant 决定形状（text/circle/rect/rounded）
 * #   2. 接收 width/height 控制尺寸（支持 px/%/Tailwind class）
 * #   3. 渲染 .skeleton class（CSS 渐变 + shimmer 动画）
 * #   4. 支持 count 渲染多条骨架
 * # 输入参数：
 * #   - variant: 'text' | 'circle' | 'rect' | 'rounded'
 * #   - width: 宽度（默认 100%）
 * #   - height: 高度（默认根据 variant 自动）
 * #   - count: 渲染条数（默认 1）
 * #   - gap: 条与条之间间距
 * # 输出结果：骨架屏 JSX
 * # 复用说明：
 * #   - 替换 PanelSkeleton 等散落的骨架屏实现
 * #   - 被 Loading variant="skeleton" 调用
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建：统一 Skeleton 组件
 * # ============================================================
 */

import { memo } from 'react';

export type SkeletonVariant = 'text' | 'circle' | 'rect' | 'rounded';
export type SkeletonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface SkeletonProps {
  /** 形状 */
  variant?: SkeletonVariant;
  /** 宽度（支持 CSS 值，如 "100%"、"120px"、"w-32"） */
  width?: string;
  /** 高度（支持 CSS 值） */
  height?: string;
  /** 预设尺寸（仅在未传 width/height 时生效） */
  size?: SkeletonSize;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
  /** 动画开关（默认 true） */
  animated?: boolean;
}

/** 预设尺寸映射 */
const SIZE_MAP: Record<SkeletonSize, { width: string; height: string }> = {
  xs: { width: '60px', height: '12px' },
  sm: { width: '120px', height: '16px' },
  md: { width: '200px', height: '24px' },
  lg: { width: '300px', height: '32px' },
  xl: { width: '100%', height: '48px' },
};

/** variant 默认形状样式 */
const VARIANT_DEFAULT: Record<SkeletonVariant, { width: string; height: string; radius: string }> = {
  text: { width: '100%', height: '14px', radius: '4px' },
  circle: { width: '40px', height: '40px', radius: '9999px' },
  rect: { width: '100%', height: '100px', radius: '8px' },
  rounded: { width: '100%', height: '60px', radius: '12px' },
};

/**
 * Skeleton 单条骨架屏
 * 参数：
 *   - variant: 形状
 *   - width/height: 自定义尺寸
 *   - size: 预设尺寸
 * 返回值：单条骨架 JSX
 */
export const Skeleton = memo(function Skeleton({
  variant = 'text',
  width,
  height,
  size,
  className = '',
  animated = true,
  'data-testid': dataTestId = 'skeleton',
}: SkeletonProps) {
  // 合并尺寸：props > size 预设 > variant 默认
  const preset = size ? SIZE_MAP[size] : null;
  const variantDefault = VARIANT_DEFAULT[variant];

  const finalWidth = width ?? preset?.width ?? variantDefault.width;
  const finalHeight = height ?? preset?.height ?? variantDefault.height;

  return (
    <span
      data-testid={dataTestId}
      data-component="skeleton"
      data-variant={variant}
      data-animated={animated}
      className={[
        animated ? 'skeleton' : 'bg-surface-200/60',
        'inline-block',
        variant === 'circle' ? '' : 'rounded-md',
        className,
      ].filter(Boolean).join(' ')}
      style={{
        width: finalWidth,
        height: finalHeight,
        borderRadius: variant === 'circle' ? '9999px' : undefined,
      }}
      aria-hidden="true"
    />
  );
});

export interface SkeletonGroupProps {
  /** 渲染条数 */
  count?: number;
  /** 每条形状（默认 text） */
  variant?: SkeletonVariant;
  /** 间距（Tailwind class） */
  gap?: string;
  /** 自定义每条参数 */
  items?: SkeletonProps[];
  /** 测试 ID 前缀 */
  testIdPrefix?: string;
  /** 容器类名 */
  className?: string;
}

/**
 * SkeletonGroup 多条骨架屏
 * 参数：
 *   - count: 渲染条数
 *   - items: 自定义每条参数
 * 返回值：多条骨架 JSX
 */
export const SkeletonGroup = memo(function SkeletonGroup({
  count = 3,
  variant = 'text',
  gap = 'space-y-2',
  items,
  testIdPrefix = 'skeleton-group',
  className = '',
}: SkeletonGroupProps) {
  if (items && items.length > 0) {
    return (
      <div
        data-testid={testIdPrefix}
        data-component="skeleton-group"
        className={['flex flex-col', gap, className].filter(Boolean).join(' ')}
      >
        {items.map((item, idx) => (
          <Skeleton
            key={idx}
            {...item}
            data-testid={`${testIdPrefix}-item-${idx}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid={testIdPrefix}
      data-component="skeleton-group"
      className={['flex flex-col', gap, className].filter(Boolean).join(' ')}
    >
      {Array.from({ length: count }, (_, idx) => (
        <Skeleton
          key={idx}
          variant={variant}
          data-testid={`${testIdPrefix}-item-${idx}`}
        />
      ))}
    </div>
  );
});

export default Skeleton;
