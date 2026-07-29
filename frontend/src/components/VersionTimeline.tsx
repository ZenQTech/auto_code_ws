/**
 * # ============================================================
 * # VersionTimeline - 版本时间线 UI 组件 (v1.0.0 - Cycle 15 P1-6)
 * # ============================================================
 * # 核心作用：基于 UndoRedoStack 的版本时间线 UI
 * #           提供版本预览 + 跳转 + 删除 + 标签编辑
 * # 运行流程：
 * #   1. 父组件传入 UndoRedoStack 实例
 * #   2. 组件订阅 stack 变化自动重渲染
 * #   3. 展示所有历史版本（最新在上）
 * #   4. 点击预览（高亮 + 显示预览内容）
 * #   5. 确认跳转 / 取消预览
 * #   6. 支持键盘快捷键（Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做）
 * # 输入参数：
 * #   - stack: UndoRedoStack<any> | null
 * #   - renderPreview?: (state: T) => ReactNode  预览渲染
 * #   - onRestore?: (state: T) => void  恢复回调
 * #   - className?: string
 * #   - maxVisible?: number  时间线最大显示条数（默认 20）
 * # 输出结果：版本时间线 UI DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-6 初始版本
 * #     - 集成 UndoRedoStack 时间线视图
 * #     - 版本预览 + 跳转
 * #     - 键盘快捷键支持
 * # ============================================================
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { UndoRedoEntry, UndoRedoStack } from '../utils/undoRedoStack';

export interface VersionTimelineProps<T = unknown> {
  /** 撤销重做栈实例 */
  stack: UndoRedoStack<T> | null;
  /** 预览渲染函数 */
  renderPreview?: (state: T) => React.ReactNode;
  /** 恢复回调（点击"恢复到此版本"时） */
  onRestore?: (state: T) => void;
  /** 外层 className */
  className?: string;
  /** 时间线最大显示条数（默认 20） */
  maxVisible?: number;
  /** 启用键盘快捷键（默认 true） */
  enableKeyboardShortcuts?: boolean;
}

/**
 * 版本时间线
 * - 时间轴形式展示所有历史版本
 * - 当前指针位置高亮
 * - 点击预览，确认后跳转
 * - 支持快捷键 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z
 */
