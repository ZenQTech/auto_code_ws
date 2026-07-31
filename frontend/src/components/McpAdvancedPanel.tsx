/**
 * # ============================================================
 * # McpAdvancedPanel - MCP 高级能力统一面板 (v1.0.0 Cycle 41)
 * # ============================================================
 * # 核心作用：统一管理 MCP 协议的高级能力
 * #           - 资源订阅 (resources/subscribe + 推送通知)
 * #           - 参数补全 (completion/complete)
 * #           - 服务器主动 LLM 调用 (sampling/createMessage)
 * #           - 根目录管理 (roots/list + 变更通知)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ResourceSubscriptionManager,
  type ResourceSubscription,
  type SubscriptionEvent,
} from '../utils/mcpResourceSubscription';
import {
  CompletionProvider,
  createCompletionProvider,
  type CompletionResponse,
  type CompletionEvent,
  type CompletionRequest,
} from '../utils/mcpCompletion';
import {
  SamplingHandler,
  type SamplingCreateRequest,
  type SamplingEvent,
  type SamplingEventListener,
} from '../utils/mcpSampling';
import {
  RootsManager,
  type Root,
  type RootEvent,
} from '../utils/mcpRoots';
import { McpClient } from '../utils/mcpClient';
import type { McpTransport } from '../utils/mcpTransport';
import type { JsonRpcMessage } from '../utils/mcpTypes';

type Tab = 'subscribe' | 'completion' | 'sampling' | 'roots';

interface McpAdvancedPanelProps {
  /** 可选：外部传入的客户端 */
  client?: McpClient | null;
  className?: string;
}

// ============ Mock Transport（演示模式） ============

class MockAdvancedTransport implements McpTransport {
  readonly type = 'stdio' as const;
  private _isOpen = false;
  private msgHandlers: Set<(msg: JsonRpcMessage) => void> = new Set();
  public sentMessages: JsonRpcMessage[] = [];

  async start(): Promise<void> {
    this._isOpen = true;
  }

  async send(message: unknown): Promise<void> {
    const msg = message as JsonRpcMessage;
    this.sentMessages.push(msg);
    if ('method' in msg && msg.method === 'initialize' && 'id' in msg) {
      setTimeout(() => {
        for (const h of this.msgHandlers) {
          h({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
                resources: { subscribe: true },
                prompts: {},
              },
              serverInfo: { name: 'advanced-test', version: '1.0.0' },
            },
          } as JsonRpcMessage);
        }
      }, 1);
    }
  }

  onMessage(h: (msg: JsonRpcMessage) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }
  onError(): () => void { return () => {}; }
  onClose(): () => void { return () => {}; }
  isOpen(): boolean { return this._isOpen; }
  async close(): Promise<void> { this._isOpen = false; }
}

// ============ 主组件 ============

