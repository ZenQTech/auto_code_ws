/**
 * # ============================================================
 * # HooksMarketplacePanel - Hook 模板市场 UI (v1.0.0 Cycle 21 G21-05)
 * # ============================================================
 * # 核心作用：Hook 模板市场可视化界面
 * # 主要功能：
 * #   1. 模板分类标签页
 * #   2. 模板卡片（评分/下载数/作者）
 * #   3. 一键安装/卸载
 * #   4. 模板搜索/过滤
 * #   5. 评分功能
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-05 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getHookTemplateMarketplace,
  type HookTemplate,
  type TemplateCategory,
  type InstallResult,
} from '../utils/hookTemplateMarketplace';

interface HooksMarketplacePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  quality: '代码质量',
  testing: '测试',
  git: 'Git',
  collaboration: '协作',
  custom: '自定义',
};

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  quality: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  testing: 'bg-green-500/20 text-green-300 border-green-500/30',
  git: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  collaboration: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  custom: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

export function HooksMarketplacePanel({ isOpen, onClose }: HooksMarketplacePanelProps) {
  const marketplace = useMemo(() => getHookTemplateMarketplace(), []);
  const [templates, setTemplates] = useState<HookTemplate[]>([]);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<InstallResult | null>(null);

  const refresh = useCallback(() => {
    const filter: { category?: TemplateCategory; search?: string } = {};
    if (activeCategory !== 'all') filter.category = activeCategory;
    if (searchQuery) filter.search = searchQuery;
    setTemplates(marketplace.list(filter));
    setInstalledIds(new Set(marketplace.getInstalledTemplates().map((t) => t.id)));
  }, [marketplace, activeCategory, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
  }, [isOpen, refresh]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 安装
  const handleInstall = useCallback(
    (templateId: string) => {
      const result = marketplace.installTemplate(templateId);
      setLastResult(result);
      refresh();
    },
    [marketplace, refresh]
  );

  // 卸载
  const handleUninstall = useCallback(
    (templateId: string) => {
      marketplace.uninstallTemplate(templateId);
      refresh();
    },
    [marketplace, refresh]
  );

  // 评分
  const handleRate = useCallback(
    (templateId: string, rating: number) => {
      try {
        marketplace.rateTemplate(templateId, rating);
        refresh();
      } catch (err) {
        console.error('Rate failed:', err);
      }
    },
    [marketplace, refresh]
  );

  if (!isOpen) return null;

  const stats = marketplace.getStats();
  const categories: ('all' | TemplateCategory)[] = ['all', 'quality', 'testing', 'git', 'collaboration', 'custom'];

  return (
    <div
      data-testid="hooks-marketplace-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div>
            <h2 className="text-xl font-semibold text-white">Hook 模板市场</h2>
            <p className="text-sm text-slate-400 mt-1">
              {stats.totalTemplates} 模板 · {stats.verifiedCount} 已认证 · {stats.installedCount} 已安装
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-surface-700 space-y-3">
          {/* 搜索 */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="marketplace-search"
              placeholder="搜索模板..."
              className="flex-1 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
            />
          </div>
          {/* 分类标签 */}
          <div className="flex flex-wrap gap-2" data-testid="category-tabs">
            {categories.map((cat) => {
              const label = cat === 'all' ? '全部' : CATEGORY_LABELS[cat];
              const count =
                cat === 'all'
                  ? stats.totalTemplates
                  : stats.byCategory[cat as TemplateCategory] ?? 0;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  data-testid={`category-tab-${cat}`}
                  className={`px-3 py-1 text-sm rounded border transition ${
                    activeCategory === cat
                      ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                      : 'bg-surface-800 border-surface-700 text-slate-400 hover:border-surface-600'
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Last result toast */}
        {lastResult && (
          <div
            data-testid="install-result"
            className={`mx-4 mt-2 px-3 py-2 rounded text-sm ${
              lastResult.success ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
            }`}
            onAnimationEnd={() => setLastResult(null)}
          >
            {lastResult.success ? '✓ 模板安装成功' : `✗ ${lastResult.message}`}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {templates.length === 0 ? (
            <div className="text-center text-slate-500 py-12">未找到匹配的模板</div>
          ) : (
            <div className="grid grid-cols-2 gap-3" data-testid="template-grid">
              {templates.map((t) => {
                const installed = installedIds.has(t.id);
                return (
                  <div
                    key={t.id}
                    data-testid={`template-${t.id}`}
                    className="bg-surface-800/50 rounded-lg p-4 border border-surface-700 hover:border-surface-600 transition"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white">{t.name}</h3>
                          {t.verified && <span className="text-xs text-blue-400" title="已认证">✓</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[t.category]}`}>
                            {CATEGORY_LABELS[t.category]}
                          </span>
                          <span className="text-xs text-slate-500">v{t.version}</span>
                          <span className="text-xs text-slate-500">by {t.author}</span>
                        </div>
                      </div>
                      {installed && (
                        <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-300 rounded">
                          已安装
                        </span>
                      )}
                    </div>

                    {/* 描述 */}
                    <p className="text-sm text-slate-300 mb-2">{t.description}</p>

                    {/* 标签 */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {t.tags.map((tag) => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-surface-700 text-slate-400 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>

                    {/* 元数据 */}
                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                      <span>⭐ {t.rating.toFixed(1)}</span>
                      <span>↓ {t.downloads.toLocaleString()}</span>
                      <span>·{t.installCount} 安装</span>
                    </div>

                    {/* Install notes */}
                    {t.installNotes && (
                      <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1 mb-2">
                        ℹ {t.installNotes}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((r) => (
                          <button
                            key={r}
                            onClick={() => handleRate(t.id, r)}
                            data-testid={`rate-${t.id}-${r}`}
                            className="text-lg text-slate-600 hover:text-yellow-400 transition"
                            title={`评分 ${r}`}
                          >
                            {r <= Math.round(t.rating) ? '★' : '☆'}
                          </button>
                        ))}
                      </div>
                      {installed ? (
                        <button
                          onClick={() => handleUninstall(t.id)}
                          data-testid={`uninstall-${t.id}`}
                          className="px-3 py-1 text-sm bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
                        >
                          卸载
                        </button>
                      ) : (
                        <button
                          onClick={() => handleInstall(t.id)}
                          data-testid={`install-${t.id}`}
                          className="px-3 py-1 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded"
                        >
                          安装
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HooksMarketplacePanel;
