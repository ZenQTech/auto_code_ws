/**
 * # ============================================================
 * ToolsMatrixPanel - 工具矩阵面板 (v1.0.0)
 * Cycle 60 G60-2.2
 * # ============================================================
 * 核心作用：Solo 模式右侧工具矩阵，集中展示 47 个 panel 入口
 * 运行流程：
 *   1. 接收 modals 控制器（useModals 返回）
 *   2. 分类显示：Vibe / Loop / Plan / MCP / Memory / Settings
 *   3. 点击图标切换对应 panel 显隐
 *   4. Auto-Follow 状态徽章
 * 设计要点：
 *   - 6 大类目分组 + 紧凑网格
 *   - 关键 panel 高亮（Vibe / Plan / Loop / AutoFollow）
 *   - 暗色/亮色主题适配
 * 输入参数：{ modals, autoFollow, onOpenAll? }
 * 输出结果：右侧工具矩阵 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.2 初次创建
 * ============================================================
 */

import React from 'react';
import type { UseModalsResult } from '../hooks/useModals';
import type { UseAutoFollowResult } from '../hooks/useAutoFollow';

// ============================================================
// 类型
// ============================================================

export interface ToolsMatrixPanelProps {
  modals: UseModalsResult;
  autoFollow?: UseAutoFollowResult;
}

interface ToolItem {
  key: keyof UseModalsResult;
  label: string;
  emoji: string;
  category: 'vibe' | 'loop' | 'plan' | 'mcp' | 'memory' | 'settings';
  /** 是否核心 panel（高亮） */
  highlight?: boolean;
}

interface ToolCategory {
  id: ToolItem['category'];
  label: string;
  items: ToolItem[];
}

// ============================================================
// 工具清单（精选 12 个高频 panel，避免一次性展示 47 个）
// ============================================================

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'vibe',
    label: 'Vibe 工具',
    items: [
      { key: 'vibeCoding', label: 'Vibe Coding', emoji: '🌊', category: 'vibe', highlight: true },
      { key: 'planExecutor', label: 'Plan 执行', emoji: '📋', category: 'vibe', highlight: true },
      { key: 'loopState', label: 'Loop 状态', emoji: '🔁', category: 'vibe', highlight: true },
      { key: 'autoFollow', label: 'Auto-Follow', emoji: '🎯', category: 'vibe', highlight: true },
    ],
  },
  {
    id: 'plan',
    label: '计划与编辑',
    items: [
      { key: 'planEditor', label: 'Plan Editor', emoji: '✏️', category: 'plan' },
      { key: 'fileExplorer', label: '文件浏览器', emoji: '📁', category: 'plan' },
      { key: 'compaction', label: '压缩', emoji: '🗜️', category: 'plan' },
      { key: 'dualCompaction', label: '双压缩', emoji: '🗜️', category: 'plan' },
    ],
  },
  {
    id: 'loop',
    label: 'Loop 工程',
    items: [
      { key: 'loopV7', label: 'Loop V7', emoji: '⚙️', category: 'loop' },
      { key: 'hooks', label: 'Hooks', emoji: '🪝', category: 'loop' },
      { key: 'hookChain', label: 'Hook 链路', emoji: '🔗', category: 'loop' },
      { key: 'traceRule', label: 'Trace 规则', emoji: '🛰️', category: 'loop' },
    ],
  },
  {
    id: 'mcp',
    label: 'MCP 集成',
    items: [
      { key: 'mcpRegistry', label: 'MCP 注册表', emoji: '📦', category: 'mcp' },
      { key: 'mcpIntegrated', label: 'MCP Agent', emoji: '🤖', category: 'mcp' },
      { key: 'mcpRag', label: 'MCP × RAG', emoji: '🔎', category: 'mcp' },
      { key: 'mcpE2E', label: 'MCP E2E', emoji: '🧪', category: 'mcp' },
    ],
  },
  {
    id: 'memory',
    label: '记忆与历史',
    items: [
      { key: 'subagentMemory', label: 'SubAgent 记忆', emoji: '🧠', category: 'memory' },
      { key: 'sessionRollout', label: 'Session Rollout', emoji: '📜', category: 'memory' },
      { key: 'cacheStats', label: '缓存统计', emoji: '📊', category: 'memory' },
      { key: 'multiAgentTree', label: '多 Agent 树', emoji: '🌳', category: 'memory' },
    ],
  },
  {
    id: 'settings',
    label: '设置',
    items: [
      { key: 'settings', label: '设置', emoji: '⚙️', category: 'settings' },
      { key: 'rules', label: '规则', emoji: '📐', category: 'settings' },
      { key: 'usage', label: '用量', emoji: '📈', category: 'settings' },
      { key: 'streamList', label: '流式网关', emoji: '🌊', category: 'settings' },
    ],
  },
];

// ============================================================
// 组件
// ============================================================

export const ToolsMatrixPanel: React.FC<ToolsMatrixPanelProps> = ({ modals, autoFollow }) => {
  return (
    <aside
      className="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-color)]"
      data-testid="tools-matrix-panel"
    >
      <header className="px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">工具矩阵</h3>
          {autoFollow && (
            <span
              className={[
                'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
                autoFollow.enabled
                  ? 'bg-hermes-100 text-hermes-700'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
              ].join(' ')}
              data-testid="auto-follow-badge"
            >
              <span className={autoFollow.enabled ? 'pulse-pulse' : ''}>🎯</span>
              <span>{autoFollow.enabled ? 'ON' : 'OFF'}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Solo 模式 24 个核心工具</p>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {TOOL_CATEGORIES.map((cat) => (
          <section key={cat.id} data-testid={`tools-cat-${cat.id}`}>
            <h4 className="text-xs font-medium text-[var(--text-tertiary)] mb-2 px-1">
              {cat.label}
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {cat.items.map((tool) => {
                const controller = modals[tool.key] as
                  | { open: boolean; onToggle: () => void; onOpen: () => void; onClose: () => void }
                  | undefined;
                const isOpen = controller?.open ?? false;
                return (
                  <button
                    key={tool.key}
                    type="button"
                    onClick={() => controller?.onToggle()}
                    disabled={!controller}
                    className={[
                      'flex flex-col items-center justify-center p-2 rounded-md',
                      'text-xs transition-all duration-150 ease-material',
                      'focus:outline-none focus:ring-2 focus:ring-hermes-500',
                      'active:scale-[0.97]',
                      isOpen
                        ? 'bg-hermes-500/15 text-hermes-700 border border-hermes-500/40'
                        : tool.highlight
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-hermes-500/40'
                        : 'bg-[var(--bg-elevated)]/60 text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
                    ].join(' ')}
                    data-testid={`tool-${String(tool.key)}`}
                    aria-pressed={isOpen}
                    title={tool.label}
                  >
                    <span className="text-lg mb-0.5">{tool.emoji}</span>
                    <span className="truncate w-full text-center text-[10px]">
                      {tool.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="p-3 border-t border-[var(--border-color)]">
        <button
          type="button"
          onClick={() => modals.closeAll()}
          className="w-full text-xs px-2 py-1.5 rounded text-[var(--text-tertiary)]
                     hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]
                     transition-colors"
          data-testid="tools-close-all"
        >
          关闭所有面板
        </button>
      </footer>
    </aside>
  );
};

export default ToolsMatrixPanel;
