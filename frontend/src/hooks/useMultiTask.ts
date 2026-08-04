/**
 * # ============================================================
 * # useMultiTask Hook (v1.0.0)
 * # Cycle 62 G62-01
 * # ====================================
 * # 核心作用：封装多任务并行 API 调用
 * # 运行流程：
 * #   1. 加载任务列表
 * #   2. 创建/启动/暂停/恢复/取消/删除任务
 * #   3. 订阅 WebSocket 实时更新
 * #   4. 跟踪当前活跃任务
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：useMultiTaskResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 62 G62-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  task_id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  context_ids: string[];
  plan_id: string | null;
  execution_id: string | null;
  resource_usage: {
    cpu_percent: number;
    memory_mb: number;
    tokens_used: number;
    elapsed_seconds: number;
  };
  error: string | null;
  result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  elapsed_s: number;
}

export interface UseMultiTaskOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
}

export interface UseMultiTaskResult {
  tasks: Task[];
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTask: (req: {
    title: string;
    prompt: string;
    context_ids?: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<Task | null>;
  startTask: (taskId: string) => Promise<Task | null>;
  pauseTask: (taskId: string) => Promise<Task | null>;
  resumeTask: (taskId: string) => Promise<Task | null>;
  cancelTask: (taskId: string) => Promise<Task | null>;
  deleteTask: (taskId: string) => Promise<boolean>;
  getStats: () => Promise<{ total: number; by_status: Record<string, number> } | null>;
}

const DEFAULT_BASE_URL = '/api';
const DEFAULT_AUTO_REFRESH_MS = 5000;

export function useMultiTask(options: UseMultiTaskOptions = {}): UseMultiTaskResult {
  const {
    baseUrl = DEFAULT_BASE_URL,
    autoRefreshMs = DEFAULT_AUTO_REFRESH_MS,
  } = options;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/multi-task/list?limit=100`);
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const createTask = useCallback(async (req: {
    title: string;
    prompt: string;
    context_ids?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<Task | null> => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/multi-task/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `创建失败: ${res.status}`);
      }
      const data = await res.json();
      const task = data.task as Task;
      setTasks((prev) => [task, ...prev]);
      return task;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    }
  }, [baseUrl]);

  const updateTask = useCallback(async (
    taskId: string, action: string,
  ): Promise<Task | null> => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/multi-task/${taskId}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `${action} 失败: ${res.status}`);
      }
      const data = await res.json();
      const task = data.task as Task;
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? task : t)));
      return task;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    }
  }, [baseUrl]);

  const startTask = useCallback(
    (taskId: string) => updateTask(taskId, 'start'),
    [updateTask],
  );
  const pauseTask = useCallback(
    (taskId: string) => updateTask(taskId, 'pause'),
    [updateTask],
  );
  const resumeTask = useCallback(
    (taskId: string) => updateTask(taskId, 'resume'),
    [updateTask],
  );
  const cancelTask = useCallback(
    (taskId: string) => updateTask(taskId, 'cancel'),
    [updateTask],
  );

  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/multi-task/${taskId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `删除失败: ${res.status}`);
      }
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      if (activeTaskId === taskId) {
        setActiveTaskId(null);
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return false;
    }
  }, [baseUrl, activeTaskId]);

  const getStats = useCallback(async (): Promise<{
    total: number;
    by_status: Record<string, number>;
  } | null> => {
    try {
      const res = await fetch(`${baseUrl}/multi-task/stats`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.stats;
    } catch {
      return null;
    }
  }, [baseUrl]);

  // Auto refresh
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), autoRefreshMs);
    return () => clearInterval(timer);
  }, [refresh, autoRefreshMs]);

  return useMemo(() => ({
    tasks,
    activeTaskId,
    setActiveTaskId,
    loading,
    error,
    refresh,
    createTask,
    startTask,
    pauseTask,
    resumeTask,
    cancelTask,
    deleteTask,
    getStats,
  }), [
    tasks, activeTaskId, loading, error, refresh,
    createTask, startTask, pauseTask, resumeTask, cancelTask, deleteTask, getStats,
  ]);
}
