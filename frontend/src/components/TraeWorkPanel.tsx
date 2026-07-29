/**
 * # ============================================================
 * # TraeWorkPanel - TRAE Work 多模态协作主面板
 * # ============================================================
 * # 核心作用：提供 TRAE Work 4 大子系统的可视化操作界面
 * #   1. Design Mode  - 6 模板 + NL 编辑 + 代码导出
 * #   2. Voice Chat   - 会话 + 上下文 + Web 搜索
 * #   3. Global Memory - 项目级知识库
 * #   4. Video        - 元数据 + 关键帧 + 摘要 + Mock 生成
 * # 运行流程：
 * #   1. 用户选择 Tab 切换子系统
 * #   2. Design: 选模板 → 创建草图 → NL 编辑 → 导出
 * #   3. Voice:  创建会话 → 发送消息（带上下文） → 关闭
 * #   4. Memory: 创建条目 → 多维搜索 → 编辑/删除
 * #   5. Video:  注册视频（file_path）→ 提取关键帧 → 摘要 → Mock 生成
 * # 输入参数：useWorkApi 提供 API 调用，props.onClose 关闭回调
 * # 输出结果：完整的 TRAE Work 多模态协作界面
 * # 修改记录：
 * #   - 2026-07-28 | v6.31.0 | Cycle 14 P1-3 初始版本
 * # ============================================================
 */

import React, { useEffect, useState } from 'react';
import {
  type DesignDraft,
  type VoiceSession,
  type KnowledgeEntry,
  type VideoMetadata,
  type VideoSummary,
  type VideoGeneration,
  type WorkStats,
  type DesignTemplate,
  type ExportFormat,
  type KnowledgeCategory,
  TEMPLATE_OPTIONS,
  CATEGORY_OPTIONS,
  VIDEO_STYLE_OPTIONS,
  formatFileSize,
  formatDuration,
  getWorkStats,
  listDrafts,
  createDraft,
  deleteDraft,
  applyNLEdit,
  exportDesign,
  listVoiceSessions,
  createVoiceSession,
  sendVoiceMessage,
  closeVoiceSession,
  listMemoryEntries,
  createMemoryEntry,
  searchMemory,
  deleteMemoryEntry,
  listVideos,
  uploadVideo,
  extractFrames,
  summarizeVideo,
  generateVideo,
  listGenerations,
  deleteVideo,
} from '../hooks/useWorkApi';

interface TraeWorkPanelProps {
  onClose?: () => void;
  defaultUser?: string;
  defaultProject?: string;
}

type Tab = 'design' | 'voice' | 'memory' | 'video';

const TABS: Array<{ key: Tab; label: string; icon: string; color: string }> = [
  { key: 'design', label: 'Design Mode', icon: '🎨', color: 'pink' },
  { key: 'voice', label: 'Voice Chat', icon: '🎙️', color: 'blue' },
  { key: 'memory', label: 'Global Memory', icon: '🧠', color: 'violet' },
  { key: 'video', label: 'Video Studio', icon: '🎬', color: 'orange' },
];

