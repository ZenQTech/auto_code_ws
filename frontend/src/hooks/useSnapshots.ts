/**
 * # ============================================================
 * # useSnapshots Hook (v1.0.0)
 * # Cycle 66 G66-02
 * # ====================================
 * # 核心作用：封装快照 API 调用 + 状态管理
 * # 功能：
 * #   1. 列出会话快照
 * #   2. 创建快照
 * #   3. 删除快照
 * #   4. 预览 diff
 * #   5. 恢复（支持 force + paths 过滤）
 * #   6. 冲突检测 + 错误处理
 * #   7. 自动刷新
 * # 输入参数：sessionId, options
 * # 输出结果：snapshots + actions + loading/error
 * # 对标：agent-rollback content-addressed snapshots
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 66 G66-02 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type SnapshotTrigger = 'manual' | 'auto' | 'pre_edit';
export type RestoreStatus = 'completed' | 'partial' | 'pending_confirm' | 'failed';
export type ConflictType = 'file_modified' | 'file_deleted' | 'file_added';

export interface SnapshotFile {
  path: string;
  hash: string;
  size: number;
  existed: boolean;
  storage_relpath?: string;
}

export interface Snapshot {
  snapshot_id: string;
  session_id: string;
  agent_id: string;
  trigger: SnapshotTrigger;
  description: string;
  files: SnapshotFile[];
  file_count: number;
  total_size: number;
  created_at: number;
}

export interface Conflict {
  path: string;
  type: ConflictType;
  expected_hash: string;
  actual_hash: string;
}

export interface FileChange {
  path: string;
  change_type: 'modify' | 'create' | 'delete' | 'unchanged';
  diff: string;
  additions: number;
  deletions: number;
}

export interface DiffPreview {
  snapshot_id: string;
  files: FileChange[];
  created_at: number;
}

export interface RestoreResult {
  success: boolean;
  status: RestoreStatus;
  applied: string[];
  failed: Array<{ path: string; error: string }>;
  conflicts: Conflict[];
  message: string;
}

export interface CreateSnapshotParams {
  paths: string[];
  trigger?: SnapshotTrigger;
  description?: string;
  agentId: string;
}

export interface RestoreOptions {
  paths?: string[];
  force?: boolean;
  actor?: string;
}

export interface UseSnapshotsOptions {
  sessionId: string;
  limit?: number;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
}

export interface UseSnapshotsResult {
  snapshots: Snapshot[];
  total: number;
  loading: boolean;
  error: string | null;

  create: (params: CreateSnapshotParams) => Promise<Snapshot | null>;
  remove: (snapshotId: string) => Promise<boolean>;
  restore: (snapshotId: string, opts?: RestoreOptions) => Promise<RestoreResult | null>;
  preview: (snapshotId: string, paths?: string[]) => Promise<DiffPreview | null>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_LIMIT = 50;
const DEFAULT_REFRESH_INTERVAL = 5000;
const DEFAULT_BASE_URL = '/api/snapshots';

// ============================================================
// 辅助函数
// ============================================================

function handleError(err: unknown, action: string): string {
  if (err instanceof Error) {
    return `${action}: ${err.message}`;
  }
  return `${action}: 未知错误`;
}

// ============================================================
// Hook 主实现
// ============================================================

export function useSnapshots(options: UseSnapshotsOptions): UseSnapshotsResult {
  const {
    sessionId,
    limit = DEFAULT_LIMIT,
    autoRefresh = false,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL,
  } = options;

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const isMountedRef = useRef(true);

  // ============================================================
  // refresh
  // ============================================================

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSnapshots([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `${DEFAULT_BASE_URL}?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (isMountedRef.current) {
        setSnapshots(data.snapshots || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(handleError(err, 'refresh'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [sessionId, limit]);

  // ============================================================
  // create
  // ============================================================

  const create = useCallback(
    async (params: CreateSnapshotParams): Promise<Snapshot | null> => {
      if (!sessionId) {
        setError('sessionId 必填');
        return null;
      }
      setError(null);
      try {
        const resp = await fetch(DEFAULT_BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            agent_id: params.agentId,
            paths: params.paths,
            trigger: params.trigger || 'manual',
            description: params.description || '',
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        // 自动刷新
        setRefreshKey((k) => k + 1);
        return data.snapshot as Snapshot;
      } catch (err) {
        setError(handleError(err, 'create'));
        return null;
      }
    },
    [sessionId]
  );

  // ============================================================
  // remove
  // ============================================================

  const remove = useCallback(
    async (snapshotId: string): Promise<boolean> => {
      setError(null);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/${snapshotId}`, {
          method: 'DELETE',
        });
        if (!resp.ok) {
          if (resp.status === 404) return true; // 已删除视作成功
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        // 自动刷新
        setRefreshKey((k) => k + 1);
        return true;
      } catch (err) {
        setError(handleError(err, 'remove'));
        return false;
      }
    },
    []
  );

  // ============================================================
  // restore
  // ============================================================

  const restore = useCallback(
    async (snapshotId: string, opts: RestoreOptions = {}): Promise<RestoreResult | null> => {
      setError(null);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/${snapshotId}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paths: opts.paths || null,
            force: opts.force || false,
            actor: opts.actor || 'user',
          }),
        });
        if (resp.status === 404) {
          setError('快照不存在');
          return null;
        }
        if (resp.status === 409) {
          // 冲突：pending_confirm
          const data = await resp.json();
          return data.result as RestoreResult;
        }
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setRefreshKey((k) => k + 1);
        return data.result as RestoreResult;
      } catch (err) {
        setError(handleError(err, 'restore'));
        return null;
      }
    },
    []
  );

  // ============================================================
  // preview
  // ============================================================

  const preview = useCallback(
    async (snapshotId: string, paths?: string[]): Promise<DiffPreview | null> => {
      setError(null);
      try {
        const url = paths && paths.length > 0
          ? `${DEFAULT_BASE_URL}/${snapshotId}/preview?paths=${encodeURIComponent(paths.join(','))}`
          : `${DEFAULT_BASE_URL}/${snapshotId}/preview`;
        const resp = await fetch(url, { method: 'GET' });
        if (!resp.ok) {
          if (resp.status === 404) {
            setError('快照不存在');
            return null;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        return data.preview as DiffPreview;
      } catch (err) {
        setError(handleError(err, 'preview'));
        return null;
      }
    },
    []
  );

  // ============================================================
  // clearError
  // ============================================================

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ============================================================
  // 自动刷新
  // ============================================================

  useEffect(() => {
    isMountedRef.current = true;
    refresh();
    return () => {
      isMountedRef.current = false;
    };
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refresh();
    }, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshIntervalMs, refresh]);

  return {
    snapshots,
    total,
    loading,
    error,
    create,
    remove,
    restore,
    preview,
    refresh,
    clearError,
  };
}

export default useSnapshots;
