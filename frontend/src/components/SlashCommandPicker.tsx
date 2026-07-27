/**
 * # ============================================================
 * SlashCommandPicker - Slash Command 选择器 (v1.0.0) - Cycle 8 P0-12
 * # ============================================================
 * 核心作用：浮动下拉式命令选择器 UI
 * 触发：用户在输入框输入 `/` 时自动弹出
 * 交互：
 *   - 输入框持续输入时实时过滤命令
 *   - 键盘上下选择 / Enter 执行 / Esc 关闭
 *   - 点击命令项直接执行
 *   - 分类分组显示
 *
 * Props：
 *   - inputValue: 当前输入值
 *   - onInputChange: 输入变化回调
 *   - onExecute: 执行命令回调（参数：command, args）
 *   - onClose: 关闭选择器回调
 *   - commands: 可用命令列表（来自 useSlashCommands）
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  useSlashCommands,
  useSlashCommandSearch,
  CATEGORY_LABELS,
  type SlashCommand,
  type SlashCommandCategory,
} from '../hooks/useSlashCommands';
import { extractCommandPrefix } from '../utils/slashCommandParser';

// ============================================================
// Props
// ============================================================

export interface SlashCommandPickerProps {
  /** 当前输入框的值 */
  inputValue: string;
  /** 是否显示选择器（默认根据 inputValue 自动判断） */
  forceShow?: boolean;
  /** 命令列表（可选；不传则使用 useSlashCommands 加载） */
  commands?: SlashCommand[];
  /** 执行命令回调 */
  onExecute: (command: string, args: string[]) => void;
  /** 关闭选择器回调 */
  onClose: () => void;
  /** 自定义类名 */
  className?: string;
}

// ============================================================
// 主组件
// ============================================================

export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
  inputValue,
  forceShow = false,
  commands: propCommands,
  onExecute,
  onClose,
  className = '',
}) => {
  // 加载命令列表
  const fallback = useSlashCommands({ autoFetch: !propCommands });
  const commands = propCommands || fallback.commands;

  // 提取命令前缀
  const prefix = useMemo(() => extractCommandPrefix(inputValue), [inputValue]);

  // 搜索命令
  const { results } = useSlashCommandSearch(commands, { debounceMs: 100 });

  // 当前显示的命令（按过滤后的 prefix 过滤）
  const filtered = useMemo(() => {
    if (!prefix) return results;
    return results.filter((c) => c.name.toLowerCase().startsWith(prefix));
  }, [results, prefix]);

  // 按分类分组
  const grouped = useMemo(() => {
    const groups: Record<string, SlashCommand[]> = {};
    for (const cmd of filtered) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filtered]);

  // 扁平化所有命令（用于键盘导航）
  const flatList = useMemo(() => filtered, [filtered]);

  // 选中索引
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // 当 filtered 变化时，重置 selectedIndex
  useEffect(() => {
    setSelectedIndex(0);
  }, [prefix, filtered.length]);

  // 是否显示
  const isVisible = useMemo(() => {
    if (forceShow) return commands.length > 0;
    // 仅在输入以 / 开头时显示
    return inputValue.startsWith('/') && commands.length > 0;
  }, [inputValue, forceShow, commands.length]);

  // 键盘事件
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && flatList.length > 0) {
        e.preventDefault();
        const cmd = flatList[selectedIndex];
        if (cmd) {
          onExecute(cmd.name, []);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isVisible, flatList, selectedIndex, onExecute, onClose]);

  // 滚动选中项到可见区域
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // 处理点击
  const handleClick = useCallback(
    (cmd: SlashCommand) => {
      onExecute(cmd.name, []);
      onClose();
    },
    [onExecute, onClose]
  );

  if (!isVisible) return null;

  // 找出当前选中项在哪个分类
  let globalIdx = 0;

  return (
    <div
      className={`absolute z-50 left-0 right-0 bottom-full mb-2
                  bg-white rounded-xl shadow-2xl border border-surface-200
                  max-h-80 overflow-hidden flex flex-col
                  animate-in fade-in slide-in-from-bottom-2 duration-150
                  ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-hermes-50 to-blue-50
                      border-b border-surface-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-semibold text-surface-800">
            Slash Commands
          </span>
          {prefix && (
            <span className="text-xs text-hermes-600 font-mono">
              /{prefix}
            </span>
          )}
        </div>
        <div className="text-xs text-surface-500">
          ↑↓ 选择 · Enter 执行 · Esc 关闭
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1">
        {flatList.length === 0 ? (
          <div className="px-6 py-8 text-center text-surface-500 text-sm">
            <div className="text-3xl mb-2">🔍</div>
            没有匹配的命令
            <div className="mt-1 text-xs">尝试其他关键词</div>
          </div>
        ) : (
          Object.entries(grouped).map(([cat, cmds]) => (
            <div key={cat} className="py-1">
              <div className="px-4 py-1 text-xs font-semibold text-surface-500
                              uppercase tracking-wide bg-surface-50">
                {CATEGORY_LABELS[cat as SlashCommandCategory] || cat}
              </div>
              {cmds.map((cmd) => {
                const isSelected = globalIdx === selectedIndex;
                const idx = globalIdx;
                globalIdx++;
                return (
                  <button
                    key={cmd.name}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    onClick={() => handleClick(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full px-4 py-2 flex items-center gap-3
                               text-left transition-colors
                               ${isSelected
                                 ? 'bg-hermes-50 border-l-2 border-hermes-500'
                                 : 'hover:bg-surface-50 border-l-2 border-transparent'}`}
                  >
                    <span className="text-lg w-6 text-center flex-shrink-0">
                      {cmd.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono font-semibold
                                         text-hermes-700">
                          /{cmd.name}
                        </code>
                        {cmd.aliases.length > 0 && (
                          <span className="text-xs text-surface-400">
                            ({cmd.aliases.join(', ')})
                          </span>
                        )}
                        {cmd.args.length > 0 && (
                          <span className="text-xs text-surface-400">
                            [{cmd.args.map((a) => a.name).join(' ')}]
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-surface-600 truncate">
                        {cmd.description}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="text-hermes-500 text-sm flex-shrink-0">
                        ↵
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 bg-surface-50 border-t border-surface-200
                      text-xs text-surface-500 flex items-center justify-between">
        <span>共 {flatList.length} 个命令</span>
        <span className="font-mono">v1.0.0 · Cycle 8 P0-12</span>
      </div>
    </div>
  );
};

export default SlashCommandPicker;
