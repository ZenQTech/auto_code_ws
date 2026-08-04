/**
 * # ============================================================
 * TaskTabs - 多任务并行 Tab Bar (v1.1.0)
 * Cycle 60+ Solo 重构 - 对标 Trae Solo 多任务并行 / Codex 多会话
 * # ============================================================
 * 核心作用：在 Solo 模式主壳顶部提供多任务（多 session / 多 workflow）tab 切换
 * 设计要点（v1.1.0 G60-FIX-17）：
 *   - 独立 tab = 独立 session / workflow
 *   - 状态指示器：运行中/暂停/错误/完成
 *   - 拖拽排序（可选，本期跳过）
 *   - 关闭按钮 + 中键关闭
 *   - + 按钮新建任务
 *   - 持久化 tab 列表到 localStorage
 *   - 超长 tab 列表可滚动
 *   - v1.1.0 视觉优化：
 *     - 高度 36px (h-9)，与 LoopStatusBar 对齐
 *     - 左/右滚动按钮更紧凑（w-6 h-6 圆角按钮）
 *     - tab 字号 11px，统一全局字号
 *     - active tab 使用主题色边框，与 LoopStatusBar 阶段徽章风格统一
 *     - 关闭按钮 opacity 100/0 切换，hover 态更明显
 * 输入参数：
 *   - tabs: Tab[] 任务列表
 *   - activeId: string 当前激活 tab id
 *   - onSelect: (id) => void
 *   - onClose: (id) => void
 *   - onNew: () => void
 *   - onRename?: (id, title) => void
 * 输出结果：UI 组件
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Solo 重构 - 初次创建
 *   - 2026-08-04 | v1.1.0 | G60-FIX-17 视觉优化：
 *                                - 高度 h-9 (36px)，与 LoopStatusBar 对齐
 *                                - 滚动按钮 w-6 h-6 紧凑圆角
 *                                - tab 字号 11px
 *                                - active tab 边框使用 hermes-500/50
 *                                - 关闭按钮 hover 态更明显
 * ============================================================
 */

import React, { useState, useRef, useEffect } from 'react';

// ============================================================
// 类型
// ====================================

export type TaskStatus = 'idle' | 'running' | 'paused' | 'error' | 'done';

export interface TaskTab {
  id: string;
  title: string;
  status: TaskStatus;
  /** 副标题/描述 */
  subtitle?: string;
  /** 进度 0-100（用于 progress bar） */
  progress?: number;
  /** 是否可关闭（不可关闭时隐藏 X） */
  closable?: boolean;
  /** 模型（显示在 tooltip） */
  model?: string;
  /** 创建时间 */
  createdAt?: string;
}

export interface TaskTabsProps {
  tabs: TaskTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
  className?: string;
  'data-testid'?: string;
}

// ============================================================
// 状态颜色
// ====================================

const STATUS_META: Record<TaskStatus, { color: string; emoji: string; pulse: boolean }> = {
  idle: { color: 'var(--text-tertiary, #94a3b8)', emoji: '○', pulse: false },
  running: { color: 'var(--hermes-500, #10b981)', emoji: '●', pulse: true },
  paused: { color: 'var(--hermes-400, #f59e0b)', emoji: '◐', pulse: false },
  error: { color: '#ef4444', emoji: '✕', pulse: false },
  done: { color: '#3b82f6', emoji: '✓', pulse: false },
};

// ============================================================
// 组件
// ====================================

