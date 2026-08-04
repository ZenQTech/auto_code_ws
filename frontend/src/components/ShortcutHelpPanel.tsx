/**
 * # ============================================================
 * ShortcutHelpPanel - 快捷键帮助面板 (v1.0.0)
 * Cycle 60+ Solo 重构 - 对标 Codex ⌘/ 帮助
 * # ============================================================
 * 核心作用：展示 7 个 Codex 风格 keymap contexts 的快捷键
 * 设计要点：
 *   - 按 context 分组
 *   - 高亮当前活跃 context
 *   - 搜索/过滤
 *   - 暗色/亮色主题适配
 * 输入参数：
 *   - open: boolean
 *   - onClose: () => void
 *   - activeContext?: ShortcutContext
 * 输出结果：UI 组件
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Solo 重构 - 初次创建
 * ====================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  CODEX_KEYMAP_CONTEXTS,
  getActiveShortcutContext,
  subscribeShortcutContext,
  type ShortcutContext,
} from '../hooks/useShortcut';

// ============================================================
// 类型
// ====================================

export interface ShortcutHelpPanelProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  'data-testid'?: string;
}

// ============================================================
// 工具
// ====================================

function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'mod') {
        if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)) {
          return '⌘';
        }
        return 'Ctrl';
      }
      if (lower === 'ctrl') return 'Ctrl';
      if (lower === 'shift') return '⇧';
      if (lower === 'alt') return '⌥';
      if (lower === 'meta') return '⌘';
      if (lower === 'enter') return '↵';
      if (lower === 'escape') return 'Esc';
      if (lower === 'arrowup') return '↑';
      if (lower === 'arrowdown') return '↓';
      if (lower === 'arrowleft') return '←';
      if (lower === 'arrowright') return '→';
      if (lower === 'delete') return 'Del';
      if (lower === 'backspace') return '⌫';
      if (lower === 'tab') return '⇥';
      if (lower === ' ') return 'Space';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(' + ');
}

// ============================================================
// 组件
// ====================================

export const ShortcutHelpPanel: React.FC<ShortcutHelpPanelProps> = ({
  open,
  onClose,
  className = '',
  'data-testid': testId = 'shortcut-help-panel',
}) => {
  const [activeCtx, setActiveCtx] = useState<ShortcutContext>('global');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setActiveCtx(getActiveShortcutContext());
    const unsub = subscribeShortcutContext((ctx) => setActiveCtx(ctx));
    return unsub;
  }, []);

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!query.trim()) return CODEX_KEYMAP_CONTEXTS;
    const q = query.toLowerCase();
    return CODEX_KEYMAP_CONTEXTS
      .map((ctx) => ({
        ...ctx,
        bindings: ctx.bindings.filter(
          (b) =>
            b.combo.toLowerCase().includes(q) ||
            b.description.toLowerCase().includes(q)
        ),
      }))
      .filter((ctx) => ctx.bindings.length > 0);
  }, [query]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20
                 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      data-testid={testId}
    >
      <div
        className={`w-[720px] max-w-[90vw] max-h-[70vh]
                    rounded-xl shadow-2xl overflow-hidden
                    bg-[var(--bg-panel)] border border-[var(--border-color)]
                    flex flex-col ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center gap-3">
          <div className="text-lg font-semibold">⌘ 快捷键</div>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索快捷键..."
            className="flex-1 px-3 py-1.5 text-sm rounded-md
                       bg-[var(--bg-elevated)] border border-[var(--border-color)]
                       focus:outline-none focus:border-hermes-500"
            data-testid={`${testId}-search`}
          />
          <button
            onClick={onClose}
            className="px-2 py-1 text-sm rounded
                       hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            title="关闭 (Esc)"
            data-testid={`${testId}-close`}
          >
            ✕
          </button>
        </div>

        {/* Context 列表 */}
        <div className="flex-1 overflow-auto p-4">
          {filtered.length === 0 && (
            <div className="text-center text-sm text-[var(--text-secondary)] py-8">
              未找到匹配的快捷键
            </div>
          )}
          {filtered.map((ctx) => {
            const isActive = ctx.ctx === activeCtx;
            return (
              <div
                key={ctx.ctx}
                className="mb-4"
                data-testid={`${testId}-ctx-${ctx.ctx}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`text-sm font-semibold ${isActive ? 'text-[var(--hermes-500)]' : 'text-[var(--text-primary)]'}`}
                  >
                    {ctx.label}
                    {isActive && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[var(--hermes-50)] text-[var(--hermes-500)]">当前活跃</span>}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">{ctx.description}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {ctx.bindings.map((b) => (
                    <div
                      key={b.combo + b.description}
                      className="flex items-center justify-between gap-2
                                 px-2.5 py-1.5 rounded
                                 bg-[var(--bg-elevated)] border border-[var(--border-color)]"
                    >
                      <span className="text-xs text-[var(--text-secondary)]">
                        {b.description}
                      </span>
                      <kbd className="px-1.5 py-0.5 rounded text-[11px] font-mono
                                       bg-[var(--bg-app)] border border-[var(--border-color)]
                                       text-[var(--text-primary)]">
                        {formatCombo(b.combo)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部 */}
        <div className="px-4 py-2 border-t border-[var(--border-color)]
                        text-xs text-[var(--text-secondary)]
                        flex items-center justify-between">
          <div>
            当前活跃 context: <span className="font-mono text-[var(--text-primary)]">{activeCtx}</span>
          </div>
          <div>
            按 <kbd className="px-1 rounded bg-[var(--bg-elevated)]">Esc</kbd> 关闭
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShortcutHelpPanel;
