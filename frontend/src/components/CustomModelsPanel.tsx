/**
 * # ============================================================
 * CustomModelsPanel - 自定义模型管理面板
 * # ============================================================
 * 核心作用：可视化管理 OpenAI-compatible 模型提供商
 * 功能：
 *   - 列出所有 providers (类型徽章 + 状态指示器)
 *   - 创建表单（name/type/base_url/api_key）
 *   - Token 过期时间 + 倒计时
 *   - 测试连接 + 手动刷新 token
 *   - 启用/禁用 + 删除
 *   - 添加/删除模型条目
 *   - 全局统计卡片（总数/已启用/即将过期）
 * 运行流程：
 *   1. 组件挂载时拉取 providers / status / summary
 *   2. 用户点击"+ Add Provider"展开创建表单
 *   3. 提交 → POST /api/custom-models/providers
 *   4. 自动刷新列表
 * 输入参数：onClose 回调
 * 输出结果：完整 Custom Models 管理面板 DOM
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 8 P0-14 新建
 * ============================================================
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  useProviders,
  useSummary,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useTestProvider,
  useRefreshProvider,
  useAddModel,
  type ProviderType,
  type ModelProvider,
} from '../hooks/useCustomModelsApi';

// ============================================================
// 类型定义
// ============================================================

export interface CustomModelsPanelProps {
  onClose: () => void;
}

interface NewProviderForm {
  name: string;
  type: ProviderType;
  base_url: string;
  api_key: string;
  refresh_token: string;
  expires_at: string;
}

const EMPTY_FORM: NewProviderForm = {
  name: '',
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  refresh_token: '',
  expires_at: '',
};

const PROVIDER_TYPE_META: Record<ProviderType, { label: string; color: string; icon: string }> = {
  openai: { label: 'OpenAI', color: 'emerald', icon: '🟢' },
  anthropic: { label: 'Anthropic', color: 'orange', icon: '🟠' },
  azure: { label: 'Azure', color: 'sky', icon: '🔵' },
  custom: { label: 'Custom', color: 'violet', icon: '🟣' },
};

// ============================================================
// 工具函数
// ============================================================

function formatExpiresAt(expiresAt: number | null): string {
  if (!expiresAt) return '— 永不过期 —';
  const date = new Date(expiresAt * 1000);
  const now = Date.now() / 1000;
  const diff = expiresAt - now;
  if (diff <= 0) return '已过期';
  if (diff < 60) return `${Math.floor(diff)}s 后过期`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 后过期`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 后过期`;
  return `${date.toLocaleDateString('zh-CN')} 过期`;
}

function getProviderStatus(provider: ModelProvider): { label: string; color: string } {
  if (!provider.enabled) return { label: '已禁用', color: 'gray' };
  if (provider.expires_at === null) return { label: '活跃', color: 'emerald' };
  const now = Date.now() / 1000;
  if (provider.expires_at <= now) return { label: '已过期', color: 'red' };
  if (provider.expires_at - now < 300) return { label: '即将过期', color: 'amber' };
  return { label: '活跃', color: 'emerald' };
}

// ============================================================
// 子组件
// ============================================================

/** Provider 卡片 */
function ProviderCard({
  provider,
  onTest,
  onRefresh,
  onToggle,
  onDelete,
  testing,
  refreshing,
}: {
  provider: ModelProvider;
  onTest: (id: string) => void;
  onRefresh: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  testing: boolean;
  refreshing: boolean;
}) {
  const meta = PROVIDER_TYPE_META[provider.type] || PROVIDER_TYPE_META.custom;
  const status = getProviderStatus(provider);
  const statusColor: Record<string, string> = {
    gray: 'bg-surface-500/20 text-surface-400',
    emerald: 'bg-emerald-500/20 text-emerald-300',
    amber: 'bg-amber-500/20 text-amber-300',
    red: 'bg-red-500/20 text-red-300',
  };
  const metaColor: Record<string, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300',
    orange: 'bg-orange-500/15 text-orange-300',
    sky: 'bg-sky-500/15 text-sky-300',
    violet: 'bg-violet-500/15 text-violet-300',
  };

  return (
    <div className="rounded-xl bg-surface-100/60 border border-surface-300/40 p-4 space-y-3">
      {/* 头部：类型徽章 + 名称 + 状态 */}
      <div className="flex items-center gap-3">
        <span className={`text-[10px] px-2 py-1 rounded-md font-medium ${metaColor[meta.color] || ''}`}>
          {meta.icon} {meta.label}
        </span>
        <span className="text-sm font-medium text-surface-50 flex-1 truncate">{provider.name}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-md ${statusColor[status.color] || ''}`}>
          ● {status.label}
        </span>
      </div>

      {/* 详细信息 */}
      <div className="text-xs text-surface-400 space-y-1">
        <div className="flex gap-2">
          <span className="text-surface-500">Base URL:</span>
          <code className="text-surface-300 truncate">{provider.base_url}</code>
        </div>
        <div className="flex gap-2">
          <span className="text-surface-500">API Key:</span>
          <code className="text-surface-300">{provider.api_key_masked || '—'}</code>
        </div>
        <div className="flex gap-2">
          <span className="text-surface-500">过期:</span>
          <span className="text-surface-300">{formatExpiresAt(provider.expires_at)}</span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-300/30">
        <button
          onClick={() => onTest(provider.id)}
          disabled={testing}
          className="text-[11px] px-2.5 py-1 rounded-md bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 disabled:opacity-50 transition-colors"
        >
          {testing ? '测试中…' : '🔌 测试连接'}
        </button>
        <button
          onClick={() => onRefresh(provider.id)}
          disabled={refreshing}
          className="text-[11px] px-2.5 py-1 rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 transition-colors"
        >
          {refreshing ? '刷新中…' : '🔄 刷新 Token'}
        </button>
        <button
          onClick={() => onToggle(provider.id, !provider.enabled)}
          className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
            provider.enabled
              ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
          }`}
        >
          {provider.enabled ? '⏸ 禁用' : '▶ 启用'}
        </button>
        <button
          onClick={() => {
            if (confirm(`确定删除 provider "${provider.name}"？`)) onDelete(provider.id);
          }}
          className="text-[11px] px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors ml-auto"
        >
          🗑 删除
        </button>
      </div>
    </div>
  );
}

