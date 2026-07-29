/**
 * # ============================================================
 * # SessionReplayPanel - 会话回放 UI (v1.0.0 Cycle 23 G23-02)
 * # ============================================================
 * # 核心作用：会话回放引擎的可视化界面
 * # 主要功能：
 * #   1. 回放列表（CRUD）
 * #   2. 时间轴回放（进度条/速度控制/暂停/上下帧）
 * #   3. 帧详情（消息/工具调用/思考/工作流/用户操作）
 * #   4. 导出（JSON/HTML/Markdown）
 * #   5. 分享链接
 * #   6. 录制入口
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-02 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getSessionReplayEngine,
  type ReplaySession,
  type ReplayState,
  type ReplayFrame,
  type ReplayFrameType,
  type ReplayExportFormat,
  type ShareInfo,
  type ToolCallFrameData,
  type MessageFrameData,
  type ThinkingFrameData,
  type WorkflowStageFrameData,
  type UserActionFrameData,
} from '../utils/sessionReplay';
import { EmptyState } from './EmptyState';

interface SessionReplayPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const FRAME_TYPE_LABELS: Record<ReplayFrameType, string> = {
  message: '消息',
  'tool-call': '工具调用',
  thinking: '思考',
  'workflow-stage': '工作流',
  'user-action': '用户操作',
};

const FRAME_TYPE_COLORS: Record<ReplayFrameType, string> = {
  message: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'tool-call': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  thinking: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'workflow-stage': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'user-action': 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
};

const HIGHLIGHT_COLORS: Record<string, string> = {
  'user-action': 'border-l-yellow-400',
  error: 'border-l-rose-500',
  'tool-call': 'border-l-cyan-400',
  'stage-change': 'border-l-violet-500',
};

const SPEED_OPTIONS = [0.5, 1, 2, 4];

export function SessionReplayPanel({ isOpen, onClose }: SessionReplayPanelProps) {
  const engine = useMemo(() => getSessionReplayEngine(), []);
  const [replays, setReplays] = useState<ReplaySession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<ReplayState>(engine.getState());
  const [currentFrame, setCurrentFrame] = useState<ReplayFrame | null>(engine.getCurrentFrame());
  const [exportFormat, setExportFormat] = useState<ReplayExportFormat>('markdown');
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'replay' | 'record'>('list');
  const [error, setError] = useState<string | null>(null);
  const [exportedContent, setExportedContent] = useState<string | null>(null);
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 录制表单
  const [recordingTitle, setRecordingTitle] = useState('');
  const [recordingFrames, setRecordingFrames] = useState<Array<{
    type: ReplayFrameType;
    content: string;
    highlight?: string;
  }>>([{ type: 'message', content: '', highlight: undefined }]);

  const refresh = useCallback(() => {
    setReplays(engine.listReplays());
    setState(engine.getState());
    setCurrentFrame(engine.getCurrentFrame());
  }, [engine]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const off1 = engine.on('replay-created', refresh);
    const off2 = engine.on('play', refresh);
    const off3 = engine.on('pause', refresh);
    const off4 = engine.on('seek', refresh);
    const off5 = engine.on('ended', refresh);
    const off6 = engine.on('frame-added', refresh);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
      off6();
    };
  }, [isOpen, engine, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' && activeTab === 'replay') {
        e.preventDefault();
        if (state.isPlaying) engine.pause();
        else engine.play();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, activeTab, state.isPlaying, engine]);

  // 选中回放
  const handleSelect = useCallback(
    (replayId: string) => {
      setError(null);
      try {
        engine.loadReplay(replayId);
        setSelectedId(replayId);
        setActiveTab('replay');
        setShare(null);
        setExportedContent(null);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    },
    [engine, refresh]
  );

  // 删除
  const handleDelete = useCallback(
    (replayId: string) => {
      if (!confirm('确认删除此回放？')) return;
      engine.deleteReplay(replayId);
      if (selectedId === replayId) {
        setSelectedId(null);
        setActiveTab('list');
      }
      refresh();
    },
    [engine, selectedId, refresh]
  );

  // 导出
  const handleExport = useCallback(() => {
    if (!selectedId) return;
    try {
      const content = engine.exportReplay(selectedId, exportFormat);
      setExportedContent(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  }, [engine, selectedId, exportFormat]);

  // 下载导出
  const handleDownload = useCallback(() => {
    if (!exportedContent || !selectedId) return;
    const blob = new Blob([exportedContent], {
      type: exportFormat === 'json' ? 'application/json' : exportFormat === 'html' ? 'text/html' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replay-${selectedId.slice(0, 12)}.${exportFormat === 'markdown' ? 'md' : exportFormat}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportedContent, selectedId, exportFormat]);

  // 分享
  const handleShare = useCallback(() => {
    if (!selectedId) return;
    try {
      const info = engine.createShareLink(selectedId);
      setShare(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : '分享失败');
    }
  }, [engine, selectedId]);

  // 进度条跳转
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedId) return;
      const pct = Number(e.target.value);
      const replay = engine.getCurrentReplay();
      if (!replay) return;
      const targetTime = (pct / 100) * replay.metadata.duration;
      if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = setTimeout(() => {
        engine.seekToTime(targetTime);
        refresh();
      }, 50);
    },
    [engine, selectedId, refresh]
  );

  // 录制相关
  const handleStartRecording = useCallback(() => {
    if (!recordingTitle.trim()) {
      setError('请输入回放标题');
      return;
    }
    const sessionId = `session-${Date.now()}`;
    engine.startRecording(sessionId, recordingTitle.trim());
    setActiveTab('replay');
    setError(null);
  }, [engine, recordingTitle]);

  const handleStopRecording = useCallback(() => {
    const replay = engine.stopRecording();
    if (replay) {
      setSelectedId(replay.replayId);
      engine.loadReplay(replay.replayId);
      refresh();
    }
  }, [engine, refresh]);

  const handleAddFrame = useCallback(() => {
    setRecordingFrames((prev) => [...prev, { type: 'message', content: '', highlight: undefined }]);
  }, []);

  const handleAddDemoFrames = useCallback(() => {
    setRecordingFrames([
      { type: 'message', content: '用户: 帮我实现一个用户认证函数', highlight: undefined },
      { type: 'thinking', content: '分析需求: 需要 bcrypt 加密 + JWT 令牌', highlight: undefined },
      { type: 'message', content: '助手: 我将为您实现一个完整的认证函数', highlight: undefined },
      { type: 'tool-call', content: 'tool: writeFile args: {path: auth.ts}', highlight: 'tool-call' },
      { type: 'message', content: '助手: 认证函数已创建完成', highlight: undefined },
      { type: 'workflow-stage', content: 'stage: review', highlight: 'stage-change' },
      { type: 'user-action', content: 'action: approve', highlight: 'user-action' },
    ]);
  }, []);

  const handleSaveRecording = useCallback(() => {
    if (!engine.isRecording()) {
      setError('未在录制状态');
      return;
    }
    recordingFrames.forEach((f) => {
      let data: any;
      switch (f.type) {
        case 'message':
          data = { role: 'user', content: f.content } as MessageFrameData;
          break;
        case 'tool-call':
          data = {
            toolName: f.content.split(' ')[0] || 'unknown',
            args: {},
            durationMs: 100,
          } as ToolCallFrameData;
          break;
        case 'thinking':
          data = { content: f.content, durationMs: 50 } as ThinkingFrameData;
          break;
        case 'workflow-stage':
          data = { stage: f.content, status: 'enter' } as WorkflowStageFrameData;
          break;
        case 'user-action':
          data = { action: 'edit' } as UserActionFrameData;
          break;
      }
      engine.addFrame(f.type, data, { highlight: f.highlight as any });
    });
    handleStopRecording();
    setRecordingFrames([{ type: 'message', content: '', highlight: undefined }]);
  }, [engine, recordingFrames, handleStopRecording]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="session-replay-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-7xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
              <span className="text-white text-sm">⏮️</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">会话回放</h2>
              <p className="text-xs text-slate-400">录制 / 回放 / 分享 完整对话流程</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            data-testid="replay-close"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {(
            [
              { key: 'list', label: '回放列表' },
              { key: 'replay', label: '回放控制' },
              { key: 'record', label: '新建录制' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`replay-tab-${t.key}`}
              className={`px-4 py-2 text-sm transition ${
                activeTab === t.key
                  ? 'text-white border-b-2 border-primary-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {error && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm max-w-md">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 text-rose-400 hover:text-rose-200"
              >
                ×
              </button>
            </div>
          )}

          {activeTab === 'list' && (
            <ReplayListTab
              replays={replays}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onCreateNew={() => setActiveTab('record')}
            />
          )}
          {activeTab === 'replay' && (
            <ReplayControlTab
              engine={engine}
              state={state}
              currentFrame={currentFrame}
              exportFormat={exportFormat}
              setExportFormat={setExportFormat}
              share={share}
              onPlay={() => engine.play()}
              onPause={() => engine.pause()}
              onStop={() => engine.stop()}
              onNext={() => engine.next()}
              onPrev={() => engine.prev()}
              onSeek={handleSeek}
              onSetSpeed={(s) => engine.setSpeed(s)}
              onJumpTo={(idx) => engine.seekTo(idx)}
              onExport={handleExport}
              onDownload={handleDownload}
              onShare={handleShare}
              exportedContent={exportedContent}
            />
          )}
          {activeTab === 'record' && (
            <RecordTab
              title={recordingTitle}
              setTitle={setRecordingTitle}
              frames={recordingFrames}
              setFrames={setRecordingFrames}
              isRecording={engine.isRecording()}
              onStart={handleStartRecording}
              onSave={handleSaveRecording}
              onAddFrame={handleAddFrame}
              onAddDemo={handleAddDemoFrames}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ====== Tab 子组件 ======

function ReplayListTab({
  replays,
  onSelect,
  onDelete,
  onCreateNew,
}: {
  replays: ReplaySession[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5" data-testid="replay-list">
      {replays.length === 0 ? (
        <EmptyState
          icon="⏮️"
          title="暂无回放"
          description="录制一个会话后可在此查看回放，支持时间轴跳转、速度控制、导出/分享。"
          tone="info"
          testId="replay-empty"
          action={{
            label: '新建录制',
            onClick: onCreateNew,
            variant: 'primary',
            testId: 'replay-empty-create',
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {replays.map((r) => (
            <div
              key={r.replayId}
              className="bg-surface-800 border border-surface-700 rounded-lg p-4 hover:border-primary-500/50 transition"
            >
              <h3 className="text-white font-medium mb-2 truncate">{r.title}</h3>
              <div className="text-xs text-slate-400 space-y-1">
                <div>Session: <span className="font-mono">{r.sessionId.slice(0, 16)}</span></div>
                <div>消息: {r.metadata.totalMessages} · 工具: {r.metadata.totalToolCalls} · 错误: {r.metadata.totalErrors}</div>
                <div>时长: {(r.metadata.duration / 1000).toFixed(1)}s · 帧数: {r.frames.length}</div>
                <div>{new Date(r.createdAt).toLocaleString()}</div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onSelect(r.replayId)}
                  data-testid={`replay-open-${r.replayId}`}
                  className="flex-1 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
                >
                  打开
                </button>
                <button
                  onClick={() => onDelete(r.replayId)}
                  data-testid={`replay-delete-${r.replayId}`}
                  className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded transition"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplayControlTab({
  engine,
  state,
  currentFrame,
  exportFormat,
  setExportFormat,
  share,
  onPlay,
  onPause,
  onStop,
  onNext,
  onPrev,
  onSeek,
  onSetSpeed,
  onJumpTo,
  onExport,
  onDownload,
  onShare,
  exportedContent,
}: {
  engine: ReturnType<typeof getSessionReplayEngine>;
  state: ReplayState;
  currentFrame: ReplayFrame | null;
  exportFormat: ReplayExportFormat;
  setExportFormat: (f: ReplayExportFormat) => void;
  share: ShareInfo | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSetSpeed: (s: number) => void;
  onJumpTo: (idx: number) => void;
  onExport: () => void;
  onDownload: () => void;
  onShare: () => void;
  exportedContent: string | null;
}) {
  const replay = engine.getCurrentReplay();
  if (!replay) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        请从回放列表选择一项，或新建录制
      </div>
    );
  }
  const progress = replay.metadata.duration > 0 ? (state.currentTime / replay.metadata.duration) * 100 : 0;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：帧列表 */}
      <div className="w-72 border-r border-surface-700 flex flex-col bg-surface-900/30">
        <div className="px-3 py-2 border-b border-surface-700 text-xs text-slate-400">
          帧列表 ({replay.frames.length})
        </div>
        <div className="flex-1 overflow-y-auto" data-testid="replay-frame-list">
          {replay.frames.map((f, i) => (
            <button
              key={f.frameId}
              onClick={() => onJumpTo(i)}
              data-testid={`replay-frame-${i}`}
              className={`w-full px-3 py-2 text-left text-xs border-b border-surface-700 transition ${
                i === state.currentFrameIndex
                  ? 'bg-primary-500/20 text-white'
                  : 'hover:bg-surface-800 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] ${FRAME_TYPE_COLORS[f.type]}`}>
                  {FRAME_TYPE_LABELS[f.type]}
                </span>
                <span className="text-slate-500 font-mono">#{i + 1}</span>
              </div>
              <div className="text-[10px] text-slate-500">{((f.timestamp / 1000)).toFixed(1)}s</div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：详情 + 控制 */}
      <div className="flex-1 flex flex-col">
        {/* 元数据 */}
        <div className="px-5 py-3 border-b border-surface-700 bg-surface-800/50">
          <h3 className="text-white font-medium mb-1">{replay.title}</h3>
          <div className="text-xs text-slate-400 grid grid-cols-4 gap-2">
            <div>消息: {replay.metadata.totalMessages}</div>
            <div>工具: {replay.metadata.totalToolCalls}</div>
            <div>错误: {replay.metadata.totalErrors}</div>
            <div>时长: {(replay.metadata.duration / 1000).toFixed(1)}s</div>
            <div>模型: {replay.metadata.models.join(', ') || '-'}</div>
            <div>工具集: {replay.metadata.tools.join(', ') || '-'}</div>
            <div>用户操作: {replay.metadata.totalUserActions}</div>
            <div>思考: {replay.metadata.totalThinking}</div>
          </div>
        </div>

        {/* 当前帧 */}
        <div className="flex-1 overflow-y-auto p-5">
          {currentFrame ? (
            <div
              data-testid="replay-current-frame"
              className={`bg-surface-800 border border-surface-700 rounded-lg p-4 border-l-4 ${
                currentFrame.highlight ? HIGHLIGHT_COLORS[currentFrame.highlight] : 'border-l-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2 py-0.5 rounded text-xs border ${FRAME_TYPE_COLORS[currentFrame.type]}`}>
                  {FRAME_TYPE_LABELS[currentFrame.type]}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  # {state.currentFrameIndex + 1} / {replay.frames.length} ·{' '}
                  {((currentFrame.timestamp / 1000)).toFixed(1)}s
                </span>
              </div>
              {currentFrame.highlight && (
                <div className="mb-2 text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-block">
                  ⚠ 高亮: {currentFrame.highlight}
                </div>
              )}
              <FrameBody frame={currentFrame} />
            </div>
          ) : (
            <div className="text-center text-slate-500 py-12">选择一帧查看详情</div>
          )}

          {/* 导出/分享 */}
          <div className="mt-5 bg-surface-800 border border-surface-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">导出 / 分享</h4>
            <div className="flex flex-wrap gap-2 mb-3">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ReplayExportFormat)}
                data-testid="replay-export-format"
                className="px-2 py-1 bg-surface-700 text-white text-xs rounded border border-surface-600"
              >
                <option value="json">JSON</option>
                <option value="html">HTML</option>
                <option value="markdown">Markdown</option>
              </select>
              <button
                onClick={onExport}
                data-testid="replay-export"
                className="px-3 py-1 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
              >
                预览
              </button>
              <button
                onClick={onDownload}
                disabled={!exportedContent}
                data-testid="replay-download"
                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-surface-700 text-white text-xs rounded transition"
              >
                下载
              </button>
              <button
                onClick={onShare}
                data-testid="replay-share"
                className="px-3 py-1 bg-violet-500 hover:bg-violet-600 text-white text-xs rounded transition"
              >
                生成分享链接
              </button>
            </div>
            {share && (
              <div className="text-xs text-slate-300 bg-surface-900 border border-surface-700 rounded p-2 font-mono break-all" data-testid="replay-share-url">
                {share.url}
                <div className="text-slate-500 mt-1">过期: {new Date(share.expiresAt).toLocaleString()}</div>
              </div>
            )}
            {exportedContent && (
              <pre className="mt-3 max-h-40 overflow-auto text-[10px] text-slate-300 bg-surface-900 border border-surface-700 rounded p-2 whitespace-pre-wrap" data-testid="replay-export-preview">
                {exportedContent.slice(0, 2000)}
                {exportedContent.length > 2000 ? '\n... (截断显示)' : ''}
              </pre>
            )}
          </div>
        </div>

        {/* 控制栏 */}
        <div className="border-t border-surface-700 bg-surface-800/50 p-4" data-testid="replay-controls">
          {/* 进度条 */}
          <div className="mb-3">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress}
              onChange={onSeek}
              data-testid="replay-progress"
              className="w-full accent-primary-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>{(state.currentTime / 1000).toFixed(1)}s</span>
              <span>{(replay.metadata.duration / 1000).toFixed(1)}s</span>
            </div>
          </div>
          {/* 控制按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={onStop}
              data-testid="replay-stop"
              className="px-2 py-1 bg-surface-700 hover:bg-surface-600 text-white text-xs rounded transition"
              title="停止"
            >
              ⏹
            </button>
            <button
              onClick={onPrev}
              data-testid="replay-prev"
              className="px-2 py-1 bg-surface-700 hover:bg-surface-600 text-white text-xs rounded transition"
              title="上一帧"
            >
              ⏮
            </button>
            {state.isPlaying ? (
              <button
                onClick={onPause}
                data-testid="replay-pause"
                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded transition"
              >
                ⏸ 暂停
              </button>
            ) : (
              <button
                onClick={onPlay}
                data-testid="replay-play"
                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded transition"
              >
                ▶ 播放
              </button>
            )}
            <button
              onClick={onNext}
              data-testid="replay-next"
              className="px-2 py-1 bg-surface-700 hover:bg-surface-600 text-white text-xs rounded transition"
              title="下一帧"
            >
              ⏭
            </button>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-slate-400">速度:</span>
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSetSpeed(s)}
                  data-testid={`replay-speed-${s}`}
                  className={`px-2 py-1 text-xs rounded transition ${
                    state.playbackSpeed === s
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-700 hover:bg-surface-600 text-slate-300'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameBody({ frame }: { frame: ReplayFrame }) {
  switch (frame.type) {
    case 'message': {
      const d = frame.data as MessageFrameData;
      return (
        <div>
          <div className="text-xs text-slate-400 mb-1">
            角色: {d.role} {d.model && `· 模型: ${d.model}`}
          </div>
          <div className="text-sm text-white whitespace-pre-wrap">{d.content}</div>
        </div>
      );
    }
    case 'tool-call': {
      const d = frame.data as ToolCallFrameData;
      return (
        <div>
          <div className="text-sm text-cyan-300 font-medium mb-2">
            🔧 {d.toolName} ({d.durationMs}ms)
          </div>
          {d.args && Object.keys(d.args).length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-slate-400 mb-1">参数:</div>
              <pre className="text-[10px] text-slate-300 bg-surface-900 border border-surface-700 rounded p-2 overflow-auto max-h-32">
                {JSON.stringify(d.args, null, 2)}
              </pre>
            </div>
          )}
          {d.result != null && (
            <div className="mb-2">
              <div className="text-xs text-slate-400 mb-1">结果:</div>
              <pre className="text-[10px] text-slate-300 bg-surface-900 border border-surface-700 rounded p-2 overflow-auto max-h-32">
                {JSON.stringify(d.result, null, 2)}
              </pre>
            </div>
          )}
          {d.error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded p-2">
              ❌ {d.error}
            </div>
          )}
        </div>
      );
    }
    case 'thinking': {
      const d = frame.data as ThinkingFrameData;
      return (
        <div className="italic">
          <div className="text-xs text-violet-400 mb-1">💭 思考过程</div>
          <div className="text-sm text-violet-200 whitespace-pre-wrap">{d.content}</div>
        </div>
      );
    }
    case 'workflow-stage': {
      const d = frame.data as WorkflowStageFrameData;
      return (
        <div>
          <div className="text-sm text-amber-300 font-medium">
            📍 {d.stage} ({d.status})
          </div>
          {d.previousStage && (
            <div className="text-xs text-slate-400 mt-1">上一阶段: {d.previousStage}</div>
          )}
        </div>
      );
    }
    case 'user-action': {
      const d = frame.data as UserActionFrameData;
      return (
        <div>
          <div className="text-sm text-fuchsia-300 font-medium">👆 用户操作: {d.action}</div>
          {d.details && Object.keys(d.details).length > 0 && (
            <pre className="text-[10px] text-slate-300 bg-surface-900 border border-surface-700 rounded p-2 mt-2 overflow-auto max-h-32">
              {JSON.stringify(d.details, null, 2)}
            </pre>
          )}
        </div>
      );
    }
  }
}

function RecordTab({
  title,
  setTitle,
  frames,
  setFrames,
  isRecording,
  onStart,
  onSave,
  onAddFrame,
  onAddDemo,
}: {
  title: string;
  setTitle: (s: string) => void;
  frames: Array<{ type: ReplayFrameType; content: string; highlight?: string }>;
  setFrames: (f: Array<{ type: ReplayFrameType; content: string; highlight?: string }>) => void;
  isRecording: boolean;
  onStart: () => void;
  onSave: () => void;
  onAddFrame: () => void;
  onAddDemo: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5" data-testid="replay-record">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">新建录制</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="回放标题..."
              data-testid="record-title"
              className="flex-1 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
              disabled={isRecording}
            />
            {!isRecording ? (
              <button
                onClick={onStart}
                data-testid="record-start"
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded transition"
              >
                开始录制
              </button>
            ) : (
              <button
                onClick={onSave}
                data-testid="record-save"
                className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded transition"
              >
                完成并保存
              </button>
            )}
            <button
              onClick={onAddDemo}
              data-testid="record-demo"
              className="px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white text-sm rounded transition"
            >
              填充示例
            </button>
          </div>
          {isRecording && (
            <div className="mt-2 text-xs text-amber-300">● 正在录制中...</div>
          )}
        </div>

        <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-medium">帧定义 ({frames.length})</h3>
            <button
              onClick={onAddFrame}
              data-testid="record-add-frame"
              className="px-2 py-1 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
            >
              + 添加帧
            </button>
          </div>
          <div className="space-y-2">
            {frames.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface-900 border border-surface-700 rounded p-2">
                <span className="text-xs text-slate-500 w-8">#{i + 1}</span>
                <select
                  value={f.type}
                  onChange={(e) => {
                    const next = [...frames];
                    next[i] = { ...f, type: e.target.value as ReplayFrameType };
                    setFrames(next);
                  }}
                  data-testid={`record-frame-type-${i}`}
                  className="px-2 py-1 bg-surface-700 text-white text-xs rounded border border-surface-600"
                >
                  {(Object.keys(FRAME_TYPE_LABELS) as ReplayFrameType[]).map((t) => (
                    <option key={t} value={t}>
                      {FRAME_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={f.content}
                  onChange={(e) => {
                    const next = [...frames];
                    next[i] = { ...f, content: e.target.value };
                    setFrames(next);
                  }}
                  placeholder="帧内容..."
                  data-testid={`record-frame-content-${i}`}
                  className="flex-1 px-2 py-1 bg-surface-800 border border-surface-700 rounded text-white text-sm"
                />
                <button
                  onClick={() => {
                    setFrames(frames.filter((_, idx) => idx !== i));
                  }}
                  data-testid={`record-frame-remove-${i}`}
                  className="px-2 py-1 text-rose-300 hover:bg-rose-500/20 rounded text-xs transition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