export function VersionTimeline<T = unknown>({
  stack,
  renderPreview,
  onRestore,
  className = '',
  maxVisible = 20,
  enableKeyboardShortcuts = true,
}: VersionTimelineProps<T>) {
  // 触发重渲染的版本号
  const [version, setVersion] = useState(0);
  // 当前预览的 entry id（不点击则 null）
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 容器 ref（用于键盘监听）
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * 订阅 stack 变化
   * 使用 stack.subscribe 提供的机制
   */
  useEffect(() => {
    if (!stack) return;
    const unsubscribe = stack.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [stack]);

  /**
   * 键盘快捷键
   * Ctrl/Cmd+Z 撤销
   * Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y 重做
   */
  useEffect(() => {
    if (!enableKeyboardShortcuts || !stack) return;
    const handler = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl/Cmd+Shift+Z 重做
          stack.redo();
        } else {
          // Ctrl/Cmd+Z 撤销
          stack.undo();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        stack.redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stack, enableKeyboardShortcuts]);

  /**
   * 获取可见的 entries
   * 按时间倒序（最新在上）
   */
  const visibleEntries = useMemo<UndoRedoEntry<T>[]>(() => {
    if (!stack) return [];
    const all = stack.getHistory();
    return all.slice(-maxVisible).reverse();
  }, [stack, version, maxVisible]);

  /**
   * 当前指针
   */
  const currentCursor = stack?.getCursor() ?? -1;
  const canUndo = stack?.canUndo() ?? false;
  const canRedo = stack?.canRedo() ?? false;

  /**
   * 处理预览
   */
  const handlePreview = useCallback(
    (id: string) => {
      if (previewId === id) {
        // 再次点击同一项：取消预览
        setPreviewId(null);
      } else {
        setPreviewId(id);
      }
    },
    [previewId],
  );

  /**
   * 确认恢复
   */
  const handleConfirmRestore = useCallback(() => {
    if (!stack || !previewId) return;
    const entry = stack.getHistory().find((e) => e.id === previewId);
    if (entry && onRestore) {
      onRestore(entry.state);
    }
    if (entry) {
      // 通过 jumpTo 跳转到 entry 所在位置
      const idx = stack.getHistory().findIndex((e) => e.id === previewId);
      if (idx >= 0) {
        stack.jumpTo(idx);
      }
    }
    setPreviewId(null);
  }, [stack, previewId, onRestore]);

  /**
   * 撤销
   */
  const handleUndo = useCallback(() => {
    stack?.undo();
  }, [stack]);

  /**
   * 重做
   */
  const handleRedo = useCallback(() => {
    stack?.redo();
  }, [stack]);

  if (!stack) {
    return (
      <div className={`text-sm text-surface-500 ${className}`} data-component="version-timeline" data-stack="null">
        暂无版本历史
      </div>
    );
  }

  if (visibleEntries.length === 0) {
    return (
      <div className={`text-sm text-surface-500 ${className}`} data-component="version-timeline" data-stack="empty">
        暂无历史记录
      </div>
    );
  }

  const previewEntry = previewId ? stack.getHistory().find((e) => e.id === previewId) ?? null : null;

  return (
    <div
      ref={containerRef}
      data-component="version-timeline"
      data-version={version}
      data-can-undo={canUndo}
      data-can-redo={canRedo}
      className={`flex flex-col gap-3 ${className}`}
    >
      {/* 顶部工具栏：撤销/重做按钮 */}
      <div className="flex items-center gap-2 pb-2 border-b border-surface-400/30">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          aria-label="撤销"
          title="撤销 (Ctrl/Cmd+Z)"
          data-testid="undo-button"
          className="flex items-center gap-1 px-2 py-1 text-xs rounded
                     bg-surface-200 hover:bg-surface-300
                     text-surface-700 hover:text-hermes-500
                     border border-surface-400/50
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h11a5 5 0 110 10h-3M3 10l4-4M3 10l4 4" />
          </svg>
          撤销
        </button>

        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          aria-label="重做"
          title="重做 (Ctrl/Cmd+Shift+Z)"
          data-testid="redo-button"
          className="flex items-center gap-1 px-2 py-1 text-xs rounded
                     bg-surface-200 hover:bg-surface-300
                     text-surface-700 hover:text-hermes-500
                     border border-surface-400/50
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H10a5 5 0 100 10h3M21 10l-4-4M21 10l-4 4" />
          </svg>
          重做
        </button>

        <span className="text-[10px] text-surface-500 ml-auto" data-testid="history-stats">
          {currentCursor + 1} / {visibleEntries.length}
        </span>
      </div>

      {/* 预览面板 */}
      {previewEntry && (
        <div
          className="p-3 rounded-lg bg-surface-200/60 border border-hermes-500/30 animate-msg-enter"
          data-component="version-preview"
          data-testid="version-preview"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-hermes-300">
              预览：{previewEntry.label}
            </div>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="text-xs text-surface-500 hover:text-surface-700"
              aria-label="关闭预览"
            >
              ✕
            </button>
          </div>
          <div className="text-xs text-surface-600 mb-2">
            {new Date(previewEntry.timestamp).toLocaleString()}
          </div>
          <div className="text-sm text-surface-800 max-h-40 overflow-y-auto">
            {renderPreview ? renderPreview(previewEntry.state) : (
              <pre className="whitespace-pre-wrap text-xs">
                {JSON.stringify(previewEntry.state, null, 2).slice(0, 500)}
              </pre>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="px-2 py-1 text-xs rounded
                         bg-surface-300 hover:bg-surface-400
                         text-surface-700
                         transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmRestore}
              data-testid="confirm-restore"
              className="px-2 py-1 text-xs rounded
                         bg-hermes-500 hover:bg-hermes-600
                         text-white font-medium
                         transition-colors"
            >
              恢复到此版本
            </button>
          </div>
        </div>
      )}

      {/* 时间线列表 */}
      <div className="flex flex-col gap-1 max-h-96 overflow-y-auto" data-testid="timeline-list">
        {visibleEntries.map((entry, idx) => {
          const isCurrent = idx === 0; // 倒序后第一个是最新（也可能是 current）
          const isPreviewing = previewId === entry.id;
          const position = visibleEntries.length - 1 - idx; // 正向位置
          const isAtCursor = position === currentCursor;
          return (
            <div
              key={entry.id}
              data-entry-id={entry.id}
              data-position={position}
              data-is-cursor={isAtCursor}
              data-is-previewing={isPreviewing}
              className={`
                relative flex items-center gap-2 pl-6 pr-3 py-1.5 rounded-md cursor-pointer
                transition-all duration-150
                ${isAtCursor
                  ? 'bg-hermes-500/15 border border-hermes-500/30'
                  : isPreviewing
                    ? 'bg-hermes-500/10 border border-hermes-500/20'
                    : 'hover:bg-surface-200/50 border border-transparent'}
              `}
              onClick={() => handlePreview(entry.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePreview(entry.id);
                }
              }}
            >
              {/* 时间线圆点 */}
              <span
                className={`
                  absolute left-2 top-1/2 -translate-y-1/2
                  w-2 h-2 rounded-full
                  ${isAtCursor
                    ? 'bg-hermes-500 ring-2 ring-hermes-500/30'
                    : isCurrent
                      ? 'bg-emerald-500'
                      : 'bg-surface-400'}
                `}
              />
              {/* 时间线连接线（除最后一项） */}
              {idx < visibleEntries.length - 1 && (
                <span className="absolute left-[14px] top-[60%] w-px h-4 bg-surface-400/50" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium truncate ${isAtCursor ? 'text-hermes-300' : 'text-surface-700'}`}>
                  {entry.label}
                </div>
                <div className="text-[10px] text-surface-500">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
              </div>
              {isAtCursor && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-hermes-500/20 text-hermes-300 font-medium">
                  当前
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VersionTimeline;
