/**
 * # ============================================================
 * EmbeddedTools - 内嵌工具矩阵组件 (v1.5.0)
 * Cycle 60+ Solo 重构 - 对标 Trae Solo / Codex 内嵌工具
 * # ====================================
 * # 核心作用：在右栏提供内嵌的工具面板：编辑器、终端、浏览器、代码变更、内存、文件浏览、阶段检测、批量任务、快照、思考流、Markdown流式渲染等
 * # 设计要点（v1.1.0 G60-FIX-17）：
 * #   - Tab 切换：overview / editor / terminal / browser / diff / memory / files / metrics / context / stage / batch / snapshot / thinking / stream
 * #   - 内嵌 iframe / 自实现组件
 * #   - 与 ToolsMatrixPanel 协同（外层按钮 + 内嵌细节）
 * #   - 可折叠/展开
 * #   - 状态持久化
 * #   - v1.1.0 视觉优化：
 * #     - tab 头 h-8 (32px)，与工具栏对齐
 * #     - tab 字号 11px
 * #     - active tab 使用底部下划线 + 主题色文字，更接近浏览器风格
 * #     - tab 之间分隔更清晰（hover 态背景）
 * #     - 内容区域 padding 统一
 * #   - v1.2.0 G63-03 阶段检测器集成：
 * #     - 新增 stage tab
 * #     - Auto-Follow 联动：当 stage 变化且 auto_follow 启用时自动切换 tab
 * #     - 阶段变化通过 useStage 订阅
 * #   - v1.3.0 G65-02 批量任务集成：
 * #     - 新增 batch tab（嵌入 BatchSpawnPanel）
 * #     - Auto-Follow 阶段 → batch tab 暂不联动（避免误触发）
 * #   - v1.4.0 G66-02 快照管理集成：
 * #     - 新增 snapshot tab（嵌入 SnapshotPanel）
 * #     - 与 UndoConfirmDialog / DiffPreview 联动
 * #     - 阶段 → snapshot tab 不联动（按需手动切换）
 * #   - v1.5.0 G67-01/02 思考流 + Markdown流式渲染集成：
 * #     - 新增 thinking tab（嵌入 ThinkingStreamView）
 * #     - 新增 stream tab（嵌入 StreamingMarkdownView）
 * #     - 与 WebSocket 实时联动
 * 输入参数：
 *   - defaultTab?: EmbeddedTool
 *   - sessionId?: string 当前 session
 *   - wsUrl?: string WebSocket URL
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
 *   - 2026-08-04 | v1.2.0 | G63-03 阶段检测器集成：
 *                                - 新增 stage tab（嵌入 StageDetectorView）
 *                                - Auto-Follow 联动逻辑
 *                                - wsUrl 参数透传
 * #   - 2026-08-04 | v1.3.0 | G65-02 批量任务集成：
 * #                                - 新增 batch tab（嵌入 BatchSpawnPanel）
 * #                                - EmbeddedTool 联合类型扩展
 * #   - 2026-08-04 | v1.4.0 | G66-02 快照管理集成：
 * #                                - 新增 snapshot tab（嵌入 SnapshotPanel）
 * #                                - 阶段 → snapshot tab 不联动
 * #                                - EmbeddedTool 联合类型扩展
 * #   - 2026-08-05 | v1.5.0 | G67-01/02 思考流 + Markdown流式渲染集成：
 * #                                - 新增 thinking tab（嵌入 ThinkingStreamView）
 * #                                - 新增 stream tab（嵌入 StreamingMarkdownView）
 * #                                - EmbeddedTool 联合类型扩展（11→13 tabs）
 * # ====================================
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ContextSelector } from './ContextSelector';
import { StageDetectorView } from './StageDetectorView';
import { BatchSpawnPanel } from './BatchSpawnPanel';
import { SnapshotPanel } from './SnapshotPanel';
import { ThinkingStreamView } from './ThinkingStreamView';
import { StreamingMarkdownView } from './StreamingMarkdownView';
import { useStage, type StageId } from '../hooks/useStage';

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
  | 'metrics'
  | 'context'
  | 'stage'
  | 'batch'
  | 'snapshot'
  | 'thinking'
  | 'stream';

export interface EmbeddedToolsProps {
  sessionId?: string | null;
  defaultTab?: EmbeddedTool;
  wsUrl?: string;
  className?: string;
  'data-testid'?: string;
  onRestore?: (snapshotId: string, fileCount: number) => void;
}

// ============================================================
// Tab 配置
// ============================================================

const TOOL_META: Record<EmbeddedTool, { label: string; emoji: string; description: string }> = {
  overview: { label: '概览', emoji: '📊', description: '会话概览 + 关键指标' },
  editor: { label: '编辑器', emoji: '📝', description: '文件编辑器（内嵌）' },
  terminal: { label: '终端', emoji: '⌨️', description: '命令执行终端' },
  browser: { label: '浏览器', emoji: '🌐', description: '内嵌网页浏览器' },
  diff: { label: '代码变更', emoji: '🔀', description: 'Git diff 视图' },
  memory: { label: '记忆', emoji: '🧠', description: 'Memory System' },
  files: { label: '文件', emoji: '📁', description: '文件浏览器' },
  metrics: { label: '指标', emoji: '📈', description: 'Token/耗时/费用指标' },
  context: { label: '上下文', emoji: '📎', description: '多源上下文选择器（文件/代码/终端/Git/文档/网页）' },
  stage: { label: '阶段', emoji: '🎯', description: '阶段检测器 + Auto-Follow 联动' },
  batch: { label: '批量', emoji: '🚀', description: 'CSV 批量 spawn agents（G65-02）' },
  snapshot: { label: '快照', emoji: '📸', description: '文件级快照管理 + 操作级回退（G66-02）' },
  thinking: { label: '思考流', emoji: '💭', description: 'LLM 思考过程实时可视化（G67-01）' },
  stream: { label: '流渲染', emoji: '📝', description: '渐进式 Markdown 渲染（G67-02）' },
};

/**
 * 阶段 → 默认工具面板的映射表（G63-03 Auto-Follow）
 * 与后端 STAGE_VISUALS.linkedTab 保持一致
 */
