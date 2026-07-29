/**
 * # ============================================================
 * ComposerPanel 组件 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：Composer 风格的多文件编辑面板
 * 特性：
 *   - 右侧浮动面板（与 Cursor Composer 一致）
 *   - @ 引用上下文栏
 *   - 提示词输入
 *   - 多文件 diff 列表（逐文件 Accept/Reject）
 *   - 跨文件 Undo/Redo
 *   - 全屏模式支持
 *   - Plan Mode（v1.1.0）：先计划后执行
 *   - Preview Mode（v1.2.0）：实时预览代码修改
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 16 P0-1 初次创建
 * #   - 2026-07-29 | v1.0.1 | P1-5 集成 MentionMenu
 * #     - 提示词输入集成 @ fuzzy search
 * #     - 选中 mention 自动添加到 session context
 * #     - 支持 file/folder/code/docs/web 5 种类型
 * #   - 2026-07-29 | v1.1.0 | Cycle 17 P0-1 Plan Mode 集成
 * #     - 新增 ComposerMode 模式切换（edit / plan）
 * #     - 集成 PlanViewer 组件
 * #     - 头部新增 "Plan" 切换按钮
 * #     - plan 模式下隐藏 edit list，显示 PlanViewer
 * #   - 2026-07-29 | v1.2.0 | Cycle 17 P0-3 Preview Mode 集成
 * #     - 新增 preview 模式（edit / plan / preview）
 * #     - 集成 PreviewPanel 组件
 * #     - 头部新增 "Preview" 切换按钮
 * #     - preview 模式下显示 PreviewPanel，注入当前 session 的 files
 * ============================================================
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComposer } from '../hooks/useComposer';
import { computeDiff } from '../utils/diff';
import type { ComposerEdit } from '../utils/composerEngine';
import MentionMenu from './MentionMenu';
import { PlanViewer } from './PlanViewer';
import { PreviewPanel } from './PreviewPanel';
import type { FuzzyItem } from '../utils/fuzzySearch';

export type ComposerMode = 'edit' | 'plan' | 'preview';

export interface ComposerPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 全屏时容器 */
  fullscreenContainer?: HTMLElement | null;
  /** 外部控制 isOpen（用于测试 / 编程式开关） */
  externalIsOpen?: boolean;
  /** 外部控制 isFullscreen */
  externalIsFullscreen?: boolean;
  /** 外部控制 mode */
  externalMode?: ComposerMode;
}

/**
 * ComposerPanel 主组件
 */
export function ComposerPanel({
  className = '',
  externalIsOpen,
  externalIsFullscreen,
  externalMode,
}: ComposerPanelProps) {
  const composer = useComposer();
  const isOpen = externalIsOpen ?? composer.isOpen;
  const isFullscreen = externalIsFullscreen ?? composer.isFullscreen;
  const [internalMode, setInternalMode] = useState<ComposerMode>('edit');
  const mode = externalMode ?? internalMode;

  // v1.1.0: 监听来自 PromptInput 的模式切换事件
  useEffect(() => {
    if (externalMode !== undefined) return; // 外部控制模式时不监听
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ mode: ComposerMode }>;
      const next = custom.detail?.mode;
      if (next === 'plan' || next === 'edit' || next === 'preview') {
        setInternalMode(next);
        // 切到 plan 模式时自动生成计划
        if (next === 'plan') {
          composer.generatePlan(composer.session.prompt || '示例：重构代码');
        }
      }
    };
    window.addEventListener('composer:switch-mode', handler);
    return () => window.removeEventListener('composer:switch-mode', handler);
  }, [composer, externalMode]);

  if (!isOpen) return null;

  return (
    <div
      data-component="composer-panel"
      data-testid="composer-panel"
      data-mode={mode}
      className={[
        'fixed',
        isFullscreen ? 'inset-4' : 'top-4 right-4 bottom-4 w-[480px]',
        'z-50',
        'flex flex-col',
        'bg-surface-950/95 backdrop-blur-sm',
        'border border-surface-700 rounded-lg',
        'shadow-2xl',
        'overflow-hidden',
        className,
      ].join(' ')}
    >
      <ComposerHeader mode={mode} onModeChange={setInternalMode} />
      {mode === 'plan' ? (
        <PlanViewer
          plan={composer.plan}
          stage={composer.planStage}
          onApproveStep={composer.approveStep}
          onRejectStep={composer.rejectStep}
          onModifyStep={composer.modifyStep}
          onApproveAll={composer.approveAllSteps}
          onRejectAll={composer.rejectAllSteps}
          onApprovePlan={composer.approvePlan}
          onRejectPlan={composer.rejectPlan}
          onExecutePlan={async () => {
            const edits = await composer.executePlan();
            setInternalMode('edit');
            console.log('Plan executed, generated', edits.length, 'edits');
          }}
          onClose={composer.clearPlan}
        />
      ) : mode === 'preview' ? (
        <PreviewPanel />
      ) : (
        <>
          <ComposerContextBar />
          <ComposerPromptInput />
          <ComposerEditList />
          <ComposerFooter />
        </>
      )}
    </div>
  );
}

