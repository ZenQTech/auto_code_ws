/**
 * # ============================================================
 * # MCP Resource Panel - 资源管理面板 (v1.0.0 Cycle 40 G40-02)
 * # ============================================================
 * # 核心作用：MCP 资源的完整管理界面
 * #           - 资源列表 (按 URI / MIME 过滤搜索)
 * #           - 内容预览 (图片/文本/JSON/PDF/二进制)
 * #           - 下载/复制 URI 操作
 * #           - 统计信息
 * # 设计模式：父组件传入 McpClient 实例，组件内部管理 UI 状态
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-02 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Resource, ResourceContent } from '../utils/mcpTypes';
import { McpResourceViewer, classifyContent } from './McpResourceViewer';

// ============ 类型定义 ============

/**
 * 客户端接口（解耦具体实现）
 * 任何实现 listResources/readResource 的对象都可用
 */
export interface McpResourceClient {
  listResources(): Promise<Resource[]>;
  readResource(uri: string): Promise<ResourceContent[]>;
}

export interface McpResourcePanelProps {
  /** MCP 客户端实例 */
  client: McpResourceClient | null;
  /** 默认是否自动加载资源列表 */
  autoLoad?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 资源 URI 变化回调 */
  onResourceSelect?: (resource: Resource | null) => void;
}

type ViewMode = 'list' | 'detail';
type FilterKind = 'all' | 'image' | 'text' | 'json' | 'binary' | 'unknown';

// ============ 主组件 ============