const STAGE_TO_TAB: Partial<Record<StageId, EmbeddedTool>> = {
  prd: 'context',
  coding: 'editor',
  preview: 'browser',
  deploy: 'terminal',
  done: 'metrics',
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

const ContextView: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="h-full" data-testid="embedded-tool-context">
    <ContextSelector
      testId="embedded-context-selector"
      initialBundleId={sessionId || undefined}
    />
  </div>
);

const StageView: React.FC<{
  sessionId?: string | null;
  wsUrl?: string;
  onTabSwitch?: (tab: EmbeddedTool) => void;
}> = ({ sessionId, wsUrl, onTabSwitch }) => (
  <div className="h-full" data-testid="embedded-tool-stage">
    <StageDetectorView
      sessionId={sessionId}
      wsUrl={wsUrl}
      testId="embedded-stage-view"
      onTabSwitch={onTabSwitch as ((tab: string) => void) | undefined}
    />
  </div>
);

const BatchView: React.FC<{
  batchOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}> = ({ batchOpen, onOpen, onClose }) => (
  <div className="h-full" data-testid="embedded-tool-batch">
    {!batchOpen ? (
      <div className="p-6 flex flex-col items-center justify-center h-full text-center">
        <div className="text-4xl mb-3">🚀</div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          CSV 批量任务
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)] max-w-md mb-4">
          通过 CSV 一次性创建多个 Agent 实例，支持并发控制、进度跟踪、结果导出（对标 Codex batch_spawn_agents）
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="px-3 py-1.5 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600"
          data-testid="embedded-batch-open-btn"
        >
          📂 打开批量任务面板
        </button>
        <div className="mt-6 grid grid-cols-2 gap-2 max-w-md w-full text-[10px] text-[var(--text-tertiary)]">
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            ⚙️ 并发控制（1-50）
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            🎭 角色调度
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📊 实时进度
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📥 多格式导出
          </div>
        </div>
      </div>
    ) : (
      <BatchSpawnPanel isOpen={batchOpen} onClose={onClose} />
    )}
  </div>
);

const SnapshotView: React.FC<{
  sessionId?: string | null;
  onRestore?: (snapshotId: string, fileCount: number) => void;
}> = ({ sessionId, onRestore }) => {
  // 必须有 sessionId 才能使用 SnapshotPanel，否则显示介绍页
  if (!sessionId) {
    return (
      <div
        className="p-6 flex flex-col items-center justify-center h-full text-center"
        data-testid="embedded-tool-snapshot-empty"
      >
        <div className="text-4xl mb-3">📸</div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          快照管理
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)] max-w-md mb-4">
          文件级快照 + 操作级回退（对标 Codex /undo 与 agent-rollback checkpoint）
        </p>
        <div className="grid grid-cols-2 gap-2 max-w-md w-full text-[10px] text-[var(--text-tertiary)]">
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            🗂️ 内容寻址存储
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            🛡️ 冲突检测
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            👁️ Diff 预览
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            ⏪ 一键回退
          </div>
        </div>
        <p className="mt-4 text-[10px] text-[var(--text-tertiary)]">
          启动一个 session 后即可创建快照
        </p>
      </div>
    );
  }
  return (
    <div className="h-full" data-testid="embedded-tool-snapshot">
      <SnapshotPanel sessionId={sessionId} onRestore={onRestore} />
    </div>
  );
};