export const TaskTabs: React.FC<TaskTabsProps> = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  className = '',
  'data-testid': testId = 'task-tabs',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 自动滚动到 active tab
  useEffect(() => {
    if (!scrollRef.current || !activeId) return;
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeId}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [activeId]);

  const handleStartRename = (tab: TaskTab) => {
    if (!onRename) return;
    setEditingId(tab.id);
    setEditValue(tab.title);
  };

  const handleFinishRename = () => {
    if (editingId && onRename && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const handleAuxClick = (e: React.MouseEvent, tab: TaskTab) => {
    if (e.button === 1 && tab.closable !== false) {
      e.preventDefault();
      onClose(tab.id);
    }
  };

  return (
    <div
      className={`flex items-center bg-[var(--bg-panel)]/40
                  border-b border-[var(--border-color)]
                  h-9 px-1 select-none ${className}`}
      data-testid={testId}
      role="tablist"
    >
      {/* 左滚动按钮 - v1.1.0 紧凑圆角按钮 */}
      {tabs.length > 0 && (
        <button
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollBy({ left: -200, behavior: 'smooth' });
          }}
          className="w-6 h-6 rounded text-[var(--text-secondary)]
                     hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]
                     flex items-center justify-center flex-shrink-0 transition-colors"
          title="向左滚动"
          aria-label="向左滚动"
          data-testid={`${testId}-scroll-left`}
        >
          ‹
        </button>
      )}

      {/* Tab 列表 */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-center gap-1 overflow-x-auto
                   scrollbar-none px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.length === 0 && (
          <div className="px-3 text-[11px] text-[var(--text-tertiary)]">
            暂无任务，点击 + 创建
          </div>
        )}

        {tabs.map((tab) => {
          const meta = STATUS_META[tab.status];
          const active = tab.id === activeId;
          const isEditing = editingId === tab.id;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => onSelect(tab.id)}
              onMouseDown={(e) => handleAuxClick(e, tab)}
              onDoubleClick={() => handleStartRename(tab)}
              className={`group flex items-center gap-1.5 h-7 px-2.5
                          rounded-md text-[11px] cursor-pointer
                          flex-shrink-0 max-w-[200px] transition-all
                          ${active
                            ? 'bg-[var(--bg-elevated)] border border-hermes-500/50 text-[var(--text-primary)] font-medium'
                            : 'bg-transparent border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)]'
                          }`}
              role="tab"
              aria-selected={active}
              title={
                tab.subtitle || tab.model
                  ? [
                      tab.title,
                      tab.subtitle,
                      tab.model ? `模型: ${tab.model}` : null,
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : tab.title
              }
              data-testid={`${testId}-tab-${tab.id}`}
            >
              {/* 状态指示 */}
              <span
                className={`flex-shrink-0 ${meta.pulse ? 'animate-pulse' : ''}`}
                style={{ color: meta.color }}
              >
                {meta.emoji}
              </span>

              {/* 标题 */}
              {isEditing ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      setEditingId(null);
                      setEditValue('');
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 bg-transparent border-b border-hermes-500
                             outline-none text-[11px]"
                />
              ) : (
                <span className="truncate">{tab.title}</span>
              )}

              {/* 进度条（小） */}
              {typeof tab.progress === 'number' && tab.status === 'running' && (
                <div className="w-10 h-1 bg-[var(--bg-app)] rounded overflow-hidden flex-shrink-0">
                  <div
                    className="h-full bg-hermes-500 transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, tab.progress))}%` }}
                  />
                </div>
              )}

              {/* 关闭按钮 */}
              {tab.closable !== false && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={`flex-shrink-0 w-4 h-4 rounded-sm
                              hover:bg-[var(--bg-app)]
                              text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                              ${active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'}
                              flex items-center justify-center text-base leading-none`}
                  title="关闭 (⌘W)"
                  aria-label="关闭"
                  data-testid={`${testId}-close-${tab.id}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 右滚动按钮 - v1.1.0 紧凑圆角按钮 */}
      {tabs.length > 0 && (
        <button
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
          }}
          className="w-6 h-6 rounded text-[var(--text-secondary)]
                     hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]
                     flex items-center justify-center flex-shrink-0 transition-colors"
          title="向右滚动"
          aria-label="向右滚动"
          data-testid={`${testId}-scroll-right`}
        >
          ›
        </button>
      )}

      {/* 分隔线 + 新建任务 */}
      <div className="h-4 w-px bg-[var(--border-color)] mx-1 flex-shrink-0" />
      <button
        onClick={onNew}
        className="w-7 h-7 rounded-md
                   hover:bg-[var(--bg-elevated)]
                   text-[var(--text-secondary)] hover:text-hermes-500
                   flex items-center justify-center flex-shrink-0
                   transition-colors text-base"
        title="新建任务 (⌘T)"
        aria-label="新建任务"
        data-testid={`${testId}-new`}
      >
        +
      </button>
    </div>
  );
};

export default TaskTabs;
