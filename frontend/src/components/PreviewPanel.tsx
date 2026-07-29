/**
 * # ============================================================
 * PreviewPanel 组件 (v6.37.0 Cycle 17 P0-3)
 * # ============================================================
 * 核心作用：实时预览 Composer 中的代码修改
 * 特性：
 *   - 三种渲染模式：HTML / React / Iframe（多文件）
 *   - iframe sandbox 隔离 + console 桥接
 *   - 错误卡片展示（捕获 iframe 内错误）
 *   - 模式切换 + 刷新 + 重置 + 快照控制
 *   - 全屏切换支持
 *   - 与 useComposer 集成，自动跟踪当前 session 的 edits
 * 设计要点：
 *   - 通过 SandboxManager 抽象渲染细节
 *   - 文件内容从 useComposer 注入（file/folder/symbol/docs context）
 *   - 状态在面板与引擎间同步
 * 输入参数：
 *   - externalMode: 外部控制预览模式
 *   - initialFiles: 初始文件（用于预览）
 *   - onClose: 关闭面板回调
 * 输出结果：实时 iframe 预览 + 错误反馈
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-3 初次创建
 * #     - 集成 SandboxManager
 * #     - 实现模式切换 / 刷新 / 重置 / 快照 / 全屏控制
 * #     - 实现错误卡片展示
 * #     - 实现 console 桥接（监听 iframe message）
 * ============================================================
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComposer } from '../hooks/useComposer';
import {
  createSandboxManager,
  type PreviewMode,
  type PreviewSnapshot,
  type PreviewError,
  type PreviewConfig,
  buildSandboxAttr,
} from '../utils/previewSandbox';

export interface PreviewPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 外部控制预览模式 */
  externalMode?: PreviewMode;
  /** 初始文件内容（默认从 useComposer context.files 提取） */
  initialFiles?: Record<string, string>;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 全屏切换回调 */
  onFullscreenChange?: (fullscreen: boolean) => void;
}

/**
 * PreviewPanel 主组件
 * 集成 SandboxManager 实时预览代码修改
 */
