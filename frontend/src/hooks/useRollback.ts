/**
 * # ============================================================
 * # useRollback Hook (v1.0.0)
 * # Cycle 61 G61-07
 * # ====================================
 * # 核心作用：封装一键回退（git revert）的 API 调用
 * # 运行流程：
 * #   1. 加载快照列表
 * #   2. 创建快照（手动 / 自动）
 * #   3. 回退到指定 commit
 * #   4. 获取 git log / 回退历史
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：useRollbackResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-07 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Snapshot {
  snapshot_id: string;
  commit_hash: string;
  short_hash: string;
  message: string;
  source: 'plan' | 'step' | 'manual' | 'initial';
  plan_id: string | null;
  step_id: string | null;
  author: string;
  created_at: number;
  files_changed: number;
  insertions: number;
  deletions: number;
}

export interface RollbackResult {
  success: boolean;
  original_commit: string;
  revert_commit: string;
  message: string;
  error: string | null;
  files_changed: number;
  timestamp: number;
}

export interface GitLogEntry {
  commit_hash: string;
  short_hash: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface UseRollbackOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
  initialRepoPath?: string;
}

export interface UseRollbackResult {
  // Repo
  repoPath: string;
  setRepoPath: (path: string) => void;
  // 快照
  snapshots: Snapshot[];
  snapshotsLoading: boolean;
  snapshotsError: string | null;
  refreshSnapshots: (planId?: string) => Promise<void>;
  createSnapshot: (req: {
    message: string;
    source?: string;
    plan_id?: string;
    step_id?: string;
  }) => Promise<Snapshot | null>;
  // 回退
  isRollingBack: boolean;
  rollback: (commitHash: string, message?: string) => Promise<RollbackResult | null>;
  rollbackBySnapshot: (snapshotId: string, message?: string) => Promise<RollbackResult | null>;
  rollbackBatch: (commitHashes: string[]) => Promise<RollbackResult[] | null>;
  // Git log
  gitLog: GitLogEntry[];
  refreshGitLog: () => Promise<void>;
  // 历史
  rollbackHistory: RollbackResult[];
  refreshHistory: () => Promise<void>;
  // 通用
  error: string | null;
  setError: (err: string | null) => void;
}

const DEFAULT_BASE_URL = '/api';
const DEFAULT_AUTO_REFRESH_MS = 5000;

export function useRollback(options: UseRollbackOptions = {}): UseRollbackResult {
  const {
    baseUrl = DEFAULT_BASE_URL,
    autoRefreshMs = DEFAULT_AUTO_REFRESH_MS,
    initialRepoPath = '',
  } = options;

  // Repo path
  const [repoPath, setRepoPath] = useState(initialRepoPath);

  // 快照
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);

  // 回退状态
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackHistory, setRollbackHistory] = useState<RollbackResult[]>([]);

  // Git log
  const [gitLog, setGitLog] = useState<GitLogEntry[]>([]);

  // 通用错误
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // 快照
  // ============================================================

  const refreshSnapshots = useCallback(async (planId?: string): Promise<void> => {
    setSnapshotsLoading(true);
    setSnapshotsError(null);
    try {
      const url = planId
        ? `${baseUrl}/rollback/snapshots?plan_id=${encodeURIComponent(planId)}`
        : `${baseUrl}/rollback/snapshots`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`加载快照失败: ${res.status}`);
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSnapshotsError(msg);
    } finally {
      setSnapshotsLoading(false);
    }
  }, [baseUrl]);

  const createSnapshot = useCallback(async (req: {
    message: string;
    source?: string;
    plan_id?: string;
    step_id?: string;
  }): Promise<Snapshot | null> => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/rollback/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_path: repoPath,
          message: req.message,
          source: req.source || 'manual',
          plan_id: req.plan_id,
          step_id: req.step_id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `创建失败: ${res.status}`);
      }
      const data = await res.json();
      const snap = data.snapshot as Snapshot;
      setSnapshots((prev) => [snap, ...prev]);
      return snap;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    }
  }, [baseUrl, repoPath]);

  // ============================================================
  // Git log (先定义，被 rollback 系列函数引用)
  // ============================================================

  const refreshGitLog = useCallback(async (): Promise<void> => {
    if (!repoPath) {
      setGitLog([]);
      return;
    }
    try {
      const res = await fetch(
        `${baseUrl}/rollback/git-log?repo_path=${encodeURIComponent(repoPath)}&limit=30`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setGitLog(data.entries || []);
    } catch {
      // 静默失败
    }
  }, [baseUrl, repoPath]);

  // ============================================================
  // 历史
  // ============================================================

  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${baseUrl}/rollback/history?limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      setRollbackHistory(data.history || []);
    } catch {
      // 静默失败
    }
  }, [baseUrl]);

  // ============================================================
  // 回退
  // ============================================================

  const rollback = useCallback(async (
    commitHash: string,
    message?: string,
  ): Promise<RollbackResult | null> => {
    setError(null);
    setIsRollingBack(true);
    try {
      const res = await fetch(`${baseUrl}/rollback/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_path: repoPath,
          commit_hash: commitHash,
          message,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `回退失败: ${res.status}`);
      }
      const data = await res.json();
      const result = data.result as RollbackResult;
      setRollbackHistory((prev) => [result, ...prev]);
      // 刷新快照
      void refreshSnapshots();
      void refreshGitLog();
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setIsRollingBack(false);
    }
  }, [baseUrl, repoPath, refreshSnapshots, refreshGitLog]);

  const rollbackBySnapshot = useCallback(async (
    snapshotId: string,
    message?: string,
  ): Promise<RollbackResult | null> => {
    setError(null);
    setIsRollingBack(true);
    try {
      const res = await fetch(`${baseUrl}/rollback/rollback-by-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_path: repoPath,
          snapshot_id: snapshotId,
          message,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `回退失败: ${res.status}`);
      }
      const data = await res.json();
      const result = data.result as RollbackResult;
      setRollbackHistory((prev) => [result, ...prev]);
      void refreshSnapshots();
      void refreshGitLog();
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setIsRollingBack(false);
    }
  }, [baseUrl, repoPath, refreshSnapshots, refreshGitLog]);

  const rollbackBatch = useCallback(async (
    commitHashes: string[],
  ): Promise<RollbackResult[] | null> => {
    setError(null);
    setIsRollingBack(true);
    try {
      const res = await fetch(`${baseUrl}/rollback/rollback-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_path: repoPath,
          commit_hashes: commitHashes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `批量回退失败: ${res.status}`);
      }
      const data = await res.json();
      const results = data.results as RollbackResult[];
      setRollbackHistory((prev) => [...results.reverse(), ...prev]);
      void refreshSnapshots();
      void refreshGitLog();
      return results;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setIsRollingBack(false);
    }
  }, [baseUrl, repoPath, refreshSnapshots, refreshGitLog]);

  // ============================================================
  // 自动刷新
  // ============================================================

  useEffect(() => {
    if (!repoPath) return;
    const timer = setInterval(() => {
      void refreshSnapshots();
      void refreshGitLog();
    }, autoRefreshMs);
    return () => clearInterval(timer);
  }, [repoPath, autoRefreshMs, refreshSnapshots, refreshGitLog]);

  return useMemo(() => ({
    repoPath,
    setRepoPath,
    snapshots,
    snapshotsLoading,
    snapshotsError,
    refreshSnapshots,
    createSnapshot,
    isRollingBack,
    rollback,
    rollbackBySnapshot,
    rollbackBatch,
    gitLog,
    refreshGitLog,
    rollbackHistory,
    refreshHistory,
    error,
    setError,
  }), [
    repoPath,
    snapshots, snapshotsLoading, snapshotsError, refreshSnapshots, createSnapshot,
    isRollingBack, rollback, rollbackBySnapshot, rollbackBatch,
    gitLog, refreshGitLog,
    rollbackHistory, refreshHistory,
    error,
  ]);
}
