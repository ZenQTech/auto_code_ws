/**
 * # ============================================================
 * # Streaming Chat Panel - 流式 Chat 面板 (v1.0.0 Cycle 36 G36-02)
 * # ============================================================
 * # 核心作用：演示 LLM 流式响应能力
 * # 运行流程：
 * #   1. 选择 Provider + 模型
 * #   2. 输入消息
 * #   3. 启动流式响应
 * #   4. 实时显示增量文本 + TTFT / ITPS 统计
 * #   5. 支持暂停 / 恢复 / 取消
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-02 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  useStreamingResponse,
  UseStreamingOptions,
  getDefaultStreamingResponseEngine,
  AggregateStreamStats,
} from '../utils/streamingResponseEngine';
import { ProviderName, getDefaultLLMProviderRegistry, PROVIDER_MODELS } from '../utils/llmProviderAdapter';

export interface StreamingChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'chat' | 'history' | 'stats';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  durationMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const StreamingChatPanel: React.FC<StreamingChatPanelProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<TabKey>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('介绍一下你自己');
  const [provider, setProvider] = useState<ProviderName>('mock');
  const [model, setModel] = useState<string>('mock-fast');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [engine] = useState(() => getDefaultStreamingResponseEngine());

  // 流式响应 hook
  const streamOptions: UseStreamingOptions = useMemo(
    () => ({
      provider,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      autoStart: false,
      config: { throttleMs: 16 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, model, messages, refreshKey]
  );
  const streaming = useStreamingResponse(streamOptions);

  // 当流式开始时，新增助手消息
  useEffect(() => {
    if (streaming.status === 'streaming' && !streamingMessageId) {
      const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setStreamingMessageId(id);
      setMessages((prev) => [
        ...prev,
        { id, role: 'assistant', content: '', timestamp: Date.now() },
      ]);
    }
  }, [streaming.status, streamingMessageId]);

  // 当流式文本更新时，更新助手消息
  useEffect(() => {
    if (streamingMessageId && streaming.text) {
      setMessages((prev) =>
        prev.map((m) => (m.id === streamingMessageId ? { ...m, content: streaming.text } : m))
      );
    }
  }, [streaming.text, streamingMessageId]);

  // 当流式完成时，记录最终状态
  useEffect(() => {
    if (streaming.status === 'completed' && streamingMessageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingMessageId
            ? {
                ...m,
                content: streaming.text,
                durationMs: streaming.stats?.durationMs,
                usage: streaming.usage,
              }
            : m
        )
      );
      setStreamingMessageId(null);
    }
  }, [streaming.status, streamingMessageId, streaming.text, streaming.stats, streaming.usage]);

  useEffect(() => {
    if (streaming.status === 'error' && streamingMessageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingMessageId
            ? { ...m, content: streaming.text || `[错误] ${streaming.error?.error.message}` }
            : m
        )
      );
      setStreamingMessageId(null);
    }
  }, [streaming.status, streamingMessageId, streaming.text, streaming.error]);

  // 引擎事件
  useEffect(() => {
    const unsub = engine.on('stream-created', () => setRefreshKey((k) => k + 1));
    return () => {
      unsub();
    };
  }, [engine]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    streaming.reset();
    setStreamingMessageId(null);
    setInput('');

    // 启动流式响应
    setTimeout(() => {
      streaming.start();
    }, 50);
  }, [input, streaming]);

  const handleClear = useCallback(() => {
    setMessages([]);
    streaming.reset();
    setStreamingMessageId(null);
  }, [streaming]);

  if (!isOpen) return null;

  const models = PROVIDER_MODELS[provider] || [];
  const isRegistered = getDefaultLLMProviderRegistry().has(provider);
  const aggregateStats = engine.getStats();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      data-testid="streaming-chat-panel"
      role="dialog"
      aria-label="Streaming Chat 面板"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-w-[95vw] h-[750px] max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌊</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Streaming Chat 面板</h2>
              <p className="text-xs text-gray-600">v1.0.0 (Cycle 36 G36-02) · 流式响应 + 实时统计</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
            data-testid="streaming-close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-gray-200 bg-white flex gap-1">
          {(['chat', 'history', 'stats'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`streaming-tab-${t}`}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === t
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-500'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'chat' && '💬 Chat'}
              {t === 'history' && `📜 历史 (${messages.length})`}
              {t === 'stats' && '📊 统计'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50">
          {tab === 'chat' && (
            <ChatTab
              messages={messages}
              input={input}
              setInput={setInput}
              provider={provider}
              setProvider={setProvider}
              model={model}
              setModel={setModel}
              models={models}
              isRegistered={isRegistered}
              isStreaming={streaming.status === 'streaming' || streaming.status === 'paused'}
              onSend={handleSend}
              onClear={handleClear}
              onPause={streaming.pause}
              onResume={streaming.resume}
              onCancel={streaming.cancel}
              status={streaming.status}
              stats={streaming.stats}
              error={streaming.error}
            />
          )}
          {tab === 'history' && <HistoryTab messages={messages} />}
          {tab === 'stats' && <StatsTab stats={aggregateStats} />}
        </div>
      </div>
    </div>
  );
};

interface ChatTabProps {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  provider: ProviderName;
  setProvider: (p: ProviderName) => void;
  model: string;
  setModel: (m: string) => void;
  models: typeof PROVIDER_MODELS[ProviderName];
  isRegistered: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onClear: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  status: string;
  stats?: any;
  error?: any;
}

const ChatTab: React.FC<ChatTabProps> = ({
  messages,
  input,
  setInput,
  provider,
  setProvider,
  model,
  setModel,
  models,
  isRegistered,
  isStreaming,
  onSend,
  onClear,
  onPause,
  onResume,
  onCancel,
  status,
  stats,
  error,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Provider 选择 */}
      <div className="px-6 py-3 bg-white border-b border-gray-200 flex items-center gap-3 flex-wrap">
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as ProviderName;
            setProvider(p);
            const ms = PROVIDER_MODELS[p];
            if (ms && ms.length > 0) setModel(ms[0].id);
          }}
          data-testid="provider-select"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded"
        >
          <option value="mock">🧪 Mock</option>
          <option value="anthropic">🤖 Anthropic</option>
          <option value="openai">🧠 OpenAI</option>
          <option value="ollama">💻 Ollama</option>
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          data-testid="model-select"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {/* 实时状态 */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs" data-testid="streaming-stats">
            <span className="flex items-center gap-1 text-blue-600">
              <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              {status === 'streaming' ? '生成中' : '已暂停'}
            </span>
            {stats?.ttftMs !== undefined && (
              <span className="text-gray-600">TTFT: {stats.ttftMs}ms</span>
            )}
            {stats?.itps && (
              <span className="text-gray-600">ITPS: {stats.itps.toFixed(1)}</span>
            )}
            {stats?.chunksEmitted !== undefined && (
              <span className="text-gray-600">chunks: {stats.chunksEmitted}</span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {isStreaming ? (
          <div className="flex gap-1">
            {status === 'streaming' ? (
              <button
                onClick={onPause}
                data-testid="pause-button"
                className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200"
              >
                ⏸ 暂停
              </button>
            ) : (
              <button
                onClick={onResume}
                data-testid="resume-button"
                className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                ▶ 恢复
              </button>
            )}
            <button
              onClick={onCancel}
              data-testid="cancel-button"
              className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              ⏹ 停止
            </button>
          </div>
        ) : (
          <button
            onClick={onClear}
            data-testid="clear-button"
            className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            清空
          </button>
        )}
      </div>

      {!isRegistered && provider !== 'mock' && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
          ⚠️ {provider} Provider 未注册。请先在 LLM Provider 面板注册。
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3" data-testid="messages-area">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-12">
            <p>💬 暂无消息</p>
            <p className="text-xs mt-1">在下方输入框输入消息开始对话</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              data-testid={`message-${msg.role}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white border border-gray-200 text-gray-900'
                }`}
              >
                <div className="text-xs opacity-70 mb-1">
                  {msg.role === 'user' ? '👤 用户' : '🤖 助手'}
                  {msg.usage && (
                    <span className="ml-2">
                      · {msg.usage.totalTokens} tokens · {msg.durationMs}ms
                    </span>
                  )}
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                  {msg.role === 'assistant' && !msg.content && isStreaming && (
                    <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700" data-testid="error-banner">
          ❌ {error.error.message}
        </div>
      )}

      {/* 输入框 */}
      <div className="px-6 py-3 bg-white border-t border-gray-200 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isStreaming) onSend();
            }
          }}
          disabled={isStreaming}
          placeholder="输入消息..."
          data-testid="message-input"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={isStreaming || !input.trim()}
          data-testid="send-button"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </div>
  );
};

