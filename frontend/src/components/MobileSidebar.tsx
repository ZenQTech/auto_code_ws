/**
 * # ============================================================
 * MobileSidebar - 移动端 Sidebar 抽屉包装（v1.0.0 P2-1 新增）
 * # ============================================================
 * 核心作用：将桌面端 Sidebar 包装为移动端抽屉
 * 行为：
 *   - 桌面端（≥ 768px）：不渲染任何 DOM（由桌面端 Sidebar 负责）
 *   - 移动端（< 768px）：将 Sidebar 放入 MobileDrawer 中
 *     - mobileSidebarOpen=true → 显示抽屉
 *     - mobileSidebarOpen=false → 隐藏
 * 优势：
 *   - 避免桌面/移动双份 Sidebar 状态
 *   - 自动适配 drawer 模式（遮罩、Esc、滚动锁定）
 *   - Sidebar 内部状态在抽屉开/关时保留（始终挂载）
 * 依赖：useResponsive / MobileDrawer / Sidebar
 * ============================================================
 */

import { useIsMobile } from '../hooks/useResponsive';
import MobileDrawer from './MobileDrawer';
import Sidebar from './Sidebar';
import type { Session } from '../types';

export interface MobileSidebarProps {
  /** 移动端 Sidebar 是否打开 */
  open: boolean;
  /** 移动端关闭回调 */
  onClose: () => void;
  // ====== Sidebar 透传 props ======
  expanded: boolean;
  onToggle: () => void;
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
  loading: boolean;
  appMode: 'chat' | 'coding';
  onModeSwitch: (mode: 'chat' | 'coding') => void;
  onSessionsChanged?: () => void;
  deletingSession?: boolean;
}

/**
 * 移动端 Sidebar 抽屉
 */
export function MobileSidebar({
  open,
  onClose,
  ...sidebarProps
}: MobileSidebarProps) {
  const isMobile = useIsMobile();
  // 桌面端不渲染（由桌面端 Sidebar 负责）
  if (!isMobile) return null;

  return (
    <MobileDrawer
      open={open}
      onClose={onClose}
      direction="left"
      width="320px"
      zIndex={50}
      data-testid="mobile-sidebar-drawer"
    >
      <Sidebar
        {...sidebarProps}
      />
    </MobileDrawer>
  );
}

export default MobileSidebar;
