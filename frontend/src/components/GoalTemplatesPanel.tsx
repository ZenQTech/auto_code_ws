/**
 * # ============================================================
 * # GoalTemplatesPanel - Goal 模板库 UI
 * # ============================================================
 * # 核心作用：提供 Goal Templates 模板库的可视化操作界面
 * #   1. Browse 标签：浏览/搜索模板（按类别/来源/标签/关键词）
 * #   2. Detail 标签：查看模板详情 + Fork/Instantiate 按钮
 * #   3. Create 标签：创建自定义模板
 * #   4. History 标签：实例化历史
 * # 运行流程：
 * #   1. 组件挂载时自动拉取 stats + 模板列表 + meta
 * #   2. 用户操作触发对应 API 调用，loading 状态控制防重入
 * #   3. 操作完成后调用 refreshAll 刷新全局数据
 * # 输入参数：
 * #   - onClose?: 关闭回调（可选）
 * # 输出结果：完整的 Goal Templates 操作面板
 * # 修改记录：
 * #   - 2026-07-29 | v6.33.0 | Cycle 14 P1-5 初始版本
 * # ============================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  useGoalTemplatesApi,
  GoalTemplate,
  TemplateCategory,
  TemplateSource,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  STRATEGY_LABELS,
} from '../hooks/useGoalTemplatesApi';

// ============================================================
// 类型
// ============================================================

type Tab = 'browse' | 'create' | 'history';

interface GoalTemplatesPanelProps {
  onClose?: () => void;
}

// ============================================================
// 工具函数
// ============================================================

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function classNames(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ');
}

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'browse', label: '浏览模板', icon: '🔍' },
  { key: 'create', label: '创建模板', icon: '➕' },
  { key: 'history', label: '实例化历史', icon: '📋' },
];

// ============================================================
// 子组件：Stats Bar
// ============================================================

interface StatsBarProps {
  stats: any | null;
  loading: boolean;
}

const StatsBar: React.FC<StatsBarProps> = ({ stats, loading }) => {
  if (loading) {
    return <div className="text-sm text-gray-500 px-4 py-2">加载统计中...</div>;
  }
  if (!stats) {
    return <div className="text-sm text-gray-500 px-4 py-2">暂无统计数据</div>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3 bg-gradient-to-r from-blue-50 via-violet-50 to-amber-50 border-b border-gray-200">
      <Stat label="模板总数" value={stats.total_templates} icon="📚" color="blue" />
      <Stat label="内置模板" value={stats.builtin_templates} icon="⭐" color="violet" />
      <Stat label="自定义" value={stats.custom_templates} icon="✨" color="emerald" />
      <Stat label="实例化次数" value={stats.total_instantiations} icon="🚀" color="rose" />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; icon: string; color: string }> = ({ label, value, icon, color }) => {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    violet: 'text-violet-600 bg-violet-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    rose: 'text-rose-600 bg-rose-50',
  };
  return (
    <div className={classNames('rounded-md px-3 py-2 flex items-center gap-2', colorMap[color] || 'text-gray-600 bg-gray-50')}>
      <span className="text-lg">{icon}</span>
      <div>
        <div className="text-xs text-gray-600">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：Template Card
// ============================================================

interface TemplateCardProps {
  template: GoalTemplate;
  onClick: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onClick }) => {
  const cat = CATEGORY_LABELS[template.category] || CATEGORY_LABELS.other;
  const src = SOURCE_LABELS[template.source] || SOURCE_LABELS.custom;
  const strategy = STRATEGY_LABELS[template.default_strategy] || STRATEGY_LABELS.standard;
  return (
    <div
      onClick={onClick}
      className="border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-blue-300 transition cursor-pointer bg-white"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{cat.icon}</span>
          <h3 className="font-semibold text-gray-800">{template.name}</h3>
        </div>
        <div className="flex items-center gap-1">
          <span className={classNames('text-xs px-2 py-0.5 rounded', `bg-${cat.color}-100 text-${cat.color}-700`)}>
            {cat.label}
          </span>
          <span className={classNames('text-xs px-2 py-0.5 rounded', `bg-${src.color}-100 text-${src.color}-700`)}>
            {src.label}
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-600 mb-3 line-clamp-2 min-h-[2.5rem]">
        {template.description || '（无描述）'}
      </p>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <span>📋 {template.acceptance_criteria.length} AC</span>
          <span>🤖 {template.recommended_agents.length || '-'}</span>
          <span>🎯 {strategy.label}</span>
        </div>
        <span>v{template.version} · 使用 {template.instantiations}</span>
      </div>
      {template.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {template.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 子组件：Template Detail Modal
// ============================================================

interface TemplateDetailModalProps {
  template: GoalTemplate;
  onClose: () => void;
  onFork: (name: string) => Promise<void>;
  onInstantiate: (goalId: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const TemplateDetailModal: React.FC<TemplateDetailModalProps> = ({
  template,
  onClose,
  onFork,
  onInstantiate,
  onDelete,
}) => {
  const [forkName, setForkName] = useState('');
  const [goalId, setGoalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isBuiltin = template.source === 'builtin';

  const handleFork = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onFork(forkName);
      setSuccess('Fork 成功！');
      setTimeout(() => onClose(), 1000);
    } catch (e: any) {
      setError(e?.message || 'Fork 失败');
    } finally {
      setBusy(false);
    }
  };

  const handleInstantiate = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onInstantiate(goalId);
      setSuccess('实例化成功！');
      setTimeout(() => onClose(), 1000);
    } catch (e: any) {
      setError(e?.message || '实例化失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定删除模板 "${template.name}"？`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete?.();
      setSuccess('删除成功！');
      setTimeout(() => onClose(), 1000);
    } catch (e: any) {
      setError(e?.message || '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{template.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{template.description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded text-sm">
              {success}
            </div>
          )}

          {/* Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-gray-500 text-xs">类别</div>
              <div className="font-medium">{CATEGORY_LABELS[template.category]?.label}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">来源</div>
              <div className="font-medium">{isBuiltin ? '内置' : '自定义'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">策略</div>
              <div className="font-medium">{STRATEGY_LABELS[template.default_strategy]?.label}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">预估时长</div>
              <div className="font-medium">{template.estimated_duration_min} 分钟</div>
            </div>
          </div>

          {/* 标签 */}
          {template.tags.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">标签</div>
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AC 列表 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">
              验收标准（{template.acceptance_criteria.length}）
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {template.acceptance_criteria.map((ac, i) => (
                <div key={ac.ac_id} className="border border-gray-200 rounded p-2 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">#{i + 1}</span>
                    <span className="font-medium text-sm">{ac.title}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                      P{ac.priority}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                      {ac.risk_level}
                    </span>
                  </div>
                  {ac.description && (
                    <div className="text-xs text-gray-600 mt-1">{ac.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 推荐 Agent */}
          {template.recommended_agents.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">推荐 Agent</div>
              <div className="flex flex-wrap gap-1">
                {template.recommended_agents.map((a) => (
                  <span key={a} className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded">
                    🤖 {a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 操作区 */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            {/* Fork */}
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <div className="text-sm font-medium text-blue-800 mb-2">
                {isBuiltin ? '🔱 Fork 模板（生成可编辑副本）' : '🔱 Fork（生成另一个副本）'}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={forkName}
                  onChange={(e) => setForkName(e.target.value)}
                  placeholder={isBuiltin ? `默认: ${template.name} (Copy)` : '可选新名称'}
                  className="flex-1 px-2 py-1.5 text-sm border border-blue-300 rounded"
                />
                <button
                  onClick={handleFork}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Fork
                </button>
              </div>
            </div>

            {/* Instantiate */}
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <div className="text-sm font-medium text-emerald-800 mb-2">
                🚀 实例化为 Goal
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                  placeholder="留空将自动生成 goal_id"
                  className="flex-1 px-2 py-1.5 text-sm border border-emerald-300 rounded"
                />
                <button
                  onClick={handleInstantiate}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  实例化
                </button>
              </div>
            </div>

            {/* Delete (custom only) */}
            {!isBuiltin && onDelete && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <div className="text-sm font-medium text-red-800 mb-2">🗑 危险操作</div>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  注销此模板
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：Create Form
// ============================================================

interface CreateFormProps {
  api: ReturnType<typeof useGoalTemplatesApi>;
  onCreated: () => Promise<void>;
}

const CreateForm: React.FC<CreateFormProps> = ({ api, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('development');
  const [tagsStr, setTagsStr] = useState('');
  const [strategy, setStrategy] = useState('standard');
  const [maxTurns, setMaxTurns] = useState(50);
  const [acList, setAcList] = useState([
    { title: 'AC1', description: '', priority: 5, ac_type: 'implementation', risk_level: 'medium' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const updateAC = (idx: number, field: string, value: any) => {
    setAcList((prev) =>
      prev.map((ac, i) => (i === idx ? { ...ac, [field]: value } : ac)),
    );
  };

  const addAC = () => {
    setAcList((prev) => [
      ...prev,
      { title: `AC${prev.length + 1}`, description: '', priority: 5, ac_type: 'implementation', risk_level: 'medium' },
    ]);
  };

  const removeAC = (idx: number) => {
    setAcList((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!name.trim()) {
      setError('名称不能为空');
      return;
    }
    if (acList.length === 0) {
      setError('至少需要 1 个 AC');
      return;
    }
    setBusy(true);
    try {
      const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
      await api.createTemplate({
        name: name.trim(),
        description,
        category,
        tags,
        acceptance_criteria: acList.map((ac) => ({
          ac_id: '',
          title: ac.title,
          description: ac.description,
          priority: ac.priority,
          ac_type: ac.ac_type,
          risk_level: ac.risk_level,
          verify_items: [],
        })),
        default_strategy: strategy as any,
        default_max_turns: maxTurns,
        default_triggers: ['manual'],
        recommended_agents: [],
        estimated_duration_min: 60,
      });
      setSuccess('创建成功！');
      setName('');
      setDescription('');
      setTagsStr('');
      setAcList([{ title: 'AC1', description: '', priority: 5, ac_type: 'implementation', risk_level: 'medium' }]);
      await onCreated();
    } catch (e: any) {
      setError(e?.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 py-4 max-w-3xl mx-auto space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded text-sm">
          {success}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">模板名称 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：我的功能开发模板"
          className="w-full px-3 py-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">类别</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.icon} {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">默认策略</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          >
            {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          标签（逗号分隔）
        </label>
        <input
          type="text"
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          placeholder="e.g. backend, api, urgent"
          className="w-full px-3 py-2 border border-gray-300 rounded"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          最大轮转次数
        </label>
        <input
          type="number"
          min={1}
          max={10000}
          value={maxTurns}
          onChange={(e) => setMaxTurns(Number(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded"
        />
      </div>

      {/* AC List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">验收标准 (AC) *</label>
          <button
            onClick={addAC}
            className="text-sm px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            + 添加 AC
          </button>
        </div>
        <div className="space-y-2">
          {acList.map((ac, idx) => (
            <div key={idx} className="border border-gray-200 rounded p-3 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500">#{idx + 1}</span>
                <input
                  type="text"
                  value={ac.title}
                  onChange={(e) => updateAC(idx, 'title', e.target.value)}
                  placeholder="AC 标题"
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <select
                  value={ac.priority}
                  onChange={(e) => updateAC(idx, 'priority', Number(e.target.value))}
                  className="px-2 py-1 text-sm border border-gray-300 rounded"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => (
                    <option key={p} value={p}>
                      P{p}
                    </option>
                  ))}
                </select>
                <select
                  value={ac.risk_level}
                  onChange={(e) => updateAC(idx, 'risk_level', e.target.value)}
                  className="px-2 py-1 text-sm border border-gray-300 rounded"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="critical">严重</option>
                </select>
                <button
                  onClick={() => removeAC(idx)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  ✕
                </button>
              </div>
              <textarea
                value={ac.description}
                onChange={(e) => updateAC(idx, 'description', e.target.value)}
                rows={1}
                placeholder="AC 描述（可选）"
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '创建中...' : '创建模板'}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const GoalTemplatesPanel: React.FC<GoalTemplatesPanelProps> = ({ onClose }) => {
  const api = useGoalTemplatesApi();
  const [tab, setTab] = useState<Tab>('browse');
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [filterCategory, setFilterCategory] = useState<TemplateCategory | ''>('');
  const [filterSource, setFilterSource] = useState<TemplateSource | ''>('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [selected, setSelected] = useState<GoalTemplate | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.getStats();
      setStats(r.stats);
    } catch (e: any) {
      setGlobalError(e?.message || '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  }, [api]);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setGlobalError(null);
    try {
      const params: any = {};
      if (filterCategory) params.category = filterCategory;
      if (filterSource) params.source = filterSource;
      if (filterKeyword.trim()) params.keyword = filterKeyword.trim();
      const r = await api.listTemplates(params);
      setTemplates(r.templates);
      setTotal(r.count);
    } catch (e: any) {
      setGlobalError(e?.message || '加载模板失败');
    } finally {
      setListLoading(false);
    }
  }, [api, filterCategory, filterSource, filterKeyword]);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await api.getInstantiations(undefined, 50);
      setHistory(r.history);
    } catch (e: any) {
      setGlobalError(e?.message || '加载历史失败');
    }
  }, [api]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStats(), refreshList(), refreshHistory()]);
  }, [refreshStats, refreshList, refreshHistory]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleFork = async (name: string) => {
    if (!selected) return;
    await api.forkTemplate(selected.template_id, name || undefined);
    await refreshAll();
  };

  const handleInstantiate = async (goalId: string) => {
    if (!selected) return;
    await api.instantiateTemplate(selected.template_id, goalId || undefined);
    await refreshAll();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await api.deleteTemplate(selected.template_id);
    setSelected(null);
    await refreshAll();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-violet-50">
        <div>
          <h2 className="text-xl font-bold text-gray-800">📚 Goal 模板库</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            浏览内置模板、创建自定义模板、一键实例化为 Goal
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        )}
      </div>

      <StatsBar stats={stats} loading={statsLoading} />

      {/* Tabs */}
      <div className="border-b border-gray-200 px-4 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={classNames(
              'px-4 py-2 text-sm font-medium border-b-2 transition',
              tab === t.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {globalError && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 px-4 py-2 text-sm">
          {globalError}
        </div>
      )}

      {/* Tab Content */}
      {tab === 'browse' && (
        <div>
          {/* Filter bar */}
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as TemplateCategory | '')}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
            >
              <option value="">所有类别</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.icon} {v.label}
                </option>
              ))}
            </select>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as TemplateSource | '')}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
            >
              <option value="">所有来源</option>
              <option value="builtin">⭐ 内置</option>
              <option value="custom">✨ 自定义</option>
            </select>
            <input
              type="text"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              placeholder="搜索名称/描述/标签"
              className="flex-1 min-w-[150px] px-2 py-1 text-sm border border-gray-300 rounded"
            />
            <button
              onClick={refreshList}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              🔄 刷新
            </button>
            <span className="text-xs text-gray-500">共 {total} 个</span>
          </div>

          {/* List */}
          <div className="px-6 py-4">
            {listLoading ? (
              <div className="text-center text-gray-500 py-8">加载中...</div>
            ) : templates.length === 0 ? (
              <div className="text-center text-gray-500 py-8">暂无模板</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templates.map((t) => (
                  <TemplateCard
                    key={t.template_id}
                    template={t}
                    onClick={() => setSelected(t)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'create' && <CreateForm api={api} onCreated={refreshAll} />}

      {tab === 'history' && (
        <div className="px-6 py-4">
          {history.length === 0 ? (
            <div className="text-center text-gray-500 py-8">暂无实例化历史</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">模板 ID</th>
                  <th className="py-2">Goal ID</th>
                  <th className="py-2">AC 数</th>
                  <th className="py-2">实例化时间</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs">{h.template_id}</td>
                    <td className="py-2 font-mono text-xs">{h.goal_id}</td>
                    <td className="py-2">{h.ac_count}</td>
                    <td className="py-2 text-xs text-gray-600">
                      {formatDate(h.instantiated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <TemplateDetailModal
          template={selected}
          onClose={() => setSelected(null)}
          onFork={handleFork}
          onInstantiate={handleInstantiate}
          onDelete={selected.source === 'custom' ? handleDelete : undefined}
        />
      )}
    </div>
  );
};

export default GoalTemplatesPanel;