const HistoryTab: React.FC<{ messages: ChatMessage[] }> = ({ messages }) => {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        暂无历史消息
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-2">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className="bg-white border border-gray-200 rounded-lg p-3"
          data-testid={`history-message-${msg.id}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">
              {msg.role === 'user' ? '👤 用户' : '🤖 助手'}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(msg.timestamp).toLocaleString()}
            </span>
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</div>
          {msg.usage && (
            <div className="text-xs text-gray-500 mt-2">
              {msg.usage.totalTokens} tokens · {msg.durationMs}ms
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const StatsTab: React.FC<{ stats: AggregateStreamStats }> = ({ stats }) => {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">流式响应统计</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatBox label="总流数" value={stats.totalStreams} />
          <StatBox label="活跃流" value={stats.activeStreams} />
          <StatBox label="已完成流" value={stats.completedStreams} />
          <StatBox label="总 chunks" value={stats.totalChunks.toLocaleString()} />
          <StatBox label="总字节" value={stats.totalBytes.toLocaleString()} />
          <StatBox label="平均 TTFT" value={`${stats.avgTtftMs.toFixed(0)}ms`} />
          <StatBox label="平均时长" value={`${stats.avgDurationMs.toFixed(0)}ms`} />
        </div>
      </div>
    </div>
  );
};

const StatBox: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded p-3">
    <div className="text-xs text-gray-600">{label}</div>
    <div className="text-lg font-semibold text-gray-900 font-mono">{value}</div>
  </div>
);

export default StreamingChatPanel;
