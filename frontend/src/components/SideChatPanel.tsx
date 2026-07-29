/**
 * # ============================================================
 * # SideChatPanel - Side Chat 侧边对话 UI (v1.0.0 Cycle 22 G22-01)
 * # ============================================================
 * # 核心作用：Side-Chat 多子对话的可视化管理界面
 * # 主要功能：
 * #   1. 创建/管理多个 Side-Chat（最多 5 个并行）
 * #   2. 在 Side-Chat 内发送消息
 * #   3. 归档/晋升/合并/丢弃 Side-Chat
 * #   4. 统计信息展示
 * #   5. Esc 关闭面板
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-01 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getSideChatManager,
  type SideChat,
  type SideChatStats,
  type SideChatStatus,
} from '../utils/sideChatManager';

interface SideChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<SideChatStatus, string> = {
  active: '活跃',
  archived: '已归档',
  promoted: '已晋升',
  merged: '已合并',
  discarded: '已丢弃',
};

const STATUS_COLORS: Record<SideChatStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  archived: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  promoted: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  merged: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  discarded: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

export function SideChatPanel({ isOpen, onClose }: SideChatPanelProps) {
  const manager = useMemo(() => getSideChatManager(), []);
  const [chats, setChats] = useState<SideChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [messageText, setMessageText] = useState('');
  const [stats, setStats] = useState<SideChatStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parentSessionId] = useState('main-session');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 刷新列表
  const refresh = useCallback(() => {
    const all = manager.listSideChats({ sortBy: 'updatedAt', sortOrder: 'desc' });
    setChats(all);
    setStats(manager.getStats());
  }, [manager]);

  // 订阅事件
  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const off1 = manager.on('side-chat-created', refresh);
    const off2 = manager.on('side-chat-updated', refresh);
    const off3 = manager.on('side-chat-status-changed', refresh);
    const off4 = manager.on('side-chat-message-added', refresh);
    return () => {
      off1();
      off2();
      off3();
      off4();
    };
  }, [isOpen, manager, refresh]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChatId, chats]);

  // 当前选中的对话
  const activeChat = useMemo(
    () => chats.find((c) => c.sideChatId === activeChatId) || null,
    [chats, activeChatId]
  );

  // 创建新 Side-Chat
  const handleCreate = useCallback(() => {
    setError(null);
    if (!newTopic.trim()) {
      setError('请输入主题');
      return;
    }
    try {
      const chat = manager.createSideChat(parentSessionId, newTopic.trim());
      setNewTopic('');
      setActiveChatId(chat.sideChatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  }, [manager, newTopic, parentSessionId]);

  // 发送消息
  const handleSend = useCallback(() => {
    setError(null);
    if (!activeChat) return;
    if (!messageText.trim()) return;
    try {
      manager.addMessage(activeChat.sideChatId, {
        role: 'user',
        content: messageText.trim(),
      });
      // 模拟助手回复
      setTimeout(() => {
        try {
          manager.addMessage(activeChat.sideChatId, {
            role: 'assistant',
            content: `[自动回复] 已收到你的消息：${messageText.trim().slice(0, 50)}...`,
          });
        } catch {
          // 对话可能已变更
        }
      }, 200);
      setMessageText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    }
  }, [manager, activeChat, messageText]);

  // 状态操作
  const handleArchive = useCallback(() => {
    if (!activeChat) return;
    try {
      manager.archiveSideChat(activeChat.sideChatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [manager, activeChat]);

  const handlePromote = useCallback(() => {
    if (!activeChat) return;
    try {
      const newSessionId = `promoted-${Date.now()}`;
      manager.promoteToMain(activeChat.sideChatId, newSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '晋升失败');
    }
  }, [manager, activeChat]);

  const handleMerge = useCallback(
    (mergeAll: boolean) => {
      if (!activeChat) return;
      try {
        manager.mergeToMain(activeChat.sideChatId, mergeAll);
      } catch (err) {
        setError(err instanceof Error ? err.message : '合并失败');
      }
    },
    [manager, activeChat]
  );

  const handleDiscard = useCallback(() => {
    if (!activeChat) return;
    try {
      manager.discardSideChat(activeChat.sideChatId);
      setActiveChatId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '丢弃失败');
    }
  }, [manager, activeChat]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="side-chat-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <span className="text-white text-sm">💬</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Side Chat 侧边对话</h2>
              <p className="text-xs text-slate-400">在主对话外探索子话题，不污染主上下文</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
            data-testid="side-chat-close"
          >
            ×
          </button>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="px-5 py-2 bg-surface-800/50 border-b border-surface-700 flex gap-4 text-xs">
            <span className="text-slate-400">总数：<span className="text-white font-medium">{stats.totalChats}</span></span>
            <span className="text-emerald-400">活跃：<span className="font-medium">{stats.activeChats}</span></span>
            <span className="text-slate-400">归档：<span className="font-medium">{stats.archivedChats}</span></span>
            <span className="text-blue-400">晋升：<span className="font-medium">{stats.promotedChats}</span></span>
            <span className="text-purple-400">合并：<span className="font-medium">{stats.mergedChats}</span></span>
            <span className="text-rose-400">丢弃：<span className="font-medium">{stats.discardedChats}</span></span>
            <span className="text-slate-400 ml-auto">消息：<span className="text-white font-medium">{stats.totalMessages}</span></span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧列表 */}
          <div className="w-72 border-r border-surface-700 flex flex-col">
            {/* 创建新对话 */}
            <div className="p-3 border-b border-surface-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="新 Side-Chat 主题..."
                  data-testid="side-chat-new-topic"
                  className="flex-1 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={handleCreate}
                  data-testid="side-chat-create"
                  className="px-3 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition"
                >
                  +
                </button>
              </div>
              {error && (
                <p className="text-xs text-rose-400 mt-1" data-testid="side-chat-error">
                  {error}
                </p>
              )}
            </div>
            {/* 列表 */}
            <div className="flex-1 overflow-y-auto">
              {chats.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-sm">暂无 Side-Chat</div>
              ) : (
                <ul className="divide-y divide-surface-700">
                  {chats.map((chat) => (
                    <li key={chat.sideChatId}>
                      <button
                        onClick={() => setActiveChatId(chat.sideChatId)}
                        data-testid={`side-chat-item-${chat.sideChatId}`}
                        className={`w-full px-3 py-3 text-left hover:bg-surface-800 transition ${
                          activeChatId === chat.sideChatId ? 'bg-surface-800' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white truncate flex-1">
                            {chat.topic}
                          </span>
                          <span
                            className={`ml-2 px-1.5 py-0.5 rounded text-[10px] border ${STATUS_COLORS[chat.status]}`}
                          >
                            {STATUS_LABELS[chat.status]}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{chat.messages.length} 条消息</span>
                          <span>{new Date(chat.updatedAt).toLocaleTimeString()}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 右侧对话详情 */}
          <div className="flex-1 flex flex-col">
            {!activeChat ? (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                选择或创建 Side-Chat 开始对话
              </div>
            ) : (
              <>
                {/* 对话头 */}
                <div className="px-5 py-3 border-b border-surface-700 flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium">{activeChat.topic}</h3>
                    <p className="text-xs text-slate-400">
                      父 Session: {activeChat.parentSessionId} · 消息 {activeChat.messages.length}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {activeChat.status === 'active' && (
                      <>
                        <button
                          onClick={handleArchive}
                          data-testid="side-chat-archive"
                          className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded transition"
                        >
                          归档
                        </button>
                        <button
                          onClick={handlePromote}
                          data-testid="side-chat-promote"
                          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition"
                        >
                          晋升
                        </button>
                        <button
                          onClick={() => handleMerge(true)}
                          data-testid="side-chat-merge"
                          className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded transition"
                        >
                          合并到主
                        </button>
                        <button
                          onClick={handleDiscard}
                          data-testid="side-chat-discard"
                          className="px-2 py-1 text-xs bg-rose-600 hover:bg-rose-500 text-white rounded transition"
                        >
                          丢弃
                        </button>
                      </>
                    )}
                    {activeChat.status !== 'active' && (
                      <span
                        className={`px-2 py-1 text-xs rounded border ${STATUS_COLORS[activeChat.status]}`}
                      >
                        {STATUS_LABELS[activeChat.status]}
                      </span>
                    )}
                  </div>
                </div>

                {/* 消息列表 */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3" data-testid="side-chat-messages">
                  {activeChat.messages.length === 0 ? (
                    <div className="text-center text-slate-500 py-8">还没有消息</div>
                  ) : (
                    activeChat.messages.map((msg) => (
                      <div
                        key={msg.messageId}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-3 py-2 ${
                            msg.role === 'user'
                              ? 'bg-primary-500/20 border border-primary-500/30 text-white'
                              : 'bg-surface-800 text-slate-200'
                          }`}
                        >
                          <div className="text-xs text-slate-400 mb-1">
                            {msg.role === 'user' ? '👤 你' : '🤖 助手'} ·{' '}
                            {new Date(msg.timestamp).toLocaleTimeString()}
                            {msg.attached && (
                              <span className="ml-2 text-purple-400">· 已合并到主</span>
                            )}
                          </div>
                          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* 输入框 */}
                {activeChat.status === 'active' && (
                  <div className="border-t border-surface-700 p-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="输入消息..."
                        data-testid="side-chat-input"
                        className="flex-1 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-primary-500"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!messageText.trim()}
                        data-testid="side-chat-send"
                        className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm rounded-lg transition"
                      >
                        发送
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SideChatPanel;
