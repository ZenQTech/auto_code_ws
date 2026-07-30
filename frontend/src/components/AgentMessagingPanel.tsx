/**
 * # ============================================================
 * # AgentMessagingPanel - 代理消息面板 (v1.0.0 Cycle 27 G27-04)
 * # ============================================================
 * # 核心作用：提供结构化代理消息的可视化管理界面
 * # 功能：发送/接收/回复/Followup 任务
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-04 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AgentMessage,
  AgentMessagePriority,
  AgentMessageStatus,
  AgentMessageType,
  MESSAGE_STATUS_METADATA,
  MESSAGE_TYPE_METADATA,
} from '../utils/agentMessagingTypes';
import {
  AgentMessagingEngine,
  getDefaultAgentMessagingEngine,
} from '../utils/agentMessagingEngine';

export interface AgentMessagingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine?: AgentMessagingEngine;
  /** 已知代理路径列表（用于自动补全） */
  knownPaths?: string[];
}

export function AgentMessagingPanel({
  isOpen,
  onClose,
  engine: propEngine,
  knownPaths = ['/root', '/root/coordinator', '/root/worker', '/root/reviewer'],
}: AgentMessagingPanelProps): React.ReactElement | null {
  const fallbackEngine = useMemo(() => getDefaultAgentMessagingEngine(), []);
  const engine = propEngine ?? fallbackEngine;
  const [viewMode, setViewMode] = useState<'messages' | 'followups'>('messages');
  const [showCompose, setShowCompose] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<AgentMessageStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [_refreshKey, setRefreshKey] = useState(0);

  // 事件订阅
  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const unsubSent = engine.on('message-sent', refresh);
    const unsubDelivered = engine.on('message-delivered', refresh);
    const unsubRead = engine.on('message-read', refresh);
    const unsubReplied = engine.on('message-replied', refresh);
    const unsubFailed = engine.on('message-failed', refresh);
    const unsubFollowupScheduled = engine.on('followup-scheduled', refresh);
    const unsubFollowupCompleted = engine.on('followup-completed', refresh);
    return () => {
      unsubSent();
      unsubDelivered();
      unsubRead();
      unsubReplied();
      unsubFailed();
      unsubFollowupScheduled();
      unsubFollowupCompleted();
    };
  }, [engine]);

  if (!isOpen) return null;

  const messages = engine.listMessages({
    status: filterStatus === 'all' ? undefined : filterStatus,
  });
  const followups = engine.listFollowups();
  const stats = engine.getStats();
  const selectedMessage = selectedMessageId ? engine.getMessage(selectedMessageId) : null;

  return (
    <div
      data-testid="agent-messaging-panel"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        <Header stats={stats} onClose={onClose} />

        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          search={search}
          onSearchChange={setSearch}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          onCompose={() => setShowCompose(true)}
        />

        <div className="flex-1 flex overflow-hidden">
          {showCompose ? (
            <ComposeForm
              engine={engine}
              knownPaths={knownPaths}
              onSent={() => {
                setShowCompose(false);
              }}
              onCancel={() => setShowCompose(false)}
            />
          ) : (
            <>
              <MessageList
                messages={viewMode === 'followups' ? [] : filterMessages(messages, search)}
                followups={viewMode === 'followups' ? followups : []}
                selectedId={selectedMessageId}
                onSelect={setSelectedMessageId}
                viewMode={viewMode}
              />
              {selectedMessage ? (
                <MessageDetail
                  message={selectedMessage}
                  engine={engine}
                  knownPaths={knownPaths}
                  onUpdate={() => setRefreshKey((k) => k + 1)}
                />
              ) : (
                <EmptyState viewMode={viewMode} onCompose={() => setShowCompose(true)} />
              )}
            </>
          )}
        </div>

        <Footer count={viewMode === 'followups' ? followups.length : messages.length} viewMode={viewMode} />
      </div>
    </div>
  );
}

function filterMessages(messages: AgentMessage[], search: string): AgentMessage[] {
  if (!search.trim()) return messages;
  const s = search.toLowerCase();
  return messages.filter(
    (m) =>
      m.from.toLowerCase().includes(s) ||
      m.to.toLowerCase().includes(s) ||
      m.content.toLowerCase().includes(s)
  );
}

// ============ Header ============

function Header({ stats, onClose }: { stats: ReturnType<AgentMessagingEngine['getStats']>; onClose: () => void }): React.ReactElement {
  return (
    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">💬</span>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">代理消息</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {stats.totalMessages} 条消息 · {stats.totalFollowups} 个 followup
          </p>
        </div>
      </div>
      <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-2xl leading-none" aria-label="关闭">×</button>
    </div>
  );
}

// ============ Toolbar ============

