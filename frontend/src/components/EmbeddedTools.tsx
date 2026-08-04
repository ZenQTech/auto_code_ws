/**
 * # ============================================================
 * EmbeddedTools - 内嵌工具矩阵组件 (v1.1.0)
 * Cycle 60+ Solo 重构 - 对标 Trae Solo / Codex 内嵌工具
 * # ============================================================
 * 核心作用：在右栏提供内嵌的工具面板：编辑器、终端、浏览器、代码变更、内存、文件浏览等
 * 设计要点（v1.1.0 G60-FIX-17）：
 *   - Tab 切换：editor / terminal / browser / diff / memory / files
 *   - 内嵌 iframe / 自实现组件
 *   - 与 ToolsMatrixPanel 协同（外层按钮 + 内嵌细节）
 *   - 可折叠/展开
 *   - 状态持久化
 *   - v1.1.0 视觉优化：
 *     - tab 头 h-8 (32px)，与工具栏对齐
 *     - tab 字号 11px
 *     - active tab 使用底部下划线 + 主题色文字，更接近浏览器风格
 *     - tab 之间分隔更清晰（hover 态背景）
 *     - 内容区域 padding 统一
 * 输入参数：
 *   - defaultTab?: EmbeddedTool
 *   - sessionId?: string 当前 session
 *   - onChange?: (tab) => void
 * 输出结果：UI 组件
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Solo 重构 - 初次创建
 *   - 2026-08-04 | v1.1.0 | G60-FIX-17 tab 视觉优化：
 *                                - tab 头高度对齐工具栏 h-8
 *                                - active tab 使用底部下划线（hermes 品牌色）
 *                                - tab 字号 11px
 *                                - emoji 与文字对齐（items-center）
 *                                - hover 态背景更明显
 * ============================================================
 */

import React, { useState } from 'react';

// ============================================================
// 类型
// ====================================

export type EmbeddedTool =
  | 'overview'
  | 'editor'
  | 'terminal'
  | 'browser'
  | 'diff'
  | 'memory'
  | 'files'
  | 'metrics';

export interface EmbeddedToolsProps {
  sessionId?: string | null;
  defaultTab?: EmbeddedTool;
  className?: string;
  'data-testid'?: string;
}

// ============================================================
// Tab 配置
// ====================================

const TOOL_META: Record<EmbeddedTool, { label: string; emoji: string; description: string }> = {
  overview: { label: '概览', emoji: '📊', description: '会话概览 + 关键指标' },
  editor: { label: '编辑器', emoji: '📝', description: '文件编辑器（内嵌）' },
  terminal: { label: '终端', emoji: '⌨️', description: '命令执行终端' },
  browser: { label: '浏览器', emoji: '🌐', description: '内嵌网页浏览器' },
  diff: { label: '代码变更', emoji: '🔀', description: 'Git diff 视图' },
  memory: { label: '记忆', emoji: '🧠', description: 'Memory System' },
  files: { label: '文件', emoji: '📁', description: '文件浏览器' },
  metrics: { label: '指标', emoji: '📈', description: 'Token/耗时/费用指标' },
};

const STORAGE_KEY = 'hermes.solo.embeddedTool';

function readTool(): EmbeddedTool {
  if (typeof window === 'undefined') return 'overview';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && raw in TOOL_META) return raw as EmbeddedTool;
  } catch {
    // 忽略
  }
  return 'overview';
}

// ============================================================
// 子视图
// ====================================

const OverviewView: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="p-3 space-y-3 text-sm" data-testid="embedded-tool-overview">
    <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <div className="text-xs text-[var(--text-secondary)] mb-1">当前 Session</div>
      <div className="font-mono text-xs break-all">
        {sessionId || '未启动'}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="p-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">Tokens</div>
        <div className="text-lg font-semibold">--</div>
      </div>
      <div className="p-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">耗时</div>
        <div className="text-lg font-semibold">--</div>
      </div>
      <div className="p-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">文件变更</div>
        <div className="text-lg font-semibold">--</div>
      </div>
      <div className="p-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">API 调用</div>
        <div className="text-lg font-semibold">--</div>
      </div>
    </div>
  </div>
);

const EditorView: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="p-3 text-sm" data-testid="embedded-tool-editor">
    <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-center">
      <div className="text-2xl mb-2">📝</div>
      <div className="text-[var(--text-secondary)] text-xs">
        内嵌文件编辑器
      </div>
      <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
        Session: {sessionId?.slice(0, 8) || '无'}
      </div>
    </div>
    <div className="mt-2 text-xs text-[var(--text-secondary)]">
      💡 提示：在主舞台中选择代码文件即可在编辑器中打开
    </div>
  </div>
);

