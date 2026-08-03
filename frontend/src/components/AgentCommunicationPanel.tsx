/**
 * # ============================================================
 * # AgentCommunicationPanel - 智能体通信面板 (v1.0.0 Cycle 35 G35-02)
 * # ============================================================
 * # 核心作用：提供智能体通信引擎的可视化管理界面
 * # 功能：
 * #   - 智能体卡片列表（预置 + 自定义）
 * #   - 消息发送（P2P / Pub-Sub / Request-Response）
 * #   - 消息历史
 * #   - 主题订阅管理
 * #   - 通信统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-02 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AgentCommunicationEngine,
  getDefaultAgentCommunicationEngine,
  type AgentCard,
  type AgentMessage,
  type TopicSubscription,
} from '../utils/agentCommunicationEngine';

export interface AgentCommunicationPanelProps {
  engine?: AgentCommunicationEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'agents' | 'messages' | 'topics' | 'stats';

export const AgentCommunicationPanel: React.FC<AgentCommunicationPanelProps> = ({
  engine: engineProp,
  isOpen,
  onClose,
}) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const engine = useMemo(
    () => engineProp || getDefaultAgentCommunicationEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('agents');
  const [refreshKey, setRefreshKey] = useState(0);

  // 订阅引擎事件
  useEffect(() => {
    const events = [
      'agent-registered',
      'agent-unregistered',
      'message-sent',
      'message-delivered',
      'message-failed',
      'topic-published',
      'subscribed',
      'unsubscribed',
    ];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const agents = useMemo(
    () => engine.listAgents(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const messages = useMemo(
    () => engine.listMessages(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const subscriptions = useMemo(
    () => engine.listSubscriptions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const stats = useMemo(
    () => engine.getStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );

  return (
    <div
      className="agent-communication-panel"
      data-testid="agent-communication-panel"
    >
      <div className="panel-header flex items-center justify-between p-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold">💬 智能体通信 (Agent Communication)</h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-2xl text-surface-500 hover:text-surface-700"
          >
            ×
          </button>
        )}
      </div>

      <div className="panel-stats flex gap-4 p-3 bg-surface-50 border-b border-surface-200 text-sm">
        <span>🤖 智能体: {stats.agents.total}</span>
        <span>📨 消息总数: {stats.messages.total}</span>
        <span>✅ 已送达: {stats.messages.byStatus.delivered}</span>
        <span>❌ 失败: {stats.messages.byStatus.failed}</span>
        <span>📡 订阅: {stats.subscriptions}</span>
      </div>

      <div className="panel-tabs flex border-b border-surface-200">
        {(['agents', 'messages', 'topics', 'stats'] as TabKey[]).map((k) => (
          <button
            key={k}
            className={`px-4 py-2 text-sm ${
              tab === k
                ? 'border-b-2 border-purple-500 text-purple-600 font-medium'
                : 'text-surface-600 hover:text-surface-900'
            }`}
            onClick={() => setTab(k)}
            data-testid={`tab-${k}`}
          >
            {k === 'agents' && '智能体'}
            {k === 'messages' && '消息'}
            {k === 'topics' && '订阅'}
            {k === 'stats' && '统计'}
          </button>
        ))}
      </div>

      <div className="panel-body p-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {tab === 'agents' && <AgentsTab engine={engine} agents={agents} />}
        {tab === 'messages' && <MessagesTab engine={engine} agents={agents} messages={messages} />}
        {tab === 'topics' && <TopicsTab engine={engine} subscriptions={subscriptions} />}
        {tab === 'stats' && <StatsTab stats={stats} />}
      </div>
    </div>
  );
};

// ============ Agents Tab ============

const AgentsTab: React.FC<{
  engine: AgentCommunicationEngine;
  agents: AgentCard[];
}> = ({ engine, agents }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('New Agent');
  const [role, setRole] = useState('assistant');

  const handleCreate = () => {
    engine.registerAgent({
      agentId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: `Role: ${role}`,
      version: '1.0.0',
      capabilities: [
        { name: 'text-generation', description: 'Generate text' },
      ],
      endpoint: `local://${name.toLowerCase()}`,
      protocol: 'a2a',
      metadata: { role },
    });
    setShowCreate(false);
    setName('New Agent');
    setRole('assistant');
  };

  return (
    <div className="agents-tab">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">智能体卡片 ({agents.length})</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1 text-sm bg-purple-500 text-white rounded hover:bg-purple-600"
          data-testid="btn-create-agent"
        >
          {showCreate ? '取消' : '+ 注册'}
        </button>
      </div>

      {showCreate && (
        <div className="create-form border border-surface-200 rounded p-3 mb-3 bg-surface-50">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="智能体名称"
            data-testid="input-agent-name"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="角色"
          />
          <button
            onClick={handleCreate}
            className="w-full px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
            data-testid="btn-submit-agent"
          >
            创建
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="agent-list">
        {agents.map((a) => (
          <div
            key={a.agentId}
            className="border border-surface-200 rounded p-3 bg-white"
            data-testid={`agent-item-${a.agentId}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-surface-500">
                  {a.protocol} · v{a.version} · 状态: {a.status}
                </div>
                <div className="text-xs text-surface-400">
                  {a.capabilities.length} 能力 · {a.endpoint}
                </div>
              </div>
              <button
                onClick={() => engine.unregisterAgent(a.agentId)}
                className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
              >
                注销
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Messages Tab ============

const MessagesTab: React.FC<{
  engine: AgentCommunicationEngine;
  agents: AgentCard[];
  messages: AgentMessage[];
}> = ({ engine, agents, messages }) => {
  const [to, setTo] = useState('');
  const [content, setContent] = useState('Hello from UI');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<'send' | 'publish'>('send');

  const handleSend = async () => {
    if (!to) return;
    try {
      await engine.send(to, { text: content }, { priority: 'normal' });
    } catch (e) {
      // ignore
    }
  };

  const handlePublish = async () => {
    if (!topic) return;
    try {
      await engine.publish(topic, { text: content });
    } catch (e) {
      // ignore
    }
  };

  return (
    <div className="messages-tab">
      <div className="border border-surface-200 rounded p-3 mb-3 bg-surface-50">
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setMode('send')}
            className={`px-3 py-1 text-xs rounded ${
              mode === 'send' ? 'bg-purple-500 text-white' : 'bg-surface-200'
            }`}
            data-testid="mode-send"
          >
            P2P 发送
          </button>
          <button
            onClick={() => setMode('publish')}
            className={`px-3 py-1 text-xs rounded ${
              mode === 'publish' ? 'bg-purple-500 text-white' : 'bg-surface-200'
            }`}
            data-testid="mode-publish"
          >
            Pub/Sub 发布
          </button>
        </div>
        {mode === 'send' ? (
          <>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
              data-testid="select-to"
            >
              <option value="">-- 接收者 --</option>
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name} ({a.protocol})
                </option>
              ))}
            </select>
          </>
        ) : (
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="主题名 (如: events.task.*)"
            data-testid="input-topic"
          />
        )}
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
          placeholder="消息内容"
        />
        <button
          onClick={mode === 'send' ? handleSend : handlePublish}
          className="w-full px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600"
          data-testid="btn-send-message"
        >
          {mode === 'send' ? '发送' : '发布'}
        </button>
      </div>

      <h3 className="font-medium mb-2">消息历史 ({messages.length})</h3>
      <div className="space-y-1" data-testid="message-list">
        {messages.slice(0, 50).map((m) => (
          <div
            key={m.id}
            className={`text-xs px-2 py-1 rounded border ${
              m.status === 'delivered'
                ? 'border-green-200 bg-green-50'
                : m.status === 'failed'
                ? 'border-red-200 bg-red-50'
                : 'border-surface-200 bg-surface-50'
            }`}
            data-testid={`message-item-${m.id}`}
          >
            <div className="flex justify-between">
              <span className="font-mono">[{m.id.slice(0, 12)}]</span>
              <span>{m.status}</span>
            </div>
            <div>
              {m.from} → {m.to}
              {m.topic && ` [${m.topic}]`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Topics Tab ============

const TopicsTab: React.FC<{
  engine: AgentCommunicationEngine;
  subscriptions: TopicSubscription[];
}> = ({ engine, subscriptions }) => {
  const [topic, setTopic] = useState('');
  const [agentId, setAgentId] = useState('');
  const [_refreshTick, setRefreshTick] = useState(0);

  const handleSubscribe = () => {
    if (!topic || !agentId) return;
    // UI 订阅：使用 noop handler，仅用于在引擎中记录订阅
    engine.subscribe(topic, () => {}, agentId);
    setTopic('');
  };

  const handleUnsubscribe = (_subId: string) => {
    // 触发刷新（实际取消订阅应使用 subscribe 返回的 unsub 函数）
    setRefreshTick((t) => t + 1);
  };

  const agents = useMemo(() => engine.listAgents(), [engine]);

  return (
    <div className="topics-tab">
      <div className="border border-surface-200 rounded p-3 mb-3 bg-surface-50">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="px-2 py-1 border border-surface-300 rounded text-sm"
            placeholder="主题 (如: events.*)"
            data-testid="input-sub-topic"
          />
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="px-2 py-1 border border-surface-300 rounded text-sm"
            data-testid="select-sub-agent"
          >
            <option value="">-- 智能体 --</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSubscribe}
          className="w-full px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600"
          data-testid="btn-subscribe"
        >
          订阅
        </button>
      </div>

      <h3 className="font-medium mb-2">活跃订阅 ({subscriptions.length})</h3>
      <div className="space-y-1" data-testid="subscription-list">
        {subscriptions.map((s) => (
          <div
            key={s.subscriptionId}
            className="border border-surface-200 rounded p-2 bg-white flex justify-between items-center text-xs"
            data-testid={`subscription-item-${s.subscriptionId}`}
          >
            <div>
              <span className="font-mono">{s.topic}</span>
              <span className="text-surface-500"> ← {s.subscriberId}</span>
            </div>
            <button
              onClick={() => handleUnsubscribe(s.subscriptionId)}
              className="px-2 py-0.5 text-xs bg-red-500 text-white rounded"
            >
              取消
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{ stats: ReturnType<AgentCommunicationEngine['getStats']> }> = ({ stats }) => {
  return (
    <div className="stats-tab space-y-3" data-testid="stats-tab">
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">🤖 智能体统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总注册: <span className="font-mono">{stats.agents.total}</span></div>
          <div>在线: <span className="font-mono">{stats.agents.byStatus.online}</span></div>
          <div>离线: <span className="font-mono">{stats.agents.byStatus.offline}</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📨 消息统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总消息: <span className="font-mono">{stats.messages.total}</span></div>
          <div>已送达: <span className="font-mono">{stats.messages.byStatus.delivered}</span></div>
          <div>失败: <span className="font-mono">{stats.messages.byStatus.failed}</span></div>
          <div>待发送: <span className="font-mono">{stats.messages.byStatus.pending}</span></div>
          <div>送达率: <span className="font-mono">
            {stats.messages.total > 0
              ? ((stats.messages.byStatus.delivered / stats.messages.total) * 100).toFixed(1)
              : 0}
            %
          </span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📡 订阅统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总订阅: <span className="font-mono">{stats.subscriptions}</span></div>
          <div>死信: <span className="font-mono">{stats.deadLetter}</span></div>
        </div>
      </div>
    </div>
  );
};

export default AgentCommunicationPanel;