const ThinkingView: React.FC<{
  sessionId?: string | null;
  wsUrl?: string;
}> = ({ sessionId, wsUrl }) => {
  if (!sessionId) {
    return (
      <div
        className="p-6 flex flex-col items-center justify-center h-full text-center"
        data-testid="embedded-tool-thinking-empty"
      >
        <div className="text-4xl mb-3">💭</div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          思考流
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)] max-w-md mb-4">
          LLM 推理过程实时可视化（对标 Codex PR #6006 reasoning stream）
        </p>
        <div className="grid grid-cols-2 gap-2 max-w-md w-full text-[10px] text-[var(--text-tertiary)]">
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            ⚡ token-by-token 流
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📊 累计统计
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📜 历史折叠
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            💾 导出 MD/JSON
          </div>
        </div>
        <p className="mt-4 text-[10px] text-[var(--text-tertiary)]">
          启动 session 后 LLM 思考将实时显示
        </p>
      </div>
    );
  }
  return (
    <div className="h-full" data-testid="embedded-tool-thinking">
      <ThinkingStreamView
        sessionId={sessionId}
        wsUrl={wsUrl}
        testId="embedded-thinking-stream"
      />
    </div>
  );
};

const StreamView: React.FC<{
  sessionId?: string | null;
  wsUrl?: string;
}> = ({ sessionId, wsUrl }) => {
  if (!sessionId) {
    return (
      <div
        className="p-6 flex flex-col items-center justify-center h-full text-center"
        data-testid="embedded-tool-stream-empty"
      >
        <div className="text-4xl mb-3">📝</div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          流式渲染
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)] max-w-md mb-4">
          渐进式 Markdown 渲染（对标 Trae SOLO 实时回答 + Codex 流式输出）
        </p>
        <div className="grid grid-cols-2 gap-2 max-w-md w-full text-[10px] text-[var(--text-tertiary)]">
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📦 块级增量渲染
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            🎨 代码高亮
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📊 进度条
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
            📜 自动滚动
          </div>
        </div>
        <p className="mt-4 text-[10px] text-[var(--text-tertiary)]">
          启动 session 后流式回答将渐进渲染
        </p>
      </div>
    );
  }
  return (
    <div className="h-full" data-testid="embedded-tool-stream">
      <StreamingMarkdownView
        sessionId={sessionId}
        wsUrl={wsUrl}
        testId="embedded-stream-markdown"
      />
    </div>
  );
};

// ============================================================
// 主组件
// ====================================

export const EmbeddedTools: React.FC<EmbeddedToolsProps> = ({
  sessionId,
  defaultTab,
  wsUrl,
  className = '',
  'data-testid': testId = 'embedded-tools',
  onRestore,
}) => {
  const [tab, setTab] = useState<EmbeddedTool>(defaultTab || readTool());
  const [batchOpen, setBatchOpen] = useState(false);
  // Auto-Follow 是否已由用户手动锁定（用户手动切换 tab 后会设为 true，
  // 阶段触发的自动切换不再覆盖；点击 Auto-Follow 按钮或显式重置时清空）
  const [userLocked, setUserLocked] = useState(false);
  const lastStageRef = useRef<StageId | null>(null);

  // Auto-Follow 阶段订阅：仅在未锁定时跟随
  const sid = sessionId || undefined;
  const stageHook = useStage({
    sessionId: sid || 'embedded-tools-default',
    wsUrl,
    autoConnect: !!sid,
  });

  useEffect(() => {
    const s = stageHook.state;
    if (!s || !s.auto_follow) return;
    if (userLocked) return;
    // 阶段变化才触发 tab 切换
    if (lastStageRef.current === s.stage) return;
    lastStageRef.current = s.stage;
    const target = STAGE_TO_TAB[s.stage];
    if (target && target !== tab) {
      setTab(target);
      try {
        window.localStorage.setItem(STORAGE_KEY, target);
      } catch {
        // 忽略
      }
    }
  }, [stageHook.state, userLocked, tab]);

  const updateTab = useCallback((t: EmbeddedTool) => {
    setTab(t);
    setUserLocked(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // 忽略
    }
  }, []);

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
      case 'context':
        return <ContextView sessionId={sessionId} />;
      case 'stage':
        return (
          <StageView
            sessionId={sessionId}
            wsUrl={wsUrl}
            onTabSwitch={(t) => {
              setTab(t as EmbeddedTool);
              try {
                window.localStorage.setItem(STORAGE_KEY, t);
              } catch {
                // 忽略
              }
            }}
          />
        );
      case 'batch':
        return (
          <BatchView
            batchOpen={batchOpen}
            onOpen={() => setBatchOpen(true)}
            onClose={() => setBatchOpen(false)}
          />
        );
      case 'snapshot':
        return <SnapshotView sessionId={sessionId} onRestore={onRestore} />;
      case 'thinking':
        return <ThinkingView sessionId={sessionId} wsUrl={wsUrl} />;
      case 'stream':
        return <StreamView sessionId={sessionId} wsUrl={wsUrl} />;
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
