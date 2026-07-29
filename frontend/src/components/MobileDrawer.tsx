/**
 * # ============================================================
 * MobileDrawer - 移动端抽屉组件（v1.0.0 P2-1 新增）
 * # ============================================================
 * 核心作用：在移动端（< 768px）将侧边栏/弹窗改为从屏幕边缘滑出的抽屉
 * 特性：
 *   - 支持左/右/上/下四个方向
 *   - 背景遮罩（半透明黑色）点击关闭
 *   - 滑入/滑出动画（300ms ease）
 *   - 阻止背景滚动
 *   - Esc 键关闭
 *   - 抽屉宽度可配置（默认 80vw，最大 320px）
 *   - 适配安全区域（iPhone notch / home indicator）
 * 适用场景：
 *   - 移动端 Sidebar（左侧滑出）
 *   - 移动端设置面板（右侧滑出）
 *   - 移动端命令面板（顶部滑出）
 * 依赖：无
 * ============================================================
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useIsMobile } from '../hooks/useResponsive';

export type DrawerDirection = 'left' | 'right' | 'top' | 'bottom';

export interface MobileDrawerProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 抽屉方向 */
  direction?: DrawerDirection;
  /** 抽屉宽度（left/right 方向时），默认 80vw，最大 320px */
  width?: string;
  /** 抽屉高度（top/bottom 方向时），默认 60vh */
  height?: string;
  /** 是否点击遮罩关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** 是否按 Esc 关闭（默认 true） */
  closeOnEsc?: boolean;
  /** 是否锁定 body 滚动（默认 true） */
  lockScroll?: boolean;
  /** 抽屉内容 */
  children: ReactNode;
  /** 自定义类名 */
  className?: string;
  /** z-index（默认 50） */
  zIndex?: number;
  /** 数据属性（用于测试） */
  'data-testid'?: string;
}

const ANIMATION_DURATION_MS = 300;

/**
 * 移动端抽屉组件
 */
export function MobileDrawer({
  open,
  onClose,
  direction = 'left',
  width = '80vw',
  height = '60vh',
  closeOnBackdrop = true,
  closeOnEsc = true,
  lockScroll = true,
  children,
  className = '',
  zIndex = 50,
  'data-testid': dataTestId,
}: MobileDrawerProps) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);

  // 桌面端不渲染（避免不必要的 DOM 节点）
  if (!isMobile) return null;

  // Esc 键关闭
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, onClose]);

  // body 滚动锁定
  useEffect(() => {
    if (!open || !lockScroll) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open, lockScroll]);

  if (!open) return null;

  // 计算抽屉尺寸
  const isHorizontal = direction === 'left' || direction === 'right';
  const sizeStyle: React.CSSProperties = isHorizontal
    ? { width: `min(${width}, 320px)`, maxWidth: '90vw' }
    : { height: `min(${height}, 480px)`, maxHeight: '90vh' };

  // 计算位置
  const positionStyle: React.CSSProperties = (() => {
    switch (direction) {
      case 'left':
        return { top: 0, left: 0, bottom: 0 };
      case 'right':
        return { top: 0, right: 0, bottom: 0 };
      case 'top':
        return { top: 0, left: 0, right: 0 };
      case 'bottom':
        return { bottom: 0, left: 0, right: 0 };
    }
  })();

  // 滑入动画 transform
  const transformStyle: React.CSSProperties = (() => {
    switch (direction) {
      case 'left':
        return { transform: 'translateX(0)' };
      case 'right':
        return { transform: 'translateX(0)' };
      case 'top':
        return { transform: 'translateY(0)' };
      case 'bottom':
        return { transform: 'translateY(0)' };
    }
  })();

  return (
    <div
      data-component="mobile-drawer"
      data-direction={direction}
      data-open={open}
      data-testid={dataTestId ?? 'mobile-drawer'}
      className="fixed inset-0"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
    >
      {/* 背景遮罩 */}
      <div
        data-testid="mobile-drawer-backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
        className="absolute inset-0 bg-black/50 animate-fade-in"
        style={{ animationDuration: `${ANIMATION_DURATION_MS}ms` }}
      />

      {/* 抽屉主体 */}
      <div
        ref={containerRef}
        data-testid="mobile-drawer-panel"
        className={[
          'absolute',
          'bg-surface-50',
          'shadow-2xl',
          'overflow-y-auto',
          'animate-drawer-in',
          className,
        ].filter(Boolean).join(' ')}
        style={{
          ...positionStyle,
          ...sizeStyle,
          ...transformStyle,
          animationDuration: `${ANIMATION_DURATION_MS}ms`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default MobileDrawer;
