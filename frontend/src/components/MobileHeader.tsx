/**
 * # ============================================================
 * MobileHeader - 移动端顶栏（v1.0.0 P2-1 新增）
 * # ============================================================
 * 核心作用：在移动端（< 768px）显示的精简顶栏
 *           包含汉堡按钮 + 当前页面标题 + 关键操作
 * 特性：
 *   - 桌面端不渲染（useIsMobile 短路）
 *   - 汉堡按钮触发 onMenuClick（用于打开 Sidebar 抽屉）
 *   - 当前页面/会话标题居中显示
 *   - 右侧主操作按钮（新建对话 / 设置）
 * 适用场景：
 *   - 移动端聊天界面顶部
 *   - 移动端编程界面顶部
 * 依赖：useResponsive
 * ============================================================
 */

import { useIsMobile } from '../hooks/useResponsive';

export interface MobileHeaderProps {
  /** 当前页面/会话标题 */
  title?: string;
  /** 点击汉堡按钮回调（打开 Sidebar 抽屉） */
  onMenuClick?: () => void;
  /** 点击右侧主操作按钮回调 */
  onPrimaryAction?: () => void;
  /** 主操作按钮图标（emoji 或文本） */
  primaryActionIcon?: string;
  /** 主操作按钮 ARIA 标签 */
  primaryActionLabel?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 移动端顶栏
 * 桌面端（≥ 768px）下返回 null，不渲染任何 DOM
 */
export function MobileHeader({
  title = 'Hermes',
  onMenuClick,
  onPrimaryAction,
  primaryActionIcon = '+',
  primaryActionLabel = '新建',
  className = '',
}: MobileHeaderProps) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <header
      data-component="mobile-header"
      data-testid="mobile-header"
      className={[
        'sticky top-0 z-30',
        'flex items-center justify-between gap-2',
        'h-12 px-3',
        'bg-surface-50/95 backdrop-blur-md',
        'border-b border-surface-200/60',
        'shadow-level-1',
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* 汉堡按钮 */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="打开菜单"
        data-testid="mobile-header-menu"
        className={[
          'flex-shrink-0',
          'w-9 h-9',
          'flex items-center justify-center',
          'rounded-md',
          'text-surface-700 hover:text-surface-900',
          'hover:bg-surface-200/60',
          'transition-colors',
          'active:scale-[0.95]',
        ].join(' ')}
      >
        {/* 三横线图标 */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* 标题 */}
      <h1
        className="flex-1 min-w-0 text-center text-sm font-semibold text-surface-900 truncate"
        data-testid="mobile-header-title"
      >
        {title}
      </h1>

      {/* 主操作按钮 */}
      {onPrimaryAction ? (
        <button
          type="button"
          onClick={onPrimaryAction}
          aria-label={primaryActionLabel}
          data-testid="mobile-header-primary"
          className={[
            'flex-shrink-0',
            'w-9 h-9',
            'flex items-center justify-center',
            'rounded-md',
            'bg-hermes-500 hover:bg-hermes-600',
            'text-white text-lg',
            'shadow-level-1',
            'transition-colors',
            'active:scale-[0.95]',
          ].join(' ')}
        >
          {primaryActionIcon}
        </button>
      ) : (
        // 占位元素，保持标题居中
        <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
      )}
    </header>
  );
}

export default MobileHeader;
