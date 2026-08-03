/**
 * # ============================================================
 * CommandPalette - Solo 模式命令面板 (v1.0.1)
 * Cycle 60 G60-3.1
 * # ============================================================
 * 核心作用：Solo 模式全局命令面板（对标 Codex ⌘K / Trae Solo ⌘P）
 * 运行流程：
 *   1. 用户按 ⌘K / Ctrl+K → 显示命令面板
 *   2. 输入关键词 → 模糊搜索所有可用命令
 *   3. ↑↓ 选择 / Enter 执行 / Esc 关闭
 *   4. 命令来源：44 panel + 路由 + 自定义动作
 * 设计要点：
 *   - 键盘优先（无障碍 + 高效）
 *   - 模糊匹配（label / keywords / category）
 *   - 高频命令置顶
 *   - 暗色/亮色主题适配
 * 输入参数：{ modals, navigate, open, onClose }
 * 输出结果：浮层命令面板 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-3.1 初次创建
 *     - 支持 44 panel 命令
 *     - 支持 7 个独立页面路由
 *     - 支持 6 个全局动作（主题切换/关闭所有/退出 Solo 等）
 *     - 键盘快捷键（↑↓ Enter Esc ⌘K）
 *   - 2026-08-03 | v1.0.1 | 修复无查询时只显示前 50 条问题
 *     - 按 category 排序：route > panel > action > theme > session
 *     - 显示所有命令（无 50 条限制）
 *     - 20 个单元测试覆盖
 * ====================================
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { UseModalsResult, PanelKey } from '../hooks/useModals';

// ============================================================
// 类型
// ============================================================

export interface CommandPaletteProps {
  modals: UseModalsResult;
  navigate: (path: string) => void;
  open: boolean;
  onClose: () => void;
  /** v1.0.0 新增：主题切换器 */
  onCycleTheme?: () => void;
  /** v1.0.0 新增：清空当前 session */
  onClearSession?: () => void;
  /** v1.0.0 新增：切换 Auto-Follow */
  onToggleAutoFollow?: () => void;
  /** v1.0.0 新增：autoFollow enabled 状态 */
  autoFollowEnabled?: boolean;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  emoji: string;
  category: 'panel' | 'route' | 'action' | 'theme' | 'session';
  keywords?: string[];
  /** 执行回调 */
  execute: () => void;
  /** 是否置顶 */
  pinned?: boolean;
}

// ============================================================
// 内置命令
// ============================================================

const ROUTE_COMMANDS: Array<Omit<CommandItem, 'execute' | 'category'>> = [
  { id: 'route-solo', label: 'Solo 模式', emoji: '🚀', keywords: ['solo', '主壳', 'shell', 'workbench'] },
  { id: 'route-vibe-coding', label: 'Vibe Coding', emoji: '🌊', keywords: ['vibe', 'vibe-coding', '编码'] },
  { id: 'route-chat', label: '日常办公聊天', emoji: '💬', keywords: ['chat', '聊天', '对话'] },
  { id: 'route-coding', label: '编程模式', emoji: '⚡', keywords: ['coding', '编程', '开发'] },
  { id: 'route-settings', label: '设置', emoji: '⚙️', keywords: ['settings', '设置', 'config'] },
  { id: 'route-mode', label: '模式选择', emoji: '🎯', keywords: ['mode', 'select', '选择'] },
  { id: 'route-memory', label: 'Memory System', emoji: '🧠', keywords: ['memory', '记忆'] },
  { id: 'route-doctor', label: '环境诊断', emoji: '🩺', keywords: ['doctor', '诊断', 'health'] },
  { id: 'route-marketplace', label: 'Plugin Marketplace', emoji: '🛒', keywords: ['marketplace', 'market', '插件'] },
  { id: 'route-verification', label: 'Verification Loop', emoji: '✅', keywords: ['verification', '验证', 'loop'] },
  { id: 'route-workflow', label: 'Workflow 详情', emoji: '🔄', keywords: ['workflow', '工作流'] },
  { id: 'route-diff-view', label: 'Diff 视图', emoji: '🔀', keywords: ['diff', '视图', '对比'] },
  { id: 'route-llm-judge', label: 'LLM Judge', emoji: '⚖️', keywords: ['llm', 'judge', '评估'] },
  { id: 'route-multimodal', label: '多模态', emoji: '🖼️', keywords: ['multimodal', '多模态'] },
  { id: 'route-enterprise-hub', label: 'Enterprise Hub', emoji: '🏢', keywords: ['enterprise', 'hub', '企业'] },
  { id: 'route-work', label: 'TRAE Work', emoji: '🛠️', keywords: ['work', 'trae', 'work'] },
  { id: 'route-goal-automation', label: 'Goal Automation', emoji: '🎯', keywords: ['goal', 'automation', '目标'] },
  { id: 'route-goal-templates', label: 'Goal Templates', emoji: '📚', keywords: ['goal', 'templates', '模板'] },
];