export const McpAdvancedPanel: React.FC<McpAdvancedPanelProps> = ({ client: externalClient, className = '' }) => {
  const [tab, setTab] = useState<Tab>('subscribe');
  const [client, setClient] = useState<McpClient | null>(externalClient || null);
  const [error, setError] = useState<string | null>(null);
  const transportRef = useRef<MockAdvancedTransport | null>(null);

  // 演示模式：自动创建 Mock Client
  useEffect(() => {
    if (externalClient) {
      setClient(externalClient);
      return;
    }
    const transport = new MockAdvancedTransport();
    transportRef.current = transport;
    const newClient = new McpClient({
      serverId: 'advanced-demo',
      serverName: 'Advanced Demo',
      transport: { type: 'stdio', command: 'mock' },
    });
    newClient.setTransport(transport);
    newClient
      .connect()
      .then(() => {
        setClient(newClient);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      void newClient.disconnect();
    };
  }, [externalClient]);

  return (
    <div className={`mcp-advanced-panel p-4 bg-white rounded-lg shadow ${className}`}>
      {/* 标题 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>⚡</span>
          <span>MCP 高级能力</span>
        </h2>
        <span className="text-xs text-gray-500">
          {client ? `已连接 (${client.getState()})` : '未连接'}
        </span>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 标签栏 */}
      <div className="flex gap-1 mb-4 border-b">
        <TabButton active={tab === 'subscribe'} onClick={() => setTab('subscribe')} icon="🔔" label="资源订阅" />
        <TabButton active={tab === 'completion'} onClick={() => setTab('completion')} icon="✨" label="参数补全" />
        <TabButton active={tab === 'sampling'} onClick={() => setTab('sampling')} icon="🤖" label="服务器采样" />
        <TabButton active={tab === 'roots'} onClick={() => setTab('roots')} icon="📂" label="根目录" />
      </div>

      {/* 内容区 */}
      {client ? (
        <>
          {tab === 'subscribe' && <SubscribeTab client={client} />}
          {tab === 'completion' && <CompletionTab client={client} />}
          {tab === 'sampling' && <SamplingTab client={client} />}
          {tab === 'roots' && <RootsTab client={client} />}
        </>
      ) : (
        <div className="text-sm text-gray-500 p-4 text-center">正在连接...</div>
      )}
    </div>
  );
};

// ============ 通用 UI 子组件 ============

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({
  active,
  onClick,
  icon,
  label,
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-2 text-sm transition-colors border-b-2 ${
      active
        ? 'border-blue-500 text-blue-600 font-medium'
        : 'border-transparent text-gray-600 hover:text-gray-800'
    }`}
  >
    <span className="mr-1">{icon}</span>
    {label}
  </button>
);

// ============ 1. 资源订阅 Tab ============

const SubscribeTab: React.FC<{ client: McpClient }> = ({ client }) => {
  const managerRef = useRef<ResourceSubscriptionManager | null>(null);
  const [subs, setSubs] = useState<ResourceSubscription[]>([]);
  const [uri, setUri] = useState<string>('file:///example/data.txt');
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);

  useEffect(() => {
    const m = new ResourceSubscriptionManager();
    managerRef.current = m;
    m.attachClient(client);
    const unsub = m.on((e) => {
      setEvents((prev) => [{ ...e }, ...prev].slice(0, 20));
      setSubs(m.list());
    });
    setSubs(m.list());
    return () => {
      unsub();
      m.dispose();
    };
  }, [client]);

  const handleSubscribe = useCallback(async () => {
    if (!managerRef.current) return;
    try {
      await managerRef.current.subscribe(uri);
    } catch (e) {
      console.error('Subscribe error:', e);
    }
  }, [uri]);

  const handleUnsubscribe = useCallback(async (u: string) => {
    if (!managerRef.current) return;
    try {
      await managerRef.current.unsubscribe(u);
    } catch (e) {
      console.error('Unsubscribe error:', e);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        订阅资源 URI，服务器将通过 <code>notifications/resources/updated</code> 推送变更。
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          className="flex-1 px-2 py-1 border rounded text-sm font-mono"
          placeholder="file:///path/to/resource"
        />
        <button
          onClick={handleSubscribe}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          订阅
        </button>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">活跃订阅 ({subs.length})</h4>
        {subs.length === 0 ? (
          <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">无活跃订阅</div>
        ) : (
          <div className="space-y-1">
            {subs.map((s) => (
              <div
                key={s.uri}
                className="flex items-center justify-between p-2 bg-blue-50 rounded text-sm"
              >
                <div className="flex-1">
                  <div className="font-mono text-xs">{s.uri}</div>
                  <div className="text-xs text-gray-500">
                    更新 {s.updateCount} 次 · {new Date(s.subscribedAt).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={() => handleUnsubscribe(s.uri)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  取消
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">事件日志</h4>
        <div className="max-h-32 overflow-y-auto p-2 bg-gray-50 rounded text-xs font-mono">
          {events.length === 0 ? (
            <div className="text-gray-500">暂无事件</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="text-gray-700">
                [{new Date(e.at).toLocaleTimeString()}] {e.type}
                {'uri' in e ? ` ${e.uri}` : ''}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ============ 2. 参数补全 Tab ============

const CompletionTab: React.FC<{ client: McpClient }> = ({ client }) => {
  const [provider, setProvider] = useState<CompletionProvider | null>(null);
  const [refType, setRefType] = useState<'ref/prompt' | 'ref/resource'>('ref/prompt');
  const [refName, setRefName] = useState<string>('greet');
  const [argName, setArgName] = useState<string>('name');
  const [argValue, setArgValue] = useState<string>('Al');
  const [response, setResponse] = useState<CompletionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [events, setEvents] = useState<CompletionEvent[]>([]);

  useEffect(() => {
    const p = createCompletionProvider();
    // 创建适配器调用 McpClient 公开的 complete 方法
    const adapter: import('../utils/mcpCompletion').CompletionClient = {
      complete: async (request) => {
        if (request.ref.type === 'ref/prompt') {
          return await client.complete(
            { type: 'ref/prompt', name: request.ref.name },
            { name: request.argument.name, value: request.argument.value },
          );
        }
        return await client.complete(
          { type: 'ref/resource', uri: request.ref.uri },
          { name: request.argument.name, value: request.argument.value },
        );
      },
    };
    p.attachClient(adapter);
    setProvider(p);
    const unsub = p.on((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 10));
    });
    return () => {
      unsub();
    };
  }, [client]);

  const handleComplete = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const req: CompletionRequest = {
        ref: refType === 'ref/prompt'
          ? { type: 'ref/prompt', name: refName }
          : { type: 'ref/resource', uri: refName },
        argument: { name: argName, value: argValue },
      };
      const res = await provider.complete(req);
      setResponse(res);
    } catch (e) {
      setResponse({ values: [], total: 0 });
      console.error('Completion error:', e);
    } finally {
      setLoading(false);
    }
  }, [provider, refType, refName, argName, argValue]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        基于上下文的参数补全，支持工具/资源/提示词。
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={refType}
          onChange={(e) => setRefType(e.target.value as 'ref/prompt' | 'ref/resource')}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="ref/prompt">Prompt 引用</option>
          <option value="ref/resource">Resource 引用</option>
        </select>
        <input
          type="text"
          value={refName}
          onChange={(e) => setRefName(e.target.value)}
          className="px-2 py-1 border rounded text-sm font-mono"
          placeholder="prompt name / resource uri"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={argName}
          onChange={(e) => setArgName(e.target.value)}
          className="px-2 py-1 border rounded text-sm font-mono"
          placeholder="参数名"
        />
        <input
          type="text"
          value={argValue}
          onChange={(e) => setArgValue(e.target.value)}
          className="px-2 py-1 border rounded text-sm font-mono"
          placeholder="当前值"
        />
      </div>

      <button
        onClick={handleComplete}
        disabled={loading}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '补全中...' : '请求补全'}
      </button>

      {response && (
        <div className="p-2 bg-gray-50 rounded text-sm">
          <div className="text-xs text-gray-500 mb-1">补全结果 ({response.values.length})</div>
          <div className="flex flex-wrap gap-1">
            {response.values.map((v, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-mono"
              >
                {v}
              </span>
            ))}
            {response.values.length === 0 && <span className="text-xs text-gray-500">无结果</span>}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="text-xs text-gray-500">
          最近事件：{events[0].type}
        </div>
      )}
    </div>
  );
};

// ============ 3. 服务器采样 Tab ============

const SamplingTab: React.FC<{ client: McpClient }> = ({ client }) => {
  const [handler, setHandler] = useState<SamplingHandler | null>(null);
  const [stats, setStats] = useState<{ total: number; approved: number; rejected: number; errors: number }>({
    total: 0,
    approved: 0,
    rejected: 0,
    errors: 0,
  });
  const [history, setHistory] = useState<Array<{ request: SamplingCreateRequest; at: number; status: string }>>([]);
  const [events, setEvents] = useState<SamplingEvent[]>([]);
  const [prompt, setPrompt] = useState<string>('请用一句话介绍 Hermes 平台。');

  useEffect(() => {
    const h = new SamplingHandler();
    h.attachClient(client);
    setHandler(h);

    const listener: SamplingEventListener = (e) => {
      setEvents((prev) => [e, ...prev].slice(0, 10));
      if (e.type === 'completed') {
        setHistory((prev) => [
          { request: e.request, at: e.at, status: 'completed' },
          ...prev,
        ].slice(0, 10));
      } else if (e.type === 'rejected') {
        setHistory((prev) => [
          { request: e.request, at: e.at, status: 'rejected' },
          ...prev,
        ].slice(0, 10));
      }
      setStats(h.getStats());
    };
    const unsub = h.on(listener);
    return () => {
      unsub();
    };
  }, [client]);

  const handleSample = useCallback(async () => {
    if (!handler) return;
    try {
      await handler.handle({
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        maxTokens: 100,
      });
    } catch (e) {
      console.error('Sampling error:', e);
    }
  }, [handler, prompt]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        服务器通过 <code>sampling/createMessage</code> 主动调用客户端 LLM。支持审批流与多模态输入。
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="总数" value={stats.total} color="blue" />
        <Stat label="已批准" value={stats.approved} color="green" />
        <Stat label="已拒绝" value={stats.rejected} color="yellow" />
        <Stat label="错误" value={stats.errors} color="red" />
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        className="w-full px-2 py-1 border rounded text-sm"
        placeholder="用户消息..."
      />

      <button
        onClick={handleSample}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
      >
        模拟服务器采样请求
      </button>

      {history.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1">历史记录</h4>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {history.map((h, i) => (
              <div key={i} className="p-2 bg-gray-50 rounded text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-white text-[10px] ${
                      h.status === 'completed' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                  >
                    {h.status}
                  </span>
                  <span className="text-gray-500">{new Date(h.at).toLocaleTimeString()}</span>
                </div>
                <div className="font-mono text-gray-700 truncate">
                  {h.request.messages[0]?.content.type === 'text'
                    ? h.request.messages[0].content.text
                    : '[multimodal]'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; color: 'blue' | 'green' | 'yellow' | 'red' }> = ({
  label,
  value,
  color,
}) => {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={`p-2 rounded ${colors[color]}`}>
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px]">{label}</div>
    </div>
  );
};

// ============ 4. 根目录 Tab ============

const RootsTab: React.FC<{ client: McpClient }> = ({ client }) => {
  const managerRef = useRef<RootsManager | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [newUri, setNewUri] = useState<string>('file:///home/user');
  const [newName, setNewName] = useState<string>('User Home');
  const [events, setEvents] = useState<RootEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const m = new RootsManager({ autoNotify: true });
    managerRef.current = m;
    m.attachClient(client);
    const unsub = m.on((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 10));
      setRoots(m.list());
    });
    // 添加默认根目录
    m.add({ uri: 'file:///workspace', name: 'Workspace' });
    setRoots(m.list());
    return () => {
      unsub();
      m.dispose();
    };
  }, [client]);

  const handleAdd = useCallback(() => {
    if (!managerRef.current) return;
    setError(null);
    try {
      managerRef.current.add({ uri: newUri, name: newName || undefined });
      setNewUri('');
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [newUri, newName]);

  const handleRemove = useCallback((uri: string) => {
    if (!managerRef.current) return;
    managerRef.current.remove(uri);
  }, []);

  const handleClear = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.clear();
  }, []);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        客户端根目录列表。变更时通过 <code>notifications/roots/list_changed</code> 通知服务器。
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newUri}
          onChange={(e) => setNewUri(e.target.value)}
          className="flex-1 px-2 py-1 border rounded text-sm font-mono"
          placeholder="file:///path"
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-32 px-2 py-1 border rounded text-sm"
          placeholder="名称"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          添加
        </button>
      </div>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium">根目录 ({roots.length})</h4>
          {roots.length > 0 && (
            <button
              onClick={handleClear}
              className="text-xs text-red-600 hover:text-red-800"
            >
              清空
            </button>
          )}
        </div>
        {roots.length === 0 ? (
          <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">暂无根目录</div>
        ) : (
          <div className="space-y-1">
            {roots.map((r) => (
              <div
                key={r.uri}
                className="flex items-center justify-between p-2 bg-purple-50 rounded text-sm"
              >
                <div className="flex-1">
                  <div className="font-mono text-xs">{r.uri}</div>
                  {r.name && <div className="text-xs text-gray-500">{r.name}</div>}
                </div>
                <button
                  onClick={() => handleRemove(r.uri)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">事件日志</h4>
        <div className="max-h-24 overflow-y-auto p-2 bg-gray-50 rounded text-xs font-mono">
          {events.length === 0 ? (
            <div className="text-gray-500">暂无事件</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="text-gray-700">
                [{new Date(e.at).toLocaleTimeString()}] {e.type}
                {e.type !== 'cleared' && 'root' in e ? ` ${e.root.uri}` : ''}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default McpAdvancedPanel;
