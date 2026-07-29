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
import { ContextWindowMeter, SummarizationHistory } from './ContextWindowMeter';
import { RulesEditor } from './RulesEditor';
import { ResolvedReferencesBar } from './ResolvedReferencesBar';
import { ReferenceDetailModal } from './ReferenceDetailModal';
import { RulesStatusBadge } from './RulesStatusBadge';
import { RulesPanel } from './RulesPanel';
import type { FuzzyItem } from '../utils/fuzzySearch';
import { type ConversationItem, type Summary } from '../utils/composerEngine.summary';
import type { HermesRules } from '../utils/hermesRules';
import type { GitRefKind } from '../utils/referenceResolvers';
import type { ResolvedReference } from '../utils/composerEngine.integration';

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
  /** v1.3.0: 项目 ID（用于项目规则） */
  projectId?: string;
}

/**
 * ComposerPanel 主组件
 */
export function ComposerPanel({
  className = '',
  externalIsOpen,
  externalIsFullscreen,
  externalMode,
  projectId = 'default',
}: ComposerPanelProps) {
  const composer = useComposer();
  const isOpen = externalIsOpen ?? composer.isOpen;
  const isFullscreen = externalIsFullscreen ?? composer.isFullscreen;
  const [internalMode, setInternalMode] = useState<ComposerMode>('edit');
  const mode = externalMode ?? internalMode;

  // v1.3.0: 规则编辑器显示状态（旧版 + 新版）
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [isNewRulesOpen, setIsNewRulesOpen] = useState(false);

  // v1.3.0: 当前项目规则（由父组件注入或默认）
  const [currentRules, setCurrentRules] = useState<HermesRules | null>(null);

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
      <ComposerHeader
        mode={mode}
        onModeChange={setInternalMode}
        onOpenRules={() => setIsRulesOpen(true)}
      />
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
          <ComposerResolvedBar />
          <ComposerSummarySection />
          <ComposerPromptInput />
          <ComposerEditList />
          <ComposerFooter
            onOpenRules={() => setIsRulesOpen(true)}
            currentRules={currentRules}
            onOpenNewRules={() => setIsNewRulesOpen(true)}
          />
        </>
      )}

      {/* v1.3.0: 项目级 AI 规则编辑器 (旧版 - YAML) */}
      <RulesEditor
        projectId={projectId}
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
        onSave={(rules) => {
          setCurrentRules(rules);
          console.log('Rules saved:', rules.project_type);
        }}
      />

      {/* v1.3.0: 项目级 AI 规则编辑器 (新版 - 可视化) */}
      <RulesPanel
        open={isNewRulesOpen}
        onClose={() => setIsNewRulesOpen(false)}
        currentRules={currentRules ?? composer.projectRules}
        onSave={(rules) => {
          setCurrentRules(rules);
          composer.updateProjectRules(rules);
          setIsNewRulesOpen(false);
        }}
      />

      <ComposerReferenceDetail />
    </div>
  );
}

/** v1.3.0: 已解析引用条 (Cycle 18 P0-1) */
function ComposerResolvedBar() {
  const composer = useComposer();
  const [selectedRef, setSelectedRef] = useState<ResolvedReference | null>(null);

  if (composer.resolvedReferences.length === 0 && composer.resolutionErrors.length === 0) {
    return null;
  }

  return (
    <>
      <div className="px-4 py-2 border-b border-surface-800">
        <ResolvedReferencesBar
          references={composer.resolvedReferences}
          errors={composer.resolutionErrors}
          onReferenceClick={(ref) => setSelectedRef(ref)}
          onRetry={() => composer.resolveReferences(composer.session.prompt || '')}
        />
      </div>
      <ReferenceDetailModal
        reference={selectedRef}
        open={selectedRef !== null}
        onClose={() => setSelectedRef(null)}
      />
    </>
  );
}

/** v1.3.0: 全局引用详情模态 - 暴露给外部触发 */
function ComposerReferenceDetail() {
  return null; // 详情模态已由 ComposerResolvedBar 内部管理
}

