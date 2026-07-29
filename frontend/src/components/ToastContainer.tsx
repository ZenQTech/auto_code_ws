/**
 * # ============================================================
 * Toast 容器组件（v6.34.0 P1-7 新增）
 * # ============================================================
 * 核心作用：渲染带操作按钮的 Toast 队列
 * 特性：
 *   - 多 Toast 堆叠（最多 3 个）
 *   - 类型颜色（success/error/warning/info）
 *   - 撤销/重试等操作按钮
 *   - 入场/退场动画
 *   - 可关闭（点击 X 或自动消失）
 * 依赖：useToast Hook
 * ============================================================
 */

import type { ToastItem, ToastType } from '../hooks/useToast';

export interface ToastContainerProps {
  /** Toast 队列 */
  toasts: ToastItem[];
  /** 关闭指定 toast */
  onDismiss: (id: string) => void;
}

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    icon: '✓',
  },
  error: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/40',
    icon: '✕',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    icon: '⚠',
  },
  info: {
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/40',
    icon: 'ℹ',
  },
};

/**
 * 单个 Toast 项（含操作按钮）
 */
function ToastItemView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const style = TYPE_STYLES[toast.type];

  const handleAction = () => {
    if (toast.onAction) {
      try {
        toast.onAction();
      } catch (err) {
        // 操作回调失败不应影响 toast 关闭
        // eslint-disable-next-line no-console
        console.error('[ToastContainer] action handler failed:', err);
      }
    }
    onDismiss(toast.id);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-item"
      data-toast-type={toast.type}
      className={[
        'pointer-events-auto',
        'flex items-center gap-3',
        'min-w-[280px] max-w-[480px]',
        'px-4 py-3',
        'rounded-md border',
        'shadow-level-3',
        'backdrop-blur-md',
        style.bg,
        style.border,
        'animate-slide-down',
      ].join(' ')}
    >
      {/* 类型图标 */}
      <span
        className={[
          'flex-shrink-0',
          'w-6 h-6',
          'flex items-center justify-center',
          'rounded-full',
          'text-sm font-bold',
          toast.type === 'success' && 'bg-emerald-500 text-white',
          toast.type === 'error' && 'bg-rose-500 text-white',
          toast.type === 'warning' && 'bg-amber-500 text-white',
          toast.type === 'info' && 'bg-sky-500 text-white',
        ].filter(Boolean).join(' ')}
        aria-hidden="true"
      >
        {style.icon}
      </span>

      {/* 文本 */}
      <span className="flex-1 text-sm text-surface-50 break-words">
        {toast.message}
      </span>

      {/* 操作按钮（撤销/重试） */}
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={handleAction}
          className={[
            'flex-shrink-0',
            'px-3 py-1',
            'text-xs font-semibold',
            'rounded-sm',
            'border',
            'transition-colors',
            toast.type === 'success' && 'border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/20',
            toast.type === 'error' && 'border-rose-500/60 text-rose-300 hover:bg-rose-500/20',
            toast.type === 'warning' && 'border-amber-500/60 text-amber-300 hover:bg-amber-500/20',
            toast.type === 'info' && 'border-sky-500/60 text-sky-300 hover:bg-sky-500/20',
          ].filter(Boolean).join(' ')}
          data-testid="toast-action"
        >
          {toast.actionLabel}
        </button>
      )}

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭提示"
        className={[
          'flex-shrink-0',
          'w-5 h-5',
          'flex items-center justify-center',
          'rounded-sm',
          'text-surface-300 hover:text-surface-50',
          'hover:bg-white/5',
          'transition-colors',
        ].join(' ')}
        data-testid="toast-close"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Toast 容器（堆叠显示）
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="通知"
      data-testid="toast-container"
      className={[
        'pointer-events-none',
        'fixed bottom-6 right-6 z-50',
        'flex flex-col-reverse gap-2',
        'max-w-[calc(100vw-3rem)]',
      ].join(' ')}
    >
      {toasts.map((toast) => (
        <ToastItemView
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

export default ToastContainer;
