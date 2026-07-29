/**
 * # ============================================================
 * # ProgressBar 进度条组件（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：提供统一的进度条组件，支持确定进度与不确定进度
 * # 运行流程：
 * #   1. 接收 value（0-100）或 indeterminate 模式
 * #   2. 渲染带渐变填充的进度条
 * #   3. 支持 label 显示与 value 标签
 * #   4. 支持 size 调整高度、color 调整配色
 * # 输入参数：
 * #   - value: 进度值 0-100
 * #   - indeterminate: 不确定进度模式
 * #   - size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 * #   - color: 'hermes' | 'blue' | 'green' | 'gradient'
 * #   - label: 进度描述
 * #   - showValue: 是否显示百分比
 * # 输出结果：进度条 JSX
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建：统一 ProgressBar 组件
 * # ============================================================
 */

import { useEffect, useRef, useState, memo } from 'react';

export type ProgressSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ProgressColor = 'hermes' | 'blue' | 'green' | 'red' | 'gradient';

export interface ProgressBarProps {
  /** 进度值 0-100（indeterminate 模式下忽略） */
  value?: number;
  /** 不确定进度（持续动画） */
  indeterminate?: boolean;
  /** 高度预设 */
  size?: ProgressSize;
  /** 颜色预设 */
  color?: ProgressColor;
  /** 进度描述 */
  label?: string;
  /** 是否显示百分比文本 */
  showValue?: boolean;
  /** 进度文本格式化函数 */
  formatValue?: (value: number) => string;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
}

/** 尺寸预设（高度） */
const SIZE_MAP: Record<ProgressSize, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
  xl: 'h-4',
};

/** 颜色预设（Tailwind class） */
const COLOR_MAP: Record<ProgressColor, string> = {
  hermes: 'bg-hermes-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  gradient: 'bg-gradient-to-r from-hermes-400 via-hermes-500 to-hermes-600',
};

/**
 * ProgressBar 进度条组件
 * 参数：
 *   - value: 0-100
 *   - indeterminate: 不确定模式
 *   - size/color/label/showValue: 见 props
 * 返回值：进度条 JSX
 */
export const ProgressBar = memo(function ProgressBar({
  value = 0,
  indeterminate = false,
  size = 'md',
  color = 'gradient',
  label,
  showValue = false,
  formatValue,
  className = '',
  'data-testid': dataTestId = 'progress-bar',
}: ProgressBarProps) {
  // 限制 value 在 0-100
  const safeValue = Math.max(0, Math.min(100, value));
  const displayText = formatValue ? formatValue(safeValue) : `${Math.round(safeValue)}%`;

  return (
    <div
      data-testid={dataTestId}
      data-component="progress-bar"
      data-indeterminate={indeterminate}
      data-value={safeValue}
      className={['w-full', className].filter(Boolean).join(' ')}
    >
      {/* 顶部标签 + 百分比 */}
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1.5 text-xs">
          {label && <span className="text-surface-700 font-medium">{label}</span>}
          {showValue && !indeterminate && (
            <span className="text-surface-500 tabular-nums">{displayText}</span>
          )}
          {showValue && indeterminate && (
            <span className="text-surface-500">处理中…</span>
          )}
        </div>
      )}

      {/* 进度条主体 */}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : safeValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={[
          'w-full',
          SIZE_MAP[size],
          'bg-surface-200/60',
          'rounded-full',
          'overflow-hidden',
        ].join(' ')}
      >
        {indeterminate ? (
          <div
            data-testid={`${dataTestId}-fill`}
            className={[
              'h-full w-1/3',
              COLOR_MAP[color],
              'rounded-full',
              'animate-progress-indeterminate',
            ].join(' ')}
          />
        ) : (
          <div
            data-testid={`${dataTestId}-fill`}
            className={[
              'h-full',
              COLOR_MAP[color],
              'rounded-full',
              'transition-all duration-300 ease-out',
            ].join(' ')}
            style={{ width: `${safeValue}%` }}
          />
        )}
      </div>
    </div>
  );
});

export interface AsyncProgressBarProps extends Omit<ProgressBarProps, 'value' | 'indeterminate'> {
  /** 异步任务 */
  task: (onProgress: (percent: number) => void) => Promise<unknown>;
  /** 完成后回调 */
  onComplete?: (result: unknown) => void;
  /** 失败回调 */
  onError?: (err: Error) => void;
  /** 失败重试次数 */
  maxRetries?: number;
}

/**
 * AsyncProgressBar 自动进度条
 * 自动根据 task 的 onProgress 回调更新进度
 */
export function AsyncProgressBar({
  task,
  onComplete,
  onError,
  maxRetries = 0,
  ...rest
}: AsyncProgressBarProps) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const retriesRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('running');
    setProgress(0);

    const run = async () => {
      try {
        const result = await task((p) => {
          if (!cancelled) setProgress(p);
        });
        if (!cancelled) {
          setProgress(100);
          setPhase('done');
          onComplete?.(result);
        }
      } catch (err) {
        if (cancelled) return;
        if (retriesRef.current < maxRetries) {
          retriesRef.current += 1;
          run();
          return;
        }
        setPhase('error');
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  return (
    <ProgressBar
      {...rest}
      value={progress}
      indeterminate={phase === 'running' && progress === 0}
    />
  );
}

export default ProgressBar;
