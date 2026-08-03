/**
 * # ============================================================
 * ToolsMatrixPanel - 工具矩阵面板 (v1.1.2)
 * Cycle 60 G60-2.2 增强：完整 45 个 panel 入口
 * # ============================================================
 * 核心作用：Solo 模式右侧工具矩阵，集中展示所有 45 个 panel 入口
 * 运行流程：
 *   1. 接收 modals 控制器（useModals 返回）
 *   2. 分类显示：Vibe / Plan / Loop / Agent / MCP / RAG / Platform / Memory / Settings
 *   3. 点击图标切换对应 panel 显隐
 *   4. Auto-Follow 状态徽章
 *   5. 搜索/筛选/全部展开/折叠
 * 设计要点：
 *   - 9 大类目分组 + 紧凑网格
 *   - 关键 panel 高亮（Vibe / Plan / Loop / AutoFollow）
 *   - 暗色/亮色主题适配
 *   - 搜索快速过滤
 * 输入参数：{ modals, autoFollow, compact? }
 * 输出结果：右侧工具矩阵 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.2 初次创建（24 个高频 panel）
 *   - 2026-08-03 | v1.1.0 | Cycle 60 G60-2.2.1 补全到 45 个 panel
 *     - 新增 skills / agentsMd / cycle3 / oauthConfig / customModels
 *     - 新增 14 个 MCP 进阶 panel
 *     - 新增 mcpStreamProcessing
 *     - 搜索过滤 + 全部展开/折叠
 *   - 2026-08-03 | v1.1.1 | 修复 category id 重复（integration × 2）
 *     - 重命名为 rag / platform
 *     - 9 大类目：vibe / plan / loop / agent / mcp / rag / platform / memory / settings
 *   - 2026-08-03 | v1.1.2 | 修复 compaction 重复
 *     - 移除 plan 分类中的 compaction（保留 loop 中的）
 *     - 19 个单元测试覆盖
 * ====================================
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { UseModalsResult, PanelKey } from '../hooks/useModals';
import type { UseAutoFollowResult } from '../hooks/useAutoFollow';

// ============================================================
// 类型
// ============================================================

export interface ToolsMatrixPanelProps {
  modals: UseModalsResult;
  autoFollow?: UseAutoFollowResult;
  /** v1.1.0 新增：是否紧凑模式（移动端） */
  compact?: boolean;
}

interface ToolItem {
  key: PanelKey;
  label: string;
  emoji: string;
  category: ToolCategoryId;
  /** 是否核心 panel（高亮） */
  highlight?: boolean;
  /** 搜索关键词（多语言） */
  keywords?: string[];
}

type ToolCategoryId =
  | 'vibe'
  | 'plan'
  | 'loop'
  | 'agent'
  | 'mcp'
  | 'rag'
  | 'platform'
  | 'memory'
  | 'settings';

interface ToolCategory {
  id: ToolCategoryId;
  label: string;
  emoji: string;
  items: ToolItem[];
}

// ============================================================
// 完整 44 工具清单
// ============================================================