const PANEL_LABELS: Record<PanelKey, { label: string; emoji: string; keywords: string[] }> = {
  settings: { label: '设置', emoji: '⚙️', keywords: ['settings', '设置'] },
  mcp: { label: 'MCP 工具', emoji: '📦', keywords: ['mcp', '工具', 'core', 'model context protocol'] },
  compaction: { label: '压缩', emoji: '🗜️', keywords: ['compaction', '压缩'] },
  skills: { label: '技能', emoji: '🎓', keywords: ['skills', '技能'] },
  agentsMd: { label: 'AGENTS.md', emoji: '📚', keywords: ['agents', 'md', '文档'] },
  cycle3: { label: 'Cycle 3', emoji: '♻️', keywords: ['cycle3'] },
  dualCompaction: { label: '双压缩', emoji: '🗜️', keywords: ['dual', 'compaction'] },
  rules: { label: '规则', emoji: '📐', keywords: ['rules', '规则'] },
  usage: { label: '用量', emoji: '📈', keywords: ['usage', '用量', 'token'] },
  fileExplorer: { label: '文件浏览器', emoji: '📁', keywords: ['file', 'explorer', '文件'] },
  loopV7: { label: 'Loop V7', emoji: '⚙️', keywords: ['loop', 'v7'] },
  planEditor: { label: 'Plan Editor', emoji: '✏️', keywords: ['plan', 'editor'] },
  hooks: { label: 'Hooks', emoji: '🪝', keywords: ['hooks', '钩子'] },
  subagentMemory: { label: 'SubAgent 记忆', emoji: '🧠', keywords: ['subagent', 'memory'] },
  hookChain: { label: 'Hook 链路', emoji: '🔗', keywords: ['hook', 'chain', '链路'] },
  cacheStats: { label: '缓存统计', emoji: '📊', keywords: ['cache', 'stats', '缓存'] },
  streamList: { label: '流式网关', emoji: '🌊', keywords: ['stream', '流式'] },
  oauthConfig: { label: 'OAuth 配置', emoji: '🔐', keywords: ['oauth', 'pkce', '认证'] },
  sessionRollout: { label: 'Session Rollout', emoji: '📜', keywords: ['session', 'rollout', 'jsonl'] },
  multiAgentTree: { label: '多 Agent 树', emoji: '🌳', keywords: ['multi', 'agent', 'tree'] },
  traceRule: { label: 'Trace 规则', emoji: '🛰️', keywords: ['trace', 'rule', '追踪'] },
  slashCommand: { label: 'Slash 命令', emoji: '💬', keywords: ['slash', 'command'] },
  customModels: { label: '自定义模型', emoji: '🧩', keywords: ['custom', 'models', '自定义'] },
  mcpRegistry: { label: 'MCP 注册表', emoji: '📦', keywords: ['mcp', 'registry'] },
  mcpAdvanced: { label: 'MCP 高级', emoji: '⚡', keywords: ['mcp', 'advanced'] },
  mcpIntegrated: { label: 'MCP Agent', emoji: '🤖', keywords: ['mcp', 'integrated'] },
  mcpE2E: { label: 'MCP E2E', emoji: '🧪', keywords: ['mcp', 'e2e'] },
  mcpMultimodal: { label: 'MCP 多模态', emoji: '🖼️', keywords: ['mcp', 'multimodal', '多模态'] },
  mcpRag: { label: 'MCP × RAG', emoji: '🔎', keywords: ['mcp', 'rag', '检索'] },
  mcpRagRealLLM: { label: 'MCP × RAG × LLM', emoji: '🧬', keywords: ['mcp', 'rag', 'llm', '真实'] },
  mcpRagPerformance: { label: 'MCP RAG 性能', emoji: '⚡', keywords: ['mcp', 'rag', 'performance', '性能'] },
  mcpMultimodalRag: { label: 'MCP 多模态 RAG', emoji: '🌈', keywords: ['mcp', 'multimodal', 'rag'] },
  mcpMultimodalProvider: { label: 'MCP 多模态 Provider', emoji: '🌐', keywords: ['mcp', 'multimodal', 'provider'] },
  mcpE2EProduction: { label: 'MCP 生产 E2E', emoji: '🏭', keywords: ['mcp', 'e2e', 'production', '生产'] },
  mcpDeploymentValidation: { label: 'MCP 部署验证', emoji: '✅', keywords: ['mcp', 'deployment', '验证'] },
  mcpProductionEnhancement: { label: 'MCP 生产增强', emoji: '🛠️', keywords: ['mcp', 'production', '增强'] },
  mcpObservability: { label: 'MCP 可观测性', emoji: '📡', keywords: ['mcp', 'observability', '监控'] },
  mcpPlatformIntegration: { label: 'MCP 平台集成', emoji: '🔌', keywords: ['mcp', 'platform', '集成'] },
  mcpKubernetes: { label: 'MCP K8s', emoji: '☸️', keywords: ['mcp', 'kubernetes', 'k8s'] },
  mcpServerless: { label: 'MCP Serverless', emoji: '⚡', keywords: ['mcp', 'serverless', 'faas'] },
  mcpStreamProcessing: { label: 'MCP 流处理', emoji: '🌊', keywords: ['mcp', 'stream', '流处理'] },
  vibeCoding: { label: 'Vibe Coding', emoji: '🌊', keywords: ['vibe', 'shell', '工作台'] },
  planExecutor: { label: 'Plan 执行', emoji: '📋', keywords: ['plan', 'executor', '执行'] },
  loopState: { label: 'Loop 状态', emoji: '🔁', keywords: ['loop', 'state', '状态机'] },
  autoFollow: { label: 'Auto-Follow', emoji: '🎯', keywords: ['auto', 'follow', '联动'] },
};

