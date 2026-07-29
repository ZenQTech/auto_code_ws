/**
 * # ============================================================
 * MarketplacePanel - Plugin Marketplace 管理面板 (v1.0.0 - Cycle 13 P1-3)
 * # ============================================================
 * 核心作用：可视化展示 Plugin Marketplace 完整状态（浏览/搜索/安装/
 *           评分/发布/签名验证），支持三层 Plugin 目录管理
 * 运行流程：
 *   1. 挂载时拉取健康检查 + 统计 + Plugin 列表
 *   2. 用户浏览/搜索 Plugin → 详情 → 一键安装
 *   3. 评分面板：1-5 星 + 评语
 *   4. 发布面板：填写 manifest 信息 → 上架
 *   5. 签名验证面板：检查 Plugin 完整性
 * 输入参数：
 *   - onClose?: 关闭回调
 *   - standalone?: 是否独立页面模式
 * 输出结果：完整的 React 组件
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchHealth,
  fetchStats,
  getPlugin,
  getVersions,
  installPlugin,
  listCategories,
  listPlugins,
  listRatings,
  publishPlugin,
  ratePlugin,
  searchPlugins,
  verifySignature,
  getSourceColor,
  getSourceIcon,
  renderStars,
  type MarketplacePlugin,
  type MarketplaceStats,
  type PluginSource,
  type PluginVersion,
  type Rating,
} from '../hooks/useMarketplaceApi';
import { useToast } from '../hooks/useToast';

type ViewMode = 'browse' | 'detail' | 'publish';

const MarketplacePanel: React.FC<{ onClose?: () => void; standalone?: boolean }> = ({
  onClose,
}) => {
  const toast = useToast();
  const notify = {
    success: (msg: string) => toast.showToast(msg, 'success'),
    error: (msg: string) => toast.showToast(msg, 'error'),
    info: (msg: string) => toast.showToast(msg, 'info'),
  };

  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<PluginVersion[]>([]);
  const [selectedRatings, setSelectedRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤
  const [sourceFilter, setSourceFilter] = useState<PluginSource | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 评分表单
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingUser, setRatingUser] = useState('admin');

  // 签名验证
  const [verifyPluginId, setVerifyPluginId] = useState('');
  const [verifyVersion, setVerifyVersion] = useState('');
  const [verifySignatureText, setVerifySignatureText] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);

  // 发布表单
  const [pubId, setPubId] = useState('');
  const [pubName, setPubName] = useState('');
  const [pubDescription, setPubDescription] = useState('');
  const [pubAuthor, setPubAuthor] = useState('');
  const [pubLicense, setPubLicense] = useState('MIT');
  const [pubKeywords, setPubKeywords] = useState('');
  const [pubCategories, setPubCategories] = useState('');
  const [pubIcon, setPubIcon] = useState('📦');
  const [pubVersion, setPubVersion] = useState('1.0.0');
  const [pubChangelog, setPubChangelog] = useState('Initial release');
  const [pubSource, setPubSource] = useState<PluginSource>('community');

  // ============================================================
  // 数据加载
  // ============================================================
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, p, c] = await Promise.all([
        fetchHealth(),
        fetchStats(),
        listPlugins(
          sourceFilter || undefined,
          categoryFilter || undefined,
          verifiedOnly,
          50
        ),
        listCategories(),
      ]);
      setHealth(h);
      setStats(s.data);
      setPlugins(p.plugins);
      setCategories(c.categories);
    } catch (e: any) {
      setError(e.message);
      notify.error(`加载失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, categoryFilter, verifiedOnly, notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ============================================================
  // 操作
  // ============================================================
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadAll();
      return;
    }
    setLoading(true);
    try {
      const r = await searchPlugins(searchQuery, 50);
      setPlugins(r.plugins);
    } catch (e: any) {
      notify.error(`搜索失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, loadAll, notify]);

  const handleViewPlugin = useCallback(
    async (pluginId: string) => {
      try {
        const detail = await getPlugin(pluginId);
        setSelectedPlugin(detail.plugin);
        const v = await getVersions(pluginId);
        setSelectedVersions(v.versions);
        const r = await listRatings(pluginId);
        setSelectedRatings(r.ratings);
        setViewMode('detail');
      } catch (e: any) {
        notify.error(`加载失败: ${e.message}`);
      }
    },
    [notify]
  );

  const handleInstall = useCallback(
    async (pluginId: string, version?: string) => {
      try {
        const r = await installPlugin(pluginId, version);
        notify.success(`已安装 ${r.plugin_id} v${r.version} (${r.size_kb}KB)`);
      } catch (e: any) {
        notify.error(`安装失败: ${e.message}`);
      }
    },
    [notify]
  );

  const handleRate = useCallback(
    async (pluginId: string) => {
      if (ratingScore < 1 || ratingScore > 5) {
        notify.error('评分需在 1-5 之间');
        return;
      }
      try {
        await ratePlugin(pluginId, ratingScore, ratingUser, ratingComment);
        notify.success('评分成功');
        setRatingComment('');
        // 重新加载详情
        const r = await listRatings(pluginId);
        setSelectedRatings(r.ratings);
        // 重新加载列表（更新评分）
        loadAll();
      } catch (e: any) {
        notify.error(`评分失败: ${e.message}`);
      }
    },
    [ratingScore, ratingUser, ratingComment, loadAll, notify]
  );

  const handleVerify = useCallback(async () => {
    if (!verifyPluginId || !verifyVersion || !verifySignatureText) {
      notify.error('请填写完整信息');
      return;
    }
    try {
      const r = await verifySignature(verifyPluginId, verifyVersion, verifySignatureText);
      setVerifyResult(r);
      notify.success(r.valid ? '验证通过' : '验证失败');
    } catch (e: any) {
      notify.error(`验证失败: ${e.message}`);
    }
  }, [verifyPluginId, verifyVersion, verifySignatureText, notify]);

  const handlePublish = useCallback(async () => {
    if (!pubId || !pubName || !pubDescription || !pubAuthor || !pubVersion) {
      notify.error('请填写必填项');
      return;
    }
    try {
      await publishPlugin({
        id: pubId,
        name: pubName,
        description: pubDescription,
        author: pubAuthor,
        license: pubLicense,
        keywords: pubKeywords
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        categories: pubCategories
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        icon: pubIcon,
        version: pubVersion,
        changelog: pubChangelog,
        source: pubSource,
      });
      notify.success('发布成功');
      // 清空表单
      setPubId('');
      setPubName('');
      setPubDescription('');
      setPubAuthor('');
      setPubKeywords('');
      setPubCategories('');
      setViewMode('browse');
      loadAll();
    } catch (e: any) {
      notify.error(`发布失败: ${e.message}`);
    }
  }, [
    pubId,
    pubName,
    pubDescription,
    pubAuthor,
    pubLicense,
    pubKeywords,
    pubCategories,
    pubIcon,
    pubVersion,
    pubChangelog,
    pubSource,
    loadAll,
    notify,
  ]);

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 顶部工具栏 */}
      <div className="p-3 bg-white border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-gray-800 mr-2">
          🏪 Plugin Marketplace
        </h2>
        <button
          onClick={() => setViewMode('browse')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'browse'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          浏览
        </button>
        {selectedPlugin && (
          <button
            onClick={() => setViewMode('detail')}
            className={`px-3 py-1.5 text-sm rounded ${
              viewMode === 'detail'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            详情
          </button>
        )}
        <button
          onClick={() => setViewMode('publish')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'publish'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          发布
        </button>
        <div className="flex-1" />
        <button
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? '加载中…' : '🔄 刷新'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            ✕ 关闭
          </button>
        )}
      </div>

      {/* 健康状态 */}
      {health && (
        <div className="p-3 bg-blue-50 border-b border-blue-200 text-sm">
          <span className="text-blue-800">
            🟢 服务健康 · v{health.version} · Plugin {stats?.total_plugins || 0} 个 ·{' '}
            评分 {stats?.total_ratings || 0} 条
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'browse' && (
          <BrowseView
            plugins={plugins}
            categories={categories}
            sourceFilter={sourceFilter}
            setSourceFilter={setSourceFilter}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            verifiedOnly={verifiedOnly}
            setVerifiedOnly={setVerifiedOnly}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSearch={handleSearch}
            onView={handleViewPlugin}
            onInstall={handleInstall}
            verifyPluginId={verifyPluginId}
            setVerifyPluginId={setVerifyPluginId}
            verifyVersion={verifyVersion}
            setVerifyVersion={setVerifyVersion}
            verifySignatureText={verifySignatureText}
            setVerifySignatureText={setVerifySignatureText}
            verifyResult={verifyResult}
            onVerify={handleVerify}
          />
        )}

        {viewMode === 'detail' && selectedPlugin && (
          <DetailView
            plugin={selectedPlugin}
            versions={selectedVersions}
            ratings={selectedRatings}
            onInstall={handleInstall}
            onRate={handleRate}
            ratingScore={ratingScore}
            setRatingScore={setRatingScore}
            ratingComment={ratingComment}
            setRatingComment={setRatingComment}
            ratingUser={ratingUser}
            setRatingUser={setRatingUser}
            onBack={() => setViewMode('browse')}
          />
        )}

        {viewMode === 'publish' && (
          <PublishView
            pubId={pubId}
            setPubId={setPubId}
            pubName={pubName}
            setPubName={setPubName}
            pubDescription={pubDescription}
            setPubDescription={setPubDescription}
            pubAuthor={pubAuthor}
            setPubAuthor={setPubAuthor}
            pubLicense={pubLicense}
            setPubLicense={setPubLicense}
            pubKeywords={pubKeywords}
            setPubKeywords={setPubKeywords}
            pubCategories={pubCategories}
            setPubCategories={setPubCategories}
            pubIcon={pubIcon}
            setPubIcon={setPubIcon}
            pubVersion={pubVersion}
            setPubVersion={setPubVersion}
            pubChangelog={pubChangelog}
            setPubChangelog={setPubChangelog}
            pubSource={pubSource}
            setPubSource={setPubSource}
            onPublish={handlePublish}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
};

// ============================================================
// 子视图
// ============================================================

interface BrowseViewProps {
  plugins: MarketplacePlugin[];
  categories: string[];
  sourceFilter: PluginSource | '';
  setSourceFilter: (s: PluginSource | '') => void;
  categoryFilter: string;
  setCategoryFilter: (s: string) => void;
  verifiedOnly: boolean;
  setVerifiedOnly: (b: boolean) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  onSearch: () => void;
  onView: (id: string) => void;
  onInstall: (id: string, v?: string) => void;
  verifyPluginId: string;
  setVerifyPluginId: (s: string) => void;
  verifyVersion: string;
  setVerifyVersion: (s: string) => void;
  verifySignatureText: string;
  setVerifySignatureText: (s: string) => void;
  verifyResult: any;
  onVerify: () => void;
}

const BrowseView: React.FC<BrowseViewProps> = ({
  plugins,
  categories,
  sourceFilter,
  setSourceFilter,
  categoryFilter,
  setCategoryFilter,
  verifiedOnly,
  setVerifiedOnly,
  searchQuery,
  setSearchQuery,
  onSearch,
  onView,
  onInstall,
  verifyPluginId,
  setVerifyPluginId,
  verifyVersion,
  setVerifyVersion,
  verifySignatureText,
  setVerifySignatureText,
  verifyResult,
  onVerify,
}) => (
  <div className="space-y-4">
    {/* 过滤栏 */}
    <div className="bg-white rounded border border-gray-200 p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder="搜索 Plugin..."
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded"
        />
        <button
          onClick={onSearch}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          🔍 搜索
        </button>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as PluginSource | '')}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded"
        >
          <option value="">全部来源</option>
          <option value="official">官方</option>
          <option value="community">社区</option>
          <option value="local">本地</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded"
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          已认证
        </label>
      </div>
    </div>

    {/* 签名验证 */}
    <div className="bg-white rounded border border-gray-200 p-3">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">🔐 签名验证</h3>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs text-gray-600 mb-1">Plugin ID</label>
          <input
            type="text"
            value={verifyPluginId}
            onChange={(e) => setVerifyPluginId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            placeholder="hermes.code-formatter"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs text-gray-600 mb-1">版本</label>
          <input
            type="text"
            value={verifyVersion}
            onChange={(e) => setVerifyVersion(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            placeholder="1.0.0"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-600 mb-1">签名</label>
          <input
            type="text"
            value={verifySignatureText}
            onChange={(e) => setVerifySignatureText(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            placeholder="sha256:..."
          />
        </div>
        <button
          onClick={onVerify}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          验证
        </button>
      </div>
      {verifyResult && (
        <div
          className={`mt-2 p-2 rounded text-sm ${
            verifyResult.valid
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {verifyResult.valid ? '✅' : '❌'} {verifyResult.message}
        </div>
      )}
    </div>

    {/* Plugin 列表 */}
    {plugins.length === 0 ? (
      <div className="bg-white rounded border border-gray-200 p-8 text-center text-sm text-gray-500">
        暂无 Plugin
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {plugins.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded border border-gray-200 p-3 hover:border-blue-300 transition cursor-pointer"
            onClick={() => onView(p.id)}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-2xl">{p.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {p.name}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{p.id}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {p.verified && (
                  <span className="text-xs text-blue-600">✓ 认证</span>
                )}
                <span
                  className={`px-2 py-0.5 text-xs rounded border ${getSourceColor(
                    p.source
                  )}`}
                >
                  {getSourceIcon(p.source)} {p.source}
                </span>
              </div>
            </div>

            <div className="text-xs text-gray-600 line-clamp-2 mb-2">
              {p.description}
            </div>

            <div className="flex flex-wrap gap-1 mb-2">
              {p.categories.slice(0, 3).map((c) => (
                <span
                  key={c}
                  className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                >
                  {c}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                ⭐ {p.avg_rating.toFixed(1)} ({p.rating_count}) · 📥 {p.total_downloads}
              </span>
              <span className="font-mono">v{p.latest_version}</span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onInstall(p.id);
              }}
              className="w-full mt-2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              📥 一键安装
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface DetailViewProps {
  plugin: MarketplacePlugin;
  versions: PluginVersion[];
  ratings: Rating[];
  onInstall: (id: string, v?: string) => void;
  onRate: (id: string) => void;
  ratingScore: number;
  setRatingScore: (n: number) => void;
  ratingComment: string;
  setRatingComment: (s: string) => void;
  ratingUser: string;
  setRatingUser: (s: string) => void;
  onBack: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({
  plugin,
  versions,
  ratings,
  onInstall,
  onRate,
  ratingScore,
  setRatingScore,
  ratingComment,
  setRatingComment,
  ratingUser,
  setRatingUser,
  onBack,
}) => (
  <div className="space-y-4">
    <button
      onClick={onBack}
      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
    >
      ← 返回列表
    </button>

    <div className="bg-white rounded border border-gray-200 p-4">
      <div className="flex items-start gap-4 mb-3">
        <span className="text-5xl">{plugin.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-gray-800">{plugin.name}</h2>
            {plugin.verified && (
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                ✓ 认证
              </span>
            )}
            <span
              className={`px-2 py-0.5 text-xs rounded border ${getSourceColor(
                plugin.source
              )}`}
            >
              {getSourceIcon(plugin.source)} {plugin.source}
            </span>
          </div>
          <div className="text-sm text-gray-600">{plugin.id}</div>
          <div className="text-sm text-gray-700 mt-2">{plugin.description}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">作者</div>
          <div className="font-medium">{plugin.author}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">许可证</div>
          <div className="font-medium">{plugin.license}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">下载量</div>
          <div className="font-medium">{plugin.total_downloads.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">最新版本</div>
          <div className="font-medium">v{plugin.latest_version}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-yellow-500 text-lg">
          {renderStars(plugin.avg_rating)}
        </span>
        <span className="text-sm text-gray-600">
          {plugin.avg_rating.toFixed(1)} ({plugin.rating_count} 评分)
        </span>
      </div>

      {plugin.keywords.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">关键词</div>
          <div className="flex flex-wrap gap-1">
            {plugin.keywords.map((k, i) => (
              <span
                key={i}
                className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {plugin.categories.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">分类</div>
          <div className="flex flex-wrap gap-1">
            {plugin.categories.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {plugin.repository && (
        <div className="mt-3 text-xs">
          <span className="text-gray-500">仓库：</span>
          <a
            href={plugin.repository}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {plugin.repository}
          </a>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onInstall(plugin.id)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          📥 安装 v{plugin.latest_version}
        </button>
      </div>
    </div>

    {/* 版本列表 */}
    {versions.length > 0 && (
      <div className="bg-white rounded border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">📦 版本历史</h3>
        <div className="space-y-2">
          {versions.map((v) => (
            <div
              key={v.version}
              className="p-2 bg-gray-50 rounded flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-medium">v{v.version}</div>
                <div className="text-xs text-gray-500">
                  {v.released_at.substring(0, 10)} · {v.size_kb}KB · 📥 {v.downloads}
                </div>
                {v.changelog && (
                  <div className="text-xs text-gray-600 mt-1">{v.changelog}</div>
                )}
              </div>
              {v.version !== plugin.latest_version && (
                <button
                  onClick={() => onInstall(plugin.id, v.version)}
                  className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  安装
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    {/* 评分 */}
    <div className="bg-white rounded border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">⭐ 评分</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">用户</label>
          <input
            type="text"
            value={ratingUser}
            onChange={(e) => setRatingUser(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">分数 (1-5)</label>
          <input
            type="number"
            min="1"
            max="5"
            value={ratingScore}
            onChange={(e) => setRatingScore(parseInt(e.target.value) || 5)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">评语</label>
          <input
            type="text"
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
      </div>
      <button
        onClick={() => onRate(plugin.id)}
        className="px-4 py-1.5 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600"
      >
        提交评分
      </button>

      {ratings.length > 0 && (
        <div className="mt-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-600">最近评分</h4>
          {ratings.slice(0, 5).map((r) => (
            <div key={r.rating_id} className="p-2 bg-gray-50 rounded text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.user}</span>
                <span className="text-yellow-500">
                  {renderStars(r.score)}
                </span>
              </div>
              {r.comment && <div className="text-gray-600 mt-1">{r.comment}</div>}
              <div className="text-gray-400 mt-1">
                {r.created_at.substring(0, 19)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

interface PublishViewProps {
  pubId: string;
  setPubId: (s: string) => void;
  pubName: string;
  setPubName: (s: string) => void;
  pubDescription: string;
  setPubDescription: (s: string) => void;
  pubAuthor: string;
  setPubAuthor: (s: string) => void;
  pubLicense: string;
  setPubLicense: (s: string) => void;
  pubKeywords: string;
  setPubKeywords: (s: string) => void;
  pubCategories: string;
  setPubCategories: (s: string) => void;
  pubIcon: string;
  setPubIcon: (s: string) => void;
  pubVersion: string;
  setPubVersion: (s: string) => void;
  pubChangelog: string;
  setPubChangelog: (s: string) => void;
  pubSource: PluginSource;
  setPubSource: (s: PluginSource) => void;
  onPublish: () => void;
  loading: boolean;
}

const PublishView: React.FC<PublishViewProps> = (p) => (
  <div className="max-w-2xl mx-auto bg-white rounded border border-gray-200 p-4 space-y-3">
    <h3 className="text-sm font-semibold text-gray-700">📤 发布新 Plugin</h3>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">Plugin ID *</label>
        <input
          type="text"
          value={p.pubId}
          onChange={(e) => p.setPubId(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          placeholder="my.plugin.id"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">名称 *</label>
        <input
          type="text"
          value={p.pubName}
          onChange={(e) => p.setPubName(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          placeholder="My Plugin"
        />
      </div>
    </div>

    <div>
      <label className="block text-xs text-gray-600 mb-1">描述 *</label>
      <textarea
        value={p.pubDescription}
        onChange={(e) => p.setPubDescription(e.target.value)}
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        placeholder="A brief description..."
      />
    </div>

    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">作者 *</label>
        <input
          type="text"
          value={p.pubAuthor}
          onChange={(e) => p.setPubAuthor(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">许可证</label>
        <input
          type="text"
          value={p.pubLicense}
          onChange={(e) => p.setPubLicense(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">来源</label>
        <select
          value={p.pubSource}
          onChange={(e) => p.setPubSource(e.target.value as PluginSource)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        >
          <option value="community">community</option>
          <option value="official">official</option>
          <option value="local">local</option>
        </select>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">关键词（逗号）</label>
        <input
          type="text"
          value={p.pubKeywords}
          onChange={(e) => p.setPubKeywords(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">分类（逗号）</label>
        <input
          type="text"
          value={p.pubCategories}
          onChange={(e) => p.setPubCategories(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">图标 (emoji)</label>
        <input
          type="text"
          value={p.pubIcon}
          onChange={(e) => p.setPubIcon(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">版本 *</label>
        <input
          type="text"
          value={p.pubVersion}
          onChange={(e) => p.setPubVersion(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
    </div>

    <div>
      <label className="block text-xs text-gray-600 mb-1">更新日志</label>
      <textarea
        value={p.pubChangelog}
        onChange={(e) => p.setPubChangelog(e.target.value)}
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
      />
    </div>

    <button
      onClick={p.onPublish}
      disabled={p.loading}
      className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
    >
      {p.loading ? '发布中…' : '🚀 发布'}
    </button>
  </div>
);

export default MarketplacePanel;