/** Header：标题 + 模式切换 + 全屏切换 + 关闭 */
function ComposerHeader({
  mode,
  onModeChange,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
}) {
  const composer = useComposer();
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-surface-700 bg-surface-900/80">
      <div className="flex items-center gap-2">
        <span className="text-hermes-500 font-semibold text-sm">⚡ Composer</span>
        <span className="text-xs text-surface-500">
          {mode === 'plan'
            ? `${composer.plan?.steps.length ?? 0} 步骤 · ${composer.planStage}`
            : `${composer.session.edits.length} 文件 · ${composer.pendingCount} 待处理`}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {/* v1.1.0 Plan Mode 切换按钮 / v1.2.0 Preview 切换按钮 */}
        <div className="flex items-center bg-surface-800 rounded mr-1">
          <button
            data-testid="composer-mode-edit"
            onClick={() => onModeChange('edit')}
            className={[
              'px-2 py-0.5 text-xs rounded-l',
              mode === 'edit'
                ? 'bg-hermes-500 text-white'
                : 'text-surface-400 hover:text-surface-200',
            ].join(' ')}
          >
            Edit
          </button>
          <button
            data-testid="composer-mode-plan"
            onClick={() => onModeChange('plan')}
            className={[
              'px-2 py-0.5 text-xs',
              mode === 'plan'
                ? 'bg-hermes-500 text-white'
                : 'text-surface-400 hover:text-surface-200',
            ].join(' ')}
          >
            Plan
          </button>
          <button
            data-testid="composer-mode-preview"
            onClick={() => onModeChange('preview')}
            className={[
              'px-2 py-0.5 text-xs rounded-r',
              mode === 'preview'
                ? 'bg-hermes-500 text-white'
                : 'text-surface-400 hover:text-surface-200',
            ].join(' ')}
          >
            Preview
          </button>
        </div>
        <button
          onClick={() => composer.setFullscreen(!composer.isFullscreen)}
          className="px-2 py-1 text-xs text-surface-400 hover:text-surface-200 rounded hover:bg-surface-800"
          aria-label={composer.isFullscreen ? '退出全屏' : '全屏'}
          data-testid="composer-fullscreen"
        >
          {composer.isFullscreen ? '⤡' : '⤢'}
        </button>
        <button
          onClick={composer.close}
          className="px-2 py-1 text-xs text-surface-400 hover:text-surface-200 rounded hover:bg-surface-800"
          aria-label="关闭"
          data-testid="composer-close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** 上下文栏：显示当前 file/folder/symbol/docs/web 引用 */
function ComposerContextBar() {
  const composer = useComposer();
  const ctx = composer.session.context;
  const totalCount =
    ctx.files.length + ctx.folders.length + ctx.symbols.length + ctx.docs.length + ctx.web.length;
  if (totalCount === 0) {
    return (
      <div
        className="px-4 py-2 text-xs text-surface-500 border-b border-surface-800"
        data-testid="composer-context-bar"
      >
        添加 @ 引用: @file:path / @folder:path / @code:name / @docs:url / @web:query
      </div>
    );
  }
  return (
    <div
      className="px-4 py-2 border-b border-surface-800 flex flex-wrap gap-1"
      data-testid="composer-context-bar"
    >
      {ctx.files.map((f) => (
        <ContextChip
          key={`file-${f.path}`}
          label={`📄 ${f.path}`}
          onRemove={() => composer.removeContext('file', f.path)}
        />
      ))}
      {ctx.folders.map((f) => (
        <ContextChip
          key={`folder-${f.path}`}
          label={`📁 ${f.path}`}
          onRemove={() => composer.removeContext('folder', f.path)}
        />
      ))}
      {ctx.symbols.map((s) => (
        <ContextChip
          key={`symbol-${s.name}-${s.filePath}`}
          label={`🔣 ${s.name}`}
          onRemove={() => composer.removeContext('symbol', s.name)}
        />
      ))}
      {ctx.docs.map((d) => (
        <ContextChip
          key={`docs-${d.url}`}
          label={`📚 ${d.title || d.url}`}
          onRemove={() => composer.removeContext('docs', d.url)}
        />
      ))}
      {ctx.web.map((w) => (
        <ContextChip
          key={`web-${w.query}`}
          label={`🌐 ${w.query}`}
          onRemove={() => composer.removeContext('web', w.query)}
        />
      ))}
      <button
        onClick={composer.clearContext}
        className="px-2 py-0.5 text-xs text-surface-500 hover:text-error-400"
        data-testid="composer-clear-context"
      >
        清空
      </button>
    </div>
  );
}

/** 上下文标签 */
function ContextChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-surface-800 text-surface-200 rounded">
      {label}
      <button
        onClick={onRemove}
        className="text-surface-500 hover:text-error-400"
        aria-label={`移除 ${label}`}
      >
        ×
      </button>
    </span>
  );
}