function Toolbar({
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  onCompose,
}: {
  viewMode: 'messages' | 'followups';
  onViewModeChange: (m: 'messages' | 'followups') => void;
  search: string;
  onSearchChange: (s: string) => void;
  filterStatus: AgentMessageStatus | 'all';
  onFilterStatusChange: (s: AgentMessageStatus | 'all') => void;
  onCompose: () => void;
}): React.ReactElement {
  return (
    <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
      <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded p-1 text-sm">
        <button
          onClick={() => onViewModeChange('messages')}
          data-testid="tab-messages"
          className={`px-3 py-1 rounded text-sm font-medium transition ${
            viewMode === 'messages'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          💬 消息
        </button>
        <button
          onClick={() => onViewModeChange('followups')}
          data-testid="tab-followups"
          className={`px-3 py-1 rounded text-sm font-medium transition ${
            viewMode === 'followups'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          ➡️ Followup
        </button>
      </div>

      {viewMode === 'messages' && (
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索 from/to/content..."
          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 flex-1 min-w-[200px]"
          data-testid="search-input"
        />
      )}

      {viewMode === 'messages' && (
        <select
          value={filterStatus}
          onChange={(e) => onFilterStatusChange(e.target.value as AgentMessageStatus | 'all')}
          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          data-testid="status-filter"
        >
          <option value="all">全部状态</option>
          {Object.entries(MESSAGE_STATUS_METADATA).map(([key, meta]) => (
            <option key={key} value={key}>{meta.icon} {meta.label}</option>
          ))}
        </select>
      )}

      {viewMode === 'messages' && (
        <button
          onClick={onCompose}
          data-testid="compose-button"
          className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium"
        >
          ➕ 新消息
        </button>
      )}
    </div>
  );
}

// ============ Message List ============

function MessageList({
  messages,
  followups,
  selectedId,
  onSelect,
  viewMode,
}: {
  messages: AgentMessage[];
  followups: Array<{ id: string; parentMessageId: string; targetPath: string; task: string; status: string; scheduledAt: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  viewMode: 'messages' | 'followups';
}): React.ReactElement {
  return (
    <div className="w-96 border-r border-slate-200 dark:border-slate-700 overflow-y-auto" data-testid="message-list">
      {viewMode === 'messages' ? (
        messages.length === 0 ? (
          <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">暂无消息</div>
        ) : (
          messages.map((m) => {
            const typeMeta = MESSAGE_TYPE_METADATA[m.type];
            const statusMeta = MESSAGE_STATUS_METADATA[m.status];
            return (
              <div
                key={m.id}
                data-testid={`message-item-${m.id}`}
                className={`p-3 border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition ${
                  selectedId === m.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                }`}
                onClick={() => onSelect(m.id)}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span>{typeMeta.icon}</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex-1">
                    {m.from} → {m.to}
                  </span>
                  <span className={`text-xs ${statusMeta.color}`}>{statusMeta.icon}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{m.content}</p>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {new Date(m.createdAt).toLocaleTimeString('zh-CN')}
                </div>
              </div>
            );
          })
        )
      ) : followups.length === 0 ? (
        <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">暂无 followup 任务</div>
      ) : (
        followups.map((f) => (
          <div
            key={f.id}
            data-testid={`followup-item-${f.id}`}
            className="p-3 border-b border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span>➡️</span>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex-1">
                {f.targetPath}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                f.status === 'completed' ? 'bg-green-100 text-green-700' :
                f.status === 'failed' ? 'bg-red-100 text-red-700' :
                f.status === 'running' ? 'bg-blue-100 text-blue-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>{f.status}</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{f.task}</p>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {new Date(f.scheduledAt).toLocaleString('zh-CN')}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============ Message Detail ============

function MessageDetail({
  message,
  engine,
  knownPaths,
  onUpdate,
}: {
  message: AgentMessage;
  engine: AgentMessagingEngine;
  knownPaths: string[];
  onUpdate: () => void;
}): React.ReactElement {
  const [replyContent, setReplyContent] = useState('');
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [followupTask, setFollowupTask] = useState('');
  const [followupPath, setFollowupPath] = useState(message.from);
  const typeMeta = MESSAGE_TYPE_METADATA[message.type];
  const statusMeta = MESSAGE_STATUS_METADATA[message.status];

  const handleReply = () => {
    if (!replyContent.trim()) return;
    engine.markReplied(message.id, replyContent.trim());
    setReplyContent('');
    onUpdate();
  };

  const handleRetry = () => {
    engine.retryMessage(message.id);
    onUpdate();
  };

  const handleScheduleFollowup = () => {
    if (!followupTask.trim() || !followupPath.trim()) return;
    engine.scheduleFollowup(message.id, followupPath.trim(), followupTask.trim());
    setShowFollowupForm(false);
    setFollowupTask('');
    onUpdate();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="message-detail">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-3xl">{typeMeta.icon}</span>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{typeMeta.label}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <code>{message.id}</code>
          </p>
        </div>
        <span className={`px-2 py-1 text-xs rounded font-medium ${statusMeta.color}`}>
          {statusMeta.icon} {statusMeta.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <MetaCard label="发送者" value={message.from} />
        <MetaCard label="接收者" value={message.to} />
        <MetaCard label="类型" value={typeMeta.label} />
        <MetaCard label="优先级" value={message.priority} />
        <MetaCard label="创建" value={new Date(message.createdAt).toLocaleString('zh-CN')} />
        {message.sentAt && <MetaCard label="发送" value={new Date(message.sentAt).toLocaleString('zh-CN')} />}
        {message.readAt && <MetaCard label="已读" value={new Date(message.readAt).toLocaleString('zh-CN')} />}
        {message.repliedAt && <MetaCard label="已回复" value={new Date(message.repliedAt).toLocaleString('zh-CN')} />}
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">内容</h4>
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap" data-testid="message-content">
          {message.content}
        </div>
      </div>

      {message.metadata && message.metadata['reply'] !== undefined && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">回复</h4>
          <div className="p-3 bg-green-50 dark:bg-green-900/30 rounded text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
            {String(message.metadata['reply'])}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {message.status !== 'replied' && message.status !== 'failed' && message.status !== 'expired' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="回复内容..."
              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleReply();
              }}
              data-testid="reply-input"
            />
            <button
              onClick={handleReply}
              data-testid="reply-button"
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
            >
              💬 回复
            </button>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {message.status === 'failed' && (
            <button
              onClick={handleRetry}
              data-testid="retry-button"
              className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded"
            >
              🔄 重试
            </button>
          )}
          <button
            onClick={() => setShowFollowupForm(!showFollowupForm)}
            data-testid="schedule-followup-button"
            className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded"
          >
            ➡️ 调度 followup
          </button>
        </div>

        {showFollowupForm && (
          <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded" data-testid="followup-form">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">调度 followup 任务</h4>
            <div className="space-y-2">
              <select
                value={followupPath}
                onChange={(e) => setFollowupPath(e.target.value)}
                className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                data-testid="followup-path-select"
              >
                {knownPaths.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                type="text"
                value={followupTask}
                onChange={(e) => setFollowupTask(e.target.value)}
                placeholder="任务描述..."
                className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                data-testid="followup-task-input"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleScheduleFollowup}
                  data-testid="followup-submit"
                  className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded"
                >
                  调度
                </button>
                <button
                  onClick={() => setShowFollowupForm(false)}
                  className="px-3 py-1 bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm rounded"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">{value}</div>
    </div>
  );
}

// ============ Compose Form ============

function ComposeForm({
  engine,
  knownPaths,
  onSent,
  onCancel,
}: {
  engine: AgentMessagingEngine;
  knownPaths: string[];
  onSent: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [from, setFrom] = useState(knownPaths[0] || '/root');
  const [to, setTo] = useState(knownPaths[1] || '/root/worker');
  const [content, setContent] = useState('');
  const [type, setType] = useState<AgentMessageType>('send_message');
  const [priority, setPriority] = useState<AgentMessagePriority>('normal');
  const [error, setError] = useState<string | null>(null);

  const handleSend = () => {
    if (!content.trim()) {
      setError('内容不能为空');
      return;
    }
    if (from === to) {
      setError('发送者和接收者不能相同');
      return;
    }
    try {
      engine.sendMessage({
        from,
        to,
        content: content.trim(),
        type,
        priority,
      });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="compose-form">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">💬 新消息</h3>

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300" data-testid="compose-error">
          ⚠️ {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">发送者（路径）</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="from-select"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {knownPaths.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">接收者（路径）</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="to-select"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {knownPaths.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AgentMessageType)}
              data-testid="type-select"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(MESSAGE_TYPE_METADATA).map(([key, meta]) => (
                <option key={key} value={key}>{meta.icon} {meta.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">优先级</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as AgentMessagePriority)}
              data-testid="priority-select"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              <option value="low">低</option>
              <option value="normal">普通</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">消息内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            placeholder="请输入消息内容..."
            data-testid="content-input"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSend}
            data-testid="send-button"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium"
          >
            📤 发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Empty State ============

function EmptyState({ viewMode, onCompose }: { viewMode: 'messages' | 'followups'; onCompose: () => void }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-6xl mb-3">{viewMode === 'followups' ? '➡️' : '💬'}</div>
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
          {viewMode === 'followups' ? '暂无 followup 任务' : '选择消息查看详情'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {viewMode === 'followups' ? '在消息详情中调度 followup 任务' : '点击消息查看完整内容和操作'}
        </p>
        {viewMode === 'messages' && (
          <button
            onClick={onCompose}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
          >
            ➕ 新消息
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Footer ============

function Footer({ count, viewMode }: { count: number; viewMode: 'messages' | 'followups' }): React.ReactElement {
  return (
    <div className="px-6 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
      <span>{viewMode === 'followups' ? '➡️ Followup' : '💬 消息'} · {count} 项</span>
      <span>💡 提示: 消息支持回复/重试/followup 调度</span>
    </div>
  );
}

export default AgentMessagingPanel;
