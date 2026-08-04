/**
 * # ============================================================
 * # useMultiContext Hook (v1.0.0)
 * # Cycle 62 G62-02
 * # ====================================
 * # 核心作用：封装多源上下文选择器 API 调用
 * # 运行流程：
 * #   1. 加载 bundle 列表
 * #   2. 添加/移除上下文项
 * #   3. 删除 bundle
 * #   4. 获取统计信息
 * # 输入参数：baseUrl, bundleId
 * # 输出结果：useMultiContextResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 62 G62-02 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type ContextSourceType =
  | 'file'
  | 'code'
  | 'terminal'
  | 'git'
  | 'document'
  | 'web';

export interface ContextItem {
  item_id: string;
  source_type: ContextSourceType;
  source_data: Record<string, unknown>;
  content: string;
  token_count: number;
  loaded_at: number;
  error: string | null;
  metadata: Record<string, unknown>;
  loaded: boolean;
}

export interface ContextBundle {
  bundle_id: string;
  items: ContextItem[];
  item_count: number;
  combined_content: string;
  total_tokens: number;
  created_at: number;
}

export interface AddContextItemRequest {
  bundle_id: string;
  source_type: ContextSourceType;
  source_data: Record<string, unknown>;
}

export interface UseMultiContextOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
  bundleId?: string;
}

export interface UseMultiContextResult {
  bundles: ContextBundle[];
  activeBundle: ContextBundle | null;
  setActiveBundleId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  stats: { bundle_count: number; total_items: number; total_tokens: number } | null;
  refresh: () => Promise<void>;
  addItem: (req: AddContextItemRequest) => Promise<ContextItem | null>;
  removeItem: (bundleId: string, itemId: string) => Promise<boolean>;
  deleteBundle: (bundleId: string) => Promise<boolean>;
  refreshStats: () => Promise<void>;
}

const DEFAULT_BASE_URL = '/api';
const DEFAULT_AUTO_REFRESH_MS = 5000;

export function useMultiContext(options: UseMultiContextOptions = {}): UseMultiContextResult {
  const {
    baseUrl = DEFAULT_BASE_URL,
    autoRefreshMs = DEFAULT_AUTO_REFRESH_MS,
    bundleId,
  } = options;

  const [bundles, setBundles] = useState<ContextBundle[]>([]);
  const [activeBundleId, setActiveBundleId] = useState<string | null>(bundleId ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UseMultiContextResult['stats']>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/context/bundles`);
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = await res.json();
      setBundles(data.bundles || []);
      // 自动设置第一个 bundle 为活跃
      if (!activeBundleId && data.bundles && data.bundles.length > 0) {
        setActiveBundleId(data.bundles[0].bundle_id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, activeBundleId]);

  const refreshStats = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${baseUrl}/context/stats`);
      if (!res.ok) return;
      const data = await res.json();
      setStats(data.stats || null);
    } catch (e) {
      // 静默失败
    }
  }, [baseUrl]);

  const addItem = useCallback(
    async (req: AddContextItemRequest): Promise<ContextItem | null> => {
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/context/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || `添加失败: ${res.status}`);
        }
        const data = await res.json();
        // 刷新 bundles
        await refresh();
        return data.item as ContextItem;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      }
    },
    [baseUrl, refresh],
  );

  const removeItem = useCallback(
    async (bundleId: string, itemId: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(
          `${baseUrl}/context/bundles/${encodeURIComponent(bundleId)}/items/${encodeURIComponent(itemId)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(`移除失败: ${res.status}`);
        await refresh();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return false;
      }
    },
    [baseUrl, refresh],
  );

  const deleteBundle = useCallback(
    async (bundleId: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(
          `${baseUrl}/context/bundles/${encodeURIComponent(bundleId)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(`删除失败: ${res.status}`);
        await refresh();
        if (activeBundleId === bundleId) {
          setActiveBundleId(null);
        }
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return false;
      }
    },
    [baseUrl, refresh, activeBundleId],
  );

  // 初始加载 + 自动刷新
  useEffect(() => {
    refresh();
    refreshStats();
    if (autoRefreshMs > 0) {
      const t = setInterval(() => {
        refresh();
        refreshStats();
      }, autoRefreshMs);
      return () => clearInterval(t);
    }
    return undefined;
  }, [refresh, refreshStats, autoRefreshMs]);

  const activeBundle = useMemo(
    () => bundles.find((b) => b.bundle_id === activeBundleId) || null,
    [bundles, activeBundleId],
  );

  return {
    bundles,
    activeBundle,
    setActiveBundleId,
    loading,
    error,
    stats,
    refresh,
    addItem,
    removeItem,
    deleteBundle,
    refreshStats,
  };
}