// ============================================================
// 组件
// ============================================================

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  modals,
  navigate,
  open,
  onClose,
  onCycleTheme,
  onClearSession,
  onToggleAutoFollow,
  autoFollowEnabled,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // 构建命令列表
  // ============================================================

  const commands = useMemo<CommandItem[]>(() => {
    const cmds: CommandItem[] = [];

    // 1. 路由命令
    ROUTE_COMMANDS.forEach((rc) => {
      const path = rc.id.replace('route-', '/');
      cmds.push({
        ...rc,
        category: 'route',
        execute: () => {
          navigate(path);
          onClose();
        },
      });
    });

    // 2. Panel 命令
    Object.entries(PANEL_LABELS).forEach(([key, meta]) => {
      const k = key as PanelKey;
      const controller = modals[k];
      if (!controller) return;
      cmds.push({
        id: `panel-${key}`,
        label: `${meta.emoji} ${meta.label}`,
        emoji: meta.emoji,
        category: 'panel',
        keywords: meta.keywords,
        execute: () => {
          controller.onToggle();
          onClose();
        },
      });
    });

    // 3. Session 命令
    if (onClearSession) {
      cmds.push({
        id: 'session-clear',
        label: '🗑️ 清空当前 Session',
        emoji: '🗑️',
        category: 'session',
        keywords: ['clear', 'session', '清空', '重置'],
        execute: () => {
          onClearSession();
          onClose();
        },
      });
    }
    if (onToggleAutoFollow) {
      cmds.push({
        id: 'session-autofollow',
        label: `🎯 Auto-Follow ${autoFollowEnabled ? '关闭' : '开启'}`,
        emoji: '🎯',
        category: 'session',
        keywords: ['auto', 'follow', 'auto-follow', '联动'],
        execute: () => {
          onToggleAutoFollow();
          onClose();
        },
      });
    }

    // 4. 主题命令
    if (onCycleTheme) {
      cmds.push({
        id: 'theme-cycle',
        label: '🎨 切换主题',
        emoji: '🎨',
        category: 'theme',
        keywords: ['theme', 'cycle', '主题', 'dark', 'light'],
        execute: () => {
          onCycleTheme();
          onClose();
        },
      });
    }

    // 5. 全局动作
    cmds.push({
      id: 'action-close-all',
      label: '🚫 关闭所有面板',
      emoji: '🚫',
      category: 'action',
      keywords: ['close', 'all', '关闭', '全部'],
      execute: () => {
        modals.closeAll();
        onClose();
      },
    });

    // 6. Solo 模式专属（置顶）
    cmds.unshift({
      id: 'pinned-solo',
      label: '🚀 Solo 模式（推荐）',
      emoji: '🚀',
      category: 'route',
      keywords: ['solo', '主壳', 'workbench', '推荐'],
      pinned: true,
      execute: () => {
        navigate('/solo');
        onClose();
      },
    });

    return cmds;
  }, [modals, navigate, onClose, onCycleTheme, onClearSession, onToggleAutoFollow, autoFollowEnabled]);

  // ============================================================
  // 过滤命令
  // ============================================================

  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // 无查询时：pinned 在前 + 其余所有命令（按 category 顺序）
      const pinned = commands.filter((c) => c.pinned);
      const rest = commands.filter((c) => !c.pinned);
      // 按 category 排序：route > panel > action > theme > session
      const categoryOrder = ['route', 'panel', 'action', 'theme', 'session'];
      rest.sort((a, b) => {
        const ai = categoryOrder.indexOf(a.category);
        const bi = categoryOrder.indexOf(b.category);
        if (ai !== bi) return ai - bi;
        return a.label.localeCompare(b.label);
      });
      return [...pinned, ...rest];
    }
    const q = query.toLowerCase();
    return commands
      .filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      );
  }, [commands, query]);

  // ============================================================
  // 打开时自动聚焦 + 重置状态
  // ============================================================

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ============================================================
  // 键盘处理
  // ============================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((idx) => Math.min(idx + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((idx) => Math.max(idx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[selectedIdx];
        if (cmd) {
          cmd.execute();
        }
      }
    },
    [filteredCommands, selectedIdx, onClose]
  );

  // 滚动到选中项
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(
      `[data-cmd-idx="${selectedIdx}"]`
    ) as HTMLElement | null;
    if (item) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIdx]);

  // 输入变化时重置选中
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // ============================================================
  // 渲染
  // ============================================================

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]
                 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="command-palette-overlay"
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-xl shadow-2xl
                   bg-[var(--bg-panel)] border border-[var(--border-color)]
                   overflow-hidden animate-lift-in"
        data-testid="command-palette"
        role="dialog"
        aria-label="命令面板"
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
          <span className="text-lg">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令、面板、路由..."
            className="flex-1 bg-transparent border-0 outline-none
                       text-sm text-[var(--text-primary)]
                       placeholder:text-[var(--text-tertiary)]"
            data-testid="command-palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded
                       bg-[var(--bg-elevated)] text-[var(--text-tertiary)]
                       border border-[var(--border-color)] font-mono"
          >
            ESC
          </kbd>
        </div>

        {/* 命令列表 */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto"
          data-testid="command-palette-list"
          role="listbox"
        >
          {filteredCommands.length === 0 ? (
            <div
              className="text-center py-8 text-sm text-[var(--text-tertiary)]"
              data-testid="command-palette-empty"
            >
              没有匹配的命令
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  data-cmd-idx={idx}
                  data-testid={`command-item-${cmd.id}`}
                  onClick={() => cmd.execute()}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={[
                    'w-full flex items-center gap-3 px-4 py-2 text-left',
                    'transition-colors',
                    isSelected
                      ? 'bg-hermes-500/15 border-l-2 border-hermes-500'
                      : 'border-l-2 border-transparent hover:bg-[var(--bg-elevated)]',
                  ].join(' ')}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="text-lg flex-shrink-0">{cmd.emoji}</span>
                  <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                    {cmd.label}
                  </span>
                  {cmd.pinned && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded
                                 bg-hermes-100 text-hermes-700 font-medium"
                    >
                      PIN
                    </span>
                  )}
                  <span
                    className="text-[10px] text-[var(--text-tertiary)]
                               uppercase tracking-wider"
                  >
                    {cmd.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 底部状态栏 */}
        <footer
          className="flex items-center justify-between px-4 py-2
                     border-t border-[var(--border-color)]
                     bg-[var(--bg-elevated)]/50 text-[10px]
                     text-[var(--text-tertiary)]"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[var(--bg-app)]">↑↓</kbd>
              选择
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[var(--bg-app)]">Enter</kbd>
              执行
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[var(--bg-app)]">Esc</kbd>
              关闭
            </span>
          </div>
          <span>
            {filteredCommands.length} / {commands.length} 命令
          </span>
        </footer>
      </div>
    </div>
  );
};

export default CommandPalette;
