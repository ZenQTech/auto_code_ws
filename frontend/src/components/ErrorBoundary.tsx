/**
 * # ============================================================
 * ErrorBoundary 错误边界组件（v6.39.0 P2-4 升级）
 * # ============================================================
 * 核心作用：捕获子组件树中抛出的未处理错误，防止整个应用白屏崩溃
 * 升级点（v1.1.0）：
 *   - 支持自定义 fallback（render prop 或 ReactNode）
 *   - 支持错误重试（不刷新整个页面）
 *   - 支持 onError 回调（错误上报）
 *   - 支持 level（top / panel / component）多粒度嵌套
 *   - 保留完整错误堆栈（开发模式显示）
 *   - isDev 模式下显示详细错误信息
 * 设计决策：
 *   - 仍用 class 组件（React 要求）
 *   - level 字段仅用于控制 UI 展示粒度（不影响错误捕获行为）
 *   - 自定义 fallback 通过 props 传入，灵活但保留默认
 * ============================================================
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 初始创建，React ErrorBoundary 模式
 * #   - 2026-07-29 | v1.1.0 | P2-4 升级：自定义 fallback / 重试 / onError / level
 * # ============================================================
 */

import React from 'react';

/** 错误边界粒度 */
export type ErrorLevel = 'top' | 'panel' | 'component';

/** ErrorBoundary Props */
export interface ErrorBoundaryProps {
  /** 需要被错误边界包裹的子组件 */
  children: React.ReactNode;
  /** 自定义 fallback UI（render prop 或 ReactNode） */
  fallback?: ((error: Error, reset: () => void) => React.ReactNode) | React.ReactNode;
  /** 错误粒度（影响默认 fallback 样式） */
  level?: ErrorLevel;
  /** 错误回调（用于错误上报） */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** 边界标识（用于日志） */
  name?: string;
}

/** ErrorBoundary State */
export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  /** 错误次数（用于去重） */
  count: number;
}

/**
 * ErrorBoundary 错误边界组件
 * 调用方：包裹任意子组件树
 * 行为：
 *   - 子组件抛错时显示 fallback UI
 *   - 用户点击"重试"可清除错误状态并重新渲染
 *   - 默认 UI 根据 level 字段显示不同样式
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      count: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState((prev) => ({
      errorInfo,
      count: prev.count + 1,
    }));
    // 输出到控制台（生产环境可由 onError 接管）
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.name ? ` ${this.props.name}` : ''}] 捕获到未处理错误：`,
      error
    );
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 组件调用栈：', errorInfo.componentStack);
    // 触发外部错误回调（错误上报）
    this.props.onError?.(error, errorInfo);
  }

  /** 重置错误状态（重新渲染子组件） */
  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /** 刷新整个页面 */
  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, level = 'top' } = this.props;

    if (hasError && error) {
      // 自定义 fallback（render prop 形式）
      if (typeof fallback === 'function') {
        return fallback(error, this.handleReset);
      }
      // 自定义 fallback（ReactNode 形式）
      if (fallback !== undefined) {
        return fallback;
      }
      // 默认 fallback（按 level 区分）
      return <DefaultErrorFallback level={level} error={error} onReset={this.handleReset} onReload={this.handleReload} />;
    }

    return children;
  }
}

/** 默认错误回退 UI */
function DefaultErrorFallback({
  level,
  error,
  onReset,
  onReload,
}: {
  level: ErrorLevel;
  error: Error;
  onReset: () => void;
  onReload: () => void;
}) {
  const isDev = import.meta.env?.DEV ?? false;
  const isTop = level === 'top';
  const isComponent = level === 'component';

  return (
    <div
      data-component="error-boundary-fallback"
      data-level={level}
      className={[
        isTop ? 'min-h-screen' : isComponent ? 'min-h-[200px]' : 'min-h-[300px]',
        'bg-surface-50 flex items-center justify-center p-4',
      ].join(' ')}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={[
          isTop ? 'max-w-md' : 'max-w-sm',
          'w-full text-center',
          isComponent ? 'p-4 rounded border border-red-500/30 bg-red-500/5' : 'glass-strong rounded-2xl px-6 py-8 border border-red-500/20 animate-scale-in',
        ].join(' ')}
      >
        {/* 错误图标 */}
        <div
          className={[
            isComponent ? 'w-8 h-8 mb-2' : 'w-14 h-14 mb-4',
            'mx-auto rounded-full bg-red-500/15 flex items-center justify-center',
          ].join(' ')}
        >
          <svg
            className={isComponent ? 'w-4 h-4 text-red-400' : 'w-7 h-7 text-red-400'}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        {/* 标题 */}
        <h2 className={isComponent ? 'text-sm font-semibold text-surface-900 mb-1' : 'text-h2 text-surface-900 mb-2'}>
          {isComponent ? '组件渲染错误' : isTop ? '页面出现错误' : '面板加载失败'}
        </h2>

        {/* 描述 */}
        {!isComponent && (
          <p className="text-body text-surface-700 mb-2">
            {isTop ? '应用运行过程中发生了意外错误' : '此面板发生错误，不影响其他功能'}
          </p>
        )}

        {/* 错误消息 */}
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          <p className="text-xs text-red-400 font-mono break-all leading-relaxed">
            {error.message || '未知错误'}
          </p>
        </div>

        {/* 详细错误信息（仅 dev 模式） */}
        {isDev && error.stack && (
          <details className="mb-4 text-left">
            <summary className="text-xs text-surface-500 cursor-pointer mb-1">错误堆栈</summary>
            <pre className="text-[10px] text-surface-600 font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-surface-100/50 rounded p-2 border border-surface-200/40">
              {error.stack}
            </pre>
          </details>
        )}

        {/* 操作按钮 */}
        <div className={isComponent ? 'flex gap-2' : 'flex flex-col sm:flex-row gap-2'}>
          <button
            onClick={onReset}
            className="btn-primary flex-1 text-sm"
            data-testid="error-boundary-reset"
          >
            重试
          </button>
          {isTop && (
            <button
              onClick={onReload}
              className="btn-secondary flex-1 text-sm"
              data-testid="error-boundary-reload"
            >
              刷新页面
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 函数式包装：方便 React Hooks 上下文使用 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps: Omit<ErrorBoundaryProps, 'children'> = {}
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `withErrorBoundary(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Wrapped;
}

export default ErrorBoundary;
