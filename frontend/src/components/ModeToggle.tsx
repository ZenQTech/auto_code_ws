/**
 * # ============================================================
 * ModeToggle 组件 (v6.37.0 Cycle 17 P0-2)
 * # ============================================================
 * 核心作用：Chat / Composer / Agent 三模式切换 Tab
 * 使用场景：BrandHeader 或 AppLayout 顶部
 * 设计要点：
 *   - 类似 Cursor 的模式切换 UI
 *   - 显示快捷键提示
 *   - 当前模式高亮
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-2 初次创建
 * ============================================================
 */

import React from 'react';
import type { HermesMode } from '../hooks/useMode';

export interface ModeToggleProps {
  /** 当前模式 */
  value: HermesMode;
  /** 模式变更回调 */
  onChange: (mode: HermesMode) => void;
  /** 快捷键提示 */
  shortcutHints?: Record<HermesMode, string>;
  /** 自定义类名 */
  className?: string;
}

interface ModeOption {
  value: HermesMode;
  label: string;
  icon: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'chat', label: 'Chat', icon: '💬' },
  { value: 'composer', label: 'Composer', icon: '⚡' },
  { value: 'agent', label: 'Agent', icon: '🤖' },
];

const DEFAULT_SHORTCUTS: Record<HermesMode, string> = {
  chat: '⌘L',
  composer: '⌘I',
  agent: '⌘⇧A',
};

/**
 * ModeToggle 组件
 */
export const ModeToggle: React.FC<ModeToggleProps> = ({
  value,
  onChange,
  shortcutHints = DEFAULT_SHORTCUTS,
  className = '',
}) => {
  return (
    <div
      data-testid="mode-toggle"
      data-mode={value}
      className={[
        'inline-flex items-center bg-surface-800 rounded-lg p-0.5',
        className,
      ].join(' ')}
      role="tablist"
    >
      {MODE_OPTIONS.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            data-testid={`mode-toggle-${opt.value}`}
            onClick={() => onChange(opt.value)}
            role="tab"
            aria-selected={isActive}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
              isActive
                ? 'bg-hermes-500 text-white shadow-sm'
                : 'text-surface-400 hover:text-surface-100 hover:bg-surface-700',
            ].join(' ')}
            title={`${opt.label} (${shortcutHints[opt.value]})`}
          >
            <span aria-hidden="true">{opt.icon}</span>
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * ModeIndicator - 单独显示当前模式徽章
 */
export const ModeIndicator: React.FC<{
  mode: HermesMode;
  className?: string;
}> = ({ mode, className = '' }) => {
  const opt = MODE_OPTIONS.find((o) => o.value === mode);
  if (!opt) return null;
  return (
    <span
      data-testid="mode-indicator"
      data-mode={mode}
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-surface-800 text-surface-300',
        className,
      ].join(' ')}
    >
      <span aria-hidden="true">{opt.icon}</span>
      <span>{opt.label}</span>
    </span>
  );
};

export default ModeToggle;
