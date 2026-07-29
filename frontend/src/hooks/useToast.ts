/**
 * # ============================================================
 * Toast 提示状态管理 Hook（v6.34.0 P1-7 升级）
 * # ============================================================
 * 核心作用：从 App.tsx 抽离 toast 提示状态管理
 * 运行流程：
 *   1. 组件挂载时返回 showToast 触发函数和当前 toast 状态
 *   2. 调用 showToast(msg, type) 自动显示提示，2.4 秒后自动消失
 *   3. 调用 showToastWithAction(msg, label, onAction) 显示带撤销按钮的 Toast
 *   4. 通过 onClose 回调允许外部强制关闭
 * 抽取日期：2026-07-27
 * 模块版本：
 *   - v6.4.0 - P0-2 App.tsx 拆分第一阶段
 *   - v6.34.0 - P1-7 Cycle 15：新增撤销按钮能力 + 多 toast 队列
 * ============================================================
 */

import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * 单个 Toast 项 - 支持操作按钮（撤销/重试等）
 */
export interface ToastItem {
  /** 唯一 ID（用于队列管理） */
  id: string;
  /** 提示文本 */
  message: string;
  /** 提示类型 */
  type: ToastType;
  /** 持续时间（毫秒），0 表示不自动关闭 */
  duration: number;
  /** 操作按钮标签（如 "撤销" / "重试"） */
  actionLabel?: string;
  /** 操作按钮点击回调 */
  onAction?: () => void;
  /** 创建时间戳 */
  createdAt: number;
}

export interface ToastState {
  /** 是否可见（兼容旧 API） */
  visible: boolean;
  /** 提示文本（兼容旧 API：返回队列最后一条） */
  message: string;
  /** 提示类型（兼容旧 API） */
  type: ToastType;
}

export interface UseToastResult extends ToastState {
  /** 触发 toast 提示（默认 2.4 秒后自动消失） */
  showToast: (msg: string, type?: ToastType) => string;
  /** 触发带操作按钮的 toast（如撤销） */
  showToastWithAction: (
    msg: string,
    actionLabel: string,
    onAction: () => void,
    options?: { type?: ToastType; duration?: number }
  ) => string;
  /** 手动关闭 toast */
  hideToast: () => void;
  /** 关闭指定 ID 的 toast */
  dismissToast: (id: string) => void;
  /** 当前所有 toast 队列 */
  toasts: ToastItem[];
}

const TOAST_DURATION_MS = 2400;
const TOAST_DEFAULT_WITH_ACTION_DURATION = 6000; // 带操作的 toast 给用户 6 秒反应时间
const MAX_VISIBLE_TOASTS = 3; // 同时最多显示 3 个

let _toastIdCounter = 0;
const _genToastId = (): string => {
  _toastIdCounter += 1;
  return `toast_${Date.now()}_${_toastIdCounter}`;
};

/**
 * Toast 状态管理 Hook（v6.34.0 P1-7 升级）
 * - 向后兼容：保留 showToast/hideToast/visible/message/type API
 * - 新增：showToastWithAction（撤销按钮）+ toasts 队列 + dismissToast
 */
export function useToast(): UseToastResult {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  /**
   * 内部：移除指定 id 的 toast
   */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * 内部：自动关闭定时器管理
   */
  const scheduleAutoClose = useCallback(
    (id: string, duration: number) => {
      if (duration <= 0) return;
      window.setTimeout(() => {
        dismissToast(id);
      }, duration);
    },
    [dismissToast]
  );

  /**
   * 触发基础 toast
   */
  const showToast = useCallback(
    (msg: string, toastType: ToastType = 'success'): string => {
      const id = _genToastId();
      const item: ToastItem = {
        id,
        message: msg,
        type: toastType,
        duration: TOAST_DURATION_MS,
        createdAt: Date.now(),
      };
      setToasts((prev) => {
        const next = [...prev, item];
        // 超过最大数量时移除最早的
        if (next.length > MAX_VISIBLE_TOASTS) {
          return next.slice(next.length - MAX_VISIBLE_TOASTS);
        }
        return next;
      });
      scheduleAutoClose(id, item.duration);
      return id;
    },
    [scheduleAutoClose]
  );

  /**
   * 触发带操作按钮的 toast（撤销 / 重试 / 查看等）
   */
  const showToastWithAction = useCallback(
    (
      msg: string,
      actionLabel: string,
      onAction: () => void,
      options?: { type?: ToastType; duration?: number }
    ): string => {
      const id = _genToastId();
      const item: ToastItem = {
        id,
        message: msg,
        type: options?.type ?? 'info',
        duration: options?.duration ?? TOAST_DEFAULT_WITH_ACTION_DURATION,
        actionLabel,
        onAction,
        createdAt: Date.now(),
      };
      setToasts((prev) => {
        const next = [...prev, item];
        if (next.length > MAX_VISIBLE_TOASTS) {
          return next.slice(next.length - MAX_VISIBLE_TOASTS);
        }
        return next;
      });
      scheduleAutoClose(id, item.duration);
      return id;
    },
    [scheduleAutoClose]
  );

  /**
   * 手动关闭最新一条 toast（兼容旧 API）
   */
  const hideToast = useCallback(() => {
    setToasts((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  // 兼容旧 API：从队列最后一条派生
  const latest = toasts.length > 0 ? toasts[toasts.length - 1] : null;

  return {
    visible: latest !== null,
    message: latest?.message ?? '',
    type: latest?.type ?? 'success',
    showToast,
    showToastWithAction,
    hideToast,
    dismissToast,
    toasts,
  };
}

export default useToast;