export function PreviewPanel({
  className = '',
  externalMode,
  initialFiles,
  onClose,
  onFullscreenChange,
}: PreviewPanelProps) {
  const composer = useComposer();
  const [mode, setMode] = useState<PreviewMode>(externalMode ?? 'react');
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [snapshots, setSnapshots] = useState<PreviewSnapshot[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxRef = useRef<ReturnType<typeof createSandboxManager> | null>(null);

  // 同步外部 mode
  useEffect(() => {
    if (externalMode !== undefined) {
      setMode(externalMode);
    }
  }, [externalMode]);

  // 初始化 SandboxManager
  if (sandboxRef.current === null) {
    sandboxRef.current = createSandboxManager({
      mode: externalMode ?? 'react',
      debounceMs: 400,
    });
  }
  const sandbox = sandboxRef.current;

  // attach/detach iframe
  useEffect(() => {
    if (iframeRef.current) {
      sandbox.attach(iframeRef.current);
    }
    return () => {
      sandbox.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅 snapshot
  useEffect(() => {
    const unsub = sandbox.subscribe((s) => {
      setSnapshot(s);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换 mode 时同步到 sandbox
  useEffect(() => {
    sandbox.setConfig({ mode });
    // 用当前文件重新触发渲染
    const files = collectFiles(composer, initialFiles);
    if (Object.keys(files).length > 0) {
      sandbox.updateNow(files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 监听 composer edits 变化，自动更新预览
  useEffect(() => {
    const files = collectFiles(composer, initialFiles);
    if (Object.keys(files).length > 0) {
      sandbox.update(files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer.session.edits, composer.session.context.files]);

  const handleRefresh = useCallback(() => {
    const files = collectFiles(composer, initialFiles);
    sandbox.updateNow(files);
  }, [composer, initialFiles, sandbox]);

  const handleReset = useCallback(() => {
    sandbox.reset();
  }, [sandbox]);

  const handleSnapshot = useCallback(() => {
    if (snapshot) {
      setSnapshots((prev) => [snapshot, ...prev].slice(0, 20));
    }
  }, [snapshot]);

  const handleApplySnapshot = useCallback(
    (snap: PreviewSnapshot) => {
      sandbox.updateNow(snap.files);
    },
    [sandbox]
  );

  const handleDeleteSnapshot = useCallback((id: string) => {
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    onFullscreenChange?.(next);
  }, [isFullscreen, onFullscreenChange]);

  const files = useMemo(
    () => collectFiles(composer, initialFiles),
    [composer, composer.session.edits, composer.session.context.files, initialFiles]
  );
  const hasFiles = Object.keys(files).length > 0;
  const status = snapshot?.status ?? 'idle';
  const error = snapshot?.error ?? null;

  return (
    <div
      data-testid="preview-panel"
      data-mode={mode}
      data-status={status}
      className={[
        'flex flex-col h-full bg-surface-950 text-surface-100',
        isFullscreen ? 'fixed inset-0 z-[60]' : '',
        className,
      ].join(' ')}
    >
      <PreviewHeader
        mode={mode}
        onModeChange={setMode}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onRefresh={handleRefresh}
        onReset={handleReset}
        onSnapshot={handleSnapshot}
        onClose={onClose}
        status={status}
        fileCount={Object.keys(files).length}
      />
      {error ? (
        <PreviewErrorCard error={error} onRetry={handleRefresh} />
      ) : (
        <PreviewArea
          iframeRef={iframeRef}
          mode={mode}
          hasFiles={hasFiles}
          status={status}
        />
      )}
      {snapshots.length > 0 && (
        <PreviewSnapshotList
          snapshots={snapshots}
          onApply={handleApplySnapshot}
          onDelete={handleDeleteSnapshot}
        />
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

interface PreviewHeaderProps {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onSnapshot: () => void;
  onClose?: () => void;
  status: PreviewSnapshot['status'];
  fileCount: number;
}

/** Header: 模式切换 + 状态徽章 + 操作按钮 */
function PreviewHeader({
  mode,
  onModeChange,
  isFullscreen,
  onToggleFullscreen,
  onRefresh,
  onReset,
  onSnapshot,
  onClose,
  status,
  fileCount,
}: PreviewHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 border-b border-surface-700 bg-surface-900/80 gap-2"
      data-testid="preview-header"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-hermes-500 font-semibold text-sm">🖼️ Preview</span>
        <StatusBadge status={status} />
        <span className="text-xs text-surface-500">{fileCount} 文件</span>
      </div>
      <div className="flex items-center gap-1">
        {/* 模式切换 */}
        <div className="flex items-center bg-surface-800 rounded mr-1" data-testid="preview-mode-switch">
          {(['html', 'react', 'iframe'] as PreviewMode[]).map((m) => (
            <button
              key={m}
              data-testid={`preview-mode-${m}`}
              onClick={() => onModeChange(m)}
              className={[
                'px-2 py-0.5 text-xs',
                m === mode
                  ? 'bg-hermes-500 text-white'
                  : 'text-surface-400 hover:text-surface-200',
                m === 'html' ? 'rounded-l' : m === 'iframe' ? 'rounded-r' : '',
              ].join(' ')}
              aria-pressed={m === mode}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <button
          onClick={onSnapshot}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
          title="保存当前快照"
          data-testid="preview-snapshot"
        >
          📸
        </button>
        <button
          onClick={onRefresh}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
          title="刷新"
          data-testid="preview-refresh"
        >
          ↻
        </button>
        <button
          onClick={onReset}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
          title="重置"
          data-testid="preview-reset"
        >
          ⌫
        </button>
        <button
          onClick={onToggleFullscreen}
          className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
          title={isFullscreen ? '退出全屏' : '全屏'}
          data-testid="preview-fullscreen"
        >
          {isFullscreen ? '⤡' : '⤢'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs text-surface-300 hover:text-surface-100 rounded hover:bg-surface-800"
            title="关闭"
            data-testid="preview-close"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

interface PreviewAreaProps {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  mode: PreviewMode;
  hasFiles: boolean;
  status: PreviewSnapshot['status'];
}

/** 预览区域：iframe + 空状态 */
function PreviewArea({ iframeRef, mode, hasFiles, status }: PreviewAreaProps) {
  const config: PreviewConfig = { mode };
  const sandboxAttr = buildSandboxAttr({ ...config, allowScripts: true, allowSameOrigin: true, debounceMs: 400 });

  if (!hasFiles) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center text-surface-500 text-sm gap-2 p-6"
        data-testid="preview-empty"
      >
        <div className="text-4xl">📭</div>
        <div>暂无预览内容</div>
        <div className="text-xs text-surface-600">
          添加 @file: 引用或在 Composer 中编辑文件以触发预览
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative bg-white" data-testid="preview-area">
      {status === 'compiling' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-950/50 z-10">
          <div className="text-surface-200 text-sm">编译中...</div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Preview"
        sandbox={sandboxAttr}
        className="w-full h-full border-0"
        data-testid="preview-iframe"
      />
    </div>
  );
}

interface PreviewErrorCardProps {
  error: PreviewError;
  onRetry: () => void;
}

/** 错误卡片：显示错误信息和重试按钮 */
function PreviewErrorCard({ error, onRetry }: PreviewErrorCardProps) {
  return (
    <div
      className="flex-1 flex items-center justify-center p-6"
      data-testid="preview-error-card"
      data-error-type={error.type}
    >
      <div className="max-w-md w-full bg-error-500/10 border border-error-500/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-error-400 text-lg">⚠️</span>
          <span className="text-error-300 font-semibold text-sm">
            {ERROR_TYPE_LABELS[error.type] ?? '未知错误'}
          </span>
        </div>
        <div className="text-surface-200 text-sm font-mono mb-2 break-all" data-testid="preview-error-message">
          {error.message}
        </div>
        {error.line !== undefined && (
          <div className="text-xs text-surface-500">
            行 {error.line}
            {error.column !== undefined ? ` · 列 ${error.column}` : ''}
          </div>
        )}
        {error.stack && (
          <pre className="mt-2 text-xs text-surface-400 bg-surface-900 p-2 rounded overflow-x-auto max-h-32">
            {error.stack}
          </pre>
        )}
        <button
          onClick={onRetry}
          className="mt-3 px-3 py-1 text-xs bg-error-500/20 text-error-300 rounded hover:bg-error-500/30"
          data-testid="preview-error-retry"
        >
          重试
        </button>
      </div>
    </div>
  );
}

interface PreviewSnapshotListProps {
  snapshots: PreviewSnapshot[];
  onApply: (snap: PreviewSnapshot) => void;
  onDelete: (id: string) => void;
}

/** 快照列表：展示历史快照 */
function PreviewSnapshotList({ snapshots, onApply, onDelete }: PreviewSnapshotListProps) {
  return (
    <div
      className="border-t border-surface-700 bg-surface-900/80 max-h-32 overflow-y-auto"
      data-testid="preview-snapshot-list"
    >
      <div className="px-3 py-1 text-xs text-surface-500 border-b border-surface-800">
        快照历史 ({snapshots.length})
      </div>
      {snapshots.map((snap) => (
        <div
          key={snap.id}
          className="flex items-center justify-between px-3 py-1 hover:bg-surface-800/50 text-xs"
          data-testid={`preview-snapshot-item-${snap.id}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-surface-400">
              {new Date(snap.createdAt).toLocaleTimeString()}
            </span>
            <span className="text-surface-300 truncate">
              {Object.keys(snap.files).join(', ') || '(empty)'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onApply(snap)}
              className="px-2 py-0.5 text-surface-400 hover:text-hermes-400"
              data-testid={`preview-snapshot-apply-${snap.id}`}
            >
              ↩
            </button>
            <button
              onClick={() => onDelete(snap.id)}
              className="px-2 py-0.5 text-surface-400 hover:text-error-400"
              data-testid={`preview-snapshot-delete-${snap.id}`}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface StatusBadgeProps {
  status: PreviewSnapshot['status'];
}

/** 状态徽章 */
function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    idle: { label: '空闲', color: 'bg-surface-700 text-surface-400' },
    compiling: { label: '编译中', color: 'bg-warning-500/20 text-warning-300' },
    ready: { label: '就绪', color: 'bg-success-500/20 text-success-300' },
    error: { label: '错误', color: 'bg-error-500/20 text-error-300' },
  };
  const c = config[status];
  return (
    <span
      data-testid={`preview-status-${status}`}
      className={['px-1.5 py-0.5 text-[10px] rounded', c.color].join(' ')}
    >
      {c.label}
    </span>
  );
}

// ============================================================
// 常量
// ============================================================

const MODE_LABELS: Record<PreviewMode, string> = {
  html: 'HTML',
  react: 'React',
  iframe: 'Iframe',
};

const ERROR_TYPE_LABELS: Record<PreviewError['type'], string> = {
  syntax: '语法错误',
  runtime: '运行时错误',
  network: '网络错误',
  unknown: '未知错误',
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 从 useComposer 提取预览文件
 * 优先级：initialFiles → context.files → accepted edits 的 afterContent
 */
function collectFiles(
  composer: ReturnType<typeof useComposer>,
  initialFiles?: Record<string, string>
): Record<string, string> {
  const files: Record<string, string> = {};

  // 1. 初始文件（最高优先级）
  if (initialFiles) {
    Object.assign(files, initialFiles);
  }

  // 2. context files
  for (const f of composer.session.context.files) {
    if (f.path && f.content) {
      files[f.path] = f.content;
    }
  }

  // 3. accepted/modified edits（作为已应用的文件）
  for (const edit of composer.session.edits) {
    if (edit.status === 'accepted' || edit.status === 'modified' || edit.status === 'pending') {
      if (edit.filePath && edit.afterContent) {
        files[edit.filePath] = edit.afterContent;
      }
    }
  }

  return files;
}

export default PreviewPanel;
