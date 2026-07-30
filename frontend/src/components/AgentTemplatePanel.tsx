/**
 * # ============================================================
 * # AgentTemplatePanel - 代理模板面板 (v1.0.0 Cycle 27 G27-05)
 * # ============================================================
 * # 核心作用：提供代理模板的可视化管理界面
 * # 功能：模板市场浏览、模板安装/卸载、用户模板 CRUD、模板评分
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-05 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AgentTemplate,
  AgentTemplateCategory,
  AgentTemplateScope,
  TEMPLATE_CATEGORY_METADATA,
  TEMPLATE_MODEL_METADATA,
  TEMPLATE_REASONING_METADATA,
  TEMPLATE_ROLE_METADATA,
  TEMPLATE_SCOPE_METADATA,
} from '../utils/agentTemplateTypes';
import {
  AgentTemplateEngine,
  getDefaultAgentTemplateEngine,
} from '../utils/agentTemplateEngine';

type ViewMode = 'installed' | 'market' | 'create';
type CategoryFilter = AgentTemplateCategory | 'all';
type ScopeFilter = AgentTemplateScope | 'all';

export interface AgentTemplatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine?: AgentTemplateEngine;
}

export function AgentTemplatePanel({
  isOpen,
  onClose,
  engine: propEngine,
}: AgentTemplatePanelProps): React.ReactElement | null {
  const fallbackEngine = useMemo(() => getDefaultAgentTemplateEngine(), []);
  const engine = propEngine ?? fallbackEngine;
  const [viewMode, setViewMode] = useState<ViewMode>('installed');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [_refreshKey, setRefreshKey] = useState(0);

  // 订阅事件触发刷新
  useEffect(() => {
    const unsubInstalled = engine.on('template-installed', () => setRefreshKey((k) => k + 1));
    const unsubUninstalled = engine.on('template-uninstalled', () => setRefreshKey((k) => k + 1));
    const unsubUpdated = engine.on('template-updated', () => setRefreshKey((k) => k + 1));
    const unsubImported = engine.on('template-imported', () => setRefreshKey((k) => k + 1));
    return () => {
      unsubInstalled();
      unsubUninstalled();
      unsubUpdated();
      unsubImported();
    };
  }, [engine]);

  if (!isOpen) return null;

  const installed = engine.listInstalled({
    scope: scopeFilter === 'all' ? undefined : scopeFilter,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    search: search.trim() || undefined,
  });

  const market = engine.getMarketList({
    search: search.trim() || undefined,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
  });

  const stats = engine.getStats();

  const selectedTemplate = selectedTemplateId ? engine.getTemplate(selectedTemplateId) : null;
  const isMarketItem = selectedTemplateId
    ? market.find((m) => m.template.id === selectedTemplateId)
    : null;

  return (
    <div
      data-testid="agent-template-panel"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        <Header
          stats={stats}
          onClose={onClose}
        />

        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          search={search}
          onSearchChange={setSearch}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          scopeFilter={scopeFilter}
          onScopeFilterChange={setScopeFilter}
          onCreate={() => {
            setShowCreateForm(true);
            setViewMode('create');
          }}
          showCreateForm={showCreateForm}
        />

        <div className="flex-1 flex overflow-hidden">
          <TemplateList
            items={viewMode === 'market' ? market.map((m) => ({ template: m.template, installed: m.installed, hasUpdate: m.hasUpdate })) : installed.map((t) => ({ template: t, installed: true, hasUpdate: false }))}
            viewMode={viewMode}
            selectedId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
          />
          {viewMode === 'create' ? (
            <CreateForm
              engine={engine}
              onCreated={(id) => {
                setSelectedTemplateId(id);
                setViewMode('installed');
                setShowCreateForm(false);
              }}
              onCancel={() => {
                setViewMode('installed');
                setShowCreateForm(false);
              }}
            />
          ) : selectedTemplate ? (
            <TemplateDetail
              template={selectedTemplate}
              isMarket={!!isMarketItem}
              isInstalled={isMarketItem ? isMarketItem.installed : true}
              hasUpdate={isMarketItem?.hasUpdate ?? false}
              engine={engine}
              onClose={() => setSelectedTemplateId(null)}
              onUpdated={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <EmptyState
              viewMode={viewMode}
              onCreate={() => {
                setViewMode('create');
                setShowCreateForm(true);
              }}
            />
          )}
        </div>

        <Footer count={viewMode === 'market' ? market.length : installed.length} viewMode={viewMode} />
      </div>
    </div>
  );
}

// ============ Header ============

function Header({ stats, onClose }: { stats: ReturnType<AgentTemplateEngine['getStats']>; onClose: () => void }): React.ReactElement {
  return (
    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">📋</span>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">代理模板</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            共 {stats.totalTemplates} 个模板 · 内置 {stats.builtinCount} · 用户 {stats.userCount} · 社区 {stats.communityCount} · 平均评分 {stats.averageRating.toFixed(1)} ⭐
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-2xl leading-none"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}

// ============ Toolbar ============

function Toolbar({
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  scopeFilter,
  onScopeFilterChange,
  onCreate,
  showCreateForm,
}: {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  search: string;
  onSearchChange: (s: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (c: CategoryFilter) => void;
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (s: ScopeFilter) => void;
  onCreate: () => void;
  showCreateForm: boolean;
}): React.ReactElement {
  return (
    <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
      <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded p-1 text-sm">
        <TabButton active={viewMode === 'installed'} onClick={() => onViewModeChange('installed')} testId="tab-installed">
          📦 已安装
        </TabButton>
        <TabButton active={viewMode === 'market'} onClick={() => onViewModeChange('market')} testId="tab-market">
          🌐 市场
        </TabButton>
        <TabButton active={viewMode === 'create' || showCreateForm} onClick={onCreate} testId="tab-create">
          ➕ 新建
        </TabButton>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="搜索名称/描述/标签..."
        className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 flex-1 min-w-[200px]"
        data-testid="search-input"
      />

      <select
        value={categoryFilter}
        onChange={(e) => onCategoryFilterChange(e.target.value as CategoryFilter)}
        className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        data-testid="category-filter"
      >
        <option value="all">全部分类</option>
        {Object.entries(TEMPLATE_CATEGORY_METADATA).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.icon} {meta.label}
          </option>
        ))}
      </select>

      {viewMode === 'installed' && (
        <select
          value={scopeFilter}
          onChange={(e) => onScopeFilterChange(e.target.value as ScopeFilter)}
          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          data-testid="scope-filter"
        >
          <option value="all">全部作用域</option>
          {Object.entries(TEMPLATE_SCOPE_METADATA).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.icon} {meta.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-1 rounded text-sm font-medium transition ${
        active
          ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow'
          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

// ============ Template List ============

function TemplateList({
  items,
  viewMode,
  selectedId,
  onSelect,
}: {
  items: Array<{ template: AgentTemplate; installed: boolean; hasUpdate: boolean }>;
  viewMode: ViewMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="w-80 border-r border-slate-200 dark:border-slate-700 overflow-y-auto" data-testid="template-list">
      {items.length === 0 ? (
        <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">没有匹配的模板</div>
      ) : (
        items.map(({ template, installed, hasUpdate }) => {
          const catMeta = TEMPLATE_CATEGORY_METADATA[template.category];
          const scopeMeta = TEMPLATE_SCOPE_METADATA[template.scope];
          return (
            <div
              key={template.id}
              data-testid={`template-item-${template.id}`}
              className={`p-3 border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition ${
                selectedId === template.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
              }`}
              onClick={() => onSelect(template.id)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{template.icon}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100 text-sm flex-1 truncate">
                  {template.displayName}
                </span>
                {hasUpdate && <span className="text-xs text-orange-500">⬆</span>}
                {viewMode === 'market' && installed && <span className="text-xs text-green-500">✓</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className={catMeta.color}>{catMeta.icon} {catMeta.label}</span>
                <span>·</span>
                <span>{scopeMeta.icon} {scopeMeta.label}</span>
                <span>·</span>
                <span>v{template.version}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                {template.description}
              </p>
              {template.rating !== undefined && (
                <div className="mt-1 text-xs text-yellow-500">
                  ⭐ {template.rating.toFixed(1)} ({template.ratingCount ?? 0})
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ============ Template Detail ============

function TemplateDetail({
  template,
  isMarket,
  isInstalled,
  hasUpdate,
  engine,
  onClose,
  onUpdated,
}: {
  template: AgentTemplate;
  isMarket: boolean;
  isInstalled: boolean;
  hasUpdate: boolean;
  engine: AgentTemplateEngine;
  onClose: () => void;
  onUpdated: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(template.systemPrompt);
  const [editedDescription, setEditedDescription] = useState(template.description);
  const catMeta = TEMPLATE_CATEGORY_METADATA[template.category];
  const scopeMeta = TEMPLATE_SCOPE_METADATA[template.scope];
  const roleMeta = TEMPLATE_ROLE_METADATA[template.role];
  const modelMeta = TEMPLATE_MODEL_METADATA[template.model];
  const reasoningMeta = TEMPLATE_REASONING_METADATA[template.reasoningEffort];

  const handleInstall = () => {
    try {
      engine.installTemplate(template.id);
      onUpdated();
    } catch (e) {
      window.alert(`安装失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUninstall = () => {
    try {
      engine.uninstallTemplate(template.id);
      onClose();
    } catch (e) {
      window.alert(`卸载失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = () => {
    try {
      engine.deleteUserTemplate(template.id);
      onClose();
    } catch (e) {
      window.alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUpdate = () => {
    try {
      engine.updateTemplate(template.id);
      onUpdated();
    } catch (e) {
      window.alert(`更新失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSave = () => {
    try {
      engine.updateUserTemplate(template.id, { systemPrompt: editedPrompt, description: editedDescription });
      setEditing(false);
      onUpdated();
    } catch (e) {
      window.alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRate = (score: number) => {
    try {
      engine.rateTemplate(template.id, score);
      onUpdated();
    } catch (e) {
      window.alert(`评分失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleFork = () => {
    try {
      const newName = `${template.name}-fork-${Date.now().toString(36).slice(-4)}`;
      const forked = engine.forkTemplate(template.id, newName);
      onUpdated();
      window.alert(`已派生: ${forked.displayName}`);
    } catch (e) {
      window.alert(`派生失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExport = () => {
    try {
      const json = engine.exportTemplate(template.id);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="template-detail">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-4xl">{template.icon}</span>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{template.displayName}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <code>{template.name}</code> · v{template.version} · {scopeMeta.icon} {scopeMeta.label}
          </p>
        </div>
        {isMarket && !isInstalled && (
          <button
            onClick={handleInstall}
            data-testid="install-button"
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium"
          >
            📥 安装
          </button>
        )}
        {isMarket && isInstalled && hasUpdate && (
          <button
            onClick={handleUpdate}
            data-testid="update-button"
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded font-medium"
          >
            ⬆ 更新
          </button>
        )}
        {!isMarket && template.scope === 'user' && (
          <>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white text-sm rounded"
                data-testid="edit-button"
              >
                ✏️ 编辑
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded"
                  data-testid="save-button"
                >
                  💾 保存
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditedPrompt(template.systemPrompt);
                    setEditedDescription(template.description);
                  }}
                  className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white text-sm rounded ml-2"
                >
                  取消
                </button>
              </>
            )}
            <button
              onClick={handleDelete}
              data-testid="delete-button"
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded ml-2"
            >
              🗑️ 删除
            </button>
          </>
        )}
      </div>

      {/* Meta Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetaCard label="分类" value={`${catMeta.icon} ${catMeta.label}`} />
        <MetaCard label="角色" value={`${roleMeta.icon} ${roleMeta.label}`} />
        <MetaCard label="模型" value={modelMeta.label} />
        <MetaCard label="推理强度" value={`${reasoningMeta.icon} ${reasoningMeta.label}`} />
        <MetaCard label="上下文窗口" value={`${template.contextWindow.toLocaleString()} tokens`} />
        <MetaCard label="超时" value={`${(template.timeoutMs / 1000).toFixed(0)}s`} />
        <MetaCard label="Worktree 隔离" value={template.worktreeIsolation ? '是' : '否'} />
        <MetaCard label="工具数" value={template.tools.length.toString()} />
      </div>

      {/* Description */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">描述</h4>
        {editing ? (
          <textarea
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            rows={2}
            data-testid="description-textarea"
          />
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">{template.description}</p>
        )}
      </div>

      {/* Tags */}
      {template.tags.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">标签</h4>
          <div className="flex flex-wrap gap-1.5">
            {template.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tools */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">工具白名单</h4>
        <div className="flex flex-wrap gap-1.5">
          {template.tools.map((tool) => (
            <span key={tool} className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
              🔧 {tool}
            </span>
          ))}
        </div>
      </div>

      {/* Constraints */}
      {template.constraints.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">约束</h4>
          <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc pl-5 space-y-0.5">
            {template.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* System Prompt */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">系统提示</h4>
        {editing ? (
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            rows={10}
            data-testid="prompt-textarea"
          />
        ) : (
          <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-x-auto whitespace-pre-wrap">
            {template.systemPrompt}
          </pre>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={handleFork}
          className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded"
          data-testid="fork-button"
        >
          🍴 派生
        </button>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white text-sm rounded"
          data-testid="export-button"
        >
          💾 导出 JSON
        </button>
        {isInstalled && !isMarket && template.scope === 'user' && (
          <button
            onClick={handleUninstall}
            className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded"
            data-testid="uninstall-button"
          >
            📤 卸载
          </button>
        )}

        <div className="flex-1" />

        {/* Rating */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-400">评分:</span>
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => handleRate(s)}
              className="text-lg hover:scale-110 transition"
              data-testid={`rate-${s}`}
            >
              {(template.rating ?? 0) >= s ? '⭐' : '☆'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

// ============ Create Form ============

function CreateForm({
  engine,
  onCreated,
  onCancel,
}: {
  engine: AgentTemplateEngine;
  onCreated: (id: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<AgentTemplateCategory>('general');
  const [role, setRole] = useState<AgentTemplate['role']>('worker');
  const [model, setModel] = useState<AgentTemplate['model']>('sonnet');
  const [reasoningEffort, setReasoningEffort] = useState<AgentTemplate['reasoningEffort']>('medium');
  const [systemPrompt, setSystemPrompt] = useState('你是一位智能助手，可以完成各种任务。');
  const [toolsText, setToolsText] = useState('Read,Write,Edit,Grep');
  const [constraintsText, setConstraintsText] = useState('遵守用户指令');
  const [tagsText, setTagsText] = useState('general');
  const [contextWindow, setContextWindow] = useState(12000);
  const [timeoutMs, setTimeoutMs] = useState(90000);
  const [worktreeIsolation, setWorktreeIsolation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    try {
      const t = engine.createUserTemplate({
        name,
        displayName: displayName || name,
        description,
        category,
        role,
        model,
        reasoningEffort,
        systemPrompt,
        tools: toolsText.split(',').map((s) => s.trim()).filter(Boolean),
        constraints: constraintsText.split('\n').map((s) => s.trim()).filter(Boolean),
        tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
        contextWindow,
        timeoutMs,
        worktreeIsolation,
        icon: '🤖',
      });
      onCreated(t.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="create-form">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">➕ 新建用户模板</h3>

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300" data-testid="error-message">
          ⚠️ {error}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">名称（kebab-case）*</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-custom-agent"
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="name-input"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">显示名</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="我的自定义智能体"
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="display-name-input"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="description-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">分类</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AgentTemplateCategory)}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(TEMPLATE_CATEGORY_METADATA).map(([key, meta]) => (
                <option key={key} value={key}>{meta.icon} {meta.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AgentTemplate['role'])}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(TEMPLATE_ROLE_METADATA).map(([key, meta]) => (
                <option key={key} value={key}>{meta.icon} {meta.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">模型</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as AgentTemplate['model'])}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(TEMPLATE_MODEL_METADATA).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label} (${meta.cost}/1k tokens)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">推理强度</label>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value as AgentTemplate['reasoningEffort'])}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(TEMPLATE_REASONING_METADATA).map(([key, meta]) => (
                <option key={key} value={key}>{meta.icon} {meta.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">系统提示</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="system-prompt-input"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">工具白名单（逗号分隔）</label>
          <input
            type="text"
            value={toolsText}
            onChange={(e) => setToolsText(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">约束（每行一条）</label>
          <textarea
            value={constraintsText}
            onChange={(e) => setConstraintsText(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">标签（逗号分隔）</label>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">上下文窗口</label>
            <input
              type="number"
              value={contextWindow}
              onChange={(e) => setContextWindow(parseInt(e.target.value, 10) || 8000)}
              min={1000}
              max={200000}
              step={1000}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">超时（ms）</label>
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10) || 30000)}
              min={5000}
              max={600000}
              step={5000}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Worktree 隔离</label>
            <div className="pt-2">
              <input
                type="checkbox"
                checked={worktreeIsolation}
                onChange={(e) => setWorktreeIsolation(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="ml-2 text-sm">{worktreeIsolation ? '启用' : '禁用'}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-sm"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            data-testid="create-submit"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Empty State ============

function EmptyState({ viewMode, onCreate }: { viewMode: ViewMode; onCreate: () => void }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-6xl mb-3">📋</div>
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
          {viewMode === 'market' ? '浏览市场中的代理模板' : '选择左侧模板查看详情'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {viewMode === 'installed' ? '从模板市场安装模板，或创建自己的模板' : '点击模板查看详情，一键安装'}
        </p>
        {viewMode !== 'market' && (
          <button
            onClick={onCreate}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
          >
            ➕ 新建模板
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Footer ============

function Footer({ count, viewMode }: { count: number; viewMode: ViewMode }): React.ReactElement {
  return (
    <div className="px-6 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
      <span>
        {viewMode === 'market' ? '🌐 市场' : viewMode === 'create' ? '➕ 新建' : '📦 已安装'} · {count} 项
      </span>
      <span>💡 提示: 模板可派生、导出、评分、跨设备同步</span>
    </div>
  );
}

export default AgentTemplatePanel;