/** 提示词输入（含 @ fuzzy search 弹窗） */
function ComposerPromptInput() {
  const composer = useComposer();
  const [localValue, setLocalValue] = useState(composer.session.prompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 默认 @ 候选项（实际项目可注入 file list / 符号表）
  const mentionItems = useMemo<FuzzyItem[]>(
    () => [
      { id: 'file-App.tsx', title: 'src/App.tsx', icon: '📄', meta: { type: 'file', value: 'src/App.tsx' } },
      { id: 'file-Main.tsx', title: 'src/main.tsx', icon: '📄', meta: { type: 'file', value: 'src/main.tsx' } },
      { id: 'file-ComposerPanel.tsx', title: 'src/components/ComposerPanel.tsx', icon: '📄', meta: { type: 'file', value: 'src/components/ComposerPanel.tsx' } },
      { id: 'folder-src', title: 'src/', icon: '📁', subtitle: '12 files', meta: { type: 'folder', value: 'src' } },
      { id: 'folder-components', title: 'src/components/', icon: '📁', subtitle: '8 files', meta: { type: 'folder', value: 'src/components' } },
      { id: 'symbol-useComposer', title: 'useComposer', icon: '🔣', subtitle: 'hook · src/hooks/useComposer.tsx', meta: { type: 'code', value: 'useComposer' } },
      { id: 'symbol-ComposerEngine', title: 'ComposerEngine', icon: '🔣', subtitle: 'class · src/utils/composerEngine.ts', meta: { type: 'code', value: 'ComposerEngine' } },
      { id: 'docs-react', title: 'React 文档', icon: '📚', subtitle: 'https://react.dev', meta: { type: 'docs', value: 'https://react.dev' } },
      { id: 'web', title: '网络搜索', icon: '🌐', subtitle: '输入查询词', meta: { type: 'web', value: '' } },
    ],
    []
  );

  /**
   * 选中 mention 后的回调：自动添加到 session context
   */
  const handleSelectMention = useCallback(
    (item: FuzzyItem) => {
      const meta = item.meta as { type?: string; value?: string } | undefined;
      if (!meta?.type || !meta.value) return;
      // 构造 context entry 并添加到 session
      switch (meta.type) {
        case 'file':
          composer.addContext({
            type: 'file',
            path: meta.value,
            content: '',
            language: meta.value.split('.').pop() ?? 'plaintext',
          });
          break;
        case 'folder':
          composer.addContext({
            type: 'folder',
            path: meta.value,
            recursive: true,
            fileCount: 0,
          });
          break;
        case 'code':
          composer.addContext({
            type: 'symbol',
            name: meta.value,
            kind: 'function',
            filePath: '',
            line: 0,
            snippet: '',
          });
          break;
        case 'docs':
          composer.addContext({
            type: 'docs',
            url: meta.value,
            title: item.title,
            content: '',
          });
          break;
        case 'web':
          // web 需要用户提供 query，跳过自动添加
          break;
      }
    },
    [composer]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalValue(e.target.value);
    },
    []
  );

  const handleBlur = useCallback(() => {
    composer.setPrompt(localValue);
  }, [composer, localValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        composer.setPrompt(localValue);
      }
    },
    [composer, localValue]
  );

  // v1.1.0: 切换到 Plan 模式
  const handleSwitchToPlan = useCallback(() => {
    composer.setPrompt(localValue);
    // 通过自定义事件通知 ComposerPanel 切换模式
    window.dispatchEvent(new CustomEvent('composer:switch-mode', { detail: { mode: 'plan' } }));
  }, [composer, localValue]);

  return (
    <div className="px-4 py-2 border-b border-surface-800 relative">
      <textarea
        ref={textareaRef}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="描述改动... 输入 @ 引用文件/目录/符号"
        className="w-full h-20 px-3 py-2 text-sm bg-surface-900 text-surface-100 border border-surface-700 rounded resize-none focus:outline-none focus:border-hermes-500"
        data-testid="composer-prompt-input"
      />
      <MentionMenu
        textareaRef={textareaRef}
        value={localValue}
        onChange={setLocalValue}
        items={mentionItems}
        onSelect={handleSelectMention}
        maxItems={8}
      />
      <div className="mt-1 text-xs text-surface-500 flex items-center gap-3 flex-wrap">
        <span>Cmd/Ctrl+Enter 提交</span>
        <span>·</span>
        <span>@ 引用 file/folder/code/docs/web</span>
        <span>·</span>
        <span>Cmd/Ctrl+I 切换面板</span>
        <button
          data-testid="composer-switch-plan-button"
          onClick={handleSwitchToPlan}
          className="ml-auto px-2 py-0.5 text-xs bg-hermes-500/20 text-hermes-300 rounded hover:bg-hermes-500/30"
        >
          🎯 Plan 模式
        </button>
      </div>
    </div>
  );
}

