/**
 * # ============================================================
 * MemoryPanel - 智能体长期记忆管理面板 (v1.0.0 - Cycle 10 P1-8)
 * # ============================================================
 * 核心作用：可视化展示 Memory System（Dual-Track Persistent Memory）
 *           整合 EntityList + RelationGraph + ObservationTimeline + Search
 * 运行流程：
 *   1. 挂载时拉取统计 + 图谱 + 实体列表
 *   2. 用户搜索/创建/删除/更新时调用对应 API
 *   3. 点击实体切换详情面板（observations + relations）
 *   4. memory-kernel / self-improvement / memory-recall 一键演示按钮
 * 输入参数：
 *   - onClose?: 关闭回调（可选，注入到 AppLayout 模式时不传）
 *   - standalone?: 是否独立页面模式（true 时全屏）
 * 输出结果：完整的 React 组件
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  addObservation,
  createEntity,
  createRelation,
  deleteEntity,
  deleteObservation,
  deleteRelation,
  fetchGraph,
  fetchHealth,
  fetchStats,
  getEntity,
  listEntities,
  listRelations,
  searchMemory,
  updateEntity,
  type EntityTypeName,
  type MemoryEntity,
  type MemoryGraph,
  type MemoryRelation,
  type MemorySearchResult,
  type MemoryStats,
  type RelationTypeName,
} from '../hooks/useMemoryApi';

// ============================================================
// 常量
// ============================================================

const ENTITY_TYPES: EntityTypeName[] = [
  'project',
  'pattern',
  'preference',
  'profile',
  'fact',
];

const RELATION_TYPES: RelationTypeName[] = [
  'depends_on',
  'uses',
  'solves',
  'conflicts',
  'extends',
  'related_to',
];

const ENTITY_COLORS: Record<string, string> = {
  project: '#3b82f6',     // 蓝
  pattern: '#10b981',     // 绿
  preference: '#f59e0b',  // 黄
  profile: '#a855f7',     // 紫
  fact: '#6b7280',        // 灰
};

const RELATION_COLORS: Record<string, string> = {
  depends_on: '#ef4444',
  uses: '#3b82f6',
  solves: '#10b981',
  conflicts: '#f97316',
  extends: '#a855f7',
  related_to: '#6b7280',
};

// ============================================================
// 工具函数
// ============================================================

const formatDate = (iso: string) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
};

const todayDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ============================================================
// 子组件：EntityCard
// ============================================================

interface EntityCardProps {
  entity: MemoryEntity;
  selected: boolean;
  onClick: () => void;
}

const EntityCard: React.FC<EntityCardProps> = ({ entity, selected, onClick }) => {
  const color = ENTITY_COLORS[entity.entity_type] || '#6b7280';
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        selected
          ? 'border-hermes-500 bg-hermes-50 shadow-md'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="font-mono text-sm font-semibold truncate" title={entity.name}>
              {entity.name}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span
              className="px-1.5 py-0.5 rounded text-white"
              style={{ backgroundColor: color }}
            >
              {entity.entity_type}
            </span>
            {entity.project && entity.project !== '_global' && (
              <span className="text-[var(--text-tertiary)]">@ {entity.project}</span>
            )}
          </div>
        </div>
        <div className="text-xs text-[var(--text-tertiary)] text-right flex-shrink-0">
          {entity.observations?.length || 0} obs
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：EntityDetail
// ============================================================

interface EntityDetailProps {
  entity: MemoryEntity;
  relations: MemoryRelation[];
  onAddObservation: (content: string) => Promise<void>;
  onDeleteObservation: (id: string) => Promise<void>;
  onAddRelation: (target: string, relType: RelationTypeName) => Promise<void>;
  onDeleteRelation: (id: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onUpdate: (metadata: Record<string, any>) => Promise<void>;
  allEntities: MemoryEntity[];
}

const EntityDetail: React.FC<EntityDetailProps> = ({
  entity,
  relations,
  onAddObservation,
  onDeleteObservation,
  onAddRelation,
  onDeleteRelation,
  onDelete,
  onUpdate,
  allEntities,
}) => {
  const [newObs, setNewObs] = useState('');
  const [newRelTarget, setNewRelTarget] = useState('');
  const [newRelType, setNewRelType] = useState<RelationTypeName>('uses');
  const [metadataText, setMetadataText] = useState(
    JSON.stringify(entity.metadata || {}, null, 2)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddObs = async () => {
    if (!newObs.trim()) return;
    setIsSubmitting(true);
    try {
      const content = newObs.startsWith('[') ? newObs : `[${todayDate()}] ${newObs}`;
      await onAddObservation(content);
      setNewObs('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddRel = async () => {
    if (!newRelTarget.trim()) return;
    setIsSubmitting(true);
    try {
      await onAddRelation(newRelTarget, newRelType);
      setNewRelTarget('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateMeta = async () => {
    setIsSubmitting(true);
    try {
      const parsed = JSON.parse(metadataText);
      await onUpdate(parsed);
    } catch (e) {
      alert('metadata 必须是合法 JSON');
    } finally {
      setIsSubmitting(false);
    }
  };

  const otherEntities = allEntities.filter((e) => e.name !== entity.name);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono">{entity.name}</h2>
          <div className="flex items-center gap-2 mt-1 text-sm text-[var(--text-secondary)]">
            <span
              className="px-2 py-0.5 rounded text-white text-xs"
              style={{ backgroundColor: ENTITY_COLORS[entity.entity_type] || '#6b7280' }}
            >
              {entity.entity_type}
            </span>
            <span>{entity.project}</span>
            <span>·</span>
            <span>创建 {formatDate(entity.created_at)}</span>
            <span>·</span>
            <span>更新 {formatDate(entity.updated_at)}</span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100"
        >
          删除
        </button>
      </div>

      {/* Observations */}
      <div className="bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] p-4">
        <h3 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">
          观察记录 ({entity.observations?.length || 0})
        </h3>
        <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {entity.observations && entity.observations.length > 0 ? (
            entity.observations.map((obs) => (
              <div
                key={obs.id}
                className="flex items-start justify-between gap-2 p-2 bg-gray-50 rounded"
              >
                <div className="flex-1 text-sm">
                  <div className="text-[var(--text-primary)]">{obs.content}</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1">
                    {obs.source} · confidence {obs.confidence.toFixed(1)} · {formatDate(obs.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => onDeleteObservation(obs.id)}
                  className="text-xs text-red-500 hover:underline flex-shrink-0"
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-[var(--text-tertiary)]">暂无观察记录</div>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newObs}
            onChange={(e) => setNewObs(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddObs()}
            placeholder="[2026-07-28] 内容（自动加日期）"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-hermes-500"
          />
          <button
            onClick={handleAddObs}
            disabled={isSubmitting || !newObs.trim()}
            className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>

      {/* Relations */}
      <div className="bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] p-4">
        <h3 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">
          实体关系 ({relations.length})
        </h3>
        <div className="space-y-1 mb-3">
          {relations.length > 0 ? (
            relations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-white text-xs"
                    style={{ backgroundColor: RELATION_COLORS[rel.relation_type] || '#6b7280' }}
                  >
                    {rel.relation_type}
                  </span>
                  <span className="font-mono">
                    {rel.source === entity.name ? (
                      <>→ <span className="text-hermes-600">{rel.target}</span></>
                    ) : (
                      <><span className="text-hermes-600">{rel.source}</span> →</>
                    )}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">w={rel.weight.toFixed(1)}</span>
                </div>
                <button
                  onClick={() => onDeleteRelation(rel.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-[var(--text-tertiary)]">暂无关系</div>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={newRelType}
            onChange={(e) => setNewRelType(e.target.value as RelationTypeName)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={newRelTarget}
            onChange={(e) => setNewRelTarget(e.target.value)}
            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
          >
            <option value="">选择目标实体...</option>
            {otherEntities.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.entity_type})
              </option>
            ))}
          </select>
          <button
            onClick={handleAddRel}
            disabled={isSubmitting || !newRelTarget}
            className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] p-4">
        <h3 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">元数据 (metadata)</h3>
        <textarea
          value={metadataText}
          onChange={(e) => setMetadataText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-hermes-500"
        />
        <button
          onClick={handleUpdateMeta}
          disabled={isSubmitting}
          className="mt-2 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          更新 metadata
        </button>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：GraphView
// ============================================================

interface GraphViewProps {
  graph: MemoryGraph;
  selectedEntity: string | null;
  onSelectEntity: (name: string) => void;
}

const GraphView: React.FC<GraphViewProps> = ({ graph, selectedEntity, onSelectEntity }) => {
  // 简单的网格布局：实体均匀分布，关系用 SVG 曲线连接
  const positions = useMemo(() => {
    const w = 600;
    const h = 400;
    const n = graph.entities.length;
    if (n === 0) return [];
    const cols = Math.ceil(Math.sqrt(n * (w / h)));
    const rows = Math.ceil(n / cols);
    return graph.entities.map((e, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      return {
        name: e.name,
        x: ((c + 0.5) * w) / cols,
        y: ((r + 0.5) * h) / rows,
        type: e.entity_type,
      };
    });
  }, [graph.entities]);

  const getPos = (name: string) => positions.find((p) => p.name === name);

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] p-4">
      <h3 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">
        知识图谱 ({graph.entities.length} 实体 / {graph.relations.length} 关系)
      </h3>
      <div className="relative bg-gray-50 rounded" style={{ height: 400 }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 600 400"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 关系连线 */}
          {graph.relations.map((rel) => {
            const s = getPos(rel.source);
            const t = getPos(rel.target);
            if (!s || !t) return null;
            const color = RELATION_COLORS[rel.relation_type] || '#6b7280';
            return (
              <g key={rel.id}>
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={color}
                  strokeWidth="1.5"
                  strokeOpacity="0.6"
                />
                <text
                  x={(s.x + t.x) / 2}
                  y={(s.y + t.y) / 2 - 4}
                  fontSize="9"
                  fill={color}
                  textAnchor="middle"
                  className="font-mono"
                >
                  {rel.relation_type}
                </text>
              </g>
            );
          })}
          {/* 实体节点 */}
          {positions.map((p) => {
            const color = ENTITY_COLORS[p.type] || '#6b7280';
            const isSelected = selectedEntity === p.name;
            return (
              <g
                key={p.name}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectEntity(p.name)}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isSelected ? 12 : 8}
                  fill={color}
                  stroke={isSelected ? '#1f2937' : 'white'}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
                <text
                  x={p.x}
                  y={p.y + 22}
                  fontSize="10"
                  fill="#1f2937"
                  textAnchor="middle"
                  className="font-mono"
                >
                  {p.name.length > 18 ? p.name.slice(0, 16) + '...' : p.name}
                </text>
              </g>
            );
          })}
        </svg>
        {graph.entities.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-tertiary)]">
            暂无实体
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {Object.entries(ENTITY_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[var(--text-secondary)]">{type}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// 主组件：MemoryPanel
// ============================================================

interface MemoryPanelProps {
  onClose?: () => void;
  standalone?: boolean;
}

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ onClose, standalone = false }) => {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [graph, setGraph] = useState<MemoryGraph>({ entities: [], relations: [], observations: [] });
  const [entities, setEntities] = useState<MemoryEntity[]>([]);
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<MemoryEntity | null>(null);
  const [selectedRelations, setSelectedRelations] = useState<MemoryRelation[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newEntity, setNewEntity] = useState({
    name: '',
    entity_type: 'project' as EntityTypeName,
    project: '_global',
  });
  const [version, setVersion] = useState<string>('');

  // ============================================================
  // 数据加载
  // ============================================================

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsRes, graphRes, entitiesRes, healthRes] = await Promise.all([
        fetchStats(),
        fetchGraph(),
        listEntities({ limit: 500 }),
        fetchHealth(),
      ]);
      setStats(statsRes.data);
      setGraph(graphRes.data);
      setEntities(entitiesRes.data);
      setVersion(healthRes.version);
    } catch (e: any) {
      setError(`加载失败: ${e.message || e}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 选中实体后加载详情
  useEffect(() => {
    if (!selectedEntityName) {
      setSelectedEntity(null);
      setSelectedRelations([]);
      return;
    }
    Promise.all([
      getEntity(selectedEntityName),
      listRelations({ source: selectedEntityName }),
      listRelations({ target: selectedEntityName }),
    ])
      .then(([entRes, srcRels, tgtRels]) => {
        setSelectedEntity(entRes.data);
        setSelectedRelations([...srcRels.data, ...tgtRels.data]);
      })
      .catch((e) => setError(`加载详情失败: ${e.message || e}`));
  }, [selectedEntityName]);

  // ============================================================
  // 操作
  // ============================================================

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await searchMemory(searchQuery, 20);
      setSearchResults(res.data);
    } catch (e: any) {
      setError(`搜索失败: ${e.message || e}`);
    }
  };

  const handleCreate = async () => {
    if (!newEntity.name.trim()) return;
    setIsLoading(true);
    try {
      await createEntity(newEntity);
      setNewEntity({ name: '', entity_type: 'project', project: '_global' });
      setShowCreate(false);
      await refresh();
    } catch (e: any) {
      setError(`创建失败: ${e.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteEntity = async (name: string) => {
    if (!confirm(`确认删除实体 ${name}?`)) return;
    try {
      await deleteEntity(name, name.startsWith('public_'));
      setSelectedEntityName(null);
      await refresh();
    } catch (e: any) {
      setError(`删除失败: ${e.message || e}`);
    }
  };

  const handleAddObservation = async (content: string) => {
    if (!selectedEntityName) return;
    try {
      await addObservation({ entity_name: selectedEntityName, content });
      const res = await getEntity(selectedEntityName);
      setSelectedEntity(res.data);
      await refresh();
    } catch (e: any) {
      setError(`添加观察失败: ${e.message || e}`);
      throw e;
    }
  };

  const handleDeleteObservation = async (id: string) => {
    try {
      await deleteObservation(id);
      if (selectedEntityName) {
        const res = await getEntity(selectedEntityName);
        setSelectedEntity(res.data);
      }
      await refresh();
    } catch (e: any) {
      setError(`删除观察失败: ${e.message || e}`);
    }
  };

  const handleAddRelation = async (target: string, relType: RelationTypeName) => {
    if (!selectedEntityName) return;
    try {
      await createRelation({
        source: selectedEntityName,
        target,
        relation_type: relType,
      });
      const [, srcRels, tgtRels] = await Promise.all([
        Promise.resolve(),
        listRelations({ source: selectedEntityName }),
        listRelations({ target: selectedEntityName }),
      ]);
      setSelectedRelations([...srcRels.data, ...tgtRels.data]);
      await refresh();
    } catch (e: any) {
      setError(`添加关系失败: ${e.message || e}`);
      throw e;
    }
  };

  const handleDeleteRelation = async (id: string) => {
    try {
      await deleteRelation(id);
      if (selectedEntityName) {
        const [srcRels, tgtRels] = await Promise.all([
          listRelations({ source: selectedEntityName }),
          listRelations({ target: selectedEntityName }),
        ]);
        setSelectedRelations([...srcRels.data, ...tgtRels.data]);
      }
      await refresh();
    } catch (e: any) {
      setError(`删除关系失败: ${e.message || e}`);
    }
  };

  const handleUpdateMetadata = async (metadata: Record<string, any>) => {
    if (!selectedEntityName) return;
    try {
      await updateEntity(selectedEntityName, { metadata });
      const res = await getEntity(selectedEntityName);
      setSelectedEntity(res.data);
      await refresh();
    } catch (e: any) {
      setError(`更新失败: ${e.message || e}`);
      throw e;
    }
  };

  // ============================================================
  // 过滤逻辑
  // ============================================================

  const filteredEntities = useMemo(() => {
    let result = entities;
    if (filterType !== 'all') {
      result = result.filter((e) => e.entity_type === filterType);
    }
    return result;
  }, [entities, filterType]);

  const displayEntities = searchResults.length > 0 ? searchResults.map((r) => r.entity) : filteredEntities;

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div className={`flex flex-col h-full bg-[var(--bg-app)] ${standalone ? '' : 'rounded-lg border border-[var(--border-color)]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div>
          <h1 className="text-lg font-bold text-[var(--text-primary)]">
            🧠 Memory System
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Dual-Track Persistent Memory v{version} · {stats ? `${stats.total_entities} entities / ${stats.total_relations} relations / ${stats.total_observations} observations` : '加载中...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-gray-100 text-[var(--text-primary)] rounded hover:bg-gray-200 disabled:opacity-50"
          >
            {isLoading ? '刷新中...' : '🔄 刷新'}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded hover:bg-hermes-600"
          >
            + 新建实体
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-gray-100 text-[var(--text-primary)] rounded hover:bg-gray-200"
            >
              ✕ 关闭
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center justify-between">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:underline">
            关闭
          </button>
        </div>
      )}

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 p-4">
          {[
            { label: '实体', value: stats.total_entities, color: 'blue' },
            { label: '关系', value: stats.total_relations, color: 'green' },
            { label: '观察', value: stats.total_observations, color: 'amber' },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--bg-panel)] rounded-lg p-3 border border-[var(--border-color)]">
              <div className="text-xs text-[var(--text-secondary)]">{s.label}</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 grid grid-cols-12 gap-3 p-4 overflow-hidden">
        {/* 左侧：实体列表 */}
        <div className="col-span-3 flex flex-col bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] overflow-hidden">
          <div className="p-3 border-b border-gray-200 space-y-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索关键词..."
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-hermes-500"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
            >
              <option value="all">全部类型</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {searchResults.length > 0 && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="w-full text-xs text-blue-500 hover:underline"
              >
                清除搜索结果
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {displayEntities.length > 0 ? (
              displayEntities.map((e) => (
                <EntityCard
                  key={e.name}
                  entity={e}
                  selected={selectedEntityName === e.name}
                  onClick={() => setSelectedEntityName(e.name)}
                />
              ))
            ) : (
              <div className="text-sm text-[var(--text-tertiary)] text-center p-4">
                {isLoading ? '加载中...' : '暂无数据'}
              </div>
            )}
          </div>
        </div>

        {/* 中间：图谱 */}
        <div className="col-span-4">
          <GraphView
            graph={graph}
            selectedEntity={selectedEntityName}
            onSelectEntity={(n) => setSelectedEntityName(n)}
          />
        </div>

        {/* 右侧：实体详情 */}
        <div className="col-span-5 bg-[var(--bg-panel)] rounded-lg border border-[var(--border-color)] p-4 overflow-y-auto">
          {selectedEntity ? (
            <EntityDetail
              entity={selectedEntity}
              relations={selectedRelations}
              onAddObservation={handleAddObservation}
              onDeleteObservation={handleDeleteObservation}
              onAddRelation={handleAddRelation}
              onDeleteRelation={handleDeleteRelation}
              onDelete={() => handleDeleteEntity(selectedEntity.name)}
              onUpdate={handleUpdateMetadata}
              allEntities={entities}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] text-sm">
              <div className="text-4xl mb-2">👈</div>
              <div>从左侧列表选择一个实体查看详情</div>
            </div>
          )}
        </div>
      </div>

      {/* 新建实体对话框 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-panel)] rounded-lg p-6 w-96 max-w-full">
            <h2 className="text-lg font-bold mb-4">新建实体</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">名称 (snake_case, 3-128 字符)</label>
                <input
                  type="text"
                  value={newEntity.name}
                  onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })}
                  placeholder="my_entity_name"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">类型</label>
                <select
                  value={newEntity.entity_type}
                  onChange={(e) => setNewEntity({ ...newEntity, entity_type: e.target.value as EntityTypeName })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded"
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">项目</label>
                <input
                  type="text"
                  value={newEntity.project}
                  onChange={(e) => setNewEntity({ ...newEntity, project: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-[var(--text-primary)] rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={isLoading || !newEntity.name.trim()}
                className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryPanel;
