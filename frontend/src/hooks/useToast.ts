/**
 * # ============================================================
 * Toast 提示状态管理 Hook
 * # ============================================================
 * 核心作用：从 App.tsx 抽离 toast 提示状态管理
 * 运行流程：
 *   1. 组件挂载时返回 showToast 触发函数和当前 toast 状态
 *   2. 调用 showToast(msg, type) 自动显示提示，2.4秒后自动消失
 *   3. 通过 onClose 回调允许外部强制关闭
 * 抽取日期：2026-07-27
 * 模块版本：v6.4.0 - P0-2 App.tsx 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.4.0 | 从 App.tsx 抽离 toast 状态管理（5 个 useState + 1 个 useCallback）
 */

import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastState {
  /** 是否可见 */
  visible: boolean;
  /** 提示文本 */
  message: string;
  /** 提示类型 */
  type: ToastType;
}

export interface UseToastResult extends ToastState {
  /** 触发 toast 提示（默认 2.4 秒后自动消失） */
  showToast: (msg: string, type?: ToastType) => void;
  /** 手动关闭 toast */
  hideToast: () => void;
}

const TOAST_DURATION_MS = 2400;

/**
 * Toast 状态管理 Hook
 * 抽取自 App.tsx 的 toastVisible / toastMessage / toastType / showToast / handleToastClose
 */
export function useToast(): UseToastResult {
  const [visible, setVisible] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [type, setType] = useState<ToastType>('success');

  const hideToast = useCallback(() => {
    setVisible(false);
  }, []);

  const showToast = useCallback(
    (msg: string, toastType: ToastType = 'success') => {
      setMessage(msg);
      setType(toastType);
      setVisible(true);
      // 自动消失
      window.setTimeout(() => {
        setVisible(false);
      }, TOAST_DURATION_MS);
    },
    [],
  );

  return {
    visible,
    message,
    type,
    showToast,
    hideToast,
  };
}
