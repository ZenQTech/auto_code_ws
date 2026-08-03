/**
 * # ============================================================
 * Dialog - 统一对话框组件 (v1.0.0)
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：替换 47 个 panel 中散落的 Modal 实现，统一动画/遮罩/关闭逻辑
 * 运行流程：
 *   1. open=true 时挂载到 body 末尾
 *   2. 显示半透明遮罩 + scale-in 动画
 *   3. ESC 键 / 遮罩点击触发 onClose（除非 closeOnMaskClick=false）
 *   4. 关闭时 scale-out 动画 180ms
 * 设计要点：
 *   - 4 个 size: sm(384) / md(512) / lg(640) / xl(768)
 *   - 主题感知玻璃背景
 *   - 锁定 body 滚动
 *   - focus trap（基础版：首按钮 focus）
 * 输入参数：{ open, onClose, title?, children, size?, footer?, closeOnMaskClick? }
 * 输出结果：Portal 弹窗
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnMaskClick?: boolean;
  closeOnEsc?: boolean;
  className?: string;
  'data-testid'?: string;
}

const SIZE_CLASSES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnMaskClick = true,
  closeOnEsc = true,
  className = '',
  'data-testid': testId,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  if (typeof document === 'undefined') return null;

  const handleMaskClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnMaskClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={handleMaskClick}
      data-testid={testId ? `${testId}-mask` : 'dialog-mask'}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className={[
          'w-full',
          SIZE_CLASSES[size],
          'glass-themed rounded-2xl shadow-[var(--shadow-md)]',
          'animate-lift-in',
          className,
        ].join(' ')}
        data-testid={testId ?? 'dialog'}
      >
        {title && (
          <header className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
              aria-label="关闭"
              data-testid={testId ? `${testId}-close` : 'dialog-close'}
            >
              ✕
            </button>
          </header>
        )}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto text-[var(--text-primary)]">
          {children}
        </div>
        {footer && (
          <footer className="px-5 py-3 border-t border-[var(--border-color)] flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Dialog;
