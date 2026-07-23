/**
 * # ============================================================
 * # 极简顶部品牌栏组件 - BrandHeader
 * # ============================================================
 * # 核心作用：替代原 App.tsx 顶部复杂布局，遵循豆包式极简风格，
 * #           把次要操作（设置 / 回收站 / 用量）移到三个点下拉菜单，
 * #           顶部只保留 Logo + Session 标题 + 新建对话按钮。
 * # 运行流程：
 * #   1. 左侧：Logo（圆形渐变背景 + 闪电图标，Hermes 主色调）
 * #   2. 中间：Session 标题（仅 md+ 显示，移动端隐藏）
 * #   3. 右侧：新建对话按钮（圆形，hover 旋转 90°）+ 三个点下拉菜单
 * #   4. 点击外部区域关闭下拉菜单（通过 useEffect 绑定 document mousedown）
 * #   5. 菜单项点击后触发对应 onOpen* 回调，同时关闭菜单
 * # 输入参数：
 * #   - sessionTitle: 当前 Session 标题（中间显示）
 * #   - onNewChat: 新建对话回调
 * #   - onOpenSettings?: 打开设置面板回调（可选）
 * #   - onOpenTrash?: 打开回收站回调（可选）
 * #   - onOpenUsage?: 打开/切换用量监控回调（可选）
 * # 输出结果：56px 高极简顶部品牌栏（sticky 吸顶 + 半透明背景 + 底部细边）
 * # 复用说明：
 * #   - 无复用（全新组件）
 * #   - lucide-react 未安装，下拉菜单图标使用 inline SVG
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：极简顶部 + 半透明背景 + 下拉菜单（豆包风格）
 * #   - 2026-06-24 | v1.1.0 | 新增 appMode prop + 模式指示器 pill（聊天 / 编程双模式标识）
 * #   - 2026-06-24 | v1.1.0 | 下拉菜单新增"文件浏览器"切换项（控制 fileExplorerOpen state）
 * #   - 2026-06-24 | v1.2.0 | 渲染模式切换 pill（解决 BrandHeader appMode prop 未渲染问题）
 * #   - 2026-06-24 | v1.3.0 | 删除模式切换 pill（信息密度过高；保留 Sidebar/ProjectSelector 入口）
 * # ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * BrandHeader 组件 Props
 */
export interface BrandHeaderProps {
  /** 当前 Session 标题，用于中间区域展示 */
  sessionTitle: string;
  /** 新建对话按钮点击回调 */
  onNewChat: () => void;
  /** 打开设置面板回调（可选，提供则菜单显示"设置"项） */
  onOpenSettings?: () => void;
  /** 打开回收站回调（可选，提供则菜单显示"回收站"项） */
  onOpenTrash?: () => void;
  /** 打开/切换用量监控回调（可选，提供则菜单显示"用量监控"项） */
  onOpenUsage?: () => void;
  /** v1.1.0 新增：切换文件浏览器显示/隐藏回调（可选，提供则菜单显示"文件浏览器"项） */
  onOpenFileExplorer?: () => void;
  /** v1.1.0 新增：当前文件浏览器显示状态（用于菜单项右侧状态指示） */
  fileExplorerOpen?: boolean;
}

/**
 * 内联 SVG 图标渲染器
 * 参数：
 *   - name: 图标键
 *   - className: 尺寸/颜色类名
 * 返回值：JSX 元素
 */
