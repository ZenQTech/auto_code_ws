/**
 * # ============================================================
 * # MCP Panel - MCP 服务器管理面板 (v1.0.0 Cycle 39 G39-03)
 * # ============================================================
 * # 核心作用：MCP 服务器的可视化管理界面
 * #           - 服务器列表 + 连接/断开
 * #           - 工具调用控制台
 * #           - 自定义服务器添加
 * #           - 实时状态监控
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-03 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  type McpServerDefinition,
  type McpServerStatus,
  type McpServerCategory,
  type McpRegistryEvent,
  MCP_CATEGORY_META,
  getDefaultMcpServerRegistry,
  computeRegistryStats,
} from '../utils/mcpRegistry';
import type { Tool, ToolCallResult, ToolContent } from '../utils/mcpTypes';

type View = 'servers' | 'tools' | 'add' | 'stats';
type FilterCategory = McpServerCategory | 'all';

interface McpPanelProps {
  className?: string;
}

export const McpPanel: React.FC<McpPanelProps> = ({ className = '' }) => {
  const [view, setView] = useState<View>('servers');
  const [servers, setServers] = useState<McpServerDefinition[]>([]);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [toolArgs, setToolArgs] = useState<string>('{}');
  const [toolResult, setToolResult] = useState<ToolCallResult | null>(null);
  const [calling, setCalling] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 注册表实例
  const registry = useMemo(() => getDefaultMcpServerRegistry(), []);

  // 刷新状态
  const refresh = useCallback(() => {
    setServers(registry.list());
    setStatuses(registry.getAllStatus());
  }, [registry]);

  // 订阅注册表事件
  useEffect(() => {
    refresh();
    const unsub = registry.subscribe((_event: McpRegistryEvent, _id: string) => {
      refresh();
    });
    return () => {
      unsub();
    };
  }, [registry, refresh]);

  // 过滤后的服务器列表
  const filteredServers = useMemo(() => {
    let result = servers;
    if (filter !== 'all') {
      result = result.filter((s) => s.category === filter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [servers, filter, searchQuery]);

  // 统计信息
  const stats = useMemo(() => computeRegistryStats(registry), [registry, statuses]);

  // 当前选中的服务器
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) || null,
    [servers, selectedServerId],
  );
  const selectedStatus = useMemo(
    () => statuses.find((s) => s.serverId === selectedServerId) || null,
    [statuses, selectedServerId],
  );

  // 切换连接
  const handleToggleConnection = useCallback(
    async (serverId: string) => {
      setError(null);
      const status = registry.getStatus(serverId);
      try {
        if (status?.connected) {
          await registry.disconnect(serverId);
        } else {
          await registry.connect(serverId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [registry],
  );

  // 调用工具
  const handleCallTool = useCallback(async () => {
    if (!selectedTool || !selectedServerId) return;
    setCalling(true);
    setToolResult(null);
    setError(null);
    try {
      const args = JSON.parse(toolArgs);
      const client = registry.getClient(selectedServerId);
      if (!client) {
        throw new Error('Client not connected');
      }
      const result = await client.callTool(selectedTool.name, args);
      setToolResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setToolResult({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
    } finally {
      setCalling(false);
    }
  }, [selectedTool, selectedServerId, toolArgs, registry]);

  // 选工具时填入默认参数
  useEffect(() => {
    if (selectedTool) {
      const schema = selectedTool.inputSchema;
      const props = (schema.properties || {}) as Record<string, unknown>;
      const defaults: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(props)) {
        const p = prop as { type?: string; default?: unknown };
        if (p.default !== undefined) {
          defaults[key] = p.default;
        } else if (p.type === 'string') {
          defaults[key] = '';
        } else if (p.type === 'number' || p.type === 'integer') {
          defaults[key] = 0;
        } else if (p.type === 'boolean') {
          defaults[key] = false;
        } else if (p.type === 'array') {
          defaults[key] = [];
        } else {
          defaults[key] = null;
        }
      }
      setToolArgs(JSON.stringify(defaults, null, 2));
      setToolResult(null);
    }
  }, [selectedTool]);

  // 自定义服务器表单
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    category: 'custom' as McpServerCategory,
    transportType: 'stdio' as 'stdio' | 'sse',
    command: '',
    url: '',
  });
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddServer = useCallback(() => {
    setAddError(null);
    if (!formData.id || !formData.name) {
      setAddError('ID 和名称必填');
      return;
    }
    const def: McpServerDefinition = {
      id: formData.id,
      name: formData.name,
      description: formData.description,
      category: formData.category,
      icon: MCP_CATEGORY_META[formData.category].icon,
      transport:
        formData.transportType === 'stdio'
          ? { type: 'stdio', command: formData.command }
          : { type: 'sse', url: formData.url },
      enabledByDefault: false,
      builtin: false,
      tags: ['custom'],
      version: '1.0.0',
    };
    const ok = registry.add(def);
    if (!ok) {
      setAddError(`ID "${formData.id}" 已存在`);
      return;
    }
    setFormData({
      id: '',
      name: '',
      description: '',
      category: 'custom',
      transportType: 'stdio',
      command: '',
      url: '',
    });
    setView('servers');
  }, [formData, registry]);

  // ============ 渲染 ============

  return (
    <div className={`mcp-panel flex flex-col h-full bg-white ${className}`}>
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-violet-50 to-purple-50">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔌</span>
          <div>
            <h2 className="text-base font-semibold text-gray-900">MCP 服务器管理</h2>
            <p className="text-xs text-gray-600">
              {stats.total} 个服务器 · {stats.connected} 个已连接 · {stats.totalTools} 个工具
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <TabButton active={view === 'servers'} onClick={() => setView('servers')}>
            服务器
          </TabButton>
          <TabButton active={view === 'tools'} onClick={() => setView('tools')}>
            工具
          </TabButton>
          <TabButton active={view === 'add'} onClick={() => setView('add')}>
            添加
          </TabButton>
          <TabButton active={view === 'stats'} onClick={() => setView('stats')}>
            统计
          </TabButton>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {view === 'servers' && (
          <ServersView
            filteredServers={filteredServers}
            statuses={statuses}
            filter={filter}
            setFilter={setFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedServerId={selectedServerId}
            setSelectedServerId={setSelectedServerId}
            onToggleConnection={handleToggleConnection}
            selectedServer={selectedServer}
            selectedStatus={selectedStatus}
          />
        )}

        {view === 'tools' && (
          <ToolsView
            statuses={statuses}
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            toolArgs={toolArgs}
            setToolArgs={setToolArgs}
            toolResult={toolResult}
            calling={calling}
            onCallTool={handleCallTool}
          />
        )}

        {view === 'add' && (
          <AddView
            formData={formData}
            setFormData={setFormData}
            addError={addError}
            onAdd={handleAddServer}
            onCancel={() => setView('servers')}
          />
        )}

        {view === 'stats' && <StatsView stats={stats} />}
      </div>
    </div>
  );
};

// ============ 子组件 ============

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
      active ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-violet-100'
    }`}
  >
    {children}
  </button>
);

const ServerCard: React.FC<{
  server: McpServerDefinition;
  status: McpServerStatus | undefined;
  selected: boolean;
  onSelect: () => void;
  onToggleConnection: () => void;
}> = ({ server, status, selected, onSelect, onToggleConnection }) => {
  const connected = status?.connected ?? false;
  const meta = MCP_CATEGORY_META[server.category];
  return (
    <div
      onClick={onSelect}
      className={`p-3 border rounded-lg cursor-pointer transition-all ${
        selected ? 'border-violet-500 bg-violet-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: connected ? '#10b981' : '#d1d5db' }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm text-gray-900 truncate">{server.name}</span>
              {server.builtin && (
                <span className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">
                  内置
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {meta.label} · {server.transport.type}
              {server.transport.type === 'stdio' && ` · ${server.transport.command}`}
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleConnection();
          }}
          className={`ml-2 px-2 py-1 text-xs rounded font-medium transition-colors ${
            connected
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-green-100 text-green-700 hover:bg-green-200'
          }`}
        >
          {connected ? '断开' : '连接'}
        </button>
      </div>
      <p className="text-xs text-gray-600 mt-2 line-clamp-2">{server.description}</p>
      {connected && status && (
        <div className="flex gap-3 mt-2 text-xs text-gray-500">
          <span>🔧 {status.toolCount} 工具</span>
          <span>📦 {status.resourceCount} 资源</span>
          <span>💬 {status.promptCount} 提示词</span>
        </div>
      )}
    </div>
  );
};

const ServersView: React.FC<{
  filteredServers: McpServerDefinition[];
  statuses: McpServerStatus[];
  filter: FilterCategory;
  setFilter: (f: FilterCategory) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedServerId: string | null;
  setSelectedServerId: (id: string | null) => void;
  onToggleConnection: (id: string) => void;
  selectedServer: McpServerDefinition | null;
  selectedStatus: McpServerStatus | null;
}> = ({
  filteredServers,
  statuses,
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  selectedServerId,
  setSelectedServerId,
  onToggleConnection,
  selectedServer,
  selectedStatus,
}) => {
  const categories: FilterCategory[] = [
    'all',
    'filesystem',
    'version-control',
    'network',
    'database',
    'search',
    'productivity',
    'ai',
    'custom',
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左侧：服务器列表 */}
      <div>
        <div className="mb-3 space-y-2">
          <input
            type="text"
            placeholder="🔍 搜索服务器..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="flex flex-wrap gap-1">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2 py-1 text-xs rounded ${
                  filter === c
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {c === 'all' ? '全部' : MCP_CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {filteredServers.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-8">无匹配服务器</div>
          ) : (
            filteredServers.map((s) => (
              <ServerCard
                key={s.id}
                server={s}
                status={statuses.find((st) => st.serverId === s.id)}
                selected={selectedServerId === s.id}
                onSelect={() => setSelectedServerId(s.id)}
                onToggleConnection={() => onToggleConnection(s.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* 右侧：详情 */}
      <div>
        {selectedServer ? (
          <ServerDetail
            server={selectedServer}
            status={selectedStatus}
            onToggleConnection={() => onToggleConnection(selectedServer.id)}
          />
        ) : (
          <div className="text-sm text-gray-500 text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            ← 选择一个服务器查看详情
          </div>
        )}
      </div>
    </div>
  );
};

const ServerDetail: React.FC<{
  server: McpServerDefinition;
  status: McpServerStatus | null;
  onToggleConnection: () => void;
}> = ({ server, status, onToggleConnection }) => {
  const connected = status?.connected ?? false;
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{server.name}</h3>
        <button
          onClick={onToggleConnection}
          className={`px-3 py-1.5 text-sm rounded font-medium ${
            connected
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-violet-600 text-white hover:bg-violet-700'
          }`}
        >
          {connected ? '断开连接' : '连接'}
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-3">{server.description}</p>
      <div className="space-y-1 text-xs text-gray-500 mb-3">
        <div>
          <span className="font-medium">ID:</span> <code>{server.id}</code>
        </div>
        <div>
          <span className="font-medium">分类:</span> {MCP_CATEGORY_META[server.category].label}
        </div>
        <div>
          <span className="font-medium">传输:</span> {server.transport.type}
          {server.transport.type === 'stdio' && ` · ${server.transport.command}`}
          {server.transport.type === 'sse' && ` · ${(server.transport as { url?: string }).url}`}
        </div>
        <div>
          <span className="font-medium">版本:</span> {server.version}
        </div>
        {server.homepage && (
          <div>
            <span className="font-medium">主页:</span>{' '}
            <a
              href={server.homepage}
              target="_blank"
              rel="noreferrer"
              className="text-violet-600 hover:underline"
            >
              {server.homepage}
            </a>
          </div>
        )}
      </div>
      {server.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {server.tags.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
              {t}
            </span>
          ))}
        </div>
      )}
      {connected && status && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">已发现能力</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {status.tools.length === 0 ? (
              <div className="text-xs text-gray-500">无工具</div>
            ) : (
              status.tools.map((tool) => (
                <div key={tool.name} className="p-2 bg-gray-50 rounded text-xs">
                  <div className="font-mono font-medium text-gray-800">{tool.name}</div>
                  {tool.description && (
                    <div className="text-gray-600 mt-0.5">{tool.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {status?.lastError && !connected && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          上次错误: {status.lastError}
        </div>
      )}
    </div>
  );
};

const ToolsView: React.FC<{
  statuses: McpServerStatus[];
  selectedTool: Tool | null;
  setSelectedTool: (t: Tool | null) => void;
  toolArgs: string;
  setToolArgs: (s: string) => void;
  toolResult: ToolCallResult | null;
  calling: boolean;
  onCallTool: () => void;
}> = ({ statuses, selectedTool, setSelectedTool, toolArgs, setToolArgs, toolResult, calling, onCallTool }) => {
  const allTools = useMemo(() => {
    const result: Array<{ serverId: string; tool: Tool }> = [];
    for (const s of statuses) {
      if (s.connected) {
        for (const t of s.tools) {
          result.push({ serverId: s.serverId, tool: t });
        }
      }
    }
    return result;
  }, [statuses]);

  if (allTools.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-4xl mb-2">🔌</div>
        <div className="text-sm">请先连接 MCP 服务器</div>
        <div className="text-xs text-gray-400 mt-1">在"服务器"标签页连接至少一个服务器</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左侧：工具列表 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">可用工具 ({allTools.length})</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {allTools.map(({ serverId, tool }) => (
            <button
              key={`${serverId}.${tool.name}`}
              onClick={() => setSelectedTool(tool)}
              className={`w-full text-left p-2 border rounded transition-colors ${
                selectedTool?.name === tool.name
                  ? 'border-violet-500 bg-violet-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-mono font-medium text-sm text-gray-800">{tool.name}</div>
              <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {tool.description || '无描述'}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">来自: {serverId}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：调用控制台 */}
      <div>
        {selectedTool ? (
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-sm text-gray-900 mb-2">
              调用工具: <code className="text-violet-600">{selectedTool.name}</code>
            </h3>
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-700 mb-1">输入参数 Schema:</div>
              <pre className="text-[10px] bg-gray-50 p-2 rounded overflow-x-auto">
                {JSON.stringify(selectedTool.inputSchema, null, 2)}
              </pre>
            </div>
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-700 mb-1">参数 (JSON):</div>
              <textarea
                value={toolArgs}
                onChange={(e) => setToolArgs(e.target.value)}
                className="w-full p-2 border rounded text-xs font-mono"
                rows={5}
              />
            </div>
            <button
              onClick={onCallTool}
              disabled={calling}
              className="w-full px-4 py-2 bg-violet-600 text-white rounded text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {calling ? '调用中...' : '🚀 调用'}
            </button>
            {toolResult && (
              <div className="mt-3">
                <div className="text-xs font-medium text-gray-700 mb-1">结果:</div>
                <div className="p-2 bg-gray-50 rounded text-xs space-y-1">
                  {toolResult.content.map((c: ToolContent, i: number) => (
                    <div key={i}>
                      {c.type === 'text' && <div className="whitespace-pre-wrap">{c.text}</div>}
                      {c.type === 'image' && (
                        <img
                          src={`data:${c.mimeType};base64,${c.data}`}
                          alt="result"
                          className="max-w-full rounded"
                        />
                      )}
                      {c.type === 'resource' && (
                        <pre className="text-[10px]">
                          {JSON.stringify(c.resource, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
                {toolResult.isError && (
                  <div className="text-xs text-red-600 mt-1">⚠️ 工具返回错误</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            ← 选择一个工具开始调用
          </div>
        )}
      </div>
    </div>
  );
};

const AddView: React.FC<{
  formData: {
    id: string;
    name: string;
    description: string;
    category: McpServerCategory;
    transportType: 'stdio' | 'sse';
    command: string;
    url: string;
  };
  setFormData: (data: AddViewProps['formData']) => void;
  addError: string | null;
  onAdd: () => void;
  onCancel: () => void;
}> = ({ formData, setFormData, addError, onAdd, onCancel }) => {
  const categories: McpServerCategory[] = [
    'filesystem',
    'version-control',
    'network',
    'database',
    'search',
    'productivity',
    'ai',
    'custom',
  ];
  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="text-sm font-medium text-gray-700 mb-3">添加自定义 MCP 服务器</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">服务器 ID *</label>
          <input
            value={formData.id}
            onChange={(e) => setFormData({ ...formData, id: e.target.value })}
            placeholder="例如: custom.my-server"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">显示名称 *</label>
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="例如: My Server"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">描述</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">分类</label>
          <select
            value={formData.category}
            onChange={(e) =>
              setFormData({ ...formData, category: e.target.value as McpServerCategory })
            }
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {MCP_CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">传输类型</label>
          <div className="flex gap-2">
            <button
              onClick={() => setFormData({ ...formData, transportType: 'stdio' })}
              className={`px-3 py-1.5 text-sm rounded ${
                formData.transportType === 'stdio'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              Stdio
            </button>
            <button
              onClick={() => setFormData({ ...formData, transportType: 'sse' })}
              className={`px-3 py-1.5 text-sm rounded ${
                formData.transportType === 'sse'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              SSE
            </button>
          </div>
        </div>
        {formData.transportType === 'stdio' ? (
          <div>
            <label className="block text-xs text-gray-600 mb-1">命令 *</label>
            <input
              value={formData.command}
              onChange={(e) => setFormData({ ...formData, command: e.target.value })}
              placeholder="例如: npx"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              完整命令行，包含参数。如: npx -y @my-org/my-mcp-server
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-600 mb-1">URL *</label>
            <input
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://api.example.com/mcp"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            />
          </div>
        )}
        {addError && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {addError}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="px-4 py-2 bg-violet-600 text-white rounded text-sm font-medium hover:bg-violet-700"
          >
            添加
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

type AddViewProps = Parameters<typeof AddView>[0];

const StatsView: React.FC<{ stats: ReturnType<typeof computeRegistryStats> }> = ({ stats }) => {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">注册表统计</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总服务器" value={stats.total} icon="📦" color="violet" />
        <StatCard label="已连接" value={stats.connected} icon="🟢" color="green" />
        <StatCard label="内置" value={stats.builtin} icon="⭐" color="blue" />
        <StatCard label="自定义" value={stats.custom} icon="🛠️" color="orange" />
        <StatCard label="工具总数" value={stats.totalTools} icon="🔧" color="purple" />
        <StatCard label="资源总数" value={stats.totalResources} icon="📚" color="cyan" />
        <StatCard label="提示词总数" value={stats.totalPrompts} icon="💬" color="pink" />
        <StatCard
          label="分类数"
          value={Object.keys(stats.byCategory).length}
          icon="🏷️"
          color="indigo"
        />
      </div>
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">分类分布</h4>
        <div className="space-y-1">
          {Object.entries(stats.byCategory).map(([cat, count]) => {
            const meta = MCP_CATEGORY_META[cat as McpServerCategory];
            return (
              <div
                key={cat}
                className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta?.color }} />
                  <span>{meta?.label || cat}</span>
                </div>
                <span className="font-mono font-medium">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  icon: string;
  color: string;
}> = ({ label, value, icon, color }) => {
  const colorMap: Record<string, string> = {
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    pink: 'bg-pink-50 text-pink-700 border-pink-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  return (
    <div className={`p-3 border rounded-lg ${colorMap[color] || 'bg-gray-50'}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1 flex items-center gap-1">
        <span>{icon}</span>
        <span>{value}</span>
      </div>
    </div>
  );
};

export default McpPanel;
