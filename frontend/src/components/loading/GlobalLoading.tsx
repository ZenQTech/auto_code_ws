/**
 * # ============================================================
 * # GlobalLoading 全局加载遮罩（v6.40.0 P2-5 加载状态规范）
 * # ============================================================
 * # 核心作用：全屏 loading 遮罩，用于阻塞型操作（应用启动 / 全局数据加载）
 * #           通过 Portal 渲染到 body 末尾，避免父级样式干扰
 * # 运行流程：
 * #   1. 接收 visible 控制显隐
 * #   2. 通过 React Portal 渲染到 body 末尾
 * #   3. 背景虚化 + Spinner + 文字
 * #   4. Esc 不可关闭（阻塞性操作）
 * # 输入参数：
 * #   - visible: 是否显示
 * #   - text: 加载描述
 * #   - variant: 'spinner' | 'dots' | 'streaming'
 * #   - closable: 是否允许点击背景关闭（默认 false）
 * # 输出结果：全屏 loading 遮罩 JSX
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-5 新建
 * # ============================================================
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loading, type LoadingVariant, type LoadingSize } from './Loading';

export interface GlobalLoadingProps {
  /** 是否显示 */
  visible: boolean;
  /** 加载文字 */
  text?: string;
  /** 加载形态 */
  variant?: LoadingVariant;
  /** 尺寸 */
  size?: LoadingSize;
  /** 是否允许点击背景关闭（默认 false，阻塞型） */
  closable?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
  /** 测试 ID */
  'data-testid'?: string;
}

/**
 * GlobalLoading 全局加载遮罩
 */
export function GlobalLoading({
  visible,
  text = '加载中…',
  variant = 'spinner',
  size = 'lg',
  closable = false,
  onClose,
  'data-testid': dataTestId = 'global-loading',
}: GlobalLoadingProps) {
  // 锁定 body 滚动
  useEffect(() => {
    if (!visible) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [visible]);

  if (!visible) return null;

  const handleBackdropClick = () => {
    if (closable) onClose?.();
  };

  return createPortal(
    <div
      data-testid={dataTestId}
      data-component="global-loading"
      data-visible={visible}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-md animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="全局加载中"
    >
      <div
        data-testid={`${dataTestId}-panel`}
        className="glass-strong rounded-2xl px-8 py-6 border border-surface-200/40 shadow-level-3 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <Loading
          variant={variant}
          size={size}
          color="hermes"
          text={text}
          layout="center"
          data-testid={`${dataTestId}-content`}
        />
      </div>
    </div>,
    document.body
  );
}

export default GlobalLoading;
