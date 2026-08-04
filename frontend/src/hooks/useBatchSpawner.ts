/**
 * # ============================================================
 * # useBatchSpawner Hook (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：封装 BatchSpawner CSV 批处理 REST API
 * # 运行流程：
 * #   1. 提交 CSV 文本 -> spawn_batch -> 返回 batch_id
 * #   2. 轮询查询批量任务进度
 * #   3. 取消 / 导出结果
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：UseBatchSpawnerResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型
// ============================================================

export interface BatchError {
  row_index: number;
  field: string;
  message: string;
  raw?: string;
}

export interface BatchInstance {
  agent_id: string;
  row_index: number;
  task: string;
  nickname?: string | null;
  role: string;
  model?: string | null;
  context: Record<string, unknown>;
  status: string; // pending/spawning/running/idle/failed/cancelled
  error?: string | null;
  started_at: number;
  finished_at?: number | null;
}

export interface BatchJob {
  batch_id: string;
  total: number;
  accepted: number;
  rejected: number;
  in_progress: number;
  completed: number;
  failed: number;
  progress: number;
  status: string; // pending/running/completed/cancelled/failed
  max_concurrency: number;
  default_role?: string | null;
  default_model?: string | null;
  started_at: number;
  finished_at?: number | null;
  instances: Record<string, BatchInstance>;
  errors: BatchError[];
}

export interface SpawnBatchRequest {
  csv_content: string;
  role?: string | null;
  default_model?: string | null;
  max_concurrency?: number;
}

export interface SpawnBatchResponse {
  success: boolean;
  batch_id: string;
  total: number;
  accepted: number;
  rejected: number;
  status: string;
  errors: BatchError[];
}

export interface ExportFormat {
  format: 'json' | 'csv' | 'md';
  content: string;
}

export interface UseBatchSpawnerOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
  pollWhenRunning?: boolean;
}

export interface UseBatchSpawnerResult {
  // 数据
  jobs: Record<string, BatchJob>;
  currentJob: BatchJob | null;
  batchList: BatchJob[];

  // 状态
  loading: boolean;
  submitting: boolean;
  error: string | null;

  // 操作
  submit: (req: SpawnBatchRequest) => Promise<SpawnBatchResponse | null>;
  refresh: (batchId: string) => Promise<BatchJob | null>;
  refreshAll: () => Promise<void>;
  cancel: (batchId: string) => Promise<boolean>;
  exportBatch: (
    batchId: string,
    format: 'json' | 'csv' | 'md',
  ) => Promise<ExportFormat | null>;
  setCurrent: (job: BatchJob | null) => void;
  clearError: () => void;
}

const DEFAULT_BASE_URL = '/api/agent-roles';
const DEFAULT_POLL_MS = 1500;

// ============================================================
// Hook
// ============================================================

export function useBatchSpawner(
  options: UseBatchSpawnerOptions = {},
): UseBatchSpawnerResult {
  const {
    baseUrl = DEFAULT_BASE_URL,
    autoRefreshMs = DEFAULT_POLL_MS,
    pollWhenRunning = true,
  } = options;

  const [jobs, setJobs] = useState<Record<string, BatchJob>>({});
  const [currentJob, setCurrentJob] = useState<BatchJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // 错误处理
  // ============================================================

  const handleError = useCallback((err: unknown, op: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(`[${op}] ${msg}`);
    // eslint-disable-next-line no-console
    console.error(`[useBatchSpawner] ${op}:`, err);
  }, []);

  // ============================================================
  // 提交批量任务
  // ============================================================

  const submit = useCallback(
    async (req: SpawnBatchRequest): Promise<SpawnBatchResponse | null> => {
      setSubmitting(true);
      setError(null);
      try {
        const resp = await fetch(`${baseUrl}/batch/spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csv_content: req.csv_content,
            role: req.role ?? null,
            default_model: req.default_model ?? null,
            max_concurrency: req.max_concurrency ?? 5,
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data: SpawnBatchResponse = await resp.json();
        // 立即拉取一次详情
        const job = await refresh(data.batch_id);
        if (job) {
          setCurrentJob(job);
        }
        return data;
      } catch (err) {
        handleError(err, 'submit');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [baseUrl, handleError],
  );

  // ============================================================
  // 刷新单个 batch
  // ============================================================

  const refresh = useCallback(
    async (batchId: string): Promise<BatchJob | null> => {
      try {
        const resp = await fetch(`${baseUrl}/batch/${encodeURIComponent(batchId)}`, {
          method: 'GET',
        });
        if (!resp.ok) {
          if (resp.status === 404) {
            return null;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.success && data.batch_id) {
          const job = data as BatchJob;
          setJobs((prev) => ({ ...prev, [job.batch_id]: job }));
          setCurrentJob((prev) => (prev && prev.batch_id === job.batch_id ? job : prev));
          return job;
        }
        return null;
      } catch (err) {
        handleError(err, 'refresh');
        return null;
      }
    },
    [baseUrl, handleError],
  );

  // ============================================================
  // 刷新所有
  // ============================================================

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      // 通过 /batch/list 拉取所有任务
      const resp = await fetch(`${baseUrl}/batch/list`, { method: 'GET' });
      if (!resp.ok) {
        // 端点不存在时降级：刷新 currentJob
        if (currentJob) {
          await refresh(currentJob.batch_id);
        }
        return;
      }
      const data = await resp.json();
      const list: BatchJob[] = (data.jobs || data.batch_jobs || []) as BatchJob[];
      const map: Record<string, BatchJob> = {};
      for (const j of list) {
        map[j.batch_id] = j;
      }
      setJobs(map);
    } catch (err) {
      handleError(err, 'refreshAll');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, currentJob, handleError, refresh]);

  // ============================================================
  // 取消
  // ============================================================

  const cancel = useCallback(
    async (batchId: string): Promise<boolean> => {
      try {
        const resp = await fetch(
          `${baseUrl}/batch/${encodeURIComponent(batchId)}/cancel`,
          { method: 'POST' },
        );
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.success) {
          await refresh(batchId);
        }
        return data.success === true;
      } catch (err) {
        handleError(err, 'cancel');
        return false;
      }
    },
    [baseUrl, handleError, refresh],
  );

  // ============================================================
  // 导出
  // ============================================================

  const exportBatch = useCallback(
    async (batchId: string, format: 'json' | 'csv' | 'md'): Promise<ExportFormat | null> => {
      try {
        const resp = await fetch(
          `${baseUrl}/batch/${encodeURIComponent(batchId)}/export?format=${format}`,
          { method: 'GET' },
        );
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (data.success) {
          return { format, content: data.content || '' };
        }
        return null;
      } catch (err) {
        handleError(err, 'exportBatch');
        return null;
      }
    },
    [baseUrl, handleError],
  );

  const setCurrent = useCallback((job: BatchJob | null) => {
    setCurrentJob(job);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ============================================================
  // 自动轮询 currentJob
  // ============================================================

  useEffect(() => {
    if (!pollWhenRunning) return;
    if (!currentJob) return;
    const isRunning =
      currentJob.status === 'running' || currentJob.status === 'pending';
    if (!isRunning) return;

    const timer = setInterval(() => {
      refresh(currentJob.batch_id);
    }, autoRefreshMs);
    pollTimerRef.current = timer;
    return () => {
      clearInterval(timer);
      pollTimerRef.current = null;
    };
  }, [currentJob, pollWhenRunning, autoRefreshMs, refresh]);

  // ============================================================
  // 衍生数据
  // ============================================================

  const batchList: BatchJob[] = Object.values(jobs).sort(
    (a, b) => (b.started_at || 0) - (a.started_at || 0),
  );

  return {
    jobs,
    currentJob,
    batchList,
    loading,
    submitting,
    error,
    submit,
    refresh,
    refreshAll,
    cancel,
    exportBatch,
    setCurrent,
    clearError,
  };
}

export default useBatchSpawner;