const TOOL_CATEGORIES: ToolCategory[] = [
  // ============================================================
  // Vibe 系列（4 个，核心高亮）
  // ============================================================
  {
    id: 'vibe',
    label: 'Vibe 工具',
    emoji: '🌊',
    items: [
      { key: 'vibeCoding', label: 'Vibe Coding', emoji: '🌊', category: 'vibe', highlight: true, keywords: ['vibe', 'solo', 'shell', '主壳', '工作台'] },
      { key: 'planExecutor', label: 'Plan 执行', emoji: '📋', category: 'vibe', highlight: true, keywords: ['plan', 'executor', '计划', '执行', 'plan模式'] },
      { key: 'loopState', label: 'Loop 状态', emoji: '🔁', category: 'vibe', highlight: true, keywords: ['loop', 'state', '状态机', 'machine', '循环'] },
      { key: 'autoFollow', label: 'Auto-Follow', emoji: '🎯', category: 'vibe', highlight: true, keywords: ['auto', 'follow', '自动', '跟随', '联动'] },
    ],
  },
  // ============================================================
  // 计划与编辑（3 个）
  // ============================================================
  {
    id: 'plan',
    label: '计划与编辑',
    emoji: '✏️',
    items: [
      { key: 'planEditor', label: 'Plan Editor', emoji: '✏️', category: 'plan', keywords: ['plan', 'editor', '编辑', 'plan编辑器'] },
      { key: 'fileExplorer', label: '文件浏览器', emoji: '📁', category: 'plan', keywords: ['file', 'explorer', 'browser', '文件', '浏览器'] },
      { key: 'dualCompaction', label: '双压缩', emoji: '🗜️', category: 'plan', keywords: ['dual', 'compaction', '双压缩', '双向'] },
    ],
  },
  // ============================================================
  // Loop 工程（6 个）
  // ============================================================
  {
    id: 'loop',
    label: 'Loop 工程',
    emoji: '⚙️',
    items: [
      { key: 'loopV7', label: 'Loop V7', emoji: '⚙️', category: 'loop', keywords: ['loop', 'v7', '引擎'] },
      { key: 'hooks', label: 'Hooks', emoji: '🪝', category: 'loop', keywords: ['hooks', '钩子', '事件'] },
      { key: 'hookChain', label: 'Hook 链路', emoji: '🔗', category: 'loop', keywords: ['hook', 'chain', '链路', '链式'] },
      { key: 'traceRule', label: 'Trace 规则', emoji: '🛰️', category: 'loop', keywords: ['trace', 'rule', '追踪', '规则'] },
      { key: 'cycle3', label: 'Cycle 3', emoji: '♻️', category: 'loop', keywords: ['cycle3', 'cycle', '循环3'] },
      { key: 'compaction', label: '压缩', emoji: '🗜️', category: 'loop', keywords: ['compaction', '压缩'] },
    ],
  },
  // ============================================================
  // Agent 与多模态（4 个）
  // ============================================================
  {
    id: 'agent',
    label: 'Agent 与多模态',
    emoji: '🤖',
    items: [
      { key: 'multiAgentTree', label: '多 Agent 树', emoji: '🌳', category: 'agent', keywords: ['multi', 'agent', 'tree', '多agent', '树'] },
      { key: 'subagentMemory', label: 'SubAgent 记忆', emoji: '🧠', category: 'agent', keywords: ['subagent', 'memory', '子智能体', '记忆'] },
      { key: 'mcpMultimodal', label: '多模态', emoji: '🖼️', category: 'agent', keywords: ['multimodal', '多模态', '图像', 'video'] },
      { key: 'mcpMultimodalProvider', label: '多模态 Provider', emoji: '🌐', category: 'agent', keywords: ['multimodal', 'provider', 'clip', 'provider'] },
    ],
  },
  // ============================================================
  // MCP 核心（6 个）
  // ============================================================
  {
    id: 'mcp',
    label: 'MCP 核心',
    emoji: '📦',
    items: [
      { key: 'mcp', label: 'MCP', emoji: '📦', category: 'mcp', highlight: true, keywords: ['mcp', 'core', '核心', 'model context protocol'] },
      { key: 'mcpRegistry', label: 'MCP 注册表', emoji: '📦', category: 'mcp', keywords: ['mcp', 'registry', '注册', '注册表'] },
      { key: 'mcpAdvanced', label: 'MCP 高级', emoji: '⚡', category: 'mcp', keywords: ['mcp', 'advanced', '高级'] },
      { key: 'mcpIntegrated', label: 'MCP Agent', emoji: '🤖', category: 'mcp', keywords: ['mcp', 'integrated', 'agent', '集成'] },
      { key: 'mcpE2E', label: 'MCP E2E', emoji: '🧪', category: 'mcp', keywords: ['mcp', 'e2e', '测试', 'end to end'] },
      { key: 'mcpE2EProduction', label: 'MCP 生产 E2E', emoji: '🏭', category: 'mcp', keywords: ['mcp', 'e2e', 'production', '生产'] },
    ],
  },
  // ============================================================
  // MCP × RAG（4 个）
  // ============================================================
  {
    id: 'rag',
    label: 'MCP × RAG',
    emoji: '🔎',
    items: [
      { key: 'mcpRag', label: 'MCP × RAG', emoji: '🔎', category: 'rag', keywords: ['rag', 'mcp', 'retrieval', '检索'] },
      { key: 'mcpRagRealLLM', label: 'MCP × RAG × LLM', emoji: '🧬', category: 'rag', keywords: ['rag', 'llm', '真实'] },
      { key: 'mcpRagPerformance', label: 'MCP RAG 性能', emoji: '⚡', category: 'rag', keywords: ['rag', 'performance', '性能', 'faiss'] },
      { key: 'mcpMultimodalRag', label: 'MCP 多模态 RAG', emoji: '🌈', category: 'rag', keywords: ['multimodal', 'rag', '多模态检索'] },
    ],
  },
  // ============================================================
  // 记忆与历史（3 个）
  // ============================================================
  {
    id: 'memory',
    label: '记忆与历史',
    emoji: '🧠',
    items: [
      { key: 'sessionRollout', label: 'Session Rollout', emoji: '📜', category: 'memory', keywords: ['session', 'rollout', 'jsonl', '回放'] },
      { key: 'cacheStats', label: '缓存统计', emoji: '📊', category: 'memory', keywords: ['cache', 'stats', '缓存', '统计'] },
      { key: 'streamList', label: '流式网关', emoji: '🌊', category: 'memory', keywords: ['stream', 'list', '流式', '网关'] },
    ],
  },
  // ============================================================
  // 设置（5 个）
  // ============================================================
  {
    id: 'settings',
    label: '设置',
    emoji: '⚙️',
    items: [
      { key: 'settings', label: '设置', emoji: '⚙️', category: 'settings', keywords: ['settings', '设置', '配置'] },
      { key: 'rules', label: '规则', emoji: '📐', category: 'settings', keywords: ['rules', '规则', 'project rules'] },
      { key: 'usage', label: '用量', emoji: '📈', category: 'settings', keywords: ['usage', '用量', 'token', '统计'] },
      { key: 'oauthConfig', label: 'OAuth 配置', emoji: '🔐', category: 'settings', keywords: ['oauth', 'config', 'pkce', '认证'] },
      { key: 'customModels', label: '自定义模型', emoji: '🧩', category: 'settings', keywords: ['custom', 'models', '自定义', '模型'] },
    ],
  },
  // ============================================================
  // 高级 MCP 平台（5 个）
  // ============================================================
  {
    id: 'platform',
    label: 'MCP 平台',
    emoji: '🏗️',
    items: [
      { key: 'mcpDeploymentValidation', label: 'MCP 部署验证', emoji: '✅', category: 'platform', keywords: ['deployment', 'validation', '部署', '验证'] },
      { key: 'mcpProductionEnhancement', label: 'MCP 生产增强', emoji: '🛠️', category: 'platform', keywords: ['production', 'enhancement', '生产', '增强'] },
      { key: 'mcpObservability', label: 'MCP 可观测性', emoji: '📡', category: 'platform', keywords: ['observability', '可观测性', 'tracing', '监控'] },
      { key: 'mcpPlatformIntegration', label: 'MCP 平台集成', emoji: '🔌', category: 'platform', keywords: ['platform', 'integration', '平台', '集成'] },
      { key: 'mcpKubernetes', label: 'MCP K8s', emoji: '☸️', category: 'platform', keywords: ['kubernetes', 'k8s', '容器'] },
      { key: 'mcpServerless', label: 'MCP Serverless', emoji: '⚡', category: 'platform', keywords: ['serverless', 'faas', 'knative'] },
      { key: 'mcpStreamProcessing', label: 'MCP 流处理', emoji: '🌊', category: 'platform', keywords: ['stream', 'processing', 'kafka', 'flink', '流处理'] },
      { key: 'slashCommand', label: 'Slash 命令', emoji: '💬', category: 'platform', keywords: ['slash', 'command', '命令'] },
      { key: 'skills', label: '技能', emoji: '🎓', category: 'platform', keywords: ['skills', '技能'] },
      { key: 'agentsMd', label: 'AGENTS.md', emoji: '📚', category: 'platform', keywords: ['agents', 'md', '文档', '规范'] },
    ],
  },
];