/** 创建 Provider 表单 */
function CreateProviderForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (form: NewProviderForm) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<NewProviderForm>(EMPTY_FORM);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.base_url.trim()) {
      alert('名称和 Base URL 必填');
      return;
    }
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface-100/60 border border-surface-300/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-surface-50">+ 新增 Provider</h4>
        <button type="button" onClick={onCancel} className="text-xs text-surface-500 hover:text-surface-300">
          ✕ 取消
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-surface-500 block mb-1">名称 *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="DeepSeek Official"
            className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 placeholder:text-surface-500 focus:border-sky-400/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] text-surface-500 block mb-1">类型</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ProviderType })}
            className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 focus:border-sky-400/60 focus:outline-none"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="azure">Azure</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-[11px] text-surface-500 block mb-1">Base URL *</label>
        <input
          type="text"
          value={form.base_url}
          onChange={(e) => setForm({ ...form, base_url: e.target.value })}
          placeholder="https://api.deepseek.com/v1"
          className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 placeholder:text-surface-500 focus:border-sky-400/60 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-[11px] text-surface-500 block mb-1">API Key (加密存储)</label>
        <input
          type="password"
          value={form.api_key}
          onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          placeholder="sk-..."
          className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 placeholder:text-surface-500 focus:border-sky-400/60 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-surface-500 block mb-1">Refresh Token (可选)</label>
          <input
            type="password"
            value={form.refresh_token}
            onChange={(e) => setForm({ ...form, refresh_token: e.target.value })}
            className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 placeholder:text-surface-500 focus:border-sky-400/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] text-surface-500 block mb-1">过期时间 (unix ts)</label>
          <input
            type="number"
            value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
            placeholder="(空=永不过期)"
            className="w-full text-sm px-2.5 py-1.5 rounded-md bg-surface-200/60 border border-surface-300/40 text-surface-50 placeholder:text-surface-500 focus:border-sky-400/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md bg-surface-200/60 text-surface-300 hover:bg-surface-200/80"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {loading ? '创建中…' : '✓ 创建'}
        </button>
      </div>
    </form>
  );
}

