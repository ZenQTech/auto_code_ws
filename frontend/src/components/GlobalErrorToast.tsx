/**
 * # ============================================================
 * # GlobalErrorToast 组件 (v6.40.0 Cycle 18 P0-3)
 * # ============================================================
 * 核心作用：监听全局错误，弹出顶部 Toast 提示
 * 特性：
 *   - 仅显示当前未读错误
 *   - 提供"忽略"和"清空"操作
 *   - 自动 8s 后自动关闭
 *   - 不同错误类型显示不同图标
 *   - 错误详情可展开（开发模式显示堆栈）
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

import { useEffect, useState } from 'react';
import { useGlobalError } from '../hooks/useGlobalError';
import type { GlobalErrorType, GlobalErrorReport } from '../utils/globalErrorHandler';

export interface GlobalErrorToastProps {
  /** 自动消失时间（毫秒），0 表示不自动消失 */
  autoHideMs?: number;
  /** 自定义 className */
  className?: string;
}

/** 错误类型对应的图标 */
const ERROR_ICONS: Record<GlobalErrorType, string> = {
  js_error: '⚠️',
  promise_rejection: '⏳',
  resource_error: '📦',
  fetch_error: '🌐',
  manual_report: '🔔',
};

/** 错误类型对应的颜色类 */
const ERROR_COLORS: Record<GlobalErrorType, string> = {
  js_error: 'border-red-500/40 bg-red-500/10',
  promise_rejection: 'border-orange-500/40 bg-orange-500/10',
  resource_error: 'border-yellow-500/40 bg-yellow-500/10',
  fetch_error: 'border-pink-500/40 bg-pink-500/10',
  manual_report: 'border-hermes-500/40 bg-hermes-500/10',
};

/** 错误类型对应的描述 */
const ERROR_TYPE_LABELS: Record<GlobalErrorType, string> = {
  js_error: '运行错误',
  promise_rejection: '未处理异常',
  resource_error: '资源加载失败',
  fetch_error: '网络请求失败',
  manual_report: '操作提示',
};

/**
 * GlobalErrorToast 主组件
 * 调用方：放在 App.tsx 根级别（与 ToastContainer 同级）
 */
export function GlobalErrorToast({
  autoHideMs = 8000,
  className = '',
}: GlobalErrorToastProps) {
  const { currentError, dismissError, clearHistory } = useGlobalError();
  const [showDetail, setShowDetail] = useState(false);
  const [renderedId, setRenderedId] = useState<string | null>(null);

  // 错误切换时重置详情展开状态
  useEffect(() => {
    if (currentError && currentError.id !== renderedId) {
      setShowDetail(false);
      setRenderedId(currentError.id);
    }
  }, [currentError, renderedId]);

  // 自动关闭
  useEffect(() => {
    if (!currentError || autoHideMs <= 0) return;
    const timer = setTimeout(() => {
      dismissError(currentError.id);
    }, autoHideMs);
    return () => clearTimeout(timer);
  }, [currentError, autoHideMs, dismissError]);

  if (!currentError) return null;

  const color = ERROR_COLORS[currentError.type] || ERROR_COLORS.manual_report;
  const icon = ERROR_ICONS[currentError.type] || '🔔';
  const label = ERROR_TYPE_LABELS[currentError.type] || '错误';
  const isDev = import.meta.env?.DEV ?? false;

  return (
    <div
      data-testid="global-error-toast"
      data-error-id={currentError.id}
      data-error-type={currentError.type}
      role="alert"
      aria-live="assertive"
      className={[
        'fixed top-4 left-1/2 -translate-x-1/2 z-[100]',
        'max-w-2xl w-[calc(100%-2rem)]',
        'rounded-lg border shadow-2xl backdrop-blur-md',
        'animate-slide-down',
        color,
        className,
      ].join(' ')}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        {/* 图标 */}
        <div className="text-2xl flex-shrink-0" aria-hidden="true">
          {icon}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-surface-100 px-2 py-0.5 rounded bg-surface-800/60">
              {label}
            </span>
            <span className="text-[10px] text-surface-400 font-mono">
              {new Date(currentError.timestamp).toLocaleTimeString()}
            </span>
            {currentError.source && (
              <span className="text-[10px] text-surface-500 font-mono truncate">
                {currentError.source}
                {currentError.line ? `:${currentError.line}` : ''}
              </span>
            )}
          </div>

          {/* 错误消息 */}
          <p className="text-sm text-surface-100 break-words leading-relaxed">
            {currentError.message}
          </p>

          {/* 错误详情（展开时） */}
          {showDetail && currentError.stack && (
            <pre
              data-testid="global-error-stack"
              className="mt-2 text-[10px] text-surface-300 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-surface-900/60 rounded p-2 border border-surface-700"
            >
              {currentError.stack}
            </pre>
          )}

          {/* 上下文信息 */}
          {showDetail && currentError.context && (
            <div className="mt-2 text-[10px] text-surface-400">
              <span className="font-semibold">上下文：</span>
              <code className="font-mono">
                {JSON.stringify(currentError.context)}
              </code>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {isDev && currentError.stack && (
            <button
              data-testid="global-error-detail-toggle"
              onClick={() => setShowDetail((s) => !s)}
              className="text-[10px] px-2 py-0.5 rounded bg-surface-800/60 hover:bg-surface-700 text-surface-200"
              aria-label={showDetail ? '隐藏详情' : '查看详情'}
            >
              {showDetail ? '收起' : '详情'}
            </button>
          )}
          <button
            data-testid="global-error-dismiss"
            onClick={() => dismissError(currentError.id)}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-800/60 hover:bg-red-700/60 text-surface-200"
            aria-label="忽略此错误"
          >
            忽略
          </button>
          <button
            data-testid="global-error-clear"
            onClick={() => {
              clearHistory();
              dismissError(currentError.id);
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-800/60 hover:bg-red-900/60 text-surface-200"
            aria-label="清空所有错误"
          >
            清空
          </button>
        </div>
      </div>

      {/* 自动关闭进度条 */}
      {autoHideMs > 0 && (
        <div className="h-0.5 bg-surface-700/40 overflow-hidden rounded-b-lg">
          <div
            className="h-full bg-red-400/60 animate-shrink-width"
            style={{
              animation: `shrink-width ${autoHideMs}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default GlobalErrorToast;

// 辅助函数：用于在 Storybook 等场景下直接使用 reportError
export { reportError } from '../utils/globalErrorHandler';
export type { GlobalErrorReport };