const TerminalView: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="p-3 text-sm" data-testid="embedded-tool-terminal">
    <div className="rounded-lg bg-black/90 text-green-400 font-mono text-xs p-3 min-h-[200px]">
      <div>$ hermes --session {sessionId?.slice(0, 8) || 'idle'}</div>
      <div className="text-[var(--text-tertiary)] mt-1">
        $ 内嵌终端 - 等待执行命令
      </div>
    </div>
    <div className="mt-2 text-xs text-[var(--text-secondary)]">
      ⌘` 切换终端显隐
    </div>
  </div>
);

const BrowserView: React.FC = () => (
  <div className="p-3 text-sm" data-testid="embedded-tool-browser">
    <div className="flex items-center gap-1 mb-2">
      <input
        type="text"
        placeholder="输入 URL 或搜索..."
        className="flex-1 px-2 py-1 text-xs rounded
                   bg-[var(--bg-elevated)] border border-[var(--border-color)]
                   focus:outline-none focus:border-hermes-500"
      />
      <button className="px-2 py-1 text-xs rounded bg-[var(--hermes-500)] text-white">
        Go
      </button>
    </div>
    <div className="rounded-lg bg-white/5 border border-[var(--border-color)] min-h-[200px] flex items-center justify-center">
      <div className="text-center text-[var(--text-secondary)] text-xs">
        <div className="text-2xl mb-1">🌐</div>
        内嵌浏览器
      </div>
    </div>
  </div>
);

const DiffView: React.FC = () => (
  <div className="p-3 text-sm font-mono text-xs" data-testid="embedded-tool-diff">
    <div className="text-[var(--text-secondary)] mb-2">最近变更</div>
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] p-2 max-h-96 overflow-auto">
      <div className="text-green-500">+ const newFeature = true;</div>
      <div className="text-red-500">- const oldFeature = false;</div>
      <div className="text-[var(--text-tertiary)] mt-2">查看完整 diff → 打开 Diff 视图</div>
    </div>
  </div>
);

const MemoryView: React.FC = () => (
  <div className="p-3 text-sm" data-testid="embedded-tool-memory">
    <div className="text-[var(--text-secondary)] text-xs mb-2">Memory System</div>
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] p-3 max-h-96 overflow-auto">
      <div className="text-xs text-[var(--text-tertiary)]">
        记忆条目将在此显示
      </div>
    </div>
  </div>
);

const FilesView: React.FC = () => (
  <div className="p-3 text-sm" data-testid="embedded-tool-files">
    <div className="text-[var(--text-secondary)] text-xs mb-2">文件浏览器</div>
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] p-2 max-h-96 overflow-auto text-xs font-mono">
      <div>📁 /</div>
      <div className="pl-3">📁 src/</div>
      <div className="pl-6">📄 App.tsx</div>
      <div className="pl-6">📄 main.tsx</div>
      <div className="pl-3">📁 components/</div>
    </div>
  </div>
);

const MetricsView: React.FC = () => (
  <div className="p-3 text-sm" data-testid="embedded-tool-metrics">
    <div className="space-y-2">
      <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">总 Tokens</div>
        <div className="text-base font-semibold">--</div>
      </div>
      <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">总耗时</div>
        <div className="text-base font-semibold">--</div>
      </div>
      <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs text-[var(--text-secondary)]">总费用</div>
        <div className="text-base font-semibold">--</div>
      </div>
    </div>
  </div>
);

// ============================================================
// 主组件
// ====================================

export const EmbeddedTools: React.FC<EmbeddedToolsProps> = ({
  sessionId,
  defaultTab,
  className = '',
  'data-testid': testId = 'embedded-tools',
}) => {
  const [tab, setTab] = useState<EmbeddedTool>(defaultTab || readTool());

  const updateTab = (t: EmbeddedTool) => {
    setTab(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // 忽略
    }
  };

  const renderContent = () => {
    switch (tab) {
      case 'overview':
        return <OverviewView sessionId={sessionId} />;
      case 'editor':
        return <EditorView sessionId={sessionId} />;
      case 'terminal':
        return <TerminalView sessionId={sessionId} />;
      case 'browser':
        return <BrowserView />;
      case 'diff':
        return <DiffView />;
      case 'memory':
        return <MemoryView />;
      case 'files':
        return <FilesView />;
      case 'metrics':
        return <MetricsView />;
      default:
        return <OverviewView sessionId={sessionId} />;
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-[var(--bg-panel)]
                  border-l border-[var(--border-color)]
                  ${className}`}
      data-testid={testId}
    >
      {/* Tab 头 - v1.1.0 视觉优化：h-8 紧凑 + 底部下划线 active 态 */}
      <div
        className="flex items-center gap-0 px-2 h-8
                   border-b border-[var(--border-color)]
                   bg-[var(--bg-app)]/60 overflow-x-auto flex-shrink-0"
        style={{ scrollbarWidth: 'none' }}
        role="tablist"
      >
        {(Object.keys(TOOL_META) as EmbeddedTool[]).map((t) => {
          const meta = TOOL_META[t];
          const active = t === tab;
          return (
            <button
              key={t}
              onClick={() => updateTab(t)}
              className={[
                'h-full px-2.5 text-[11px] flex items-center gap-1',
                'flex-shrink-0 transition-colors relative',
                'border-b-2',
                active
                  ? 'text-[var(--text-primary)] font-semibold border-hermes-500'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/40',
              ].join(' ')}
              title={meta.description}
              role="tab"
              aria-selected={active}
              data-testid={`${testId}-tab-${t}`}
            >
              <span className="text-sm leading-none">{meta.emoji}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-h-0 overflow-auto" data-testid={`${testId}-content`}>
        {renderContent()}
      </div>
    </div>
  );
};

export default EmbeddedTools;