export const TraeWorkPanel: React.FC<TraeWorkPanelProps> = ({
  onClose,
  defaultUser = 'web_user',
  defaultProject = 'demo_project',
}) => {
  const [tab, setTab] = useState<Tab>('design');
  const [stats, setStats] = useState<WorkStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshStats = async () => {
    try {
      const r = await getWorkStats();
      if (r.success) setStats(r.stats);
    } catch (e) {
      console.error('Failed to load work stats:', e);
    }
  };

  useEffect(() => {
    refreshStats();
  }, []);

  const handleError = (e: any, fallback: string) => {
    const msg = e?.message || fallback;
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  return (
    <div className="flex flex-col h-full bg-surface-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/50 bg-gradient-to-r from-pink-500/10 via-violet-500/10 to-orange-500/10">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧰</span>
          <div>
            <h2 className="text-lg font-semibold text-surface-800">TRAE Work 多模态协作</h2>
            <p className="text-xs text-surface-500">Design · Voice · Memory · Video</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-300/50 flex items-center justify-center text-surface-600"
            aria-label="关闭"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="px-5 py-2 bg-surface-200/30 border-b border-surface-300/30 flex items-center gap-4 text-xs flex-wrap">
          <span className="text-surface-600">🎨 草图: <b>{stats.design?.drafts ?? 0}</b></span>
          <span className="text-surface-600">🎙️ 语音消息: <b>{stats.voice?.messages ?? 0}</b></span>
          <span className="text-surface-600">🧠 知识条目: <b>{stats.memory?.entries ?? 0}</b></span>
          <span className="text-surface-600">🎬 视频: <b>{stats.video?.videos ?? 0}</b></span>
          <span className="text-surface-600">✨ 生成: <b>{stats.video?.generations ?? 0}</b></span>
          <button
            onClick={refreshStats}
            className="ml-auto text-violet-600 hover:text-violet-700 px-2 py-0.5 rounded"
          >
            🔄 刷新
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-300/30 bg-surface-100 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-[120px] px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'text-pink-600 border-b-2 border-pink-500 bg-pink-50/50'
                : 'text-surface-600 hover:text-surface-800 hover:bg-surface-200/30'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'design' && (
          <DesignTab
            user={defaultUser}
            onBusyChange={setBusy}
            onError={handleError}
            onChanged={refreshStats}
          />
        )}
        {tab === 'voice' && (
          <VoiceTab
            user={defaultUser}
            project={defaultProject}
            onBusyChange={setBusy}
            onError={handleError}
            onChanged={refreshStats}
          />
        )}
        {tab === 'memory' && (
          <MemoryTab
            project={defaultProject}
            onBusyChange={setBusy}
            onError={handleError}
            onChanged={refreshStats}
          />
        )}
        {tab === 'video' && (
          <VideoTab
            user={defaultUser}
            onBusyChange={setBusy}
            onError={handleError}
            onChanged={refreshStats}
          />
        )}
      </div>

      {/* Footer status */}
      <div className="px-5 py-1.5 bg-surface-200/30 border-t border-surface-300/30 text-xs text-surface-500 flex items-center justify-between">
        <span>v6.31.0 · TRAE Work</span>
        {busy && <span className="text-pink-600">⏳ 处理中…</span>}
      </div>
    </div>
  );
};

// ============================================================
// Design Mode Tab
// ============================================================

interface DesignTabProps {
  user: string;
  onBusyChange: (b: boolean) => void;
  onError: (e: any, fallback: string) => void;
  onChanged: () => void | Promise<void>;
}

