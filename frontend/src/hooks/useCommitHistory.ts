/**
 * # ============================================================
 * # useCommitHistory 提交历史 Hook（v6.40.0 P2-6）
 * # ============================================================
 * # 核心作用：调用后端 /api/git/log 拉取提交历史
 * #           提供自动刷新 + 分支过滤 + 搜索能力
 * # 运行流程：
 * #   1. 接收 maxCount/branch/autoRefresh 参数
 * #   2. 调用 useApi.fetchCommitLog 获取数据
 * #   3. 通过 refresh() 主动刷新
 * #   4. autoRefresh 开启后按 interval 轮询
 * # 输入参数：见 UseCommitHistoryOptions
 * # 输出结果：{ commits, loading, error, refresh, lastFetched }
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-6 新建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface CommitEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  is_auto_commit: boolean;
}

export interface UseCommitHistoryOptions {
  /** 最大返回条数（默认 50） */
  maxCount?: number;
  /** 指定分支（默认当前分支） */
  branch?: string;
  /** 自动刷新间隔（毫秒），0 表示不自动刷新 */
  autoRefreshInterval?: number;
  /** 是否立即拉取（默认 true） */
  immediate?: boolean;
  /** 自定义 fetcher（用于测试） */
  fetcher?: (maxCount: number, branch?: string) => Promise<CommitEntry[]>;
}

export interface UseCommitHistoryResult {
  /** 提交列表（最新在上） */
  commits: CommitEntry[];
  /** 是否加载中 */
  loading: boolean;
  /** 错误对象 */
  error: Error | null;
  /** 主动刷新 */
  refresh: () => Promise<void>;
  /** 最后一次拉取时间 */
  lastFetched: number | null;
}

const DEFAULT_API_BASE = '/api';

/**
 * 默认 fetcher：调用后端 /api/git/log
 */
async function defaultFetcher(maxCount: number, branch?: string): Promise<CommitEntry[]> {
  const params = new URLSearchParams();
  params.set('max_count', String(maxCount));
  if (branch) {
    params.set('branch', branch);
  }
  const url = `${DEFAULT_API_BASE}/git/log?${params.toString()}`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch commit log: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.commits || []) as CommitEntry[];
}

/**
 * useCommitHistory 提交历史 Hook
 */
export function useCommitHistory(options: UseCommitHistoryOptions = {}): UseCommitHistoryResult {
  const {
    maxCount = 50,
    branch,
    autoRefreshInterval = 0,
    immediate = true,
    fetcher,
  } = options;

  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  const inFlightRef = useRef<boolean>(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const fn = fetcherRef.current ?? defaultFetcher;
      const data = await fn(maxCount, branch);
      setCommits(data);
      setLastFetched(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [maxCount, branch]);

  // 立即拉取
  useEffect(() => {
    if (immediate) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxCount, branch]);

  // 自动刷新
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      refresh();
    }, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, refresh]);

  return {
    commits,
    loading,
    error,
    refresh,
    lastFetched,
  };
}

export default useCommitHistory;