/** 添加模型条目表单 */
function AddModelForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (modelId: string, displayName: string, context: number) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  const [modelId, setModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [context, setContext] = useState('32768');

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!modelId.trim() || !displayName.trim()) return;
        await onSubmit(modelId, displayName, parseInt(context, 10) || 32768);
      }}
      className="rounded-md bg-surface-200/40 p-2.5 space-y-2"
    >
      <div className="text-[11px] text-surface-500">为 provider 添加模型条目</div>
      <div className="grid grid-cols-3 gap-2">
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="model_id"
          className="text-xs px-2 py-1 rounded bg-surface-200/80 border border-surface-300/40 text-surface-50 placeholder:text-surface-500"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display Name"
          className="text-xs px-2 py-1 rounded bg-surface-200/80 border border-surface-300/40 text-surface-50 placeholder:text-surface-500"
        />
        <input
          type="number"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Context"
          className="text-xs px-2 py-1 rounded bg-surface-200/80 border border-surface-300/40 text-surface-50 placeholder:text-surface-500"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-[11px] px-2 py-1 rounded bg-surface-300/40 text-surface-300">
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="text-[11px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 disabled:opacity-50"
        >
          {loading ? '添加中…' : '✓ 添加'}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// 主组件
// ============================================================

export default function CustomModelsPanel({ onClose }: CustomModelsPanelProps) {
  const { providers, loading: providersLoading, refetch: refetchProviders } = useProviders();
  const { summary, refetch: refetchSummary } = useSummary();
  const { createProvider, loading: creating } = useCreateProvider();
  const { updateProvider } = useUpdateProvider();
  const { deleteProvider } = useDeleteProvider();
  const { testProvider, loading: testing } = useTestProvider();
  const { refreshProvider, loading: refreshing } = useRefreshProvider();
  const { addModel, loading: addingModel } = useAddModel();

  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [addModelForProvider, setAddModelForProvider] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, Array<{ id: string; model_id: string; display_name: string; context_window: number }>>>({});

  // 自动隐藏反馈
  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  // 创建 provider
  const handleCreate = useCallback(
    async (form: NewProviderForm) => {
      const provider = await createProvider({
        name: form.name,
        type: form.type,
        base_url: form.base_url,
        api_key: form.api_key,
        refresh_token: form.refresh_token,
        expires_at: form.expires_at ? parseFloat(form.expires_at) : undefined,
      });
      if (provider) {
        setFeedback({ type: 'success', message: `✓ 已创建 provider: ${provider.name}` });
        setShowForm(false);
        await refetchProviders();
        await refetchSummary();
        return true;
      } else {
        setFeedback({ type: 'error', message: '创建失败' });
        return false;
      }
    },
    [createProvider, refetchProviders, refetchSummary]
  );

  // 测试 provider
  const handleTest = useCallback(
    async (id: string) => {
      const result = await testProvider(id);
      if (result) {
        setFeedback({
          type: 'success',
          message: `✓ ${result.provider_name}: ${result.latency_ms.toFixed(0)}ms, ${result.models_available} 模型可用`,
        });
      } else {
        setFeedback({ type: 'error', message: '测试失败' });
      }
    },
    [testProvider]
  );

  // 刷新 token
  const handleRefresh = useCallback(
    async (id: string) => {
      const result = await refreshProvider(id);
      if (result && result.success) {
        setFeedback({
          type: 'success',
          message: `✓ Token 已刷新 (新过期: ${formatExpiresAt(result.new_expires_at)})`,
        });
        await refetchProviders();
        await refetchSummary();
      } else {
        setFeedback({ type: 'error', message: `刷新失败: ${result?.error || '未知错误'}` });
      }
    },
    [refreshProvider, refetchProviders, refetchSummary]
  );

  // 切换 enabled
  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      const result = await updateProvider(id, { enabled });
      if (result) {
        setFeedback({ type: 'success', message: `✓ Provider 已${enabled ? '启用' : '禁用'}` });
        await refetchProviders();
        await refetchSummary();
      } else {
        setFeedback({ type: 'error', message: '更新失败' });
      }
    },
    [updateProvider, refetchProviders, refetchSummary]
  );

  // 删除 provider
  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await deleteProvider(id);
      if (ok) {
        setFeedback({ type: 'success', message: '✓ Provider 已删除' });
        await refetchProviders();
        await refetchSummary();
      } else {
        setFeedback({ type: 'error', message: '删除失败' });
      }
    },
    [deleteProvider, refetchProviders, refetchSummary]
  );

  // 加载 provider 下的模型
  const loadProviderModels = useCallback(async (providerId: string) => {
    try {
      const res = await fetch(`/api/custom-models/models/provider/${providerId}`);
      const data = await res.json();
      if (data.success) {
        setProviderModels((prev) => ({ ...prev, [providerId]: data.models }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 切换显示模型列表
  const toggleModelsList = useCallback(
    (providerId: string) => {
      if (providerModels[providerId]) {
        setProviderModels((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
      } else {
        loadProviderModels(providerId);
      }
    },
    [providerModels, loadProviderModels]
  );

  // 添加模型
  const handleAddModel = useCallback(
    async (providerId: string, modelId: string, displayName: string, contextWindow: number) => {
      const result = await addModel({
        provider_id: providerId,
        model_id: modelId,
        display_name: displayName,
        context_window: contextWindow,
      });
      if (result) {
        setFeedback({ type: 'success', message: `✓ 已添加模型: ${displayName}` });
        await loadProviderModels(providerId);
        return true;
      }
      setFeedback({ type: 'error', message: '添加模型失败' });
      return false;
    },
    [addModel, loadProviderModels]
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-50/95 rounded-2xl border border-surface-300/40 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-300/40">
          <div className="flex items-center gap-3">
            <span className="text-lg">🧠</span>
            <h2 className="text-base font-semibold text-surface-50">Custom Models 管理</h2>
            <span className="text-[10px] text-surface-500 px-2 py-0.5 rounded bg-surface-200/60">v1.0.0</span>
          </div>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-200 text-lg px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 摘要卡片 */}
        {summary && (
          <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-surface-300/40">
            <div className="rounded-lg bg-surface-100/60 p-3">
              <div className="text-[10px] text-surface-500">Providers</div>
              <div className="text-xl font-semibold text-surface-50">{summary.total_providers}</div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                内置 {summary.builtin_models}
              </div>
            </div>
            <div className="rounded-lg bg-surface-100/60 p-3">
              <div className="text-[10px] text-surface-500">Models</div>
              <div className="text-xl font-semibold text-emerald-300">{summary.total_models}</div>
              <div className="text-[10px] text-surface-500 mt-0.5">自定义条目</div>
            </div>
            <div className="rounded-lg bg-surface-100/60 p-3">
              <div className="text-[10px] text-surface-500">即将过期</div>
              <div className={`text-xl font-semibold ${summary.refresh_status.expiring_soon > 0 ? 'text-amber-300' : 'text-surface-400'}`}>
                {summary.refresh_status.expiring_soon}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                已过期 {summary.refresh_status.expired}
              </div>
            </div>
            <div className="rounded-lg bg-surface-100/60 p-3">
              <div className="text-[10px] text-surface-500">后台任务</div>
              <div className={`text-xl font-semibold ${summary.refresh_status.background_running ? 'text-emerald-300' : 'text-surface-400'}`}>
                {summary.refresh_status.background_running ? '● 运行中' : '○ 停止'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">60s 检查</div>
            </div>
          </div>
        )}

        {/* 反馈条 */}
        {feedback && (
          <div
            className={`mx-5 mt-3 rounded-md px-3 py-2 text-xs ${
              feedback.type === 'success'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'bg-red-500/15 text-red-300 border border-red-500/30'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* 主内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 创建表单 */}
          {showForm && (
            <CreateProviderForm
              onSubmit={async (form) => { await handleCreate(form); }}
              onCancel={() => setShowForm(false)}
              loading={creating}
            />
          )}

          {/* 顶部操作栏 */}
          {!showForm && (
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-surface-300">
                Providers ({providers.length})
              </h3>
              <button
                onClick={() => setShowForm(true)}
                className="text-xs px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
              >
                + Add Provider
              </button>
            </div>
          )}

          {/* Provider 列表 */}
          {providersLoading ? (
            <div className="text-center text-surface-500 text-sm py-8">加载中…</div>
          ) : providers.length === 0 ? (
            <div className="text-center text-surface-500 text-sm py-12 border-2 border-dashed border-surface-300/30 rounded-xl">
              暂无自定义 Provider
              <div className="text-[11px] mt-1 text-surface-600">点击右上角 + Add Provider 创建</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {providers.map((p) => (
                <div key={p.id} className="space-y-2">
                  <ProviderCard
                    provider={p}
                    onTest={handleTest}
                    onRefresh={handleRefresh}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    testing={testing}
                    refreshing={refreshing}
                  />
                  {/* 模型条目展开/收起 */}
                  <div className="flex gap-2 px-1">
                    <button
                      onClick={() => toggleModelsList(p.id)}
                      className="text-[11px] text-sky-300 hover:text-sky-200"
                    >
                      {providerModels[p.id] ? '▼ 收起模型' : '▶ 查看模型条目'}
                    </button>
                    <button
                      onClick={() => setAddModelForProvider(addModelForProvider === p.id ? null : p.id)}
                      className="text-[11px] text-emerald-300 hover:text-emerald-200"
                    >
                      + 添加模型
                    </button>
                  </div>
                  {/* 添加模型表单 */}
                  {addModelForProvider === p.id && (
                    <AddModelForm
                      onSubmit={async (mid, dn, ctx) => { await handleAddModel(p.id, mid, dn, ctx); }}
                      onCancel={() => setAddModelForProvider(null)}
                      loading={addingModel}
                    />
                  )}
                  {/* 模型列表 */}
                  {providerModels[p.id] && (
                    <div className="rounded-lg bg-surface-200/40 p-2.5 space-y-1.5">
                      {providerModels[p.id].length === 0 ? (
                        <div className="text-[11px] text-surface-500 py-2 text-center">
                          该 provider 下尚无模型条目
                        </div>
                      ) : (
                        providerModels[p.id].map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between text-[11px] text-surface-300 py-1 px-2 rounded bg-surface-100/40"
                          >
                            <span>
                              <code className="text-sky-300">{m.model_id}</code>
                              <span className="text-surface-500 ml-1.5">· {m.display_name}</span>
                            </span>
                            <span className="text-surface-500">{m.context_window} ctx</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-300/40 text-[10px] text-surface-500 flex items-center justify-between">
          <span>API Key 使用 Fernet 对称加密存储 · 密钥位于 ~/.hermes/.encryption_key</span>
          <span>Bearer Token 后台每 60s 检查 · 提前 5 分钟自动刷新</span>
        </div>
      </div>
    </div>
  );
}
