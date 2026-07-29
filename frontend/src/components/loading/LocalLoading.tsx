/**
 * # ============================================================
 * # LocalLoading 局部加载容器（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：在指定容器内显示局部 loading 状态，保留容器布局
 * #           支持 inline 嵌入与 overlay 覆盖两种模式
 * # 运行流程：
 * #   1. 接收 children 与 loading 状态
 * #   2. 当 loading=true 时：
 * #      - inline: 替换 children 为 loading UI
 * #      - overlay: 在 children 之上覆盖一层 loading
 * # 输入参数：
 * #   - loading: 是否显示 loading
 * #   - mode: 'inline' | 'overlay'
 * #   - text: 加载文字
 * #   - variant: 加载形态
 * #   - skeleton: skeleton 模式参数
 * # 输出结果：JSX
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建
 * # ============================================================
 */

import { useRef, useEffect, useState } from 'react';
import { Loading, type LoadingVariant, type LoadingSize } from './Loading';
import { Skeleton, type SkeletonProps } from './Skeleton';

export type LocalLoadingMode = 'inline' | 'overlay' | 'skeleton';

export interface LocalLoadingProps {
  /** 是否加载中 */
  loading: boolean;
  /** 加载模式 */
  mode?: LocalLoadingMode;
  /** 加载文字 */
  text?: string;
  /** 加载形态 */
  variant?: LoadingVariant;
  /** 尺寸 */
  size?: LoadingSize;
  /** 骨架屏参数（仅 skeleton 模式） */
  skeleton?: SkeletonProps & { count?: number; height?: string };
  /** 内容 */
  children: React.ReactNode;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
  /** 内容容器类名 */
  contentClassName?: string;
  /** 最小高度（避免布局抖动） */
  minHeight?: string;
}

/**
 * LocalLoading 局部加载容器
 */
export function LocalLoading({
  loading,
  mode = 'inline',
  text,
  variant = 'spinner',
  size = 'md',
  skeleton,
  children,
  className = '',
  contentClassName = '',
  'data-testid': dataTestId = 'local-loading',
  minHeight = '120px',
}: LocalLoadingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // 防止 SSR 期间渲染
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted && mode === 'overlay') {
    return (
      <div
        ref={containerRef}
        data-testid={dataTestId}
        data-component="local-loading"
        data-mode={mode}
        data-loading={loading}
        className={['relative', className].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    );
  }

  // 加载中
  if (loading) {
    if (mode === 'skeleton') {
      // 骨架屏模式：渲染多条 skeleton
      const { count = 5, height = '20px', ...skeletonItem } = skeleton || {};
      return (
        <div
          ref={containerRef}
          data-testid={dataTestId}
          data-component="local-loading"
          data-mode={mode}
          data-loading={loading}
          className={['space-y-2', className].filter(Boolean).join(' ')}
          aria-busy="true"
        >
          {Array.from({ length: count }, (_, idx) => (
            <Skeleton
              key={idx}
              {...skeletonItem}
              height={height}
              data-testid={`${dataTestId}-skeleton-${idx}`}
            />
          ))}
        </div>
      );
    }

    if (mode === 'inline') {
      // inline 模式：替换 children
      return (
        <div
          ref={containerRef}
          data-testid={dataTestId}
          data-component="local-loading"
          data-mode={mode}
          data-loading={loading}
          className={[
            'flex items-center justify-center',
            className,
          ].filter(Boolean).join(' ')}
          style={{ minHeight }}
          aria-busy="true"
        >
          <Loading
            variant={variant}
            size={size}
            text={text}
            layout="center"
            data-testid={`${dataTestId}-content`}
          />
        </div>
      );
    }

    // overlay 模式：在 children 之上覆盖一层
    return (
      <div
        ref={containerRef}
        data-testid={dataTestId}
        data-component="local-loading"
        data-mode={mode}
        data-loading={loading}
        className={['relative', className].filter(Boolean).join(' ')}
        style={{ minHeight }}
      >
        <div
          className={['opacity-50 pointer-events-none', contentClassName].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          {children}
        </div>
        <div
          data-testid={`${dataTestId}-overlay`}
          className="absolute inset-0 flex items-center justify-center bg-surface-50/70 backdrop-blur-sm z-10 rounded-lg"
        >
          <Loading
            variant={variant}
            size={size}
            text={text}
            layout="center"
            data-testid={`${dataTestId}-content`}
          />
        </div>
      </div>
    );
  }

  // 加载完成：渲染 children
  return (
    <div
      ref={containerRef}
      data-testid={dataTestId}
      data-component="local-loading"
      data-mode={mode}
      data-loading={false}
      className={className}
    >
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

export default LocalLoading;
