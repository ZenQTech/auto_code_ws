/**
 * # ============================================================
 * SlashCommandHelp - Slash Commands 帮助面板 (v1.0.0) - Cycle 8 P0-12
 * # ============================================================
 * 核心作用：以弹窗形式显示所有可用 Slash Commands 的分类列表
 * 触发：用户执行 `/help` 命令时弹出
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

import React, { useEffect, useCallback } from 'react';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { useSlashCommandHistory } from '../hooks/useSlashCommandExecutor';
import {
  EXECUTION_STATUS_ICONS,
  formatDuration,
} from '../hooks/slashCommandShared';

// ============================================================
// Props
// ============================================================

export interface SlashCommandHelpProps {
  /** 关闭回调 */
  onClose: () => void;
}

// ============================================================
// 主组件
// ============================================================

export const SlashCommandHelp: React.FC<SlashCommandHelpProps> = ({ onClose }) => {
  const { commands, byCategory, loading, error, refetch } = useSlashCommands();
  const { history } = useSlashCommandHistory({ limit: 20 });

  // Esc 键关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/40 backdrop-blur-md p-4"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl
                   max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-hermes-500 to-blue-500
                        text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h2 className="text-lg font-bold">Slash Commands</h2>
              <p className="text-xs text-white/80">
                {commands.length} 个可用命令 · 输入 / 触发选择器
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white hover:bg-white/10
                       rounded-lg p-1.5 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="text-center py-8 text-surface-500">
              加载命令列表中...
            </div>
          )}
          {error && (
            <div className="text-center py-8 text-red-500">
              加载失败: {error.message}
              <button
                onClick={refetch}
                className="ml-3 text-hermes-600 hover:text-hermes-700 underline"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {byCategory.map((cat) => (
                <div key={cat.name} className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-bold text-surface-800">
                      {cat.label}
                    </h3>
                    <span className="text-xs text-surface-500">
                      ({cat.total})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {cat.commands.map((cmd) => (
                      <div
                        key={cmd.name}
                        className="flex items-start gap-3 px-3 py-2
                                   hover:bg-surface-50 rounded-lg transition-colors"
                      >
                        <span className="text-lg flex-shrink-0 mt-0.5">
                          {cmd.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-sm font-mono font-semibold
                                             text-hermes-700 bg-hermes-50 px-2 py-0.5 rounded">
                              /{cmd.name}
                            </code>
                            {cmd.aliases.length > 0 && (
                              <span className="text-xs text-surface-400">
                                别名: {cmd.aliases.join(', ')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-surface-600 mt-0.5">
                            {cmd.description}
                          </p>
                          {cmd.args.length > 0 && (
                            <div className="mt-1 text-xs text-surface-500">
                              {cmd.args.map((arg) => (
                                <span key={arg.name} className="mr-2">
                                  <code className="text-hermes-600">
                                    {arg.name}
                                  </code>
                                  {arg.required && <span className="text-red-500">*</span>}
                                  {arg.choices && (
                                    <span className="text-surface-400">
                                      {' '}({arg.choices.join('|')})
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* History */}
              {history.length > 0 && (
                <div className="mt-6 pt-6 border-t border-surface-200">
                  <h3 className="text-sm font-bold text-surface-800 mb-2 flex items-center gap-2">
                    <span>📜</span>
                    最近执行历史
                    <span className="text-xs text-surface-500">({history.length})</span>
                  </h3>
                  <div className="space-y-1">
                    {history.map((h, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-1.5
                                   bg-surface-50 rounded text-xs"
                      >
                        <span>{EXECUTION_STATUS_ICONS[h.status]}</span>
                        <code className="font-mono text-hermes-700">
                          /{h.command}
                        </code>
                        <span className="text-surface-600 flex-1 truncate">
                          {h.message}
                        </span>
                        <span className="text-surface-400 text-[10px]">
                          {formatDuration(h.duration_ms)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-surface-50 border-t border-surface-200
                        text-xs text-surface-500 flex items-center justify-between">
          <span>提示: 在输入框输入 <code className="font-mono">/</code> 即可触发命令选择器</span>
          <button
            onClick={onClose}
            className="text-hermes-600 hover:text-hermes-700 font-medium"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlashCommandHelp;