export const McpResourcePanel: React.FC<McpResourcePanelProps> = ({
  client,
  autoLoad = true,
  className = '',
  onResourceSelect,
}) => {
  const [view, setView] = useState<ViewMode>('list');
  const [resources, setResources] = useState<Resource[]>([]);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [content, setContent] = useState<ResourceContent | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [listLoading, setListLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ============ 数据加载 ============

  /**
   * 加载资源列表
   */
  const loadResources = useCallback(async () => {
    if (!client) {
      setError('客户端未连接');
      return;
    }
    setListLoading(true);
    setError(null);
    try {
      const list = await client.listResources();
      setResources(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [client]);

  /**
   * 读取资源内容
   */
  const loadContent = useCallback(
    async (uri: string) => {
      if (!client) {
        setError('客户端未连接');
        return;
      }
      setLoading(true);
      setError(null);
      setContent(null);
      try {
        const contents = await client.readResource(uri);
        setContent(contents[0] ?? null);
        if (!contents[0]) {
          setError('资源内容为空');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  // 自动加载
  useEffect(() => {
    if (!client) {
      setError('客户端未连接');
      return;
    }
    if (autoLoad) {
      void loadResources();
    }
  }, [autoLoad, client, loadResources]);

  // 选择资源变化时加载内容
  useEffect(() => {
    if (selectedUri) {
      void loadContent(selectedUri);
    } else {
      setContent(null);
    }
  }, [selectedUri, loadContent]);

  // ============ 派生数据 ============

  const filteredResources = useMemo(() => {
    let result = resources;
    if (filter !== 'all') {
      result = result.filter((r) => classifyContent(r.mimeType).kind === filter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.uri.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [resources, filter, searchQuery]);

  const selectedResource = useMemo(
    () => resources.find((r) => r.uri === selectedUri) ?? null,
    [resources, selectedUri],
  );

  const stats = useMemo(() => {
    const by: Record<string, number> = { image: 0, text: 0, json: 0, binary: 0, unknown: 0 };
    for (const r of resources) {
      const kind = classifyContent(r.mimeType).kind;
      by[kind] = (by[kind] ?? 0) + 1;
    }
    return { total: resources.length, byKind: by };
  }, [resources]);

  // ============ 事件处理 ============

  const handleSelectResource = useCallback(
    (uri: string) => {
      setSelectedUri(uri);
      setView('detail');
      const r = resources.find((x) => x.uri === uri) ?? null;
      onResourceSelect?.(r);
    },
    [resources, onResourceSelect],
  );

  const handleBackToList = useCallback(() => {
    setView('list');
    setSelectedUri(null);
    setContent(null);
    onResourceSelect?.(null);
  }, [onResourceSelect]);

  const handleCopyUri = useCallback((uri: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(uri);
    }
  }, []);

  // ============ 渲染 ============

  return (
    <div
      data-testid="mcp-resource-panel"
      className={`mcp-resource-panel flex flex-col h-full bg-white ${className}`}
    >
      {/* 头部 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {view === 'detail' && (
            <button
              type="button"
              onClick={handleBackToList}
              className="text-sm text-blue-600 hover:text-blue-800"
              aria-label="返回列表"
            >
              ← 返回
            </button>
          )}
          <h2 className="text-lg font-semibold">
            {view === 'list' ? 'MCP 资源浏览' : selectedResource?.name ?? '资源详情'}
          </h2>
        </div>
        <div className="text-xs text-gray-500">共 {stats.total} 个资源</div>
      </header>

      {/* 列表视图 */}
      {view === 'list' && (
        <>
          <FilterBar
            filter={filter}
            onFilterChange={setFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={loadResources}
            stats={stats}
            loading={listLoading}
          />
          {error && (
            <div
              data-testid="mcp-resource-panel-error"
              className="m-3 p-2 text-sm text-red-600 bg-red-50 rounded border border-red-200"
            >
              {error}
            </div>
          )}
          <ResourceList
            resources={filteredResources}
            loading={listLoading}
            onSelect={handleSelectResource}
            onCopyUri={handleCopyUri}
          />
        </>
      )}

      {/* 详情视图 */}
      {view === 'detail' && selectedResource && (
        <DetailView
          resource={selectedResource}
          content={content}
          loading={loading}
          error={error}
          onCopyUri={handleCopyUri}
        />
      )}
    </div>
  );
};

// ============ 子组件：过滤栏 ============

interface FilterBarProps {
  filter: FilterKind;
  onFilterChange: (f: FilterKind) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  stats: { total: number; byKind: Record<string, number> };
  loading: boolean;
}

const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onRefresh,
  stats,
  loading,
}) => {
  const filters: { key: FilterKind; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: stats.total },
    { key: 'image', label: '图片', count: stats.byKind.image ?? 0 },
    { key: 'text', label: '文本', count: stats.byKind.text ?? 0 },
    { key: 'json', label: 'JSON', count: stats.byKind.json ?? 0 },
    { key: 'binary', label: '二进制', count: stats.byKind.binary ?? 0 },
    { key: 'unknown', label: '其他', count: stats.byKind.unknown ?? 0 },
  ];

  return (
    <div className="px-4 py-2 border-b border-gray-100 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="搜索 URI / 名称 / 描述"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={`px-2 py-1 text-xs rounded ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
    </div>
  );
};

// ============ 子组件：资源列表 ============

interface ResourceListProps {
  resources: Resource[];
  loading: boolean;
  onSelect: (uri: string) => void;
  onCopyUri: (uri: string) => void;
}

const ResourceList: React.FC<ResourceListProps> = ({ resources, loading, onSelect, onCopyUri }) => {
  if (loading && resources.length === 0) {
    return (
      <div data-testid="mcp-resource-list-loading" className="flex-1 p-4 text-sm text-gray-500">
        加载中…
      </div>
    );
  }
  if (resources.length === 0) {
    return (
      <div
        data-testid="mcp-resource-list-empty"
        className="flex-1 p-8 text-sm text-gray-400 text-center"
      >
        暂无资源
      </div>
    );
  }
  return (
    <ul data-testid="mcp-resource-list" className="flex-1 overflow-y-auto divide-y divide-gray-100">
      {resources.map((r) => {
        const info = classifyContent(r.mimeType);
        return (
          <li
            key={r.uri}
            data-testid="mcp-resource-item"
            data-uri={r.uri}
            data-mime={r.mimeType}
            data-kind={info.kind}
            className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
            onClick={() => onSelect(r.uri)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <KindIcon kind={info.kind} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-gray-500 truncate">{r.uri}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.mimeType && (
                  <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded">{r.mimeType}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyUri(r.uri);
                  }}
                  className="text-xs text-gray-500 hover:text-blue-600"
                  aria-label="复制 URI"
                  title="复制 URI"
                >
                  复制
                </button>
              </div>
            </div>
            {r.description && (
              <div className="text-xs text-gray-500 mt-1 ml-6 line-clamp-1">{r.description}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ============ 子组件：详情视图 ============

interface DetailViewProps {
  resource: Resource;
  content: ResourceContent | null;
  loading: boolean;
  error: string | null;
  onCopyUri: (uri: string) => void;
}

const DetailView: React.FC<DetailViewProps> = ({ resource, content, loading, error, onCopyUri }) => {
  return (
    <div data-testid="mcp-resource-detail" className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="text-xs text-gray-600 truncate flex-1" title={resource.uri}>
          {resource.uri}
        </div>
        <div className="flex items-center gap-2 ml-2">
          {resource.mimeType && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-200 rounded">{resource.mimeType}</span>
          )}
          <button
            type="button"
            onClick={() => onCopyUri(resource.uri)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            复制 URI
          </button>
        </div>
      </div>
      <div className="p-4">
        <McpResourceViewer
          resource={resource}
          content={content}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
};

// ============ 子组件：类型图标 ============

const KindIcon: React.FC<{ kind: ReturnType<typeof classifyContent>['kind'] }> = ({ kind }) => {
  const icons: Record<string, string> = {
    text: '📄',
    code: '📝',
    json: '🔧',
    markdown: '📑',
    image: '🖼️',
    pdf: '📕',
    audio: '🎵',
    video: '🎬',
    binary: '📦',
    unknown: '❓',
  };
  return <span className="text-base flex-shrink-0">{icons[kind] ?? '❓'}</span>;
};

export default McpResourcePanel;