function Icon({ name, className = 'w-5 h-5' }: { name: 'zap' | 'plus' | 'more' | 'chart' | 'settings' | 'trash' | 'folder'; className?: string }) {
  switch (name) {
    case 'zap':
      // 闪电 - Logo 内图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'plus':
      // 加号 - 新建对话
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'more':
      // 三个水平点 - 下拉菜单触发器
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'chart':
      // 柱状图 - 用量监控
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 3v18h18" />
          <path d="M7 16V10" />
          <path d="M11 16V6" />
          <path d="M15 16v-4" />
          <path d="M19 16v-8" />
        </svg>
      );
    case 'settings':
      // 齿轮 - 设置
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'trash':
      // 垃圾桶 - 回收站
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'folder':
      // v1.1.0 新增：FolderTree - 文件浏览器（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          <path d="M3 7h18M9 12h6M9 16h6" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * 极简顶部品牌栏组件
 * - 高度 56px（h-14），sticky 吸顶，半透明背景 + 底部细边
 * - Logo + Session 标题 + 新建按钮 + 三个点菜单
 * - 移动端（< 768px）隐藏中间标题
 */
export default function BrandHeader({
  sessionTitle,
  onNewChat,
  onOpenSettings,
  onOpenTrash,
  onOpenUsage,
  onOpenFileExplorer,
  fileExplorerOpen,
}: BrandHeaderProps) {
  /** 下拉菜单开关状态 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 下拉菜单容器 ref（用于检测外部点击） */
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * 点击下拉菜单外部区域时自动关闭菜单
   * 绑定时机：menuOpen 为 true 时绑定；为 false 时解绑
   */
  useEffect(() => {
    if (!menuOpen) return;
    /**
     * 外部点击检测
     * 步骤：判断点击目标是否在 menuRef 容器内；不在则关闭菜单
     */
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  /**
   * 触发菜单项的通用回调包装
   * 步骤：调用外部回调 → 关闭菜单
   * 参数：
   *   - cb?: 外部回调（可能未提供）
   * 返回值：包装后的事件处理函数
   */
  const wrapMenuItem = useCallback((cb?: () => void) => () => {
    if (cb) cb();
    setMenuOpen(false);
  }, []);

  return (
    <header
      // sticky 吸顶 + 半透明背景 + backdrop-blur（玻璃质感）+ 底部 1px 边
      className="sticky top-0 z-40 h-14 bg-white/80 backdrop-blur-md border-b border-surface-200/60
                 flex items-center justify-between px-4"
    >
      {/* 左侧：Logo（圆形渐变 + 闪电图标） */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-hermes-400 to-hermes-600 flex items-center justify-center shadow-glow-hermes">
          <Icon name="zap" className="w-5 h-5 text-white" />
        </div>
        {/* 品牌名（仅 md+ 显示，移动端隐藏） */}
        <span className="hidden md:inline text-lg font-medium text-surface-900">Hermes</span>
      </div>

      {/* 中间：v1.3.0 仅显示 Session 标题（仅 md+ 显示）；模式切换入口已移至 Sidebar/ProjectSelector */}
      <h2 className="hidden md:block text-body font-medium text-surface-700 truncate max-w-md">
        {sessionTitle}
      </h2>

      {/* 右侧：新建对话按钮 + 三个点下拉菜单 */}
      <div className="flex items-center gap-2">
        {/* 新建对话按钮：圆形，hover 时旋转 90° */}
        <button
          onClick={onNewChat}
          title="新建对话"
          aria-label="新建对话"
          className="w-9 h-9 rounded-full bg-hermes-50 hover:bg-hermes-100 text-hermes-600
                     hover:rotate-90 transition-transform duration-default ease-spring
                     flex items-center justify-center shadow-glow-hermes-sm"
        >
          <Icon name="plus" className="w-5 h-5" />
        </button>

        {/* 三个点下拉菜单 */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-9 h-9 rounded-full hover:bg-surface-100 text-surface-600
                       flex items-center justify-center transition-colors duration-fast"
          >
            <Icon name="more" className="w-5 h-5" />
          </button>

          {/* 下拉菜单面板：仅在 menuOpen 时渲染 */}
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl
                         shadow-level-3 border border-surface-200 py-1
                         animate-lift-in z-50"
            >
              {/* v1.1.0 新增：文件浏览器（菜单首位，FolderTree 图标）
               *  行为：点击调 onOpenFileExplorer() 切换父组件 state + 关闭菜单
               *  状态指示：fileExplorerOpen=true 时右侧显示绿色实心圆 ●
               *           fileExplorerOpen=false 时显示灰色空心圆 ○
               *  父组件 App.tsx 仅在 appMode === 'coding' && selectedProject 时
               *  才透传 onOpenFileExplorer 回调，其他场景下本项不渲染 */}
              {onOpenFileExplorer && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenFileExplorer)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center justify-between
                             transition-colors duration-fast"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="folder" className="w-4 h-4" />
                    <span>文件浏览器</span>
                  </span>
                  {/* 状态指示：●（已展开，hermes-500 实心） / ○（已折叠，surface-400 空心） */}
                  {fileExplorerOpen ? (
                    <span className="text-hermes-500 text-xs">●</span>
                  ) : (
                    <span className="text-surface-400 text-xs">○</span>
                  )}
                </button>
              )}

              {/* 用量监控 */}
              {onOpenUsage && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenUsage)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chart" className="w-4 h-4" />
                  <span>用量监控</span>
                </button>
              )}

              {/* 设置 */}
              {onOpenSettings && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSettings)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="settings" className="w-4 h-4" />
                  <span>设置</span>
                </button>
              )}

              {/* 回收站 */}
              {onOpenTrash && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTrash)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="trash" className="w-4 h-4" />
                  <span>回收站</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