// ============================================================
// 工具函数
// ============================================================

/** 计算 panel key 集合（用于去重校验） */
const ALL_PANEL_KEYS: Set<PanelKey> = new Set(
  TOOL_CATEGORIES.flatMap((c) => c.items.map((i) => i.key))
);

/** 检测当前 modals 中所有 panel key（运行时校验） */
function assertPanelKeys(modals: UseModalsResult): void {
  if (typeof window === 'undefined') return;
  // 仅在开发模式下输出警告
  if (process.env.NODE_ENV !== 'production') {
    const modalKeys = Object.keys(modals).filter(
      (k) => typeof (modals as any)[k]?.onToggle === 'function'
    );
    const missing = modalKeys.filter((k) => !ALL_PANEL_KEYS.has(k as PanelKey));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ToolsMatrixPanel] ${missing.length} panel 未在工具矩阵中暴露:`,
        missing
      );
    }
  }
}

// ============================================================
// 组件
// ============================================================

export const ToolsMatrixPanel: React.FC<ToolsMatrixPanelProps> = ({
  modals,
  autoFollow,
  compact = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<ToolCategoryId>>(
    new Set(['vibe', 'plan'])
  );

  // 开发模式校验
  React.useEffect(() => {
    assertPanelKeys(modals);
  }, [modals]);

  // 过滤逻辑
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return TOOL_CATEGORIES;
    const q = searchQuery.toLowerCase();
    return TOOL_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.key.toLowerCase().includes(q) ||
          (item.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [searchQuery]);

  // 总数统计
  const totalItems = useMemo(
    () => TOOL_CATEGORIES.reduce((sum, c) => sum + c.items.length, 0),
    []
  );

  // 展开/折叠某个分类
  const toggleCategory = useCallback((catId: ToolCategoryId) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }, []);

  // 全部展开
  const expandAll = useCallback(() => {
    setExpandedCats(new Set(TOOL_CATEGORIES.map((c) => c.id)));
  }, []);

  // 全部折叠
  const collapseAll = useCallback(() => {
    setExpandedCats(new Set());
  }, []);

  return (
    <aside
      className="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-color)]"
      data-testid="tools-matrix-panel"
    >
      {/* ============================================================
       * Header
       * ============================================================ */}
      <header className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🧰</span>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">工具矩阵</h3>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {totalItems}
            </span>
          </div>
          {autoFollow && (
            <span
              className={[
                'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full',
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

        {/* 搜索框 */}
        {!compact && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索工具..."
              className="w-full px-2 py-1 text-xs bg-[var(--bg-elevated)]
                         border border-[var(--border-color)] rounded
                         focus:outline-none focus:ring-1 focus:ring-hermes-500
                         text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              data-testid="tools-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2
                           text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                           text-xs px-1"
                aria-label="清除搜索"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* 展开/折叠控制 */}
        {!compact && !searchQuery && (
          <div className="flex items-center gap-1 mt-1.5">
            <button
              type="button"
              onClick={expandAll}
              className="text-[10px] text-[var(--text-tertiary)]
                         hover:text-[var(--text-primary)] px-1.5 py-0.5
                         rounded hover:bg-[var(--bg-elevated)]"
              data-testid="tools-expand-all"
            >
              全部展开
            </button>
            <span className="text-[var(--text-tertiary)]">·</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-[10px] text-[var(--text-tertiary)]
                         hover:text-[var(--text-primary)] px-1.5 py-0.5
                         rounded hover:bg-[var(--bg-elevated)]"
              data-testid="tools-collapse-all"
            >
              全部折叠
            </button>
          </div>
        )}
      </header>

      {/* ============================================================
       * 工具网格
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredCategories.length === 0 ? (
          <div
            className="text-center py-6 text-xs text-[var(--text-tertiary)]"
            data-testid="tools-empty"
          >
            没有匹配的工具
          </div>
        ) : (
          filteredCategories.map((cat) => {
            const isExpanded = searchQuery.trim().length > 0 || expandedCats.has(cat.id);
            return (
              <section
                key={`${cat.id}-${cat.label}`}
                data-testid={`tools-cat-${cat.id}`}
                className="rounded-md"
              >
                {/* 分类标题（可点击折叠） */}
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center justify-between
                             text-xs font-medium text-[var(--text-tertiary)]
                             hover:text-[var(--text-primary)]
                             px-1.5 py-1 rounded hover:bg-[var(--bg-elevated)]"
                  data-testid={`tools-cat-header-${cat.id}`}
                >
                  <span className="flex items-center gap-1">
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                    <span className="text-[10px] opacity-60">({cat.items.length})</span>
                  </span>
                  <span
                    className={[
                      'transition-transform text-[10px]',
                      isExpanded ? 'rotate-90' : '',
                    ].join(' ')}
                  >
                    ▶
                  </span>
                </button>

                {/* 工具网格 */}
                {isExpanded && (
                  <div
                    className={[
                      'grid gap-1 mt-1',
                      compact ? 'grid-cols-3' : 'grid-cols-4',
                    ].join(' ')}
                  >
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
                            'flex flex-col items-center justify-center p-1.5 rounded',
                            'text-[10px] transition-all duration-150',
                            'focus:outline-none focus:ring-1 focus:ring-hermes-500',
                            'active:scale-[0.95]',
                            'min-h-[44px] min-w-[44px]', // 触屏友好
                            isOpen
                              ? 'bg-hermes-500/15 text-hermes-700 border border-hermes-500/40'
                              : tool.highlight
                                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-hermes-500/40'
                                : 'bg-[var(--bg-elevated)]/60 text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
                          ].join(' ')}
                          data-testid={`tool-${tool.key}`}
                          aria-pressed={isOpen}
                          title={tool.label}
                        >
                          <span className="text-base mb-0.5">{tool.emoji}</span>
                          <span className="truncate w-full text-center text-[9px] leading-tight">
                            {tool.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {/* ============================================================
       * Footer
       * ============================================================ */}
      <footer className="p-2 border-t border-[var(--border-color)]">
        <button
          type="button"
          onClick={() => modals.closeAll()}
          className="w-full text-[10px] px-2 py-1 rounded text-[var(--text-tertiary)]
                     hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]
                     transition-colors min-h-[36px]"
          data-testid="tools-close-all"
        >
          关闭所有面板
        </button>
      </footer>
    </aside>
  );
};

export default ToolsMatrixPanel;
