/**
 * # ============================================================
 * # GlobalMemoryPanel - 跨会话记忆 UI (v1.0.0 Cycle 24 G24-01)
 * # ============================================================
 * # 核心作用：GlobalMemoryEngine 的可视化控制面板
 * # 主要功能：
 * #   1. 统计 Dashboard（按类型/范围/重要性）
 * #   2. 记忆列表（按相关度/时间/重要性排序）
 * #   3. 创建/编辑/删除记忆
 * #   4. 标签管理与过滤
 * #   5. 导入导出（JSON / Markdown）
 * #   6. 智能压缩与清理
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 24 G24-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getGlobalMemoryEngine,
  resetGlobalMemoryEngine,
  MEMORY_TYPE_LABELS,
  MEMORY_SCOPE_LABELS,
  type MemoryType,
  type MemoryScope,
  type GlobalMemoryEntry,
  type GlobalMemoryStats,
  type GlobalMemoryConfig,
  type MemoryQuery,
  type MemorySortBy,
} from '../utils/globalMemory';
import { EmptyState } from './EmptyState';

interface GlobalMemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_COLORS: Record<MemoryType, string> = {
  preference: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  decision: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  fact: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  context: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  feedback: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  rule: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const SCOPE_COLORS: Record<MemoryScope, string> = {
  user: 'bg-slate-700/50 text-slate-200',
  project: 'bg-indigo-700/50 text-indigo-200',
  cycle: 'bg-fuchsia-700/50 text-fuchsia-200',
};

const SORT_OPTIONS: Array<{ key: MemorySortBy; label: string }> = [
  { key: 'recency', label: '最新' },
  { key: 'importance', label: '重要性' },
  { key: 'accessCount', label: '访问量' },
  { key: 'relevance', label: '相关度' },
];

const ALL_TYPES: MemoryType[] = ['preference', 'decision', 'fact', 'context', 'feedback', 'rule'];
const ALL_SCOPES: MemoryScope[] = ['user', 'project', 'cycle'];

export function GlobalMemoryPanel({ isOpen, onClose }: GlobalMemoryPanelProps) {
  const engine = useMemo(() => getGlobalMemoryEngine(), []);
  const [stats, setStats] = useState<GlobalMemoryStats>(engine.getStats());
  const [config, setConfig] = useState<GlobalMemoryConfig>(engine.getConfig());
  const [entries, setEntries] = useState<GlobalMemoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<MemoryType | 'all'>('all');
  const [filterScope, setFilterScope] = useState<MemoryScope | 'all'>('all');
  const [sortBy, setSortBy] = useState<MemorySortBy>('recency');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Partial<GlobalMemoryEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{
    type: MemoryType;
    content: string;
    tags: string;
    scope: MemoryScope;
    importance: number;
  }>({
    type: 'fact',
    content: '',
    tags: '',
    scope: 'user',
    importance: 0.5,
  });

  const refresh = useCallback(() => {
    setStats(engine.getStats());
    setConfig(engine.getConfig());
  }, [engine]);

  const loadEntries = useCallback(() => {
    const query: MemoryQuery = {
      sortBy,
      limit: 200,
    };
    if (searchQuery.trim()) query.query = searchQuery.trim();
    if (filterType !== 'all') query.types = [filterType];
    if (filterScope !== 'all') query.scope = filterScope;
    setEntries(engine.recall(query));
  }, [engine, searchQuery, filterType, filterScope, sortBy]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    loadEntries();
    const off1 = engine.on('memory-created', () => { refresh(); loadEntries(); });
    const off2 = engine.on('memory-updated', () => { refresh(); loadEntries(); });
    const off3 = engine.on('memory-deleted', () => { refresh(); loadEntries(); });
    const off4 = engine.on('memory-compressed', () => { refresh(); loadEntries(); });
    const off5 = engine.on('memory-expired', () => { refresh(); loadEntries(); });
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, [isOpen, engine, refresh, loadEntries]);

  useEffect(() => {
    if (!isOpen) return;
    loadEntries();
  }, [searchQuery, filterType, filterScope, sortBy, loadEntries, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 清除 info/error 3 秒后
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(t);
    }
  }, [error]);
  useEffect(() => {
    if (info) {
      const t = setTimeout(() => setInfo(null), 3000);
      return () => clearTimeout(t);
    }
  }, [info]);

  // 创建记忆
  const handleAdd = useCallback(() => {
    if (!addForm.content.trim()) {
      setError('内容不能为空');
      return;
    }
    setError(null);
    try {
      const tags = addForm.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
      engine.remember({
        type: addForm.type,
        content: addForm.content,
        tags,
        scope: addForm.scope,
        importance: addForm.importance,
        metadata: {},
      });
      setAddForm({ type: 'fact', content: '', tags: '', scope: 'user', importance: 0.5 });
      setShowAddForm(false);
      setInfo('已添加记忆');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    }
  }, [engine, addForm]);

  // 编辑
  const handleStartEdit = useCallback((entry: GlobalMemoryEntry) => {
    setEditingId(entry.id);
    setEditingDraft({ ...entry });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editingDraft) return;
    try {
      engine.update(editingId, editingDraft);
      setEditingId(null);
      setEditingDraft(null);
      setInfo('已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  }, [engine, editingId, editingDraft]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingDraft(null);
  }, []);

  // 删除
  const handleDelete = useCallback((id: string) => {
    if (!confirm('确认删除此记忆？')) return;
    engine.forget(id);
    setInfo('已删除');
  }, [engine]);

  // 提升重要性
  const handleBoost = useCallback((id: string) => {
    engine.boostImportance(id, 0.1);
  }, [engine]);

  // 导出
  const handleExport = useCallback((format: 'json' | 'markdown', scope?: MemoryScope) => {
    const content = engine.export(format, scope);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `global-memory-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'md'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setInfo(`已导出 ${format.toUpperCase()}`);
  }, [engine]);

  // 导入
  const handleImport = useCallback((format: 'json' | 'markdown') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = format === 'json' ? '.json' : '.md,.markdown';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const count = engine.import(text, format);
      setInfo(`已导入 ${count} 条记忆`);
    };
    input.click();
  }, [engine]);

  // 压缩
  const handleCompress = useCallback(() => {
    if (!confirm('确认执行智能压缩？将合并相似记忆。')) return;
    const result = engine.compress();
    setInfo(`压缩完成：合并 ${result.merged} 条，删除 ${result.removed} 条`);
  }, [engine]);

  // 清理过期
  const handleCleanExpired = useCallback(() => {
    const count = engine.cleanExpired();
    setInfo(`清理过期 ${count} 条`);
  }, [engine]);

  // 清空
  const handleClear = useCallback(() => {
    const scope = filterScope === 'all' ? undefined : filterScope;
    const label = scope ? `范围 ${MEMORY_SCOPE_LABELS[scope]}` : '全部';
    if (!confirm(`确认清空${label}记忆？`)) return;
    const count = engine.clear(scope);
    setInfo(`已清空 ${count} 条`);
  }, [engine, filterScope]);

  // 更新配置
  const handleUpdateConfig = useCallback((patch: Partial<GlobalMemoryConfig>) => {
    engine.updateConfig(patch);
    setConfig(engine.getConfig());
  }, [engine]);

  // 重置整个引擎
  const handleResetAll = useCallback(() => {
    if (!confirm('确认重置整个记忆引擎？所有数据将丢失。')) return;
    resetGlobalMemoryEngine();
    setInfo('已重置');
    setTimeout(() => window.location.reload(), 500);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="global-memory-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-7xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center">
              <span className="text-white text-sm">🧠</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">跨会话记忆引擎</h2>
              <p className="text-xs text-slate-400">持久化偏好/决策/事实/上下文/反馈/规则，跨 cycle 持续学习</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              data-testid="memory-add"
              className="px-3 py-1 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
            >
              {showAddForm ? '取消' : '＋ 新增'}
            </button>
            <button
              onClick={handleCompress}
              data-testid="memory-compress"
              className="px-3 py-1 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-xs rounded transition"
              title="合并相似记忆"
            >
              压缩
            </button>
            <button
              onClick={handleCleanExpired}
              data-testid="memory-clean-expired"
              className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs rounded transition"
              title="清理过期记忆"
            >
              清理过期
            </button>
            <div className="relative group">
              <button
                data-testid="memory-export"
                className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs rounded transition"
              >
                导出
              </button>
              <div className="absolute right-0 mt-1 w-40 bg-surface-800 border border-surface-700 rounded shadow-lg hidden group-hover:block z-10">
                <button onClick={() => handleExport('json')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface-700">JSON</button>
                <button onClick={() => handleExport('markdown')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface-700">Markdown</button>
              </div>
            </div>
            <div className="relative group">
              <button
                data-testid="memory-import"
                className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs rounded transition"
              >
                导入
              </button>
              <div className="absolute right-0 mt-1 w-40 bg-surface-800 border border-surface-700 rounded shadow-lg hidden group-hover:block z-10">
                <button onClick={() => handleImport('json')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface-700">JSON</button>
                <button onClick={() => handleImport('markdown')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-surface-700">Markdown</button>
              </div>
            </div>
            <button
              onClick={onClose}
              data-testid="memory-close"
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-6 gap-2 p-3 border-b border-surface-700 bg-surface-800/30" data-testid="memory-stats">
          <MetricCard label="总条数" value={stats.totalEntries.toString()} />
          <MetricCard label="总访问" value={stats.totalAccessCount.toString()} color="text-cyan-400" />
          <MetricCard
            label="平均重要性"
            value={stats.averageImportance.toFixed(2)}
            color="text-violet-400"
          />
          <MetricCard label="偏好" value={stats.byType.preference.toString()} color="text-violet-300" />
          <MetricCard label="决策" value={stats.byType.decision.toString()} color="text-amber-300" />
          <MetricCard label="事实" value={stats.byType.fact.toString()} color="text-blue-300" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-surface-700">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 搜索内容/标签..."
            data-testid="memory-search"
            className="flex-1 min-w-[200px] px-3 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as MemoryType | 'all')}
            data-testid="memory-filter-type"
            className="px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          >
            <option value="all">所有类型</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value as MemoryScope | 'all')}
            data-testid="memory-filter-scope"
            className="px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          >
            <option value="all">所有范围</option>
            {ALL_SCOPES.map((s) => (
              <option key={s} value={s}>
                {MEMORY_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as MemorySortBy)}
            data-testid="memory-sort"
            className="px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                排序: {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleClear}
            data-testid="memory-clear"
            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded transition"
          >
            清空当前
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="p-3 border-b border-surface-700 bg-surface-800/50 animate-in slide-in-from-top-2 duration-200" data-testid="memory-add-form">
            <div className="grid grid-cols-12 gap-2">
              <select
                value={addForm.type}
                onChange={(e) => setAddForm({ ...addForm, type: e.target.value as MemoryType })}
                data-testid="add-type"
                className="col-span-2 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MEMORY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <select
                value={addForm.scope}
                onChange={(e) => setAddForm({ ...addForm, scope: e.target.value as MemoryScope })}
                data-testid="add-scope"
                className="col-span-2 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
              >
                {ALL_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {MEMORY_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={addForm.tags}
                onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })}
                placeholder="标签（逗号分隔）"
                data-testid="add-tags"
                className="col-span-3 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm"
              />
              <div className="col-span-2 flex items-center gap-2">
                <label className="text-xs text-slate-400 whitespace-nowrap">重要性</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={addForm.importance}
                  onChange={(e) => setAddForm({ ...addForm, importance: Number(e.target.value) })}
                  data-testid="add-importance"
                  className="flex-1 accent-primary-500"
                />
                <span className="text-xs text-slate-300 w-8">{addForm.importance.toFixed(1)}</span>
              </div>
              <button
                onClick={handleAdd}
                data-testid="add-confirm"
                className="col-span-3 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded transition"
              >
                ✓ 添加
              </button>
            </div>
            <textarea
              value={addForm.content}
              onChange={(e) => setAddForm({ ...addForm, content: e.target.value })}
              placeholder="记忆内容..."
              data-testid="add-content"
              rows={3}
              className="w-full mt-2 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm resize-none"
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4" data-testid="memory-list">
          {error && (
            <div className="mb-3 p-2 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-300 text-sm">
              {info}
            </div>
          )}

          {entries.length === 0 ? (
            <EmptyState
              icon="🧠"
              title="暂无记忆"
              description="点击右上「＋ 新增」可手动添加记忆，或在 Loop Engineering 工作流中自动累积。"
              tone="info"
              testId="memory-empty"
              action={{
                label: '新增第一条',
                onClick: () => setShowAddForm(true),
                variant: 'primary',
                testId: 'memory-empty-add',
              }}
            />
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  editing={editingId === entry.id}
                  draft={editingDraft}
                  onStartEdit={handleStartEdit}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onDraftChange={setEditingDraft}
                  onDelete={handleDelete}
                  onBoost={handleBoost}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-surface-700 bg-surface-800/50 text-xs text-slate-400">
          <div>
            配置：maxEntries={config.maxEntries} | TTL={config.defaultTtlMs}ms | autoCompress={String(config.autoCompress)}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-slate-500">maxEntries</label>
            <input
              type="number"
              min={10}
              max={10000}
              value={config.maxEntries}
              onChange={(e) => handleUpdateConfig({ maxEntries: Number(e.target.value) })}
              data-testid="config-max-entries"
              className="w-20 px-1.5 py-0.5 bg-surface-900 border border-surface-700 rounded text-white text-xs"
            />
            <button
              onClick={handleResetAll}
              data-testid="memory-reset"
              className="px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded"
            >
              重置引擎
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Entry Card 子组件 ============

interface EntryCardProps {
  entry: GlobalMemoryEntry;
  editing: boolean;
  draft: Partial<GlobalMemoryEntry> | null;
  onStartEdit: (entry: GlobalMemoryEntry) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (d: Partial<GlobalMemoryEntry>) => void;
  onDelete: (id: string) => void;
  onBoost: (id: string) => void;
}

function EntryCard({
  entry,
  editing,
  draft,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDraftChange,
  onDelete,
  onBoost,
}: EntryCardProps) {
  if (editing && draft) {
    return (
      <div className="bg-surface-800 border border-primary-500/50 rounded-lg p-3" data-testid={`memory-edit-${entry.id}`}>
        <div className="flex items-center gap-2 mb-2">
          <select
            value={draft.type}
            onChange={(e) => onDraftChange({ ...draft, type: e.target.value as MemoryType })}
            className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-xs"
          >
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={(draft.tags || []).join(', ')}
            onChange={(e) =>
              onDraftChange({
                ...draft,
                tags: e.target.value.split(',').map((t) => t.trim()).filter((t) => t),
              })
            }
            placeholder="标签（逗号分隔）"
            className="flex-1 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-xs"
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={draft.importance ?? 0.5}
            onChange={(e) => onDraftChange({ ...draft, importance: Number(e.target.value) })}
            className="w-24 accent-primary-500"
          />
          <span className="text-xs text-slate-300 w-8">{(draft.importance ?? 0.5).toFixed(1)}</span>
        </div>
        <textarea
          value={draft.content || ''}
          onChange={(e) => onDraftChange({ ...draft, content: e.target.value })}
          rows={3}
          className="w-full px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-white text-sm resize-none"
        />
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={onCancelEdit}
            className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-slate-300 rounded"
          >
            取消
          </button>
          <button
            onClick={onSaveEdit}
            data-testid={`memory-save-${entry.id}`}
            className="px-2 py-1 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded"
          >
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`memory-entry-${entry.id}`}
      className="bg-surface-800 border border-surface-700 rounded-lg p-3 hover:border-primary-500/40 transition"
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_COLORS[entry.type]}`}>
            {MEMORY_TYPE_LABELS[entry.type]}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${SCOPE_COLORS[entry.scope]}`}>
            {MEMORY_SCOPE_LABELS[entry.scope]}
          </span>
          {entry.tags.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
              #{t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500">重要性 {entry.importance.toFixed(2)}</span>
          <span className="text-[10px] text-slate-600">·</span>
          <span className="text-[10px] text-slate-500">{entry.accessCount}次访问</span>
        </div>
      </div>
      <p className="text-sm text-slate-200 mb-2 whitespace-pre-wrap break-words">{entry.content}</p>
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {new Date(entry.createdAt).toLocaleString()} · 更新于 {new Date(entry.updatedAt).toLocaleTimeString()}
          {entry.expiresAt && (
            <> · <span className="text-amber-400">过期 {new Date(entry.expiresAt).toLocaleString()}</span></>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onBoost(entry.id)}
            data-testid={`memory-boost-${entry.id}`}
            className="px-1.5 py-0.5 text-[10px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded"
            title="提升重要性 +0.1"
          >
            ↑
          </button>
          <button
            onClick={() => onStartEdit(entry)}
            data-testid={`memory-edit-btn-${entry.id}`}
            className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            data-testid={`memory-delete-${entry.id}`}
            className="px-1.5 py-0.5 text-[10px] bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Metric Card 子组件 ============

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface-800/60 border border-surface-700/50 rounded p-2">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}