/** 编辑列表：每个文件一个 diff 视图 */
function ComposerEditList() {
  const composer = useComposer();
  if (composer.session.edits.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-surface-500 text-sm"
        data-testid="composer-empty"
      >
        等待编辑生成...
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto" data-testid="composer-edit-list">
      {composer.session.edits.map((edit) => (
        <ComposerEditItem key={edit.id} edit={edit} />
      ))}
    </div>
  );
}

/** 单个文件 diff 视图 */
function ComposerEditItem({ edit }: { edit: ComposerEdit }) {
  const composer = useComposer();
  const [expanded, setExpanded] = useState(false);

  const diffSegments = useMemo(
    () => computeDiff(edit.beforeContent, edit.afterContent, 'line'),
    [edit.beforeContent, edit.afterContent]
  );

  const statusColor =
    edit.status === 'accepted'
      ? 'border-success-500/50'
      : edit.status === 'rejected'
      ? 'border-error-500/50'
      : edit.status === 'modified'
      ? 'border-warning-500/50'
      : 'border-surface-700';

  return (
    <div
      data-testid={`composer-edit-${edit.id}`}
      data-status={edit.status}
      className={['border-l-4 border-b border-b-surface-800 bg-surface-900/40', statusColor].join(
        ' '
      )}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-800/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">📄</span>
          <span className="text-sm text-surface-200 truncate font-mono">
            {edit.filePath}
          </span>
          <StatusBadge status={edit.status} />
        </div>
        <div className="flex items-center gap-1">
          {edit.status === 'pending' || edit.status === 'modified' ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  composer.acceptEdit(edit.id);
                }}
                className="px-2 py-0.5 text-xs bg-success-500/20 text-success-300 rounded hover:bg-success-500/30"
                data-testid={`composer-accept-${edit.id}`}
              >
                ✓ Accept
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  composer.rejectEdit(edit.id);
                }}
                className="px-2 py-0.5 text-xs bg-error-500/20 text-error-300 rounded hover:bg-error-500/30"
                data-testid={`composer-reject-${edit.id}`}
              >
                ✗ Reject
              </button>
            </>
          ) : (
            <span className="text-xs text-surface-500">
              {edit.status === 'accepted' ? '已应用' : '已拒绝'}
            </span>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 py-2 font-mono text-xs">
          {diffSegments.slice(0, 50).map((seg, i) => (
            <div
              key={i}
              className={
                seg.type === 'insert'
                  ? 'bg-success-500/10 text-success-200'
                  : seg.type === 'delete'
                  ? 'bg-error-500/10 text-error-200'
                  : 'text-surface-400'
              }
            >
              <span className="inline-block w-4 text-surface-600">
                {seg.type === 'insert' ? '+' : seg.type === 'delete' ? '-' : ' '}
              </span>
              {seg.text}
            </div>
          ))}
          {diffSegments.length > 50 && (
            <div className="text-surface-500 mt-1">... +{diffSegments.length - 50} 行</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 状态徽章 */
function StatusBadge({ status }: { status: ComposerEdit['status'] }) {
  const config = {
    pending: { label: '待处理', color: 'bg-surface-700 text-surface-300' },
    accepted: { label: '已接受', color: 'bg-success-500/20 text-success-300' },
    rejected: { label: '已拒绝', color: 'bg-error-500/20 text-error-300' },
    modified: { label: '已修改', color: 'bg-warning-500/20 text-warning-300' },
  };
  const c = config[status];
  return (
    <span className={['px-1.5 py-0.5 text-[10px] rounded', c.color].join(' ')}>
      {c.label}
    </span>
  );
}

/** 底部操作栏：全部接受/拒绝/撤销/重做 */
function ComposerFooter() {
  const composer = useComposer();
  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-t border-surface-700 bg-surface-900/80"
      data-testid="composer-footer"
    >
      <div className="flex items-center gap-1">
        <button
          onClick={composer.undo}
          disabled={!composer.canUndo}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-surface-800"
          data-testid="composer-undo"
        >
          ↶ Undo
        </button>
        <button
          onClick={composer.redo}
          disabled={!composer.canRedo}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-surface-800"
          data-testid="composer-redo"
        >
          ↷ Redo
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={composer.rejectAll}
          disabled={composer.pendingCount === 0}
          className="px-3 py-1 text-xs bg-error-500/20 text-error-300 rounded hover:bg-error-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="composer-reject-all"
        >
          拒绝全部
        </button>
        <button
          onClick={composer.acceptAll}
          disabled={composer.pendingCount === 0}
          className="px-3 py-1 text-xs bg-success-500/20 text-success-300 rounded hover:bg-success-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="composer-accept-all"
        >
          接受全部
        </button>
      </div>
    </div>
  );
}

export default ComposerPanel;
