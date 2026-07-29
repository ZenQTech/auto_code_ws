/**
 * # ============================================================
 * useMarketplaceApi - Plugin Marketplace API 客户端
 * # ============================================================
 * 核心作用：封装 /api/marketplace 端点调用
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0 (Cycle 13 P1-3)
 * 修改记录：
 *   - 2026-07-28 | v1.0.0 | 新建
 * ============================================================
 */

const API_BASE = '/api';
const MARKETPLACE_BASE = `${API_BASE}/marketplace`;

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${MARKETPLACE_BASE}${path}`;
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ============================================================
// 类型定义
// ============================================================
export type PluginSource = 'official' | 'community' | 'local';

export interface PluginVersion {
  version: string;
  released_at: string;
  changelog: string;
  size_kb: number;
  downloads: number;
  dependencies: Record<string, string>;
  signature: string;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  license: string;
  keywords: string[];
  categories: string[];
  icon: string;
  verified: boolean;
  source: PluginSource;
  versions: PluginVersion[];
  latest_version: string;
  total_downloads: number;
  avg_rating: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  repository: string;
}

export interface Rating {
  rating_id: string;
  plugin_id: string;
  user: string;
  score: number;
  comment: string;
  created_at: string;
}

export interface RatingStats {
  total_ratings: number;
  avg_score: number;
  by_score: Record<number, number>;
}

export interface MarketplaceStats {
  total_plugins: number;
  by_source: Record<string, number>;
  verified: number;
  total_downloads: number;
  categories: string[];
  total_ratings: number;
}

export interface MarketplaceHealth {
  success: boolean;
  service: string;
  version: string;
  stats: MarketplaceStats;
  features: string[];
}

// ============================================================
// API 函数
// ============================================================

/** 健康检查 */
export async function fetchHealth(): Promise<MarketplaceHealth> {
  return apiFetch('/health');
}

/** 列出 Plugin */
export async function listPlugins(
  source?: PluginSource,
  category?: string,
  verifiedOnly: boolean = false,
  limit: number = 50
): Promise<{
  success: boolean;
  total: number;
  filters: any;
  plugins: MarketplacePlugin[];
}> {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (category) params.set('category', category);
  params.set('verified_only', String(verifiedOnly));
  params.set('limit', String(limit));
  return apiFetch(`/list?${params.toString()}`);
}

/** 搜索 Plugin */
export async function searchPlugins(
  query: string,
  limit: number = 20
): Promise<{ success: boolean; query: string; count: number; plugins: MarketplacePlugin[] }> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('limit', String(limit));
  return apiFetch(`/search?${params.toString()}`);
}

/** 获取 Plugin 详情 */
export async function getPlugin(
  pluginId: string
): Promise<{ success: boolean; plugin: MarketplacePlugin }> {
  return apiFetch(`/plugins/${pluginId}`);
}

/** 获取版本列表 */
export async function getVersions(
  pluginId: string
): Promise<{ success: boolean; count: number; versions: PluginVersion[] }> {
  return apiFetch(`/plugins/${pluginId}/versions`);
}

/** 安装 Plugin */
export async function installPlugin(
  pluginId: string,
  version?: string
): Promise<{ success: boolean; plugin_id: string; version: string; size_kb: number }> {
  return apiFetch(`/install`, {
    method: 'POST',
    body: JSON.stringify({ plugin_id: pluginId, version }),
  });
}

/** 评分 */
export async function ratePlugin(
  pluginId: string,
  score: number,
  user: string = 'anonymous',
  comment: string = ''
): Promise<{ success: boolean; avg_rating: number; rating_count: number }> {
  return apiFetch(`/plugins/${pluginId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ score, user, comment }),
  });
}

/** 评分列表 */
export async function listRatings(
  pluginId: string
): Promise<{ success: boolean; count: number; ratings: Rating[] }> {
  return apiFetch(`/plugins/${pluginId}/ratings`);
}

/** 评分统计 */
export async function getRatingStats(
  pluginId: string
): Promise<{ success: boolean; stats: RatingStats }> {
  return apiFetch(`/plugins/${pluginId}/ratings/stats`);
}

/** 发布 Plugin */
export async function publishPlugin(payload: {
  id: string;
  name: string;
  description: string;
  author: string;
  license?: string;
  keywords?: string[];
  categories?: string[];
  icon?: string;
  verified?: boolean;
  source?: PluginSource;
  repository?: string;
  version: string;
  changelog?: string;
  size_kb?: number;
  dependencies?: Record<string, string>;
}): Promise<{ success: boolean; plugin: MarketplacePlugin }> {
  return apiFetch('/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 验证签名 */
export async function verifySignature(
  pluginId: string,
  version: string,
  signature: string
): Promise<{ success: boolean; valid: boolean; message: string }> {
  return apiFetch('/verify', {
    method: 'POST',
    body: JSON.stringify({ plugin_id: pluginId, version, signature }),
  });
}

/** 统计 */
export async function fetchStats(): Promise<{ success: boolean; data: MarketplaceStats }> {
  return apiFetch('/stats');
}

/** 分类列表 */
export async function listCategories(): Promise<{ success: boolean; count: number; categories: string[] }> {
  return apiFetch('/categories');
}

// ============================================================
// 辅助函数
// ============================================================

/** 来源颜色 */
export function getSourceColor(source: string): string {
  switch (source) {
    case 'official':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'community':
      return 'text-purple-600 bg-purple-50 border-purple-200';
    case 'local':
      return 'text-gray-600 bg-gray-50 border-gray-200';
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

/** 来源图标 */
export function getSourceIcon(source: string): string {
  switch (source) {
    case 'official':
      return '🏛️';
    case 'community':
      return '👥';
    case 'local':
      return '📁';
    default:
      return '📦';
  }
}

/** 星级渲染 */
export function renderStars(score: number, max: number = 5): string {
  const full = Math.floor(score);
  const half = score - full >= 0.5;
  const empty = max - full - (half ? 1 : 0);
  return '★'.repeat(full) + (half ? '☆' : '') + '☆'.repeat(empty);
}