/** v1.4.0: 摘要区域 (Cycle 18 P0-2) */
function ComposerSummarySection() {
  const composer = useComposer();

  // 只在有摘要历史或可摘要时显示
  if (composer.summaryHistory.length === 0 && !composer.shouldSummarize) {
    return null;
  }

  const handleSummarize = () => {
    composer.summarize({ force: true });
  };

  const handleApply = (summary: Summary) => {
    composer.applySummary(summary.id);
  };

  const handleDelete = (summaryId: string) => {
    composer.deleteSummary(summaryId);
  };

  const handleClear = () => {
    composer.clearSummaryHistory();
  };

  return (
    <div
      data-testid="composer-summary-section"
      className="px-4 py-2 border-b border-surface-800"
    >
      {/* 摘要触发提示 */}
      {composer.shouldSummarize && composer.summaryHistory.length === 0 && (
        <div
          data-testid="composer-summarize-suggestion"
          className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 mb-2 flex items-center justify-between"
        >
          <span className="text-xs text-yellow-200">
            ⚠️ 上下文较长 ({(composer.tokensUsed / 1000).toFixed(1)}K / {composer.summaryConfig.triggerThreshold / 1000}K tokens)
          </span>
          <button
            data-testid="composer-summarize-btn"
            onClick={handleSummarize}
            className="px-2 py-0.5 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded"
          >
            立即摘要
          </button>
        </div>
      )}

      {/* 摘要历史 */}
      {composer.summaryHistory.length > 0 && (
        <div data-testid="composer-summary-history-wrapper">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-surface-400 font-semibold">
              📑 摘要历史 ({composer.summaryHistory.length})
              {composer.appliedSummaryId && (
                <span
                  data-testid="composer-summary-applied-badge"
                  className="ml-2 px-1.5 py-0.5 bg-hermes-500/20 text-hermes-300 rounded"
                >
                  已应用
                </span>
              )}
            </span>
            <button
              data-testid="composer-summary-clear"
              onClick={handleClear}
              className="text-[10px] text-surface-500 hover:text-red-300"
            >
              清空
            </button>
          </div>
          <SummarizationHistory
            summaries={composer.summaryHistory}
            onApply={handleApply}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

/** Header：标题 + 模式切换 + 全屏切换 + 关闭 */
function ComposerHeader({
  mode,
  onModeChange,
  onOpenRules,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  onOpenRules: () => void;
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
          onClick={onOpenRules}
          className="px-2 py-1 text-xs text-surface-400 hover:text-surface-200 rounded hover:bg-surface-800"
          aria-label="项目规则"
          data-testid="composer-open-rules"
          title="项目级 AI 规则"
        >
          📋
        </button>
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

/** 上下文栏：显示当前 file/folder/symbol/docs/web 引用 + G18-01 新增 codebase/git/diff */
function ComposerContextBar() {
  const composer = useComposer();
  const ctx = composer.session.context;
  const totalCount =
    ctx.files.length +
    ctx.folders.length +
    ctx.symbols.length +
    ctx.docs.length +
    ctx.web.length +
    ctx.codebase.length +
    ctx.git.length +
    ctx.diff.length;
  if (totalCount === 0) {
    return (
      <div
        className="px-4 py-2 text-xs text-surface-500 border-b border-surface-800"
        data-testid="composer-context-bar"
      >
        添加 @ 引用: @file / @folder / @code / @docs / @web / @codebase / @git / @diff
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
      {ctx.codebase.map((c) => (
        <ContextChip
          key={`codebase-${c.query}`}
          label={`🔎 ${c.query} (${c.results.length})`}
          onRemove={() => composer.removeContext('codebase', c.query)}
        />
      ))}
      {ctx.git.map((g) => (
        <ContextChip
          key={`git-${g.ref}-${g.filePath ?? ''}`}
          label={`📜 git:${g.ref}${g.filePath ? ` ${g.filePath}` : ''}`}
          onRemove={() =>
            composer.removeContext('git', `${g.ref}:${g.filePath ?? ''}`)
          }
        />
      ))}
      {ctx.diff.map((d) => (
        <ContextChip
          key={`diff-${d.ref}`}
          label={`📝 diff:${d.ref} (+${d.totalAdditions}/-${d.totalDeletions})`}
          onRemove={() => composer.removeContext('diff', d.ref)}
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
  // v1.3.0: 增加 codebase / git / diff 引用（Cycle 18 G18-01）
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
      // G18-01 新增
      { id: 'codebase-search', title: '语义搜索代码库', icon: '🔎', subtitle: '输入查询', meta: { type: 'codebase', value: '' } },
      { id: 'git-log', title: 'git:log', icon: '📜', subtitle: '查看提交历史', meta: { type: 'git', value: 'log' } },
      { id: 'git-blame', title: 'git:blame', icon: '📜', subtitle: '查看文件 blame', meta: { type: 'git', value: 'blame' } },
      { id: 'git-branch', title: 'git:branch', icon: '📜', subtitle: '查看分支', meta: { type: 'git', value: 'branch' } },
      { id: 'diff-working', title: 'diff:working', icon: '📝', subtitle: '未提交修改', meta: { type: 'diff', value: 'working' } },
      { id: 'diff-staged', title: 'diff:staged', icon: '📝', subtitle: '已暂存修改', meta: { type: 'diff', value: 'staged' } },
    ],
    []
  );

  /**
   * 选中 mention 后的回调：自动添加到 session context
   * v1.3.0: 支持 codebase / git / diff 新类型（Cycle 18 G18-01）
   */
  const handleSelectMention = useCallback(
    async (item: FuzzyItem) => {
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
        // G18-01: 新增 3 种引用类型
        case 'codebase': {
          try {
            const { resolveCodebase } = await import('../utils/referenceResolvers');
            const ctx = await resolveCodebase(meta.value || 'default', { topK: 5 });
            composer.addContext(ctx);
          } catch (e) {
            console.warn('Failed to resolve codebase', e);
          }
          break;
        }
        case 'git': {
          try {
            const { resolveGit } = await import('../utils/referenceResolvers');
            const ctx = await resolveGit(meta.value as GitRefKind, { limit: 5 });
            composer.addContext(ctx);
          } catch (e) {
            console.warn('Failed to resolve git', e);
          }
          break;
        }
        case 'diff': {
          try {
            const { resolveDiff } = await import('../utils/referenceResolvers');
            const ctx = await resolveDiff(meta.value, {});
            composer.addContext(ctx);
          } catch (e) {
            console.warn('Failed to resolve diff', e);
          }
          break;
        }
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

/** 底部操作栏：全部接受/拒绝/撤销/重做 + 上下文窗口 + 规则 */
function ComposerFooter({
  onOpenRules,
  onOpenNewRules,
  currentRules,
}: {
  onOpenRules: () => void;
  onOpenNewRules?: () => void;
  currentRules: HermesRules | null;
}) {
  const composer = useComposer();
  // v1.3.0: 将 Composer 会话内容转换为 ConversationItem 用于 token 估算
  const conversationItems: ConversationItem[] = useMemo(
    () => [
      {
        id: 'prompt',
        role: 'user' as const,
        content: composer.session.prompt || '',
        timestamp: Date.now(),
      },
      ...composer.session.edits.map((e, i) => ({
        id: e.id,
        role: 'assistant' as const,
        content: `${e.filePath}\n${e.afterContent}`,
        timestamp: e.createdAt ?? Date.now() - (composer.session.edits.length - i) * 1000,
      })),
    ],
    [composer.session.prompt, composer.session.edits]
  );

  // v1.3.0: 规则元数据
  const rulesMeta = useMemo(() => composer.getRulesMeta(), [composer]);
  const activeTemplateName = useMemo(() => {
    if (currentRules?.project_type) {
      const typeMap: Record<string, string> = {
        typescript: 'TypeScript Strict',
        python: 'Python PEP8',
        react: 'React',
        vue: 'Vue',
        generic: 'Generic',
      };
      return typeMap[currentRules.project_type] ?? '自定义';
    }
    return undefined;
  }, [currentRules]);

  return (
    <div
      className="flex flex-col border-t border-surface-700 bg-surface-900/80"
      data-testid="composer-footer"
    >
      {/* v1.3.0: 上下文窗口使用量（token 进度条） */}
      <div className="px-4 py-1.5 border-b border-surface-800">
        <ContextWindowMeter
          items={conversationItems}
          config={{ triggerThreshold: 8000 }}
          onSummarize={(summary) => {
            console.log(
              'Summary generated:',
              summary.id,
              `(${summary.stats.reductionRatio.toFixed(1)}% reduction)`
            );
          }}
        />
      </div>

      <div className="flex items-center justify-between px-4 py-2">
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
          {currentRules && (
            <span
              className="ml-1 px-1.5 py-0.5 text-[10px] bg-hermes-500/15 text-hermes-300 rounded"
              data-testid="composer-rules-indicator"
              title="项目规则已激活"
            >
              📋 {currentRules.project_type ?? 'generic'}
            </span>
          )}
          {/* v1.3.0: 规则状态徽章 (Cycle 18 P0-1) */}
          {onOpenNewRules && (
            <RulesStatusBadge
              metadata={rulesMeta}
              templateName={activeTemplateName}
              onClick={onOpenNewRules}
              compact
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenNewRules ?? onOpenRules}
            className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
            data-testid="composer-footer-rules"
            title="可视化编辑项目规则"
          >
            ⚙️ 规则
          </button>
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
    </div>
  );
}

export default ComposerPanel;