const DesignTab: React.FC<DesignTabProps> = ({ user, onBusyChange, onError, onChanged }) => {
  const [drafts, setDrafts] = useState<DesignDraft[]>([]);
  const [name, setName] = useState('My Page');
  const [template, setTemplate] = useState<DesignTemplate>('web');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [selected, setSelected] = useState<DesignDraft | null>(null);
  const [nlInstruction, setNlInstruction] = useState('把主色改为 #3B82F6');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('html');
  const [exportedCode, setExportedCode] = useState<string>('');

  const refresh = async () => {
    try {
      const r = await listDrafts({ owner: user, limit: 50 });
      if (r.success) setDrafts(r.drafts);
    } catch (e) {
      onError(e, 'Failed to list drafts');
    }
  };

  useEffect(() => {
    refresh();
  }, [user]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    onBusyChange(true);
    try {
      const r = await createDraft({
        name: name.trim(),
        template,
        description: description.trim(),
        owner: user,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (r.success) {
        setSelected(r.draft);
        setDescription('');
        setTags('');
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Create failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleNLEdit = async () => {
    if (!selected || !nlInstruction.trim()) return;
    onBusyChange(true);
    try {
      const r = await applyNLEdit(selected.draft_id, nlInstruction.trim());
      if (r.success && r.draft) {
        setSelected(r.draft);
        setNlInstruction('');
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'NL edit failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleExport = async () => {
    if (!selected) return;
    onBusyChange(true);
    try {
      const r = await exportDesign(selected.draft_id, exportFormat);
      if (r.success) {
        setExportedCode(r.code);
      }
    } catch (e) {
      onError(e, 'Export failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleDelete = async (draft: DesignDraft) => {
    if (!confirm(`确定删除草图 ${draft.name}?`)) return;
    onBusyChange(true);
    try {
      await deleteDraft(draft.draft_id);
      if (selected?.draft_id === draft.draft_id) {
        setSelected(null);
        setExportedCode('');
      }
      await refresh();
      await onChanged();
    } catch (e) {
      onError(e, 'Delete failed');
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左侧：创建 + 列表 */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">➕ 创建新草图</h3>
          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="草图名称"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            />
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as DesignTemplate)}
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            >
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-surface-500 -mt-1">
              {TEMPLATE_OPTIONS.find((t) => t.value === template)?.description}
            </p>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述（可选）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            />
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="标签（逗号分隔）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            />
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className="w-full py-1.5 text-sm font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:bg-surface-300 rounded-lg transition-colors"
            >
              🎨 创建草图
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">📋 草图列表 ({drafts.length})</h3>
          {drafts.length === 0 ? (
            <p className="text-xs text-surface-400 text-center py-4">暂无草图</p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {drafts.map((d) => (
                <div
                  key={d.draft_id}
                  className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                    selected?.draft_id === d.draft_id
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-surface-300/50 hover:bg-surface-200/30'
                  }`}
                  onClick={() => {
                    setSelected(d);
                    setExportedCode('');
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-800 truncate">{d.name}</p>
                      <p className="text-xs text-surface-500">
                        {d.template} · v{d.version} · {new Date(d.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(d);
                      }}
                      className="ml-2 text-red-500 hover:text-red-700 text-sm"
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：编辑 + 预览 */}
      <div className="space-y-4">
        {selected ? (
          <>
            <div className="bg-white rounded-xl p-4 border border-surface-300/50">
              <h3 className="text-sm font-semibold text-surface-800 mb-3">
                ✏️ NL 编辑 · {selected.name}
              </h3>
              <div className="space-y-2">
                <input
                  type="text"
                  value={nlInstruction}
                  onChange={(e) => setNlInstruction(e.target.value)}
                  placeholder='如：把主色改为 #FF0000 / 改成红色 / 按钮改成圆角'
                  className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
                />
                <button
                  onClick={handleNLEdit}
                  disabled={!nlInstruction.trim()}
                  className="w-full py-1.5 text-sm font-medium text-white bg-violet-500 hover:bg-violet-600 disabled:bg-surface-300 rounded-lg transition-colors"
                >
                  ✨ 应用编辑
                </button>
                <div className="text-xs text-surface-500 space-y-0.5">
                  <p>💡 提示：</p>
                  <p>• 颜色：&quot;改成红色&quot; / &quot;主色改为 #3B82F6&quot;</p>
                  <p>• 圆角：&quot;按钮改成圆角/圆形&quot;</p>
                  <p>• 字体：&quot;字体改为思源黑体&quot;</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 border border-surface-300/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-surface-800">📤 导出代码</h3>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="text-xs px-2 py-1 border border-surface-300 rounded"
                >
                  <option value="html">HTML</option>
                  <option value="react">React</option>
                  <option value="tailwind">Tailwind</option>
                  <option value="vue">Vue</option>
                </select>
              </div>
              <button
                onClick={handleExport}
                className="w-full py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors mb-3"
              >
                🚀 导出为 {exportFormat.toUpperCase()}
              </button>
              {exportedCode && (
                <pre className="text-[10px] bg-surface-200/50 p-2 rounded overflow-x-auto max-h-[200px]">
                  {exportedCode.slice(0, 1000)}
                  {exportedCode.length > 1000 && '\n... (truncated)'}
                </pre>
              )}
            </div>

            <div className="bg-white rounded-xl p-4 border border-surface-300/50">
              <h3 className="text-sm font-semibold text-surface-800 mb-2">👁️ HTML 预览</h3>
              <iframe
                title="design-preview"
                srcDoc={selected.html}
                className="w-full h-[200px] border border-surface-300/50 rounded bg-white"
                sandbox=""
              />
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl p-8 border border-surface-300/50 text-center text-surface-400">
            <p className="text-4xl mb-2">🎨</p>
            <p className="text-sm">选择或创建一个草图开始编辑</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Voice Chat Tab
// ============================================================

interface VoiceTabProps {
  user: string;
  project: string;
  onBusyChange: (b: boolean) => void;
  onError: (e: any, fallback: string) => void;
  onChanged: () => void | Promise<void>;
}

const VoiceTab: React.FC<VoiceTabProps> = ({
  user,
  project,
  onBusyChange,
  onError,
  onChanged,
}) => {
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [activeSession, setActiveSession] = useState<VoiceSession | null>(null);
  const [initialMsg, setInitialMsg] = useState('');
  const [message, setMessage] = useState('');
  const [useContext, setUseContext] = useState(true);
  const [useWeb, setUseWeb] = useState(false);

  const refresh = async () => {
    try {
      const r = await listVoiceSessions({ user_id: user, limit: 30 });
      if (r.success) setSessions(r.sessions);
    } catch (e) {
      onError(e, 'Failed to list sessions');
    }
  };

  useEffect(() => {
    refresh();
  }, [user]);

  const handleCreate = async () => {
    onBusyChange(true);
    try {
      const r = await createVoiceSession({
        user_id: user,
        project_id: project,
        initial_message: initialMsg.trim() || undefined,
      });
      if (r.success) {
        setActiveSession(r.session);
        setInitialMsg('');
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Create session failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleSend = async () => {
    if (!activeSession || !message.trim()) return;
    onBusyChange(true);
    try {
      const r = await sendVoiceMessage(activeSession.session_id, message.trim(), {
        use_context: useContext,
        use_web_search: useWeb,
      });
      if (r.success) {
        setMessage('');
        // 重新获取最新 session
        const refreshed = sessions.find((s) => s.session_id === activeSession.session_id);
        if (refreshed) {
          setActiveSession({
            ...refreshed,
            messages: [...refreshed.messages, r.message, r.reply],
            context_refs: Array.from(
              new Set([...refreshed.context_refs, ...(r.context_refs || [])]),
            ),
          });
        }
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Send message failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleClose = async (session: VoiceSession) => {
    onBusyChange(true);
    try {
      await closeVoiceSession(session.session_id);
      if (activeSession?.session_id === session.session_id) {
        setActiveSession(null);
      }
      await refresh();
      await onChanged();
    } catch (e) {
      onError(e, 'Close session failed');
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 左侧：会话列表 */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">➕ 新建会话</h3>
          <div className="space-y-2">
            <p className="text-xs text-surface-500">项目: {project}</p>
            <input
              type="text"
              value={initialMsg}
              onChange={(e) => setInitialMsg(e.target.value)}
              placeholder="初始消息（可选）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleCreate}
              className="w-full py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
            >
              🎙️ 创建会话
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">
            📋 会话列表 ({sessions.length})
          </h3>
          {sessions.length === 0 ? (
            <p className="text-xs text-surface-400 text-center py-4">暂无会话</p>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.session_id}
                  className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                    activeSession?.session_id === s.session_id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-surface-300/50 hover:bg-surface-200/30'
                  }`}
                  onClick={() => setActiveSession(s)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-surface-700 truncate">
                        {s.session_id}
                      </p>
                      <p className="text-[10px] text-surface-500">
                        {s.status} · {s.messages.length} 条消息
                      </p>
                    </div>
                    {s.status === 'active' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClose(s);
                        }}
                        className="ml-2 text-red-500 hover:text-red-700 text-xs"
                      >
                        关闭
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：会话内容 */}
      <div className="lg:col-span-2">
        {activeSession ? (
          <div className="bg-white rounded-xl p-4 border border-surface-300/50 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-surface-800">
                💬 {activeSession.session_id}
              </h3>
              <span className="text-xs text-surface-500">
                {activeSession.messages.length} 条消息 ·{' '}
                {activeSession.context_refs.length} 上下文
              </span>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-3 max-h-[400px]">
              {activeSession.messages.length === 0 ? (
                <p className="text-xs text-surface-400 text-center py-4">暂无消息</p>
              ) : (
                activeSession.messages.map((m) => (
                  <div
                    key={m.message_id}
                    className={`p-2 rounded-lg text-sm ${
                      m.role === 'user'
                        ? 'bg-blue-50 ml-8 text-surface-800'
                        : 'bg-violet-50 mr-8 text-surface-800'
                    }`}
                  >
                    <div className="text-[10px] text-surface-500 mb-0.5">
                      {m.role === 'user' ? '👤 用户' : '🤖 助手'} ·{' '}
                      {new Date(m.created_at).toLocaleTimeString()}
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))
              )}
            </div>

            {/* 发送区 */}
            <div className="border-t border-surface-300/30 pt-3 space-y-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="输入消息..."
                rows={2}
                className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-3 text-xs text-surface-600">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useContext}
                    onChange={(e) => setUseContext(e.target.checked)}
                  />
                  🧠 注入上下文
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useWeb}
                    onChange={(e) => setUseWeb(e.target.checked)}
                  />
                  🌐 Web 搜索
                </label>
                <button
                  onClick={handleSend}
                  disabled={!message.trim()}
                  className="ml-auto px-3 py-1 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-surface-300 rounded-lg transition-colors"
                >
                  📤 发送
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-8 border border-surface-300/50 text-center text-surface-400 h-full flex items-center justify-center">
            <div>
              <p className="text-4xl mb-2">🎙️</p>
              <p className="text-sm">选择一个会话开始对话</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Global Memory Tab
// ============================================================

interface MemoryTabProps {
  project: string;
  onBusyChange: (b: boolean) => void;
  onError: (e: any, fallback: string) => void;
  onChanged: () => void | Promise<void>;
}

const MemoryTab: React.FC<MemoryTabProps> = ({ project, onBusyChange, onError, onChanged }) => {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeEntry[] | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('preference');
  const [entryTags, setEntryTags] = useState('');
  const [confidence, setConfidence] = useState(0.9);

  const refresh = async () => {
    try {
      const r = await listMemoryEntries({ project_id: project, limit: 100 });
      if (r.success) setEntries(r.entries);
    } catch (e) {
      onError(e, 'Failed to list entries');
    }
  };

  useEffect(() => {
    refresh();
  }, [project]);

  const handleAdd = async () => {
    if (!content.trim()) return;
    onBusyChange(true);
    try {
      const r = await createMemoryEntry({
        project_id: project,
        category,
        content: content.trim(),
        tags: entryTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        confidence,
      });
      if (r.success) {
        setContent('');
        setEntryTags('');
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Create entry failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    onBusyChange(true);
    try {
      const r = await searchMemory({
        project_id: project,
        query: searchQuery.trim(),
        top_k: 10,
      });
      if (r.success) setSearchResults(r.results);
    } catch (e) {
      onError(e, 'Search failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleDelete = async (entry: KnowledgeEntry) => {
    if (!confirm(`确定删除知识条目?`)) return;
    onBusyChange(true);
    try {
      await deleteMemoryEntry(entry.entry_id);
      await refresh();
      if (searchResults) {
        setSearchResults(searchResults.filter((e) => e.entry_id !== entry.entry_id));
      }
      await onChanged();
    } catch (e) {
      onError(e, 'Delete failed');
    } finally {
      onBusyChange(false);
    }
  };

  const displayEntries = searchResults !== null ? searchResults : entries;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左侧：创建 + 搜索 */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">➕ 添加知识条目</h3>
          <div className="space-y-2">
            <p className="text-xs text-surface-500">项目: {project}</p>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-violet-500"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="知识内容..."
              rows={3}
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <input
              type="text"
              value={entryTags}
              onChange={(e) => setEntryTags(e.target.value)}
              placeholder="标签（逗号分隔）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-surface-600">置信度:</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={confidence}
                onChange={(e) => setConfidence(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-surface-700 w-8">{confidence.toFixed(1)}</span>
            </div>
            <button
              onClick={handleAdd}
              disabled={!content.trim()}
              className="w-full py-1.5 text-sm font-medium text-white bg-violet-500 hover:bg-violet-600 disabled:bg-surface-300 rounded-lg transition-colors"
            >
              🧠 保存知识
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">🔍 智能搜索</h3>
          <div className="space-y-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入查询关键词..."
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-violet-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
                className="flex-1 py-1.5 text-sm font-medium text-white bg-violet-500 hover:bg-violet-600 disabled:bg-surface-300 rounded-lg transition-colors"
              >
                🔍 搜索
              </button>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                }}
                className="px-3 py-1.5 text-sm text-surface-700 bg-surface-200/50 hover:bg-surface-300 rounded-lg transition-colors"
              >
                清除
              </button>
            </div>
            {searchResults !== null && (
              <p className="text-xs text-surface-500">
                找到 <b>{searchResults.length}</b> 条相关结果
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 右侧：列表 */}
      <div className="bg-white rounded-xl p-4 border border-surface-300/50">
        <h3 className="text-sm font-semibold text-surface-800 mb-3">
          📚 条目 ({displayEntries.length})
        </h3>
        {displayEntries.length === 0 ? (
          <p className="text-xs text-surface-400 text-center py-4">暂无条目</p>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {displayEntries.map((e) => {
              const cat = CATEGORY_OPTIONS.find((c) => c.value === e.category);
              return (
                <div
                  key={e.entry_id}
                  className="p-2.5 rounded-lg border border-surface-300/50 hover:bg-surface-200/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium ${cat?.color || ''}`}>
                          {cat?.label || e.category}
                        </span>
                        <span className="text-[10px] text-surface-500">
                          conf={e.confidence.toFixed(2)} · use={e.use_count}
                        </span>
                      </div>
                      <p className="text-sm text-surface-800 break-words">{e.content}</p>
                      {e.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {e.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(e)}
                      className="text-red-500 hover:text-red-700 text-sm flex-shrink-0"
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Video Tab
// ============================================================

interface VideoTabProps {
  user: string;
  onBusyChange: (b: boolean) => void;
  onError: (e: any, fallback: string) => void;
  onChanged: () => void | Promise<void>;
}

const VideoTab: React.FC<VideoTabProps> = ({ user, onBusyChange, onError, onChanged }) => {
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [generations, setGenerations] = useState<VideoGeneration[]>([]);
  const [selected, setSelected] = useState<VideoMetadata | null>(null);
  const [summary, setSummary] = useState<VideoSummary | null>(null);

  // 上传表单
  const [filePath, setFilePath] = useState('/tmp/sample.mp4');
  const [fileSize, setFileSize] = useState(1024 * 1024 * 5);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // 生成表单
  const [genPrompt, setGenPrompt] = useState('A cat playing piano in a cozy living room');
  const [genDuration, setGenDuration] = useState(5.0);
  const [genStyle, setGenStyle] = useState('realistic');

  const refresh = async () => {
    try {
      const r1 = await listVideos({ uploaded_by: user, limit: 30 });
      if (r1.success) setVideos(r1.videos);
      const r2 = await listGenerations({ owner: user, limit: 30 });
      if (r2.success) setGenerations(r2.generations);
    } catch (e) {
      onError(e, 'Failed to list videos');
    }
  };

  useEffect(() => {
    refresh();
  }, [user]);

  const handleUpload = async () => {
    if (!filePath.trim() || fileSize <= 0) return;
    onBusyChange(true);
    try {
      const r = await uploadVideo({
        file_path: filePath.trim(),
        file_size: fileSize,
        uploaded_by: user,
        title: title.trim(),
        description: description.trim(),
      });
      if (r.success) {
        setTitle('');
        setDescription('');
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Upload failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleExtract = async () => {
    if (!selected) return;
    onBusyChange(true);
    try {
      const r = await extractFrames(selected.video_id, 5);
      if (r.success) {
        alert(`✅ 提取了 ${r.count} 个关键帧`);
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Extract frames failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleSummarize = async () => {
    if (!selected) return;
    onBusyChange(true);
    try {
      const r = await summarizeVideo(selected.video_id, 5, true);
      if (r.success) {
        setSummary(r.summary);
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Summarize failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleDelete = async (video: VideoMetadata) => {
    if (!confirm(`确定删除视频 ${video.title || video.video_id}?`)) return;
    onBusyChange(true);
    try {
      await deleteVideo(video.video_id);
      if (selected?.video_id === video.video_id) {
        setSelected(null);
        setSummary(null);
      }
      await refresh();
      await onChanged();
    } catch (e) {
      onError(e, 'Delete failed');
    } finally {
      onBusyChange(false);
    }
  };

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    onBusyChange(true);
    try {
      const r = await generateVideo({
        prompt: genPrompt.trim(),
        duration: genDuration,
        style: genStyle,
        owner: user,
      });
      if (r.success) {
        await refresh();
        await onChanged();
      }
    } catch (e) {
      onError(e, 'Generate failed');
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 左侧：上传 + 生成 */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">📤 注册视频</h3>
          <div className="space-y-2">
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="文件路径"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-orange-500"
            />
            <input
              type="number"
              value={fileSize}
              onChange={(e) => setFileSize(parseInt(e.target.value, 10) || 0)}
              placeholder="文件大小 (bytes)"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-orange-500"
            />
            <p className="text-[10px] text-surface-500 -mt-1">≤ 100 MB</p>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-orange-500"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述（可选）"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={handleUpload}
              disabled={!filePath.trim() || fileSize <= 0}
              className="w-full py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:bg-surface-300 rounded-lg transition-colors"
            >
              🎬 注册视频
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-surface-300/50">
          <h3 className="text-sm font-semibold text-surface-800 mb-3">✨ Mock 生成</h3>
          <div className="space-y-2">
            <textarea
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="生成提示词..."
              rows={2}
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-surface-600">时长:</label>
              <input
                type="number"
                value={genDuration}
                onChange={(e) => setGenDuration(parseFloat(e.target.value) || 5)}
                step="1"
                min="1"
                max="60"
                className="w-16 px-2 py-1 text-sm border border-surface-300 rounded"
              />
              <span className="text-xs text-surface-500">秒</span>
            </div>
            <select
              value={genStyle}
              onChange={(e) => setGenStyle(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded-lg focus:outline-none focus:border-pink-500"
            >
              {VIDEO_STYLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerate}
              disabled={!genPrompt.trim()}
              className="w-full py-1.5 text-sm font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:bg-surface-300 rounded-lg transition-colors"
            >
              ✨ Mock 生成
            </button>
          </div>
        </div>
      </div>

      {/* 中间：视频列表 */}
      <div className="bg-white rounded-xl p-4 border border-surface-300/50">
        <h3 className="text-sm font-semibold text-surface-800 mb-3">
          🎬 视频库 ({videos.length})
        </h3>
        {videos.length === 0 ? (
          <p className="text-xs text-surface-400 text-center py-4">暂无视频</p>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {videos.map((v) => (
              <div
                key={v.video_id}
                className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                  selected?.video_id === v.video_id
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-surface-300/50 hover:bg-surface-200/30'
                }`}
                onClick={() => {
                  setSelected(v);
                  setSummary(null);
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-800 truncate">
                      {v.title || v.video_id}
                    </p>
                    <p className="text-[10px] text-surface-500">
                      {v.resolution} · {formatDuration(v.duration)} · {formatFileSize(v.file_size)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(v);
                    }}
                    className="ml-2 text-red-500 hover:text-red-700 text-sm"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="text-sm font-semibold text-surface-800 mt-4 mb-3">
          ✨ 生成任务 ({generations.length})
        </h3>
        {generations.length === 0 ? (
          <p className="text-xs text-surface-400 text-center py-2">暂无</p>
        ) : (
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {generations.map((g) => (
              <div
                key={g.gen_id}
                className="p-2 rounded-lg border border-surface-300/50 text-xs"
              >
                <p className="text-surface-800 truncate">{g.prompt}</p>
                <p className="text-[10px] text-surface-500 mt-0.5">
                  {g.status} · {g.style} · {formatDuration(g.duration)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右侧：操作 + 摘要 */}
      <div className="space-y-4">
        {selected ? (
          <>
            <div className="bg-white rounded-xl p-4 border border-surface-300/50">
              <h3 className="text-sm font-semibold text-surface-800 mb-3">
                🎬 {selected.title || selected.video_id}
              </h3>
              <div className="text-xs text-surface-600 space-y-1">
                <p>
                  <b>分辨率:</b> {selected.resolution}
                </p>
                <p>
                  <b>时长:</b> {formatDuration(selected.duration)}
                </p>
                <p>
                  <b>大小:</b> {formatFileSize(selected.file_size)}
                </p>
                <p className="truncate">
                  <b>路径:</b> {selected.file_path}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={handleExtract}
                  className="py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors"
                >
                  🎞️ 关键帧
                </button>
                <button
                  onClick={handleSummarize}
                  className="py-1.5 text-xs font-medium text-white bg-violet-500 hover:bg-violet-600 rounded transition-colors"
                >
                  📝 摘要
                </button>
              </div>
            </div>

            {summary && (
              <div className="bg-white rounded-xl p-4 border border-surface-300/50">
                <h3 className="text-sm font-semibold text-surface-800 mb-2">📝 摘要</h3>
                <p className="text-xs text-surface-700 whitespace-pre-wrap leading-relaxed">
                  {summary.summary_text}
                </p>
                {summary.transcript && (
                  <details className="mt-2">
                    <summary className="text-xs text-violet-600 cursor-pointer">
                      📜 转写文本
                    </summary>
                    <pre className="text-[10px] bg-surface-200/50 p-2 rounded mt-1 whitespace-pre-wrap max-h-[150px] overflow-y-auto">
                      {summary.transcript}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-xl p-8 border border-surface-300/50 text-center text-surface-400 h-full flex items-center justify-center">
            <div>
              <p className="text-4xl mb-2">🎬</p>
              <p className="text-sm">选择或注册一个视频开始</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TraeWorkPanel;
